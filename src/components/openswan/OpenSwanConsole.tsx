/**
 * OpenSwanConsole — the OpenSwan Control Panel. Before the user launches
 * a turn, this surface shows exactly what will happen:
 *
 *   1. Task — the free-text prompt the user is sending.
 *   2. Mode — picks the response contract (talk / plan / build / ...).
 *   3. Diagnostics — for the chosen mode, we show how many tools the
 *      model will actually see, how many memories will be loaded, and
 *      whether subagents are likely to spawn. This is the "control"
 *      part — the user can see the system's posture before committing.
 *   4. Maintenance — a single "Prune biasing memories" action that
 *      clears out old memories known to bias refusals (e.g. "agent
 *      lacks app_tools access"). Uses the existing `rageForget` helper
 *      with a dry-run preview so nothing is deleted without confirm.
 *   5. Launch — dispatches task + mode to the caller, which runs it
 *      through the normal planner / tool-use loop.
 *
 * Every section maps to a specific user need or a specific OpenSwan
 * failure mode we've seen in logs. Nothing here is decorative.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  OPENSWAN_MODE_POLICIES,
  SELECTABLE_CHAT_MODES,
  getSelectableChatModes,
  type OpenSwanChatMode,
} from '../../lib/openswanModePolicy';
import {
  listToolsHiddenByMode,
  previewOpenSwanToolsForSurface,
} from '../../lib/openswanToolRuntime';
import { buildOpenSwanTaskPlan } from '../../lib/openswanTaskPlanner';
import {
  planSubagentDelegation,
  shouldDelegateToSubagents,
} from '../../lib/subagentRegistry';
import { analyzeMessageRouting } from '../../lib/messageRouting';
import { rageForget } from '../../lib/memoryActions';
import { supabase } from '../../lib/supabase';
import { useClaudeSpendBreakdown } from '../../lib/circleCostTelemetry';
import { listRuns, type AgentRun } from '../../lib/agentRunSystem';
import { estimateCost, resolveModelRate } from '../../lib/modelPricing';
import QuickActionDock from '../../screens/circles/tabs/chat/QuickActionDock';

// Rough output-budget heuristic per mode. Used by the cost preview to give
// the user a conservative preflight estimate before LAUNCH.
const OUTPUT_TOKEN_BUDGET_BY_MODE: Record<string, number> = {
  talk:     400,
  plan:     1200,
  build:    2400,
  execute:  1800,
  review:   1500,
  research: 1800,
  support:  600,
  design:   1500,
};

// System prompt + memory injection + chat history overhead. Real usage
// varies, but this deliberately leans high so users are less surprised.
const BASE_INPUT_TOKENS = 4500;

// Color rotation for the SPEND BY SOURCE stacked bar. Order is
// stable so the same source gets the same color across renders.
const SPEND_SOURCE_COLORS: ReadonlyArray<string> = [
  '#a78bfa',  // violet — primary
  '#22d3ee',  // cyan
  '#22c55e',  // green
  '#f59e0b',  // amber
  '#ec4899',  // pink
  '#6366f1',  // indigo
  '#ef4444',  // red
  '#94a3b8',  // slate (catch-all)
];

// Starter templates — shown only when the user's saved-template list
// is empty so new users see usable shortcuts without polluting the
// saved list. Tap → applies (task, mode) but doesn't auto-save; the
// user has to opt in via SAVE CURRENT to keep it permanent.
const STARTER_TEMPLATES: ReadonlyArray<{ label: string; task: string; mode: string }> = [
  {
    label: 'Plan today',
    task: 'Plan today\'s work — list active missions, current blockers, and what to ship by end of day.',
    mode: 'plan',
  },
  {
    label: 'Code review',
    task: 'Review the latest uncommitted changes for naming, error handling, missing tests, and obvious bugs.',
    mode: 'review',
  },
  {
    label: 'Ship audit',
    task: 'Audit what\'s left before this branch can ship — uncommitted changes, missing tests, broken builds, gates not passing.',
    mode: 'review',
  },
  {
    label: 'Find tech debt',
    task: 'Scan the codebase for duplicated logic that should be extracted into a shared utility — list candidates with file paths.',
    mode: 'research',
  },
];
const AUTO_MODEL_COST_BASELINE = 'claude-sonnet-4-6';

type ToolSurface = 'main_chat' | 'room_chat' | 'office' | 'task_run';

interface Props {
  visible: boolean;
  /** Accent color override. Defaults to OpenSwan purple. */
  accentColor?: string;
  /** Currently selected OpenSwan mode from ChatTab state. */
  currentMode?: OpenSwanChatMode | string;
  /** Currently selected model. Null / 'auto' → auto-route. */
  currentModel?: string | null;
  /** Prefilled task (e.g. when a user clicks "Open in OpenSwan" on a msg). */
  initialTask?: string;
  /** Circle context — needed for memory preview + prune action. */
  circleId?: string | null;
  /** Current user id — needed for the prune audit trail. */
  userId?: string | null;
  /** Which surface this launch will run on. Tool filter depends on this. */
  surface?: ToolSurface;
  onClose: () => void;
  /** Fires when the user confirms. ChatTab hands the task to the planner. */
  onSubmit: (payload: {
    task: string;
    mode: OpenSwanChatMode;
    model?: string | null;
  }) => void;
}

const SWAN_PURPLE = '#a855f7';
const CARD_BG = '#0f172a';
const CARD_BORDER = '#1e293b';
const FIELD_BG = '#0a0f1c';
const MUTED = '#64748b';
const TEXT = '#e2e8f0';
const TEXT_DIM = '#94a3b8';
const DANGER = '#ef4444';
const SUCCESS = '#22c55e';

// Known phrases that bias BlackSwan toward refusal on UI-control tasks.
// These are pruned as one-click maintenance in the control panel.
const BIASING_MEMORY_PROBES = [
  'lacks app_tools access',
  'cannot control desktop',
  'cannot launch apps',
  'agent cannot interact',
  'lacks permission to modify',
];

// Exclude `none` — the Control Panel is for launching an OpenSwan turn,
// so the "no OpenSwan" option doesn't make sense here. Everything else
// comes from the shared selectable list.
const MODE_KEYS: OpenSwanChatMode[] = SELECTABLE_CHAT_MODES.filter(
  (key) => key !== 'none',
);

export default function OpenSwanConsole({
  visible,
  accentColor = SWAN_PURPLE,
  currentMode,
  currentModel,
  initialTask,
  circleId,
  userId,
  surface = 'main_chat',
  onClose,
  onSubmit,
}: Props) {
  const [task, setTask] = useState(initialTask || '');
  const [mode, setMode] = useState<OpenSwanChatMode>(
    (MODE_KEYS as string[]).includes(String(currentMode || ''))
      ? (currentMode as OpenSwanChatMode)
      : 'plan',
  );
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [memoryPreview, setMemoryPreview] = useState<Array<{ title: string; scope: string }>>([]);
  const [memoryDrawerOpen, setMemoryDrawerOpen] = useState(false);
  const [memoryFull, setMemoryFull] = useState<Array<{
    id: string;
    title: string;
    scope: string;
    content: string;
    updated_at: string;
  }>>([]);
  const [memoryFilter, setMemoryFilter] = useState('');
  const [memoryActioning, setMemoryActioning] = useState<string | null>(null);
  const [stalePreviewCount, setStalePreviewCount] = useState<number | null>(null);
  const [pruneBusy, setPruneBusy] = useState(false);
  const [pruneMessage, setPruneMessage] = useState<string | null>(null);
  const [showHiddenTools, setShowHiddenTools] = useState(false);
  const [budgetCap, setBudgetCap] = useState<number | null>(null);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [recentRunsExpanded, setRecentRunsExpanded] = useState(false);
  const [showAvailableTools, setShowAvailableTools] = useState(false);
  const [toolFilter, setToolFilter] = useState('');
  // Saved (task, mode) templates — power-user shortcuts. Stored in
  // localStorage per (userId, circleId) so they don't bleed across
  // contexts. Schema: { id, label, task, mode, createdAt }.
  type Template = { id: string; label: string; task: string; mode: string; createdAt: number };
  const [templates, setTemplates] = useState<Template[]>([]);

  // Live 24h Claude spend for this circle — the umbrella cap across
  // every agent. Control Panel shows this so the user knows whether a
  // new turn will push them past the ceiling before they launch.
  const spend = useClaudeSpendBreakdown(visible ? circleId || null : null, 24);

  useEffect(() => {
    if (!visible) return;
    setTask(initialTask || '');
    setPruneMessage(null);
    if ((MODE_KEYS as string[]).includes(String(currentMode || ''))) {
      setMode(currentMode as OpenSwanChatMode);
    }
  }, [visible, initialTask, currentMode]);

  // Load saved templates for this user+circle. localStorage is the
  // source of truth — no DB round-trip for the cold path. Templates
  // are tiny (a few hundred bytes each) so synchronous read is fine.
  const templatesKey = useMemo(
    () => userId && circleId ? `uc_openswan_templates_v1_${userId}_${circleId}` : null,
    [userId, circleId],
  );
  useEffect(() => {
    if (!visible || !templatesKey) return;
    try {
      const raw = (typeof window !== 'undefined' && window.localStorage)
        ? window.localStorage.getItem(templatesKey)
        : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Defensive — only keep rows that have the expected shape.
          const valid = parsed.filter((t) =>
            t && typeof t.id === 'string' && typeof t.task === 'string' && typeof t.mode === 'string',
          );
          setTemplates(valid);
          return;
        }
      }
      setTemplates([]);
    } catch {
      setTemplates([]);
    }
  }, [visible, templatesKey]);

  const persistTemplates = useCallback((next: Template[]) => {
    setTemplates(next);
    if (!templatesKey) return;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(templatesKey, JSON.stringify(next));
      }
    } catch {
      // Quota errors are silent — the in-memory list keeps working.
    }
  }, [templatesKey]);

  const saveCurrentAsTemplate = useCallback(() => {
    const trimmed = task.trim();
    if (!trimmed) {
      setPruneMessage('Type a task before saving as template.');
      return;
    }
    // Cap label at 36 chars; user can refine later.
    const label = trimmed.length > 36 ? trimmed.slice(0, 33) + '…' : trimmed;
    const next: Template = {
      id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      task: trimmed,
      mode,
      createdAt: Date.now(),
    };
    // Dedupe — if an existing template has the same task+mode, don't
    // create a duplicate (just bump it to the front).
    const existing = templates.find((t) => t.task === trimmed && t.mode === mode);
    const filtered = existing ? templates.filter((t) => t.id !== existing.id) : templates;
    persistTemplates([next, ...filtered].slice(0, 12));
  }, [task, mode, templates, persistTemplates]);

  const deleteTemplate = useCallback((id: string) => {
    persistTemplates(templates.filter((t) => t.id !== id));
  }, [templates, persistTemplates]);

  const applyTemplate = useCallback((tpl: Template) => {
    setTask(tpl.task);
    if ((MODE_KEYS as string[]).includes(tpl.mode)) {
      setMode(tpl.mode as OpenSwanChatMode);
    }
  }, []);

  // Load the last few runs the user kicked off in this circle. Surfaced
  // as a row of pills under the MODE selector so the user can re-launch
  // a previous task without retyping it. Only loads when the panel is
  // open — keeps the cold-path fast.
  useEffect(() => {
    if (!visible || !circleId || !userId) return;
    let cancelled = false;
    (async () => {
      try {
        const runs = await listRuns(circleId, { userId, limit: 8 });
        if (!cancelled) setRecentRuns(runs);
      } catch {
        if (!cancelled) setRecentRuns([]);
      }
    })();
    return () => { cancelled = true; };
  }, [visible, circleId, userId]);

  // ── Tool + subagent + memory previews (live on mode / task changes) ──

  const toolPreview = useMemo(
    () => previewOpenSwanToolsForSurface(surface as any, mode),
    [surface, mode],
  );

  const hiddenByMode = useMemo(
    () => listToolsHiddenByMode(surface as any, mode),
    [surface, mode],
  );

  // Build the task plan once per (task, surface) and reuse it for
  // both the subagent-delegation preview and the new PLAN PREVIEW
  // section. Avoids analyzing the task twice on every keystroke.
  const taskPlan = useMemo(() => {
    const trimmed = task.trim();
    if (!trimmed) return null;
    try {
      const routingSurface = surface === 'room_chat' ? 'room_chat' : 'main_chat';
      const analysis = analyzeMessageRouting(trimmed, routingSurface);
      const plan = buildOpenSwanTaskPlan(trimmed, analysis.route.profile, analysis.entities);
      return { plan, analysis };
    } catch {
      return null;
    }
  }, [task, surface]);

  const subagentPlan = useMemo(() => {
    const trimmed = task.trim();
    if (!trimmed || !taskPlan) return { willSpawn: false, specs: [] as { role: string; displayName: string }[] };
    try {
      const willSpawn = shouldDelegateToSubagents(trimmed, taskPlan.plan);
      if (!willSpawn) return { willSpawn: false, specs: [] };
      const specs = planSubagentDelegation(trimmed, taskPlan.plan).map((s) => ({
        role: s.subagent.role,
        displayName: s.subagent.displayName,
      }));
      return { willSpawn: specs.length > 0, specs };
    } catch {
      return { willSpawn: false, specs: [] };
    }
  }, [task, taskPlan]);

  const planCostPreview = useMemo(() => {
    if (!taskPlan) return null;
    const isAutoModel = !currentModel || currentModel === 'auto';
    const modelKey = isAutoModel ? AUTO_MODEL_COST_BASELINE : currentModel;
    const inputTokens =
      BASE_INPUT_TOKENS
      + Math.ceil(task.length / 3)
      + (taskPlan.plan.recommendedTools.length * 60)
      + (subagentPlan.specs.length * 1500);
    const outputTokens = OUTPUT_TOKEN_BUDGET_BY_MODE[mode] || 1200;
    const cost = estimateCost(modelKey, inputTokens, outputTokens);
    const rate = resolveModelRate(modelKey);
    // Projected 24h total = what's already spent today + this run's
    // estimate. Better signal than "this run alone vs cap" since
    // multi-run sessions can blow through caps without any single
    // run being expensive.
    const spentToday = spend?.totalCost || 0;
    const projected24h = spentToday + cost;
    return {
      cost,
      inputTokens,
      outputTokens,
      modelLabel: isAutoModel ? `${rate.label} auto baseline` : rate.label,
      overBudget: budgetCap !== null && projected24h > budgetCap,
      spentToday,
      projected24h,
    };
  }, [budgetCap, currentModel, mode, subagentPlan.specs.length, task.length, taskPlan, spend?.totalCost]);

  // Memory count probe — counts active memory_entries for this circle so
  // the user sees how much context the agent will scan. Cheap query, runs
  // on open + whenever circleId changes. Not tied to task text because the
  // actual retrieval is semantic and we'd be lying to show a specific
  // number that would only be true after full retrieval runs.
  const memoryProbeRef = useRef(0);
  useEffect(() => {
    if (!visible || !circleId) {
      setMemoryCount(null);
      setMemoryPreview([]);
      return;
    }
    const token = ++memoryProbeRef.current;
    (async () => {
      try {
        const [countRes, previewRes] = await Promise.all([
          supabase
            .from('memory_entries')
            .select('id', { count: 'exact', head: true })
            .eq('circle_id', circleId)
            .eq('is_active', true),
          // Top 5 most-recently updated active memories in this circle.
          // Gives the user a concrete sense of *what* the agent will
          // see, not just "there are 132 of them".
          supabase
            .from('memory_entries')
            .select('title, scope')
            .eq('circle_id', circleId)
            .eq('is_active', true)
            .order('updated_at', { ascending: false })
            .limit(5),
        ]);
        if (memoryProbeRef.current === token) {
          setMemoryCount(typeof countRes.count === 'number' ? countRes.count : null);
          const rows = (previewRes.data || []) as Array<{ title: string; scope: string }>;
          setMemoryPreview(rows);
        }
      } catch {
        if (memoryProbeRef.current === token) {
          setMemoryCount(null);
          setMemoryPreview([]);
        }
      }
    })();
  }, [visible, circleId]);

  // Memory drawer probe — pulls a richer batch (id, title, scope,
  // content, updated_at) when the drawer is open so the user can
  // search and prune individual entries. Skips when the drawer is
  // closed to keep the panel boot fast.
  const memoryFullProbeRef = useRef(0);
  useEffect(() => {
    if (!visible || !memoryDrawerOpen || !circleId) return;
    const token = ++memoryFullProbeRef.current;
    (async () => {
      try {
        const { data } = await supabase
          .from('memory_entries')
          .select('id, title, scope, content, updated_at')
          .eq('circle_id', circleId)
          .eq('is_active', true)
          .order('updated_at', { ascending: false })
          .limit(40);
        if (memoryFullProbeRef.current !== token) return;
        setMemoryFull((data || []) as any);
      } catch {
        if (memoryFullProbeRef.current !== token) return;
        setMemoryFull([]);
      }
    })();
  }, [visible, memoryDrawerOpen, circleId]);

  // Budget cap probe — read the circle's umbrella 24h Claude cap from
  // circles.settings. Default $10 when unset. Runs once per open.
  const budgetProbeRef = useRef(0);
  useEffect(() => {
    if (!visible || !circleId) {
      setBudgetCap(null);
      return;
    }
    const token = ++budgetProbeRef.current;
    (async () => {
      try {
        const { data } = await supabase
          .from('circles')
          .select('settings')
          .eq('id', circleId)
          .single();
        const cap = (data?.settings as any)?.claude_total_max_cost_usd;
        if (budgetProbeRef.current === token) {
          setBudgetCap(typeof cap === 'number' && cap > 0 ? cap : 10);
        }
      } catch {
        if (budgetProbeRef.current === token) setBudgetCap(10);
      }
    })();
  }, [visible, circleId]);

  // Stale-memory dry-run probe — runs rageForget in dryRun=true for each
  // known biasing phrase so the "Prune" button has a candidate count to
  // show the user before they commit. Dry-run is read-only.
  const staleProbeRef = useRef(0);
  useEffect(() => {
    if (!visible || !circleId || !userId) {
      setStalePreviewCount(null);
      return;
    }
    const token = ++staleProbeRef.current;
    (async () => {
      const ids = new Set<string>();
      for (const probe of BIASING_MEMORY_PROBES) {
        try {
          const r = await rageForget({ circleId, userId, query: probe, dryRun: true });
          r.deactivated.forEach((id) => ids.add(id));
        } catch { /* skip this probe */ }
      }
      if (staleProbeRef.current === token) setStalePreviewCount(ids.size);
    })();
  }, [visible, circleId, userId]);

  const handlePrune = useCallback(async () => {
    if (!circleId || !userId || pruneBusy) return;
    if (!stalePreviewCount) {
      setPruneMessage('No biasing memories found. Nothing to prune.');
      return;
    }
    if (
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.confirm === 'function'
    ) {
      const ok = window.confirm(
        `Prune ${stalePreviewCount} stale memor${stalePreviewCount === 1 ? 'y' : 'ies'} that may be biasing agent refusals? (Soft-delete, recoverable.)`,
      );
      if (!ok) return;
    }
    setPruneBusy(true);
    setPruneMessage(null);
    let total = 0;
    for (const probe of BIASING_MEMORY_PROBES) {
      try {
        const r = await rageForget({ circleId, userId, query: probe });
        total += r.deactivated.length;
      } catch { /* next probe */ }
    }
    setPruneBusy(false);
    setStalePreviewCount(0);
    setPruneMessage(
      total > 0
        ? `Pruned ${total} memor${total === 1 ? 'y' : 'ies'}. Recoverable from the Memory tab.`
        : 'No memories were deactivated.',
    );
  }, [circleId, userId, pruneBusy, stalePreviewCount]);

  const modePolicy = OPENSWAN_MODE_POLICIES[mode];
  const modeAccent = modePolicy?.color || accentColor;
  const trimmed = task.trim();
  const canSubmit = trimmed.length > 0;

  const accentFaded = `${accentColor}22`;
  const accentBorder = `${accentColor}66`;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    onSubmit({ task: trimmed, mode, model: currentModel });
  }, [canSubmit, onSubmit, trimmed, mode, currentModel]);

  const modeDescriptors = useMemo(
    () => getSelectableChatModes().filter((p) => p.key !== 'none'),
    [],
  );

  if (!visible) return null;
  if (Platform.OS !== 'web') return null;

  const toolCount = toolPreview.length;
  const hiddenCount = hiddenByMode.length;

  return (
    <View
      style={styles.anchor}
      pointerEvents="box-none"
      nativeID="section-openswan-console"
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close OpenSwan console"
        style={[styles.backdrop, { backgroundColor: `${accentColor}10` }]}
      />
      <View style={[styles.card, { borderColor: accentBorder }]}>
        {/* ── Header ────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.headerGlyph, { borderColor: accentBorder, backgroundColor: accentFaded }]}>
              <Text style={[styles.headerGlyphText, { color: accentColor }]}>{'OS'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>OpenSwan Control Panel</Text>
              <Text style={styles.headerSub}>
                Inspect the posture — tools, memory, subagents — before launching a turn. Currently:{' '}
                <Text style={{ color: modeAccent }}>
                  {modePolicy?.label?.toUpperCase() || mode.toUpperCase()}
                </Text>.
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>{'×'}</Text>
          </Pressable>
        </View>

        <ScrollView style={{ maxHeight: 580 }} contentContainerStyle={{ gap: 14 }}>
          {/* ── Task textarea ───────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.label}>TASK</Text>
            <TextInput
              value={task}
              onChangeText={setTask}
              placeholder="e.g. Audit the checkout flow — list blockers, prioritise the top 3."
              placeholderTextColor={MUTED}
              multiline
              autoFocus
              style={styles.input}
            />
            <View style={styles.inputFooter}>
              <Text style={styles.inputHint}>
                {trimmed.length === 0
                  ? `${modePolicy?.responseContract?.directive || modePolicy?.outcome || 'OpenSwan response contract will shape the output.'}`
                  : `${trimmed.length} chars · mode "${mode}" contract will apply`}
              </Text>
            </View>
            {/* Quick-action shortcuts — seed the task field with /run,
                /assign, /mission, /remember, /memories, /diag, /search.
                Same pills surfaced in the composer's OpenSwan dropdown,
                also available here so the Control Panel is the single
                place users go for command-palette ergonomics. */}
            <QuickActionDock
              accentColor={accentColor}
              onInsert={(text) => {
                const next = task.trim()
                  ? (task.endsWith(' ') ? task + text : task + ' ' + text)
                  : text;
                setTask(next);
              }}
            />
          </View>

          {/* ── Mode selector ───────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.label}>MODE</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 2 }}>
              {modeDescriptors.map((policy) => {
                const isActive = policy.key === mode;
                const color = policy.color || accentColor;
                return (
                  <Pressable
                    key={policy.key}
                    onPress={() => setMode(policy.key as OpenSwanChatMode)}
                    style={({ hovered }: any) => [
                      styles.modeChip,
                      {
                        borderColor: isActive ? color : CARD_BORDER,
                        backgroundColor: isActive ? `${color}18` : FIELD_BG,
                      },
                      hovered && !isActive && { borderColor: `${color}66`, backgroundColor: `${color}0a` } as any,
                    ]}
                  >
                    <View style={[styles.modeDot, { backgroundColor: color }]} />
                    <Text style={[styles.modeLabel, { color: isActive ? color : TEXT }]}>
                      {policy.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Text style={styles.modeDesc}>
              {modePolicy?.description || 'Pick the response contract that best fits the task.'}
            </Text>
            {modePolicy?.responseContract ? (
              <View style={{ gap: 3, marginTop: 2 }}>
                <Text style={styles.contractLabel}>STRUCTURE</Text>
                {modePolicy.responseContract.structure.slice(0, 3).map((s, i) => (
                  <Text key={i} style={styles.contractLine}>• {s}</Text>
                ))}
              </View>
            ) : null}
          </View>

          {/* ── Templates — saved (task, mode) shortcuts ────────────── */}
          <View style={styles.section}>
            <View style={styles.recentRunsHeader}>
              <Text style={styles.label}>
                TEMPLATES{templates.length > 0 ? ` · ${templates.length}` : ''}
              </Text>
              <Pressable
                onPress={saveCurrentAsTemplate}
                disabled={!task.trim()}
                style={({ hovered, pressed }: any) => [
                  styles.templateSaveBtn,
                  { borderColor: accentColor + '55' },
                  hovered && { backgroundColor: accentColor + '12' },
                  pressed && { transform: [{ scale: 0.985 }] },
                  !task.trim() && { opacity: 0.4 },
                ]}
                accessibilityLabel="Save current task and mode as a template"
              >
                <Text style={[styles.templateSaveText, { color: accentColor }]}>
                  + SAVE CURRENT
                </Text>
              </Pressable>
            </View>
            {templates.length === 0 ? (
              <View style={{ gap: 6 }}>
                <Text style={styles.recentRunsHint}>
                  Try a starter, or type your own and tap SAVE CURRENT.
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
                >
                  {STARTER_TEMPLATES.map((starter) => (
                    <Pressable
                      key={starter.label}
                      onPress={() => {
                        setTask(starter.task);
                        if ((MODE_KEYS as string[]).includes(starter.mode)) {
                          setMode(starter.mode as OpenSwanChatMode);
                        }
                      }}
                      style={({ hovered, pressed }: any) => [
                        styles.templateChip,
                        styles.starterChip,
                        { borderColor: accentColor + '30' },
                        hovered && { borderColor: accentColor + '60', backgroundColor: accentColor + '10' },
                        pressed && { transform: [{ scale: 0.985 }] },
                      ]}
                      accessibilityLabel={`Apply starter: ${starter.label}`}
                    >
                      <View style={styles.templateChipMode}>
                        <Text style={[styles.templateChipModeText, { color: accentColor }]}>
                          {starter.mode.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.templateChipLabel} numberOfLines={1}>
                        {starter.label}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 6, paddingVertical: 2 }}
              >
                {templates.map((tpl) => (
                  <View key={tpl.id} style={styles.templateChipWrap}>
                    <Pressable
                      onPress={() => applyTemplate(tpl)}
                      style={({ hovered, pressed }: any) => [
                        styles.templateChip,
                        { borderColor: accentColor + '40' },
                        hovered && { borderColor: accentColor + '80', backgroundColor: accentColor + '14' },
                        pressed && { transform: [{ scale: 0.985 }] },
                      ]}
                      accessibilityLabel={`Apply template: ${tpl.label}`}
                    >
                      <View style={styles.templateChipMode}>
                        <Text style={[styles.templateChipModeText, { color: accentColor }]}>
                          {tpl.mode.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.templateChipLabel} numberOfLines={1}>
                        {tpl.label}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => deleteTemplate(tpl.id)}
                      style={({ pressed }: any) => [
                        styles.templateChipDelete,
                        pressed && { backgroundColor: '#ef444420' },
                      ]}
                      accessibilityLabel={`Delete template: ${tpl.label}`}
                    >
                      <Text style={styles.templateChipDeleteText}>×</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          {/* ── Recent runs ─────────────────────────────────────────── */}
          {recentRuns.length > 0 ? (
            <View style={styles.section}>
              <Pressable
                onPress={() => setRecentRunsExpanded((v) => !v)}
                style={({ hovered }: any) => [
                  styles.recentRunsHeader,
                  hovered && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={recentRunsExpanded ? 'Hide recent runs' : 'Show recent runs'}
              >
                <Text style={styles.label}>RECENT RUNS · {recentRuns.length}</Text>
                <Text style={styles.recentRunsChevron}>{recentRunsExpanded ? '▾' : '▸'}</Text>
              </Pressable>
              {recentRunsExpanded ? (
                <ScrollView
                  style={{ maxHeight: 180 }}
                  contentContainerStyle={{ gap: 6 }}
                >
                  {recentRuns.map((r) => {
                    const dot =
                      r.status === 'running'          ? '#a78bfa' :
                      r.status === 'planning'         ? '#a78bfa' :
                      r.status === 'completed'        ? '#22c55e' :
                      r.status === 'failed'           ? '#ef4444' :
                      r.status === 'cancelled'        ? '#94a3b8' :
                      r.status === 'paused'           ? '#94a3b8' :
                      r.status === 'waiting_approval' ? '#fbbf24' :
                      '#f59e0b';
                    const elapsedMs =
                      r.completed_at && r.started_at
                        ? new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()
                        : null;
                    const elapsedLabel =
                      elapsedMs === null ? '—' :
                      elapsedMs < 1000 ? `${elapsedMs}ms` :
                      elapsedMs < 60000 ? `${(elapsedMs / 1000).toFixed(1)}s` :
                      `${Math.floor(elapsedMs / 60000)}m${Math.floor((elapsedMs % 60000) / 1000)}s`;
                    return (
                      <Pressable
                        key={r.id}
                        onPress={() => {
                          setTask(r.goal || r.title);
                          if ((MODE_KEYS as string[]).includes(r.mode)) {
                            setMode(r.mode as OpenSwanChatMode);
                          }
                          setRecentRunsExpanded(false);
                        }}
                        style={({ hovered, pressed }: any) => [
                          styles.recentRunRow,
                          hovered && { borderColor: `${accentColor}55`, backgroundColor: `${accentColor}08` },
                          pressed && { transform: [{ scale: 0.99 }] },
                        ]}
                        accessibilityLabel={`Reuse: ${r.title}`}
                      >
                        <View style={[styles.recentRunDot, { backgroundColor: dot }]} />
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={styles.recentRunTitleRow}>
                            <Text style={styles.recentRunMode}>{r.mode}</Text>
                            <Text style={styles.recentRunStatus}>{r.status.toUpperCase()}</Text>
                          </View>
                          <Text style={styles.recentRunTitle} numberOfLines={1}>{r.title || r.goal || '(untitled)'}</Text>
                          <Text style={styles.recentRunMeta}>
                            {elapsedLabel}
                            {r.estimated_cost > 0 ? ` · $${r.estimated_cost.toFixed(3)}` : ''}
                            {r.total_steps > 0 ? ` · ${r.total_steps} step${r.total_steps === 1 ? '' : 's'}` : ''}
                          </Text>
                        </View>
                        <Text style={styles.recentRunArrow}>↺</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
              {!recentRunsExpanded ? (
                <Text style={styles.recentRunsHint}>tap to see recent — re-run any with one tap</Text>
              ) : null}
            </View>
          ) : null}

          {/* ── Plan preview ────────────────────────────────────────── */}
          {taskPlan ? (
            <View style={styles.section}>
              <View style={styles.planPreviewHeader}>
                <Text style={styles.label}>PLAN PREVIEW</Text>
                <View style={[styles.planKindChip, { borderColor: `${accentColor}55`, backgroundColor: `${accentColor}14` }]}>
                  <Text style={[styles.planKindText, { color: accentColor }]}>{taskPlan.plan.kind.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={styles.planSummary} numberOfLines={3}>
                {taskPlan.plan.summary}
              </Text>
              {taskPlan.plan.recommendedTools.length > 0 ? (
                <View style={styles.planToolsBlock}>
                  <Text style={styles.planSubLabel}>RECOMMENDED TOOLS</Text>
                  {taskPlan.plan.recommendedTools.slice(0, 4).map((t) => {
                    const priorityColor =
                      t.priority === 'high'   ? '#22c55e' :
                      t.priority === 'medium' ? '#fbbf24' :
                      '#94a3b8';
                    return (
                      <View key={t.tool} style={styles.planToolRow}>
                        <View style={[styles.planToolDot, { backgroundColor: priorityColor }]} />
                        <Text style={styles.planToolName}>{t.tool}</Text>
                        <Text style={styles.planToolReason} numberOfLines={1}>{t.reason}</Text>
                      </View>
                    );
                  })}
                  {taskPlan.plan.recommendedTools.length > 4 ? (
                    <Text style={styles.planMoreHint}>
                      + {taskPlan.plan.recommendedTools.length - 4} more
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {taskPlan.plan.verification.length > 0 ? (
                <View style={styles.planToolsBlock}>
                  <Text style={styles.planSubLabel}>WILL VERIFY</Text>
                  {taskPlan.plan.verification.slice(0, 3).map((v) => (
                    <View key={v.kind} style={styles.planToolRow}>
                      <Text style={[styles.planToolDot, { backgroundColor: v.required ? '#fbbf24' : '#475569' }]} />
                      <Text style={styles.planToolName}>{v.label}</Text>
                      <Text style={styles.planToolReason} numberOfLines={1}>{v.reason}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {planCostPreview ? (
                <View style={styles.planCostRow}>
                  <Text style={styles.planSubLabel}>EST. COST</Text>
                  <Text
                    style={[
                      styles.planCostValue,
                      planCostPreview.overBudget && { color: '#fca5a5' },
                    ]}
                  >
                    ~${planCostPreview.cost.toFixed(3)}
                  </Text>
                  <Text style={styles.planCostBreakdown} numberOfLines={1}>
                    {(planCostPreview.inputTokens / 1000).toFixed(1)}K in · {(planCostPreview.outputTokens / 1000).toFixed(1)}K out
                    {' · '}
                    {planCostPreview.modelLabel}
                  </Text>
                </View>
              ) : null}
              {/* Budget warning — fires when running this turn would
                  push the 24h projected total past the umbrella cap.
                  More useful than "this run alone exceeds cap" because
                  multi-run sessions can blow through caps without any
                  single run being expensive on its own. */}
              {planCostPreview?.overBudget && budgetCap !== null ? (
                <View style={styles.budgetWarning}>
                  <Text style={styles.budgetWarningKicker}>⚠ OVER 24H CAP</Text>
                  <Text style={styles.budgetWarningBody}>
                    Projected ${planCostPreview.projected24h.toFixed(2)} (already spent ${planCostPreview.spentToday.toFixed(2)} + ${planCostPreview.cost.toFixed(2)} this run) vs ${budgetCap.toFixed(2)} cap.
                  </Text>
                  <Text style={styles.budgetWarningHint}>
                    Raise the cap in Settings or pick a smaller model before launching.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ── Diagnostics ─────────────────────────────────────────── */}
          <View style={styles.section}>
            <Text style={styles.label}>POSTURE</Text>
            <View style={styles.diagGrid}>
              <DiagCard
                title="Tools"
                value={`${toolCount}`}
                hint={
                  hiddenCount > 0
                    ? `${hiddenCount} hidden by mode`
                    : 'all available'
                }
                color={accentColor}
              />
              <Pressable
                onPress={() => setMemoryDrawerOpen((v) => !v)}
                style={({ hovered, pressed }: any) => [
                  { borderRadius: 8 },
                  hovered && { opacity: 0.95 },
                  pressed && { transform: [{ scale: 0.985 }] },
                ]}
                accessibilityLabel={memoryDrawerOpen ? 'Close memory inspector' : 'Open memory inspector'}
              >
                <DiagCard
                  title={`Memory ${memoryDrawerOpen ? '▾' : '▸'}`}
                  value={memoryCount === null ? '—' : `${memoryCount}`}
                  hint="tap to inspect"
                  color="#38bdf8"
                />
              </Pressable>
              <DiagCard
                title="Subagents"
                value={subagentPlan.willSpawn ? `${subagentPlan.specs.length}` : '0'}
                hint={
                  subagentPlan.willSpawn
                    ? subagentPlan.specs.map((s) => s.displayName).slice(0, 3).join(' · ')
                    : 'solo turn'
                }
                color="#f59e0b"
              />
            </View>
            {toolCount === 0 ? (
              <Text style={[styles.inputHint, { color: DANGER, marginTop: 4 }]}>
                ⚠ No tools exposed for this mode. Model will answer from knowledge alone.
              </Text>
            ) : null}

            {/* Available-tools drawer — every tool the agent will have
                access to in this mode, with descriptions. Mirrors the
                hidden-by-mode drawer below so the user can answer
                "what CAN it do?" without leaving the panel. */}
            {toolCount > 0 ? (
              <View style={styles.hiddenDrawer}>
                <Pressable
                  onPress={() => setShowAvailableTools((v) => !v)}
                  style={styles.hiddenHeader}
                  accessibilityLabel={`${showAvailableTools ? 'Hide' : 'Show'} the ${toolCount} tools available in ${mode} mode`}
                >
                  <Text style={[styles.hiddenHeaderText, { color: accentColor }]}>
                    {showAvailableTools ? '▾' : '▸'} {toolCount} TOOL{toolCount === 1 ? '' : 'S'} AVAILABLE IN {mode.toUpperCase()} MODE
                  </Text>
                  <Text style={styles.hiddenHint}>
                    {showAvailableTools ? 'tap to collapse' : 'tap to browse'}
                  </Text>
                </Pressable>
                {showAvailableTools ? (
                  <View style={styles.toolCatalogBody}>
                    <TextInput
                      value={toolFilter}
                      onChangeText={setToolFilter}
                      placeholder="filter — name or what it does"
                      placeholderTextColor={MUTED}
                      style={styles.toolCatalogFilter}
                    />
                    <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ gap: 6 }}>
                      {(() => {
                        const q = toolFilter.trim().toLowerCase();
                        const matched = q
                          ? toolPreview.filter((t) =>
                              t.name.toLowerCase().includes(q)
                              || t.label.toLowerCase().includes(q)
                              || t.description.toLowerCase().includes(q),
                            )
                          : toolPreview;
                        if (matched.length === 0) {
                          return (
                            <Text style={styles.toolCatalogEmpty}>
                              No tools match "{toolFilter}".
                            </Text>
                          );
                        }
                        return matched.map((t) => {
                          // Family color via a tiny key prefix lookup;
                          // matches the conventional "module.action"
                          // naming in the tool registry.
                          const family = t.name.split('.')[0] || 'misc';
                          const familyColor =
                            family === 'browser'   ? '#22d3ee' :
                            family === 'desktop'   ? '#a78bfa' :
                            family === 'workspace' ? '#f59e0b' :
                            family === 'rooms'     ? '#6366f1' :
                            family === 'tasks'     ? '#22c55e' :
                            family === 'memory'    ? '#a855f7' :
                            family === 'github'    ? '#94a3b8' :
                            family === 'mcp'       ? '#ec4899' :
                            '#94a3b8';
                          return (
                            <View key={t.name} style={styles.toolCatalogRow}>
                              <View style={[styles.toolCatalogFamilyDot, { backgroundColor: familyColor }]} />
                              <View style={{ flex: 1, gap: 1 }}>
                                <View style={styles.toolCatalogTitleRow}>
                                  <Text style={styles.toolCatalogLabel}>{t.label}</Text>
                                  <Text style={styles.toolCatalogName}>{t.name}</Text>
                                </View>
                                <Text style={styles.toolCatalogDesc} numberOfLines={2}>
                                  {t.description}
                                </Text>
                              </View>
                            </View>
                          );
                        });
                      })()}
                    </ScrollView>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Hidden-by-mode drawer — only shows if mode actually filters tools */}
            {hiddenCount > 0 ? (
              <View style={styles.hiddenDrawer}>
                <Pressable
                  onPress={() => setShowHiddenTools((v) => !v)}
                  style={styles.hiddenHeader}
                  accessibilityLabel={`${showHiddenTools ? 'Hide' : 'Show'} tools hidden by ${mode} mode`}
                >
                  <Text style={styles.hiddenHeaderText}>
                    {showHiddenTools ? '▾' : '▸'} {hiddenCount} TOOL{hiddenCount === 1 ? '' : 'S'} HIDDEN BY {mode.toUpperCase()} MODE
                  </Text>
                  <Text style={styles.hiddenHint}>
                    {showHiddenTools ? 'tap to collapse' : 'tap to see which'}
                  </Text>
                </Pressable>
                {showHiddenTools ? (
                  <View style={styles.hiddenList}>
                    {hiddenByMode.map((t) => (
                      <Text key={t.name} style={styles.hiddenItem}>
                        • {t.label}{' '}
                        <Text style={styles.hiddenItemCode}>({t.name})</Text>
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Budget strip — live 24h Claude spend vs the umbrella cap.
                Shows before launch so the user can decide whether to
                push past their ceiling or bump it in Settings. */}
            {circleId && budgetCap !== null ? (
              <BudgetStrip spent={spend.totalCost} cap={budgetCap} loading={spend.loading} />
            ) : null}

            {/* Spend rollup by source — see WHERE the 24h budget went.
                Helps users diagnose runaway costs (e.g. "computer-use
                burned 80% of today's spend"). Hidden when there's no
                meaningful spend (< 1¢) so brand-new circles don't
                see a "0%" slice of nothing. */}
            {circleId && spend.totalCost >= 0.01 && spend.rows.length > 0 ? (
              <View style={styles.spendRollup}>
                <View style={styles.spendRollupHeader}>
                  <Text style={styles.spendRollupLabel}>
                    SPEND BY SOURCE · 24H · ${spend.totalCost.toFixed(3)}
                  </Text>
                </View>
                {/* Horizontal stacked bar — one segment per source,
                    width proportional to that source's cost share. */}
                <View style={styles.spendBar}>
                  {spend.rows
                    .slice()
                    .sort((a, b) => b.cost - a.cost)
                    .map((row, idx) => {
                      const pct = (row.cost / spend.totalCost) * 100;
                      if (pct < 0.5) return null; // below visual noise floor
                      return (
                        <View
                          key={row.source}
                          style={{
                            width: `${pct}%`,
                            backgroundColor: SPEND_SOURCE_COLORS[idx % SPEND_SOURCE_COLORS.length],
                          }}
                        />
                      );
                    })}
                </View>
                {/* Top 3 sources with their share. */}
                <View style={{ gap: 3 }}>
                  {spend.rows
                    .slice()
                    .sort((a, b) => b.cost - a.cost)
                    .slice(0, 3)
                    .map((row, idx) => {
                      const pct = (row.cost / spend.totalCost) * 100;
                      return (
                        <View key={row.source} style={styles.spendLegendRow}>
                          <View style={[
                            styles.spendLegendDot,
                            { backgroundColor: SPEND_SOURCE_COLORS[idx % SPEND_SOURCE_COLORS.length] },
                          ]} />
                          <Text style={styles.spendLegendSource} numberOfLines={1}>
                            {row.source}
                          </Text>
                          <Text style={styles.spendLegendCost}>
                            ${row.cost.toFixed(3)} · {pct.toFixed(0)}%
                          </Text>
                        </View>
                      );
                    })}
                </View>
              </View>
            ) : null}

            {/* Memory preview — real titles so the user sees what the agent scans */}
            {!memoryDrawerOpen && memoryPreview.length > 0 ? (
              <View style={styles.memPreview}>
                <Text style={styles.memPreviewLabel}>RECENT MEMORY</Text>
                {memoryPreview.slice(0, 4).map((m, i) => (
                  <Text key={`${m.title}-${i}`} style={styles.memPreviewItem} numberOfLines={1}>
                    <Text style={styles.memScope}>[{m.scope}]</Text> {m.title}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* Memory inspector drawer — fuller list with search + per-row delete. */}
            {memoryDrawerOpen ? (
              <View style={styles.memInspectorBody}>
                <TextInput
                  value={memoryFilter}
                  onChangeText={setMemoryFilter}
                  placeholder="filter — by title, scope, or content"
                  placeholderTextColor={MUTED}
                  style={styles.toolCatalogFilter}
                />
                <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 6 }}>
                  {(() => {
                    const q = memoryFilter.trim().toLowerCase();
                    const filtered = q
                      ? memoryFull.filter((m) =>
                          m.title.toLowerCase().includes(q)
                          || m.scope.toLowerCase().includes(q)
                          || (m.content || '').toLowerCase().includes(q),
                        )
                      : memoryFull;
                    if (memoryFull.length === 0) {
                      return (
                        <Text style={styles.toolCatalogEmpty}>
                          No active memories in this circle yet.
                        </Text>
                      );
                    }
                    if (filtered.length === 0) {
                      return (
                        <Text style={styles.toolCatalogEmpty}>
                          No memories match "{memoryFilter}".
                        </Text>
                      );
                    }
                    return filtered.map((m) => {
                      const updatedTime = m.updated_at ? new Date(m.updated_at).getTime() : 0;
                      const ageMs = Date.now() - updatedTime;
                      const ageLabel =
                        ageMs < 60_000 ? 'just now' :
                        ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m ago` :
                        ageMs < 86_400_000 ? `${Math.floor(ageMs / 3_600_000)}h ago` :
                        `${Math.floor(ageMs / 86_400_000)}d ago`;
                      const isDeleting = memoryActioning === m.id;
                      return (
                        <View key={m.id} style={styles.memInspectorRow}>
                          <View style={styles.memInspectorScopeChip}>
                            <Text style={styles.memInspectorScopeText}>{m.scope || 'unscoped'}</Text>
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <View style={styles.memInspectorTitleRow}>
                              <Text style={styles.memInspectorTitle} numberOfLines={1}>{m.title || '(untitled)'}</Text>
                              <Text style={styles.memInspectorAge}>{ageLabel}</Text>
                            </View>
                            {m.content ? (
                              <Text style={styles.memInspectorContent} numberOfLines={2}>
                                {m.content.slice(0, 240)}
                              </Text>
                            ) : null}
                          </View>
                          <Pressable
                            onPress={async () => {
                              if (isDeleting) return;
                              setMemoryActioning(m.id);
                              try {
                                await supabase
                                  .from('memory_entries')
                                  .update({ is_active: false, updated_at: new Date().toISOString() })
                                  .eq('id', m.id);
                                setMemoryFull((prev) => prev.filter((x) => x.id !== m.id));
                                setMemoryCount((c) => (typeof c === 'number' ? Math.max(0, c - 1) : c));
                              } catch {
                                // No-op — soft-delete is best-effort.
                              } finally {
                                setMemoryActioning(null);
                              }
                            }}
                            style={({ pressed }: any) => [
                              styles.memInspectorDeleteBtn,
                              pressed && { backgroundColor: '#ef444420', borderColor: '#ef4444' },
                              isDeleting && { opacity: 0.5 },
                            ]}
                            accessibilityLabel={`Forget memory: ${m.title}`}
                            disabled={isDeleting}
                          >
                            <Text style={styles.memInspectorDeleteText}>
                              {isDeleting ? '…' : 'forget'}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    });
                  })()}
                </ScrollView>
              </View>
            ) : null}
          </View>

          {/* ── Maintenance ─────────────────────────────────────────── */}
          {circleId && userId ? (
            <View style={styles.section}>
              <Text style={styles.label}>MAINTENANCE</Text>
              <View style={styles.maintRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.maintTitle}>Prune biasing memories</Text>
                  <Text style={styles.maintDesc}>
                    {stalePreviewCount === null
                      ? 'Scanning for memories that bias refusals on UI-control tasks…'
                      : stalePreviewCount === 0
                        ? 'No biasing memories detected.'
                        : `${stalePreviewCount} memor${stalePreviewCount === 1 ? 'y' : 'ies'} matching "lacks app_tools", "cannot control desktop", etc.`}
                  </Text>
                  {pruneMessage ? (
                    <Text
                      style={[
                        styles.maintDesc,
                        { color: pruneMessage.startsWith('Pruned') ? SUCCESS : TEXT_DIM, marginTop: 4 },
                      ]}
                    >
                      {pruneMessage}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={handlePrune}
                  disabled={pruneBusy || !stalePreviewCount}
                  style={[
                    styles.pruneBtn,
                    {
                      borderColor:
                        stalePreviewCount && !pruneBusy ? `${DANGER}88` : CARD_BORDER,
                      backgroundColor:
                        stalePreviewCount && !pruneBusy ? `${DANGER}15` : FIELD_BG,
                      opacity: stalePreviewCount && !pruneBusy ? 1 : 0.55,
                    },
                  ]}
                >
                  {pruneBusy ? (
                    <ActivityIndicator size="small" color={DANGER} />
                  ) : (
                    <Text
                      style={[
                        styles.pruneBtnText,
                        { color: stalePreviewCount ? DANGER : MUTED },
                      ]}
                    >
                      PRUNE
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* ── Model inherited ─────────────────────────────────────── */}
          {currentModel ? (
            <View style={styles.inlineRow}>
              <Text style={styles.modelInherit}>
                MODEL · {String(currentModel).toUpperCase()}
              </Text>
              <Text style={[styles.inputHint, { color: MUTED }]}>
                Inherited from chat model picker
              </Text>
            </View>
          ) : null}
        </ScrollView>

        {/* ── Footer ──────────────────────────────────────────────── */}
        <View style={styles.footer}>
          <Pressable onPress={onClose} style={styles.ghostBtn}>
            <Text style={styles.ghostBtnText}>CANCEL</Text>
          </Pressable>
          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[
              styles.primaryBtn,
              { backgroundColor: canSubmit ? modeAccent : '#1e293b' },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Launch OpenSwan turn"
          >
            <Text
              style={[
                styles.primaryBtnText,
                { color: canSubmit ? '#020617' : MUTED },
              ]}
            >
              LAUNCH {modePolicy?.label?.toUpperCase() || mode.toUpperCase()}  ›
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ── Budget strip ─────────────────────────────────────────────────────────
// Compact horizontal bar: "SPEND · $0.42 / $10.00 (4%)" with a colored
// fill bar. Colors shift from green → amber → red as spend climbs.
function BudgetStrip({
  spent,
  cap,
  loading,
}: {
  spent: number;
  cap: number;
  loading: boolean;
}) {
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  // Green ≤60%, amber 60-85%, red >85%. Gives a predictable visual
  // signal that matches a three-stage "safe/warn/stop" mental model.
  const barColor = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
  return (
    <View style={styles.budgetStrip}>
      <View style={styles.budgetStripHeader}>
        <Text style={styles.budgetStripLabel}>SPEND · 24H</Text>
        <Text style={[styles.budgetStripValue, { color: barColor }]}>
          {loading ? '…' : `$${spent.toFixed(2)} / $${cap.toFixed(2)}`}
          <Text style={styles.budgetStripPct}> ({Math.round(pct)}%)</Text>
        </Text>
      </View>
      <View style={styles.budgetBarTrack}>
        <View
          style={[
            styles.budgetBarFill,
            { width: `${pct}%` as any, backgroundColor: barColor },
          ]}
        />
      </View>
      {pct > 85 ? (
        <Text style={[styles.inputHint, { color: '#ef4444', marginTop: 3 }]}>
          ⚠ Over 85% of umbrella cap. Next turn may be blocked.
        </Text>
      ) : null}
    </View>
  );
}

// ── Small helper card for the diagnostics grid ──────────────────────────
function DiagCard({
  title,
  value,
  hint,
  color,
}: {
  title: string;
  value: string;
  hint: string;
  color: string;
}) {
  return (
    <View style={[styles.diagCard, { borderColor: `${color}33` }]}>
      <Text style={[styles.diagTitle, { color }]}>{title.toUpperCase()}</Text>
      <Text style={styles.diagValue}>{value}</Text>
      <Text style={styles.diagHint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    ...(Platform.OS === 'web' ? { position: 'fixed' as any } : StyleSheet.absoluteFillObject),
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 1200,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  backdrop: {
    ...(Platform.OS === 'web' ? { position: 'fixed' as any } : StyleSheet.absoluteFillObject),
    top: 0, left: 0, right: 0, bottom: 0,
    ...(Platform.OS === 'web' ? ({
      backdropFilter: 'blur(14px) saturate(1.15)',
      WebkitBackdropFilter: 'blur(14px) saturate(1.15)',
    } as any) : {}),
  },
  card: {
    backgroundColor: `${CARD_BG}f2`,
    borderWidth: 1,
    borderRadius: 14,
    width: '100%' as any,
    maxWidth: 680,
    maxHeight: '92vh' as any,
    padding: 18,
    gap: 14,
    ...(Platform.OS === 'web' ? ({
      boxShadow:
        '0 24px 70px rgba(0,0,0,0.55), 0 0 40px rgba(168,85,247,0.18), 0 0 0 1px rgba(255,255,255,0.02) inset',
    } as any) : {}),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
  },
  headerGlyph: {
    width: 38,
    height: 38,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerGlyphText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  headerTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  headerSub: {
    color: TEXT_DIM,
    fontSize: 12,
    marginTop: 2,
    maxWidth: 520,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: TEXT_DIM, fontSize: 18, fontWeight: '600' },
  section: { gap: 6 },
  recentRunsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentRunsChevron: {
    color: MUTED,
    fontSize: 11,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  recentRunsHint: {
    color: MUTED,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  templateSaveBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  templateSaveText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  templateChipWrap: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: FIELD_BG,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
  },
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRightWidth: 1,
    borderRightColor: CARD_BORDER,
    maxWidth: 280,
  },
  templateChipMode: {
    backgroundColor: '#020617',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  templateChipModeText: {
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  templateChipLabel: {
    color: TEXT,
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  templateChipDelete: {
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  templateChipDeleteText: {
    color: MUTED,
    fontSize: 14,
    fontWeight: '900',
    lineHeight: 14,
  },
  starterChip: {
    backgroundColor: FIELD_BG,
    borderRadius: 8,
    borderWidth: 1,
    borderRightWidth: 1,
    borderStyle: 'dashed',
  },
  spendRollup: {
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  spendRollupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spendRollupLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  spendBar: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#020617',
    borderWidth: 1,
    borderColor: CARD_BORDER,
  },
  spendLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spendLegendDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  spendLegendSource: {
    color: TEXT_DIM,
    fontSize: 10.5,
    flex: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  spendLegendCost: {
    color: MUTED,
    fontSize: 10,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  recentRunRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 8,
  },
  recentRunDot: { width: 8, height: 8, borderRadius: 999 },
  recentRunTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recentRunMode: {
    color: TEXT_DIM,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
    textTransform: 'uppercase',
  },
  recentRunStatus: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  recentRunTitle: { color: TEXT, fontSize: 12, fontWeight: '600' },
  recentRunMeta: {
    color: MUTED,
    fontSize: 10,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  recentRunArrow: {
    color: TEXT_DIM,
    fontSize: 14,
    fontWeight: '900',
    paddingHorizontal: 4,
  },
  planPreviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planKindChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  planKindText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  planSummary: {
    color: TEXT,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  planToolsBlock: { gap: 4, marginTop: 4 },
  planSubLabel: {
    color: MUTED,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  planToolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 1,
  },
  planToolDot: { width: 6, height: 6, borderRadius: 999 },
  planToolName: {
    color: TEXT_DIM,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
    minWidth: 90,
  },
  planToolReason: {
    color: MUTED,
    fontSize: 11,
    flex: 1,
  },
  planMoreHint: {
    color: MUTED,
    fontSize: 10,
    fontStyle: 'italic',
    marginTop: 2,
  },
  planCostRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  planCostValue: {
    color: SUCCESS,
    fontSize: 13,
    fontWeight: '900',
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
    minWidth: 70,
  },
  planCostBreakdown: {
    color: MUTED,
    fontSize: 10,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
    flex: 1,
  },
  budgetWarning: {
    marginTop: 4,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ef444455',
    backgroundColor: '#7f1d1d18',
    gap: 3,
  },
  budgetWarningKicker: {
    color: '#fca5a5',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  budgetWarningBody: {
    color: '#fecaca',
    fontSize: 11,
    lineHeight: 16,
  },
  budgetWarningHint: {
    color: '#f87171',
    fontSize: 10,
    fontStyle: 'italic',
  },
  toolCatalogBody: {
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  toolCatalogFilter: {
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: TEXT,
    fontSize: 11,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  toolCatalogRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 6,
  },
  toolCatalogFamilyDot: { width: 6, height: 6, borderRadius: 999, marginTop: 6 },
  toolCatalogTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  toolCatalogLabel: { color: TEXT, fontSize: 11, fontWeight: '700' },
  toolCatalogName: {
    color: MUTED,
    fontSize: 9,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  toolCatalogDesc: { color: TEXT_DIM, fontSize: 10.5, lineHeight: 14 },
  toolCatalogEmpty: {
    color: MUTED,
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 10,
  },
  memInspectorBody: {
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: CARD_BORDER,
  },
  memInspectorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 6,
  },
  memInspectorScopeChip: {
    backgroundColor: '#0c4a6e',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    minWidth: 50,
    alignItems: 'center',
  },
  memInspectorScopeText: {
    color: '#7dd3fc',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  memInspectorTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 6,
  },
  memInspectorTitle: { color: TEXT, fontSize: 11, fontWeight: '700', flex: 1 },
  memInspectorAge: {
    color: MUTED,
    fontSize: 9,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  memInspectorContent: { color: TEXT_DIM, fontSize: 10.5, lineHeight: 14 },
  memInspectorDeleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    alignSelf: 'center',
  },
  memInspectorDeleteText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
    fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string,
  },
  label: {
    color: TEXT_DIM,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1.5,
  },
  input: {
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 10,
    padding: 12,
    color: TEXT,
    fontSize: 13,
    minHeight: 84,
    maxHeight: 180,
    fontFamily: Platform.OS === 'web' ? 'inherit' : 'System',
  },
  inputFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  inputHint: { color: MUTED, fontSize: 11 },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  modeDot: { width: 6, height: 6, borderRadius: 999 },
  modeLabel: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  modeDesc: {
    color: TEXT_DIM,
    fontSize: 11,
    marginTop: 2,
  },
  contractLabel: {
    color: MUTED,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.2,
    marginTop: 2,
  },
  contractLine: {
    color: TEXT_DIM,
    fontSize: 11,
  },
  diagGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  diagCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    backgroundColor: FIELD_BG,
    minWidth: 110,
  },
  diagTitle: {
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  diagValue: {
    color: TEXT,
    fontSize: 22,
    fontWeight: '700',
    marginTop: 2,
  },
  diagHint: {
    color: TEXT_DIM,
    fontSize: 10,
    marginTop: 2,
  },
  maintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
  },
  maintTitle: {
    color: TEXT,
    fontSize: 12,
    fontWeight: '700',
  },
  maintDesc: {
    color: TEXT_DIM,
    fontSize: 11,
    marginTop: 2,
  },
  pruneBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 68,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pruneBtnText: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  hiddenDrawer: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 8,
    overflow: 'hidden',
  },
  hiddenHeader: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: FIELD_BG,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  hiddenHeaderText: {
    color: TEXT_DIM,
    fontFamily: 'monospace',
    fontSize: 10,
    letterSpacing: 1.1,
    fontWeight: '700',
  },
  hiddenHint: {
    color: MUTED,
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  hiddenList: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 3,
    backgroundColor: '#060a14',
  },
  hiddenItem: {
    color: TEXT_DIM,
    fontSize: 11,
  },
  hiddenItemCode: {
    color: MUTED,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  memPreview: {
    marginTop: 6,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
    gap: 3,
  },
  memPreviewLabel: {
    color: MUTED,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  memPreviewItem: {
    color: TEXT_DIM,
    fontSize: 11,
  },
  memScope: {
    color: '#38bdf8',
    fontFamily: 'monospace',
    fontSize: 10,
  },
  budgetStrip: {
    marginTop: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
    gap: 5,
  },
  budgetStripHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  budgetStripLabel: {
    color: MUTED,
    fontFamily: 'monospace',
    fontSize: 9,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  budgetStripValue: {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700',
  },
  budgetStripPct: {
    color: TEXT_DIM,
    fontWeight: '600',
  },
  budgetBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1a202c',
    overflow: 'hidden',
  },
  budgetBarFill: {
    height: 4,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  modelInherit: {
    color: TEXT,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  ghostBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: FIELD_BG,
  },
  ghostBtnText: {
    color: TEXT_DIM,
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  primaryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryBtnText: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: '700',
  },
});
