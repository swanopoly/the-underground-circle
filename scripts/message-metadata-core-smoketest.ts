/**
 * message-metadata-core-smoketest — the PURE serialize/hydrate brain for moving
 * persisted bot-message metadata off the `content` text blob into a
 * `messages.metadata` jsonb column (src/lib/messageMetadataCore.ts). Load-bearing
 * behavior exercised here:
 *   serializeMessageMetadata — normal metadata round-trips LOSSLESSLY (the whole
 *   point: no more full/minimal/tiny tier collapse); always returns a plain object
 *   (arrays/primitives/exotics → {}); extra/unknown fields retained; oversized
 *   arrays/strings capped; deep nesting → '[max-depth]'; cyclic → '[cyclic]' (no
 *   throw, no infinite loop); every kept string secret-masked; TOTAL serialized
 *   size always <= the ceiling, with whole over-budget fields DROPPED (recorded in
 *   __metadataOmittedFields) rather than rewritten; opts clamp; __proto__ never
 *   pollutes.
 *   hydrateMessageMetadata — reads jsonb back into the 7 typed fields; tolerant of
 *   missing rows + legacy snake_case aliases; primary key beats alias; null field
 *   preserved (absent vs null); non-object → {}.
 * Plus a hostile/degenerate no-throw group over the full type zoo.
 *
 * All "secrets" below are OBVIOUSLY FAKE placeholders (AWS's public example key,
 * zero-filled tokens, FAKE-marked values). Never put a real secret here.
 *
 * Pure — loads under tsx (messageMetadataCore has zero imports).
 * Run: npx tsx scripts/message-metadata-core-smoketest.ts
 */

import {
  MESSAGE_METADATA_MAX_BYTES,
  MESSAGE_METADATA_MAX_DEPTH,
  serializeMessageMetadata,
  hydrateMessageMetadata,
  type PersistedMessageMetadata,
} from '../src/lib/messageMetadataCore';

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
function slen(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return -1;
  }
}
function isPlainRecord(v: unknown): boolean {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// Fake, never-real secret fixtures (mirrors event-bound-core smoke).
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

function main(): void {
  // ─── (1) exported surface + neutral/empty cases ─────────────────────────────
  assertEq(MESSAGE_METADATA_MAX_BYTES, 16_000, '(1) MESSAGE_METADATA_MAX_BYTES');
  assertEq(MESSAGE_METADATA_MAX_DEPTH, 8, '(1) MESSAGE_METADATA_MAX_DEPTH');
  assertEq(typeof serializeMessageMetadata, 'function', '(1) serialize is a fn');
  assertEq(typeof hydrateMessageMetadata, 'function', '(1) hydrate is a fn');
  assertEq(slen(serializeMessageMetadata({})), 2, '(1) empty object → {}');
  assert(isPlainRecord(serializeMessageMetadata({})), '(1) empty serialize is a record');
  assertEq(slen(hydrateMessageMetadata({})), 2, '(1) empty hydrate → {}');
  assertEq(Object.keys(hydrateMessageMetadata(undefined)).length, 0, '(1) hydrate undefined → {}');

  // ─── (2) LOSSLESS round-trip of normal metadata through a jsonb store ────────
  // The keystone: unlike the old text-blob tiers, a normal-size metadata object
  // is stored byte-identical and hydrates back exactly.
  const meta = {
    source: { actor: 'openswan', surface: 'chat', selectedModel: 'claude-haiku-4-5', provider: 'anthropic' },
    routing: { lane: 'batch', reason: 'tool-heavy' },
    usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 900 },
    memoriesUsed: ['prefers concise diffs', 'repo uses tsx smoke tests'],
    executionStream: [{ id: 's1', status: 'done', title: 'read file', kind: 'tool' }],
    toolEvents: [{ tool: 'read_file', status: 'ok', summary: 'read src/x.ts' }],
    quickReplies: ['Continue', 'Retry', 'Show diff'],
    // extra/unknown fields the jsonb column must ALSO carry (not in the 7):
    browserPlans: [{ planId: 'p1', task: 'search' }],
    artifacts: [{ kind: 'code', title: 'patch' }],
  };
  const serialized = serializeMessageMetadata(meta);
  assert(isPlainRecord(serialized), '(2) serialize returns a record');
  assertEq(JSON.stringify(serialized), JSON.stringify(meta), '(2) normal metadata serialized LOSSLESSLY (byte-identical)');
  // Simulate the jsonb column: parse(stringify(...)) then hydrate.
  const stored = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>;
  const hy = hydrateMessageMetadata(stored);
  assertEq(JSON.stringify(hy.source), JSON.stringify(meta.source), '(2) source round-trips');
  assertEq(JSON.stringify(hy.routing), JSON.stringify(meta.routing), '(2) routing round-trips');
  assertEq(JSON.stringify(hy.usage), JSON.stringify(meta.usage), '(2) usage round-trips');
  assertEq(JSON.stringify(hy.memoriesUsed), JSON.stringify(meta.memoriesUsed), '(2) memoriesUsed round-trips');
  assertEq(JSON.stringify(hy.executionStream), JSON.stringify(meta.executionStream), '(2) executionStream round-trips');
  assertEq(JSON.stringify(hy.toolEvents), JSON.stringify(meta.toolEvents), '(2) toolEvents round-trips');
  assertEq(JSON.stringify(hy.quickReplies), JSON.stringify(meta.quickReplies), '(2) quickReplies round-trips');

  // ─── (3) extra/unknown fields retained by serialize (jsonb keeps everything) ─
  assert(Object.prototype.hasOwnProperty.call(stored, 'browserPlans'), '(3) extra field browserPlans retained');
  assert(Object.prototype.hasOwnProperty.call(stored, 'artifacts'), '(3) extra field artifacts retained');
  assertEq(JSON.stringify(stored.browserPlans), JSON.stringify(meta.browserPlans), '(3) extra field content intact');
  // ...but hydrate only surfaces the 7 typed fields.
  assertEq((hy as Record<string, unknown>).browserPlans, undefined, '(3) hydrate does not surface extra fields');

  // ─── (4) oversized arrays + wide objects capped with omission markers ───────
  const wideArr = Array.from({ length: 500 }, (_, i) => i);
  const rArr = serializeMessageMetadata({ arr: wideArr }).arr as unknown[];
  assertEq(rArr.length, 201, '(4) wide array capped to 200 + marker');
  assertEq(rArr[0], 0, '(4) array head kept');
  assertEq(rArr[199], 199, '(4) array element 199 kept');
  assertEq(rArr[200], '[+300 more]', '(4) array overflow marker');

  const wideObj: Record<string, number> = {};
  for (let i = 0; i < 300; i++) wideObj['k' + i] = i;
  const rObj = serializeMessageMetadata({ obj: wideObj }).obj as Record<string, unknown>;
  assertEq(rObj.k0, 0, '(4) object first key kept');
  assertEq(rObj.k199, 199, '(4) object key 199 kept');
  assertEq(rObj.k200, undefined, '(4) object key beyond cap dropped');
  assertEq(rObj.__omittedKeys, 100, '(4) object omission count');

  // ─── (5) oversized string clipped + TOTAL size bounded ──────────────────────
  const huge = 'A'.repeat(50_000);
  const rHuge = serializeMessageMetadata({ big: huge }) as Record<string, unknown>;
  assert(typeof rHuge.big === 'string', '(5) huge string stays a string');
  assert((rHuge.big as string).length < 4100, '(5) huge string clipped near per-string cap', 'len=' + (rHuge.big as string).length);
  assert((rHuge.big as string).startsWith('AAAA'), '(5) clipped head preserved');
  assert((rHuge.big as string).includes('…[+'), '(5) clip marker present');
  assert(slen(rHuge) <= MESSAGE_METADATA_MAX_BYTES, '(5) total within default ceiling', 'len=' + slen(rHuge));
  // Many big fields still bounded.
  const bigObj: Record<string, string> = {};
  for (let i = 0; i < 60; i++) bigObj['f' + i] = 'x'.repeat(2000);
  assert(slen(serializeMessageMetadata(bigObj)) <= MESSAGE_METADATA_MAX_BYTES, '(5) many big fields bounded');

  // ─── (6) over-budget: whole fields DROPPED (not rewritten), size guaranteed ──
  // A quote-bomb makes real JSON bytes exceed the per-node budget estimate,
  // forcing the total-size guard to drop whole top-level fields.
  const dropMeta = { keep: { hello: 'world', n: 42 }, big1: '"'.repeat(900), big2: '"'.repeat(900) };
  const rDrop = serializeMessageMetadata(dropMeta, { maxBytes: 2000 }) as Record<string, unknown>;
  assert(slen(rDrop) <= 2000, '(6) over-budget result within custom ceiling', 'len=' + slen(rDrop));
  assert(isPlainRecord(rDrop), '(6) over-budget result still a record (structure preserved)');
  assert(Array.isArray(rDrop.__metadataOmittedFields), '(6) omitted-fields marker present');
  assert((rDrop.__metadataOmittedFields as unknown[]).length >= 1, '(6) at least one field dropped');
  // The small early field survives WHOLE (dropped fields are dropped, not lossy-rewritten).
  assertEq(JSON.stringify(rDrop.keep), JSON.stringify({ hello: 'world', n: 42 }), '(6) kept field survives intact');
  assert(rDrop.big1 === undefined || rDrop.big2 === undefined, '(6) at least one big field actually removed');

  // A pathologically tiny budget still yields a valid, provably-small object.
  const rTiny = serializeMessageMetadata(dropMeta, { maxBytes: 1000 }) as Record<string, unknown>;
  assert(slen(rTiny) <= 1000, '(6) tiny budget honored', 'len=' + slen(rTiny));
  assert(isPlainRecord(rTiny), '(6) tiny-budget result still a record');

  // ─── (7) cyclic input → '[cyclic]', no throw, serializable ──────────────────
  const selfObj: any = { name: 'root' };
  selfObj.self = selfObj;
  const rSelf = serializeMessageMetadata({ source: selfObj }) as any;
  assertEq(rSelf.source.name, 'root', '(7) cyclic obj keeps non-cyclic field');
  assertEq(rSelf.source.self, '[cyclic]', '(7) self-reference → [cyclic]');
  assert(slen(rSelf) > 0, '(7) cyclic result serializes (no throw)');

  const a: any = {};
  const b: any = { back: a };
  a.b = b;
  const rMutual = serializeMessageMetadata(a) as any;
  assertEq(rMutual.b.back, '[cyclic]', '(7) mutual a→b→a cycle → [cyclic]');

  // Shared (non-cyclic) DAG must NOT be flagged cyclic (ancestor-path semantics).
  const shared = { x: 1 };
  const rDag = serializeMessageMetadata({ p: shared, q: shared }) as any;
  assertEq(rDag.p.x, 1, '(7) DAG sibling p intact');
  assertEq(rDag.q.x, 1, '(7) DAG sibling q intact (NOT [cyclic])');
  assert(rDag.q !== '[cyclic]', '(7) shared ref is not a cycle');

  // ─── (8) secrets masked everywhere; host/user/prose survive ─────────────────
  const secretMeta: Record<string, unknown> = {
    source: { token: FAKE.openai },
    routing: { note: 'use ' + FAKE.githubClassic + ' then rotate it' },
    usage: { jwt: FAKE.jwt },
    memoriesUsed: [FAKE.anthropic],
    executionStream: [{ body: FAKE.bearer }],
    nested: { deep: [FAKE.awsKey, { u: FAKE.basicUrl }] },
    api: FAKE.apiKey,
  };
  secretMeta[FAKE.bearer] = 'v'; // secret used AS a key
  const rSecret = serializeMessageMetadata(secretMeta);
  const sSecret = JSON.stringify(rSecret);
  assert(sSecret.includes('[REDACTED]'), '(8) mask token present');
  for (const [name, raw] of Object.entries(FAKE)) {
    assert(!sSecret.includes(raw), '(8) raw secret absent: ' + name);
  }
  assert(!sSecret.includes('FAKEsignature0000'), '(8) jwt body gone');
  assert(!sSecret.includes('FAKEpassword123'), '(8) url password gone');
  assert(!sSecret.includes('FAKEabcdefghij0123456789'), '(8) api key body gone');
  assert(sSecret.includes('example.com'), '(8) url host survives');
  assert(sSecret.includes('alice'), '(8) url user survives');
  assert(sSecret.includes('rotate it'), '(8) prose after secret survives');
  assertEq((rSecret as any)['[REDACTED]'], 'v', '(8) secret-shaped key masked, value kept');

  // ─── (9) deep nesting capped at MESSAGE_METADATA_MAX_DEPTH → '[max-depth]' ───
  let deep: any = 'leaf';
  for (let i = 0; i < 14; i++) deep = { v: deep };
  const rDeep = serializeMessageMetadata(deep);
  const sDeep = JSON.stringify(rDeep);
  assert(sDeep.includes('[max-depth]'), '(9) depth ceiling marker present');
  assert(!sDeep.includes('leaf'), '(9) content beyond depth ceiling dropped');
  let cursor: any = rDeep;
  for (let i = 0; i < MESSAGE_METADATA_MAX_DEPTH; i++) cursor = cursor.v;
  assertEq(cursor, '[max-depth]', '(9) node at depth ceiling is the marker');

  // ─── (10) hydrate: legacy aliases, precedence, absent-vs-null, tolerance ─────
  const legacy = hydrateMessageMetadata({
    memories_used: ['legacy-mem'],
    execution_stream: [{ x: 1 }],
    tool_events: [{ t: 'r' }],
    quick_replies: ['hi'],
    source: { s: 1 },
    routing: { r: 1 },
    usage: { u: 1 },
  });
  assertEq(JSON.stringify(legacy.memoriesUsed), JSON.stringify(['legacy-mem']), '(10) legacy memories_used alias');
  assertEq(JSON.stringify(legacy.executionStream), JSON.stringify([{ x: 1 }]), '(10) legacy execution_stream alias');
  assertEq(JSON.stringify(legacy.toolEvents), JSON.stringify([{ t: 'r' }]), '(10) legacy tool_events alias');
  assertEq(JSON.stringify(legacy.quickReplies), JSON.stringify(['hi']), '(10) legacy quick_replies alias');
  assertEq(JSON.stringify(legacy.source), JSON.stringify({ s: 1 }), '(10) source read');
  // Primary key beats legacy alias.
  const both = hydrateMessageMetadata({ memoriesUsed: ['primary'], memories_used: ['legacy'] });
  assertEq(JSON.stringify(both.memoriesUsed), JSON.stringify(['primary']), '(10) primary key beats alias');
  // Missing fields → undefined; explicit null preserved (absent vs null).
  const partial = hydrateMessageMetadata({ source: null });
  assert(Object.prototype.hasOwnProperty.call(partial, 'source'), '(10) explicit null field is present');
  assertEq(partial.source, null, '(10) explicit null preserved');
  assertEq(partial.usage, undefined, '(10) absent field undefined');
  // undefined-valued field is treated as absent.
  assertEq(Object.keys(hydrateMessageMetadata({ source: undefined })).length, 0, '(10) undefined field treated as absent');
  // Non-object rows tolerated.
  for (const bad of [null, undefined, 42, 'x', [], true, NaN]) {
    assertEq(Object.keys(hydrateMessageMetadata(bad as unknown)).length, 0, '(10) non-object hydrate → {} :: ' + String(bad));
  }

  // ─── (11) serialize non-object / opts clamp / determinism ───────────────────
  for (const bad of [null, undefined, 42, 'x', true, [], [1, 2, 3]]) {
    assertEq(slen(serializeMessageMetadata(bad as unknown)), 2, '(11) non-object serialize → {} :: ' + String(bad));
  }
  // Exotic wrappers at top level are not metadata → {}.
  assertEq(slen(serializeMessageMetadata(new Date())), 2, '(11) top-level Date → {}');
  assertEq(slen(serializeMessageMetadata(new Map([['a', 1]]))), 2, '(11) top-level Map → {}');
  assertEq(slen(serializeMessageMetadata(new Set([1]))), 2, '(11) top-level Set → {}');
  assertEq(slen(serializeMessageMetadata(/re/g)), 2, '(11) top-level RegExp → {}');
  assertEq(slen(serializeMessageMetadata(new Error('x'))), 2, '(11) top-level Error → {}');
  // Opts clamp (never throw, always a bounded record).
  const optCases = [{ maxBytes: 5 }, { maxBytes: -5 }, { maxBytes: NaN }, { maxBytes: 1e12 }, {}, undefined];
  for (const opt of optCases) {
    const r = serializeMessageMetadata({ a: 'x'.repeat(100_000) }, opt as any);
    assert(isPlainRecord(r), '(11) opts case is a record :: ' + JSON.stringify(opt));
    assert(slen(r) <= 64_000, '(11) opts case bounded by hard ceiling :: ' + JSON.stringify(opt), 'len=' + slen(r));
  }
  // Determinism: same input twice → identical serialized output.
  const complex = { s: FAKE.jwt, arr: [1, { n: 'x'.repeat(9000) }], big: 'Z'.repeat(20_000) };
  assertEq(
    JSON.stringify(serializeMessageMetadata(complex)),
    JSON.stringify(serializeMessageMetadata(complex)),
    '(11) serializer is deterministic',
  );

  // ─── (12) __proto__ key never pollutes Object.prototype ─────────────────────
  const polluter = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');
  const rPoll = serializeMessageMetadata(polluter) as any;
  assertEq(({} as any).polluted, undefined, '(12) Object.prototype not polluted');
  assertEq(rPoll.safe, 1, '(12) sibling key survives __proto__ handling');
  assert(Object.getPrototypeOf(rPoll) === Object.prototype, '(12) result prototype intact');
  // hydrate never walks the prototype chain for its fields.
  const hp: any = Object.create({ source: { injected: true } });
  hp.usage = { real: 1 };
  const rHp = hydrateMessageMetadata(hp);
  assertEq(rHp.source, undefined, '(12) hydrate ignores inherited source');
  assertEq(JSON.stringify(rHp.usage), JSON.stringify({ real: 1 }), '(12) hydrate reads own usage');

  // ─── (13) hostile / degenerate values never throw ───────────────────────────
  try {
    assertEq((serializeMessageMetadata({ fn: () => 1 }) as any).fn, undefined, '(13) function-valued key dropped');
    assertEq(slen(serializeMessageMetadata({ fn: () => 1 })), 2, '(13) only-function object → {}');
    assertEq((serializeMessageMetadata({ sym: Symbol('x') }) as any).sym, undefined, '(13) symbol-valued key dropped');
    assertEq((serializeMessageMetadata({ big: 10n }) as any).big, '10', '(13) bigint → string');
    assertEq((serializeMessageMetadata({ n: NaN }) as any).n, null, '(13) NaN → null');
    assertEq((serializeMessageMetadata({ i: Infinity }) as any).i, null, '(13) Infinity → null');
    assertEq((serializeMessageMetadata({ i: -Infinity }) as any).i, null, '(13) -Infinity → null');
    assertEq((serializeMessageMetadata({ d: new Date('2020-01-02T03:04:05.000Z') }) as any).d, '2020-01-02T03:04:05.000Z', '(13) nested Date → ISO');
    assertEq((serializeMessageMetadata({ d: new Date('nope') }) as any).d, '[invalid-date]', '(13) invalid Date → marker');
    assertEq((serializeMessageMetadata({ r: /ab+c/gi }) as any).r, '/ab+c/gi', '(13) nested RegExp → source');
    const rMap = serializeMessageMetadata({ m: new Map([['a', 1]]) }) as any;
    assertEq(rMap.m.__type, 'Map', '(13) nested Map tagged');
    assertEq(rMap.m.size, 1, '(13) nested Map size');
    const rSet = serializeMessageMetadata({ s: new Set([1, 2]) }) as any;
    assertEq(rSet.s.__type, 'Set', '(13) nested Set tagged');
    const rErr = serializeMessageMetadata({ e: new Error('boom') }) as any;
    assertEq(rErr.e.__type, 'Error', '(13) nested Error tagged');
    assertEq(rErr.e.message, 'boom', '(13) Error message kept');
    assert(!('stack' in rErr.e), '(13) Error stack excluded');
    // Throwing getter — key dropped, siblings survive.
    const trap: any = { good: 1 };
    Object.defineProperty(trap, 'bad', { enumerable: true, get() { throw new Error('nope'); } });
    const rTrap = serializeMessageMetadata(trap) as any;
    assertEq(rTrap.good, 1, '(13) throwing-getter sibling survives');
    assertEq(rTrap.bad, undefined, '(13) throwing-getter key dropped');
    // hydrate over a throwing getter is total too.
    const htrap: any = {};
    Object.defineProperty(htrap, 'source', { enumerable: true, get() { throw new Error('x'); } });
    assertEq(Object.keys(hydrateMessageMetadata(htrap)).length, 0, '(13) hydrate throwing-getter → skipped');
    // Fully hostile top-level batteries.
    serializeMessageMetadata({ m: new Map([[{ self: 1 }, [1, 2, 3]]]) });
    serializeMessageMetadata({ arr: [undefined, null, () => 0, Symbol('x'), 5n] });
    serializeMessageMetadata({ fn: () => 0, sym: Symbol('y'), big: 9n });
    const cyc: any = {};
    cyc.me = cyc;
    serializeMessageMetadata({ cyc });
    hydrateMessageMetadata({ memoriesUsed: (function* () { yield 1; })() });
    passes += 1; // reached here → no throw across the degenerate battery
  } catch (e) {
    failures += 1;
    console.error('FAIL: (13) degenerate battery threw :: ' + (e as Error)?.message);
  }

  // Type-only touch so the exported interface stays wired.
  const typed: PersistedMessageMetadata = hydrateMessageMetadata({ source: { ok: true } });
  assert(isPlainRecord(typed), '(13) hydrate result satisfies PersistedMessageMetadata');

  console.log('\nmessage-metadata-core smoke: ' + passes + ' passed, ' + failures + ' failed');
}

main();
if (failures > 0) {
  console.error('\n' + failures + ' fail');
  process.exit(1);
}
console.log('\nAll message-metadata-core smoke cases passed (' + passes + ' passed).');
