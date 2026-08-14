import assert from 'node:assert/strict';
import Module from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

const localValues = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    get length() { return localValues.size; },
    clear: () => localValues.clear(),
    getItem: (key: string) => localValues.get(key) ?? null,
    key: (index: number) => Array.from(localValues.keys())[index] ?? null,
    removeItem: (key: string) => { localValues.delete(key); },
    setItem: (key: string, value: string) => { localValues.set(key, String(value)); },
  },
});

const originalLoad = (Module as any)._load;
(Module as any)._load = function loadWithSmokeStubs(
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === 'react-native') {
    return {
      Platform: {
        OS: 'web',
        select: (options: Record<string, unknown>) => options.web ?? options.default,
      },
    };
  }
  if (request === '@react-native-async-storage/async-storage') {
    return {
      __esModule: true,
      default: {
        getAllKeys: async () => Array.from(localValues.keys()),
        getItem: async (key: string) => localValues.get(key) ?? null,
        multiRemove: async (keys: string[]) => { keys.forEach((key) => localValues.delete(key)); },
        removeItem: async (key: string) => { localValues.delete(key); },
        setItem: async (key: string, value: string) => { localValues.set(key, String(value)); },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CIRCLE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CIRCLE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const SCOPE_A = { userId: USER_A, circleId: CIRCLE_A };
const SCOPE_B = { userId: USER_B, circleId: CIRCLE_A };
const SCOPE_OTHER_CIRCLE = { userId: USER_A, circleId: CIRCLE_B };
const INVALID_SCOPE = { userId: 'user-a', circleId: CIRCLE_A };

const tag = { key: 'project:private', label: 'Private', color: '#3b82f6' };
const legacyTag = { key: 'project:legacy', label: 'Legacy', color: '#8b5cf6' };

function cachedSession(sessionKey: string, totalCost: number) {
  return {
    sessionKey,
    agentId: `agent:${sessionKey}`,
    connectionId: 'codex-auto',
    lastUpdate: Date.now(),
    totalCost,
    totalTokens: 100,
    inputTokens: 60,
    outputTokens: 40,
    turns: 2,
  };
}

async function main(): Promise<void> {
  const primaryTags = await import('../src/lib/sessionTags');
  const cache = await import('../src/lib/sessionCache');

  assert.equal(primaryTags.isValidOfficeSessionStorageScope(SCOPE_A), true, 'canonical user/circle UUIDs are accepted');
  assert.equal(primaryTags.isValidOfficeSessionStorageScope(INVALID_SCOPE), false, 'non-UUID account scope fails closed');
  assert.equal(primaryTags.officeSessionTagsStorageKey(INVALID_SCOPE), null, 'invalid scope cannot mint a storage key');
  assert.equal(
    primaryTags.officeSessionTagsStorageKey(SCOPE_A),
    `@office_session_tags_v2:${USER_A}:${CIRCLE_A}`,
    'the primary tag key binds the exact user and circle',
  );
  assert.equal(
    cache.officeSessionCacheStorageKey(SCOPE_A),
    `@office_session_cache_v2:${USER_A}:${CIRCLE_A}`,
    'the session-cache key binds the exact user and circle',
  );

  localValues.set('@office_session_tags', JSON.stringify([{
    sessionKey: 'legacy-session',
    tags: [legacyTag],
    timestamp: new Date().toISOString(),
  }]));
  localValues.set('@office_tag_suggestions', JSON.stringify([legacyTag]));
  localValues.set('@office_session_cache', JSON.stringify({
    'legacy-session': cachedSession('legacy-session', 91),
  }));
  localValues.set('@office_daily_costs', JSON.stringify([{
    date: new Date().toISOString().slice(0, 10),
    costs: { 'legacy-agent': 91 },
    tokens: { 'legacy-agent': 910 },
  }]));
  localValues.set('@session_tags_backup', JSON.stringify({ 'legacy-session': [legacyTag] }));

  assert.equal((await primaryTags.loadSessionTags()).has('legacy-session'), true, 'the deprecated no-scope API remains explicit legacy compatibility');
  assert.equal((await cache.loadSessionCache()).has('legacy-session'), true, 'the deprecated no-scope cache remains explicit legacy compatibility');
  assert.equal((await primaryTags.loadSessionTags(SCOPE_A)).size, 0, 'a scoped tag read never imports ownerless legacy data');
  assert.equal((await primaryTags.loadTagSuggestions(SCOPE_A)).length, 0, 'scoped suggestions never import ownerless legacy data');
  assert.equal((await cache.loadSessionCache(SCOPE_A)).size, 0, 'a scoped cache read never imports ownerless legacy data');
  assert.equal((await cache.loadDailyCosts(SCOPE_A)).length, 0, 'scoped daily costs never import ownerless legacy data');
  assert.equal((await cache.loadSessionTags(SCOPE_A)).size, 0, 'the scoped tag backup never imports ownerless legacy data');

  const scopedTags = new Map([['private-session', [tag]]]);
  await primaryTags.saveSessionTags(scopedTags, SCOPE_A);
  assert.deepEqual(await primaryTags.loadSessionTags(SCOPE_A), scopedTags, 'the exact owner can round-trip primary tags');
  assert.equal((await primaryTags.loadSessionTags(SCOPE_B)).size, 0, 'another user cannot read primary tags');
  assert.equal((await primaryTags.loadSessionTags(SCOPE_OTHER_CIRCLE)).size, 0, 'another circle cannot read primary tags');
  assert.equal((await primaryTags.loadSessionTags()).has('legacy-session'), true, 'a scoped write does not rewrite the ownerless key');

  const primaryKey = primaryTags.officeSessionTagsStorageKey(SCOPE_A)!;
  const primaryEnvelope = JSON.parse(localValues.get(primaryKey)!);
  assert.equal(primaryEnvelope.userId, USER_A, 'the tag envelope repeats its authenticated owner identity');
  assert.equal(primaryEnvelope.circleId, CIRCLE_A, 'the tag envelope repeats its circle identity');
  localValues.set(primaryKey, JSON.stringify({ ...primaryEnvelope, userId: USER_B }));
  assert.equal((await primaryTags.loadSessionTags(SCOPE_A)).size, 0, 'a tampered embedded owner fails closed');
  await primaryTags.saveSessionTags(scopedTags, SCOPE_A);

  const afterAdd = await primaryTags.addSessionTag('second-session', tag, scopedTags, SCOPE_A);
  assert.equal(afterAdd.get('second-session')?.[0]?.key, tag.key, 'scoped add returns the updated exact-owner map');
  assert.equal((await primaryTags.loadTagSuggestions(SCOPE_A))[0]?.key, tag.key, 'tag suggestions use the same exact scope');
  assert.equal((await primaryTags.loadTagSuggestions(SCOPE_B)).length, 0, 'another user cannot read tag suggestions');
  const invalidAdd = await primaryTags.addSessionTag('invalid-session', tag, afterAdd, INVALID_SCOPE);
  assert.equal(invalidAdd, afterAdd, 'an invalid explicit scope does not mutate the in-memory tag map');

  const privateCache = new Map([['private-session', cachedSession('private-session', 12)]]);
  await cache.saveSessionCache(privateCache, SCOPE_A);
  assert.equal((await cache.loadSessionCache(SCOPE_A)).get('private-session')?.totalCost, 12, 'the exact owner can round-trip session cache');
  assert.equal((await cache.loadSessionCache(SCOPE_B)).size, 0, 'another user cannot read session cache');
  assert.equal((await cache.loadSessionCache(SCOPE_OTHER_CIRCLE)).size, 0, 'another circle cannot read session cache');
  assert.equal((await cache.loadSessionCache()).get('legacy-session')?.totalCost, 91, 'a scoped cache write leaves legacy compatibility data untouched');

  const cacheKey = cache.officeSessionCacheStorageKey(SCOPE_A)!;
  const cacheEnvelope = JSON.parse(localValues.get(cacheKey)!);
  localValues.set(cacheKey, JSON.stringify({ ...cacheEnvelope, circleId: CIRCLE_B }));
  assert.equal((await cache.loadSessionCache(SCOPE_A)).size, 0, 'a tampered embedded cache circle fails closed');
  await cache.saveSessionCache(privateCache, SCOPE_A);
  await cache.updateSessionCache([cachedSession('private-session', 18)], SCOPE_A);
  assert.equal((await cache.getCachedSession('private-session', SCOPE_A))?.totalCost, 18, 'scoped read-modify-write stays in the exact lane');

  const today = new Date().toISOString().slice(0, 10);
  await cache.saveDailyCosts([{ date: today, costs: { private: 2 }, tokens: { private: 20 } }], SCOPE_A);
  assert.equal(await cache.getDailyCost(today, 'private', SCOPE_A), 2, 'daily-cost reads use the exact scope');
  assert.equal(await cache.getDailyCost(today, 'private', SCOPE_B), 0, 'another user cannot hydrate daily costs');

  await cache.saveSessionTags(new Map([['private-session', [tag]]]), SCOPE_A);
  assert.equal((await cache.loadSessionTags(SCOPE_A)).has('private-session'), true, 'the tag backup uses the exact scope');
  assert.equal((await cache.loadSessionTags(SCOPE_B)).size, 0, 'another user cannot hydrate the tag backup');

  const writesBeforeInvalid = new Set(localValues.keys());
  await primaryTags.saveSessionTags(scopedTags, INVALID_SCOPE);
  await cache.saveSessionCache(privateCache, INVALID_SCOPE);
  await cache.saveDailyCosts([], INVALID_SCOPE);
  await cache.saveSessionTags(scopedTags, INVALID_SCOPE);
  assert.deepEqual(new Set(localValues.keys()), writesBeforeInvalid, 'invalid explicit scopes create no storage namespaces');

  await cache.clearSessionCache(SCOPE_A);
  assert.equal((await cache.loadSessionCache(SCOPE_A)).size, 0, 'scoped clear removes only the exact cache value');
  assert.equal((await cache.loadSessionCache()).has('legacy-session'), true, 'scoped clear cannot erase ownerless compatibility data');

  console.log('office-session-storage-scope smoketest: all assertions passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
