/**
 * deterministic-reobserve-smoketest
 *
 * Verifies the auto re-observe layer: a failed UI action plans a read-only
 * observation; a successful action, a read tool, or a non-UI tool plan nothing;
 * the observation note extracts the a11y text, is bounded, and is empty when the
 * observation itself failed. Pure helpers → no heavy imports.
 *
 * Run: npm run smoke:deterministic-reobserve
 */

import assert from 'node:assert/strict';

import { planDeterministicReobserve, summarizeObservationForRetry } from '../src/lib/deterministicReobserve';

// ── planDeterministicReobserve ───────────────────────────────────────────────
// A failed UI action → plan a read-only a11y observation.
const plan = planDeterministicReobserve('desktop.click_element', 'error');
assert(plan && plan.observationTool === 'desktop.read_a11y_tree', 'failed click_element → re-observe via a11y tree');
assert(planDeterministicReobserve('desktop.menu_click', 'failed') !== null, 'failed menu_click also plans re-observe');
assert(planDeterministicReobserve('desktop.set_element_value', 'blocked') !== null, 'blocked counts as failure');

// A successful action → no re-observe (nothing to recover from).
assert.equal(planDeterministicReobserve('desktop.click_element', 'success'), null, 'a successful action does not re-observe');

// A read tool or non-UI tool → no ladder → no re-observe.
assert.equal(planDeterministicReobserve('desktop.read_a11y_tree', 'error'), null, 'a failed read is not a UI action');
assert.equal(planDeterministicReobserve('desktop.file_stat', 'error'), null, 'a failed file op is not a UI action');
assert.equal(planDeterministicReobserve('desktop.screenshot', 'failed'), null, 'observation tools have no ladder');

// Browser actions re-observe via the DOM snapshot (not the a11y tree).
assert.equal(planDeterministicReobserve('browser.click_role', 'error')?.observationTool, 'browser.dom_snapshot', 'failed browser click → DOM snapshot');
assert.equal(planDeterministicReobserve('browser.fill_field', 'failed')?.observationTool, 'browser.dom_snapshot', 'failed browser fill → DOM snapshot');
assert.equal(planDeterministicReobserve('browser.dom_snapshot', 'error'), null, 'a failed browser read is not a UI action');

// ── summarizeObservationForRetry ─────────────────────────────────────────────
// Extracts the a11y `data.text` and frames it for the retry.
const note = summarizeObservationForRetry('{"ok":true,"data":{"app":"Photoshop","text":"File\\nEdit\\nImage\\nLayer\\nExport As…"}}', 'success');
assert(/auto-observed current state/i.test(note), 'note is framed as fresh observed state');
assert(note.includes('Export As…'), 'extracts the a11y tree text');
assert(note.startsWith('\n\n'), 'note is separated from the prior content');

// A failed observation → empty note (fall back to the nudge).
assert.equal(summarizeObservationForRetry('{"ok":false,"error":"bridge offline"}', 'error'), '', 'a failed observation adds nothing');
assert.equal(summarizeObservationForRetry('', 'success'), '', 'empty result adds nothing');
assert.equal(summarizeObservationForRetry(null, 'success'), '', 'null result adds nothing');

// Bounded so a huge tree can't blow up the tool_result.
const huge = `{"ok":true,"data":{"text":"${'x'.repeat(5000)}"}}`;
const bounded = summarizeObservationForRetry(huge, 'success', { maxChars: 500 });
assert(bounded.includes('…(truncated)'), 'oversized observation is truncated');
assert(bounded.length < 800, 'bounded note stays small');

// Non-JSON result → uses the raw text (still bounded).
const rawNote = summarizeObservationForRetry('plain text observation', 'success');
assert(rawNote.includes('plain text observation'), 'non-JSON falls back to raw text');

console.log('All deterministic re-observe smoke cases passed.');
