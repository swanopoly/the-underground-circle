/**
 * Behavioral/source smoke for the inert universal-root pointer carried by the
 * Browser Plan and cloud Computer Use clients.
 *
 * The production modules import React Native surfaces, so this smoke compiles
 * only their dependency-free production functions and supplies stubs for
 * unrelated session/action work. The full app typecheck covers integration.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { sanitizeComputerTaskRootPointer } from '../src/lib/computerTaskRootStore';

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

function compileFactory<T>(
  source: string,
  returnExpression: string,
  bindings: Record<string, unknown> = {},
): T {
  const output = ts.transpileModule(
    `${source.replace(/\bexport\s+/g, '')}\nreturn ${returnExpression};`,
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    },
  ).outputText;
  return new Function(...Object.keys(bindings), output)(...Object.values(bindings)) as T;
}

const agentSource = readFileSync('src/lib/computerUseAgent.ts', 'utf8');
const computerUseSource = readFileSync('src/lib/computerUse.ts', 'utf8');
const hookSource = readFileSync('src/lib/useComputerUseTask.ts', 'utf8');

check(
  agentSource.includes("from './computerTaskRootStore';")
    && agentSource.includes('export { sanitizeComputerTaskRootPointer };'),
  'computer-use client preserves its sanitizer export through the canonical root store',
);
check(
  !agentSource.includes('export function sanitizeComputerTaskRootPointer('),
  'computer-use client does not duplicate the canonical pointer sanitizer',
);
const payloadSource = section(
  agentSource,
  'export interface ComputerUseAgentRequestPayload',
  'export function startComputerUseAgent',
  'agent POST payload builder',
);
const pointerCore = compileFactory<{
  sanitizeComputerTaskRootPointer: (value: unknown) => Record<string, unknown> | null;
  buildComputerUseAgentRequestPayload: (opts: Record<string, unknown>) => Record<string, unknown> | null;
}>(
  `type ComputerTaskRootPointerV1 = any;
   type ComputerUsePolicyEnvelope = any;
   type ComputerUseAgentOpts = any;
   const sanitizeComputerTaskRootPointer = __sanitizeComputerTaskRootPointer;
   ${payloadSource}`,
  '{ sanitizeComputerTaskRootPointer, buildComputerUseAgentRequestPayload }',
  { __sanitizeComputerTaskRootPointer: sanitizeComputerTaskRootPointer },
);

const rootHex = 'a'.repeat(64);
const validPointer: Record<string, unknown> = {
  schemaVersion: 1,
  rootRowId: '11111111-1111-4111-8111-111111111111',
  runId: '22222222-2222-4222-8222-222222222222',
  rootId: `computer_task_${rootHex}`,
  rootFingerprint: `args-v2:sha256:${'b'.repeat(64)}`,
  requestIdentityFingerprint: `args-v2:sha256:${'c'.repeat(64)}`,
  taskFingerprint: `args-v2:sha256:${'d'.repeat(64)}`,
};
const pointerKeys = [
  'schemaVersion',
  'rootRowId',
  'runId',
  'rootId',
  'rootFingerprint',
  'requestIdentityFingerprint',
  'taskFingerprint',
].sort();

const sanitized = pointerCore.sanitizeComputerTaskRootPointer(validPointer);
check(Boolean(sanitized), 'valid seven-field pointer sanitizes');
check(sanitized !== validPointer, 'sanitizer returns a clone, not caller-owned identity');
check(Object.isFrozen(sanitized), 'sanitized pointer is immutable');
check(JSON.stringify(Object.keys(sanitized!).sort()) === JSON.stringify(pointerKeys), 'sanitized pointer has exactly seven keys');

const upperUuid = {
  ...validPointer,
  rootRowId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
};
check(
  pointerCore.sanitizeComputerTaskRootPointer(upperUuid)?.rootRowId
    === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'UUID correlation is cloned into canonical lowercase',
);
check(
  pointerCore.sanitizeComputerTaskRootPointer({ ...validPointer, extraAuthority: true }) === null,
  'extra-key pointer is rejected instead of carrying apparent authority',
);
const missingPointer = { ...validPointer };
delete missingPointer.taskFingerprint;
check(pointerCore.sanitizeComputerTaskRootPointer(missingPointer) === null, 'missing-key pointer is rejected');
check(
  pointerCore.sanitizeComputerTaskRootPointer({ ...validPointer, taskFingerprint: 'args-v2:not-sha' }) === null,
  'malformed fingerprint is rejected',
);
const accessorPointer = { ...validPointer };
Object.defineProperty(accessorPointer, 'rootId', {
  enumerable: true,
  get: () => `computer_task_${rootHex}`,
});
check(pointerCore.sanitizeComputerTaskRootPointer(accessorPointer) === null, 'accessor-backed pointer is rejected without invoking authority getters');
const symbolPointer = { ...validPointer } as Record<PropertyKey, unknown>;
symbolPointer[Symbol('hidden')] = 'authority';
check(pointerCore.sanitizeComputerTaskRootPointer(symbolPointer) === null, 'symbol-key pointer is rejected');
const hostileProxy = new Proxy(validPointer, {
  ownKeys() { throw new Error('hostile pointer'); },
});
check(pointerCore.sanitizeComputerTaskRootPointer(hostileProxy) === null, 'throwing Proxy pointer fails closed without escaping');

const policy = {
  schemaVersion: 1,
  executionMode: 'interactive',
  source: 'chat',
  userConstraints: [],
  alwaysConfirmCategories: [],
};
const requestOpts = {
  task: 'Read the page',
  circleId: 'circle-1',
  userId: 'user-1',
  browserbase: { apiKey: 'test-only', projectId: 'project-1' },
  policy,
  computerTaskRootPointer: validPointer,
};
const payload = pointerCore.buildComputerUseAgentRequestPayload(requestOpts);
check(Boolean(payload), 'valid pointer produces a cloud request payload');
check(payload?.computerTaskRootPointer !== validPointer, 'POST payload carries a strict pointer clone');
check(
  JSON.stringify(Object.keys(payload?.computerTaskRootPointer as object).sort()) === JSON.stringify(pointerKeys),
  'POST JSON projection carries only seven pointer fields',
);
check(
  pointerCore.buildComputerUseAgentRequestPayload({
    ...requestOpts,
    computerTaskRootPointer: { ...validPointer, approval: 'approved' },
  }) === null,
  'explicit malformed pointer fails the cloud payload closed',
);
const noPointerPayload = pointerCore.buildComputerUseAgentRequestPayload({
  ...requestOpts,
  computerTaskRootPointer: undefined,
});
check(Boolean(noPointerPayload) && !Object.prototype.hasOwnProperty.call(noPointerPayload, 'computerTaskRootPointer'), 'legacy no-pointer request stays supported and omits the field');

// Execute the production Browser Plan projection functions with only their
// unrelated runtime dependencies stubbed.
// These two functions are intentionally the final exports.
const finalProjectionSource = computerUseSource.slice(
  computerUseSource.indexOf('export function toBrowserSessionRecord('),
);
check(finalProjectionSource.includes('export function toBrowserPlanCardData('), 'plan projection follows session record projection');
const projections = compileFactory<{
  toBrowserSessionRecord: (session: Record<string, any>, result?: { success: boolean }) => Record<string, any>;
  toBrowserPlanCardData: (plan: Record<string, any>, pointer?: unknown) => Record<string, any>;
}>(
  `const sanitizeComputerTaskRootPointer = __sanitizeComputerTaskRootPointer;
   const withoutPersistedMutationInput = (action: unknown) => action;
   type ComputerUseSession = any;
   type ComputerUseResult = any;
   type BrowserSessionRecord = any;
   type ComputerUsePlanSummary = any;
   type BrowserPlanCardData = any;
   type ComputerTaskRootPointerV1 = any;
   ${finalProjectionSource}`,
  '{ toBrowserSessionRecord, toBrowserPlanCardData }',
  { __sanitizeComputerTaskRootPointer: pointerCore.sanitizeComputerTaskRootPointer },
);

const plan = {
  ok: true,
  task: 'Read example.com',
  intent: { mode: 'research' },
  backend: 'playwright_bridge',
  backendLabel: 'Local Browser Bridge',
  requiresApproval: false,
  recommendedPermission: 'none',
  actions: [{
    id: 'read-1',
    type: 'observe',
    description: 'Read page',
    requiresApproval: false,
    status: 'pending',
  }],
};
const card = projections.toBrowserPlanCardData(plan, validPointer);
check(Boolean(card.computerTaskRootPointer), 'BrowserPlanCardData receives sanitized root pointer');
check(card.computerTaskRootPointer !== validPointer, 'BrowserPlanCardData does not retain caller-owned pointer');
check(Object.isFrozen(card.computerTaskRootPointer), 'BrowserPlanCardData pointer is immutable');
const invalidCard = projections.toBrowserPlanCardData(plan, { ...validPointer, extra: true });
check(!Object.prototype.hasOwnProperty.call(invalidCard, 'computerTaskRootPointer'), 'malformed card pointer becomes absent');

const createSessionSource = section(
  computerUseSource,
  'export async function createSessionFromBrowserPlan(',
  'export async function planActions(',
  'Browser Plan session projection',
);
const sessionProjection = compileFactory<{
  createSessionFromBrowserPlan: (
    agentName: string,
    permission: string,
    planData: Record<string, any>,
    opts?: Record<string, unknown>,
  ) => Promise<Record<string, any>>;
}>(
  `const sanitizeComputerTaskRootPointer = __sanitizeComputerTaskRootPointer;
   const createSession = async (agentName: string, task: string, permission: string) => ({
     id: 'session-1', agentName, task, permission, actions: [], status: 'planning',
     startedAt: '2026-08-06T12:00:00.000Z', approvedDomains: [],
     backend: 'playwright_bridge', backendLabel: 'Local Browser Bridge'
   });
   const normalizeComputerUsePlannedAction = (action: any) => ({ ...action, blockedReason: undefined });
   type ComputerUsePermission = any;
   type BrowserPlanCardData = any;
   type ComputerUseSession = any;
   ${createSessionSource}`,
  '{ createSessionFromBrowserPlan }',
  { __sanitizeComputerTaskRootPointer: pointerCore.sanitizeComputerTaskRootPointer },
);

async function main(): Promise<void> {
  const session = await sessionProjection.createSessionFromBrowserPlan('OpenSwan', 'trusted', card);
  check(Boolean(session.computerTaskRootPointer), 'ComputerUseSession receives card root pointer');
  check(session.computerTaskRootPointer !== card.computerTaskRootPointer, 'ComputerUseSession reclones persisted card pointer');
  const record = projections.toBrowserSessionRecord(session);
  check(Boolean(record.computerTaskRootPointer), 'BrowserSessionRecord receives session root pointer');
  check(record.computerTaskRootPointer !== session.computerTaskRootPointer, 'BrowserSessionRecord reclones session pointer');
  check(
    JSON.stringify(Object.keys(record.computerTaskRootPointer).sort()) === JSON.stringify(pointerKeys),
    'persisted browser session record carries only seven pointer fields',
  );

  const malformedSession = await sessionProjection.createSessionFromBrowserPlan(
    'OpenSwan',
    'trusted',
    { ...card, computerTaskRootPointer: { ...validPointer, extra: true } },
  );
  check(!Object.prototype.hasOwnProperty.call(malformedSession, 'computerTaskRootPointer'), 'malformed persisted card pointer becomes absent from session');

  const hookPointerCheck = hookSource.indexOf('const rootPointerWasSupplied');
  const hookAgentStart = hookSource.indexOf('startedHandle = startComputerUseAgent({');
  check(hookPointerCheck >= 0 && hookPointerCheck < hookAgentStart, 'hook validates root pointer before agent startup');
  check(
    hookSource.includes('computerTaskRootPointer?: ComputerTaskRootPointerV1 | null;')
      && hookSource.includes('computerTaskRootPointer,\n        browserbase:'),
    'hook run option passes the sanitized pointer into ComputerUseAgentOpts',
  );
  const payloadBuild = agentSource.indexOf('const requestPayload = buildComputerUseAgentRequestPayload(opts);');
  const fetchStart = agentSource.indexOf('const res = await fetch(');
  check(payloadBuild >= 0 && payloadBuild < fetchStart, 'client builds/fails the strict payload before network fetch');
  check(
    agentSource.includes('The edge is responsible for an')
      && agentSource.includes('authenticated re-read and CAS transition before any mutation'),
    'client explicitly documents edge re-read/CAS as mutation authority',
  );

  console.log(`computer-use root pointer smoke: PASS (${assertions} assertions)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
