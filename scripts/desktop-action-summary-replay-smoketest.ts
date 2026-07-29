/**
 * desktop-action-summary-replay-smoketest
 *
 * Cross-module regression for the durable-event → desktop replay seam:
 *
 *   - `eventBoundCore` emits value-free schema-v2 input and result summaries
 *     (including dynamic custom-tool maps).
 *   - `agentRunSystem.addStep` applies both summaries at its final persistence
 *     boundary, even when callers pass raw command/output text.
 *   - `agentRunSystem.harvestDesktopRunActionEntries` must never reinterpret
 *     those summaries, historical schema-v1 summaries, or malformed
 *     summary-like objects as executable replay arguments.
 *   - Both `tool_call_start` and `client_tool_call_pending` are covered.
 *   - Genuine safe historical observation inputs remain harvestable.
 *
 * The real agentRunSystem source is transpiled with only its database boundary
 * mocked, avoiding the React Native Supabase singleton while exercising the
 * exported production harvester.
 *
 * Run: npx tsx scripts/desktop-action-summary-replay-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import * as ts from 'typescript';
import {
  summarizeToolInputForPersistence,
  summarizeToolResultForPersistence,
} from '../src/lib/eventBoundCore';

type EventRow = {
  kind: string;
  at: string;
  payload: {
    tool?: string;
    input?: unknown;
  };
};

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert.ok(condition, message);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
}

const eventRowsByRunId = new Map<string, EventRow[]>();
const queriedEventKinds: string[][] = [];
const insertedStepPayloads: Array<Record<string, unknown>> = [];

function makeEventQuery() {
  let runId = '';
  let kinds: string[] | null = null;
  const query = {
    select() {
      return query;
    },
    eq(column: string, value: unknown) {
      if (column === 'run_id') runId = String(value || '');
      return query;
    },
    in(column: string, values: unknown[]) {
      if (column === 'kind') {
        kinds = values.map((value) => String(value));
        queriedEventKinds.push([...kinds]);
      }
      return query;
    },
    order() {
      return query;
    },
    async limit() {
      const rows = eventRowsByRunId.get(runId) || [];
      return {
        data: kinds ? rows.filter((row) => kinds!.includes(row.kind)) : rows,
        error: null,
      };
    },
  };
  return query;
}

function makeStepInsertQuery(payload: Record<string, unknown>) {
  const row = {
    id: `step-${insertedStepPayloads.length}`,
    created_at: '2026-07-27T12:00:00.000Z',
    ...payload,
  };
  const query = {
    select() {
      return query;
    },
    async single() {
      return { data: row, error: null };
    },
  };
  return query;
}

const mockSupabase = {
  from(table: string) {
    if (table === 'agent_run_events') return makeEventQuery();
    if (table === 'agent_run_steps') {
      return {
        insert(payload: Record<string, unknown>) {
          insertedStepPayloads.push(payload);
          return makeStepInsertQuery(payload);
        },
      };
    }
    throw new Error(`Unexpected table in focused replay smoke: ${table}`);
  },
};

const repoRoot = resolve(__dirname, '..');
const runSystemPath = resolve(repoRoot, 'src/lib/agentRunSystem.ts');
const runSystemSource = readFileSync(runSystemPath, 'utf8');
const transpiled = ts.transpileModule(runSystemSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
  fileName: runSystemPath,
}).outputText;

const mockRequire = (specifier: string): unknown => {
  if (specifier === './supabase') return { supabase: mockSupabase };
  if (specifier === './devLog') return { devLog: () => undefined };
  if (specifier === './agentRunLedgerPersistence') {
    return {
      mapLegacyToolEventToLedgerStatus: () => 'running',
      persistAgentRunToolEvent: async () => undefined,
    };
  }
  if (specifier === './subscribeWithReconnect') {
    return { subscribeWithReconnect: () => ({ unsubscribe() {}, getChannel: () => null }) };
  }
  if (specifier === './agentRunSubjectSummary') return { runMatchesAgent: () => false };
  if (specifier === './eventBoundCore') {
    return {
      summarizeToolInputForPersistence,
      summarizeToolResultForPersistence,
    };
  }
  if (specifier === './userMemoryCaps') {
    return {
      detectCredentialMemoryContent: () => null,
      describeCredentialMemoryBlock: () => 'blocked',
    };
  }
  if (specifier === './memoryLookupKeyCore') {
    return {
      DEFAULT_AGENT_SCOPE_MEMORY_LIMIT: 20,
      describeAgentScopeLookupWarning: () => 'missing agent id',
      isAgentScopeMissingLookupId: () => false,
      resolveMemoryLookupIds: () => [],
      resolveMemoryScopeQueryLimit: () => 20,
      scopesRequestAgentMemory: () => false,
    };
  }
  if (specifier === './memoryWritePolicyCore') {
    // Dedupe is irrelevant to replay-summary behaviour, so the stub reports
    // "not eligible" — saveMemory then skips the candidate lookup entirely,
    // which is exactly the pre-existing path for non-session scopes.
    return {
      evaluateDedupeEligibility: () => ({ eligible: false, strategy: 'none', reason: 'stub' }),
      memoryWriteScopePolicy: () => ({ strategy: 'none', identityKeys: [], candidateLimit: 0, why: 'stub' }),
    };
  }
  if (specifier === './v2SaveMemoryCore') {
    // saveMemory reuses the v2 writer's `source_run_id` shape guard. That module
    // is import-free by design (the Deno edge imports it), so loading the REAL
    // one here costs nothing and keeps this harness honest — a stubbed
    // validator could silently diverge from the one that actually runs.
    return require('../src/lib/v2SaveMemoryCore');
  }
  throw new Error(`Unexpected dependency while loading agentRunSystem: ${specifier}`);
};

const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
const factory = runInThisContext(
  `(function(require, module, exports) {\n${transpiled}\n})`,
  { filename: runSystemPath },
) as (requireFn: typeof mockRequire, module: typeof moduleShim, exports: Record<string, unknown>) => void;
factory(mockRequire, moduleShim, moduleShim.exports);

const harvestDesktopRunActionEntries = moduleShim.exports.harvestDesktopRunActionEntries as
  (args: {
    runId?: string | null;
    circleId?: string | null;
    userId?: string | null;
    sinceIso?: string | null;
  }) => Promise<Array<{ tool: string; input: unknown }>>;
const isPersistedToolInputSummaryLike = moduleShim.exports.isPersistedToolInputSummaryLike as
  (input: unknown) => boolean;
const addStep = moduleShim.exports.addStep as (args: {
  runId: string;
  circleId: string;
  stepIndex: number;
  stepKind: string;
  title: string;
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}) => Promise<{
  tool_input?: Record<string, unknown>;
  tool_output?: string;
} | null>;
const describePersistedToolOutput = moduleShim.exports.describePersistedToolOutput as
  (value: unknown) => string | null;
const describePersistedToolName = moduleShim.exports.describePersistedToolName as
  (value: unknown) => string | null;
const projectPersistedRunStepForDisplay = moduleShim.exports.projectPersistedRunStepForDisplay as
  (value: {
    step_kind: string;
    title: string;
    body?: string;
    tool_name?: string;
    tool_output?: string;
  }) => {
    title: string;
    body: string | null;
    toolName: string | null;
    toolOutput: string | null;
  };

async function main(): Promise<void> {
  check(typeof harvestDesktopRunActionEntries === 'function', 'real desktop action harvester is exported');
  check(typeof isPersistedToolInputSummaryLike === 'function', 'summary-like recognizer is exported');
  check(typeof addStep === 'function', 'real addStep persistence boundary is exported');
  check(
    typeof describePersistedToolOutput === 'function',
    'safe persisted-output renderer is exported',
  );
  check(
    typeof describePersistedToolName === 'function'
      && typeof projectPersistedRunStepForDisplay === 'function',
    'safe legacy tool-name and whole-step display projectors are exported',
  );

  const nestedSecret = 'nested-short-token';
  const privatePath = '/Users/example/Customers/private-record.txt';
  const dynamicKey = 'customer_ssn_123456789';
  const rawToolOutput = [
    'osascript -e private command',
    'https://browser.example/live/session-secret',
    'backend-session-private-123',
    'provider body with hunter2',
  ].join(' | ');
  const callerToolInput: Record<string, unknown> = {
    password: 'hunter2',
    path: privatePath,
    nested: {
      accessToken: nestedSecret,
      body: 'private nested message',
    },
    [dynamicKey]: {
      selector: '#private-customer-record',
    },
  };
  callerToolInput.circular = callerToolInput;
  const addedSensitiveStep = await addStep({
    runId: 'run-sensitive',
    circleId: 'circle-sensitive',
    stepIndex: 0,
    stepKind: 'tool_call',
    title: 'Sensitive tool call',
    body: 'Executed /Users/example/Customers/private-record.txt with password hunter2',
    toolName: 'desktop.type_text',
    toolInput: callerToolInput,
    toolOutput: rawToolOutput,
    status: 'completed',
    metadata: {
      command: 'osascript private command',
      liveUrl: 'https://browser.example/live/session-secret',
      nested: { providerBody: 'hunter2' },
    },
  });
  check(Boolean(addedSensitiveStep), 'addStep accepts existing callers with raw in-memory tool input');
  const sensitiveInsert = insertedStepPayloads.at(-1);
  check(Boolean(sensitiveInsert), 'addStep reaches the captured agent_run_steps insert');
  const persistedSensitiveInput = sensitiveInsert?.tool_input as Record<string, unknown>;
  equal(
    persistedSensitiveInput,
    summarizeToolInputForPersistence('desktop.type_text', callerToolInput),
    'addStep derives tool_input through the canonical value-free summary boundary',
  );
  check(
    persistedSensitiveInput !== callerToolInput,
    'addStep never forwards the caller-owned input object by reference',
  );
  const persistedSensitiveJson = JSON.stringify(persistedSensitiveInput);
  for (const forbidden of [
    'hunter2',
    nestedSecret,
    privatePath,
    dynamicKey,
    'private nested message',
    '#private-customer-record',
  ]) {
    check(!persistedSensitiveJson.includes(forbidden), `agent_run_steps tool_input omits caller value: ${forbidden}`);
  }
  equal(persistedSensitiveInput.schemaVersion, 2, 'persisted step input uses summary schema v2');
  equal(persistedSensitiveInput.redacted, true, 'persisted step input is explicitly redacted');
  const persistedSensitiveOutput = sensitiveInsert?.tool_output;
  equal(
    persistedSensitiveOutput,
    JSON.stringify(summarizeToolResultForPersistence(
      'desktop.type_text',
      rawToolOutput,
      'completed',
    )),
    'addStep derives tool_output through the canonical value-free result boundary',
  );
  check(
    typeof persistedSensitiveOutput === 'string',
    'text-backed tool_output retains a serialized structural envelope',
  );
  const parsedSensitiveOutput = JSON.parse(String(persistedSensitiveOutput)) as Record<string, unknown>;
  equal(parsedSensitiveOutput.schemaVersion, 2, 'persisted step output uses summary schema v2');
  equal(parsedSensitiveOutput.redacted, true, 'persisted step output is explicitly redacted');
  equal(parsedSensitiveOutput.resultKind, 'string', 'persisted step output retains only its value kind');
  equal(parsedSensitiveOutput.status, 'completed', 'persisted step output retains controlled status');
  equal(
    describePersistedToolOutput(persistedSensitiveOutput),
    'Tool result: completed · string · values hidden',
    'UI renderer describes the structural output without exposing its value',
  );
  equal(
    describePersistedToolOutput(rawToolOutput),
    'Tool result recorded · legacy value hidden',
    'UI renderer hides historical pre-boundary raw output',
  );
  check(
    !String(describePersistedToolOutput(rawToolOutput)).includes('hunter2'),
    'legacy output renderer never echoes caller-owned content',
  );
  for (const forbidden of [
    'osascript',
    'private command',
    'browser.example',
    'session-secret',
    'backend-session-private-123',
    'hunter2',
  ]) {
    check(
      !String(persistedSensitiveOutput).includes(forbidden),
      `agent_run_steps tool_output omits caller value: ${forbidden}`,
    );
  }
  equal(
    sensitiveInsert?.metadata,
    summarizeToolInputForPersistence('desktop.type_text', {
      command: 'osascript private command',
      liveUrl: 'https://browser.example/live/session-secret',
      nested: { providerBody: 'hunter2' },
    }),
    'tool-bound metadata is reduced to a value-free structural summary',
  );
  equal(
    sensitiveInsert?.title,
    'Tool call: desktop.type_text',
    'tool-bound title is replaced with a controlled tool label',
  );
  equal(
    sensitiveInsert?.body,
    'Tool details hidden',
    'tool-bound body is replaced instead of persisting caller content',
  );
  const persistedSensitiveMetadata = JSON.stringify(sensitiveInsert?.metadata);
  for (const forbidden of [
    'osascript',
    'browser.example',
    'session-secret',
    'hunter2',
    'providerBody',
  ]) {
    check(
      !persistedSensitiveMetadata.includes(forbidden),
      `agent_run_steps tool metadata omits caller value/key: ${forbidden}`,
    );
  }
  equal(
    describePersistedToolName('/Users/example/private/tool.sh --password hunter2'),
    'unknown',
    'legacy malformed tool names are hidden',
  );
  const legacyDisplay = projectPersistedRunStepForDisplay({
    step_kind: 'tool_result',
    title: 'Ran /Users/example/private/tool.sh',
    body: 'password=hunter2',
    tool_name: '/Users/example/private/tool.sh',
    tool_output: rawToolOutput,
  });
  equal(
    legacyDisplay,
    {
      title: 'TOOL_RESULT · Tool result: unknown',
      body: null,
      toolName: 'unknown',
      toolOutput: 'Tool result recorded · legacy value hidden',
    },
    'legacy tool-step display hides raw name, title, body, and output together',
  );
  check(
    !JSON.stringify(legacyDisplay).includes('hunter2')
      && !JSON.stringify(legacyDisplay).includes('/Users/example'),
    'legacy whole-step display projection cannot echo private values',
  );

  await addStep({
    runId: 'run-aggregate-tool-step',
    circleId: 'circle-sensitive',
    stepIndex: 1,
    stepKind: 'tool_call',
    title: 'Aggregate tool activity',
    metadata: {
      executions: [{ command: 'private aggregate command', output: 'private aggregate output' }],
    },
  });
  const aggregateToolMetadata = insertedStepPayloads.at(-1)?.metadata as Record<string, unknown>;
  equal(
    aggregateToolMetadata.tool,
    'unknown',
    'tool-call steps without a tool name still enter the structural metadata boundary',
  );
  equal(aggregateToolMetadata.redacted, true, 'aggregate tool-call metadata is explicitly redacted');
  check(
    !JSON.stringify(aggregateToolMetadata).includes('private aggregate'),
    'aggregate tool-call metadata omits nested command/result values',
  );

  const malformedProxy = new Proxy<Record<string, unknown>>({}, {
    ownKeys() {
      throw new Error('hostile ownKeys');
    },
  });
  const malformedStep = await addStep({
    runId: 'run-malformed',
    circleId: 'circle-malformed',
    stepIndex: 0,
    stepKind: 'tool_call',
    title: 'Malformed input',
    toolName: '/Users/example/private-tool-name',
    toolInput: malformedProxy,
  });
  check(Boolean(malformedStep), 'malformed input cannot crash the addStep compatibility path');
  const malformedPersistedInput = insertedStepPayloads.at(-1)?.tool_input as Record<string, unknown>;
  equal(malformedPersistedInput.tool, 'unknown', 'malformed tool identity collapses to unknown');
  equal(malformedPersistedInput.redacted, true, 'malformed input still produces a redacted envelope');
  check(
    !JSON.stringify(malformedPersistedInput).includes('private-tool-name'),
    'malformed input persistence exposes no path-like tool identity',
  );
  equal(
    insertedStepPayloads.at(-1)?.tool_name,
    'unknown',
    'malformed tool identity is sanitized at the tool_name column boundary',
  );
  check(
    !JSON.stringify(insertedStepPayloads.at(-1)).includes('private-tool-name'),
    'the complete persisted step omits a path-like tool identity',
  );

  await addStep({
    runId: 'run-primitive',
    circleId: 'circle-primitive',
    stepIndex: 0,
    stepKind: 'tool_call',
    title: 'Runtime type mismatch',
    toolName: 'desktop.type_text',
    toolInput: 'caller secret that bypassed TypeScript',
  });
  const primitivePersistedInput = insertedStepPayloads.at(-1)?.tool_input as Record<string, unknown>;
  equal(primitivePersistedInput.inputKind, 'string', 'runtime type mismatch is summarized by kind');
  check(
    !JSON.stringify(primitivePersistedInput).includes('caller secret'),
    'runtime type mismatch cannot persist its primitive value',
  );

  await addStep({
    runId: 'run-no-input',
    circleId: 'circle-no-input',
    stepIndex: 0,
    stepKind: 'message',
    title: 'No tool input',
    metadata: { source: 'ordinary_message_step' },
  });
  equal(
    insertedStepPayloads.at(-1)?.tool_input,
    undefined,
    'callers without tool input retain the existing undefined persistence shape',
  );
  equal(
    insertedStepPayloads.at(-1)?.tool_output,
    undefined,
    'callers without tool output retain the existing undefined persistence shape',
  );
  equal(
    insertedStepPayloads.at(-1)?.metadata,
    { source: 'ordinary_message_step' },
    'non-tool plan/message metadata retains its compatibility shape',
  );

  const schemaV2Summary = summarizeToolInputForPersistence('desktop.click_element', {
    elementId: 'save-button',
    exactLabel: 'Save',
  });
  equal(schemaV2Summary.schemaVersion, 2, 'current event summary uses schema v2');
  equal(schemaV2Summary.redacted, true, 'current event summary declares value redaction');
  check(isPersistedToolInputSummaryLike(schemaV2Summary), 'canonical schema-v2 summary is recognized');

  const dynamicKeys = {
    customer_ssn_123456789: 'opaque-value',
    private_filename_psych_notes: 'opaque-value',
    selector_for_private_record: 'opaque-value',
  };
  const dynamicMapSummary = summarizeToolInputForPersistence('custom.dynamic_map', dynamicKeys);
  const dynamicSummaryJson = JSON.stringify(dynamicMapSummary);
  check(isPersistedToolInputSummaryLike(dynamicMapSummary), 'custom dynamic-map summary is recognized');
  for (const key of Object.keys(dynamicKeys)) {
    check(!dynamicSummaryJson.includes(key), `dynamic key is absent from persistence summary: ${key}`);
  }

  const schemaV1Summary = {
    schemaVersion: 1,
    redacted: true,
    tool: 'desktop.click_element',
    inputKind: 'object',
    fieldCount: 2,
    fields: [
      { kind: 'string', count: 1 },
      { kind: 'number', count: 1 },
    ],
  };
  check(isPersistedToolInputSummaryLike(schemaV1Summary), 'historical schema-v1 fields summary is recognized');
  check(
    isPersistedToolInputSummaryLike({
      schemaVersion: 99,
      redacted: false,
      inputKind: 'object',
      fieldKinds: 'malformed',
    }),
    'malformed summary-like envelope fails closed',
  );
  check(
    isPersistedToolInputSummaryLike({ schemaVersion: 2, redacted: true }),
    'truncated canonical summary fails closed even without structural fields',
  );
  check(
    !isPersistedToolInputSummaryLike({ includeHidden: false, maxDepth: 4 }),
    'ordinary historical observation input is not mistaken for a summary',
  );
  check(
    !isPersistedToolInputSummaryLike({ redacted: true, includeHidden: false }),
    'a lone redacted flag does not discard an otherwise ordinary input',
  );

  const safeTreeInput = { includeHidden: false, maxDepth: 4 };
  const safeWindowInput = { includeMinimized: false };
  eventRowsByRunId.set('mixed-run', [
    {
      kind: 'tool_call_start',
      at: '2026-07-27T12:00:00.000Z',
      payload: { tool: 'desktop.click_element', input: schemaV2Summary },
    },
    {
      kind: 'client_tool_call_pending',
      at: '2026-07-27T12:00:01.000Z',
      payload: { tool: 'custom.dynamic_map', input: dynamicMapSummary },
    },
    {
      kind: 'client_tool_call_pending',
      at: '2026-07-27T12:00:02.000Z',
      payload: { tool: 'desktop.click_element', input: schemaV1Summary },
    },
    {
      kind: 'tool_call_start',
      at: '2026-07-27T12:00:03.000Z',
      payload: {
        tool: 'desktop.click_element',
        input: { schemaVersion: 2, redacted: true },
      },
    },
    {
      kind: 'client_tool_call_pending',
      at: '2026-07-27T12:00:04.000Z',
      payload: {
        tool: 'desktop.click_element',
        input: {
          schemaVersion: 'broken',
          redacted: false,
          inputKind: 'object',
          fields: { invalid: true },
        },
      },
    },
    {
      kind: 'tool_call_start',
      at: '2026-07-27T12:00:05.000Z',
      payload: { tool: 'desktop.read_a11y_tree', input: safeTreeInput },
    },
    {
      kind: 'client_tool_call_pending',
      at: '2026-07-27T12:00:06.000Z',
      payload: { tool: 'desktop.window_state', input: safeWindowInput },
    },
    {
      kind: 'tool_call_result',
      at: '2026-07-27T12:00:07.000Z',
      payload: { tool: 'desktop.should_not_be_harvested', input: { unsafe: true } },
    },
  ]);

  const harvested = await harvestDesktopRunActionEntries({ runId: 'mixed-run' });
  equal(
    harvested,
    [
      { tool: 'desktop.read_a11y_tree', input: safeTreeInput },
      { tool: 'desktop.window_state', input: safeWindowInput },
    ],
    'harvester drops every summary shape but preserves safe legacy inputs and order',
  );
  const harvestedJson = JSON.stringify(harvested);
  check(!harvestedJson.includes('inputKind'), 'no structural inputKind reaches replay arguments');
  check(!harvestedJson.includes('fieldKinds'), 'no structural fieldKinds reaches replay arguments');
  check(!harvestedJson.includes('"fields"'), 'no schema-v1 fields array reaches replay arguments');
  check(!harvestedJson.includes('custom.dynamic_map'), 'custom dynamic-map summary does not become a replay action');
  check(
    queriedEventKinds.some((kinds) =>
      kinds.includes('tool_call_start') && kinds.includes('client_tool_call_pending')),
    'database query retains both supported input-carrying event kinds',
  );

  eventRowsByRunId.set('summary-only-run', [
    {
      kind: 'client_tool_call_pending',
      at: '2026-07-27T12:01:00.000Z',
      payload: { tool: 'custom.dynamic_map', input: dynamicMapSummary },
    },
  ]);
  equal(
    await harvestDesktopRunActionEntries({ runId: 'summary-only-run' }),
    [],
    'a summary-only run yields no executable learned action entries',
  );

  console.log(`All desktop action summary replay smoke cases passed (${assertions} assertions).`);
}

main().catch((error) => {
  console.error('FAIL: desktop action summary replay smoke:', error);
  process.exit(1);
});
