/**
 * entity-handle-core-smoketest — guards the PURE cross-surface deep-link handle
 * core (src/lib/entityHandleCore.ts, Finding 4 of CHAT_OFFICE_FEED_NEXT_GAPS.md):
 *
 *   - targetSurfaceForEntity mapping for every kind + the unknown→'chat' fallback.
 *   - encode → the compact `<surface>:<kind>:<id>` string, incl. the doc's
 *     `office:run:abc123` example and the surface-override path.
 *   - encode→decode roundtrip for every kind, including a `::`-namespaced agent id
 *     and prefix/UUID id shapes, and an explicit non-default surface.
 *   - decode leniency (case-insensitive surface/kind, outer whitespace) and its
 *     hard rejections (missing segment, unknown surface/kind, unsafe/empty id).
 *   - type guards, bounds (MAX_ID_LEN / MAX_ENTITY_HANDLE_LEN), and a hostile
 *     no-throw group (cyclic, throwing getter, huge, symbol, array, control chars).
 *
 * Imports the REAL module (pure, zero runtime imports).
 * Run: npx tsx scripts/entity-handle-core-smoketest.ts
 */

import {
  encodeEntityHandle,
  decodeEntityHandle,
  targetSurfaceForEntity,
  isEntityKind,
  isEntitySurface,
  ENTITY_KINDS,
  ENTITY_SURFACES,
  MAX_ID_LEN,
  MAX_ENTITY_HANDLE_LEN,
  type EntityHandle,
  type EntityKind,
  type EntitySurface,
} from '../src/lib/entityHandleCore';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}
function assertEq<T>(label: string, actual: T, expected: T): void {
  const ok = actual === expected;
  if (!ok) {
    console.error(`  FAIL: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed += 1;
  } else {
    passed += 1;
  }
}
/** Assert that calling `fn` never throws (returns whatever it returns). */
function noThrow(label: string, fn: () => unknown): unknown {
  try {
    const v = fn();
    passed += 1;
    return v;
  } catch (e) {
    failed += 1;
    console.error(`  FAIL: ${label} — threw ${String(e)}`);
    return undefined;
  }
}

// ── 1. targetSurfaceForEntity: canonical kind→surface mapping ──────────────────
assertEq('run → office', targetSurfaceForEntity('run'), 'office');
assertEq('task → feed', targetSurfaceForEntity('task'), 'feed');
assertEq('thread → chat', targetSurfaceForEntity('thread'), 'chat');
assertEq('mission → feed', targetSurfaceForEntity('mission'), 'feed');
assertEq('agent → office', targetSurfaceForEntity('agent'), 'office');
assertEq('room → rooms', targetSurfaceForEntity('room'), 'rooms');
assertEq('message → chat', targetSurfaceForEntity('message'), 'chat');
// every declared kind maps to a valid surface
for (const k of ENTITY_KINDS) {
  assert(`targetSurface(${k}) is a valid surface`, isEntitySurface(targetSurfaceForEntity(k)));
}
// case-insensitive + fallback
assertEq('RUN (upper) → office (lenient)', targetSurfaceForEntity('RUN'), 'office');
assertEq('"  Task " (padded/mixed) → feed', targetSurfaceForEntity('  Task '), 'feed');
assertEq('unknown kind → chat fallback', targetSurfaceForEntity('banana'), 'chat');
assertEq('empty string kind → chat', targetSurfaceForEntity(''), 'chat');
assertEq('null kind → chat', targetSurfaceForEntity(null), 'chat');
assertEq('undefined kind → chat', targetSurfaceForEntity(undefined), 'chat');
assertEq('number kind → chat', targetSurfaceForEntity(42), 'chat');
assertEq('object kind → chat', targetSurfaceForEntity({}), 'chat');

// ── 2. encode: compact `<surface>:<kind>:<id>` (doc example + all kinds) ────────
assertEq('doc example: run→office', encodeEntityHandle({ kind: 'run', id: 'abc123' }), 'office:run:abc123');
assertEq('task→feed', encodeEntityHandle({ kind: 'task', id: 't1' }), 'feed:task:t1');
assertEq('thread→chat', encodeEntityHandle({ kind: 'thread', id: 'th1' }), 'chat:thread:th1');
assertEq('mission→feed', encodeEntityHandle({ kind: 'mission', id: 'm1' }), 'feed:mission:m1');
assertEq('agent→office', encodeEntityHandle({ kind: 'agent', id: 'a1' }), 'office:agent:a1');
assertEq('room→rooms', encodeEntityHandle({ kind: 'room', id: 'r1' }), 'rooms:room:r1');
assertEq('message→chat', encodeEntityHandle({ kind: 'message', id: 'm1' }), 'chat:message:m1');
// real id shapes survive encode verbatim
assertEq(
  'prefix+stamp id kept',
  encodeEntityHandle({ kind: 'message', id: 'msg_1721_ab12' }),
  'chat:message:msg_1721_ab12',
);
assertEq(
  'UUID id kept',
  encodeEntityHandle({ kind: 'run', id: '9f2c1a4e-0b7d-4c3a-8e21-1f2b3c4d5e6f' }),
  'office:run:9f2c1a4e-0b7d-4c3a-8e21-1f2b3c4d5e6f',
);
assertEq(
  ':: namespaced agent id kept',
  encodeEntityHandle({ kind: 'agent', id: 'default::blackswan' }),
  'office:agent:default::blackswan',
);
// lenient kind casing on encode
assertEq('encode lenient: RUN→run', encodeEntityHandle({ kind: 'RUN', id: 'x' }), 'office:run:x');
assertEq('encode trims id', encodeEntityHandle({ kind: 'run', id: '  x  ' }), 'office:run:x');

// ── 3. encode: explicit surface override ───────────────────────────────────────
assertEq(
  'explicit surface honored (run pinned to feed)',
  encodeEntityHandle({ kind: 'run', id: 'x', surface: 'feed' }),
  'feed:run:x',
);
assertEq(
  'message pinned to rooms (non-default)',
  encodeEntityHandle({ kind: 'message', id: 'x', surface: 'rooms' }),
  'rooms:message:x',
);
assertEq(
  'explicit surface lenient casing (OFFICE→office)',
  encodeEntityHandle({ kind: 'thread', id: 'x', surface: 'OFFICE' as EntitySurface }),
  'office:thread:x',
);
assertEq(
  'invalid explicit surface falls back to kind default',
  encodeEntityHandle({ kind: 'run', id: 'x', surface: 'banana' as EntitySurface }),
  'office:run:x',
);

// ── 4. decode: parse back + segment extraction ─────────────────────────────────
{
  const h = decodeEntityHandle('office:run:abc123');
  assert('decode returns an object', !!h);
  assertEq('decode kind', h?.kind, 'run');
  assertEq('decode id', h?.id, 'abc123');
  assertEq('decode surface', h?.surface, 'office');
}
{
  // :: id: split on only the first two colons, remainder is the id verbatim
  const h = decodeEntityHandle('office:agent:default::blackswan');
  assertEq('decode :: kind', h?.kind, 'agent');
  assertEq('decode :: id keeps both colons', h?.id, 'default::blackswan');
  assertEq('decode :: surface', h?.surface, 'office');
}
// lenient surface/kind casing + outer whitespace; id case preserved
{
  const h = decodeEntityHandle('  Office:Run:AbC123  ');
  assertEq('decode lenient surface', h?.surface, 'office');
  assertEq('decode lenient kind', h?.kind, 'run');
  assertEq('decode preserves id case', h?.id, 'AbC123');
}

// ── 5. encode→decode roundtrip for every kind ──────────────────────────────────
const ROUNDTRIP: Array<{ kind: EntityKind; id: string; surface: EntitySurface }> = [
  { kind: 'task', id: 'task_1721', surface: 'feed' },
  { kind: 'run', id: 'run_9f2c1a4e', surface: 'office' },
  { kind: 'thread', id: 'conv_abc.def', surface: 'chat' },
  { kind: 'mission', id: 'm-000-111', surface: 'feed' },
  { kind: 'agent', id: 'default::blackswan', surface: 'office' },
  { kind: 'room', id: 'ROOM_42', surface: 'rooms' },
  { kind: 'message', id: 'msg_1721_ab12', surface: 'chat' },
];
for (const item of ROUNDTRIP) {
  const enc = encodeEntityHandle({ kind: item.kind, id: item.id });
  assert(`roundtrip ${item.kind}: encodes non-empty`, enc.length > 0);
  const dec = decodeEntityHandle(enc);
  assertEq(`roundtrip ${item.kind}: kind`, dec?.kind, item.kind);
  assertEq(`roundtrip ${item.kind}: id exact`, dec?.id, item.id);
  assertEq(`roundtrip ${item.kind}: surface = default`, dec?.surface, item.surface);
}
// roundtrip preserving an explicit non-default surface
{
  const enc = encodeEntityHandle({ kind: 'message', id: 'x9', surface: 'rooms' });
  const dec = decodeEntityHandle(enc);
  assertEq('roundtrip explicit surface preserved', dec?.surface, 'rooms');
  assertEq('roundtrip explicit surface: kind intact', dec?.kind, 'message');
  assertEq('roundtrip explicit surface: id intact', dec?.id, 'x9');
}
// encode is deterministic / stable
assertEq(
  'encode is stable (same input → same output)',
  encodeEntityHandle({ kind: 'run', id: 'z' }),
  encodeEntityHandle({ kind: 'run', id: 'z' }),
);

// ── 6. encode junk → '' (neutral "no handle") ──────────────────────────────────
assertEq('encode null → ""', encodeEntityHandle(null), '');
assertEq('encode undefined → ""', encodeEntityHandle(undefined), '');
assertEq('encode string → ""', encodeEntityHandle('office:run:x'), '');
assertEq('encode number → ""', encodeEntityHandle(42), '');
assertEq('encode boolean → ""', encodeEntityHandle(true), '');
assertEq('encode array → ""', encodeEntityHandle(['run', 'x']), '');
assertEq('encode {} → ""', encodeEntityHandle({}), '');
assertEq('encode missing id → ""', encodeEntityHandle({ kind: 'run' }), '');
assertEq('encode non-string id → ""', encodeEntityHandle({ kind: 'run', id: 123 }), '');
assertEq('encode empty id → ""', encodeEntityHandle({ kind: 'run', id: '' }), '');
assertEq('encode whitespace id → ""', encodeEntityHandle({ kind: 'run', id: '   ' }), '');
assertEq('encode unknown kind → ""', encodeEntityHandle({ kind: 'bogus', id: 'x' }), '');
assertEq('encode id with space → ""', encodeEntityHandle({ kind: 'run', id: 'a b' }), '');
assertEq('encode id with newline → ""', encodeEntityHandle({ kind: 'run', id: 'a\nb' }), '');
assertEq('encode id with quote → ""', encodeEntityHandle({ kind: 'run', id: 'a"b' }), '');
assertEq('encode id with unicode → ""', encodeEntityHandle({ kind: 'run', id: 'x💣' }), '');

// ── 7. decode junk → null ──────────────────────────────────────────────────────
assertEq('decode null → null', decodeEntityHandle(null), null);
assertEq('decode undefined → null', decodeEntityHandle(undefined), null);
assertEq('decode number → null', decodeEntityHandle(42), null);
assertEq('decode object → null', decodeEntityHandle({}), null);
assertEq('decode array → null', decodeEntityHandle([]), null);
assertEq('decode "" → null', decodeEntityHandle(''), null);
assertEq('decode "   " → null', decodeEntityHandle('   '), null);
assertEq('decode no-colon → null', decodeEntityHandle('officerunabc'), null);
assertEq('decode leading colon → null', decodeEntityHandle(':run:abc'), null);
assertEq('decode missing id segment → null', decodeEntityHandle('office:run'), null);
assertEq('decode empty kind (adjacent colons) → null', decodeEntityHandle('office::abc'), null);
assertEq('decode empty id → null', decodeEntityHandle('office:run:'), null);
assertEq('decode unknown surface → null', decodeEntityHandle('banana:run:abc'), null);
assertEq('decode unknown kind → null', decodeEntityHandle('office:banana:abc'), null);
assertEq('decode id with space → null', decodeEntityHandle('office:run:a b'), null);
assertEq('decode id with unicode → null', decodeEntityHandle('office:run:x💣'), null);

// the "no handle" neutral value roundtrips cleanly: encode(junk)='' → decode(...)=null
assertEq('neutral roundtrip: decode(encode(junk)) === null', decodeEntityHandle(encodeEntityHandle(null)), null);

// ── 8. type guards ─────────────────────────────────────────────────────────────
assert('isEntityKind("run") true', isEntityKind('run'));
assert('isEntityKind("message") true', isEntityKind('message'));
assert('isEntityKind("RUN") false (strict)', !isEntityKind('RUN'));
assert('isEntityKind("banana") false', !isEntityKind('banana'));
assert('isEntityKind(null) false', !isEntityKind(null));
assert('isEntityKind(undefined) false', !isEntityKind(undefined));
assert('isEntityKind(1) false', !isEntityKind(1));
assert('isEntitySurface("office") true', isEntitySurface('office'));
assert('isEntitySurface("rooms") true', isEntitySurface('rooms'));
assert('isEntitySurface("OFFICE") false (strict)', !isEntitySurface('OFFICE'));
assert('isEntitySurface("banana") false', !isEntitySurface('banana'));
assert('isEntitySurface(null) false', !isEntitySurface(null));
// every declared kind/surface passes its own guard
for (const k of ENTITY_KINDS) assert(`isEntityKind(${k}) true`, isEntityKind(k));
for (const s of ENTITY_SURFACES) assert(`isEntitySurface(${s}) true`, isEntitySurface(s));

// ── 9. bounds (never blow up on huge input) ────────────────────────────────────
assert('MAX_ID_LEN positive', MAX_ID_LEN > 0);
assert('MAX_ENTITY_HANDLE_LEN > MAX_ID_LEN', MAX_ENTITY_HANDLE_LEN > MAX_ID_LEN);
{
  const atLimit = 'x'.repeat(MAX_ID_LEN);
  assertEq('encode id exactly at MAX_ID_LEN ok', encodeEntityHandle({ kind: 'run', id: atLimit }), `office:run:${atLimit}`);
  const overLimit = 'x'.repeat(MAX_ID_LEN + 1);
  assertEq('encode id over MAX_ID_LEN → ""', encodeEntityHandle({ kind: 'run', id: overLimit }), '');
  assertEq('decode id over MAX_ID_LEN → null', decodeEntityHandle(`office:run:${overLimit}`), null);
}
{
  const huge = `office:run:${'x'.repeat(MAX_ENTITY_HANDLE_LEN + 5000)}`;
  assertEq('decode over-length handle → null (bounded)', decodeEntityHandle(huge), null);
}

// ── 10. hostile input never throws ─────────────────────────────────────────────
// cyclic object
const cyclic: any = { kind: 'run', id: 'x' };
cyclic.self = cyclic;
assertEq('encode cyclic object → still works (reads only kind/id)', noThrow('encode cyclic', () => encodeEntityHandle(cyclic)) as string, 'office:run:x');
// throwing getter on kind
const throwingKind: any = { get kind() { throw new Error('boom'); }, id: 'x' };
assertEq('encode throwing kind getter → ""', noThrow('encode throwing kind', () => encodeEntityHandle(throwingKind)) as string, '');
// throwing getter on id
const throwingId: any = { kind: 'run', get id() { throw new Error('boom'); } };
assertEq('encode throwing id getter → ""', noThrow('encode throwing id', () => encodeEntityHandle(throwingId)) as string, '');
// throwing getter on surface
const throwingSurface: any = { kind: 'run', id: 'x', get surface() { throw new Error('boom'); } };
assertEq('encode throwing surface getter → ""', noThrow('encode throwing surface', () => encodeEntityHandle(throwingSurface)) as string, '');
// symbol / function / bigint payloads
noThrow('encode symbol kind', () => encodeEntityHandle({ kind: Symbol('run'), id: 'x' } as any));
noThrow('encode function id', () => encodeEntityHandle({ kind: 'run', id: () => 'x' } as any));
noThrow('encode bigint', () => encodeEntityHandle(10n as any));
noThrow('encode NaN', () => encodeEntityHandle(NaN as any));
noThrow('decode symbol', () => decodeEntityHandle(Symbol('x') as any));
noThrow('decode function', () => decodeEntityHandle((() => 'x') as any));
noThrow('decode bigint', () => decodeEntityHandle(5n as any));
noThrow('decode control chars', () => decodeEntityHandle('office:run: '));
noThrow('targetSurface symbol', () => targetSurfaceForEntity(Symbol('run') as any));
noThrow('targetSurface throwing toString', () => targetSurfaceForEntity({ toString() { throw new Error('x'); } } as any));
// hostile results are still safe-neutral typed
assertEq('encode symbol kind → ""', encodeEntityHandle({ kind: Symbol('run'), id: 'x' } as any), '');
assertEq('decode control chars → null', decodeEntityHandle('office:run: '), null);

// ── 11. constants sanity ───────────────────────────────────────────────────────
assertEq('ENTITY_KINDS has 7', ENTITY_KINDS.length, 7);
assertEq('ENTITY_SURFACES has 4', ENTITY_SURFACES.length, 4);
assert('ENTITY_KINDS unique', new Set(ENTITY_KINDS).size === ENTITY_KINDS.length);
assert('ENTITY_SURFACES unique', new Set(ENTITY_SURFACES).size === ENTITY_SURFACES.length);
// EntityHandle is structurally usable (compile-time anchor)
const sample: EntityHandle = { kind: 'run', id: 'x', surface: 'office' };
assert('EntityHandle sample encodes', encodeEntityHandle(sample) === 'office:run:x');

// ── report ─────────────────────────────────────────────────────────────────────
console.log(`entity-handle-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
