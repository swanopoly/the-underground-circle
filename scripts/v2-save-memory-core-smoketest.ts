/**
 * v2-save-memory-core-smoketest — the PURE dedupe/provenance decision layer
 * behind `save_memory` in the swanbot-v2-ai edge function
 * (src/lib/v2SaveMemoryCore.ts).
 *
 * WHAT THIS GUARDS (four verified defects in the v2 handler):
 *   1. UNCONDITIONAL INSERT — v2 always inserted while v1 does fetch-then-
 *      update, so repeated agent saves grew circle memory forever. The fix
 *      UPDATEs in place, which is IRREVERSIBLE (no history row) — hence the
 *      heavy bias below.
 *   2. `source_run_id` never set → no memory traceable to its run.
 *   3. `source_surface` hardcoded 'main_chat' → provenance actively wrong.
 *   4. `scope` hardcoded 'circle' → nothing agent-scoped ever written.
 *
 * THE BIAS UNDER TEST — AMBIGUOUS ⇒ NOT A DUPLICATE. A missed duplicate costs
 * one extra row. A wrong duplicate destroys the user's text forever. Every
 * ambiguous case here must resolve to INSERT: topic-word overlap, a title
 * collision with unrelated bodies, a prefix-only (truncated) comparison,
 * containment at the ratio floor, a foreign/missing agent id, a candidate with
 * no id, a failed scan.
 *
 * DIFFERENTIAL GUARD: v2SaveMemoryCore restates memoryDedupeCore's scorer and
 * thresholds because Deno (the edge runtime) resolves the whole module graph
 * and memoryDedupeCore carries an extensionless `import type`. This smoke
 * imports BOTH and asserts they agree. If you tune one, tune the other — do
 * not loosen these assertions.
 *
 * Pure — loads under tsx (all three modules are dependency-light).
 *   npx tsx scripts/v2-save-memory-core-smoketest.ts
 */

import {
  MAX_AGENT_ID_CHARS,
  MAX_COMPARE_CHARS,
  MAX_DEDUPE_CANDIDATES,
  MAX_MEMORY_CONTENT_CHARS,
  MAX_MEMORY_TITLE_CHARS,
  MAX_TOKENS_PER_SIDE,
  CONTAINMENT_MIN_CHARS,
  CONTAINMENT_MIN_LENGTH_RATIO,
  DUPLICATE_CONTENT_THRESHOLD,
  DUPLICATE_TITLE_THRESHOLD,
  TITLE_MATCH_CONTENT_FLOOR,
  TRUNCATED_SCORE_CEILING,
  V2_MEMORY_KINDS,
  V2_SAVE_MEMORY_SOURCE_SURFACE,
  normalizeSourceRunId,
  normalizeUpdatedAt,
  normalizeV2MemoryKind,
  pickV2DuplicateMemory,
  planV2SaveMemoryWrite,
  resolveV2MemoryAgentId,
  resolveV2MemoryLane,
  v2MemoryImportance,
  v2MemorySimilarityScore,
  type V2MemoryCandidate,
  type V2SaveMemoryInsertRow,
  type V2SaveMemoryPlanInput,
  type V2SaveMemoryUpdatePatch,
} from '../src/lib/v2SaveMemoryCore';
import {
  memorySimilarityScore,
  pickDuplicateMemory,
  CONTAINMENT_MIN_CHARS as DEDUPE_CONTAINMENT_MIN_CHARS,
  CONTAINMENT_MIN_LENGTH_RATIO as DEDUPE_CONTAINMENT_MIN_LENGTH_RATIO,
  DUPLICATE_CONTENT_THRESHOLD as DEDUPE_CONTENT_THRESHOLD,
  DUPLICATE_TITLE_THRESHOLD as DEDUPE_TITLE_THRESHOLD,
  MAX_COMPARE_CHARS as DEDUPE_MAX_COMPARE_CHARS,
  MAX_TOKENS_PER_SIDE as DEDUPE_MAX_TOKENS_PER_SIDE,
  TITLE_MATCH_CONTENT_FLOOR as DEDUPE_TITLE_MATCH_CONTENT_FLOOR,
  TRUNCATED_SCORE_CEILING as DEDUPE_TRUNCATED_SCORE_CEILING,
  type DuplicateMemoryCandidate,
} from '../src/lib/memoryDedupeCore';
import {
  detectCredentialMemoryContent,
  describeCredentialMemoryBlock,
} from '../src/lib/userMemoryCaps';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── fixtures ────────────────────────────────────────────────────────────────

const CIRCLE = 'c1';
const USER = 'u1';
const RUN_UUID = '3f1a9c2e-7b4d-4e21-9a6f-0c8d5b2e1a77';
const AGENT_KEY = 'default::blackswan';
const NOW = '2026-07-24T18:30:00.000Z';

function candidate(over: Partial<V2MemoryCandidate>): V2MemoryCandidate {
  return {
    id: 'm1',
    scope: 'circle',
    agent_id: null,
    user_id: USER,
    title: 'Deploy window',
    content: 'The team deploys to production on Tuesday and Thursday mornings only.',
    importance: 0.6,
    metadata: { via: 'swanbot-v2-ai' },
    ...over,
  };
}

function plan(over: Partial<V2SaveMemoryPlanInput> = {}) {
  return planV2SaveMemoryWrite({
    title: 'Deploy window',
    content: 'The team deploys to production on Tuesday and Thursday mornings only.',
    kind: 'fact',
    circleId: CIRCLE,
    userId: USER,
    runId: RUN_UUID,
    nowIso: NOW,
    candidates: [],
    ...over,
  });
}

/** The insert row from a plan we expect to be an insert (else a throwing stub). */
function insertRow(p: ReturnType<typeof plan>): V2SaveMemoryInsertRow {
  if (!p.ok || p.action !== 'insert') throw new Error(`expected insert, got ${JSON.stringify(p)}`);
  return p.row as V2SaveMemoryInsertRow;
}
function updatePatch(p: ReturnType<typeof plan>): V2SaveMemoryUpdatePatch {
  if (!p.ok || p.action !== 'update') throw new Error(`expected update, got ${JSON.stringify(p)}`);
  return p.row as V2SaveMemoryUpdatePatch;
}

/**
 * Mirrors the EDGE HANDLER's order exactly: cap → require → credential gate →
 * plan. The gate must run before any write path is reachable, and must see the
 * same capped text the plan writes.
 */
function simulateHandler(args: { title?: unknown; content?: unknown; kind?: string; scope?: string }) {
  const title = String(args.title ?? '').trim().slice(0, MAX_MEMORY_TITLE_CHARS);
  const content = String(args.content ?? '').trim().slice(0, MAX_MEMORY_CONTENT_CHARS);
  if (!title || !content) return { refused: true as const, planned: null, error: 'title and content required' };
  const finding = detectCredentialMemoryContent(content) || detectCredentialMemoryContent(title);
  if (finding) return { refused: true as const, planned: null, error: describeCredentialMemoryBlock(finding) };
  return {
    refused: false as const,
    planned: plan({ title, content, kind: args.kind, requestedScope: args.scope }),
    error: null,
  };
}

function main(): void {
  // ── 1. source_run_id (DEFECT #2) ─────────────────────────────────────────
  assertEq(normalizeSourceRunId(RUN_UUID), RUN_UUID, 'valid uuid passes through');
  assertEq(normalizeSourceRunId(RUN_UUID.toUpperCase()), RUN_UUID, 'uppercase uuid normalized to lowercase');
  assertEq(normalizeSourceRunId(`  ${RUN_UUID}  `), RUN_UUID, 'surrounding whitespace trimmed');
  assertEq(normalizeSourceRunId('not-a-uuid'), null, 'non-uuid → null (never a 22P02 insert error)');
  assertEq(normalizeSourceRunId(''), null, 'empty → null');
  assertEq(normalizeSourceRunId(null), null, 'null → null');
  assertEq(normalizeSourceRunId(undefined), null, 'undefined → null');
  assertEq(normalizeSourceRunId(12345), null, 'number → null');
  assertEq(normalizeSourceRunId({}), null, 'object → null');
  assertEq(normalizeSourceRunId(`${RUN_UUID}; DROP TABLE`), null, 'uuid with a suffix → null (anchored regex)');
  assertEq(normalizeSourceRunId('3f1a9c2e7b4d4e219a6f0c8d5b2e1a77'), null, 'unhyphenated hex → null');

  assertEq(insertRow(plan()).source_run_id, RUN_UUID, 'insert carries source_run_id when valid');
  assertEq(insertRow(plan({ runId: 'junk' })).source_run_id, null, 'insert nulls source_run_id when invalid');
  assertEq(insertRow(plan({ runId: null })).source_run_id, null, 'insert nulls source_run_id when absent');

  // ── 2. updated_at is caller-supplied and validated ───────────────────────
  assertEq(normalizeUpdatedAt(NOW), NOW, 'ISO instant accepted');
  assertEq(normalizeUpdatedAt('2026-07-24T18:30:00+02:00'), '2026-07-24T18:30:00+02:00', 'offset instant accepted');
  assertEq(normalizeUpdatedAt('yesterday'), null, 'prose → null (let the DB default win)');
  assertEq(normalizeUpdatedAt(Date.parse(NOW)), null, 'epoch number → null');
  assertEq(normalizeUpdatedAt('x'.repeat(500)), null, 'oversized → null');

  // ── 3. kind + importance ─────────────────────────────────────────────────
  for (const kind of V2_MEMORY_KINDS) assertEq(normalizeV2MemoryKind(kind), kind, `kind '${kind}' preserved`);
  assertEq(normalizeV2MemoryKind('FACT'), 'fact', 'kind case-insensitive');
  assertEq(normalizeV2MemoryKind('rumour'), 'fact', 'unknown kind → fact');
  assertEq(normalizeV2MemoryKind(null), 'fact', 'null kind → fact');
  assertEq(v2MemoryImportance('instruction'), 0.9, 'instruction importance preserved');
  assertEq(v2MemoryImportance('decision'), 0.8, 'decision importance preserved');
  assertEq(v2MemoryImportance('fact'), 0.6, 'fact importance preserved');
  assertEq(v2MemoryImportance('nonsense'), 0.6, 'unknown kind importance → 0.6');

  // ── 4. source_surface honesty (DEFECT #3) ────────────────────────────────
  // Widened so TS compares values, not literal types (TS2367).
  const surfaceValue: string = V2_SAVE_MEMORY_SOURCE_SURFACE;
  assert(surfaceValue !== 'main_chat', 'surface is no longer the unjustifiable main_chat');
  assert(/^[a-z0-9_]+$/.test(V2_SAVE_MEMORY_SOURCE_SURFACE), 'surface is a plain snake token');
  assertEq(insertRow(plan()).source_surface, V2_SAVE_MEMORY_SOURCE_SURFACE, 'insert stamps the writer surface');

  // ── 5. lane resolution (DEFECT #4) ───────────────────────────────────────
  assertEq(resolveV2MemoryAgentId({ agentSubjectKey: AGENT_KEY, agentDbId: 'db-1' }), AGENT_KEY, 'subject key wins (client reads by it)');
  assertEq(resolveV2MemoryAgentId({ agentDbId: 'db-1' }), 'db-1', 'db id is the first fallback');
  assertEq(resolveV2MemoryAgentId({ agentLegacyIds: ['', '  ', 'legacy-1'] }), 'legacy-1', 'first usable legacy id is the last fallback');
  assertEq(resolveV2MemoryAgentId({ agentLegacyIds: 'not-an-array' }), null, 'non-array legacy ids ignored');
  assertEq(resolveV2MemoryAgentId({}), null, 'no identity → null');
  assertEq(resolveV2MemoryAgentId({ agentSubjectKey: 'x'.repeat(500) })?.length, MAX_AGENT_ID_CHARS, 'agent id is bounded');

  const agentLane = resolveV2MemoryLane({ agentSubjectKey: AGENT_KEY });
  assertEq(agentLane.scope, 'agent', 'agent subject present → agent lane');
  assertEq(agentLane.agentId, AGENT_KEY, 'agent lane carries agent_id');
  assertEq(agentLane.visibility, 'private', 'agent lane visibility matches the RLS insert policy');
  assertEq(agentLane.reason, 'agent_subject', 'agent lane reason recorded');

  const noSubjectLane = resolveV2MemoryLane({});
  assertEq(noSubjectLane.scope, 'circle', 'no agent subject → circle lane');
  assertEq(noSubjectLane.agentId, null, 'circle lane never fabricates an agent_id');
  assertEq(noSubjectLane.visibility, 'circle_shared', 'circle lane stays team-shared');
  assertEq(noSubjectLane.reason, 'no_agent_subject', 'fallback reason recorded');

  const forcedCircle = resolveV2MemoryLane({ requestedScope: 'circle', agentSubjectKey: AGENT_KEY });
  assertEq(forcedCircle.scope, 'circle', "explicit scope:'circle' overrides the agent subject");
  assertEq(forcedCircle.agentId, null, 'forced circle lane drops the agent id');
  assertEq(resolveV2MemoryLane({ requestedScope: 'CIRCLE', agentSubjectKey: AGENT_KEY }).scope, 'circle', 'requested scope is case-insensitive');
  assertEq(resolveV2MemoryLane({ requestedScope: 'nonsense', agentSubjectKey: AGENT_KEY }).scope, 'agent', 'unknown requested scope falls back to the identity rule');
  assertEq(resolveV2MemoryLane({ requestedScope: 'agent' }).reason, 'no_agent_subject', 'agent requested without identity → circle, not a fabricated row');

  const agentRow = insertRow(plan({ agentSubjectKey: AGENT_KEY }));
  assertEq(agentRow.scope, 'agent', 'agent lane row scope');
  assertEq(agentRow.agent_id, AGENT_KEY, 'agent lane row agent_id');
  assertEq(agentRow.visibility, 'private', 'agent lane row visibility');
  assertEq(agentRow.user_id, USER, 'agent lane row keeps the owner (RLS requires it)');
  assertEq((agentRow.metadata as Record<string, unknown>).agentId, AGENT_KEY, 'metadata mirrors agentId for legacy readers');

  const circleRow = insertRow(plan());
  assertEq(circleRow.scope, 'circle', 'circle lane row scope');
  assertEq('agent_id' in circleRow, false, 'circle lane omits agent_id entirely (column-compatible with today)');
  assertEq(circleRow.visibility, 'circle_shared', 'circle lane row visibility');
  assertEq(circleRow.retrieval_mode, 'on_demand', 'retrieval_mode preserved from the existing handler');
  assertEq(circleRow.is_active, true, 'row is active');
  assertEq((circleRow.metadata as Record<string, unknown>).via, 'swanbot-v2-ai', 'metadata via preserved');

  // ── 6. similarity is memoryDedupeCore's, verbatim (drift guard) ───────────
  assertEq(MAX_COMPARE_CHARS, DEDUPE_MAX_COMPARE_CHARS, '[drift] MAX_COMPARE_CHARS');
  assertEq(MAX_TOKENS_PER_SIDE, DEDUPE_MAX_TOKENS_PER_SIDE, '[drift] MAX_TOKENS_PER_SIDE');
  assertEq(CONTAINMENT_MIN_CHARS, DEDUPE_CONTAINMENT_MIN_CHARS, '[drift] CONTAINMENT_MIN_CHARS');
  assertEq(CONTAINMENT_MIN_LENGTH_RATIO, DEDUPE_CONTAINMENT_MIN_LENGTH_RATIO, '[drift] CONTAINMENT_MIN_LENGTH_RATIO');
  assertEq(DUPLICATE_CONTENT_THRESHOLD, DEDUPE_CONTENT_THRESHOLD, '[drift] DUPLICATE_CONTENT_THRESHOLD');
  assertEq(DUPLICATE_TITLE_THRESHOLD, DEDUPE_TITLE_THRESHOLD, '[drift] DUPLICATE_TITLE_THRESHOLD');
  assertEq(TITLE_MATCH_CONTENT_FLOOR, DEDUPE_TITLE_MATCH_CONTENT_FLOOR, '[drift] TITLE_MATCH_CONTENT_FLOOR');
  assertEq(TRUNCATED_SCORE_CEILING, DEDUPE_TRUNCATED_SCORE_CEILING, '[drift] TRUNCATED_SCORE_CEILING');

  const SIM_PAIRS: Array<[unknown, unknown]> = [
    ['we use postgres', 'we use postgres'],
    ['postgres', 'we migrated the analytics warehouse to postgres last quarter'],
    ['deploy on tuesday', 'deploy on thursday'],
    ['', 'anything'],
    [null, undefined],
    [42, '42'],
    [{}, []],
    ['a'.repeat(30), 'a'.repeat(30) + 'bbbbbbbbbbbbbbbbbbbb'],
    ['a'.repeat(MAX_COMPARE_CHARS) + 'X', 'a'.repeat(MAX_COMPARE_CHARS) + 'Y'],
    ['The team deploys on Tuesday.', 'The team deploys on Tuesday and Thursday.'],
    ['Instruction: always reason thoroughly', 'Instruction: always reason quickly'],
    ['x'.repeat(50000), 'x'.repeat(50001)],
  ];
  for (const [a, b] of SIM_PAIRS) {
    const mine = v2MemorySimilarityScore(a, b);
    assertEq(mine, memorySimilarityScore(a, b), `[drift] score parity for ${JSON.stringify(String(a).slice(0, 24))}`);
    assertEq(mine, v2MemorySimilarityScore(b, a), '[invariant] similarity is symmetric');
    assert(mine >= 0 && mine <= 1 && Number.isFinite(mine), '[invariant] similarity stays in 0..1');
  }

  // ── 7. duplicate selection — the destructive path ────────────────────────
  const circleQuery = (title: string, content: string) => ({ title, content, lane: { scope: 'circle', agentId: null } });

  // (a) A REPEAT save must find the existing row (→ UPDATE, not INSERT).
  const repeat = pickV2DuplicateMemory([candidate({})], circleQuery('Deploy window', String(candidate({}).content)));
  assertEq(repeat?.memory.id, 'm1', '[dedupe] exact repeat matches the stored row');
  assertEq(repeat?.matchedOn, 'content', '[dedupe] content is the winning signal');
  assertEq(repeat?.contentScore, 1, '[dedupe] identical bodies score 1');

  // A refinement of the same statement still matches (this is the whole point).
  const refined = pickV2DuplicateMemory(
    [candidate({})],
    circleQuery('Deploy window', `${candidate({}).content} Release policy v3.`),
  );
  assert(refined !== null, '[dedupe] a same-statement refinement is still the same memory');

  // (b) A GENUINELY DIFFERENT memory must INSERT.
  assertEq(
    pickV2DuplicateMemory([candidate({})], circleQuery('Postgres version', 'We run Postgres 16 in production and Postgres 15 in staging.')),
    null,
    '[dedupe] unrelated memory is not a duplicate',
  );

  // (c) AMBIGUOUS ⇒ NOT A DUPLICATE — the regression anchors.
  const topicRow = candidate({
    title: 'Analytics warehouse migration',
    content: 'We migrated the analytics warehouse to postgres last quarter and it has been stable ever since.',
  });
  assertEq(
    pickV2DuplicateMemory([topicRow], circleQuery('postgres', 'postgres')),
    null,
    '[ambiguous] a topic word must NOT overwrite a paragraph mentioning it',
  );
  assert(String(topicRow.content).includes('postgres'), '[ambiguous] …and that is despite real containment');

  assertEq(
    pickV2DuplicateMemory([candidate({})], circleQuery('Deploy window', 'Nobody may deploy during the holiday freeze in December.')),
    null,
    '[ambiguous] an identical TITLE with an unrelated body must NOT overwrite',
  );
  assertEq(
    v2MemorySimilarityScore('Deploy window', 'Deploy window'), 1,
    '[ambiguous] …and that is despite a title score of exactly 1',
  );

  const longA = 'a'.repeat(MAX_COMPARE_CHARS) + 'X';
  const longB = 'a'.repeat(MAX_COMPARE_CHARS) + 'Y';
  assertEq(v2MemorySimilarityScore(longA, longB), TRUNCATED_SCORE_CEILING, '[ambiguous] prefix-only compare is capped');
  assert(TRUNCATED_SCORE_CEILING < DUPLICATE_CONTENT_THRESHOLD, '[ambiguous] …below the duplicate bar');
  assertEq(
    pickV2DuplicateMemory([candidate({ title: 'Long A', content: longA })], circleQuery('Long B', longB)),
    null,
    '[ambiguous] a truncated (prefix-only) comparison must NOT authorize an overwrite',
  );

  const shortBody = 'we deploy on friday afternoons';
  const paddedBody = shortBody + 'x'.repeat(Math.round(shortBody.length / CONTAINMENT_MIN_LENGTH_RATIO) - shortBody.length);
  assertEq(shortBody.length / paddedBody.length, CONTAINMENT_MIN_LENGTH_RATIO, '[ambiguous] fixture sits exactly on the containment floor');
  assertEq(v2MemorySimilarityScore(shortBody, paddedBody), 0.8, '[ambiguous] containment at the floor scores 0.8');
  assertEq(
    pickV2DuplicateMemory([candidate({ title: 'Padded', content: paddedBody })], circleQuery('Short', shortBody)),
    null,
    '[ambiguous] containment exactly at the ratio floor is NOT a duplicate',
  );

  assertEq(
    pickV2DuplicateMemory([candidate({ id: '' })], circleQuery('Deploy window', String(candidate({}).content))),
    null,
    '[ambiguous] a candidate with no id cannot be updated',
  );
  assertEq(
    pickV2DuplicateMemory([candidate({})], circleQuery('Deploy window', '   ')),
    null,
    '[ambiguous] an empty incoming body never justifies replacing a stored one',
  );
  assertEq(
    pickV2DuplicateMemory([candidate({})], { title: 't', content: 'c', lane: { scope: 'session', agentId: null } }),
    null,
    '[ambiguous] an unknown lane is never deduped',
  );

  // (d) LANE ISOLATION — a row is only ever replaced inside its own lane.
  const agentRowFixture = candidate({ id: 'a1', scope: 'agent', agent_id: AGENT_KEY });
  const agentQuery = { title: 'Deploy window', content: String(candidate({}).content), lane: { scope: 'agent', agentId: AGENT_KEY } };
  assertEq(pickV2DuplicateMemory([agentRowFixture], agentQuery)?.memory.id, 'a1', '[lane] agent lane matches its own row');
  assertEq(pickV2DuplicateMemory([candidate({})], agentQuery), null, '[lane] agent lane never touches a circle row');
  assertEq(pickV2DuplicateMemory([agentRowFixture], circleQuery('Deploy window', String(candidate({}).content))), null, '[lane] circle lane never touches an agent row');
  assertEq(
    pickV2DuplicateMemory([candidate({ id: 'a2', scope: 'agent', agent_id: 'other::agent' })], agentQuery),
    null,
    '[lane] another agent\'s row is never overwritten',
  );
  assertEq(
    pickV2DuplicateMemory([candidate({ id: 'a3', scope: 'agent', agent_id: null })], agentQuery),
    null,
    '[lane] an agent row with no agent_id is ambiguous → not a duplicate',
  );
  assertEq(
    pickV2DuplicateMemory([agentRowFixture], { title: 't', content: String(candidate({}).content), lane: { scope: 'agent', agentId: '' } }),
    null,
    '[lane] an agent lane with no identity cannot prove ownership',
  );

  // (e) Best score wins; ties resolve to the earliest index (determinism).
  // NOTE: rank is max(contentScore, titleScore) — same as memoryDedupeCore — so
  // the near-miss row needs a DIFFERENT title, otherwise both rows rank 1.0 on
  // the title alone and the tie-break (earliest index) decides instead.
  const near = `${candidate({}).content} Mostly.`;
  const best = pickV2DuplicateMemory(
    [candidate({ id: 'far', title: 'Deploy schedule', content: near }), candidate({ id: 'exact' })],
    circleQuery('Deploy window', String(candidate({}).content)),
  );
  assertEq(best?.memory.id, 'exact', '[dedupe] the best-scoring candidate wins, not the first');
  const tie = pickV2DuplicateMemory(
    [candidate({ id: 'first' }), candidate({ id: 'second' })],
    circleQuery('Deploy window', String(candidate({}).content)),
  );
  assertEq(tie?.memory.id, 'first', '[dedupe] ties resolve to the earliest index');

  // ── 8. the write plan: UPDATE vs INSERT (DEFECT #1) ──────────────────────
  const repeatPlan = plan({ candidates: [candidate({})] });
  assert(repeatPlan.ok && repeatPlan.action === 'update', '[plan] a repeat save UPDATES rather than inserting');
  assert(repeatPlan.ok && repeatPlan.targetId === 'm1', '[plan] update targets the matched row id');
  assert(repeatPlan.ok && repeatPlan.duplicate?.matchedOn === 'content', '[plan] the winning signal is reported back');

  const differentPlan = plan({
    candidates: [candidate({})],
    title: 'Postgres version',
    content: 'We run Postgres 16 in production and Postgres 15 in staging.',
  });
  assert(differentPlan.ok && differentPlan.action === 'insert', '[plan] a genuinely different memory INSERTs');
  assert(differentPlan.ok && differentPlan.targetId === null, '[plan] an insert has no target row');
  assert(differentPlan.ok && differentPlan.duplicate === null, '[plan] an insert reports no duplicate');

  const ambiguousPlan = plan({ candidates: [candidate({})], title: 'Deploy window', content: 'Nobody may deploy during the holiday freeze in December.' });
  assert(ambiguousPlan.ok && ambiguousPlan.action === 'insert', '[plan] the ambiguous title collision INSERTs (never overwrites)');

  const patch = updatePatch(repeatPlan);
  assertEq(patch.source_surface, V2_SAVE_MEMORY_SOURCE_SURFACE, '[patch] update stamps the writer surface');
  assertEq(patch.source_run_id, RUN_UUID, '[patch] update records the run that re-asserted the memory');
  assertEq(patch.updated_at, NOW, '[patch] update carries the caller-supplied clock');
  assertEq('source_run_id' in updatePatch(plan({ candidates: [candidate({})], runId: 'junk' })), false,
    '[patch] an invalid run id OMITS the field — never erases existing provenance');
  assertEq('updated_at' in updatePatch(plan({ candidates: [candidate({})], nowIso: 'later' })), false,
    '[patch] an unusable clock omits updated_at (DB default wins)');

  for (const laneField of ['scope', 'agent_id', 'visibility', 'user_id', 'circle_id']) {
    assertEq(laneField in patch, false, `[patch] update never rewrites lane field '${laneField}'`);
  }
  assertEq('is_active' in patch, false, '[patch] update never resurrects a row the user forgot');

  assertEq(updatePatch(plan({ candidates: [candidate({ importance: 0.9 })], kind: 'fact' })).importance, 0.9,
    '[patch] importance is never DEMOTED by a later, weaker classification');
  assertEq(updatePatch(plan({ candidates: [candidate({ importance: 0.6 })], kind: 'instruction' })).importance, 0.9,
    '[patch] importance is raised when the new classification is stronger');
  assertEq(updatePatch(plan({ candidates: [candidate({ importance: null })] })).importance, 0.6,
    '[patch] a missing existing importance falls back to the new one');

  const mergedMeta = updatePatch(plan({ candidates: [candidate({ metadata: { via: 'legacy', keepMe: 'yes' } })] })).metadata;
  assertEq(mergedMeta.keepMe, 'yes', '[patch] pre-existing metadata keys survive the update');
  assertEq(mergedMeta.via, 'swanbot-v2-ai', '[patch] the writer tag is refreshed');
  assertEq(mergedMeta.scope_reason, 'no_agent_subject', '[patch] the lane decision is recorded for audit');

  // Agent-lane round trip through the full plan.
  const agentPlan = plan({ agentSubjectKey: AGENT_KEY, candidates: [agentRowFixture] });
  assert(agentPlan.ok && agentPlan.action === 'update', '[plan] agent lane dedupes against its own rows');
  assert(agentPlan.ok && agentPlan.lane.scope === 'agent', '[plan] agent lane reported back to the caller');
  const crossLanePlan = plan({ agentSubjectKey: AGENT_KEY, candidates: [candidate({})] });
  assert(crossLanePlan.ok && crossLanePlan.action === 'insert', '[plan] agent lane never updates a circle row');

  // ── 9. the credential gate still fires, and BEFORE any write ─────────────
  const secretBody = `The API key is sk-${'a'.repeat(20)}`;
  assert(detectCredentialMemoryContent(secretBody) !== null, '[secret] credential-shaped content is detected');
  const refusedBody = simulateHandler({ title: 'API access', content: secretBody });
  assertEq(refusedBody.refused, true, '[secret] credential-shaped CONTENT is refused');
  assertEq(refusedBody.planned, null, '[secret] …and no write is ever planned');
  assert(String(refusedBody.error).length > 0, '[secret] the refusal explains itself to the model');

  const refusedTitle = simulateHandler({ title: `ghp_${'a'.repeat(20)}`, content: 'Deploy notes for the release.' });
  assertEq(refusedTitle.refused, true, '[secret] credential-shaped TITLE is refused');
  assertEq(refusedTitle.planned, null, '[secret] …and no write is ever planned');

  const clean = simulateHandler({ title: 'Deploy window', content: String(candidate({}).content) });
  assertEq(clean.refused, false, '[secret] benign content is not refused');
  assert(clean.planned?.ok === true, '[secret] …and still plans a write');

  // THE SAFETY INVARIANT: whatever we WRITE must be contained in the text the
  // gate actually inspected, so no un-inspected byte can ever reach the row.
  const filler = 'the team ships on tuesdays. '.repeat(200);
  const oversized = `${filler} sk-${'a'.repeat(20)}`;
  const gatedContent = oversized.trim().slice(0, MAX_MEMORY_CONTENT_CHARS);
  assertEq(detectCredentialMemoryContent(gatedContent), null, '[cap] filler fixture is itself benign');
  assert(!/\s$/.test(gatedContent), '[cap] fixture cap boundary is not whitespace (keeps the length assertion exact)');
  const cappedRun = simulateHandler({ title: 'Long note', content: oversized });
  assertEq(cappedRun.refused, false, '[cap] text beyond the 4000-char cap never reaches the gate');
  const cappedRow = insertRow(cappedRun.planned as ReturnType<typeof plan>);
  assertEq(cappedRow.content.length, MAX_MEMORY_CONTENT_CHARS, '[cap] the 4000-char content cap is preserved');
  assert(gatedContent.startsWith(cappedRow.content), '[cap] the written text is contained in the text the gate approved');
  assertEq(cappedRow.content.includes('sk-'), false, '[cap] …so the trailing secret is never persisted');
  assertEq(insertRow(plan({ title: 'T'.repeat(400) })).title.length, MAX_MEMORY_TITLE_CHARS, '[cap] the 120-char title cap is preserved');

  // ── 10. degenerate + hostile input (total functions) ─────────────────────
  const missingTitle = plan({ title: '   ' });
  assert(!missingTitle.ok && missingTitle.error === 'title and content required', '[degenerate] empty title refused with the original message');
  const missingContent = plan({ content: null });
  assert(!missingContent.ok && missingContent.error === 'title and content required', '[degenerate] empty content refused');
  const missingCircle = plan({ circleId: '' });
  assert(!missingCircle.ok && missingCircle.error === 'circleId required', '[degenerate] missing circle refused (never an unscoped write)');

  try {
    assert(plan({ candidates: 'nope' }).ok, '[degenerate] non-array candidates → insert');
    assert(plan({ candidates: null }).ok, '[degenerate] null candidates → insert');
    assert(plan({ candidates: [] }).ok, '[degenerate] empty candidates → insert');
    const junkMixed = plan({ candidates: [null, undefined, 7, 'row', candidate({})] });
    assert(junkMixed.ok && junkMixed.action === 'update', '[degenerate] junk entries are skipped, the real row still matches');

    const throwing = {
      id: 'th', scope: 'circle', importance: 0.6, content: String(candidate({}).content),
      get title() { throw new Error('boom'); },
      get metadata() { throw new Error('boom'); },
    };
    const throwingPlan = plan({ candidates: [throwing] });
    assert(throwingPlan.ok && throwingPlan.action === 'update', '[hostile] a throwing getter is tolerated');

    const cyclic: Record<string, unknown> = { via: 'legacy' };
    cyclic.self = cyclic;
    const cyclicPatch = updatePatch(plan({ candidates: [candidate({ metadata: cyclic })] }));
    assertEq('self' in cyclicPatch.metadata, false, '[hostile] a self-referential metadata bag is not propagated');
    assert(JSON.stringify(cyclicPatch).length > 0, '[hostile] …so the patch stays JSON-serializable for PostgREST');

    assert(plan({ agentSubjectKey: { toString() { throw new Error('boom'); } } }).ok, '[hostile] a throwing agent identity is tolerated');
    assert(plan({ content: 'z'.repeat(200000) }).ok, '[hostile] a 200k-char body is bounded, not fatal');
    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: [HOSTILE] sweep threw: ${(e as Error)?.message}`);
  }

  // ── 11. determinism ──────────────────────────────────────────────────────
  const detA = plan({ candidates: [candidate({})], agentSubjectKey: AGENT_KEY });
  const detB = plan({ candidates: [candidate({})], agentSubjectKey: AGENT_KEY });
  assertEq(JSON.stringify(detA), JSON.stringify(detB), '[determinism] identical input → identical plan');
  const insA = plan({ title: 'New thing', content: 'Something entirely unrelated to deploys.' });
  const insB = plan({ title: 'New thing', content: 'Something entirely unrelated to deploys.' });
  assertEq(JSON.stringify(insA), JSON.stringify(insB), '[determinism] identical input → identical insert row');

  // ── 12. predicate parity with memoryDedupeCore (drift guard) ─────────────
  const PARITY_CASES: Array<[string, string]> = [
    ['Deploy window', String(candidate({}).content)],
    ['Deploy window', `${candidate({}).content} Release policy v3.`],
    ['Deploy window', 'Nobody may deploy during the holiday freeze in December.'],
    ['Postgres version', 'We run Postgres 16 in production and Postgres 15 in staging.'],
    ['postgres', 'postgres'],
    ['Short', shortBody],
  ];
  const parityRows: DuplicateMemoryCandidate[] = [
    { id: 'm1', scope: 'circle', user_id: USER, title: 'Deploy window', content: String(candidate({}).content) },
    { id: 'm2', scope: 'circle', user_id: USER, title: 'Padded', content: paddedBody },
  ];
  for (const [title, content] of PARITY_CASES) {
    const mine = pickV2DuplicateMemory(parityRows as V2MemoryCandidate[], { title, content, lane: { scope: 'circle', agentId: null } });
    const theirs = pickDuplicateMemory<DuplicateMemoryCandidate>(parityRows, { title, content, scope: 'circle', isPrivate: false });
    assertEq(mine?.memory.id ?? null, theirs?.memory.id ?? null, `[drift] same duplicate verdict for "${title}"`);
    assertEq(mine?.matchedOn ?? null, theirs?.matchedOn ?? null, `[drift] same winning signal for "${title}"`);
  }

  // ── 13. bounds (documented invariants) ───────────────────────────────────
  assertEq(MAX_MEMORY_CONTENT_CHARS, 4000, '[bounds] content cap unchanged at 4000');
  assertEq(MAX_MEMORY_TITLE_CHARS, 120, '[bounds] title cap unchanged at 120');
  assert(MAX_DEDUPE_CANDIDATES > 0 && MAX_DEDUPE_CANDIDATES <= 1000, '[bounds] dedupe scan stays bounded');
  assert(MAX_AGENT_ID_CHARS > 0 && MAX_AGENT_ID_CHARS <= 1000, '[bounds] agent id stays bounded');
  assert(TRUNCATED_SCORE_CEILING < DUPLICATE_CONTENT_THRESHOLD, '[bounds] truncated ceiling below content threshold');
  assert(DUPLICATE_CONTENT_THRESHOLD <= DUPLICATE_TITLE_THRESHOLD, '[bounds] content threshold <= title threshold');
  assert(TITLE_MATCH_CONTENT_FLOOR < DUPLICATE_CONTENT_THRESHOLD, '[bounds] corroboration floor below content threshold');
  assert(0.5 + 0.5 * CONTAINMENT_MIN_LENGTH_RATIO < DUPLICATE_CONTENT_THRESHOLD, '[bounds] minimum containment is not a duplicate');
  assert(CONTAINMENT_MIN_CHARS >= 24, '[bounds] topic words cannot win by containment');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll v2-save-memory-core smoke cases passed (${passes} passed).`);
}

main();
