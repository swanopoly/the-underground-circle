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

import { nextSurfaceForFailedAction, formatSurfaceLadderHint, observationToolForFailedAction } from '../src/lib/appSurfaceLadder';
import {
  buildAppAutomationControlSurfacePlan,
  planSurfaceEscalation,
  appendSurfaceEscalation,
  type ComputerTaskSurfaceEscalation,
} from '../src/lib/appAutomationControlSurfaces';

// The full set of real tool names this ladder is allowed to reference. Keeps the
// hint honest: a nudge must never name a tool that doesn't exist.
const CATALOG = new Set([
  // desktop
  'desktop.click_element', 'desktop.set_element_value', 'desktop.menu_click',
  'desktop.press_keys', 'desktop.shortcuts_run', 'desktop.type_text',
  'desktop.click_at', 'desktop.read_a11y_tree',
  // browser
  'browser.click_role', 'browser.fill_field', 'browser.select_option',
  'browser.press_key', 'browser.dom_snapshot',
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

// ── Browser surface ladder ───────────────────────────────────────────────────
// click_role (browser's only click) → keyboard nav, then re-read the DOM.
const browserClick = nextSurfaceForFailedAction('browser.click_role');
assert(browserClick && browserClick.length === 2, 'browser.click_role has a 2-step ladder');
assert.equal(browserClick![0].tool, 'browser.press_key', 'first browser fallback is keyboard nav');
assert.equal(browserClick![1].tool, 'browser.dom_snapshot', 'then re-read the DOM to correct the locator');

// Every browser ladder tool is real and never a coordinate click (none exists).
for (const fromTool of ['browser.click_role', 'browser.fill_field', 'browser.select_option']) {
  const steps = nextSurfaceForFailedAction(fromTool) || [];
  assert(steps.length > 0, `${fromTool} has a ladder`);
  for (const step of steps) {
    assert(CATALOG.has(step.tool), `browser ladder for ${fromTool} references a real tool, got ${step.tool}`);
    assert(!/click_at|coordinate/i.test(step.tool), 'browser ladder never invents a coordinate click');
    assert(step.tool !== fromTool, `${fromTool} ladder does not point back at itself`);
  }
}

const browserHint = formatSurfaceLadderHint('browser.fill_field');
assert(browserHint && browserHint.includes('browser.click_role'), 'browser hint names real browser tools');

// ── observationToolForFailedAction: per-surface re-observe tool ──────────────
assert.equal(observationToolForFailedAction('desktop.click_element'), 'desktop.read_a11y_tree', 'desktop action → a11y tree');
assert.equal(observationToolForFailedAction('browser.click_role'), 'browser.dom_snapshot', 'browser action → DOM snapshot');
assert.equal(observationToolForFailedAction('browser.fill_field'), 'browser.dom_snapshot', 'browser fill → DOM snapshot');
assert.equal(observationToolForFailedAction('desktop.read_a11y_tree'), null, 'a non-action tool has no re-observe');
assert.equal(observationToolForFailedAction('desktop.file_stat'), null, 'a file op has no re-observe');

// ── E1: mid-run surface escalation over a REAL ranked candidate ladder ──────
// Walks a full run against the generic native-app plan: adapter failure on the
// top rung → descend; a11y coverage failure → descend PAST tree-dependent
// rungs to pixels; third failure → stop with the attempted-surface history.
{
  const plan = buildAppAutomationControlSurfacePlan('open the mystery editor app and click the export button');
  const ids = plan.candidates.map((c) => c.id);
  assert(ids[0] === 'vendor_script_or_plugin_api', 'e1: generic plan top rung is the vendor script/API surface');
  assert(ids.includes('screenshot_coordinate_fallback'), 'e1: generic plan has a pixel rung');

  const attempted: string[] = [ids[0]];
  let crumbs: ComputerTaskSurfaceEscalation[] = [];

  // Descent 1: vendor rung errors → os accessibility.
  const step1 = planSurfaceEscalation({
    currentSurfaceId: attempted[attempted.length - 1],
    candidates: plan.candidates,
    failure: { code: 'adapter_error', message: 'no vendor adapter matched' },
    attemptedSurfaceIds: attempted,
  });
  assert(step1.action === 'descend', 'e1 walk: first failure descends');
  if (step1.action !== 'descend') throw new Error('unreachable');
  assert.equal(step1.next.id, 'os_accessibility', 'e1 walk: descends to the a11y rung');
  assert(step1.freshObservationRequired, 'e1 walk: descent 1 requires fresh observation');
  crumbs = appendSurfaceEscalation(crumbs, {
    fromSurface: attempted[attempted.length - 1], toSurface: step1.next.id, reason: step1.reason, atIso: new Date().toISOString(),
    appName: plan.targetName, failureCode: 'adapter_error',
  });
  attempted.push(step1.next.id);

  // Descent 2: a11y coverage gap → skips semantic_desktop (tree-dependent) AND
  // connected_agent_buildout (not an in-run rung) → pixel rung.
  const step2 = planSurfaceEscalation({
    currentSurfaceId: 'os_accessibility',
    candidates: plan.candidates,
    failure: { code: 'a11y_tree_empty', message: 'desktop_a11y_tree failed with a11y_tree_empty' },
    attemptedSurfaceIds: attempted,
  });
  assert(step2.action === 'descend', 'e1 walk: a11y coverage failure descends');
  if (step2.action !== 'descend') throw new Error('unreachable');
  assert.equal(step2.next.id, 'screenshot_coordinate_fallback', 'e1 walk: a11y gap lands on the pixel rung');
  assert(step2.freshObservationRequired, 'e1 walk: descent 2 requires fresh observation');
  assert(step2.extraApprovalsRequired.length > 0, 'e1 walk: pixel rung surfaces its extra approvals for gating');
  crumbs = appendSurfaceEscalation(crumbs, {
    fromSurface: 'os_accessibility', toSurface: step2.next.id, reason: step2.reason, atIso: new Date().toISOString(),
    appName: plan.targetName, failureCode: 'a11y_tree_empty',
  });
  attempted.push(step2.next.id);

  // Third failure: budget (≤2 descents) exhausted → stop with full history.
  const step3 = planSurfaceEscalation({
    currentSurfaceId: 'screenshot_coordinate_fallback',
    candidates: plan.candidates,
    failure: { code: 'adapter_error', message: 'coordinate click missed' },
    attemptedSurfaceIds: attempted,
  });
  assert(step3.action === 'stop', 'e1 walk: third failure stops (2-descent budget)');
  for (const id of attempted) {
    assert(step3.action === 'stop' && step3.reason.includes(id), `e1 walk: stop history names ${id}`);
  }
  assert(crumbs.length === 2 && crumbs[1].failureCode === 'a11y_tree_empty', 'e1 walk: breadcrumbs record the a11y failure code (AX-coverage telemetry)');
}

console.log('All app surface ladder smoke cases passed.');
