/**
 * appAdapterGapContract — provider/app-agnostic adapter-gap contract.
 *
 * This is the generic sibling of `designAppAdapterGaps.ts` (which is Adobe
 * Photoshop/InDesign-specific). It lets the chat fulfil a task in ANY desktop
 * or web app — even one with no pre-built configuration — by composing three
 * things the user always needs:
 *
 *   1. FIND ANYTHING via the basics every app shares — command palette/search,
 *      menu bar, keyboard shortcuts, toolbars/panels/inspectors, and the OS
 *      accessibility/semantic tree queried by role + label/value. This is the
 *      `universalFindLadder`: how to locate the control/command/file that
 *      fulfils the request without app-specific knowledge.
 *   2. NAVIGATE + ACT through the bounded observe -> inspect -> plan -> execute
 *      -> verify loop already defined in `genericAppNavigator.ts` (reused, not
 *      duplicated).
 *   3. RESEARCH when the app/operation is unfamiliar — a platform- and
 *      app-aware research plan (what to look up, which official refs, and the
 *      triggers that say "stop and research how this app exposes this action
 *      before guessing"), then a structured connected-agent BUILDOUT contract
 *      so a real adapter/script/tool gets added with approval + smoke coverage.
 *
 * The contract mirrors `DesignAppAdapterGapContract` so it feeds the same
 * consumers (`buildAgentAppCapabilityBuildoutPolicy`, handoff context, route
 * decisions) the same way Adobe gaps do — only now for the whole long tail of
 * apps, not just Adobe.
 */

import {
  APP_AUTOMATION_RESEARCH_REFS,
  buildAppAutomationControlSurfacePlan,
  type AppAutomationResearchRef,
} from './appAutomationControlSurfaces';
import {
  buildGenericAppNavigatorPlan,
  classifyGenericAppTaskFamily,
  formatGenericAppTaskFamilyForUser,
  GENERIC_APP_NAVIGATOR_SOURCE_REFS,
  inferGenericAppName,
  isKnownConfiguredAppName,
  shouldUseGenericAppNavigator,
  type GenericAppNavigatorPhaseId,
  type GenericAppNavigatorTaskFamily,
} from './genericAppNavigator';
import { detectPlatform, matchKnownApp, type KnownAppPlatform } from './knownAppShortcuts';

export interface AppAdapterGapContract {
  schemaVersion: 1;
  appName: string;
  appSlug: string;
  knownApp: boolean;
  platform: KnownAppPlatform;
  operation: string;
  operationLabel: string;
  taskFamily: GenericAppNavigatorTaskFamily;
  taskFamilyLabel: string;
  controlSurface: string;
  /** Find the target control/command/file using only the basics every app shares. */
  universalFindLadder: string[];
  /** Bounded observe -> inspect -> plan -> execute -> verify phases (from genericAppNavigator). */
  navigatePhases: { id: GenericAppNavigatorPhaseId; instruction: string }[];
  actionLadder: string[];
  /** Research the app's automation surface when it is unfamiliar, before guessing. */
  researchPlan: string[];
  researchTriggers: string[];
  /** The proposed app-specific tool a connected agent would add (until then, use the universal ladder). */
  missingBridgeTools: string[];
  requiredBridgeToolsBeforeRetry: string[];
  approvalBefore: string[];
  requiredEvidence: string[];
  focusedSmokeCases: string[];
  failClosedRules: string[];
  buildoutTrigger: string;
  connectedAgentTask: string;
  retryPrompt: string;
  officialSourceRefs: AppAutomationResearchRef[];
}

export interface AppAdapterGapPlan {
  appName: string;
  appSlug: string;
  knownApp: boolean;
  platform: KnownAppPlatform;
  taskFamily: GenericAppNavigatorTaskFamily;
  taskFamilyLabel: string;
  contract: AppAdapterGapContract;
  promptSummary: string;
  sourceRefs: AppAutomationResearchRef[];
}

export interface AppAdapterGapOptions {
  appName?: string | null;
  /** Override the platform (defaults to the running platform via detectPlatform). */
  platform?: KnownAppPlatform;
}

function clean(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slug(value: string): string {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'app';
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => clean(value)).filter(Boolean)));
}

function uniqueRefs(refs: AppAutomationResearchRef[]): AppAutomationResearchRef[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    if (!ref?.url || seen.has(ref.url)) return false;
    seen.add(ref.url);
    return true;
  });
}

/** Short action phrase that names the operation, e.g. "export the timeline to mp4". */
export function inferAppOperation(task: string): string {
  const text = clean(task);
  if (!text) return 'complete the requested action';
  const verb = text.match(
    /\b(open|launch|create|make|build|add|insert|edit|change|update|set|rename|move|delete|remove|export|save|render|print|download|upload|send|publish|submit|run|generate|convert|configure|enable|disable|select|search|find|filter|sort|format|apply|replace|fill|draw|crop|trim|merge|split|sync|share|schedule|book|pay|sign)\b[\s\S]{0,60}?(?=(?:\b(?:and then|then|after|so that|because)\b)|[.!?\n]|$)/i,
  );
  if (verb?.[0]) return clean(verb[0]).replace(/[,;:]+$/, '');
  return text.split(/[.!?\n]/)[0]?.slice(0, 80).trim() || 'complete the requested action';
}

const PLATFORM_RESEARCH_KEYS: Record<KnownAppPlatform, string[]> = {
  mac: ['appleAutomation', 'appleUiScripting'],
  windows: ['windowsUiAutomation'],
  web: ['chromeDevtoolsProtocol', 'playwrightLocators', 'playwrightActionability'],
  linux: ['playwrightLocators'],
};

const APP_RESEARCH_KEYS: { test: RegExp; keys: string[] }[] = [
  { test: /\b(photoshop|psd|psb)\b/i, keys: ['photoshopUxpScripting', 'photoshopExecuteAsModal', 'photoshopApi'] },
  { test: /\b(indesign|in\s*design|indd|idml)\b/i, keys: ['indesignUxpScripts', 'indesignUxpPlugins', 'indesignApi'] },
  { test: /\bautocad\b/i, keys: ['autocadApi', 'autocadAutolisp', 'autodeskAutomationApi'] },
  { test: /\b(fusion|fusion\s*360)\b/i, keys: ['fusionApi', 'autodeskAutomationApi'] },
  { test: /\bsolidworks\b/i, keys: ['solidworksApi'] },
  { test: /\b(rhino|grasshopper)\b/i, keys: ['rhinoCommon'] },
  { test: /\brevit\b/i, keys: ['revitApi', 'autodeskAutomationApi'] },
  { test: /\binventor\b/i, keys: ['inventorApi'] },
  { test: /\b(chrome|safari|firefox|edge|browser|web\s*app|webpage|website)\b/i, keys: ['chromeDevtoolsProtocol', 'playwrightLocators'] },
];

function researchRefsFor(appName: string, platform: KnownAppPlatform): AppAutomationResearchRef[] {
  const keys: string[] = [...(PLATFORM_RESEARCH_KEYS[platform] || [])];
  for (const entry of APP_RESEARCH_KEYS) {
    if (entry.test.test(appName)) keys.push(...entry.keys);
  }
  const fromCatalog = keys
    .map((key) => (APP_AUTOMATION_RESEARCH_REFS as Record<string, AppAutomationResearchRef | undefined>)[key])
    .filter((ref): ref is AppAutomationResearchRef => Boolean(ref));
  // The generic navigator refs (Apple/Windows/Playwright/CDP) are structurally
  // AppAutomationResearchRef and cover the universal-control fallback.
  const generic = GENERIC_APP_NAVIGATOR_SOURCE_REFS as unknown as AppAutomationResearchRef[];
  return uniqueRefs([...fromCatalog, ...generic]).slice(0, 6);
}

function controlSurfaceFor(appName: string, platform: KnownAppPlatform, knownApp: boolean): string {
  if (/\b(photoshop|indesign|illustrator|premiere|after effects|audition)\b/i.test(appName)) {
    return 'vendor scripting API (UXP/ExtendScript) or plugin, inside the app, before UI control';
  }
  if (/\b(autocad|fusion|solidworks|rhino|revit|inventor)\b/i.test(appName)) {
    return 'vendor automation API / scripting (LISP, .NET, iLogic, RhinoCommon, APS) before UI control';
  }
  if (/\b(chrome|safari|firefox|edge|browser|web\s*app|webpage|website)\b/i.test(appName)) {
    return 'browser DOM via semantic locators (role/label/text) or CDP, before screenshots/coordinates';
  }
  if (platform === 'mac') {
    return 'macOS Accessibility/AppleScript semantic control (named menus, controls, fields) before coordinates';
  }
  if (platform === 'windows') {
    return 'Windows UI Automation tree + control patterns before coordinates';
  }
  return 'OS accessibility/semantic tree (named menus, controls, fields) before screenshots/coordinates';
}

/**
 * The universal "find anything" ladder — how to locate the control, command,
 * menu item, field, or file that fulfils the request using only the basics
 * shared by essentially every GUI app, ranked from most-reliable to last-resort.
 */
function universalFindLadderFor(platform: KnownAppPlatform, taskFamily: GenericAppNavigatorTaskFamily): string[] {
  const ladder = [
    'read the OS accessibility/semantic tree and menu inventory to enumerate the app\'s real controls, menus, fields, and current values before acting',
    'use the app\'s command palette / search / "Help" search to find the command by name when the app exposes one (e.g. Cmd/Ctrl+K, Cmd+Shift+P, the Help menu search field)',
    'walk the menu bar by name (File / Edit / View / Format / Tools / Window / Help) to locate the requested command and read its shown keyboard shortcut',
    'match a standard keyboard shortcut for the intent (open, save, find, copy/paste, undo/redo, preferences) only after the focused window/target is confirmed',
    'scan toolbars, side panels, inspectors, and property/settings dialogs by their accessible labels for the control that changes the requested property',
    'when the request names a file or output, locate it with file search / stat / open-path instead of hunting through dialogs blindly',
  ];
  if (taskFamily === 'canvas_or_visual_edit') {
    ladder.push('only after the above, take a fresh screenshot to locate purely-visual canvas targets, and bound any coordinate action to verified element bounds');
  }
  ladder.push('if the target still cannot be uniquely identified after two fresh observations, research the app\'s documented automation surface rather than guessing coordinates');
  return ladder;
}

function researchPlanFor(appName: string, knownApp: boolean, platform: KnownAppPlatform, operationLabel: string): string[] {
  const plan = [
    `Confirm how ${appName} exposes "${operationLabel}": check for a documented scripting/automation API, CLI, plugin/extension surface, URL scheme, or command-palette command before falling back to UI control.`,
    'Prefer official vendor docs, then the OS automation framework (Apple Accessibility/AppleScript, Windows UI Automation), then a browser DOM/CDP route for web/Electron apps.',
    'Capture the exact command name, menu path, parameters, and any required permission/mode so the action is reproducible and verifiable, not a one-off guess.',
  ];
  if (!knownApp) {
    plan.unshift(`${appName} is unfamiliar / not pre-configured — research its control surface first; do not assume menu paths or shortcuts without an observation or a cited doc.`);
  }
  plan.push('Record the chosen control surface + source refs so a connected agent can turn it into a reusable adapter/recipe with smoke coverage.');
  return plan;
}

export function buildAppAdapterGapContract(
  appName: string,
  operation: string,
  options: AppAdapterGapOptions & { task?: string } = {},
): AppAdapterGapContract {
  const resolvedAppName = clean(appName) || 'the target app';
  const platform = options.platform || detectPlatform();
  const knownApp = isKnownConfiguredAppName(resolvedAppName) || Boolean(matchKnownApp(resolvedAppName));
  const task = clean(options.task) || `${operation} in ${resolvedAppName}`;
  const taskFamily = classifyGenericAppTaskFamily(task);
  const taskFamilyLabel = formatGenericAppTaskFamilyForUser(taskFamily);
  const operationLabel = clean(operation) || inferAppOperation(task);
  const appSlug = slug(resolvedAppName);
  const opSlug = slug(operationLabel);
  const navPlan = buildGenericAppNavigatorPlan(task, { targetAppName: resolvedAppName });
  const officialSourceRefs = researchRefsFor(resolvedAppName, platform);
  const missingTool = `desktop.${appSlug}_${opSlug}`;

  return {
    schemaVersion: 1,
    appName: resolvedAppName,
    appSlug,
    knownApp,
    platform,
    operation: opSlug,
    operationLabel,
    taskFamily,
    taskFamilyLabel,
    controlSurface: controlSurfaceFor(resolvedAppName, platform, knownApp),
    universalFindLadder: universalFindLadderFor(platform, taskFamily),
    navigatePhases: navPlan.phases,
    actionLadder: navPlan.actionLadder,
    researchPlan: researchPlanFor(resolvedAppName, knownApp, platform, operationLabel),
    researchTriggers: uniqueStrings([
      'the app/operation is unfamiliar or not pre-configured and no cited control path exists yet',
      'the same semantic target is missing, stale, or ambiguous after two fresh observations',
      ...navPlan.buildoutTriggers,
    ]),
    missingBridgeTools: [missingTool],
    requiredBridgeToolsBeforeRetry: uniqueStrings([
      'desktop.list_running_apps',
      'desktop.window_state',
      'desktop.read_a11y_tree',
      missingTool,
    ]),
    approvalBefore: navPlan.approvalBoundaries,
    requiredEvidence: uniqueStrings([
      'fresh window/app identity and accessibility/semantic tree before the action',
      'the exact control/menu/command/field used plus its source (observed label or cited doc)',
      'after-state evidence proving the requested change (semantic value, file_stat when files changed, or verified proof screenshot)',
    ]),
    focusedSmokeCases: uniqueStrings([
      `routes "${operationLabel}" in ${resolvedAppName} through observe -> find -> act -> verify, not blind coordinates`,
      'requires running-app + window + accessibility observation before any mutation',
      'researches the app automation surface before guessing when the target is unfamiliar',
      'requests approval before any save/export/destructive/credentialed/paid action',
    ]),
    failClosedRules: uniqueStrings([
      'stop if the target app/window/control cannot be uniquely identified after two fresh observations',
      'stop and research (do not guess) when the app exposes no observed or documented path for the action',
      'never escalate from missing semantic state straight into repeated coordinate clicks; one bounded visual step max per fresh observation',
      'stop for approval before save/export/overwrite/delete/publish/send/buy/upload or running new scripts/macros/plugins',
      ...navPlan.stopConditions,
    ]),
    buildoutTrigger: `Build or propose an app-control adapter for "${operationLabel}" in ${resolvedAppName} before relying on it again.`,
    connectedAgentTask: [
      `Build or propose ${missingTool} so the chat can reliably "${operationLabel}" in ${resolvedAppName}.`,
      `Research the control surface first (${controlSurfaceFor(resolvedAppName, platform, knownApp)}); cite the official doc/API used.`,
      'Extend the existing desktop bridge / generic app navigator / OpenSwan tool routing instead of creating a parallel runtime.',
      `Use source refs: ${officialSourceRefs.map((ref) => `${ref.label} ${ref.url}`).join(' | ')}`,
      `Return ready_to_retry only after these smoke cases pass: observe-before-act, research-before-guess, approval-before-side-effect, and verified proof of "${operationLabel}".`,
    ].join(' '),
    retryPrompt: [
      `Retry "${operationLabel}" in ${resolvedAppName} after ${missingTool} (or a documented control path) is available.`,
      'Re-confirm the app/window, collect a fresh accessibility/semantic observation, request approval for any side effect, take one bounded step, then verify with after-state evidence.',
    ].join(' '),
    officialSourceRefs,
  };
}

export function buildAppAdapterGapPlan(
  task: string,
  options: AppAdapterGapOptions = {},
): AppAdapterGapPlan | null {
  const text = clean(task);
  if (!text) return null;
  const explicitApp = clean(options.appName);
  const inferredApp = explicitApp || inferGenericAppName(text) || (shouldUseGenericAppNavigator(text) ? 'Unfamiliar desktop app' : '');
  if (!inferredApp) return null;
  const platform = options.platform || detectPlatform();
  const operationLabel = inferAppOperation(text);
  const contract = buildAppAdapterGapContract(inferredApp, operationLabel, { task: text, platform });
  const promptSummary = `${contract.appName}: ${contract.operationLabel} (${contract.taskFamilyLabel}) via ${contract.controlSurface}; research-before-guess, observe-before-act, approval-before-side-effect.`;
  return {
    appName: contract.appName,
    appSlug: contract.appSlug,
    knownApp: contract.knownApp,
    platform: contract.platform,
    taskFamily: contract.taskFamily,
    taskFamilyLabel: contract.taskFamilyLabel,
    contract,
    promptSummary,
    sourceRefs: contract.officialSourceRefs,
  };
}

export function formatAppAdapterGapPromptBlock(plan: AppAdapterGapPlan | null): string {
  if (!plan) return '';
  const c = plan.contract;
  return [
    '## App Adapter Gap Contract (generic)',
    `Target app: ${c.appName}${c.knownApp ? '' : ' (unfamiliar / not pre-configured)'} | platform: ${c.platform} | task family: ${c.taskFamilyLabel}`,
    `Operation: ${c.operationLabel}`,
    `Control surface: ${c.controlSurface}`,
    `Find the target (basics every app shares): ${c.universalFindLadder.join(' | ')}`,
    // Drop the runtime's "call agent.build_app_capability" line: this block is
    // embedded in the buildout-agent prompt, where that guidance is circular.
    `Navigate + act: ${c.actionLadder.filter((item) => !/agent\.build_app_capability/i.test(item)).join(' | ')}`,
    `Research when unfamiliar: ${c.researchPlan.join(' | ')}`,
    `Research triggers: ${c.researchTriggers.join(' | ')}`,
    `Required evidence: ${c.requiredEvidence.join(' | ')}`,
    `Approval before: ${c.approvalBefore.join(' | ')}`,
    `Fail closed: ${c.failClosedRules.join(' | ')}`,
    `Buildout (if generic control is not enough): ${c.connectedAgentTask}`,
    `Retry after buildout: ${c.retryPrompt}`,
    `Source refs: ${c.officialSourceRefs.map((ref) => `${ref.label} <${ref.url}>`).join(' | ')}`,
  ].join('\n');
}

export function buildAppAdapterGapPromptBlock(
  task: string,
  options: AppAdapterGapOptions = {},
): string {
  return formatAppAdapterGapPromptBlock(buildAppAdapterGapPlan(task, options));
}
