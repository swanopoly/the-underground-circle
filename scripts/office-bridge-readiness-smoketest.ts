import assert from 'node:assert/strict';
import { buildOfficeBridgeReadinessSnapshot } from '../src/lib/officeBridgeReadiness';
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
assert.equal(mixed.primaryIssue, 'Codex: connection failed', 'primary issue uses first unhealthy bridge');
assert.equal(mixed.actionDetail, 'Restart with: node scripts/codex-bridge.js', 'action detail surfaces restart hint');

const degradedOnly = buildOfficeBridgeReadinessSnapshot([
  result('gemini-cli', 'Gemini CLI', 'degraded', { detail: 'bridge up but not authenticated', port: 7780 }),
  result('cursor', 'Cursor', 'healthy', { port: 7781 }),
]);

assert.equal(degradedOnly.statusLabel, 'BRIDGES PARTIAL', 'degraded-only fleet is partial');
assert.equal(degradedOnly.tone, 'warn', 'degraded-only fleet uses warning tone');
assert.equal(degradedOnly.score, 75, 'degraded bridge scores half credit');

const unavailable = buildOfficeBridgeReadinessSnapshot([], {
  available: false,
  unavailableReason: 'production-web',
});

assert.equal(unavailable.available, false, 'unavailable snapshot records bridge access off');
assert.equal(unavailable.statusLabel, 'BRIDGES DISABLED', 'unavailable snapshot labels disabled');
assert.equal(unavailable.tone, 'muted', 'unavailable snapshot stays muted');
assert.equal(unavailable.summary.includes('production web'), true, 'unavailable summary explains production web skip');

const failedAudit = buildOfficeBridgeReadinessSnapshot([], {
  available: true,
  error: 'fetch exploded',
});

assert.equal(failedAudit.statusLabel, 'BRIDGE AUDIT FAILED', 'audit error labels failure');
assert.equal(failedAudit.tone, 'danger', 'audit error uses danger tone');
assert.equal(failedAudit.primaryIssue, 'fetch exploded', 'audit error preserves message');

console.log('All Office bridge readiness smoke cases passed.');
