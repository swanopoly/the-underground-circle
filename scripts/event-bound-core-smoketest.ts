/**
 * event-bound-core-smoketest — the PURE agent_run_events payload bounder
 * (src/lib/eventBoundCore.ts). Load-bearing behavior exercised here:
 *   boundEventPayload — non-tool payloads round-trip unchanged, tool inputs
 *   and arbitrary tool-result bodies become value-free schema summaries,
 *   allowlisted receipt metadata survives, cyclic → '[cyclic]'
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
  PERSISTED_TOOL_FAILURE_TEXT,
  boundEventPayload,
  boundToolCallsAggregate,
  summarizeToolInputForPersistence,
  summarizeToolResultForPersistence,
} from '../src/lib/eventBoundCore';
import { readFileSync } from 'node:fs';

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
  assertEq(typeof summarizeToolInputForPersistence, 'function', '(1) tool input summary is a fn');
  assertEq(typeof summarizeToolResultForPersistence, 'function', '(1) tool result summary is a fn');
  assertEq(typeof PERSISTED_TOOL_FAILURE_TEXT, 'string', '(1) persisted failure copy is fixed');

  const normal = {
    iteration: 3,
    tool: 'read_file',
    tool_use_id: 'toolu_abc',
    input: { path: '/src/x.ts', limit: 100, deep: false },
  };
  const rNormal = boundEventPayload('tool_call_start', normal) as any;
  assertEq(rNormal.iteration, normal.iteration, '(1) tool telemetry preserves iteration');
  assertEq(rNormal.tool, normal.tool, '(1) tool telemetry preserves tool name');
  assertEq(rNormal.tool_use_id, normal.tool_use_id, '(1) tool telemetry preserves provider call identity');
  assertEq(rNormal.input?.redacted, true, '(1) tool telemetry replaces raw input with a redacted summary');
  assertEq(rNormal.input?.fieldCount, 3, '(1) tool telemetry summary preserves field count');
  assertEq(rNormal.input?.schemaVersion, 2, '(1) tool telemetry uses key-free summary schema v2');
  assert(
    rNormal.input?.fieldKinds?.some((field: any) => field.kind === 'string' && field.count === 1),
    '(1) tool telemetry summary preserves aggregate value kinds',
  );
  assert(!JSON.stringify(rNormal).includes('/src/x.ts'), '(1) tool telemetry stores no raw path value');
  const usage = { iteration: 5, stop_reason: 'end_turn', usage: null };
  assertEq(JSON.stringify(boundEventPayload('turn_end', usage)), JSON.stringify(usage), '(1) turn_end payload unchanged');

  const shortSecret = 'hunter2';
  const privateInput = {
    password: shortSecret,
    text: 'private message text',
    path: '/Users/example/private.txt',
    nested: { token: 'short-token', body: 'nested private body' },
  };
  const privateSummary = summarizeToolInputForPersistence('desktop.type_text', privateInput);
  const privateSerialized = JSON.stringify(privateSummary);
  assertEq(privateSummary.redacted, true, '(1) direct tool input summary is explicitly redacted');
  assert(!privateSerialized.includes(shortSecret), '(1) short password is absent from direct summary');
  assert(!privateSerialized.includes('private message text'), '(1) arbitrary typed text is absent from direct summary');
  assert(!privateSerialized.includes('/Users/example/private.txt'), '(1) local path is absent from direct summary');
  assert(!privateSerialized.includes('short-token'), '(1) nested secret value is absent from direct summary');
  assert(!privateSerialized.includes('nested private body'), '(1) nested arbitrary content is absent from direct summary');
  assert(
    (privateSummary.fieldKinds as any[])?.some((field) => field.kind === 'redacted' && field.count === 1),
    '(1) sensitive field presence is retained only as an aggregate count',
  );
  const dynamicKeySummary = summarizeToolInputForPersistence('custom.dynamic_map', {
    customer_ssn_123456789: 'value',
    private_filename_psych_notes: 'value',
    hunter2: 'value',
  });
  const dynamicKeySerialized = JSON.stringify(dynamicKeySummary);
  assert(!dynamicKeySerialized.includes('customer_ssn_123456789'), '(1) dynamic customer keys never persist');
  assert(!dynamicKeySerialized.includes('private_filename_psych_notes'), '(1) dynamic filename keys never persist');
  assert(!dynamicKeySerialized.includes('hunter2'), '(1) arbitrary dynamic keys never persist');

  const privateResult = summarizeToolResultForPersistence(
    '/Users/private/tool',
    {
      status: '/Users/private/result.log',
      message: 'hunter2',
      nested: { content: 'private content' },
    },
    '/Users/private/status',
  );
  const privateResultSerialized = JSON.stringify(privateResult);
  assertEq(privateResult.tool, 'unknown', '(1) invalid tool-name values collapse to unknown');
  assertEq(privateResult.status, 'unknown', '(1) invalid result status values collapse to unknown');
  assert(!privateResultSerialized.includes('hunter2'), '(1) successful result summary omits arbitrary values');
  assert(!privateResultSerialized.includes('/Users/private'), '(1) successful result summary omits paths');
  assert(!privateResultSerialized.includes('private content'), '(1) successful result summary omits nested content');

  const sessionRuntimeSource = readFileSync('src/lib/openswanSessionRuntime.ts', 'utf8');
  const subagentSource = readFileSync('src/lib/subagentRegistry.ts', 'utf8');
  const compatibilityLoopSource = readFileSync('src/lib/openswanRuntimeToolLoop.ts', 'utf8');
  const persistenceSource = readFileSync('src/lib/agentRunPersistence.ts', 'utf8');
  const ledgerPersistenceSource = readFileSync('src/lib/agentRunLedgerPersistence.ts', 'utf8');
  for (const [label, source] of [
    ['OpenSwan session', sessionRuntimeSource],
    ['subagent registry', subagentSource],
    ['compatibility loop', compatibilityLoopSource],
  ] as const) {
    assert(
      source.includes('summarizeToolInputForPersistence'),
      `(1) ${label} uses value-free persisted tool-input summaries`,
    );
    assert(
      source.includes('summarizeToolResultForPersistence'),
      `(1) ${label} uses value-free persisted tool-result summaries`,
    );
    assert(
      source.includes('sanitizeToolActionMetadataForPersistence'),
      `(1) ${label} projects hidden action metadata before persistence`,
    );
  }
  assert(
    !sessionRuntimeSource.includes('input: event.input,'),
    '(1) OpenSwan direct run-event telemetry never persists raw provider tool input',
  );
  assert(
    !sessionRuntimeSource.includes("input_preview: typeof evt.input === 'string'"),
    '(1) OpenSwan action previews never serialize raw tool input',
  );
  assert(
    !subagentSource.includes("input_preview: typeof evt.input === 'string'"),
    '(1) delegated action previews never serialize raw tool input',
  );
  assert(
    subagentSource.includes('body: PERSISTED_TOOL_FAILURE_TEXT')
      && !subagentSource.includes("body: err.message"),
    '(1) delegated run failure steps persist fixed redacted copy',
  );
  assert(
    !compatibilityLoopSource.includes('input_preview: JSON.stringify(event.input'),
    '(1) compatibility action previews never serialize raw tool input',
  );
  assert(
    !sessionRuntimeSource.includes('evt.result.slice')
      && !compatibilityLoopSource.includes('event.result.slice'),
    '(1) successful action previews never persist raw result strings',
  );
  assert(
    sessionRuntimeSource.includes('tool_loop_failed_text_fallback')
      && !sessionRuntimeSource.includes('toolErr?.message')
      && !sessionRuntimeSource.includes('turnErr instanceof Error ? turnErr.message'),
    '(1) session fallback telemetry omits raw tool/turn exceptions',
  );
  assert(
    persistenceSource.includes("error_code: 'agent_run_failed'")
      && !persistenceSource.includes('stack: err instanceof Error ? err.stack'),
    '(1) terminal run errors persist only a stable redacted code',
  );
  assert(
    !ledgerPersistenceSource.includes('raw_error: action.output_preview')
      && !ledgerPersistenceSource.includes('raw_error: event.summary')
      && ledgerPersistenceSource.includes('raw_error: PERSISTED_TOOL_FAILURE_TEXT'),
    '(1) ledger failure rows never persist raw tool/provider error text',
  );

  const failedToolPayload = boundEventPayload('tool_call_result', {
    iteration: 4,
    tool: 'desktop.launch_app',
    ok: false,
    error: '401 token=short-secret /Users/example/private.log',
  }) as any;
  const failedToolSerialized = JSON.stringify(failedToolPayload);
  assertEq(failedToolPayload.error, PERSISTED_TOOL_FAILURE_TEXT, '(1) failed tool telemetry uses fixed redacted copy');
  assertEq(failedToolPayload.error_code, 'tool_call_failed', '(1) failed tool telemetry carries a stable recovery code');
  assertEq(failedToolPayload.redacted, true, '(1) failed tool telemetry declares redaction');
  assert(!failedToolSerialized.includes('short-secret'), '(1) failed tool telemetry omits provider exception details');
  assert(!failedToolSerialized.includes('/Users/example/private.log'), '(1) failed tool telemetry omits local paths');

  const privateSuccessValue = 'private-success-body-hunter2';
  const privateSuccessPath = '/Users/example/private/customer-payroll.txt';
  const dynamicPrivateKey = 'customer_ssn_123_45_6789';
  const receiptFingerprint = `args-v2:sha256:${'b'.repeat(64)}`;
  const successfulToolPayload = boundEventPayload('tool_call_result', {
    iteration: 5,
    tool: 'desktop.click',
    tool_use_id: 'toolu_private_success',
    ok: true,
    duration_ms: 19,
    dispatched: true,
    result: {
      body: privateSuccessValue,
      path: privateSuccessPath,
      nested: {
        token: 'short-private-token',
        content: 'nested-private-content',
      },
    },
    output: privateSuccessValue,
    data: { privatePath: privateSuccessPath },
    content: 'private-content-field',
    body: 'private-body-field',
    path: privateSuccessPath,
    [dynamicPrivateKey]: 'dynamic-private-value',
    metadata: {
      computerActionReceipt: {
        schemaVersion: 1,
        tool: 'desktop.click',
        surface: 'desktop',
        toolArgsFingerprint: receiptFingerprint,
        handlerEnteredAt: '2026-07-27T12:00:00.000Z',
        outcome: 'succeeded',
        status: 'pending',
        mutates: true,
        approvalRequired: true,
        iteration: 5,
        durationMs: 19,
        body: privateSuccessValue,
        path: privateSuccessPath,
        [dynamicPrivateKey]: 'must-not-survive',
      },
      verificationReceipt: {
        verdict: 'verified',
        committed: true,
        commitRef: 'abcdef1234567',
        editedFileCount: 2,
        checkCount: 1,
        passedCheckCount: 1,
        failedCheckCount: 0,
        editedFiles: [privateSuccessPath],
      },
      computerAppVerificationReceipt: {
        schemaVersion: true,
        status: true,
        checkedAt: privateSuccessPath,
        canComplete: 'yes',
        evidenceCount: false,
        blockerCount: '0',
      },
      unrecognizedReceipt: {
        body: privateSuccessValue,
        path: privateSuccessPath,
      },
    },
  }) as any;
  const successfulToolSerialized = JSON.stringify(successfulToolPayload);
  assertEq(successfulToolPayload.iteration, 5, '(1) successful tool summary preserves iteration');
  assertEq(successfulToolPayload.tool, 'desktop.click', '(1) successful tool summary preserves safe tool identity');
  assertEq(successfulToolPayload.tool_use_id, 'toolu_private_success', '(1) successful tool summary preserves safe call identity');
  assertEq(successfulToolPayload.ok, true, '(1) successful tool summary preserves success state');
  assertEq(successfulToolPayload.dispatched, true, '(1) successful tool summary preserves dispatch truth');
  assertEq(successfulToolPayload.result_summary?.schemaVersion, 2, '(1) raw success payload becomes schema-v2 summary');
  assertEq(successfulToolPayload.result_summary?.redacted, true, '(1) success result summary declares redaction');
  assertEq(successfulToolPayload.result_summary?.status, 'success', '(1) success result summary keeps only controlled status');
  assertEq(successfulToolPayload.result_summary?.resultKind, 'object', '(1) success result summary keeps only structural kind');
  assertEq(successfulToolPayload.result_summary?.fieldCount, 7, '(1) all future/raw success fields contribute only a count');
  for (const rawField of ['result', 'output', 'data', 'content', 'body', 'path', dynamicPrivateKey]) {
    assert(
      !Object.prototype.hasOwnProperty.call(successfulToolPayload, rawField),
      `(1) raw success field is absent: ${rawField}`,
    );
  }
  for (const rawValue of [
    privateSuccessValue,
    privateSuccessPath,
    'short-private-token',
    'nested-private-content',
    'private-content-field',
    'private-body-field',
    'dynamic-private-value',
    dynamicPrivateKey,
  ]) {
    assert(
      !successfulToolSerialized.includes(rawValue),
      `(1) raw success value/key is absent: ${rawValue}`,
    );
  }
  assertEq(
    successfulToolPayload.metadata?.computerActionReceipt?.toolArgsFingerprint,
    receiptFingerprint,
    '(1) allowlisted action fingerprint survives the final event boundary',
  );
  assertEq(
    successfulToolPayload.metadata?.computerActionReceipt?.outcome,
    'succeeded',
    '(1) allowlisted action outcome survives the final event boundary',
  );
  assertEq(
    successfulToolPayload.metadata?.computerActionReceipt?.status,
    'pending',
    '(1) allowlisted pending receipt status survives the final event boundary',
  );
  assertEq(
    successfulToolPayload.metadata?.verificationReceipt?.commitRef,
    'abcdef1234567',
    '(1) allowlisted verification commit survives the final event boundary',
  );
  assert(
    !Object.prototype.hasOwnProperty.call(
      successfulToolPayload.metadata?.computerActionReceipt || {},
      'body',
    ),
    '(1) free-form receipt body is removed',
  );
  assert(
    !Object.prototype.hasOwnProperty.call(successfulToolPayload.metadata || {}, 'unrecognizedReceipt'),
    '(1) unrecognized metadata namespace is removed',
  );
  assert(
    !Object.prototype.hasOwnProperty.call(
      successfulToolPayload.metadata || {},
      'computerAppVerificationReceipt',
    ),
    '(1) receipt fields with the wrong primitive types cannot survive',
  );

  const cyclicSuccessResult: any = { label: privateSuccessValue };
  cyclicSuccessResult.self = cyclicSuccessResult;
  const boundedCyclicSuccess = boundEventPayload('tool_call_result', {
    tool: 'desktop.read_a11y_tree',
    ok: true,
    result: cyclicSuccessResult,
  }) as any;
  assertEq(
    boundedCyclicSuccess.result_summary?.resultKind,
    'object',
    '(1) cyclic successful results reduce to structure without traversal',
  );
  assert(
    !JSON.stringify(boundedCyclicSuccess).includes(privateSuccessValue),
    '(1) cyclic successful result values never reach durable output',
  );

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
