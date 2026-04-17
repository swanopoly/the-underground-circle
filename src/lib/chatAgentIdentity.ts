import type { ImageSourcePropType } from 'react-native';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import { storage } from './storage';
import type { ResearchDocumentReference } from './researchControl';
import type { SwanBotStructuredArtifact } from './swanbot';
import type { WikiArticleReference } from './wikiData';

export const CHAT_AGENT_STORAGE_KEY = 'uc_agent_name';
export const CHAT_AGENT_AVATAR_STORAGE_KEY = 'uc_agent_avatar';
export const CHAT_THREAD_BUILD_ARTIFACT_STORAGE_KEY = 'uc_chat_thread_build_artifact';
export const MAIN_CHAT_AGENT_NAME = 'OpenSwan';
export const MAIN_CHAT_AGENT_ICON = require('../../assets/swanai.png');

const LEGACY_CROWN_PREFIX = /^👑 \*\*OpenSwan:\*\* /u;
const BOT_PREFIX = /^(🦢|🤖) \*\*[^*]{1,80}:\*\* /u;
const BOT_META_MARKER = '\n[[UC_CHAT_META]]';

export type PersistedChatBotMetadata = {
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
};

function buildThreadArtifactKey(threadId: string): string {
  return `${CHAT_THREAD_BUILD_ARTIFACT_STORAGE_KEY}_${threadId}`;
}

function normalizeChatAgentName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'Agent') return MAIN_CHAT_AGENT_NAME;
  return trimmed;
}

export async function loadChatAgentName(circleId: string): Promise<string> {
  const saved = await storage.getItem(`${CHAT_AGENT_STORAGE_KEY}_${circleId}`);
  return normalizeChatAgentName(saved);
}

export async function saveChatAgentName(circleId: string, name: string): Promise<string> {
  const normalized = normalizeChatAgentName(name);
  await storage.setItem(`${CHAT_AGENT_STORAGE_KEY}_${circleId}`, normalized);
  return normalized;
}

export async function loadChatAgentAvatar(circleId: string): Promise<string | null> {
  return storage.getItem(`${CHAT_AGENT_AVATAR_STORAGE_KEY}_${circleId}`);
}

export async function saveChatAgentAvatar(circleId: string, avatarUri: string): Promise<void> {
  await storage.setItem(`${CHAT_AGENT_AVATAR_STORAGE_KEY}_${circleId}`, avatarUri);
}

export async function clearChatAgentAvatar(circleId: string): Promise<void> {
  await storage.removeItem(`${CHAT_AGENT_AVATAR_STORAGE_KEY}_${circleId}`);
}

export function getChatAgentAvatarSource(agentAvatarUri: string | null): ImageSourcePropType {
  return agentAvatarUri ? { uri: agentAvatarUri } : MAIN_CHAT_AGENT_ICON;
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
    (metadata.artifacts?.length || 0) > 0 ||
    (metadata.wikiRefs?.length || 0) > 0 ||
    (metadata.researchRefs?.length || 0) > 0 ||
    (metadata.memoriesUsed?.length || 0) > 0 ||
    (metadata.memoryRefs?.length || 0) > 0 ||
    (metadata.memoryRecommendations?.length || 0) > 0 ||
    (metadata.executionStream?.length || 0) > 0 ||
    (metadata.browserPlans?.length || 0) > 0 ||
    (metadata.browserPlanEvents?.length || 0) > 0 ||
    (metadata.browserSessions?.length || 0) > 0
  );
  if (!hasMetadata) return base;
  return `${base}${BOT_META_MARKER}${JSON.stringify(metadata)}`;
}

export async function loadLastThreadBuildArtifact(threadId: string | null | undefined): Promise<SwanBotStructuredArtifact | null> {
  if (!threadId) return null;
  try {
    const raw = await storage.getItem(buildThreadArtifactKey(threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SwanBotStructuredArtifact;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.kind !== 'webpage' && parsed.kind !== 'code') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveLastThreadBuildArtifact(
  threadId: string | null | undefined,
  artifact: SwanBotStructuredArtifact | null | undefined,
): Promise<void> {
  if (!threadId) return;
  if (!artifact || (artifact.kind !== 'webpage' && artifact.kind !== 'code')) {
    await storage.removeItem(buildThreadArtifactKey(threadId));
    return;
  }
  try {
    await storage.setItem(buildThreadArtifactKey(threadId), JSON.stringify(artifact));
  } catch {}
}
