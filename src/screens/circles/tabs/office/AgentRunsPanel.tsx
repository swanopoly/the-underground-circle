import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { MONO, formatTokens } from './AgentPanelShared';

type StatusFilter = 'all' | 'completed' | 'running' | 'failed';

const PAGE_SIZE = 10;

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

// Matches a run object to the active filter. `running` bucket covers any
// "in progress" state users conceptually think of as "currently working".
function matchesFilter(run: any, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'completed') return run.status === 'completed';
  if (filter === 'failed') return run.status === 'failed';
  if (filter === 'running') {
    return run.status === 'running'
      || run.status === 'planning'
      || run.status === 'queued'
      || run.status === 'paused'
      || run.status === 'waiting_approval';
  }
  return true;
}

export default function AgentRunsPanel({ circleId, agentId, agentName, accentColor }: { circleId: string; agentId: string; agentName: string; accentColor: string }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { listRuns } = await import('../../../../lib/agentRunSystem');
        // Fetch one extra row so we know whether to show "load more"
        const data = await listRuns(circleId, { agentId, limit: pageSize + 1 });
        if (cancelled) return;
        if (data.length > pageSize) {
          setRuns(data.slice(0, pageSize));
          setHasMore(true);
        } else {
          setRuns(data);
          setHasMore(false);
        }
      } catch (err) {
        console.warn('[AgentRunsPanel] Failed to list runs:', err);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [agentId, circleId, pageSize]);

  const loadSteps = async (runId: string) => {
    try {
      const { getRunSteps } = await import('../../../../lib/agentRunSystem');
      const data = await getRunSteps(runId);
      setSteps(data);
    } catch (err) {
      console.warn('[AgentRunsPanel] Failed to load run steps:', err);
    }
  };

  const visibleRuns = useMemo(
    () => runs.filter(r => matchesFilter(r, statusFilter)),
    [runs, statusFilter],
  );

  const filterCounts = useMemo(() => ({
    all: runs.length,
    completed: runs.filter(r => matchesFilter(r, 'completed')).length,
    running: runs.filter(r => matchesFilter(r, 'running')).length,
    failed: runs.filter(r => matchesFilter(r, 'failed')).length,
  }), [runs]);

  const filters: Array<{ key: StatusFilter; label: string; color: string }> = [
    { key: 'all', label: 'ALL', color: '#a0a0b0' },
    { key: 'completed', label: 'DONE', color: '#22c55e' },
    { key: 'running', label: 'RUNNING', color: '#3b82f6' },
    { key: 'failed', label: 'FAILED', color: '#ef4444' },
  ];

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={{ color: '#909098', fontSize: 12, fontWeight: '700', letterSpacing: 1, fontFamily: MONO }}>AGENT RUNS</Text>
        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO }}>({runs.length}{hasMore ? '+' : ''})</Text>
        <Text style={{ color: '#606075', fontSize: 11, fontFamily: MONO }} numberOfLines={1}>{agentName}</Text>
      </View>

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
              onPress={() => setStatusFilter(f.key)}
              style={[
                {
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? f.color : '#2a2a3e',
                  backgroundColor: active ? f.color : 'transparent',
                  opacity: empty && !active ? 0.4 : 1,
                  flexDirection: 'row',
                  alignItems: 'center',
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

      <ScrollView style={{ maxHeight: 400 }} nestedScrollEnabled showsVerticalScrollIndicator>
        {loading ? (
          <ActivityIndicator size="small" color={accentColor} style={{ padding: 20 }} />
        ) : visibleRuns.length === 0 ? (
          <Text style={{ color: '#808090', fontSize: 13, fontFamily: MONO, fontStyle: 'italic', padding: 12, textAlign: 'center' }}>
            {runs.length === 0 ? 'No runs yet.' : `No ${statusFilter === 'all' ? '' : statusFilter + ' '}runs.`}
          </Text>
        ) : (
          <>
            {visibleRuns.map((run: any) => {
              const isExpanded = expandedRun === run.id;
              const sc = STATUS_COLORS[run.status] || '#606075';
              // Compact summary pieces — coalesce into a single subtitle line
              const tokenSummary = run.input_tokens > 0 || run.output_tokens > 0
                ? `${formatTokens((run.input_tokens || 0) + (run.output_tokens || 0))} tokens`
                : null;
              const costSummary = run.estimated_cost > 0
                ? `$${run.estimated_cost.toFixed(run.estimated_cost < 0.01 ? 4 : 3)}`
                : null;

              return (
                <View key={run.id} style={{ backgroundColor: '#0f0f18', borderWidth: 1, borderColor: isExpanded ? sc + '40' : '#1a1a28', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                  <Pressable
                    onPress={() => { if (isExpanded) { setExpandedRun(null); } else { setExpandedRun(run.id); loadSteps(run.id); } }}
                    style={[{ padding: 12 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sc }} />
                      <Text style={{ color: '#f0f0f5', fontSize: 13, fontWeight: '600', fontFamily: MONO, flex: 1 }} numberOfLines={1}>{run.title || 'Untitled run'}</Text>
                      <Text style={{ color: sc, fontSize: 11, fontWeight: '700', fontFamily: MONO }}>{run.status.toUpperCase()}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 }}>
                      <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{run.surface}</Text>
                      {run.mode && run.mode !== 'talk' && <Text style={{ color: '#909098', fontSize: 11, fontFamily: MONO }}>{run.mode}</Text>}
                      {run.delegated_to && <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{run.delegated_to}</Text>}
                      {tokenSummary && <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO }}>{tokenSummary}</Text>}
                      {costSummary && <Text style={{ color: '#22c55e', fontSize: 11, fontFamily: MONO }}>{costSummary}</Text>}
                      <Text style={{ color: '#808090', fontSize: 11, fontFamily: MONO, marginLeft: 'auto' }}>{new Date(run.created_at).toLocaleTimeString()}</Text>
                    </View>
                  </Pressable>

                  {isExpanded && (
                    <View style={{ paddingHorizontal: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#1a1a28', paddingTop: 6 }}>
                      {steps.length === 0 ? (
                        <Text style={{ color: '#808090', fontSize: 12, fontFamily: MONO, fontStyle: 'italic' }}>No steps recorded.</Text>
                      ) : (
                        steps.map((step: any) => (
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
                    </View>
                  )}
                </View>
              );
            })}

            {/* Load-more: visible only when the server returned a full page. The
                user doesn't know the true total (list endpoint has no count),
                so we show "Load 10 more" without a running tally. */}
            {hasMore && (
              <Pressable
                disabled={loadingMore}
                onPress={() => {
                  setLoadingMore(true);
                  setPageSize(size => size + PAGE_SIZE);
                  // loadingMore clears when the fetch effect re-runs and sets loading=false.
                  setTimeout(() => setLoadingMore(false), 600);
                }}
                style={[
                  {
                    marginTop: 4,
                    paddingVertical: 10,
                    borderRadius: 2,
                    borderWidth: 1,
                    borderColor: accentColor + '40',
                    backgroundColor: accentColor + '10',
                    alignItems: 'center',
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
      </ScrollView>
    </View>
  );
}
