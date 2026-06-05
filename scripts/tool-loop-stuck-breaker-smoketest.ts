/**
 * tool-loop-stuck-breaker-smoketest
 *
 * Verifies the stuck-loop guard: a tool call whose (name+input) signature
 * already failed gets a "do something different" reminder appended to its
 * tool_result, while a fixed/changed call or a first-time call passes through
 * untouched. Pure helpers → no heavy imports.
 *
 * Run: npm run smoke:tool-loop-stuck-breaker
 */

import assert from 'node:assert/strict';

import {
  toolCallSignature,
  detectStuckRepeat,
  stuckBreakerReminder,
  appendStuckBreaker,
  type ToolCallRecord,
} from '../src/lib/toolLoopStuckBreaker';

// ── toolCallSignature: key order doesn't matter, different inputs differ ─────
assert.equal(
  toolCallSignature('desktop.click_element', { label: 'Export', app: 'Photoshop' }),
  toolCallSignature('desktop.click_element', { app: 'Photoshop', label: 'Export' }),
  'object key order is normalized',
);
assert.notEqual(
  toolCallSignature('desktop.click_element', { label: 'Export' }),
  toolCallSignature('desktop.click_element', { label: 'Save' }),
  'different inputs → different signatures',
);
assert.notEqual(
  toolCallSignature('desktop.click_element', { label: 'Export' }),
  toolCallSignature('desktop.menu_click', { label: 'Export' }),
  'different tool → different signature',
);

// ── detectStuckRepeat ────────────────────────────────────────────────────────
const history: ToolCallRecord[] = [
  { tool: 'desktop.read_a11y_tree', input: {}, status: 'success', result: '{"ok":true}' },
  { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'error', result: '{"ok":false,"error":"element not found: Export"}' },
];

// Same call that already failed → flagged with the prior reason.
const repeat = detectStuckRepeat(history, { tool: 'desktop.click_element', input: { label: 'Export' } });
assert.equal(repeat.isRepeat, true, 'exact repeat of a failed call is detected');
assert.equal(repeat.priorFailures, 1, 'counts one prior failure');
assert(repeat.lastReason && repeat.lastReason.includes('element not found'), 'carries the prior failure reason');

// Changed input (model fixed its approach) → NOT flagged.
const fixed = detectStuckRepeat(history, { tool: 'desktop.click_element', input: { label: 'File' } });
assert.equal(fixed.isRepeat, false, 'a changed input is not treated as stuck');

// A call that only ever succeeded → NOT flagged.
const successOnly = detectStuckRepeat(history, { tool: 'desktop.read_a11y_tree', input: {} });
assert.equal(successOnly.isRepeat, false, 'a previously-successful call is not flagged');

// Two prior failures accumulate.
const history2: ToolCallRecord[] = [
  ...history,
  { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'failed', result: 'still not found' },
];
assert.equal(detectStuckRepeat(history2, { tool: 'desktop.click_element', input: { label: 'Export' } }).priorFailures, 2);

// Lookback window bounds the scan (old failure beyond the window is ignored).
const padded: ToolCallRecord[] = [
  { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'error', result: 'old failure' },
  ...Array.from({ length: 30 }, (_, i) => ({ tool: `desktop.noop_${i}`, input: {}, status: 'success', result: 'ok' })),
];
assert.equal(
  detectStuckRepeat(padded, { tool: 'desktop.click_element', input: { label: 'Export' } }, { lookback: 5 }).isRepeat,
  false,
  'failures older than the lookback window are not counted',
);

// ── stuckBreakerReminder content ─────────────────────────────────────────────
const reminder = stuckBreakerReminder('desktop.click_element', 1, 'element not found: Export');
assert(/Stuck-loop guard/i.test(reminder), 'has the guard header');
assert(reminder.includes('failed 2 times'), 'reports total attempt count (prior + current)');
assert(reminder.includes('element not found: Export'), 'names the last error');
assert(/Re-observe/i.test(reminder) && /ladder/i.test(reminder) && /stop and report/i.test(reminder), 'lists the productive alternatives');
assert(/Do NOT call it again unchanged/i.test(reminder), 'forbids the identical retry');

// ── appendStuckBreaker: only augments a repeated failure ─────────────────────
const base = '{"ok":false,"error":"element not found: Export"}';
const augmented = appendStuckBreaker(base, history, { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'error' });
assert(augmented.startsWith(base), 'keeps the original tool_result content');
assert(augmented.includes('Stuck-loop guard'), 'appends the breaker when the failing call repeats a prior failure');

// First-time failure (no prior) → unchanged.
const firstFail = appendStuckBreaker('{"ok":false,"error":"x"}', history, { tool: 'desktop.menu_click', input: { label: 'New' }, status: 'error' });
assert.equal(firstFail, '{"ok":false,"error":"x"}', 'a first-time failure is not nudged (it might just need a retry)');

// A successful repeat → unchanged (only failures are nudged).
const okRepeat = appendStuckBreaker('{"ok":true}', history, { tool: 'desktop.click_element', input: { label: 'Export' }, status: 'success' });
assert.equal(okRepeat, '{"ok":true}', 'a now-succeeding call is never nudged');

console.log('All tool loop stuck-breaker smoke cases passed.');
