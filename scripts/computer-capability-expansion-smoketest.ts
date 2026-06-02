/**
 * computer-capability-expansion-smoketest
 *
 * Protects the pure capability-expansion planner used to decide what to build
 * next when browser/desktop/app tasks need more automation coverage.
 *
 * Run: npm run smoke:computer-capability-expansion
 */

import {
  buildComputerCapabilityExpansionPlan,
  formatComputerCapabilityExpansionPlan,
  listComputerCapabilityExpansionLanes,
  type ComputerCapabilityExpansionLaneId,
} from '../src/lib/computerCapabilityExpansion';
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

function assert(condition: unknown, label: string, detail?: string): void {
  if (!condition) {
    throw new Error(detail ? `${label}: ${detail}` : label);
  }
  console.log(`pass: ${label}`);
}

function audit(overrides: Partial<Record<ComputerCapabilityId, ComputerCapabilityStatus>> = {}): ComputerCapabilityAudit {
  const findings: ComputerCapabilityFinding[] = CAPABILITY_IDS.map((id) => {
    const status = overrides[id] || 'ready';
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

function laneIdsFor(task: string, overrides?: Partial<Record<ComputerCapabilityId, ComputerCapabilityStatus>>): ComputerCapabilityExpansionLaneId[] {
  return buildComputerCapabilityExpansionPlan(task, audit(overrides)).lanes.map((lane) => lane.id);
}

const lanes = listComputerCapabilityExpansionLanes();
assert(lanes.length >= 6, 'lists all expansion lanes');
assert(lanes.every((lane) => lane.officialSourceRefs.length > 0), 'every lane has source refs');
assert(lanes.every((lane) => lane.smokeCommands.some((command) => command.startsWith('npm run smoke:'))), 'every lane has smoke coverage');

const wordpress = buildComputerCapabilityExpansionPlan('Log into WordPress in the browser and upload a banner image', audit({
  browser_sessions: 'partial',
  file_write: 'missing',
}));
assert(wordpress.lanes.some((lane) => lane.id === 'browser_semantic_actionability'), 'browser task selects semantic actionability lane');
assert(wordpress.lanes.some((lane) => lane.id === 'browser_protocol_runtime'), 'browser task selects protocol inspection lane');
assert(wordpress.lanes.some((lane) => lane.id === 'local_file_contract'), 'upload task selects local file contract lane');
assert(wordpress.partialCapabilities.includes('browser_sessions'), 'partial browser session is surfaced');
assert(wordpress.missingCapabilities.includes('file_write'), 'missing file write is surfaced');
assert(wordpress.verificationCommands.includes('npm run smoke:browser-bridge'), 'browser plan includes browser bridge smoke');
assert(wordpress.verificationCommands.includes('npm run smoke:computer-grant-gate'), 'file plan includes grant gate smoke');

const photoshop = buildComputerCapabilityExpansionPlan('Open Photoshop, edit layers, save as PNG, and replace the existing file', audit({
  app_tools: 'partial',
  agent_bridges: 'missing',
}));
assert(photoshop.lanes.some((lane) => lane.id === 'desktop_semantic_control'), 'Photoshop task selects desktop semantic control lane');
assert(photoshop.lanes.some((lane) => lane.id === 'app_native_adapter'), 'Photoshop task selects app-native adapter lane');
assert(photoshop.lanes.some((lane) => lane.id === 'local_file_contract'), 'Photoshop save task selects local file contract lane');
assert(photoshop.missingCapabilities.includes('agent_bridges'), 'missing agent bridge is surfaced for adapter buildout');
assert(photoshop.partialCapabilities.includes('app_tools'), 'partial app tools are surfaced');
assert(photoshop.verificationCommands.includes('npm run smoke:app-automation-control-surfaces'), 'app-native plan includes app automation smoke');
assert(formatComputerCapabilityExpansionPlan(photoshop).includes('COMPUTER CAPABILITY EXPANSION PLAN'), 'formatter emits prompt block marker');

const unfamiliar = laneIdsFor('Use any unfamiliar app and build whatever adapter is needed to complete the task', {
  desktop_control: 'partial',
  agent_bridges: 'ready',
});
assert(unfamiliar.includes('desktop_semantic_control'), 'unfamiliar app selects desktop semantic lane');
assert(unfamiliar.includes('connected_agent_buildout'), 'unfamiliar app selects connected-agent buildout lane');

const vague = laneIdsFor('take over the app and do the thing');
assert(vague.includes('desktop_semantic_control'), 'vague app task defaults to desktop semantic lane');
assert(vague.includes('connected_agent_buildout'), 'vague app task keeps buildout fallback');

console.log('\nAll computer capability expansion smoke cases passed.');
