import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAgentRuntimeSubject } from '../src/lib/agentRuntimeSubject';
import { runMatchesAgent } from '../src/lib/agentRunSubjectSummary';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const system = read('src/lib/agentRunSystem.ts');
const panel = read('src/screens/circles/tabs/office/AgentRunsPanel.tsx');
const panelRouter = read('src/screens/circles/tabs/office/AgentPanel.tsx');

const section = (source: string, start: string, end: string): string => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Could not isolate ${start}`);
  return source.slice(startIndex, endIndex);
};

let assertions = 0;
const check = (condition: unknown, message: string): void => {
  assertions += 1;
  assert.ok(condition, message);
};

const subjectRunsReader = section(
  system,
  'async function scanRunsForAgentSubject(',
  'export async function listChildRuns(',
);
const childRunsReader = section(
  system,
  'export async function listChildRuns(',
  'export async function listChatSessionRuns(',
);
const stepsReader = section(
  system,
  'export async function getRunSteps(',
  'export async function getRunArtifacts(',
);
const runsRoute = section(
  panelRouter,
  '{/* ── RUNS TAB',
  '{/* ── CRON JOBS TAB',
);

check(
  system.includes("import { safeGetUserForAccessToken } from './authSession'")
    && system.includes('export type AgentRunStrictReadOptions')
    && system.includes('export type AgentRunExactReadAuthority = OfficeConnectionExactAuthority')
    && system.includes('Number.isSafeInteger(generation)')
    && system.includes('safeGetUserForAccessToken(authority.accessToken)'),
  'strict run readers verify one captured positive-generation bearer authority',
);
check(
  system.includes('export type AgentRunSubjectListResult')
    && system.includes('complete: boolean')
    && subjectRunsReader.includes('scannedRows += data.length')
    && subjectRunsReader.includes('Math.max(scanPageSize, opts.maxScanRows || 1000)')
    && subjectRunsReader.includes('5_000')
    && subjectRunsReader.includes('complete = true')
    && subjectRunsReader.includes('export async function listRunsForAgentSubjectPage('),
  'bounded subject scans expose whether the exact candidate history was exhausted',
);
check(
  system.includes("throw new AgentRunExactReadError('authority_retired')")
    && system.includes("throw new AgentRunExactReadError('scope_mismatch')")
    && system.includes("throw new AgentRunExactReadError('authority_mismatch')"),
  'strict authority resolution fails closed for retired, mismatched, and cross-circle authority',
);
for (const [name, reader] of [
  ['subject run list', subjectRunsReader],
  ['child run list', childRunsReader],
  ['run steps', stepsReader],
] as const) {
  check(
    reader.includes('readOptions?: AgentRunStrictReadOptions'),
    `${name} keeps a backward-compatible optional strict read argument`,
  );
  check(
    reader.includes(".setHeader('Authorization', `Bearer ${authority.accessToken}`)"),
    `${name} binds its query to the captured bearer`,
  );
  check(
    reader.includes("if (strictRead) throw new AgentRunExactReadError(error ? 'backend_error' : 'invalid_response')"),
    `${name} reports backend and invalid-response failures instead of returning false empty data in strict mode`,
  );
}
check(
  subjectRunsReader.includes('if (matchesEverySubject && !strictRead)')
    && subjectRunsReader.includes('const runs = await listRuns(circleId, opts);'),
  'only legacy subjectless reads can use the ambient listRuns compatibility path',
);
check(
  subjectRunsReader.includes("const fallbackAgentName = agentAliases.length === 0")
    && subjectRunsReader.includes('runMatchesAgent(run, agentAliases, fallbackAgentName)'),
  'exact subject aliases never mix in a duplicate-prone display-name fallback',
);
const firstSameName = buildAgentRuntimeSubject({ id: 'agent-a', name: 'Builder', sessionKey: 'session-a' });
const secondSameName = buildAgentRuntimeSubject({ id: 'agent-b', name: 'Builder', sessionKey: 'session-b' });
check(
  !firstSameName.runAgentAliases.includes('Builder')
    && !runMatchesAgent({
      agent_id: secondSameName.runAgentId,
      metadata: {
        agentSubjectKey: secondSameName.subjectKey,
        agentName: 'Builder',
        agentSubject: secondSameName.metadata,
      },
    }, firstSameName.runAgentAliases, ''),
  'two same-name exact agents cannot see each other through run aliases or stamped display metadata',
);
check(
  subjectRunsReader.includes('if (strictRead) throw')
    && subjectRunsReader.indexOf('if (strictRead) throw') < subjectRunsReader.indexOf('break;'),
  'strict paginated reads throw before a backend failure could return a partial list',
);
check(
  childRunsReader.includes(".eq('circle_id', authority.circleId)")
    && childRunsReader.includes("String(row?.parent_run_id || '') !== parentRunId"),
  'strict child reads constrain the circle and validate parent receipts',
);
check(
  stepsReader.includes(".eq('circle_id', authority.circleId)")
    && stepsReader.includes("String(row?.run_id || '') !== runId"),
  'strict step reads constrain the circle and validate run receipts',
);

check(
  panel.includes('identityAuthority: AgentRunExactReadAuthority | null')
    && panel.includes('isIdentityAuthorityCurrent: AgentRunExactReadAuthorityFence')
    && panel.includes('Number.isSafeInteger(generation)')
    && panel.includes('generation <= 0'),
  'Runs requires exact positive-generation authority and its lifecycle fence',
);
check(
  panel.includes('const [verifiedScopeKey, setVerifiedScopeKey]')
    && panel.includes('const hasVerifiedSnapshot = verifiedScopeKey === readScopeKey')
    && panel.includes('const verifiedRuns = hasVerifiedSnapshot ? runs : []')
    && panel.includes('Showing the last loaded run list.'),
  'Runs retains a verified snapshot only while the user/circle/generation/agent scope matches',
);
check(
  panel.includes('currentReadScopeKeyRef.current === capturedScopeKey')
    && panel.includes('!isRunsReadAuthorityCurrent(capturedAuthority, isIdentityAuthorityCurrent)')
    && panel.includes('setVerifiedScopeKey(capturedScopeKey)'),
  'late list and detail results are fenced by both request scope and current authority',
);
check(
  panel.includes('strict: true,')
    && panel.includes('listRunsForAgentSubjectPage(circleId, {')
    && panel.includes('getRunSteps(runId, strictReadOptions)')
    && panel.includes('listChildRuns(runId, 12, strictReadOptions)')
    && panel.includes('}, strictReadOptions);'),
  'Runs uses strict exact readers for the list, steps, and child runs',
);
check(
  panel.includes('const [snapshotTruncated, setSnapshotTruncated]')
    && panel.includes('const [scanLimit, setScanLimit] = useState(1_000)')
    && panel.includes('setSnapshotTruncated(!scanResult.complete')
    && panel.includes('No matching runs were found in the verified portion of history.')
    && panel.includes('Run history is partial.')
    && panel.includes("'SCAN 1,000 MORE'"),
  'Runs never presents a capped subject scan as verified complete or empty',
);
check(
  panel.includes('loading && !hasVerifiedSnapshot')
    && panel.includes('loading && hasVerifiedSnapshot')
    && panel.includes('loadError && verifiedRuns.length === 0 ? null'),
  'same-scope refreshes keep verified rows visible while unavailable scopes never show a false empty state',
);
check(
  panel.includes('Presentation-only liveness projection')
    && panel.includes('planRunReap(')
    && !panel.includes('reapRun(')
    && !panel.includes('<ScrollView'),
  'Runs mount remains presentation-only and leaves vertical scrolling to the panel shell',
);
check(
  runsRoute.includes('<runsPanelModule.default')
    && runsRoute.includes('identityAuthority={runtimeIdentityAuthority}')
    && runsRoute.includes('isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}'),
  'AgentPanel passes the exact generation authority and fence into Runs',
);

console.log(`office agent Runs exact-read smoke passed (${assertions} assertions)`);
