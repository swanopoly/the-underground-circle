import assert from 'node:assert/strict';
import {
  FURNITURE_CATALOG,
  OFFICE_ADDON_TYPES,
  isInteractiveFurniture,
  type FurnitureItem,
  type FurnitureType,
  type OfficeFloor,
} from '../src/lib/officeConfig';
import {
  OFFICE_ROOM_KITS,
  OFFICE_ADDON_PREFERENCE_LIMITS,
  OFFICE_ROOM_KIT_PLACEMENT_LIMITS,
  applyOfficeRoomKit,
  buildOfficeOAuthWidgetReset,
  buildOfficeAddonCatalogRuntimeByType,
  commitOfficeEditorSnapshot,
  createOfficeEditorHistory,
  getOfficeEditorHistoryAvailability,
  isOfficeServiceAsyncScopeCurrent,
  mergeOfficeAddonCatalogPreferences,
  mergeOfficeEditorFurnitureState,
  normalizeOfficeAddonCatalogPreferences,
  parseOfficeAddonCatalogPreferences,
  planOfficeRoomKit,
  queryOfficeAddonCatalog,
  recordOfficeAddonRecentType,
  redoOfficeEditorHistory,
  serializeOfficeAddonCatalogPreferences,
  setOfficeAddonFavorite,
  summarizeOfficeAddonStatuses,
  undoOfficeEditorHistory,
  type OfficeRoomKitTemplate,
} from '../src/lib/officeAddonExperienceCore';
import {
  createOfficeLayoutLocalWriteQueue,
  officeLayoutLocalCacheKey,
  readOfficeLayoutLocalCacheEnvelope,
  serializeOfficeLayoutLocalCacheEnvelope,
  writeVerifiedOfficeLayoutLocalCache,
} from '../src/lib/officeLayoutLocalCache';

const emptyPreferences = parseOfficeAddonCatalogPreferences(null);

const oauthScopeA = {
  generation: 1,
  circleId: 'circle-a',
  floorId: 'floor-a',
  targetId: 'calendar-a',
  serviceType: 'calendar_widget',
  provider: 'google',
};
const oauthScopeB = {
  ...oauthScopeA,
  generation: 2,
  targetId: 'email-b',
  serviceType: 'email_hub',
};
assert.equal(
  isOfficeServiceAsyncScopeCurrent(oauthScopeA, { ...oauthScopeA, modalVisible: true }),
  true,
  'current service request may update its exact modal target',
);
for (const [label, current] of [
  ['newer generation', { ...oauthScopeA, generation: 2, modalVisible: true }],
  ['closed modal', { ...oauthScopeA, modalVisible: false }],
  ['different circle', { ...oauthScopeA, circleId: 'circle-b', modalVisible: true }],
  ['different floor', { ...oauthScopeA, floorId: 'floor-b', modalVisible: true }],
  ['different target', { ...oauthScopeA, targetId: 'calendar-b', modalVisible: true }],
  ['different service', { ...oauthScopeA, serviceType: 'email_hub', modalVisible: true }],
  ['different provider', { ...oauthScopeA, provider: 'microsoft', modalVisible: true }],
] as const) {
  assert.equal(
    isOfficeServiceAsyncScopeCurrent(oauthScopeA, current),
    false,
    `stale OAuth result cannot update a ${label}`,
  );
}
const outOfOrderResults = [
  { scope: oauthScopeB, value: 'new status' },
  { scope: oauthScopeA, value: 'old status' },
].filter(({ scope }) => isOfficeServiceAsyncScopeCurrent(scope, { ...oauthScopeB, modalVisible: true }));
assert.deepEqual(
  outOfOrderResults.map(({ value }) => value),
  ['new status'],
  'an older out-of-order provider response cannot overwrite the current item',
);
assert.deepEqual(
  buildOfficeOAuthWidgetReset({
    serviceType: 'calendar_widget',
    providerValue: 'outlook',
    connected: true,
  }),
  {
    calendarProvider: 'outlook',
    calendarEvent: 'Refresh calendar',
    calendarTime: '',
    calendarEvents: 0,
    dataState: 'stale',
    dataUpdatedAt: undefined,
  },
  'switching to a connected calendar provider clears the previous provider payload until a fresh read',
);
assert.deepEqual(
  buildOfficeOAuthWidgetReset({
    serviceType: 'email_hub',
    providerValue: 'outlook',
    connected: true,
  }),
  {
    emailProvider: 'outlook',
    emailConnected: true,
    emailSender: undefined,
    emailSubject: undefined,
    emailTime: undefined,
    emailUnread: 0,
    dataState: 'stale',
    dataUpdatedAt: undefined,
  },
  'switching to a connected email provider clears the previous payload and remains explicitly refreshable',
);
assert.deepEqual(
  buildOfficeOAuthWidgetReset({
    serviceType: 'email_hub',
    providerValue: 'gmail',
    connected: false,
  }),
  {
    emailProvider: 'gmail',
    emailConnected: false,
    emailSender: undefined,
    emailSubject: undefined,
    emailTime: undefined,
    emailUnread: 0,
    dataState: 'setup',
    dataUpdatedAt: undefined,
  },
  'a disconnected email provider cannot retain content or live timestamps',
);

assert.deepEqual(emptyPreferences, { version: 1, favoriteTypes: [], recentTypes: [] }, 'missing storage starts empty');
assert.deepEqual(parseOfficeAddonCatalogPreferences('{bad json'), emptyPreferences, 'malformed storage fails closed');
assert.deepEqual(
  parseOfficeAddonCatalogPreferences(JSON.stringify({ version: 999, favoriteTypes: ['desk'] })),
  emptyPreferences,
  'unknown preference versions fail closed',
);

const normalizedPreferences = normalizeOfficeAddonCatalogPreferences({
  favoriteTypes: ['plant', 'not_a_real_addon', 'desk', 'plant'],
  recentTypes: ['desk', 'plant', 'desk', '__proto__'],
});
assert.deepEqual(normalizedPreferences.favoriteTypes, ['desk', 'plant'], 'favorites are valid, unique, and canonically ordered');
assert.deepEqual(normalizedPreferences.recentTypes, ['desk', 'plant'], 'recents are valid, unique, and preserve first-seen order');

const serializedPreferences = serializeOfficeAddonCatalogPreferences({
  version: 1,
  favoriteTypes: ['plant', 'desk'],
  recentTypes: ['plant', 'desk'],
});
assert.equal(
  serializedPreferences,
  serializeOfficeAddonCatalogPreferences({ favoriteTypes: ['desk', 'plant'], recentTypes: ['plant', 'desk'] }),
  'equivalent preferences serialize deterministically',
);
assert.deepEqual(parseOfficeAddonCatalogPreferences(serializedPreferences), {
  version: 1,
  favoriteTypes: ['desk', 'plant'],
  recentTypes: ['plant', 'desk'],
}, 'serialized preferences round-trip through storage');
assert.deepEqual(
  parseOfficeAddonCatalogPreferences('x'.repeat(OFFICE_ADDON_PREFERENCE_LIMITS.serializedCharacters + 1)),
  emptyPreferences,
  'oversized storage fails closed before parsing',
);

const favoritedPreferences = setOfficeAddonFavorite(emptyPreferences, 'plant', true);
assert.deepEqual(favoritedPreferences.favoriteTypes, ['plant'], 'favorite helper adds an explicit favorite');
assert.deepEqual(setOfficeAddonFavorite(favoritedPreferences, 'plant', true), favoritedPreferences, 'explicit favorite is idempotent');
assert.deepEqual(setOfficeAddonFavorite(favoritedPreferences, 'plant', false).favoriteTypes, [], 'favorite helper removes a favorite');
assert.deepEqual(
  mergeOfficeAddonCatalogPreferences(
    { favoriteTypes: ['desk'], recentTypes: ['desk', 'plant'] },
    { favoriteTypes: ['plant'], recentTypes: ['whiteboard', 'desk'] },
  ),
  { version: 1, favoriteTypes: ['desk', 'plant'], recentTypes: ['whiteboard', 'desk', 'plant'] },
  'early same-scope actions merge with a persisted preference snapshot without losing recency',
);

const localLayoutFloor: OfficeFloor = {
  id: 'floor-cache',
  name: 'Private Cache',
  themeId: 'underground',
  order: 0,
  agentIds: [],
  furniture: [],
};
const localLayoutSerialized = serializeOfficeLayoutLocalCacheEnvelope({
  userId: 'user-a',
  circleId: 'circle-a',
  floors: [localLayoutFloor],
  currentFloorId: localLayoutFloor.id,
  updatedAt: 42,
});
assert(localLayoutSerialized, 'valid local layout cache serializes atomically');
assert.equal(officeLayoutLocalCacheKey('user-a', 'circle-a'), '@office_layout_cache_v2:user-a:circle-a', 'local layout cache key binds both owners');
assert.equal(readOfficeLayoutLocalCacheEnvelope(localLayoutSerialized, 'user-b', 'circle-a'), null, 'foreign user cache fails closed');
assert.equal(readOfficeLayoutLocalCacheEnvelope(localLayoutSerialized, 'user-a', 'circle-b'), null, 'foreign circle cache fails closed');
assert.equal(readOfficeLayoutLocalCacheEnvelope('{bad json', 'user-a', 'circle-a'), null, 'torn local cache fails closed');
assert.equal(readOfficeLayoutLocalCacheEnvelope(localLayoutSerialized, 'user-a', 'circle-a')?.updatedAt, 42, 'owned atomic cache round-trips');
const localCacheVerificationPromise = (async () => {
  const memoryStorage = new Map<string, string>();
  assert.equal(await writeVerifiedOfficeLayoutLocalCache({
    async setItem(key, value) { memoryStorage.set(key, value); },
    async getItem(key) { return memoryStorage.get(key) || null; },
  }, {
    userId: 'user-a', circleId: 'circle-a', floors: [localLayoutFloor], currentFloorId: localLayoutFloor.id, updatedAt: 43,
  }), true, 'local layout cache verifies its exact write');
  assert.equal(await writeVerifiedOfficeLayoutLocalCache({
    async setItem() {},
    async getItem() { return null; },
  }, {
    userId: 'user-a', circleId: 'circle-a', floors: [localLayoutFloor], currentFloorId: localLayoutFloor.id, updatedAt: 44,
  }), false, 'silent storage loss never becomes verified local backup');
  const divergentSameVersion = serializeOfficeLayoutLocalCacheEnvelope({
    userId: 'user-a',
    circleId: 'circle-a',
    floors: [{ ...localLayoutFloor, name: 'Divergent Cache' }],
    currentFloorId: localLayoutFloor.id,
    updatedAt: 45,
  });
  assert.equal(await writeVerifiedOfficeLayoutLocalCache({
    async setItem() {},
    async getItem() { return divergentSameVersion; },
  }, {
    userId: 'user-a', circleId: 'circle-a', floors: [localLayoutFloor], currentFloorId: localLayoutFloor.id, updatedAt: 45,
  }), false, 'same-version divergent local content is never reported as an exact verified backup');

  const orderedEvents: string[] = [];
  const orderedStorage = new Map<string, string>();
  let releaseFirstWrite!: () => void;
  const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  const writeQueue = createOfficeLayoutLocalWriteQueue({
    async setItem(key, value) {
      const version = JSON.parse(value).updatedAt;
      orderedEvents.push(`set:${version}`);
      if (version === 46) await firstWriteGate;
      orderedStorage.set(key, value);
    },
    async getItem(key) {
      const value = orderedStorage.get(key) || null;
      orderedEvents.push(`get:${value ? JSON.parse(value).updatedAt : 'none'}`);
      return value;
    },
  });
  const firstQueuedWrite = writeQueue.enqueue({
    userId: 'user-a', circleId: 'circle-a', floors: [localLayoutFloor], currentFloorId: localLayoutFloor.id, updatedAt: 46,
  });
  const secondQueuedWrite = writeQueue.enqueue({
    userId: 'user-a', circleId: 'circle-a', floors: [localLayoutFloor], currentFloorId: localLayoutFloor.id, updatedAt: 47,
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(orderedEvents, ['set:46'], 'a newer local write waits for the older exact write to finish');
  releaseFirstWrite();
  assert.deepEqual(await Promise.all([firstQueuedWrite, secondQueuedWrite]), [true, true]);
  assert.deepEqual(
    orderedEvents,
    ['set:46', 'get:46', 'set:47', 'get:47'],
    'local layout writes and read-back verification run in strict request order',
  );
})();

let recentPreferences = emptyPreferences;
for (const type of OFFICE_ADDON_TYPES) recentPreferences = recordOfficeAddonRecentType(recentPreferences, type);
assert.equal(
  recentPreferences.recentTypes.length,
  OFFICE_ADDON_PREFERENCE_LIMITS.recentTypes,
  'recent history stays within its persistence bound',
);
assert.equal(recentPreferences.recentTypes[0], OFFICE_ADDON_TYPES.at(-1), 'newly used item moves to the front');
recentPreferences = recordOfficeAddonRecentType(recentPreferences, recentPreferences.recentTypes[4]);
assert.equal(recentPreferences.recentTypes[0], OFFICE_ADDON_TYPES.at(-5), 'reusing an item moves it to the front without a duplicate');
assert.equal(new Set(recentPreferences.recentTypes).size, recentPreferences.recentTypes.length, 'bounded recents contain no duplicates');

const canonicalRuntime = buildOfficeAddonCatalogRuntimeByType([
  { type: 'calendar_widget', dataState: 'live' },
  { type: 'calendar_widget', dataState: 'setup' },
  { type: 'tv', dataState: 'live', dataUpdatedAt: 1_000 },
], { nowMs: 2_000, staleAfterMs: 5_000 });
assert.equal(canonicalRuntime.calendar_widget?.status, 'stale', 'a live integration without refresh evidence is stale in the catalog');
assert.equal(canonicalRuntime.tv?.status, 'decorative', 'decorative items cannot become live through saved state');

const interactiveTypes = FURNITURE_CATALOG
  .filter((entry) => isInteractiveFurniture(entry.type))
  .map((entry) => entry.type);

const catalogView = queryOfficeAddonCatalog(FURNITURE_CATALOG, {
  searchText: 'repository activity',
  favoriteTypes: ['github_feed'],
  recentTypes: ['calendar_widget', 'github_feed'],
  interactiveTypes,
  metadataByType: {
    github_feed: { tags: ['repository', 'pull requests', 'commits'], primaryAction: 'Open repository activity' },
  },
  runtimeByType: {
    github_feed: { status: 'ready', detail: 'Connected to circle/repo', updatedAt: 1_000, staleAfterMs: 5_000 },
  },
  nowMs: 7_000,
});
assert.equal(catalogView.length, 1, 'token search returns the matching addon only');
assert.equal(catalogView[0].entry.type, 'github_feed', 'search includes metadata tags and primary action');
assert.equal(catalogView[0].kind, 'connected', 'connected category has connected kind');
assert.equal(catalogView[0].status, 'stale', 'ready runtime state ages to stale deterministically');
assert.equal(catalogView[0].favorite, true, 'favorite state is surfaced');
assert.equal(catalogView[0].recentRank, 1, 'recent rank follows caller order');
assert.equal(catalogView[0].statusDetail, 'Connected to circle/repo', 'bounded status detail is preserved');

const readyConnected = queryOfficeAddonCatalog(FURNITURE_CATALOG, {
  categories: ['connected'],
  statuses: ['ready'],
  runtimeByType: {
    calendar_widget: { status: 'ready', updatedAt: 10_000, staleAfterMs: 60_000 },
  },
  nowMs: 20_000,
});
assert.deepEqual(readyConnected.map((item) => item.entry.type), ['calendar_widget'], 'status filter hides setup-required integrations');

const canonicalMetadataView = queryOfficeAddonCatalog(FURNITURE_CATALOG, {
  searchText: 'github integration demo refresh',
});
assert.equal(canonicalMetadataView[0]?.entry.type, 'github_feed', 'search consumes canonical catalog tags and primary action');
assert.equal(canonicalMetadataView[0]?.primaryAction, 'refresh', 'canonical primary action is surfaced without an override map');
assert.equal(canonicalMetadataView[0]?.status, 'demo', 'canonical demo data state remains truthful');
assert.equal(
  queryOfficeAddonCatalog(FURNITURE_CATALOG, { searchText: 'calendar', statuses: ['setup_required'] })[0]?.entry.type,
  'calendar_widget',
  'canonical setup-required readiness becomes a setup status',
);
assert.equal(
  queryOfficeAddonCatalog(FURNITURE_CATALOG, { searchText: 'plant', statuses: ['decorative'] })[0]?.entry.type,
  'plant',
  'canonical decorative readiness becomes a decorative status',
);
assert.equal(
  queryOfficeAddonCatalog(FURNITURE_CATALOG, { searchText: 'dice roller', kinds: ['interactive'] })[0]?.entry.type,
  'dice_roller',
  'canonical interactive metadata drives the coarse interactive kind',
);

const favoritesFirst = queryOfficeAddonCatalog(FURNITURE_CATALOG, {
  favoriteTypes: ['plant'],
  recentTypes: ['desk', 'plant'],
  interactiveTypes,
  limit: 3,
});
assert.equal(favoritesFirst[0].entry.type, 'plant', 'favorites sort ahead of recents without a text query');
assert.equal(favoritesFirst[1].entry.type, 'desk', 'recent order follows favorites');
const catalogSummary = summarizeOfficeAddonStatuses(favoritesFirst);
assert.equal(catalogSummary.total, 3, 'summary counts bounded results');
assert.equal(catalogSummary.favorites, 1, 'summary counts favorites');
assert.equal(catalogSummary.recentlyUsed, 2, 'summary counts recent items');

const restoredConfiguredItem = mergeOfficeEditorFurnitureState(
  [{ id: 'tv-new', type: 'smart_tv', x: 16, y: 208, dataState: 'setup' }],
  [{ id: 'tv-new', type: 'smart_tv', x: 400, y: 500, dataState: 'local', tvContentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
)[0];
assert.equal(restoredConfiguredItem.x, 16, 'redo restores the snapshot layout position');
assert.equal(restoredConfiguredItem.y, 208, 'redo restores the snapshot layout row');
assert.equal(restoredConfiguredItem.dataState, 'local', 'redo retains newer non-layout truth state from the tombstone cache');
assert.equal(restoredConfiguredItem.tvContentUrl, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'redo retains configuration added after placement');

const initialFloor: OfficeFloor = {
  id: 'floor-a',
  name: 'Build Deck',
  themeId: 'cyber',
  order: 0,
  agentIds: ['agent-a'],
  furniture: [{ id: 'desk-a', type: 'desk', x: 16, y: 208 }],
};
let history = createOfficeEditorHistory(initialFloor, { limit: 3, label: 'Initial floor' });
assert(history, 'valid floor creates history');
initialFloor.furniture[0].x = 800;
assert.equal(history!.present.floor.furniture[0].x, 16, 'history detaches the initial caller snapshot');

function floorAt(x: number, id = 'desk-a'): OfficeFloor {
  return {
    ...history!.present.floor,
    furniture: [{ ...history!.present.floor.furniture[0], id, x }],
  };
}

history = commitOfficeEditorSnapshot(history!, floorAt(32), 'Move desk');
assert(history, 'valid edit commits');
history = commitOfficeEditorSnapshot(history!, floorAt(48), 'Move desk again');
history = commitOfficeEditorSnapshot(history!, floorAt(64), 'Move desk third');
history = commitOfficeEditorSnapshot(history!, floorAt(80), 'Move desk fourth');
assert.equal(history!.past.length, 3, 'history truncates to its configured bound');
const noOp = commitOfficeEditorSnapshot(history!, history!.present.floor, 'Duplicate render');
assert.equal(noOp, history, 'identical snapshots do not pollute history');

history = undoOfficeEditorHistory(history!);
assert.equal(history.present.floor.furniture[0].x, 64, 'undo restores the preceding floor');
assert.deepEqual(getOfficeEditorHistoryAvailability(history), {
  canUndo: true,
  canRedo: true,
  undoLabel: 'Move desk third',
  redoLabel: 'Move desk fourth',
}, 'history exposes truthful undo and redo labels');
history = redoOfficeEditorHistory(history);
assert.equal(history.present.floor.furniture[0].x, 80, 'redo restores the later floor');
history = undoOfficeEditorHistory(history);
history = commitOfficeEditorSnapshot(history, floorAt(96, 'desk-branch'), 'Branch edit')!;
assert.equal(history.future.length, 0, 'committing after undo clears the redo branch');

const knownTypes = new Set(FURNITURE_CATALOG.map((entry) => entry.type));
assert.equal(OFFICE_ROOM_KITS.length, 5, 'five focused built-in room kits are available');
for (const kit of OFFICE_ROOM_KITS) {
  assert(kit.items.length >= 5, `${kit.id} contains a useful group of items`);
  assert(kit.items.every((item) => knownTypes.has(item.type)), `${kit.id} only uses canonical furniture types`);
}

const sourceFloor: OfficeFloor = {
  id: 'floor-kit',
  name: 'Kit Floor',
  themeId: 'office',
  order: 2,
  agentIds: ['agent-a', 'agent-b'],
  furniture: [{ id: 'kit_seed_agent_ops_0', type: 'desk', x: 16, y: 208 }],
};
const kitInput = {
  floor: sourceFloor,
  kit: 'agent_ops' as const,
  catalog: FURNITURE_CATALOG,
  idSeed: 'seed',
  origin: { x: 880, y: 960 },
  bounds: { width: 900, height: 970, padding: 16, gridSize: 16 },
};
const applied = applyOfficeRoomKit(kitInput);
assert(applied, 'valid room kit applies');
assert.equal(sourceFloor.furniture.length, 1, 'room-kit application does not mutate the source floor');
assert.equal(applied!.floor.id, sourceFloor.id, 'room kit preserves floor identity');
assert.deepEqual(applied!.floor.agentIds, sourceFloor.agentIds, 'room kit preserves assigned agents');
assert.equal(applied!.floor.furniture.length, 1 + OFFICE_ROOM_KITS[0].items.length, 'room kit appends every item');
assert.equal(applied!.clamped, true, 'out-of-bounds origin is reported as clamped');
assert.equal(new Set(applied!.addedItemIds).size, applied!.addedItemIds.length, 'fresh ids are unique');
assert(!applied!.addedItemIds.includes('kit_seed_agent_ops_0'), 'fresh ids avoid existing floor collisions');

const catalogSizes = new Map<FurnitureType, { width: number; height: number }>(
  FURNITURE_CATALOG.map((entry) => [entry.type, { width: entry.width, height: entry.height }]),
);
for (const item of applied!.floor.furniture.slice(1) as FurnitureItem[]) {
  const size = catalogSizes.get(item.type)!;
  assert(item.x >= 16 && item.y >= 16, `${item.type} respects floor padding`);
  assert(item.x + size.width <= 900 - 16, `${item.type} stays within floor width`);
  assert(item.y + size.height <= 970 - 16, `${item.type} stays within floor height`);
  assert.equal(item.x % 16, 0, `${item.type} x position snaps to grid`);
  assert.equal(item.y % 16, 0, `${item.type} y position snaps to grid`);
}

const appliedAgain = applyOfficeRoomKit(kitInput);
assert.deepEqual(appliedAgain!.addedItemIds, applied!.addedItemIds, 'same seed and floor produce deterministic fresh ids');
assert.deepEqual(
  appliedAgain!.floor.furniture.slice(1).map((item) => ({ type: item.type, x: item.x, y: item.y })),
  applied!.floor.furniture.slice(1).map((item) => ({ type: item.type, x: item.x, y: item.y })),
  'same inputs produce deterministic bounded placement',
);
const capacityPlan = planOfficeRoomKit({ ...kitInput, maxFurniture: 3 });
assert.equal(capacityPlan.ok, false, 'room-kit planner rejects a capacity overflow');
if (!capacityPlan.ok) assert.equal(capacityPlan.reason, 'capacity', 'capacity failures remain machine actionable');
assert.equal(applyOfficeRoomKit({ ...kitInput, maxFurniture: 3 }), null, 'compatibility wrapper fails closed on capacity overflow');
assert.equal(applyOfficeRoomKit({ ...kitInput, idSeed: '' }), null, 'room kit fails closed without a deterministic id seed');

const collisionFloor: OfficeFloor = {
  ...sourceFloor,
  furniture: [{ id: 'blocking-desk', type: 'desk', x: 16, y: 16 }],
};
const collisionInput = {
  ...kitInput,
  floor: collisionFloor,
  origin: { x: 16, y: 16 },
};
const collisionFloorBefore = JSON.stringify(collisionFloor);
const collisionPlan = planOfficeRoomKit(collisionInput);
assert.equal(collisionPlan.ok, true, 'planner finds another grid region when the requested origin is occupied');
assert.equal(JSON.stringify(collisionFloor), collisionFloorBefore, 'planning does not mutate the source floor');
if (collisionPlan.ok) {
  assert.notDeepEqual(collisionPlan.application.origin, collisionInput.origin, 'occupied requested origin is not reused');
  assert.equal(collisionPlan.usedRequestedOrigin, false, 'preview identifies an adjusted origin');
  assert(collisionPlan.scannedPositions > 1, 'planner reports the bounded search work');
  const blocker = { x: 16, y: 16, width: catalogSizes.get('desk')!.width, height: catalogSizes.get('desk')!.height };
  for (const item of collisionPlan.application.floor.furniture.slice(1)) {
    const size = catalogSizes.get(item.type)!;
    const overlapsBlocker = item.x < blocker.x + blocker.width
      && item.x + (item.itemWidth || size.width) > blocker.x
      && item.y < blocker.y + blocker.height
      && item.y + (item.itemHeight || size.height) > blocker.y;
    assert.equal(overlapsBlocker, false, `${item.type} avoids existing furniture`);
  }
}
assert.deepEqual(
  planOfficeRoomKit(collisionInput),
  collisionPlan,
  'collision-aware planning is deterministic for identical inputs',
);

const singleDeskKit: OfficeRoomKitTemplate = {
  id: 'focus_lab',
  name: 'Single desk',
  description: 'Test-only valid room-kit shape.',
  items: [{ type: 'desk', offsetX: 0, offsetY: 0 }],
};
const exactOriginPlan = planOfficeRoomKit({
  floor: { ...sourceFloor, furniture: [] },
  kit: singleDeskKit,
  catalog: FURNITURE_CATALOG,
  idSeed: 'exact-origin',
  origin: { x: 16, y: 16 },
  bounds: { width: 300, height: 200, padding: 16, gridSize: 16 },
});
assert.equal(exactOriginPlan.ok, true, 'an open requested grid position succeeds immediately');
if (exactOriginPlan.ok) {
  assert.equal(exactOriginPlan.usedRequestedOrigin, true, 'exact requested origin is reported truthfully');
  assert.equal(exactOriginPlan.application.clamped, false, 'exact placement needs no snap or clamp');
  assert.equal(exactOriginPlan.scannedPositions, 1, 'exact open origin requires one collision check');
}
const noFreePlan = planOfficeRoomKit({
  floor: {
    ...sourceFloor,
    furniture: [{ id: 'only-region-blocker', type: 'desk', x: 16, y: 16 }],
  },
  kit: singleDeskKit,
  catalog: FURNITURE_CATALOG,
  idSeed: 'no-free',
  origin: { x: 16, y: 16 },
  bounds: { width: 132, height: 82, padding: 16, gridSize: 16 },
});
assert.equal(noFreePlan.ok, false, 'fully occupied valid bounds fail before application');
if (!noFreePlan.ok) {
  assert.equal(noFreePlan.reason, 'no_free_region', 'an exhaustive occupied scan reports no_free_region');
  assert.equal(noFreePlan.scannedPositions, 1, 'the single admissible candidate is checked exactly once');
}

const scanLimitedPlan = planOfficeRoomKit({
  ...collisionInput,
  kit: singleDeskKit,
  scanLimit: 1,
});
assert.equal(scanLimitedPlan.ok, false, 'a deliberately tiny scan bound fails closed');
if (!scanLimitedPlan.ok) {
  assert.equal(scanLimitedPlan.reason, 'scan_limit', 'bounded partial searches do not claim no free region');
  assert.equal(scanLimitedPlan.scannedPositions, 1, 'caller scan limit is enforced exactly');
  assert(scanLimitedPlan.scannedPositions <= OFFICE_ROOM_KIT_PLACEMENT_LIMITS.maxScanPositions, 'scan never exceeds the runtime cap');
}

const rotatedDeskKit: OfficeRoomKitTemplate = {
  id: 'focus_lab',
  name: 'Rotated desk',
  description: 'Test-only rotation footprint.',
  items: [{ type: 'desk', offsetX: 0, offsetY: 0, rotation: 90 }],
};
const rotatedCollisionPlan = planOfficeRoomKit({
  floor: {
    ...sourceFloor,
    furniture: [{ id: 'rotation-blocker', type: 'coffee', x: 50, y: 105 }],
  },
  kit: rotatedDeskKit,
  catalog: FURNITURE_CATALOG,
  idSeed: 'rotated',
  origin: { x: 16, y: 48 },
  bounds: { width: 500, height: 300, padding: 16, gridSize: 16 },
});
assert.equal(rotatedCollisionPlan.ok, true, 'a rotated kit item still finds collision-free placement');
if (rotatedCollisionPlan.ok) {
  assert.notDeepEqual(
    rotatedCollisionPlan.application.origin,
    { x: 16, y: 48 },
    'rotation-aware bounds detect a blocker outside the unrotated rectangle',
  );
}

const emptyTemplate: OfficeRoomKitTemplate = {
  id: 'review_room',
  name: 'Empty',
  description: 'Invalid test template.',
  items: [],
};
const invalidTemplatePlan = planOfficeRoomKit({ ...kitInput, kit: emptyTemplate });
assert.equal(invalidTemplatePlan.ok, false, 'empty custom templates fail closed');
if (!invalidTemplatePlan.ok) assert.equal(invalidTemplatePlan.reason, 'invalid_template');

const overlappingTemplate: OfficeRoomKitTemplate = {
  id: 'review_room',
  name: 'Overlapping',
  description: 'Invalid test template.',
  items: [
    { type: 'desk', offsetX: 0, offsetY: 0 },
    { type: 'desk', offsetX: 16, offsetY: 0 },
  ],
};
const overlappingTemplateBefore = JSON.stringify(overlappingTemplate);
const overlappingPlan = planOfficeRoomKit({ ...kitInput, kit: overlappingTemplate });
assert.equal(overlappingPlan.ok, false, 'internally overlapping templates fail before scanning');
assert.equal(JSON.stringify(overlappingTemplate), overlappingTemplateBefore, 'invalid-template planning does not mutate the template');
if (!overlappingPlan.ok) assert.equal(overlappingPlan.reason, 'invalid_template');

const invalidBoundsPlan = planOfficeRoomKit({
  ...kitInput,
  bounds: { width: 20, height: 20, padding: 16, gridSize: 16 },
});
assert.equal(invalidBoundsPlan.ok, false, 'malformed floor bounds fail closed');
if (!invalidBoundsPlan.ok) assert.equal(invalidBoundsPlan.reason, 'invalid_bounds');

void localCacheVerificationPromise.then(() => {
  console.log('office-addon-experience-core smoketest: all assertions passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
