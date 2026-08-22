import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import AgentControlCard from '../../../../components/AgentControlCard';
import {
  getAgentIdentityKey,
  refreshAgentIdentitiesFromServerExact,
  setMainAgentForProviderExact,
  type AgentIdentityExactAuthority,
} from '../../../../lib/agentIdentity';
import {
  PROVIDER_META,
  type OfficeConnectionAuthorityFence,
} from '../../../../lib/connectionManager';
import { OfficeAgent, resolveOfficeAgentExecutionTruth } from '../../../../lib/officeAgents';
import {
  getAgentControlExact,
  upsertAgentControlExact,
  type AgentControl,
  type AgentControlExactAuthority,
} from '../../../../services/hitlService';
import { getSupabaseClientForAccessToken } from '../../../../lib/supabase';
import { formatRelativeTime, MONO, shortPath } from './AgentPanelShared';

// ─── Quick Actions strip ────────────────────────────────────────────────────
// Primary actions stay task-focused: continue with this exact subject in Chat,
// or pause/resume its Circle control. Raw session identifiers and the Claude
// diagnostic allowlist remain behind one Inspect disclosure.

function QuickActionsStrip({
  agent,
  circleId,
  sessionKey,
  identityAuthority,
  isIdentityAuthorityCurrent,
  onOpenInChat,
  onRunCommand,
}: {
  agent: OfficeAgent;
  circleId?: string;
  sessionKey: string;
  identityAuthority: AgentControlExactAuthority | null;
  isIdentityAuthorityCurrent: (authority: AgentControlExactAuthority) => boolean;
  onOpenInChat?: (draft?: string) => void;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
}) {
  type ControlState = {
    status: 'loading' | 'ready' | 'error';
    control: AgentControl | null;
    message: string | null;
  };

  const [inspectOpen, setInspectOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlState, setControlState] = useState<ControlState>({
    status: 'loading',
    control: null,
    message: null,
  });
  const [toast, setToast] = useState<{ message: string; kind: 'status' | 'error' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const diagnosticInFlightRef = useRef(false);
  const controlReadGenerationRef = useRef(0);
  const controlMutationGenerationRef = useRef(0);
  const controlMutationInFlightRef = useRef(false);

  const canRunDiagnostics = agent.providerType === 'claude-code' && !!onRunCommand;
  const isPaused = controlState.control?.is_paused === true;
  const controlReady = controlState.status === 'ready';

  const showToast = (message: string, kind: 'status' | 'error' = 'status') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 2400);
  };

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const loadControl = useCallback(async () => {
    const generation = controlReadGenerationRef.current + 1;
    controlReadGenerationRef.current = generation;
    controlMutationGenerationRef.current += 1;
    controlMutationInFlightRef.current = false;
    setControlBusy(false);
    setControlState({ status: 'loading', control: null, message: null });
    const authority = identityAuthority;
    if (!circleId || !authority || !isIdentityAuthorityCurrent(authority)) {
      if (controlReadGenerationRef.current === generation) {
        setControlState({
          status: 'error',
          control: null,
          message: 'Pause controls are unavailable until this Office session is ready.',
        });
      }
      return;
    }

    try {
      const result = await getAgentControlExact(circleId, sessionKey, authority, isIdentityAuthorityCurrent);
      if (
        controlReadGenerationRef.current !== generation
        || !isIdentityAuthorityCurrent(authority)
      ) return;
      if (!result.ok) {
        setControlState({
          status: 'error',
          control: null,
          message: 'The agent pause status could not be loaded.',
        });
        return;
      }
      setControlState({ status: 'ready', control: result.control, message: null });
    } catch {
      if (
        controlReadGenerationRef.current === generation
        && isIdentityAuthorityCurrent(authority)
      ) {
        setControlState({
          status: 'error',
          control: null,
          message: 'The agent pause status could not be loaded.',
        });
      }
    }
  }, [circleId, identityAuthority, isIdentityAuthorityCurrent, sessionKey]);

  useEffect(() => {
    void loadControl();
    return () => {
      controlReadGenerationRef.current += 1;
      controlMutationGenerationRef.current += 1;
    };
  }, [loadControl]);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || diagnosticInFlightRef.current) return;
    diagnosticInFlightRef.current = true;
    setSending(true);
    try {
      if (canRunDiagnostics && onRunCommand) {
        const res = await onRunCommand(text);
        const output = String(res.stdout || res.stderr || '').trim().slice(0, 100);
        if (!res.ok) {
          showToast('Diagnostic failed. Review bridge status and retry.', 'error');
          return;
        }
        showToast(output || 'Diagnostic completed');
        setDraft('');
      } else {
        showToast('Use Chat, OpenSwan, or Terminal to send this agent a task');
      }
    } catch {
      showToast('Diagnostic failed. Review bridge status and retry.', 'error');
    } finally {
      diagnosticInFlightRef.current = false;
      setSending(false);
    }
  };

  const handleTogglePause = async () => {
    if (controlMutationInFlightRef.current || controlBusy || !controlReady) return;
    const mutationGeneration = controlMutationGenerationRef.current + 1;
    controlMutationGenerationRef.current = mutationGeneration;
    controlMutationInFlightRef.current = true;
    setControlBusy(true);
    const authority = identityAuthority;
    try {
      if (!circleId || !authority || !isIdentityAuthorityCurrent(authority)) {
        if (controlMutationGenerationRef.current === mutationGeneration) {
          setControlState({
            status: 'error',
            control: controlState.control,
            message: 'The Office session changed before the pause setting could be saved.',
          });
        }
        return;
      }
      const result = await upsertAgentControlExact(
        circleId,
        sessionKey,
        agent.name,
        { is_paused: !isPaused },
        authority,
        isIdentityAuthorityCurrent,
      );
      if (
        controlMutationGenerationRef.current !== mutationGeneration
        || !isIdentityAuthorityCurrent(authority)
      ) return;
      if (!result.ok) {
        setControlState({
          status: 'error',
          control: controlState.control,
          message: 'The pause setting could not be saved. Reload its status before retrying.',
        });
        return;
      }
      setControlState({ status: 'ready', control: result.control, message: null });
      showToast(isPaused ? 'Agent resumed' : 'Agent paused');
    } catch {
      if (
        controlMutationGenerationRef.current === mutationGeneration
        && authority
        && isIdentityAuthorityCurrent(authority)
      ) {
        setControlState({
          status: 'error',
          control: controlState.control,
          message: 'The pause setting could not be saved. Reload its status before retrying.',
        });
      }
    } finally {
      if (controlMutationGenerationRef.current === mutationGeneration) {
        controlMutationInFlightRef.current = false;
        setControlBusy(false);
      }
    }
  };

  const handleCopySession = async () => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(sessionKey);
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
        <Pressable
          onPress={() => onOpenInChat?.()}
          disabled={!onOpenInChat}
          accessibilityRole="button"
          accessibilityLabel={`Continue with ${agent.name} in Chat`}
          accessibilityHint="Selects this exact agent in Chat without sending a message."
          accessibilityState={{ disabled: !onOpenInChat }}
          style={[
            overviewStyles.actionButton,
            { borderColor: accentColor + '70', backgroundColor: accentColor + '18' },
            !onOpenInChat && overviewStyles.actionButtonDisabled,
          ]}
        >
          <Text style={[overviewStyles.actionButtonText, { color: accentColor }]}>Continue in Chat</Text>
        </Pressable>
        <Pressable
          onPress={handleTogglePause}
          disabled={controlBusy || !controlReady}
          accessibilityRole="button"
          accessibilityLabel={controlReady
            ? (isPaused ? `Resume ${agent.name}` : `Pause ${agent.name}`)
            : `Pause status unavailable for ${agent.name}`}
          accessibilityState={{
            disabled: controlBusy || !controlReady,
            busy: controlBusy || controlState.status === 'loading',
          }}
          style={[overviewStyles.actionButton, (controlBusy || !controlReady) && overviewStyles.actionButtonDisabled]}
        >
          <Text style={overviewStyles.actionButtonText}>
            {controlBusy
              ? 'Updating…'
              : controlState.status === 'loading'
                ? 'Checking…'
                : controlState.status === 'error'
                  ? 'Unavailable'
                  : isPaused ? 'Resume' : 'Pause'}
          </Text>
        </Pressable>
      </View>

      {controlState.status === 'loading' ? (
        <Text style={overviewStyles.controlStateText} accessibilityLiveRegion="polite">
          Checking the exact agent pause status…
        </Text>
      ) : controlState.status === 'ready' ? (
        <Text style={overviewStyles.controlStateText} accessibilityLiveRegion="polite">
          {isPaused ? 'Agent is paused.' : 'Agent is ready to run.'}
        </Text>
      ) : (
        <View style={overviewStyles.controlError} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={overviewStyles.controlErrorText}>{controlState.message}</Text>
          <Pressable
            onPress={() => { void loadControl(); }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading agent pause status"
            style={overviewStyles.controlRetryButton}
          >
            <Text style={overviewStyles.controlRetryButtonText}>Retry</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        onPress={() => setInspectOpen(value => !value)}
        accessibilityRole="button"
        accessibilityLabel={inspectOpen ? 'Hide session inspection tools' : 'Show session inspection tools'}
        accessibilityState={{ expanded: inspectOpen }}
        style={overviewStyles.inlineDisclosure}
      >
        <Text style={overviewStyles.inlineDisclosureText}>{inspectOpen ? 'Hide session tools' : 'Inspect session'}</Text>
      </Pressable>

      {inspectOpen && (
        <View style={overviewStyles.diagnosticComposer}>
          <View style={overviewStyles.diagnosticFooter}>
            <Text style={overviewStyles.diagnosticHint} numberOfLines={1}>{sessionKey}</Text>
            <Pressable
              onPress={handleCopySession}
              accessibilityRole="button"
              accessibilityLabel="Copy session key"
              accessibilityHint="Copies the exact runtime session identifier."
              style={overviewStyles.smallButton}
            >
              <Text style={overviewStyles.smallButtonText}>Copy session</Text>
            </Pressable>
          </View>
          {canRunDiagnostics ? (
            <>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Read-only command · e.g. git status"
                placeholderTextColor="#606075"
                multiline
                accessibilityLabel="Read-only diagnostic command"
                style={overviewStyles.diagnosticInput}
                onSubmitEditing={handleSend}
              />
              <View style={overviewStyles.diagnosticFooter}>
                <Text style={overviewStyles.diagnosticHint}>Claude bridge read-only diagnostic allowlist</Text>
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
            </>
          ) : (
            <Text style={overviewStyles.diagnosticHint}>Read-only diagnostics are not available for this provider.</Text>
          )}
        </View>
      )}

      {toast && (
        <View
          style={overviewStyles.notice}
          accessibilityRole={toast.kind === 'error' ? 'alert' : undefined}
          accessibilityLiveRegion={toast.kind === 'error' ? 'assertive' : 'polite'}
        >
          <Text style={overviewStyles.noticeText}>{toast.message}</Text>
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
  const executionTruth = resolveOfficeAgentExecutionTruth(agent);

  // Record a sample when the bridge counter advances so we can draw a
  // 30-minute rolling sparkline without introducing another timer or DB read.
  useEffect(() => {
    setBurnSamples(prev => {
      const next = [...prev, { t: Date.now(), tokens: agent.tokensUsed || 0 }];
      const cutoff = Date.now() - 30 * 60_000;
      return next.filter(s => s.t >= cutoff).slice(-60);
    });
  }, [agent.tokensUsed]);

  // A connection/session transition retires the prior evidence window. The
  // bridge may retain counters and tool fields for diagnostics, but a newly
  // verified runtime must establish its own burn-rate baseline.
  useEffect(() => {
    setBurnSamples([{ t: Date.now(), tokens: agent.tokensUsed || 0 }]);
    setDetailsOpen(false);
  }, [agent.connectionId, agent.id, agent.sessionKey, executionTruth.state]);

  const recentCalls = executionTruth.state === 'active'
    ? (agent.recentToolCalls || []).slice(-5).reverse()
    : [];
  const activeFiles = executionTruth.state === 'active' ? (agent.activeFiles || []) : [];
  const isWorking = executionTruth.state === 'active';
  const dotColor = executionTruth.state === 'warning'
    ? '#f59e0b'
    : isWorking
      ? '#3fb950'
      : '#484f58';
  const burnRate = computeBurnRate(burnSamples);
  const hasEvidence = isWorking && (recentCalls.length > 0 || activeFiles.length > 0 || burnRate > 0);
  const stateLabel = executionTruth.state === 'warning'
    ? 'Needs refresh'
    : executionTruth.state === 'active'
      ? 'Working'
      : executionTruth.state === 'connected'
        ? 'Ready'
        : 'Offline';
  const statusCopy = executionTruth.state === 'warning'
    ? `Runtime status warning: ${executionTruth.statusWarning}. Refresh the connection before assigning new work.`
    : executionTruth.state === 'connected'
      ? 'Connected and standing by. No current execution is verified.'
      : executionTruth.state === 'unavailable'
        ? 'Runtime is offline or unavailable. Reconnect it before assigning new work.'
        : currentObjective;

  return (
    <View style={[overviewStyles.currentWork, isWorking && overviewStyles.currentWorkActive]}>
      <View style={overviewStyles.currentWorkHeader}>
        <View style={[overviewStyles.currentWorkDot, { backgroundColor: dotColor }]} />
        <Text style={overviewStyles.currentWorkTitle}>Current work</Text>
        <Text accessibilityLiveRegion="polite" style={overviewStyles.currentWorkState}>{stateLabel}</Text>
      </View>

      {executionTruth.currentToolName || executionTruth.currentToolFile ? (
        <View style={overviewStyles.currentTool}>
          <Text style={overviewStyles.currentToolName}>
            {executionTruth.currentToolName || 'Running'}
          </Text>
          {executionTruth.currentToolFile && (
            <Text style={overviewStyles.currentToolFile} numberOfLines={1}>
              {shortPath(executionTruth.currentToolFile)}
            </Text>
          )}
        </View>
      ) : (
        <Text style={overviewStyles.currentObjective}>{statusCopy}</Text>
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

type SyncState = 'locked' | 'loading' | 'fresh' | 'stale' | 'cold' | 'empty' | 'error';
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
  authority: (AgentIdentityExactAuthority & { generation?: number }) | null | undefined,
): (AgentIdentityExactAuthority & AgentControlExactAuthority) | null {
  const userId = authority?.userId?.trim();
  const authorityCircleId = authority?.circleId?.trim();
  const accessToken = authority?.accessToken?.trim();
  const generation = Number(authority?.generation || 0);
  if (
    !circleId
    || !userId
    || authorityCircleId !== circleId
    || !accessToken
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return { userId, circleId: authorityCircleId, accessToken, generation };
}

function useMemorySyncStatus(
  circleId: string | undefined,
  identityAuthority: (AgentIdentityExactAuthority & AgentControlExactAuthority) | null,
  isIdentityAuthorityCurrent: (authority: AgentControlExactAuthority) => boolean,
): MemorySyncStatus {
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [state, setState] = useState<SyncState>('loading');
  const userId = identityAuthority?.userId || null;
  const accessToken = identityAuthority?.accessToken || null;

  useEffect(() => {
    if (!circleId || !userId || !accessToken) {
      setLastSavedAt(null);
      setState('locked');
      return;
    }
    setLastSavedAt(null);
    setState('loading');
    let cancelled = false;
    const tick = async () => {
      try {
        if (!identityAuthority || !isIdentityAuthorityCurrent(identityAuthority)) return;
        const exactClient = getSupabaseClientForAccessToken(accessToken);
        const { data, error } = await exactClient
          .from('memory_entries')
          .select('updated_at')
          .eq('circle_id', circleId)
          .eq('user_id', userId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (cancelled || !isIdentityAuthorityCurrent(identityAuthority)) return;
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
  }, [accessToken, circleId, identityAuthority, isIdentityAuthorityCurrent, userId]);

  if (state === 'fresh') return { state, lastSavedAt, color: '#22c55e', label: 'SYNCED', detail: lastSavedAt ? formatRelativeTime(lastSavedAt) : 'just now' };
  if (state === 'stale') return { state, lastSavedAt, color: '#f59e0b', label: 'STALE', detail: `last sync ${formatRelativeTime(lastSavedAt || undefined)}` };
  if (state === 'cold') return { state, lastSavedAt, color: '#6b7280', label: 'IDLE', detail: `last sync ${formatRelativeTime(lastSavedAt || undefined)}` };
  if (state === 'empty') return { state, lastSavedAt: null, color: '#6b7280', label: 'EMPTY', detail: 'no memories saved yet' };
  if (state === 'error') return { state, lastSavedAt: null, color: '#ef4444', label: 'ERROR', detail: 'memory sync could not be checked' };
  if (state === 'locked') return { state, lastSavedAt: null, color: '#8b949e', label: 'LOCKED', detail: 'sign in to this Circle to check memory sync' };
  return { state: 'loading', lastSavedAt: null, color: '#3a3a4e', label: 'CHECKING', detail: 'probing memory sync…' };
}

export default function AgentOverviewPanel({
  agent,
  circleId,
  runtimeConnectionId,
  identityAuthority,
  isIdentityAuthorityCurrent: isParentIdentityAuthorityCurrent,
  onClose,
  onAgentIdentityChange,
  onOpenInChat,
  onRunCommand,
}: {
  agent: OfficeAgent;
  circleId?: string;
  runtimeConnectionId?: string | null;
  identityAuthority?: (AgentIdentityExactAuthority & { generation?: number }) | null;
  isIdentityAuthorityCurrent: OfficeConnectionAuthorityFence;
  onClose: () => void;
  onAgentIdentityChange?: () => void;
  onOpenInChat?: (draft?: string) => void;
  onRunCommand?: (cmd: string) => Promise<{ ok: boolean; stdout?: string; stderr?: string }>;
}) {
  const exactIdentityAuthority = useMemo(
    () => normalizeIdentityAuthority(circleId, identityAuthority),
    [circleId, identityAuthority?.accessToken, identityAuthority?.circleId, identityAuthority?.generation, identityAuthority?.userId],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [isMainAgent, setIsMainAgent] = useState(false);
  const [mainAgentStatus, setMainAgentStatus] = useState<
    'idle' | 'locked' | 'loading' | 'ready' | 'refresh-needed' | 'outcome-unknown' | 'error'
  >('idle');
  const [mainAgentBusy, setMainAgentBusy] = useState(false);
  const [mainAgentReloadGeneration, setMainAgentReloadGeneration] = useState(0);
  const mainAgentMutationInFlightRef = useRef(false);

  const sessionKey = useMemo(
    () => getAgentIdentityKey(agent),
    [agent],
  );
  const identityRequestKey = exactIdentityAuthority
    ? `${exactIdentityAuthority.userId}\u0000${exactIdentityAuthority.circleId}\u0000${exactIdentityAuthority.generation}\u0000${agent.id}\u0000${sessionKey}`
    : '';
  const latestIdentityRequestKeyRef = useRef(identityRequestKey);
  const latestIdentityAccessTokenRef = useRef(exactIdentityAuthority?.accessToken || '');
  latestIdentityRequestKeyRef.current = identityRequestKey;
  latestIdentityAccessTokenRef.current = exactIdentityAuthority?.accessToken || '';
  const isIdentityAuthorityCurrent = useCallback((authority: AgentControlExactAuthority) => (
    !!exactIdentityAuthority
    && isParentIdentityAuthorityCurrent(authority)
    && latestIdentityRequestKeyRef.current === identityRequestKey
    && latestIdentityAccessTokenRef.current === authority.accessToken
    && exactIdentityAuthority.userId === authority.userId
    && exactIdentityAuthority.circleId === authority.circleId
    && exactIdentityAuthority.generation === authority.generation
  ), [exactIdentityAuthority, identityRequestKey, isParentIdentityAuthorityCurrent]);
  const memorySync = useMemorySyncStatus(
    circleId,
    detailsOpen ? exactIdentityAuthority : null,
    isIdentityAuthorityCurrent,
  );
  const providerMeta = PROVIDER_META[agent.providerType];

  useEffect(() => {
    setDetailsOpen(false);
    setIsMainAgent(false);
    setMainAgentStatus('idle');
    setMainAgentBusy(false);
    mainAgentMutationInFlightRef.current = false;
  }, [agent.id, identityRequestKey]);

  useEffect(() => () => {
    latestIdentityRequestKeyRef.current = '';
    latestIdentityAccessTokenRef.current = '';
  }, []);

  useEffect(() => {
    setIsMainAgent(false);
    setMainAgentBusy(false);
    if (!detailsOpen) {
      setMainAgentStatus('idle');
      return;
    }
    if (!exactIdentityAuthority || !identityRequestKey) {
      setMainAgentStatus('locked');
      return;
    }
    let cancelled = false;
    const capturedRequestKey = identityRequestKey;
    const capturedAuthority = exactIdentityAuthority;
    setMainAgentStatus('loading');
    refreshAgentIdentitiesFromServerExact(
      exactIdentityAuthority,
      isIdentityAuthorityCurrent,
    )
      .then(serverResult => {
        if (
          cancelled
          || !isIdentityAuthorityCurrent(capturedAuthority)
          || latestIdentityRequestKeyRef.current !== capturedRequestKey
          || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
        ) return;
        if (!serverResult.serverVerified) {
          setMainAgentStatus('error');
          return;
        }
        const identity = serverResult.identities.get(sessionKey);
        setIsMainAgent(identity?.isPrimary === true);
        setMainAgentStatus('ready');
      })
      .catch(err => {
        console.warn('[AgentOverviewPanel] Failed to load identities:', err);
        if (
          cancelled
          || !isIdentityAuthorityCurrent(capturedAuthority)
          || latestIdentityRequestKeyRef.current !== capturedRequestKey
          || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
        ) return;
        setMainAgentStatus('error');
      });
    return () => { cancelled = true; };
  }, [detailsOpen, exactIdentityAuthority, identityRequestKey, isIdentityAuthorityCurrent, mainAgentReloadGeneration, sessionKey]);

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
  const mainAgentVerified = mainAgentStatus === 'ready';
  const mainAgentDisabled = !exactIdentityAuthority || !mainAgentVerified || isMainAgent || mainAgentBusy;

  const handleSetMainAgent = async () => {
    const capturedAuthority = exactIdentityAuthority;
    const capturedRequestKey = identityRequestKey;
    if (
      mainAgentDisabled
      || mainAgentMutationInFlightRef.current
      || !capturedAuthority
      || !capturedRequestKey
      || !isIdentityAuthorityCurrent(capturedAuthority)
    ) return;
    mainAgentMutationInFlightRef.current = true;
    setMainAgentBusy(true);
    try {
      const receipt = await setMainAgentForProviderExact(
        sessionKey,
        agent.providerType,
        capturedAuthority,
        isIdentityAuthorityCurrent,
      );
      if (
        !isIdentityAuthorityCurrent(capturedAuthority)
        || latestIdentityRequestKeyRef.current !== capturedRequestKey
        || latestIdentityAccessTokenRef.current !== capturedAuthority.accessToken
      ) return;
      if (receipt.error === 'outcome_unknown' || receipt.serverSaved === null) {
        setMainAgentStatus('outcome-unknown');
        return;
      }
      if (receipt.serverSaved === true && !receipt.localSaved) {
        setMainAgentStatus('refresh-needed');
        return;
      }
      if (!receipt.ok || !receipt.localSaved || receipt.serverSaved !== true) {
        setMainAgentStatus('error');
        return;
      }
      setIsMainAgent(true);
      setMainAgentStatus('ready');
      onAgentIdentityChange?.();
    } catch (err) {
      console.warn('[AgentOverviewPanel] Failed to set main agent:', err);
      if (
        isIdentityAuthorityCurrent(capturedAuthority)
        && latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) setMainAgentStatus('error');
    } finally {
      if (
        isIdentityAuthorityCurrent(capturedAuthority)
        && latestIdentityRequestKeyRef.current === capturedRequestKey
        && latestIdentityAccessTokenRef.current === capturedAuthority.accessToken
      ) {
        mainAgentMutationInFlightRef.current = false;
        setMainAgentBusy(false);
      }
    }
  };

  return (
    <View nativeID="section-agent-overview" style={overviewStyles.container}>
      <QuickActionsStrip
        agent={agent}
        circleId={circleId}
        sessionKey={sessionKey}
        identityAuthority={exactIdentityAuthority}
        isIdentityAuthorityCurrent={isIdentityAuthorityCurrent}
        onOpenInChat={onOpenInChat}
        onRunCommand={onRunCommand}
      />
      <NowDoingPanel agent={agent} currentObjective={currentObjective} />

      {circleId && sessionKey && (
        <View nativeID="section-agent-controls" style={overviewStyles.connectionSummary}>
          <AgentControlCard
            key={`${agent.id}:${runtimeConnectionId || 'provider'}`}
            agent={agent}
            runtimeConnectionId={runtimeConnectionId}
          />
        </View>
      )}

      <Pressable
        onPress={() => setDetailsOpen(value => !value)}
        disabled={mainAgentBusy}
        accessibilityRole="button"
        accessibilityLabel={detailsOpen ? 'Hide agent details' : 'Show agent details'}
        accessibilityState={{ disabled: mainAgentBusy, expanded: detailsOpen }}
        style={[
          overviewStyles.detailsDisclosure,
          mainAgentBusy && overviewStyles.actionButtonDisabled,
          Platform.OS === 'web' && mainAgentBusy ? ({ cursor: 'wait' } as any) : null,
        ]}
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
          </View>

          {['claude-code', 'cursor', 'codex', 'gemini'].includes(agent.providerType) ? (
            <View style={overviewStyles.settingsSection}>
              <Text style={overviewStyles.settingsTitle}>Preferences</Text>
              <View style={[overviewStyles.memoryStatus, { borderColor: memorySync.color + '38' }]}>
                <View style={[overviewStyles.memoryStatusDot, { backgroundColor: memorySync.color }]} />
                <View style={overviewStyles.memoryStatusCopy}>
                  <Text style={overviewStyles.memoryStatusTitle}>Circle memory {memorySync.label.toLowerCase()}</Text>
                  <Text style={overviewStyles.memoryStatusDetail}>{memorySync.detail}</Text>
                </View>
              </View>

              <Pressable
                onPress={handleSetMainAgent}
                disabled={mainAgentDisabled}
                accessibilityRole="button"
                accessibilityLabel={isMainAgent
                  ? `${agent.name} is the main Office agent`
                  : mainAgentStatus === 'loading'
                    ? `Checking whether ${agent.name} is the main Office agent`
                    : `Set ${agent.name} as the main Office agent`}
                accessibilityState={{ disabled: mainAgentDisabled, selected: mainAgentVerified && isMainAgent, busy: mainAgentBusy || mainAgentStatus === 'loading' }}
                style={[
                  overviewStyles.primaryAgentButton,
                  isMainAgent && { borderColor: agent.color + '55', backgroundColor: agent.color + '12' },
                  mainAgentDisabled && overviewStyles.actionButtonDisabled,
                ]}
              >
                <View style={[overviewStyles.primaryAgentMarker, { backgroundColor: isMainAgent ? agent.color : '#484f58' }]} />
                <Text style={overviewStyles.primaryAgentText}>
                  {mainAgentBusy
                    ? 'Updating main agent…'
                    : mainAgentStatus === 'loading'
                      ? 'Checking main agent…'
                      : isMainAgent
                        ? 'Main Office agent'
                        : 'Set as main Office agent'}
                </Text>
              </Pressable>
              {mainAgentStatus === 'locked' ? (
                <Text accessibilityRole="alert" style={overviewStyles.mainAgentStatusText}>
                  Main-agent status is locked until this Office session has exact identity authority.
                </Text>
              ) : mainAgentStatus === 'refresh-needed' ? (
                <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={overviewStyles.mainAgentWarningRow}>
                  <Text style={overviewStyles.mainAgentWarningText}>Main-agent selection was saved on the server, but this view could not refresh. Reload status; do not set it again.</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Reload main Office agent status after server save"
                    onPress={() => setMainAgentReloadGeneration(value => value + 1)}
                    style={overviewStyles.mainAgentWarningButton}
                  >
                    <Text style={overviewStyles.mainAgentWarningText}>Reload status</Text>
                  </Pressable>
                </View>
              ) : mainAgentStatus === 'outcome-unknown' ? (
                <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={overviewStyles.mainAgentWarningRow}>
                  <Text style={overviewStyles.mainAgentWarningText}>Main-agent outcome could not be verified. Reload status before retrying the change.</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Reload main Office agent status after unknown outcome"
                    onPress={() => setMainAgentReloadGeneration(value => value + 1)}
                    style={overviewStyles.mainAgentWarningButton}
                  >
                    <Text style={overviewStyles.mainAgentWarningText}>Reload status</Text>
                  </Pressable>
                </View>
              ) : mainAgentStatus === 'error' ? (
                <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={overviewStyles.mainAgentErrorRow}>
                  <Text style={overviewStyles.mainAgentErrorText}>Main-agent status could not be verified. No change is available until it reloads.</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading main Office agent status"
                    onPress={() => setMainAgentReloadGeneration(value => value + 1)}
                    style={overviewStyles.mainAgentRetryButton}
                  >
                    <Text style={overviewStyles.mainAgentRetryText}>Retry</Text>
                  </Pressable>
                </View>
              ) : null}
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
  controlStateText: {
    color: '#8b949e',
    fontSize: 11,
    lineHeight: 17,
  },
  controlError: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f8514948',
    backgroundColor: '#f8514910',
  },
  controlErrorText: {
    color: '#f0a09b',
    fontSize: 11,
    lineHeight: 17,
    flex: 1,
    minWidth: 180,
  },
  controlRetryButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f8514960',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  controlRetryButtonText: {
    color: '#f0a09b',
    fontSize: 12,
    fontWeight: '600',
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
    borderRadius: 6,
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
    borderRadius: 6,
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
    borderRadius: 6,
  },
  primaryAgentText: {
    color: '#e6edf3',
    fontSize: 12,
    fontWeight: '600',
  },
  mainAgentStatusText: {
    color: '#8b949e',
    fontSize: 11,
    lineHeight: 17,
  },
  mainAgentWarningRow: {
    gap: 8,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f59e0b55',
    backgroundColor: '#2a1a06',
  },
  mainAgentWarningText: {
    color: '#fbbf24',
    fontSize: 11,
    lineHeight: 17,
  },
  mainAgentWarningButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f59e0b66',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mainAgentErrorRow: {
    gap: 8,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ef444455',
    backgroundColor: '#2a0b0b',
  },
  mainAgentErrorText: {
    color: '#fca5a5',
    fontSize: 11,
    lineHeight: 17,
  },
  mainAgentRetryButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ef444466',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  mainAgentRetryText: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '700',
  },
});
