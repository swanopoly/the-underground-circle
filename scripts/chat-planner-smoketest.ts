/**
 * chat-planner-smoketest — covers the classification matrix of
 * `src/lib/chatAutomationPlanner.ts` so ChatTab.sendMessage can migrate
 * onto it (Phase 1 of `docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`)
 * without silently regressing routing.
 *
 * Usage:
 *   npm run smoke:chat-planner
 *
 * Exit code 0 = all cases pass. The suite is intentionally a matrix of
 * `{ input → expected }` over every `execution.kind` + `source` branch,
 * so extensions to `buildChatAutomationPlan` (Phase 1b / 1c) fail loudly
 * here if they accidentally rewrite an existing classification.
 */

import { buildChatAutomationPlan, type ChatAutomationPlan } from '../src/lib/chatAutomationPlanner';

let failures = 0;

function fail(msg: string) {
  failures += 1;
  console.error('FAIL:', msg);
}

function check(
  name: string,
  plan: ChatAutomationPlan,
  expect: Partial<{
    source: ChatAutomationPlan['source'];
    kind: ChatAutomationPlan['execution']['kind'];
    intentKind: ChatAutomationPlan['intent']['kind'];
    routeId: ChatAutomationPlan['execution']['routeId'];
    risk: ChatAutomationPlan['risk'];
    approvalRequired: boolean;
    minConfidence: number;
  }>,
) {
  const actual = {
    source: plan.source,
    kind: plan.execution.kind,
    intentKind: plan.intent.kind,
    routeId: plan.execution.routeId,
    risk: plan.risk,
    approvalRequired: plan.approval.required,
    confidence: plan.confidence,
  };
  const errs: string[] = [];
  if (expect.source !== undefined && expect.source !== actual.source)
    errs.push(`source: expected ${expect.source}, got ${actual.source}`);
  if (expect.kind !== undefined && expect.kind !== actual.kind)
    errs.push(`kind: expected ${expect.kind}, got ${actual.kind}`);
  if (expect.intentKind !== undefined && expect.intentKind !== actual.intentKind)
    errs.push(`intent.kind: expected ${expect.intentKind}, got ${actual.intentKind}`);
  if (expect.routeId !== undefined && expect.routeId !== actual.routeId)
    errs.push(`routeId: expected ${expect.routeId}, got ${actual.routeId}`);
  if (expect.risk !== undefined && expect.risk !== actual.risk)
    errs.push(`risk: expected ${expect.risk}, got ${actual.risk}`);
  if (expect.approvalRequired !== undefined && expect.approvalRequired !== actual.approvalRequired)
    errs.push(`approval.required: expected ${expect.approvalRequired}, got ${actual.approvalRequired}`);
  if (expect.minConfidence !== undefined && actual.confidence < expect.minConfidence)
    errs.push(`confidence: expected >=${expect.minConfidence}, got ${actual.confidence}`);
  if (errs.length) {
    fail(`${name}\n    ${errs.join('\n    ')}`);
  } else {
    console.log(`pass: ${name}`);
  }
}

// ─── Slash-command routing ─────────────────────────────────────────────────

check(
  'slash:/help routes to help command handler',
  buildChatAutomationPlan({ message: '/help' }),
  { source: 'slash', kind: 'run_command_handler', intentKind: 'slash_command', routeId: 'help', minConfidence: 0.9 },
);

check(
  'slash:/browser routes to browser plan with approval',
  buildChatAutomationPlan({ message: '/browser go buy a coffee' }),
  { source: 'slash', kind: 'run_browser_plan', routeId: 'browser', risk: 'review', approvalRequired: true },
);

check(
  'slash:/build-page routes to build discovery (registry command is /build-page)',
  buildChatAutomationPlan({ message: '/build-page landing page for my club' }),
  { source: 'slash', kind: 'run_build_discovery', routeId: 'build_page' },
);

// Unknown slash still classifies as slash — lowest confidence.
check(
  'unknown slash defaults to help handler',
  buildChatAutomationPlan({ message: '/totallynotarealcommand' }),
  { source: 'slash', kind: 'run_command_handler', intentKind: 'slash_command' },
);

// ─── Quick-action routing ──────────────────────────────────────────────────

check(
  'quick_action:__COMPUTER_USE__ opens modal through browser route',
  buildChatAutomationPlan({ message: '', quickActionText: '__COMPUTER_USE__' }),
  { source: 'quick_action', kind: 'open_modal', routeId: 'browser' },
);

check(
  'quick_action:__SPAWN_AGENT__ opens a modal (no route)',
  buildChatAutomationPlan({ message: '', quickActionText: '__SPAWN_AGENT__' }),
  { source: 'quick_action', kind: 'open_modal', routeId: null },
);

// ─── Conversational intents ────────────────────────────────────────────────

check(
  'conversational:wordpress publish → external side effect',
  buildChatAutomationPlan({ message: 'Publish the homepage update to WordPress' }),
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'wordpress', risk: 'external_side_effect', approvalRequired: true },
);

check(
  'conversational:create task → mission route',
  buildChatAutomationPlan({ message: 'Create a task to review the invoice' }),
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'mission' },
);

check(
  'conversational:remember → memory route',
  buildChatAutomationPlan({ message: 'Remember that Chris prefers Go' }),
  { source: 'conversational_intent', routeId: 'memory' },
);

check(
  'conversational:generate image → hf_tools',
  buildChatAutomationPlan({ message: 'Generate an image of a neon swan' }),
  { source: 'conversational_intent', routeId: 'hf_tools' },
);

// ─── Natural-language command rewrite ──────────────────────────────────────
// (These fall through to inferChatCommandExecution; exact route depends on
// the registry so we keep assertions loose.)

check(
  'natural language "show mission status" routes to a command',
  buildChatAutomationPlan({ message: 'show mission status' }),
  { source: 'natural_language', kind: 'run_command_handler' },
);

// ─── Build heuristic ───────────────────────────────────────────────────────

check(
  'buildish phrasing → build discovery',
  buildChatAutomationPlan({ message: 'build me a landing page for recruits' }),
  { kind: 'run_build_discovery', routeId: 'build_page' },
);

// ─── Plain chat fallbacks ──────────────────────────────────────────────────

check(
  'plain chat with no mode → run_plain_chat (fallback to model)',
  buildChatAutomationPlan({ message: 'hello there' }),
  { source: 'plain_chat', kind: 'run_plain_chat' },
);

check(
  'plain chat with OpenSwan mode pinned → run_openswan',
  buildChatAutomationPlan({ message: 'what do we know about the outage?', selectedMode: 'review' }),
  { source: 'plain_chat', kind: 'run_openswan' },
);

check(
  'browserbase data retrieval → computer task',
  buildChatAutomationPlan({ message: 'Extract product names, prices, and availability from https://example.com/catalog as JSON' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', minConfidence: 0.7 },
);

check(
  'stagehand browser workflow → computer task',
  buildChatAutomationPlan({ message: 'Use Stagehand to open https://example.com and click the docs link' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', minConfidence: 0.7 },
);

check(
  'browserbase form submission → computer task with review risk',
  buildChatAutomationPlan({ message: 'Complete the application form at https://example.com/apply and submit it after I approve' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

// ─── Summary ───────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} planner smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll planner smoke cases passed.');
