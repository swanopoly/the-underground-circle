/**
 * universal-app-task-eval-smoketest
 *
 * A broad, source-level contract corpus for Chat -> computer/app routing. The
 * requests intentionally span unfamiliar desktop apps, browser work, and the
 * side-effect floors that must remain explicit. This smoke never opens a live
 * bridge or app; it exercises pure planner/compiler exports only.
 *
 * Run: npm run smoke:universal-app-task-eval
 */

import assert from 'node:assert/strict';

import {
  buildGenericAppNavigatorPlan,
  buildGenericAppSemanticWorkflow,
  classifyGenericAppTaskFamily,
  type GenericAppNavigatorTaskFamily,
  type GenericAppNavigatorWorkflowGoalKind,
} from '../src/lib/genericAppNavigator';
import {
  buildChatComputerRequestedActionContract,
  buildChatComputerRequestRoute,
  constraintBlocksToolCall,
  type ChatComputerRequestRoute,
} from '../src/lib/chatComputerRequestRouter';
import { compileComputerSequenceProgram } from '../src/lib/computerSequenceProgramCore';

type EvalCategory =
  | 'launch_read'
  | 'semantic_field_entry'
  | 'menu_shortcut'
  | 'toggle_select'
  | 'open_save_export'
  | 'dialogs'
  | 'media_timeline'
  | 'canvas_design'
  | 'terminal_ide'
  | 'browser'
  | 'remote_send'
  | 'purchase'
  | 'destructive'
  | 'credential'
  | 'permission';

type PolicyFamily =
  | 'observe_only'
  | 'reversible_local'
  | 'persistent_local'
  | 'browser_read'
  | 'remote_side_effect'
  | 'purchase_floor'
  | 'destructive_floor'
  | 'credential_floor'
  | 'permission_floor';

interface UniversalAppEvalCase {
  category: EvalCategory;
  request: string;
  surface: 'desktop' | 'browser' | 'local_file';
  policy: PolicyFamily;
  taskFamily?: GenericAppNavigatorTaskFamily;
}

type AdversarialCommonAppGroup =
  | 'short_app_names'
  | 'read_only_common_apps'
  | 'finder_local_file'
  | 'local_app_mutations'
  | 'explicit_browser_controls';

interface AdversarialCommonAppEvalCase extends UniversalAppEvalCase {
  group: AdversarialCommonAppGroup;
  expectedAppName?: string;
  expectedBrowserControlTool?: string;
  mutation?: boolean;
}

function cases(
  category: EvalCategory,
  surface: UniversalAppEvalCase['surface'],
  policy: PolicyFamily,
  taskFamily: GenericAppNavigatorTaskFamily | undefined,
  requests: string[],
): UniversalAppEvalCase[] {
  return requests.map((request) => ({ category, request, surface, policy, taskFamily }));
}

const CORPUS: UniversalAppEvalCase[] = [
  ...cases('launch_read', 'desktop', 'observe_only', 'launch_or_read', [
    'Open NovaBoard and read the active project title',
    'Launch QuillDeck and inspect the current workspace status',
    'Focus BeamStudio and report the selected preset',
    'Switch to LedgerLamp and read the current account name',
    'Open AtlasForge and summarize the visible workspace',
    'Launch EchoPanel and look at the active session',
    'Open OrbitDesk and read the active workspace name',
    'Focus WaveBench and report the current mode',
  ]),
  ...cases('semantic_field_entry', 'desktop', 'reversible_local', 'field_or_form_entry', [
    'Open NovaBoard and type Alpha in the Project Name field',
    'Launch QuillDeck and enter Weekly Review in the Title field',
    'Use BeamStudio and paste Welcome into the Description text box',
    'Open AtlasForge and set Apollo in the Project Name input',
    'Launch EchoPanel and put Morning Mix in the Name field',
    'Open OrbitDesk and update the Title field to Roadmap',
    'Use WaveBench and write Draft One in the Project field',
    'Open LedgerLamp and fill the Search field with Q3 invoices',
  ]),
  ...cases('menu_shortcut', 'desktop', 'reversible_local', 'menu_or_shortcut', [
    'Open NovaBoard and select Compact from the View menu',
    'Launch QuillDeck and choose Preferences from the App menu',
    'Open BeamStudio and press Command comma for the settings shortcut',
    'Use AtlasForge and click the Inspector button in the toolbar',
    'Open EchoPanel and select Grid from the Layout menu',
    'Launch OrbitDesk and press Control Shift P as a shortcut',
    'Open WaveBench and choose Zoom In from the View menu',
    'Use LedgerLamp and click the Refresh button on the toolbar',
  ]),
  ...cases('toggle_select', 'desktop', 'reversible_local', 'toggle_or_select', [
    'Open NovaBoard and select Dark from the Theme dropdown',
    'Launch QuillDeck and click the Autosuggest checkbox',
    'Open BeamStudio and choose Stereo from the Output dropdown',
    'Use AtlasForge and select Metric with the Units radio button',
    'Open EchoPanel and click the Loop checkbox',
    'Launch OrbitDesk and choose List from the View dropdown',
    'Open WaveBench and select High from the Quality dropdown',
    'Use LedgerLamp and click the Include archived checkbox',
  ]),
  ...cases('open_save_export', 'desktop', 'persistent_local', 'file_open_save_export', [
    'Open NovaBoard and save the active workspace using Save As',
    'Use QuillDeck and export the current layout using Export',
    'Launch BeamStudio and render the active composition to MP4',
    'Open LedgerLamp and print the active report to PDF',
    'Open AtlasForge and overwrite the saved workspace',
    'Use EchoPanel and save the active session as a new project',
    'Open OrbitDesk and export the selected board to PDF',
    'Launch WaveBench and rename the active project during Save As',
  ]),
  ...cases('dialogs', 'desktop', 'reversible_local', 'dialog_handling', [
    'Open NovaBoard and click the Cancel button in the confirmation dialog',
    'Launch QuillDeck and press Escape to dismiss the modal dialog',
    'Open BeamStudio and select the Continue button in the welcome dialog',
    'Focus AtlasForge and choose No from the warning dialog',
    'Use EchoPanel and click the Close button in the information dialog',
    'Open OrbitDesk and confirm with Return in the confirmation dialog',
    'Launch WaveBench and select the Later button in the update dialog',
    'Open MintCanvas and choose Keep Editing in the warning dialog',
  ]),
  ...cases('media_timeline', 'desktop', 'reversible_local', 'canvas_or_visual_edit', [
    'Open RhythmForge and add an audio clip to the timeline',
    'Use TrackDeck and trim the selected audio track',
    'Open SoundBench and move the video clip one track up',
    'Launch ClipForge and create a four bar drum loop',
    'Open BeatCanvas and adjust the audio track gain',
    'Use MotionDeck and split the selected video clip',
    'Open WaveLab Pro and animate the layer on the timeline',
    'Launch AudioNest and adjust the selected audio track volume',
  ]),
  ...cases('canvas_design', 'desktop', 'reversible_local', 'canvas_or_visual_edit', [
    'Open PixelForge and draw a rectangle on the canvas',
    'Use VectorNest and design a simple icon on the canvas',
    'Open PhotoMint and crop the current photo',
    'Launch MaskStudio and paint on the selected mask',
    'Open ShapeDeck and move the selected layer on the canvas',
    'Use ColorBench and resize the active image',
    'Open Artboard Pro and adjust the selected layer opacity',
    'Launch RetouchLab and retouch the portrait image',
  ]),
  ...[
    ['Open CodePilot IDE and run npm test in the integrated terminal', 'unknown_mutation'],
    ['Launch DevBench and run the unit tests in the terminal', 'unknown_mutation'],
    ['Open BuildForge IDE and build the active project', 'unknown_mutation'],
    ['Use ShellNest and press the command palette shortcut', 'menu_or_shortcut'],
    ['Open TestDeck IDE and run git status in the terminal', 'unknown_mutation'],
    ['Launch CommitCraft and inspect the current diagnostics', 'launch_or_read'],
    ['Open DebugStudio and press Control Shift P as a shortcut', 'menu_or_shortcut'],
    ['Use NovaTerminal and run pwd in the terminal', 'unknown_mutation'],
  ].map(([request, taskFamily]) => ({
    category: 'terminal_ide' as const,
    request,
    surface: 'desktop' as const,
    policy: 'reversible_local' as const,
    taskFamily: taskFamily as GenericAppNavigatorTaskFamily,
  })),
  ...cases('browser', 'browser', 'browser_read', undefined, [
    'Visit https://example.org/docs and read the getting started section',
    'Visit https://example.net/status and report the headline',
    'Navigate to https://example.com/about and summarize the visible content',
    'Visit https://developer.example.com/accessibility and read the API overview',
    'Visit https://example.org/help and inspect the FAQ',
    'Go to https://example.net/contact and read the business hours',
    'Visit https://example.com/catalog and list the visible categories',
    'Navigate to https://example.org/changelog and summarize the latest entry',
  ]),
  ...cases('remote_send', 'desktop', 'remote_side_effect', undefined, [
    'Open TeamBeam and send the drafted message to Alex',
    'Launch SupportNest and submit the current response to the customer',
    'Open DispatchDesk and publish the queued announcement',
    'Use InviteBoard and invite Jordan to the workspace',
    'Open TransferBox and upload the selected report',
    'Launch SocialDeck and post the drafted update',
    'Open WaveMail and email the active report to Sam',
    'Use NotifyHub and send the prepared alert to the team',
  ]),
  ...cases('purchase', 'browser', 'purchase_floor', undefined, [
    'Visit https://shop.example.com and buy one keyboard',
    'Visit https://store.example.org and purchase the Pro license',
    'Open https://example.net/checkout and pay the invoice',
    'Visit https://tickets.example.com and checkout with one ticket',
    'Visit https://market.example.org and buy the selected item',
    'Visit https://billing.example.net and charge the saved card for the renewal',
    'Navigate to https://shop.example.org and purchase two adapters',
    'Visit https://orders.example.com and complete the purchase',
  ]),
  ...cases('destructive', 'desktop', 'destructive_floor', undefined, [
    'Open PhotoForge and permanently delete the selected layer',
    'Launch NovaBoard and delete the current project forever',
    'Open LedgerLamp and erase the selected record',
    'Use AtlasForge and wipe the active workspace',
    'Open ClipDeck and permanently delete the selected video clip',
    'Launch WaveStudio and erase the active audio track',
    'Open MailCraft and delete the queued draft forever',
    'Use VaultDesk and wipe the stored profile',
  ]),
  ...cases('credential', 'desktop', 'credential_floor', undefined, [
    'Open VaultDesk and log in with my saved credentials',
    'Launch TeamGate and login using the stored account',
    'Open SecurePanel and sign in with my password',
    'Use AdminNest and authenticate with stored credentials',
    'Open CloudConsole and enter my password in the Login field',
    'Launch AccountDeck and log into the private workspace',
    'Open MemberHub and sign into the administrator account',
    'Use SafeBoard and enter my credentials in the Login form',
  ]),
  ...cases('permission', 'desktop', 'permission_floor', undefined, [
    'Open CloudDesk and authorize access to my calendar',
    'Launch SyncPanel and grant permission to my contacts',
    'Open DriveLink and connect my account',
    'Use MailBridge and link my account',
    'Open OAuthDesk and authorize the account connection',
    'Launch TeamNest and grant access to the microphone',
    'Open AppHub and grant consent to read the workspace',
    'Use CRMBridge and connect the account',
  ]),
];

const EXACT_PHOTOSHOP_CASES = [
  { request: 'Open Photoshop and start a new project 600 x 600', widthPx: 600, heightPx: 600, direct: true },
  { request: 'Launch Adobe Photoshop and create a new document 1024x768', widthPx: 1024, heightPx: 768, direct: true },
  { request: 'Open Photoshop and make a blank canvas 400 by 300 px', widthPx: 400, heightPx: 300, direct: true },
  { request: 'Start a new Photoshop project at 512x512', widthPx: 512, heightPx: 512, direct: true },
  { request: 'Please open Photoshop and create a fresh document sized 800 x 600 pixels', widthPx: 800, heightPx: 600, direct: true },
  { request: 'Launch Photoshop then make a new image 1920 by 1080', widthPx: 1920, heightPx: 1080, direct: true },
  { request: 'Open Photoshop and create a new project 4096 x 4096', widthPx: 4096, heightPx: 4096, direct: true },
  { request: 'Open Photoshop and create a new project 5000 x 5000', widthPx: 5000, heightPx: 5000, direct: false },
] as const;

const ADVERSARIAL_COMMON_APP_CORPUS: AdversarialCommonAppEvalCase[] = [
  // Short names are deliberately hostile to generic noun/app extraction. VLC
  // also carries media words such as "track", while R is a one-character app
  // name. Neither may be discarded, expanded, or mistaken for a browser.
  ...[
    ['Open VLC and read the current track title', 'VLC', 'launch_or_read', false],
    ['Launch VLC and mute the current playback', 'VLC', 'toggle_or_select', true],
    ['Open R and read the active console prompt', 'R', 'launch_or_read', false],
    ['Open R and type summary(cars) into the console', 'R', 'unknown_mutation', true],
  ].map(([request, expectedAppName, taskFamily, mutation]) => ({
    group: 'short_app_names' as const,
    category: mutation ? 'toggle_select' as const : 'launch_read' as const,
    request: request as string,
    surface: 'desktop' as const,
    policy: mutation ? 'reversible_local' as const : 'observe_only' as const,
    taskFamily: taskFamily as GenericAppNavigatorTaskFamily,
    expectedAppName: expectedAppName as string,
    mutation: mutation as boolean,
  })),

  // Common apps must not pay an approval tax merely to launch and read visible
  // state. Preview is allowed to use the local-file lane, but never a browser
  // route or browser tool.
  ...[
    ['Open Preview and read the active document title', 'Preview', 'local_file'],
    ['Open Preview and report the visible PDF page number', 'Preview', 'local_file'],
    ['Open Music and read the current song title', 'Music', 'desktop'],
    ['Open Mail and read the subject of the selected message', 'Mail', 'desktop'],
    ['Open Calculator and read the displayed result', 'Calculator', 'desktop'],
    ['Open Notes and read the title of the selected note', 'Notes', 'desktop'],
    ['Open Slack and report the active channel name', 'Slack', 'desktop'],
    ['Open Slack and read the latest visible message in general', 'Slack', 'desktop'],
  ].map(([request, expectedAppName, surface]) => ({
    group: 'read_only_common_apps' as const,
    category: 'launch_read' as const,
    request: request as string,
    surface: surface as 'desktop' | 'local_file',
    policy: 'observe_only' as const,
    taskFamily: 'launch_or_read' as const,
    expectedAppName: expectedAppName as string,
    mutation: false,
  })),

  ...[
    'Open Finder and list the visible files in Downloads',
    'Open Finder and read the selected file name in Documents',
    'In Finder, inspect the file size for report.pdf on the Desktop',
    'Open Finder and show the path of the selected folder in Documents',
  ].map((request) => ({
    group: 'finder_local_file' as const,
    category: 'launch_read' as const,
    request,
    surface: 'local_file' as const,
    policy: 'observe_only' as const,
    taskFamily: 'launch_or_read' as const,
    expectedAppName: 'Finder',
    mutation: false,
  })),

  ...[
    ['Open Zoom and mute my microphone', 'Zoom'],
    ['Open Zoom and choose Gallery View from the View menu', 'Zoom'],
    ['Open Excel and enter Q1 into cell A1', 'Excel'],
    ['Open Excel and select Currency from the Number Format dropdown', 'Excel'],
    ['Open Word and type Weekly Report at the cursor', 'Word'],
    ['Open Word and apply Bold to the selected heading', 'Word'],
    ['Open Figma and draw a rectangle on the canvas', 'Figma'],
    ['Open Figma and set the selected layer opacity to 50 percent', 'Figma'],
  ].map(([request, expectedAppName]) => ({
    group: 'local_app_mutations' as const,
    category: 'toggle_select' as const,
    request,
    surface: 'desktop' as const,
    policy: 'reversible_local' as const,
    expectedAppName,
    mutation: true,
  })),

  ...[
    ['Open https://example.org/docs in the browser and read the heading', 'browser.dom_snapshot'],
    ['In Chrome, open https://example.com/status and read the headline', 'browser.dom_snapshot'],
    ['In Safari, navigate to https://example.net/help and list the visible topics', 'browser.dom_snapshot'],
    ['Visit https://example.com/catalog and click the Documentation link', 'browser.click_role'],
    ['Go to https://example.org/search and search for release notes', 'browser.fill_field'],
    ['Open https://example.net/settings in the browser and select Dark mode', 'browser.set_toggle'],
    ['Navigate to https://example.com/about in Firefox and summarize the page', 'browser.dom_snapshot'],
    ['Use the browser to open https://example.org/changelog and read the latest entry', 'browser.dom_snapshot'],
  ].map(([request, expectedBrowserControlTool]) => ({
    group: 'explicit_browser_controls' as const,
    category: 'browser' as const,
    request,
    surface: 'browser' as const,
    policy: 'browser_read' as const,
    expectedBrowserControlTool,
    mutation: expectedBrowserControlTool !== 'browser.dom_snapshot',
  })),
];

let assertionCount = 0;
const failures: string[] = [];

function check(value: unknown, message: string): asserts value {
  assertionCount += 1;
  assert.ok(value, message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}

function oneOf<T>(actual: T, expected: readonly T[], message: string): void {
  check(expected.includes(actual), `${message}; expected one of [${expected.join(', ')}], got ${String(actual)}`);
}

function approvalActionCount(route: ChatComputerRequestRoute): number {
  // `requiresApproval` on the gated mutation points back to the same workflow
  // gate; only an explicit approval-surface item represents a user prompt.
  return (route.actionItems || []).filter((item) => item.surface === 'approval').length;
}

function isCoordinateTool(tool: string): boolean {
  return /(?:click_at|mouse_(?:move|click|down|up|drag)|coordinate)/i.test(tool);
}

function expectedWorkflowGoal(testCase: UniversalAppEvalCase): GenericAppNavigatorWorkflowGoalKind | null {
  switch (testCase.category) {
    case 'semantic_field_entry':
      return 'enter_requested_values';
    case 'menu_shortcut':
      return 'invoke_menu_or_shortcut';
    case 'toggle_select':
      return 'set_toggle_or_selection';
    case 'dialogs':
      return 'handle_dialog';
    case 'media_timeline':
    case 'canvas_design':
      return 'edit_canvas_or_timeline';
    case 'remote_send':
    case 'credential':
    case 'permission':
      return 'commit_external_action';
    case 'terminal_ide':
      if (testCase.taskFamily === 'menu_or_shortcut') return 'invoke_menu_or_shortcut';
      if (testCase.taskFamily === 'launch_or_read') return null;
      return 'perform_requested_semantic_action';
    default:
      return null;
  }
}

function assertSemanticWorkflow(testCase: UniversalAppEvalCase): void {
  const plan = buildGenericAppNavigatorPlan(testCase.request, { targetAppName: 'Eval Desktop App' });
  const workflow = plan.semanticWorkflow;
  const directWorkflow = buildGenericAppSemanticWorkflow(testCase.request);

  equal(plan.originalRequest, testCase.request, `${testCase.category}: navigator preserves the verbatim request`);
  equal(workflow.originalRequest, testCase.request, `${testCase.category}: semantic workflow preserves the verbatim request`);
  equal(directWorkflow.originalRequest, testCase.request, `${testCase.category}: direct semantic compiler preserves the verbatim request`);
  equal(workflow.schemaVersion, 1, `${testCase.category}: semantic workflow uses schema version one`);
  equal(workflow.approvalScope.mode, 'single_bounded_workflow_review', `${testCase.category}: workflow uses one bounded review scope`);
  equal(workflow.maxCheckpoints, 10, `${testCase.category}: semantic workflow advertises the ten-checkpoint limit`);
  check(workflow.checkpoints.length >= 2, `${testCase.category}: semantic workflow includes launch/inspect and verification`);
  check(workflow.checkpoints.length <= workflow.maxCheckpoints, `${testCase.category}: semantic workflow is bounded`);
  equal(workflow.wasCapped, false, `${testCase.category}: representative request is preserved without checkpoint truncation`);
  equal(workflow.checkpoints[0]?.id, 'launch_and_inspect', `${testCase.category}: workflow starts by launching/focusing and inspecting`);
  equal(workflow.checkpoints.at(-1)?.id, 'verify_requested_result', `${testCase.category}: workflow ends with independent verification`);
  equal(workflow.checkpoints[0]?.approvalClass, 'none', `${testCase.category}: launch/focus/wait never creates an approval prompt`);
  equal(workflow.checkpoints.at(-1)?.approvalClass, 'none', `${testCase.category}: read-only verification never creates an approval prompt`);
  check(/every clause/i.test(workflow.completionRule), `${testCase.category}: completion requires proof for every request clause`);
  check(/never guess UI labels or coordinates/i.test(workflow.stopRule), `${testCase.category}: stop rule forbids guessed UI/coordinates`);

  for (const [index, checkpoint] of workflow.checkpoints.entries()) {
    equal(checkpoint.ordinal, index + 1, `${testCase.category}: checkpoint ordinals are stable and contiguous`);
    check(checkpoint.observeBefore.length > 0, `${testCase.category}: ${checkpoint.id} declares fresh evidence`);
    check(checkpoint.allowedSemanticSurfaces.length > 0, `${testCase.category}: ${checkpoint.id} declares semantic surfaces`);
    check(
      checkpoint.allowedSemanticSurfaces.every((surface) => !/(?:coordinate|pointer|pixel|screenshot)/i.test(surface)),
      `${testCase.category}: ${checkpoint.id} exposes no raw-coordinate surface`,
    );
    check(Boolean(checkpoint.expectedPostcondition), `${testCase.category}: ${checkpoint.id} has a typed postcondition`);
    check(/(?:stop|build)/i.test(checkpoint.buildoutOrStopRule), `${testCase.category}: ${checkpoint.id} has bounded buildout/stop behavior`);
  }

  const expectedGoal = expectedWorkflowGoal(testCase);
  if (expectedGoal) {
    check(workflow.checkpoints.some((checkpoint) => checkpoint.id === expectedGoal), `${testCase.category}: workflow includes ${expectedGoal}`);
  }

  const shared = workflow.approvalScope.sharedReviewCheckpointIds;
  const exact = workflow.approvalScope.exactApprovalCheckpointIds;
  equal(new Set(shared).size, shared.length, `${testCase.category}: shared review checkpoints are de-duplicated`);
  equal(new Set(exact).size, exact.length, `${testCase.category}: exact approval checkpoints are de-duplicated`);
  for (const checkpoint of workflow.checkpoints) {
    if (checkpoint.approvalClass === 'shared_workflow_review') {
      check(shared.includes(checkpoint.id), `${testCase.category}: shared-review checkpoint is listed once in its workflow scope`);
    }
    if (checkpoint.approvalClass !== 'none' && checkpoint.approvalClass !== 'shared_workflow_review') {
      check(exact.includes(checkpoint.id), `${testCase.category}: exact approval checkpoint is retained in its workflow scope`);
    }
  }

  if (testCase.policy === 'observe_only') {
    equal(shared.length, 0, `${testCase.category}: observation has no shared review checkpoint`);
    equal(exact.length, 0, `${testCase.category}: observation has no exact approval checkpoint`);
  }
  if (testCase.category === 'semantic_field_entry' || testCase.category === 'menu_shortcut' || testCase.category === 'toggle_select') {
    check(shared.length >= 1, `${testCase.category}: reversible semantic inputs share one workflow review`);
    equal(exact.length, 0, `${testCase.category}: non-secret reversible semantic inputs do not acquire an exact floor`);
  }
  if (
    testCase.policy === 'persistent_local'
    || testCase.policy === 'remote_side_effect'
    || testCase.policy === 'destructive_floor'
    || testCase.policy === 'credential_floor'
    || testCase.policy === 'permission_floor'
  ) {
    check(exact.length >= 1, `${testCase.category}: persistent/external/sensitive workflow retains an exact approval floor`);
  }
}

function assertWholeRequestAndBounds(testCase: UniversalAppEvalCase, route: ChatComputerRequestRoute): void {
  equal(route.sourceMessage, testCase.request, `${testCase.category}: route preserves the complete request`);
  equal(route.executionKind, 'run_computer_task', `${testCase.category}: route remains executable`);
  check((route.actionItems?.length || 0) > 0, `${testCase.category}: route emits at least one actionable item`);
  check((route.actionItems?.length || 0) <= 8, `${testCase.category}: route stays within the eight-step bound`);
  check(route.recommendedTools.length <= 28, `${testCase.category}: recommended tool set stays bounded`);

  const coordinateActionIndex = (route.actionItems || []).findIndex((item) => isCoordinateTool(item.tool));
  if (coordinateActionIndex >= 0) {
    check(coordinateActionIndex > 0, `${testCase.category}: raw coordinates are never the first action`);
    check(
      (route.actionItems || []).slice(0, coordinateActionIndex).some((item) => (
        /(?:observe|a11y|window_state|screenshot|click_element|menu_click|set_element_value)/i.test(`${item.tool} ${item.label}`)
      )),
      `${testCase.category}: coordinate action has semantic or fresh-observation evidence first`,
    );
  }
}

function assertRequestedActionCoverage(
  testCase: UniversalAppEvalCase,
  route: ChatComputerRequestRoute,
): void {
  const contract = buildChatComputerRequestedActionContract(testCase.request);
  check(contract, `${testCase.category}: two-part request emits an action-accounting contract`);
  equal(contract.actionCount, 2, `${testCase.category}: both requested actions remain independently visible`);
  equal(contract.actions[0]?.id, 'A1', `${testCase.category}: first requested action has stable id A1`);
  equal(contract.actions[1]?.id, 'A2', `${testCase.category}: second requested action has stable id A2`);
  equal(contract.capped, false, `${testCase.category}: representative two-action request is not capped`);
  check(
    route.completionProof.some((item) => /^A1\s+independently verified\b/.test(item)),
    `${testCase.category}: completion proof retains A1`,
  );
  check(
    route.completionProof.some((item) => /^A2\s+independently verified\b/.test(item)),
    `${testCase.category}: completion proof retains A2`,
  );
}

function assertDesktopSurface(testCase: UniversalAppEvalCase, route: ChatComputerRequestRoute): void {
  oneOf(route.kind, ['desktop_app', 'hybrid'] as const, `${testCase.category}: named desktop app stays on a desktop-capable route`);
  check(route.routeId !== 'browser', `${testCase.category}: named desktop app does not inherit a browser route id`);
  check(
    !route.recommendedTools.some((tool) => tool.startsWith('browser.')),
    `${testCase.category}: named desktop app has no browser-tool fallback`,
  );
  check(
    !(route.actionItems || []).some((item) => item.surface === 'browser' || item.tool.startsWith('browser.')),
    `${testCase.category}: executable desktop steps never jump to the browser`,
  );

  const navPlan = buildGenericAppNavigatorPlan(testCase.request, { targetAppName: 'Eval Desktop App' });
  check(navPlan.canNavigateWithoutAdapter, `${testCase.category}: generic semantic navigation remains available`);
  check(navPlan.phases.length <= 8, `${testCase.category}: navigator phases stay bounded`);
  check(navPlan.stopConditions.some((item) => /two fresh observations/i.test(item)), `${testCase.category}: repeated missing targets stop after fresh evidence`);
  check(navPlan.buildoutTriggers.length >= 3, `${testCase.category}: missing capability has an explicit buildout contract`);
  check(navPlan.recommendedTools.includes('agent.build_app_capability'), `${testCase.category}: buildout tool remains reachable`);

  const buildoutIndex = navPlan.actionLadder.findIndex((item) => item.includes('agent.build_app_capability'));
  const coordinateIndex = navPlan.actionLadder.findIndex((item) => /coordinate/i.test(item));
  check(buildoutIndex >= 0, `${testCase.category}: action ladder names connected-agent buildout`);
  check(coordinateIndex === navPlan.actionLadder.length - 1, `${testCase.category}: coordinate fallback is the final rung`);
  check(buildoutIndex < coordinateIndex, `${testCase.category}: buildout precedes coordinate fallback`);

  const coordinateToolIndex = route.recommendedTools.findIndex(isCoordinateTool);
  if (coordinateToolIndex >= 0) {
    const semanticToolIndex = route.recommendedTools.findIndex((tool) => (
      tool === 'desktop.read_a11y_tree'
      || tool === 'desktop.click_element'
      || tool === 'desktop.menu_click'
      || tool === 'desktop.set_element_value'
    ));
    check(semanticToolIndex >= 0, `${testCase.category}: coordinate-capable route also exposes a semantic tool`);
    check(semanticToolIndex < coordinateToolIndex, `${testCase.category}: semantic tool is ordered before coordinates`);
  }

}

function assertBrowserSurface(testCase: UniversalAppEvalCase, route: ChatComputerRequestRoute): void {
  equal(route.kind, 'browser', `${testCase.category}: web request stays on the browser route`);
  check(route.routeId === 'browser' || route.routeId === null, `${testCase.category}: browser route id is coherent`);
  check(
    !route.recommendedTools.some((tool) => tool.startsWith('desktop.')),
    `${testCase.category}: pure browser request does not pull a desktop app forward`,
  );
  check(
    !(route.actionItems || []).some((item) => item.surface === 'desktop_app'),
    `${testCase.category}: browser steps remain browser-only`,
  );
}

function assertLocalFileSurface(testCase: AdversarialCommonAppEvalCase, route: ChatComputerRequestRoute): void {
  equal(route.kind, 'local_file', `${testCase.group}: Finder/Preview request stays on the local-file route`);
  equal(route.routeId, null, `${testCase.group}: local-file route never carries the legacy browser route id`);
  check(
    !route.recommendedTools.some((tool) => tool.startsWith('browser.')),
    `${testCase.group}: local-file route recommends no browser tools`,
  );
  check(
    !(route.actionItems || []).some((item) => item.surface === 'browser' || item.tool.startsWith('browser.')),
    `${testCase.group}: local-file steps never jump to the browser`,
  );
  check(
    route.recommendedTools.some((tool) => tool.startsWith('desktop.file_') || tool === 'desktop.open_path'),
    `${testCase.group}: local-file route exposes a file-native control surface`,
  );
  check(
    (route.actionItems || []).every((item) => (
      item.surface === 'local_file' || item.surface === 'verification' || item.surface === 'approval'
    )),
    `${testCase.group}: local-file executable steps remain on local-file, approval, or verification surfaces`,
  );
}

function assertAdversarialCommonAppPlan(testCase: AdversarialCommonAppEvalCase): void {
  if (testCase.surface === 'browser') return;
  const plan = buildGenericAppNavigatorPlan(testCase.request);
  equal(plan.originalRequest, testCase.request, `${testCase.group}: navigator preserves the full request`);
  equal(plan.targetAppName, testCase.expectedAppName, `${testCase.group}: navigator preserves the exact app name`);
  check(plan.phases.length <= 8, `${testCase.group}: app plan remains bounded`);
  check(plan.semanticWorkflow.checkpoints.length <= plan.semanticWorkflow.maxCheckpoints, `${testCase.group}: semantic workflow remains bounded`);
  equal(plan.semanticWorkflow.checkpoints[0]?.id, 'launch_and_inspect', `${testCase.group}: semantic workflow starts with observation`);
  equal(plan.semanticWorkflow.checkpoints.at(-1)?.id, 'verify_requested_result', `${testCase.group}: semantic workflow ends with verification`);
  check(
    plan.semanticWorkflow.checkpoints.every((checkpoint) => (
      checkpoint.allowedSemanticSurfaces.every((surface) => !/(?:coordinate|pointer|pixel)/i.test(surface))
    )),
    `${testCase.group}: semantic workflow exposes no raw-coordinate surface`,
  );

  if (testCase.taskFamily) {
    equal(
      classifyGenericAppTaskFamily(testCase.request),
      testCase.taskFamily,
      `${testCase.group}: common-app task family remains semantic and intentional`,
    );
  }
  if (testCase.mutation) {
    check(
      plan.semanticWorkflow.checkpoints.length >= 3,
      `${testCase.group}: local mutation includes an execution checkpoint between observation and proof`,
    );
  }
}

function assertAdversarialBrowserControl(testCase: AdversarialCommonAppEvalCase, route: ChatComputerRequestRoute): void {
  const expectedTool = testCase.expectedBrowserControlTool;
  check(expectedTool, `${testCase.group}: browser case declares its requested semantic control`);
  check(route.recommendedTools.includes(expectedTool), `${testCase.group}: browser route recommends ${expectedTool}`);
  const openIndex = (route.actionItems || []).findIndex((item) => item.tool === 'browser.open_url');
  const controlIndex = (route.actionItems || []).findIndex((item) => item.tool === expectedTool);
  check(openIndex >= 0, `${testCase.group}: explicit URL produces an executable browser.open_url step`);
  check(controlIndex > openIndex, `${testCase.group}: ${expectedTool} executes after opening the explicit URL`);
}

function assertPolicy(testCase: UniversalAppEvalCase, route: ChatComputerRequestRoute): void {
  const approvalActions = approvalActionCount(route);
  switch (testCase.policy) {
    case 'observe_only':
    case 'browser_read':
      oneOf(route.risk, ['safe', 'review'] as const, `${testCase.category}: observation is not classified as a side effect`);
      equal(route.approvalRequired, false, `${testCase.category}: pure launch/read/observe needs no approval`);
      equal(approvalActions, 0, `${testCase.category}: pure observation emits no approval step`);
      return;
    case 'reversible_local':
      oneOf(route.risk, ['safe', 'review'] as const, `${testCase.category}: reversible local work is not external/destructive`);
      check(approvalActions <= 1, `${testCase.category}: reversible workflow has at most one scoped review boundary`);
      return;
    case 'persistent_local':
      oneOf(route.risk, ['review', 'external_side_effect'] as const, `${testCase.category}: save/export remains reviewable`);
      equal(route.approvalRequired, true, `${testCase.category}: persistent save/export retains approval`);
      check(approvalActions === 1, `${testCase.category}: persistent workflow has one approval boundary`);
      return;
    case 'remote_side_effect':
      equal(route.risk, 'external_side_effect', `${testCase.category}: send/submit/publish/upload is external`);
      equal(route.approvalRequired, true, `${testCase.category}: remote side effect retains approval`);
      check(approvalActions === 1, `${testCase.category}: remote workflow has one approval boundary`);
      return;
    case 'purchase_floor': {
      equal(route.risk, 'external_side_effect', `${testCase.category}: purchase is external`);
      check(route.alwaysConfirmFloor?.includes('pay'), `${testCase.category}: route carries the non-grantable pay floor`);
      const verdict = constraintBlocksToolCall(null, 'browser.commit_purchase', { request: testCase.request });
      equal(verdict.floorConfirmRequired, true, `${testCase.category}: commit tool call requires fresh confirmation`);
      equal(verdict.floorCategory, 'pay', `${testCase.category}: commit tool call identifies the pay floor`);
      check(route.approvalRequired || verdict.floorConfirmRequired, `${testCase.category}: purchase cannot pass without a confirmation boundary`);
      return;
    }
    case 'destructive_floor':
      equal(route.risk, 'destructive', `${testCase.category}: permanent deletion is destructive`);
      equal(route.approvalRequired, true, `${testCase.category}: destructive action retains approval`);
      check(route.alwaysConfirmFloor?.includes('delete'), `${testCase.category}: destructive route carries the delete floor`);
      check(approvalActions === 1, `${testCase.category}: destructive workflow has one approval boundary`);
      return;
    case 'credential_floor':
      check(route.alwaysConfirmFloor?.includes('login'), `${testCase.category}: credential route carries the login floor`);
      equal(route.approvalRequired, true, `${testCase.category}: credentials retain approval`);
      check(approvalActions <= 1, `${testCase.category}: credential workflow has at most one plan boundary`);
      return;
    case 'permission_floor':
      check(route.alwaysConfirmFloor?.includes('grant'), `${testCase.category}: permission route carries the grant floor`);
      equal(route.approvalRequired, true, `${testCase.category}: account/permission grants retain approval`);
      check(approvalActions <= 1, `${testCase.category}: permission workflow has at most one plan boundary`);
      return;
  }
}

equal(CORPUS.length, 120, 'corpus contains eight cases in each of fifteen policy categories');
for (const category of new Set(CORPUS.map((item) => item.category))) {
  equal(CORPUS.filter((item) => item.category === category).length, 8, `${category}: category has eight representative requests`);
}

equal(ADVERSARIAL_COMMON_APP_CORPUS.length, 32, 'adversarial common-app corpus contains thirty-two additional requests');
for (const [group, expectedCount] of [
  ['short_app_names', 4],
  ['read_only_common_apps', 8],
  ['finder_local_file', 4],
  ['local_app_mutations', 8],
  ['explicit_browser_controls', 8],
] as const) {
  equal(
    ADVERSARIAL_COMMON_APP_CORPUS.filter((item) => item.group === group).length,
    expectedCount,
    `${group}: adversarial group has the expected request count`,
  );
}

for (const testCase of CORPUS) {
  try {
    if (testCase.taskFamily) {
      equal(
        classifyGenericAppTaskFamily(testCase.request),
        testCase.taskFamily,
        `${testCase.category}: generic task-family classification`,
      );
    }

    if (testCase.surface === 'desktop') assertSemanticWorkflow(testCase);

    const route = buildChatComputerRequestRoute(testCase.request);
    check(route, `${testCase.category}: planner returns a computer route for ${JSON.stringify(testCase.request)}`);
    assertWholeRequestAndBounds(testCase, route);
    assertRequestedActionCoverage(testCase, route);
    if (testCase.surface === 'desktop') assertDesktopSurface(testCase, route);
    else assertBrowserSurface(testCase, route);
    assertPolicy(testCase, route);
  } catch (error) {
    failures.push(`${testCase.category}: ${testCase.request}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const testCase of ADVERSARIAL_COMMON_APP_CORPUS) {
  try {
    assertAdversarialCommonAppPlan(testCase);
    const route = buildChatComputerRequestRoute(testCase.request);
    check(route, `${testCase.group}: planner returns a computer route for ${JSON.stringify(testCase.request)}`);
    assertWholeRequestAndBounds(testCase, route);
    if (/\band\b/i.test(testCase.request)) assertRequestedActionCoverage(testCase, route);

    if (testCase.surface === 'desktop') {
      equal(route.kind, 'desktop_app', `${testCase.group}: explicit common app stays on the desktop-app route`);
      assertDesktopSurface(testCase, route);
      if (testCase.mutation) {
        equal(route.alwaysConfirmFloor?.length || 0, 0, `${testCase.group}: reversible local mutation acquires no confirmation floor`);
        check(
          (route.actionItems || []).some((item) => (
            item.surface === 'desktop_app'
            && !/(?:launch_app|wait_for_app|window_state|list_running_apps|focus_app)$/i.test(item.tool)
          )),
          `${testCase.group}: local mutation includes an executable app-control step`,
        );
      }
    } else if (testCase.surface === 'local_file') {
      assertLocalFileSurface(testCase, route);
    } else {
      assertBrowserSurface(testCase, route);
      assertAdversarialBrowserControl(testCase, route);
    }
    assertPolicy(testCase, route);
  } catch (error) {
    failures.push(`${testCase.group}: ${testCase.request}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const testCase of EXACT_PHOTOSHOP_CASES) {
  try {
    const program = compileComputerSequenceProgram(testCase.request);
    check(program, `exact Photoshop compiler accepts ${JSON.stringify(testCase.request)}`);
    equal(program.id, 'photoshop_new_document', 'exact Photoshop request compiles to the blank-document family');
    equal(program.steps.length, 5, 'exact Photoshop program is a bounded five-step sequence');
    equal(program.steps[3]?.tool, 'desktop.photoshop_create_document', 'exact Photoshop mutation uses the app-native create tool');
    equal(program.steps[3]?.args.widthPx, testCase.widthPx, 'exact Photoshop program preserves requested width');
    equal(program.steps[3]?.args.heightPx, testCase.heightPx, 'exact Photoshop program preserves requested height');
    equal(program.authorization.mode, testCase.direct ? 'direct_user_request' : 'chat_plan_approval', 'exact Photoshop program uses the correct authorization scope');
    check(program.promptBlock.includes(`${testCase.widthPx}`), 'exact Photoshop prompt preserves requested dimensions');
    check(!program.steps.some((step) => step.tool.startsWith('browser.')), 'exact Photoshop program has no browser fallback');
    check(!program.steps.some((step) => /file_(?:search|stat|read)/.test(step.tool)), 'from-scratch Photoshop creation has no fabricated source-file dependency');
    check(!program.steps.some((step) => isCoordinateTool(step.tool)), 'exact Photoshop program has no coordinate action');

    const route = buildChatComputerRequestRoute(testCase.request);
    check(route, 'exact Photoshop request returns a computer route');
    equal(route.sourceMessage, testCase.request, 'exact Photoshop route preserves the complete two-part request');
    equal(route.kind, 'desktop_app', 'exact Photoshop route remains desktop-only');
    equal(route.routeId, null, 'exact Photoshop route never carries the legacy browser route id');
    equal(route.actionItems?.length, 5, 'exact Photoshop route exposes the complete five-step program');
    check(!route.recommendedTools.some((tool) => tool.startsWith('browser.')), 'exact Photoshop route recommends no browser tools');
    check(!route.recommendedTools.some((tool) => /file_(?:search|stat|read)/.test(tool)), 'exact Photoshop route recommends no local-file lookup');
    equal(route.approvalRequired, !testCase.direct, 'bounded blank document uses direct authority; oversized allocation asks once');
    oneOf(route.risk, testCase.direct ? ['safe'] as const : ['review'] as const, 'exact Photoshop risk matches allocation size');
  } catch (error) {
    failures.push(`exact_photoshop: ${testCase.request}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length > 0) {
  console.error(`Universal app task eval failed: ${failures.length} case(s) failed after ${assertionCount} assertions.`);
  console.error(failures.map((failure, index) => `${index + 1}. ${failure}`).join('\n'));
  process.exitCode = 1;
  process.exit();
}

const categorySummary = Array.from(new Set(CORPUS.map((item) => item.category)))
  .map((category) => `${category}=${CORPUS.filter((item) => item.category === category).length}`)
  .join(', ');

console.log(
  `Universal app task eval passed: ${CORPUS.length + EXACT_PHOTOSHOP_CASES.length + ADVERSARIAL_COMMON_APP_CORPUS.length} requests `
  + `(${CORPUS.length} policy corpus + ${EXACT_PHOTOSHOP_CASES.length} exact Photoshop + `
  + `${ADVERSARIAL_COMMON_APP_CORPUS.length} adversarial common-app), `
  + `${assertionCount} assertions.`,
);
console.log(`Category coverage: ${categorySummary}; exact_photoshop=${EXACT_PHOTOSHOP_CASES.length}.`);
console.log(
  `Adversarial common-app coverage: ${Array.from(new Set(ADVERSARIAL_COMMON_APP_CORPUS.map((item) => item.group)))
    .map((group) => `${group}=${ADVERSARIAL_COMMON_APP_CORPUS.filter((item) => item.group === group).length}`)
    .join(', ')}.`,
);
console.log('Scope: pure source-level planner/compiler checks only; no live app, bridge, accessibility, or GUI mutation was executed.');
