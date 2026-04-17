import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import AgentControlCard from '../../../../components/AgentControlCard';
import { getAgentIdentityKey } from '../../../../lib/agentIdentity';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import { OfficeAgent } from '../../../../lib/officeAgents';
import { useAgentControl } from '../../../../services/hitlService';
import { supabase } from '../../../../lib/supabase';
import { formatRelativeTime, getAgentHealth, MONO, shortPath } from './AgentPanelShared';

// ─── Quick Actions strip ────────────────────────────────────────────────────
// Top-of-console action row. Send Task opens an inline composer that hits the
// onRunCommand prop (typically wired to the agent's bridge). Pause/Resume
// toggles agent_controls.is_paused, which every downstream invocation path
// honors. Copy Session pulls the session key into the clipboard so you can
// jump to it from a terminal or another tool.

function QuickActionsStrip({
  agent, circleId, sessionKey, isPaused, onRunCommand,
}: {
  agent: OfficeAgent;
  circleId?: string;
  sessionKey: string;
  isPaused: boolean;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Computer-use gate. When on and the agent is a claude-code session with a
  // live bridge, Send Task routes through execBridgeCommand (shell on the
  // user's machine) instead of the normal onRunCommand path. We persist a
  // 1-hour expiry so the flag can't be left on indefinitely by accident.
  const COMPUTER_USE_TTL_MS = 60 * 60_000;
  const computerUseKey = `uc_computer_use_${sessionKey}`;
  const canUseShell = agent.providerType === 'claude-code';
  const [computerUseOn, setComputerUseOn] = useState<boolean>(() => {
    if (!canUseShell || typeof window === 'undefined' || !window.localStorage) return false;
    const raw = window.localStorage.getItem(computerUseKey);
    if (!raw) return false;
    const parsed = parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return false;
    return Date.now() - parsed < COMPUTER_USE_TTL_MS;
  });

  useEffect(() => {
    if (!computerUseOn) return;
    const raw = window.localStorage?.getItem(computerUseKey);
    const enabledAt = raw ? parseInt(raw, 10) : Date.now();
    const remaining = COMPUTER_USE_TTL_MS - (Date.now() - enabledAt);
    if (remaining <= 0) {
      setComputerUseOn(false);
      window.localStorage?.removeItem(computerUseKey);
      return;
    }
    const id = setTimeout(() => {
      setComputerUseOn(false);
      window.localStorage?.removeItem(computerUseKey);
    }, remaining);
    return () => clearTimeout(id);
  }, [computerUseOn, computerUseKey]);

  const { upsertAgentControl } = require('../../../../services/hitlService') as typeof import('../../../../services/hitlService');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2400);
  };

  const handleToggleComputerUse = () => {
    if (!canUseShell) {
      showToast('Computer use only works for Claude Code sessions');
      return;
    }
    const next = !computerUseOn;
    setComputerUseOn(next);
    try {
      if (next) window.localStorage?.setItem(computerUseKey, String(Date.now()));
      else window.localStorage?.removeItem(computerUseKey);
    } catch {}
    showToast(next ? 'Computer use ENABLED · 1 hour' : 'Computer use disabled');
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      // Computer-use path: hit the Claude Code bridge's shell endpoint.
      // This runs the literal string as a shell command on the user's
      // machine. We only allow this for claude-code agents where the
      // bridge at localhost:7778 is the trust boundary the user already
      // opted into by running `npm run dev`.
      if (computerUseOn && canUseShell) {
        try {
          const { execBridgeCommand } = await import('../../../../lib/claudeCodeDetector');
          const res = await execBridgeCommand(text);
          const out = (res.stdout || '').trim();
          const err = (res.stderr || '').trim();
          if (res.ok) {
            showToast(out ? `✓ ${out.slice(0, 80)}` : '✓ Shell ran (no output)');
          } else {
            showToast(err ? `✗ ${err.slice(0, 80)}` : (res.error || 'Shell failed'));
          }
          // Always log shell invocations to the activity feed for audit.
          if (circleId) {
            await supabase.from('agent_activity').insert({
              circle_id: circleId,
              agent_name: agent.name,
              action: 'shell_exec',
              detail: `$ ${text}\n${out.slice(0, 500)}${err ? `\n[stderr] ${err.slice(0, 500)}` : ''}`,
            });
          }
        } catch (shellErr: any) {
          showToast(shellErr?.message || 'Bridge unreachable');
        }
      } else if (onRunCommand) {
        const res = await onRunCommand(text);
        showToast(res.ok ? 'Task dispatched' : (res.stderr || 'Dispatch failed'));
      } else if (!circleId) {
        showToast('No circle context available');
      } else {
        // Fall back to writing the prompt to agent_activity so it shows up
        // in the circle's activity feed; downstream auto-runners can pick
        // it up. This keeps Send Task useful even for bridge-less agents.
        await supabase.from('agent_activity').insert({
          circle_id: circleId,
          agent_name: agent.name,
          action: 'task_queued',
          detail: text,
        });
        showToast('Queued to activity feed');
      }
      setDraft('');
      setComposerOpen(false);
    } catch (err: any) {
      showToast(err?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  const handleTogglePause = async () => {
    try {
      if (!circleId) {
        showToast('No circle context available');
        return;
      }
      await upsertAgentControl(circleId, sessionKey, agent.name, { is_paused: !isPaused });
      showToast(isPaused ? 'Resumed' : 'Paused');
    } catch (err: any) {
      showToast(err?.message || 'Toggle failed');
    }
  };

  const handleCopySession = () => {
    try {
      if (Platform.OS === 'web' && navigator?.clipboard) {
        navigator.clipboard.writeText(sessionKey);
        showToast('Session key copied');
      } else {
        showToast(sessionKey);
      }
    } catch {
      showToast(sessionKey);
    }
  };

  const btnStyle = (kind: 'primary' | 'ghost' | 'warn') => ({
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: kind === 'primary' ? (agent.color || '#6366f1') : kind === 'warn' ? '#ef4444' : '#262626',
    backgroundColor: kind === 'primary' ? (agent.color || '#6366f1') + '18' : '#0a0a10',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  });
  const btnText = (kind: 'primary' | 'ghost' | 'warn') => ({
    color: kind === 'primary' ? (agent.color || '#6366f1') : kind === 'warn' ? '#ef4444' : '#d6d6e1',
    fontSize: 10,
    fontWeight: '900' as const,
    letterSpacing: 0.8,
    fontFamily: MONO,
  });

  return (
    <View style={{ gap: 8 }}>
      {computerUseOn && canUseShell && (
        <View style={{ backgroundColor: '#2a0a0a', borderWidth: 1, borderColor: '#ef4444', borderRadius: 4, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: '#ef4444', fontSize: 14 }}>⚠</Text>
          <Text style={{ color: '#fecaca', fontSize: 11, fontWeight: '700', fontFamily: MONO, flex: 1 }}>
            COMPUTER USE ACTIVE · Send Task runs shell on your machine · auto-disables in 1h
          </Text>
          <Pressable onPress={handleToggleComputerUse} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 3, borderWidth: 1, borderColor: '#ef4444' }}>
            <Text style={{ color: '#ef4444', fontSize: 10, fontWeight: '900', fontFamily: MONO }}>DISABLE</Text>
          </Pressable>
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <Pressable onPress={() => setComposerOpen(v => !v)} style={btnStyle(computerUseOn ? 'warn' : 'primary')}>
          <Text style={btnText(computerUseOn ? 'warn' : 'primary')}>
            {composerOpen ? '× CLOSE' : computerUseOn ? '⏵ RUN SHELL' : '⏵ SEND TASK'}
          </Text>
        </Pressable>
        <Pressable onPress={handleTogglePause} style={btnStyle(isPaused ? 'primary' : 'ghost')}>
          <Text style={btnText(isPaused ? 'primary' : 'ghost')}>{isPaused ? '▶ RESUME' : '‖ PAUSE'}</Text>
        </Pressable>
        {canUseShell && (
          <Pressable onPress={handleToggleComputerUse} style={btnStyle(computerUseOn ? 'warn' : 'ghost')}>
            <Text style={btnText(computerUseOn ? 'warn' : 'ghost')}>{computerUseOn ? '⚠ SHELL ON' : '⚠ SHELL'}</Text>
          </Pressable>
        )}
        <Pressable onPress={handleCopySession} style={btnStyle('ghost')}>
          <Text style={btnText('ghost')}>⎘ SESSION</Text>
        </Pressable>
      </View>

      {composerOpen && (
        <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#262626', borderRadius: 4, padding: 10, gap: 8 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={computerUseOn && canUseShell ? 'Shell command · runs on your machine' : `Tell ${agent.name} what to do…`}
            placeholderTextColor="#606075"
            multiline
            autoFocus
            style={{
              color: '#f3f3f8',
              fontSize: 13,
              fontFamily: MONO,
              minHeight: 56,
              padding: 8,
              backgroundColor: '#000',
              borderRadius: 3,
              borderWidth: 1,
              borderColor: '#1a1a28',
              ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
            }}
            onSubmitEditing={handleSend}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ color: computerUseOn && canUseShell ? '#ef4444' : '#606075', fontSize: 10, fontFamily: MONO }}>
              {computerUseOn && canUseShell
                ? 'Shell on your machine · logged to activity'
                : onRunCommand ? 'Routes through the bridge' : 'Queues to activity feed'}
            </Text>
            <Pressable onPress={handleSend} disabled={sending || !draft.trim()} style={[btnStyle('primary'), { flex: 0, paddingHorizontal: 14, opacity: sending || !draft.trim() ? 0.5 : 1 }]}>
              <Text style={btnText('primary')}>{sending ? 'SENDING…' : 'DISPATCH ⏎'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {toast && (
        <View style={{ backgroundColor: '#141418', borderWidth: 1, borderColor: '#262626', borderRadius: 3, paddingHorizontal: 10, paddingVertical: 6 }}>
          <Text style={{ color: '#d6d6e1', fontSize: 11, fontFamily: MONO }}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

// ─── Live "Now Doing" panel ─────────────────────────────────────────────────
// Replaces the static CURRENT OBJECTIVE / CURRENT EXECUTION block. Reads the
// rich live fields already populated by the bridge pollers — currentToolName,
// currentToolFile, activeFiles, recentToolCalls — and renders them as a live
// cockpit. Also computes a rough token-burn sparkline from the running
// counters so you can see when the agent is actually working.

function NowDoingPanel({ agent, currentObjective }: { agent: OfficeAgent; currentObjective: string }) {
  const [burnSamples, setBurnSamples] = useState<Array<{ t: number; tokens: number }>>(() => [{ t: Date.now(), tokens: agent.tokensUsed || 0 }]);

  // Sample tokens-used every 10s so we can draw a 30-minute rolling sparkline
  // without hitting the DB. The state pairs (ts, cumulative tokens) and the
  // per-sample delta becomes the burn rate for that slot.
  useEffect(() => {
    setBurnSamples(prev => {
      const next = [...prev, { t: Date.now(), tokens: agent.tokensUsed || 0 }];
      const cutoff = Date.now() - 30 * 60_000;
      return next.filter(s => s.t >= cutoff).slice(-60);
    });
  }, [agent.tokensUsed]);

  const recentCalls = (agent.recentToolCalls || []).slice(-5).reverse();
  const activeFiles = agent.activeFiles || [];
  const isWorking = agent.status === 'active' || agent.status === 'building' || !!agent.currentToolName;
  const dotColor = isWorking ? '#22c55e' : '#606075';
  const burnRate = computeBurnRate(burnSamples);

  return (
    <View style={{ backgroundColor: '#0a0a10', borderWidth: 1, borderColor: isWorking ? '#22c55e40' : '#1a1a28', borderRadius: 3, padding: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor }} />
        <Text style={{ color: isWorking ? '#22c55e' : '#909098', fontSize: 11, fontWeight: '800', letterSpacing: 1.2, fontFamily: MONO }}>
          NOW DOING
        </Text>
        {burnRate > 0 && (
          <Text style={{ color: '#d6d6e1', fontSize: 10, fontWeight: '700', fontFamily: MONO, marginLeft: 'auto' }}>
            {burnRate >= 1000 ? `${(burnRate / 1000).toFixed(1)}k` : burnRate} tok/min
          </Text>
        )}
      </View>

      {agent.currentToolName || agent.currentToolFile ? (
        <View style={{ borderRadius: 3, padding: 10, backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28' }}>
          <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '800', fontFamily: MONO }}>
            ⏵ {agent.currentToolName || 'Running'}
          </Text>
          {agent.currentToolFile && (
            <Text style={{ color: '#d6d6e1', fontSize: 11, fontFamily: MONO, marginTop: 4 }} numberOfLines={1}>
              {shortPath(agent.currentToolFile)}
            </Text>
          )}
        </View>
      ) : (
        <Text style={{ color: '#808090', fontSize: 13, lineHeight: 18 }}>{currentObjective}</Text>
      )}

      {recentCalls.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: '#606075', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: MONO }}>RECENT TOOL CALLS</Text>
          {recentCalls.map((call, i) => (
            <View key={`${call.ts}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
              <Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO, width: 44 }} numberOfLines={1}>
                {formatRelativeTime(call.ts)}
              </Text>
              <Text style={{ color: '#a8a8b8', fontSize: 11, fontWeight: '700', fontFamily: MONO, width: 80 }} numberOfLines={1}>
                {call.tool}
              </Text>
              <Text style={{ color: '#606075', fontSize: 11, fontFamily: MONO, flex: 1 }} numberOfLines={1}>
                {call.file ? shortPath(call.file) : '—'}
              </Text>
            </View>
          ))}
        </View>
      )}

      {activeFiles.length > 0 && (
        <View style={{ gap: 4 }}>
          <Text style={{ color: '#606075', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: MONO }}>
            ACTIVE FILES · {activeFiles.length}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {activeFiles.slice(0, 6).map(f => (
              <View key={f} style={{ paddingHorizontal: 6, paddingVertical: 3, borderRadius: 3, borderWidth: 1, borderColor: '#1a1a28', backgroundColor: '#0f0f18' }}>
                <Text style={{ color: '#d6d6e1', fontSize: 10, fontFamily: MONO }} numberOfLines={1}>{f.split('/').pop() || f}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

function computeBurnRate(samples: Array<{ t: number; tokens: number }>): number {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const deltaTokens = Math.max(0, last.tokens - first.tokens);
  const deltaMinutes = (last.t - first.t) / 60_000;
  if (deltaMinutes < 0.25) return 0;
  return Math.round(deltaTokens / deltaMinutes);
}

type SyncState = 'loading' | 'fresh' | 'stale' | 'cold' | 'empty' | 'error';
interface MemorySyncStatus {
  state: SyncState;
  lastSavedAt: string | null;
  color: string;
  label: string;
  detail: string;
}

/**
 * Reports the real "last memory write" signal for the (circle, user) pair so
 * the Overview tab can show whether memory sync is actually happening vs. just
 * claiming "every 30s" regardless of backend health.
 *
 * Polls every 15s. Buckets:
 *   < 2 min   → fresh (green)
 *   < 15 min  → stale (yellow)
 *   older     → cold  (gray)
 *   no rows   → empty
 *   query err → error (red) — surfaces RLS / network problems
 */
function useMemorySyncStatus(circleId: string | undefined, userId: string | null): MemorySyncStatus {
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [state, setState] = useState<SyncState>('loading');

  useEffect(() => {
    if (!circleId || !userId) {
      setState('loading');
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const { data, error } = await supabase
          .from('memory_entries')
          .select('updated_at')
          .eq('circle_id', circleId)
          .eq('user_id', userId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled) return;
        if (error) {
          setState('error');
          return;
        }
        if (!data) {
          setLastSavedAt(null);
          setState('empty');
          return;
        }
        const ageMs = Date.now() - new Date(data.updated_at).getTime();
        setLastSavedAt(data.updated_at);
        if (ageMs < 2 * 60 * 1000) setState('fresh');
        else if (ageMs < 15 * 60 * 1000) setState('stale');
        else setState('cold');
      } catch (err) {
        if (cancelled) return;
        console.warn('[AgentOverviewPanel] Memory sync probe failed:', err);
        setState('error');
      }
    };
    void tick();
    const id = setInterval(tick, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [circleId, userId]);

  if (state === 'fresh') return { state, lastSavedAt, color: '#22c55e', label: 'SYNCED', detail: lastSavedAt ? formatRelativeTime(lastSavedAt) : 'just now' };
  if (state === 'stale') return { state, lastSavedAt, color: '#f59e0b', label: 'STALE', detail: `last sync ${formatRelativeTime(lastSavedAt || undefined)}` };
  if (state === 'cold') return { state, lastSavedAt, color: '#6b7280', label: 'IDLE', detail: `last sync ${formatRelativeTime(lastSavedAt || undefined)}` };
  if (state === 'empty') return { state, lastSavedAt: null, color: '#6b7280', label: 'EMPTY', detail: 'no memories saved yet' };
  if (state === 'error') return { state, lastSavedAt: null, color: '#ef4444', label: 'ERROR', detail: 'sync check failed — check RLS' };
  return { state: 'loading', lastSavedAt: null, color: '#3a3a4e', label: 'CHECKING', detail: 'probing memory sync…' };
}

export default function AgentOverviewPanel({
  agent,
  circleId,
  userId,
  statusColor,
  statusLabel,
  onClose,
  onRenameAgent,
  onAgentIdentityChange,
  onRunCommand,
}: {
  agent: OfficeAgent;
  circleId?: string;
  userId?: string | null;
  statusColor: string;
  statusLabel: string;
  onClose: () => void;
  onRenameAgent?: (agent: OfficeAgent, newName: string) => Promise<void> | void;
  onAgentIdentityChange?: () => void;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
}) {
  const memorySync = useMemorySyncStatus(circleId, userId || null);
  const [renamingAgent, setRenamingAgent] = useState(false);
  const [agentNameDraft, setAgentNameDraft] = useState('');
  const [isMainAgent, setIsMainAgent] = useState(false);

  const sessionKey = useMemo(
    () => getAgentIdentityKey(agent),
    [agent],
  );
  const control = useAgentControl(circleId, sessionKey);
  const providerMeta = PROVIDER_META[agent.providerType];
  const health = getAgentHealth(agent);

  useEffect(() => {
    setRenamingAgent(false);
    setAgentNameDraft('');
    setIsMainAgent(false);
  }, [agent.id]);

  useEffect(() => {
    let cancelled = false;
    import('../../../../lib/agentIdentity')
      .then(({ loadAgentIdentities }) => loadAgentIdentities())
      .then(ids => {
        if (cancelled) return;
        const identity = ids.get(sessionKey);
        setIsMainAgent(identity?.isPrimary === true);
      })
      .catch(err => console.warn('[AgentOverviewPanel] Failed to load identities:', err));
    return () => { cancelled = true; };
  }, [sessionKey]);

  const currentObjective = agent.lastUserMessage || agent.activity || 'No current task captured yet.';
  const activeFileCount = agent.activeFiles?.length || 0;
  const projectLabel = agent.projectDir ? shortPath(agent.projectDir) : 'No active project detected';

  const readinessCards = [
    { label: 'Role', value: agent.role || 'Unassigned', color: '#d4d4de' },
    { label: 'Provider', value: providerMeta?.label || agent.providerType, color: providerMeta?.color || '#9ca3af' },
    { label: 'Model', value: agent.model !== 'unknown' ? agent.model : 'Unknown', color: '#818cf8' },
    { label: 'Project', value: projectLabel, color: '#22c55e' },
  ];

  return (
    <View nativeID="section-agent-overview" style={{ paddingHorizontal: 12, gap: 20, paddingBottom: 20 }}>
      <QuickActionsStrip
        agent={agent}
        circleId={circleId}
        sessionKey={sessionKey}
        isPaused={!!control?.is_paused}
        onRunCommand={onRunCommand}
      />
      <View style={{ backgroundColor: '#0a0a10', borderWidth: 2, borderColor: statusColor + '45', borderRadius: 3, padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: statusColor }} />
          <Text style={{ color: statusColor, fontSize: 16, fontWeight: '800', fontFamily: MONO, letterSpacing: 1 }}>{statusLabel}</Text>
          <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, marginLeft: 'auto' }}>{formatRelativeTime(agent.lastActive)}</Text>
        </View>

        <Text style={{ color: '#f3f3f8', fontSize: 18, fontWeight: '700', marginBottom: 4 }}>{health.label}</Text>
        <Text style={{ color: '#a3a3b6', fontSize: 13, lineHeight: 19 }}>{health.detail}</Text>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <View style={{ backgroundColor: '#12121b', borderWidth: 1, borderColor: '#232334', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#d6d6e1', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>SESSION {sessionKey}</Text>
          </View>
          <View style={{ backgroundColor: '#12121b', borderWidth: 1, borderColor: '#232334', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
            <Text style={{ color: '#d6d6e1', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{activeFileCount} ACTIVE FILES</Text>
          </View>
          {agent.subagentCount ? (
            <View style={{ backgroundColor: '#12121b', borderWidth: 1, borderColor: '#232334', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ color: '#d6d6e1', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{agent.subagentCount} SUB-AGENTS</Text>
            </View>
          ) : null}
        </View>
      </View>

      <NowDoingPanel agent={agent} currentObjective={currentObjective} />


      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <View style={{ height: 1, flex: 1, backgroundColor: '#1a1a28' }} />
        <Text style={{ color: '#606075', fontSize: 10, fontWeight: '700', letterSpacing: 2, fontFamily: MONO }}>IDENTITY</Text>
        <View style={{ height: 1, flex: 1, backgroundColor: '#1a1a28' }} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {readinessCards.map(card => (
          <View key={card.label} style={{ width: '48%', backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 3, padding: 12 }}>
            <Text style={{ color: '#808090', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO }}>{card.label.toUpperCase()}</Text>
            <Text style={{ color: card.color, fontSize: 14, fontWeight: '700', fontFamily: MONO, marginTop: 4 }} numberOfLines={2}>{card.value}</Text>
          </View>
        ))}
      </View>

      {['claude-code', 'cursor', 'codex', 'gemini'].includes(agent.providerType) && (
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <View style={{ height: 1, flex: 1, backgroundColor: '#1a1a28' }} />
            <Text style={{ color: '#606075', fontSize: 10, fontWeight: '700', letterSpacing: 2, fontFamily: MONO }}>AGENT SETTINGS</Text>
            <View style={{ height: 1, flex: 1, backgroundColor: '#1a1a28' }} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#0a0a10', borderWidth: 1, borderColor: memorySync.color + '30', borderRadius: 3, padding: 10 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: memorySync.color }} />
            <Text style={{ color: memorySync.color, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO }}>
              MEMORY SYNC {memorySync.label}
            </Text>
            <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, marginLeft: 'auto' }}>{memorySync.detail}</Text>
          </View>

          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO }}>AGENT NAME</Text>
              {renamingAgent ? (
                <View style={{ flexDirection: 'row', flex: 1, gap: 4 }}>
                  <TextInput
                    value={agentNameDraft}
                    onChangeText={setAgentNameDraft}
                    placeholder={agent.name}
                    placeholderTextColor="#606075"
                    autoFocus
                    style={{ flex: 1, color: '#f0f0f5', fontSize: 13, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, paddingHorizontal: 10, paddingVertical: 5, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any}
                    onSubmitEditing={async () => {
                      if (agentNameDraft.trim()) {
                        if (onRenameAgent) await onRenameAgent(agent, agentNameDraft.trim());
                        else {
                          const { renameAgent } = await import('../../../../lib/agentIdentity');
                          await renameAgent(sessionKey, agentNameDraft.trim());
                        }
                        onAgentIdentityChange?.();
                      }
                      setRenamingAgent(false);
                    }}
                  />
                  <Pressable onPress={() => setRenamingAgent(false)} style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }}>
                    <Text style={{ color: '#909098', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => { setAgentNameDraft(agent.name); setRenamingAgent(true); }} style={[{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
                  <Text style={{ color: '#a0a0b0', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>Rename</Text>
                </Pressable>
              )}
            </View>

            <Pressable
              onPress={async () => {
                const { setMainAgentForProvider } = await import('../../../../lib/agentIdentity');
                await setMainAgentForProvider(sessionKey, agent.providerType);
                setIsMainAgent(true);
                onAgentIdentityChange?.();
              }}
              style={[{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: isMainAgent ? agent.color + '20' : '#0a0a10',
                borderWidth: 1, borderColor: isMainAgent ? agent.color + '60' : '#1a1a28',
                borderRadius: 3, padding: 10,
              }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={{ fontSize: 13 }}>{isMainAgent ? '\u2605' : '\u2606'}</Text>
              <Text style={{ color: isMainAgent ? agent.color : '#606075', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO }}>
                {isMainAgent ? 'MAIN PIXEL AGENT' : 'SET AS MAIN PIXEL AGENT'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {circleId && sessionKey && (
        <View nativeID="section-agent-controls">
          <AgentControlCard
            agent={agent}
            circleId={circleId}
            control={control}
            onClose={() => {}}
            onOpenPanel={() => {}}
            onDisconnect={onClose}
            onRunCommand={onRunCommand}
            embedded
          />
        </View>
      )}
    </View>
  );
}
