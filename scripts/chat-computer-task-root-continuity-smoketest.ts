/**
 * Source-level continuity smoke for the inert universal computer-task root.
 *
 * This intentionally spans the Chat admission boundary, Browser Plan/session
 * projections, cloud Computer Use launch paths, and persisted Chat metadata.
 * The pointer is correlation only: every boundary must sanitize its exact
 * seven fields and no pointer may become approval, policy, or dispatch
 * authority.
 *
 * Run: npx tsx scripts/chat-computer-task-root-continuity-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(start >= 0, `${label}: start marker exists`);
  check(end > start, `${label}: end marker follows start`);
  return source.slice(start, end);
}

function indexAfter(source: string, marker: string, after: number, label: string): number {
  const index = source.indexOf(marker, after);
  check(index >= after, `${label}: ${marker} exists after the expected boundary`);
  return index;
}

function allIndices(source: string, marker: string): number[] {
  const indices: number[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const index = source.indexOf(marker, cursor);
    if (index < 0) break;
    indices.push(index);
    cursor = index + marker.length;
  }
  return indices;
}

function pointerProjectionSlices(
  source: string,
  startMarker: string,
  endMarker: string,
  expectedCount: number,
  subject: 'plan' | 'session',
): void {
  const starts = allIndices(source, startMarker);
  check(starts.length === expectedCount, `${subject} persistence has exactly ${expectedCount} compact projections`);
  for (const [index, start] of starts.entries()) {
    const end = source.indexOf(endMarker, start + startMarker.length);
    check(end > start, `${subject} persistence projection ${index + 1} has its expected end marker`);
    const projection = source.slice(start, end);
    check(
      projection.includes('computerTaskRootPointer:'),
      `${subject} persistence projection ${index + 1} retains the root pointer field`,
    );
    check(
      projection.includes(`sanitizeComputerTaskRootPointer(${subject}.computerTaskRootPointer)`),
      `${subject} persistence projection ${index + 1} sanitizes before retaining the pointer`,
    );
  }
}

const chatSource = readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8');
const persistedSource = readFileSync('src/lib/persistedChatMetadata.ts', 'utf8');
const computerUseSource = readFileSync('src/lib/computerUse.ts', 'utf8');
const hookSource = readFileSync('src/lib/useComputerUseTask.ts', 'utf8');
const agentSource = readFileSync('src/lib/computerUseAgent.ts', 'utf8');
const rootStoreSource = readFileSync('src/lib/computerTaskRootStore.ts', 'utf8');

// 1. Chat admits one authenticated task root before any planning, bridge,
// capability audit, or browser-plan work.
const executeStart = chatSource.indexOf('const executeSharedComputerTask = useCallback(async');
check(executeStart >= 0, 'Chat shared computer-task entry point exists');
const admittedUser = indexAfter(chatSource, 'const admittedUserId = currentUserId;', executeStart, 'authenticated user capture');
const admittedCircle = indexAfter(chatSource, 'const admittedCircleId = circleId;', executeStart, 'authenticated circle capture');
const admittedThread = indexAfter(chatSource, 'const admittedThreadId = activeThreadId;', executeStart, 'authenticated thread capture');
const admission = indexAfter(
  chatSource,
  'const universalTaskRootAdmission = await admitComputerTaskRuntimeRoot({',
  executeStart,
  'universal root admission',
);
check(admittedUser < admission && admittedCircle < admission && admittedThread < admission, 'authenticated Chat scope is captured before root admission');

const admissionInput = chatSource.slice(admission, admission + 900);
for (const expected of [
  'schemaVersion: 1',
  'requestIdentity',
  'userId: admittedUserId',
  'circleId: admittedCircleId',
  'threadId: admittedThreadId',
  "source: 'chat'",
  'normalizedTask: trimmed',
  'admittedAt: new Date().toISOString()',
]) {
  check(admissionInput.includes(expected), `root admission binds ${expected}`);
}

const admissionFailure = indexAfter(chatSource, 'if (!universalTaskRootAdmission?.ok)', admission, 'admission failure gate');
const postAwaitScope = indexAfter(chatSource, 'const latestScope = computerTaskAuthScopeRef.current;', admissionFailure, 'post-await scope check');
const rootBinding = indexAfter(chatSource, 'const universalTaskRoot = universalTaskRootAdmission.binding;', postAwaitScope, 'admitted binding');
const rootPointer = indexAfter(chatSource, 'const universalTaskRootPointer = universalTaskRoot.durableRecord', rootBinding, 'durable pointer projection');
check(
  chatSource.slice(admissionFailure, postAwaitScope).includes('return { handled: true as const, browser: false as const };'),
  'failed admission returns before planning or bridge access',
);
check(
  chatSource.slice(postAwaitScope, rootBinding).includes('return { handled: true as const, browser: false as const };'),
  'authenticated scope drift returns before planning or bridge access',
);
check(
  chatSource.slice(rootPointer, rootPointer + 260).includes('toComputerTaskRootPointer(universalTaskRoot.durableRecord)'),
  'Chat derives the pointer only from an issued durable root record',
);

const protectedBoundaries = [
  'prepareComputerTaskExecution({',
  'buildComputerTaskSurfacePreparationPlan(',
  'autoConnectDesktopBridge()',
  'auditComputerCapabilities(',
  'describeComputerUsePlan({',
];
for (const boundary of protectedBoundaries) {
  const boundaryIndex = indexAfter(chatSource, boundary, executeStart, `protected ${boundary}`);
  check(rootBinding < boundaryIndex, `root admission and scope recheck precede ${boundary}`);
}

// 2. The Browser Plan card receives the inert pointer, and every browser
// projection sanitizes it rather than retaining caller-owned data.
const planCall = indexAfter(chatSource, 'const plan = await describeComputerUsePlan({', rootBinding, 'browser plan call');
const planCardCall = indexAfter(chatSource, 'const planCard = toBrowserPlanCardData(', planCall, 'browser plan card projection');
check(
  chatSource.slice(planCardCall, planCardCall + 150).includes('toBrowserPlanCardData(plan, universalTaskRootPointer)'),
  'Chat puts the admitted root pointer on the Browser Plan card',
);

const planCardProjection = section(
  computerUseSource,
  'export function toBrowserPlanCardData(',
  '\n}',
  'Browser Plan card projection',
);
check(planCardProjection.includes('rootPointer?: ComputerTaskRootPointerV1 | null'), 'plan card accepts only the typed optional pointer');
check(planCardProjection.includes('sanitizeComputerTaskRootPointer(rootPointer)'), 'plan card sanitizes its pointer');
check(planCardProjection.includes('...(computerTaskRootPointer ? { computerTaskRootPointer } : {})'), 'plan card omits malformed or absent pointers');

const browserPlanToSession = section(
  computerUseSource,
  'export async function createSessionFromBrowserPlan(',
  'export async function planActions(',
  'Browser Plan to session continuity',
);
check(
  browserPlanToSession.includes('sanitizeComputerTaskRootPointer(plan.computerTaskRootPointer)'),
  'Browser Plan to session handoff re-sanitizes the pointer',
);
check(
  browserPlanToSession.includes('session.computerTaskRootPointer = computerTaskRootPointer'),
  'Browser session receives only the sanitized pointer',
);

const sessionRecordProjection = section(
  computerUseSource,
  'export function toBrowserSessionRecord(',
  'export function toBrowserPlanCardData(',
  'persisted Browser session projection',
);
check(
  sessionRecordProjection.includes('sanitizeComputerTaskRootPointer(session.computerTaskRootPointer)'),
  'persisted Browser session record re-sanitizes its pointer',
);
check(
  sessionRecordProjection.includes('...(computerTaskRootPointer ? { computerTaskRootPointer } : {})'),
  'persisted Browser session record omits malformed pointers',
);

// 3. Both cloud starts carry the card pointer: the no-approval auto-start and
// the explicit approved-plan start.
const autoStart = indexAfter(chatSource, 'const autoStarted = await computerUseTask.run(trimmed, {', planCardCall, 'cloud auto-start');
check(
  chatSource.slice(autoStart, autoStart + 650).includes('computerTaskRootPointer: browserPlan.computerTaskRootPointer'),
  'cloud auto-start carries its Browser Plan root pointer',
);
const approvedStart = indexAfter(chatSource, 'const started = await computerUseTask.run(taskToRun, {', autoStart, 'approved Browser Plan start');
check(
  chatSource.slice(approvedStart, approvedStart + 650).includes('computerTaskRootPointer: planToRun?.computerTaskRootPointer'),
  'approved-plan cloud start carries its selected plan root pointer',
);

const hookRun = section(
  hookSource,
  'const run = useCallback(',
  'const cancel = useCallback(',
  'Computer Use hook start',
);
const hookInvalid = hookRun.indexOf('if (rootPointerWasSupplied && !computerTaskRootPointer)');
const hookCredentials = hookRun.indexOf('resolveComputerUseCreds(circleId)');
const hookAgentStart = hookRun.indexOf('startComputerUseAgent({');
check(hookInvalid >= 0, 'Computer Use hook has an explicit malformed-pointer gate');
check(hookCredentials > hookInvalid, 'malformed pointer is rejected before credential resolution');
check(hookAgentStart > hookCredentials, 'cloud agent starts only after the pointer gate and credentials');
check(
  hookRun.slice(hookAgentStart, hookAgentStart + 1200).includes('computerTaskRootPointer,'),
  'Computer Use hook passes its sanitized pointer to the cloud client',
);

// 4. Persistence keeps the inert pointer across write/read round trips and
// both bounded metadata tiers for plan cards and session records.
const persistencePointerHelper = section(
  persistedSource,
  'function preserveInertComputerTaskRootPointer',
  'export type PersistedChatRecoveryOption',
  'persisted pointer helper',
);
check(
  persistencePointerHelper.includes('sanitizeComputerTaskRootPointer(value.computerTaskRootPointer)'),
  'persistence helper sanitizes untrusted pointer data',
);
check(
  persistencePointerHelper.includes('const { computerTaskRootPointer: _discarded, ...rest } = value;'),
  'persistence helper removes the untrusted field before conditionally restoring it',
);
check(
  persistencePointerHelper.includes('browserPlans.map((plan) => preserveInertComputerTaskRootPointer('),
  'persistence helper covers Browser Plan cards',
);
check(
  persistencePointerHelper.includes('browserSessions.map((session) => preserveInertComputerTaskRootPointer('),
  'persistence helper covers Browser session records',
);

const persistedRead = section(
  persistedSource,
  'export function readPersistedChatBotMetadata(',
  'export type LegacyPersistedChatFallbackMode',
  'persisted metadata read path',
);
check(persistedRead.includes('preserveInertBrowserRootPointers(parsed)'), 'persisted metadata read path validates browser root pointers');
const persistedWrite = section(
  persistedSource,
  'export function formatPersistedChatBotMessage(',
  "// The 'tiny' tier",
  'persisted metadata write path',
);
check(persistedWrite.includes('preserveInertBrowserRootPointers(metadata)'), 'persisted metadata write path validates browser root pointers');

pointerProjectionSlices(
  persistedSource,
  'browserPlans: metadata.browserPlans?',
  'browserPlanEvents:',
  2,
  'plan',
);
pointerProjectionSlices(
  persistedSource,
  'browserSessions: metadata.browserSessions?',
  'recoveryOptions:',
  2,
  'session',
);
check(
  !/computerTaskRootPointer\s*:\s*(?:plan|session)\.computerTaskRootPointer\b/.test(persistedSource),
  'persistence never copies a raw plan/session pointer directly',
);

// 5. Malformed pointers fail closed at each active client boundary.
const sanitizer = section(
  rootStoreSource,
  'export function sanitizeComputerTaskRootPointer(',
  'function rootMatchesPointer(',
  'canonical root pointer sanitizer',
);
for (const field of [
  'schemaVersion',
  'rootRowId',
  'runId',
  'rootId',
  'rootFingerprint',
  'requestIdentityFingerprint',
  'taskFingerprint',
]) {
  check(sanitizer.includes(`'${field}'`), `sanitizer allowlists ${field}`);
}
check(sanitizer.includes('ownKeys.length !== keys.size'), 'sanitizer rejects missing and extra own keys');
check(sanitizer.includes('Reflect.ownKeys(descriptors)'), 'sanitizer includes symbol keys in its rejection boundary');
check(sanitizer.includes("!('value' in descriptor) || descriptor.get || descriptor.set"), 'sanitizer rejects accessor-backed fields');
check(
  sanitizer.includes('parseUuid(record.rootRowId)') && sanitizer.includes('parseUuid(record.runId)'),
  'sanitizer validates durable UUID identifiers',
);
check(sanitizer.includes("const fingerprint = /^args-v2:sha256:[0-9a-f]{64}$/;"), 'sanitizer validates root fingerprints');
check(sanitizer.includes("!/^computer_task_[0-9a-f]{64}$/.test(record.rootId)"), 'sanitizer validates the task-root identifier');
check(sanitizer.includes('} catch {\n    return null;'), 'hostile pointer inspection fails closed');
check(
  agentSource.includes("from './computerTaskRootStore';")
    && agentSource.includes('export { sanitizeComputerTaskRootPointer };'),
  'computer-use client imports and preserves the canonical sanitizer export',
);
check(
  !agentSource.includes('export function sanitizeComputerTaskRootPointer('),
  'computer-use client does not duplicate the canonical sanitizer implementation',
);

const payloadBuilder = section(
  agentSource,
  'export interface ComputerUseAgentRequestPayload',
  'export function startComputerUseAgent',
  'cloud request payload builder',
);
check(
  payloadBuilder.includes('if (pointerWasSupplied && !computerTaskRootPointer) return null;'),
  'explicit malformed cloud pointer prevents payload construction',
);
check(
  payloadBuilder.includes('...(computerTaskRootPointer ? { computerTaskRootPointer } : {})'),
  'cloud payload carries only a sanitized optional pointer',
);
const clientStartIndex = agentSource.indexOf('export function startComputerUseAgent(');
check(clientStartIndex >= 0, 'cloud client start exists');
const clientStart = agentSource.slice(clientStartIndex);
check(clientStart.includes('if (!requestPayload)'), 'cloud client checks the validated payload');
check(clientStart.includes("opts.onError('The computer task root pointer is invalid. Nothing was started.');"), 'cloud client reports malformed pointer without starting');
check(clientStart.includes('body: JSON.stringify(requestPayload)'), 'cloud client POSTs only the allowlisted payload projection');

// 6. The pointer remains correlation, never approval/policy/dispatch authority.
const pointerType = section(
  rootStoreSource,
  'export type ComputerTaskRootPointerV1 = Readonly<{',
  '}>;',
  'root pointer type',
);
const declaredFields = Array.from(pointerType.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm), (match) => match[1]).sort();
const expectedFields = [
  'requestIdentityFingerprint',
  'rootFingerprint',
  'rootId',
  'rootRowId',
  'runId',
  'schemaVersion',
  'taskFingerprint',
].sort();
check(JSON.stringify(declaredFields) === JSON.stringify(expectedFields), 'root pointer type exposes exactly seven inert correlation fields');
for (const forbidden of ['approval', 'authorization', 'claim', 'dispatch', 'lease', 'revision', 'state', 'action']) {
  check(!pointerType.toLowerCase().includes(forbidden), `root pointer type contains no ${forbidden} authority`);
}

const policyType = section(
  agentSource,
  'export interface ComputerUsePolicyEnvelope {',
  '\n}',
  'Computer Use policy envelope',
);
check(!policyType.includes('computerTaskRootPointer'), 'root pointer is not part of the authorization policy envelope');
check(
  agentSource.includes('Inert correlation pointer only. It cannot authorize an action.'),
  'client contract explicitly marks the pointer non-authoritative',
);
check(
  agentSource.includes('must re-read and CAS the authenticated root before any mutation.'),
  'client contract requires server-side authentication, reread, and CAS',
);
check(computerUseSource.includes('Inert durable-root correlation; never action or approval authority.'), 'session contract marks the pointer inert');
check(computerUseSource.includes('execution must re-read/CAS the durable root'), 'persisted session contract requires root reread and CAS');
check(hookSource.includes('The cloud edge must authenticate, re-read,'), 'hook contract forbids client-pointer authority');

console.log(`chat computer-task root continuity smoke passed (${assertions} assertions)`);
