/**
 * cross-surface-reference-resolver-core-smoketest — the PURE middle piece
 * (src/lib/crossSurfaceReferenceResolverCore.ts) that turns a raw chat message
 * into confidence-ranked cross-surface navigation targets against the entities
 * the runtime already holds from circleContextSnapshot. Load-bearing assertions:
 *
 *   resolveCrossSurfaceReferences(message, entities, opts?): CrossSurfaceRouteResult
 *     matches[] ranked by score with a stable tiebreak; each carries an
 *     EntityHandle {kind,id,surface} that round-trips through
 *     encodeEntityHandle → decodeEntityHandle; reason ∈ id | exact-title |
 *     title-tokens | alias | partial; confidence ∈ high | medium | low.
 *       - exact-title phrase → high, surface derived from kind (mission→feed).
 *       - title-token coverage: ==1 high (≥2 tokens) / medium (1 token);
 *         ≥0.6 medium; a cue-less [0.34,0.6) partial is DROPPED (mislink worse
 *         than miss); a cued one → 'partial' low.
 *       - a distinctive id token / idish prefix → 'id' high and wins ranking.
 *       - surfaceCue ("in the office") + kind cue ("that room") boost & steer.
 *       - suggestedSurface = best match's surface, else surfaceCue, else hint.
 *       - dedupe by surface:kind:id keeping the best; slice ≤ MAX_MATCHES.
 *   detectSurfaceCue(message): first surface word in the message, else null.
 *   homeSurfaceForKind(kind): canonical home (mirrors entityHandleCore).
 *
 *   And: every export is TOTAL — null/undefined/number message, non-array
 *   entities, cyclic / throwing-getter entities, secret-value-shaped titles,
 *   control/line-sep/fence chars, empty id/title, unknown kind, huge input ⇒ a
 *   valid CrossSurfaceRouteResult, never a throw, never a leaked secret.
 *
 * Pure — loads under tsx (only import type from entityHandleCore, which is
 * itself zero-import). The smoke also imports entityHandleCore's runtime
 * encode/decode to prove the handle contract end-to-end.
 */

import {
  resolveCrossSurfaceReferences,
  detectSurfaceCue,
  homeSurfaceForKind,
  MAX_MESSAGE_LEN,
  MAX_ENTITIES_SCANNED,
  MAX_MATCHES,
  MAX_TITLE_LEN,
  MAX_MATCHED_TEXT_LEN,
  MAX_ALIASES,
  MIN_TOKEN_LEN,
  type CrossSurfaceEntity,
  type CrossSurfaceRouteResult,
  type SurfaceReferenceMatch,
  type ReferenceConfidence,
} from '../src/lib/crossSurfaceReferenceResolverCore';
import { encodeEntityHandle, decodeEntityHandle } from '../src/lib/entityHandleCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── canonical fixtures (snapshot-shaped compact entities) ────────────────────
const missionAcme: CrossSurfaceEntity = { kind: 'mission', id: 'msn_acme01', title: 'Acme redesign', status: 'active' };
const missionCheckout: CrossSurfaceEntity = { kind: 'mission', id: 'msn_checkout', title: 'Checkout flow revamp', status: 'active' };
const missionLong: CrossSurfaceEntity = { kind: 'mission', id: 'msn_pipeline', title: 'Global data pipeline overhaul', status: 'active' };
const missionBackend: CrossSurfaceEntity = { kind: 'mission', id: 'msn_backend', title: 'Backend migration', status: 'active' };
const missionBackendExact: CrossSurfaceEntity = { kind: 'mission', id: 'msn_be2', title: 'Backend', status: 'active' };
const roomBackend: CrossSurfaceEntity = { kind: 'room', id: 'room_be01', title: 'Backend', status: 'open' };
const runNightly: CrossSurfaceEntity = { kind: 'run', id: 'run_1a2b3c4d', title: 'Nightly deploy run', status: 'succeeded' };
const runDeploy: CrossSurfaceEntity = { kind: 'run', id: 'run_deploy1', title: 'Deploy', status: 'succeeded' };
const roomDeploy: CrossSurfaceEntity = { kind: 'room', id: 'room_deploy1', title: 'Deploy', status: 'open' };
const taskLogin: CrossSurfaceEntity = { kind: 'task', id: 'task_login9', title: 'Fix login redirect', status: 'todo' };
const agentBlackswan: CrossSurfaceEntity = { kind: 'agent', id: 'default::blackswan', title: 'BlackSwan', status: 'idle', aliases: ['swanbot', 'swan'] };
const threadStandup: CrossSurfaceEntity = { kind: 'thread', id: 'thr_standup', title: 'Daily standup', status: 'open' };

const ALL = [
  missionAcme, missionCheckout, missionLong, missionBackend, missionBackendExact,
  roomBackend, runNightly, runDeploy, roomDeploy, taskLogin, agentBlackswan, threadStandup,
];

// ── helpers ──────────────────────────────────────────────────────────────────
function top(r: CrossSurfaceRouteResult): SurfaceReferenceMatch | undefined {
  return r.matches[0];
}
function idsOf(r: CrossSurfaceRouteResult): string[] {
  return r.matches.map((m) => m.handle.id);
}
function findId(r: CrossSurfaceRouteResult, id: string): SurfaceReferenceMatch | undefined {
  return r.matches.find((m) => m.handle.id === id);
}
/** Structural invariants any result must satisfy. */
function resultIsValid(r: unknown): r is CrossSurfaceRouteResult {
  if (!r || typeof r !== 'object') return false;
  const rr = r as CrossSurfaceRouteResult;
  if (!Array.isArray(rr.matches)) return false;
  if (rr.matches.length > MAX_MATCHES) return false;
  if (!(rr.suggestedSurface === null || typeof rr.suggestedSurface === 'string')) return false;
  if (!(rr.surfaceCue === null || typeof rr.surfaceCue === 'string')) return false;
  for (const m of rr.matches) {
    if (!m || typeof m !== 'object') return false;
    if (!m.handle || typeof m.handle.id !== 'string' || typeof m.handle.kind !== 'string') return false;
    if (typeof m.title !== 'string' || m.title.length > MAX_TITLE_LEN) return false;
    if (typeof m.matchedText !== 'string' || m.matchedText.length > MAX_MATCHED_TEXT_LEN) return false;
    if (typeof m.status !== 'string') return false;
    if (!['high', 'medium', 'low'].includes(m.confidence)) return false;
    if (!['id', 'exact-title', 'title-tokens', 'alias', 'partial'].includes(m.reason)) return false;
    if (typeof m.score !== 'number' || !Number.isFinite(m.score)) return false;
    // every emitted handle must encode to a non-empty deep link
    if (encodeEntityHandle(m.handle).length === 0) return false;
    // no control / fence chars leaked into user-visible strings
    if (/[\u0000-\u001f\u2028\u2029`<>]/.test(m.title)) return false;
    if (/[\u0000-\u001f\u2028\u2029`<>]/.test(m.matchedText)) return false;
  }
  return true;
}
function totalOn(message: unknown, entities: unknown, opts?: unknown): boolean {
  try {
    const r = resolveCrossSurfaceReferences(message, entities, opts as never);
    return resultIsValid(r);
  } catch {
    return false;
  }
}

function main(): void {
  // ─── (A) exact-title → high, surface derived ────────────────────────────────
  {
    const r = resolveCrossSurfaceReferences("how's the Acme redesign going?", ALL);
    const t = top(r);
    assert(!!t, '(A) got a top match for "Acme redesign"');
    assertEq(t?.handle.kind, 'mission', '(A) top kind mission');
    assertEq(t?.handle.id, 'msn_acme01', '(A) top id resolves to the Acme mission');
    assertEq(t?.handle.surface, 'feed', '(A) mission surface derived → feed');
    assertEq(t?.reason, 'exact-title', '(A) reason exact-title');
    assertEq(t?.confidence, 'high', '(A) exact-title is high confidence');
    assertEq(t?.title, 'Acme redesign', '(A) title echoed');
    assertEq(t?.status, 'active', '(A) status echoed');
    assertEq(r.suggestedSurface, 'feed', '(A) suggestedSurface = best match surface');
    assert((t?.score ?? 0) >= 600, '(A) exact-title score at least 600', String(t?.score));
    assert(encodeEntityHandle(t!.handle).length > 0, '(A) handle encodes non-empty');
    assertEq(encodeEntityHandle(t!.handle), 'feed:mission:msn_acme01', '(A) handle encodes to feed:mission:msn_acme01');
  }

  // ─── (B) title-token coverage tiers + partial drop ──────────────────────────
  {
    // full coverage, non-contiguous (no exact phrase) → title-tokens, high (2 tokens)
    const r = resolveCrossSurfaceReferences('please redesign the acme now', ALL);
    const m = findId(r, 'msn_acme01');
    assert(!!m, '(B) acme mission matched via scattered tokens');
    assertEq(m?.reason, 'title-tokens', '(B) reason title-tokens (not exact, tokens reordered)');
    assertEq(m?.confidence, 'high', '(B) full coverage ≥2 tokens → high');
  }
  {
    // ≥0.6 but <1 coverage → medium
    const r = resolveCrossSurfaceReferences('improve the checkout flow please', ALL);
    const m = findId(r, 'msn_checkout');
    assert(!!m, '(B) checkout mission matched at 2/3 coverage');
    assertEq(m?.reason, 'title-tokens', '(B) partial-but-strong reason title-tokens');
    assertEq(m?.confidence, 'medium', '(B) 0.667 coverage → medium');
  }
  {
    // coverage below the partial band (1/3) → no match
    const r = resolveCrossSurfaceReferences('revamp everything today', ALL);
    assertEq(findId(r, 'msn_checkout'), undefined, '(B) 1/3 coverage below band → checkout dropped');
  }
  {
    // partial band [0.34,0.6) WITHOUT a cue → DROPPED (mislink worse than miss)
    const r = resolveCrossSurfaceReferences('fix the data pipeline stuff', ALL);
    assertEq(findId(r, 'msn_pipeline'), undefined, '(B) cue-less 2/4 partial is dropped');
  }
  {
    // same partial band WITH a kind cue ("mission") → emitted as 'partial' low
    const r = resolveCrossSurfaceReferences('that mission about the data pipeline', ALL);
    const m = findId(r, 'msn_pipeline');
    assert(!!m, '(B) cued 2/4 partial is emitted');
    assertEq(m?.reason, 'partial', '(B) reason partial');
    assertEq(m?.confidence, 'low', '(B) partial is low confidence');
  }

  // ─── (C) id / short-id prefix → 'id', high, wins ranking ────────────────────
  {
    const r = resolveCrossSurfaceReferences('what did run 1a2b3c4d do', ALL);
    const t = top(r);
    assertEq(t?.handle.id, 'run_1a2b3c4d', '(C) full hash token resolves the run');
    assertEq(t?.reason, 'id', '(C) reason id');
    assertEq(t?.confidence, 'high', '(C) id is high confidence');
    assert((t?.score ?? 0) >= 1000, '(C) id score ≥ 1000 dominates', String(t?.score));
    assertEq(t?.handle.surface, 'office', '(C) run surface → office');
  }
  {
    // idish 4-char prefix of the hash segment
    const r = resolveCrossSurfaceReferences('check run 1a2b there', ALL);
    const m = findId(r, 'run_1a2b3c4d');
    assert(!!m, '(C) 4-char idish prefix matches the run');
    assertEq(m?.reason, 'id', '(C) short-id prefix reason id');
  }
  {
    // a plain word that happens to prefix a prefixed id ("run" → run_...) must NOT id-match
    const r = resolveCrossSurfaceReferences('kick off a fresh nightly deploy run', ALL);
    const m = findId(r, 'run_1a2b3c4d');
    assert(!!m, '(C) nightly deploy run still matches by title');
    assert(m?.reason !== 'id', '(C) the word "run" does NOT false-trigger an id hit', m?.reason);
  }

  // ─── (D) surface cue: fallback + boost ──────────────────────────────────────
  {
    const r = resolveCrossSurfaceReferences("what's happening in the office?", ALL);
    assertEq(r.surfaceCue, 'office', '(D) "office" sets surfaceCue');
    assertEq(r.matches.length, 0, '(D) no content match for a bare surface question');
    assertEq(r.suggestedSurface, 'office', '(D) suggestedSurface falls back to the cue');
  }
  {
    // two identical single-token titles on different surfaces; office cue lifts the run above the room
    const r = resolveCrossSurfaceReferences('the deploy dashboard', ALL);
    assertEq(r.surfaceCue, 'office', '(D) "dashboard" cues office');
    const run = findId(r, 'run_deploy1');
    const room = findId(r, 'room_deploy1');
    assert(!!run && !!room, '(D) both Deploy entities matched');
    assert((run?.score ?? 0) > (room?.score ?? 0), '(D) office-cued run outscores the room', `${run?.score} vs ${room?.score}`);
    assertEq(top(r)?.handle.surface, 'office', '(D) top match is on the cued surface');
  }

  // ─── (E) kind-cue boost + steering ──────────────────────────────────────────
  {
    // "room Backend" — the room and the mission share the exact title "Backend";
    // the room wins on kind + surface cue, and the feed-mission "Backend migration"
    // (a cue-less partial for a mission) is dropped.
    const r = resolveCrossSurfaceReferences('open that room Backend', ALL);
    assertEq(r.surfaceCue, 'rooms', '(E) "room" cues rooms');
    const room = findId(r, 'room_be01');
    const missionExact = findId(r, 'msn_be2');
    assert(!!room, '(E) Backend room matched');
    assert(!!missionExact, '(E) Backend mission (exact title) also matched');
    assert((room?.score ?? 0) > (missionExact?.score ?? 0), '(E) kind+surface cue lifts the room above the mission', `${room?.score} vs ${missionExact?.score}`);
    assertEq(top(r)?.handle.kind, 'room', '(E) top match kind is room');
    assertEq(findId(r, 'msn_backend'), undefined, '(E) cue-less mission "Backend migration" partial dropped');
  }
  {
    // alias hit
    const r = resolveCrossSurfaceReferences('ask swanbot to summarize', ALL);
    const m = findId(r, 'default::blackswan');
    assert(!!m, '(E) alias "swanbot" resolves the agent');
    assertEq(m?.reason, 'alias', '(E) reason alias');
    assertEq(m?.confidence, 'medium', '(E) alias is medium confidence');
    assertEq(m?.handle.surface, 'office', '(E) agent surface → office');
    assertEq(encodeEntityHandle(m!.handle), 'office:agent:default::blackswan', '(E) namespaced :: id round-trips in the handle');
  }

  // ─── (F) determinism ────────────────────────────────────────────────────────
  {
    const msg = 'the acme redesign and the backend room and run 1a2b3c4d';
    const a = resolveCrossSurfaceReferences(msg, ALL);
    const b = resolveCrossSurfaceReferences(msg, ALL);
    assertJson(a, b, '(F) same input twice → identical result (incl. ordering + tiebreak)');
    assert(a.matches.length >= 2, '(F) multi-reference message yields multiple matches', String(a.matches.length));
    // scores are non-increasing (sorted desc)
    let sorted = true;
    for (let i = 1; i < a.matches.length; i += 1) if (a.matches[i].score > a.matches[i - 1].score) sorted = false;
    assert(sorted, '(F) matches sorted by score descending');
  }
  {
    // stable id-localeCompare tiebreak among equal scores
    const tie = [
      { kind: 'task', id: 'task_bbb', title: 'Alpha widget' },
      { kind: 'task', id: 'task_aaa', title: 'Alpha widget' },
      { kind: 'task', id: 'task_ccc', title: 'Alpha widget' },
    ] as CrossSurfaceEntity[];
    const r = resolveCrossSurfaceReferences('alpha widget', tie);
    assertJson(idsOf(r), ['task_aaa', 'task_bbb', 'task_ccc'], '(F) equal scores break ties by id ascending');
  }

  // ─── (G) dedupe by surface:kind:id keeps best ───────────────────────────────
  {
    const dupA: CrossSurfaceEntity = { kind: 'mission', id: 'msn_dup', title: 'Acme redesign' };
    const dupB: CrossSurfaceEntity = { kind: 'mission', id: 'msn_dup', title: 'Acme redesign flow' };
    const r = resolveCrossSurfaceReferences('the acme redesign now', [dupA, dupB]);
    const hits = r.matches.filter((m) => m.handle.id === 'msn_dup');
    assertEq(hits.length, 1, '(G) duplicate surface:kind:id collapses to one match');
    assertEq(hits[0]?.reason, 'exact-title', '(G) dedupe keeps the higher-scoring (exact-title) entry');
    assertEq(hits[0]?.confidence, 'high', '(G) kept match is the high-confidence one');
  }

  // ─── (H) bounds ─────────────────────────────────────────────────────────────
  {
    const many: CrossSurfaceEntity[] = [];
    for (let i = 0; i < 1000; i += 1) many.push({ kind: 'task', id: `task_${i}`, title: 'Alpha widget', status: 'todo' });
    const r = resolveCrossSurfaceReferences('alpha widget', many);
    assertEq(r.matches.length, 5, '(H) 1000 entities → default 5 matches returned');
    assert(r.matches.length <= MAX_MATCHES, '(H) never exceeds MAX_MATCHES');
    assert(resultIsValid(r), '(H) big-entity result is structurally valid');
    // maxMatches cap honored + clamped to MAX_MATCHES
    assertEq(resolveCrossSurfaceReferences('alpha widget', many, { maxMatches: 3 }).matches.length, 3, '(H) maxMatches:3 honored');
    assertEq(resolveCrossSurfaceReferences('alpha widget', many, { maxMatches: 100 }).matches.length, MAX_MATCHES, '(H) maxMatches clamped to MAX_MATCHES');
    assertEq(resolveCrossSurfaceReferences('alpha widget', many, { maxMatches: 0 }).matches.length, 0, '(H) maxMatches:0 → empty');
    assertEq(resolveCrossSurfaceReferences('alpha widget', many, { maxMatches: -5 }).matches.length, 0, '(H) negative maxMatches clamps to 0');
  }
  {
    // 20k-char message truncated to MAX_MESSAGE_LEN, still resolves, no throw
    const huge = 'acme redesign '.repeat(2000); // ~28k chars
    assert(huge.length > MAX_MESSAGE_LEN, '(H) test message exceeds MAX_MESSAGE_LEN');
    const r = resolveCrossSurfaceReferences(huge, ALL);
    assert(resultIsValid(r), '(H) huge message → valid result');
    assert(!!findId(r, 'msn_acme01'), '(H) still resolves within the truncated window');
    for (const m of r.matches) {
      assert(m.title.length <= MAX_TITLE_LEN, '(H) title clamped', String(m.title.length));
      assert(m.matchedText.length <= MAX_MATCHED_TEXT_LEN, '(H) matchedText clamped', String(m.matchedText.length));
    }
  }
  {
    // MAX_ENTITIES_SCANNED: an entity past the cap is ignored (not an error)
    const pad: CrossSurfaceEntity[] = [];
    for (let i = 0; i < MAX_ENTITIES_SCANNED; i += 1) pad.push({ kind: 'task', id: `pad_${i}`, title: `Filler ${i}` });
    const target: CrossSurfaceEntity = { kind: 'mission', id: 'msn_beyond', title: 'Zeta beyond cap' };
    const r = resolveCrossSurfaceReferences('zeta beyond cap', [...pad, target]);
    assertEq(findId(r, 'msn_beyond'), undefined, '(H) entity beyond MAX_ENTITIES_SCANNED is not scanned');
    assert(resultIsValid(r), '(H) capped scan still valid');
  }

  // ─── (I) minConfidence filter ───────────────────────────────────────────────
  {
    const r = resolveCrossSurfaceReferences('that mission about the data pipeline', ALL, { minConfidence: 'medium' });
    assertEq(findId(r, 'msn_pipeline'), undefined, '(I) minConfidence medium drops the low partial');
    const all = resolveCrossSurfaceReferences('that mission about the data pipeline', ALL, { minConfidence: 'low' });
    assert(!!findId(all, 'msn_pipeline'), '(I) minConfidence low keeps it');
    const hi = resolveCrossSurfaceReferences('improve the checkout flow please', ALL, { minConfidence: 'high' });
    assertEq(findId(hi, 'msn_checkout'), undefined, '(I) minConfidence high drops a medium match');
  }
  {
    // surfaceHint gives a lighter (+25) nudge than a cue
    const entities: CrossSurfaceEntity[] = [runDeploy, roomDeploy];
    const r = resolveCrossSurfaceReferences('the deploy', entities, { surfaceHint: 'office' });
    assert((findId(r, 'run_deploy1')?.score ?? 0) > (findId(r, 'room_deploy1')?.score ?? 0), '(I) surfaceHint nudges the hinted-surface entity up');
    assertEq(top(r)?.handle.surface, 'office', '(I) hint steers the top match');
  }

  // ─── (J) handle round-trips through entityHandleCore ────────────────────────
  {
    const r = resolveCrossSurfaceReferences('the acme redesign, the backend room, run 1a2b3c4d, and swanbot', ALL);
    assert(r.matches.length >= 3, '(J) several references resolved', String(r.matches.length));
    for (const m of r.matches) {
      const enc = encodeEntityHandle(m.handle);
      assert(enc.length > 0, '(J) every match handle encodes non-empty', JSON.stringify(m.handle));
      const dec = decodeEntityHandle(enc);
      assert(!!dec, '(J) encoded handle decodes back', enc);
      assertEq(dec?.kind, m.handle.kind, '(J) decoded kind matches');
      assertEq(dec?.id, m.handle.id, '(J) decoded id matches (exact, incl. :: ids)');
      assertEq(dec?.surface, m.handle.surface, '(J) decoded surface matches');
    }
  }

  // ─── detectSurfaceCue + homeSurfaceForKind ──────────────────────────────────
  assertEq(detectSurfaceCue('in the office now'), 'office', 'cue: office');
  assertEq(detectSurfaceCue('the mission board'), 'feed', 'cue: mission → feed');
  assertEq(detectSurfaceCue('go to the room'), 'rooms', 'cue: room → rooms');
  assertEq(detectSurfaceCue('open the chat thread'), 'chat', 'cue: first word chat → chat');
  assertEq(detectSurfaceCue('the goals list'), 'feed', 'cue: goals → feed');
  assertEq(detectSurfaceCue('agents dashboard'), 'office', 'cue: agents → office');
  assertEq(detectSurfaceCue('project files'), 'rooms', 'cue: project → rooms');
  assertEq(detectSurfaceCue('the conversation history'), 'chat', 'cue: conversation → chat');
  assertEq(detectSurfaceCue('nothing surface-y here'), null, 'cue: none → null');
  assertEq(detectSurfaceCue(null), null, 'cue: null → null');
  assertEq(detectSurfaceCue(42), null, 'cue: number → null');
  assertEq(detectSurfaceCue({}), null, 'cue: object → null');

  assertEq(homeSurfaceForKind('mission'), 'feed', 'home: mission → feed');
  assertEq(homeSurfaceForKind('task'), 'feed', 'home: task → feed');
  assertEq(homeSurfaceForKind('run'), 'office', 'home: run → office');
  assertEq(homeSurfaceForKind('agent'), 'office', 'home: agent → office');
  assertEq(homeSurfaceForKind('room'), 'rooms', 'home: room → rooms');
  assertEq(homeSurfaceForKind('thread'), 'chat', 'home: thread → chat');
  assertEq(homeSurfaceForKind('message'), 'chat', 'home: message → chat');
  assertEq(homeSurfaceForKind('bogus'), 'chat', 'home: junk kind → chat fallback');
  assertEq(homeSurfaceForKind(null), 'chat', 'home: null → chat');
  assertEq(homeSurfaceForKind(123), 'chat', 'home: number → chat');
  assertEq(homeSurfaceForKind('MISSION'), 'feed', 'home: case-insensitive kind');

  // ─── (K) surface override on the entity ─────────────────────────────────────
  {
    // an entity that pins its own surface overrides the kind's home
    const pinned: CrossSurfaceEntity = { kind: 'task', id: 'task_pinned', title: 'Zephyr rollout', surface: 'office' };
    const r = resolveCrossSurfaceReferences('zephyr rollout status', [pinned]);
    const m = findId(r, 'task_pinned');
    assert(!!m, '(K) pinned-surface entity matched');
    assertEq(m?.handle.surface, 'office', '(K) explicit entity.surface overrides kind home (task→feed)');
    assertEq(encodeEntityHandle(m!.handle), 'office:task:task_pinned', '(K) handle uses the pinned surface');
  }

  // ─── (I/HOSTILE) totality: never throw, never leak ──────────────────────────
  try {
    // degenerate messages → empty matches, valid shape
    for (const bad of [null, undefined, 42, NaN, true, {}, [], () => 'x', Symbol('s'), '', '   ', 9n]) {
      assert(totalOn(bad as unknown, ALL), 'hostile message is total', JSON.stringify(String(bad).slice(0, 16)));
      const r = resolveCrossSurfaceReferences(bad as unknown, ALL);
      assertEq(r.matches.length, 0, 'hostile message → no matches');
    }
    // non-array entities → empty matches, valid shape
    for (const bad of [null, undefined, 42, 'string', {}, NaN, true, () => 1]) {
      assert(totalOn('acme redesign', bad as unknown), 'non-array entities is total', JSON.stringify(String(bad).slice(0, 16)));
      assertEq(resolveCrossSurfaceReferences('acme redesign', bad as unknown).matches.length, 0, 'non-array entities → []');
    }
    // hostile opts
    assert(totalOn('acme redesign', ALL, 42), 'numeric opts total');
    assert(totalOn('acme redesign', ALL, 'nope'), 'string opts total');
    assert(totalOn('acme redesign', ALL, { maxMatches: NaN }), 'NaN maxMatches total');
    assert(totalOn('acme redesign', ALL, { maxMatches: Infinity }), 'Infinity maxMatches total');
    assert(totalOn('acme redesign', ALL, { minConfidence: 'bogus' as ReferenceConfidence }), 'bogus minConfidence total');
    assert(totalOn('acme redesign', ALL, { surfaceHint: 'nowhere' as never }), 'bogus surfaceHint total');

    // junk entity rows are individually skipped, valid ones still resolve
    const mixed = [null, 42, 'str', {}, [], NaN, true, missionAcme, { kind: 'bogus', id: 'x', title: 'y' }, { kind: 'mission', id: '', title: 'no id' }, { kind: 'mission', id: 'ok_id', title: '' }];
    assert(totalOn('acme redesign', mixed), 'mixed junk rows total');
    const mr = resolveCrossSurfaceReferences('acme redesign', mixed);
    assert(!!findId(mr, 'msn_acme01'), 'valid row among junk still resolves');
    assertEq(findId(mr, ''), undefined, 'empty-id row never emitted');
    assertEq(findId(mr, 'ok_id'), undefined, 'empty-title row never emitted');

    // cyclic entity — reading scalar fields must not traverse the cycle
    const cyc: Record<string, unknown> = { kind: 'task', id: 'task_cyc', title: 'Cyclic widget' };
    cyc.self = cyc;
    cyc.list = [cyc, cyc];
    assert(totalOn('cyclic widget task', [cyc]), 'cyclic entity is total');
    const cr = resolveCrossSurfaceReferences('cyclic widget', [cyc]);
    assert(!!findId(cr, 'task_cyc'), 'cyclic entity still matches by title');

    // throwing getters on kind/id/title — entity skipped, no throw
    const boom = (field: string): CrossSurfaceEntity => {
      const o: Record<string, unknown> = { kind: 'mission', id: 'msn_boom', title: 'Boom mission' };
      Object.defineProperty(o, field, { get() { throw new Error(`boom ${field}`); }, enumerable: true });
      return o as unknown as CrossSurfaceEntity;
    };
    for (const field of ['kind', 'id', 'title', 'status', 'surface', 'aliases']) {
      assert(totalOn('boom mission', [boom(field)]), `throwing getter on ${field} is total`);
    }
    // a throwing entity next to a good one: good one still resolves
    const good: CrossSurfaceEntity = { kind: 'mission', id: 'msn_good', title: 'Solid mission' };
    const withBoom = resolveCrossSurfaceReferences('solid mission', [boom('title'), good]);
    assert(!!findId(withBoom, 'msn_good'), 'good entity survives a throwing sibling');

    // secret-value-shaped title → rendered '[hidden]', never leaked
    const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const secretEntity: CrossSurfaceEntity = { kind: 'task', id: 'task_secret', title: JWT, status: 'todo' };
    const sr = resolveCrossSurfaceReferences(`please open ${JWT} now`, [secretEntity]);
    const sm = findId(sr, 'task_secret');
    assert(!!sm, 'secret-shaped title still matches (id stays navigable)');
    assertEq(sm?.title, '[hidden]', 'secret-value-shaped title → [hidden]');
    assertEq(sm?.matchedText, '[hidden]', 'secret-shaped matchedText → [hidden]');
    assert(!JSON.stringify(sr).includes('eyJ'), 'JWT never leaks into the result', JSON.stringify(sr).slice(0, 60));
    assert(encodeEntityHandle(sm!.handle).length > 0, 'secret-title match still has a usable handle');

    // long hex secret in an alias must not leak either
    const LONG_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const hexAlias: CrossSurfaceEntity = { kind: 'agent', id: 'agent_x', title: 'Helper', aliases: [LONG_HEX, 'helperbot'] };
    const hr = resolveCrossSurfaceReferences(`use ${LONG_HEX} please`, [hexAlias]);
    assert(!JSON.stringify(hr).includes('deadbeef'), 'secret-shaped alias never leaks');

    // control / line-sep / fence chars in title are stripped from output
    const nastyTitle = 'Ctrl' + String.fromCharCode(0) + 'Title' + String.fromCharCode(0x2028, 0x2029) + ' `code` </untrusted_quoted>';
    const nasty: CrossSurfaceEntity = { kind: 'room', id: 'room_nasty', title: nastyTitle, status: 'open' };
    const nr = resolveCrossSurfaceReferences('open the ctrl title code room', [nasty]);
    const nm = findId(nr, 'room_nasty');
    assert(!!nm, 'control-char title still matched');
    assert(!/[\u0000-\u001f]/.test(nm!.title), 'no control chars in emitted title');
    assert(!/[\u2028\u2029]/.test(nm!.title), 'no line separators in emitted title');
    assert(!nm!.title.includes('`'), 'no backtick fence char in emitted title');
    assert(!nm!.title.includes('<') && !nm!.title.includes('>'), 'no angle-bracket fence chars in emitted title');

    // unknown-kind / empty-id entities can never produce a match
    assertEq(resolveCrossSurfaceReferences('anything here', [{ kind: 'planet', id: 'p1', title: 'Mars' } as unknown as CrossSurfaceEntity]).matches.length, 0, 'unknown kind → no match');
    assertEq(resolveCrossSurfaceReferences('spaces here', [{ kind: 'task', id: 'has spaces', title: 'Spaces here' }]).matches.length, 0, 'unsafe id (spaces) rejected — cannot encode a handle');

    // huge title (spaced so it is not secret-shaped) stays clamped when matched
    const bigTitle = ('zeta ' + 'lorem ipsum dolor sit amet '.repeat(50)).trim();
    const bigEntity: CrossSurfaceEntity = { kind: 'mission', id: 'msn_big', title: bigTitle };
    const br = resolveCrossSurfaceReferences('the zeta lorem ipsum thing', [bigEntity]);
    const bm = findId(br, 'msn_big');
    if (bm) assert(bm.title.length <= MAX_TITLE_LEN, 'huge title clamped to MAX_TITLE_LEN', String(bm.title.length));

    // too-many aliases: capped, still total
    const manyAliases = Array.from({ length: 50 }, (_, i) => `alias${i}`);
    const aliasEntity: CrossSurfaceEntity = { kind: 'agent', id: 'agent_many', title: 'Overloaded', aliases: manyAliases };
    assert(totalOn('summon alias3 now', [aliasEntity]), 'many-alias entity is total');
    assert(MAX_ALIASES === 6, 'MAX_ALIASES is 6');

    // opts-less + entity-less permutations
    assert(resultIsValid(resolveCrossSurfaceReferences('anything', [])), 'empty entities → valid empty-ish result');
    assert(resultIsValid(resolveCrossSurfaceReferences(null, null)), 'null/null → valid result');

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (HOSTILE) sweep threw: ${(e as Error)?.message}`);
  }

  // ─── exported bound values are sane ─────────────────────────────────────────
  assertEq(MAX_MESSAGE_LEN, 4000, 'MAX_MESSAGE_LEN is 4000');
  assertEq(MAX_ENTITIES_SCANNED, 400, 'MAX_ENTITIES_SCANNED is 400');
  assertEq(MAX_MATCHES, 8, 'MAX_MATCHES is 8');
  assertEq(MAX_TITLE_LEN, 120, 'MAX_TITLE_LEN is 120');
  assertEq(MAX_MATCHED_TEXT_LEN, 80, 'MAX_MATCHED_TEXT_LEN is 80');
  assertEq(MIN_TOKEN_LEN, 3, 'MIN_TOKEN_LEN is 3');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll cross-surface-reference-resolver-core smoke cases passed (${passes} passed).`);
}

main();
