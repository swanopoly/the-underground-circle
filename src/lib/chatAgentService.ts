import { formatPersistedChatBotMessage } from './chatAgentIdentity';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
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
  maxAttempts?: number;
  onError?: (error: unknown) => void;
}): void {
  const {
    messageId,
    agentName,
    content,
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
    maxAttempts = 3,
    onError,
  } = params;

  const persistAttempt = async (attempt = 0) => {
    try {
      await updateChatMessageContent(messageId, formatPersistedChatBotMessage(agentName, content, {
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
