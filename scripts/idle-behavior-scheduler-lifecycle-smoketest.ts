/**
 * Source contract for exact Office idle-scheduler lifecycle ownership.
 *
 * The scheduler is coupled to effectful application services, so runtime type
 * integration is covered by `npm run typecheck:app`; this focused smoke pins
 * the cancellation and account-switch boundary without contacting Supabase or
 * a local bridge.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(__dirname, '..');
const source = fs
  .readFileSync(path.join(root, 'src', 'lib', 'idleBehaviors.ts'), 'utf8')
  .replace(/\r\n/g, '\n');

let assertions = 0;
function check(value: unknown, message: string): void {
  assertions += 1;
  if (!value) throw new Error(`Idle scheduler lifecycle smoke failed: ${message}`);
}

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  check(startIndex >= 0, `section starts with ${start}`);
  check(endIndex > startIndex, `section ends with ${end}`);
  return source.slice(startIndex, endIndex);
}

function ordered(haystack: string, needles: string[], message: string): void {
  let cursor = -1;
  for (const needle of needles) {
    const next = haystack.indexOf(needle, cursor + 1);
    check(next > cursor, `${message}: ${needle}`);
    cursor = next;
  }
}

const scheduler = section('// ─── Scheduler', '// ─── Behavior Execution');
const execution = source.slice(source.indexOf('// ─── Behavior Execution'));
const configStorage = section('// ─── Config Storage', '// ─── Scheduler');

check(
  source.includes('sharedChatOptIn: boolean;')
    && source.includes('writesToSharedChat: boolean;'),
  'shared-chat mutation has explicit persisted opt-in and behavior metadata',
);
check(
  configStorage.includes('sharedChatOptIn: false')
    && configStorage.includes("const sharedChatOptIn = getOwnValue(input, 'sharedChatOptIn') === true")
    && configStorage.includes('sharedChatOptIn,\n    behaviors,'),
  'defaults and missing legacy opt-in fail closed',
);
check(
  configStorage.includes('enabled: def.tier === 1 && !def.writesToSharedChat'),
  'Tier 1 no longer enables shared-chat writers by default',
);
check(
  configStorage.includes('def.writesToSharedChat && !sharedChatOptIn\n        ? false'),
  'legacy shared-chat enabled flags are erased before a later opt-in',
);

const streakDefinition = section("id: 'streak_guardian'", "id: 'stale_task_detector'");
const pulseDefinition = section("id: 'circle_pulse_monitor'", "id: 'knowledge_curator'");
for (const [name, definition] of [
  ['streak guardian', streakDefinition],
  ['circle pulse', pulseDefinition],
] as const) {
  check(definition.includes('defaultCooldownMinutes: 1440'), `${name} has canonical daily cadence`);
  check(definition.includes('ownerOnly: true'), `${name} is owner-only until shared settings exist`);
  check(definition.includes('writesToSharedChat: true'), `${name} declares shared-chat mutation`);
}

check(
  configStorage.includes('def.writesToSharedChat\n      ? def.defaultCooldownMinutes'),
  'normalization replaces legacy shared-chat cooldowns with catalog cadence',
);
check(
  configStorage.includes('export function normalizeIdleConfig(input: unknown): IdleBehaviorConfig'),
  'all untrusted config input uses one exported normalizer',
);

check(
  scheduler.includes('readonly circleId: string;')
    && scheduler.includes('readonly userId: string;')
    && scheduler.includes('readonly accessToken: string;')
    && scheduler.includes('readonly authorityGeneration: number;'),
  'ownership is the immutable bearer, user, circle, and authority generation tuple',
);
check(
  scheduler.includes('const authority = Object.freeze<IdleSchedulerAuthority>({'),
  'the scheduler copies ownership into a frozen value',
);
check(
  scheduler.includes('!rawAuthority.accessToken')
    && scheduler.includes('rawAuthority.accessToken.length > 16_384')
    && scheduler.includes('!Number.isSafeInteger(rawAuthority.authorityGeneration)')
    && scheduler.includes('rawAuthority.authorityGeneration <= 0'),
  'missing bearer and invalid authority generations fail closed',
);

const retire = section('function retireScheduler(', 'function isSchedulerCurrent(');
check(retire.includes('clearInterval(context.intervalId)'), 'retirement cancels the recurring timer');
check(retire.includes('clearTimeout(context.initialTimeoutId)'), 'retirement cancels the initial timer');
check(
  retire.includes('activeSchedulers.get(key) === context'),
  'retirement removes only the exact active scheduler instance',
);

const current = section('function isSchedulerCurrent(', 'function assertSchedulerCurrent(');
check(
  current.includes('activeSchedulers.get(schedulerInstanceKey(context.authority)) !== context'),
  'a replaced scheduler immediately loses authority',
);
check(
  current.includes('context.isAuthorityCurrent(context.authority)')
    && current.includes('retireScheduler(context)'),
  'caller authority loss retires the scheduler fail closed',
);

const guardedAwait = section('async function awaitWhileSchedulerCurrent', 'function queueSchedulerTick(');
ordered(guardedAwait, [
  'assertSchedulerCurrent(context);',
  'const result = await effect();',
  'assertSchedulerCurrent(context);',
], 'every guarded async effect checks authority before and after');
check(
  guardedAwait.includes('export async function loadIdleConfigExact(')
    && guardedAwait.includes('idleConfigExactStorageKey(authority)')
    && guardedAwait.includes('return raw ? normalizeIdleConfig(JSON.parse(raw)) : getDefaultIdleConfig();'),
  'the exact user-circle config lane is loaded and normalized',
);
check(
  guardedAwait.includes('JSON.stringify(normalizeIdleConfig(config))'),
  'exact config saves normalize before persistence',
);

const claimContract = section('interface IdleBehaviorRunClaimReceipt', 'async function logIdleActivity(');
check(
  claimContract.includes(".rpc('claim_idle_behavior_run_v1', {")
    && claimContract.includes('p_circle_id: context.authority.circleId')
    && claimContract.includes('p_behavior_id: def.id')
    && claimContract.includes('p_cooldown_minutes: state.cooldownMinutes'),
  'the durable claim binds exact circle, behavior, and cooldown',
);
check(
  claimContract.includes(".setHeader('Authorization', `Bearer ${context.authority.accessToken}`)")
    && claimContract.includes('parseIdleBehaviorRunClaimReceipt(data, def.id)'),
  'the durable claim binds captured bearer and validates its receipt',
);
check(
  claimContract.includes('candidate.schemaVersion !== 1')
    && claimContract.includes("candidate.behaviorId !== expectedBehaviorId")
    && claimContract.includes("Object.prototype.hasOwnProperty.call(candidate, 'claimedAt')")
    && claimContract.includes("Object.prototype.hasOwnProperty.call(candidate, 'nextEligibleAt')")
    && claimContract.includes('effectiveCooldown !== undefined'),
  'malformed, mismatched, or invalid claim receipts fail closed',
);
check(
  claimContract.includes("status: 'transport_failure'")
    && (claimContract.match(/deferClaimTransport\(context\)/g) || []).length >= 2
    && claimContract.includes("return { status: 'receipt', receipt }"),
  'claim errors and malformed receipts latch transport backoff',
);

const queuedTick = section('function queueSchedulerTick(', 'export function startIdleScheduler(');
check(
  queuedTick.includes('if (!isSchedulerCurrent(context) || context.tickPromise) return;'),
  'a lifecycle queues at most one tracked tick',
);
ordered(queuedTick, [
  'await context.predecessorDrain;',
  'assertSchedulerCurrent(context);',
  'await tickScheduler(context);',
], 'a replacement drains its predecessor before rechecking authority and acting');
check(
  queuedTick.includes('context.tickPromise = tickPromise;')
    && queuedTick.includes('context.tickPromise === tickPromise')
    && queuedTick.includes('context.tickPromise = null;'),
  'the exact in-flight promise remains tracked until it settles',
);

const start = section('export function startIdleScheduler(', '/**\n * Compatibility stop');
check(
  start.includes('const predecessors = [...activeSchedulers.values()].filter(')
    && start.includes('predecessors.forEach(retireScheduler);'),
  'a new lifecycle replaces the prior scheduler for its circle',
);
check(
  start.includes('for (const [behaviorId, deadline] of previous.behaviorDeferrals)')
    && start.includes('previous.claimTransportFailureCount')
    && start.includes('previous.claimTransportDeferredUntil'),
  'replacement inherits behavior deferrals and claim-transport backoff',
);
ordered(start, [
  'const predecessors = [...activeSchedulers.values()].filter(',
  'const predecessorDrain = Promise.all(predecessors.map(',
  'predecessors.forEach(retireScheduler);',
  'predecessorDrain,',
  'activeSchedulers.set(schedulerInstanceKey(authority), context);',
], 'replacement snapshots and drains the retired lifecycle before installation');
ordered(start, [
  'activeSchedulers.set(schedulerInstanceKey(authority), context);',
  'context.intervalId = setInterval(',
  'context.initialTimeoutId = setTimeout(',
  'return () => retireScheduler(context);',
], 'start installs both timers and returns exact cleanup ownership');
check(
  scheduler.includes('@deprecated Pass an IdleSchedulerAuthority and retain the returned cleanup.'),
  'the positional API remains available but points callers to exact cleanup',
);
check(
  scheduler.includes('export function stopIdleScheduler(circleId: string): void'),
  'legacy circle stop remains source compatible',
);

const tick = section('async function tickScheduler(', '// ─── Behavior Execution');
check(
  tick.includes('if (!isSchedulerCurrent(context) || context.tickInFlight) return;')
    && tick.includes('context.tickInFlight = true;')
    && tick.includes('context.tickInFlight = false;'),
  'one exact lifecycle cannot overlap its own ticks',
);
check(
  tick.includes('await awaitWhileSchedulerCurrent(')
    && tick.includes('safeGetUserForAccessToken(context.authority.accessToken)')
    && tick.includes('() => detectClaudeCodeBridge()'),
  'captured token identity and bridge readiness are authority-guarded',
);
check(
  tick.includes('if (isClaimTransportDeferred(context)) return;')
    && tick.includes('const config = normalizeIdleConfig(context.getConfig());')
    && tick.includes('isBehaviorAuthorizedByConfig(def, context, config)')
    && tick.includes('isBehaviorDeferred(context, def.id)'),
  'scheduler normalizes every snapshot and requires explicit shared-chat opt-in',
);
ordered(tick, [
  'const runOutcome = await runBehavior(def, context, config);',
  "if (runOutcome === 'claim_denied') continue;",
  'return;',
], 'a denied first claim advances to later due behaviors while failures abort the tick');

const runBehavior = section('async function runBehavior(', '// ─── Behavior Dispatcher');
ordered(runBehavior, [
  'const claimAttempt = await claimIdleBehaviorRun(def, state, context);',
  "if (claimAttempt.status === 'transport_failure') return 'claim_transport_failure';",
  'const claim = claimAttempt.receipt;',
  'cacheBehaviorDeferral(context, def.id, claim.nextEligibleAt);',
  'const latestConfig = normalizeIdleConfig(context.getConfig());',
  'const stillAuthorized = isBehaviorAuthorizedByConfig(def, context, latestConfig);',
  'await projectIdleBehaviorClaim(def, context, latestConfig, claim.claimedAt);',
  "if (!claim.claimed) return 'claim_denied';",
  "if (!stillAuthorized) return 'claim_burned';",
  'const executionConfig = normalizeIdleConfig(context.getConfig());',
  'await awaitWhileSchedulerCurrent(context, () => updateAgentStatus(',
  'await logIdleActivity(context, {',
  'result = await executeBehavior(def, context);',
], 'claim, latest-config projection, and opt-in revalidation precede every behavior side effect');
const projection = section('async function projectIdleBehaviorClaim(', 'async function tickScheduler(');
check(
  projection.includes('...latestConfig,')
    && projection.includes('...latestConfig.behaviors,')
    && projection.includes('...latestState,')
    && projection.includes('context.onConfigUpdate(projectedConfig);')
    && projection.includes('await saveIdleConfigExact(context, projectedConfig);'),
  'claim projection changes only lastRanAt while preserving latest unrelated toggles',
);
check(
  !runBehavior.includes('lastRanAt: new Date().toISOString()'),
  'client completion time cannot replace the server claim timestamp',
);

check(
  execution.includes('user.id !== context.authority.userId')
    && execution.includes('user_id: context.authority.userId'),
  'a switched session cannot author the retired account scheduler message',
);
check(!execution.includes('await supabase'), 'all Supabase effects are routed through the authority guard');
check(!execution.includes('await updateAgentStatus'), 'status effects are routed through the authority guard');
check(!execution.includes('await logActivity'), 'activity effects are routed through the authority guard');
check(!execution.includes('await safeGetUser'), 'session reads are routed through the authority guard');
check(!execution.includes('await getMemoryDoc'), 'memory reads are routed through the authority guard');
check(!execution.includes('await updateMemoryDoc'), 'memory writes are routed through the authority guard');
check(!execution.includes('await execBridgeCommand'), 'bridge effects are routed through the authority guard');
check(
  (source.match(/\.setHeader\('Authorization', `Bearer \$\{context\.authority\.accessToken\}`\)/g) || []).length >= 14,
  'database effects bind the captured bearer explicitly',
);
check(
  execution.includes("headers: {\n        Authorization: `Bearer ${context.authority.accessToken}`,")
    && execution.includes('capturedAuth: schedulerAuthScope(context)')
    && execution.includes('isAuthorityCurrent: () => isSchedulerCurrent(context)'),
  'function and memory mutations retain exact bearer and lifecycle fences',
);
check(
  scheduler.includes('idleConfigExactStorageKey(context.authority)')
    && scheduler.includes('receipt !== serialized'),
  'scheduler config writes use an exact user-circle lane with a readback receipt',
);
check(
  (execution.match(/await awaitWhileSchedulerCurrent/g) || []).length >= 20,
  'the complete behavior pipeline retains broad before/after effect coverage',
);

// Execute the actual catalog/default/normalization code without importing the
// effectful React Native module. TypeScript transpilation removes its type-only
// references, leaving this selected pure section executable in Node.
const pureStart = source.indexOf('export const IDLE_BEHAVIORS:');
const pureEnd = source.indexOf('export async function loadIdleConfig()');
check(pureStart >= 0 && pureEnd > pureStart, 'pure normalization runtime section is present');
const transpiled = ts.transpileModule(source.slice(pureStart, pureEnd), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const runtimeModule: { exports: Record<string, any> } = { exports: {} };
new Function('exports', 'module', transpiled)(runtimeModule.exports, runtimeModule);
const runtime = runtimeModule.exports as {
  IDLE_BEHAVIORS: Array<{ id: string; ownerOnly: boolean; writesToSharedChat: boolean; defaultCooldownMinutes: number }>;
  getDefaultIdleConfig(): any;
  normalizeIdleConfig(input: unknown): any;
};

const deferralStart = source.indexOf('const CLAIM_TRANSPORT_BACKOFF_BASE_MS');
const deferralEnd = source.indexOf('function idleConfigExactStorageKey(');
check(deferralStart >= 0 && deferralEnd > deferralStart, 'pure deferral runtime section is present');
const deferralSource = `${source.slice(deferralStart, deferralEnd)}
module.exports.__test = {
  deferClaimTransport,
  clearClaimTransportDeferral,
  cacheBehaviorDeferral,
  isBehaviorDeferred,
};`;
const transpiledDeferrals = ts.transpileModule(deferralSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const deferralModule: { exports: Record<string, any> } = { exports: {} };
new Function('exports', 'module', transpiledDeferrals)(deferralModule.exports, deferralModule);
const deferralRuntime = deferralModule.exports.__test as {
  deferClaimTransport(context: any): void;
  clearClaimTransportDeferral(context: any): void;
  cacheBehaviorDeferral(context: any, behaviorId: string, nextEligibleAt: string): void;
  isBehaviorDeferred(context: any, behaviorId: string): boolean;
};
const fakeSchedulerContext = {
  claimTransportFailureCount: 0,
  claimTransportDeferredUntil: 0,
  behaviorDeferrals: new Map<string, number>(),
};
const firstFailureAt = Date.now();
deferralRuntime.deferClaimTransport(fakeSchedulerContext);
check(fakeSchedulerContext.claimTransportFailureCount === 1, 'runtime records the first claim transport failure');
check(
  fakeSchedulerContext.claimTransportDeferredUntil >= firstFailureAt + 5 * 60_000,
  'runtime first claim failure backs off for at least five minutes',
);
for (let index = 0; index < 20; index += 1) {
  deferralRuntime.deferClaimTransport(fakeSchedulerContext);
}
check(fakeSchedulerContext.claimTransportFailureCount === 8, 'runtime claim backoff exponent is bounded');
check(
  fakeSchedulerContext.claimTransportDeferredUntil <= Date.now() + 60 * 60_000,
  'runtime claim transport backoff is capped at one hour',
);
deferralRuntime.clearClaimTransportDeferral(fakeSchedulerContext);
check(
  fakeSchedulerContext.claimTransportFailureCount === 0
    && fakeSchedulerContext.claimTransportDeferredUntil === 0,
  'runtime valid claim receipt clears transport backoff',
);
deferralRuntime.cacheBehaviorDeferral(
  fakeSchedulerContext,
  'streak_guardian',
  new Date(Date.now() + 60_000).toISOString(),
);
check(
  deferralRuntime.isBehaviorDeferred(fakeSchedulerContext, 'streak_guardian'),
  'runtime caches authoritative denied-claim next eligibility',
);
deferralRuntime.cacheBehaviorDeferral(
  fakeSchedulerContext,
  'streak_guardian',
  new Date(Date.now() - 60_000).toISOString(),
);
check(
  !deferralRuntime.isBehaviorDeferred(fakeSchedulerContext, 'streak_guardian')
    && !fakeSchedulerContext.behaviorDeferrals.has('streak_guardian'),
  'runtime expires and removes elapsed behavior deferrals',
);

const defaults = runtime.getDefaultIdleConfig();
check(defaults.sharedChatOptIn === false, 'runtime default shared-chat opt-in is false');
check(defaults.behaviors.streak_guardian.enabled === false, 'runtime default streak guardian is disabled');
check(defaults.behaviors.circle_pulse_monitor.enabled === false, 'runtime default circle pulse is disabled');
check(defaults.behaviors.stale_task_detector.enabled === true, 'non-chat Tier 1 compatibility remains enabled');

const behaviorDispatcher = section(
  'async function executeBehavior(',
  '// ─── Tier 1 Implementations',
);
const automationBehaviorIds = [...behaviorDispatcher.matchAll(
  /case '([a-z_]+)':\s+return execViaAutomation\(/gu,
)]
  .map((match) => match[1]);
check(automationBehaviorIds.length > 0, 'runtime smoke discovers reachable automation behaviors');
for (const behaviorId of automationBehaviorIds) {
  const definition = runtime.IDLE_BEHAVIORS.find((candidate) => candidate.id === behaviorId);
  check(Boolean(definition), `${behaviorId} has an idle behavior definition`);
  check(definition?.writesToSharedChat === true, `${behaviorId} declares shared-chat mutation`);
  check(definition?.ownerOnly === true, `${behaviorId} is owner-only`);
  check(
    (definition?.defaultCooldownMinutes || 0) >= 1440,
    `${behaviorId} has at least daily shared-chat cadence`,
  );
  check(defaults.behaviors[behaviorId]?.enabled === false, `${behaviorId} defaults disabled`);
}
const costDefinition = runtime.IDLE_BEHAVIORS.find(
  (candidate) => candidate.id === 'cost_efficiency_report',
);
const costExecutor = source.slice(source.indexOf('async function execCostEfficiency('));
check(
  behaviorDispatcher.includes(
    "case 'cost_efficiency_report': return execCostEfficiency(circleId, context)",
  ),
  'cost efficiency dispatches only to its deterministic analytics executor',
);
check(
  costDefinition?.writesToSharedChat === false
    && costDefinition.defaultCooldownMinutes === 720,
  'cost efficiency remains a non-Chat 12-hour analytics behavior',
);
check(
  !costExecutor.includes('postCircleBotMessage(')
    && !costExecutor.includes(".from('messages')")
    && !costExecutor.includes("functions.invoke('automation-executor'"),
  'cost efficiency executor has no reachable shared-Chat or automation dispatch',
);

const legacy = runtime.normalizeIdleConfig({
  masterEnabled: true,
  behaviors: {
    streak_guardian: { enabled: true, cooldownMinutes: 240, lastRanAt: null },
    circle_pulse_monitor: { enabled: true, cooldownMinutes: 480, lastRanAt: null },
    goal_pace_tracker: { enabled: true, cooldownMinutes: 720, lastRanAt: null },
  },
});
check(legacy.sharedChatOptIn === false, 'runtime legacy config cannot infer shared-chat opt-in');
check(legacy.behaviors.streak_guardian.enabled === false, 'runtime erases legacy latent streak enablement');
check(legacy.behaviors.circle_pulse_monitor.enabled === false, 'runtime erases legacy latent pulse enablement');
check(legacy.behaviors.goal_pace_tracker.enabled === false, 'runtime erases legacy latent automation enablement');
check(legacy.behaviors.streak_guardian.cooldownMinutes === 1440, 'runtime upgrades legacy streak cadence to daily');
check(legacy.behaviors.circle_pulse_monitor.cooldownMinutes === 1440, 'runtime upgrades legacy pulse cadence to daily');
check(legacy.behaviors.goal_pace_tracker.cooldownMinutes === 1440, 'runtime upgrades legacy chat pace cadence to daily');
const laterOptIn = runtime.normalizeIdleConfig({ ...legacy, sharedChatOptIn: true });
check(laterOptIn.behaviors.streak_guardian.enabled === false, 'later opt-in cannot resurrect legacy streak state');
check(laterOptIn.behaviors.circle_pulse_monitor.enabled === false, 'later opt-in cannot resurrect legacy pulse state');
check(laterOptIn.behaviors.goal_pace_tracker.enabled === false, 'later opt-in cannot resurrect legacy automation state');
check(
  runtime.normalizeIdleConfig({ sharedChatOptIn: 'true', behaviors: {} }).sharedChatOptIn === false,
  'runtime malformed opt-in fails closed',
);
check(
  runtime.normalizeIdleConfig({ sharedChatOptIn: true, behaviors: {} }).sharedChatOptIn === true,
  'runtime preserves an explicit boolean opt-in',
);
const inheritedOptIn = Object.create({ sharedChatOptIn: true, masterEnabled: false });
inheritedOptIn.behaviors = {};
const inheritedNormalized = runtime.normalizeIdleConfig(inheritedOptIn);
check(inheritedNormalized.sharedChatOptIn === false, 'runtime never inherits shared-chat authority');
check(inheritedNormalized.masterEnabled === true, 'runtime ignores inherited master state');
const malformed = runtime.normalizeIdleConfig({
  masterEnabled: 'yes',
  sharedChatOptIn: 1,
  behaviors: {
    stale_task_detector: {
      enabled: 'yes',
      cooldownMinutes: -1,
      lastRanAt: 'not-a-timestamp',
    },
    unknown_behavior: { enabled: true, cooldownMinutes: 1, lastRanAt: null },
  },
});
check(malformed.behaviors.stale_task_detector.enabled === true, 'runtime repairs malformed enabled state');
check(malformed.behaviors.stale_task_detector.cooldownMinutes === 360, 'runtime repairs malformed cooldown state');
check(malformed.behaviors.stale_task_detector.lastRanAt === null, 'runtime repairs malformed timestamps');
check(!('unknown_behavior' in malformed.behaviors), 'runtime drops unknown behavior ids');

console.log(`Idle scheduler lifecycle smoke passed (${assertions} assertions).`);
