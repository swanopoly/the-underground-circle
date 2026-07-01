import type { ComputerTaskEvidenceContract } from './computerTaskEvidenceContract';
import type { AppAdapterGapContract } from './appAdapterGapContract';
import type {
  AppAutomationControlSurfaceId,
  AppAutomationRouteDecision,
  AppAutomationRouteDecisionStatus,
} from './appAutomationControlSurfaces';

export type ComputerTaskEvidenceFailureArea =
  | 'observe_before'
  | 'actionability'
  | 'approval_boundary'
  | 'proof_after'
  | 'fresh_evidence'
  | 'capability_gap'
  | 'user_unblock'
  | 'unknown';

/**
 * AR: the next-best confidently-launchable app to switch to when the chosen
 * app can't be opened (from the route's structured `recoveryFallback`).
 */
export interface ComputerTaskRecoveryAppFallback {
  displayName: string;
  surface?: 'desktop' | 'browser';
  openVia?: string;
  openTarget?: string;
  reason?: string;
  availability?: 'installed' | 'maybe' | 'web';
}

export interface ComputerTaskEvidenceRecoveryInput {
  contract?: ComputerTaskEvidenceContract | null;
  appRouteDecision?: ComputerTaskAppRouteDecisionInput | null;
  /**
   * AR: the app the user explicitly named (e.g. "pixelmator"), so an
   * unavailable-app failure reads "you asked for Pixelmator" instead of a
   * generic "missing app capability". Optional/additive.
   */
  namedAppIntent?: string | null;
  /**
   * AR: the next-best confidently-launchable app to switch to when the chosen
   * app can't open. When present and the failure is app-availability (not a
   * user-only auth/verification blocker), recovery recommends switching to it
   * and retrying — turning a "go install the app" dead-end into a one-tap
   * continuation. Optional/additive.
   */
  appFallback?: ComputerTaskRecoveryAppFallback | null;
  /**
   * Generic app-adapter-gap contract for the target app. When the failure is on
   * an unfamiliar/not-pre-configured app, this lets recovery prescribe
   * research-before-guess + the precise connected-agent buildout instead of a
   * generic "use a code agent" hint. Optional and additive.
   */
  appAdapterGap?: AppAdapterGapContract | null;
  task?: string | null;
  failureMessage?: string | null;
  outcomeStatus?: string | null;
  source?: string | null;
  planSummary?: string | null;
  groundingSummary?: string | null;
  preflightSummary?: string | null;
  observations?: ComputerTaskEvidenceRecoveryObservation[];
}

export interface AppCapabilityRecoveryResearch {
  missingTool: string;
  controlSurface: string;
  findLadder: string[];
  researchPlan: string[];
  researchTriggers: string[];
  buildoutTask: string;
  retryPrompt: string;
}

export interface ComputerTaskAppRouteDecisionSummaryInput {
  status?: AppAutomationRouteDecisionStatus | string | null;
  targetName?: string | null;
  taskFamily?: string | null;
  chosenSurfaceId?: AppAutomationControlSurfaceId | string | null;
  chosenSurfaceLabel?: string | null;
  missingConfirmations?: string[] | null;
  missingApprovals?: string[] | null;
  userActionBlockers?: string[] | null;
  nextSteps?: string[] | null;
  failSafeRules?: string[] | null;
  verification?: string[] | null;
}

export type ComputerTaskAppRouteDecisionInput =
  | AppAutomationRouteDecision
  | ComputerTaskAppRouteDecisionSummaryInput;

export interface ComputerTaskEvidenceRecoveryAppRouteDecision {
  status: AppAutomationRouteDecisionStatus;
  targetName: string;
  taskFamily: string;
  chosenSurfaceId: string;
  chosenSurfaceLabel: string;
  missingConfirmations: string[];
  missingApprovals: string[];
  userActionBlockers: string[];
  nextSteps: string[];
  failSafeRules: string[];
  verification: string[];
}

export interface ComputerTaskEvidenceRequirement {
  id: string;
  tool: string;
  summary: string;
  freshnessMs: number;
  required: boolean;
}

export interface ComputerTaskEvidenceRecoveryObservation {
  id?: string | null;
  ruleId?: string | null;
  tool: string;
  /**
   * When the observation was captured. `capturedAt` is the canonical field;
   * `at` is accepted as an alias so the loop-side producer (swanbot toolEvents,
   * incl. auto_reobserve) can hand its lightweight
   * `{ tool, at, ok, summary }` shape straight in without a reshape.
   */
  capturedAt?: string | number | null;
  at?: string | number | null;
  /**
   * Whether the observation itself succeeded. A failed/errored observation is
   * NOT valid fresh evidence (a screenshot that errored proves nothing), so
   * `ok === false` never satisfies a required-evidence tool. Absent/undefined is
   * treated as ok (back-compat: existing callers pass no status).
   */
  ok?: boolean | null;
  summary?: string | null;
}

export interface ComputerTaskEvidenceRecoveryReadiness {
  ready: boolean;
  status: 'ready' | 'missing' | 'stale' | 'blocked';
  checkedAt: string;
  satisfiedEvidenceIds: string[];
  missingEvidenceIds: string[];
  staleEvidenceIds: string[];
  nextEvidenceTools: string[];
  summary: string;
}

export interface ComputerTaskEvidenceRecoveryContext {
  schemaVersion: 1;
  targetName: string;
  kind: ComputerTaskEvidenceContract['kind'];
  taskFamily: string;
  failureArea: ComputerTaskEvidenceFailureArea;
  reason: string;
  matchedRules: string[];
  requiredFreshEvidence: string[];
  requiredEvidence: ComputerTaskEvidenceRequirement[];
  requiredProof: string[];
  approvalBoundaries: string[];
  failClosedRules: string[];
  appRouteDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null;
  retryAllowed: boolean;
  userActionRequired: boolean;
  connectedAgentAllowed: boolean;
  recommendedOptionId: 'retry_with_fresh_evidence' | 'resolve_contract_blocker' | 'let_connected_agent_repair' | 'stop_and_report';
  resumeInstruction: string;
  evidenceReadiness?: ComputerTaskEvidenceRecoveryReadiness | null;
  /** Research-first buildout guidance for an unfamiliar app (when an app-adapter-gap is supplied). */
  appCapabilityResearch?: AppCapabilityRecoveryResearch | null;
  /**
   * AR: when the chosen app can't be opened and a confidently-launchable
   * alternative exists, the alternative to switch to (drives the
   * "switch & retry" recovery option). Null otherwise.
   */
  appFallback?: ComputerTaskRecoveryAppFallback | null;
  /** AR: the user-named app, echoed so consumers can surface intent in copy. */
  namedAppIntent?: string | null;
}

function clean(value: unknown, max = 1_200): string {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function unique(values: Array<string | null | undefined>, max = 8): string[] {
  return Array.from(new Set(values.map((value) => clean(value, 240)).filter(Boolean))).slice(0, max);
}

function isAppRouteDecisionStatus(value: unknown): value is AppAutomationRouteDecisionStatus {
  return value === 'ready_to_execute'
    || value === 'needs_observation'
    || value === 'needs_approval'
    || value === 'needs_user_action'
    || value === 'needs_connected_agent_buildout';
}

function listFromUnknown(value: unknown, max = 6): string[] {
  return Array.isArray(value)
    ? unique(value.map((item) => clean(item, 240)), max)
    : [];
}

function summarizeAppRouteDecision(
  decision?: ComputerTaskAppRouteDecisionInput | null,
): ComputerTaskEvidenceRecoveryAppRouteDecision | null {
  if (!decision || typeof decision !== 'object') return null;
  const raw = decision as AppAutomationRouteDecision & ComputerTaskAppRouteDecisionSummaryInput;
  const status = isAppRouteDecisionStatus(raw.status) ? raw.status : null;
  if (!status) return null;
  return {
    status,
    targetName: clean(raw.targetName, 120) || 'App automation route',
    taskFamily: clean(raw.taskFamily, 120) || 'app automation',
    chosenSurfaceId: clean(raw.chosenSurface?.id || raw.chosenSurfaceId, 120) || 'unknown',
    chosenSurfaceLabel: clean(raw.chosenSurface?.label || raw.chosenSurfaceLabel, 160) || 'Unknown control surface',
    missingConfirmations: listFromUnknown(raw.missingConfirmations, 6),
    missingApprovals: listFromUnknown(raw.missingApprovals, 6),
    userActionBlockers: listFromUnknown(raw.userActionBlockers, 4),
    nextSteps: listFromUnknown(raw.nextSteps, 5),
    failSafeRules: listFromUnknown(raw.failSafeRules, 5),
    verification: listFromUnknown(raw.verification, 5),
  };
}

function routeDecisionFailureArea(
  routeDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null,
): ComputerTaskEvidenceFailureArea | null {
  switch (routeDecision?.status) {
    case 'needs_user_action':
      return 'user_unblock';
    case 'needs_approval':
      return 'approval_boundary';
    case 'needs_connected_agent_buildout':
      return 'capability_gap';
    case 'needs_observation':
      return 'fresh_evidence';
    default:
      return null;
  }
}

function resolveFailureArea(args: {
  rawArea: ComputerTaskEvidenceFailureArea;
  routeDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null;
}): ComputerTaskEvidenceFailureArea {
  const routeArea = routeDecisionFailureArea(args.routeDecision);
  if (!routeArea) return args.rawArea;
  if (routeArea === 'user_unblock' || routeArea === 'capability_gap') return routeArea;
  if (args.rawArea === 'user_unblock' || args.rawArea === 'capability_gap') return args.rawArea;
  if (routeArea === 'fresh_evidence') {
    return args.rawArea === 'actionability' || args.rawArea === 'proof_after' || args.rawArea === 'observe_before'
      ? args.rawArea
      : routeArea;
  }
  return routeArea;
}

function textFromInput(input: ComputerTaskEvidenceRecoveryInput): string {
  const routeDecision = summarizeAppRouteDecision(input.appRouteDecision);
  return [
    input.task,
    input.failureMessage,
    input.outcomeStatus,
    input.source,
    input.planSummary,
    input.groundingSummary,
    input.preflightSummary,
    routeDecision
      ? [
          `app route status ${routeDecision.status}`,
          routeDecision.targetName,
          routeDecision.taskFamily,
          routeDecision.chosenSurfaceLabel,
          ...routeDecision.missingConfirmations,
          ...routeDecision.userActionBlockers,
          ...routeDecision.nextSteps,
        ].join('\n')
      : null,
  ].map((value) => clean(value, 1_200).toLowerCase()).join('\n');
}

function matches(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function matchingRules(text: string, rules: string[], max = 4): string[] {
  const words = text
    .split(/[^a-z0-9]+/i)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length >= 4);
  const wordSet = new Set(words);
  return rules.filter((rule) => (
    rule.toLowerCase().split(/[^a-z0-9]+/i).some((word) => word.length >= 4 && wordSet.has(word))
  )).slice(0, max);
}

function classifyFailureArea(text: string, contract: ComputerTaskEvidenceContract): ComputerTaskEvidenceFailureArea {
  if (matches(text, [
    /\b(captcha|human verification|mfa|multi[- ]factor|two[- ]factor|2fa|auth prompt|login required|sign in required|protected verification)\b/i,
  ])) {
    return 'user_unblock';
  }
  if (contract.kind === 'local_file' && matches(text, [
    /\b(file_not_found|path_not_found|ENOENT|file or folder does not exist|path does not exist|does not exist|no matching source image|no file named|not found|missing path|missing source)\b/i,
  ])) {
    return 'fresh_evidence';
  }
  if (matches(text, [
    /\b(selector|locator|element|target|control|button|field|text frame)\b[\s\S]{0,120}\b(timeout|ambiguous|not found|not visible|obscured|detached|disabled|not editable|actionability|receives events|stable)\b/i,
    /\b(selector|locator|element|target|control|button|field|text frame)\b[\s\S]{0,120}\b(timed out|failed actionability|actionability checks?)\b/i,
    /\b(visible|stable|receives events|enabled|editable|obscured|ambiguous target|coordinate fallback)\b/i,
  ])) {
    return 'actionability';
  }
  if (matches(text, [
    /\b(approval|not approved|approval required|side effect|submit|publish|send|pay|purchase|delete|overwrite|destructive|save|export|package|render)\b/i,
  ])) {
    return 'approval_boundary';
  }
  if (matches(text, [
    /\b(stale|fresh|re[- ]?observe|snapshot|dom|aria|a11y|accessibility|screenshot|window state|document status|layer inventory|text inventory|link inventory|manifest|file stat|file_stat)\b/i,
    /\b(no|missing|could not collect|could not read|unavailable)\b[\s\S]{0,100}\b(evidence|snapshot|inventory|manifest|screenshot|state|status)\b/i,
  ])) {
    return 'fresh_evidence';
  }
  if (matches(text, [
    /\b(proof|verify|verification|receipt|confirmation|exported|saved|output|final state|before\/after|changed entity|package summary)\b/i,
  ])) {
    return 'proof_after';
  }
  if (matches(text, [
    /\b(missing adapter|missing bridge tool|unsupported|not implemented|no recipe|no pipeline|capability buildout|build_app_capability|tool unavailable|bridge route missing)\b/i,
    /\b(app not installed|license|screen recording|accessibility permission|permission denied|bridge unreachable|not paired)\b/i,
  ])) {
    return 'capability_gap';
  }
  if (contract.kind === 'agent_buildout') return 'capability_gap';
  return 'unknown';
}

function reasonForArea(
  area: ComputerTaskEvidenceFailureArea,
  contract: ComputerTaskEvidenceContract,
  routeDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null,
): string {
  if (routeDecision?.status === 'needs_user_action') {
    return 'The app route decision found a user-only blocker before the automation can continue.';
  }
  if (routeDecision?.status === 'needs_approval') {
    return 'The app route decision reached an approval boundary before a mutation, export, save, upload, script, or fallback action.';
  }
  if (routeDecision?.status === 'needs_connected_agent_buildout') {
    return 'The app route decision selected connected-agent capability buildout because no verified deterministic surface can complete the requested app task yet.';
  }
  if (routeDecision?.status === 'needs_observation') {
    return 'The app route decision is missing required control-surface confirmations, so the runtime must collect fresh app evidence before retrying.';
  }
  switch (area) {
    case 'user_unblock':
      return 'The blocker is a user-only auth, verification, permission, or protected-system step.';
    case 'approval_boundary':
      return 'The failure reached an approval boundary from the evidence contract.';
    case 'actionability':
      return 'The target was not safely actionable under the route evidence contract.';
    case 'fresh_evidence':
      return 'The runtime needs fresh route evidence before retrying the failed action.';
    case 'proof_after':
      return 'The runtime could not prove the requested final state with the required post-action evidence.';
    case 'capability_gap':
      return contract.kind === 'agent_buildout'
        ? 'The route is already a missing-capability buildout and must return a verified ready-to-retry contract.'
        : 'The current route appears to be missing a deterministic adapter, bridge tool, permission, or app capability.';
    default:
      return 'The exact contract failure area is unclear, so recovery should stay diagnostic or collect fresh evidence first.';
  }
}

// AR: app-availability failures (the chosen app can't be opened) — distinct
// from auth/verification blockers, which switching apps would NOT solve.
const APP_UNAVAILABLE_RE = /\b(app not installed|isn'?t installed|no longer installed|not available|could ?n'?t (launch|open|start)|failed to (launch|open|start)|license (expired|invalid|missing)|not licensed|screen recording permission|accessibility permission)\b/i;
const AUTH_VERIFICATION_RE = /\b(mfa|2fa|two[- ]factor|captcha|verification code|one[- ]time|otp|login wall|sign ?in|sign ?up|password|credential|account)\b/i;

function describeFallbackOpen(fallback: ComputerTaskRecoveryAppFallback): string {
  if (fallback.surface === 'browser' || fallback.availability === 'web') return 'open it in the browser';
  return 'launch it on the desktop';
}

/**
 * AR: decide whether to offer "switch to the fallback app and retry" instead
 * of a "go install the app / ask the user" dead-end. Offered only when:
 *  - a confidently-launchable fallback exists (web, or confirmed-installed
 *    desktop — never another unconfirmed 'maybe');
 *  - the failure is about the APP being unavailable (not an auth/verification
 *    blocker, which switching photo editors wouldn't fix);
 *  - the route decision didn't already demand a specific user action/approval.
 */
function resolveAppFallbackSwitch(
  input: ComputerTaskEvidenceRecoveryInput,
  area: ComputerTaskEvidenceFailureArea,
  text: string,
  routeDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null,
): ComputerTaskRecoveryAppFallback | null {
  const fallback = input.appFallback || null;
  if (!fallback || !fallback.displayName) return null;
  const launchable = fallback.availability === 'web' || fallback.availability === 'installed' || fallback.surface === 'browser';
  if (!launchable) return null;
  if (routeDecision?.status === 'needs_approval' || routeDecision?.status === 'needs_user_action') return null;
  // Switching apps cannot resolve a website auth/verification wall.
  if (AUTH_VERIFICATION_RE.test(text) && !APP_UNAVAILABLE_RE.test(text)) return null;
  const isAppUnavailable = area === 'capability_gap' || APP_UNAVAILABLE_RE.test(text);
  return isAppUnavailable ? fallback : null;
}

function requiresUserAction(
  area: ComputerTaskEvidenceFailureArea,
  text: string,
  routeDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null,
): boolean {
  if (routeDecision?.status === 'needs_connected_agent_buildout') {
    return routeDecision.userActionBlockers.length > 0;
  }
  if (routeDecision?.status === 'needs_observation') {
    return routeDecision.userActionBlockers.length > 0
      || area === 'user_unblock'
      || area === 'approval_boundary';
  }
  if (routeDecision?.status === 'needs_user_action' || routeDecision?.status === 'needs_approval') return true;
  return area === 'user_unblock'
    || area === 'approval_boundary'
    || matches(text, [
      /\b(app not installed|license|screen recording|accessibility permission|permission denied|not paired|bridge unreachable|restart the bridge|pair desktop bridge)\b/i,
    ]);
}

function allowsConnectedAgent(
  area: ComputerTaskEvidenceFailureArea,
  text: string,
  contract: ComputerTaskEvidenceContract,
  routeDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null,
): boolean {
  if (routeDecision?.status === 'needs_connected_agent_buildout') {
    return routeDecision.userActionBlockers.length === 0;
  }
  return area === 'capability_gap'
    && !requiresUserAction(area, text, routeDecision)
    && (
      contract.kind === 'agent_buildout'
      || matches(text, [/\b(missing adapter|missing bridge tool|unsupported|not implemented|no recipe|no pipeline|capability buildout|bridge route missing)\b/i])
    );
}

function allowsRetry(
  area: ComputerTaskEvidenceFailureArea,
  userActionRequired: boolean,
  connectedAgentAllowed: boolean,
  routeDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null,
): boolean {
  if (routeDecision?.status === 'needs_user_action'
    || routeDecision?.status === 'needs_approval'
    || routeDecision?.status === 'needs_connected_agent_buildout') {
    return false;
  }
  return !userActionRequired
    && !connectedAgentAllowed
    && (area === 'actionability' || area === 'fresh_evidence' || area === 'proof_after' || area === 'observe_before' || area === 'unknown');
}

function requirement(id: string, tool: string, summary: string, freshnessMs = 15_000, required = true): ComputerTaskEvidenceRequirement {
  return { id, tool, summary, freshnessMs, required };
}

function toolRequirementsForContract(area: ComputerTaskEvidenceFailureArea, contract: ComputerTaskEvidenceContract): ComputerTaskEvidenceRequirement[] {
  if (area === 'user_unblock' || area === 'approval_boundary') {
    return [requirement('user-unblock', 'user.confirm_unblocked', 'User resolves the auth, verification, approval, permission, bridge, app install, or license blocker.', 120_000)];
  }
  if (area === 'capability_gap') {
    return [
      requirement('capability-result', 'agent.build_app_capability.result', 'Connected-agent result includes selected control surface, source refs, files changed, verification, and retry plan.', 120_000),
      requirement('focused-smoke', 'computer.focused_smoke', 'Focused smoke verifies the new adapter, bridge tool, or route before retrying.', 120_000),
    ];
  }

  if (contract.kind === 'browser') {
    const base = [
      requirement('browser-verification-state', 'browser.verification_state', 'Confirm URL, origin, login state, MFA/CAPTCHA, and automation-block state.'),
      requirement('browser-dom-aria', 'browser.dom_snapshot', 'Refresh DOM/ARIA role state before retrying a browser action.'),
    ];
    if (area === 'actionability') {
      base.push(requirement('browser-actionability', 'browser.locator_actionability', 'Confirm unique locator, visible, stable, receives-events, enabled, and editable checks.'));
    }
    if (area === 'proof_after') {
      base.push(requirement('browser-proof', 'browser.screenshot', 'Capture browser proof for the final visual or confirmation state.', 30_000));
    }
    return base;
  }

  if (contract.kind === 'local_file') {
    return [
      requirement('file-scope', 'desktop.file_search', 'Resolve the exact scoped path or no-match result inside approved roots.'),
      requirement('file-identity', 'desktop.file_stat', 'Refresh file stat, basename, hash, count, or output identity before retrying.'),
    ];
  }

  const isPhotoshop = /photoshop/i.test(contract.targetName);
  const isInDesign = /indesign/i.test(contract.targetName);
  const desktopRequirements = [
    requirement('desktop-window', 'desktop.window_state', 'Confirm focused app, active window, and active document identity.'),
  ];
  if (isPhotoshop) {
    desktopRequirements.push(
      requirement('photoshop-status', 'desktop.photoshop_document_status', 'Refresh Photoshop active document status before retry.'),
      requirement('photoshop-layer-inventory', 'desktop.photoshop_layer_inventory', 'Refresh Photoshop layer, selection, mask, and target-object inventory before retry.'),
    );
  } else if (isInDesign) {
    desktopRequirements.push(
      requirement('indesign-status', 'desktop.indesign_document_status', 'Refresh InDesign active document status before retry.'),
      requirement('indesign-text-inventory', 'desktop.indesign_text_inventory', 'Refresh InDesign text, layer, link, font, or preflight inventory before retry.'),
    );
  } else {
    desktopRequirements.push(
      requirement('desktop-a11y', 'desktop.read_a11y_tree', 'Refresh accessibility tree before desktop control retry.'),
      requirement('desktop-screenshot', 'desktop.screenshot', 'Refresh screenshot before visual, coordinate, or canvas retry.', 5_000),
    );
  }
  if (area === 'proof_after') {
    desktopRequirements.push(requirement('output-file-stat', 'desktop.file_stat', 'Refresh output artifact file stat, basename, hash, dimensions, or package summary.', 30_000));
  }
  return desktopRequirements;
}

function recommendedOptionId(args: {
  retryAllowed: boolean;
  userActionRequired: boolean;
  connectedAgentAllowed: boolean;
}): ComputerTaskEvidenceRecoveryContext['recommendedOptionId'] {
  if (args.userActionRequired) return 'resolve_contract_blocker';
  if (args.connectedAgentAllowed) return 'let_connected_agent_repair';
  if (args.retryAllowed) return 'retry_with_fresh_evidence';
  return 'stop_and_report';
}

function resumeInstructionFor(args: {
  area: ComputerTaskEvidenceFailureArea;
  contract: ComputerTaskEvidenceContract;
  routeDecision?: ComputerTaskEvidenceRecoveryAppRouteDecision | null;
  retryAllowed: boolean;
  userActionRequired: boolean;
  connectedAgentAllowed: boolean;
  requiredFreshEvidence: string[];
  gap?: AppAdapterGapContract | null;
}): string {
  const routeNextStep = args.routeDecision?.nextSteps?.[0];
  if (args.userActionRequired) {
    if (routeNextStep) {
      return `Stop automation and follow the app route decision: ${routeNextStep}`;
    }
    return 'Stop automation and ask the user to resolve the approval, login, verification, permission, app install, license, or bridge blocker before retrying.';
  }
  if (args.connectedAgentAllowed) {
    // Unfamiliar app: prescribe research-before-guess + the precise buildout.
    if (args.gap) {
      return `${routeNextStep ? `${routeNextStep} ` : ''}${args.gap.connectedAgentTask} Then retry: ${args.gap.retryPrompt}`;
    }
    if (routeNextStep) {
      return `${routeNextStep} Then verify with a focused smoke and retry the original task once with fresh evidence.`;
    }
    return 'Use a connected code agent for the smallest missing adapter or bridge capability, verify it with a focused smoke, then retry the original task once with fresh evidence.';
  }
  if (args.retryAllowed) {
    const evidence = args.requiredFreshEvidence.slice(0, 4).join(', ') || 'fresh route evidence';
    return `Collect ${evidence}, retry only the failed step once, and stop if proof is still missing or the same failure repeats.`;
  }
  return `Stop and report the ${args.contract.targetName} evidence-contract blocker without retrying or patching.`;
}

export function diagnoseComputerTaskEvidenceFailure(
  input: ComputerTaskEvidenceRecoveryInput,
): ComputerTaskEvidenceRecoveryContext | null {
  const contract = input.contract || null;
  if (!contract) return null;
  const appRouteDecision = summarizeAppRouteDecision(input.appRouteDecision);
  const text = textFromInput(input);
  const area = resolveFailureArea({
    rawArea: classifyFailureArea(text, contract),
    routeDecision: appRouteDecision,
  });
  const gap = input.appAdapterGap || null;
  // AR: a confidently-launchable fallback turns "the chosen app isn't
  // available" from a user-action / buildout dead-end into a switch-and-retry.
  const appFallbackSwitch = resolveAppFallbackSwitch(input, area, text, appRouteDecision);
  const userActionRequired = appFallbackSwitch ? false : requiresUserAction(area, text, appRouteDecision);
  const connectedAgentAllowed = appFallbackSwitch ? false : allowsConnectedAgent(area, text, contract, appRouteDecision);
  const retryAllowed = appFallbackSwitch
    ? true
    : allowsRetry(area, userActionRequired, connectedAgentAllowed, appRouteDecision);
  const requiredFreshEvidence = unique([
    ...contract.freshEvidenceRequired,
    ...(appRouteDecision?.missingConfirmations.map((item) => `App route confirmation: ${item}`) || []),
    area === 'actionability' ? contract.actionabilityChecks.join('; ') : null,
    area === 'proof_after' ? contract.proofAfter.join('; ') : null,
    // Unfamiliar app: the next observation should walk the universal find ladder.
    ...(gap && (area === 'fresh_evidence' || area === 'actionability' || area === 'observe_before')
      ? gap.universalFindLadder.slice(0, 2)
      : []),
  ], 6);
  const requiredProof = unique(contract.proofAfter, 5);
  const approvalBoundaries = unique([
    ...contract.approvalBefore,
    ...(appRouteDecision?.missingApprovals.map((item) => `App route approval: ${item}`) || []),
  ], 6);
  const failClosedRules = unique([
    ...contract.failClosedRules,
    ...(appRouteDecision?.failSafeRules || []),
  ], 6);
  const matchedRules = unique([
    appRouteDecision ? `App route decision ${appRouteDecision.status} via ${appRouteDecision.chosenSurfaceLabel}.` : null,
    ...(appRouteDecision?.userActionBlockers.map((item) => `App route user blocker: ${item}`) || []),
    ...(appRouteDecision?.nextSteps.map((item) => `App route next step: ${item}`) || []),
    ...matchingRules(text, [
      ...contract.observeBefore,
      ...contract.actionabilityChecks,
      ...contract.approvalBefore,
      ...contract.proofAfter,
      ...contract.failClosedRules,
    ], 5),
    ...(gap ? gap.researchPlan.slice(0, 2).map((item) => `Research before guessing: ${item}`) : []),
    area === 'unknown' ? 'No exact contract rule matched; recover conservatively.' : null,
  ], 6);
  const recommended = appFallbackSwitch
    ? 'retry_with_fresh_evidence'
    : recommendedOptionId({ retryAllowed, userActionRequired, connectedAgentAllowed });
  const named = appFallbackSwitch ? clean(input.namedAppIntent, 80) : '';
  const reason = appFallbackSwitch
    ? `${named ? `You asked to use ${named}, but it isn't available here. ` : "The chosen app couldn't be opened here. "}${appFallbackSwitch.displayName} can do this task (${describeFallbackOpen(appFallbackSwitch)}), so recovery can switch there instead of stopping.`
    : reasonForArea(area, contract, appRouteDecision);
  const resumeInstruction = appFallbackSwitch
    ? `Switch to ${appFallbackSwitch.displayName} — ${describeFallbackOpen(appFallbackSwitch)}${appFallbackSwitch.openTarget ? ` (${appFallbackSwitch.openTarget})` : ''} — and complete the task there with fresh observation. If ${appFallbackSwitch.displayName} also fails, stop and ask the user.`
    : resumeInstructionFor({
        area,
        contract,
        routeDecision: appRouteDecision,
        retryAllowed,
        userActionRequired,
        connectedAgentAllowed,
        requiredFreshEvidence,
        gap,
      });
  // AR: a switch-and-retry re-grounds on the fallback's surface — it does NOT
  // need the capability_gap buildout smokes, so request normal fresh evidence.
  const requiredEvidence = toolRequirementsForContract(appFallbackSwitch ? 'fresh_evidence' : area, contract);
  // Unfamiliar app capability gap: research the control surface before buildout.
  if (!appFallbackSwitch && gap && area === 'capability_gap') {
    requiredEvidence.unshift(requirement(
      'app-control-research',
      'research.search',
      `Research how ${gap.appName} exposes "${gap.operationLabel}" (scripting API, CLI, accessibility, menu/shortcut) before building or retrying.`,
      300_000,
    ));
  }
  const context: ComputerTaskEvidenceRecoveryContext = {
    schemaVersion: 1,
    targetName: contract.targetName,
    kind: contract.kind,
    taskFamily: contract.taskFamily,
    failureArea: area,
    reason,
    matchedRules,
    requiredFreshEvidence,
    requiredEvidence,
    requiredProof,
    approvalBoundaries,
    failClosedRules,
    appRouteDecision,
    retryAllowed,
    userActionRequired,
    connectedAgentAllowed,
    recommendedOptionId: recommended,
    resumeInstruction,
    appFallback: appFallbackSwitch,
    namedAppIntent: clean(input.namedAppIntent, 80) || null,
    appCapabilityResearch: gap
      ? {
          missingTool: gap.missingBridgeTools[0] || '',
          controlSurface: gap.controlSurface,
          findLadder: gap.universalFindLadder.slice(0, 4),
          researchPlan: gap.researchPlan.slice(0, 4),
          researchTriggers: gap.researchTriggers.slice(0, 3),
          buildoutTask: gap.connectedAgentTask,
          retryPrompt: gap.retryPrompt,
        }
      : null,
  };
  return {
    ...context,
    evidenceReadiness: evaluateComputerTaskEvidenceRecoveryReadiness({
      recovery: context,
      observations: input.observations || [],
    }),
  };
}

function observationTimeMs(value: string | number | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function observationSatisfiesRequirement(observation: ComputerTaskEvidenceRecoveryObservation, requirement: ComputerTaskEvidenceRequirement): boolean {
  // A failed/errored observation is not valid evidence — it can't satisfy a
  // required-evidence tool no matter how fresh its timestamp is.
  if (observation.ok === false) return false;
  return observation.tool === requirement.tool
    || observation.id === requirement.id
    || observation.ruleId === requirement.id;
}

export function evaluateComputerTaskEvidenceRecoveryReadiness(args: {
  recovery?: ComputerTaskEvidenceRecoveryContext | null;
  observations?: ComputerTaskEvidenceRecoveryObservation[];
  nowMs?: number;
}): ComputerTaskEvidenceRecoveryReadiness | null {
  const recovery = args.recovery || null;
  if (!recovery) return null;
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const checkedAt = new Date(nowMs).toISOString();
  if (!recovery.retryAllowed) {
    return {
      ready: false,
      status: 'blocked',
      checkedAt,
      satisfiedEvidenceIds: [],
      missingEvidenceIds: [],
      staleEvidenceIds: [],
      nextEvidenceTools: [],
      summary: recovery.resumeInstruction || 'Retry is blocked by the evidence contract.',
    };
  }

  const required = (recovery.requiredEvidence || []).filter((item) => item.required);
  const observations = (args.observations || []).filter((item) => item?.tool);
  const satisfiedEvidenceIds: string[] = [];
  const missingEvidenceIds: string[] = [];
  const staleEvidenceIds: string[] = [];
  const nextEvidenceTools: string[] = [];

  for (const item of required) {
    const matching = observations
      .filter((observation) => observationSatisfiesRequirement(observation, item))
      .map((observation) => {
        const capturedAt = observationTimeMs(observation.capturedAt ?? observation.at);
        const ageMs = capturedAt === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - capturedAt);
        return { observation, ageMs };
      })
      .sort((a, b) => a.ageMs - b.ageMs);
    const fresh = matching.find((match) => match.ageMs <= item.freshnessMs);
    if (fresh) {
      satisfiedEvidenceIds.push(item.id);
    } else if (matching.length > 0) {
      staleEvidenceIds.push(item.id);
      nextEvidenceTools.push(item.tool);
    } else {
      missingEvidenceIds.push(item.id);
      nextEvidenceTools.push(item.tool);
    }
  }

  const ready = required.length === 0 || (missingEvidenceIds.length === 0 && staleEvidenceIds.length === 0);
  const status = ready ? 'ready' : staleEvidenceIds.length > 0 ? 'stale' : 'missing';
  const missingText = missingEvidenceIds.length ? `missing ${missingEvidenceIds.join(', ')}` : '';
  const staleText = staleEvidenceIds.length ? `stale ${staleEvidenceIds.join(', ')}` : '';
  const summary = ready
    ? 'Required evidence-contract observations are fresh enough for the bounded retry.'
    : `Evidence-contract retry is not ready: ${[missingText, staleText].filter(Boolean).join('; ')}.`;

  return {
    ready,
    status,
    checkedAt,
    satisfiedEvidenceIds: Array.from(new Set(satisfiedEvidenceIds)).slice(0, 8),
    missingEvidenceIds: Array.from(new Set(missingEvidenceIds)).slice(0, 8),
    staleEvidenceIds: Array.from(new Set(staleEvidenceIds)).slice(0, 8),
    nextEvidenceTools: Array.from(new Set(nextEvidenceTools)).slice(0, 8),
    summary,
  };
}

export function formatComputerTaskEvidenceRecoveryForPrompt(
  context?: ComputerTaskEvidenceRecoveryContext | null,
): string | null {
  if (!context) return null;
  const requiredFreshEvidence = context.requiredFreshEvidence || [];
  const requiredEvidence = context.requiredEvidence || [];
  const requiredProof = context.requiredProof || [];
  const approvalBoundaries = context.approvalBoundaries || [];
  const failClosedRules = context.failClosedRules || [];
  const matchedRules = context.matchedRules || [];
  const appRouteDecision = context.appRouteDecision || null;
  return [
    'Computer task evidence recovery:',
    `- target: ${context.targetName} (${context.kind})`,
    `- task family: ${context.taskFamily}`,
    `- failure area: ${context.failureArea}`,
    `- reason: ${context.reason}`,
    `- retry allowed: ${context.retryAllowed ? 'yes, once after fresh evidence' : 'no'}`,
    `- user action required: ${context.userActionRequired ? 'yes' : 'no'}`,
    `- connected agent allowed: ${context.connectedAgentAllowed ? 'yes' : 'no'}`,
    `- recommended option: ${context.recommendedOptionId}`,
    requiredFreshEvidence.length ? `- required fresh evidence: ${requiredFreshEvidence.join(' | ')}` : '',
    requiredEvidence.length ? `- required evidence tools: ${requiredEvidence.filter((item) => item.required).map((item) => `${item.id}:${item.tool}`).join(', ')}` : '',
    context.evidenceReadiness ? `- evidence readiness: ${context.evidenceReadiness.status}; ${context.evidenceReadiness.summary}` : '',
    appRouteDecision ? `- app route decision: ${appRouteDecision.status} via ${appRouteDecision.chosenSurfaceLabel}` : '',
    appRouteDecision?.missingConfirmations.length ? `- app route missing confirmations: ${appRouteDecision.missingConfirmations.join(' | ')}` : '',
    appRouteDecision?.missingApprovals.length ? `- app route missing approvals: ${appRouteDecision.missingApprovals.join(' | ')}` : '',
    appRouteDecision?.nextSteps.length ? `- app route next steps: ${appRouteDecision.nextSteps.join(' | ')}` : '',
    requiredProof.length ? `- required proof: ${requiredProof.join(' | ')}` : '',
    approvalBoundaries.length ? `- approval boundaries: ${approvalBoundaries.join(' | ')}` : '',
    failClosedRules.length ? `- fail closed: ${failClosedRules.join(' | ')}` : '',
    matchedRules.length ? `- matched contract rules: ${matchedRules.join(' | ')}` : '',
    context.appCapabilityResearch ? `- app find ladder: ${context.appCapabilityResearch.findLadder.join(' | ')}` : '',
    context.appCapabilityResearch ? `- research before guessing: ${context.appCapabilityResearch.researchPlan.join(' | ')}` : '',
    context.appCapabilityResearch?.missingTool ? `- propose app tool: ${context.appCapabilityResearch.missingTool}` : '',
    `- resume instruction: ${context.resumeInstruction}`,
  ].filter(Boolean).join('\n');
}
