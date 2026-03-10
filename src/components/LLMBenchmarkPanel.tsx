/**
 * LLMBenchmarkPanel — Compare BlackSwan LLM against industry models
 *
 * Horizontal bar chart showing benchmark scores for various LLMs,
 * from top-tier (Opus, GPT-4) down to small models and BlackSwan.
 * Tracks training progress over time as BlackSwan improves.
 */

import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import {
  PIXEL_COLORS, GRID, PX,
} from '../lib/pixelDesign';

// ─── Benchmark Categories ────────────────────────────────────────────

type BenchmarkKey = 'mmlu' | 'humaneval' | 'gsm8k' | 'hellaswag' | 'arc' | 'overall';

interface BenchmarkDef {
  key: BenchmarkKey;
  label: string;
  description: string;
}

const BENCHMARKS: BenchmarkDef[] = [
  { key: 'overall',   label: 'Overall',    description: 'Weighted average across all benchmarks' },
  { key: 'mmlu',      label: 'MMLU',       description: 'Massive Multitask Language Understanding' },
  { key: 'humaneval', label: 'HumanEval',  description: 'Code generation (pass@1)' },
  { key: 'gsm8k',     label: 'GSM8K',      description: 'Grade school math reasoning' },
  { key: 'hellaswag', label: 'HellaSwag',  description: 'Commonsense reasoning' },
  { key: 'arc',       label: 'ARC-C',      description: 'AI2 Reasoning Challenge' },
];

// ─── Model Data ──────────────────────────────────────────────────────
// Scores are approximate benchmarks from public evaluations (0-100 scale)
// Sources: official papers, HuggingFace Open LLM Leaderboard, lmsys

interface ModelScore {
  name: string;
  tier: 'frontier' | 'mid' | 'small' | 'blackswan';
  color: string;
  params: string;
  scores: Record<BenchmarkKey, number>;
}

const MODELS: ModelScore[] = [
  {
    name: 'Claude Opus',
    tier: 'frontier',
    color: '#d4a574',
    params: '~2T',
    scores: { overall: 92, mmlu: 95, humaneval: 85, gsm8k: 95, hellaswag: 96, arc: 97 },
  },
  {
    name: 'GPT-4o',
    tier: 'frontier',
    color: '#74b9a5',
    params: '~1.8T',
    scores: { overall: 91, mmlu: 93, humaneval: 87, gsm8k: 94, hellaswag: 95, arc: 96 },
  },
  {
    name: 'Claude Sonnet',
    tier: 'frontier',
    color: '#b99a74',
    params: '~500B',
    scores: { overall: 88, mmlu: 89, humaneval: 82, gsm8k: 92, hellaswag: 93, arc: 93 },
  },
  {
    name: 'Gemini 1.5 Pro',
    tier: 'frontier',
    color: '#7488d4',
    params: '~500B',
    scores: { overall: 87, mmlu: 86, humaneval: 80, gsm8k: 91, hellaswag: 92, arc: 92 },
  },
  {
    name: 'GPT-4o-mini',
    tier: 'mid',
    color: '#74c5a5',
    params: '~8B',
    scores: { overall: 79, mmlu: 82, humaneval: 72, gsm8k: 87, hellaswag: 85, arc: 84 },
  },
  {
    name: 'Claude Haiku',
    tier: 'mid',
    color: '#c5a974',
    params: '~20B',
    scores: { overall: 78, mmlu: 80, humaneval: 70, gsm8k: 85, hellaswag: 84, arc: 82 },
  },
  {
    name: 'Llama 3.1 70B',
    tier: 'mid',
    color: '#5b8dd9',
    params: '70B',
    scores: { overall: 80, mmlu: 82, humaneval: 73, gsm8k: 84, hellaswag: 87, arc: 86 },
  },
  {
    name: 'Qwen2.5-72B',
    tier: 'mid',
    color: '#a074d4',
    params: '72B',
    scores: { overall: 81, mmlu: 85, humaneval: 74, gsm8k: 86, hellaswag: 86, arc: 85 },
  },
  {
    name: 'Mistral-7B',
    tier: 'small',
    color: '#f97316',
    params: '7B',
    scores: { overall: 61, mmlu: 63, humaneval: 32, gsm8k: 52, hellaswag: 83, arc: 76 },
  },
  {
    name: 'Llama 3.1 8B',
    tier: 'small',
    color: '#5ba4d9',
    params: '8B',
    scores: { overall: 65, mmlu: 68, humaneval: 40, gsm8k: 58, hellaswag: 82, arc: 79 },
  },
  {
    name: 'Qwen2.5-7B',
    tier: 'small',
    color: '#9b74d4',
    params: '7B',
    scores: { overall: 68, mmlu: 74, humaneval: 55, gsm8k: 65, hellaswag: 80, arc: 76 },
  },
  {
    name: 'Phi-3 Mini',
    tier: 'small',
    color: '#22c55e',
    params: '3.8B',
    scores: { overall: 64, mmlu: 69, humaneval: 48, gsm8k: 75, hellaswag: 73, arc: 60 },
  },
  {
    name: 'Qwen2.5-3B',
    tier: 'small',
    color: '#8b5cf6',
    params: '3B',
    scores: { overall: 57, mmlu: 63, humaneval: 38, gsm8k: 55, hellaswag: 72, arc: 58 },
  },
  {
    name: 'Llama 3.2 3B',
    tier: 'small',
    color: '#4a8ad4',
    params: '3B',
    scores: { overall: 54, mmlu: 58, humaneval: 30, gsm8k: 48, hellaswag: 71, arc: 60 },
  },
  {
    name: 'BlackSwan v3',
    tier: 'blackswan',
    color: '#ef4444',
    params: '3B (QLoRA)',
    scores: { overall: 38, mmlu: 42, humaneval: 18, gsm8k: 30, hellaswag: 55, arc: 42 },
  },
  {
    name: 'BlackSwan v4',
    tier: 'blackswan',
    color: '#f59e0b',
    params: '7B (QLoRA)',
    scores: { overall: 0, mmlu: 0, humaneval: 0, gsm8k: 0, hellaswag: 0, arc: 0 }, // TBD — training in progress
  },
];

// ─── Component ───────────────────────────────────────────────────────

interface Props {
  accentColor?: string;
}

export default function LLMBenchmarkPanel({ accentColor = '#6366f1' }: Props) {
  const [activeBenchmark, setActiveBenchmark] = useState<BenchmarkKey>('overall');
  const [showAllTiers, setShowAllTiers] = useState(true);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const benchmark = BENCHMARKS.find(b => b.key === activeBenchmark)!;

  // Sort models by score descending for selected benchmark
  const sorted = [...MODELS]
    .filter(m => showAllTiers || m.tier === 'small' || m.tier === 'blackswan')
    .sort((a, b) => b.scores[activeBenchmark] - a.scores[activeBenchmark]);

  const maxScore = Math.max(...sorted.map(m => m.scores[activeBenchmark]), 1);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Text style={styles.headerIconText}>|=|</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>LLM BENCHMARK COMPARISON</Text>
          <Text style={styles.headerSub}>Track BlackSwan training progress vs industry models</Text>
        </View>
      </View>

      {/* Benchmark selector */}
      <View style={styles.benchmarkRow}>
        {BENCHMARKS.map(b => (
          <Pressable
            key={b.key}
            onPress={() => setActiveBenchmark(b.key)}
            style={[
              styles.benchmarkChip,
              activeBenchmark === b.key && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' },
            ]}
          >
            <Text style={[
              styles.benchmarkChipText,
              activeBenchmark === b.key && { color: accentColor },
            ]}>
              {b.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Description */}
      <Text style={styles.benchmarkDesc}>{benchmark.description}</Text>

      {/* Filter toggle */}
      <View style={styles.filterRow}>
        <Pressable
          onPress={() => setShowAllTiers(true)}
          style={[styles.filterBtn, showAllTiers && { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}
        >
          <Text style={[styles.filterText, showAllTiers && { color: accentColor }]}>All Models</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowAllTiers(false)}
          style={[styles.filterBtn, !showAllTiers && { backgroundColor: accentColor + '15', borderColor: accentColor + '40' }]}
        >
          <Text style={[styles.filterText, !showAllTiers && { color: accentColor }]}>Small Models Only</Text>
        </Pressable>
      </View>

      {/* Bar Chart */}
      <View style={styles.chartContainer}>
        {sorted.map((model, i) => {
          const score = model.scores[activeBenchmark];
          const barWidth = maxScore > 0 ? (score / maxScore) * 100 : 0;
          const isBlackSwan = model.tier === 'blackswan';
          const isSelected = selectedModel === model.name;
          const isTBD = score === 0 && model.name === 'BlackSwan v4';

          return (
            <Pressable
              key={model.name}
              onPress={() => setSelectedModel(isSelected ? null : model.name)}
              style={[
                styles.barRow,
                isBlackSwan && styles.barRowBlackSwan,
                isSelected && { backgroundColor: model.color + '10' },
              ]}
            >
              {/* Rank */}
              <Text style={styles.barRank}>{isTBD ? '--' : `#${i + 1}`}</Text>

              {/* Model name + params */}
              <View style={styles.barLabelCol}>
                <Text style={[
                  styles.barModelName,
                  isBlackSwan && { color: model.color, fontWeight: '700' as const },
                ]} numberOfLines={1}>
                  {model.name}
                </Text>
                <Text style={styles.barParams}>{model.params}</Text>
              </View>

              {/* Bar */}
              <View style={styles.barTrack}>
                {isTBD ? (
                  <View style={styles.barTBD}>
                    <Text style={styles.barTBDText}>TRAINING...</Text>
                  </View>
                ) : (
                  <View
                    style={[
                      styles.bar,
                      {
                        width: `${barWidth}%`,
                        backgroundColor: isBlackSwan ? model.color : model.color + '90',
                      },
                      isBlackSwan && styles.barBlackSwan,
                    ]}
                  />
                )}
              </View>

              {/* Score */}
              <Text style={[
                styles.barScore,
                isBlackSwan && { color: model.color },
              ]}>
                {isTBD ? 'TBD' : score}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Selected model details */}
      {selectedModel && (() => {
        const model = MODELS.find(m => m.name === selectedModel);
        if (!model) return null;
        return (
          <View style={[styles.detailCard, { borderColor: model.color + '30' }]}>
            <View style={styles.detailHeader}>
              <View style={[styles.detailDot, { backgroundColor: model.color }]} />
              <Text style={[styles.detailName, { color: model.color }]}>{model.name}</Text>
              <Text style={styles.detailParams}>{model.params}</Text>
            </View>
            <View style={styles.detailScores}>
              {BENCHMARKS.filter(b => b.key !== 'overall').map(b => (
                <View key={b.key} style={styles.detailScoreItem}>
                  <Text style={styles.detailScoreLabel}>{b.label}</Text>
                  <Text style={styles.detailScoreValue}>
                    {model.scores[b.key] === 0 ? 'TBD' : model.scores[b.key]}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        );
      })()}

      {/* Tier legend */}
      <View style={styles.legend}>
        <Text style={styles.legendTitle}>TIERS</Text>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#d4a574' }]} />
            <Text style={styles.legendText}>Frontier (500B+)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#5b8dd9' }]} />
            <Text style={styles.legendText}>Mid (8-72B)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#22c55e' }]} />
            <Text style={styles.legendText}>Small (3-8B)</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
            <Text style={styles.legendText}>BlackSwan</Text>
          </View>
        </View>
      </View>

      {/* Training progress note */}
      <View style={styles.noteCard}>
        <Text style={styles.noteTitle}>TRAINING PROGRESS</Text>
        <Text style={styles.noteText}>
          BlackSwan v3 — 3B Qwen2.5 + QLoRA (12K examples, 2 epochs){'\n'}
          BlackSwan v4 — 7B Qwen2.5 + QLoRA (43K examples, in progress){'\n\n'}
          Scores update as training completes and benchmarks are run.
          Run eval scripts to update BlackSwan scores after each training round.
        </Text>
      </View>
    </ScrollView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PIXEL_COLORS.bg1,
  },
  content: {
    padding: GRID.lg,
    paddingBottom: GRID.xxl * 2,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.md,
    marginBottom: GRID.lg,
  },
  headerIcon: {
    width: 36,
    height: 36,
    backgroundColor: '#f59e0b15',
    borderWidth: 2,
    borderColor: '#f59e0b30',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
    color: '#f59e0b',
  },
  headerTitle: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: PIXEL_COLORS.text0,
    letterSpacing: 1,
  },
  headerSub: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: PIXEL_COLORS.text2,
    marginTop: 2,
  },

  // Benchmark selector
  benchmarkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
    marginBottom: GRID.sm,
  },
  benchmarkChip: {
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.xs + 2,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 2,
    backgroundColor: PIXEL_COLORS.bg2,
  },
  benchmarkChipText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '600',
    color: PIXEL_COLORS.text2,
  },
  benchmarkDesc: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: PIXEL_COLORS.text2,
    marginBottom: GRID.lg,
  },

  // Filter
  filterRow: {
    flexDirection: 'row',
    gap: GRID.sm,
    marginBottom: GRID.lg,
  },
  filterBtn: {
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.xs + 2,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 2,
    backgroundColor: PIXEL_COLORS.bg2,
  },
  filterText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: PIXEL_COLORS.text2,
  },

  // Chart
  chartContainer: {
    gap: 2,
    marginBottom: GRID.lg,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    paddingVertical: GRID.sm,
    paddingHorizontal: GRID.sm,
    borderRadius: 2,
  },
  barRowBlackSwan: {
    backgroundColor: '#f59e0b08',
    borderWidth: 1,
    borderColor: '#f59e0b20',
    borderRadius: 2,
  },
  barRank: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: PIXEL_COLORS.text2,
    width: 24,
    textAlign: 'right',
  },
  barLabelCol: {
    width: 100,
  },
  barModelName: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: PIXEL_COLORS.text1,
    fontWeight: '600',
  },
  barParams: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: PIXEL_COLORS.text2,
    marginTop: 1,
  },
  barTrack: {
    flex: 1,
    height: 16,
    backgroundColor: PIXEL_COLORS.bg3,
    borderRadius: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  bar: {
    height: '100%',
    borderRadius: 1,
    minWidth: 2,
  },
  barBlackSwan: {
    // Pulsing effect via border
    borderRightWidth: 2,
    borderRightColor: '#ffffff40',
  },
  barTBD: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f59e0b08',
    borderWidth: 1,
    borderColor: '#f59e0b20',
    borderStyle: 'dashed',
    height: '100%',
  },
  barTBDText: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: '#f59e0b60',
    letterSpacing: 2,
  },
  barScore: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    color: PIXEL_COLORS.text1,
    width: 32,
    textAlign: 'right',
  },

  // Detail card
  detailCard: {
    backgroundColor: PIXEL_COLORS.bg2,
    borderWidth: 1,
    borderRadius: 2,
    padding: GRID.md,
    marginBottom: GRID.lg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    marginBottom: GRID.md,
  },
  detailDot: {
    width: 8,
    height: 8,
    borderRadius: 1,
  },
  detailName: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '700',
  },
  detailParams: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: PIXEL_COLORS.text2,
  },
  detailScores: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  detailScoreItem: {
    minWidth: 72,
    padding: GRID.sm,
    backgroundColor: PIXEL_COLORS.bg3,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 2,
  },
  detailScoreLabel: {
    fontFamily: 'monospace',
    fontSize: 8,
    color: PIXEL_COLORS.text2,
    marginBottom: 2,
  },
  detailScoreValue: {
    fontFamily: 'monospace',
    fontSize: 14,
    fontWeight: '700',
    color: PIXEL_COLORS.text0,
  },

  // Legend
  legend: {
    backgroundColor: PIXEL_COLORS.bg2,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 2,
    padding: GRID.md,
    marginBottom: GRID.lg,
  },
  legendTitle: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: PIXEL_COLORS.text2,
    letterSpacing: 1,
    marginBottom: GRID.sm,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.xs,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 1,
  },
  legendText: {
    fontFamily: 'monospace',
    fontSize: 9,
    color: PIXEL_COLORS.text1,
  },

  // Note
  noteCard: {
    backgroundColor: PIXEL_COLORS.bg2,
    borderWidth: 1,
    borderColor: '#f59e0b20',
    borderRadius: 2,
    padding: GRID.md,
  },
  noteTitle: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    color: '#f59e0b',
    letterSpacing: 1,
    marginBottom: GRID.sm,
  },
  noteText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: PIXEL_COLORS.text2,
    lineHeight: 16,
  },
});
