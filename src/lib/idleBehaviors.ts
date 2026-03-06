// ─── Idle Agent Behaviors ────────────────────────────────────────────────────
// Background tasks that agents perform while idle. Toggleable per-behavior,
// with 3 tiers: Tier 1 (pure Supabase, auto-on), Tier 2 (AI via automation-executor),
// Tier 3 (owner-only, uses Claude Code bridge or AI analysis).

import { supabase } from './supabase';
import { storage } from './storage';
import { updateAgentStatus } from './circleOffice';
import { execBridgeCommand, detectClaudeCodeBridge } from './claudeCodeDetector';
import { logActivity } from '../services/agentActivityLogger';
import { getMemoryDoc, updateMemoryDoc } from '../services/sharedMemory';

// ─── Types ────────────────────────────────────────────────────────────────────

export const STORAGE_KEY_IDLE = '@agent_idle_config';

export type BehaviorTier = 1 | 2 | 3;
export type BehaviorCategory = 'engagement' | 'productivity' | 'intelligence' | 'codebase' | 'analytics';

export interface IdleBehaviorDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  tier: BehaviorTier;
  category: BehaviorCategory;
  defaultCooldownMinutes: number;
  floatingText: string;
  taskLabel: string;
  ownerOnly: boolean;
  requiresBridge: boolean;
  requiresClaude: boolean;
}

export interface BehaviorState {
  enabled: boolean;
  cooldownMinutes: number;
  lastRanAt: string | null;
}

export interface IdleBehaviorConfig {
  masterEnabled: boolean;
  behaviors: Record<string, BehaviorState>;
}

export interface BehaviorResult {
  success: boolean;
  summary?: string;
  detail?: string;
  error?: string;
}

// ─── Behavior Catalog ─────────────────────────────────────────────────────────

export const IDLE_BEHAVIORS: IdleBehaviorDef[] = [
  // Tier 1 — Fully Automated (pure Supabase, no AI cost)
  {
    id: 'streak_guardian',
    name: 'Streak Guardian',
    description: 'Checks who hasn\'t checked in today and posts a nudge to chat',
    icon: '\uD83D\uDD25',
    tier: 1,
    category: 'engagement',
    defaultCooldownMinutes: 240,
    floatingText: 'CHECKING...',
    taskLabel: 'Checking streaks...',
    ownerOnly: false,
    requiresBridge: false,
    requiresClaude: false,
  },
  {
    id: 'stale_task_detector',
    name: 'Stale Task Detector',
    description: 'Finds tasks stuck in-progress for 3+ days',
    icon: '\u23F0',
    tier: 1,
    category: 'productivity',
    defaultCooldownMinutes: 360,
    floatingText: 'REVIEWING...',
    taskLabel: 'Scanning tasks...',
    ownerOnly: false,
    requiresBridge: false,
    requiresClaude: false,
  },
  {
    id: 'circle_pulse_monitor',
    name: 'Circle Pulse',
    description: 'Posts an engagement nudge if no activity in 24 hours',
    icon: '\uD83D\uDC93',
    tier: 1,
    category: 'engagement',
    defaultCooldownMinutes: 480,
    floatingText: 'MONITORING...',
    taskLabel: 'Checking circle pulse...',
    ownerOnly: false,
    requiresBridge: false,
    requiresClaude: false,
  },
  {
    id: 'knowledge_curator',
    name: 'Knowledge Curator',
    description: 'Prunes low-quality knowledge entries and rescores the rest',
    icon: '\uD83D\uDCDA',
    tier: 1,
    category: 'intelligence',
    defaultCooldownMinutes: 720,
    floatingText: 'CURATING...',
    taskLabel: 'Curating knowledge base...',
    ownerOnly: false,
    requiresBridge: false,
    requiresClaude: false,
  },
  {
    id: 'memory_digest',
    name: 'Memory Digest',
    description: 'Summarizes yesterday\'s check-ins and tasks into shared memory',
    icon: '\uD83E\uDDE0',
    tier: 1,
    category: 'intelligence',
    defaultCooldownMinutes: 1440,
    floatingText: 'DIGESTING...',
    taskLabel: 'Generating memory digest...',
    ownerOnly: false,
    requiresBridge: false,
    requiresClaude: false,
  },

  // Tier 2 — AI-Powered (calls automation-executor with Claude)
  {
    id: 'morning_briefing',
    name: 'Morning Briefing',
    description: 'Daily briefing: goals, XP standings, tasks due, circle activity',
    icon: '\uD83C\uDF05',
    tier: 2,
    category: 'productivity',
    defaultCooldownMinutes: 1440,
    floatingText: 'BRIEFING...',
    taskLabel: 'Preparing morning briefing...',
    ownerOnly: false,
    requiresBridge: false,
    requiresClaude: true,
  },
  {
    id: 'weekly_retro',
    name: 'Weekly Retro',
    description: 'Auto-generates a weekly retrospective posted to chat',
    icon: '\uD83D\uDCCA',
    tier: 2,
    category: 'productivity',
    defaultCooldownMinutes: 10080,
    floatingText: 'REFLECTING...',
    taskLabel: 'Generating weekly retro...',
    ownerOnly: false,
    requiresBridge: false,
    requiresClaude: true,
  },
  {
    id: 'goal_pace_tracker',
    name: 'Goal Pace Tracker',
    description: 'Predicts goal completion pace and warns about at-risk milestones',
    icon: '\uD83C\uDFAF',
    tier: 2,
    category: 'productivity',
    defaultCooldownMinutes: 720,
    floatingText: 'ANALYZING...',
    taskLabel: 'Analyzing goal pace...',
    ownerOnly: false,
    requiresBridge: false,
    requiresClaude: true,
  },

  // Tier 3 — Owner-Only
  {
    id: 'codebase_scanner',
    name: 'Codebase Scanner',
    description: 'Scans for TODOs, FIXMEs, and deprecated patterns via Claude Code',
    icon: '\uD83D\uDD0D',
    tier: 3,
    category: 'codebase',
    defaultCooldownMinutes: 360,
    floatingText: 'SCANNING...',
    taskLabel: 'Scanning codebase...',
    ownerOnly: true,
    requiresBridge: true,
    requiresClaude: false,
  },
  {
    id: 'dependency_health',
    name: 'Dependency Health',
    description: 'Checks for outdated npm packages and security issues',
    icon: '\uD83D\uDCE6',
    tier: 3,
    category: 'codebase',
    defaultCooldownMinutes: 1440,
    floatingText: 'AUDITING...',
    taskLabel: 'Checking dependencies...',
    ownerOnly: true,
    requiresBridge: true,
    requiresClaude: false,
  },
  {
    id: 'cost_efficiency_report',
    name: 'Cost Efficiency',
    description: 'Analyzes which models give best XP per dollar spent',
    icon: '\uD83D\uDCA1',
    tier: 3,
    category: 'analytics',
    defaultCooldownMinutes: 720,
    floatingText: 'OPTIMIZING...',
    taskLabel: 'Analyzing cost efficiency...',
    ownerOnly: true,
    requiresBridge: false,
    requiresClaude: true,
  },
];

// ─── Config Storage ───────────────────────────────────────────────────────────

export function getDefaultBehaviorState(def: IdleBehaviorDef): BehaviorState {
  return {
    enabled: def.tier === 1, // Tier 1 on by default
    cooldownMinutes: def.defaultCooldownMinutes,
    lastRanAt: null,
  };
}

export function getDefaultIdleConfig(): IdleBehaviorConfig {
  const behaviors: Record<string, BehaviorState> = {};
  for (const def of IDLE_BEHAVIORS) {
    behaviors[def.id] = getDefaultBehaviorState(def);
  }
  return { masterEnabled: true, behaviors };
}

export async function loadIdleConfig(): Promise<IdleBehaviorConfig> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_IDLE);
    if (!raw) return getDefaultIdleConfig();
    const parsed = JSON.parse(raw) as IdleBehaviorConfig;
    // Forward-merge: add any new behaviors not in stored config
    const defaults = getDefaultIdleConfig();
    for (const id of Object.keys(defaults.behaviors)) {
      if (!parsed.behaviors[id]) parsed.behaviors[id] = defaults.behaviors[id];
    }
    return parsed;
  } catch {
    return getDefaultIdleConfig();
  }
}

export async function saveIdleConfig(config: IdleBehaviorConfig): Promise<void> {
  try {
    await storage.setItem(STORAGE_KEY_IDLE, JSON.stringify(config));
  } catch {
    console.error('[idleBehaviors] Failed to save config');
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

interface SchedulerContext {
  circleId: string;
  userId: string;
  isOwner: boolean;
  intervalId: ReturnType<typeof setInterval>;
}

const activeSchedulers = new Map<string, SchedulerContext>();

export function startIdleScheduler(
  circleId: string,
  userId: string,
  isOwner: boolean,
  getConfig: () => IdleBehaviorConfig,
  onConfigUpdate: (config: IdleBehaviorConfig) => void,
): void {
  if (activeSchedulers.has(circleId)) return;

  const intervalId = setInterval(
    () => tickScheduler(circleId, userId, isOwner, getConfig, onConfigUpdate),
    60_000,
  );
  activeSchedulers.set(circleId, { circleId, userId, isOwner, intervalId });

  // Run first tick after a short delay (let the app settle)
  setTimeout(() => tickScheduler(circleId, userId, isOwner, getConfig, onConfigUpdate), 5_000);
}

export function stopIdleScheduler(circleId: string): void {
  const s = activeSchedulers.get(circleId);
  if (!s) return;
  clearInterval(s.intervalId);
  activeSchedulers.delete(circleId);
}

function isBehaviorDue(state: BehaviorState): boolean {
  if (!state.lastRanAt) return true;
  const elapsed = Date.now() - new Date(state.lastRanAt).getTime();
  return elapsed >= state.cooldownMinutes * 60 * 1000;
}

async function tickScheduler(
  circleId: string,
  userId: string,
  isOwner: boolean,
  getConfig: () => IdleBehaviorConfig,
  onConfigUpdate: (config: IdleBehaviorConfig) => void,
): Promise<void> {
  const config = getConfig();
  if (!config.masterEnabled) return;

  for (const def of IDLE_BEHAVIORS) {
    if (def.ownerOnly && !isOwner) continue;
    const state = config.behaviors[def.id];
    if (!state || !state.enabled) continue;
    if (!isBehaviorDue(state)) continue;

    // Check bridge availability for tier 3 bridge behaviors
    if (def.requiresBridge) {
      const bridgeAlive = await detectClaudeCodeBridge();
      if (!bridgeAlive) continue;
    }

    // Run one behavior per tick to avoid status thrashing
    await runBehavior(def, circleId, userId, config, onConfigUpdate);
    return;
  }
}

// ─── Behavior Execution ───────────────────────────────────────────────────────

async function runBehavior(
  def: IdleBehaviorDef,
  circleId: string,
  userId: string,
  config: IdleBehaviorConfig,
  onConfigUpdate: (config: IdleBehaviorConfig) => void,
): Promise<void> {
  console.log(`[idleBehaviors] Running ${def.id} for circle ${circleId}`);

  // 1. Mark agent as building
  await updateAgentStatus(circleId, 'building' as any, {
    currentTask: def.taskLabel,
    currentGoal: `Idle: ${def.name}`,
  });

  // 2. Log activity start
  await logActivity({
    circle_id: circleId,
    agent_name: 'BlackSwan',
    source: 'system',
    source_detail: `idle:${def.id}`,
    activity_type: 'task_started',
    title: `${def.icon} ${def.name}`,
    body: def.description,
    status: 'running',
    metadata: { behavior_id: def.id, tier: def.tier },
  });

  let result: BehaviorResult = { success: false, error: 'Unknown error' };

  try {
    result = await executeBehavior(def, circleId, userId);
  } catch (e: any) {
    result = { success: false, error: e.message || String(e) };
  }

  // 3. Log completion
  await logActivity({
    circle_id: circleId,
    agent_name: 'BlackSwan',
    source: 'system',
    source_detail: `idle:${def.id}`,
    activity_type: result.success ? 'task_completed' : 'task_failed',
    title: `${def.icon} ${def.name}`,
    body: result.summary || result.error || '',
    status: result.success ? 'completed' : 'failed',
    metadata: { behavior_id: def.id, tier: def.tier, detail: result.detail },
  });

  // 4. Restore idle status
  await updateAgentStatus(circleId, 'idle' as any, {});

  // 5. Persist lastRanAt
  const updated: IdleBehaviorConfig = {
    ...config,
    behaviors: {
      ...config.behaviors,
      [def.id]: {
        ...config.behaviors[def.id],
        lastRanAt: new Date().toISOString(),
      },
    },
  };
  onConfigUpdate(updated);
  await saveIdleConfig(updated);
}

// ─── Behavior Dispatcher ──────────────────────────────────────────────────────

async function executeBehavior(
  def: IdleBehaviorDef,
  circleId: string,
  userId: string,
): Promise<BehaviorResult> {
  switch (def.id) {
    case 'streak_guardian':       return execStreakGuardian(circleId);
    case 'stale_task_detector':   return execStaleTaskDetector(circleId);
    case 'circle_pulse_monitor':  return execCirclePulseMonitor(circleId);
    case 'knowledge_curator':     return execKnowledgeCurator(circleId);
    case 'memory_digest':         return execMemoryDigest(circleId, userId);
    case 'morning_briefing':      return execViaAutomation(def, circleId);
    case 'weekly_retro':          return execViaAutomation(def, circleId);
    case 'goal_pace_tracker':     return execViaAutomation(def, circleId);
    case 'codebase_scanner':      return execCodebaseScanner(circleId);
    case 'dependency_health':     return execDependencyHealth(circleId);
    case 'cost_efficiency_report': return execCostEfficiency(circleId);
    default:
      return { success: false, error: `Unknown behavior: ${def.id}` };
  }
}

// ─── Tier 1 Implementations ──────────────────────────────────────────────────

async function execStreakGuardian(circleId: string): Promise<BehaviorResult> {
  const today = new Date().toISOString().split('T')[0];

  const { data: members } = await supabase
    .from('circle_members')
    .select('user_id, profiles(id, display_name, username, current_streak)')
    .eq('circle_id', circleId);

  if (!members || members.length === 0) {
    return { success: true, summary: 'No members to check' };
  }

  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('user_id')
    .eq('circle_id', circleId)
    .gte('created_at', today);

  const checkedInIds = new Set((checkIns || []).map((c: any) => c.user_id));
  const notCheckedIn = (members as any[])
    .filter(m => m.profiles && !checkedInIds.has(m.user_id))
    .map(m => m.profiles);

  if (notCheckedIn.length === 0) {
    return { success: true, summary: 'Everyone checked in today' };
  }

  const names = notCheckedIn.map((u: any) => u.display_name || u.username || 'Unknown').join(', ');
  const atRisk = notCheckedIn.filter((u: any) => (u.current_streak || 0) >= 3);
  const urgency = atRisk.length > 0
    ? ` ${atRisk.map((u: any) => u.display_name || u.username).join(', ')} \u2014 your streak is at risk!`
    : '';

  await supabase.from('messages').insert({
    circle_id: circleId,
    content: `\uD83E\uDDA2 Streak check: ${notCheckedIn.length} member(s) haven't checked in yet \u2014 ${names}.${urgency} Keep the momentum going!`,
    is_bot: true,
    user_id: null,
  });

  return { success: true, summary: `Nudged ${notCheckedIn.length} members: ${names}` };
}

async function execStaleTaskDetector(circleId: string): Promise<BehaviorResult> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  const { data: staleTasks } = await supabase
    .from('tasks')
    .select('id, title, updated_at')
    .eq('circle_id', circleId)
    .eq('status', 'in_progress')
    .lt('updated_at', threeDaysAgo)
    .order('updated_at', { ascending: true })
    .limit(10);

  if (!staleTasks || staleTasks.length === 0) {
    return { success: true, summary: 'No stale tasks found' };
  }

  const lines = staleTasks.map((t: any) => {
    const age = Math.floor((Date.now() - new Date(t.updated_at).getTime()) / 86400000);
    return `\u2022 "${t.title}" (${age}d stale)`;
  }).join('\n');

  return {
    success: true,
    summary: `${staleTasks.length} stale task(s) detected`,
    detail: `Tasks stuck in-progress 3+ days:\n${lines}`,
  };
}

async function execCirclePulseMonitor(circleId: string): Promise<BehaviorResult> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: msgs } = await supabase
    .from('messages')
    .select('id')
    .eq('circle_id', circleId)
    .gte('created_at', dayAgo)
    .limit(1);

  const { data: cins } = await supabase
    .from('check_ins')
    .select('id')
    .eq('circle_id', circleId)
    .gte('created_at', dayAgo)
    .limit(1);

  if ((msgs?.length ?? 0) > 0 || (cins?.length ?? 0) > 0) {
    return { success: true, summary: 'Circle is active \u2014 no nudge needed' };
  }

  const nudges = [
    '\uD83E\uDDA2 The circle has been quiet for 24 hours. What\'s everyone working on? Drop a check-in!',
    '\uD83E\uDDA2 Radio silence detected. Share your progress \u2014 even a quick update keeps the circle energized.',
    '\uD83E\uDDA2 24 hours without activity. This is your nudge \u2014 check in and keep the streak alive.',
  ];

  await supabase.from('messages').insert({
    circle_id: circleId,
    content: nudges[Math.floor(Math.random() * nudges.length)],
    is_bot: true,
    user_id: null,
  });

  return { success: true, summary: 'Posted engagement nudge (circle quiet 24h)' };
}

async function execKnowledgeCurator(circleId: string): Promise<BehaviorResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: entries } = await supabase
    .from('blackswan_knowledge')
    .select('id, user_message, bot_response, quality_score, response_length')
    .eq('circle_id', circleId)
    .lt('created_at', sevenDaysAgo)
    .order('quality_score', { ascending: true, nullsFirst: true })
    .limit(50);

  if (!entries || entries.length === 0) {
    return { success: true, summary: 'Knowledge base is clean' };
  }

  let pruned = 0;
  let rescored = 0;

  for (const entry of entries) {
    const msg = entry.user_message || '';
    const resp = entry.bot_response || '';
    const wordCount = (msg + ' ' + resp).split(/\s+/).length;
    const hasPunctuation = /[.!?]/.test(resp);
    const respLen = entry.response_length || resp.length;
    const currentScore = entry.quality_score ?? 0.5;

    const newScore = Math.min(1.0, Math.max(0.0,
      (wordCount >= 40 ? 0.4 : wordCount >= 15 ? 0.2 : 0.05)
      + (hasPunctuation ? 0.2 : 0.0)
      + (respLen >= 200 ? 0.3 : respLen >= 50 ? 0.15 : 0.0)
      + 0.05
    ));

    if (newScore < 0.15 && currentScore < 0.2) {
      await supabase.from('blackswan_knowledge').delete().eq('id', entry.id);
      pruned++;
    } else if (Math.abs(newScore - currentScore) > 0.1) {
      await supabase.from('blackswan_knowledge')
        .update({ quality_score: Math.round(newScore * 100) / 100 })
        .eq('id', entry.id);
      rescored++;
    }
  }

  return {
    success: true,
    summary: `Knowledge: ${pruned} pruned, ${rescored} rescored (of ${entries.length} reviewed)`,
  };
}

async function execMemoryDigest(circleId: string, userId: string): Promise<BehaviorResult> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toISOString().split('T')[0];
  const todayDate = new Date().toISOString().split('T')[0];

  const { data: checkIns } = await supabase
    .from('check_ins')
    .select('content, created_at, user_id, profiles:user_id(display_name, username)')
    .eq('circle_id', circleId)
    .gte('created_at', yDate)
    .lt('created_at', todayDate);

  const { data: completedTasks } = await supabase
    .from('tasks')
    .select('title')
    .eq('circle_id', circleId)
    .eq('status', 'done')
    .gte('completed_at', yDate)
    .lt('completed_at', todayDate);

  if ((!checkIns || checkIns.length === 0) && (!completedTasks || completedTasks.length === 0)) {
    return { success: true, summary: 'No activity yesterday to digest' };
  }

  let digest = `## Daily Digest \u2014 ${yDate}\n\n`;

  if (checkIns && checkIns.length > 0) {
    digest += `### Check-ins (${checkIns.length})\n`;
    for (const c of checkIns as any[]) {
      const name = c.profiles?.display_name || c.profiles?.username || 'Unknown';
      const content = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
      digest += `- **${name}**: ${content.slice(0, 200)}\n`;
    }
    digest += '\n';
  }

  if (completedTasks && completedTasks.length > 0) {
    digest += `### Completed Tasks (${completedTasks.length})\n`;
    for (const t of completedTasks as any[]) {
      digest += `- \u2705 ${t.title}\n`;
    }
  }

  // Append to existing memory doc or create new
  const existing = await getMemoryDoc(circleId);
  const existingContent = existing?.content || '';
  const separator = existingContent ? '\n\n---\n\n' : '';
  const updatedContent = existingContent + separator + digest;

  await updateMemoryDoc(circleId, updatedContent, userId);

  return {
    success: true,
    summary: `Digest: ${checkIns?.length ?? 0} check-ins, ${completedTasks?.length ?? 0} tasks`,
    detail: digest,
  };
}

// ─── Tier 2 Implementations (AI via automation-executor) ──────────────────────

const BEHAVIOR_PROMPTS: Record<string, { prompt: string; outputTarget: string; model: string }> = {
  morning_briefing: {
    prompt: 'Generate a concise morning briefing for this circle. Include: top goals for today, XP standings, tasks due this week, and circle activity from the last 24 hours. Be motivating and direct. Under 200 words.',
    outputTarget: 'chat',
    model: 'claude-haiku',
  },
  weekly_retro: {
    prompt: 'Generate a weekly retrospective for this circle. Cover: what was accomplished (completed tasks), what stalled (incomplete tasks), streak standings, and one forward-looking recommendation. Under 300 words.',
    outputTarget: 'chat',
    model: 'claude-haiku',
  },
  goal_pace_tracker: {
    prompt: 'Analyze open tasks and member activity. Identify any goals at risk of not completing on time based on current pace. List specific tasks and members. Post a constructive warning. Under 200 words.',
    outputTarget: 'chat',
    model: 'claude-haiku',
  },
  cost_efficiency_report: {
    prompt: 'Produce a brief cost efficiency summary for this circle. Identify which agent models are most/least efficient. Give 2 concrete recommendations for improving AI cost efficiency. Under 150 words.',
    outputTarget: 'activity',
    model: 'claude-haiku',
  },
};

async function execViaAutomation(
  def: IdleBehaviorDef,
  circleId: string,
): Promise<BehaviorResult> {
  const behaviorPrompt = BEHAVIOR_PROMPTS[def.id];
  if (!behaviorPrompt) {
    return { success: false, error: `No prompt config for ${def.id}` };
  }

  const automationName = `[Idle] ${def.name}`;

  // Find or create an automation record for this behavior
  let automationId: string;
  const { data: existing } = await supabase
    .from('circle_automations')
    .select('id')
    .eq('circle_id', circleId)
    .eq('name', automationName)
    .limit(1)
    .maybeSingle();

  if (existing) {
    automationId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from('circle_automations')
      .insert({
        circle_id: circleId,
        name: automationName,
        enabled: true,
        trigger_type: 'manual',
        agent: 'BlackSwan',
        model: behaviorPrompt.model,
        prompt: behaviorPrompt.prompt,
        output_target: behaviorPrompt.outputTarget,
        include_context: { members: true, check_ins: true, tasks: true, streaks: true, analytics: true },
      })
      .select('id')
      .single();

    if (error || !created) {
      return { success: false, error: `Failed to create automation: ${error?.message}` };
    }
    automationId = created.id;
  }

  // Invoke the automation-executor edge function
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const { data, error } = await supabase.functions.invoke('automation-executor', {
      body: {
        automationId,
        circleId,
        triggerSource: 'manual',
      },
    });

    clearTimeout(timeout);

    if (error) {
      return { success: false, error: `Automation error: ${error.message}` };
    }

    return {
      success: true,
      summary: data?.summary || `${def.name} completed`,
      detail: data?.output_text || undefined,
    };
  } catch (e: any) {
    return { success: false, error: `Automation failed: ${e.message}` };
  }
}

// ─── Tier 3 Implementations ──────────────────────────────────────────────────

async function execCodebaseScanner(circleId: string): Promise<BehaviorResult> {
  const result = await execBridgeCommand(
    "grep -rn 'TODO\\|FIXME\\|HACK\\|XXX' src/ --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l"
  );

  if (!result.ok) {
    return { success: false, error: result.error || 'Bridge command failed' };
  }

  const count = parseInt((result.stdout || '0').trim(), 10);

  // Get a sample of the findings
  const sampleResult = await execBridgeCommand(
    "grep -rn 'TODO\\|FIXME\\|HACK\\|XXX' src/ --include='*.ts' --include='*.tsx' 2>/dev/null | head -10"
  );
  const sample = sampleResult.ok ? (sampleResult.stdout || '').trim() : '';

  const summary = `Codebase scan: ${count} TODO/FIXME markers found`;

  return {
    success: true,
    summary,
    detail: sample ? `${summary}\n\nSample:\n${sample}` : summary,
  };
}

async function execDependencyHealth(circleId: string): Promise<BehaviorResult> {
  const result = await execBridgeCommand('npm outdated --json 2>/dev/null || echo "{}"');

  if (!result.ok) {
    return { success: false, error: result.error || 'Bridge command failed' };
  }

  try {
    const outdated = JSON.parse(result.stdout || '{}');
    const packages = Object.keys(outdated);

    if (packages.length === 0) {
      return { success: true, summary: 'All dependencies are up to date' };
    }

    const major = packages.filter(p => {
      const cur = outdated[p].current?.split('.')[0];
      const lat = outdated[p].latest?.split('.')[0];
      return cur && lat && cur !== lat;
    });

    const summary = `${packages.length} outdated packages (${major.length} major)`;
    const lines = packages.slice(0, 15).map(p => {
      const d = outdated[p];
      return `\u2022 ${p}: ${d.current} \u2192 ${d.latest}`;
    }).join('\n');

    return { success: true, summary, detail: lines };
  } catch {
    return { success: true, summary: 'Dependencies check completed', detail: result.stdout };
  }
}

async function execCostEfficiency(circleId: string): Promise<BehaviorResult> {
  // Query terminal responses for cost/token analysis by model
  const { data: responses } = await supabase
    .from('office_terminal_responses')
    .select('model_used, token_count, input_tokens, output_tokens, latency_ms')
    .eq('status', 'done')
    .not('model_used', 'is', null)
    .limit(200);

  if (!responses || responses.length === 0) {
    return { success: true, summary: 'No response data to analyze yet' };
  }

  // Aggregate by model
  const modelStats: Record<string, { tokens: number; count: number; latency: number }> = {};
  for (const r of responses) {
    const model = r.model_used || 'unknown';
    if (!modelStats[model]) modelStats[model] = { tokens: 0, count: 0, latency: 0 };
    modelStats[model].tokens += r.token_count || 0;
    modelStats[model].count++;
    modelStats[model].latency += r.latency_ms || 0;
  }

  const lines = Object.entries(modelStats)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([model, s]) => {
      const avgLatency = Math.round(s.latency / s.count);
      const avgTokens = Math.round(s.tokens / s.count);
      return `\u2022 ${model}: ${s.count} calls, ~${avgTokens} tkn/call, ~${avgLatency}ms avg`;
    })
    .join('\n');

  return {
    success: true,
    summary: `Analyzed ${responses.length} responses across ${Object.keys(modelStats).length} models`,
    detail: lines,
  };
}
