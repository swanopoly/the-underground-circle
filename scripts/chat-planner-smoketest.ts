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

import { buildChatAutomationPlan, summarisePlanForTelemetry, type ChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { formatChatFailureRecoveryOptionSelection } from '../src/lib/chatFailureRecovery';
import { reconstructClarificationAnswer } from '../src/lib/chatGapFill';
import { extractDirectLocalImageFormatConversionTask } from '../src/lib/computerTaskPlanner';
import { isDecisionRelevantAmbiguity, describeClarificationValue } from '../src/lib/clarificationGate';
// C2 classify-once cutover: the legacy detector is imported ONLY to prove the
// planner is now a superset — every phrasing the legacy router catches, the
// planner-first path must also catch (so ChatTab can stop re-classifying).
import { detectConversationalIntent } from '../src/lib/conversationalRouter';

let failures = 0;
const PHOTOSHOP_SCREENSHOT_RENAME_REQUEST = 'open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png';

function fail(msg: string) {
  failures += 1;
  console.error('FAIL:', msg);
}

function pass(msg: string) {
  console.log(`pass: ${msg}`);
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
    pipelineId: string;
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
    pipelineId: plan.pipeline?.id || null,
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
  if (expect.pipelineId !== undefined && expect.pipelineId !== actual.pipelineId)
    errs.push(`pipelineId: expected ${expect.pipelineId}, got ${actual.pipelineId}`);
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

// C1/R6 pre-cutover fix: listing posts is read-only — wordpress route, but no
// external_side_effect risk and no approval gate.
check(
  'conversational:wordpress list → read-only, no approval',
  buildChatAutomationPlan({ message: 'Show my WordPress posts' }),
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'wordpress', risk: 'safe', approvalRequired: false },
);

check(
  'conversational:wordpress list pages in any order → read-only, no approval',
  buildChatAutomationPlan({ message: 'List pages in WordPress' }),
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'wordpress', risk: 'safe', approvalRequired: false },
);
const wordpressPagesPlan = buildChatAutomationPlan({ message: 'List pages in WordPress' });
if (wordpressPagesPlan.intent.kind === 'conversational_action' && wordpressPagesPlan.intent.intent.type === 'wordpress_list' && wordpressPagesPlan.intent.intent.target === 'pages') {
  pass('conversational:wordpress list pages preserves page target');
} else {
  fail('conversational:wordpress list pages should preserve target=pages');
}

const wordpressSchedulePlan = buildChatAutomationPlan({ message: 'Schedule a WordPress post about launch recap for 2026-07-01' });
check(
  'conversational:wordpress schedule with date → external side effect',
  wordpressSchedulePlan,
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'wordpress', risk: 'external_side_effect', approvalRequired: true },
);
if (wordpressSchedulePlan.intent.kind === 'conversational_action'
  && wordpressSchedulePlan.intent.intent.type === 'wordpress_schedule'
  && wordpressSchedulePlan.intent.intent.date === '2026-07-01'
  && wordpressSchedulePlan.intent.intent.title === 'launch recap') {
  pass('conversational:wordpress schedule preserves date and title');
} else {
  fail('conversational:wordpress schedule should preserve date=2026-07-01 and title="launch recap"');
}

check(
  'conversational:create task → mission route',
  buildChatAutomationPlan({ message: 'Create a task to review the invoice' }),
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'mission' },
);

const officeAgentPlan = buildChatAutomationPlan({
  message: 'Create an agent named Scout with Opus and add it to the task we just made',
});
check(
  'conversational:office agent task → mission route',
  officeAgentPlan,
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'mission' },
);
if (officeAgentPlan.intent.kind === 'conversational_action' && officeAgentPlan.intent.intent.type === 'office_agent_task') {
  const officeAgentIntent = officeAgentPlan.intent.intent;
  if (officeAgentIntent.agentName === 'Scout') pass('conversational:office agent task extracts agent name');
  else fail(`conversational:office agent task extracts agent name\n    expected Scout, got ${officeAgentIntent.agentName}`);
  if (officeAgentIntent.modelName === 'claude-opus-4-8') pass('conversational:office agent task extracts requested model');
  else fail(`conversational:office agent task extracts requested model\n    expected claude-opus-4-8, got ${officeAgentIntent.modelName}`);
  if (officeAgentIntent.taskTarget === 'latest_user_task') pass('conversational:office agent task targets latest user task');
  else fail(`conversational:office agent task targets latest user task\n    expected latest_user_task, got ${officeAgentIntent.taskTarget}`);
} else {
  fail('conversational:office agent task carries office_agent_task intent');
}

// ─── C2 classify-once cutover: planner now catches what only legacy caught ──
// These phrasings used to be detected ONLY by conversationalRouter's
// detectConversationalIntent (the second classification ChatTab ran). After
// porting the "work item" noun and the looser office-agent triggers into the
// planner, the planner-first path routes them itself. Each case both (a) checks
// the planner classifies it, and (b) asserts the legacy detector agreed — i.e.
// the planner is a superset, so dropping the re-classification loses nothing.

function plannerIntentType(message: string): string | null {
  const plan = buildChatAutomationPlan({ message });
  return plan.intent.kind === 'conversational_action' ? plan.intent.intent.type : null;
}

// (a) "work item" phrasing → create_task (planner previously returned none for these).
for (const workItemMessage of [
  'make a work item for reviewing the invoice',
  'create a work item for the launch checklist',
  'add a work item to review the landing page',
]) {
  const legacyType = detectConversationalIntent(workItemMessage).type;
  if (legacyType !== 'create_task') {
    fail(`ported create_task: legacy detector should classify "${workItemMessage}" as create_task, got ${legacyType}`);
  } else if (plannerIntentType(workItemMessage) !== 'create_task') {
    fail(`ported create_task: planner must now classify "${workItemMessage}" as create_task, got ${plannerIntentType(workItemMessage)}`);
  } else {
    pass(`ported create_task (planner superset): "${workItemMessage}"`);
  }
  check(
    `ported create_task routes to mission: "${workItemMessage}"`,
    buildChatAutomationPlan({ message: workItemMessage }),
    { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'mission' },
  );
}

// (b) looser office-agent phrasings → office_agent_task.
//   - "spin me up …" (planner previously only knew "spin up")
//   - "the agent called X, add it to the latest task" (agent+called/named with
//     no creation verb — matched by legacy's 2nd OFFICE_AGENT pattern only)
for (const officeCase of [
  { message: 'spin me up an agent called Scout and add it to the task we just made', agentName: 'Scout', taskTarget: 'latest_user_task' as const },
  { message: 'the agent called Pixel Pro, add it to the latest task', agentName: 'Pixel', taskTarget: 'latest_circle_task' as const },
  { message: 'make an agent called Nova and attach it to the latest task', agentName: 'Nova', taskTarget: 'latest_circle_task' as const },
]) {
  const legacyType = detectConversationalIntent(officeCase.message).type;
  if (legacyType !== 'office_agent_task') {
    fail(`ported office_agent_task: legacy detector should classify "${officeCase.message}" as office_agent_task, got ${legacyType}`);
  }
  const plan = buildChatAutomationPlan({ message: officeCase.message });
  check(
    `ported office_agent_task routes to mission: "${officeCase.message}"`,
    plan,
    { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'mission' },
  );
  if (plan.intent.kind === 'conversational_action' && plan.intent.intent.type === 'office_agent_task') {
    const intent = plan.intent.intent;
    if (intent.agentName === officeCase.agentName && intent.taskTarget === officeCase.taskTarget) {
      pass(`ported office_agent_task (planner superset): "${officeCase.message}"`);
    } else {
      fail(`ported office_agent_task: "${officeCase.message}" expected agent=${officeCase.agentName}/target=${officeCase.taskTarget}, got agent=${intent.agentName}/target=${intent.taskTarget}`);
    }
  } else {
    fail(`ported office_agent_task: "${officeCase.message}" must carry an office_agent_task conversational intent`);
  }
}

// Guardrail: the widened triggers must NOT capture plain chat / bare briefs.
// (novice-persona + simple-chat-task-guardrails cover the broader matrix; this
// is a focused anchor next to the ported cases.)
for (const plainMessage of [
  'Teach me Supabase RLS and make a quiz',
  'what can this app do?',
]) {
  const type = plannerIntentType(plainMessage);
  if (type === 'create_task' || type === 'office_agent_task') {
    fail(`ported-widening guardrail: "${plainMessage}" must not be captured as ${type}`);
  } else {
    pass(`ported-widening guardrail: "${plainMessage}" stays out of task/office capture`);
  }
}

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
  'Codex asset acquisition → computer task',
  buildChatAutomationPlan({ message: 'Have the attached Codex agent download whatever assets it needs to finish the website task' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', approvalRequired: true, minConfidence: 0.8 },
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

check(
  'hybrid browser local file upload → computer task',
  buildChatAutomationPlan({ message: 'Upload the image from my Desktop to Shopify product page after I approve' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'external_side_effect', approvalRequired: true, minConfidence: 0.8 },
);

check(
  'hybrid browser local download/export → computer task',
  buildChatAutomationPlan({ message: 'Download the orders CSV from Shopify and save it to Downloads' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.8 },
);

check(
  'wordpress media upload with local file → computer task',
  buildChatAutomationPlan({ message: 'Open WordPress media library and upload logo.png from Desktop' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'external_side_effect', approvalRequired: true, minConfidence: 0.8 },
);
const wordpressMediaPlan = buildChatAutomationPlan({ message: 'Open WordPress media library and upload logo.png from Desktop' });
if (wordpressMediaPlan.computerRequestRoute?.appStrategy?.label !== 'WordPress Media/Admin File Transfer Workflow') {
  fail(`wordpress media upload should expose WordPress media/admin strategy, got ${wordpressMediaPlan.computerRequestRoute?.appStrategy?.label || 'none'}`);
} else if (!wordpressMediaPlan.computerRequestRoute?.recommendedTools.includes('wp.upload_media')) {
  fail('wordpress media upload should recommend wp.upload_media before browser fallback');
} else {
  pass('wordpress media upload exposes WordPress media/admin strategy metadata');
}

check(
  'Dealer Inspire DI slide upload/create → computer task',
  buildChatAutomationPlan({ message: 'Upload banner.jpg and create a Dealer Inspire DI Slide, assign it to StellantisUS-1920x600, and set expiration_date to June 30 after approval' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'external_side_effect', approvalRequired: true, minConfidence: 0.8 },
);
const dealerInspirePlan = buildChatAutomationPlan({ message: 'Upload banner.jpg and create a Dealer Inspire DI Slide, assign it to StellantisUS-1920x600, and set expiration_date to June 30 after approval' });
if (!dealerInspirePlan.computerRequestRoute?.recommendedTools.includes('wp.create_slide')) {
  fail('Dealer Inspire DI slide upload/create should recommend wp.create_slide');
} else if (!dealerInspirePlan.computerRequestRoute?.recommendedTools.includes('browser.wp_admin_source_intelligence')) {
  fail('Dealer Inspire DI slide upload/create should recommend browser.wp_admin_source_intelligence');
} else if (!dealerInspirePlan.computerRequestRoute?.actionItems?.some((item) => item.id === 'inspect-wordpress-admin-source' && item.tool === 'browser.wp_admin_source_intelligence')) {
  fail('Dealer Inspire DI slide upload/create should inspect WordPress admin source facts with browser.wp_admin_source_intelligence');
} else {
  pass('Dealer Inspire DI slide upload/create exposes DI-aware source-intelligence route metadata');
}

const dealerInspireUpdatePlan = buildChatAutomationPlan({ message: 'Update the Dealer Inspire DI Slide Promaster expiration_date in Quick Edit after approval' });
if (!dealerInspireUpdatePlan.computerRequestRoute?.recommendedTools.includes('wp.update_post')) {
  fail('Dealer Inspire DI slide update should recommend wp.update_post');
} else if (!dealerInspireUpdatePlan.computerRequestRoute?.recommendedTools.includes('browser.wp_admin_source_intelligence')) {
  fail('Dealer Inspire DI slide update should recommend browser.wp_admin_source_intelligence');
} else {
  pass('Dealer Inspire DI slide update exposes wp.update_post plus source intelligence');
}

for (const input of [
  'edit a page in wp-admin',
  'install plugin in wp-admin',
  'install a WordPress plugin after approval',
  'change WordPress settings after approval',
  'Quick Edit Dealer Inspire DI Slide Promaster expiration_date in wp-admin after approval',
]) {
  const plan = buildChatAutomationPlan({ message: input });
  check(
    `wordpress admin mutation → browser computer task: ${input}`,
    plan,
    { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'external_side_effect', approvalRequired: true, minConfidence: 0.8 },
  );
  if (plan.computerRequestRoute?.appStrategy?.label !== 'WordPress Admin Browser Workflow') {
    fail(`${input} should expose WordPress Admin Browser Workflow, got ${plan.computerRequestRoute?.appStrategy?.label || 'none'}`);
  } else if (!plan.computerRequestRoute?.actionItems?.some((item) => item.id === 'pause-for-wordpress-approval')) {
    fail(`${input} should include a WordPress approval action item`);
  } else {
    pass(`wordpress admin mutation exposes approval-ready action items: ${input}`);
  }
}

{
  const plan = buildChatAutomationPlan({ message: 'log into wp-admin and edit a page' });
  check(
    'wordpress admin login/edit → browser computer task',
    plan,
    { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'external_side_effect', approvalRequired: true, minConfidence: 0.8 },
  );
  if (plan.computerRequestRoute?.appStrategy?.label !== 'WordPress Admin Browser Workflow') {
    fail('wordpress admin login/edit should expose WordPress Admin Browser Workflow');
  } else {
    pass('wordpress admin login/edit exposes WordPress strategy metadata');
  }
}

check(
  'local file search → computer task with session grant',
  buildChatAutomationPlan({ message: 'Search files in my Downloads folder for invoice' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'safe', minConfidence: 0.7 },
);

check(
  'local file rename → computer task with write review',
  buildChatAutomationPlan({ message: 'can you change the file landscaping-img.png thats on the desktop to andscaping-img-1.png' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'local app launch → computer task/app adapter, not plain model chat',
  buildChatAutomationPlan({ message: 'open Photoshop' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
);

check(
  'local app follow-up task → computer task/app adapter',
  buildChatAutomationPlan({ message: 'open Photoshop and crop this image' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'local app plus creative generation stays deterministic computer task',
  buildChatAutomationPlan({ message: 'open Photoshop then create an image from the clipboard' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);
const localPhotoshopPlan = buildChatAutomationPlan({ message: 'open Photoshop then create an image from the clipboard' });
if (localPhotoshopPlan.computerRequestRoute?.appStrategy?.id !== 'creative_layout_control') {
  fail('local Photoshop app task exposes creative_layout_control computer request route metadata');
} else {
  console.log('pass: local Photoshop app task exposes computer route metadata');
}

const exactPhotoshopPlan = buildChatAutomationPlan({ message: 'Open Photoshop and start a new project 600 x 600' });
check(
  'exact Photoshop blank-document ask stays one atomic computer task',
  exactPhotoshopPlan,
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
);
const exactPhotoshopPlanTools = exactPhotoshopPlan.computerRequestRoute?.actionItems.map((item) => item.tool) || [];
const expectedExactPhotoshopPlanTools = [
  'desktop.photoshop_document_status',
  'desktop.launch_app',
  'desktop.photoshop_document_status',
  'desktop.photoshop_create_document',
  'desktop.photoshop_document_status',
];
if (JSON.stringify(exactPhotoshopPlanTools) !== JSON.stringify(expectedExactPhotoshopPlanTools)) {
  fail(`exact Photoshop planner sequence expected ${expectedExactPhotoshopPlanTools.join(' -> ')}, got ${exactPhotoshopPlanTools.join(' -> ')}`);
} else if (exactPhotoshopPlan.notes.some((note) => /parsed steps|count 2 asks|on #1 now/i.test(note))) {
  fail(`exact Photoshop planner must not split the request into asks: ${exactPhotoshopPlan.notes.join(' | ')}`);
} else if (!exactPhotoshopPlan.notes.some((note) => /Compiled one atomic desktop program/i.test(note))) {
  fail('exact Photoshop planner did not record atomic compiler ownership');
} else if (exactPhotoshopPlan.approval.required || exactPhotoshopPlan.approval.reason) {
  fail(`exact Photoshop planner must not require redundant approval, got ${exactPhotoshopPlan.approval.reason || 'required'}`);
} else if (exactPhotoshopPlan.computerRequestRoute?.actionItems.some((item) => item.requiresApproval)) {
  fail('exact Photoshop planner must not add a second per-tool approval');
} else {
  pass('exact Photoshop planner bypasses parsed multi-ask splitting and uses one direct-request-authorized program');
}

check(
  'local Photoshop save-as filename stays deterministic computer task',
  buildChatAutomationPlan({ message: 'Open Photoshop and save the image as test-it.jpg' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', approvalRequired: true, minConfidence: 0.7 },
);

const pearsonPngPlan = buildChatAutomationPlan({ message: 'on the desktop open pearsoncdjr-img in photoshop and save it as a png' });
const pearsonPngConversion = extractDirectLocalImageFormatConversionTask('on the desktop open pearsoncdjr-img in photoshop and save it as a png');
if (pearsonPngConversion?.source !== 'pearsoncdjr-img' || pearsonPngConversion.format !== 'png') {
  fail(`local Photoshop simple image format conversion parser returned ${JSON.stringify(pearsonPngConversion)}`);
} else {
  console.log('pass: local Photoshop simple image format conversion parser extracts source and target format');
}
check(
  'local Photoshop simple image format conversion uses direct conversion path',
  pearsonPngPlan,
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
);
if (pearsonPngPlan.computerRequestRoute?.appStrategy?.id !== 'file_readonly') {
  fail('local Photoshop simple image format conversion uses local-file conversion strategy');
} else {
  console.log('pass: local Photoshop simple image format conversion uses local-file conversion strategy');
}
if (pearsonPngPlan.computerRequestRoute?.designExecutionPipeline) {
  fail('local Photoshop simple image format conversion must not use layered creative design pipeline');
} else {
  console.log('pass: local Photoshop simple image format conversion skips layered creative design pipeline');
}
if (!pearsonPngPlan.computerRequestRoute?.recommendedTools.includes('desktop.convert_image')) {
  fail('local Photoshop simple image format conversion recommends desktop.convert_image');
} else {
  console.log('pass: local Photoshop simple image format conversion recommends desktop.convert_image');
}
if (!pearsonPngPlan.computerRequestRoute?.actionItems?.some((item) => item.tool === 'desktop.convert_image')) {
  fail('local Photoshop simple image format conversion carries executable conversion action item');
} else {
  console.log('pass: local Photoshop simple image format conversion carries executable conversion action item');
}

const desktopGeminiJpgMessage = 'open Gemini_Generated_Image_lppqo8lppqo8lppq.png from the desktop and make it a jpg';
const desktopGeminiJpgPlan = buildChatAutomationPlan({ message: desktopGeminiJpgMessage });
const desktopGeminiJpgConversion = extractDirectLocalImageFormatConversionTask(desktopGeminiJpgMessage);
if (desktopGeminiJpgConversion?.source !== 'Gemini_Generated_Image_lppqo8lppqo8lppq.png' || desktopGeminiJpgConversion.format !== 'jpg') {
  fail(`desktop filename pronoun image conversion parser returned ${JSON.stringify(desktopGeminiJpgConversion)}`);
} else {
  console.log('pass: desktop filename pronoun image conversion parser extracts source and JPG target format');
}
check(
  'desktop filename pronoun image conversion uses direct conversion path',
  desktopGeminiJpgPlan,
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
);
if (!desktopGeminiJpgPlan.computerRequestRoute?.recommendedTools.includes('desktop.convert_image')) {
  fail('desktop filename pronoun image conversion recommends desktop.convert_image');
} else {
  console.log('pass: desktop filename pronoun image conversion recommends desktop.convert_image');
}
if (desktopGeminiJpgPlan.computerRequestRoute?.actionItems?.[0]?.tool !== 'desktop.file_search') {
  fail('desktop filename pronoun image conversion resolves source before conversion');
} else {
  console.log('pass: desktop filename pronoun image conversion resolves source before conversion');
}
if (!desktopGeminiJpgPlan.computerRequestRoute?.actionItems?.some((item) => item.tool === 'desktop.convert_image')) {
  fail('desktop filename pronoun image conversion carries executable conversion action item');
} else {
  console.log('pass: desktop filename pronoun image conversion carries executable conversion action item');
}

const photoshopScreenshotRenamePlan = buildChatAutomationPlan({ message: PHOTOSHOP_SCREENSHOT_RENAME_REQUEST });
const photoshopScreenshotRenameConversion = extractDirectLocalImageFormatConversionTask(PHOTOSHOP_SCREENSHOT_RENAME_REQUEST);
if (photoshopScreenshotRenameConversion !== null) {
  fail(`local Photoshop screenshot open/rename/export should not use format-only conversion parser, got ${JSON.stringify(photoshopScreenshotRenameConversion)}`);
} else {
  console.log('pass: local Photoshop screenshot open/rename/export skips format-only conversion parser');
}
check(
  'local Photoshop screenshot open/rename/export stays deterministic computer task',
  photoshopScreenshotRenamePlan,
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', approvalRequired: true, minConfidence: 0.7 },
);
if (photoshopScreenshotRenamePlan.computerRequestRoute?.appStrategy?.id !== 'creative_layout_control') {
  fail('local Photoshop screenshot open/rename/export uses creative layout strategy');
} else {
  console.log('pass: local Photoshop screenshot open/rename/export uses creative layout strategy');
}
const photoshopScreenshotCapabilities = photoshopScreenshotRenamePlan.computerRequestRoute?.computerPreview.requiredCapabilities || [];
if (!photoshopScreenshotCapabilities.includes('file_write')) {
  fail('local Photoshop screenshot open/rename/export requires write-scoped local file capability before proof export');
} else {
  console.log('pass: local Photoshop screenshot open/rename/export prepares write-scoped local file capability');
}
if (photoshopScreenshotRenamePlan.computerRequestRoute?.recommendedTools.includes('desktop.convert_image')) {
  fail('local Photoshop screenshot open/rename/export must not recommend desktop.convert_image until output-name conversion is supported');
} else {
  console.log('pass: local Photoshop screenshot open/rename/export avoids desktop.convert_image shortcut');
}

check(
  'local InDesign PDF export stays deterministic computer task',
  buildChatAutomationPlan({ message: 'Open InDesign and export high quality pdf as brochure.pdf' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'standalone new-tab browser macro → computer task',
  buildChatAutomationPlan({ message: 'open example.com in a new tab in Chrome' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'copy current browser URL macro → computer task',
  buildChatAutomationPlan({ message: 'copy current URL in Chrome' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'gmail inbox macro → deterministic computer task',
  buildChatAutomationPlan({ message: 'Open Gmail inbox' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'gmail send macro → external-side-effect computer task',
  buildChatAutomationPlan({ message: 'Send Gmail to chris@example.com subject Test body Hello' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'external_side_effect', approvalRequired: true, minConfidence: 0.7 },
);

check(
  'wordpress admin macro → deterministic computer task',
  buildChatAutomationPlan({ message: 'Open WordPress posts for example.com' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'generic local app launch → computer task/app adapter',
  buildChatAutomationPlan({ message: 'open Affinity Designer' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
);

check(
  'unfamiliar app task → computer task/app adapter, not plain model chat',
  buildChatAutomationPlan({ message: 'Use Ableton Live to create a four-bar drum loop and export it after approval' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);
const unfamiliarAppPlan = buildChatAutomationPlan({ message: 'Use Ableton Live to create a four-bar drum loop and export it after approval' });
if (unfamiliarAppPlan.computerRequestRoute?.appStrategy?.id !== 'universal_app_control') {
  fail('unfamiliar app task exposes universal_app_control computer request route metadata');
} else {
  console.log('pass: unfamiliar app task exposes universal app route metadata');
}

check(
  'semantic app click → computer task/app adapter',
  buildChatAutomationPlan({ message: 'click the Save button in Photoshop' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'native menu click → computer task/app adapter',
  buildChatAutomationPlan({ message: 'click File > Save As in Photoshop' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'desktop text entry → computer task/app adapter',
  buildChatAutomationPlan({ message: 'type "hello world" in TextEdit' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'desktop paste text → computer task/app adapter',
  buildChatAutomationPlan({ message: 'paste "hello world" in TextEdit' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'desktop named field fill → computer task/app adapter',
  buildChatAutomationPlan({ message: 'fill the email field with test@example.com in TextEdit' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'desktop key combo → computer task/app adapter',
  buildChatAutomationPlan({ message: 'press Command S in Photoshop' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'coordinate desktop click → computer task/app adapter',
  buildChatAutomationPlan({ message: 'right double click at 400,500' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'held desktop mouse → computer task/app adapter',
  buildChatAutomationPlan({ message: 'hold mouse down at 400,500' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

check(
  'sequenced desktop app instruction → computer task/app adapter',
  buildChatAutomationPlan({ message: 'open TextEdit then type "hello" then press Command S' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'review', minConfidence: 0.7 },
);

for (const [label, message, expectedSurface] of [
  ['Mail visible-state read', 'Open Mail and read the subject of the selected message', 'desktop_app'],
  ['Slack visible-state read', 'Open Slack and read the latest visible message in general', 'desktop_app'],
  ['VLC visible-state read', 'Use VLC to read the current track title', 'desktop_app'],
  ['R visible-state read', 'Open R and read the active console prompt', 'desktop_app'],
  ['Preview visible-state read', 'Open Preview and report the visible PDF page number', 'local_file'],
  ['Finder visible-state read', 'Open Finder and show the path of the selected folder in Documents', 'local_file'],
] as const) {
  const plan = buildChatAutomationPlan({ message });
  check(
    `${label} uses the canonical approval-free native/local plan`,
    plan,
    { source: 'plain_chat', kind: 'run_computer_task', routeId: null, risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
  );
  if (
    plan.computerRequestRoute?.kind !== expectedSurface
    || plan.computerRequestRoute.recommendedTools.some((tool) => /^(?:browser|browserbase)\./i.test(tool))
  ) {
    fail(`${label} expected ${expectedSurface} with no browser tools, got ${plan.computerRequestRoute?.kind || 'none'}`);
  } else {
    pass(`${label} keeps ${expectedSurface} ownership and never pulls the browser forward`);
  }
}

// ─── User-task pipeline routing ────────────────────────────────────────────

check(
  'pipeline:website platform admin routes to browser computer task',
  buildChatAutomationPlan({ message: 'Log into Shopify and update this product page after I approve' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'external_side_effect', approvalRequired: true, pipelineId: 'website_platform_admin', minConfidence: 0.7 },
);

check(
  'pipeline:bridge troubleshooting routes to OpenSwan diagnostics',
  buildChatAutomationPlan({ message: 'The desktop/browser_tabs endpoint returns 404 in the local bridge' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'safe', pipelineId: 'bridge_troubleshooting', minConfidence: 0.7 },
);

check(
  'pipeline:custom API action routes to OpenSwan tools',
  buildChatAutomationPlan({ message: 'Create a custom API action that calls POST /orders from the marketplace connector' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'integrations_models', minConfidence: 0.8 },
);

check(
  'connected failure recovery routes to OpenSwan with approval',
  buildChatAutomationPlan({ message: 'The Photoshop task failed with selector timeout, have the connected agent figure out why and fix it' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', approvalRequired: true, minConfidence: 0.8 },
);

const selectedRecoveryOptionPlan = buildChatAutomationPlan({
  message: formatChatFailureRecoveryOptionSelection({
    id: 'retry_with_fresh_evidence',
    label: 'Retry after fresh evidence',
    detail: 'Re-observe the browser DOM and screenshot before retrying the failed click.',
    actor: 'openswan',
    recommended: true,
    source: 'checkpoint_guard',
  }, {
    messageId: 'bot-failure-1',
    runId: 'run-1',
    sourceSurface: 'main_chat_computer_task',
    failureExcerpt: 'Computer task failed because the browser DOM evidence was stale.',
  }),
});
check(
  'selected recovery option routes deterministically to recovery work',
  selectedRecoveryOptionPlan,
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', approvalRequired: true, minConfidence: 0.9 },
);
if (!selectedRecoveryOptionPlan.notes.some((note) => note.includes('retry_with_fresh_evidence'))) {
  fail('selected recovery option preserves the option id in planner notes');
} else {
  console.log('pass: selected recovery option preserves option id in planner notes');
}
if (!selectedRecoveryOptionPlan.notes.some((note) => note.includes('bot-failure-1'))) {
  fail('selected recovery option preserves failed message id in planner notes');
} else {
  console.log('pass: selected recovery option preserves failed message id in planner notes');
}
if (!selectedRecoveryOptionPlan.notes.some((note) => note.includes('run-1'))) {
  fail('selected recovery option preserves run id in planner notes');
} else {
  console.log('pass: selected recovery option preserves run id in planner notes');
}
if (selectedRecoveryOptionPlan.recoveryPolicy?.action !== 'retry_with_fresh_evidence') {
  fail('selected recovery option exposes typed fresh-evidence recovery policy');
} else {
  console.log('pass: selected recovery option exposes typed recovery policy');
}
if (selectedRecoveryOptionPlan.recoveryPolicy?.requiresFreshEvidence !== true) {
  fail('selected recovery option policy requires fresh evidence');
} else {
  console.log('pass: selected recovery option policy requires fresh evidence');
}
if (selectedRecoveryOptionPlan.recoveryPolicy?.maxAttempts !== 1) {
  fail('selected recovery option policy caps automated retry attempts');
} else {
  console.log('pass: selected recovery option policy caps retry attempts');
}
if (!selectedRecoveryOptionPlan.recoveryExecutionPlan?.userSummary.includes('fresh evidence')) {
  fail('selected recovery option exposes user-safe execution summary');
} else {
  console.log('pass: selected recovery option exposes user-safe execution summary');
}
if (!selectedRecoveryOptionPlan.recoveryExecutionPlan?.stopConditions.some((condition) => condition.includes('missing or stale'))) {
  fail('selected recovery option exposes stop conditions');
} else {
  console.log('pass: selected recovery option exposes stop conditions');
}
const selectedRecoveryTelemetry = summarisePlanForTelemetry(selectedRecoveryOptionPlan);
if ((selectedRecoveryTelemetry.recoveryPolicy as any)?.action !== 'retry_with_fresh_evidence') {
  fail('selected recovery telemetry includes recovery policy action');
} else {
  console.log('pass: selected recovery telemetry includes policy action');
}
if (!String((selectedRecoveryTelemetry.recoveryExecutionPlan as any)?.userSummary || '').includes('fresh evidence')) {
  fail('selected recovery telemetry includes execution plan summary');
} else {
  console.log('pass: selected recovery telemetry includes execution plan summary');
}
if (!Array.isArray((selectedRecoveryTelemetry.recoveryExecutionPlan as any)?.stopConditions)) {
  fail('selected recovery telemetry includes stop conditions');
} else {
  console.log('pass: selected recovery telemetry includes stop conditions');
}

check(
  'pipeline:customer support routes to OpenSwan with review risk',
  buildChatAutomationPlan({ message: 'Triage support tickets and draft replies for angry customers' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'customer_support_crm', minConfidence: 0.7 },
);

check(
  'pipeline:sales outreach routes to OpenSwan with external-side-effect risk',
  buildChatAutomationPlan({ message: 'Find 20 SaaS leads and add them to the CRM with outreach drafts' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', pipelineId: 'sales_leads_outreach', minConfidence: 0.7 },
);

check(
  'pipeline:analytics reporting routes to safe OpenSwan work',
  buildChatAutomationPlan({ message: 'Build a weekly KPI dashboard from conversion metrics' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'safe', pipelineId: 'analytics_reporting', minConfidence: 0.7 },
);

check(
  'pipeline:calendar email routes to external-side-effect OpenSwan work',
  buildChatAutomationPlan({ message: 'Schedule a meeting with the design team and send calendar invites' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', pipelineId: 'meetings_calendar_email', minConfidence: 0.7 },
);

check(
  'pipeline:data import routes to review-gated OpenSwan work',
  buildChatAutomationPlan({ message: 'Import this CSV into Supabase and map the columns' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'data_import_export', minConfidence: 0.7 },
);

check(
  'pipeline:finance billing routes to external-side-effect OpenSwan work',
  buildChatAutomationPlan({ message: 'Create an invoice and reconcile this customer payment' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', pipelineId: 'finance_billing', minConfidence: 0.7 },
);

check(
  'pipeline:document intelligence routes to review-gated OpenSwan work',
  buildChatAutomationPlan({ message: 'Extract the signed date and renewal clause from this contract PDF' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'document_intelligence', minConfidence: 0.7 },
);

check(
  'pipeline:qa testing routes to browser computer task',
  buildChatAutomationPlan({ message: 'Run regression tests on the login flow and capture screenshots' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', pipelineId: 'qa_testing', minConfidence: 0.7 },
);

check(
  'pipeline:it support ops routes to external-side-effect OpenSwan work',
  buildChatAutomationPlan({ message: 'Provision Slack and Jira access for a new teammate' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', pipelineId: 'it_support_ops', minConfidence: 0.7 },
);

check(
  'pipeline:compliance monitoring routes to review-gated OpenSwan work',
  buildChatAutomationPlan({ message: 'Build a SOC 2 evidence checklist for the security audit' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'compliance_monitoring', minConfidence: 0.7 },
);

check(
  'pipeline:hr onboarding routes to mission command handler',
  buildChatAutomationPlan({ message: 'Create a new hire onboarding checklist for next Monday' }),
  { source: 'plain_chat', kind: 'run_command_handler', routeId: 'mission', risk: 'external_side_effect', pipelineId: 'hr_onboarding', minConfidence: 0.7 },
);

check(
  'pipeline:marketing campaigns routes to external-side-effect OpenSwan work',
  buildChatAutomationPlan({ message: 'Plan a newsletter campaign and segment the audience' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', pipelineId: 'marketing_campaigns', minConfidence: 0.7 },
);

check(
  'pipeline:workflow recording routes to review-gated OpenSwan work',
  buildChatAutomationPlan({ message: 'Record this browser workflow and turn it into a reusable automation' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'workflow_recording_replay', minConfidence: 0.7 },
);

check(
  'control panel: repeat automation seed stays an OpenSwan planning turn',
  buildChatAutomationPlan({
    message: 'Turn this into a repeatable automation: draft a WordPress weekly update, preview it, and ask before publishing.',
    selectedMode: 'plan',
  }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
);

check(
  // WI-6: URL-less travel-booking phrasing now routes to the browser runtime
  // (previously a dead-end run_openswan with routeId null). WI-2: the browser
  // booking route is zero-tap — its single pay confirmation fires mid-run at
  // the payment floor, so approvalRequired is false up front.
  'pipeline:travel booking routes to a zero-tap browser computer task (WI-2/WI-6)',
  buildChatAutomationPlan({ message: 'Book a flight to New York next Friday under $500' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'external_side_effect', approvalRequired: false, minConfidence: 0.7 },
);

check(
  'pipeline:procurement routes to external-side-effect OpenSwan work',
  buildChatAutomationPlan({ message: 'Compare vendors and buy five software licenses after approval' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', pipelineId: 'procurement_shopping', minConfidence: 0.7 },
);

check(
  'pipeline:cloud devops routes to review-gated OpenSwan work',
  buildChatAutomationPlan({ message: 'Check AWS logs and rollback the failed deploy after approval' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'cloud_devops', minConfidence: 0.7 },
);

check(
  'pipeline:social community routes to external-side-effect OpenSwan work',
  buildChatAutomationPlan({ message: 'Moderate Discord comments and draft community replies' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', pipelineId: 'social_community', minConfidence: 0.7 },
);

check(
  'pipeline:inbox triage routes to review-gated OpenSwan work',
  buildChatAutomationPlan({ message: 'Summarize unread emails and prioritize Slack alerts' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'inbox_notifications', minConfidence: 0.7 },
);

check(
  'pipeline:learning routes to plain chat',
  buildChatAutomationPlan({ message: 'Teach me Supabase RLS and make a quiz' }),
  { source: 'plain_chat', kind: 'run_plain_chat', routeId: null, risk: 'safe', pipelineId: 'learning_training', minConfidence: 0.7 },
);

check(
  'pipeline:high-stakes advice routes to guarded plain chat',
  buildChatAutomationPlan({ message: 'Should I take this medication if I have chest pain?' }),
  { source: 'plain_chat', kind: 'run_plain_chat', routeId: null, risk: 'review', pipelineId: 'high_stakes_advice', minConfidence: 0.7 },
);

// ─── Underspecified → ask_clarification (Phase 1) ──────────────────────────
// The planner should ASK rather than fabricate a placeholder when a matched
// conversational action has no real content for its required field. Kept
// conservative: well-specified requests must still route normally.

check(
  'underspecified create task → ask_clarification',
  buildChatAutomationPlan({ message: 'create a task' }),
  { kind: 'ask_clarification', risk: 'safe', approvalRequired: false, minConfidence: 0.8 },
);

check(
  'bare make a ticket → ask_clarification',
  buildChatAutomationPlan({ message: 'make a ticket' }),
  { kind: 'ask_clarification' },
);

check(
  'underspecified image request → ask_clarification',
  buildChatAutomationPlan({ message: 'generate an image' }),
  { kind: 'ask_clarification' },
);

// Regression guards: well-specified versions must NOT be diverted to a question.
check(
  'well-specified create task still routes to mission (no clarification)',
  buildChatAutomationPlan({ message: 'Create a task to review the invoice' }),
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'mission' },
);

check(
  'well-specified image still routes to hf_tools (no clarification)',
  buildChatAutomationPlan({ message: 'Generate an image of a neon swan' }),
  { source: 'conversational_intent', routeId: 'hf_tools' },
);

const clarificationPlan = buildChatAutomationPlan({ message: 'create a task' });
if (clarificationPlan.execution.clarification?.missingParams?.length) {
  console.log('pass: ask_clarification plan carries missingParams');
} else {
  fail('ask_clarification plan carries missingParams');
}
if (clarificationPlan.execution.clarification?.question) {
  console.log('pass: ask_clarification plan carries a question');
} else {
  fail('ask_clarification plan carries a question');
}
if ((clarificationPlan.execution.clarification?.examples?.length || 0) > 0) {
  console.log('pass: ask_clarification plan carries example answers');
} else {
  fail('ask_clarification plan carries example answers');
}

// ─── Closing the loop: reconstruct answer → completes without re-asking ─────

function expectReconstruct(name: string, got: string | null, wants: { equals?: string; includes?: string; isNull?: boolean }) {
  if (wants.isNull) {
    if (got === null) console.log(`pass: ${name}`);
    else fail(`${name}: expected null, got ${got}`);
    return;
  }
  if (wants.equals !== undefined) {
    if (got === wants.equals) console.log(`pass: ${name}`);
    else fail(`${name}: expected "${wants.equals}", got "${got}"`);
    return;
  }
  if (wants.includes !== undefined) {
    if (got && got.includes(wants.includes)) console.log(`pass: ${name}`);
    else fail(`${name}: expected to include "${wants.includes}", got "${got}"`);
  }
}

expectReconstruct(
  'reconstruct create_task folds the reply into a deterministic /task command',
  reconstructClarificationAnswer('create_task', 'create a task', 'fix the login bug on mobile'),
  { equals: '/task new fix the login bug on mobile' },
);
expectReconstruct(
  'reconstruct generate_image folds the reply into an image prompt',
  reconstructClarificationAnswer('generate_image', 'generate an image', 'a neon swan over a city'),
  { equals: 'generate an image of a neon swan over a city' },
);
expectReconstruct(
  'reconstruct office_agent_task names the agent',
  reconstructClarificationAnswer('office_agent_task', 'spin up an agent for the task we just made', 'Scout'),
  { includes: 'agent named Scout' },
);
expectReconstruct(
  'reconstruct fallback folds detail into the original ask',
  reconstructClarificationAnswer(null, 'clean up the staging data', 'only the test rows from last week'),
  { equals: 'clean up the staging data — only the test rows from last week' },
);
expectReconstruct(
  'reconstruct returns null for an empty reply',
  reconstructClarificationAnswer('create_task', 'create a task', '   '),
  { isNull: true },
);

// The reconstructed message MUST route normally — never back into a question
// (otherwise the clarification loop would never terminate).
const reconstructedTask = reconstructClarificationAnswer('create_task', 'create a task', 'fix the login bug on mobile')!;
check(
  'reconstructed task routes deterministically to the task handler, not another question',
  buildChatAutomationPlan({ message: reconstructedTask }),
  { source: 'slash', kind: 'run_command_handler', routeId: 'mission' },
);

const reconstructedImage = reconstructClarificationAnswer('generate_image', 'generate an image', 'a neon swan')!;
check(
  'reconstructed image request routes to hf_tools, not another question',
  buildChatAutomationPlan({ message: reconstructedImage }),
  { source: 'conversational_intent', routeId: 'hf_tools' },
);

// ─── Decision-relevance clarification gate (clarificationGate.ts) ───────────
// The gate is the single policy chokepoint the planner consults before asking.
// Research contract: ASK only when a missing param would change the routed
// action/route/approval; NEVER over-ask on fully-specified input; treat
// stylistic/reversible gaps as safe defaults. The matrix below pins both the
// end-to-end planner behaviour and the pure gate's own decisions.

function planClarifies(message: string): boolean {
  return buildChatAutomationPlan({ message }).execution.kind === 'ask_clarification';
}

// (1) Decision-relevant empty slot → the planner ASKS. One row per gated intent.
for (const askCase of [
  { message: 'create a task', label: 'create_task with no subject' },
  { message: 'add a todo', label: 'add a todo with no subject' },
  { message: 'create a ticket', label: 'create a ticket with no subject' },
  { message: 'generate an image', label: 'image with no subject' },
  { message: 'make a picture', label: 'make a picture with no subject' },
  { message: 'schedule a wordpress post', label: 'wordpress schedule with no date' },
  { message: 'post to wordpress', label: 'wordpress publish with no subject' },
]) {
  if (planClarifies(askCase.message)) {
    pass(`decision-relevance ASK: ${askCase.label}`);
  } else {
    fail(`decision-relevance ASK: ${askCase.label} — expected ask_clarification for "${askCase.message}"`);
  }
}

// (2) Fully-specified action → the planner PROCEEDS (never over-asks). This is
// the guard the brief calls out: fully-specified conversational actions that
// used to be at risk of asking must now route through to their action plan.
for (const goCase of [
  { message: 'create a task to ship the newsletter friday', label: 'create_task with subject+date' },
  { message: 'Create a task to review the invoice', label: 'create_task with subject' },
  { message: 'make a ticket to fix the login bug on mobile', label: 'ticket with subject' },
  { message: 'Generate an image of a neon swan over a city at night', label: 'image with rich subject' },
  { message: 'draw a picture of a dragon guarding a castle', label: 'image with subject (draw)' },
  { message: 'Schedule a WordPress post about launch recap for 2026-07-01', label: 'schedule with date+subject' },
  { message: 'draft a wordpress post about our new pricing page and launch recap', label: 'publish with rich subject' },
]) {
  if (!planClarifies(goCase.message)) {
    pass(`over-ask guard PROCEED: ${goCase.label}`);
  } else {
    fail(`over-ask guard PROCEED: ${goCase.label} — "${goCase.message}" must NOT ask`);
  }
}

// (3) The pure gate's decision table (reason codes are stable + telemetry-safe).
type GateRow = { input: Parameters<typeof isDecisionRelevantAmbiguity>[0]; ask: boolean; reason: string; label: string };
for (const row of [
  { input: { message: 'create a task', intentType: 'create_task', missingParams: ['task description'] }, ask: true, reason: 'missing_task_subject', label: 'empty task subject asks' },
  { input: { message: 'create a task to fix login', intentType: 'create_task', missingParams: [] }, ask: false, reason: 'fully_specified', label: 'specified task proceeds' },
  { input: { message: 'assign this to the latest task', intentType: 'office_agent_task', missingParams: ['which agent'] }, ask: true, reason: 'missing_agent_target', label: 'unnamed agent asks' },
  { input: { message: 'post to wordpress', intentType: 'wordpress_publish', missingParams: ['post title', 'post content'] }, ask: true, reason: 'missing_publish_subject', label: 'empty publish subject asks' },
  { input: { message: 'schedule a wordpress post', intentType: 'wordpress_schedule', missingParams: ['publish date'] }, ask: true, reason: 'missing_publish_date', label: 'missing schedule date asks' },
  { input: { message: 'generate an image', intentType: 'generate_image', missingParams: ['image subject'] }, ask: true, reason: 'missing_image_subject', label: 'empty image subject asks' },
  { input: { message: 'generate an image of a red barn', intentType: 'generate_image', missingParams: ['style'] }, ask: false, reason: 'gap_is_stylistic_or_reversible', label: 'stylistic-only image gap proceeds' },
  { input: { message: 'create a task to fix login', intentType: 'create_task', missingParams: ['format'] }, ask: false, reason: 'gap_is_stylistic_or_reversible', label: 'stylistic-only task gap proceeds' },
  { input: { message: 'do the thing', intentType: 'none', missingParams: [] }, ask: false, reason: 'no_actionable_intent', label: 'no intent proceeds' },
  { input: { message: 'clean up the staging data now', missingParams: ['task scope'] }, ask: true, reason: 'missing_action_target', label: 'unresolved mutation target asks' },
] as GateRow[]) {
  const got = isDecisionRelevantAmbiguity(row.input);
  if (got.ask === row.ask && got.reason === row.reason) {
    pass(`gate table: ${row.label}`);
  } else {
    fail(`gate table: ${row.label} — expected {ask:${row.ask},reason:${row.reason}}, got {ask:${got.ask},reason:${got.reason}}`);
  }
}

// (4) describeClarificationValue is bounded, content-free, and branch-aware.
{
  const asked = describeClarificationValue('missing_agent_target');
  if (asked.length > 0 && asked.length <= 120 && /^Asked:/.test(asked)) pass('gate describe: ask rationale bounded + prefixed');
  else fail(`gate describe: ask rationale should be a bounded "Asked:" line, got "${asked}"`);
  const proceeded = describeClarificationValue('gap_is_stylistic_or_reversible');
  if (proceeded.length > 0 && proceeded.length <= 120 && /^Proceeded:/.test(proceeded)) pass('gate describe: proceed rationale bounded + prefixed');
  else fail(`gate describe: proceed rationale should be a bounded "Proceeded:" line, got "${proceeded}"`);
}

// (5) When the planner asks, its notes carry the gate rationale (observability).
{
  const askPlan = buildChatAutomationPlan({ message: 'create a task' });
  if (askPlan.notes.some((note) => note.startsWith('Asked:'))) {
    pass('gate wiring: ask_clarification plan surfaces the gate rationale in notes');
  } else {
    fail(`gate wiring: ask_clarification plan should note the gate rationale, got notes=${JSON.stringify(askPlan.notes)}`);
  }
}

// ─── Summary ───────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} planner smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll planner smoke cases passed.');

// ── P23 routing regressions (found via prompt battery 2026-07-08) ───────────

// Add-to-cart phrasing is web-transactional even with a bare retailer name
// (no TLD) and no book/order/buy verb.
check(
  'add-to-cart with bare retailer routes to the browser runtime',
  buildChatAutomationPlan({ message: 'go to amazon and add a phone charger to my cart' }),
  { kind: 'run_computer_task' },
);
check(
  'add-to-cart without a site still routes to the browser runtime',
  buildChatAutomationPlan({ message: 'add a phone charger to my cart' }),
  { kind: 'run_computer_task' },
);
check(
  'bare-retailer purchase routes to the browser runtime',
  buildChatAutomationPlan({ message: 'buy a phone charger on amazon' }),
  { kind: 'run_computer_task' },
);

// "how do I …" setup/instruction questions are guidance, not automation.
check(
  'how-do-i setup question stays plain chat',
  buildChatAutomationPlan({ message: 'how do I connect my wordpress site?' }),
  { kind: 'run_plain_chat' },
);
check(
  'how-can-i question stays plain chat',
  buildChatAutomationPlan({ message: 'how can I add my google account?' }),
  { kind: 'run_plain_chat' },
);
// Imperative phrasing (no interrogative) still routes to automation.
{
  const imperative = buildChatAutomationPlan({ message: 'connect to my wordpress site and list my draft posts' });
  if (imperative.execution.kind === 'run_plain_chat') {
    console.error('FAIL: imperative wordpress task must not be swallowed by the how-do-i guard');
    process.exit(1);
  }
  console.log('pass: imperative wordpress task still routes to automation');
}

// WordPress image posting WITH attached images rides the main agent path
// (P20 wp.upload_media directive), not wp-admin browser automation…
check(
  'wp image post with attachment rides the REST lane',
  buildChatAutomationPlan({ message: 'post this image to my wordpress site', attachments: [{ type: 'image', id: 'a1' }] }),
  { kind: 'run_openswan', approvalRequired: true },
);
// …but explicit wp-admin/browser wording keeps the browser route,
// and no attachment keeps the browser fallback.
check(
  'wp image post with explicit wp-admin wording keeps browser automation',
  buildChatAutomationPlan({ message: 'log in to wp-admin and post this image', attachments: [{ type: 'image', id: 'a1' }] }),
  { kind: 'run_computer_task' },
);
check(
  'wp image post without attachments keeps the browser fallback',
  buildChatAutomationPlan({ message: 'post this image to my wordpress site' }),
  { kind: 'run_computer_task' },
);

// ── W-A1 probe fixes (2026-07 adversarial battery) — risk/approval pins ─────
// Lane membership is pinned in route-golden-canary-smoketest.ts; these rows
// pin the RISK + APPROVAL contract of the new gates so the approval floor
// cannot silently erode.

// M1: recurring cadence → schedule lane, review risk, no plan-time approval
// (the scheduler approval-gates its own external sends at run time — same
// contract as the schedule_automation pipeline lane).
check(
  'W-A1/M1: recurring cadence ask routes to the schedule lane',
  buildChatAutomationPlan({ message: "every morning post yesterday's merged PRs to Slack" }),
  { source: 'plain_chat', kind: 'run_command_handler', routeId: 'schedule', risk: 'review', approvalRequired: false, minConfidence: 0.8 },
);
check(
  'W-A1/M1: "remind me every day …" routes to the schedule lane',
  buildChatAutomationPlan({ message: 'remind me every day at 5pm to log my hours' }),
  { source: 'plain_chat', kind: 'run_command_handler', routeId: 'schedule', risk: 'review', approvalRequired: false },
);
check(
  'W-A1/M1 guard: meeting scheduling stays on the meetings pipeline',
  buildChatAutomationPlan({ message: 'Schedule a meeting with the design team every Monday' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, pipelineId: 'meetings_calendar_email' },
);

// M2: external chat-channel sends are external side effects → approval REQUIRED
// (approval floor: a message posted to a workspace is not waivable).
check(
  'W-A1/M2: Slack channel post is an approval-gated OpenSwan send',
  buildChatAutomationPlan({ message: "post a summary of today's standup to our Slack channel" }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', approvalRequired: true, minConfidence: 0.8 },
);
check(
  'W-A1/M2: #channel send in Slack is an approval-gated OpenSwan send',
  buildChatAutomationPlan({ message: 'send a message to the #general channel in Slack saying the deploy is done' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', approvalRequired: true },
);
check(
  'W-A1/M2: explicit message command after opening Slack remains an approval-gated send',
  buildChatAutomationPlan({ message: 'Open Slack and message Jordan hello' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', approvalRequired: true },
);
check(
  'W-A1/M2 guard: read-only Slack triage keeps the inbox pipeline (review, no send gate)',
  buildChatAutomationPlan({ message: 'Summarize unread emails and prioritize Slack alerts' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'review', pipelineId: 'inbox_notifications' },
);

// M3/M4: status questions are read-only → safe, never approval-gated.
check(
  'W-A1/M3: integrations health question is a safe read-only OpenSwan turn',
  buildChatAutomationPlan({ message: 'check which integrations are failing' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'safe', approvalRequired: false },
);
check(
  'W-A1/M4: agent-activity question is a safe read-only OpenSwan turn',
  buildChatAutomationPlan({ message: 'what did my agents do today' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'safe', approvalRequired: false },
);
check(
  'W-A1/M4 guard: agent creation phrasing keeps the office_agent_task lane',
  buildChatAutomationPlan({ message: 'create an agent named Scout with Opus and add it to the task we just made' }),
  { source: 'conversational_intent', kind: 'run_command_handler', routeId: 'mission' },
);
check(
  'W-A1/M4 guard: underspecified agent creation still asks (EVPI gate preserved)',
  buildChatAutomationPlan({ message: 'spin up an agent and add it to the task we just made' }),
  { kind: 'ask_clarification' },
);

// M5: /vault slash commands map to their real registry route.
check(
  'W-A1/M5: /vault list maps to the vault route with full confidence',
  buildChatAutomationPlan({ message: '/vault list' }),
  { source: 'slash', kind: 'run_command_handler', intentKind: 'slash_command', routeId: 'vault', minConfidence: 0.9 },
);

// ─── Final gate ──────────────────────────────────────────────────────────────
// The P23 + W-A1 sections above run AFTER the mid-file summary exit-check, so
// their failures only printed without flipping the exit code. Re-check here:
// a FAIL in any post-summary pinned row must fail the suite.
if (failures > 0) {
  console.error(`\n${failures} planner smoke-test failure(s) (post-summary sections)`);
  process.exit(1);
}
