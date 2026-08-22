/**
 * Cross-realm exact agent-identity cache publication smoke.
 *
 * Pins the web lock + fresh server snapshot boundary and executes the two
 * ordering races that an in-module promise tail cannot cover across tabs.
 */

import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('src/lib/agentIdentity.ts', 'utf8');
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

function officeSection(start: string, end: string): string {
  const startAt = officeSource.indexOf(start);
  const endAt = officeSource.indexOf(end, startAt + start.length);
  assert(startAt >= 0, `Office source marker exists: ${start}`);
  assert(endAt > startAt, `Office source marker follows: ${end}`);
  return officeSource.slice(startAt, endAt);
}

const lockSource = section(
  'type AgentIdentityExactCommandEpoch',
  '/**\n * Exact cache key used by authenticated callers.',
);
const serverSnapshotSource = section(
  'async function fetchAgentIdentitiesServerSnapshotExact',
  'export async function syncAgentIdentitiesFromServerExact',
);
const refreshPublicationSource = section(
  'async function refreshVerifiedAgentIdentitiesFromServerExact',
  '/**\n * Publish only a complete server snapshot',
);
const mutationPublicationSource = section(
  'async function publishCurrentAgentIdentityServerTruthExact',
  'async function saveAgentIdentityMapExact',
);
const publicationSource = `${refreshPublicationSource}\n${mutationPublicationSource}`;
const mapSaveSource = section(
  'async function saveAgentIdentityMapExact',
  '/**\n * Persist an exact scope synchronously',
);
const primarySource = section(
  'export async function setMainAgentForProviderExact',
  '// ─── Customize Agent Appearance',
);
const spiritSource = section(
  'export async function updatePublishedAgentSpiritExact',
  '/** Delete one owner profile only after the server proves it is unreferenced. */',
);
const officeRefreshSelectorSource = officeSection(
  'function resolveAgentIdentityRefreshSnapshot',
  'function idleConfigAuthorityKey',
);
const officeRefreshSource = officeSection(
  'const refreshAgentIdentities = useCallback',
  'useEffect(() => {\n    const requestedAuthority = committedAuthAuthority;',
);

console.log('Cross-realm source contract');
assert(lockSource.includes("return Platform.OS === 'web'"), 'web lock selection follows the React Native storage platform');
assert(lockSource.includes('navigator?: { locks?: AgentIdentityWebLockManager }'), 'Web Locks are discovered without assuming a browser global');
assert(lockSource.includes("{ mode: 'exclusive', signal: acquisitionController.signal }"), 'the exact scope uses one abortable exclusive Web Lock');
assert(lockSource.includes('`uc-agent-identity-cache:${cacheKey}`'), 'the Web Lock is keyed to the exact cache scope');
assert(lockSource.includes('AGENT_IDENTITY_CACHE_LOCK_TIMEOUT_MS'), 'lock acquisition and ownership are bounded');
assert(lockSource.includes('operationController.abort()'), 'a wedged locked operation is actively aborted');
assert(serverSnapshotSource.includes(".select('*', { count: 'exact' })"), 'publication reread requests a completeness count');
assert(serverSnapshotSource.includes('.abortSignal(signal)'), 'publication reread is abortable');
assert(serverSnapshotSource.includes('data.length !== count'), 'a PostgREST-truncated snapshot fails closed');
assert(serverSnapshotSource.includes('row?.user_id !== authority.userId'), 'every snapshot row is bound to the captured owner');
assert(serverSnapshotSource.includes('updated_at'), 'every accepted snapshot row carries a valid server version');
assert(
  refreshPublicationSource.indexOf('withAgentIdentityExactCachePublicationLock(')
    < refreshPublicationSource.indexOf('fetchAgentIdentitiesServerSnapshotExact(authority, signal)'),
  'the full server reread happens only after acquiring the cross-realm cache lane',
);
assert(
  refreshPublicationSource.indexOf('fetchAgentIdentitiesServerSnapshotExact(authority, signal)')
    < refreshPublicationSource.indexOf('publishVerifiedAgentIdentityCacheExact('),
  'fresh server truth replaces receipt order before any local publication',
);
assert(refreshPublicationSource.includes('export async function refreshAgentIdentitiesFromServerExact'), 'the read-only lock-scoped refresh owner is exported for initiating realms');
assert(refreshPublicationSource.includes('verifyAgentIdentityExactAuthority(syntacticAuthority, fence)'), 'read-only refresh verifies the captured bearer and generation');
assert(!/\.(?:insert|update|upsert)\(/.test(refreshPublicationSource), 'read-only refresh contains no durable row mutation method');
assert(!refreshPublicationSource.includes('persistIdentitiesToServerExact('), 'read-only refresh cannot enter the broad identity writer');
assert(mutationPublicationSource.includes("serverSaved: true"), 'post-mutation publication preserves the already-committed server receipt');
assert(!publicationSource.includes('Date.now('), 'client wall-clock time is never cache-ordering authority');
assert(mapSaveSource.includes('return publishCurrentAgentIdentityServerTruthExact(authority, fence)'), 'generic exact mutations also enter the cross-realm publication boundary');
assert(primarySource.includes('parseAgentIdentityPrimaryRpcReceipt('), 'primary mutation still validates its exact RPC receipt');
assert(primarySource.includes("serverSaved: null, error: 'outcome_unknown'"), 'unverifiable primary receipt remains outcome_unknown');
assert(primarySource.includes('publishCurrentAgentIdentityServerTruthExact('), 'verified primary mutation publishes only fresh full server truth');
assert(spiritSource.includes('parsePublishedAgentSpiritRpcReceipt('), 'Spirit mutation still validates its atomic RPC receipt');
assert(spiritSource.includes("serverSaved: null, error: 'outcome_unknown'"), 'unverifiable Spirit receipt remains outcome_unknown');
assert(spiritSource.includes('publishCurrentAgentIdentityServerTruthExact('), 'verified Spirit mutation publishes only fresh full server truth');
assert(officeSource.includes('agentIdentityExactStorageKey(requestedAuthority)'), 'Office subscribes only to its captured exact identity cache key');
assert(officeSource.includes("window.addEventListener('storage', onExactIdentityStorage)"), 'web Office listens for cross-tab exact cache publication');
assert(officeSource.includes('event.key !== exactStorageKey || event.newValue === null'), 'unrelated/removal storage events cannot alter the current identity view');
assert(officeSource.includes('loadAgentIdentitiesExact(requestedAuthority, isOfficeAuthorityCurrent)'), 'cross-tab adoption re-verifies the captured bearer and lifecycle fence');
assert(officeSource.includes('setAgentIdentities(identities);') && officeSource.includes('tabs converge without an event loop.'), 'cross-tab adoption is read-only and cannot create a storage-event loop');
assert(officeRefreshSource.includes('resolveAgentIdentityRefreshSnapshot(localIdentities, serverResult)'), 'initiating-tab refresh selects one exact snapshot instead of merging local rows');
assert(officeRefreshSource.includes('refreshAgentIdentitiesFromServerExact('), 'Office delegates authoritative reread and cache publication to the read-only owner');
assert(!officeRefreshSource.includes('saveAgentIdentitiesExact('), 'Office refresh cannot reinterpret server absence as broad save input');
assert(!officeRefreshSource.includes('syncAgentIdentitiesFromServerExact('), 'Office performs no unlocked pre-publication server read');
assert(officeRefreshSource.includes('agentIdentityRefreshGenerationRef.current = refreshGeneration'), 'each initiating-tab refresh claims a monotonic local generation');
assert((officeRefreshSource.match(/if \(!refreshIsCurrent\(\)\) return false;/g) || []).length === 3, 'local load, server read, and state adoption are fenced against overlapping refreshes');

const compiledOfficeRefreshSelector = ts.transpileModule(
  `${officeRefreshSelectorSource}\n;(globalThis as any).__selectRefreshSnapshot = resolveAgentIdentityRefreshSnapshot;`,
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const officeRefreshSandbox: Record<string, any> = {};
vm.runInNewContext(compiledOfficeRefreshSelector, officeRefreshSandbox);
const selectRefreshSnapshot = officeRefreshSandbox.__selectRefreshSnapshot as (
  localIdentities: Map<string, Record<string, unknown>>,
  serverResult: Readonly<{
    serverVerified: boolean;
    identities: Map<string, Record<string, unknown>>;
  }>,
) => Map<string, Record<string, unknown>>;

console.log('Initiating-tab snapshot replacement');
const localA = { sessionKey: 'agent-a', version: 'local-a' };
const staleLocalB = { sessionKey: 'agent-b', version: 'deleted-b' };
const serverA = { sessionKey: 'agent-a', version: 'server-a' };
const localSnapshot = new Map([
  ['agent-a', localA],
  ['agent-b', staleLocalB],
]);
const serverSnapshot = new Map([['agent-a', serverA]]);
const replacedSnapshot = selectRefreshSnapshot(localSnapshot, {
  serverVerified: true,
  identities: serverSnapshot,
});
assert(replacedSnapshot.size === 1, 'a count-complete A-only server snapshot removes stale local B in the initiating tab');
assert(replacedSnapshot.get('agent-a') === serverA, 'server identity A replaces the local version unconditionally');
assert(!replacedSnapshot.has('agent-b'), 'server-deleted identity B is not merged back from local state');
assert(replacedSnapshot !== serverSnapshot, 'the initiating tab adopts an independent map snapshot');

const emptyServerSnapshot = selectRefreshSnapshot(localSnapshot, {
  serverVerified: true,
  identities: new Map(),
});
assert(emptyServerSnapshot.size === 0, 'a verified empty server snapshot removes the final stale local identity');

const failedServerSnapshot = selectRefreshSnapshot(localSnapshot, {
  serverVerified: false,
  identities: new Map([['untrusted', { sessionKey: 'untrusted' }]]),
});
assert(failedServerSnapshot.size === 2, 'a failed server read preserves the complete local fallback snapshot');
assert(failedServerSnapshot.get('agent-b') === staleLocalB, 'failed server data cannot replace a valid local identity');
assert(failedServerSnapshot !== localSnapshot, 'the local fallback is adopted as an independent map snapshot');

type LockOptions = Readonly<{ mode: 'exclusive'; signal: AbortSignal }>;

class SharedExclusiveLockManager {
  private tails = new Map<string, Promise<void>>();

  request<T>(
    name: string,
    options: LockOptions,
    callback: () => Promise<T>,
  ): Promise<T> {
    const prior = this.tails.get(name) || Promise.resolve();
    const result = prior.then(async () => {
      if (options.signal.aborted) throw new Error('AbortError');
      return callback();
    });
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(name, tail);
    void tail.finally(() => {
      if (this.tails.get(name) === tail) this.tails.delete(name);
    });
    return result;
  }
}

type PublishResult = Readonly<{
  ok: boolean;
  localSaved: boolean;
  serverSaved: boolean;
  error?: string;
}>;

type RefreshResult = Readonly<{
  ok: boolean;
  identities: Map<string, Record<string, unknown>>;
  serverVerified: boolean;
  localSaved: boolean;
  error?: string;
}>;

type Realm = Readonly<{
  sandbox: Record<string, any>;
  publish: (authority: Record<string, unknown>, fence: () => boolean) => Promise<PublishResult>;
  refresh: (authority: Record<string, unknown>, fence: () => boolean) => Promise<RefreshResult>;
}>;

type WebLocksLike = Readonly<{
  request<T>(name: string, options: LockOptions, callback: () => Promise<T>): Promise<T>;
}>;

const compiledRealm = ts.transpileModule(
  `${lockSource}\n${publicationSource}\n;(globalThis as any).__publish = publishCurrentAgentIdentityServerTruthExact;\n;(globalThis as any).__refresh = refreshAgentIdentitiesFromServerExact;`.replace(/\bexport\s+/g, ''),
  {
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;

let serverVersion = 'A';
let localVersion = 'A';
let fetchCalls = 0;
let publicationCalls = 0;
let observedAbortSignal = false;
let serverSnapshotOverride: Map<string, Record<string, unknown>> | null = null;
let lastPublishedSnapshot = new Map<string, Record<string, unknown>>();
let durableMutationCalls = 0;

function makeRealm(
  locks: WebLocksLike | null,
  platform: 'web' | 'ios' = 'web',
  timeoutMs = 8_000,
): Realm {
  const sandbox: Record<string, any> = {
    Platform: { OS: platform },
    AbortController,
    setTimeout,
    clearTimeout,
    navigator: locks ? { locks } : {},
    AGENT_IDENTITY_CACHE_LOCK_TIMEOUT_MS: timeoutMs,
    normalizeAgentIdentityExactWriteAuthority: (value: unknown) => value,
    verifyAgentIdentityExactAuthority: async (value: unknown, fence: (authority: unknown) => boolean) => (
      fence(value) ? value : null
    ),
    agentIdentityExactStorageKey: () => 'user:user-a:circle:circle-a',
    isAgentIdentityExactAuthorityCurrent: (_authority: unknown, fence: () => boolean) => fence(),
    fetchAgentIdentitiesServerSnapshotExact: async (_authority: unknown, signal?: AbortSignal) => {
      fetchCalls += 1;
      observedAbortSignal ||= !!signal;
      return {
        ok: true,
        identities: serverSnapshotOverride
          ? new Map(serverSnapshotOverride)
          : new Map([['agent', { sessionKey: 'agent', version: serverVersion }]]),
      };
    },
    publishVerifiedAgentIdentityCacheExact: async (identities: Map<string, Record<string, unknown>>) => {
      publicationCalls += 1;
      lastPublishedSnapshot = new Map(identities);
      localVersion = String(identities.get('agent')?.version || 'missing');
      return { ok: true, localSaved: true, serverSaved: true };
    },
    persistIdentitiesToServerExact: async () => {
      durableMutationCalls += 1;
      throw new Error('read-only refresh entered a durable mutation path');
    },
  };
  vm.runInNewContext(compiledRealm, sandbox);
  return {
    sandbox,
    publish: sandbox.__publish,
    refresh: sandbox.__refresh,
  };
}

async function main() {
  const authority = {
    userId: 'user-a',
    circleId: 'circle-a',
    accessToken: 'token-a',
    generation: 1,
  };

  console.log('Delete between stale observation and locked refresh');
  fetchCalls = 0;
  publicationCalls = 0;
  durableMutationCalls = 0;
  const refreshLocks = new SharedExclusiveLockManager();
  const refreshRealm = makeRealm(refreshLocks);
  const staleObservedSnapshot = new Map([
    ['agent-a', { sessionKey: 'agent-a', version: 'before-delete-a' }],
    ['agent-b', { sessionKey: 'agent-b', version: 'before-delete-b' }],
  ]);
  serverSnapshotOverride = new Map(staleObservedSnapshot);
  let markRefreshVerificationStarted!: () => void;
  let releaseRefreshVerification!: () => void;
  const refreshVerificationStarted = new Promise<void>(resolve => {
    markRefreshVerificationStarted = resolve;
  });
  const refreshVerificationGate = new Promise<void>(resolve => {
    releaseRefreshVerification = resolve;
  });
  refreshRealm.sandbox.verifyAgentIdentityExactAuthority = async (value: unknown) => {
    markRefreshVerificationStarted();
    await refreshVerificationGate;
    return value;
  };
  const refreshAfterDelete = refreshRealm.refresh(authority, () => true);
  await refreshVerificationStarted;
  const freshestServerA = { sessionKey: 'agent-a', version: 'after-delete-a' };
  serverSnapshotOverride = new Map([['agent-a', freshestServerA]]);
  releaseRefreshVerification();
  const refreshed = await refreshAfterDelete;
  assert(refreshed.ok === true && refreshed.serverVerified === true && refreshed.localSaved === true, 'read-only refresh returns a fully published verified snapshot');
  assert(fetchCalls === 1, 'refresh performs one authoritative server read inside the cache lane');
  assert(refreshed.identities.size === 1 && refreshed.identities.get('agent-a') === freshestServerA, 'refresh returns the freshest A-only server truth after B is deleted');
  assert(!refreshed.identities.has('agent-b'), 'the earlier observed B cannot survive the locked refresh');
  assert(lastPublishedSnapshot.size === 1 && !lastPublishedSnapshot.has('agent-b'), 'cache publication uses the same freshest A-only snapshot');
  assert(durableMutationCalls === 0, 'delete-between-reads never inserts or updates the absent identity');
  serverSnapshotOverride = null;

  console.log('Older completion after newer publication');
  const locks = new SharedExclusiveLockManager();
  const olderRealm = makeRealm(locks);
  serverVersion = 'B';
  localVersion = 'B';
  const lateOlder = await olderRealm.publish(authority, () => true);
  assert(lateOlder.ok === true, 'an older completion may reconcile successfully');
  assert(localVersion === 'B', 'an older receipt completion republishes current server B, never stale A');
  assert(observedAbortSignal, 'the locked server reread receives the operation abort signal');

  console.log('Newer publication waits behind an older snapshot');
  serverVersion = 'A';
  localVersion = 'initial';
  fetchCalls = 0;
  publicationCalls = 0;
  let releaseOlderFetch!: () => void;
  let markOlderFetchCaptured!: () => void;
  const olderFetchCaptured = new Promise<void>(resolve => { markOlderFetchCaptured = resolve; });
  const olderFetchGate = new Promise<void>(resolve => { releaseOlderFetch = resolve; });
  olderRealm.sandbox.fetchAgentIdentitiesServerSnapshotExact = async (
    _authority: unknown,
    signal?: AbortSignal,
  ) => {
    fetchCalls += 1;
    observedAbortSignal ||= !!signal;
    const captured = serverVersion;
    markOlderFetchCaptured();
    await olderFetchGate;
    return {
      ok: true,
      identities: new Map([['agent', { sessionKey: 'agent', version: captured }]]),
    };
  };
  const newerRealm = makeRealm(locks);
  const olderPublication = olderRealm.publish(authority, () => true);
  await olderFetchCaptured;
  serverVersion = 'B';
  const newerPublication = newerRealm.publish(authority, () => true);
  await Promise.resolve();
  assert(fetchCalls === 1, 'the newer tab cannot reread or publish while the older tab holds the exact cache lane');
  releaseOlderFetch();
  const [olderResult, newerResult] = await Promise.all([olderPublication, newerPublication]);
  assert(olderResult.ok === true && newerResult.ok === true, 'both verified server completions retain truthful success');
  assert(fetchCalls === 2 && publicationCalls === 2, 'each serialized completion performs one fresh server reread and publication');
  assert(localVersion === 'B', 'the waiting newer completion is the final server-truth cache publication');

  console.log('Unavailable Web Locks');
  fetchCalls = 0;
  publicationCalls = 0;
  localVersion = 'unchanged';
  const unsupportedWebRealm = makeRealm(null, 'web');
  const unsupported = await unsupportedWebRealm.publish(authority, () => true);
  assert(
    unsupported.ok === false
      && unsupported.serverSaved === true
      && unsupported.localSaved === false
      && unsupported.error === 'local_write_failed',
    'a web realm without navigator.locks reports server-saved/local-failed',
  );
  assert(fetchCalls === 0 && publicationCalls === 0 && localVersion === 'unchanged', 'lock-unavailable web never enters the local publication task');

  console.log('Bounded lock acquisition');
  const neverGrantedLocks: WebLocksLike = {
    request: async (_name, options) => new Promise<never>((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
    }),
  };
  const timedWebRealm = makeRealm(neverGrantedLocks, 'web', 25);
  const timedWebResult = await Promise.race([
    timedWebRealm.publish(authority, () => true),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('web lock did not time out')), 1_000)),
  ]);
  assert(
    timedWebResult.ok === false
      && timedWebResult.serverSaved === true
      && timedWebResult.error === 'local_write_failed',
    'a queued Web Lock acquisition times out as a server-saved local failure',
  );

  console.log('Bounded held Web Lock operation');
  serverVersion = 'A';
  localVersion = 'unchanged';
  fetchCalls = 0;
  publicationCalls = 0;
  const operationLocks = new SharedExclusiveLockManager();
  const timedHeldRealm = makeRealm(operationLocks, 'web', 25);
  let markTimedFetchStarted!: () => void;
  let releaseTimedFetch!: () => void;
  const timedFetchStarted = new Promise<void>(resolve => { markTimedFetchStarted = resolve; });
  const timedFetchGate = new Promise<void>(resolve => { releaseTimedFetch = resolve; });
  let timedFetchSignal: AbortSignal | undefined;
  timedHeldRealm.sandbox.fetchAgentIdentitiesServerSnapshotExact = async (
    _authority: unknown,
    signal?: AbortSignal,
  ) => {
    fetchCalls += 1;
    timedFetchSignal = signal;
    const captured = serverVersion;
    markTimedFetchStarted();
    // Deliberately ignore abort until the adapter eventually settles. The
    // publication fence must still prevent a late stale cache write.
    await timedFetchGate;
    return {
      ok: true,
      identities: new Map([['agent', { sessionKey: 'agent', version: captured }]]),
    };
  };
  const timedHeldPublication = timedHeldRealm.publish(authority, () => true);
  await timedFetchStarted;
  const timedHeldResult = await Promise.race([
    timedHeldPublication,
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('held web operation did not time out')), 1_000)),
  ]);
  assert(
    timedHeldResult.ok === false
      && timedHeldResult.serverSaved === true
      && timedHeldResult.error === 'local_write_failed',
    'a granted Web Lock operation has its own bounded server-saved/local-failed result',
  );
  assert(timedFetchSignal?.aborted === true, 'held-operation timeout aborts the server reread signal');

  serverVersion = 'B';
  const recoveryRealm = makeRealm(operationLocks, 'web', 1_000);
  const recoveredPublication = await recoveryRealm.publish(authority, () => true);
  assert(
    recoveredPublication.ok === true && localVersion === 'B',
    'another tab can acquire the released lane and publish current server B',
  );
  releaseTimedFetch();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert(
    publicationCalls === 1 && localVersion === 'B',
    'the timed-out stale task cannot publish after the exclusive lock is released',
  );

  console.log('Native single-process fallback');
  serverVersion = 'native-current';
  observedAbortSignal = false;
  const nativeRealm = makeRealm(null, 'ios');
  const nativeResult = await nativeRealm.publish(authority, () => true);
  assert(nativeResult.ok === true && localVersion === 'native-current', 'native preserves the existing in-process serialized publication path');
  assert(observedAbortSignal, 'native server reread is bounded by the same operation abort signal');

  const timedNativeRealm = makeRealm(null, 'ios', 25);
  timedNativeRealm.sandbox.fetchAgentIdentitiesServerSnapshotExact = async (
    _authority: unknown,
    signal?: AbortSignal,
  ) => new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true });
  });
  const timedNativeResult = await Promise.race([
    timedNativeRealm.publish(authority, () => true),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('native publication did not time out')), 1_000)),
  ]);
  assert(
    timedNativeResult.ok === false
      && timedNativeResult.serverSaved === true
      && timedNativeResult.error === 'local_write_failed',
    'a wedged native server reread also times out without speculative publication',
  );

  console.log(`\nPASS: ${assertions} agent-identity cross-realm cache-ordering assertions`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
