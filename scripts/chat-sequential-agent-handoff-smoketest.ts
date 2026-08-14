/**
 * Truthfulness contract for Chat's sequential connected-agent orchestration.
 *
 * This smoke performs no provider or database I/O. Its executable harness pins
 * the state-machine semantics, while the source slice proves Chat applies the
 * same boundary: only a bounded synchronous `drafted` result can feed the next
 * agent. Accepted, unknown, failed, and thrown dispatches pause without replay.
 *
 * Run against the worktree:
 *   npx tsx scripts/chat-sequential-agent-handoff-smoketest.ts
 *
 * Optional red-first compatibility proof against a Git revision:
 *   CHAT_SEQUENTIAL_SOURCE_REVISION=HEAD \
 *     npx tsx scripts/chat-sequential-agent-handoff-smoketest.ts
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type HandoffStatus = 'accepted' | 'drafted' | 'failed' | 'unknown';

type HandoffReceipt = {
  status: HandoffStatus;
  message: string;
  completionVerified: false;
};

type AgentPhase =
  | 'pending'
  | 'draft_returned'
  | 'accepted_awaiting_typed_result'
  | 'outcome_unknown'
  | 'failed';

type AgentState = {
  name: string;
  phase: AgentPhase;
  dispatched: boolean;
};

type HarnessResult = {
  providerCalls: number;
  agents: AgentState[];
  dispatchPrompts: string[];
  priorCompletedWork: string[];
  summary: string;
};

type Dispatch = (agentName: string, prompt: string) => Promise<HandoffReceipt>;

const MAX_DRAFT_CONTEXT_CHARS = 3000;
const repoRoot = process.cwd();
const chatRelativePath = 'src/screens/circles/tabs/ChatTab.tsx';
const sourceRevision = process.env.CHAT_SEQUENTIAL_SOURCE_REVISION?.trim() || null;

let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): condition is true {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(label);
  return false;
}

function source(relativePath: string): string {
  if (sourceRevision) {
    return execFileSync('git', ['show', `${sourceRevision}:${relativePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  }
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function section(value: string, start: string, end: string, label: string): string {
  const startIndex = value.indexOf(start);
  if (!check(startIndex >= 0, `${label}: start marker exists`)) return '';
  const endIndex = value.indexOf(end, startIndex + start.length);
  if (!check(endIndex > startIndex, `${label}: end marker exists`)) return '';
  return value.slice(startIndex, endIndex);
}

function expectMatch(value: string, pattern: RegExp, label: string): void {
  check(pattern.test(value), label);
}

function expectNoMatch(value: string, pattern: RegExp, label: string): void {
  check(!pattern.test(value), label);
}

function hasTerminalClaim(value: string): boolean {
  return /\b(?:completed|done|finished|succeeded|successful(?:ly)?)\b/i.test(value);
}

function receipt(status: HandoffStatus, message: string): HandoffReceipt {
  return { status, message, completionVerified: false };
}

/**
 * Executable reference state machine. It intentionally treats receipt prose as
 * untrusted for lifecycle: the typed status alone decides whether to continue.
 */
async function runSequentialHarness(
  agentNames: string[],
  task: string,
  dispatch: Dispatch,
): Promise<HarnessResult> {
  const agents: AgentState[] = agentNames.map((name) => ({
    name,
    phase: 'pending',
    dispatched: false,
  }));
  const dispatchPrompts: string[] = [];
  const priorCompletedWork: string[] = [];
  let priorContext = '';
  let providerCalls = 0;

  for (let index = 0; index < agents.length; index += 1) {
    const agent = agents[index];
    const prompt = priorContext
      ? `${task}\n\nPrior synchronous draft context:\n${priorContext}`
      : task;
    dispatchPrompts.push(prompt);
    agent.dispatched = true;
    providerCalls += 1;

    let handoff: HandoffReceipt;
    try {
      handoff = await dispatch(agent.name, prompt);
    } catch {
      agent.phase = 'failed';
      break;
    }

    if (handoff.status === 'drafted') {
      agent.phase = 'draft_returned';
      const boundedDraft = handoff.message.slice(0, MAX_DRAFT_CONTEXT_CHARS);
      priorCompletedWork.push(boundedDraft);
      priorContext = [
        priorContext,
        `Synchronous draft from ${agent.name}:`,
        boundedDraft,
      ].filter(Boolean).join('\n\n');
      continue;
    }

    agent.phase = handoff.status === 'accepted'
      ? 'accepted_awaiting_typed_result'
      : handoff.status === 'unknown'
        ? 'outcome_unknown'
        : 'failed';
    break;
  }

  const accepted = agents.filter((agent) => agent.phase === 'accepted_awaiting_typed_result').length;
  const unknown = agents.filter((agent) => agent.phase === 'outcome_unknown').length;
  const failed = agents.filter((agent) => agent.phase === 'failed').length;
  const drafts = agents.filter((agent) => agent.phase === 'draft_returned').length;
  const pendingNames = agents.filter((agent) => agent.phase === 'pending').map((agent) => agent.name);
  const summaryParts = [
    `Sequential dispatch update: ${accepted} accepted, ${drafts} drafts returned, ${unknown} unknown, ${failed} failed.`,
  ];
  if (accepted > 0) summaryParts.push('Accepted handoff is awaiting a typed result; completion is not verified.');
  if (unknown > 0) summaryParts.push('Dispatch outcome is unknown and was not replayed.');
  if (failed > 0) summaryParts.push('Dispatch failed and was not replayed.');
  if (pendingNames.length > 0) summaryParts.push(`Pending and undispatched: ${pendingNames.join(', ')}.`);

  return {
    providerCalls,
    agents,
    dispatchPrompts,
    priorCompletedWork,
    summary: summaryParts.join(' '),
  };
}

function laterAgentsArePending(result: HarnessResult): boolean {
  return result.agents.slice(1).every((agent) => agent.phase === 'pending' && !agent.dispatched);
}

async function main(): Promise<void> {
  const agents = ['Alpha', 'Beta', 'Gamma'];

  // Every non-draft outcome is a one-call barrier, even if its prose falsely
  // sounds terminal. Receipt prose must never become prior completed work.
  for (const status of ['accepted', 'unknown', 'failed'] as const) {
    let calls = 0;
    const result = await runSequentialHarness(agents, 'Ship the feature', async () => {
      calls += 1;
      return receipt(status, `Alpha says the task completed successfully (${status}).`);
    });
    check(calls === 1, `${status}: dispatch function is called once`);
    check(result.providerCalls === 1, `${status}: state machine records one provider call`);
    check(result.agents[0]?.dispatched === true, `${status}: first agent is visibly dispatched`);
    check(laterAgentsArePending(result), `${status}: later agents remain visibly pending and undispatched`);
    check(result.dispatchPrompts.length === 1, `${status}: no downstream prompt is built`);
    check(result.priorCompletedWork.length === 0, `${status}: acknowledgement prose is not prior work`);
    check(!hasTerminalClaim(result.summary), `${status}: final summary makes no completion claim`);
  }

  let thrownCalls = 0;
  const thrown = await runSequentialHarness(agents, 'Ship the feature', async () => {
    thrownCalls += 1;
    throw new Error('provider response was lost after dispatch');
  });
  check(thrownCalls === 1, 'thrown dispatch calls the provider once');
  check(thrown.providerCalls === 1, 'thrown dispatch records one provider call');
  check(thrown.agents[0]?.phase === 'failed', 'thrown dispatch is visibly non-successful');
  check(laterAgentsArePending(thrown), 'thrown dispatch leaves later agents pending and undispatched');
  check(thrown.priorCompletedWork.length === 0, 'thrown error prose is not prior work');
  check(!hasTerminalClaim(thrown.summary), 'thrown dispatch summary makes no completion claim');

  // A synchronous draft is the sole continuation signal. The next accepted
  // acknowledgement pauses the chain and never contaminates subsequent context.
  const draftText = 'A'.repeat(MAX_DRAFT_CONTEXT_CHARS + 417);
  const draftThenAcceptedCalls: Array<{ agent: string; prompt: string }> = [];
  const draftThenAccepted = await runSequentialHarness(agents, 'Ship the feature', async (agent, prompt) => {
    draftThenAcceptedCalls.push({ agent, prompt });
    if (agent === 'Alpha') return receipt('drafted', draftText);
    return receipt('accepted', 'Beta accepted the handoff; work is still running.');
  });
  check(draftThenAccepted.providerCalls === 2, 'draft then accepted makes exactly two provider calls');
  check(draftThenAccepted.agents[0]?.phase === 'draft_returned', 'genuine synchronous draft is identified as a draft');
  check(
    draftThenAccepted.agents[1]?.phase === 'accepted_awaiting_typed_result',
    'accepted second handoff remains awaiting a typed result',
  );
  check(
    draftThenAccepted.agents[2]?.phase === 'pending' && !draftThenAccepted.agents[2]?.dispatched,
    'third agent remains visibly pending after the accepted barrier',
  );
  check(draftThenAccepted.priorCompletedWork.length === 1, 'only the synchronous draft becomes prior work');
  check(
    draftThenAccepted.priorCompletedWork[0]?.length === MAX_DRAFT_CONTEXT_CHARS,
    'synchronous draft context is bounded to 3000 characters',
  );
  check(
    draftThenAcceptedCalls[1]?.prompt.includes('A'.repeat(MAX_DRAFT_CONTEXT_CHARS)),
    'bounded synchronous draft is supplied to the next agent',
  );
  check(
    !draftThenAcceptedCalls.some((call) => call.prompt.includes('Beta accepted the handoff')),
    'accepted acknowledgement is never injected into a later prompt',
  );
  check(!hasTerminalClaim(draftThenAccepted.summary), 'draft/accepted summary makes no completion claim');

  let allDraftCalls = 0;
  const allDrafts = await runSequentialHarness(agents, 'Draft the feature', async (agent) => {
    allDraftCalls += 1;
    return receipt('drafted', `${agent} synchronous draft`);
  });
  check(allDraftCalls === agents.length, 'genuine synchronous drafts may advance through the whole chain');
  check(
    allDrafts.agents.every((agent) => agent.phase === 'draft_returned' && agent.dispatched),
    'all-draft chain records drafts without upgrading them to completed work',
  );
  check(allDrafts.priorCompletedWork.length === agents.length, 'each genuine draft is the only carried context');
  check(!hasTerminalClaim(allDrafts.summary), 'all-draft summary still does not claim task completion');

  // Source-level integration assertions. These deliberately slice only the
  // sequential route so the parallel strategy may retain its independent fanout.
  const chatSource = source(chatRelativePath);
  const orchestration = section(
    chatSource,
    'const addMultiAgentReply = (result: MultiAgentChatResult) => {',
    '// ─── Selected connected-agent route',
    'multi-agent orchestration',
  );
  const completion = section(
    orchestration,
    'const addMultiAgentCompletion = (results: MultiAgentChatResult[]) => {',
    "if (multiAgentPlan.strategy === 'sequential') {",
    'multi-agent dispatch summary',
  );
  const sequential = section(
    orchestration,
    "if (multiAgentPlan.strategy === 'sequential') {",
    'Promise.allSettled(',
    'sequential handoff route',
  );

  expectMatch(
    sequential,
    /const handoff = await dispatchAssignedAgentTask\(agent, task, multiAgentVisualBriefs\)/,
    'sequential route awaits one typed handoff receipt at a time',
  );
  expectMatch(
    sequential,
    /if \(handoff\.status !== 'drafted'\) \{[\s\S]{0,520}?pausedAfterIndex = index;[\s\S]{0,80}?break;/,
    'accepted, unknown, and failed receipts synchronously pause the chain',
  );
  expectMatch(
    sequential,
    /catch \(err: any\) \{[\s\S]{0,500}?pausedAfterIndex = index;[\s\S]{0,80}?break;/,
    'thrown dispatch synchronously pauses the chain',
  );
  expectMatch(
    sequential,
    /if \(handoff\.status !== 'drafted'\)[\s\S]{0,650}?priorContext = \[[\s\S]{0,220}?handoff\.message\.slice\(0, 3000\)/,
    'only post-guard drafted prose enters bounded prior context',
  );
  expectNoMatch(
    sequential,
    /catch \(err: any\) \{[\s\S]{0,600}?priorContext\s*=/,
    'thrown error prose never enters prior context',
  );
  expectNoMatch(
    sequential,
    /`Blocked:\s*\$\{err\?\.message/,
    'legacy error-as-prior-work injection is absent',
  );
  const dispatchIndex = sequential.indexOf('const handoff = await dispatchAssignedAgentTask');
  const draftGuardIndex = sequential.indexOf("if (handoff.status !== 'drafted')", dispatchIndex);
  const priorContextIndex = sequential.indexOf('priorContext = [', dispatchIndex);
  check(
    dispatchIndex >= 0 && draftGuardIndex > dispatchIndex && priorContextIndex > draftGuardIndex,
    'receipt status is checked before any handoff message can become prior context',
  );

  expectMatch(
    sequential,
    /const waiting = targets\.slice\(pausedAfterIndex \+ 1\)/,
    'paused route derives the exact downstream pending agents',
  );
  expectMatch(
    sequential,
    /waiting\.map\(\(agent\) => `@\$\{agent\.name\}`\)/,
    'paused route visibly names every downstream pending agent',
  );
  expectMatch(
    sequential,
    /remain undispatched until usable upstream output is available/,
    'paused route truthfully says downstream agents were not dispatched',
  );
  const waitingBlock = section(
    sequential,
    'if (pausedAfterIndex !== null && pausedAfterIndex < targets.length - 1) {',
    'addMultiAgentCompletion(results);',
    'downstream waiting presentation',
  );
  expectNoMatch(waitingBlock, /results\.push\(/, 'pending downstream agents are not recorded as dispatched results');
  expectNoMatch(waitingBlock, /addMultiAgentReply\(/, 'pending downstream agents receive no fabricated reply');

  expectMatch(
    completion,
    /receipt\?\.status === 'accepted'[\s\S]{0,220}?receipt\?\.status === 'drafted'[\s\S]{0,220}?receipt\?\.status === 'unknown'/,
    'summary counts accepted, drafted, and unknown receipts separately',
  );
  expectMatch(
    completion,
    /Accepted handoffs are still awaiting typed completion from their connected sessions/,
    'accepted summary explicitly remains awaiting typed completion',
  );
  expectMatch(
    completion,
    /Unknown dispatches were not replayed/,
    'unknown summary explicitly says it was not replayed',
  );
  expectMatch(
    completion,
    /dispatch update:/,
    'final user-facing summary is a dispatch update rather than a completion report',
  );
  expectMatch(
    completion,
    /surface: `\$\{strategySurface\}_dispatch_update`/,
    'summary telemetry remains nonterminal dispatch-update telemetry',
  );
  expectNoMatch(completion, /formatMultiAgentRunSummary\(/, 'legacy completion-oriented formatter is not used');
  expectNoMatch(completion, /surface: `\$\{strategySurface\}_complete`/, 'summary does not emit a completed surface');
  expectMatch(
    orchestration,
    /outcomeVerdict: result\.receipt\?\.status === 'failed' \|\| !result\.ok \? 'failed' : 'unknown'/,
    'individual handoff messages remain failed or unknown, never complete',
  );

  const mode = sourceRevision ? `git revision ${sourceRevision}` : 'current worktree';
  console.log(`\nchat-sequential-agent-handoff-smoketest (${mode}): ${passed} passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error('chat-sequential-agent-handoff-smoketest crashed:', error);
  process.exitCode = 1;
});
