/**
 * Adversarial smoke for Office dashboard exact-authority persistence.
 *
 * The pure authority resolver is executed with a fake token verifier, while
 * source-boundary assertions pin every dashboard read/mutation to the captured
 * bearer, owner, circle, and current-generation guard.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/officeDashboardPersistence.ts', 'utf8');
const officeSource = fs.readFileSync('src/screens/circles/tabs/OfficeTab.tsx', 'utf8');
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

type Authority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  authorityGeneration: number;
}>;

const helperSource = section(
  'function normalizeOfficeResourceId',
  'const OFFICE_AUTHORITY_RETIRED_ERROR',
);
const compiled = ts.transpileModule(
  `
    type OfficeDashboardExactAuthority = Readonly<{
      userId: string;
      circleId: string;
      accessToken: string;
      authorityGeneration: number;
    }>;
    type OfficeDashboardAuthorityGuard = () => boolean;
    ${helperSource}
    ;(globalThis as any).__authority = {
      normalizeExactAuthority,
      authorityGuardPasses,
      resolveExactAuthority,
    };
  `,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

const verifiedTokens: string[] = [];
let verificationUserId = 'user-a';
let releaseVerification: (() => void) | null = null;
let verificationBarrier: Promise<void> | null = null;
const sandbox: Record<string, unknown> = {
  safeGetUserForAccessToken: async (token: string) => {
    verifiedTokens.push(token);
    if (verificationBarrier) await verificationBarrier;
    return { value: { id: verificationUserId }, error: null };
  },
};
vm.runInNewContext(compiled, sandbox);
const authorityHelpers = sandbox.__authority as {
  normalizeExactAuthority: (circleId: string, authority?: Authority) => Authority | null;
  authorityGuardPasses: (guard?: () => boolean) => boolean;
  resolveExactAuthority: (
    circleId: string,
    authority?: Authority,
    guard?: () => boolean,
  ) => Promise<Authority | null>;
};

async function main(): Promise<void> {
  console.log('Exact authority validation');
  const normalized = authorityHelpers.normalizeExactAuthority(' circle-a ', {
    userId: ' user-a ',
    circleId: ' circle-a ',
    accessToken: ' token-a ',
    authorityGeneration: 7,
  });
  assert(normalized?.userId === 'user-a', 'user id is normalized');
  assert(normalized?.circleId === 'circle-a', 'circle id is normalized');
  assert(normalized?.accessToken === 'token-a', 'captured bearer is normalized');
  assert(normalized?.authorityGeneration === 7, 'authority generation is retained');
  assert(Object.isFrozen(normalized), 'normalized authority is immutable');
  assert(authorityHelpers.normalizeExactAuthority('circle-b', normalized || undefined) === null, 'circle mismatch fails closed');
  assert(authorityHelpers.normalizeExactAuthority('circle-a', { ...normalized!, authorityGeneration: 0 }) === null, 'zero generation fails closed');
  assert(authorityHelpers.normalizeExactAuthority('circle-a', { ...normalized!, authorityGeneration: 1.5 }) === null, 'fractional generation fails closed');
  assert(authorityHelpers.normalizeExactAuthority('circle-a', { ...normalized!, accessToken: 'x'.repeat(16_385) }) === null, 'oversized bearer fails closed');
  assert(!authorityHelpers.authorityGuardPasses(undefined), 'missing current-authority guard fails closed');
  assert(!authorityHelpers.authorityGuardPasses(() => { throw new Error('retired'); }), 'throwing guard fails closed');

  console.log('Token verification and account-switch races');
  verifiedTokens.length = 0;
  let current = true;
  verificationUserId = 'user-a';
  const resolved = await authorityHelpers.resolveExactAuthority('circle-a', normalized!, () => current);
  assert(resolved?.userId === 'user-a', 'matching captured bearer resolves');
  assert(verifiedTokens.length === 1 && verifiedTokens[0] === 'token-a', 'resolver verifies the captured bearer exactly once');

  verifiedTokens.length = 0;
  const preRetired = await authorityHelpers.resolveExactAuthority('circle-a', normalized!, () => false);
  assert(preRetired === null, 'retired authority before verification fails closed');
  assert(verifiedTokens.length === 0, 'pre-retired authority performs no auth request');

  verificationUserId = 'user-b';
  const mismatched = await authorityHelpers.resolveExactAuthority('circle-a', normalized!, () => true);
  assert(mismatched === null, 'bearer owned by another user fails closed');

  verificationUserId = 'user-a';
  current = true;
  verificationBarrier = new Promise<void>((resolve) => { releaseVerification = resolve; });
  const delayed = authorityHelpers.resolveExactAuthority('circle-a', normalized!, () => current);
  await Promise.resolve();
  current = false;
  releaseVerification?.();
  const retiredDuringVerification = await delayed;
  verificationBarrier = null;
  releaseVerification = null;
  assert(retiredDuringVerification === null, 'account switch during token verification fails closed');

  console.log('Persistence request boundaries');
  assert(!source.includes('auth.getSession('), 'dashboard persistence never borrows the mutable global session');
  assert(source.includes('export type OfficeDashboardExactAuthority'), 'module exports the exact authority contract');
  assert(source.includes('authorityGeneration: number'), 'authority contract carries lifecycle generation');

  const membershipProof = section(
    'export async function verifyOfficeCircleMembership',
    'export async function loadOfficeUserPreferences',
  );
  assert(membershipProof.includes('resolveExactAuthority('), 'membership proof verifies captured exact authority');
  assert(membershipProof.includes(".from('circle_members')"), 'membership proof reads the canonical membership table');
  assert(membershipProof.includes(".eq('circle_id', authority.circleId)"), 'membership proof binds the captured circle');
  assert(membershipProof.includes(".eq('user_id', authority.userId)"), 'membership proof binds the captured user');
  assert(membershipProof.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"), 'membership proof uses the captured bearer');
  assert(membershipProof.includes('if (!authorityGuardPasses(isCurrent))'), 'membership proof rejects a late retired result');
  assert(membershipProof.includes("error: 'This signed-in account is not a member of this circle.'"), 'empty membership fails closed as denial');

  const leaseStart = officeSource.indexOf('// Membership is a lease, not a one-time boot fact.');
  const leaseEnd = officeSource.indexOf('// Cleanup pollers on unmount', leaseStart);
  assert(leaseStart >= 0 && leaseEnd > leaseStart, 'Office owns a continuous membership lease section');
  const membershipLease = officeSource.slice(leaseStart, leaseEnd);
  assert(membershipLease.includes('setInterval(() => { void revalidateMembership(); }, 45_000)'), 'membership is periodically revalidated');
  assert(membershipLease.includes("table: 'circle_members'"), 'membership changes invalidate the lease through Realtime');
  assert(membershipLease.includes('toOfficeDashboardAuthority(requestedAuthority)'), 'lease checks reuse captured exact authority');
  assert(membershipLease.includes('authAuthorityRef.current = null;'), 'membership loss retires the current authority immediately');
  assert(membershipLease.indexOf('authAuthorityRef.current = null;') < membershipLease.indexOf('setFloorLayoutHydratedCircleId(null);'), 'authority retires before private surface hydration is cleared');
  assert(membershipLease.includes('poller.stop();') && membershipLease.includes('membershipSubscription.unsubscribe();'), 'membership loss and cleanup stop long-lived work');

  const operations = [
    ['attention list', 'export async function listOfficeAttentionAcknowledgements', 'export async function acknowledgeOfficeAttention'],
    ['attention mutation', 'export async function acknowledgeOfficeAttention', 'function mapFloorPresetRow'],
    ['preset list', 'export async function listOfficeFloorPresets', 'export async function saveOfficeFloorPreset'],
    ['preset save', 'export async function saveOfficeFloorPreset', 'export async function deleteOfficeFloorPreset'],
    ['preset delete', 'export async function deleteOfficeFloorPreset', '/** Exact-authority Office wrapper'],
    ['memory read', 'export async function loadOfficeCircleSessionMemoryMode', '/**\n * Read-modify-write the circle setting'],
    ['memory mutation', 'export async function saveOfficeCircleSessionMemoryMode', '__END__'],
  ] as const;

  for (const [label, start, end] of operations) {
    const body = end === '__END__' ? source.slice(source.indexOf(start)) : section(start, end);
    assert(body.includes('capturedAuthority?: OfficeDashboardExactAuthority'), `${label} accepts captured exact authority`);
    assert(body.includes('isCurrent?: OfficeDashboardAuthorityGuard'), `${label} accepts a current-generation guard`);
    assert(body.includes('resolveExactAuthority('), `${label} verifies its captured authority`);
    assert(body.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"), `${label} binds the captured bearer`);
    assert(body.includes('authorityGuardPasses(isCurrent)'), `${label} rejects a retired result`);
  }

  const attentionFallback = section(
    'export async function listOfficeAttentionAcknowledgements',
    'export async function acknowledgeOfficeAttention',
  );
  assert(attentionFallback.includes(".eq('user_id', authority.userId)"), 'attention fallback filters the exact owner');
  assert(attentionFallback.includes(".eq('circle_id', authority.circleId)"), 'attention fallback filters the exact circle');

  for (const [label, start, end] of [
    ['attention mutation', 'export async function acknowledgeOfficeAttention', 'function mapFloorPresetRow'],
    ['preset list', 'export async function listOfficeFloorPresets', 'export async function saveOfficeFloorPreset'],
    ['preset save', 'export async function saveOfficeFloorPreset', 'export async function deleteOfficeFloorPreset'],
    ['preset delete', 'export async function deleteOfficeFloorPreset', '/** Exact-authority Office wrapper'],
  ] as const) {
    const body = section(start, end);
    assert(body.includes('authority.userId'), `${label} binds or verifies the exact owner`);
    assert(body.includes('authority.circleId'), `${label} binds or verifies the exact circle`);
  }

  const memoryMutation = source.slice(source.indexOf('export async function saveOfficeCircleSessionMemoryMode'));
  const guardBeforeUpdate = memoryMutation.indexOf('if (!authorityGuardPasses(isCurrent))');
  const updateDispatch = memoryMutation.indexOf(".update({ settings: { ...settings, sessionMemoryMode: mode } })");
  assert(guardBeforeUpdate >= 0 && guardBeforeUpdate < updateDispatch, 'memory mutation checks current authority before update dispatch');
  assert(memoryMutation.includes(".eq('id', authority.circleId)"), 'memory mutation filters the captured circle');
  assert(memoryMutation.includes(".select('id')"), 'memory mutation requires a returned changed-circle receipt');

  console.log(`\nPASS: ${assertions} Office dashboard exact-authority assertions`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
