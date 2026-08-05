/**
 * chat-automation-suggestions-smoketest
 *
 * Covers the pure adapter from repeated chat automation decisions to
 * AutomationProposalCard-ready schedule proposals.
 *
 * Run: `npm run smoke:chat-automation-suggestions`
 */

import {
  buildAutomationProposalFromRepeatedFlow,
  buildRepeatedFlowAutomationProposals,
} from '../src/lib/chatAutomationSuggestions';
import type { ChatAutomationDecisionRow } from '../src/lib/chatAutomationDecisions';
import type { RepeatedFlowSuggestion } from '../src/lib/repeatedFlowDetection';

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assert(ok: boolean, name: string) { if (!ok) fail(name); else pass(name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
  else pass(name);
}

function suggestion(overrides: Partial<RepeatedFlowSuggestion> = {}): RepeatedFlowSuggestion {
  return {
    fingerprint: 'run_command_handler|mission|/summary',
    executionKind: 'run_command_handler',
    routeId: 'mission',
    commandFingerprint: '/summary',
    occurrences: 4,
    completedCount: 4,
    successRatio: 1,
    firstAt: '2026-06-20T13:15:00Z',
    lastAt: '2026-06-23T13:15:00Z',
    intervalCv: 0.01,
    cadence: 'daily',
    score: 55,
    exampleRunIds: ['r1', 'r2', 'r3', 'r4'],
    ...overrides,
  };
}

function row(runId: string, day: number, commandText = '/summary'): ChatAutomationDecisionRow {
  const startedAt = `2026-06-${String(day).padStart(2, '0')}T13:15:00Z`;
  return {
    runId,
    circleId: 'circle-1',
    userId: 'user-1',
    surface: 'main_chat',
    mode: null,
    title: commandText,
    startedAt,
    completedAt: startedAt,
    status: 'completed',
    decision: {
      executionKind: 'run_command_handler',
      routeId: 'mission',
      commandText,
    },
    outcomeStatus: 'completed',
    outcomeDurationMs: 300,
    approvalId: null,
  };
}

function main() {
  {
    const proposal = buildAutomationProposalFromRepeatedFlow(suggestion());
    assertEqual(proposal?.triggerType, 'schedule', 'daily: schedule proposal');
    assertEqual(proposal?.cronExpression, '15 13 * * *', 'daily: cron from last run UTC time');
    assertEqual(proposal?.scheduleSummary, 'Every day at 1:15 PM UTC', 'daily: summary');
    assert(proposal?.prompt.includes('/summary') === true, 'daily: command preserved');
    assertEqual(proposal?.outputTarget, 'chat', 'daily: output target is chat');
  }

  {
    const proposal = buildAutomationProposalFromRepeatedFlow(suggestion({
      cadence: 'multi_day',
      lastAt: '2026-06-22T09:05:00Z',
      fingerprint: 'run_openswan||review builds',
      executionKind: 'run_openswan',
      routeId: null,
      commandFingerprint: 'review builds',
    }));
    assertEqual(proposal?.cronExpression, '5 9 * * 1', 'multi-day: weekly cron from last run day');
    assertEqual(proposal?.scheduleSummary, 'Every Monday at 9:05 AM UTC', 'multi-day: weekly summary');
  }

  {
    const proposal = buildAutomationProposalFromRepeatedFlow(suggestion({
      cadence: 'irregular',
      intervalCv: 1.2,
    }));
    assertEqual(proposal, null, 'irregular: no schedule proposal');
  }

  {
    const proposals = buildRepeatedFlowAutomationProposals([
      row('r1', 20),
      row('r2', 21),
      row('r3', 22),
      row('r4', 23),
    ]);
    assertEqual(proposals.length, 1, 'rows: repeated flow becomes one proposal');
    assertEqual(proposals[0]?.fingerprint, 'run_command_handler|mission|/summary', 'rows: fingerprint carried');
    assert(proposals[0]?.message.includes('4 times') === true, 'rows: user message explains frequency');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll chat-automation-suggestions smoke cases passed.');
}

main();
