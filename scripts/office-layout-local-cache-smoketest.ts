import assert from 'node:assert/strict';
import type { OfficeFloor } from '../src/lib/officeConfig';
import {
  OFFICE_LAYOUT_LOCAL_CACHE_VERSION,
  createOfficeLayoutLocalWriteQueue,
  officeLayoutLocalCacheKey,
  isUsableOfficeLayoutVersion,
  readOfficeLayoutLocalCacheEnvelope,
  serializeOfficeLayoutLocalCacheEnvelope,
  writeVerifiedOfficeLayoutLocalCache,
} from '../src/lib/officeLayoutLocalCache';

async function main(): Promise<void> {
const floor: OfficeFloor = {
  id: 'floor-cache',
  name: 'Private Cache',
  themeId: 'underground',
  order: 0,
  agentIds: [],
  furniture: [],
};

const input = (updatedAt: number, name = floor.name) => ({
  userId: 'user-a',
  circleId: 'circle-a',
  floors: [{ ...floor, name }],
  currentFloorId: floor.id,
  updatedAt,
});

const versionBase = Date.now();
const serialized = serializeOfficeLayoutLocalCacheEnvelope(input(versionBase + 41));
assert(serialized, 'a valid owned layout serializes');
assert.equal(officeLayoutLocalCacheKey('user-a', 'circle-a'), '@office_layout_cache_v2:user-a:circle-a');
assert.equal(readOfficeLayoutLocalCacheEnvelope(serialized, 'user-b', 'circle-a'), null, 'another user cannot hydrate the cache');
assert.equal(readOfficeLayoutLocalCacheEnvelope(serialized, 'user-a', 'circle-b'), null, 'another circle cannot hydrate the cache');
assert.equal(readOfficeLayoutLocalCacheEnvelope('{bad json', 'user-a', 'circle-a'), null, 'torn JSON fails closed');
assert.equal(
  readOfficeLayoutLocalCacheEnvelope(JSON.stringify({ ...JSON.parse(serialized), schemaVersion: OFFICE_LAYOUT_LOCAL_CACHE_VERSION + 1 }), 'user-a', 'circle-a'),
  null,
  'an unsupported envelope version fails closed',
);
assert.equal(readOfficeLayoutLocalCacheEnvelope(serialized, 'user-a', 'circle-a')?.updatedAt, versionBase + 41, 'the exact owned envelope round-trips');
assert.equal(isUsableOfficeLayoutVersion(Number.MAX_SAFE_INTEGER, versionBase), false, 'far-future safe integers cannot poison local ordering');
assert.equal(isUsableOfficeLayoutVersion(Number.MAX_SAFE_INTEGER + 1, versionBase), false, 'unsafe layout versions fail closed');
assert.equal(
  readOfficeLayoutLocalCacheEnvelope(
    JSON.stringify({ ...JSON.parse(serialized), updatedAt: Number.MAX_SAFE_INTEGER }),
    'user-a',
    'circle-a',
  ),
  null,
  'a far-future local cache cannot reseed a repaired server row',
);

const memory = new Map<string, string>();
assert.equal(await writeVerifiedOfficeLayoutLocalCache({
  async setItem(key, value) { memory.set(key, value); },
  async getItem(key) { return memory.get(key) || null; },
}, input(versionBase + 42)), true, 'an exact write plus readback is verified');

assert.equal(await writeVerifiedOfficeLayoutLocalCache({
  async setItem() {},
  async getItem() { return serializeOfficeLayoutLocalCacheEnvelope(input(versionBase + 43, 'Divergent'))!; },
}, input(versionBase + 43)), false, 'same-version divergent content is not a verified backup');

const events: string[] = [];
const queuedMemory = new Map<string, string>();
let releaseFirst!: () => void;
const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
const queue = createOfficeLayoutLocalWriteQueue({
  async setItem(key, value) {
    const version = JSON.parse(value).updatedAt;
    events.push(`set:${version}`);
    if (version === versionBase + 44) await firstGate;
    if (version === versionBase + 45) throw new Error('simulated storage failure');
    queuedMemory.set(key, value);
  },
  async getItem(key) {
    const value = queuedMemory.get(key) || null;
    events.push(`get:${value ? JSON.parse(value).updatedAt : 'none'}`);
    return value;
  },
});

const first = queue.enqueue(input(versionBase + 44));
const failed = queue.enqueue(input(versionBase + 45));
const final = queue.enqueue(input(versionBase + 46));
await Promise.resolve();
await Promise.resolve();
assert.deepEqual(events, [`set:${versionBase + 44}`], 'the queue never overlaps a later write with an unfinished write');
releaseFirst();
assert.deepEqual(await Promise.all([first, failed, final]), [true, false, true], 'a failed write does not poison the queue');
assert.deepEqual(events, [
  `set:${versionBase + 44}`,
  `get:${versionBase + 44}`,
  `set:${versionBase + 45}`,
  `set:${versionBase + 46}`,
  `get:${versionBase + 46}`,
], 'write and readback order is deterministic');

const timeoutEvents: string[] = [];
const timeoutMemory = new Map<string, string>();
let releaseTimedOutSet!: () => void;
let markSecondSetVerified!: () => void;
const timedOutSetGate = new Promise<void>((resolve) => { releaseTimedOutSet = resolve; });
const secondSetVerified = new Promise<void>((resolve) => { markSecondSetVerified = resolve; });
const timeoutQueue = createOfficeLayoutLocalWriteQueue({
  async setItem(key, value) {
    const version = JSON.parse(value).updatedAt;
    timeoutEvents.push(`set:${version}`);
    if (version === versionBase + 47) await timedOutSetGate;
    timeoutMemory.set(key, value);
  },
  async getItem(key) {
    const value = timeoutMemory.get(key) || null;
    const version = value ? JSON.parse(value).updatedAt : 'none';
    timeoutEvents.push(`get:${version}`);
    if (version === versionBase + 48) markSecondSetVerified();
    return value;
  },
}, 25);

const timedOutSet = timeoutQueue.enqueue(input(versionBase + 47));
const verifiedAfterSetTimeout = timeoutQueue.enqueue(input(versionBase + 48));
const otherScope = timeoutQueue.enqueue({
  ...input(versionBase + 51, 'Other scope'),
  userId: 'user-b',
  circleId: 'circle-b',
});
assert.deepEqual(
  await Promise.all([timedOutSet, verifiedAfterSetTimeout, otherScope]),
  [false, false, true],
  'timed-out same-scope callers settle false while another scope remains writable',
);
assert.deepEqual(timeoutEvents, [
  `set:${versionBase + 47}`,
  `set:${versionBase + 51}`,
  `get:${versionBase + 51}`,
], 'the same-scope successor never overlaps an unfinished timed-out write');
releaseTimedOutSet();
await secondSetVerified;
assert.equal(
  JSON.parse(timeoutMemory.get(officeLayoutLocalCacheKey('user-a', 'circle-a'))!).updatedAt,
  versionBase + 48,
  'a late timed-out write cannot overwrite its newer same-scope successor',
);

const getTimeoutEvents: string[] = [];
const getTimeoutMemory = new Map<string, string>();
let releaseTimedOutGet!: () => void;
let markAfterGetVerified!: () => void;
const timedOutGetGate = new Promise<void>((resolve) => { releaseTimedOutGet = resolve; });
const afterGetVerified = new Promise<void>((resolve) => { markAfterGetVerified = resolve; });
const getTimeoutQueue = createOfficeLayoutLocalWriteQueue({
  async setItem(key, value) {
    const version = JSON.parse(value).updatedAt;
    getTimeoutEvents.push(`set:${version}`);
    getTimeoutMemory.set(key, value);
  },
  async getItem(key) {
    const value = getTimeoutMemory.get(key) || null;
    const version = value ? JSON.parse(value).updatedAt : 'none';
    getTimeoutEvents.push(`get:${version}`);
    if (version === versionBase + 49) await timedOutGetGate;
    if (version === versionBase + 50) markAfterGetVerified();
    return value;
  },
}, 25);
const timedOutGet = getTimeoutQueue.enqueue(input(versionBase + 49));
const afterTimedOutGet = getTimeoutQueue.enqueue(input(versionBase + 50));
assert.deepEqual(
  await Promise.all([timedOutGet, afterTimedOutGet]),
  [false, false],
  'a timed-out readback also keeps its same-scope lane reserved',
);
assert.deepEqual(getTimeoutEvents, [
  `set:${versionBase + 49}`,
  `get:${versionBase + 49}`,
], 'no successor starts while an old readback can still observe mutable storage');
releaseTimedOutGet();
await afterGetVerified;
assert.equal(
  JSON.parse(getTimeoutMemory.get(officeLayoutLocalCacheKey('user-a', 'circle-a'))!).updatedAt,
  versionBase + 50,
  'the successor runs in order once the timed-out readback actually settles',
);

console.log('office-layout-local-cache smoketest: all assertions passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
