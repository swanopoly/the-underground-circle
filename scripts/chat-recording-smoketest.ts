/**
 * chat-recording-smoketest — UC-4 coverage for the pure parts of the
 * record/replay engine: slugification, step building, replay planning,
 * tree scanning. The observer-in-dispatcher path is verified manually
 * against the real bridge.
 *
 * Run: npm run smoke:chat-recording
 *
 * The module reads/writes localStorage, which doesn't exist in Node.
 * We install a minimal in-memory shim before importing.
 */

// Install localStorage shim BEFORE any module import that might touch it.
const memStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in memStore ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = String(v); },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { for (const k of Object.keys(memStore)) delete memStore[k]; },
};

// eslint-disable-next-line import/first
import {
  abortRecording,
  appendStep,
  buildStep,
  deleteRecording,
  formatElapsedSec,
  getActiveSession,
  getRecording,
  isRecordable,
  listRecordings,
  planReplay,
  planReplayStep,
  slugifyRecordingName,
  startRecording,
  stopRecording,
} from '../src/lib/chatRecording';
// eslint-disable-next-line import/first
import { findInTree } from '../src/lib/recordingChatCommands';

// ─── Runner ──────────────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function resetStore() {
  (globalThis as any).localStorage.clear();
}

function main() {
  // ─── Slug ───────────────────────────────────────────────────────
  assert(slugifyRecordingName('Open Zoom') === 'open-zoom', 'slug: words');
  assert(slugifyRecordingName('  Close the deal!  ') === 'close-the-deal', 'slug: trim + strip !');
  assert(slugifyRecordingName('foo__bar---baz') === 'foo-bar-baz', 'slug: collapse separators');
  assert(slugifyRecordingName('') === '', 'slug: empty');
  assert(slugifyRecordingName('a'.repeat(100)).length === 60, 'slug: capped at 60');

  // ─── isRecordable ──────────────────────────────────────────────
  assert(isRecordable('desktop.launch_app'), 'recordable: desktop.launch_app');
  assert(isRecordable('browser.click_role'), 'recordable: browser.click_role');
  assert(!isRecordable('desktop.read_a11y_tree'), 'recordable: read_a11y_tree excluded (read-only)');
  assert(!isRecordable('desktop.screenshot'), 'recordable: screenshot excluded (verification only)');

  // ─── Start / append / stop flow ─────────────────────────────────
  resetStore();
  {
    const r = startRecording({ name: 'Open Zoom', circleId: 'c1', userId: 'u1' });
    assert(r.ok, 'start: happy path');
    const active = getActiveSession()!;
    assert(active.name === 'open-zoom', 'start: slug assigned');
    assert(active.steps.length === 0, 'start: empty steps');

    // Can't start a second while first is active
    const r2 = startRecording({ name: 'another', circleId: 'c1', userId: 'u1' });
    assert(!r2.ok && /already active/.test((r2 as any).error), 'start: rejects while active');
  }

  // Append steps
  appendStep(buildStep({
    tool: 'desktop.launch_app',
    input: { appName: 'zoom.us' },
    result: { ok: true, data: { appName: 'zoom.us' } },
  }));
  appendStep(buildStep({
    tool: 'desktop.click_element',
    input: { pid: 1234, path: '0.0.1.0.10' },
    result: { ok: true, data: { method: 'ax_press' } },
    a11yTarget: { role: 'AXMenuItem', label: 'Join meeting...', app: 'zoom.us' },
  }));
  appendStep(buildStep({
    tool: 'desktop.type_text',
    input: { text: 'hello' },
    result: { ok: true, data: { chars: 5 } },
  }));

  {
    const active = getActiveSession()!;
    assert(active.steps.length === 3, 'append: 3 steps captured');
    const click = active.steps[1];
    assert(click.outcome.target?.label === 'Join meeting...', 'append: semantic target captured');
    assert(click.outcome.summary?.includes('Join meeting'), 'append: summary uses label not path');
    const type = active.steps[2];
    assert(type.outcome.summary === 'Typed 5 chars', 'append: type summary has char count');
  }

  // Stop saves
  {
    const r = stopRecording({ description: 'Open Zoom + join a meeting' });
    assert(r.ok, 'stop: saves the recording');
    assert((r as any).recording.steps.length === 3, 'stop: 3 steps persisted');
    assert(!getActiveSession(), 'stop: active session cleared');
  }

  // ─── List / get / delete ────────────────────────────────────────
  {
    const rows = listRecordings({ circleId: 'c1' });
    assert(rows.length === 1, 'list: 1 recording saved');
    assert(rows[0].name === 'open-zoom', 'list: correct name');

    // Filter by wrong circle — empty
    assert(listRecordings({ circleId: 'other' }).length === 0, 'list: circle filter works');

    const r = getRecording('Open Zoom');
    assert(!!r, 'get: accepts pretty name (slug lookup)');
    assert(r!.description.startsWith('Open Zoom'), 'get: description persisted');

    // Delete
    assert(deleteRecording('open-zoom'), 'delete: removes recording');
    assert(listRecordings({ circleId: 'c1' }).length === 0, 'delete: list now empty');
    assert(!deleteRecording('nope'), 'delete: unknown name returns false');
  }

  // ─── Stop with no steps discards ────────────────────────────────
  resetStore();
  startRecording({ name: 'empty', circleId: 'c1', userId: 'u1' });
  {
    const r = stopRecording();
    assert(!r.ok, 'stop: zero-step recording rejected');
    assert(!getActiveSession(), 'stop: session cleared even when discarded');
  }

  // ─── Abort discards ─────────────────────────────────────────────
  startRecording({ name: 'abort-me', circleId: 'c1', userId: 'u1' });
  appendStep(buildStep({ tool: 'desktop.launch_app', input: { appName: 'X' }, result: { ok: true } }));
  {
    const r = abortRecording();
    assert(r.ok && r.discardedSteps === 1, 'abort: discarded 1 step');
    assert(!getActiveSession(), 'abort: session cleared');
  }

  // ─── Failed steps excluded from replay plan ────────────────────
  resetStore();
  startRecording({ name: 'flaky', circleId: 'c1', userId: 'u1' });
  appendStep(buildStep({ tool: 'desktop.launch_app', input: { appName: 'X' }, result: { ok: true } }));
  appendStep(buildStep({ tool: 'desktop.type_text', input: { text: 'hi' }, result: { ok: false, error: 'bridge offline' } }));
  appendStep(buildStep({ tool: 'desktop.press_keys', input: { combo: 'Return' }, result: { ok: true } }));
  stopRecording({ description: 'flaky' });
  {
    const r = getRecording('flaky')!;
    const plan = planReplay(r);
    assert(plan.length === 2, 'plan: drops failed step');
    assert(plan[0].tool === 'desktop.launch_app', 'plan: first step');
    assert(plan[1].tool === 'desktop.press_keys', 'plan: skipped failed, kept next');
  }

  // ─── click_element: semantic override via _target ──────────────
  {
    const step = buildStep({
      tool: 'desktop.click_element',
      input: { pid: 1234, path: '0.0.1.0.10' },
      result: { ok: true },
      a11yTarget: { role: 'AXMenuItem', label: 'Join meeting', app: 'zoom.us' },
    });
    const plan = planReplayStep(step);
    assert(plan.tool === 'desktop.click_element', 'plan: click_element kept');
    assert((plan.input as any)._target.label === 'Join meeting', 'plan: target carried');
    assert(plan.note?.includes('Join meeting'), 'plan: note mentions label');
  }

  // ─── findInTree ─────────────────────────────────────────────────
  const treeText = [
    '[0] AXApplication "Safari"',
    '  [0.0] AXWindow "Apple"',
    '    [0.0.0] AXButton "Back"',
    '    [0.0.1] AXTextField "Search" = "apple"',
    '    [0.0.2] AXButton "Tabs"',
  ].join('\n');
  assert(findInTree(treeText, 'Back', 'AXButton').path === '0.0.0', 'findInTree: exact match');
  assert(findInTree(treeText, 'back').path === '0.0.0', 'findInTree: case-insensitive');
  assert(findInTree(treeText, 'tab').path === '0.0.2', 'findInTree: substring match');
  assert(findInTree(treeText, 'nope').path === undefined, 'findInTree: miss returns empty');
  // Role filter — button query skips the textfield that would otherwise match "Search"
  assert(findInTree(treeText, 'Search', 'AXButton').path === undefined, 'findInTree: role filter excludes wrong role');
  assert(findInTree(treeText, 'Search', 'AXTextField').path === '0.0.1', 'findInTree: role filter narrows correctly');

  // ─── 200-step cap ──────────────────────────────────────────────
  resetStore();
  startRecording({ name: 'long', circleId: 'c1', userId: 'u1' });
  for (let i = 0; i < 250; i += 1) {
    appendStep(buildStep({ tool: 'desktop.type_text', input: { text: 'x' }, result: { ok: true } }));
  }
  assert(getActiveSession()!.steps.length === 200, 'append: caps at 200 steps');

  // ─── formatElapsedSec ──────────────────────────────────────────
  assert(formatElapsedSec(0) === '0s', 'elapsed: zero');
  assert(formatElapsedSec(1) === '1s', 'elapsed: 1s');
  assert(formatElapsedSec(59) === '59s', 'elapsed: 59s boundary');
  assert(formatElapsedSec(60) === '1m 0s', 'elapsed: 60 → 1m 0s');
  assert(formatElapsedSec(61) === '1m 1s', 'elapsed: 61 → 1m 1s');
  assert(formatElapsedSec(3599) === '59m 59s', 'elapsed: just under 1h');
  assert(formatElapsedSec(3600) === '1h 0m', 'elapsed: exactly 1h');
  assert(formatElapsedSec(3660) === '1h 1m', 'elapsed: 1h 1m');
  assert(formatElapsedSec(7322) === '2h 2m', 'elapsed: 2h 2m (seconds dropped at h scale)');
  // Safety: non-finite / negative → clamped to 0
  assert(formatElapsedSec(-5) === '0s', 'elapsed: negative clamped to 0');
  assert(formatElapsedSec(Number.NaN) === '0s', 'elapsed: NaN clamped to 0');
  assert(formatElapsedSec(Infinity) === '0s', 'elapsed: Infinity clamped to 0');
  // Fractional seconds floor correctly
  assert(formatElapsedSec(12.9) === '12s', 'elapsed: fractional floored');

  if (failures > 0) {
    console.error(`\n${failures} chat-recording smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll chat-recording smoke cases passed.');
}

main();
