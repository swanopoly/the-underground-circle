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
import {
  executeRecordingCommand,
  findInTree,
} from '../src/lib/recordingChatCommands';
// eslint-disable-next-line import/first
import {
  collectChatSessionArchiveRecoveryReliabilityTouched,
  deriveChatSessionArchiveRecoveryRecommendations,
  summarizeChatSessionArchiveRecoveryReliability,
} from '../src/lib/chatSessionArchiveRecovery';
// eslint-disable-next-line import/first
import {
  formatChatSessionArchiveRecommendationPromptLines,
} from '../src/lib/chatSessionArchivePrompt';

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

async function main() {
  const scope = { circleId: 'c1', userId: 'u1' } as const;
  // ─── Slug ───────────────────────────────────────────────────────
  assert(slugifyRecordingName('Open Zoom') === 'open-zoom', 'slug: words');
  assert(slugifyRecordingName('  Close the deal!  ') === 'close-the-deal', 'slug: trim + strip !');
  assert(slugifyRecordingName('foo__bar---baz') === 'foo-bar-baz', 'slug: collapse separators');
  assert(slugifyRecordingName('') === '', 'slug: empty');
  assert(slugifyRecordingName('a'.repeat(100)).length === 60, 'slug: capped at 60');

  // ─── isRecordable ──────────────────────────────────────────────
  assert(isRecordable('desktop.launch_app'), 'recordable: desktop.launch_app');
  assert(isRecordable('desktop.set_element_value'), 'recordable: desktop.set_element_value');
  assert(isRecordable('browser.click_role'), 'recordable: browser.click_role');
  assert(!isRecordable('desktop.read_a11y_tree'), 'recordable: read_a11y_tree excluded (read-only)');
  assert(!isRecordable('desktop.screenshot'), 'recordable: screenshot excluded (verification only)');

  // ─── Start / append / stop flow ─────────────────────────────────
  resetStore();
  {
    const r = startRecording({ name: 'Open Zoom', circleId: 'c1', userId: 'u1' });
    assert(r.ok, 'start: happy path');
    const active = getActiveSession(scope)!;
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
  }), scope);
  appendStep(buildStep({
    tool: 'desktop.click_element',
    input: { pid: 1234, path: '0.0.1.0.10' },
    result: { ok: true, data: { method: 'ax_press' } },
    a11yTarget: { role: 'AXMenuItem', label: 'Join meeting...', app: 'zoom.us' },
  }), scope);
  appendStep(buildStep({
    tool: 'desktop.type_text',
    input: { text: 'hello' },
    result: { ok: true, data: { chars: 5 } },
  }), scope);

  {
    const active = getActiveSession(scope)!;
    assert(active.steps.length === 3, 'append: 3 steps captured');
    const click = active.steps[1];
    assert(click.outcome.target?.label === 'Join meeting...', 'append: semantic target captured');
    assert(click.outcome.summary?.includes('Join meeting'), 'append: summary uses label not path');
    const type = active.steps[2];
    assert(type.outcome.summary === 'Typed 5 chars', 'append: type summary has char count');
  }

  // Stop saves
  {
    const r = stopRecording({ ...scope, description: 'Open Zoom + join a meeting' });
    assert(r.ok, 'stop: saves the recording');
    assert((r as any).recording.steps.length === 3, 'stop: 3 steps persisted');
    assert(!getActiveSession(scope), 'stop: active session cleared');
  }

  // ─── List / get / delete ────────────────────────────────────────
  {
    const rows = listRecordings(scope);
    assert(rows.length === 1, 'list: 1 recording saved');
    assert(rows[0].name === 'open-zoom', 'list: correct name');

    // Filter by wrong circle — empty
    assert(listRecordings({ ...scope, circleId: 'other' }).length === 0, 'list: circle filter works');

    const r = getRecording('Open Zoom', scope);
    assert(!!r, 'get: accepts pretty name (slug lookup)');
    assert(r!.description.startsWith('Open Zoom'), 'get: description persisted');

    // Delete
    assert(deleteRecording('open-zoom', scope), 'delete: removes recording');
    assert(listRecordings(scope).length === 0, 'delete: list now empty');
    assert(!deleteRecording('nope', scope), 'delete: unknown name returns false');
  }

  // ─── Stop with no steps discards ────────────────────────────────
  resetStore();
  startRecording({ name: 'empty', circleId: 'c1', userId: 'u1' });
  {
    const r = stopRecording(scope);
    assert(!r.ok, 'stop: zero-step recording rejected');
    assert(!getActiveSession(scope), 'stop: session cleared even when discarded');
  }

  // ─── Abort discards ─────────────────────────────────────────────
  startRecording({ name: 'abort-me', circleId: 'c1', userId: 'u1' });
  appendStep(buildStep({ tool: 'desktop.launch_app', input: { appName: 'X' }, result: { ok: true } }), scope);
  {
    const r = abortRecording(scope);
    assert(r.ok && r.discardedSteps === 1, 'abort: discarded 1 step');
    assert(!getActiveSession(scope), 'abort: session cleared');
  }

  // ─── Failed steps excluded from replay plan ────────────────────
  resetStore();
  startRecording({ name: 'flaky', circleId: 'c1', userId: 'u1' });
  appendStep(buildStep({ tool: 'desktop.launch_app', input: { appName: 'X' }, result: { ok: true } }), scope);
  appendStep(buildStep({ tool: 'desktop.type_text', input: { text: 'hi' }, result: { ok: false, error: 'bridge offline' } }), scope);
  appendStep(buildStep({ tool: 'desktop.press_keys', input: { combo: 'Return' }, result: { ok: true } }), scope);
  stopRecording({ ...scope, description: 'flaky' });
  {
    const r = getRecording('flaky', scope)!;
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

  // ─── set_element_value: semantic override via _target ──────────
  {
    const step = buildStep({
      tool: 'desktop.set_element_value',
      input: { pid: 1234, path: '0.0.1.0.11', text: 'hello@example.com' },
      result: { ok: true },
      a11yTarget: { role: 'AXTextField', label: 'Email', app: 'TextEdit' },
    });
    assert(step.outcome.summary === 'Set "Email" to 17 chars', 'append: set field summary has target + char count');
    const plan = planReplayStep(step);
    assert(plan.tool === 'desktop.set_element_value', 'plan: set_element_value kept');
    assert((plan.input as any)._target.label === 'Email', 'plan: set target carried');
    assert((plan.input as any).text === 'hello@example.com', 'plan: set text carried');
    assert(plan.note?.includes('Email'), 'plan: set note mentions label');
  }

  // ─── /replay complete-plan mutation preflight ──────────────────
  resetStore();
  startRecording({ name: 'mixed replay', circleId: 'c1', userId: 'u1' });
  appendStep(buildStep({
    tool: 'browser.dom_snapshot',
    input: { maxNodes: 50 },
    result: { ok: true },
  }), scope);
  appendStep(buildStep({
    tool: 'browser.fill_field',
    input: { name: 'Draft', text: 'must not run' },
    result: { ok: true },
  }), scope);
  stopRecording({ ...scope, description: 'read then mutate' });
  {
    const fired: Array<{ tool: string; input: Record<string, unknown> }> = [];
    const outcome = await executeRecordingCommand('/replay mixed replay', {
      circleId: 'c1',
      userId: 'u1',
      fireTool: async (call) => {
        fired.push(call);
        return { ok: true };
      },
    });
    assert(fired.length === 0, 'replay preflight: read-then-mutate plan dispatches zero tools');
    assert(
      outcome?.runtimeHandoff?.executable === false
        && outcome.runtimeHandoff.kind === 'openswan_typed_runtime_plan'
        && outcome.runtimeHandoff.reasonCode === 'sealed_runtime_identity_and_approval_required',
      'replay preflight: mixed plan returns a structured non-executable OpenSwan handoff',
    );
    assert(
      outcome?.runtimeHandoff?.blockedTools.includes('browser.fill_field')
        && outcome.runtimeHandoff.totalSteps === 2
        && outcome.runtimeHandoff.blockedStepCount === 1,
      'replay preflight: handoff identifies the blocked mutation without recording arguments',
    );
    const serializedHandoff = JSON.stringify(outcome?.runtimeHandoff || {});
    assert(
      outcome?.runtimeHandoff?.requiredContext.includes('persisted_agent_run_id') === true
        && outcome.runtimeHandoff.requiredContext.includes('provider_tool_use_id')
        && outcome.runtimeHandoff.requiredContext.includes('fresh_observation')
        && outcome.runtimeHandoff.requiredContext.includes('exact_openswan_runtime_approval')
        && !serializedHandoff.includes('must not run')
        && !serializedHandoff.includes('"runId"')
        && !serializedHandoff.includes('"toolUseId"')
        && !serializedHandoff.includes('"approvalId"'),
      'replay preflight: handoff names requirements without copying inputs or fabricating runtime identities',
    );
    assert(
      outcome?.message.includes('fresh authenticated Chat/OpenSwan run')
        && outcome.message.includes('persisted run identity')
        && outcome.message.includes('approve each exact mutating tool call')
        && outcome.message.includes('zero replay steps were executed'),
      'replay preflight: user message names the fresh-run, observation, and exact-approval recovery',
    );
  }

  resetStore();
  startRecording({ name: 'semantic replay', circleId: 'c1', userId: 'u1' });
  appendStep(buildStep({
    tool: 'desktop.click_element',
    input: { pid: 1234, path: '0.0.1' },
    result: { ok: true },
    a11yTarget: { role: 'AXButton', label: 'Continue', app: 'Example' },
  }), scope);
  stopRecording({ ...scope, description: 'semantic mutation' });
  {
    const fired: string[] = [];
    const outcome = await executeRecordingCommand('/replay semantic replay', {
      circleId: 'c1',
      userId: 'u1',
      fireTool: async (call) => {
        fired.push(call.tool);
        return { ok: true };
      },
    });
    assert(
      fired.length === 0,
      'replay preflight: semantic mutation cannot run its a11y re-discovery read',
    );
    assert(
      outcome?.runtimeHandoff?.blockedTools.includes('desktop.click_element') === true,
      'replay preflight: semantic mutation is handed to the typed runtime',
    );
  }

  resetStore();
  startRecording({ name: 'future mutation', circleId: 'c1', userId: 'u1' });
  appendStep(buildStep({
    tool: 'desktop.future_mutation',
    input: { arbitrary: true },
    result: { ok: true },
  }), scope);
  stopRecording({ ...scope, description: 'future unknown desktop mutation' });
  {
    let fireCount = 0;
    const outcome = await executeRecordingCommand('/replay future mutation', {
      circleId: 'c1',
      userId: 'u1',
      fireTool: async () => {
        fireCount += 1;
        return { ok: true };
      },
    });
    assert(
      fireCount === 0
        && outcome?.runtimeHandoff?.blockedTools.includes('desktop.future_mutation') === true,
      'replay preflight: future unknown desktop tools fail closed with zero dispatches',
    );
  }

  resetStore();
  startRecording({ name: 'read only', circleId: 'c1', userId: 'u1' });
  appendStep(buildStep({
    tool: 'desktop.window_state',
    input: {},
    result: { ok: true },
  }), scope);
  appendStep(buildStep({
    tool: 'browser.dom_snapshot',
    input: { maxNodes: 25 },
    result: { ok: true },
  }), scope);
  stopRecording({ ...scope, description: 'observations only' });
  {
    const fired: string[] = [];
    const outcome = await executeRecordingCommand('/replay read only', {
      circleId: 'c1',
      userId: 'u1',
      fireTool: async (call) => {
        fired.push(call.tool);
        return { ok: true };
      },
    });
    assert(
      fired.join(',') === 'desktop.window_state,browser.dom_snapshot',
      'replay preflight: allowlisted read-only observations replay in order',
    );
    assert(
      !outcome?.runtimeHandoff
        && outcome?.message.includes('All 2 steps replayed successfully.'),
      'replay preflight: read-only plan completes without a mutation handoff',
    );
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
    appendStep(buildStep({ tool: 'desktop.type_text', input: { text: 'x' }, result: { ok: true } }), scope);
  }
  assert(getActiveSession(scope)!.steps.length === 200, 'append: caps at 200 steps');

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

  // ─── Session archive recovery reliability ─────────────────────
  {
    const recoveryReliability = {
      surfaceKind: 'desktop_app',
      targetName: 'Universal App Control',
      taskFamily: 'desktop_workflow',
      failureArea: 'fresh_evidence',
      retryAllowed: true,
      userActionRequired: false,
      connectedAgentAllowed: true,
      recommendedOptionId: 'retry_with_fresh_evidence',
      readinessStatus: 'missing',
      nextEvidenceTools: ['desktop.window_state', 'desktop.read_a11y_tree'],
      requiredEvidenceTools: ['desktop.window_state'],
      requiredFreshEvidence: ['active window state'],
      requiredProof: ['post-action screenshot'],
      approvalBoundaries: ['no destructive app changes without approval'],
      failClosedRules: ['stop after repeated stale evidence'],
      routeDecisionStatus: 'route_ready',
      routeDecisionSurface: 'desktop_app',
      selectedRecoveryOptionId: 'retry_with_fresh_evidence',
      verificationCommands: ['npm run smoke:desktop-runtime-wiring'],
    };
    const summaries = summarizeChatSessionArchiveRecoveryReliability(recoveryReliability);
    const touched = collectChatSessionArchiveRecoveryReliabilityTouched(recoveryReliability);
    assert(
      summaries[0]?.includes('Desktop App recovery'),
      'archive: recovery reliability summary stored',
    );
    assert(
      summaries[0]?.includes('desktop.window_state'),
      'archive: recovery reliability summary includes evidence tool',
    );
    assert(
      touched.includes('recovery_surface:desktop_app'),
      'archive: recovery reliability touched surface stored',
    );
    assert(
      touched.includes('recovery_tool:desktop.window_state'),
      'archive: recovery evidence tool touch stored',
    );
    assert(
      touched.includes('recovery_option:retry_with_fresh_evidence'),
      'archive: selected recovery option touch stored',
    );
    const recoveryRecommendations = deriveChatSessionArchiveRecoveryRecommendations({
      threadId: 't1',
      messages: [
        {
          messageId: 'm-recovery-1',
          content: 'Desktop task failed.',
          timestamp: 1,
          recoveryReliabilitySummaries: summaries,
          touched,
        },
        {
          messageId: 'm-recovery-2',
          content: 'Desktop task failed again.',
          timestamp: 2,
          recoveryReliabilitySummaries: summaries,
          touched,
        },
      ],
    });
    assert(
      recoveryRecommendations[0]?.kind === 'recovery_pattern',
      'archive: repeated recovery reliability becomes recommendation',
    );
    assert(
      recoveryRecommendations[0]?.content.includes('desktop.window_state'),
      'archive: recovery recommendation preserves evidence tool',
    );
    assert(
      deriveChatSessionArchiveRecoveryRecommendations({
        threadId: 't1',
        messages: [
          {
            messageId: 'm-recovery-1',
            recoveryReliabilitySummaries: summaries,
            touched,
          },
          {
            messageId: 'm-recovery-2',
            recoveryReliabilitySummaries: summaries,
            touched,
          },
        ],
        handledRecommendationIds: { [recoveryRecommendations[0]?.id || 'missing']: { status: 'dismissed' } },
      }).length === 0,
      'archive: handled recovery recommendation stays hidden',
    );
    const promptLines = formatChatSessionArchiveRecommendationPromptLines(recoveryRecommendations, 1);
    assert(
      promptLines.some((line) => line.includes('Reusable archive patterns')),
      'archive: recovery recommendation prompt section is formatted',
    );
    assert(
      promptLines.some((line) => line.includes('Evidence tools: desktop.window_state')),
      'archive: prompt section prioritizes evidence tools',
    );
    assert(
      promptLines.some((line) => line.includes('Readiness: missing')),
      'archive: prompt section includes readiness state',
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} chat-recording smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll chat-recording smoke cases passed.');
}

main().catch((error) => {
  console.error('chat-recording smoke-test crashed:', error);
  process.exit(1);
});
