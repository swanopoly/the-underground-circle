import assert from 'node:assert/strict';
import {
  buildOfficeBridgeReadinessSnapshot,
  shouldShowOfficeMainBridgeReadinessStrip,
} from '../src/lib/officeBridgeReadiness';
import type { BridgeProbeResult } from '../src/lib/bridgeHealthDiag';

function result(
  name: BridgeProbeResult['name'],
  label: string,
  status: BridgeProbeResult['status'],
  overrides: Partial<BridgeProbeResult> = {},
): BridgeProbeResult {
  return {
    name,
    label,
    port: overrides.port || 7778,
    status,
    detail: overrides.detail || status,
    sessionCount: overrides.sessionCount,
    hint: overrides.hint,
  };
}

const allHealthy = buildOfficeBridgeReadinessSnapshot([
  result('claude-code', 'Claude Code', 'healthy', { sessionCount: 2, port: 7778 }),
  result('codex', 'Codex', 'healthy', { sessionCount: 1, port: 7779 }),
  result('gemini-cli', 'Gemini CLI', 'healthy', { sessionCount: 0, port: 7780 }),
  result('cursor', 'Cursor', 'healthy', { sessionCount: 1, port: 7781 }),
  result('openswan-proxy', 'OpenSwan Proxy', 'healthy', { port: 18790 }),
]);

assert.equal(allHealthy.statusLabel, 'ALL BRIDGES READY', 'healthy fleet has ready label');
assert.equal(allHealthy.tone, 'good', 'healthy fleet uses good tone');
assert.equal(allHealthy.score, 100, 'healthy fleet scores 100');
assert.equal(allHealthy.activeSessions, 4, 'active session count is summed');
assert.equal(allHealthy.summary.includes('5/5 bridges reachable'), true, 'healthy summary includes reachable count');
assert.equal(allHealthy.coreReady, true, 'healthy fleet has OpenSwan core ready');
assert.equal(allHealthy.executionReady, true, 'healthy fleet has an execution bridge ready');
assert.equal(allHealthy.readyForAgentTasks, true, 'healthy fleet can run agent tasks');

const optionalOffline = buildOfficeBridgeReadinessSnapshot([
  result('claude-code', 'Claude Code', 'healthy', { sessionCount: 1, port: 7778 }),
  result('codex', 'Codex', 'healthy', { sessionCount: 1, port: 7779 }),
  result('gemini-cli', 'Gemini CLI', 'offline', { detail: 'connection failed', hint: 'Restart with: node scripts/gemini-bridge.js', port: 7780 }),
  result('cursor', 'Cursor', 'offline', { detail: 'connection failed', hint: 'Restart with: node scripts/cursor-bridge.js', port: 7781 }),
  result('openswan-proxy', 'OpenSwan Proxy', 'healthy', { port: 18790 }),
]);

assert.equal(optionalOffline.statusLabel, 'CORE BRIDGES READY', 'optional bridge outages keep the core path ready');
assert.equal(optionalOffline.tone, 'warn', 'optional bridge outages use warning tone');
assert.equal(optionalOffline.readyForAgentTasks, true, 'core plus one execution bridge is enough to run work');
assert.equal(optionalOffline.optionalIssues.length, 2, 'optional issues are preserved separately');
assert.equal(optionalOffline.requiredIssue, undefined, 'optional outages do not create required issue');
assert.equal(shouldShowOfficeMainBridgeReadinessStrip(optionalOffline), false, 'main Office strip hides optional bridge outages when core task path is ready');

const geminiAuthOnly = buildOfficeBridgeReadinessSnapshot([
  result('claude-code', 'Claude Code', 'healthy', { sessionCount: 1, port: 7778 }),
  result('codex', 'Codex', 'healthy', { port: 7779 }),
  result('gemini-cli', 'Gemini CLI', 'degraded', { detail: 'bridge up but not authenticated (auth=none)', port: 7780 }),
  result('cursor', 'Cursor', 'healthy', { port: 7781 }),
  result('openswan-proxy', 'OpenSwan Proxy', 'healthy', { port: 18790 }),
]);

assert.equal(geminiAuthOnly.statusLabel, 'CORE BRIDGES READY', 'Gemini auth-only issue keeps core bridges ready');
assert.equal(geminiAuthOnly.primaryIssue, 'Gemini CLI: bridge up but not authenticated (auth=none)', 'Gemini auth issue is still retained for diagnostics');
assert.equal(shouldShowOfficeMainBridgeReadinessStrip(geminiAuthOnly), false, 'main Office strip hides Gemini auth-only optional warning');

const mixed = buildOfficeBridgeReadinessSnapshot([
  result('claude-code', 'Claude Code', 'healthy', { sessionCount: 1, port: 7778 }),
  result('codex', 'Codex', 'offline', { detail: 'connection failed', hint: 'Restart with: node scripts/codex-bridge.js', port: 7779 }),
  result('gemini-cli', 'Gemini CLI', 'degraded', { detail: 'bridge up but not authenticated', hint: 'Run `gemini auth login` in a terminal, then refresh.', port: 7780 }),
  result('cursor', 'Cursor', 'healthy', { port: 7781 }),
]);

assert.equal(mixed.statusLabel, 'BRIDGES NEED ATTENTION', 'offline bridge escalates status');
assert.equal(mixed.tone, 'danger', 'offline bridge uses danger tone');
assert.equal(mixed.healthy, 2, 'mixed healthy count');
assert.equal(mixed.degraded, 1, 'mixed degraded count');
assert.equal(mixed.offline, 1, 'mixed offline count');
assert.equal(mixed.readyForAgentTasks, false, 'missing OpenSwan core blocks agent task readiness');
assert.equal(mixed.primaryIssue, 'OpenSwan Proxy: not checked', 'primary issue names missing core bridge');
assert.equal(mixed.actionDetail, 'OpenSwan Proxy: not checked', 'action detail surfaces required issue');
assert.equal(shouldShowOfficeMainBridgeReadinessStrip(mixed), true, 'main Office strip still shows required bridge failures');

const degradedOnly = buildOfficeBridgeReadinessSnapshot([
  result('gemini-cli', 'Gemini CLI', 'degraded', { detail: 'bridge up but not authenticated', port: 7780 }),
  result('cursor', 'Cursor', 'healthy', { port: 7781 }),
]);

assert.equal(degradedOnly.statusLabel, 'BRIDGES NEED ATTENTION', 'degraded-only fleet without OpenSwan needs attention');
assert.equal(degradedOnly.tone, 'danger', 'missing OpenSwan core uses danger tone');
assert.equal(degradedOnly.score, 75, 'degraded bridge scores half credit');
assert.equal(degradedOnly.requiredIssue, 'OpenSwan Proxy: not checked', 'degraded-only snapshot names missing OpenSwan core');

const unavailable = buildOfficeBridgeReadinessSnapshot([], {
  available: false,
  unavailableReason: 'production-web',
});

assert.equal(unavailable.available, false, 'unavailable snapshot records bridge access off');
assert.equal(unavailable.statusLabel, 'BRIDGES DISABLED', 'unavailable snapshot labels disabled');
assert.equal(unavailable.tone, 'muted', 'unavailable snapshot stays muted');
assert.equal(unavailable.summary.includes('production web'), true, 'unavailable summary explains production web skip');
assert.equal(unavailable.readyForAgentTasks, false, 'unavailable bridge runtime cannot run agent tasks');

const failedAudit = buildOfficeBridgeReadinessSnapshot([], {
  available: true,
  error: 'fetch exploded',
});

assert.equal(failedAudit.statusLabel, 'BRIDGE AUDIT FAILED', 'audit error labels failure');
assert.equal(failedAudit.tone, 'danger', 'audit error uses danger tone');
assert.equal(failedAudit.primaryIssue, 'fetch exploded', 'audit error preserves message');
assert.equal(failedAudit.readyForAgentTasks, false, 'failed audit cannot claim readiness');

console.log('All Office bridge readiness smoke cases passed.');
