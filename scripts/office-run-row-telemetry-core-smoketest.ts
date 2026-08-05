/**
 * office-run-row-telemetry-core-smoketest — exercises the pure run-row
 * telemetry suffix formatter in src/lib/officeRunRowTelemetryCore.ts.
 *
 * Covers:
 *   1. Both absent → '' (a row with no telemetry stays time-only)
 *   2. Cost threshold (hide < $0.005), rounding to 2dp, cost-only suffix
 *   3. Token threshold (hide < 500), k/M formatting, tokens-only suffix
 *   4. Combined suffix ordering: cost first, then tokens
 *   5. Lockstep with the board's formatTokenCount convention
 *   6. Totality: null/undefined/NaN/negative/hostile input never throws,
 *      never leaks "NaN"/"$0.00"
 *
 * Usage:
 *   npx tsx scripts/office-run-row-telemetry-core-smoketest.ts
 */

import {
  formatRunRowTelemetry,
  runRowTokenTotal,
  RUN_ROW_MIN_COST_USD,
  RUN_ROW_MIN_TOKENS,
  RUN_ROW_TELEMETRY_SEPARATOR,
} from '../src/lib/officeRunRowTelemetryCore';
import { formatTokenCount } from '../src/lib/officeOpsBoard';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('office-run-row-telemetry-core smoketest');

// ── 1. Both absent → '' ──────────────────────────────────────────────────────
console.log('\n[1] empty cases');
check('no input at all → empty', formatRunRowTelemetry({}) === '');
check('undefined input → empty', formatRunRowTelemetry(undefined) === '');
check('null input → empty', formatRunRowTelemetry(null) === '');
check('tokens null + cost null → empty', formatRunRowTelemetry({ tokens: null, costUsd: null }) === '');
check('zero tokens + zero cost → empty', formatRunRowTelemetry({ tokens: { input: 0, output: 0, cached: 0 }, costUsd: 0 }) === '');

// ── 2. Cost threshold + rounding ─────────────────────────────────────────────
console.log('\n[2] cost formatting');
check('threshold constant is half a cent', RUN_ROW_MIN_COST_USD === 0.005);
check('cost below threshold hidden', formatRunRowTelemetry({ costUsd: 0.004 }) === '');
check('cost just below threshold hidden', formatRunRowTelemetry({ costUsd: 0.00499 }) === '');
check('cost at threshold shows', formatRunRowTelemetry({ costUsd: 0.005 }) === ' · $0.01', formatRunRowTelemetry({ costUsd: 0.005 }));
check('4-cent cost → " · $0.04"', formatRunRowTelemetry({ costUsd: 0.04 }) === ' · $0.04');
check('rounding 0.044 → $0.04', formatRunRowTelemetry({ costUsd: 0.044 }) === ' · $0.04');
check('rounding 0.046 → $0.05', formatRunRowTelemetry({ costUsd: 0.046 }) === ' · $0.05');
check('dollar-scale cost → 2dp', formatRunRowTelemetry({ costUsd: 1.2 }) === ' · $1.20');
check('multi-dollar cost → 2dp', formatRunRowTelemetry({ costUsd: 12.345 }) === ' · $12.35');

// ── 3. Token threshold + k/M formatting ─────────────────────────────────────
console.log('\n[3] token formatting');
check('threshold constant is 500', RUN_ROW_MIN_TOKENS === 500);
check('tokens below threshold hidden', formatRunRowTelemetry({ tokens: { input: 200, output: 100, cached: 99 } }) === '');
check('tokens at threshold show', formatRunRowTelemetry({ tokens: { input: 500 } }) === ' · 500');
check('sub-1k tokens render raw', formatRunRowTelemetry({ tokens: { input: 950 } }) === ' · 950');
check('12k tokens → " · 12k"', formatRunRowTelemetry({ tokens: { input: 8000, output: 4000 } }) === ' · 12k');
check('1234 tokens → 1.2k', formatRunRowTelemetry({ tokens: { input: 1234 } }) === ' · 1.2k');
check('3.4M tokens → M suffix', formatRunRowTelemetry({ tokens: { input: 3_400_000 } }) === ' · 3.4M');
check('totals sum input+output+cached', runRowTokenTotal({ input: 100, output: 200, cached: 300 }) === 600);
check('summed total crosses threshold', formatRunRowTelemetry({ tokens: { input: 200, output: 200, cached: 100 } }) === ' · 500');

// ── 4. Combined ordering ─────────────────────────────────────────────────────
console.log('\n[4] combined suffix');
check(
  'cost then tokens: " · $0.04 · 12k"',
  formatRunRowTelemetry({ tokens: { input: 12_000 }, costUsd: 0.04 }) === ' · $0.04 · 12k',
  formatRunRowTelemetry({ tokens: { input: 12_000 }, costUsd: 0.04 }),
);
check('separator constant matches', RUN_ROW_TELEMETRY_SEPARATOR === ' · ');
check('cost visible, tokens elided → cost-only', formatRunRowTelemetry({ tokens: { input: 100 }, costUsd: 0.5 }) === ' · $0.50');
check('tokens visible, cost elided → tokens-only', formatRunRowTelemetry({ tokens: { input: 5000 }, costUsd: 0.001 }) === ' · 5k');

// ── 5. Lockstep with the board's k/M convention ─────────────────────────────
console.log('\n[5] formatTokenCount lockstep');
for (const n of [500, 950, 1234, 45_000, 3_400_000]) {
  check(
    `suffix for ${n} tokens uses formatTokenCount (${formatTokenCount(n)})`,
    formatRunRowTelemetry({ tokens: { input: n } }) === ` · ${formatTokenCount(n)}`,
  );
}

// ── 6. Totality ──────────────────────────────────────────────────────────────
console.log('\n[6] totality');
const hostile: unknown[] = [
  { costUsd: NaN },
  { costUsd: Infinity },
  { costUsd: -1 },
  { costUsd: 'a lot' },
  { tokens: { input: NaN, output: -5, cached: Infinity } },
  { tokens: { input: 'many' } },
  { tokens: 'nope' },
  { tokens: [] },
  { tokens: { } },
  42,
  'string',
  [],
];
let threw = false;
let leaked = false;
for (const input of hostile) {
  try {
    const out = formatRunRowTelemetry(input as never);
    if (typeof out !== 'string' || out.includes('NaN') || out.includes('Infinity') || out.includes('$0.00')) leaked = true;
  } catch {
    threw = true;
  }
}
check('hostile inputs never throw', !threw);
check('hostile inputs never leak NaN/Infinity/$0.00', !leaked);
check('NaN cost alone → empty', formatRunRowTelemetry({ costUsd: NaN }) === '');
check('negative cost → empty', formatRunRowTelemetry({ costUsd: -3 }) === '');
check('Infinity cost → empty (non-finite elided)', formatRunRowTelemetry({ costUsd: Infinity }) === '');
check('NaN tokens fields treated as 0', runRowTokenTotal({ input: NaN, output: 600 }) === 600);
check(
  'determinism: identical input → identical output',
  formatRunRowTelemetry({ tokens: { input: 12_000 }, costUsd: 0.04 }) ===
    formatRunRowTelemetry({ tokens: { input: 12_000 }, costUsd: 0.04 }),
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
