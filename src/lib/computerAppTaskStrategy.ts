import {
  buildUserTaskPipelineDecision,
  type UserTaskPipelineDecision,
  type UserTaskPipelineId,
} from './userTaskPipelines';
import { buildDesignAppAutomationPlan } from './designAppAutomation';
import {
  buildAdobeCreativeCloudAutomationPlan,
  findAdobeCreativeCloudAppProfile,
  isAdobeCreativeCloudTask,
} from './adobeCreativeCloudApps';
import {
  buildGenericAppNavigatorRouteContext,
  formatGenericAppNavigatorPromptBlock,
  shouldUseGenericAppNavigator,
} from './genericAppNavigator';
import { buildAppAdapterGapPromptBlock } from './appAdapterGapContract';

export type ComputerAppStrategyId =
  | 'browser_semantic'
  | 'credentialed_browser'
  | 'approval_sensitive_browser'
  | 'browser_file_transfer'
  | 'agent_asset_acquisition'
  | 'desktop_readonly'
  | 'desktop_semantic'
  | 'productivity_app_control'
  | 'desktop_canvas_vision'
  | 'creative_layout_control'
  | 'adobe_cc_control'
  | 'engineering_cad_control'
  | 'universal_app_control'
  | 'document_data_workbench'
  | 'ops_console_control'
  | 'file_readonly'
  | 'terminal_agent_orchestration'
  | 'human_verification_pause'
  | 'hybrid_control_loop';

export interface ComputerAppTaskStrategy {
  id: ComputerAppStrategyId;
  label: string;
  summary: string;
  observeFirst: string[];
  actionOrder: string[];
  verificationOrder: string[];
  recoveryPolicy: string[];
  approvalCheckpoints: string[];
  stopConditions: string[];
  recommendedTools: string[];
  bridgeRequirements: string[];
  maxBlindActions: number;
}

const PIPELINE_STRATEGY: Partial<Record<UserTaskPipelineId, ComputerAppStrategyId>> = {
  browser_data_retrieval: 'browser_semantic',
  browser_navigation: 'browser_semantic',
  browser_form_submission: 'credentialed_browser',
  human_verification: 'human_verification_pause',
  desktop_awareness: 'desktop_readonly',
  desktop_app_control: 'desktop_semantic',
  creative_image_design: 'desktop_canvas_vision',
  creative_layout_design: 'creative_layout_control',
  adobe_creative_cloud: 'adobe_cc_control',
  customer_support_crm: 'approval_sensitive_browser',
  sales_leads_outreach: 'approval_sensitive_browser',
  meetings_calendar_email: 'productivity_app_control',
  finance_billing: 'approval_sensitive_browser',
  document_intelligence: 'document_data_workbench',
  qa_testing: 'browser_semantic',
  it_support_ops: 'productivity_app_control',
  marketing_campaigns: 'approval_sensitive_browser',
  travel_booking: 'approval_sensitive_browser',
  procurement_shopping: 'approval_sensitive_browser',
  cloud_devops: 'ops_console_control',
  social_community: 'approval_sensitive_browser',
  inbox_notifications: 'productivity_app_control',
  local_files: 'file_readonly',
  terminal_agents: 'terminal_agent_orchestration',
  vault_credentials: 'credentialed_browser',
  wordpress_cms: 'credentialed_browser',
  website_platform_admin: 'credentialed_browser',
};

function textMatchesCanvasApp(message: string): boolean {
  return /\b(photoshop|figma|canva|illustrator|lightroom|premiere|after effects|blender|canvas|image editor|photo editor|retouch|crop|mask|layers?)\b/i.test(message);
}

function textMatchesCreativeLayoutApp(message: string): boolean {
  const text = String(message || '');
  return Boolean(buildDesignAppAutomationPlan(text)) || (
    /\b(indesign|in\s*design|\.indd\b|\.idml\b|\.indt\b|idml|indd|text frames?|parent pages?|master pages?|preflight|package links?|data merge)\b/i.test(text) ||
    (
      /\b(marketing|campaign|dealer|display|social|print|web|email)?\s*(banner|ad\b|advert|flyer|brochure|poster|layout|spread|page|template)\b/i.test(text) &&
      /\b(layers?|text frames?|headline|subhead|cta|disclaimer|legal|fine print|offer|price|apr|dealer|logo|links?|asset|image|copy|export|pdf|proof|package|preflight)\b/i.test(text)
    )
  );
}

function textMatchesAdobeCreativeCloudApp(message: string): boolean {
  const profile = findAdobeCreativeCloudAppProfile(message);
  if (!profile) return isAdobeCreativeCloudTask(message);
  return profile.id !== 'adobe_indesign' && profile.id !== 'adobe_photoshop';
}

function textMatchesEngineeringCadApp(message: string): boolean {
  return (
    /\b(auto\s*cad|autocad|cad|computer aided design|fusion\s*360|solid\s*works|solidworks|sketch\s*up|sketchup|freecad|librecad|qcad|draftsight|rhino(?:ceros)?|revit|civil\s*3d|inventor|onshape|vectorworks|archicad)\b/i.test(message) ||
    (
      /\b(?:create|draw|draft|model|design|make|edit|revise|dimension|export|save|open|inspect|convert)\b/i.test(message) &&
      /\b(?:floor plan|site plan|blueprint|mechanical drawing|engineering drawing|technical drawing|shop drawing|2d drawing|3d model|solid model|parametric sketch|sketch constraint|constraint|extrude|section view|dimensioned drawing|dimensions?|units?|scale|blocks?|polyline|linework|geometry|dwg|dxf|step|iges|stl)\b/i.test(message)
    )
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function withDesignAppAutomationPlan(strategy: ComputerAppTaskStrategy, message: string): ComputerAppTaskStrategy {
  const designPlan = buildDesignAppAutomationPlan(message);
  if (!designPlan) return strategy;
  return {
    ...strategy,
    label: `${designPlan.appName} Layered Creative Control Loop`,
    summary: `Use the dedicated ${designPlan.appName} control path for ${designPlan.taskKind}: resolve the staged file/package, inspect app-native document and layer state, choose the safest researched control surface, mutate through script-backed tools first, and verify with inventory, status, screenshot/proof, and file stats.`,
    observeFirst: uniqueStrings([
      ...designPlan.requiredInventory.map((item) => `Inventory: ${item}`),
      ...strategy.observeFirst,
    ]).slice(0, 14),
    actionOrder: uniqueStrings([
      `Choose control surface in this order: ${designPlan.controlSurfaceOrder.join(' -> ')}`,
      ...designPlan.controlOrder,
      ...strategy.actionOrder,
    ]).slice(0, 14),
    verificationOrder: uniqueStrings([...designPlan.verificationSignals, ...strategy.verificationOrder]).slice(0, 14),
    recoveryPolicy: uniqueStrings([...designPlan.recoveryRules, ...designPlan.failSafeRules, ...strategy.recoveryPolicy]).slice(0, 14),
    approvalCheckpoints: uniqueStrings([...designPlan.approvalGates, ...strategy.approvalCheckpoints]).slice(0, 16),
    stopConditions: uniqueStrings([
      `requested ${designPlan.appName} task is verified with app-native inventory/status plus visual or proof evidence`,
      'target staged design document is unavailable or mismatched',
      'missing fonts, links, assets, masks, selections, or permissions block safe completion',
      'approval required before mutation, save, export, package, destructive edit, or new script/action',
      ...strategy.stopConditions,
    ]).slice(0, 14),
    recommendedTools: uniqueStrings([...designPlan.recommendedTools, ...strategy.recommendedTools]).slice(0, 28),
    bridgeRequirements: uniqueStrings([
      'local desktop bridge',
      'macOS Accessibility permission for app focus/menu/input',
      'Screen Recording permission for visual proof',
      'file read/write grant for staged source packages, placed assets, proofs, and output folders',
      `${designPlan.appName} installed with scripting/actions available`,
      ...strategy.bridgeRequirements,
    ]).slice(0, 12),
    maxBlindActions: 0,
  };
}

function withAdobeCreativeCloudProfile(strategy: ComputerAppTaskStrategy, message: string): ComputerAppTaskStrategy {
  const adobePlan = buildAdobeCreativeCloudAutomationPlan(message);
  if (!adobePlan) return strategy;
  return {
    ...strategy,
    label: `${adobePlan.profile.appName} Control Loop`,
    summary: `Use the Adobe Creative Cloud control contract for ${adobePlan.profile.appName}: pick the researched control surface, use app-native/documented automation first, semantic desktop fallback second, and connected-agent buildout for missing adapters.`,
    observeFirst: uniqueStrings([...adobePlan.observeFirst, ...strategy.observeFirst]).slice(0, 12),
    actionOrder: uniqueStrings([
      `Choose control surface in this order: ${adobePlan.controlSurfaceOrder.join(' -> ')}`,
      ...adobePlan.actionOrder,
      ...strategy.actionOrder,
    ]).slice(0, 12),
    verificationOrder: uniqueStrings([...adobePlan.verificationOrder, ...strategy.verificationOrder]).slice(0, 12),
    recoveryPolicy: uniqueStrings([...adobePlan.recoveryPolicy, ...strategy.recoveryPolicy]).slice(0, 12),
    approvalCheckpoints: uniqueStrings([...adobePlan.approvalCheckpoints, ...strategy.approvalCheckpoints]).slice(0, 14),
    stopConditions: uniqueStrings([
      `requested ${adobePlan.profile.appName} task is completed and verified`,
      'target Adobe app or source file is unavailable',
      'license/login/permission blocks local control',
      'capability buildout is required before safe execution',
      ...strategy.stopConditions,
    ]).slice(0, 12),
    recommendedTools: uniqueStrings([...adobePlan.recommendedTools, ...strategy.recommendedTools]).slice(0, 24),
    bridgeRequirements: uniqueStrings([...adobePlan.bridgeRequirements, ...strategy.bridgeRequirements]).slice(0, 12),
    maxBlindActions: 0,
  };
}

function withGenericAppNavigator(strategy: ComputerAppTaskStrategy, message: string): ComputerAppTaskStrategy {
  const navigatorContext = buildGenericAppNavigatorRouteContext(message);
  const navigatorPlan = navigatorContext.plan;
  return {
    ...strategy,
    label: navigatorContext.targetAppName === 'Unfamiliar desktop app'
      ? 'Generic App Navigator And Buildout Loop'
      : `${navigatorContext.targetAppName} Generic App Navigator`,
    summary: `Navigate ${navigatorContext.targetAppName} ${navigatorContext.taskFamilyLabel} without requiring a prebuilt adapter: identify the app/window, inspect semantic controls, perform one bounded verified step at a time, and delegate app-capability buildout when the task needs a missing recipe/tool.`,
    observeFirst: uniqueStrings([
      ...navigatorPlan.observeFirst,
      ...strategy.observeFirst,
    ]).slice(0, 16),
    actionOrder: uniqueStrings([
      ...navigatorPlan.actionLadder,
      ...strategy.actionOrder,
    ]).slice(0, 16),
    verificationOrder: uniqueStrings([
      'verify after every bounded semantic step with window state, a11y tree, screenshot, or file_stat as appropriate',
      'hide internal route/status details on success and show only user-relevant proof',
      ...strategy.verificationOrder,
    ]).slice(0, 12),
    recoveryPolicy: uniqueStrings([
      ...navigatorPlan.recoveryRules,
      ...strategy.recoveryPolicy,
    ]).slice(0, 16),
    approvalCheckpoints: uniqueStrings([
      ...navigatorPlan.approvalBoundaries,
      ...strategy.approvalCheckpoints,
    ]).slice(0, 18),
    stopConditions: uniqueStrings([
      ...navigatorPlan.stopConditions,
      ...strategy.stopConditions,
    ]).slice(0, 16),
    recommendedTools: uniqueStrings([
      ...navigatorPlan.recommendedTools,
      ...strategy.recommendedTools,
    ]).slice(0, 30),
    bridgeRequirements: uniqueStrings([
      'local desktop bridge',
      'macOS Accessibility permission for semantic app control',
      'Screen Recording permission when visual verification is needed',
      'file read/write grant when local files or outputs are involved',
      'managed Codex/connected agent session for missing app capability buildout',
      ...strategy.bridgeRequirements,
    ]).slice(0, 14),
    maxBlindActions: 0,
  };
}

function textMatchesUniversalAppControl(message: string): boolean {
  const text = String(message || '');
  return (
    /\b(?:app|application|desktop app|native app|program|window)\b[\s\S]{0,120}\b(?:open|launch|focus|control|drive|automate|take over|click|type|paste|press|menu|create|make|build|edit|update|export|save|run)\b/i.test(text) ||
    /\b(?:open|launch|focus|switch to|use|control|drive|automate|take over)\s+(?!the\s+(?:website|browser|page|site|file|folder)\b)(?:[A-Za-z][A-Za-z0-9._+-]{1,40}(?:\s+[A-Za-z0-9][A-Za-z0-9._+-]{1,40}){0,4})(?:\s+(?:app|application|window|program))?\s+(?:and|then|to|for|with)\s+\b(?:create|make|build|edit|update|export|save|click|type|paste|press|fill|draw|design|run|do)\b/i.test(text) ||
    /\b(?:click|type|paste|press|select|choose|fill|set|create|make|build|edit|update|export|save|run)\b[\s\S]{0,160}\b(?:in|inside|on|with|using)\s+(?:the\s+)?(?:[A-Za-z][A-Za-z0-9._+-]{1,40}(?:\s+[A-Za-z0-9][A-Za-z0-9._+-]{1,40}){0,4})\s+(?:app|application|window|program)\b/i.test(text) ||
    /\b(?:if|when)\b[\s\S]{0,80}\b(?:chat|swanbot|agent|runtime)\b[\s\S]{0,120}\b(?:does not know|is not familiar|missing|needs|build)\b[\s\S]{0,120}\b(?:app|pipeline|adapter|capability|tool|recipe)\b/i.test(text)
  );
}

function textMatchesVerificationGate(message: string): boolean {
  return /\b(captcha|recaptcha|hcaptcha|turnstile|not a robot|human verification|bot verification|cloudflare|2fa|mfa|otp|verification code)\b/i.test(message);
}

function textMatchesCredentialedBrowser(message: string): boolean {
  return /\b(log ?in|sign ?in|password|credential|saved login|vault|admin panel|wp admin|checkout|submit|publish)\b/i.test(message);
}

function textMatchesBrowserFileTransfer(message: string): boolean {
  if (buildDesignAppAutomationPlan(String(message || ''))) return false;
  return (
    /\b(upload|attach|choose file|select file|import|download|export|save (?:this )?(?:page|webpage|site|report|csv|pdf)|save as pdf|print to pdf)\b/i.test(message) &&
    /\b(browser|website|webpage|site|shopify|wordpress|wp|webflow|wix|squarespace|woocommerce|bigcommerce|framer|cms|admin|product page|media library|downloads?|desktop|documents?|file|image|photo|pdf|csv|spreadsheet)\b/i.test(message)
  );
}

function textMatchesAgentAssetAcquisition(message: string): boolean {
  return (
    /\b(codex|agent|terminal agent|attached agent|download whatever|whatever (?:it|they) needs?|missing (?:asset|file|dependency|package|resource)|needed (?:asset|file|dependency|package|resource)|required (?:asset|file|dependency|package|resource))\b/i.test(message) &&
    /\b(download|fetch|get|acquire|install|generate|create|prepare|pull|clone|save)\b/i.test(message)
  ) || /\b(download|fetch|get|acquire)\b[\s\S]{0,100}\b(asset|dependency|package|font|image|template|dataset|resource)\b[\s\S]{0,100}\b(codex|agent|terminal)\b/i.test(message);
}

function textMatchesLocalFileWorkflow(message: string): boolean {
  const text = String(message || '');
  if (textMatchesBrowserFileTransfer(text)) return false;
  return (
    /\b(search|find|locate|read|open|scan|list|rename|move|copy|trash|delete|edit|write|save)\b[\s\S]{0,140}\b(desktop|downloads?|documents?|files?|folders?|directory|path|local computer|hard drive|finder)\b/i.test(text) ||
    /\b(desktop|downloads?|documents?|files?|folders?|directory|path|local computer|hard drive|finder)\b[\s\S]{0,140}\b(search|find|locate|read|open|scan|list|rename|move|copy|trash|delete|edit|write|save)\b/i.test(text) ||
    /\b\.(pdf|csv|docx?|xlsx?|png|jpe?g|gif|webp|psd|psb|indd|idml|txt|md|json|zip)\b/i.test(text)
  );
}

function baseStrategy(id: ComputerAppStrategyId): ComputerAppTaskStrategy {
  switch (id) {
    case 'browser_semantic':
      return {
        id,
        label: 'Browser Semantic Control Loop',
        summary: 'Use DOM/ARIA state and deterministic browser actions before screenshots or vision.',
        observeFirst: ['browser.open_url when a URL is known', 'browser.dom_snapshot', 'browser.verification_state for login/admin/forms', 'browser.screenshot only when visual state matters'],
        actionOrder: ['browser.click_role', 'browser.fill_field', 'browser.press_key', 'Stagehand-style semantic action only for ambiguous dynamic UI'],
        verificationOrder: ['browser.dom_snapshot after state changes', 'visible confirmation text or URL change', 'browser.screenshot for proof'],
        recoveryPolicy: ['If a selector fails twice, refresh DOM state before retrying.', 'If the page blocks automation, report the blocker instead of looping.', 'Switch to screenshot reasoning only after semantic state is insufficient.'],
        approvalCheckpoints: ['final submit/send/publish/delete/payment', 'credential entry', 'cross-domain navigation not requested by user'],
        stopConditions: ['requested data/state captured', 'site blocks automation', 'approval or human verification required'],
        recommendedTools: ['browser.open_url', 'browser.dom_snapshot', 'browser.verification_state', 'browser.click_role', 'browser.fill_field', 'browser.press_key', 'browser.screenshot'],
        bridgeRequirements: ['browser bridge or Browserbase session', 'persistent context for logged-in pages'],
        maxBlindActions: 0,
      };
    case 'credentialed_browser':
      return {
        id,
        label: 'Credentialed Browser Workflow',
        summary: 'Resolve credentials through the vault and fill fields without exposing secrets to the model.',
        observeFirst: ['vault.resolve_for_task', 'vault.runbook', 'browser.verification_state', 'browser.dom_snapshot'],
        actionOrder: ['browser.fill_credential_field when available', 'browser.fill_field only for non-secret fields', 'browser.click_role after approval for final submit'],
        verificationOrder: ['confirm origin matches credential policy', 'verify successful login or draft/save state', 'capture confirmation text or screenshot'],
        recoveryPolicy: ['Never print or request raw passwords in chat.', 'If MFA/CAPTCHA appears, pause for human completion.', 'If credential resolution fails, ask user to connect or grant the vault entry.'],
        approvalCheckpoints: ['using a saved credential', 'final login submit when requested policy requires it', 'publishing/scheduling/deleting content'],
        stopConditions: ['login/workflow completed', 'vault grant missing', 'human verification required', 'site rejects credentials'],
        recommendedTools: ['vault.resolve_for_task', 'vault.runbook', 'vault.grants', 'browser.verification_state', 'browser.dom_snapshot', 'browser.fill_credential_field', 'browser.fill_field', 'approvals.request'],
        bridgeRequirements: ['vault grant scoped to site origin', 'browser bridge or Browserbase persistent context'],
        maxBlindActions: 0,
      };
    case 'approval_sensitive_browser':
      return {
        id,
        label: 'Approval-Sensitive Browser Workflow',
        summary: 'Use browser state and live pages for business workflows, but stage side effects behind approval.',
        observeFirst: ['browser.open_url when a target is known', 'browser.dom_snapshot', 'browser.verification_state for login/admin/checkout flows', 'vault.resolve_for_task only when login is required'],
        actionOrder: ['browser.click_role for navigation', 'browser.fill_field for non-secret fields', 'browser.fill_credential_field when available', 'draft/stage carts, posts, replies, bookings, or records before final action'],
        verificationOrder: ['browser.dom_snapshot after each state change', 'visible confirmation text, URL, or record state', 'browser.screenshot for final proof when visual state matters'],
        recoveryPolicy: ['If a page requires login, resolve vault grants instead of asking for raw passwords.', 'If pricing/availability changes, stop and re-confirm before checkout/booking.', 'If selectors fail twice, refresh DOM state and do not blindly click.'],
        approvalCheckpoints: ['credential use', 'external send/post/publish', 'checkout/payment/subscription', 'booking/cancellation', 'CRM/support/finance record writes', 'bulk changes'],
        stopConditions: ['draft/staged state ready for approval', 'requested read-only data captured', 'human verification required', 'approval required', 'site blocks automation'],
        recommendedTools: ['browser.open_url', 'browser.dom_snapshot', 'browser.verification_state', 'browser.click_role', 'browser.fill_field', 'browser.screenshot', 'vault.resolve_for_task', 'approvals.request'],
        bridgeRequirements: ['browser bridge or Browserbase session', 'persistent session for logged-in workflows', 'vault grant when credentials are needed'],
        maxBlindActions: 0,
      };
    case 'browser_file_transfer':
      return {
        id,
        label: 'Browser And Local File Transfer Loop',
        summary: 'Coordinate browser DOM state with scoped local file search/stat/upload/download verification.',
        observeFirst: ['desktop.file_search or desktop.file_stat for source/target path', 'browser.verification_state', 'browser.dom_snapshot', 'browser.screenshot when the file chooser/download UI is visual'],
        actionOrder: ['resolve exact local file or destination folder', 'open/focus the target page', 'use browser.upload_file for file inputs or file choosers', 'stage uploads/imports before submit/publish', 'use browser/download controls then verify local output with desktop.file_search/stat'],
        verificationOrder: ['verify file name/size before upload', 'browser.dom_snapshot or confirmation text after attach/import', 'desktop.file_search/stat after download/export/save', 'browser.screenshot for final proof'],
        recoveryPolicy: ['If the upload control is hidden, use the file chooser button path before coordinate clicks.', 'If the local file is ambiguous, stop and ask for the exact file.', 'If a download path is unknown, check Downloads first and report candidates.'],
        approvalCheckpoints: ['external upload/import', 'publish/submit after attaching a file', 'overwriting local downloads or exports', 'credential use'],
        stopConditions: ['file attached/downloaded and verified', 'file missing or ambiguous', 'human verification required', 'approval required before final side effect'],
        recommendedTools: ['desktop.file_search', 'desktop.file_stat', 'desktop.file_read', 'browser.open_url', 'browser.verification_state', 'browser.dom_snapshot', 'browser.upload_file', 'browser.click_role', 'browser.screenshot', 'approvals.request'],
        bridgeRequirements: ['local desktop bridge with file grant', 'browser bridge persistent context', 'vault grant when the site requires login'],
        maxBlindActions: 0,
      };
    case 'agent_asset_acquisition':
      return {
        id,
        label: 'Codex Agent Asset Acquisition',
        summary: 'Use an attached Codex terminal agent to safely fetch, generate, install, or prepare missing assets/resources, then verify local files before continuing.',
        observeFirst: ['office.list_agents to find a managed Codex session', 'desktop.file_search/file_stat to check whether the asset already exists', 'approval state for network downloads or file writes'],
        actionOrder: ['reuse an existing managed Codex session when available', 'otherwise launch a scoped Codex acquisition session', 'write into an explicit output directory', 'verify resulting files with desktop.file_search/stat/read before passing them to browser/app steps'],
        verificationOrder: ['Codex session id and prompt receipt', 'manifest or terminal note with absolute output paths', 'desktop.file_stat for each acquired artifact', 'desktop.file_read for manifests or text outputs'],
        recoveryPolicy: ['If Codex bridge is offline, do not pretend the asset was acquired.', 'If a requested source is paywalled, credentialed, or blocked by verification, pause for user input.', 'If multiple candidate files are produced, ask for selection before uploading/using them.'],
        approvalCheckpoints: ['network download', 'package install', 'repo clone', 'local file write', 'using acquired assets in an external browser/app workflow'],
        stopConditions: ['asset exists and is verified', 'Codex session launched and pending completion', 'bridge offline', 'source requires credentials/human verification', 'approval required'],
        recommendedTools: ['office.list_agents', 'agent.codex_acquire_asset', 'desktop.file_search', 'desktop.file_stat', 'desktop.file_read', 'approvals.request'],
        bridgeRequirements: ['Codex bridge running on localhost:7779', 'managed Codex terminal session or permission to launch one', 'local file write/read grant for the output directory'],
        maxBlindActions: 0,
      };
    case 'desktop_readonly':
      return {
        id,
        label: 'Local Desktop Read-Only Awareness',
        summary: 'Read local state without mutating the user computer.',
        observeFirst: ['desktop.list_browser_tabs', 'desktop.window_state', 'desktop.list_running_apps', 'desktop.clipboard', 'desktop.file_list as requested'],
        actionOrder: ['No mutation actions. Keep output to requested state.'],
        verificationOrder: ['Return source app/browser names and timestamps when available.'],
        recoveryPolicy: ['If the local bridge is unavailable, explain the exact bridge needed.', 'Do not fall back to Browserbase for local tabs/windows.'],
        approvalCheckpoints: [],
        stopConditions: ['requested local state returned', 'bridge unavailable'],
        recommendedTools: ['desktop.list_browser_tabs', 'desktop.window_state', 'desktop.list_running_apps', 'desktop.clipboard', 'desktop.file_list'],
        bridgeRequirements: ['local desktop bridge running with required permissions'],
        maxBlindActions: 0,
      };
    case 'desktop_semantic':
      return {
        id,
        label: 'Desktop Semantic Control Loop',
        summary: 'Use accessibility tree and app focus before keyboard/mouse actions.',
        observeFirst: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.focus_app or desktop.launch_app', 'desktop.read_a11y_tree', 'desktop.screenshot when visual confirmation matters'],
        actionOrder: ['desktop.menu_click for stable menu actions', 'desktop.click_element from a11y tree', 'desktop.set_element_value for named editable fields', 'desktop.type_text or desktop.paste_text after focus confirmation', 'desktop.press_keys for shortcuts', 'desktop.mouse_click only when semantic targets fail'],
        verificationOrder: ['desktop.read_a11y_tree after semantic action', 'desktop.screenshot after visual/action state change', 'desktop.window_state for focus verification'],
        recoveryPolicy: ['If focus is wrong, stop and refocus before typing.', 'If a11y tree is empty/stale twice, switch to screenshot + coordinate strategy.', 'Never click or type into an unknown app.'],
        approvalCheckpoints: ['typing text', 'clicking controls', 'file writes', 'external sends', 'running shortcuts'],
        stopConditions: ['requested app state reached', 'permission missing', 'target app unavailable', 'approval required'],
        recommendedTools: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.click_element', 'desktop.set_element_value', 'desktop.menu_click', 'desktop.type_text', 'desktop.paste_text', 'desktop.press_keys', 'desktop.screenshot'],
        bridgeRequirements: ['local desktop bridge', 'macOS Accessibility permission for app control'],
        maxBlindActions: 0,
      };
    case 'productivity_app_control':
      return {
        id,
        label: 'Productivity App Control Loop',
        summary: 'For Slack, Mail, Calendar, Teams, Notion, and office apps, use focus + accessibility tree and draft before sending.',
        observeFirst: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.focus_app or desktop.launch_app for the target app', 'desktop.read_a11y_tree', 'desktop.screenshot only when accessibility state is incomplete'],
        actionOrder: ['navigate with menus/accessibility first', 'desktop.set_element_value for labeled fields when available', 'desktop.type_text for short input or desktop.paste_text for long/multiline input after confirming focus and destination', 'desktop.press_keys for stable shortcuts', 'desktop.click_element before coordinates', 'save/draft before send/archive/delete'],
        verificationOrder: ['desktop.read_a11y_tree after state changes', 'desktop.window_state for focus/app verification', 'desktop.screenshot for message, calendar, or inbox proof'],
        recoveryPolicy: ['If focus is not the requested app, stop and refocus before typing.', 'If a destructive or external-send control is visible, pause for approval.', 'If the a11y tree is stale twice, switch to screenshot inspection but do not type blindly.'],
        approvalCheckpoints: ['sending messages or email', 'calendar invite create/update/cancel', 'archive/delete/mute/bulk changes', 'account/access changes', 'credential use'],
        stopConditions: ['requested draft/triage/update is complete', 'approval required', 'target app unavailable', 'permission missing', 'human verification required'],
        recommendedTools: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.click_element', 'desktop.set_element_value', 'desktop.menu_click', 'desktop.type_text', 'desktop.paste_text', 'desktop.press_keys', 'desktop.screenshot', 'approvals.request'],
        bridgeRequirements: ['local desktop bridge', 'macOS Accessibility permission', 'Screen Recording permission for screenshots when visual proof is needed'],
        maxBlindActions: 0,
      };
    case 'desktop_canvas_vision':
      return {
        id,
        label: 'Canvas App Vision Control Loop',
        summary: 'For Photoshop/Figma/canvas apps, use screenshots and visible-state verification when semantic UI is incomplete.',
        observeFirst: ['desktop.launch_app or desktop.focus_app', 'desktop.screenshot before every coordinate action', 'desktop.read_a11y_tree for menus/panels when available', 'desktop.screen_size before coordinates'],
        actionOrder: ['desktop.menu_click for app menu commands', 'use shortcuts where stable', 'desktop.click_element for accessible controls', 'desktop.click_at, desktop.mouse_down/up, or mouse_drag only after screenshot reasoning', 'desktop.press_keys for precise shortcuts'],
        verificationOrder: ['desktop.screenshot after every visual edit', 'compare visible canvas/tool state to requested outcome', 'export/open preview only after approval'],
        recoveryPolicy: ['No blind coordinate clicks.', 'If the canvas state is unclear, request a screenshot or ask for a precise target.', 'If a visual edit fails twice, stop and report observed state.'],
        approvalCheckpoints: ['modifying a file', 'exporting/uploading', 'saving over an existing asset', 'coordinate-based destructive action'],
        stopConditions: ['visual outcome verified', 'target image/file missing', 'permission/app missing', 'approval required'],
        recommendedTools: ['desktop.launch_app', 'desktop.focus_app', 'desktop.screenshot', 'desktop.screen_size', 'desktop.read_a11y_tree', 'desktop.click_element', 'desktop.menu_click', 'desktop.click_at', 'desktop.mouse_down', 'desktop.mouse_up', 'desktop.mouse_drag', 'desktop.press_keys'],
        bridgeRequirements: ['local desktop bridge', 'screen recording permission for screenshots', 'Accessibility permission for input'],
        maxBlindActions: 0,
      };
    case 'creative_layout_control':
      return {
        id,
        label: 'Layered Creative Design Control Loop',
        summary: 'For Adobe InDesign layouts and Photoshop image/composite work, inspect the source package, document state, layers/text/links or layers/masks/selections, then use app-native tools before visual proof, save, export, or handoff.',
        observeFirst: ['desktop.file_search/file_stat for the exact .indd/.idml/.indt/.psd/.psb/image file or staged package folder', 'desktop.open_path or desktop.launch_app/focus_app for Adobe InDesign or Photoshop', 'app-native document status to verify active document, path, saved/modified state, layers, links/assets, fonts or color mode, and package readiness', 'app-native layer/text/link or layer/mask/selection inventory before mutation', 'desktop.screenshot for visual proof and alignment after inventory, not as the first control surface'],
        actionOrder: ['prefer app-native script/DOM/action tools for named copy, layer, asset, selection/mask, and export operations', 'use InDesign batch text/find-change tools for layout copy changes', 'use Photoshop document/layer tools for text layers, placed assets, selection/mask, generative/content-aware, and raster export workflows', 'use menu/a11y actions only after document status and file/path checks', 'use coordinate actions only for visual gaps after screenshot and screen_size'],
        verificationOrder: ['rerun app-native layer/text/link or layer/mask inventory for updated fields/assets', 'rerun document status for missing fonts/links/assets, locked/hidden layers, modified state, dimensions/color mode, and selection/mask state', 'capture desktop.screenshot or exported proof for visual state', 'desktop.file_stat exported PDF/PNG/JPG/package outputs when requested'],
        recoveryPolicy: ['If the expected document is not active/open, open the exact staged file before editing.', 'If layers are locked/hidden or the selection/mask target is ambiguous, report the exact blocker before mutation.', 'If text becomes overset or a Photoshop localized edit lacks a selection/mask, stop and ask for the smallest user decision.', 'If links, fonts, or placed assets are missing, resolve package sidecars before export.', 'If no script-backed tool covers the operation, delegate a bounded app-capability buildout before blind UI coordinates.'],
        approvalCheckpoints: ['editing text frames/layers, layer visibility, object state, selections, masks, or adjustment layers', 'relinking or replacing placed/smart-object assets', 'generative fill, content-aware fill, destructive pixel edits, flattening, or rasterizing', 'saving over source InDesign/Photoshop/image files', 'exporting, packaging, or overwriting deliverables', 'running new scripts/macros/adapters beyond existing bridge tools'],
        stopConditions: ['requested creative change is verified by inventory and visual/proof evidence', 'target document is unavailable or mismatched', 'missing fonts/links/assets block proof/export', 'overset text, ambiguous layer target, or missing selection/mask requires user choice', 'approval required before save/export/overwrite/relink/destructive edit/script'],
        recommendedTools: ['desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'desktop.launch_app', 'desktop.focus_app', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_batch_find_change', 'desktop.indesign_update_text_layer', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_update_text_layer', 'desktop.photoshop_place_asset', 'desktop.photoshop_export_proof', 'desktop.read_a11y_tree', 'desktop.menu_click', 'desktop.screenshot', 'desktop.screen_size', 'approvals.request'],
        bridgeRequirements: ['local desktop bridge', 'macOS Accessibility permission for app focus/menu/input', 'Screen Recording permission for visual proof', 'file read/write grant for the staged design package or output folder', 'Adobe InDesign or Adobe Photoshop installed with scripting/actions available'],
        maxBlindActions: 0,
      };
    case 'adobe_cc_control':
      return {
        id,
        label: 'Adobe Creative Cloud Control Loop',
        summary: 'For Adobe Creative Cloud apps beyond the dedicated InDesign/Photoshop bridge slices, select the app profile, resolve source/output files, prefer app-native automation, and build missing adapters through a connected agent before retrying.',
        observeFirst: ['match the exact Adobe app and file type from the task', 'desktop.file_search/file_stat for source documents, linked assets, and output folders', 'desktop.open_path or desktop.launch_app/focus_app for the target Adobe app', 'desktop.window_state to verify the active app/document context', 'desktop.read_a11y_tree and desktop.screenshot for menu/panel/canvas state before any mutation'],
        actionOrder: ['prefer documented Adobe scripting, actions, command queues, plugin SDKs, or file-format operations before UI control', 'perform one reversible app action at a time with refreshed evidence after each step', 'use accessibility/menu actions only when app-native state is unavailable and the control target is verified', 'delegate missing app capability to agent.build_app_capability with exact app, file type, desired operation, and smoke expectations', 'save/export/render/encode/package only after approval and destination verification'],
        verificationOrder: ['active app/document identity confirmed', 'app-specific inventory or visible state captured before mutation', 'before/after screenshot or app state after each edit', 'desktop.file_stat for exported, rendered, saved, encoded, or packaged artifacts', 'connected-agent adapter returns a recipe, source references, and focused smoke before retry'],
        recoveryPolicy: ['If the active Adobe app/document is mismatched, stop and open the exact staged file before editing.', 'If a semantic target is missing twice, re-observe app state and request app-capability buildout instead of blind coordinates.', 'If the requested Adobe app lacks a bridge adapter, build the smallest reusable adapter/recipe and smoke it before retrying.', 'If license/login/plugins/media/assets/fonts block work, return the exact blocker and user action required.'],
        approvalCheckpoints: ['desktop mutation in an Adobe app', 'editing source documents, media, layers, artboards, timelines, pages, forms, metadata, or 3D/material assets', 'running new scripts/actions/plugins', 'generative AI or paid actions', 'saving over sources', 'exporting/rendering/encoding/batch processing/packaging deliverables', 'connected-agent runtime patch or adapter buildout'],
        stopConditions: ['requested Adobe app task is completed and verified', 'task is staged and waiting for approval', 'target Adobe app/source file/license/login is unavailable', 'missing fonts/assets/media/plugins block safe completion', 'safe generic controls are insufficient and connected-agent buildout is required', 'OS/bridge/file permission is missing'],
        recommendedTools: ['desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'desktop.launch_app', 'desktop.focus_app', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.screen_size', 'desktop.menu_click', 'desktop.click_element', 'desktop.set_element_value', 'desktop.press_keys', 'desktop.type_text', 'desktop.paste_text', 'office.list_agents', 'research.search', 'agent.build_app_capability', 'approvals.request'],
        bridgeRequirements: ['local desktop bridge', 'macOS Accessibility permission for app focus/menu/input', 'Screen Recording permission for visual proof', 'file read/write grant for source packages and output folders', 'managed Codex/connected agent session for missing Adobe app capability buildout'],
        maxBlindActions: 0,
      };
    case 'engineering_cad_control':
      return {
        id,
        label: 'Engineering/CAD Control Loop',
        summary: 'For AutoCAD/Fusion/SketchUp/SOLIDWORKS/Rhino/Revit-style work, choose the official app API, script, add-in, command, or cloud automation surface before desktop UI fallback, then run read-first state checks and measurement checkpoints.',
        observeFirst: ['desktop.launch_app or desktop.focus_app for the target CAD/engineering app', 'desktop.window_state to verify the active drawing/model window', 'desktop.read_a11y_tree for command line, menus, panels, and file dialogs', 'desktop.screenshot for drawing/model state before geometry edits', 'desktop.file_search/stat for source DWG/DXF/STEP/STL/project files or export targets'],
        actionOrder: ['confirm target app, document, units, scale, and file path before editing', 'choose the researched control surface first: app API/script/add-in/command/cloud automation before generic desktop control', 'prefer CAD command line, app menus, named panels, and shortcuts over coordinate clicks when no app-native adapter exists', 'perform one geometry/modeling operation at a time with explicit numeric input when possible', 'use coordinate actions only after a fresh screenshot and screen_size prove the target', 'save/export only after approval and destination path verification'],
        verificationOrder: ['desktop.screenshot after each geometry/modeling mutation', 'verify dimensions/units/layers/object count or named features after each step', 'desktop.file_stat after save/export', 'ask for human confirmation when visual geometry or tolerances are ambiguous'],
        recoveryPolicy: ['If focus, command line, units, or drawing context is unclear, stop and re-observe before typing.', 'If a CAD command fails or creates unexpected geometry, undo once, re-observe, and switch to a smaller command step.', 'If no verified app-native route exists for the requested CAD operation, delegate a bounded app-capability buildout with official source refs before blind UI control.', 'Never keep drawing from an unverified scale, unit system, or coordinate origin.'],
        approvalCheckpoints: ['creating or modifying engineering files', 'overwriting DWG/DXF/STEP/STL/project files', 'exporting manufacturing/permit/client deliverables', 'running macros/scripts/plugins inside CAD apps', 'coordinate-based destructive edits'],
        stopConditions: ['requested geometry/model/file is verified', 'target CAD app or file is unavailable', 'units/scale/tolerances are ambiguous', 'approval required before save/export/overwrite', 'verified app-native route is missing and connected-agent buildout has been delegated', 'bridge lacks Accessibility or Screen Recording permission'],
        recommendedTools: ['desktop.launch_app', 'desktop.focus_app', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.screen_size', 'desktop.menu_click', 'desktop.click_element', 'desktop.press_keys', 'desktop.type_text', 'desktop.paste_text', 'desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'office.list_agents', 'research.search', 'agent.build_app_capability', 'approvals.request'],
        bridgeRequirements: ['local desktop bridge', 'macOS Accessibility permission for input', 'Screen Recording permission for drawing/model verification', 'file read/write grant for approved CAD/project folders', 'managed Codex/connected agent session for missing CAD adapter buildout'],
        maxBlindActions: 0,
      };
    case 'universal_app_control':
      return {
        id,
        label: 'Universal App Control And Buildout Loop',
        summary: 'For unfamiliar desktop/native apps, discover deterministic control surfaces first, try generic semantic controls, then delegate missing app capability buildout to a connected agent when no pipeline exists.',
        observeFirst: ['integrations.list and office.list_agents to find connected surfaces and buildout agents', 'existing app/pipeline/adapter docs and official vendor/OS automation docs before adding new code', 'desktop.list_running_apps and desktop.window_state to identify the target app/window', 'desktop.read_a11y_tree for accessible menus, fields, command bars, and controls', 'desktop.screenshot when the app is visual or accessibility is incomplete'],
        actionOrder: ['launch or focus the target app only after bridge readiness is known', 'prefer documented app APIs, scripts, command palettes, file-format operations, a11y/menu/field/keyboard actions before coordinates', 'perform one reversible app action and verify state before continuing', 'if no safe generic action or app recipe exists, call agent.build_app_capability with the exact app, task, gap, and desired outcome', 'retry only after the connected agent returns a recipe, adapter, bridge tool, smoke, or explicit blocker'],
        verificationOrder: ['window/app identity confirmed', 'a11y or screenshot evidence cited before mutation', 'new capability has a focused smoke test or recipe proof', 'post-action app state or artifact verified', 'blocked buildouts state the exact missing permission, app install, license, credential grant, or file'],
        recoveryPolicy: ['If the app is unknown, research official control surfaces and build a reusable app recipe or adapter instead of guessing.', 'If a generic action fails twice, stop and delegate capability buildout or ask for human app context.', 'Never invent app-specific commands, shortcuts, or file formats without official docs, observation, or a connected-agent buildout.'],
        approvalCheckpoints: ['desktop mutation in an unfamiliar app', 'saving/exporting/overwriting files', 'running macros/scripts/plugins', 'code changes to add app adapters or bridge tools', 'credentialed/private app workflows'],
        stopConditions: ['task completed and verified', 'safe generic controls are insufficient and buildout has been delegated', 'target app unavailable', 'OS/app permission missing', 'credential/license/human verification required', 'connected agent unavailable'],
        recommendedTools: ['integrations.list', 'office.list_agents', 'research.search', 'agent.build_app_capability', 'desktop.list_running_apps', 'desktop.window_state', 'desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.screen_size', 'desktop.menu_click', 'desktop.click_element', 'desktop.set_element_value', 'desktop.type_text', 'desktop.paste_text', 'desktop.press_keys', 'approvals.request'],
        bridgeRequirements: ['local desktop bridge for generic app actions', 'macOS Accessibility permission for input and a11y', 'Screen Recording permission for visual verification', 'managed Codex/connected agent session for missing capability buildout'],
        maxBlindActions: 0,
      };
    case 'document_data_workbench':
      return {
        id,
        label: 'Document/Data Workbench',
        summary: 'Read files, extract structured fields, and create artifacts before any external upload or database write.',
        observeFirst: ['desktop.file_list or desktop.file_search', 'desktop.file_read', 'document/OCR extraction tool when available', 'artifact schema or requested fields'],
        actionOrder: ['extract text/tables', 'normalize fields with source references', 'create artifact/dry-run output', 'open app/browser only when the user asks to submit or upload'],
        verificationOrder: ['page/path references for extracted fields', 'confidence/unknown markers for low-quality OCR', 'sample-row validation before import/export'],
        recoveryPolicy: ['If OCR confidence is low, ask for a clearer file or human review.', 'If the target schema is ambiguous, produce a mapping preview first.', 'Never overwrite live data from extracted documents without approval.'],
        approvalCheckpoints: ['uploading documents', 'database import/write', 'exporting sensitive data', 'legal/financial conclusion', 'credential use'],
        stopConditions: ['structured extraction delivered', 'dry-run/mapping ready', 'approval required', 'file unreadable or missing'],
        recommendedTools: ['desktop.file_list', 'desktop.file_search', 'desktop.file_read', 'browser.dom_snapshot', 'browser.screenshot', 'approvals.request'],
        bridgeRequirements: ['file read/search capability', 'document/OCR or vision-capable app tool for scanned files'],
        maxBlindActions: 0,
      };
    case 'ops_console_control':
      return {
        id,
        label: 'Ops Console Read-First Control Loop',
        summary: 'For cloud, deploy, incident, and CI/CD work, diagnose read-only first and gate mutations.',
        observeFirst: ['repository/service/provider identity', 'recent deploy or workflow status', 'logs/alerts/status page', 'environment and blast radius'],
        actionOrder: ['read logs and status', 'inspect recent changes', 'prepare rollback/deploy/restart plan', 'execute one approved operation at a time'],
        verificationOrder: ['post-action logs/status checks', 'workflow/deploy result', 'health endpoint or preview check', 'incident timeline and rollback notes'],
        recoveryPolicy: ['Never deploy/rollback/restart from ambiguous service context.', 'If credentials or environment are missing, stop with exact blocker.', 'If a mutation fails, do not chain more mutations without re-observing state.'],
        approvalCheckpoints: ['deploy', 'rollback', 'restart', 'scale', 'secret/env changes', 'DNS changes', 'production database writes', 'incident status updates'],
        stopConditions: ['read-only diagnosis complete', 'approved mutation verified', 'approval required', 'provider/bridge missing', 'production risk unclear'],
        recommendedTools: ['code.inspect', 'verification.tests', 'browser.open_url', 'browser.dom_snapshot', 'desktop.window_state', 'approvals.request'],
        bridgeRequirements: ['repository/cloud integration or terminal bridge', 'user-owned provider credentials or session', 'approval channel for production mutations'],
        maxBlindActions: 0,
      };
    case 'file_readonly':
      return {
        id,
        label: 'Local File Workflow',
        summary: 'Search and read only the requested local files unless write access is explicitly approved.',
        observeFirst: ['desktop.file_list', 'desktop.file_search', 'desktop.file_stat', 'desktop.file_read'],
        actionOrder: ['Summarize/read requested files.', 'Use file write tools only for explicit user requests after write-scoped verification.', 'Prefer desktop.file_trash over permanent delete.', 'Use desktop.open_path only if the user wants the file opened locally.'],
        verificationOrder: ['Report path, byte cap/truncation, and match count.'],
        recoveryPolicy: ['If path is ambiguous, ask for root folder.', 'Never scan broad home directories without scope.'],
        approvalCheckpoints: ['opening files in apps', 'writing/deleting/moving files'],
        stopConditions: ['files found/read', 'path missing', 'permission missing'],
        recommendedTools: ['desktop.file_list', 'desktop.file_search', 'desktop.file_stat', 'desktop.file_read', 'desktop.file_rename', 'desktop.file_write_text', 'desktop.file_copy', 'desktop.file_trash', 'desktop.file_mkdir', 'desktop.open_path'],
        bridgeRequirements: ['local desktop bridge with file read permissions', 'write-scoped local file session grant before rename/move/delete/edit actions'],
        maxBlindActions: 0,
      };
    case 'terminal_agent_orchestration':
      return {
        id,
        label: 'Terminal Agent Orchestration',
        summary: 'Launch and coordinate CLI agents through bridges, then stream state back into chat/Office.',
        observeFirst: ['office.list_agents', 'bridge health for requested provider', 'current working directory and session count'],
        actionOrder: ['create sessions', 'send distinct prompts', 'poll status/output', 'route follow-up messages by session id or group'],
        verificationOrder: ['confirm each session started', 'show live status in Office', 'persist session memory and transcript summaries'],
        recoveryPolicy: ['If a CLI bridge fails, surface the exact command/permission blocker.', 'Do not retry launches in a tight loop.', 'Keep failed sessions separate from healthy sessions.'],
        approvalCheckpoints: ['launching terminal sessions', 'executing shell commands', 'writing files', 'sending prompts to many agents'],
        stopConditions: ['all requested sessions launched/queued', 'bridge missing', 'permission/config error'],
        recommendedTools: ['office.list_agents', 'messages.create', 'approvals.request'],
        bridgeRequirements: ['matching local bridge for Codex/Claude/Gemini/Cursor', 'CLI installed and readable config'],
        maxBlindActions: 0,
      };
    case 'human_verification_pause':
      return {
        id,
        label: 'Human Verification Pause',
        summary: 'Stop automation for CAPTCHA/MFA/bot checks and wait for the human.',
        observeFirst: ['browser.verification_state', 'browser.screenshot if the blocker is visual'],
        actionOrder: ['Do not click CAPTCHA/MFA/not-a-robot controls.', 'Tell the user exactly what to complete.', 'Resume only after user confirmation.'],
        verificationOrder: ['browser.verification_state after user confirms', 'browser.dom_snapshot to confirm normal page state'],
        recoveryPolicy: ['If the gate persists, do not bypass it.', 'Offer manual handoff or a different workflow.'],
        approvalCheckpoints: ['all bot verification, MFA, OTP, CAPTCHA, Cloudflare security checks'],
        stopConditions: ['human clears the gate', 'user cancels', 'site remains blocked'],
        recommendedTools: ['browser.verification_state', 'browser.screenshot', 'approvals.request'],
        bridgeRequirements: ['browser bridge or Browserbase visible session'],
        maxBlindActions: 0,
      };
    case 'hybrid_control_loop':
    default:
      return {
        id: 'hybrid_control_loop',
        label: 'Hybrid Computer/App Control Loop',
        summary: 'Coordinate browser, desktop, files, vault, and app tools with read-first sequencing.',
        observeFirst: ['read pipeline decision', 'inspect current app/browser/file state', 'check bridge readiness and verification gates'],
        actionOrder: ['complete read-only discovery', 'perform one reversible action at a time', 'pause before side effects'],
        verificationOrder: ['verify after each action using the same surface that observed it', 'persist run trace and blockers'],
        recoveryPolicy: ['If surface choice is wrong, switch once after observing state.', 'If two attempts fail, stop and report blocker.', 'Do not invent missing tools.'],
        approvalCheckpoints: ['credentials', 'desktop mutation', 'browser submission', 'publishing', 'file writes', 'payments', 'destructive actions'],
        stopConditions: ['task complete', 'approval required', 'bridge/capability missing', 'human verification required'],
        recommendedTools: ['integrations.list', 'approvals.request', 'browser.verification_state', 'desktop.window_state'],
        bridgeRequirements: ['required bridge or integration for selected surface'],
        maxBlindActions: 0,
      };
  }
}

export function buildComputerAppTaskStrategy(
  message: string,
  pipelineDecision?: UserTaskPipelineDecision | null,
): ComputerAppTaskStrategy | null {
  const decision = pipelineDecision || buildUserTaskPipelineDecision(message, { includeFallback: false });
  const text = String(message || '');
  if (textMatchesVerificationGate(text)) return baseStrategy('human_verification_pause');
  if (textMatchesAgentAssetAcquisition(text)) return baseStrategy('agent_asset_acquisition');
  if (textMatchesEngineeringCadApp(text)) return baseStrategy('engineering_cad_control');
  if (textMatchesBrowserFileTransfer(text)) return baseStrategy('browser_file_transfer');
  if (textMatchesCreativeLayoutApp(text)) return withDesignAppAutomationPlan(baseStrategy('creative_layout_control'), text);
  if (textMatchesAdobeCreativeCloudApp(text)) return withAdobeCreativeCloudProfile(baseStrategy('adobe_cc_control'), text);
  if (textMatchesCanvasApp(text)) return baseStrategy('desktop_canvas_vision');
  if (textMatchesUniversalAppControl(text)) return withGenericAppNavigator(baseStrategy('universal_app_control'), text);
  if (textMatchesLocalFileWorkflow(text)) return baseStrategy('file_readonly');
  if (textMatchesCredentialedBrowser(text)) return baseStrategy('credentialed_browser');

  const ids = [
    decision?.primary.id,
    ...(decision?.supporting.map((item) => item.id) || []),
  ].filter(Boolean) as UserTaskPipelineId[];

  for (const id of ids) {
    const mapped = PIPELINE_STRATEGY[id];
    if (mapped) {
      const strategy = baseStrategy(mapped);
      if (mapped === 'creative_layout_control') return withDesignAppAutomationPlan(strategy, text);
      if (mapped === 'universal_app_control') return withGenericAppNavigator(strategy, text);
      return mapped === 'adobe_cc_control' ? withAdobeCreativeCloudProfile(strategy, text) : strategy;
    }
  }
  if (!decision) return null;
  if (decision.primary.category === 'browser') return baseStrategy('browser_semantic');
  if (decision.primary.category === 'desktop') {
    const strategy = baseStrategy('desktop_semantic');
    return shouldUseGenericAppNavigator(text) ? withGenericAppNavigator(strategy, text) : strategy;
  }
  return null;
}

export function buildComputerAppTaskStrategyPromptBlock(
  message: string,
  pipelineDecision?: UserTaskPipelineDecision | null,
): string | null {
  const strategy = buildComputerAppTaskStrategy(message, pipelineDecision);
  if (!strategy) return null;
  return [
    '## Computer/App Execution Strategy',
    `Strategy: ${strategy.label} (${strategy.id})`,
    `Summary: ${strategy.summary}`,
    `Observe first: ${strategy.observeFirst.join(' | ')}`,
    `Action order: ${strategy.actionOrder.join(' | ')}`,
    `Verification: ${strategy.verificationOrder.join(' | ')}`,
    `Recovery: ${strategy.recoveryPolicy.join(' | ')}`,
    `Approval checkpoints: ${strategy.approvalCheckpoints.length ? strategy.approvalCheckpoints.join(' | ') : 'none for read-only work'}`,
    `Stop conditions: ${strategy.stopConditions.join(' | ')}`,
    `Bridge requirements: ${strategy.bridgeRequirements.join(' | ')}`,
    `Blind action budget: ${strategy.maxBlindActions}. Never perform blind clicks/typing when this is 0.`,
    strategy.id === 'universal_app_control' || shouldUseGenericAppNavigator(message)
      ? formatGenericAppNavigatorPromptBlock(message)
      : '',
    // Universal find-ladder + research-before-guess + buildout contract so the
    // live agent can find/research/act in any app, not just pre-configured ones.
    strategy.id === 'universal_app_control' || shouldUseGenericAppNavigator(message)
      ? buildAppAdapterGapPromptBlock(message)
      : '',
  ].filter(Boolean).join('\n');
}
