import {
  buildGenericAppNavigatorRouteContext,
  GENERIC_APP_NAVIGATOR_SOURCE_REFS,
} from './genericAppNavigator';
// Type-only — erased at runtime, so this module stays free of the
// Supabase/RN-backed capability registry and remains Node-loadable.
import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import type { LocalComputerAwarenessIntent } from './localComputerAwarenessIntent';

export type AppAutomationTargetId =
  | 'adobe_indesign'
  | 'adobe_photoshop'
  | 'adobe_creative_cloud'
  | 'engineering_cad_app'
  | 'browser_app'
  | 'generic_native_app';

export type AppAutomationControlSurfaceId =
  | 'adobe_indesign_uxp_dom'
  | 'adobe_indesign_cloud_api'
  | 'adobe_photoshop_uxp_dom'
  | 'adobe_photoshop_batchplay'
  | 'adobe_photoshop_cloud_api'
  | 'autocad_lisp_dotnet_api'
  | 'autodesk_aps_automation_api'
  | 'autodesk_ai_mcp_assistant'
  | 'fusion_api_scripts_addins'
  | 'solidworks_com_api'
  | 'matlab_mcp_agentic_toolkit'
  | 'rhino_common_api'
  | 'revit_api_addin'
  | 'inventor_api_ilogic'
  | 'vendor_script_or_plugin_api'
  | 'browser_dom_cdp'
  | 'macos_apple_events'
  | 'os_accessibility'
  | 'semantic_desktop'
  | 'screenshot_coordinate_fallback'
  | 'connected_agent_buildout';

export type AppAutomationResearchSourceType =
  | 'official_vendor'
  | 'official_platform'
  | 'official_framework'
  | 'official_protocol'
  | 'repo';

export interface AppAutomationResearchRef {
  label: string;
  url: string;
  takeaway: string;
  sourceType?: AppAutomationResearchSourceType;
  lastReviewedAt?: string;
  primaryUse?: string;
  mustConfirm?: string[];
}

export interface AppAutomationControlSurfaceCandidate {
  id: AppAutomationControlSurfaceId;
  label: string;
  rank: number;
  fit: 'primary' | 'secondary' | 'fallback' | 'last_resort';
  bestFor: string[];
  requirements: string[];
  avoidWhen: string[];
  approvalBefore: string[];
  verification: string[];
  sourceRefs: AppAutomationResearchRef[];
}

export interface AppAutomationControlSurfacePlan {
  targetId: AppAutomationTargetId;
  targetName: string;
  taskFamily: string;
  candidates: AppAutomationControlSurfaceCandidate[];
  observeFirst: string[];
  failSafeRules: string[];
  buildoutChecklist: string[];
  promptHints: string[];
  sourceRefs: AppAutomationResearchRef[];
}

export type AppAutomationRecipe = {
  id: string;
  targetApp: string;
  controlSurface: string;
  sourceRefs: string[];
  approvalBefore: string[];
  verification: string[];
  smokeCases: string[];
  noteBody?: string | null;
};

const APPLE_NOTES_CREATE_NOTE_SOURCE_REFS = [
  'Apple Notes User Guide - Create and edit notes on Mac: https://support.apple.com/guide/notes/create-and-edit-notes-not9474646a9/mac',
  'Apple Mac Automation Scripting Guide: https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/',
  'Apple UI scripting and Accessibility: https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html',
];

const APPLE_NOTES_APP_RE = /\b(?:apple\s+)?notes?(?:\s+(?:app|application|window))?\b/i;
const APPLE_NOTES_CREATE_NOTE_RE = /\b(?:create|make|start|take|draft|add|write)\s+(?:a\s+)?(?:new\s+)?note\b|\bnew\s+note\b/i;
const APPLE_NOTES_NOTE_BODY_PATTERNS = [
  /\b(?:that(?:'?s|s| is)?\s+)?(?:says?|saying|reads?|reading|should\s+say|with(?:\s+(?:text|body|content))?|containing)\s+["'`]([\s\S]{1,4000}?)["'`]\s*$/i,
  /\b(?:that(?:'?s|s| is)?\s+)?(?:says?|saying|reads?|reading|should\s+say|with(?:\s+(?:text|body|content))?|containing)\s+([\s\S]{1,4000})$/i,
  /\b(?:create|make|start|take|draft|add|write)\s+(?:a\s+)?(?:new\s+)?note\s+(?:with|containing|about)\s+([\s\S]{1,4000})$/i,
];

function cleanAppleNotesNoteBody(raw: string | undefined): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  const unwrapped = value.replace(/^["'`]+|["'`]+$/g, '').trim();
  return unwrapped || null;
}

function extractAppleNotesNoteBody(task: string): string | null {
  const text = String(task || '').trim();
  for (const pattern of APPLE_NOTES_NOTE_BODY_PATTERNS) {
    const match = text.match(pattern);
    const noteBody = cleanAppleNotesNoteBody(match?.[1]);
    if (noteBody) return noteBody;
  }
  return null;
}

export function buildAppleNotesCreateNoteRecipe(task: string): AppAutomationRecipe | null {
  const text = String(task || '').trim();
  if (!APPLE_NOTES_APP_RE.test(text) || !APPLE_NOTES_CREATE_NOTE_RE.test(text)) return null;
  const noteBody = extractAppleNotesNoteBody(text);
  return {
    id: 'desktop.notes_create_note',
    targetApp: 'Notes',
    controlSurface: 'Notes AppleScript scripting interface (make new note) via the desktop bridge notes_create tool',
    sourceRefs: APPLE_NOTES_CREATE_NOTE_SOURCE_REFS,
    approvalBefore: ['mutating app state: create a new Notes note', 'note body text insertion'],
    verification: ['notes_create returns the new note title', 'post-action proof screenshot'],
    smokeCases: ['research-before-guess', 'approval-before-side-effect', 'verified-proof'],
    noteBody,
  };
}

export function buildAppleNotesCreateNoteSequence(recipe: AppAutomationRecipe): LocalComputerAwarenessIntent[] {
  // Prefer the deterministic AppleScript-backed `notes_create` bridge tool: it
  // creates the note in ONE shot via the Notes scripting API (it activates /
  // launches Notes itself), instead of the fragile "click New Note, then paste
  // into the editor" UI dance — which depended on finding the button and the
  // editor keeping focus, and previously stalled on accessibility observation
  // (a normal Notes window read as a "popup needing a decision").
  if (recipe.noteBody) {
    return [
      { route: true, kind: 'notes_create', appQuery: 'Notes', text: recipe.noteBody, reason: 'apple-notes-create-note-applescript' },
      { route: true, kind: 'screen_state', reason: 'apple-notes-proof-screenshot' },
    ];
  }
  // No body text — just open Notes for the user.
  return [
    { route: true, kind: 'launch_app', appQuery: 'Notes', reason: 'apple-notes-launch' },
    { route: true, kind: 'screen_state', reason: 'apple-notes-proof-screenshot' },
  ];
}

export function serializeAppAutomationRecipe(recipe: AppAutomationRecipe | null): Record<string, unknown> | null {
  if (!recipe) return null;
  return {
    id: recipe.id,
    targetApp: recipe.targetApp,
    controlSurface: recipe.controlSurface,
    sourceRefs: recipe.sourceRefs,
    approvalBefore: recipe.approvalBefore,
    verification: recipe.verification,
    smokeCases: recipe.smokeCases,
    noteBody: recipe.noteBody || null,
  };
}

export type AppAutomationRouteDecisionStatus =
  | 'ready_to_execute'
  | 'needs_observation'
  | 'needs_approval'
  | 'needs_user_action'
  | 'needs_connected_agent_buildout';

export interface AppAutomationRouteDecisionOptions {
  preferred?: Partial<Pick<AppAutomationControlSurfacePlan, 'targetId' | 'targetName'>>;
  availableSurfaceIds?: AppAutomationControlSurfaceId[];
  unavailableSurfaceIds?: AppAutomationControlSurfaceId[];
  confirmedRequirements?: string[];
  observedEvidence?: string[];
  approvedActions?: string[];
  userActionBlockers?: string[];
  allowConnectedAgentBuildout?: boolean;
  maxSkippedSurfaces?: number;
}

export interface AppAutomationRouteDecision {
  status: AppAutomationRouteDecisionStatus;
  targetId: AppAutomationTargetId;
  targetName: string;
  taskFamily: string;
  chosenSurface: AppAutomationControlSurfaceCandidate;
  score: number;
  skippedSurfaces: AppAutomationControlSurfaceCandidate[];
  requiredConfirmations: string[];
  missingConfirmations: string[];
  approvalBefore: string[];
  missingApprovals: string[];
  verification: string[];
  failSafeRules: string[];
  sourceRefs: AppAutomationResearchRef[];
  userActionBlockers: string[];
  nextSteps: string[];
}

const OFFICIAL_RESEARCH_REVIEWED_AT = '2026-05-29';

function officialRef(
  ref: Pick<AppAutomationResearchRef, 'label' | 'url' | 'takeaway' | 'primaryUse'> & {
    sourceType: Exclude<AppAutomationResearchSourceType, 'repo'>;
    lastReviewedAt?: string;
    mustConfirm?: string[];
  },
): AppAutomationResearchRef {
  return {
    ...ref,
    lastReviewedAt: ref.lastReviewedAt || OFFICIAL_RESEARCH_REVIEWED_AT,
    mustConfirm: ref.mustConfirm || [],
  };
}

export const APP_AUTOMATION_RESEARCH_REFS = {
  photoshopUxpScripting: officialRef({
    label: 'Adobe Photoshop UXP scripting',
    url: 'https://developer.adobe.com/photoshop/uxp/scripting/',
    takeaway: 'Photoshop automation should prefer app DOM APIs first and use lower-level action descriptors only when the DOM cannot express the command.',
    sourceType: 'official_vendor',
    primaryUse: 'local Photoshop one-off scripts and reusable bridge tools',
    mustConfirm: ['Photoshop is installed/licensed', 'the requested command is supported by UXP scripting or an existing bridge tool'],
  }),
  photoshopExecuteAsModal: officialRef({
    label: 'Adobe Photoshop executeAsModal',
    url: 'https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/',
    takeaway: 'Photoshop document mutations must run in a modal execution scope so the host app owns state and cancellation safely.',
    sourceType: 'official_vendor',
    primaryUse: 'safe Photoshop state mutation and cancellation handling',
    mustConfirm: ['mutation runs inside modal scope', 'errors/cancel state are surfaced to recovery'],
  }),
  photoshopApi: officialRef({
    label: 'Adobe Photoshop API',
    url: 'https://developer.adobe.com/firefly-services/docs/photoshop/',
    takeaway: 'Cloud Photoshop APIs are useful for rendition, smart-object, and image-operation pipelines after file upload/output approval.',
    sourceType: 'official_vendor',
    primaryUse: 'cloud/high-volume Photoshop content pipelines',
    mustConfirm: ['source upload approved', 'output destination approved', 'API credentials available'],
  }),
  indesignUxpScripts: officialRef({
    label: 'Adobe InDesign UXP scripts',
    url: 'https://developer.adobe.com/indesign/uxp/scripts/',
    takeaway: 'InDesign UXP scripts are the direct automation surface for local layout/document tasks.',
    sourceType: 'official_vendor',
    primaryUse: 'local InDesign layout/document automation',
    mustConfirm: ['InDesign version supports UXP scripts', 'active document identity matches the staged file'],
  }),
  indesignUxpPlugins: officialRef({
    label: 'Adobe InDesign UXP plugins',
    url: 'https://developer.adobe.com/indesign/uxp/plugins/',
    takeaway: 'InDesign UXP plugins provide a reusable app extension surface when one-off scripts need to become productized tools.',
    sourceType: 'official_vendor',
    primaryUse: 'reusable InDesign app extensions and productized bridge tooling',
    mustConfirm: ['plugin installation/distribution path is acceptable', 'local user approved plugin/tool execution'],
  }),
  indesignApi: officialRef({
    label: 'Adobe InDesign API',
    url: 'https://developer.adobe.com/firefly-services/docs/indesign-apis/',
    takeaway: 'Cloud InDesign APIs can inspect documents, create renditions, run custom scripts, and support data-merge style production workflows.',
    sourceType: 'official_vendor',
    primaryUse: 'cloud InDesign renditions, document info, custom scripts, and data merge workflows',
    mustConfirm: ['source/package upload approved', 'linked assets resolved', 'output destination approved'],
  }),
  appleAutomation: officialRef({
    label: 'Apple automation scripting',
    url: 'https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/',
    takeaway: 'On macOS, AppleScript and related automation are appropriate only when the target app exposes scriptable commands or UI scripting is explicitly enabled.',
    sourceType: 'official_platform',
    primaryUse: 'macOS app scripting dictionaries, Apple Events, and scriptable command surfaces',
    mustConfirm: ['target app exposes the needed scripting terms', 'Automation permission is granted where required'],
  }),
  appleUiScripting: officialRef({
    label: 'Apple UI scripting and Accessibility',
    url: 'https://developer.apple.com/library/archive/documentation/LanguagesUtilities/Conceptual/MacAutomationScriptingGuide/AutomatetheUserInterface.html',
    takeaway: 'macOS UI scripting relies on Accessibility permission and requires querying the target app element hierarchy before button/menu actions.',
    sourceType: 'official_platform',
    primaryUse: 'macOS accessibility/menu fallback after app-native automation is unavailable',
    mustConfirm: ['Accessibility permission is granted', 'target process/window/control hierarchy is freshly observed'],
  }),
  windowsUiAutomation: officialRef({
    label: 'Microsoft UI Automation',
    url: 'https://learn.microsoft.com/en-us/windows/win32/winauto/ui-automation-specification',
    takeaway: 'Windows desktop automation should use the UI Automation tree and control patterns before coordinate input.',
    sourceType: 'official_platform',
    primaryUse: 'Windows accessibility/control-pattern fallback for native app tasks',
    mustConfirm: ['target control pattern is available', 'control identity is unique before mutation'],
  }),
  chromeDevtoolsProtocol: officialRef({
    label: 'Chrome DevTools Protocol',
    url: 'https://chromedevtools.github.io/devtools-protocol/',
    takeaway: 'Browser-like app tasks should use DOM/runtime/network/page protocol state before screenshots or coordinates.',
    sourceType: 'official_protocol',
    primaryUse: 'low-level browser/session instrumentation when Playwright surface is insufficient',
    mustConfirm: ['debug target belongs to the user-approved browser/session', 'CDP commands do not bypass human verification'],
  }),
  chromeDevtoolsProtocolMonitor: officialRef({
    label: 'Chrome DevTools Protocol Monitor',
    url: 'https://developer.chrome.com/docs/devtools/protocol-monitor',
    takeaway: 'Chrome DevTools uses CDP to instrument, inspect, debug, and profile Chrome, and protocol messages can be recorded and sent directly.',
    sourceType: 'official_vendor',
    primaryUse: 'researching/debugging browser CDP command shape for bridge buildout',
    mustConfirm: ['target session is approved', 'raw CDP command is logged with request/response evidence'],
  }),
  playwrightLocators: officialRef({
    label: 'Playwright locators',
    url: 'https://playwright.dev/docs/locators',
    takeaway: 'Browser automation should prefer resilient user-facing locators such as role, label, text, title, and test id before brittle CSS or coordinates.',
    sourceType: 'official_framework',
    primaryUse: 'resilient browser element targeting',
    mustConfirm: ['locator resolves to the intended element', 'role/name/label/test-id candidates are preferred before CSS'],
  }),
  playwrightActionability: officialRef({
    label: 'Playwright auto-waiting and actionability',
    url: 'https://playwright.dev/docs/actionability',
    takeaway: 'Browser clicks/fills should wait for visible, stable, enabled, and event-receiving targets and return structured recovery when those checks fail.',
    sourceType: 'official_framework',
    primaryUse: 'browser action readiness and timeout recovery',
    mustConfirm: ['visible/stable/receives-events/enabled checks pass before action', 'no force action unless explicitly justified and approved'],
  }),
  autocadApi: officialRef({
    label: 'Autodesk AutoCAD API',
    url: 'https://aps.autodesk.com/developer/overview/autocad-api',
    takeaway: 'AutoCAD automation should prefer documented AutoCAD APIs and drawing-aware commands over blind desktop input for DWG/DXF mutation.',
    sourceType: 'official_vendor',
    primaryUse: 'AutoCAD drawing inspection, command/script automation, and DWG/DXF workflows',
    mustConfirm: ['AutoCAD or compatible Autodesk runtime is installed/licensed', 'active drawing path and units match the staged file'],
  }),
  autocadAutolisp: officialRef({
    label: 'Autodesk AutoCAD AutoLISP',
    url: 'https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-LT-AutoLISP/files/GUID-265AADB3-FB89-4D34-AA9D-6ADF70FF7D4B.htm',
    takeaway: 'AutoLISP is a direct AutoCAD automation surface for typed commands, drawing edits, and reusable scripts when the operation is scriptable.',
    sourceType: 'official_vendor',
    primaryUse: 'local AutoCAD command automation and repeatable drawing edits',
    mustConfirm: ['script execution is approved', 'command prompt state is known before running a script'],
  }),
  autocadDotNetApi: officialRef({
    label: 'Autodesk AutoCAD .NET API',
    url: 'https://help.autodesk.com/view/OARX/2027/ENU/?guid=GUID-C3F3C736-40CF-44A0-9210-55F6A939B6F2',
    takeaway: 'The AutoCAD Managed .NET API is the durable route for custom commands, drawing object access, dimensions, layers, and repeatable in-process app extensions.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'AutoCAD custom commands, ObjectARX/.NET add-ins, drawing object access, and production-grade adapter buildout',
    mustConfirm: ['AutoCAD version/API compatibility is known', 'assembly/add-in load path and execution approval are explicit'],
  }),
  autodeskAutomationApi: officialRef({
    label: 'Autodesk Platform Services Automation API',
    url: 'https://aps.autodesk.com/developer/overview/automation-api',
    takeaway: 'APS Automation is the server-side route for repeatable Autodesk file processing when uploads, credentials, and outputs are approved.',
    sourceType: 'official_vendor',
    primaryUse: 'cloud/batch Autodesk design-file processing and output generation',
    mustConfirm: ['source upload approved', 'APS credentials available', 'output destination approved'],
  }),
  autodeskMcpServers: officialRef({
    label: 'Autodesk MCP Servers',
    url: 'https://www.autodesk.com/solutions/autodesk-ai/autodesk-mcp-servers',
    takeaway: 'Autodesk MCP servers are the governed agentic execution surface when an Autodesk product exposes one, with permissions, boundaries, and editable results.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'Autodesk product-help grounding, Fusion direct design interaction, Revit/Fusion automation as available, and governed agent workflows',
    mustConfirm: ['the specific Autodesk MCP server exists for the target product', 'permissions and execution boundaries are configured', 'the resulting design remains editable in the Autodesk product'],
  }),
  autodeskAssistant: officialRef({
    label: 'Autodesk Assistant',
    url: 'https://www.autodesk.com/solutions/autodesk-ai/autodesk-assistant',
    takeaway: 'Autodesk Assistant is an in-product agentic AI surface for Autodesk workflows and should be used as a context-aware assistive route when available.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'in-product Autodesk guidance, text-to-command style workflows, recommendations, and assisted design/make execution',
    mustConfirm: ['Assistant is available in the installed Autodesk product/version', 'the task stays within the user-approved product/session'],
  }),
  autodeskNeuralTechnology: officialRef({
    label: 'Autodesk neural CAD technology',
    url: 'https://www.autodesk.com/solutions/autodesk-ai/neural-technology',
    takeaway: 'Autodesk neural CAD is an emerging generative geometry direction; treat it as a researched assistive/generative surface, not as a guaranteed local command path.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'future Fusion/Forma generative geometry and prompt-to-parametric-command research',
    mustConfirm: ['feature is released in the target product/version', 'generated geometry or command sequence is reviewed before production use'],
  }),
  autodeskAiKeyTechnologies: officialRef({
    label: 'Autodesk AI key technologies',
    url: 'https://www.autodesk.com/solutions/autodesk-ai#key-ai-technologies',
    takeaway: 'Autodesk positions Assistant, MCP Servers, and neural technology as the key AI surfaces; engineering automation should prefer those when product support and governance exist.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'Autodesk AI surface selection and product-support research before adapter buildout',
    mustConfirm: ['target product supports the selected AI surface', 'data/IP and permission requirements are acceptable'],
  }),
  fusionApi: officialRef({
    label: 'Autodesk Fusion API',
    url: 'https://help.autodesk.com/view/fusion360/ENU/?guid=GUID-A92A4B10-3781-4925-94C6-47DA85A4F65A',
    takeaway: 'Fusion automation should use scripts, add-ins, and the Fusion API for sketches, components, exports, and CAM-aware workflows.',
    sourceType: 'official_vendor',
    primaryUse: 'Fusion 360 scripts/add-ins for modeling, manufacturing, and export tasks',
    mustConfirm: ['Fusion is installed/licensed', 'active design and component/body selection are verified'],
  }),
  solidworksApi: officialRef({
    label: 'SOLIDWORKS API Help',
    url: 'https://help.solidworks.com/2025/English/api/sldworksapiprogguide/Welcome.htm',
    takeaway: 'SOLIDWORKS automation should use its documented API/COM model for parts, assemblies, drawings, dimensions, and exports before UI fallback.',
    sourceType: 'official_vendor',
    primaryUse: 'SOLIDWORKS parts, assemblies, drawings, dimensions, and export automation',
    mustConfirm: ['SOLIDWORKS is installed/licensed', 'document type and active configuration/sheet are verified'],
  }),
  solidworksMacros: officialRef({
    label: 'SOLIDWORKS macros',
    url: 'https://help.solidworks.com/2024/english/api/sldworksapiprogguide/gettingstarted/solidworks_macros.htm',
    takeaway: 'SOLIDWORKS macros are the fastest local bridge path for recording, editing, running, and hardening API-backed tasks before a full add-in is needed.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'SOLIDWORKS local macro/API proof, reusable automation recipes, dimension/feature/export workflows',
    mustConfirm: ['macro execution is approved', 'document type/configuration/sheet match the requested operation', 'macro result is verified before save/export'],
  }),
  matlabMcpCoreServer: officialRef({
    label: 'MATLAB MCP Core Server',
    url: 'https://www.mathworks.com/products/matlab-mcp-core-server.html',
    takeaway: 'MATLAB MCP Core Server lets an agent start/quit MATLAB, check code, evaluate code, run files/tests, and detect installed toolboxes through MCP.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'agentic MATLAB code execution, static analysis, tests, toolbox detection, and local MATLAB session control',
    mustConfirm: ['local MATLAB installation/license is available', 'MATLAB MCP server is installed/configured', 'toolboxes needed by the task are detected'],
  }),
  matlabAgenticToolkit: officialRef({
    label: 'MATLAB Agentic Toolkit',
    url: 'https://www.mathworks.com/products/matlab-agentic-toolkit.html',
    takeaway: 'MATLAB Agentic Toolkit combines MCP tools with curated skills for expert MATLAB workflows such as testing, debugging, app building, and code review.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'expert MATLAB workflow skills, idiomatic code generation, testing/debugging loops, and app/toolbox work',
    mustConfirm: ['toolkit is cloned/configured for the agent client', 'skills are loaded only for relevant MATLAB workflows', 'generated code is run or tested before completion'],
  }),
  matlabAiSkillEngineering: officialRef({
    label: 'MathWorks MATLAB AI skill engineering',
    url: 'https://blogs.mathworks.com/matlab/2026/05/11/how-to-engineer-an-ai-skill-for-matlab/',
    takeaway: 'MathWorks recommends skills that encode proven agent failure modes, front-load critical rules, and iterate through real run/test/debug evidence.',
    sourceType: 'official_vendor',
    lastReviewedAt: '2026-06-18',
    primaryUse: 'building or refining MATLAB task skills when generic prompts fail on subtle multi-step APIs',
    mustConfirm: ['the failing MATLAB workflow is reproduced first', 'skill rules target observed failures', 'generated MATLAB code is run/tested after skill changes'],
  }),
  rhinoCommon: officialRef({
    label: 'RhinoCommon guides',
    url: 'https://developer.rhino3d.com/guides/rhinocommon/',
    takeaway: 'Rhino tasks should prefer RhinoCommon or Rhino scripting APIs for geometry, layers, commands, and file operations.',
    sourceType: 'official_vendor',
    primaryUse: 'Rhino geometry, layer, command, and model automation',
    mustConfirm: ['Rhino is installed/licensed', 'active model units and selected objects/layers are verified'],
  }),
  revitApi: officialRef({
    label: 'Autodesk Revit API',
    url: 'https://aps.autodesk.com/developer/overview/revit-api',
    takeaway: 'Revit automation should use the Revit API/add-in model for BIM element/document work, with explicit approval before model mutations.',
    sourceType: 'official_vendor',
    primaryUse: 'Revit BIM document, family, view/sheet, and element automation',
    mustConfirm: ['Revit is installed/licensed', 'active model, worksharing state, and target view/sheet/family are verified'],
  }),
  inventorApi: officialRef({
    label: 'Autodesk Inventor API',
    url: 'https://help.autodesk.com/view/INVNTOR/2026/ENU/?guid=GUID-27CE5C15-7486-4E42-AC57-ACCC7BD2302C',
    takeaway: 'Inventor automation should use documented API/iLogic-style routes for parts, assemblies, drawings, parameters, and exports before desktop UI fallback.',
    sourceType: 'official_vendor',
    primaryUse: 'Inventor part/assembly/drawing parameter and export automation',
    mustConfirm: ['Inventor is installed/licensed', 'active document type, parameters, and file targets are verified'],
  }),
} satisfies Record<string, AppAutomationResearchRef>;

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalize(value: string): string {
  return String(value || '').toLowerCase();
}

function normalizeFacts(values: string[] | undefined): string[] {
  return (values || []).map((value) => normalize(value).replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function meaningfulTokens(value: string): string[] {
  const stopWords = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'be',
    'before',
    'by',
    'for',
    'from',
    'in',
    'is',
    'it',
    'local',
    'of',
    'or',
    'the',
    'to',
    'when',
    'with',
  ]);
  return unique(
    normalize(value)
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length > 2 && !stopWords.has(token)),
  );
}

function factCoversRequirement(requirement: string, facts: string[]): boolean {
  const normalizedRequirement = normalize(requirement).replace(/\s+/g, ' ').trim();
  if (!normalizedRequirement) return true;
  const requirementTokens = meaningfulTokens(normalizedRequirement);
  return facts.some((fact) => {
    if (!fact) return false;
    if (fact.includes(normalizedRequirement) || normalizedRequirement.includes(fact)) return true;
    const factTokens = new Set(meaningfulTokens(fact));
    const overlap = requirementTokens.filter((token) => factTokens.has(token)).length;
    return overlap >= Math.min(2, requirementTokens.length);
  });
}

function uncoveredRequirements(requirements: string[], facts: string[]): string[] {
  return unique(requirements).filter((requirement) => !factCoversRequirement(requirement, facts));
}

function refKeysForCandidate(id: AppAutomationControlSurfaceId): AppAutomationResearchRef[] {
  switch (id) {
    case 'adobe_indesign_uxp_dom':
      return [
        APP_AUTOMATION_RESEARCH_REFS.indesignUxpScripts,
        APP_AUTOMATION_RESEARCH_REFS.indesignUxpPlugins,
      ];
    case 'adobe_indesign_cloud_api':
      return [APP_AUTOMATION_RESEARCH_REFS.indesignApi];
    case 'adobe_photoshop_uxp_dom':
      return [
        APP_AUTOMATION_RESEARCH_REFS.photoshopUxpScripting,
        APP_AUTOMATION_RESEARCH_REFS.photoshopExecuteAsModal,
      ];
    case 'adobe_photoshop_batchplay':
      return [
        APP_AUTOMATION_RESEARCH_REFS.photoshopUxpScripting,
        APP_AUTOMATION_RESEARCH_REFS.photoshopExecuteAsModal,
      ];
    case 'adobe_photoshop_cloud_api':
      return [APP_AUTOMATION_RESEARCH_REFS.photoshopApi];
    case 'autocad_lisp_dotnet_api':
      return [
        APP_AUTOMATION_RESEARCH_REFS.autocadApi,
        APP_AUTOMATION_RESEARCH_REFS.autocadAutolisp,
        APP_AUTOMATION_RESEARCH_REFS.autocadDotNetApi,
      ];
    case 'autodesk_aps_automation_api':
      return [APP_AUTOMATION_RESEARCH_REFS.autodeskAutomationApi];
    case 'autodesk_ai_mcp_assistant':
      return [
        APP_AUTOMATION_RESEARCH_REFS.autodeskMcpServers,
        APP_AUTOMATION_RESEARCH_REFS.autodeskAssistant,
        APP_AUTOMATION_RESEARCH_REFS.autodeskAiKeyTechnologies,
        APP_AUTOMATION_RESEARCH_REFS.autodeskNeuralTechnology,
      ];
    case 'fusion_api_scripts_addins':
      return [APP_AUTOMATION_RESEARCH_REFS.fusionApi];
    case 'solidworks_com_api':
      return [
        APP_AUTOMATION_RESEARCH_REFS.solidworksApi,
        APP_AUTOMATION_RESEARCH_REFS.solidworksMacros,
      ];
    case 'matlab_mcp_agentic_toolkit':
      return [
        APP_AUTOMATION_RESEARCH_REFS.matlabMcpCoreServer,
        APP_AUTOMATION_RESEARCH_REFS.matlabAgenticToolkit,
        APP_AUTOMATION_RESEARCH_REFS.matlabAiSkillEngineering,
      ];
    case 'rhino_common_api':
      return [APP_AUTOMATION_RESEARCH_REFS.rhinoCommon];
    case 'revit_api_addin':
      return [APP_AUTOMATION_RESEARCH_REFS.revitApi];
    case 'inventor_api_ilogic':
      return [APP_AUTOMATION_RESEARCH_REFS.inventorApi];
    case 'browser_dom_cdp':
      return [
        APP_AUTOMATION_RESEARCH_REFS.chromeDevtoolsProtocol,
        APP_AUTOMATION_RESEARCH_REFS.chromeDevtoolsProtocolMonitor,
        APP_AUTOMATION_RESEARCH_REFS.playwrightLocators,
        APP_AUTOMATION_RESEARCH_REFS.playwrightActionability,
      ];
    case 'macos_apple_events':
      return [
        APP_AUTOMATION_RESEARCH_REFS.appleAutomation,
        APP_AUTOMATION_RESEARCH_REFS.appleUiScripting,
      ];
    case 'os_accessibility':
      return [
        APP_AUTOMATION_RESEARCH_REFS.appleUiScripting,
        APP_AUTOMATION_RESEARCH_REFS.windowsUiAutomation,
      ];
    default:
      return [];
  }
}

function candidate(
  id: AppAutomationControlSurfaceId,
  label: string,
  rank: number,
  fit: AppAutomationControlSurfaceCandidate['fit'],
  bestFor: string[],
  requirements: string[],
  avoidWhen: string[],
  approvalBefore: string[],
  verification: string[],
): AppAutomationControlSurfaceCandidate {
  return {
    id,
    label,
    rank,
    fit,
    bestFor,
    requirements,
    avoidWhen,
    approvalBefore,
    verification,
    sourceRefs: refKeysForCandidate(id),
  };
}

function detectTarget(task: string, preferred?: Partial<Pick<AppAutomationControlSurfacePlan, 'targetId' | 'targetName'>>): Pick<AppAutomationControlSurfacePlan, 'targetId' | 'targetName' | 'taskFamily'> {
  if (preferred?.targetId && preferred?.targetName) {
    if (preferred.targetId === 'generic_native_app') {
      const genericContext = buildGenericAppNavigatorRouteContext(task, {
        targetAppName: preferred.targetName,
        fallbackTargetAppName: 'Native desktop app',
      });
      return {
        targetId: preferred.targetId,
        targetName: genericContext.targetAppName,
        taskFamily: genericContext.taskFamilyLabel,
      };
    }
    return {
      targetId: preferred.targetId,
      targetName: preferred.targetName,
      taskFamily: taskFamilyFor(task, preferred.targetId),
    };
  }
  const text = normalize(task);
  if (/\b(indesign|in\s*design|\.indd\b|\.idml\b|\.indt\b|data merge|package for print|preflight)\b/i.test(text)) {
    return { targetId: 'adobe_indesign', targetName: 'Adobe InDesign', taskFamily: taskFamilyFor(task, 'adobe_indesign') };
  }
  if (/\b(photoshop|photo\s*shop|\.psd\b|\.psb\b|generative fill|content-aware|smart object)\b/i.test(text)) {
    return { targetId: 'adobe_photoshop', targetName: 'Adobe Photoshop', taskFamily: taskFamilyFor(task, 'adobe_photoshop') };
  }
  if (/\badobe\b|\bcreative\s+cloud\b/i.test(text)) {
    return { targetId: 'adobe_creative_cloud', targetName: preferred?.targetName || 'Adobe Creative Cloud app', taskFamily: taskFamilyFor(task, 'adobe_creative_cloud') };
  }
  if (isEngineeringCadTask(text)) {
    const targetName = preferred?.targetName || detectCadTargetName(text);
    return { targetId: 'engineering_cad_app', targetName, taskFamily: taskFamilyFor(task, 'engineering_cad_app') };
  }
  if (/\b(browser|website|web app|chrome|edge|safari|firefox|dom|page)\b/i.test(text)) {
    return { targetId: 'browser_app', targetName: preferred?.targetName || 'Browser app', taskFamily: taskFamilyFor(task, 'browser_app') };
  }
  const genericContext = buildGenericAppNavigatorRouteContext(task, {
    targetAppName: preferred?.targetName,
    fallbackTargetAppName: 'Native desktop app',
  });
  return {
    targetId: 'generic_native_app',
    targetName: genericContext.targetAppName,
    taskFamily: genericContext.taskFamilyLabel,
  };
}

function isEngineeringCadTask(text: string): boolean {
  return /\b(auto\s*cad|autocad|civil\s*3d|fusion(?:\s*360)?|solid\s*works|solidworks|matlab|mathworks|simulink|simscape|revit|rhino(?:ceros)?|inventor|free\s*cad|freecad|libre\s*cad|librecad|qcad|sketch\s*up|sketchup|cad|dwg|dxf|rvt|rfa|sldprt|sldasm|slddrw|iges|igs|f3d|f3z|3dm|mlx|slx|engineering drawing|technical drawing|floor plan|site plan|shop drawing|dimensioned drawing|bim|model space|paper space)\b|\.(?:step|stp|mlx|slx|mdl)\b|\b(?:step|stp)\s+file\b/i.test(text);
}

function detectCadTargetName(text: string): string {
  if (/\b(auto\s*cad|autocad|civil\s*3d|dwg|dxf|model space|paper space)\b/i.test(text)) return 'AutoCAD / DWG CAD app';
  if (/\bfusion(?:\s*360)?\b|\bf3d\b|\bf3z\b/i.test(text)) return 'Autodesk Fusion';
  if (/\bsolid\s*works|solidworks|sldprt|sldasm|slddrw\b/i.test(text)) return 'SOLIDWORKS';
  if (/\b(matlab|mathworks|simulink|simscape|mlx|slx)\b|\.(?:m|mlx|slx|mdl)\b/i.test(text)) return 'MATLAB / Simulink';
  if (/\brevit|rvt|rfa|bim\b/i.test(text)) return 'Autodesk Revit';
  if (/\brhino(?:ceros)?|\b3dm\b/i.test(text)) return 'Rhino';
  if (/\binventor\b|\bipt\b|\biam\b|\bidw\b|\bdwg\b/i.test(text)) return 'Autodesk Inventor';
  if (/\bfree\s*cad|freecad\b/i.test(text)) return 'FreeCAD';
  if (/\blibre\s*cad|librecad\b/i.test(text)) return 'LibreCAD';
  if (/\bqcad\b/i.test(text)) return 'QCAD';
  if (/\bsketch\s*up|sketchup\b/i.test(text)) return 'SketchUp';
  return 'Engineering/CAD app';
}

function taskFamilyFor(task: string, targetId: AppAutomationTargetId): string {
  const text = normalize(task);
  if (targetId === 'adobe_indesign') {
    if (/\b(package|handoff|preflight|links?|fonts?)\b/i.test(text)) return 'layout package/preflight';
    if (/\b(data merge|variable|variants?|csv)\b/i.test(text)) return 'layout data merge';
    if (/\b(export|proof|pdf|rendition|preview)\b/i.test(text)) return 'layout proof/export';
    return 'layout document mutation';
  }
  if (targetId === 'adobe_photoshop') {
    if (/\b(generative|content-aware|remove|erase|background|inpaint|outpaint)\b/i.test(text)) return 'localized/generative image edit';
    if (/\b(smart object|place|asset|logo|linked|embedded)\b/i.test(text)) return 'layered asset update';
    if (/\b(export|proof|png|jpg|jpeg|webp|rendition)\b/i.test(text)) return 'raster proof/export';
    return 'layered raster mutation';
  }
  if (targetId === 'browser_app') return 'browser semantic workflow';
  if (targetId === 'adobe_creative_cloud') return 'Adobe app capability buildout';
  if (targetId === 'engineering_cad_app') {
    if (/\b(matlab|mathworks|simulink|simscape|mlx|slx)\b|\.(?:m|mlx|slx|mdl)\b/i.test(text)) {
      if (/\b(simulink|simscape|simulate|simulation|model|block|solver|stateflow)\b/i.test(text)) return 'MATLAB/Simulink simulation workflow';
      if (/\b(app designer|app building|gui|toolbox|package|deploy|code review|debug|test|unit test|runtests)\b/i.test(text)) return 'MATLAB code/test/app workflow';
      return 'MATLAB engineering computation';
    }
    if (/\b(export|plot|publish|print|pdf|dxf|dwg|step|stp|iges|igs|stl|sat|convert|translate)\b/i.test(text)) return 'CAD export/translation';
    if (/\b(inspect|measure|dimension|units?|scale|verify|check|review|markup|redline)\b/i.test(text)) return 'CAD inspection/measurement';
    if (/\b(floor plan|site plan|shop drawing|technical drawing|title block|revision cloud|detail|paper space|model space|2d)\b/i.test(text)) return '2D drafting/documentation';
    if (/\b(part|assembly|component|body|sketch|extrude|loft|cam|toolpath|manufacturing|bim|family|view|sheet|model)\b/i.test(text)) return 'model/BIM/CAM mutation';
    return 'engineering/CAD document mutation';
  }
  return 'unfamiliar native app workflow';
}

function photoshopCandidates(task: string): AppAutomationControlSurfaceCandidate[] {
  const text = normalize(task);
  const candidates: AppAutomationControlSurfaceCandidate[] = [
    candidate(
      'adobe_photoshop_uxp_dom',
      'Photoshop UXP DOM/app API in modal scope',
      100,
      'primary',
      ['document status', 'layer inventory', 'text layers', 'smart-object placement', 'proof export', 'safe local file mutation'],
      ['Photoshop installed', 'local desktop bridge', 'UXP/script-capable bridge tool', 'executeAsModal-style mutation scope', 'local file grants'],
      ['request is high-volume cloud batch processing without local app state', 'Photoshop is not installed or licensed'],
      ['text/layer mutation', 'placing assets', 'save/export/write'],
      ['refreshed document status', 'refreshed layer inventory', 'raster proof or screenshot', 'file_stat for outputs'],
    ),
  ];
  if (/\b(generative|content-aware|action|select subject|mask|selection|remove|erase|background|batchplay)\b/i.test(text)) {
    candidates.push(candidate(
      'adobe_photoshop_batchplay',
      'Photoshop batchPlay/action descriptor',
      92,
      'secondary',
      ['commands not exposed cleanly by the DOM', 'known Photoshop actions', 'selection/mask/generative command routing'],
      ['fresh document/layer inventory', 'modal execution scope', 'known action descriptor or reusable bridge adapter'],
      ['a DOM bridge tool already expresses the command', 'the target selection/mask is ambiguous'],
      ['generative/content-aware action', 'destructive pixel edit', 'new action/script execution'],
      ['selection/mask evidence before action', 'before/after layer inventory', 'raster proof'],
    ));
  }
  candidates.push(
    candidate(
      'adobe_photoshop_cloud_api',
      'Adobe Photoshop cloud API',
      74,
      'secondary',
      ['renditions', 'smart-object automation', 'remove-background/image operations', 'server-side repeatable pipelines'],
      ['explicit upload/source-file approval', 'output destination approval', 'API credentials/integration', 'privacy-safe asset handling'],
      ['the task depends on the currently open local Photoshop UI state', 'user has not approved upload or output writes'],
      ['uploading source assets', 'generative/cloud processing', 'writing output files'],
      ['API job status', 'downloaded output file_stat', 'visual proof artifact'],
    ),
    candidate(
      'semantic_desktop',
      'Semantic desktop/menu/a11y fallback',
      45,
      'fallback',
      ['known menu commands', 'focus/launch', 'read-only visual inspection', 'gaps between script-backed tools'],
      ['fresh window state', 'fresh accessibility tree or menu inventory', 'fresh screenshot for canvas state'],
      ['the action can mutate a layer/file through an existing script-backed tool', 'target UI element is not semantically identified'],
      ['menu command that mutates document', 'save/export/share'],
      ['window/app state after action', 'screenshot proof', 'file_stat when files change'],
    ),
    candidate(
      'screenshot_coordinate_fallback',
      'Screenshot and coordinate fallback',
      10,
      'last_resort',
      ['single reversible visual step after all semantic/app-native routes fail'],
      ['fresh screenshot', 'screen size', 'target bounding box', 'bounded retry guard'],
      ['the task can be expressed through DOM/script/a11y/menu', 'the action is destructive or ambiguous'],
      ['any document mutation', 'save/export/delete/rasterize/flatten'],
      ['new screenshot immediately after the step', 'stop if the expected state is not visible'],
    ),
    connectedAgentCandidate(),
  );
  return rankCandidates(candidates);
}

function indesignCandidates(): AppAutomationControlSurfaceCandidate[] {
  return rankCandidates([
    candidate(
      'adobe_indesign_uxp_dom',
      'InDesign UXP script/plugin DOM',
      100,
      'primary',
      ['document status', 'layer/text-frame inventory', 'find/change', 'link relink/update', 'PDF proof export', 'package handoff'],
      ['InDesign installed', 'local desktop bridge', 'UXP/script-capable bridge tool', 'local file grants for source/assets/output'],
      ['task is a cloud-only data-merge/rendition pipeline with no local app dependency', 'InDesign is not installed or licensed'],
      ['copy/link/layer mutation', 'relinking assets', 'save/export/package/write'],
      ['refreshed document status', 'text/link/font inventory', 'proof/package file_stat', 'package report summary'],
    ),
    candidate(
      'adobe_indesign_cloud_api',
      'Adobe InDesign cloud API',
      78,
      'secondary',
      ['document info', 'renditions', 'data merge', 'custom scripts in a repeatable cloud pipeline'],
      ['explicit source upload approval', 'output destination approval', 'API credentials/integration', 'privacy-safe asset handling'],
      ['the task depends on the currently open local InDesign UI state', 'linked package assets are not resolved or approved for upload'],
      ['uploading source/package assets', 'running custom scripts', 'writing rendered outputs'],
      ['API job status', 'document/rendition metadata', 'downloaded output file_stat'],
    ),
    candidate(
      'macos_apple_events',
      'macOS Apple Events/AppleScript',
      50,
      'fallback',
      ['scriptable app commands when UXP bridge is missing', 'launch/focus/open/save/export wrappers with explicit targets'],
      ['macOS automation permission', 'scriptable command surface', 'exact file/document target'],
      ['a UXP DOM bridge tool already expresses the action', 'the command only exists as an unlabeled visual UI action'],
      ['running new scripts', 'save/export/package/write'],
      ['script result', 'document status after action', 'file_stat for outputs'],
    ),
    candidate(
      'semantic_desktop',
      'Semantic desktop/menu/a11y fallback',
      40,
      'fallback',
      ['known menu commands', 'read-only visual proof', 'recovering focus/dialog state'],
      ['fresh window state', 'fresh accessibility tree/menu inventory', 'fresh screenshot'],
      ['editing text/links/layers can be handled by UXP/DOM', 'target is ambiguous'],
      ['menu command that mutates document', 'save/export/package'],
      ['window/app state after action', 'proof screenshot', 'file_stat when files change'],
    ),
    candidate(
      'screenshot_coordinate_fallback',
      'Screenshot and coordinate fallback',
      10,
      'last_resort',
      ['single reversible visual step after all semantic/app-native routes fail'],
      ['fresh screenshot', 'screen size', 'target bounding box', 'bounded retry guard'],
      ['the task can be expressed through DOM/script/a11y/menu', 'the action is destructive or ambiguous'],
      ['any document mutation', 'save/export/package/delete'],
      ['new screenshot immediately after the step', 'stop if expected state is not visible'],
    ),
    connectedAgentCandidate(),
  ]);
}

function broadAdobeCandidates(): AppAutomationControlSurfaceCandidate[] {
  return rankCandidates([
    candidate(
      'vendor_script_or_plugin_api',
      'Documented Adobe app script/plugin/action surface',
      92,
      'primary',
      ['app-native project/document state', 'batch/action/plugin workflows', 'repeatable render/export pipelines'],
      ['official vendor docs or existing repo recipe', 'exact app profile', 'exact source/output files', 'bridge adapter or connected-agent buildout'],
      ['no documented API exists and semantic desktop state is sufficient for a reversible step'],
      ['new scripts/plugins/actions', 'project/timeline/document mutation', 'render/export/write'],
      ['app-native inventory when available', 'render/export file_stat', 'screenshot proof'],
    ),
    candidate(
      'semantic_desktop',
      'Semantic desktop/menu/a11y fallback',
      45,
      'fallback',
      ['launch/focus', 'menu-backed exports', 'visible dialog workflows', 'adapter discovery'],
      ['fresh window state', 'fresh accessibility tree or menu inventory', 'fresh screenshot'],
      ['native app adapter can perform the action deterministically', 'target control is visually ambiguous'],
      ['mutating project/document state', 'render/export/share'],
      ['app/window state after action', 'screenshot proof', 'output file_stat'],
    ),
    candidate(
      'connected_agent_buildout',
      'Connected-agent app adapter buildout',
      35,
      'fallback',
      ['missing adapter/tool/recipe', 'unfamiliar Adobe product operation', 'turning a successful manual recipe into code'],
      ['connected Codex/agent bridge', 'official-source research', 'focused smoke case', 'bounded retry plan'],
      ['the existing profile already has a verified app-native bridge tool for the operation'],
      ['changing runtime/bridge code', 'running new scripts/plugins', 'retrying the original user task'],
      ['smoke test result', 'files changed', 'source refs', 'retry prompt'],
    ),
  ]);
}

function engineeringCadCandidates(task: string): AppAutomationControlSurfaceCandidate[] {
  const text = normalize(task);
  const candidates: AppAutomationControlSurfaceCandidate[] = [];
  const hasKnownCadApp = /\b(auto\s*cad|autocad|civil\s*3d|fusion(?:\s*360)?|solid\s*works|solidworks|matlab|mathworks|simulink|simscape|revit|rhino(?:ceros)?|inventor|free\s*cad|freecad|libre\s*cad|librecad|qcad|sketch\s*up|sketchup)\b/i.test(text);
  const needsBatchOrCloud = /\b(batch|server|cloud|api|convert|translate|rendition|pipeline|many files|folder of|bulk)\b/i.test(text);
  const isAutodeskTask = /\b(autodesk|auto\s*cad|autocad|civil\s*3d|fusion(?:\s*360)?|revit|inventor|forma|dwg|dxf|rvt|f3d|f3z|ipt|iam|idw)\b/i.test(text);
  const asksAutodeskAiSurface = /\b(autodesk\s+ai|autodesk\s+assistant|mcp|model context protocol|neural\s+cad|agentic|assistant)\b/i.test(text);

  if (!hasKnownCadApp || /\b(auto\s*cad|autocad|civil\s*3d|dwg|dxf|model space|paper space|cad)\b/i.test(text)) {
    candidates.push(candidate(
      'autocad_lisp_dotnet_api',
      'AutoCAD API / AutoLISP / command script surface',
      /\b(auto\s*cad|autocad|civil\s*3d|dwg|dxf|model space|paper space)\b/i.test(text) ? 100 : 86,
      /\b(auto\s*cad|autocad|civil\s*3d|dwg|dxf|model space|paper space)\b/i.test(text) ? 'primary' : 'secondary',
      ['DWG/DXF inspection', 'typed command automation', '2D drafting edits', 'dimension/layer/title-block operations', 'plot/export workflows'],
      ['AutoCAD or compatible Autodesk runtime', 'active drawing identity', 'verified units/scale/layers', 'approved script or command execution'],
      ['the task is a Fusion/SOLIDWORKS/Rhino/Revit-specific model operation', 'script execution is not approved'],
      ['running AutoLISP/scripts/macros', 'creating or editing geometry', 'plot/export/save/write'],
      ['command prompt/result transcript', 'drawing units/layers/dimensions rechecked', 'screenshot proof', 'file_stat for outputs'],
    ));
  }

  if (isAutodeskTask || asksAutodeskAiSurface) {
    candidates.push(candidate(
      'autodesk_ai_mcp_assistant',
      'Autodesk Assistant / MCP / AI execution surface',
      asksAutodeskAiSurface ? 108 : 68,
      asksAutodeskAiSurface ? 'primary' : 'secondary',
      ['governed Autodesk agent workflows', 'Fusion MCP direct design interaction when available', 'Autodesk product-help grounding', 'Assistant-supported text-to-command flows', 'AI-assisted geometry research'],
      ['target Autodesk product/version identified', 'specific MCP server or Assistant capability confirmed', 'permissions/execution boundary configured', 'result remains editable in the Autodesk product'],
      ['the target product has no released MCP/Assistant support for the requested action', 'a local AutoCAD/Fusion/Revit/Inventor API route is more deterministic', 'the task needs offline file mutation without approved cloud/service access'],
      ['AI/MCP tool execution', 'cloud or Assistant action', 'geometry/model/drawing mutation', 'save/export/write'],
      ['MCP/Assistant tool result or job status', 'active product/document state recheck', 'editable geometry/model proof', 'file_stat for outputs'],
    ));
  }

  if (/\bfusion(?:\s*360)?\b|\bf3d\b|\bf3z\b|\bcam\b|\btoolpath\b/i.test(text)) {
    candidates.push(candidate(
      'fusion_api_scripts_addins',
      'Fusion API script/add-in surface',
      100,
      'primary',
      ['sketch/component/body edits', 'manufacturing/CAM workflows', '3D model export', 'parameterized design changes'],
      ['Fusion installed', 'active design/component/body selection verified', 'approved script/add-in execution'],
      ['the file is a DWG-only drafting task better handled by AutoCAD', 'the model selection is ambiguous'],
      ['running scripts/add-ins', 'geometry mutation', 'CAM/toolpath changes', 'export/write'],
      ['design/component state after action', 'units/selection recheck', 'export file_stat', 'visual model proof'],
    ));
  }

  if (/\bsolid\s*works|solidworks|sldprt|sldasm|slddrw\b/i.test(text)) {
    candidates.push(candidate(
      'solidworks_com_api',
      'SOLIDWORKS API/COM model surface',
      100,
      'primary',
      ['part/assembly/drawing edits', 'dimensions/configurations', 'drawing-sheet updates', 'exports'],
      ['SOLIDWORKS installed', 'active document type/configuration/sheet verified', 'approved macro/API execution'],
      ['the task only needs a reversible visual read', 'document type or active configuration is unknown'],
      ['running macros/API calls', 'dimension/feature mutation', 'save/export/write'],
      ['document type/configuration recheck', 'dimension/feature/drawing state evidence', 'screenshot proof', 'file_stat for outputs'],
    ));
  }

  if (/\b(matlab|mathworks|simulink|simscape|mlx|slx)\b|\.(?:m|mlx|slx|mdl)\b/i.test(text)) {
    candidates.push(candidate(
      'matlab_mcp_agentic_toolkit',
      'MATLAB MCP / Agentic Toolkit surface',
      100,
      'primary',
      ['MATLAB code generation and execution', 'static analysis and tests', 'toolbox-aware workflows', 'Simulink/Simscape model scripts', 'MATLAB app/toolbox buildout'],
      ['MATLAB installed/licensed', 'MATLAB MCP Core Server configured or MATLAB CLI/session available', 'working folder/project verified', 'required toolboxes detected', 'approved generated-code or model execution'],
      ['MATLAB license/session is unavailable', 'the task is a DWG/SOLIDWORKS/Revit model edit better handled by the CAD app API', 'the code would access external systems or overwrite files without approval'],
      ['running generated MATLAB code', 'mutating .m/.mlx/.slx/.mdl files', 'long simulations', 'writing plots/reports/models/exports', 'installing packages/toolboxes'],
      ['check_matlab_code or equivalent static-analysis result', 'run_matlab_file/test result or command output', 'detected toolbox/version evidence', 'output file_stat or MATLAB figure/model proof'],
    ));
  }

  if (/\brevit|rvt|rfa|bim\b/i.test(text)) {
    candidates.push(candidate(
      'revit_api_addin',
      'Revit API/add-in model surface',
      100,
      'primary',
      ['BIM element/document edits', 'families', 'views/sheets', 'model data extraction', 'controlled export'],
      ['Revit installed', 'active model/worksharing state verified', 'target view/sheet/family/element identity', 'approved add-in/API execution'],
      ['the task is a standalone DWG drafting edit', 'worksharing/model-lock state is unclear'],
      ['running add-ins/API commands', 'model/family mutation', 'save/sync/export/write'],
      ['active model/view/sheet evidence', 'element/family count or target state recheck', 'proof/export file_stat'],
    ));
  }

  if (/\brhino(?:ceros)?|\b3dm\b/i.test(text)) {
    candidates.push(candidate(
      'rhino_common_api',
      'RhinoCommon/script command surface',
      100,
      'primary',
      ['NURBS/mesh geometry edits', 'layer/object operations', 'model inspection', 'exports'],
      ['Rhino installed', 'active model units verified', 'target objects/layers selected or named', 'approved script/command execution'],
      ['object identity or selection cannot be verified', 'the task is a BIM/Revit-specific element mutation'],
      ['running scripts/commands', 'geometry mutation', 'export/write'],
      ['units/object/layer recheck', 'command result transcript', 'visual model proof', 'file_stat for outputs'],
    ));
  }

  if (/\binventor\b|\bipt\b|\biam\b|\bidw\b/i.test(text)) {
    candidates.push(candidate(
      'inventor_api_ilogic',
      'Inventor API/iLogic-style automation surface',
      100,
      'primary',
      ['part/assembly/drawing edits', 'parameters', 'iProperties', 'drawing/export automation'],
      ['Inventor installed', 'active document type verified', 'parameters and file targets identified', 'approved automation execution'],
      ['the file is a Revit BIM model or Rhino geometry task', 'parameter/document identity is ambiguous'],
      ['running rules/scripts/API calls', 'parameter/model mutation', 'save/export/write'],
      ['document/parameter state recheck', 'visual proof', 'file_stat for outputs'],
    ));
  }

  if (needsBatchOrCloud || /\b(autodesk|dwg|dxf|rvt|f3d|f3z|inventor|revit|autocad|fusion)\b/i.test(text)) {
    candidates.push(candidate(
      'autodesk_aps_automation_api',
      'Autodesk Platform Services cloud automation',
      needsBatchOrCloud ? 78 : 64,
      needsBatchOrCloud ? 'secondary' : 'fallback',
      ['repeatable Autodesk file processing', 'bulk conversion/rendition', 'server-side design automation with approved uploads'],
      ['explicit upload approval', 'APS credentials/integration', 'source/output file grants', 'job status polling'],
      ['the task depends on the user-visible local app session', 'upload or API credential approval is missing'],
      ['uploading source design files', 'cloud processing', 'writing/downloading outputs'],
      ['API job status', 'downloaded output file_stat', 'source/output identity evidence'],
    ));
  }

  candidates.push(
    candidate(
      'vendor_script_or_plugin_api',
      'Documented CAD vendor script/plugin/CLI/API surface',
      hasKnownCadApp ? 72 : 92,
      hasKnownCadApp ? 'secondary' : 'primary',
      ['CAD apps without a dedicated adapter yet', 'official SDK/plugin/CLI routes', 'file-format transforms', 'repeatable app recipes'],
      ['official vendor docs or existing repo recipe', 'exact app/file/operation', 'verified units/document state', 'focused smoke coverage'],
      ['a dedicated AutoCAD/Fusion/SOLIDWORKS/Rhino/Revit/Inventor route already fits', 'only a read-only visual inspection is needed'],
      ['new scripts/plugins/macros', 'geometry/document mutation', 'export/share/save/write'],
      ['structured command/API result', 'units/document recheck', 'file_stat/output proof', 'screenshot proof'],
    ),
    candidate(
      'os_accessibility',
      'OS accessibility control tree',
      52,
      'secondary',
      ['named CAD dialogs', 'menus/toolbars/panels', 'file open/save/export workflows when API tools are missing'],
      ['fresh accessibility tree', 'active app/window/document identity', 'target control name/role/value', 'bounded retry guard'],
      ['vendor/app-native API can perform the operation', 'target is canvas-only or unnamed'],
      ['click/type/key actions that mutate drawings/models', 'save/export/share'],
      ['a11y tree after action', 'screenshot proof', 'file_stat for outputs'],
    ),
    candidate(
      'semantic_desktop',
      'Semantic desktop/menu/command-line fallback',
      42,
      'fallback',
      ['app launch/focus', 'known menu paths', 'CAD command-line workflows after state is verified'],
      ['fresh window state', 'fresh menu/a11y inventory', 'fresh screenshot', 'command prompt state when applicable'],
      ['target app/document/units are not confirmed', 'the operation has no semantic target'],
      ['mutating drawing/model state', 'file write/export/share'],
      ['window/app state after action', 'command prompt/status evidence', 'proof screenshot', 'output file_stat'],
    ),
    candidate(
      'screenshot_coordinate_fallback',
      'Screenshot and coordinate fallback',
      10,
      'last_resort',
      ['one reversible visual step after app-native, command, menu, and accessibility routes fail'],
      ['fresh screenshot', 'screen size', 'target bounding box', 'bounded retry guard', 'rollback/stop condition'],
      ['any semantic/app-native route exists', 'the action is geometry-destructive, irreversible, or ambiguous'],
      ['any mutation or final action'],
      ['new screenshot after action', 'stop if expected state is not visible'],
    ),
    connectedAgentCandidate(),
  );
  return rankCandidates(candidates);
}

function browserCandidates(): AppAutomationControlSurfaceCandidate[] {
  return rankCandidates([
    candidate(
      'browser_dom_cdp',
      'Browser DOM/CDP/ARIA/locator control',
      100,
      'primary',
      ['web apps', 'forms', 'uploads/downloads', 'page extraction', 'network/runtime state', 'locator-grounded browser actions'],
      ['browser bridge or Browserbase session', 'fresh DOM/ARIA snapshot', 'role/label/text/test-id locator candidates', 'actionability checks', 'origin/session policy'],
      ['native desktop app surface is required', 'human verification blocks automation'],
      ['credential use', 'submit/publish/pay/send/delete', 'external upload'],
      ['DOM state after action', 'URL/title/confirmation', 'locator/actionability result', 'download/upload file_stat', 'screenshot proof when visual'],
    ),
    candidate(
      'semantic_desktop',
      'Semantic desktop fallback',
      35,
      'fallback',
      ['browser chrome/file chooser gaps when DOM upload is unavailable'],
      ['fresh a11y tree', 'fresh screenshot', 'scoped local file grants'],
      ['DOM or browser upload API is available', 'bot verification or MFA is blocking'],
      ['file chooser selection', 'download overwrite', 'credential use'],
      ['DOM recheck', 'download/upload file_stat', 'screenshot proof'],
    ),
    connectedAgentCandidate(),
  ]);
}

function genericNativeCandidates(task: string): AppAutomationControlSurfaceCandidate[] {
  const navigatorContext = buildGenericAppNavigatorRouteContext(task);
  const navigatorPlan = navigatorContext.plan;
  return rankCandidates([
    candidate(
      'vendor_script_or_plugin_api',
      'Vendor script/plugin/CLI/API surface',
      90,
      'primary',
      ['documented app APIs', 'command palettes/CLIs', 'plugin SDKs', 'file-format transformations', 'reusable adapter buildout for repeated unfamiliar-app tasks'],
      ['official docs or existing repo recipe', 'exact app/file/operation', 'focused smoke coverage', `generic app navigator task family: ${navigatorPlan.taskFamily} (${navigatorContext.taskFamilyLabel})`],
      ['only a reversible focus/open/read step is needed and no adapter exists yet'],
      ['running new scripts/plugins/macros', 'file/project mutation', 'export/share/delete'],
      ['structured tool result', 'file_stat/output proof', 'app state after action'],
    ),
    candidate(
      'os_accessibility',
      'OS accessibility control tree',
      55,
      'secondary',
      ['native controls', 'menus', 'named fields/buttons', 'dialog workflows'],
      ['Accessibility permission', 'fresh a11y tree', 'target control name/role/value', 'bounded retry guard', 'one bounded semantic step before verification'],
      ['vendor/app-native API is available', 'the UI element is canvas-only or unnamed'],
      ['click/type/key actions that mutate state', 'save/export/share'],
      ['a11y tree after action', 'screenshot proof', 'file_stat for outputs'],
    ),
    candidate(
      'semantic_desktop',
      'Semantic desktop and menu control',
      42,
      'fallback',
      ['known shortcuts/menu paths', 'window focus/recovery', 'read-only app status', 'generic app navigator recovery after a stale control tree'],
      ['fresh window state', 'fresh menu/a11y inventory', 'fresh screenshot for visual state', 'verified focus before typing or shortcuts'],
      ['target app/document is not confirmed', 'the operation has no semantic target'],
      ['mutating app state', 'file write/export/share'],
      ['window/app state after action', 'proof screenshot', 'output file_stat'],
    ),
    candidate(
      'screenshot_coordinate_fallback',
      'Screenshot and coordinate fallback',
      10,
      'last_resort',
      ['one reversible visual step when no semantic control exists'],
      ['fresh screenshot', 'screen size', 'target bounding box', 'bounded retry guard', 'immediate verification observation'],
      ['any semantic/app-native route exists', 'the action is destructive or irreversible'],
      ['any mutation or final action'],
      ['new screenshot after action', 'stop on mismatch'],
    ),
    connectedAgentCandidate(),
  ]).map((surface) => ({
    ...surface,
    sourceRefs: uniqueRefs([...surface.sourceRefs, ...GENERIC_APP_NAVIGATOR_SOURCE_REFS]),
  }));
}

function connectedAgentCandidate(): AppAutomationControlSurfaceCandidate {
  return candidate(
    'connected_agent_buildout',
    'Connected-agent capability buildout',
    30,
    'fallback',
    ['missing app recipe', 'missing bridge tool', 'unknown app command surface', 'turning research into a reusable adapter'],
    ['connected coding agent', 'official-source research', 'small scoped implementation', 'smoke test', 'bounded retry prompt'],
    ['the existing runtime can complete the task with a verified deterministic control surface'],
    ['patching runtime/bridge code', 'running generated scripts/actions/plugins', 'retrying the user task'],
    ['source refs', 'files changed', 'focused smoke pass', 'ready-to-retry contract'],
  );
}

function rankCandidates(candidates: AppAutomationControlSurfaceCandidate[]): AppAutomationControlSurfaceCandidate[] {
  return candidates.slice().sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label));
}

function uniqueRefs(refs: AppAutomationResearchRef[]): AppAutomationResearchRef[] {
  const seen = new Set<string>();
  const result: AppAutomationResearchRef[] = [];
  for (const ref of refs) {
    if (!ref.url || seen.has(ref.url)) continue;
    seen.add(ref.url);
    result.push(ref);
  }
  return result;
}

function formatResearchRefForPrompt(ref: AppAutomationResearchRef): string {
  const meta = [
    ref.sourceType ? `source: ${ref.sourceType}` : '',
    ref.lastReviewedAt ? `reviewed: ${ref.lastReviewedAt}` : '',
    ref.primaryUse ? `use: ${ref.primaryUse}` : '',
  ].filter(Boolean).join('; ');
  const checks = ref.mustConfirm && ref.mustConfirm.length > 0
    ? ` Confirm: ${ref.mustConfirm.join(' | ')}.`
    : '';
  return `- ${ref.label}${meta ? ` (${meta})` : ''}: ${ref.url} - ${ref.takeaway}${checks}`;
}

export function listAppAutomationResearchRefs(): AppAutomationResearchRef[] {
  return uniqueRefs(Object.values(APP_AUTOMATION_RESEARCH_REFS));
}

export function buildAppAutomationResearchPromptBlock(
  task: string,
  options: { maxRefs?: number; preferred?: Partial<Pick<AppAutomationControlSurfacePlan, 'targetId' | 'targetName'>> } = {},
): string {
  const plan = buildAppAutomationControlSurfacePlan(task, options.preferred);
  const refs = plan.sourceRefs.slice(0, Math.max(1, options.maxRefs || 8));
  return [
    '## Official App Automation Research',
    `Target: ${plan.targetName}`,
    `Task family: ${plan.taskFamily}`,
    'Primary-source refs to use before blogs or examples:',
    ...(refs.length ? refs.map(formatResearchRefForPrompt) : ['- none']),
    'Research contract:',
    '- prefer official vendor, OS, framework, and protocol docs before examples or blogs',
    '- verify the target app version, permissions, install/license state, active document identity, and required file grants before mutation',
    '- preserve source refs, chosen control surface, verification output, and retry plan in the connected-agent result',
  ].join('\n');
}

function candidatesForTarget(targetId: AppAutomationTargetId, task: string): AppAutomationControlSurfaceCandidate[] {
  switch (targetId) {
    case 'adobe_indesign':
      return indesignCandidates();
    case 'adobe_photoshop':
      return photoshopCandidates(task);
    case 'adobe_creative_cloud':
      return broadAdobeCandidates();
    case 'engineering_cad_app':
      return engineeringCadCandidates(task);
    case 'browser_app':
      return browserCandidates();
    case 'generic_native_app':
    default:
      return genericNativeCandidates(task);
  }
}

export function buildAppAutomationControlSurfacePlan(
  task: string,
  preferred?: Partial<Pick<AppAutomationControlSurfacePlan, 'targetId' | 'targetName'>>,
): AppAutomationControlSurfacePlan {
  const target = detectTarget(task, preferred);
  const candidates = candidatesForTarget(target.targetId, task);
  const sourceRefs = uniqueRefs(candidates.flatMap((surface) => surface.sourceRefs));
  const genericNavigator = target.targetId === 'generic_native_app'
    ? buildGenericAppNavigatorRouteContext(task, {
        targetAppName: target.targetName,
        fallbackTargetAppName: 'Unfamiliar desktop app',
      }).plan
    : null;
  return {
    ...target,
    candidates,
    observeFirst: unique([
      ...(genericNavigator?.observeFirst || []),
      'resolve the exact app, active document/window, source files/packages, output destination, and user-approved grants',
      'collect app-native document/project inventory before any mutation when an app-native surface exists',
      'collect accessibility/menu/screenshot evidence only after app-native or browser semantic state is insufficient',
      'record the chosen control surface and why stronger deterministic routes were unavailable',
    ]),
    failSafeRules: unique([
      ...(genericNavigator?.recoveryRules || []),
      'never edit a document unless active app/document identity matches the staged file or user-selected target',
      'do not save, export, package, upload, run generated scripts, or perform destructive edits without approval and scoped file grants',
      'if a semantic target is missing twice, re-observe and delegate a bounded capability buildout instead of escalating to blind coordinates',
      'use coordinate actions only for a single reversible step with fresh screenshot, screen size, target bounds, and an immediate verification observation',
      'when app install, license, login, permissions, private files, missing fonts/assets, or API credentials block execution, stop with the exact user action needed',
    ]),
    buildoutChecklist: unique([
      `identify the target as ${target.targetName} and classify the task as ${target.taskFamily}`,
      ...(genericNavigator?.buildoutTriggers || []),
      'search existing repo adapters, bridge tools, local intent macros, smokes, and docs before adding a new path',
      `research official source refs for ${target.targetName} before using examples or blogs`,
      `confirm source review dates and source types before changing runtime code`,
      `choose from this control-surface order: ${candidates.map((surface) => surface.label).join(' -> ')}`,
      'add or update a focused smoke that proves route selection, required observations, approval gates, and verification artifacts',
      'return source refs, chosen surface, files changed, verification result, and retry plan in the app-capability result contract',
    ]),
    promptHints: [
      `Target app: ${target.targetName}`,
      `Task family: ${target.taskFamily}`,
      genericNavigator ? `Generic navigator: ${genericNavigator.targetAppName}; can navigate without adapter: ${genericNavigator.canNavigateWithoutAdapter ? 'yes' : 'no'}; user effort: smallest approval/blocker only` : '',
      `Preferred surfaces: ${candidates.slice(0, 3).map((surface) => surface.label).join(' -> ')}`,
      `Official refs reviewed: ${sourceRefs.map((ref) => `${ref.label}${ref.lastReviewedAt ? ` (${ref.lastReviewedAt})` : ''}`).join(' | ') || 'none'}`,
      `Primary requirements: ${unique(candidates.slice(0, 2).flatMap((surface) => surface.requirements)).slice(0, 8).join(' | ')}`,
      `Approval before: ${unique(candidates.flatMap((surface) => surface.approvalBefore)).slice(0, 10).join(' | ')}`,
      `Verification: ${unique(candidates.flatMap((surface) => surface.verification)).slice(0, 10).join(' | ')}`,
    ].filter(Boolean),
    sourceRefs: uniqueRefs([...sourceRefs, ...(genericNavigator?.sourceRefs || [])]),
  };
}

export function buildAppAutomationControlSurfacePromptBlock(task: string): string {
  const plan = buildAppAutomationControlSurfacePlan(task);
  return [
    '## App Automation Control Surface Plan',
    ...plan.promptHints,
    `Observe first: ${plan.observeFirst.join(' | ')}`,
    `Fail-safe rules: ${plan.failSafeRules.join(' | ')}`,
    `Buildout checklist: ${plan.buildoutChecklist.join(' | ')}`,
    `Source refs: ${plan.sourceRefs.map((ref) => `${ref.label}${ref.lastReviewedAt ? ` (${ref.lastReviewedAt})` : ''} <${ref.url}>`).join(' | ') || 'none'}`,
    buildAppAutomationResearchPromptBlock(task, { maxRefs: 5 }),
  ].join('\n');
}

function surfaceIsAvailable(
  candidate: AppAutomationControlSurfaceCandidate,
  availableSurfaceIds: Set<AppAutomationControlSurfaceId> | null,
  unavailableSurfaceIds: Set<AppAutomationControlSurfaceId>,
  allowConnectedAgentBuildout: boolean,
): boolean {
  if (unavailableSurfaceIds.has(candidate.id)) return false;
  if (candidate.id === 'connected_agent_buildout') return allowConnectedAgentBuildout;
  if (!availableSurfaceIds) return true;
  return availableSurfaceIds.has(candidate.id);
}

function chooseDecisionSurface(
  candidates: AppAutomationControlSurfaceCandidate[],
  options: AppAutomationRouteDecisionOptions,
): { chosen: AppAutomationControlSurfaceCandidate; skipped: AppAutomationControlSurfaceCandidate[] } {
  const availableSurfaceIds = options.availableSurfaceIds
    ? new Set(options.availableSurfaceIds)
    : null;
  const unavailableSurfaceIds = new Set(options.unavailableSurfaceIds || []);
  const allowConnectedAgentBuildout = options.allowConnectedAgentBuildout !== false;
  const chosen = candidates.find((candidateItem) => surfaceIsAvailable(
    candidateItem,
    availableSurfaceIds,
    unavailableSurfaceIds,
    allowConnectedAgentBuildout,
  )) || candidates.find((candidateItem) => candidateItem.id === 'connected_agent_buildout') || candidates[0];
  const chosenIndex = Math.max(0, candidates.findIndex((candidateItem) => candidateItem.id === chosen.id));
  const skipped = candidates
    .slice(0, chosenIndex)
    .filter((candidateItem) => candidateItem.id !== chosen.id)
    .slice(0, Math.max(1, options.maxSkippedSurfaces || 6));
  return { chosen, skipped };
}

function buildDecisionNextSteps(status: AppAutomationRouteDecisionStatus, decision: Omit<AppAutomationRouteDecision, 'nextSteps'>): string[] {
  if (status === 'needs_user_action') {
    return [
      `Stop and show the user action needed: ${decision.userActionBlockers.join(' | ')}`,
      'Do not retry or escalate to coordinates until the blocker is cleared and fresh app evidence is collected.',
    ];
  }
  if (status === 'needs_connected_agent_buildout') {
    return [
      'Request approval for a connected-agent app capability buildout.',
      `Build or repair the missing ${decision.targetName} route using the chosen control-surface order and official source refs.`,
      'Return source refs, files changed, verification, and a bounded retry plan before retrying the user task once.',
    ];
  }
  if (status === 'needs_observation') {
    return [
      `Collect fresh evidence for: ${decision.missingConfirmations.slice(0, 6).join(' | ')}`,
      'Recompute the route decision before any mutation, upload, export, save, script, or coordinate action.',
    ];
  }
  if (status === 'needs_approval') {
    return [
      `Ask for approval before: ${decision.missingApprovals.slice(0, 6).join(' | ')}`,
      'After approval, re-observe the app/document state if anything changed.',
    ];
  }
  return [
    `Use ${decision.chosenSurface.label} for the next bounded step.`,
    `Verify with: ${decision.verification.slice(0, 5).join(' | ')}`,
  ];
}

export function buildAppAutomationRouteDecision(
  task: string,
  options: AppAutomationRouteDecisionOptions = {},
): AppAutomationRouteDecision {
  const plan = buildAppAutomationControlSurfacePlan(task, options.preferred);
  const { chosen, skipped } = chooseDecisionSurface(plan.candidates, options);
  const confirmationFacts = normalizeFacts([
    ...(options.confirmedRequirements || []),
    ...(options.observedEvidence || []),
  ]);
  const approvalFacts = normalizeFacts(options.approvedActions);
  const userActionBlockers = unique((options.userActionBlockers || []).map((item) => String(item || '').trim()).filter(Boolean));
  const requiredConfirmations = unique([
    ...chosen.requirements,
    ...chosen.sourceRefs.flatMap((ref) => ref.mustConfirm || []),
  ]);
  const missingConfirmations = uncoveredRequirements(requiredConfirmations, confirmationFacts);
  const approvalBefore = unique(chosen.approvalBefore);
  const missingApprovals = uncoveredRequirements(approvalBefore, approvalFacts);

  const status: AppAutomationRouteDecisionStatus = userActionBlockers.length > 0
    ? 'needs_user_action'
    : chosen.id === 'connected_agent_buildout'
      ? 'needs_connected_agent_buildout'
      : missingConfirmations.length > 0
        ? 'needs_observation'
        : missingApprovals.length > 0
          ? 'needs_approval'
          : 'ready_to_execute';

  const fitPenalty = chosen.fit === 'last_resort' ? 15 : chosen.fit === 'fallback' ? 8 : 0;
  const score = clampScore(
    chosen.rank
    - fitPenalty
    - Math.min(45, missingConfirmations.length * 9)
    - Math.min(30, missingApprovals.length * 10)
    - (userActionBlockers.length > 0 ? 40 : 0),
  );
  const sourceRefs = uniqueRefs([
    ...chosen.sourceRefs,
    ...plan.sourceRefs.slice(0, 5),
  ]);
  const partialDecision = {
    status,
    targetId: plan.targetId,
    targetName: plan.targetName,
    taskFamily: plan.taskFamily,
    chosenSurface: chosen,
    score,
    skippedSurfaces: skipped,
    requiredConfirmations,
    missingConfirmations,
    approvalBefore,
    missingApprovals,
    verification: chosen.verification,
    failSafeRules: plan.failSafeRules,
    sourceRefs,
    userActionBlockers,
  };

  return {
    ...partialDecision,
    nextSteps: buildDecisionNextSteps(status, partialDecision),
  };
}

export function formatAppAutomationRouteDecisionPromptBlock(decision: AppAutomationRouteDecision): string {
  const skipped = decision.skippedSurfaces.length > 0
    ? decision.skippedSurfaces.map((surface) => `${surface.label} (${surface.id})`).join(' | ')
    : 'none';
  const refs = decision.sourceRefs.slice(0, 8).map((ref) => (
    `${ref.label}${ref.lastReviewedAt ? ` (${ref.lastReviewedAt})` : ''} <${ref.url}>`
  ));
  return [
    '## App Automation Route Decision',
    `Status: ${decision.status}`,
    `Score: ${decision.score}`,
    `Target: ${decision.targetName} (${decision.targetId})`,
    `Task family: ${decision.taskFamily}`,
    `Chosen surface: ${decision.chosenSurface.label} (${decision.chosenSurface.id}, ${decision.chosenSurface.fit})`,
    `Skipped stronger surfaces: ${skipped}`,
    `Missing confirmations: ${decision.missingConfirmations.join(' | ') || 'none'}`,
    `Missing approvals: ${decision.missingApprovals.join(' | ') || 'none'}`,
    `User blockers: ${decision.userActionBlockers.join(' | ') || 'none'}`,
    `Verification: ${decision.verification.join(' | ') || 'none'}`,
    `Fail-safe rules: ${decision.failSafeRules.join(' | ')}`,
    `Next steps: ${decision.nextSteps.join(' | ')}`,
    `Source refs: ${refs.join(' | ') || 'none'}`,
  ].join('\n');
}

// ── Observe-before-act helpers ──────────────────────────────────────────────
// Used by the computer-task runtime to (a) tell the route decision what infra
// is already confirmed by the capability audit, and (b) re-decide against the
// LIVE surface state observed at runtime, then hand the agent ground truth.
// Both are pure so they stay Node-testable.

/**
 * Translate a capability audit into observation strings the route decision can
 * match against. Covers only INFRA we actually know is present (bridge up, file
 * grants, automation tooling) so the decision stops reporting
 * `needs_observation` for demonstrably-available infrastructure. App-presence
 * (e.g. "Photoshop installed") is intentionally NOT asserted here — that needs
 * live observation at runtime, not an audit.
 */
export function deriveAuditObservedEvidence(
  audit: ComputerCapabilityAudit | null | undefined,
): string[] {
  if (!audit?.findings) return [];
  const ready = new Set(
    audit.findings.filter((finding) => finding.status === 'ready').map((finding) => finding.id),
  );
  const evidence: string[] = [];
  if (ready.has('desktop_control')) evidence.push('local desktop bridge running and paired');
  if (ready.has('file_write')) evidence.push('local file grants available');
  else if (ready.has('file_read') || ready.has('file_search')) evidence.push('local file read grants available');
  if (ready.has('app_tools')) evidence.push('app automation tools available');
  if (ready.has('browser_automation')) evidence.push('browser automation available');
  return evidence;
}

/**
 * Build the prompt block that hands the agent the LIVE surface state observed
 * (read-only) before it is allowed to act, plus the route decision re-evaluated
 * against that state. Returns '' when there is nothing to report so callers can
 * fail open. Pure: takes already-captured observation strings.
 */
export function buildObserveBeforeActPromptBlock(
  task: string,
  observations: string[],
  opts: { auditEvidence?: string[] } = {},
): string {
  const cleanObservations = unique(
    (observations || []).map((item) => String(item || '').trim()).filter(Boolean),
  );
  if (cleanObservations.length === 0) return '';

  const decision = buildAppAutomationRouteDecision(task, {
    observedEvidence: [...cleanObservations, ...(opts.auditEvidence || [])],
  });

  const statusBits = [`Observed route status: ${decision.status}`];
  if (decision.missingConfirmations.length > 0) {
    statusBits.push(`still to confirm — ${decision.missingConfirmations.slice(0, 6).join('; ')}`);
  }
  if (decision.missingApprovals.length > 0) {
    statusBits.push(`approval needed for — ${decision.missingApprovals.slice(0, 4).join('; ')}`);
  }

  return [
    '## Live surface state (observed read-only before acting)',
    ...cleanObservations.map((item) => `- ${item}`),
    '',
    `${statusBits.join('. ')}.`,
    'Act on THIS observed state. If it does not match what the task assumes, observe again with desktop.window_state / desktop.read_a11y_tree before mutating — do not act blind.',
  ].join('\n');
}

// ── E1: Mid-execution surface escalation ────────────────────────────────────
// When the ACTIVE control surface fails at runtime (adapter error, empty a11y
// tree, coverage miss), descend the already-ranked candidate ladder instead of
// failing the whole run into a manual replan. Research grounding
// (docs/EXECUTION_LADDER_RESEARCH_2026-06-11.md): UFO2's hybrid escalation
// converts ~10% of otherwise-irrecoverable cases, and >62% of tree-only
// failures are a11y COVERAGE gaps — so a11y failures must descend toward the
// screenshot/coordinate rung automatically rather than retrying tree-based
// surfaces. Pure and Node-loadable: the runtime supplies the failure signal
// and capability statuses; this module owns the ranking semantics.

export type SurfaceCapabilityStatus = 'ready' | 'partial' | 'missing';

export interface SurfaceEscalationFailure {
  /** Structured failure code when available (e.g. `a11y_tree_empty`, `adapter_error`). */
  code?: string | null;
  /** Failure area in the computerTaskEvidenceRecovery vocabulary (e.g. `approval_boundary`). */
  area?: string | null;
  message: string;
}

export interface PlanSurfaceEscalationInput {
  currentSurfaceId: string;
  /** The route decision's ranked candidate list (highest rank first). */
  candidates: AppAutomationControlSurfaceCandidate[];
  failure: SurfaceEscalationFailure;
  /** Every surface already attempted this run, including the current one. */
  attemptedSurfaceIds: string[];
  /** Live capability status per surface id; 'partial' demotes, 'missing' excludes. */
  capabilityStatusById?: Record<string, SurfaceCapabilityStatus>;
  /** How many same-surface fresh-observation retries already happened (default 0). */
  sameSurfaceRetryCount?: number;
}

export type SurfaceEscalationDecision =
  | {
      action: 'descend';
      next: AppAutomationControlSurfaceCandidate;
      freshObservationRequired: true;
      /** approvalBefore items on the new rung NOT already covered by the current rung — gate BEFORE acting. */
      extraApprovalsRequired: string[];
      reason: string;
    }
  | { action: 'retry_same'; reason: string }
  | { action: 'stop'; reason: string };

/** Bounded: a run may descend at most this many times (research: UFO2 keeps hybrid escalation tight). */
export const MAX_SURFACE_DESCENTS_PER_RUN = 2;

// Failures that must NEVER widen the control surface. These stop (or wait for
// the user/approval flow) instead of descending — descending around a rejected
// approval, a user constraint, or a verification gate would silently bypass
// the exact safety boundary that fired.
const NON_ESCALATING_FAILURE_CODES = new Set([
  'approval_rejected',
  'approval_required',
  'verification_gate',
  'user_constraint_block',
  'permission_denied',
  'not_paired',
  'origin_blocked',
  'app_not_found',
  'user_decision_needed',
]);
const NON_ESCALATING_FAILURE_AREAS = new Set(['approval_boundary', 'user_unblock']);

// a11y coverage failures (E0's structured `a11y_tree_empty`, or a coverage
// miss) descend PAST other tree-dependent rungs toward the pixel rung —
// retrying a different tree consumer against an app whose toolkit bypasses the
// platform a11y API just fails again.
const A11Y_COVERAGE_FAILURE_CODES = new Set(['a11y_tree_empty', 'a11y_coverage_miss']);
const A11Y_DEPENDENT_SURFACE_IDS = new Set<string>(['os_accessibility', 'semantic_desktop']);

const FAILURE_CODE_LABELS: Record<string, string> = {
  a11y_tree_empty: 'accessibility tree came back empty (coverage gap)',
  a11y_coverage_miss: 'accessibility tree did not cover the target (coverage gap)',
  a11y_path_stale: 'accessibility element path went stale',
  adapter_error: 'adapter error',
  adapter_unavailable: 'adapter unavailable',
  approval_rejected: 'approval was rejected',
  approval_required: 'approval is required first',
  verification_gate: 'a pre-mutation verification gate fired',
  user_constraint_block: 'a user constraint blocks this action',
  permission_denied: 'macOS permission denied',
  not_paired: 'desktop bridge not paired',
  origin_blocked: 'desktop bridge rejected the request origin',
  app_not_found: 'the target app is not installed',
  user_decision_needed: 'a blocking dialog needs a user decision',
};

function failureLabel(failure: SurfaceEscalationFailure): string {
  const code = normalize(failure.code || '');
  if (code && FAILURE_CODE_LABELS[code]) return `${code} (${FAILURE_CODE_LABELS[code]})`;
  if (code) return code;
  const area = normalize(failure.area || '');
  if (area) return `failure area ${area}`;
  const message = String(failure.message || '').trim();
  return message ? message.slice(0, 120) : 'unknown failure';
}

function isA11yCoverageFailure(failure: SurfaceEscalationFailure, sameSurfaceRetryCount: number): boolean {
  const code = normalize(failure.code || '');
  if (A11Y_COVERAGE_FAILURE_CODES.has(code)) return true;
  // A stale path that already burned its same-surface retry behaves like a coverage miss.
  if (code === 'a11y_path_stale' && sameSurfaceRetryCount > 0) return true;
  const message = normalize(failure.message || '');
  return /\ba11y_tree_empty\b/.test(message)
    || (/\b(a11y|accessibility)\b/.test(message) && /\b(empty|coverage|no nodes|not in the tree)\b/.test(message));
}

/**
 * Extract a structured failure signal from an adapter/tool result shape
 * ({ message, warnings, data }) without importing the adapter module. Pure so
 * smokes can pin the mapping.
 */
export function extractSurfaceFailureSignal(args: {
  message?: string | null;
  warnings?: string[] | null;
  data?: Record<string, unknown> | null;
}): SurfaceEscalationFailure {
  const message = String(args.message || '').trim();
  const haystack = [message, ...(args.warnings || [])].join('\n').toLowerCase();
  const dataCode = typeof args.data?.errorCode === 'string' ? normalize(args.data.errorCode as string) : '';
  const dataKind = typeof args.data?.kind === 'string' ? normalize(args.data.kind as string) : '';
  let code: string | null = dataCode || null;
  if (!code && dataKind === 'desktop_ai_modal_decision_needed') code = 'user_decision_needed';
  if (!code) {
    const knownCodes = [
      'a11y_tree_empty',
      'a11y_path_stale',
      'permission_denied',
      'not_paired',
      'origin_blocked',
      'app_not_found',
      'approval_rejected',
      'verification_gate',
    ];
    code = knownCodes.find((known) => haystack.includes(known)) || null;
  }
  return { code, area: null, message };
}

/**
 * Map a capability audit onto the control-surface ids the escalation policy
 * ranks. 'partial' is preserved (degraded rung — ranked after every ready
 * candidate; fixes gap #6 where 'partial' was treated as 'ready') and
 * 'missing' excludes the rung. Surfaces with no audit signal stay unknown
 * (treated as usable).
 */
export function deriveSurfaceCapabilityStatusFromAudit(
  audit: ComputerCapabilityAudit | null | undefined,
): Record<string, SurfaceCapabilityStatus> {
  if (!audit?.findings) return {};
  const statusOf = (id: string): SurfaceCapabilityStatus | null => {
    const finding = audit.findings.find((item) => item.id === id);
    return finding ? finding.status : null;
  };
  const out: Record<string, SurfaceCapabilityStatus> = {};
  const assign = (ids: string[], status: SurfaceCapabilityStatus | null) => {
    if (!status) return;
    for (const id of ids) out[id] = status;
  };
  assign(
    ['os_accessibility', 'semantic_desktop', 'screenshot_coordinate_fallback', 'macos_apple_events'],
    statusOf('desktop_control'),
  );
  assign(
    [
      'vendor_script_or_plugin_api',
      'adobe_indesign_uxp_dom',
      'adobe_photoshop_uxp_dom',
      'adobe_photoshop_batchplay',
      'autocad_lisp_dotnet_api',
      'autodesk_ai_mcp_assistant',
      'fusion_api_scripts_addins',
      'solidworks_com_api',
      'matlab_mcp_agentic_toolkit',
      'rhino_common_api',
      'revit_api_addin',
      'inventor_api_ilogic',
    ],
    statusOf('app_tools'),
  );
  assign(['browser_dom_cdp'], statusOf('browser_automation'));
  return out;
}

/**
 * Decide what to do when the ACTIVE surface fails mid-run.
 *
 * Rules:
 * - non-escalating failures (approval rejected/required, verification gate,
 *   user constraint, permission/pairing/install blockers, blocking-dialog
 *   decisions) NEVER descend — they stop/wait;
 * - `a11y_path_stale` gets ONE fresh-observation retry on the same rung;
 * - at most MAX_SURFACE_DESCENTS_PER_RUN descents, then stop-with-history;
 * - descend only to the next-ranked NOT-yet-attempted candidate below the
 *   current rung whose capability isn't known-missing; 'partial' candidates
 *   rank after every ready/unknown candidate;
 * - a11y coverage failures skip other tree-dependent rungs (descend toward
 *   the screenshot/coordinate rung);
 * - a descent always requires a fresh observation on the new rung, and any
 *   approvalBefore items the new rung adds are returned so the caller gates
 *   BEFORE acting — approvals are never widened silently.
 */
export function planSurfaceEscalation(input: PlanSurfaceEscalationInput): SurfaceEscalationDecision {
  const currentSurfaceId = String(input.currentSurfaceId || '').trim();
  const failure = input.failure || { message: '' };
  const code = normalize(failure.code || '');
  const area = normalize(failure.area || '');
  const sameSurfaceRetryCount = Math.max(0, input.sameSurfaceRetryCount || 0);
  const attempted = unique([
    ...(input.attemptedSurfaceIds || []).map((id) => String(id || '').trim()).filter(Boolean),
    ...(currentSurfaceId ? [currentSurfaceId] : []),
  ]);
  const attemptedLabel = attempted.join(', ') || 'none';
  const label = failureLabel(failure);

  if (NON_ESCALATING_FAILURE_CODES.has(code) || NON_ESCALATING_FAILURE_AREAS.has(area)) {
    return {
      action: 'stop',
      reason: `non-escalating failure on ${currentSurfaceId || 'the current surface'}: ${label} — do not descend control surfaces; resolve the approval/user blocker first. Tried: ${attemptedLabel}.`,
    };
  }

  if (code === 'a11y_path_stale' && sameSurfaceRetryCount === 0) {
    return {
      action: 'retry_same',
      reason: `element path went stale on ${currentSurfaceId || 'the current surface'} — re-observe (fresh a11y tree) and retry on the SAME surface before descending.`,
    };
  }

  const descentsSoFar = Math.max(0, attempted.length - 1);
  if (descentsSoFar >= MAX_SURFACE_DESCENTS_PER_RUN) {
    return {
      action: 'stop',
      reason: `escalation budget exhausted (${MAX_SURFACE_DESCENTS_PER_RUN} descents): tried ${attemptedLabel}; all failed — last failure: ${label}.`,
    };
  }

  const candidates = input.candidates || [];
  const currentIndex = candidates.findIndex((item) => item.id === currentSurfaceId);
  const below = currentIndex >= 0 ? candidates.slice(currentIndex + 1) : candidates;
  const attemptedSet = new Set(attempted);
  const statusById = input.capabilityStatusById || {};
  const a11yCoverage = isA11yCoverageFailure(failure, sameSurfaceRetryCount);
  const eligible = below.filter((item) =>
    item.id !== currentSurfaceId
    && !attemptedSet.has(item.id)
    // Connected-agent buildout is not an in-run rung — the stop path feeds
    // the existing buildout/recovery machinery instead.
    && item.id !== 'connected_agent_buildout'
    && statusById[item.id] !== 'missing'
    && !(a11yCoverage && A11Y_DEPENDENT_SURFACE_IDS.has(item.id)));
  // 'partial' = degraded rung: usable, but only after every ready/unknown candidate.
  const readyish = eligible.filter((item) => statusById[item.id] !== 'partial');
  const partial = eligible.filter((item) => statusById[item.id] === 'partial');
  const next = [...readyish, ...partial][0];

  if (!next) {
    return {
      action: 'stop',
      reason: `no usable lower control surface remains: tried ${attemptedLabel}; all failed — last failure: ${label}.`,
    };
  }

  const currentApprovals = new Set(
    normalizeFacts(currentIndex >= 0 ? candidates[currentIndex].approvalBefore : []),
  );
  const extraApprovalsRequired = unique(next.approvalBefore).filter(
    (item) => !currentApprovals.has(normalize(item).replace(/\s+/g, ' ').trim()),
  );

  return {
    action: 'descend',
    next,
    freshObservationRequired: true,
    extraApprovalsRequired,
    reason: `escalated from ${currentSurfaceId || 'unknown surface'} to ${next.id}: ${label}${statusById[next.id] === 'partial' ? ' (degraded rung — capability is partial)' : ''}.`,
  };
}

// ── E1 breadcrumbs ──────────────────────────────────────────────────────────
// Telemetry note: when escalation fires because of an a11y failure, the
// breadcrumb carries the app name + structured failure code. The breadcrumbs
// persisted on task records ARE our macOS AX-coverage dataset over time — the
// 2026-06-11 research round found no published macOS coverage numbers, so we
// measure them ourselves from these records. No extra infra needed.

export interface ComputerTaskSurfaceEscalation {
  fromSurface: string;
  toSurface: string;
  reason: string;
  atIso: string;
  appName?: string | null;
  failureCode?: string | null;
}

export const MAX_SURFACE_ESCALATION_BREADCRUMBS = 3;

/** Append a breadcrumb, keeping the list bounded (≤3, oldest dropped) and strings compact. */
export function appendSurfaceEscalation(
  list: ComputerTaskSurfaceEscalation[] | null | undefined,
  entry: ComputerTaskSurfaceEscalation,
): ComputerTaskSurfaceEscalation[] {
  const compact: ComputerTaskSurfaceEscalation = {
    fromSurface: String(entry.fromSurface || '').slice(0, 80),
    toSurface: String(entry.toSurface || '').slice(0, 80),
    reason: String(entry.reason || '').slice(0, 300),
    atIso: String(entry.atIso || new Date().toISOString()),
    appName: entry.appName ? String(entry.appName).slice(0, 80) : null,
    failureCode: entry.failureCode ? String(entry.failureCode).slice(0, 60) : null,
  };
  return [...(list || []), compact].slice(-MAX_SURFACE_ESCALATION_BREADCRUMBS);
}
