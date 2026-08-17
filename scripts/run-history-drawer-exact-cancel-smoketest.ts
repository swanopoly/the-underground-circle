/**
 * Focused behavioral/source smoke for Run History safety.
 *
 * - Opening/hydrating the drawer is presentation-only.
 * - Explicit stale cancellation is a confirmed, exact-authority compare/set
 *   whose zero-row response is false and reconciled without replay.
 * - Authority-generation swaps retire an open confirmation.
 * - Specialist child details stay rendered beneath their visible parent.
 *
 * Run: npx tsx scripts/run-history-drawer-exact-cancel-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aggregateRunHistoryRealtimeState,
  classifyRunHistoryRealtimeStatus,
  classifyStaleRunCancelReceipt,
  isExactRunMutationAuthorityCurrent,
} from '../src/lib/runHistoryFilterCore';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const drawer = read('src/components/chat/RunHistoryDrawer.tsx');
const system = read('src/lib/agentRunSystem.ts');
const authHook = read('src/hooks/useAuth.ts');
const chat = read('src/screens/circles/tabs/ChatTab.tsx');
const office = read('src/screens/circles/tabs/OfficeTab.tsx');
const rooms = read('src/screens/circles/tabs/RoomsTab.tsx');
const agentRuns = read('src/screens/circles/tabs/office/AgentRunsPanel.tsx');

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

let checks = 0;
function check(value: unknown, label: string): void {
  assert.ok(value, label);
  checks += 1;
}

const expected = {
  runId: 'run-1',
  circleId: 'circle-1',
  userId: 'user-1',
  cancelledAt: '2026-08-17T16:20:30.000Z',
} as const;
const exactReceiptRow = {
  id: expected.runId,
  circle_id: expected.circleId,
  user_id: expected.userId,
  status: 'cancelled',
  updated_at: expected.cancelledAt,
  completed_at: expected.cancelledAt,
};

assert.deepEqual(
  classifyStaleRunCancelReceipt([], expected),
  { ok: false, reason: 'no_match' },
  'zero-row compare/set must be false',
);
assert.equal(classifyStaleRunCancelReceipt([exactReceiptRow], null).ok, false);
assert.equal(classifyStaleRunCancelReceipt([exactReceiptRow], expected).ok, true);
assert.equal(classifyStaleRunCancelReceipt([{
  ...exactReceiptRow,
  updated_at: '2026-08-17T16:20:30.000+00:00',
  completed_at: '2026-08-17T16:20:30.000+00:00',
}], expected).ok, true, 'equivalent Postgres +00:00 timestamps prove the same instant');
assert.deepEqual(
  classifyStaleRunCancelReceipt([exactReceiptRow, exactReceiptRow], expected),
  { ok: false, reason: 'invalid_response' },
);
assert.equal(classifyStaleRunCancelReceipt([{ ...exactReceiptRow, status: 'running' }], expected).ok, false);
check(true, 'exact cancellation receipts require one matching cancelled row and accept equivalent timestamp encodings');

const capturedAuthority = {
  userId: 'user-1',
  circleId: 'circle-1',
  accessToken: 'token-1',
  generation: 7,
};
assert.equal(isExactRunMutationAuthorityCurrent(capturedAuthority, { ...capturedAuthority }), true);
assert.equal(isExactRunMutationAuthorityCurrent(capturedAuthority, { ...capturedAuthority, generation: 8 }), false);
assert.equal(isExactRunMutationAuthorityCurrent(capturedAuthority, { ...capturedAuthority, accessToken: 'token-2' }), false);
assert.equal(isExactRunMutationAuthorityCurrent(capturedAuthority, null), false);
assert.equal(isExactRunMutationAuthorityCurrent({ ...capturedAuthority, userId: '' }, { ...capturedAuthority, userId: '' }), false);
check(true, 'generation/token retirement makes a captured cancellation authority non-current');

assert.equal(classifyRunHistoryRealtimeStatus('SUBSCRIBED'), 'live');
for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'unexpected', null]) {
  assert.equal(
    classifyRunHistoryRealtimeStatus(status),
    'unavailable',
    `${String(status)} must never imply a live snapshot`,
  );
}
assert.equal(aggregateRunHistoryRealtimeState('connecting', 'connecting'), 'connecting');
assert.equal(aggregateRunHistoryRealtimeState('live', 'connecting'), 'connecting');
assert.equal(aggregateRunHistoryRealtimeState('live', 'live'), 'live');
assert.equal(aggregateRunHistoryRealtimeState('live', 'unavailable'), 'unavailable');
check(true, 'both exact channels must be subscribed; any loss makes the snapshot unavailable');

const drawerHydration = section(
  drawer,
  'useEffect(() => {\n    if (!visible) return;\n    let cancelled = false;',
  'useEffect(() => {\n    if (!visible || !selectedRunId || !exactAuthority',
);
check(
  drawerHydration.includes('listChatSessionRuns')
    && drawerHydration.includes('listRuns')
    && !drawerHydration.includes('reapRun(')
    && !drawerHydration.includes('cancelStaleRunExact(')
    && !drawerHydration.includes(".update("),
  'ordinary drawer hydration is read-only and cannot reap/cancel/update a run',
);
check(
  drawerHydration.includes('strict: true as const')
    && drawerHydration.includes('listChatSessionRuns(')
    && drawerHydration.includes('listRuns(')
    && drawerHydration.includes('getRun(requestedInitialRunId, strictReadOptions)')
    && drawerHydration.includes('!isLiveExactAuthorityCurrent(capturedAuthority)')
    && drawer.includes('const verifiedRuns = hasVerifiedReadSnapshot ? runs : []'),
  'list, direct-focus, and rendering are bound to one live exact authority generation',
);
const exactGetRun = section(system, 'export async function getRun(', 'export async function listRuns(');
const exactListRuns = section(system, 'export async function listRuns(', 'export async function listRunsForAgentSubject(');
const exactChatRuns = section(system, 'export async function listChatSessionRuns(', 'export interface GetActiveRunsOptions');
const exactArtifacts = section(system, 'export async function getRunArtifacts(', '/** One bounded page-hydration query');
const strictAuthorityResolver = section(
  system,
  'async function resolveAgentRunStrictReadAuthority(',
  '\nexport interface AgentRun {',
);
check(
  strictAuthorityResolver.includes(".from('circle_members')")
    && strictAuthorityResolver.includes(".eq('circle_id', authority.circleId)")
    && strictAuthorityResolver.includes(".eq('user_id', authority.userId)")
    && strictAuthorityResolver.includes('.maybeSingle()')
    && strictAuthorityResolver.includes("throw new AgentRunExactReadError('membership_denied')")
    && strictAuthorityResolver.includes('assertAgentRunExactAuthorityCurrent(authority, options.isAuthorityCurrent)'),
  'strict reads prove exact circle membership so RLS-empty cannot pose as verified-empty history',
);
for (const [label, reader] of [
  ['direct run', exactGetRun],
  ['run list', exactListRuns],
  ['chat-session run list', exactChatRuns],
  ['artifact list', exactArtifacts],
] as const) {
  check(
    reader.includes('readOptions?: AgentRunStrictReadOptions')
      && reader.includes('getSupabaseClientForAccessToken(authority.accessToken)')
      && reader.includes('assertAgentRunExactAuthorityCurrent(authority, readOptions!.isAuthorityCurrent)'),
    `${label} reader pins the captured bearer and fences its response`,
  );
}
const exactSubscriptions = section(system, 'export function subscribeToRun(', '/**\n * Subscribe to INSERT/UPDATE on agent_runs');
check(
  exactSubscriptions.includes('readOptions?: AgentRunStrictReadOptions')
    && exactSubscriptions.includes('getSupabaseClientForAccessToken(authority.accessToken)')
    && exactSubscriptions.includes('!isAgentRunExactAuthorityCurrent(authority, readOptions!.isAuthorityCurrent)')
    && exactSubscriptions.includes("String(row.circle_id || '') !== authority.circleId"),
  'run and step subscriptions ignore retired or cross-circle realtime payloads',
);
check(
  (exactSubscriptions.match(/\.subscribe\(\(status\) =>/g) || []).length === 2
    && (exactSubscriptions.match(/classifyRunHistoryRealtimeStatus\(status\)/g) || []).length === 2,
  'both exact channels publish fail-closed lifecycle status instead of silently degrading',
);
const drawerSubscriptions = section(
  drawer,
  'useEffect(() => {\n    if (!visible || !selectedRunId || !exactAuthority || !hasVerifiedReadSnapshot) {\n      setRealtimeReceipt(null);',
  'const parentRun = useMemo(',
);
check(
  drawerSubscriptions.includes('selectedRunRef.current?.id === capturedRunId')
    && drawerSubscriptions.includes('!disposed')
    && drawerSubscriptions.includes('openGenerationRef.current === capturedOpenGeneration')
    && drawerSubscriptions.includes('subscribeToRun(capturedRunId')
    && drawerSubscriptions.includes('subscribeToRunSteps(capturedRunId')
    && (drawerSubscriptions.match(/strictReadOptions, \(state\) => publishLifecycle/g) || []).length === 2,
  'late realtime callbacks cannot attach an old run or step update to a newly selected run or unmounted drawer',
);
check(
  drawerSubscriptions.includes("run: 'connecting'")
    && drawerSubscriptions.includes("steps: 'connecting'")
    && drawerSubscriptions.includes('aggregateRunHistoryRealtimeState(channelStates.run, channelStates.steps)')
    && drawerSubscriptions.includes("publishLifecycle('run', 'unavailable')"),
  'the drawer reports live only after both channels subscribe and reports setup failure as unavailable',
);
check(
  drawer.includes('Live updates unavailable. This verified snapshot may be stale.')
    && drawer.includes('Refresh the verified run snapshot and reconnect live updates')
    && drawer.includes('handleExactRefreshAndReconnect')
    && drawer.includes('exactRefreshRequestRef.current = {')
    && drawer.includes('isLiveExactAuthorityCurrent(capturedAuthority)')
    && drawer.includes('exactRefreshTick,')
    && drawer.includes("accessibilityRole=\"alert\"")
    && drawer.includes("accessibilityRole=\"button\""),
  'channel loss is accessible, marks the snapshot stale, and offers a manually fenced exact refresh/reconnect',
);
const detailHydration = section(
  drawer,
  'useEffect(() => {\n    if (!visible || !selectedRunId || !exactAuthority || !hasVerifiedReadSnapshot)',
  'useEffect(() => {\n    if (!visible || !selectedRunId || !exactAuthority || !hasVerifiedReadSnapshot) {\n      setRealtimeReceipt(null);',
);
check(
  detailHydration.includes('getRunSteps(selectedRunId, strictReadOptions)')
    && detailHydration.includes('getRunArtifacts(selectedRunId, strictReadOptions)')
    && detailHydration.includes('listChildRuns(selectedRunId, 20, strictReadOptions)')
    && detailHydration.includes('!isLiveExactAuthorityCurrent(capturedAuthority)'),
  'steps, artifacts, and child runs cannot adopt a retired authority response',
);
check(
  drawer.includes('Loading verified specialist runs…')
    && drawer.includes('Specialist runs could not be verified for this signed-in scope.')
    && drawer.includes('No delegated specialists.'),
  'specialist proof distinguishes loading/error from a verified empty child-run list',
);
check(
  office.includes('isOfficeAgentOwnedByCurrentUser')
    && office.includes('ownedDurableAgentIds.add(`db::${durableAgent.id}`)')
    && office.includes('ownedConnectionIds.add(connection.id)')
    && office.includes('connectionAuthority.accessToken === authority.accessToken')
    && office.includes('connectionAuthority.generation === authority.generation')
    && office.includes('connectionsAuthorityRef.current = connectionAuthority')
    && !office.includes('c.name === a.name'),
  'Office Mine ownership uses provenance-stamped exact DB/connection ids and has no name join',
);
check(
  !drawer.includes("import { planRunReap")
    && !drawer.includes('reapedRunIdsRef')
    && !drawer.includes('updateRunStatus(')
    && !drawer.includes('promoteMemory(')
    && !drawer.includes('pinMemory(')
    && !drawer.includes('decayMemoryImportance(')
    && !drawer.includes('softDeleteMemory(')
    && !drawer.includes('recordMemoryFeedback(')
    && !drawer.includes('applyOpenSwanMemoryRecommendation('),
  'the presentation drawer has no view-triggered reaper or ambient run/memory writer',
);
check(
  drawer.includes('Run History preserves memory evidence as read-only proof.')
    && drawer.includes('Recommendations are evidence only here.')
    && !drawer.includes('>PROMOTE<')
    && !drawer.includes('>PIN<')
    && !drawer.includes('>FORGET<')
    && !drawer.includes('>NOT HELPFUL<')
    && !drawer.includes('>DISMISS<'),
  'memory and recommendation sections remain truthful read-only proof',
);
check(
  drawer.includes('authority: AgentRunExactReadAuthority;')
    && drawer.includes('!isSameRunReadAuthority(')
    && drawer.includes('authority: capturedAuthority,'),
  'deep-link application receipts include the exact bearer, not only user/circle/generation labels',
);

const exactCancel = section(
  system,
  'export async function cancelStaleRunExact(',
  '// Honest STOP:',
);
for (const predicate of [
  ".eq('id', runId)",
  ".eq('circle_id', circleId)",
  ".eq('user_id', authority.userId)",
  ".eq('status', input.expectedStatus)",
  ".eq('updated_at', expectedUpdatedAt)",
]) {
  check(exactCancel.includes(predicate), `exact cancel includes ${predicate}`);
}
check(
  exactCancel.includes('getSupabaseClientForAccessToken(authority.accessToken)')
    && exactCancel.includes("const { data, error } = await exactClient")
    && exactCancel.includes("const { data: current, error: reconcileError } = await exactClient")
    && exactCancel.includes(".select('*')")
    && exactCancel.includes('classifyStaleRunCancelReceipt(data')
    && exactCancel.includes("receipt.reason !== 'no_match'")
    && exactCancel.includes('const { data: current, error: reconcileError }')
    && !exactCancel.includes('cancelStaleRunExact({'),
  'cancel binds a client to the captured bearer, requires an exact receipt, and reconciles zero rows without replay',
);

const cancelHandler = section(drawer, 'const handleCloseStaleRun = async () => {', '  return (\n    <Modal');
const confirmIndex = cancelHandler.indexOf('const confirmed = await showConfirm');
const postConfirmFenceIndex = cancelHandler.indexOf('isLiveExactAuthorityCurrent(capturedAuthority)', confirmIndex);
const mutationIndex = cancelHandler.indexOf('await cancelStaleRunExact', postConfirmFenceIndex);
check(
  confirmIndex >= 0 && postConfirmFenceIndex > confirmIndex && mutationIndex > postConfirmFenceIndex,
  'drawer revalidates captured authority through the newest live fence after async confirmation and before mutation',
);
check(
  drawer.includes('suppliedExactAuthorityFenceRef.current = isExactAuthorityCurrent')
    && drawer.includes('suppliedExactAuthorityFenceRef.current(authority)'),
  'in-flight confirmations cannot keep using an authority fence from an older render',
);
check(
  cancelHandler.includes('currentRun?.status !== capturedRun.status')
    && cancelHandler.includes('currentRun?.updated_at !== expectedUpdatedAt')
    && cancelHandler.includes('!currentPresentation.stale')
    && cancelHandler.includes('!liveDrawerScopeRef.current.visible')
    && cancelHandler.includes('result.currentRun && responseAuthorityCurrent')
    && cancelHandler.includes('setStaleRunCancelError('),
  'drawer rechecks exact stale row state and keeps conflicts visibly reconciled',
);

check(
  authHook.includes('generationRef.current += 1')
    && authHook.includes('authorityRef.current = null')
    && authHook.includes('const liveScope = liveScopeRef.current')
    && authHook.includes('isExactRunMutationAuthorityCurrent(authority, current)'),
  'shared Chat/Room authority hook reads live render scope and retires captured generations on cleanup',
);
check(
  chat.includes('exactAuthority={runHistoryExactAuthority}')
    && chat.includes('isExactAuthorityCurrent={isRunHistoryExactAuthorityCurrent}')
    && office.includes('exactAuthority={committedAuthAuthority}')
    && office.includes('isExactAuthorityCurrent={isOfficeAuthorityCurrent}')
    && rooms.includes('exactAuthority={runHistoryExactAuthority}')
    && rooms.includes('isExactAuthorityCurrent={isRunHistoryExactAuthorityCurrent}'),
  'Chat, Office, and Room drawer call sites all provide captured exact authority plus a live fence',
);

const childHandler = section(
  agentRuns,
  'accessibilityLabel={`View specialist run details:',
  'style={{',
);
check(
  agentRuns.includes('runDetails.rootRunId === run.id')
    && agentRuns.includes('VIEWING SPECIALIST RUN')
    && childHandler.includes('rootRunId: run.id')
    && childHandler.includes('selectedRun: childRun')
    && !childHandler.includes('setExpandedRun(childRun.id)'),
  'specialist navigation stays anchored under the visible parent and renders exact child detail',
);

console.log(`run-history drawer exact-cancel smoke passed (${checks} checks)`);
