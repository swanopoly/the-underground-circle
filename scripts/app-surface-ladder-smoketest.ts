/**
 * app-surface-ladder-smoketest
 *
 * Verifies the desktop UI-action surface ladder: failed interaction tools map
 * to an ordered list of concrete next tools (semantic → menu → keyboard →
 * coordinate), the inline hint names real catalog tools, and non-ladder tools
 * (reads, file ops) return null so callers fall back to generic guidance.
 *
 * Run: npm run smoke:app-surface-ladder
 */

import assert from 'node:assert/strict';

import { nextSurfaceForFailedAction, formatSurfaceLadderHint } from '../src/lib/appSurfaceLadder';

// The full set of desktop tool names this ladder is allowed to reference. Keeps
// the hint honest: a nudge must never name a tool that doesn't exist.
const CATALOG = new Set([
  'desktop.click_element', 'desktop.set_element_value', 'desktop.menu_click',
  'desktop.press_keys', 'desktop.shortcuts_run', 'desktop.type_text',
  'desktop.click_at', 'desktop.read_a11y_tree',
]);

// click_element ladder: menu → shortcut → coordinate, in that order.
const clickLadder = nextSurfaceForFailedAction('desktop.click_element');
assert(clickLadder && clickLadder.length === 3, 'click_element has a 3-step ladder');
assert.deepEqual(clickLadder!.map((s) => s.tool), ['desktop.menu_click', 'desktop.press_keys', 'desktop.click_at'], 'ordered semantic→menu→shortcut→coordinate');
assert(/last resort/i.test(clickLadder![clickLadder!.length - 1].why), 'coordinate is framed as last resort');

// Every referenced tool is a real catalog tool (no hallucinated next tool).
for (const fromTool of ['desktop.click_element', 'desktop.set_element_value', 'desktop.menu_click', 'desktop.type_text', 'desktop.click_at']) {
  for (const step of nextSurfaceForFailedAction(fromTool) || []) {
    assert(CATALOG.has(step.tool), `ladder for ${fromTool} references a real tool, got ${step.tool}`);
    assert(step.tool !== fromTool, `${fromTool} ladder does not point back at itself`);
  }
}

// Coordinate failure points back at re-observation (don't double down on coords).
const coordLadder = nextSurfaceForFailedAction('desktop.click_at');
assert(coordLadder && coordLadder[0].tool === 'desktop.read_a11y_tree', 'click_at failure → re-observe first');

// Inline hint names the tools and reads as an ordered phrase.
const hint = formatSurfaceLadderHint('desktop.click_element');
assert(hint && hint.startsWith('try `desktop.menu_click`'), 'hint starts with "try <first>"');
assert(hint!.includes('then `desktop.press_keys`') && hint!.includes('then `desktop.click_at`'), 'subsequent steps use "then"');

// Non-ladder tools → null (caller uses generic guidance).
assert.equal(nextSurfaceForFailedAction('desktop.read_a11y_tree'), null, 'a read tool has no action ladder');
assert.equal(nextSurfaceForFailedAction('desktop.file_stat'), null, 'a file op has no action ladder');
assert.equal(formatSurfaceLadderHint('desktop.screenshot'), null, 'unknown/observe tool → null hint');

console.log('All app surface ladder smoke cases passed.');
