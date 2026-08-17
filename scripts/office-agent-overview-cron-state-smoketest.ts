import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const overview = read('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const gateway = read('src/screens/circles/tabs/office/AgentGatewayPanels.tsx');
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
  overview.includes("showToast('Diagnostic failed. Review bridge status and retry.');")
    && overview.includes("showToast(output || 'Diagnostic completed');\n        setDraft('');")
    && !overview.includes('showToast(error instanceof Error ? error.message'),
  'Overview retains a failed diagnostic draft and never exposes raw transport errors',
);
assert(
  overview.includes('Circle memory {memorySync.label.toLowerCase()}'),
  'Overview labels its user-and-circle memory probe without implying agent-specific freshness',
);

for (const marker of [
  'CONNECTION CRON JOBS',
  'CONNECTION-LEVEL JOBS',
  'const [loadError, setLoadError]',
  'const hasVerifiedSnapshot = verifiedScopeKey === cronScopeKey',
  '&& !!verifiedConnectionFingerprint',
  'matchesOpenSwanConnectionFingerprint(verifiedConnectionFingerprint, connection)',
  'Showing the last verified connection snapshot',
  'Retry loading connection cron jobs',
  'if (!result.supported)',
  'does not expose the cron tool',
  "{['isolated', 'main'].map(target => (",
  'disabled={actionLoading !== null || mutationsUnavailable}',
]) {
  assert(cron.includes(marker), `Cron wires ${marker}`);
}
assert(!cron.includes("['isolated', 'main', 'current']"), 'ambiguous current-session scheduling is not offered');
const refreshStart = cron.indexOf('const refresh = useCallback(async () => {');
const refreshEnd = cron.indexOf('\n  useEffect(() => {', refreshStart);
const refresh = refreshStart >= 0 && refreshEnd > refreshStart ? cron.slice(refreshStart, refreshEnd) : '';
assert(!refresh.includes('setJobs([])'), 'a transient same-scope Cron refresh failure never erases the last verified jobs');
assert(
  cron.indexOf('if (!result.ok) {') < cron.indexOf('setJobs(result.jobs || []);')
    && cron.indexOf('if (!result.supported) {') < cron.indexOf('setJobs(result.jobs || []);'),
  'Cron publishes a replacement job list only after a verified supported response',
);
assert(
  cron.includes(') : !hasVerifiedSnapshot ? null : visibleJobs.length === 0 ? ('),
  'Cron never paints an unavailable initial read as a verified empty schedule',
);
assert(
  cron.includes("typeof patch.enabled === 'boolean'")
    && cron.includes("const nextState = patch.enabled ? 'Enable' : 'Disable';")
    && cron.indexOf('await confirm(`${nextState} cron job') < cron.indexOf('await manageCronJob(config, action, jobId, patch)'),
  'both enabling and disabling a schedule require confirmation before the provider mutation',
);
assert(
  cron.includes('const expectedFingerprint = verifiedConnectionFingerprint;')
    && cron.includes('!matchesOpenSwanConnectionFingerprint(expectedFingerprint, config.connection)')
    && cron.indexOf('!matchesOpenSwanConnectionFingerprint(expectedFingerprint, config.connection)') < cron.indexOf('await manageCronJob(config, action, jobId, patch)')
    && cron.includes('confirmationGeneration !== refreshGeneration.current'),
  'Cron revalidates generation, scope, and exact runtime identity after confirmation and before provider I/O',
);
assert(
  cron.includes('verifyCronJobPostcondition(inventory.jobs')
    && cron.includes('Cron postcondition verification failed.')
    && cron.includes('The cron action outcome is unknown. Refresh and inspect the exact job before retrying.')
    && cron.includes('No completion is claimed here.'),
  'Cron requires a fresh exact postcondition, locks unknown outcomes, and distinguishes run acceptance from completion',
);

console.log('office agent Overview and Cron state smoke passed');
