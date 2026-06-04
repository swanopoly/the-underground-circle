/**
 * tool-loop-progress-smoketest
 *
 * Verifies the "no silent truncation" progress summary the tool loop emits when
 * it hits its step cap: completed (✓) and failed (✗ + reason) steps are listed,
 * bounded, and empty input yields an empty string.
 *
 * Run: npm run smoke:tool-loop-progress
 */

import assert from 'node:assert/strict';

import { summarizeToolLoopProgress } from '../src/lib/toolLoopProgress';

// Empty / invalid input → empty string (caller filters it out).
assert.equal(summarizeToolLoopProgress([]), '');
assert.equal(summarizeToolLoopProgress(null), '');
assert.equal(summarizeToolLoopProgress(undefined), '');

// Mixed success/failure run.
const block = summarizeToolLoopProgress([
  { tool: 'desktop.launch_app', status: 'success', result: '{"ok":true,"data":{"app":"Photoshop"}}' },
  { tool: 'desktop.menu_click', status: 'success', result: '{"ok":true}' },
  { tool: 'desktop.click_element', status: 'error', result: '{"ok":false,"error":"element not found: Export"}' },
]);
assert(block.includes('Progress before the step limit:'), 'has header');
assert(block.includes('✓ desktop.launch_app'), 'success step marked ✓');
assert(block.includes('✗ desktop.click_element'), 'failed step marked ✗');
assert(block.includes('element not found: Export'), 'failure reason extracted from JSON error');
// Successful steps do not get a reason tail.
assert(!/✓ desktop\.menu_click —/.test(block), 'success steps have no reason tail');

// Plain-text failure result → first chunk shown as reason.
const textFail = summarizeToolLoopProgress([
  { tool: 'browser.fill_field', status: 'failed', result: 'Timed out waiting for the email field to become editable.' },
]);
assert(textFail.includes('✗ browser.fill_field'));
assert(textFail.includes('Timed out waiting'), 'plain-text failure reason surfaced');

// Bounded list with overflow note.
const many = Array.from({ length: 20 }, (_, i) => ({ tool: `desktop.step_${i}`, status: 'success', result: 'ok' }));
const bounded = summarizeToolLoopProgress(many, { maxItems: 5 });
assert((bounded.match(/^- /gm) || []).length === 6, 'shows maxItems + the overflow line');
assert(/…and 15 more steps/.test(bounded), 'overflow count is reported');

// Blocked/denied/timeout count as failures.
const blocked = summarizeToolLoopProgress([{ tool: 'desktop.open_path', status: 'blocked', result: 'approval required' }]);
assert(blocked.includes('✗ desktop.open_path'), 'blocked is treated as a non-success step');

console.log('All tool loop progress smoke cases passed.');
