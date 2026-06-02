import {
  buildComputerAppTaskStrategy,
  type ComputerAppTaskStrategy,
  type ComputerAppStrategyId,
} from './computerAppTaskStrategy';
import { buildDesignAppAutomationPlan } from './designAppAutomation';
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
            'Prefer script-backed Photoshop tools for layer state, text layers, placed assets, exports, and document state before accessibility clicks, keyboard shortcuts, or coordinates.',
            'Confirm selection or mask state before localized generative/content-aware edits.',
            'Use one layer/selection/asset/export operation per verification checkpoint, then re-run status/inventory.',
            'Do not save over source, flatten, rasterize, delete layers, run generative fill, or export final deliverables without approval and destination verification.',
          ],
          fallbackChain: [
            'file_stat/search for source package',
            'open_path or launch/focus Photoshop',
            'photoshop_document_status',
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
  return capturedAtMs === null ? null : Math.max(0, nowMs - capturedAtMs);
}

function isRuleFresh(
  ruleItem: ComputerAppObservationRule,
  observations: ComputerAppGroundingObservation[],
  nowMs: number,
): boolean {
  const observation = findFreshestObservation(observations, ruleItem.id, new Set());
  if (!observation) return false;
  const ageMs = observationAgeMs(observation, nowMs);
  return ageMs === null || ageMs <= ruleItem.freshnessMs;
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
    } else if (typeof action.observationAgeMs === 'number') {
      ageMs = action.observationAgeMs;
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
    `Approval gates: ${plan.approvalGates.length ? plan.approvalGates.join(' | ') : 'none for read-only work'}`,
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
