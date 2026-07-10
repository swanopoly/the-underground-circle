/**
 * openswan-steering-bus-smoketest — verifies the in-memory mid-run steering
 * bus for the OpenSwan typed tool loop (Phase 7b of
 * docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md): scope lifecycle
 * (register/unregister/re-register), push gating (inactive scope, empty
 * note, queue cap), drain formatting via the reused guidance-only framing,
 * per-scope isolation, and peek-size tracking.
 *
 * Run: npx tsx scripts/openswan-steering-bus-smoketest.ts
 */

import {
  drainOpenSwanSteeringNotes,
  isOpenSwanSteeringScopeActive,
  MAX_OPENSWAN_STEERING_QUEUE,
  peekOpenSwanSteeringQueueSize,
  pushOpenSwanSteeringNote,
  registerOpenSwanSteeringScope,
  unregisterOpenSwanSteeringScope,
} from '../src/lib/openswanSteering';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── Queue bound ─────────────────────────────────────────────────────────────
{
  expect(MAX_OPENSWAN_STEERING_QUEUE === 5, 'queue bound pinned at 5');
  pass('queue bound');
}

// ── Inactive scope ──────────────────────────────────────────────────────────
{
  const scope = 'turn-inactive';
  expect(!isOpenSwanSteeringScopeActive(scope), 'unregistered scope is inactive');
  const res = pushOpenSwanSteeringNote(scope, 'skip the first site');
  expect(!res.ok && res.error.includes('No live run to steer'), 'push to inactive scope fails naming no-live-run');
  expect(drainOpenSwanSteeringNotes(scope).length === 0, 'drain on inactive scope → []');
  expect(peekOpenSwanSteeringQueueSize(scope) === 0, 'peek on inactive scope → 0');
  pass('inactive scope: push rejected / drain empty / peek 0');
}

// ── Register + push + drain ─────────────────────────────────────────────────
{
  const scope = 'turn-basic';
  registerOpenSwanSteeringScope(scope);
  expect(isOpenSwanSteeringScopeActive(scope), 'registered scope is active');
  const res = pushOpenSwanSteeringNote(scope, 'use the monthly price');
  expect(res.ok, 'push to active scope succeeds');
  const drained = drainOpenSwanSteeringNotes(scope);
  expect(drained.length === 1, 'drain returns the queued note');
  expect(drained[0]?.includes('NOT an approval'), 'drained note carries the guidance-only framing');
  expect(drained[0]?.includes('use the monthly price'), 'drained note carries the raw note text');
  expect(drainOpenSwanSteeringNotes(scope).length === 0, 'second drain → [] (queue cleared)');
  expect(isOpenSwanSteeringScopeActive(scope), 'drain keeps the scope active');
  unregisterOpenSwanSteeringScope(scope);
  pass('register → push → drain formatted → cleared');
}

// ── Queue cap ───────────────────────────────────────────────────────────────
{
  const scope = 'turn-cap';
  registerOpenSwanSteeringScope(scope);
  for (let i = 1; i <= MAX_OPENSWAN_STEERING_QUEUE; i += 1) {
    const res = pushOpenSwanSteeringNote(scope, `note number ${i}`);
    expect(res.ok, `push ${i} of ${MAX_OPENSWAN_STEERING_QUEUE} succeeds`);
  }
  const overflow = pushOpenSwanSteeringNote(scope, 'one too many');
  expect(
    !overflow.ok && overflow.error === 'Too many queued notes — let it apply the current ones first.',
    'push past the cap fails with the queue-full message',
  );
  expect(peekOpenSwanSteeringQueueSize(scope) === MAX_OPENSWAN_STEERING_QUEUE, 'failed overflow push does not grow the queue');
  unregisterOpenSwanSteeringScope(scope);
  pass('queue cap at 5: 6th push rejected');
}

// ── Empty note ──────────────────────────────────────────────────────────────
{
  const scope = 'turn-empty';
  registerOpenSwanSteeringScope(scope);
  const res = pushOpenSwanSteeringNote(scope, '   ');
  expect(!res.ok && res.error === 'Steering note is empty.', 'empty note propagates the normalize error');
  expect(peekOpenSwanSteeringQueueSize(scope) === 0, 'failed empty push queues nothing');
  unregisterOpenSwanSteeringScope(scope);
  pass('empty note: normalize error propagated');
}

// ── Re-register clears stale notes ──────────────────────────────────────────
{
  const scope = 'turn-reregister';
  registerOpenSwanSteeringScope(scope);
  pushOpenSwanSteeringNote(scope, 'stale guidance from the previous run');
  expect(peekOpenSwanSteeringQueueSize(scope) === 1, 'note queued before re-register');
  registerOpenSwanSteeringScope(scope);
  expect(isOpenSwanSteeringScopeActive(scope), 're-register keeps the scope active');
  expect(peekOpenSwanSteeringQueueSize(scope) === 0, 're-register clears stale notes');
  expect(drainOpenSwanSteeringNotes(scope).length === 0, 'no stale note survives into the new run');
  unregisterOpenSwanSteeringScope(scope);
  pass('re-register clears stale notes');
}

// ── Unregister ──────────────────────────────────────────────────────────────
{
  const scope = 'turn-unregister';
  registerOpenSwanSteeringScope(scope);
  pushOpenSwanSteeringNote(scope, 'about to be dropped');
  unregisterOpenSwanSteeringScope(scope);
  expect(!isOpenSwanSteeringScopeActive(scope), 'unregistered scope is inactive');
  const res = pushOpenSwanSteeringNote(scope, 'too late');
  expect(!res.ok && res.error.includes('No live run to steer'), 'push after unregister fails');
  expect(drainOpenSwanSteeringNotes(scope).length === 0, 'undrained notes are dropped with the scope');
  pass('unregister: inactive + push fails + notes dropped');
}

// ── Scope isolation ─────────────────────────────────────────────────────────
{
  const scopeA = 'turn-iso-a';
  const scopeB = 'turn-iso-b';
  registerOpenSwanSteeringScope(scopeA);
  registerOpenSwanSteeringScope(scopeB);
  pushOpenSwanSteeringNote(scopeA, 'only for scope A');
  expect(peekOpenSwanSteeringQueueSize(scopeA) === 1, 'scope A holds its note');
  expect(peekOpenSwanSteeringQueueSize(scopeB) === 0, 'scope B stays empty');
  expect(drainOpenSwanSteeringNotes(scopeB).length === 0, "scope A's note never drains from scope B");
  const drainedA = drainOpenSwanSteeringNotes(scopeA);
  expect(drainedA.length === 1 && drainedA[0]?.includes('only for scope A'), "scope A's note drains from scope A");
  unregisterOpenSwanSteeringScope(scopeA);
  unregisterOpenSwanSteeringScope(scopeB);
  pass('two scopes are isolated');
}

// ── Peek tracks push/drain ──────────────────────────────────────────────────
{
  const scope = 'turn-peek';
  registerOpenSwanSteeringScope(scope);
  expect(peekOpenSwanSteeringQueueSize(scope) === 0, 'fresh scope peeks 0');
  pushOpenSwanSteeringNote(scope, 'first');
  expect(peekOpenSwanSteeringQueueSize(scope) === 1, 'peek 1 after first push');
  pushOpenSwanSteeringNote(scope, 'second');
  expect(peekOpenSwanSteeringQueueSize(scope) === 2, 'peek 2 after second push');
  drainOpenSwanSteeringNotes(scope);
  expect(peekOpenSwanSteeringQueueSize(scope) === 0, 'peek 0 after drain');
  unregisterOpenSwanSteeringScope(scope);
  pass('peek size tracks push/drain');
}

if (failures > 0) {
  console.error(`\n${failures} openswan steering bus smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll openswan steering bus smoke cases passed.');
