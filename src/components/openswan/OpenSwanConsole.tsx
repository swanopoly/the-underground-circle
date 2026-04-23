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
  const [stalePreviewCount, setStalePreviewCount] = useState<number | null>(null);
  const [pruneBusy, setPruneBusy] = useState(false);
  const [pruneMessage, setPruneMessage] = useState<string | null>(null);
  const [showHiddenTools, setShowHiddenTools] = useState(false);
  const [budgetCap, setBudgetCap] = useState<number | null>(null);

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

  // ── Tool + subagent + memory previews (live on mode / task changes) ──

  const toolPreview = useMemo(
    () => previewOpenSwanToolsForSurface(surface as any, mode),
    [surface, mode],
  );

  const hiddenByMode = useMemo(
    () => listToolsHiddenByMode(surface as any, mode),
    [surface, mode],
  );

  const subagentPlan = useMemo(() => {
    const trimmed = task.trim();
    if (!trimmed) return { willSpawn: false, specs: [] as { role: string; displayName: string }[] };
    try {
      const routingSurface = surface === 'room_chat' ? 'room_chat' : 'main_chat';
      const analysis = analyzeMessageRouting(trimmed, routingSurface);
      const plan = buildOpenSwanTaskPlan(trimmed, analysis.route.profile, analysis.entities);
      const willSpawn = shouldDelegateToSubagents(trimmed, plan);
      if (!willSpawn) return { willSpawn: false, specs: [] };
      const specs = planSubagentDelegation(trimmed, plan).map((s) => ({
        role: s.subagent.role,
        displayName: s.subagent.displayName,
      }));
      return { willSpawn: specs.length > 0, specs };
    } catch {
      return { willSpawn: false, specs: [] };
    }
  }, [task, surface]);

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
          .eq('circle_id', circleId)
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
              <DiagCard
                title="Memory"
                value={memoryCount === null ? '—' : `${memoryCount}`}
                hint="active entries in circle"
                color="#38bdf8"
              />
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

            {/* Memory preview — real titles so the user sees what the agent scans */}
            {memoryPreview.length > 0 ? (
              <View style={styles.memPreview}>
                <Text style={styles.memPreviewLabel}>RECENT MEMORY</Text>
                {memoryPreview.slice(0, 4).map((m, i) => (
                  <Text key={`${m.title}-${i}`} style={styles.memPreviewItem} numberOfLines={1}>
                    <Text style={styles.memScope}>[{m.scope}]</Text> {m.title}
                  </Text>
                ))}
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
