import { storage } from './storage';
import { readPersistedChatBotMetadata } from './persistedChatMetadata';

export type PendingBotMessageRecord = {
  localMessageId: string;
  content: string;
  createdAt: string;
  userName?: string;
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
  modeOutcomeSummary?: { headline: string; bulletPoints?: string[]; blockers?: string[] } | null;
  observedEval?: unknown;
  commandDecisions?: unknown[];
  taskPlan?: unknown;
  toolEvents?: unknown[];
  verificationResults?: unknown[];
};

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
  persistedContents: Array<string | null | undefined>,
): Promise<void> {
  if (!threadId) return;
  const seenIds = new Set(
    persistedContents
      .map((content) => readPersistedChatBotMetadata(content)?.localMessageId || null)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  );
  if (seenIds.size === 0) return;
  const existing = await loadPendingBotMessages(threadId);
  const next = existing.filter((entry) => !seenIds.has(entry.localMessageId));
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
