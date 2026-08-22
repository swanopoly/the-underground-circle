/**
 * memory-embedding-policy-core-smoketest — the PURE coverage layer behind
 * semantic memory retrieval (src/lib/memoryEmbeddingPolicyCore.ts).
 *
 * WHAT IS ACTUALLY AT RISK. `match_memories` filters `AND m.embedding IS NOT
 * NULL`, so a row with a null embedding is INVISIBLE to every semantic search
 * in the app. Three of these assertions are load-bearing on real money or real
 * data reachability:
 *
 *   (1) NEVER RE-EMBED. Without `allowReembed`, a row that already carries a
 *       vector is never eligible. The repair sweep is designed to be run over
 *       and over; if this predicate leaked, every pass would re-bill the whole
 *       memory table through the embed proxy.
 *   (2) THE CURSOR MUST ONLY GO FORWARD. Rows that FAIL to embed stay null, so
 *       a naive "fetch the first N null rows again" sweep re-fetches the same
 *       poisoned rows forever and never reaches row N+1. `advanceRepairCursor`
 *       is keyset-on-id and monotonic; the full-table walk below proves every
 *       row is visited exactly once and the loop terminates even when 100% of
 *       rows fail.
 *   (3) BREAKER-OPEN ORPHANS MUST BECOME REPAIRABLE. A memory saved while the
 *       proxy breaker was open used to be orphaned permanently. The scheduler
 *       must refuse to sweep while the breaker is open (a sweep then only burns
 *       reads) and must fire as soon as it closes, with the orphan debt intact.
 *
 * Also covered: batch bounds + two-pass resume equivalence, queue dedupe /
 * overflow (and the guarantee that an evicted row is still sweep-eligible),
 * cursor serialize/parse, coverage math, degenerate + hostile input, and
 * determinism.
 *
 * Pure — loads under tsx (the core has no runtime imports at all).
 *   npx tsx scripts/memory-embedding-policy-core-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  // text + identity
  normalizeEmbeddingText,
  buildEmbeddingInput,
  normalizeMemoryId,
  hasStoredEmbedding,
  evaluateEmbeddingEligibility,
  // batching
  selectEmbeddingBatch,
  planEmbeddingBatches,
  // queue
  enqueueEmbeddingJobs,
  takeEmbeddingBatch,
  // breaker
  createEmbeddingBreakerState,
  recordEmbeddingFailure,
  recordEmbeddingSuccess,
  describeEmbeddingBreaker,
  isEmbeddingBreakerOpen,
  computeEmbeddingRetryDelayMs,
  // repair cursor
  createRepairCursor,
  normalizeRepairCursor,
  advanceRepairCursor,
  shouldContinueRepair,
  resolveRepairPageSize,
  resolveRepairMaxPages,
  serializeRepairCursor,
  parseRepairCursor,
  summarizeRepairCursor,
  // scheduling
  createEmbeddingRepairSchedule,
  markEmbeddingOrphans,
  normalizeRepairSchedule,
  noteEmbeddingRepairRun,
  shouldRunEmbeddingRepair,
  // coverage
  describeEmbeddingCoverage,
  formatEmbeddingCoverage,
  // bounds
  EMBEDDING_BATCH_MAX,
  EMBEDDING_INPUT_MAX_CHARS,
  EMBEDDING_QUEUE_MAX,
  EMBEDDING_BREAKER_THRESHOLD,
  EMBEDDING_BREAKER_COOLDOWN_MS,
  EMBEDDING_RETRY_BASE_DELAY_MS,
  EMBEDDING_RETRY_MAX_DELAY_MS,
  REPAIR_PAGE_SIZE_DEFAULT,
  REPAIR_PAGE_SIZE_MAX,
  REPAIR_MAX_PAGES_DEFAULT,
  REPAIR_MAX_PAGES_MAX,
  REPAIR_MIN_INTERVAL_MS,
  REPAIR_SWEEP_INTERVAL_MS,
  type EmbeddableMemoryRow,
  type MemoryEmbeddingRepairCursor,
} from '../src/lib/memoryEmbeddingPolicyCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertDeep(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── fixtures ─────────────────────────────────────────────────────────────────
function memRow(over: Partial<EmbeddableMemoryRow> & { id?: unknown } = {}): EmbeddableMemoryRow {
  return { id: 'm-1', title: 'Deploy rule', content: 'Apply migrations before redeploying edges.', ...over };
}
const VECTOR_STR = '[0.0121,0.5512,-0.221]';

function elig(row?: unknown, opts?: unknown) {
  return evaluateEmbeddingEligibility(row as EmbeddableMemoryRow, opts as never);
}

function main(): void {
  // ══ 1. text normalization + input building ════════════════════════════════
  assertEq(normalizeEmbeddingText('  hello  '), 'hello', 'text: trims');
  assertEq(normalizeEmbeddingText(null), '', 'text(null) → ""');
  assertEq(normalizeEmbeddingText(undefined), '', 'text(undefined) → ""');
  assertEq(normalizeEmbeddingText(42), '42', 'text(number) → digits');
  assertEq(normalizeEmbeddingText(Number.NaN), '', 'text(NaN) → "" (never "NaN" in a paid embed call)');
  assertEq(normalizeEmbeddingText(Infinity), '', 'text(Infinity) → ""');
  assertEq(normalizeEmbeddingText({}), '', 'text(object) → ""');
  assertEq(normalizeEmbeddingText([1, 2]), '', 'text(array) → ""');
  assertEq(normalizeEmbeddingText(true), '', 'text(bool) → ""');
  assertEq(normalizeEmbeddingText('abc', 2), 'ab', 'text: explicit cap honored');
  assertEq(
    normalizeEmbeddingText('x'.repeat(EMBEDDING_INPUT_MAX_CHARS + 5000)).length,
    EMBEDDING_INPUT_MAX_CHARS,
    'text: bounded at EMBEDDING_INPUT_MAX_CHARS (bounds per-row spend)',
  );

  assertEq(buildEmbeddingInput({ title: 'T', content: 'C' }), 'T\nC', 'input: title\\ncontent');
  assertEq(buildEmbeddingInput({ title: '', content: 'C' }), 'C', 'input: no leading newline when title empty');
  assertEq(buildEmbeddingInput({ title: 'T', content: '' }), 'T', 'input: title-only');
  assertEq(buildEmbeddingInput({}), '', 'input: empty row → ""');
  assertEq(buildEmbeddingInput(null), '', 'input(null) → ""');
  assertEq(buildEmbeddingInput({ title: '   ', content: '  ' }), '', 'input: whitespace-only → ""');
  assert(
    buildEmbeddingInput({ title: 'T', content: 'y'.repeat(EMBEDDING_INPUT_MAX_CHARS * 2) }).length <= EMBEDDING_INPUT_MAX_CHARS,
    'input: combined text stays bounded',
  );

  assertEq(normalizeMemoryId('  abc  '), 'abc', 'id: trimmed');
  assertEq(normalizeMemoryId(''), '', 'id: empty → ""');
  assertEq(normalizeMemoryId(null), '', 'id(null) → ""');
  assertEq(normalizeMemoryId({}), '', 'id(object) → ""');
  assert(normalizeMemoryId('z'.repeat(400)).length <= 128, 'id: bounded');

  // ══ 2. hasStoredEmbedding — the "is this row already covered" predicate ════
  assertEq(hasStoredEmbedding(null), false, 'embedding(null) → false');
  assertEq(hasStoredEmbedding(undefined), false, 'embedding(undefined) → false');
  assertEq(hasStoredEmbedding(''), false, 'embedding("") → false');
  assertEq(hasStoredEmbedding('   '), false, 'embedding(blank) → false');
  assertEq(hasStoredEmbedding('[]'), false, 'embedding("[]") → false (empty pgvector text)');
  assertEq(hasStoredEmbedding('NULL'), false, 'embedding("NULL") → false');
  assertEq(hasStoredEmbedding([]), false, 'embedding([]) → false');
  assertEq(hasStoredEmbedding(VECTOR_STR), true, 'embedding(pgvector string) → true');
  assertEq(hasStoredEmbedding([0.1, 0.2]), true, 'embedding(array) → true');
  assertEq(hasStoredEmbedding(0), false, 'embedding(0) → false');
  assertEq(hasStoredEmbedding(false), false, 'embedding(false) → false');

  // ══ 3. eligibility — REGRESSION (1): never re-embed a covered row ═════════
  const fresh = memRow();
  const covered = memRow({ id: 'm-2', embedding: VECTOR_STR, embedding_model: 'text-embedding-3-small' });

  assertEq(elig(fresh).eligible, true, '[eligibility] null-embedding row IS eligible');
  assertEq(elig(fresh).reason, 'eligible', '[eligibility] reason=eligible');
  assertEq(elig(fresh).text, 'Deploy rule\nApply migrations before redeploying edges.', '[eligibility] carries the exact embed text');

  assertEq(elig(covered).eligible, false, '[REGRESSION 1] already-embedded row is NOT eligible');
  assertEq(elig(covered).reason, 'already_embedded', '[REGRESSION 1] reason=already_embedded');
  assertEq(elig(covered, {}).eligible, false, '[REGRESSION 1] empty options do not unlock re-embedding');
  assertEq(elig(covered, null).eligible, false, '[REGRESSION 1] null options do not unlock re-embedding');
  assertEq(
    elig(covered, { reembedOnModelChange: true, targetModel: 'text-embedding-3-small' }).eligible,
    false,
    '[REGRESSION 1] same model → still not eligible',
  );
  assertEq(
    elig(covered, { reembedOnModelChange: true }).eligible,
    false,
    '[REGRESSION 1] model-change opt-in without a target model does NOT re-embed',
  );
  assertEq(
    elig(memRow({ embedding: VECTOR_STR }), { reembedOnModelChange: true, targetModel: 'other-model' }).eligible,
    false,
    '[REGRESSION 1] unknown stored model does NOT re-embed (no model recorded → assume covered)',
  );
  // idempotency proof: 100 evaluations of a covered row, never once eligible
  let leaked = 0;
  for (let i = 0; i < 100; i += 1) if (elig(covered).eligible) leaked += 1;
  assertEq(leaked, 0, '[REGRESSION 1] repeated sweeps never re-bill a covered row');

  // the two legitimate re-embed doors, both explicit
  const reembed = elig(covered, { allowReembed: true });
  assertEq(reembed.eligible, true, '[eligibility] allowReembed (write path: content changed) IS eligible');
  assertEq(reembed.reason, 'content_changed', '[eligibility] reason=content_changed');
  const migrated = elig(covered, { reembedOnModelChange: true, targetModel: 'text-embedding-3-large' });
  assertEq(migrated.eligible, true, '[eligibility] model migration IS eligible');
  assertEq(migrated.reason, 'model_changed', '[eligibility] reason=model_changed');

  // skip reasons + their precedence
  assertEq(elig(memRow({ id: null })).reason, 'missing_id', '[eligibility] no id → missing_id');
  assertEq(elig(memRow({ id: '   ' })).reason, 'missing_id', '[eligibility] blank id → missing_id');
  assertEq(elig(memRow({ title: '', content: '' })).reason, 'empty_text', '[eligibility] no text → empty_text');
  assertEq(elig(memRow({ is_active: false })).reason, 'inactive', '[eligibility] inactive row skipped');
  assertEq(
    elig(memRow({ is_active: false }), { requireActive: false }).eligible,
    true,
    '[eligibility] requireActive:false embeds inactive rows',
  );
  assertEq(elig(memRow({ is_active: true })).eligible, true, '[eligibility] is_active true is fine');
  assertEq(
    elig(memRow({ id: null, title: '', content: '' })).reason,
    'missing_id',
    '[eligibility] id is checked before text (a row we cannot address is unfixable)',
  );
  assertEq(
    elig(memRow({ is_active: false, embedding: VECTOR_STR })).reason,
    'inactive',
    '[eligibility] inactive beats already_embedded',
  );
  assertEq(elig(null).reason, 'missing_id', '[eligibility] null row → missing_id');
  assertEq(elig(undefined).eligible, false, '[eligibility] undefined row not eligible');
  assertEq(elig('nope').eligible, false, '[eligibility] non-object row not eligible');

  // ══ 4. batch selection + bounds ═══════════════════════════════════════════
  const many: EmbeddableMemoryRow[] = Array.from({ length: 120 }, (_, i) => memRow({ id: `b-${String(i).padStart(3, '0')}` }));
  const sel = selectEmbeddingBatch(many);
  assertEq(sel.batch.length, EMBEDDING_BATCH_MAX, '[batch] capped at EMBEDDING_BATCH_MAX');
  assertEq(sel.remaining.length, 120 - EMBEDDING_BATCH_MAX, '[batch] overflow returned as remaining');
  assertEq(sel.truncated, true, '[batch] truncated flag set');
  assertEq(selectEmbeddingBatch(many, { maxBatchSize: 9999 }).batch.length, EMBEDDING_BATCH_MAX, '[batch] oversized request clamped');
  assertEq(selectEmbeddingBatch(many, { maxBatchSize: 0 }).batch.length, 1, '[batch] zero request clamped up to 1');
  assertEq(selectEmbeddingBatch(many, { maxBatchSize: -5 }).batch.length, 1, '[batch] negative request clamped up to 1');
  assertEq(selectEmbeddingBatch(many, { maxBatchSize: 7 }).batch.length, 7, '[batch] explicit size honored');
  assertEq(selectEmbeddingBatch(many, { maxBatchSize: Number.NaN }).batch.length, EMBEDDING_BATCH_MAX, '[batch] NaN size → default');

  // TWO-PASS RESUME EQUIVALENCE: overflow rows are returned UNEVALUATED, so
  // feeding `remaining` back in yields exactly the deferred work, in order.
  const mixed: EmbeddableMemoryRow[] = [];
  for (let i = 0; i < 30; i += 1) {
    mixed.push(memRow({ id: `x-${String(i).padStart(2, '0')}`, embedding: i % 3 === 0 ? VECTOR_STR : null }));
  }
  const expectedEligible = mixed
    .filter((r) => !hasStoredEmbedding(r.embedding))
    .map((r) => String(r.id));
  const p1 = selectEmbeddingBatch(mixed, { maxBatchSize: 5 });
  const p2 = selectEmbeddingBatch(p1.remaining, { maxBatchSize: 5 });
  const p3 = selectEmbeddingBatch(p2.remaining, { maxBatchSize: 50 });
  const walked = [...p1.batch, ...p2.batch, ...p3.batch].map((j) => j.id);
  assertDeep(walked, expectedEligible, '[batch] multi-pass walk == the full eligible list, in order, no gaps');
  assertEq(new Set(walked).size, walked.length, '[batch] multi-pass walk has no duplicates');
  assert(p1.skipped.every((s) => s.reason === 'already_embedded'), '[batch] covered rows land in skipped, not batch');
  assertEq(p3.truncated, false, '[batch] final pass is not truncated');

  // dedupe by id, including a caller-supplied in-flight set
  const dupes = [memRow({ id: 'd1' }), memRow({ id: 'd1' }), memRow({ id: 'd2' })];
  const dupeSel = selectEmbeddingBatch(dupes);
  assertEq(dupeSel.batch.length, 2, '[batch] duplicate ids collapse');
  assertEq(dupeSel.skipped[0]?.reason, 'duplicate_id', '[batch] duplicate reported as duplicate_id');
  assertEq(selectEmbeddingBatch(dupes, { seenIds: ['d1', 'd2'] }).batch.length, 0, '[batch] in-flight seenIds suppress re-dispatch');
  assertEq(selectEmbeddingBatch(dupes, { seenIds: 'nope' as never }).batch.length, 2, '[batch] junk seenIds ignored');

  assertDeep(selectEmbeddingBatch(null), { batch: [], skipped: [], remaining: [], truncated: false }, '[batch] null rows → empty selection');
  assertDeep(selectEmbeddingBatch('nope' as never).batch, [], '[batch] non-array rows → empty batch');
  assertEq(selectEmbeddingBatch([null, undefined, 5, 'str', memRow()] as never).batch.length, 1, '[batch] junk entries skipped, good row survives');

  // ══ 5. planEmbeddingBatches ═══════════════════════════════════════════════
  const items = Array.from({ length: 125 }, (_, i) => i);
  assertDeep(planEmbeddingBatches(items, 50).map((b) => b.length), [50, 50, 25], '[plan] chunks at 50');
  assertEq(planEmbeddingBatches(items, 9999).length, Math.ceil(125 / EMBEDDING_BATCH_MAX), '[plan] oversized chunk clamped');
  assertEq(planEmbeddingBatches(items, 0).length, 125, '[plan] zero chunk clamped to 1');
  assertDeep(planEmbeddingBatches([], 10), [], '[plan] empty → []');
  assertDeep(planEmbeddingBatches(null, 10), [], '[plan] null → []');
  assertDeep(planEmbeddingBatches('nope' as never, 10), [], '[plan] non-array → []');
  assertDeep(planEmbeddingBatches(items, 50).flat(), items, '[plan] flatten round-trips exactly (no dropped work)');
  assert(planEmbeddingBatches(items, 50).every((b) => b.length > 0), '[plan] never emits an empty chunk');

  // ══ 6. write-path queue: dedupe, order, bounded overflow ══════════════════
  const q0 = enqueueEmbeddingJobs([], [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }], { nowMs: 100 });
  assertEq(q0.added, 3, '[queue] three added');
  assertEq(q0.replaced, 0, '[queue] nothing replaced');
  assertDeep(q0.queue.map((i) => i.id), ['a', 'b', 'c'], '[queue] FIFO order preserved');

  const q1 = enqueueEmbeddingJobs(q0.queue, [{ id: 'a', text: 'A-EDITED' }], { nowMs: 200 });
  assertEq(q1.added, 0, '[queue] re-saving the same row adds nothing');
  assertEq(q1.replaced, 1, '[queue] re-saving replaces in place');
  assertEq(q1.queue.length, 3, '[queue] no duplicate row queued');
  assertEq(q1.queue[0].id, 'a', '[queue] replaced item keeps its ORIGINAL position (deterministic drains)');
  assertEq(q1.queue[0].text, 'A-EDITED', '[queue] LATEST text wins (never embed stale content)');
  assertEq(q1.queue[0].enqueuedAtMs, 100, '[queue] original enqueue time retained');

  const junkQ = enqueueEmbeddingJobs([], [{ id: '', text: 'x' }, { id: 'z', text: '' }, null, 5, { id: 'ok', text: 'y' }] as never, { nowMs: 1 });
  assertEq(junkQ.added, 1, '[queue] only the usable job is queued');
  assertEq(junkQ.rejected, 4, '[queue] unusable jobs counted as rejected, never queued');

  // overflow drops the OLDEST — and the dropped row is still sweep-eligible
  const overflow = enqueueEmbeddingJobs(
    [],
    Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, text: `t${i}` })),
    { maxSize: 3, nowMs: 5 },
  );
  assertDeep(overflow.dropped, ['o0', 'o1'], '[queue] overflow evicts oldest first');
  assertDeep(overflow.queue.map((i) => i.id), ['o2', 'o3', 'o4'], '[queue] newest survive the cap');
  assertEq(
    elig(memRow({ id: 'o0', embedding: null })).eligible,
    true,
    '[queue] an EVICTED row is still `embedding IS NULL` → the repair sweep will find it (no data reachability lost)',
  );
  assertEq(
    enqueueEmbeddingJobs([], Array.from({ length: EMBEDDING_QUEUE_MAX + 10 }, (_, i) => ({ id: `q${i}`, text: 't' })), { maxSize: 99999 }).queue.length,
    EMBEDDING_QUEUE_MAX,
    '[queue] hard cap at EMBEDDING_QUEUE_MAX even when the caller asks for more',
  );

  const taken = takeEmbeddingBatch(q1.queue, 2);
  assertDeep(taken.batch.map((i) => i.id), ['a', 'b'], '[queue] take pulls from the front');
  assertDeep(taken.queue.map((i) => i.id), ['c'], '[queue] take returns the rest');
  assertDeep(takeEmbeddingBatch([], 5), { batch: [], queue: [] }, '[queue] take from empty → empty');
  assertDeep(takeEmbeddingBatch(null), { batch: [], queue: [] }, '[queue] take(null) → empty');
  assertEq(takeEmbeddingBatch(q0.queue, 9999).batch.length, 3, '[queue] take size clamped to available');

  // ══ 7. circuit breaker — legacy semantics, preserved ══════════════════════
  const T0 = 1_700_000_000_000;
  let breaker = createEmbeddingBreakerState();
  assertDeep(breaker, { consecutiveFailures: 0, lastFailureAtMs: 0 }, '[breaker] starts closed');
  assertEq(isEmbeddingBreakerOpen(breaker, T0), false, '[breaker] fresh state is closed');

  for (let i = 0; i < EMBEDDING_BREAKER_THRESHOLD - 1; i += 1) breaker = recordEmbeddingFailure(breaker, T0);
  assertEq(breaker.consecutiveFailures, EMBEDDING_BREAKER_THRESHOLD - 1, '[breaker] counts failures');
  assertEq(isEmbeddingBreakerOpen(breaker, T0), false, '[breaker] below threshold stays closed');

  breaker = recordEmbeddingFailure(breaker, T0);
  assertEq(isEmbeddingBreakerOpen(breaker, T0), true, `[breaker] opens at ${EMBEDDING_BREAKER_THRESHOLD} consecutive failures`);
  assertEq(isEmbeddingBreakerOpen(breaker, T0 + EMBEDDING_BREAKER_COOLDOWN_MS - 1), true, '[breaker] still open 1ms before cooldown ends');
  assertEq(isEmbeddingBreakerOpen(breaker, T0 + EMBEDDING_BREAKER_COOLDOWN_MS), false, '[breaker] closes exactly at cooldown');
  assertEq(isEmbeddingBreakerOpen(breaker, T0 - 60_000), false, '[breaker] a BACKWARDS clock cannot wedge it open (documented, safer-direction deviation)');

  const status = describeEmbeddingBreaker(breaker, T0 + 1000);
  assertEq(status.open, true, '[breaker] status.open');
  assertEq(status.retryAtMs, T0 + EMBEDDING_BREAKER_COOLDOWN_MS, '[breaker] retryAtMs = lastFailure + cooldown');
  assertEq(status.remainingMs, EMBEDDING_BREAKER_COOLDOWN_MS - 1000, '[breaker] remainingMs counts down');
  assertEq(describeEmbeddingBreaker(breaker, T0 + EMBEDDING_BREAKER_COOLDOWN_MS).remainingMs, 0, '[breaker] remainingMs 0 once closed');
  assertEq(describeEmbeddingBreaker(breaker, T0 + EMBEDDING_BREAKER_COOLDOWN_MS).retryAtMs, 0, '[breaker] retryAtMs 0 once closed');

  const healed = recordEmbeddingSuccess(breaker);
  assertDeep(healed, { consecutiveFailures: 0, lastFailureAtMs: 0 }, '[breaker] one success fully resets (legacy behavior)');
  assertEq(isEmbeddingBreakerOpen(healed, T0), false, '[breaker] closed after reset');
  assert(breaker.consecutiveFailures === EMBEDDING_BREAKER_THRESHOLD, '[breaker] transitions are immutable (input untouched)');

  assertEq(computeEmbeddingRetryDelayMs(0), 0, '[backoff] attempt 0 → 0');
  assertEq(computeEmbeddingRetryDelayMs(-3), 0, '[backoff] negative → 0');
  assertEq(computeEmbeddingRetryDelayMs(1), EMBEDDING_RETRY_BASE_DELAY_MS, '[backoff] attempt 1 → base');
  assertEq(computeEmbeddingRetryDelayMs(2), EMBEDDING_RETRY_BASE_DELAY_MS * 2, '[backoff] doubles');
  assertEq(computeEmbeddingRetryDelayMs(99), EMBEDDING_RETRY_MAX_DELAY_MS, '[backoff] capped');
  assertEq(computeEmbeddingRetryDelayMs(4), computeEmbeddingRetryDelayMs(4), '[backoff] deterministic (no jitter/randomness)');
  assertEq(computeEmbeddingRetryDelayMs(Number.NaN), 0, '[backoff] NaN → 0');

  // ══ 8. repair cursor — REGRESSION (2): strictly monotonic, terminating ════
  let cur = createRepairCursor(T0);
  assertEq(cur.lastId, null, '[cursor] starts at the beginning');
  assertEq(cur.done, false, '[cursor] starts not-done');

  cur = advanceRepairCursor(cur, { rowIds: ['a', 'b', 'c'], requestedPageSize: 3, embedded: 3 }, T0 + 1);
  assertEq(cur.lastId, 'c', '[cursor] advances to the last id of the page');
  assertEq(cur.scanned, 3, '[cursor] counts scanned');
  assertEq(cur.embedded, 3, '[cursor] counts embedded');
  assertEq(cur.pagesDone, 1, '[cursor] counts pages');
  assertEq(cur.done, false, '[cursor] a FULL page means there may be more');

  const backwards = advanceRepairCursor(cur, { rowIds: ['a'], requestedPageSize: 3 }, T0 + 2);
  assertEq(backwards.lastId, 'c', '[REGRESSION 2] cursor NEVER moves backwards (a replayed page cannot loop the sweep)');
  assertEq(advanceRepairCursor(cur, { rowIds: ['b', 'z', 'd'], requestedPageSize: 3 }, T0 + 3).lastId, 'z', '[cursor] takes the max id even if the page is unordered');
  assertEq(advanceRepairCursor(cur, { rowIds: ['x', 'y'], requestedPageSize: 3 }, T0 + 4).done, true, '[cursor] a SHORT page ends the sweep');
  assertEq(advanceRepairCursor(cur, { rowIds: [], requestedPageSize: 3 }, T0 + 5).done, true, '[cursor] an EMPTY page ends the sweep');
  assertEq(advanceRepairCursor(cur, { rowIds: [null, 5, {}, 'ok'] } as never, T0 + 6).scanned, 3 + 2, '[cursor] unusable ids (null/object) are dropped, coercible ones counted');
  assertEq(advanceRepairCursor(cur, { rowIds: [null, 5, {}] } as never, T0 + 6).lastId, 'c', '[cursor] junk ids never become the cursor key');
  assertEq(advanceRepairCursor(null, null, T0).done, true, '[cursor] advance(null,null) → done, never throws');
  assertEq(advanceRepairCursor(cur, { rowIds: ['d'], requestedPageSize: 3, failed: 1 }, T0 + 7).failed, 1, '[cursor] counts failures');
  assertEq(advanceRepairCursor(cur, { rowIds: ['d'], requestedPageSize: 3, skipped: 2 }, T0 + 7).skipped, 2, '[cursor] counts skips');
  assertEq(advanceRepairCursor(cur, { rowIds: ['d'], failed: -9 } as never, T0 + 7).failed, 0, '[cursor] negative counters clamped');
  assertEq(cur.pagesDone, 1, '[cursor] advance is immutable (input untouched)');

  // FULL-TABLE WALK, every row visited exactly once, loop terminates.
  const tableIds = Array.from({ length: 23 }, (_, i) => `id-${String(i).padStart(3, '0')}`);
  const fetchNullEmbeddingPage = (lastId: string | null, size: number): string[] =>
    tableIds.filter((id) => lastId === null || id > lastId).slice(0, size);

  const walkTable = (start: MemoryEmbeddingRepairCursor, allFail: boolean) => {
    let c = start;
    const seen: string[] = [];
    let guard = 0;
    while (shouldContinueRepair(c, { maxPages: 100 }).continue && guard < 100) {
      guard += 1;
      const page = fetchNullEmbeddingPage(c.lastId, 5);
      seen.push(...page);
      c = advanceRepairCursor(
        c,
        { rowIds: page, requestedPageSize: 5, embedded: allFail ? 0 : page.length, failed: allFail ? page.length : 0 },
        T0 + guard,
      );
    }
    return { cursor: c, seen, guard };
  };

  const failWalk = walkTable(createRepairCursor(T0), true);
  assertDeep(failWalk.seen, tableIds, '[REGRESSION 2] 100%-FAILING sweep still visits every row exactly once, in order');
  assertEq(new Set(failWalk.seen).size, failWalk.seen.length, '[REGRESSION 2] no row is re-fetched (the old null-refetch infinite loop)');
  assertEq(failWalk.cursor.done, true, '[REGRESSION 2] sweep TERMINATES even when nothing can be embedded');
  assertEq(failWalk.cursor.failed, 23, '[REGRESSION 2] all 23 recorded as failed');
  assertEq(failWalk.guard, 5, '[REGRESSION 2] 23 rows / 5 per page = 5 pages, not an unbounded loop');

  const okWalk = walkTable(createRepairCursor(T0), false);
  assertEq(okWalk.cursor.embedded, 23, '[cursor] successful sweep embeds all 23');
  assertEq(okWalk.cursor.scanned, 23, '[cursor] scanned == table size');

  // RESUME ACROSS SESSIONS: serialize mid-sweep, reload, finish the rest.
  let partial = createRepairCursor(T0);
  const firstHalf: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const page = fetchNullEmbeddingPage(partial.lastId, 5);
    firstHalf.push(...page);
    partial = advanceRepairCursor(partial, { rowIds: page, requestedPageSize: 5, embedded: page.length }, T0 + i);
  }
  const wire = serializeRepairCursor(partial);
  const revived = parseRepairCursor(wire);
  assert(revived !== null, '[resume] serialized cursor parses back');
  assertDeep(revived, partial, '[resume] round-trip is lossless');
  const resumed = walkTable(revived as MemoryEmbeddingRepairCursor, false);
  assertDeep([...firstHalf, ...resumed.seen], tableIds, '[resume] resumed sweep covers exactly the rows the first session had not reached');
  assertEq(new Set([...firstHalf, ...resumed.seen]).size, 23, '[resume] no row embedded twice across a resume (no double spend)');
  assertEq(resumed.cursor.done, true, '[resume] resumed sweep completes');

  // A SECOND sweep after full coverage does nothing — safe to run repeatedly.
  const emptyTablePage: string[] = [];
  const rerun = advanceRepairCursor(createRepairCursor(T0), { rowIds: emptyTablePage, requestedPageSize: 5 }, T0);
  assertEq(rerun.done, true, '[resume] re-running after full coverage finds nothing and stops immediately');
  assertEq(rerun.embedded, 0, '[resume] re-run spends nothing');

  // ══ 9. shouldContinueRepair guards ═══════════════════════════════════════
  const midCursor = advanceRepairCursor(createRepairCursor(T0), { rowIds: ['a', 'b'], requestedPageSize: 2 }, T0);
  assertEq(shouldContinueRepair(midCursor, { maxPages: 5 }).continue, true, '[guard] mid-sweep continues');
  assertEq(shouldContinueRepair(midCursor, { maxPages: 1 }).reason, 'max_pages', '[guard] page budget stops the pass');
  assertEq(shouldContinueRepair(midCursor, { maxPages: 5, maxRows: 2 }).reason, 'max_rows', '[guard] row budget stops the pass');
  assertEq(shouldContinueRepair(midCursor, { maxPages: 5, maxRows: 3 }).continue, true, '[guard] under the row budget continues');
  assertEq(shouldContinueRepair(midCursor, { maxPages: 5, deadlineMs: T0, nowMs: T0 + 1 }).reason, 'deadline', '[guard] deadline stops the pass');
  assertEq(shouldContinueRepair(midCursor, { maxPages: 5, breakerOpen: true }).reason, 'breaker_open', '[guard] open breaker stops the pass (a sweep would only burn reads)');
  assertEq(shouldContinueRepair({ ...midCursor, done: true }, { maxPages: 5 }).reason, 'done', '[guard] done wins over everything');
  assertEq(shouldContinueRepair(null).continue, true, '[guard] null cursor behaves like a fresh one');
  assertEq(shouldContinueRepair(midCursor, { maxPages: 99999 }).continue, true, '[guard] oversized page budget clamped, still continues');

  assertEq(resolveRepairPageSize(undefined), REPAIR_PAGE_SIZE_DEFAULT, '[bounds] default page size');
  assertEq(resolveRepairPageSize(99999), REPAIR_PAGE_SIZE_MAX, '[bounds] page size capped');
  assertEq(resolveRepairPageSize(0), 1, '[bounds] page size floored at 1');
  assertEq(resolveRepairPageSize('nope'), REPAIR_PAGE_SIZE_DEFAULT, '[bounds] junk page size → default');
  assertEq(resolveRepairMaxPages(undefined), REPAIR_MAX_PAGES_DEFAULT, '[bounds] default max pages');
  assertEq(resolveRepairMaxPages(99999), REPAIR_MAX_PAGES_MAX, '[bounds] max pages capped');
  assertEq(resolveRepairMaxPages(-1), 1, '[bounds] max pages floored at 1');

  assertEq(parseRepairCursor(''), null, '[cursor] parse("") → null');
  assertEq(parseRepairCursor(null), null, '[cursor] parse(null) → null');
  assertEq(parseRepairCursor('not json'), null, '[cursor] parse(garbage) → null');
  assertEq(parseRepairCursor('[1,2]'), null, '[cursor] parse(array) → null');
  assertEq(parseRepairCursor('{}'), null, '[cursor] parse(versionless) → null');
  assertEq(parseRepairCursor('{"v":999,"lastId":"x"}'), null, '[cursor] parse(wrong version) → null — a format change restarts cleanly');
  assertEq(typeof summarizeRepairCursor(partial), 'string', '[cursor] summary is a string');
  assert(summarizeRepairCursor(null).length > 0, '[cursor] summary(null) still readable');
  assertDeep(normalizeRepairCursor(undefined, 7), createRepairCursor(7), '[cursor] normalize(undefined) === fresh');
  assertEq(normalizeRepairCursor({ lastId: 42, pagesDone: -3, done: 'yes' }, 0).lastId, '42', '[cursor] normalize coerces hostile fields');
  assertEq(normalizeRepairCursor({ done: 'yes' }, 0).done, false, '[cursor] only a real `true` marks done');

  // ══ 10. REGRESSION (3): breaker-open orphans become repairable ════════════
  // The exact historical failure: rows saved during a proxy outage got a null
  // embedding and were never retried. Walk the whole recovery.
  let schedule = createEmbeddingRepairSchedule();
  let outage = createEmbeddingBreakerState();
  for (let i = 0; i < EMBEDDING_BREAKER_THRESHOLD; i += 1) outage = recordEmbeddingFailure(outage, T0);

  schedule = markEmbeddingOrphans(schedule, 12, T0);
  assertEq(schedule.orphanCount, 12, '[REGRESSION 3] orphan ledger records the rows written during the outage');
  assertEq(schedule.repairOwed, true, '[REGRESSION 3] repair is owed');

  const duringOutage = shouldRunEmbeddingRepair({ schedule, breaker: outage, nowMs: T0 + 1000 });
  assertEq(duringOutage.run, false, '[REGRESSION 3] no sweep while the breaker is open');
  assertEq(duringOutage.reason, 'breaker_open', '[REGRESSION 3] and it says why');
  assertEq(duringOutage.waitMs, EMBEDDING_BREAKER_COOLDOWN_MS - 1000, '[REGRESSION 3] reports exactly how long to wait');

  const forcedDuringOutage = shouldRunEmbeddingRepair({ schedule, breaker: outage, nowMs: T0 + 1000, force: true });
  assertEq(forcedDuringOutage.reason, 'breaker_open', '[REGRESSION 3] even force respects an open breaker (every embed call would return null)');

  const afterOutage = shouldRunEmbeddingRepair({ schedule, breaker: outage, nowMs: T0 + EMBEDDING_BREAKER_COOLDOWN_MS });
  assertEq(afterOutage.run, true, '[REGRESSION 3] the moment the breaker closes, the sweep fires');
  assertEq(afterOutage.reason, 'orphans_pending', '[REGRESSION 3] fired BECAUSE orphans are still owed — the debt survived the outage');

  const T1 = T0 + EMBEDDING_BREAKER_COOLDOWN_MS;
  schedule = noteEmbeddingRepairRun(schedule, T1, { clearedOrphans: true });
  assertEq(schedule.orphanCount, 0, '[REGRESSION 3] a completed sweep clears the orphan debt');
  assertEq(schedule.repairOwed, false, '[REGRESSION 3] and clears the owed flag');

  assertEq(shouldRunEmbeddingRepair({ schedule, nowMs: T1 + 1000 }).reason, 'cooling_down', '[schedule] min interval prevents sweep spam');
  assertEq(shouldRunEmbeddingRepair({ schedule, nowMs: T1 + 1000 }).waitMs, REPAIR_MIN_INTERVAL_MS - 1000, '[schedule] reports the remaining cooldown');
  assertEq(shouldRunEmbeddingRepair({ schedule, nowMs: T1 + 1000, force: true }).reason, 'forced', '[schedule] force overrides the cooldown (manual/script runs)');
  assertEq(shouldRunEmbeddingRepair({ schedule, nowMs: T1 + REPAIR_MIN_INTERVAL_MS }).reason, 'idle', '[schedule] nothing owed → idle, not a sweep');
  assertEq(shouldRunEmbeddingRepair({ schedule, nowMs: T1 + REPAIR_SWEEP_INTERVAL_MS }).reason, 'due', '[schedule] periodic re-sweep eventually becomes due');
  assertEq(shouldRunEmbeddingRepair({ schedule, nowMs: T1 + REPAIR_SWEEP_INTERVAL_MS }).run, true, '[schedule] and it runs');

  // a partial sweep must NOT clear the debt
  let partialDebt = markEmbeddingOrphans(createEmbeddingRepairSchedule(), 5, T0);
  partialDebt = noteEmbeddingRepairRun(partialDebt, T0, { clearedOrphans: false });
  assertEq(partialDebt.orphanCount, 5, '[schedule] an incomplete sweep keeps the orphan debt');
  assertEq(partialDebt.repairOwed, true, '[schedule] and stays owed');
  assertEq(shouldRunEmbeddingRepair({ schedule: partialDebt, nowMs: T0 + REPAIR_MIN_INTERVAL_MS }).reason, 'orphans_pending', '[schedule] so it will be retried');

  assertEq(shouldRunEmbeddingRepair({ nowMs: T0 }).reason, 'first_run', '[schedule] a fresh session sweeps once (catches every historical orphan)');
  assertEq(shouldRunEmbeddingRepair().run, true, '[schedule] no options at all still resolves to a first run, never throws');
  assertEq(markEmbeddingOrphans(schedule, 0, T0).repairOwed, false, '[schedule] zero orphans does not arm a sweep');
  assertEq(markEmbeddingOrphans(null, 3, T0).orphanCount, 3, '[schedule] mark(null) starts a fresh ledger');
  assertEq(markEmbeddingOrphans(schedule, -5, T0).orphanCount, 0, '[schedule] negative orphan count ignored');
  assertDeep(normalizeRepairSchedule(undefined), createEmbeddingRepairSchedule(), '[schedule] normalize(undefined) === fresh');
  assertEq(normalizeRepairSchedule({ orphanCount: 'x', lastRepairAtMs: 'y', repairOwed: 1 } as never).orphanCount, 0, '[schedule] hostile fields coerced');

  // ══ 11. coverage math ════════════════════════════════════════════════════
  const cov = describeEmbeddingCoverage({ total: 400, embedded: 100 });
  assertEq(cov.missing, 300, '[coverage] missing = total - embedded');
  assertEq(cov.pct, 0.25, '[coverage] pct');
  assertEq(cov.healthy, false, '[coverage] not healthy while rows are missing');
  assertEq(describeEmbeddingCoverage({ total: 0, embedded: 0 }).pct, 1, '[coverage] empty table is vacuously covered');
  assertEq(describeEmbeddingCoverage({ total: 0, embedded: 0 }).healthy, true, '[coverage] and healthy');
  assertEq(describeEmbeddingCoverage({ total: 10, embedded: 99 }).embedded, 10, '[coverage] embedded clamped to total');
  assertEq(describeEmbeddingCoverage({ total: -5, embedded: -5 }).total, 0, '[coverage] negatives clamped');
  assertEq(describeEmbeddingCoverage(null).total, 0, '[coverage] null → zeroed');
  assertEq(describeEmbeddingCoverage({ total: 3, embedded: 1 }).pct, 0.3333, '[coverage] pct rounded deterministically to 4dp');
  assert(formatEmbeddingCoverage(cov).includes('300 missing'), '[coverage] format names the gap', formatEmbeddingCoverage(cov));
  assert(formatEmbeddingCoverage(null).length > 0, '[coverage] format(null) still readable');

  // ══ 12. determinism ══════════════════════════════════════════════════════
  assertDeep(elig(fresh), elig(fresh), '[determinism] eligibility');
  assertDeep(selectEmbeddingBatch(mixed, { maxBatchSize: 5 }), selectEmbeddingBatch(mixed, { maxBatchSize: 5 }), '[determinism] batch selection');
  assertDeep(
    enqueueEmbeddingJobs(q0.queue, [{ id: 'z', text: 'Z' }], { nowMs: 9 }),
    enqueueEmbeddingJobs(q0.queue, [{ id: 'z', text: 'Z' }], { nowMs: 9 }),
    '[determinism] queue',
  );
  assertDeep(
    advanceRepairCursor(cur, { rowIds: ['q', 'r'], requestedPageSize: 5 }, T0),
    advanceRepairCursor(cur, { rowIds: ['q', 'r'], requestedPageSize: 5 }, T0),
    '[determinism] cursor advance',
  );
  assertDeep(
    shouldRunEmbeddingRepair({ schedule, breaker: outage, nowMs: T0 }),
    shouldRunEmbeddingRepair({ schedule, breaker: outage, nowMs: T0 }),
    '[determinism] repair decision',
  );
  assertEq(serializeRepairCursor(partial), serializeRepairCursor(partial), '[determinism] serialization');

  // ══ 13. degenerate / hostile sweep ═══════════════════════════════════════
  try {
    const throwing = {
      id: 'th',
      get title() { throw new Error('boom'); },
      get content() { throw new Error('boom'); },
      get embedding() { throw new Error('boom'); },
    };
    assertEq(elig(throwing).eligible, false, '[hostile] throwing getters tolerated → not eligible');
    assertEq(elig(throwing).reason, 'empty_text', '[hostile] throwing getters read as empty text');

    const cyclic: Record<string, unknown> = { id: 'cy', title: 't', content: 'c' };
    cyclic.self = cyclic;
    assertEq(elig(cyclic).eligible, true, '[hostile] cyclic row tolerated');
    assertEq(serializeRepairCursor({ ...createRepairCursor(0) }).length > 0, true, '[hostile] serialize survives spread cursors');

    assertEq(selectEmbeddingBatch([throwing] as never).batch.length, 0, '[hostile] throwing row never enters a batch');
    assertEq(enqueueEmbeddingJobs(('nope' as never), ('nope' as never)).queue.length, 0, '[hostile] junk queue inputs → empty queue');
    assertEq(takeEmbeddingBatch([{ id: '', text: '' }] as never).batch.length, 0, '[hostile] unusable queue items never dispatched');
    assertEq(describeEmbeddingBreaker(null, Number.NaN).open, false, '[hostile] NaN clock → breaker closed');
    assertEq(recordEmbeddingFailure(null, Number.NaN).consecutiveFailures, 1, '[hostile] failure on a null state still counts');
    assertEq(recordEmbeddingFailure({ consecutiveFailures: -4, lastFailureAtMs: 0 }, 0).consecutiveFailures, 1, '[hostile] negative failure count repaired');
    assertEq(shouldRunEmbeddingRepair({ schedule: 'nope' as never, nowMs: Number.NaN }).run, true, '[hostile] junk schedule → safe first_run');
    assertEq(advanceRepairCursor('nope' as never, 'nope' as never, Number.NaN).done, true, '[hostile] junk advance → done, no throw');
    assertEq(planEmbeddingBatches([1, 2, 3], Number.NaN).length, 1, '[hostile] NaN chunk size → one default-sized chunk');

    const huge = 'h'.repeat(300000);
    assert(buildEmbeddingInput({ title: huge, content: huge }).length <= EMBEDDING_INPUT_MAX_CHARS, '[hostile] 300k-char row stays bounded');
    assert(selectEmbeddingBatch(Array.from({ length: 5000 }, (_, i) => memRow({ id: `h${i}` }))).batch.length === EMBEDDING_BATCH_MAX, '[hostile] 5000-row input stays bounded');

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: [HOSTILE] sweep threw: ${(e as Error)?.message}`);
  }

  // ══ 14. bounds sanity (documented invariants) ════════════════════════════
  assert(EMBEDDING_BATCH_MAX > 0 && EMBEDDING_BATCH_MAX <= 100, '[bounds] batch max sane');
  assert(EMBEDDING_QUEUE_MAX >= EMBEDDING_BATCH_MAX, '[bounds] queue holds at least one full batch');
  assertEq(EMBEDDING_BREAKER_THRESHOLD, 5, '[bounds] breaker threshold unchanged from the legacy runtime');
  assertEq(EMBEDDING_BREAKER_COOLDOWN_MS, 5 * 60 * 1000, '[bounds] breaker cooldown unchanged from the legacy runtime');
  assertEq(EMBEDDING_INPUT_MAX_CHARS, 30000, '[bounds] per-row input cap unchanged from the legacy runtime');
  assert(REPAIR_PAGE_SIZE_DEFAULT <= REPAIR_PAGE_SIZE_MAX, '[bounds] default page size within cap');
  assert(REPAIR_MAX_PAGES_DEFAULT <= REPAIR_MAX_PAGES_MAX, '[bounds] default page budget within cap');
  assert(REPAIR_PAGE_SIZE_DEFAULT * REPAIR_MAX_PAGES_DEFAULT <= 5000, '[bounds] one automatic pass can never scan an unbounded table');
  assert(REPAIR_MIN_INTERVAL_MS >= EMBEDDING_BREAKER_COOLDOWN_MS, '[bounds] sweeps cannot retry faster than the breaker heals');
  assert(REPAIR_SWEEP_INTERVAL_MS > REPAIR_MIN_INTERVAL_MS, '[bounds] idle re-sweep is rarer than the floor');
  assert(EMBEDDING_RETRY_MAX_DELAY_MS > EMBEDDING_RETRY_BASE_DELAY_MS, '[bounds] backoff cap above base');

  // ══ 15. runtime wiring around credential failure + resumed cursors ═══════
  // The decision core is pure; these source contracts cover the I/O owner that
  // must apply those decisions without issuing another doomed proxy request or
  // presenting cumulative persisted counters as work from the current pass.
  const runtimeSource = readFileSync(resolve(process.cwd(), 'src/lib/memoryEmbeddings.ts'), 'utf8');
  assert(
    /hasUsableEmbeddingCredential\(\)[\s\S]{0,160}reason:\s*'credential_unavailable'/.test(runtimeSource),
    '[runtime] ensure skips repair while the exact credential gate is closed',
  );
  assert(
    /retryingOrphans\s*=\s*repairSchedule\.repairOwed\s*\|\|\s*repairSchedule\.orphanCount\s*>\s*0/.test(runtimeSource)
      && runtimeSource.includes('const resume = !retryingOrphans;')
      && /maxRows:\s*opts\?\.maxRows,\s*\n\s*resume,/.test(runtimeSource),
    '[runtime] orphan debt forces a fresh cursor instead of skipping lower-id rows',
  );
  assert(
    runtimeSource.includes('embeddedThisPass')
      && runtimeSource.includes('failedThisPass')
      && runtimeSource.includes('this pass —'),
    '[runtime] repair logs current-pass deltas instead of persisted cumulative totals',
  );
  assert(
    /if\s*\(credentialInterrupted\)[\s\S]{0,180}credential_unavailable[\s\S]{0,80}break;/.test(runtimeSource),
    '[runtime] a mid-page credential failure stops before advancing the repair cursor',
  );
  assert(
    runtimeSource.includes("EMBEDDING_CREDENTIAL_BLOCK_STORAGE_KEY = 'uc_memory_embedding_credential_block_v1'")
      && /fingerprint\s*=\s*`\$\{String\(activeKey\.id\)\}:\$\{String\(activeKey\.updated_at/.test(runtimeSource)
      && runtimeSource.includes('storage.setItem(EMBEDDING_CREDENTIAL_BLOCK_STORAGE_KEY'),
    '[runtime] an unreadable exact key version stays blocked across reloads',
  );
  assert(
    runtimeSource.indexOf("supabase.rpc('list_user_api_keys')")
      < runtimeSource.indexOf("supabase.functions.invoke('llm-proxy'"),
    '[runtime] credential metadata preflight occurs before the embedding proxy request',
  );
  assert(
    runtimeSource.includes('subscribeUserApiKeyChanges(resetEmbeddingCredentialGateAfterKeyChange)')
      && runtimeSource.includes('armEmbeddingCredentialRepair(EMBEDDING_COALESCE_MS)'),
    '[runtime] a same-runtime key rotation clears the block and re-arms repair immediately',
  );
  assert(
    runtimeSource.includes('let embeddingCredentialRepairTimer:')
      && /function\s+startCredentialUnavailableCooldown[\s\S]{0,900}armEmbeddingCredentialRepair/.test(runtimeSource)
      && !/function\s+startCredentialUnavailableCooldown[\s\S]{0,900}armTimer\s*\(/.test(runtimeSource),
    '[runtime] credential recovery uses a separate timer and cannot wedge the write queue',
  );

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll memory-embedding-policy-core smoke cases passed (${passes} passed).`);
}

main();
