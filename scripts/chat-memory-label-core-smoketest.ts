/**
 * chat-memory-label-core-smoketest — the 8 PURE memory-reference label
 * formatters extracted from ChatTab (src/lib/chatMemoryLabelCore.ts, unit U1).
 *
 * Goldens are pinned to the VERBATIM ChatTab.tsx behavior (lines 626–689, also
 * byte-identical in chat/ChatTranscript.tsx + components/chat/RunHistoryDrawer.tsx):
 * recency buckets (fresh/d/w/mo, Date.now()-relative), strength/trust/state/
 * archive/source thresholds + precedence, guidance-vs-pattern family mapping,
 * empty/edge defaults, and a hostile no-throw contract over every export.
 *
 * Pure — loads under tsx (chatMemoryLabelCore uses `import type` only).
 */

import {
  formatMemoryRecencyLabel,
  formatMemoryStrengthLabel,
  formatMemoryStateLabel,
  formatMemoryTrustLabel,
  formatArchiveBiasLabel,
  formatMemorySourceLabel,
  getMemoryFamily,
  getMemoryFamilyLabel,
} from '../src/lib/chatMemoryLabelCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Safe describer for hostile inputs (never invokes a custom toString). */
function desc(v: unknown): string {
  try {
    if (typeof v === 'object' && v !== null) return Object.prototype.toString.call(v);
    return typeof v === 'symbol' ? v.toString() : String(v);
  } catch {
    return '<undescribable>';
  }
}

// Typed as `any` so the smoke can feed representative + hostile shapes without
// TS narrowing away the exact fields the formatters read.
type Ref = any;

const STRENGTH_SET = new Set(['core', 'strong', 'active', 'light']);
const STATE_SET = new Set([
  'distilled guidance', 'pinned startup', 'startup guidance', 'pinned', 'supporting', 'retrieved',
]);
const TRUST_SET = new Set(['unrated', 'trusted', 'proven', 'weak', 'mixed']);
const SOURCE_SET = new Set(['Claude Code', 'Codex', 'Cursor', 'Gemini']);
const FAMILY_SET = new Set(['guidance', 'pattern']);
const FAMILY_LABEL_SET = new Set(['Guidance', 'Pattern']);

function main(): void {
  const NOW = Date.now();
  const isoHoursAgo = (h: number): string => new Date(NOW - h * 3_600_000).toISOString();
  const isoDaysAgo = (d: number): string => new Date(NOW - d * 86_400_000).toISOString();

  // ─── (1) formatMemoryRecencyLabel — Date.now()-relative buckets ────────────
  assertEq(formatMemoryRecencyLabel({} as Ref), 'unknown freshness', '(1) no timestamp → unknown');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: null, updatedAt: null } as Ref), 'unknown freshness', '(1) null timestamps → unknown');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: '', updatedAt: '' } as Ref), 'unknown freshness', '(1) empty-string timestamps → unknown');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoHoursAgo(1) } as Ref), 'fresh today', '(1) 1h → fresh today');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoHoursAgo(12) } as Ref), 'fresh today', '(1) 12h → fresh today');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoHoursAgo(23) } as Ref), 'fresh today', '(1) 23h → fresh today (just under 24h)');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoHoursAgo(25) } as Ref), '1d old', '(1) 25h → 1d old (just over 24h)');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(3) } as Ref), '3d old', '(1) 3d → 3d old');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(6) } as Ref), '6d old', '(1) 6d → 6d old (just under 7d)');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(10) } as Ref), '1w old', '(1) 10d → 1w old');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(14) } as Ref), '2w old', '(1) 14d → 2w old');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(28) } as Ref), '4w old', '(1) 28d → 4w old (just under 30d)');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(30) } as Ref), '1mo old', '(1) 30d → 1mo old (boundary flips to mo)');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(60) } as Ref), '2mo old', '(1) 60d → 2mo old');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(90) } as Ref), '3mo old', '(1) 90d → 3mo old');
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoDaysAgo(400) } as Ref), '13mo old', '(1) 400d → 13mo old');
  // lastAccessedAt wins over updatedAt; falls back to updatedAt when absent
  assertEq(formatMemoryRecencyLabel({ lastAccessedAt: isoHoursAgo(1), updatedAt: isoDaysAgo(400) } as Ref), 'fresh today', '(1) lastAccessedAt takes precedence over updatedAt');
  assertEq(formatMemoryRecencyLabel({ updatedAt: isoDaysAgo(3) } as Ref), '3d old', '(1) falls back to updatedAt when no lastAccessedAt');

  // ─── (2) formatMemoryStrengthLabel — importance thresholds ─────────────────
  assertEq(formatMemoryStrengthLabel({ importance: 1 } as Ref), 'core', '(2) 1.0 → core');
  assertEq(formatMemoryStrengthLabel({ importance: 0.95 } as Ref), 'core', '(2) 0.95 → core');
  assertEq(formatMemoryStrengthLabel({ importance: 0.9 } as Ref), 'core', '(2) 0.9 boundary → core');
  assertEq(formatMemoryStrengthLabel({ importance: 0.89 } as Ref), 'strong', '(2) 0.89 → strong');
  assertEq(formatMemoryStrengthLabel({ importance: 0.75 } as Ref), 'strong', '(2) 0.75 boundary → strong');
  assertEq(formatMemoryStrengthLabel({ importance: 0.7 } as Ref), 'active', '(2) 0.7 → active');
  assertEq(formatMemoryStrengthLabel({ importance: 0.6 } as Ref), 'active', '(2) 0.6 boundary → active');
  assertEq(formatMemoryStrengthLabel({ importance: 0.59 } as Ref), 'light', '(2) 0.59 → light');
  assertEq(formatMemoryStrengthLabel({ importance: 0 } as Ref), 'light', '(2) 0 → light');
  assertEq(formatMemoryStrengthLabel({} as Ref), 'light', '(2) missing importance defaults 0.5 → light');
  assertEq(formatMemoryStrengthLabel({ importance: null } as Ref), 'light', '(2) null importance → 0.5 default → light');

  // ─── (3) formatMemoryStateLabel — state precedence ────────────────────────
  assertEq(formatMemoryStateLabel({ memoryState: 'distilled' } as Ref), 'distilled guidance', '(3) distilled');
  assertEq(formatMemoryStateLabel({ retrievalMode: 'startup', pinned: true } as Ref), 'pinned startup', '(3) startup+pinned → pinned startup');
  assertEq(formatMemoryStateLabel({ retrievalMode: 'startup' } as Ref), 'startup guidance', '(3) startup only');
  assertEq(formatMemoryStateLabel({ retrievalMode: 'startup', pinned: false } as Ref), 'startup guidance', '(3) startup+unpinned → startup guidance');
  assertEq(formatMemoryStateLabel({ pinned: true } as Ref), 'pinned', '(3) pinned (non-startup)');
  assertEq(formatMemoryStateLabel({ memoryState: 'supporting' } as Ref), 'supporting', '(3) supporting');
  assertEq(formatMemoryStateLabel({} as Ref), 'retrieved', '(3) empty → retrieved default');
  // precedence: distilled beats everything; pinned beats supporting
  assertEq(formatMemoryStateLabel({ memoryState: 'distilled', retrievalMode: 'startup', pinned: true } as Ref), 'distilled guidance', '(3) distilled outranks startup+pinned');
  assertEq(formatMemoryStateLabel({ pinned: true, memoryState: 'supporting' } as Ref), 'pinned', '(3) pinned outranks supporting');

  // ─── (4) formatMemoryTrustLabel — helpfulness thresholds ──────────────────
  assertEq(formatMemoryTrustLabel({} as Ref), 'unrated', '(4) missing → unrated');
  assertEq(formatMemoryTrustLabel({ helpfulness: null } as Ref), 'unrated', '(4) null → unrated');
  assertEq(formatMemoryTrustLabel({ helpfulness: undefined } as Ref), 'unrated', '(4) undefined → unrated');
  assertEq(formatMemoryTrustLabel({ helpfulness: 1 } as Ref), 'trusted', '(4) 1.0 → trusted');
  assertEq(formatMemoryTrustLabel({ helpfulness: 0.8 } as Ref), 'trusted', '(4) 0.8 boundary → trusted');
  assertEq(formatMemoryTrustLabel({ helpfulness: 0.79 } as Ref), 'proven', '(4) 0.79 → proven');
  assertEq(formatMemoryTrustLabel({ helpfulness: 0.6 } as Ref), 'proven', '(4) 0.6 boundary → proven');
  assertEq(formatMemoryTrustLabel({ helpfulness: 0.59 } as Ref), 'mixed', '(4) 0.59 → mixed');
  assertEq(formatMemoryTrustLabel({ helpfulness: 0.5 } as Ref), 'mixed', '(4) 0.5 → mixed');
  assertEq(formatMemoryTrustLabel({ helpfulness: 0.31 } as Ref), 'mixed', '(4) 0.31 → mixed (just above weak)');
  assertEq(formatMemoryTrustLabel({ helpfulness: 0.3 } as Ref), 'weak', '(4) 0.3 boundary → weak');
  assertEq(formatMemoryTrustLabel({ helpfulness: 0 } as Ref), 'weak', '(4) 0 → weak');

  // ─── (5) formatArchiveBiasLabel — bias + passive-score nuance ─────────────
  assertEq(formatArchiveBiasLabel({ archiveBias: 'boosted' } as Ref), 'archive boosted', '(5) boosted');
  assertEq(formatArchiveBiasLabel({ archiveBias: 'suppressed' } as Ref), 'archive suppressed', '(5) suppressed');
  assertEq(formatArchiveBiasLabel({ archiveBias: 'neutral', archivePassiveScore: 0.5 } as Ref), 'archive neutral', '(5) neutral + score → archive neutral');
  assertEq(formatArchiveBiasLabel({ archiveBias: 'neutral', archivePassiveScore: 0 } as Ref), 'archive neutral', '(5) neutral + score 0 → archive neutral (0 != null)');
  assertEq(formatArchiveBiasLabel({ archiveBias: 'neutral' } as Ref), null, '(5) neutral, no score → null');
  assertEq(formatArchiveBiasLabel({ archiveBias: 'neutral', archivePassiveScore: null } as Ref), null, '(5) neutral + null score → null');
  assertEq(formatArchiveBiasLabel({} as Ref), null, '(5) no bias → null');

  // ─── (6) formatMemorySourceLabel — bridge source mapping ──────────────────
  assertEq(formatMemorySourceLabel({ sourceSurface: 'claude_code_bridge' } as Ref), 'Claude Code', '(6) claude_code_bridge');
  assertEq(formatMemorySourceLabel({ sourceSurface: 'codex_bridge' } as Ref), 'Codex', '(6) codex_bridge');
  assertEq(formatMemorySourceLabel({ sourceSurface: 'cursor_bridge' } as Ref), 'Cursor', '(6) cursor_bridge');
  assertEq(formatMemorySourceLabel({ sourceSurface: 'gemini_bridge' } as Ref), 'Gemini', '(6) gemini_bridge');
  assertEq(formatMemorySourceLabel({ sourceSurface: 'other_surface' } as Ref), null, '(6) unknown surface → null');
  assertEq(formatMemorySourceLabel({} as Ref), null, '(6) no surface → null');
  assertEq(formatMemorySourceLabel({ sourceSurface: null } as Ref), null, '(6) null surface → null');

  // ─── (7) getMemoryFamily — guidance vs pattern kinds ──────────────────────
  for (const kind of ['instruction', 'preference', 'decision', 'policy']) {
    assertEq(getMemoryFamily({ memoryKind: kind } as Ref), 'guidance', `(7) ${kind} → guidance`);
  }
  for (const kind of ['fact', 'finding', 'context']) {
    assertEq(getMemoryFamily({ memoryKind: kind } as Ref), 'pattern', `(7) ${kind} → pattern`);
  }
  assertEq(getMemoryFamily({} as Ref), 'pattern', '(7) missing kind → pattern');
  assertEq(getMemoryFamily({ memoryKind: 'totally-unknown' } as Ref), 'pattern', '(7) unknown kind → pattern');

  // ─── (8) getMemoryFamilyLabel — capitalized family ────────────────────────
  assertEq(getMemoryFamilyLabel({ memoryKind: 'instruction' } as Ref), 'Guidance', '(8) instruction → Guidance');
  assertEq(getMemoryFamilyLabel({ memoryKind: 'policy' } as Ref), 'Guidance', '(8) policy → Guidance');
  assertEq(getMemoryFamilyLabel({ memoryKind: 'fact' } as Ref), 'Pattern', '(8) fact → Pattern');
  assertEq(getMemoryFamilyLabel({ memoryKind: 'context' } as Ref), 'Pattern', '(8) context → Pattern');
  assertEq(getMemoryFamilyLabel({} as Ref), 'Pattern', '(8) missing kind → Pattern');

  // ─── (9) hostile no-throw + return-type contract over all 8 exports ───────
  const cyclic: Ref = { title: 'c' };
  cyclic.self = cyclic;
  const nullProto: Ref = Object.create(null);
  nullProto.memoryKind = 'instruction';
  const hostile: Ref[] = [
    null, undefined, 0, 42, -1, NaN, Infinity, -Infinity, 'str', '', true, false,
    Symbol('s'), 123n,
    [], [1, 2, 3],
    cyclic,
    nullProto,
    Object.freeze({}),
    {
      importance: 'high', helpfulness: 'low', memoryKind: [1, 2],
      lastAccessedAt: {}, updatedAt: [], archiveBias: 123, archivePassiveScore: 'x',
      sourceSurface: 99, memoryState: 0, retrievalMode: false, pinned: 'yes',
    },
    { importance: 1e309, helpfulness: -1e309 }, // Infinity / -Infinity
    { importance: NaN, helpfulness: NaN },
    { lastAccessedAt: 'not-a-valid-date' },
    { lastAccessedAt: 12345 },
    { lastAccessedAt: {} },
    { updatedAt: [] },
    { sourceSurface: 'z'.repeat(100000) }, // huge but O(1) reads
    { memoryKind: 0 },
    { archiveBias: 'neutral', archivePassiveScore: 0 },
  ];
  for (const h of hostile) {
    try {
      const rec = formatMemoryRecencyLabel(h);
      assert(typeof rec === 'string', `(9) recency → string for ${desc(h)}`, `got ${JSON.stringify(rec)}`);
      const str = formatMemoryStrengthLabel(h);
      assert(STRENGTH_SET.has(str), `(9) strength ∈ set for ${desc(h)}`, `got ${JSON.stringify(str)}`);
      const state = formatMemoryStateLabel(h);
      assert(STATE_SET.has(state), `(9) state ∈ set for ${desc(h)}`, `got ${JSON.stringify(state)}`);
      const trust = formatMemoryTrustLabel(h);
      assert(TRUST_SET.has(trust), `(9) trust ∈ set for ${desc(h)}`, `got ${JSON.stringify(trust)}`);
      const bias = formatArchiveBiasLabel(h);
      assert(bias === null || typeof bias === 'string', `(9) archiveBias null|string for ${desc(h)}`, `got ${JSON.stringify(bias)}`);
      const src = formatMemorySourceLabel(h);
      assert(src === null || SOURCE_SET.has(src), `(9) source null|known for ${desc(h)}`, `got ${JSON.stringify(src)}`);
      const fam = getMemoryFamily(h);
      assert(FAMILY_SET.has(fam), `(9) family ∈ set for ${desc(h)}`, `got ${JSON.stringify(fam)}`);
      const famL = getMemoryFamilyLabel(h);
      assert(FAMILY_LABEL_SET.has(famL), `(9) familyLabel ∈ set for ${desc(h)}`, `got ${JSON.stringify(famL)}`);
    } catch (e) {
      failures += 1;
      console.error(`FAIL: (9) hostile input threw for ${desc(h)}: ${(e as Error)?.message}`);
    }
  }
  // hostile inputs that carry a valid field still produce the right answer
  assertEq(getMemoryFamily(nullProto), 'guidance', '(9) null-prototype object with instruction kind → guidance');
  assertEq(formatArchiveBiasLabel({ archiveBias: 'neutral', archivePassiveScore: 0 } as Ref), 'archive neutral', '(9) neutral score 0 still neutral under hostile sweep');

  // ─── (10) getMemoryFamily* survive a toString / toPrimitive bomb ──────────
  const toStringBomb: Ref = { memoryKind: { toString() { throw new Error('boom'); } } };
  const toPrimitiveBomb: Ref = { memoryKind: { [Symbol.toPrimitive]() { throw new Error('boom2'); } } };
  let bombThrew = false;
  try {
    assertEq(getMemoryFamily(toStringBomb), 'pattern', '(10) toString-bomb memoryKind → pattern (safeString guard)');
    assertEq(getMemoryFamilyLabel(toStringBomb), 'Pattern', '(10) toString-bomb → Pattern label');
    assertEq(getMemoryFamily(toPrimitiveBomb), 'pattern', '(10) toPrimitive-bomb memoryKind → pattern');
    assertEq(getMemoryFamilyLabel(toPrimitiveBomb), 'Pattern', '(10) toPrimitive-bomb → Pattern label');
  } catch {
    bombThrew = true;
  }
  assert(!bombThrew, '(10) safeString guard prevents a memoryKind toString/toPrimitive bomb from throwing');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chat-memory-label-core smoke cases passed (${passes} passed).`);
}

main();
