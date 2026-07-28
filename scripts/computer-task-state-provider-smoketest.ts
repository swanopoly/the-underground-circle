/**
 * Focused smoke for durable capability-buildout provider preservation.
 *
 * Run:
 *   npx tsx scripts/computer-task-state-provider-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  compactComputerTaskCapabilityBuildout,
  normalizeComputerTaskCapabilityProvider,
} from '../src/lib/computerTaskStateModel';

const providers = ['codex', 'claude-code', 'gemini', 'cursor'] as const;
for (const provider of providers) {
  assert.equal(
    normalizeComputerTaskCapabilityProvider(provider),
    provider,
    `canonical ${provider} provider survives normalization`,
  );
  assert.equal(
    compactComputerTaskCapabilityBuildout({
      status: 'requested',
      message: 'Delegated buildout',
      provider,
      updatedAt: '2026-07-24T12:00:00.000Z',
    })?.provider,
    provider,
    `canonical ${provider} provider survives compaction`,
  );
}

assert.equal(
  normalizeComputerTaskCapabilityProvider('  CLAUDE-CODE  '),
  'claude-code',
  'benign casing and whitespace normalize to the canonical provider id',
);
for (const hostile of [
  'shell',
  'codex<script>',
  'x'.repeat(10_000),
  42,
  { toString: () => 'codex' },
  null,
]) {
  assert.equal(
    normalizeComputerTaskCapabilityProvider(hostile),
    null,
    'unknown, oversized, and non-string providers fail closed',
  );
}

const compacted = compactComputerTaskCapabilityBuildout({
  status: 'made_up',
  message: ` ${'m'.repeat(2_000)} `,
  provider: 'codex<script>',
  sourceRefs: ['valid-ref', { toString: () => 'smuggled-ref' }, 'r'.repeat(900)],
  unexpectedSecret: 'must not survive',
  updatedAt: '2026-07-24T12:00:00.000Z',
}) as Record<string, unknown> | null;

assert(compacted, 'object buildout compacts');
assert.equal(compacted.status, 'requested', 'unknown statuses fail closed to requested');
assert.equal(compacted.provider, null, 'hostile provider is removed');
assert.equal((compacted.message as string).length, 1_000, 'message is bounded');
assert.deepEqual(
  compacted.sourceRefs,
  ['valid-ref', 'r'.repeat(500)],
  'lists reject non-string objects and bound retained values',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(compacted, 'unexpectedSecret'),
  false,
  'unknown persisted properties are not copied',
);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const stateSource = readFileSync(`${repoRoot}/src/lib/computerTaskState.ts`, 'utf8');
assert.match(
  stateSource,
  /capabilityBuildout: compactComputerTaskCapabilityBuildout\(parsed\.capabilityBuildout\)/,
  'hydration runs stored buildout state through the canonical compactor',
);
assert.match(
  stateSource,
  /capabilityBuildout: compactComputerTaskCapabilityBuildout\(record\.capabilityBuildout\)/,
  'persistence runs live buildout state through the canonical compactor',
);

console.log('computer task state provider smoke passed');
