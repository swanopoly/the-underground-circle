import {
  APP_AUTOMATION_RESEARCH_REFS,
  buildAppAutomationControlSurfacePlan,
  type AppAutomationTargetId,
  type AppAutomationResearchRef,
} from './appAutomationControlSurfaces';
import type { ChatComputerRequestRoute } from './chatComputerRequestRouter';
import { formatGenericAppTaskFamilyForUser } from './genericAppNavigator';

export type ComputerTaskEvidenceContractKind = 'browser' | 'desktop_app' | 'local_file' | 'hybrid' | 'agent_buildout';

export interface ComputerTaskEvidenceContract {
  schemaVersion: 1;
  kind: ComputerTaskEvidenceContractKind;
  targetName: string;
  taskFamily: string;
  observeBefore: string[];
  actionabilityChecks: string[];
  approvalBefore: string[];
  mutationGuardrails: string[];
  proofAfter: string[];
  failClosedRules: string[];
  freshEvidenceRequired: string[];
  sourceRefs: AppAutomationResearchRef[];
  userSummary: string;
}

function uniqueCompact(values: Array<string | null | undefined>, max: number): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).slice(0, max);
}

function uniqueRefs(values: Array<AppAutomationResearchRef | null | undefined>, max = 8): AppAutomationResearchRef[] {
  const seen = new Set<string>();
  const refs: AppAutomationResearchRef[] = [];
  values.forEach((ref) => {
    if (!ref?.url || seen.has(ref.url)) return;
    seen.add(ref.url);
    refs.push(ref);
  });
  return refs.slice(0, max);
}

function targetName(route: ChatComputerRequestRoute): string {
  if (route.designExecutionPipeline?.appName) return route.designExecutionPipeline.appName;
  if (
    route.appAutomationRouteDecision?.targetName &&
    !/^native desktop app$/i.test(route.appAutomationRouteDecision.targetName)
  ) {
    return route.appAutomationRouteDecision.targetName;
  }
  if (route.appStrategy?.label) return route.appStrategy.label.replace(/\s+(Workflow|Control Loop|And Buildout Loop|Generic App Navigator)$/i, '');
  if (route.kind === 'browser') return 'Browser app';
  if (route.kind === 'local_file') return 'Local files';
  if (route.kind === 'agent_buildout') return 'Missing app capability';
  return 'Desktop app';
}

function baseSourceRefs(route: ChatComputerRequestRoute): AppAutomationResearchRef[] {
  if (route.kind === 'browser') {
    return [
      APP_AUTOMATION_RESEARCH_REFS.playwrightLocators,
      APP_AUTOMATION_RESEARCH_REFS.playwrightActionability,
      APP_AUTOMATION_RESEARCH_REFS.chromeDevtoolsProtocol,
      APP_AUTOMATION_RESEARCH_REFS.chromeDevtoolsProtocolMonitor,
    ];
  }
  if (route.kind === 'local_file') return [];
  const target = targetName(route);
  const context = `${target} ${route.bestPath || ''} ${route.computerPreview.detail || ''}`;
  const targetId: AppAutomationTargetId | undefined = /photoshop/i.test(context)
    ? 'adobe_photoshop'
    : /indesign/i.test(context)
      ? 'adobe_indesign'
      : /adobe|creative cloud/i.test(context)
        ? 'adobe_creative_cloud'
        : /\b(auto\s*cad|autocad|civil\s*3d|fusion\s*360|solid\s*works|solidworks|matlab|mathworks|simulink|simscape|revit|rhino(?:ceros)?|inventor|free\s*cad|freecad|libre\s*cad|librecad|qcad|sketch\s*up|sketchup|cad|dwg|dxf|rvt|rfa|sldprt|sldasm|slddrw|mlx|slx|f3d|f3z|3dm|engineering drawing|technical drawing|floor plan|site plan|shop drawing|bim)\b/i.test(context)
          ? 'engineering_cad_app'
        : route.kind === 'desktop_app' || route.kind === 'hybrid'
          ? 'generic_native_app'
          : undefined;
  const plan = buildAppAutomationControlSurfacePlan(route.bestPath || route.computerPreview.detail || target, {
    targetId,
    targetName: target,
  });
  return plan.sourceRefs;
}

function taskFamily(route: ChatComputerRequestRoute): string {
  if (route.designExecutionPipeline?.quietUserSummary) return 'design app execution';
  if (route.kind === 'browser') return 'browser semantic workflow';
  if (route.kind === 'local_file') return route.risk === 'safe' ? 'local file read/search' : 'local file mutation';
  if (route.kind === 'agent_buildout') return 'connected-agent capability buildout';
  if (route.appAutomationRouteDecision?.taskFamily) return formatGenericAppTaskFamilyForUser(route.appAutomationRouteDecision.taskFamily);
  if (route.appStrategy?.id === 'universal_app_control') return 'unfamiliar app workflow';
  return route.appStrategy?.label || route.computerPreview.label || 'computer task';
}

function browserContract(route: ChatComputerRequestRoute): ComputerTaskEvidenceContract {
  return {
    schemaVersion: 1,
    kind: route.kind === 'hybrid' ? 'hybrid' : 'browser',
    targetName: targetName(route),
    taskFamily: taskFamily(route),
    observeBefore: uniqueCompact([
      'confirm URL, origin, login state, and target page title',
      'capture a fresh DOM/ARIA or accessibility snapshot before each action group',
      'prefer role, label, text, placeholder, title, alt text, or test-id locators before CSS or coordinates',
      'record upload/download file basenames and scoped file grants when local files are involved',
    ], 8),
    actionabilityChecks: [
      'locator resolves to exactly one target',
      'target is visible',
      'target is stable',
      'target receives events and is not obscured',
      'target is enabled, and editable before fill/clear',
    ],
    approvalBefore: uniqueCompact([
      route.approvalReason,
      'credential use',
      'submit, publish, send, pay, purchase, delete, invite, or external upload',
      'cross-origin navigation not explicitly requested by the user',
    ], 8),
    mutationGuardrails: [
      'never force a browser action past failed actionability checks',
      're-observe DOM/ARIA state after selector ambiguity, timeout, overlay, or navigation',
      'pause for MFA, CAPTCHA, protected human verification, or origin mismatch',
    ],
    proofAfter: uniqueCompact([
      'refreshed DOM/ARIA state or confirmation text',
      'URL/title/state change when relevant',
      'screenshot proof for visual changes',
      'file_stat for downloads/uploads or exported files',
      ...route.completionProof,
    ], 8),
    failClosedRules: [
      'human verification, MFA, or auth prompt requires user action',
      'origin/session mismatch blocks credential or form actions',
      'ambiguous locator or repeated actionability timeout requires fresh observation or recovery option',
      'external side effect stops at approval boundary',
    ],
    freshEvidenceRequired: [
      'fresh DOM/ARIA snapshot before retry',
      'fresh screenshot when visual state or overlays matter',
      'fresh file_stat before upload/download proof',
    ],
    sourceRefs: uniqueRefs(baseSourceRefs(route)),
    userSummary: 'Use semantic browser locators with actionability evidence, stop before side effects, and show only approval, proof, or blockers.',
  };
}

function desktopContract(route: ChatComputerRequestRoute): ComputerTaskEvidenceContract {
  const target = targetName(route);
  const context = `${target} ${route.bestPath || ''} ${route.computerPreview.detail || ''}`;
  const isPhotoshop = /photoshop/i.test(context);
  const isInDesign = /indesign/i.test(context);
  const isCad = /\b(auto\s*cad|autocad|civil\s*3d|fusion\s*360|solid\s*works|solidworks|matlab|mathworks|simulink|simscape|revit|rhino(?:ceros)?|inventor|free\s*cad|freecad|libre\s*cad|librecad|qcad|sketch\s*up|sketchup|cad|dwg|dxf|rvt|rfa|sldprt|sldasm|slddrw|mlx|slx|f3d|f3z|3dm|engineering drawing|technical drawing|floor plan|site plan|shop drawing|bim)\b/i.test(context);
  return {
    schemaVersion: 1,
    kind: route.kind === 'hybrid' ? 'hybrid' : 'desktop_app',
    targetName: target,
    taskFamily: taskFamily(route),
    observeBefore: uniqueCompact([
      'confirm app/window identity and active document identity before mutation',
      isPhotoshop ? 'capture Photoshop document status and layer/selection/mask inventory' : null,
      isInDesign ? 'capture InDesign document status plus layer/text/link/font or preflight inventory' : null,
      isCad ? 'capture engineering document/model/project state, units/toolboxes, scale/layers/configuration, command prompt/menu state, and drawing/model/MATLAB proof before mutation' : null,
      !isPhotoshop && !isInDesign ? 'capture app/window state, accessibility tree, menu inventory, and screenshot before mutation' : null,
      'resolve exact staged source file/package and output destination',
      'record chosen control surface and why stronger deterministic routes were unavailable',
    ], 8),
    actionabilityChecks: uniqueCompact([
      isPhotoshop ? 'Photoshop mutation runs through UXP/app API or batchPlay inside modal execution scope' : null,
      isInDesign ? 'InDesign mutation runs through UXP script/plugin DOM or documented app API when available' : null,
      isCad ? 'CAD mutation uses the researched app API/script/add-in/command surface before accessibility or coordinates' : null,
      'active document matches the staged file or user-selected target',
      'target layer/frame/link/object/control is named or otherwise uniquely identified',
      'accessibility or coordinate fallback has fresh tree/screenshot and a bounded one-step retry guard',
    ], 8),
    approvalBefore: uniqueCompact([
      route.approvalReason,
      'document mutation',
      'running new scripts, plugins, actions, or connected-agent adapter code',
      'relinking/placing local assets',
      'save, export, package, render, overwrite, delete, flatten, rasterize, or destructive edit',
    ], 10),
    mutationGuardrails: [
      'app-native DOM/API/scripted tools run before accessibility, menu, screenshot, or coordinate fallback',
      'coordinate actions are allowed only for one reversible step with immediate verification',
      'do not claim completion without refreshed app-native inventory or an exact blocker',
      'delegate a connected-agent buildout when the deterministic adapter is missing instead of blind desktop control',
    ],
    proofAfter: uniqueCompact([
      isPhotoshop ? 'refreshed Photoshop document status and layer inventory' : null,
      isInDesign ? 'refreshed InDesign document status plus text/link/layer or preflight inventory' : null,
      isCad ? 'refreshed CAD units/dimensions/layers/object or feature state plus command/result evidence' : null,
      'before/after object manifest or changed-entity summary when available',
      'proof screenshot or exported proof artifact',
      'output file_stat, basename/hash, page/image dimensions, or package summary when files change',
      ...route.completionProof,
    ], 10),
    failClosedRules: uniqueCompact([
      'app install, license, login, permission, modal dialog, or missing bridge tool blocks execution',
      'active document mismatch blocks mutation',
      isCad ? 'CAD units, scale, coordinate origin, tolerance, worksharing, or active configuration ambiguity blocks geometry/model mutation' : null,
      'missing fonts, links, assets, selections, masks, layers, or named targets block the claimed edit',
      'missing before/after inventory or proof blocks completion',
    ], 8),
    freshEvidenceRequired: uniqueCompact([
      'fresh app-native document status before retry',
      isCad ? 'fresh CAD units/layers/dimensions/object state before geometry/model mutation retry' : null,
      'fresh layer/text/link/a11y inventory before mutation retry',
      'fresh screenshot after visual fallback',
      'fresh file_stat after output writes',
    ], 8),
    sourceRefs: uniqueRefs(baseSourceRefs(route)),
    userSummary: `Use app-native ${target} automation first, require approval for mutation/output work, and verify with refreshed inventory plus proof artifacts.`,
  };
}

function localFileContract(route: ChatComputerRequestRoute): ComputerTaskEvidenceContract {
  return {
    schemaVersion: 1,
    kind: 'local_file',
    targetName: 'Local files',
    taskFamily: taskFamily(route),
    observeBefore: [
      'resolve exact scoped folder/path before reading or writing',
      'capture file_stat or listing metadata before mutation',
      'keep read/search results bounded and redacted in chat',
    ],
    actionabilityChecks: [
      'file path exists or the missing-path blocker is explicit',
      'file grant matches requested read/write scope',
      'write/delete/move target is unique and not broader than requested',
    ],
    approvalBefore: uniqueCompact([
      route.approvalReason,
      'write, overwrite, move, copy, rename, delete, archive, export, or broad recursive scan',
    ], 6),
    mutationGuardrails: [
      'no write/delete action without scoped approval',
      'do not expose absolute paths in user-visible chat unless explicitly requested',
      'report missing permission/path blockers instead of guessing locations',
    ],
    proofAfter: uniqueCompact([
      'bounded search/read result or explicit no-match result',
      'file_stat, hash, basename, or count summary after mutation',
      ...route.completionProof,
    ], 8),
    failClosedRules: [
      'path is outside approved scope',
      'multiple ambiguous targets match a mutation request',
      'file permission, sandbox, or missing path prevents evidence collection',
    ],
    freshEvidenceRequired: [
      'fresh file_stat before mutation retry',
      'fresh directory listing after write/move/delete',
    ],
    sourceRefs: [],
    userSummary: 'Use scoped file tools, keep safe read/search quiet, and require proof for file mutations or blockers.',
  };
}

function buildoutContract(route: ChatComputerRequestRoute): ComputerTaskEvidenceContract {
  const refs = uniqueRefs(baseSourceRefs(route));
  return {
    schemaVersion: 1,
    kind: 'agent_buildout',
    targetName: targetName(route),
    taskFamily: taskFamily(route),
    observeBefore: [
      'identify missing adapter, recipe, bridge tool, or control surface',
      'search existing repo code, docs, smokes, and bridge tools before adding a path',
      'collect official source references before implementation',
    ],
    actionabilityChecks: [
      'connected coding agent is available and approved',
      'buildout has a bounded write scope and focused smoke case',
      'result contract includes chosen control surface, source refs, files changed, verification, and retry plan',
    ],
    approvalBefore: uniqueCompact([
      route.approvalReason,
      'patching runtime/bridge code',
      'running generated scripts/plugins/actions',
      'retrying the original app task after capability buildout',
    ], 8),
    mutationGuardrails: [
      'build the smallest missing adapter or recipe only',
      'do not retry the original user task until the buildout returns ready-to-retry evidence',
      'fail closed if official-source research or focused smoke verification is missing',
    ],
    proofAfter: [
      'source refs',
      'files changed',
      'focused smoke pass',
      'ready-to-retry or user-action-needed result contract',
    ],
    failClosedRules: [
      'agent result is incomplete, unparseable, or lacks source refs',
      'verification failed or was not run',
      'runtime patch would exceed the approved scope',
    ],
    freshEvidenceRequired: [
      'fresh app/window/file observation after capability buildout',
      'fresh focused smoke result before retry',
    ],
    sourceRefs: refs,
    userSummary: 'Use a connected agent only for the smallest missing capability, require official-source evidence and a focused smoke, then retry once.',
  };
}

export function buildComputerTaskEvidenceContract(route: ChatComputerRequestRoute): ComputerTaskEvidenceContract {
  if (route.kind === 'browser') return browserContract(route);
  if (route.kind === 'local_file') return localFileContract(route);
  if (route.kind === 'agent_buildout') return buildoutContract(route);
  if (route.kind === 'hybrid') {
    const browser = browserContract(route);
    const desktop = desktopContract(route);
    return {
      ...desktop,
      kind: 'hybrid',
      taskFamily: 'hybrid browser/local/desktop workflow',
      observeBefore: uniqueCompact([...browser.observeBefore, ...desktop.observeBefore], 10),
      actionabilityChecks: uniqueCompact([...browser.actionabilityChecks, ...desktop.actionabilityChecks], 10),
      approvalBefore: uniqueCompact([...browser.approvalBefore, ...desktop.approvalBefore], 10),
      mutationGuardrails: uniqueCompact([...browser.mutationGuardrails, ...desktop.mutationGuardrails], 10),
      proofAfter: uniqueCompact([...browser.proofAfter, ...desktop.proofAfter], 10),
      failClosedRules: uniqueCompact([...browser.failClosedRules, ...desktop.failClosedRules], 10),
      freshEvidenceRequired: uniqueCompact([...browser.freshEvidenceRequired, ...desktop.freshEvidenceRequired], 8),
      sourceRefs: uniqueRefs([...browser.sourceRefs, ...desktop.sourceRefs]),
      userSummary: 'Resolve browser, local file, and app state first, then execute one verified step at a time with approval before side effects.',
    };
  }
  return desktopContract(route);
}

/**
 * Risk tiers for a single approval reason, matching the app-wide vocabulary
 * (agentSpirits / capability riskTier). Consumed by the risk-tiering lane to
 * decide how hard an approval gate should be for a given contract reason.
 */
export type ComputerTaskApprovalRisk = 'low' | 'medium' | 'high' | 'critical';

/** A contract approval reason paired with the tier it should gate at. */
export interface ComputerTaskApprovalGateReason {
  reason: string;
  risk: ComputerTaskApprovalRisk;
}

const APPROVAL_RISK_CRITICAL_RE = /\b(pay|payment|purchase|buy|checkout|send money|wire|transfer funds|delete|destroy|wipe|erase|publish|post publicly|send (?:email|message|invite|dm)|invite|external upload|upload to|share externally|overwrite|irreversible|deploy|go live)\b/i;
const APPROVAL_RISK_HIGH_RE = /\b(submit|save|export|package|render|flatten|rasterize|relink|place (?:local )?asset|run(?:ning)? (?:new )?(?:scripts?|plugins?|actions?|macros?|add-?ins?)|connected-agent adapter code|patch|credential|sign ?in|log ?in|password|api key|token|move|copy|rename|archive|recursive scan|broad scan|batch|mass)\b/i;
const APPROVAL_RISK_MEDIUM_RE = /\b(document mutation|mutat|edit|modify|change|update|create|insert|type|fill|cross-origin|navigat|new note|write)\b/i;

/**
 * Classify one approvalBefore reason string into a risk tier. Pure and
 * conservative: unrecognized reasons fall to 'low' (an approval gate still
 * applies at the contract level; this only tiers how severe THIS reason is).
 * Severity is checked high→low so "delete/overwrite" wins over a generic
 * "edit", and money/destructive/external actions land at 'critical'.
 */
export function classifyApprovalReasonRisk(reason: string | null | undefined): ComputerTaskApprovalRisk {
  const text = String(reason || '').trim();
  if (!text) return 'low';
  if (APPROVAL_RISK_CRITICAL_RE.test(text)) return 'critical';
  if (APPROVAL_RISK_HIGH_RE.test(text)) return 'high';
  if (APPROVAL_RISK_MEDIUM_RE.test(text)) return 'medium';
  return 'low';
}

const APPROVAL_RISK_ORDER: Record<ComputerTaskApprovalRisk, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Derive the contract's approval-gate reasons paired with their risk tier,
 * deduped and ordered most-severe first. This is the structured
 * "approvalBefore reasons" input the risk-tiering lane needs — it reads the
 * canonical contract instead of re-parsing approval strings itself. Additive:
 * no existing code path depends on it.
 */
export function deriveApprovalGateReasons(
  contract: ComputerTaskEvidenceContract,
): ComputerTaskApprovalGateReason[] {
  const seen = new Set<string>();
  const reasons: ComputerTaskApprovalGateReason[] = [];
  for (const raw of contract.approvalBefore || []) {
    const reason = String(raw || '').trim();
    if (!reason) continue;
    const key = reason.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    reasons.push({ reason, risk: classifyApprovalReasonRisk(reason) });
  }
  return reasons.sort((a, b) => APPROVAL_RISK_ORDER[a.risk] - APPROVAL_RISK_ORDER[b.risk]);
}

/**
 * The highest approval-risk tier the contract gates at (its most severe
 * approvalBefore reason), or null when the contract has no approval gate
 * (e.g. a read-only route). Lets the risk-tiering lane pick a single tier for
 * the whole contract cheaply.
 */
export function highestApprovalRisk(
  contract: ComputerTaskEvidenceContract,
): ComputerTaskApprovalRisk | null {
  const reasons = deriveApprovalGateReasons(contract);
  return reasons.length ? reasons[0].risk : null;
}

export function summarizeComputerTaskEvidenceContract(contract: ComputerTaskEvidenceContract): Record<string, unknown> {
  return {
    schemaVersion: contract.schemaVersion,
    kind: contract.kind,
    targetName: contract.targetName,
    taskFamily: contract.taskFamily,
    userSummary: contract.userSummary,
    observeBefore: contract.observeBefore.slice(0, 5),
    actionabilityChecks: contract.actionabilityChecks.slice(0, 5),
    approvalBefore: contract.approvalBefore.slice(0, 5),
    proofAfter: contract.proofAfter.slice(0, 5),
    failClosedRules: contract.failClosedRules.slice(0, 5),
    freshEvidenceRequired: contract.freshEvidenceRequired.slice(0, 4),
    sourceRefs: contract.sourceRefs.slice(0, 5).map((ref) => `${ref.label}: ${ref.url}`),
  };
}

export function formatComputerTaskEvidenceContractPromptBlock(contract: ComputerTaskEvidenceContract): string {
  return [
    '## Computer Task Evidence Contract',
    `Target: ${contract.targetName}`,
    `Task family: ${contract.taskFamily}`,
    `Summary: ${contract.userSummary}`,
    `Observe before: ${contract.observeBefore.join(' | ')}`,
    `Actionability checks: ${contract.actionabilityChecks.join(' | ')}`,
    `Approval before: ${contract.approvalBefore.join(' | ') || 'none before read-only work'}`,
    `Mutation guardrails: ${contract.mutationGuardrails.join(' | ')}`,
    `Proof after: ${contract.proofAfter.join(' | ')}`,
    `Fail closed: ${contract.failClosedRules.join(' | ')}`,
    `Fresh evidence before retry: ${contract.freshEvidenceRequired.join(' | ')}`,
    `Source refs: ${contract.sourceRefs.map((ref) => `${ref.label} <${ref.url}>`).join(' | ') || 'none'}`,
  ].join('\n');
}
