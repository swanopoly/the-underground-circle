/**
 * Focused smoke for the client-side Office token snapshot trust boundary.
 *
 * Executes only the dependency-free snapshot section in a VM so malformed
 * bridge telemetry and per-key overflow circuit breaking can be verified
 * without a live Supabase project.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/officeTerminal.ts', 'utf8');
const start = source.indexOf('// ─── Sync agent token snapshot to DB');
const end = source.indexOf('// ─── Update agent position', start);
assert(start >= 0 && end > start, 'Office token snapshot source section exists');

const section = source.slice(start, end).replace(/\bexport\s+/g, '');
const compiled = ts.transpileModule(
  `${section}
;(globalThis as any).__tokenSnapshotGuard = {
  normalizeTokenSnapshotKey,
  validateTokenSnapshotUsage,
  syncAgentTokenSnapshot,
};`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

type RpcResult = { error: Record<string, unknown> | null };

function createHarness(results: RpcResult[] = []) {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const warnings: string[] = [];
  let authCalls = 0;
  const sandbox: Record<string, unknown> = {
    console: {
      warn: (...values: unknown[]) => warnings.push(values.map(String).join(' ')),
    },
    supabase: {
      auth: {
        getUser: async () => {
          authCalls += 1;
          return { data: { user: { id: 'owner-id' } } };
        },
      },
      rpc: async (name: string, params: Record<string, unknown>) => {
        rpcCalls.push({ name, params });
        return results.shift() || { error: null };
      },
    },
  };
  vm.runInNewContext(compiled, sandbox);
  return {
    core: sandbox.__tokenSnapshotGuard as {
      normalizeTokenSnapshotKey: (agentName: string, snapshotKey?: string) => string;
      validateTokenSnapshotUsage: (
        inputTokens: number,
        outputTokens: number,
        cachedTokens: number,
        messageCount: number,
        estimatedCost: number,
      ) => { valid: boolean; field?: string };
      syncAgentTokenSnapshot: (
        circleId: string,
        agentName: string,
        inputTokens: number,
        outputTokens: number,
        cachedTokens: number,
        messageCount: number,
        estimatedCost: number,
        model?: string,
        snapshotKey?: string,
      ) => Promise<void>;
    },
    rpcCalls,
    warnings,
    authCalls: () => authCalls,
  };
}

async function main() {
const validation = createHarness();
assert.equal(validation.core.normalizeTokenSnapshotKey('Codex Agent', '  session-1  '), 'session-1');
assert.equal(validation.core.normalizeTokenSnapshotKey('Codex Agent', '   '), 'codex agent');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 4, 0.25).valid, true);
assert.equal(validation.core.validateTokenSnapshotUsage(Number.NaN, 2, 3, 4, 0.25).field, 'inputTokens');
assert.equal(validation.core.validateTokenSnapshotUsage(1, Number.POSITIVE_INFINITY, 3, 4, 0.25).field, 'outputTokens');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, -1, 4, 0.25).field, 'cachedTokens');
assert.equal(
  validation.core.validateTokenSnapshotUsage(Number.MAX_SAFE_INTEGER + 1, 0, 0, 0, 0).field,
  'inputTokens',
);
assert.equal(
  validation.core.validateTokenSnapshotUsage(Number.MAX_SAFE_INTEGER, 1, 0, 0, 0).field,
  'outputTokens',
);
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 2_147_483_648, 0).field, 'messageCount');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 4, Number.POSITIVE_INFINITY).field, 'estimatedCost');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 4, 1_000_000).field, 'estimatedCost');
assert.equal(validation.core.validateTokenSnapshotUsage(1, 2, 3, 4, 999_999.999_999).valid, true);

await validation.core.syncAgentTokenSnapshot(
  'circle-id',
  'Invalid Agent',
  Number.NaN,
  0,
  0,
  0,
  0,
  undefined,
  'invalid-key',
);
await validation.core.syncAgentTokenSnapshot(
  'circle-id',
  'Invalid Agent',
  Number.NaN,
  0,
  0,
  0,
  0,
  undefined,
  'invalid-key',
);
assert.equal(validation.authCalls(), 0, 'invalid telemetry is rejected before auth or RPC work');
assert.equal(validation.rpcCalls.length, 0, 'invalid telemetry is never sent to Supabase');
assert.equal(validation.warnings.length, 1, 'an invalid snapshot emits one bounded warning per identity');

const overflow = createHarness([
  { error: { code: '22003', message: 'value out of range' } },
  { error: null },
]);
const syncValid = (key: string) => overflow.core.syncAgentTokenSnapshot(
  'circle-id',
  'Codex Agent',
  100,
  50,
  10,
  2,
  0.123456,
  'model-name',
  key,
);
await syncValid('overflow-key');
await syncValid('overflow-key');
await syncValid('healthy-key');
assert.equal(overflow.rpcCalls.length, 2, 'only the overflowing normalized snapshot identity is disabled');
assert.equal(overflow.rpcCalls[0].params.p_snapshot_key, 'overflow-key');
assert.equal(overflow.rpcCalls[1].params.p_snapshot_key, 'healthy-key');
assert.equal(overflow.warnings.length, 1, 'SQLSTATE 22003 emits one warning and does not retry the bad key');
assert.match(overflow.warnings[0], /other agent snapshots will continue/i);
assert.match(overflow.warnings[0], /No usage values were clamped or written/i);

const messageOverflow = createHarness([
  { error: { message: 'numeric field overflow' } },
]);
await messageOverflow.core.syncAgentTokenSnapshot(
  'circle-id',
  'Claude Agent',
  1,
  1,
  0,
  1,
  1,
  undefined,
  'message-overflow-key',
);
assert.equal(messageOverflow.rpcCalls.length, 1, 'numeric field overflow is not replayed through the legacy signature');
assert.equal(messageOverflow.warnings.length, 1, 'numeric field overflow emits one bounded diagnostic');

console.log('office token snapshot guard smoke passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
