/**
 * OpenSwan terminal-outcome contract smoke.
 *
 * This focused smoke pins the one terminal receipt shared by the session
 * runtime and Chat. It intentionally performs no provider, bridge, database,
 * or React Native work.
 *
 * Run:
 *   npx tsx scripts/openswan-terminal-outcome-contract-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { normalizeOpenSwanTerminalOutcome } from '../src/lib/chatLaneOutcome';
import { deriveOpenSwanTerminalChatOutcomeSignal } from '../src/lib/chatOutcomeSignals';
import { assessMissionTaskCompletion } from '../src/lib/missionTaskCompletion';
import { projectPersistedOpenSwanTerminal } from '../src/lib/persistedChatMetadata';
import {
  compactRoomTerminalReceipt,
  prependRoomTerminalStatus,
} from '../src/lib/roomMessageMetadata';
import { buildOpenSwanTerminalReceipt } from '../src/lib/openswanSessionRuntimeAdapters';

const root = process.cwd();
const runtimePath = resolve(root, 'src/lib/openswanSessionRuntime.ts');
const adaptersPath = resolve(root, 'src/lib/openswanSessionRuntimeAdapters.ts');
const chatPath = resolve(root, 'src/screens/circles/tabs/ChatTab.tsx');
const lanePath = resolve(root, 'src/lib/chatLaneOutcome.ts');
const persistedChatPath = resolve(root, 'src/lib/persistedChatMetadata.ts');
const roomChatPath = resolve(root, 'src/lib/roomChatService.ts');
const roomMetadataPath = resolve(root, 'src/lib/roomMessageMetadata.ts');
const missionCompletionPath = resolve(root, 'src/lib/missionTaskCompletion.ts');
const missionDispatchPath = resolve(root, 'src/lib/missionAgentDispatch.ts');
const subagentPath = resolve(root, 'src/lib/subagentRegistry.ts');
const runtime = readFileSync(runtimePath, 'utf8');
const adapters = readFileSync(adaptersPath, 'utf8');
const chat = readFileSync(chatPath, 'utf8');
const lane = readFileSync(lanePath, 'utf8');
const persistedChat = readFileSync(persistedChatPath, 'utf8');
const roomChat = readFileSync(roomChatPath, 'utf8');
const roomMetadata = readFileSync(roomMetadataPath, 'utf8');
const missionCompletion = readFileSync(missionCompletionPath, 'utf8');
const missionDispatch = readFileSync(missionDispatchPath, 'utf8');
const subagent = readFileSync(subagentPath, 'utf8');

type Callable = (...args: any[]) => any;

function assertSyntacticallyValid(source: string, filePath: string): void {
  const diagnostics = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filePath,
    reportDiagnostics: true,
  }).diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) || [];
  assert.deepEqual(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')),
    [],
    `${filePath} remains syntactically valid`,
  );
}

function loadPrivatePureFunction(
  source: string,
  filePath: string,
  startMarker: string,
  endMarker: string,
  functionName: string,
): Callable {
  const functionSource = section(source, startMarker, endMarker, functionName)
    .replace(/^function /, 'export function ');
  const js = ts.transpileModule(functionSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filePath,
  }).outputText;
  const module = { exports: {} as Record<string, unknown> };
  new Function('module', 'exports', js)(module, module.exports);
  const candidate = module.exports[functionName];
  assert.equal(typeof candidate, 'function', `${functionName} is executable from its exact source`);
  return candidate as Callable;
}

function section(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `${label}: start marker exists`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `${label}: end marker exists after start`);
  return source.slice(startIndex, endIndex);
}

const checkpoint = {
  schemaVersion: 1 as const,
  stepCount: 2,
  completedSteps: [],
  lastObservation: null,
  lastFailure: null,
  resumeHint: 'Resume from the last completed tool boundary.',
};

const terminalCases = [
  {
    label: 'clean end_turn',
    input: { cancelled: false, incomplete: false, checkpoint: null },
    expected: {
      state: 'succeeded', reason: 'clean_end_turn', completionVerified: true, resumable: false, checkpoint: null,
    },
  },
  {
    label: 'step cap',
    input: { cancelled: false, incomplete: true, incompleteReason: 'cap', checkpoint },
    expected: {
      state: 'partial', reason: 'step_cap', completionVerified: false, resumable: true, checkpoint,
    },
  },
  {
    label: 'runtime guard',
    input: { cancelled: false, incomplete: true, incompleteReason: 'guard', checkpoint },
    expected: {
      state: 'failed', reason: 'runtime_guard', completionVerified: false, resumable: true, checkpoint,
    },
  },
  {
    label: 'edge failure',
    input: { cancelled: false, incomplete: true, incompleteReason: 'edge_failure', checkpoint: null },
    expected: {
      state: 'failed', reason: 'edge_failure', completionVerified: false, resumable: false, checkpoint: null,
    },
  },
  {
    label: 'cancelled',
    input: { cancelled: true, incomplete: true, incompleteReason: 'cancelled', checkpoint },
    expected: {
      state: 'cancelled', reason: 'user_cancelled', completionVerified: false, resumable: true, checkpoint,
    },
  },
  {
    label: 'failed verification',
    input: { cancelled: false, incomplete: false, verificationDisposition: 'failed' },
    expected: {
      state: 'failed', reason: 'verification_failed', completionVerified: false, resumable: false, checkpoint: null,
    },
  },
  {
    label: 'blocked or manual verification',
    input: { cancelled: false, incomplete: false, verificationDisposition: 'blocked' },
    expected: {
      state: 'partial', reason: 'verification_blocked', completionVerified: false, resumable: false, checkpoint: null,
    },
  },
  {
    label: 'present unverified edits',
    input: { cancelled: false, incomplete: false, verificationDisposition: 'unverified' },
    expected: {
      state: 'partial', reason: 'verification_unverified', completionVerified: false, resumable: false, checkpoint: null,
    },
  },
  {
    label: 'required auto-runnable check missing',
    input: { cancelled: false, incomplete: false, verificationDisposition: 'unverified' },
    expected: {
      state: 'partial', reason: 'verification_unverified', completionVerified: false, resumable: false, checkpoint: null,
    },
  },
  {
    label: 'delegation incomplete',
    input: { cancelled: false, incomplete: false, delegationDisposition: 'incomplete' },
    expected: {
      state: 'partial', reason: 'delegation_incomplete', completionVerified: false, resumable: false, checkpoint: null,
    },
  },
  {
    label: 'persistence unverified',
    input: { cancelled: false, incomplete: false, persistenceDisposition: 'unverified' },
    expected: {
      state: 'failed', reason: 'persistence_unverified', completionVerified: false, resumable: false, checkpoint: null,
    },
  },
  {
    label: 'persistence cancelled wins',
    input: {
      cancelled: false,
      incomplete: false,
      verificationDisposition: 'failed',
      delegationDisposition: 'incomplete',
      persistenceDisposition: 'cancelled',
      checkpoint,
    },
    expected: {
      state: 'cancelled', reason: 'user_cancelled', completionVerified: false, resumable: true, checkpoint,
    },
  },
] as const;

async function main(): Promise<void> {
  const terminalHelper = section(
    adapters,
    'export function buildOpenSwanTerminalReceipt',
    '/** Legacy gate signature',
    'terminal receipt helper',
  );
  const resolveOpenSwanVerificationDisposition = loadPrivatePureFunction(
    runtime,
    runtimePath,
    'function resolveOpenSwanVerificationDisposition',
    'export async function runOpenSwanSessionTurn',
    'resolveOpenSwanVerificationDisposition',
  );

  const requiredTypecheck = {
    id: 'required-typecheck',
    kind: 'typecheck',
    required: true,
    label: 'Run typecheck',
    reason: 'Required automatic check',
  };
  const requiredPreview = {
    id: 'required-preview',
    kind: 'preview',
    required: true,
    label: 'Review preview',
    reason: 'Required manual verification',
  };
  const verificationReceipt = (overrides: Record<string, unknown> = {}) => ({
    editedFiles: [],
    checks: [],
    committed: false,
    verdict: 'unverified',
    summary: 'Completion not verified.',
    ...overrides,
  });
  const verificationResult = (
    check: typeof requiredTypecheck | typeof requiredPreview,
    status: 'passed' | 'failed' | 'blocked' | 'manual_required',
    executed: boolean,
  ) => ({
    check,
    status,
    executed,
    ok: status === 'passed',
    summary: `${check.label}: ${status}`,
    execution: { status },
  });

  const resolvedVerificationCases = [
    {
      label: 'failed verification result',
      disposition: resolveOpenSwanVerificationDisposition(
        [verificationResult(requiredTypecheck, 'failed', true)],
        [requiredTypecheck],
        null,
      ),
      expectedDisposition: 'failed',
      expectedState: 'failed',
      expectedReason: 'verification_failed',
    },
    {
      label: 'blocked verification result',
      disposition: resolveOpenSwanVerificationDisposition(
        [verificationResult(requiredTypecheck, 'blocked', false)],
        [requiredTypecheck],
        null,
      ),
      expectedDisposition: 'blocked',
      expectedState: 'partial',
      expectedReason: 'verification_blocked',
    },
    {
      label: 'manual verification result',
      disposition: resolveOpenSwanVerificationDisposition(
        [verificationResult(requiredPreview, 'manual_required', false)],
        [requiredPreview],
        null,
      ),
      expectedDisposition: 'blocked',
      expectedState: 'partial',
      expectedReason: 'verification_blocked',
    },
    {
      label: 'present unverified edits',
      disposition: resolveOpenSwanVerificationDisposition(
        [],
        [],
        verificationReceipt({ editedFiles: ['changed.ts'] }),
      ),
      expectedDisposition: 'unverified',
      expectedState: 'partial',
      expectedReason: 'verification_unverified',
    },
    {
      label: 'required auto-runnable check missing',
      disposition: resolveOpenSwanVerificationDisposition(
        [],
        [requiredTypecheck],
        verificationReceipt({ verdict: 'verified' }),
      ),
      expectedDisposition: 'unverified',
      expectedState: 'partial',
      expectedReason: 'verification_unverified',
    },
  ] as const;

  for (const verificationCase of resolvedVerificationCases) {
    assert.equal(
      verificationCase.disposition,
      verificationCase.expectedDisposition,
      `${verificationCase.label}: required-check resolver returns the exact disposition`,
    );
    const terminal = buildOpenSwanTerminalReceipt({
      cancelled: false,
      incomplete: false,
      verificationDisposition: verificationCase.disposition,
    });
    assert.equal(terminal.state, verificationCase.expectedState, `${verificationCase.label}: disposition controls terminal state`);
    assert.equal(terminal.reason, verificationCase.expectedReason, `${verificationCase.label}: disposition controls terminal reason`);
    assert.equal(terminal.completionVerified, false, `${verificationCase.label}: never verifies completion`);
  }

  for (const testCase of terminalCases) {
    const terminal = buildOpenSwanTerminalReceipt(testCase.input);
    assert.deepEqual(
      terminal,
      testCase.expected,
      `${testCase.label} maps to the exact typed terminal receipt`,
    );
    const hostileResponse = testCase.expected.state === 'succeeded'
      ? 'Blocked, failed, and cancelled.'
      : 'Everything completed successfully.';
    const terminalWithHostileProse = { ...terminal, response: hostileResponse };
    const laneOutcome = normalizeOpenSwanTerminalOutcome({
      terminal,
      response: hostileResponse,
      tool_actions: [],
      artifacts: [],
    });
    const outcomeSignal = deriveOpenSwanTerminalChatOutcomeSignal(terminalWithHostileProse);
    const expectedVerdict = testCase.expected.state === 'succeeded'
      ? 'completed'
      : testCase.expected.state === 'partial'
        ? 'partial'
        : testCase.expected.state === 'failed'
          ? 'failed'
          : 'blocked';
    assert.equal(laneOutcome.data?.openSwanTerminalState, testCase.expected.state, `${testCase.label}: Chat retains terminal state`);
    assert.equal(laneOutcome.data?.completionVerified, testCase.expected.completionVerified, `${testCase.label}: Chat retains completion proof`);
    assert.equal(
      laneOutcome.status,
      testCase.expected.state === 'succeeded' ? 'completed' : testCase.expected.state === 'failed' ? 'failed' : 'blocked',
      `${testCase.label}: hostile prose cannot override Chat lane status`,
    );
    assert.deepEqual(
      outcomeSignal,
      {
        verdict: expectedVerdict,
        approvalPending: false,
        canRetry: testCase.expected.resumable,
      },
      `${testCase.label}: hostile success/failure prose cannot override the receipt-derived Chat outcome signal`,
    );
    assert.deepEqual(
      projectPersistedOpenSwanTerminal(terminal),
      {
        state: testCase.expected.state,
        reason: testCase.expected.reason,
        completionVerified: testCase.expected.completionVerified,
        resumable: testCase.expected.state !== 'succeeded' && testCase.expected.resumable,
        checkpointAvailable: testCase.expected.checkpoint != null,
      },
      `${testCase.label}: Chat persists the exact bounded terminal receipt`,
    );
    assert.deepEqual(
      compactRoomTerminalReceipt(terminal),
      {
        state: testCase.expected.state,
        reason: testCase.expected.reason,
        completionVerified: testCase.expected.completionVerified,
        resumable: testCase.expected.state !== 'succeeded' && testCase.expected.resumable,
      },
      `${testCase.label}: Room keeps exact bounded terminal truth`,
    );
    const roomContent = prependRoomTerminalStatus(hostileResponse, terminal);
    assert.equal(
      testCase.expected.completionVerified
        ? roomContent === hostileResponse
        : roomContent !== hostileResponse && roomContent.endsWith(hostileResponse),
      true,
      `${testCase.label}: Room puts non-success terminal status ahead of provider prose`,
    );
    // Mission completion retains its legacy evidence/blocker gate after the
    // terminal gate. Use positive evidence copy for the sole verified-success
    // fixture; every non-success case keeps deliberately hostile success prose.
    const missionResponse = testCase.expected.completionVerified
      ? 'Completed with a verified artifact.'
      : hostileResponse;
    const missionAssessment = assessMissionTaskCompletion({
      response: missionResponse,
      artifacts: [{ kind: 'report' }],
      terminal,
    });
    assert.equal(
      missionAssessment.completed,
      testCase.expected.completionVerified,
      `${testCase.label}: Mission marks done only for verified success`,
    );
  }

  const precedenceCases = [
    {
      label: 'cancel wins over every lower layer',
      input: {
        cancelled: false,
        incomplete: true,
        incompleteReason: 'guard' as const,
        verificationDisposition: 'failed' as const,
        delegationDisposition: 'incomplete' as const,
        persistenceDisposition: 'cancelled' as const,
      },
      expectedReason: 'user_cancelled',
    },
    {
      label: 'loop incomplete wins over verification, delegation, and persistence uncertainty',
      input: {
        cancelled: false,
        incomplete: true,
        incompleteReason: 'guard' as const,
        verificationDisposition: 'failed' as const,
        delegationDisposition: 'incomplete' as const,
        persistenceDisposition: 'unverified' as const,
      },
      expectedReason: 'runtime_guard',
    },
    {
      label: 'verification wins over delegation and persistence uncertainty',
      input: {
        cancelled: false,
        incomplete: false,
        verificationDisposition: 'failed' as const,
        delegationDisposition: 'incomplete' as const,
        persistenceDisposition: 'unverified' as const,
      },
      expectedReason: 'verification_failed',
    },
    {
      label: 'delegation wins over persistence uncertainty',
      input: {
        cancelled: false,
        incomplete: false,
        verificationDisposition: 'passed' as const,
        delegationDisposition: 'incomplete' as const,
        persistenceDisposition: 'unverified' as const,
      },
      expectedReason: 'delegation_incomplete',
    },
  ] as const;
  for (const precedenceCase of precedenceCases) {
    assert.equal(
      buildOpenSwanTerminalReceipt(precedenceCase.input).reason,
      precedenceCase.expectedReason,
      precedenceCase.label,
    );
  }

  assert.doesNotMatch(
    terminalHelper,
    /response|message|text|artifact/i,
    'terminal state is derived from typed runtime signals, never success-sounding prose or artifacts',
  );

  const verificationResolverSource = section(
    runtime,
    'function resolveOpenSwanVerificationDisposition',
    'export async function runOpenSwanSessionTurn',
    'required verification resolver',
  );
  assert.match(
    verificationResolverSource,
    /const autoRunnableKinds = new Set[\s\S]*'typecheck'[\s\S]*'tests'[\s\S]*'lint'[\s\S]*'preview'/,
    'required-check resolver owns the complete auto-runnable verification set',
  );
  assert.match(
    verificationResolverSource,
    /check\.required && autoRunnableKinds\.has\(check\.kind\)/,
    'required-check resolver selects required automatic checks',
  );
  assert.match(
    verificationResolverSource,
    /requiredAutoChecks\.some\(\(check\) => !terminalIds\.has\(check\.id\)\)\) return 'unverified'/,
    'missing required evaluator results fail closed as unverified',
  );
  assert.match(
    verificationResolverSource,
    /requiredAutoChecks\.some\(\(check\) => !receiptCheckNames\.has\(check\.kind\)\)\) return 'unverified'/,
    'missing required receipt coverage fails closed as unverified',
  );
  assert.match(
    verificationResolverSource,
    /receipt\.editedFiles\.length > 0\) return 'unverified'/,
    'present edits without verified checks cannot complete',
  );

  assert.match(runtime, /terminal:\s*OpenSwanTerminalReceipt/, 'OpenSwanTurnResult requires a terminal receipt');
  assert.match(
    runtime,
    /from ['"]\.\/openswanSessionRuntimeAdapters['"]/,
    'session runtime imports its terminal contract from the dependency-light adapter',
  );
  assert.match(
    runtime,
    /export \{\s*buildOpenSwanTerminalReceipt,/,
    'session runtime preserves the public terminal-builder export',
  );
  assert.match(runtime, /return \{[\s\S]*terminal:\s*terminalReceipt,/, 'runtime returns the exact finalization receipt to consumers');

  const finalization = section(
    runtime,
    'const finalRunExtras = {',
    '// Accountability (proof-of-work)',
    'OpenSwan durable finalization',
  );
  assert.match(
    finalization,
    /terminalReceipt\.completionVerified && terminalReceipt\.state === 'succeeded'\) \{[\s\S]*completeRunUnlessCancelled[\s\S]*\} else \{[\s\S]*failRunUnlessCancelled/,
    'only verified succeeded receipts complete; partial and failed receipts share the fail writer',
  );
  assert.match(
    finalization,
    /terminalReceipt\.state === 'cancelled'[\s\S]*updateRunStatus\([\s\S]*'cancelled'/,
    'cancelled terminal receipts preserve the cancelled durable state',
  );
  assert.doesNotMatch(
    finalization,
    /if \(turnCancelled\)[\s\S]*else \{\s*await completeRunUnlessCancelled/,
    'runtime no longer promotes every non-cancelled exit to completed',
  );
  assert.match(
    finalization,
    /const finalized = await completeRunUnlessCancelled[\s\S]*finalized\.outcome === 'applied'[\s\S]*finalized\.outcome === 'cancelled'/,
    'verified-success finalization consumes the guarded database result',
  );
  assert.match(
    finalization,
    /const finalized = await failRunUnlessCancelled[\s\S]*finalized\.outcome === 'applied'[\s\S]*finalized\.outcome === 'cancelled'/,
    'non-success finalization consumes the guarded database result',
  );
  assert.match(
    finalization,
    /const cancelPersisted = await updateRunStatus[\s\S]*cancelPersisted \? 'verified' : 'unverified'/,
    'direct cancelled finalization also records whether persistence was verified',
  );
  const finalWriterIndex = Math.max(
    finalization.indexOf('const finalized = await completeRunUnlessCancelled'),
    finalization.indexOf('const finalized = await failRunUnlessCancelled'),
    finalization.indexOf('const cancelPersisted = await updateRunStatus'),
  );
  const receiptRebuildIndex = finalization.indexOf(
    'terminalReceipt = buildOpenSwanTerminalReceipt',
    finalWriterIndex,
  );
  assert.ok(finalWriterIndex >= 0, 'guarded finalization writer exists');
  assert.ok(
    receiptRebuildIndex > finalWriterIndex,
    'terminal receipt is rebuilt from guarded persistence truth before proof publication',
  );
  assert.match(
    finalization.slice(receiptRebuildIndex),
    /persistenceDisposition:\s*turnPersistenceDisposition[\s\S]*delegationDisposition:\s*turnDelegationDisposition/,
    'rebuilt terminal folds persistence and delegation truth',
  );

  const parentDelegation = section(
    runtime,
    'const delegatedResultStatuses = delegated.results.map',
    '// CA-8d summary-only contract',
    'parent delegation disposition',
  );
  assert.match(
    parentDelegation,
    /result\.parentSummary\.status === 'completed' && result\.summaryMeta\.completed === true/,
    'parent uses the typed child summary and actual completed flag, never child prose',
  );
  assert.match(
    parentDelegation,
    /delegated\.results\.length === delegated\.specs\.length[\s\S]*delegatedResultStatuses\.every\(\(status\) => status === 'completed'\)/,
    'parent delegation completes only when every planned child actually completed',
  );
  const childTerminalProjection = section(
    subagent,
    'const childTerminalInput = {',
    'const observedEval = buildOpenSwanObservedEvalSummary',
    'child terminal finalization',
  );
  assert.match(
    childTerminalProjection,
    /let terminal = buildOpenSwanTerminalReceipt\(childTerminalInput\)/,
    'child creates its own typed terminal receipt',
  );
  assert.match(
    childTerminalProjection,
    /terminal\.completionVerified[\s\S]*completeRunUnlessCancelled[\s\S]*failRunUnlessCancelled/,
    'child durable finalization branches on verified completion',
  );
  assert.match(
    childTerminalProjection,
    /persistenceDisposition:\s*finalized\.outcome === 'applied'[\s\S]*finalized\.outcome === 'cancelled'/,
    'child rebuilds terminal truth from its guarded persistence result',
  );
  const childParentSummary = section(
    subagent,
    'const summaryPayload = buildSubagentLoopSummary',
    'return {',
    'child parent-summary projection',
  );
  assert.match(
    childParentSummary,
    /completedCleanly:\s*terminal\.completionVerified/,
    'child summary completion comes from the terminal receipt',
  );

  const modeSummary = section(
    runtime,
    'function buildModeOutcomeSummary',
    'function buildModeSummaryArtifacts',
    'terminal-aware mode summary',
  );
  assert.match(modeSummary, /terminal:\s*OpenSwanTerminalReceipt/, 'mode summary requires typed terminal truth');
  assert.match(
    modeSummary,
    /args\.terminal\.state === 'succeeded' && args\.terminal\.completionVerified/,
    'mode summary uses completion copy only for verified success',
  );
  assert.match(
    runtime,
    /memoryRecommendations = terminalReceipt\.completionVerified[\s\S]*\? buildOpenSwanMemoryRecommendations[\s\S]*:\s*\[\]/,
    'success-memory recommendations are skipped for every unverified terminal',
  );
  assert.match(
    runtime,
    /status:\s*terminalReceipt\.state === 'succeeded' && terminalReceipt\.completionVerified[\s\S]*\? 'completed'[\s\S]*:\s*terminalReceipt\.state === 'cancelled'[\s\S]*\? 'cancelled'[\s\S]*:\s*'failed'/,
    'observed eval status is terminal-aware and cannot mark partial work completed',
  );
  assert.match(
    runtime,
    /\.\.\.\(terminalReceipt\.completionVerified[\s\S]*recordArchiveDerivedMemorySuccess/,
    'archive-derived success learning is guarded by verified completion',
  );
  assert.match(
    runtime,
    /if \(terminalReceipt\.completionVerified\) \{[\s\S]*captureOpenSwanOutcomeMemory/,
    'outcome success memory is captured only after verified completion',
  );

  assert.match(lane, /normalizeOpenSwanTerminalOutcome/, 'Chat owns a typed OpenSwan terminal normalizer');
  assertSyntacticallyValid(chat, chatPath);
  assert.match(chat, /normalizeOpenSwanTerminalOutcome\(/, 'Chat projects the runtime receipt through the normalizer');
  assert.match(chat, /structured\.terminal/, 'Chat passes the authoritative receipt into its lane projection');
  const openSwanChatTerminal = section(
    chat,
    'const openSwanTerminalOutcome = normalizeOpenSwanTerminalOutcome',
    'const runtimeToolEvents',
    'Chat OpenSwan terminal projection',
  );
  assert.match(openSwanChatTerminal, /recordChatLaneOutcomeNow\(openSwanTerminalOutcome\)/, 'lane health records the normalized receipt');
  assert.doesNotMatch(openSwanChatTerminal, /status:\s*['"]completed['"]/, 'Chat does not hardcode the OpenSwan lane completed');
  const openSwanChatOutcome = section(
    chat,
    'const openSwanTerminalOutcomeSignal = deriveOpenSwanTerminalChatOutcomeSignal(structured.terminal)',
    'const handoff = structured.terminal.state',
    'Chat OpenSwan outcome metadata projection',
  );
  assert.match(
    openSwanChatOutcome,
    /outcomeSignal:\s*\{[\s\S]*verdict:\s*openSwanTerminalVerdict/,
    'persisted Chat outcome verdict is derived from the terminal receipt',
  );
  assert.match(
    openSwanChatOutcome,
    /openSwanTerminal:\s*projectPersistedOpenSwanTerminal\(structured\.terminal\)/,
    'Chat snapshots the exact bounded runtime terminal before persistence',
  );
  assert.doesNotMatch(
    openSwanChatOutcome,
    /outcomeSignal:\s*\{[\s\S]{0,160}verdict:\s*['"]completed['"]/,
    'Chat outcome metadata never hardcodes completion for OpenSwan',
  );

  assert.match(
    persistedChat,
    /const OPENSWAN_TERMINAL_REASONS_BY_STATE = \{[\s\S]*verification_unverified[\s\S]*delegation_incomplete[\s\S]*persistence_unverified/,
    'Chat persistence allowlists every expanded terminal reason under an exact state',
  );
  assert.equal(
    projectPersistedOpenSwanTerminal({
      state: 'succeeded',
      reason: 'verification_failed',
      completionVerified: true,
      resumable: false,
      checkpoint: null,
    } as any),
    undefined,
    'Chat persistence rejects an invalid state/reason pair instead of laundering success',
  );

  assert.match(
    roomChat,
    /buildRoomAgentMessageMetadata\(structured, artifacts\)[\s\S]*prependRoomTerminalStatus\(structured\.response, structured\.terminal\)/,
    'Room Chat persists and presents the same runtime terminal receipt',
  );
  assert.match(
    roomMetadata,
    /completionVerified:\s*state === 'succeeded' && receipt\.completionVerified === true/,
    'Room metadata cannot persist verified completion for a non-success state',
  );
  assert.match(
    missionCompletion,
    /if \(input\?\.terminal != null\) \{[\s\S]*terminal\.state === 'partial'[\s\S]*terminal\.state === 'cancelled'[\s\S]*terminal\.state !== 'succeeded'[\s\S]*terminal\.completionVerified !== true/,
    'Mission completion checks terminal truth before legacy evidence or prose',
  );
  assert.match(
    missionDispatch,
    /assessMissionTaskCompletion\(\{[\s\S]*terminal:\s*structured\.terminal[\s\S]*updateMissionTask\(taskId, \{ status: completed \? 'done' : 'in_progress' \}\)/,
    'Mission dispatch marks done only from terminal-aware completion assessment',
  );
  assert.match(
    missionDispatch,
    /terminal_state:\s*structured\.terminal\.state[\s\S]*terminal_reason:\s*structured\.terminal\.reason[\s\S]*completion_verified:\s*structured\.terminal\.completionVerified/,
    'Mission proof persists exact terminal state, reason, and completion truth',
  );

  console.log(`OpenSwan terminal outcome contract smoke passed (${terminalCases.length} terminal cases, ${resolvedVerificationCases.length} verification-resolution cases, and runtime/Chat/Room/Mission wiring).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
