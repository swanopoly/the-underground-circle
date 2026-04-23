import { formatPersistedChatBotMessage } from './chatAgentIdentity';
import type { ChatCommandDecision } from './chatCommandRegistry';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import { persistChatMessage, updateChatMessageContent } from './chatService';
import type { ResearchDocumentReference } from './researchControl';
import { getResearchDocumentReferences } from './researchControl';
import type { SwanBotStructuredArtifact } from './swanbot';
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
  threadId: string;
  localMessageId?: string;
  commandDecisions?: ChatCommandDecision[];
  artifacts?: SwanBotStructuredArtifact[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  memoriesUsed?: string[];
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  executionStream?: OpenSwanExecutionContract[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints?: string[];
    blockers?: string[];
  };
  observedEval?: OpenSwanObservedEvalSummary | null;
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
    commandDecisions,
    artifacts,
    wikiRefs,
    researchRefs,
    memoriesUsed,
    memoryRefs,
    memoryRecommendations,
    executionStream,
    browserPlans,
    browserPlanEvents,
    browserSessions,
    modeOutcomeSummary,
    observedEval,
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
          commandDecisions,
          artifacts,
          wikiRefs,
          researchRefs,
          memoriesUsed,
          memoryRefs,
          memoryRecommendations,
          executionStream,
          browserPlans,
          browserPlanEvents,
          browserSessions,
          modeOutcomeSummary,
          observedEval,
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
  commandDecisions?: ChatCommandDecision[];
  artifacts?: SwanBotStructuredArtifact[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  memoriesUsed?: string[];
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  executionStream?: OpenSwanExecutionContract[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints?: string[];
    blockers?: string[];
  };
  observedEval?: OpenSwanObservedEvalSummary | null;
  maxAttempts?: number;
  onError?: (error: unknown) => void;
}): void {
  const {
    messageId,
    agentName,
    content,
    localMessageId,
    commandDecisions,
    artifacts,
    wikiRefs,
    researchRefs,
    memoriesUsed,
    memoryRefs,
    memoryRecommendations,
    executionStream,
    browserPlans,
    browserPlanEvents,
    browserSessions,
    modeOutcomeSummary,
    observedEval,
    maxAttempts = 3,
    onError,
  } = params;

  const persistAttempt = async (attempt = 0) => {
    try {
      await updateChatMessageContent(messageId, formatPersistedChatBotMessage(agentName, content, {
        localMessageId,
        commandDecisions,
        artifacts,
        wikiRefs,
        researchRefs,
        memoriesUsed,
        memoryRefs,
        memoryRecommendations,
        executionStream,
        browserPlans,
        browserPlanEvents,
        browserSessions,
        modeOutcomeSummary,
        observedEval,
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
