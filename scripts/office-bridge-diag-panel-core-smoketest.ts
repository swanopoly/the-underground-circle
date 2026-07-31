/**
 * Smoke test for officeBridgeDiagPanelCore — the pure model builder behind
 * the passive Office bridge/pairing status panel.
 *
 * Run: npx tsx scripts/office-bridge-diag-panel-core-smoketest.ts
 */
import assert from 'node:assert/strict';
import {
  buildBridgeDiagPanelModel,
  formatProbedAgo,
  sanitizeBridgeDetail,
  type TimestampedBridgeProbeResult,
} from '../src/lib/officeBridgeDiagPanelCore';
import type { BridgeProbeResult } from '../src/lib/bridgeHealthDiag';

let assertions = 0;
const eq = (actual: unknown, expected: unknown, msg: string) => {
  assert.deepEqual(actual, expected, msg);
  assertions += 1;
};
const ok = (cond: boolean, msg: string) => {
  assert.equal(cond, true, msg);
  assertions += 1;
};

const NOW = 1_800_000_000_000; // fixed clock

function result(
  name: BridgeProbeResult['name'],
  label: string,
  status: BridgeProbeResult['status'],
  overrides: Partial<TimestampedBridgeProbeResult> = {},
): TimestampedBridgeProbeResult {
  return {
    name,
    label,
    port: overrides.port ?? 7778,
    status,
    detail: overrides.detail ?? status,
    sessionCount: overrides.sessionCount,
    authMissing: overrides.authMissing,
    hint: overrides.hint,
    raw: overrides.raw,
    probedAtMs: overrides.probedAtMs ?? NOW - 30_000,
  };
}

// ─── 1. All healthy ────────────────────────────────────────────────

{
  const model = buildBridgeDiagPanelModel(
    [
      result('claude-code', 'Claude Code', 'healthy', { detail: '2 sessions' }),
      result('codex', 'Codex', 'healthy', { detail: '1 session' }),
      result('gemini-cli', 'Gemini CLI', 'healthy', { detail: '0 sessions · user@example.com' }),
      result('cursor', 'Cursor', 'healthy'),
      result('openswan-proxy', 'OpenSwan Proxy', 'healthy', { detail: 'live (CORS + auth proxy)' }),
    ],
    NOW,
  );
  eq(model.summary.healthy, 5, 'all-healthy: healthy count');
  eq(model.summary.total, 5, 'all-healthy: total count');
  eq(model.summary.label, 'BRIDGES 5/5', 'all-healthy: label');
  eq(model.summary.tone, 'ok', 'all-healthy: tone ok');
  eq(model.rows.length, 5, 'all-healthy: five rows');
  ok(model.rows.every((r) => r.status === 'ok'), 'all-healthy: every row ok');
  eq(model.collapsedLine, 'BRIDGES 5/5 ✓ · 30s ago', 'all-healthy: collapsed line has check + ago, no problems');
  eq(model.rows[0].probedAgoLabel, '30s ago', 'all-healthy: probedAgo rendered');
  eq(model.rows[2].detail, '0 sessions · user@example.com', 'all-healthy: benign detail (email) preserved');
}

// ─── 2. One offline ────────────────────────────────────────────────

{
  const model = buildBridgeDiagPanelModel(
    [
      result('claude-code', 'Claude Code', 'healthy'),
      result('codex', 'Codex', 'offline', {
        detail: 'connection failed: fetch failed',
        hint: 'Restart with: node scripts/codex-bridge.js',
      }),
      result('gemini-cli', 'Gemini CLI', 'healthy'),
      result('cursor', 'Cursor', 'healthy'),
      result('openswan-proxy', 'OpenSwan Proxy', 'healthy'),
    ],
    NOW,
  );
  eq(model.summary.label, 'BRIDGES 4/5', 'one-offline: label');
  eq(model.summary.tone, 'warn', 'one-offline: tone warn');
  eq(model.rows[1].status, 'offline', 'one-offline: row status');
  eq(model.collapsedLine, 'BRIDGES 4/5 ⚠ · codex offline · 30s ago', 'one-offline: exact collapsed line from the spec');
}

// ─── 3. Unpaired (degraded + authMissing) vs generic degraded ──────

{
  const model = buildBridgeDiagPanelModel(
    [
      result('gemini-cli', 'Gemini CLI', 'degraded', {
        detail: 'bridge up but not authenticated (auth=none)',
        authMissing: true,
      }),
      result('codex', 'Codex', 'degraded', { detail: 'weird partial state' }),
      result('claude-code', 'Claude Code', 'healthy'),
    ],
    NOW,
  );
  eq(model.rows[0].status, 'unpaired', 'degraded+authMissing maps to unpaired');
  eq(model.rows[1].status, 'error', 'degraded without authMissing maps to error');
  eq(model.summary.tone, 'warn', 'mixed health: warn');
  ok(model.collapsedLine.includes('gemini-cli unpaired'), 'unpaired named in collapsed line');
  ok(model.collapsedLine.includes('codex error'), 'error named in collapsed line');
}

// ─── 4. All down ───────────────────────────────────────────────────

{
  const model = buildBridgeDiagPanelModel(
    [
      result('claude-code', 'Claude Code', 'offline'),
      result('codex', 'Codex', 'offline'),
      result('gemini-cli', 'Gemini CLI', 'offline'),
      result('cursor', 'Cursor', 'offline'),
      result('openswan-proxy', 'OpenSwan Proxy', 'offline'),
    ],
    NOW,
  );
  eq(model.summary.label, 'BRIDGES 0/5', 'all-down: label');
  eq(model.summary.tone, 'danger', 'all-down: tone danger');
  ok(model.collapsedLine.startsWith('BRIDGES 0/5 ✗'), 'all-down: danger icon');
  ok(
    model.collapsedLine.includes('5 bridges need attention'),
    'all-down: >2 problems collapse to a count instead of a name list',
  );
}

// ─── 5. Empty + null-ish input (totality) ──────────────────────────

{
  const empty = buildBridgeDiagPanelModel([], NOW);
  eq(empty.summary.label, 'BRIDGES 0/0', 'empty: label');
  eq(empty.summary.tone, 'warn', 'empty: warn, not danger (probe absent, not proven down)');
  eq(empty.rows.length, 0, 'empty: no rows');
  ok(empty.collapsedLine.includes('no probe results'), 'empty: collapsed says no probe results');

  const nul = buildBridgeDiagPanelModel(null, NOW);
  eq(nul.summary.total, 0, 'null input: total 0, no throw');
  const undef = buildBridgeDiagPanelModel(undefined, NOW);
  eq(undef.summary.total, 0, 'undefined input: total 0, no throw');
  const notArray = buildBridgeDiagPanelModel('nope' as unknown as unknown[], NOW);
  eq(notArray.summary.total, 0, 'non-array input: total 0, no throw');
}

// ─── 6. Malformed entries (totality) ───────────────────────────────

{
  const model = buildBridgeDiagPanelModel(
    [
      null,
      undefined,
      42,
      'garbage',
      {},
      { name: 'codex' }, // missing status/detail
      { name: 'claude-code', status: 'weird-future-status', detail: 7 },
    ],
    NOW,
  );
  eq(model.rows.length, 7, 'malformed: every entry still yields a row');
  ok(model.rows.slice(0, 4).every((r) => r.status === 'error'), 'malformed: non-objects become error rows');
  eq(model.rows[0].detail, 'malformed probe result', 'malformed: null entry detail');
  eq(model.rows[0].probedAgoLabel, '—', 'malformed: no timestamp renders —');
  eq(model.rows[5].name, 'codex', 'partial: name preserved');
  eq(model.rows[5].status, 'error', 'partial: missing status maps to error');
  eq(model.rows[5].detail, 'error', 'partial: missing detail falls back to status word');
  eq(model.rows[6].status, 'error', 'unknown future status maps to error');
  eq(model.rows[6].detail, 'error', 'non-string detail replaced with status word');
  eq(model.summary.tone, 'danger', 'malformed: zero healthy of >0 is danger');
}

// ─── 7. Secret-safety ──────────────────────────────────────────────

{
  const token = 'sk-abc123def456ghi789jkl012';
  const ghToken = 'ghp_AbCdEf123456789012345678901234567890';
  const genericToken = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4';
  const model = buildBridgeDiagPanelModel(
    [
      result('claude-code', 'Claude Code', 'offline', {
        detail: `connection failed: Bearer ${token} rejected at http://localhost:7778/pair?token=${genericToken}#frag`,
      }),
      result('codex', 'Codex', 'degraded', { detail: `auth header ${ghToken} expired` }),
      result('cursor', 'Cursor', 'offline', { detail: `handshake nonce ${genericToken}` }),
    ],
    NOW,
  );
  for (const row of model.rows) {
    ok(!row.detail.includes(token), `secret-safety [${row.name}]: sk- token never surfaced`);
    ok(!row.detail.includes(ghToken), `secret-safety [${row.name}]: ghp token never surfaced`);
    ok(!row.detail.includes(genericToken), `secret-safety [${row.name}]: generic token never surfaced`);
    ok(!row.detail.includes('?token='), `secret-safety [${row.name}]: URL query stripped`);
    ok(row.detail.length <= 100, `secret-safety [${row.name}]: detail bounded`);
  }
  ok(model.rows[0].detail.includes('http://localhost:7778'), 'secret-safety: URL origin retained');
  ok(!model.rows[0].detail.includes('/pair'), 'secret-safety: URL path dropped');
  ok(model.rows[0].detail.includes('bearer [redacted]'), 'secret-safety: bearer redaction marker present');

  // Direct sanitizer checks.
  eq(sanitizeBridgeDetail('plain healthy text'), 'plain healthy text', 'sanitizer: benign text untouched');
  eq(sanitizeBridgeDetail('2 sessions · user@example.com'), '2 sessions · user@example.com', 'sanitizer: email preserved');
  eq(sanitizeBridgeDetail(undefined), '', 'sanitizer: non-string → empty');
  eq(sanitizeBridgeDetail('see https://bridge.example.com:8443/deep/path?k=v'), 'see https://bridge.example.com:8443', 'sanitizer: URL → origin with port');
  eq(sanitizeBridgeDetail('timed out after 1500ms'), 'timed out after 1500ms', 'sanitizer: short digit runs untouched');
  ok(sanitizeBridgeDetail('x'.repeat(500)).length <= 100, 'sanitizer: long text bounded');
  ok(!sanitizeBridgeDetail('xoxb-1234567890-abcdefg').includes('xoxb-1234567890'), 'sanitizer: slack token redacted');
}

// ─── 8. probedAgo formatting at fixed nowMs ────────────────────────

{
  eq(formatProbedAgo(NOW, NOW), 'just now', 'ago: 0ms → just now');
  eq(formatProbedAgo(NOW - 9_999, NOW), 'just now', 'ago: <10s → just now');
  eq(formatProbedAgo(NOW - 10_000, NOW), '10s ago', 'ago: 10s boundary');
  eq(formatProbedAgo(NOW - 30_000, NOW), '30s ago', 'ago: 30s');
  eq(formatProbedAgo(NOW - 59_999, NOW), '59s ago', 'ago: 59s');
  eq(formatProbedAgo(NOW - 60_000, NOW), '1m ago', 'ago: 1m boundary');
  eq(formatProbedAgo(NOW - 5 * 60_000, NOW), '5m ago', 'ago: 5m');
  eq(formatProbedAgo(NOW - 3_600_000, NOW), '1h ago', 'ago: 1h boundary');
  eq(formatProbedAgo(NOW - 26 * 3_600_000, NOW), '26h ago', 'ago: hours cap format');
  eq(formatProbedAgo(NOW + 5_000, NOW), 'just now', 'ago: clock skew (future) → just now');
  eq(formatProbedAgo(undefined, NOW), '—', 'ago: missing timestamp → —');
  eq(formatProbedAgo(Number.NaN, NOW), '—', 'ago: NaN → —');
  eq(formatProbedAgo('12345' as unknown as number, NOW), '—', 'ago: non-number → —');
}

// ─── 9. Model never echoes raw probe bodies ────────────────────────

{
  const model = buildBridgeDiagPanelModel(
    [
      result('claude-code', 'Claude Code', 'healthy', {
        detail: 'healthy',
        raw: { ok: true, secretField: 'sk-shouldNeverAppear1234567890' },
      }),
    ],
    NOW,
  );
  const serialized = JSON.stringify(model);
  ok(!serialized.includes('sk-shouldNeverAppear'), 'raw probe body never enters the model');
  ok(!serialized.includes('secretField'), 'raw probe keys never enter the model');
}

console.log(`office-bridge-diag-panel-core smoke: ${assertions} assertions passed`);
