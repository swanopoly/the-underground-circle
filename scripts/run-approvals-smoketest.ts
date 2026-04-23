/**
 * run-approvals-smoketest — covers the age-formatter + kind-accent
 * mapping that RunApprovalBanner.tsx depends on. Both are pure
 * functions extracted here for offline testing; keep in lockstep with
 * the component.
 *
 * Run: npm run smoke:run-approvals
 */

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

  // ─── overflowCount ─────────────────────────────────────────
  assert(overflowCount(0) === 0, 'overflow: 0 pending → 0');
  assert(overflowCount(3) === 0, 'overflow: exactly 3 → 0 (all visible)');
  assert(overflowCount(5) === 2, 'overflow: 5 → +2');
  assert(overflowCount(100) === 97, 'overflow: 100 → +97');
  assert(overflowCount(5, 10) === 0, 'overflow: higher cap hides all');

  if (failures > 0) {
    console.error(`\n${failures} run-approvals smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll run-approvals smoke cases passed.');
}

main();
