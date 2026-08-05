/**
 * computer-run-diff-smoketest — verifies the repeat-run findings diff
 * (Phase 5c of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md): task
 * normalization lockstep, url/title keying, add/remove/price-change
 * classification, and the change-first summary copy.
 *
 * Run: npm run smoke:computer-run-diff
 */

import {
  diffComputerRunFindings,
  formatComputerRunDiffSummary,
  normalizeComputerTaskForComparison,
} from '../src/lib/computerRunDiff';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── Task normalization (lockstep with edge replay matcher) ──────────────────
{
  expect(
    normalizeComputerTaskForComparison('Run this computer task exactly as written:  Check   flight prices ')
      === 'check flight prices',
    'strips the replay prefix, lowercases, collapses whitespace',
  );
  expect(
    normalizeComputerTaskForComparison('Check flight prices')
      === normalizeComputerTaskForComparison('check FLIGHT  prices'),
    'same task in different casing/spacing matches',
  );
  expect(normalizeComputerTaskForComparison(null) === '', 'null → empty');
  pass('task normalization lockstep');
}

// ── Diff classification ─────────────────────────────────────────────────────
{
  const previous = [
    { title: 'Hotel Aurora', url: 'https://www.stay.com/aurora?ref=abc', price: '$210/night' },
    { title: 'Hotel Borealis', url: 'https://stay.com/borealis', price: '$180/night' },
    { title: 'Hostel Comet', price: '$60/night' },
  ];
  const current = [
    // Same Aurora but tracking params differ + price dropped.
    { title: 'Hotel Aurora — Deluxe', url: 'https://stay.com/aurora?ref=xyz', price: '$195/night' },
    // Borealis unchanged.
    { title: 'Hotel Borealis', url: 'https://www.stay.com/borealis/', price: '$180/night' },
    // Comet gone; Draco new.
    { title: 'Hotel Draco', url: 'https://stay.com/draco', price: '$150/night' },
  ];
  const diff = diffComputerRunFindings(previous, current);
  expect(diff.priceChanged.length === 1 && diff.priceChanged[0].after === '$195/night', 'url-keyed match survives tracking params + title edits, catches price change');
  expect(diff.added.length === 1 && diff.added[0].title === 'Hotel Draco', 'new finding classified as added');
  expect(diff.removed.length === 1 && diff.removed[0].title === 'Hostel Comet', 'missing finding classified as removed (title-keyed when no url)');
  expect(diff.unchangedCount === 1, 'unchanged finding counted (trailing slash + www normalized)');
  expect(diff.hasChanges, 'hasChanges true');
  pass('diff classification: added / removed / price change / unchanged');
}

// ── No-change run ───────────────────────────────────────────────────────────
{
  const same = [
    { title: 'Hotel Aurora', url: 'https://stay.com/aurora', price: '$210/night' },
  ];
  const diff = diffComputerRunFindings(same, same);
  expect(!diff.hasChanges, 'identical findings → no changes');
  const summary = formatComputerRunDiffSummary(diff, { previousAgeMs: 2 * 60 * 60 * 1000 });
  expect(summary.includes('No changes since the last run (2h ago)'), 'no-change summary says so with age');
  expect(summary.includes('Same 1 item'), 'no-change summary counts items');
  pass('no-change runs are stated explicitly');
}

// ── Summary copy + bounds ───────────────────────────────────────────────────
{
  const diff = diffComputerRunFindings(
    [{ title: 'A', url: 'https://x.com/a', price: '$10' }],
    [
      { title: 'A', url: 'https://x.com/a', price: '$8' },
      ...Array.from({ length: 20 }, (_, i) => ({ title: `New ${i} ${'x'.repeat(120)}`, price: `$${i}` })),
    ],
  );
  const summary = formatComputerRunDiffSummary(diff, { previousAgeMs: 5 * 60 * 1000 });
  expect(summary.startsWith('**Since the last run (5m ago): 20 new · 1 price change.**'), 'summary head: counts + age');
  expect(summary.includes('• Price: A — $10 → $8'), 'price line shows before → after');
  expect(summary.length <= 700, 'summary bounded for oversized diffs');
  expect(formatComputerRunDiffSummary(null) === '', 'null diff → empty (first run of a task)');
  pass('summary copy + bounds');
}

if (failures > 0) {
  console.error(`\n${failures} computer-run diff smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer-run diff smoke cases passed.');
