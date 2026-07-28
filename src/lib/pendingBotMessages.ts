import { storage } from './storage';
import { readPersistedChatBotMetadata } from './persistedChatMetadata';
import type { ComputerTaskOutcomeStatus } from './computerTaskOutcome';

export type PendingBotMessageRecord = {
  localMessageId: string;
  content: string;
  createdAt: string;
  isBot?: boolean;
  isUser?: boolean;
  userName?: string;
  replyTo?: { name: string; content: string } | null;
  reactions?: Record<string, string[]>;
  source?: unknown;
  usage?: unknown;
  runId?: string | null;
  delegatedTo?: string;
  delegatedSubagents?: string[];
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

function pendingBotMessagesKey(threadId: string): string {
  return `uc_pending_bot_messages_${threadId}`;
}

export async function loadPendingBotMessages(threadId: string | null | undefined): Promise<PendingBotMessageRecord[]> {
  if (!threadId) return [];
  try {
    const raw = await storage.getItem(pendingBotMessagesKey(threadId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as PendingBotMessageRecord[] : [];
  } catch {
    return [];
  }
}

export async function savePendingBotMessage(
  threadId: string | null | undefined,
  record: PendingBotMessageRecord,
): Promise<void> {
  if (!threadId) return;
  const existing = await loadPendingBotMessages(threadId);
  const next = [
    ...existing.filter((entry) => entry.localMessageId !== record.localMessageId),
    record,
  ].slice(-30);
  await storage.setItem(pendingBotMessagesKey(threadId), JSON.stringify(next));
}

export async function removePendingBotMessage(
  threadId: string | null | undefined,
  localMessageId: string | null | undefined,
): Promise<void> {
  if (!threadId || !localMessageId) return;
  const existing = await loadPendingBotMessages(threadId);
  const next = existing.filter((entry) => entry.localMessageId !== localMessageId);
  if (next.length === 0) {
    await storage.removeItem(pendingBotMessagesKey(threadId));
    return;
  }
  await storage.setItem(pendingBotMessagesKey(threadId), JSON.stringify(next));
}

export async function reconcilePendingBotMessages(
  threadId: string | null | undefined,
  persistedContents: Array<string | null | undefined | { content?: string | null; created_at?: string | null; createdAt?: string | null; is_bot?: boolean | null; isBot?: boolean | null }>,
): Promise<void> {
  if (!threadId) return;
  const persisted = persistedContents.map(normalizePersistedMessageSnapshot);
  const seenIds = new Set(
    persisted
      .map((message) => readPersistedChatBotMetadata(message.content)?.localMessageId || null)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  const existing = await loadPendingBotMessages(threadId);
  const next = existing.filter((entry) => (
    !seenIds.has(entry.localMessageId)
    && !persisted.some((message) => looksLikePersistedUserMessage(entry, message))
  ));
  if (next.length === existing.length) return;
  if (next.length === 0) {
    await storage.removeItem(pendingBotMessagesKey(threadId));
    return;
  }
  await storage.setItem(pendingBotMessagesKey(threadId), JSON.stringify(next));
}

export async function clearPendingBotMessages(threadId: string | null | undefined): Promise<void> {
  if (!threadId) return;
  try {
    await storage.removeItem(pendingBotMessagesKey(threadId));
  } catch {}
}
