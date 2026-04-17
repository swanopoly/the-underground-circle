/**
 * SpawnAgentPanel.tsx — Create & configure a custom AI agent
 *
 * Multi-step wizard for spawning agents within a Circle.
 * Users pick: name, spirit/role, model preference, personality traits,
 * task focus, autonomy level, and tools. Agent gets published to the
 * circle office and can receive terminal commands + be assigned tasks.
 */

import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView, Platform,
} from 'react-native';
import { AGENT_SPIRITS, SPIRIT_CATEGORIES, type AgentSpirit } from '../lib/agentSpirits';
import { publishAgentToCircle, updateAgentSpirit, PROVIDER_DISPLAY } from '../lib/circleOffice';
import { updateAgentIdentity } from '../lib/agentIdentity';

const MONO = Platform.OS === 'ios' ? 'Courier' : 'monospace';

// ─── Theme ───────────────────────────────────────────────────────────────────

const T = {
  bg: '#000000',
  panel: '#0a0a0a',
  card: '#161616',
  border: '#1a1a1a',
  borderLit: '#2a2a2a',
  text: '#e8e8e8',
  textSec: '#9e9e9e',
  textMuted: '#3e3e3e',
  accent: '#6366f1',
  accentDim: '#818cf8',
  info: '#3b82f6',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
} as const;

// ─── Config options ──────────────────────────────────────────────────────────

const AGENT_COLORS = [
  { color: '#6366f1', label: 'Indigo' },
  { color: '#a855f7', label: 'Purple' },
  { color: '#ec4899', label: 'Pink' },
  { color: '#ef4444', label: 'Red' },
  { color: '#f97316', label: 'Orange' },
  { color: '#f59e0b', label: 'Amber' },
  { color: '#22c55e', label: 'Green' },
  { color: '#22d3ee', label: 'Cyan' },
  { color: '#3b82f6', label: 'Blue' },
  { color: '#e8e8e8', label: 'White' },
];

const MODEL_PREFERENCES_BASE = [
  { key: 'auto',          label: 'Auto (best available)',  desc: 'System picks optimal model per task' },
  { key: 'blackswan',     label: 'BlackSwan LLM',         desc: 'Custom fine-tuned model' },
  { key: 'claude-haiku',  label: 'Claude Haiku',          desc: 'Fast, cost-efficient' },
  { key: 'claude-sonnet', label: 'Claude Sonnet',         desc: 'Balanced intelligence' },
  { key: 'claude-opus',   label: 'Claude Opus',           desc: 'Maximum capability' },
  { key: 'gemini-flash',  label: 'Gemini 2.5 Flash',      desc: 'Google, fast reasoning' },
  { key: 'gpt-4.1',       label: 'GPT-4.1',               desc: 'OpenAI flagship' },
  { key: 'o4-mini',       label: 'O4 Mini',               desc: 'OpenAI reasoning' },
];
// Custom HF models are loaded at runtime and appended
let MODEL_PREFERENCES = [...MODEL_PREFERENCES_BASE];

const AUTONOMY_LEVELS = [
  { key: 'supervised',  label: 'Supervised',   desc: 'Asks before acting, proposes plans', icon: '?' },
  { key: 'balanced',    label: 'Balanced',     desc: 'Acts on routine tasks, asks on big decisions', icon: 'B' },
  { key: 'autonomous',  label: 'Autonomous',   desc: 'Executes independently, reports results', icon: 'A' },
  { key: 'full-auto',   label: 'Full Auto',    desc: 'Continuous execution without prompting', icon: '!' },
];

const PERSONALITY_TRAITS = [
  { key: 'concise',     label: 'Concise',      desc: 'Short, direct responses' },
  { key: 'detailed',    label: 'Detailed',     desc: 'Thorough explanations' },
  { key: 'creative',    label: 'Creative',     desc: 'Novel approaches, lateral thinking' },
  { key: 'methodical',  label: 'Methodical',   desc: 'Structured, step-by-step' },
  { key: 'aggressive',  label: 'Aggressive',   desc: 'Ship fast, iterate later' },
  { key: 'cautious',    label: 'Cautious',     desc: 'Double-check everything' },
  { key: 'friendly',    label: 'Friendly',     desc: 'Warm, encouraging tone' },
  { key: 'blunt',       label: 'Blunt',        desc: 'No sugar-coating, direct feedback' },
];

const TOOL_CAPABILITIES = [
  { key: 'code',        label: 'Code',         desc: 'Write & review code' },
  { key: 'research',    label: 'Research',     desc: 'Web search & analysis' },
  { key: 'tasks',       label: 'Tasks',        desc: 'Create & manage kanban tasks' },
  { key: 'review',      label: 'Review',       desc: 'Peer review & approve PRs' },
  { key: 'deploy',      label: 'Deploy',       desc: 'CI/CD & deployments' },
  { key: 'data',        label: 'Data',         desc: 'Analytics & reporting' },
  { key: 'design',      label: 'Design',       desc: 'UI/UX guidance' },
  { key: 'docs',        label: 'Docs',         desc: 'Documentation & guides' },
  { key: 'trading',     label: 'Trading',      desc: 'Crypto trading & DCA' },
  { key: 'devices',     label: 'Devices',      desc: 'Printers, serial, hardware' },
];

const PROVIDERS = [
  { key: 'blackswan',     label: 'BlackSwan',    icon: 'S' },
  { key: 'claude-code',   label: 'Claude Code',  icon: 'C' },
  { key: 'openswan',      label: 'OpenSwan',     icon: 'O' },
  { key: 'gemini',        label: 'Gemini',       icon: 'G' },
  { key: 'codex',         label: 'Codex',        icon: 'X' },
  { key: 'generic-agent', label: 'Custom',       icon: '+' },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentConfig {
  name: string;
  provider: string;
  color: string;
  spirit: AgentSpirit | null;
  modelPreference: string;
  autonomy: string;
  traits: string[];
  tools: string[];
  taskFocus: string;
  customInstructions: string;
}

interface Props {
  circleId: string;
  onCreated: (agentId: string, agentName: string) => void;
  onCancel: () => void;
}

type Step = 'identity' | 'spirit' | 'brain' | 'personality' | 'deploy';

const STEPS: { key: Step; label: string; num: number }[] = [
  { key: 'identity',    label: 'Identity',    num: 1 },
  { key: 'spirit',      label: 'Spirit',      num: 2 },
  { key: 'brain',       label: 'Brain',       num: 3 },
  { key: 'personality', label: 'Config',      num: 4 },
  { key: 'deploy',      label: 'Deploy',      num: 5 },
];

// ─── Component ───────────────────────────────────────────────────────────────

export default function SpawnAgentPanel({ circleId, onCreated, onCancel }: Props) {
  const [step, setStep] = useState<Step>('identity');
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customHfModels, setCustomHfModels] = useState<typeof MODEL_PREFERENCES_BASE>([]);

  // Load custom HF models
  React.useEffect(() => {
    import('../lib/customModels').then(({ loadCustomModels }) => {
      loadCustomModels().then(models => {
        const mapped = models.map(m => ({ key: `hf:${m.id}`, label: `${m.label} (HF)`, desc: m.desc }));
        setCustomHfModels(mapped);
        MODEL_PREFERENCES = [...MODEL_PREFERENCES_BASE, ...mapped];
      });
    }).catch(() => {});
  }, []);

  const [config, setConfig] = useState<AgentConfig>({
    name: '',
    provider: 'blackswan',
    color: '#6366f1',
    spirit: null,
    modelPreference: 'auto',
    autonomy: 'balanced',
    traits: ['concise', 'methodical'],
    tools: ['code', 'tasks'],
    taskFocus: '',
    customInstructions: '',
  });

  const update = useCallback((patch: Partial<AgentConfig>) => {
    setConfig(prev => ({ ...prev, ...patch }));
  }, []);

  const toggleTrait = useCallback((key: string) => {
    setConfig(prev => ({
      ...prev,
      traits: prev.traits.includes(key)
        ? prev.traits.filter(t => t !== key)
        : [...prev.traits, key],
    }));
  }, []);

  const toggleTool = useCallback((key: string) => {
    setConfig(prev => ({
      ...prev,
      tools: prev.tools.includes(key)
        ? prev.tools.filter(t => t !== key)
        : [...prev.tools, key],
    }));
  }, []);

  const stepIdx = STEPS.findIndex(s => s.key === step);
  const canNext = (() => {
    if (step === 'identity') return config.name.trim().length >= 2;
    if (step === 'spirit') return true; // spirit is optional
    if (step === 'brain') return true;
    if (step === 'personality') return true;
    return true;
  })();

  const nextStep = useCallback(() => {
    const idx = STEPS.findIndex(s => s.key === step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1].key);
  }, [step]);

  const prevStep = useCallback(() => {
    const idx = STEPS.findIndex(s => s.key === step);
    if (idx > 0) setStep(STEPS[idx - 1].key);
  }, [step]);

  // ── Deploy agent ──
  const handleDeploy = useCallback(async () => {
    if (!config.name.trim()) return;
    setDeploying(true);
    setError(null);

    const providerInfo = PROVIDER_DISPLAY[config.provider] || PROVIDER_DISPLAY['generic-agent'];
    const toolIcon = config.spirit?.emoji || providerInfo.icon;

    const result = await publishAgentToCircle({
      circleId,
      provider: config.provider,
      name: config.name.trim(),
      color: config.color,
      toolIcon,
    });

    if (result.error) {
      setError(result.error);
      setDeploying(false);
      return;
    }

    // Set the spirit if one was chosen
    if (result.agent && config.spirit) {
      await updateAgentSpirit(
        result.agent.id,
        config.spirit.name,
        config.spirit.emoji,
      );
    }

    // Store extended config in the published office row so chat + Office can
    // reuse model/runtime preferences for assign and restore flows.
    if (result.agent) {
      const extendedConfig = {
        modelPreference: config.modelPreference,
        autonomy: config.autonomy,
        traits: config.traits,
        tools: config.tools,
        taskFocus: config.taskFocus,
        customInstructions: config.customInstructions,
      };
      const { supabase } = await import('../lib/supabase');
      await supabase
        .from('circle_office_agents')
        .update({
          current_goal: JSON.stringify(extendedConfig),
          model_name: config.modelPreference === 'auto' ? null : config.modelPreference,
          status: 'idle',
          updated_at: new Date().toISOString(),
        })
        .eq('id', result.agent.id);

      await updateAgentIdentity(result.agent.id, {
        customName: config.name.trim(),
        customColor: config.color,
        spiritId: config.spirit?.id || null,
        spiritEmoji: config.spirit?.emoji || null,
        soulPrompt: config.customInstructions || null,
        customProfileName: config.spirit?.name || null,
        boundAiProvider: config.provider,
        boundModel: config.modelPreference === 'auto' ? undefined : config.modelPreference,
        tags: Array.from(new Set([
          config.provider,
          ...(config.tools || []),
          ...(config.traits || []),
          config.autonomy,
        ].filter(Boolean))),
        isCustomized: true,
      });
    }

    setDeploying(false);
    onCreated(result.agent?.id || '', config.name.trim());
  }, [config, circleId, onCreated]);

  // ── Render steps ──
  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <View style={s.brandMark}><Text style={s.brandLetter}>+</Text></View>
          <Text style={s.headerTitle}>SPAWN AGENT</Text>
        </View>
        <Pressable style={s.cancelBtn} onPress={onCancel}>
          <Text style={s.cancelText}>ESC</Text>
        </Pressable>
      </View>

      {/* Progress bar */}
      <View style={s.progressBar}>
        {STEPS.map((st, i) => (
          <Pressable
            key={st.key}
            style={[s.progressStep, i <= stepIdx && { borderBottomColor: T.accent }]}
            onPress={() => i <= stepIdx && setStep(st.key)}
          >
            <Text style={[s.progressNum, i <= stepIdx && { color: T.accent }]}>{st.num}</Text>
            <Text style={[s.progressLabel, i === stepIdx && { color: T.text }]}>{st.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Step content */}
      <ScrollView style={s.body} showsVerticalScrollIndicator={true} nestedScrollEnabled contentContainerStyle={s.bodyContent}>
        {step === 'identity' && (
          <>
            <Text style={s.stepTitle}>Name & Identity</Text>
            <Text style={s.stepDesc}>Give your agent a name and choose its provider backbone.</Text>

            <Text style={s.label}>AGENT NAME</Text>
            <TextInput
              style={s.textInput}
              value={config.name}
              onChangeText={v => update({ name: v })}
              placeholder="e.g. CodeBot, ResearchAgent, DeployBot..."
              placeholderTextColor={T.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={30}
            />

            <Text style={s.label}>PROVIDER</Text>
            <View style={s.optionGrid}>
              {PROVIDERS.map(p => (
                <Pressable
                  key={p.key}
                  style={[s.optionCard, config.provider === p.key && { borderColor: T.accent, backgroundColor: T.accent + '12' }]}
                  onPress={() => update({ provider: p.key })}
                >
                  <View style={[s.optionIcon, config.provider === p.key && { backgroundColor: T.accent + '30' }]}>
                    <Text style={[s.optionIconText, config.provider === p.key && { color: T.accent }]}>{p.icon}</Text>
                  </View>
                  <Text style={[s.optionLabel, config.provider === p.key && { color: T.accent }]}>{p.label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>COLOR</Text>
            <View style={s.colorRow}>
              {AGENT_COLORS.map(c => (
                <Pressable
                  key={c.color}
                  style={[s.colorDot, { backgroundColor: c.color }, config.color === c.color && s.colorDotActive]}
                  onPress={() => update({ color: c.color })}
                />
              ))}
            </View>
          </>
        )}

        {step === 'spirit' && (
          <>
            <Text style={s.stepTitle}>Choose a Spirit</Text>
            <Text style={s.stepDesc}>
              A spirit gives your agent deep domain expertise. Pick one that matches the task.
            </Text>

            {/* No spirit option */}
            <Pressable
              style={[s.spiritCard, !config.spirit && { borderColor: T.accent, backgroundColor: T.accent + '08' }]}
              onPress={() => update({ spirit: null })}
            >
              <Text style={[s.spiritEmoji]}>-</Text>
              <View style={s.spiritInfo}>
                <Text style={[s.spiritName, !config.spirit && { color: T.accent }]}>No Spirit (General Purpose)</Text>
                <Text style={s.spiritTagline}>Agent responds without a specialty focus</Text>
              </View>
            </Pressable>

            {SPIRIT_CATEGORIES.map(cat => (
              <View key={cat.key}>
                <Text style={[s.catLabel, { color: cat.color }]}>{cat.label.toUpperCase()}</Text>
                {AGENT_SPIRITS.filter(sp => sp.category === cat.key).map(sp => (
                  <Pressable
                    key={sp.id}
                    style={[s.spiritCard, config.spirit?.id === sp.id && { borderColor: sp.color, backgroundColor: sp.color + '08' }]}
                    onPress={() => update({ spirit: sp })}
                  >
                    <Text style={s.spiritEmoji}>{sp.emoji}</Text>
                    <View style={s.spiritInfo}>
                      <Text style={[s.spiritName, config.spirit?.id === sp.id && { color: sp.color }]}>{sp.name}</Text>
                      <Text style={s.spiritTagline} numberOfLines={1}>{sp.tagline}</Text>
                    </View>
                    {config.spirit?.id === sp.id && (
                      <View style={[s.checkMark, { backgroundColor: sp.color }]}>
                        <Text style={s.checkText}>{'>'}</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            ))}
          </>
        )}

        {step === 'brain' && (
          <>
            <Text style={s.stepTitle}>Brain & Model</Text>
            <Text style={s.stepDesc}>
              Choose the LLM backbone and how independently the agent should operate.
            </Text>

            <Text style={s.label}>PREFERRED MODEL</Text>
            {MODEL_PREFERENCES.map(m => (
              <Pressable
                key={m.key}
                style={[s.radioRow, config.modelPreference === m.key && { borderColor: T.accent, backgroundColor: T.accent + '08' }]}
                onPress={() => update({ modelPreference: m.key })}
              >
                <View style={[s.radio, config.modelPreference === m.key && { borderColor: T.accent }]}>
                  {config.modelPreference === m.key && <View style={s.radioFill} />}
                </View>
                <View style={s.radioInfo}>
                  <Text style={[s.radioLabel, config.modelPreference === m.key && { color: T.text }]}>{m.label}</Text>
                  <Text style={s.radioDesc}>{m.desc}</Text>
                </View>
              </Pressable>
            ))}

            <Text style={[s.label, { marginTop: 16 }]}>AUTONOMY LEVEL</Text>
            {AUTONOMY_LEVELS.map(a => (
              <Pressable
                key={a.key}
                style={[s.radioRow, config.autonomy === a.key && { borderColor: T.warning, backgroundColor: T.warning + '08' }]}
                onPress={() => update({ autonomy: a.key })}
              >
                <View style={[s.optionIcon, config.autonomy === a.key && { backgroundColor: T.warning + '30' }]}>
                  <Text style={[s.optionIconText, config.autonomy === a.key && { color: T.warning }]}>{a.icon}</Text>
                </View>
                <View style={s.radioInfo}>
                  <Text style={[s.radioLabel, config.autonomy === a.key && { color: T.text }]}>{a.label}</Text>
                  <Text style={s.radioDesc}>{a.desc}</Text>
                </View>
              </Pressable>
            ))}
          </>
        )}

        {step === 'personality' && (
          <>
            <Text style={s.stepTitle}>Personality & Tools</Text>
            <Text style={s.stepDesc}>
              Shape how the agent communicates and what capabilities it has.
            </Text>

            <Text style={s.label}>PERSONALITY TRAITS (pick 1-3)</Text>
            <View style={s.chipGrid}>
              {PERSONALITY_TRAITS.map(t => (
                <Pressable
                  key={t.key}
                  style={[s.traitChip, config.traits.includes(t.key) && { borderColor: T.info, backgroundColor: T.info + '15' }]}
                  onPress={() => toggleTrait(t.key)}
                >
                  <Text style={[s.traitLabel, config.traits.includes(t.key) && { color: T.info }]}>{t.label}</Text>
                  <Text style={s.traitDesc}>{t.desc}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.label, { marginTop: 16 }]}>TOOL CAPABILITIES</Text>
            <View style={s.chipGrid}>
              {TOOL_CAPABILITIES.map(t => (
                <Pressable
                  key={t.key}
                  style={[s.traitChip, config.tools.includes(t.key) && { borderColor: T.success, backgroundColor: T.success + '15' }]}
                  onPress={() => toggleTool(t.key)}
                >
                  <Text style={[s.traitLabel, config.tools.includes(t.key) && { color: T.success }]}>{t.label}</Text>
                  <Text style={s.traitDesc}>{t.desc}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[s.label, { marginTop: 16 }]}>TASK FOCUS (optional)</Text>
            <TextInput
              style={s.textInput}
              value={config.taskFocus}
              onChangeText={v => update({ taskFocus: v })}
              placeholder="e.g. Frontend React components, API testing, DevOps..."
              placeholderTextColor={T.textMuted}
              multiline
            />

            <Text style={[s.label, { marginTop: 12 }]}>CUSTOM INSTRUCTIONS (optional)</Text>
            <TextInput
              style={[s.textInput, { minHeight: 60 }]}
              value={config.customInstructions}
              onChangeText={v => update({ customInstructions: v })}
              placeholder="Additional instructions or context for this agent..."
              placeholderTextColor={T.textMuted}
              multiline
            />
          </>
        )}

        {step === 'deploy' && (
          <>
            <Text style={s.stepTitle}>Review & Deploy</Text>
            <Text style={s.stepDesc}>
              Your agent will appear in the terminal and can be assigned tasks.
            </Text>

            {/* Summary card */}
            <View style={s.summaryCard}>
              <View style={s.summaryHeader}>
                <View style={[s.summaryDot, { backgroundColor: config.color }]} />
                <Text style={[s.summaryName, { color: config.color }]}>{config.name || 'Unnamed'}</Text>
                <Text style={s.summaryProvider}>
                  {PROVIDERS.find(p => p.key === config.provider)?.label || config.provider}
                </Text>
              </View>

              <View style={s.summaryRow}>
                <Text style={s.summaryKey}>Spirit</Text>
                <Text style={s.summaryValue}>
                  {config.spirit ? `${config.spirit.emoji} ${config.spirit.name}` : 'General Purpose'}
                </Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryKey}>Model</Text>
                <Text style={s.summaryValue}>
                  {MODEL_PREFERENCES.find(m => m.key === config.modelPreference)?.label || 'Auto'}
                </Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryKey}>Autonomy</Text>
                <Text style={s.summaryValue}>
                  {AUTONOMY_LEVELS.find(a => a.key === config.autonomy)?.label || 'Balanced'}
                </Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryKey}>Traits</Text>
                <Text style={s.summaryValue}>{config.traits.join(', ') || 'none'}</Text>
              </View>
              <View style={s.summaryRow}>
                <Text style={s.summaryKey}>Tools</Text>
                <Text style={s.summaryValue}>{config.tools.join(', ') || 'none'}</Text>
              </View>
              {config.taskFocus ? (
                <View style={s.summaryRow}>
                  <Text style={s.summaryKey}>Focus</Text>
                  <Text style={s.summaryValue} numberOfLines={2}>{config.taskFocus}</Text>
                </View>
              ) : null}
              {config.customInstructions ? (
                <View style={s.summaryRow}>
                  <Text style={s.summaryKey}>Custom</Text>
                  <Text style={s.summaryValue} numberOfLines={2}>{config.customInstructions}</Text>
                </View>
              ) : null}
            </View>

            <View style={s.deployInfo}>
              <Text style={s.deployInfoText}>
                Once deployed, your agent will:{'\n'}
                - Appear in the terminal as @{config.name || 'Agent'}{'\n'}
                - Be assignable to kanban tasks{'\n'}
                - Show in the circle office{'\n'}
                - Use its spirit expertise in all responses
              </Text>
            </View>

            {error && (
              <View style={s.errorBox}>
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Footer nav */}
      <View style={s.footer}>
        {stepIdx > 0 ? (
          <Pressable style={s.backBtn} onPress={prevStep}>
            <Text style={s.backBtnText}>{'<'} Back</Text>
          </Pressable>
        ) : (
          <Pressable style={s.backBtn} onPress={onCancel}>
            <Text style={s.backBtnText}>Cancel</Text>
          </Pressable>
        )}

        <View style={{ flex: 1 }} />

        {step === 'deploy' ? (
          <Pressable
            style={[s.deployBtn, deploying && { opacity: 0.5 }]}
            onPress={handleDeploy}
            disabled={deploying}
          >
            <Text style={s.deployBtnText}>{deploying ? 'Deploying...' : 'Deploy Agent'}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[s.nextBtn, !canNext && { opacity: 0.3 }]}
            onPress={nextStep}
            disabled={!canNext}
          >
            <Text style={s.nextBtnText}>Next {'>'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: T.panel, borderBottomWidth: 1, borderBottomColor: T.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandMark: {
    width: 24, height: 24, borderRadius: 2,
    backgroundColor: T.accent, alignItems: 'center', justifyContent: 'center',
  },
  brandLetter: { color: '#fff', fontFamily: MONO, fontSize: 14, fontWeight: '900' },
  headerTitle: { color: T.text, fontFamily: MONO, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  cancelBtn: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 2,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cancelText: { color: T.textMuted, fontFamily: MONO, fontSize: 9, fontWeight: '700' },

  // Progress
  progressBar: {
    flexDirection: 'row', backgroundColor: T.panel,
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  progressStep: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, paddingVertical: 6,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  progressNum: { color: T.textMuted, fontFamily: MONO, fontSize: 10, fontWeight: '800' },
  progressLabel: { color: T.textMuted, fontFamily: MONO, fontSize: 8, letterSpacing: 1 },

  // Body
  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 32 },
  stepTitle: { color: T.text, fontFamily: MONO, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  stepDesc: { color: T.textSec, fontFamily: MONO, fontSize: 10, lineHeight: 16, marginBottom: 16 },

  // Form elements
  label: {
    color: T.textMuted, fontFamily: MONO, fontSize: 8, fontWeight: '700',
    letterSpacing: 1.5, marginBottom: 6, marginTop: 8,
  },
  textInput: {
    backgroundColor: T.card, borderWidth: 1, borderColor: T.border, borderRadius: 2,
    color: T.text, fontFamily: MONO, fontSize: 12,
    paddingHorizontal: 10, paddingVertical: 8, minHeight: 36,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  // Option grid (providers)
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 2,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
    minWidth: 100,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  optionIcon: {
    width: 20, height: 20, borderRadius: 2,
    backgroundColor: T.panel, alignItems: 'center', justifyContent: 'center',
  },
  optionIconText: { color: T.textMuted, fontFamily: MONO, fontSize: 10, fontWeight: '800' },
  optionLabel: { color: T.textSec, fontFamily: MONO, fontSize: 10, fontWeight: '600' },

  // Color picker
  colorRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  colorDot: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  colorDotActive: { borderColor: '#ffffff', borderWidth: 2 },

  // Spirit cards
  catLabel: {
    fontFamily: MONO, fontSize: 8, fontWeight: '800', letterSpacing: 1.5,
    marginTop: 14, marginBottom: 6,
  },
  spiritCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 2,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
    marginBottom: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  spiritEmoji: { fontSize: 18, width: 28, textAlign: 'center' },
  spiritInfo: { flex: 1 },
  spiritName: { color: T.textSec, fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  spiritTagline: { color: T.textMuted, fontFamily: MONO, fontSize: 9, marginTop: 1 },
  checkMark: {
    width: 18, height: 18, borderRadius: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkText: { color: '#fff', fontFamily: MONO, fontSize: 10, fontWeight: '900' },

  // Radio rows (model, autonomy)
  radioRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 2,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
    marginBottom: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  radio: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: T.textMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  radioFill: { width: 6, height: 6, borderRadius: 3, backgroundColor: T.accent },
  radioInfo: { flex: 1 },
  radioLabel: { color: T.textSec, fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  radioDesc: { color: T.textMuted, fontFamily: MONO, fontSize: 9 },

  // Trait/tool chips
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  traitChip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 2,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
    minWidth: 80,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  traitLabel: { color: T.textSec, fontFamily: MONO, fontSize: 10, fontWeight: '700' },
  traitDesc: { color: T.textMuted, fontFamily: MONO, fontSize: 8, marginTop: 1 },

  // Summary card
  summaryCard: {
    backgroundColor: T.card, borderWidth: 1, borderColor: T.borderLit, borderRadius: 2,
    padding: 12, gap: 8,
  },
  summaryHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  summaryDot: { width: 10, height: 10, borderRadius: 5 },
  summaryName: { fontFamily: MONO, fontSize: 14, fontWeight: '800' },
  summaryProvider: { color: T.textMuted, fontFamily: MONO, fontSize: 9, marginLeft: 'auto' },
  summaryRow: { flexDirection: 'row', gap: 12 },
  summaryKey: { color: T.textMuted, fontFamily: MONO, fontSize: 9, fontWeight: '700', width: 60 },
  summaryValue: { color: T.text, fontFamily: MONO, fontSize: 10, flex: 1 },

  deployInfo: {
    marginTop: 12, padding: 10, borderRadius: 2,
    backgroundColor: T.accent + '08', borderWidth: 1, borderColor: T.accent + '30',
  },
  deployInfoText: { color: T.textSec, fontFamily: MONO, fontSize: 10, lineHeight: 16 },

  errorBox: {
    marginTop: 8, padding: 8, borderRadius: 2,
    backgroundColor: T.error + '15', borderWidth: 1, borderColor: T.error + '40',
  },
  errorText: { color: T.error, fontFamily: MONO, fontSize: 10 },

  // Footer
  footer: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: T.panel, borderTopWidth: 1, borderTopColor: T.border,
  },
  backBtn: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 2,
    backgroundColor: T.card, borderWidth: 1, borderColor: T.border,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  backBtnText: { color: T.textSec, fontFamily: MONO, fontSize: 10, fontWeight: '600' },
  nextBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 2,
    backgroundColor: T.accent,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  nextBtnText: { color: '#fff', fontFamily: MONO, fontSize: 10, fontWeight: '800' },
  deployBtn: {
    paddingHorizontal: 20, paddingVertical: 8, borderRadius: 2,
    backgroundColor: T.accent,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deployBtnText: { color: '#fff', fontFamily: MONO, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
});
