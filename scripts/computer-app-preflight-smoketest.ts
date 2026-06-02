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

if (failures > 0) {
  console.error(`\n${failures} computer/app preflight smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll computer/app preflight smoke cases passed.');
