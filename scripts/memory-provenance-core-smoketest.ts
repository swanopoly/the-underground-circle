/**
 * memory-provenance-core-smoketest — guards the PURE memory-provenance core that
 * makes retrieved-memory PROVENANCE (R2) + STALENESS (R5) visible to the model:
 *
 *   - memoryConfidenceBand: 0..1 and 0..100 scores bucket into high/medium/low;
 *     out-of-range / non-finite / non-numeric → 'unknown'.
 *   - formatAsOf: relative 'as of Nd/Nw/Nmo/Ny ago' from epoch-ms, numeric-string,
 *     or ISO-date inputs; future/skew → 'just now'; unknown → ''.
 *   - formatMemoryProvenance: one line + compact suffix
 *     `<text> [conf:high · as of 2d ago · src:chat · #id]`, with each token
 *     omitted when it lacks signal; secret text preserved but full id NEVER
 *     leaked (only a ≤6-char token); path sources reduced to a basename; bounded.
 *   - formatMemoryReferenceLine: the wiring adapter over a real
 *     PromptMemoryReference / MemoryEntry row.
 *   - Every export is TOTAL: hostile / cyclic / symbol / function / huge inputs
 *     never throw and degrade to a safe neutral.
 *
 * Imports the REAL module (pure — type-only imports, tsx-loadable).
 *
 * Run: npx tsx scripts/memory-provenance-core-smoketest.ts
 */

import {
  memoryConfidenceBand,
  formatAsOf,
  formatMemoryProvenance,
  formatMemoryReferenceLine,
  CONFIDENCE_HIGH_MIN,
  CONFIDENCE_MEDIUM_MIN,
  MAX_PROVENANCE_TEXT_LEN,
  type ConfidenceBand,
} from '../src/lib/memoryProvenanceCore';

let failures = 0;
let passes = 0;
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) {
    passes += 1;
    console.log('pass:', message);
  } else {
    failures += 1;
    console.error('FAIL:', `${message}${detail ? ` — ${detail}` : ''}`);
  }
}
function assertEqual<T>(actual: T, expected: T, message: string): void {
  assert(actual === expected, message, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function noThrow(label: string, fn: () => unknown): void {
  try {
    fn();
    assert(true, `no throw: ${label}`);
  } catch (e) {
    assert(false, `no throw: ${label}`, String(e));
  }
}
function assertString(v: unknown, label: string): void {
  assert(typeof v === 'string', `${label} returns a string`, `got ${typeof v}`);
}

const SEP = ' · '; // ' · ' — must equal the core's join separator (U+00B7)
const ELLIPSIS = '…'; // '…' (U+2026)
const NOW = 1_700_000_000_000; // fixed epoch anchor — deterministic, no Date.now
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ── 1. memoryConfidenceBand: 0..1 bands + boundaries ──────────────────────────
assertEqual(CONFIDENCE_HIGH_MIN, 0.66, 'high threshold is 0.66');
assertEqual(CONFIDENCE_MEDIUM_MIN, 0.33, 'medium threshold is 0.33');
assertEqual(memoryConfidenceBand(0.9), 'high', '0.9 → high');
assertEqual(memoryConfidenceBand(0.66), 'high', '0.66 (boundary) → high');
assertEqual(memoryConfidenceBand(1), 'high', '1 → high');
assertEqual(memoryConfidenceBand(0.7), 'high', '0.7 → high');
assertEqual(memoryConfidenceBand(0.65), 'medium', '0.65 → medium');
assertEqual(memoryConfidenceBand(0.5), 'medium', '0.5 → medium');
assertEqual(memoryConfidenceBand(0.33), 'medium', '0.33 (boundary) → medium');
assertEqual(memoryConfidenceBand(0.4), 'medium', '0.4 → medium');
assertEqual(memoryConfidenceBand(0.329), 'low', '0.329 → low');
assertEqual(memoryConfidenceBand(0.3), 'low', '0.3 → low');
assertEqual(memoryConfidenceBand(0.1), 'low', '0.1 → low');
assertEqual(memoryConfidenceBand(0), 'low', '0 → low (a real lowest score, not unknown)');

// ── 2. memoryConfidenceBand: 0..100 percentage scale ──────────────────────────
assertEqual(memoryConfidenceBand(85), 'high', '85% → high');
assertEqual(memoryConfidenceBand(70), 'high', '70% → high');
assertEqual(memoryConfidenceBand(67), 'high', '67% → high');
assertEqual(memoryConfidenceBand(100), 'high', '100% → high');
assertEqual(memoryConfidenceBand(50), 'medium', '50% → medium');
assertEqual(memoryConfidenceBand(40), 'medium', '40% → medium');
assertEqual(memoryConfidenceBand(34), 'medium', '34% → medium');
assertEqual(memoryConfidenceBand(30), 'low', '30% → low');
assertEqual(memoryConfidenceBand(10), 'low', '10% → low');

// ── 3. memoryConfidenceBand: numeric strings + out-of-range/non-numeric → unknown ─
assertEqual(memoryConfidenceBand('0.8'), 'high', 'numeric string "0.8" → high');
assertEqual(memoryConfidenceBand('50'), 'medium', 'numeric string "50" → medium');
assertEqual(memoryConfidenceBand('10'), 'low', 'numeric string "10" → low');
assertEqual(memoryConfidenceBand(100.1), 'unknown', '>100 → unknown (out of range)');
assertEqual(memoryConfidenceBand(1e9), 'unknown', 'huge score → unknown');
assertEqual(memoryConfidenceBand(Number.MAX_VALUE), 'unknown', 'MAX_VALUE → unknown');
assertEqual(memoryConfidenceBand(-1), 'unknown', 'negative → unknown');
assertEqual(memoryConfidenceBand(-0.5), 'unknown', '-0.5 → unknown');
assertEqual(memoryConfidenceBand(NaN), 'unknown', 'NaN → unknown');
assertEqual(memoryConfidenceBand(Infinity), 'unknown', 'Infinity → unknown');
assertEqual(memoryConfidenceBand(-Infinity), 'unknown', '-Infinity → unknown');
assertEqual(memoryConfidenceBand('abc'), 'unknown', 'non-numeric string → unknown');
assertEqual(memoryConfidenceBand(''), 'unknown', 'empty string → unknown');
assertEqual(memoryConfidenceBand('   '), 'unknown', 'blank string → unknown');
assertEqual(memoryConfidenceBand(null), 'unknown', 'null → unknown');
assertEqual(memoryConfidenceBand(undefined), 'unknown', 'undefined → unknown');
assertEqual(memoryConfidenceBand({} as unknown), 'unknown', 'object → unknown');
assertEqual(memoryConfidenceBand([] as unknown), 'unknown', 'array → unknown');
assertEqual(memoryConfidenceBand(true as unknown), 'unknown', 'boolean → unknown');

// ── 4. formatAsOf: relative age buckets ───────────────────────────────────────
assertEqual(formatAsOf(NOW - 30_000, NOW), 'as of just now', '30s ago → just now');
assertEqual(formatAsOf(NOW, NOW), 'as of just now', 'age 0 → just now');
assertEqual(formatAsOf(NOW - 30 * MIN, NOW), 'as of 30m ago', '30m ago');
assertEqual(formatAsOf(NOW - HOUR, NOW), 'as of 1h ago', '1h ago');
assertEqual(formatAsOf(NOW - 90 * MIN, NOW), 'as of 1h ago', '90m floors to 1h ago');
assertEqual(formatAsOf(NOW - 2 * DAY, NOW), 'as of 2d ago', '2d ago');
assertEqual(formatAsOf(NOW - 6 * DAY, NOW), 'as of 6d ago', '6d ago');
assertEqual(formatAsOf(NOW - 7 * DAY, NOW), 'as of 1w ago', '7d → 1w ago');
assertEqual(formatAsOf(NOW - 14 * DAY, NOW), 'as of 2w ago', '14d → 2w ago');
assertEqual(formatAsOf(NOW - 21 * DAY, NOW), 'as of 3w ago', '21d → 3w ago');
assertEqual(formatAsOf(NOW - 45 * DAY, NOW), 'as of 1mo ago', '45d → 1mo ago');
assertEqual(formatAsOf(NOW - 60 * DAY, NOW), 'as of 2mo ago', '60d → 2mo ago');
assertEqual(formatAsOf(NOW - 400 * DAY, NOW), 'as of 1y ago', '400d → 1y ago');
assertEqual(formatAsOf(NOW - 800 * DAY, NOW), 'as of 2y ago', '800d → 2y ago');

// ── 5. formatAsOf: ISO / numeric-string / skew / unknown ──────────────────────
const iso2dAgo = new Date(NOW - 2 * DAY).toISOString();
const isoNow = new Date(NOW).toISOString();
assertEqual(formatAsOf(iso2dAgo, NOW), 'as of 2d ago', 'ISO updatedAt vs epoch now → 2d ago');
assertEqual(formatAsOf(iso2dAgo, isoNow), 'as of 2d ago', 'ISO updatedAt vs ISO now → 2d ago');
assertEqual(formatAsOf(String(NOW - 3 * DAY), String(NOW)), 'as of 3d ago', 'numeric strings → 3d ago');
assertEqual(formatAsOf(NOW + 10 * DAY, NOW), 'as of just now', 'future timestamp (skew) → just now');
assertEqual(formatAsOf(undefined, NOW), '', 'undefined date → ""');
assertEqual(formatAsOf(NOW - DAY, undefined), '', 'undefined now → ""');
assertEqual(formatAsOf(null, NOW), '', 'null date → ""');
assertEqual(formatAsOf('not a date', NOW), '', 'unparseable date string → ""');
assertEqual(formatAsOf(NaN, NOW), '', 'NaN date → ""');
assertEqual(formatAsOf(NOW - DAY, NaN), '', 'NaN now → ""');
assertEqual(formatAsOf({} as unknown, NOW), '', 'object date → ""');
assert(formatAsOf(0, NOW).startsWith('as of ') && formatAsOf(0, NOW).endsWith('y ago'), 'epoch 0 → many years ago (bounded)', formatAsOf(0, NOW));

// ── 6. formatMemoryProvenance: full lines (high+fresh, old+low) ───────────────
const line1 = formatMemoryProvenance(
  { text: 'Team uses pnpm not npm', score: 0.9, source: 'chat', updatedAtMs: NOW - 2 * DAY, id: '550e8400-e29b-41d4-a716-446655440000' },
  NOW,
);
assertEqual(
  line1,
  `Team uses pnpm not npm [conf:high${SEP}as of 2d ago${SEP}src:chat${SEP}#550e84]`,
  'high+fresh line renders full provenance suffix',
);
assert(line1.includes('conf:high'), 'high line shows conf:high');
assert(line1.includes('as of 2d ago'), 'high line shows fresh as-of');

const line2 = formatMemoryProvenance(
  { text: 'Legacy API note', score: 0.1, source: 'session', updatedAtMs: NOW - 21 * DAY, id: 'abc123xyz' },
  NOW,
);
assertEqual(
  line2,
  `Legacy API note [conf:low${SEP}as of 3w ago${SEP}src:session${SEP}#abc123]`,
  'old+low line renders low confidence + weeks-old as-of',
);
assert(line2.includes('conf:low'), 'old line shows conf:low');
assert(line2.includes('as of 3w ago'), 'old line shows Nw-ago as-of');

// ── 7. formatMemoryProvenance: partial inputs degrade gracefully ──────────────
assertEqual(
  formatMemoryProvenance({ text: 'No score note', source: 'office', updatedAtMs: NOW - 3 * DAY }, NOW),
  `No score note [as of 3d ago${SEP}src:office]`,
  'missing score → conf token omitted (graceful)',
);
{
  const l = formatMemoryProvenance({ text: 'No score note', source: 'office', updatedAtMs: NOW - 3 * DAY }, NOW);
  assert(!l.includes('conf:'), 'missing score → no conf token at all');
}
assertEqual(
  formatMemoryProvenance({ text: 'No date note', score: 0.5, source: 'chat' }, NOW),
  `No date note [conf:medium${SEP}src:chat]`,
  'missing date → as-of token omitted (graceful)',
);
{
  const l = formatMemoryProvenance({ text: 'No date note', score: 0.5, source: 'chat' }, NOW);
  assert(!l.includes('as of'), 'missing date → no as-of token');
}
assertEqual(formatMemoryProvenance({ text: 'Bare note' }, NOW), 'Bare note', 'no score/date/source/id → plain text (no brackets)');
assertEqual(formatMemoryProvenance({ text: 'Bare note' }, undefined), 'Bare note', 'no now + bare item → plain text');
assertEqual(formatMemoryProvenance({ text: 'Only id', id: 'zz' }, undefined), 'Only id [#zz]', 'only id → just the citation token');

// ── 8. formatMemoryProvenance: secret preserved, id NOT leaked, path basename, bounds ─
const SECRET = 'sk-live-ABCDEF1234567890';
const FULL_ID = '11112222-3333-4444-5555-666677778888';
const secretLine = formatMemoryProvenance({ text: `deploy key ${SECRET}`, score: 0.8, source: 'vault', id: FULL_ID }, NOW);
assert(secretLine.includes(SECRET), 'secret text is PRESERVED (memory content is prompt-bound)');
assert(!secretLine.includes(FULL_ID), 'full id is NEVER leaked into the line');
assert(secretLine.includes('#111122'), 'only a short ≤6-char id token is emitted');
{
  const pathLine = formatMemoryProvenance({ text: 'Path source', score: 0.8, source: '/Users/private/config/session', id: 'x' }, NOW);
  assert(pathLine.includes('src:session'), 'path source reduced to its basename token');
  assert(!pathLine.includes('/Users'), 'full path is not leaked');
  assert(!pathLine.includes('private'), 'intermediate path segments are not leaked');
}
{
  const long = 'x'.repeat(500);
  const clipped = formatMemoryProvenance({ text: long, score: 0.9 }, NOW);
  assert(clipped.length <= MAX_PROVENANCE_TEXT_LEN + 40, 'long text is bounded', `len=${clipped.length}`);
  assert(clipped.includes(ELLIPSIS), 'clipped text carries an ellipsis');
  assert(clipped.startsWith('x'), 'clipped text keeps the leading content');
}
assertEqual(
  formatMemoryProvenance({ text: 'line1\nline2\tline3', score: 0.5 }, NOW),
  `line1 line2 line3 [conf:medium]`,
  'newlines/tabs collapse to single spaces (single-line safe)',
);
assert(!formatMemoryProvenance({ text: 'a\nb', score: 0.5 }, NOW).includes('\n'), 'no raw newline survives into the line');
assertEqual(formatMemoryProvenance({ score: 0.9, source: 'chat' }, NOW), '', 'no text → "" (nothing to render)');
assertEqual(formatMemoryProvenance({ text: '   ' }, NOW), '', 'blank text → ""');
assertEqual(formatMemoryProvenance({ text: '' }, NOW), '', 'empty text → ""');

// ── 9. formatMemoryReferenceLine: real PromptMemoryReference / MemoryEntry rows ─
const ref1 = { id: 'ref-987654', title: 'Prefs', score: 0.85, updatedAt: new Date(NOW - 2 * DAY).toISOString(), sourceSurface: 'chat' };
assertEqual(
  formatMemoryReferenceLine(ref1, NOW),
  `Prefs [conf:high${SEP}as of 2d ago${SEP}src:chat${SEP}#ref987]`,
  'PromptMemoryReference shape → provenance line (score/updatedAt/sourceSurface/id)',
);
assert(!formatMemoryReferenceLine(ref1, NOW).includes('ref-987654'), 'adapter never leaks the full reference id');

const entry1 = { id: 'm1', title: 'Note', content: 'stuff here', updated_at: new Date(NOW - 3 * DAY).toISOString(), source_surface: 'office' };
assertEqual(
  formatMemoryReferenceLine(entry1, NOW),
  `Note: stuff here [as of 3d ago${SEP}src:office${SEP}#m1]`,
  'MemoryEntry shape → "title: content" line + as-of + source (no score → no conf)',
);
assert(!formatMemoryReferenceLine(entry1, NOW).includes('conf:'), 'MemoryEntry without score → no conf token');

assertEqual(
  formatMemoryReferenceLine({ title: 'C', content: 'x', confidence: 0.9, updated_at: new Date(NOW - DAY).toISOString() }, NOW),
  `C: x [conf:high${SEP}as of 1d ago]`,
  'confidence is used when score is absent',
);
assertEqual(
  formatMemoryReferenceLine({ title: 'T', content: 'y', created_at: new Date(NOW - 5 * DAY).toISOString(), score: 0.5 }, NOW),
  `T: y [conf:medium${SEP}as of 5d ago]`,
  'created_at is used when updated_at is absent',
);
{
  const l = formatMemoryReferenceLine({ text: 'explicit', title: 'IGNORED', content: 'IGNORED2', score: 0.9 }, NOW);
  assert(l.includes('explicit'), 'explicit text wins over title/content');
  assert(!l.includes('IGNORED'), 'title/content ignored when explicit text present');
}
assertEqual(formatMemoryReferenceLine(null, NOW), '', 'adapter(null) → ""');
assertEqual(formatMemoryReferenceLine(undefined, NOW), '', 'adapter(undefined) → ""');
assertEqual(formatMemoryReferenceLine('just a string', NOW), '', 'adapter(string) → "" (no title/content/text field)');
assertEqual(formatMemoryReferenceLine(42, NOW), '', 'adapter(number) → ""');

// ── 10. Hostile / cyclic / symbol / function → never throw ────────────────────
const cyclic: Record<string, unknown> = { text: 'cyclic text', score: 0.9 };
cyclic.self = cyclic;
const sym = Symbol('secret');
const fn = () => 'x';
const hostiles: unknown[] = [undefined, null, 42, 'str', true, 1n, {}, [], sym, fn, cyclic, NaN, Infinity];

for (const h of hostiles) {
  noThrow(`memoryConfidenceBand(${String(typeof h)})`, () => memoryConfidenceBand(h));
  noThrow(`formatAsOf(x, now) hostile`, () => formatAsOf(h, NOW));
  noThrow(`formatAsOf(updated, x) hostile`, () => formatAsOf(NOW - DAY, h));
  noThrow(`formatMemoryProvenance(hostile-item, now)`, () => formatMemoryProvenance(h as never, NOW));
  noThrow(`formatMemoryProvenance(item, hostile-now)`, () => formatMemoryProvenance({ text: 't', updatedAtMs: NOW - DAY }, h));
  noThrow(`formatMemoryReferenceLine(hostile, now)`, () => formatMemoryReferenceLine(h, NOW));
}
// results are always strings even for hostile input
assertString(memoryConfidenceBand(sym), 'memoryConfidenceBand(symbol)');
assertString(formatAsOf(sym, NOW), 'formatAsOf(symbol,...)');
assertString(formatMemoryProvenance(cyclic as never, NOW), 'formatMemoryProvenance(cyclic)');
assertString(formatMemoryReferenceLine(cyclic, NOW), 'formatMemoryReferenceLine(cyclic)');
// cyclic object is read shallowly — its usable fields still render, .self is never traversed
assert(formatMemoryProvenance(cyclic as never, NOW).includes('cyclic text'), 'cyclic item still renders its text field');
// a symbol/function passed as the whole item is not object-shaped for our read → ""
assertEqual(formatMemoryProvenance(fn as never, NOW), '', 'function item → "" (not object-shaped)');
assertEqual(formatMemoryProvenance(sym as never, NOW), '', 'symbol item → ""');
// a symbol as the TEXT field coerces to "" (never throws on Symbol→string)
assertEqual(formatMemoryProvenance({ text: sym, score: 0.9 } as never, NOW), '', 'symbol text field → "" (no throw)');
assertEqual(memoryConfidenceBand(1n), 'unknown', 'bigint score → unknown');

// ── 11. Determinism + band type soundness ─────────────────────────────────────
const detItem = { text: 'determinism', score: 0.9, source: 'chat', updatedAtMs: NOW - 2 * DAY, id: 'det-1234' };
assertEqual(formatMemoryProvenance(detItem, NOW), formatMemoryProvenance(detItem, NOW), 'formatMemoryProvenance is deterministic');
assertEqual(formatAsOf(NOW - 2 * DAY, NOW), formatAsOf(NOW - 2 * DAY, NOW), 'formatAsOf is deterministic');
const bands: ConfidenceBand[] = ['high', 'medium', 'low', 'unknown'];
assert(bands.includes(memoryConfidenceBand(0.9)), 'band is one of the four allowed values (high)');
assert(bands.includes(memoryConfidenceBand(NaN)), 'band is one of the four allowed values (unknown)');

// ── summary ───────────────────────────────────────────────────────────────────
console.log(`memory-provenance-core smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('memory-provenance-core smoke: ALL PASS');
