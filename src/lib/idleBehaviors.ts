// ─── Idle Agent Behaviors ────────────────────────────────────────────────────
// Background tasks that agents perform while idle. Toggleable per-behavior,
// with 3 tiers: Tier 1 (pure Supabase, auto-on), Tier 2 (AI via automation-executor),
// Tier 3 (owner-only, uses Claude Code bridge or AI analysis).

import { supabase } from './supabase';
import { safeGetUserForAccessToken } from './authSession';
import { storage } from './storage';
import { updateAgentStatus } from './circleOffice';
import { execBridgeCommand, detectClaudeCodeBridge } from './claudeCodeDetector';
import type { LogActivityParams } from '../services/agentActivityLogger';
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

export interface IdleSchedulerAuthority {
  readonly circleId: string;
  readonly userId: string;
  readonly accessToken: string;
  readonly authorityGeneration: number;
}

export type IdleSchedulerCleanup = () => void;

type IdleSchedulerAuthorityCheck = (authority: IdleSchedulerAuthority) => boolean;

interface SchedulerContext {
  readonly authority: IdleSchedulerAuthority;
  readonly isOwner: boolean;
  readonly getConfig: () => IdleBehaviorConfig;
  readonly onConfigUpdate: (config: IdleBehaviorConfig) => void;
  readonly isAuthorityCurrent: IdleSchedulerAuthorityCheck;
  readonly predecessorDrain: Promise<void>;
  intervalId: ReturnType<typeof setInterval> | null;
  initialTimeoutId: ReturnType<typeof setTimeout> | null;
  tickPromise: Promise<void> | null;
  cancelled: boolean;
  tickInFlight: boolean;
}

class IdleSchedulerRetiredError extends Error {
  constructor() {
    super('Idle scheduler authority was retired');
    this.name = 'IdleSchedulerRetiredError';
  }
}

const activeSchedulers = new Map<string, SchedulerContext>();
const noOpSchedulerCleanup: IdleSchedulerCleanup = () => {};

function schedulerInstanceKey(authority: IdleSchedulerAuthority): string {
  return [
    encodeURIComponent(authority.userId),
    encodeURIComponent(authority.circleId),
    String(authority.authorityGeneration),
  ].join(':');
}

function retireScheduler(context: SchedulerContext): void {
  if (context.cancelled) return;
  context.cancelled = true;
  if (context.intervalId !== null) {
    clearInterval(context.intervalId);
    context.intervalId = null;
  }
  if (context.initialTimeoutId !== null) {
    clearTimeout(context.initialTimeoutId);
    context.initialTimeoutId = null;
  }
  // An older lifecycle cleanup must never delete or stop the replacement
  // scheduler for the same circle.
  const key = schedulerInstanceKey(context.authority);
  if (activeSchedulers.get(key) === context) {
    activeSchedulers.delete(key);
  }
}

function isSchedulerCurrent(context: SchedulerContext): boolean {
  if (
    context.cancelled
    || activeSchedulers.get(schedulerInstanceKey(context.authority)) !== context
  ) {
    return false;
  }
  try {
    if (context.isAuthorityCurrent(context.authority)) return true;
  } catch {
    // A caller-owned authority check is part of the fail-closed boundary.
  }
  retireScheduler(context);
  return false;
}

function assertSchedulerCurrent(context: SchedulerContext): void {
  if (!isSchedulerCurrent(context)) throw new IdleSchedulerRetiredError();
}

async function awaitWhileSchedulerCurrent<T>(
  context: SchedulerContext,
  effect: () => PromiseLike<T>,
): Promise<T> {
  assertSchedulerCurrent(context);
  const result = await effect();
  assertSchedulerCurrent(context);
  return result;
}

function schedulerAuthScope(context: SchedulerContext): Readonly<{
  userId: string;
  accessToken: string;
}> {
  return {
    userId: context.authority.userId,
    accessToken: context.authority.accessToken,
  };
}

function idleConfigExactStorageKey(authority: IdleSchedulerAuthority): string {
  return `${STORAGE_KEY_IDLE}:v2:${encodeURIComponent(authority.userId)}:${encodeURIComponent(authority.circleId)}`;
}

async function saveIdleConfigExact(
  context: SchedulerContext,
  config: IdleBehaviorConfig,
): Promise<void> {
  const key = idleConfigExactStorageKey(context.authority);
  const serialized = JSON.stringify(config);
  await awaitWhileSchedulerCurrent(context, () => storage.setItem(key, serialized));
  const receipt = await awaitWhileSchedulerCurrent(context, () => storage.getItem(key));
  if (receipt !== serialized) {
    throw new Error('Idle configuration receipt mismatch');
  }
}

async function logIdleActivity(
  context: SchedulerContext,
  params: LogActivityParams,
): Promise<void> {
  const { error } = await awaitWhileSchedulerCurrent(context, () => supabase
    .from('agent_activity')
    .insert({
      circle_id: params.circle_id,
      agent_name: params.agent_name ?? 'BlackSwan',
      source: params.source,
      source_detail: params.source_detail,
      activity_type: params.activity_type,
      title: params.title,
      body: params.body,
      status: params.status ?? 'completed',
      metadata: params.metadata ?? {},
    })
    .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));
  if (error) {
    console.warn('[idleBehaviors] Exact activity insert failed');
  }
}

function queueSchedulerTick(context: SchedulerContext): void {
  if (!isSchedulerCurrent(context) || context.tickPromise) return;
  // A replacement waits for its retired predecessor's current effect to
  // settle. The predecessor then observes lost map ownership and cannot begin
  // another effect, so account A and account B never execute concurrently.
  const tickPromise = (async () => {
    await context.predecessorDrain;
    assertSchedulerCurrent(context);
    await tickScheduler(context);
  })();
  context.tickPromise = tickPromise;
  void tickPromise
    .catch((error: unknown) => {
      if (error instanceof IdleSchedulerRetiredError) return;
      console.error('[idleBehaviors] Scheduler tick failed');
    })
    .finally(() => {
      if (context.tickPromise === tickPromise) context.tickPromise = null;
    });
}

export function startIdleScheduler(
  authority: IdleSchedulerAuthority,
  isOwner: boolean,
  getConfig: () => IdleBehaviorConfig,
  onConfigUpdate: (config: IdleBehaviorConfig) => void,
  isAuthorityCurrent?: IdleSchedulerAuthorityCheck,
): IdleSchedulerCleanup;
/** @deprecated Pass an IdleSchedulerAuthority and retain the returned cleanup. */
export function startIdleScheduler(
  circleId: string,
  userId: string,
  isOwner: boolean,
  getConfig: () => IdleBehaviorConfig,
  onConfigUpdate: (config: IdleBehaviorConfig) => void,
  authorityGeneration?: number,
  isAuthorityCurrent?: IdleSchedulerAuthorityCheck,
): IdleSchedulerCleanup;
export function startIdleScheduler(
  authorityOrCircleId: IdleSchedulerAuthority | string,
  userIdOrIsOwner: string | boolean,
  isOwnerOrGetConfig: boolean | (() => IdleBehaviorConfig),
  getConfigOrOnUpdate: (() => IdleBehaviorConfig) | ((config: IdleBehaviorConfig) => void),
  onUpdateOrAuthorityCheck?: ((config: IdleBehaviorConfig) => void) | IdleSchedulerAuthorityCheck,
  legacyAuthorityGeneration = 0,
  legacyAuthorityCheck: IdleSchedulerAuthorityCheck = () => true,
): IdleSchedulerCleanup {
  const usingAuthorityObject = typeof authorityOrCircleId !== 'string';
  const rawAuthority = usingAuthorityObject
    ? authorityOrCircleId
    : {
        circleId: authorityOrCircleId,
        userId: typeof userIdOrIsOwner === 'string' ? userIdOrIsOwner : '',
        accessToken: '',
        authorityGeneration: legacyAuthorityGeneration,
      };
  if (
    !rawAuthority.circleId
    || !rawAuthority.userId
    || !rawAuthority.accessToken
    || rawAuthority.accessToken.length > 16_384
    || !Number.isSafeInteger(rawAuthority.authorityGeneration)
    || rawAuthority.authorityGeneration <= 0
  ) {
    return noOpSchedulerCleanup;
  }

  const authority = Object.freeze<IdleSchedulerAuthority>({
    circleId: rawAuthority.circleId,
    userId: rawAuthority.userId,
    accessToken: rawAuthority.accessToken,
    authorityGeneration: rawAuthority.authorityGeneration,
  });
  const isOwner = usingAuthorityObject
    ? userIdOrIsOwner === true
    : isOwnerOrGetConfig === true;
  const getConfig = (usingAuthorityObject
    ? isOwnerOrGetConfig
    : getConfigOrOnUpdate) as () => IdleBehaviorConfig;
  const onConfigUpdate = (usingAuthorityObject
    ? getConfigOrOnUpdate
    : onUpdateOrAuthorityCheck) as (config: IdleBehaviorConfig) => void;
  const isAuthorityCurrent = (usingAuthorityObject
    ? onUpdateOrAuthorityCheck
    : legacyAuthorityCheck) as IdleSchedulerAuthorityCheck | undefined;
  if (typeof getConfig !== 'function' || typeof onConfigUpdate !== 'function') {
    return noOpSchedulerCleanup;
  }

  const predecessors = [...activeSchedulers.values()].filter(
    (candidate) => candidate.authority.circleId === authority.circleId,
  );
  const predecessorDrain = Promise.all(predecessors.map((previous) => (
    previous.tickPromise?.then(
      () => undefined,
      () => undefined,
    ) ?? Promise.resolve()
  ))).then(() => undefined);
  predecessors.forEach(retireScheduler);

  const context: SchedulerContext = {
    authority,
    isOwner,
    getConfig,
    onConfigUpdate,
    isAuthorityCurrent: typeof isAuthorityCurrent === 'function'
      ? isAuthorityCurrent
      : () => true,
    predecessorDrain,
    intervalId: null,
    initialTimeoutId: null,
    tickPromise: null,
    cancelled: false,
    tickInFlight: false,
  };
  activeSchedulers.set(schedulerInstanceKey(authority), context);
  context.intervalId = setInterval(() => queueSchedulerTick(context), 60_000);
  // Run first tick after a short delay (let the app settle). The handle lives on
  // the exact context so cleanup cancels both timers, including before tick one.
  context.initialTimeoutId = setTimeout(() => {
    context.initialTimeoutId = null;
    queueSchedulerTick(context);
  }, 5_000);

  return () => retireScheduler(context);
}

/**
 * Compatibility stop for older callers. New lifecycle owners must retain and
 * invoke the exact cleanup returned by startIdleScheduler instead.
 */
export function stopIdleScheduler(circleId: string): void {
  [...activeSchedulers.values()]
    .filter((scheduler) => scheduler.authority.circleId === circleId)
    .forEach(retireScheduler);
}

function isBehaviorDue(state: BehaviorState): boolean {
  if (!state.lastRanAt) return true;
  const elapsed = Date.now() - new Date(state.lastRanAt).getTime();
  return elapsed >= state.cooldownMinutes * 60 * 1000;
}

async function tickScheduler(context: SchedulerContext): Promise<void> {
  if (!isSchedulerCurrent(context) || context.tickInFlight) return;
  context.tickInFlight = true;
  try {
    assertSchedulerCurrent(context);
    const { value: verifiedUser } = await awaitWhileSchedulerCurrent(
      context,
      () => safeGetUserForAccessToken(context.authority.accessToken),
    );
    if (verifiedUser?.id !== context.authority.userId) {
      retireScheduler(context);
      throw new IdleSchedulerRetiredError();
    }
    const config = context.getConfig();
    assertSchedulerCurrent(context);
    if (!config.masterEnabled) return;

    for (const def of IDLE_BEHAVIORS) {
      assertSchedulerCurrent(context);
      if (def.ownerOnly && !context.isOwner) continue;
      const state = config.behaviors[def.id];
      if (!state || !state.enabled) continue;
      if (!isBehaviorDue(state)) continue;

      // Check bridge availability for tier 3 bridge behaviors.
      if (def.requiresBridge) {
        const bridgeAlive = await awaitWhileSchedulerCurrent(
          context,
          () => detectClaudeCodeBridge(),
        );
        if (!bridgeAlive) continue;
      }

      // Run one behavior per tick to avoid status thrashing.
      await runBehavior(def, context, config);
      return;
    }
  } finally {
    context.tickInFlight = false;
  }
}

// ─── Behavior Execution ───────────────────────────────────────────────────────

async function runBehavior(
  def: IdleBehaviorDef,
  context: SchedulerContext,
  config: IdleBehaviorConfig,
): Promise<void> {
  const { circleId, userId } = context.authority;
  assertSchedulerCurrent(context);
  console.log(`[idleBehaviors] Running ${def.id} for circle ${circleId}`);

  let result: BehaviorResult = { success: false, error: 'Unknown error' };
  try {
    // 1. Mark agent as building.
    await awaitWhileSchedulerCurrent(context, () => updateAgentStatus(
      circleId,
      'building' as any,
      {
        currentTask: def.taskLabel,
        currentGoal: `Idle: ${def.name}`,
      },
      schedulerAuthScope(context),
    ));

    // 2. Log activity start.
    await logIdleActivity(context, {
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

    result = await executeBehavior(def, context);
  } catch (e: any) {
    if (e instanceof IdleSchedulerRetiredError) return;
    result = { success: false, error: e.message || String(e) };
  }
  assertSchedulerCurrent(context);

  // 3. Log completion.
  await logIdleActivity(context, {
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

  // 4. Restore idle status.
  await awaitWhileSchedulerCurrent(
    context,
    () => updateAgentStatus(circleId, 'idle' as any, {}, schedulerAuthScope(context)),
  );

  // 5. Persist lastRanAt only while this exact authority still owns the circle.
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
  assertSchedulerCurrent(context);
  context.onConfigUpdate(updated);
  await saveIdleConfigExact(context, updated);
}

// ─── Behavior Dispatcher ──────────────────────────────────────────────────────

async function executeBehavior(
  def: IdleBehaviorDef,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const { circleId, userId } = context.authority;
  assertSchedulerCurrent(context);
  switch (def.id) {
    case 'streak_guardian':       return execStreakGuardian(circleId, context);
    case 'stale_task_detector':   return execStaleTaskDetector(circleId, context);
    case 'circle_pulse_monitor':  return execCirclePulseMonitor(circleId, context);
    case 'knowledge_curator':     return execKnowledgeCurator(circleId, context);
    case 'memory_digest':         return execMemoryDigest(circleId, userId, context);
    case 'morning_briefing':      return execViaAutomation(def, circleId, context);
    case 'weekly_retro':          return execViaAutomation(def, circleId, context);
    case 'goal_pace_tracker':     return execViaAutomation(def, circleId, context);
    case 'codebase_scanner':      return execCodebaseScanner(circleId, context);
    case 'dependency_health':     return execDependencyHealth(circleId, context);
    case 'cost_efficiency_report': return execCostEfficiency(circleId, context);
    default:
      return { success: false, error: `Unknown behavior: ${def.id}` };
  }
}

// ─── Tier 1 Implementations ──────────────────────────────────────────────────

async function execStreakGuardian(
  circleId: string,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const today = new Date().toISOString().split('T')[0];

  const { data: members } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('circle_members')
      .select('user_id, profiles(id, display_name, username, current_streak)')
      .eq('circle_id', circleId)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

  if (!members || members.length === 0) {
    return { success: true, summary: 'No members to check' };
  }

  const { data: checkIns } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('check_ins')
      .select('user_id')
      .eq('circle_id', circleId)
      .gte('created_at', today)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

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

  const posted = await postCircleBotMessage(
    circleId,
    `\uD83E\uDDA2 Streak check: ${notCheckedIn.length} member(s) haven't checked in yet \u2014 ${names}.${urgency} Keep the momentum going!`,
    context,
  );
  if (!posted) {
    return { success: true, summary: `Streak check found ${notCheckedIn.length} members to nudge; nudge message could not be posted` };
  }

  return { success: true, summary: `Nudged ${notCheckedIn.length} members: ${names}` };
}

// §31 messages RLS rejects a null sender: bot rows must be creator-owned
// (`is_bot: true` with the authenticated user's id). These behaviors run in
// the signed-in member's browser, so post on their behalf; if no session is
// available, skip quietly rather than 403 in the console.
async function postCircleBotMessage(
  circleId: string,
  content: string,
  context: SchedulerContext,
): Promise<boolean> {
  const { value: user } = await awaitWhileSchedulerCurrent(
    context,
    () => safeGetUserForAccessToken(context.authority.accessToken),
  );
  // Never let account B become the author of account A's already-running idle
  // work, even if auth changes before the component cleanup runs.
  if (!user?.id || user.id !== context.authority.userId) {
    throw new IdleSchedulerRetiredError();
  }
  const { error } = await awaitWhileSchedulerCurrent(context, () => supabase
    .from('messages')
    .insert({
      circle_id: circleId,
      content,
      is_bot: true,
      user_id: context.authority.userId,
    })
    .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));
  return !error;
}

async function execStaleTaskDetector(
  circleId: string,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

  // `tasks` has no updated_at column (only ownership_updated_at was ever
  // added), so the old updated_at filter was a guaranteed PostgREST 400.
  // Age by created_at: an in-progress task created 3+ days ago is stale.
  const { data: staleTasks } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('tasks')
      .select('id, title, created_at')
      .eq('circle_id', circleId)
      .eq('status', 'in_progress')
      .lt('created_at', threeDaysAgo)
      .order('created_at', { ascending: true })
      .limit(10)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

  if (!staleTasks || staleTasks.length === 0) {
    return { success: true, summary: 'No stale tasks found' };
  }

  const lines = staleTasks.map((t: any) => {
    const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86400000);
    return `\u2022 "${t.title}" (${age}d old, still in progress)`;
  }).join('\n');

  return {
    success: true,
    summary: `${staleTasks.length} stale task(s) detected`,
    detail: `Tasks stuck in-progress 3+ days:\n${lines}`,
  };
}

async function execCirclePulseMonitor(
  circleId: string,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: msgs } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('messages')
      .select('id')
      .eq('circle_id', circleId)
      .gte('created_at', dayAgo)
      .limit(1)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

  const { data: cins } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('check_ins')
      .select('id')
      .eq('circle_id', circleId)
      .gte('created_at', dayAgo)
      .limit(1)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

  if ((msgs?.length ?? 0) > 0 || (cins?.length ?? 0) > 0) {
    return { success: true, summary: 'Circle is active \u2014 no nudge needed' };
  }

  const nudges = [
    '\uD83E\uDDA2 The circle has been quiet for 24 hours. What\'s everyone working on? Drop a check-in!',
    '\uD83E\uDDA2 Radio silence detected. Share your progress \u2014 even a quick update keeps the circle energized.',
    '\uD83E\uDDA2 24 hours without activity. This is your nudge \u2014 check in and keep the streak alive.',
  ];

  const posted = await postCircleBotMessage(
    circleId,
    nudges[Math.floor(Math.random() * nudges.length)],
    context,
  );

  return {
    success: true,
    summary: posted ? 'Posted engagement nudge (circle quiet 24h)' : 'Circle quiet 24h; nudge message could not be posted',
  };
}

async function execKnowledgeCurator(
  circleId: string,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: entries } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('blackswan_knowledge')
      .select('id, user_message, bot_response, quality_score, response_length')
      .eq('circle_id', circleId)
      .lt('created_at', sevenDaysAgo)
      .order('quality_score', { ascending: true, nullsFirst: true })
      .limit(50)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

  if (!entries || entries.length === 0) {
    return { success: true, summary: 'Knowledge base is clean' };
  }

  let pruned = 0;
  let rescored = 0;

  for (const entry of entries) {
    assertSchedulerCurrent(context);
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
      await awaitWhileSchedulerCurrent(context, () => supabase
        .from('blackswan_knowledge')
        .delete()
        .eq('id', entry.id)
        .eq('circle_id', circleId)
        .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));
      pruned++;
    } else if (Math.abs(newScore - currentScore) > 0.1) {
      await awaitWhileSchedulerCurrent(context, () => supabase
        .from('blackswan_knowledge')
        .update({ quality_score: Math.round(newScore * 100) / 100 })
        .eq('id', entry.id)
        .eq('circle_id', circleId)
        .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));
      rescored++;
    }
  }

  return {
    success: true,
    summary: `Knowledge: ${pruned} pruned, ${rescored} rescored (of ${entries.length} reviewed)`,
  };
}

async function execMemoryDigest(
  circleId: string,
  userId: string,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yDate = yesterday.toISOString().split('T')[0];
  const todayDate = new Date().toISOString().split('T')[0];

  const { data: checkIns } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('check_ins')
      .select('content, created_at, user_id, profiles:user_id(display_name, username)')
      .eq('circle_id', circleId)
      .gte('created_at', yDate)
      .lt('created_at', todayDate)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

  const { data: completedTasks } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('tasks')
      .select('title')
      .eq('circle_id', circleId)
      .eq('status', 'done')
      .gte('completed_at', yDate)
      .lt('completed_at', todayDate)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

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
  const existing = await awaitWhileSchedulerCurrent(
    context,
    () => getMemoryDoc(circleId, 'brief', context.authority.accessToken),
  );
  const existingContent = existing?.content || '';
  const separator = existingContent ? '\n\n---\n\n' : '';
  const updatedContent = existingContent + separator + digest;

  await awaitWhileSchedulerCurrent(
    context,
    () => updateMemoryDoc(circleId, updatedContent, userId, 'brief', {
      capturedAuth: schedulerAuthScope(context),
      isAuthorityCurrent: () => isSchedulerCurrent(context),
      beforeMutation: async () => (
        isSchedulerCurrent(context)
          ? { ok: true }
          : { ok: false, error: 'Idle scheduler authority retired.' }
      ),
    }),
  );

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
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const behaviorPrompt = BEHAVIOR_PROMPTS[def.id];
  if (!behaviorPrompt) {
    return { success: false, error: `No prompt config for ${def.id}` };
  }

  const automationName = `[Idle] ${def.name}`;

  // Find or create an automation record for this behavior
  let automationId: string;
  const { data: existing } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('circle_automations')
      .select('id')
      .eq('circle_id', circleId)
      .eq('name', automationName)
      .limit(1)
      .maybeSingle()
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

  if (existing) {
    automationId = existing.id;
  } else {
    const { data: created, error } = await awaitWhileSchedulerCurrent(context, () => supabase
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
      .single()
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

    if (error || !created) {
      return { success: false, error: `Failed to create automation: ${error?.message}` };
    }
    automationId = created.id;
  }

  // Invoke the automation-executor edge function
  try {
    const { data, error } = await awaitWhileSchedulerCurrent(context, () => supabase.functions.invoke('automation-executor', {
      headers: {
        Authorization: `Bearer ${context.authority.accessToken}`,
      },
      body: {
        automationId,
        circleId,
        triggerSource: 'manual',
      },
    }));

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

async function execCodebaseScanner(
  circleId: string,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const result = await awaitWhileSchedulerCurrent(context, () => execBridgeCommand(
    "grep -rn 'TODO\\|FIXME\\|HACK\\|XXX' src/ --include='*.ts' --include='*.tsx' 2>/dev/null | wc -l",
  ));

  if (!result.ok) {
    return { success: false, error: result.error || 'Bridge command failed' };
  }

  const count = parseInt((result.stdout || '0').trim(), 10);

  // Get a sample of the findings
  const sampleResult = await awaitWhileSchedulerCurrent(context, () => execBridgeCommand(
    "grep -rn 'TODO\\|FIXME\\|HACK\\|XXX' src/ --include='*.ts' --include='*.tsx' 2>/dev/null | head -10",
  ));
  const sample = sampleResult.ok ? (sampleResult.stdout || '').trim() : '';

  const summary = `Codebase scan: ${count} TODO/FIXME markers found`;

  return {
    success: true,
    summary,
    detail: sample ? `${summary}\n\nSample:\n${sample}` : summary,
  };
}

async function execDependencyHealth(
  circleId: string,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  const result = await awaitWhileSchedulerCurrent(
    context,
    () => execBridgeCommand('npm outdated --json 2>/dev/null || echo "{}"'),
  );

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

async function execCostEfficiency(
  circleId: string,
  context: SchedulerContext,
): Promise<BehaviorResult> {
  // Query terminal responses for cost/token analysis by model
  const { data: responses } = await awaitWhileSchedulerCurrent(context, () => supabase
      .from('office_terminal_responses')
      .select('model_used, token_count, input_tokens, output_tokens, latency_ms')
      .eq('circle_id', circleId)
      .eq('status', 'done')
      .not('model_used', 'is', null)
      .limit(200)
      .setHeader('Authorization', `Bearer ${context.authority.accessToken}`));

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
