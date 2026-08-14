import { isPersistedChatBotMessage, stripPersistedChatBotPrefix } from './persistedChatMetadata';
import type { ChatMessage } from './chatMessageTypes';

type ChatMessageShapeOptions = {
  currentUserId?: string | null;
  botDisplayName: string;
  fallbackUserName?: string;
  isBotFlag?: boolean;
};

export type ShapedChatMessageBase = {
  id: string;
  dbId?: string;
  content: string;
  isBot: boolean;
  isUser: boolean;
  userName: string;
  authorId?: string | null;
  timestamp: Date;
};

export function shapePersistedChatMessage(row: any, options: ChatMessageShapeOptions): ShapedChatMessageBase {
  const isBot = isPersistedChatBotMessage(row?.content, options.isBotFlag ?? row?.is_bot === true);
  const fallbackUserName = options.fallbackUserName || 'Unknown';

  return {
    id: row.id,
    dbId: row.id,
    content: isBot ? stripPersistedChatBotPrefix(row?.content || '') : (row?.content || ''),
    isBot,
    isUser: row?.user_id === options.currentUserId && !isBot,
    // Preserve the database author even for bot envelopes. `isBot` controls
    // presentation, not row ownership; reload-sensitive authority recovery
    // must be able to prove that the bot/run row was written for the same
    // authenticated requester instead of trusting embedded metadata alone.
    authorId: typeof row?.user_id === 'string' ? row.user_id : null,
    userName: isBot
      ? options.botDisplayName
      : (row?.user?.display_name || row?.user?.username || fallbackUserName),
    timestamp: new Date(row?.created_at || Date.now()),
  };
}

export function deriveChatActivityFlags(content: string | null | undefined) {
  const normalized = (content || '').toLowerCase();
  return {
    isCheckIn: normalized.includes('checked in') || normalized.includes('streak'),
    isAchievement: normalized.includes('achievement') || normalized.includes('unlocked'),
  };
}

const OPTIMISTIC_MESSAGE_MATCH_WINDOW_MS = 15_000;

export type PersistedMessageReactions = Record<string, string[]>;

/** Validate the exact JSON object returned by the atomic reaction RPC. */
export function normalizePersistedMessageReactions(value: unknown): PersistedMessageReactions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid message reaction state.');
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 128) throw new Error('Invalid message reaction state.');

  const normalized: PersistedMessageReactions = {};
  for (const [emoji, users] of entries) {
    if (
      !emoji
      || emoji.length > 32
      || emoji === '__proto__'
      || emoji === 'prototype'
      || emoji === 'constructor'
      || /[\u0000-\u001f\u007f]/.test(emoji)
      || !Array.isArray(users)
      || users.some((userId) => (
        typeof userId !== 'string' || !userId || userId.length > 160
      ))
      || new Set(users as string[]).size !== users.length
    ) {
      throw new Error('Invalid message reaction state.');
    }
    if (users.length > 0) normalized[emoji] = [...users] as string[];
  }
  if (JSON.stringify(normalized).length > 65_536) {
    throw new Error('Invalid message reaction state.');
  }
  return normalized;
}

function messageTimestampMs(message: ChatMessage): number {
  try {
    const value = message.timestamp instanceof Date
      ? message.timestamp.getTime()
      : new Date(message.timestamp as unknown as string).getTime();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function persistedLocalMessageId(message: ChatMessage): string | null {
  const value = message.persistedMetadataSnapshot?.localMessageId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isOptimisticMatch(current: ChatMessage, persisted: ChatMessage): boolean {
  if (current.dbId || !persisted.dbId) return false;
  if (current.isBot !== persisted.isBot || current.isUser !== persisted.isUser) return false;
  if ((current.content || '').trim() !== (persisted.content || '').trim()) return false;
  return Math.abs(messageTimestampMs(current) - messageTimestampMs(persisted))
    < OPTIMISTIC_MESSAGE_MATCH_WINDOW_MS;
}

/**
 * Reconcile a bounded authoritative database snapshot into the currently
 * mounted transcript without discarding older pages or local optimistic rows.
 *
 * Persisted rows replace (rather than shallow-merge into) their matching live
 * row. That replacement is the safety boundary: if a durable bot UPDATE has
 * removed its metadata envelope, stale approval/retry/run fields from the live
 * row cannot survive a reconnect catch-up. The local React key stays stable so
 * a mounted task card does not remount merely because its database id arrived.
 * Pending recovery rows never overwrite a richer currently mounted local row.
 */
export function reconcileChatMessageSnapshot(
  currentMessages: ChatMessage[],
  snapshotMessages: ChatMessage[],
  options?: {
    /** Snapshot is the latest bounded persisted tail, not just incremental rows. */
    authoritativeTail?: boolean;
    /** Fewer than the query limit means the snapshot covers the whole thread. */
    completeSnapshot?: boolean;
    /**
     * Persisted ids mounted when the read began. Only these rows are eligible
     * for absence-based pruning, so a Realtime row received while the query is
     * in flight cannot be mistaken for a delete.
     */
    readBaselineDbIds?: ReadonlySet<string>;
  },
): ChatMessage[] {
  const snapshotDbIds = new Set(
    snapshotMessages
      .map((message) => message.dbId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  const persistedSnapshotTimes = snapshotMessages
    .filter((message) => !!message.dbId)
    .map(messageTimestampMs)
    .filter((value) => value > 0);
  const oldestSnapshotMs = persistedSnapshotTimes.length > 0
    ? Math.min(...persistedSnapshotTimes)
    : 0;
  const readBaselineDbIds = options?.readBaselineDbIds;

  // DELETE events cannot be safely filtered in Supabase Postgres Changes.
  // During a full tail catch-up, absence is therefore authoritative only for
  // the window the snapshot actually covers. Older loaded pages and local
  // optimistic rows survive. Only rows captured in the read-start baseline can
  // be pruned, so in-flight Realtime arrivals survive without a clock check.
  const next = currentMessages.filter((message) => {
    if (!options?.authoritativeTail || !message.dbId) return true;
    if (snapshotDbIds.has(message.dbId)) return true;
    if (!readBaselineDbIds?.has(message.dbId)) return true;
    const timestampMs = messageTimestampMs(message);
    if (options.completeSnapshot) return false;
    return oldestSnapshotMs <= 0 || timestampMs < oldestSnapshotMs;
  });

  for (const incoming of snapshotMessages) {
    const incomingDbId = typeof incoming.dbId === 'string' && incoming.dbId.length > 0
      ? incoming.dbId
      : null;
    let matchIndex = incomingDbId
      ? next.findIndex((message) => message.dbId === incomingDbId)
      : next.findIndex((message) => !message.dbId && message.id === incoming.id);

    if (matchIndex < 0 && incomingDbId) {
      const localMessageId = persistedLocalMessageId(incoming);
      if (localMessageId) {
        matchIndex = next.findIndex((message) => !message.dbId && message.id === localMessageId);
      }
    }

    if (matchIndex < 0 && incomingDbId) {
      matchIndex = next.findIndex((message) => isOptimisticMatch(message, incoming));
    }

    if (matchIndex < 0) {
      next.push(incoming);
      continue;
    }

    // A storage-backed pending copy is only recovery material. The mounted
    // local row may have newer streaming text or transient UI state.
    if (!incomingDbId) continue;

    const existing = next[matchIndex];
    next[matchIndex] = {
      ...incoming,
      id: existing.id,
      dbId: incomingDbId,
    };
  }

  const seen = new Set<string>();
  return next
    .filter((message) => {
      const key = message.dbId ? `db:${message.dbId}` : `local:${message.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => messageTimestampMs(a) - messageTimestampMs(b));
}
