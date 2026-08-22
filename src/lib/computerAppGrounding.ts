import {
  buildComputerAppTaskStrategy,
  type ComputerAppTaskStrategy,
  type ComputerAppStrategyId,
} from './computerAppTaskStrategy';
import { buildDesignAppAutomationPlan } from './designAppAutomation';
import { compileComputerSequenceProgram } from './computerSequenceProgramCore';
import type { UserTaskPipelineDecision } from './userTaskPipelines';

export type ComputerAppGroundingSurface =
  | 'browser'
  | 'desktop'
  | 'vault'
  | 'terminal'
  | 'file'
  | 'code'
  | 'research'
  | 'approval'
  | 'system';

export type ComputerAppGroundingSeverity = 'info' | 'warning' | 'blocker';

export interface ComputerAppObservationRule {
  id: string;
  surface: ComputerAppGroundingSurface;
  tool: string;
  reason: string;
  requiredBeforeAction: boolean;
  freshnessMs: number;
}

export interface ComputerAppGroundingPlan {
  strategy: ComputerAppTaskStrategy;
  primarySurface: ComputerAppGroundingSurface;
  observationRules: ComputerAppObservationRule[];
  actionDiscipline: string[];
  fallbackChain: string[];
  approvalGates: string[];
  forbiddenFallbacks: string[];
  verificationSignals: string[];
}

export interface ComputerAppGroundedAction {
  id: string;
  surface: ComputerAppGroundingSurface;
  tool: string;
  description: string;
  mutates: boolean;
  sourceObservationIds?: string[];
  observationAgeMs?: number | null;
  approvalState?: 'not_required' | 'pending' | 'approved' | 'rejected' | null;
  status?: 'pending' | 'success' | 'failed' | 'blocked' | 'skipped';
  resultSummary?: string | null;
  failureReason?: string | null;
}

export interface ComputerAppGroundingObservation {
  id: string;
  ruleId: string;
  surface: ComputerAppGroundingSurface;
  tool: string;
  capturedAt: string | number;
  summary: string;
  confidence?: number | null;
  target?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Exact live target identity captured by an observation epoch. Mutations bind
 * to these fields so focus theft, window changes, stale accessibility trees,
 * and browser tab changes fail closed instead of acting on a look-alike UI.
 *
 * Not every surface exposes every field. Desktop epochs require app identity,
 * PID, and either window identity or a fresh accessibility-tree generation;
 * browser epochs can additionally bind the bridge process capability while
 * always requiring session, tab, and URL identity.
 */
export interface ComputerAppObservationTarget {
  appName?: string | null;
  bundleId?: string | null;
  pid?: number | null;
  windowId?: string | number | null;
  documentId?: string | null;
  browserProcessId?: string | null;
  browserSessionId?: string | null;
  browserTabId?: string | null;
  /** Privacy-safe stable identity for one observed browser element. */
  browserTargetFingerprint?: string | null;
  url?: string | null;
  accessibilityGeneration?: string | number | null;
  /** Privacy-safe keyed identity for one observed native accessibility target. */
  accessibilityTargetFingerprint?: string | null;
  screenshotId?: string | null;
}

/**
 * One fresh, immutable view of the target surface. It is invalidated after
 * navigation, focus/window changes, modal changes, or any mutation.
 */
export interface ComputerAppObservationEpoch {
  schemaVersion: 1;
  id: string;
  surface: ComputerAppGroundingSurface;
  capturedAt: string;
  expiresAt: string;
  target: ComputerAppObservationTarget;
  evidenceIds: string[];
  blockerCodes: string[];
  invalidatedAt?: string | null;
  invalidationReason?: string | null;
}

export type ComputerAppMutationRisk = 'low' | 'medium' | 'high' | 'critical';
export type ComputerAppMutationApprovalState =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'rejected';

export interface ComputerAppMutationVerification {
  kind: 'app_state' | 'accessibility' | 'browser_dom' | 'artifact' | 'visual';
  predicate: string;
  evidenceTools: string[];
}

/**
 * Dispatch-time contract for one mutating tool call. The model may propose
 * this shape, but the runtime is the authority that validates it.
 */
export interface ComputerAppMutationContract {
  schemaVersion: 1;
  actionId: string;
  tool: string;
  surface: ComputerAppGroundingSurface;
  observationEpochId: string;
  expectedTarget: ComputerAppObservationTarget;
  /** Digest/fingerprint of the exact normalized tool arguments, never raw secrets. */
  toolArgsFingerprint: string;
  /** Requested/adapter minimum; the sealed runtime policy may raise it. */
  risk: ComputerAppMutationRisk;
  /** Requested/adapter minimum; the sealed runtime policy may require it. */
  approvalRequired: boolean;
  idempotencyKey: string;
  verification: ComputerAppMutationVerification;
  outcomeUnknownPolicy: 'verify_before_retry' | 'never_retry';
}

/**
 * Runtime-owned policy result for the exact proposed call. The model cannot
 * self-assert risk or approval: authorization requires this independent
 * verdict and rejects any contract/policy mismatch.
 */
export interface ComputerAppMutationPolicyVerdict {
  schemaVersion: 1;
  actionId: string;
  tool: string;
  toolArgsFingerprint: string;
  risk: ComputerAppMutationRisk;
  approvalRequired: boolean;
  approvalState: ComputerAppMutationApprovalState;
  approvalId?: string | null;
  approvalKey: string;
  decidedAt: string;
  source: 'canonical_tool_policy' | 'user_grant_policy';
}

export interface ResolveComputerAppMutationPolicyInput {
  action: ComputerAppMutationContract;
  approvalGate?: ComputerAppMutationApprovalGate | null;
  decidedAt?: string | number;
}

export interface ComputerAppMutationApprovalRequest {
  actionId: string;
  tool: string;
  toolArgsFingerprint: string;
  approvalKey: string;
  risk: ComputerAppMutationRisk;
  contractBinding: string;
}

export interface ComputerAppMutationApprovalDecision {
  decision: 'approved' | 'auto_approved' | 'pending' | 'rejected';
  approvalId?: string | null;
  /** Must exactly echo the requested key from the trusted approval store. */
  approvalKey: string;
}

export type ComputerAppMutationApprovalGate = (
  request: ComputerAppMutationApprovalRequest,
) => Promise<ComputerAppMutationApprovalDecision>;

export type ComputerAppMutationBlockCode =
  | 'contract_version_unsupported'
  | 'contract_value_invalid'
  | 'policy_verdict_missing'
  | 'policy_mismatch'
  | 'action_identity_missing'
  | 'missing_epoch'
  | 'epoch_identity_missing'
  | 'epoch_mismatch'
  | 'epoch_untrusted'
  | 'epoch_invalidated'
  | 'epoch_stale'
  | 'epoch_clock_invalid'
  | 'surface_mismatch'
  | 'target_identity_missing'
  | 'target_mismatch'
  | 'observation_blocker'
  | 'approval_required'
  | 'approval_rejected'
  | 'approval_receipt_missing'
  | 'tool_args_fingerprint_missing'
  | 'idempotency_key_missing'
  | 'idempotency_replay'
  | 'idempotency_capacity'
  | 'verification_missing'
  | 'unsafe_replay_policy';

export interface ComputerAppMutationBlocker {
  code: ComputerAppMutationBlockCode;
  detail: string;
  recovery: string;
}

export interface ComputerAppMutationAuthorization {
  allowed: boolean;
  checkedAt: string;
  /** Hard handler-entry deadline: min(observation expiry, policy expiry). */
  expiresAt: string;
  epochId: string | null;
  actionId: string;
  /** Canonical bounded snapshot of the exact contract authorized for dispatch. */
  contractBinding: string;
  /** Canonical bounded snapshot of the independent runtime policy verdict. */
  policyBinding: string;
  blockers: ComputerAppMutationBlocker[];
  summary: string;
}

export interface ComputerAppMutationDispatchReceipt {
  schemaVersion: 1;
  actionId: string;
  tool: string;
  epochId: string;
  contractBinding: string;
  policyBinding: string;
  authorizedAt: string;
  dispatchedAt: string;
}

export type ComputerAppMutationDispatchResult<T> =
  | { dispatchReceipt: ComputerAppMutationDispatchReceipt; ok: true; value: T }
  | { dispatchReceipt: ComputerAppMutationDispatchReceipt; ok: false; error: unknown };

export type ComputerAppSealedMutationArgs<T> =
  T extends (...args: never[]) => unknown
    ? never
    : T extends readonly (infer Item)[]
      ? readonly ComputerAppSealedMutationArgs<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: ComputerAppSealedMutationArgs<T[Key]> }
        : T;

export interface ComputerAppVerificationReceipt {
  schemaVersion: 1;
  actionId: string;
  beforeEpochId: string;
  afterEpochId: string | null;
  status: 'verified' | 'failed' | 'inconclusive';
  predicate: string;
  evidenceIds: string[];
  checkedAt: string;
  blockers: string[];
  canComplete: boolean;
}

export interface ComputerAppGroundingFinding {
  severity: ComputerAppGroundingSeverity;
  label: string;
  detail: string;
  fix: string;
}

export interface ComputerAppGroundingAudit {
  ok: boolean;
  findings: ComputerAppGroundingFinding[];
  summary: string;
}

export interface ComputerAppActionReadiness {
  ready: boolean;
  action: ComputerAppGroundedAction;
  requiredRuleIds: string[];
  satisfiedRuleIds: string[];
  missingRuleIds: string[];
  staleRuleIds: string[];
  nextObservationTools: string[];
  findings: ComputerAppGroundingFinding[];
  summary: string;
}

export interface ComputerAppGroundingRunbookStep {
  id: string;
  phase: 'observe' | 'decide' | 'act' | 'verify' | 'recover' | 'stop';
  title: string;
  tool?: string;
  required: boolean;
  detail: string;
}

export interface ComputerAppGroundingRunbook {
  strategy: ComputerAppTaskStrategy;
  primarySurface: ComputerAppGroundingSurface;
  steps: ComputerAppGroundingRunbookStep[];
  maxActionAttemptsBeforeRecovery: number;
  maxSurfaceSwitches: number;
}

export type ComputerAppGroundingNextStepKind =
  | 'observe'
  | 'request_approval'
  | 'act'
  | 'verify'
  | 'recover'
  | 'stop';

export interface ComputerAppGroundingNextStep {
  kind: ComputerAppGroundingNextStepKind;
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  tool?: string;
  ruleId?: string;
  actionId?: string;
  readiness?: ComputerAppActionReadiness;
  findings: ComputerAppGroundingFinding[];
}

export type ComputerAppGroundingTraceStatus =
  | 'not_applicable'
  | 'needs_observation'
  | 'needs_approval'
  | 'ready_to_act'
  | 'needs_verification'
  | 'recovering'
  | 'blocked'
  | 'complete';

export interface ComputerAppGroundingObservationFreshness {
  ruleId: string;
  tool: string;
  required: boolean;
  freshnessMs: number;
  latestObservationId: string | null;
  ageMs: number | null;
  fresh: boolean;
  summary: string;
}

export interface ComputerAppGroundingTrace {
  version: 1;
  strategyId: ComputerAppStrategyId | null;
  strategyLabel: string | null;
  primarySurface: ComputerAppGroundingSurface | null;
  status: ComputerAppGroundingTraceStatus;
  observations: ComputerAppGroundingObservation[];
  observationFreshness: ComputerAppGroundingObservationFreshness[];
  actions: ComputerAppGroundedAction[];
  audit: ComputerAppGroundingAudit;
  nextStep: ComputerAppGroundingNextStep;
  display: {
    title: string;
    summary: string;
    badges: string[];
    blockers: string[];
    nextAction: string;
  };
  persistenceTargets: string[];
}

const DEFAULT_FRESHNESS_MS = 15_000;
const CANVAS_FRESHNESS_MS = 5_000;
const LAYOUT_FRESHNESS_MS = 5_000;
const CAD_FRESHNESS_MS = 5_000;
const OPS_FRESHNESS_MS = 60_000;

function rule(
  id: string,
  surface: ComputerAppGroundingSurface,
  tool: string,
  reason: string,
  requiredBeforeAction = true,
  freshnessMs = DEFAULT_FRESHNESS_MS,
): ComputerAppObservationRule {
  return { id, surface, tool, reason, requiredBeforeAction, freshnessMs };
}

function strategyGrounding(strategy: ComputerAppTaskStrategy, message = ''): Omit<ComputerAppGroundingPlan, 'strategy'> {
  const designPlan = strategy.id === 'creative_layout_control' ? buildDesignAppAutomationPlan(message) : null;
  switch (strategy.id) {
    case 'browser_semantic':
      return {
        primarySurface: 'browser',
        observationRules: [
          rule('browser-verification', 'browser', 'browser.verification_state', 'Detect login, MFA, CAPTCHA, Cloudflare, and other gates before mutation.'),
          rule('browser-dom', 'browser', 'browser.dom_snapshot', 'Ground clicks, fills, selects, and extraction in DOM/ARIA state.'),
          rule('browser-proof', 'browser', 'browser.screenshot', 'Use screenshot for visual proof or when DOM state is incomplete.', false, 30_000),
        ],
        actionDiscipline: [
          'Prefer role/name or accessible selector actions before CSS selectors.',
          'Use one browser action per fresh DOM observation when changing state.',
          'Extract structured data from DOM/ARIA first; screenshot is supporting proof.',
        ],
        fallbackChain: [
          'DOM/ARIA snapshot',
          'Playwright role/name locator',
          'Stable CSS selector only when semantic locator is unavailable',
          'Stagehand-style semantic action for ambiguous dynamic UI',
          'Screenshot/vision proof after action',
        ],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: [
          'Do not use coordinate clicks for browser UI unless semantic and selector paths are exhausted and a fresh screenshot exists.',
          'Do not continue through bot verification, MFA, or CAPTCHA.',
        ],
        verificationSignals: ['URL/title change', 'visible DOM confirmation', 'field value/state change', 'screenshot proof when visual state matters'],
      };
    case 'credentialed_browser':
      return {
        primarySurface: 'browser',
        observationRules: [
          rule('vault-runbook', 'vault', 'vault.runbook', 'Resolve allowed origins, grant scope, and no-secret handling before login.'),
          rule('browser-verification', 'browser', 'browser.verification_state', 'Stop for MFA/CAPTCHA/security checks before credential use.'),
          rule('browser-dom', 'browser', 'browser.dom_snapshot', 'Find login and workflow fields by DOM/ARIA.'),
        ],
        actionDiscipline: [
          'Never expose raw secrets to the model or chat transcript.',
          'Fill secret fields only through vault-safe credential tools.',
          'Confirm page origin matches the vault grant before using a credential.',
        ],
        fallbackChain: [
          'Vault grant and origin policy',
          'Verification-state check',
          'DOM/ARIA field discovery',
          'Vault-safe fill',
          'Human handoff for MFA/CAPTCHA',
        ],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: [
          'Do not ask the user to paste passwords into chat.',
          'Do not use credentials on an origin not covered by the vault grant.',
          'Do not bypass MFA, CAPTCHA, or bot verification.',
        ],
        verificationSignals: ['origin matches grant', 'authenticated page state', 'draft/save confirmation', 'no raw secret in logs'],
      };
    case 'approval_sensitive_browser':
      return {
        primarySurface: 'browser',
        observationRules: [
          rule('browser-verification', 'browser', 'browser.verification_state', 'Detect login and human verification before business side effects.'),
          rule('browser-dom', 'browser', 'browser.dom_snapshot', 'Stage records, carts, messages, bookings, and forms from DOM/ARIA state.'),
          rule('approval-state', 'approval', 'approvals.request', 'Gate final send/pay/book/publish/write actions behind explicit user approval.', true, 120_000),
        ],
        actionDiscipline: [
          'Stage the change first; do not take final side-effect actions until approval is approved.',
          'Re-observe pricing, recipient, date, quantity, and destination immediately before final action.',
          'Use vault-safe login flow if authentication is required.',
        ],
        fallbackChain: [
          'Verification-state check',
          'DOM/ARIA observation',
          'Draft/stage reversible changes',
          'Approval request with exact final action',
          'Post-approval final action',
          'DOM/screenshot verification',
        ],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: [
          'Do not click purchase, book, send, publish, delete, or save-to-record controls without approved approval state.',
          'Do not accept changed price/terms/recipient silently.',
        ],
        verificationSignals: ['draft/staged state', 'approved approval id', 'final confirmation text', 'receipt/order/post/record id when present'],
      };
    case 'browser_file_transfer':
      return {
        primarySurface: 'browser',
        observationRules: [
          rule('file-search', 'file', 'desktop.file_search', 'Resolve source upload files or expected download/export locations before browser transfer.', false, 120_000),
          rule('file-stat', 'file', 'desktop.file_stat', 'Verify local file existence and metadata before upload or after download.', true, 120_000),
          rule('browser-verification', 'browser', 'browser.verification_state', 'Pause for CAPTCHA, MFA, bot checks, or security gates before file-transfer actions.'),
          rule('browser-dom', 'browser', 'browser.dom_snapshot', 'Find upload, import, export, or download controls semantically before clicking.'),
        ],
        actionDiscipline: [
          'Resolve the exact local file path before browser upload.',
          'Use browser.upload_file for file inputs and file choosers before coordinate fallback.',
          'Verify downloaded or exported files locally before reporting completion.',
        ],
        fallbackChain: ['desktop.file_search/stat', 'browser.verification_state', 'browser.dom_snapshot', 'browser.upload_file or semantic download click', 'desktop.file_search/stat verification'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: ['Do not upload ambiguous files.', 'Do not publish or submit after upload without approval.', 'Do not bypass bot verification or credential walls.'],
        verificationSignals: ['file path', 'file size', 'attached/imported confirmation', 'downloaded/exported local file metadata'],
      };
    case 'agent_asset_acquisition':
      return {
        primarySurface: 'terminal',
        observationRules: [
          rule('agent-roster', 'terminal', 'office.list_agents', 'Find a managed Codex terminal session before assigning acquisition work.', false, 30_000),
          rule('acquire-approval', 'approval', 'approvals.request', 'Gate network downloads, package installs, repo clones, generated assets, and local file writes.', true, 120_000),
          rule('asset-search', 'file', 'desktop.file_search', 'Check whether the requested asset already exists and locate Codex output files after acquisition.', false, 120_000),
          rule('asset-stat', 'file', 'desktop.file_stat', 'Confirm acquired file existence, size, and type before use.', true, 120_000),
        ],
        actionDiscipline: [
          'Prefer reusing an attached managed Codex session; launch a scoped Codex session only when no target is available.',
          'Constrain Codex to an explicit output folder and require a manifest with absolute paths.',
          'Never use an acquired asset until desktop.file_search and desktop.file_stat verify it exists.',
        ],
        fallbackChain: ['office.list_agents', 'agent.codex_acquire_asset', 'terminal progress note', 'desktop.file_search', 'desktop.file_stat', 'continue browser/app workflow'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: [
          'Do not claim a download completed just because a Codex session was launched.',
          'Do not let Codex use credentials, bypass paywalls, solve human verification gates, or download unsafe files.',
        ],
        verificationSignals: ['Codex session id', 'output manifest path', 'artifact path', 'file size', 'file type', 'source URL/license when relevant'],
      };
    case 'desktop_readonly':
      return {
        primarySurface: 'desktop',
        observationRules: [
          rule('desktop-tabs', 'desktop', 'desktop.list_browser_tabs', 'Read local browser tabs from the local bridge, not a remote Browserbase session.', false, 10_000),
          rule('desktop-windows', 'desktop', 'desktop.window_state', 'Read active/frontmost app and window state.', false, 10_000),
          rule('desktop-apps', 'desktop', 'desktop.list_running_apps', 'Read running apps when app context matters.', false, 10_000),
        ],
        actionDiscipline: ['Read-only tasks cannot mutate local state.', 'If the local bridge is unavailable, report that exact blocker.'],
        fallbackChain: ['desktop.list_browser_tabs', 'desktop.window_state', 'desktop.list_running_apps', 'clear blocker if local bridge is unavailable'],
        approvalGates: [],
        forbiddenFallbacks: ['Do not substitute Browserbase for the user\'s local Chrome/Safari tabs.', 'Do not open, close, click, type, or focus apps for read-only awareness.'],
        verificationSignals: ['browser/app name', 'window title', 'URL when available', 'timestamp/source surface'],
      };
    case 'desktop_semantic':
    case 'productivity_app_control':
      return {
        primarySurface: 'desktop',
        observationRules: [
          rule('desktop-window', 'desktop', 'desktop.window_state', 'Confirm frontmost app/window before input.'),
          rule('desktop-a11y', 'desktop', 'desktop.read_a11y_tree', 'Ground clicks and typing in accessibility state.'),
          rule('desktop-screenshot', 'desktop', 'desktop.screenshot', 'Use screenshot when the accessibility tree is incomplete or visual proof is needed.', false, 10_000),
        ],
        actionDiscipline: [
          'Focus the requested app/window before typing.',
          'Use native menu paths and accessible elements before coordinate clicks.',
          'Draft before send/archive/delete or any external side effect.',
        ],
        fallbackChain: [
          'window_state',
          'read_a11y_tree',
          'menu_click/click_element/type_text/press_keys',
          'fresh screenshot for visual gaps',
          'coordinate click only after screenshot and screen bounds',
        ],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: [
          'Do not type unless focused app and destination field are verified.',
          'Do not click coordinates without a fresh screenshot and screen_size.',
        ],
        verificationSignals: ['focused app/window', 'a11y tree state change', 'draft content visible', 'screenshot proof'],
      };
    case 'desktop_canvas_vision':
      return {
        primarySurface: 'desktop',
        observationRules: [
          rule('desktop-screenshot', 'desktop', 'desktop.screenshot', 'Canvas work needs a fresh visual observation before every coordinate action.', true, CANVAS_FRESHNESS_MS),
          rule('desktop-screen-size', 'desktop', 'desktop.screen_size', 'Validate coordinates against current screen dimensions.', true, 60_000),
          rule('desktop-a11y', 'desktop', 'desktop.read_a11y_tree', 'Use menus and panels semantically when available.', false, 15_000),
        ],
        actionDiscipline: [
          'Prefer menus, shortcuts, and accessible controls before coordinate drag/click.',
          'Every coordinate action must cite the screenshot it was based on.',
          'Verify visual result after every canvas mutation.',
        ],
        fallbackChain: ['menu_click', 'a11y menus/panels', 'keyboard shortcuts', 'fresh screenshot', 'screen_size', 'coordinate click/drag', 'post-action screenshot'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: ['No blind coordinate action.', 'No saving over or exporting files without approval.'],
        verificationSignals: ['before/after screenshot comparison', 'visible tool/layer/canvas state', 'export preview when requested'],
      };
    case 'creative_layout_control':
      if (designPlan?.appId === 'adobe_photoshop') {
        return {
          primarySurface: 'desktop',
          observationRules: [
            rule('design-file-stat', 'file', 'desktop.file_stat', 'Verify the exact Photoshop source document/image or staged package path before opening, mutating, saving, or exporting.', true, 120_000),
            rule('photoshop-document-status', 'desktop', 'desktop.photoshop_document_status', 'Confirm active document, path, saved/modified state, dimensions, resolution, color mode/profile, selection state, and linked/embedded asset status.', true, LAYOUT_FRESHNESS_MS),
            rule('photoshop-layer-inventory', 'desktop', 'desktop.photoshop_layer_inventory', 'Map layers by name/type/visibility/lock state, text layers, masks, smart objects, adjustment layers, and selection/mask readiness before mutation.', true, LAYOUT_FRESHNESS_MS),
            rule('layout-a11y', 'desktop', 'desktop.read_a11y_tree', 'Use Photoshop menus/panels/accessibility for known commands and gaps not covered by script-backed bridge tools.', false, 15_000),
            rule('layout-screenshot', 'desktop', 'desktop.screenshot', 'Capture visual proof before coordinate fallback and after visible image/composite changes.', false, LAYOUT_FRESHNESS_MS),
            rule('approval-state', 'approval', 'approvals.request', 'Gate destructive pixel edits, generative/content-aware fill, layer deletion/rasterize/flatten, save-over-source, export, and new script/adapter execution.', true, 120_000),
          ],
          actionDiscipline: [
            'Treat Photoshop as a structured image document first: file/package, document status, layer/mask/selection inventory, then mutation.',
            'If document status reports NO open document, create one with desktop.photoshop_create_document (requested pixel dimensions, else ask) instead of stopping — a blank document is the expected starting state for new-project/from-scratch tasks.',
            'Prefer script-backed Photoshop tools for layer state, text layers, placed assets, exports, and document state before accessibility clicks, keyboard shortcuts, or coordinates.',
            'Confirm selection or mask state before localized generative/content-aware edits.',
            'Use one layer/selection/asset/export operation per verification checkpoint, then re-run status/inventory.',
            'Do not save over source, flatten, rasterize, delete layers, run generative fill, or export final deliverables without approval and destination verification.',
          ],
          fallbackChain: [
            'file_stat/search for source package',
            'open_path or launch/focus Photoshop',
            'photoshop_document_status',
            'photoshop_create_document when no document is open (new-project/from-scratch tasks)',
            'photoshop_layer_inventory',
            'photoshop_set_layer_state/update_text_layer/place_asset/export_proof when available',
            'a11y/menu workflow for known Photoshop command gaps',
            'screenshot/screen_size for visual fallback only',
            'agent.build_app_capability if the requested operation has no bridge tool',
          ],
          approvalGates: strategy.approvalCheckpoints,
          forbiddenFallbacks: [
            'No blind coordinate editing of image pixels or layer controls.',
            'No editing a mismatched or unknown active document.',
            'No save/export/overwrite/destructive pixel edit/generative fill without approval.',
            'No localized generative/content-aware edit without a verified selection or mask.',
          ],
          verificationSignals: ['refreshed Photoshop layer inventory shows requested layer/text/asset changes', 'document status reports expected doc/path, dimensions, color mode, and selection/mask state', 'before/after screenshot or raster proof export', 'file_stat for exported output'],
        };
      }
      return {
        primarySurface: 'desktop',
        observationRules: [
          rule('layout-file-stat', 'file', 'desktop.file_stat', 'Verify the exact InDesign source document or staged package path before opening, mutating, saving, exporting, or packaging.', true, 120_000),
          rule('indesign-document-status', 'desktop', 'desktop.indesign_document_status', 'Confirm active document, path, saved/modified state, page/spread count, layers, missing links, missing fonts, and locked/hidden layers.', true, LAYOUT_FRESHNESS_MS),
          rule('indesign-text-inventory', 'desktop', 'desktop.indesign_text_inventory', 'Map text frames by layer/name/label, content preview, match count, overset state, locked state, and visibility before text-layer changes.', true, LAYOUT_FRESHNESS_MS),
          rule('layout-a11y', 'desktop', 'desktop.read_a11y_tree', 'Use InDesign menus/panels/accessibility for export, package, place, layer options, and gaps not covered by script-backed bridge tools.', false, 15_000),
          rule('layout-screenshot', 'desktop', 'desktop.screenshot', 'Capture visual proof before coordinate fallback and after visible layout changes.', false, LAYOUT_FRESHNESS_MS),
          rule('approval-state', 'approval', 'approvals.request', 'Gate document mutations, relinks, save/export/package, layer visibility changes, and new script/adapter execution.', true, 120_000),
        ],
        actionDiscipline: [
          'Treat InDesign as a structured document first: file/package, DOM status, layer/text/link/font inventory, then mutation.',
          'Prefer script-backed InDesign tools for copy changes before accessibility clicks, keyboard shortcuts, or coordinates.',
          'Use one layer/text/link operation per verification checkpoint, then re-run inventory/status.',
          'Never edit a document when the expected document name/path is mismatched.',
          'Do not save/export/package/relink without approval and destination file verification.',
        ],
        fallbackChain: [
          'file_stat/search for source package',
          'open_path or launch/focus InDesign',
          'indesign_document_status',
          'indesign_text_inventory',
          'indesign_batch_update_text_layers or batch_find_change',
          'a11y/menu workflow for export/package/place gaps',
          'screenshot/screen_size for visual fallback only',
          'agent.build_app_capability if the requested operation has no bridge tool',
        ],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: [
          'No blind coordinate editing of layout objects.',
          'No editing a mismatched or unknown active document.',
          'No save/export/package/relink/overwrite without approval.',
          'No ignoring missing fonts, missing links, hidden layers, locked layers, or overset text.',
        ],
        verificationSignals: ['refreshed text inventory shows requested copy/layer changes', 'document status reports expected doc/path and link/font state', 'before/after screenshot or proof export', 'file_stat for exported/package output'],
      };
    case 'engineering_cad_control':
      return {
        primarySurface: 'desktop',
        observationRules: [
          rule('cad-window-state', 'desktop', 'desktop.window_state', 'Confirm the requested CAD/engineering app, active drawing/model window, and focus before input.', true, CAD_FRESHNESS_MS),
          rule('cad-a11y', 'desktop', 'desktop.read_a11y_tree', 'Ground command line, menus, panels, and file dialogs in accessibility state.', true, CAD_FRESHNESS_MS),
          rule('cad-screenshot', 'desktop', 'desktop.screenshot', 'Verify drawing/model geometry, command prompts, units, and visual state before geometry edits.', true, CAD_FRESHNESS_MS),
          rule('cad-screen-size', 'desktop', 'desktop.screen_size', 'Validate any coordinate fallback against current screen dimensions.', false, 60_000),
          rule('cad-file-stat', 'file', 'desktop.file_stat', 'Verify source and destination CAD files before opening, saving, overwriting, or exporting.', false, 120_000),
          rule('approval-state', 'approval', 'approvals.request', 'Gate CAD file mutations, exports, overwrites, macros, plugin execution, and production deliverables.', true, 120_000),
        ],
        actionDiscipline: [
          'Confirm app, document, units, scale, origin, and command line state before editing.',
          'Prefer CAD command line/menu/panel operations with explicit numeric input over pointer movement.',
          'Do one geometry or modeling operation per checkpoint, then re-observe before the next.',
          'Save, export, overwrite, macros, and plugin execution require approval and file verification.',
        ],
        fallbackChain: [
          'window_state',
          'read_a11y_tree',
          'screenshot',
          'file_stat/search for source or destination files',
          'menu/command-line/shortcut action',
          'post-action screenshot and dimension/unit check',
          'approval before save/export/overwrite',
        ],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: [
          'No unverified geometry, units, scale, or coordinate origin.',
          'No blind coordinate drawing or dragging.',
          'No saving/exporting/overwriting engineering deliverables without approval.',
        ],
        verificationSignals: ['active CAD app and document', 'units/scale/dimension checkpoint', 'before/after geometry screenshot', 'file_stat after save/export', 'human confirmation for ambiguous tolerances'],
      };
    case 'universal_app_control':
      return {
        primarySurface: 'desktop',
        observationRules: [
          rule('app-window-state', 'desktop', 'desktop.window_state', 'Confirm target app, active window, focus, and whether the requested app is available.', true, 10_000),
          rule('app-a11y', 'desktop', 'desktop.read_a11y_tree', 'Discover accessible menus, controls, fields, command bars, and current app state before generic control.', true, 10_000),
          rule('app-screenshot', 'desktop', 'desktop.screenshot', 'Capture visual state for unfamiliar or canvas-heavy apps when accessibility is incomplete.', false, 10_000),
          rule('app-official-docs', 'research', 'research.search', 'Find existing recipes and official vendor/OS automation docs before adding an app-specific adapter or bridge tool.', false, 120_000),
          rule('agent-roster', 'terminal', 'office.list_agents', 'Find a connected Codex/agent session before delegating missing app capability buildout.', false, 30_000),
          rule('approval-state', 'approval', 'approvals.request', 'Gate unfamiliar app mutations and connected-agent capability buildout before code, file, macro, or external side effects.', true, 120_000),
        ],
        actionDiscipline: [
          'Treat unfamiliar apps as discoverable, not impossible.',
          'Prefer official app APIs, scripting, command interfaces, file formats, and accessibility semantics before screenshots or coordinates.',
          'Try generic desktop controls only after app/window/a11y or screenshot grounding.',
          'If no safe generic path exists, delegate agent.build_app_capability with the app, task, gap, and desired outcome.',
          'Retry only after the connected agent returns a recipe, adapter, bridge tool, smoke, or explicit blocker.',
        ],
        fallbackChain: [
          'integrations/agent roster',
          'official docs / existing recipe search',
          'window_state',
          'read_a11y_tree',
          'screenshot for visual gaps',
          'generic menu/click_element/set_value/type/key action',
          'agent.build_app_capability for missing app recipe/adapter/tooling',
          'focused smoke and retry',
        ],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: [
          'Do not guess app-specific shortcuts, commands, or file formats.',
          'Do not keep clicking/typing after two failed generic actions.',
          'Do not let unknown-app work fall back to plain chat when connected-agent buildout is available.',
        ],
        verificationSignals: ['official docs or existing recipe checked', 'target app/window', 'a11y/screenshot evidence', 'new app recipe or adapter path', 'smoke-test result', 'post-action state or explicit blocker'],
      };
    case 'document_data_workbench':
      return {
        primarySurface: 'file',
        observationRules: [
          rule('file-search', 'file', 'desktop.file_search', 'Locate the requested file within approved scope.', false, 120_000),
          rule('file-read', 'file', 'desktop.file_read', 'Ground extracted fields in readable file content.', true, 120_000),
          rule('document-preview', 'desktop', 'desktop.screenshot', 'Use visual/OCR evidence for scanned or layout-sensitive documents.', false, 30_000),
        ],
        actionDiscipline: [
          'Produce a dry-run artifact before import/upload/write.',
          'Carry source references for extracted fields.',
          'Mark uncertain OCR or missing fields instead of guessing.',
        ],
        fallbackChain: ['file_search', 'file_read', 'OCR/vision when needed', 'structured artifact preview', 'approval before write/upload'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: ['Do not write imported data without a preview and approval.', 'Do not infer legal/financial conclusions from low-confidence extraction.'],
        verificationSignals: ['source path/page reference', 'field confidence', 'sample-row validation', 'dry-run artifact'],
      };
    case 'ops_console_control':
      return {
        primarySurface: 'code',
        observationRules: [
          rule('ops-context', 'code', 'code.inspect', 'Confirm repo/service/environment/blast radius before ops action.', true, OPS_FRESHNESS_MS),
          rule('ops-status', 'browser', 'browser.dom_snapshot', 'Read provider/workflow/status UI before mutation.', false, OPS_FRESHNESS_MS),
          rule('approval-state', 'approval', 'approvals.request', 'Gate deploy/rollback/restart/scale/secrets/DNS/database mutations.', true, 120_000),
        ],
        actionDiscipline: [
          'Diagnose read-only first.',
          'Execute one approved mutation at a time.',
          'Re-observe status after every mutation before the next one.',
        ],
        fallbackChain: ['repo/service inspection', 'logs/status/workflow read', 'mutation plan', 'approval', 'one mutation', 'health/status verification'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: ['Do not deploy/rollback/restart from ambiguous service context.', 'Do not chain production mutations after a failure.'],
        verificationSignals: ['workflow/deploy result', 'logs/status green', 'health endpoint or preview check', 'rollback/deploy notes'],
      };
    case 'terminal_agent_orchestration':
      return {
        primarySurface: 'terminal',
        observationRules: [
          rule('agent-roster', 'terminal', 'office.list_agents', 'Read active agent/session state before launching or messaging agents.', false, 30_000),
          rule('approval-state', 'approval', 'approvals.request', 'Gate bulk launches, shell command execution, and broad prompt fan-out.', true, 120_000),
        ],
        actionDiscipline: [
          'Launch sessions with stable ids and provider labels.',
          'Stream status/output back to chat and Office.',
          'Persist each session transcript and memory under the user account/circle.',
        ],
        fallbackChain: ['bridge health', 'agent roster', 'approved launch/message', 'poll output', 'persist transcript/memory'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: ['Do not retry terminal launches in a tight loop.', 'Do not merge failed and healthy session state.'],
        verificationSignals: ['session id', 'provider', 'cwd', 'last output', 'status', 'persisted transcript key'],
      };
    case 'human_verification_pause':
      return {
        primarySurface: 'approval',
        observationRules: [
          rule('verification-state', 'browser', 'browser.verification_state', 'Detect CAPTCHA/MFA/bot verification and pause.', true, 30_000),
          rule('verification-screenshot', 'browser', 'browser.screenshot', 'Capture visual blocker when helpful for human handoff.', false, 30_000),
        ],
        actionDiscipline: ['Stop automation and wait for the user to complete the gate.', 'Resume only after re-checking verification state.'],
        fallbackChain: ['verification_state', 'screenshot if helpful', 'human instruction', 'user confirmation', 'verification_state re-check'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: ['Do not click CAPTCHA, MFA, OTP, or not-a-robot controls.', 'Do not attempt to bypass bot checks.'],
        verificationSignals: ['gate cleared', 'normal DOM/page state returns', 'user confirmed completion'],
      };
    case 'file_readonly':
      return {
        primarySurface: 'file',
        observationRules: [
          rule('file-search', 'file', 'desktop.file_search', 'Find requested local files within approved scope.', false, 120_000),
          rule('file-stat', 'file', 'desktop.file_stat', 'Confirm local path existence and metadata without reading file contents.', false, 120_000),
          rule('file-read', 'file', 'desktop.file_read', 'Read requested file content.', false, 120_000),
          rule('file-rename', 'file', 'desktop.file_rename', 'Rename or move a requested local file after write-scoped verification.', true, 120_000),
          rule('file-write-text', 'file', 'desktop.file_write_text', 'Create, overwrite, or append a requested local text file after write-scoped verification.', true, 120_000),
          rule('file-copy', 'file', 'desktop.file_copy', 'Copy a requested local file or folder after write-scoped verification.', true, 120_000),
          rule('file-trash', 'file', 'desktop.file_trash', 'Move a requested local file or folder to Trash after write-scoped verification.', true, 120_000),
          rule('file-mkdir', 'file', 'desktop.file_mkdir', 'Create a requested local folder after write-scoped verification.', true, 120_000),
        ],
        actionDiscipline: ['Keep file tasks read-only unless user explicitly asks for writes.', 'For file changes, search first when path is ambiguous, mutate exactly one chosen path, then report the affected path.', 'Report path and truncation/source limits.'],
        fallbackChain: ['file_search', 'file_stat', 'file_read', 'scoped file write tool for explicit writes', 'clear blocker for permission/path issues'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: ['Do not scan broad home directories without scope.', 'Do not open/write/delete/move files unless requested and approved.'],
        verificationSignals: ['path', 'match count', 'byte/truncation limit', 'last modified when available'],
      };
    case 'hybrid_control_loop':
    default:
      return {
        primarySurface: 'system',
        observationRules: [
          rule('surface-state', 'system', 'integrations.list', 'Choose available browser/desktop/file/app surface before acting.', false, 30_000),
          rule('approval-state', 'approval', 'approvals.request', 'Gate credentials, writes, sends, and destructive actions.', true, 120_000),
        ],
        actionDiscipline: ['Pick one surface at a time.', 'Observe before each mutation.', 'Stop after two failed attempts and report blocker.'],
        fallbackChain: ['capability check', 'surface observation', 'single reversible action', 'verification', 'recovery or stop'],
        approvalGates: strategy.approvalCheckpoints,
        forbiddenFallbacks: ['Do not invent missing tools.', 'Do not claim remote Browserbase can see local desktop state.'],
        verificationSignals: ['selected surface', 'before/after state', 'explicit blocker or completion proof'],
      };
  }
}

export function buildComputerAppGroundingPlan(
  message: string,
  pipelineDecision?: UserTaskPipelineDecision | null,
): ComputerAppGroundingPlan | null {
  const strategy = buildComputerAppTaskStrategy(message, pipelineDecision);
  if (!strategy) return null;
  const exactProgram = compileComputerSequenceProgram(message);
  if (exactProgram?.id === 'photoshop_new_document') {
    const createStep = exactProgram.steps.find((step) => step.tool === 'desktop.photoshop_create_document');
    const widthPx = Number(createStep?.args.widthPx);
    const heightPx = Number(createStep?.args.heightPx);
    const sizeLabel = Number.isFinite(widthPx) && Number.isFinite(heightPx)
      ? `${widthPx}x${heightPx}`
      : 'requested-size';
    const directRequestAuthorized = exactProgram.authorization.mode === 'direct_user_request';
    return {
      strategy,
      primarySurface: 'desktop',
      observationRules: [
        rule(
          'photoshop-document-status',
          'desktop',
          'desktop.photoshop_document_status',
          'Read Photoshop running/scriptable and active-document state before launch/create and again after creation.',
          true,
          LAYOUT_FRESHNESS_MS,
        ),
      ],
      actionDiscipline: [
        'Execute the compiled program exactly: status -> conditional launch -> status -> create_document -> final status.',
        'Treat no active document as the expected from-scratch starting state, not a source-file or inventory blocker.',
        directRequestAuthorized
          ? `Create only the requested ${sizeLabel} unsaved blank document; the current direct user request is the authority for this bounded action.`
          : `Create only the requested ${sizeLabel} blank document after the enclosing Chat plan approval is accepted.`,
        'Do not add file search/stat/open, layer inventory, screenshot, a11y, menu, keyboard, or coordinate actions.',
      ],
      fallbackChain: exactProgram.steps.map((step) => step.tool),
      approvalGates: directRequestAuthorized
        ? []
        : ['one Chat plan-level approval before the oversized blank-document allocation'],
      forbiddenFallbacks: [
        'No source-file/package discovery for a from-scratch blank document.',
        'No layer inventory or destructive-edit preconditions for a new blank document.',
        'No generic UI or coordinate fallback when the dedicated create-document tool fails.',
        directRequestAuthorized
          ? 'Do not extend direct-request authority to saves, exports, overwrites, existing-document edits, deletes, or external actions.'
          : 'Do not dispatch the oversized blank-document allocation before its enclosing Chat plan approval.',
      ],
      verificationSignals: [
        `final desktop.photoshop_document_status reports an active ${sizeLabel} document`,
        'final app-native status includes the created document name and dimensions',
      ],
    };
  }
  return { strategy, ...strategyGrounding(strategy, message) };
}

function toolLooksCoordinateBased(tool: string, description: string): boolean {
  const text = `${tool} ${description}`.toLowerCase();
  return /\b(click_at|mouse_click|mouse_drag|coordinate|coords?|drag)\b/.test(text);
}

function toolLooksApprovalSensitive(tool: string, description: string, strategyId?: ComputerAppStrategyId): boolean {
  const text = `${tool} ${description}`.toLowerCase();
  if (strategyId === 'approval_sensitive_browser' || strategyId === 'ops_console_control') return /\b(submit|send|publish|pay|checkout|book|buy|delete|archive|deploy|rollback|restart|scale|dns|secret|database|crm|invoice|payment)\b/.test(text);
  if (strategyId === 'creative_layout_control') return /\b(indesign_batch_update|indesign_update|indesign_batch_find|photoshop_update|photoshop_place|photoshop_export|find.change|update|change|replace|relink|place|save|export|package|overwrite|delete|layer|mask|selection|generative|content-aware|fill|rasterize|flatten|file_write|file_copy|file_rename|file_trash|script|adapter)\b/.test(text);
  if (strategyId === 'engineering_cad_control') return /\b(save|export|overwrite|replace|delete|macro|script|plugin|manufacturing|permit|client|production|file_write|file_copy|file_rename|file_trash)\b/.test(text);
  if (strategyId === 'universal_app_control') return /\b(agent\.build_app_capability|save|export|overwrite|replace|delete|macro|script|plugin|send|publish|credential|password|adapter|bridge|code|file_write|file_copy|file_rename|file_trash)\b/.test(text);
  return /\b(send|publish|pay|checkout|book|delete|deploy|rollback|restart|scale|credential|password)\b/.test(text);
}

function parsedTimeMs(value: string | number): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function compactIdentityText(value: unknown, max = 240): string | null {
  const compact = String(value ?? '').trim().replace(/\s+/g, ' ');
  return compact ? compact.slice(0, max) : null;
}

function compactIdentityCodePoints(value: unknown, max: number): string | null {
  const compact = String(value ?? '').trim().replace(/\s+/g, ' ');
  return compact ? Array.from(compact).slice(0, max).join('') : null;
}

function compactObservationTarget(target: ComputerAppObservationTarget): ComputerAppObservationTarget {
  const pid = Number(target.pid);
  return {
    appName: compactIdentityCodePoints(target.appName, 160),
    bundleId: compactIdentityText(target.bundleId, 180),
    pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
    windowId: typeof target.windowId === 'number' && Number.isFinite(target.windowId)
      ? target.windowId
      : compactIdentityText(target.windowId, 180),
    documentId: compactIdentityText(target.documentId, 240),
    browserProcessId: compactIdentityText(target.browserProcessId, 180),
    browserSessionId: compactIdentityText(target.browserSessionId, 180),
    browserTabId: compactIdentityText(target.browserTabId, 180),
    browserTargetFingerprint: compactIdentityText(target.browserTargetFingerprint, 220),
    url: compactIdentityText(target.url, 500),
    accessibilityGeneration: typeof target.accessibilityGeneration === 'number'
      && Number.isFinite(target.accessibilityGeneration)
      ? target.accessibilityGeneration
      : compactIdentityText(target.accessibilityGeneration, 180),
    accessibilityTargetFingerprint: compactIdentityText(
      target.accessibilityTargetFingerprint,
      220,
    ),
    screenshotId: compactIdentityText(target.screenshotId, 180),
  };
}

function uniqueBoundedStrings(values: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map((value) => compactIdentityText(value, maxChars))
      .filter((value): value is string => Boolean(value)),
  )).slice(0, maxItems);
}

const INVALID_FINGERPRINT_VALUE = Symbol('invalid-computer-app-fingerprint-value');
const MAX_FINGERPRINT_CANONICAL_CHARS = 256_000;

function canonicalizeFingerprintValue(
  value: unknown,
  seen: Set<object>,
  budget: { nodes: number; chars: number },
  depth = 0,
): unknown | typeof INVALID_FINGERPRINT_VALUE {
  budget.nodes += 1;
  if (budget.nodes > 2_048 || depth > 12) return INVALID_FINGERPRINT_VALUE;
  if (typeof value === 'string') {
    budget.chars += value.length;
    return budget.chars <= MAX_FINGERPRINT_CANONICAL_CHARS
      ? value
      : INVALID_FINGERPRINT_VALUE;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : INVALID_FINGERPRINT_VALUE;
  if (typeof value !== 'object') return INVALID_FINGERPRINT_VALUE;
  if (seen.has(value)) return INVALID_FINGERPRINT_VALUE;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return INVALID_FINGERPRINT_VALUE;
      }
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.some((key) => typeof key === 'symbol')) {
        return INVALID_FINGERPRINT_VALUE;
      }
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (
        !lengthDescriptor
        || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0
        || lengthDescriptor.value > 1_000
        || ownKeys.length !== lengthDescriptor.value + 1
      ) {
        return INVALID_FINGERPRINT_VALUE;
      }
      const out: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          !descriptor
          || !descriptor.enumerable
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) {
          return INVALID_FINGERPRINT_VALUE;
        }
        const canonical = canonicalizeFingerprintValue(
          descriptor.value,
          seen,
          budget,
          depth + 1,
        );
        if (canonical === INVALID_FINGERPRINT_VALUE) {
          return INVALID_FINGERPRINT_VALUE;
        }
        out.push(canonical);
      }
      return out;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return INVALID_FINGERPRINT_VALUE;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === 'symbol')) {
      return INVALID_FINGERPRINT_VALUE;
    }
    const keys = (ownKeys as string[]).sort();
    if (keys.length > 200) return INVALID_FINGERPRINT_VALUE;
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      budget.chars += key.length;
      if (budget.chars > MAX_FINGERPRINT_CANONICAL_CHARS) {
        return INVALID_FINGERPRINT_VALUE;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || !descriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ) {
        return INVALID_FINGERPRINT_VALUE;
      }
      const canonical = canonicalizeFingerprintValue(
        descriptor.value,
        seen,
        budget,
        depth + 1,
      );
      if (canonical === INVALID_FINGERPRINT_VALUE) {
        return INVALID_FINGERPRINT_VALUE;
      }
      out[key] = canonical;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function canonicalFingerprintPayload(normalizedArgs: unknown): {
  canonical: unknown;
  json: string;
} | null {
  try {
    const canonical = canonicalizeFingerprintValue(
      normalizedArgs,
      new Set<object>(),
      { nodes: 0, chars: 0 },
    );
    if (canonical === INVALID_FINGERPRINT_VALUE) return null;
    const json = JSON.stringify(canonical);
    if (
      typeof json !== 'string'
      || json.length > MAX_FINGERPRINT_CANONICAL_CHARS
    ) {
      return null;
    }
    return { canonical, json };
  } catch {
    return null;
  }
}

function freezeCanonicalFingerprintValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = freezeCanonicalFingerprintValue(value[index]);
    }
    return Object.freeze(value);
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    (value as Record<string, unknown>)[key] = freezeCanonicalFingerprintValue(
      (value as Record<string, unknown>)[key],
    );
  }
  return Object.freeze(value);
}

/**
 * Derive a privacy-safe, deterministic fingerprint from the actual normalized
 * handler args. This legacy synchronous checksum remains for non-security
 * display metadata. Mutation authorization must use the async SHA-256 helper
 * below and dispatch recomputes it from sealed handler arguments.
 * Unsupported, cyclic, or pathologically large input returns an empty string
 * so authorization fails closed on `tool_args_fingerprint_missing`.
 */
export function buildComputerAppToolArgsFingerprint(normalizedArgs: unknown): string {
  const payload = canonicalFingerprintPayload(normalizedArgs);
  if (!payload) return '';
  let fnv = 0x811c9dc5;
  let djb2 = 5381;
  for (let index = 0; index < payload.json.length; index += 1) {
    const code = payload.json.charCodeAt(index);
    fnv ^= code;
    fnv = Math.imul(fnv, 0x01000193);
    djb2 = (Math.imul(djb2, 33) ^ code) | 0;
  }
  const hex = (value: number) => (value >>> 0).toString(16).padStart(8, '0');
  return `args-v1:${hex(fnv)}${hex(djb2)}-${payload.json.length}`;
}

/**
 * Cryptographic exact-argument digest for mutation contracts. Web Crypto,
 * TextEncoder, and structured clone are required; missing platform support
 * fails closed with `''`. The structured-clone check rejects otherwise
 * transparent Proxy inputs, which JavaScript reflection cannot distinguish
 * portably from their plain-object targets.
 */
export async function buildComputerAppToolArgsFingerprintAsync(
  normalizedArgs: unknown,
): Promise<string> {
  try {
    const payload = canonicalFingerprintPayload(normalizedArgs);
    if (
      !payload
      || typeof globalThis.crypto?.subtle?.digest !== 'function'
      || typeof TextEncoder !== 'function'
      || typeof globalThis.structuredClone !== 'function'
    ) {
      return '';
    }
    globalThis.structuredClone(normalizedArgs);
    const bytes = new TextEncoder().encode(payload.json);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return hex.length === 64 ? `args-v2:sha256:${hex}` : '';
  } catch {
    return '';
  }
}

export type GenericNativeUiMutationFamily =
  | 'type'
  | 'paste'
  | 'press'
  | 'menu'
  | 'coordinate'
  | 'mouse';

export type GenericNativeUiMutationTool =
  | 'desktop.type_text'
  | 'desktop.paste_text'
  | 'desktop.press_keys'
  | 'desktop.menu_click'
  | 'desktop.click_at'
  | 'desktop.mouse_move'
  | 'desktop.mouse_click'
  | 'desktop.mouse_down'
  | 'desktop.mouse_up'
  | 'desktop.mouse_drag'
  | 'desktop.mouse_scroll';

const GENERIC_NATIVE_UI_MUTATION_FAMILY_BY_TOOL: Readonly<
  Record<GenericNativeUiMutationTool, GenericNativeUiMutationFamily>
> = Object.freeze({
  'desktop.type_text': 'type',
  'desktop.paste_text': 'paste',
  'desktop.press_keys': 'press',
  'desktop.menu_click': 'menu',
  'desktop.click_at': 'coordinate',
  'desktop.mouse_move': 'mouse',
  'desktop.mouse_click': 'mouse',
  'desktop.mouse_down': 'mouse',
  'desktop.mouse_up': 'mouse',
  'desktop.mouse_drag': 'mouse',
  'desktop.mouse_scroll': 'mouse',
});

export function genericNativeUiMutationFamilyForTool(
  tool: unknown,
): GenericNativeUiMutationFamily | null {
  if (
    typeof tool !== 'string'
    || !Object.prototype.hasOwnProperty.call(
      GENERIC_NATIVE_UI_MUTATION_FAMILY_BY_TOOL,
      tool,
    )
  ) {
    return null;
  }
  return GENERIC_NATIVE_UI_MUTATION_FAMILY_BY_TOOL[
    tool as GenericNativeUiMutationTool
  ];
}

export type GenericNativeUiFallbackSignal =
  | {
      kind: 'accessibility_generation';
      generation: number;
    }
  | {
      kind: 'frontmost_menu_bar';
      available: true;
    }
  | {
      kind: 'verified_screen_bounds';
      width: number;
      height: number;
    };

/**
 * Trusted observation adapter input. Every app/window/accessibility value in
 * this shape is transient: the guard projects it to SHA-256 bindings and never
 * returns it to the caller. `fallbackSignal` is required only when the
 * frontmost app has no visible window.
 */
export interface GenericNativeUiFrontmostObservation {
  requestedAppName?: string | null;
  resolvedAppName?: string;
  app?: string;
  pid?: number;
  processIdentityVersion?: number;
  appRunning?: boolean;
  frontmost?: boolean;
  frontmostApp?: string | null;
  windowCount?: number;
  windowTitles?: unknown;
  observedAt?: string | number;
  capturedAt?: string | number;
  fallbackSignal?: GenericNativeUiFallbackSignal | null;
  [key: string]: unknown;
}

export interface GenericNativeUiObservationBridgeResult {
  ok: boolean;
  data?: unknown;
  errorCode?: unknown;
  [key: string]: unknown;
}

export interface GenericNativeUiMutationObservationDeps {
  observeFrontmostApp: (args: {
    appName: string;
    maxDepth: 1;
    maxNodes: 1;
  }) => Promise<unknown>;
  /** Must return buildComputerAppToolArgsFingerprintAsync-compatible SHA-256. */
  digest: (value: unknown) => Promise<string | null>;
  /** Test-only deterministic clock; production callers should omit it. */
  now?: () => string | number;
}

export type GenericNativeUiWindowSignal =
  | 'visible_window'
  | GenericNativeUiFallbackSignal['kind'];

/**
 * Safe approval metadata. It contains controlled enums, timestamps, and
 * cryptographic bindings only — never app names, titles, paths, labels, typed
 * values, key sequences, accessibility text, or raw bridge errors.
 */
export interface GenericNativeUiMutationGuard {
  schemaVersion: 1;
  operation: 'generic_native_ui_mutation';
  tool: GenericNativeUiMutationTool;
  family: GenericNativeUiMutationFamily;
  toolArgsFingerprint: string;
  processIdentitySha256: string;
  surfaceIdentitySha256: string;
  observationBindingSha256: string;
  approvalBindingSha256: string;
  observedAt: string;
  expiresAt: string;
  windowSignal: GenericNativeUiWindowSignal;
}

export type GenericNativeUiMutationGuardErrorCode =
  | 'unsupported_tool'
  | 'invalid_target_identity'
  | 'bridge_offline'
  | 'observation_unavailable'
  | 'observation_invalid'
  | 'observation_stale'
  | 'target_identity_drift'
  | 'target_not_visible'
  | 'binding_unavailable'
  | 'guard_untrusted'
  | 'guard_consumed'
  | 'approval_binding_mismatch';

export interface GenericNativeUiMutationGuardFailure {
  ok: false;
  phase: 'before_approval' | 'handler_entry';
  errorCode: GenericNativeUiMutationGuardErrorCode;
  mutationAttempted: false;
  retryRequiresFreshObservation: true;
  message: string;
}

export type PrepareGenericNativeUiMutationGuardResult =
  | {
      ok: true;
      guard: GenericNativeUiMutationGuard;
    }
  | GenericNativeUiMutationGuardFailure;

export interface GenericNativeUiHandlerEntryBinding {
  schemaVersion: 1;
  operation: 'generic_native_ui_mutation_handler_entry';
  tool: GenericNativeUiMutationTool;
  family: GenericNativeUiMutationFamily;
  approvalBindingSha256: string;
  processIdentitySha256: string;
  surfaceIdentitySha256: string;
  entryObservationBindingSha256: string;
  observedAt: string;
  expiresAt: string;
  windowSignal: GenericNativeUiWindowSignal;
  sameProcess: true;
}

export type RecheckGenericNativeUiMutationGuardResult =
  | {
      ok: true;
      binding: GenericNativeUiHandlerEntryBinding;
      /** Fresh raw-free epoch for the existing mutation authorization layer. */
      epoch: ComputerAppObservationEpoch;
    }
  | GenericNativeUiMutationGuardFailure;

interface NormalizedGenericNativeUiObservation {
  resolvedAppName: string;
  pid: number;
  observedAtMs: number;
  completedAtMs: number;
  windowSignal: GenericNativeUiWindowSignal;
  surfaceFingerprintInput: Record<string, unknown>;
}

interface GenericNativeUiMutationGuardState {
  expectedResolvedAppName: string;
  pid: number;
  tool: GenericNativeUiMutationTool;
  family: GenericNativeUiMutationFamily;
  toolArgsFingerprint: string;
  processIdentitySha256: string;
  surfaceIdentitySha256: string;
  approvalBindingSha256: string;
  windowSignal: GenericNativeUiWindowSignal;
  observedAtMs: number;
  expiresAtMs: number;
  freshnessMs: number;
}

const GENERIC_NATIVE_UI_ARGS_SHA256_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const GENERIC_NATIVE_UI_OBSERVATION_FRESHNESS_MS = 15_000;
const GENERIC_NATIVE_UI_MAX_FRESHNESS_MS = 120_000;
const genericNativeUiMutationGuardStates =
  new WeakMap<object, GenericNativeUiMutationGuardState>();
const consumedGenericNativeUiMutationGuards = new WeakSet<object>();

function genericNativeUiRecord(value: unknown): Record<string, unknown> | null {
  try {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readGenericNativeUiField(
  value: Record<string, unknown>,
  field: string,
): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(value, field)
      ? value[field]
      : undefined;
  } catch {
    return undefined;
  }
}

function exactGenericNativeUiAppName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return (
    name
    && Array.from(name).length <= 160
    && !/[\u0000-\u001f\u007f]/.test(name)
  )
    ? name
    : null;
}

function genericNativeUiClockMs(
  now?: () => string | number,
): number | null {
  try {
    return parsedTimeMs(now ? now() : Date.now());
  } catch {
    return null;
  }
}

function genericNativeUiFailure(
  phase: GenericNativeUiMutationGuardFailure['phase'],
  errorCode: GenericNativeUiMutationGuardErrorCode,
): GenericNativeUiMutationGuardFailure {
  const messageByCode: Record<GenericNativeUiMutationGuardErrorCode, string> = {
    unsupported_tool: 'The native UI action is not covered by the generic mutation guard.',
    invalid_target_identity: 'The native UI action has no exact bounded app or argument identity.',
    bridge_offline: 'The native UI action stopped because the local observation bridge is offline.',
    observation_unavailable: 'The native UI action stopped because a fresh frontmost-app observation was unavailable.',
    observation_invalid: 'The native UI action stopped because the frontmost-app observation was incomplete or internally inconsistent.',
    observation_stale: 'The native UI action stopped because its required observation was stale or had an invalid clock.',
    target_identity_drift: 'The native UI action stopped because the observed app, process, or window identity changed.',
    target_not_visible: 'The native UI action stopped because no visible window or compatible bounded fallback signal was observed.',
    binding_unavailable: 'The native UI action stopped because cryptographic observation binding was unavailable.',
    guard_untrusted: 'The native UI action stopped because its observation guard was not issued by this runtime.',
    guard_consumed: 'The native UI action stopped because its one-shot handler-entry guard was already used.',
    approval_binding_mismatch: 'The native UI action stopped because approval was not bound to this exact observation and argument digest.',
  };
  return Object.freeze({
    ok: false,
    phase,
    errorCode,
    mutationAttempted: false,
    retryRequiresFreshObservation: true,
    message: messageByCode[errorCode],
  });
}

function genericNativeUiBridgeFailureCode(
  value: unknown,
): GenericNativeUiMutationGuardErrorCode {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (
    code === 'offline'
    || code === 'bridge_offline'
    || code === 'connection_refused'
    || code === 'not_paired'
    || code === 'network_error'
  ) {
    return 'bridge_offline';
  }
  if (code === 'stale_bridge' || code === 'stale_observation') {
    return 'observation_stale';
  }
  return 'observation_unavailable';
}

function genericNativeUiFallbackMatchesFamily(
  family: GenericNativeUiMutationFamily,
  kind: GenericNativeUiFallbackSignal['kind'],
): boolean {
  if (kind === 'accessibility_generation') {
    return (
      family === 'type'
      || family === 'paste'
      || family === 'press'
      || family === 'menu'
    );
  }
  if (kind === 'frontmost_menu_bar') {
    return family === 'press' || family === 'menu';
  }
  // Screen bounds prove that coordinates are numerically in range; they do
  // not prove that the intended app has a visible target window. Coordinate
  // and mouse mutation families therefore require visible_window.
  return false;
}

function normalizeGenericNativeUiSurfaceSignal(
  observation: Record<string, unknown>,
  family: GenericNativeUiMutationFamily,
): {
  ok: true;
  kind: GenericNativeUiWindowSignal;
  fingerprintInput: Record<string, unknown>;
} | {
  ok: false;
  errorCode: 'observation_invalid' | 'target_not_visible';
} {
  const rawWindowCount = readGenericNativeUiField(observation, 'windowCount');
  if (
    typeof rawWindowCount !== 'number'
    || !Number.isSafeInteger(rawWindowCount)
    || rawWindowCount < 0
    || rawWindowCount > 10_000
  ) {
    return { ok: false, errorCode: 'observation_invalid' };
  }
  if (rawWindowCount > 0) {
    const rawTitles = readGenericNativeUiField(observation, 'windowTitles');
    const titles: string[] = [];
    if (rawTitles !== undefined) {
      let titleCount: number;
      try {
        if (!Array.isArray(rawTitles)) {
          return { ok: false, errorCode: 'observation_invalid' };
        }
        titleCount = rawTitles.length;
      } catch {
        return { ok: false, errorCode: 'observation_invalid' };
      }
      if (titleCount > 8) {
        return { ok: false, errorCode: 'observation_invalid' };
      }
      for (let index = 0; index < titleCount; index += 1) {
        let rawTitle: unknown;
        try {
          rawTitle = rawTitles[index];
        } catch {
          return { ok: false, errorCode: 'observation_invalid' };
        }
        if (
          typeof rawTitle !== 'string'
          || rawTitle.length > 160
          || /[\u0000-\u001f\u007f]/.test(rawTitle)
        ) {
          return { ok: false, errorCode: 'observation_invalid' };
        }
        titles.push(rawTitle);
      }
    }
    return {
      ok: true,
      kind: 'visible_window',
      fingerprintInput: {
        kind: 'visible_window',
        windowCount: rawWindowCount,
        windowTitles: titles,
      },
    };
  }

  const fallback = genericNativeUiRecord(
    readGenericNativeUiField(observation, 'fallbackSignal'),
  );
  if (!fallback) return { ok: false, errorCode: 'target_not_visible' };
  const kind = readGenericNativeUiField(fallback, 'kind');
  if (
    kind !== 'accessibility_generation'
    && kind !== 'frontmost_menu_bar'
    && kind !== 'verified_screen_bounds'
  ) {
    return { ok: false, errorCode: 'target_not_visible' };
  }
  if (!genericNativeUiFallbackMatchesFamily(family, kind)) {
    return { ok: false, errorCode: 'target_not_visible' };
  }
  if (kind === 'accessibility_generation') {
    const generation = readGenericNativeUiField(fallback, 'generation');
    if (
      typeof generation !== 'number'
      || !Number.isSafeInteger(generation)
      || generation <= 0
      || generation > 1_000_000_000
    ) {
      return { ok: false, errorCode: 'observation_invalid' };
    }
    return {
      ok: true,
      kind,
      fingerprintInput: { kind, generation },
    };
  }
  if (kind === 'frontmost_menu_bar') {
    if (readGenericNativeUiField(fallback, 'available') !== true) {
      return { ok: false, errorCode: 'observation_invalid' };
    }
    return {
      ok: true,
      kind,
      fingerprintInput: { kind, available: true },
    };
  }
  const width = readGenericNativeUiField(fallback, 'width');
  const height = readGenericNativeUiField(fallback, 'height');
  if (
    typeof width !== 'number'
    || typeof height !== 'number'
    || !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 320
    || height < 240
    || width > 32_768
    || height > 32_768
  ) {
    return { ok: false, errorCode: 'observation_invalid' };
  }
  return {
    ok: true,
    kind,
    fingerprintInput: { kind, width, height },
  };
}

async function collectGenericNativeUiObservation(args: {
  expectedResolvedAppName: string;
  family: GenericNativeUiMutationFamily;
  freshnessMs: number;
  deps: GenericNativeUiMutationObservationDeps;
}): Promise<
  | { ok: true; observation: NormalizedGenericNativeUiObservation }
  | { ok: false; errorCode: GenericNativeUiMutationGuardErrorCode }
> {
  const startedAtMs = genericNativeUiClockMs(args.deps.now);
  if (startedAtMs === null) {
    return { ok: false, errorCode: 'observation_stale' };
  }
  let bridgeResult: unknown;
  try {
    bridgeResult = await args.deps.observeFrontmostApp({
      appName: args.expectedResolvedAppName,
      maxDepth: 1,
      maxNodes: 1,
    });
  } catch {
    return { ok: false, errorCode: 'observation_unavailable' };
  }
  const completedAtMs = genericNativeUiClockMs(args.deps.now);
  if (
    completedAtMs === null
    || completedAtMs < startedAtMs
    || completedAtMs - startedAtMs > args.freshnessMs
  ) {
    return { ok: false, errorCode: 'observation_stale' };
  }
  const bridgeRecord = genericNativeUiRecord(bridgeResult);
  if (!bridgeRecord || readGenericNativeUiField(bridgeRecord, 'ok') !== true) {
    return {
      ok: false,
      errorCode: genericNativeUiBridgeFailureCode(
        bridgeRecord
          ? readGenericNativeUiField(bridgeRecord, 'errorCode')
          : undefined,
      ),
    };
  }
  const observation = genericNativeUiRecord(
    readGenericNativeUiField(bridgeRecord, 'data'),
  );
  if (!observation) {
    return { ok: false, errorCode: 'observation_invalid' };
  }
  const resolvedAppName = exactGenericNativeUiAppName(
    readGenericNativeUiField(observation, 'resolvedAppName'),
  );
  const requestedAppName = readGenericNativeUiField(
    observation,
    'requestedAppName',
  );
  const appName = readGenericNativeUiField(observation, 'app');
  const frontmostApp = readGenericNativeUiField(observation, 'frontmostApp');
  if (
    !resolvedAppName
    || resolvedAppName !== args.expectedResolvedAppName
    || (
      requestedAppName !== undefined
      && requestedAppName !== null
      && exactGenericNativeUiAppName(requestedAppName) !== args.expectedResolvedAppName
    )
    || (
      appName !== undefined
      && exactGenericNativeUiAppName(appName) !== resolvedAppName
    )
    || exactGenericNativeUiAppName(frontmostApp) !== resolvedAppName
  ) {
    return { ok: false, errorCode: 'target_identity_drift' };
  }
  const pid = readGenericNativeUiField(observation, 'pid');
  if (
    readGenericNativeUiField(observation, 'processIdentityVersion') !== 1
    || typeof pid !== 'number'
    || !Number.isSafeInteger(pid)
    || pid <= 0
    || readGenericNativeUiField(observation, 'appRunning') !== true
    || readGenericNativeUiField(observation, 'frontmost') !== true
  ) {
    return { ok: false, errorCode: 'observation_invalid' };
  }
  const rawObservedAt = readGenericNativeUiField(observation, 'observedAt')
    ?? readGenericNativeUiField(observation, 'capturedAt');
  let observedAtMs = completedAtMs;
  if (rawObservedAt !== undefined) {
    const parsedObservedAtMs = parsedTimeMs(rawObservedAt as string | number);
    if (
      parsedObservedAtMs === null
      || parsedObservedAtMs < startedAtMs - 1_000
      || parsedObservedAtMs > completedAtMs + 1_000
      || completedAtMs - parsedObservedAtMs > args.freshnessMs
    ) {
      return { ok: false, errorCode: 'observation_stale' };
    }
    observedAtMs = parsedObservedAtMs;
  }
  const surface = normalizeGenericNativeUiSurfaceSignal(
    observation,
    args.family,
  );
  if (!surface.ok) return surface;
  return {
    ok: true,
    observation: {
      resolvedAppName,
      pid,
      observedAtMs,
      completedAtMs,
      windowSignal: surface.kind,
      surfaceFingerprintInput: surface.fingerprintInput,
    },
  };
}

async function digestGenericNativeUiBinding(
  deps: GenericNativeUiMutationObservationDeps,
  value: unknown,
): Promise<string | null> {
  try {
    const digest = await deps.digest(value);
    return (
      typeof digest === 'string'
      && GENERIC_NATIVE_UI_ARGS_SHA256_RE.test(digest)
    )
      ? digest
      : null;
  } catch {
    return null;
  }
}

/**
 * Collect exactly one frontmost-app observation before approval and return only
 * opaque binding metadata. This helper neither requests approval nor accepts a
 * mutation callback.
 */
export async function prepareGenericNativeUiMutationGuard(args: {
  tool: string;
  expectedResolvedAppName: string;
  toolArgsFingerprint: string;
  deps: GenericNativeUiMutationObservationDeps;
  freshnessMs?: number;
}): Promise<PrepareGenericNativeUiMutationGuardResult> {
  const family = genericNativeUiMutationFamilyForTool(args.tool);
  if (!family) return genericNativeUiFailure('before_approval', 'unsupported_tool');
  const expectedResolvedAppName = exactGenericNativeUiAppName(
    args.expectedResolvedAppName,
  );
  if (
    !expectedResolvedAppName
    || !GENERIC_NATIVE_UI_ARGS_SHA256_RE.test(args.toolArgsFingerprint)
    || typeof args.deps?.observeFrontmostApp !== 'function'
    || typeof args.deps?.digest !== 'function'
  ) {
    return genericNativeUiFailure('before_approval', 'invalid_target_identity');
  }
  const freshnessMs = Math.max(
    1_000,
    Math.min(
      GENERIC_NATIVE_UI_MAX_FRESHNESS_MS,
      typeof args.freshnessMs === 'number' && Number.isFinite(args.freshnessMs)
        ? Math.floor(args.freshnessMs)
        : GENERIC_NATIVE_UI_OBSERVATION_FRESHNESS_MS,
    ),
  );
  const collected = await collectGenericNativeUiObservation({
    expectedResolvedAppName,
    family,
    freshnessMs,
    deps: args.deps,
  });
  if (!collected.ok) {
    return genericNativeUiFailure('before_approval', collected.errorCode);
  }
  const { observation } = collected;
  const observedAt = new Date(observation.observedAtMs).toISOString();
  const expiresAtMs = observation.observedAtMs + freshnessMs;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const processIdentitySha256 = await digestGenericNativeUiBinding(args.deps, {
    schemaVersion: 1,
    kind: 'native_ui_process',
    resolvedAppName: observation.resolvedAppName,
    pid: observation.pid,
  });
  const surfaceIdentitySha256 = await digestGenericNativeUiBinding(args.deps, {
    schemaVersion: 1,
    ...observation.surfaceFingerprintInput,
  });
  if (!processIdentitySha256 || !surfaceIdentitySha256) {
    return genericNativeUiFailure('before_approval', 'binding_unavailable');
  }
  const observationBindingSha256 = await digestGenericNativeUiBinding(args.deps, {
    schemaVersion: 1,
    kind: 'native_ui_observation',
    processIdentitySha256,
    surfaceIdentitySha256,
    observedAt,
    expiresAt,
  });
  if (!observationBindingSha256) {
    return genericNativeUiFailure('before_approval', 'binding_unavailable');
  }
  const approvalBindingSha256 = await digestGenericNativeUiBinding(args.deps, {
    schemaVersion: 1,
    kind: 'generic_native_ui_mutation_approval',
    tool: args.tool,
    family,
    toolArgsFingerprint: args.toolArgsFingerprint,
    // A pending manual approval is consumed by a later fresh tool call. Keep
    // its digest stable only while the exact args, process (app + PID), and
    // surface stay unchanged; timestamps remain in the private one-shot guard.
    processIdentitySha256,
    surfaceIdentitySha256,
    windowSignal: observation.windowSignal,
  });
  if (!approvalBindingSha256) {
    return genericNativeUiFailure('before_approval', 'binding_unavailable');
  }
  const bindingCompletedAtMs = genericNativeUiClockMs(args.deps.now);
  if (
    bindingCompletedAtMs === null
    || bindingCompletedAtMs < observation.completedAtMs
    || bindingCompletedAtMs > expiresAtMs
  ) {
    return genericNativeUiFailure('before_approval', 'observation_stale');
  }
  const guard: GenericNativeUiMutationGuard = Object.freeze({
    schemaVersion: 1,
    operation: 'generic_native_ui_mutation',
    tool: args.tool as GenericNativeUiMutationTool,
    family,
    toolArgsFingerprint: args.toolArgsFingerprint,
    processIdentitySha256,
    surfaceIdentitySha256,
    observationBindingSha256,
    approvalBindingSha256,
    observedAt,
    expiresAt,
    windowSignal: observation.windowSignal,
  });
  genericNativeUiMutationGuardStates.set(guard, {
    expectedResolvedAppName,
    pid: observation.pid,
    tool: guard.tool,
    family,
    toolArgsFingerprint: args.toolArgsFingerprint,
    processIdentitySha256,
    surfaceIdentitySha256,
    approvalBindingSha256,
    windowSignal: observation.windowSignal,
    observedAtMs: observation.observedAtMs,
    expiresAtMs,
    freshnessMs,
  });
  return { ok: true, guard };
}

/**
 * One-shot handler-entry observation. The OpenSwan owner must call this after a
 * genuine approval receipt is matched and immediately before the existing
 * durable dispatcher. It performs no mutation and accepts no mutation callback.
 */
export async function recheckGenericNativeUiMutationGuardAtHandlerEntry(args: {
  guard: GenericNativeUiMutationGuard;
  approvalBindingSha256: string;
  deps: GenericNativeUiMutationObservationDeps;
}): Promise<RecheckGenericNativeUiMutationGuardResult> {
  const state = genericNativeUiMutationGuardStates.get(args.guard);
  if (!state) {
    if (consumedGenericNativeUiMutationGuards.has(args.guard)) {
      return genericNativeUiFailure('handler_entry', 'guard_consumed');
    }
    return genericNativeUiFailure('handler_entry', 'guard_untrusted');
  }
  // Consume synchronously before the first await so concurrent callers cannot
  // obtain two handler-entry epochs from one approved observation. Deleting the
  // private state also releases the last retained raw app identity immediately.
  consumedGenericNativeUiMutationGuards.add(args.guard);
  genericNativeUiMutationGuardStates.delete(args.guard);
  if (
    typeof args.deps?.observeFrontmostApp !== 'function'
    || typeof args.deps?.digest !== 'function'
  ) {
    return genericNativeUiFailure('handler_entry', 'observation_unavailable');
  }
  if (
    args.approvalBindingSha256 !== state.approvalBindingSha256
    || args.guard.approvalBindingSha256 !== state.approvalBindingSha256
  ) {
    return genericNativeUiFailure('handler_entry', 'approval_binding_mismatch');
  }
  const recheckStartedAtMs = genericNativeUiClockMs(args.deps.now);
  if (
    recheckStartedAtMs === null
    || recheckStartedAtMs < state.observedAtMs
    || recheckStartedAtMs > state.expiresAtMs - 1_000
  ) {
    return genericNativeUiFailure('handler_entry', 'observation_stale');
  }
  const collected = await collectGenericNativeUiObservation({
    expectedResolvedAppName: state.expectedResolvedAppName,
    family: state.family,
    freshnessMs: state.freshnessMs,
    deps: args.deps,
  });
  if (!collected.ok) {
    return genericNativeUiFailure('handler_entry', collected.errorCode);
  }
  const { observation } = collected;
  if (
    observation.pid !== state.pid
    || observation.windowSignal !== state.windowSignal
    || observation.completedAtMs > state.expiresAtMs - 1_000
  ) {
    return genericNativeUiFailure('handler_entry', 'target_identity_drift');
  }
  const processIdentitySha256 = await digestGenericNativeUiBinding(args.deps, {
    schemaVersion: 1,
    kind: 'native_ui_process',
    resolvedAppName: observation.resolvedAppName,
    pid: observation.pid,
  });
  const surfaceIdentitySha256 = await digestGenericNativeUiBinding(args.deps, {
    schemaVersion: 1,
    ...observation.surfaceFingerprintInput,
  });
  if (!processIdentitySha256 || !surfaceIdentitySha256) {
    return genericNativeUiFailure('handler_entry', 'binding_unavailable');
  }
  if (
    processIdentitySha256 !== state.processIdentitySha256
    || (
      state.windowSignal !== 'accessibility_generation'
      && surfaceIdentitySha256 !== state.surfaceIdentitySha256
    )
  ) {
    return genericNativeUiFailure('handler_entry', 'target_identity_drift');
  }
  const observedAt = new Date(observation.observedAtMs).toISOString();
  const entryExpiresAtMs = Math.min(
    state.expiresAtMs,
    observation.observedAtMs + state.freshnessMs,
  );
  if (entryExpiresAtMs - observation.completedAtMs < 1_000) {
    return genericNativeUiFailure('handler_entry', 'observation_stale');
  }
  const expiresAt = new Date(entryExpiresAtMs).toISOString();
  const entryObservationBindingSha256 = await digestGenericNativeUiBinding(args.deps, {
    schemaVersion: 1,
    kind: 'generic_native_ui_handler_entry',
    approvalBindingSha256: state.approvalBindingSha256,
    processIdentitySha256,
    surfaceIdentitySha256,
    observedAt,
    expiresAt,
  });
  if (!entryObservationBindingSha256) {
    return genericNativeUiFailure('handler_entry', 'binding_unavailable');
  }
  const bindingCompletedAtMs = genericNativeUiClockMs(args.deps.now);
  if (
    bindingCompletedAtMs === null
    || bindingCompletedAtMs < observation.completedAtMs
    || bindingCompletedAtMs > entryExpiresAtMs
  ) {
    return genericNativeUiFailure('handler_entry', 'observation_stale');
  }
  const epoch = createComputerAppObservationEpoch({
    id: entryObservationBindingSha256,
    surface: 'desktop',
    capturedAt: observedAt,
    freshnessMs: entryExpiresAtMs - observation.observedAtMs,
    target: {
      // Opaque SHA-256 replaces the raw app/window identity in every object
      // that can flow into approval, action, receipt, or durable metadata.
      appName: processIdentitySha256,
      pid: observation.pid,
      windowId: surfaceIdentitySha256,
    },
    evidenceIds: [
      state.approvalBindingSha256,
      entryObservationBindingSha256,
    ],
  });
  const binding: GenericNativeUiHandlerEntryBinding = Object.freeze({
    schemaVersion: 1,
    operation: 'generic_native_ui_mutation_handler_entry',
    tool: state.tool,
    family: state.family,
    approvalBindingSha256: state.approvalBindingSha256,
    processIdentitySha256,
    surfaceIdentitySha256,
    entryObservationBindingSha256,
    observedAt,
    expiresAt: epoch.expiresAt,
    windowSignal: observation.windowSignal,
    sameProcess: true,
  });
  return { ok: true, binding, epoch };
}

type GuardedBrowserFillLocator =
  | { name: string; selector?: never }
  | { name?: never; selector: string };

export type GuardedBrowserFillIntent = {
  role: string;
  text: string;
  submit: false;
  exact: boolean;
  timeoutMs: number;
  taskContext?: string;
  credentialSemantics: false;
} & GuardedBrowserFillLocator;

export type GuardedBrowserFillIntentResult =
  | { ok: true; args: GuardedBrowserFillIntent }
  | { ok: false; error: string };

const GUARDED_BROWSER_FILL_INPUT_FIELDS = new Set([
  'role',
  'name',
  'selector',
  'text',
  'submit',
  'exact',
  'timeoutMs',
  'taskContext',
  'credentialSemantics',
]);

function boundedOptionalGuardedFillText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxChars) return undefined;
  return trimmed;
}

function guardedFillTextContainsObviousSecret(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return (
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(text)
    || /\b(?:bearer)\s+[a-z0-9._~+/=-]{12,}\b/i.test(text)
    || /\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/i.test(text)
    || /\bAKIA[0-9A-Z]{16}\b/.test(text)
    || /\bAIza[0-9A-Za-z_-]{30,}\b/.test(text)
    || /\b(?:github_pat_[a-z0-9_]{20,}|gh[pousr]_[a-z0-9]{30,})\b/i.test(text)
    || /\bxox[baprs]-[a-z0-9-]{20,}\b/i.test(text)
    || /\b(?:sk|rk)_(?:live|test)_[a-z0-9]{16,}\b/i.test(text)
    || /\bsk-[a-z0-9_-]{20,}\b/i.test(text)
    || /\b\d{3}-\d{2}-\d{4}\b/.test(text)
    || /\b(?:password|passwd|passcode|credential|api[\s_-]?key|access[\s_-]?token|client[\s_-]?secret|private[\s_-]?key|authenticator|one[\s_-]?time(?:[\s_-]?(?:code|password))?|otp|mfa|2fa|recovery[\s_-]?(?:code|phrase)|seed[\s_-]?phrase|mnemonic|credit[\s_-]?card|card[\s_-]?number|cvv|cvc|security[\s_-]?code|routing[\s_-]?number|bank[\s_-]?account)\b\s*(?:is\b|[:=])\s*["'`]?[\S]{4,}/i.test(text)
  );
}

/**
 * Canonical model-argument boundary for the first sealed browser mutation.
 * It deliberately supports drafting only: no submit, credentials, secret-like
 * fields, or broad role-only targeting. Hidden observation identities are
 * added later by the runtime and are not accepted from the model.
 */
export function normalizeGuardedBrowserFillIntent(
  input: unknown,
): GuardedBrowserFillIntentResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'browser.fill_field requires an object input.' };
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, error: 'browser.fill_field requires a plain JSON object input.' };
  }
  const source = input as Record<string, unknown>;
  if (
    Reflect.ownKeys(source).some(
      (field) => typeof field !== 'string' || !GUARDED_BROWSER_FILL_INPUT_FIELDS.has(field),
    )
  ) {
    return {
      ok: false,
      error: 'browser.fill_field rejected unsupported model fields. Navigation, alternate locators, submit authority, and hidden bridge identity fields are not accepted.',
    };
  }
  if (source.submit !== undefined && source.submit !== false) {
    return {
      ok: false,
      error: 'browser.fill_field is currently a verified draft-only action and will not submit. Fill first, review the result, then use a separately approved submit action.',
    };
  }
  if (typeof source.text !== 'string') {
    return { ok: false, error: 'browser.fill_field requires text.' };
  }
  if (source.text.length > 4_000) {
    return { ok: false, error: 'browser.fill_field text is too long (maximum 4000 characters).' };
  }
  if (guardedFillTextContainsObviousSecret(source.text)) {
    return {
      ok: false,
      error: 'browser.fill_field rejected draft text that appears to contain credential, verification, payment, or other secret material. Use the dedicated protected-data path.',
    };
  }
  for (const [field, maxChars] of [
    ['role', 80],
    ['name', 500],
    ['selector', 1_000],
    ['taskContext', 1_000],
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (typeof value !== 'string' || !value.trim()) {
      return {
        ok: false,
        error: `browser.fill_field ${field} must be a non-empty string when supplied.`,
      };
    }
    if (value.trim().length > maxChars) {
      return {
        ok: false,
        error: `browser.fill_field ${field} is too long (maximum ${maxChars} characters).`,
      };
    }
  }
  if (source.exact !== undefined && typeof source.exact !== 'boolean') {
    return { ok: false, error: 'browser.fill_field exact must be a boolean when supplied.' };
  }
  if (
    source.timeoutMs !== undefined
    && (typeof source.timeoutMs !== 'number' || !Number.isFinite(source.timeoutMs))
  ) {
    return { ok: false, error: 'browser.fill_field timeoutMs must be a finite number when supplied.' };
  }
  if (
    source.credentialSemantics !== undefined
    && typeof source.credentialSemantics !== 'boolean'
  ) {
    return { ok: false, error: 'browser.fill_field credentialSemantics must be a boolean when supplied.' };
  }
  const role = boundedOptionalGuardedFillText(source.role, 80) || 'textbox';
  if (!/^[a-z][a-z0-9_-]*$/i.test(role)) {
    return { ok: false, error: 'browser.fill_field role is invalid.' };
  }
  if (['combobox', 'listbox', 'option'].includes(role.toLowerCase())) {
    return {
      ok: false,
      error: 'browser.fill_field cannot mutate selection controls. Use the sealed browser.select_option lane.',
    };
  }
  const name = boundedOptionalGuardedFillText(source.name, 500);
  const selector = boundedOptionalGuardedFillText(source.selector, 1_000);
  if (Boolean(name) === Boolean(selector)) {
    return {
      ok: false,
      error: 'browser.fill_field requires exactly one accessible name or selector from a fresh DOM snapshot; do not supply both.',
    };
  }
  const taskContext = boundedOptionalGuardedFillText(source.taskContext, 1_000);
  const credentialSignals = [role, name, selector, taskContext]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (
    source.credentialSemantics === true
    || /\b(password|passwd|passcode|credential|secret|api[\s_-]?key|access[\s_-]?token|private[\s_-]?key|authenticator|one[\s_-]?time|otp|mfa|2fa|pin|log[\s_-]?in|sign[\s_-]?in|user[\s_-]?name|email|e-mail|recovery[\s_-]?phrase|seed[\s_-]?phrase|credit[\s_-]?card|card[\s_-]?number|cvv|cvc|security[\s_-]?code|social[\s_-]?security|ssn|routing[\s_-]?number|bank[\s_-]?account)\b/.test(credentialSignals)
    || /type\s*=\s*["']?password\b/.test(credentialSignals)
  ) {
    return {
      ok: false,
      error: 'browser.fill_field cannot fill credentials or verification fields. Use the dedicated vault/origin-gated credential path, or pause for MFA/CAPTCHA.',
    };
  }
  const requestedTimeout = typeof source.timeoutMs === 'number' ? source.timeoutMs : NaN;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(500, Math.min(30_000, Math.floor(requestedTimeout)))
    : 5_000;
  const locator: GuardedBrowserFillLocator = name
    ? { name }
    : { selector: selector as string };
  return {
    ok: true,
    args: {
      role,
      ...locator,
      text: source.text,
      submit: false,
      exact: source.exact === true,
      timeoutMs,
      ...(taskContext ? { taskContext } : {}),
      credentialSemantics: false,
    },
  };
}

export type GuardedBrowserToggleRole = 'checkbox' | 'switch' | 'radio';

export type GuardedBrowserToggleIntent = {
  role: GuardedBrowserToggleRole;
  name?: string;
  selector?: string;
  desiredState: boolean;
  submit: false;
  exact: true;
  timeoutMs: number;
  taskContext?: string;
  credentialSemantics: false;
};

export type GuardedBrowserToggleIntentResult =
  | { ok: true; args: GuardedBrowserToggleIntent }
  | { ok: false; error: string };

const GUARDED_BROWSER_TOGGLE_INPUT_FIELDS = new Set([
  'role',
  'name',
  'selector',
  'desiredState',
  'submit',
  'exact',
  'timeoutMs',
  'taskContext',
  'credentialSemantics',
]);

const GUARDED_BROWSER_TOGGLE_PROTECTED_RE = /\b(?:accept[\s_-]?(?:terms|conditions)|access[\s_-]?token|account|agree|analytics|api[\s_-]?key|approval|approve|authenticator|authorize|auto[\s_-]?renew(?:al)?|backup|bank[\s_-]?account|billing|bluetooth|book|bot[\s_-]?check|buy|camera|cancel[\s_-]?(?:account|subscription)|captcha|card[\s_-]?number|checkout|clipboard|close[\s_-]?(?:account|profile)|cloud[\s_-]?(?:backup|sync)|cloudflare[\s_-]?challenge|consent|contacts?|crash[\s_-]?reports?|credential|credit[\s_-]?card|cvc|cvv|delete|deploy|destroy|diagnostics?|discoverable|download|e-?mail|erase|extension|files?|grant[\s_-]?(?:access|permission)|hcaptcha|human[\s_-]?verification|install|location|log[\s_-]?(?:in|out)|marketing|merge|microphone|mfa|mnemonic|network|newsletter|not[\s_-]?a[\s_-]?robot|notifications?|one[\s_-]?time|order|otp|passcode|passwd|password|pay(?:ment)?|permission|personaliz(?:e|ed|ation)|photos?|pin|plugins?|post|private[\s_-]?key|privacy|profile|public|publish|purchase|re[\s_-]?captcha|recovery[\s_-]?(?:code|phrase)|release|remember[\s_-]?me|remote[\s_-]?(?:access|control|desktop|login)|remove[\s_-]?(?:account|access|content|data|file|history|item|profile|record|user)|renew(?:al)?|reserve|routing[\s_-]?number|screen[\s_-]?recording|secret|security|seed[\s_-]?phrase|send|share|sharing|sign[\s_-]?(?:in|out)|sms|social[\s_-]?security|ssn|submit|subscribe|subscription|sync|telemetry|terms[\s_-]?(?:and|&)[\s_-]?conditions|tracking|transfer|turnstile|two[\s_-]?factor|2fa|uninstall|unsubscribe|update|upload|usage[\s_-]?data|user[\s_-]?name|verify[\s_-]?(?:you(?:'re| are)?|i am)[\s_-]?human|visibility|vpn|wi-?fi|wipe|withdraw)\b/i;
const GUARDED_BROWSER_TOGGLE_SAFE_PREFERENCE_RE = /\b(?:appearance|accessibility|bookmarks?[\s_-]?bar|captions?|color[\s_-]?scheme|compact[\s_-]?(?:layout|mode|spacing|view)|comfortable[\s_-]?(?:layout|mode|spacing|view)|contrast[\s_-]?mode|dark[\s_-]?mode|dense[\s_-]?(?:layout|mode|spacing|view)|dyslexi[ac][\s_-]?font|focus[\s_-]?indicator|font[\s_-]?(?:family|size)|high[\s_-]?contrast|keyboard[\s_-]?navigation|large[\s_-]?text|light[\s_-]?mode|line[\s_-]?numbers?|minimap|open[\s_-]?links?[\s_-]?in[\s_-]?new[\s_-]?tabs?|presentation|reader[\s_-]?mode|reduce[\s_-]?(?:animations?|motion|transparency)|reduced[\s_-]?(?:animations?|motion|transparency)|remove[\s_-]?animations?|screen[\s_-]?reader|sidebar|subtitles?|text[\s_-]?size|theme|tooltips?|visual[\s_-]?(?:appearance|layout|mode|preference|theme)|word[\s_-]?wrap|zoom|confirm[\s_-]?before[\s_-]?closing[\s_-]?tabs?)\b/i;

function guardedBrowserToggleTargetIsProtected(value: string): boolean {
  return GUARDED_BROWSER_TOGGLE_PROTECTED_RE.test(value.slice(0, 4_000));
}

function guardedBrowserToggleTargetIsSafePreference(value: string): boolean {
  const bounded = value.slice(0, 4_000);
  return !guardedBrowserToggleTargetIsProtected(bounded)
    && GUARDED_BROWSER_TOGGLE_SAFE_PREFERENCE_RE.test(bounded);
}

/**
 * Canonical model-argument boundary for the narrow state-setting browser
 * canary. It grants authority only to set one freshly observed checkbox,
 * switch, or radio to an explicit state. Runtime-owned process/context/page,
 * URL, and observed-element identity must be attached after normalization and
 * are deliberately rejected here as extra model authority.
 */
export function normalizeGuardedBrowserToggleIntent(
  input: unknown,
): GuardedBrowserToggleIntentResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'browser.set_toggle requires an object input.' };
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return { ok: false, error: 'browser.set_toggle requires a plain JSON object input.' };
  }
  const source = input as Record<string, unknown>;
  const ownFields = Reflect.ownKeys(source);
  if (
    ownFields.some(
      (field) => typeof field !== 'string' || !GUARDED_BROWSER_TOGGLE_INPUT_FIELDS.has(field),
    )
  ) {
    return {
      ok: false,
      error: 'browser.set_toggle rejected unsupported model fields. Navigation, generic click, and hidden bridge identity fields are not accepted.',
    };
  }
  if (source.submit !== undefined && source.submit !== false) {
    return {
      ok: false,
      error: 'browser.set_toggle cannot submit, navigate, or activate a general click target.',
    };
  }
  if (source.exact !== undefined && source.exact !== true) {
    return {
      ok: false,
      error: 'browser.set_toggle exact must be true when supplied.',
    };
  }
  if (
    source.credentialSemantics !== undefined
    && source.credentialSemantics !== false
  ) {
    return {
      ok: false,
      error: 'browser.set_toggle credentialSemantics must be false when supplied.',
    };
  }
  if (typeof source.desiredState !== 'boolean') {
    return { ok: false, error: 'browser.set_toggle requires boolean desiredState.' };
  }
  if (typeof source.role !== 'string') {
    return {
      ok: false,
      error: 'browser.set_toggle requires role checkbox, switch, or radio.',
    };
  }
  const role = source.role.trim().toLowerCase();
  if (role !== 'checkbox' && role !== 'switch' && role !== 'radio') {
    return {
      ok: false,
      error: 'browser.set_toggle role must be checkbox, switch, or radio.',
    };
  }
  if (role === 'radio' && source.desiredState === false) {
    return {
      ok: false,
      error: 'browser.set_toggle cannot clear a radio directly; observe and select the intended alternative radio instead.',
    };
  }
  for (const [field, maxChars] of [
    ['name', 500],
    ['selector', 1_000],
    ['taskContext', 1_000],
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (typeof value !== 'string' || !value.trim()) {
      return {
        ok: false,
        error: `browser.set_toggle ${field} must be a non-empty string when supplied.`,
      };
    }
    if (value.trim().length > maxChars) {
      return {
        ok: false,
        error: `browser.set_toggle ${field} is too long (maximum ${maxChars} characters).`,
      };
    }
  }
  if (
    source.timeoutMs !== undefined
    && (typeof source.timeoutMs !== 'number' || !Number.isFinite(source.timeoutMs))
  ) {
    return {
      ok: false,
      error: 'browser.set_toggle timeoutMs must be a finite number when supplied.',
    };
  }
  const name = boundedOptionalGuardedFillText(source.name, 500);
  const selector = boundedOptionalGuardedFillText(source.selector, 1_000);
  if (Boolean(name) === Boolean(selector)) {
    return {
      ok: false,
      error: 'browser.set_toggle requires exactly one exact accessible name or selector from a fresh DOM snapshot.',
    };
  }
  const taskContext = boundedOptionalGuardedFillText(source.taskContext, 1_000);
  const protectedTargetSignals = [role, name, selector, taskContext]
    .filter(Boolean)
    .join(' ');
  if (guardedBrowserToggleTargetIsProtected(protectedTargetSignals)) {
    return {
      ok: false,
      error: 'browser.set_toggle rejected an account, authentication, security, privacy, sharing, subscription, notification, network, payment, destructive, publishing, messaging, or otherwise consequential target. Use a dedicated reviewed action.',
    };
  }
  if (!guardedBrowserToggleTargetIsSafePreference(protectedTargetSignals)) {
    return {
      ok: false,
      error: 'browser.set_toggle is limited to clearly local presentation or accessibility preferences. Use a dedicated reviewed action for unknown settings.',
    };
  }
  const requestedTimeout = typeof source.timeoutMs === 'number' ? source.timeoutMs : NaN;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(500, Math.min(30_000, Math.floor(requestedTimeout)))
    : 5_000;
  return {
    ok: true,
    args: {
      role,
      ...(name ? { name } : {}),
      ...(selector ? { selector } : {}),
      desiredState: source.desiredState,
      submit: false,
      exact: true,
      timeoutMs,
      ...(taskContext ? { taskContext } : {}),
      credentialSemantics: false,
    },
  };
}

export type GuardedBrowserSelectMatchBy = 'value' | 'label';

export type GuardedBrowserSelectIntent = {
  role: 'combobox';
  name?: string;
  selector?: string;
  matchBy: GuardedBrowserSelectMatchBy;
  value: string;
  submit: false;
  exact: true;
  timeoutMs: number;
  taskContext?: string;
  credentialSemantics: false;
};

export type GuardedBrowserSelectIntentResult =
  | { ok: true; args: GuardedBrowserSelectIntent }
  | { ok: false; error: string };

const GUARDED_BROWSER_SELECT_INPUT_FIELDS = new Set([
  'role',
  'name',
  'selector',
  'matchBy',
  'value',
  'submit',
  'exact',
  'timeoutMs',
  'taskContext',
  'credentialSemantics',
]);

/**
 * Canonical model boundary for one native single-value HTML select. This
 * deliberately requires explicit exact/non-submit/non-credential semantics
 * and grants no browser identity, navigation, generic click, form, or custom
 * widget authority. Runtime-owned identity and one-shot target capability are
 * attached only after normalization and fresh observation.
 */
export function normalizeGuardedBrowserSelectIntent(
  input: unknown,
): GuardedBrowserSelectIntentResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'browser.select_option requires an object input.' };
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return {
      ok: false,
      error: 'browser.select_option requires a plain JSON object input.',
    };
  }
  const source = input as Record<string, unknown>;
  if (
    Reflect.ownKeys(source).some(
      (field) => typeof field !== 'string' || !GUARDED_BROWSER_SELECT_INPUT_FIELDS.has(field),
    )
  ) {
    return {
      ok: false,
      error: 'browser.select_option rejected unsupported model fields. Navigation, generic click, form submission, and hidden bridge identity fields are not accepted.',
    };
  }
  if (source.role !== undefined && source.role !== 'combobox') {
    return {
      ok: false,
      error: 'browser.select_option role must be exactly combobox.',
    };
  }
  if (source.matchBy !== 'value' && source.matchBy !== 'label') {
    return {
      ok: false,
      error: 'browser.select_option matchBy must explicitly be value or label.',
    };
  }
  if (source.submit !== undefined && source.submit !== false) {
    return {
      ok: false,
      error: 'browser.select_option submit must be false when supplied.',
    };
  }
  if (source.exact !== undefined && source.exact !== true) {
    return {
      ok: false,
      error: 'browser.select_option exact must be true when supplied.',
    };
  }
  if (
    source.credentialSemantics !== undefined
    && source.credentialSemantics !== false
  ) {
    return {
      ok: false,
      error: 'browser.select_option credentialSemantics must be false when supplied.',
    };
  }
  if (
    typeof source.value !== 'string'
    || !source.value
    || source.value !== source.value.trim()
    || source.value.length > 240
  ) {
    return {
      ok: false,
      error: 'browser.select_option value must be a trimmed non-empty string (maximum 240 characters).',
    };
  }
  for (const [field, maxChars] of [
    ['name', 500],
    ['selector', 1_000],
    ['taskContext', 1_000],
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const value = source[field];
    if (
      typeof value !== 'string'
      || !value.trim()
      || value !== value.trim()
      || value.length > maxChars
    ) {
      return {
        ok: false,
        error: `browser.select_option ${field} must be a trimmed non-empty string (maximum ${maxChars} characters).`,
      };
    }
  }
  if (
    source.timeoutMs !== undefined
    && (typeof source.timeoutMs !== 'number' || !Number.isFinite(source.timeoutMs))
  ) {
    return {
      ok: false,
      error: 'browser.select_option timeoutMs must be a finite number when supplied.',
    };
  }
  const name = boundedOptionalGuardedFillText(source.name, 500);
  const selector = boundedOptionalGuardedFillText(source.selector, 1_000);
  if (Boolean(name) === Boolean(selector)) {
    return {
      ok: false,
      error: 'browser.select_option requires exactly one accessible name or selector from a fresh DOM snapshot.',
    };
  }
  const taskContext = boundedOptionalGuardedFillText(source.taskContext, 1_000);
  const semanticSignals = [
    source.role || 'combobox',
    name,
    selector,
    source.value,
    taskContext,
  ]
    .filter(Boolean)
    .join(' ');
  if (guardedBrowserToggleTargetIsProtected(semanticSignals)) {
    return {
      ok: false,
      error: 'browser.select_option rejected an account, authentication, security, privacy, sharing, subscription, notification, network, payment, destructive, publishing, messaging, or otherwise consequential target. Use a dedicated reviewed action.',
    };
  }
  if (!guardedBrowserToggleTargetIsSafePreference(semanticSignals)) {
    return {
      ok: false,
      error: 'browser.select_option is limited to clearly local presentation or accessibility preferences. Unknown settings fail closed.',
    };
  }
  const requestedTimeout = typeof source.timeoutMs === 'number' ? source.timeoutMs : NaN;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(500, Math.min(30_000, Math.floor(requestedTimeout)))
    : 5_000;
  return {
    ok: true,
    args: {
      role: 'combobox',
      ...(name ? { name } : {}),
      ...(selector ? { selector } : {}),
      matchBy: source.matchBy,
      value: source.value,
      submit: false,
      exact: true,
      timeoutMs,
      ...(taskContext ? { taskContext } : {}),
      credentialSemantics: false,
    },
  };
}

function targetHasRequiredIdentity(
  surface: ComputerAppGroundingSurface,
  target: ComputerAppObservationTarget,
): boolean {
  if (surface === 'desktop') {
    const hasApp = Boolean(target.appName || target.bundleId);
    const hasWindowOrAccessibilityIdentity = [
      target.windowId,
      target.accessibilityGeneration,
    ].some((value) => value !== null && value !== undefined && value !== '');
    return hasApp
      && Boolean(target.pid)
      && hasWindowOrAccessibilityIdentity;
  }
  if (surface === 'browser') {
    return Boolean(target.browserSessionId && target.browserTabId && target.url);
  }
  return Boolean(
    target.appName
    || target.bundleId
    || target.documentId
    || target.browserSessionId
    || target.url,
  );
}

const TARGET_MATCH_FIELDS: Array<keyof ComputerAppObservationTarget> = [
  'appName',
  'bundleId',
  'pid',
  'windowId',
  'documentId',
  'browserProcessId',
  'browserSessionId',
  'browserTabId',
  'browserTargetFingerprint',
  'url',
  'accessibilityGeneration',
  'accessibilityTargetFingerprint',
];

const TARGET_STABLE_AFTER_ACTION_FIELDS: Array<keyof ComputerAppObservationTarget> = [
  // Accessibility generation and accessibilityTargetFingerprint are
  // dispatch-entry bindings, not completion invariants: the exact target may
  // disappear or the tree may advance as the intended result of the action.
  'appName',
  'bundleId',
  'pid',
  'windowId',
  'documentId',
  'browserProcessId',
  'browserSessionId',
  'browserTabId',
  'browserTargetFingerprint',
];

function normalizedTargetValue(
  field: keyof ComputerAppObservationTarget,
  value: unknown,
): string {
  const normalized = String(value ?? '').trim();
  // Human-facing app names and macOS bundle ids are compared
  // case-insensitively. URLs, document ids, window/tab ids, and evidence
  // generations remain exact because their path/id components can be
  // case-sensitive.
  return field === 'appName' || field === 'bundleId'
    ? normalized.toLowerCase()
    : normalized;
}

function targetMismatches(
  expected: ComputerAppObservationTarget,
  observed: ComputerAppObservationTarget,
  fields: Array<keyof ComputerAppObservationTarget> = TARGET_MATCH_FIELDS,
): string[] {
  return fields.filter((field) => {
    const expectedValue = expected[field];
    if (expectedValue === null || expectedValue === undefined || expectedValue === '') return false;
    return normalizedTargetValue(field, expectedValue) !== normalizedTargetValue(field, observed[field]);
  });
}

function missingExpectedTargetFields(
  expected: ComputerAppObservationTarget,
  observed: ComputerAppObservationTarget,
  fields: Array<keyof ComputerAppObservationTarget> = TARGET_MATCH_FIELDS,
): Array<keyof ComputerAppObservationTarget> {
  return fields.filter((field) => {
    const observedValue = observed[field];
    if (observedValue === null || observedValue === undefined || observedValue === '') return false;
    const expectedValue = expected[field];
    return expectedValue === null || expectedValue === undefined || expectedValue === '';
  });
}

function mutationContractBinding(action: ComputerAppMutationContract): string {
  return JSON.stringify({
    schemaVersion: action.schemaVersion,
    actionId: compactIdentityText(action.actionId, 180) || '',
    tool: compactIdentityText(action.tool, 180) || '',
    surface: action.surface,
    observationEpochId: compactIdentityText(action.observationEpochId, 180) || '',
    expectedTarget: compactObservationTarget(action.expectedTarget || {}),
    toolArgsFingerprint: compactIdentityText(action.toolArgsFingerprint, 240) || '',
    risk: action.risk,
    approvalRequired: action.approvalRequired === true,
    idempotencyKey: compactIdentityText(action.idempotencyKey, 180) || '',
    verification: {
      kind: action.verification?.kind,
      predicate: compactIdentityText(action.verification?.predicate, 500) || '',
      evidenceTools: uniqueBoundedStrings(action.verification?.evidenceTools, 8, 160),
    },
    outcomeUnknownPolicy: action.outcomeUnknownPolicy,
  });
}

function mutationPolicyBinding(policy?: ComputerAppMutationPolicyVerdict | null): string {
  if (!policy) return '';
  return JSON.stringify({
    schemaVersion: policy.schemaVersion,
    actionId: compactIdentityText(policy.actionId, 180) || '',
    tool: compactIdentityText(policy.tool, 180) || '',
    toolArgsFingerprint: compactIdentityText(policy.toolArgsFingerprint, 240) || '',
    risk: policy.risk,
    approvalRequired: policy.approvalRequired === true,
    approvalState: policy.approvalState,
    approvalId: compactIdentityText(policy.approvalId, 180) || '',
    approvalKey: compactIdentityText(policy.approvalKey, 1_500) || '',
    decidedAt: compactIdentityText(policy.decidedAt, 80) || '',
    source: policy.source,
  });
}

const MUTATION_RISK_RANK: Record<ComputerAppMutationRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

// These registries are deliberately module-private. A model/tool payload can
// reproduce the public JSON shape, but only verdicts and authorizations issued
// by this runtime instance cross the dispatch/finalization trust boundary.
const issuedMutationPolicyVerdicts = new WeakSet<object>();
const issuedObservationEpochs = new WeakSet<object>();
const revokedObservationEpochs = new WeakMap<object, {
  invalidatedAt: string;
  invalidationReason: string;
}>();
const issuedMutationAuthorizations = new WeakSet<object>();
const authorizationObservationEpochs = new WeakMap<object, ComputerAppObservationEpoch>();
const authorizationIdempotencyClaimTokens = new WeakMap<object, object>();
const issuedMutationDispatchReceipts = new WeakSet<object>();
const consumedMutationAuthorizations = new WeakSet<object>();
const claimedMutationIdempotencyKeys = new Map<string, {
  contractBinding: string;
  claimedAtMs: number;
  expiresAtMs: number;
  phase: 'authorized' | 'dispatched';
  claimToken: object;
}>();
const MUTATION_POLICY_FRESHNESS_MS = 15 * 60_000;
const MUTATION_IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
const MUTATION_IDEMPOTENCY_MAX = 4_096;

function canonicalToolMinimumPolicy(tool: string): {
  risk: ComputerAppMutationRisk;
  approvalRequired: boolean;
} {
  const normalized = String(tool || '').toLowerCase().replace(/[._-]+/g, ' ');
  if (/\b(pay|purchase|checkout|delete|trash|erase|wipe|publish|send|submit|credential|login|grant|shell|exec|applescript|install|uninstall)\b/.test(normalized)) {
    return { risk: 'high', approvalRequired: true };
  }
  if (/\b(save|export|upload|overwrite|write|rename|copy|mkdir|relink|paste|type|keypress|press keys|click|drag|drop|select)\b/.test(normalized)) {
    return { risk: 'medium', approvalRequired: true };
  }
  // This function authorizes MUTATIONS only. An unknown mutation is never
  // equivalent to a read: default it to reviewable medium risk. Read-only
  // tools should bypass this contract and use an observation contract.
  return { risk: 'medium', approvalRequired: true };
}

export function buildComputerAppMutationApprovalKey(
  action: ComputerAppMutationContract,
): string {
  // Approval binds the durable user intent, not one short-lived execution
  // attempt. A retry may collect a fresh observation and tool-use id only when
  // the exact normalized args, risk, surface, and stable target remain the
  // same. Volatile screenshot/a11y generations are deliberately excluded.
  const target = compactObservationTarget(action.expectedTarget || {});
  return JSON.stringify({
    version: 2,
    tool: compactIdentityText(action.tool, 180) || '',
    surface: action.surface,
    toolArgsFingerprint: compactIdentityText(action.toolArgsFingerprint, 240) || '',
    risk: action.risk,
    target: {
      appName: target.appName || null,
      bundleId: target.bundleId || null,
      pid: target.pid || null,
      windowId: target.windowId || null,
      documentId: target.documentId || null,
      browserProcessId: target.browserProcessId || null,
      browserSessionId: target.browserSessionId || null,
      browserTabId: target.browserTabId || null,
      browserTargetFingerprint: target.browserTargetFingerprint || null,
      accessibilityTargetFingerprint: target.accessibilityTargetFingerprint || null,
      url: target.url || null,
    },
  });
}

/**
 * Resolve policy inside the trusted runtime boundary. The returned object is
 * identity-sealed in memory; callers must pass this exact object to
 * authorizeComputerAppMutation rather than accepting a model-authored clone.
 *
 * `requestedRisk` lets a tool adapter raise the canonical minimum for
 * context-sensitive actions. It can never lower the built-in tool minimum.
 */
export async function resolveComputerAppMutationPolicy(
  args: ResolveComputerAppMutationPolicyInput,
): Promise<ComputerAppMutationPolicyVerdict> {
  const { action } = args;
  const minimum = canonicalToolMinimumPolicy(action.tool);
  const requestedRisk = Object.prototype.hasOwnProperty.call(MUTATION_RISK_RANK, action.risk)
    ? action.risk
    : minimum.risk;
  const risk = MUTATION_RISK_RANK[requestedRisk] >= MUTATION_RISK_RANK[minimum.risk]
    ? requestedRisk
    : minimum.risk;
  const approvalRequired = Boolean(
    minimum.approvalRequired
    || action.approvalRequired
    || risk === 'high'
    || risk === 'critical',
  );
  const approvalKey = buildComputerAppMutationApprovalKey(action);
  let approvalState: ComputerAppMutationApprovalState = approvalRequired ? 'pending' : 'not_required';
  let approvalId: string | null = null;
  let source: ComputerAppMutationPolicyVerdict['source'] = 'canonical_tool_policy';
  if (approvalRequired && args.approvalGate) {
    try {
      const decision = await args.approvalGate({
        actionId: action.actionId,
        tool: action.tool,
        toolArgsFingerprint: action.toolArgsFingerprint,
        approvalKey,
        risk,
        contractBinding: mutationContractBinding(action),
      });
      if (decision.approvalKey === approvalKey) {
        approvalState = decision.decision === 'approved' || decision.decision === 'auto_approved'
          ? 'approved'
          : decision.decision;
        approvalId = compactIdentityText(decision.approvalId, 180) || null;
        source = decision.decision === 'auto_approved'
          ? 'user_grant_policy'
          : 'canonical_tool_policy';
      }
    } catch {
      // Approval lookup failures fail closed as pending. The caller can
      // surface recovery without granting the mutation.
    }
  }
  const decidedAtMs = parsedTimeMs(args.decidedAt ?? Date.now()) ?? Date.now();
  const verdict: ComputerAppMutationPolicyVerdict = Object.freeze({
    schemaVersion: 1,
    actionId: compactIdentityText(action.actionId, 180) || '',
    tool: compactIdentityText(action.tool, 180) || '',
    toolArgsFingerprint: compactIdentityText(action.toolArgsFingerprint, 240) || '',
    risk,
    approvalRequired,
    approvalState,
    approvalId,
    approvalKey,
    decidedAt: new Date(decidedAtMs).toISOString(),
    source,
  });
  issuedMutationPolicyVerdicts.add(verdict);
  return verdict;
}

/**
 * Build the immutable observation token a mutation must cite. Callers should
 * create a new epoch after every focus/navigation/modal change or mutation.
 */
function freezeComputerAppObservationEpoch(
  epoch: ComputerAppObservationEpoch,
): ComputerAppObservationEpoch {
  return Object.freeze({
    ...epoch,
    target: Object.freeze({ ...epoch.target }),
    evidenceIds: Object.freeze([...epoch.evidenceIds]) as unknown as string[],
    blockerCodes: Object.freeze([...epoch.blockerCodes]) as unknown as string[],
  });
}

export function createComputerAppObservationEpoch(args: {
  id: string;
  surface: ComputerAppGroundingSurface;
  target: ComputerAppObservationTarget;
  capturedAt?: string | number;
  freshnessMs?: number;
  evidenceIds?: string[];
  blockerCodes?: string[];
}): ComputerAppObservationEpoch {
  const capturedAtMs = parsedTimeMs(args.capturedAt ?? Date.now()) ?? Date.now();
  const freshnessMs = Math.max(1_000, Math.min(120_000, Math.floor(args.freshnessMs ?? 15_000)));
  const epoch = freezeComputerAppObservationEpoch({
    schemaVersion: 1,
    // Keep invalid input visibly invalid. A shared fallback id could let two
    // malformed observations accidentally authorize each other's action.
    id: compactIdentityText(args.id, 180) || '',
    surface: args.surface,
    capturedAt: new Date(capturedAtMs).toISOString(),
    expiresAt: new Date(capturedAtMs + freshnessMs).toISOString(),
    target: compactObservationTarget(args.target || {}),
    evidenceIds: uniqueBoundedStrings(args.evidenceIds, 16, 180),
    blockerCodes: uniqueBoundedStrings(args.blockerCodes, 12, 100),
    invalidatedAt: null,
    invalidationReason: null,
  });
  issuedObservationEpochs.add(epoch);
  return epoch;
}

/**
 * Advance-only invalidation. Once stale, an epoch can never become valid
 * again; recovery must collect a new observation with a new id.
 */
export function invalidateComputerAppObservationEpoch(
  epoch: ComputerAppObservationEpoch,
  reason: string,
  invalidatedAt: string | number = Date.now(),
): ComputerAppObservationEpoch {
  const existingRevocation = revokedObservationEpochs.get(epoch);
  if (epoch.invalidatedAt && !existingRevocation) {
    revokedObservationEpochs.set(epoch, {
      invalidatedAt: epoch.invalidatedAt,
      invalidationReason: epoch.invalidationReason || 'surface changed',
    });
    return epoch;
  }
  const invalidatedAtMs = existingRevocation
    ? parsedTimeMs(existingRevocation.invalidatedAt) ?? Date.now()
    : parsedTimeMs(invalidatedAt) ?? Date.now();
  const revocation = existingRevocation || {
    invalidatedAt: new Date(invalidatedAtMs).toISOString(),
    invalidationReason: compactIdentityText(reason, 300) || 'surface changed',
  };
  revokedObservationEpochs.set(epoch, revocation);
  const invalidatedEpoch = freezeComputerAppObservationEpoch({
    ...epoch,
    invalidatedAt: revocation.invalidatedAt,
    invalidationReason: revocation.invalidationReason,
    expiresAt: new Date(Math.min(
      parsedTimeMs(epoch.expiresAt) ?? invalidatedAtMs,
      invalidatedAtMs,
    )).toISOString(),
  });
  if (issuedObservationEpochs.has(epoch)) {
    issuedObservationEpochs.add(invalidatedEpoch);
  }
  revokedObservationEpochs.set(invalidatedEpoch, revocation);
  return invalidatedEpoch;
}

/**
 * Hard dispatch verdict for a proposed mutation. This is deliberately
 * independent of model text: any missing/stale identity, approval,
 * idempotency, or verification field blocks the tool before execution.
 */
export function authorizeComputerAppMutation(args: {
  action: ComputerAppMutationContract;
  policy?: ComputerAppMutationPolicyVerdict | null;
  epoch?: ComputerAppObservationEpoch | null;
  now?: string | number;
}): ComputerAppMutationAuthorization {
  const { action, epoch, policy } = args;
  const checkedAtMs = parsedTimeMs(args.now ?? Date.now()) ?? Date.now();
  const checkedAt = new Date(checkedAtMs).toISOString();
  const blockers: ComputerAppMutationBlocker[] = [];
  const block = (
    code: ComputerAppMutationBlockCode,
    detail: string,
    recovery: string,
  ) => blockers.push({ code, detail, recovery });

  if (action.schemaVersion !== 1 || (epoch && epoch.schemaVersion !== 1)) {
    block(
      'contract_version_unsupported',
      'The action or observation uses an unsupported contract version.',
      'Rebuild the action and observation with the current runtime contract.',
    );
  }
  if (!policy) {
    block(
      'policy_verdict_missing',
      'The mutation has no independent runtime policy verdict.',
      'Resolve the exact tool call through canonical tool risk and approval policy.',
    );
  } else if (!issuedMutationPolicyVerdicts.has(policy)) {
    block(
      'policy_mismatch',
      'The mutation policy verdict was not issued by this runtime.',
      'Resolve policy in the trusted runtime and pass the exact sealed verdict object.',
    );
  } else {
    if (policy.schemaVersion !== 1 || !(['canonical_tool_policy', 'user_grant_policy'] as string[]).includes(policy.source)) {
      block(
        'contract_version_unsupported',
        'The mutation policy verdict is unsupported.',
        'Re-evaluate the exact call through the current canonical policy.',
      );
    }
    const policyDecidedAtMs = parsedTimeMs(policy.decidedAt);
    if (
      policyDecidedAtMs === null
      || policyDecidedAtMs > checkedAtMs + 1_000
      || checkedAtMs - policyDecidedAtMs > MUTATION_POLICY_FRESHNESS_MS
    ) {
      block(
        'policy_mismatch',
        'The mutation policy verdict has an invalid, future, or expired timestamp.',
        'Resolve approval policy again from the live runtime immediately before dispatch.',
      );
    }
    if (
      policy.actionId !== action.actionId
      || policy.tool !== action.tool
      || policy.toolArgsFingerprint !== action.toolArgsFingerprint
    ) {
      block(
        'policy_mismatch',
        'The proposed call identity does not match the runtime-owned policy verdict.',
        'Resolve the current exact action through runtime policy again.',
      );
    }
    if (policy.approvalKey !== buildComputerAppMutationApprovalKey(action)) {
      block(
        'policy_mismatch',
        'The policy approval key is not bound to this exact mutation contract.',
        'Re-run the exact-call approval lookup for the current contract.',
      );
    }
  }
  if (!compactIdentityText(action.actionId, 180) || !compactIdentityText(action.tool, 180)) {
    block(
      'action_identity_missing',
      'The mutation is missing a stable action id or tool name.',
      'Assign a run-scoped action id and exact canonical tool before dispatch.',
    );
  }
  if (!(['low', 'medium', 'high', 'critical'] as string[]).includes(action.risk)) {
    block(
      'contract_value_invalid',
      'The mutation risk is not a supported value.',
      'Reclassify the action with the canonical risk policy before dispatch.',
    );
  }
  if (!(['app_state', 'accessibility', 'browser_dom', 'artifact', 'visual'] as string[]).includes(action.verification?.kind)) {
    block(
      'contract_value_invalid',
      'The verification evidence kind is not supported.',
      'Use a canonical after-state evidence kind before dispatch.',
    );
  }

  if (!epoch) {
    block(
      'missing_epoch',
      `${action.tool} has no fresh observation epoch.`,
      'Observe the exact app/window or browser tab before dispatch.',
    );
  } else {
    if (!issuedObservationEpochs.has(epoch)) {
      block(
        'epoch_untrusted',
        'The observation epoch was not issued by this runtime.',
        'Collect a fresh observation through the trusted runtime and pass the exact sealed epoch object.',
      );
    }
    if (!compactIdentityText(epoch.id, 180)) {
      block(
        'epoch_identity_missing',
        'The observation epoch has no stable identity.',
        'Collect a new observation with a run-scoped unique epoch id.',
      );
    }
    if (action.observationEpochId !== epoch.id) {
      block(
        'epoch_mismatch',
        `Action cites ${action.observationEpochId || '(none)'} but the live epoch is ${epoch.id}.`,
        'Re-plan the action against the newest observation epoch.',
      );
    }
    const revocation = revokedObservationEpochs.get(epoch);
    if (epoch.invalidatedAt || revocation) {
      block(
        'epoch_invalidated',
        `Observation ${epoch.id} was invalidated: ${revocation?.invalidationReason || epoch.invalidationReason || 'surface changed'}.`,
        'Collect a new observation; never revive an invalidated epoch.',
      );
    }
    const expiresAtMs = parsedTimeMs(epoch.expiresAt);
    const capturedAtMs = parsedTimeMs(epoch.capturedAt);
    if (
      capturedAtMs === null
      || capturedAtMs > checkedAtMs + 1_000
      || expiresAtMs === null
      || expiresAtMs <= capturedAtMs
      || expiresAtMs - capturedAtMs > 120_000
    ) {
      block(
        'epoch_clock_invalid',
        `Observation ${epoch.id || '(missing id)'} has an invalid or future-dated freshness window.`,
        'Collect a new observation from the runtime clock immediately before the mutation.',
      );
    }
    if (expiresAtMs === null || checkedAtMs > expiresAtMs) {
      block(
        'epoch_stale',
        `Observation ${epoch.id} is outside its freshness window.`,
        'Re-observe immediately before the mutation.',
      );
    }
    if (action.surface !== epoch.surface) {
      block(
        'surface_mismatch',
        `Action surface ${action.surface} does not match observed surface ${epoch.surface}.`,
        'Use the observed surface or collect an epoch for the intended surface.',
      );
    }
    const expectedTarget = compactObservationTarget(action.expectedTarget || {});
    const observedTarget = compactObservationTarget(epoch.target || {});
    if (
      !targetHasRequiredIdentity(action.surface, expectedTarget)
      || !targetHasRequiredIdentity(epoch.surface, observedTarget)
    ) {
      block(
        'target_identity_missing',
        'The action or observation lacks exact app/process plus window-or-accessibility identity.',
        'Capture app plus PID and either window identity or accessibility generation, or browser session plus tab/URL identity.',
      );
    }
    const mismatches = targetMismatches(expectedTarget, observedTarget);
    const missingExpected = missingExpectedTargetFields(expectedTarget, observedTarget);
    if (missingExpected.length > 0) {
      block(
        'target_identity_missing',
        `The action omitted observed target identity fields: ${missingExpected.join(', ')}.`,
        'Copy the complete normalized live target from the observation epoch into the action contract.',
      );
    }
    if (mismatches.length > 0) {
      block(
        'target_mismatch',
        `Observed target changed in: ${mismatches.join(', ')}.`,
        'Stop, focus the intended target, and create a new observation epoch.',
      );
    }
    if (epoch.blockerCodes.length > 0) {
      block(
        'observation_blocker',
        `Observation reports blockers: ${epoch.blockerCodes.join(', ')}.`,
        'Resolve the blocker or pause for the user before mutating.',
      );
    }
  }

  const minimumPolicy = canonicalToolMinimumPolicy(action.tool);
  if (
    policy
    && MUTATION_RISK_RANK[policy.risk] < MUTATION_RISK_RANK[minimumPolicy.risk]
  ) {
    block(
      'policy_mismatch',
      `${action.tool} policy is below its canonical ${minimumPolicy.risk} minimum.`,
      'Re-resolve the exact call through the canonical runtime policy.',
    );
  }
  const effectiveApprovalRequired = Boolean(
    minimumPolicy.approvalRequired
    || policy?.approvalRequired
    || policy?.risk === 'high'
    || policy?.risk === 'critical',
  );
  const approvalState = policy?.approvalState;
  if (approvalState === 'rejected') {
    block(
      'approval_rejected',
      'The user rejected this action.',
      'Do not retry it; choose a non-mutating alternative or stop.',
    );
  } else if (effectiveApprovalRequired && approvalState !== 'approved') {
    block(
      'approval_required',
      `Approval is ${approvalState || 'missing'} for this ${policy?.risk || action.risk}-risk action.`,
      'Pause the same run and request explicit approval for the exact action.',
    );
  } else if (effectiveApprovalRequired && !compactIdentityText(policy?.approvalId, 180)) {
    block(
      'approval_receipt_missing',
      'The approved mutation has no exact approval receipt id.',
      'Attach the approved exact-call record before dispatch.',
    );
  }

  if ((compactIdentityText(action.idempotencyKey, 180) || '').length < 8) {
    block(
      'idempotency_key_missing',
      'Mutation has no stable idempotency key.',
      'Bind the action to a run-scoped idempotency key before dispatch.',
    );
  }
  if ((compactIdentityText(action.toolArgsFingerprint, 240) || '').length < 8) {
    block(
      'tool_args_fingerprint_missing',
      'Mutation has no stable fingerprint for the exact normalized tool arguments.',
      'Digest the exact dispatch arguments and bind that fingerprint into the action and approval.',
    );
  }

  const predicate = compactIdentityText(action.verification?.predicate, 500);
  const evidenceTools = uniqueBoundedStrings(action.verification?.evidenceTools, 8, 160);
  if (!predicate || evidenceTools.length === 0) {
    block(
      'verification_missing',
      'Mutation has no machine-checkable verification predicate and evidence tool.',
      'Define the expected state transition and how a fresh observation will prove it.',
    );
  }

  if (action.outcomeUnknownPolicy !== 'verify_before_retry' && action.outcomeUnknownPolicy !== 'never_retry') {
    block(
      'unsafe_replay_policy',
      'Mutation does not define a safe outcome-unknown policy.',
      'Use verify_before_retry or never_retry; never blindly replay an uncertain mutation.',
    );
  }

  const epochExpiresAtMs = epoch ? parsedTimeMs(epoch.expiresAt) : null;
  const policyDecidedAtMs = policy ? parsedTimeMs(policy.decidedAt) : null;
  const authorizationExpiresAtMs = Math.min(
    epochExpiresAtMs ?? checkedAtMs,
    policyDecidedAtMs === null ? checkedAtMs : policyDecidedAtMs + MUTATION_POLICY_FRESHNESS_MS,
  );
  const authorizationClaimToken = Object.freeze({});

  // Reserve the exact mutation once authorization has passed every other
  // invariant. This process-local claim prevents two dispatch authorizations
  // for the same run-scoped idempotency key. Durable cross-process dedupe is a
  // later dispatcher/storage integration concern.
  if (blockers.length === 0) {
    for (const [key, claim] of claimedMutationIdempotencyKeys) {
      if (claim.expiresAtMs <= checkedAtMs) claimedMutationIdempotencyKeys.delete(key);
    }
    const key = compactIdentityText(action.idempotencyKey, 180) || '';
    const binding = mutationContractBinding(action);
    const existing = claimedMutationIdempotencyKeys.get(key);
    if (existing) {
      block(
        'idempotency_replay',
        existing.contractBinding === binding
          ? 'This exact mutation idempotency key was already authorized.'
          : 'This idempotency key was already claimed by a different mutation contract.',
        'Verify the first action outcome. Never mint a new key merely to replay an uncertain side effect.',
      );
    } else if (claimedMutationIdempotencyKeys.size >= MUTATION_IDEMPOTENCY_MAX) {
      block(
        'idempotency_capacity',
        'The process-local mutation idempotency registry is at capacity.',
        'Pause new mutations until an existing claim expires or durable idempotency storage is available.',
      );
    } else {
      claimedMutationIdempotencyKeys.set(key, {
        contractBinding: binding,
        claimedAtMs: checkedAtMs,
        // Before handler entry this is a short reservation only. If the
        // authorization expires without dispatch, the same stable key may be
        // re-authorized against a fresh observation. Handler entry promotes
        // it to the full outcome-unknown TTL below.
        expiresAtMs: authorizationExpiresAtMs,
        phase: 'authorized',
        claimToken: authorizationClaimToken,
      });
    }
  }

  const authorization: ComputerAppMutationAuthorization = Object.freeze({
    allowed: blockers.length === 0,
    checkedAt,
    expiresAt: new Date(authorizationExpiresAtMs).toISOString(),
    epochId: epoch?.id || null,
    actionId: action.actionId,
    contractBinding: mutationContractBinding(action),
    policyBinding: mutationPolicyBinding(policy),
    blockers,
    summary: blockers.length === 0
      ? `${action.tool} is authorized against fresh observation ${epoch?.id}.`
      : `${action.tool} is blocked by ${blockers.length} dispatch invariant${blockers.length === 1 ? '' : 's'}.`,
  });
  issuedMutationAuthorizations.add(authorization);
  if (epoch && issuedObservationEpochs.has(epoch)) {
    authorizationObservationEpochs.set(authorization, epoch);
  }
  if (authorization.allowed) {
    authorizationIdempotencyClaimTokens.set(authorization, authorizationClaimToken);
  }
  return authorization;
}

/**
 * Enter the actual tool handler and mint the dispatch receipt at that exact
 * boundary. Finalization accepts only receipts issued by this wrapper, so an
 * observation captured after preflight authorization but before handler entry
 * cannot prove the action.
 */
export async function dispatchAuthorizedComputerAppMutation<T, TArgs>(args: {
  action: ComputerAppMutationContract;
  authorization: ComputerAppMutationAuthorization;
  normalizedArgs: TArgs;
  handler: (
    sealedArgs: ComputerAppSealedMutationArgs<TArgs>,
  ) => T | Promise<T>;
  /**
   * Transient final-entry fence (for example Chat STOP). It is evaluated only
   * after all asynchronous argument binding and immediately before consuming
   * the authorization/entering the handler. False leaves the app untouched.
   */
  shouldEnterHandler?: () => boolean;
  /** Test-only deterministic clock; production callers should omit it. */
  now?: string | number;
}): Promise<ComputerAppMutationDispatchResult<T>> {
  const { action, authorization } = args;
  const boundEpoch = authorizationObservationEpochs.get(authorization);
  const authorizationClaimToken = authorizationIdempotencyClaimTokens.get(authorization);
  if (
    !issuedMutationAuthorizations.has(authorization)
    || !authorization.allowed
    || authorization.blockers.length > 0
    || authorization.actionId !== action.actionId
    || authorization.epochId !== action.observationEpochId
    || authorization.contractBinding !== mutationContractBinding(action)
    || !authorization.policyBinding
    || consumedMutationAuthorizations.has(authorization)
    || !boundEpoch
    || !issuedObservationEpochs.has(boundEpoch)
    || !authorizationClaimToken
  ) {
    throw new Error('Computer app mutation dispatch refused: authorization is invalid, consumed, or does not match the exact action.');
  }
  const dispatchedAtMs = parsedTimeMs(args.now ?? Date.now());
  const authorizedAtMs = parsedTimeMs(authorization.checkedAt);
  const authorizationExpiresAtMs = parsedTimeMs(authorization.expiresAt);
  if (
    dispatchedAtMs === null
    || authorizedAtMs === null
    || authorizationExpiresAtMs === null
    || dispatchedAtMs < authorizedAtMs
  ) {
    throw new Error('Computer app mutation dispatch refused: dispatch clock predates authorization.');
  }
  const key = compactIdentityText(action.idempotencyKey, 180) || '';
  const claim = claimedMutationIdempotencyKeys.get(key);
  const releaseUndispatchedClaim = () => {
    if (
      claim?.phase === 'authorized'
      && claim.contractBinding === authorization.contractBinding
      && claim.claimToken === authorizationClaimToken
    ) {
      claimedMutationIdempotencyKeys.delete(key);
    }
  };
  if (dispatchedAtMs > authorizationExpiresAtMs) {
    releaseUndispatchedClaim();
    throw new Error('Computer app mutation dispatch refused: authorization expired before handler entry.');
  }
  if (revokedObservationEpochs.has(boundEpoch) || boundEpoch.invalidatedAt) {
    releaseUndispatchedClaim();
    throw new Error('Computer app mutation dispatch refused: observation was invalidated before handler entry.');
  }
  if (
    !claim
    || claim.phase !== 'authorized'
    || claim.contractBinding !== authorization.contractBinding
    || claim.claimToken !== authorizationClaimToken
    || claim.expiresAtMs < dispatchedAtMs
  ) {
    throw new Error('Computer app mutation dispatch refused: idempotency reservation is missing, expired, or already dispatched.');
  }
  const argsPayload = canonicalFingerprintPayload(args.normalizedArgs);
  if (!argsPayload) {
    releaseUndispatchedClaim();
    throw new Error('Computer app mutation dispatch refused: normalized handler arguments are unsupported or exceed the bounded contract.');
  }
  const sealedArgs = freezeCanonicalFingerprintValue(argsPayload.canonical);
  const dispatchArgsFingerprint = await buildComputerAppToolArgsFingerprintAsync(sealedArgs);
  const handlerEntryMs = args.now === undefined ? Date.now() : dispatchedAtMs;
  if (!dispatchArgsFingerprint || dispatchArgsFingerprint !== action.toolArgsFingerprint) {
    releaseUndispatchedClaim();
    throw new Error('Computer app mutation dispatch refused: normalized handler arguments do not match the authorized SHA-256 fingerprint.');
  }
  if (handlerEntryMs > authorizationExpiresAtMs) {
    releaseUndispatchedClaim();
    throw new Error('Computer app mutation dispatch refused: authorization expired while binding handler arguments.');
  }
  if (revokedObservationEpochs.has(boundEpoch) || boundEpoch.invalidatedAt) {
    releaseUndispatchedClaim();
    throw new Error('Computer app mutation dispatch refused: observation was invalidated while binding handler arguments.');
  }
  const liveClaim = claimedMutationIdempotencyKeys.get(key);
  if (
    consumedMutationAuthorizations.has(authorization)
    || !liveClaim
    || liveClaim.phase !== 'authorized'
    || liveClaim.contractBinding !== authorization.contractBinding
    || liveClaim.claimToken !== authorizationClaimToken
    || liveClaim.expiresAtMs < handlerEntryMs
  ) {
    throw new Error('Computer app mutation dispatch refused: authorization or idempotency reservation changed while binding handler arguments.');
  }
  if (args.shouldEnterHandler && args.shouldEnterHandler() !== true) {
    releaseUndispatchedClaim();
    throw new Error('Computer app mutation dispatch refused: transient handler-entry authority was revoked before dispatch.');
  }
  // Consume synchronously before invoking/awaiting the handler so concurrent
  // callers cannot reuse one allowed object to duplicate a side effect.
  consumedMutationAuthorizations.add(authorization);
  claimedMutationIdempotencyKeys.set(key, {
    ...liveClaim,
    phase: 'dispatched',
    expiresAtMs: handlerEntryMs + MUTATION_IDEMPOTENCY_TTL_MS,
  });
  // One live observation can authorize several planned sibling actions, but
  // only the first dispatch may consume it. Revoke before handler entry so a
  // re-entrant or concurrent sibling cannot act on pre-mutation UI state.
  invalidateComputerAppObservationEpoch(
    boundEpoch,
    'mutation dispatched; collect a fresh observation before another action',
    handlerEntryMs,
  );
  const dispatchReceipt: ComputerAppMutationDispatchReceipt = Object.freeze({
    schemaVersion: 1,
    actionId: action.actionId,
    tool: action.tool,
    epochId: action.observationEpochId,
    contractBinding: authorization.contractBinding,
    policyBinding: authorization.policyBinding,
    authorizedAt: authorization.checkedAt,
    dispatchedAt: new Date(handlerEntryMs).toISOString(),
  });
  issuedMutationDispatchReceipts.add(dispatchReceipt);
  try {
    return {
      dispatchReceipt,
      ok: true,
      value: await args.handler(
        sealedArgs as ComputerAppSealedMutationArgs<TArgs>,
      ),
    };
  } catch (error) {
    // Keep the receipt on outcome-unknown failures so recovery can observe and
    // verify before deciding whether any retry is safe.
    return {
      dispatchReceipt,
      ok: false,
      error,
    };
  }
}

/**
 * Finalization verdict after a mutation. Completion is possible only when a
 * distinct, newer observation of the same exact target proves the predicate.
 */
export function buildComputerAppVerificationReceipt(args: {
  action: ComputerAppMutationContract;
  authorization: ComputerAppMutationAuthorization;
  dispatchReceipt: ComputerAppMutationDispatchReceipt;
  beforeEpoch: ComputerAppObservationEpoch;
  afterEpoch?: ComputerAppObservationEpoch | null;
  predicateSatisfied: boolean | null;
  evidenceIds?: string[];
  checkedAt?: string | number;
}): ComputerAppVerificationReceipt {
  const checkedAtMs = parsedTimeMs(args.checkedAt ?? Date.now()) ?? Date.now();
  const blockers: string[] = [];
  const afterEpoch = args.afterEpoch || null;
  const evidenceIds = uniqueBoundedStrings(
    [...(args.evidenceIds || []), ...(afterEpoch?.evidenceIds || [])],
    20,
    180,
  );

  const authorizationAtMs = parsedTimeMs(args.authorization.checkedAt);
  const dispatchedAtMs = parsedTimeMs(args.dispatchReceipt.dispatchedAt);
  if (!issuedMutationAuthorizations.has(args.authorization)) {
    blockers.push('Mutation authorization was not issued by this runtime.');
  }
  if (!issuedObservationEpochs.has(args.beforeEpoch)) {
    blockers.push('Before-state observation was not issued by this runtime.');
  }
  if (authorizationObservationEpochs.get(args.authorization) !== args.beforeEpoch) {
    blockers.push('Before-state observation is not the exact epoch bound to the authorization.');
  }
  if (!issuedMutationDispatchReceipts.has(args.dispatchReceipt)) {
    blockers.push('Mutation dispatch receipt was not issued by this runtime.');
  }
  if (!args.authorization.allowed || args.authorization.blockers.length > 0) {
    blockers.push('Mutation was not authorized for dispatch.');
  }
  if (args.authorization.actionId !== args.action.actionId) {
    blockers.push('Authorization action id does not match the mutation.');
  }
  if (args.authorization.contractBinding !== mutationContractBinding(args.action)) {
    blockers.push('Mutation contract changed after authorization.');
  }
  if (
    args.dispatchReceipt.actionId !== args.action.actionId
    || args.dispatchReceipt.tool !== args.action.tool
    || args.dispatchReceipt.epochId !== args.beforeEpoch.id
    || args.dispatchReceipt.contractBinding !== args.authorization.contractBinding
    || args.dispatchReceipt.policyBinding !== args.authorization.policyBinding
  ) {
    blockers.push('Mutation dispatch receipt does not match the authorized action.');
  }
  if (
    args.action.observationEpochId !== args.beforeEpoch.id
    || args.authorization.epochId !== args.beforeEpoch.id
  ) {
    blockers.push('Action, authorization, and before-state observation ids do not match.');
  }
  if (authorizationAtMs === null) {
    blockers.push('Authorization timestamp is invalid.');
  }
  if (dispatchedAtMs === null || authorizationAtMs === null || dispatchedAtMs < authorizationAtMs) {
    blockers.push('Mutation dispatch timestamp is invalid.');
  }
  if (args.action.schemaVersion !== 1 || args.beforeEpoch.schemaVersion !== 1 || (afterEpoch && afterEpoch.schemaVersion !== 1)) {
    blockers.push('Unsupported action or observation contract version.');
  }
  if (!compactIdentityText(args.action.actionId, 180)) {
    blockers.push('Mutation action id is missing.');
  }
  if (!compactIdentityText(args.beforeEpoch.id, 180)) {
    blockers.push('Before-state observation id is missing.');
  }

  if (!afterEpoch) {
    blockers.push('Missing fresh after-state observation.');
  } else {
    if (!issuedObservationEpochs.has(afterEpoch)) {
      blockers.push('After-state observation was not issued by this runtime.');
    }
    if (!compactIdentityText(afterEpoch.id, 180)) {
      blockers.push('After-state observation id is missing.');
    }
    const beforeMs = parsedTimeMs(args.beforeEpoch.capturedAt);
    const afterMs = parsedTimeMs(afterEpoch.capturedAt);
    const afterExpiresAtMs = parsedTimeMs(afterEpoch.expiresAt);
    if (
      afterEpoch.id === args.beforeEpoch.id
      || beforeMs === null
      || afterMs === null
      || dispatchedAtMs === null
      || afterMs <= beforeMs
      || afterMs <= dispatchedAtMs
    ) {
      blockers.push('After-state observation is not newer than actual mutation handler entry.');
    }
    if (afterMs !== null && afterMs > checkedAtMs + 1_000) {
      blockers.push('After-state observation is future-dated.');
    }
    if (
      afterExpiresAtMs === null
      || afterMs === null
      || afterExpiresAtMs <= afterMs
      || afterExpiresAtMs - afterMs > 120_000
      || checkedAtMs > afterExpiresAtMs
    ) {
      blockers.push('After-state observation is stale or has an invalid freshness window.');
    }
    if (afterEpoch.invalidatedAt || revokedObservationEpochs.has(afterEpoch)) {
      blockers.push('After-state observation was invalidated.');
    }
    if (afterEpoch.surface !== args.action.surface) {
      blockers.push('After-state surface does not match the action surface.');
    }
    const normalizedAfterTarget = compactObservationTarget(afterEpoch.target);
    if (!targetHasRequiredIdentity(afterEpoch.surface, normalizedAfterTarget)) {
      blockers.push('After-state observation lacks the complete required target identity.');
    }
    const mismatches = targetMismatches(
      compactObservationTarget(args.action.expectedTarget),
      normalizedAfterTarget,
      TARGET_STABLE_AFTER_ACTION_FIELDS,
    );
    if (mismatches.length > 0) {
      blockers.push(`After-state target changed in: ${mismatches.join(', ')}.`);
    }
    if (afterEpoch.blockerCodes.length > 0) {
      blockers.push(`After-state still reports blockers: ${afterEpoch.blockerCodes.join(', ')}.`);
    }
  }
  if (args.predicateSatisfied !== true) {
    blockers.push(args.predicateSatisfied === false
      ? 'Verification predicate failed.'
      : 'Verification predicate was not evaluated.');
  }
  if (evidenceIds.length === 0) {
    blockers.push('Verification receipt has no evidence ids.');
  }

  const status: ComputerAppVerificationReceipt['status'] = blockers.length === 0
    ? 'verified'
    : args.predicateSatisfied === false
      ? 'failed'
      : 'inconclusive';
  return Object.freeze({
    schemaVersion: 1,
    actionId: args.action.actionId,
    beforeEpochId: args.beforeEpoch.id,
    afterEpochId: afterEpoch?.id || null,
    status,
    predicate: compactIdentityText(args.action.verification?.predicate, 500) || '',
    evidenceIds: Object.freeze([...evidenceIds]) as unknown as string[],
    checkedAt: new Date(checkedAtMs).toISOString(),
    blockers: Object.freeze(blockers.slice(0, 10)) as unknown as string[],
    canComplete: status === 'verified',
  });
}

function isObservationCited(observation: ComputerAppGroundingObservation, citations: Set<string>): boolean {
  return citations.has(observation.id) || citations.has(observation.ruleId);
}

function findFreshestObservation(
  observations: ComputerAppGroundingObservation[],
  ruleId: string,
  citations: Set<string>,
): ComputerAppGroundingObservation | null {
  const matching = observations
    .filter((observation) => observation.ruleId === ruleId && (citations.size === 0 || isObservationCited(observation, citations)))
    .sort((a, b) => (parsedTimeMs(b.capturedAt) || 0) - (parsedTimeMs(a.capturedAt) || 0));
  return matching[0] || null;
}

function requiredRulesForAction(
  plan: ComputerAppGroundingPlan,
  action: ComputerAppGroundedAction,
): ComputerAppObservationRule[] {
  if (!action.mutates) return [];
  const coordinateAction = toolLooksCoordinateBased(action.tool, action.description);
  const approvalSensitiveAction = toolLooksApprovalSensitive(action.tool, action.description, plan.strategy.id);
  return plan.observationRules.filter((ruleItem) => {
    if (ruleItem.id === 'approval-state') return approvalSensitiveAction;
    if (ruleItem.id === 'agent-roster') return plan.strategy.id === 'universal_app_control' && action.tool === 'agent.build_app_capability';
    if ((ruleItem.id === 'app-window-state' || ruleItem.id === 'app-a11y') && plan.strategy.id === 'universal_app_control') return action.surface === 'desktop';
    if (ruleItem.id === 'layout-screenshot') return coordinateAction && action.surface === 'desktop';
    if (ruleItem.id === 'layout-a11y') return action.surface === 'desktop' && !action.tool.startsWith('desktop.indesign_') && !action.tool.startsWith('desktop.photoshop_');
    if (ruleItem.id === 'desktop-screen-size' || ruleItem.id === 'cad-screen-size') return coordinateAction && action.surface === 'desktop';
    if (!ruleItem.requiredBeforeAction) return false;
    if (ruleItem.id === 'desktop-screenshot') return plan.strategy.id === 'desktop_canvas_vision' || coordinateAction;
    if (ruleItem.id === 'cad-screenshot') return plan.strategy.id === 'engineering_cad_control' || coordinateAction;
    return true;
  });
}

function actionHasRequiredRuleCitation(action: ComputerAppGroundedAction, ruleId: string): boolean {
  const ids = new Set(action.sourceObservationIds || []);
  return ids.has(ruleId);
}

function observationAgeMs(
  observation: ComputerAppGroundingObservation,
  nowMs: number,
): number | null {
  const capturedAtMs = parsedTimeMs(observation.capturedAt);
  if (capturedAtMs === null || capturedAtMs > nowMs) return null;
  return nowMs - capturedAtMs;
}

function isRuleFresh(
  ruleItem: ComputerAppObservationRule,
  observations: ComputerAppGroundingObservation[],
  nowMs: number,
): boolean {
  const observation = findFreshestObservation(observations, ruleItem.id, new Set());
  if (!observation) return false;
  const ageMs = observationAgeMs(observation, nowMs);
  return ageMs !== null && ageMs <= ruleItem.freshnessMs;
}

function actionKey(action: ComputerAppGroundedAction): string {
  return `${action.surface}:${action.tool}:${action.description}`.toLowerCase().replace(/\s+/g, ' ').slice(0, 240);
}

function recentFailureCount(action: ComputerAppGroundedAction, history: ComputerAppGroundedAction[]): number {
  const key = actionKey(action);
  let count = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (actionKey(item) !== key) break;
    if (item.status === 'failed' || item.status === 'blocked') count += 1;
    else break;
  }
  return count;
}

export function evaluateComputerAppActionReadiness(args: {
  plan: ComputerAppGroundingPlan | null;
  action: ComputerAppGroundedAction;
  observations?: ComputerAppGroundingObservation[];
  now?: string | number;
}): ComputerAppActionReadiness {
  const { plan, action } = args;
  const observations = args.observations || [];
  const nowMs = parsedTimeMs(args.now ?? Date.now()) ?? Date.now();
  if (!plan) {
    return {
      ready: true,
      action,
      requiredRuleIds: [],
      satisfiedRuleIds: [],
      missingRuleIds: [],
      staleRuleIds: [],
      nextObservationTools: [],
      findings: [],
      summary: 'No grounding plan required.',
    };
  }

  const findings: ComputerAppGroundingFinding[] = [];
  const requiredRules = requiredRulesForAction(plan, action);
  const citations = new Set(action.sourceObservationIds || []);
  const satisfiedRuleIds: string[] = [];
  const missingRuleIds: string[] = [];
  const staleRuleIds: string[] = [];

  if (action.mutates && plan.strategy.id === 'desktop_readonly') {
    findings.push({
      severity: 'blocker',
      label: 'Read-only strategy attempted mutation',
      detail: `${action.id} mutates ${action.surface}, but ${plan.strategy.label} is read-only.`,
      fix: 'Stop execution and ask the user for an explicit mutating workflow with approval.',
    });
  }

  for (const requiredRule of requiredRules) {
    const cited = actionHasRequiredRuleCitation(action, requiredRule.id);
    const observation = observations.length > 0
      ? findFreshestObservation(observations, requiredRule.id, citations)
      : null;

    if (!cited && !observation) {
      missingRuleIds.push(requiredRule.id);
      findings.push({
        severity: 'blocker',
        label: 'Missing required observation',
        detail: `${action.id} must cite ${requiredRule.id} before ${action.tool}.`,
        fix: `Run ${requiredRule.tool} and cite the resulting observation before acting.`,
      });
      continue;
    }

    let ageMs: number | null = null;
    if (observation) {
      ageMs = observationAgeMs(observation, nowMs);
    } else if (
      typeof action.observationAgeMs === 'number'
      && Number.isFinite(action.observationAgeMs)
      && action.observationAgeMs >= 0
    ) {
      ageMs = action.observationAgeMs;
    }

    if (ageMs === null) {
      staleRuleIds.push(requiredRule.id);
      findings.push({
        severity: 'blocker',
        label: 'Invalid observation timestamp',
        detail: `${action.id} cites ${requiredRule.id}, but its capture time is missing, invalid, or future-dated.`,
        fix: `Re-run ${requiredRule.tool} with a trusted current runtime timestamp before ${action.tool}.`,
      });
      continue;
    }

    if (typeof ageMs === 'number' && ageMs > requiredRule.freshnessMs) {
      staleRuleIds.push(requiredRule.id);
      findings.push({
        severity: 'blocker',
        label: 'Stale observation',
        detail: `${action.id} uses ${requiredRule.id} at ${ageMs}ms old; max freshness is ${requiredRule.freshnessMs}ms.`,
        fix: `Re-run ${requiredRule.tool} immediately before ${action.tool}.`,
      });
      continue;
    }

    satisfiedRuleIds.push(requiredRule.id);
  }

  if (toolLooksCoordinateBased(action.tool, action.description)) {
    const hasFreshScreenshot = satisfiedRuleIds.includes('desktop-screenshot') || satisfiedRuleIds.includes('cad-screenshot') || citations.has('browser-proof');
    const hasScreenSize = satisfiedRuleIds.includes('desktop-screen-size') || satisfiedRuleIds.includes('cad-screen-size');
    if (!hasFreshScreenshot || (action.surface === 'desktop' && !hasScreenSize)) {
      findings.push({
        severity: 'blocker',
        label: 'Ungrounded coordinate action',
        detail: `${action.id} uses coordinate-style control without the screenshot/screen-size observations required for safe targeting.`,
        fix: 'Capture a fresh screenshot and screen_size, then cite both observation ids on the coordinate action.',
      });
    }
  }

  if (toolLooksApprovalSensitive(action.tool, action.description, plan.strategy.id) && action.approvalState !== 'approved') {
    findings.push({
      severity: 'blocker',
      label: 'Approval-sensitive action not approved',
      detail: `${action.id} appears to trigger a side effect but approvalState is ${action.approvalState || 'missing'}.`,
      fix: 'Stage the change and request approval before final side-effect action.',
    });
  }

  const blockerCount = findings.filter((finding) => finding.severity === 'blocker').length;
  const nextObservationTools = requiredRules
    .filter((ruleItem) => missingRuleIds.includes(ruleItem.id) || staleRuleIds.includes(ruleItem.id))
    .map((ruleItem) => ruleItem.tool);

  return {
    ready: blockerCount === 0,
    action,
    requiredRuleIds: requiredRules.map((ruleItem) => ruleItem.id),
    satisfiedRuleIds,
    missingRuleIds,
    staleRuleIds,
    nextObservationTools: Array.from(new Set(nextObservationTools)),
    findings,
    summary: blockerCount > 0
      ? `${blockerCount} grounding blocker${blockerCount === 1 ? '' : 's'} before ${action.tool}.`
      : `${action.tool} is grounded for ${plan.strategy.label}.`,
  };
}

export function recommendComputerAppGroundingNextStep(args: {
  plan: ComputerAppGroundingPlan | null;
  observations?: ComputerAppGroundingObservation[];
  candidateAction?: ComputerAppGroundedAction | null;
  actionHistory?: ComputerAppGroundedAction[];
  verificationComplete?: boolean;
  now?: string | number;
}): ComputerAppGroundingNextStep {
  const { plan } = args;
  const observations = args.observations || [];
  const actionHistory = args.actionHistory || [];
  const nowMs = parsedTimeMs(args.now ?? Date.now()) ?? Date.now();

  if (!plan) {
    return {
      kind: 'stop',
      title: 'No computer/app grounding needed',
      detail: 'This request does not require desktop/browser/app execution.',
      priority: 'low',
      findings: [],
    };
  }

  if (plan.strategy.id === 'human_verification_pause') {
    const verificationRule = plan.observationRules.find((item) => item.id === 'verification-state') || plan.observationRules[0];
    if (verificationRule && !isRuleFresh(verificationRule, observations, nowMs)) {
      return {
        kind: 'observe',
        title: 'Check human verification state',
        detail: verificationRule.reason,
        priority: 'high',
        tool: verificationRule.tool,
        ruleId: verificationRule.id,
        findings: [],
      };
    }
    return {
      kind: 'stop',
      title: 'Pause for human verification',
      detail: 'Automation must wait for the user to complete CAPTCHA, MFA, OTP, or bot verification before continuing.',
      priority: 'high',
      findings: [{
        severity: 'blocker',
        label: 'Human verification pause',
        detail: 'The selected strategy requires human completion before further automation.',
        fix: 'Ask the user to complete the verification gate, then re-check browser.verification_state.',
      }],
    };
  }

  const staleOrMissingRequiredRule = plan.observationRules.find((ruleItem) => ruleItem.requiredBeforeAction && !isRuleFresh(ruleItem, observations, nowMs));
  const firstObservationRule = plan.observationRules[0];
  const nextObservationRule = staleOrMissingRequiredRule || (observations.length === 0 ? firstObservationRule : null);
  if (!args.candidateAction && nextObservationRule) {
    return {
      kind: 'observe',
      title: `Observe ${nextObservationRule.id}`,
      detail: nextObservationRule.reason,
      priority: nextObservationRule.requiredBeforeAction ? 'high' : 'medium',
      tool: nextObservationRule.tool,
      ruleId: nextObservationRule.id,
      findings: [],
    };
  }

  const candidateAction = args.candidateAction || null;
  if (!candidateAction) {
    return {
      kind: 'act',
      title: 'Ready to select a grounded action',
      detail: 'Current observations satisfy the initial grounding plan. Select one reversible action and evaluate readiness before execution.',
      priority: 'medium',
      findings: [],
    };
  }

  const repeatedFailures = recentFailureCount(candidateAction, actionHistory);
  if (repeatedFailures >= 2) {
    return {
      kind: 'recover',
      title: 'Switch to recovery',
      detail: `${candidateAction.tool} failed ${repeatedFailures} times in a row. Use the fallback chain instead of retrying.`,
      priority: 'high',
      actionId: candidateAction.id,
      findings: [{
        severity: 'blocker',
        label: 'Repeated action failure',
        detail: `${candidateAction.id} is repeating the same failed action.`,
        fix: plan.fallbackChain.join(' -> '),
      }],
    };
  }

  const readiness = evaluateComputerAppActionReadiness({
    plan,
    action: candidateAction,
    observations,
    now: nowMs,
  });

  if (!readiness.ready) {
    const approvalFinding = readiness.findings.find((finding) => finding.label === 'Approval-sensitive action not approved');
    if (approvalFinding) {
      return {
        kind: 'request_approval',
        title: 'Request approval before side effect',
        detail: approvalFinding.fix,
        priority: 'high',
        tool: 'approvals.request',
        actionId: candidateAction.id,
        readiness,
        findings: readiness.findings,
      };
    }

    if (readiness.nextObservationTools.length > 0) {
      const tool = readiness.nextObservationTools[0];
      const ruleItem = plan.observationRules.find((item) => item.tool === tool);
      return {
        kind: 'observe',
        title: `Refresh observation before ${candidateAction.tool}`,
        detail: ruleItem?.reason || 'A required observation is missing or stale.',
        priority: 'high',
        tool,
        ruleId: ruleItem?.id,
        actionId: candidateAction.id,
        readiness,
        findings: readiness.findings,
      };
    }

    return {
      kind: 'stop',
      title: 'Action blocked by grounding',
      detail: readiness.summary,
      priority: 'high',
      actionId: candidateAction.id,
      readiness,
      findings: readiness.findings,
    };
  }

  const lastAction = actionHistory[actionHistory.length - 1];
  if (lastAction?.id === candidateAction.id && lastAction.status === 'success' && !args.verificationComplete) {
    return {
      kind: 'verify',
      title: 'Verify completed action',
      detail: `Use verification signals: ${plan.verificationSignals.join(' | ')}`,
      priority: 'high',
      actionId: candidateAction.id,
      readiness,
      findings: [],
    };
  }

  return {
    kind: 'act',
    title: `Execute grounded action: ${candidateAction.tool}`,
    detail: readiness.summary,
    priority: candidateAction.mutates ? 'high' : 'medium',
    tool: candidateAction.tool,
    actionId: candidateAction.id,
    readiness,
    findings: [],
  };
}

function buildObservationFreshness(
  plan: ComputerAppGroundingPlan,
  observations: ComputerAppGroundingObservation[],
  nowMs: number,
): ComputerAppGroundingObservationFreshness[] {
  return plan.observationRules.map((ruleItem) => {
    const observation = findFreshestObservation(observations, ruleItem.id, new Set());
    const ageMs = observation ? observationAgeMs(observation, nowMs) : null;
    const fresh = !!observation && (ageMs === null || ageMs <= ruleItem.freshnessMs);
    return {
      ruleId: ruleItem.id,
      tool: ruleItem.tool,
      required: ruleItem.requiredBeforeAction,
      freshnessMs: ruleItem.freshnessMs,
      latestObservationId: observation?.id || null,
      ageMs,
      fresh,
      summary: observation
        ? `${ruleItem.id}: ${fresh ? 'fresh' : 'stale'}${typeof ageMs === 'number' ? ` (${ageMs}ms old)` : ''}`
        : `${ruleItem.id}: missing`,
    };
  });
}

function deriveTraceStatus(args: {
  plan: ComputerAppGroundingPlan | null;
  audit: ComputerAppGroundingAudit;
  nextStep: ComputerAppGroundingNextStep;
  actions: ComputerAppGroundedAction[];
  verificationComplete?: boolean;
}): ComputerAppGroundingTraceStatus {
  if (!args.plan) return 'not_applicable';
  if (args.verificationComplete) return 'complete';
  if (args.nextStep.kind === 'observe') return 'needs_observation';
  if (args.nextStep.kind === 'request_approval') return 'needs_approval';
  if (args.nextStep.kind === 'recover') return 'recovering';
  if (args.nextStep.kind === 'verify') return 'needs_verification';
  if (args.nextStep.kind === 'act') return 'ready_to_act';
  if (!args.audit.ok || args.nextStep.kind === 'stop') return 'blocked';
  return args.actions.some((action) => action.status === 'success') ? 'needs_verification' : 'needs_observation';
}

function compactFindings(findings: ComputerAppGroundingFinding[], severity?: ComputerAppGroundingSeverity): string[] {
  return findings
    .filter((finding) => !severity || finding.severity === severity)
    .map((finding) => `${finding.label}: ${finding.fix}`)
    .slice(0, 6);
}

export function buildComputerAppGroundingTrace(args: {
  plan: ComputerAppGroundingPlan | null;
  observations?: ComputerAppGroundingObservation[];
  actions?: ComputerAppGroundedAction[];
  candidateAction?: ComputerAppGroundedAction | null;
  verificationComplete?: boolean;
  now?: string | number;
}): ComputerAppGroundingTrace {
  const plan = args.plan;
  const observations = args.observations || [];
  const actions = args.actions || [];
  const candidateAction = args.candidateAction || actions.find((action) => action.status === 'pending') || null;
  const nowMs = parsedTimeMs(args.now ?? Date.now()) ?? Date.now();
  const audit = auditComputerAppGroundingActions(plan, actions, observations);
  const nextStep = recommendComputerAppGroundingNextStep({
    plan,
    observations,
    candidateAction,
    actionHistory: actions,
    verificationComplete: args.verificationComplete,
    now: nowMs,
  });
  const observationFreshness = plan ? buildObservationFreshness(plan, observations, nowMs) : [];
  const status = deriveTraceStatus({
    plan,
    audit,
    nextStep,
    actions,
    verificationComplete: args.verificationComplete,
  });
  const staleRequired = observationFreshness.filter((item) => item.required && item.latestObservationId && !item.fresh).length;
  const missingRequired = observationFreshness.filter((item) => item.required && !item.latestObservationId).length;
  const freshRequired = observationFreshness.filter((item) => item.required && item.fresh).length;
  const requiredCount = observationFreshness.filter((item) => item.required).length;
  const blockerLabels = compactFindings([...audit.findings, ...nextStep.findings], 'blocker');
  const badges = [
    status,
    plan?.primarySurface || 'no_surface',
    plan?.strategy.id || 'no_strategy',
    `${freshRequired}/${requiredCount} required fresh`,
  ];
  if (missingRequired > 0) badges.push(`${missingRequired} missing`);
  if (staleRequired > 0) badges.push(`${staleRequired} stale`);

  return {
    version: 1,
    strategyId: plan?.strategy.id || null,
    strategyLabel: plan?.strategy.label || null,
    primarySurface: plan?.primarySurface || null,
    status,
    observations,
    observationFreshness,
    actions,
    audit,
    nextStep,
    display: {
      title: plan ? `${plan.strategy.label} grounding` : 'No grounding required',
      summary: plan
        ? `${status}: ${nextStep.title}. ${audit.summary}`
        : 'No desktop/browser/app execution grounding is needed for this request.',
      badges,
      blockers: blockerLabels,
      nextAction: nextStep.tool ? `${nextStep.kind}: ${nextStep.tool}` : nextStep.kind,
    },
    persistenceTargets: ['agent_run_metadata', 'office_run_ledger', 'chat_trace', 'computer_trace_artifact'],
  };
}

export function auditComputerAppGroundingActions(
  plan: ComputerAppGroundingPlan | null,
  actions: ComputerAppGroundedAction[],
  observations: ComputerAppGroundingObservation[] = [],
): ComputerAppGroundingAudit {
  if (!plan) {
    return {
      ok: true,
      findings: [],
      summary: 'No computer/app grounding plan required.',
    };
  }

  const findings: ComputerAppGroundingFinding[] = [];
  for (const action of actions) {
    findings.push(...evaluateComputerAppActionReadiness({ plan, action, observations }).findings);
  }

  const blockers = findings.filter((finding) => finding.severity === 'blocker').length;
  const warnings = findings.filter((finding) => finding.severity === 'warning').length;
  return {
    ok: blockers === 0,
    findings,
    summary: blockers > 0
      ? `${blockers} grounding blocker${blockers === 1 ? '' : 's'} detected.`
      : warnings > 0
        ? `${warnings} grounding warning${warnings === 1 ? '' : 's'} detected.`
        : 'Grounding actions satisfy the selected execution plan.',
  };
}

export function buildComputerAppGroundingRunbook(
  message: string,
  pipelineDecision?: UserTaskPipelineDecision | null,
): ComputerAppGroundingRunbook | null {
  const plan = buildComputerAppGroundingPlan(message, pipelineDecision);
  if (!plan) return null;
  const steps: ComputerAppGroundingRunbookStep[] = [
    ...plan.observationRules.map((ruleItem, index) => ({
      id: `observe-${index + 1}`,
      phase: 'observe' as const,
      title: ruleItem.requiredBeforeAction ? `Required observation: ${ruleItem.id}` : `Optional observation: ${ruleItem.id}`,
      tool: ruleItem.tool,
      required: ruleItem.requiredBeforeAction,
      detail: `${ruleItem.reason} Freshness target: ${ruleItem.freshnessMs}ms.`,
    })),
    {
      id: 'decide-1',
      phase: 'decide',
      title: 'Select grounded action',
      required: true,
      detail: `Use action discipline: ${plan.actionDiscipline.join(' ')}`,
    },
    {
      id: 'act-1',
      phase: 'act',
      title: 'Execute one grounded action',
      required: true,
      detail: 'Before execution, evaluate action readiness and cite sourceObservationIds for all required rules.',
    },
    {
      id: 'verify-1',
      phase: 'verify',
      title: 'Verify result',
      required: true,
      detail: `Acceptable verification signals: ${plan.verificationSignals.join(' | ')}`,
    },
    {
      id: 'recover-1',
      phase: 'recover',
      title: 'Recover or stop after repeated failure',
      required: true,
      detail: `Fallback chain: ${plan.fallbackChain.join(' -> ')}`,
    },
  ];
  return {
    strategy: plan.strategy,
    primarySurface: plan.primarySurface,
    steps,
    maxActionAttemptsBeforeRecovery: 2,
    maxSurfaceSwitches: 1,
  };
}

export function buildComputerAppGroundingPromptBlock(
  message: string,
  pipelineDecision?: UserTaskPipelineDecision | null,
): string | null {
  const plan = buildComputerAppGroundingPlan(message, pipelineDecision);
  if (!plan) return null;
  const lines = [
    '## Computer/App Grounding Plan',
    `Grounding strategy: ${plan.strategy.label} (${plan.strategy.id})`,
    `Primary surface: ${plan.primarySurface}`,
    'Required observations:',
    ...plan.observationRules
      .filter((item) => item.requiredBeforeAction)
      .map((item) => `- ${item.id}: ${item.tool} within ${item.freshnessMs}ms - ${item.reason}`),
    'Supporting observations:',
    ...plan.observationRules
      .filter((item) => !item.requiredBeforeAction)
      .map((item) => `- ${item.id}: ${item.tool} within ${item.freshnessMs}ms - ${item.reason}`),
    'Action discipline:',
    ...plan.actionDiscipline.map((item) => `- ${item}`),
    `Fallback chain: ${plan.fallbackChain.join(' -> ')}`,
    `Approval gates: ${plan.approvalGates.length ? plan.approvalGates.join(' | ') : 'none required by this plan'}`,
    'Action readiness contract:',
    '- Every mutating action must carry sourceObservationIds for applicable required observations.',
    '- Use evaluateComputerAppActionReadiness semantics before click/type/fill/drag/submit/deploy actions.',
    '- Use recommendComputerAppGroundingNextStep semantics to choose observe, request_approval, act, verify, recover, or stop.',
    '- Persist buildComputerAppGroundingTrace output so Office/chat can show status, blockers, freshness, and next action.',
    '- If readiness is blocked, run nextObservationTools or request approval instead of acting.',
    'Forbidden fallbacks:',
    ...plan.forbiddenFallbacks.map((item) => `- ${item}`),
    `Verification signals: ${plan.verificationSignals.join(' | ')}`,
  ];
  return lines.join('\n');
}
