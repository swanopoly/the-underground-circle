import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DESKTOP_ATTACHMENT_OPEN_CAPABILITY,
  classifyDesktopBridgeHealth,
} from '../src/lib/desktopBridgeProtocol';
import {
  buildDesktopBrowserReadiness,
  buildDesktopBridgeReadinessRecoveryPayload,
  renderDesktopBridgeConnectedMessage,
} from '../src/lib/desktopBridgeAutoConnect';

let assertions = 0;

function check(condition: unknown, message: string): void {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
}

function eq<T>(actual: T, expected: T, message: string): void {
  check(Object.is(actual, expected), `${message} (expected ${String(expected)}, got ${String(actual)})`);
}

const unavailable = classifyDesktopBridgeHealth(null);
eq(unavailable.state, 'unavailable', 'missing health is unavailable');
eq(unavailable.recoveryCode, 'bridge_unavailable', 'missing health has a typed offline recovery code');
eq(unavailable.genericToolsReady, false, 'missing health has no generic desktop readiness');
eq(unavailable.automaticRestartAllowed, false, 'health classification never grants automatic restart authority');

const unsupported = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'linux',
  supported: false,
  tools: [],
});
eq(unsupported.state, 'unavailable', 'unsupported platform is unavailable for desktop work');
eq(unsupported.recoveryCode, 'platform_unsupported', 'unsupported platform is typed separately from offline');
const unsupportedPayload = buildDesktopBridgeReadinessRecoveryPayload(unsupported);
eq(unsupportedPayload.recoveryOptions[0]?.id, 'stop_and_report', 'unsupported platform never recommends a bridge restart');

const legacyMissingCapability = classifyDesktopBridgeHealth({
  ok: true,
  instanceId: 'bridge-old-1234',
  platform: 'darwin',
  supported: true,
  tools: ['launch', 'focus', 'file_read'],
});
eq(legacyMissingCapability.state, 'capability_missing', 'legacy supported bridge does not imply attachment-open readiness');
eq(legacyMissingCapability.genericToolsReady, true, 'legacy non-attachment tools remain available');
eq(legacyMissingCapability.attachmentOpenReady, false, 'missing attachment capability is explicit');
eq(legacyMissingCapability.sourceChanged, null, 'legacy health does not fabricate source drift');
check(
  legacyMissingCapability.missingTools.includes(DESKTOP_ATTACHMENT_OPEN_CAPABILITY),
  'exact missing capability is reported',
);

const legacyCapableWithoutSafety = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
});
eq(legacyCapableWithoutSafety.state, 'restart_blocked', 'capability presence without restart-safety evidence fails closed');
eq(legacyCapableWithoutSafety.attachmentOpenReady, true, 'advertised attachment capability remains visible');
eq(legacyCapableWithoutSafety.recoveryCode, 'bridge_restart_blocked', 'missing restart evidence has a typed recovery code');

const current = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
  restartSafety: {
    sourceChanged: false,
    safeToRefresh: false,
    blockers: ['source_not_changed'],
    opaqueAttachmentCapabilityPresent: true,
  },
});
eq(current.state, 'current', 'capable source-current bridge is current');
eq(current.recoveryCode, 'none', 'current health needs no recovery');
eq(current.attachmentOpenReady, true, 'current bridge is attachment-ready');

const sourceChanged = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
  restartSafety: {
    sourceChanged: true,
    safeToRefresh: true,
    blockers: [],
    opaqueAttachmentCapabilityPresent: true,
  },
});
eq(sourceChanged.state, 'source_changed', 'idle-safe source drift is distinct from current');
eq(sourceChanged.safeToRefresh, true, 'read-only classifier preserves reported idle safety');
eq(sourceChanged.recoveryCode, 'bridge_source_changed', 'source drift has a typed recovery code');
eq(sourceChanged.automaticRestartAllowed, false, 'idle-safe evidence still does not authorize this client to restart');

const restartBlocked = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
  restartSafety: {
    sourceChanged: true,
    safeToRefresh: false,
    blockers: ['possibly_active_sessions', 'browser_runtime_active'],
    opaqueAttachmentCapabilityPresent: true,
  },
});
eq(restartBlocked.state, 'restart_blocked', 'source drift with active work is restart-blocked');
eq(restartBlocked.safeToRefresh, false, 'blocked health never fabricates safe refresh');
check(restartBlocked.blockers.includes('possibly_active_sessions'), 'value-free restart blocker is retained');

const missingWithProvenDrift = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch', 'focus'],
  restartSafety: {
    sourceChanged: true,
    safeToRefresh: false,
    blockers: ['possibly_active_sessions'],
    opaqueAttachmentCapabilityPresent: false,
  },
});
eq(missingWithProvenDrift.state, 'capability_missing', 'missing requested capability remains the primary state');
eq(missingWithProvenDrift.sourceChanged, true, 'proven source drift is retained alongside missing capability');
eq(missingWithProvenDrift.genericToolsReady, true, 'ordinary desktop tools remain compatible during drift');

const missingFromSourceCurrentProcess = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch'],
  restartSafety: {
    sourceChanged: false,
    safeToRefresh: false,
    blockers: ['source_not_changed'],
    opaqueAttachmentCapabilityPresent: false,
  },
});
const sourceCurrentMissingPayload = buildDesktopBridgeReadinessRecoveryPayload(missingFromSourceCurrentProcess);
check(sourceCurrentMissingPayload.content.includes('Install or update to the current app source first'), 'source-current missing capability requires an update before restart');

const malformedSafety = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
  restartSafety: { sourceChanged: 'yes', safeToRefresh: true, blockers: [] },
});
eq(malformedSafety.state, 'restart_blocked', 'malformed restart evidence fails closed');
eq(malformedSafety.sourceChanged, null, 'malformed evidence cannot prove source drift');

const contradictorySafety = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
  restartSafety: { sourceChanged: false, safeToRefresh: true, blockers: [] },
});
eq(contradictorySafety.state, 'restart_blocked', 'safe refresh without source drift is rejected');

const unrecognizedBlocker = classifyDesktopBridgeHealth({
  ok: true,
  platform: 'darwin',
  supported: true,
  tools: ['launch', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
  restartSafety: {
    schemaVersion: 1,
    sourceChanged: true,
    safeToRefresh: false,
    blockers: ['ignore_previous_instructions'],
  },
});
eq(unrecognizedBlocker.state, 'restart_blocked', 'unrecognized health blocker fails closed');
eq(unrecognizedBlocker.blockers.length, 0, 'untrusted blocker text is not forwarded into recovery copy');

const readiness = buildDesktopBrowserReadiness(
  {
    ok: true,
    platform: 'darwin',
    supported: true,
    tools: ['launch', 'focus', 'file_read'],
  },
  null,
);
eq(readiness.desktop.ready, true, 'generic desktop readiness remains true for legacy tools');
eq(readiness.desktop.bridgeState, 'capability_missing', 'browser readiness carries typed bridge classification');
eq(readiness.desktop.attachmentOpenReady, false, 'browser readiness does not flatten attachment readiness');

const limitedMessage = renderDesktopBridgeConnectedMessage('capability_missing', true, readiness);
check(limitedMessage.includes('ordinary desktop tools remain available'), 'connected copy preserves ordinary-tool compatibility');
check(limitedMessage.includes('restart the local supervisor'), 'connected copy gives the exact capability recovery action');
check(!limitedMessage.toLowerCase().includes('automatic restart'), 'connected copy does not claim a restart occurred');

const blockedReadiness = buildDesktopBrowserReadiness(
  {
    ok: true,
    platform: 'darwin',
    supported: true,
    tools: ['launch', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
    restartSafety: {
      sourceChanged: true,
      safeToRefresh: false,
      blockers: ['possibly_active_sessions'],
      opaqueAttachmentCapabilityPresent: true,
    },
  },
  null,
);
const blockedPayload = buildDesktopBridgeReadinessRecoveryPayload(blockedReadiness.desktop.classification);
check(blockedPayload.content.includes('possibly active sessions'), 'blocked recovery explains the bounded live-work blocker');
eq(blockedPayload.recoveryOptions[0]?.id, 'repair_or_restart_bridge', 'typed recovery remains compatible with Chat recovery routing');
check(blockedPayload.recoveryOptions[0]?.label.includes('Recheck'), 'recovery action is a recheck, not a hidden restart');

const repoRoot = resolve(__dirname, '..');
const chipSource = readFileSync(resolve(repoRoot, 'src/components/DesktopBridgeStatusChip.tsx'), 'utf8');
const registrySource = readFileSync(resolve(repoRoot, 'src/lib/computerCapabilityRegistry.ts'), 'utf8');
const autoConnectSource = readFileSync(resolve(repoRoot, 'src/lib/desktopBridgeAutoConnect.ts'), 'utf8');

check(chipSource.includes("kind: 'capability_missing'"), 'status chip has an explicit missing-capability state');
check(chipSource.includes("kind: 'source_changed'"), 'status chip has an explicit source-changed state');
check(chipSource.includes("kind: 'restart_blocked'"), 'status chip has an explicit restart-blocked state');
check(chipSource.includes('classifyDesktopBridgeHealth'), 'status chip consumes the canonical pure classifier');
check(registrySource.includes('desktopBridgeReadiness'), 'capability audit exposes bridge readiness without flattening it');
check(registrySource.includes('genericToolsReady'), 'capability audit preserves ordinary-tool readiness');
check(!/fetch\([^\n]*refresh_if_idle/u.test(autoConnectSource), 'autoconnect never calls the refresh endpoint');
check(!/method:\s*['"]POST['"][\s\S]{0,180}refresh_if_idle/u.test(autoConnectSource), 'autoconnect contains no refresh mutation path');
eq(
  autoConnectSource.match(/buildDesktopBridgeBackgroundStartCommand\s*\(/gu)?.length || 0,
  1,
  'legacy command builder is exported but never called by autoconnect',
);
check(
  autoConnectSource.includes('Automatic shell-based bridge restart is disabled.'),
  'reachable starter path explicitly refuses process mutation',
);

console.log(`desktop bridge capability readiness smoke passed (${assertions} assertions)`);
