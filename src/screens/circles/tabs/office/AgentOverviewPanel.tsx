import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AgentControlCard from '../../../../components/AgentControlCard';
import {
  getAgentIdentityKey,
  loadAgentIdentitiesExact,
  renameAgentExact,
  setMainAgentForProviderExact,
  type AgentIdentityExactAuthority,
} from '../../../../lib/agentIdentity';
import { PROVIDER_META } from '../../../../lib/connectionManager';
import { OfficeAgent } from '../../../../lib/officeAgents';
import { upsertAgentControl, useAgentControl } from '../../../../services/hitlService';
import { supabase } from '../../../../lib/supabase';
import { formatRelativeTime, MONO, shortPath } from './AgentPanelShared';

// ─── Quick Actions strip ────────────────────────────────────────────────────
// Top-of-console action row. The Overview surface exposes only the bridge's
// read-only diagnostic allowlist; real task handoffs belong to Chat, the
// OpenSwan tab, or the Terminal tab where identity and receipt semantics are
// explicit. Pause/Resume toggles agent_controls.is_paused. Copy Session pulls
// the exact key into the clipboard for terminal/runtime inspection.

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
  const [controlBusy, setControlBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canRunDiagnostics = agent.providerType === 'claude-code' && !!onRunCommand;

  const showToast = (msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 2400);
  };

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      if (canRunDiagnostics && onRunCommand) {
        const res = await onRunCommand(text);
        const output = String(res.stdout || res.stderr || '').trim().slice(0, 100);
        showToast(res.ok ? (output || 'Diagnostic completed') : (output || 'Diagnostic failed'));
      } else {
        showToast('Use Chat, OpenSwan, or Terminal to send this agent a task');
      }
      setDraft('');
      setComposerOpen(false);
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Diagnostic failed');
    } finally {
      setSending(false);
    }
  };

  const handleTogglePause = async () => {
    if (controlBusy) return;
    setControlBusy(true);
    try {
      if (!circleId) {
        showToast('No circle context available');
        return;
      }
      await upsertAgentControl(circleId, sessionKey, agent.name, { is_paused: !isPaused });
      showToast(isPaused ? 'Resumed' : 'Paused');
    } catch (error: unknown) {
      showToast(error instanceof Error ? error.message : 'Status update failed');
    } finally {
      setControlBusy(false);
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

  const accentColor = agent.color || '#6366f1';

  return (
    <View style={overviewStyles.actionsBlock}>
      <View style={overviewStyles.actionsRow}>
        {canRunDiagnostics ? (
          <Pressable
            onPress={() => setComposerOpen(value => !value)}
            accessibilityRole="button"
            accessibilityLabel={composerOpen ? 'Close diagnostics' : 'Open read-only diagnostics'}
            accessibilityState={{ expanded: composerOpen }}
            style={[overviewStyles.actionButton, { borderColor: accentColor + '55', backgroundColor: accentColor + '14' }]}
          >
            <Text style={[overviewStyles.actionButtonText, { color: accentColor }]}>{composerOpen ? 'Close diagnostics' : 'Diagnostics'}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={handleTogglePause}
          disabled={controlBusy}
          accessibilityRole="button"
          accessibilityLabel={isPaused ? `Resume ${agent.name}` : `Pause ${agent.name}`}
          accessibilityState={{ disabled: controlBusy, busy: controlBusy }}
          style={[overviewStyles.actionButton, controlBusy && overviewStyles.actionButtonDisabled]}
        >
          <Text style={overviewStyles.actionButtonText}>{controlBusy ? 'Updating…' : isPaused ? 'Resume' : 'Pause'}</Text>
        </Pressable>
        <Pressable
          onPress={handleCopySession}
          accessibilityRole="button"
          accessibilityLabel="Copy session key"
          accessibilityHint="Copies the exact runtime session identifier."
          style={overviewStyles.actionButton}
        >
          <Text style={overviewStyles.actionButtonText}>Copy session</Text>
        </Pressable>
      </View>

      {composerOpen && (
        <View style={overviewStyles.diagnosticComposer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Read-only command · e.g. git status"
            placeholderTextColor="#606075"
            multiline
            autoFocus
            accessibilityLabel="Read-only diagnostic command"
            style={overviewStyles.diagnosticInput}
            onSubmitEditing={handleSend}
          />
          <View style={overviewStyles.diagnosticFooter}>
            <Text style={overviewStyles.diagnosticHint}>
              Claude bridge read-only diagnostic allowlist
            </Text>
            <Pressable
              onPress={handleSend}
              disabled={sending || !draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Run read-only diagnostic"
              accessibilityState={{ disabled: sending || !draft.trim(), busy: sending }}
              style={[
                overviewStyles.runDiagnosticButton,
                { backgroundColor: accentColor },
                (sending || !draft.trim()) && overviewStyles.actionButtonDisabled,
              ]}
            >
              <Text style={overviewStyles.runDiagnosticButtonText}>{sending ? 'Running…' : 'Run'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {toast && (
        <View style={overviewStyles.notice} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={overviewStyles.noticeText}>{toast}</Text>
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
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Record a sample when the bridge counter advances so we can draw a
  // 30-minute rolling sparkline without introducing another timer or DB read.
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
  const dotColor = isWorking ? '#3fb950' : '#484f58';
  const burnRate = computeBurnRate(burnSamples);
  const hasEvidence = recentCalls.length > 0 || activeFiles.length > 0 || burnRate > 0;

  return (
    <View style={[overviewStyles.currentWork, isWorking && overviewStyles.currentWorkActive]}>
      <View style={overviewStyles.currentWorkHeader}>
        <View style={[overviewStyles.currentWorkDot, { backgroundColor: dotColor }]} />
        <Text style={overviewStyles.currentWorkTitle}>Current work</Text>
        <Text style={overviewStyles.currentWorkState}>{isWorking ? 'Working' : 'Standing by'}</Text>
      </View>

      {agent.currentToolName || agent.currentToolFile ? (
        <View style={overviewStyles.currentTool}>
          <Text style={overviewStyles.currentToolName}>
            {agent.currentToolName || 'Running'}
          </Text>
          {agent.currentToolFile && (
            <Text style={overviewStyles.currentToolFile} numberOfLines={1}>
              {shortPath(agent.currentToolFile)}
            </Text>
          )}
        </View>
      ) : (
        <Text style={overviewStyles.currentObjective}>{currentObjective}</Text>
      )}

      {hasEvidence ? (
        <>
          <Pressable
            onPress={() => setDetailsOpen(value => !value)}
            accessibilityRole="button"
            accessibilityLabel={detailsOpen ? 'Hide current work evidence' : 'Show current work evidence'}
            accessibilityState={{ expanded: detailsOpen }}
            style={overviewStyles.inlineDisclosure}
          >
            <Text style={overviewStyles.inlineDisclosureText}>{detailsOpen ? 'Hide evidence' : 'Show evidence'}</Text>
            {burnRate > 0 ? (
              <Text style={overviewStyles.burnRate}>{burnRate >= 1000 ? `${(burnRate / 1000).toFixed(1)}k` : burnRate} tokens/min</Text>
            ) : null}
          </Pressable>
          {detailsOpen ? (
            <View style={overviewStyles.workEvidence}>
              {recentCalls.length > 0 ? (
                <View style={overviewStyles.evidenceGroup}>
                  <Text style={overviewStyles.evidenceLabel}>Recent tools</Text>
                  {recentCalls.map((call, index) => (
                    <View key={`${call.ts}-${index}`} style={overviewStyles.toolCallRow}>
                      <Text style={overviewStyles.toolCallTime} numberOfLines={1}>{formatRelativeTime(call.ts)}</Text>
                      <Text style={overviewStyles.toolCallName} numberOfLines={1}>{call.tool}</Text>
                      <Text style={overviewStyles.toolCallFile} numberOfLines={1}>{call.file ? shortPath(call.file) : 'No file'}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {activeFiles.length > 0 ? (
                <View style={overviewStyles.evidenceGroup}>
                  <Text style={overviewStyles.evidenceLabel}>Active files · {activeFiles.length}</Text>
                  <View style={overviewStyles.fileList}>
                    {activeFiles.slice(0, 6).map(file => (
                      <View key={file} style={overviewStyles.fileChip}>
                        <Text style={overviewStyles.fileChipText} numberOfLines={1}>{file.split('/').pop() || file}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
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
 * Reads immediately, then refreshes every two minutes while Overview is
 * mounted. Memory freshness changes on minute-scale buckets, so a tighter
 * background query adds load without changing the operator decision.
 * Buckets:
 *   < 2 min   → fresh (green)
 *   < 15 min  → stale (yellow)
 *   older     → cold  (gray)
 *   no rows   → empty
 *   query err → error (red) — surfaces RLS / network problems
 */
function normalizeIdentityAuthority(
  circleId: string | undefined,
  authority: AgentIdentityExactAuthority | null | undefined,
): AgentIdentityExactAuthority | null {
  const userId = authority?.userId?.trim();
  const authorityCircleId = authority?.circleId?.trim();
  const accessToken = authority?.accessToken?.trim();
  if (!circleId || !userId || authorityCircleId !== circleId || !accessToken) return null;
  return { userId, circleId: authorityCircleId, accessToken };
}

function useMemorySyncStatus(
  circleId: string | undefined,
  identityAuthority: AgentIdentityExactAuthority | null,
): MemorySyncStatus {
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [state, setState] = useState<SyncState>('loading');
  const userId = identityAuthority?.userId || null;
  const accessToken = identityAuthority?.accessToken || null;

  useEffect(() => {
    if (!circleId || !userId || !accessToken) {
      setLastSavedAt(null);
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
          .maybeSingle()
          .setHeader('Authorization', `Bearer ${accessToken}`);
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
    const id = setInterval(tick, 120_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [accessToken, circleId, userId]);

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
  identityAuthority,
  onClose,
  onRenameAgent,
  onAgentIdentityChange,
  onRunCommand,
}: {
  agent: OfficeAgent;
  circleId?: string;
  identityAuthority?: AgentIdentityExactAuthority | null;
  onClose: () => void;
  onRenameAgent?: (agent: OfficeAgent, newName: string) => Promise<void> | void;
  onAgentIdentityChange?: () => void;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
}) {
  const exactIdentityAuthority = useMemo(
    () => normalizeIdentityAuthority(circleId, identityAuthority),
    [circleId, identityAuthority?.accessToken, identityAuthority?.circleId, identityAuthority?.userId],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const memorySync = useMemorySyncStatus(circleId, detailsOpen ? exactIdentityAuthority : null);
  const [renamingAgent, setRenamingAgent] = useState(false);
  const [agentNameDraft, setAgentNameDraft] = useState('');
  const [isMainAgent, setIsMainAgent] = useState(false);

  const sessionKey = useMemo(
    () => getAgentIdentityKey(agent),
    [agent],
  );
  const identityRequestKey = exactIdentityAuthority
    ? `${exactIdentityAuthority.userId}\u0000${exactIdentityAuthority.circleId}\u0000${agent.id}\u0000${sessionKey}`
    : '';
  const latestIdentityRequestKeyRef = useRef(identityRequestKey);
  const latestIdentityAccessTokenRef = useRef(exactIdentityAuthority?.accessToken || '');
  latestIdentityRequestKeyRef.current = identityRequestKey;
  latestIdentityAccessTokenRef.current = exactIdentityAuthority?.accessToken || '';
  const control = useAgentControl(circleId, sessionKey);
  const providerMeta = PROVIDER_META[agent.providerType];

  useEffect(() => {
    setDetailsOpen(false);
    setRenamingAgent(false);
    setAgentNameDraft('');
    setIsMainAgent(false);
  }, [agent.id, identityRequestKey]);

  useEffect(() => {
    setIsMainAgent(false);
    if (!detailsOpen || !exactIdentityAuthority || !identityRequestKey) return;
    let cancelled = false;
    const capturedRequestKey = identityRequestKey;
    loadAgentIdentitiesExact(exactIdentityAuthority)
      .then(ids => {
        if (
          cancelled
          || latestIdentityRequestKeyRef.current !== capturedRequestKey
          || latestIdentityAccessTokenRef.current !== exactIdentityAuthority.accessToken
        ) return;
        const identity = ids.get(sessionKey);
        setIsMainAgent(identity?.isPrimary === true);
      })
      .catch(err => console.warn('[AgentOverviewPanel] Failed to load identities:', err));
    return () => { cancelled = true; };
  }, [detailsOpen, exactIdentityAuthority, identityRequestKey, sessionKey]);

  const currentObjective = agent.lastUserMessage || agent.activity || 'No current task captured yet.';
  const projectLabel = agent.projectDir ? shortPath(agent.projectDir) : 'No active project detected';

  const readinessCards = [
    { label: 'Role', value: agent.role || 'Unassigned' },
    { label: 'Provider', value: providerMeta?.label || agent.providerType },
    { label: 'Model', value: agent.model !== 'unknown' ? agent.model : 'Unknown' },
    { label: 'Project', value: projectLabel },
  ];
  const detailsSummary = [
    providerMeta?.label || agent.providerType,
    agent.model !== 'unknown' ? agent.model : null,
    formatRelativeTime(agent.lastActive),
  ].filter((value): value is string => !!value).join(' · ');

  return (
    <View nativeID="section-agent-overview" style={overviewStyles.container}>
      <QuickActionsStrip
        agent={agent}
        circleId={circleId}
        sessionKey={sessionKey}
        isPaused={!!control?.is_paused}
        onRunCommand={onRunCommand}
      />
      <NowDoingPanel agent={agent} currentObjective={currentObjective} />

      {circleId && sessionKey && (
        <View nativeID="section-agent-controls" style={overviewStyles.connectionSummary}>
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

      <Pressable
        onPress={() => setDetailsOpen(value => !value)}
        accessibilityRole="button"
        accessibilityLabel={detailsOpen ? 'Hide agent details' : 'Show agent details'}
        accessibilityState={{ expanded: detailsOpen }}
        style={overviewStyles.detailsDisclosure}
      >
        <View style={overviewStyles.detailsDisclosureCopy}>
          <Text style={overviewStyles.detailsDisclosureTitle}>Agent details</Text>
          <Text style={overviewStyles.detailsDisclosureSummary} numberOfLines={1}>{detailsSummary}</Text>
        </View>
        <Text style={overviewStyles.detailsDisclosureAction}>{detailsOpen ? 'Hide' : 'Show'}</Text>
      </Pressable>

      {detailsOpen ? (
        <View style={overviewStyles.detailsPanel}>
          <View style={overviewStyles.detailsList}>
            {readinessCards.map(item => (
              <View key={item.label} style={overviewStyles.detailRow}>
                <Text style={overviewStyles.detailLabel}>{item.label}</Text>
                <Text style={overviewStyles.detailValue} numberOfLines={2}>{item.value}</Text>
              </View>
            ))}
            <View style={overviewStyles.detailRow}>
              <Text style={overviewStyles.detailLabel}>Session</Text>
              <Text style={[overviewStyles.detailValue, overviewStyles.sessionValue]} numberOfLines={1} selectable>{sessionKey}</Text>
            </View>
          </View>

          {['claude-code', 'cursor', 'codex', 'gemini'].includes(agent.providerType) ? (
            <View style={overviewStyles.settingsSection}>
              <Text style={overviewStyles.settingsTitle}>Preferences</Text>
              <View style={[overviewStyles.memoryStatus, { borderColor: memorySync.color + '38' }]}>
                <View style={[overviewStyles.memoryStatusDot, { backgroundColor: memorySync.color }]} />
                <View style={overviewStyles.memoryStatusCopy}>
                  <Text style={overviewStyles.memoryStatusTitle}>Memory {memorySync.label.toLowerCase()}</Text>
                  <Text style={overviewStyles.memoryStatusDetail}>{memorySync.detail}</Text>
                </View>
              </View>

              <View style={overviewStyles.settingRow}>
                <View style={overviewStyles.settingCopy}>
                  <Text style={overviewStyles.settingLabel}>Agent name</Text>
                  <Text style={overviewStyles.settingDescription}>Used across your private Office identity.</Text>
                </View>
                {renamingAgent ? (
                  <View style={overviewStyles.renameEditor}>
                    <TextInput
                      value={agentNameDraft}
                      onChangeText={setAgentNameDraft}
                      placeholder={agent.name}
                      placeholderTextColor="#484f58"
                      autoFocus
                      accessibilityLabel="Agent name"
                      style={overviewStyles.renameInput}
                      onSubmitEditing={async () => {
                        const cleanName = agentNameDraft.trim();
                        const capturedAuthority = exactIdentityAuthority;
                        const capturedRequestKey = identityRequestKey;
                        if (cleanName && capturedAuthority && capturedRequestKey) {
                          if (onRenameAgent) {
                            await onRenameAgent(agent, cleanName);
                          } else {
                            const receipt = await renameAgentExact(sessionKey, cleanName, capturedAuthority);
                            if (!receipt.localSaved) return;
                          }
                          if (
                            latestIdentityRequestKeyRef.current !== capturedRequestKey
                            || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
                          ) return;
                          onAgentIdentityChange?.();
                        }
                        if (
                          latestIdentityRequestKeyRef.current === capturedRequestKey
                          && latestIdentityAccessTokenRef.current === capturedAuthority?.accessToken
                        ) setRenamingAgent(false);
                      }}
                    />
                    <Pressable
                      onPress={() => setRenamingAgent(false)}
                      accessibilityRole="button"
                      accessibilityLabel="Cancel rename"
                      style={overviewStyles.smallButton}
                    >
                      <Text style={overviewStyles.smallButtonText}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    disabled={!exactIdentityAuthority}
                    onPress={() => {
                      if (!exactIdentityAuthority) return;
                      setAgentNameDraft(agent.name);
                      setRenamingAgent(true);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Rename ${agent.name}`}
                    accessibilityState={{ disabled: !exactIdentityAuthority }}
                    style={[overviewStyles.smallButton, !exactIdentityAuthority && overviewStyles.actionButtonDisabled]}
                  >
                    <Text style={overviewStyles.smallButtonText}>Rename</Text>
                  </Pressable>
                )}
              </View>

              <Pressable
                onPress={async () => {
                  const capturedAuthority = exactIdentityAuthority;
                  const capturedRequestKey = identityRequestKey;
                  if (!capturedAuthority || !capturedRequestKey) return;
                  const receipt = await setMainAgentForProviderExact(sessionKey, agent.providerType, capturedAuthority);
                  if (
                    !receipt.localSaved
                    || latestIdentityRequestKeyRef.current !== capturedRequestKey
                    || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
                  ) return;
                  setIsMainAgent(true);
                  onAgentIdentityChange?.();
                }}
                disabled={!exactIdentityAuthority || isMainAgent}
                accessibilityRole="button"
                accessibilityLabel={isMainAgent ? `${agent.name} is the main Office agent` : `Set ${agent.name} as the main Office agent`}
                accessibilityState={{ disabled: !exactIdentityAuthority || isMainAgent, selected: isMainAgent }}
                style={[
                  overviewStyles.primaryAgentButton,
                  isMainAgent && { borderColor: agent.color + '55', backgroundColor: agent.color + '12' },
                  (!exactIdentityAuthority || isMainAgent) && overviewStyles.actionButtonDisabled,
                ]}
              >
                <View style={[overviewStyles.primaryAgentMarker, { backgroundColor: isMainAgent ? agent.color : '#484f58' }]} />
                <Text style={overviewStyles.primaryAgentText}>{isMainAgent ? 'Main Office agent' : 'Set as main Office agent'}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const overviewStyles = StyleSheet.create({
  container: {
    gap: 12,
    paddingBottom: 8,
  },
  actionsBlock: {
    gap: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    flexGrow: 1,
    minWidth: 108,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  actionButtonText: {
    color: '#e6edf3',
    fontSize: 13,
    fontWeight: '600',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  diagnosticComposer: {
    gap: 10,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
  },
  diagnosticInput: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#010409',
    color: '#e6edf3',
    fontSize: 13,
    fontFamily: MONO,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  } as any,
  diagnosticFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  diagnosticHint: {
    color: '#8b949e',
    fontSize: 11,
    flex: 1,
    minWidth: 180,
  },
  runDiagnosticButton: {
    minHeight: 44,
    minWidth: 76,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  runDiagnosticButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  notice: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
  },
  noticeText: {
    color: '#e6edf3',
    fontSize: 12,
  },
  currentWork: {
    gap: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
  },
  currentWorkActive: {
    borderColor: '#3fb95045',
  },
  currentWorkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  currentWorkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  currentWorkTitle: {
    color: '#e6edf3',
    fontSize: 14,
    fontWeight: '600',
  },
  currentWorkState: {
    marginLeft: 'auto',
    color: '#8b949e',
    fontSize: 12,
  },
  currentTool: {
    gap: 4,
    padding: 10,
    borderRadius: 6,
    backgroundColor: '#0d1117',
  },
  currentToolName: {
    color: '#e6edf3',
    fontSize: 13,
    fontWeight: '600',
  },
  currentToolFile: {
    color: '#8b949e',
    fontSize: 11,
    fontFamily: MONO,
  },
  currentObjective: {
    color: '#8b949e',
    fontSize: 13,
    lineHeight: 19,
  },
  inlineDisclosure: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'stretch',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  inlineDisclosureText: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '600',
  },
  burnRate: {
    marginLeft: 'auto',
    color: '#8b949e',
    fontSize: 11,
  },
  workEvidence: {
    gap: 12,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: '#21262d',
  },
  evidenceGroup: {
    gap: 6,
  },
  evidenceLabel: {
    color: '#8b949e',
    fontSize: 11,
    fontWeight: '600',
  },
  toolCallRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 24,
  },
  toolCallTime: {
    width: 52,
    color: '#8b949e',
    fontSize: 10,
    fontFamily: MONO,
  },
  toolCallName: {
    width: 96,
    color: '#e6edf3',
    fontSize: 11,
    fontFamily: MONO,
  },
  toolCallFile: {
    flex: 1,
    color: '#8b949e',
    fontSize: 11,
    fontFamily: MONO,
  },
  fileList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  fileChip: {
    maxWidth: '100%',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
  },
  fileChipText: {
    color: '#e6edf3',
    fontSize: 10,
    fontFamily: MONO,
  },
  connectionSummary: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#21262d',
    backgroundColor: '#0d1117',
    padding: 4,
  },
  detailsDisclosure: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#161b22',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  detailsDisclosureCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  detailsDisclosureTitle: {
    color: '#e6edf3',
    fontSize: 14,
    fontWeight: '600',
  },
  detailsDisclosureSummary: {
    color: '#8b949e',
    fontSize: 12,
  },
  detailsDisclosureAction: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '600',
  },
  detailsPanel: {
    gap: 18,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#0d1117',
  },
  detailsList: {
    gap: 0,
  },
  detailRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#21262d',
  },
  detailLabel: {
    width: 78,
    color: '#8b949e',
    fontSize: 12,
  },
  detailValue: {
    flex: 1,
    color: '#e6edf3',
    fontSize: 13,
    textAlign: 'right',
  },
  sessionValue: {
    fontFamily: MONO,
    fontSize: 11,
  },
  settingsSection: {
    gap: 12,
  },
  settingsTitle: {
    color: '#e6edf3',
    fontSize: 14,
    fontWeight: '600',
  },
  memoryStatus: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: '#161b22',
  },
  memoryStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  memoryStatusCopy: {
    flex: 1,
    gap: 2,
  },
  memoryStatusTitle: {
    color: '#e6edf3',
    fontSize: 12,
    fontWeight: '600',
  },
  memoryStatusDetail: {
    color: '#8b949e',
    fontSize: 11,
  },
  settingRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  settingCopy: {
    flex: 1,
    minWidth: 170,
    gap: 2,
  },
  settingLabel: {
    color: '#e6edf3',
    fontSize: 13,
    fontWeight: '600',
  },
  settingDescription: {
    color: '#8b949e',
    fontSize: 11,
  },
  renameEditor: {
    flex: 1,
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  renameInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#6366f1',
    backgroundColor: '#010409',
    color: '#e6edf3',
    fontSize: 13,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  } as any,
  smallButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  smallButtonText: {
    color: '#e6edf3',
    fontSize: 12,
    fontWeight: '600',
  },
  primaryAgentButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#21262d',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  primaryAgentMarker: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  primaryAgentText: {
    color: '#e6edf3',
    fontSize: 12,
    fontWeight: '600',
  },
});
