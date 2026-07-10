/**
 * clarify-timeout-smoketest — CA-8e. Pins the pure timeout planner
 * + countdown formatter + auto-resolve writer (against a stub
 * Supabase client). Real row behavior is verified manually against
 * the live DB.
 *
 * Run: npm run smoke:clarify-timeout
 */

import {
  DEFAULT_CLARIFY_TIMEOUT_MS,
  MAX_CLARIFY_TIMEOUT_MS,
  MIN_CLARIFY_TIMEOUT_MS,
  autoResolveOnTimeout,
  formatCountdown,
  planClarifyTimeout,
} from '../src/lib/clarifyTimeout';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import {
  isDecisionRelevantAmbiguity,
  describeClarificationValue,
} from '../src/lib/clarificationGate';

function planAsks(message: string): boolean {
  return buildChatAutomationPlan({ message }).execution.kind === 'ask_clarification';
}

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ─── planClarifyTimeout ─────────────────────────────────────────
  const created = 1_000_000_000_000; // fixed epoch
  {
    // At t=0 after creation, full window remaining
    const plan = planClarifyTimeout({ createdAt: created, timeoutMs: 120_000, now: created });
    assert(plan.msUntilExpiry === 120_000, 'plan: full window at t=0');
    assert(plan.expired === false, 'plan: not expired at t=0');
    assert(plan.urgent === false, 'plan: not urgent at t=0');
    assert(plan.elapsedFraction === 0, 'plan: 0% elapsed at t=0');
    assert(plan.expiresAtMs === created + 120_000, 'plan: expiresAtMs = createdAt + timeoutMs');
  }
  {
    // Halfway through
    const plan = planClarifyTimeout({ createdAt: created, timeoutMs: 120_000, now: created + 60_000 });
    assert(plan.msUntilExpiry === 60_000, 'plan: halfway remaining');
    assert(Math.abs(plan.elapsedFraction - 0.5) < 1e-9, 'plan: 50% elapsed');
    assert(!plan.urgent, 'plan: not urgent at halfway');
  }
  {
    // Last 15s = urgent
    const plan = planClarifyTimeout({ createdAt: created, timeoutMs: 120_000, now: created + 110_000 });
    assert(plan.msUntilExpiry === 10_000, 'plan: 10s remaining');
    assert(plan.urgent === true, 'plan: urgent in last 15s');
    assert(!plan.expired, 'plan: not yet expired');
  }
  {
    // Exactly at expiry
    const plan = planClarifyTimeout({ createdAt: created, timeoutMs: 120_000, now: created + 120_000 });
    assert(plan.msUntilExpiry === 0, 'plan: 0 remaining at deadline');
    assert(plan.expired === true, 'plan: expired at deadline');
    assert(plan.urgent === false, 'plan: not urgent once expired');
  }
  {
    // Past expiry
    const plan = planClarifyTimeout({ createdAt: created, timeoutMs: 120_000, now: created + 500_000 });
    assert(plan.msUntilExpiry === 0, 'plan: stays at 0 past expiry');
    assert(plan.expired === true, 'plan: remains expired');
    assert(plan.elapsedFraction === 1, 'plan: elapsedFraction clamped to 1');
  }
  // Default timeout applies when omitted
  {
    const plan = planClarifyTimeout({ createdAt: created, now: created });
    assert(plan.msUntilExpiry === DEFAULT_CLARIFY_TIMEOUT_MS, 'plan: default 120s timeout applied');
  }
  // Clamping
  {
    const tiny = planClarifyTimeout({ createdAt: created, timeoutMs: 500, now: created });
    assert(tiny.msUntilExpiry === MIN_CLARIFY_TIMEOUT_MS, 'plan: tiny timeout clamped up to 15s');
    const huge = planClarifyTimeout({ createdAt: created, timeoutMs: 99_999_999, now: created });
    assert(huge.msUntilExpiry === MAX_CLARIFY_TIMEOUT_MS, 'plan: huge timeout clamped down to 1h');
    const nan = planClarifyTimeout({ createdAt: created, timeoutMs: NaN, now: created });
    assert(nan.msUntilExpiry === DEFAULT_CLARIFY_TIMEOUT_MS, 'plan: NaN timeout → default');
  }
  // Accepts ISO strings + Date objects
  {
    const iso = planClarifyTimeout({
      createdAt: new Date(created).toISOString(),
      timeoutMs: 120_000,
      now: created + 30_000,
    });
    assert(iso.msUntilExpiry === 90_000, 'plan: ISO string createdAt parsed');
    const dt = planClarifyTimeout({
      createdAt: new Date(created),
      timeoutMs: 120_000,
      now: created + 30_000,
    });
    assert(dt.msUntilExpiry === 90_000, 'plan: Date createdAt parsed');
  }

  // ─── formatCountdown ────────────────────────────────────────────
  assert(formatCountdown(120_000) === '2m', 'countdown: 2 min exact');
  assert(formatCountdown(90_000) === '1m 30s', 'countdown: 1m 30s');
  assert(formatCountdown(62_500) === '1m 2s', 'countdown: 1m 2s (floors)');
  assert(formatCountdown(59_000) === '59s', 'countdown: under 1 min');
  assert(formatCountdown(5_000) === '5s', 'countdown: 5s');
  assert(formatCountdown(0) === 'auto-continuing…', 'countdown: 0 → auto-continuing');
  assert(formatCountdown(-100) === 'auto-continuing…', 'countdown: negative → auto-continuing');
  assert(formatCountdown(999) === 'auto-continuing…', 'countdown: <1s → auto-continuing');

  // ─── autoResolveOnTimeout ──────────────────────────────────────
  // Stub Supabase client — captures UPDATE args and returns a canned
  // result set to exercise the row-was-empty branch.
  function makeStub(simulateAlreadyResolved: boolean) {
    const calls: any[] = [];
    const stub: any = {
      calls,
      from() { return stub; },
      update(payload: any) { stub._payload = payload; return stub; },
      eq(col: string, val: any) { stub._filters = [...(stub._filters || []), { col, val, op: 'eq' }]; return stub; },
      is(col: string, val: any) { stub._filters = [...(stub._filters || []), { col, val, op: 'is' }]; return stub; },
      select(_cols: string) {
        calls.push({ payload: stub._payload, filters: stub._filters });
        return Promise.resolve({
          data: simulateAlreadyResolved ? [] : [{ id: 'abc' }],
          error: null,
        });
      },
    };
    return stub;
  }

  {
    // Missing id
    const r = await autoResolveOnTimeout('', { supabase: makeStub(false) });
    assert(!r.ok && /id required/.test(r.error!), 'auto-resolve: empty id rejected');
  }
  {
    // Missing supabase client
    const r = await autoResolveOnTimeout('abc', { supabase: null });
    assert(!r.ok && /supabase/.test(r.error!), 'auto-resolve: missing client rejected');
  }
  {
    // Happy path — row found + resolved
    const stub = makeStub(false);
    const r = await autoResolveOnTimeout('abc', { supabase: stub });
    assert(r.ok, 'auto-resolve: happy path returns ok');
    assert(r.alreadyResolved === false, 'auto-resolve: alreadyResolved=false when we wrote');
    assert(stub.calls[0].payload.choice === '__timeout__', 'auto-resolve: default choice is __timeout__');
    assert(typeof stub.calls[0].payload.resolved_at === 'string', 'auto-resolve: stamps resolved_at');
    const filters = stub.calls[0].filters;
    assert(filters.some((f: any) => f.col === 'resolved_at' && f.op === 'is' && f.val === null),
      'auto-resolve: .is("resolved_at", null) guard present');
  }
  {
    // User raced us — row already resolved
    const stub = makeStub(true);
    const r = await autoResolveOnTimeout('abc', { supabase: stub });
    assert(r.ok, 'auto-resolve: race ok:true');
    assert(r.alreadyResolved === true, 'auto-resolve: alreadyResolved=true when race detected');
  }
  {
    // Custom defaultChoice
    const stub = makeStub(false);
    await autoResolveOnTimeout('abc', { supabase: stub, defaultChoice: 'No, stop' });
    assert(stub.calls[0].payload.choice === 'No, stop', 'auto-resolve: custom defaultChoice honoured');
  }

  // ─── clarificationGate: decision-relevance (over-ask guard) ─────
  // Research: over-asking on already-specified tasks hurts UX; the dominant
  // failure is UNDER-clarifying (answering prematurely). So the gate must (a)
  // NOT fire on fully-specified input, and (b) still fire when a
  // decision-relevant slot is empty.

  // (a) Fully-specified conversational actions must NEVER ask — end-to-end
  // through the real planner (this is the behaviour the gate guarantees).
  {
    const specified = [
      'create a task to ship the newsletter friday',
      'Create a task to review the invoice',
      'make a ticket to fix the login bug on mobile',
      'Generate an image of a neon swan over a city at night',
      'draw a picture of a dragon guarding a castle',
      'Schedule a WordPress post about launch recap for 2026-07-01',
      'publish to wordpress: Spring sale — 20% off all plans through June',
      'draft a wordpress post about our new pricing page and launch recap',
    ];
    for (const message of specified) {
      assert(!planAsks(message), `over-ask guard: specified input does NOT clarify — "${message.slice(0, 44)}"`);
    }
  }

  // (b) Genuinely-underspecified conversational actions must still ASK.
  {
    const underspecified = [
      'create a task',
      'make a ticket',
      'add a todo',
      'generate an image',
      'draw a picture',
      'schedule a wordpress post',
      'post to wordpress',
    ];
    for (const message of underspecified) {
      assert(planAsks(message), `under-ask guard: empty slot still clarifies — "${message}"`);
    }
  }

  // (c) The pure gate itself: fully-specified (no missing params) → never ask.
  {
    const g = isDecisionRelevantAmbiguity({ message: 'create a task to ship the newsletter', intentType: 'create_task', missingParams: [] });
    assert(g.ask === false && g.reason === 'fully_specified', 'gate: no missing params → ask=false (fully_specified)');
  }
  // (d) The pure gate: decision-relevant empty slot → ask, with a reason code.
  {
    const g = isDecisionRelevantAmbiguity({ message: 'create a task', intentType: 'create_task', missingParams: ['task description'] });
    assert(g.ask === true && g.reason === 'missing_task_subject', 'gate: empty task subject → ask=true (missing_task_subject)');
  }
  // (e) The pure gate: a purely stylistic/reversible gap → proceed with default.
  {
    const g = isDecisionRelevantAmbiguity({ message: 'generate an image of a red barn', intentType: 'generate_image', missingParams: ['style'] });
    assert(g.ask === false && g.reason === 'gap_is_stylistic_or_reversible', 'gate: stylistic-only gap → ask=false (safe default)');
  }
  // (f) A schedule with no date is decision-relevant even if subject text exists.
  {
    const g = isDecisionRelevantAmbiguity({ message: 'schedule a wordpress post about the launch', intentType: 'wordpress_schedule', missingParams: ['publish date'] });
    assert(g.ask === true && g.reason === 'missing_publish_date', 'gate: missing schedule date → ask=true (missing_publish_date)');
  }
  // (g) describeClarificationValue: bounded, content-free rationale for both branches.
  {
    const asked = describeClarificationValue('missing_image_subject');
    assert(asked.length > 0 && asked.length <= 120 && /Asked:/.test(asked), 'describe: ask reason is a bounded rationale');
    const skipped = describeClarificationValue('fully_specified');
    assert(skipped.length > 0 && skipped.length <= 120 && /Proceeded:/.test(skipped), 'describe: not-asked reason is a bounded rationale');
    const unknown = describeClarificationValue(null);
    assert(unknown.length > 0, 'describe: null reason still yields a rationale');
  }

  if (failures > 0) {
    console.error(`\n${failures} clarify-timeout smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll clarify-timeout smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
