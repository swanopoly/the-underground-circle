import { supabase } from './supabase';
import { semanticSearchMemories } from './memoryEmbeddings';
import { nextCronOccurrence, parseRecurrence, scheduleAction } from './scheduledActions';
import type { OpenSwanExecutionStatus } from './openswanExecution';
import type { OpenSwanTaskPlan, OpenSwanToolName } from './openswanTaskPlanner';
import type { SwanBotStructuredArtifact } from './swanbot';
import type { ApprovalKind } from './agentRunSystem';
import { createFilesInRoomFromArtifact, createWorkspaceFromArtifact, type RoomArtifactApplyResult, type WorkspaceCreationResult } from './chatWorkspace';
import { focusRoomWorkspaceFile, primeRoomWorkspaceLaunch } from './roomWorkspaceLauncher';
import { detectClaudeCodeBridge, execBridgeCommand } from './claudeCodeDetector';
import { describeComputerUsePlan, toBrowserPlanCardData, type BrowserPlanCardData } from './computerUse';
import { detectAutomationVerificationGate } from './desktopAutomationSafety';
import type { DesktopBridgeError, DesktopResult } from './desktopBridgeProtocol';
import { getPlugin } from './pluginRegistry';
import {
  buildOpenSwanToolApprovalKey,
  resolveOpenSwanRuntimeApprovalDecision,
  type OpenSwanRuntimeApprovalDecision,
} from './openswanToolApprovals';
import {
  buildVaultAgentRunbook,
  findVaultAutomationEntries,
  formatVaultEntryAutomationSummary,
  formatVaultGrantList,
  grantVaultAutomationAccess,
  resolveVaultCredentialForTask,
  revokeVaultAutomationAccess,
  selectVaultAutomationEntry,
  type VaultGranteeType,
} from './vaultAgentAccess';

export type OpenSwanToolSurface = 'main_chat' | 'room_chat' | 'office' | 'task_run';
export type OpenSwanRuntimeToolName =
  | OpenSwanToolName
  | 'browser.plan_task'
  | 'search_memories'
  | 'save_memory'
  | 'fetch_url'
  | 'list_circle_members'
  | 'schedule_action'
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
  | 'wp.discover_types'
  | 'wp.upload_media'
  | 'wp.create_slide'
  | 'wp.list_posts'
  | 'credentials.get'
  | 'vault.list'
  | 'vault.find'
  | 'vault.grants'
  | 'vault.grant'
  | 'vault.revoke'
  | 'vault.runbook'
  | 'vault.resolve_for_task'
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
  // ── Circle / Agent / Office editing (chat-driven UI mutations) ────
  // Anything a user can edit in Circle Settings / Office Customize
  // should be invokable by name from chat. Policy = 'auto' because
  // these mutations are reversible from the same UI.
  | 'circle.update_settings'
  | 'circle.update_budget_caps'
  | 'circle.update_office_theme'
  | 'agent.update_appearance'
  | 'agent.rename'
  | 'rooms.rename'
  | 'rooms.archive'
  | 'rooms.unarchive'
  | 'missions.create'
  | 'missions.assign_agent'
  | 'missions.unassign_agent'
  | 'missions.update_status'
  | 'memory.pin'
  | 'memory.unpin'
  | 'memory.forget'
  | 'circle.toggle_public'
  | 'check_ins.log'
  | 'automations.list'
  | 'automations.toggle_enabled'
  | 'missions.remove_task'
  | 'missions.update_task'
  | 'agent.set_spirit'
  | 'approvals.list'
  | 'approvals.request'
  | 'approvals.resolve'
  // ── Desktop automation (Phase 1b — local Claude Code bridge) ──────
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

export type OpenSwanToolDefinition = {
  name: OpenSwanRuntimeToolName;
  label: string;
  surfaces: OpenSwanToolSurface[];
  description: string;
  inputSchema?: Record<string, unknown>;
  /**
   * Optional chat-mode allowlist. When present, the tool is only exposed
   * to the model on turns running in one of these modes. When omitted,
   * the tool is mode-agnostic (available in every mode) — which matches
   * legacy behavior, so adding `modes` to a tool is purely additive.
   *
   * Mode keys come from `OPENSWAN_MODE_POLICIES` in
   * `openswanModePolicy.ts`. Use this to enforce mode semantics —
   * e.g. `review` mode should not hand the model write tools.
   */
  modes?: string[];
};

export type OpenSwanToolPolicyFamily =
  | 'code'
  | 'verification'
  | 'memory'
  | 'knowledge'
  | 'coordination'
  | 'browser'
  | 'workspace'
  | 'approval'
  | 'vault'
  | 'agent';

export type OpenSwanToolApprovalMode = 'auto' | 'ask';

export type OpenSwanToolPolicy = {
  family: OpenSwanToolPolicyFamily;
  approvalMode: OpenSwanToolApprovalMode;
  mutatesState: boolean;
  externalSideEffect: boolean;
  approvalKind?: ApprovalKind;
  summary: string;
};

export type OpenSwanToolEvent = {
  tool: OpenSwanRuntimeToolName;
  status: OpenSwanExecutionStatus;
  summary: string;
  command?: string;
  metadata?: Record<string, unknown>;
};

export type OpenSwanRuntimeToolContext = {
  circleId: string;
  userId: string;
  surface?: OpenSwanToolSurface;
  threadId?: string;
  activeSoulKey?: string;
  runId?: string;
  activePluginIds?: string[];
};

type CreateRoomWorkspaceArgs = {
  circleId: string;
  artifact: SwanBotStructuredArtifact;
};

type ApplyArtifactsArgs = {
  roomId: string;
  artifact: SwanBotStructuredArtifact;
};

type OpenPreviewArgs =
  | {
      circleId: string;
      roomId: string;
      primaryFileId?: string | null;
      preferredPanel?: 'chat' | 'playground';
    }
  | {
      roomId: string;
      primaryFileId?: string | null;
      preferredPanel?: 'chat' | 'playground';
    };

type VerificationCommandArgs = {
  command?: string;
};

type BrowserPlanTaskArgs = {
  task: string;
};

type SearchMemoriesArgs = {
  query: string;
  limit?: number;
};

type FetchUrlArgs = {
  url: string;
};

type ScheduleActionArgs = {
  kind: string;
  payload: Record<string, unknown>;
  scheduled_for?: string;
  recurrence?: string;
};

type VaultCredentialQueryArgs = {
  credentialId?: string;
  query?: string;
  platform?: string;
  action?: string;
};

type VaultGrantArgs = VaultCredentialQueryArgs & {
  grantee: string;
  granteeType?: VaultGranteeType;
  actions?: string[];
  expiresAt?: string;
  note?: string;
};

type VaultResolveTaskArgs = {
  task: string;
  platform?: string;
  siteUrl?: string;
  action?: string;
};

export type OpenSwanToolExecutionArgs = {
  'workspace.create_room': CreateRoomWorkspaceArgs;
  'workspace.apply_artifacts': ApplyArtifactsArgs;
  'workspace.open_preview': OpenPreviewArgs;
  'code.inspect': { note?: string };
  'code.generate': { note?: string };
  'code.review': { note?: string };
  'verification.typecheck': VerificationCommandArgs;
  'verification.tests': VerificationCommandArgs;
  'verification.lint': VerificationCommandArgs;
  'verification.preview': { note?: string };
  'browser.plan_task': BrowserPlanTaskArgs;
  'browser.open_url': { url: string; timeoutMs?: number; waitUntil?: 'load' | 'domcontentloaded' | 'networkidle'; taskContext?: string };
  'browser.dom_snapshot': { maxNodes?: number; interestingOnly?: boolean };
  'browser.verification_state': Record<string, never>;
  'browser.click_role': { role: string; name?: string; selector?: string; exact?: boolean; nth?: number; timeoutMs?: number; taskContext?: string };
  'browser.fill_field': { role?: string; name?: string; selector?: string; text: string; submit?: boolean; exact?: boolean; timeoutMs?: number; taskContext?: string };
  'browser.select_option': { role?: string; name?: string; selector?: string; value: string; exact?: boolean; timeoutMs?: number; taskContext?: string };
  'browser.upload_file': { filePath: string; name?: string; selector?: string; buttonRole?: string; buttonName?: string; buttonSelector?: string; exact?: boolean; timeoutMs?: number; taskContext?: string };
  'browser.press_key': { combo: string; taskContext?: string };
  'browser.screenshot': { fullPage?: boolean };
  'browser.close': Record<string, never>;
  search_memories: SearchMemoriesArgs;
  save_memory: { title: string; content: string; kind?: string };
  fetch_url: FetchUrlArgs;
  list_circle_members: Record<string, never>;
  schedule_action: ScheduleActionArgs;
  'missions.list': { status?: string };
  'missions.create_task': { missionId: string; title: string; description?: string; assigneeId?: string };
  'missions.complete_task': { taskId: string };
  'github.list_repos': Record<string, never>;
  'github.read_file': { owner: string; repo: string; path: string; branch?: string };
  'tasks.list': { status?: string };
  'tasks.get': { taskId: string };
  'tasks.create': { title: string; description?: string; priority?: string; assigneeId?: string };
  'tasks.update_status': { taskId: string; status: string };
  'tasks.assign': { taskId: string; assigneeId: string };
  'tasks.comment': { taskId: string; content: string; taskRunId?: string };
  'tasks.add_artifact': { runId: string; taskId: string; artifactKind: string; label: string; content?: string; url?: string; filePath?: string; metadata?: Record<string, unknown> };
  'goals.list': { activeOnly?: boolean };
  'goals.create': { title: string; description?: string; goalType?: string; targetValue?: number; unit?: string; dueDate?: string; ownerId?: string };
  'goals.update_progress': { goalId: string; currentValue: number };
  'goals.update_status': { goalId: string; status: string };
  'messages.list': { limit?: number };
  'messages.create': { content: string; threadId?: string; replyToId?: string };
  'check_ins.list': { limit?: number; since?: string };
  'research.search': { query: string; limit?: number };
  'research.save': { title: string; summary?: string; content?: string; domainKey?: string; tags?: string[]; sourceUrl?: string };
  'rooms.list': Record<string, never>;
  'rooms.create': { name: string; description?: string };
  'rooms.send_message': { roomId: string; content: string; messageType?: string };
  'rooms.list_tasks': { roomId: string };
  'rooms.create_task': { roomId: string; name: string; prompt: string; schedule?: string; agent?: string; taskType?: string };
  'rooms.create_file': { roomId: string; name: string; content: string; fileType?: string };
  'rooms.update_file': { fileId: string; content: string };
  'rooms.list_files': { roomId: string };
  'rooms.read_file': { fileId: string };
  'integrations.list': Record<string, never>;
  'office.list_agents': Record<string, never>;
  'agent.codex_acquire_asset': { goal: string; outputDir?: string; expectedFileName?: string; sourceUrl?: string; taskContext?: string; sessionId?: string; launchIfMissing?: boolean };
  'agent.recover_failed_task': { task: string; failureMessage: string; failureStack?: string; outcomeStatus?: string; executionKind?: string; runId?: string; planSummary?: string; groundingSummary?: string; preflightSummary?: string; source?: string; sessionId?: string; launchIfMissing?: boolean };
  'agent.build_app_capability': { task: string; appName?: string; capabilityGap?: string; desiredOutcome?: string; currentPlanSummary?: string; sessionId?: string; launchIfMissing?: boolean };
  'approvals.list': Record<string, never>;
  'approvals.request': { runId: string; approvalKind: string; title: string; description?: string; payload?: Record<string, unknown>; timeoutSeconds?: number };
  'approvals.resolve': { approvalId: string; status: 'approved' | 'rejected' };
  'vault.list': { platform?: string; query?: string; action?: string };
  'vault.find': VaultCredentialQueryArgs;
  'vault.grants': VaultCredentialQueryArgs;
  'vault.grant': VaultGrantArgs;
  'vault.revoke': VaultCredentialQueryArgs & { grantee: string; granteeType?: VaultGranteeType };
  'vault.runbook': VaultCredentialQueryArgs & { task?: string; grantee?: string; granteeType?: VaultGranteeType };
  'vault.resolve_for_task': VaultResolveTaskArgs;
  'desktop.launch_app':      { appName: string };
  'desktop.focus_app':       { appName: string };
  'desktop.type_text':       { text: string };
  'desktop.paste_text':      { text: string; appName?: string; restoreClipboard?: boolean };
  'desktop.press_keys':      { combo: string };
  'desktop.menu_click':      { appName?: string; menuPath: string[] };
  'desktop.indesign_document_status': { appName?: string; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.indesign_text_inventory': { appName?: string; query?: string; expectedDocumentName?: string; sourceDocumentPath?: string; maxItems?: number };
  'desktop.indesign_set_layer_state': { appName?: string; layerName: string; action: 'show' | 'hide' | 'lock' | 'unlock'; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.indesign_batch_find_change': { appName?: string; pairs: Array<{ findText: string; changeText: string }>; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.indesign_batch_update_text_layers': { appName?: string; updates: Array<{ fieldName: string; replacementText: string }>; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.indesign_update_text_layer': { appName?: string; fieldName: string; replacementText: string; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.indesign_relink_asset': { appName?: string; assetPath: string; linkQuery?: string; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.indesign_package_document': { appName?: string; outputFolderPath: string; includeIdml?: boolean; includePdf?: boolean; copyFonts?: boolean; copyLinkedGraphics?: boolean; copyProfiles?: boolean; updateGraphics?: boolean; includeHiddenLayers?: boolean; ignorePreflightErrors?: boolean; createReport?: boolean; forceSave?: boolean; pdfStyle?: string; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.indesign_export_proof': { appName?: string; outputPath: string; format?: 'pdf'; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.photoshop_document_status': { appName?: string; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.photoshop_layer_inventory': { appName?: string; query?: string; expectedDocumentName?: string; sourceDocumentPath?: string; maxItems?: number };
  'desktop.photoshop_set_layer_state': { appName?: string; layerName: string; action: 'show' | 'hide' | 'lock' | 'unlock'; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.photoshop_update_text_layer': { appName?: string; layerName: string; replacementText: string; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.photoshop_place_asset': { appName?: string; assetPath: string; layerName?: string; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.photoshop_export_proof': { appName?: string; outputPath: string; format?: 'png' | 'jpg' | 'jpeg'; quality?: number; expectedDocumentName?: string; sourceDocumentPath?: string };
  'desktop.list_running_apps': Record<string, never>;
  'desktop.list_browser_tabs': { browsers?: string[] };
  'desktop.window_state':      Record<string, never>;
  'desktop.clipboard':         Record<string, never>;
  'desktop.clipboard_write':   { text: string };
  'desktop.clipboard_clear':   Record<string, never>;
  'desktop.file_list':         { path: string };
  'desktop.file_read':         { path: string; maxBytes?: number };
  'desktop.file_search':       { rootPath?: string; rootPaths?: string[]; query: string; maxResults?: number; maxFiles?: number; maxDepth?: number; includeContent?: boolean; extensions?: string[] };
  'desktop.file_stat':         { path: string };
  'desktop.file_rename':       { fromPath: string; toPath: string; overwrite?: boolean };
  'desktop.file_write_text':   { path: string; content: string; append?: boolean; overwrite?: boolean };
  'desktop.file_copy':         { fromPath: string; toPath: string; overwrite?: boolean };
  'desktop.file_trash':        { path: string };
  'desktop.file_mkdir':        { path: string; recursive?: boolean };
  'desktop.shortcuts_list':    Record<string, never>;
  'desktop.shortcuts_run':     { name: string };
  'desktop.window_manage':     { action: 'focus' | 'raise' | 'minimize' | 'unminimize' | 'zoom' | 'resize'; appName?: string; width?: number; height?: number };
  'desktop.mouse_move':        { x: number; y: number };
  'desktop.mouse_click':       { x: number; y: number; button?: 'left' | 'right'; count?: number };
  'desktop.mouse_down':        { x: number; y: number; button?: 'left' | 'right' };
  'desktop.mouse_up':          { x?: number; y?: number; button?: 'left' | 'right' };
  'desktop.mouse_drag':        { fromX: number; fromY: number; toX: number; toY: number; durationMs?: number };
  'desktop.mouse_scroll':      { deltaY?: number; deltaX?: number; x?: number; y?: number };
  'desktop.wait_for_app':      { appName: string; timeoutMs?: number };
  'desktop.screenshot':        Record<string, never>;
  'desktop.open_url':          { url: string };
  'desktop.open_path':         { path: string };
  'desktop.click_at':          { x: number; y: number };
  'desktop.screen_size':       Record<string, never>;
  'desktop.read_a11y_tree':    { appName?: string; maxDepth?: number; maxNodes?: number };
  'desktop.click_element':     { pid: number; path: string };
  'desktop.set_element_value': { pid: number; path: string; text: string };
  [key: string]: Record<string, unknown>;
};

type VerificationExecutionResult = {
  ok: boolean;
  executed: boolean;
  command: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

type BrowserToolExecutionResult = {
  ok: boolean;
  resultsText: string;
  errorCode?: DesktopBridgeError;
  recoveryHint?: string;
  requiredEvidence?: string[];
};

function browserToolFailureResult(result: DesktopResult<unknown>, fallback: string): BrowserToolExecutionResult {
  return {
    ok: false,
    resultsText: result.error || fallback,
    errorCode: result.errorCode,
    recoveryHint: result.recoveryHint,
    requiredEvidence: result.requiredEvidence,
  };
}

export type OpenSwanToolExecutionResultMap = {
  'workspace.create_room': WorkspaceCreationResult;
  'workspace.apply_artifacts': RoomArtifactApplyResult;
  'workspace.open_preview': { ok: true };
  'code.inspect': { ok: true; planned: true };
  'code.generate': { ok: true; planned: true };
  'code.review': { ok: true; planned: true };
  'verification.typecheck': VerificationExecutionResult;
  'verification.tests': VerificationExecutionResult;
  'verification.lint': VerificationExecutionResult;
  'verification.preview': { ok: true; planned: true };
  'browser.plan_task': { ok: true; summaryText: string; backend: string; actionCount: number; requiresApproval: boolean; plan: BrowserPlanCardData };
  'browser.open_url': BrowserToolExecutionResult;
  'browser.dom_snapshot': BrowserToolExecutionResult;
  'browser.verification_state': BrowserToolExecutionResult;
  'browser.click_role': BrowserToolExecutionResult;
  'browser.fill_field': BrowserToolExecutionResult;
  'browser.select_option': BrowserToolExecutionResult;
  'browser.upload_file': BrowserToolExecutionResult;
  'browser.press_key': BrowserToolExecutionResult;
  'browser.screenshot': BrowserToolExecutionResult & { base64?: string; mimeType?: string; sizeBytes?: number };
  'browser.close': BrowserToolExecutionResult;
  search_memories: { ok: boolean; resultsText: string };
  save_memory: { ok: boolean; resultsText: string };
  'missions.list': { ok: boolean; resultsText: string };
  'missions.create_task': { ok: boolean; resultsText: string };
  'missions.complete_task': { ok: boolean; resultsText: string };
  'github.list_repos': { ok: boolean; resultsText: string };
  'github.read_file': { ok: boolean; resultsText: string };
  'tasks.list': { ok: boolean; resultsText: string };
  'tasks.get': { ok: boolean; resultsText: string };
  'tasks.create': { ok: boolean; resultsText: string };
  'tasks.update_status': { ok: boolean; resultsText: string };
  'tasks.assign': { ok: boolean; resultsText: string };
  'tasks.comment': { ok: boolean; resultsText: string };
  'tasks.add_artifact': { ok: boolean; resultsText: string };
  'goals.list': { ok: boolean; resultsText: string };
  'goals.create': { ok: boolean; resultsText: string };
  'goals.update_progress': { ok: boolean; resultsText: string };
  'goals.update_status': { ok: boolean; resultsText: string };
  'messages.list': { ok: boolean; resultsText: string };
  'messages.create': { ok: boolean; resultsText: string };
  'check_ins.list': { ok: boolean; resultsText: string };
  'research.search': { ok: boolean; resultsText: string };
  'research.save': { ok: boolean; resultsText: string };
  'rooms.list': { ok: boolean; resultsText: string };
  'rooms.create': { ok: boolean; resultsText: string };
  'rooms.send_message': { ok: boolean; resultsText: string };
  'rooms.list_tasks': { ok: boolean; resultsText: string };
  'rooms.create_task': { ok: boolean; resultsText: string };
  'rooms.create_file': { ok: boolean; resultsText: string };
  'rooms.update_file': { ok: boolean; resultsText: string };
  'rooms.list_files': { ok: boolean; resultsText: string };
  'rooms.read_file': { ok: boolean; resultsText: string };
  'integrations.list': { ok: boolean; resultsText: string };
  'office.list_agents': { ok: boolean; resultsText: string };
  'agent.codex_acquire_asset': { ok: boolean; resultsText: string; provider?: string; sessionId?: string; launched?: boolean };
  'agent.recover_failed_task': { ok: boolean; resultsText: string; provider?: string; sessionId?: string; launched?: boolean; recoveryAction?: string; recoveryRunbook?: Record<string, unknown> };
  'agent.build_app_capability': { ok: boolean; resultsText: string; provider?: string; sessionId?: string; launched?: boolean; buildoutKind?: string; risk?: string; appName?: string };
  'circle.update_settings':    { ok: boolean; resultsText: string };
  'circle.update_budget_caps': { ok: boolean; resultsText: string };
  'circle.update_office_theme':{ ok: boolean; resultsText: string };
  'agent.update_appearance':   { ok: boolean; resultsText: string };
  'agent.rename':              { ok: boolean; resultsText: string };
  'rooms.rename':              { ok: boolean; resultsText: string };
  'rooms.archive':             { ok: boolean; resultsText: string };
  'rooms.unarchive':           { ok: boolean; resultsText: string };
  'missions.create':           { ok: boolean; resultsText: string };
  'missions.assign_agent':     { ok: boolean; resultsText: string };
  'missions.unassign_agent':   { ok: boolean; resultsText: string };
  'missions.update_status':    { ok: boolean; resultsText: string };
  'circle.toggle_public':      { ok: boolean; resultsText: string };
  'memory.pin':                { ok: boolean; resultsText: string };
  'memory.unpin':              { ok: boolean; resultsText: string };
  'memory.forget':             { ok: boolean; resultsText: string };
  'check_ins.log':             { ok: boolean; resultsText: string };
  'automations.list':          { ok: boolean; resultsText: string };
  'automations.toggle_enabled':{ ok: boolean; resultsText: string };
  'missions.remove_task':      { ok: boolean; resultsText: string };
  'missions.update_task':      { ok: boolean; resultsText: string };
  'agent.set_spirit':          { ok: boolean; resultsText: string };
  'approvals.list': { ok: boolean; resultsText: string };
  'approvals.request': { ok: boolean; resultsText: string };
  'approvals.resolve': { ok: boolean; resultsText: string };
  'vault.list': { ok: boolean; resultsText: string };
  'vault.find': { ok: boolean; resultsText: string };
  'vault.grants': { ok: boolean; resultsText: string };
  'vault.grant': { ok: boolean; resultsText: string };
  'vault.revoke': { ok: boolean; resultsText: string };
  'vault.runbook': { ok: boolean; resultsText: string };
  'vault.resolve_for_task': { ok: boolean; resultsText: string };
  'desktop.launch_app':        { ok: boolean; resultsText: string };
  'desktop.focus_app':         { ok: boolean; resultsText: string };
  'desktop.type_text':         { ok: boolean; resultsText: string };
  'desktop.paste_text':        { ok: boolean; resultsText: string };
  'desktop.press_keys':        { ok: boolean; resultsText: string };
  'desktop.menu_click':        { ok: boolean; resultsText: string };
  'desktop.indesign_document_status': { ok: boolean; resultsText: string };
  'desktop.indesign_text_inventory': { ok: boolean; resultsText: string };
  'desktop.indesign_set_layer_state': { ok: boolean; resultsText: string };
  'desktop.indesign_batch_find_change': { ok: boolean; resultsText: string };
  'desktop.indesign_batch_update_text_layers': { ok: boolean; resultsText: string };
  'desktop.indesign_update_text_layer': { ok: boolean; resultsText: string };
  'desktop.indesign_relink_asset': { ok: boolean; resultsText: string };
  'desktop.indesign_package_document': { ok: boolean; resultsText: string };
  'desktop.indesign_export_proof': { ok: boolean; resultsText: string };
  'desktop.photoshop_document_status': { ok: boolean; resultsText: string };
  'desktop.photoshop_layer_inventory': { ok: boolean; resultsText: string };
  'desktop.photoshop_set_layer_state': { ok: boolean; resultsText: string };
  'desktop.photoshop_update_text_layer': { ok: boolean; resultsText: string };
  'desktop.photoshop_place_asset': { ok: boolean; resultsText: string };
  'desktop.photoshop_export_proof': { ok: boolean; resultsText: string };
  'desktop.list_running_apps': { ok: boolean; resultsText: string };
  'desktop.list_browser_tabs': { ok: boolean; resultsText: string };
  'desktop.window_state':      { ok: boolean; resultsText: string };
  'desktop.clipboard':         { ok: boolean; resultsText: string };
  'desktop.clipboard_write':   { ok: boolean; resultsText: string };
  'desktop.clipboard_clear':   { ok: boolean; resultsText: string };
  'desktop.file_list':         { ok: boolean; resultsText: string };
  'desktop.file_read':         { ok: boolean; resultsText: string };
  'desktop.file_search':       { ok: boolean; resultsText: string };
  'desktop.file_stat':         { ok: boolean; resultsText: string };
  'desktop.file_rename':       { ok: boolean; resultsText: string };
  'desktop.file_write_text':   { ok: boolean; resultsText: string };
  'desktop.file_copy':         { ok: boolean; resultsText: string };
  'desktop.file_trash':        { ok: boolean; resultsText: string };
  'desktop.file_mkdir':        { ok: boolean; resultsText: string };
  'desktop.shortcuts_list':    { ok: boolean; resultsText: string };
  'desktop.shortcuts_run':     { ok: boolean; resultsText: string };
  'desktop.window_manage':     { ok: boolean; resultsText: string };
  'desktop.mouse_move':        { ok: boolean; resultsText: string };
  'desktop.mouse_click':       { ok: boolean; resultsText: string };
  'desktop.mouse_down':        { ok: boolean; resultsText: string };
  'desktop.mouse_up':          { ok: boolean; resultsText: string };
  'desktop.mouse_drag':        { ok: boolean; resultsText: string };
  'desktop.mouse_scroll':      { ok: boolean; resultsText: string };
  'desktop.wait_for_app':      { ok: boolean; resultsText: string };
  'desktop.screenshot':        { ok: boolean; resultsText: string; base64?: string; mimeType?: string; sizeBytes?: number };
  'desktop.open_url':          { ok: boolean; resultsText: string };
  'desktop.open_path':         { ok: boolean; resultsText: string };
  'desktop.click_at':          { ok: boolean; resultsText: string };
  'desktop.screen_size':       { ok: boolean; resultsText: string; width?: number; height?: number };
  'desktop.read_a11y_tree':    { ok: boolean; resultsText: string };
  'desktop.click_element':     { ok: boolean; resultsText: string };
  'desktop.set_element_value': { ok: boolean; resultsText: string };
  fetch_url: { ok: boolean; content: string; status?: number; statusText?: string; error?: string };
  list_circle_members: { ok: true; resultsText: string };
  schedule_action: { ok: boolean; resultText: string; actionId?: string; error?: string };
  [key: string]: Record<string, unknown>;
};

const DEFAULT_VERIFICATION_COMMANDS: Record<'verification.typecheck' | 'verification.tests' | 'verification.lint', string> = {
  'verification.typecheck': 'npm run typecheck:app',
  'verification.tests': 'npm test',
  'verification.lint': 'npm run lint',
};

const TOOL_DEFINITIONS: OpenSwanToolDefinition[] = [
  {
    name: 'workspace.create_room',
    label: 'Create Room Workspace',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Create or switch into a room-backed workspace for multi-file iteration.',
  },
  {
    name: 'workspace.apply_artifacts',
    label: 'Apply Artifacts',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Turn generated artifacts into room files and workspace state.',
  },
  {
    name: 'workspace.open_preview',
    label: 'Open Preview',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Open a generated UI or webpage in a room preview/sandbox.',
  },
  {
    name: 'browser.plan_task',
    label: 'Plan Browser Task',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Plan browser automation with Browserbase support for data retrieval, Stagehand-style semantic actions, form submissions, saved-login guardrails, output shape, and approval gates.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The browser task to plan.' },
      },
      required: ['task'],
    },
  },
  {
    name: 'browser.open_url',
    label: 'Open Local Browser URL',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Navigate the persistent local Playwright browser profile to a URL. Use when logged-in browser state matters.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        timeoutMs: { type: 'number' },
        waitUntil: { type: 'string' },
        taskContext: { type: 'string', description: 'Original user task or action context for guarded browser popup decisions.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser.dom_snapshot',
    label: 'Read Browser DOM Snapshot',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Read a compact DOM/ARIA snapshot from the persistent local browser. Prefer before role clicks/fills and extraction.',
    inputSchema: {
      type: 'object',
      properties: {
        maxNodes: { type: 'number' },
        interestingOnly: { type: 'boolean' },
      },
    },
  },
  {
    name: 'browser.verification_state',
    label: 'Check Browser Verification Gate',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Read-only check for CAPTCHA, anti-bot, Cloudflare, MFA, or human verification on the current browser page. If detected, pause automation and ask the user to complete it manually.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser.click_role',
    label: 'Click Browser Element',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Click a browser element by ARIA role/name or selector using Playwright locator auto-waiting. Never click CAPTCHA, MFA, or "not a robot" verification controls; use browser.verification_state and pause for the human instead.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        selector: { type: 'string' },
        exact: { type: 'boolean' },
        nth: { type: 'number' },
        timeoutMs: { type: 'number' },
        taskContext: { type: 'string', description: 'Original user task or action context for guarded browser popup decisions.' },
      },
      required: ['role'],
    },
  },
  {
    name: 'browser.fill_field',
    label: 'Fill Browser Field',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Fill a browser field by ARIA role/name or selector in the persistent local browser profile. Do not fill one-time verification, MFA, CAPTCHA, or bot-check fields; pause for the human instead.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        selector: { type: 'string' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
        exact: { type: 'boolean' },
        timeoutMs: { type: 'number' },
        taskContext: { type: 'string', description: 'Original user task or action context for guarded browser popup decisions.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser.select_option',
    label: 'Select Browser Option',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Select a dropdown/combobox option by ARIA role/name or selector in the persistent local browser profile.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        selector: { type: 'string' },
        value: { type: 'string' },
        exact: { type: 'boolean' },
        timeoutMs: { type: 'number' },
        taskContext: { type: 'string', description: 'Original user task or action context for guarded browser popup decisions.' },
      },
      required: ['value'],
    },
  },
  {
    name: 'browser.upload_file',
    label: 'Upload Browser File',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Attach a verified local file to a browser file input or file chooser. Requires a local file session grant; do not use for bot verification uploads or credential files.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string' },
        name: { type: 'string' },
        selector: { type: 'string' },
        buttonRole: { type: 'string' },
        buttonName: { type: 'string' },
        buttonSelector: { type: 'string' },
        exact: { type: 'boolean' },
        timeoutMs: { type: 'number' },
        taskContext: { type: 'string', description: 'Original user task or action context for guarded browser popup decisions.' },
      },
      required: ['filePath'],
    },
  },
  {
    name: 'browser.press_key',
    label: 'Press Browser Key',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Press a key or key combo in the persistent browser page.',
    inputSchema: { type: 'object', properties: { combo: { type: 'string' }, taskContext: { type: 'string', description: 'Original user task or action context for guarded browser popup decisions.' } }, required: ['combo'] },
  },
  {
    name: 'browser.screenshot',
    label: 'Browser Screenshot',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Capture a PNG screenshot of the persistent browser page for visual verification.',
    inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean' } } },
  },
  {
    name: 'browser.close',
    label: 'Close Local Browser',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Close the persistent local browser context when the user asks to reset/stop it.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'code.inspect',
    label: 'Inspect Code',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Read and inspect relevant code or surrounding context before taking action.',
  },
  {
    name: 'code.generate',
    label: 'Generate Code',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Produce implementation-ready code, files, or structured artifacts.',
  },
  {
    name: 'code.review',
    label: 'Review Code',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Produce a severity-ranked code review with concrete findings.',
  },
  {
    name: 'verification.typecheck',
    label: 'Typecheck',
    surfaces: ['room_chat', 'task_run', 'office'],
    description: 'Validate that code compiles and type contracts still hold.',
  },
  {
    name: 'verification.tests',
    label: 'Run Tests',
    surfaces: ['room_chat', 'task_run', 'office'],
    description: 'Run or recommend tests and regression checks for the current task.',
  },
  {
    name: 'verification.lint',
    label: 'Lint',
    surfaces: ['room_chat', 'task_run', 'office'],
    description: 'Check style and static-analysis quality expectations.',
  },
  {
    name: 'verification.preview',
    label: 'Preview',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Preview generated UI or webpage output.',
    inputSchema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'Optional note about what should be previewed.' },
      },
    },
  },
  {
    name: 'search_memories',
    label: 'Search Memories',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Search the circle memory store for relevant decisions, facts, and prior context.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for in memory.' },
        limit: { type: 'number', description: 'Maximum results to return.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    label: 'Fetch URL',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Fetch a public URL and return its text content.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'list_circle_members',
    label: 'List Circle Members',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'List the members of the current circle.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'schedule_action',
    label: 'Schedule Action',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Queue an automated action such as a tweet, Slack post, email, webhook, or reminder.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'Action kind (tweet, slack_post, webhook, reminder, etc.)' },
        payload: { type: 'object', description: 'Action-specific payload.' },
        scheduled_for: { type: 'string', description: 'Optional ISO timestamp for execution.' },
        recurrence: { type: 'string', description: 'Optional cron expression or natural-language recurrence.' },
      },
      required: ['kind', 'payload'],
    },
  },
  // ── Missions ──────────────────────────────────────────────────────────────
  {
    name: 'missions.list',
    label: 'List Missions',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List active missions in this circle with progress, tasks, and deadlines.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'Filter by status: active, completed, archived. Default: active.' } } },
  },
  {
    name: 'missions.create_task',
    label: 'Create Mission Task',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Add a new task to an existing mission.',
    inputSchema: { type: 'object', properties: { missionId: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, assigneeId: { type: 'string' } }, required: ['missionId', 'title'] },
  },
  {
    name: 'missions.complete_task',
    label: 'Complete Mission Task',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Mark a mission task as done.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  // ── GitHub ────────────────────────────────────────────────────────────────
  {
    name: 'github.list_repos',
    label: 'List GitHub Repos',
    surfaces: ['main_chat', 'room_chat'],
    description: 'List repositories connected to this circle via GitHub.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'github.read_file',
    label: 'Read GitHub File',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Read the contents of a file from a GitHub repository.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' }, branch: { type: 'string' } }, required: ['owner', 'repo', 'path'] },
  },
  // ── Tasks (Kanban) ────────────────────────────────────────────────────────
  {
    name: 'tasks.list',
    label: 'List Tasks',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List kanban tasks in this circle, optionally filtered by status.',
    inputSchema: { type: 'object', properties: { status: { type: 'string', description: 'backlog, todo, in_progress, peer_review, review, approved, done, mine, open, or all.' } } },
  },
  {
    name: 'tasks.get',
    label: 'Get Task',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Load one task with status, priority, assignee, and description.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' } }, required: ['taskId'] },
  },
  {
    name: 'tasks.create',
    label: 'Create Task',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Create a new kanban task in this circle.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, priority: { type: 'string' }, assigneeId: { type: 'string' } }, required: ['title'] },
  },
  {
    name: 'tasks.update_status',
    label: 'Update Task Status',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Move a task to a new kanban status.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string' } }, required: ['taskId', 'status'] },
  },
  {
    name: 'tasks.assign',
    label: 'Assign Task',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Assign an existing task to a circle member.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, assigneeId: { type: 'string' } }, required: ['taskId', 'assigneeId'] },
  },
  {
    name: 'tasks.comment',
    label: 'Comment On Task',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Add a comment or progress note to a task.',
    inputSchema: { type: 'object', properties: { taskId: { type: 'string' }, content: { type: 'string' }, taskRunId: { type: 'string' } }, required: ['taskId', 'content'] },
  },
  {
    name: 'tasks.add_artifact',
    label: 'Add Task Artifact',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Attach a durable artifact to a task run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        taskId: { type: 'string' },
        artifactKind: { type: 'string' },
        label: { type: 'string' },
        content: { type: 'string' },
        url: { type: 'string' },
        filePath: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['runId', 'taskId', 'artifactKind', 'label'],
    },
  },
  // ── Goals ─────────────────────────────────────────────────────────────────
  {
    name: 'goals.list',
    label: 'List Goals',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List circle goals and current progress.',
    inputSchema: { type: 'object', properties: { activeOnly: { type: 'boolean' } } },
  },
  {
    name: 'goals.create',
    label: 'Create Goal',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Create a new circle goal.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string' },
        goalType: { type: 'string' },
        targetValue: { type: 'number' },
        unit: { type: 'string' },
        dueDate: { type: 'string' },
        ownerId: { type: 'string' },
      },
      required: ['title'],
    },
  },
  {
    name: 'goals.update_progress',
    label: 'Update Goal Progress',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Update the numeric progress of a goal.',
    inputSchema: { type: 'object', properties: { goalId: { type: 'string' }, currentValue: { type: 'number' } }, required: ['goalId', 'currentValue'] },
  },
  {
    name: 'goals.update_status',
    label: 'Update Goal Status',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Change a goal status such as active, paused, completed, or archived.',
    inputSchema: { type: 'object', properties: { goalId: { type: 'string' }, status: { type: 'string' } }, required: ['goalId', 'status'] },
  },
  // ── Chat + Check-ins ──────────────────────────────────────────────────────
  {
    name: 'messages.list',
    label: 'List Messages',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List recent circle chat messages for context.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } } },
  },
  {
    name: 'messages.create',
    label: 'Post Message',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Post a new message into the current circle chat thread.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        threadId: { type: 'string' },
        replyToId: { type: 'string' },
      },
      required: ['content'],
    },
  },
  {
    name: 'check_ins.list',
    label: 'List Check-Ins',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List recent circle check-ins and daily updates.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' }, since: { type: 'string' } } },
  },
  // ── Research ──────────────────────────────────────────────────────────────
  {
    name: 'research.search',
    label: 'Search Research',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Search the curated research corpus for relevant digests, reports, and notes.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  },
  {
    name: 'research.save',
    label: 'Save Research',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Persist a new research note or finding into the research corpus.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        content: { type: 'string' },
        domainKey: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        sourceUrl: { type: 'string' },
      },
      required: ['title'],
    },
  },
  // ── Rooms ─────────────────────────────────────────────────────────────────
  {
    name: 'rooms.list',
    label: 'List Rooms',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List rooms/projects in this circle.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'rooms.create',
    label: 'Create Room',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Create a new room/project in this circle.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'rooms.send_message',
    label: 'Send Room Message',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Post a message into a room conversation.',
    inputSchema: { type: 'object', properties: { roomId: { type: 'string' }, content: { type: 'string' }, messageType: { type: 'string' } }, required: ['roomId', 'content'] },
  },
  {
    name: 'rooms.list_tasks',
    label: 'List Room Tasks',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List automation or runner tasks attached to a room.',
    inputSchema: { type: 'object', properties: { roomId: { type: 'string' } }, required: ['roomId'] },
  },
  {
    name: 'rooms.create_task',
    label: 'Create Room Task',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Create a room automation/task runner entry.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        name: { type: 'string' },
        prompt: { type: 'string' },
        schedule: { type: 'string' },
        agent: { type: 'string' },
        taskType: { type: 'string' },
      },
      required: ['roomId', 'name', 'prompt'],
    },
  },
  {
    name: 'rooms.create_file',
    label: 'Create Room File',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Create a file inside an existing room.',
    inputSchema: {
      type: 'object',
      properties: {
        roomId: { type: 'string' },
        name: { type: 'string' },
        content: { type: 'string' },
        fileType: { type: 'string' },
      },
      required: ['roomId', 'name', 'content'],
    },
  },
  {
    name: 'rooms.update_file',
    label: 'Update Room File',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Update the content of an existing room file.',
    inputSchema: { type: 'object', properties: { fileId: { type: 'string' }, content: { type: 'string' } }, required: ['fileId', 'content'] },
  },
  // ── Room Files ────────────────────────────────────────────────────────────
  {
    name: 'rooms.list_files',
    label: 'List Room Files',
    surfaces: ['main_chat', 'room_chat'],
    description: 'List files in a project room.',
    inputSchema: { type: 'object', properties: { roomId: { type: 'string' } }, required: ['roomId'] },
  },
  {
    name: 'rooms.read_file',
    label: 'Read Room File',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Read the contents of a file in a project room.',
    inputSchema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] },
  },
  // ── Memory Write ──────────────────────────────────────────────────────────
  {
    name: 'save_memory',
    label: 'Save Memory',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Save a new memory (fact, decision, preference, instruction) to the circle memory store.',
    inputSchema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' }, kind: { type: 'string', description: 'preference, fact, decision, finding, instruction' } }, required: ['title', 'content'] },
  },
  // ── WordPress Admin ──────────────────────────────────────────────────────
  {
    name: 'wp.discover_types',
    label: 'WP Discover Types',
    surfaces: ['main_chat', 'room_chat'],
    description: 'List available post types on a WordPress site — discovers if plugins like DI Slides register REST endpoints.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string', description: 'WordPress site URL e.g. https://example.com/wp' }, onePasswordItem: { type: 'string', description: '1Password item name with WP credentials' } }, required: ['siteUrl', 'onePasswordItem'] },
  },
  {
    name: 'wp.upload_media',
    label: 'WP Upload Media',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Upload an image or file from chat attachments to a WordPress site media library.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, onePasswordItem: { type: 'string' }, storagePath: { type: 'string', description: 'Supabase Storage path of the attachment' }, fileName: { type: 'string' }, mimeType: { type: 'string' } }, required: ['siteUrl', 'onePasswordItem', 'storagePath', 'fileName'] },
  },
  {
    name: 'wp.create_slide',
    label: 'WP Create Slide',
    surfaces: ['main_chat', 'room_chat'],
    description: 'Upload an image and create a DI Slides slide on a WordPress site in one step.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, onePasswordItem: { type: 'string' }, storagePath: { type: 'string' }, fileName: { type: 'string' }, mimeType: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', description: 'draft or publish' } }, required: ['siteUrl', 'onePasswordItem', 'storagePath', 'fileName'] },
  },
  {
    name: 'wp.list_posts',
    label: 'WP List Posts',
    surfaces: ['main_chat', 'room_chat'],
    description: 'List posts or custom post type items from a WordPress site.',
    inputSchema: { type: 'object', properties: { siteUrl: { type: 'string' }, onePasswordItem: { type: 'string' }, postType: { type: 'string', description: 'e.g. posts, pages, flavor_di_slides' }, perPage: { type: 'number' } }, required: ['siteUrl', 'onePasswordItem'] },
  },
  {
    name: 'credentials.get',
    label: 'Get Credentials',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Fetch credentials from 1Password. Returns field values for the named item. Never exposes credentials to the user.',
    inputSchema: { type: 'object', properties: { item: { type: 'string', description: '1Password item name' }, vault: { type: 'string' }, fields: { type: 'array', items: { type: 'string' } } }, required: ['item'] },
  },
  // ── Circle Vault Automation Access ───────────────────────────────────────
  {
    name: 'vault.list',
    label: 'List Vault Credentials',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'List saved circle vault credentials as redacted automation summaries. Does not return secrets.',
    inputSchema: { type: 'object', properties: { platform: { type: 'string' }, query: { type: 'string' }, action: { type: 'string', description: 'Filter to credentials allowing this action, e.g. login, post, edit.' } } },
  },
  {
    name: 'vault.find',
    label: 'Find Vault Credential',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Find a saved vault credential by id, platform, label, username, URL, tag, or grantee. Does not return secrets.',
    inputSchema: { type: 'object', properties: { credentialId: { type: 'string' }, query: { type: 'string' }, platform: { type: 'string' }, action: { type: 'string' } } },
  },
  {
    name: 'vault.grants',
    label: 'List Vault Grants',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Show which agents, chat surfaces, members, or OpenSwan runtimes have scoped access to matching saved credentials.',
    inputSchema: { type: 'object', properties: { credentialId: { type: 'string' }, query: { type: 'string' }, platform: { type: 'string' } } },
  },
  {
    name: 'vault.grant',
    label: 'Grant Vault Access',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Grant scoped automation access to a saved credential. Secrets still stay in the vault; agents receive credential IDs and allowed actions only. Requires approval.',
    inputSchema: {
      type: 'object',
      properties: {
        credentialId: { type: 'string' },
        query: { type: 'string', description: 'Credential search query when credentialId is not known.' },
        platform: { type: 'string' },
        grantee: { type: 'string', description: 'Agent, member, chat, or runtime name.' },
        granteeType: { type: 'string', enum: ['agent', 'runtime', 'chat', 'member', 'openswan'] },
        actions: { type: 'array', items: { type: 'string' }, description: 'Scoped actions to grant. Must already be allowed by the credential policy.' },
        expiresAt: { type: 'string', description: 'Optional ISO date/time when the grant expires.' },
        note: { type: 'string' },
      },
      required: ['grantee'],
    },
  },
  {
    name: 'vault.revoke',
    label: 'Revoke Vault Access',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Remove a scoped automation grant from a saved vault credential. Requires approval.',
    inputSchema: {
      type: 'object',
      properties: {
        credentialId: { type: 'string' },
        query: { type: 'string' },
        platform: { type: 'string' },
        grantee: { type: 'string' },
        granteeType: { type: 'string', enum: ['agent', 'runtime', 'chat', 'member', 'openswan'] },
      },
      required: ['grantee'],
    },
  },
  {
    name: 'vault.runbook',
    label: 'Build Vault Runbook',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Build safe agent instructions for using a saved login through Computer Use. Includes credential id, allowed actions, origins, and fill_saved_login guidance, but never returns the secret.',
    inputSchema: {
      type: 'object',
      properties: {
        credentialId: { type: 'string' },
        query: { type: 'string' },
        platform: { type: 'string' },
        task: { type: 'string' },
        grantee: { type: 'string' },
        granteeType: { type: 'string', enum: ['agent', 'runtime', 'chat', 'member', 'openswan'] },
      },
    },
  },
  {
    name: 'vault.resolve_for_task',
    label: 'Resolve Vault For Task',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Find the best saved credential for a login-dependent website automation task and return a safe runbook. Does not reveal secrets.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Website automation task, e.g. log into WordPress and draft a post.' },
        platform: { type: 'string' },
        siteUrl: { type: 'string' },
        action: { type: 'string', description: 'Requested action, e.g. login, post, edit.' },
      },
      required: ['task'],
    },
  },
  // ── Integrations + Office ─────────────────────────────────────────────────
  {
    name: 'integrations.list',
    label: 'List Integrations',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List installed circle integrations and capability flags.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'office.list_agents',
    label: 'List Office Agents',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List published office agents and their current live status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'agent.codex_acquire_asset',
    label: 'Acquire Asset With Codex',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description:
      'Delegate safe asset/resource acquisition to an attached managed Codex terminal session. Use for downloads, generated assets, packages, templates, datasets, or missing files needed to complete a browser/desktop task. Requires desktop.file_search/stat verification before use.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'Exact asset, file, dependency, or resource to acquire or prepare.' },
        outputDir: { type: 'string', description: 'Scoped local output directory for the acquired artifacts.' },
        expectedFileName: { type: 'string', description: 'Expected file name when known.' },
        sourceUrl: { type: 'string', description: 'Known public source URL when provided by the user.' },
        taskContext: { type: 'string', description: 'Short downstream browser/desktop workflow context.' },
        sessionId: { type: 'string', description: 'Managed Codex terminal session id to reuse.' },
        launchIfMissing: { type: 'boolean', description: 'Launch a scoped Codex session when no managed session is available.' },
      },
      required: ['goal'],
    },
  },
  {
    name: 'agent.recover_failed_task',
    label: 'Recover Failed Task With Codex',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description:
      'Delegate failed chat/computer/browser/app task diagnosis to an attached managed Codex session. The recovery agent can patch local app/runtime issues, recommend bridge fixes, or produce a safe retry plan without using credentials or bypassing human verification.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Original user task that failed.' },
        failureMessage: { type: 'string', description: 'Observed failure, blocker, warning, or stack summary.' },
        failureStack: { type: 'string', description: 'Optional stack trace or raw diagnostic text.' },
        outcomeStatus: { type: 'string', description: 'failed, blocked, warning, or completed_with_warnings.' },
        executionKind: { type: 'string', description: 'Runtime/execution path that failed.' },
        runId: { type: 'string', description: 'Optional run ledger id.' },
        planSummary: { type: 'string', description: 'Planner summary when available.' },
        groundingSummary: { type: 'string', description: 'DOM/a11y/screenshot/file grounding summary when available.' },
        preflightSummary: { type: 'string', description: 'Preflight summary when available.' },
        source: { type: 'string', description: 'Failure source identifier.' },
        sessionId: { type: 'string', description: 'Managed Codex terminal session id to reuse.' },
        launchIfMissing: { type: 'boolean', description: 'Launch a scoped Codex recovery session when no managed session is available.' },
      },
      required: ['task', 'failureMessage'],
    },
  },
  {
    name: 'agent.build_app_capability',
    label: 'Build Missing App Capability With Codex',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description:
      'Delegate a bounded app-capability buildout to an attached managed Codex session when chat/SwanBot does not yet have a pipeline, adapter, recipe, bridge tool, or smoke test for an unfamiliar desktop/native app task.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Original user task that requires app control.' },
        appName: { type: 'string', description: 'Target desktop/native app name when known.' },
        capabilityGap: { type: 'string', description: 'What is missing: app recipe, adapter, bridge tool, planner route, smoke, or fallback.' },
        desiredOutcome: { type: 'string', description: 'What the chat should be able to do after the buildout.' },
        currentPlanSummary: { type: 'string', description: 'Planner/preflight/grounding summary or current runtime blocker.' },
        sessionId: { type: 'string', description: 'Managed Codex terminal session id to reuse.' },
        launchIfMissing: { type: 'boolean', description: 'Launch a scoped Codex buildout session when no managed session is available.' },
      },
      required: ['task'],
    },
  },
  // ── Circle / Agent / Office editing tools ────────────────────────
  {
    name: 'circle.update_settings',
    label: 'Update Circle Settings',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Update a circle\'s top-level settings: name, description, icon, accent color, vibe, or tags. Only fields that are passed get updated. Matches what the user can edit in Circle Settings → Name & Description.',
    inputSchema: {
      type: 'object',
      properties: {
        name:         { type: 'string',  description: 'New circle name (trimmed).' },
        description:  { type: 'string',  description: 'New circle description.' },
        icon:         { type: 'string',  description: 'Emoji or glyph to use as circle icon.' },
        accent_color: { type: 'string',  description: 'Hex color like #6366f1 — the per-circle accent used for UI tints.' },
        vibe:         { type: 'string',  description: 'Short vibe string (the "GRINDING MODE 🔥" line).' },
        tags:         { type: 'array',   description: 'Replacement tag list.', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'circle.update_budget_caps',
    label: 'Update Budget Caps',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Update the circle\'s three budget caps: per-run Computer Use, 24h Automation, and 24h Claude total umbrella. Pass only the fields to change — the others are preserved. Pass a number in USD.',
    inputSchema: {
      type: 'object',
      properties: {
        computer_use_max_cost_usd: { type: 'number', description: 'Per-run Computer Use cap in USD. Default $2.' },
        automation_max_cost_usd:   { type: 'number', description: 'Rolling 24h automation cap in USD. Default $1.' },
        claude_total_max_cost_usd: { type: 'number', description: 'Umbrella 24h Claude total cap across every agent. Default $10.' },
      },
    },
  },
  {
    name: 'circle.update_office_theme',
    label: 'Update Office Theme',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Switch the circle\'s Office theme. `theme_id` is one of the built-in keys (office | ship | castle | station | submarine | mansion | lair | cabin | arctic | cyber | garden | temple) or a custom theme id prefixed with custom_.',
    inputSchema: {
      type: 'object',
      properties: {
        theme_id:         { type: 'string', description: 'Theme id — built-in key or custom_<uuid>.' },
        environment_type: { type: 'string', description: 'Optional environment_type override if the theme doesn\'t already set it.' },
      },
      required: ['theme_id'],
    },
  },
  {
    name: 'agent.update_appearance',
    label: 'Update Agent Appearance',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Update a single agent\'s pixel-art customization. Pass the agent name (e.g. "BlackSwan") and a `patch` with any of the 14 appearance properties: skinTone, hairStyle, hairColor, shirtColor, pantsColor, shoeColor, accessory, hat, expression, backItem, eyeColor, facialHair, pet, aura. Only patched props change; everything else stays.',
    inputSchema: {
      type: 'object',
      properties: {
        agent_name: { type: 'string', description: 'The agent to update (must match agent.name exactly, e.g. "BlackSwan").' },
        patch:      { type: 'object', description: 'Partial AgentAppearance — any subset of the 14 customization props.' },
      },
      required: ['agent_name', 'patch'],
    },
  },
  {
    name: 'agent.rename',
    label: 'Rename Agent',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Rename a published office agent. Pass the current agent id and the new name (1–32 chars, no slashes).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string', description: 'The agent\'s id from `circle_office_agents`.' },
        new_name: { type: 'string', description: 'New display name for the agent.' },
      },
      required: ['agent_id', 'new_name'],
    },
  },
  {
    name: 'rooms.rename',
    label: 'Rename Room',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Rename an existing room in this circle. Reversible — call again with any other name to undo.',
    inputSchema: {
      type: 'object',
      properties: {
        room_id: { type: 'string', description: 'The room\'s id.' },
        name:    { type: 'string', description: 'New room name.' },
      },
      required: ['room_id', 'name'],
    },
  },
  {
    name: 'rooms.archive',
    label: 'Archive Room',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Archive a room. Hidden from the active rooms list but not deleted — call rooms.unarchive to restore.',
    inputSchema: {
      type: 'object',
      properties: { room_id: { type: 'string' } },
      required: ['room_id'],
    },
  },
  {
    name: 'rooms.unarchive',
    label: 'Unarchive Room',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Restore a previously-archived room to the active list.',
    inputSchema: {
      type: 'object',
      properties: { room_id: { type: 'string' } },
      required: ['room_id'],
    },
  },
  {
    name: 'missions.create',
    label: 'Create Mission',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Create a new circle mission. Missions are the core accountability loop — title + optional description + optional ISO deadline. The creator becomes the owner; they can reassign later in the UI.',
    inputSchema: {
      type: 'object',
      properties: {
        title:       { type: 'string', description: 'Mission title — short and verb-first (e.g. "Ship wallet v2 by Friday").' },
        description: { type: 'string', description: 'Optional longer description of what success looks like.' },
        deadline:    { type: 'string', description: 'Optional ISO-8601 deadline.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'missions.assign_agent',
    label: 'Assign Agent to Mission',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Add an agent to a mission\'s assigned roster. Role defaults to "executor"; pass "reviewer" / "designer" / "strategist" for other roles.',
    inputSchema: {
      type: 'object',
      properties: {
        mission_id: { type: 'string' },
        agent_name: { type: 'string', description: 'Agent name (e.g. "BlackSwan", "Jon Snow").' },
        role:       { type: 'string', description: 'Role — executor | reviewer | designer | strategist | analyst | writer. Default executor.' },
      },
      required: ['mission_id', 'agent_name'],
    },
  },
  {
    name: 'missions.unassign_agent',
    label: 'Remove Agent from Mission',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Remove an agent from a mission\'s assigned roster. Reversible via missions.assign_agent.',
    inputSchema: {
      type: 'object',
      properties: {
        mission_id: { type: 'string' },
        agent_name: { type: 'string' },
      },
      required: ['mission_id', 'agent_name'],
    },
  },
  {
    name: 'missions.update_status',
    label: 'Update Mission Status',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Change a mission\'s status. Valid values: active | completed | paused | cancelled. Also accepts title / description / deadline patches in the same call.',
    inputSchema: {
      type: 'object',
      properties: {
        mission_id:  { type: 'string' },
        status:      { type: 'string', description: 'active | completed | paused | cancelled' },
        title:       { type: 'string' },
        description: { type: 'string' },
        deadline:    { type: 'string', description: 'ISO-8601 deadline, or empty string to clear.' },
      },
      required: ['mission_id'],
    },
  },
  {
    name: 'circle.toggle_public',
    label: 'Toggle Circle Public/Private',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Toggle the circle\'s `is_public` flag — when true, the circle appears in /discover so anyone can join. Pass explicit true/false.',
    inputSchema: {
      type: 'object',
      properties: { is_public: { type: 'boolean', description: 'true = appear in /discover, false = hidden' } },
      required: ['is_public'],
    },
  },
  {
    name: 'memory.forget',
    label: 'Forget Memory',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Soft-delete a memory entry so agents stop retrieving it. Reversible — the row is flagged inactive, not dropped. Pass the memory entry id from search_memories / the memory inbox.',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'string' } },
      required: ['memory_id'],
    },
  },
  {
    name: 'check_ins.log',
    label: 'Log Check-In',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Post a daily check-in on behalf of the user. Content is free-form text. Optional metric is a JSON object for numeric check-ins (e.g. {reps: 50, distance_km: 3.2}).',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Check-in content (what the user did today).' },
        metric:  { type: 'object', description: 'Optional structured metric { key: value }.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'automations.list',
    label: 'List Circle Automations',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'List all automations configured for this circle with their enabled flag, trigger type, last run time, and last error (if any).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'automations.toggle_enabled',
    label: 'Toggle Automation Enabled',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Pause or resume a single automation. Pass the automation id and a boolean `enabled`. Reversible.',
    inputSchema: {
      type: 'object',
      properties: {
        automation_id: { type: 'string' },
        enabled:       { type: 'boolean' },
      },
      required: ['automation_id', 'enabled'],
    },
  },
  {
    name: 'missions.remove_task',
    label: 'Remove Mission Task',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Remove a task from a mission. Hard delete — for soft-archival use missions.update_task to patch status to cancelled.',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' } },
      required: ['task_id'],
    },
  },
  {
    name: 'missions.update_task',
    label: 'Update Mission Task',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Edit a mission task — title / description / priority / due_date / assignee / status. Pass only the fields you want to change.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id:     { type: 'string' },
        title:       { type: 'string' },
        description: { type: 'string' },
        priority:    { type: 'string', description: 'low | normal | high' },
        due_date:    { type: 'string', description: 'ISO date, or empty string to clear.' },
        assigned_to: { type: 'string', description: 'User id or agent name to assign. Empty string clears.' },
        status:      { type: 'string', description: 'pending | running | done | blocked | cancelled' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'agent.set_spirit',
    label: 'Set Agent Spirit',
    surfaces: ['main_chat', 'room_chat', 'office'],
    description: 'Set the "spirit" (personality mode / persona animation) for a published office agent. Pass the agent id and spirit key (or empty string to clear).',
    inputSchema: {
      type: 'object',
      properties: {
        agent_id: { type: 'string' },
        spirit:   { type: 'string', description: 'Spirit key — or "" to clear.' },
      },
      required: ['agent_id', 'spirit'],
    },
  },
  {
    name: 'memory.pin',
    label: 'Pin Memory',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Pin a memory entry so it stays in context across sessions. Pass the memory entry id (from `search_memories` results or the memory inbox).',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'string' } },
      required: ['memory_id'],
    },
  },
  {
    name: 'memory.unpin',
    label: 'Unpin Memory',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Unpin a previously pinned memory. It stays in the library but won\'t auto-load on every session.',
    inputSchema: {
      type: 'object',
      properties: { memory_id: { type: 'string' } },
      required: ['memory_id'],
    },
  },
  {
    name: 'approvals.list',
    label: 'List Approvals',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'List pending run approvals in the current circle.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'approvals.request',
    label: 'Request Approval',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Create a pending approval request for a run.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        approvalKind: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        payload: { type: 'object' },
        timeoutSeconds: { type: 'number' },
      },
      required: ['runId', 'approvalKind', 'title'],
    },
  },
  {
    name: 'approvals.resolve',
    label: 'Resolve Approval',
    surfaces: ['main_chat', 'room_chat', 'office', 'task_run'],
    description: 'Approve or reject a pending approval request.',
    inputSchema: { type: 'object', properties: { approvalId: { type: 'string' }, status: { type: 'string' } }, required: ['approvalId', 'status'] },
  },
  // ─── Desktop automation (Phase 1b — Claude Code bridge) ─────────────────
  {
    name: 'desktop.launch_app',
    label: 'Launch Desktop App',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Opens a native desktop application by name on the user's Mac via the " +
      "local Claude Code bridge. Requires the bridge running and the desktop " +
      "token paired. Example appNames: \"Zoom\", \"Slack\", \"Notion\", " +
      "\"Visual Studio Code\". Use desktop.list_running_apps first to see " +
      "what's already open. HITL-gated via the `desktop_action` category.",
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Exact .app name as in /Applications. Letters/numbers/space/.-_() only.' },
      },
      required: ['appName'],
    },
  },
  {
    name: 'desktop.focus_app',
    label: 'Focus Desktop App',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: "Brings an already-running app to the foreground. Prefer desktop.launch_app if the app isn't running (launch also focuses).",
    inputSchema: {
      type: 'object',
      properties: { appName: { type: 'string' } },
      required: ['appName'],
    },
  },
  {
    name: 'desktop.type_text',
    label: 'Type Text on Desktop',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Types text into whatever app has focus. Use desktop.focus_app first. " +
      "Max 4000 chars per call. For explicit Return/Enter, call " +
      "desktop.press_keys with combo=\"Return\".",
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to type. ≤4000 chars per call.' } },
      required: ['text'],
    },
  },
  {
    name: 'desktop.paste_text',
    label: 'Paste Text on Desktop',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Pastes text into the focused or named desktop app by temporarily setting the clipboard, sending Cmd+V, then restoring the previous clipboard. Prefer this for long or multiline text.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to paste. <=20000 chars per call.' },
        appName: { type: 'string', description: 'Optional app to focus before pasting.' },
        restoreClipboard: { type: 'boolean', description: 'Defaults true.' },
      },
      required: ['text'],
    },
  },
  {
    name: 'desktop.press_keys',
    label: 'Press Desktop Keys',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Presses a key combo. Modifiers: Cmd/Shift/Opt/Alt/Ctrl/Fn. Terminal " +
      "keys: a-z, 0-9, or named keys Return/Tab/Space/Escape/Delete/Left/" +
      "Right/Up/Down/F1-F12. Chain calls for multi-step actions.",
    inputSchema: {
      type: 'object',
      properties: { combo: { type: 'string', description: 'Examples: "Cmd+T", "Cmd+Shift+N", "Return", "Escape".' } },
      required: ['combo'],
    },
  },
  {
    name: 'desktop.menu_click',
    label: 'Click Desktop Menu',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Clicks a native macOS menu path such as ["File", "Save"] or ["File", "Export", "PNG"]. ' +
      'Prefer this before coordinate clicks when the requested action is available from the menu bar.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional target app. If omitted, uses the frontmost app.' },
        menuPath: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 6 },
      },
      required: ['menuPath'],
    },
  },
  {
    name: 'desktop.indesign_document_status',
    label: 'Inspect InDesign Document',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Read-only InDesign probe for active/open document state, missing fonts, missing/modified links, layers, pages, spreads, and selection count. Prefer this before editing InDesign documents.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
      },
    },
  },
  {
    name: 'desktop.indesign_text_inventory',
    label: 'Inspect InDesign Text Frames',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Read-only InDesign text-frame inventory. Lists candidate text frames, layers, labels, content previews, overset state, and locked/hidden state so the agent can choose the right deterministic edit target instead of guessing.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        query: { type: 'string', description: 'Optional field/layer/content query such as "disclaimer", "APR", "price", or "headline".' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
        maxItems: { type: 'number', description: 'Maximum frames to return. Defaults to 30.' },
      },
    },
  },
  {
    name: 'desktop.indesign_set_layer_state',
    label: 'Set InDesign Layer State',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Script-backed InDesign layer show/hide/lock/unlock operation. Use after document status and layer/text inventory; it refuses missing or ambiguous layer matches instead of clicking the Layers panel.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        layerName: { type: 'string', description: 'Exact target layer name to show, hide, lock, or unlock.' },
        action: { type: 'string', enum: ['show', 'hide', 'lock', 'unlock'], description: 'Layer state mutation to apply.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
      },
      required: ['layerName', 'action'],
    },
  },
  {
    name: 'desktop.indesign_batch_find_change',
    label: 'Batch InDesign Find/Change',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Script-backed InDesign batch Find/Change for routine dealership/banner copy updates. Runs multiple exact replacements in one bridge call, retries through locked stories/layers when safe, and returns per-pair verification. Prefer this for prompts such as "change 64 to 65, 72 to 84, and APR to 2.9%".',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        pairs: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              findText: { type: 'string', description: 'Exact source text to find.' },
              changeText: { type: 'string', description: 'Exact replacement text.' },
            },
            required: ['findText', 'changeText'],
          },
        },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
      },
      required: ['pairs'],
    },
  },
  {
    name: 'desktop.indesign_batch_update_text_layers',
    label: 'Batch Update InDesign Text Layers',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Script-backed InDesign batch text-layer updater for dealership/banner fields. Updates multiple named fields such as headline, price, APR, CTA, dealer info, and disclaimer in one bridge call with per-field verification.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              fieldName: { type: 'string', description: 'Named field/layer to update, for example "Headline", "Price", "APR", or "Disclaimer".' },
              replacementText: { type: 'string', description: 'Exact replacement copy to write into matching text frame(s).' },
            },
            required: ['fieldName', 'replacementText'],
          },
        },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
      },
      required: ['updates'],
    },
  },
  {
    name: 'desktop.indesign_update_text_layer',
    label: 'Update InDesign Text Layer',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Script-backed InDesign edit for dealership/banner text fields. Updates matching text frames by layer, frame name, or label aliases such as disclaimer, legal copy, APR, offer, price, CTA, headline, dealer info, or expiration. Prefer this over accessibility clicking for routine banner copy changes.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        fieldName: { type: 'string', description: 'Named field/layer to update, for example "Disclaimer", "APR", "Price", "CTA", or "Headline".' },
        replacementText: { type: 'string', description: 'Exact replacement copy to write into the matching text frame(s).' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
      },
      required: ['fieldName', 'replacementText'],
    },
  },
  {
    name: 'desktop.indesign_export_proof',
    label: 'Export InDesign Proof PDF',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Exports the guarded active InDesign document as a PDF proof to an approved local output path. Use after copy/layout edits so the user has a concrete proof file and file_stat verification target.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        outputPath: { type: 'string', description: 'Approved local output path for the proof PDF.' },
        format: { type: 'string', enum: ['pdf'], description: 'Proof format. Currently pdf.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
      },
      required: ['outputPath'],
    },
  },
  {
    name: 'desktop.indesign_relink_asset',
    label: 'Relink InDesign Asset',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Script-backed InDesign relink for selected or named placed graphics. Requires a local read grant for the replacement asset and refuses ambiguous multi-link documents unless a selection or linkQuery identifies the target.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        assetPath: { type: 'string', description: 'Approved local path to the replacement image/graphic asset.' },
        linkQuery: { type: 'string', description: 'Optional link/name/layer/path fragment to identify the target placed asset when nothing is selected.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
      },
      required: ['assetPath'],
    },
  },
  {
    name: 'desktop.indesign_package_document',
    label: 'Package InDesign Document',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Packages the guarded active InDesign document into an approved local output folder using InDesign packageForPrint, collecting links/fonts/profiles/report with preflight counts. Use for production handoff after edits and proof checks.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional InDesign app name. Defaults to InDesign.' },
        outputFolderPath: { type: 'string', description: 'Approved local output folder for the packaged handoff.' },
        includeIdml: { type: 'boolean', description: 'Also include an IDML file. Defaults false.' },
        includePdf: { type: 'boolean', description: 'Also include a PDF file. Defaults false; prefer desktop.indesign_export_proof for explicit proof PDFs.' },
        copyFonts: { type: 'boolean', description: 'Copy fonts into the package. Defaults true.' },
        copyLinkedGraphics: { type: 'boolean', description: 'Copy linked graphics into the package. Defaults true.' },
        copyProfiles: { type: 'boolean', description: 'Copy color profiles into the package. Defaults true.' },
        ignorePreflightErrors: { type: 'boolean', description: 'Defaults false so missing links/fonts stop the package unless explicitly approved.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .indd path guard.' },
      },
      required: ['outputFolderPath'],
    },
  },
  {
    name: 'desktop.photoshop_document_status',
    label: 'Inspect Photoshop Document',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Read-only Photoshop probe for active/open document state, dimensions, color mode, selection state, layer counts, text layers, smart objects, adjustment layers, and locked/hidden layers. Prefer this before editing Photoshop documents.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional Photoshop app name. Defaults to Photoshop.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .psd/.psb/image path guard.' },
      },
    },
  },
  {
    name: 'desktop.photoshop_layer_inventory',
    label: 'Inspect Photoshop Layers',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Read-only Photoshop layer inventory. Lists layer/group paths, text previews, visibility, locks, masks, bounds, and kind/type so the agent can choose deterministic text, asset, selection, or export targets.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional Photoshop app name. Defaults to Photoshop.' },
        query: { type: 'string', description: 'Optional layer/text query such as "headline", "logo", "background", or "CTA".' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .psd/.psb/image path guard.' },
        maxItems: { type: 'number', description: 'Maximum layers to return. Defaults to 40.' },
      },
    },
  },
  {
    name: 'desktop.photoshop_set_layer_state',
    label: 'Set Photoshop Layer State',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Script-backed Photoshop layer show/hide/lock/unlock operation. Use after photoshop_document_status and photoshop_layer_inventory; it refuses missing or ambiguous layer matches instead of clicking the Layers panel.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional Photoshop app name. Defaults to Photoshop.' },
        layerName: { type: 'string', description: 'Exact Photoshop layer/group name or path, for example "Legal", "Hero / Logo", or "Background".' },
        action: { type: 'string', enum: ['show', 'hide', 'lock', 'unlock'], description: 'Layer state action to apply.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .psd/.psb/image path guard.' },
      },
      required: ['layerName', 'action'],
    },
  },
  {
    name: 'desktop.photoshop_update_text_layer',
    label: 'Update Photoshop Text Layer',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Script-backed Photoshop edit for named text layers. Updates matching text layers by layer/path/name and returns per-document verification. Use after photoshop_document_status and photoshop_layer_inventory.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional Photoshop app name. Defaults to Photoshop.' },
        layerName: { type: 'string', description: 'Named text layer or query, for example "Headline", "CTA", or "Disclaimer".' },
        replacementText: { type: 'string', description: 'Exact replacement copy to write into matching Photoshop text layer(s).' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .psd/.psb/image path guard.' },
      },
      required: ['layerName', 'replacementText'],
    },
  },
  {
    name: 'desktop.photoshop_place_asset',
    label: 'Place Photoshop Asset',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Script-backed Photoshop asset placement. Places an approved local image/graphic as a new layer in the guarded active document and returns the placed layer name. Requires approval because it mutates the document.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional Photoshop app name. Defaults to Photoshop.' },
        assetPath: { type: 'string', description: 'Approved local path to the image/graphic asset to place.' },
        layerName: { type: 'string', description: 'Optional name for the placed layer.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .psd/.psb/image path guard.' },
      },
      required: ['assetPath'],
    },
  },
  {
    name: 'desktop.photoshop_export_proof',
    label: 'Export Photoshop Proof',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      'Exports the guarded active Photoshop document as a PNG/JPEG proof to an approved local output path. Use after edits for visual proof and file_stat verification.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string', description: 'Optional Photoshop app name. Defaults to Photoshop.' },
        outputPath: { type: 'string', description: 'Approved local output path for the proof image.' },
        format: { type: 'string', enum: ['png', 'jpg', 'jpeg'], description: 'Proof format. Defaults from output extension, otherwise png.' },
        quality: { type: 'number', description: 'JPEG quality 1-12. Ignored for PNG.' },
        expectedDocumentName: { type: 'string', description: 'Optional expected active/open document name guard.' },
        sourceDocumentPath: { type: 'string', description: 'Optional source .psd/.psb/image path guard.' },
      },
      required: ['outputPath'],
    },
  },
  {
    name: 'desktop.list_running_apps',
    label: 'List Running Desktop Apps',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: "Lists foreground apps currently running on the user's Mac. Read-only — returns names, no window contents.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.list_browser_tabs',
    label: 'List Browser Tabs',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Reads titles and URLs for tabs open in local Mac browsers through Automation permission. Use for "what Chrome tabs do I have open?"',
    inputSchema: { type: 'object', properties: { browsers: { type: 'array', items: { type: 'string' } } } },
  },
  {
    name: 'desktop.window_state',
    label: 'Read Active Window',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Reads the frontmost app, active window title, bounds, and visible window names from System Events.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.clipboard',
    label: 'Read Clipboard',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Reads current macOS clipboard text with pbpaste.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.clipboard_write',
    label: 'Write Clipboard',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Writes explicit user-provided text to the macOS clipboard.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'desktop.clipboard_clear',
    label: 'Clear Clipboard',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Clears the macOS clipboard.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.file_list',
    label: 'List Local Files',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Lists files and folders under a local path. Read-only. Requires one-time local file verification for the browser session.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'desktop.file_read',
    label: 'Read Local File',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Reads a bounded UTF-8 preview of a local file. Read-only. Requires one-time local file verification for the browser session.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, maxBytes: { type: 'number' } }, required: ['path'] },
  },
  {
    name: 'desktop.file_search',
    label: 'Search Local Files',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Searches filenames and small text-file contents under one or more local folders. Read-only, bounded, and requires one-time local file verification for the browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        rootPath: { type: 'string' },
        rootPaths: { type: 'array', items: { type: 'string' } },
        query: { type: 'string' },
        maxResults: { type: 'number' },
        maxFiles: { type: 'number' },
        maxDepth: { type: 'number' },
        includeContent: { type: 'boolean' },
        extensions: { type: 'array', items: { type: 'string' } },
      },
      required: ['query'],
    },
  },
  {
    name: 'desktop.file_stat',
    label: 'Inspect Local File Metadata',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Checks whether a local path exists and returns bounded metadata such as kind, size, and modified time. Read-only. Requires one-time local file verification for the browser session.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'desktop.file_rename',
    label: 'Rename Local File',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Renames or moves a local file within approved write-scoped roots. Requires explicit local file write verification for the browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        fromPath: { type: 'string' },
        toPath: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      required: ['fromPath', 'toPath'],
    },
  },
  {
    name: 'desktop.file_write_text',
    label: 'Write Local Text File',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Creates, overwrites, or appends bounded UTF-8 text files inside approved write-scoped local roots. Requires explicit local file write verification for the browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean' },
        overwrite: { type: 'boolean' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'desktop.file_copy',
    label: 'Copy Local File',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Copies a local file or folder inside approved write-scoped roots. Requires explicit local file write verification for the browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        fromPath: { type: 'string' },
        toPath: { type: 'string' },
        overwrite: { type: 'boolean' },
      },
      required: ['fromPath', 'toPath'],
    },
  },
  {
    name: 'desktop.file_trash',
    label: 'Move Local File To Trash',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Moves a local file or folder to macOS Trash instead of permanently deleting it. Requires explicit local file write verification for the browser session.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'desktop.file_mkdir',
    label: 'Create Local Folder',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Creates a local folder inside approved write-scoped roots. Requires explicit local file write verification for the browser session.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        recursive: { type: 'boolean' },
      },
      required: ['path'],
    },
  },
  {
    name: 'desktop.shortcuts_list',
    label: 'List Apple Shortcuts',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Lists Apple Shortcuts available to the user through the macOS shortcuts CLI.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.shortcuts_run',
    label: 'Run Apple Shortcut',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Runs a named Apple Shortcut. This can have side effects and requires approval.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'desktop.window_manage',
    label: 'Manage Desktop Window',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Focuses, raises, minimizes, unminimizes, zooms, or resizes the active or named app window.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        appName: { type: 'string' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['action'],
    },
  },
  {
    name: 'desktop.mouse_move',
    label: 'Move Desktop Mouse',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Moves or hovers the local mouse cursor at explicit screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop.mouse_click',
    label: 'Click Desktop Mouse',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Clicks the local mouse at explicit screen coordinates. Supports left/right and single/double clicks.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop.mouse_down',
    label: 'Hold Desktop Mouse',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Moves to explicit screen coordinates and holds the local mouse button down until desktop.mouse_up is called.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop.mouse_up',
    label: 'Release Desktop Mouse',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Releases a held local mouse button, optionally at explicit screen coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string' },
      },
    },
  },
  {
    name: 'desktop.mouse_drag',
    label: 'Drag Desktop Mouse',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Drags the local mouse from one explicit coordinate to another.',
    inputSchema: {
      type: 'object',
      properties: {
        fromX: { type: 'number' },
        fromY: { type: 'number' },
        toX: { type: 'number' },
        toY: { type: 'number' },
        durationMs: { type: 'number' },
      },
      required: ['fromX', 'fromY', 'toX', 'toY'],
    },
  },
  {
    name: 'desktop.mouse_scroll',
    label: 'Scroll Desktop Mouse',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Sends a mouse-wheel scroll event through the local input helper.',
    inputSchema: {
      type: 'object',
      properties: {
        deltaY: { type: 'number' },
        deltaX: { type: 'number' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
    },
  },
  {
    name: 'desktop.wait_for_app',
    label: 'Wait for Desktop App',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Polls the running-app list every 250ms until `appName` appears, or timeout expires (default 5s, max 30s). " +
      "Use this AFTER desktop.launch_app and BEFORE desktop.type_text / desktop.press_keys — ensures keystrokes " +
      "land in the newly-launched app instead of whichever app was frontmost when launch fired.",
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string' },
        timeoutMs: { type: 'number', description: 'Max milliseconds to wait. 500..30000; default 5000.' },
      },
      required: ['appName'],
    },
  },
  {
    name: 'desktop.screenshot',
    label: 'Screenshot Desktop',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Captures a full-screen PNG via macOS `screencapture`. Returns base64 + size. Use this to verify that a " +
      "previous action took effect (e.g. app is open, dialog is showing, form field is focused). Requires Screen " +
      "Recording permission granted to the Terminal running the bridge.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.open_url',
    label: 'Open URL',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Opens a URL in the user's default browser via `open`. Accepts http / https / file / mailto schemes only. " +
      "Safer and more direct than desktop.launch_app('Safari') when the user wants a specific page — no " +
      "additional navigation needed.",
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL. http / https / file / mailto only.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'desktop.open_path',
    label: 'Open File or Folder',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Runs `open <path>` — launches a file with its default app or reveals a folder in Finder. Rejects paths " +
      "containing shell metacharacters. Use for \"open ~/Downloads\", \"open the README.md in my repo\", etc.",
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Absolute or ~-relative path. No shell metacharacters.' } },
      required: ['path'],
    },
  },
  {
    name: 'desktop.click_at',
    label: 'Mouse Click at Coords',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Clicks at absolute screen coordinates (x, y). Uses `cliclick` when installed (reliable), falls back to " +
      "AppleScript System Events click-at-coords (best-effort — often fails silently on macOS 13+). Call " +
      "desktop.screen_size first so coords stay in bounds; read the /desktop/health `optional.cliclick` flag to " +
      "know whether to attempt. Prefer desktop.press_keys for keyboard-reachable actions.",
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'integer', minimum: 0 },
        y: { type: 'integer', minimum: 0 },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'desktop.screen_size',
    label: 'Primary Screen Size',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description:
      "Returns { width, height } of the primary display in pixels. Call this before desktop.click_at to bound " +
      "coordinates or before desktop.screenshot to know the dimensions of the image you'll receive.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'desktop.read_a11y_tree',
    label: 'Read Accessibility Tree',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Reads a compact accessibility tree for the frontmost or named app. Prefer this before screenshot-based clicking when available.',
    inputSchema: {
      type: 'object',
      properties: {
        appName: { type: 'string' },
        maxDepth: { type: 'number' },
        maxNodes: { type: 'number' },
      },
    },
  },
  {
    name: 'desktop.click_element',
    label: 'Click Accessibility Element',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Clicks an element by PID and dotted path from desktop.read_a11y_tree.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number' },
        path: { type: 'string' },
      },
      required: ['pid', 'path'],
    },
  },
  {
    name: 'desktop.set_element_value',
    label: 'Set Accessibility Field Value',
    surfaces: ['main_chat', 'room_chat', 'task_run'],
    description: 'Sets a text field or editable accessibility element by PID and dotted path from desktop.read_a11y_tree. Prefer this before click+paste when filling named native app fields.',
    inputSchema: {
      type: 'object',
      properties: {
        pid: { type: 'number' },
        path: { type: 'string' },
        text: { type: 'string' },
      },
      required: ['pid', 'path', 'text'],
    },
  },
];

function getBaseOpenSwanToolPolicy(tool: OpenSwanRuntimeToolName): OpenSwanToolPolicy {
  if (tool.startsWith('code.')) {
    return {
      family: 'code',
      approvalMode: 'auto',
      mutatesState: tool === 'code.generate',
      externalSideEffect: false,
      summary: tool === 'code.generate'
        ? 'Generates implementation-ready code or artifact content.'
        : 'Inspects or reviews code without touching external systems.',
    };
  }

  if (tool.startsWith('verification.')) {
    return {
      family: 'verification',
      approvalMode: 'auto',
      mutatesState: false,
      externalSideEffect: false,
      summary: 'Runs or plans local verification checks for correctness.',
    };
  }

  if (tool === 'browser.plan_task') {
    return {
      family: 'browser',
      approvalMode: 'auto',
      mutatesState: false,
      externalSideEffect: false,
      approvalKind: 'browser_action',
      summary: 'Plans browser work and explains approval requirements without executing live actions.',
    };
  }

  if (tool.startsWith('browser.')) {
    const readOnlyTools = new Set<OpenSwanRuntimeToolName>([
      'browser.dom_snapshot',
      'browser.verification_state',
      'browser.screenshot',
    ]);
    const readOnly = readOnlyTools.has(tool);
    return {
      family: 'browser',
      approvalMode: readOnly ? 'auto' : 'ask',
      mutatesState: !readOnly,
      externalSideEffect: !readOnly,
      approvalKind: readOnly ? undefined : 'browser_action',
      summary: readOnly
        ? 'Observes the persistent local browser with DOM snapshots or screenshots.'
        : 'Controls the persistent local browser with Playwright navigation, role clicks, fills, or key presses.',
    };
  }

  if (tool.startsWith('vault.')) {
    const mutates = tool === 'vault.grant' || tool === 'vault.revoke';
    return {
      family: 'vault',
      approvalMode: mutates ? 'ask' : 'auto',
      mutatesState: mutates,
      externalSideEffect: false,
      approvalKind: mutates ? 'privileged_action' : undefined,
      summary: mutates
        ? 'Changes scoped credential access for agents or runtimes without revealing secrets.'
        : 'Reads redacted vault automation metadata, grants, or runbooks without revealing secrets.',
    };
  }

  if (tool === 'agent.codex_acquire_asset') {
    return {
      family: 'agent',
      approvalMode: 'ask',
      mutatesState: true,
      externalSideEffect: true,
      approvalKind: 'file_write',
      summary: 'Delegates Codex agent work that may download, generate, install, or write local artifacts.',
    };
  }

  if (tool === 'agent.recover_failed_task') {
    return {
      family: 'agent',
      approvalMode: 'ask',
      mutatesState: true,
      externalSideEffect: false,
      approvalKind: 'privileged_action',
      summary: 'Delegates failed-task diagnosis and bounded app/runtime repair to a connected Codex agent.',
    };
  }

  if (tool === 'agent.build_app_capability') {
    return {
      family: 'agent',
      approvalMode: 'ask',
      mutatesState: true,
      externalSideEffect: false,
      approvalKind: 'privileged_action',
      summary: 'Delegates missing unfamiliar-app capability buildout to a connected Codex agent.',
    };
  }

  if (tool.startsWith('desktop.')) {
    // Read-only tools (list apps, screen size, screenshot, wait_for_app)
    // auto-approve — they observe state, they don't change it. Every
    // write path (launch/focus/type/keys/click/open_url/open_path)
    // routes through HITL via the `desktop_action` auto-approve
    // category which the user can opt into 'auto' via the banner.
    const readOnlyTools = new Set([
      'desktop.list_running_apps',
      'desktop.list_browser_tabs',
      'desktop.window_state',
      'desktop.clipboard',
      'desktop.file_list',
      'desktop.file_read',
      'desktop.file_search',
      'desktop.file_stat',
      'desktop.shortcuts_list',
      'desktop.screen_size',
      'desktop.screenshot',
      'desktop.wait_for_app',
      'desktop.read_a11y_tree',
      'desktop.indesign_document_status',
      'desktop.indesign_text_inventory',
      'desktop.photoshop_document_status',
      'desktop.photoshop_layer_inventory',
	    ]);
	    const readOnly = readOnlyTools.has(tool);
	    const fileWrite = tool === 'desktop.file_rename'
	      || tool === 'desktop.file_write_text'
	      || tool === 'desktop.file_copy'
	      || tool === 'desktop.file_trash'
	      || tool === 'desktop.file_mkdir';
	    return {
	      family: 'browser',  // re-use the browser family so existing banners render
	      approvalMode: readOnly ? 'auto' : 'ask',
	      mutatesState: !readOnly,
	      externalSideEffect: !readOnly,
	      approvalKind: readOnly ? undefined : fileWrite ? 'file_write' : 'browser_action',
	      summary: readOnly
	        ? 'Observes local desktop state via the Claude Code bridge (list apps, screen size, screenshot, wait).'
	        : fileWrite
	          ? 'Changes local files through the scoped desktop bridge file-write surface. HITL-gated.'
	          : 'Drives the user\'s local desktop (launch / focus / type / keys / click / open) via the Claude Code bridge. HITL-gated.',
	    };
	  }

  if (tool === 'workspace.create_room' || tool === 'workspace.apply_artifacts' || tool === 'workspace.open_preview') {
    return {
      family: 'workspace',
      approvalMode: 'auto',
      mutatesState: tool !== 'workspace.open_preview',
      externalSideEffect: false,
      approvalKind: tool === 'workspace.open_preview' ? undefined : 'file_write',
      summary: tool === 'workspace.open_preview'
        ? 'Opens or focuses a preview surface.'
        : 'Changes room workspace state or project files.',
    };
  }

  if (tool === 'search_memories' || tool === 'save_memory') {
    return {
      family: 'memory',
      approvalMode: tool === 'save_memory' ? 'auto' : 'auto',
      mutatesState: tool === 'save_memory',
      externalSideEffect: false,
      summary: tool === 'save_memory'
        ? 'Writes durable memory into the circle knowledge graph.'
        : 'Reads prior decisions, preferences, and context from memory.',
    };
  }

  if (
    tool === 'fetch_url' ||
    tool === 'list_circle_members' ||
    tool === 'github.list_repos' ||
    tool === 'github.read_file' ||
    tool === 'integrations.list' ||
    tool === 'office.list_agents' ||
    tool === 'messages.list' ||
    tool === 'check_ins.list' ||
    tool === 'rooms.list' ||
    tool === 'rooms.list_tasks' ||
    tool === 'rooms.list_files' ||
    tool === 'rooms.read_file' ||
    tool === 'tasks.list' ||
    tool === 'tasks.get' ||
    tool === 'goals.list' ||
    tool === 'missions.list' ||
    tool === 'research.search' ||
    tool === 'approvals.list'
  ) {
    return {
      family: 'knowledge',
      approvalMode: 'auto',
      mutatesState: false,
      externalSideEffect: tool === 'fetch_url',
      summary: tool === 'fetch_url'
        ? 'Reads a public external URL.'
        : 'Reads app, repo, research, or approval state without mutating it.',
    };
  }

  if (tool === 'schedule_action') {
    return {
      family: 'coordination',
      approvalMode: 'ask',
      mutatesState: true,
      externalSideEffect: true,
      approvalKind: 'external_send',
      summary: 'Queues an outbound automation or scheduled action that can affect external systems.',
    };
  }

  if (tool.startsWith('approvals.')) {
    return {
      family: 'approval',
      approvalMode: 'auto',
      mutatesState: true,
      externalSideEffect: false,
      approvalKind: 'plan_approval',
      summary: 'Mutates approval state for a gated action.',
    };
  }

  return {
    family: 'coordination',
    approvalMode: 'auto',
    mutatesState: true,
    externalSideEffect: false,
    approvalKind: 'privileged_action',
    summary: 'Coordinates app state and work execution inside the circle.',
  };
}

function resolveApprovalModeOverride(
  tool: OpenSwanRuntimeToolName,
  family: OpenSwanToolPolicyFamily,
  activePluginIds?: string[],
): OpenSwanToolApprovalMode | null {
  for (const pluginId of activePluginIds || []) {
    const plugin = getPlugin(pluginId);
    const override = plugin?.approvalDefaults?.[tool] || plugin?.approvalDefaults?.[family];
    if (override === 'auto' || override === 'ask') return override;
  }
  return null;
}

export function getOpenSwanToolPolicy(
  tool: OpenSwanRuntimeToolName,
  activePluginIds?: string[],
): OpenSwanToolPolicy {
  const base = getBaseOpenSwanToolPolicy(tool);
  const override = resolveApprovalModeOverride(tool, base.family, activePluginIds);
  return override ? { ...base, approvalMode: override } : base;
}

/**
 * Mode-scoping map for write-heavy tools. Keeping this centralized instead
 * of sprinkling `modes: [...]` across 20 tool definitions makes it one
 * place to audit "which modes can do what" — e.g. the rule that review
 * and research modes never mutate.
 *
 * A tool NOT listed here is mode-agnostic (available in every mode). The
 * default is intentional: most read tools work everywhere. Only add a
 * tool here when the modes it belongs in are genuinely narrower.
 *
 * Modes used:
 *   build   — implementation work (create files, tasks, missions)
 *   execute — immediate action (mutate anything the user asks)
 *   plan    — architecture & sequencing (propose + create placeholders)
 *   design  — UI/UX + appearance (theme, agent looks)
 *   review  — critical audit (read-only + record findings → never listed)
 *   research — investigation (read-only → never listed)
 *   talk    — conversation (read-only → never listed)
 *   support — troubleshoot & recovery (read-only + memory hygiene)
 */
const TOOL_MODE_TAGS: Partial<Record<OpenSwanRuntimeToolName, string[]>> = {
  // Code generation — not in review (audit mode), research, talk, or support.
  'code.generate': ['build', 'execute', 'plan', 'design'],
  // Agent-acquired assets can download/generate/write local files and must
  // only be exposed in action-oriented modes.
  'agent.codex_acquire_asset': ['execute', 'build'],
  'agent.recover_failed_task': ['execute', 'support', 'build'],
  'agent.build_app_capability': ['execute', 'build', 'support'],
  // Circle-wide settings — only when user explicitly wants to change them.
  'circle.update_settings':     ['execute', 'build'],
  'circle.update_budget_caps':  ['execute'],
  'circle.update_office_theme': ['execute', 'design'],
  'circle.toggle_public':       ['execute'],
  // Agent identity / appearance mutations.
  'agent.update_appearance': ['execute', 'design'],
  'agent.rename':            ['execute'],
  'agent.set_spirit':        ['execute'],
  // Room structure writes.
  'rooms.rename':    ['execute', 'build'],
  'rooms.archive':   ['execute', 'build'],
  'rooms.unarchive': ['execute', 'build'],
  'rooms.create':    ['execute', 'build', 'plan'],
  // Mission structure writes.
  'missions.create':          ['execute', 'build', 'plan'],
  'missions.assign_agent':    ['execute', 'build', 'plan'],
  'missions.unassign_agent':  ['execute', 'build'],
  'missions.update_status':   ['execute', 'build'],
  'missions.remove_task':     ['execute', 'build'],
  'missions.update_task':     ['execute', 'build', 'plan'],
  // Destructive memory op — explicit intent only. Support mode can use
  // it during troubleshooting ("forget this stale bias").
  'memory.forget': ['execute', 'support'],
  // Automation toggle — only when user is actively executing changes.
  'automations.toggle_enabled': ['execute'],
  // Vault grant mutations are sensitive; read-only vault tools stay
  // available everywhere, but changing access needs explicit action intent.
  'vault.grant': ['execute', 'plan'],
  'vault.revoke': ['execute', 'plan'],
  // Local browser controls mutate a persistent browser profile and may
  // touch logged-in accounts, so keep them out of read-only modes.
  'browser.open_url': ['execute'],
  'browser.click_role': ['execute'],
  'browser.fill_field': ['execute'],
  'browser.select_option': ['execute'],
  'browser.upload_file': ['execute'],
  'browser.press_key': ['execute'],
  'browser.close': ['execute', 'support'],
  // Desktop write/control actions only belong in execute mode. Read-only
  // desktop tools are intentionally left mode-agnostic for diagnostics.
  'desktop.launch_app': ['execute'],
  'desktop.focus_app':  ['execute'],
  'desktop.type_text':  ['execute'],
  'desktop.paste_text': ['execute'],
  'desktop.press_keys': ['execute'],
  'desktop.menu_click': ['execute'],
  'desktop.indesign_set_layer_state': ['execute'],
  'desktop.indesign_batch_find_change': ['execute'],
  'desktop.indesign_batch_update_text_layers': ['execute'],
  'desktop.indesign_update_text_layer': ['execute'],
  'desktop.indesign_relink_asset': ['execute'],
  'desktop.indesign_package_document': ['execute'],
  'desktop.indesign_export_proof': ['execute'],
  'desktop.photoshop_set_layer_state': ['execute'],
  'desktop.photoshop_update_text_layer': ['execute'],
  'desktop.photoshop_place_asset': ['execute'],
  'desktop.photoshop_export_proof': ['execute'],
  'desktop.open_url':   ['execute'],
  'desktop.open_path':  ['execute'],
  'desktop.click_at':   ['execute'],
  'desktop.clipboard_write': ['execute'],
  'desktop.clipboard_clear': ['execute'],
  'desktop.file_rename': ['execute'],
  'desktop.file_write_text': ['execute'],
  'desktop.file_copy': ['execute'],
  'desktop.file_trash': ['execute'],
  'desktop.file_mkdir': ['execute'],
  'desktop.shortcuts_run': ['execute'],
  'desktop.window_manage': ['execute'],
  'desktop.mouse_move': ['execute'],
  'desktop.mouse_click': ['execute'],
  'desktop.mouse_down': ['execute'],
  'desktop.mouse_up': ['execute'],
  'desktop.mouse_drag': ['execute'],
  'desktop.mouse_scroll': ['execute'],
  'desktop.click_element': ['execute'],
  'desktop.set_element_value': ['execute'],
};

/** Returns the mode list for a tool (inline def wins over the central map). */
function getToolModes(tool: OpenSwanToolDefinition): string[] | null {
  if (tool.modes && tool.modes.length > 0) return tool.modes;
  const tagged = TOOL_MODE_TAGS[tool.name];
  return tagged && tagged.length > 0 ? tagged : null;
}

/**
 * Returns the mode tags the current tool set exposes. Useful for UI that
 * wants to show "this mode hides X tools" — the Control Panel uses it.
 */
export function listToolsHiddenByMode(
  surface: OpenSwanToolSurface,
  mode: string | null | undefined,
): OpenSwanToolDefinition[] {
  // Matches the filter rule: `none` / `talk` mean no mode discipline,
  // so no tools are hidden.
  if (!mode || mode === 'none' || mode === 'talk') return [];
  return TOOL_DEFINITIONS
    .filter((tool) => tool.surfaces.includes(surface))
    .filter((tool) => TOOL_LOOP_SAFE_NAMES.has(tool.name))
    .filter((tool) => {
      const modes = getToolModes(tool);
      return modes && !modes.includes(mode);
    });
}

const TOOL_LOOP_SAFE_NAMES = new Set<OpenSwanRuntimeToolName>([
  'code.inspect',
  'browser.plan_task',
  'browser.open_url',
  'browser.dom_snapshot',
  'browser.verification_state',
  'browser.click_role',
  'browser.fill_field',
  'browser.select_option',
  'browser.upload_file',
  'browser.press_key',
  'browser.screenshot',
  'browser.close',
  'code.generate',
  'code.review',
  'verification.typecheck',
  'verification.tests',
  'verification.lint',
  'verification.preview',
  'search_memories',
  'save_memory',
  'fetch_url',
  'list_circle_members',
  'schedule_action',
  'missions.list',
  'missions.create_task',
  'missions.complete_task',
  'github.list_repos',
  'github.read_file',
  'tasks.list',
  'tasks.get',
  'tasks.create',
  'tasks.update_status',
  'tasks.assign',
  'tasks.comment',
  'tasks.add_artifact',
  'goals.list',
  'goals.create',
  'goals.update_progress',
  'goals.update_status',
  'messages.list',
  'messages.create',
  'check_ins.list',
  'research.search',
  'research.save',
  'rooms.list',
  'rooms.create',
  'rooms.send_message',
  'rooms.list_tasks',
  'rooms.create_task',
  'rooms.create_file',
  'rooms.update_file',
  'rooms.list_files',
  'rooms.read_file',
  'integrations.list',
  'office.list_agents',
  'agent.codex_acquire_asset',
  'agent.recover_failed_task',
  'agent.build_app_capability',
  'approvals.list',
  'approvals.request',
  'approvals.resolve',
  'vault.list',
  'vault.find',
  'vault.grants',
  'vault.grant',
  'vault.revoke',
  'vault.runbook',
  'vault.resolve_for_task',
  'desktop.launch_app',
  'desktop.focus_app',
  'desktop.type_text',
  'desktop.paste_text',
  'desktop.press_keys',
  'desktop.menu_click',
  'desktop.indesign_document_status',
  'desktop.indesign_text_inventory',
  'desktop.indesign_set_layer_state',
  'desktop.indesign_batch_find_change',
  'desktop.indesign_batch_update_text_layers',
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
  'desktop.list_running_apps',
  'desktop.list_browser_tabs',
  'desktop.window_state',
  'desktop.clipboard',
  'desktop.clipboard_write',
  'desktop.clipboard_clear',
  'desktop.file_list',
  'desktop.file_read',
  'desktop.file_search',
  'desktop.file_stat',
  'desktop.file_rename',
  'desktop.file_write_text',
  'desktop.file_copy',
  'desktop.file_trash',
  'desktop.file_mkdir',
  'desktop.shortcuts_list',
  'desktop.shortcuts_run',
  'desktop.window_manage',
  'desktop.mouse_move',
  'desktop.mouse_click',
  'desktop.mouse_down',
  'desktop.mouse_up',
  'desktop.mouse_drag',
  'desktop.mouse_scroll',
  'desktop.wait_for_app',
  'desktop.screenshot',
  'desktop.open_url',
  'desktop.open_path',
  'desktop.click_at',
  'desktop.screen_size',
  'desktop.read_a11y_tree',
  'desktop.click_element',
  'desktop.set_element_value',
  // App-edit tools (Phase 1-4) — let BlackSwan modify anything the user can edit
  'circle.update_settings',
  'circle.update_budget_caps',
  'circle.update_office_theme',
  'circle.toggle_public',
  'agent.update_appearance',
  'agent.rename',
  'agent.set_spirit',
  'rooms.rename',
  'rooms.archive',
  'rooms.unarchive',
  'missions.create',
  'missions.assign_agent',
  'missions.unassign_agent',
  'missions.update_status',
  'missions.remove_task',
  'missions.update_task',
  'memory.pin',
  'memory.unpin',
  'memory.forget',
  'check_ins.log',
  'automations.list',
  'automations.toggle_enabled',
]);

export function listOpenSwanToolsForSurface(surface: OpenSwanToolSurface): OpenSwanToolDefinition[] {
  return TOOL_DEFINITIONS.filter((tool) => tool.surfaces.includes(surface));
}

export function listOpenSwanAnthropicToolsForSurface(
  surface: OpenSwanToolSurface,
  allowedToolNames?: OpenSwanRuntimeToolName[],
  mode?: string | null,
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> {
  const allow = allowedToolNames?.length ? new Set(allowedToolNames) : null;
  const modeKey = typeof mode === 'string' && mode ? mode : null;
  const surfaceCandidates = TOOL_DEFINITIONS
    .filter((tool) => tool.surfaces.includes(surface))
    .filter((tool) => TOOL_LOOP_SAFE_NAMES.has(tool.name))
    .filter((tool) => !allow || allow.has(tool.name));
  // Mode filter: tools without a mode tag are mode-agnostic. Tagged
  // tools only appear if the current mode is in their list. `none` and
  // `talk` = user hasn't opted into mode discipline → pass-through so
  // casual chat still has action tools when an action intent fires.
  const result = surfaceCandidates.filter((tool) => {
    if (!modeKey || modeKey === 'none' || modeKey === 'talk') return true;
    const modes = getToolModes(tool);
    return !modes || modes.includes(modeKey);
  });
  // Dev-only observability — log when mode gating actually filters tools
  // so engineers can see why a tool wasn't exposed instead of wondering
  // silently. Production suppresses this; the Control Panel shows the
  // same info in UI for end-users.
  try {
    // @ts-ignore __DEV__ is a React Native global
    const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
    if (isDev && modeKey && modeKey !== 'none' && modeKey !== 'talk' && result.length < surfaceCandidates.length) {
      const hidden = surfaceCandidates
        .filter((t) => !result.includes(t))
        .map((t) => t.name);
      // eslint-disable-next-line no-console
      console.debug(
        `[openswan] mode '${modeKey}' on surface '${surface}' hid ${hidden.length} tool(s):`,
        hidden,
      );
    }
  } catch { /* never throw from observability */ }
  return result.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema || { type: 'object', properties: {} },
  }));
}

/**
 * Diagnostic / inspector helper — returns the same filtered list the model
 * would see, but as full definitions (not Anthropic-schema form) so UI
 * surfaces can render counts, labels, approval modes, and mode tags
 * alongside the model-facing descriptions. Used by the OpenSwan Console.
 */
export function previewOpenSwanToolsForSurface(
  surface: OpenSwanToolSurface,
  mode?: string | null,
  allowedToolNames?: OpenSwanRuntimeToolName[],
): OpenSwanToolDefinition[] {
  const allow = allowedToolNames?.length ? new Set(allowedToolNames) : null;
  const modeKey = typeof mode === 'string' && mode ? mode : null;
  return TOOL_DEFINITIONS
    .filter((tool) => tool.surfaces.includes(surface))
    .filter((tool) => TOOL_LOOP_SAFE_NAMES.has(tool.name))
    .filter((tool) => !allow || allow.has(tool.name))
    .filter((tool) => {
      // `none` and `talk` = user hasn't opted into mode discipline —
      // treat as mode-agnostic so casual chat still has action tools
      // when an action intent is detected (e.g. "create a room" from
      // the default chat mode).
      if (!modeKey || modeKey === 'none' || modeKey === 'talk') return true;
      const modes = getToolModes(tool);
      return !modes || modes.includes(modeKey);
    });
}

export function buildOpenSwanToolBrief(
  surface: OpenSwanToolSurface,
  taskPlan: OpenSwanTaskPlan,
  activePluginIds?: string[],
): string {
  const toolLookup = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
  const lines = taskPlan.recommendedTools
    .filter((item) => toolLookup.get(item.tool)?.surfaces.includes(surface))
    .map((item) => {
      const tool = toolLookup.get(item.tool);
      const policy = getOpenSwanToolPolicy(item.tool, activePluginIds);
      return `- ${tool?.label || item.tool} [${item.priority}] [${policy.family}] [${policy.approvalMode.toUpperCase()}]: ${item.reason}`;
    });

  if (lines.length === 0) {
    return 'No specialized tools recommended for this surface yet.';
  }

  return `Recommended tools for this turn:\n${lines.join('\n')}`;
}

// Surface actionable hints for desktop-bridge failure modes so the agent
// doesn't just report "permission denied" and give up. Matches the
// errorCode set in `src/lib/desktopBridgeProtocol.ts`.
function describeDesktopFailure(error?: string, code?: string): string {
  const base = error || 'Desktop action failed.';
  switch (code) {
    case 'bridge_offline':
      return `${base} The Claude Code bridge is not reachable at localhost:7778 — start it with \`node scripts/claude-bridge.js\`.`;
    case 'not_paired':
      return `${base} The desktop bridge is running but not paired with this browser. Tell the user to tap "Pair Desktop Bridge" in the Chat Actions menu.`;
    case 'permission_denied':
      return `${base} macOS Accessibility permission is required for keystrokes and key combos. Open System Settings → Privacy & Security → Accessibility and enable it for whichever shell/terminal is running the bridge (usually Terminal.app or iTerm). After granting, the user should re-run the same command.`;
    case 'file_access_not_granted':
      return `${base} Ask the user to approve one-time local file access in chat for this browser session, then retry the file tool.`;
    case 'stale_bridge':
      return `${base} The running desktop bridge is stale and does not have the latest /desktop routes loaded. Restart it with \`npm run bridge\` or restart the app dev server, then retry the same request.`;
    case 'platform_unsupported':
      return `${base} Desktop automation is macOS-only in Phase 1. Windows/Linux support is on the roadmap.`;
    case 'app_not_found':
      return `${base} That app isn't installed under /Applications or the name doesn't match the .app bundle. Call desktop.list_running_apps to see exact names.`;
    case 'path_not_found':
      return `${base} The file or folder path does not exist on this Mac. Re-check the staged path, search the parent folder, or ask the user to upload/select the file again.`;
    case 'invalid_input':
      return `${base} Check the tool's argument schema.`;
    default:
      return base;
  }
}

function stringifyMemoryResults(results: Awaited<ReturnType<typeof semanticSearchMemories>>): string {
  if (results.length === 0) return 'No matching memories found.';
  return results.map((r, i) =>
    `${i + 1}. [${r.memory_kind}] ${r.title}: ${r.content} (similarity: ${r.similarity.toFixed(2)})`
  ).join('\n');
}

function normalizeTaskStatusInput(status?: string | null): string | null {
  if (!status) return null;
  const normalized = status.trim().toLowerCase();
  if (['open', 'active'].includes(normalized)) return 'todo';
  if (['in progress', 'in-progress', 'doing'].includes(normalized)) return 'in_progress';
  if (['peer review', 'peer-review'].includes(normalized)) return 'peer_review';
  return normalized;
}

function renderTaskLine(task: Record<string, any>): string {
  return `- [${task.status}] ${task.title}${task.priority ? ` (${task.priority})` : ''}${task.assigned_to ? ` — assignee: ${task.assigned_to}` : ''} — id: ${String(task.id).slice(0, 8)}`;
}

async function maybeRequestToolApproval(
  tool: OpenSwanRuntimeToolName,
  args: Record<string, unknown>,
  context: OpenSwanRuntimeToolContext,
): Promise<{ approvalId: string; message: string; status: 'pending' | 'rejected' | 'failed_to_create' | 'lookup_failed' } | null> {
  const policy = getOpenSwanToolPolicy(tool, context.activePluginIds);
  if (policy.approvalMode !== 'ask' || !context.runId || tool.startsWith('approvals.')) {
    return null;
  }

  const title = `OpenSwan approval required: ${tool}`;
  const { data: existing, error: existingError } = await supabase
    .from('agent_run_approvals')
    .select('id,status,payload')
    .eq('run_id', context.runId)
    .eq('title', title)
    .order('requested_at', { ascending: false })
    .limit(8);

  if (existingError) {
    return {
      approvalId: '',
      status: 'lookup_failed',
      message: `Approval lookup failed for ${tool}: ${existingError.message}. Tool not executed.`,
    };
  }

  const decision: OpenSwanRuntimeApprovalDecision = resolveOpenSwanRuntimeApprovalDecision({
    tool,
    args,
    rows: (existing || []) as any,
  });

  if (decision.kind === 'pass') {
    return null;
  }
  if (decision.kind === 'defer') {
    return {
      approvalId: decision.approvalId,
      status: 'pending',
      message: decision.message,
    };
  }
  if (decision.kind === 'block') {
    return {
      approvalId: decision.approvalId,
      status: 'rejected',
      message: decision.message,
    };
  }

  const toolApprovalKey = buildOpenSwanToolApprovalKey(tool, args);

  const { requestRunApproval } = await import('./agentRunSystem');
  const approval = await requestRunApproval({
    runId: context.runId,
    circleId: context.circleId,
    approvalKind: policy.approvalKind || 'privileged_action',
    title,
    description: `${policy.summary} Review the requested tool input before continuing.`,
    requestedBy: context.userId,
    payload: {
      tool,
      args,
      toolApprovalKey,
      toolApprovalKeyVersion: 1,
      policyFamily: policy.family,
      approvalMode: policy.approvalMode,
      mutatesState: policy.mutatesState,
      externalSideEffect: policy.externalSideEffect,
    },
  });

  if (!approval) {
    return {
      approvalId: '',
      status: 'failed_to_create',
      message: `Approval required for ${tool}, but the request could not be created.`,
    };
  }

  return {
    approvalId: approval.id,
    status: 'pending',
    message: `Approval requested for ${tool} (id: ${approval.id.slice(0, 8)}).`,
  };
}

export function formatOpenSwanRuntimeToolResult<T extends OpenSwanRuntimeToolName>(
  tool: T,
  result: OpenSwanToolExecutionResultMap[T],
): string {
  switch (tool) {
    case 'search_memories':
      return (result as OpenSwanToolExecutionResultMap['search_memories']).resultsText;
    case 'save_memory':
    case 'missions.list':
    case 'missions.create_task':
    case 'missions.complete_task':
    case 'github.list_repos':
    case 'github.read_file':
    case 'tasks.list':
    case 'tasks.get':
    case 'tasks.create':
    case 'tasks.update_status':
    case 'tasks.assign':
    case 'tasks.comment':
    case 'tasks.add_artifact':
    case 'goals.list':
    case 'goals.create':
    case 'goals.update_progress':
    case 'goals.update_status':
    case 'messages.list':
    case 'messages.create':
    case 'check_ins.list':
    case 'research.search':
    case 'research.save':
    case 'rooms.list':
    case 'rooms.create':
    case 'rooms.send_message':
    case 'rooms.list_tasks':
    case 'rooms.create_task':
    case 'rooms.create_file':
    case 'rooms.update_file':
    case 'rooms.list_files':
    case 'rooms.read_file':
    case 'integrations.list':
    case 'office.list_agents':
    case 'agent.codex_acquire_asset':
    case 'agent.recover_failed_task':
    case 'agent.build_app_capability':
    case 'circle.update_settings':
    case 'circle.update_budget_caps':
    case 'circle.update_office_theme':
    case 'agent.update_appearance':
    case 'agent.rename':
    case 'rooms.rename':
    case 'rooms.archive':
    case 'rooms.unarchive':
    case 'missions.create':
    case 'missions.assign_agent':
    case 'missions.unassign_agent':
    case 'missions.update_status':
    case 'circle.toggle_public':
    case 'memory.pin':
    case 'memory.unpin':
    case 'memory.forget':
    case 'check_ins.log':
    case 'automations.list':
    case 'automations.toggle_enabled':
    case 'missions.remove_task':
    case 'missions.update_task':
    case 'agent.set_spirit':
    case 'approvals.list':
    case 'approvals.request':
    case 'approvals.resolve':
    case 'vault.list':
    case 'vault.find':
    case 'vault.grants':
    case 'vault.grant':
    case 'vault.revoke':
    case 'vault.runbook':
    case 'vault.resolve_for_task':
    case 'browser.open_url':
    case 'browser.dom_snapshot':
    case 'browser.verification_state':
    case 'browser.click_role':
    case 'browser.fill_field':
    case 'browser.select_option':
    case 'browser.upload_file':
    case 'browser.press_key':
    case 'browser.screenshot':
    case 'browser.close':
    case 'desktop.launch_app':
    case 'desktop.focus_app':
    case 'desktop.type_text':
    case 'desktop.paste_text':
    case 'desktop.press_keys':
    case 'desktop.menu_click':
    case 'desktop.indesign_document_status':
    case 'desktop.indesign_text_inventory':
    case 'desktop.indesign_set_layer_state':
    case 'desktop.indesign_batch_find_change':
    case 'desktop.indesign_batch_update_text_layers':
    case 'desktop.indesign_update_text_layer':
    case 'desktop.indesign_relink_asset':
    case 'desktop.indesign_package_document':
    case 'desktop.indesign_export_proof':
    case 'desktop.photoshop_document_status':
    case 'desktop.photoshop_layer_inventory':
    case 'desktop.photoshop_set_layer_state':
    case 'desktop.photoshop_update_text_layer':
    case 'desktop.photoshop_place_asset':
    case 'desktop.photoshop_export_proof':
    case 'desktop.list_running_apps':
    case 'desktop.list_browser_tabs':
    case 'desktop.window_state':
    case 'desktop.clipboard':
    case 'desktop.clipboard_write':
    case 'desktop.clipboard_clear':
    case 'desktop.file_list':
    case 'desktop.file_read':
    case 'desktop.file_search':
    case 'desktop.file_stat':
    case 'desktop.file_rename':
    case 'desktop.file_write_text':
    case 'desktop.file_copy':
    case 'desktop.file_trash':
    case 'desktop.file_mkdir':
    case 'desktop.shortcuts_list':
    case 'desktop.shortcuts_run':
    case 'desktop.window_manage':
    case 'desktop.mouse_move':
    case 'desktop.mouse_click':
    case 'desktop.mouse_down':
    case 'desktop.mouse_up':
    case 'desktop.mouse_drag':
    case 'desktop.mouse_scroll':
    case 'desktop.wait_for_app':
    case 'desktop.screenshot':
    case 'desktop.open_url':
    case 'desktop.open_path':
    case 'desktop.click_at':
    case 'desktop.screen_size':
    case 'desktop.read_a11y_tree':
    case 'desktop.click_element':
    case 'desktop.set_element_value':
      return (result as { resultsText: string }).resultsText;
    case 'browser.plan_task': {
      const browserResult = result as OpenSwanToolExecutionResultMap['browser.plan_task'];
      return browserResult.summaryText;
    }
    case 'fetch_url': {
      const fetchResult = result as OpenSwanToolExecutionResultMap['fetch_url'];
      if (!fetchResult.ok) {
        return fetchResult.error || 'Fetch failed.';
      }
      return fetchResult.content;
    }
    case 'list_circle_members':
      return (result as OpenSwanToolExecutionResultMap['list_circle_members']).resultsText;
    case 'schedule_action': {
      const scheduleResult = result as OpenSwanToolExecutionResultMap['schedule_action'];
      return scheduleResult.resultText;
    }
    case 'verification.typecheck':
    case 'verification.tests':
    case 'verification.lint': {
      const verificationResult = result as VerificationExecutionResult;
      if (!verificationResult.executed) {
        return verificationResult.error || 'Verification not executed.';
      }
      if (!verificationResult.ok) {
        return verificationResult.error || verificationResult.stderr || 'Verification failed.';
      }
      return verificationResult.stdout || `${tool} passed.`;
    }
    default:
      return JSON.stringify(result);
  }
}

export async function executeOpenSwanTool<T extends OpenSwanToolName>(
  tool: T,
  args: OpenSwanToolExecutionArgs[T],
): Promise<OpenSwanToolExecutionResultMap[T]> {
  switch (tool) {
    case 'workspace.create_room':
      return await createWorkspaceFromArtifact(
        (args as OpenSwanToolExecutionArgs['workspace.create_room']).circleId,
        (args as OpenSwanToolExecutionArgs['workspace.create_room']).artifact,
      ) as OpenSwanToolExecutionResultMap[T];
    case 'workspace.apply_artifacts':
      return await createFilesInRoomFromArtifact(
        (args as OpenSwanToolExecutionArgs['workspace.apply_artifacts']).roomId,
        (args as OpenSwanToolExecutionArgs['workspace.apply_artifacts']).artifact,
      ) as OpenSwanToolExecutionResultMap[T];
    case 'workspace.open_preview': {
      const previewArgs = args as OpenSwanToolExecutionArgs['workspace.open_preview'];
      if ('circleId' in previewArgs) {
        primeRoomWorkspaceLaunch({
          circleId: previewArgs.circleId,
          roomId: previewArgs.roomId,
          primaryFileId: previewArgs.primaryFileId || null,
          preferredPanel: previewArgs.preferredPanel || 'playground',
        });
      } else {
        focusRoomWorkspaceFile({
          roomId: previewArgs.roomId,
          primaryFileId: previewArgs.primaryFileId || null,
          preferredPanel: previewArgs.preferredPanel || 'playground',
        });
      }
      return { ok: true } as OpenSwanToolExecutionResultMap[T];
    }
    case 'verification.typecheck':
    case 'verification.tests':
    case 'verification.lint': {
      const verificationTool = tool as 'verification.typecheck' | 'verification.tests' | 'verification.lint';
      const command = (args as VerificationCommandArgs).command || DEFAULT_VERIFICATION_COMMANDS[verificationTool];
      const bridgeOk = await detectClaudeCodeBridge();
      if (!bridgeOk) {
        return {
          ok: false,
          executed: false,
          command,
          error: 'Local coding bridge unavailable',
        } as OpenSwanToolExecutionResultMap[T];
      }
      const result = await execBridgeCommand(command);
      return {
        ok: result.ok,
        executed: true,
        command,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      } as OpenSwanToolExecutionResultMap[T];
    }
    default:
      return { ok: true, planned: true } as OpenSwanToolExecutionResultMap[T];
  }
}

export async function executeOpenSwanRuntimeTool<T extends OpenSwanRuntimeToolName>(
  tool: T,
  args: OpenSwanToolExecutionArgs[T],
  context: OpenSwanRuntimeToolContext,
): Promise<OpenSwanToolExecutionResultMap[T]> {
  const approvalGate = await maybeRequestToolApproval(tool, (args || {}) as Record<string, unknown>, context);
  if (approvalGate) {
    const approvalRequest = approvalGate.status === 'pending'
      ? { id: approvalGate.approvalId, required: true, status: approvalGate.status }
      : undefined;
    if (tool === 'schedule_action') {
      return {
        ok: false,
        resultText: approvalGate.message,
        error: approvalGate.message,
        ...(approvalRequest ? { approvalRequest } : {}),
      } as unknown as OpenSwanToolExecutionResultMap[T];
    }
    return {
      ok: false,
      resultsText: approvalGate.message,
      ...(approvalRequest ? { approvalRequest } : {}),
    } as unknown as OpenSwanToolExecutionResultMap[T];
  }

  switch (tool) {
    case 'search_memories': {
      const results = await semanticSearchMemories({
        queryText: String((args as SearchMemoriesArgs).query || ''),
        circleId: context.circleId,
        soulKey: context.activeSoulKey,
        limit: Math.min(Number((args as SearchMemoriesArgs).limit) || 8, 20),
        matchThreshold: 0.5,
      });
      return {
        ok: true,
        resultsText: stringifyMemoryResults(results),
      } as OpenSwanToolExecutionResultMap[T];
    }
    case 'browser.plan_task': {
      const browserPlan = await describeComputerUsePlan({
        task: String((args as BrowserPlanTaskArgs).task || ''),
        circleId: context.circleId,
        userId: context.userId,
        agentName: 'OpenSwan',
      });
      return {
        ok: true,
        summaryText: browserPlan.summaryText,
        backend: browserPlan.backendLabel,
        actionCount: browserPlan.actions.length,
        requiresApproval: browserPlan.requiresApproval,
        plan: toBrowserPlanCardData(browserPlan),
      } as OpenSwanToolExecutionResultMap[T];
    }
    case 'browser.open_url': {
      try {
        const { openUrl } = await import('./browserBridge');
        const a = args as OpenSwanToolExecutionArgs['browser.open_url'];
        const r = await openUrl(String(a.url || ''), { timeoutMs: a.timeoutMs, waitUntil: a.waitUntil, taskContext: a.taskContext });
        if (!r.ok) return browserToolFailureResult(r, 'Browser navigation failed.') as any;
        return { ok: true, resultsText: `Opened ${r.data?.url || a.url}${r.data?.title ? ` — ${r.data.title}` : ''}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.dom_snapshot': {
      try {
        const { domSnapshot, renderBrowserTree } = await import('./browserBridge');
        const a = args as OpenSwanToolExecutionArgs['browser.dom_snapshot'];
        const r = await domSnapshot({ maxNodes: a.maxNodes, interestingOnly: a.interestingOnly });
        if (!r.ok || !r.data) return browserToolFailureResult(r, 'Browser DOM snapshot failed.') as any;
        const text = renderBrowserTree(r.data.tree).join('\n');
        return {
          ok: true,
          resultsText: `Browser DOM snapshot for ${r.data.title || r.data.url} (${r.data.nodeCount} nodes):\n${text.slice(0, 8192)}${text.length > 8192 ? '\n...truncated' : ''}`,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.verification_state': {
      try {
        const { verificationState } = await import('./browserBridge');
        const r = await verificationState();
        if (!r.ok || !r.data) return browserToolFailureResult(r, 'Browser verification check failed.') as any;
        if (r.data.verificationDetected && r.data.gate) {
          return {
            ok: true,
            resultsText: `${r.data.gate.label}: ${r.data.gate.reason}\n${r.data.gate.pauseInstruction}\nURL: ${r.data.url}`,
          } as any;
        }
        return { ok: true, resultsText: `No browser bot verification detected on ${r.data.title || r.data.url || 'current page'}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.click_role': {
      try {
        const a = args as OpenSwanToolExecutionArgs['browser.click_role'];
        const gate = detectAutomationVerificationGate([a.role, a.name, a.selector]);
        if (gate) {
          return { ok: false, resultsText: `${gate.label}: ${gate.pauseInstruction}` } as any;
        }
        const { clickRole } = await import('./browserBridge');
        const r = await clickRole(a);
        if (!r.ok) return browserToolFailureResult(r, 'Browser click failed.') as any;
        return { ok: true, resultsText: `Clicked browser ${a.role}${a.name ? ` "${a.name}"` : a.selector ? ` selector ${a.selector}` : ''}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.fill_field': {
      try {
        const a = args as OpenSwanToolExecutionArgs['browser.fill_field'];
        const gate = detectAutomationVerificationGate([a.role, a.name, a.selector, a.text]);
        if (gate) {
          return { ok: false, resultsText: `${gate.label}: ${gate.pauseInstruction}` } as any;
        }
        const { fillField } = await import('./browserBridge');
        const r = await fillField({ ...a, role: a.role || 'textbox' });
        if (!r.ok) return browserToolFailureResult(r, 'Browser fill failed.') as any;
        return { ok: true, resultsText: `Filled browser field${a.name ? ` "${a.name}"` : a.selector ? ` ${a.selector}` : ''} (${a.text.length} chars${a.submit ? ', submitted' : ''}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.select_option': {
      try {
        const a = args as OpenSwanToolExecutionArgs['browser.select_option'];
        const gate = detectAutomationVerificationGate([a.role, a.name, a.selector, a.value]);
        if (gate) {
          return { ok: false, resultsText: `${gate.label}: ${gate.pauseInstruction}` } as any;
        }
        const { selectOption } = await import('./browserBridge');
        const r = await selectOption({ ...a, role: a.role || 'combobox' });
        if (!r.ok) return browserToolFailureResult(r, 'Browser select failed.') as any;
        return { ok: true, resultsText: `Selected browser option "${a.value}"${a.name ? ` in "${a.name}"` : a.selector ? ` in ${a.selector}` : ''}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.upload_file': {
      try {
        const a = args as OpenSwanToolExecutionArgs['browser.upload_file'];
        const gate = detectAutomationVerificationGate([a.name, a.selector, a.buttonRole, a.buttonName, a.buttonSelector]);
        if (gate) {
          return { ok: false, resultsText: `${gate.label}: ${gate.pauseInstruction}` } as any;
        }
        const filePath = String(a.filePath || '').trim();
        const { requestLocalFileSessionGrant } = await import('./desktopBridge');
        const grant = await requestLocalFileSessionGrant({ roots: [filePath], scope: 'read', reason: `Browser upload ${filePath}` });
        if (!grant.ok) return { ok: false, resultsText: describeDesktopFailure(grant.error, grant.errorCode) } as any;
        const { uploadFile } = await import('./browserBridge');
        const r = await uploadFile(a);
        if (!r.ok || !r.data) return browserToolFailureResult(r, 'Browser file upload failed.') as any;
        return {
          ok: true,
          resultsText: `Uploaded ${r.data.fileName} (${r.data.sizeBytes} bytes) through browser ${r.data.method || 'file input'}.`,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.press_key': {
      try {
        const a = args as OpenSwanToolExecutionArgs['browser.press_key'];
        const gate = detectAutomationVerificationGate(a.combo);
        if (gate) {
          return { ok: false, resultsText: `${gate.label}: ${gate.pauseInstruction}` } as any;
        }
        const { pressKey } = await import('./browserBridge');
        const r = await pressKey(String(a.combo || ''), { taskContext: a.taskContext });
        if (!r.ok) return browserToolFailureResult(r, 'Browser key press failed.') as any;
        return { ok: true, resultsText: `Pressed browser key ${r.data?.combo || a.combo}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.screenshot': {
      try {
        const { screenshot } = await import('./browserBridge');
        const a = args as OpenSwanToolExecutionArgs['browser.screenshot'];
        const r = await screenshot({ fullPage: a.fullPage === true });
        if (!r.ok || !r.data) return browserToolFailureResult(r, 'Browser screenshot failed.') as any;
        return {
          ok: true,
          resultsText: `Captured browser screenshot (${Math.round((r.data.sizeBytes || 0) / 1024)} KB PNG). base64 length: ${(r.data.base64 || '').length} chars.`,
          base64: r.data.base64,
          mimeType: r.data.mimeType,
          sizeBytes: r.data.sizeBytes,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'browser.close': {
      try {
        const { closeBrowser } = await import('./browserBridge');
        const r = await closeBrowser();
        if (!r.ok) return browserToolFailureResult(r, 'Browser close failed.') as any;
        return { ok: true, resultsText: 'Closed local browser context.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'fetch_url': {
      const url = String((args as FetchUrlArgs).url || '');
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return {
          ok: false,
          content: '',
          error: 'Invalid URL — must start with http:// or https://',
        } as OpenSwanToolExecutionResultMap[T];
      }
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'OpenSwan/1.0 (The Underground Circle)' },
          signal: AbortSignal.timeout(10_000),
        });
        const text = await res.text();
        if (!res.ok) {
          return {
            ok: false,
            content: '',
            status: res.status,
            statusText: res.statusText,
            error: `HTTP ${res.status}: ${res.statusText}`,
          } as OpenSwanToolExecutionResultMap[T];
        }
        return {
          ok: true,
          content: text.slice(0, 8000) + (text.length > 8000 ? '\n...(truncated)' : ''),
          status: res.status,
          statusText: res.statusText,
        } as OpenSwanToolExecutionResultMap[T];
      } catch (error) {
        return {
          ok: false,
          content: '',
          error: `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        } as OpenSwanToolExecutionResultMap[T];
      }
    }
    case 'list_circle_members': {
      const { data } = await supabase
        .from('circle_members')
        .select('user:profiles(display_name, username)')
        .eq('circle_id', context.circleId);
      const resultsText = !data || data.length === 0
        ? 'No members found.'
        : (data as any[])
            .map((row, index) => `${index + 1}. ${row.user?.display_name || row.user?.username || 'Unknown'}`)
            .join('\n');
      return {
        ok: true,
        resultsText,
      } as OpenSwanToolExecutionResultMap[T];
    }
    case 'schedule_action': {
      try {
        const recurrence = (args as ScheduleActionArgs).recurrence
          ? parseRecurrence(String((args as ScheduleActionArgs).recurrence))
          : null;
        const scheduledFor = (args as ScheduleActionArgs).scheduled_for
          ? String((args as ScheduleActionArgs).scheduled_for)
          : recurrence
            ? nextCronOccurrence(recurrence.cron).toISOString()
            : undefined;
        const result = await scheduleAction({
          kind: String((args as ScheduleActionArgs).kind) as any,
          circleId: context.circleId || null,
          payload: ((args as ScheduleActionArgs).payload || {}) as Record<string, unknown>,
          scheduledFor,
          recurrence: recurrence?.cron,
          recurrenceLabel: recurrence?.label,
        } as any);
        return {
          ok: true,
          actionId: result.id,
          resultText: recurrence
            ? `Recurring action queued (id: ${result.id}). ${recurrence.label}. Next: ${new Date(result.scheduled_for).toLocaleString()}.`
            : `Action queued (id: ${result.id}). Check the Outbox for status.`,
        } as OpenSwanToolExecutionResultMap[T];
      } catch (error) {
        return {
          ok: false,
          resultText: `Schedule failed: ${error instanceof Error ? error.message : String(error)}`,
          error: error instanceof Error ? error.message : String(error),
        } as OpenSwanToolExecutionResultMap[T];
      }
    }
    // ── Missions ──────────────────────────────────────────────────────────
    case 'missions.list': {
      try {
        const { getMissions, getMissionTasks, missionProgress } = await import('./missions');
        const status = (args as any).status || 'active';
        const missions = await getMissions(context.circleId);
        const filtered = status === 'all' ? missions : missions.filter(m => m.status === status);
        const lines: string[] = [];
        for (const m of filtered.slice(0, 10)) {
          const tasks = await getMissionTasks(m.id);
          const pct = missionProgress(tasks);
          const done = tasks.filter(t => t.status === 'done').length;
          lines.push(`- **${m.title}** [${m.status}] ${pct}% (${done}/${tasks.length} tasks)${m.deadline ? ` due ${m.deadline}` : ''}`);
        }
        return { ok: true, resultsText: lines.length > 0 ? lines.join('\n') : 'No missions found.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.create_task': {
      try {
        const { createMissionTask } = await import('./missions');
        const a = args as any;
        const { task, error } = await createMissionTask(a.missionId, a.title, { description: a.description, assigneeId: a.assigneeId });
        if (error || !task) return { ok: false, resultsText: error || 'Failed to create task.' } as any;
        return { ok: true, resultsText: `Created task "${task.title}" (id: ${task.id})` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.complete_task': {
      try {
        const { updateMissionTask } = await import('./missions');
        const { error } = await updateMissionTask((args as any).taskId, { status: 'done' });
        if (error) return { ok: false, resultsText: error } as any;
        return { ok: true, resultsText: `Task marked as done.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── GitHub ────────────────────────────────────────────────────────────
    case 'github.list_repos': {
      try {
        const { getStoredToken, listRepos } = await import('./github');
        const token = await getStoredToken(context.circleId);
        if (!token) return { ok: false, resultsText: 'No GitHub token stored for this circle.' } as any;
        const { repos } = await listRepos(token, 1);
        const lines = repos.slice(0, 20).map(r => `- ${r.full_name} (${r.private ? 'private' : 'public'}, ${r.language || 'unknown'})`);
        return { ok: true, resultsText: lines.length > 0 ? lines.join('\n') : 'No repos found.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'github.read_file': {
      try {
        const { getStoredToken, getFileContent } = await import('./github');
        const token = await getStoredToken(context.circleId);
        if (!token) return { ok: false, resultsText: 'No GitHub token stored.' } as any;
        const a = args as any;
        const { content, error } = await getFileContent(token, a.owner, a.repo, a.path);
        if (error) return { ok: false, resultsText: error } as any;
        return { ok: true, resultsText: content.slice(0, 8000) } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Tasks (Kanban) ──────────────────────────────────────────────────
    case 'tasks.list': {
      try {
        const requestedStatus = String((args as any).status || 'all').toLowerCase();
        let q = supabase
          .from('tasks')
          .select('id, title, status, priority, assigned_to, created_at')
          .eq('circle_id', context.circleId)
          .order('created_at', { ascending: false })
          .limit(30);
        if (requestedStatus === 'mine') {
          q = q.or(`assigned_to.eq.${context.userId},created_by.eq.${context.userId}`);
        } else if (requestedStatus !== 'all') {
          const normalized = normalizeTaskStatusInput(requestedStatus);
          if (normalized) q = q.eq('status', normalized);
        }
        const { data } = await q;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No tasks found.' } as any;
        const lines = data.map((t: any) => renderTaskLine(t));
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.get': {
      try {
        const { data, error } = await supabase
          .from('tasks')
          .select('id, title, description, status, priority, assigned_to, due_date, created_at, room_id, goal_id')
          .eq('id', (args as any).taskId)
          .single();
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data) return { ok: false, resultsText: 'Task not found.' } as any;
        const lines = [
          `Task: ${data.title}`,
          `Status: ${data.status}`,
          `Priority: ${data.priority || 'normal'}`,
          data.assigned_to ? `Assigned to: ${data.assigned_to}` : '',
          data.due_date ? `Due: ${data.due_date}` : '',
          data.room_id ? `Room: ${data.room_id}` : '',
          data.goal_id ? `Goal: ${data.goal_id}` : '',
          data.description ? `Description: ${data.description}` : '',
        ].filter(Boolean);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.create': {
      try {
        const a = args as any;
        const { data, error } = await supabase.from('tasks').insert({
          circle_id: context.circleId,
          title: a.title,
          description: a.description || null,
          priority: a.priority || 'normal',
          assigned_to: a.assigneeId || null,
          created_by: context.userId,
          status: 'todo',
        }).select('id, title').single();
        if (error) return { ok: false, resultsText: error.message } as any;
        return { ok: true, resultsText: `Created task "${data.title}" (id: ${data.id.slice(0, 8)})` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.update_status': {
      try {
        const a = args as any;
        const normalizedStatus = normalizeTaskStatusInput(a.status);
        if (!normalizedStatus) return { ok: false, resultsText: 'Invalid task status.' } as any;
        const update: Record<string, unknown> = { status: normalizedStatus, updated_at: new Date().toISOString() };
        if (normalizedStatus === 'done') update.completed_at = new Date().toISOString();
        const { error } = await supabase.from('tasks').update(update).eq('id', a.taskId);
        if (error) return { ok: false, resultsText: error.message } as any;
        return { ok: true, resultsText: `Task ${a.taskId.slice(0, 8)} moved to ${normalizedStatus}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.assign': {
      try {
        const a = args as any;
        const { error } = await supabase
          .from('tasks')
          .update({ assigned_to: a.assigneeId, updated_at: new Date().toISOString() })
          .eq('id', a.taskId);
        if (error) return { ok: false, resultsText: error.message } as any;
        return { ok: true, resultsText: `Task ${String(a.taskId).slice(0, 8)} assigned to ${a.assigneeId}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.comment': {
      try {
        const a = args as any;
        const insert: any = {
          task_id: a.taskId,
          user_id: context.userId,
          content: String(a.content || '').trim(),
        };
        if (a.taskRunId) insert.task_run_id = a.taskRunId;
        let result = await supabase.from('task_comments').insert(insert);
        if (result.error && insert.task_run_id && String(result.error.message || '').includes('task_run_id')) {
          delete insert.task_run_id;
          result = await supabase.from('task_comments').insert(insert);
        }
        if (result.error) return { ok: false, resultsText: result.error.message } as any;
        return { ok: true, resultsText: `Added comment to task ${String(a.taskId).slice(0, 8)}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'tasks.add_artifact': {
      try {
        const { createTaskRunArtifact } = await import('./taskExecutionRuntime');
        const a = args as any;
        const { error } = await createTaskRunArtifact(
          a.runId,
          a.taskId,
          context.circleId,
          a.artifactKind,
          a.label,
          a.content,
          a.url,
          a.filePath,
          a.metadata,
        );
        if (error) return { ok: false, resultsText: error.message || String(error) } as any;
        return { ok: true, resultsText: `Attached artifact "${a.label}" to task run ${String(a.runId).slice(0, 8)}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Goals ──────────────────────────────────────────────────────────
    case 'goals.list': {
      try {
        const { getCircleGoals, getGoalProgress } = await import('./goals');
        const goals = await getCircleGoals(context.circleId);
        const activeOnly = (args as any).activeOnly !== false;
        const filtered = activeOnly ? goals.filter((goal: any) => goal.status === 'active') : goals;
        if (filtered.length === 0) return { ok: true, resultsText: 'No goals found.' } as any;
        const lines = filtered.slice(0, 20).map((goal: any) => `- ${goal.title} [${goal.goal_type}] ${goal.status} — ${Math.round(getGoalProgress(goal))}%`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'goals.create': {
      try {
        const { supabase: authSupabase } = await import('./supabase');
        const { data: profile } = await authSupabase.from('profiles').select('org_id').eq('id', context.userId).single();
        const orgId = profile?.org_id;
        if (!orgId) return { ok: false, resultsText: 'No org_id found for current user, cannot create circle goal.' } as any;
        const { createGoal } = await import('./goals');
        const a = args as any;
        const result = await createGoal({
          orgId,
          goalType: (a.goalType || 'circle_goal') as any,
          title: a.title,
          description: a.description,
          circleId: context.circleId,
          ownerId: a.ownerId || context.userId,
          targetValue: typeof a.targetValue === 'number' ? a.targetValue : undefined,
          unit: a.unit,
          dueDate: a.dueDate,
        });
        if (result.error || !result.data) return { ok: false, resultsText: result.error || 'Failed to create goal.' } as any;
        return { ok: true, resultsText: `Created goal "${result.data.title}" (${result.data.goal_type}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'goals.update_progress': {
      try {
        const { updateGoalProgress } = await import('./goals');
        const result = await updateGoalProgress((args as any).goalId, Number((args as any).currentValue));
        if (result.error) return { ok: false, resultsText: result.error } as any;
        return { ok: true, resultsText: `Goal ${String((args as any).goalId).slice(0, 8)} progress updated to ${Number((args as any).currentValue)}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'goals.update_status': {
      try {
        const { updateGoalStatus } = await import('./goals');
        const result = await updateGoalStatus((args as any).goalId, (args as any).status);
        if (result.error) return { ok: false, resultsText: result.error } as any;
        return { ok: true, resultsText: `Goal ${(args as any).goalId.slice(0, 8)} moved to ${(args as any).status}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Messages + Check-ins ───────────────────────────────────────────
    case 'messages.list': {
      try {
        const limit = Math.min(Number((args as any).limit) || 12, 30);
        const { data, error } = await supabase
          .from('messages')
          .select('id, content, created_at, user:profiles(display_name, username)')
          .eq('circle_id', context.circleId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No recent messages found.' } as any;
        const lines = (data as any[]).map((row, index) => `${index + 1}. ${(row.user?.display_name || row.user?.username || 'Unknown')}: ${String(row.content || '').replace(/\s+/g, ' ').slice(0, 180)}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'messages.create': {
      try {
        const { persistChatMessage } = await import('./chatService');
        const a = args as any;
        const id = await persistChatMessage({
          circleId: context.circleId,
          userId: context.userId,
          content: String(a.content || '').trim(),
          threadId: a.threadId || context.threadId || null,
          replyToId: a.replyToId || null,
          isBot: false,
        });
        if (!id) return { ok: false, resultsText: 'Failed to post message.' } as any;
        return { ok: true, resultsText: `Posted message (id: ${id.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'check_ins.list': {
      try {
        const limit = Math.min(Number((args as any).limit) || 10, 25);
        const since = (args as any).since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data, error } = await supabase
          .from('check_ins')
          .select('id, content, created_at, user:profiles(display_name, username)')
          .eq('circle_id', context.circleId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No recent check-ins found.' } as any;
        const lines = (data as any[]).map((row, index) => `${index + 1}. ${(row.user?.display_name || row.user?.username || 'Unknown')}: ${String(row.content || '').replace(/\s+/g, ' ').slice(0, 200)}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Research ───────────────────────────────────────────────────────
    case 'research.search': {
      try {
        const { buildResearchSearchResponse } = await import('./researchKnowledge');
        const text = await buildResearchSearchResponse({
          query: String((args as any).query || ''),
          circleId: context.circleId,
          limit: Math.min(Number((args as any).limit) || 5, 10),
        });
        return { ok: true, resultsText: text } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'research.save': {
      try {
        const { saveResearchDocument } = await import('./researchKnowledge');
        const a = args as any;
        const doc = await saveResearchDocument({
          circleId: context.circleId,
          title: a.title,
          summary: a.summary,
          content: a.content,
          domainKey: a.domainKey,
          tags: Array.isArray(a.tags) ? a.tags : [],
          sourceUrl: a.sourceUrl,
        });
        if (!doc) return { ok: false, resultsText: 'Failed to save research document.' } as any;
        return { ok: true, resultsText: `Saved research document "${doc.title}".` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Rooms ──────────────────────────────────────────────────────────
    case 'rooms.list': {
      try {
        const { data, error } = await supabase
          .from('rooms')
          .select('id, name, status, color, created_at')
          .eq('circle_id', context.circleId)
          .order('created_at', { ascending: false })
          .limit(20);
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No rooms found.' } as any;
        const lines = (data as any[]).map((room) => `- ${room.name} [${room.status || 'unknown'}] — id: ${String(room.id).slice(0, 8)}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.create': {
      try {
        const { createRoom } = await import('../screens/circles/tabs/rooms/roomRepository');
        const a = args as any;
        const roomId = await createRoom(context.circleId, String(a.name || '').trim(), a.description || undefined);
        if (!roomId) return { ok: false, resultsText: 'Failed to create room.' } as any;
        return { ok: true, resultsText: `Created room "${String(a.name || '').trim()}" (id: ${roomId.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.send_message': {
      try {
        const { sendMessage } = await import('../screens/circles/tabs/rooms/roomRepository');
        const a = args as any;
        const messageId = await sendMessage(a.roomId, context.userId, String(a.content || '').trim(), a.messageType || 'chat');
        if (!messageId) return { ok: false, resultsText: 'Failed to send room message.' } as any;
        return { ok: true, resultsText: `Posted room message (id: ${messageId.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.list_tasks': {
      try {
        const { loadTasks } = await import('../screens/circles/tabs/rooms/roomRepository');
        const tasks = await loadTasks((args as any).roomId);
        if (tasks.length === 0) return { ok: true, resultsText: 'No room tasks found.' } as any;
        const lines = tasks.map((task) => `- ${task.title} [${task.status}]${task.assignedTo ? ` — ${task.assignedTo}` : ''} — id: ${task.id.slice(0, 8)}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.create_task': {
      try {
        const a = args as any;
        const { data: auth } = await supabase.auth.getUser();
        const { data, error } = await supabase
          .from('room_tasks')
          .insert({
            room_id: a.roomId,
            name: String(a.name || '').trim(),
            schedule: a.schedule?.trim?.() || 'once',
            agent: a.agent?.trim?.() || 'Assistant',
            prompt: String(a.prompt || '').trim(),
            enabled: true,
            task_type: a.taskType || 'general',
            created_by: auth.user?.id || context.userId,
          })
          .select('id, name')
          .single();
        if (error) return { ok: false, resultsText: error.message } as any;
        return { ok: true, resultsText: `Created room task "${data.name}" (id: ${data.id.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.create_file': {
      try {
        const { createFile } = await import('../screens/circles/tabs/rooms/roomRepository');
        const a = args as any;
        const inferredType = typeof a.fileType === 'string' && a.fileType.trim()
          ? a.fileType.trim()
          : (String(a.name || '').split('.').pop() || 'plaintext');
        const fileId = await createFile(a.roomId, a.name, a.content, inferredType);
        if (!fileId) return { ok: false, resultsText: 'Failed to create room file.' } as any;
        return { ok: true, resultsText: `Created file "${a.name}" (id: ${fileId.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.update_file': {
      try {
        const { updateFileContent } = await import('../screens/circles/tabs/rooms/roomRepository');
        const ok = await updateFileContent((args as any).fileId, String((args as any).content || ''));
        if (!ok) return { ok: false, resultsText: 'Failed to update room file.' } as any;
        return { ok: true, resultsText: `Updated file ${String((args as any).fileId).slice(0, 8)}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Room Files ──────────────────────────────────────────────────────
    case 'rooms.list_files': {
      try {
        const { data } = await supabase.from('room_files').select('id, name, folder, file_type, size_bytes')
          .eq('room_id', (args as any).roomId).eq('is_deleted', false).order('folder').order('name');
        if (!data || data.length === 0) return { ok: true, resultsText: 'No files in this room.' } as any;
        const lines = data.map((f: any) => `- ${f.folder}/${f.name} (${f.file_type}, ${f.size_bytes}B)`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.read_file': {
      try {
        const { data } = await supabase.from('room_files').select('name, content, file_type, size_bytes')
          .eq('id', (args as any).fileId).single();
        if (!data) return { ok: false, resultsText: 'File not found.' } as any;
        return { ok: true, resultsText: `## ${data.name}\n\`\`\`\n${(data.content || '').slice(0, 8000)}\n\`\`\`` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Integrations + Office ──────────────────────────────────────────
    case 'integrations.list': {
      try {
        const { listCircleIntegrations } = await import('./circleIntegrations');
        const integrations = await listCircleIntegrations(context.circleId);
        if (integrations.length === 0) return { ok: true, resultsText: 'No integrations connected.' } as any;
        const lines = integrations.map((integration) => `- ${integration.label} [${integration.provider}] ${integration.status}${integration.capability_flags?.length ? ` — ${integration.capability_flags.join(', ')}` : ''}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'office.list_agents': {
      try {
        const { data, error } = await supabase
          .from('circle_office_agents')
          .select('id, name, provider, status, spirit, owner_display_name')
          .eq('circle_id', context.circleId)
          .eq('is_published', true)
          .order('created_at', { ascending: true });
        if (error) return { ok: false, resultsText: error.message } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No published office agents found.' } as any;
        const lines = (data as any[]).map((agent) => `- ${agent.name} [${agent.provider}] ${agent.status}${agent.spirit ? ` — spirit: ${agent.spirit}` : ''}${agent.owner_display_name ? ` — owner: ${agent.owner_display_name}` : ''}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'agent.codex_acquire_asset': {
      try {
        const a = args as OpenSwanToolExecutionArgs['agent.codex_acquire_asset'];
        const goal = String(a.goal || '').trim();
        if (!goal) return { ok: false, provider: 'codex', resultsText: 'goal is required.' } as any;

        const { buildAgentAssetAcquisitionPolicy, formatAgentAssetAcquisitionPolicySummary } = await import('./agentAssetAcquisitionPolicy');
        const policy = buildAgentAssetAcquisitionPolicy({
          goal,
          outputDir: a.outputDir,
          expectedFileName: a.expectedFileName,
          sourceUrl: a.sourceUrl,
          taskContext: a.taskContext,
        });
        const prompt = policy.prompt;
        const policySummary = formatAgentAssetAcquisitionPolicySummary(policy);

        const { fetchCodexSessions, launchCodexSessions } = await import('./codexDetector');
        const { sendTerminalAgentSessionMessage } = await import('./bridgeTaskDispatcher');
        let targetSessionId = String(a.sessionId || '').trim();

        if (!targetSessionId) {
          const sessions = await fetchCodexSessions().catch(() => []);
          const managed = sessions.find((session) => Boolean(session.terminalTitle || session.launchId || session.manageable));
          targetSessionId = managed?.sessionId || '';
        }

        if (targetSessionId) {
          const sent = await sendTerminalAgentSessionMessage('codex', targetSessionId, prompt);
          if (!sent.ok) {
            return {
              ok: false,
              provider: 'codex',
              sessionId: targetSessionId,
              resultsText: sent.error || 'Could not send acquisition task to Codex.',
            } as any;
          }
          return {
            ok: true,
            provider: 'codex',
            sessionId: sent.sessionId || targetSessionId,
            launched: false,
            resultsText: `Sent Codex asset acquisition task to ${sent.displayName || targetSessionId}. ${policySummary}`,
          } as any;
        }

        if (a.launchIfMissing === false) {
          return {
            ok: false,
            provider: 'codex',
            launched: false,
            resultsText: 'No managed Codex session is available and launchIfMissing is false.',
          } as any;
        }

        const launched = await launchCodexSessions({
          count: 1,
          prompt,
          names: ['Codex Asset Acquisition'],
          circleId: context.circleId,
          userId: context.userId,
        });
        if (!launched.ok || launched.launched < 1) {
          const error = launched.error || launched.failed?.[0]?.error || 'Could not launch Codex acquisition session.';
          return { ok: false, provider: 'codex', launched: false, resultsText: error } as any;
        }

        const session = launched.sessions[0];
        return {
          ok: true,
          provider: 'codex',
          sessionId: session?.sessionId,
          launched: true,
          resultsText: `Launched Codex asset acquisition session${session?.displayName ? ` (${session.displayName})` : ''}. ${policySummary}`,
        } as any;
      } catch (e: any) {
        return { ok: false, provider: 'codex', resultsText: e.message || 'Codex asset acquisition failed.' } as any;
      }
    }
    case 'agent.recover_failed_task': {
      try {
        const a = args as OpenSwanToolExecutionArgs['agent.recover_failed_task'];
        const task = String(a.task || '').trim();
        const failureMessage = String(a.failureMessage || '').trim();
        if (!task) return { ok: false, provider: 'codex', resultsText: 'task is required.' } as any;
        if (!failureMessage) return { ok: false, provider: 'codex', resultsText: 'failureMessage is required.' } as any;

        const { startConnectedAgentFailureRecovery } = await import('./agentFailureRecovery');
        const result = await startConnectedAgentFailureRecovery({
          task,
          failureMessage,
          failureStack: a.failureStack,
          outcomeStatus: a.outcomeStatus,
          executionKind: a.executionKind,
          runId: a.runId,
          planSummary: a.planSummary,
          groundingSummary: a.groundingSummary,
          preflightSummary: a.preflightSummary,
          source: a.source || 'openswan_tool_runtime',
          sessionId: a.sessionId,
          launchIfMissing: a.launchIfMissing,
          circleId: context.circleId,
          userId: context.userId,
        });
        return {
          ok: result.ok,
          provider: result.provider,
          sessionId: result.sessionId,
          launched: result.launched,
          recoveryAction: result.recoveryAction,
          recoveryRunbook: result.runbook as unknown as Record<string, unknown>,
          resultsText: result.message,
        } as any;
      } catch (e: any) {
        return { ok: false, provider: 'codex', resultsText: e.message || 'Failure recovery handoff failed.' } as any;
      }
    }
    case 'agent.build_app_capability': {
      try {
        const a = args as OpenSwanToolExecutionArgs['agent.build_app_capability'];
        const task = String(a.task || '').trim();
        if (!task) return { ok: false, provider: 'codex', resultsText: 'task is required.' } as any;

        const {
          buildAgentAppCapabilityBuildoutPolicy,
          formatAgentAppCapabilityBuildoutPolicySummary,
        } = await import('./agentAppCapabilityBuildout');
        const policy = buildAgentAppCapabilityBuildoutPolicy({
          task,
          appName: a.appName,
          capabilityGap: a.capabilityGap,
          desiredOutcome: a.desiredOutcome,
          currentPlanSummary: a.currentPlanSummary,
        });
        const prompt = policy.prompt;
        const policySummary = formatAgentAppCapabilityBuildoutPolicySummary(policy);

        // Provider-agnostic: route the buildout to whichever connected coding
        // agent is available (Codex, Claude Code, Gemini, Cursor) instead of
        // hard-failing when Codex isn't connected.
        const { dispatchConnectedAgentTask } = await import('./connectedAgentDispatch');
        const dispatch = await dispatchConnectedAgentTask({
          prompt,
          sessionName: 'App Capability Buildout',
          sessionId: a.sessionId,
          launchIfMissing: a.launchIfMissing,
          circleId: context.circleId,
          userId: context.userId,
        });
        return {
          ok: dispatch.ok,
          provider: dispatch.provider || undefined,
          sessionId: dispatch.sessionId,
          launched: dispatch.launched,
          buildoutKind: policy.kind,
          risk: policy.risk,
          appName: policy.appName,
          resultsText: dispatch.ok ? `${dispatch.resultsText} ${policySummary}` : dispatch.resultsText,
        } as any;
      } catch (e: any) {
        return { ok: false, provider: 'codex', resultsText: e.message || 'App capability buildout handoff failed.' } as any;
      }
    }
    // ── Circle / Agent / Office editing — chat-driven UI mutations ──
    case 'circle.update_settings': {
      try {
        const a = args as any;
        // Whitelist the columns — agent can't write to anything else
        // on the circles row (like id or created_at) via this tool.
        const patch: Record<string, any> = {};
        if (typeof a.name === 'string')         patch.name         = a.name.trim();
        if (typeof a.description === 'string')  patch.description  = a.description;
        if (typeof a.icon === 'string')         patch.icon         = a.icon;
        if (typeof a.accent_color === 'string') patch.accent_color = a.accent_color;
        if (typeof a.vibe === 'string')         patch.vibe         = a.vibe;
        if (Array.isArray(a.tags))              patch.tags         = a.tags.filter((t: unknown) => typeof t === 'string');
        if (Object.keys(patch).length === 0) {
          return { ok: false, resultsText: 'Nothing to update — pass at least one field (name / description / icon / accent_color / vibe / tags).' } as any;
        }
        const { error } = await supabase.from('circles').update(patch).eq('id', context.circleId);
        if (error) return { ok: false, resultsText: `Circle update failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Updated circle: ${Object.keys(patch).join(', ')}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'circle.update_budget_caps': {
      try {
        const a = args as any;
        // Merge into the circles.settings JSONB so we preserve other
        // settings (sessionMemoryMode, automation, etc.).
        const { data: existing } = await supabase
          .from('circles').select('settings').eq('id', context.circleId).maybeSingle();
        const current = (existing?.settings as any) || {};
        const patch: Record<string, any> = { ...current };
        const touched: string[] = [];
        if (typeof a.computer_use_max_cost_usd === 'number' && a.computer_use_max_cost_usd > 0) {
          patch.computer_use_max_cost_usd = a.computer_use_max_cost_usd; touched.push('computer_use');
        }
        if (typeof a.automation_max_cost_usd === 'number' && a.automation_max_cost_usd > 0) {
          patch.automation_max_cost_usd = a.automation_max_cost_usd; touched.push('automation');
        }
        if (typeof a.claude_total_max_cost_usd === 'number' && a.claude_total_max_cost_usd > 0) {
          patch.claude_total_max_cost_usd = a.claude_total_max_cost_usd; touched.push('claude_total');
        }
        if (touched.length === 0) {
          return { ok: false, resultsText: 'Pass at least one of computer_use_max_cost_usd / automation_max_cost_usd / claude_total_max_cost_usd as a positive number.' } as any;
        }
        const { error } = await supabase.from('circles').update({ settings: patch }).eq('id', context.circleId);
        if (error) return { ok: false, resultsText: `Budget update failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Updated budget caps: ${touched.join(', ')}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'circle.update_office_theme': {
      try {
        const a = args as any;
        if (typeof a.theme_id !== 'string' || !a.theme_id.trim()) {
          return { ok: false, resultsText: 'theme_id is required.' } as any;
        }
        const { data: existing } = await supabase
          .from('circles').select('settings').eq('id', context.circleId).maybeSingle();
        const current = (existing?.settings as any) || {};
        const patch: Record<string, any> = { ...current, office_theme_id: a.theme_id.trim() };
        if (typeof a.environment_type === 'string' && a.environment_type.trim()) {
          patch.office_environment_type = a.environment_type.trim();
        }
        const { error } = await supabase.from('circles').update({ settings: patch }).eq('id', context.circleId);
        if (error) return { ok: false, resultsText: `Theme update failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Switched office theme to "${a.theme_id}".` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'agent.update_appearance': {
      try {
        const a = args as any;
        const agentName = typeof a.agent_name === 'string' ? a.agent_name.trim() : '';
        const patch = (a.patch && typeof a.patch === 'object') ? a.patch : null;
        if (!agentName || !patch || Object.keys(patch).length === 0) {
          return { ok: false, resultsText: 'agent_name and a non-empty patch are required.' } as any;
        }
        // Appearance lives on the invoking user's profile — each user's
        // agents customize independently. Fetch current, merge, write.
        const { data: profile, error: readErr } = await supabase
          .from('profiles').select('agent_appearance').eq('id', context.userId).maybeSingle();
        if (readErr) return { ok: false, resultsText: `Profile read failed: ${readErr.message}` } as any;
        const appearances = ((profile?.agent_appearance as any) || {}) as Record<string, any>;
        const existingForAgent = (appearances[agentName] && typeof appearances[agentName] === 'object') ? appearances[agentName] : {};
        const nextForAgent = { ...existingForAgent, ...patch };
        const nextAppearances = { ...appearances, [agentName]: nextForAgent };
        const { error: writeErr } = await supabase
          .from('profiles').update({ agent_appearance: nextAppearances }).eq('id', context.userId);
        if (writeErr) return { ok: false, resultsText: `Appearance update failed: ${writeErr.message}` } as any;
        return {
          ok: true,
          resultsText: `Updated ${agentName}'s appearance: ${Object.keys(patch).join(', ')}.`,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'agent.rename': {
      try {
        const a = args as any;
        const agentId = typeof a.agent_id === 'string' ? a.agent_id.trim() : '';
        const newName = typeof a.new_name === 'string' ? a.new_name.trim() : '';
        if (!agentId || !newName || newName.length > 32 || newName.includes('/')) {
          return { ok: false, resultsText: 'agent_id + new_name (1–32 chars, no slashes) are required.' } as any;
        }
        const { error } = await supabase
          .from('circle_office_agents')
          .update({ name: newName, updated_at: new Date().toISOString() })
          .eq('id', agentId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Rename failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Renamed agent to "${newName}".` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.rename': {
      try {
        const a = args as any;
        const roomId = typeof a.room_id === 'string' ? a.room_id.trim() : '';
        const name   = typeof a.name    === 'string' ? a.name.trim()    : '';
        if (!roomId || !name) return { ok: false, resultsText: 'room_id and name are required.' } as any;
        const { error } = await supabase
          .from('project_rooms')
          .update({ name, updated_at: new Date().toISOString() })
          .eq('id', roomId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Rename failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Renamed room to "${name}".` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'rooms.archive':
    case 'rooms.unarchive': {
      try {
        const a = args as any;
        const roomId = typeof a.room_id === 'string' ? a.room_id.trim() : '';
        if (!roomId) return { ok: false, resultsText: 'room_id is required.' } as any;
        const isActive = tool === 'rooms.unarchive';
        const { error } = await supabase
          .from('project_rooms')
          .update({ is_active: isActive, updated_at: new Date().toISOString() })
          .eq('id', roomId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Update failed: ${error.message}` } as any;
        return { ok: true, resultsText: isActive ? 'Unarchived room.' : 'Archived room.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.create': {
      try {
        const { createMission } = await import('./missions');
        const a = args as any;
        const title = typeof a.title === 'string' ? a.title.trim() : '';
        if (!title) return { ok: false, resultsText: 'Mission title is required.' } as any;
        const { mission, error } = await createMission(
          context.circleId,
          context.userId,
          title,
          typeof a.description === 'string' ? a.description : undefined,
          typeof a.deadline === 'string' ? a.deadline : undefined,
        );
        if (error || !mission) return { ok: false, resultsText: `Mission create failed: ${error || 'unknown'}` } as any;
        return { ok: true, resultsText: `Created mission "${title}" (id: ${mission.id.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.assign_agent': {
      try {
        const { assignAgent } = await import('./missions');
        const a = args as any;
        const missionId = typeof a.mission_id === 'string' ? a.mission_id.trim() : '';
        const agentName = typeof a.agent_name === 'string' ? a.agent_name.trim() : '';
        if (!missionId || !agentName) return { ok: false, resultsText: 'mission_id and agent_name are required.' } as any;
        const role = typeof a.role === 'string' ? a.role : 'executor';
        const { error } = await assignAgent(missionId, agentName, role as any);
        if (error) return { ok: false, resultsText: `Assign failed: ${error}` } as any;
        return { ok: true, resultsText: `Assigned ${agentName} to mission (${role}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.unassign_agent': {
      try {
        const { unassignAgent } = await import('./missions');
        const a = args as any;
        const missionId = typeof a.mission_id === 'string' ? a.mission_id.trim() : '';
        const agentName = typeof a.agent_name === 'string' ? a.agent_name.trim() : '';
        if (!missionId || !agentName) return { ok: false, resultsText: 'mission_id and agent_name are required.' } as any;
        const { error } = await unassignAgent(missionId, agentName);
        if (error) return { ok: false, resultsText: `Unassign failed: ${error}` } as any;
        return { ok: true, resultsText: `Removed ${agentName} from mission.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.update_status': {
      try {
        const { updateMission } = await import('./missions');
        const a = args as any;
        const missionId = typeof a.mission_id === 'string' ? a.mission_id.trim() : '';
        if (!missionId) return { ok: false, resultsText: 'mission_id is required.' } as any;
        const patch: Record<string, any> = {};
        const touched: string[] = [];
        if (typeof a.status === 'string') {
          const s = a.status.trim();
          if (!['active', 'completed', 'paused', 'cancelled'].includes(s)) {
            return { ok: false, resultsText: 'status must be active | completed | paused | cancelled.' } as any;
          }
          patch.status = s; touched.push('status');
        }
        if (typeof a.title === 'string' && a.title.trim()) { patch.title = a.title.trim(); touched.push('title'); }
        if (typeof a.description === 'string')             { patch.description = a.description; touched.push('description'); }
        if (typeof a.deadline === 'string') {
          patch.deadline = a.deadline.trim() === '' ? null : a.deadline.trim();
          touched.push('deadline');
        }
        if (touched.length === 0) {
          return { ok: false, resultsText: 'Pass at least one of status / title / description / deadline.' } as any;
        }
        const { error } = await updateMission(missionId, patch);
        if (error) return { ok: false, resultsText: `Mission update failed: ${error}` } as any;
        return { ok: true, resultsText: `Updated mission: ${touched.join(', ')}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'circle.toggle_public': {
      try {
        const a = args as any;
        if (typeof a.is_public !== 'boolean') {
          return { ok: false, resultsText: 'is_public must be a boolean (true or false).' } as any;
        }
        const { error } = await supabase
          .from('circles').update({ is_public: a.is_public }).eq('id', context.circleId);
        if (error) return { ok: false, resultsText: `Toggle failed: ${error.message}` } as any;
        return { ok: true, resultsText: a.is_public ? 'Circle is now public (visible in /discover).' : 'Circle is now private.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'check_ins.log': {
      try {
        const a = args as any;
        const content = typeof a.content === 'string' ? a.content.trim() : '';
        if (!content) return { ok: false, resultsText: 'content is required.' } as any;
        const row: Record<string, any> = {
          circle_id: context.circleId,
          user_id:   context.userId,
          content,
          created_at: new Date().toISOString(),
        };
        if (a.metric && typeof a.metric === 'object') row.metric = a.metric;
        const { error, data } = await supabase.from('check_ins').insert(row).select('id').single();
        if (error) return { ok: false, resultsText: `Check-in failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Logged check-in (id: ${(data?.id as string || '').slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'automations.list': {
      try {
        const { data, error } = await supabase
          .from('circle_automations')
          .select('id, name, trigger_type, schedule, enabled, last_run_at, last_error')
          .eq('circle_id', context.circleId)
          .order('enabled', { ascending: false })
          .order('last_run_at', { ascending: false, nullsFirst: false })
          .limit(30);
        if (error) return { ok: false, resultsText: `List failed: ${error.message}` } as any;
        if (!data || data.length === 0) return { ok: true, resultsText: 'No automations configured.' } as any;
        const lines = (data as any[]).map((a) => {
          const flag = a.enabled ? '●' : '○';
          const err  = a.last_error ? ` — ERR: ${String(a.last_error).slice(0, 60)}` : '';
          const last = a.last_run_at ? ` — last: ${a.last_run_at}` : '';
          return `${flag} ${a.name} [${a.trigger_type}${a.schedule ? ` · ${a.schedule}` : ''}]${last}${err} — id: ${String(a.id).slice(0, 8)}`;
        });
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'automations.toggle_enabled': {
      try {
        const a = args as any;
        const automationId = typeof a.automation_id === 'string' ? a.automation_id.trim() : '';
        if (!automationId || typeof a.enabled !== 'boolean') {
          return { ok: false, resultsText: 'automation_id + enabled (boolean) are required.' } as any;
        }
        const { error } = await supabase
          .from('circle_automations')
          .update({ enabled: a.enabled })
          .eq('id', automationId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Toggle failed: ${error.message}` } as any;
        return { ok: true, resultsText: a.enabled ? 'Automation resumed.' : 'Automation paused.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.remove_task': {
      try {
        const a = args as any;
        const taskId = typeof a.task_id === 'string' ? a.task_id.trim() : '';
        if (!taskId) return { ok: false, resultsText: 'task_id is required.' } as any;
        const { error } = await supabase.from('mission_tasks').delete().eq('id', taskId);
        if (error) return { ok: false, resultsText: `Remove failed: ${error.message}` } as any;
        return { ok: true, resultsText: 'Removed mission task.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'missions.update_task': {
      try {
        const a = args as any;
        const taskId = typeof a.task_id === 'string' ? a.task_id.trim() : '';
        if (!taskId) return { ok: false, resultsText: 'task_id is required.' } as any;
        const patch: Record<string, any> = {};
        const touched: string[] = [];
        if (typeof a.title === 'string' && a.title.trim())        { patch.title = a.title.trim();             touched.push('title'); }
        if (typeof a.description === 'string')                    { patch.description = a.description;        touched.push('description'); }
        if (typeof a.priority === 'string' && a.priority.trim())  { patch.priority = a.priority.trim();       touched.push('priority'); }
        if (typeof a.due_date === 'string')                       { patch.due_date = a.due_date.trim() || null; touched.push('due_date'); }
        if (typeof a.assigned_to === 'string')                    { patch.assigned_to = a.assigned_to.trim() || null; touched.push('assigned_to'); }
        if (typeof a.status === 'string' && a.status.trim()) {
          const s = a.status.trim();
          if (!['pending', 'running', 'done', 'blocked', 'cancelled'].includes(s)) {
            return { ok: false, resultsText: 'status must be pending | running | done | blocked | cancelled.' } as any;
          }
          patch.status = s;
          touched.push('status');
        }
        if (touched.length === 0) return { ok: false, resultsText: 'Pass at least one field to update.' } as any;
        const { error } = await supabase.from('mission_tasks').update(patch).eq('id', taskId);
        if (error) return { ok: false, resultsText: `Update failed: ${error.message}` } as any;
        return { ok: true, resultsText: `Updated mission task: ${touched.join(', ')}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'agent.set_spirit': {
      try {
        const a = args as any;
        const agentId = typeof a.agent_id === 'string' ? a.agent_id.trim() : '';
        if (!agentId || typeof a.spirit !== 'string') {
          return { ok: false, resultsText: 'agent_id and spirit are required.' } as any;
        }
        const spirit = a.spirit.trim();
        const { error } = await supabase
          .from('circle_office_agents')
          .update({ spirit: spirit || null, updated_at: new Date().toISOString() })
          .eq('id', agentId)
          .eq('circle_id', context.circleId);
        if (error) return { ok: false, resultsText: `Set spirit failed: ${error.message}` } as any;
        return { ok: true, resultsText: spirit ? `Agent spirit set to "${spirit}".` : 'Agent spirit cleared.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'memory.pin':
    case 'memory.unpin': {
      try {
        const { pinMemory, unpinMemory } = await import('./memoryActions');
        const a = args as any;
        const memoryId = typeof a.memory_id === 'string' ? a.memory_id.trim() : '';
        if (!memoryId) return { ok: false, resultsText: 'memory_id is required.' } as any;
        const ok = tool === 'memory.pin' ? await pinMemory(memoryId) : await unpinMemory(memoryId);
        if (!ok) return { ok: false, resultsText: `Memory ${tool === 'memory.pin' ? 'pin' : 'unpin'} failed.` } as any;
        return { ok: true, resultsText: tool === 'memory.pin' ? 'Pinned memory.' : 'Unpinned memory.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'memory.forget': {
      try {
        const { softDeleteMemory } = await import('./memoryActions');
        const a = args as any;
        const memoryId = typeof a.memory_id === 'string' ? a.memory_id.trim() : '';
        if (!memoryId) return { ok: false, resultsText: 'memory_id is required.' } as any;
        const ok = await softDeleteMemory(memoryId, context.userId, 'agent_tool_forget');
        if (!ok) return { ok: false, resultsText: 'Forget failed.' } as any;
        return { ok: true, resultsText: 'Memory marked as forgotten (soft-deleted; recoverable).' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'approvals.list': {
      try {
        const { getPendingApprovals } = await import('./agentRunSystem');
        const approvals = await getPendingApprovals(context.circleId);
        if (approvals.length === 0) return { ok: true, resultsText: 'No pending approvals.' } as any;
        const lines = approvals.slice(0, 20).map((approval) => `- ${approval.title} [${approval.approval_kind}] — id: ${approval.id.slice(0, 8)} — status: ${approval.status}`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'approvals.request': {
      try {
        const { requestRunApproval } = await import('./agentRunSystem');
        const a = args as any;
        const approval = await requestRunApproval({
          runId: a.runId,
          circleId: context.circleId,
          approvalKind: a.approvalKind,
          title: a.title,
          description: a.description,
          requestedBy: context.userId,
          payload: a.payload || {},
          timeoutSeconds: typeof a.timeoutSeconds === 'number' ? a.timeoutSeconds : undefined,
        });
        if (!approval) return { ok: false, resultsText: 'Failed to request approval.' } as any;
        return { ok: true, resultsText: `Requested approval "${approval.title}" (id: ${approval.id.slice(0, 8)}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'approvals.resolve': {
      try {
        const { resolveRunApproval } = await import('./agentRunSystem');
        const ok = await resolveRunApproval((args as any).approvalId, (args as any).status, context.userId);
        if (!ok) return { ok: false, resultsText: 'Failed to resolve approval.' } as any;
        return { ok: true, resultsText: `Approval ${String((args as any).approvalId).slice(0, 8)} marked ${(args as any).status}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Desktop automation (Claude Code bridge) ─────────────────────────
    case 'desktop.launch_app': {
      try {
        const { launchApp, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline. Start it with `node scripts/claude-bridge.js` and pair once from the UC app.' } as any;
        }
        const r = await launchApp(String((args as any).appName || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Launched ${(r.data?.appName) || 'app'}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.focus_app': {
      try {
        const { focusApp, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await focusApp(String((args as any).appName || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Focused ${(r.data?.appName) || 'app'}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.type_text': {
      try {
        const { typeText, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await typeText(String((args as any).text || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Typed ${r.data?.chars ?? 0} chars into focused app.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.paste_text': {
      try {
        const { pasteText, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const a = args as any;
        const r = await pasteText(String(a.text || ''), {
          appName: a.appName ? String(a.appName) : undefined,
          restoreClipboard: a.restoreClipboard !== false,
        });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Pasted ${r.data?.chars ?? 0} chars${r.data?.appName ? ` into ${r.data.appName}` : ''}${r.data?.restoredClipboard ? ' and restored the previous clipboard.' : '.'}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.press_keys': {
      try {
        const { pressKeys, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await pressKeys(String((args as any).combo || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Pressed ${r.data?.combo || ''}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.menu_click': {
      try {
        const { clickMenu, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const a = args as any;
        const r = await clickMenu({
          appName: a.appName ? String(a.appName) : undefined,
          menuPath: Array.isArray(a.menuPath) ? a.menuPath.map(String) : [],
        });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Clicked menu ${(r.data?.menuPath || []).join(' > ')}${r.data?.appName ? ` in ${r.data.appName}` : ''}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.list_running_apps': {
      try {
        const { listRunningApps, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await listRunningApps();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const apps = r.data || [];
        return { ok: true, resultsText: apps.length ? `Running apps (${apps.length}): ${apps.join(', ')}` : 'No foreground apps reported.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.list_browser_tabs': {
      try {
        const { listBrowserTabs, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await listBrowserTabs(Array.isArray((args as any).browsers) ? (args as any).browsers : undefined);
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const tabs = r.data?.tabs || [];
        const tabLines = tabs.slice(0, 40).map((tab, index) => `${index + 1}. [${tab.browser}] ${tab.title || '(untitled)'} — ${tab.url}`);
        const errors = r.data?.errors?.length ? `\nWarnings: ${r.data.errors.slice(0, 5).join('; ')}` : '';
        return { ok: true, resultsText: tabs.length ? `Open browser tabs (${tabs.length}):\n${tabLines.join('\n')}${tabs.length > 40 ? '\n...truncated' : ''}${errors}` : `No browser tabs reported.${errors}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.window_state': {
      try {
        const { getWindowState, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await getWindowState();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const state = r.data;
        const bounds = state?.activeWindowBounds ? ` (${state.activeWindowBounds.width}x${state.activeWindowBounds.height} at ${state.activeWindowBounds.x},${state.activeWindowBounds.y})` : '';
        const windows = state?.windows?.length ? `\nWindows: ${state.windows.slice(0, 20).join(', ')}` : '';
        return { ok: true, resultsText: `Frontmost app: ${state?.frontmostApp || 'unknown'}\nActive window: ${state?.activeWindowTitle || '(untitled)'}${bounds}${windows}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.clipboard': {
      try {
        const { readClipboard, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await readClipboard();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const text = (r.data?.text || '').slice(0, 4000);
        return { ok: true, resultsText: text ? `Clipboard (${r.data?.chars || text.length} chars):\n${text}${r.data?.truncated ? '\n...truncated' : ''}` : 'Clipboard is empty or contains no text.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.clipboard_write': {
      try {
        const { writeClipboard, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await writeClipboard(String((args as any).text || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Copied ${r.data?.chars ?? 0} chars to clipboard.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.clipboard_clear': {
      try {
        const { clearClipboard, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await clearClipboard();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: 'Clipboard cleared.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.file_list': {
      try {
        const { listFiles, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await listFiles(String((args as any).path || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const entries = r.data?.entries || [];
        const lines = entries.slice(0, 60).map((entry) => `${entry.kind === 'directory' ? 'dir ' : 'file'} ${entry.name}${typeof entry.size === 'number' ? ` (${entry.size} bytes)` : ''}`);
        return { ok: true, resultsText: `Files in ${r.data?.path || ''} (${entries.length}):\n${lines.join('\n')}${r.data?.truncated ? '\n...truncated' : ''}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.file_read': {
      try {
        const { readFile, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await readFile(String((args as any).path || ''), typeof (args as any).maxBytes === 'number' ? (args as any).maxBytes : undefined);
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `File: ${r.data?.path}\nSize: ${r.data?.size} bytes${r.data?.truncated ? ' (preview truncated)' : ''}\n\n${r.data?.content || ''}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.file_search': {
      try {
        const { searchFiles, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const roots = Array.isArray((args as any).rootPaths) && (args as any).rootPaths.length > 0
          ? (args as any).rootPaths.map(String)
          : [String((args as any).rootPath || '~')];
        const allMatches: string[] = [];
        let totalVisited = 0;
        let totalContent = 0;
        let truncated = false;
        let query = String((args as any).query || '');
        for (const root of roots.slice(0, 6)) {
          const r = await searchFiles(root, query, {
            maxResults: typeof (args as any).maxResults === 'number' ? (args as any).maxResults : undefined,
            maxFiles: typeof (args as any).maxFiles === 'number' ? (args as any).maxFiles : undefined,
            maxDepth: typeof (args as any).maxDepth === 'number' ? (args as any).maxDepth : undefined,
            includeContent: typeof (args as any).includeContent === 'boolean' ? (args as any).includeContent : undefined,
            extensions: Array.isArray((args as any).extensions) ? (args as any).extensions.map(String) : undefined,
          });
          if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
          query = r.data?.query || query;
          totalVisited += r.data?.visited || 0;
          totalContent += r.data?.searchedContent || 0;
          truncated = truncated || Boolean(r.data?.truncated);
          (r.data?.matches || []).forEach((match) => {
            allMatches.push(`${match.path}${match.snippet ? ` — ${match.snippet}` : ''}`);
          });
        }
        const lines = allMatches.slice(0, 60).map((line, index) => `${index + 1}. ${line}`);
	        return { ok: true, resultsText: allMatches.length ? `File search matches (${allMatches.length}, visited ${totalVisited}, content files ${totalContent}):\n${lines.join('\n')}${truncated ? '\n...truncated' : ''}` : `No file matches for "${query}" under ${roots.join(', ')}.` } as any;
	      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
	    }
	    case 'desktop.file_stat': {
	      try {
		        const { statFile, isDesktopBridgeAvailable } = await import('./desktopBridge');
		        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
		        const filePath = String((args as any).path || '');
		        const r = await statFile(filePath);
	        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
	        if (!r.data?.exists) return { ok: true, ...(r.data || {}), resultsText: `Path does not exist: ${r.data?.path || filePath}` } as any;
	        return {
	          ok: true,
	          ...r.data,
	          resultsText: `Path: ${r.data.path}\nKind: ${r.data.kind || 'unknown'}\nSize: ${r.data.size ?? 'unknown'} bytes\nModified: ${r.data.modifiedAt || 'unknown'}\nCreated: ${r.data.createdAt || 'unknown'}`,
	        } as any;
	      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
	    }
	    case 'desktop.file_rename': {
	      try {
		        const { renameFile, isDesktopBridgeAvailable } = await import('./desktopBridge');
		        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
		        const fromPath = String((args as any).fromPath || '');
		        const toPath = String((args as any).toPath || '');
		        const r = await renameFile(fromPath, toPath, { overwrite: Boolean((args as any).overwrite) });
	        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
	        return { ok: true, resultsText: `Renamed ${r.data?.fromPath || fromPath} to ${r.data?.toPath || toPath}.` } as any;
	      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
	    }
	    case 'desktop.file_write_text': {
	      try {
		        const { writeTextFile, isDesktopBridgeAvailable } = await import('./desktopBridge');
		        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
		        const filePath = String((args as any).path || '');
		        const content = String((args as any).content ?? '');
		        const r = await writeTextFile(filePath, content, {
	          append: Boolean((args as any).append),
	          overwrite: Boolean((args as any).overwrite),
	        });
	        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
	        return { ok: true, resultsText: `${r.data?.append ? 'Appended' : 'Wrote'} ${r.data?.bytes || 0} bytes to ${r.data?.path || filePath}.` } as any;
	      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
	    }
	    case 'desktop.file_copy': {
	      try {
		        const { copyFile, isDesktopBridgeAvailable } = await import('./desktopBridge');
		        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
		        const fromPath = String((args as any).fromPath || '');
		        const toPath = String((args as any).toPath || '');
		        const r = await copyFile(fromPath, toPath, { overwrite: Boolean((args as any).overwrite) });
	        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
	        return { ok: true, resultsText: `Copied ${r.data?.fromPath || fromPath} to ${r.data?.toPath || toPath}.` } as any;
	      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
	    }
	    case 'desktop.file_trash': {
	      try {
		        const { trashFile, isDesktopBridgeAvailable } = await import('./desktopBridge');
		        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
		        const filePath = String((args as any).path || '');
		        const r = await trashFile(filePath);
	        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
	        return { ok: true, resultsText: `Moved ${r.data?.path || filePath} to Trash${r.data?.trashPath ? ` at ${r.data.trashPath}` : ''}.` } as any;
	      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
	    }
	    case 'desktop.file_mkdir': {
	      try {
		        const { createDirectory, isDesktopBridgeAvailable } = await import('./desktopBridge');
		        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
		        const dirPath = String((args as any).path || '');
		        const r = await createDirectory(dirPath, { recursive: (args as any).recursive !== false });
	        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
	        return { ok: true, resultsText: `${r.data?.existed ? 'Folder already exists' : 'Created folder'}: ${r.data?.path || dirPath}.` } as any;
	      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
	    }
	    case 'desktop.shortcuts_list': {
      try {
        const { listShortcuts, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await listShortcuts();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const shortcuts = r.data || [];
        return { ok: true, resultsText: shortcuts.length ? `Apple Shortcuts (${shortcuts.length}): ${shortcuts.slice(0, 80).join(', ')}` : 'No Apple Shortcuts reported.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.shortcuts_run': {
      try {
        const { runShortcut, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await runShortcut(String((args as any).name || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Ran shortcut "${r.data?.name || ''}".${r.data?.output ? `\n${r.data.output}` : ''}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.window_manage': {
      try {
        const { manageWindow, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await manageWindow({ action: a.action, appName: a.appName, width: a.width, height: a.height });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Window action "${r.data?.action || a.action}" completed${r.data?.appName ? ` for ${r.data.appName}` : ''}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.mouse_move': {
      try {
        const { mouseMove, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await mouseMove(Number(a.x), Number(a.y));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Moved mouse to (${r.data?.x}, ${r.data?.y}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.mouse_click': {
      try {
        const { mouseClick, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await mouseClick({ x: Number(a.x), y: Number(a.y), button: a.button === 'right' ? 'right' : 'left', count: typeof a.count === 'number' ? a.count : undefined });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `${r.data?.button || 'left'} click x${r.data?.count || 1} at (${r.data?.x}, ${r.data?.y}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.mouse_down': {
      try {
        const { mouseDown, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await mouseDown({ x: Number(a.x), y: Number(a.y), button: a.button === 'right' ? 'right' : 'left' });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Held ${r.data?.button || 'left'} mouse down at (${r.data?.x}, ${r.data?.y}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.mouse_up': {
      try {
        const { mouseUp, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const hasCoords = typeof a.x === 'number' && typeof a.y === 'number';
        const r = await mouseUp({
          x: hasCoords ? Number(a.x) : undefined,
          y: hasCoords ? Number(a.y) : undefined,
          button: a.button === 'right' ? 'right' : 'left',
        });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Released ${r.data?.button || 'left'} mouse${r.data?.x != null && r.data?.y != null ? ` at (${r.data.x}, ${r.data.y})` : ''}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.mouse_drag': {
      try {
        const { mouseDrag, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await mouseDrag({ fromX: Number(a.fromX), fromY: Number(a.fromY), toX: Number(a.toX), toY: Number(a.toY), durationMs: typeof a.durationMs === 'number' ? a.durationMs : undefined });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Dragged mouse from (${r.data?.fromX}, ${r.data?.fromY}) to (${r.data?.toX}, ${r.data?.toY}) over ${r.data?.durationMs || 0}ms.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.mouse_scroll': {
      try {
        const { mouseScroll, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const r = await mouseScroll(args as any);
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Scrolled mouse deltaX=${r.data?.deltaX ?? 0}, deltaY=${r.data?.deltaY ?? 0}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.wait_for_app': {
      try {
        const { waitForApp, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const a = args as any;
        const r = await waitForApp(String(a.appName || ''), typeof a.timeoutMs === 'number' ? a.timeoutMs : undefined);
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `App ${r.data?.appName} ready (${r.data?.elapsedMs ?? 0}ms).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.screenshot': {
      try {
        const { takeScreenshot, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await takeScreenshot();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return {
          ok: true,
          resultsText: `Captured screenshot (${Math.round((r.data?.sizeBytes ?? 0) / 1024)} KB PNG). base64 length: ${(r.data?.base64 || '').length} chars.`,
          base64: r.data?.base64,
          mimeType: r.data?.mimeType,
          sizeBytes: r.data?.sizeBytes,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.open_url': {
      try {
        const { openUrl, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await openUrl(String((args as any).url || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Opened ${r.data?.url} (${r.data?.scheme}).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.open_path': {
      try {
        const { openPath, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await openPath(String((args as any).path || ''));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Opened ${r.data?.path}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.click_at': {
      try {
        const { clickAt, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const a = args as any;
        const r = await clickAt(Number(a.x), Number(a.y));
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Clicked at (${r.data?.x}, ${r.data?.y}) via ${r.data?.via}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.screen_size': {
      try {
        const { getScreenSize, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) {
          return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        }
        const r = await getScreenSize();
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Screen size: ${r.data?.width} × ${r.data?.height}.`, width: r.data?.width, height: r.data?.height } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_document_status': {
      try {
        const { indesignDocumentStatus, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await indesignDocumentStatus({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
        if (!d.appRunning) return { ok: true, resultsText: `${d.appName || 'InDesign'} is not running.` } as any;
        if (!d.activeDocumentName) return { ok: true, resultsText: `${d.appName || 'InDesign'} is running with no active document.` } as any;
        const issueCount = d.missingLinks + d.modifiedLinks + d.missingFonts;
        const issueText = issueCount > 0
          ? `Issues: ${d.missingLinks} missing links, ${d.modifiedLinks} modified links, ${d.missingFonts} missing fonts.`
          : 'No missing fonts or link issues detected.';
	        return {
	          ok: true,
	          ...d,
	          resultsText: `InDesign document status for ${d.activeDocumentName}: ${d.pageCount} pages, ${d.spreadCount} spreads, ${d.layerCount} layers, ${d.linkCount} links, ${d.fontCount} fonts. ${issueText} Locked layers: ${d.lockedLayers}. Hidden layers: ${d.hiddenLayers}.`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_text_inventory': {
      try {
        const { indesignTextInventory, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await indesignTextInventory({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          query: typeof a.query === 'string' ? a.query : undefined,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
          maxItems: Number.isFinite(Number(a.maxItems)) ? Number(a.maxItems) : 30,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
        if (!d.appRunning) return { ok: true, resultsText: `${d.appName || 'InDesign'} is not running.` } as any;
        if (!d.documentName) return { ok: true, resultsText: `${d.appName || 'InDesign'} is running with no active document.` } as any;
        const candidates = d.frames.slice(0, 8).map((frame, index) => {
          const target = [frame.layerName, frame.itemName, frame.label].filter(Boolean).join(' / ') || 'unnamed frame';
          const flags = [frame.overflows ? 'overset' : '', frame.locked ? 'locked' : '', frame.visible ? '' : 'hidden'].filter(Boolean);
          const matchText = d.query && frame.matchCount > 0 ? ` [${frame.matchCount} match${frame.matchCount === 1 ? '' : 'es'}]` : '';
          return `${index + 1}. ${target}${flags.length ? ` (${flags.join(', ')})` : ''}${matchText}${frame.contentPreview ? `: ${frame.contentPreview}` : ''}`;
        });
        const matchText = d.query ? `, ${d.queryMatches} text occurrence${d.queryMatches === 1 ? '' : 's'}` : '';
	        return {
	          ok: true,
	          ...d,
	          resultsText: `InDesign text inventory for ${d.documentName}${d.query ? ` matching ${d.query}` : ''}: ${d.textFrameCount} text frames, ${d.matchedFrames} matching frames${matchText}, ${d.oversetFrames} overset. ${candidates.length ? `Candidates:\n${candidates.join('\n')}` : 'No candidates returned.'}`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_set_layer_state': {
      try {
        const { indesignSetLayerState, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const layerName = typeof a.layerName === 'string'
          ? a.layerName.trim()
          : typeof a.targetLayerName === 'string'
            ? a.targetLayerName.trim()
            : '';
        const action = String(a.action || '').toLowerCase();
        if (!layerName) return { ok: false, resultsText: 'layerName is required.' } as any;
        if (!['show', 'hide', 'lock', 'unlock'].includes(action)) return { ok: false, resultsText: 'action must be show, hide, lock, or unlock.' } as any;
        const r = await indesignSetLayerState({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          layerName,
          action: action as 'show' | 'hide' | 'lock' | 'unlock',
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
        if (d.error || d.matchedLayers !== 1) {
          const matchText = d.matchedLayers > 1 ? `${d.matchedLayers} layers matched; provide an exact layer name.` : d.error || 'No matching layer was changed.';
          return {
            ok: false,
            ...d,
            resultsText: `InDesign layer-state update failed for ${layerName}: ${matchText}`,
          } as any;
        }
        const already = d.changedLayers < 1;
        const stateText = action === 'show' || action === 'hide'
          ? `visible=${d.afterVisible}`
          : `locked=${d.afterLocked}`;
        return {
          ok: true,
          ...d,
          resultsText: `Set InDesign layer ${d.layerName} to ${action}${d.documentName ? ` in ${d.documentName}` : ''} (${stateText}). ${already ? 'It was already in that state.' : 'Layer state changed.'}`,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_batch_find_change': {
      try {
        const { indesignBatchFindChange, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const pairs = Array.isArray(a.pairs)
          ? a.pairs.slice(0, 20).map((pair: any) => ({
              findText: String(pair?.findText ?? pair?.find ?? '').trim(),
              changeText: String(pair?.changeText ?? pair?.replaceWith ?? pair?.replacement ?? ''),
            })).filter((pair: { findText: string }) => pair.findText)
          : [];
        if (pairs.length < 1) return { ok: false, resultsText: 'At least one InDesign Find/Change pair is required.' } as any;
        const r = await indesignBatchFindChange({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          pairs,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
        const rows = d.results.slice(0, 12).map((item, index) => {
          const status = item.changed > 0
            ? `changed ${item.changed}`
            : item.remaining < 1 && item.replacementMatches > 0
              ? 'already applied'
              : item.matched > 0
                ? 'matched but not changed'
                : 'not found';
          const remaining = item.remaining > 0 ? `, ${item.remaining} source match${item.remaining === 1 ? '' : 'es'} remaining` : '';
          return `${index + 1}. ${item.findText} -> ${item.changeText}: ${status}${remaining}`;
        });
        const failures = d.results.filter((item) => item.changed < 1 && !(item.remaining < 1 && item.replacementMatches > 0));
        const recovery = d.unlockedCount > 0 ? ` Lock-safe recovery temporarily unlocked ${d.unlockedCount} item${d.unlockedCount === 1 ? '' : 's'}.` : '';
	        return {
	          ok: failures.length === 0,
	          ...d,
	          resultsText: `Batch InDesign Find/Change${d.documentName ? ` for ${d.documentName}` : ''}: ${d.changed} total changed across ${d.results.length} replacement${d.results.length === 1 ? '' : 's'}.${recovery}${rows.length ? `\n${rows.join('\n')}` : ''}`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_batch_update_text_layers': {
      try {
        const { indesignBatchUpdateTextLayers, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const updates = Array.isArray(a.updates)
          ? a.updates.slice(0, 12).map((update: any) => ({
              fieldName: String(update?.fieldName ?? update?.field ?? update?.targetLabel ?? '').trim(),
              replacementText: String(update?.replacementText ?? update?.text ?? update?.value ?? ''),
            })).filter((update: { fieldName: string }) => update.fieldName)
          : [];
        if (updates.length < 1) return { ok: false, resultsText: 'At least one InDesign text-layer update is required.' } as any;
        const r = await indesignBatchUpdateTextLayers({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          updates,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
        const rows = d.results.slice(0, 12).map((item, index) => {
          const status = item.updatedFrames > 0
            ? `updated ${item.updatedFrames}`
            : item.replacementMatches > 0
              ? 'already applied'
              : item.matchedFrames > 0
                ? 'matched but not updated'
                : 'not found';
          const layerText = item.layerNames.length > 0 ? ` on ${item.layerNames.join(', ')}` : '';
          const errorText = item.error ? ` (${item.error})` : '';
          return `${index + 1}. ${item.fieldName}: ${status}${layerText}${errorText}`;
        });
        const failures = d.results.filter((item) => item.matchedFrames < 1 || (item.updatedFrames < 1 && item.replacementMatches < 1));
        const recovery = d.unlockedCount > 0 ? ` Lock-safe recovery temporarily unlocked ${d.unlockedCount} item${d.unlockedCount === 1 ? '' : 's'}.` : '';
	        return {
	          ok: failures.length === 0,
	          ...d,
	          resultsText: `Batch InDesign text-layer update${d.documentName ? ` for ${d.documentName}` : ''}: ${d.updatedFrames} total updated frame${d.updatedFrames === 1 ? '' : 's'} across ${d.results.length} field${d.results.length === 1 ? '' : 's'}.${recovery}${rows.length ? `\n${rows.join('\n')}` : ''}`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_update_text_layer': {
      try {
        const { indesignUpdateTextLayer, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const fieldName = typeof a.fieldName === 'string' ? a.fieldName.trim() : '';
        const replacementText = typeof a.replacementText === 'string' ? a.replacementText : '';
        if (!fieldName) return { ok: false, resultsText: 'fieldName is required.' } as any;
        const r = await indesignUpdateTextLayer({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          fieldName,
          replacementText,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
	        if (d.updatedFrames < 1) {
	          return {
	            ok: false,
	            ...d,
	            resultsText: `No editable InDesign text frame matched ${fieldName}. Checked ${d.matchedLayers} matching layers and ${d.matchedFrames} text frames.${d.error ? ` ${d.error}` : ''}`,
	          } as any;
	        }
        const layerText = d.layerNames.length > 0 ? ` on ${d.layerNames.join(', ')}` : '';
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Updated ${d.updatedFrames} InDesign text frame${d.updatedFrames === 1 ? '' : 's'} for ${fieldName}${layerText}${d.documentName ? ` in ${d.documentName}` : ''}.`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_export_proof': {
      try {
        const { indesignExportProof, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const outputPath = typeof a.outputPath === 'string' ? a.outputPath.trim() : '';
        if (!outputPath) return { ok: false, resultsText: 'outputPath is required.' } as any;
        const r = await indesignExportProof({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          outputPath,
          format: 'pdf',
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
	        if (d.error || !d.fileExists) return { ok: false, ...d, resultsText: `InDesign proof export failed: ${d.error || 'output file was not created'}` } as any;
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Exported InDesign PDF proof for ${d.documentName || 'active document'} to ${d.outputPath} (${Math.round(d.sizeBytes / 1024)} KB, ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}).`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_relink_asset': {
      try {
        const { indesignRelinkAsset, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const assetPath = typeof a.assetPath === 'string' ? a.assetPath.trim() : '';
        if (!assetPath) return { ok: false, resultsText: 'assetPath is required.' } as any;
        const r = await indesignRelinkAsset({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          assetPath,
          linkQuery: typeof a.linkQuery === 'string' ? a.linkQuery : undefined,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
	        if (d.error || d.relinkedLinks < 1) return { ok: false, ...d, resultsText: `InDesign asset relink failed: ${d.error || 'no links were relinked'}` } as any;
	        const relinked = d.linkNames.length > 0 ? ` (${d.linkNames.join(', ')})` : '';
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Relinked ${d.relinkedLinks} InDesign asset${d.relinkedLinks === 1 ? '' : 's'}${relinked} in ${d.documentName || 'active document'} to ${d.assetPath}.`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.indesign_package_document': {
      try {
        const { indesignPackageDocument, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const outputFolderPath = typeof a.outputFolderPath === 'string' ? a.outputFolderPath.trim() : '';
        if (!outputFolderPath) return { ok: false, resultsText: 'outputFolderPath is required.' } as any;
        const r = await indesignPackageDocument({
          appName: typeof a.appName === 'string' ? a.appName : 'InDesign',
          outputFolderPath,
          includeIdml: a.includeIdml === true,
          includePdf: a.includePdf === true,
          copyFonts: a.copyFonts !== false,
          copyLinkedGraphics: a.copyLinkedGraphics !== false,
          copyProfiles: a.copyProfiles !== false,
          updateGraphics: a.updateGraphics !== false,
          includeHiddenLayers: a.includeHiddenLayers !== false,
          ignorePreflightErrors: a.ignorePreflightErrors === true,
          createReport: a.createReport !== false,
          forceSave: a.forceSave !== false,
          pdfStyle: typeof a.pdfStyle === 'string' ? a.pdfStyle : undefined,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
	        if (d.error || !d.packageOk) return { ok: false, ...d, resultsText: `InDesign package failed: ${d.error || 'packageForPrint returned false'}` } as any;
        const preflight: string[] = [];
        if (d.missingLinksBefore > 0) preflight.push(`${d.missingLinksBefore} missing link${d.missingLinksBefore === 1 ? '' : 's'}`);
        if (d.modifiedLinksBefore > 0) preflight.push(`${d.modifiedLinksBefore} modified link${d.modifiedLinksBefore === 1 ? '' : 's'}`);
        if (d.missingFontsBefore > 0) preflight.push(`${d.missingFontsBefore} missing font${d.missingFontsBefore === 1 ? '' : 's'}`);
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Packaged InDesign document ${d.documentName || 'active document'} to ${d.outputFolderPath} (${d.fileCount} files, ${Math.round(d.sizeBytes / 1024)} KB).${preflight.length > 0 ? ` Preflight before package: ${preflight.join(', ')}.` : ''}`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.photoshop_document_status': {
      try {
        const { photoshopDocumentStatus, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await photoshopDocumentStatus({
          appName: typeof a.appName === 'string' ? a.appName : 'Photoshop',
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
        if (!d.appRunning) return { ok: true, resultsText: `${d.appName || 'Photoshop'} is not running.` } as any;
        if (!d.activeDocumentName) return { ok: true, resultsText: `${d.appName || 'Photoshop'} is running with no active document.` } as any;
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Photoshop document status for ${d.activeDocumentName}: ${d.widthPx}x${d.heightPx}px, ${d.resolution || 0}ppi, mode ${d.mode || 'unknown'}, ${d.layerCount} layers (${d.groupCount} groups, ${d.textLayerCount} text, ${d.smartObjectCount} smart objects, ${d.adjustmentLayerCount} adjustments). Locked layers: ${d.lockedLayers}. Hidden layers: ${d.hiddenLayers}. Selection active: ${d.selectionActive ? 'yes' : 'no'}.`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.photoshop_layer_inventory': {
      try {
        const { photoshopLayerInventory, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await photoshopLayerInventory({
          appName: typeof a.appName === 'string' ? a.appName : 'Photoshop',
          query: typeof a.query === 'string' ? a.query : undefined,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
          maxItems: Number.isFinite(Number(a.maxItems)) ? Number(a.maxItems) : 40,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
        if (!d.appRunning) return { ok: true, resultsText: `${d.appName || 'Photoshop'} is not running.` } as any;
        if (!d.documentName) return { ok: true, resultsText: `${d.appName || 'Photoshop'} is running with no active document.` } as any;
        const rows = d.layers.slice(0, 10).map((layer, index) => {
          const flags = [
            layer.visible ? '' : 'hidden',
            layer.locked ? 'locked' : '',
            layer.hasMask ? 'mask' : '',
            layer.kind && /text/i.test(layer.kind) ? 'text' : '',
          ].filter(Boolean);
          const path = layer.path || layer.name || 'unnamed layer';
          const preview = layer.textPreview ? `: ${layer.textPreview}` : '';
          return `${index + 1}. ${path}${flags.length ? ` (${flags.join(', ')})` : ''}${preview}`;
        });
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Photoshop layer inventory for ${d.documentName}${d.query ? ` matching ${d.query}` : ''}: ${d.layerCount} layers, ${d.matchedLayers} matching, ${d.textLayerCount} text, ${d.smartObjectCount} smart objects, ${d.adjustmentLayerCount} adjustments, ${d.maskLayerCount} masks. Selection active: ${d.selectionActive ? 'yes' : 'no'}. ${rows.length ? `Candidates:\n${rows.join('\n')}` : 'No layer candidates returned.'}`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.photoshop_set_layer_state': {
      try {
        const { photoshopSetLayerState, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const layerName = typeof a.layerName === 'string' ? a.layerName.trim() : '';
        const action = typeof a.action === 'string' ? a.action.trim().toLowerCase() : '';
        if (!layerName) return { ok: false, resultsText: 'layerName is required.' } as any;
        if (!['show', 'hide', 'lock', 'unlock'].includes(action)) return { ok: false, resultsText: 'action must be show, hide, lock, or unlock.' } as any;
        const r = await photoshopSetLayerState({
          appName: typeof a.appName === 'string' ? a.appName : 'Photoshop',
          layerName,
          action: action as any,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
        if (!d.appRunning) return { ok: false, ...d, resultsText: `${d.appName || 'Photoshop'} is not running.` } as any;
        if (d.error || d.matchedLayers !== 1) {
          const matchHint = d.matchedLayers > 1
            ? `${d.matchedLayers} layers matched; provide an exact layer name or full group path.`
            : d.error || 'No matching layer was changed.';
          return { ok: false, ...d, resultsText: `Photoshop did not change layer ${layerName}: ${matchHint}` } as any;
        }
        const stateText = action === 'show' || action === 'hide'
          ? `visible=${d.afterVisible}`
          : `locked=${d.afterLocked}`;
        return {
          ok: true,
          ...d,
          resultsText: `${d.changedLayers > 0 ? 'Changed' : 'Confirmed'} Photoshop layer ${d.layerName || layerName}${d.documentName ? ` in ${d.documentName}` : ''} is ${action} (${stateText}).`,
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.photoshop_update_text_layer': {
      try {
        const { photoshopUpdateTextLayer, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const layerName = typeof a.layerName === 'string' ? a.layerName.trim() : '';
        const replacementText = typeof a.replacementText === 'string' ? a.replacementText : '';
        if (!layerName) return { ok: false, resultsText: 'layerName is required.' } as any;
        const r = await photoshopUpdateTextLayer({
          appName: typeof a.appName === 'string' ? a.appName : 'Photoshop',
          layerName,
          replacementText,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
	        if (d.updatedLayers < 1) {
	          return {
	            ok: false,
	            ...d,
	            resultsText: `No editable Photoshop text layer matched ${layerName}. Checked ${d.matchedLayers} matching text layer${d.matchedLayers === 1 ? '' : 's'}.${d.error ? ` ${d.error}` : ''}`,
	          } as any;
	        }
        const layerText = d.layerNames.length > 0 ? ` (${d.layerNames.join(', ')})` : '';
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Updated ${d.updatedLayers} Photoshop text layer${d.updatedLayers === 1 ? '' : 's'} for ${layerName}${layerText}${d.documentName ? ` in ${d.documentName}` : ''}.`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.photoshop_place_asset': {
      try {
        const { photoshopPlaceAsset, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const assetPath = typeof a.assetPath === 'string' ? a.assetPath.trim() : '';
        if (!assetPath) return { ok: false, resultsText: 'assetPath is required.' } as any;
        const r = await photoshopPlaceAsset({
          appName: typeof a.appName === 'string' ? a.appName : 'Photoshop',
          assetPath,
          layerName: typeof a.layerName === 'string' ? a.layerName : undefined,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
	        if (d.error) return { ok: false, ...d, resultsText: `Photoshop asset placement failed: ${d.error}` } as any;
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Placed asset ${d.assetPath} into ${d.documentName || 'Photoshop document'} as layer ${d.placedLayerName || d.layerName || 'new placed layer'}.`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.photoshop_export_proof': {
      try {
        const { photoshopExportProof, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const outputPath = typeof a.outputPath === 'string' ? a.outputPath.trim() : '';
        if (!outputPath) return { ok: false, resultsText: 'outputPath is required.' } as any;
        const r = await photoshopExportProof({
          appName: typeof a.appName === 'string' ? a.appName : 'Photoshop',
          outputPath,
          format: ['png', 'jpg', 'jpeg'].includes(String(a.format || '').toLowerCase()) ? String(a.format).toLowerCase() as any : undefined,
          quality: Number.isFinite(Number(a.quality)) ? Number(a.quality) : undefined,
          expectedDocumentName: typeof a.expectedDocumentName === 'string' ? a.expectedDocumentName : undefined,
          sourceDocumentPath: typeof a.sourceDocumentPath === 'string' ? a.sourceDocumentPath : undefined,
        });
        if (!r.ok || !r.data) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const d = r.data;
	        if (d.error || !d.fileExists) return { ok: false, ...d, resultsText: `Photoshop proof export failed: ${d.error || 'output file was not created'}` } as any;
	        return {
	          ok: true,
	          ...d,
	          resultsText: `Exported Photoshop ${d.format.toUpperCase()} proof for ${d.documentName || 'active document'} to ${d.outputPath} (${Math.round(d.sizeBytes / 1024)} KB, ${d.widthPx}x${d.heightPx}px).`,
	        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.read_a11y_tree': {
      try {
        const { readA11yTree, renderA11yTree, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await readA11yTree({ appName: a.appName, maxDepth: a.maxDepth, maxNodes: a.maxNodes });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        const lines = r.data?.tree ? renderA11yTree(r.data.tree).slice(0, 220) : [];
        return { ok: true, resultsText: `Accessibility tree for ${r.data?.app || 'frontmost app'} (pid ${r.data?.pid || 0}, nodes ${r.data?.budget_used || 0}):\n${lines.join('\n')}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.click_element': {
      try {
        const { clickElement, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await clickElement({ pid: Number(a.pid || 0), path: String(a.path || '') });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Clicked accessibility element ${String(a.path || '')} via ${r.data?.method || 'unknown'}.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'desktop.set_element_value': {
      try {
        const { setElementValue, isDesktopBridgeAvailable } = await import('./desktopBridge');
        if (!(await isDesktopBridgeAvailable())) return { ok: false, resultsText: 'Desktop bridge offline.' } as any;
        const a = args as any;
        const r = await setElementValue({ pid: Number(a.pid || 0), path: String(a.path || ''), text: String(a.text || '') });
        if (!r.ok) return { ok: false, resultsText: describeDesktopFailure(r.error, r.errorCode) } as any;
        return { ok: true, resultsText: `Set accessibility element ${String(a.path || '')} via ${r.data?.method || 'unknown'} (${r.data?.chars || 0} chars).` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Memory Save ─────────────────────────────────────────────────────
    case 'save_memory': {
      try {
        const { saveMemory } = await import('./agentRunSystem');
        const a = args as any;
        const kind = ['preference', 'fact', 'decision', 'finding', 'instruction'].includes(a.kind) ? a.kind : 'fact';
        const mem = await saveMemory({
          scope: 'circle',
          circleId: context.circleId,
          memoryKind: kind,
          title: a.title,
          content: a.content,
          sourceSurface: context.surface || 'main_chat',
          importance: kind === 'instruction' ? 0.9 : kind === 'decision' ? 0.8 : 0.6,
          visibility: 'circle_shared',
        });
        if (!mem) return { ok: false, resultsText: 'Failed to save memory.' } as any;
        return { ok: true, resultsText: `Saved memory: "${a.title}" [${kind}]` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── WordPress Admin ──────────────────────────────────────────────────
    case 'wp.discover_types': {
      try {
        const { discoverPostTypes } = await import('./wpAdmin');
        const a = args as any;
        const types = await discoverPostTypes({ siteUrl: a.siteUrl, onePasswordItem: a.onePasswordItem, onePasswordVault: a.vault });
        const lines = Object.entries(types).map(([slug, t]: [string, any]) => `- ${t.name} (${slug}) → REST: /wp/v2/${t.rest_base}`);
        return { ok: true, resultsText: lines.join('\n') || 'No post types found.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'wp.upload_media': {
      try {
        const { uploadMediaFromStorage } = await import('./wpAdmin');
        const a = args as any;
        const media = await uploadMediaFromStorage(
          { siteUrl: a.siteUrl, onePasswordItem: a.onePasswordItem },
          a.storagePath, a.fileName, a.mimeType || 'image/jpeg',
        );
        return { ok: true, resultsText: `Uploaded: ${media.title?.rendered || a.fileName} (ID: ${media.id})\nURL: ${media.source_url}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'wp.create_slide': {
      try {
        const { uploadImageAndCreateSlide } = await import('./wpAdmin');
        const a = args as any;
        const { media, slide } = await uploadImageAndCreateSlide(
          { siteUrl: a.siteUrl, onePasswordItem: a.onePasswordItem },
          { storagePath: a.storagePath, fileName: a.fileName, mimeType: a.mimeType || 'image/jpeg' },
          { title: a.title, status: a.status || 'publish', slideType: a.slideType },
        );
        return { ok: true, resultsText: `Slide created: "${slide.title?.rendered}" (ID: ${slide.id})\nImage: ${media.source_url}\nSlide: ${slide.link}` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'wp.list_posts': {
      try {
        const { listPosts } = await import('./wpAdmin');
        const a = args as any;
        const posts = await listPosts(
          { siteUrl: a.siteUrl, onePasswordItem: a.onePasswordItem },
          { postType: a.postType, perPage: a.perPage },
        );
        if (posts.length === 0) return { ok: true, resultsText: 'No items found.' } as any;
        const lines = posts.map((p: any) => `- [${p.status}] ${p.title?.rendered || 'Untitled'} (ID: ${p.id})`);
        return { ok: true, resultsText: lines.join('\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    // ── Vault Automation Access ────────────────────────────────────────
    case 'vault.list': {
      try {
        const a = args as any;
        const result = await findVaultAutomationEntries(context.circleId, {
          query: typeof a.query === 'string' ? a.query : undefined,
          platform: typeof a.platform === 'string' ? a.platform : undefined,
          action: typeof a.action === 'string' ? a.action : undefined,
        });
        if (result.error) return { ok: false, resultsText: result.vaultMissing ? 'Vault is not deployed yet.' : result.error } as any;
        if (result.entries.length === 0) return { ok: true, resultsText: 'No matching vault credentials found.' } as any;
        const lines = result.entries.slice(0, 25).map(formatVaultEntryAutomationSummary);
        if (result.entries.length > 25) lines.push(`...and ${result.entries.length - 25} more. Narrow with query or platform.`);
        return { ok: true, resultsText: lines.join('\n\n') } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'vault.find': {
      try {
        const a = args as any;
        const selection = await selectVaultAutomationEntry(context.circleId, {
          credentialId: typeof a.credentialId === 'string' ? a.credentialId : undefined,
          query: typeof a.query === 'string' ? a.query : undefined,
          platform: typeof a.platform === 'string' ? a.platform : undefined,
          action: typeof a.action === 'string' ? a.action : undefined,
        });
        if (!selection.ok) return { ok: false, resultsText: selection.error } as any;
        return { ok: true, resultsText: formatVaultEntryAutomationSummary(selection.entry) } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'vault.grants': {
      try {
        const a = args as any;
        const hasSelector = Boolean(a.credentialId || a.query || a.platform);
        if (hasSelector) {
          const selection = await selectVaultAutomationEntry(context.circleId, {
            credentialId: typeof a.credentialId === 'string' ? a.credentialId : undefined,
            query: typeof a.query === 'string' ? a.query : undefined,
            platform: typeof a.platform === 'string' ? a.platform : undefined,
          });
          if (!selection.ok) return { ok: false, resultsText: selection.error } as any;
          return { ok: true, resultsText: formatVaultGrantList(selection.entry) } as any;
        }
        const result = await findVaultAutomationEntries(context.circleId);
        if (result.error) return { ok: false, resultsText: result.vaultMissing ? 'Vault is not deployed yet.' : result.error } as any;
        const lines = result.entries
          .map(formatVaultGrantList)
          .filter((line) => line.includes('->'));
        return { ok: true, resultsText: lines.length ? lines.join('\n\n') : 'No vault automation grants found.' } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'vault.grant': {
      try {
        const a = args as any;
        const result = await grantVaultAutomationAccess(context.circleId, {
          credentialId: typeof a.credentialId === 'string' ? a.credentialId : undefined,
          query: typeof a.query === 'string' ? a.query : undefined,
          platform: typeof a.platform === 'string' ? a.platform : undefined,
          action: typeof a.action === 'string' ? a.action : undefined,
          grantee: String(a.grantee || ''),
          granteeType: a.granteeType,
          actions: Array.isArray(a.actions) ? a.actions.map(String) : undefined,
          expiresAt: typeof a.expiresAt === 'string' ? a.expiresAt : undefined,
          note: typeof a.note === 'string' ? a.note : undefined,
          createdBy: context.userId,
        });
        return { ok: result.ok, resultsText: result.resultsText } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'vault.revoke': {
      try {
        const a = args as any;
        const result = await revokeVaultAutomationAccess(context.circleId, {
          credentialId: typeof a.credentialId === 'string' ? a.credentialId : undefined,
          query: typeof a.query === 'string' ? a.query : undefined,
          platform: typeof a.platform === 'string' ? a.platform : undefined,
          action: typeof a.action === 'string' ? a.action : undefined,
          grantee: String(a.grantee || ''),
          granteeType: a.granteeType,
        });
        return { ok: result.ok, resultsText: result.resultsText } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'vault.runbook': {
      try {
        const a = args as any;
        const selection = await selectVaultAutomationEntry(context.circleId, {
          credentialId: typeof a.credentialId === 'string' ? a.credentialId : undefined,
          query: typeof a.query === 'string' ? a.query : undefined,
          platform: typeof a.platform === 'string' ? a.platform : undefined,
          action: typeof a.action === 'string' ? a.action : 'login',
        });
        if (!selection.ok) return { ok: false, resultsText: selection.error } as any;
        return {
          ok: true,
          resultsText: buildVaultAgentRunbook(selection.entry, {
            task: typeof a.task === 'string' ? a.task : undefined,
            grantee: typeof a.grantee === 'string' ? a.grantee : 'OpenSwan',
            granteeType: a.granteeType || 'openswan',
          }),
        } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'vault.resolve_for_task': {
      try {
        const a = args as any;
        const result = await resolveVaultCredentialForTask(context.circleId, {
          task: String(a.task || ''),
          platform: typeof a.platform === 'string' ? a.platform : undefined,
          siteUrl: typeof a.siteUrl === 'string' ? a.siteUrl : undefined,
          action: typeof a.action === 'string' ? a.action : undefined,
        });
        return { ok: result.ok, resultsText: result.resultsText } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    case 'credentials.get': {
      try {
        const { getCredentials: getCreds } = await import('./credentialService');
        const a = args as any;
        const { ok, fields, error } = await getCreds({ item: a.item, vault: a.vault, fields: a.fields });
        if (!ok) return { ok: false, resultsText: error || 'Failed to fetch credentials' } as any;
        const keys = Object.keys(fields);
        return { ok: true, resultsText: `Retrieved ${keys.length} field(s) for "${a.item}": ${keys.join(', ')}. Credentials are available for use.` } as any;
      } catch (e: any) { return { ok: false, resultsText: e.message } as any; }
    }
    default:
      return executeOpenSwanTool(
        tool as OpenSwanToolName,
        args as OpenSwanToolExecutionArgs[OpenSwanToolName],
      ) as Promise<OpenSwanToolExecutionResultMap[T]>;
  }
}
