/**
 * cross-member-context-core-smoketest -- the PURE member-relative cross-member
 * context selector (src/lib/crossMemberContextCore.ts). Given the acting member
 * + the turn's focus scopes, it derives which teammate facts (in-flight overlap,
 * ownership, recent proof, co-working) bear on ME right now, from a bounded
 * activity stream. Load-bearing behavior asserted here:
 *
 *   (1) self-authored activity (memberId === actingMemberId) is excluded.
 *   (2) a teammate active_run on an in-scope mission -> exactly one
 *       in_flight_overlap fact + a non-null block whose '## Team activity
 *       relevant to you' header is OUTSIDE a single <untrusted_quoted> fence and
 *       whose teammate name sits INSIDE it.
 *   (3) narrowest scope wins -- an item matching both a focus task and its
 *       mission classifies as task-scoped ownership, not mission co_working.
 *   (4) finished_run older than the horizon is dropped; within it -> recent_proof.
 *   (5) fairness cap -- one teammate with 5 matching items yields <= maxPerTeammate
 *       facts while counts reflect the TRUE pre-cap totals.
 *   (6) determinism -- identical inputs -> byte-identical JSON (two calls).
 *   (7) HOSTILE -- null/undefined/number/{}/[]/NaN/bigint/huge/control-chars/
 *       astral-at-boundary/lone-surrogate/cyclic/throwing-proxy/secret-shaped/
 *       __proto__+constructor keys never throw and yield safe, bounded,
 *       surrogate-safe, secret-free output.
 *
 * Pure -- loads under tsx (the core has zero runtime imports).
 * Run: npx tsx scripts/cross-member-context-core-smoketest.ts
 */

import {
  deriveCrossMemberContext,
  renderCrossMemberContextBlock,
  emptyCrossMemberContext,
  MAX_ACTIVITY_SCANNED,
  MAX_FOCUS_SCOPES,
  MAX_FACTS,
  DEFAULT_MAX_FACTS,
  DEFAULT_MAX_PER_TEAMMATE,
  DEFAULT_RECENT_PROOF_HORIZON_MS,
  MAX_TITLE_LEN,
  MAX_NAME_LEN,
  MAX_ID_LEN,
  MAX_STATUS_LEN,
  MAX_NOTE_LEN,
  MAX_BLOCK_CHARS,
  KIND_SEVERITY,
  SCOPE_SPECIFICITY_BONUS,
  FACT_KINDS,
  SCOPE_KINDS,
  type CrossMemberFact,
  type CrossMemberContextResult,
} from '../src/lib/crossMemberContextCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertLE(a: number, b: number, msg: string): void {
  assert(typeof a === 'number' && a <= b, msg, `got ${a} want <= ${b}`);
}
function assertIncludes(hay: unknown, needle: string, msg: string): void {
  assert(typeof hay === 'string' && hay.includes(needle), msg, `${JSON.stringify(hay)} missing "${needle}"`);
}
function assertExcludes(hay: unknown, needle: string, msg: string): void {
  assert(typeof hay === 'string' && !hay.includes(needle), msg, `${JSON.stringify(hay)} unexpectedly has "${needle}"`);
}
function assertNoThrow(fn: () => void, msg: string): void {
  let threw = false; let err = '';
  try { fn(); } catch (e) { threw = true; err = String(e); }
  assert(!threw, msg, err);
}

// --- control-char / code-point helpers (built, never raw literals) -----------
const NUL = String.fromCharCode(0);
const BEL = String.fromCharCode(7);
const ESC = String.fromCharCode(0x1b);
const DEL = String.fromCharCode(0x7f);
const C1 = String.fromCharCode(0x85);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const ZWSP = String.fromCharCode(0x200b);
const WJ = String.fromCharCode(0x2060);
const RLO = String.fromCharCode(0x202e);
const BOM = String.fromCharCode(0xfeff);
const TAG = String.fromCodePoint(0xe0041); // Unicode Tag block (astral)
const EMOJI = String.fromCodePoint(0x1f600); // astral grin (valid surrogate pair)
const LONE_HI = String.fromCharCode(0xd83d); // lone high surrogate
const LONE_LO = String.fromCharCode(0xdc00); // lone low surrogate
const FENCE_OPEN = '<untrusted_quoted>';
const FENCE_CLOSE = '</untrusted_quoted>';
const HEADER = '## Team activity relevant to you';

const cpLen = (s: string): number => Array.from(s).length;

/** No control / DEL / C1 / line-sep / format (zero-width, bidi) / Tag / lone-surrogate / fence char. */
function isCleanLabel(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of Array.from(s)) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f)) return false;
    if (c === 0x2028 || c === 0x2029) return false;
    if (c === 0x200b || c === 0x200c || c === 0x200d || c === 0x200e || c === 0x200f) return false;
    if (c === 0x2060 || c === 0xfeff || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) return false;
    if (c >= 0xe0000 && c <= 0xe007f) return false;
    if (ch.length === 1 && c >= 0xd800 && c <= 0xdfff) return false; // lone surrogate
    if (c === 0x3c || c === 0x3e || c === 0x60) return false; // < > backtick
  }
  return true;
}
function hasLoneSurrogate(s: string): boolean {
  for (const ch of Array.from(s)) {
    if (ch.length === 1) {
      const c = ch.charCodeAt(0);
      if (c >= 0xd800 && c <= 0xdfff) return true;
    }
  }
  return false;
}
/** Any obvious secret material still present? */
function looksSecret(s: string): boolean {
  if (typeof s !== 'string') return false;
  if (/eyJ[A-Za-z0-9_-]{8,}/.test(s)) return true;
  if (/\b[A-Fa-f0-9]{32,}\b/.test(s)) return true;
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(s)) return true;
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/.test(s)) return true;
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(s)) return true;
  return false;
}

const FACT_KIND_SET = new Set<string>(FACT_KINDS as readonly string[]);
const SCOPE_KIND_SET = new Set<string>(SCOPE_KINDS as readonly string[]);

/** Structural + bounds + safety check for one fact. */
function factWellFormed(f: CrossMemberFact): boolean {
  return (
    !!f && typeof f === 'object' &&
    FACT_KIND_SET.has(f.kind) &&
    typeof f.memberId === 'string' && f.memberId.length > 0 && f.memberId.length <= MAX_ID_LEN && isCleanLabel(f.memberId) &&
    typeof f.memberName === 'string' && f.memberName.length > 0 && f.memberName.length <= MAX_NAME_LEN && isCleanLabel(f.memberName) && !hasLoneSurrogate(f.memberName) &&
    SCOPE_KIND_SET.has(f.scopeKind) &&
    typeof f.scopeId === 'string' && f.scopeId.length > 0 && f.scopeId.length <= MAX_ID_LEN && isCleanLabel(f.scopeId) &&
    typeof f.scopeTitle === 'string' && f.scopeTitle.length <= MAX_TITLE_LEN && isCleanLabel(f.scopeTitle) && !hasLoneSurrogate(f.scopeTitle) &&
    typeof f.itemTitle === 'string' && f.itemTitle.length <= MAX_TITLE_LEN && isCleanLabel(f.itemTitle) && !hasLoneSurrogate(f.itemTitle) &&
    typeof f.status === 'string' && f.status.length <= MAX_STATUS_LEN && isCleanLabel(f.status) &&
    typeof f.score === 'number' && Number.isFinite(f.score) && f.score >= 0 && f.score <= 1 &&
    (f.ageMs === null || (typeof f.ageMs === 'number' && Number.isFinite(f.ageMs))) &&
    typeof f.note === 'string' && f.note.length > 0 && f.note.length <= MAX_NOTE_LEN && isCleanLabel(f.note) && !hasLoneSurrogate(f.note) &&
    !looksSecret(f.memberName) && !looksSecret(f.itemTitle) && !looksSecret(f.scopeTitle) && !looksSecret(f.note)
  );
}
function resultWellFormed(r: CrossMemberContextResult): boolean {
  if (!r || typeof r !== 'object') return false;
  if (!Array.isArray(r.facts) || r.facts.length > MAX_FACTS) return false;
  if (!r.facts.every(factWellFormed)) return false;
  const c = r.counts;
  if (!c || typeof c !== 'object') return false;
  const nums = [c.inFlightOverlap, c.ownership, c.recentProof, c.coWorking, c.teammates];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return false;
  if (r.block !== null) {
    if (typeof r.block !== 'string') return false;
    if (r.block.length > MAX_BLOCK_CHARS) return false;
    if (hasLoneSurrogate(r.block)) return false;
    if (looksSecret(r.block)) return false;
  }
  return true;
}

const NOW = 1_700_000_000_000;
const baseFocus = {
  actingMemberId: 'me',
  scopes: [
    { kind: 'mission', id: 'm1', title: 'Launch' },
    { kind: 'task', id: 't1', title: 'Auth' },
    { kind: 'room', id: 'r1', title: 'General' },
  ],
};

function main(): void {
  // --- exported bounds are the spec values -----------------------------------
  assertEq(MAX_ACTIVITY_SCANNED, 400, 'bound MAX_ACTIVITY_SCANNED');
  assertEq(MAX_FOCUS_SCOPES, 40, 'bound MAX_FOCUS_SCOPES');
  assertEq(MAX_FACTS, 10, 'bound MAX_FACTS');
  assertEq(DEFAULT_MAX_FACTS, 6, 'bound DEFAULT_MAX_FACTS');
  assertEq(DEFAULT_MAX_PER_TEAMMATE, 2, 'bound DEFAULT_MAX_PER_TEAMMATE');
  assertEq(DEFAULT_RECENT_PROOF_HORIZON_MS, 86_400_000, 'bound DEFAULT_RECENT_PROOF_HORIZON_MS');
  assertEq(MAX_BLOCK_CHARS, 2500, 'bound MAX_BLOCK_CHARS');
  assert(KIND_SEVERITY.in_flight_overlap > KIND_SEVERITY.ownership, 'severity in_flight > ownership');
  assert(KIND_SEVERITY.ownership > KIND_SEVERITY.recent_proof, 'severity ownership > recent_proof');
  assert(KIND_SEVERITY.recent_proof > KIND_SEVERITY.co_working, 'severity recent_proof > co_working');
  assert(SCOPE_SPECIFICITY_BONUS.task > SCOPE_SPECIFICITY_BONUS.room, 'specificity task > room');
  assert(SCOPE_SPECIFICITY_BONUS.room > SCOPE_SPECIFICITY_BONUS.mission, 'specificity room > mission');

  // --- emptyCrossMemberContext helper ----------------------------------------
  {
    const e = emptyCrossMemberContext();
    assert(resultWellFormed(e), 'empty helper well-formed');
    assertEq(e.facts.length, 0, 'empty helper has no facts');
    assertEq(e.block, null, 'empty helper block null');
    assertEq(e.counts.teammates, 0, 'empty helper teammates 0');
  }

  // --- (1) self-exclusion -----------------------------------------------------
  {
    const activity = [
      { memberId: 'me', memberName: 'Me', kind: 'active_run', missionId: 'm1', title: 'my own work' },
      { memberId: 'alice', memberName: 'Alice', kind: 'active_run', missionId: 'm1', title: 'Fix login' },
    ];
    const r = deriveCrossMemberContext(baseFocus, activity, { nowMs: NOW });
    assert(resultWellFormed(r), '(1) result well-formed');
    assertEq(r.facts.length, 1, '(1) only the teammate fact survives (self dropped)');
    assertEq(r.facts[0].memberId, 'alice', '(1) surviving fact is the teammate');
    assert(r.facts.every((f) => f.memberId !== 'me'), '(1) no self-authored fact');
    assertExcludes(r.block, 'my own work', '(1) self item never rendered');
  }

  // --- (2) in_flight_overlap + fenced block structure ------------------------
  {
    const activity = [
      { memberId: 'alice', memberName: 'Alice Ng', kind: 'active_run', missionId: 'm1', title: 'Fix login', status: 'running', atMs: NOW - 1000 },
    ];
    const r = deriveCrossMemberContext(baseFocus, activity, { nowMs: NOW });
    assert(resultWellFormed(r), '(2) result well-formed');
    assertEq(r.facts.length, 1, '(2) exactly one fact');
    assertEq(r.facts[0].kind, 'in_flight_overlap', '(2) active_run -> in_flight_overlap');
    assertEq(r.facts[0].scopeKind, 'mission', '(2) matched the mission scope');
    assertEq(r.facts[0].scopeTitle, 'Launch', '(2) scope title resolved from focus');
    assertEq(r.counts.inFlightOverlap, 1, '(2) count reflects the fact');
    assertEq(r.counts.teammates, 1, '(2) one teammate');
    assert(typeof r.block === 'string' && r.block!.length > 0, '(2) block is non-null');
    assertIncludes(r.block, HEADER, '(2) block carries the trusted header');
    assertIncludes(r.block, 'Alice Ng', '(2) block names the teammate');
    assertIncludes(r.block, FENCE_OPEN, '(2) block opens the untrusted fence');
    assertIncludes(r.block, FENCE_CLOSE, '(2) block closes the untrusted fence');
    // header OUTSIDE fence, name INSIDE fence
    const b = r.block as string;
    assert(b.indexOf(HEADER) < b.indexOf(FENCE_OPEN), '(2) header sits OUTSIDE (before) the fence');
    assert(b.indexOf('Alice Ng') > b.indexOf(FENCE_OPEN), '(2) teammate name sits INSIDE the fence');
    assert(b.indexOf('Alice Ng') < b.indexOf(FENCE_CLOSE), '(2) name is before the closing fence');
    assertEq(renderCrossMemberContextBlock(r), r.block, '(2) render(result) reproduces result.block');
  }

  // --- (3) narrowest scope wins ----------------------------------------------
  {
    // An assignment carrying BOTH a focus task and its focus mission.
    const activity = [
      { memberId: 'bob', memberName: 'Bob', kind: 'assignment', taskId: 't1', missionId: 'm1', title: 'Auth work' },
    ];
    const r = deriveCrossMemberContext(baseFocus, activity, { nowMs: NOW });
    assertEq(r.facts.length, 1, '(3) one fact');
    assertEq(r.facts[0].scopeKind, 'task', '(3) narrowest scope is the task');
    assertEq(r.facts[0].scopeId, 't1', '(3) matched task id');
    assertEq(r.facts[0].kind, 'ownership', '(3) assignment on a task scope -> ownership (not co_working)');
    assertEq(r.counts.ownership, 1, '(3) ownership counted');
    assertEq(r.counts.coWorking, 0, '(3) NOT counted as co_working');
    // room beats mission when both present but no task
    const r2 = deriveCrossMemberContext(baseFocus, [
      { memberId: 'bob', memberName: 'Bob', kind: 'assignment', roomId: 'r1', missionId: 'm1' },
    ], { nowMs: NOW });
    assertEq(r2.facts[0].scopeKind, 'room', '(3) room beats mission when task absent');
    assertEq(r2.facts[0].kind, 'co_working', '(3) assignment on a room scope -> co_working');
  }

  // --- (4) recent_proof horizon ----------------------------------------------
  {
    const within = deriveCrossMemberContext(baseFocus, [
      { memberId: 'carol', memberName: 'Carol', kind: 'finished_run', missionId: 'm1', title: 'Shipped', atMs: NOW - 1000 },
    ], { nowMs: NOW });
    assertEq(within.facts.length, 1, '(4) fresh finished_run kept');
    assertEq(within.facts[0].kind, 'recent_proof', '(4) fresh finished_run -> recent_proof');
    assertEq(within.counts.recentProof, 1, '(4) recentProof counted');

    const stale = deriveCrossMemberContext(baseFocus, [
      { memberId: 'carol', memberName: 'Carol', kind: 'finished_run', missionId: 'm1', title: 'Old', atMs: NOW - 3 * 86_400_000 },
    ], { nowMs: NOW });
    assertEq(stale.facts.length, 0, '(4) finished_run older than horizon dropped');
    assertEq(stale.block, null, '(4) no facts -> null block');

    const undated = deriveCrossMemberContext(baseFocus, [
      { memberId: 'carol', memberName: 'Carol', kind: 'finished_run', missionId: 'm1', title: 'No date' },
    ], { nowMs: NOW });
    assertEq(undated.facts.length, 0, '(4) undated finished_run dropped (unknown recency, fail-closed)');

    // a custom (larger) horizon keeps a run the default would drop
    const wide = deriveCrossMemberContext(baseFocus, [
      { memberId: 'carol', memberName: 'Carol', kind: 'finished_run', missionId: 'm1', title: 'Old', atMs: NOW - 3 * 86_400_000 },
    ], { nowMs: NOW, recentProofHorizonMs: 7 * 86_400_000 });
    assertEq(wide.facts.length, 1, '(4) wider horizon keeps the older proof');
  }

  // --- (5) fairness cap + pre-cap counts -------------------------------------
  {
    const focus5 = {
      actingMemberId: 'me',
      scopes: [
        { kind: 'task', id: 't1', title: 'T1' },
        { kind: 'task', id: 't2', title: 'T2' },
        { kind: 'task', id: 't3', title: 'T3' },
        { kind: 'task', id: 't4', title: 'T4' },
        { kind: 'task', id: 't5', title: 'T5' },
      ],
    };
    const activity = ['t1', 't2', 't3', 't4', 't5'].map((tid, i) => ({
      memberId: 'spammer', memberName: 'Spammer', kind: 'active_run', taskId: tid, title: `run ${i}`, atMs: NOW - i * 1000,
    }));
    const r = deriveCrossMemberContext(focus5, activity, { nowMs: NOW, maxPerTeammate: 2 });
    assertEq(r.facts.length, 2, '(5) per-teammate cap limits emitted facts to maxPerTeammate');
    assert(r.facts.every((f) => f.memberId === 'spammer'), '(5) all capped facts are the one teammate');
    assertEq(r.counts.inFlightOverlap, 5, '(5) counts reflect TRUE pre-cap totals');
    assertEq(r.counts.teammates, 1, '(5) one distinct teammate');
    // default per-teammate cap (2) applies when unset
    const rDefault = deriveCrossMemberContext(focus5, activity, { nowMs: NOW });
    assertEq(rDefault.facts.length, DEFAULT_MAX_PER_TEAMMATE, '(5) default maxPerTeammate applies');
    // two teammates each over the cap, but different members interleave
    const twoTeams = [
      ...['t1', 't2', 't3'].map((tid) => ({ memberId: 'a', memberName: 'A', kind: 'active_run', taskId: tid })),
      ...['t4', 't5'].map((tid) => ({ memberId: 'b', memberName: 'B', kind: 'active_run', taskId: tid })),
    ];
    const rt = deriveCrossMemberContext(focus5, twoTeams, { nowMs: NOW, maxPerTeammate: 1, maxFacts: 6 });
    assertEq(rt.facts.length, 2, '(5) maxPerTeammate 1 across two teammates -> 2 facts');
    assertEq(new Set(rt.facts.map((f) => f.memberId)).size, 2, '(5) both teammates represented');
    assertEq(rt.counts.inFlightOverlap, 5, '(5) pre-cap total across teammates is 5');
  }

  // --- ranking order (severity ladder) ---------------------------------------
  {
    const activity = [
      { memberId: 'd', memberName: 'D', kind: 'assignment', missionId: 'm1' }, // co_working 0.55
      { memberId: 'c', memberName: 'C', kind: 'finished_run', missionId: 'm1', atMs: NOW - 100 }, // recent_proof
      { memberId: 'b', memberName: 'B', kind: 'assignment', taskId: 't1', missionId: 'm1' }, // ownership (task)
      { memberId: 'a', memberName: 'A', kind: 'active_run', taskId: 't1' }, // in_flight (task)
    ];
    const r = deriveCrossMemberContext(baseFocus, activity, { nowMs: NOW, maxFacts: 6 });
    assertEq(r.facts.length, 4, 'rank: four distinct facts');
    assertEq(r.facts[0].kind, 'in_flight_overlap', 'rank: in_flight_overlap first');
    assertEq(r.facts[1].kind, 'ownership', 'rank: ownership second');
    assertEq(r.facts[2].kind, 'recent_proof', 'rank: recent_proof third');
    assertEq(r.facts[3].kind, 'co_working', 'rank: co_working last');
    for (let i = 1; i < r.facts.length; i += 1) {
      assert(r.facts[i - 1].score >= r.facts[i].score, `rank: score monotonically non-increasing at ${i}`);
    }
  }

  // --- dedupe (memberId, scopeId, kind) --------------------------------------
  {
    const activity = [
      { memberId: 'a', memberName: 'A', kind: 'active_run', missionId: 'm1', title: 'first', atMs: NOW - 10_000 },
      { memberId: 'a', memberName: 'A', kind: 'active_run', missionId: 'm1', title: 'second', atMs: NOW - 100 }, // fresher -> wins tie
    ];
    const r = deriveCrossMemberContext(baseFocus, activity, { nowMs: NOW });
    assertEq(r.facts.length, 1, 'dedupe: same (member, scope, kind) collapses to one');
    assertEq(r.counts.inFlightOverlap, 1, 'dedupe: count is post-dedupe');
    // a different kind on the same scope is NOT deduped away
    const activity2 = [
      { memberId: 'a', memberName: 'A', kind: 'active_run', missionId: 'm1' },
      { memberId: 'a', memberName: 'A', kind: 'assignment', missionId: 'm1' },
    ];
    const r2 = deriveCrossMemberContext(baseFocus, activity2, { nowMs: NOW, maxPerTeammate: 5 });
    assertEq(r2.facts.length, 2, 'dedupe: different kinds on same scope both kept');
  }

  // --- focus / acting-member validation --------------------------------------
  {
    assertEq(deriveCrossMemberContext(baseFocus, [], { nowMs: NOW }).facts.length, 0, 'empty activity -> no facts');
    assertEq(deriveCrossMemberContext(baseFocus, [], { nowMs: NOW }).block, null, 'empty activity -> null block');
    // no focus scopes -> empty
    const noScope = deriveCrossMemberContext({ actingMemberId: 'me', scopes: [] }, [
      { memberId: 'a', memberName: 'A', kind: 'active_run', missionId: 'm1' },
    ], { nowMs: NOW });
    assertEq(noScope.facts.length, 0, 'no focus scope -> nothing to overlap -> empty');
    // missing acting member -> empty (cannot establish "me")
    const noMe = deriveCrossMemberContext({ scopes: baseFocus.scopes }, [
      { memberId: 'a', memberName: 'A', kind: 'active_run', missionId: 'm1' },
    ], { nowMs: NOW });
    assertEq(noMe.facts.length, 0, 'missing actingMemberId -> empty (fail closed)');
    // item on an out-of-focus scope -> dropped
    const offScope = deriveCrossMemberContext(baseFocus, [
      { memberId: 'a', memberName: 'A', kind: 'active_run', missionId: 'not-in-focus' },
    ], { nowMs: NOW });
    assertEq(offScope.facts.length, 0, 'off-focus scope item dropped (no cross-inference)');
    // item with no scope ids at all -> dropped
    const noScopeId = deriveCrossMemberContext(baseFocus, [
      { memberId: 'a', memberName: 'A', kind: 'active_run' },
    ], { nowMs: NOW });
    assertEq(noScopeId.facts.length, 0, 'item with no scope id dropped');
    // unknown item kind -> dropped
    const badKind = deriveCrossMemberContext(baseFocus, [
      { memberId: 'a', memberName: 'A', kind: 'gossip', missionId: 'm1' },
    ], { nowMs: NOW });
    assertEq(badKind.facts.length, 0, 'unknown activity kind dropped');
  }

  // --- maxFacts clamp + global slice -----------------------------------------
  {
    // 12 distinct teammates each with one in-scope run; default maxFacts 6.
    const many = Array.from({ length: 12 }, (_, i) => ({
      memberId: `u${i}`, memberName: `U${i}`, kind: 'active_run', missionId: 'm1', atMs: NOW - i,
    }));
    const r = deriveCrossMemberContext(baseFocus, many, { nowMs: NOW });
    assertEq(r.facts.length, DEFAULT_MAX_FACTS, 'maxFacts default caps emitted facts to 6');
    assertEq(r.counts.inFlightOverlap, 12, 'counts reflect all 12 pre-slice');
    assertEq(r.counts.teammates, 12, 'teammates counted pre-slice');
    const rHi = deriveCrossMemberContext(baseFocus, many, { nowMs: NOW, maxFacts: 999 });
    assertLE(rHi.facts.length, MAX_FACTS, 'maxFacts clamped to hard MAX_FACTS');
    assertEq(rHi.facts.length, MAX_FACTS, 'maxFacts 999 -> exactly MAX_FACTS');
    const rZero = deriveCrossMemberContext(baseFocus, many, { nowMs: NOW, maxFacts: 0 });
    assertEq(rZero.facts.length, 0, 'maxFacts 0 -> no facts');
    assertEq(rZero.block, null, 'maxFacts 0 -> null block');
  }

  // --- (6) determinism --------------------------------------------------------
  {
    const focus = {
      actingMemberId: 'me',
      scopes: [
        { kind: 'mission', id: 'm1', title: 'Launch' },
        { kind: 'task', id: 't1', title: 'Auth' },
        { kind: 'room', id: 'r1', title: 'Room' },
      ],
    };
    const activity = [
      { memberId: 'me', memberName: 'Me', kind: 'active_run', missionId: 'm1' },
      { memberId: 'alice', memberName: 'Alice', kind: 'active_run', taskId: 't1', atMs: NOW - 500 },
      { memberId: 'bob', memberName: 'Bob', kind: 'assignment', roomId: 'r1' },
      { memberId: 'carol', memberName: 'Carol', kind: 'finished_run', missionId: 'm1', atMs: NOW - 3000 },
      { memberId: 'alice', memberName: 'Alice', kind: 'assignment', taskId: 't1' },
    ];
    const a = deriveCrossMemberContext(focus, activity, { nowMs: NOW });
    const b = deriveCrossMemberContext(focus, activity, { nowMs: NOW });
    assertEq(JSON.stringify(a), JSON.stringify(b), '(6) identical inputs -> byte-identical JSON');
    assert(resultWellFormed(a), '(6) determinism sample well-formed');
    // render is also stable + matches the precomputed block
    assertEq(renderCrossMemberContextBlock(a), a.block === null ? '' : a.block, '(6) render matches precomputed block');
  }

  // --- secret-safety on titles / names ---------------------------------------
  {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    const activity = [
      { memberId: 'a', memberName: 'sk-ant-abcdef0123456789abcdef0123', kind: 'active_run', missionId: 'm1', title: jwt, status: 'running' },
      { memberId: 'b', memberName: 'Bob', kind: 'active_run', missionId: 'm1', title: `token ${jwt} here` },
    ];
    const r = deriveCrossMemberContext(baseFocus, activity, { nowMs: NOW, maxPerTeammate: 5 });
    assert(resultWellFormed(r), 'secret: result well-formed');
    const fa = r.facts.find((f) => f.memberId === 'a')!;
    assertEq(fa.memberName, '[hidden]', 'secret: whole secret-shaped name -> [hidden]');
    assertEq(fa.itemTitle, '[hidden]', 'secret: whole JWT title -> [hidden]');
    const fb = r.facts.find((f) => f.memberId === 'b')!;
    assertIncludes(fb.itemTitle, '[hidden]', 'secret: embedded JWT masked inline');
    assertExcludes(fb.itemTitle, 'eyJhbGci', 'secret: no JWT prefix leaks');
    assert(!looksSecret(r.block as string), 'secret: rendered block carries no secret material');
    assertExcludes(r.block, 'sk-ant-abcdef0123456789', 'secret: no sk- key in block');
  }

  // --- unicode hygiene in fields ---------------------------------------------
  {
    const r = deriveCrossMemberContext(baseFocus, [
      { memberId: 'a', memberName: `Ca${LS}rol${PS}`, kind: 'active_run', missionId: 'm1', title: `Fix ${EMOJI} bug` },
      { memberId: 'b', memberName: `Bad${LONE_HI}end`, kind: 'active_run', taskId: 't1', title: `Tag${TAG}here` },
      { memberId: 'c', memberName: `Zero${ZWSP}Width${WJ}`, kind: 'active_run', roomId: 'r1', title: `${RLO}flip${BOM}` },
    ], { nowMs: NOW, maxPerTeammate: 5 });
    assert(resultWellFormed(r), 'unicode: result well-formed after scrubbing');
    const fa = r.facts.find((f) => f.memberId === 'a')!;
    assert(isCleanLabel(fa.memberName), 'unicode: line/para separators stripped from name');
    assert(Array.from(fa.itemTitle).includes(EMOJI), 'unicode: valid astral emoji preserved intact');
    assert(!hasLoneSurrogate(fa.itemTitle), 'unicode: emoji is a balanced pair, no lone surrogate');
    const fb = r.facts.find((f) => f.memberId === 'b')!;
    assert(!hasLoneSurrogate(fb.memberName), 'unicode: lone surrogate stripped from name');
    assertExcludes(fb.itemTitle, TAG, 'unicode: Unicode Tag char stripped from title');
    const fc = r.facts.find((f) => f.memberId === 'c')!;
    assert(isCleanLabel(fc.memberName), 'unicode: zero-width / word-joiner stripped');
    assert(isCleanLabel(fc.itemTitle), 'unicode: bidi override / BOM stripped');
    assert(!hasLoneSurrogate(r.block as string), 'unicode: block has no lone surrogate');
    assert(isCleanLabel(r.facts[0].note), 'unicode: note stays clean');
  }

  // --- title / name length clamps --------------------------------------------
  {
    const longName = 'N'.repeat(500);
    const longTitle = 'T'.repeat(500);
    const r = deriveCrossMemberContext(baseFocus, [
      { memberId: 'a', memberName: longName, kind: 'active_run', missionId: 'm1', title: longTitle, status: 'S'.repeat(200) },
    ], { nowMs: NOW });
    const f = r.facts[0];
    assertLE(f.memberName.length, MAX_NAME_LEN, 'clamp: memberName <= MAX_NAME_LEN');
    assertLE(f.itemTitle.length, MAX_TITLE_LEN, 'clamp: itemTitle <= MAX_TITLE_LEN');
    assertLE(f.status.length, MAX_STATUS_LEN, 'clamp: status <= MAX_STATUS_LEN');
    assertLE(f.note.length, MAX_NOTE_LEN, 'clamp: note <= MAX_NOTE_LEN');
    assertLE(cpLen(f.memberName), MAX_NAME_LEN, 'clamp: memberName code points <= MAX_NAME_LEN');
  }

  // --- long ids clamp; oversized focus scope list bounded --------------------
  {
    const longId = 'x'.repeat(400);
    const scopes = Array.from({ length: 100 }, (_, i) => ({ kind: 'task', id: `t${i}`, title: `T${i}` }));
    scopes.push({ kind: 'task', id: longId, title: 'Long' });
    const r = deriveCrossMemberContext({ actingMemberId: 'me', scopes }, [
      { memberId: 'a', memberName: 'A', kind: 'active_run', taskId: 't0' },
      { memberId: 'b', memberName: 'B', kind: 'active_run', taskId: 't39' }, // within first MAX_FOCUS_SCOPES
      { memberId: 'c', memberName: 'C', kind: 'active_run', taskId: 't80' }, // beyond MAX_FOCUS_SCOPES -> dropped
    ], { nowMs: NOW, maxPerTeammate: 5 });
    assert(resultWellFormed(r), 'focus bound: result well-formed');
    assert(r.facts.some((f) => f.memberId === 'a'), 'focus bound: early scope matched');
    assert(!r.facts.some((f) => f.memberId === 'c'), 'focus bound: scope beyond MAX_FOCUS_SCOPES ignored');
    for (const f of r.facts) assertLE(f.scopeId.length, MAX_ID_LEN, 'focus bound: scopeId within MAX_ID_LEN');
  }

  // --- (7) HOSTILE inputs ------------------------------------------------------
  const cyclic: Record<string, unknown> = { memberId: 'cyc', memberName: 'Cyc', kind: 'active_run', missionId: 'm1' };
  cyclic.self = cyclic;
  const throwingItem = {
    kind: 'active_run', missionId: 'm1',
    get memberId(): string { throw new Error('boom-memberId'); },
  };
  const throwingProxy = new Proxy({}, {
    get() { throw new Error('boom-get'); },
    has() { throw new Error('boom-has'); },
    ownKeys() { throw new Error('boom-keys'); },
    getOwnPropertyDescriptor() { throw new Error('boom-desc'); },
  });
  // ids reference the matching proto-scope focus (mission __proto__, task constructor)
  const protoItem = JSON.parse('{"memberId":"__proto__","kind":"active_run","missionId":"__proto__","memberName":"Proto"}');
  const ctorItem = { memberId: 'constructor', kind: 'active_run', taskId: 'constructor', memberName: 'Ctor' };
  const protoScopeFocus = JSON.parse('{"actingMemberId":"me","scopes":[{"kind":"mission","id":"__proto__","title":"P"},{"kind":"task","id":"constructor","title":"C"}]}');
  const hugeActivity = Array.from({ length: 10_000 }, (_, i) => ({
    memberId: `u${i % 50}`, memberName: `U${i % 50}`, kind: 'active_run', missionId: 'm1', atMs: NOW - i,
  }));
  const surrogateFocusTitle = { actingMemberId: 'me', scopes: [{ kind: 'mission', id: 'm1', title: `Boundary${LONE_LO}${TAG}` }] };
  const ctrlActivity = [
    { memberId: `a${NUL}${BEL}`, memberName: `X${ESC}${DEL}${C1}Y`, kind: 'active_run', missionId: 'm1', title: `t${NUL}${LS}i` },
  ];

  const hostileFocuses: Array<[string, unknown]> = [
    ['null', null], ['undefined', undefined], ['number', 42], ['NaN', NaN], ['boolean', true],
    ['empty-object', {}], ['array', []], ['bigint', 10n], ['string', 'focus'],
    ['string-secret', 'eyJhbGciOiJ.aaaaaaaa.bbbbbbbb'],
    ['throwing-proxy', throwingProxy], ['proto-scopes', protoScopeFocus],
    ['surrogate-focus-title', surrogateFocusTitle], ['valid', baseFocus],
  ];
  const hostileActivities: Array<[string, unknown]> = [
    ['null', null], ['undefined', undefined], ['number', 7], ['NaN', NaN], ['boolean', false],
    ['object', {}], ['bigint', 3n], ['string', 'activity'],
    ['cyclic', [cyclic]], ['throwing-item', [throwingItem]], ['throwing-proxy', throwingProxy],
    ['proto-item', [protoItem]], ['ctor-item', [ctorItem]], ['ctrl-item', ctrlActivity],
    ['huge', hugeActivity], ['array-of-junk', [null, undefined, 1, 'x', {}, [], 10n, NaN, true]],
    ['nested-arrays', [[{ memberId: 'a', kind: 'active_run', missionId: 'm1' }]]],
  ];
  const hostileOpts: Array<[string, unknown]> = [
    ['null', null], ['undefined', undefined], ['nan-now', { nowMs: NaN }], ['neg-horizon', { recentProofHorizonMs: -5 }],
    ['bigint-now', { nowMs: 5n }], ['huge-maxfacts', { maxFacts: 1e9 }], ['neg-maxfacts', { maxFacts: -3 }],
    ['zero-per', { maxPerTeammate: 0 }], ['string-opts', 'opts'], ['array-opts', []],
  ];

  for (const [fl, focus] of hostileFocuses) {
    for (const [al, activity] of hostileActivities) {
      assertNoThrow(() => {
        const r = deriveCrossMemberContext(focus, activity, { nowMs: NOW });
        assert(resultWellFormed(r), `(7) result well-formed :: focus=${fl} activity=${al}`);
        assertEq(renderCrossMemberContextBlock(r), r.block === null ? '' : r.block, `(7) render consistent :: focus=${fl} activity=${al}`);
      }, `(7) derive never throws :: focus=${fl} activity=${al}`);
    }
  }
  for (const [ol, opts] of hostileOpts) {
    assertNoThrow(() => {
      const r = deriveCrossMemberContext(baseFocus, hugeActivity, opts);
      assert(resultWellFormed(r), `(7) opts result well-formed :: opts=${ol}`);
    }, `(7) derive never throws with hostile opts :: opts=${ol}`);
  }

  // render() total on hostile shapes
  for (const [label, shape] of [
    ['null', null], ['undefined', undefined], ['number', 1], ['string', 's'], ['array', []],
    ['facts-not-array', { facts: 'x' }], ['facts-junk', { facts: [null, 1, {}, { note: 123 }] }],
    ['facts-secret-note', { facts: [{ note: 'leak eyJaaaaaaaa.bbbbbbbb.cccccccc token' }] }],
    ['throwing-proxy', throwingProxy],
  ] as Array<[string, unknown]>) {
    assertNoThrow(() => {
      const out = renderCrossMemberContextBlock(shape);
      assert(typeof out === 'string', `(7) render returns string :: ${label}`);
      assertLE(out.length, MAX_BLOCK_CHARS, `(7) render bounded :: ${label}`);
      assert(!hasLoneSurrogate(out), `(7) render surrogate-safe :: ${label}`);
      assert(!looksSecret(out), `(7) render secret-safe :: ${label}`);
    }, `(7) render never throws :: ${label}`);
  }

  // specific hostile outcomes
  {
    // throwing memberId getter -> item silently dropped
    const r = deriveCrossMemberContext(baseFocus, [throwingItem, { memberId: 'ok', memberName: 'OK', kind: 'active_run', missionId: 'm1' }], { nowMs: NOW });
    assertEq(r.facts.length, 1, '(7) throwing-getter item dropped, healthy sibling kept');
    assertEq(r.facts[0].memberId, 'ok', '(7) healthy item survives beside a throwing one');
  }
  {
    // __proto__ / constructor ids used only as string keys -> no pollution
    const before = ({} as Record<string, unknown>).polluted;
    const r = deriveCrossMemberContext(protoScopeFocus, [protoItem, ctorItem], { nowMs: NOW, maxPerTeammate: 5 });
    assert(resultWellFormed(r), '(7) proto/ctor keys -> well-formed result');
    assert(r.facts.some((f) => f.memberId === '__proto__'), '(7) __proto__ id survives as a plain string');
    assertEq(({} as Record<string, unknown>).polluted, before, '(7) Object prototype not polluted (instance)');
    assertEq((Object.prototype as Record<string, unknown>).polluted, undefined, '(7) Object.prototype untouched');
  }
  {
    // huge array bounded to MAX_ACTIVITY_SCANNED scan + MAX_FACTS emitted
    const r = deriveCrossMemberContext(baseFocus, hugeActivity, { nowMs: NOW, maxFacts: MAX_FACTS, maxPerTeammate: MAX_FACTS });
    assertLE(r.facts.length, MAX_FACTS, '(7) huge input -> facts bounded by MAX_FACTS');
    assertLE(r.counts.teammates, 50, '(7) huge input -> teammates from scanned window');
    assert(resultWellFormed(r), '(7) huge input result well-formed');
    assertLE((r.block ?? '').length, MAX_BLOCK_CHARS, '(7) huge input -> block bounded');
  }
  {
    // control chars scrubbed; astral+lone-surrogate at a focus-title boundary safe
    const r = deriveCrossMemberContext(surrogateFocusTitle, [
      { memberId: 'a', memberName: 'A', kind: 'active_run', missionId: 'm1', title: `end${LONE_HI}` },
    ], { nowMs: NOW });
    assert(resultWellFormed(r), '(7) surrogate/tag focus title -> well-formed');
    assert(!hasLoneSurrogate(r.facts[0].scopeTitle), '(7) lone surrogate + tag scrubbed from focus title');
    assert(!hasLoneSurrogate(r.block as string), '(7) block surrogate-safe with boundary input');
    const rc = deriveCrossMemberContext(baseFocus, ctrlActivity, { nowMs: NOW });
    assert(resultWellFormed(rc), '(7) control-char activity -> well-formed');
    assert(rc.facts.every((f) => isCleanLabel(f.memberName) && isCleanLabel(f.note)), '(7) control chars scrubbed from fields');
  }
  {
    // secret-shaped focus + item still bounded & clean
    const r = deriveCrossMemberContext(
      { actingMemberId: 'me', scopes: [{ kind: 'mission', id: 'm1', title: 'eyJaaaaaaaa.bbbbbbbb.cccccccc' }] },
      [{ memberId: 'a', memberName: 'A', kind: 'active_run', missionId: 'm1' }],
      { nowMs: NOW },
    );
    assert(resultWellFormed(r), '(7) secret-shaped focus title -> well-formed');
    assert(!looksSecret(r.facts[0].scopeTitle), '(7) secret-shaped focus title neutralized');
    assert(!looksSecret(r.block as string), '(7) block from secret-shaped focus is secret-safe');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll cross-member-context-core smoke cases passed (${passes} passed).`);
}

main();
