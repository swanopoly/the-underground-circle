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

let failures = 0;
const PHOTOSHOP_SCREENSHOT_RENAME_REQUEST = 'open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png';

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

check(
  'local file search → computer task with session grant',
  buildChatAutomationPlan({ message: 'Search files in my Downloads folder for invoice' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'safe', minConfidence: 0.7 },
);

check(
  'local file rename → computer task with write review',
  buildChatAutomationPlan({ message: 'can you change the file landscaping-img.png thats on the desktop to andscaping-img-1.png' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'local app launch → computer task/app adapter, not plain model chat',
  buildChatAutomationPlan({ message: 'open Photoshop' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'local app follow-up task → computer task/app adapter',
  buildChatAutomationPlan({ message: 'open Photoshop and crop this image' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'local app plus creative generation stays deterministic computer task',
  buildChatAutomationPlan({ message: 'open Photoshop then create an image from the clipboard' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);
const localPhotoshopPlan = buildChatAutomationPlan({ message: 'open Photoshop then create an image from the clipboard' });
if (localPhotoshopPlan.computerRequestRoute?.appStrategy?.id !== 'creative_layout_control') {
  fail('local Photoshop app task exposes creative_layout_control computer request route metadata');
} else {
  console.log('pass: local Photoshop app task exposes computer route metadata');
}

check(
  'local Photoshop save-as filename stays deterministic computer task',
  buildChatAutomationPlan({ message: 'Open Photoshop and save the image as test-it.jpg' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
);

const photoshopScreenshotRenamePlan = buildChatAutomationPlan({ message: PHOTOSHOP_SCREENSHOT_RENAME_REQUEST });
check(
  'local Photoshop screenshot open/rename/export stays deterministic computer task',
  photoshopScreenshotRenamePlan,
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'safe', approvalRequired: false, minConfidence: 0.7 },
);
if (photoshopScreenshotRenamePlan.computerRequestRoute?.appStrategy?.id !== 'creative_layout_control') {
  fail('local Photoshop screenshot open/rename/export exposes creative_layout_control route metadata');
} else {
  console.log('pass: local Photoshop screenshot open/rename/export exposes computer route metadata');
}
const photoshopScreenshotCapabilities = photoshopScreenshotRenamePlan.computerRequestRoute?.computerPreview.requiredCapabilities || [];
if (!photoshopScreenshotCapabilities.includes('file_write')) {
  fail('local Photoshop screenshot open/rename/export requires write-scoped local file capability before proof export');
} else {
  console.log('pass: local Photoshop screenshot open/rename/export prepares write-scoped local file capability');
}

check(
  'local InDesign PDF export stays deterministic computer task',
  buildChatAutomationPlan({ message: 'Open InDesign and export high quality pdf as brochure.pdf' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
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
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'unfamiliar app task → computer task/app adapter, not plain model chat',
  buildChatAutomationPlan({ message: 'Use Ableton Live to create a four-bar drum loop and export it after approval' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
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
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'native menu click → computer task/app adapter',
  buildChatAutomationPlan({ message: 'click File > Save As in Photoshop' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'desktop text entry → computer task/app adapter',
  buildChatAutomationPlan({ message: 'type "hello world" in TextEdit' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'desktop paste text → computer task/app adapter',
  buildChatAutomationPlan({ message: 'paste "hello world" in TextEdit' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'desktop named field fill → computer task/app adapter',
  buildChatAutomationPlan({ message: 'fill the email field with test@example.com in TextEdit' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'desktop key combo → computer task/app adapter',
  buildChatAutomationPlan({ message: 'press Command S in Photoshop' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'coordinate desktop click → computer task/app adapter',
  buildChatAutomationPlan({ message: 'right double click at 400,500' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'held desktop mouse → computer task/app adapter',
  buildChatAutomationPlan({ message: 'hold mouse down at 400,500' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

check(
  'sequenced desktop app instruction → computer task/app adapter',
  buildChatAutomationPlan({ message: 'open TextEdit then type "hello" then press Command S' }),
  { source: 'plain_chat', kind: 'run_computer_task', routeId: 'browser', risk: 'review', minConfidence: 0.7 },
);

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
  'pipeline:travel booking routes to external-side-effect OpenSwan work',
  buildChatAutomationPlan({ message: 'Book a flight to New York next Friday under $500' }),
  { source: 'plain_chat', kind: 'run_openswan', routeId: null, risk: 'external_side_effect', pipelineId: 'travel_booking', minConfidence: 0.7 },
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

// ─── Summary ───────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} planner smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll planner smoke cases passed.');
