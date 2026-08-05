// approval-audit-core-smoketest — the PURE unified approval-ledger normalizer
// (src/lib/approvalAuditCore.ts). Load-bearing:
//   • both tables → one AuditEntry: agent_run_approvals (approval_kind/title/
//     status/requested_at/resolved_at/requested_by/resolved_by) and
//     agent_approvals (action_type/description/agent_name/status/requested_at).
//   • merged newest-first, bounded to MAX_AUDIT_ENTRIES (200).
//   • decision normalization (approved/auto_approved, rejected/denied,
//     expired/timeout, pending, unknown→pending, case-insensitive).
//   • `at` = resolved_at when resolved, else requested_at.
//   • risk hint from the kind (high/medium/low).
//   • SECRET-SAFE: payload is never read; token-like secrets in title/actor are
//     masked (FAKE placeholder tokens only) — never echoed.
//   • summarizeApprovalTrail counts (expired folds into total only).
//   • formatAuditEntry: "<decision> · <title> · 3m ago", segments dropped when empty.
//   • empty → []; hostile / cyclic / huge / wrong-typed input never throws.
//
// Pure — loads under tsx (approvalAuditCore has zero imports).
// Run: npx tsx scripts/approval-audit-core-smoketest.ts

import {
  normalizeApprovalRows,
  summarizeApprovalTrail,
  formatAuditEntry,
  MAX_AUDIT_ENTRIES,
  type AuditEntry,
} from '../src/lib/approvalAuditCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-07-15T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 604_800_000;
const DOT = ' · '; // " · " — the core's field separator (middot)
// Control chars built at runtime (no literal control bytes in this source file).
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

// FAKE, obviously-invalid placeholder secrets — never real credentials.
const FAKE_GITHUB = 'ghp_' + 'A'.repeat(36);
const FAKE_SK = 'sk-ant-' + 'B'.repeat(32);
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.' + 'C'.repeat(20);
const FAKE_HEX = 'deadbeefdeadbeefdeadbeef1234'; // 28 hex-ish chars (≥20)

function oneRun(row: unknown): AuditEntry {
  return normalizeApprovalRows([row], [])[0];
}
function oneHitl(row: unknown): AuditEntry {
  return normalizeApprovalRows([], [row])[0];
}

function main(): void {
  // ─── (1) agent_run_approvals row → AuditEntry ─────────────────────────────
  {
    const e = oneRun({
      id: 'run-1',
      approval_kind: 'publish',
      title: 'Publish blog post',
      status: 'approved',
      requested_at: iso(10 * MIN),
      resolved_at: iso(3 * MIN),
      requested_by: '11111111-1111-1111-1111-111111111111',
      resolved_by: '22222222-2222-2222-2222-222222222222',
      payload: { secret: FAKE_SK },
    });
    assertEq(e.source, 'run', '(1) run source');
    assertEq(e.id, 'run-1', '(1) run id');
    assertEq(e.title, 'Publish blog post', '(1) run title');
    assertEq(e.decision, 'approved', '(1) run decision approved');
    assertEq(e.at, iso(3 * MIN), '(1) run `at` uses resolved_at');
    assertEq(e.actor, '22222222-2222-2222-2222-222222222222', '(1) run actor prefers resolved_by');
    assertEq(e.risk, 'medium', '(1) publish → medium risk');
    assertEq(formatAuditEntry(e, NOW), 'approved' + DOT + 'Publish blog post' + DOT + '3m ago', '(1) format run row');
  }

  // ─── (2) agent_approvals row → AuditEntry ─────────────────────────────────
  {
    const h = oneHitl({
      id: 'hitl-1',
      action_type: 'file_write',
      description: 'Write config to disk',
      agent_name: 'Office Agent',
      status: 'pending',
      requested_at: iso(30 * MIN),
      timeout_seconds: 300,
      payload: { token: FAKE_JWT },
    });
    assertEq(h.source, 'hitl', '(2) hitl source');
    assertEq(h.id, 'hitl-1', '(2) hitl id');
    assertEq(h.title, 'Write config to disk', '(2) hitl title from description');
    assertEq(h.decision, 'pending', '(2) hitl decision pending');
    assertEq(h.at, iso(30 * MIN), '(2) hitl `at` uses requested_at (no resolved_at)');
    assertEq(h.actor, 'Office Agent', '(2) hitl actor from agent_name');
    assertEq(h.risk, 'high', '(2) file_write → high risk');
    assertEq(formatAuditEntry(h, NOW), 'pending' + DOT + 'Write config to disk' + DOT + '30m ago', '(2) format hitl row');
  }

  // ─── (3) merge + newest-first ordering ────────────────────────────────────
  {
    const merged = normalizeApprovalRows(
      [{ id: 'r-old', approval_kind: 'tool_use', title: 'old run', status: 'rejected', requested_at: iso(5 * HOUR) }],
      [{ id: 'h-new', action_type: 'publish', description: 'new hitl', status: 'approved', requested_at: iso(2 * MIN) }],
    );
    assertEq(merged.length, 2, '(3) merged length 2');
    assertEq(merged[0].id, 'h-new', '(3) newest first (hitl 2m)');
    assertEq(merged[0].source, 'hitl', '(3) newest is hitl');
    assertEq(merged[1].id, 'r-old', '(3) older second (run 5h)');
    assertEq(merged[1].source, 'run', '(3) oldest is run');
    // A run's resolved_at (1m) outranks a hitl's requested_at (30m).
    const ord = normalizeApprovalRows(
      [{ id: 'run-resolved', status: 'approved', requested_at: iso(10 * HOUR), resolved_at: iso(1 * MIN) }],
      [{ id: 'hitl-req', status: 'pending', requested_at: iso(30 * MIN) }],
    );
    assertEq(ord[0].id, 'run-resolved', '(3) run sorts by resolved_at (1m) above hitl requested (30m)');
  }

  // ─── (4) decision normalization ───────────────────────────────────────────
  {
    const dec = (status: unknown): string => oneRun({ id: 'd', status, requested_at: iso(MIN) }).decision;
    assertEq(dec('approved'), 'approved', '(4) approved');
    assertEq(dec('auto_approved'), 'approved', '(4) auto_approved → approved');
    assertEq(dec('accepted'), 'approved', '(4) accepted → approved');
    assertEq(dec('APPROVED'), 'approved', '(4) case-insensitive approved');
    assertEq(dec('rejected'), 'rejected', '(4) rejected');
    assertEq(dec('denied'), 'rejected', '(4) denied → rejected');
    assertEq(dec('declined'), 'rejected', '(4) declined → rejected');
    assertEq(dec('expired'), 'expired', '(4) expired');
    assertEq(dec('timeout'), 'expired', '(4) timeout → expired');
    assertEq(dec('timed_out'), 'expired', '(4) timed_out → expired');
    assertEq(dec('pending'), 'pending', '(4) pending');
    assertEq(dec('weird_status'), 'pending', '(4) unknown → pending');
    assertEq(dec(undefined), 'pending', '(4) missing status → pending');
    assertEq(dec(123), 'pending', '(4) non-string status → pending');
  }

  // ─── (5) `at` selection ───────────────────────────────────────────────────
  {
    assertEq(oneRun({ id: 'a', status: 'approved', requested_at: iso(9 * MIN), resolved_at: iso(MIN) }).at, iso(MIN), '(5) resolved_at preferred');
    assertEq(oneRun({ id: 'b', status: 'approved', requested_at: iso(4 * MIN), resolved_at: 'not-a-date' }).at, iso(4 * MIN), '(5) invalid resolved_at → requested_at');
    assertEq(oneRun({ id: 'c', status: 'pending', requested_at: 'nope', resolved_at: null }).at, '', '(5) both invalid → empty at');
  }

  // ─── (6) SECRET-SAFETY — payload ignored, tokens masked ───────────────────
  {
    const secretRun = oneRun({
      id: 'sec-1',
      approval_kind: 'external_send',
      title: 'email using ' + FAKE_SK + ' now',
      status: 'approved',
      requested_at: iso(MIN),
      resolved_by: 'bearer ' + FAKE_HEX,
      payload: { api_key: FAKE_GITHUB, jwt: FAKE_JWT, nested: { deep: FAKE_SK } },
    });
    const blob = JSON.stringify(secretRun) + '|' + formatAuditEntry(secretRun, NOW);
    assert(!blob.includes(FAKE_SK), '(6) sk token never appears');
    assert(!blob.includes(FAKE_GITHUB), '(6) ghp token (payload) never appears');
    assert(!blob.includes(FAKE_JWT), '(6) jwt (payload) never appears');
    assert(!blob.includes(FAKE_HEX), '(6) hex token (actor) never appears');
    assert(secretRun.title.includes('[REDACTED]'), '(6) title carries redaction marker');
    assert(!('payload' in secretRun), '(6) entry never carries payload');
    const uuidActor = oneRun({ id: 'u', status: 'pending', requested_at: iso(MIN), requested_by: '33333333-3333-3333-3333-333333333333' });
    assertEq(uuidActor.actor, '33333333-3333-3333-3333-333333333333', '(6) UUID actor preserved un-masked');
  }

  // ─── (7) risk classification (both sources) ───────────────────────────────
  {
    const riskOf = (kind: string): string => oneRun({ id: 'k', approval_kind: kind, status: 'pending', requested_at: iso(MIN) }).risk as string;
    for (const k of ['file_write', 'browser_action', 'cost_threshold', 'privileged_action', 'external_send']) {
      assertEq(riskOf(k), 'high', '(7) ' + k + ' → high');
    }
    for (const k of ['publish', 'tool_use', 'send', 'post']) {
      assertEq(riskOf(k), 'medium', '(7) ' + k + ' → medium');
    }
    for (const k of ['plan_approval', 'deliverable_review', 'read', '']) {
      assertEq(riskOf(k), 'low', '(7) "' + k + '" → low');
    }
    assertEq(oneHitl({ id: 'hk', action_type: 'delete', status: 'pending', requested_at: iso(MIN) }).risk, 'high', '(7) hitl delete → high');
  }

  // ─── (8) bounded to MAX_AUDIT_ENTRIES, keeping the newest ─────────────────
  {
    const many: unknown[] = [];
    for (let i = 0; i < 500; i += 1) {
      many.push({ id: 'r' + i, approval_kind: 'tool_use', title: 't' + i, status: 'pending', requested_at: iso(i * 1000) });
    }
    const bounded = normalizeApprovalRows(many, []);
    assertEq(bounded.length, MAX_AUDIT_ENTRIES, '(8) capped at MAX_AUDIT_ENTRIES');
    assertEq(MAX_AUDIT_ENTRIES, 200, '(8) cap is 200');
    assertEq(bounded[0].id, 'r0', '(8) newest (r0) first');
    assertEq(bounded[199].id, 'r199', '(8) 200th is r199');
    assert(!bounded.some((x) => x.id === 'r200'), '(8) r200 dropped (older than cap)');
  }

  // ─── (9) summarizeApprovalTrail counts ────────────────────────────────────
  {
    const trail = normalizeApprovalRows(
      [
        { id: 's1', status: 'approved', requested_at: iso(MIN) },
        { id: 's2', status: 'approved', requested_at: iso(2 * MIN) },
        { id: 's3', status: 'rejected', requested_at: iso(3 * MIN) },
        { id: 's4', status: 'pending', requested_at: iso(4 * MIN) },
        { id: 's5', status: 'expired', requested_at: iso(5 * MIN) },
      ],
      [
        { id: 's6', status: 'pending', requested_at: iso(6 * MIN) },
        { id: 's7', status: 'auto_approved', requested_at: iso(7 * MIN) },
      ],
    );
    const sum = summarizeApprovalTrail(trail);
    assertEq(sum.total, 7, '(9) total 7');
    assertEq(sum.approved, 3, '(9) approved 3 (2 approved + 1 auto_approved)');
    assertEq(sum.rejected, 1, '(9) rejected 1');
    assertEq(sum.pending, 2, '(9) pending 2');
    assertEq(sum.total - sum.approved - sum.rejected - sum.pending, 1, '(9) 1 expired counts toward total only');
    const z = summarizeApprovalTrail([]);
    assertEq(z.total, 0, '(9) empty total 0');
    assert(z.approved === 0 && z.rejected === 0 && z.pending === 0, '(9) empty → all zeros');
  }

  // ─── (10) formatAuditEntry rendering ──────────────────────────────────────
  {
    const mk = (over: Partial<AuditEntry>): AuditEntry => ({ source: 'run', id: 'f', title: 'T', decision: 'approved', at: iso(3 * MIN), ...over });
    assertEq(formatAuditEntry(mk({}), NOW), 'approved' + DOT + 'T' + DOT + '3m ago', '(10) base format');
    assertEq(formatAuditEntry(mk({ at: iso(30 * 1000) }), NOW), 'approved' + DOT + 'T' + DOT + 'just now', '(10) <1min → just now');
    assertEq(formatAuditEntry(mk({ at: iso(2 * HOUR) }), NOW), 'approved' + DOT + 'T' + DOT + '2h ago', '(10) hours');
    assertEq(formatAuditEntry(mk({ at: iso(3 * DAY) }), NOW), 'approved' + DOT + 'T' + DOT + '3d ago', '(10) days');
    assertEq(formatAuditEntry(mk({ at: iso(2 * WEEK) }), NOW), 'approved' + DOT + 'T' + DOT + '2w ago', '(10) weeks');
    assertEq(formatAuditEntry(mk({ decision: 'rejected' }), NOW), 'rejected' + DOT + 'T' + DOT + '3m ago', '(10) rejected word');
    assertEq(formatAuditEntry(mk({ at: '' }), NOW), 'approved' + DOT + 'T', '(10) empty at drops age segment');
    assertEq(formatAuditEntry(mk({ at: 'garbage' }), NOW), 'approved' + DOT + 'T', '(10) invalid at drops age segment');
    assertEq(formatAuditEntry(mk({ title: '' }), NOW), 'approved' + DOT + '3m ago', '(10) empty title dropped');
    assertEq(formatAuditEntry(mk({ title: '   ' }), NOW), 'approved' + DOT + '3m ago', '(10) whitespace title dropped');
    assertEq(formatAuditEntry(mk({ decision: 'weird' as unknown as AuditEntry['decision'] }), NOW), 'pending' + DOT + 'T' + DOT + '3m ago', '(10) junk decision → pending');
    assertEq(formatAuditEntry(mk({ at: iso(-5 * MIN) }), NOW), 'approved' + DOT + 'T' + DOT + 'just now', '(10) future timestamp → just now');
    assert(!formatAuditEntry(mk({ title: 'x ' + FAKE_SK }), NOW).includes(FAKE_SK), '(10) format re-redacts a secret title');
    assert(typeof formatAuditEntry(mk({})) === 'string', '(10) single-arg format returns a string (Date.now fallback)');
  }

  // ─── (11) empty → [] ──────────────────────────────────────────────────────
  {
    assertEq(normalizeApprovalRows(undefined, undefined).length, 0, '(11) (undefined, undefined) → []');
    assertEq(normalizeApprovalRows([], []).length, 0, '(11) ([], []) → []');
    assert(Array.isArray(normalizeApprovalRows(undefined, undefined)), '(11) returns an array');
  }

  // ─── (12) hostile / degenerate → never throws, safe neutrals ──────────────
  {
    let threw = false;
    try {
      normalizeApprovalRows(null, null);
      normalizeApprovalRows(42, 'str');
      normalizeApprovalRows({}, Symbol('x') as unknown);
      normalizeApprovalRows([null, undefined, 5, 'x', true, Symbol('s') as unknown], [[], {}, NaN]);
      normalizeApprovalRows([{ status: 'approved' }], [{ description: 'no id' }]);
      normalizeApprovalRows([{ id: 'z' + NUL + BEL, title: 'x'.repeat(100000), status: 'approved', requested_at: iso(MIN) }], []);
      const cyc: Record<string, unknown> = { id: 'cyc', title: 'ok', status: 'approved', requested_at: iso(MIN) };
      cyc.self = cyc;
      cyc.payload = cyc;
      normalizeApprovalRows([cyc], []);
      summarizeApprovalTrail(null);
      summarizeApprovalTrail(42);
      summarizeApprovalTrail('nope');
      summarizeApprovalTrail([null, undefined, 5, {}, { decision: 'approved' }, Symbol('x') as unknown]);
      formatAuditEntry(undefined as unknown as AuditEntry, NOW);
      formatAuditEntry(null as unknown as AuditEntry, NOW);
      formatAuditEntry(42 as unknown as AuditEntry, NOW);
      formatAuditEntry({} as AuditEntry, NOW);
      formatAuditEntry({ source: 'run', id: 'x', title: 'x', decision: 'approved', at: iso(MIN) }, NaN);
      threw = false;
    } catch (err) {
      threw = true;
      console.error('hostile threw: ' + (err as Error)?.message);
    }
    assert(!threw, '(12) hostile inputs never throw');

    // Non-array inputs → [].
    assertEq(normalizeApprovalRows(null, null).length, 0, '(12) non-array inputs → []');
    // Rows missing an id are skipped.
    assertEq(normalizeApprovalRows([{ status: 'approved' }], [{ description: 'no id' }]).length, 0, '(12) id-less rows skipped');
    // Junk elements skipped; the one valid row survives.
    const mix = normalizeApprovalRows([null, 5, { id: 'ok', status: 'approved', requested_at: iso(MIN) }, 'x'], []);
    assertEq(mix.length, 1, '(12) only the valid row survives');
    assertEq(mix[0].id, 'ok', '(12) valid row id ok');
    // Control chars stripped from id (built via fromCharCode → 'a\\0b\\7c' → 'abc').
    assertEq(oneRun({ id: 'a' + NUL + 'b' + BEL + 'c', status: 'approved', requested_at: iso(MIN) }).id, 'abc', '(12) control chars stripped from id');
    // Huge title clamped.
    assert(oneRun({ id: 'big', title: 'x'.repeat(100000), status: 'approved', requested_at: iso(MIN) }).title.length <= 160, '(12) huge title clamped ≤160');
    // summarize on junk counts only object entries.
    const sJunk = summarizeApprovalTrail([null, undefined, 5, {}, { decision: 'approved' }]);
    assertEq(sJunk.total, 2, '(12) summarize counts object entries only ({} + {decision})');
    assertEq(sJunk.approved, 1, '(12) summarize buckets the approved object');
    // format on non-object → "".
    assertEq(formatAuditEntry(undefined as unknown as AuditEntry, NOW), '', '(12) format(undefined) → ""');
    assertEq(formatAuditEntry(42 as unknown as AuditEntry, NOW), '', '(12) format(number) → ""');
  }

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll approvalAuditCore smoke cases passed (' + passes + ' passed).');
}

main();
