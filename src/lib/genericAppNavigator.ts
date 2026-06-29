import { isScriptableMacApp } from './scriptableMacApps';

export type GenericAppNavigatorPhaseId =
  | 'identify_app'
  | 'observe_window'
  | 'inspect_semantic_tree'
  | 'research_control_surface'
  | 'plan_semantic_action'
  | 'execute_bounded_step'
  | 'verify_or_buildout';

export type GenericAppNavigatorTaskFamily =
  | 'launch_or_read'
  | 'field_or_form_entry'
  | 'menu_or_shortcut'
  | 'file_open_save_export'
  | 'canvas_or_visual_edit'
  | 'unknown_mutation';

export type GenericAppNavigatorSourceType =
  | 'official_vendor'
  | 'official_platform'
  | 'official_framework'
  | 'official_protocol';

export interface GenericAppNavigatorSourceRef {
  label: string;
  url: string;
  takeaway: string;
  sourceType: GenericAppNavigatorSourceType;
  lastReviewedAt: string;
  primaryUse?: string;
  mustConfirm?: string[];
}

export interface GenericAppNavigatorPlan {
  targetAppName: string;
  taskFamily: GenericAppNavigatorTaskFamily;
  canNavigateWithoutAdapter: boolean;
  userEffortPolicy: string[];
  phases: { id: GenericAppNavigatorPhaseId; instruction: string }[];
  observeFirst: string[];
  actionLadder: string[];
  approvalBoundaries: string[];
  stopConditions: string[];
  recoveryRules: string[];
  recommendedTools: string[];
  buildoutTriggers: string[];
  sourceRefs: GenericAppNavigatorSourceRef[];
}

export interface GenericAppNavigatorRouteContext {
  targetAppName: string;
  taskFamily: GenericAppNavigatorTaskFamily;
  taskFamilyLabel: string;
  plan: GenericAppNavigatorPlan;
}

const GENERIC_APP_RESEARCH_REVIEWED_AT = '2026-06-01';

export const GENERIC_APP_NAVIGATOR_SOURCE_REFS: GenericAppNavigatorSourceRef[] = [
  {
    label: 'Apple UI scripting and Accessibility',
    url: 'https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html',
    takeaway: 'On macOS, generic app control should query the Accessibility element hierarchy before UI actions and requires Accessibility permission.',
    sourceType: 'official_platform',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'macOS unfamiliar-app control through accessible windows, menus, fields, and buttons',
    mustConfirm: ['Accessibility permission is granted', 'target process/window/control hierarchy is freshly observed'],
  },
  {
    label: 'Microsoft UI Automation',
    url: 'https://learn.microsoft.com/en-us/windows/win32/winauto/ui-automation-specification',
    takeaway: 'Windows native app automation should use the UI Automation tree and control patterns before coordinate input.',
    sourceType: 'official_platform',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'Windows unfamiliar-app control through semantic controls and control patterns',
    mustConfirm: ['target control pattern is available', 'control identity is unique before mutation'],
  },
  {
    label: 'Playwright locators',
    url: 'https://playwright.dev/docs/locators',
    takeaway: 'For browser-like apps, use user-facing locators such as role, label, text, and title before brittle selectors or coordinates.',
    sourceType: 'official_framework',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'semantic browser and Electron-style control targeting',
    mustConfirm: ['locator resolves to the intended element', 'target action is scoped to the approved session'],
  },
  {
    label: 'Playwright auto-waiting and actionability',
    url: 'https://playwright.dev/docs/actionability',
    takeaway: 'Actions should wait for visible, stable, enabled, and event-receiving targets, then return structured recovery when actionability fails.',
    sourceType: 'official_framework',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'readiness checks before semantic browser or hybrid app actions',
    mustConfirm: ['visible/stable/enabled checks pass before action', 'force actions are not used as a shortcut'],
  },
  {
    label: 'Chrome DevTools Protocol',
    url: 'https://chromedevtools.github.io/devtools-protocol/',
    takeaway: 'Browser-like surfaces should inspect page/runtime/session state through protocol data before screenshots or coordinate input.',
    sourceType: 'official_protocol',
    lastReviewedAt: GENERIC_APP_RESEARCH_REVIEWED_AT,
    primaryUse: 'browser and Electron runtime buildout when DOM/ARIA bridge tools are missing',
    mustConfirm: ['debug target belongs to the approved user session', 'protocol commands do not bypass human verification'],
  },
];

const KNOWN_CONFIGURED_APP_NAMES = new Set([
  'adobe photoshop',
  'photoshop',
  'adobe indesign',
  'indesign',
  'in design',
  'illustrator',
  'adobe illustrator',
  'adobe audition',
  'adobe premiere',
  'premiere pro',
  'after effects',
  'autocad',
  'auto cad',
  'fusion 360',
  'solidworks',
  'solid works',
  'matlab',
  'mathworks',
  'simulink',
  'revit',
  'rhino',
  'inventor',
  'browser',
  'chrome',
  'safari',
  'firefox',
  'edge',
]);

const GENERIC_CANDIDATE_STOP_WORDS = new Set([
  'app',
  'application',
  'browser',
  'desktop',
  'file',
  'files',
  'folder',
  'website',
  'webpage',
  'site',
  'window',
  'program',
  'computer',
  'chat',
  'swanbot',
  'openswan',
]);

function compactWhitespace(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => {
      if (!part) return part;
      if (/[A-Z]/.test(part.slice(1)) || /\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function cleanAppNameCandidate(raw: string | undefined): string | null {
  let value = compactWhitespace(raw || '')
    .replace(/^[\s"'`]+|[\s"'`,.;:]+$/g, '')
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\s+(?:app|application|window|program)$/i, '')
    .trim();
  if (!value) return null;
  value = value.split(/\s+(?:and then|then|and|to|for|with|before|after)\s+/i)[0]?.trim() || value;
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > 5) return null;
  const first = words[0]?.toLowerCase() || '';
  const normalized = value.toLowerCase();
  if (GENERIC_CANDIDATE_STOP_WORDS.has(first) || GENERIC_CANDIDATE_STOP_WORDS.has(normalized)) return null;
  if (/^(?:https?:\/\/|www\.)/i.test(value) || /\.[a-z0-9]{2,5}\b/i.test(value)) return null;
  if (/\b(?:screenshot|desktop|downloads?|documents?|image|photo|pdf|csv|png|jpe?g|psd|indd)\b/i.test(value)) return null;
  return titleCaseName(value);
}

function isGenericFallbackAppName(value: string | null | undefined): boolean {
  return /^(?:native desktop app|native desktop|desktop app|unfamiliar desktop app|unfamiliar desktop|generic app navigator|app automation route)$/i.test(compactWhitespace(value || ''));
}

export function inferGenericAppName(task: string): string | null {
  const text = compactWhitespace(task);
  if (!text) return null;
  const patterns = [
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9.+#&_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#&_-]*){0,4})(?:\s+(?:app|application|window|program))?\s+(?:and|then|to|for|with)\b/i,
    /\b(?:in|inside|using|with)\s+(?:the\s+)?([A-Za-z][A-Za-z0-9.+#&_-]*(?:\s+[A-Za-z0-9][A-Za-z0-9.+#&_-]*){0,4})(?:\s+(?:app|application|window|program))\b/i,
    /\b(?:in|inside|using|with)\s+(?:the\s+)?([A-Z][A-Za-z0-9.+#&_-]*(?:\s+[A-Z0-9][A-Za-z0-9.+#&_-]*){0,4})\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = cleanAppNameCandidate(match?.[1]);
    if (candidate) return candidate;
  }
  return null;
}

export function isKnownConfiguredAppName(appName: string | null | undefined): boolean {
  if (!appName) return false;
  return KNOWN_CONFIGURED_APP_NAMES.has(compactWhitespace(appName).toLowerCase());
}

export function classifyGenericAppTaskFamily(task: string): GenericAppNavigatorTaskFamily {
  const text = String(task || '').toLowerCase();
  if (/\b(save(?:\s+as)?|export|render|print|download|upload|open file|rename|replace|overwrite|png|jpe?g|pdf|mp4|wav|csv|xlsx?|docx?)\b/.test(text)) {
    return 'file_open_save_export';
  }
  if (/\b(canvas|visual|image|photo|video|audio|timeline|track|clip|layer|mask|draw|design|paint|crop|retouch|animate|render|model|drum loop)\b/.test(text)) {
    return 'canvas_or_visual_edit';
  }
  if (/\b(fill|enter|type|paste|set|update|write|put)\b/.test(text) && /\b(field|form|text box|input|name|title|description|prompt|search|project)\b/.test(text)) {
    return 'field_or_form_entry';
  }
  if (/\b(click|select|choose|menu|toolbar|preferences?|settings?|shortcut|press|tab|button|dropdown|checkbox|radio)\b/.test(text)) {
    return 'menu_or_shortcut';
  }
  if (/\b(open|launch|focus|switch to|inspect|read|summarize|look at|show)\b/.test(text) && !/\b(create|make|edit|change|delete|save|export|send|submit|publish|run)\b/.test(text)) {
    return 'launch_or_read';
  }
  return 'unknown_mutation';
}

export function formatGenericAppTaskFamilyForUser(
  family: GenericAppNavigatorTaskFamily | string | null | undefined,
): string {
  switch (family) {
    case 'launch_or_read':
      return 'app inspection';
    case 'field_or_form_entry':
      return 'field/form entry';
    case 'menu_or_shortcut':
      return 'menu or shortcut control';
    case 'file_open_save_export':
      return 'file/save/export work';
    case 'canvas_or_visual_edit':
      return 'visual/canvas work';
    case 'unknown_mutation':
      return 'app change';
    default:
      return compactWhitespace(String(family || '').replace(/[_-]+/g, ' '));
  }
}

function buildoutTriggersFor(task: string, family: GenericAppNavigatorTaskFamily): string[] {
  const text = String(task || '').toLowerCase();
  const triggers = [
    'no existing app recipe, adapter, bridge tool, or documented control path can identify the target app and safe action',
    'the same semantic target is missing, stale, or ambiguous after two fresh observations',
    'the task needs a script/plugin/API surface and the runtime has not implemented it yet',
  ];
  if (family === 'file_open_save_export' || /\b(export|render|save|replace|overwrite|convert|batch)\b/.test(text)) {
    triggers.push('app-specific save/export/render behavior is required before reliable completion');
  }
  if (family === 'canvas_or_visual_edit' || /\b(canvas|timeline|layer|model|geometry|audio|video|animation|drum loop|render|simulation)\b/.test(text)) {
    triggers.push('visual canvas/timeline/model operations cannot be verified through accessible controls alone');
  }
  if (/\b(custom|macro|script|plugin|extension|api|automation)\b/.test(text)) {
    triggers.push('a new macro/script/plugin/API bridge would be needed and must be built with approval plus smoke coverage');
  }
  return Array.from(new Set(triggers));
}

export function shouldUseGenericAppNavigator(task: string): boolean {
  const text = String(task || '');
  if (/\b(?:unfamiliar|not familiar|not configured|without previous configuration|any app|all apps|unknown app|missing pipeline|missing adapter|build what is needed)\b/i.test(text)) {
    return true;
  }
  const inferred = inferGenericAppName(text);
  // Known-configured apps AND AppleScript-scriptable apps (Notes, Reminders,
  // Calendar, …) have a deterministic native control surface, so they must
  // NOT be routed through the unfamiliar-app / buildout path — that's what
  // made "create a note" stall on "unknown app -> needs buildout".
  if (!inferred || isKnownConfiguredAppName(inferred) || isScriptableMacApp(inferred)) return false;
  return /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over|click|type|paste|press|fill|set|create|make|build|edit|update|export|save|run)\b/i.test(text);
}

export function shouldUseProfessionalAppAutonomy(task: string): boolean {
  const text = String(task || '');
  if (!text.trim()) return false;
  if (/\b(?:any app|all apps|whatever app|no matter what app|doesn'?t matter what app|figure out (?:how|by itself)|use the app like a professional)\b/i.test(text)) {
    return true;
  }
  if (shouldUseGenericAppNavigator(text)) return true;
  const inferred = inferGenericAppName(text);
  const asksToOpenOrDrive = /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\b/i.test(text);
  const asksForAppAction = /\b(?:add|create|make|build|edit|change|update|set|fill|enter|write|put|click|select|choose|type|paste|press|run|export|save|render|send|submit|publish|delete|remove|configure|enable|disable)\b/i.test(text);
  if (inferred && asksToOpenOrDrive && asksForAppAction) return true;
  return (
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\b[\s\S]{0,90}\b(?:app|application|window|program)\b/i.test(text) ||
    /\b(?:desktop app|native app|mac app|application)\b[\s\S]{0,120}\b(?:create|make|edit|update|export|save|click|type|paste|press|fill|run|do)\b/i.test(text)
  );
}

export function buildGenericAppNavigatorPlan(
  task: string,
  options: { targetAppName?: string | null } = {},
): GenericAppNavigatorPlan {
  const preferredApp = cleanAppNameCandidate(options.targetAppName || '');
  const inferredApp = (
    preferredApp && !isGenericFallbackAppName(preferredApp)
      ? preferredApp
      : inferGenericAppName(task)
  ) || 'Unfamiliar desktop app';
  const taskFamily = classifyGenericAppTaskFamily(task);
  return {
    targetAppName: inferredApp,
    taskFamily,
    canNavigateWithoutAdapter: true,
    userEffortPolicy: [
      'silently observe, launch/focus, read semantic state, and perform safe reversible setup without showing route internals',
      'ask the user only for approvals, ambiguous target choices, credentials, human verification, missing permissions, install/license blockers, or destructive output decisions',
      'show a concise done/proof message on success; expose technical route details only when the user asks or a blocker needs action',
    ],
    phases: [
      { id: 'identify_app', instruction: 'identify the target app, active window, requested file/project, output path, and task family' },
      { id: 'observe_window', instruction: 'collect fresh window state and screenshot only as evidence, not as the first mutation surface' },
      { id: 'inspect_semantic_tree', instruction: 'read the accessibility/control tree and menu inventory before click/type/menu actions' },
      { id: 'research_control_surface', instruction: 'if the app/operation is unfamiliar, research the official automation/control surface before guessing shortcuts, menus, or coordinates' },
      { id: 'plan_semantic_action', instruction: 'choose one unique named control, menu item, field, or shortcut with a verification signal' },
      { id: 'execute_bounded_step', instruction: 'execute one bounded semantic step, then immediately verify state before continuing' },
      { id: 'verify_or_buildout', instruction: 'if generic control cannot prove progress, hand off a bounded app-capability buildout instead of guessing' },
    ],
    observeFirst: [
      'desktop.list_running_apps or desktop.wait_for_app to confirm the target app is present',
      'desktop.window_state to confirm active app/window/document identity',
      'desktop.read_a11y_tree to list visible controls, fields, menus, dialogs, and values',
      'desktop.screenshot and desktop.screen_size only when the semantic tree is incomplete or the task is visual',
      'desktop.file_search/file_stat/open_path when the request names a local file or output destination',
    ],
    actionLadder: [
      'reuse an existing app-specific adapter, runbook, plugin, script, browser DOM/CDP route, or file-format operation when available',
      'search existing tool/recipe capability first, then research official vendor docs, app help, scripting dictionaries, command palettes, APIs, CLIs, URL schemes, plugins, or file formats before inventing an app-specific action',
      'for scriptable macOS apps, prefer desktop.run_applescript with built-in recipes or researched on-run-argv programs before UI clicking',
      'use OS accessibility tree controls for uniquely named buttons, fields, checkboxes, dialogs, and menu items',
      'use desktop.menu_click for stable menu paths and desktop.set_element_value for named editable fields before typing',
      'use desktop.press_keys only after focus and expected target context are verified',
      'call agent.build_app_capability with app name, task family, missing surface, official refs, desired tool, smoke, and retry contract when generic control is not enough',
      'perform one reversible visual coordinate step only after fresh screenshot, screen size, target bounds, and rollback/stop condition',
    ],
    approvalBoundaries: [
      'saving, exporting, replacing, overwriting, deleting, publishing, sending, buying, or uploading',
      'running new scripts, macros, plugins, extensions, generated code, or paid/generative actions',
      'credentialed/private workflows, human verification, MFA, CAPTCHA, payments, or account/admin changes',
      'destructive edits, irreversible canvas/model/timeline changes, or coordinate-based mutation',
    ],
    stopConditions: [
      'requested result is verified through app/window state, semantic tree, screenshot/proof, and file_stat when files changed',
      'target app, file, license, credential, permission, or human verification is unavailable',
      'no unique semantic target exists after two fresh observations',
      'task needs a missing app-specific adapter, script, plugin, API, recipe, or bridge tool',
      'approval is required before a side effect and has not been granted',
    ],
    recoveryRules: [
      'if focus is wrong, refocus or relaunch the target app before typing or pressing shortcuts',
      'if a dialog appears, read it with accessibility state, classify the safe/default action, and stop for user choice on destructive or ambiguous prompts',
      'if a semantic click/type fails once, refresh window state and a11y tree before retrying; after a second failure, delegate buildout or ask for the smallest user choice',
      'never escalate from missing semantic state directly into repeated coordinates; one bounded visual step is the maximum without new evidence',
      'after a connected agent adds a recipe/adapter/tool, retry only the failed step with fresh evidence',
    ],
    recommendedTools: [
      'desktop.list_running_apps',
      'desktop.wait_for_app',
      'desktop.window_state',
      'desktop.read_a11y_tree',
      'desktop.run_applescript',
      'desktop.menu_click',
      'desktop.click_element',
      'desktop.set_element_value',
      'desktop.press_keys',
      'desktop.type_text',
      'desktop.paste_text',
      'desktop.screenshot',
      'desktop.screen_size',
      'desktop.file_search',
      'desktop.file_stat',
      'desktop.open_path',
      'tools.search',
      'research.search',
      'fetch_url',
      'office.list_agents',
      'agent.build_app_capability',
      'approvals.request',
    ],
    buildoutTriggers: buildoutTriggersFor(task, taskFamily),
    sourceRefs: GENERIC_APP_NAVIGATOR_SOURCE_REFS,
  };
}

export function buildGenericAppNavigatorRouteContext(
  task: string,
  options: { targetAppName?: string | null; fallbackTargetAppName?: string } = {},
): GenericAppNavigatorRouteContext {
  const preferredApp = cleanAppNameCandidate(options.targetAppName || '');
  const inferredApp = preferredApp && !isGenericFallbackAppName(preferredApp)
    ? preferredApp
    : inferGenericAppName(task);
  const targetAppName = inferredApp || options.fallbackTargetAppName || 'Unfamiliar desktop app';
  const plan = buildGenericAppNavigatorPlan(task, { targetAppName: inferredApp || null });
  return {
    targetAppName,
    taskFamily: plan.taskFamily,
    taskFamilyLabel: formatGenericAppTaskFamilyForUser(plan.taskFamily),
    plan,
  };
}

export function formatGenericAppNavigatorPromptBlock(
  taskOrPlan: string | GenericAppNavigatorPlan,
): string {
  const plan = typeof taskOrPlan === 'string'
    ? buildGenericAppNavigatorPlan(taskOrPlan)
    : taskOrPlan;
  return [
    '## Generic App Navigator',
    `Target app: ${plan.targetAppName}`,
    `Task family: ${plan.taskFamily} (${formatGenericAppTaskFamilyForUser(plan.taskFamily)})`,
    `Can navigate without a dedicated adapter: ${plan.canNavigateWithoutAdapter ? 'yes, through bounded semantic control' : 'no'}`,
    `Phases: ${plan.phases.map((phase) => `${phase.id}=${phase.instruction}`).join(' | ')}`,
    `User effort policy: ${plan.userEffortPolicy.join(' | ')}`,
    `Observe first: ${plan.observeFirst.join(' | ')}`,
    `Action ladder: ${plan.actionLadder.join(' | ')}`,
    `Approval boundaries: ${plan.approvalBoundaries.join(' | ')}`,
    `Recovery: ${plan.recoveryRules.join(' | ')}`,
    `Stop conditions: ${plan.stopConditions.join(' | ')}`,
    `Buildout triggers: ${plan.buildoutTriggers.join(' | ')}`,
    `Recommended tools: ${plan.recommendedTools.join(' | ')}`,
    `Source refs: ${plan.sourceRefs.map((ref) => `${ref.label} (${ref.lastReviewedAt}) <${ref.url}>`).join(' | ')}`,
    'Visibility rule: hide internal route, picker, adapter, recovery, and status details on success; show only Done plus proof unless the user asks for diagnostics.',
    'Execution rule: take one bounded semantic step at a time, verify after each step, and call agent.build_app_capability instead of guessing when app-specific capability is missing.',
  ].join('\n');
}

export function formatProfessionalAppAutonomyPromptBlock(task: string): string | null {
  if (!shouldUseProfessionalAppAutonomy(task)) return null;
  const context = buildGenericAppNavigatorRouteContext(task);
  const plan = context.plan;
  const target = plan.targetAppName;
  const knownStatus = isScriptableMacApp(target)
    ? 'scriptable macOS app'
    : isKnownConfiguredAppName(target)
      ? 'known configured app'
      : 'unfamiliar or long-tail app';

  return [
    '## Professional App Autonomy',
    `Target: ${target} (${knownStatus}); task family: ${context.taskFamilyLabel}`,
    'Operating contract: do not make the user teach the app. Open or focus the app, observe real state, research the control surface when unfamiliar, act through the strongest deterministic surface, and verify proof.',
    'Open/focus first: use desktop.launch_app or desktop.focus_app, then desktop.wait_for_app and desktop.window_state before typing, clicking, or pressing shortcuts.',
    'Research-first rule: before an app-specific mutation, search existing tools/recipes, inspect app menus/help/command palettes, and use official vendor/platform docs via research.search or fetch_url when the control surface is not already known.',
    'Control-surface order: app-native API/script/plugin/CLI/file-format operation -> browser DOM/CDP for web/Electron apps -> OS accessibility/menu/field controls -> one bounded screenshot/coordinate step only after fresh evidence.',
    'Scriptable Mac rule: for Notes, Reminders, Calendar, Mail, Music, Finder, Messages, Safari, TextEdit, or any researched AppleScript-capable app, prefer desktop.run_applescript with user content in args, not inline script text.',
    'Professional execution rule: take one bounded step, verify state, then continue; never chain blind actions from memory, screenshots, or guessed shortcuts.',
    'Buildout rule: if the task needs a missing adapter/recipe/bridge tool or a reusable professional workflow, call agent.build_app_capability with app name, task, researched control surface, source refs, required evidence, and smoke cases, then retry only after fresh observation.',
    `Recommended tools: ${plan.recommendedTools.join(' | ')}`,
    `Proof: ${plan.stopConditions.join(' | ')}`,
  ].join('\n');
}
