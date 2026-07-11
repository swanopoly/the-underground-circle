/**
 * run-approvals-smoketest — covers the age-formatter + kind-accent
 * mapping that RunApprovalBanner.tsx depends on. Both are pure
 * functions extracted here for offline testing; keep in lockstep with
 * the component.
 *
 * Also covers the approval idempotency primitives
 * (src/lib/approvalIdempotency.ts) + a faithful replica of the
 * agentApprovalsWorker.applyApprovedAction guard driven by a SPY handler,
 * proving an approved-then-retried mutating action can never double-execute
 * a side effect. (agentApprovalsWorker itself imports supabase → react-native
 * and can't load under tsx, so the guard is exercised via the shared pure
 * helpers here — the exact same functions the worker calls.)
 *
 * Run: npm run smoke:run-approvals
 */

import {
  buildApprovalIdempotencyKey,
  buildIdempotentSkipResult,
  canonicalizeForKey,
  detectParamMismatch,
  isAlreadyApplied,
  IDEMPOTENT_SKIP_REASON,
  PARAM_MISMATCH_ERROR,
} from '../src/lib/approvalIdempotency';

type ApprovalKind =
  | 'tool_use' | 'publish' | 'external_send' | 'file_write' | 'browser_action'
  | 'cost_threshold' | 'privileged_action' | 'plan_approval' | 'deliverable_review';

const KIND_ACCENTS: Record<ApprovalKind, { fg: string; bg: string; border: string; label: string }> = {
  publish:             { fg: '#fbbf24', bg: '#422006', border: '#92400e', label: 'PUBLISH' },
  external_send:       { fg: '#f472b6', bg: '#500724', border: '#831843', label: 'SEND' },
  file_write:          { fg: '#60a5fa', bg: '#172554', border: '#1e40af', label: 'WRITE' },
  browser_action:      { fg: '#a78bfa', bg: '#2e1065', border: '#5b21b6', label: 'BROWSER' },
  cost_threshold:      { fg: '#f87171', bg: '#450a0a', border: '#991b1b', label: 'COST' },
  privileged_action:   { fg: '#fbbf24', bg: '#422006', border: '#92400e', label: 'PRIVILEGED' },
  plan_approval:       { fg: '#34d399', bg: '#022c22', border: '#065f46', label: 'PLAN' },
  deliverable_review:  { fg: '#38bdf8', bg: '#082f49', border: '#075985', label: 'REVIEW' },
  tool_use:            { fg: '#c4b5fd', bg: '#1e1b4b', border: '#4338ca', label: 'TOOL' },
};

function ageLabel(requestedAtIso: string, nowMs: number): string {
  const ms = nowMs - new Date(requestedAtIso).getTime();
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

// Resolve flow — simulates the banner's optimistic resolve +
// realtime-refetch path. When a row moves from pending→approved we
// expect it to drop out of the pendingCount.
type Row = { id: string; status: 'pending' | 'approved' | 'rejected' };

function computePendingCount(rows: Row[]): number {
  return rows.filter((r) => r.status === 'pending').length;
}

function resolveInMemory(rows: Row[], id: string, status: 'approved' | 'rejected'): Row[] {
  return rows.map((r) => (r.id === id ? { ...r, status } : r));
}

// P64 (backlog #1): the service/runtime resolveRunApproval now carries a
// `.eq('status','pending')` predicate + row-match return, so ONLY a still-
// pending row transitions and a late/double/expired resolve is a fail-closed
// no-op (ok:false). This mirrors that contract for the pin below.
type ResolvableRow = { id: string; status: 'pending' | 'approved' | 'rejected' | 'expired' };
function resolvePendingOnly(
  rows: ResolvableRow[],
  id: string,
  status: 'approved' | 'rejected',
): { rows: ResolvableRow[]; ok: boolean } {
  let matched = false;
  const next = rows.map((r) => {
    if (r.id === id && r.status === 'pending') { matched = true; return { ...r, status }; }
    return r;
  });
  return { rows: next, ok: matched };
}

// Overflow label — matches `${pendingCount - visible.length}` math in
// the component when more than 3 pending.
function overflowCount(pendingCount: number, visibleCap = 3): number {
  return Math.max(0, pendingCount - visibleCap);
}

// ─── Test runner ──────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── ageLabel ─────────────────────────────────────────────
  const now = Date.parse('2026-04-23T12:00:00Z');
  assert(ageLabel('2026-04-23T12:00:00Z', now) === '0s ago', 'age: just now');
  assert(ageLabel('2026-04-23T11:59:45Z', now) === '15s ago', 'age: seconds');
  assert(ageLabel('2026-04-23T11:58:00Z', now) === '2m ago', 'age: minutes');
  assert(ageLabel('2026-04-23T10:00:00Z', now) === '2h ago', 'age: hours');
  assert(ageLabel('2026-04-23T12:05:00Z', now) === '0s ago', 'age: future clamped to 0');

  // ─── KIND_ACCENTS coverage ────────────────────────────────
  const allKinds: ApprovalKind[] = [
    'tool_use', 'publish', 'external_send', 'file_write', 'browser_action',
    'cost_threshold', 'privileged_action', 'plan_approval', 'deliverable_review',
  ];
  for (const k of allKinds) {
    const accent = KIND_ACCENTS[k];
    assert(!!accent, `accent: ${k} has entry`);
    assert(/^#[0-9a-f]{6}$/i.test(accent.fg), `accent: ${k} fg is 6-char hex`);
    assert(/^#[0-9a-f]{6}$/i.test(accent.bg), `accent: ${k} bg is 6-char hex`);
    assert(accent.label === accent.label.toUpperCase(), `accent: ${k} label all caps`);
    assert(accent.label.length >= 3 && accent.label.length <= 12, `accent: ${k} label reasonable length`);
  }

  // ─── computePendingCount + resolveInMemory ────────────────
  let rows: Row[] = [
    { id: 'a', status: 'pending' },
    { id: 'b', status: 'pending' },
    { id: 'c', status: 'approved' },
    { id: 'd', status: 'pending' },
    { id: 'e', status: 'rejected' },
  ];
  assert(computePendingCount(rows) === 3, 'pending: count counts only pending');

  rows = resolveInMemory(rows, 'a', 'approved');
  assert(computePendingCount(rows) === 2, 'resolve: approved row drops from pending');

  rows = resolveInMemory(rows, 'b', 'rejected');
  assert(computePendingCount(rows) === 1, 'resolve: rejected row drops from pending');

  // Resolving an already-resolved row is a no-op on count
  rows = resolveInMemory(rows, 'c', 'rejected');
  assert(computePendingCount(rows) === 1, 'resolve: no new dropouts for already-resolved');

  // Unknown id — also no-op
  rows = resolveInMemory(rows, 'zzz', 'approved');
  assert(computePendingCount(rows) === 1, 'resolve: unknown id leaves rows unchanged');
  // After sequence: a=approved, b=rejected, c=rejected (was approved, overwritten), d=pending, e=rejected
  // → only 'a' is approved.
  assert(rows.filter((r) => r.status === 'approved').length === 1, 'resolve: approved count correct after overwrite');
  assert(rows.filter((r) => r.status === 'rejected').length === 3, 'resolve: rejected count includes overwritten row');

  // ─── pending-only resolve contract (P64 #1) ────────────────
  // The hardened resolveRunApproval only transitions a still-PENDING row and
  // reports whether a row actually matched — so a decision can't be flipped
  // and an expired/late resolve fails closed.
  const poRows: ResolvableRow[] = [
    { id: 'p', status: 'pending' },
    { id: 'a', status: 'approved' },
    { id: 'x', status: 'expired' },
  ];
  const okResolve = resolvePendingOnly(poRows, 'p', 'approved');
  assert(okResolve.ok === true, 'pending-only: a pending row resolves (ok)');
  assert(okResolve.rows.find((r) => r.id === 'p')?.status === 'approved', 'pending-only: pending row transitions');
  const flip = resolvePendingOnly(poRows, 'a', 'rejected');
  assert(flip.ok === false, 'pending-only: cannot flip an already-approved decision (ok:false)');
  assert(flip.rows.find((r) => r.id === 'a')?.status === 'approved', 'pending-only: approved row stays approved');
  const late = resolvePendingOnly(poRows, 'x', 'approved');
  assert(late.ok === false, 'pending-only: cannot retro-approve an expired row (ok:false)');
  assert(late.rows.find((r) => r.id === 'x')?.status === 'expired', 'pending-only: expired row stays expired');
  const gone = resolvePendingOnly(poRows, 'nope', 'approved');
  assert(gone.ok === false, 'pending-only: unknown id → ok:false (no fresh approval)');

  // ─── overflowCount ─────────────────────────────────────────
  assert(overflowCount(0) === 0, 'overflow: 0 pending → 0');
  assert(overflowCount(3) === 0, 'overflow: exactly 3 → 0 (all visible)');
  assert(overflowCount(5) === 2, 'overflow: 5 → +2');
  assert(overflowCount(100) === 97, 'overflow: 100 → +97');
  assert(overflowCount(5, 10) === 0, 'overflow: higher cap hides all');

  // ─── approval idempotency: pure key ────────────────────────
  {
    const base = { id: 'appr-1', action_type: 'skill.create', payload: { name: 'x', body: 'y' } };
    const k1 = buildApprovalIdempotencyKey(base);
    const k2 = buildApprovalIdempotencyKey({ ...base });
    assert(k1 === k2, 'idem-key: stable for identical approval');
    assert(k1.startsWith('v1::appr-1::'), 'idem-key: carries version + approval id');

    // Key-order independence: canonicalization sorts object keys, so a retry
    // that serializes the same payload with keys reversed matches.
    const kReordered = buildApprovalIdempotencyKey({
      id: 'appr-1',
      action_type: 'skill.create',
      payload: { body: 'y', name: 'x' },
    });
    assert(kReordered === k1, 'idem-key: key-order independent (canonicalized)');

    // Different payload under the same id → different key (mismatch detectable).
    const kDiffPayload = buildApprovalIdempotencyKey({ ...base, payload: { name: 'x', body: 'DIFFERENT' } });
    assert(kDiffPayload !== k1, 'idem-key: different payload → different key');

    // Different action_type under the same id → different key.
    const kDiffAction = buildApprovalIdempotencyKey({ ...base, action_type: 'skill.delete' });
    assert(kDiffAction !== k1, 'idem-key: different action_type → different key');

    // Different id → different key.
    const kDiffId = buildApprovalIdempotencyKey({ ...base, id: 'appr-2' });
    assert(kDiffId !== k1, 'idem-key: different id → different key');

    // Bounded even for an adversarially large payload.
    const kHuge = buildApprovalIdempotencyKey({ id: 'appr-1', action_type: 't', payload: { blob: 'z'.repeat(50000) } });
    assert(kHuge.length <= 200, 'idem-key: bounded length for huge payload');
    assert(kHuge.startsWith('v1::appr-1::'), 'idem-key: bounded key still carries id');

    // Canonicalize helper directly: sorts keys, preserves array order.
    assert(canonicalizeForKey({ b: 1, a: 2 }) === '{"a":2,"b":1}', 'canonicalize: sorts object keys');
    assert(canonicalizeForKey([3, 1, 2]) === '[3,1,2]', 'canonicalize: preserves array order');
    assert(canonicalizeForKey(undefined) === 'null', 'canonicalize: undefined → null');
  }

  // ─── approval idempotency: detectParamMismatch ─────────────
  {
    assert(detectParamMismatch('v1::a::x', 'v1::a::y') === true, 'mismatch: different keys → true');
    assert(detectParamMismatch('v1::a::x', 'v1::a::x') === false, 'mismatch: identical keys → false');
    assert(detectParamMismatch(null, 'v1::a::x') === false, 'mismatch: no stored baseline → false (first apply)');
    assert(detectParamMismatch('v1::a::x', null) === false, 'mismatch: no incoming key → false');
    assert(detectParamMismatch('', '') === false, 'mismatch: both empty → false');
  }

  // ─── approval idempotency: isAlreadyApplied ────────────────
  {
    assert(isAlreadyApplied({ applied_at: '2026-07-01T00:00:00Z' }) === true, 'applied: applied_at set → true');
    assert(isAlreadyApplied({ applied_at: null }) === false, 'applied: null applied_at → false');
    assert(isAlreadyApplied({ applied_at: '   ' }) === false, 'applied: blank applied_at → false');
    assert(isAlreadyApplied({}) === false, 'applied: empty row → false');
    assert(isAlreadyApplied(null) === false, 'applied: null row → false');
    assert(isAlreadyApplied({ status: 'applied' }) === true, 'applied: terminal status "applied" → true');
    assert(isAlreadyApplied({ status: 'completed' }) === true, 'applied: terminal status "completed" → true');
    assert(isAlreadyApplied({ status: 'approved' }) === false, 'applied: "approved" is not terminal-applied');
    assert(isAlreadyApplied({ status: 'pending' }) === false, 'applied: "pending" → false');
  }

  // ─── approval idempotency: buildIdempotentSkipResult ───────
  {
    const skip = buildIdempotentSkipResult({ applied_at: 'now', action_type: 'skill.create' });
    assert(skip.ok === true, 'skip-result: ok true');
    assert(skip.applied === false, 'skip-result: applied false (nothing new ran)');
    assert(skip.reason === IDEMPOTENT_SKIP_REASON, 'skip-result: idempotent-skip reason');
    assert(skip.actionType === 'skill.create', 'skip-result: carries action_type');
  }

  // ─── WORKER GUARD REPLICA: no double-execute (spy handler) ──
  // Faithful replica of agentApprovalsWorker.applyApprovedAction's guard
  // ordering — status check → param-mismatch → isAlreadyApplied skip → dispatch
  // — using the SAME pure helpers the worker imports. A spy counts how many
  // times the side-effecting handler actually fires.
  type GuardRow = {
    id: string;
    action_type: string;
    status: string;
    applied_at?: string | null;
    payload?: any;
  };
  type GuardResult =
    | { ok: true; actionType: string; applied: boolean; reason?: string }
    | { ok: false; actionType: string; error: string };

  let handlerCalls = 0;
  // The spy handler represents the real side effect (publish/upload/comment/
  // skill-write). It stamps applied_at on the row exactly like the real
  // handlers do, so the row's "executed claim" is set after it runs.
  function spyHandler(row: GuardRow): GuardResult {
    handlerCalls += 1;
    row.applied_at = new Date().toISOString();
    return { ok: true, actionType: row.action_type, applied: true };
  }

  function applyApprovedActionReplica(row: GuardRow): GuardResult {
    const actionType = String(row.action_type || '');
    const status = String(row.status || '');
    if (status !== 'approved' && status !== 'auto_approved') {
      return { ok: true, actionType, applied: false, reason: `status is "${status}"` };
    }
    const incomingKey = buildApprovalIdempotencyKey({ id: row.id, action_type: actionType, payload: row.payload });
    const storedKey =
      row.payload && typeof row.payload.workerIdempotencyKey === 'string'
        ? String(row.payload.workerIdempotencyKey)
        : null;
    if (detectParamMismatch(storedKey, incomingKey)) {
      return { ok: false, actionType, error: PARAM_MISMATCH_ERROR };
    }
    if (isAlreadyApplied(row)) {
      return buildIdempotentSkipResult({ ...row, action_type: actionType });
    }
    return spyHandler(row);
  }

  // (1) Fresh approved row executes exactly once.
  handlerCalls = 0;
  const freshRow: GuardRow = { id: 'g-1', action_type: 'skill.create', status: 'approved', applied_at: null, payload: { name: 'a' } };
  const first = applyApprovedActionReplica(freshRow);
  assert(first.ok === true && (first as any).applied === true, 'guard: fresh row applies');
  assert(handlerCalls === 1, 'guard: fresh row invoked handler exactly once');
  assert(typeof freshRow.applied_at === 'string', 'guard: handler stamped applied_at (the claim)');

  // (2) Second apply on the SAME (now-applied) row → idempotent skip, handler NOT called again.
  const second = applyApprovedActionReplica(freshRow);
  assert(second.ok === true && (second as any).applied === false, 'guard: retry returns applied:false');
  assert((second as any).reason === IDEMPOTENT_SKIP_REASON, 'guard: retry returns idempotent-skip reason');
  assert(handlerCalls === 1, 'guard: NO double-execute — handler still called exactly once after retry');

  // (3) A burst of retries (double-click + resubmit + sweep) never re-fires.
  applyApprovedActionReplica(freshRow);
  applyApprovedActionReplica(freshRow);
  applyApprovedActionReplica(freshRow);
  assert(handlerCalls === 1, 'guard: burst of 3 more retries still 1 total execution');

  // (4) Retry with a MUTATED payload under the same id (but not yet applied) →
  //     param mismatch error, handler NOT called.
  handlerCalls = 0;
  const storedK = buildApprovalIdempotencyKey({ id: 'g-2', action_type: 'skill.create', payload: { name: 'orig' } });
  const mutatedRow: GuardRow = {
    id: 'g-2',
    action_type: 'skill.create',
    status: 'approved',
    applied_at: null,
    payload: { name: 'TAMPERED', workerIdempotencyKey: storedK },
  };
  const mism = applyApprovedActionReplica(mutatedRow);
  assert(mism.ok === false, 'guard: param-mismatch retry fails closed (ok:false)');
  assert((mism as any).error === PARAM_MISMATCH_ERROR, 'guard: param-mismatch returns distinct error');
  assert(handlerCalls === 0, 'guard: param-mismatch NEVER executes the side effect');

  // (5) A non-approved row never dispatches (guard precedence).
  handlerCalls = 0;
  const pendingRow: GuardRow = { id: 'g-3', action_type: 'skill.create', status: 'pending', applied_at: null };
  const pend = applyApprovedActionReplica(pendingRow);
  assert(pend.ok === true && (pend as any).applied === false, 'guard: pending row does not apply');
  assert(handlerCalls === 0, 'guard: pending row never invokes handler');

  // (6) A row terminal by STATUS ("completed") with applied_at still null also
  //     skips without executing — the belt-and-braces fallback. auto_approved
  //     rows follow the same guard as approved.
  handlerCalls = 0;
  const terminalByStatus: GuardRow = {
    id: 'g-4',
    action_type: 'skill.create',
    status: 'auto_approved',
    applied_at: null,
    payload: { name: 'a' },
  };
  // Only reachable via isAlreadyApplied's terminal-status branch — flip status
  // to a terminal value while leaving applied_at unset.
  const terminalGuardRow: GuardRow = { ...terminalByStatus, status: 'completed', applied_at: null };
  const term = applyApprovedActionReplica(terminalGuardRow);
  // status 'completed' isn't approved/auto_approved, so the status gate returns
  // first — but isAlreadyApplied independently guards the terminal claim, which
  // we assert directly below to prove the handler can't run for a done row.
  assert(term.ok === true && (term as any).applied === false, 'guard: completed-status row does not re-apply');
  assert(handlerCalls === 0, 'guard: completed-status row never invokes handler');
  assert(isAlreadyApplied({ status: 'completed' }) === true, 'guard: completed recognized as terminal-applied');

  if (failures > 0) {
    console.error(`\n${failures} run-approvals smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll run-approvals smoke cases passed.');
}

main();
