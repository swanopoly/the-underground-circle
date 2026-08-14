/**
 * Source-level wiring smoke for Office and Feed connected-agent acceptance.
 *
 * This test never contacts a bridge or imports React Native. It pins the
 * nonterminal boundary between an external runtime accepting work and a typed,
 * verified task result.
 *
 * Run:
 *   npx tsx scripts/office-agent-accepted-handoff-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFeedTaskRunHandoffSnapshot } from '../src/lib/feedTimelineMergeCore';

const root = process.cwd();
const invocationSource = readFileSync(resolve(root, 'src/lib/agentInvocation.ts'), 'utf8');
const kanbanSource = readFileSync(resolve(root, 'src/hooks/useKanbanData.ts'), 'utf8');
const officeTerminalSource = readFileSync(resolve(root, 'src/components/OfficeTerminal.tsx'), 'utf8');
const feedSource = readFileSync(resolve(root, 'src/screens/circles/tabs/FeedTab.tsx'), 'utf8');
const feedActivitySource = readFileSync(resolve(root, 'src/screens/circles/tabs/kanban/ActivityFeedPanel.tsx'), 'utf8');
const terminalSweeperMigration = readFileSync(resolve(root, 'supabase/migrations/20260807160000_office_terminal_handoff_sweeper.sql'), 'utf8');
const consolidatedSql = readFileSync(resolve(root, 'docs/RUN_THIS_SQL.sql'), 'utf8');

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing start marker ${JSON.stringify(startMarker)}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: missing end marker ${JSON.stringify(endMarker)}`);
  assert.ok(end > start, `${label}: invalid marker order`);
  return source.slice(start, end);
}

function branch(
  source: string,
  startMarker: string,
  followingMarkers: string[],
  label: string,
): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: missing branch marker ${JSON.stringify(startMarker)}`);
  const ends = followingMarkers
    .map((marker) => source.indexOf(marker, start + startMarker.length))
    .filter((index) => index > start);
  assert.ok(ends.length > 0, `${label}: no following section marker found`);
  return source.slice(start, Math.min(...ends));
}

function count(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

const resultContract = section(
  invocationSource,
  'export interface AgentInvocationResult',
  'export interface OfficeInvocationClaim',
  'agent invocation result contract',
);
const claudeSpawn = section(
  invocationSource,
  'async function invokeClaudeCode(',
  '// ─── Gemini CLI: Invoke via local bridge',
  'Claude Code spawn adapter',
);
const openSwanSend = section(
  invocationSource,
  'export async function callOpenSwanAgent(',
  '// ─── Fallback: Estimate tokens',
  'OpenSwan Office and Feed session adapter',
);
const invokeAndStream = section(
  invocationSource,
  'export async function invokeAndStream(',
  '// ─── Multi-Agent: Invoke all agents in parallel',
  'Office invoke-and-stream orchestration',
);
const runAgentOnTask = section(
  kanbanSource,
  'const runAgentOnTaskWithOutcome = useCallback',
  'const runAssignedAgentsOnTask = useCallback',
  'Feed task agent runner',
);
const runAssignedAgentsOnTask = section(
  kanbanSource,
  'const runAssignedAgentsOnTask = useCallback',
  'const updateFocusChain = useCallback',
  'Feed collaborative orchestrator',
);
const responseCard = section(
  officeTerminalSource,
  'function ResponseCard({ resp }:',
  'const cardStyles = StyleSheet.create(',
  'Office terminal response card',
);
const feedTaskParser = section(
  feedSource,
  'function parseAgentTaskMeta(',
  '// ═══════════════════════════════════════════════════════════════════════════════',
  'Feed agent-task parser',
);
const feedActiveRuns = section(
  feedSource,
  'function ActiveRunsWidget(',
  'function AgentTasksPanel(',
  'Feed active-run presentation',
);
const feedAgentTasksPanel = section(
  feedSource,
  'function AgentTasksPanel(',
  '// ─── Styles',
  'Feed agent-task presentation',
);
const feedTaskRunTimeline = section(
  feedActivitySource,
  "if (!laneDisabledRef.current.taskRuns)",
  '// Fetch proof-of-work entries',
  'Feed task-run timeline query',
);
const feedTaskRunRenderer = section(
  feedActivitySource,
  'const renderTaskRun =',
  'const renderAutomationRun =',
  'Feed task-run timeline renderer',
);

assert.doesNotMatch(
  runAgentOnTask,
  /wakeAndAssignTask\(/,
  'Feed never sends a task once to wake an agent and a second time through the selected provider adapter',
);
assert.match(
  runAssignedAgentsOnTask,
  /runAgentOnTaskWithOutcome\(/,
  'collaborative Feed orchestration consumes the typed child disposition instead of a plain response string',
);
assert.match(
  runAssignedAgentsOnTask,
  /if \(result\.disposition === 'completed'\)[\s\S]{0,700}else \{[\s\S]{0,500}break;/,
  'accepted and outcome-unknown child handoffs pause the dependent agent sequence',
);
assert.match(
  runAssignedAgentsOnTask,
  /collaborativeDisposition === 'accepted'[\s\S]{0,100}\? 'running'[\s\S]{0,100}: 'blocked'/,
  'the collaborative parent remains running for acceptance and blocked for unknown or failed work',
);
assert.match(
  runAssignedAgentsOnTask,
  /collaborativeDisposition === 'completed'[\s\S]{0,120}\? \{ completed_at: new Date\(\)\.toISOString\(\) \}[\s\S]{0,80}: \{ completed_at: null \}/,
  'only a fully completed collaborative run receives a completion timestamp',
);
assert.match(feedTaskParser, /status:\s*'processing'\s*\|\s*'accepted'\s*\|\s*'outcome_unknown'/, 'Feed task metadata has explicit accepted and outcome-unknown states');
assert.match(feedTaskParser, /statusText\.startsWith\('accepted'\)[\s\S]{0,100}awaiting verified result/, 'Feed recognizes the exact accepted tracking-task marker');
assert.match(feedTaskParser, /statusText\.startsWith\('outcome unknown'\)/, 'Feed recognizes outcome unknown before the legacy review-is-failed fallback');
assert.match(feedAgentTasksPanel, /Accepted · awaiting verified result/, 'Feed renders acceptance as awaiting a verified result');
assert.match(feedAgentTasksPanel, /Outcome unknown · verify the connected session before retrying/, 'Feed renders uncertain dispatch as verify-before-retry');
assert.match(feedActiveRuns, /isAwaitingConnectedAgentResultMetadata\(run\.metadata\)/, 'Feed recognizes the exact canonical accepted-run marker');
assert.match(feedActiveRuns, /const runtimeRuns = runs\.filter[\s\S]{0,120}!isAwaitingConnectedAgentResultMetadata/, 'Feed excludes accepted ledgers from runtime freshness');
assert.match(feedActiveRuns, /ACTIVE RUNS \(\{runtimeRuns\.length\}\)/, 'Feed active count contains only runtime-owned live rows');
assert.match(feedActiveRuns, /ACCEPTED HANDOFFS \(\{acceptedRuns\.length\}\)/, 'Feed counts accepted handoffs separately');
assert.match(feedActiveRuns, /ACCEPTED · AWAITING UPDATE · COMPLETION UNVERIFIED/, 'Feed never invents live or stale telemetry for accepted handoffs');
assert.match(feedTaskRunTimeline, /\['running', 'blocked', 'completed', 'failed'\]/, 'Feed timeline includes nonterminal accepted and outcome-unknown task runs');
assert.match(feedActivitySource, /interface TaskRunFeedItem[\s\S]{0,500}output_payload/, 'Feed timeline types the durable task-run outcome payload');
assert.match(feedTaskRunTimeline, /\.select\([^\n]*output_payload/, 'Feed timeline selects the durable task-run outcome payload');
assert.match(
  feedActivitySource,
  /import \{[\s\S]{0,220}readFeedTaskRunHandoffSnapshot,[\s\S]{0,80}\} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/feedTimelineMergeCore'/,
  'Feed timeline imports the shared task-run handoff parser',
);
assert.match(
  feedTaskRunRenderer,
  /const handoff = readFeedTaskRunHandoffSnapshot\(run\)/,
  'Feed timeline delegates exact persisted handoff parsing to the shared helper',
);

const acceptedTaskRun = readFeedTaskRunHandoffSnapshot({
  status: 'running',
  summary: 'OpenSwan accepted the task',
  output_payload: {
    handoff_status: 'accepted',
    completion_verified: false,
  },
});
assert.equal(acceptedTaskRun?.status, 'accepted', 'the shared helper accepts only an unverified accepted/running pair');

const unknownTaskRun = readFeedTaskRunHandoffSnapshot({
  status: 'blocked',
  summary: 'The send may have happened',
  output_payload: {
    handoff_status: 'outcome_unknown',
    completion_verified: false,
  },
});
assert.equal(unknownTaskRun?.status, 'outcome_unknown', 'the shared helper accepts only an unverified outcome_unknown/blocked pair');

for (const [label, value] of [
  ['generic running', { status: 'running', output_payload: null }],
  ['generic blocked', { status: 'blocked', output_payload: {} }],
  ['accepted without explicit unverified completion', { status: 'running', output_payload: { handoff_status: 'accepted' } }],
  ['accepted with verified completion', { status: 'running', output_payload: { handoff_status: 'accepted', completion_verified: true } }],
  ['accepted with blocked status', { status: 'blocked', output_payload: { handoff_status: 'accepted', completion_verified: false } }],
  ['outcome unknown with running status', { status: 'running', output_payload: { handoff_status: 'outcome_unknown', completion_verified: false } }],
  ['unknown handoff marker', { status: 'running', output_payload: { handoff_status: 'pending', completion_verified: false } }],
] as const) {
  assert.equal(
    readFeedTaskRunHandoffSnapshot(value),
    null,
    `the shared helper rejects ${label}`,
  );
}
assert.match(
  feedTaskRunRenderer,
  /handoff\?\.status === 'accepted'[\s\S]{0,160}fallbackSummary\s*=\s*'Handoff accepted · awaiting verified result'/,
  'Feed timeline gives only exact accepted handoffs explicit nonterminal copy',
);
assert.match(
  feedTaskRunRenderer,
  /handoff\?\.status === 'outcome_unknown'[\s\S]{0,160}fallbackSummary\s*=\s*'Dispatch outcome unknown · verify before retrying'/,
  'Feed timeline gives only exact uncertain dispatch verify-before-retry copy',
);
assert.match(feedTaskRunRenderer, /Task run in progress/, 'ordinary running task runs keep generic nonterminal copy');
assert.match(feedTaskRunRenderer, /Task run blocked/, 'ordinary blocked task runs keep generic blocked copy');
assert.doesNotMatch(
  feedTaskRunRenderer,
  /const fallbackSummary\s*=\s*run\.status === 'running'[\s\S]{0,100}\?\s*'Handoff accepted · awaiting verified result'/,
  'ordinary running status alone never claims that a connected-agent handoff was accepted',
);
assert.doesNotMatch(
  feedTaskRunRenderer,
  /const fallbackSummary\s*=\s*run\.status === 'blocked'[\s\S]{0,100}\?\s*'Dispatch outcome unknown · verify before retrying'/,
  'ordinary blocked status alone never claims that dispatch outcome is unknown',
);
assert.match(terminalSweeperMigration, /NOT EXISTS \([\s\S]*response_row\.message_id = message_row\.id[\s\S]*response_row\.status = 'streaming'/, 'the stale sweeper preserves a parent with an open streaming handoff');
assert.match(terminalSweeperMigration, /WHERE response_row\.status = 'pending'/, 'the stale sweeper still expires genuinely pending responses');
assert.doesNotMatch(terminalSweeperMigration, /WHERE response_row\.status IN \('pending', 'streaming'\)/, 'the stale sweeper never terminalizes accepted streaming handoffs');
const consolidatedSweeperMarker = '-- §35. Office terminal nonterminal-handoff sweeper (2026-08-07)';
const consolidatedSweeperIndex = consolidatedSql.indexOf(consolidatedSweeperMarker);
assert.ok(consolidatedSweeperIndex >= 0, 'the consolidated SQL registers the Office handoff sweeper section');
const consolidatedBindingIndex = consolidatedSql.indexOf(
  '-- §36. Owner-private Office agent → OpenSwan session bindings (2026-08-07)',
  consolidatedSweeperIndex + consolidatedSweeperMarker.length,
);
assert.ok(consolidatedBindingIndex > consolidatedSweeperIndex, 'the next numbered SQL section bounds the Office handoff sweeper mirror');
const consolidatedBindingSeparatorIndex = consolidatedSql.lastIndexOf(
  '\n-- ═',
  consolidatedBindingIndex,
);
assert.ok(consolidatedBindingSeparatorIndex > consolidatedSweeperIndex, 'the §36 separator is outside the §35 migration body');
const consolidatedSweeperSection = consolidatedSql.slice(
  consolidatedSweeperIndex,
  consolidatedBindingSeparatorIndex,
);
assert.equal(
  consolidatedSweeperSection.slice(consolidatedSweeperSection.indexOf('BEGIN;')).trim(),
  terminalSweeperMigration.slice(terminalSweeperMigration.indexOf('BEGIN;')).trim(),
  'the consolidated Office handoff sweeper body matches its forward migration exactly',
);

// The shared result cannot collapse accepted or ambiguous transport into the
// old boolean success/completion bucket.
assert.match(
  resultContract,
  /disposition\?:\s*'completed'\s*\|\s*'accepted'\s*\|\s*'failed'\s*\|\s*'outcome_unknown'/,
  'AgentInvocationResult discriminates completed, accepted, failed, and outcome_unknown',
);
assert.match(resultContract, /completionVerified\?:\s*boolean/, 'result carries explicit completion verification');
assert.match(resultContract, /providerRunId\?:\s*string/, 'result keeps the external provider-run identity');
assert.match(resultContract, /runId\?:\s*string/, 'result keeps the canonical local run identity separate');

// A Claude /spawn acknowledgement is accepted only when exactly one result has
// the bridge-owned 36-character hexadecimal handle. Multiple, missing, or
// malformed handles are outcome-unknown because the transport may have fired.
assert.match(claudeSpawn, /\/\^\[a-f0-9\]\{36\}\$\//, 'Claude spawn validates the exact safe handle grammar');
assert.match(claudeSpawn, /\.filter\(/, 'Claude spawn collects all valid handles instead of taking the first match');
const claudeInconsistent = section(
  claudeSpawn,
  'if (!data.ok)',
  'const accepted =',
  'Claude inconsistent top-level response',
);
assert.match(claudeInconsistent, /disposition:\s*'outcome_unknown'/, 'an inconsistent response remains outcome_unknown');
assert.match(claudeInconsistent, /providerRunId:\s*safeSuccessfulHandles\[0\]\.spawnId/, 'outcome_unknown preserves one exact safe provider handle');
const claudeAcceptanceGate = section(
  claudeSpawn,
  'const accepted =',
  'if (!accepted)',
  'Claude exact-handle acceptance gate',
);
assert.match(claudeAcceptanceGate, /successfulResults\.length\s*===\s*1/, 'Claude acceptance requires exactly one successful result');
assert.match(claudeAcceptanceGate, /results\.length\s*===\s*1/, 'Claude acceptance rejects extra result rows from a single-task request');
assert.match(claudeAcceptanceGate, /Number\(data\.spawned\)\s*===\s*1/, 'Claude acceptance requires exactly one provider-reported spawn');
assert.match(claudeAcceptanceGate, /Number\(data\.total\)\s*===\s*1/, 'Claude acceptance requires the bridge to confirm one requested spawn');
assert.match(claudeAcceptanceGate, /safeSuccessfulHandles\.length\s*===\s*1/, 'Claude acceptance requires exactly one prevalidated provider handle');
assert.match(claudeAcceptanceGate, /\?\s*safeSuccessfulHandles\[0\]/, 'Claude acceptance adopts only the sole prevalidated provider handle');
const claudeAmbiguous = section(
  claudeSpawn,
  'if (!accepted)',
  'const responseText =',
  'Claude malformed-handle result',
);
assert.match(claudeAmbiguous, /success:\s*false/, 'malformed Claude success cannot remain successful');
assert.match(claudeAmbiguous, /disposition:\s*'outcome_unknown'/, 'zero or multiple safe Claude handles fail closed as outcome_unknown');
const claudeAcceptedDispositionIndex = claudeSpawn.indexOf("disposition: 'accepted'");
assert.ok(claudeAcceptedDispositionIndex >= 0, 'Claude spawn has an explicit accepted result');
const claudeAcceptedReturnIndex = claudeSpawn.lastIndexOf('return {', claudeAcceptedDispositionIndex);
const claudeCatchIndex = claudeSpawn.indexOf('} catch', claudeAcceptedDispositionIndex);
assert.ok(
  claudeAcceptedReturnIndex >= 0 && claudeCatchIndex > claudeAcceptedReturnIndex,
  'Claude accepted return is isolated from transport exception handling',
);
const claudeAccepted = claudeSpawn.slice(claudeAcceptedReturnIndex, claudeCatchIndex);
assert.match(claudeAccepted, /success:\s*true/, 'a uniquely identified Claude spawn is transport-accepted');
assert.match(claudeAccepted, /completionVerified:\s*false/, 'Claude spawn acceptance is never completion-verified');
assert.match(
  claudeAccepted,
  /providerRunId:\s*[A-Za-z_$][\w$]*\.spawnId/,
  'Claude acceptance exposes its exact external spawn id',
);

assert.match(openSwanSend, /parseExactOpenSwanSessionTarget\(agentId\)/, 'OpenSwan Office and Feed require an exact connection/session target');
assert.doesNotMatch(openSwanSend, /agent:main:main/, 'OpenSwan never silently falls back to the main session');
assert.match(openSwanSend, /sendSessionMessage\(/, 'OpenSwan uses the canonical structured sessions_send adapter');
assert.doesNotMatch(openSwanSend, /sessions_history|\/tools\/invoke/, 'OpenSwan no longer polls prose history or owns a parallel raw tool sender');
assert.match(openSwanSend, /sent\.transportAccepted === true[\s\S]{0,650}disposition:\s*'accepted'/, 'structured transport acceptance remains a nonterminal handoff');
assert.match(openSwanSend, /sent\.transportAccepted === false[\s\S]{0,450}disposition:\s*'failed'/, 'structured pre-dispatch rejection remains failed');
assert.match(openSwanSend, /disposition:\s*'outcome_unknown'/, 'ambiguous OpenSwan transport remains outcome_unknown');
assert.match(openSwanSend, /externalDispatchKind:\s*'sessions_send'/, 'OpenSwan stamps the exact dispatch kind for future reconciliation');
assert.match(openSwanSend, /externalConnectionId:\s*target\.connectionId/, 'OpenSwan stamps the exact connection separately from session and run ids');
assert.match(openSwanSend, /sessionId:\s*sent\.sessionKey/, 'OpenSwan preserves exact session lineage');

// Slice each Office disposition branch independently. This prevents completion
// code later in the function from satisfying an acceptance assertion.
const officeHandoffStart = "if (disposition === 'accepted' || disposition === 'outcome_unknown')";
const officeFailureStart = 'if (!result.success)';
const officeCompletionStart = "console.log('[agentInvocation] provider_completed')";
const officeHandoffIndex = invokeAndStream.indexOf(officeHandoffStart);
const officeFailureIndex = invokeAndStream.indexOf(officeFailureStart);
const officeCompletionIndex = invokeAndStream.indexOf(officeCompletionStart);
assert.ok(officeHandoffIndex >= 0, 'Office has an explicit accepted/outcome_unknown branch');
assert.ok(officeFailureIndex >= 0, 'Office retains an explicit generic failure branch');
assert.ok(officeCompletionIndex >= 0, 'Office retains an explicit verified completion branch');
assert.ok(
  officeHandoffIndex < officeFailureIndex,
  'Office handles accepted and outcome_unknown before generic failure handling',
);
assert.ok(
  officeHandoffIndex < officeCompletionIndex,
  'Office handles accepted and outcome_unknown before verified completion handling',
);

const officeHandoff = branch(
  invokeAndStream,
  officeHandoffStart,
  [officeFailureStart, officeCompletionStart],
  'Office nonterminal handoff',
);
const officeAcceptedLedger = section(
  officeHandoff,
  "if (disposition === 'accepted')",
  'result = {',
  'Office accepted-run ledger',
);
assert.equal(
  count(invokeAndStream, /recordConnectedAgentAcceptedRun\(/g),
  1,
  'Office creates exactly one canonical run for the accepted branch',
);
assert.match(officeAcceptedLedger, /recordConnectedAgentAcceptedRun\(\{/, 'accepted Office handoff uses the canonical run writer');
assert.match(officeAcceptedLedger, /surface:\s*'office_terminal'/, 'accepted Office handoff records an office_terminal run');
assert.match(officeAcceptedLedger, /agentSubjectMetadata:\s*agentSubject\.metadata/, 'accepted Office handoff preserves canonical subject identity');
assert.match(
  officeAcceptedLedger,
  /try \{[\s\S]*recordConnectedAgentAcceptedRun\([\s\S]*\} catch \{[\s\S]*accepted_run_persistence_exception/,
  'a local accepted-run persistence exception cannot overwrite provider acceptance',
);
assert.equal(
  count(officeHandoff, /recordConnectedAgentAcceptedRun\(/g),
  count(officeAcceptedLedger, /recordConnectedAgentAcceptedRun\(/g),
  'the canonical run writer is reachable only through the accepted guard',
);
assert.match(officeHandoff, /streamResponse\([\s\S]{0,420}'streaming'/, 'accepted and outcome-unknown Office responses share a nonterminal state');
assert.match(officeHandoff, /completionVerified:\s*false/, 'Office handoffs remain explicitly completion-unverified');
assert.doesNotMatch(officeHandoff, /provider_completed/, 'nonterminal Office handoffs never claim provider completion');
assert.doesNotMatch(officeHandoff, /markMessageDone\(/, 'nonterminal Office handoffs do not close the message');
assert.doesNotMatch(
  officeHandoff,
  /completeAgentTask\([\s\S]*?\btrue\b/,
  'nonterminal Office handoffs never mark the tracking task complete',
);
assert.match(officeHandoff, /return\s*\{/, 'nonterminal Office handoffs return before generic completion');

// Feed/Kanban must stop before parsing deliverables, publishing proof, or
// awarding XP when the connected runtime only accepted the work or its outcome
// is unknown.
const feedHandoffStart = "if (invocationDisposition === 'accepted' || invocationDisposition === 'outcome_unknown')";
const feedFailureStart = 'if (!result.success)';
const feedCompletionStart = "const response = result.responseText || 'Agent completed task (no output)'";
const feedHandoffIndex = runAgentOnTask.indexOf(feedHandoffStart);
const feedFailureIndex = runAgentOnTask.indexOf(feedFailureStart);
const feedCompletionIndex = runAgentOnTask.indexOf(feedCompletionStart);
assert.ok(feedHandoffIndex >= 0, 'Feed has an explicit accepted/outcome_unknown branch');
assert.ok(feedFailureIndex >= 0, 'Feed retains an explicit generic failure branch');
assert.ok(feedCompletionIndex >= 0, 'Feed retains the verified result branch');
assert.ok(
  feedHandoffIndex < feedFailureIndex,
  'Feed handles accepted and outcome_unknown before generic failure handling',
);
assert.ok(
  feedHandoffIndex < feedCompletionIndex,
  'Feed handles accepted and outcome_unknown before completion/proof handling',
);

const feedHandoff = branch(
  runAgentOnTask,
  feedHandoffStart,
  [feedFailureStart, feedCompletionStart],
  'Feed nonterminal handoff',
);
assert.match(feedHandoff, /const accepted = invocationDisposition === 'accepted'/, 'Feed distinguishes accepted from outcome_unknown inside the guarded branch');
assert.match(feedHandoff, /const nonterminalStatus = accepted \? 'running' : 'blocked'/, 'accepted Feed task_run stays running while outcome_unknown becomes blocked');
assert.match(feedHandoff, /updateTaskRunRecord\([\s\S]{0,500}status:\s*nonterminalStatus/, 'Feed persists only the selected nonterminal task_run status');
assert.match(feedHandoff, /accepted \? 'in_progress' : 'blocked'/, 'Feed assignment remains in progress or blocked, never completed');
assert.match(feedHandoff, /return\s*\{[\s\S]{0,160}disposition:\s*invocationDisposition/, 'Feed returns the typed nonterminal child outcome before completion processing');
assert.doesNotMatch(feedHandoff, /completed_at\s*:/, 'nonterminal Feed handoffs have no completion timestamp');
assert.doesNotMatch(feedHandoff, /status:\s*'completed'/, 'nonterminal Feed handoffs do not complete the task_run');
assert.doesNotMatch(
  feedHandoff,
  /buildRunProofPublication|addProofOfWork|saveTaskCompletionMemory|createTaskRunArtifact/,
  'nonterminal Feed handoffs publish no completion proof or artifact',
);
assert.doesNotMatch(feedHandoff, /awardXP|getXPForAction/, 'nonterminal Feed handoffs award no completion XP');

// Streaming is the shared accepted/unknown UI state. Its presentation must be
// explicit that a handoff is open and no final result has been verified.
const streamingCard = branch(
  responseCard,
  "if (resp.status === 'streaming')",
  ["if (resp.status === 'error')"],
  'Office streaming response presentation',
);
assert.match(streamingCard, /HANDOFF OPEN/, 'Office streaming card labels the handoff as open');
assert.match(streamingCard, /AWAITING VERIFIED RESULT/, 'Office streaming card says a verified result is still pending');
assert.match(streamingCard, /Completion is unverified\./, 'Office streaming card explicitly says completion is unverified');
assert.doesNotMatch(streamingCard, /✅|\bCOMPLETED\b|\bDONE\b/, 'Office streaming card has no completion affordance');

console.log('office agent accepted-handoff smoke: all assertions passed');
