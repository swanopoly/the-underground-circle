import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { ChatAutomationPlanPreview } from './chatAutomationPlanPreview';
import type { ChatComputerHandoffMetadata } from './chatComputerHandoffContext';
import type { ChatCommandDecision } from './chatCommandRegistry';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { ResearchDocumentReference } from './researchControl';
import type { SwanBotStructuredArtifact } from './swanbot';
import type { WikiArticleReference } from './wikiData';
import { readPersistedChatBotMetadata, type PersistedChatBotMetadata, type PersistedChatRecoveryOption } from './persistedChatMetadata';

type UnknownMetadata = Record<string, unknown> | null | undefined;

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function readMessageArtifacts(metadata: UnknownMetadata): SwanBotStructuredArtifact[] {
  return readArray<SwanBotStructuredArtifact>(metadata?.artifacts);
}

export function readMessageWikiRefs(metadata: UnknownMetadata): WikiArticleReference[] {
  return readArray<WikiArticleReference>(metadata?.wikiRefs);
}

export function readMessageResearchRefs(metadata: UnknownMetadata): ResearchDocumentReference[] {
  return readArray<ResearchDocumentReference>(metadata?.researchRefs);
}

export function readMessageMemoryRefs(metadata: UnknownMetadata): PromptMemoryReference[] {
  return readArray<PromptMemoryReference>(metadata?.memoryRefs ?? metadata?.memory_references);
}

export function readMessageMemoriesUsed(metadata: UnknownMetadata): string[] {
  return readArray<string>(metadata?.memoriesUsed ?? metadata?.memories_used)
    .filter((value): value is string => typeof value === 'string');
}

export function readMessageMemoryRecommendations(metadata: UnknownMetadata): OpenSwanMemoryRecommendation[] {
  return readArray<OpenSwanMemoryRecommendation>(metadata?.memoryRecommendations ?? metadata?.memory_recommendations);
}

export function readMessageExecutionStream(metadata: UnknownMetadata): OpenSwanExecutionContract[] {
  return readArray<OpenSwanExecutionContract>(metadata?.executionStream ?? metadata?.execution_stream);
}

export function readMessageBrowserPlans(metadata: UnknownMetadata): BrowserPlanCardData[] {
  return readArray<BrowserPlanCardData>(metadata?.browserPlans);
}

export function readMessageBrowserPlanEvents(metadata: UnknownMetadata): BrowserPlanEvent[] {
  return readArray<BrowserPlanEvent>(metadata?.browserPlanEvents);
}

export function readMessageBrowserSessions(metadata: UnknownMetadata): BrowserSessionRecord[] {
  return readArray<BrowserSessionRecord>(metadata?.browserSessions);
}

export function readMessageRecoveryOptions(metadata: UnknownMetadata): PersistedChatRecoveryOption[] {
  return readArray<PersistedChatRecoveryOption>(metadata?.recoveryOptions);
}

export function readMessageComputerHandoff(metadata: UnknownMetadata): ChatComputerHandoffMetadata | undefined {
  const value = metadata?.computerHandoff;
  return value && typeof value === 'object' ? value as ChatComputerHandoffMetadata : undefined;
}

export function readMessageChatAutomationPlanPreview(metadata: UnknownMetadata): ChatAutomationPlanPreview | undefined {
  const value = metadata?.chatAutomationPlanPreview;
  return value && typeof value === 'object' ? value as ChatAutomationPlanPreview : undefined;
}

export function readPersistedChatBotMessageFields(content: string | null | undefined): PersistedChatBotMetadata {
  return readPersistedChatBotMetadata(content) || {};
}

export type HydratedPersistedBotFields = {
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
  recoveryOptions?: PersistedChatRecoveryOption[];
  computerHandoff?: ChatComputerHandoffMetadata;
  chatAutomationPlanPreview?: ChatAutomationPlanPreview;
  commandDecisions?: ChatCommandDecision[];
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints: string[];
    blockers: string[];
  };
  observedEval?: OpenSwanObservedEvalSummary;
};

export function buildHydratedPersistedBotFields(
  content: string | null | undefined,
): HydratedPersistedBotFields {
  const metadata = readPersistedChatBotMessageFields(content);
  return {
    artifacts: metadata.artifacts || undefined,
    wikiRefs: metadata.wikiRefs || undefined,
    researchRefs: metadata.researchRefs || undefined,
    memoriesUsed: metadata.memoriesUsed || undefined,
    memoryRefs: metadata.memoryRefs || undefined,
    memoryRecommendations: metadata.memoryRecommendations || undefined,
    executionStream: metadata.executionStream || undefined,
    browserPlans: metadata.browserPlans || undefined,
    browserPlanEvents: metadata.browserPlanEvents || undefined,
    browserSessions: metadata.browserSessions || undefined,
    recoveryOptions: metadata.recoveryOptions || undefined,
    computerHandoff: metadata.computerHandoff || undefined,
    chatAutomationPlanPreview: metadata.chatAutomationPlanPreview || undefined,
    commandDecisions: metadata.commandDecisions || undefined,
    modeOutcomeSummary: metadata.modeOutcomeSummary?.headline ? {
      headline: metadata.modeOutcomeSummary.headline,
      bulletPoints: Array.isArray(metadata.modeOutcomeSummary.bulletPoints) ? metadata.modeOutcomeSummary.bulletPoints.filter((value): value is string => typeof value === 'string') : [],
      blockers: Array.isArray(metadata.modeOutcomeSummary.blockers) ? metadata.modeOutcomeSummary.blockers.filter((value): value is string => typeof value === 'string') : [],
    } : undefined,
    observedEval: metadata.observedEval || undefined,
  };
}
