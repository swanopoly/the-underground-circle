import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

type VerifiedRead =
  | { status: 'found'; value: string }
  | { status: 'missing' }
  | { status: 'unavailable' | 'invalid' };

const protectedValues = new Map<string, string>();
let failWrite = false;
let storageWrites = 0;
let storageDeletes = 0;
const protectedKey = (namespace: string, id: string) => `${namespace}\u0000${id}`;
const localSecretsStub = {
  async readVerifiedLocalSecret(namespace: string, id: string): Promise<VerifiedRead> {
    const value = protectedValues.get(protectedKey(namespace, id));
    return value === undefined ? { status: 'missing' } : { status: 'found', value };
  },
  async writeVerifiedLocalSecret(namespace: string, id: string, value: string): Promise<boolean> {
    storageWrites += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    if (failWrite) return false;
    protectedValues.set(protectedKey(namespace, id), value);
    return protectedValues.get(protectedKey(namespace, id)) === value;
  },
  async deleteVerifiedLocalSecret(namespace: string, id: string): Promise<boolean> {
    storageDeletes += 1;
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
    protectedValues.delete(protectedKey(namespace, id));
    return !protectedValues.has(protectedKey(namespace, id));
  },
};

const platformState = { OS: 'web' };
type Loader = (request: string, parent: { filename?: string } | undefined, isMain: boolean) => unknown;
const Module = require('node:module') as { _load: Loader };
const originalLoad = Module._load;
Module._load = function patchedLoad(
  this: unknown,
  request: string,
  parent: { filename?: string } | undefined,
  isMain: boolean,
): unknown {
  if (request === 'react-native') return { Platform: platformState };
  if (
    request === './localSecrets'
    && String(parent?.filename || '').endsWith('openSwanApprovalResumeOutbox.ts')
  ) return localSecretsStub;
  return originalLoad.call(this, request, parent, isMain);
};

class ExclusiveLockManager {
  private tails = new Map<string, Promise<void>>();
  active = 0;
  maxActive = 0;
  requests = 0;

  request<T>(
    name: string,
    _options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T> {
    this.requests += 1;
    const prior = this.tails.get(name) || Promise.resolve();
    const result = prior.then(async () => {
      this.active += 1;
      this.maxActive = Math.max(this.maxActive, this.active);
      try {
        return await callback();
      } finally {
        this.active -= 1;
      }
    });
    this.tails.set(name, result.then(() => undefined, () => undefined));
    return result;
  }
}

const lockManager = new ExclusiveLockManager();
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { locks: lockManager },
});

const SOURCE_RUN = '10000000-0000-4000-8000-000000000001';
const CURRENT_RUN = '10000000-0000-4000-8000-000000000002';
const USER = '20000000-0000-4000-8000-000000000001';
const CIRCLE = '30000000-0000-4000-8000-000000000001';
const THREAD = '40000000-0000-4000-8000-000000000001';
const SOURCE_MESSAGE = '40000000-0000-4000-8000-000000000002';
const OTHER_MESSAGE = '40000000-0000-4000-8000-000000000003';
const APPROVAL_A = '50000000-0000-4000-8000-000000000001';
const APPROVAL_B = '50000000-0000-4000-8000-000000000002';
const NOW = Date.now();
const digest = (character: string) => `approval-v2:sha256:${character.repeat(64)}`;

let assertions = 0;
function check(value: unknown, message: string): asserts value {
  assertions += 1;
  assert.ok(value, message);
}
function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function exactCall(input: {
  approvalId: string;
  digestCharacter: string;
  ordinal: number;
  expiresAtMs?: number;
}) {
  return {
    approvalId: input.approvalId,
    sourceRunId: SOURCE_RUN,
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    toolName: 'rooms.rename',
    toolApprovalDigest: digest(input.digestCharacter),
    sourceToolUseId: `provider-call:${input.approvalId}`,
    sourceIteration: 1,
    sourceCallOrdinal: input.ordinal,
    args: { roomId: `room-${input.ordinal}`, nested: { title: `Title ${input.ordinal}` } },
    expiresAtMs: input.expiresAtMs ?? NOW + 60_000,
  } as const;
}

async function main(): Promise<void> {
  const outboxPath = require.resolve('../src/lib/openSwanApprovalResumeOutbox');
  const first = require(outboxPath) as typeof import('../src/lib/openSwanApprovalResumeOutbox');
  delete require.cache[outboxPath];
  const second = require(outboxPath) as typeof import('../src/lib/openSwanApprovalResumeOutbox');
  const authority = require('../src/lib/openSwanApprovalResumeAuthority') as
    typeof import('../src/lib/openSwanApprovalResumeAuthority');
  const approvals = require('../src/lib/openswanToolApprovals') as
    typeof import('../src/lib/openswanToolApprovals');

  const callA = exactCall({ approvalId: APPROVAL_A, digestCharacter: 'a', ordinal: 1 });
  const callB = exactCall({ approvalId: APPROVAL_B, digestCharacter: 'b', ordinal: 2 });
  const [storedA, storedB] = await Promise.all([
    first.persistAndVerifyOpenSwanApprovalResumeOutboxCall(callA, NOW),
    second.persistAndVerifyOpenSwanApprovalResumeOutboxCall(callB, NOW),
  ]);
  check(storedA && storedB, 'two browser realms both receive verified registration');
  equal(lockManager.maxActive, 1, 'origin-wide Web Lock serializes cross-realm transactions');
  check(lockManager.requests >= 2, 'both realms enter the shared Web Lock');

  const listed = await first.listOpenSwanApprovalResumeOutboxCalls({
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    nowMs: NOW + 1,
  });
  check(listed.status === 'ready', 'verified encrypted outbox lists exact scope');
  equal(listed.calls.length, 2, 'concurrent registration loses neither call');
  equal(listed.calls[0]?.approvalId, APPROVAL_A, 'listing preserves original provider order');
  equal(listed.calls[1]?.approvalId, APPROVAL_B, 'second provider call remains present');
  check(Object.isFrozen(listed.calls[0]?.args), 'restored argument object is frozen');
  check(Object.isFrozen((listed.calls[0]?.args.nested as object)), 'nested restored values are frozen');

  const storageKey = protectedKey(
    first.__openSwanApprovalResumeOutboxTestables.storageNamespace,
    first.__openSwanApprovalResumeOutboxTestables.storageId,
  );
  const validSerialized = protectedValues.get(storageKey);
  check(!!validSerialized, 'protected outbox exists after registration');
  const parsed = JSON.parse(validSerialized!);
  equal(Object.keys(parsed.entries).length, 2, 'protected envelope is keyed by exact approval id');
  check(/^nonce-v1:[0-9a-f]{64}$/.test(parsed.entries[APPROVAL_A].nonce), 'envelope has cryptographic nonce');
  check(/^outbox-v1:sha256:[0-9a-f]{64}$/.test(parsed.entries[APPROVAL_A].payloadSha256), 'envelope has exact payload SHA-256');
  equal(parsed.entries[APPROVAL_A].sourceUserMessageId, SOURCE_MESSAGE, 'envelope binds persisted source message');

  parsed.entries[APPROVAL_A].args.nested.title = 'tampered';
  protectedValues.set(storageKey, JSON.stringify(parsed));
  const tampered = await second.listOpenSwanApprovalResumeOutboxCalls({
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    approvalIds: [APPROVAL_A],
    nowMs: NOW + 2,
  });
  check(tampered.status === 'blocked' && tampered.reason === 'storage_invalid', 'argument tampering fails rehash closed');
  protectedValues.set(storageKey, validSerialized!);

  const binding = approvals.buildOpenSwanApprovalResumeBindingV1({
    sourceRunId: SOURCE_RUN,
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    approvals: [
      { approvalId: APPROVAL_B, toolName: 'rooms.rename', toolApprovalDigest: digest('b') },
      { approvalId: APPROVAL_A, toolName: 'rooms.rename', toolApprovalDigest: digest('a') },
    ],
  });
  check(!!binding, 'strict value-free binding fixture is valid');

  const wrongMessage = await first.claimOpenSwanApprovalResumeOutboxCalls({
    binding: binding!,
    currentRunId: CURRENT_RUN,
    sourceUserMessageId: OTHER_MESSAGE,
    nowMs: NOW + 3,
  });
  check(wrongMessage.kind === 'unavailable' && wrongMessage.reason === 'scope_mismatch', 'wrong source message cannot claim calls');
  check(protectedValues.has(storageKey), 'scope mismatch does not remove another message authority');

  const claimed = await second.claimOpenSwanApprovalResumeOutboxCalls({
    binding: binding!,
    currentRunId: CURRENT_RUN,
    sourceUserMessageId: SOURCE_MESSAGE,
    nowMs: NOW + 4,
  });
  check(claimed.kind === 'claimed', 'matching binding claims protected calls');
  if (claimed.kind !== 'claimed') throw new Error('expected claimed outbox');
  equal(claimed.calls.length, 2, 'complete set claims atomically');
  equal(claimed.calls[0]?.approvalId, APPROVAL_A, 'claim canonicalizes malicious/reversed binding order');
  equal(claimed.calls[1]?.approvalId, APPROVAL_B, 'claim retains second original ordinal');
  equal(protectedValues.has(storageKey), false, 'claim verifies protected outbox deletion before returning args');

  const competingClaim = await first.claimOpenSwanApprovalResumeOutboxCalls({
    binding: binding!,
    currentRunId: CURRENT_RUN,
    sourceUserMessageId: SOURCE_MESSAGE,
    nowMs: NOW + 5,
  });
  check(competingClaim.kind === 'unavailable', 'second tab cannot claim spent device custody');

  for (const call of claimed.calls) {
    check(authority.registerOpenSwanApprovalResumeExactCallLease(call, NOW + 4), 'claimed call re-enters exact process authority');
  }
  const dispatched: string[] = [];
  const executed = await authority.executeOpenSwanApprovalResumeExactCalls({
    binding: binding!,
    currentRunId: CURRENT_RUN,
    sourceUserMessageId: SOURCE_MESSAGE,
    nowMs: NOW + 6,
    dispatch: async (call) => {
      dispatched.push(call.approvalId);
      return { status: 'passed' as const, value: call.approvalId };
    },
  });
  equal(executed.disposition.state, 'satisfied', 'device claim composes with process claim');
  equal(dispatched.join(','), `${APPROVAL_A},${APPROVAL_B}`, 'dispatch follows exact provider order');
  equal(authority.inspectOpenSwanApprovalResumeExactCallLease(APPROVAL_A, NOW + 7).present, false, 'process claim is one-shot too');

  const callC = exactCall({
    approvalId: '50000000-0000-4000-8000-000000000003',
    digestCharacter: 'c',
    ordinal: 3,
    expiresAtMs: NOW + 50,
  });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  equal(await first.persistAndVerifyOpenSwanApprovalResumeOutboxCall(callC, NOW), false, 'web registration fails closed without Web Locks');
  const noLockList = await first.listOpenSwanApprovalResumeOutboxCalls({
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    approvalIds: [callC.approvalId],
    nowMs: NOW,
  });
  check(noLockList.status === 'blocked' && noLockList.reason === 'storage_unavailable', 'missing Web Locks has typed blocker');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: lockManager } });

  check(await first.persistAndVerifyOpenSwanApprovalResumeOutboxCall(callC, NOW), 'expiring exact call stores');
  check(await second.sweepExpiredOpenSwanApprovalResumeOutboxCalls(NOW + 51), 'expiry sweep verifies deletion');
  const expired = await first.listOpenSwanApprovalResumeOutboxCalls({
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    approvalIds: [callC.approvalId],
    nowMs: NOW + 52,
  });
  check(expired.status === 'ready' && expired.missingApprovalIds[0] === callC.approvalId, 'expired authority is absent');

  const callD = exactCall({
    approvalId: '50000000-0000-4000-8000-000000000004',
    digestCharacter: 'd',
    ordinal: 4,
  });
  check(await first.persistAndVerifyOpenSwanApprovalResumeOutboxCall(callD, NOW), 'reject fixture stores');
  check(await second.deleteOpenSwanApprovalResumeOutboxCalls({
    userId: USER,
    circleId: CIRCLE,
    threadId: THREAD,
    sourceUserMessageId: SOURCE_MESSAGE,
    approvalIds: [callD.approvalId],
    nowMs: NOW + 1,
  }), 'reject/cancel deletes exact device authority');

  const callE = exactCall({
    approvalId: '50000000-0000-4000-8000-000000000005',
    digestCharacter: 'e',
    ordinal: 5,
  });
  check(await first.persistAndVerifyOpenSwanApprovalResumeOutboxCall(callE, NOW), 'logout fixture stores');
  check(authority.registerOpenSwanApprovalResumeExactCallLease(callE, NOW), 'logout fixture enters process authority');
  check(await second.clearOpenSwanApprovalResumeOutboxForLogout(), 'logout verifies protected deletion');
  equal(authority.inspectOpenSwanApprovalResumeExactCallLease(callE.approvalId, NOW + 1).present, false, 'logout clears process authority');
  equal(protectedValues.has(storageKey), false, 'logout removes protected outbox');

  failWrite = true;
  equal(await first.persistAndVerifyOpenSwanApprovalResumeOutboxCall(callE, NOW), false, 'failed verified write is never acknowledged');
  equal(protectedValues.has(storageKey), false, 'failed verified write leaves no resumable authority');
  failWrite = false;
  check(storageWrites > 0 && storageDeletes > 0, 'smoke exercised protected writes and deletes');

  const outboxSource = readFileSync('src/lib/openSwanApprovalResumeOutbox.ts', 'utf8');
  const localSecretsSource = readFileSync('src/lib/localSecrets.ts', 'utf8');
  const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
  const sessionSource = readFileSync('src/lib/openswanSessionRuntime.ts', 'utf8');
  const logoutSource = readFileSync('src/lib/authLogout.ts', 'utf8');
  const appSource = readFileSync('App.tsx', 'utf8');
  const authoritySource = readFileSync('src/lib/openSwanApprovalResumeAuthority.ts', 'utf8');

  check(outboxSource.includes("import { Platform } from 'react-native'"), 'outbox distinguishes native and web locking');
  check(outboxSource.includes('navigator?: { locks?: WebLockManager }'), 'web path requires Web Locks');
  check(outboxSource.includes("reason: 'storage_unavailable'"), 'unavailable lock has stable blocker');
  check(outboxSource.includes('payloadSha256'), 'closed envelope retains payload digest');
  check(outboxSource.includes('sourceUserMessageId'), 'closed envelope retains exact source message');
  check(outboxSource.includes('deleteVerifiedLocalSecret'), 'one-shot claim uses verified protected deletion');
  check(localSecretsSource.includes('isEncryptedBlob(raw)') && localSecretsSource.includes("status: 'invalid'"), 'strict web reads reject historical plaintext');
  check(localSecretsSource.includes('encryptString(value)') && localSecretsSource.includes('decryptString(stored) === value'), 'web write acknowledges only AES-GCM decrypt readback');
  check(localSecretsSource.includes('does not make browser-held authority safe from code already executing'), 'web encryption does not overclaim XSS safety');
  check(runtimeSource.includes('await persistAndVerifyOpenSwanApprovalResumeOutboxCall(lease)'), 'runtime awaits protected persistence');
  check(runtimeSource.indexOf('await persistAndVerifyOpenSwanApprovalResumeOutboxCall(lease)')
    < runtimeSource.indexOf('registerOpenSwanApprovalResumeExactCallLease(lease)'), 'device persistence precedes process registration');
  check(runtimeSource.includes("if (input.tool === 'desktop.open_attachment') return true"), 'opaque attachment lease remains specialized');
  check(runtimeSource.includes(".eq('resolved_by', input.context.userId)"), 'cross-run consume binds resolver to requester');
  check(runtimeSource.includes(".eq('provider', 'openswan')")
    && runtimeSource.includes(".eq('surface', 'main_chat')")
    && runtimeSource.includes(".eq('status', 'failed')"), 'source run must be failed OpenSwan main Chat');
  check(runtimeSource.includes(".eq('thread_id', context.threadId)")
    && runtimeSource.includes(".eq('source_message_id', context.approvalResumeSourceMessageId)"), 'source run is bound to exact durable thread and user message');
  check(runtimeSource.includes(".from('messages')")
    && runtimeSource.includes(".eq('is_bot', false)"), 'client proves the exact source row is a user message');
  check(runtimeSource.includes("terminalRecord.state === 'partial'")
    && runtimeSource.includes("terminalRecord.reason === 'action_coverage_incomplete'")
    && runtimeSource.includes('terminalRecord.completionVerified === false'), 'source run terminal contract is exact');
  check(sessionSource.indexOf('claimOpenSwanApprovalResumeOutboxCalls({')
    < sessionSource.indexOf('executeOpenSwanApprovalResumeExactCalls<LegacyToolEvent>({'), 'session consumes device custody before direct dispatch path');
  check(sessionSource.includes('Another tab may still own this approval'), 'missing custody does not falsely claim nothing ran cross-tab');
  check(logoutSource.includes('clearOpenSwanApprovalResumeOutboxForLogout'), 'central logout clears approval device custody');
  check(logoutSource.indexOf('closeOpenSwanApprovalResumeOutboxAuthorityForLogout();')
    < logoutSource.indexOf('const cleanupPromise = clearLocalAuthResidualAuthority'), 'direct logout closes exact-call authority synchronously before async cleanup');
  check(appSource.includes("} else if (event === 'SIGNED_OUT') {")
    && appSource.indexOf('closeOpenSwanApprovalResumeOutboxAuthorityForLogout();', appSource.indexOf("} else if (event === 'SIGNED_OUT') {"))
      < appSource.indexOf('clearLocalAuthResidualAuthority(signedOutUserId)', appSource.indexOf("} else if (event === 'SIGNED_OUT') {")), 'remote/cross-tab SIGNED_OUT closes authority before cleanup');
  check(appSource.includes('const opensNewApprovalAuthority = activeUserId !== validatedSession.user.id;')
    && appSource.includes('if (opensNewApprovalAuthority) {'), 'validated token refresh for the same user does not rotate the authority epoch');
  check(authoritySource.includes('lease.sourceUserMessageId === input.sourceUserMessageId'), 'process claim exact-matches source message');
  check(runtimeSource.includes("if (!OPEN_SWAN_RUNTIME_UUID_RE.test(sourceUserMessageId)) return true"), 'non-Chat pending approvals preserve same-run compatibility without generic resume custody');
  check(runtimeSource.includes(".eq('payload->>approvalMode', 'ask')")
    && runtimeSource.includes(".is('payload->>dispatchReceiptSchemaVersion', null)")
    && runtimeSource.includes(".is('payload->>dispatchConsumedAt', null)"), 'bound approval lookup and consume require pristine ask authority');
  check(runtimeSource.includes('Number.isSafeInteger(timeoutSeconds)')
    && runtimeSource.includes('resolvedAtMs <= nowMs')
    && runtimeSource.includes('resolvedAtMs < expiresAtMs')
    && runtimeSource.includes('nowMs < expiresAtMs'), 'bound approval timeline is finite, integral, non-future, and half-open at expiry');
  check(runtimeSource.includes("input.context.approvalResumeBinding != null) {\n    if (\n      input.authority.status !== 'approved'")
    && runtimeSource.includes("safePayload.approvalMode !== 'ask'"), 'bound consume locally revalidates approved ask authority before CAS');

  console.log(`openswan encrypted approval-resume outbox smoke passed (${assertions} assertions)`);
}

void main().finally(() => {
  Module._load = originalLoad;
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
