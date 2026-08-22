import type { ImageSourcePropType } from 'react-native';
import { storage } from './storage';
import type { SwanBotStructuredArtifact } from './swanbot';
import {
  chatPersonalCircleStorageKey,
  chatPersonalThreadStorageKey,
  type ChatPersonalStorageScope,
} from './chatSessionStatePersistence';
export {
  BOT_META_MARKER,
  formatPersistedChatBotMessage,
  isPersistedChatBotMessage,
  projectPersistedOpenSwanTerminal,
  projectPersistedOpenSwanResumeLocator,
  projectPersistedOpenSwanMultiActionCompletion,
  readPersistedChatBotMetadata,
  stripPersistedChatBotPrefix,
  type PersistedChatBotMetadata,
  type PersistedChatRecoveryReliabilitySummary,
  type PersistedOpenSwanTerminal,
  type PersistedOpenSwanMultiActionCompletion,
} from './persistedChatMetadata';
export type { OpenSwanResumeLocator } from './toolLoopResume';

export const CHAT_AGENT_STORAGE_KEY = 'uc_agent_name';
export const CHAT_AGENT_AVATAR_STORAGE_KEY = 'uc_agent_avatar';
export const CHAT_THREAD_BUILD_ARTIFACT_STORAGE_KEY = 'uc_chat_thread_build_artifact';
export const MAIN_CHAT_AGENT_NAME = 'OpenSwan';
export const MAIN_CHAT_AGENT_ICON = require('../../assets/swanai.png');

function legacyThreadArtifactKey(threadId: string): string {
  return `${CHAT_THREAD_BUILD_ARTIFACT_STORAGE_KEY}_${threadId}`;
}

export type ChatThreadArtifactStorageScope = ChatPersonalStorageScope & {
  threadId: string | null | undefined;
};

function buildThreadArtifactKey(scope: ChatThreadArtifactStorageScope): string | null {
  return chatPersonalThreadStorageKey('builder_artifact', scope, scope.threadId);
}

function normalizeChatAgentName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'Agent') return MAIN_CHAT_AGENT_NAME;
  return trimmed;
}

export async function loadChatAgentName(scope: ChatPersonalStorageScope): Promise<string> {
  const key = chatPersonalCircleStorageKey('agent_name', scope);
  if (!key || !scope.circleId) return MAIN_CHAT_AGENT_NAME;
  await storage.removeItem(`${CHAT_AGENT_STORAGE_KEY}_${scope.circleId}`).catch(() => {});
  const saved = await storage.getItem(key);
  return normalizeChatAgentName(saved);
}

export async function saveChatAgentName(scope: ChatPersonalStorageScope, name: string): Promise<string> {
  const normalized = normalizeChatAgentName(name);
  const key = chatPersonalCircleStorageKey('agent_name', scope);
  if (!key) return normalized;
  if (scope.circleId) await storage.removeItem(`${CHAT_AGENT_STORAGE_KEY}_${scope.circleId}`).catch(() => {});
  await storage.setItem(key, normalized);
  return normalized;
}

export async function loadChatAgentAvatar(scope: ChatPersonalStorageScope): Promise<string | null> {
  const key = chatPersonalCircleStorageKey('agent_avatar', scope);
  if (!key || !scope.circleId) return null;
  await storage.removeItem(`${CHAT_AGENT_AVATAR_STORAGE_KEY}_${scope.circleId}`).catch(() => {});
  return storage.getItem(key);
}

export async function saveChatAgentAvatar(scope: ChatPersonalStorageScope, avatarUri: string): Promise<void> {
  const key = chatPersonalCircleStorageKey('agent_avatar', scope);
  if (!key) return;
  if (scope.circleId) await storage.removeItem(`${CHAT_AGENT_AVATAR_STORAGE_KEY}_${scope.circleId}`).catch(() => {});
  await storage.setItem(key, avatarUri);
}

export async function clearChatAgentAvatar(scope: ChatPersonalStorageScope): Promise<void> {
  const key = chatPersonalCircleStorageKey('agent_avatar', scope);
  if (!key) return;
  await storage.removeItem(key);
  if (scope.circleId) {
    await storage.removeItem(`${CHAT_AGENT_AVATAR_STORAGE_KEY}_${scope.circleId}`).catch(() => {});
  }
}

export function getChatAgentAvatarSource(agentAvatarUri: string | null): ImageSourcePropType {
  return agentAvatarUri ? { uri: agentAvatarUri } : MAIN_CHAT_AGENT_ICON;
}

export async function loadLastThreadBuildArtifact(scope: ChatThreadArtifactStorageScope): Promise<SwanBotStructuredArtifact | null> {
  const key = buildThreadArtifactKey(scope);
  if (!key || !scope.threadId) return null;
  try {
    await storage.removeItem(legacyThreadArtifactKey(scope.threadId));
    const raw = await storage.getItem(key);
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
  scope: ChatThreadArtifactStorageScope,
  artifact: SwanBotStructuredArtifact | null | undefined,
): Promise<void> {
  const key = buildThreadArtifactKey(scope);
  if (!key) return;
  if (scope.threadId) await storage.removeItem(legacyThreadArtifactKey(scope.threadId)).catch(() => {});
  if (!artifact || (artifact.kind !== 'webpage' && artifact.kind !== 'code')) {
    await storage.removeItem(key);
    return;
  }
  try {
    await storage.setItem(key, JSON.stringify(artifact));
  } catch {}
}
