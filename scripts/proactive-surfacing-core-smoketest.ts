/**
 * proactive-surfacing-core-smoketest — the PURE "what should I bring up right
 * now" decision brain (src/lib/proactiveSurfacingCore.ts). It ranks
 * heterogeneous trouble signals (failed runs, expiring credentials, blocked
 * approvals, overdue tasks, stalled missions) by a relevance×urgency composite
 * and gates them through a per-key anti-nag state machine. Load-bearing
 * assertions:
 *
 *   selectProactiveSurfacings(signals, context, memory?, opts?):
 *     - empty signals → surface:[] note:null (silence default).
 *     - a topical critical signal surfaces with topical:true + a note; the same
 *       memory next turn is suppressed 'cooldown'; shownCount≥maxShowings →
 *       'retired'; expiresAtMs≤nowMs → 'moot'; two above floor with maxSurface:1
 *       → 1 surfaced + 1 'capped'; all below speakFloor → surface:[] note:null.
 *     - decay: a previously-shown key's composite is multiplied by DECAY_FACTOR.
 *     - nextMemory bumps shownCount+lastShownTurn for surfaced keys, carries the
 *       rest; deterministic (same inputs → identical decision + nextMemory).
 *   markSurfacingDismissed / surfacingSignalKey / emptySurfacingMemory helpers.
 *
 *   And: every export is TOTAL — null/undefined/number/{}/[]/NaN/huge string/
 *   control chars/secret-shaped titles/cyclic objects/throwing getters/negative
 *   turnIndex ⇒ a valid decision, never a throw, never a leaked secret; titles
 *   clamped ≤ MAX_TITLE_LEN and secret-shaped values rendered '[hidden]'.
 *
 * Pure — loads under tsx (proactiveSurfacingCore has zero runtime imports).
 */

import {
  selectProactiveSurfacings,
  markSurfacingDismissed,
  surfacingSignalKey,
  emptySurfacingMemory,
  SURFACING_KINDS,
  KIND_SEVERITY,
  MAX_SIGNALS,
  DEFAULT_MAX_SURFACE,
  MAX_SURFACE_CAP,
  DEFAULT_SPEAK_FLOOR,
  DEFAULT_COOLDOWN_TURNS,
  DEFAULT_MAX_SHOWINGS,
  DECAY_FACTOR,
  TOPICAL_BOOST,
  MAX_TITLE_LEN,
  MAX_NOTE_LEN,
  MAX_MEMORY_KEYS,
  MAX_SUPPRESSED,
  type SurfacingSignal,
  type SurfacingContext,
  type ProactiveSurfacingDecision,
  type SurfacingMemory,
  type SurfacingSuppressionReason,
} from '../src/lib/proactiveSurfacingCore';

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

// ── helpers ──────────────────────────────────────────────────────────────────
function suppressionOf(d: ProactiveSurfacingDecision, key: string): SurfacingSuppressionReason | undefined {
  return d.suppressed.find((s) => s.key === key)?.reason;
}
function surfacedFor(d: ProactiveSurfacingDecision, key: string) {
  return d.surface.find((s) => s.key === key);
}
/** Structural invariant every decision must satisfy. */
function decisionIsValid(d: unknown): d is ProactiveSurfacingDecision {
  if (!d || typeof d !== 'object') return false;
  const dd = d as ProactiveSurfacingDecision;
  if (!Array.isArray(dd.surface)) return false;
  if (!Array.isArray(dd.suppressed)) return false;
  if (dd.suppressed.length > MAX_SUPPRESSED) return false;
  if (!(dd.note === null || typeof dd.note === 'string')) return false;
  if (dd.note !== null && dd.note.length > MAX_NOTE_LEN) return false;
  if (!dd.nextMemory || dd.nextMemory.v !== 1 || typeof dd.nextMemory.entries !== 'object') return false;
  if (Object.keys(dd.nextMemory.entries).length > MAX_MEMORY_KEYS) return false;
  for (const s of dd.surface) {
    if (typeof s.key !== 'string' || !s.key) return false;
    if (!(SURFACING_KINDS as readonly string[]).includes(s.kind)) return false;
    if (typeof s.title !== 'string' || s.title.length > MAX_TITLE_LEN) return false;
    if (typeof s.score !== 'number' || s.score < 0 || s.score > 1) return false;
    if (typeof s.urgency !== 'number' || s.urgency < 0 || s.urgency > 1) return false;
    if (typeof s.relevance !== 'number' || s.relevance < 0 || s.relevance > 1) return false;
    if (typeof s.topical !== 'boolean') return false;
    if (typeof s.reason !== 'string') return false;
    // no control / line-sep / fence chars leaked into user-visible strings
    if (/[\x00-\x1f\x7f-\x9f\u2028\u2029`<>]/.test(s.title)) return false;
  }
  return true;
}
function totalOn(signals: unknown, context: unknown, memory?: unknown, opts?: unknown): boolean {
  try {
    return decisionIsValid(selectProactiveSurfacings(signals, context, memory, opts));
  } catch {
    return false;
  }
}

const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const SK_ANT = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOP';
const LONG_HEX = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

const NOW = 1_000_000;

function main(): void {
  // ─── (A) silence by default ─────────────────────────────────────────────────
  {
    const d = selectProactiveSurfacings([], { turnIndex: 1, nowMs: 0 });
    assertEq(d.surface.length, 0, '(A) empty signals → no surface');
    assertEq(d.note, null, '(A) empty signals → null note');
    assertEq(d.suppressed.length, 0, '(A) empty signals → no suppressed');
    assertJson(d.nextMemory, emptySurfacingMemory(), '(A) empty → empty memory');
    assert(decisionIsValid(d), '(A) decision structurally valid');
  }

  // ─── (B) a topical critical failed_run surfaces with a note ─────────────────
  const failedRun: SurfacingSignal = {
    kind: 'failed_run', title: 'Nightly deploy run', entityId: 'run_abc', surface: 'office',
  };
  {
    const ctx: SurfacingContext = { turnIndex: 1, nowMs: NOW, message: 'how is the nightly deploy run going?' };
    const d = selectProactiveSurfacings([failedRun], ctx);
    assertEq(d.surface.length, 1, '(B) one signal surfaces');
    const item = d.surface[0];
    assertEq(item.key, 'failed_run:run_abc', '(B) key derived from kind+entityId');
    assertEq(item.kind, 'failed_run', '(B) kind echoed');
    assertEq(item.topical, true, '(B) topical against the message');
    assertEq(item.relevance, 1, '(B) full title-token coverage → relevance 1');
    assert(item.score >= 0.99, '(B) critical topical score near 1', String(item.score));
    assertEq(item.priorShowings, 0, '(B) first showing → priorShowings 0');
    assertEq(item.surface, 'office', '(B) home surface echoed');
    assert(typeof d.note === 'string' && d.note.includes('Nightly deploy run failed'), '(B) note names the failed run', String(d.note));
    assertEq(d.nextMemory.entries['failed_run:run_abc'].shownCount, 1, '(B) nextMemory bumps shownCount to 1');
    assertEq(d.nextMemory.entries['failed_run:run_abc'].lastShownTurn, 1, '(B) nextMemory records lastShownTurn');
    assert(decisionIsValid(d), '(B) decision valid');
  }

  // ─── (C) off-topic still surfaces (proactive), but relevance 0 ──────────────
  {
    const d = selectProactiveSurfacings([failedRun], { turnIndex: 1, nowMs: NOW, message: 'lets talk about lunch' });
    assertEq(d.surface.length, 1, '(C) urgent signal surfaces even off-topic');
    assertEq(d.surface[0].topical, false, '(C) not topical');
    assertEq(d.surface[0].relevance, 0, '(C) off-topic relevance 0');
    assertEq(d.surface[0].score, KIND_SEVERITY.failed_run, '(C) off-topic score == kind urgency');
  }

  // ─── (D) cooldown on the very next turn with the returned memory ────────────
  {
    const t1 = selectProactiveSurfacings([failedRun], { turnIndex: 1, nowMs: NOW });
    const t2 = selectProactiveSurfacings([failedRun], { turnIndex: 2, nowMs: NOW }, t1.nextMemory);
    assertEq(t2.surface.length, 0, '(D) suppressed on next turn');
    assertEq(t2.note, null, '(D) cooldown turn is silent');
    assertEq(suppressionOf(t2, 'failed_run:run_abc'), 'cooldown', '(D) reason cooldown');
    // memory carried unchanged (still shownCount 1, lastShownTurn 1)
    assertEq(t2.nextMemory.entries['failed_run:run_abc'].shownCount, 1, '(D) cooldown does not bump shownCount');
    assertEq(t2.nextMemory.entries['failed_run:run_abc'].lastShownTurn, 1, '(D) cooldown keeps lastShownTurn');
  }
  {
    // past the cooldown window it may surface again (and bumps to shownCount 2)
    const mem: SurfacingMemory = { v: 1, entries: { 'failed_run:run_abc': { shownCount: 1, lastShownTurn: 1, dismissed: false } } };
    const d = selectProactiveSurfacings([failedRun], { turnIndex: 1 + DEFAULT_COOLDOWN_TURNS, nowMs: NOW }, mem);
    assertEq(d.surface.length, 1, '(D) re-surfaces after cooldown elapses');
    assertEq(d.surface[0].priorShowings, 1, '(D) priorShowings reflects the earlier showing');
    assertEq(d.nextMemory.entries['failed_run:run_abc'].shownCount, 2, '(D) re-showing bumps shownCount to 2');
  }

  // ─── (E) retirement at maxShowings (or dismissed) ───────────────────────────
  {
    const mem: SurfacingMemory = { v: 1, entries: { 'failed_run:run_abc': { shownCount: DEFAULT_MAX_SHOWINGS, lastShownTurn: 0, dismissed: false } } };
    const d = selectProactiveSurfacings([failedRun], { turnIndex: 100, nowMs: NOW }, mem);
    assertEq(d.surface.length, 0, '(E) retired signal never surfaces');
    assertEq(suppressionOf(d, 'failed_run:run_abc'), 'retired', '(E) reason retired at maxShowings');
  }
  {
    const dismissedMem = markSurfacingDismissed(emptySurfacingMemory(), 'failed_run:run_abc');
    assertEq(dismissedMem.entries['failed_run:run_abc'].dismissed, true, '(E) markSurfacingDismissed sets dismissed');
    const d = selectProactiveSurfacings([failedRun], { turnIndex: 1, nowMs: NOW }, dismissedMem);
    assertEq(suppressionOf(d, 'failed_run:run_abc'), 'retired', '(E) dismissed → retired');
    assertEq(d.surface.length, 0, '(E) dismissed signal stays hidden');
  }

  // ─── (F) moot: expiry already passed ────────────────────────────────────────
  {
    const cred: SurfacingSignal = { kind: 'expiring_credential', title: 'GitHub token', entityId: 'gh1', expiresAtMs: NOW - 1 };
    const d = selectProactiveSurfacings([cred], { turnIndex: 1, nowMs: NOW });
    assertEq(d.surface.length, 0, '(F) expired credential is moot');
    assertEq(suppressionOf(d, 'expiring_credential:gh1'), 'moot', '(F) reason moot');
  }
  {
    // expiring in the near future → strong time pressure, surfaces urgently
    const cred: SurfacingSignal = { kind: 'expiring_credential', title: 'GitHub token', entityId: 'gh1', expiresAtMs: NOW + 3_600_000 };
    const d = selectProactiveSurfacings([cred], { turnIndex: 1, nowMs: NOW });
    assertEq(d.surface.length, 1, '(F) near-expiry credential surfaces');
    assert(d.surface[0].urgency >= KIND_SEVERITY.expiring_credential, '(F) time pressure raises urgency', String(d.surface[0].urgency));
  }

  // ─── (G) top-k cap ──────────────────────────────────────────────────────────
  const runA: SurfacingSignal = { kind: 'failed_run', title: 'Run A', entityId: 'a', key: 'failed_run:a' };
  const runB: SurfacingSignal = { kind: 'failed_run', title: 'Run B', entityId: 'b', key: 'failed_run:b' };
  {
    const d = selectProactiveSurfacings([runA, runB], { turnIndex: 1, nowMs: NOW }, undefined, { maxSurface: 1 });
    assertEq(d.surface.length, 1, '(G) maxSurface:1 surfaces exactly one');
    assertEq(d.surface[0].key, 'failed_run:a', '(G) tie broken by key ascending');
    assertEq(suppressionOf(d, 'failed_run:b'), 'capped', '(G) the overflow is capped, not dropped');
  }
  {
    const d = selectProactiveSurfacings([runA, runB], { turnIndex: 1, nowMs: NOW }, undefined, { maxSurface: 0 });
    assertEq(d.surface.length, 0, '(G) maxSurface:0 surfaces nothing');
    assertEq(d.note, null, '(G) nothing surfaced → null note');
    assertEq(suppressionOf(d, 'failed_run:a'), 'capped', '(G) all capped at maxSurface:0');
  }

  // ─── (H) speak floor → silence ──────────────────────────────────────────────
  {
    const mission: SurfacingSignal = { kind: 'stalled_mission', title: 'Acme redesign', entityId: 'm1' };
    // fresh stalled_mission urgency == 0.6 base
    const surfaced = selectProactiveSurfacings([mission], { turnIndex: 1, nowMs: NOW });
    assertEq(surfaced.surface.length, 1, '(H) default floor lets a stalled mission through');
    const d = selectProactiveSurfacings([mission], { turnIndex: 1, nowMs: NOW }, undefined, { speakFloor: 0.9 });
    assertEq(d.surface.length, 0, '(H) high floor silences the sub-floor signal');
    assertEq(d.note, null, '(H) below floor → null note');
    assertEq(suppressionOf(d, 'stalled_mission:m1'), 'below_floor', '(H) reason below_floor');
  }

  // ─── (I) topical boost affects ranking (light) ──────────────────────────────
  {
    const mission: SurfacingSignal = { kind: 'stalled_mission', title: 'Acme redesign', entityId: 'm1' };
    const run: SurfacingSignal = { kind: 'failed_run', title: 'Backend deploy', entityId: 'r1' };
    // message topical to the mission, not the run
    const d = selectProactiveSurfacings([mission, run], { turnIndex: 1, nowMs: NOW, message: 'hows the acme redesign' }, undefined, { maxSurface: 2 });
    const m = surfacedFor(d, 'stalled_mission:m1');
    const r = surfacedFor(d, 'failed_run:r1');
    assert(!!m && m!.topical === true, '(I) mission topical');
    assert(!!r && r!.topical === false, '(I) run off-topic');
    // urgency still dominates: failed_run(0.9) outranks topical stalled(<0.9)
    assertEq(d.surface[0].key, 'failed_run:r1', '(I) higher-urgency off-topic run still ranks first');
    assert(m!.score > KIND_SEVERITY.stalled_mission, '(I) topical boost raised the mission score above its base', String(m!.score));
  }

  // ─── (J) determinism: same inputs → identical decision + nextMemory ─────────
  {
    const signals: SurfacingSignal[] = [
      { kind: 'failed_run', title: 'Deploy', entityId: 'd1' },
      { kind: 'overdue_task', title: 'Ship invoice', entityId: 't1', sinceMs: NOW - 2 * 24 * 3600 * 1000 },
      { kind: 'blocked_approval', title: 'Publish post', entityId: 'ap1' },
      { kind: 'stalled_mission', title: 'Acme redesign', entityId: 'm1' },
    ];
    const ctx: SurfacingContext = { turnIndex: 3, nowMs: NOW, message: 'acme redesign and the invoice' };
    const a = selectProactiveSurfacings(signals, ctx, undefined, { maxSurface: 2 });
    const b = selectProactiveSurfacings(signals, ctx, undefined, { maxSurface: 2 });
    assertJson(a, b, '(J) identical decision across repeated calls');
    assertJson(a.nextMemory, b.nextMemory, '(J) identical nextMemory');
    // scores non-increasing
    let sorted = true;
    for (let i = 1; i < a.surface.length; i += 1) if (a.surface[i].score > a.surface[i - 1].score) sorted = false;
    assert(sorted, '(J) surface sorted by score descending');
    assert(a.surface.length === 2, '(J) maxSurface honored', String(a.surface.length));
  }

  // ─── (K) decay lowers a re-shown score ──────────────────────────────────────
  {
    const mem: SurfacingMemory = { v: 1, entries: { 'failed_run:run_abc': { shownCount: 1, lastShownTurn: 0, dismissed: false } } };
    const d = selectProactiveSurfacings([failedRun], { turnIndex: 10, nowMs: NOW }, mem, { cooldownTurns: 0, speakFloor: 0.3 });
    assertEq(d.surface.length, 1, '(K) with cooldown:0 the decayed signal can still surface');
    const expected = Math.round(KIND_SEVERITY.failed_run * DECAY_FACTOR * 10000) / 10000;
    assertEq(d.surface[0].score, expected, '(K) score == base × DECAY_FACTOR^1');
    assert(d.surface[0].score < KIND_SEVERITY.failed_run, '(K) decayed score below the fresh score');
    assertEq(d.surface[0].priorShowings, 1, '(K) priorShowings 1');
  }

  // ─── (L) memory helpers ─────────────────────────────────────────────────────
  assertJson(emptySurfacingMemory(), { v: 1, entries: {} }, '(L) emptySurfacingMemory shape');
  assertEq(surfacingSignalKey('failed_run', 'run_abc'), 'failed_run:run_abc', '(L) surfacingSignalKey composes');
  assertEq(surfacingSignalKey('bogus', 'x'), 'signal:x', '(L) invalid kind → signal fallback');
  assertEq(surfacingSignalKey('overdue_task', null), 'overdue_task:unknown', '(L) null id → unknown');
  assertJson(markSurfacingDismissed(null, 'k1').entries['k1'], { shownCount: 0, lastShownTurn: -1, dismissed: true }, '(L) dismiss on null memory creates dismissed entry');
  assertJson(markSurfacingDismissed(emptySurfacingMemory(), 42), emptySurfacingMemory(), '(L) dismiss with bad key is a no-op');

  // ─── (M) bounds / dedupe ────────────────────────────────────────────────────
  {
    // 5000 signals → scan cap + surface cap both honored
    const many: SurfacingSignal[] = [];
    for (let i = 0; i < 5000; i += 1) many.push({ kind: 'failed_run', title: `Run ${i}`, entityId: `r${i}` });
    const d = selectProactiveSurfacings(many, { turnIndex: 1, nowMs: NOW }, undefined, { maxSurface: 100 });
    assert(d.surface.length <= MAX_SURFACE_CAP, '(M) surface capped at MAX_SURFACE_CAP', String(d.surface.length));
    assert(d.suppressed.length <= MAX_SUPPRESSED, '(M) suppressed capped at MAX_SUPPRESSED', String(d.suppressed.length));
    assert(decisionIsValid(d), '(M) huge-input decision valid');
  }
  {
    // duplicate keys collapse to one
    const dup: SurfacingSignal[] = [
      { kind: 'failed_run', title: 'First', entityId: 'x', key: 'failed_run:x' },
      { kind: 'failed_run', title: 'Second', entityId: 'x', key: 'failed_run:x' },
    ];
    const d = selectProactiveSurfacings(dup, { turnIndex: 1, nowMs: NOW });
    assertEq(d.surface.filter((s) => s.key === 'failed_run:x').length, 1, '(M) duplicate key collapses to one');
    assertEq(d.surface[0].title, 'First', '(M) dedupe keeps the first occurrence');
  }
  {
    // memory pruning: > MAX_MEMORY_KEYS entries in → capped out
    const entries: Record<string, { shownCount: number; lastShownTurn: number; dismissed: boolean }> = {};
    for (let i = 0; i < MAX_MEMORY_KEYS + 50; i += 1) entries[`failed_run:k${i}`] = { shownCount: 1, lastShownTurn: i, dismissed: false };
    const d = selectProactiveSurfacings([], { turnIndex: 1, nowMs: NOW }, { v: 1, entries });
    assert(Object.keys(d.nextMemory.entries).length <= MAX_MEMORY_KEYS, '(M) memory pruned to MAX_MEMORY_KEYS', String(Object.keys(d.nextMemory.entries).length));
  }

  // ─── (N) constants sane ─────────────────────────────────────────────────────
  assertEq(MAX_SIGNALS, 200, '(N) MAX_SIGNALS 200');
  assertEq(DEFAULT_MAX_SURFACE, 3, '(N) DEFAULT_MAX_SURFACE 3');
  assertEq(MAX_SURFACE_CAP, 8, '(N) MAX_SURFACE_CAP 8');
  assertEq(DEFAULT_SPEAK_FLOOR, 0.55, '(N) DEFAULT_SPEAK_FLOOR 0.55');
  assertEq(DEFAULT_COOLDOWN_TURNS, 3, '(N) DEFAULT_COOLDOWN_TURNS 3');
  assertEq(DEFAULT_MAX_SHOWINGS, 2, '(N) DEFAULT_MAX_SHOWINGS 2');
  assertEq(DECAY_FACTOR, 0.7, '(N) DECAY_FACTOR 0.7');
  assertEq(TOPICAL_BOOST, 0.35, '(N) TOPICAL_BOOST 0.35');
  assertEq(MAX_TITLE_LEN, 100, '(N) MAX_TITLE_LEN 100');
  assertEq(SURFACING_KINDS.length, 5, '(N) five signal kinds');

  // ─── (O) HOSTILE INPUT: never throws, never leaks ───────────────────────────
  try {
    // degenerate top-level inputs
    for (const badSignals of [null, undefined, 42, NaN, true, {}, 'str', () => 1, Symbol('s') as unknown, 9n as unknown]) {
      assert(totalOn(badSignals, { turnIndex: 1, nowMs: NOW }), 'hostile signals total', String(badSignals).slice(0, 12));
      const d = selectProactiveSurfacings(badSignals, { turnIndex: 1, nowMs: NOW });
      assertEq(d.surface.length, 0, 'hostile signals → empty surface');
    }
    for (const badCtx of [null, undefined, 42, 'str', NaN, [], () => 1, true]) {
      assert(totalOn([failedRun], badCtx), 'hostile context total', String(badCtx).slice(0, 12));
    }
    for (const badMem of [null, undefined, 42, 'str', NaN, [], { entries: 42 }, { entries: null }, { entries: { k: 42 } }, () => 1]) {
      assert(totalOn([failedRun], { turnIndex: 1, nowMs: NOW }, badMem), 'hostile memory total', String(JSON.stringify(badMem)).slice(0, 20));
    }
    for (const badOpts of [null, 42, 'str', [], { maxSurface: NaN }, { maxSurface: Infinity }, { maxSurface: -5 }, { speakFloor: 5 }, { speakFloor: -1 }, { cooldownTurns: -3 }, { maxShowings: 0 }]) {
      assert(totalOn([failedRun], { turnIndex: 1, nowMs: NOW }, undefined, badOpts), 'hostile opts total', String(JSON.stringify(badOpts)).slice(0, 20));
    }

    // negative / non-finite turnIndex + nowMs
    assert(totalOn([failedRun], { turnIndex: -5, nowMs: NOW }), 'negative turnIndex total');
    assert(totalOn([failedRun], { turnIndex: NaN, nowMs: NaN }), 'NaN turnIndex/nowMs total');
    const negTurn = selectProactiveSurfacings([failedRun], { turnIndex: -5, nowMs: NOW });
    assert(negTurn.nextMemory.entries['failed_run:run_abc'].lastShownTurn >= 0, 'negative turnIndex coerced ≥ 0');

    // junk rows among good ones: good one still resolves, junk skipped
    const mixed = [null, 42, 'x', {}, [], NaN, true, { kind: 'planet', title: 'Mars' }, { kind: 'failed_run' /* no title */, entityId: 'k9' }, failedRun];
    assert(totalOn(mixed, { turnIndex: 1, nowMs: NOW }), 'mixed junk rows total');
    const mr = selectProactiveSurfacings(mixed, { turnIndex: 1, nowMs: NOW });
    assert(mr.surface.some((s) => s.key === 'failed_run:run_abc'), 'valid row among junk still surfaces');
    // signal with valid kind but no title gets a fallback title, never crashes
    const noTitle = mr.surface.find((s) => s.key === 'failed_run:k9');
    if (noTitle) assert(noTitle.title.length > 0, 'missing title → non-empty fallback');

    // cyclic signal object — scalar-field read must not traverse the cycle
    const cyc: Record<string, unknown> = { kind: 'failed_run', title: 'Cyclic run', entityId: 'cyc1' };
    cyc.self = cyc;
    cyc.list = [cyc, cyc];
    assert(totalOn([cyc], { turnIndex: 1, nowMs: NOW }), 'cyclic signal total');
    const cr = selectProactiveSurfacings([cyc], { turnIndex: 1, nowMs: NOW });
    assert(cr.surface.some((s) => s.key === 'failed_run:cyc1'), 'cyclic signal still surfaces by scalar fields');

    // throwing getters on every field — signal skipped, no throw
    const boom = (field: string): SurfacingSignal => {
      const o: Record<string, unknown> = { kind: 'failed_run', title: 'Boom', entityId: 'boom1' };
      Object.defineProperty(o, field, { get() { throw new Error(`boom ${field}`); }, enumerable: true });
      return o as unknown as SurfacingSignal;
    };
    for (const field of ['kind', 'title', 'entityId', 'surface', 'expiresAtMs', 'sinceMs', 'severity', 'topicTokens', 'key']) {
      assert(totalOn([boom(field)], { turnIndex: 1, nowMs: NOW }), `throwing getter on ${field} total`);
    }
    // a throwing sibling next to a good signal: good one survives
    const withBoom = selectProactiveSurfacings([boom('title'), failedRun], { turnIndex: 1, nowMs: NOW });
    assert(withBoom.surface.some((s) => s.key === 'failed_run:run_abc'), 'good signal survives a throwing sibling');

    // secret-shaped titles → '[hidden]', never leaked into surface or note
    const secretSignals: SurfacingSignal[] = [
      { kind: 'failed_run', title: JWT, entityId: 's1' },
      { kind: 'expiring_credential', title: SK_ANT, entityId: 's2' },
      { kind: 'blocked_approval', title: LONG_HEX, entityId: 's3' },
    ];
    const sd = selectProactiveSurfacings(secretSignals, { turnIndex: 1, nowMs: NOW }, undefined, { maxSurface: 3 });
    for (const s of sd.surface) assertEq(s.title, '[hidden]', 'secret-shaped title → [hidden]');
    const blob = JSON.stringify(sd);
    assert(!blob.includes('eyJ'), 'JWT never leaks into decision', blob.slice(0, 60));
    assert(!blob.includes('sk-ant-'), 'sk-ant key never leaks');
    assert(!blob.includes('deadbeef'), 'long hex never leaks');
    assert(sd.note === null || (!sd.note.includes('eyJ') && !sd.note.includes('sk-ant-')), 'note carries no secret material');

    // secret material embedded inside a longer title is masked, rest kept
    const embedded = selectProactiveSurfacings(
      [{ kind: 'failed_run', title: `deploy ${JWT} step`, entityId: 'e1' }],
      { turnIndex: 1, nowMs: NOW },
    );
    const em = embedded.surface[0];
    assert(!!em && !em.title.includes('eyJ'), 'embedded JWT masked out of title', em?.title);
    assert(!!em && em.title.includes('[hidden]'), 'embedded secret rendered as [hidden]', em?.title);

    // control / line-sep / fence chars stripped from titles + note
    const nastyTitle = 'Ctrl' + String.fromCharCode(0) + 'Run' + String.fromCharCode(0x2028, 0x2029) + ' `code` </untrusted>';
    const nd = selectProactiveSurfacings([{ kind: 'failed_run', title: nastyTitle, entityId: 'n1' }], { turnIndex: 1, nowMs: NOW });
    const nm = nd.surface[0];
    assert(!!nm && !/[\x00-\x1f]/.test(nm.title), 'no control chars in title');
    assert(!!nm && !/[\u2028\u2029]/.test(nm.title), 'no line separators in title');
    assert(!!nm && !nm.title.includes('`') && !nm.title.includes('<') && !nm.title.includes('>'), 'no fence chars in title');
    assert(nd.note !== null && !/[\x00-\x1f\u2028\u2029`<>]/.test(nd.note), 'note free of control/fence chars');

    // 10k-char (spaced) title clamped to MAX_TITLE_LEN
    const hugeTitle = ('zeta ' + 'lorem ipsum dolor '.repeat(600)).trim();
    assert(hugeTitle.length > 5000, 'huge title is genuinely huge');
    const hd = selectProactiveSurfacings([{ kind: 'failed_run', title: hugeTitle, entityId: 'h1' }], { turnIndex: 1, nowMs: NOW });
    assert(hd.surface[0].title.length <= MAX_TITLE_LEN, 'huge title clamped ≤ MAX_TITLE_LEN', String(hd.surface[0].title.length));

    // 10k-char spaceless title → treated as secret value → [hidden]
    const hugeSpaceless = 'a'.repeat(10000);
    const hd2 = selectProactiveSurfacings([{ kind: 'failed_run', title: hugeSpaceless, entityId: 'h2' }], { turnIndex: 1, nowMs: NOW });
    assertEq(hd2.surface[0].title, '[hidden]', 'huge spaceless blob → [hidden]');

    // huge message does not throw and stays bounded
    assert(totalOn([failedRun], { turnIndex: 1, nowMs: NOW, message: 'nightly '.repeat(5000) }), 'huge message total');

    // expired + retired + moot together: reports moot (most objective)
    const bothMem: SurfacingMemory = { v: 1, entries: { 'failed_run:run_abc': { shownCount: 99, lastShownTurn: 0, dismissed: true } } };
    const bd = selectProactiveSurfacings([{ ...failedRun, expiresAtMs: NOW - 1 }], { turnIndex: 1, nowMs: NOW }, bothMem);
    assertEq(suppressionOf(bd, 'failed_run:run_abc'), 'moot', 'moot beats retired when both apply');

    passes += 1; // reached the end of the hostile sweep without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (O) hostile sweep threw: ${(e as Error)?.message}`);
  }

  // ─── (P) regression (QA): ownKeys-throwing Proxy memory must not escape ─────
  // normalizeMemory enumerated `entries` with an unguarded Object.keys; a Proxy
  // whose ownKeys trap throws propagated OUT of both selectProactiveSurfacings
  // (memory normalized before the try) and markSurfacingDismissed (no try at
  // all), breaking the "every export is TOTAL / never throws" guarantee. Both
  // callers route through normalizeMemory, so one guard covers both — verify the
  // hostile memory degrades to empty and neither export throws.
  {
    const mkProxyMem = () => ({ v: 1 as const, entries: new Proxy({}, { ownKeys() { throw new Error('boom'); } }) });
    const sig: SurfacingSignal = { kind: 'failed_run', title: 'x', entityId: 'run_abc' };

    let d: ProactiveSurfacingDecision | null = null;
    try { d = selectProactiveSurfacings([sig], { turnIndex: 1, nowMs: NOW }, mkProxyMem()); } catch { d = null; }
    assert(d !== null && decisionIsValid(d), '(P) ownKeys-throwing Proxy memory → valid decision, no throw');
    assertEq(d?.surface.length, 1, '(P) hostile memory degrades to empty → signal still surfaces');
    assertEq(d?.surface[0]?.key, 'failed_run:run_abc', '(P) surfaced key correct despite hostile memory');

    let dm: SurfacingMemory | null = null;
    try { dm = markSurfacingDismissed(mkProxyMem(), 'failed_run:run_abc'); } catch { dm = null; }
    assert(dm !== null, '(P) markSurfacingDismissed does not throw on ownKeys-throwing Proxy memory');
    assertEq(dm?.entries['failed_run:run_abc']?.dismissed, true, '(P) dismissed entry created despite hostile memory');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll proactive-surfacing-core smoke cases passed (${passes} passed).`);
}

main();
