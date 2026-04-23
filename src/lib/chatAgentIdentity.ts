import type { ImageSourcePropType } from 'react-native';
import { storage } from './storage';
import type { SwanBotStructuredArtifact } from './swanbot';
export {
  BOT_META_MARKER,
  formatPersistedChatBotMessage,
  isPersistedChatBotMessage,
  readPersistedChatBotMetadata,
  stripPersistedChatBotPrefix,
  type PersistedChatBotMetadata,
} from './persistedChatMetadata';

export const CHAT_AGENT_STORAGE_KEY = 'uc_agent_name';
export const CHAT_AGENT_AVATAR_STORAGE_KEY = 'uc_agent_avatar';
export const CHAT_THREAD_BUILD_ARTIFACT_STORAGE_KEY = 'uc_chat_thread_build_artifact';
export const MAIN_CHAT_AGENT_NAME = 'OpenSwan';
export const MAIN_CHAT_AGENT_ICON = require('../../assets/swanai.png');

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
