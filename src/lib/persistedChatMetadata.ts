import type { ChatCommandDecision } from './chatCommandRegistry';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { OpenSwanTaskPlan } from './openswanTaskPlanner';
import type { OpenSwanToolEvent } from './openswanToolRuntime';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';
import type { ResearchDocumentReference } from './researchControl';
import type { SwanBotStructuredArtifact, SwanBotStructuredResponse } from './swanbot';
import type { WikiArticleReference } from './wikiData';

const LEGACY_CROWN_PREFIX = /^👑 \*\*OpenSwan:\*\* /u;
const BOT_PREFIX = /^(🦢|🤖) \*\*[^*]{1,80}:\*\* /u;
export const BOT_META_MARKER = '\n[[UC_CHAT_META]]';
const MAX_PERSISTED_BOT_MESSAGE_CHARS = 9000;
const MAX_PERSISTED_RESPONSE_CHARS = 6400;

export type PersistedChatBotMetadata = {
  localMessageId?: string;
  source?: {
    actor?: string;
    surface?: string;
    selectedModel?: string | null;
    effectiveModel?: string | null;
    provider?: string | null;
  };
  usage?: SwanBotStructuredResponse['usage'] | null;
  commandDecisions?: ChatCommandDecision[];
  artifacts?: SwanBotStructuredArtifact[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  memoriesUsed?: string[];
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  executionStream?: OpenSwanExecutionContract[];
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints?: string[];
    blockers?: string[];
  };
  observedEval?: OpenSwanObservedEvalSummary | null;
  routing?: SwanBotStructuredResponse['routing'] | null;
};

function normalizeChatAgentName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'Agent') return 'OpenSwan';
  return trimmed;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 36)).trimEnd()}\n\n[truncated for saved chat]`;
}

function hasPersistedMetadata(metadata?: PersistedChatBotMetadata): boolean {
  return !!metadata && (
    !!metadata.localMessageId ||
    !!metadata.source ||
    !!metadata.usage ||
    (metadata.commandDecisions?.length || 0) > 0 ||
    (metadata.artifacts?.length || 0) > 0 ||
    (metadata.wikiRefs?.length || 0) > 0 ||
    (metadata.researchRefs?.length || 0) > 0 ||
    (metadata.memoriesUsed?.length || 0) > 0 ||
    (metadata.memoryRefs?.length || 0) > 0 ||
    (metadata.memoryRecommendations?.length || 0) > 0 ||
    (metadata.executionStream?.length || 0) > 0 ||
    !!metadata.taskPlan ||
    (metadata.toolEvents?.length || 0) > 0 ||
    (metadata.verificationResults?.length || 0) > 0 ||
    (metadata.browserPlans?.length || 0) > 0 ||
    (metadata.browserPlanEvents?.length || 0) > 0 ||
    (metadata.browserSessions?.length || 0) > 0 ||
    !!metadata.modeOutcomeSummary?.headline ||
    !!metadata.observedEval ||
    !!metadata.routing
  );
}

function compactPersistedMetadata(metadata?: PersistedChatBotMetadata): PersistedChatBotMetadata | undefined {
  if (!metadata) return undefined;
  return {
    localMessageId: metadata.localMessageId,
    source: metadata.source,
    usage: metadata.usage,
    commandDecisions: metadata.commandDecisions?.slice(0, 8),
    artifacts: metadata.artifacts?.slice(0, 8).map((artifact) => ({
      ...artifact,
      content: artifact.content ? truncateText(artifact.content, 1200) : artifact.content,
    })),
    wikiRefs: metadata.wikiRefs?.slice(0, 5),
    researchRefs: metadata.researchRefs?.slice(0, 5),
    memoriesUsed: metadata.memoriesUsed?.slice(0, 12),
    memoryRefs: metadata.memoryRefs?.slice(0, 8),
    memoryRecommendations: metadata.memoryRecommendations?.slice(0, 6),
    executionStream: metadata.executionStream?.slice(0, 12).map((step: any) => ({
      ...step,
      body: typeof step?.body === 'string' ? truncateText(step.body, 800) : step?.body,
      summary: typeof step?.summary === 'string' ? truncateText(step.summary, 800) : step?.summary,
    })) as any,
    taskPlan: metadata.taskPlan ? {
      kind: metadata.taskPlan.kind,
      profile: metadata.taskPlan.profile,
      summary: truncateText(String(metadata.taskPlan.summary || ''), 800),
      recommendedTools: metadata.taskPlan.recommendedTools?.slice(0, 12),
      verification: metadata.taskPlan.verification?.slice(0, 12).map((check) => ({
        ...check,
        reason: truncateText(String(check.reason || ''), 300),
      })),
    } as any : undefined,
    toolEvents: metadata.toolEvents?.slice(-16).map((event) => ({
      tool: event.tool,
      status: event.status,
      summary: truncateText(String(event.summary || ''), 700),
      command: event.command ? truncateText(event.command, 500) : undefined,
      metadata: event.metadata,
    })) as any,
    verificationResults: metadata.verificationResults?.slice(-12).map((result) => ({
      check: result.check,
      status: result.status,
      ok: result.ok,
      executed: result.executed,
      summary: truncateText(String(result.summary || ''), 700),
      command: result.command ? truncateText(result.command, 500) : undefined,
      stdout: result.stdout ? truncateText(result.stdout, 500) : undefined,
      stderr: result.stderr ? truncateText(result.stderr, 500) : undefined,
      error: result.error ? truncateText(result.error, 500) : undefined,
      execution: result.execution ? {
        ...result.execution,
        summary: truncateText(String(result.execution.summary || ''), 500),
        command: result.execution.command ? truncateText(result.execution.command, 400) : undefined,
        error: result.execution.error ? truncateText(String(result.execution.error), 400) : result.execution.error,
      } : result.execution,
    })) as any,
    browserPlans: metadata.browserPlans?.slice(0, 3).map((plan: any) => ({
      planId: plan.planId,
      task: truncateText(String(plan.task || ''), 500),
      backend: plan.backend,
      backendLabel: plan.backendLabel,
      backendDetails: plan.backendDetails,
      requiresApproval: plan.requiresApproval,
      recommendedPermission: plan.recommendedPermission,
      status: plan.status,
      launchedAt: plan.launchedAt,
      completedAt: plan.completedAt,
      backendSessionId: plan.backendSessionId,
      backendLiveUrl: plan.backendLiveUrl,
      actions: Array.isArray(plan.actions)
        ? plan.actions.slice(0, 10).map((action: any) => ({
            id: action.id,
            type: action.type,
            target: typeof action.target === 'string' ? truncateText(action.target, 240) : action.target,
            value: typeof action.value === 'string' ? truncateText(action.value, 160) : action.value,
            description: typeof action.description === 'string' ? truncateText(action.description, 300) : action.description,
            requiresApproval: action.requiresApproval,
            approvalReason: action.approvalReason,
            blockedReason: action.blockedReason,
          }))
        : [],
    })) as any,
    browserPlanEvents: metadata.browserPlanEvents?.slice(-12),
    browserSessions: metadata.browserSessions?.slice(-3).map((session: any) => ({
      id: session.id,
      planId: session.planId,
      task: truncateText(String(session.task || ''), 500),
      backend: session.backend,
      backendLabel: session.backendLabel,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      currentUrl: session.currentUrl,
      backendSessionId: session.backendSessionId,
      backendLiveUrl: session.backendLiveUrl,
      recommendedPermission: session.recommendedPermission,
      actions: Array.isArray(session.actions) ? session.actions.slice(0, 10) : [],
    })) as any,
    modeOutcomeSummary: metadata.modeOutcomeSummary,
    observedEval: metadata.observedEval,
    routing: metadata.routing,
  };
}

function minimalPersistedMetadata(metadata?: PersistedChatBotMetadata): PersistedChatBotMetadata | undefined {
  if (!metadata) return undefined;
  return {
    localMessageId: metadata.localMessageId,
    source: metadata.source,
    usage: metadata.usage,
    artifacts: metadata.artifacts?.slice(0, 4).map((artifact) => ({
      kind: artifact.kind,
      title: artifact.title,
      url: artifact.url,
      metadata: artifact.metadata,
    })),
    wikiRefs: metadata.wikiRefs?.slice(0, 3),
    researchRefs: metadata.researchRefs?.slice(0, 3),
    memoriesUsed: metadata.memoriesUsed?.slice(0, 6),
    memoryRefs: metadata.memoryRefs?.slice(0, 4),
    memoryRecommendations: metadata.memoryRecommendations?.slice(0, 3),
    executionStream: metadata.executionStream?.slice(-6).map((step: any) => ({
      id: step?.id,
      status: step?.status,
      title: step?.title,
      kind: step?.kind,
      label: step?.label,
    })) as any,
    taskPlan: metadata.taskPlan ? {
      kind: metadata.taskPlan.kind,
      profile: metadata.taskPlan.profile,
      summary: truncateText(String(metadata.taskPlan.summary || ''), 240),
    } as any : undefined,
    toolEvents: metadata.toolEvents?.slice(-6).map((event) => ({
      tool: event.tool,
      status: event.status,
      summary: truncateText(String(event.summary || ''), 240),
    })) as any,
    verificationResults: metadata.verificationResults?.slice(-4).map((result) => ({
      check: result.check ? {
        id: result.check.id,
        label: result.check.label,
        kind: result.check.kind,
        required: result.check.required,
      } : result.check,
      status: result.status,
      ok: result.ok,
      executed: result.executed,
      summary: truncateText(String(result.summary || ''), 240),
    })) as any,
    browserPlans: metadata.browserPlans?.slice(0, 2).map((plan: any) => ({
      planId: plan.planId,
      task: truncateText(String(plan.task || ''), 240),
      backend: plan.backend,
      backendLabel: plan.backendLabel,
      requiresApproval: plan.requiresApproval,
      status: plan.status,
      backendSessionId: plan.backendSessionId,
      backendLiveUrl: plan.backendLiveUrl,
      actions: Array.isArray(plan.actions)
        ? plan.actions.slice(0, 5).map((action: any) => ({
            id: action.id,
            type: action.type,
            target: typeof action.target === 'string' ? truncateText(action.target, 120) : action.target,
            description: typeof action.description === 'string' ? truncateText(action.description, 160) : action.description,
            requiresApproval: action.requiresApproval,
          }))
        : [],
    })) as any,
    browserPlanEvents: metadata.browserPlanEvents?.slice(-6),
    browserSessions: metadata.browserSessions?.slice(-2).map((session: any) => ({
      id: session.id,
      planId: session.planId,
      task: truncateText(String(session.task || ''), 240),
      backend: session.backend,
      backendLabel: session.backendLabel,
      status: session.status,
      backendSessionId: session.backendSessionId,
      backendLiveUrl: session.backendLiveUrl,
    })) as any,
    modeOutcomeSummary: metadata.modeOutcomeSummary,
    observedEval: metadata.observedEval ? {
      outcome: (metadata.observedEval as any).outcome,
      responseQuality: (metadata.observedEval as any).responseQuality,
      verification: (metadata.observedEval as any).verification,
    } as any : metadata.observedEval,
    routing: metadata.routing,
  };
}

export function isPersistedChatBotMessage(content: string | null | undefined, isBotFlag = false): boolean {
  if (isBotFlag) return true;
  const value = content || '';
  return BOT_PREFIX.test(value) || LEGACY_CROWN_PREFIX.test(value);
}

export function stripPersistedChatBotPrefix(content: string | null | undefined): string {
  const value = content || '';
  const withoutPrefix = value.replace(BOT_PREFIX, '').replace(LEGACY_CROWN_PREFIX, '');
  const metaIndex = withoutPrefix.indexOf(BOT_META_MARKER);
  return metaIndex >= 0 ? withoutPrefix.slice(0, metaIndex) : withoutPrefix;
}

export function readPersistedChatBotMetadata(content: string | null | undefined): PersistedChatBotMetadata | null {
  const value = content || '';
  const metaIndex = value.indexOf(BOT_META_MARKER);
  if (metaIndex < 0) return null;
  const raw = value.slice(metaIndex + BOT_META_MARKER.length).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedChatBotMetadata;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function formatPersistedChatBotMessage(
  agentName: string,
  content: string,
  metadata?: PersistedChatBotMetadata,
): string {
  const visibleContent = truncateText(content || '', MAX_PERSISTED_RESPONSE_CHARS);
  const base = `🦢 **${normalizeChatAgentName(agentName)}:** ${visibleContent}`;
  if (!hasPersistedMetadata(metadata)) return base;

  const candidates = [
    metadata,
    compactPersistedMetadata(metadata),
    minimalPersistedMetadata(metadata),
    undefined,
  ];

  for (const candidate of candidates) {
    const message = candidate && hasPersistedMetadata(candidate)
      ? `${base}${BOT_META_MARKER}${JSON.stringify(candidate)}`
      : base;
    if (message.length <= MAX_PERSISTED_BOT_MESSAGE_CHARS) return message;
  }

  return truncateText(base, MAX_PERSISTED_BOT_MESSAGE_CHARS);
}
