import { formatPersistedChatBotMessage } from './chatAgentIdentity';
import type { AgentPlanDraft } from './agentPlanMode';
import type { ChatAutomationPlanPreview } from './chatAutomationPlanPreview';
import type { ChatCommandDecision } from './chatCommandRegistry';
import type { ChatComputerHandoffMetadata } from './chatComputerHandoffContext';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { OpenSwanTaskPlan } from './openswanTaskPlanner';
import type { OpenSwanToolEvent } from './openswanToolRuntime';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';
import { persistChatMessage, updateChatMessageContent } from './chatService';
import type { ResearchDocumentReference } from './researchControl';
import { getResearchDocumentReferences } from './researchControl';
import type { SwanBotStructuredArtifact, SwanBotStructuredResponse } from './swanbot';
import type { PersistedChatRecoveryOption, PersistedChatRecoveryReliabilitySummary } from './persistedChatMetadata';
import { getWikiArticleReferences, type WikiArticleReference } from './wikiData';

export async function buildChatInfluenceReferences(params: {
  prompt: string;
  response: string;
  circleId: string;
  wikiLimit?: number;
  researchLimit?: number;
}): Promise<{ wikiRefs: WikiArticleReference[]; researchRefs: ResearchDocumentReference[] }> {
  const {
    prompt,
    response,
    circleId,
    wikiLimit = 3,
    researchLimit = 3,
  } = params;
  const query = [prompt, response].filter(Boolean).join('\n').slice(0, 2400);
  const [wikiRefs, researchRefs] = await Promise.all([
    Promise.resolve(getWikiArticleReferences(query, wikiLimit)),
    getResearchDocumentReferences({
      query,
      circleId,
      limit: researchLimit,
    }),
  ]);

  return { wikiRefs, researchRefs };
}

export function persistMainChatBotMessageWithRetry(params: {
  circleId: string;
  userId: string;
  agentName: string;
  content: string;
  threadId: string | null | undefined;
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
  agentPlan?: AgentPlanDraft | Record<string, unknown>;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: PersistedChatRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  computerHandoff?: ChatComputerHandoffMetadata | null;
  chatAutomationPlanPreview?: ChatAutomationPlanPreview | null;
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints?: string[];
    blockers?: string[];
  };
  observedEval?: OpenSwanObservedEvalSummary | null;
  routing?: SwanBotStructuredResponse['routing'] | null;
  maxAttempts?: number;
  onError?: (error: unknown) => void;
  onPersisted?: (messageId: string) => void;
}): void {
  const {
    circleId,
    userId,
    agentName,
    content,
    threadId,
    localMessageId,
    source,
    usage,
    commandDecisions,
    artifacts,
    wikiRefs,
    researchRefs,
    memoriesUsed,
    memoryRefs,
    memoryRecommendations,
    executionStream,
    agentPlan,
    taskPlan,
    toolEvents,
    verificationResults,
    browserPlans,
    browserPlanEvents,
    browserSessions,
    recoveryOptions,
    recoveryReliability,
    computerHandoff,
    chatAutomationPlanPreview,
    modeOutcomeSummary,
    observedEval,
    routing,
    maxAttempts = 3,
    onError,
    onPersisted,
  } = params;

  const persistAttempt = async (attempt = 0) => {
    try {
      const messageId = await persistChatMessage({
        circleId,
        userId,
        content: formatPersistedChatBotMessage(agentName, content, {
          localMessageId,
          source,
          usage,
          commandDecisions,
          artifacts,
          wikiRefs,
          researchRefs,
          memoriesUsed,
          memoryRefs,
          memoryRecommendations,
          executionStream,
          agentPlan,
          taskPlan,
          toolEvents,
          verificationResults,
          browserPlans,
          browserPlanEvents,
          browserSessions,
          recoveryOptions,
          recoveryReliability,
          computerHandoff,
          chatAutomationPlanPreview,
          modeOutcomeSummary,
          observedEval,
          routing,
        }),
        threadId,
        isBot: true,
        reactions: {},
      });
      if (messageId) onPersisted?.(messageId);
    } catch (error) {
      onError?.(error);
      if (attempt < maxAttempts) {
        setTimeout(() => {
          void persistAttempt(attempt + 1);
        }, 1000 * (attempt + 1));
      }
    }
  };

  void persistAttempt();
}

export function updateMainChatBotMessageWithRetry(params: {
  messageId: string;
  agentName: string;
  content: string;
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
  agentPlan?: AgentPlanDraft | Record<string, unknown>;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: PersistedChatRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  computerHandoff?: ChatComputerHandoffMetadata | null;
  chatAutomationPlanPreview?: ChatAutomationPlanPreview | null;
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints?: string[];
    blockers?: string[];
  };
  observedEval?: OpenSwanObservedEvalSummary | null;
  routing?: SwanBotStructuredResponse['routing'] | null;
  maxAttempts?: number;
  onError?: (error: unknown) => void;
}): void {
  const {
    messageId,
    agentName,
    content,
    localMessageId,
    source,
    usage,
    commandDecisions,
    artifacts,
    wikiRefs,
    researchRefs,
    memoriesUsed,
    memoryRefs,
    memoryRecommendations,
    executionStream,
    agentPlan,
    taskPlan,
    toolEvents,
    verificationResults,
    browserPlans,
    browserPlanEvents,
    browserSessions,
    recoveryOptions,
    recoveryReliability,
    computerHandoff,
    chatAutomationPlanPreview,
    modeOutcomeSummary,
    observedEval,
    routing,
    maxAttempts = 3,
    onError,
  } = params;

  const persistAttempt = async (attempt = 0) => {
    try {
      await updateChatMessageContent(messageId, formatPersistedChatBotMessage(agentName, content, {
        localMessageId,
        source,
        usage,
        commandDecisions,
        artifacts,
        wikiRefs,
        researchRefs,
        memoriesUsed,
        memoryRefs,
        memoryRecommendations,
        executionStream,
        agentPlan,
        taskPlan,
        toolEvents,
        verificationResults,
        browserPlans,
        browserPlanEvents,
        browserSessions,
        recoveryOptions,
        recoveryReliability,
        computerHandoff,
        chatAutomationPlanPreview,
        modeOutcomeSummary,
        observedEval,
        routing,
      }));
    } catch (error) {
      onError?.(error);
      if (attempt < maxAttempts) {
        setTimeout(() => {
          void persistAttempt(attempt + 1);
        }, 1000 * (attempt + 1));
      }
    }
  };

  void persistAttempt();
}
