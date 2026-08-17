import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { MONO, formatTokens } from './AgentPanelShared';
import OpenSwanQualityAggregate from '../../../../components/chat/OpenSwanQualityAggregate';
import OpenSwanQualityDashboard from '../../../../components/chat/OpenSwanQualityDashboard';
import RunMetadataSummary from '../../../../components/chat/RunMetadataSummary';
import { buildOpenSwanObservedEvalAggregate, buildOpenSwanObservedEvalDashboard } from '../../../../lib/openswanObservedEvals';
import { buildRunMetadataSummaryProps } from '../../../../lib/runMetadataSummary';
import { getRunSubjectSummary } from '../../../../lib/agentRunSubjectSummary';
import { planRunReap } from '../../../../lib/runStallPolicyCore';
import { isAwaitingConnectedAgentResultMetadata } from '../../../../lib/officeOpsBoard';
import { bucketRunForHistory, describeRunHistoryStatus } from '../../../../lib/runHistoryFilterCore';
import type {
  AgentRunExactReadAuthority,
  AgentRunExactReadAuthorityFence,
  AgentRunStrictReadOptions,
} from '../../../../lib/agentRunSystem';

type StatusFilter = 'all' | 'completed' | 'running' | 'failed';

type RunDetailsState = {
  runId: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  steps: any[];
  childRuns: any[];
  error: string | null;
};

const PAGE_SIZE = 10;
const EMPTY_STALE_RUN_IDS = new Set<string>();
const EMPTY_RUN_DETAILS: RunDetailsState = {
  runId: null,
  status: 'idle',
  steps: [],
  childRuns: [],
  error: null,
};

const STATUS_COLORS: Record<string, string> = {
  completed: '#22c55e',
  running: '#3b82f6',
  failed: '#ef4444',
  queued: '#606075',
  planning: '#f59e0b',
  paused: '#f59e0b',
  waiting_approval: '#f59e0b',
  cancelled: '#606075',
};

const STEP_COLORS: Record<string, string> = {
  plan: '#909098',
  message: '#909098',
  tool_call: '#a0a0b0',
  delegation: '#909098',
  error: '#ef4444',
  finalize: '#909098',
  thinking: '#606075',
};

function getChildQualityTone(outcome?: string | null): { border: string; bg: string; text: string } {
  switch (outcome) {
    case 'strong':
      return { border: '#22c55e40', bg: '#052e16', text: '#86efac' };
    case 'blocked':
      return { border: '#f59e0b40', bg: '#1f1605', text: '#fbbf24' };
    case 'failed':
      return { border: '#ef444440', bg: '#2a0b0b', text: '#fca5a5' };
    default:
      return { border: '#38bdf840', bg: '#082f49', text: '#7dd3fc' };
  }
}

function getWeakestSignalLabel(observedEval: any): string | null {
  const signals = [
    ...(Array.isArray(observedEval?.skillSignals) ? observedEval.skillSignals : []),
    ...(Array.isArray(observedEval?.modeSignals) ? observedEval.modeSignals : []),
  ].filter((signal: any) => signal && typeof signal.score === 'number');
  if (signals.length === 0) return null;
  const weakest = signals.slice().sort((left: any, right: any) => left.score - right.score)[0];
  return weakest?.label || null;
}

// Matches a run object to the active filter. `running` bucket covers any
// "in progress" state users conceptually think of as "currently working".
function matchesFilter(run: any, filter: StatusFilter, nowMs: number): boolean {
  if (filter === 'all') return true;
  const bucket = bucketRunForHistory(run, nowMs);
  if (filter === 'completed') return bucket === 'succeeded';
  if (filter === 'failed') return bucket === 'failed';
  if (filter === 'running') return bucket === 'running';
  return true;
}

interface AgentRunsPanelProps {
  circleId: string;
  agentId: string;
  agentAliases?: string[];
  agentName: string;
  accentColor: string;
  identityAuthority: AgentRunExactReadAuthority | null;
  isIdentityAuthorityCurrent: AgentRunExactReadAuthorityFence;
}

function normalizeRunsReadAuthority(
  circleId: string,
  authority: AgentRunExactReadAuthority | null | undefined,
): AgentRunExactReadAuthority | null {
  const userId = authority?.userId?.trim();
  const authorityCircleId = authority?.circleId?.trim();
  const accessToken = authority?.accessToken?.trim();
  const generation = Number(authority?.generation);
  if (
    !circleId
    || !userId
    || authorityCircleId !== circleId
    || !accessToken
    || accessToken.length > 16_384
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return { userId, circleId: authorityCircleId, accessToken, generation };
}

function isRunsReadAuthorityCurrent(
  authority: AgentRunExactReadAuthority,
  fence: AgentRunExactReadAuthorityFence,
): boolean {
  try {
    return fence(authority) === true;
  } catch {
    return false;
  }
}

export default function AgentRunsPanel({
  circleId,
  agentId,
  agentAliases = [],
  agentName,
  accentColor,
  identityAuthority,
  isIdentityAuthorityCurrent,
}: AgentRunsPanelProps) {
  const [runs, setRuns] = useState<any[]>([]);
  const [verifiedScopeKey, setVerifiedScopeKey] = useState<string | null>(null);
  // Presentation-only liveness projection. This panel may flag an aging run,
  // but opening a read surface must never mutate the canonical run ledger.
  const [staleRunIds, setStaleRunIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetailsState>(EMPTY_RUN_DETAILS);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [freshnessTick, setFreshnessTick] = useState(0);
  const listRequestGenerationRef = useRef(0);
  const detailRequestGenerationRef = useRef(0);
  const normalizedAgentAliases = Array.from(new Set(
    [agentId, ...agentAliases]
      .map(id => String(id || '').trim())
      .filter(Boolean),
  )).sort();
  const normalizedAgentAliasesKey = JSON.stringify(normalizedAgentAliases);
  const exactReadAuthority = useMemo(
    () => normalizeRunsReadAuthority(circleId, identityAuthority),
    [
      circleId,
      identityAuthority?.accessToken,
      identityAuthority?.circleId,
      identityAuthority?.generation,
      identityAuthority?.userId,
    ],
  );
  // Bearer material never enters the scope key. A positive generation is the
  // lifecycle boundary supplied by Office for one exact user/circle session.
  const readScopeKey = useMemo(() => JSON.stringify({
    userId: exactReadAuthority?.userId || null,
    circleId,
    generation: exactReadAuthority?.generation || null,
    agentId,
    agentAliases: normalizedAgentAliasesKey,
    agentName,
  }), [
    agentId,
    agentName,
    circleId,
    exactReadAuthority?.generation,
    exactReadAuthority?.userId,
    normalizedAgentAliasesKey,
  ]);
  const currentReadScopeKeyRef = useRef(readScopeKey);
  currentReadScopeKeyRef.current = readScopeKey;
  const hasVerifiedSnapshot = verifiedScopeKey === readScopeKey;
  const verifiedRuns = hasVerifiedSnapshot ? runs : [];
  const verifiedHasMore = hasVerifiedSnapshot ? hasMore : false;
  const verifiedStaleRunIds = hasVerifiedSnapshot ? staleRunIds : EMPTY_STALE_RUN_IDS;

  useEffect(() => {
    const timer = setInterval(() => setFreshnessTick((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const requestGeneration = ++listRequestGenerationRef.current;
    const capturedScopeKey = readScopeKey;
    const capturedAuthority = exactReadAuthority;
    const requestTargetsCurrentScope = () => (
      listRequestGenerationRef.current === requestGeneration
      && currentReadScopeKeyRef.current === capturedScopeKey
    );
    (async () => {
      setLoading(true);
      setLoadError(null);
      if (!capturedAuthority || !isRunsReadAuthorityCurrent(capturedAuthority, isIdentityAuthorityCurrent)) {
        if (requestTargetsCurrentScope()) {
          setLoadError('Runs are locked until this Office session has exact user and circle authority.');
          setLoading(false);
          setLoadingMore(false);
        }
        return;
      }
      try {
        const { listRunsForAgentSubject } = await import('../../../../lib/agentRunSystem');
        if (
          !requestTargetsCurrentScope()
          || !isRunsReadAuthorityCurrent(capturedAuthority, isIdentityAuthorityCurrent)
        ) return;
        // Fetch one extra row so we know whether to show "load more"
        const strictReadOptions: AgentRunStrictReadOptions = {
          strict: true,
          authority: capturedAuthority,
          isAuthorityCurrent: isIdentityAuthorityCurrent,
        };
        const rawData = await listRunsForAgentSubject(circleId, {
          agentId,
          agentAliases: normalizedAgentAliases,
          agentName,
          limit: pageSize + 1,
        }, strictReadOptions);
        // Run-reaper: classify liveness off the heartbeat column only.
        // started_at deliberately OMITTED so runs from producers that never
        // heartbeat classify as 'live' (core fail-safe), not false-reaped.
        const reapPlan = planRunReap(
          rawData.map((r) => ({ id: r.id, status: r.status, updated_at: r.updated_at })),
          Date.now(),
        );
        const data = rawData;
        if (
          !requestTargetsCurrentScope()
          || !isRunsReadAuthorityCurrent(capturedAuthority, isIdentityAuthorityCurrent)
        ) return;
        setStaleRunIds(new Set([
          ...reapPlan.stale,
          ...reapPlan.toReap,
        ]));
        if (data.length > pageSize) {
          setRuns(data.slice(0, pageSize));
          setHasMore(true);
        } else {
          setRuns(data);
          setHasMore(false);
        }
        setVerifiedScopeKey(capturedScopeKey);
      } catch (err) {
        console.warn('[AgentRunsPanel] Failed to list runs:', err);
        if (requestTargetsCurrentScope()) {
          setLoadError('Runs could not be loaded. Check the connection and try again.');
        }
      } finally {
        if (requestTargetsCurrentScope()) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    })();
    return () => {
      if (listRequestGenerationRef.current === requestGeneration) {
        listRequestGenerationRef.current += 1;
      }
    };
  }, [
    agentId,
    agentName,
    circleId,
    exactReadAuthority,
    isIdentityAuthorityCurrent,
    normalizedAgentAliasesKey,
    pageSize,
    readScopeKey,
    reloadGeneration,
  ]);

  const loadRunDetails = useCallback(async (runId: string) => {
    const requestGeneration = ++detailRequestGenerationRef.current;
    const capturedScopeKey = readScopeKey;
    const capturedAuthority = exactReadAuthority;
    const requestTargetsCurrentScope = () => (
      detailRequestGenerationRef.current === requestGeneration
      && currentReadScopeKeyRef.current === capturedScopeKey
    );
    setRunDetails({ runId, status: 'loading', steps: [], childRuns: [], error: null });
    if (!capturedAuthority || !isRunsReadAuthorityCurrent(capturedAuthority, isIdentityAuthorityCurrent)) {
      if (requestTargetsCurrentScope()) {
        setRunDetails({
          runId,
          status: 'error',
          steps: [],
          childRuns: [],
          error: 'Run details are locked until this Office session has exact authority.',
        });
      }
      return;
    }
    try {
      const { getRunSteps, listChildRuns } = await import('../../../../lib/agentRunSystem');
      if (
        !requestTargetsCurrentScope()
        || !isRunsReadAuthorityCurrent(capturedAuthority, isIdentityAuthorityCurrent)
      ) return;
      const strictReadOptions: AgentRunStrictReadOptions = {
        strict: true,
        authority: capturedAuthority,
        isAuthorityCurrent: isIdentityAuthorityCurrent,
      };
      const [stepData, childRunData] = await Promise.all([
        getRunSteps(runId, strictReadOptions),
        listChildRuns(runId, 12, strictReadOptions),
      ]);
      if (detailRequestGenerationRef.current !== requestGeneration) return;
      if (
        !requestTargetsCurrentScope()
        || !isRunsReadAuthorityCurrent(capturedAuthority, isIdentityAuthorityCurrent)
      ) return;
      setRunDetails({ runId, status: 'ready', steps: stepData, childRuns: childRunData, error: null });
    } catch (err) {
      console.warn('[AgentRunsPanel] Failed to load run steps:', err);
      if (!requestTargetsCurrentScope()) return;
      setRunDetails({
        runId,
        status: 'error',
        steps: [],
        childRuns: [],
        error: 'Run details could not be loaded. Try again.',
      });
    }
  }, [exactReadAuthority, isIdentityAuthorityCurrent, readScopeKey]);

  useEffect(() => {
    detailRequestGenerationRef.current += 1;
    setExpandedRun(null);
    setRunDetails(EMPTY_RUN_DETAILS);
  }, [readScopeKey]);

  useEffect(() => () => {
    detailRequestGenerationRef.current += 1;
    listRequestGenerationRef.current += 1;
  }, []);

  const visibleRuns = useMemo(
    () => verifiedRuns.filter(r => matchesFilter(r, statusFilter, Date.now())),
    [verifiedRuns, statusFilter, freshnessTick],
  );

  const filterCounts = useMemo(() => ({
    all: verifiedRuns.length,
    completed: verifiedRuns.filter(r => matchesFilter(r, 'completed', Date.now())).length,
    running: verifiedRuns.filter(r => matchesFilter(r, 'running', Date.now())).length,
    failed: verifiedRuns.filter(r => matchesFilter(r, 'failed', Date.now())).length,
  }), [verifiedRuns, freshnessTick]);
  const qualityAggregate = useMemo(
    () => buildOpenSwanObservedEvalAggregate(
      verifiedRuns
        .map((run) => buildRunMetadataSummaryProps(run.metadata).observedEval)
        .filter(Boolean),
    ),
    [verifiedRuns],
  );
  const qualityDashboard = useMemo(
    () => buildOpenSwanObservedEvalDashboard(verifiedRuns),
    [verifiedRuns],
  );

  const filters: Array<{ key: StatusFilter; label: string; color: string }> = [
    { key: 'all', label: 'ALL', color: '#a0a0b0' },
    { key: 'completed', label: 'DONE', color: '#22c55e' },
    { key: 'running', label: 'ACTIVE', color: '#3b82f6' },
    { key: 'failed', label: 'FAILED', color: '#ef4444' },
  ];
  const runDataResolved = hasVerifiedSnapshot;

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>AGENT RUNS</Text>
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>({verifiedRuns.length}{verifiedHasMore ? '+' : ''})</Text>
        <Text style={{ color: '#606075', fontSize: 11, fontFamily: MONO }} numberOfLines={1}>{agentName}</Text>
        {loading && hasVerifiedSnapshot ? (
          <Text accessibilityLiveRegion="polite" style={{ color: '#707086', fontSize: 10, fontFamily: MONO }}>REFRESHING…</Text>
        ) : null}
      </View>

      {loadError ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#2a0b0b', borderRadius: 2, padding: 10, gap: 8 }}>
          <Text style={{ color: '#fca5a5', fontSize: 12, fontFamily: MONO, lineHeight: 17 }}>{loadError}</Text>
          {verifiedRuns.length > 0 ? (
            <Text style={{ color: '#d1a2a2', fontSize: 11, fontFamily: MONO }}>Showing the last loaded run list.</Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading agent runs"
            accessibilityState={{ disabled: loading, busy: loading }}
            disabled={loading}
            onPress={() => setReloadGeneration(value => value + 1)}
            style={[{ alignSelf: 'flex-start', minHeight: 44, minWidth: 72, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444466', borderRadius: 2, alignItems: 'center', justifyContent: 'center', opacity: loading ? 0.55 : 1 }, Platform.OS === 'web' && ({ cursor: loading ? 'default' : 'pointer' } as any)]}
          >
            <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>{loading ? 'RETRYING…' : 'RETRY'}</Text>
          </Pressable>
        </View>
      ) : null}

      {runDataResolved ? (
        <>
          <OpenSwanQualityAggregate
            aggregate={qualityAggregate}
            title="QUALITY SNAPSHOT"
            accentColor={accentColor}
          />

          <OpenSwanQualityDashboard
            dashboard={qualityDashboard}
            title="QUALITY DASHBOARD"
            accentColor={accentColor}
          />

          {/* Filter pills — solid background when active, tint when idle. Disabled
              style (50% opacity) when the bucket is empty so users don't think
              they've filtered to nothing by mistake. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {filters.map(f => {
              const active = statusFilter === f.key;
              const count = filterCounts[f.key];
              const empty = count === 0;
              return (
                <Pressable
                  key={f.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${f.label.toLowerCase()} runs, ${count}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => setStatusFilter(f.key)}
                  style={[
                    {
                      paddingHorizontal: 10,
                      minHeight: 44,
                      minWidth: 44,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: active ? f.color : '#2a2a3e',
                      backgroundColor: active ? f.color : 'transparent',
                      opacity: empty && !active ? 0.4 : 1,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 5,
                    },
                    Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                  ]}
                >
                  <Text style={{ color: active ? '#0a0a0a' : f.color, fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: MONO }}>{f.label}</Text>
                  <Text style={{ color: active ? '#0a0a0a' : '#707086', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>{count}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <View>
        {loading && !hasVerifiedSnapshot ? (
          <ActivityIndicator accessibilityLabel="Loading agent runs" accessibilityRole="progressbar" size="small" color={accentColor} style={{ padding: 20 }} />
        ) : loadError && runs.length === 0 ? null : loadError && verifiedRuns.length === 0 ? null : visibleRuns.length === 0 ? (
          <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>
            {verifiedRuns.length === 0 ? 'No runs yet.' : `No ${statusFilter === 'all' ? '' : statusFilter + ' '}runs.`}
          </Text>
        ) : (
          <>
            {visibleRuns.map((run: any) => {
              const isExpanded = expandedRun === run.id;
              const currentDetails = isExpanded && runDetails.runId === run.id ? runDetails : null;
              const awaitingExternalResult = isAwaitingConnectedAgentResultMetadata(run.metadata);
              const runPresentation = describeRunHistoryStatus(run, Date.now());
              const sc = runPresentation.stale ? '#f59e0b' : awaitingExternalResult ? '#60a5fa' : (STATUS_COLORS[run.status] || '#606075');
              // Compact summary pieces — coalesce into a single subtitle line
              const tokenSummary = run.input_tokens > 0 || run.output_tokens > 0
                ? `${formatTokens((run.input_tokens || 0) + (run.output_tokens || 0))} tokens`
                : null;
              const costSummary = run.estimated_cost > 0
                ? `$${run.estimated_cost.toFixed(run.estimated_cost < 0.01 ? 4 : 3)}`
                : null;
              const metadataSummary = buildRunMetadataSummaryProps(run.metadata);
              const subjectSummary = getRunSubjectSummary(run, agentName);

              return (
                <View key={run.id} style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: isExpanded ? sc + '40' : '#1a1a28', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} run: ${String(run.title || 'Untitled run')}`}
                    accessibilityState={{ expanded: isExpanded }}
                    onPress={() => {
                      if (isExpanded) {
                        detailRequestGenerationRef.current += 1;
                        setExpandedRun(null);
                        setRunDetails(EMPTY_RUN_DETAILS);
                      } else {
                        setExpandedRun(run.id);
                        void loadRunDetails(run.id);
                      }
                    }}
                    style={[{ padding: 12, minHeight: 44 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sc }} />
                      <Text style={{ color: '#f0f0f5', fontSize: 13, fontWeight: '600', fontFamily: MONO, flex: 1 }} numberOfLines={1}>{run.title || 'Untitled run'}</Text>
                      {verifiedStaleRunIds.has(run.id) ? (
                        <Text style={{ color: '#f59e0b', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>STALLED?</Text>
                      ) : null}
                      <Text style={{ color: sc, fontSize: 11, fontWeight: '700', fontFamily: MONO }}>
                        {runPresentation.stale
                          ? (awaitingExternalResult ? 'ACCEPTED · UPDATE MISSING · NOT ACTIVE' : runPresentation.label)
                          : (awaitingExternalResult ? 'ACCEPTED · AWAITING UPDATE' : runPresentation.label)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
                      <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{run.surface}</Text>
                      {run.mode && run.mode !== 'talk' && <Text style={{ color: '#909098', fontSize: 11, fontFamily: MONO }}>{run.mode}</Text>}
                      {run.delegated_to && <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{run.delegated_to}</Text>}
                      <RunMetadataSummary
                        {...metadataSummary}
                        variant="compact"
                        accentColor="#38bdf8"
                      />
                      {subjectSummary.subjectKey ? (
                        <Text style={{ color: accentColor, fontSize: 11, fontFamily: MONO }} numberOfLines={1}>
                          SUBJECT {subjectSummary.subjectKey}{subjectSummary.aliases.length > 0 ? ` +${subjectSummary.aliases.length}` : ''}
                        </Text>
                      ) : null}
                      {tokenSummary && <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{tokenSummary}</Text>}
                      {costSummary && <Text style={{ color: '#22c55e', fontSize: 11, fontFamily: MONO }}>{costSummary}</Text>}
                      <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, marginLeft: 'auto' }}>{new Date(run.created_at).toLocaleTimeString()}</Text>
                    </View>
                  </Pressable>

                  {isExpanded && (
                    <View style={{ paddingHorizontal: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#1a1a28', paddingTop: 6 }}>
                      {(subjectSummary.subjectKey || subjectSummary.aliases.length > 0 || subjectSummary.dbId) ? (
                        <View style={{ borderWidth: 1, borderColor: '#24243a', backgroundColor: '#0b0b14', borderRadius: 2, padding: 8, marginBottom: 8, gap: 5 }}>
                          <Text style={{ color: '#909098', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: MONO }}>
                            SUBJECT IDENTITY
                          </Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                            {subjectSummary.displayName ? (
                              <Text style={{ color: '#d8d8e8', fontSize: 11, fontFamily: MONO }}>{subjectSummary.displayName}</Text>
                            ) : null}
                            {subjectSummary.subjectKey ? (
                              <Text style={{ color: accentColor, fontSize: 11, fontFamily: MONO }}>{subjectSummary.subjectKey}</Text>
                            ) : null}
                            {subjectSummary.dbId ? (
                              <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{subjectSummary.dbId.slice(0, 8)}</Text>
                            ) : null}
                          </View>
                          {subjectSummary.aliases.length > 0 ? (
                            <Text style={{ color: '#707086', fontSize: 10, fontFamily: MONO }} numberOfLines={2}>
                              aliases {subjectSummary.aliases.slice(0, 8).join(' · ')}{subjectSummary.aliases.length > 8 ? ` · +${subjectSummary.aliases.length - 8}` : ''}
                            </Text>
                          ) : null}
                        </View>
                      ) : null}
                      {!currentDetails || currentDetails.status === 'loading' ? (
                        <View accessibilityLiveRegion="polite" style={{ minHeight: 64, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          <ActivityIndicator accessibilityLabel={`Loading details for ${String(run.title || 'run')}`} accessibilityRole="progressbar" size="small" color={accentColor} />
                          <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>Loading run details…</Text>
                        </View>
                      ) : currentDetails.status === 'error' ? (
                        <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ borderWidth: 1, borderColor: '#ef444455', backgroundColor: '#2a0b0b', borderRadius: 2, padding: 10, gap: 8 }}>
                          <Text style={{ color: '#fca5a5', fontSize: 12, fontFamily: MONO }}>{currentDetails.error}</Text>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Retry loading details for ${String(run.title || 'run')}`}
                            onPress={() => { void loadRunDetails(run.id); }}
                            style={[{ alignSelf: 'flex-start', minHeight: 44, minWidth: 72, paddingHorizontal: 12, borderWidth: 1, borderColor: '#ef444466', borderRadius: 2, alignItems: 'center', justifyContent: 'center' }, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
                          >
                            <Text style={{ color: '#fca5a5', fontSize: 11, fontWeight: '800', fontFamily: MONO }}>RETRY DETAILS</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <>
                      {currentDetails.childRuns.length > 0 ? (
                        <View style={{ marginBottom: 10, gap: 6 }}>
                          <Text style={{ color: '#7c3aed', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: MONO }}>
                            DELEGATED SPECIALISTS
                          </Text>
                          {currentDetails.childRuns.map((childRun: any) => {
                            const childSummary = buildRunMetadataSummaryProps(childRun.metadata);
                            const childStatusColor = STATUS_COLORS[childRun.status] || '#606075';
                            const childObservedEval = childSummary.observedEval;
                            const childQualityTone = getChildQualityTone(childObservedEval?.outcome);
                            const weakestSignalLabel = getWeakestSignalLabel(childObservedEval);
                            return (
                              <Pressable
                                key={childRun.id}
                                accessibilityRole="button"
                                accessibilityLabel={`Open specialist run: ${String(childRun.title || childRun.mode || 'Untitled run')}`}
                                onPress={() => {
                                  setExpandedRun(childRun.id);
                                  void loadRunDetails(childRun.id);
                                }}
                                style={{
                                  borderWidth: 1,
                                  borderColor: '#312e81',
                                  backgroundColor: '#0a1022',
                                  borderRadius: 2,
                                  padding: 8,
                                  minHeight: 44,
                                  gap: 5,
                                  ...(Platform.OS === 'web' ? { cursor: 'pointer' as const } : null),
                                }}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                  <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: childStatusColor }} />
                                  <Text style={{ color: '#e9d5ff', fontSize: 11, fontWeight: '700', fontFamily: MONO, flex: 1 }} numberOfLines={1}>
                                    {childRun.delegated_to ? `${String(childRun.delegated_to).toUpperCase()} · ` : ''}{childRun.title || childRun.mode}
                                  </Text>
                                  <Text style={{ color: childStatusColor, fontSize: 10, fontWeight: '700', fontFamily: MONO }}>
                                    {String(childRun.status).toUpperCase()}
                                  </Text>
                                </View>
                                {childObservedEval ? (
                                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                                    <View style={{
                                      paddingHorizontal: 8,
                                      paddingVertical: 4,
                                      borderRadius: 999,
                                      borderWidth: 1,
                                      borderColor: childQualityTone.border,
                                      backgroundColor: childQualityTone.bg,
                                    }}>
                                      <Text style={{ color: childQualityTone.text, fontSize: 10, fontWeight: '800', fontFamily: MONO }}>
                                        {String(childObservedEval.outcome || 'partial').toUpperCase()} {childObservedEval.score}
                                      </Text>
                                    </View>
                                    {weakestSignalLabel ? (
                                      <View style={{
                                        paddingHorizontal: 8,
                                        paddingVertical: 4,
                                        borderRadius: 999,
                                        borderWidth: 1,
                                        borderColor: '#3f3f5a',
                                        backgroundColor: '#121226',
                                      }}>
                                        <Text style={{ color: '#c4b5fd', fontSize: 10, fontWeight: '700', fontFamily: MONO }}>
                                          WEAKEST {weakestSignalLabel.toUpperCase()}
                                        </Text>
                                      </View>
                                    ) : null}
                                  </View>
                                ) : null}
                                <RunMetadataSummary
                                  {...childSummary}
                                  variant="compact"
                                  accentColor="#a855f7"
                                />
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : null}
                      {currentDetails.steps.length === 0 ? (
                        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, fontStyle: 'italic' }}>No steps recorded.</Text>
                      ) : (
                        currentDetails.steps.map((step: any) => (
                          <View key={step.id} style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>
                            <View style={{ width: 2, backgroundColor: STEP_COLORS[step.step_kind] || '#1a1a28', borderRadius: 1 }} />
                            <View style={{ flex: 1 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                <Text style={{ color: STEP_COLORS[step.step_kind] || '#606075', fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{step.step_kind}</Text>
                                {step.tool_name && <Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO }}>{step.tool_name}</Text>}
                                {step.delegated_to && <Text style={{ color: '#808090', fontSize: 10, fontFamily: MONO }}>{step.delegated_to}</Text>}
                              </View>
                              <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }} numberOfLines={2}>{step.title}</Text>
                              {step.body && <Text style={{ color: '#909098', fontSize: 11, fontFamily: MONO, marginTop: 1 }} numberOfLines={3}>{step.body.slice(0, 200)}</Text>}
                            </View>
                          </View>
                        ))
                      )}
                        </>
                      )}
                    </View>
                  )}
                </View>
              );
            })}

            {/* Load-more: visible only when the server returned a full page. The
                user doesn't know the true total (list endpoint has no count),
                so we show "Load 10 more" without a running tally. */}
            {verifiedHasMore && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Load ${PAGE_SIZE} more agent runs`}
                disabled={loadingMore}
                accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
                onPress={() => {
                  setLoadingMore(true);
                  setPageSize(size => size + PAGE_SIZE);
                }}
                style={[
                  {
                    marginTop: 4,
                    minHeight: 44,
                    borderRadius: 2,
                    borderWidth: 1,
                    borderColor: accentColor + '40',
                    backgroundColor: accentColor + '10',
                    alignItems: 'center',
                    justifyContent: 'center',
                  },
                  Platform.OS === 'web' && ({ cursor: loadingMore ? 'default' : 'pointer' } as any),
                ]}
              >
                <Text style={{ color: accentColor, fontSize: 11, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>
                  {loadingMore ? 'LOADING…' : `LOAD ${PAGE_SIZE} MORE`}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}
