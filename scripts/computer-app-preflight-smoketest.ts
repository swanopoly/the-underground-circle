/**
 * computer-app-preflight-smoketest — verifies strategy-level readiness
 * before browser/desktop/app automation reaches the model.
 *
 * Run: npx tsx scripts/computer-app-preflight-smoketest.ts
 */

import {
  buildComputerAppPreflight,
  buildComputerAppPreflightPromptBlock,
} from '../src/lib/computerAppPreflight';
import type {
  ComputerCapabilityAudit,
  ComputerCapabilityFinding,
  ComputerCapabilityId,
  ComputerCapabilityStatus,
} from '../src/lib/computerCapabilityRegistry';
import { isAgentBridgeCapabilityReady } from '../src/lib/computerCapabilityReadiness';
import { setAppResolutionContext } from '../src/lib/chatComputerRequestRouter';

const CAPABILITY_IDS: ComputerCapabilityId[] = [
  'browser_automation',
  'browser_sessions',
  'file_search',
  'file_read',
  'file_write',
  'app_tools',
  'agent_bridges',
  'desktop_control',
];

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }

function audit(overrides: Partial<Record<ComputerCapabilityId, ComputerCapabilityStatus>>): ComputerCapabilityAudit {
  const findings: ComputerCapabilityFinding[] = CAPABILITY_IDS.map((id) => {
    const status = overrides[id] || 'missing';
    return {
      id,
      label: id,
      status,
      detail: `${id} ${status}`,
      sources: status === 'missing' ? [] : ['smoke-test'],
    };
  });
  return {
    findings,
    missing: findings.filter((finding) => finding.status === 'missing').map((finding) => finding.id),
    availableIntegrationProviders: [],
    availableIntegrationCapabilities: [],
    activeBridgeProviders: [],
    activeMcpServerCount: 0,
    activeMcpToolCount: 0,
  };
}

function assertPreflight(input: string, expected: {
  strategy: string;
  status: 'ready' | 'partial' | 'blocked' | 'unknown';
  required?: ComputerCapabilityId[];
  hasBlocker?: string;
  hasWarning?: string;
  routeStatus?: string | null;
  expansionLane?: string;
  expansionVerify?: string;
}) {
  const preflight = buildComputerAppPreflight({
    task: input,
    audit: expected.status === 'unknown'
      ? null
      : audit({
          browser_automation: 'ready',
          browser_sessions: 'ready',
          file_search: 'ready',
          file_read: 'ready',
          file_write: 'ready',
          app_tools: 'ready',
          agent_bridges: 'ready',
          desktop_control: 'ready',
        }),
  });
  if (preflight.strategy?.id !== expected.strategy) {
    fail(`${input} expected strategy ${expected.strategy}, got ${preflight.strategy?.id || 'none'}`);
    return;
  }
  if (preflight.status !== expected.status) {
    fail(`${input} expected status ${expected.status}, got ${preflight.status}: ${preflight.summary}`);
    return;
  }
  for (const capability of expected.required || []) {
    if (!preflight.requiredCapabilities.includes(capability)) {
      fail(`${input} expected required capability ${capability}`);
      return;
    }
  }
  if (expected.hasBlocker && !preflight.blockers.some((item) => item.id.includes(expected.hasBlocker) || item.label.includes(expected.hasBlocker))) {
    fail(`${input} expected blocker matching ${expected.hasBlocker}`);
    return;
  }
  if (expected.hasWarning && !preflight.warnings.some((item) => item.id.includes(expected.hasWarning) || item.label.includes(expected.hasWarning))) {
    fail(`${input} expected warning matching ${expected.hasWarning}`);
    return;
  }
  if (expected.routeStatus !== undefined && (preflight.routeDecision?.status || null) !== expected.routeStatus) {
    fail(`${input} expected route decision ${expected.routeStatus}, got ${preflight.routeDecision?.status || 'none'}`);
    return;
  }
  if (expected.expansionLane && !preflight.capabilityExpansionPlan?.lanes.some((lane) => lane.id === expected.expansionLane)) {
    fail(`${input} expected expansion lane ${expected.expansionLane}`);
    return;
  }
  if (expected.expansionVerify && !preflight.capabilityExpansionPlan?.verificationCommands.includes(expected.expansionVerify)) {
    fail(`${input} expected expansion verification command ${expected.expansionVerify}`);
    return;
  }
  pass(`${expected.strategy}/${expected.status}: ${input}`);
}

function assertMissingCapability(input: string, missingCapability: ComputerCapabilityId) {
  const preflight = buildComputerAppPreflight({
    task: input,
    audit: audit({
      browser_automation: 'ready',
      browser_sessions: 'ready',
      file_search: 'ready',
      file_read: 'ready',
      file_write: 'ready',
      app_tools: 'ready',
      agent_bridges: 'ready',
      desktop_control: 'ready',
      [missingCapability]: 'missing',
    }),
  });
  if (preflight.status !== 'blocked') {
    fail(`${input} expected blocked when ${missingCapability} is missing, got ${preflight.status}`);
    return;
  }
  if (!preflight.blockers.some((item) => item.id === `missing:${missingCapability}`)) {
    fail(`${input} missing ${missingCapability} did not create a capability blocker`);
    return;
  }
  if (preflight.fixActions.length === 0) {
    fail(`${input} missing ${missingCapability} did not create fix actions`);
    return;
  }
  pass(`blocked missing ${missingCapability}: ${input}`);
}

assertPreflight('Tell me all the tabs I have open in Chrome right now', {
  strategy: 'desktop_readonly',
  status: 'ready',
  required: ['desktop_control'],
});

assertMissingCapability('Tell me all the tabs I have open in Chrome right now', 'desktop_control');
assertMissingCapability('Login to WordPress with my saved vault credentials and draft a post', 'browser_sessions');

assertPreflight('Open Figma and crop this image after I approve desktop control', {
  strategy: 'desktop_canvas_vision',
  status: 'partial',
  required: ['desktop_control', 'app_tools'],
  hasWarning: 'canvas:screenshot-before-click',
});

assertPreflight('Open Photoshop and crop this PSD after I approve desktop control', {
  strategy: 'creative_layout_control',
  status: 'partial',
  required: ['desktop_control', 'app_tools', 'file_search', 'file_read', 'file_write'],
  hasWarning: 'photoshop:document-inventory-required',
  routeStatus: 'needs_observation',
  expansionLane: 'app_native_adapter',
  expansionVerify: 'npm run smoke:app-automation-control-surfaces',
});

const blankDocumentPreflight = buildComputerAppPreflight({
  task: 'Open Photoshop and start a new project 600 x 600',
  audit: audit({
    desktop_control: 'ready',
    app_tools: 'ready',
  }),
});
const blankDocumentPreflightPrompt = buildComputerAppPreflightPromptBlock(blankDocumentPreflight) || '';
if (blankDocumentPreflight.status !== 'ready') {
  fail(`blank Photoshop document expected ready preflight, got ${blankDocumentPreflight.status}: ${blankDocumentPreflight.summary}`);
} else if (blankDocumentPreflight.requiredCapabilities.join(',') !== 'desktop_control,app_tools') {
  fail(`blank Photoshop document expected only desktop_control,app_tools; got ${blankDocumentPreflight.requiredCapabilities.join(',')}`);
} else if (blankDocumentPreflight.routeDecision !== null || blankDocumentPreflight.capabilityExpansionPlan !== null) {
  fail('blank Photoshop document should not enter generic route-decision or capability-expansion planning');
} else if (blankDocumentPreflight.warnings.length > 0 || blankDocumentPreflight.blockers.length > 0) {
  fail(`blank Photoshop document should have no generic warnings/blockers: ${blankDocumentPreflight.warnings.map((item) => item.id).join(',')}`);
} else if (
  /Research-backed control surface order required|document inventory required|destructive edit approval|required source|file_search|file_stat|layer_inventory/i.test(blankDocumentPreflightPrompt)
) {
  fail('blank Photoshop document preflight leaked generic file/layer/destructive planning');
} else if (!blankDocumentPreflightPrompt.includes('Exact Photoshop blank-document program selected')) {
  fail('blank Photoshop document preflight did not name exact-program ownership');
} else if (!blankDocumentPreflightPrompt.includes('directly requested unsaved blank-document program')) {
  fail('blank Photoshop document preflight did not preserve direct-request authority');
} else if (/canonical tool approval|per-tool approval remains required/i.test(blankDocumentPreflightPrompt)) {
  fail('blank Photoshop document preflight invented a second tool-level approval');
} else {
  pass('blank Photoshop document preflight is exact-program-owned and ready');
}

assertMissingCapability('Open Photoshop and start a new project 600 x 600', 'app_tools');

assertPreflight('Open this InDesign file and make changes for a marketing banner with different layers', {
  strategy: 'creative_layout_control',
  status: 'partial',
  required: ['desktop_control', 'app_tools', 'file_search', 'file_read', 'file_write'],
  hasWarning: 'indesign:document-inventory-required',
  routeStatus: 'needs_observation',
  expansionLane: 'app_native_adapter',
  expansionVerify: 'npm run smoke:design-app-execution-pipeline',
});

assertPreflight('Open AutoCAD and create a 2D floor plan with two rooms and dimensions', {
  strategy: 'engineering_cad_control',
  status: 'partial',
  required: ['desktop_control', 'app_tools', 'file_search', 'file_write'],
  hasWarning: 'engineering:precision-checkpoint',
  routeStatus: 'needs_observation',
  expansionLane: 'app_native_adapter',
  expansionVerify: 'npm run smoke:engineering-cad-operation-runbooks',
});

assertPreflight('Open MATLAB and build a Simulink model, run the simulation, and export plots after approval', {
  strategy: 'engineering_cad_control',
  status: 'partial',
  required: ['desktop_control', 'app_tools', 'file_search', 'file_write'],
  hasWarning: 'engineering:precision-checkpoint',
  routeStatus: 'needs_observation',
  expansionLane: 'app_native_adapter',
  expansionVerify: 'npm run smoke:engineering-cad-operation-runbooks',
});

assertPreflight('Use Ableton Live to create a four-bar drum loop and export it after approval', {
  strategy: 'universal_app_control',
  status: 'partial',
  required: ['desktop_control', 'app_tools', 'agent_bridges'],
  hasWarning: 'universal-app:connected-agent-buildout',
  routeStatus: 'needs_observation',
  expansionLane: 'connected_agent_buildout',
  expansionVerify: 'npm run smoke:agent-app-capability-buildout',
});

assertPreflight('The website is showing a Cloudflare human verification screen', {
  strategy: 'human_verification_pause',
  status: 'blocked',
  required: ['browser_automation'],
  hasBlocker: 'verification:human-pause',
});

assertPreflight('Summarize unread emails and prioritize Slack alerts', {
  strategy: 'productivity_app_control',
  status: 'partial',
  required: ['desktop_control', 'app_tools'],
  hasWarning: 'desktop:focus-before-type',
});

assertPreflight('Book a flight to New York next Friday under $500', {
  strategy: 'approval_sensitive_browser',
  status: 'partial',
  required: ['browser_automation', 'browser_sessions'],
  hasWarning: 'browser:approval-before-side-effect',
  routeStatus: 'needs_observation',
  expansionLane: 'browser_semantic_actionability',
  expansionVerify: 'npm run smoke:browser-bridge',
});

assertPreflight('Check AWS logs and rollback the failed deploy after approval', {
  strategy: 'ops_console_control',
  status: 'partial',
  required: ['browser_automation', 'agent_bridges'],
  hasWarning: 'ops:read-first',
});

assertPreflight('Extract the signed date and renewal clause from this contract PDF', {
  strategy: 'document_data_workbench',
  status: 'partial',
  required: ['file_search', 'file_read', 'app_tools'],
  hasWarning: 'document:dry-run-before-write',
});

assertPreflight('Have the attached Codex agent download whatever assets it needs to finish the website task', {
  strategy: 'agent_asset_acquisition',
  status: 'partial',
  required: ['agent_bridges', 'file_search', 'file_read', 'file_write'],
  hasWarning: 'agent-acquire:verify-before-use',
});

assertMissingCapability('Have the attached Codex agent download whatever assets it needs to finish the website task', 'agent_bridges');

for (const [request, expectedTarget] of [
  ['Open Photoshop', 'Adobe Photoshop'],
  ['Open Image Capture', 'Image Capture'],
  ['Open Docker Desktop', 'Docker Desktop'],
  ['Open Microsoft Remote Desktop', 'Microsoft Remote Desktop'],
] as const) {
  const readPreflight = buildComputerAppPreflight({
    task: request,
    audit: audit({ desktop_control: 'ready' }),
  });
  const noisyText = [
    ...readPreflight.warnings.map((item) => `${item.label} ${item.detail} ${item.fix}`),
    ...readPreflight.blockers.map((item) => `${item.label} ${item.detail} ${item.fix}`),
  ].join(' | ');
  if (
    readPreflight.status !== 'ready'
    || readPreflight.requiredCapabilities.join(',') !== 'desktop_control'
    || readPreflight.capabilityExpansionPlan
    || readPreflight.appCapabilityBuildout
    || readPreflight.routeDecision?.targetName !== expectedTarget
    || readPreflight.routeDecision?.taskFamily !== 'app launch/read observation'
    || /file|mutation|research|buildout/i.test(noisyText)
  ) {
    fail(`${request} should preflight as a clean launch/read route (${JSON.stringify({ status: readPreflight.status, capabilities: readPreflight.requiredCapabilities, target: readPreflight.routeDecision?.targetName, taskFamily: readPreflight.routeDecision?.taskFamily, warnings: readPreflight.warnings.map((item) => item.id), blockers: readPreflight.blockers.map((item) => item.id) })})`);
  } else {
    pass(`clean approval-free launch/read preflight: ${request}`);
  }
}

for (const request of [
  'Open Photoshop',
  'Launch Photoshop',
  'Start Photoshop',
  'Focus Photoshop',
  'Activate Photoshop',
  'Switch to Photoshop',
  'Switch over to Photoshop',
  'Bring Photoshop to the front',
  'Bring Photoshop forward',
  'Bring forward Photoshop',
  'Can you open Photoshop?',
  'Could you launch Photoshop?',
  'Would you open Photoshop?',
  'Can you please open Photoshop?',
  'Open Photoshop please',
  'Open up Photoshop',
  'Open settings',
  'Open Chrome',
  'Launch Firefox',
]) {
  const lifecyclePreflight = buildComputerAppPreflight({
    task: request,
    audit: audit({ desktop_control: 'ready', app_tools: 'missing' }),
  });
  if (
    lifecyclePreflight.status !== 'ready'
    || lifecyclePreflight.requiredCapabilities.join(',') !== 'desktop_control'
    || lifecyclePreflight.blockers.some((item) => item.id === 'missing:app_tools')
  ) {
    fail(`strict lifecycle grammar/preflight drifted for ${request}: ${JSON.stringify({
      status: lifecyclePreflight.status,
      capabilities: lifecyclePreflight.requiredCapabilities,
      blockers: lifecyclePreflight.blockers.map((item) => item.id),
    })}`);
  } else {
    pass(`strict lifecycle preflight needs desktop_control only: ${request}`);
  }
}

setAppResolutionContext({
  bridgeOnline: true,
  installedApps: ['Houdini.app'],
  runningApps: ['Acme Studio'],
});
for (const [request, expectedTarget] of [
  ['open houdini', 'Houdini'],
  ['open acme studio', 'Acme Studio'],
] as const) {
  const observedLowercasePreflight = buildComputerAppPreflight({
    task: request,
    audit: audit({ desktop_control: 'ready', app_tools: 'missing' }),
  });
  if (
    observedLowercasePreflight.status !== 'ready'
    || observedLowercasePreflight.requiredCapabilities.join(',') !== 'desktop_control'
    || observedLowercasePreflight.routeDecision?.targetName !== expectedTarget
    || observedLowercasePreflight.routeDecision?.taskFamily !== 'app launch/read observation'
  ) {
    fail(`observed lowercase lifecycle/preflight parity drifted for ${request}: ${JSON.stringify({
      strategy: observedLowercasePreflight.strategy?.id,
      status: observedLowercasePreflight.status,
      capabilities: observedLowercasePreflight.requiredCapabilities,
      routeDecision: observedLowercasePreflight.routeDecision,
    })}`);
  } else pass(`observed lowercase lifecycle preflight needs desktop_control only: ${request}`);
}
setAppResolutionContext({ bridgeOnline: true, installedApps: ['Maya'] });
const unavailableLowercasePreflight = buildComputerAppPreflight({
  task: 'open houdini',
  audit: audit({ desktop_control: 'ready' }),
});
if (
  unavailableLowercasePreflight.status === 'ready'
  || unavailableLowercasePreflight.requiredCapabilities.join(',') === 'desktop_control'
  || !unavailableLowercasePreflight.requiredCapabilities.includes('app_tools')
) {
  fail(`unavailable lowercase app must not acquire approval-free lifecycle preflight authority (${JSON.stringify({
    strategy: unavailableLowercasePreflight.strategy?.id,
    status: unavailableLowercasePreflight.status,
    capabilities: unavailableLowercasePreflight.requiredCapabilities,
  })})`);
} else pass('unavailable lowercase app stays out of approval-free lifecycle preflight');
setAppResolutionContext({ bridgeOnline: false });

const photoshopPreflight = buildComputerAppPreflight({
  task: 'Open Photoshop and save the desktop screenshot as lmao.png',
  audit: audit({
    browser_automation: 'ready',
    browser_sessions: 'ready',
    file_search: 'ready',
    file_read: 'ready',
    file_write: 'partial',
    app_tools: 'ready',
    agent_bridges: 'missing',
    desktop_control: 'ready',
  }),
});
const photoshopPrompt = buildComputerAppPreflightPromptBlock(photoshopPreflight) || '';
if (
  !photoshopPrompt.includes('Capability expansion lanes') ||
  !photoshopPrompt.includes('app_native_adapter') ||
  !photoshopPrompt.includes('npm run smoke:app-automation-control-surfaces')
) {
  fail('Photoshop preflight prompt did not include capability expansion plan');
} else {
  pass('Photoshop preflight prompt includes capability expansion plan');
}

// ── Research-first app capability buildout attached up front (P3.4 ↔ preflight) ─
const abletonBuildout = buildComputerAppPreflight({
  task: 'Use Ableton Live to create a four-bar drum loop and export it after approval',
  audit: audit({
    browser_automation: 'ready', browser_sessions: 'ready',
    file_search: 'ready', file_read: 'ready', file_write: 'ready',
    app_tools: 'missing', agent_bridges: 'ready', desktop_control: 'missing',
  }),
});
if (!abletonBuildout.appCapabilityBuildout) {
  fail('Ableton preflight did not attach research-first app capability buildout');
} else {
  const b = abletonBuildout.appCapabilityBuildout;
  if (!/ableton/i.test(b.appName)) fail(`buildout appName should be Ableton, got ${b.appName}`);
  else if (!b.proposedTool.startsWith('desktop.')) fail('buildout should propose a desktop adapter tool');
  else if (!b.findLadder.length) fail('buildout should carry the universal find ladder');
  else if (!b.researchPlan.length) fail('buildout should carry the research plan');
  else if (!b.buildoutTask.toLowerCase().includes('research')) fail('buildout task should be research-first');
  else pass('unfamiliar-app preflight attaches research-first capability buildout');
}
const abletonBuildoutPrompt = buildComputerAppPreflightPromptBlock(abletonBuildout) || '';
if (
  !abletonBuildoutPrompt.includes('App capability buildout (research-first)') ||
  !abletonBuildoutPrompt.includes('Research before guessing') ||
  abletonBuildoutPrompt.includes('/Users/')
) {
  fail('Ableton buildout prompt missing research-first block or leaked a local path');
} else {
  pass('preflight prompt surfaces the research-first buildout block');
}

// Adobe keeps its richer design path — the generic buildout is NOT attached.
const photoshopNoGeneric = buildComputerAppPreflight({
  task: 'Open Photoshop and crop this PSD after I approve desktop control',
  audit: audit({ app_tools: 'missing', desktop_control: 'missing' }),
});
if (photoshopNoGeneric.appCapabilityBuildout) {
  fail('Adobe task should not attach the generic app capability buildout');
} else {
  pass('Adobe task uses the design path, not the generic buildout');
}

// Ready, familiar capabilities → no buildout noise.
const readyNoBuildout = buildComputerAppPreflight({
  task: 'Tell me all the tabs I have open in Chrome right now',
  audit: audit({ desktop_control: 'ready', app_tools: 'ready' }),
});
if (readyNoBuildout.appCapabilityBuildout) {
  fail('ready capabilities should not attach a buildout');
} else {
  pass('ready capabilities attach no buildout');
}

// ─── agent_bridges readiness: a live bridge satisfies it (no phantom block) ──
// Regression guard for "create a Notes note → Agent bridges missing" while the
// local bridge was demonstrably alive: a live health probe means the agent
// bridge (claude-bridge.js on :7778) is reachable, even with zero persisted
// connection records.
if (isAgentBridgeCapabilityReady({ enabledConnectionCount: 0, bridgeAlive: true })) {
  pass('agent_bridges: a live local bridge satisfies the capability with no persisted connections');
} else {
  fail('agent_bridges: a live local bridge should satisfy the capability');
}
if (isAgentBridgeCapabilityReady({ enabledConnectionCount: 2, bridgeAlive: false })) {
  pass('agent_bridges: enabled persisted connections satisfy the capability');
} else {
  fail('agent_bridges: enabled connections should satisfy the capability');
}
if (!isAgentBridgeCapabilityReady({ enabledConnectionCount: 0, bridgeAlive: false })) {
  pass('agent_bridges: no connections AND no live bridge → genuinely missing');
} else {
  fail('agent_bridges: with neither source it must read missing');
}

if (failures > 0) {
  console.error(`\n${failures} computer/app preflight smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer/app preflight smoke cases passed.');
