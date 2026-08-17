/**
 * Adversarial smoke for Circle Office exact-auth-scope data access.
 *
 * It executes the authority resolver with a fake Supabase auth client and pins
 * every roster read/mutation to an explicitly bound bearer and owner/circle
 * filter without requiring a live Supabase project.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/circleOffice.ts', 'utf8');
let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
}

function section(start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `source marker exists: ${start}`);
  assert(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const authoritySource = section(
  'export type CircleOfficeAuthScope',
  '// ─── Provider',
).replace(/\bexport\s+/g, '');
const compiled = ts.transpileModule(
  `${authoritySource}\n;(globalThis as any).__authority = { normalizeAuthScope, resolveAuthority };`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

type AuthCall = { method: 'getSession' | 'getUser'; token?: string };
const calls: AuthCall[] = [];
let sessionUserId = 'user-a';
let sessionToken = 'token-a';
const sandbox: Record<string, unknown> = {
  supabase: {
    auth: {
      getSession: async () => {
        calls.push({ method: 'getSession' });
        return {
          data: {
            session: {
              user: { id: sessionUserId },
              access_token: sessionToken,
            },
          },
          error: null,
        };
      },
      getUser: async (token: string) => {
        calls.push({ method: 'getUser', token });
        const id = token === 'token-a'
          ? 'user-a'
          : token === 'token-b'
            ? 'user-b'
            : 'unexpected-user';
        return { data: { user: { id } }, error: null };
      },
    },
  },
};
vm.runInNewContext(compiled, sandbox);
const authority = sandbox.__authority as {
  normalizeAuthScope: (scope: unknown) => { userId: string; accessToken: string } | null;
  resolveAuthority: (scope?: { userId: string; accessToken: string }) => Promise<{
    userId: string;
    accessToken: string;
  } | null>;
};

async function main(): Promise<void> {
console.log('Captured authority behavior');
calls.length = 0;
const captured = await authority.resolveAuthority({ userId: ' user-a ', accessToken: ' token-a ' });
assert(captured?.userId === 'user-a', 'captured user is normalized and retained');
assert(captured?.accessToken === 'token-a', 'captured bearer is normalized and retained');
assert(calls.length === 1 && calls[0]?.method === 'getUser', 'captured scope never falls back to mutable getSession');
assert(calls[0]?.token === 'token-a', 'captured bearer is the token verified by getUser');

calls.length = 0;
const mismatched = await authority.resolveAuthority({ userId: 'user-a', accessToken: 'token-b' });
assert(mismatched === null, 'a bearer belonging to another user fails closed');
assert(calls.length === 1 && calls[0]?.token === 'token-b', 'mismatched captured bearer is checked exactly once');
assert(authority.normalizeAuthScope({ userId: '', accessToken: 'token-a' }) === null, 'empty user id is rejected');
assert(authority.normalizeAuthScope({ userId: 'user-a', accessToken: '' }) === null, 'empty bearer is rejected');
assert(
  authority.normalizeAuthScope({ userId: 'user-a', accessToken: 'x'.repeat(16_385) }) === null,
  'oversized bearer is rejected',
);

console.log('Compatibility authority behavior');
calls.length = 0;
sessionUserId = 'user-a';
sessionToken = 'token-a';
const compatible = await authority.resolveAuthority();
assert(compatible?.userId === 'user-a', 'legacy caller captures one cohesive current session');
assert(
  calls.length === 2 && calls[0]?.method === 'getSession' && calls[1]?.method === 'getUser',
  'legacy caller captures a session then verifies its exact bearer',
);
assert(calls[1]?.token === 'token-a', 'legacy verification uses the captured session bearer');

console.log('Exact bearer source boundaries');
assert(!/auth\.getUser\(\s*\)/.test(source), 'module has no mutable zero-argument getUser read');
const load = section('export async function loadCircleOfficeAgents', '// ─── Hidden-agent suppression');
assert(load.includes('capturedScope?: CircleOfficeAuthScope'), 'roster load accepts a captured auth scope');
assert(load.includes('resolveAuthority(capturedScope)'), 'roster load resolves that exact scope');
assert(
  load.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"),
  'roster load binds the captured bearer to PostgREST',
);
assert(load.includes(".eq('circle_id', normalizedCircleId)"), 'roster load filters the requested circle');
assert(load.includes('row?.circle_id === normalizedCircleId'), 'roster response rejects rows from another circle');
assert(load.includes('fromRow(row, authority.userId)'), 'own-agent mapping uses the captured user');

const profile = section('async function getAuthorityUser', '// ─── Load all agents');
assert(profile.includes(".eq('id', authority.userId)"), 'owner profile lookup filters the captured user');
assert(
  profile.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"),
  'owner profile lookup binds the captured bearer',
);

console.log('Mutation owner boundaries');
const operationSections = [
  ['publish', 'export async function publishAgentToCircle', '// ─── Remove an agent'],
  ['unpublish', 'export async function unpublishAgentFromCircle', '// ─── Update live status'],
  ['status', 'export async function updateAgentStatus', '// ─── Set all user'],
  ['offline', 'export async function setAgentsOffline', '// ─── Check if user'],
  ['own roster', 'export async function getUserCircleAgents', '// ─── Subscribe'],
  ['gateway', 'export async function updateAgentGatewayUrl', '// ─── Remove a published'],
  ['remove', 'export async function removeCircleOfficeAgent', '__END__'],
] as const;

for (const [label, start, end] of operationSections) {
  const body = end === '__END__' ? source.slice(source.indexOf(start)) : section(start, end);
  assert(body.includes('capturedScope?: CircleOfficeAuthScope'), `${label} accepts captured authority`);
  assert(body.includes('resolveAuthority(capturedScope)'), `${label} resolves captured authority`);
  assert(
    body.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"),
    `${label} binds the exact bearer`,
  );
}

for (const [label, start, end] of operationSections.filter(([label]) => label !== 'publish')) {
  const body = end === '__END__' ? source.slice(source.indexOf(start)) : section(start, end);
  assert(body.includes(".eq('owner_id', authority.userId)"), `${label} filters the captured owner`);
}
const publish = section('export async function publishAgentToCircle', '// ─── Remove an agent');
assert(publish.includes('owner_id: user.id'), 'publish writes only the exact verified owner id');
assert(publish.includes('circle_id: normalizedCircleId'), 'publish writes only the normalized requested circle');
assert(
  publish.indexOf('resolveAuthority(capturedScope)') < publish.indexOf('isAgentHiddenInOffice(authority.userId, normalizedCircleId, input.name)'),
  'hidden-agent suppression is checked only after exact owner authority resolves',
);
assert(
  source.includes('function hiddenKey(userId: string, circleId: string, name: string)'),
  'hidden-agent suppression is partitioned by user and circle',
);
const retiredSpirit = section('export async function updateAgentSpirit', '// ─── Update gateway');
assert(retiredSpirit.includes("return { error: 'atomic_spirit_assignment_required' }"), 'legacy public-only Spirit mutation fails closed');
assert(!retiredSpirit.includes(".from('circle_office_agents')"), 'legacy Spirit mutation cannot bypass the atomic assignment RPC');

console.log(`\nPASS: ${assertions} Circle Office exact-auth assertions`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
