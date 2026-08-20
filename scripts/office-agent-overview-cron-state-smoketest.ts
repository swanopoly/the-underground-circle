import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cronJobControlSnapshotMatches } from '../src/screens/circles/tabs/office/agentCronControlCore';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const overview = read('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const hitl = read('src/services/hitlService.ts');
const gateway = read('src/screens/circles/tabs/office/AgentGatewayPanels.tsx');
const hitlSchema = read('supabase/migrations/20260226_hitl.sql');
const hitlRls = read('supabase/migrations/20260325_security_warnings_fix.sql');
const between = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0 && endIndex > startIndex, `Expected source section ${start} -> ${end}`);
  return source.slice(startIndex, endIndex);
};
const cronStart = gateway.indexOf('export function CronJobsPanel(');
assert(cronStart >= 0, 'CronJobsPanel exists');
const cron = gateway.slice(cronStart);

for (const marker of [
  "status: 'loading' | 'ready' | 'error'",
  'controlReadGenerationRef',
  'controlMutationGenerationRef',
  'const loadControl = useCallback(async () => {',
  'disabled={controlBusy || !controlReady}',
  'Retry loading agent pause status',
  "setControlState({ status: 'ready', control: result.control, message: null })",
]) {
  assert(overview.includes(marker), `Overview wires ${marker}`);
}
assert(
  overview.includes("showToast('Diagnostic failed. Review bridge status and retry.', 'error');")
    && overview.includes("showToast(output || 'Diagnostic completed');\n        setDraft('');")
    && !overview.includes('showToast(error instanceof Error ? error.message'),
  'Overview retains a failed diagnostic draft and never exposes raw transport errors',
);
assert(
  overview.includes("accessibilityRole={toast.kind === 'error' ? 'alert' : undefined}")
    && overview.includes("accessibilityLiveRegion={toast.kind === 'error' ? 'assertive' : 'polite'}")
    && overview.includes('{toast.message}'),
  'Overview announces successful receipts politely while reserving alert semantics for failures',
);
assert(
  overview.includes('Circle memory {memorySync.label.toLowerCase()}'),
  'Overview labels its user-and-circle memory probe without implying agent-specific freshness',
);

const exactControlRead = between(hitl, 'export async function getAgentControlExact(', '/** Exact pause/settings mutation');
const exactControlWrite = between(hitl, 'export async function upsertAgentControlExact(', 'export async function requestApproval(');
for (const [label, source] of [
  ['read', exactControlRead],
  ['write', exactControlWrite],
] as const) {
  assert(
    source.includes('safeGetUserForAccessToken(authority.accessToken)')
      && source.includes('const exactClient = getSupabaseClientForAccessToken(authority.accessToken);')
      && source.includes("exactClient\n    .from('agent_controls')")
      && !source.includes('supabase\n    .from(')
      && !source.includes('.setHeader('),
    `Exact agent-control ${label} uses only bounded subject verification and the captured-token client`,
  );
}
for (const receiptCheck of [
  'row.circle_id !== authority.circleId',
  'row.session_key !== exactSessionKey',
  'row.agent_name !== exactAgentName',
  'row.is_paused !== updates.is_paused',
  'Number(row.spending_limit_daily) !== Number(updates.spending_limit_daily)',
  'row.require_approval_for.length !== updates.require_approval_for.length',
]) {
  assert(exactControlWrite.includes(receiptCheck), `Exact agent-control save receipt verifies ${receiptCheck}`);
}

const memorySyncHook = between(overview, 'function useMemorySyncStatus(', 'export default function AgentOverviewPanel(');
assert(
  memorySyncHook.includes('const exactClient = getSupabaseClientForAccessToken(accessToken);')
    && memorySyncHook.includes("exactClient\n          .from('memory_entries')")
    && !memorySyncHook.includes('supabase\n          .from(')
    && !memorySyncHook.includes('.setHeader(')
    && memorySyncHook.includes('const id = setInterval(tick, 120_000);')
    && (memorySyncHook.match(/isIdentityAuthorityCurrent\(identityAuthority\)/g) || []).length >= 2,
  'Overview memory sync uses the pinned client while retaining its two-minute cadence and pre/post-await authority fences',
);

assert(
  hitlSchema.includes('unique(circle_id, session_key)')
    && between(hitlRls, '-- ── agent_controls', '-- ── circle_memory').includes(
      'SELECT circle_id FROM circle_members WHERE user_id = auth.uid()',
    ),
  'Agent controls retain one exact circle/session row and membership-bound source RLS policies',
);

for (const marker of [
  'CONNECTION CRON JOBS',
  'CONNECTION-LEVEL JOBS',
  'const [loadError, setLoadError]',
  'const hasVerifiedConnection = verifiedScopeKey === cronScopeKey',
  "const hasVerifiedSnapshot = hasVerifiedConnection && cronCapability === 'supported'",
  '&& !!verifiedConnectionFingerprint',
  'matchesOpenSwanConnectionFingerprint(verifiedConnectionFingerprint, connection)',
  'Showing the last verified connection snapshot',
  'Retry loading connection cron jobs',
  'if (!result.supported)',
  'does not expose connection-level schedules',
  'accessibilityLabel="Schedule capability status"',
  "role: 'status'",
  "{['isolated', 'main'].map(target => (",
  'disabled={actionLoading !== null || mutationsUnavailable}',
]) {
  assert(cron.includes(marker), `Cron wires ${marker}`);
}
assert(!cron.includes("['isolated', 'main', 'current']"), 'ambiguous current-session scheduling is not offered');
const refreshStart = cron.indexOf('const refresh = useCallback(async () => {');
const refreshEnd = cron.indexOf('\n  useEffect(() => {', refreshStart);
const refresh = refreshStart >= 0 && refreshEnd > refreshStart ? cron.slice(refreshStart, refreshEnd) : '';
const unsupportedStart = refresh.indexOf('if (!result.supported) {');
const unsupportedEnd = refresh.indexOf('\n      setJobs(result.jobs || []);', unsupportedStart);
assert(
  unsupportedStart > 0
    && !refresh.slice(0, unsupportedStart).includes('setJobs([])')
    && refresh.slice(unsupportedStart, unsupportedEnd).includes('setJobs([])')
    && refresh.slice(unsupportedStart, unsupportedEnd).includes("setCronCapability('unsupported')"),
  'transient refresh failures retain verified jobs while an exact unsupported receipt clears them without claiming an empty inventory',
);
assert(
  cron.indexOf('if (!result.ok) {') < cron.indexOf('setJobs(result.jobs || []);')
    && cron.indexOf('if (!result.supported) {') < cron.indexOf('setJobs(result.jobs || []);'),
  'Cron publishes a replacement job list only after a verified supported response',
);
assert(
  cron.includes("cronCapability === 'unsupported' || !hasVerifiedSnapshot ? null : visibleJobs.length === 0 ? ("),
  'Cron never paints an unavailable or unsupported read as a verified empty schedule',
);
assert(
  cron.includes("typeof actionPatch.enabled === 'boolean'")
    && cron.includes("const nextState = actionPatch.enabled ? 'Enable' : 'Disable';")
    && cron.indexOf('await confirm(`${nextState} cron job') < cron.indexOf('await manageCronJob(preflightConfig, action, jobId, actionPatch)'),
  'both enabling and disabling a schedule require confirmation before the provider mutation',
);
assert(
  cron.includes('const expectedFingerprint = verifiedConnectionFingerprint;')
    && cron.includes('!matchesOpenSwanConnectionFingerprint(expectedFingerprint, config.connection)')
    && cron.indexOf('!matchesOpenSwanConnectionFingerprint(expectedFingerprint, config.connection)') < cron.indexOf('await manageCronJob(preflightConfig, action, jobId, actionPatch)')
    && cron.includes('confirmationGeneration !== refreshGeneration.current'),
  'Cron revalidates generation, scope, and exact runtime identity after confirmation and before provider I/O',
);
assert(
  cron.includes('const preflightInventory = await listCronJobs(config);')
    && cron.includes('cronJobControlSnapshotMatches(expectedJob, currentJobMatches[0])')
    && cron.indexOf('const preflightInventory = await listCronJobs(config);') < cron.indexOf('await manageCronJob(preflightConfig, action, jobId, actionPatch)'),
  'Cron rereads and compares the exact provider-controlled job before run, update, or remove',
);

const cronControlJob = {
  id: 'job-1',
  enabled: true,
  name: 'Daily report',
  schedule: '0 9 * * *',
  payload: 'Summarize the latest work',
  delivery: 'chat',
  sessionTarget: 'isolated',
  timezone: 'UTC',
};
assert(cronJobControlSnapshotMatches(cronControlJob, cronControlJob));
for (const changed of [
  { enabled: false },
  { name: 'Changed report' },
  { schedule: '0 18 * * *' },
  { payload: 'Run a different task' },
  { delivery: 'email' },
  { sessionTarget: 'main' },
  { timezone: 'America/New_York' },
]) {
  assert(!cronJobControlSnapshotMatches(cronControlJob, { ...cronControlJob, ...changed }));
}
assert(
  cron.includes('verifyCronJobPostcondition(inventory.jobs')
    && cron.includes('Cron postcondition verification failed.')
    && cron.includes('The cron action outcome is unknown. Refresh and inspect the exact job before retrying.')
    && cron.includes('No completion is claimed here.'),
  'Cron requires a fresh exact postcondition, locks unknown outcomes, and distinguishes run acceptance from completion',
);

console.log('office agent Overview and Cron state smoke passed');
