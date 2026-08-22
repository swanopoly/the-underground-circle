/**
 * SpawnAgentsModal — 1-click multi-agent (mass) deployer.
 * Black & white aesthetic with pop + hover effects on all interactive elements.
 *
 * Phase-3 refresh:
 *   - Models come from the live provider registry, not a stale alias list.
 *     The always-selectable default set is the three current Claude tiers
 *     (opus-4-8 / sonnet-4-6 / haiku-4-5) plus 'auto'; when a circle is in
 *     scope, connected-provider ready models are merged in.
 *   - The agent-count ceiling is the policy ceiling MAX_AGENTS_PER_DEPLOY (50),
 *     clamped through capDeployCount.
 *   - A live cost estimate (estimateDeployCostUsd) and a "requires approval"
 *     badge (shouldRequireApproval) update as the user changes count/model.
 *   - When a circle + user are in scope the deploy runs the WEB path
 *     (buildAgentDeployPlan -> deployAgents) so it works on Netlify. Without
 *     them it falls back to the local Claude Code bridge spawner. Either way
 *     the model is resolved through resolveDeployModel first (alias-normalized,
 *     catalog-validated, fail-closed for the bridge channel). Deployed agents
 *     are TRANSIENT — no persistent office-agent rows are created.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  type SpawnResult,
  isBridgeAvailable,
  spawnAgents,
} from '../../../../lib/agentSpawner';
import { PROVIDER_MODELS } from '../../../../lib/llmProviders';
import { loadModelGroups, type ModelGroup } from '../../../../lib/integrations/modelProviderRegistry';
import { resolvePlainChatModelRoute } from '../../../../lib/crossProviderRouter';
import { resolveModelSelectionReadiness } from '../../../../lib/modelCatalogReadinessCore';
import {
  MAX_AGENTS_PER_DEPLOY,
  capDeployCount,
  estimateDeployCostUsd,
  shouldRequireApproval,
} from '../../../../lib/agentDeployPolicy';
import { buildAgentDeployPlan } from '../../../../lib/agentDeployPlan';
import { resolveDeployModel } from '../../../../lib/agentDeployModelPolicy';
import { deployAgents } from '../../../../lib/agentDeployOrchestrator';
import {
  buildSubagentBridgeTask,
  detectSubagentCapability,
  listSubagentCapabilities,
  type SubagentRole,
} from '../../../../lib/subagentCapabilities';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSpawned?: (result: SpawnResult) => void;
  defaultTask?: string;
  missionTasks?: Array<{ title: string; description?: string }>;
  /** When both are present, the deploy runs the in-app WEB path (Netlify-safe)
   *  instead of the local bridge. ChatTab already has `circleId` in scope, so
   *  wiring these through enables web deploys for the chat surface. */
  circleId?: string | null;
  userId?: string | null;
}

type Mode = 'uniform' | 'individual';
interface AgentSlot {
  id: number;
  task: string;
  model?: string;
  role: SubagentRole;
}

interface ModelChoice { key: string; label: string }

const DEFAULT_SPECIALTY_ROLE: SubagentRole = 'coder';
const SPECIALTY_CHOICES = listSubagentCapabilities();
const SPECIALTY_BY_ROLE = new Map(SPECIALTY_CHOICES.map((choice) => [choice.role, choice]));

// Always-available default set: the three current Claude tiers (sourced from
// the provider catalog so the ids stay correct) plus 'auto'. Connected
// providers extend this at runtime via loadModelGroups.
const DEFAULT_MODEL_IDS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'] as const;

const shortModelLabel = (id: string, fallback?: string): string => {
  // Compact, uppercase chip labels in keeping with the existing aesthetic.
  if (id === 'auto') return 'AUTO';
  const bare = id.includes('/') ? id.slice(id.lastIndexOf('/') + 1) : id;
  if (bare.startsWith('claude-opus')) return 'OPUS';
  if (bare.startsWith('claude-sonnet')) return 'SONNET';
  if (bare.startsWith('claude-haiku')) return 'HAIKU';
  if (bare.startsWith('claude-fable')) return 'FABLE';
  return (fallback || bare).toUpperCase();
};

const buildDefaultModelChoices = (): ModelChoice[] => {
  const anthropic = PROVIDER_MODELS.anthropic || [];
  const choices: ModelChoice[] = [{ key: 'auto', label: 'AUTO' }];
  for (const id of DEFAULT_MODEL_IDS) {
    const found = anthropic.find((m) => m.id === id);
    // Fall back to the literal id if the catalog ever drops it — fail visible,
    // never silently swap to a different model.
    choices.push({ key: id, label: shortModelLabel(id, found?.label) });
  }
  return choices;
};

// Web-only transition for smooth hover/press animations
const transition = Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {};

export default function SpawnAgentsModal({ visible, onClose, onSpawned, defaultTask, missionTasks, circleId, userId }: Props) {
  const webChannel = !!(circleId && userId);

  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('uniform');
  const [uniformTask, setUniformTask] = useState(defaultTask || '');
  const [uniformModel, setUniformModel] = useState<string>('auto');
  const [uniformRole, setUniformRole] = useState<SubagentRole>(DEFAULT_SPECIALTY_ROLE);
  const [slots, setSlots] = useState<AgentSlot[]>([
    { id: 1, task: '', model: 'auto', role: DEFAULT_SPECIALTY_ROLE },
    { id: 2, task: '', model: 'auto', role: DEFAULT_SPECIALTY_ROLE },
    { id: 3, task: '', model: 'auto', role: DEFAULT_SPECIALTY_ROLE },
  ]);
  const [useWorktree, setUseWorktree] = useState(true);
  const [spawning, setSpawning] = useState(false);
  const spawnInFlightRef = useRef(false);
  const [result, setResult] = useState<SpawnResult | null>(null);
  const [modelChoices, setModelChoices] = useState<ModelChoice[]>(buildDefaultModelChoices);
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [accountModelGroups, setAccountModelGroups] = useState<ModelGroup[]>([]);
  const [modelCatalogNotice, setModelCatalogNotice] = useState<string | null>(null);
  // Explicit human approval for over-cap / large fan-out deploys.
  const [approved, setApproved] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setResult(null);
    setApproved(false);
    // The web channel doesn't need the local bridge; treat it as "ready" so
    // the form shows. The bridge channel still probes availability.
    if (webChannel) {
      setBridgeOk(true);
    } else {
      setBridgeOk(null);
      isBridgeAvailable().then(setBridgeOk);
    }
    if (missionTasks?.length) {
      setSlots(missionTasks.map((t, i) => ({
        id: i + 1,
        task: `${t.title}${t.description ? ` — ${t.description}` : ''}`,
        model: 'auto',
        role: detectSubagentCapability(`${t.title} ${t.description || ''}`)?.role || DEFAULT_SPECIALTY_ROLE,
      })));
      setMode('individual');
    }
  }, [visible, missionTasks, webChannel]);

  // Merge connected-provider ready models into the selectable set. Default
  // Claude tiers + 'auto' are always present; connected providers extend it.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const groups = await loadModelGroups(circleId ?? null);
        if (cancelled) return;
        setAccountModelGroups(groups);
        const emptyAccountCatalogs = groups
          .filter((group) => group.connected && group.catalogStatus === 'account_verified_empty')
          .map((group) => group.label);
        const fallbackCatalogs = groups
          .filter((group) => group.connected && ['curated_fallback', 'catalog_unsupported'].includes(group.catalogStatus))
          .map((group) => group.label);
        setModelCatalogNotice(
          emptyAccountCatalogs.length > 0
            ? `${emptyAccountCatalogs.join(', ')} returned no supported chat models for this key.`
            : fallbackCatalogs.length > 0
              ? `${fallbackCatalogs.join(', ')} ${fallbackCatalogs.length === 1 ? 'is' : 'are'} using a curated fallback. Exact access is checked when deployment starts.`
              : null,
        );
        const providers = new Set<string>();
        const extra: ModelChoice[] = [];
        const baseChoices = webChannel
          ? [{ key: 'auto', label: 'AUTO' }]
          : buildDefaultModelChoices();
        const seen = new Set<string>(baseChoices.map((choice) => choice.key));
        for (const group of groups) {
          if (group.connected && group.models.some((model) => model.ready)) providers.add(group.provider);
          for (const model of group.models) {
            if (!model.ready || seen.has(model.id)) continue;
            seen.add(model.id);
            extra.push({ key: model.id, label: shortModelLabel(model.id, model.label) });
          }
        }
        setConnectedProviders(Array.from(providers));
        // Keep the default Claude tiers first, then any connected extras.
        setModelChoices([...baseChoices, ...extra]);
      } catch {
        if (!cancelled) {
          setConnectedProviders([]);
          setAccountModelGroups([]);
          setModelChoices(webChannel ? [{ key: 'auto', label: 'AUTO' }] : buildDefaultModelChoices());
          setModelCatalogNotice('Account model catalogs could not be checked. Exact access is checked when deployment starts.');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [visible, circleId, webChannel]);

  const addSlot = () => {
    if (slots.length >= MAX_AGENTS_PER_DEPLOY) return;
    setSlots(prev => [...prev, {
      id: Date.now(),
      task: '',
      model: uniformModel,
      role: uniformRole,
    }]);
  };
  const removeSlot = (id: number) => {
    if (slots.length <= 1) return;
    setSlots(prev => prev.filter(s => s.id !== id));
  };
  const updateSlot = (id: number, patch: Partial<AgentSlot>) => {
    setSlots(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  // Active count + the per-agent model list that drives the cost estimate.
  const activeModels = useMemo<string[]>(() => {
    if (mode === 'uniform') {
      return Array.from({ length: slots.length }, () => uniformModel);
    }
    return slots.filter(s => s.task.trim()).map(s => s.model || 'auto');
  }, [mode, slots, uniformModel]);

  const activeCount = activeModels.length;

  // Live cost estimate + approval gate. 'auto' is priced via the deploy
  // default (sonnet) so the user sees a realistic figure before resolution.
  const estimateUsd = useMemo(
    () => estimateDeployCostUsd(activeModels.map(m => (m === 'auto' ? 'claude-sonnet-5' : m))),
    [activeModels],
  );
  const approval = useMemo(
    () => shouldRequireApproval({ count: activeCount, estimateUsd }),
    [activeCount, estimateUsd],
  );

  // Re-clamp approval consent if the user drops back under the gate.
  useEffect(() => {
    if (!approval.required && approved) setApproved(false);
  }, [approval.required, approved]);

  const setAgentCount = (n: number) => {
    const { count } = capDeployCount(n);
    setSlots(Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      task: '',
      model: uniformModel,
      role: uniformRole,
    })));
  };

  const handleSpawn = async () => {
    if (spawnInFlightRef.current) return;
    spawnInFlightRef.current = true;
    setSpawning(true);
    setResult(null);
    try {
      // Build the per-agent (task, model, specialty) list shared by both
      // channels. Specialty is explicit launch authority, never inferred by
      // the executor after the user commits this deploy.
      const tasks = mode === 'uniform'
        ? Array.from({ length: slots.length }, (_, i) => ({
            task: slots.length > 1 ? `${uniformTask} (agent ${i + 1}/${slots.length})` : uniformTask,
            model: uniformModel,
            role: uniformRole,
          }))
        : slots.filter(s => s.task.trim()).map(s => ({
            task: s.task,
            model: s.model || 'auto',
            role: s.role,
          }));
      if (tasks.length === 0) {
        setResult({ ok: false, spawned: 0, total: 0, results: [], message: 'No tasks to spawn.' });
        setSpawning(false);
        return;
      }

      // Hard guard: anything past the gate must be explicitly approved.
      if (approval.required && !approved) {
        setResult({ ok: false, spawned: 0, total: tasks.length, results: [], message: `Approval required: ${approval.reason}` });
        setSpawning(false);
        return;
      }

      const channel: 'web' | 'bridge' = webChannel ? 'web' : 'bridge';

      // Resolve every model through the deploy policy FIRST: normalizes
      // aliases, validates against the catalog, and fails closed (e.g. a
      // non-claude id over the bridge). Never silently swaps a model.
      const resolved = tasks.map((t) => ({
        task: t.task,
        role: t.role,
        resolution: resolveDeployModel(t.model, { connectedProviders, channel }),
      }));
      const blocked = resolved.filter((r) => !r.resolution.ok);
      if (blocked.length > 0) {
        const first = blocked[0].resolution;
        setResult({
          ok: false,
          spawned: 0,
          total: tasks.length,
          results: [],
          message: `Cannot deploy: ${first.reason || `model "${first.model}" is not deployable on the ${channel} channel.`}`,
        });
        setSpawning(false);
        return;
      }

      if (webChannel && accountModelGroups.length > 0) {
        const unavailable = resolved.find((item) => {
          const readiness = resolveModelSelectionReadiness({
            route: resolvePlainChatModelRoute(item.resolution.model),
            groups: accountModelGroups,
          });
          return !readiness.ready;
        });
        if (unavailable) {
          const readiness = resolveModelSelectionReadiness({
            route: resolvePlainChatModelRoute(unavailable.resolution.model),
            groups: accountModelGroups,
          });
          setResult({
            ok: false,
            spawned: 0,
            total: tasks.length,
            results: [],
            message: `Cannot deploy: ${readiness.message} Pick a ready account model or update the provider in Marketplace. Nothing launched.`,
          });
          setSpawning(false);
          return;
        }
      }

      if (webChannel) {
        // WEB path — Netlify-safe. Build a capped plan, then deploy. Deployed
        // agents are transient (no office-agent rows persisted).
        const plan = buildAgentDeployPlan({
          mode: 'individual',
          count: resolved.length,
          perAgentModels: resolved.map((r) => r.resolution.model),
          perAgentRoles: resolved.map((r) => r.role),
          // Carry each agent's brief as its prompt so the delegated turn has
          // the exact task while the plan owns its exact specialty role.
          prompt: null,
        });
        // buildAgentDeployPlan keeps prompt uniform across specs, so attach the
        // per-agent task brief onto the capped specs here.
        const specs = plan.specs.map((spec, i) => ({ ...spec, prompt: resolved[i]?.task ?? spec.prompt }));
        const r = await deployAgents({
          circleId: circleId as string,
          userId: userId as string,
          plan: { ...plan, specs },
          connectedProviders,
        });
        const mapped: SpawnResult = {
          ok: r.deployed > 0,
          spawned: r.deployed,
          total: r.items.length,
          results: r.items.map((item) => ({
            ok: item.ok,
            task: resolved[item.index]?.task || `Agent ${item.index + 1}`,
            error: item.error,
          })),
          message: r.deployed > 0
            ? `Deployed ${r.deployed}/${r.items.length} agent${r.deployed === 1 ? '' : 's'} (${r.channel}).`
            : `Deployment failed${r.channel !== 'none' ? ` on the ${r.channel} channel` : ''}.`,
        };
        setResult(mapped);
        onSpawned?.(mapped);
      } else {
        // BRIDGE path (legacy / local). The bridge accepts only a task string,
        // so encode the same exact SOUL + skill contract used by the web
        // profile. Keep the user-facing receipt on the original task brief.
        const bridgeResult = await spawnAgents({
          tasks: resolved.map((rr) => ({
            task: buildSubagentBridgeTask(rr.role, rr.task),
            model: rr.resolution.model,
          })),
          useWorktree,
        });
        const r: SpawnResult = {
          ...bridgeResult,
          results: bridgeResult.results.map((item, index) => ({
            ...item,
            task: resolved[index]?.task || item.task,
          })),
        };
        setResult(r);
        onSpawned?.(r);
      }
    } catch (err: any) {
      const failResult: SpawnResult = { ok: false, spawned: 0, total: 0, results: [], message: err?.message || 'Spawn failed' };
      setResult(failResult);
      onSpawned?.(failResult);
    } finally {
      spawnInFlightRef.current = false;
      setSpawning(false);
    }
  };

  const needsApproval = approval.required;
  const canSpawn = !spawning
    && activeCount > 0
    && (mode === 'individual' || uniformTask.trim())
    && (!needsApproval || approved);

  // Count pill presets, clamped to the ceiling. Max is exposed explicitly.
  const COUNT_PRESETS = [1, 3, 5, 10, 25, MAX_AGENTS_PER_DEPLOY];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!spawning) onClose(); }}>
      <Pressable style={st.scrim} onPress={() => { if (!spawning) onClose(); }}>
        <Pressable style={st.card} onPress={e => e.stopPropagation()}>

          {/* Header */}
          <View style={st.header}>
            <View style={st.headerLeft}>
              <View style={st.headerIcon}><Text style={st.headerIconText}>//</Text></View>
              <View>
                <Text style={st.title}>SPAWN AGENTS</Text>
                <Text style={st.subtitle}>
                  {webChannel ? 'Deploy transient agents (in-app)' : 'Launch parallel Claude Code sessions'}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={onClose}
              disabled={spawning}
              accessibilityRole="button"
              accessibilityLabel="Close Spawn Agents"
              accessibilityState={{ disabled: spawning }}
              style={({ hovered, pressed }: any) => [
                st.closeBtn, transition,
                hovered && { borderColor: '#888', backgroundColor: '#1a1a1a' },
                pressed && { backgroundColor: '#333' },
              ]}
            >
              <Text style={st.closeBtnText}>ESC</Text>
            </Pressable>
          </View>

          <View style={st.divider} />

          {/* Bridge check (bridge channel only) */}
          {!webChannel && bridgeOk === false && (
            <View style={st.errorBox} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              <Text style={st.errorTitle}>BRIDGE OFFLINE</Text>
              <Text style={st.errorText}>Start the bridge first:</Text>
              <View style={st.codeBlock}><Text style={st.codeText}>node scripts/claude-bridge.js</Text></View>
            </View>
          )}
          {!webChannel && bridgeOk === null && (
            <View style={st.loadingRow} accessibilityLiveRegion="polite">
              <ActivityIndicator color="#999" accessibilityRole="progressbar" accessibilityLabel="Checking Claude Code Bridge" />
              <Text style={st.loadingText}>Detecting Claude Code Bridge...</Text>
            </View>
          )}

          {/* Main form */}
          {bridgeOk && !result && (
            <>
              {/* Mode toggle */}
              <View style={st.modeRow}>
                {(['uniform', 'individual'] as Mode[]).map(m => (
                  <Pressable
                    key={m}
                    onPress={() => setMode(m)}
                    accessibilityRole="button"
                    accessibilityLabel={m === 'uniform' ? 'Use one task and specialty for all agents' : 'Configure each agent task and specialty'}
                    accessibilityState={{ selected: mode === m }}
                    style={({ hovered, pressed }: any) => [
                      st.modeBtn, transition,
                      mode === m && st.modeBtnActive,
                      hovered && mode !== m && { borderColor: '#555', backgroundColor: '#0e0e0e' },
                      pressed && { transform: [{ scale: 0.97 }] },
                    ]}
                  >
                    <Text style={[st.modeBtnText, mode === m && st.modeBtnTextActive]}>
                      {m === 'uniform' ? 'UNIFORM' : 'INDIVIDUAL'}
                    </Text>
                    <Text style={st.modeBtnSub}>
                      {m === 'uniform' ? 'Same task, N agents' : 'Unique task per agent'}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {mode === 'uniform' ? (
                <View style={st.section}>
                  <Text style={st.sectionLabel}>TASK BRIEF</Text>
                  <TextInput
                    value={uniformTask}
                    onChangeText={setUniformTask}
                    accessibilityLabel="Task brief for all agents"
                    placeholder="Describe what each agent should work on..."
                    placeholderTextColor="#555"
                    style={st.input}
                    multiline
                    numberOfLines={4}
                  />
                  <View style={st.specialtySection}>
                    <Text style={st.countLabel}>SPECIALTY · SOUL + SKILL</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.specialtyChipRow}>
                      {SPECIALTY_CHOICES.map(choice => {
                        const active = uniformRole === choice.role;
                        return (
                          <Pressable
                            key={choice.role}
                            onPress={() => {
                              setUniformRole(choice.role);
                              setSlots(prev => prev.map(slot => ({ ...slot, role: choice.role })));
                            }}
                            accessibilityRole="button"
                            accessibilityLabel={`${choice.displayName} specialty. SOUL ${choice.spiritId}. Skill bundle ${choice.skillBundleId}.`}
                            accessibilityState={{ selected: active }}
                            style={({ hovered, pressed }: any) => [
                              st.specialtyChip,
                              active && st.specialtyChipActive,
                              Platform.OS === 'web' && transition,
                              hovered && !active && { borderColor: choice.color, backgroundColor: `${choice.color}10` },
                              pressed && { transform: [{ scale: 0.97 }] },
                            ]}
                          >
                            <Text style={[st.specialtyChipTitle, active && st.specialtyChipTitleActive]}>{choice.displayName.toUpperCase()}</Text>
                            <Text style={[st.specialtyChipMeta, active && st.specialtyChipMetaActive]} numberOfLines={1}>
                              SOUL {choice.spiritId} · {choice.skillBundleId}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                  <View style={st.countRow}>
                    <Text style={st.countLabel}>AGENTS</Text>
                    <View style={st.countPills}>
                      {COUNT_PRESETS.map(n => (
                        <Pressable
                          key={n}
                          onPress={() => setAgentCount(n)}
                          accessibilityRole="button"
                          accessibilityLabel={n === MAX_AGENTS_PER_DEPLOY ? `Use maximum ${n} agents` : `Use ${n} agents`}
                          accessibilityState={{ selected: slots.length === n }}
                          style={({ hovered, pressed }: any) => [
                            st.countPill, transition,
                            slots.length === n && st.countPillActive,
                            hovered && slots.length !== n && { borderColor: '#888', backgroundColor: '#1a1a1a' },
                            pressed && { transform: [{ scale: 0.92 }] },
                          ]}
                        >
                          <Text style={[st.countPillText, slots.length === n && st.countPillTextActive]}>
                            {n === MAX_AGENTS_PER_DEPLOY ? 'MAX' : n}
                          </Text>
                        </Pressable>
                      ))}
                      <TextInput
                        value={String(slots.length)}
                        onChangeText={v => setAgentCount(parseInt(v, 10) || 1)}
                        accessibilityLabel="Number of agents"
                        style={st.countInput}
                        keyboardType="numeric"
                        maxLength={2}
                        selectTextOnFocus
                      />
                    </View>
                  </View>
                  <View style={st.modelRow}>
                    <Text style={st.countLabel}>MODEL</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.modelChipRow}>
                      {modelChoices.map(option => (
                        <Pressable
                          key={option.key}
                          onPress={() => {
                            setUniformModel(option.key);
                            setSlots(prev => prev.map(slot => ({ ...slot, model: option.key })));
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Model ${option.label} for all agents`}
                          accessibilityState={{ selected: uniformModel === option.key }}
                          style={({ hovered, pressed }: any) => [
                            st.modelChip,
                            uniformModel === option.key && st.modelChipActive,
                            Platform.OS === 'web' && transition,
                            hovered && uniformModel !== option.key && { borderColor: '#777', backgroundColor: '#111' },
                            pressed && { transform: [{ scale: 0.96 }] },
                          ]}
                        >
                          <Text style={[st.modelChipText, uniformModel === option.key && st.modelChipTextActive]}>{option.label}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              ) : (
                <View style={st.section}>
                  <View style={st.sectionHeader}>
                    <Text style={st.sectionLabel}>AGENT TASKS</Text>
                    <Pressable
                      onPress={addSlot}
                      accessibilityRole="button"
                      accessibilityLabel="Add agent"
                      style={({ hovered, pressed }: any) => [
                        st.addBtn, transition,
                        hovered && { borderColor: '#fff', backgroundColor: '#1a1a1a' },
                        pressed && { backgroundColor: '#333' },
                      ]}
                    >
                      <Text style={st.addBtnText}>+ ADD AGENT</Text>
                    </Pressable>
                  </View>
                  <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={st.slotList} showsVerticalScrollIndicator={false}>
                    {slots.map((slot, i) => (
                      <View key={slot.id} style={st.slotRow}>
                        <View style={st.slotIndex}>
                          <Text style={st.slotIndexText}>{String(i + 1).padStart(2, '0')}</Text>
                        </View>
                        <View style={st.slotBody}>
                          <TextInput
                            value={slot.task}
                            onChangeText={t => updateSlot(slot.id, { task: t })}
                            accessibilityLabel={`Task brief for agent ${i + 1}`}
                            placeholder={`Agent ${i + 1} task...`}
                            placeholderTextColor="#444"
                            style={st.slotInput}
                            multiline
                          />
                          <Text style={st.slotFieldLabel}>SPECIALTY · SOUL + SKILL</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.slotSpecialties}>
                            {SPECIALTY_CHOICES.map(choice => {
                              const active = slot.role === choice.role;
                              return (
                                <Pressable
                                  key={`${slot.id}-${choice.role}`}
                                  onPress={() => updateSlot(slot.id, { role: choice.role })}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Agent ${i + 1}: ${choice.displayName} specialty, SOUL ${choice.spiritId}, skill bundle ${choice.skillBundleId}`}
                                  accessibilityState={{ selected: active }}
                                  style={({ hovered, pressed }: any) => [
                                    st.slotSpecialtyChip,
                                    active && st.slotSpecialtyChipActive,
                                    Platform.OS === 'web' && transition,
                                    hovered && !active && { borderColor: choice.color },
                                    pressed && { transform: [{ scale: 0.96 }] },
                                  ]}
                                >
                                  <Text style={[st.slotSpecialtyText, active && st.slotSpecialtyTextActive]}>{choice.displayName.toUpperCase()}</Text>
                                </Pressable>
                              );
                            })}
                          </ScrollView>
                          <Text style={st.slotSpecialtyReceipt} numberOfLines={2}>
                            SOUL {SPECIALTY_BY_ROLE.get(slot.role)?.spiritId} · SKILL {SPECIALTY_BY_ROLE.get(slot.role)?.skillBundleId}
                          </Text>
                          <Text style={st.slotFieldLabel}>MODEL</Text>
                          <View style={st.slotModels}>
                            {modelChoices.map(option => {
                              const active = (slot.model || 'auto') === option.key;
                              return (
                                <Pressable
                                  key={`${slot.id}-${option.key}`}
                                  onPress={() => updateSlot(slot.id, { model: option.key })}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Agent ${i + 1} model ${option.label}`}
                                  accessibilityState={{ selected: active }}
                                  style={({ hovered, pressed }: any) => [
                                    st.slotModelChip,
                                    active && st.slotModelChipActive,
                                    Platform.OS === 'web' && transition,
                                    hovered && !active && { borderColor: '#666', backgroundColor: '#111' },
                                    pressed && { transform: [{ scale: 0.95 }] },
                                  ]}
                                >
                                  <Text style={[st.slotModelChipText, active && st.slotModelChipTextActive]}>{option.label}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                        {slots.length > 1 && (
                          <Pressable
                            onPress={() => removeSlot(slot.id)}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove agent ${i + 1}`}
                            style={({ hovered, pressed }: any) => [
                              st.slotRemove, transition,
                              hovered && { borderColor: '#fff', backgroundColor: '#fff' },
                              pressed && { transform: [{ scale: 0.9 }] },
                            ]}
                          >
                            <Text style={st.slotRemoveText}>x</Text>
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {modelCatalogNotice ? (
                <View style={st.catalogNotice}>
                  <Text style={st.catalogNoticeText}>{modelCatalogNotice}</Text>
                </View>
              ) : null}

              <View style={st.divider} />

              {/* Live cost estimate + approval badge */}
              <View style={st.estimateRow}>
                <View style={st.estimateLeft}>
                  <Text style={st.estimateLabel}>EST. COST</Text>
                  <Text style={st.estimateValue}>~${estimateUsd.toFixed(2)}</Text>
                  <Text style={st.estimateSub}>{activeCount} agent{activeCount === 1 ? '' : 's'}</Text>
                </View>
                {needsApproval && (
                  <View style={st.approvalBadge}>
                    <Text style={st.approvalBadgeText}>REQUIRES APPROVAL</Text>
                  </View>
                )}
              </View>
              {needsApproval && (
                <Pressable
                  onPress={() => setApproved(v => !v)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`Approve deploy. ${approval.reason}`}
                  accessibilityState={{ checked: approved }}
                  style={({ hovered }: any) => [
                    st.approveRow, transition,
                    approved && st.approveRowActive,
                    hovered && !approved && { borderColor: '#f59e0b80', backgroundColor: '#f59e0b0a' },
                  ]}
                >
                  <View style={[st.optionCheck, approved && st.approveCheckActive]}>
                    {approved && <Text style={st.optionCheckMark}>//</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.approveLabel}>APPROVE THIS DEPLOY</Text>
                    <Text style={st.approveDesc}>{approval.reason}</Text>
                  </View>
                </Pressable>
              )}

              {/* Options — worktree isolation only applies to the bridge path */}
              {!webChannel && (
                <Pressable
                  onPress={() => setUseWorktree(v => !v)}
                  accessibilityRole="checkbox"
                  accessibilityLabel="Git worktree isolation"
                  accessibilityState={{ checked: useWorktree }}
                  style={({ hovered }: any) => [
                    st.optionRow, transition,
                    hovered && { borderColor: '#555', backgroundColor: '#0a0a0a' },
                  ]}
                >
                  <View style={[st.optionCheck, useWorktree && st.optionCheckActive]}>
                    {useWorktree && <Text style={st.optionCheckMark}>//</Text>}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.optionLabel}>GIT WORKTREE ISOLATION</Text>
                    <Text style={st.optionDesc}>Each agent gets its own branch. Recommended for code changes.</Text>
                  </View>
                </Pressable>
              )}

              {/* Footer */}
              <View style={st.footer}>
                <Pressable
                  onPress={onClose}
                  disabled={spawning}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel agent deploy"
                  accessibilityState={{ disabled: spawning }}
                  style={({ hovered, pressed }: any) => [
                    st.cancelBtn, transition,
                    hovered && { borderColor: '#888', backgroundColor: '#111' },
                    pressed && { backgroundColor: '#222' },
                  ]}
                >
                  <Text style={st.cancelBtnText}>CANCEL</Text>
                </Pressable>
                <Pressable
                  onPress={handleSpawn}
                  disabled={!canSpawn}
                  accessibilityRole="button"
                  accessibilityLabel={spawning ? 'Deploying specialist agents' : `Deploy ${activeCount} specialist agents`}
                  accessibilityState={{ disabled: !canSpawn, busy: spawning }}
                  style={({ hovered, pressed }: any) => [
                    st.spawnBtn, transition,
                    !canSpawn && { opacity: 0.3 },
                    hovered && canSpawn && {
                      backgroundColor: '#2dd869',
                      ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #22c55e50, 0 0 25px #22c55e30' } as any : {}),
                    },
                    pressed && canSpawn && { backgroundColor: '#1aab52', transform: [{ scale: 0.98 }] },
                  ]}
                >
                  <Text style={st.spawnBtnText}>
                    {spawning ? 'DEPLOYING...' : `DEPLOY ${activeCount} AGENT${activeCount !== 1 ? 'S' : ''}`}
                  </Text>
                </Pressable>
              </View>
            </>
          )}

          {/* Result */}
          {result && (
            <View style={{ gap: 14 }}>
              <View
                style={[st.resultBanner, result.ok ? st.resultBannerOk : st.resultBannerErr]}
                accessibilityRole={result.ok ? 'summary' : 'alert'}
                accessibilityLiveRegion={result.ok ? 'polite' : 'assertive'}
              >
                <Text style={st.resultBannerIcon}>{result.ok ? '//' : '!!'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={st.resultBannerTitle}>
                    {result.ok ? `${result.spawned} AGENT${result.spawned !== 1 ? 'S' : ''} DEPLOYED` : 'DEPLOYMENT FAILED'}
                  </Text>
                  <Text style={st.resultBannerMsg}>{result.message}</Text>
                </View>
              </View>
              {result.results.length > 0 && (
                <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: 3 }}>
                  {result.results.map((r, i) => (
                    <View key={i} style={st.resultRow}>
                      <View style={[st.resultDot, { backgroundColor: r.ok ? '#fff' : '#666' }]} />
                      <Text style={st.resultTask} numberOfLines={1}>{r.task}</Text>
                      {r.pid && <Text style={st.resultPid}>PID {r.pid}</Text>}
                    </View>
                  ))}
                </ScrollView>
              )}
              <Pressable
                onPress={() => { setResult(null); onClose(); }}
                accessibilityRole="button"
                accessibilityLabel="Close deployment result"
                style={({ hovered, pressed }: any) => [
                  st.spawnBtn, transition,
                  hovered && { backgroundColor: '#e0e0e0', ...(Platform.OS === 'web' ? { boxShadow: '0 0 20px rgba(255,255,255,0.25)' } as any : {}) },
                  pressed && { backgroundColor: '#ccc', transform: [{ scale: 0.98 }] },
                ]}
              >
                <Text style={st.spawnBtnText}>DONE</Text>
              </Pressable>
            </View>
          )}

        </Pressable>
      </Pressable>
    </Modal>
  );
}

const R = 10; // shared border radius — matches chat theme
const st = StyleSheet.create({
  // Blurred glass backdrop matching ComputerUseConsole / AssignAgent /
  // OpenSwanConsole. Very light emerald tint over the chat behind the
  // card, then backdrop-filter blur so the chat reads as blurred glass
  // instead of flat black.
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#22c55e08',
    ...(Platform.OS === 'web' ? ({
      backdropFilter: 'blur(14px) saturate(1.15)',
      WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
    } as any) : {}),
  },
  card: {
    width: '100%', maxWidth: 680,
    borderRadius: 14,
    // Semi-transparent slate so the backdrop blur is visible through
    // the card edges (matches the other consoles' 95% alpha).
    backgroundColor: '#0f172af2',
    borderWidth: 1,
    borderColor: '#22c55e66',
    padding: 22,
    gap: 14,
    ...(Platform.OS === 'web' ? ({
      maxHeight: '92vh',
      overflow: 'auto',
      boxShadow:
        '0 24px 70px rgba(0,0,0,0.55), 0 0 40px rgba(34,197,94,0.18), 0 0 0 1px rgba(255,255,255,0.02) inset',
    } as any) : {}),
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: {
    width: 36, height: 36, borderRadius: R, borderWidth: 1, borderColor: '#22c55e66', backgroundColor: '#22c55e12',
    alignItems: 'center', justifyContent: 'center',
  },
  headerIconText: { color: '#22c55e', fontSize: 14, fontWeight: '900', fontFamily: 'monospace' },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '900', letterSpacing: 2, fontFamily: 'monospace' },
  subtitle: { color: '#22c55eaa', fontSize: 10, fontFamily: 'monospace', marginTop: 1 },
  closeBtn: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 5, borderRadius: R, borderWidth: 1, borderColor: '#1e293b', justifyContent: 'center' },
  closeBtnText: { color: '#64748b', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace' },
  divider: { height: 1, backgroundColor: '#1e293b' },
  errorBox: { padding: 14, borderRadius: R, borderWidth: 1, borderColor: '#ef444440', backgroundColor: '#ef44440a', gap: 6 },
  errorTitle: { color: '#ef4444', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  errorText: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' },
  codeBlock: { backgroundColor: '#111827', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#22c55e25' },
  codeText: { color: '#f59e0b', fontSize: 12, fontFamily: 'monospace' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  loadingText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },
  catalogNotice: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#38bdf840', backgroundColor: '#38bdf80a' },
  catalogNoticeText: { color: '#94a3b8', fontSize: 10, lineHeight: 14, fontFamily: 'monospace' },
  modeRow: { flexDirection: 'row', gap: 8 },
  modeBtn: { flex: 1, padding: 12, borderRadius: R, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a', alignItems: 'center', gap: 3 },
  modeBtnActive: {
    borderColor: '#f59e0b40', backgroundColor: '#f59e0b08',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #f59e0b0c' } as any : {}),
  },
  modeBtnText: { color: '#64748b', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  modeBtnTextActive: { color: '#f59e0b' },
  modeBtnSub: { color: '#475569', fontSize: 9, fontFamily: 'monospace' },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionLabel: { color: '#22c55e70', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  input: {
    color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace',
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: R,
    borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#111827',
    minHeight: 72, textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  specialtySection: { gap: 8 },
  specialtyChipRow: { gap: 7, paddingRight: 8 },
  specialtyChip: {
    minWidth: 188, minHeight: 54, justifyContent: 'center', gap: 3,
    paddingHorizontal: 11, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
    borderColor: '#1e293b', backgroundColor: '#0f172a',
  },
  specialtyChipActive: {
    borderColor: '#a855f7', backgroundColor: '#a855f718',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #a855f720' } as any : {}),
  },
  specialtyChipTitle: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  specialtyChipTitleActive: { color: '#e9d5ff' },
  specialtyChipMeta: { color: '#64748b', fontSize: 8, fontFamily: 'monospace' },
  specialtyChipMetaActive: { color: '#c4b5fd' },
  modelRow: { gap: 8 },
  modelChipRow: { gap: 6, paddingRight: 8 },
  modelChip: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1,
    borderColor: '#1e293b', backgroundColor: '#0f172a',
  },
  modelChipActive: {
    borderColor: '#6366f1', backgroundColor: '#6366f1',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #6366f125' } as any : {}),
  },
  modelChipText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  modelChipTextActive: { color: '#000' },
  countLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  countPills: { flexDirection: 'row', gap: 5, flexWrap: 'wrap', flex: 1 },
  countPill: { minWidth: 44, minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a', alignItems: 'center' },
  countPillActive: {
    borderColor: '#22c55e', backgroundColor: '#22c55e',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #22c55e25' } as any : {}),
  },
  countPillText: { color: '#64748b', fontSize: 13, fontWeight: '900', fontFamily: 'monospace' },
  countPillTextActive: { color: '#000' },
  countInput: {
    width: 48, minHeight: 44, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a',
    color: '#f59e0b', fontSize: 13, fontWeight: '900', fontFamily: 'monospace', textAlign: 'center',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  addBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b30' },
  addBtnText: { color: '#f59e0b', fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  slotList: { gap: 6 },
  slotRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderWidth: 1, borderColor: '#1e293b', borderRadius: R, backgroundColor: '#0f172a', padding: 8,
  },
  slotIndex: {
    width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b30', backgroundColor: '#f59e0b08',
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #f59e0b0c' } as any : {}),
  },
  slotIndexText: { color: '#f59e0b', fontSize: 10, fontWeight: '900', fontFamily: 'monospace' },
  slotBody: { flex: 1, minWidth: 0, gap: 6 },
  slotInput: {
    color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace', paddingVertical: 4, minHeight: 34,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  slotFieldLabel: { color: '#64748b', fontSize: 8, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  slotSpecialties: { gap: 4, paddingRight: 6 },
  slotSpecialtyChip: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 6,
    borderRadius: 7, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#111827',
  },
  slotSpecialtyChipActive: {
    borderColor: '#a855f7', backgroundColor: '#a855f7',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #a855f720' } as any : {}),
  },
  slotSpecialtyText: { color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  slotSpecialtyTextActive: { color: '#000' },
  slotSpecialtyReceipt: { color: '#c4b5fd', fontSize: 8, lineHeight: 12, fontFamily: 'monospace' },
  slotModels: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-start' },
  slotModelChip: {
    minHeight: 44, justifyContent: 'center', paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, borderWidth: 1,
    borderColor: '#1e293b', backgroundColor: '#111827',
  },
  slotModelChipActive: {
    borderColor: '#22c55e', backgroundColor: '#22c55e',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #22c55e18' } as any : {}),
  },
  slotModelChipText: { color: '#94a3b8', fontSize: 9, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  slotModelChipTextActive: { color: '#000' },
  slotRemove: { width: 44, height: 44, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  slotRemoveText: { color: '#64748b', fontSize: 11, fontWeight: '900' },
  estimateRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  estimateLeft: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  estimateLabel: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  estimateValue: { color: '#22c55e', fontSize: 16, fontWeight: '900', fontFamily: 'monospace' },
  estimateSub: { color: '#64748b', fontSize: 10, fontFamily: 'monospace' },
  approvalBadge: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1,
    borderColor: '#f59e0b80', backgroundColor: '#f59e0b14',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #f59e0b20' } as any : {}),
  },
  approvalBadgeText: { color: '#f59e0b', fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  approveRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: R, borderWidth: 1, borderColor: '#f59e0b40', backgroundColor: '#f59e0b08' },
  approveRowActive: {
    borderColor: '#22c55e', backgroundColor: '#22c55e0a',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #22c55e20' } as any : {}),
  },
  approveCheckActive: {
    borderColor: '#22c55e', backgroundColor: '#22c55e',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #22c55e30' } as any : {}),
  },
  approveLabel: { color: '#f59e0b', fontSize: 10, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  approveDesc: { color: '#94a3b8', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  optionRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: R, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a' },
  optionCheck: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  optionCheckActive: {
    borderColor: '#22c55e', backgroundColor: '#22c55e',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #22c55e30' } as any : {}),
  },
  optionCheckMark: { color: '#000', fontSize: 9, fontWeight: '900', fontFamily: 'monospace' },
  optionLabel: { color: '#e2e8f0', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace' },
  optionDesc: { color: '#64748b', fontSize: 10, fontFamily: 'monospace', marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cancelBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: R, borderWidth: 1, borderColor: '#1e293b' },
  cancelBtnText: { color: '#64748b', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, fontFamily: 'monospace' },
  spawnBtn: {
    flex: 1, minHeight: 44, justifyContent: 'center', paddingVertical: 11, borderRadius: R, borderWidth: 1, borderColor: '#22c55e', backgroundColor: '#22c55e', alignItems: 'center',
    ...(Platform.OS === 'web' ? { boxShadow: '3px 3px 0px #22c55e30' } as any : {}),
  },
  spawnBtnText: { color: '#000', fontSize: 12, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  resultBanner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: R, borderWidth: 1 },
  resultBannerOk: {
    borderColor: '#f59e0b40', backgroundColor: '#22c55e08',
    ...(Platform.OS === 'web' ? { boxShadow: '3px 3px 0px #22c55e15' } as any : {}),
  },
  resultBannerErr: {
    borderColor: '#ef444450', backgroundColor: '#ef44440a',
    ...(Platform.OS === 'web' ? { boxShadow: '3px 3px 0px #ef444415' } as any : {}),
  },
  resultBannerIcon: { color: '#f59e0b', fontSize: 18, fontWeight: '900', fontFamily: 'monospace' },
  resultBannerTitle: { color: '#e2e8f0', fontSize: 12, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  resultBannerMsg: { color: '#94a3b8', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  resultRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 6, paddingVertical: 3 },
  resultDot: { width: 6, height: 6, borderRadius: 3 },
  resultTask: { flex: 1, color: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' },
  resultPid: { color: '#475569', fontSize: 10, fontFamily: 'monospace' },
});
