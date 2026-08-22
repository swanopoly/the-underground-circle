import { storage } from './storage';
import { readPersistedChatBotMetadata } from './persistedChatMetadata';
import type { ComputerTaskOutcomeStatus } from './computerTaskOutcome';
import {
  chatPersonalThreadStorageKey,
  type ChatPersonalStorageScope,
} from './chatSessionStatePersistence';

export type PendingBotMessageRecord = {
  localMessageId: string;
  content: string;
  createdAt: string;
  isBot?: boolean;
  isUser?: boolean;
  userName?: string;
  authorId?: string | null;
  replyTo?: { name: string; content: string } | null;
  reactions?: Record<string, string[]>;
  source?: unknown;
  usage?: unknown;
  runId?: string | null;
  requestId?: string | null;
  requestAuthorId?: string | null;
  requestSourceMessageId?: string | null;
  persistedMetadataSnapshot?: unknown;
  delegatedTo?: string;
  delegatedSubagents?: string[];
  connectedAgentHandoff?: unknown;
  artifacts?: unknown[];
  wikiRefs?: unknown[];
  researchRefs?: unknown[];
  memoriesUsed?: string[];
  memoryRefs?: unknown[];
  memoryRecommendations?: unknown[];
  executionStream?: unknown[];
  browserPlans?: unknown[];
  browserPlanEvents?: unknown[];
  browserSessions?: unknown[];
  recoveryOptions?: unknown[];
  recoveryReliability?: unknown;
  computerTaskStatus?: ComputerTaskOutcomeStatus | null;
  computerHandoff?: unknown;
  chatAutomationPlanPreview?: unknown;
  computerFindings?: unknown;
  bestOfN?: unknown;
  outcomeSignal?: unknown;
  modeOutcomeSummary?: { headline: string; bulletPoints?: string[]; blockers?: string[] } | null;
  observedEval?: unknown;
  commandDecisions?: unknown[];
  agentPlan?: unknown;
  taskPlan?: unknown;
  toolEvents?: unknown[];
  verificationResults?: unknown[];
  routing?: unknown;
};

type PersistedMessageSnapshot = {
  content: string | null;
  createdAt?: string | null;
  isBot?: boolean | null;
};

function normalizePersistedMessageSnapshot(
  value: string | null | undefined | { content?: string | null; created_at?: string | null; createdAt?: string | null; is_bot?: boolean | null; isBot?: boolean | null },
): PersistedMessageSnapshot {
  if (typeof value === 'string' || value == null) {
    return { content: value || null };
  }
  return {
    content: value.content || null,
    createdAt: value.created_at || value.createdAt || null,
    isBot: value.is_bot ?? value.isBot ?? null,
  };
}

function looksLikePersistedUserMessage(entry: PendingBotMessageRecord, persisted: PersistedMessageSnapshot): boolean {
  const entryIsBot = entry.isBot !== false;
  if (entryIsBot || persisted.isBot !== false) return false;
  if ((entry.content || '').trim() !== (persisted.content || '').trim()) return false;
  const entryTime = Date.parse(entry.createdAt || '');
  const persistedTime = Date.parse(persisted.createdAt || '');
  if (!Number.isFinite(entryTime) || !Number.isFinite(persistedTime)) return true;
  return Math.abs(entryTime - persistedTime) < 120000;
}

function legacyPendingBotMessagesKey(threadId: string): string {
  return `uc_pending_bot_messages_${threadId}`;
}

export type PendingBotMessageScope = ChatPersonalStorageScope & Readonly<{
  threadId?: unknown;
}>;

function pendingBotMessagesKey(scope: PendingBotMessageScope): string | null {
  return chatPersonalThreadStorageKey('pending_bot_messages', scope, scope.threadId);
}

export async function loadPendingBotMessages(scope: PendingBotMessageScope): Promise<PendingBotMessageRecord[]> {
  const key = pendingBotMessagesKey(scope);
  if (!key) return [];
  try {
    if (typeof scope.threadId === 'string' && scope.threadId) {
      // Full prompts/results in the ownerless legacy lane cannot be assigned to
      // this account. Delete that lane, but never import it.
      await storage.removeItem(legacyPendingBotMessagesKey(scope.threadId)).catch(() => {});
    }
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PendingBotMessageRecord[] : [];
  } catch {
    return [];
  }
}

export async function savePendingBotMessage(
  scope: PendingBotMessageScope,
  record: PendingBotMessageRecord,
): Promise<void> {
  const key = pendingBotMessagesKey(scope);
  if (!key) return;
  const existing = await loadPendingBotMessages(scope);
  const next = [
    ...existing.filter((entry) => entry.localMessageId !== record.localMessageId),
    record,
  ].slice(-30);
  await storage.setItem(key, JSON.stringify(next));
}

export async function removePendingBotMessage(
  scope: PendingBotMessageScope,
  localMessageId: string | null | undefined,
): Promise<void> {
  const key = pendingBotMessagesKey(scope);
  if (!key || !localMessageId) return;
  const existing = await loadPendingBotMessages(scope);
  const next = existing.filter((entry) => entry.localMessageId !== localMessageId);
  if (next.length === 0) {
    await storage.removeItem(key);
    return;
  }
  await storage.setItem(key, JSON.stringify(next));
}

export async function reconcilePendingBotMessages(
  scope: PendingBotMessageScope,
  persistedContents: Array<string | null | undefined | { content?: string | null; created_at?: string | null; createdAt?: string | null; is_bot?: boolean | null; isBot?: boolean | null }>,
): Promise<void> {
  const key = pendingBotMessagesKey(scope);
  if (!key) return;
  const persisted = persistedContents.map(normalizePersistedMessageSnapshot);
  const seenIds = new Set(
    persisted
      .map((message) => readPersistedChatBotMetadata(message.content)?.localMessageId || null)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const existing = await loadPendingBotMessages(scope);
  const next = existing.filter((entry) => (
    !seenIds.has(entry.localMessageId)
    && !persisted.some((message) => looksLikePersistedUserMessage(entry, message))
  ));
  if (next.length === existing.length) return;
  if (next.length === 0) {
    await storage.removeItem(key);
    return;
  }
  await storage.setItem(key, JSON.stringify(next));
}

export async function clearPendingBotMessages(scope: PendingBotMessageScope): Promise<void> {
  const key = pendingBotMessagesKey(scope);
  if (!key) return;
  try { await storage.removeItem(key); } catch {}
}
