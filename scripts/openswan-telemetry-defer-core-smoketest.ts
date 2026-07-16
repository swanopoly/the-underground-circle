/**
 * Smoke test for src/lib/openswanTelemetryDeferCore.ts
 *
 * Verifies the R2 pre-loop telemetry defer classifier + scheduler:
 *  - createRun / memory recall / system prompt → await_blocking
 *  - merge_metadata → update_status ordering preserved in deferredOrdered
 *  - pure transcript telemetry → fire_and_forget
 *  - cyclic / missing dependency → fail-closed to await_blocking (never dropped)
 *  - dependency already satisfied by the blocking phase → demoted to fireAndForget
 *  - total / bounded / no-throw on hostile input
 *
 * Run: npx tsx scripts/openswan-telemetry-defer-core-smoketest.ts
 */

import {
  classifyTelemetryWrite,
  planTelemetrySchedule,
  type TelemetryWriteDescriptor,
  type TelemetrySchedule,
} from '../src/lib/openswanTelemetryDeferCore';

let passes = 0;
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`FAIL: ${msg}`);
  }
}

function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = actual === expected;
  if (!ok) console.error(`  expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  assert(ok, msg);
}

function assertJson(actual: unknown, expected: unknown, msg: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) console.error(`  expected=${e} actual=${a}`);
  assert(a === e, msg);
}

function noThrow(fn: () => unknown, msg: string): void {
  try {
    fn();
    passes += 1;
  } catch (err) {
    failures += 1;
    console.error(`FAIL (threw): ${msg} :: ${String(err)}`);
  }
}

const w = (
  id: string,
  kind: string,
  extra?: Partial<TelemetryWriteDescriptor>,
): TelemetryWriteDescriptor => ({ id, kind, ...extra });

function allScheduledIds(s: TelemetrySchedule): string[] {
  return [...s.blocking, ...s.deferredOrdered.flat(), ...s.fireAndForget];
}

/** Assert the schedule is a clean partition of `ids` (present once, disjoint). */
function assertPartition(s: TelemetrySchedule, ids: string[], label: string): void {
  const scheduled = allScheduledIds(s);
  assertEq(scheduled.length, new Set(scheduled).size, `${label}: buckets disjoint (no dup ids)`);
  assertEq(new Set(scheduled).size, new Set(ids).size, `${label}: every id scheduled exactly once`);
  for (const id of ids) assert(scheduled.includes(id), `${label}: ${id} present in schedule`);
}

function chainOf(s: TelemetrySchedule, id: string): string[] | null {
  for (const chain of s.deferredOrdered) if (chain.includes(id)) return chain;
  return null;
}

// ── Group 1: classify — blocking (critical path) ─────────────────────────────
{
  assertEq(classifyTelemetryWrite(w('r', 'create_run')).disposition, 'await_blocking', '1.createRun → blocking');
  assertEq(classifyTelemetryWrite(w('r', 'createRun')).disposition, 'await_blocking', '1.createRun camel alias → blocking');
  assertEq(classifyTelemetryWrite(w('m', 'memory_recall')).disposition, 'await_blocking', '1.memory_recall → blocking');
  assertEq(classifyTelemetryWrite(w('m', 'memory_stores')).disposition, 'await_blocking', '1.memory_stores → blocking');
  assertEq(classifyTelemetryWrite(w('m', 'buildOpenSwanMemoryStores')).disposition, 'await_blocking', '1.memory recall verbose alias → blocking');
  assertEq(classifyTelemetryWrite(w('s', 'system_prompt')).disposition, 'await_blocking', '1.system_prompt → blocking');
  assertEq(classifyTelemetryWrite(w('s', 'buildStreamableSystemPrompt')).disposition, 'await_blocking', '1.system prompt verbose alias → blocking');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: true })).disposition, 'await_blocking', '1.blocksModelCall=true overrides telemetry kind');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: 'true' })).disposition, 'await_blocking', "1.blocksModelCall='true' → blocking");
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: 1 })).disposition, 'await_blocking', '1.blocksModelCall=1 → blocking');
  assert(classifyTelemetryWrite(w('r', 'create_run')).reason.length > 0, '1.blocking carries a reason');
}

// ── Group 2: classify — fire-and-forget telemetry ────────────────────────────
{
  assertEq(classifyTelemetryWrite(w('a', 'transcript')).disposition, 'defer_fire_and_forget', '2.transcript → fire');
  assertEq(classifyTelemetryWrite(w('a', 'transcript_header')).disposition, 'defer_fire_and_forget', '2.transcript_header → fire');
  assertEq(classifyTelemetryWrite(w('a', 'update_status')).disposition, 'defer_fire_and_forget', '2.update_status (no dep) → fire');
  assertEq(classifyTelemetryWrite(w('a', 'merge_metadata')).disposition, 'defer_fire_and_forget', '2.merge_metadata (no dep) → fire');
  assertEq(classifyTelemetryWrite(w('a', 'add_step')).disposition, 'defer_fire_and_forget', '2.add_step → fire');
  assertEq(classifyTelemetryWrite(w('a', 'add_artifact')).disposition, 'defer_fire_and_forget', '2.add_artifact → fire');
  assertEq(classifyTelemetryWrite(w('a', 'session_started')).disposition, 'defer_fire_and_forget', '2.session_started → fire');
  assertEq(classifyTelemetryWrite(w('a', 'user_turn')).disposition, 'defer_fire_and_forget', '2.user_turn → fire');
  assertEq(classifyTelemetryWrite(w('a', 'context_loaded')).disposition, 'defer_fire_and_forget', '2.context_loaded → fire');
  // The memory_loaded EVENT is telemetry — must NOT be confused with the recall.
  assertEq(classifyTelemetryWrite(w('a', 'memory_loaded')).disposition, 'defer_fire_and_forget', '2.memory_loaded event → fire (not blocking)');
  assertEq(classifyTelemetryWrite(w('a', 'appendTranscriptEvent')).disposition, 'defer_fire_and_forget', '2.appendTranscriptEvent alias → fire');
  assertEq(classifyTelemetryWrite(w('a', 'ledger_preview')).disposition, 'defer_fire_and_forget', '2.ledger_preview → fire');
}

// ── Group 3: classify — ordered (has dependency) ─────────────────────────────
{
  assertEq(classifyTelemetryWrite(w('s', 'update_status', { dependsOn: ['m'] })).disposition, 'defer_ordered', '3.update_status dependsOn merge → ordered');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { dependsOn: ['x'] })).disposition, 'defer_ordered', '3.transcript with dep → ordered');
  assertEq(classifyTelemetryWrite(w('t', 'add_step', { dependsOn: ['a', 'b'] })).disposition, 'defer_ordered', '3.multi-dep → ordered');
  // blocksModelCall still wins over a dependency.
  assertEq(classifyTelemetryWrite(w('t', 'update_status', { dependsOn: ['m'], blocksModelCall: true })).disposition, 'await_blocking', '3.blocking beats ordered');
  // empty dependsOn array → no dependency.
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { dependsOn: [] })).disposition, 'defer_fire_and_forget', '3.empty dep array → fire');
}

// ── Group 4: classify — fail-closed ──────────────────────────────────────────
{
  assertEq(classifyTelemetryWrite(w('u', 'frobnicate')).disposition, 'await_blocking', '4.unknown kind → blocking');
  assertEq(classifyTelemetryWrite(w('u', '')).disposition, 'await_blocking', '4.empty kind → blocking');
  assertEq(classifyTelemetryWrite(w('u', '   ')).disposition, 'await_blocking', '4.whitespace kind → blocking');
  assertEq(classifyTelemetryWrite({ id: '', kind: 'transcript' }).disposition, 'await_blocking', '4.missing id → blocking');
  assertEq(classifyTelemetryWrite({ kind: 'transcript' } as unknown as TelemetryWriteDescriptor).disposition, 'await_blocking', '4.absent id → blocking');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: {} })).disposition, 'await_blocking', '4.ambiguous object flag → blocking');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: NaN })).disposition, 'await_blocking', '4.NaN flag → blocking');
  // benign falsy flags do NOT force blocking.
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: false })).disposition, 'defer_fire_and_forget', '4.false flag → still fire');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: 0 })).disposition, 'defer_fire_and_forget', '4.0 flag → still fire');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: 'false' })).disposition, 'defer_fire_and_forget', "4.'false' flag → still fire");
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { blocksModelCall: null })).disposition, 'defer_fire_and_forget', '4.null flag → still fire');
}

// ── Group 5: schedule — realistic pre-loop partition ─────────────────────────
{
  const writes: TelemetryWriteDescriptor[] = [
    w('create_run', 'create_run', { blocksModelCall: true }),
    w('hdr', 'transcript_header'),
    w('ev_started', 'session_started'),
    w('ev_user', 'user_turn'),
    w('memory', 'memory_recall', { blocksModelCall: true }),
    w('ev_ctx', 'context_loaded'),
    w('sysprompt', 'system_prompt', { blocksModelCall: true }),
  ];
  const s = planTelemetrySchedule(writes);
  assert(s.blocking.includes('create_run'), '5.create_run blocking');
  assert(s.blocking.includes('memory'), '5.memory recall blocking');
  assert(s.blocking.includes('sysprompt'), '5.system prompt blocking');
  assert(s.fireAndForget.includes('hdr'), '5.transcript header fire');
  assert(s.fireAndForget.includes('ev_started'), '5.session_started fire');
  assert(s.fireAndForget.includes('ev_user'), '5.user_turn fire');
  assert(s.fireAndForget.includes('ev_ctx'), '5.context_loaded fire');
  assertEq(s.deferredOrdered.length, 0, '5.no ordered chains when nothing depends');
  // blocking order follows input order
  assertJson(s.blocking, ['create_run', 'memory', 'sysprompt'], '5.blocking in input order');
  assertPartition(s, writes.map((x) => x.id), '5');
}

// ── Group 6: merge → status ordering preserved in deferredOrdered ────────────
{
  const writes: TelemetryWriteDescriptor[] = [
    w('merge_meta', 'merge_metadata'),
    w('update_status', 'update_status', { dependsOn: ['merge_meta'] }),
  ];
  const s = planTelemetrySchedule(writes);
  assertEq(s.deferredOrdered.length, 1, '6.one ordered chain');
  const chain = chainOf(s, 'update_status');
  assert(chain !== null, '6.update_status is in an ordered chain');
  assert(chain!.includes('merge_meta'), '6.merge pulled into the chain');
  const mi = chain!.indexOf('merge_meta');
  const si = chain!.indexOf('update_status');
  assert(mi >= 0 && si >= 0 && mi < si, '6.merge precedes update_status');
  assert(!s.fireAndForget.includes('merge_meta'), '6.merge not left as loose fire-and-forget');
  assert(!s.fireAndForget.includes('update_status'), '6.status not fire-and-forget');
  assert(s.blocking.length === 0, '6.nothing blocking');
  assertJson(chain, ['merge_meta', 'update_status'], '6.exact chain order');
  assertPartition(s, writes.map((x) => x.id), '6');
}

// ── Group 7: dep satisfied by blocking phase → demote to fireAndForget ───────
{
  // status depends only on create_run, which is blocking (awaited before the
  // loop). The dependency is therefore already satisfied → status may fire.
  const writes: TelemetryWriteDescriptor[] = [
    w('create_run', 'create_run', { blocksModelCall: true }),
    w('status', 'update_status', { dependsOn: ['create_run'] }),
  ];
  const s = planTelemetrySchedule(writes);
  assert(s.blocking.includes('create_run'), '7.create_run blocking');
  assert(s.fireAndForget.includes('status'), '7.status demoted to fire (dep already awaited)');
  assertEq(s.deferredOrdered.length, 0, '7.no ordered chain needed');
  assertPartition(s, writes.map((x) => x.id), '7');
}

// ── Group 8: cyclic dependency → fail-closed to blocking (never dropped) ─────
{
  const writes: TelemetryWriteDescriptor[] = [
    w('a', 'transcript', { dependsOn: ['b'] }),
    w('b', 'transcript', { dependsOn: ['a'] }),
  ];
  const s = planTelemetrySchedule(writes);
  assert(s.blocking.includes('a'), '8.cycle node a → blocking');
  assert(s.blocking.includes('b'), '8.cycle node b → blocking');
  assertEq(s.deferredOrdered.length, 0, '8.no ordered chain from a cycle');
  assert(!s.fireAndForget.includes('a') && !s.fireAndForget.includes('b'), '8.cycle nodes not fire-and-forget');
  assertPartition(s, ['a', 'b'], '8'); // nothing dropped
}

// ── Group 9: 3-node cycle + self-loop → fail-closed ──────────────────────────
{
  const cyc = planTelemetrySchedule([
    w('x', 'transcript', { dependsOn: ['y'] }),
    w('y', 'transcript', { dependsOn: ['z'] }),
    w('z', 'transcript', { dependsOn: ['x'] }),
  ]);
  assert(cyc.blocking.includes('x') && cyc.blocking.includes('y') && cyc.blocking.includes('z'), '9.3-cycle all blocking');
  assertEq(cyc.deferredOrdered.length, 0, '9.3-cycle → no chains');

  const self = planTelemetrySchedule([w('self', 'transcript', { dependsOn: ['self'] })]);
  assert(self.blocking.includes('self'), '9.self-loop → blocking');
  assertPartition(self, ['self'], '9.self');
}

// ── Group 10: missing dependency → fail-closed to blocking ───────────────────
{
  const s = planTelemetrySchedule([
    w('present', 'transcript'),
    w('needy', 'update_status', { dependsOn: ['ghost'] }),
  ]);
  assert(s.blocking.includes('needy'), '10.write with missing dep → blocking');
  assert(s.fireAndForget.includes('present'), '10.independent telemetry still fire');
  assert(!allScheduledIds(s).includes('ghost'), '10.phantom dep id not invented');
  assertPartition(s, ['present', 'needy'], '10');
}

// ── Group 11: multiple independent chains, sorted by input position ──────────
{
  const writes: TelemetryWriteDescriptor[] = [
    w('m1', 'merge_metadata'),
    w('s1', 'update_status', { dependsOn: ['m1'] }),
    w('loose', 'transcript'),
    w('m2', 'merge_metadata'),
    w('s2', 'update_status', { dependsOn: ['m2'] }),
  ];
  const s = planTelemetrySchedule(writes);
  assertEq(s.deferredOrdered.length, 2, '11.two independent chains');
  assertJson(s.deferredOrdered[0], ['m1', 's1'], '11.first chain m1→s1');
  assertJson(s.deferredOrdered[1], ['m2', 's2'], '11.second chain m2→s2');
  assert(s.fireAndForget.includes('loose'), '11.unrelated telemetry fire-and-forget');
  assertPartition(s, writes.map((x) => x.id), '11');
}

// ── Group 12: longer 3-link chain preserves order ────────────────────────────
{
  const s = planTelemetrySchedule([
    w('c', 'update_status', { dependsOn: ['b'] }),
    w('b', 'add_step', { dependsOn: ['a'] }),
    w('a', 'merge_metadata'),
  ]);
  assertEq(s.deferredOrdered.length, 1, '12.single chain');
  assertJson(s.deferredOrdered[0], ['a', 'b', 'c'], '12.a→b→c topological order (despite reversed input)');
  assertPartition(s, ['a', 'b', 'c'], '12');
}

// ── Group 13: diamond dependency stays acyclic + one chain ───────────────────
{
  const s = planTelemetrySchedule([
    w('root', 'merge_metadata'),
    w('l', 'add_step', { dependsOn: ['root'] }),
    w('r', 'add_step', { dependsOn: ['root'] }),
    w('sink', 'update_status', { dependsOn: ['l', 'r'] }),
  ]);
  assertEq(s.deferredOrdered.length, 1, '13.diamond → one connected chain');
  const chain = s.deferredOrdered[0];
  assertEq(chain[0], 'root', '13.root first');
  assertEq(chain[chain.length - 1], 'sink', '13.sink last');
  assert(chain.indexOf('l') < chain.indexOf('sink'), '13.l before sink');
  assert(chain.indexOf('r') < chain.indexOf('sink'), '13.r before sink');
  assert(chain.indexOf('root') < chain.indexOf('l'), '13.root before l');
  assertPartition(s, ['root', 'l', 'r', 'sink'], '13');
}

// ── Group 14: determinism / idempotence ──────────────────────────────────────
{
  const writes: TelemetryWriteDescriptor[] = [
    w('create_run', 'create_run', { blocksModelCall: true }),
    w('m', 'merge_metadata'),
    w('s', 'update_status', { dependsOn: ['m'] }),
    w('t', 'transcript'),
  ];
  const a = planTelemetrySchedule(writes);
  const b = planTelemetrySchedule(writes);
  assertJson(a, b, '14.same input → identical schedule');
  // classify is pure too
  assertJson(classifyTelemetryWrite(w('m', 'merge_metadata')), classifyTelemetryWrite(w('m', 'merge_metadata')), '14.classify deterministic');
}

// ── Group 15: dedupe + malformed entries skipped ─────────────────────────────
{
  const s = planTelemetrySchedule([
    w('dup', 'transcript'),
    w('dup', 'update_status', { dependsOn: ['x'] }), // duplicate id → ignored
    null,
    undefined,
    42,
    'nope',
    [],
    { id: '', kind: 'transcript' }, // no usable id → skipped
    w('ok', 'transcript'),
  ] as unknown[]);
  assertEq(allScheduledIds(s).filter((id) => id === 'dup').length, 1, '15.duplicate id scheduled once');
  assert(s.fireAndForget.includes('dup'), '15.first dup wins (transcript → fire)');
  assert(s.fireAndForget.includes('ok'), '15.valid trailing entry scheduled');
  assertEq(new Set(allScheduledIds(s)).size, 2, '15.only 2 valid unique ids');
}

// ── Group 16: hostile / no-throw ─────────────────────────────────────────────
{
  noThrow(() => planTelemetrySchedule(null), '16.schedule(null)');
  noThrow(() => planTelemetrySchedule(undefined), '16.schedule(undefined)');
  noThrow(() => planTelemetrySchedule(123 as unknown), '16.schedule(number)');
  noThrow(() => planTelemetrySchedule('x' as unknown), '16.schedule(string)');
  noThrow(() => planTelemetrySchedule({} as unknown), '16.schedule(object)');
  noThrow(() => planTelemetrySchedule([] as unknown), '16.schedule(empty array)');
  noThrow(() => classifyTelemetryWrite(null as unknown as TelemetryWriteDescriptor), '16.classify(null)');
  noThrow(() => classifyTelemetryWrite(undefined as unknown as TelemetryWriteDescriptor), '16.classify(undefined)');
  noThrow(() => classifyTelemetryWrite(7 as unknown as TelemetryWriteDescriptor), '16.classify(number)');
  noThrow(() => classifyTelemetryWrite([] as unknown as TelemetryWriteDescriptor), '16.classify(array)');
  noThrow(() => classifyTelemetryWrite('str' as unknown as TelemetryWriteDescriptor), '16.classify(string)');

  // empty inputs → empty schedule shape
  assertJson(planTelemetrySchedule(null), { blocking: [], deferredOrdered: [], fireAndForget: [] }, '16.null → empty schedule');
  assertJson(planTelemetrySchedule([]), { blocking: [], deferredOrdered: [], fireAndForget: [] }, '16.[] → empty schedule');

  // cyclic descriptor object (self-referential fields) must not hang or throw.
  const cyclic: Record<string, unknown> = { id: 'c', kind: 'transcript' };
  cyclic.self = cyclic;
  cyclic.dependsOn = cyclic; // dependsOn is not an array → ignored
  noThrow(() => classifyTelemetryWrite(cyclic as unknown as TelemetryWriteDescriptor), '16.classify(cyclic object)');
  assertEq(classifyTelemetryWrite(cyclic as unknown as TelemetryWriteDescriptor).disposition, 'defer_fire_and_forget', '16.cyclic non-array dependsOn ignored → fire');

  const cyclicArr: unknown[] = [];
  cyclicArr.push(cyclicArr);
  noThrow(() => classifyTelemetryWrite({ id: 'z', kind: 'transcript', dependsOn: cyclicArr } as unknown as TelemetryWriteDescriptor), '16.classify(cyclic dep array)');
}

// ── Group 17: bounded on huge / oversized input ──────────────────────────────
{
  const many: TelemetryWriteDescriptor[] = [];
  for (let i = 0; i < 6000; i += 1) many.push(w(`n${i}`, 'transcript'));
  let big: TelemetrySchedule | null = null;
  noThrow(() => {
    big = planTelemetrySchedule(many);
  }, '17.schedule(6000 items) no-throw');
  assert(big !== null, '17.produced a schedule');
  // bounded: never schedules more than the internal cap.
  assert(allScheduledIds(big as unknown as TelemetrySchedule).length <= 4096, '17.output bounded by cap');
  assert(allScheduledIds(big as unknown as TelemetrySchedule).length > 0, '17.still schedules within cap');

  // huge dependsOn array bounded, no-throw.
  const hugeDeps: string[] = [];
  for (let i = 0; i < 5000; i += 1) hugeDeps.push(`d${i}`);
  noThrow(() => classifyTelemetryWrite(w('h', 'update_status', { dependsOn: hugeDeps })), '17.huge dependsOn no-throw');
  assertEq(classifyTelemetryWrite(w('h', 'update_status', { dependsOn: hugeDeps })).disposition, 'defer_ordered', '17.huge dependsOn → ordered');

  // very long id / kind clamped, no-throw.
  const longId = 'x'.repeat(10000);
  noThrow(() => classifyTelemetryWrite(w(longId, 'y'.repeat(10000))), '17.long id/kind no-throw');
}

// ── Group 18: dependsOn wrong types treated as no-dependency ─────────────────
{
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { dependsOn: 'not-array' })).disposition, 'defer_fire_and_forget', '18.string dependsOn → no dep');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { dependsOn: 5 })).disposition, 'defer_fire_and_forget', '18.number dependsOn → no dep');
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { dependsOn: {} })).disposition, 'defer_fire_and_forget', '18.object dependsOn → no dep');
  // dependsOn array with only junk entries → no usable dep → fire.
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { dependsOn: [null, 3, {}, ''] })).disposition, 'defer_fire_and_forget', '18.junk-only dep array → no dep');
  // dependsOn array with one real id among junk → ordered.
  assertEq(classifyTelemetryWrite(w('t', 'transcript', { dependsOn: [null, 'real', {}] })).disposition, 'defer_ordered', '18.one real dep among junk → ordered');
}

// ── Group 19: mixed batch invariants ─────────────────────────────────────────
{
  const writes: TelemetryWriteDescriptor[] = [
    w('run', 'create_run', { blocksModelCall: true }),
    w('hdr', 'transcript_header'),
    w('merge', 'merge_metadata'),
    w('status', 'update_status', { dependsOn: ['merge'] }),
    w('step', 'add_step', { dependsOn: ['status'] }),
    w('mem', 'memory_recall', { blocksModelCall: true }),
    w('loose', 'context_loaded'),
    w('bad', 'weird_unknown_kind'),
  ];
  const s = planTelemetrySchedule(writes);
  assert(s.blocking.includes('run') && s.blocking.includes('mem'), '19.critical-path writes blocking');
  assert(s.blocking.includes('bad'), '19.unknown kind fail-closed blocking');
  assert(s.fireAndForget.includes('hdr') && s.fireAndForget.includes('loose'), '19.pure telemetry fire');
  const chain = chainOf(s, 'step');
  assert(chain !== null, '19.step in ordered chain');
  assertJson(chain, ['merge', 'status', 'step'], '19.merge→status→step order');
  assertPartition(s, writes.map((x) => x.id), '19');
}

// ── Group 20: return-shape contract ──────────────────────────────────────────
{
  const s = planTelemetrySchedule([w('a', 'transcript')]);
  assert(Array.isArray(s.blocking), '20.blocking is array');
  assert(Array.isArray(s.deferredOrdered), '20.deferredOrdered is array');
  assert(Array.isArray(s.fireAndForget), '20.fireAndForget is array');
  assert(s.deferredOrdered.every((c) => Array.isArray(c)), '20.each chain is an array');
  const c = classifyTelemetryWrite(w('a', 'transcript'));
  assert(typeof c.disposition === 'string' && typeof c.reason === 'string', '20.classification shape');
  const dispositions = new Set(['await_blocking', 'defer_ordered', 'defer_fire_and_forget']);
  assert(dispositions.has(c.disposition), '20.disposition in enum');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\nopenswanTelemetryDeferCore smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.error('SMOKE FAILED');
  process.exit(1);
}
console.log('ALL openswanTelemetryDeferCore SMOKE ASSERTIONS PASSED');
