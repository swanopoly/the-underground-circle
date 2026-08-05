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

import { summarizeToolLoopProgress, buildToolLoopCheckpoint, extractAssistantText, isObservationTool, isFailedStatus } from '../src/lib/toolLoopProgress';

// ── extractAssistantText ───────────────────────────────────────────────────
assert.equal(extractAssistantText([{ type: 'text', text: 'hello ' }, { type: 'text', text: 'world' }]), 'hello world');
assert.equal(extractAssistantText([{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'x' }, { type: 'text', text: 'b' }]), 'ab', 'ignores tool_use blocks');
assert.equal(extractAssistantText([]), '');
assert.equal(extractAssistantText(null), '');
assert.equal(extractAssistantText('not an array'), '');
assert.equal(extractAssistantText([{ type: 'tool_use', name: 'x' }]), '', 'pure tool_use round → empty (triggers finalization)');

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

// ── Machine-readable resume checkpoint ─────────────────────────────────────
const emptyCp = buildToolLoopCheckpoint([]);
assert.equal(emptyCp.schemaVersion, 1);
assert.equal(emptyCp.stepCount, 0);
assert.deepEqual(emptyCp.completedSteps, []);
assert.equal(emptyCp.lastObservation, null);
assert.equal(emptyCp.lastFailure, null);
assert(/re-observ/i.test(emptyCp.resumeHint), 'no-failure resume hint nudges re-observation');

const cp = buildToolLoopCheckpoint([
  { tool: 'desktop.launch_app', status: 'success', result: '{"ok":true}' },
  { tool: 'desktop.read_a11y_tree', status: 'success', result: '{"ok":true,"data":{"app":"Photoshop","text":"File\\nEdit\\nExport"}}' },
  { tool: 'desktop.click_element', status: 'error', result: '{"ok":false,"error":"element not found: Export"}' },
], { maxRounds: 5 });
assert.equal(cp.stepCount, 3);
assert.equal(cp.maxRounds, 5);
assert.equal(cp.completedSteps.length, 3);
assert.equal(cp.completedSteps[0].ok, true);
assert.equal(cp.completedSteps[2].ok, false);
assert(cp.completedSteps[2].reason && cp.completedSteps[2].reason.includes('element not found'), 'failed step carries reason');
assert(cp.lastObservation && cp.lastObservation.tool === 'desktop.read_a11y_tree', 'last observation is the ground-truth read');
assert(cp.lastFailure && cp.lastFailure.tool === 'desktop.click_element', 'last failure is captured for retry');
assert(/retry the failed step \(desktop\.click_element\)/i.test(cp.resumeHint), 'resume hint names the step to retry');
assert(/ladder/i.test(cp.resumeHint), 'resume hint references the surface ladder');

// Step list is bounded.
const manyCp = buildToolLoopCheckpoint(
  Array.from({ length: 30 }, (_, i) => ({ tool: `desktop.step_${i}`, status: 'success', result: 'ok' })),
  { maxSteps: 8 },
);
assert.equal(manyCp.stepCount, 30, 'stepCount reflects the true total');
assert.equal(manyCp.completedSteps.length, 8, 'completedSteps is bounded to maxSteps');

// ── Shared predicates (reused by proof-coverage / checkpoint logic) ──────────
assert(isObservationTool('desktop.read_a11y_tree') && isObservationTool('desktop.screenshot'), 'observation tools recognized');
assert(isObservationTool('desktop.photoshop_document_status'), 'document_status is an observation');
assert(!isObservationTool('desktop.click_element'), 'a mutation is not an observation');
assert(isFailedStatus('error') && isFailedStatus('blocked') && isFailedStatus('timeout'), 'failure statuses recognized');
assert(!isFailedStatus('success') && !isFailedStatus(''), 'success/empty are not failures');

console.log('All tool loop progress smoke cases passed.');
