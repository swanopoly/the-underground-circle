// HybridFocusChain — vertical timeline of HybridSteps for a given run.
// Renders for both the owner (writer of the run) and any observer in
// the circle (read-only via Realtime). Mirrors the Cline "Focus Chain"
// UX: each step gets a kind icon, a status pill, and an expandable
// output preview when completed.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useHybridSteps } from '../../lib/computerTaskSteps';
import type { HybridStepRecord, HybridStepStatus } from '../../lib/computerHybridTypes';

interface Props {
  runId: string | null;
  /** Renders inline in chat (compact) vs. as a panel section (full). */
  variant?: 'inline' | 'panel';
}

export default function HybridFocusChain({ runId, variant = 'panel' }: Props) {
  const { steps, loading } = useHybridSteps(runId);

  if (!runId) return null;
  if (loading && steps.length === 0) {
    return (
      <View style={[s.container, variant === 'inline' ? s.containerInline : null]}>
        <Text style={s.empty}>loading steps…</Text>
      </View>
    );
  }
  if (steps.length === 0) {
    return null;
  }

  return (
    <ScrollView
      style={[s.container, variant === 'inline' ? s.containerInline : null]}
      contentContainerStyle={s.content}
    >
      <Text style={s.heading}>HYBRID TASK · {steps.length} STEPS</Text>
      {steps.map((step, i) => (
        <StepRow key={step.id} step={step} isLast={i === steps.length - 1} />
      ))}
    </ScrollView>
  );
}

function StepRow({ step, isLast }: { step: HybridStepRecord; isLast: boolean }) {
  const [expanded, setExpanded] = useState<boolean>(false);
  const hasOutput = step.status === 'completed' && step.output;

  return (
    <View style={s.row}>
      <View style={s.gutter}>
        <View style={[s.dot, dotStyle(step.status)]} />
        {!isLast ? <View style={s.line} /> : null}
      </View>
      <View style={s.body}>
        <View style={s.headerLine}>
          <KindBadge kind={step.step_kind} />
          <StatusPill status={step.status} />
        </View>
        <Text style={s.task} numberOfLines={3}>{step.task}</Text>
        {step.rationale ? <Text style={s.rationale}>{step.rationale}</Text> : null}
        {step.error ? <Text style={s.error}>error: {step.error}</Text> : null}
        {hasOutput ? (
          <Pressable onPress={() => setExpanded((e) => !e)} style={s.outputToggle}>
            <Text style={s.outputToggleText}>{expanded ? '▾ HIDE OUTPUT' : '▸ SHOW OUTPUT'}</Text>
          </Pressable>
        ) : null}
        {hasOutput && expanded ? (
          <View style={s.outputBox}>
            <Text style={s.outputText} selectable>
              {previewOutput(step.output)}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function KindBadge({ kind }: { kind: HybridStepRecord['step_kind'] }) {
  const label = kind === 'file' ? 'FILE' : kind === 'app' ? 'APP' : 'BROWSER';
  const color = kind === 'file' ? '#22c55e' : kind === 'app' ? '#a855f7' : '#22d3ee';
  return (
    <View style={[s.badge, { borderColor: color + '80' }]}>
      <Text style={[s.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: HybridStepStatus }) {
  const label = status.toUpperCase();
  const color = statusColor(status);
  return (
    <View style={[s.pill, { backgroundColor: color + '15', borderColor: color + '50' }]}>
      <Text style={[s.pillText, { color }]}>{label}</Text>
    </View>
  );
}

function dotStyle(status: HybridStepStatus) {
  return { backgroundColor: statusColor(status) };
}

function statusColor(status: HybridStepStatus): string {
  switch (status) {
    case 'completed': return '#22c55e';
    case 'active':    return '#22d3ee';
    case 'blocked':   return '#ef4444';
    case 'skipped':   return '#71717a';
    case 'pending':
    default:          return '#52525b';
  }
}

function previewOutput(output: unknown): string {
  if (!output) return '';
  if (typeof output === 'string') return output.slice(0, 2000);
  try {
    return JSON.stringify(output, null, 2).slice(0, 2000);
  } catch {
    return String(output).slice(0, 2000);
  }
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    maxHeight: 480,
  },
  containerInline: {
    maxHeight: 320,
  },
  content: {
    paddingBottom: 4,
  },
  heading: {
    fontFamily: 'Menlo, Monaco, monospace',
    fontSize: 10,
    letterSpacing: 1.5,
    color: '#94a3b8',
    marginBottom: 12,
  },
  empty: {
    color: '#71717a',
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  gutter: {
    width: 16,
    alignItems: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  line: {
    flex: 1,
    width: 2,
    backgroundColor: '#1e293b',
    marginTop: 4,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  headerLine: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  badge: {
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: 'Menlo, Monaco, monospace',
    letterSpacing: 1,
    fontWeight: '700',
  },
  pill: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  pillText: {
    fontSize: 10,
    fontFamily: 'Menlo, Monaco, monospace',
    letterSpacing: 1,
    fontWeight: '700',
  },
  task: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 18,
  },
  rationale: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  error: {
    color: '#ef4444',
    fontSize: 12,
    fontFamily: 'Menlo, Monaco, monospace',
  },
  outputToggle: {
    paddingVertical: 4,
  },
  outputToggleText: {
    color: '#22d3ee',
    fontSize: 11,
    fontFamily: 'Menlo, Monaco, monospace',
    letterSpacing: 1,
  },
  outputBox: {
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    padding: 10,
  },
  outputText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontFamily: 'Menlo, Monaco, monospace',
    lineHeight: 15,
  },
});
