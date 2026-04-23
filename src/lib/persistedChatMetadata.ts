import type { ChatCommandDecision } from './chatCommandRegistry';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { ResearchDocumentReference } from './researchControl';
import type { SwanBotStructuredArtifact } from './swanbot';
import type { WikiArticleReference } from './wikiData';

const LEGACY_CROWN_PREFIX = /^👑 \*\*OpenSwan:\*\* /u;
const BOT_PREFIX = /^(🦢|🤖) \*\*[^*]{1,80}:\*\* /u;
export const BOT_META_MARKER = '\n[[UC_CHAT_META]]';

export type PersistedChatBotMetadata = {
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
};

function normalizeChatAgentName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'Agent') return 'OpenSwan';
  return trimmed;
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
  const base = `🦢 **${normalizeChatAgentName(agentName)}:** ${content}`;
  const hasMetadata = !!metadata && (
    !!metadata.localMessageId ||
    (metadata.commandDecisions?.length || 0) > 0 ||
    (metadata.artifacts?.length || 0) > 0 ||
    (metadata.wikiRefs?.length || 0) > 0 ||
    (metadata.researchRefs?.length || 0) > 0 ||
    (metadata.memoriesUsed?.length || 0) > 0 ||
    (metadata.memoryRefs?.length || 0) > 0 ||
    (metadata.memoryRecommendations?.length || 0) > 0 ||
    (metadata.executionStream?.length || 0) > 0 ||
    (metadata.browserPlans?.length || 0) > 0 ||
    (metadata.browserPlanEvents?.length || 0) > 0 ||
    (metadata.browserSessions?.length || 0) > 0 ||
    !!metadata.modeOutcomeSummary?.headline ||
    !!metadata.observedEval
  );
  if (!hasMetadata) return base;
  return `${base}${BOT_META_MARKER}${JSON.stringify(metadata)}`;
}
