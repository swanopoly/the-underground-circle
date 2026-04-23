import { supabase } from './supabase';

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
    .limit(limit);

  if (threadId) query = query.eq('thread_id', threadId);
  const { data, error } = await query;

  if (!error) {
    const rows = (data || []) as PersistedChatMessageRow[];
    return { rows: rows.reverse(), usedFallback: false };
  }

  if (!isColumnMissingError(error)) throw error;

  let fallbackQuery = supabase
    .from('messages')
    .select(FALLBACK_MESSAGE_SELECT)
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (threadId) fallbackQuery = fallbackQuery.eq('thread_id', threadId);
  const { data: fallback, error: fallbackError } = await fallbackQuery;
  if (fallbackError) throw fallbackError;
  const rows = (fallback || []) as PersistedChatMessageRow[];
  return { rows: rows.reverse(), usedFallback: true };
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
  olderThan: string,
  limit = 50,
): Promise<{ rows: PersistedChatMessageRow[]; hasMore: boolean }> {
  let query = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('circle_id', circleId)
    .lt('created_at', olderThan)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (threadId) query = query.eq('thread_id', threadId);
  const { data, error } = await query;
  if (error) {
    // One-shot fallback for pre-migration schemas.
    if (!isColumnMissingError(error)) throw error;
    let fb = supabase
      .from('messages')
      .select(FALLBACK_MESSAGE_SELECT)
      .eq('circle_id', circleId)
      .lt('created_at', olderThan)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (threadId) fb = fb.eq('thread_id', threadId);
    const { data: fbData, error: fbErr } = await fb;
    if (fbErr) throw fbErr;
    const rows = (fbData || []) as PersistedChatMessageRow[];
    return { rows: rows.reverse(), hasMore: rows.length >= limit };
  }
  const rows = (data || []) as PersistedChatMessageRow[];
  return { rows: rows.reverse(), hasMore: rows.length >= limit };
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
    return { rows: (fbData || []) as PersistedChatMessageRow[] };
  }
  return { rows: (data || []) as PersistedChatMessageRow[] };
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
    .select('id')
    .single();

  if (!error) return data?.id || null;
  if (!isColumnMissingError(error)) throw error;

  const fallbackPayload = {
    circle_id: input.circleId,
    user_id: input.userId,
    content: input.content,
    ...(input.threadId ? { thread_id: input.threadId } : {}),
    ...(input.replyToId ? { reply_to: input.replyToId } : {}),
  };

  const { data: fallbackData, error: fallbackError } = await supabase
    .from('messages')
    .insert(fallbackPayload)
    .select('id')
    .single();

  if (fallbackError) throw fallbackError;
  return fallbackData?.id || null;
}

export async function updateChatMessageContent(messageId: string, content: string): Promise<boolean> {
  const { error } = await supabase
    .from('messages')
    .update({ content })
    .eq('id', messageId);

  if (!error) return true;
  if (!isColumnMissingError(error)) throw error;

  const { error: fallbackError } = await supabase
    .from('messages')
    .update({ content })
    .eq('id', messageId);

  if (fallbackError) throw fallbackError;
  return true;
}
