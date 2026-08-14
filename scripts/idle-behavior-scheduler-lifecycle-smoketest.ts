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

console.log(`Idle scheduler lifecycle smoke passed (${assertions} assertions).`);
