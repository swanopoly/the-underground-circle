/**
 * ModelLabPanel — Unsloth-inspired LLM training & optimization dashboard
 *
 * Tabs:
 *  1. Overview — model versions, training status, quick stats
 *  2. Training — config, loss curves, hyperparams, Unsloth integration
 *  3. Models — browse HF Hub trending + search, model cards
 *  4. Datasets — training data stats, circle data builder
 *  5. Deploy — export to GGUF/Ollama/HF Hub, manage deployments
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, Pressable, ScrollView, TextInput, StyleSheet,
  Platform, ActivityIndicator,
} from 'react-native';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

// ── Theme (Unsloth-inspired — dark with purple/blue accents) ─────────────────

const T = {
  bg: '#0c0c1d',
  bgCard: '#12122a',
  bgInput: '#0a0a1e',
  border: '#1e1e3a',
  borderLit: '#2d2d5a',
  text: '#e8e8f8',
  textSec: '#9898b8',
  textMuted: '#4a4a6a',
  accent: '#8b5cf6',
  accentDim: '#6d43d8',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  blue: '#3b82f6',
};

type Tab = 'overview' | 'training' | 'models' | 'datasets' | 'deploy';

// ── Model versions data ──────────────────────────────────────────────────────

const VERSIONS = [
  { ver: 'v3', base: 'Qwen2.5-3B', params: '3B', data: '12K', method: 'QLoRA 4-bit', status: 'deployed' as const, vram: '5GB', time: '2h', loss: 1.42, evalLoss: 1.58 },
  { ver: 'v4', base: 'Qwen2.5-7B', params: '7B', data: '43K', method: 'QLoRA r64 + DPO', status: 'trained' as const, vram: '10GB', time: '8h', loss: 0.89, evalLoss: 1.12 },
  { ver: 'v5', base: 'Qwen3.5-27B', params: '27B', data: '43K', method: 'QLoRA r64 + DPO', status: 'planned' as const, vram: '56GB', time: '~24h', loss: 0, evalLoss: 0 },
];

// Simulated training loss curve (v4)
const V4_LOSS_CURVE = [
  { step: 0, loss: 2.8, lr: 0 },
  { step: 50, loss: 2.1, lr: 0.00005 },
  { step: 100, loss: 1.7, lr: 0.0001 },
  { step: 200, loss: 1.4, lr: 0.0002 },
  { step: 400, loss: 1.15, lr: 0.0002 },
  { step: 600, loss: 1.02, lr: 0.00018 },
  { step: 800, loss: 0.95, lr: 0.00015 },
  { step: 1000, loss: 0.92, lr: 0.00012 },
  { step: 1200, loss: 0.90, lr: 0.00008 },
  { step: 1400, loss: 0.89, lr: 0.00004 },
];

// ── HF Trending models ───────────────────────────────────────────────────────

interface HfModel {
  id: string;
  downloads: number;
  likes: number;
  pipeline_tag?: string;
  lastModified?: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function ModelLabPanel({ circleId }: { circleId: string }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [hfModels, setHfModels] = useState<HfModel[]>([]);
  const [hfSearch, setHfSearch] = useState('');
  const [hfLoading, setHfLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState('v4');

  // Fetch trending models
  useEffect(() => {
    if (tab !== 'models') return;
    setHfLoading(true);
    const url = hfSearch
      ? `https://huggingface.co/api/models?search=${encodeURIComponent(hfSearch)}&sort=trending&limit=20`
      : 'https://huggingface.co/api/models?sort=trending&filter=text-generation&limit=20';
    fetch(url)
      .then(r => r.json())
      .then(data => setHfModels(data || []))
      .catch(() => {})
      .finally(() => setHfLoading(false));
  }, [tab, hfSearch]);

  const formatNum = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);

  // ── Tab bar ────────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: '📊' },
    { key: 'training', label: 'Training', icon: '🔥' },
    { key: 'models', label: 'Models', icon: '🤗' },
    { key: 'datasets', label: 'Datasets', icon: '📁' },
    { key: 'deploy', label: 'Deploy', icon: '🚀' },
  ];

  // ── Overview tab ───────────────────────────────────────────────────────────

  const renderOverview = () => (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      {/* Quick stats */}
      <View style={s.statsGrid}>
        <View style={s.statBox}>
          <Text style={s.statValue}>3</Text>
          <Text style={s.statLabel}>Model Versions</Text>
        </View>
        <View style={s.statBox}>
          <Text style={[s.statValue, { color: T.green }]}>43K</Text>
          <Text style={s.statLabel}>Training Examples</Text>
        </View>
        <View style={s.statBox}>
          <Text style={[s.statValue, { color: T.accent }]}>0.89</Text>
          <Text style={s.statLabel}>Best Loss (v4)</Text>
        </View>
        <View style={s.statBox}>
          <Text style={[s.statValue, { color: T.amber }]}>2x</Text>
          <Text style={s.statLabel}>Unsloth Speedup</Text>
        </View>
      </View>

      {/* Model cards */}
      <Text style={s.sectionLabel}>MODEL VERSIONS</Text>
      {VERSIONS.map(v => {
        const statusColor = v.status === 'deployed' ? T.green : v.status === 'trained' ? T.blue : T.textMuted;
        return (
          <Pressable
            key={v.ver}
            onPress={() => { setSelectedVersion(v.ver); setTab('training'); }}
            style={[s.modelRow, selectedVersion === v.ver && { borderColor: T.accent }]}
          >
            <View style={s.modelRowHeader}>
              <View style={[s.statusDot, { backgroundColor: statusColor }]} />
              <Text style={s.modelName}>BlackSwan {v.ver}</Text>
              <View style={[s.badge, { backgroundColor: statusColor + '20', borderColor: statusColor + '60' }]}>
                <Text style={[s.badgeText, { color: statusColor }]}>{v.status.toUpperCase()}</Text>
              </View>
            </View>
            <View style={s.modelMeta}>
              <Text style={s.metaItem}>{v.base}</Text>
              <Text style={s.metaDivider}>|</Text>
              <Text style={s.metaItem}>{v.params}</Text>
              <Text style={s.metaDivider}>|</Text>
              <Text style={s.metaItem}>{v.data} examples</Text>
              <Text style={s.metaDivider}>|</Text>
              <Text style={s.metaItem}>{v.vram} VRAM</Text>
            </View>
            {v.loss > 0 && (
              <View style={s.lossRow}>
                <Text style={s.lossLabel}>Train Loss</Text>
                <View style={[s.lossBar, { width: `${Math.min(v.loss / 3 * 100, 100)}%`, backgroundColor: T.accent }]} />
                <Text style={s.lossValue}>{v.loss.toFixed(2)}</Text>
                <Text style={[s.lossLabel, { marginLeft: 12 }]}>Eval Loss</Text>
                <View style={[s.lossBar, { width: `${Math.min(v.evalLoss / 3 * 100, 100)}%`, backgroundColor: T.amber }]} />
                <Text style={s.lossValue}>{v.evalLoss.toFixed(2)}</Text>
              </View>
            )}
          </Pressable>
        );
      })}

      {/* Unsloth info */}
      <View style={s.infoCard}>
        <Text style={s.infoTitle}>Powered by Unsloth</Text>
        <Text style={s.infoText}>
          2x faster training, 70% less VRAM, zero accuracy loss.{'\n'}
          QLoRA 4-bit fine-tuning on consumer GPUs (RTX 3090+).{'\n'}
          Supports: Qwen, Llama, Mistral, Gemma, DeepSeek, Phi.
        </Text>
      </View>
    </ScrollView>
  );

  // ── Training tab ───────────────────────────────────────────────────────────

  const renderTraining = () => {
    const v = VERSIONS.find(x => x.ver === selectedVersion) || VERSIONS[1];
    const maxLoss = Math.max(...V4_LOSS_CURVE.map(p => p.loss));

    return (
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Version selector */}
        <View style={s.chipRow}>
          {VERSIONS.map(ver => (
            <Pressable
              key={ver.ver}
              onPress={() => setSelectedVersion(ver.ver)}
              style={[s.chip, selectedVersion === ver.ver && s.chipActive]}
            >
              <Text style={[s.chipText, selectedVersion === ver.ver && { color: '#fff' }]}>{ver.ver}</Text>
            </Pressable>
          ))}
        </View>

        {/* Training config summary */}
        <View style={s.configGrid}>
          {[
            { label: 'Base Model', value: v.base },
            { label: 'Parameters', value: v.params },
            { label: 'Method', value: v.method },
            { label: 'VRAM Required', value: v.vram },
            { label: 'Training Data', value: `${v.data} examples` },
            { label: 'Est. Time', value: v.time },
          ].map(item => (
            <View key={item.label} style={s.configItem}>
              <Text style={s.configLabel}>{item.label}</Text>
              <Text style={s.configValue}>{item.value}</Text>
            </View>
          ))}
        </View>

        {/* Loss curve visualization */}
        {v.loss > 0 && (
          <>
            <Text style={s.sectionLabel}>TRAINING LOSS CURVE</Text>
            <View style={s.chartContainer}>
              {/* Y-axis labels */}
              <View style={s.yAxis}>
                <Text style={s.axisLabel}>{maxLoss.toFixed(1)}</Text>
                <Text style={s.axisLabel}>{(maxLoss / 2).toFixed(1)}</Text>
                <Text style={s.axisLabel}>0</Text>
              </View>
              {/* Chart area */}
              <View style={s.chartArea}>
                {/* Grid lines */}
                <View style={[s.gridLine, { top: '0%' }]} />
                <View style={[s.gridLine, { top: '50%' }]} />
                <View style={[s.gridLine, { top: '100%' }]} />
                {/* Data points + bars */}
                <View style={s.barsContainer}>
                  {V4_LOSS_CURVE.map((point, i) => {
                    const height = (point.loss / maxLoss) * 100;
                    return (
                      <View key={i} style={s.barWrap}>
                        <View style={[s.bar, {
                          height: `${height}%`,
                          backgroundColor: point.loss < 1.0 ? T.green : point.loss < 1.5 ? T.accent : T.amber,
                        }]} />
                        <Text style={s.barLabel}>{point.step}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>

            {/* Learning rate schedule */}
            <Text style={s.sectionLabel}>LEARNING RATE SCHEDULE</Text>
            <View style={s.lrRow}>
              {V4_LOSS_CURVE.map((point, i) => (
                <View key={i} style={s.lrItem}>
                  <View style={[s.lrBar, { height: `${(point.lr / 0.0002) * 100}%`, backgroundColor: T.blue }]} />
                  <Text style={s.lrLabel}>{(point.lr * 1e4).toFixed(0)}</Text>
                </View>
              ))}
            </View>
            <Text style={[s.metaItem, { textAlign: 'center', marginTop: 4 }]}>LR x10^-4 (cosine decay with warmup)</Text>
          </>
        )}

        {/* Hyperparameters */}
        <Text style={s.sectionLabel}>HYPERPARAMETERS</Text>
        <View style={s.hyperGrid}>
          {[
            { label: 'LoRA Rank', value: '64' },
            { label: 'LoRA Alpha', value: '128' },
            { label: 'Dropout', value: '0' },
            { label: 'NEFTune Alpha', value: '5' },
            { label: 'Max Seq Length', value: '4096' },
            { label: 'Batch Size', value: '2' },
            { label: 'Grad Accum', value: '8' },
            { label: 'Effective Batch', value: '16' },
            { label: 'Weight Decay', value: '0.01' },
            { label: 'Warmup Ratio', value: '0.03' },
            { label: 'Scheduler', value: 'cosine' },
            { label: 'Precision', value: 'BF16' },
          ].map(h => (
            <View key={h.label} style={s.hyperItem}>
              <Text style={s.hyperLabel}>{h.label}</Text>
              <Text style={s.hyperValue}>{h.value}</Text>
            </View>
          ))}
        </View>

        {/* Target modules */}
        <Text style={s.sectionLabel}>LORA TARGET MODULES</Text>
        <View style={s.chipRow}>
          {['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'].map(m => (
            <View key={m} style={[s.chip, { borderColor: T.accent + '60', backgroundColor: T.accent + '10' }]}>
              <Text style={[s.chipText, { color: T.accent }]}>{m}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  // ── Models tab (HF Hub browser) ────────────────────────────────────────────

  const renderModels = () => (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          value={hfSearch}
          onChangeText={setHfSearch}
          placeholder="Search models on HuggingFace Hub..."
          placeholderTextColor={T.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* Quick filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        {['Qwen3.5', 'Nemotron', 'Kimi', 'GLM-5', 'MiniMax', 'gpt-oss', 'Llama', 'DeepSeek', 'Mistral', 'FLUX', 'Whisper'].map(q => (
          <Pressable key={q} onPress={() => setHfSearch(q)} style={s.filterChip}>
            <Text style={s.filterChipText}>{q}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {hfLoading ? (
        <ActivityIndicator color={T.accent} style={{ marginTop: 40 }} />
      ) : (
        hfModels.map(model => (
          <View key={model.id} style={s.hfCard}>
            <Text style={s.hfName} numberOfLines={1}>{model.id}</Text>
            <View style={s.hfMeta}>
              {model.pipeline_tag && (
                <View style={[s.badge, { backgroundColor: T.accent + '20', borderColor: T.accent + '40' }]}>
                  <Text style={[s.badgeText, { color: T.accent }]}>{model.pipeline_tag}</Text>
                </View>
              )}
              <Text style={s.hfStat}>⬇ {formatNum(model.downloads || 0)}</Text>
              <Text style={s.hfStat}>♥ {formatNum(model.likes || 0)}</Text>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );

  // ── Datasets tab ───────────────────────────────────────────────────────────

  const renderDatasets = () => (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionLabel}>TRAINING DATA COMPOSITION</Text>

      <View style={s.dataComposition}>
        {/* Visual bar */}
        <View style={s.compBar}>
          <View style={[s.compSegment, { flex: 41.7, backgroundColor: T.blue }]} />
          <View style={[s.compSegment, { flex: 1.3, backgroundColor: T.accent }]} />
        </View>
        <View style={s.compLegend}>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: T.blue }]} />
            <Text style={s.legendText}>Public Curated (41.7K)</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendDot, { backgroundColor: T.accent }]} />
            <Text style={s.legendText}>Synthetic / Claude (1.3K)</Text>
          </View>
        </View>
      </View>

      <Text style={s.sectionLabel}>DATA FORMAT</Text>
      <View style={s.codeBlock}>
        <Text style={s.codeText} selectable>{`{
  "conversations": [
    { "from": "system", "value": "You are BlackSwan..." },
    { "from": "human", "value": "How's the team doing?" },
    { "from": "gpt", "value": "Based on today's data..." }
  ]
}`}</Text>
      </View>
      <Text style={[s.metaItem, { marginTop: 4 }]}>ShareGPT format • Multi-turn conversations • Qwen 2.5 chat template</Text>

      <Text style={s.sectionLabel}>DPO PREFERENCE DATA</Text>
      <View style={s.statsGrid}>
        <View style={s.statBox}>
          <Text style={s.statValue}>7K</Text>
          <Text style={s.statLabel}>DPO Pairs</Text>
        </View>
        <View style={s.statBox}>
          <Text style={[s.statValue, { color: T.green }]}>✓</Text>
          <Text style={s.statLabel}>Chosen</Text>
        </View>
        <View style={s.statBox}>
          <Text style={[s.statValue, { color: T.red }]}>✗</Text>
          <Text style={s.statLabel}>Rejected</Text>
        </View>
      </View>

      <Text style={s.sectionLabel}>CIRCLE DATA BUILDER</Text>
      <View style={s.infoCard}>
        <Text style={s.infoTitle}>Auto-generate training data from your circle</Text>
        <Text style={s.infoText}>
          Coming soon: Automatically extract training examples from:{'\n'}
          - Chat conversations with BlackSwan{'\n'}
          - Code review comments and PR discussions{'\n'}
          - Task descriptions and completion notes{'\n'}
          - Check-in patterns and accountability data{'\n'}
          - Room file contents and technical discussions
        </Text>
      </View>
    </ScrollView>
  );

  // ── Deploy tab ─────────────────────────────────────────────────────────────

  const renderDeploy = () => (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <Text style={s.sectionLabel}>EXPORT FORMATS</Text>

      {[
        { format: 'GGUF (Q4_K_M)', target: 'Ollama / llama.cpp / LM Studio', icon: '📦', status: 'v3 + v4 exported', color: T.green },
        { format: 'Merged 16-bit', target: 'vLLM / HuggingFace / Any framework', icon: '🔄', status: 'Available', color: T.blue },
        { format: 'LoRA Adapter', target: 'Lightweight ~100MB / Merge later', icon: '🧩', status: 'v4 saved', color: T.accent },
        { format: 'HuggingFace Hub', target: 'Cloud hosting / Inference API', icon: '🤗', status: 'Not pushed yet', color: T.amber },
      ].map(e => (
        <View key={e.format} style={s.exportCard}>
          <Text style={{ fontSize: 20 }}>{e.icon}</Text>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={s.exportFormat}>{e.format}</Text>
            <Text style={s.exportTarget}>{e.target}</Text>
          </View>
          <View style={[s.badge, { backgroundColor: e.color + '20', borderColor: e.color + '60' }]}>
            <Text style={[s.badgeText, { color: e.color }]}>{e.status}</Text>
          </View>
        </View>
      ))}

      <Text style={s.sectionLabel}>DEPLOYMENT COMMANDS</Text>
      <View style={s.codeBlock}>
        <Text style={s.codeText} selectable>{`# Export GGUF from trained model
python -c "
from unsloth import FastLanguageModel
model, tokenizer = FastLanguageModel.from_pretrained('models/v4/lora')
model.save_pretrained_gguf('models/v4/gguf', tokenizer, quantization_method='q4_k_m')
"

# Deploy to Ollama
ollama create blackswan:v4 -f models/v4/Modelfile
ollama cp blackswan:v4 blackswan:latest

# Push to HuggingFace Hub
huggingface-cli upload your-name/blackswan-v4 models/v4/gguf/`}</Text>
      </View>

      <Text style={s.sectionLabel}>CLOUD GPU PRICING</Text>
      <View style={s.statsGrid}>
        {[
          { provider: 'RunPod', price: '$0.30-0.50', gpu: 'A100 40GB', time: '30-60m' },
          { provider: 'HF Spaces', price: '$1.00-1.50', gpu: 'A10G 24GB', time: '1-2h' },
          { provider: 'Lambda', price: '$0.50-0.80', gpu: 'A100 80GB', time: '30-60m' },
          { provider: 'Local', price: 'Free', gpu: 'RTX 3090+', time: '6-10h' },
        ].map(p => (
          <View key={p.provider} style={s.statBox}>
            <Text style={s.statValue}>{p.price}</Text>
            <Text style={s.statLabel}>{p.provider}</Text>
            <Text style={[s.metaItem, { fontSize: 8 }]}>{p.gpu} · {p.time}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      {/* Tab bar */}
      <View style={s.tabBar}>
        {TABS.map(t => (
          <Pressable
            key={t.key}
            onPress={() => setTab(t.key)}
            style={[s.tab, tab === t.key && s.tabActive]}
          >
            <Text style={s.tabIcon}>{t.icon}</Text>
            <Text style={[s.tabText, tab === t.key && s.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      <View style={s.content}>
        {tab === 'overview' && renderOverview()}
        {tab === 'training' && renderTraining()}
        {tab === 'models' && renderModels()}
        {tab === 'datasets' && renderDatasets()}
        {tab === 'deploy' && renderDeploy()}
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: T.border, paddingHorizontal: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: T.accent },
  tabIcon: { fontSize: 14, marginBottom: 2 },
  tabText: { color: T.textMuted, fontSize: 10, fontWeight: '600', fontFamily: MONO },
  tabTextActive: { color: T.text },
  content: { flex: 1, padding: 12 },

  // Stats
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  statBox: { flex: 1, minWidth: 70, backgroundColor: T.bgCard, borderRadius: 8, borderWidth: 1, borderColor: T.border, padding: 10, alignItems: 'center' },
  statValue: { color: T.text, fontSize: 20, fontWeight: '700', fontFamily: MONO },
  statLabel: { color: T.textMuted, fontSize: 9, fontFamily: MONO, marginTop: 2, textAlign: 'center' },

  // Section
  sectionLabel: { color: T.textSec, fontSize: 10, fontWeight: '700', letterSpacing: 1, fontFamily: MONO, marginTop: 16, marginBottom: 8 },

  // Model rows
  modelRow: { backgroundColor: T.bgCard, borderRadius: 8, borderWidth: 1, borderColor: T.border, padding: 10, marginBottom: 6 },
  modelRowHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  modelName: { color: T.text, fontSize: 14, fontWeight: '700', fontFamily: MONO, flex: 1 },
  badge: { borderRadius: 4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 9, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.5 },
  modelMeta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 2 },
  metaItem: { color: T.textMuted, fontSize: 10, fontFamily: MONO },
  metaDivider: { color: T.textMuted, fontSize: 10, marginHorizontal: 4 },

  // Loss bar
  lossRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 4 },
  lossLabel: { color: T.textMuted, fontSize: 9, fontFamily: MONO },
  lossBar: { height: 4, borderRadius: 2, minWidth: 20, maxWidth: 60 },
  lossValue: { color: T.text, fontSize: 10, fontWeight: '600', fontFamily: MONO },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { backgroundColor: T.bgCard, borderRadius: 6, borderWidth: 1, borderColor: T.border, paddingHorizontal: 10, paddingVertical: 5 },
  chipActive: { backgroundColor: T.accent, borderColor: T.accent },
  chipText: { color: T.textSec, fontSize: 11, fontFamily: MONO },

  // Config grid
  configGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  configItem: { width: '48%', backgroundColor: T.bgCard, borderRadius: 6, borderWidth: 1, borderColor: T.border, padding: 8 },
  configLabel: { color: T.textMuted, fontSize: 9, fontFamily: MONO, letterSpacing: 0.3 },
  configValue: { color: T.text, fontSize: 13, fontWeight: '600', fontFamily: MONO, marginTop: 2 },

  // Chart
  chartContainer: { flexDirection: 'row', height: 160, marginBottom: 12, backgroundColor: T.bgCard, borderRadius: 8, borderWidth: 1, borderColor: T.border, padding: 8 },
  yAxis: { width: 30, justifyContent: 'space-between', alignItems: 'flex-end', paddingRight: 4 },
  axisLabel: { color: T.textMuted, fontSize: 8, fontFamily: MONO },
  chartArea: { flex: 1, position: 'relative' },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: T.border },
  barsContainer: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around' },
  barWrap: { alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '60%', borderRadius: 2, minHeight: 2 },
  barLabel: { color: T.textMuted, fontSize: 7, fontFamily: MONO, marginTop: 2 },

  // LR chart
  lrRow: { flexDirection: 'row', alignItems: 'flex-end', height: 40, gap: 2, marginBottom: 4 },
  lrItem: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  lrBar: { width: '60%', borderRadius: 2, minHeight: 1 },
  lrLabel: { color: T.textMuted, fontSize: 7, fontFamily: MONO, marginTop: 1 },

  // Hyperparameters
  hyperGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 12 },
  hyperItem: { backgroundColor: T.bgCard, borderRadius: 4, borderWidth: 1, borderColor: T.border, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 6 },
  hyperLabel: { color: T.textMuted, fontSize: 9, fontFamily: MONO },
  hyperValue: { color: T.text, fontSize: 11, fontWeight: '600', fontFamily: MONO },

  // Search
  searchRow: { marginBottom: 8 },
  searchInput: { backgroundColor: T.bgInput, borderRadius: 8, borderWidth: 1, borderColor: T.border, color: T.text, fontFamily: MONO, fontSize: 13, padding: 10 },
  filterChip: { backgroundColor: T.bgCard, borderRadius: 6, borderWidth: 1, borderColor: T.border, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  filterChipText: { color: T.textSec, fontSize: 11, fontFamily: MONO },

  // HF models
  hfCard: { backgroundColor: T.bgCard, borderRadius: 8, borderWidth: 1, borderColor: T.border, padding: 10, marginBottom: 4 },
  hfName: { color: T.text, fontSize: 12, fontWeight: '600', fontFamily: MONO, marginBottom: 4 },
  hfMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hfStat: { color: T.textMuted, fontSize: 10, fontFamily: MONO },

  // Dataset composition
  dataComposition: { marginBottom: 12 },
  compBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 8 },
  compSegment: { height: '100%' },
  compLegend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: T.textSec, fontSize: 10, fontFamily: MONO },

  // Code block
  codeBlock: { backgroundColor: T.bgInput, borderRadius: 8, borderWidth: 1, borderColor: T.border, padding: 10 },
  codeText: { color: T.textSec, fontSize: 10, fontFamily: MONO, lineHeight: 16 },

  // Info card
  infoCard: { backgroundColor: T.accent + '10', borderRadius: 8, borderWidth: 1, borderColor: T.accent + '30', padding: 12, marginTop: 12 },
  infoTitle: { color: T.accent, fontSize: 12, fontWeight: '700', fontFamily: MONO, marginBottom: 4 },
  infoText: { color: T.textSec, fontSize: 11, fontFamily: MONO, lineHeight: 18 },

  // Export cards
  exportCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: T.bgCard, borderRadius: 8, borderWidth: 1, borderColor: T.border, padding: 10, marginBottom: 4 },
  exportFormat: { color: T.text, fontSize: 12, fontWeight: '600', fontFamily: MONO },
  exportTarget: { color: T.textMuted, fontSize: 10, fontFamily: MONO },
});
