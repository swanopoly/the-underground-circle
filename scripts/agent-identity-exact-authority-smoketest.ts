/**
 * Adversarial smoke for authenticated agent-identity storage and transport.
 *
 * The exact authority core is executed with a fake auth client, while source
 * boundaries pin local cache isolation and explicit PostgREST bearer binding.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/agentIdentity.ts', 'utf8');
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

const authorityPrelude = section(
  "const STORAGE_KEY_AGENT_IDENTITY = '@agent_identity_store';",
  "export type TerminalLaunchMode = 'safe' | 'auto' | 'full-auto';",
).replace(/\bexport\s+/g, '');
const verifySource = section(
  'async function verifyAgentIdentityExactAuthority',
  '/**\n * Read only the cache owned by the exact verified user/circle authority.',
);
const compiled = ts.transpileModule(
  `${authorityPrelude}\n${verifySource}\n;(globalThis as any).__exact = { agentIdentityExactStorageKey, normalizeAgentIdentityExactAuthority, verifyAgentIdentityExactAuthority };`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const authCalls: string[] = [];
let mutableGlobalUser = 'user-a';
let releaseVerification: (() => void) | null = null;
let verificationGate: Promise<void> | null = null;
const sandbox: Record<string, unknown> = {
  supabase: {
    auth: {
      getUser: async (token: string) => {
        authCalls.push(token);
        if (verificationGate) await verificationGate;
        const tokenOwner = token === 'token-a' ? 'user-a' : token === 'token-b' ? 'user-b' : null;
        return tokenOwner
          ? { data: { user: { id: tokenOwner } }, error: null }
          : { data: { user: null }, error: new Error('invalid token') };
      },
      getSession: async () => ({
        data: { session: { user: { id: mutableGlobalUser }, access_token: `token-${mutableGlobalUser}` } },
        error: null,
      }),
    },
  },
};
vm.runInNewContext(compiled, sandbox);
const exact = sandbox.__exact as {
  agentIdentityExactStorageKey: (authority: unknown) => string | null;
  normalizeAgentIdentityExactAuthority: (authority: unknown) => {
    userId: string;
    circleId: string | null;
    accessToken: string;
  } | null;
  verifyAgentIdentityExactAuthority: (authority: unknown) => Promise<{
    userId: string;
    circleId: string | null;
    accessToken: string;
  } | null>;
};

async function main(): Promise<void> {
  console.log('Exact cache namespace');
  const scopeA = { userId: ' user-a ', circleId: ' circle-a ', accessToken: ' token-a ' };
  const scopeB = { userId: 'user-b', circleId: 'circle-a', accessToken: 'token-b' };
  const circleB = { userId: 'user-a', circleId: 'circle-b', accessToken: 'token-a' };
  const keyA = exact.agentIdentityExactStorageKey(scopeA);
  assert(keyA === '@agent_identity_store_v2:user:user-a:circle:circle-a', 'user and circle produce one normalized exact key');
  assert(exact.agentIdentityExactStorageKey(scopeB) !== keyA, 'another owner cannot alias the cache key');
  assert(exact.agentIdentityExactStorageKey(circleB) !== keyA, 'another circle cannot alias the cache key');
  assert(
    exact.agentIdentityExactStorageKey({ userId: 'user-a', accessToken: 'token-a' })
      === '@agent_identity_store_v2:user:user-a:account',
    'an intentionally account-wide scope has an explicit namespace',
  );
  assert(
    exact.agentIdentityExactStorageKey({ userId: 'user-a', circleId: 'account', accessToken: 'token-a' })
      !== exact.agentIdentityExactStorageKey({ userId: 'user-a', accessToken: 'token-a' }),
    'a circle name cannot collide with the account-wide namespace',
  );
  assert(keyA !== '@agent_identity_store', 'exact storage never aliases the ownerless legacy key');
  assert(!keyA?.includes('token-a'), 'bearer material is never embedded in a cache key');
  assert(exact.agentIdentityExactStorageKey({ userId: '', circleId: 'circle-a', accessToken: 'token-a' }) === null, 'empty owner fails closed');
  assert(exact.agentIdentityExactStorageKey({ userId: 'user-a', circleId: '', accessToken: 'token-a' }) === null, 'an explicitly empty circle fails closed');
  assert(exact.agentIdentityExactStorageKey({ userId: 'user-a', circleId: 'circle-a', accessToken: '' }) === null, 'empty bearer fails closed');
  assert(
    exact.agentIdentityExactStorageKey({ userId: 'user-a', accessToken: 'x'.repeat(16_385) }) === null,
    'oversized bearer fails closed',
  );

  console.log('Captured bearer verification');
  authCalls.length = 0;
  const verifiedA = await exact.verifyAgentIdentityExactAuthority(scopeA);
  assert(verifiedA?.userId === 'user-a' && verifiedA.circleId === 'circle-a', 'matching bearer verifies the captured scope');
  assert(authCalls.length === 1 && authCalls[0] === 'token-a', 'verification checks exactly the captured bearer');
  const mismatch = await exact.verifyAgentIdentityExactAuthority({ userId: 'user-a', circleId: 'circle-a', accessToken: 'token-b' });
  assert(mismatch === null, 'a bearer belonging to another owner fails closed');

  authCalls.length = 0;
  verificationGate = new Promise<void>((resolve) => { releaseVerification = resolve; });
  mutableGlobalUser = 'user-a';
  const inFlight = exact.verifyAgentIdentityExactAuthority(scopeA);
  mutableGlobalUser = 'user-b';
  releaseVerification?.();
  const afterGlobalChange = await inFlight;
  verificationGate = null;
  assert(afterGlobalChange?.userId === 'user-a', 'a late global-session change cannot retarget captured authority');
  assert(authCalls.length === 1 && authCalls[0] === 'token-a', 'in-flight verification still uses only the original bearer');

  console.log('Exact local and server source boundaries');
  const exactLoad = section(
    'export async function loadAgentIdentitiesExact',
    '/**\n * Fetch the durable owner-global identities',
  );
  assert(exactLoad.includes('verifyAgentIdentityExactAuthority(capturedAuthority)'), 'local read verifies exact authority first');
  assert(exactLoad.includes('agentIdentityExactStorageKey(authority)'), 'local read derives only the exact scoped key');
  assert(!exactLoad.includes('STORAGE_KEY_AGENT_IDENTITY)'), 'local read never reaches the ownerless legacy key');

  const exactSync = section(
    'export async function syncAgentIdentitiesFromServerExact',
    '/**\n * Seed-up:',
  );
  assert(exactSync.includes(".eq('user_id', authority.userId)"), 'server read filters the captured owner');
  assert(
    exactSync.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"),
    'server read binds the captured bearer',
  );
  assert(exactSync.includes('row?.user_id !== authority.userId'), 'foreign-owner response rows fail the whole read');
  assert(!exactSync.includes('auth.getSession'), 'server read never obtains replacement global auth');

  const exactPersist = section(
    'async function persistIdentitiesToServerExact',
    '/**\n * Persist an exact scope synchronously',
  );
  assert(exactPersist.includes('identityToRow(authority.userId, identity)'), 'server rows are stamped with the captured owner');
  assert(
    exactPersist.match(/\.setHeader\('Authorization', `Bearer \$\{authority\.accessToken\}`\)/g)?.length === 2,
    'primary and compatibility upserts both bind the captured bearer',
  );
  assert(!exactPersist.includes('auth.getUser'), 'server persistence cannot swap authority after verification');
  assert(!exactPersist.includes('auth.getSession'), 'server persistence never reads mutable global session state');

  const exactSave = section(
    'export async function saveAgentIdentitiesExact',
    '// ─── Update Agent Identity',
  );
  const verifyAt = exactSave.indexOf('verifyAgentIdentityExactAuthority(syntacticAuthority)');
  const localWriteAt = exactSave.indexOf('storage.setItem(key, serialized)');
  assert(verifyAt >= 0 && localWriteAt > verifyAt, 'owner verification happens before any exact local mutation');
  assert(exactSave.includes('await storage.getItem(key) !== serialized'), 'local mutation requires exact readback proof');
  assert(exactSave.includes('persistIdentitiesToServerExact(identities, authority)'), 'the same verified authority reaches the durable mutation');
  assert(!exactSave.includes('void persistIdentitiesToServer'), 'exact save returns a truthful awaited server receipt');

  const exactPrimary = section(
    'export async function setMainAgentForProviderExact',
    '// ─── Customize Agent Appearance',
  );
  assert(exactPrimary.includes('loadAgentIdentitiesExact(capturedAuthority)'), 'primary-agent update reads only the exact identity scope');
  assert(exactPrimary.includes('identity.boundAiProvider === normalizedProviderType'), 'primary-agent update clears only the requested provider peers');
  assert(exactPrimary.includes('saveAgentIdentitiesExact(identities, capturedAuthority)'), 'primary-agent update preserves the captured authority through mutation');
  assert(!exactPrimary.includes('loadAgentIdentities()'), 'primary-agent update never falls back to the ownerless cache');

  console.log(`\nPASS: ${assertions} agent-identity exact-authority assertions`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
