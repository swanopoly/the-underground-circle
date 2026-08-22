import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

const stateSource = fs.readFileSync('src/lib/computerTaskState.ts', 'utf8');
const planSource = fs.readFileSync('src/lib/agentPlanPersistence.ts', 'utf8');
const historySource = fs.readFileSync('src/lib/computerUseHistory.ts', 'utf8');
let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function section(source: string, start: string, end?: string): string {
  const startAt = source.indexOf(start);
  check(startAt >= 0, `source marker exists: ${start}`);
  if (!end) return source.slice(startAt);
  const endAt = source.indexOf(end, startAt + start.length);
  check(endAt > startAt, `source marker follows: ${end}`);
  return source.slice(startAt, endAt);
}

const metadataStore = new Map<string, string>();
const tokenOwners = new Map([
  ['token-a', 'user-a'],
  ['token-b', 'user-b'],
]);
let authGate: Promise<void> | null = null;

const fakeStorage = {
  getItem: async (key: string) => metadataStore.get(key) ?? null,
  setItem: async (key: string, value: string) => { metadataStore.set(key, String(value)); },
  removeItem: async (key: string) => { metadataStore.delete(key); },
};

const originalLoad = (Module as any)._load;
(Module as any)._load = function loadWithComputerTaskAuthorityStubs(
  request: string,
  parent: { filename?: string } | undefined,
  isMain: boolean,
) {
  const fromComputerTaskState = parent?.filename?.endsWith('/src/lib/computerTaskState.ts')
    || parent?.filename?.endsWith('/src/lib/computerTaskState.js');
  if (fromComputerTaskState && request === './storage') return { storage: fakeStorage };
  if (fromComputerTaskState && request === './authSession') {
    return {
      safeGetUserForAccessToken: async (token: string) => {
        if (authGate) await authGate;
        const userId = tokenOwners.get(token);
        return userId
          ? { value: { id: userId }, error: null }
          : { value: null, error: new Error('invalid token') };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const authorityA = Object.freeze({
  userId: 'user-a',
  circleId: 'circle-a',
  accessToken: 'token-a',
  generation: 1,
});
const authorityB = Object.freeze({
  userId: 'user-b',
  circleId: 'circle-a',
  accessToken: 'token-b',
  generation: 2,
});
let currentAuthority = authorityA;
const isCurrent = (authority: typeof authorityA) => (
  authority.userId === currentAuthority.userId
  && authority.circleId === currentAuthority.circleId
  && authority.accessToken === currentAuthority.accessToken
  && authority.generation === currentAuthority.generation
);

function taskRecord() {
  return {
    id: 'task-a',
    circleId: 'circle-a',
    threadId: null,
    requestIdentity: null,
    exactPlanApproval: null,
    task: 'Open Photoshop',
    taskKind: 'desktop_app',
    taskLabel: 'Computer task',
    adapterId: null,
    phase: 'planning' as const,
    currentStep: null,
    steps: [],
    blockers: [],
    nextSteps: [],
    grantedAccess: [],
    accessPlan: null,
    runId: null,
    sessionId: null,
    liveUrl: null,
    outcomeStatus: null,
    grounding: null,
    capabilityBuildout: null,
    complexity: null,
    checkpointRecovery: null,
    pendingQuestions: [],
    notifications: [],
    surfaceEscalations: [],
    actionTrace: null,
    updatedAt: new Date(0).toISOString(),
  };
}

async function main(): Promise<void> {
  const state = await import('../src/lib/computerTaskState');

  console.log('Exact local computer-task lane');
  const keyA = state.computerTaskStateExactStorageKey(authorityA, null);
  const keyB = state.computerTaskStateExactStorageKey(authorityB, null);
  check(keyA === 'computer_task_state_v1_exact_v2:user:user-a:circle:circle-a:thread:main', 'exact key binds user, circle, and main thread');
  check(keyA !== keyB, 'two users in the same circle receive different cache lanes');
  check(!keyA?.includes('token-a'), 'captured bearer never enters the local key');
  check(state.computerTaskStateExactStorageKey({ ...authorityA, generation: 0 }, null) === null, 'invalid generation fails closed');

  metadataStore.set('computer_task_state_v1_circle-a_main', JSON.stringify(taskRecord()));
  const beforeSave = await state.loadComputerTaskStateExact(authorityA, null, isCurrent);
  check(beforeSave.ok && beforeSave.record === null, 'exact path never imports ownerless legacy cache data');

  const saved = await state.saveComputerTaskStateExact(taskRecord(), authorityA, isCurrent);
  check(saved.ok, 'current captured authority can save its exact task lane');
  const envelopeText = metadataStore.get(keyA!);
  check(Boolean(envelopeText), 'exact save produces a durable envelope');
  check(!envelopeText?.includes('token-a'), 'durable envelope contains no bearer material');
  const envelope = JSON.parse(envelopeText!);
  check(envelope.userId === 'user-a' && envelope.circleId === 'circle-a', 'envelope repeats exact owner and circle for read validation');

  const loadedA = await state.loadComputerTaskStateExact(authorityA, null, isCurrent);
  check(loadedA.ok && loadedA.record?.id === 'task-a', 'exact owner can reload its task state');
  currentAuthority = authorityB;
  const loadedB = await state.loadComputerTaskStateExact(authorityB, null, isCurrent as any);
  check(loadedB.ok && loadedB.record === null, 'another account cannot read the first account cache');

  currentAuthority = authorityA;
  let releaseAuth!: () => void;
  authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });
  const delayed = state.loadComputerTaskStateExact(authorityA, null, isCurrent);
  await Promise.resolve();
  currentAuthority = authorityB;
  releaseAuth();
  const retired = await delayed;
  authGate = null;
  check(!retired.ok && retired.error === 'authority_retired', 'account switch during token verification drops the late cache result');

  currentAuthority = authorityA;
  const mismatched = await state.saveComputerTaskStateExact(
    { ...taskRecord(), circleId: 'circle-b' },
    authorityA,
    isCurrent,
  );
  check(!mismatched.ok && mismatched.error === 'record_mismatch', 'record from another circle cannot enter the exact lane');
  const cleared = await state.clearComputerTaskStateExact(authorityA, null, isCurrent);
  check(cleared.ok && !metadataStore.has(keyA!), 'exact clear requires an empty readback receipt');

  console.log('Exact plan persistence boundary');
  for (const exportName of ['saveAgentPlanDraftExact', 'listAgentPlansExact', 'updateAgentPlanStatusExact']) {
    check(planSource.includes(`export async function ${exportName}`), `${exportName} is exported`);
  }
  check(planSource.includes('safeGetUserForAccessToken(authority.accessToken)'), 'plan authority verifies the captured bearer');
  const exactPlanSave = section(planSource, 'export async function saveAgentPlanDraftExact', '/** List circle plans');
  check(exactPlanSave.includes('created_by: authority.userId'), 'exact plan creation binds the captured owner');
  check(exactPlanSave.includes('circle_id: authority.circleId'), 'exact plan creation and children bind the captured circle');
  check(exactPlanSave.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"), 'exact plan writes use only the captured bearer');
  check(exactPlanSave.includes("planRow.circle_id !== authority.circleId || planRow.created_by !== authority.userId"), 'plan insert requires an owner/circle receipt');
  check((exactPlanSave.match(/agentPlanAuthorityIsCurrent\(authority, isCurrent\)/g) || []).length >= 8, 'plan save fences each multi-row await boundary');
  const exactPlanList = section(planSource, 'export async function listAgentPlansExact', '/** Update only a plan');
  check(exactPlanList.includes(".eq('circle_id', authority.circleId)"), 'exact plan list filters the captured circle');
  check(exactPlanList.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"), 'exact plan list uses the captured bearer');
  check(exactPlanList.includes("return exactListFailure(authority, 'authority_retired')"), 'exact plan list drops late responses');
  const exactPlanUpdate = section(planSource, 'export async function updateAgentPlanStatusExact');
  check(exactPlanUpdate.includes(".eq('circle_id', authority.circleId)"), 'exact status update filters the captured circle');
  check(exactPlanUpdate.includes(".eq('created_by', authority.userId)"), 'exact status update filters the captured owner');
  check(exactPlanUpdate.includes(".select('id,circle_id,created_by,status')"), 'exact status update requires an immutable receipt projection');

  console.log('Exact Computer Use history boundary');
  for (const exportName of ['listCircleComputerUseRunsExact', 'loadRecentComputerUseRunsExact', 'getComputerUseRunExact']) {
    check(historySource.includes(`export async function ${exportName}`), `${exportName} is exported`);
  }
  check(historySource.includes('safeGetUserForAccessToken(authority.accessToken)'), 'history authority verifies the captured bearer');
  for (const [label, start, end] of [
    ['full history', 'export async function listCircleComputerUseRunsExact', '/**\n * Lightweight row shape'],
    ['recent history', 'export async function loadRecentComputerUseRunsExact', '/** Hook'],
    ['single run', 'export async function getComputerUseRunExact', undefined],
  ] as const) {
    const body = section(historySource, start, end);
    check(body.includes(".eq('circle_id', authority.circleId)"), `${label} filters the captured circle`);
    check(body.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"), `${label} uses only the captured bearer`);
    check(body.includes('computerUseHistoryAuthorityIsCurrent(authority, isCurrent)'), `${label} fences late results`);
    check(body.includes("'receipt_mismatch'"), `${label} rejects a mismatched row receipt`);
  }

  console.log(`\nPASS: ${assertions} private computer-task authority assertions`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
