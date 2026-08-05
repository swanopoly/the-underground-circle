import { supabase } from './supabase';
import {
  BOT_META_MARKER,
  buildLegacyPersistedChatFallback,
  canReleasePendingAfterPersistedChatRoundTrip,
} from './persistedChatMetadata';
import {
  normalizePersistedMessageReactions,
  type PersistedMessageReactions,
} from './chatMessageShape';

export interface ChatCurrentUserProfile {
  id: string;
  displayName: string;
}

export interface PersistedChatMessageRow {
  id: string;
  circle_id: string;
  user_id: string;
  content: string;
  reply_to?: string | null;
  created_at: string;
  is_bot?: boolean;
  reactions?: Record<string, unknown> | null;
  user?: {
    username?: string | null;
    display_name?: string | null;
  } | null;
  thread_id?: string | null;
  reply?: {
    id: string;
    content: string;
    user_id: string;
    is_bot?: boolean;
    user?: {
      username?: string | null;
      display_name?: string | null;
    } | null;
  } | null;
}

export interface CircleChatMemberOption {
  id: string;
  username: string | null;
  display_name: string | null;
}

export interface PersistChatMessageInput {
  circleId: string;
  userId: string;
  content: string;
  threadId?: string | null;
  replyToId?: string | null;
  isBot?: boolean;
  reactions?: Record<string, unknown>;
}

export interface PersistedChatMessageCursor {
  createdAt: string;
  id: string;
}

const MESSAGE_SELECT =
  'id, circle_id, user_id, content, reply_to, created_at, is_bot, reactions, thread_id, user:profiles(username, display_name)';
const FALLBACK_MESSAGE_SELECT =
  'id, circle_id, user_id, content, reply_to, created_at, thread_id, user:profiles(username, display_name)';

function isColumnMissingError(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    error.message?.includes('does not exist') === true
  );
}

async function attachReplyPreviews(
  rows: PersistedChatMessageRow[],
  fallbackSchema = false,
): Promise<PersistedChatMessageRow[]> {
  const parentIds = Array.from(new Set(
    rows.map((row) => row.reply_to).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )).slice(0, 50);
  if (parentIds.length === 0) return rows;

  const fullSelect = 'id, content, user_id, is_bot, user:profiles(username, display_name)';
  const fallbackSelect = 'id, content, user_id, user:profiles(username, display_name)';
  const initial = await (supabase
    .from('messages')
    .select(fallbackSchema ? fallbackSelect : fullSelect)
    .in('id', parentIds) as any);
  let data: any[] | null = initial.data || null;
  let error: { code?: string; message?: string } | null = initial.error || null;
  if (error && !fallbackSchema && isColumnMissingError(error)) {
    const fallback = await (supabase.from('messages').select(fallbackSelect).in('id', parentIds) as any);
    data = fallback.data || null;
    error = fallback.error || null;
  }
  // Reply context is helpful but must never make the transcript unavailable.
  // RLS may also intentionally hide a parent; those rows simply keep null.
  if (error) return rows;
  const parents = new Map<string, PersistedChatMessageRow['reply']>(
    ((data || []) as any[]).map((row) => [row.id, row as PersistedChatMessageRow['reply']]),
  );
  return rows.map((row) => ({ ...row, reply: row.reply_to ? parents.get(row.reply_to) || null : null }));
}

/**
 * A CHECK-constraint violation — specifically the `messages_content_check`
 * length cap. Surfaced as Postgres code 23514 / a "violates check constraint"
 * message. Pre-migration the cap is 1000 chars (see
 * `20260612_messages_content_cap.sql`), which long agent/recovery messages
 * exceed; we retry with a bounded fallback so persistence degrades gracefully
 * instead of hard-failing with a 400.
 */
function isContentCheckViolation(error: { code?: string; message?: string } | null | undefined): boolean {
  return !!error && (
    error.code === '23514' ||
    /content_check|violates check constraint/i.test(error.message || '')
  );
}

/** Pre-migration DB cap on messages.content. Truncate to just under it. */
const MESSAGES_CONTENT_FALLBACK_CAP = 1000;

export function truncateMessageContentForColumn(content: string, cap = MESSAGES_CONTENT_FALLBACK_CAP): string {
  const text = String(content ?? '');
  if (text.length <= cap) return text;
  const marker = '… (truncated)';
  return `${text.slice(0, Math.max(0, cap - marker.length))}${marker}`;
}

function contentCheckFallback(
  content: string,
  isBot: boolean,
  cap = MESSAGES_CONTENT_FALLBACK_CAP,
): string {
  if (isBot || content.includes(BOT_META_MARKER)) {
    const fallback = buildLegacyPersistedChatFallback(content, cap);
    // The builder's return type makes this invariant explicit. Keep the guard
    // at the persistence boundary in case a future implementation weakens it.
    if (!fallback.safeToPersist) {
      throw new Error('Unsafe persisted Chat fallback was rejected.');
    }
    return fallback.content;
  }
  return truncateMessageContentForColumn(content, cap);
}

function persistedMessageIdAfterRoundTrip(
  data: { id?: string | null; content?: string | null } | null | undefined,
  isBot: boolean,
  submittedContent: string,
): string | null {
  const id = data?.id || null;
  if (!id || !isBot) return id;
  const content = typeof data?.content === 'string' ? data.content : '';
  return canReleasePendingAfterPersistedChatRoundTrip({
    submittedContent,
    persistedContent: content,
    isBot,
  }) ? id : null;
}

export async function getCurrentChatUserProfile(): Promise<ChatCurrentUserProfile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, username')
    .eq('id', user.id)
    .single();

  return {
    id: user.id,
    displayName: profile?.display_name || profile?.username || 'You',
  };
}

export async function loadCircleChatMembers(circleId: string): Promise<CircleChatMemberOption[]> {
  const { data } = await supabase
    .from('circle_members')
    .select('user:profiles(id, username, display_name)')
    .eq('circle_id', circleId);

  return (data || []).map((row: any) => row.user).filter(Boolean);
}

export async function loadThreadMessages(
  circleId: string,
  threadId?: string | null,
  limit = 50,
): Promise<{ rows: PersistedChatMessageRow[]; usedFallback: boolean }> {
  // Fetch the NEWEST `limit` rows (was previously ORDER BY ASC — which returned
  // the OLDEST 100 for any thread exceeding the limit, hiding recent chat
  // from the user). We order DESC on the DB side for the index win, then
  // reverse to ASC client-side so the consumer can append without flipping
  // a flag.
  let query = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (threadId) query = query.eq('thread_id', threadId);
  const { data, error } = await query;

  if (!error) {
    const rows = (data || []) as PersistedChatMessageRow[];
    const hydrated = await attachReplyPreviews(rows, false);
    return { rows: hydrated.reverse(), usedFallback: false };
  }

  if (!isColumnMissingError(error)) throw error;

  let fallbackQuery = supabase
    .from('messages')
    .select(FALLBACK_MESSAGE_SELECT)
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  if (threadId) fallbackQuery = fallbackQuery.eq('thread_id', threadId);
  const { data: fallback, error: fallbackError } = await fallbackQuery;
  if (fallbackError) throw fallbackError;
  const rows = (fallback || []) as PersistedChatMessageRow[];
  const hydrated = await attachReplyPreviews(rows, true);
  return { rows: hydrated.reverse(), usedFallback: true };
}

/**
 * Load messages strictly older than a cursor timestamp. Used for
 * scroll-to-top pagination — the caller passes the `created_at` of the
 * oldest row currently in state, and gets back the next older `limit`
 * messages in ASC order.
 */
export async function loadOlderThreadMessages(
  circleId: string,
  threadId: string | null | undefined,
  olderThan: string | PersistedChatMessageCursor,
  limit = 50,
): Promise<{ rows: PersistedChatMessageRow[]; hasMore: boolean }> {
  const cursor = typeof olderThan === 'string'
    ? { createdAt: olderThan, id: '' }
    : olderThan;
  let query = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);

  query = cursor.id
    ? query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
    : query.lt('created_at', cursor.createdAt);

  if (threadId) query = query.eq('thread_id', threadId);
  const { data, error } = await query;
  if (error) {
    // One-shot fallback for pre-migration schemas.
    if (!isColumnMissingError(error)) throw error;
    let fb = supabase
      .from('messages')
      .select(FALLBACK_MESSAGE_SELECT)
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    fb = cursor.id
      ? fb.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`)
      : fb.lt('created_at', cursor.createdAt);
    if (threadId) fb = fb.eq('thread_id', threadId);
    const { data: fbData, error: fbErr } = await fb;
    if (fbErr) throw fbErr;
    const rows = (fbData || []) as PersistedChatMessageRow[];
    const hydrated = await attachReplyPreviews(rows, true);
    return { rows: hydrated.reverse(), hasMore: rows.length >= limit };
  }
  const rows = (data || []) as PersistedChatMessageRow[];
  const hydrated = await attachReplyPreviews(rows, false);
  return { rows: hydrated.reverse(), hasMore: rows.length >= limit };
}

/**
 * Mirror of `loadOlderThreadMessages` for the forward direction — returns
 * messages strictly NEWER than a cursor timestamp. Used by the ChatTab
 * realtime-fallback polling loop: when Supabase Realtime drops (tab
 * throttled, proxy hiccup, network blip), we poll with the newest known
 * message's `created_at` so users don't silently miss incoming messages.
 */
export async function loadNewerThreadMessages(
  circleId: string,
  threadId: string | null | undefined,
  newerThan: string,
  limit = 50,
): Promise<{ rows: PersistedChatMessageRow[] }> {
  let query = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('circle_id', circleId)
    .gt('created_at', newerThan)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (threadId) query = query.eq('thread_id', threadId);
  const { data, error } = await query;
  if (error) {
    if (!isColumnMissingError(error)) throw error;
    let fb = supabase
      .from('messages')
      .select(FALLBACK_MESSAGE_SELECT)
      .eq('circle_id', circleId)
      .gt('created_at', newerThan)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (threadId) fb = fb.eq('thread_id', threadId);
    const { data: fbData, error: fbErr } = await fb;
    if (fbErr) throw fbErr;
    return { rows: await attachReplyPreviews((fbData || []) as PersistedChatMessageRow[], true) };
  }
  return { rows: await attachReplyPreviews((data || []) as PersistedChatMessageRow[], false) };
}

export async function persistChatMessage(input: PersistChatMessageInput): Promise<string | null> {
  const payload = {
    circle_id: input.circleId,
    user_id: input.userId,
    content: input.content,
    reactions: input.reactions || {},
    is_bot: input.isBot === true,
    ...(input.threadId ? { thread_id: input.threadId } : {}),
    ...(input.replyToId ? { reply_to: input.replyToId } : {}),
  };

  const { data, error } = await supabase
    .from('messages')
    .insert(payload)
    .select('id, content')
    .single();

  if (!error) return persistedMessageIdAfterRoundTrip(data, input.isBot === true, payload.content);

  // Long agent/recovery messages exceed the pre-migration 1000-char cap. Retry
  // once with a parseable minimal envelope. Arbitrary truncation can cut the
  // JSON metadata suffix and erase completion/source lineage after reload.
  if (isContentCheckViolation(error)) {
    const legacyContent = contentCheckFallback(input.content, input.isBot === true);
    const { data: truncatedData, error: truncatedError } = await supabase
      .from('messages')
      .insert({ ...payload, content: legacyContent })
      .select('id, content')
      .single();
    if (!truncatedError) return persistedMessageIdAfterRoundTrip(truncatedData, input.isBot === true, legacyContent);
    if (!isColumnMissingError(truncatedError)) throw truncatedError;
  } else if (!isColumnMissingError(error)) {
    throw error;
  }

  const fallbackPayload = {
    circle_id: input.circleId,
    user_id: input.userId,
    content: truncateMessageContentForColumn(input.content, 100_000),
    ...(input.threadId ? { thread_id: input.threadId } : {}),
    ...(input.replyToId ? { reply_to: input.replyToId } : {}),
  };

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('messages')
    .insert(fallbackPayload)
    .select('id, content')
    .single();

  if (fallbackError && isContentCheckViolation(fallbackError)) {
    const legacyContent = contentCheckFallback(input.content, input.isBot === true);
    const { data: lastData, error: lastError } = await supabase
      .from('messages')
      .insert({ ...fallbackPayload, content: legacyContent })
      .select('id, content')
      .single();
    if (lastError) throw lastError;
    return persistedMessageIdAfterRoundTrip(lastData, input.isBot === true, legacyContent);
  }
  if (fallbackError) throw fallbackError;
  return persistedMessageIdAfterRoundTrip(fallbackData, input.isBot === true, fallbackPayload.content);
}

export async function updateChatMessageContent(messageId: string, content: string): Promise<boolean> {
  const { error } = await supabase
    .from('messages')
    .update({ content })
    .eq('id', messageId);

  if (!error) return true;
  if (isContentCheckViolation(error)) {
    const legacyContent = contentCheckFallback(content, content.includes(BOT_META_MARKER));
    const { error: legacyError } = await supabase
      .from('messages')
      .update({ content: legacyContent })
      .eq('id', messageId);
    if (legacyError) throw legacyError;
    return true;
  }
  if (!isColumnMissingError(error)) throw error;

  const { error: fallbackError } = await supabase
    .from('messages')
    .update({ content })
    .eq('id', messageId);

  if (fallbackError) throw fallbackError;
  return true;
}

/** Atomic caller-only reaction mutation; callers never replace the JSON blob. */
export async function setMessageReaction(
  messageId: string,
  emoji: string,
  add: boolean,
): Promise<PersistedMessageReactions> {
  const { data, error } = await supabase.rpc('set_message_reaction', {
    p_message_id: messageId,
    p_emoji: emoji,
    p_add: add,
  });
  if (error) throw error;
  return normalizePersistedMessageReactions(data);
}

/** Read-only recovery after an RPC/transport failure. */
export async function loadMessageReactions(messageId: string): Promise<PersistedMessageReactions> {
  const { data, error } = await supabase
    .from('messages')
    .select('reactions')
    .eq('id', messageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Message is no longer available.');
  return normalizePersistedMessageReactions(data.reactions || {});
}
