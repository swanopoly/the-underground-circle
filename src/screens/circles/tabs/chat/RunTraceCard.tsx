/**
 * RunTraceCard — live progress card for an OpenSwan agent run.
 * Subscribes to `agent_runs` + `agent_run_steps` for the given runId
 * and renders each step as a row with status dot, title, body, and
 * duration. Errors render with a click-to-expand "show details" line.
 *
 * Why it exists: when a multi-step run failed (e.g. the
 * franklintoyota.com login timeout) the user got a single text
 * line in chat with no way to see WHICH step failed or what came
 * before. This card surfaces every step inline as the run unfolds,
 * with realtime updates so the user can watch progress and
 * diagnose failures without leaving the chat tab.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, Platform } from 'react-native';
import {
  getRun,
  getRunSteps,
  subscribeToRun,
  updateRunStatus,
  type AgentRun,
  type RunStep,
} from '../../../../lib/agentRunSystem';
import { supabase } from '../../../../lib/supabase';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  runId: string;
  /** Tap callback for the "Run again" button — typically opens the
   *  OpenSwan Console prefilled with the same task + mode. */
  onRunAgain?: (run: AgentRun) => void;
  accentColor?: string;
}

const STATUS_DOT: Record<string, string> = {
  queued:           '#94a3b8',
  planning:         '#a78bfa',
  running:          '#a78bfa',
  waiting_approval: '#fbbf24',
  paused:           '#94a3b8',
  completed:        '#22c55e',
  failed:           '#ef4444',
  cancelled:        '#64748b',
  // Step statuses
  pending:          '#475569',
  done:             '#22c55e',
  error:            '#ef4444',
  skipped:          '#475569',
};

const STEP_KIND_GLYPH: Record<string, string> = {
  plan:        '☷',
  tool:        '⚙',
  message:     '✎',
  delegation:  '⤴',
  artifact:    '◧',
  verify:      '✓',
  observe:     '◉',
  error:       '⚠',
};

export default function RunTraceCard({ runId, onRunAgain, accentColor = '#a78bfa' }: Props) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [expandedStepIds, setExpandedStepIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  // Initial fetch + realtime wiring. Runs once per runId; cleanup
  // tears down both subscriptions on unmount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [r, s] = await Promise.all([getRun(runId), getRunSteps(runId)]);
      if (cancelled) return;
      setRun(r);
      setSteps(s);
      setLoading(false);
    })();

    const runSub = subscribeToRun(runId, (next) => {
      if (!cancelled) setRun(next);
    });
    // Single * channel handles both INSERT (new step row) and UPDATE
    // (status flip running → done/failed). Saves one subscription per
    // mounted card vs the previous insert + update split.
    const stepSub = supabase
      .channel(`run-steps:${runId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'agent_run_steps',
        filter: `run_id=eq.${runId}`,
      }, (payload) => {
        if (cancelled) return;
        const row = payload.new as any;
        if (!row) return;
        const step = mapStepRow(row);
        setSteps((prev) => {
          if (prev.some((p) => p.id === step.id)) {
            return prev.map((p) => (p.id === step.id ? step : p));
          }
          return [...prev, step].sort((a, b) => a.step_index - b.step_index);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      try { runSub.unsubscribe(); } catch {}
      try { stepSub.unsubscribe(); } catch {}
    };
  }, [runId]);

  const isLive = run?.status === 'running' || run?.status === 'planning' || run?.status === 'queued';
  const isFailed = run?.status === 'failed';
  const isDone = run?.status === 'completed';
  const headerDot = STATUS_DOT[run?.status || 'queued'] || '#94a3b8';

  const elapsedLabel = useMemo(() => {
    if (!run) return '—';
    const start = run.started_at ? new Date(run.started_at).getTime() : null;
    const end = run.completed_at ? new Date(run.completed_at).getTime() : Date.now();
    if (!start) return '—';
    const ms = end - start;
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60_000) / 1000)}s`;
  }, [run]);

  const toggleStep = (id: string) => {
    setExpandedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <View style={[s.card, { borderColor: accentColor + '40' }]}>
        <View style={s.loadingRow}>
          <ActivityIndicator color={accentColor} size="small" />
          <Text style={s.loadingText}>Loading run trace…</Text>
        </View>
      </View>
    );
  }

  if (!run) {
    return (
      <View style={[s.card, { borderColor: '#ef444440' }]}>
        <Text style={[s.kicker, { color: '#fca5a5' }]}>RUN NOT FOUND</Text>
        <Text style={s.errorBody}>Run id {runId.slice(0, 8)} couldn't be loaded.</Text>
      </View>
    );
  }

  return (
    <View
      style={[s.card, { borderColor: accentColor + '40' }]}
      nativeID={`section-run-trace-${runId.slice(0, 8)}`}
    >
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={[s.dot, { backgroundColor: headerDot }]} />
          {isLive ? <ActivityIndicator color={headerDot} size="small" style={{ marginRight: 4 }} /> : null}
          <Text style={[s.kicker, { color: accentColor }]}>RUN TRACE</Text>
          <View style={s.modeChip}>
            <Text style={s.modeChipText}>{run.mode}</Text>
          </View>
        </View>
        <Text style={s.statusText}>{run.status.toUpperCase()}</Text>
      </View>

      <Text style={s.title} numberOfLines={2}>{run.title || run.goal || '(untitled run)'}</Text>

      <View style={s.metaRow}>
        <Text style={s.metaText}>
          {steps.length} step{steps.length === 1 ? '' : 's'} · {elapsedLabel}
          {run.estimated_cost > 0 ? ` · $${run.estimated_cost.toFixed(3)}` : ''}
          {run.input_tokens + run.output_tokens > 0
            ? ` · ${((run.input_tokens + run.output_tokens) / 1000).toFixed(1)}K tokens`
            : ''}
        </Text>
      </View>

      {isFailed && run.metadata?.error_message ? (
        <View style={s.errorBox}>
          <Text style={s.errorLabel}>RUN ERROR</Text>
          <Text style={s.errorBody}>{String(run.metadata.error_message).slice(0, 400)}</Text>
        </View>
      ) : null}

      <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 4 }}>
        {steps.length === 0 ? (
          <Text style={s.emptyHint}>
            {isLive ? 'Waiting for first step…' : 'No steps recorded.'}
          </Text>
        ) : (
          steps.map((step) => {
            const dot = STATUS_DOT[step.status] || '#475569';
            const glyph = STEP_KIND_GLYPH[step.step_kind] || '·';
            const isExpanded = expandedStepIds.has(step.id);
            const hasBody = !!step.body && step.body.length > 0;
            const stepDuration =
              step.duration_ms === undefined || step.duration_ms === null
                ? null
                : step.duration_ms < 1000
                  ? `${step.duration_ms}ms`
                  : `${(step.duration_ms / 1000).toFixed(1)}s`;
            return (
              <Pressable
                key={step.id}
                onPress={hasBody ? () => toggleStep(step.id) : undefined}
                style={({ pressed }) => [
                  s.stepRow,
                  step.status === 'error' && { borderColor: '#ef444455', backgroundColor: '#7f1d1d10' },
                  pressed && hasBody && { backgroundColor: accentColor + '10' },
                ]}
              >
                <View style={s.stepHead}>
                  <View style={[s.dot, { backgroundColor: dot }]} />
                  <Text style={s.stepGlyph}>{glyph}</Text>
                  <View style={s.stepIndex}>
                    <Text style={s.stepIndexText}>{step.step_index}</Text>
                  </View>
                  <Text style={s.stepTitle} numberOfLines={isExpanded ? 0 : 1}>{step.title}</Text>
                  {stepDuration ? <Text style={s.stepDuration}>{stepDuration}</Text> : null}
                  {hasBody ? <Text style={s.stepChevron}>{isExpanded ? '▾' : '▸'}</Text> : null}
                </View>
                {isExpanded && hasBody ? (
                  <Text style={s.stepBody}>{String(step.body).slice(0, 1200)}</Text>
                ) : null}
                {step.tool_name ? (
                  <Text style={s.stepTool}>tool: <Text style={s.stepToolName}>{step.tool_name}</Text></Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View style={s.actionRow}>
        {isLive ? (
          <Pressable
            onPress={async () => {
              if (cancelling) return;
              setCancelling(true);
              // Optimistic local update so the UI flips immediately,
              // even if the realtime UPDATE event takes a beat.
              setRun((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
              try {
                await updateRunStatus(runId, 'cancelled', {
                  metadata: {
                    ...(run.metadata || {}),
                    cancelled_by: 'user',
                    cancelled_at: new Date().toISOString(),
                  },
                });
              } catch {
                // Revert if the write failed — the realtime sub will
                // eventually correct us anyway, but this is faster.
                setRun((prev) => (prev && prev.status === 'cancelled' ? { ...prev, status: 'running' } : prev));
              } finally {
                setCancelling(false);
              }
            }}
            disabled={cancelling}
            style={({ pressed }) => [
              s.stopBtn,
              pressed && { backgroundColor: '#ef444420' },
              cancelling && { opacity: 0.5 },
            ]}
            accessibilityLabel="Stop this run"
          >
            <Text style={s.stopText}>{cancelling ? 'STOPPING…' : '■ STOP'}</Text>
          </Pressable>
        ) : null}
        {(isFailed || isDone || run.status === 'cancelled') && onRunAgain ? (
          <Pressable
            onPress={() => onRunAgain(run)}
            style={({ pressed }) => [
              s.runAgainBtn,
              { borderColor: accentColor + '60' },
              pressed && { backgroundColor: accentColor + '15' },
            ]}
            accessibilityLabel="Re-run this task"
          >
            <Text style={[s.runAgainText, { color: accentColor }]}>↺ RUN AGAIN</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

// Local copy of the row→RunStep mapper since agentRunSystem doesn't
// export it. Mirrors agentRunSystem.mapStep() exactly.
function mapStepRow(row: any): RunStep {
  return {
    id: row.id,
    run_id: row.run_id,
    step_index: row.step_index,
    step_kind: row.step_kind,
    title: row.title || '',
    body: row.body || undefined,
    tool_name: row.tool_name || undefined,
    tool_input: row.tool_input || undefined,
    tool_output: row.tool_output || undefined,
    delegated_to: row.delegated_to || undefined,
    child_run_id: row.child_run_id || undefined,
    status: row.status || 'pending',
    duration_ms: row.duration_ms ?? undefined,
    tokens_used: row.tokens_used ?? 0,
    created_at: row.created_at,
    metadata: row.metadata || {},
  };
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  loadingText: { color: '#94a3b8', fontSize: 11, fontFamily: MONO },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 999 },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  modeChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    marginLeft: 4,
  },
  modeChipText: {
    color: '#cbd5e1',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: MONO,
  },
  statusText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: MONO,
  },
  title: { color: '#e2e8f0', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  metaRow: { flexDirection: 'row', alignItems: 'center' },
  metaText: { color: '#64748b', fontSize: 10, fontFamily: MONO },
  errorBox: {
    backgroundColor: '#7f1d1d20',
    borderWidth: 1,
    borderColor: '#ef444455',
    borderRadius: 8,
    padding: 8,
    gap: 4,
  },
  errorLabel: { color: '#fca5a5', fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: MONO },
  errorBody: { color: '#fecaca', fontSize: 11, lineHeight: 16, fontFamily: MONO },
  emptyHint: { color: '#64748b', fontSize: 11, fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  stepRow: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 6,
    padding: 8,
    gap: 4,
  },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepGlyph: { color: '#94a3b8', fontSize: 12, width: 14, textAlign: 'center', fontFamily: MONO },
  stepIndex: {
    backgroundColor: '#020617',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 22,
    alignItems: 'center',
  },
  stepIndexText: { color: '#64748b', fontSize: 9, fontFamily: MONO, fontWeight: '700' },
  stepTitle: { color: '#cbd5e1', fontSize: 11.5, flex: 1, fontWeight: '600' },
  stepDuration: { color: '#475569', fontSize: 9, fontFamily: MONO },
  stepChevron: { color: '#475569', fontSize: 10, fontFamily: MONO, marginLeft: 2 },
  stepBody: { color: '#94a3b8', fontSize: 10.5, lineHeight: 15, paddingLeft: 30, fontFamily: MONO },
  stepTool: { color: '#64748b', fontSize: 10, paddingLeft: 30 },
  stepToolName: { color: '#a78bfa', fontFamily: MONO },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  runAgainBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  runAgainText: { fontSize: 10, fontWeight: '900', letterSpacing: 1, fontFamily: MONO },
  stopBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ef444460',
    backgroundColor: '#7f1d1d10',
  },
  stopText: {
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: MONO,
  },
});
