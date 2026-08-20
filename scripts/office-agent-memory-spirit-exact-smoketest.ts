import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const memory = read('src/screens/circles/tabs/office/AgentMemoryPanel.tsx');
const memoryMutationCore = read('src/screens/circles/tabs/office/agentMemoryMutationCore.ts');
const spirit = read('src/screens/circles/tabs/office/AgentSpiritPanel.tsx');
const identity = read('src/lib/agentIdentity.ts');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert(condition, message);
}

function sourceSection(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  check(startAt >= 0 && endAt > startAt, `source section exists: ${start}`);
  return source.slice(startAt, endAt);
}

for (const marker of [
  'identityAuthority: AgentMemoryPanelAuthority | null',
  'isIdentityAuthorityCurrent: AgentMemoryPanelAuthorityFence',
  'Number.isSafeInteger(generation)',
  'generation <= 0',
  'isIdentityAuthorityCurrent(authority)',
  'getSupabaseClientForAccessToken(authority.accessToken)',
  'if (result.error) throw result.error',
  'isExactMemoryLoadRequestCurrent(',
  'requireExactMemoryLaneRows(result.data, laneRequests[index].expected)',
  'requireExactSoulRows(data, {',
  'verifiedScopeKeyRef.current === capturedScopeKey',
  'Memory refresh failed. Showing the last verified snapshot',
  'REFRESHING THE LAST VERIFIED MEMORY SNAPSHOT',
  'Showing the newest 200 verified entries.',
  'Older server entries are not represented.',
  ".eq('circle_id', authority.circleId)",
  ".eq('user_id', authority.userId)",
  ".eq('updated_at', exactRequest.expectedUpdatedAt)",
  ".eq('visibility', exactRequest.visibility)",
  ".select('*')",
  'editingMemorySnapshotRef.current = { ...mem }',
  "setMemoryActionStatus(`CONFLICT: ${conflictMessage}`)",
  "setMemoryActionStatus('OUTCOME UNKNOWN:",
  'INSPECT IDENTITY DETAILS',
]) {
  check(memory.includes(marker), `Memory exact architecture includes ${marker}`);
}
for (const marker of [
  'createAgentMemoryCasRequest(',
  'executeAgentMemoryCasMutation(',
  "if (result.data.length === 0) return { kind: 'conflict'",
  "if (result.data.length !== 1) return { kind: 'outcome_unknown'",
  'Object.entries(request.patch).every',
  "visibility: 'private'",
]) {
  check(memoryMutationCore.includes(marker), `Memory CAS core includes ${marker}`);
}
check(!memory.includes("import('../../../../lib/agentMemory')"), 'Memory does not use ambient management helpers');
check(!memory.includes("import('../../../../lib/memoryActions')"), 'Memory pin and promote do not use ambient helpers');
check(!memory.includes("import('../../../../lib/memoryService')"), 'Memory does not use ambient manual-write helpers');
check(!memory.includes('<ScrollView'), 'Memory leaves vertical scrolling to the Agent panel shell');
check(memory.includes('onOpenInChat(request.slice(0, 3_500))'), 'manual writes are truthfully handed to a bounded Chat draft');
check(memory.includes('Show me the exact memory receipt before claiming it is saved.'), 'reasoning-standard handoff preserves receipt truth');
check(memory.indexOf('INSPECT IDENTITY DETAILS') < memory.indexOf('CANONICAL SUBJECT'), 'raw subject ids stay behind disclosure');
check(memory.includes('visibleMemories.length'), 'Memory counts only the scope-matched verified snapshot');
check(memory.includes('visibleSoulLabel || visibleSoulKey'), 'Memory exposes Soul copy only from the scope-matched verified snapshot');
check(!memory.includes('.flatMap(result => result.data || [])'), 'Memory never converts null lane data into verified emptiness');
check(!memory.includes(".eq('name', agentName.trim())"), 'Memory never attaches a published Soul projection by mutable display name');

const memoryLoadSource = sourceSection(
  memory,
  'const load = useCallback(async () => {',
  'useEffect(() => {\n    void load();',
);
const memoryMutationSource = sourceSection(
  memory,
  'const mutateMemoryExact = async (',
  'const publishSuccessfulMemoryReceipt =',
);
check(
  (memoryLoadSource.match(/const exactClient = getSupabaseClientForAccessToken\(authority\.accessToken\);/g) || []).length === 1
    && (memoryLoadSource.match(/exactClient\s*\n\s*\.from\(/g) || []).length >= 6
    && !memoryLoadSource.includes('.setHeader(')
    && !memoryLoadSource.includes('supabase.from'),
  'Memory snapshot lanes and published-agent read share one pinned captured-bearer client per exact load',
);
check(
  (memoryMutationSource.match(/const exactClient = getSupabaseClientForAccessToken\(authority\.accessToken\);/g) || []).length === 1
    && memoryMutationSource.includes("const result = await exactClient\n          .from('memory_entries')")
    && !memoryMutationSource.includes('.setHeader(')
    && !memoryMutationSource.includes('supabase.from'),
  'Memory CAS mutation uses one pinned captured-bearer client without shared-auth header mutation',
);
check(
  memory.includes("import { getSupabaseClientForAccessToken } from '../../../../lib/supabase';")
    && !memory.includes("import { supabase } from '../../../../lib/supabase';")
    && !memory.includes('.setHeader(')
    && !memory.includes('supabase.from'),
  'Memory has no shared Supabase exact query or per-query Authorization mutation path',
);

const memoryTruthSource = [
  sourceSection(memory, 'function getMemoryTimestamp', 'function getRelevantSouls'),
  sourceSection(memory, 'function requireExactMemoryLaneRows', 'function requireExactSoulRows'),
  sourceSection(memory, 'function requireExactSoulRows', 'function isExactMemoryLoadRequestCurrent'),
  sourceSection(memory, 'function isExactMemoryLoadRequestCurrent', 'export default function AgentMemoryPanel'),
].join('\n');
const truthSandbox: Record<string, unknown> = {};
vm.runInNewContext(
  ts.transpileModule(
    `${memoryTruthSource}\n;(globalThis as any).__truth = { requireExactMemoryLaneRows, requireExactSoulRows, isExactMemoryLoadRequestCurrent };`,
    { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  truthSandbox,
);
const truth = truthSandbox.__truth as {
  requireExactMemoryLaneRows: (data: unknown, expected: Record<string, unknown>) => unknown[];
  requireExactSoulRows: (data: unknown, expected: Record<string, unknown>) => unknown[];
  isExactMemoryLoadRequestCurrent: (
    currentGeneration: number,
    currentScopeKey: string,
    requestGeneration: number,
    capturedScopeKey: string,
  ) => boolean;
};
const laneExpectation = {
  circleId: 'circle-a',
  scope: 'agent',
  visibility: 'private',
  userId: 'user-a',
  agentIds: new Set(['agent-a']),
};
const validMemoryRow = {
  id: 'memory-a',
  circle_id: 'circle-a',
  user_id: 'user-a',
  agent_id: 'agent-a',
  scope: 'agent',
  visibility: 'private',
  is_active: true,
  updated_at: '2026-08-17T12:00:00.000Z',
};
check(truth.requireExactMemoryLaneRows([validMemoryRow], laneExpectation).length === 1, 'Memory accepts one exact lane row');
assert.throws(() => truth.requireExactMemoryLaneRows(null, laneExpectation));
assertions += 1;
assert.throws(() => truth.requireExactMemoryLaneRows([{ ...validMemoryRow, circle_id: 'circle-b' }], laneExpectation));
assertions += 1;
assert.throws(() => truth.requireExactSoulRows([{
  id: '10000000-0000-4000-8000-000000000001',
  circle_id: 'circle-a',
  owner_id: 'user-a',
  name: 'Shared display name',
  spirit: 'builder',
}], {
  circleId: 'circle-a',
  userId: 'user-a',
  allowedIds: new Set(),
}));
assertions += 1;
check(
  memory.includes('if (publishedAgentIds.length > 0)')
    && !memory.includes('if (!soulRow && agentName.trim())'),
  'one same-owner published row with the same name cannot attach to a live session without an exact UUID',
);
check(!truth.isExactMemoryLoadRequestCurrent(2, 'scope-a', 1, 'scope-a'), 'an older same-scope response is stale');
check(truth.isExactMemoryLoadRequestCurrent(2, 'scope-a', 2, 'scope-a'), 'the newest same-scope response remains current');
check(!truth.isExactMemoryLoadRequestCurrent(2, 'scope-b', 2, 'scope-a'), 'a matching generation cannot cross scopes');
check(truth.requireExactSoulRows([], { circleId: 'circle-a', userId: 'user-a' }).length === 0, 'a validated empty Soul response stays distinct from failure');
assert.throws(() => truth.requireExactSoulRows(null, { circleId: 'circle-a', userId: 'user-a' }));
assertions += 1;

for (const marker of [
  'identityAuthority: AgentSpiritPanelAuthority | null',
  'isIdentityAuthorityCurrent: AgentSpiritPanelAuthorityFence',
  'Number.isSafeInteger(generation)',
  'exactIdentityAuthority.generation',
  'isIdentityAuthorityCurrent(current)',
  'syncAgentIdentitiesFromServerExact(authority, {',
  'fence: isIdentityAuthorityCurrent,',
  'signal: snapshotController.signal,',
  'const SPIRIT_SNAPSHOT_TIMEOUT_MS = 8_000;',
  'snapshotController.abort();',
  "useState<'loading' | 'ready' | 'error'>('loading')",
  'Retry loading verified Spirit identity',
  'No assignment or risk posture is being inferred from an empty response.',
  'updatePublishedAgentSpiritExact({',
  'updatePublishedAgentSpiritExact',
  'deleteUnreferencedCustomAgentProfileExact(',
  'receipt.serverSaved',
  'receipt.localSaved',
  'receipt.serverDeleted',
  "receipt.error === 'outcome_unknown'",
  "receipt.error === 'profile_referenced'",
  ".select('id, circle_id, owner_id, spirit, spirit_emoji')",
  'spiritAssignmentBusyRef.current',
  'Saving verified Spirit assignment…',
  'ERROR: Spirit assignment was not saved. Check the connection and try again.',
  'WARNING: Spirit was saved on the server, but this view could not refresh. Reload the Spirit panel.',
  'Refresh this Spirit before retrying.',
  'deletion could not be verified. Refresh profiles before retrying.',
  'CONTINUE IN CHAT',
  "onOpenInChat([",
  'ERROR: Soul was not saved. Check the connection and try again.',
  'ERROR: Custom profile was not saved. Check the connection and try again.',
  'const expectedProfileReceipt = {',
  '.insert(expectedProfileReceipt)',
  'if (!Array.isArray(insertedProfiles) || insertedProfiles.length !== 1)',
  'if (savingProfileTokenRef.current === savingToken)',
  'Object.entries(expectedProfileReceipt).every(([field, requestedValue])',
  'returnedProfile[field] === requestedValue',
  'Custom profile outcome could not be verified. No profile was adopted; refresh profiles before retrying.',
  'Choose a new name; the existing profile was not changed.',
  "String(data.user_id || '') !== authority.userId",
  "String(data.name || '') !== requestedProfileName",
  'returnedProfileId !== returnedProfileId.toLowerCase()',
  "accessibilityLabel=\"Cancel saving custom Spirit profile\"",
  'accessibilityLabel="Save custom Spirit profile"',
]) {
  check(spirit.includes(marker), `Spirit exact architecture includes ${marker}`);
}
check(!spirit.includes("import('../../../../lib/memoryService')"), 'Spirit artifacts never use an ambient memory writer');
const spiritSnapshotSource = sourceSection(
  spirit,
  'useEffect(() => {\n    const authority = exactIdentityAuthority;\n    const capturedRequestKey = identityRequestKey;',
  'useEffect(() => {\n    const capturedRequestKey = identityRequestKey;',
);
const identitySnapshotSource = sourceSection(
  identity,
  'async function fetchAgentIdentitiesServerSnapshotExact',
  'export async function syncAgentIdentitiesFromServerExact',
);
check(
  (spirit.match(/\.abortSignal\(snapshotController\.signal\)/g) || []).length >= 3
    && spirit.includes('clearTimeout(snapshotDeadline);'),
  'Spirit gives its exact identity, published row, profile, and fallback reads one bounded abort lifecycle',
);
check(
  spiritSnapshotSource.includes('const snapshotClient = getSupabaseClientForAccessToken(authority.accessToken);')
    && (spiritSnapshotSource.match(/await snapshotClient/g) || []).length >= 3
    && !spiritSnapshotSource.includes('.setHeader(')
    && !spiritSnapshotSource.includes('await supabase'),
  'Spirit snapshot uses one pinned-token client and never reacquires shared mutable auth',
);
check(
  identity.includes("import { safeGetUserForAccessToken } from './authSession';")
    && identity.includes('safeGetUserForAccessToken(authority.accessToken)')
    && !identity.includes('supabase.auth.getUser(authority.accessToken)'),
  'exact identity verification uses the bounded explicit-token auth path and never waits on mutable session auth',
);
check(
  identitySnapshotSource.includes('getSupabaseClientForAccessToken(authority.accessToken)')
    && identitySnapshotSource.includes('let query = exactClient')
    && !identitySnapshotSource.includes('.setHeader(')
    && !identitySnapshotSource.includes('supabase.from'),
  'exact identity snapshot dispatches through the pinned-token PostgREST client',
);
check(!spirit.includes('.ilike('), 'Spirit never aliases a live session to a public row by mutable display name');
check(
  spirit.includes('(customProfiles.length > 0 || Boolean(profileActionStatus)) && ('),
  'an empty custom-profile status cannot become a raw text child of a React Native View',
);
check(!spirit.includes('updateAgentSpirit('), 'Spirit never accepts a zero-row public assignment helper as success');
check(!spirit.includes(".from('custom_agent_profiles')\n        .delete()"), 'Spirit profile deletion cannot bypass the guarded RPC');
check(!spirit.includes(".from('custom_agent_profiles').upsert("), 'Spirit Save As cannot overwrite an existing custom profile');
check(!spirit.includes('window.alert(`Failed to save profile: ${error.message}`)'), 'Spirit never exposes raw profile persistence errors to the user');
check(
  spirit.indexOf('deleteUnreferencedCustomAgentProfileExact(') < spirit.indexOf('setCustomProfiles(prev => prev.filter'),
  'Spirit removes local profile state only after the exact guarded delete receipt',
);
check(
  spirit.indexOf("receipt.error === 'outcome_unknown'") < spirit.indexOf('setCustomProfiles(prev => prev.filter'),
  'Spirit retains local profile state and requires refresh before retry when deletion outcome is unknown',
);
check(
  spirit.indexOf("receipt.error === 'profile_referenced'") < spirit.indexOf('setCustomProfiles(prev => prev.filter'),
  'Spirit keeps referenced profiles and tells the user to clear every assignment first',
);

console.log(`office agent Memory and Spirit exact smoke passed (${assertions} assertions)`);
