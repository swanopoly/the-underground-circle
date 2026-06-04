/**
 * app-action-verification-gate-smoketest
 *
 * Verifies the observe→act→verify gate that the tool loop attaches to mutating
 * app/desktop/browser tool results: mutating actions get a re-observe/verify
 * (or retry-ladder) reminder; read/observation and non-app tools pass through
 * unchanged.
 *
 * Run: npm run smoke:app-action-verification-gate
 */

import assert from 'node:assert/strict';

import {
  appActionVerificationReminder,
  appendAppActionVerificationGate,
  isAppMutatingTool,
} from '../src/lib/appActionVerificationGate';

// ── Mutating app actions are gated ─────────────────────────────────────────
for (const tool of [
  'desktop.click_element',
  'desktop.set_element_value',
  'desktop.menu_click',
  'desktop.type_text',
  'desktop.press_keys',
  'desktop.click_at',
  'desktop.mouse_drag',
  'desktop.launch_app',
  'desktop.open_url',
  'browser.click_role',
  'browser.fill_field',
  'browser.fill_credential_field',
  'browser.press_key',
]) {
  assert(isAppMutatingTool(tool), `${tool} should be a mutating app tool`);
}

// ── Read/observation app tools are NOT gated ───────────────────────────────
for (const tool of [
  'desktop.read_a11y_tree',
  'desktop.screenshot',
  'desktop.window_state',
  'desktop.list_running_apps',
  'desktop.wait_for_app',
  'desktop.screen_size',
  'desktop.file_stat',
  'desktop.file_search',
  'browser.dom_snapshot',
  'browser.verification_state',
  'browser.screenshot',
]) {
  assert(!isAppMutatingTool(tool), `${tool} is an observation tool and must not be gated`);
}

// ── Non-app tools are NOT gated (no false positives on same-named verbs) ────
for (const tool of [
  'research.fetch_url',
  'tasks.create',
  'messages.create',
  'rooms.send',
  'workspace.run_tests',
  'listLibrarySkills',
  'approvals.request',
  'agent.build_app_capability',
]) {
  assert(!isAppMutatingTool(tool), `${tool} is not an app-surface tool and must not be gated`);
}

// ── Success → re-observe + verify (do not assume success) ──────────────────
const success = appActionVerificationReminder('desktop.click_element', 'success');
assert(success, 'mutating success should produce a reminder');
assert(/observe-act-verify/i.test(success!));
assert(/re-observe|re observe/i.test(success!));
assert(/do not assume success/i.test(success!));
assert(/completion signal/i.test(success!), 'success reminder nudges structured completion');

// ── Failure → re-observe + climb the surface ladder, no blind repeat ───────
const failed = appActionVerificationReminder('browser.fill_field', 'error');
assert(failed, 'mutating failure should produce a reminder');
assert(/ladder/i.test(failed!));
assert(/semantic control/i.test(failed!) && /coordinate/i.test(failed!), 'failure reminder names the surface ladder');
assert(/do not repeat the same failed action/i.test(failed!));
assert(/capability buildout/i.test(failed!), 'failure reminder escalates to buildout after repeated failure');
assert(failed !== success, 'failure and success reminders differ');

// ── Inert (blocked/skipped) mutations get no nudge (result already explains) ─
assert.equal(appActionVerificationReminder('desktop.click_element', 'blocked'), null);
assert.equal(appActionVerificationReminder('desktop.menu_click', 'skipped'), null);

// ── Observation/non-app tools get no reminder regardless of status ─────────
assert.equal(appActionVerificationReminder('desktop.read_a11y_tree', 'success'), null);
assert.equal(appActionVerificationReminder('research.fetch_url', 'error'), null);

// ── appendAppActionVerificationGate: appends for mutating, passthrough else ─
const gated = appendAppActionVerificationGate('Clicked the Export button.', 'desktop.click_element', 'success');
assert(gated.startsWith('Clicked the Export button.'), 'original tool output is preserved');
assert(/observe-act-verify/i.test(gated), 'gate is appended');
assert.equal(
  appendAppActionVerificationGate('Accessibility tree: 42 nodes.', 'desktop.read_a11y_tree', 'success'),
  'Accessibility tree: 42 nodes.',
  'observation tool result is unchanged',
);
assert.equal(
  appendAppActionVerificationGate('Fetched 3 results.', 'research.fetch_url', 'success'),
  'Fetched 3 results.',
  'non-app tool result is unchanged',
);
// Empty content still yields the reminder alone for a mutating action.
assert(/observe-act-verify/i.test(appendAppActionVerificationGate('', 'desktop.type_text', 'success')));

console.log('All app action verification gate smoke cases passed.');
