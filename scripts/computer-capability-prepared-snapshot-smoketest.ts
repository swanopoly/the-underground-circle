/**
 * Focused task-start capability evidence smoke.
 *
 * Run directly (package script intentionally not required):
 *   npx tsx scripts/computer-capability-prepared-snapshot-smoketest.ts
 */

import assert from 'node:assert/strict';
import {
  COMPUTER_CAPABILITY_PREPARED_SNAPSHOT_MAX_AGE_MS,
  buildComputerCapabilityPreparedSnapshot,
  normalizeComputerCapabilityPreparedSnapshot,
  resolveComputerBrowserCapabilityStatuses,
  shouldProbeDesktopBridgeForCapabilityAudit,
} from '../src/lib/computerTaskCapabilitySnapshot';
import { DESKTOP_ATTACHMENT_OPEN_CAPABILITY } from '../src/lib/desktopBridgeProtocol';

const NOW_MS = Date.parse('2026-08-14T16:00:00.000Z');
const INSTANCE_ID = 'bridge-current-1234';

function currentDesktopHealth(instanceId = INSTANCE_ID) {
  return {
    ok: true,
    platform: 'darwin',
    supported: true,
    instanceId,
    tools: ['launch', 'focus', 'file_read', DESKTOP_ATTACHMENT_OPEN_CAPABILITY],
    restartSafety: {
      sourceChanged: false,
      safeToRefresh: false,
      blockers: ['source_not_changed'],
      opaqueAttachmentCapabilityPresent: true,
    },
  };
}

const localPlaywright = buildComputerCapabilityPreparedSnapshot({
  observedAt: new Date(NOW_MS).toISOString(),
  desktopHealth: currentDesktopHealth(),
  localBrowserReadiness: { ready: true, contextOpen: false },
  expectedBridgeInstanceId: INSTANCE_ID,
}, { nowMs: NOW_MS });

assert.equal(localPlaywright.status, 'accepted', 'fresh task-start evidence is accepted');
if (localPlaywright.status !== 'accepted') throw new Error('unreachable: accepted snapshot expected');
assert.equal(localPlaywright.bridgeInstanceId, INSTANCE_ID, 'snapshot binds the exact bridge process');
assert.equal(localPlaywright.desktopBridgeReadiness.state, 'current', 'prepared current desktop health is preserved');
assert.equal(localPlaywright.desktopBridgeReadiness.genericToolsReady, true, 'prepared desktop tools remain ready');
assert.equal(localPlaywright.localBrowser.ready, true, 'verified local Playwright readiness is preserved');
assert.equal(Object.isFrozen(localPlaywright), true, 'snapshot is immutable');
assert.equal(Object.isFrozen(localPlaywright.localBrowser), true, 'nested browser readiness is immutable');
assert.equal(Object.isFrozen(localPlaywright.desktopBridgeReadiness), true, 'desktop classification is immutable');

assert.deepEqual(resolveComputerBrowserCapabilityStatuses({
  remoteAutomationReady: false,
  remoteSessionsReady: false,
  localBrowserReady: localPlaywright.localBrowser.ready,
  localBrowserContextOpen: localPlaywright.localBrowser.contextOpen,
}), {
  browserAutomation: 'ready',
  browserSessions: 'partial',
}, 'healthy local Playwright provides automation without requiring Browserbase');

assert.deepEqual(resolveComputerBrowserCapabilityStatuses({
  remoteAutomationReady: false,
  remoteSessionsReady: false,
  localBrowserReady: true,
  localBrowserContextOpen: true,
}), {
  browserAutomation: 'ready',
  browserSessions: 'ready',
}, 'an active verified local context provides session readiness');

const staleAtBuild = buildComputerCapabilityPreparedSnapshot({
  observedAt: new Date(NOW_MS - COMPUTER_CAPABILITY_PREPARED_SNAPSHOT_MAX_AGE_MS - 1).toISOString(),
  desktopHealth: currentDesktopHealth(),
  localBrowserReadiness: { ready: true, contextOpen: false },
  expectedBridgeInstanceId: INSTANCE_ID,
}, { nowMs: NOW_MS });
assert.equal(staleAtBuild.status, 'rejected', 'stale evidence is rejected at construction');
assert.equal(
  staleAtBuild.status === 'rejected' ? staleAtBuild.rejectionCode : null,
  'snapshot_stale',
  'stale rejection is typed',
);

const staleAtUse = normalizeComputerCapabilityPreparedSnapshot(localPlaywright, {
  nowMs: NOW_MS + COMPUTER_CAPABILITY_PREPARED_SNAPSHOT_MAX_AGE_MS + 1,
  expectedBridgeInstanceId: INSTANCE_ID,
});
assert.equal(staleAtUse.status, 'rejected', 'an accepted snapshot is rechecked for freshness at use time');
assert.equal(
  staleAtUse.status === 'rejected' ? staleAtUse.rejectionCode : null,
  'snapshot_stale',
  'use-time staleness remains typed',
);

const driftAtBuild = buildComputerCapabilityPreparedSnapshot({
  observedAt: new Date(NOW_MS).toISOString(),
  desktopHealth: currentDesktopHealth('bridge-old-123456'),
  localBrowserReadiness: { ready: true, contextOpen: true },
  expectedBridgeInstanceId: 'bridge-new-123456',
}, { nowMs: NOW_MS });
assert.equal(driftAtBuild.status, 'rejected', 'instance drift is rejected at construction');
assert.equal(
  driftAtBuild.status === 'rejected' ? driftAtBuild.rejectionCode : null,
  'bridge_instance_drift',
  'construction drift rejection is typed',
);

const driftAtUse = normalizeComputerCapabilityPreparedSnapshot(localPlaywright, {
  nowMs: NOW_MS,
  expectedBridgeInstanceId: 'bridge-restarted-5678',
});
assert.equal(driftAtUse.status, 'rejected', 'bridge restart invalidates a prepared snapshot');
assert.equal(
  driftAtUse.status === 'rejected' ? driftAtUse.rejectionCode : null,
  'bridge_instance_drift',
  'use-time drift rejection is typed',
);

const unboundBrowser = buildComputerCapabilityPreparedSnapshot({
  observedAt: new Date(NOW_MS).toISOString(),
  desktopHealth: { ...currentDesktopHealth(), instanceId: undefined },
  localBrowserReadiness: { ready: true, contextOpen: false },
}, { nowMs: NOW_MS });
assert.equal(unboundBrowser.status, 'rejected', 'ready local browser evidence cannot omit process identity');
assert.equal(
  unboundBrowser.status === 'rejected' ? unboundBrowser.rejectionCode : null,
  'bridge_instance_missing',
  'unbound local readiness fails with a stable code',
);

const cloned = normalizeComputerCapabilityPreparedSnapshot(
  JSON.parse(JSON.stringify(localPlaywright)),
  { nowMs: NOW_MS, expectedBridgeInstanceId: INSTANCE_ID },
);
assert.equal(cloned.status, 'rejected', 'a copied object cannot gain prepared-evidence authority');
assert.equal(
  cloned.status === 'rejected' ? cloned.rejectionCode : null,
  'invalid_snapshot',
  'unissued snapshot rejection is typed',
);

assert.equal(shouldProbeDesktopBridgeForCapabilityAudit({}), true, 'legacy audit callers keep the bounded desktop probe');
assert.equal(
  shouldProbeDesktopBridgeForCapabilityAudit({ preparedSnapshot: localPlaywright }),
  false,
  'accepted prepared evidence suppresses a second desktop probe',
);
assert.equal(
  shouldProbeDesktopBridgeForCapabilityAudit({ preparedSnapshot: staleAtBuild }),
  false,
  'rejected prepared evidence fails closed instead of silently re-probing',
);

console.log('computer-capability-prepared-snapshot-smoketest: passed');
