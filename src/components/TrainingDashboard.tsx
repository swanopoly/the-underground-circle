/**
 * TrainingDashboard — Model fine-tuning hub
 *
 * Shows existing BlackSwan model versions, training data stats,
 * and provides a UI to configure and kick off training runs.
 *
 * Architecture:
 *   Circle data → Dataset builder → Upload to HF Hub → Train (Unsloth) → Deploy (Ollama/HF)
 *
 * Phase 1 (this file): Dashboard showing model status + training config
 * Phase 2: Cloud GPU training via RunPod/HF Compute Jobs
 * Phase 3: Auto-dataset from circle activity
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, ScrollView, StyleSheet, Platform, TextInput,
} from 'react-native';
import { supabase } from '../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

type ModelVersion = {
  version: string;
  base: string;
  params: string;
  trainingData: string;
  method: string;
  status: 'deployed' | 'trained' | 'training' | 'planned';
  deployedTo: string;
};

type TrainingConfig = {
  baseModel: string;
  loraRank: number;
  epochs: number;
  learningRate: number;
  batchSize: number;
  method: 'qlora' | 'lora' | 'full';
  exportFormat: 'gguf' | 'hf-hub' | 'both';
};

// ── Constants ────────────────────────────────────────────────────────────────

const MODEL_VERSIONS: ModelVersion[] = [
  {
    version: 'v3 (deployed)',
    base: 'Qwen2.5-3B',
    params: '3B',
    trainingData: '12K examples',
    method: 'QLoRA (4-bit)',
    status: 'deployed',
    deployedTo: 'Ollama blackswan:latest',
  },
  {
    version: 'v4',
    base: 'Qwen2.5-7B',
    params: '7B',
    trainingData: '43K examples (SFT + DPO)',
    method: 'QLoRA rank-64 + DPO',
    status: 'trained',
    deployedTo: 'Ollama blackswan:v4',
  },
  {
    version: 'v5',
    base: 'Qwen3.5-27B',
    params: '27B',
    trainingData: '43K examples (SFT + DPO)',
    method: 'QLoRA rank-64 + DPO',
    status: 'planned',
    deployedTo: 'Requires 56GB+ VRAM',
  },
];

const BASE_MODELS = [
  { id: 'unsloth/Qwen2.5-7B-bnb-4bit', label: 'Qwen 2.5 7B (recommended)', vram: '~10GB' },
  { id: 'unsloth/Qwen2.5-3B-bnb-4bit', label: 'Qwen 2.5 3B (fast)', vram: '~5GB' },
  { id: 'unsloth/Qwen3.5-27B-bnb-4bit', label: 'Qwen 3.5 27B (max quality)', vram: '~56GB' },
  { id: 'unsloth/Llama-3.3-70B-bnb-4bit', label: 'Llama 3.3 70B', vram: '~80GB' },
  { id: 'unsloth/Meta-Llama-3.1-8B-bnb-4bit', label: 'Llama 3.1 8B', vram: '~10GB' },
  { id: 'unsloth/Mistral-7B-Instruct-v0.3-bnb-4bit', label: 'Mistral 7B', vram: '~10GB' },
  { id: 'unsloth/gemma-3-12b-it-bnb-4bit', label: 'Gemma 3 12B', vram: '~15GB' },
];

const STATUS_COLORS: Record<string, string> = {
  deployed: '#22c55e',
  trained: '#3b82f6',
  training: '#f59e0b',
  planned: '#6b7280',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function TrainingDashboard({ circleId }: { circleId: string }) {
  const [expandedSection, setExpandedSection] = useState<string>('models');
  const [config, setConfig] = useState<TrainingConfig>({
    baseModel: 'unsloth/Qwen2.5-7B-bnb-4bit',
    loraRank: 64,
    epochs: 1,
    learningRate: 2e-4,
    batchSize: 2,
    method: 'qlora',
    exportFormat: 'gguf',
  });
  const [datasetStats, setDatasetStats] = useState<{ total: number; synthetic: number; public: number } | null>(null);

  // Load dataset stats
  useEffect(() => {
    // These are from the training_data directory
    setDatasetStats({ total: 43000, synthetic: 1300, public: 41700 });
  }, []);

  const toggle = (section: string) => {
    setExpandedSection(prev => prev === section ? '' : section);
  };

  const generateTrainCommand = () => {
    const model = BASE_MODELS.find(m => m.id === config.baseModel);
    return `# BlackSwan Fine-Tune Command
# Base: ${model?.label || config.baseModel}
# Method: ${config.method.toUpperCase()}, LoRA rank ${config.loraRank}
# Epochs: ${config.epochs}, LR: ${config.learningRate}, Batch: ${config.batchSize}

cd scripts/blackswan-llm
python train_v4.py \\
  --base-model ${config.baseModel} \\
  --epochs ${config.epochs} \\
  --lr ${config.learningRate} \\
  --batch ${config.batchSize} \\
  --grad-accum 8

# Export to GGUF after training:
# python -c "from unsloth import FastLanguageModel; ..."
# ollama create blackswan:custom -f Modelfile`;
  };

  return (
    <ScrollView style={s.container} showsVerticalScrollIndicator={false}>
      <View style={s.header}>
        <Text style={s.title}>Model Training Hub</Text>
        <Text style={s.subtitle}>Fine-tune BlackSwan with your circle's data</Text>
      </View>

      {/* ── Model Versions ─────────────────────────────────────────────────── */}
      <Pressable onPress={() => toggle('models')} style={s.sectionHeader}>
        <Text style={s.sectionIcon}>🧠</Text>
        <Text style={s.sectionTitle}>BLACKSWAN MODELS</Text>
        <Text style={s.chevron}>{expandedSection === 'models' ? '▾' : '▸'}</Text>
      </Pressable>
      {expandedSection === 'models' && (
        <View style={s.sectionContent}>
          {MODEL_VERSIONS.map(mv => (
            <View key={mv.version} style={s.modelCard}>
              <View style={s.modelHeader}>
                <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[mv.status] + '20', borderColor: STATUS_COLORS[mv.status] + '60' }]}>
                  <Text style={[s.statusText, { color: STATUS_COLORS[mv.status] }]}>{mv.status.toUpperCase()}</Text>
                </View>
                <Text style={s.modelVersion}>{mv.version}</Text>
              </View>
              <Text style={s.modelDetail}>Base: {mv.base} ({mv.params})</Text>
              <Text style={s.modelDetail}>Data: {mv.trainingData}</Text>
              <Text style={s.modelDetail}>Method: {mv.method}</Text>
              <Text style={[s.modelDetail, { color: '#6b7280' }]}>Deploy: {mv.deployedTo}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Training Data ──────────────────────────────────────────────────── */}
      <Pressable onPress={() => toggle('data')} style={s.sectionHeader}>
        <Text style={s.sectionIcon}>📊</Text>
        <Text style={s.sectionTitle}>TRAINING DATA</Text>
        <Text style={s.chevron}>{expandedSection === 'data' ? '▾' : '▸'}</Text>
      </Pressable>
      {expandedSection === 'data' && (
        <View style={s.sectionContent}>
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={s.statValue}>{datasetStats?.total?.toLocaleString() || '—'}</Text>
              <Text style={s.statLabel}>Total Examples</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{datasetStats?.synthetic?.toLocaleString() || '—'}</Text>
              <Text style={s.statLabel}>Synthetic (Claude)</Text>
            </View>
            <View style={s.statCard}>
              <Text style={s.statValue}>{datasetStats?.public?.toLocaleString() || '—'}</Text>
              <Text style={s.statLabel}>Public Curated</Text>
            </View>
          </View>
          <Text style={s.dataNote}>
            Format: ShareGPT (multi-turn conversations){'\n'}
            Sources: Claude-generated synthetic + public instruction datasets{'\n'}
            Includes DPO preference pairs for alignment
          </Text>
        </View>
      )}

      {/* ── Training Config ────────────────────────────────────────────────── */}
      <Pressable onPress={() => toggle('config')} style={s.sectionHeader}>
        <Text style={s.sectionIcon}>⚙️</Text>
        <Text style={s.sectionTitle}>TRAINING CONFIG</Text>
        <Text style={s.chevron}>{expandedSection === 'config' ? '▾' : '▸'}</Text>
      </Pressable>
      {expandedSection === 'config' && (
        <View style={s.sectionContent}>
          {/* Base model */}
          <Text style={s.configLabel}>Base Model</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            {BASE_MODELS.map(m => (
              <Pressable
                key={m.id}
                onPress={() => setConfig(c => ({ ...c, baseModel: m.id }))}
                style={[s.modelChip, config.baseModel === m.id && s.modelChipActive]}
              >
                <Text style={[s.modelChipText, config.baseModel === m.id && { color: '#fff' }]}>{m.label}</Text>
                <Text style={s.modelChipVram}>{m.vram}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Method */}
          <Text style={s.configLabel}>Method</Text>
          <View style={s.chipRow}>
            {(['qlora', 'lora', 'full'] as const).map(m => (
              <Pressable
                key={m}
                onPress={() => setConfig(c => ({ ...c, method: m }))}
                style={[s.chip, config.method === m && s.chipActive]}
              >
                <Text style={[s.chipText, config.method === m && { color: '#fff' }]}>{m.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          {/* Hyperparams */}
          <View style={s.paramRow}>
            <View style={s.paramGroup}>
              <Text style={s.configLabel}>LoRA Rank</Text>
              <TextInput style={s.paramInput} value={String(config.loraRank)} onChangeText={v => setConfig(c => ({ ...c, loraRank: parseInt(v) || 64 }))} keyboardType="numeric" />
            </View>
            <View style={s.paramGroup}>
              <Text style={s.configLabel}>Epochs</Text>
              <TextInput style={s.paramInput} value={String(config.epochs)} onChangeText={v => setConfig(c => ({ ...c, epochs: parseInt(v) || 1 }))} keyboardType="numeric" />
            </View>
            <View style={s.paramGroup}>
              <Text style={s.configLabel}>Batch Size</Text>
              <TextInput style={s.paramInput} value={String(config.batchSize)} onChangeText={v => setConfig(c => ({ ...c, batchSize: parseInt(v) || 2 }))} keyboardType="numeric" />
            </View>
          </View>

          {/* Export format */}
          <Text style={s.configLabel}>Export Format</Text>
          <View style={s.chipRow}>
            {(['gguf', 'hf-hub', 'both'] as const).map(f => (
              <Pressable
                key={f}
                onPress={() => setConfig(c => ({ ...c, exportFormat: f }))}
                style={[s.chip, config.exportFormat === f && s.chipActive]}
              >
                <Text style={[s.chipText, config.exportFormat === f && { color: '#fff' }]}>
                  {f === 'gguf' ? 'GGUF (Ollama)' : f === 'hf-hub' ? 'HF Hub' : 'Both'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Generated command */}
          <Text style={s.configLabel}>Training Command</Text>
          <View style={s.codeBlock}>
            <Text style={s.codeText} selectable>{generateTrainCommand()}</Text>
          </View>

          <Text style={[s.dataNote, { marginTop: 8 }]}>
            Requires: NVIDIA GPU with {BASE_MODELS.find(m => m.id === config.baseModel)?.vram || '10GB+'} VRAM{'\n'}
            Powered by Unsloth for 2x faster training, 70% less VRAM{'\n'}
            Cloud GPU: RunPod ~$0.30-0.50/run, HF Spaces ~$1-2/run
          </Text>
        </View>
      )}

      {/* ── Unsloth + HF Integration ───────────────────────────────────────── */}
      <Pressable onPress={() => toggle('integration')} style={s.sectionHeader}>
        <Text style={s.sectionIcon}>🔗</Text>
        <Text style={s.sectionTitle}>TRAINING PIPELINE</Text>
        <Text style={s.chevron}>{expandedSection === 'integration' ? '▾' : '▸'}</Text>
      </Pressable>
      {expandedSection === 'integration' && (
        <View style={s.sectionContent}>
          <View style={s.pipelineStep}>
            <Text style={s.stepNumber}>1</Text>
            <View style={s.stepContent}>
              <Text style={s.stepTitle}>Gather Circle Data</Text>
              <Text style={s.stepDesc}>Chat logs, code reviews, task patterns, check-ins → training examples</Text>
            </View>
          </View>
          <View style={s.pipelineStep}>
            <Text style={s.stepNumber}>2</Text>
            <View style={s.stepContent}>
              <Text style={s.stepTitle}>Format Dataset</Text>
              <Text style={s.stepDesc}>Convert to ShareGPT format with BlackSwan personality baked in</Text>
            </View>
          </View>
          <View style={s.pipelineStep}>
            <Text style={s.stepNumber}>3</Text>
            <View style={s.stepContent}>
              <Text style={s.stepTitle}>Upload to HF Hub</Text>
              <Text style={s.stepDesc}>Push dataset to a private HuggingFace repo via @huggingface/hub SDK</Text>
            </View>
          </View>
          <View style={s.pipelineStep}>
            <Text style={s.stepNumber}>4</Text>
            <View style={s.stepContent}>
              <Text style={s.stepTitle}>Train with Unsloth</Text>
              <Text style={s.stepDesc}>QLoRA fine-tuning on cloud GPU (RunPod/Lambda) or local GPU</Text>
            </View>
          </View>
          <View style={s.pipelineStep}>
            <Text style={s.stepNumber}>5</Text>
            <View style={s.stepContent}>
              <Text style={s.stepTitle}>Deploy Model</Text>
              <Text style={s.stepDesc}>Export GGUF → Ollama, or push to HF Hub for serverless inference</Text>
            </View>
          </View>
          <View style={s.pipelineStep}>
            <Text style={[s.stepNumber, { backgroundColor: '#22c55e20', color: '#22c55e' }]}>✓</Text>
            <View style={s.stepContent}>
              <Text style={s.stepTitle}>Circle's Custom BlackSwan</Text>
              <Text style={s.stepDesc}>Your AI agent, trained on your team's knowledge and patterns</Text>
            </View>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { padding: 16, paddingBottom: 8 },
  title: { color: '#e8e8e8', fontSize: 18, fontWeight: '700', fontFamily: MONO },
  subtitle: { color: '#6b7280', fontSize: 12, fontFamily: MONO, marginTop: 2 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', padding: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
  },
  sectionIcon: { fontSize: 14, marginRight: 8 },
  sectionTitle: { color: '#e8e8e8', fontSize: 11, fontWeight: '700', letterSpacing: 1, fontFamily: MONO, flex: 1 },
  chevron: { color: '#4b5563', fontSize: 12, fontFamily: MONO },
  sectionContent: { padding: 12, paddingTop: 4 },
  modelCard: { backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a1a', padding: 10, marginBottom: 6 },
  modelHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6, gap: 8 },
  statusBadge: { borderRadius: 4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  statusText: { fontSize: 9, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5 },
  modelVersion: { color: '#e8e8e8', fontSize: 13, fontWeight: '600', fontFamily: MONO },
  modelDetail: { color: '#9ca3af', fontSize: 11, fontFamily: MONO, lineHeight: 18 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  statCard: { flex: 1, backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a1a', padding: 10, alignItems: 'center' },
  statValue: { color: '#e8e8e8', fontSize: 18, fontWeight: '700', fontFamily: MONO },
  statLabel: { color: '#6b7280', fontSize: 10, fontFamily: MONO, marginTop: 2 },
  dataNote: { color: '#4b5563', fontSize: 10, fontFamily: MONO, lineHeight: 16 },
  configLabel: { color: '#9ca3af', fontSize: 10, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5, marginBottom: 4, marginTop: 8 },
  modelChip: { backgroundColor: '#0a0a0a', borderRadius: 6, borderWidth: 1, borderColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 6, marginRight: 6 },
  modelChipActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  modelChipText: { color: '#9ca3af', fontSize: 11, fontFamily: MONO },
  modelChipVram: { color: '#4b5563', fontSize: 9, fontFamily: MONO, marginTop: 2 },
  chipRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  chip: { backgroundColor: '#0a0a0a', borderRadius: 6, borderWidth: 1, borderColor: '#1a1a1a', paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  chipText: { color: '#9ca3af', fontSize: 11, fontFamily: MONO },
  paramRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  paramGroup: { flex: 1 },
  paramInput: { backgroundColor: '#0a0a0a', borderRadius: 6, borderWidth: 1, borderColor: '#1a1a1a', color: '#e8e8e8', fontFamily: MONO, fontSize: 13, padding: 8, textAlign: 'center' },
  codeBlock: { backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#1a1a1a', padding: 10 },
  codeText: { color: '#9ca3af', fontSize: 10, fontFamily: MONO, lineHeight: 16 },
  pipelineStep: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  stepNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#6366f120', color: '#a5b4fc', textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: '700', fontFamily: MONO, marginRight: 10 },
  stepContent: { flex: 1 },
  stepTitle: { color: '#e8e8e8', fontSize: 12, fontWeight: '600', fontFamily: MONO },
  stepDesc: { color: '#6b7280', fontSize: 10, fontFamily: MONO, lineHeight: 16, marginTop: 2 },
});
