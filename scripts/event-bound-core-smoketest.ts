/**
 * event-bound-core-smoketest — the PURE agent_run_events payload bounder
 * (src/lib/eventBoundCore.ts). Load-bearing behavior exercised here:
 *   boundEventPayload — normal payloads round-trip unchanged; cyclic → '[cyclic]'
 *   (no throw, no infinite loop); huge strings clipped; deep nesting → '[max-depth]';
 *   wide arrays/objects capped with omission markers; every kept string
 *   secret-masked; TOTAL serialized size always <= the ceiling; opts clamp;
 *   exotic types (Date/RegExp/Map/Set/Error) bounded; __proto__ never pollutes.
 *   boundToolCallsAggregate — array capped (~50) + each entry bounded.
 * Plus a hostile/degenerate no-throw group over the full type zoo.
 *
 * All "secrets" below are OBVIOUSLY FAKE placeholders (AWS's public example key,
 * zero-filled tokens, FAKE-marked values). Never put a real secret here.
 *
 * Pure — loads under tsx (eventBoundCore has zero imports).
 * Run: npx tsx scripts/event-bound-core-smoketest.ts
 */

import {
  EVENT_PAYLOAD_MAX_CHARS,
  EVENT_MAX_DEPTH,
  boundEventPayload,
  boundToolCallsAggregate,
} from '../src/lib/eventBoundCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes += 1;
  else {
    failures += 1;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Fake, never-real secret fixtures.
const FAKE = {
  openai: 'sk-0000000000000000000000',
  anthropic: 'sk-ant-FAKEFAKEFAKEFAKEFAKE00',
  githubClassic: 'ghp_000000000000000000000000000000000000',
  awsKey: 'AKIAIOSFODNN7EXAMPLE',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlIn0.FAKEsignature0000',
  bearer: 'Bearer FAKEtoken0000000000000000',
  basicUrl: 'https://alice:FAKEpassword123@example.com/path',
  apiKey: 'api_key="FAKEabcdefghij0123456789"',
};

function serializedLen(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return -1;
  }
}

function main(): void {
  // ─── (1) exported constants + normal small payload round-trips unchanged ────
  assertEq(EVENT_PAYLOAD_MAX_CHARS, 8000, '(1) EVENT_PAYLOAD_MAX_CHARS');
  assertEq(EVENT_MAX_DEPTH, 6, '(1) EVENT_MAX_DEPTH');
  assertEq(typeof boundEventPayload, 'function', '(1) boundEventPayload is a fn');
  assertEq(typeof boundToolCallsAggregate, 'function', '(1) boundToolCallsAggregate is a fn');

  const normal = {
    iteration: 3,
    tool: 'read_file',
    tool_use_id: 'toolu_abc',
    input: { path: '/src/x.ts', limit: 100, deep: false },
  };
  const rNormal = boundEventPayload('tool_call_start', normal);
  assertEq(JSON.stringify(rNormal), JSON.stringify(normal), '(1) normal telemetry payload round-trips byte-identical');
  const usage = { iteration: 5, stop_reason: 'end_turn', usage: null };
  assertEq(JSON.stringify(boundEventPayload('turn_end', usage)), JSON.stringify(usage), '(1) turn_end payload unchanged');

  // ─── (2) cyclic input → '[cyclic]', no throw, serialized bounded ────────────
  const selfObj: any = { name: 'root' };
  selfObj.self = selfObj;
  const rSelf = boundEventPayload('k', selfObj) as any;
  assertEq(rSelf.name, 'root', '(2) cyclic obj keeps non-cyclic field');
  assertEq(rSelf.self, '[cyclic]', '(2) self-reference → [cyclic]');
  assert(serializedLen(rSelf) > 0, '(2) cyclic result serializes (no throw)');

  const cycArr: any = [1, 2];
  cycArr.push(cycArr);
  const rCycArr = boundEventPayload('k', cycArr) as any[];
  assertEq(rCycArr[0], 1, '(2) cyclic array keeps element 0');
  assertEq(rCycArr[2], '[cyclic]', '(2) cyclic array back-ref → [cyclic]');

  // Mutual cycle a → b → a.
  const a: any = {};
  const b: any = { back: a };
  a.b = b;
  const rMutual = boundEventPayload('k', a) as any;
  assertEq(rMutual.b.back, '[cyclic]', '(2) mutual a→b→a cycle → [cyclic]');

  // Shared (non-cyclic) DAG must NOT be flagged cyclic (ancestor-path semantics).
  const shared = { x: 1 };
  const dag = { p: shared, q: shared };
  const rDag = boundEventPayload('k', dag) as any;
  assertEq(rDag.p.x, 1, '(2) DAG sibling p intact');
  assertEq(rDag.q.x, 1, '(2) DAG sibling q intact (NOT [cyclic])');
  assert(rDag.q !== '[cyclic]', '(2) shared ref is not a cycle');

  // ─── (3) huge string clipped with marker, original body gone ────────────────
  const huge = 'A'.repeat(50_000);
  const rHuge = boundEventPayload('k', { big: huge }) as any;
  assert(typeof rHuge.big === 'string', '(3) huge string stays a string');
  assert(rHuge.big.length < 2100, '(3) huge string clipped near cap', 'len=' + rHuge.big.length);
  assert(rHuge.big.startsWith('AAAA'), '(3) clipped head preserved');
  assert(rHuge.big.includes('…[+'), '(3) clip marker present');
  assert(rHuge.big.length < huge.length, '(3) clipped shorter than original');

  // ─── (4) deep nesting capped at maxDepth → '[max-depth]' ────────────────────
  let deep: any = 'leaf';
  for (let i = 0; i < 12; i++) deep = { v: deep };
  const rDeep = boundEventPayload('k', deep);
  const sDeep = JSON.stringify(rDeep);
  assert(sDeep.includes('[max-depth]'), '(4) depth ceiling marker present');
  assert(!sDeep.includes('leaf'), '(4) content beyond depth ceiling dropped');
  // Drill exactly EVENT_MAX_DEPTH levels of .v to reach the marker.
  let cursor: any = rDeep;
  for (let i = 0; i < EVENT_MAX_DEPTH; i++) cursor = cursor.v;
  assertEq(cursor, '[max-depth]', '(4) node at depth ceiling is the marker');

  // ─── (5) wide array + wide object capped with omission markers ──────────────
  const wideArr = Array.from({ length: 500 }, (_, i) => i);
  const rArr = boundEventPayload('k', wideArr) as any[];
  assertEq(rArr.length, 101, '(5) wide array capped to 100 + marker');
  assertEq(rArr[0], 0, '(5) array head kept');
  assertEq(rArr[99], 99, '(5) array element 99 kept');
  assertEq(rArr[100], '[+400 more]', '(5) array overflow marker');

  const wideObj: Record<string, number> = {};
  for (let i = 0; i < 300; i++) wideObj['k' + i] = i;
  const rObj = boundEventPayload('k', wideObj) as any;
  assertEq(rObj.k0, 0, '(5) object first key kept');
  assertEq(rObj.k99, 99, '(5) object key 99 kept');
  assertEq(rObj.k100, undefined, '(5) object key beyond cap dropped');
  assertEq(rObj.__omittedKeys, 200, '(5) object omission count');

  // ─── (6) secrets masked everywhere, prose/host survive ──────────────────────
  const secretPayload = {
    openai: FAKE.openai,
    anthropic: FAKE.anthropic,
    gh: FAKE.githubClassic,
    aws: FAKE.awsKey,
    jwt: FAKE.jwt,
    bearer: FAKE.bearer,
    url: FAKE.basicUrl,
    api: FAKE.apiKey,
    nested: { deeper: [FAKE.openai, { andHere: FAKE.anthropic }] },
    note: 'the deploy token is ' + FAKE.githubClassic + ' rotate it',
  };
  const rSecret = boundEventPayload('k', secretPayload);
  const sSecret = JSON.stringify(rSecret);
  assert(sSecret.includes('[REDACTED]'), '(6) mask token present');
  for (const [name, raw] of Object.entries(FAKE)) {
    assert(!sSecret.includes(raw), '(6) raw secret absent: ' + name);
  }
  // The bodies specifically must be gone even where nested.
  assert(!sSecret.includes('FAKEsignature0000'), '(6) jwt body gone');
  assert(!sSecret.includes('FAKEpassword123'), '(6) url password gone');
  assert(!sSecret.includes('FAKEabcdefghij0123456789'), '(6) api key body gone');
  // basic_auth keeps host + user + path.
  assert(sSecret.includes('example.com'), '(6) url host survives');
  assert(sSecret.includes('alice'), '(6) url user survives');
  // prose around the secret survives.
  assert(sSecret.includes('rotate it'), '(6) prose after secret survives');

  // Secret used AS a key is masked too.
  const keyed: Record<string, unknown> = {};
  keyed[FAKE.bearer] = 'v';
  const rKeyed = boundEventPayload('k', keyed) as any;
  assert(!JSON.stringify(rKeyed).includes('FAKEtoken'), '(6) secret-shaped key masked');
  assertEq(rKeyed['[REDACTED]'], 'v', '(6) masked key still maps to value');

  // ─── (7) TOTAL serialized size is always bounded ────────────────────────────
  // A quote-bomb: budget under-counts JSON escaping, forcing the size guard.
  const bomb = { a: '"'.repeat(200) };
  const rBomb = boundEventPayload('k', bomb, { maxChars: 256 }) as any;
  assert(serializedLen(rBomb) <= 256, '(7) clipped payload within custom ceiling', 'len=' + serializedLen(rBomb));
  assertEq(rBomb.__eventPayloadClipped, true, '(7) over-budget payload marked clipped');
  assertEq(rBomb.kind, 'k', '(7) clip wrapper carries kind');
  assert(typeof rBomb.preview === 'string', '(7) clip wrapper has string preview');

  // Many medium strings under the DEFAULT ceiling stay <= EVENT_PAYLOAD_MAX_CHARS.
  const manyStrings = Array.from({ length: 100 }, () => 'B'.repeat(3000));
  const rMany = boundEventPayload('k', manyStrings);
  assert(serializedLen(rMany) <= EVENT_PAYLOAD_MAX_CHARS, '(7) default ceiling honored', 'len=' + serializedLen(rMany));

  // A big nested object also stays bounded.
  const bigNest: any = {};
  for (let i = 0; i < 50; i++) bigNest['field' + i] = { s: 'x'.repeat(1000), arr: Array.from({ length: 40 }, (_, j) => j) };
  assert(serializedLen(boundEventPayload('k', bigNest)) <= EVENT_PAYLOAD_MAX_CHARS, '(7) big nested obj bounded');

  // ─── (8) opts override + clamping of absurd opts ────────────────────────────
  const nest3 = { a: { b: { c: 1 } } };
  const rShallow = boundEventPayload('k', nest3, { maxDepth: 1 }) as any;
  assertEq(rShallow.a, '[max-depth]', '(8) maxDepth:1 caps at first level');
  // Absurd opts are clamped, never throw.
  assert(boundEventPayload('k', nest3, { maxDepth: 0 }) !== undefined, '(8) maxDepth:0 clamped (→1), no throw');
  assert(boundEventPayload('k', nest3, { maxDepth: -5 }) !== undefined, '(8) negative maxDepth clamped');
  assert(boundEventPayload('k', nest3, { maxDepth: 1e9 }) !== undefined, '(8) huge maxDepth clamped');
  assert(boundEventPayload('k', nest3, { maxChars: 5 }) !== undefined, '(8) tiny maxChars clamped');
  assert(boundEventPayload('k', nest3, { maxChars: NaN }) !== undefined, '(8) NaN maxChars → default');
  // maxDepth:0 behaves like clamp-to-1 (same as maxDepth:1).
  assertEq((boundEventPayload('k', nest3, { maxDepth: 0 }) as any).a, '[max-depth]', '(8) maxDepth:0 == maxDepth:1');

  // ─── (9) boundToolCallsAggregate: cap + per-entry bound ─────────────────────
  const calls = Array.from({ length: 200 }, (_, i) => ({
    toolName: 'tool' + i,
    toolUseId: 'id' + i,
    ok: i % 2 === 0,
    durationMs: i,
    error: i % 2 === 1 ? 'boom'.repeat(1000) : undefined,
  }));
  const rCalls = boundToolCallsAggregate(calls) as any[];
  assertEq(rCalls.length, 51, '(9) tool calls capped to 50 + marker');
  assertEq(rCalls[0].toolName, 'tool0', '(9) first entry preserved');
  assertEq(rCalls[49].toolName, 'tool49', '(9) 50th entry preserved');
  assertEq(rCalls[50].__truncated, true, '(9) truncation marker present');
  assertEq(rCalls[50].omitted, 150, '(9) omitted count correct');
  assertEq(rCalls[50].total, 200, '(9) total count correct');
  // Entry 1 has a 4000-char error → clipped.
  assert(typeof rCalls[1].error === 'string', '(9) entry error kept as string');
  assert(rCalls[1].error.length < 600, '(9) entry error clipped', 'len=' + rCalls[1].error.length);
  assert(rCalls[1].error.includes('…[+'), '(9) entry error clip marker');
  assert(!rCalls[1].error.includes('boom'.repeat(200)), '(9) full error body not present');
  // maxItems override.
  const rSmall = boundToolCallsAggregate(calls, { maxItems: 5 }) as any[];
  assertEq(rSmall.length, 6, '(9) maxItems:5 → 5 + marker');
  assertEq(rSmall[5].omitted, 195, '(9) maxItems override omitted count');
  // Non-array → [].
  for (const bad of [null, undefined, 42, 'x', {}, true]) {
    const r = boundToolCallsAggregate(bad as unknown);
    assert(Array.isArray(r) && (r as unknown[]).length === 0, '(9) non-array → [] :: ' + String(bad));
  }
  // Hostile entries (cyclic, mixed primitives) do not throw.
  const cyc: any = {};
  cyc.me = cyc;
  const rHostileCalls = boundToolCallsAggregate([cyc, null, 42, 'str', undefined]) as any[];
  assertEq(rHostileCalls.length, 5, '(9) hostile entries all bounded');
  assertEq(rHostileCalls[0].me, '[cyclic]', '(9) cyclic entry → [cyclic]');
  assertEq(rHostileCalls[1], null, '(9) null entry → null');
  assertEq(rHostileCalls[4], null, '(9) undefined entry → null');

  // ─── (10) exotic types: Date / RegExp / Map / Set / Error ───────────────────
  const d = new Date('2020-01-02T03:04:05.000Z');
  assertEq((boundEventPayload('k', { d }) as any).d, '2020-01-02T03:04:05.000Z', '(10) Date → ISO string');
  assertEq((boundEventPayload('k', { d: new Date('not-a-date') }) as any).d, '[invalid-date]', '(10) invalid Date → marker');
  assertEq((boundEventPayload('k', { r: /ab+c/gi }) as any).r, '/ab+c/gi', '(10) RegExp → source string');

  const rMap = boundEventPayload('k', new Map([['a', 1], ['b', 2]])) as any;
  assertEq(rMap.__type, 'Map', '(10) Map tagged');
  assertEq(rMap.size, 2, '(10) Map size');
  assertEq(JSON.stringify(rMap.entries), JSON.stringify([['a', 1], ['b', 2]]), '(10) Map entries bounded');

  const rSet = boundEventPayload('k', new Set([1, 2, 3])) as any;
  assertEq(rSet.__type, 'Set', '(10) Set tagged');
  assertEq(rSet.size, 3, '(10) Set size');
  assertEq(JSON.stringify(rSet.values), JSON.stringify([1, 2, 3]), '(10) Set values bounded');

  const rErr = boundEventPayload('k', new Error('kaboom')) as any;
  assertEq(rErr.__type, 'Error', '(10) Error tagged');
  assertEq(rErr.message, 'kaboom', '(10) Error message kept');
  assert(!('stack' in rErr), '(10) Error stack excluded (path-safe)');
  // A secret inside an Error message is masked.
  assert(!JSON.stringify(boundEventPayload('k', new Error('tok ' + FAKE.openai))).includes(FAKE.openai), '(10) Error message secret masked');

  // ─── (11) __proto__ key never pollutes Object.prototype ─────────────────────
  const polluter = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  const rPoll = boundEventPayload('k', polluter) as any;
  assertEq(({} as any).polluted, undefined, '(11) Object.prototype not polluted');
  assertEq(rPoll.safe, 1, '(11) sibling key survives __proto__ handling');
  assert(Object.getPrototypeOf(rPoll) === Object.prototype, '(11) result prototype intact');

  // ─── (12) determinism: same input twice → identical serialized output ───────
  const complex = { s: FAKE.jwt, arr: [1, { n: 'x'.repeat(3000) }], big: 'Z'.repeat(9000) };
  assertEq(
    JSON.stringify(boundEventPayload('k', complex)),
    JSON.stringify(boundEventPayload('k', complex)),
    '(12) bounder is deterministic',
  );

  // ─── (13) hostile / degenerate primitives never throw ───────────────────────
  try {
    assertEq(boundEventPayload('k', undefined), null, '(13) undefined → null');
    assertEq(boundEventPayload('k', null), null, '(13) null → null');
    assertEq(boundEventPayload('k', 42), 42, '(13) number passthrough');
    assertEq(boundEventPayload('k', 'hi'), 'hi', '(13) string passthrough');
    assertEq(boundEventPayload('k', true), true, '(13) boolean passthrough');
    assertEq(boundEventPayload('k', 0), 0, '(13) zero passthrough');
    assertEq(boundEventPayload('k', ''), '', '(13) empty string passthrough');
    assertEq(boundEventPayload('k', 10n), '10', '(13) bigint → string');
    assertEq(boundEventPayload('k', () => 1), null, '(13) function → null');
    assertEq(boundEventPayload('k', Symbol('s')), null, '(13) symbol → null');
    assertEq((boundEventPayload('k', { n: NaN }) as any).n, null, '(13) NaN → null');
    assertEq((boundEventPayload('k', { n: Infinity }) as any).n, null, '(13) Infinity → null');
    assertEq((boundEventPayload('k', { n: -Infinity }) as any).n, null, '(13) -Infinity → null');
    // getter that throws — key dropped, siblings survive.
    const trap: any = { good: 1 };
    Object.defineProperty(trap, 'bad', { enumerable: true, get() { throw new Error('nope'); } });
    const rTrap = boundEventPayload('k', trap) as any;
    assertEq(rTrap.good, 1, '(13) throwing-getter sibling survives');
    assertEq(rTrap.bad, undefined, '(13) throwing-getter key dropped');
    // Weird `kind` types never throw and clip wrapper still valid.
    const bombK = { a: '"'.repeat(300) };
    assert(boundEventPayload(null, bombK, { maxChars: 256 }) !== undefined, '(13) null kind ok');
    assert(boundEventPayload(12345, bombK, { maxChars: 256 }) !== undefined, '(13) numeric kind ok');
    assert(boundEventPayload({ obj: true }, bombK, { maxChars: 256 }) !== undefined, '(13) object kind ok');
    // A kind that is itself secret-shaped is masked in the clip wrapper.
    const rSecretKind = boundEventPayload(FAKE.openai, bombK, { maxChars: 256 }) as any;
    assert(!JSON.stringify(rSecretKind).includes(FAKE.openai), '(13) secret-shaped kind masked');
    // Fully hostile top-level values.
    boundEventPayload('k', new Map([[{ self: 1 }, [1, 2, 3]]]));
    boundEventPayload('k', [undefined, null, () => 0, Symbol('x'), 5n]);
    boundEventPayload('k', { fn: () => 0, sym: Symbol('y'), big: 9n });
    passes += 1; // reached here → no throw across the degenerate battery
  } catch (e) {
    failures += 1;
    console.error('FAIL: (13) degenerate battery threw :: ' + (e as Error)?.message);
  }

  console.log('\nevent-bound-core smoke: ' + passes + ' passed, ' + failures + ' failed');
}

main();
if (failures > 0) {
  console.error('\n' + failures + ' fail');
  process.exit(1);
}
console.log('\nAll event-bound-core smoke cases passed (' + passes + ' passed).');
