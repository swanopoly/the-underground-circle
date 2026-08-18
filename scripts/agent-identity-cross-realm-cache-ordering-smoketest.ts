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

const lockSource = section(
  'type AgentIdentityExactCommandEpoch',
  '/**\n * Exact cache key used by authenticated callers.',
);
const serverSnapshotSource = section(
  'async function fetchAgentIdentitiesServerSnapshotExact',
  'export async function syncAgentIdentitiesFromServerExact',
);
const publicationSource = section(
  'async function publishCurrentAgentIdentityServerTruthExact',
  'async function saveAgentIdentityMapExact',
);
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
  publicationSource.indexOf('withAgentIdentityExactCachePublicationLock(')
    < publicationSource.indexOf('fetchAgentIdentitiesServerSnapshotExact(authority, signal)'),
  'the full server reread happens only after acquiring the cross-realm cache lane',
);
assert(
  publicationSource.indexOf('fetchAgentIdentitiesServerSnapshotExact(authority, signal)')
    < publicationSource.indexOf('publishVerifiedAgentIdentityCacheExact('),
  'fresh server truth replaces receipt order before any local publication',
);
assert(publicationSource.includes("serverSaved: true, error: 'local_write_failed'"), 'lock/read timeout preserves verified server truth and fails local publication closed');
assert(!publicationSource.includes('Date.now('), 'client wall-clock time is never cache-ordering authority');
assert(mapSaveSource.includes('return publishCurrentAgentIdentityServerTruthExact(authority, fence)'), 'generic exact mutations also enter the cross-realm publication boundary');
assert(primarySource.includes('parseAgentIdentityPrimaryRpcReceipt('), 'primary mutation still validates its exact RPC receipt');
assert(primarySource.includes("serverSaved: null, error: 'outcome_unknown'"), 'unverifiable primary receipt remains outcome_unknown');
assert(primarySource.includes('publishCurrentAgentIdentityServerTruthExact('), 'verified primary mutation publishes only fresh full server truth');
assert(spiritSource.includes('parsePublishedAgentSpiritRpcReceipt('), 'Spirit mutation still validates its atomic RPC receipt');
assert(spiritSource.includes("serverSaved: null, error: 'outcome_unknown'"), 'unverifiable Spirit receipt remains outcome_unknown');
assert(spiritSource.includes('publishCurrentAgentIdentityServerTruthExact('), 'verified Spirit mutation publishes only fresh full server truth');

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

type Realm = Readonly<{
  sandbox: Record<string, any>;
  publish: (authority: Record<string, unknown>, fence: () => boolean) => Promise<PublishResult>;
}>;

type WebLocksLike = Readonly<{
  request<T>(name: string, options: LockOptions, callback: () => Promise<T>): Promise<T>;
}>;

const compiledRealm = ts.transpileModule(
  `${lockSource}\n${publicationSource}\n;(globalThis as any).__publish = publishCurrentAgentIdentityServerTruthExact;`,
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
    agentIdentityExactStorageKey: () => 'user:user-a:circle:circle-a',
    isAgentIdentityExactAuthorityCurrent: (_authority: unknown, fence: () => boolean) => fence(),
    fetchAgentIdentitiesServerSnapshotExact: async (_authority: unknown, signal?: AbortSignal) => {
      fetchCalls += 1;
      observedAbortSignal ||= !!signal;
      return {
        ok: true,
        identities: new Map([['agent', { sessionKey: 'agent', version: serverVersion }]]),
      };
    },
    publishVerifiedAgentIdentityCacheExact: async (identities: Map<string, { version: string }>) => {
      publicationCalls += 1;
      localVersion = identities.get('agent')?.version || 'missing';
      return { ok: true, localSaved: true, serverSaved: true };
    },
  };
  vm.runInNewContext(compiledRealm, sandbox);
  return {
    sandbox,
    publish: sandbox.__publish,
  };
}

async function main() {
  const authority = {
    userId: 'user-a',
    circleId: 'circle-a',
    accessToken: 'token-a',
    generation: 1,
  };

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
