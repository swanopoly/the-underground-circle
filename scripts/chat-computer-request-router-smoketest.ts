/**
 * chat-computer-request-router-smoketest — verifies that chat requests
 * involving browser, files, desktop apps, and unfamiliar apps produce one
 * explicit best-path route before execution.
 *
 * Run: npm run smoke:chat-computer-request-router
 */

import { buildChatAutomationPlan, summarisePlanForTelemetry } from '../src/lib/chatAutomationPlanner';
import { formatChatComputerTaskAutonomyPromptBlock } from '../src/lib/chatComputerTaskAutonomy';
import { buildChatComputerRequestRoute, buildChatComputerRequestRoutePromptBlock } from '../src/lib/chatComputerRequestRouter';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assertRoute(
  input: string,
  expected: Partial<{
    kind: string;
    strategyId: string;
    pipelineId: string;
    risk: string;
    approvalRequired: boolean;
    designApp: string;
    routeId: string | null;
    routeDecisionStatus: string | null;
    routeDecisionTarget: string | null;
    routeDecisionTaskFamily: string | null;
    evidenceTarget: string | null;
    evidenceTaskFamily: string | null;
    minTools: string[];
  }>,
) {
  const route = buildChatComputerRequestRoute(input);
  if (!route) {
    fail(`${input} expected a computer request route`);
    return;
  }
  const errors: string[] = [];
  if (expected.kind !== undefined && route.kind !== expected.kind) errors.push(`kind expected ${expected.kind}, got ${route.kind}`);
  if (expected.strategyId !== undefined && route.appStrategy?.id !== expected.strategyId) errors.push(`strategy expected ${expected.strategyId}, got ${route.appStrategy?.id || 'none'}`);
  if (expected.pipelineId !== undefined && route.selectedPipeline?.id !== expected.pipelineId) errors.push(`pipeline expected ${expected.pipelineId}, got ${route.selectedPipeline?.id || 'none'}`);
  if (expected.risk !== undefined && route.risk !== expected.risk) errors.push(`risk expected ${expected.risk}, got ${route.risk}`);
  if (expected.approvalRequired !== undefined && route.approvalRequired !== expected.approvalRequired) errors.push(`approval expected ${expected.approvalRequired}, got ${route.approvalRequired}`);
  if (expected.designApp !== undefined && route.designExecutionPipeline?.appName !== expected.designApp) errors.push(`design app expected ${expected.designApp}, got ${route.designExecutionPipeline?.appName || 'none'}`);
  if (expected.routeId !== undefined && route.routeId !== expected.routeId) errors.push(`routeId expected ${expected.routeId}, got ${route.routeId}`);
  if (expected.routeDecisionStatus !== undefined && (route.appAutomationRouteDecision?.status || null) !== expected.routeDecisionStatus) {
    errors.push(`route decision expected ${expected.routeDecisionStatus}, got ${route.appAutomationRouteDecision?.status || 'none'}`);
  }
  if (expected.routeDecisionTarget !== undefined && (route.appAutomationRouteDecision?.targetName || null) !== expected.routeDecisionTarget) {
    errors.push(`route decision target expected ${expected.routeDecisionTarget}, got ${route.appAutomationRouteDecision?.targetName || 'none'}`);
  }
  if (expected.routeDecisionTaskFamily !== undefined && (route.appAutomationRouteDecision?.taskFamily || null) !== expected.routeDecisionTaskFamily) {
    errors.push(`route decision task family expected ${expected.routeDecisionTaskFamily}, got ${route.appAutomationRouteDecision?.taskFamily || 'none'}`);
  }
  if (expected.evidenceTarget !== undefined && (route.evidenceContract?.targetName || null) !== expected.evidenceTarget) {
    errors.push(`evidence target expected ${expected.evidenceTarget}, got ${route.evidenceContract?.targetName || 'none'}`);
  }
  if (expected.evidenceTaskFamily !== undefined && (route.evidenceContract?.taskFamily || null) !== expected.evidenceTaskFamily) {
    errors.push(`evidence task family expected ${expected.evidenceTaskFamily}, got ${route.evidenceContract?.taskFamily || 'none'}`);
  }
  const missingTools = (expected.minTools || []).filter((tool) => !route.recommendedTools.includes(tool));
  if (missingTools.length > 0) errors.push(`missing tools ${missingTools.join(', ')}`);
  if (!route.bestPath || !route.notes.some((note) => note.includes('Computer request route'))) {
    errors.push('route should expose bestPath and route note');
  }
  if (!route.completionProof.length) errors.push('route should expose completion proof');
  if (errors.length) {
    fail(`${input}\n    ${errors.join('\n    ')}`);
    return;
  }
  pass(`${route.kind}/${route.appStrategy?.id || 'no-strategy'}: ${input}`);
}

assertRoute(
  'Open Photoshop and generate a background then save png',
  {
    kind: 'desktop_app',
    strategyId: 'creative_layout_control',
    pipelineId: 'creative_layout_design',
    risk: 'review',
    approvalRequired: true,
    designApp: 'Adobe Photoshop',
    routeId: 'browser',
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_export_proof'],
  },
);

assertRoute(
  'open the file Screenshot 2026-05-21 at 4.44.42\u202fPM thats on the desktop and open it in Photoshop and rename it lmao and save it as a png',
  {
    kind: 'desktop_app',
    strategyId: 'creative_layout_control',
    pipelineId: 'creative_layout_design',
    risk: 'safe',
    approvalRequired: false,
    designApp: 'Adobe Photoshop',
    routeId: 'browser',
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory'],
  },
);

assertRoute(
  'Open this InDesign file and make changes for a marketing banner with different layers',
  {
    kind: 'desktop_app',
    strategyId: 'creative_layout_control',
    pipelineId: 'creative_layout_design',
    risk: 'review',
    approvalRequired: true,
    designApp: 'Adobe InDesign',
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_export_proof'],
  },
);

assertRoute(
  'Use Ableton Live to create a four-bar drum loop and export it after approval',
  {
    kind: 'desktop_app',
    strategyId: 'universal_app_control',
    pipelineId: 'desktop_app_control',
    risk: 'review',
    approvalRequired: true,
    routeDecisionStatus: 'needs_observation',
    routeDecisionTarget: 'Ableton Live',
    routeDecisionTaskFamily: 'file/save/export work',
    evidenceTarget: 'Ableton Live',
    evidenceTaskFamily: 'file/save/export work',
    minTools: ['office.list_agents', 'agent.build_app_capability', 'desktop.read_a11y_tree'],
  },
);

assertRoute(
  'Open AutoCAD and create a 2D floor plan with two rooms and dimensions',
  {
    kind: 'desktop_app',
    strategyId: 'engineering_cad_control',
    pipelineId: 'desktop_app_control',
    risk: 'review',
    approvalRequired: true,
    routeDecisionStatus: 'needs_observation',
    minTools: ['desktop.read_a11y_tree', 'desktop.file_stat', 'approvals.request'],
  },
);

assertRoute(
  'Log into Shopify and update this product page after I approve',
  {
    kind: 'browser',
    strategyId: 'credentialed_browser',
    pipelineId: 'website_platform_admin',
    risk: 'external_side_effect',
    approvalRequired: true,
    routeDecisionStatus: 'needs_observation',
    minTools: ['vault.resolve_for_task', 'browser.verification_state'],
  },
);

assertRoute(
  'Search files in Downloads for invoice',
  {
    kind: 'local_file',
    strategyId: 'file_readonly',
    pipelineId: 'local_files',
    risk: 'safe',
    approvalRequired: false,
    routeDecisionStatus: null,
    minTools: ['desktop.file_search'],
  },
);

const pureImageRoute = buildChatComputerRequestRoute('Generate an image of a neon swan');
if (pureImageRoute) {
  fail(`pure image generation should not force computer route, got ${pureImageRoute.bestPath}`);
} else {
  pass('pure image generation stays on image/chat route');
}

const wordpressPlan = buildChatAutomationPlan({ message: 'Publish the homepage update to WordPress' });
if (wordpressPlan.execution.kind !== 'run_command_handler' || wordpressPlan.execution.routeId !== 'wordpress') {
  fail(`simple WordPress publish should keep existing conversational route, got ${wordpressPlan.execution.kind}/${wordpressPlan.execution.routeId}`);
} else {
  pass('simple WordPress publish preserves existing route');
}

const photoshopPlan = buildChatAutomationPlan({ message: 'Open Photoshop and generate a background then save png' });
if (photoshopPlan.execution.kind !== 'run_computer_task' || photoshopPlan.computerRequestRoute?.appStrategy?.id !== 'creative_layout_control') {
  fail('chat planner should dispatch Photoshop app work through the computer request route');
} else {
  pass('chat planner uses computer request route for Photoshop');
}

const imagePlan = buildChatAutomationPlan({ message: 'Generate an image of a neon swan' });
if (imagePlan.execution.routeId !== 'hf_tools' || imagePlan.computerRequestRoute) {
  fail('chat planner should leave pure image generation on hf_tools without computer route');
} else {
  pass('chat planner leaves pure image generation on hf_tools');
}

const telemetry = summarisePlanForTelemetry(photoshopPlan);
if ((telemetry.computerRequestRoute as any)?.appStrategyId !== 'creative_layout_control') {
  fail('planner telemetry should include compact computer request route details');
} else {
  pass('planner telemetry includes computer request route details');
}

const prompt = buildChatComputerRequestRoutePromptBlock('Open InDesign and export high quality pdf as brochure.pdf') || '';
if (
  !prompt.includes('## Chat Computer Request Route') ||
  !prompt.includes('## Least User Effort Policy') ||
  !prompt.includes('User effort: approve') ||
  !prompt.includes('Can auto-prepare: yes') ||
  !prompt.includes('Execution rule: prepare quietly where allowed') ||
  !prompt.includes('Best path:') ||
  !prompt.includes('## App Automation Route Decision') ||
  !prompt.includes('Status: needs_observation') ||
  prompt.includes('/Users/')
) {
  fail('computer request route prompt should be compact, routed, and free of local absolute paths');
} else {
  pass('computer request route prompt block is compact and sanitized');
}

const quietPrompt = buildChatComputerRequestRoutePromptBlock('Search files in Downloads for invoice') || '';
if (
  !quietPrompt.includes('User effort: none') ||
  !quietPrompt.includes('Can run quietly: yes') ||
  !quietPrompt.includes('Can auto-prepare: yes') ||
  !quietPrompt.includes('Execution rule: start useful work quietly') ||
  quietPrompt.includes('Ready for review')
) {
  fail('safe local-file route prompt should encode quiet least-effort execution');
} else {
  pass('safe local-file prompt encodes quiet least-effort execution');
}

const browserApprovalPrompt = buildChatComputerRequestRoutePromptBlock('Log into Shopify and update this product page after I approve') || '';
if (
  !browserApprovalPrompt.includes('User effort: approve') ||
  !browserApprovalPrompt.includes('Can auto-prepare: no') ||
  !browserApprovalPrompt.includes('stop at the approval boundary')
) {
  fail('credentialed browser prompt should encode approval without desktop auto-prep');
} else {
  pass('credentialed browser prompt encodes approval without desktop auto-prep');
}

const blockedRoute = buildChatComputerRequestRoute('Open Photoshop and generate a background then save png');
const blockedPrompt = blockedRoute
  ? formatChatComputerTaskAutonomyPromptBlock({
      ...blockedRoute,
      appAutomationRouteDecision: blockedRoute.appAutomationRouteDecision
        ? {
            ...blockedRoute.appAutomationRouteDecision,
            status: 'needs_user_action',
            userActionBlockers: ['Grant macOS Accessibility permission for Photoshop control.'],
          }
        : null,
    })
  : '';
if (
  !blockedPrompt.includes('User effort: unblock') ||
  !blockedPrompt.includes('Can run quietly: no') ||
  !blockedPrompt.includes('Can auto-prepare: no') ||
  !blockedPrompt.includes('do not continue execution until the user-controlled blocker is cleared')
) {
  fail('blocked app route prompt should fail closed to user unblock');
} else {
  pass('blocked app route prompt fails closed to user unblock');
}

const abletonRoute = buildChatComputerRequestRoute('Use Ableton Live to create a four-bar drum loop and export it after approval');
if (!abletonRoute?.bestPath.includes('desktop app: Ableton Live') || abletonRoute.bestPath.includes('Generic App Navigator via')) {
  fail(`unfamiliar app route should keep bestPath user-readable, got ${abletonRoute?.bestPath || 'none'}`);
} else {
  pass('unfamiliar app route bestPath is user-readable');
}
if (!abletonRoute?.notes.some((note) => note.includes('for file/save/export work'))) {
  fail('unfamiliar app route notes should preserve the task-family label');
} else {
  pass('unfamiliar app route notes preserve the task-family label');
}

// ── Operative known-app routing (recall) ─────────────────────────────────────
// Common apps named behind an operative prefix (in/using/with/open/use) now
// route into the computer path even without an "app" suffix or a whitelisted
// verb. These previously fell through to plain chat and lost the evidence
// contract.
for (const recallCase of [
  // desktop apps named behind an operative prefix (no "app" suffix / verb)
  'In Premiere Pro, trim the first clip and export the timeline',
  'Edit the title slide in PowerPoint and save it',
  'Use DaVinci Resolve to color-grade the clip',
  'In GIMP, remove the background from this photo',
  'Use OBS to start recording the screen',
  'In Microsoft Word, accept all tracked changes and save it',
  // browser: a navigation verb pointed at a real domain (no "website" noun)
  'Go to example.com and download the latest invoice',
  'visit acme.io/contact and submit the form',
  // browser: operating a "page" with a browser-op verb (not build-discovery)
  'Book a table for two on the OpenTable page',
  'reserve a table on the booking page',
]) {
  if (buildChatComputerRequestRoute(recallCase)) {
    pass(`recall: "${recallCase.slice(0, 40)}…" routes into the computer path`);
  } else {
    fail(`recall: "${recallCase}" should route into the computer path (lost the evidence contract)`);
  }
}

// ── Precision ─────────────────────────────────────────────────────────────────
// Prose that merely contains an app-like substring (word/mail/notes/logic), an
// operative verb with no named app, or a plain "build a page" request must NOT
// route into the computer path. The build-noun controls (booking/navigation)
// guard the substring choices in the new browser-op rescue verbs.
for (const precisionCase of [
  'save your words of wisdom for later',
  'edit the wording of this paragraph',
  'in other words, explain it more simply',
  'i want to go home and relax',
  'use logic to solve this puzzle',
  'it arrived in the mail yesterday',
  'take notes on this meeting',
  // build-discovery + substring-collision controls
  'build me a landing page for my bakery',
  'build a booking page for my salon',
  'design a navigation menu for the site',
  'how does node.js work',
  'go to sleep early tonight',
]) {
  if (buildChatComputerRequestRoute(precisionCase)) {
    fail(`precision: "${precisionCase}" should NOT route into the computer path`);
  } else {
    pass(`precision: "${precisionCase.slice(0, 40)}…" stays in plain chat`);
  }
}

// ─── D3: user constraints — parse, route wiring, enforcement, prompt ────────

{
  const { parseChatComputerUserConstraints, constraintBlocksToolCall, formatChatComputerUserConstraintsPromptLines } =
    require('../src/lib/chatComputerRequestRouter') as typeof import('../src/lib/chatComputerRequestRouter');

  // Parse: forbidden + stop conditions
  const c1 = parseChatComputerUserConstraints(
    "open my supplier portal in the browser and fill the reorder form, but don't submit it, and stop if it asks for MFA",
  );
  if (!c1) fail('constraints: c1 should parse');
  else {
    if (!c1.forbidden.includes('submit')) fail(`constraints: c1 forbidden should include submit (got ${c1.forbidden.join(',')})`);
    if (!c1.stopConditions.includes('mfa')) fail(`constraints: c1 stop should include mfa (got ${c1.stopConditions.join(',')})`);
    pass('constraints: "don\'t submit" + "stop if MFA" parsed');
  }

  // Parse: ask-before
  const c2 = parseChatComputerUserConstraints('clean up my downloads folder in Finder, ask me before deleting anything');
  if (!c2 || !c2.approvalBefore.includes('delete')) fail('constraints: c2 ask-before-delete should parse');
  else pass('constraints: "ask me before deleting" parsed');

  // Forbidden dominates ask-before for the same category
  const c3 = parseChatComputerUserConstraints("never delete files, and ask me before you delete anything");
  if (!c3 || !c3.forbidden.includes('delete') || c3.approvalBefore.includes('delete')) {
    fail('constraints: forbidden should dominate ask-before for the same category');
  } else pass('constraints: forbidden dominates ask-before');

  // No constraints → null
  if (parseChatComputerUserConstraints('open the report in Preview and read me the totals') !== null) {
    fail('constraints: plain request should parse to null');
  } else pass('constraints: plain request → null');

  // Route wiring: constraints land on the route, force approval, reach the prompt block
  const routed = buildChatComputerRequestRoute('use the browser to fill out the vendor form on acme.com but ask me before submitting it');
  if (!routed?.userConstraints?.approvalBefore.includes('submit')) {
    fail(`constraints: route should carry ask-before submit (got ${JSON.stringify(routed?.userConstraints)})`);
  } else if (!routed.approvalRequired) {
    fail('constraints: ask-before constraint should force approvalRequired');
  } else pass('constraints: route carries constraints + forces approval');
  const promptBlock = buildChatComputerRequestRoutePromptBlock('use the browser to fill out the vendor form on acme.com but ask me before submitting it');
  if (!promptBlock || !/User constraint/.test(promptBlock)) fail('constraints: prompt block should include constraint lines');
  else pass('constraints: prompt block carries constraint rules');

  // Enforcement: forbidden category blocks matching tool calls only
  const forbidSubmit = parseChatComputerUserConstraints("fill the form but don't submit it");
  const blockedCall = constraintBlocksToolCall(forbidSubmit, 'browser.submit_form', { selector: '#send' });
  const allowedCall = constraintBlocksToolCall(forbidSubmit, 'browser.fill_field', { selector: '#name', value: 'Chris' });
  if (!blockedCall.blocked || blockedCall.category !== 'submit') fail('constraints: submit tool should be blocked');
  else pass('constraints: forbidden submit blocks browser.submit_form');
  if (allowedCall.blocked) fail('constraints: fill tool should NOT be blocked');
  else pass('constraints: fill_field unaffected by submit constraint');
  if (constraintBlocksToolCall(null, 'browser.submit_form', {}).blocked) fail('constraints: null constraints never block');
  else pass('constraints: null constraints never block');

  // Prompt lines formatter
  const lines = formatChatComputerUserConstraintsPromptLines(c1);
  if (!lines.some((l) => /HARD/.test(l)) || !lines.some((l) => /stop and hand back/.test(l))) {
    fail('constraints: prompt lines should include HARD + stop rules');
  } else pass('constraints: prompt lines formatted');
}

// ─── T7: always-confirm category floor — detection, route force, prompt, gate ─

{
  const {
    ALWAYS_CONFIRM_FLOOR,
    detectAlwaysConfirmFloorCategories,
    constraintBlocksToolCall,
    formatAlwaysConfirmFloorPromptLine,
    parseChatComputerUserConstraints,
  } = require('../src/lib/chatComputerRequestRouter') as typeof import('../src/lib/chatComputerRequestRouter');

  if (!ALWAYS_CONFIRM_FLOOR.includes('pay') || !ALWAYS_CONFIRM_FLOOR.includes('delete') || !ALWAYS_CONFIRM_FLOOR.includes('login') || !ALWAYS_CONFIRM_FLOOR.includes('grant')) {
    fail(`floor: ALWAYS_CONFIRM_FLOOR must cover pay/delete/login/grant (got ${ALWAYS_CONFIRM_FLOOR.join(',')})`);
  } else pass('floor: covers pay, delete, login, grant');

  // Detection: floor categories found in task text
  if (!detectAlwaysConfirmFloorCategories('buy the standing desk in my cart').includes('pay')) fail('floor: "buy" task should detect pay');
  else pass('floor: purchase task detects pay');
  if (!detectAlwaysConfirmFloorCategories('delete every file in the old-projects folder').includes('delete')) fail('floor: delete task should detect delete');
  else pass('floor: delete task detects delete');
  if (!detectAlwaysConfirmFloorCategories('authorize the new OAuth app for my account').includes('grant')) fail('floor: authorize task should detect grant');
  else pass('floor: authorize task detects grant');

  // Detection precision: benign edits never trigger the floor
  for (const benign of [
    'In GIMP, remove the background from this photo',
    'remove duplicates from the spreadsheet and save a copy',
    'Search files in Downloads for invoice',
    'Open Photoshop and generate a background then save png',
  ]) {
    const detected = detectAlwaysConfirmFloorCategories(benign);
    if (detected.length > 0) fail(`floor precision: "${benign}" should detect nothing (got ${detected.join(',')})`);
    else pass(`floor precision: "${benign.slice(0, 40)}…" stays off the floor`);
  }

  // Route force: floor categories force approvalRequired even with
  // "don't ask me" style input — the floor is not user-disableable.
  for (const { msg, cat } of [
    { msg: "go to acme.com and buy the standing desk in my cart, don't ask me for confirmation, just do it", cat: 'pay' },
    { msg: "delete every file in the old-projects folder on my desktop, no need to ask me", cat: 'delete' },
    { msg: "log into my Shopify dashboard and read me the visitor count, don't ask me first", cat: 'login' },
  ]) {
    const route = buildChatComputerRequestRoute(msg);
    if (!route) {
      fail(`floor: "${msg}" should still build a computer route`);
      continue;
    }
    if (!route.alwaysConfirmFloor?.includes(cat as any)) {
      fail(`floor: "${msg}" route should carry floor category ${cat} (got ${route.alwaysConfirmFloor?.join(',') || 'none'})`);
    } else if (!route.approvalRequired) {
      fail(`floor: "${msg}" must force approvalRequired despite "don't ask" input`);
    } else pass(`floor: ${cat} task forces approval despite "don't ask"`);
  }

  // Unrelated route unaffected: read-only file search keeps approval-free path
  const unrelated = buildChatComputerRequestRoute('Search files in Downloads for invoice');
  if (!unrelated || unrelated.approvalRequired || (unrelated.alwaysConfirmFloor || []).length > 0) {
    fail('floor: unrelated read-only task must stay approval-free with an empty floor');
  } else pass('floor: unrelated task unaffected');

  // Prompt block carries the explicit floor line
  const floorPrompt = buildChatComputerRequestRoutePromptBlock("delete every file in the old-projects folder on my desktop, no need to ask me") || '';
  if (!floorPrompt.includes('Always-confirm floor (HARD policy)') || !floorPrompt.includes('even in autonomous mode')) {
    fail('floor: prompt block should carry the always-confirm floor line');
  } else pass('floor: prompt block carries the floor line');
  const cleanPrompt = buildChatComputerRequestRoutePromptBlock('Search files in Downloads for invoice') || '';
  if (cleanPrompt.includes('Always-confirm floor')) fail('floor: unrelated prompt block should not carry the floor line');
  else pass('floor: unrelated prompt block has no floor line');
  if (formatAlwaysConfirmFloorPromptLine([]) !== null || formatAlwaysConfirmFloorPromptLine(undefined) !== null) {
    fail('floor: empty/missing categories should format to null (persisted-route compat)');
  } else pass('floor: empty/missing floor formats to null');

  // Gate distinction: floor-confirm (request approval) vs constraint-block
  const floorVerdict = constraintBlocksToolCall(null, 'desktop.file_delete', { path: 'old-projects' });
  if (floorVerdict.blocked || !floorVerdict.floorConfirmRequired || floorVerdict.floorCategory !== 'delete') {
    fail(`floor gate: delete tool should require floor confirmation without blocking (got ${JSON.stringify(floorVerdict)})`);
  } else pass('floor gate: delete tool requires confirmation, not a block');
  const forbidDelete = parseChatComputerUserConstraints("organize the folder but never delete anything");
  const blockWins = constraintBlocksToolCall(forbidDelete, 'desktop.file_delete', { path: 'old-projects' });
  if (!blockWins.blocked || blockWins.category !== 'delete' || blockWins.floorConfirmRequired) {
    fail(`floor gate: user-forbidden delete should hard-block (block supersedes floor confirm), got ${JSON.stringify(blockWins)}`);
  } else pass('floor gate: forbidden constraint block supersedes floor confirm');
  const neutral = constraintBlocksToolCall(null, 'browser.fill_field', { selector: '#name', value: 'Chris' });
  if (neutral.blocked || neutral.floorConfirmRequired) fail('floor gate: neutral tool call should pass untouched');
  else pass('floor gate: neutral tool call passes untouched');
  const payVerdict = constraintBlocksToolCall(null, 'browser.click', { text: 'Buy now' });
  if (payVerdict.blocked || !payVerdict.floorConfirmRequired || payVerdict.floorCategory !== 'pay') {
    fail(`floor gate: "Buy now" click should require pay confirmation (got ${JSON.stringify(payVerdict)})`);
  } else pass('floor gate: purchase click requires pay confirmation');
}

if (failures > 0) {
  console.error(`\n${failures} chat computer request route smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll chat computer request route smoke cases passed.');
