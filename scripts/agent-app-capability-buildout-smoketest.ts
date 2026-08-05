/**
 * agent-app-capability-buildout-smoketest
 *
 * Verifies that unfamiliar app-control gaps can become bounded connected-agent
 * buildout tasks instead of dead-ending in generic chat.
 *
 * Run: npm run smoke:agent-app-capability-buildout
 */

import {
  buildAgentAppCapabilityGapSummary,
  buildAgentAppCapabilityBuildoutStateHints,
  buildAgentAppCapabilityBuildoutPolicy,
  buildAgentAppCapabilityRetryPrompt,
  classifyAgentAppCapabilityBuildout,
  formatAgentAppCapabilityBuildoutForUser,
  inferAppNameForCapabilityBuildout,
  parseAgentAppCapabilityBuildoutResult,
  parseAgentAppCapabilityBuildoutResultFromSession,
  shouldRequestAgentAppCapabilityBuildoutFromOutcome,
} from '../src/lib/agentAppCapabilityBuildout';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

const unknownAppTask = 'Use Ableton Live to create a four-bar drum loop and export it after approval';
const appName = inferAppNameForCapabilityBuildout(unknownAppTask);
assert(appName === 'Ableton Live', 'buildout infers unfamiliar target app name', `saw ${appName}`);

const adapterPolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: unknownAppTask,
  capabilityGap: 'No app adapter or local desktop recipe exists for Ableton Live arrangement export.',
  desiredOutcome: 'Chat can launch Ableton, inspect the UI, create a safe recipe, and export only after approval.',
  currentPlanSummary: 'Computer app strategy selected universal_app_control.',
});
assert(adapterPolicy.kind === 'desktop_adapter', 'adapter gap classifies as desktop adapter buildout', adapterPolicy.kind);
assert(adapterPolicy.appName === 'Ableton Live', 'policy carries inferred target app', adapterPolicy.appName);
assert(adapterPolicy.prompt.includes('Original user task'), 'policy prompt includes original task');
assert(adapterPolicy.prompt.includes('Do not use credentials, bypass CAPTCHA/MFA'), 'policy prompt includes safety guardrails');
assert(adapterPolicy.prompt.includes('Capability ladder'), 'policy prompt includes capability ladder');
assert(adapterPolicy.capabilityLadder.some((item) => item.includes('structured app/vendor APIs')), 'policy prefers deterministic app APIs before UI automation');
assert(adapterPolicy.prompt.includes('Official-source research checklist'), 'policy prompt includes official-source research checklist');
assert(adapterPolicy.researchChecklist.some((item) => item.includes('official vendor, OS, or framework documentation')), 'policy requires official docs before broad examples');
assert(adapterPolicy.prompt.includes('FILES_CHANGED'), 'policy prompt requires file-change output contract');
assert(adapterPolicy.prompt.includes('APP_CAPABILITY_RESULT_JSON'), 'policy prompt requires parseable JSON result contract');
assert(
  adapterPolicy.prompt.includes('You are a connected coding agent')
    && !adapterPolicy.prompt.includes('You are Codex attached'),
  'buildout prompt is provider-neutral for Codex and Claude Code',
);
assert(adapterPolicy.prompt.includes('APP_CAPABILITY_CONTROL_SURFACE'), 'policy prompt requires control-surface output contract');
assert(adapterPolicy.prompt.includes('APP_CAPABILITY_SOURCE_REFS'), 'policy prompt requires source-ref output contract');
assert(adapterPolicy.prompt.includes('controlSurface, sourceRefs'), 'policy JSON contract carries research evidence keys');
assert(adapterPolicy.prompt.includes('=== AGENT DEVELOPMENT STANDARDS ==='), 'policy prompt carries agent development standards block');
assert(adapterPolicy.prompt.includes('docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md'), 'policy prompt carries TypeScript app standards');
assert(adapterPolicy.verification.some((item) => item.includes('smoke test')), 'policy requires focused smoke coverage');

const photoshopPolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: 'Open this Photoshop PSD, use Firefly to generate four background options, place the selected one, and export a PNG proof.',
  appName: 'Adobe Photoshop',
  capabilityGap: 'Need the Firefly generated asset bridge and Photoshop placement receipt.',
});
assert(photoshopPolicy.prompt.includes('Design App Creative AI Recipes'), 'Photoshop buildout prompt carries creative-AI recipes');
assert(photoshopPolicy.researchChecklist.some((item) => item.includes('desktop.firefly_generate_image_asset')), 'Photoshop buildout checklist names recipe buildout tool');
assert(photoshopPolicy.verification.some((item) => item.includes('creative-AI recipe')), 'Photoshop buildout verification requires creative-AI proof');

const bridgeKind = classifyAgentAppCapabilityBuildout({
  task: 'Control SuperRender app and click Render Queue',
  capabilityGap: 'Need a desktop bridge tool for the render queue accessibility control.',
});
assert(bridgeKind === 'bridge_tool', 'bridge/a11y gap classifies as bridge tool buildout', bridgeKind);

const pipelinePolicy = buildAgentAppCapabilityBuildoutPolicy({
  task: 'When SwanBot does not know the app, build the missing pipeline.',
  appName: 'Unknown App',
  capabilityGap: 'Need planner routing and grounding for unknown app tasks.',
});
assert(pipelinePolicy.kind === 'pipeline_strategy', 'routing gap classifies as pipeline strategy buildout', pipelinePolicy.kind);
assert(pipelinePolicy.prompt.includes('agent.build_app_capability') === false, 'connected-agent prompt stays task-focused, not tool-recursive');

assert(
  shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'universal_app_control',
    agentResponse: '',
  }),
  'empty unknown-app agent response requests connected-agent buildout',
);
assert(
  shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'universal_app_control',
    agentResponse: 'I cannot continue because no app adapter or recipe exists yet.',
  }),
  'missing app adapter response requests connected-agent buildout',
);
assert(
  !shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'universal_app_control',
    agentResponse: 'I verified the app state and completed the requested export.',
  }),
  'successful unknown-app response does not request buildout',
);
assert(
  !shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'desktop_semantic',
    agentResponse: '',
  }),
  'known app strategy does not request connected buildout',
);

// Phase 3 — broadened buildout: specific app/desktop/browser strategies now
// escalate to a built capability when they hit a clear gap, so the chat can
// fulfil a request even if that exact adapter isn't configured yet.
assert(
  shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'creative_layout_control',
    agentResponse: 'I cannot complete this — no app adapter exists for that action yet.',
  }),
  'specific app strategy + capability-gap response now requests buildout',
);
assert(
  shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'ops_console_control',
    errorMessage: 'bridge tool not found for this action',
  }),
  'specific app strategy + runtime error requests buildout',
);
assert(
  shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'browser_semantic',
    appAdapterMessage: 'No connected app surfaces are available for this circle yet — missing an app adapter or bridge tool to drive this app.',
  }),
  'adapter dead-end message routes a browser/app request to buildout (loop closed)',
);
assert(
  !shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'creative_layout_control',
    agentResponse: 'Done — exported the layout to brochure.pdf as requested.',
  }),
  'specific app strategy + clean success does NOT request buildout',
);
assert(
  !shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'desktop_readonly',
    errorMessage: 'some error',
  }),
  'read-only strategy never requests buildout (nothing to build)',
);
// A SPECIFIC strategy that succeeded but hedged ("couldn't use the API, did it
// via the UI — done") must NOT spuriously trigger a buildout — only an explicit
// gap signal does. (Loose hedges are trusted only for universal_app_control.)
assert(
  !shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'productivity_app_control',
    agentResponse: 'I cannot use the official API directly, so I completed it via the UI — exported successfully.',
  }),
  'specific strategy + successful-but-hedging prose does NOT trigger buildout',
);
assert(
  shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: 'universal_app_control',
    agentResponse: 'I cannot use this app to continue.',
  }),
  'universal_app_control still escalates on a loose hedge (generic last resort)',
);

const gapSummary = buildAgentAppCapabilityGapSummary({
  strategyId: 'universal_app_control',
  previewLabel: 'App task',
  previewKind: 'app_task',
  appAdapterMessage: 'Bridge launched Ableton Live.',
  errorMessage: 'Agent follow-up timed out.',
  warnings: ['Connected-agent buildout fallback'],
});
assert(gapSummary.includes('universal_app_control'), 'buildout gap summary names universal strategy');
assert(gapSummary.includes('Agent follow-up timed out'), 'buildout gap summary includes runtime failure');

const approvalHints = buildAgentAppCapabilityBuildoutStateHints({
  status: 'approval_required',
  retryPlan: 'Retry the Ableton task after approval.',
});
assert(approvalHints.phase === 'awaiting_capability_approval', 'state hints: approval maps to capability approval phase');
assert(approvalHints.suppressGenericRecovery, 'state hints: approval suppresses duplicate generic recovery');
assert(approvalHints.nextSteps.some((step) => step.includes('Approve')), 'state hints: approval names approval next step');

const requestedHints = buildAgentAppCapabilityBuildoutStateHints({
  status: 'requested',
});
assert(requestedHints.phase === 'building_capability', 'state hints: requested maps to building capability phase');
assert(requestedHints.suppressGenericRecovery, 'state hints: requested suppresses duplicate generic recovery');

const failedHints = buildAgentAppCapabilityBuildoutStateHints({
  status: 'failed',
  message: 'No managed Codex session is available.',
});
assert(failedHints.phase === 'blocked', 'state hints: failed maps to blocked phase');
assert(!failedHints.suppressGenericRecovery, 'state hints: failed allows generic recovery fallback');
assert(failedHints.blockers.some((blocker) => blocker.includes('No managed Codex')), 'state hints: failed keeps blocker text');

const readyResult = parseAgentAppCapabilityBuildoutResult(`
APP_CAPABILITY_SUMMARY: Added a generic Ableton Live app recipe and planner smoke.
APP_CAPABILITY_CONTROL_SURFACE: Ableton Live menu/keyboard recipe grounded by macOS accessibility state.
APP_CAPABILITY_SOURCE_REFS:
- Ableton Live manual: keyboard shortcuts
- src/lib/computerAppTaskStrategy.ts
FILES_CHANGED:
- src/lib/computerAppTaskStrategy.ts
- scripts/computer-app-task-strategy-smoketest.ts
RETRY_PLAN: Retry "Use Ableton Live to create a four-bar drum loop and export it after approval".
VERIFICATION: npm run smoke:computer-app-task-strategy passed; npm run typecheck:app passed.
USER_ACTION_NEEDED: none
`);
assert(readyResult.status === 'ready_to_retry', 'parser: verified contract is ready to retry', readyResult.status);
assert(readyResult.controlSurface?.includes('accessibility'), 'parser: control surface parsed');
assert(readyResult.sourceRefs.length === 2, 'parser: source refs parsed');
assert(readyResult.filesChanged.length === 2, 'parser: files changed list parsed');
assert(readyResult.retryPlan?.includes('Ableton Live'), 'parser: retry plan parsed');

const blockedResult = parseAgentAppCapabilityBuildoutResult(`
APP_CAPABILITY_SUMMARY: Could not inspect Ableton because the app is not installed.
FILES_CHANGED: none
RETRY_PLAN: Retry after installing Ableton Live and granting Accessibility.
VERIFICATION: not run - target app missing.
USER_ACTION_NEEDED: Install Ableton Live and grant macOS Accessibility permission.
`);
assert(blockedResult.status === 'blocked', 'parser: user-action result is blocked', blockedResult.status);
assert(blockedResult.blockers.some((blocker) => blocker.includes('Install Ableton')), 'parser: blocked result carries user action');

const jsonResult = parseAgentAppCapabilityBuildoutResult(`
APP_CAPABILITY_RESULT_JSON:
{
  "summary": "Added SuperRender a11y bridge mapping.",
  "controlSurface": "macOS Accessibility AX action exposed through desktop bridge",
  "sourceRefs": [
    {"label": "Apple Accessibility", "url": "https://developer.apple.com/accessibility/"},
    "src/lib/computerAppGrounding.ts"
  ],
  "filesChanged": ["src/lib/localComputerAwarenessIntent.ts"],
  "retryPlan": "Retry the SuperRender queue click.",
  "verification": "smoke passed",
  "userActionNeeded": "none"
}
`);
assert(jsonResult.status === 'ready_to_retry', 'parser: JSON result contract is ready to retry', jsonResult.status);
assert(jsonResult.controlSurface?.includes('Accessibility'), 'parser: JSON control surface parsed');
assert(jsonResult.sourceRefs.some((item) => item.includes('Apple Accessibility')), 'parser: JSON source refs parsed');
assert(jsonResult.filesChanged[0] === 'src/lib/localComputerAwarenessIntent.ts', 'parser: JSON files changed parsed');

const sessionResult = parseAgentAppCapabilityBuildoutResultFromSession({
  sessionId: 'codex-launch-test-1',
  recentActions: ['App capability result: ready_to_retry'],
  appCapabilityResultText: `
APP_CAPABILITY_SUMMARY: Added a reusable SuperRender app-control route.
APP_CAPABILITY_CONTROL_SURFACE: SuperRender documented CLI export command with accessibility fallback for queue selection.
APP_CAPABILITY_SOURCE_REFS:
- SuperRender official CLI docs: https://example.com/superrender/cli
- src/lib/computerAppGrounding.ts
FILES_CHANGED: src/lib/computerAppGrounding.ts
RETRY_PLAN: Retry the SuperRender render queue task.
VERIFICATION: smoke passed.
USER_ACTION_NEEDED: none
`,
});
assert(sessionResult?.status === 'ready_to_retry', 'parser: session capability result is ready to retry', sessionResult?.status);

const claudeSessionResult = parseAgentAppCapabilityBuildoutResultFromSession({
  sessionId: 'claude-launch-test-1',
  appCapabilityResultText: `
APP_CAPABILITY_SUMMARY: Added a reusable SuperRender control recipe.
APP_CAPABILITY_CONTROL_SURFACE: documented SuperRender CLI with accessibility verification.
APP_CAPABILITY_SOURCE_REFS:
- SuperRender official CLI docs: https://example.com/superrender/cli
- src/lib/computerAppGrounding.ts
FILES_CHANGED:
- src/lib/computerAppGrounding.ts
RETRY_PLAN: Retry the SuperRender queue task from chat.
VERIFICATION: focused smoke passed.
USER_ACTION_NEEDED: none
`,
});
assert(
  claudeSessionResult?.status === 'ready_to_retry',
  'parser: Claude dedicated capability receipt is ready to retry',
  claudeSessionResult?.status,
);

const incompleteResult = parseAgentAppCapabilityBuildoutResult(`
APP_CAPABILITY_SUMMARY: Added an app recipe but did not include source refs.
APP_CAPABILITY_CONTROL_SURFACE: menu and accessibility recipe
FILES_CHANGED: none
RETRY_PLAN: Retry after recipe review.
VERIFICATION: smoke passed.
USER_ACTION_NEEDED: none
`);
assert(incompleteResult.status === 'incomplete', 'parser: missing source refs keeps buildout incomplete', incompleteResult.status);
assert(incompleteResult.missingEvidence.some((item) => item.includes('source refs')), 'parser: incomplete result names missing source refs');

const readyHints = buildAgentAppCapabilityBuildoutStateHints({
  status: readyResult.status,
  retryPlan: readyResult.retryPlan,
});
assert(readyHints.phase === 'completed', 'state hints: ready-to-retry maps to completed phase');
assert(readyHints.suppressGenericRecovery, 'state hints: ready-to-retry suppresses generic recovery');

const retryPrompt = buildAgentAppCapabilityRetryPrompt({
  task: unknownAppTask,
  appName: 'Ableton Live',
  summary: readyResult.summary,
  controlSurface: readyResult.controlSurface,
  sourceRefs: readyResult.sourceRefs,
  filesChanged: readyResult.filesChanged,
  retryPlan: readyResult.retryPlan,
  verification: readyResult.verification,
  appAdapterMessage: 'Bridge already launched the target app.',
  dispatchPrefix: 'Use desktop tools.',
});
assert(retryPrompt.includes('CONNECTED APP CAPABILITY BUILDOUT READY'), 'retry prompt names ready buildout state');
assert(
  retryPrompt.includes('connected coding agent') && !retryPrompt.includes('connected Codex agent'),
  'retry prompt is provider-neutral',
);
assert(retryPrompt.includes('Do not call agent.build_app_capability again'), 'retry prompt prevents recursive buildout');
assert(retryPrompt.includes('Re-observe app/window/a11y/screenshot state'), 'retry prompt requires fresh observation before mutation');
assert(retryPrompt.includes('Chosen control surface'), 'retry prompt carries chosen control surface');
assert(retryPrompt.includes('Ableton Live manual'), 'retry prompt carries source refs');
assert(retryPrompt.includes('src/lib/computerAppTaskStrategy.ts'), 'retry prompt carries changed capability files');
assert(retryPrompt.includes(unknownAppTask), 'retry prompt carries original user task');

const blockedHints = buildAgentAppCapabilityBuildoutStateHints({
  status: blockedResult.status,
  message: blockedResult.summary,
  retryPlan: blockedResult.retryPlan,
  userActionNeeded: blockedResult.userActionNeeded,
});
assert(blockedHints.phase === 'blocked', 'state hints: parsed blocker maps to blocked phase');
assert(blockedHints.blockers.some((blocker) => blocker.includes('Accessibility')), 'state hints: parsed blocker keeps user action');

const incompleteHints = buildAgentAppCapabilityBuildoutStateHints({
  status: incompleteResult.status,
  message: incompleteResult.summary,
  retryPlan: incompleteResult.retryPlan,
  missingEvidence: incompleteResult.missingEvidence,
});
assert(incompleteHints.phase === 'blocked', 'state hints: incomplete result blocks auto retry');
assert(incompleteHints.blockers.some((blocker) => blocker.includes('source refs')), 'state hints: incomplete result names missing evidence');

const approvalUserSummary = formatAgentAppCapabilityBuildoutForUser({
  status: 'approval_required',
  appName: 'Ableton Live',
  approvalId: 'approval_internal_123456',
  message: 'Connected agents checked: Codex | Claude. Sent Codex app capability buildout task to session_internal_abcdef.',
});
assert(approvalUserSummary.includes('App support needs approval'), 'user summary: approval asks for review');
assert(!approvalUserSummary.includes('approval_internal_123456'), 'user summary: approval hides approval id');
assert(!approvalUserSummary.includes('Connected agents checked'), 'user summary: approval hides roster internals');

const requestedUserSummary = formatAgentAppCapabilityBuildoutForUser({
  status: 'requested',
  appName: 'SuperRender',
  sessionId: 'session_internal_abcdef',
});
assert(requestedUserSummary.includes('App support is being built'), 'user summary: requested names build state');
assert(!requestedUserSummary.includes('session_internal_abcdef'), 'user summary: requested hides session id');

const readyRunningUserSummary = formatAgentAppCapabilityBuildoutForUser({
  status: 'ready_to_retry',
  appName: 'Ableton Live',
  autoRetryStatus: 'running',
  retryPlan: 'Retry the Ableton task.',
});
assert(readyRunningUserSummary.includes('Retrying now'), 'user summary: ready running says retrying');

const readyCompletedUserSummary = formatAgentAppCapabilityBuildoutForUser({
  status: 'ready_to_retry',
  appName: 'Ableton Live',
  autoRetryStatus: 'completed',
});
assert(readyCompletedUserSummary === '', 'user summary: completed auto-retry stays quiet');

const blockedUserSummary = formatAgentAppCapabilityBuildoutForUser({
  status: 'blocked',
  appName: 'Ableton Live',
  userActionNeeded: 'Install Ableton Live and grant macOS Accessibility permission.',
  retryPlan: 'Retry after install.',
  message: 'APP_CAPABILITY_RESULT_JSON: {"sessionId":"session_internal_abcdef"}',
});
assert(blockedUserSummary.includes('Needs attention'), 'user summary: blocked uses needs-attention heading');
assert(blockedUserSummary.includes('Install Ableton Live'), 'user summary: blocked keeps user action');
assert(!blockedUserSummary.includes('APP_CAPABILITY_RESULT_JSON'), 'user summary: blocked hides result contract internals');

const incompleteUserSummary = formatAgentAppCapabilityBuildoutForUser({
  status: 'incomplete',
  appName: 'SuperRender',
  summary: incompleteResult.summary,
  retryPlan: incompleteResult.retryPlan,
  missingEvidence: incompleteResult.missingEvidence,
});
assert(incompleteUserSummary.includes('Needs attention'), 'user summary: incomplete uses needs-attention heading');
assert(incompleteUserSummary.includes('source refs'), 'user summary: incomplete names missing evidence');

if (failures > 0) {
  console.error(`\n${failures} agent app capability buildout smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll agent app capability buildout smoke cases passed.');
