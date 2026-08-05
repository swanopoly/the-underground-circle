/**
 * circle-memory-write-core-smoketest — exercises src/lib/circleMemoryWriteCore.ts,
 * the pure decision layer behind every write to `circle_memory`.
 *
 * Why this matters: `circle_memory` is the circle's shared operating document in
 * a multi-agent, multi-human workspace. Before this core existed, two concurrent
 * editors could both read v3 and both write v4 — the first edit vanished AND both
 * history rows archived the same prior content, so the lost edit was
 * unrecoverable even from the audit trail. Compaction, the most destructive
 * operation of all, wrote no history row and never bumped `version`.
 *
 * The invariants below are the ones that make those failures impossible:
 *   1. Every content change plans an undo row.
 *   2. Every update carries an optimistic-concurrency predicate.
 *   3. A losing write is DETECTED, never silently dropped or silently applied.
 *   4. Ambiguity refuses rather than guessing — a wrong write here wipes a doc.
 *
 * Usage:
 *   npm run smoke:circle-memory-write-core
 */

import {
  planMemoryDocWrite,
  classifyMemoryWriteOutcome,
  normalizeMemoryVersion,
  normalizeMemoryDocKind,
  normalizeMemoryDocSnapshot,
  describeMemoryWriteRefusal,
  MEMORY_WRITE_MAX_ATTEMPTS,
  FIRST_MEMORY_DOC_VERSION,
} from '../src/lib/circleMemoryWriteCore';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}

const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const CIRCLE = 'circle-1';

function row(content: string, version: number, editedBy: string | null = 'user-a') {
  return {
    circle_id: CIRCLE,
    doc_kind: 'brief',
    content,
    version,
    last_edited_by: editedBy,
    last_edited_at: new Date(NOW - 60_000).toISOString(),
  };
}

const base = (over: Record<string, unknown> = {}) => ({
  circleId: CIRCLE,
  nextContent: 'new content',
  editorId: 'user-b',
  docKind: 'brief',
  nowMs: NOW,
  ...over,
});

// ─── 1. Normalizers ──────────────────────────────────────────────────────────

{
  check('version: sane passthrough', normalizeMemoryVersion(5) === 5);
  check('version: junk → 0', normalizeMemoryVersion(null) === 0 && normalizeMemoryVersion('x') === 0
    && normalizeMemoryVersion(NaN) === 0 && normalizeMemoryVersion(-3) === 0);
  check('version: fractional floors', normalizeMemoryVersion(4.9) === 4);

  check('docKind: known kinds pass', normalizeMemoryDocKind('progress') === 'progress');
  check('docKind: unknown → default brief', normalizeMemoryDocKind('nope') === 'brief'
    && normalizeMemoryDocKind(null) === 'brief' && normalizeMemoryDocKind({} as any) === 'brief');

  check('snapshot: null/garbage → null', normalizeMemoryDocSnapshot(null) === null
    && normalizeMemoryDocSnapshot('x' as any) === null && normalizeMemoryDocSnapshot(42 as any) === null);
  const snap = normalizeMemoryDocSnapshot(row('hello', 3));
  check('snapshot: real row normalizes', snap !== null && snap.content === 'hello' && snap.version === 3);
}

// ─── 2. Plan — insert / noop / update ────────────────────────────────────────

{
  const insert = planMemoryDocWrite(base({ existing: null }));
  check('plan: no existing row → insert', insert.action === 'insert');
  check('plan: insert has no history row (nothing to undo)', insert.history === null);
  check('plan: insert starts at FIRST_MEMORY_DOC_VERSION', insert.nextVersion === FIRST_MEMORY_DOC_VERSION);
  check('plan: insert has no version predicate', insert.expectedVersion === null);
  check('plan: insert patch carries circle + kind', (() => {
    const p = insert.patch as Record<string, unknown> | null;
    return !!p && p.circle_id === CIRCLE && p.doc_kind === 'brief' && p.content === 'new content';
  })());

  const noop = planMemoryDocWrite(base({ existing: row('same', 3), nextContent: 'same' }));
  check('plan: identical content → noop', noop.action === 'noop');
  check('plan: noop writes no history row', noop.history === null);

  const upd = planMemoryDocWrite(base({ existing: row('old', 3) }));
  check('plan: changed content → update', upd.action === 'update');
  // INVARIANT 1 — every content change is undoable.
  check('plan: update ALWAYS plans an undo row', upd.history !== null);
  check('plan: undo row archives the PRIOR content and version',
    upd.history?.content === 'old' && upd.history?.version === 3);
  // INVARIANT 2 — every update is guarded.
  check('plan: update carries the version predicate it read', upd.expectedVersion === 3);
  check('plan: version advances by exactly one', upd.nextVersion === 4);
  check('plan: patch stamps the editor', (upd.patch as Record<string, unknown>).last_edited_by === 'user-b');
  check('plan: baseContent/intendedContent recorded for triage',
    upd.baseContent === 'old' && upd.intendedContent === 'new content');
}

// ─── 3. Plan — refusals (INVARIANT 4: never guess) ───────────────────────────

{
  const noCircle = planMemoryDocWrite(base({ existing: row('old', 3), circleId: '' }));
  check('refuse: missing circle id', noCircle.action === 'refuse' && noCircle.refusedReason === 'missing_circle_id');

  // Coercing a non-string to '' would wipe the shared doc with a clean audit trail.
  for (const bad of [null, undefined, 42, {}, [], true]) {
    const r = planMemoryDocWrite(base({ existing: row('old', 3), nextContent: bad }));
    if (r.action !== 'refuse' || r.refusedReason !== 'invalid_content') {
      check(`refuse: non-string content (${JSON.stringify(bad)}) must not wipe the doc`, false);
    }
  }
  check('refuse: every non-string content refuses as invalid_content', true);

  const badNow = planMemoryDocWrite(base({ existing: row('old', 3), nowMs: NaN }));
  check('refuse: non-finite nowMs (would stamp epoch)', badNow.action === 'refuse' && badNow.refusedReason === 'invalid_now');

  // The compaction guard: the approved summary describes ONE specific document.
  const guardOk = planMemoryDocWrite(base({ existing: row('original', 3), guardBaseContent: 'original' }));
  check('guard: matching base proceeds', guardOk.action === 'update');
  const guardFail = planMemoryDocWrite(base({ existing: row('edited since proposal', 4), guardBaseContent: 'original' }));
  check('guard: base changed since proposal → refuse, not overwrite',
    guardFail.action === 'refuse' && guardFail.refusedReason === 'base_content_changed');

  check('describeMemoryWriteRefusal is human-readable for every reason',
    (['missing_circle_id', 'invalid_content', 'invalid_now', 'base_content_changed'] as const)
      .every(r => typeof describeMemoryWriteRefusal(r) === 'string' && describeMemoryWriteRefusal(r).length > 0));
}

// ─── 4. Classify — INVARIANT 3: a losing write is never silent ───────────────

{
  const plan = planMemoryDocWrite(base({ existing: row('old', 3) }));

  const committed = classifyMemoryWriteOutcome({ plan, rowsAffected: 1, attempt: 1, maxAttempts: 3 });
  check('classify: 1 row → committed', committed.contentApplied && committed.conflict === 'none');

  // THE bug this core exists to prevent: two editors both read v3.
  const diverged = classifyMemoryWriteOutcome({
    plan, rowsAffected: 0, latest: row('a rival edit', 4), attempt: 1, maxAttempts: 3,
  });
  check('classify: real concurrent edit → diverged, NOT applied',
    diverged.conflict === 'diverged' && !diverged.contentApplied);
  check('classify: diverged is surfaced with an explanation', diverged.detail.length > 0);

  const converged = classifyMemoryWriteOutcome({
    plan, rowsAffected: 0, latest: row('new content', 4), attempt: 1, maxAttempts: 3,
  });
  check('classify: rival published our exact content → converged + applied',
    converged.conflict === 'converged' && converged.contentApplied);

  const safe = classifyMemoryWriteOutcome({
    plan, rowsAffected: 0, latest: row('old', 9), attempt: 1, maxAttempts: 3,
  });
  check('classify: version moved but content identical → safe_retry',
    safe.conflict === 'safe_retry' && safe.retryable && !safe.contentApplied);

  const gone = classifyMemoryWriteOutcome({ plan, rowsAffected: 0, latest: null, attempt: 1, maxAttempts: 3 });
  check('classify: row deleted mid-flight → vanished, not applied',
    gone.conflict === 'vanished' && !gone.contentApplied);

  const blocked = classifyMemoryWriteOutcome({
    plan, rowsAffected: 0, latest: row('old', 3), attempt: 1, maxAttempts: 3,
  });
  check('classify: predicate still matches yet 0 rows → blocked (RLS/filter), not silent success',
    blocked.conflict === 'blocked' && !blocked.contentApplied);

  const exhausted = classifyMemoryWriteOutcome({
    plan, rowsAffected: 0, latest: row('rival', 4), attempt: 3, maxAttempts: 3,
  });
  check('classify: last attempt stops being retryable', !exhausted.retryable);
  check('MEMORY_WRITE_MAX_ATTEMPTS is a sane bound',
    MEMORY_WRITE_MAX_ATTEMPTS >= 2 && MEMORY_WRITE_MAX_ATTEMPTS <= 10);
}

// ─── 5. Robustness + determinism ─────────────────────────────────────────────

{
  check('never throws on hostile input', (() => {
    try {
      planMemoryDocWrite({} as any);
      planMemoryDocWrite(null as any);
      planMemoryDocWrite(base({ existing: { content: {}, version: 'x' } }) as any);
      planMemoryDocWrite(base({ existing: row('x'.repeat(300_000), 2), nextContent: 'y'.repeat(300_000) }));
      classifyMemoryWriteOutcome({} as any);
      classifyMemoryWriteOutcome(null as any);
      classifyMemoryWriteOutcome({ plan: 'nonsense', rowsAffected: 'x' } as any);
      return true;
    } catch { return false; }
  })());

  const a = planMemoryDocWrite(base({ existing: row('old', 3) }));
  const b = planMemoryDocWrite(base({ existing: row('old', 3) }));
  check('plan: deterministic for identical input', JSON.stringify(a) === JSON.stringify(b));

  // Version must never move backwards regardless of input shape.
  let monotonic = true;
  for (let v = 0; v < 200; v += 7) {
    const p = planMemoryDocWrite(base({ existing: row('old', v) }));
    if (p.action === 'update' && p.nextVersion <= v) monotonic = false;
  }
  check('plan: nextVersion is strictly increasing across the range', monotonic);
}

console.log(`\ncircle-memory-write-core smoketest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
