import assert from 'node:assert/strict';
import Module from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

type RemoteRow = Record<string, any>;
const metadataStore = new Map<string, string>();
const secretStore = new Map<string, string>();
const remoteRows: RemoteRow[] = [];
const safeAuthTokens: string[] = [];
const exactClientTokens: string[] = [];
const exactQueryTokens: string[] = [];
const tokenOwners = new Map([
  ['token-a', 'user-a'],
  ['token-b', 'user-b'],
]);
let remoteAvailable = true;
let secretWritesAvailable = true;
let secretReadsUnavailable = false;
let nextRemoteId = 1;
let authGate: Promise<void> | null = null;
let sharedAuthCalls = 0;
let sharedQueryCalls = 0;
let explicitQueryHeaderCalls = 0;

const fakeStorage = {
  getItem: async (key: string) => metadataStore.get(key) ?? null,
  setItem: async (key: string, value: string) => { metadataStore.set(key, String(value)); },
  removeItem: async (key: string) => { metadataStore.delete(key); },
};

function rowMatches(row: RemoteRow, filters: Array<[string, unknown]>, contains: Array<[string, Record<string, unknown>]>): boolean {
  if (!filters.every(([key, value]) => row[key] === value)) return false;
  return contains.every(([key, expected]) => {
    const actual = row[key];
    return actual && typeof actual === 'object'
      && Object.entries(expected).every(([nestedKey, value]) => actual[nestedKey] === value);
  });
}

class FakeQuery implements PromiseLike<{ data: any; error: any }> {
  private operation: 'select' | 'upsert' | 'delete' = 'select';
  private payload: RemoteRow | null = null;
  private filters: Array<[string, unknown]> = [];
  private containsFilters: Array<[string, Record<string, unknown>]> = [];
  private bearer: string;

  constructor(bearer = '') {
    this.bearer = bearer;
  }

  select(): this { return this; }
  order(): this { return this; }
  single(): this { return this; }
  eq(key: string, value: unknown): this { this.filters.push([key, value]); return this; }
  contains(key: string, value: Record<string, unknown>): this { this.containsFilters.push([key, value]); return this; }
  delete(): this { this.operation = 'delete'; return this; }
  upsert(payload: RemoteRow): this { this.operation = 'upsert'; this.payload = structuredClone(payload); return this; }
  setHeader(name: string, value: string): this {
    if (name === 'Authorization') {
      this.bearer = value;
      explicitQueryHeaderCalls += 1;
    }
    return this;
  }

  private execute(): { data: any; error: any } {
    if (!remoteAvailable) return { data: null, error: { message: 'offline' } };
    const token = this.bearer.replace(/^Bearer\s+/i, '');
    const owner = tokenOwners.get(token);
    if (!owner) return { data: null, error: { message: 'bad bearer' } };
    if (this.operation === 'select') {
      return {
        data: remoteRows.filter(row => rowMatches(row, this.filters, this.containsFilters)).map(row => structuredClone(row)),
        error: null,
      };
    }
    if (this.operation === 'upsert') {
      if (!this.payload || this.payload.owner_id !== owner) return { data: null, error: { message: 'owner mismatch' } };
      const id = this.payload.id || `remote-${nextRemoteId++}`;
      const index = remoteRows.findIndex(row => row.id === id);
      const next = { ...this.payload, id, created_at: index >= 0 ? remoteRows[index].created_at : new Date(0).toISOString() };
      if (index >= 0) remoteRows[index] = next;
      else remoteRows.push(next);
      return { data: { id }, error: null };
    }
    for (let index = remoteRows.length - 1; index >= 0; index -= 1) {
      if (rowMatches(remoteRows[index], this.filters, this.containsFilters)) remoteRows.splice(index, 1);
    }
    return { data: null, error: null };
  }

  then<TResult1 = { data: any; error: any }, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

const fakeSupabase = {
  auth: {
    getUser: async (token: string) => {
      sharedAuthCalls += 1;
      const owner = tokenOwners.get(token);
      return owner
        ? { data: { user: { id: owner } }, error: null }
        : { data: { user: null }, error: { message: 'invalid token' } };
    },
  },
  from: () => {
    sharedQueryCalls += 1;
    return new FakeQuery();
  },
};

const getFakeSupabaseClientForAccessToken = (token: string) => {
  exactClientTokens.push(token);
  return {
    from: () => {
      exactQueryTokens.push(token);
      return new FakeQuery(`Bearer ${token}`);
    },
  };
};

const fakeAuthSession = {
  safeGetUserForAccessToken: async (token: string) => {
    safeAuthTokens.push(token);
    if (authGate) await authGate;
    const owner = tokenOwners.get(token);
    return owner
      ? { value: { id: owner }, error: null }
      : { value: null, error: new Error('invalid token') };
  },
};

const originalLoad = (Module as any)._load;
(Module as any)._load = function loadWithExactConnectionStubs(
  request: string,
  parent: { filename?: string } | undefined,
  isMain: boolean,
) {
  const fromConnectionManager = parent?.filename?.endsWith('/src/lib/connectionManager.ts')
    || parent?.filename?.endsWith('/src/lib/connectionManager.js');
  if (fromConnectionManager && request === './storage') return { storage: fakeStorage };
  if (fromConnectionManager && request === './authSession') return fakeAuthSession;
  if (fromConnectionManager && request === './supabase') {
    return {
      supabase: fakeSupabase,
      getSupabaseClientForAccessToken: getFakeSupabaseClientForAccessToken,
    };
  }
  if (fromConnectionManager && request === 'react-native') return { Platform: { OS: 'web' } };
  if (fromConnectionManager && request === './bridgeEnvironment') {
    return { getBridgeUrl: (port: number) => `http://localhost:${port}` };
  }
  if (fromConnectionManager && request === './localSecrets') {
    return {
      readLocalSecret: async () => '',
      writeLocalSecret: async () => {},
      deleteLocalSecret: async () => {},
      readVerifiedLocalSecret: async (namespace: string, id: string) => {
        if (secretReadsUnavailable) return { status: 'unavailable' as const };
        const value = secretStore.get(`${namespace}:${id}`);
        return value === undefined ? { status: 'missing' as const } : { status: 'found' as const, value };
      },
      writeVerifiedLocalSecret: async (namespace: string, id: string, value: string) => {
        if (!secretWritesAvailable) return false;
        secretStore.set(`${namespace}:${id}`, value);
        return secretStore.get(`${namespace}:${id}`) === value;
      },
      deleteVerifiedLocalSecret: async (namespace: string, id: string) => {
        if (!secretWritesAvailable) return false;
        secretStore.delete(`${namespace}:${id}`);
        return !secretStore.has(`${namespace}:${id}`);
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const connection = {
  id: 'conn-private',
  name: 'Private Claude',
  provider: 'claude-code' as const,
  endpoint: 'http://localhost:7778',
  token: 'private-agent-token',
  enabled: true,
  status: 'connected' as const,
  color: '#f59e0b',
};

const authorityA = { userId: 'user-a', circleId: 'circle-a', accessToken: 'token-a', generation: 1 };
const authorityB = { userId: 'user-b', circleId: 'circle-a', accessToken: 'token-b', generation: 2 };
const authorityOtherCircle = { userId: 'user-a', circleId: 'circle-b', accessToken: 'token-a', generation: 3 };
let currentAuthority = authorityA;
const isCurrent = (authority: typeof authorityA) => (
  authority.userId === currentAuthority.userId
  && authority.circleId === currentAuthority.circleId
  && authority.accessToken === currentAuthority.accessToken
  && authority.generation === currentAuthority.generation
);

async function main(): Promise<void> {
  const manager = await import('../src/lib/connectionManager');

  const keyA = manager.officeConnectionExactStorageKey(authorityA);
  const keyB = manager.officeConnectionExactStorageKey(authorityB);
  const keyOtherCircle = manager.officeConnectionExactStorageKey(authorityOtherCircle);
  assert.equal(keyA, '@office_connections_v2:user:user-a:circle:circle-a');
  assert.notEqual(keyA, keyB, 'another user receives a distinct metadata lane');
  assert.notEqual(keyA, keyOtherCircle, 'another circle receives a distinct metadata lane');
  assert(!keyA?.includes('token-a'), 'bearer material never enters the metadata key');
  assert.notEqual(keyA, '@office_connections', 'the exact path never aliases the ownerless legacy key');
  assert.equal(manager.officeConnectionExactStorageKey({ ...authorityA, generation: 0 }), null, 'invalid generations fail closed');
  const endpointSecretRejected = await manager.saveOfficeConnectionsExact(
    [{ ...connection, endpoint: 'https://example.com/bridge?api_key=plaintext' }],
    authorityA,
    isCurrent,
  );
  assert.equal(endpointSecretRejected.error, 'invalid_connections', 'credentials embedded in endpoint URLs fail closed');
  for (const query of [
    'jwt=header.payload.signature',
    'sig=opaque',
    'session=opaque',
    'X-Amz-Credential=opaque',
    'harmless=still-not-durable',
  ]) {
    const rejected = await manager.saveOfficeConnectionsExact(
      [{ ...connection, endpoint: `https://example.com/bridge?${query}` }],
      authorityA,
      isCurrent,
    );
    assert.equal(rejected.error, 'invalid_connections', `durable exact endpoints reject query string: ${query}`);
  }

  metadataStore.set('@office_connections', JSON.stringify([{ ...connection, token: 'legacy-plaintext' }]));
  secretStore.set('office_connection:conn-private', 'legacy-secret');

  const saveA = await manager.saveOfficeConnectionsExact([connection], authorityA, isCurrent);
  assert.equal(saveA.ok, true, 'the current exact authority can save');
  assert.equal(saveA.localSaved, true, 'metadata and protected secret have readback proof');
  assert.equal(saveA.remoteSaved, true, 'captured-bearer remote synchronization succeeds');
  assert.equal(saveA.connections[0]?.remoteId, 'remote-1', 'remote identity returns in the truthful receipt');
  assert(safeAuthTokens.length > 0 && safeAuthTokens.every(token => token === 'token-a'), 'authority verification uses only the bounded exact-token helper');
  assert(exactClientTokens.length > 0 && exactClientTokens.every(token => token === 'token-a'), 'every exact remote operation creates a captured-token client');
  assert(exactQueryTokens.length > 0 && exactQueryTokens.every(token => token === 'token-a'), 'every exact remote query remains pinned to the captured bearer');
  assert.equal(sharedAuthCalls, 0, 'the exact path never asks the shared auth client to verify a token');
  assert.equal(sharedQueryCalls, 0, 'the exact path never dispatches through the shared Supabase client');
  assert.equal(explicitQueryHeaderCalls, 0, 'the exact path relies on the pinned client rather than query header mutation');

  const storedEnvelope = JSON.parse(metadataStore.get(keyA!)!);
  assert.equal(storedEnvelope.userId, 'user-a');
  assert.equal(storedEnvelope.circleId, 'circle-a');
  assert.equal(storedEnvelope.connections[0].token, '', 'plaintext metadata contains no token or placeholder credential');
  assert(!metadataStore.get(keyA!)?.includes('private-agent-token'), 'the agent token is absent from exact metadata');
  const secretIdA = manager.officeConnectionExactSecretId(authorityA, connection.id)!;
  assert.equal(secretStore.get(`office_connection_v2:${secretIdA}`), 'private-agent-token', 'the token uses the exact verified-secret lane');
  assert.equal(secretStore.get('office_connection:conn-private'), 'legacy-secret', 'exact save never reads, migrates, or rewrites the legacy secret');
  assert.equal(remoteRows[0]?.api_key_hash, '__local_secret__', 'cloud rows contain only the secret placeholder');
  assert.equal(remoteRows[0]?.metadata.officeCircleId, 'circle-a', 'cloud metadata binds the exact circle');

  const legacyRemoteIdAttempt = await manager.saveOfficeConnectionsExact(
    [{ ...saveA.connections[0], remoteId: 'legacy-global-row', token: 'private-agent-token' }],
    authorityA,
    isCurrent,
  );
  assert.equal(legacyRemoteIdAttempt.connections[0]?.remoteId, 'remote-1', 'untrusted caller remote ids cannot retarget an exact row');
  assert(!remoteRows.some(row => row.id === 'legacy-global-row'), 'legacy/global remote ids are never mutated by the exact path');

  safeAuthTokens.length = 0;
  exactClientTokens.length = 0;
  exactQueryTokens.length = 0;
  const loadA = await manager.loadOfficeConnectionsExact(authorityA, isCurrent);
  assert.equal(loadA.ok, true);
  assert.equal(loadA.connections[0]?.token, 'private-agent-token', 'the exact owner can hydrate its protected token');
  assert.equal(loadA.connections[0]?.status, 'disconnected', 'ephemeral status is never trusted from persistence');
  assert(safeAuthTokens.length === 1 && safeAuthTokens[0] === 'token-a', 'exact load verifies the captured bearer through the bounded helper');
  assert(exactClientTokens.length > 0 && exactClientTokens.every(token => token === 'token-a'), 'exact load obtains only a captured-token client');
  assert(exactQueryTokens.length > 0 && exactQueryTokens.every(token => token === 'token-a'), 'exact load binds each query to the captured bearer');

  secretReadsUnavailable = true;
  const unavailableSecretLoad = await manager.loadOfficeConnectionsExact(authorityA, isCurrent);
  assert.equal(unavailableSecretLoad.error, 'secret_unavailable', 'an unreadable protected store fails the exact load closed');
  assert.deepEqual(unavailableSecretLoad.connections, [], 'unreadable secrets never produce partial Office connections');
  secretReadsUnavailable = false;

  currentAuthority = authorityB;
  const loadB = await manager.loadOfficeConnectionsExact(authorityB, isCurrent as any);
  assert.equal(loadB.ok, true);
  assert.deepEqual(loadB.connections, [], 'another account cannot hydrate the first account connection');
  currentAuthority = authorityOtherCircle;
  const loadOtherCircle = await manager.loadOfficeConnectionsExact(authorityOtherCircle, isCurrent as any);
  assert.equal(loadOtherCircle.ok, true);
  assert.deepEqual(loadOtherCircle.connections, [], 'another circle cannot hydrate the first circle connection');

  currentAuthority = authorityA;
  const mismatch = await manager.loadOfficeConnectionsExact(
    { ...authorityA, accessToken: 'token-b', generation: 4 },
    () => true,
  );
  assert.equal(mismatch.error, 'authority_mismatch', 'a bearer belonging to another account fails closed');
  assert.deepEqual(mismatch.connections, []);

  let releaseAuth!: () => void;
  authGate = new Promise<void>(resolve => { releaseAuth = resolve; });
  currentAuthority = authorityA;
  const lateLoad = manager.loadOfficeConnectionsExact(authorityA, isCurrent);
  currentAuthority = authorityB;
  releaseAuth();
  const retired = await lateLoad;
  authGate = null;
  assert.equal(retired.error, 'authority_retired', 'a late load cannot publish after account retirement');
  assert.deepEqual(retired.connections, []);

  currentAuthority = authorityA;
  remoteRows[0].api_key_hash = 'historical-cloud-secret';
  const poisonedRemote = await manager.loadOfficeConnectionsExact(authorityA, isCurrent);
  assert.equal(poisonedRemote.error, 'invalid_remote_data', 'a cloud credential value invalidates the exact response');
  assert.deepEqual(poisonedRemote.connections, [], 'invalid remote data never falls back into Office');
  remoteRows[0].api_key_hash = '__local_secret__';

  const writesBeforeRetiredSave = new Map(metadataStore);
  currentAuthority = authorityB;
  const retiredSave = await manager.saveOfficeConnectionsExact([connection], authorityA, isCurrent);
  assert.equal(retiredSave.error, 'authority_retired');
  assert.deepEqual(metadataStore, writesBeforeRetiredSave, 'a retired authority performs no metadata mutation');

  currentAuthority = authorityA;
  secretWritesAvailable = false;
  const failedSecretSave = await manager.saveOfficeConnectionsExact([{ ...connection, token: 'replacement' }], authorityA, isCurrent);
  assert.equal(failedSecretSave.error, 'secret_unavailable', 'protected-store failure blocks metadata success');
  assert.equal(secretStore.get(`office_connection_v2:${secretIdA}`), 'private-agent-token', 'failed secret replacement leaves the prior credential authoritative');
  secretWritesAvailable = true;

  remoteAvailable = false;
  const offlineSave = await manager.saveOfficeConnectionsExact([{ ...connection, token: 'offline-token' }], authorityA, isCurrent);
  assert.equal(offlineSave.ok, true, 'offline save retains exact device-local success');
  assert.equal(offlineSave.localSaved, true);
  assert.equal(offlineSave.remoteSaved, false);
  assert.equal(offlineSave.error, 'remote_unavailable');
  remoteAvailable = true;

  const removeAll = await manager.saveOfficeConnectionsExact([], authorityA, isCurrent);
  assert.equal(removeAll.ok, true);
  assert.equal(secretStore.has(`office_connection_v2:${secretIdA}`), false, 'removal deletes only the exact protected secret');
  assert.equal(remoteRows.length, 0, 'removal deletes the exact owner/circle remote row');
  assert(metadataStore.has('@office_connections'), 'exact removal does not touch legacy metadata');
  assert.equal(sharedAuthCalls, 0, 'no exact authority operation touched mutable shared auth state');
  assert.equal(sharedQueryCalls, 0, 'no exact remote operation touched the shared Supabase client');
  assert.equal(explicitQueryHeaderCalls, 0, 'no exact remote operation mutated per-query authorization headers');

  console.log('office connections exact-authority smoketest: all assertions passed');
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
