import {
  buildAgentFailureRecoveryPolicy,
  summarizeAgentFailureRecoveryPolicy,
  startConnectedAgentFailureRecovery,
  RECOVERY_ADVISORY_BEGIN,
  RECOVERY_ADVISORY_END,
  type AgentFailureRecoveryInput,
  type AgentFailureRecoveryRunbook,
  type AgentFailureRecoveryStartResult,
} from './agentFailureRecovery';
import {
  formatComputerTaskCheckpointRecoveryForPrompt,
  type ComputerTaskCheckpointRecoveryContext,
} from './computerTaskCheckpointRecovery';
import {
  diagnoseComputerTaskEvidenceFailure,
  formatComputerTaskEvidenceRecoveryForPrompt,
  type ComputerTaskAppRouteDecisionInput,
  type ComputerTaskEvidenceRecoveryContext,
  type ComputerTaskEvidenceRecoveryObservation,
  type ComputerTaskRecoveryAppFallback,
} from './computerTaskEvidenceRecovery';
import { buildAppAdapterGapPlan } from './appAdapterGapContract';
import type { ComputerTaskEvidenceContract } from './computerTaskEvidenceContract';
import type { ComputerTaskReplayPolicy } from './computerTaskOutcome';
import {
  buildChatComputerRequestRoute,
  type ChatComputerRequestRoute,
} from './chatComputerRequestRouter';
import {
  buildChatManualVerificationRecoveryAction,
  type ChatManualVerificationTool,
} from './chatComputerOutcomeUx';
import type {
  OpenSwanRuntimeToolContext,
  OpenSwanToolExecutionArgs,
} from './openswanToolRuntime';

export interface ChatManualVerificationTaskScope {
  circleId: string;
  userId: string;
  threadId: string;
  taskStateId: string;
  sourceMessageId: string;
}

export interface ChatManualVerificationAuthorityInput extends ChatManualVerificationTaskScope {
  currentScope: ChatManualVerificationTaskScope;
  /** Stable author of the original user request and the currently signed-in
   * member. Both must equal the scope user before a capability is minted. */
  requesterUserId: string;
  currentUserId: string;
  /** Expected bridge process captured when the original task started, plus a
   * fresh value read immediately before authority issuance. */
  bridgeInstanceId: string;
  currentBridgeInstanceId: string;
  activePluginIds?: string[];
  replayPolicy?: ComputerTaskReplayPolicy | null;
  mutationDispatched?: boolean;
  verificationOnlyTools?: string[] | null;
  target?: ChatManualVerificationTargetInput | null;
}

export interface ChatManualVerificationTargetInput {
    appName?: string | null;
    browserIdentity?: {
      browserProcessId: string;
      browserContextId: string;
      pageId: string;
      url: string;
    } | null;
    expectedDocumentName?: string | null;
    expectedWidthPx?: number | null;
    expectedHeightPx?: number | null;
    filePath?: string | null;
}

export interface ChatManualVerificationAuthority extends ChatManualVerificationTaskScope {
  schemaVersion: 1;
  tools: readonly ChatManualVerificationTool[];
}

export interface ChatManualVerificationObservation {
  tool: ChatManualVerificationTool;
  ok: boolean;
  summary: string;
  matchesExpectedState: boolean | null;
  observedAt: string;
}

export interface ChatManualVerificationResult {
  status: 'observed' | 'partial' | 'blocked';
  reasonCode:
    | 'fresh_observation_collected'
    | 'some_observations_failed'
    | 'observation_failed'
    | 'invalid_authority'
    | 'authority_already_used'
    | 'stale_task_scope'
    | 'bridge_instance_mismatch'
    | 'tool_policy_not_read_only';
  userMessage: string;
  observations: ChatManualVerificationObservation[];
  attemptedTools: ChatManualVerificationTool[];
  mutationReplayed: false;
  originalPromptReplayed: false;
  taskCompletionVerified: false;
}

type ChatManualVerificationTarget = {
  appName: string | null;
  browserIdentity: {
    browserProcessId: string;
    browserContextId: string;
    pageId: string;
    url: string;
  } | null;
  expectedDocumentName: string | null;
  expectedWidthPx: number | null;
  expectedHeightPx: number | null;
  filePath: string | null;
};

type ChatManualVerificationAuthorityState = {
  scope: ChatManualVerificationTaskScope;
  tools: ChatManualVerificationTool[];
  target: ChatManualVerificationTarget;
  bridgeInstanceId: string;
  activePluginIds: string[];
};

export type ChatManualVerificationDispatcher = (
  tool: ChatManualVerificationTool,
  args: Record<string, unknown>,
  context: OpenSwanRuntimeToolContext,
) => Promise<unknown>;

export interface ExecuteChatManualVerificationInput {
  authority: ChatManualVerificationAuthority;
  getCurrentScope: () => ChatManualVerificationTaskScope | null;
  getCurrentBridgeInstanceId: () => string | null | Promise<string | null>;
  dispatch?: ChatManualVerificationDispatcher;
  now?: () => Date;
}

const issuedChatManualVerificationAuthorities = new WeakMap<object, ChatManualVerificationAuthorityState>();
const consumedChatManualVerificationAuthorities = new WeakSet<object>();

export interface ChatFailureRecoveryInput {
  task: string;
  failureMessage: string;
  failureStack?: string | null;
  outcomeStatus?: string | null;
  executionKind?: string | null;
  runId?: string | null;
  planSummary?: string | null;
  groundingSummary?: string | null;
  preflightSummary?: string | null;
  source?: string | null;
  sessionId?: string | null;
  launchIfMissing?: boolean;
  /** Explicit user approval to launch/use a connected agent for recovery (default off). */
  approveConnectedAgentLaunch?: boolean;
  circleId?: string;
  userId?: string;
  selectedModel?: string | null;
  activePluginIds?: string[];
  checkpointRecovery?: ComputerTaskCheckpointRecoveryContext | null;
  evidenceContract?: ComputerTaskEvidenceContract | null;
  appRouteDecision?: ComputerTaskAppRouteDecisionInput | null;
  /**
   * QW4: fresh observations harvested from the failed run's tool loop (incl.
   * auto_reobserve events), so recovery can decide whether a bounded retry is
   * actually backed by fresh evidence instead of assuming it. When absent (a
   * missed harvest, or a non-computer failure), readiness degrades to advisory —
   * it never blocks a retry that would otherwise be allowed. Additive.
   */
  observations?: ComputerTaskEvidenceRecoveryObservation[] | null;
  /** AR: the app the user named, so unavailable-app recovery can cite intent. */
  namedAppIntent?: string | null;
  /** AR: the structured next-best launchable app to switch to on an unavailable-app failure. */
  appFallback?: ComputerTaskRecoveryAppFallback | null;
  evidenceRecovery?: ComputerTaskEvidenceRecoveryContext | null;
  recoveryFingerprint?: string | null;
  repeatCount?: number;
  suppressConnectedHandoff?: boolean;
  suppressionReason?: string | null;
  replayPolicy?: ComputerTaskReplayPolicy | null;
  mutationDispatched?: boolean;
  verificationOnlyTools?: string[];
}

export interface ChatFailureRecoveryResult {
  recovery: AgentFailureRecoveryStartResult;
  agentInput: AgentFailureRecoveryInput;
  /** Terse, user-facing chat message: one-line reason + the single next action. */
  userMessage: string;
  /** Full failure-recovery breakdown for archive/debug surfaces. Not shown in chat. */
  detail: string;
  recoveryOptions: ChatFailureRecoveryOption[];
  archiveSummary: string;
  archiveTouched: string[];
  archiveMetadata: Record<string, unknown>;
  fingerprint: string;
  verificationPlan: ChatFailureRecoveryVerificationPlan;
  runbook: AgentFailureRecoveryRunbook;
}

export type ChatFailureRecoveryOptionActor = 'user' | 'openswan' | 'connected_agent' | 'llm' | 'none';

export interface ChatFailureRecoveryOption {
  id: string;
  label: string;
  detail: string;
  actor: ChatFailureRecoveryOptionActor;
  recommended: boolean;
  source: 'checkpoint_guard' | 'evidence_contract' | 'connected_agent_runbook' | 'recovery_policy' | 'safety_stop';
}

export interface ChatFailureRecoveryOptionSelection {
  optionId: string;
  label: string;
  detail: string;
  actor: ChatFailureRecoveryOptionActor;
  source: ChatFailureRecoveryOption['source'];
  recommended: boolean;
  context?: ChatFailureRecoveryOptionSelectionContext;
}

export interface ChatFailureRecoveryOptionSelectionContext {
  messageId?: string | null;
  runId?: string | null;
  sourceSurface?: string | null;
  failureExcerpt?: string | null;
}

export interface ChatFailureRecoveryOptionFollowupResolution {
  option: ChatFailureRecoveryOption;
  confidence: number;
  reason: string;
}

export type ChatFailureRecoveryExecutionAction =
  | 'retry_with_fresh_evidence'
  | 'repair_with_connected_agent'
  | 'request_user_unblock'
  | 'switch_route_or_model'
  | 'repair_or_restart_bridge'
  | 'stop_and_report'
  | 'continue_recovery';

export type ChatFailureRecoverySafetyMode =
  | 'fresh_evidence_only'
  | 'approval_gated_repair'
  | 'user_unblock'
  | 'route_switch'
  | 'diagnostic_only'
  | 'stop';

export interface ChatFailureRecoveryExecutionPolicy {
  action: ChatFailureRecoveryExecutionAction;
  safetyMode: ChatFailureRecoverySafetyMode;
  requiresApproval: boolean;
  requiresFreshEvidence: boolean;
  userActionRequired: boolean;
  allowConnectedAgent: boolean;
  allowRuntimePatch: boolean;
  allowBrowserDesktopRetry: boolean;
  allowSideEffects: boolean;
  maxAttempts: number;
  summary: string;
}

export interface ChatFailureRecoveryExecutionPlan {
  policy: ChatFailureRecoveryExecutionPolicy;
  userSummary: string;
  nextSteps: string[];
  stopConditions: string[];
  hiddenInstructions: string[];
}

export interface ChatFailureRecoveryRepeatState {
  recentRepeat: boolean;
  repeatCount: number;
  lastSuccessfulHandoffAt?: number | null;
  nowMs: number;
  repeatWindowMs: number;
}

export interface ChatFailureRecoveryVerificationPlan {
  commands: string[];
  checks: string[];
}

export interface ChatFailureRecoveryReliabilitySummary {
  surfaceKind: ComputerTaskEvidenceRecoveryContext['kind'] | null;
  targetName: string | null;
  taskFamily: string | null;
  failureArea: ComputerTaskEvidenceRecoveryContext['failureArea'] | null;
  retryAllowed: boolean;
  userActionRequired: boolean;
  connectedAgentAllowed: boolean;
  recommendedOptionId: string | null;
  readinessStatus: string | null;
  nextEvidenceTools: string[];
  requiredEvidenceTools: string[];
  requiredFreshEvidence: string[];
  requiredProof: string[];
  approvalBoundaries: string[];
  failClosedRules: string[];
  routeDecisionStatus: string | null;
  routeDecisionSurface: string | null;
  selectedRecoveryOptionId: string | null;
  verificationCommands: string[];
}

function clean(value: unknown, max = 4_000): string {
  return String(value || '').replace(/\r/g, '').trim().slice(0, max);
}

function unique(values: Array<string | null | undefined>, max = Number.POSITIVE_INFINITY): string[] {
  return Array.from(new Set(values.map((value) => clean(value, 240)).filter(Boolean))).slice(0, max);
}

function exactBoundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function normalizeChatManualVerificationScope(
  scope: ChatManualVerificationTaskScope | null | undefined,
): ChatManualVerificationTaskScope | null {
  if (!scope) return null;
  const circleId = exactBoundedString(scope.circleId, 200);
  const userId = exactBoundedString(scope.userId, 200);
  const threadId = exactBoundedString(scope.threadId, 200);
  const taskStateId = exactBoundedString(scope.taskStateId, 240);
  const sourceMessageId = exactBoundedString(scope.sourceMessageId, 240);
  if (!circleId || !userId || !threadId || !taskStateId || !sourceMessageId) return null;
  return { circleId, userId, threadId, taskStateId, sourceMessageId };
}

function sameChatManualVerificationScope(
  expected: ChatManualVerificationTaskScope,
  actual: ChatManualVerificationTaskScope | null | undefined,
): boolean {
  const normalized = normalizeChatManualVerificationScope(actual);
  return Boolean(
    normalized
    && normalized.circleId === expected.circleId
    && normalized.userId === expected.userId
    && normalized.threadId === expected.threadId
    && normalized.taskStateId === expected.taskStateId
    && normalized.sourceMessageId === expected.sourceMessageId
  );
}

function normalizePositiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 100_000 ? number : null;
}

function normalizeChatManualVerificationTarget(
  target: ChatManualVerificationTargetInput | null | undefined,
  tools: ChatManualVerificationTool[],
): ChatManualVerificationTarget | null {
  const raw = target || {};
  const appName = raw.appName == null ? null : exactBoundedString(raw.appName, 160);
  const browserProcessId = exactBoundedString(raw.browserIdentity?.browserProcessId, 160);
  const browserContextId = exactBoundedString(raw.browserIdentity?.browserContextId, 160);
  const pageId = exactBoundedString(raw.browserIdentity?.pageId, 160);
  const opaqueUrl = typeof raw.browserIdentity?.url === 'string'
    && /^uc_browser_url_[a-f0-9]{64}$/.test(raw.browserIdentity.url)
    ? raw.browserIdentity.url
    : null;
  const browserIdentity = browserProcessId && browserContextId && pageId && opaqueUrl
    ? { browserProcessId, browserContextId, pageId, url: opaqueUrl }
    : null;
  const expectedDocumentName = raw.expectedDocumentName == null
    ? null
    : exactBoundedString(raw.expectedDocumentName, 240);
  const filePath = raw.filePath == null ? null : exactBoundedString(raw.filePath, 4_096);
  if (raw.appName != null && !appName) return null;
  if (raw.browserIdentity != null && !browserIdentity) return null;
  if (raw.expectedDocumentName != null && !expectedDocumentName) return null;
  if (raw.filePath != null && !filePath) return null;

  const hasExpectedWidth = raw.expectedWidthPx != null;
  const hasExpectedHeight = raw.expectedHeightPx != null;
  const expectedWidthPx = hasExpectedWidth ? normalizePositiveInteger(raw.expectedWidthPx) : null;
  const expectedHeightPx = hasExpectedHeight ? normalizePositiveInteger(raw.expectedHeightPx) : null;
  if (hasExpectedWidth !== hasExpectedHeight || (hasExpectedWidth && (!expectedWidthPx || !expectedHeightPx))) return null;
  if (tools.includes('browser.dom_snapshot') && !browserIdentity) return null;
  if (tools.includes('desktop.observe_app') && !appName) return null;
  if (tools.includes('desktop.file_stat') && !filePath) return null;
  if (
    tools.includes('desktop.photoshop_document_status')
    && (
      !appName
      || !/photoshop/i.test(appName)
      || (!expectedDocumentName && (!expectedWidthPx || !expectedHeightPx))
    )
  ) return null;

  return {
    appName,
    browserIdentity,
    expectedDocumentName,
    expectedWidthPx,
    expectedHeightPx,
    filePath,
  };
}

/** Pure render/click precheck. Authority issuance repeats this validation. */
export function isChatManualVerificationTargetBound(input: {
  target?: ChatManualVerificationTargetInput | null;
  tools?: readonly ChatManualVerificationTool[] | null;
}): boolean {
  const tools = Array.isArray(input.tools) ? [...input.tools] : [];
  return tools.length > 0 && normalizeChatManualVerificationTarget(input.target, tools) != null;
}

/**
 * Mint an ephemeral, single-use capability for one currently selected task.
 * The persisted handoff supplies exact target identity, but this function
 * revalidates it and binds the executable copy to a WeakMap capability. The
 * capability itself cannot be serialized or replayed after refresh.
 */
export function issueChatManualVerificationAuthority(
  input: ChatManualVerificationAuthorityInput,
): ChatManualVerificationAuthority | null {
  const scope = normalizeChatManualVerificationScope(input);
  if (!scope || !sameChatManualVerificationScope(scope, input.currentScope)) return null;
  const requesterUserId = exactBoundedString(input.requesterUserId, 200);
  const currentUserId = exactBoundedString(input.currentUserId, 200);
  if (!requesterUserId || requesterUserId !== currentUserId || requesterUserId !== scope.userId) return null;
  const bridgeInstanceId = exactBoundedString(input.bridgeInstanceId, 128);
  const currentBridgeInstanceId = exactBoundedString(input.currentBridgeInstanceId, 128);
  if (!bridgeInstanceId || bridgeInstanceId !== currentBridgeInstanceId) return null;
  const action = buildChatManualVerificationRecoveryAction(input);
  if (!action) return null;
  const target = normalizeChatManualVerificationTarget(input.target, action.tools);
  if (!target) return null;
  const activePluginIds = unique(input.activePluginIds || [], 20);
  const authority: ChatManualVerificationAuthority = Object.freeze({
    schemaVersion: 1 as const,
    ...scope,
    tools: Object.freeze([...action.tools]),
  });
  issuedChatManualVerificationAuthorities.set(authority, {
    scope,
    tools: [...action.tools],
    target,
    bridgeInstanceId,
    activePluginIds,
  });
  return authority;
}

type ChatManualVerificationToolArgs = {
  [T in ChatManualVerificationTool]: OpenSwanToolExecutionArgs[T];
};

function buildChatManualVerificationToolArgs<T extends ChatManualVerificationTool>(
  tool: T,
  target: ChatManualVerificationTarget,
): ChatManualVerificationToolArgs[T] {
  switch (tool) {
    case 'browser.dom_snapshot':
      return {
        maxNodes: 120,
        interestingOnly: true,
        response_format: 'concise',
        expectedBrowserProcessId: target.browserIdentity?.browserProcessId,
        expectedBrowserContextId: target.browserIdentity?.browserContextId,
        expectedPageId: target.browserIdentity?.pageId,
        expectedUrl: target.browserIdentity?.url,
      } as unknown as ChatManualVerificationToolArgs[T];
    case 'desktop.observe_app':
      return {
        appName: target.appName || undefined,
        maxDepth: 4,
        maxNodes: 120,
      } as ChatManualVerificationToolArgs[T];
    case 'desktop.photoshop_document_status':
      return {
        appName: 'Photoshop',
        expectedDocumentName: target.expectedDocumentName || undefined,
        sourceDocumentPath: target.filePath || undefined,
      } as ChatManualVerificationToolArgs[T];
    case 'desktop.file_stat':
      return { path: target.filePath || '' } as ChatManualVerificationToolArgs[T];
  }
}

class UnsafeChatManualVerificationPolicyError extends Error {}

async function dispatchChatManualVerificationTool(
  tool: ChatManualVerificationTool,
  args: Record<string, unknown>,
  context: OpenSwanRuntimeToolContext,
  bindingStillCurrent: () => Promise<boolean>,
): Promise<unknown> {
  const runtime = await import('./openswanToolRuntime');
  if (!await bindingStillCurrent()) return { ok: false, errorCode: 'stale_task_scope' };
  const policy = runtime.getOpenSwanToolPolicy(tool, context.activePluginIds);
  if (policy.mutatesState || policy.externalSideEffect || policy.approvalMode !== 'auto') {
    throw new UnsafeChatManualVerificationPolicyError('Manual verification tool policy is no longer strictly read-only.');
  }
  if (tool === 'browser.dom_snapshot') {
    const { domSnapshot, getBrowserHealth } = await import('./browserBridge');
    if (!await bindingStillCurrent()) return { ok: false, errorCode: 'stale_task_scope' };
    const health = await getBrowserHealth();
    if (!await bindingStillCurrent()) return { ok: false, errorCode: 'stale_task_scope' };
    const matches = health
      && health.browserProcessId === args.expectedBrowserProcessId
      && health.browserContextId === args.expectedBrowserContextId
      && health.pageId === args.expectedPageId
      && health.url === args.expectedUrl;
    if (!matches) return { ok: false, errorCode: 'browser_identity_mismatch' };
    const snapshot = await domSnapshot({
      maxNodes: Number(args.maxNodes) || 120,
      interestingOnly: args.interestingOnly !== false,
    });
    if (!await bindingStillCurrent()) return { ok: false, errorCode: 'stale_task_scope' };
    if (!snapshot.ok || !snapshot.data) return { ok: false, errorCode: snapshot.errorCode || 'stale_bridge' };
    if (
      snapshot.data.browserProcessId !== args.expectedBrowserProcessId
      || snapshot.data.browserContextId !== args.expectedBrowserContextId
      || snapshot.data.pageId !== args.expectedPageId
      || snapshot.data.url !== args.expectedUrl
    ) return { ok: false, errorCode: 'browser_identity_mismatch' };
    return { ok: true, ...snapshot.data };
  }
  if (tool === 'desktop.photoshop_document_status') {
    const { photoshopDocumentStatus } = await import('./desktopBridge');
    if (!await bindingStillCurrent()) return { ok: false, errorCode: 'stale_task_scope' };
    const status = await photoshopDocumentStatus({
      appName: typeof args.appName === 'string' ? args.appName : 'Photoshop',
      expectedDocumentName: typeof args.expectedDocumentName === 'string' ? args.expectedDocumentName : undefined,
      sourceDocumentPath: typeof args.sourceDocumentPath === 'string' ? args.sourceDocumentPath : undefined,
    });
    if (!await bindingStillCurrent()) return { ok: false, errorCode: 'stale_task_scope' };
    return status.ok && status.data
      ? { ok: true, ...status.data }
      : { ok: false, errorCode: status.errorCode || 'stale_bridge' };
  }
  return runtime.executeOpenSwanRuntimeTool(tool, args as never, context);
}

function resultRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

function summarizeChatManualVerificationObservation(
  tool: ChatManualVerificationTool,
  value: unknown,
  target: ChatManualVerificationTarget,
  observedAt: string,
): ChatManualVerificationObservation {
  const record = resultRecord(value);
  const ok = record.ok === true;
  if (!ok) {
    const labels: Record<ChatManualVerificationTool, string> = {
      'browser.dom_snapshot': 'browser page',
      'desktop.observe_app': 'desktop app',
      'desktop.photoshop_document_status': 'Photoshop document',
      'desktop.file_stat': 'local file',
    };
    return {
      tool,
      ok: false,
      summary: `Could not collect a fresh read-only observation for the ${labels[tool]}.`,
      matchesExpectedState: null,
      observedAt,
    };
  }

  if (tool === 'browser.dom_snapshot') {
    const expected = target.browserIdentity;
    const matchesExpectedState = expected
      ? record.browserProcessId === expected.browserProcessId
        && record.browserContextId === expected.browserContextId
        && record.pageId === expected.pageId
        && record.url === expected.url
      : false;
    return {
      tool,
      ok: true,
      summary: matchesExpectedState
        ? 'Captured a fresh read-only DOM snapshot for the exact bound browser page.'
        : 'The current browser page no longer matches the page bound to this task.',
      matchesExpectedState,
      observedAt,
    };
  }
  if (tool === 'desktop.observe_app') {
    return {
      tool,
      ok: true,
      summary: 'Captured a fresh read-only desktop app observation.',
      matchesExpectedState: null,
      observedAt,
    };
  }
  if (tool === 'desktop.file_stat') {
    const exists = typeof record.exists === 'boolean' ? record.exists : null;
    const size = safeInteger(record.size);
    const kind = ['file', 'directory', 'symlink', 'other'].includes(String(record.kind || '').toLowerCase())
      ? String(record.kind).toLowerCase()
      : null;
    const summary = exists === false
      ? 'The bound local path does not currently exist.'
      : exists === true
        ? `The bound local path exists${kind ? ` as a ${kind}` : ''}${size != null ? ` (${size} bytes)` : ''}.`
        : 'Captured fresh read-only metadata for the bound local path.';
    return { tool, ok: true, summary, matchesExpectedState: exists, observedAt };
  }

  const widthPx = safeInteger(record.widthPx);
  const heightPx = safeInteger(record.heightPx);
  const resultText = typeof record.resultsText === 'string' ? record.resultsText.slice(0, 300) : '';
  const expectedDimensionsPresent = target.expectedWidthPx != null && target.expectedHeightPx != null;
  const actualDocumentName = typeof record.activeDocumentName === 'string'
    ? record.activeDocumentName.trim()
    : '';
  const normalizeDocumentName = (value: string) => value.toLowerCase().replace(/\.[^.]+$/, '').trim();
  const expectedChecks: boolean[] = [];
  if (expectedDimensionsPresent) {
    expectedChecks.push(
      widthPx != null
      && heightPx != null
      && widthPx === target.expectedWidthPx
      && heightPx === target.expectedHeightPx,
    );
  }
  if (target.expectedDocumentName) {
    expectedChecks.push(
      Boolean(actualDocumentName)
      && normalizeDocumentName(actualDocumentName) === normalizeDocumentName(target.expectedDocumentName),
    );
  }
  const matchesExpectedState = expectedChecks.length > 0 ? expectedChecks.every(Boolean) : null;
  const summary = widthPx != null && heightPx != null
    ? `Fresh Photoshop status shows an active ${widthPx}x${heightPx} document${matchesExpectedState === true ? ' matching the expected dimensions' : matchesExpectedState === false ? ' that does not match the expected dimensions' : ''}.`
    : /not running/i.test(resultText)
      ? 'Fresh Photoshop status shows that Photoshop is not running.'
      : /no active document/i.test(resultText)
        ? 'Fresh Photoshop status shows no active document.'
        : 'Captured fresh read-only Photoshop document status.';
  return { tool, ok: true, summary, matchesExpectedState, observedAt };
}

function blockedChatManualVerificationResult(
  reasonCode: Extract<
    ChatManualVerificationResult['reasonCode'],
    'invalid_authority' | 'authority_already_used' | 'stale_task_scope' | 'bridge_instance_mismatch'
  >,
  userMessage: string,
): ChatManualVerificationResult {
  return {
    status: 'blocked',
    reasonCode,
    userMessage,
    observations: [],
    attemptedTools: [],
    mutationReplayed: false,
    originalPromptReplayed: false,
    taskCompletionVerified: false,
  };
}

/**
 * Execute only the authority's fixed observation program. It never accepts a
 * prompt or a caller-provided tool/argument pair, and it rechecks the selected
 * circle/thread/task before every read so a stale card cannot inspect another
 * task's state.
 */
export async function executeChatManualVerification(
  input: ExecuteChatManualVerificationInput,
): Promise<ChatManualVerificationResult> {
  const state = issuedChatManualVerificationAuthorities.get(input.authority as object);
  if (!state) {
    return blockedChatManualVerificationResult(
      'invalid_authority',
      'This verification action is no longer valid. Reopen the current task before checking its state.',
    );
  }
  if (consumedChatManualVerificationAuthorities.has(input.authority as object)) {
    return blockedChatManualVerificationResult(
      'authority_already_used',
      'This verification action was already used. Refresh the current task to collect another observation.',
    );
  }
  if (!sameChatManualVerificationScope(state.scope, input.getCurrentScope())) {
    return blockedChatManualVerificationResult(
      'stale_task_scope',
      'The selected task changed before verification, so no observation was run.',
    );
  }

  consumedChatManualVerificationAuthorities.add(input.authority as object);
  const observations: ChatManualVerificationObservation[] = [];
  const attemptedTools: ChatManualVerificationTool[] = [];
  const now = input.now || (() => new Date());

  const interruptedResult = (
    reasonCode: 'stale_task_scope' | 'bridge_instance_mismatch',
  ): ChatManualVerificationResult => ({
    status: observations.length > 0 ? 'partial' : 'blocked',
    reasonCode,
    userMessage: reasonCode === 'bridge_instance_mismatch'
      ? observations.length > 0
        ? 'The local desktop bridge changed after a read-only observation. I stopped without using that observation or replaying the original action.'
        : 'The local desktop bridge changed since this task ran, so no observation was performed.'
      : observations.length > 0
        ? 'The task selection changed after a read-only observation. I stopped without replaying the original action.'
        : 'The selected task changed before verification, so no observation was run.',
    observations,
    attemptedTools,
    mutationReplayed: false,
    originalPromptReplayed: false,
    taskCompletionVerified: false,
  });
  const bridgeStillMatches = async (): Promise<boolean> => {
    const current = exactBoundedString(await input.getCurrentBridgeInstanceId(), 128);
    // Scope may change while the health read is in flight, so its result is
    // usable only after a second exact scope check.
    return sameChatManualVerificationScope(state.scope, input.getCurrentScope())
      && current === state.bridgeInstanceId;
  };

  if (!await bridgeStillMatches()) {
    return sameChatManualVerificationScope(state.scope, input.getCurrentScope())
      ? interruptedResult('bridge_instance_mismatch')
      : interruptedResult('stale_task_scope');
  }

  for (const tool of state.tools) {
    if (!sameChatManualVerificationScope(state.scope, input.getCurrentScope())) {
      return interruptedResult('stale_task_scope');
    }
    if (!await bridgeStillMatches()) {
      return sameChatManualVerificationScope(state.scope, input.getCurrentScope())
        ? interruptedResult('bridge_instance_mismatch')
        : interruptedResult('stale_task_scope');
    }
    const args = buildChatManualVerificationToolArgs(tool, state.target) as Record<string, unknown>;
    attemptedTools.push(tool);
    try {
      const runtimeContext: OpenSwanRuntimeToolContext = {
        circleId: state.scope.circleId,
        userId: state.scope.userId,
        threadId: state.scope.threadId,
        surface: 'main_chat',
        activePluginIds: state.activePluginIds,
      };
      const value = input.dispatch
        ? await input.dispatch(tool, args, runtimeContext)
        : await dispatchChatManualVerificationTool(tool, args, runtimeContext, bridgeStillMatches);
      if (!sameChatManualVerificationScope(state.scope, input.getCurrentScope())) {
        return interruptedResult('stale_task_scope');
      }
      if (!await bridgeStillMatches()) {
        return sameChatManualVerificationScope(state.scope, input.getCurrentScope())
          ? interruptedResult('bridge_instance_mismatch')
          : interruptedResult('stale_task_scope');
      }
      const observedAt = now().toISOString();
      observations.push(summarizeChatManualVerificationObservation(tool, value, state.target, observedAt));
    } catch (error) {
      if (!sameChatManualVerificationScope(state.scope, input.getCurrentScope())) {
        return interruptedResult('stale_task_scope');
      }
      if (!await bridgeStillMatches()) {
        return sameChatManualVerificationScope(state.scope, input.getCurrentScope())
          ? interruptedResult('bridge_instance_mismatch')
          : interruptedResult('stale_task_scope');
      }
      if (error instanceof UnsafeChatManualVerificationPolicyError) {
        return {
          status: observations.length > 0 ? 'partial' : 'blocked',
          reasonCode: 'tool_policy_not_read_only',
          userMessage: 'Verification stopped because an allowed observation tool is no longer classified as strictly read-only.',
          observations,
          attemptedTools,
          mutationReplayed: false,
          originalPromptReplayed: false,
          taskCompletionVerified: false,
        };
      }
      observations.push(summarizeChatManualVerificationObservation(tool, { ok: false }, state.target, now().toISOString()));
    }
  }

  const successful = observations.filter((observation) => observation.ok).length;
  const mismatched = observations.some((observation) => observation.matchesExpectedState === false);
  const status = successful === observations.length ? 'observed' : successful > 0 ? 'partial' : 'blocked';
  const reasonCode = successful === observations.length
    ? 'fresh_observation_collected'
    : successful > 0
      ? 'some_observations_failed'
      : 'observation_failed';
  const observationText = observations.map((observation) => observation.summary).join(' ');
  const userMessage = successful === 0
    ? 'I could not collect the requested current-state observation. I did not repeat the original action.'
    : `${observationText} ${mismatched
      ? 'The observed state does not match the expected task state.'
      : 'The original action was not replayed.'} This observation does not by itself mark the original task complete.`;
  return {
    status,
    reasonCode,
    userMessage,
    observations,
    attemptedTools,
    mutationReplayed: false,
    originalPromptReplayed: false,
    taskCompletionVerified: false,
  };
}

function parseOptionActor(value: unknown): ChatFailureRecoveryOptionActor {
  const actor = clean(value, 80).toLowerCase().replace(/[.;,\s]+$/g, '');
  if (actor === 'user' || actor === 'openswan' || actor === 'connected_agent' || actor === 'llm' || actor === 'none') {
    return actor;
  }
  if (actor.includes('connected')) return 'connected_agent';
  if (actor.includes('open')) return 'openswan';
  return 'none';
}

function parseOptionSource(value: unknown): ChatFailureRecoveryOption['source'] {
  const source = clean(value, 80).toLowerCase().replace(/[.;,\s]+$/g, '');
  if (
    source === 'checkpoint_guard'
    || source === 'evidence_contract'
    || source === 'connected_agent_runbook'
    || source === 'recovery_policy'
    || source === 'safety_stop'
  ) {
    return source;
  }
  return 'recovery_policy';
}

function compactSingleLine(value: unknown, max = 700): string {
  return clean(value, max).replace(/\s+/g, ' ').trim();
}

function normalizeOptionFollowupText(value: unknown): string {
  return compactSingleLine(value, 500)
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9_#\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFollowupNumber(value: string): number | null {
  const numberWords: Record<string, number> = {
    one: 1,
    first: 1,
    two: 2,
    second: 2,
    three: 3,
    third: 3,
    four: 4,
    fourth: 4,
    five: 5,
    fifth: 5,
  };
  const match = value.match(/\b(?:option|choice|#)\s*(one|two|three|four|five|first|second|third|fourth|fifth|[1-5])\b/)
    || value.match(/\b(?:use|choose|pick|select|try|run)\s+(?:the\s+)?(one|two|three|four|five|first|second|third|fourth|fifth|[1-5])(?:st|nd|rd|th)?\b/);
  if (!match) return null;
  const raw = match[1];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : (numberWords[raw] || null);
}

function recoveryFollowupScore(text: string, option: ChatFailureRecoveryOption): number {
  const idText = normalizeOptionFollowupText(option.id.replace(/_/g, ' '));
  const labelText = normalizeOptionFollowupText(option.label);
  const detailText = normalizeOptionFollowupText(option.detail);
  let score = 0;
  if (text.includes(normalizeOptionFollowupText(option.id))) score += 8;
  if (idText && text.includes(idText)) score += 7;
  if (labelText && text.includes(labelText)) score += 8;
  if (detailText && detailText.length > 20 && text.includes(detailText.slice(0, 40))) score += 4;
  if (option.recommended && /\b(recommended|suggested|best|default|go ahead|do it|continue)\b/.test(text)) score += 4;

  if (option.id === 'retry_with_fresh_evidence' || option.actor === 'openswan') {
    if (/\b(retry|try again|rerun|fresh evidence|evidence|observe|reobserve|screenshot|dom|a11y)\b/.test(text)) score += 6;
  }
  if (option.id === 'let_connected_agent_repair' || option.actor === 'connected_agent') {
    if (/\b(connected agent|codex|claude code|repair|patch|fix it|fix the app|fix runtime|diagnose)\b/.test(text)) score += 6;
  }
  if (option.id === 'user_unblock' || option.id === 'resolve_blocker_first' || option.actor === 'user') {
    if (/\b(i will|ill|i did|done|unblock|login|log in|permission|mfa|captcha|approve|restart|reconnect|pair)\b/.test(text)) score += 6;
  }
  if (option.id === 'switch_route_or_model' || option.actor === 'llm') {
    if (/\b(switch|different|another|route|model|provider|backend)\b/.test(text)) score += 6;
  }
  if (option.id === 'repair_or_restart_bridge') {
    if (/\b(bridge|restart|repair|reconnect|pair|localhost)\b/.test(text)) score += 7;
  }
  if (option.id === 'stop_and_report' || option.actor === 'none') {
    if (/\b(stop|report|details|show details|no retry|dont retry|do not retry|cancel)\b/.test(text)) score += 7;
  }
  return score;
}

export function resolveChatFailureRecoveryOptionFollowup(
  message: string,
  options?: ChatFailureRecoveryOption[] | null,
): ChatFailureRecoveryOptionFollowupResolution | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  if (parseChatFailureRecoveryOptionSelection(message)) return null;
  const text = normalizeOptionFollowupText(message);
  if (!text) return null;
  if (!/\b(option|choice|recommended|suggested|best|default|retry|try again|rerun|fresh evidence|fix|repair|patch|connected agent|codex|claude code|unblock|permission|mfa|captcha|approve|switch|route|model|provider|bridge|stop|report|details|go ahead|do it|continue)\b|#\s*[1-5]/.test(text)) {
    return null;
  }

  const requestedIndex = parseFollowupNumber(text);
  if (requestedIndex != null) {
    const option = options[requestedIndex - 1];
    return option ? {
      option,
      confidence: 0.95,
      reason: `matched option ${requestedIndex}`,
    } : null;
  }

  if (/\b(?:use|choose|pick|select|try|run|do)\s+(?:the\s+)?(?:recommended|suggested|best|default)\b|\b(?:recommended|suggested|best|default)\s+(?:option|choice|one|fix|recovery)\b/.test(text)) {
    const option = options.find((candidate) => candidate.recommended) || options[0];
    return option ? {
      option,
      confidence: 0.9,
      reason: 'matched recommended recovery option',
    } : null;
  }

  const scored = options
    .map((option) => ({ option, score: recoveryFollowupScore(text, option) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top || top.score < 5) return null;
  const tied = scored.filter((candidate) => candidate.score === top.score);
  if (tied.length > 1) {
    const recommended = tied.find((candidate) => candidate.option.recommended);
    if (!recommended) return null;
    return {
      option: recommended.option,
      confidence: 0.72,
      reason: 'matched recommended option among tied recovery candidates',
    };
  }
  return {
    option: top.option,
    confidence: Math.min(0.94, 0.55 + top.score / 20),
    reason: 'matched recovery follow-up language',
  };
}

type RecoveryPolicySource = Partial<ChatFailureRecoveryOptionSelection> & Partial<ChatFailureRecoveryOption>;

export function deriveChatFailureRecoveryExecutionPolicy(
  option: RecoveryPolicySource | null | undefined,
): ChatFailureRecoveryExecutionPolicy {
  const optionId = compactSingleLine(option?.optionId || option?.id || '', 120);
  const actor = parseOptionActor(option?.actor);
  const source = parseOptionSource(option?.source);

  if (optionId === 'retry_with_fresh_evidence' || (actor === 'openswan' && source === 'checkpoint_guard')) {
    return {
      action: 'retry_with_fresh_evidence',
      safetyMode: 'fresh_evidence_only',
      requiresApproval: true,
      requiresFreshEvidence: true,
      userActionRequired: false,
      allowConnectedAgent: false,
      allowRuntimePatch: false,
      allowBrowserDesktopRetry: true,
      allowSideEffects: false,
      maxAttempts: 1,
      summary: 'Collect fresh browser/desktop/file evidence first, then retry only the bounded failed checkpoint once.',
    };
  }

  if (optionId === 'repair_or_restart_bridge') {
    const userBridgeRepair = actor === 'user';
    return {
      action: 'repair_or_restart_bridge',
      safetyMode: userBridgeRepair ? 'user_unblock' : 'approval_gated_repair',
      requiresApproval: !userBridgeRepair,
      requiresFreshEvidence: false,
      userActionRequired: userBridgeRepair,
      allowConnectedAgent: !userBridgeRepair,
      allowRuntimePatch: !userBridgeRepair,
      allowBrowserDesktopRetry: false,
      allowSideEffects: false,
      maxAttempts: userBridgeRepair ? 0 : 1,
      summary: userBridgeRepair
        ? 'Ask the user to restart or repair the local bridge, then wait for confirmation.'
        : 'Use a connected agent to repair the bridge path, verify bridge health, then stop before retrying the user task.',
    };
  }

  if (optionId === 'let_connected_agent_repair' || actor === 'connected_agent') {
    return {
      action: 'repair_with_connected_agent',
      safetyMode: 'approval_gated_repair',
      requiresApproval: true,
      requiresFreshEvidence: false,
      userActionRequired: false,
      allowConnectedAgent: true,
      allowRuntimePatch: true,
      allowBrowserDesktopRetry: false,
      allowSideEffects: false,
      maxAttempts: 1,
      summary: 'Use a connected code agent for the bounded runtime/app repair; do not retry the user task until the repair is verified.',
    };
  }

  if (optionId === 'resolve_blocker_first' || optionId === 'user_unblock' || actor === 'user') {
    return {
      action: 'request_user_unblock',
      safetyMode: 'user_unblock',
      requiresApproval: false,
      requiresFreshEvidence: false,
      userActionRequired: true,
      allowConnectedAgent: false,
      allowRuntimePatch: false,
      allowBrowserDesktopRetry: false,
      allowSideEffects: false,
      maxAttempts: 0,
      summary: 'Wait for the user to resolve the permission, auth, MFA, CAPTCHA, bridge, or approval blocker before any automated retry.',
    };
  }

  if (optionId === 'switch_route_or_model' || actor === 'llm') {
    return {
      action: 'switch_route_or_model',
      safetyMode: 'route_switch',
      requiresApproval: true,
      requiresFreshEvidence: true,
      userActionRequired: false,
      allowConnectedAgent: false,
      allowRuntimePatch: false,
      allowBrowserDesktopRetry: true,
      allowSideEffects: false,
      maxAttempts: 1,
      summary: 'Switch the model/provider/bridge route, refresh task evidence, then retry only within the original approval boundary.',
    };
  }

  if (optionId === 'stop_and_report' || actor === 'none') {
    return {
      action: 'stop_and_report',
      safetyMode: 'stop',
      requiresApproval: false,
      requiresFreshEvidence: false,
      userActionRequired: false,
      allowConnectedAgent: false,
      allowRuntimePatch: false,
      allowBrowserDesktopRetry: false,
      allowSideEffects: false,
      maxAttempts: 0,
      summary: 'Do not retry or patch anything; show the failure context and recovery details for manual review.',
    };
  }

  return {
    action: 'continue_recovery',
    safetyMode: 'diagnostic_only',
    requiresApproval: true,
    requiresFreshEvidence: false,
    userActionRequired: false,
    allowConnectedAgent: false,
    allowRuntimePatch: false,
    allowBrowserDesktopRetry: false,
    allowSideEffects: false,
    maxAttempts: 1,
    summary: 'Continue recovery as a diagnostic task and require explicit approval before any write, patch, or browser/desktop retry.',
  };
}

function buildFreshEvidencePlan(policy: ChatFailureRecoveryExecutionPolicy): ChatFailureRecoveryExecutionPlan {
  return {
    policy,
    userSummary: 'Collect fresh evidence, then retry the failed step once.',
    nextSteps: [
      'Refresh the relevant browser DOM, desktop accessibility tree, screenshot, file stat, or app state before acting.',
      'Compare the new evidence to the original failure context.',
      'Retry only the bounded failed checkpoint once, then verify proof or stop.',
    ],
    stopConditions: [
      'Required fresh evidence is missing or stale.',
      'The next action would exceed the original approval boundary.',
      'The same checkpoint fails again after the allowed retry.',
    ],
    hiddenInstructions: [
      'Do not reuse stale observations to justify browser, desktop, file, or app actions.',
      `Respect max_attempts=${policy.maxAttempts}; do not start a retry loop.`,
    ],
  };
}

export function buildChatFailureRecoveryExecutionPlan(
  option: RecoveryPolicySource | null | undefined,
): ChatFailureRecoveryExecutionPlan {
  const policy = deriveChatFailureRecoveryExecutionPolicy(option);

  if (policy.action === 'retry_with_fresh_evidence' || policy.action === 'switch_route_or_model') {
    const plan = buildFreshEvidencePlan(policy);
    if (policy.action === 'switch_route_or_model') {
      return {
        ...plan,
        userSummary: 'Switch to a capable route, refresh evidence, then retry once.',
        nextSteps: [
          'Select a provider, model, browser backend, or bridge route that supports the required task.',
          ...plan.nextSteps,
        ].slice(0, 4),
      };
    }
    return plan;
  }

  if (policy.action === 'repair_with_connected_agent') {
    return {
      policy,
      userSummary: 'Use a connected code agent for a bounded repair, then verify before retrying.',
      nextSteps: [
        'Inspect the failing runtime, bridge, planner, or app adapter path.',
        'Patch only the smallest code path needed for the failed task.',
        'Run the focused recovery smoke plus typecheck before retrying the user task.',
      ],
      stopConditions: [
        'The fix requires credentials, MFA, CAPTCHA, or user-only permission.',
        'The needed change is destructive or outside the app/runtime scope.',
        'Verification fails after the bounded repair.',
      ],
      hiddenInstructions: [
        'Do not retry the original browser/desktop action until the repair is verified.',
        'Keep the patch scoped to the failing recovery path and preserve unrelated local work.',
      ],
    };
  }

  if (policy.action === 'repair_or_restart_bridge') {
    return {
      policy,
      userSummary: policy.userActionRequired
        ? 'Wait for the user to repair or restart the bridge.'
        : 'Repair the bridge path, verify health, then stop before retrying.',
      nextSteps: policy.userActionRequired
        ? ['Ask the user to restart, reconnect, or re-authorize the local bridge.', 'Wait for confirmation before continuing.']
        : ['Inspect the bridge contract and local health endpoint.', 'Apply the bounded bridge fix or restart path.', 'Run bridge health verification.'],
      stopConditions: [
        'The bridge needs user-only OS permission or pairing.',
        'The bridge remains unreachable after the allowed repair step.',
      ],
      hiddenInstructions: [
        'Do not perform desktop/browser actions through a bridge that has not passed health verification.',
      ],
    };
  }

  if (policy.action === 'request_user_unblock') {
    return {
      policy,
      userSummary: 'Ask the user to unblock the task before any automated retry.',
      nextSteps: [
        'Explain the specific permission, login, MFA, CAPTCHA, approval, or bridge action needed.',
        'Wait for the user to confirm the blocker is resolved.',
      ],
      stopConditions: [
        'The user has not confirmed the blocker is resolved.',
        'The requested action would bypass auth, MFA, CAPTCHA, or permission boundaries.',
      ],
      hiddenInstructions: [
        'Do not launch a connected agent or retry browser/desktop work while user_action_required is true.',
      ],
    };
  }

  if (policy.action === 'stop_and_report') {
    return {
      policy,
      userSummary: 'Stop and keep the failure details visible for manual review.',
      nextSteps: [
        'Summarize the failed task, failure class, and available recovery options.',
        'Do not retry, patch, or call tools.',
      ],
      stopConditions: [
        'Any automated retry, runtime patch, or external side effect would be required.',
      ],
      hiddenInstructions: [
        'Return a concise diagnostic summary only.',
      ],
    };
  }

  return {
    policy,
    userSummary: 'Continue as a diagnostic recovery task and ask before acting.',
    nextSteps: [
      'Inspect the failure context.',
      'Prepare a bounded repair or retry recommendation.',
      'Ask for approval before any write, patch, browser action, or desktop action.',
    ],
    stopConditions: [
      'The next step is not diagnostic-only.',
      'The task requires user-only auth, MFA, CAPTCHA, credentials, or OS permission.',
    ],
    hiddenInstructions: [
      'Default to diagnostic-only behavior when the recovery option is not recognized.',
    ],
  };
}

export function formatChatFailureRecoveryExecutionPlanForPrompt(
  plan: ChatFailureRecoveryExecutionPlan | null | undefined,
): string {
  if (!plan) return '';
  return [
    `- recovery_user_summary: ${compactSingleLine(plan.userSummary, 260)}`,
    ...plan.nextSteps.slice(0, 5).map((step, index) => `- recovery_step_${index + 1}: ${compactSingleLine(step, 240)}`),
    ...plan.stopConditions.slice(0, 5).map((condition, index) => `- recovery_stop_${index + 1}: ${compactSingleLine(condition, 240)}`),
    ...plan.hiddenInstructions.slice(0, 4).map((instruction, index) => `- recovery_hidden_rule_${index + 1}: ${compactSingleLine(instruction, 260)}`),
  ].join('\n');
}

export function summarizeChatFailureRecoveryOptionForArchive(
  option: RecoveryPolicySource | null | undefined,
): string {
  if (!option) return '';
  const plan = buildChatFailureRecoveryExecutionPlan(option);
  const optionId = compactSingleLine(option.optionId || option.id || 'recovery_option', 80);
  const label = compactSingleLine(option.label || optionId, 120);
  const actor = parseOptionActor(option.actor);
  const badges = [
    plan.policy.safetyMode,
    plan.policy.requiresApproval ? 'approval' : '',
    plan.policy.requiresFreshEvidence ? 'fresh evidence' : '',
    plan.policy.userActionRequired ? 'user step' : '',
    plan.policy.allowConnectedAgent ? 'connected agent' : '',
    plan.policy.allowRuntimePatch ? 'patch' : '',
    plan.policy.maxAttempts > 0 ? `${plan.policy.maxAttempts} try` : 'no retry',
  ].filter(Boolean).join(', ');
  return compactSingleLine(`${option.recommended ? 'recommended: ' : ''}${label} (${actor}; ${badges}) - ${plan.userSummary}`, 360);
}

export function formatChatFailureRecoveryOptionSelection(
  option: ChatFailureRecoveryOption,
  context?: ChatFailureRecoveryOptionSelectionContext | null,
): string {
  return [
    `Use recovery option ${option.id}: ${option.label}.`,
    `Actor: ${option.actor}.`,
    `Source: ${option.source}.`,
    `Recommended: ${option.recommended ? 'yes' : 'no'}.`,
    context?.messageId ? `Context Message Id: ${compactSingleLine(context.messageId, 120)}.` : '',
    context?.runId ? `Context Run Id: ${compactSingleLine(context.runId, 120)}.` : '',
    context?.sourceSurface ? `Context Source Surface: ${compactSingleLine(context.sourceSurface, 160)}.` : '',
    context?.failureExcerpt ? `Failure Excerpt: ${compactSingleLine(context.failureExcerpt, 700)}` : '',
    `Detail: ${option.detail}`,
  ].filter(Boolean).join('\n');
}

export function parseChatFailureRecoveryOptionSelection(message: string): ChatFailureRecoveryOptionSelection | null {
  const text = clean(message, 2_400);
  if (!text) return null;
  const optionMatch = text.match(/\buse\s+recovery\s+option\s+([a-z0-9_-]{2,80})\s*:\s*([^\n.]{1,180})\.?/i);
  if (!optionMatch) return null;
  const field = (name: string) => {
    const re = new RegExp(`^${name}:\\s*(.+)$`, 'im');
    return clean(text.match(re)?.[1] || '', 600);
  };
  return {
    optionId: optionMatch[1],
    label: clean(optionMatch[2], 180) || optionMatch[1],
    detail: field('Detail'),
    actor: parseOptionActor(field('Actor')),
    source: parseOptionSource(field('Source')),
    recommended: /^yes\b/i.test(field('Recommended')),
    context: {
      messageId: field('Context Message Id').replace(/[.;,\s]+$/g, '') || null,
      runId: field('Context Run Id').replace(/[.;,\s]+$/g, '') || null,
      sourceSurface: field('Context Source Surface').replace(/[.;,\s]+$/g, '') || null,
      failureExcerpt: field('Failure Excerpt') || null,
    },
  };
}

export function formatChatFailureRecoveryOptionSelectionForPrompt(
  selection: ChatFailureRecoveryOptionSelection | null | undefined,
): string {
  if (!selection) return '';
  const executionPlan = buildChatFailureRecoveryExecutionPlan(selection);
  const policy = executionPlan.policy;
  return [
    '## Selected Failure Recovery Option',
    'The user selected a recovery option from a previous failed chat/browser/desktop task. Treat this as a continuation of that failed task, not as a brand-new request.',
    `- option_id: ${compactSingleLine(selection.optionId, 100)}`,
    `- label: ${compactSingleLine(selection.label, 160)}`,
    `- actor: ${selection.actor}`,
    `- source: ${selection.source}`,
    `- recommended: ${selection.recommended ? 'yes' : 'no'}`,
    `- recovery_action: ${policy.action}`,
    `- safety_mode: ${policy.safetyMode}`,
    `- requires_approval: ${policy.requiresApproval ? 'yes' : 'no'}`,
    `- requires_fresh_evidence: ${policy.requiresFreshEvidence ? 'yes' : 'no'}`,
    `- user_action_required: ${policy.userActionRequired ? 'yes' : 'no'}`,
    `- allow_connected_agent: ${policy.allowConnectedAgent ? 'yes' : 'no'}`,
    `- allow_runtime_patch: ${policy.allowRuntimePatch ? 'yes' : 'no'}`,
    `- allow_browser_desktop_retry: ${policy.allowBrowserDesktopRetry ? 'yes' : 'no'}`,
    `- max_attempts: ${policy.maxAttempts}`,
    selection.context?.messageId ? `- failed_message_id: ${compactSingleLine(selection.context.messageId, 120)}` : '',
    selection.context?.runId ? `- run_id: ${compactSingleLine(selection.context.runId, 120)}` : '',
    selection.context?.sourceSurface ? `- source_surface: ${compactSingleLine(selection.context.sourceSurface, 160)}` : '',
    selection.context?.failureExcerpt ? `- failure_excerpt: ${compactSingleLine(selection.context.failureExcerpt, 700)}` : '',
    selection.detail ? `- selected_detail: ${compactSingleLine(selection.detail, 700)}` : '',
    `- policy_summary: ${policy.summary}`,
    formatChatFailureRecoveryExecutionPlanForPrompt(executionPlan),
    'Rules: use the selected option, treat the recovery policy fields as hard constraints, preserve the original guardrails, do not repeat blind browser/desktop actions without fresh evidence, and ask for user action when user_action_required is yes.',
  ].filter(Boolean).join('\n');
}

function normalizeFingerprintPart(value: unknown, max = 800): string {
  return clean(value, max)
    .toLowerCase()
    .replace(/[a-f0-9]{8}-[a-f0-9-]{13,}/gi, '<id>')
    .replace(/\b[a-f0-9]{24,}\b/gi, '<id>')
    .replace(/\b\d{4,}\b/g, '<num>')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function buildChatFailureRecoveryFingerprint(input: ChatFailureRecoveryInput): string {
  if (input.recoveryFingerprint) return clean(input.recoveryFingerprint, 120);
  const source = normalizeFingerprintPart(input.source || 'main_chat_failure', 160);
  const executionKind = normalizeFingerprintPart(input.executionKind || 'run_openswan', 160);
  const task = normalizeFingerprintPart(input.task || 'Recover failed chat task', 500);
  const failure = normalizeFingerprintPart(input.failureMessage || 'Unknown chat failure', 900);
  return `chat-recovery:${hashString([source, executionKind, task, failure].join('|'))}`;
}

export function shouldSuppressDuplicateChatFailureHandoff(state: ChatFailureRecoveryRepeatState): boolean {
  if (!state.recentRepeat || state.repeatCount <= 1 || !state.lastSuccessfulHandoffAt) return false;
  return state.nowMs - state.lastSuccessfulHandoffAt <= state.repeatWindowMs;
}

function addUnique(target: string[], values: string[]) {
  for (const value of values) {
    const cleanValue = clean(value, 240);
    if (cleanValue && !target.includes(cleanValue)) target.push(cleanValue);
  }
}

function shouldInferComputerRouteForRecovery(input: ChatFailureRecoveryInput): boolean {
  if (input.evidenceContract) return false;
  const text = [
    input.task,
    input.failureMessage,
    input.executionKind,
    input.source,
    input.planSummary,
    input.groundingSummary,
    input.preflightSummary,
  ].map((value) => clean(value, 1_000).toLowerCase()).join('\n');
  return /\b(run_computer_task|computer_use|computer-use|computer task|use computer|browser_computer_use|desktop|browser|bridge|local file|file adapter|app task|photoshop|indesign|illustrator|adobe|autocad|cad|revit|solidworks|fusion\s*360|matlab|simulink|simscape|rhino|open this file|uploaded file)\b/i.test(text);
}

function computerRouteInferenceCandidates(input: ChatFailureRecoveryInput): string[] {
  const task = clean(input.task, 1_000);
  if (!task) return [];
  const context = [
    input.failureMessage,
    input.executionKind,
    input.source,
    input.planSummary,
    input.groundingSummary,
    input.preflightSummary,
  ].map((value) => clean(value, 1_000).toLowerCase()).join('\n');
  const candidates = [task];
  if (/\b(browser_computer_use|computer_use|computer-use|browser|browserbase|stagehand|dom|aria|locator|selector|url|page|tab)\b/i.test(context)) {
    candidates.push(`Browser computer use task: ${task}`);
  }
  if (/\b(local file|file adapter|file_task|file search|file read|file write|download|upload|folder|path)\b/i.test(context)) {
    candidates.push(`Local file computer task: ${task}`);
  }
  if (/\b(desktop|desktop_app|app task|app_adapter|bridge|window|a11y|accessibility|photoshop|indesign|illustrator|adobe|autocad|cad|revit|solidworks|fusion\s*360|matlab|simulink|simscape|rhino)\b/i.test(context)) {
    candidates.push(`Desktop app computer task: ${task}`);
  }
  if (/\brun_computer_task|computer task|use computer\b/i.test(context)) {
    candidates.push(`Use computer task: ${task}`);
  }
  return unique(candidates).slice(0, 5);
}

function inferComputerRequestRouteForRecovery(input: ChatFailureRecoveryInput): ChatComputerRequestRoute | null {
  if (!shouldInferComputerRouteForRecovery(input)) return null;
  for (const candidate of computerRouteInferenceCandidates(input)) {
    const route = buildChatComputerRequestRoute(candidate);
    if (route) return route;
  }
  return null;
}

function resolveEvidenceRecovery(input: ChatFailureRecoveryInput): ComputerTaskEvidenceRecoveryContext | null {
  if (input.evidenceRecovery) return input.evidenceRecovery;
  const inferredRoute = inferComputerRequestRouteForRecovery(input);
  return diagnoseComputerTaskEvidenceFailure({
    contract: input.evidenceContract || inferredRoute?.evidenceContract || null,
    appRouteDecision: input.appRouteDecision || inferredRoute?.appAutomationRouteDecision || null,
    // AR: name the user's app + the structured launchable fallback so an
    // unavailable-app failure becomes switch-and-retry, not a dead-end. Prefer
    // explicit input (the live route had it); fall back to the inferred route.
    namedAppIntent: input.namedAppIntent ?? inferredRoute?.appResolution?.namedAppIntent ?? null,
    appFallback: input.appFallback ?? inferredRoute?.appResolution?.recoveryFallback ?? null,
    // Unfamiliar-app failures get research-first buildout guidance (self-gating:
    // null for non-app tasks, so browser/file/Adobe recovery is unchanged).
    appAdapterGap: buildAppAdapterGapPlan(input.task || '')?.contract || null,
    task: input.task,
    failureMessage: input.failureMessage,
    outcomeStatus: input.outcomeStatus,
    source: input.source,
    planSummary: input.planSummary,
    groundingSummary: input.groundingSummary,
    preflightSummary: input.preflightSummary,
    // QW4: real fresh-evidence gating — the harvested loop observations decide
    // evidenceReadiness.ready. Missing/absent → advisory (never blocks).
    observations: Array.isArray(input.observations) ? input.observations : [],
    replayPolicy: input.replayPolicy || null,
    mutationDispatched: input.mutationDispatched === true,
    verificationOnlyTools: input.verificationOnlyTools || [],
  });
}

export function buildChatFailureRecoveryVerificationPlan(input: ChatFailureRecoveryInput): ChatFailureRecoveryVerificationPlan {
  const evidenceRecovery = resolveEvidenceRecovery(input);
  const checkpointRecoveryText = input.checkpointRecovery
    ? formatComputerTaskCheckpointRecoveryForPrompt(input.checkpointRecovery)
    : '';
  const contextText = [
    input.task,
    input.source,
    input.executionKind,
    input.failureMessage,
    input.planSummary,
    input.groundingSummary,
    input.preflightSummary,
    checkpointRecoveryText,
  ].map((value) => clean(value, 1_000).toLowerCase()).join('\n');
  const formattedEvidenceRecovery = evidenceRecovery
    ? formatComputerTaskEvidenceRecoveryForPrompt(evidenceRecovery) || ''
    : '';
  const evidenceText = formattedEvidenceRecovery.toLowerCase();
  const evidenceKind = evidenceRecovery?.kind || null;
  const browserSurface = evidenceKind
    ? evidenceKind === 'browser' || evidenceKind === 'hybrid'
    : /\b(browser_computer_use|computer_use|computer-use|browser|browserbase|stagehand|dom|aria|locator|selector|url|page|tab)\b/.test(contextText);
  const desktopSurface = evidenceKind
    ? evidenceKind === 'desktop_app' || evidenceKind === 'hybrid'
    : /\b(desktop|desktop_app|app task|app_adapter|bridge|window|a11y|accessibility|photoshop|indesign|illustrator|adobe|autocad|cad|revit|solidworks|fusion\s*360|matlab|simulink|simscape|rhino|terminal)\b/.test(contextText);
  const localFileSurface = evidenceKind
    ? evidenceKind === 'local_file'
    : /\b(local file|file adapter|file_task|file search|file read|file write|download|upload|folder|path|scoped path)\b/.test(contextText);
  const commands = ['npm run smoke:chat-failure-recovery'];
  const checks = [
    'Confirm the failed chat branch shows the raw error and recovery handoff in the visible assistant message.',
    'Confirm the session archive records fingerprint, failure class, source, repeat count, and recovery status.',
  ];
  const complexRecovery = evidenceKind === 'hybrid'
    || /complex|multi[- ]step|workflow|pipeline|end[- ]to[- ]end|checkpoint|then|phase|multi-agent/.test(contextText);

  if (/openswan|run_openswan|main_chat/.test(contextText)) {
    addUnique(commands, ['npm run smoke:openswan-task-planner', 'npm run smoke:openswan-runtime-approval']);
    addUnique(checks, ['Confirm OpenSwan task planning, approval gating, and batch fallback still route through the intended runtime path.']);
  }
  if (desktopSurface) {
    addUnique(commands, ['npm run smoke:desktop-runtime-wiring', 'npm run smoke:desktop-bridge', 'npm run smoke:bridge-health-diag', 'npm run smoke:terminal-agent-launch']);
    addUnique(checks, ['Confirm desktop bridge auth, CORS, token pairing, and terminal-agent routing are intact.']);
  }
  if (desktopSurface && evidenceRecovery) {
    addUnique(commands, ['npm run smoke:computer-app-preflight', 'npm run smoke:computer-app-grounding', 'npm run smoke:computer-app-execution-receipts']);
    addUnique(checks, ['Confirm desktop/app recovery preserves app identity, active document grounding, preflight blockers, and execution receipts.']);
  }
  if (browserSurface) {
    addUnique(commands, ['npm run smoke:browser-bridge', 'npm run smoke:computer-task-runtime', 'npm run smoke:computer-use-backend', 'npm run smoke:computer-task-execution-grounding']);
    addUnique(checks, ['Confirm browser/computer-use retries require fresh DOM, screenshot, or grounding before side-effect actions.']);
  }
  if (localFileSurface) {
    addUnique(commands, ['npm run smoke:computer-task-runtime', 'npm run smoke:computer-grant-gate', 'npm run smoke:chat-desktop-attachment-routing']);
    addUnique(checks, ['Confirm local-file recovery uses scoped grants, bounded file search/read evidence, and proof or explicit path blockers.']);
  }
  if (/provider|model|openrouter|web search|fallback|rate|hugging|hf|github|wordpress|vault/.test(contextText)) {
    addUnique(commands, ['npm run smoke:cross-provider-router', 'npm run smoke:fallback-chain', 'npm run smoke:web-search-auto-detect', 'npm run smoke:user-task-pipelines']);
    addUnique(checks, ['Confirm provider fallback, web-search routing, and vault-backed command routing preserve user-key and permission requirements.']);
  }
  if (/memory|remember|forget|reasoning/.test(contextText)) {
    addUnique(commands, ['npm run smoke:memory-bank', 'npm run smoke:user-memory-caps', 'npm run smoke:persisted-chat-metadata']);
    addUnique(checks, ['Confirm memory writes remain scoped, persisted metadata survives reload, and user memory caps still apply.']);
  }
  if (/schedule|cron|automation/.test(contextText)) {
    addUnique(commands, ['npm run smoke:automation-builder', 'npm run smoke:user-task-pipelines']);
    addUnique(checks, ['Confirm scheduled action parsing and automation proposals still require explicit user approval for side effects.']);
  }
  if (/mission|summary|room|assign|multi-agent|agent plan/.test(contextText)) {
    addUnique(commands, ['npm run smoke:multi-agent-dispatch', 'npm run smoke:agent-plan-mode', 'npm run smoke:delegation-gate', 'npm run smoke:user-task-pipelines']);
    addUnique(checks, ['Confirm agent dispatch, plan-mode gating, and mission/room command surfaces still produce auditable task state.']);
  }
  if (complexRecovery) {
    addUnique(commands, ['npm run smoke:agent-plan-mode', 'npm run smoke:multi-agent-dispatch', 'npm run smoke:agent-pipeline-evals']);
    addUnique(checks, ['Confirm complex recovery is decomposed into independently verifiable subtasks with checkpoint evidence before side-effect retries.']);
  }
  if (input.checkpointRecovery) {
    addUnique(commands, ['npm run smoke:computer-task-complexity', 'npm run smoke:computer-task-execution-grounding']);
    addUnique(checks, ['Confirm recovery names the failed computer-task checkpoint and retries only the bounded safe next step.']);
  }
  if (evidenceRecovery) {
    addUnique(commands, ['npm run smoke:computer-task-evidence-contract', 'npm run smoke:computer-task-evidence-recovery', 'npm run smoke:chat-computer-handoff-context', 'npm run smoke:persisted-chat-metadata']);
    addUnique(checks, ['Confirm recovery uses the route evidence contract for fresh evidence, approval boundaries, proof-after checks, and fail-closed blockers.']);
  }
  if (evidenceRecovery && /photoshop|indesign|design app|adobe/i.test(`${evidenceRecovery.targetName} ${evidenceRecovery.taskFamily} ${evidenceText}`)) {
    addUnique(commands, ['npm run smoke:design-app-execution-pipeline', 'npm run smoke:design-app-proof-review']);
    addUnique(checks, ['Confirm Photoshop/InDesign recovery preserves app-native inventory, proof artifact, and adapter-buildout requirements.']);
  }

  const priorityCommands: string[] = ['npm run smoke:chat-failure-recovery'];
  if (input.checkpointRecovery) addUnique(priorityCommands, ['npm run smoke:computer-task-complexity', 'npm run smoke:computer-task-execution-grounding']);
  if (/openswan|run_openswan|main_chat/.test(contextText)) {
    addUnique(priorityCommands, ['npm run smoke:openswan-task-planner', 'npm run smoke:openswan-runtime-approval']);
  }
  if (desktopSurface) {
    addUnique(priorityCommands, ['npm run smoke:desktop-runtime-wiring', 'npm run smoke:desktop-bridge']);
  }
  if (browserSurface) {
    addUnique(priorityCommands, ['npm run smoke:browser-bridge', 'npm run smoke:computer-task-runtime']);
  }
  if (localFileSurface) {
    addUnique(priorityCommands, ['npm run smoke:computer-task-runtime', 'npm run smoke:computer-grant-gate']);
  }
  if (complexRecovery) addUnique(priorityCommands, ['npm run smoke:agent-plan-mode', 'npm run smoke:multi-agent-dispatch', 'npm run smoke:agent-pipeline-evals']);
  if (evidenceRecovery) addUnique(priorityCommands, ['npm run smoke:computer-task-evidence-contract', 'npm run smoke:computer-task-evidence-recovery']);
  const cappedCommands = priorityCommands.slice(0, 8);
  for (const command of commands) {
    if (cappedCommands.length >= 8) break;
    addUnique(cappedCommands, [command]);
  }
  addUnique(cappedCommands, ['npm run typecheck', 'git diff --check']);
  const priorityChecks = complexRecovery
    ? ['Confirm complex recovery is decomposed into independently verifiable subtasks with checkpoint evidence before side-effect retries.']
    : [];
  for (const check of checks) {
    if (priorityChecks.length >= 8) break;
    addUnique(priorityChecks, [check]);
  }
  return {
    commands: cappedCommands.slice(0, 10),
    checks: priorityChecks.slice(0, 8),
  };
}

export function buildChatFailureRecoveryInput(input: ChatFailureRecoveryInput): AgentFailureRecoveryInput {
  const fingerprint = buildChatFailureRecoveryFingerprint(input);
  const verificationPlan = buildChatFailureRecoveryVerificationPlan(input);
  const evidenceRecovery = resolveEvidenceRecovery(input);
  // Facts stay bare; instructional/advisory wording is sentinel-wrapped so
  // the policy's classifier strips it (guardrail lines like "human
  // verification … requires user action" self-trigger the taxonomy and
  // turned a 429 rate-limit into human_verification_required). The full
  // block still reaches the recovery agent's prompt verbatim.
  const contextLines = [
    input.planSummary ? clean(input.planSummary, 2_000) : '',
    input.selectedModel ? `Selected chat model: ${input.selectedModel}` : '',
    input.activePluginIds && input.activePluginIds.length > 0
      ? `Active plugins: ${input.activePluginIds.slice(0, 12).join(', ')}`
      : '',
    input.repeatCount && input.repeatCount > 1 ? `Recent repeat count: ${input.repeatCount}` : '',
    RECOVERY_ADVISORY_BEGIN,
    input.checkpointRecovery ? formatComputerTaskCheckpointRecoveryForPrompt(input.checkpointRecovery) : '',
    evidenceRecovery ? formatComputerTaskEvidenceRecoveryForPrompt(evidenceRecovery) : '',
    `Recovery fingerprint: ${fingerprint}`,
    input.suppressConnectedHandoff
      ? `Connected recovery handoff suppressed: ${clean(input.suppressionReason || 'recent duplicate failure', 400)}`
      : '',
    'Suggested verification commands:',
    ...verificationPlan.commands.map((command) => `- ${command}`),
    'Suggested verification checks:',
    ...verificationPlan.checks.map((check) => `- ${check}`),
    RECOVERY_ADVISORY_END,
  ].filter(Boolean).join('\n');

  return {
    task: clean(input.task, 2_000) || 'Recover failed chat task',
    failureMessage: clean(input.failureMessage) || 'Unknown chat failure',
    failureStack: input.failureStack ? clean(input.failureStack, 4_000) : null,
    outcomeStatus: clean(input.outcomeStatus || 'failed', 200),
    executionKind: clean(input.executionKind || 'run_openswan', 200),
    runId: clean(input.runId, 240) || null,
    planSummary: contextLines || null,
    groundingSummary: input.groundingSummary ? clean(input.groundingSummary, 2_000) : null,
    preflightSummary: input.preflightSummary ? clean(input.preflightSummary, 2_000) : null,
    source: clean(input.source || 'main_chat_failure', 240),
    sessionId: clean(input.sessionId, 240) || undefined,
    launchIfMissing: input.launchIfMissing,
    approveConnectedAgentLaunch: input.approveConnectedAgentLaunch === true,
    circleId: input.circleId,
    userId: input.userId,
  };
}

function selectActionableRunbookStep(runbook?: AgentFailureRecoveryRunbook): string | null {
  if (!runbook?.steps?.length) return null;
  const step = runbook.steps.find((candidate) => (
    candidate.required
    && (runbook.nextActor === 'user'
      ? candidate.kind === 'ask_user' || candidate.kind === 'stop'
      : candidate.kind !== 'inspect')
  )) || runbook.steps[0];
  return clean(step.title, 120) || null;
}

function addRecoveryOption(target: ChatFailureRecoveryOption[], option: ChatFailureRecoveryOption) {
  if (!option.id || target.some((item) => item.id === option.id)) return;
  target.push({
    ...option,
    label: clean(option.label, 90),
    detail: clean(option.detail, 260),
  });
}

function normalizeEvidenceRecoveryFields(context?: ComputerTaskEvidenceRecoveryContext | null): {
  failureArea: string;
  requiredFreshEvidence: string[];
  recommendedOptionId: ComputerTaskEvidenceRecoveryContext['recommendedOptionId'];
  resumeInstruction: string;
} {
  const recommended = context?.recommendedOptionId;
  return {
    failureArea: clean(context?.failureArea || 'evidence_contract', 80),
    requiredFreshEvidence: Array.isArray(context?.requiredFreshEvidence)
      ? context.requiredFreshEvidence.map((item) => clean(item, 160)).filter(Boolean).slice(0, 6)
      : [],
    recommendedOptionId: recommended === 'retry_with_fresh_evidence'
      || recommended === 'resolve_contract_blocker'
      || recommended === 'let_connected_agent_repair'
      || recommended === 'stop_and_report'
      ? recommended
      : 'stop_and_report',
    resumeInstruction: clean(
      context?.resumeInstruction || 'Refresh required evidence before retrying, or stop and report the blocker.',
      260,
    ),
  };
}

function buildRecoveryReliabilitySummary(args: {
  evidenceRecovery?: ComputerTaskEvidenceRecoveryContext | null;
  recoveryOptions?: ChatFailureRecoveryOption[];
  verificationPlan: ChatFailureRecoveryVerificationPlan;
}): ChatFailureRecoveryReliabilitySummary {
  const recovery = args.evidenceRecovery || null;
  const recommendedOption = (args.recoveryOptions || []).find((option) => option.recommended)
    || (args.recoveryOptions || [])[0]
    || null;
  return {
    surfaceKind: recovery?.kind || null,
    targetName: recovery ? clean(recovery.targetName, 120) || null : null,
    taskFamily: recovery ? clean(recovery.taskFamily, 120) || null : null,
    failureArea: recovery?.failureArea || null,
    retryAllowed: recovery?.retryAllowed === true,
    userActionRequired: recovery?.userActionRequired === true,
    connectedAgentAllowed: recovery?.connectedAgentAllowed === true,
    recommendedOptionId: recovery?.recommendedOptionId || null,
    readinessStatus: recovery?.evidenceReadiness?.status || null,
    nextEvidenceTools: unique(recovery?.evidenceReadiness?.nextEvidenceTools || [], 8),
    requiredEvidenceTools: unique((recovery?.requiredEvidence || []).filter((item) => item.required).map((item) => item.tool), 8),
    requiredFreshEvidence: unique(recovery?.requiredFreshEvidence || [], 6),
    requiredProof: unique(recovery?.requiredProof || [], 5),
    approvalBoundaries: unique(recovery?.approvalBoundaries || [], 5),
    failClosedRules: unique(recovery?.failClosedRules || [], 5),
    routeDecisionStatus: recovery?.appRouteDecision?.status || null,
    routeDecisionSurface: recovery?.appRouteDecision?.chosenSurfaceLabel
      ? clean(recovery.appRouteDecision.chosenSurfaceLabel, 140)
      : null,
    selectedRecoveryOptionId: recommendedOption?.id || null,
    verificationCommands: args.verificationPlan.commands.slice(0, 10),
  };
}

export function buildChatFailureRecoveryOptions(
  input: ChatFailureRecoveryInput,
  recovery: AgentFailureRecoveryStartResult,
): ChatFailureRecoveryOption[] {
  const options: ChatFailureRecoveryOption[] = [];
  const checkpoint = input.checkpointRecovery || null;
  const checkpointPolicy = checkpoint?.retryPolicy || null;
  const evidenceRecovery = resolveEvidenceRecovery(input);
  const evidenceFields = normalizeEvidenceRecoveryFields(evidenceRecovery);
  const nextRunbookStep = selectActionableRunbookStep(recovery.runbook);
  const needsUser = recovery.runbook?.nextActor === 'user' || recovery.runbook?.userActionRequired || recovery.assessment?.userActionRequired;
  const connectedAgentName = clean(recovery.displayName || recovery.provider || 'connected agent', 80);

  if (checkpointPolicy?.canRetry) {
    const tools = checkpointPolicy.requiredEvidence
      ?.filter((item) => item.required)
      .map((item) => item.tool)
      .slice(0, 4)
      .join(', ');
    addRecoveryOption(options, {
      id: 'retry_with_fresh_evidence',
      label: 'Retry after fresh evidence',
      detail: tools
        ? `Collect ${tools}, then retry only ${checkpoint?.failedCheckpointId || 'the failed checkpoint'} once.`
        : checkpointPolicy.resumeInstruction || checkpointPolicy.nextAction,
      actor: 'openswan',
      recommended: recovery.runbook?.nextActor === 'openswan' || recovery.recoveryAction === 'retry_with_grounding',
      source: 'checkpoint_guard',
    });
  } else if (checkpointPolicy?.stopReason) {
    addRecoveryOption(options, {
      id: 'resolve_blocker_first',
      label: 'Resolve the blocker first',
      detail: checkpointPolicy.stopReason,
      actor: 'user',
      recommended: needsUser,
      source: 'checkpoint_guard',
    });
  }

  if (evidenceRecovery?.retryAllowed) {
    addRecoveryOption(options, {
      id: 'retry_with_fresh_evidence',
      label: 'Retry with required evidence',
      detail: evidenceFields.requiredFreshEvidence.length
        ? `Refresh ${evidenceFields.requiredFreshEvidence.slice(0, 3).join(', ')}, then retry only the failed ${evidenceFields.failureArea} step once.`
        : evidenceFields.resumeInstruction,
      actor: 'openswan',
      recommended: evidenceFields.recommendedOptionId === 'retry_with_fresh_evidence' && !checkpointPolicy,
      source: 'evidence_contract',
    });
  } else if (evidenceRecovery?.userActionRequired) {
    addRecoveryOption(options, {
      id: 'resolve_contract_blocker',
      label: 'Resolve the contract blocker',
      detail: evidenceFields.resumeInstruction,
      actor: 'user',
      recommended: evidenceFields.recommendedOptionId === 'resolve_contract_blocker',
      source: 'evidence_contract',
    });
  }

  if (evidenceRecovery?.connectedAgentAllowed) {
    addRecoveryOption(options, {
      id: 'let_connected_agent_repair',
      label: `Let ${connectedAgentName} build the missing capability`,
      detail: recovery.ok
        ? `Continue the launched recovery session${recovery.sessionId ? ` (${recovery.sessionId})` : ''}. ${evidenceFields.resumeInstruction}`
        : evidenceFields.resumeInstruction,
      actor: 'connected_agent',
      recommended: evidenceFields.recommendedOptionId === 'let_connected_agent_repair',
      source: 'evidence_contract',
    });
  }

  if (recovery.ok || recovery.launched || recovery.runbook?.nextActor === 'connected_agent') {
    addRecoveryOption(options, {
      id: 'let_connected_agent_repair',
      label: `Let ${connectedAgentName} repair it`,
      detail: recovery.ok
        ? `Continue the launched recovery session${recovery.sessionId ? ` (${recovery.sessionId})` : ''} and apply only the bounded fix.`
        : 'Launch a connected recovery agent such as Codex or Claude Code to diagnose the app/runtime issue and propose the bounded fix.',
      actor: 'connected_agent',
      recommended: recovery.ok || recovery.runbook?.nextActor === 'connected_agent',
      source: 'connected_agent_runbook',
    });
  }

  if (needsUser || recovery.recoveryAction === 'request_user_action') {
    addRecoveryOption(options, {
      id: 'user_unblock',
      label: 'I will unblock it',
      detail: nextRunbookStep || recovery.assessment?.recommendedRecovery || 'Complete the required permission, login, MFA, CAPTCHA, bridge restart, or approval, then retry.',
      actor: 'user',
      recommended: true,
      source: 'recovery_policy',
    });
  }

  if (recovery.recoveryAction === 'switch_route_or_model') {
    addRecoveryOption(options, {
      id: 'switch_route_or_model',
      label: 'Try another route',
      detail: 'Switch to a provider, browser backend, bridge, or model that supports the required tool mode and user-key policy.',
      actor: 'llm',
      recommended: recovery.runbook?.nextActor === 'openswan',
      source: 'recovery_policy',
    });
  }

  if (recovery.recoveryAction === 'restart_or_update_bridge') {
    addRecoveryOption(options, {
      id: 'repair_or_restart_bridge',
      label: 'Repair the bridge path',
      detail: 'Check the desktop/browser bridge contract, restart the bridge if needed, then run the relevant bridge health smoke.',
      actor: recovery.runbook?.nextActor === 'user' ? 'user' : 'connected_agent',
      recommended: recovery.runbook?.nextActor !== 'none',
      source: 'recovery_policy',
    });
  }

  addRecoveryOption(options, {
    id: 'stop_and_report',
    label: 'Stop and show details',
    detail: 'Do not retry. Keep the failure, checkpoint, and recovery plan visible for manual review.',
    actor: 'none',
    recommended: options.length === 0,
    source: 'safety_stop',
  });

  if (!options.some((option) => option.recommended) && options[0]) {
    options[0] = { ...options[0], recommended: true };
  }
  return options.slice(0, 5);
}

function formatRecoveryOptions(options: ChatFailureRecoveryOption[]): string {
  if (options.length === 0) return '';
  return [
    'Options:',
    ...options.map((option, index) => (
      `${index + 1}. ${option.recommended ? '[recommended] ' : ''}${option.label} - ${option.detail}`
    )),
  ].join('\n');
}

export function stripChatFailureRecoveryOptionsText(message: string): string {
  const text = clean(message, 20_000);
  if (!text) return '';
  return text
    .replace(/\n{2,}Options:\n(?:\d+\.\s+[^\n]*(?:\n|$)){1,8}\s*$/i, '')
    .trimEnd();
}

export function formatChatFailureRecoveryUserMessage(
  input: ChatFailureRecoveryInput,
  recovery: AgentFailureRecoveryStartResult,
): string {
  // TERSE BY DESIGN (user feedback: "just do the task — don't dump so much
  // info about why it couldn't"). The chat bubble gets only a one-line reason
  // plus the single next action. The full classification / runbook /
  // checkpoint / evidence diagnosis is preserved in the failure-recovery
  // ARCHIVE metadata (buildChatFailureRecoveryArchive), and the actionable
  // recovery choices render as interactive option cards — so none of that
  // detail needs to crowd the message. `formatChatFailureRecoveryDetail`
  // below remains for debug/archive surfaces that want the full breakdown.
  const reason = clean(
    (clean(input.failureMessage, 700) || 'the task could not be completed')
      .split('\n').map((l) => l.trim()).find(Boolean) || 'the task could not be completed',
    180,
  );
  if (recovery.ok) {
    return `Couldn't finish: ${reason}\n${clean(recovery.message, 160) || 'Working on a fix.'}`;
  }
  const nextStep = selectActionableRunbookStep(recovery.runbook);
  const next = nextStep
    ? `Next: ${clean(nextStep, 160)} — or pick a recovery option below.`
    : 'Pick a recovery option below, or rephrase the task.';
  return `Couldn't finish: ${reason}\n${next}`;
}

/**
 * The full, detailed failure-recovery breakdown (former chat message). Kept
 * for archive/debug surfaces; the chat bubble uses the terse version above.
 */
export function formatChatFailureRecoveryDetail(
  input: ChatFailureRecoveryInput,
  recovery: AgentFailureRecoveryStartResult,
): string {
  const failureText = clean(input.failureMessage, 700) || 'Unknown error';
  const actionText = recovery.recoveryAction ? ` Recovery action: \`${recovery.recoveryAction}\`.` : '';
  const classText = recovery.assessment?.failureClass ? ` Classified as \`${recovery.assessment.failureClass}\`.` : '';
  const repeatText = input.repeatCount && input.repeatCount > 1
    ? ` Repeat count: ${input.repeatCount}.`
    : '';
  const nextStep = selectActionableRunbookStep(recovery.runbook);
  const runbookText = recovery.runbook?.nextActor
    ? ` Next actor: \`${recovery.runbook.nextActor}\`.${nextStep ? ` Next step: ${nextStep}.` : ''}`
    : '';
  const complexityText = recovery.runbook?.complexity?.level && recovery.runbook.complexity.level !== 'single_step'
    ? ` Complexity: \`${recovery.runbook.complexity.level}\`; coordination: \`${recovery.runbook.coordinationMode}\`.`
    : '';
  const suppressText = input.suppressConnectedHandoff
    ? ` Duplicate handoff suppressed: ${clean(input.suppressionReason || 'recent matching failure', 260)}.`
    : '';
  const checkpointText = input.checkpointRecovery
    ? [
        ` Failed checkpoint: \`${input.checkpointRecovery.failedCheckpointId}\` (${clean(input.checkpointRecovery.failedCheckpointLabel, 120)}).`,
        `Next guarded step: ${clean(input.checkpointRecovery.retryPolicy?.nextAction || input.checkpointRecovery.safeNextStep, 220)}.`,
        input.checkpointRecovery.retryPolicy?.canRetry === false && input.checkpointRecovery.retryPolicy.stopReason
          ? `Retry blocked: ${clean(input.checkpointRecovery.retryPolicy.stopReason, 220)}.`
          : '',
      ].filter(Boolean).join(' ')
    : '';
  const evidenceRecovery = resolveEvidenceRecovery(input);
  const evidenceFields = normalizeEvidenceRecoveryFields(evidenceRecovery);
  const evidenceText = evidenceRecovery
    ? ` Evidence contract: ${clean(evidenceRecovery.targetName, 100)} ${evidenceFields.failureArea}; ${evidenceFields.resumeInstruction}`
    : '';
  const handoffText = recovery.ok
    ? `Connected agent recovery started. ${recovery.message}`
    : `Connected agent recovery did not launch. ${recovery.message}`;
  const optionsText = formatRecoveryOptions(buildChatFailureRecoveryOptions(input, recovery));

  return [
    `The chat task failed: ${failureText}`,
    `Chat failure recovery: ${handoffText}${classText}${actionText}${runbookText}${checkpointText}${evidenceText}${complexityText}${repeatText}${suppressText}`,
    optionsText,
  ].join('\n\n');
}

export function buildChatFailureRecoveryArchive(
  input: ChatFailureRecoveryInput,
  recovery: AgentFailureRecoveryStartResult,
): Pick<ChatFailureRecoveryResult, 'archiveSummary' | 'archiveTouched' | 'archiveMetadata'> {
  const fingerprint = buildChatFailureRecoveryFingerprint(input);
  const verificationPlan = buildChatFailureRecoveryVerificationPlan(input);
  const recoveryOptions = buildChatFailureRecoveryOptions(input, recovery);
  const evidenceRecovery = resolveEvidenceRecovery(input);
  const reliabilitySummary = buildRecoveryReliabilitySummary({
    evidenceRecovery,
    recoveryOptions,
    verificationPlan,
  });
  return {
    archiveSummary: `Chat failure recovery ${recovery.ok ? 'delegated' : input.suppressConnectedHandoff ? 'suppressed' : 'not delegated'}: ${clean(input.task, 180) || 'unknown task'}`,
    archiveTouched: unique([
      'surface:main_chat',
      'surface:failure_recovery',
      input.executionKind ? `execution:${input.executionKind}` : 'execution:run_openswan',
      input.source ? `source:${input.source}` : null,
      recovery.assessment?.surface ? `failure_surface:${recovery.assessment.surface}` : null,
      reliabilitySummary.surfaceKind ? `recovery_surface:${reliabilitySummary.surfaceKind}` : null,
      reliabilitySummary.failureArea ? `recovery_failure:${reliabilitySummary.failureArea}` : null,
      reliabilitySummary.readinessStatus ? `recovery_readiness:${reliabilitySummary.readinessStatus}` : null,
      reliabilitySummary.selectedRecoveryOptionId ? `recovery_option:${reliabilitySummary.selectedRecoveryOptionId}` : null,
      ...reliabilitySummary.requiredEvidenceTools.map((tool) => `recovery_tool:${tool}`),
      `fingerprint:${fingerprint}`,
    ], 24),
    archiveMetadata: {
      ok: recovery.ok,
      provider: recovery.provider,
      sessionId: recovery.sessionId || null,
      launched: recovery.launched || false,
      suppressed: input.suppressConnectedHandoff === true,
      suppressionReason: input.suppressionReason || null,
      repeatCount: input.repeatCount || 1,
      fingerprint,
      recoveryAction: recovery.recoveryAction,
      failureClass: recovery.assessment?.failureClass || 'unknown',
      surface: recovery.assessment?.surface || 'unknown',
      source: input.source || 'main_chat_failure',
      runId: input.runId || null,
      recoveryRunbook: recovery.runbook || null,
      recoveryComplexity: recovery.runbook?.complexity || null,
      coordinationMode: recovery.runbook?.coordinationMode || null,
      checkpointRecovery: input.checkpointRecovery || null,
      evidenceRecovery,
      recoveryReliability: reliabilitySummary,
      recoveryOptions,
      verificationCommands: verificationPlan.commands,
      verificationChecks: verificationPlan.checks,
    },
  };
}

export async function startChatFailureRecovery(input: ChatFailureRecoveryInput): Promise<ChatFailureRecoveryResult> {
  const fingerprint = buildChatFailureRecoveryFingerprint(input);
  const normalizedInput = { ...input, recoveryFingerprint: fingerprint };
  const verificationPlan = buildChatFailureRecoveryVerificationPlan(normalizedInput);
  const agentInput = buildChatFailureRecoveryInput(normalizedInput);
  let recovery: AgentFailureRecoveryStartResult;

  if (normalizedInput.suppressConnectedHandoff) {
    const policy = buildAgentFailureRecoveryPolicy(agentInput);
    recovery = {
      ok: false,
      provider: 'codex',
      launched: false,
      recoveryAction: policy.action,
      assessment: policy.assessment,
      runbook: policy.runbook,
      message: `Duplicate chat failure recovery handoff suppressed. ${summarizeAgentFailureRecoveryPolicy(policy)}`,
    };
  } else {
    recovery = await startConnectedAgentFailureRecovery(agentInput);
  }

  const archive = buildChatFailureRecoveryArchive(normalizedInput, recovery);

  return {
    recovery,
    agentInput,
    userMessage: formatChatFailureRecoveryUserMessage(normalizedInput, recovery),
    detail: formatChatFailureRecoveryDetail(normalizedInput, recovery),
    recoveryOptions: buildChatFailureRecoveryOptions(normalizedInput, recovery),
    fingerprint,
    verificationPlan,
    runbook: recovery.runbook,
    ...archive,
  };
}
