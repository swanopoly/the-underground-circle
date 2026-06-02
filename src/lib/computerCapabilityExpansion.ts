import type { ComputerCapabilityAudit, ComputerCapabilityId, ComputerCapabilityStatus } from './computerCapabilityRegistry';

export type ComputerCapabilityExpansionLaneId =
  | 'browser_semantic_actionability'
  | 'browser_protocol_runtime'
  | 'desktop_semantic_control'
  | 'app_native_adapter'
  | 'local_file_contract'
  | 'connected_agent_buildout';

export interface ComputerCapabilityExpansionLane {
  id: ComputerCapabilityExpansionLaneId;
  label: string;
  appliesWhen: string[];
  requiredCapabilities: ComputerCapabilityId[];
  officialSourceRefs: string[];
  buildActions: string[];
  proof: string[];
  smokeCommands: string[];
}

export interface ComputerCapabilityExpansionPlan {
  taskDescription: string;
  lanes: ComputerCapabilityExpansionLane[];
  missingCapabilities: ComputerCapabilityId[];
  partialCapabilities: ComputerCapabilityId[];
  nextBuildActions: string[];
  verificationCommands: string[];
  userEffortPolicy: string[];
}

const EXPANSION_LANES: ComputerCapabilityExpansionLane[] = [
  {
    id: 'browser_semantic_actionability',
    label: 'Browser semantic actionability',
    appliesWhen: [
      'web app, form, upload, download, browser tab, account, CMS, dashboard, or browser task',
      'task can be targeted by role, label, text, title, URL, DOM state, or ARIA snapshot',
    ],
    requiredCapabilities: ['browser_automation', 'browser_sessions'],
    officialSourceRefs: [
      'https://playwright.dev/docs/locators',
      'https://playwright.dev/docs/actionability',
    ],
    buildActions: [
      'prefer role/label/text/test-id locators before CSS selectors, screenshots, or coordinates',
      'gate every click/type/upload/download behind visible, stable, enabled, and event-receiving actionability checks',
      'return structured blocked states for auth, human verification, missing file grants, and ambiguous locators',
    ],
    proof: [
      'URL/title/DOM state after action',
      'locator/actionability receipt',
      'download/upload file_stat when files changed',
      'screenshot only as proof or fallback evidence',
    ],
    smokeCommands: [
      'npm run smoke:browser-bridge',
      'npm run smoke:browser-locator-resolver',
      'npm run smoke:chat-computer-request-router',
    ],
  },
  {
    id: 'browser_protocol_runtime',
    label: 'Browser protocol runtime inspection',
    appliesWhen: [
      'browser-like app needs runtime state, network/session inspection, download tracking, or DOM bridge repair',
      'semantic browser tools are missing or stale but a debug/protocol session is approved',
    ],
    requiredCapabilities: ['browser_automation', 'browser_sessions'],
    officialSourceRefs: [
      'https://chromedevtools.github.io/devtools-protocol/',
    ],
    buildActions: [
      'inspect page, target, network, runtime, and download state through the approved browser session before visual fallback',
      'bind protocol actions to the user-approved tab/session and never use protocol state to bypass user verification',
      'convert repeated protocol repairs into reusable bridge tools with a negative-path smoke',
    ],
    proof: [
      'target/session id belongs to approved run',
      'protocol state before and after action',
      'download/upload/file receipt where applicable',
    ],
    smokeCommands: [
      'npm run smoke:browser-bridge',
      'npm run smoke:computer-task-runtime',
    ],
  },
  {
    id: 'desktop_semantic_control',
    label: 'Desktop semantic control',
    appliesWhen: [
      'native desktop app task without a stronger app-native adapter',
      'window, menu, button, field, dialog, or file chooser can be represented in accessibility/control state',
    ],
    requiredCapabilities: ['desktop_control', 'app_tools'],
    officialSourceRefs: [
      'https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html',
      'https://learn.microsoft.com/en-us/windows/win32/winauto/ui-automation-specification',
    ],
    buildActions: [
      'observe running app, active window, menu inventory, and accessibility/control tree before any click or keystroke',
      'use named controls, menu paths, field values, and shortcuts only after focus and target identity are verified',
      'fall back to coordinates only for one reversible visual step after semantic and app-native routes fail',
    ],
    proof: [
      'window/app identity',
      'accessibility/control tree after action',
      'screenshot proof when visual state matters',
      'file_stat when outputs changed',
    ],
    smokeCommands: [
      'npm run smoke:desktop-bridge',
      'npm run smoke:desktop-diag',
      'npm run smoke:a11y-tree',
      'npm run smoke:local-desktop-bridge-intent',
    ],
  },
  {
    id: 'app_native_adapter',
    label: 'App-native adapter or script surface',
    appliesWhen: [
      'Adobe, CAD, IDE, design, media, spreadsheet, engineering, or other complex app task',
      'the task needs layers, document objects, model geometry, exports, rendering, plugins, scripts, APIs, or repeatable app recipes',
    ],
    requiredCapabilities: ['desktop_control', 'app_tools', 'agent_bridges'],
    officialSourceRefs: [
      'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/',
      'https://developer.adobe.com/indesign/uxp/',
      'https://aps.autodesk.com/developer/overview/design-automation-api',
    ],
    buildActions: [
      'prefer app-native DOM/API/script/plugin execution over desktop clicks for document-object mutations',
      'build the smallest adapter with official source refs, focused smoke coverage, approval gates, and retry contract',
      'collect app-native document/layer/model/status inventory before mutation and proof/export state after mutation',
    ],
    proof: [
      'app-native document or object inventory',
      'adapter/tool result with changed entities',
      'export/package/render proof',
      'focused smoke pass before retrying the user task',
    ],
    smokeCommands: [
      'npm run smoke:app-automation-control-surfaces',
      'npm run smoke:agent-app-capability-buildout',
      'npm run smoke:design-app-execution-pipeline',
      'npm run smoke:engineering-cad-operation-runbooks',
    ],
  },
  {
    id: 'local_file_contract',
    label: 'Local file identity and grant contract',
    appliesWhen: [
      'task names local files, uploads, downloads, exports, save-as, replace, rename, copy, package, or generated outputs',
      'desktop/app/browser task needs scoped local read or write access',
    ],
    requiredCapabilities: ['file_search', 'file_read', 'file_write'],
    officialSourceRefs: [
      'docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md',
      'docs/AGENTS_ROADMAP.md',
    ],
    buildActions: [
      'resolve exact file identity with search/stat before opening or writing',
      'request the smallest browser-session read/write grant before local mutation',
      'retry only the failed file-scoped step once after fresh evidence and grant confirmation',
    ],
    proof: [
      'file path basename plus scoped root',
      'before/after file_stat',
      'output format and existence proof',
      'blocked grant message when approval is missing',
    ],
    smokeCommands: [
      'npm run smoke:computer-grant-gate',
      'npm run smoke:chat-desktop-attachment-routing',
      'npm run smoke:computer-task-evidence-contract',
    ],
  },
  {
    id: 'connected_agent_buildout',
    label: 'Connected-agent capability buildout',
    appliesWhen: [
      'no existing app/browser/desktop pipeline can complete the task deterministically',
      'official docs, repo recipe, smoke, bridge tool, or adapter must be added before retry',
    ],
    requiredCapabilities: ['agent_bridges'],
    officialSourceRefs: [
      'docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md',
      'docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md',
    ],
    buildActions: [
      'launch a bounded connected code agent only when policy allows patching and user-action blockers are absent',
      'require source refs, files changed, focused smoke, approval metadata, evidence contract, and retry plan',
      'persist incomplete buildouts as blocked evidence gaps instead of automatically retrying',
    ],
    proof: [
      'files changed',
      'source refs',
      'focused smoke pass',
      'ready-to-retry or blocked evidence-gap status',
    ],
    smokeCommands: [
      'npm run smoke:agent-app-capability-buildout',
      'npm run smoke:custom-agent-bridge-dispatch',
      'npm run smoke:agent-failure-recovery',
    ],
  },
];

function normalized(value: string | null | undefined): string {
  return String(value || '').toLowerCase();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function statusFor(audit: ComputerCapabilityAudit | null | undefined, capability: ComputerCapabilityId): ComputerCapabilityStatus | 'unknown' {
  if (!audit) return 'unknown';
  return audit.findings.find((finding) => finding.id === capability)?.status || 'missing';
}

function includeLaneForTask(lane: ComputerCapabilityExpansionLane, task: string): boolean {
  const text = normalized(task);
  switch (lane.id) {
    case 'browser_semantic_actionability':
      return /\b(browser|website|web app|url|tab|page|form|upload|download|wordpress|shopify|cms|dashboard|login|book|booking|flight|hotel|travel|checkout|purchase|cart)\b/.test(text);
    case 'browser_protocol_runtime':
      return /\b(browser|tab|download|network|session|cookie|devtools|runtime|dom|electron)\b/.test(text);
    case 'desktop_semantic_control':
      return /\b(desktop|app|application|window|menu|dialog|popup|click|type|shortcut|open|launch|focus|take over)\b/.test(text);
    case 'app_native_adapter':
      return /\b(photoshop|indesign|illustrator|adobe|autocad|fusion|solidworks|revit|rhino|inventor|cad|figma|blender|ableton|logic pro|garageband|pro tools|premiere|after effects|maya|cinema 4d|sketchup|excel|spreadsheet|layers?|model|render|export|script|plugin|api|adapter)\b/.test(text);
    case 'local_file_contract':
      return /\b(file|folder|desktop|downloads?|documents?|upload|download|export|save|save as|rename|copy|replace|png|jpe?g|pdf|psd|indd|dwg|csv|xlsx)\b/.test(text);
    case 'connected_agent_buildout':
      return /\b(any app|any task|take over|do the thing|complete the task|not fully built|unfamiliar|not configured|missing adapter|missing pipeline|build what is needed|custom|plugin|script|api|adapter|complex|repair|fix|ableton|logic pro|garageband|pro tools|premiere|after effects|maya|cinema 4d|sketchup)\b/.test(text);
    default:
      return false;
  }
}

export function listComputerCapabilityExpansionLanes(): ComputerCapabilityExpansionLane[] {
  return EXPANSION_LANES.map((lane) => ({
    ...lane,
    appliesWhen: [...lane.appliesWhen],
    requiredCapabilities: [...lane.requiredCapabilities],
    officialSourceRefs: [...lane.officialSourceRefs],
    buildActions: [...lane.buildActions],
    proof: [...lane.proof],
    smokeCommands: [...lane.smokeCommands],
  }));
}

export function buildComputerCapabilityExpansionPlan(
  taskDescription: string,
  audit?: ComputerCapabilityAudit | null,
): ComputerCapabilityExpansionPlan {
  const task = String(taskDescription || '').trim();
  const selected = EXPANSION_LANES.filter((lane) => includeLaneForTask(lane, task));
  const lanes = selected.length > 0
    ? selected
    : EXPANSION_LANES.filter((lane) => (
      lane.id === 'desktop_semantic_control' ||
      lane.id === 'connected_agent_buildout'
    ));
  const missingCapabilities = unique(lanes.flatMap((lane) => (
    lane.requiredCapabilities.filter((capability) => statusFor(audit, capability) === 'missing')
  )));
  const partialCapabilities = unique(lanes.flatMap((lane) => (
    lane.requiredCapabilities.filter((capability) => statusFor(audit, capability) === 'partial' || statusFor(audit, capability) === 'unknown')
  )));

  return {
    taskDescription: task,
    lanes: lanes.map((lane) => ({
      ...lane,
      appliesWhen: [...lane.appliesWhen],
      requiredCapabilities: [...lane.requiredCapabilities],
      officialSourceRefs: [...lane.officialSourceRefs],
      buildActions: [...lane.buildActions],
      proof: [...lane.proof],
      smokeCommands: [...lane.smokeCommands],
    })),
    missingCapabilities,
    partialCapabilities,
    nextBuildActions: unique(lanes.flatMap((lane) => lane.buildActions)).slice(0, 12),
    verificationCommands: unique([
      ...lanes.flatMap((lane) => lane.smokeCommands),
      'npm run typecheck:app',
      'git diff --check',
    ]),
    userEffortPolicy: [
      'silently observe and prepare reversible state when existing grants and bridges are ready',
      'ask the user only for missing permission, credential, human-verification, destructive-output, billing, upload, or scoped local-file grants',
      'hide route internals on success and show concise proof instead of diagnostic recovery details',
      'when a capability is missing, delegate the smallest adapter/buildout with official refs and a smoke before retrying',
    ],
  };
}

export function formatComputerCapabilityExpansionPlan(plan: ComputerCapabilityExpansionPlan): string {
  const lanes = plan.lanes.map((lane) => `- ${lane.label}: ${lane.buildActions[0]}`).join('\n');
  return [
    '=== COMPUTER CAPABILITY EXPANSION PLAN ===',
    `Task: ${plan.taskDescription || 'unspecified computer/app/browser task'}`,
    `Lanes: ${plan.lanes.map((lane) => lane.id).join(', ') || 'none'}`,
    `Missing capabilities: ${plan.missingCapabilities.join(', ') || 'none'}`,
    `Partial/unknown capabilities: ${plan.partialCapabilities.join(', ') || 'none'}`,
    'Build next:',
    lanes || '- no expansion lane selected',
    'Verify:',
    plan.verificationCommands.map((command) => `- ${command}`).join('\n'),
  ].join('\n');
}
