/**
 * Focused contract for the canonical Office addon catalog.
 *
 * Run: npm run smoke:office-addon-registry
 */
import assert from 'node:assert/strict';
import {
  FURNITURE_CATALOG,
  OFFICE_ADDON_BY_TYPE,
  OFFICE_ADDON_TYPES,
  getOfficeAddonDefinition,
  getOfficeAddonRuntimeState,
  getOfficeAddonRuntimeStateLabel,
  getOfficeYouTubeEmbedUrl,
  isOfficeAddonType,
  isInteractiveFurniture,
  type FurnitureItem,
} from '../src/lib/officeConfig';

const catalogTypes = FURNITURE_CATALOG.map((entry) => entry.type);
const expectedTypes = [...OFFICE_ADDON_TYPES];

assert.equal(new Set(expectedTypes).size, expectedTypes.length, 'canonical addon type list is unique');
assert.equal(new Set(catalogTypes).size, catalogTypes.length, 'catalog type list is unique');
assert.deepEqual(
  [...catalogTypes].sort(),
  [...expectedTypes].sort(),
  'catalog has exactly one definition for every FurnitureType',
);
assert.equal(Object.keys(OFFICE_ADDON_BY_TYPE).length, expectedTypes.length, 'type lookup is exhaustive');
assert.equal(isOfficeAddonType('desk'), true, 'canonical type guard accepts registered addons');
assert.equal(isOfficeAddonType('removed_addon'), false, 'canonical type guard rejects removed addons');
assert.equal(getOfficeAddonDefinition('removed_addon' as any), undefined, 'unknown lookup fails safely without dereferencing undefined');
assert.equal(isInteractiveFurniture('removed_addon' as any), false, 'unknown addons never claim an action');

for (const [url, expected] of [
  ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1'],
  ['https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&mute=1'],
] as const) {
  assert.equal(getOfficeYouTubeEmbedUrl(url), expected, `${url} canonicalizes to an owned embed URL`);
}
for (const url of [
  'http://youtube.com/watch?v=dQw4w9WgXcQ',
  'https://youtube.com.evil.test/embed/dQw4w9WgXcQ',
  'https://evil.test/youtube.com/embed/dQw4w9WgXcQ',
  'https://youtube.com/embed/%2e%2e/dQw4w9WgXcQ',
  'https://user:pass@youtube.com/embed/dQw4w9WgXcQ',
  'https://youtube.com:444/embed/dQw4w9WgXcQ',
] as const) {
  assert.equal(getOfficeYouTubeEmbedUrl(url), null, `${url} is rejected at the media trust boundary`);
}

for (const entry of FURNITURE_CATALOG) {
  assert.equal(getOfficeAddonDefinition(entry.type), entry, `${entry.type} resolves to its canonical definition`);
  assert(entry.name.trim(), `${entry.type} has a name`);
  assert(entry.description.trim(), `${entry.type} has a description`);
  assert(entry.icon.trim(), `${entry.type} has an icon`);
  assert(entry.width > 0 && entry.height > 0, `${entry.type} has positive dimensions`);
  assert(entry.tags.length >= 4, `${entry.type} has searchable metadata tags`);
  assert.equal(new Set(entry.tags).size, entry.tags.length, `${entry.type} tags are unique`);
  assert.equal(
    entry.interactive,
    entry.primaryAction !== 'none',
    `${entry.type} interaction flag matches its primary action`,
  );
  assert.equal(
    isInteractiveFurniture(entry.type),
    entry.interactive,
    `${entry.type} interaction lookup comes from the catalog`,
  );
  assert.notEqual(entry.defaultDataState, 'live', `${entry.type} never claims live data before runtime proof`);
  if (entry.dataProvenance === 'demo') {
    assert.equal(entry.defaultDataState, 'demo', `${entry.type} identifies sample data as demo`);
  }
  if (entry.dataProvenance === 'connected' || entry.dataProvenance === 'user-provided') {
    assert.equal(entry.defaultDataState, 'setup', `${entry.type} starts in setup state`);
  }
}

const connectedEntries = FURNITURE_CATALOG.filter((entry) => entry.category === 'connected');
assert.equal(connectedEntries.length, 17, 'all connected-category entries are covered');
assert(connectedEntries.every((entry) => (
  ['connected', 'computed', 'user-provided', 'demo', 'decorative'] as const
).includes(entry.dataProvenance as never)), 'connected-category entries declare truthful provenance');
assert(
  connectedEntries.every((entry) => entry.defaultDataState !== 'live'),
  'connected-category entries cannot claim live state without runtime evidence',
);

for (const demoType of ['crypto_ticker', 'github_feed', 'music_visualizer', 'weather_station'] as const) {
  const entry = getOfficeAddonDefinition(demoType);
  assert.equal(entry.dataProvenance, 'demo', `${demoType} is explicitly classified as demo`);
  assert.equal(entry.defaultDataState, 'demo', `${demoType} renders a demo badge by default`);
}
for (const setupType of ['calendar_widget', 'email_hub', 'message_board', 'smart_tv'] as const) {
  assert.equal(getOfficeAddonDefinition(setupType).defaultDataState, 'setup', `${setupType} requires setup by default`);
}

// These assertions pin concrete drift repairs between OfficeTab's actions and
// the old hand-maintained interactive list.
for (const interactiveType of ['fireplace', 'aquarium', 'terrarium'] as const) {
  assert.equal(isInteractiveFurniture(interactiveType), true, `${interactiveType} exposes its implemented action`);
}
for (const passiveType of ['rain_window', 'scoreboard', 'status_board'] as const) {
  assert.equal(isInteractiveFurniture(passiveType), false, `${passiveType} does not advertise a missing click action`);
}

const item: Pick<FurnitureItem, 'type' | 'dataState' | 'dataUpdatedAt'> = {
  type: 'calendar_widget',
  dataState: 'live',
  dataUpdatedAt: 1_000,
};
const recent = getOfficeAddonRuntimeState(item, { nowMs: 1_500, staleAfterMs: 1_000 });
assert.equal(recent.state, 'live', 'fresh runtime evidence stays live');
assert.equal(recent.label, 'Live', 'fresh runtime evidence has a truthful label');
const stale = getOfficeAddonRuntimeState(item, { nowMs: 2_001, staleAfterMs: 1_000 });
assert.equal(stale.state, 'stale', 'expired runtime evidence becomes stale');
assert.equal(stale.label, 'Update needed', 'stale runtime evidence has recovery-oriented copy');
assert.equal(item.dataState, 'live', 'runtime resolver is pure and does not mutate input');
assert.equal(
  getOfficeAddonRuntimeState({ type: 'crypto_ticker' }).label,
  'Demo data',
  'default demo state is user visible',
);
assert.equal(
  getOfficeAddonRuntimeState({ type: 'email_hub', dataState: 'error' }).label,
  'Unavailable',
  'explicit runtime errors override defaults',
);
assert.equal(getOfficeAddonRuntimeStateLabel('setup'), 'Setup needed', 'state label helper is stable');

console.log(`office-addon-registry smoketest: ${FURNITURE_CATALOG.length} addons passed`);
