/**
 * Focused smoke for the bounded, non-mutating OpenSwan multi-action reporter.
 *
 * Run: npx tsx scripts/openswan-multi-action-report-tool-smoketest.ts
 */

import { registerHooks } from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://multi-action-report-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'multi-action-report-smoke-anon-key';

const NATIVE_STUBS = new Set([
  'react-native',
  '@react-native-async-storage/async-storage',
]);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let failures = 0;

function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) {
    console.log('pass:', message);
    return;
  }
  failures += 1;
  console.error('FAIL:', `${message}${detail ? ` - ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const runtime = await import('../src/lib/openswanToolRuntime');
  const plannerSource = await import('node:fs/promises')
    .then((fs) => fs.readFile('src/lib/openswanTaskPlanner.ts', 'utf8'));

  assert(
    plannerSource.includes("| 'run.report_action_outcomes'"),
    'canonical planner tool-name union includes the reporter',
  );

  for (const surface of ['main_chat', 'room_chat', 'office', 'task_run'] as const) {
    const explicit = runtime.listOpenSwanAnthropicToolsForSurface(
      surface,
      ['run.report_action_outcomes'],
    );
    assert(
      explicit.length === 1 && explicit[0]?.name === 'run.report_action_outcomes',
      `${surface}: explicitly requested catalog selection includes only the reporter`,
    );
  }

  const definition = runtime
    .listOpenSwanToolsForSurface('main_chat')
    .find((candidate) => candidate.name === 'run.report_action_outcomes');
  const actionsSchema = (definition?.inputSchema?.properties as any)?.actions;
  assert(definition?.disclosure === 'deferred', 'reporter stays out of the ordinary pinned tool set');
  assert(
    actionsSchema?.minItems === 1 && actionsSchema?.maxItems === 3,
    'catalog schema bounds the action array to 1-3 entries',
  );
  assert(
    actionsSchema?.items?.properties?.actionId?.enum?.join(',') === 'A1,A2,A3',
    'catalog schema permits only bounded A1-A3 ids',
  );
  assert(
    actionsSchema?.items?.properties?.status?.enum?.join(',') === 'completed,blocked,failed',
    'catalog schema permits only completed, blocked, or failed',
  );
  assert(
    actionsSchema?.items?.properties?.evidenceToolUseIds?.maxItems === 8,
    'catalog schema bounds evidence references per action',
  );

  const policy = runtime.getOpenSwanToolPolicy('run.report_action_outcomes');
  assert(
    policy.approvalMode === 'auto'
      && policy.mutatesState === false
      && policy.externalSideEffect === false
      && policy.mutationAuthority === 'read_only',
    'reporter policy is approval-free, read-only, and side-effect-free',
  );
  const parallelPolicy = runtime.getOpenSwanToolParallelPolicy('run.report_action_outcomes');
  assert(
    parallelPolicy.mutatesState === true
      && !parallelPolicy.mutationTargets
      && parallelPolicy.externalSideEffect === false,
    'scheduler treats reporting as a singleton ordering barrier without changing base mutation policy',
  );

  const validInput = {
    actions: [
      {
        actionId: ' A1 ',
        status: ' completed ',
        evidenceToolUseIds: [' toolu_01 ', 'toolu_01', 'call-2:step.3'],
        explanation: 'untrusted prose must be ignored',
      },
      {
        actionId: 'A2',
        status: 'blocked',
        evidenceToolUseIds: [],
      },
    ],
    prose: 'toolu_fake is not evidence',
  };

  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error('reporter attempted forbidden network I/O');
  }) as typeof fetch;
  const result = await runtime.executeOpenSwanRuntimeTool(
    'run.report_action_outcomes',
    validInput as any,
    { circleId: 'circle-smoke', userId: 'user-smoke' },
  );
  globalThis.fetch = originalFetch;

  assert(fetchCalls === 0, 'report execution performs no network or Supabase request');
  assert(result.ok === true, 'structurally valid report is acknowledged');
  assert(
    result.acknowledgement?.completionDecision === 'not_evaluated'
      && !Object.prototype.hasOwnProperty.call(result, 'completionVerified')
      && !Object.prototype.hasOwnProperty.call(result, 'taskComplete'),
    'acknowledgement never decides run or task completion',
  );
  assert(
    result.acknowledgement?.actionCount === 2
      && result.acknowledgement?.evidenceReferenceCount === 2,
    'acknowledgement contains only bounded structural counts',
  );
  assert(
    JSON.stringify(result.acknowledgement?.actions) === JSON.stringify([
      {
        actionId: 'A1',
        status: 'completed',
        evidenceToolUseIds: ['toolu_01', 'call-2:step.3'],
      },
      { actionId: 'A2', status: 'blocked', evidenceToolUseIds: [] },
    ]),
    'normalizer trims safe tokens and de-duplicates evidence ids in stable order',
  );
  assert(
    !JSON.stringify(result).includes('untrusted prose')
      && !JSON.stringify(result).includes('toolu_fake'),
    'extra prose is neither echoed nor treated as evidence',
  );
  assert(
    Object.isFrozen(result.acknowledgement)
      && Object.isFrozen(result.acknowledgement?.actions)
      && Object.isFrozen(result.acknowledgement?.actions[0]?.evidenceToolUseIds),
    'normalized acknowledgement is deeply frozen at its bounded collection edges',
  );
  assert(
    runtime.formatOpenSwanRuntimeToolResult('run.report_action_outcomes', result)
      === result.resultsText,
    'model-facing formatter returns only the bounded acknowledgement text',
  );

  const legacyResult = await runtime.executeOpenSwanTool(
    'run.report_action_outcomes',
    { actions: [{ actionId: 'A3', status: 'failed', evidenceToolUseIds: [] }] },
  );
  assert(
    legacyResult.ok === true
      && legacyResult.acknowledgement?.completionDecision === 'not_evaluated',
    'legacy typed executor cannot turn the reporter into a planned-success shortcut',
  );

  const invalidCases: Array<[unknown, string, string]> = [
    [null, 'invalid_payload', 'non-object payload'],
    [{ actions: [] }, 'invalid_action_count', 'empty action array'],
    [{ actions: [1] }, 'invalid_action', 'non-object action'],
    [{ actions: [{ actionId: 'A4', status: 'completed', evidenceToolUseIds: [] }] }, 'invalid_action_id', 'unknown action id'],
    [{ actions: [
      { actionId: 'A1', status: 'completed', evidenceToolUseIds: [] },
      { actionId: 'A1', status: 'blocked', evidenceToolUseIds: [] },
    ] }, 'duplicate_action_id', 'duplicate action id'],
    [{ actions: [{ actionId: 'A1', status: 'pending', evidenceToolUseIds: [] }] }, 'invalid_status', 'unknown status'],
    [{ actions: [{ actionId: 'A1', status: 'completed', evidenceToolUseIds: 'toolu_01' }] }, 'invalid_evidence_references', 'non-array evidence field'],
    [{ actions: [{ actionId: 'A1', status: 'completed', evidenceToolUseIds: Array.from({ length: 9 }, (_, i) => `toolu_${i}`) }] }, 'too_many_evidence_references', 'more than eight evidence references'],
    [{ actions: [{ actionId: 'A1', status: 'completed', evidenceToolUseIds: ['toolu_ok', '<prose>'] }] }, 'invalid_evidence_reference', 'unsafe evidence token'],
    [{ actions: [
      { actionId: 'A1', status: 'completed', evidenceToolUseIds: [] },
      { actionId: 'A2', status: 'completed', evidenceToolUseIds: [] },
      { actionId: 'A3', status: 'completed', evidenceToolUseIds: [] },
      { actionId: 'A1', status: 'completed', evidenceToolUseIds: [] },
    ] }, 'invalid_action_count', 'more than three actions'],
  ];

  for (const [input, expectedCode, label] of invalidCases) {
    const invalid = runtime.acknowledgeOpenSwanActionOutcomeReport(input);
    assert(
      invalid.ok === false
        && invalid.errorCode === expectedCode
        && invalid.acknowledgement === undefined,
      `fail closed: ${label}`,
      JSON.stringify(invalid),
    );
  }

  if (failures > 0) {
    console.error(`\n${failures} OpenSwan multi-action report smoke assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nOpenSwan multi-action report smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
