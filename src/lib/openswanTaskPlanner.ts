import type { AgenticCodingProfile } from './agenticCodingProfile';
import { classifyBrowserbaseWorkflow } from './browserbaseWorkflowIntent';
import { buildComputerAppExecutionReceiptPlan, type ComputerAppExecutionReceiptPlan } from './computerAppExecutionReceipts';
import { buildDesignAppAutomationPlan } from './designAppAutomation';
import {
  buildComputerAppGroundingPlan,
  buildComputerAppGroundingRunbook,
  buildComputerAppGroundingTrace,
  recommendComputerAppGroundingNextStep,
  type ComputerAppGroundingPlan,
  type ComputerAppGroundingRunbook,
  type ComputerAppGroundingNextStep,
  type ComputerAppGroundingTrace,
} from './computerAppGrounding';
import {
  buildComputerAppTaskStrategy,
  detectWordPressTrashPostIntent,
  type ComputerAppTaskStrategy,
} from './computerAppTaskStrategy';
import { detectAutomationVerificationGate } from './desktopAutomationSafety';
import { detectLocalComputerAwarenessIntent } from './localComputerAwarenessIntent';
import {
  getBestUserTaskPipeline,
  buildUserTaskPipelineDecision,
  type UserTaskPipelineDecision,
  summarizeUserTaskPipelineMatch,
  type UserTaskPipelineId,
  type UserTaskPipelineSummary,
} from './userTaskPipelines';
import { findAdobeCreativeCloudAppProfile } from './adobeCreativeCloudApps';
import { buildExecutionSurfacePlan, type ExecutionSurfacePlan } from './executionSurfaceRouter';
import { buildAgentRunLedgerPreview, type AgentRunLedgerPreview } from './agentRunLedger';
import type { ScenarioPolicy } from './scenarioPolicies';
import { classifyAgentFailure, type AgentFailureAssessment } from './agentFailureTaxonomy';

export type OpenSwanTaskKind = 'build' | 'review' | 'debug' | 'architect' | 'research' | 'automation' | 'general';
export type OpenSwanVerificationKind = 'typecheck' | 'tests' | 'lint' | 'preview' | 'manual_review' | 'security_review' | 'performance_review' | 'integration_review';
export type OpenSwanToolName =
  | 'workspace.create_room'
  | 'workspace.apply_artifacts'
  | 'workspace.open_preview'
  | 'browser.plan_task'
  | 'browser.open_url'
  | 'browser.dom_snapshot'
  | 'browser.wp_admin_source_intelligence'
  | 'browser.verification_state'
  | 'browser.click_role'
  | 'browser.fill_field'
  | 'browser.fill_credential_field'
  | 'browser.select_option'
  | 'browser.upload_file'
  | 'browser.press_key'
  | 'browser.screenshot'
  | 'browser.close'
  | 'code.inspect'
  | 'code.generate'
  | 'code.review'
  | 'verification.typecheck'
  | 'verification.tests'
  | 'verification.lint'
  | 'verification.preview'
  | 'search_memories'
  | 'save_memory'
  | 'fetch_url'
  | 'list_circle_members'
  | 'schedule_action'
  | 'wp.discover_types'
  | 'wp.list_posts'
  | 'wp.upload_media'
  | 'wp.create_slide'
  | 'wp.trash_post'
  | 'wp.update_post'
  | 'missions.list'
  | 'missions.create_task'
  | 'missions.complete_task'
  | 'github.list_repos'
  | 'github.read_file'
  | 'tasks.list'
  | 'tasks.get'
  | 'tasks.create'
  | 'tasks.update_status'
  | 'tasks.assign'
  | 'tasks.comment'
  | 'tasks.add_artifact'
  | 'goals.list'
  | 'goals.create'
  | 'goals.update_progress'
  | 'goals.update_status'
  | 'messages.list'
  | 'messages.create'
  | 'check_ins.list'
  | 'research.search'
  | 'research.save'
  | 'rooms.list'
  | 'rooms.create'
  | 'rooms.send_message'
  | 'rooms.list_tasks'
  | 'rooms.create_task'
  | 'rooms.create_file'
  | 'rooms.update_file'
  | 'rooms.list_files'
  | 'rooms.read_file'
  | 'integrations.list'
  | 'office.list_agents'
  | 'agent.codex_acquire_asset'
  | 'agent.recover_failed_task'
  | 'agent.build_app_capability'
  | 'approvals.list'
  | 'approvals.request'
  | 'approvals.resolve'
  | 'vault.list'
  | 'vault.find'
  | 'vault.grants'
  | 'vault.grant'
  | 'vault.revoke'
  | 'vault.runbook'
  | 'vault.resolve_for_task'
  | 'desktop.launch_app'
  | 'desktop.focus_app'
  | 'desktop.type_text'
  | 'desktop.paste_text'
  | 'desktop.press_keys'
  | 'desktop.menu_click'
  | 'desktop.indesign_document_status'
  | 'desktop.indesign_text_inventory'
  | 'desktop.indesign_set_layer_state'
  | 'desktop.indesign_batch_find_change'
  | 'desktop.indesign_batch_update_text_layers'
  | 'desktop.indesign_update_text_layer'
  | 'desktop.indesign_relink_asset'
  | 'desktop.indesign_package_document'
  | 'desktop.indesign_export_proof'
  | 'desktop.photoshop_document_status'
  | 'desktop.photoshop_layer_inventory'
  | 'desktop.photoshop_set_layer_state'
  | 'desktop.photoshop_update_text_layer'
  | 'desktop.photoshop_place_asset'
  | 'desktop.photoshop_export_proof'
  | 'desktop.list_running_apps'
  | 'desktop.list_browser_tabs'
  | 'desktop.window_state'
  | 'desktop.clipboard'
  | 'desktop.clipboard_write'
  | 'desktop.clipboard_clear'
  | 'desktop.file_list'
  | 'desktop.file_read'
  | 'desktop.file_search'
  | 'desktop.file_stat'
  | 'desktop.file_rename'
  | 'desktop.file_write_text'
  | 'desktop.file_copy'
  | 'desktop.file_trash'
  | 'desktop.file_mkdir'
  | 'desktop.shortcuts_list'
  | 'desktop.shortcuts_run'
  | 'desktop.window_manage'
  | 'desktop.mouse_move'
  | 'desktop.mouse_click'
  | 'desktop.mouse_down'
  | 'desktop.mouse_up'
  | 'desktop.mouse_drag'
  | 'desktop.mouse_scroll'
  | 'desktop.wait_for_app'
  | 'desktop.screenshot'
  | 'desktop.open_url'
  | 'desktop.open_path'
  | 'desktop.click_at'
  | 'desktop.screen_size'
  | 'desktop.read_a11y_tree'
  | 'desktop.click_element'
  | 'desktop.set_element_value';

export type OpenSwanVerificationCheck = {
  id: string;
  label: string;
  kind: OpenSwanVerificationKind;
  required: boolean;
  reason: string;
};

export type OpenSwanToolPlanItem = {
  tool: OpenSwanToolName;
  reason: string;
  priority: 'high' | 'medium' | 'low';
};

export type OpenSwanTaskPlan = {
  kind: OpenSwanTaskKind;
  profile: AgenticCodingProfile;
  summary: string;
  pipeline?: UserTaskPipelineSummary | null;
  pipelineDecision?: UserTaskPipelineDecision | null;
  scenarioPolicy?: ScenarioPolicy | null;
  surfacePlan?: ExecutionSurfacePlan | null;
  ledgerPreview?: AgentRunLedgerPreview | null;
  failureAssessment?: AgentFailureAssessment | null;
  computerAppStrategy?: ComputerAppTaskStrategy | null;
  computerAppGrounding?: ComputerAppGroundingPlan | null;
  computerAppGroundingRunbook?: ComputerAppGroundingRunbook | null;
  computerAppGroundingNextStep?: ComputerAppGroundingNextStep | null;
  computerAppGroundingTrace?: ComputerAppGroundingTrace | null;
  computerAppExecutionReceipts?: ComputerAppExecutionReceiptPlan | null;
  verification: OpenSwanVerificationCheck[];
  recommendedTools: OpenSwanToolPlanItem[];
};

const BUILD_RE = /\b(build|create|implement|ship|add|generate|make|write|code|component|screen|page|feature|endpoint|api|file)\b/i;
const REVIEW_RE = /\b(review|audit|assess|critique|look over|check|inspect|quality)\b/i;
const DEBUG_RE = /\b(debug|fix|broken|not working|error|bug|crash|exception|trace|regression)\b/i;
const ARCH_RE = /\b(architect|architecture|structure|boundary|pattern|dependency|design|refactor|split|modular)\b/i;
const RESEARCH_RE = /\b(research|compare|investigate|deep dive|tradeoff|best practice|options|approach)\b/i;
const AUTOMATION_RE = /\b(automate|workflow|task|pipeline|schedule|agent|orchestrate|runbook)\b/i;
const PREVIEW_RE = /\b(html|css|landing page|webpage|preview|ui|screen|room|sandbox)\b/i;
const BROWSER_RE = /\b(browser|website|web site|webpage|site|login|dashboard|click|fill|form|submit|data entry|scrape|extract data|web data retrieval|structured data|navigate|open url|browserbase|stagehand|computer[- ]use)\b/i;
const DESKTOP_RE = /\b(desktop|computer|native app|window|finder|terminal|chrome|safari|slack|figma|indesign|photoshop|illustrator|notion|excel|word|zoom|cursor|visual studio code|vscode|launch app|open app|focus app|keystroke|keyboard|screen shot|screenshot|click at|auto\s*cad|autocad|cad|fusion\s*360|solid\s*works|solidworks|matlab|mathworks|simulink|simscape|sketch\s*up|sketchup|freecad|librecad|qcad|rhino|revit|civil\s*3d|inventor|onshape|dwg|dxf|mlx|slx|engineering drawing|floor plan|technical drawing)\b/i;
const BOT_VERIFICATION_RE = /\b(captcha|recaptcha|hcaptcha|turnstile|not a robot|human verification|bot verification|security check|cloudflare|2fa|mfa|otp|verification code)\b/i;
const VAULT_RE = /\b(vault|credential|credentials|password|passwords|saved login|login information|username|secret|secrets|access to|grant access|revoke access)\b/i;
const TEST_RE = /\b(tests?|specs?|coverage|assert|jest|vitest|playwright|cypress)\b/i;
const LINT_RE = /\b(lint|eslint|format|prettier)\b/i;
const SECURITY_RE = /\b(security|vulnerab|secret|auth|xss|injection|owasp)\b/i;
const PERF_RE = /\b(performance|slow|fast|latency|render|bundle|memory)\b/i;
const TASKS_RE = /\b(task|tasks|todo|to do|kanban|backlog|in progress|peer review|review|approved|done|assign)\b/i;
const GOALS_RE = /\b(goal|goals|okr|objective|key result|north star)\b/i;
const MISSIONS_RE = /\b(mission|missions|proof of work|pow)\b/i;
const MESSAGES_RE = /\b(chat|messages|message history|thread|conversation)\b/i;
const CHECKINS_RE = /\b(check-?in|check in|daily update|standup|streak)\b/i;
const RESEARCH_DOC_RE = /\b(research doc|research docs|research corpus|digest|findings|paper|report)\b/i;
const ROOMS_RE = /\b(room|rooms|workspace|project files|room files)\b/i;
const GITHUB_RE = /\b(github|repo|repository|branch|pull request|pr|read file)\b/i;
const INTEGRATIONS_RE = /\b(integration|integrations|connector|browserbase|figma|slack|teams|github app|provider)\b/i;
const OFFICE_RE = /\b(office agent|office agents|published agents|who is active|active agents|circle office)\b/i;
const APPROVAL_RE = /\b(approval|approvals|approve|approved|reject|rejected|needs approval|pending approval)\b/i;
const BROWSER_FILE_TRANSFER_RE = /\b(upload|attach|choose file|select file|import|download|export|save (?:this )?(?:page|webpage|site|report|csv|pdf)|save as pdf|print to pdf)\b/i;
const LOCAL_FILE_SCOPE_RE = /\b(file|folder|directory|downloads?|documents?|desktop|image|photo|pdf|csv|spreadsheet|sheet|xlsx?|indd|psd|png|jpe?g)\b/i;
const AGENT_ASSET_ACQUISITION_RE = /\b(codex|agent|terminal agent|attached agent|download whatever|whatever (?:it|they) needs?|missing (?:asset|file|dependency|package|resource)|needed (?:asset|file|dependency|package|resource)|required (?:asset|file|dependency|package|resource)|download (?:assets?|dependencies|packages?|resources?))\b/i;
const AGENT_FAILURE_RECOVERY_RE = /\b(failed|failure|blocked|stopped at step|could not|didn'?t work|not doing anything|figure out why|why it failed|fix why|recover failed|retry failed|task failed)\b/i;

const PIPELINE_OPEN_SWAN_TOOLS: Partial<Record<UserTaskPipelineId, OpenSwanToolName[]>> = {
  live_research: ['research.search', 'fetch_url', 'research.save'],
  knowledge_search: ['research.search', 'search_memories'],
  memory_second_brain: ['search_memories', 'save_memory'],
  browser_data_retrieval: ['browser.plan_task', 'browser.open_url', 'browser.dom_snapshot', 'browser.screenshot'],
  browser_form_submission: ['browser.plan_task', 'browser.verification_state', 'browser.dom_snapshot', 'browser.fill_field', 'browser.fill_credential_field', 'browser.upload_file', 'vault.resolve_for_task', 'approvals.request'],
  browser_navigation: ['browser.plan_task', 'browser.open_url', 'browser.dom_snapshot', 'browser.click_role', 'browser.screenshot'],
  desktop_awareness: ['desktop.list_browser_tabs', 'desktop.window_state', 'desktop.list_running_apps', 'desktop.clipboard'],
  bridge_troubleshooting: ['desktop.list_browser_tabs', 'desktop.window_state', 'desktop.list_running_apps', 'integrations.list'],
  desktop_app_control: ['desktop.list_running_apps', 'desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_find_change', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_update_text_layer', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_update_text_layer', 'desktop.photoshop_place_asset', 'desktop.photoshop_export_proof', 'desktop.screenshot', 'desktop.click_element', 'desktop.set_element_value', 'desktop.menu_click', 'desktop.paste_text'],
  local_files: ['desktop.file_list', 'desktop.file_read', 'desktop.file_search', 'desktop.file_stat', 'desktop.file_rename', 'desktop.file_write_text', 'desktop.file_copy', 'desktop.file_trash', 'desktop.file_mkdir', 'desktop.open_path'],
  terminal_agents: ['office.list_agents', 'messages.create', 'approvals.request'],
  vault_credentials: ['vault.find', 'vault.grants', 'vault.runbook', 'vault.resolve_for_task', 'approvals.request'],
  wordpress_cms: ['wp.discover_types', 'wp.list_posts', 'browser.wp_admin_source_intelligence', 'wp.upload_media', 'wp.create_slide', 'wp.update_post', 'vault.resolve_for_task', 'vault.runbook', 'browser.plan_task', 'browser.open_url', 'browser.verification_state', 'browser.dom_snapshot', 'browser.fill_credential_field', 'browser.upload_file', 'approvals.request'],
  website_platform_admin: ['vault.resolve_for_task', 'browser.plan_task', 'browser.verification_state', 'browser.dom_snapshot', 'browser.fill_credential_field', 'browser.fill_field', 'browser.upload_file', 'browser.click_role', 'approvals.request'],
  coding_build: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests'],
  debug_fix: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests'],
  code_review: ['code.review', 'verification.typecheck', 'verification.tests', 'verification.lint'],
  security_privacy: ['code.review', 'integrations.list', 'vault.grants', 'verification.tests'],
  performance_cost: ['code.inspect', 'integrations.list', 'office.list_agents', 'verification.typecheck'],
  creative_image_design: ['desktop.launch_app', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_export_proof', 'desktop.screenshot', 'workspace.open_preview', 'workspace.apply_artifacts'],
  creative_layout_design: ['desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'desktop.launch_app', 'desktop.focus_app', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_batch_find_change', 'desktop.indesign_update_text_layer', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_update_text_layer', 'desktop.photoshop_place_asset', 'desktop.photoshop_export_proof', 'desktop.screenshot', 'approvals.request'],
  adobe_creative_cloud: ['desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'desktop.launch_app', 'desktop.focus_app', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.menu_click', 'desktop.press_keys', 'office.list_agents', 'research.search', 'agent.build_app_capability', 'approvals.request'],
  tasks_missions: ['tasks.list', 'tasks.create', 'tasks.assign', 'missions.list', 'check_ins.list'],
  office_agents: ['office.list_agents', 'search_memories', 'messages.create'],
  integrations_models: ['integrations.list', 'code.inspect', 'verification.tests'],
  schedule_automation: ['schedule_action', 'approvals.request', 'office.list_agents'],
  governance_approvals: ['approvals.list', 'approvals.request', 'approvals.resolve'],
  human_verification: ['browser.verification_state', 'approvals.request'],
  customer_support_crm: ['browser.plan_task', 'browser.dom_snapshot', 'vault.resolve_for_task', 'approvals.request', 'tasks.create'],
  sales_leads_outreach: ['browser.plan_task', 'browser.dom_snapshot', 'research.search', 'vault.resolve_for_task', 'approvals.request'],
  analytics_reporting: ['desktop.file_read', 'browser.dom_snapshot', 'research.search', 'rooms.create_file'],
  meetings_calendar_email: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.type_text', 'approvals.request'],
  data_import_export: ['desktop.file_read', 'desktop.file_search', 'browser.dom_snapshot', 'browser.upload_file', 'browser.screenshot', 'approvals.request'],
  finance_billing: ['browser.plan_task', 'browser.dom_snapshot', 'vault.resolve_for_task', 'approvals.request'],
  document_intelligence: ['desktop.file_search', 'desktop.file_read', 'browser.screenshot', 'approvals.request'],
  qa_testing: ['browser.plan_task', 'browser.open_url', 'browser.dom_snapshot', 'browser.screenshot', 'verification.tests'],
  it_support_ops: ['desktop.window_state', 'desktop.read_a11y_tree', 'browser.dom_snapshot', 'vault.resolve_for_task', 'approvals.request'],
  compliance_monitoring: ['research.search', 'fetch_url', 'rooms.create_file', 'approvals.request'],
  hr_onboarding: ['tasks.create', 'missions.create_task', 'schedule_action', 'approvals.request'],
  marketing_campaigns: ['research.search', 'browser.dom_snapshot', 'rooms.create_file', 'approvals.request'],
  workflow_recording_replay: ['browser.plan_task', 'browser.dom_snapshot', 'desktop.screenshot', 'schedule_action', 'approvals.request'],
  travel_booking: ['browser.plan_task', 'browser.open_url', 'browser.dom_snapshot', 'vault.resolve_for_task', 'approvals.request'],
  procurement_shopping: ['browser.plan_task', 'browser.dom_snapshot', 'vault.resolve_for_task', 'approvals.request'],
  cloud_devops: ['code.inspect', 'browser.open_url', 'browser.dom_snapshot', 'verification.tests', 'approvals.request'],
  social_community: ['browser.plan_task', 'browser.dom_snapshot', 'desktop.read_a11y_tree', 'approvals.request'],
  inbox_notifications: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.type_text', 'tasks.create', 'approvals.request'],
  learning_training: ['research.search', 'rooms.create_file', 'save_memory'],
  high_stakes_advice: ['research.search', 'fetch_url'],
};

const STRATEGY_OPEN_SWAN_TOOLS: Partial<Record<ComputerAppTaskStrategy['id'], OpenSwanToolName[]>> = {
  browser_semantic: ['browser.open_url', 'browser.dom_snapshot', 'browser.verification_state', 'browser.click_role', 'browser.fill_field', 'browser.press_key', 'browser.screenshot'],
  credentialed_browser: ['vault.resolve_for_task', 'vault.runbook', 'vault.grants', 'browser.verification_state', 'browser.dom_snapshot', 'browser.fill_credential_field', 'browser.fill_field', 'browser.upload_file', 'approvals.request'],
  approval_sensitive_browser: ['browser.open_url', 'browser.dom_snapshot', 'browser.verification_state', 'browser.click_role', 'browser.fill_credential_field', 'browser.fill_field', 'browser.upload_file', 'browser.screenshot', 'vault.resolve_for_task', 'approvals.request'],
  browser_file_transfer: ['desktop.file_search', 'desktop.file_stat', 'desktop.file_read', 'browser.open_url', 'browser.verification_state', 'browser.dom_snapshot', 'browser.upload_file', 'browser.click_role', 'browser.screenshot', 'approvals.request'],
  agent_asset_acquisition: ['office.list_agents', 'agent.codex_acquire_asset', 'desktop.file_search', 'desktop.file_stat', 'desktop.file_read', 'approvals.request'],
  desktop_readonly: ['desktop.list_browser_tabs', 'desktop.window_state', 'desktop.list_running_apps', 'desktop.clipboard', 'desktop.file_list'],
  desktop_semantic: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_find_change', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_update_text_layer', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_update_text_layer', 'desktop.photoshop_place_asset', 'desktop.photoshop_export_proof', 'desktop.click_element', 'desktop.set_element_value', 'desktop.menu_click', 'desktop.type_text', 'desktop.paste_text', 'desktop.press_keys', 'desktop.screenshot'],
  productivity_app_control: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.click_element', 'desktop.set_element_value', 'desktop.menu_click', 'desktop.type_text', 'desktop.paste_text', 'desktop.press_keys', 'desktop.screenshot', 'approvals.request'],
  desktop_canvas_vision: ['desktop.launch_app', 'desktop.focus_app', 'desktop.screenshot', 'desktop.screen_size', 'desktop.read_a11y_tree', 'desktop.click_element', 'desktop.menu_click', 'desktop.click_at', 'desktop.mouse_down', 'desktop.mouse_up', 'desktop.mouse_drag', 'desktop.press_keys'],
  creative_layout_control: ['desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'desktop.launch_app', 'desktop.focus_app', 'desktop.indesign_document_status', 'desktop.indesign_text_inventory', 'desktop.indesign_set_layer_state', 'desktop.indesign_batch_update_text_layers', 'desktop.indesign_batch_find_change', 'desktop.indesign_update_text_layer', 'desktop.indesign_relink_asset', 'desktop.indesign_package_document', 'desktop.indesign_export_proof', 'desktop.photoshop_document_status', 'desktop.photoshop_layer_inventory', 'desktop.photoshop_set_layer_state', 'desktop.photoshop_update_text_layer', 'desktop.photoshop_place_asset', 'desktop.photoshop_export_proof', 'desktop.read_a11y_tree', 'desktop.menu_click', 'desktop.screenshot', 'approvals.request'],
  adobe_cc_control: ['desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'desktop.launch_app', 'desktop.focus_app', 'desktop.window_state', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.screen_size', 'desktop.menu_click', 'desktop.click_element', 'desktop.set_element_value', 'desktop.type_text', 'desktop.paste_text', 'desktop.press_keys', 'office.list_agents', 'research.search', 'agent.build_app_capability', 'approvals.request'],
  engineering_cad_control: ['desktop.list_running_apps', 'desktop.window_state', 'desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.screen_size', 'desktop.menu_click', 'desktop.click_element', 'desktop.press_keys', 'desktop.type_text', 'desktop.paste_text', 'desktop.file_search', 'desktop.file_stat', 'desktop.open_path', 'research.search', 'fetch_url', 'agent.build_app_capability', 'approvals.request'],
  universal_app_control: ['integrations.list', 'office.list_agents', 'research.search', 'agent.build_app_capability', 'desktop.list_running_apps', 'desktop.window_state', 'desktop.launch_app', 'desktop.focus_app', 'desktop.read_a11y_tree', 'desktop.screenshot', 'desktop.screen_size', 'desktop.menu_click', 'desktop.click_element', 'desktop.set_element_value', 'desktop.type_text', 'desktop.paste_text', 'desktop.press_keys', 'approvals.request'],
  document_data_workbench: ['desktop.file_list', 'desktop.file_search', 'desktop.file_read', 'browser.dom_snapshot', 'browser.screenshot', 'approvals.request'],
  ops_console_control: ['code.inspect', 'verification.tests', 'browser.open_url', 'browser.dom_snapshot', 'desktop.window_state', 'approvals.request'],
  file_readonly: ['desktop.file_list', 'desktop.file_search', 'desktop.file_read', 'desktop.open_path'],
  terminal_agent_orchestration: ['office.list_agents', 'messages.create', 'approvals.request'],
  human_verification_pause: ['browser.verification_state', 'browser.screenshot', 'approvals.request'],
  hybrid_control_loop: ['integrations.list', 'approvals.request', 'browser.verification_state', 'desktop.window_state'],
};

const DESIGN_APP_OPEN_SWAN_TOOLS = new Set<OpenSwanToolName>([
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.open_path',
  'desktop.launch_app',
  'desktop.focus_app',
  'desktop.indesign_document_status',
  'desktop.indesign_text_inventory',
  'desktop.indesign_set_layer_state',
  'desktop.indesign_batch_update_text_layers',
  'desktop.indesign_batch_find_change',
  'desktop.indesign_update_text_layer',
  'desktop.indesign_relink_asset',
  'desktop.indesign_package_document',
  'desktop.indesign_export_proof',
  'desktop.photoshop_document_status',
  'desktop.photoshop_layer_inventory',
  'desktop.photoshop_set_layer_state',
  'desktop.photoshop_update_text_layer',
  'desktop.photoshop_place_asset',
  'desktop.photoshop_export_proof',
  'desktop.read_a11y_tree',
  'desktop.menu_click',
  'desktop.screenshot',
  'approvals.request',
]);

function designAppToolPriority(tool: string): OpenSwanToolPlanItem['priority'] {
  if (/document_status|text_inventory|layer_inventory|file_search|file_stat|approvals/.test(tool)) return 'high';
  if (/batch|update_text|relink|place_asset|export_proof|package_document/.test(tool)) return 'high';
  return 'medium';
}

function inferTaskKind(message: string, profile: AgenticCodingProfile): OpenSwanTaskKind {
  if (profile === 'review') return 'review';
  if (profile === 'debug') return 'debug';
  if (profile === 'architect') return 'architect';
  if (profile === 'research') return 'research';
  if (profile === 'design') return PREVIEW_RE.test(message) ? 'build' : 'architect';
  if (profile === 'support') return DEBUG_RE.test(message) ? 'debug' : 'general';
  if (profile === 'senior' && BUILD_RE.test(message)) return 'build';
  if (REVIEW_RE.test(message)) return 'review';
  if (DEBUG_RE.test(message)) return 'debug';
  if (ARCH_RE.test(message)) return 'architect';
  if (RESEARCH_RE.test(message)) return 'research';
  if (AUTOMATION_RE.test(message)) return 'automation';
  if (BUILD_RE.test(message)) return 'build';
  return 'general';
}

function buildVerification(
  kind: OpenSwanTaskKind,
  message: string,
  entities?: import('./messageEntityExtractor').MessageEntities,
): OpenSwanVerificationCheck[] {
  const checks: OpenSwanVerificationCheck[] = [];

  if (kind === 'build') {
    checks.push(
      { id: 'typecheck', label: 'Typecheck changed code', kind: 'typecheck', required: true, reason: 'Generated or changed code should compile cleanly.' },
      { id: 'integration', label: 'Check integration boundaries', kind: 'integration_review', required: true, reason: 'New code should fit current app architecture.' },
    );
    if (TEST_RE.test(message) || /feature|api|endpoint|logic|bug/i.test(message)) {
      checks.push({ id: 'tests', label: 'Run or define test coverage', kind: 'tests', required: true, reason: 'Behavioral changes need executable proof or test guidance.' });
    }
    if (PREVIEW_RE.test(message)) {
      checks.push({ id: 'preview', label: 'Preview generated UI in sandbox', kind: 'preview', required: true, reason: 'UI work should be validated visually.' });
    }
    if (LINT_RE.test(message) || /style|clean/i.test(message)) {
      checks.push({ id: 'lint', label: 'Check lint/format expectations', kind: 'lint', required: false, reason: 'Style issues should be caught before handoff.' });
    }
  }

  if (kind === 'review') {
    checks.push({ id: 'manual-review', label: 'Produce severity-ranked findings', kind: 'manual_review', required: true, reason: 'Review work must prioritize correctness and risk.' });
    checks.push({ id: 'integration-review', label: 'Check regressions and missing tests', kind: 'integration_review', required: true, reason: 'A strong review must call out integration gaps.' });
  }

  if (kind === 'debug') {
    checks.push({ id: 'root-cause', label: 'Identify likely root cause', kind: 'integration_review', required: true, reason: 'Debugging should not stop at symptom-level patches.' });
    checks.push({ id: 'tests', label: 'Define regression check', kind: 'tests', required: true, reason: 'Fixes should include a way to prove the issue stays fixed.' });
    if (entities?.stackTraces.length) {
      checks.push({ id: 'typecheck', label: 'Typecheck the likely fix path', kind: 'typecheck', required: true, reason: 'Stack traces usually imply code-path changes that should compile cleanly after the fix.' });
    }
  }

  if (kind === 'architect') {
    checks.push({ id: 'architecture', label: 'Review module boundaries and coupling', kind: 'integration_review', required: true, reason: 'Architecture work must evaluate long-term integration quality.' });
  }

  if (kind === 'research') {
    checks.push({ id: 'evidence', label: 'Ground conclusions in evidence', kind: 'manual_review', required: true, reason: 'Research work should distinguish findings from unsupported opinion.' });
    checks.push({ id: 'tradeoffs', label: 'State tradeoffs and recommendation', kind: 'integration_review', required: true, reason: 'Research should end in a decision-ready recommendation.' });
  }

  if (SECURITY_RE.test(message)) {
    checks.push({ id: 'security', label: 'Perform security review', kind: 'security_review', required: true, reason: 'Security-sensitive work needs explicit review.' });
  }

  if (PERF_RE.test(message)) {
    checks.push({ id: 'performance', label: 'Review likely performance impact', kind: 'performance_review', required: true, reason: 'Performance-sensitive work needs explicit validation.' });
  }

  if (checks.length === 0) {
    checks.push({ id: 'manual', label: 'Manual quality review', kind: 'manual_review', required: false, reason: 'General requests still benefit from a final quality pass.' });
  }

  const deduped = new Map<string, OpenSwanVerificationCheck>();
  for (const check of checks) {
    if (!deduped.has(check.kind)) deduped.set(check.kind, check);
  }
  return Array.from(deduped.values());
}

function buildRecommendedTools(kind: OpenSwanTaskKind, message: string, entities?: import('./messageEntityExtractor').MessageEntities): OpenSwanToolPlanItem[] {
  const browserbaseWorkflow = classifyBrowserbaseWorkflow(message);
  const localComputerIntent = detectLocalComputerAwarenessIntent(message);
  const verificationGate = detectAutomationVerificationGate(message);
  const pipelineMatch = getBestUserTaskPipeline(message, { includeFallback: false });
  const strategy = buildComputerAppTaskStrategy(message);
  const wantsWordPressTrashPost = detectWordPressTrashPostIntent(message);
  const tools: OpenSwanToolPlanItem[] = [
    { tool: 'code.inspect', reason: 'Inspect surrounding code and current context before acting.', priority: 'high' },
  ];

  if (wantsWordPressTrashPost) {
    tools.push(
      { tool: 'wp.discover_types', reason: 'Discover WordPress post types before trashing posts, pages, or custom post type items.', priority: 'high' },
      { tool: 'wp.list_posts', reason: 'List candidate WordPress posts/pages/CPT items so the trash target is exact before approval.', priority: 'high' },
      { tool: 'wp.trash_post', reason: 'Move the approved WordPress post, page, or DI Slide target to trash instead of using a generic update path.', priority: 'high' },
      { tool: 'approvals.request', reason: 'Gate destructive WordPress content trash/archive/remove actions behind explicit user approval.', priority: 'high' },
    );
  }

  if (pipelineMatch) {
    for (const tool of PIPELINE_OPEN_SWAN_TOOLS[pipelineMatch.pipeline.id] || []) {
      tools.push({
        tool,
        reason: `Selected by ${pipelineMatch.pipeline.title} pipeline.`,
        priority: pipelineMatch.confidence >= 0.7 ? 'high' : 'medium',
      });
    }
  }

  if (strategy) {
    if (strategy.recommendedTools.includes('browser.wp_admin_source_intelligence')) {
      tools.push({
        tool: 'browser.wp_admin_source_intelligence',
        reason: `Use bounded redacted WordPress admin source facts before ${strategy.label} UI decisions.`,
        priority: 'high',
      });
    }
    for (const tool of STRATEGY_OPEN_SWAN_TOOLS[strategy.id] || []) {
      tools.push({
        tool,
        reason: `Required by ${strategy.label}: ${strategy.summary}`,
        priority: strategy.approvalCheckpoints.length > 0 ? 'high' : 'medium',
      });
    }
  }

  const designPlan = buildDesignAppAutomationPlan(message);
  if (designPlan) {
    for (const tool of designPlan.recommendedTools) {
      if (!DESIGN_APP_OPEN_SWAN_TOOLS.has(tool as OpenSwanToolName)) continue;
      tools.push({
        tool: tool as OpenSwanToolName,
        reason: `${designPlan.appName} ${designPlan.taskKind} plan requires ${designPlan.operations.join(', ')} with app-native inventory, approval gates, and proof verification.`,
        priority: designAppToolPriority(tool),
      });
    }
  }

  if (AGENT_ASSET_ACQUISITION_RE.test(message)) {
    tools.push(
      { tool: 'office.list_agents', reason: 'Find an attached managed Codex terminal session before delegating asset acquisition.', priority: 'high' },
      { tool: 'agent.codex_acquire_asset', reason: 'Ask Codex to fetch, generate, install, or prepare required assets into a scoped output folder with a manifest.', priority: 'high' },
      { tool: 'desktop.file_search', reason: 'Verify whether the needed asset already exists and locate Codex output files.', priority: 'high' },
      { tool: 'desktop.file_stat', reason: 'Verify acquired artifacts before using them in browser or desktop workflows.', priority: 'high' },
      { tool: 'approvals.request', reason: 'Gate network downloads, package installs, repo clones, generated assets, and local file writes.', priority: 'high' },
    );
  }

  const adobeProfile = findAdobeCreativeCloudAppProfile(message);
  if (adobeProfile && adobeProfile.id !== 'adobe_indesign' && adobeProfile.id !== 'adobe_photoshop') {
    tools.push(
      { tool: 'desktop.file_search', reason: `Resolve the exact ${adobeProfile.appName} source file, linked assets, or output folder before launch.`, priority: 'high' },
      { tool: 'desktop.file_stat', reason: `Verify the target ${adobeProfile.appName} source/output path before control.`, priority: 'high' },
      { tool: 'desktop.launch_app', reason: `Launch or focus ${adobeProfile.appName} through the desktop bridge.`, priority: 'high' },
      { tool: 'desktop.window_state', reason: `Confirm the active ${adobeProfile.appName} window/document before action.`, priority: 'high' },
      { tool: 'desktop.read_a11y_tree', reason: `Read ${adobeProfile.appName} menus, panels, and controls before semantic desktop actions.`, priority: 'medium' },
      { tool: 'desktop.screenshot', reason: `Capture visual ${adobeProfile.appName} state for proof and grounding.`, priority: 'medium' },
      { tool: 'agent.build_app_capability', reason: `Build or reuse the smallest ${adobeProfile.appName} app-native adapter when generic desktop controls are not enough.`, priority: 'high' },
      { tool: 'approvals.request', reason: 'Gate Adobe app file mutations, exports, renders, generative actions, scripts, and overwrites behind approval.', priority: 'high' },
    );
  }

  const failureAssessment = classifyAgentFailure(message);
  if (failureAssessment.failureClass !== 'unknown' || AGENT_FAILURE_RECOVERY_RE.test(message)) {
    tools.push(
      { tool: 'office.list_agents', reason: 'Find an attached managed Codex session before delegating failed-task diagnosis or repair.', priority: 'high' },
      { tool: 'agent.recover_failed_task', reason: failureAssessment.failureClass === 'unknown' ? 'Ask a connected agent to diagnose why the task failed and return a safe retry/fix path.' : `Classified failure as ${failureAssessment.failureClass}; delegate bounded recovery to a connected agent.`, priority: 'high' },
      { tool: 'save_memory', reason: 'Store durable failure/recovery lessons for this user and circle so future runs avoid the same issue.', priority: 'medium' },
    );
  }

  if (localComputerIntent.route) {
    switch (localComputerIntent.kind) {
      case 'browser_tabs':
        tools.push({ tool: 'desktop.list_browser_tabs', reason: 'Read local browser tab titles and URLs through the desktop bridge before using remote browser automation.', priority: 'high' });
        break;
      case 'running_apps':
        tools.push({ tool: 'desktop.list_running_apps', reason: 'List foreground native apps through the local desktop bridge.', priority: 'high' });
        break;
      case 'window_state':
      case 'screen_state':
        tools.push({ tool: 'desktop.window_state', reason: 'Read the active window and visible desktop state before taking action.', priority: 'high' });
        if (localComputerIntent.kind === 'screen_state') tools.push({ tool: 'desktop.screenshot', reason: 'Capture the screen when the user asks what is visible.', priority: 'medium' });
        break;
      case 'clipboard':
        tools.push({ tool: 'desktop.clipboard', reason: 'Read the local clipboard through the desktop bridge.', priority: 'high' });
        break;
      case 'clipboard_write':
        tools.push({ tool: 'desktop.clipboard_write', reason: 'Write the requested text to the local clipboard.', priority: 'high' });
        break;
      case 'clipboard_clear':
        tools.push({ tool: 'desktop.clipboard_clear', reason: 'Clear the local clipboard when explicitly requested.', priority: 'high' });
        break;
      case 'launch_app':
        tools.push({ tool: 'desktop.launch_app', reason: 'Launch the requested native app through the desktop bridge.', priority: 'high' });
        tools.push({ tool: 'desktop.wait_for_app', reason: 'Wait for the launched app before follow-up actions.', priority: 'medium' });
        break;
      case 'focus_app':
        tools.push({ tool: 'desktop.focus_app', reason: 'Focus the requested native app through the desktop bridge.', priority: 'high' });
        break;
      case 'open_url':
        tools.push({ tool: 'desktop.open_url', reason: 'Open the requested URL in the user desktop browser instead of a remote Browserbase session.', priority: 'high' });
        break;
      case 'open_path':
        tools.push({ tool: 'desktop.open_path', reason: 'Open the requested local file or folder.', priority: 'high' });
        break;
      case 'file_list':
        tools.push({ tool: 'desktop.file_list', reason: 'List files from the requested local folder.', priority: 'high' });
        break;
      case 'file_read':
        tools.push({ tool: 'desktop.file_read', reason: 'Read the requested local file.', priority: 'high' });
        break;
      case 'file_search':
        tools.push({ tool: 'desktop.file_search', reason: 'Search local files under the requested folder.', priority: 'high' });
        break;
      case 'shortcuts_list':
        tools.push({ tool: 'desktop.shortcuts_list', reason: 'List available Apple Shortcuts.', priority: 'high' });
        break;
      case 'shortcut_run':
        tools.push({ tool: 'desktop.shortcuts_run', reason: 'Run the named Apple Shortcut after explicit user request.', priority: 'high' });
        break;
      case 'a11y_tree':
        tools.push({ tool: 'desktop.read_a11y_tree', reason: 'Read clickable accessibility elements before choosing a UI target.', priority: 'high' });
        tools.push({ tool: 'desktop.screenshot', reason: 'Capture visible app state before selecting UI elements.', priority: 'medium' });
        break;
      case 'semantic_click':
        tools.push(
          { tool: 'desktop.read_a11y_tree', reason: 'Find the named app control semantically before clicking.', priority: 'high' },
          { tool: 'desktop.click_element', reason: 'Click the matched accessibility element instead of guessing coordinates.', priority: 'high' },
        );
        break;
      case 'menu_click':
        tools.push(
          { tool: 'desktop.focus_app', reason: 'Focus the target app before invoking a native menu item.', priority: 'high' },
          { tool: 'desktop.menu_click', reason: 'Click a macOS menu path such as File > Save through System Events.', priority: 'high' },
        );
        break;
      case 'indesign_document_status':
        tools.push({ tool: 'desktop.indesign_document_status', reason: 'Inspect open InDesign document state, missing links, missing fonts, layers, and active document guard before editing.', priority: 'high' });
        break;
      case 'indesign_text_inventory':
        tools.push({ tool: 'desktop.indesign_text_inventory', reason: 'Inspect text frames, layer names, labels, overset state, and candidate copy before choosing an InDesign edit target.', priority: 'high' });
        break;
      case 'indesign_set_layer_state':
        tools.push(
          { tool: 'desktop.indesign_document_status', reason: 'Confirm the target InDesign document before changing layer visibility or lock state.', priority: 'high' },
          { tool: 'desktop.indesign_text_inventory', reason: 'Inspect available layer names before applying a layer-state mutation.', priority: 'medium' },
          { tool: 'desktop.indesign_set_layer_state', reason: 'Show, hide, lock, or unlock the exact InDesign layer through the script-backed bridge.', priority: 'high' },
        );
        break;
      case 'photoshop_set_layer_state':
        tools.push(
          { tool: 'desktop.photoshop_document_status', reason: 'Confirm the target Photoshop document before changing layer visibility or lock state.', priority: 'high' },
          { tool: 'desktop.photoshop_layer_inventory', reason: 'Inspect available layer names and paths before applying a layer-state mutation.', priority: 'medium' },
          { tool: 'desktop.photoshop_set_layer_state', reason: 'Show, hide, lock, or unlock the exact Photoshop layer/group through the script-backed bridge.', priority: 'high' },
        );
        break;
      case 'indesign_update_text_layer':
        tools.push(
          { tool: 'desktop.indesign_document_status', reason: 'Confirm the target InDesign document before changing named banner text.', priority: 'high' },
          { tool: 'desktop.indesign_text_inventory', reason: 'Use text-frame inventory if the named banner field is ambiguous or not found.', priority: 'medium' },
          { tool: 'desktop.indesign_update_text_layer', reason: 'Update a named InDesign dealership/banner text layer directly through the script-backed bridge.', priority: 'high' },
        );
        break;
      case 'indesign_export_proof':
        tools.push(
          { tool: 'desktop.indesign_document_status', reason: 'Confirm the guarded active InDesign document before exporting a proof.', priority: 'high' },
          { tool: 'desktop.indesign_export_proof', reason: 'Export a PDF proof through the script-backed InDesign bridge to an approved local output path.', priority: 'high' },
          { tool: 'desktop.file_stat', reason: 'Verify the exported proof file exists and has a non-zero size.', priority: 'medium' },
        );
        break;
      case 'indesign_package_document':
        tools.push(
          { tool: 'desktop.indesign_document_status', reason: 'Confirm the guarded active InDesign document and preflight counts before packaging for handoff.', priority: 'high' },
          { tool: 'desktop.indesign_package_document', reason: 'Package the active InDesign document through the script-backed bridge into an approved local output folder.', priority: 'high' },
          { tool: 'desktop.file_stat', reason: 'Verify the package output folder exists after packageForPrint completes.', priority: 'medium' },
        );
        break;
      case 'indesign_relink_asset':
        tools.push(
          { tool: 'desktop.indesign_document_status', reason: 'Confirm the guarded active InDesign document and link state before relinking an asset.', priority: 'high' },
          { tool: 'desktop.indesign_relink_asset', reason: 'Relink the selected or named InDesign placed asset through the script-backed bridge with an approved local replacement file.', priority: 'high' },
          { tool: 'desktop.indesign_document_status', reason: 'Verify missing/modified link counts after relinking.', priority: 'medium' },
        );
        break;
      case 'indesign_batch_find_change':
        tools.push(
          { tool: 'desktop.indesign_document_status', reason: 'Confirm the target InDesign document before running multiple exact replacements.', priority: 'high' },
          { tool: 'desktop.indesign_text_inventory', reason: 'Inspect candidate text frames if any batch replacement is missing or partially changed.', priority: 'medium' },
          { tool: 'desktop.indesign_batch_find_change', reason: 'Run multiple exact InDesign Find/Change replacements in one script-backed operation with per-pair verification.', priority: 'high' },
        );
        break;
      case 'indesign_batch_update_text_layers':
        tools.push(
          { tool: 'desktop.indesign_document_status', reason: 'Confirm the target InDesign document before running multiple named banner field updates.', priority: 'high' },
          { tool: 'desktop.indesign_text_inventory', reason: 'Inspect candidate text frames if any named field is missing or ambiguous.', priority: 'medium' },
          { tool: 'desktop.indesign_batch_update_text_layers', reason: 'Update multiple named InDesign dealership/banner fields in one script-backed operation with per-field verification.', priority: 'high' },
        );
        break;
      case 'type_text':
        tools.push(
          { tool: 'desktop.focus_app', reason: 'Focus the target app before typing text.', priority: 'high' },
          { tool: 'desktop.type_text', reason: 'Type the requested text through the desktop bridge.', priority: 'high' },
        );
        break;
      case 'paste_text':
        tools.push(
          { tool: 'desktop.focus_app', reason: 'Focus the target app before pasting text.', priority: 'high' },
          { tool: 'desktop.paste_text', reason: 'Paste longer or multiline text through a temporary restored clipboard.', priority: 'high' },
        );
        break;
      case 'set_field_text':
        tools.push(
          { tool: 'desktop.focus_app', reason: 'Focus the target app before setting a named field.', priority: 'high' },
          { tool: 'desktop.read_a11y_tree', reason: 'Find the named field semantically before changing it.', priority: 'high' },
          { tool: 'desktop.set_element_value', reason: 'Set the matched text field value directly through Accessibility when supported.', priority: 'high' },
          { tool: 'desktop.paste_text', reason: 'Fallback for editable fields that do not expose AXValue set support.', priority: 'medium' },
        );
        break;
      case 'press_keys':
        tools.push(
          { tool: 'desktop.focus_app', reason: 'Focus the target app before pressing a key combo.', priority: 'high' },
          { tool: 'desktop.press_keys', reason: 'Press the requested keyboard shortcut through the desktop bridge.', priority: 'high' },
        );
        break;
      case 'window_manage':
        tools.push({ tool: 'desktop.window_manage', reason: 'Move, resize, focus, minimize, or raise a desktop window as requested.', priority: 'high' });
        break;
      case 'mouse_move':
        tools.push({ tool: 'desktop.mouse_move', reason: 'Move or hover the local mouse at explicit screen coordinates.', priority: 'high' });
        break;
      case 'mouse_click':
        tools.push(
          { tool: 'desktop.screen_size', reason: 'Read screen dimensions before coordinate-based clicking.', priority: 'medium' },
          { tool: 'desktop.mouse_click', reason: 'Click the local mouse at explicit screen coordinates with the requested button/count.', priority: 'high' },
        );
        break;
      case 'mouse_down':
        tools.push(
          { tool: 'desktop.screen_size', reason: 'Read screen dimensions before holding the mouse down at coordinates.', priority: 'medium' },
          { tool: 'desktop.mouse_down', reason: 'Hold the local mouse button down for drag, scrub, paint, select, or resize operations.', priority: 'high' },
        );
        break;
      case 'mouse_up':
        tools.push({ tool: 'desktop.mouse_up', reason: 'Release a previously held local mouse button.', priority: 'high' });
        break;
      case 'mouse_drag':
        tools.push(
          { tool: 'desktop.screen_size', reason: 'Read screen dimensions before coordinate-based dragging.', priority: 'medium' },
          { tool: 'desktop.mouse_drag', reason: 'Drag the local mouse between explicit screen coordinates.', priority: 'high' },
        );
        break;
      case 'mouse_scroll':
        tools.push({ tool: 'desktop.mouse_scroll', reason: 'Scroll the focused desktop window with mouse-wheel input.', priority: 'high' });
        break;
      default:
        break;
    }
  }

  if (
    /\b(active|frontmost|focused|current)\b[\s\S]{0,80}\b(?:window|app)s?\b/i.test(message) ||
    /\b(?:window|app)s?\b[\s\S]{0,80}\b(active|frontmost|focused|current|open)\b/i.test(message) ||
    /\b(open windows?|windows? (?:are|is) open|window state|screen state)\b/i.test(message)
  ) {
    tools.push({ tool: 'desktop.window_state', reason: 'Read active/frontmost window state from the local desktop bridge.', priority: 'high' });
  }
  if (/\b(?:list|show|what|which)\b[\s\S]{0,80}\b(?:apple\s+|macos\s+|mac\s+)?shortcuts?\b/i.test(message)) {
    tools.push({ tool: 'desktop.shortcuts_list', reason: 'List available Apple Shortcuts.', priority: 'high' });
  }
  if (/\b(run|start|trigger|execute)\b[\s\S]{0,120}\bshortcut\b|\bshortcut\b[\s\S]{0,80}\b(run|start|trigger|execute)\b/i.test(message)) {
    tools.push({ tool: 'desktop.shortcuts_run', reason: 'Run the named Apple Shortcut after explicit user request.', priority: 'high' });
  }
  if (/\b(minimi[sz]e|unminimi[sz]e|maximi[sz]e|zoom|raise|focus|resize)\b[\s\S]{0,80}\bwindow\b/i.test(message)) {
    tools.push({ tool: 'desktop.window_manage', reason: 'Manage the requested desktop window action.', priority: 'high' });
  }
  if (/\bindesign\b[\s\S]{0,160}\b(status|preflight|links?|fonts?|missing|modified|active document|open document|issues?)\b/i.test(message)) {
    tools.push({ tool: 'desktop.indesign_document_status', reason: 'Read InDesign document diagnostics before attempting document edits or handoff checks.', priority: 'high' });
  }
  if (/\bindesign\b[\s\S]{0,180}\b(text frames?|copy fields?|text layers?|editable text|named frames?|banner fields?|layer names?)\b/i.test(message)) {
    tools.push({ tool: 'desktop.indesign_text_inventory', reason: 'Inventory InDesign text frames and layer labels for reliable target selection.', priority: 'high' });
  }
  if (/\bindesign\b[\s\S]{0,220}\b(?:show|hide|lock|unlock|toggle)\b[\s\S]{0,120}\blayers?\b|\b(?:show|hide|lock|unlock|toggle)\b[\s\S]{0,120}\bindesign\b[\s\S]{0,120}\blayers?\b/i.test(message)) {
    tools.push(
      { tool: 'desktop.indesign_document_status', reason: 'Guard the active InDesign document before a layer-state mutation.', priority: 'high' },
      { tool: 'desktop.indesign_text_inventory', reason: 'Inspect layer names so the target can be exact.', priority: 'medium' },
      { tool: 'desktop.indesign_set_layer_state', reason: 'Apply the requested InDesign layer visibility or lock change through the script-backed bridge.', priority: 'high' },
    );
  }
  if (/\bphotoshop\b[\s\S]{0,220}\b(?:show|hide|lock|unlock|toggle)\b[\s\S]{0,120}\blayers?\b|\b(?:show|hide|lock|unlock|toggle)\b[\s\S]{0,120}\bphotoshop\b[\s\S]{0,120}\blayers?\b/i.test(message)) {
    tools.push(
      { tool: 'desktop.photoshop_document_status', reason: 'Guard the active Photoshop document before a layer-state mutation.', priority: 'high' },
      { tool: 'desktop.photoshop_layer_inventory', reason: 'Inspect layer names and group paths so the target can be exact.', priority: 'medium' },
      { tool: 'desktop.photoshop_set_layer_state', reason: 'Apply the requested Photoshop layer visibility or lock change through the script-backed bridge.', priority: 'high' },
    );
  }
  if (/\bindesign\b[\s\S]{0,240}\b(?:relink|replace\s+link|replace|swap|update)\b[\s\S]{0,140}\b(?:image|photo|graphic|logo|background|hero|asset|link)\b[\s\S]{0,140}\b(?:with|to|using)\b|\b(?:relink|replace\s+link|swap\s+(?:the\s+)?(?:linked\s+)?(?:asset|image|graphic|logo))\b[\s\S]{0,180}\bindesign\b/i.test(message)) {
    tools.push(
      { tool: 'desktop.indesign_document_status', reason: 'Guard the active InDesign document and link state before relinking an asset.', priority: 'high' },
      { tool: 'desktop.indesign_relink_asset', reason: 'Relink the selected or named InDesign placed asset through the script-backed bridge.', priority: 'high' },
      { tool: 'desktop.indesign_document_status', reason: 'Verify link status after relinking.', priority: 'medium' },
    );
  }
  if (/\bindesign\b[\s\S]{0,240}\b(?:export|save|make|create)\b[\s\S]{0,160}\b(?:proof|pdf)\b|\b(?:export|save|make|create)\b[\s\S]{0,160}\b(?:proof\s+pdf|pdf\s+proof)\b[\s\S]{0,160}\bindesign\b/i.test(message)) {
    tools.push(
      { tool: 'desktop.indesign_document_status', reason: 'Guard the active InDesign document before proof export.', priority: 'high' },
      { tool: 'desktop.indesign_export_proof', reason: 'Export the requested InDesign PDF proof through the script-backed bridge.', priority: 'high' },
      { tool: 'desktop.file_stat', reason: 'Confirm the exported PDF proof exists after export.', priority: 'medium' },
    );
  }
  if (/\bindesign\b[\s\S]{0,240}\b(?:package|collect|handoff|production|printer|vendor|release|archive)\b|\b(?:package|collect)\b[\s\S]{0,160}\b(?:handoff|production|printer|vendor|release|archive)\b[\s\S]{0,160}\bindesign\b/i.test(message)) {
    tools.push(
      { tool: 'desktop.indesign_document_status', reason: 'Guard the active InDesign document and capture link/font counts before package handoff.', priority: 'high' },
      { tool: 'desktop.indesign_package_document', reason: 'Package the InDesign document through the script-backed bridge into an approved output folder.', priority: 'high' },
      { tool: 'desktop.file_stat', reason: 'Confirm the package output folder exists after packageForPrint completes.', priority: 'medium' },
    );
  }
  if (/\bindesign\b/i.test(message) && /\b(?:change|replace|update)\b[\s\S]{0,220}\b(?:to|with|as)\b[\s\S]{0,120}\b(?:,\s*|;\s*|\band\b)[\s\S]{0,120}\b(?:to|with|as)\b/i.test(message)) {
    tools.push(
      { tool: 'desktop.indesign_document_status', reason: 'Guard the active InDesign document before a multi-replacement edit.', priority: 'high' },
      { tool: 'desktop.indesign_batch_find_change', reason: 'Use the deterministic batch InDesign Find/Change bridge for multi-value copy changes.', priority: 'high' },
      { tool: 'desktop.indesign_text_inventory', reason: 'Diagnose missing or partially applied replacements with text-frame inventory.', priority: 'medium' },
    );
  }
  if (/\bindesign\b[\s\S]{0,220}\b(disclaimer|legal|apr|offer|price|headline|subheadline|cta|dealer|phone|website|expiration|expires)\b[\s\S]{0,120}\b(to|as|with|update|change|replace)\b/i.test(message)
    || /\b(change|update|set)\b[\s\S]{0,120}\b(disclaimer|legal|apr|offer|price|headline|subheadline|cta|dealer|phone|website|expiration|expires)\b[\s\S]{0,160}\bindesign\b/i.test(message)) {
    tools.push(
      { tool: 'desktop.indesign_document_status', reason: 'Guard the active InDesign document before a named banner copy edit.', priority: 'high' },
      { tool: 'desktop.indesign_text_inventory', reason: 'Have frame/layer candidates available if the named InDesign field is ambiguous.', priority: 'medium' },
      { tool: 'desktop.indesign_update_text_layer', reason: 'Use the deterministic InDesign layer/frame text update for common dealership banner copy changes.', priority: 'high' },
    );
  }
  if (/\bindesign\b[\s\S]{0,260}\b(?:headline|price|apr|disclaimer|legal|cta|dealer|phone|website|expiration)\b[\s\S]{0,120}\b(?:to|as|with|=|:)\b[\s\S]{0,120}\b(?:,\s*|;\s*|\band\b)[\s\S]{0,120}\b(?:headline|price|apr|disclaimer|legal|cta|dealer|phone|website|expiration)\b/i.test(message)) {
    tools.push(
      { tool: 'desktop.indesign_document_status', reason: 'Guard the active InDesign document before a multi-field banner edit.', priority: 'high' },
      { tool: 'desktop.indesign_batch_update_text_layers', reason: 'Use the deterministic batch InDesign text-layer bridge for multi-field dealership banner changes.', priority: 'high' },
      { tool: 'desktop.indesign_text_inventory', reason: 'Diagnose missing named fields with text-frame inventory.', priority: 'medium' },
    );
  }

  if (kind === 'build' || kind === 'debug' || kind === 'architect') {
    tools.push({ tool: 'code.generate', reason: 'Produce concrete code or file artifacts for implementation work.', priority: 'high' });
  }
  if (kind === 'review') {
    tools.push({ tool: 'code.review', reason: 'Structure findings and quality analysis like a senior code reviewer.', priority: 'high' });
  }
  if (kind === 'research') {
    tools.push(
      { tool: 'research.search', reason: 'Search the research corpus for prior findings and synthesized knowledge.', priority: 'high' },
      { tool: 'fetch_url', reason: 'Pull in external pages or documentation when the question needs current evidence.', priority: 'high' },
      { tool: 'research.save', reason: 'Save durable findings when the research produces reusable knowledge.', priority: 'medium' },
    );
  }
  if (PREVIEW_RE.test(message)) {
    tools.push(
      { tool: 'workspace.create_room', reason: 'Create or use a room when the task benefits from file-backed iteration.', priority: 'high' },
      { tool: 'workspace.open_preview', reason: 'Open the generated output in a preview/sandbox for visual confirmation.', priority: 'high' },
    );
  }
  if (BROWSER_RE.test(message) || BOT_VERIFICATION_RE.test(message)) {
    tools.push({
      tool: 'browser.plan_task',
      reason: browserbaseWorkflow.kind === 'general_browser'
        ? 'Plan browser actions and pick the right execution backend before touching a live site.'
        : `Plan ${browserbaseWorkflow.label.toLowerCase()} with Browserbase readiness, output shape, and approval gates before touching a live site.`,
      priority: 'high',
    });
    tools.push({
      tool: 'browser.verification_state',
      reason: verificationGate
        ? 'Check the live page for bot verification and pause for human completion before any click/fill action.'
        : 'Check for CAPTCHA, Cloudflare, MFA, or other human verification before performing browser mutations.',
      priority: verificationGate ? 'high' : 'medium',
    });
    if (entities?.urls.length || /\bhttps?:\/\//i.test(message)) {
      tools.push({ tool: 'browser.open_url', reason: 'Open the target page in the persistent local browser profile before semantic actions.', priority: 'high' });
    }
    if (/\b(read|inspect|see|show|find|extract|scrape|collect|data|table|list|links?|fields?|snapshot|dom)\b/i.test(message)) {
      tools.push({ tool: 'browser.dom_snapshot', reason: 'Read a compact DOM/ARIA snapshot before choosing selectors or extracting page state.', priority: 'high' });
    }
    if (/\b(click|press button|button|link|tab)\b/i.test(message)) {
      tools.push({ tool: 'browser.click_role', reason: 'Use Playwright role/name locators for semantic clicks instead of brittle coordinates.', priority: 'high' });
    }
    if (/\b(select|dropdown|drop down|choose option|combobox|picker)\b/i.test(message)) {
      tools.push({ tool: 'browser.select_option', reason: 'Select browser dropdown values with Playwright locator auto-waiting.', priority: 'high' });
    }
    if (/\b(fill|form|input|textbox|type|enter|login|sign in|submit|data entry)\b/i.test(message)) {
      tools.push({ tool: 'browser.fill_field', reason: 'Fill browser fields by role/name or selector in the persistent local browser profile.', priority: 'high' });
    }
    if (/\b(upload|attach|choose file|select file|import)\b/i.test(message)) {
      tools.push(
        { tool: 'desktop.file_search', reason: 'Resolve the local file path before handing it to a browser file input.', priority: 'high' },
        { tool: 'desktop.file_stat', reason: 'Verify the selected upload file exists and is a file before browser upload.', priority: 'high' },
        { tool: 'browser.upload_file', reason: 'Attach the verified local file to a browser file input or file chooser.', priority: 'high' },
      );
    }
    if (/\b(download|export|save (?:this )?(?:page|webpage|site|report|csv|pdf)|save as pdf|print to pdf)\b/i.test(message)) {
      tools.push(
        { tool: 'browser.screenshot', reason: 'Capture proof before or after browser download/export/save flows.', priority: 'medium' },
        { tool: 'desktop.file_search', reason: 'Verify the downloaded/exported file appears in the expected local folder.', priority: 'high' },
        { tool: 'desktop.file_stat', reason: 'Check downloaded/exported file metadata after the browser action.', priority: 'high' },
      );
    }
    if (/\b(press|enter|return|tab|escape|keyboard|hotkey|shortcut)\b/i.test(message)) {
      tools.push({ tool: 'browser.press_key', reason: 'Send browser keyboard input through Playwright when a web page has focus.', priority: 'medium' });
    }
    if (/\b(screenshot|screen shot|visual|verify|proof)\b/i.test(message)) {
      tools.push({ tool: 'browser.screenshot', reason: 'Capture browser visual state after semantic navigation/actions for verification.', priority: 'medium' });
    }
  }
  if (BROWSER_FILE_TRANSFER_RE.test(message) && (BROWSER_RE.test(message) || /\b(shopify|wordpress|wp|webflow|wix|squarespace|woocommerce|bigcommerce|framer|cms|admin|website|site|browser|web page|webpage)\b/i.test(message))) {
    tools.push(
      { tool: 'browser.plan_task', reason: 'Plan the browser/local-file handoff before touching a live site.', priority: 'high' },
      { tool: 'browser.verification_state', reason: 'Pause for human verification before browser upload/download workflows.', priority: 'high' },
      { tool: 'browser.dom_snapshot', reason: 'Find upload/download controls semantically before using them.', priority: 'high' },
      { tool: 'desktop.file_search', reason: 'Resolve local file paths or expected download locations.', priority: LOCAL_FILE_SCOPE_RE.test(message) ? 'high' : 'medium' },
      { tool: 'browser.upload_file', reason: 'Use Playwright file input/file chooser support for local-to-browser uploads when a local file is involved.', priority: /\b(upload|attach|choose file|select file|import)\b/i.test(message) ? 'high' : 'medium' },
      { tool: 'browser.screenshot', reason: 'Capture visual proof for file-transfer workflows.', priority: 'medium' },
      { tool: 'approvals.request', reason: 'Gate external upload, publish, submit, or account mutations behind explicit approval.', priority: 'high' },
    );
  }
  if (DESKTOP_RE.test(message)) {
    tools.push(
      { tool: 'desktop.list_running_apps', reason: 'Check which native apps are already open before controlling the desktop.', priority: 'high' },
      { tool: 'desktop.screenshot', reason: 'Capture the current screen so OpenSwan can verify desktop state before or after action.', priority: 'medium' },
    );
    if (/\b(launch|open|start)\b/i.test(message)) {
      tools.push({ tool: 'desktop.launch_app', reason: 'Launch the requested native app through the desktop bridge.', priority: 'high' });
      tools.push({ tool: 'desktop.wait_for_app', reason: 'Wait for the launched app before typing or sending keys.', priority: 'medium' });
    }
    if (/\b(focus|switch to|bring .* front)\b/i.test(message)) {
      tools.push({ tool: 'desktop.focus_app', reason: 'Focus the requested app before sending keyboard or text actions.', priority: 'high' });
    }
    if (/\b(type|enter|write|paste|fill)\b/i.test(message)) {
      tools.push({ tool: 'desktop.type_text', reason: 'Type requested text into the focused desktop app after focus is confirmed.', priority: 'high' });
      tools.push({ tool: 'desktop.paste_text', reason: 'Paste longer or multiline text into the focused desktop app with clipboard restoration.', priority: 'high' });
      tools.push({ tool: 'desktop.set_element_value', reason: 'Set named editable fields directly through Accessibility when the target field can be identified.', priority: 'high' });
    }
    if (/\b(keys?|keystroke|shortcut|press|return|enter|tab|escape|cmd|command)\b/i.test(message)) {
      tools.push({ tool: 'desktop.press_keys', reason: 'Send explicit keyboard shortcuts through the desktop bridge.', priority: 'high' });
    }
    if (/\b(menu|file\s*>|edit\s*>|view\s*>|window\s*>|help\s*>)\b/i.test(message)) {
      tools.push({ tool: 'desktop.menu_click', reason: 'Invoke stable native menu paths before falling back to pixel coordinates.', priority: 'high' });
    }
    if (entities?.urls.length || /\bhttps?:\/\//i.test(message)) {
      tools.push({ tool: 'desktop.open_url', reason: 'Open the requested URL directly in the default browser from the desktop bridge.', priority: 'high' });
    }
    if (/\b(file|folder|path|downloads|desktop|documents)\b/i.test(message) && /[~/][^\s]+/.test(message)) {
      tools.push({ tool: 'desktop.open_path', reason: 'Open a requested local file or folder through the desktop bridge.', priority: 'medium' });
    }
    if (/\b(find|locate|search|scan|look for)\b[\s\S]{0,80}\b(file|folder|document|download|computer|mac|desktop|documents?)\b/i.test(message)) {
      tools.push({ tool: 'desktop.file_search', reason: 'Search the verified local file grant roots for matching filenames and text previews.', priority: 'high' });
    }
    if (/\b(exists?|metadata|info|details|size|modified|created|stat)\b[\s\S]{0,120}\b(file|folder|directory|image|photo|document|desktop|downloads?|documents?)\b/i.test(message)
      || /\b(file|folder|directory|image|photo|document)\b[\s\S]{0,120}\b(exists?|metadata|info|details|size|modified|created|stat)\b/i.test(message)) {
      tools.push({ tool: 'desktop.file_stat', reason: 'Check whether the requested local path exists and inspect safe metadata without reading contents.', priority: 'high' });
    }
    if (/\b(rename|change|move)\b[\s\S]{0,120}\b(file|folder|image|photo|document|desktop|downloads?|documents?)\b/i.test(message)) {
      tools.push({ tool: 'desktop.file_rename', reason: 'Rename or move the requested local file using the write-scoped desktop bridge file tool.', priority: 'high' });
    }
    if (/\b(copy|duplicate|make a copy)\b[\s\S]{0,140}\b(file|folder|image|photo|document|desktop|downloads?|documents?)\b/i.test(message)) {
      tools.push({ tool: 'desktop.file_copy', reason: 'Copy the requested local file or folder using the write-scoped desktop bridge file tool.', priority: 'high' });
    }
    if (/\b(delete|remove|trash)\b(?=[\s\S]{0,180}\b(file|folder|image|photo|document|desktop|downloads?|documents?)\b)/i.test(message)
      || /\bmove\b(?=[\s\S]{0,180}\btrash\b)(?=[\s\S]{0,180}\b(file|folder|image|photo|document|desktop|downloads?|documents?)\b)/i.test(message)) {
      tools.push({ tool: 'desktop.file_trash', reason: 'Move the requested local file or folder to Trash through the write-scoped desktop bridge file tool.', priority: 'high' });
    }
    if (/\b(create|make|new)\b[\s\S]{0,80}\b(folder|directory)\b/i.test(message)) {
      tools.push({ tool: 'desktop.file_mkdir', reason: 'Create the requested local folder through the write-scoped desktop bridge file tool.', priority: 'high' });
    }
    if (/\b(write|save|create|make|append)\b[\s\S]{0,120}\b(file|text file|note|notes|txt|markdown|md)\b/i.test(message)) {
      tools.push({ tool: 'desktop.file_write_text', reason: 'Create, overwrite, or append a bounded local text file through the write-scoped desktop bridge file tool.', priority: 'high' });
    }
    if (/\b(move|hover|position)\b[\s\S]{0,40}\b(mouse|cursor)\b/i.test(message)) {
      tools.push({ tool: 'desktop.mouse_move', reason: 'Move or hover the cursor at explicit screen coordinates.', priority: 'high' });
    }
    if (/\bdrag\b[\s\S]{0,120}\b(?:to|into|onto)\b/i.test(message)) {
      tools.push(
        { tool: 'desktop.screen_size', reason: 'Read screen dimensions before coordinate-based dragging.', priority: 'medium' },
        { tool: 'desktop.mouse_drag', reason: 'Drag between explicit local screen coordinates.', priority: 'high' },
      );
    }
    if (/\b(mouse\s+down|hold(?:\s+down)?\b|release|mouse\s+up)\b/i.test(message)) {
      tools.push(
        { tool: 'desktop.screen_size', reason: 'Read screen dimensions before held mouse actions when coordinates are provided.', priority: 'medium' },
        { tool: 'desktop.mouse_down', reason: 'Hold the mouse button down for app operations like selections, scrubbers, handles, and drawing.', priority: 'high' },
        { tool: 'desktop.mouse_up', reason: 'Release a held mouse button after the directed app operation finishes.', priority: 'high' },
      );
    }
    if (/\b(click|coordinate|coords?)\b/i.test(message)) {
      tools.push(
        { tool: 'desktop.screen_size', reason: 'Read screen dimensions before coordinate-based clicking.', priority: 'medium' },
        { tool: 'desktop.mouse_click', reason: 'Click at explicit user-provided screen coordinates when keyboard/semantic actions are not enough.', priority: 'medium' },
      );
    }
    if (/\b(scroll|scroll down|scroll up|mouse wheel)\b/i.test(message)) {
      tools.push({ tool: 'desktop.mouse_scroll', reason: 'Scroll the focused desktop window when the user asks for mouse-wheel style navigation.', priority: 'high' });
    }
  }
  if (VAULT_RE.test(message) || /\blog\s*in|sign\s*in|wordpress|shopify|webflow|wix|squarespace|woocommerce|bigcommerce|framer|cms|admin panel|website builder|store admin\b/i.test(message)) {
    tools.push(
      { tool: 'vault.resolve_for_task', reason: 'Resolve the safest saved credential for login-dependent website automation without exposing secrets.', priority: 'high' },
      { tool: 'vault.runbook', reason: 'Give agents a credential ID, allowed actions, allowed origins, and safe login instructions.', priority: 'high' },
      { tool: 'vault.grants', reason: 'Inspect which agents or runtimes already have scoped credential access.', priority: 'medium' },
      { tool: 'browser.fill_credential_field', reason: 'Fill login fields from an approved saved credential without returning the raw secret to the model.', priority: 'high' },
    );
  }
  if (/\bgrant|give .*access|allow .*access|can use\b/i.test(message) && VAULT_RE.test(message)) {
    tools.push({ tool: 'vault.grant', reason: 'Create a scoped vault access grant when the user explicitly gives an agent credential access.', priority: 'medium' });
  }
  if (/\brevoke|remove .*access|block .*access|disable .*access\b/i.test(message) && VAULT_RE.test(message)) {
    tools.push({ tool: 'vault.revoke', reason: 'Remove a scoped vault access grant when the user asks to take access away.', priority: 'medium' });
  }
  if (kind === 'build' || kind === 'debug') {
    tools.push(
      { tool: 'verification.typecheck', reason: 'Validate code integrity after changes.', priority: 'high' },
      { tool: 'verification.tests', reason: 'Use tests or regression checks to verify behavior.', priority: TEST_RE.test(message) ? 'high' : 'medium' },
    );
  }
  if (LINT_RE.test(message) || kind === 'architect') {
    tools.push({ tool: 'verification.lint', reason: 'Check consistency and static quality expectations.', priority: 'medium' });
  }
  if (PREVIEW_RE.test(message)) {
    tools.push({ tool: 'verification.preview', reason: 'Confirm UI results in a sandbox or preview.', priority: 'high' });
  }
  if (TASKS_RE.test(message) || /\b(my tasks|open tasks|create task|assign task)\b/i.test(message)) {
    tools.push(
      { tool: 'tasks.list', reason: 'Read the circle kanban state when the request is about active work.', priority: 'high' },
      { tool: 'tasks.create', reason: 'Create actionable work items when the user asks for new tasks.', priority: 'medium' },
      { tool: 'tasks.update_status', reason: 'Update task progress when the request implies moving work forward.', priority: 'medium' },
      { tool: 'tasks.assign', reason: 'Assign tasks to members when ownership is part of the request.', priority: 'medium' },
      { tool: 'tasks.comment', reason: 'Leave progress notes or review comments when the request is about updating a task conversation.', priority: 'medium' },
      { tool: 'tasks.add_artifact', reason: 'Attach deliverables or links to a task run when the work needs durable outputs.', priority: 'low' },
    );
  }
  if (GOALS_RE.test(message)) {
    tools.push(
      { tool: 'goals.list', reason: 'Load goal state before answering goal or OKR questions.', priority: 'high' },
      { tool: 'goals.create', reason: 'Create goals when the user is defining new outcomes.', priority: 'medium' },
      { tool: 'goals.update_progress', reason: 'Update measurable goal progress when the user provides new progress information.', priority: 'medium' },
      { tool: 'goals.update_status', reason: 'Change goal state when asked to activate, pause, or complete goals.', priority: 'medium' },
    );
  }
  if (MISSIONS_RE.test(message)) {
    tools.push(
      { tool: 'missions.list', reason: 'Surface mission progress and proof-of-work context.', priority: 'high' },
      { tool: 'missions.create_task', reason: 'Add mission tasks when a mission needs execution detail.', priority: 'medium' },
      { tool: 'missions.complete_task', reason: 'Close mission work when asked to mark it done.', priority: 'medium' },
    );
  }
  if (MESSAGES_RE.test(message)) {
    tools.push(
      { tool: 'messages.list', reason: 'Use recent message history when the user asks about chat context or thread activity.', priority: 'medium' },
      { tool: 'messages.create', reason: 'Post a chat message when the user explicitly wants OpenSwan to say or announce something in-circle.', priority: 'medium' },
    );
  }
  if (CHECKINS_RE.test(message)) {
    tools.push({ tool: 'check_ins.list', reason: 'Use recent check-ins when the request is about updates, momentum, or standups.', priority: 'medium' });
  }
  if (RESEARCH_DOC_RE.test(message) || kind === 'research') {
    tools.push(
      { tool: 'research.search', reason: 'Search the curated research corpus when the question is knowledge-heavy.', priority: 'high' },
      { tool: 'fetch_url', reason: 'Fetch external sources when the request includes a URL or doc lookup.', priority: 'medium' },
    );
  }
  if (ROOMS_RE.test(message)) {
    tools.push(
      { tool: 'rooms.list', reason: 'List project rooms when the request is about room-backed work.', priority: 'medium' },
      { tool: 'rooms.create', reason: 'Create a room when the user wants a new project/workspace container.', priority: 'medium' },
      { tool: 'rooms.send_message', reason: 'Post into a room conversation when the user wants OpenSwan to communicate there.', priority: 'medium' },
      { tool: 'rooms.list_tasks', reason: 'Inspect room automation/task state when the request involves room task runners.', priority: 'medium' },
      { tool: 'rooms.create_task', reason: 'Create room tasks when the user wants automation or recurring room work.', priority: 'medium' },
      { tool: 'rooms.create_file', reason: 'Create workspace files when the request needs room-backed implementation artifacts.', priority: 'medium' },
      { tool: 'rooms.update_file', reason: 'Update existing workspace files when the request is about editing room content.', priority: 'medium' },
      { tool: 'rooms.list_files', reason: 'Inspect room files when the request references a room workspace.', priority: 'medium' },
      { tool: 'rooms.read_file', reason: 'Read specific room files when the answer depends on workspace contents.', priority: 'medium' },
    );
  }
  if (GITHUB_RE.test(message)) {
    tools.push(
      { tool: 'github.list_repos', reason: 'Load connected repositories when repo context matters.', priority: 'medium' },
      { tool: 'github.read_file', reason: 'Read repository files when the request references GitHub content.', priority: 'medium' },
    );
  }
  if (INTEGRATIONS_RE.test(message)) {
    tools.push({ tool: 'integrations.list', reason: 'Check connected providers and capabilities before claiming the app can act on external systems.', priority: 'medium' });
  }
  if (OFFICE_RE.test(message)) {
    tools.push({ tool: 'office.list_agents', reason: 'Load the live office roster when the request is about active agents or publishing state.', priority: 'medium' });
  }
  if (APPROVAL_RE.test(message)) {
    tools.push(
      { tool: 'approvals.list', reason: 'List pending approvals before discussing approval state or action.', priority: 'medium' },
      { tool: 'approvals.request', reason: 'Request an explicit approval when the user wants a gated step added to a run.', priority: 'low' },
      { tool: 'approvals.resolve', reason: 'Resolve an approval when the user explicitly approves or rejects something.', priority: 'low' },
    );
  }
  if (/\bremember|save this|make note|store this\b/i.test(message)) {
    tools.push({ tool: 'save_memory', reason: 'Persist explicit user instructions or decisions into memory when requested.', priority: 'medium' });
  }
  if (/\bremember|what do we know|previously|earlier|past decision\b/i.test(message)) {
    tools.push({ tool: 'search_memories', reason: 'Load prior memories when the user asks for retained context.', priority: 'medium' });
  }
  if (/\bteam|members|who can help|who's here\b/i.test(message)) {
    tools.push({ tool: 'list_circle_members', reason: 'List members when the request is about owners, collaborators, or assignment targets.', priority: 'medium' });
  }
  if (/\bschedule|queue|remind|automation|send later\b/i.test(message)) {
    tools.push({ tool: 'schedule_action', reason: 'Queue a follow-up action when the request includes reminder or automation intent.', priority: 'medium' });
  }

  // ── Entity-aware tool recommendations ─────────────────────────────────
  // If the caller extracted structured entities from the message, auto-add
  // relevant tools that the regex patterns above may have missed.
  if (entities) {
    if (entities.filePaths.length > 0) {
      tools.push({ tool: 'code.inspect', reason: `Message references ${entities.filePaths.length} file path(s) — inspect before acting.`, priority: 'high' });
    }
    if (entities.githubRefs.length > 0) {
      tools.push({ tool: 'github.read_file', reason: `Message references ${entities.githubRefs.length} GitHub ref(s) — load context.`, priority: 'high' });
      tools.push({ tool: 'github.list_repos', reason: 'Load repository context for GitHub references.', priority: 'medium' });
    }
    if (entities.urls.length > 0) {
      tools.push({ tool: 'fetch_url', reason: `Message includes ${entities.urls.length} URL(s) — fetch for context.`, priority: 'high' });
    }
    if (entities.stackTraces.length > 0) {
      tools.push({ tool: 'verification.typecheck', reason: 'Stack trace detected — verify code compiles after fix.', priority: 'high' });
      tools.push({ tool: 'verification.tests', reason: 'Stack trace detected — run tests to verify fix.', priority: 'high' });
    }
    if (entities.codeBlocks.length > 0) {
      tools.push({ tool: 'code.review', reason: `${entities.codeBlocks.length} code block(s) pasted — review and analyze.`, priority: 'high' });
    }
  }

  const deduped = new Map<OpenSwanToolName, OpenSwanToolPlanItem>();
  for (const item of tools) {
    if (!deduped.has(item.tool)) deduped.set(item.tool, item);
  }
  return Array.from(deduped.values());
}

export function buildOpenSwanTaskPlan(
  message: string,
  profile: AgenticCodingProfile,
  entities?: import('./messageEntityExtractor').MessageEntities,
): OpenSwanTaskPlan {
  const kind = inferTaskKind(message, profile);
  const pipelineMatch = getBestUserTaskPipeline(message, { includeFallback: false });
  const pipelineDecision = buildUserTaskPipelineDecision(message, { includeFallback: false });
  const pipeline = pipelineMatch ? summarizeUserTaskPipelineMatch(pipelineMatch) : null;
  const failureAssessment = classifyAgentFailure(message);
  const surfacePlan = buildExecutionSurfacePlan({
    message,
    pipeline,
    pipelineDecision,
    failureInput: failureAssessment.failureClass === 'unknown' ? null : message,
  });
  const ledgerPreview = buildAgentRunLedgerPreview({
    message,
    pipeline,
    pipelineDecision,
    surfacePlan,
  });
  const computerAppStrategy = buildComputerAppTaskStrategy(message, pipelineDecision);
  const computerAppGrounding = buildComputerAppGroundingPlan(message, pipelineDecision);
  const computerAppGroundingRunbook = buildComputerAppGroundingRunbook(message, pipelineDecision);
  const computerAppGroundingNextStep = recommendComputerAppGroundingNextStep({
    plan: computerAppGrounding,
    observations: [],
  });
  const computerAppGroundingTrace = buildComputerAppGroundingTrace({
    plan: computerAppGrounding,
    observations: [],
    actions: [],
  });
  const computerAppExecutionReceipts = buildComputerAppExecutionReceiptPlan(message, pipelineDecision);
  return {
    kind,
    profile,
    summary: `${kind.toUpperCase()} task in ${profile.toUpperCase()} mode`,
    pipeline,
    pipelineDecision,
    scenarioPolicy: surfacePlan?.policy || null,
    surfacePlan,
    ledgerPreview,
    failureAssessment: failureAssessment.failureClass === 'unknown' ? null : failureAssessment,
    computerAppStrategy,
    computerAppGrounding,
    computerAppGroundingRunbook,
    computerAppGroundingNextStep,
    computerAppGroundingTrace,
    computerAppExecutionReceipts,
    verification: buildVerification(kind, message, entities),
    recommendedTools: buildRecommendedTools(kind, message, entities),
  };
}
