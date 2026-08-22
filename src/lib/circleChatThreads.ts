/**
 * Circle Chat Threads
 *
 * Threaded conversations on top of the existing per-circle messages stream.
 * See supabase/migrations/20260414_circle_chat_threads.sql for the schema.
 *
 *   circle  — auto-created default thread, visible to all circle members
 *   private — owner-only until someone is invited
 *   shared  — promoted from `private` automatically when a non-owner joins
 *
 * Each `messages` row carries a `thread_id`; the migration backfills existing
 * rows into their circle's default thread.
 */

import { useEffect, useState } from 'react';
import { DEFAULT_CHAT_MODEL } from './chatSessionTitleCore';
import { supabase } from './supabase';
import { subscribeWithReconnect } from './subscribeWithReconnect';
import { loadSafeCircleProfiles } from './safeProfiles';

export type ThreadVisibility = 'circle' | 'private' | 'shared';

export interface CircleChatThread {
  id: string;
  circle_id: string;
  created_by: string;
  title: string;
  visibility: ThreadVisibility;
  default_model: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  /**
   * Lineage (20260508_chat_threads_lineage.sql) — present in the DB since
   * compression forks, but dropped from this interface until Phase 4b of
   * docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md made lineage visible in the
   * thread header. `select('*')` already returns them.
   */
  parent_thread_id?: string | null;
  lineage_root_id?: string | null;
}

export interface CircleChatThreadMember {
  thread_id: string;
  user_id: string;
  role: 'owner' | 'member';
  added_by: string | null;
  added_at: string;
  display_name?: string | null;
  username?: string | null;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listVisibleThreads(circleId: string): Promise<CircleChatThread[]> {
  const { data, error } = await supabase
    .from('circle_chat_threads')
    .select('*')
    .eq('circle_id', circleId)
    .eq('archived', false)
    .order('last_message_at', { ascending: false });
  if (error) throw error;
  return (data || []) as CircleChatThread[];
}

export async function getThread(threadId: string): Promise<CircleChatThread | null> {
  const { data } = await supabase
    .from('circle_chat_threads')
    .select('*')
    .eq('id', threadId)
    .maybeSingle();
  return (data as CircleChatThread) || null;
}

export async function getCircleDefaultThread(circleId: string): Promise<CircleChatThread | null> {
  const { data } = await supabase
    .from('circle_chat_threads')
    .select('*')
    .eq('circle_id', circleId)
    .eq('visibility', 'circle')
    .maybeSingle();
  return (data as CircleChatThread) || null;
}

export async function listThreadMembers(threadId: string, circleId: string): Promise<CircleChatThreadMember[]> {
  // The FK on circle_chat_thread_members.user_id points to auth.users — not
  // public.profiles — so PostgREST can't auto-resolve a `profiles!user_id`
  // embed. Fetch the membership rows and hydrate display info in a second
  // query keyed on profile id.
  const { data: rows, error } = await supabase
    .from('circle_chat_thread_members')
    .select('thread_id, user_id, role, added_by, added_at')
    .eq('thread_id', threadId);
  if (error) throw error;
  const members = (rows || []) as Array<{
    thread_id: string; user_id: string; role: 'owner' | 'member';
    added_by: string | null; added_at: string;
  }>;
  const ids = members.map(m => m.user_id);
  if (ids.length === 0) return [];
  const profiles = await loadSafeCircleProfiles({ circleId, userIds: ids });
  const profileMap = new Map<string, { display_name: string | null; username: string | null }>(
    (profiles || []).map((p: any) => [p.id, { display_name: p.display_name ?? null, username: p.username ?? null }]),
  );
  return members.map(m => ({
    ...m,
    display_name: profileMap.get(m.user_id)?.display_name ?? null,
    username: profileMap.get(m.user_id)?.username ?? null,
  }));
}

// ─── Write ───────────────────────────────────────────────────────────────────

export async function createPrivateThread(
  circleId: string,
  title?: string,
): Promise<CircleChatThread> {
  const trimmedTitle = title?.trim() || 'OpenSwan Session';
  const { data: threadId, error: rpcError } = await supabase.rpc('create_private_chat_thread', {
    p_circle_id: circleId,
    p_title: trimmedTitle,
    p_default_model: DEFAULT_CHAT_MODEL,
  });

  if (!rpcError && threadId) {
    const thread = await getThread(threadId as string);
    if (thread) return thread;
  }

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { data, error } = await supabase
    .from('circle_chat_threads')
    .insert({
      circle_id: circleId,
      created_by: auth.user.id,
      title: trimmedTitle,
      visibility: 'private',
      default_model: DEFAULT_CHAT_MODEL,
    })
    .select('*')
    .single();

  if (error) throw rpcError || error;
  return data as CircleChatThread;
}

export async function renameThread(threadId: string, title: string): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  const { error } = await supabase
    .from('circle_chat_threads')
    .update({ title: trimmed, updated_at: new Date().toISOString() })
    .eq('id', threadId);
  if (error) throw error;
}

export async function updateThreadDefaultModel(threadId: string, defaultModel: string | null): Promise<void> {
  const nextModel = defaultModel?.trim() || DEFAULT_CHAT_MODEL;
  const { error } = await supabase
    .from('circle_chat_threads')
    .update({ default_model: nextModel, updated_at: new Date().toISOString() })
    .eq('id', threadId);
  if (error) throw error;
}

export async function archiveThread(threadId: string): Promise<void> {
  const { error } = await supabase
    .from('circle_chat_threads')
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq('id', threadId);
  if (error) throw error;
}

export async function deleteThread(threadId: string): Promise<void> {
  const { error } = await supabase
    .from('circle_chat_threads')
    .delete()
    .eq('id', threadId);
  if (error) throw error;
}

// ─── Membership ──────────────────────────────────────────────────────────────

export async function addThreadMember(threadId: string, userId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  const { error } = await supabase.from('circle_chat_thread_members').insert({
    thread_id: threadId,
    user_id: userId,
    role: 'member',
    added_by: auth.user.id,
  });
  // unique-violation = already a member, fine
  if (error && (error as any).code !== '23505') throw error;
}

export async function removeThreadMember(threadId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('circle_chat_thread_members')
    .delete()
    .eq('thread_id', threadId)
    .eq('user_id', userId);
  if (error) throw error;
}

export async function leaveThread(threadId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');
  await removeThreadMember(threadId, auth.user.id);
}

// ─── React hook ──────────────────────────────────────────────────────────────

export function useThreads(circleId: string | null, refreshToken = 0) {
  const [threads, setThreads] = useState<CircleChatThread[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!circleId) {
      setThreads([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let refreshInFlight = false;
    let refreshQueued = false;
    let completedFirstSubscribeCatchUp = false;
    setLoading(true);

    // Serialize and coalesce full snapshots. Realtime events, the first-subscribe
    // race closer, and reconnect/staleness catch-ups can arrive close together;
    // allowing those requests to race lets an older response overwrite a newer
    // thread ordering. One in-flight fetch plus one queued replay is enough to
    // converge on the latest durable snapshot without hammering PostgREST.
    const refreshThreads = async (reason: string): Promise<void> => {
      if (cancelled) return;
      if (refreshInFlight) {
        refreshQueued = true;
        return;
      }
      refreshInFlight = true;
      try {
        do {
          refreshQueued = false;
          try {
            const rows = await listVisibleThreads(circleId);
            if (!cancelled) setThreads(rows);
          } catch (err) {
            if (!cancelled) {
              console.warn(`[circleChatThreads] listVisibleThreads failed (${reason}):`, err);
            }
          }
        } while (refreshQueued && !cancelled);
      } finally {
        refreshInFlight = false;
      }
    };

    // Initial-load semantics remain unchanged: only the mount/refresh-token
    // snapshot owns `loading`. Background Realtime catch-ups retain the last
    // good list and never flash the sidebar back into a loading state.
    void refreshThreads('initial')
      .finally(() => { if (!cancelled) setLoading(false); });

    const subscription = subscribeWithReconnect({
      channelName: `circle_chat_threads:${circleId}`,
      // Supabase cannot safely filter Postgres DELETE events. INSERT/UPDATE
      // cover creation, rename, archive, sharing, and ordering changes; a
      // bounded heartbeat snapshot repairs hard deletes without cross-circle
      // DELETE fanout or false security assumptions.
      setup: (channel) => channel
        .on('postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'circle_chat_threads', filter: `circle_id=eq.${circleId}` },
          () => { void refreshThreads('realtime insert'); })
        .on('postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'circle_chat_threads', filter: `circle_id=eq.${circleId}` },
          () => { void refreshThreads('realtime update'); }),
      // The shared primitive invokes this after a reconnect and whenever a
      // subscribed channel has gone silently stale, backfilling missed rows.
      onCatchUp: () => { void refreshThreads('reconnect or silent staleness'); },
      onStateChange: (state) => {
        if (state !== 'subscribed' || completedFirstSubscribeCatchUp) return;
        completedFirstSubscribeCatchUp = true;
        // subscribeWithReconnect intentionally skips onCatchUp for the first
        // subscription because most callers only need an initial fetch. Thread
        // ordering needs one extra snapshot to close the fetch-to-subscribe gap.
        void refreshThreads('first subscribe');
      },
      // Chat thread lists are often legitimately quiet. Two minutes preserves
      // silent-staleness recovery without turning that quiet into a 30s poll.
      heartbeatMs: 120_000,
    });

    return () => {
      cancelled = true;
      refreshQueued = false;
      subscription.unsubscribe();
    };
  }, [circleId, refreshToken]);

  return { threads, loading };
}

// ─── Sidebar helpers ─────────────────────────────────────────────────────────

export function groupThreadsByDate(threads: CircleChatThread[]): Array<{ label: string; items: CircleChatThread[] }> {
  const now = Date.now();
  const today: CircleChatThread[] = [];
  const yesterday: CircleChatThread[] = [];
  const week: CircleChatThread[] = [];
  const earlier: CircleChatThread[] = [];
  const day = 24 * 60 * 60 * 1000;
  for (const t of threads) {
    const ts = new Date(t.last_message_at).getTime();
    const ageMs = now - ts;
    if (ageMs < day) today.push(t);
    else if (ageMs < 2 * day) yesterday.push(t);
    else if (ageMs < 7 * day) week.push(t);
    else earlier.push(t);
  }
  const groups: Array<{ label: string; items: CircleChatThread[] }> = [];
  if (today.length) groups.push({ label: 'TODAY', items: today });
  if (yesterday.length) groups.push({ label: 'YESTERDAY', items: yesterday });
  if (week.length) groups.push({ label: 'THIS WEEK', items: week });
  if (earlier.length) groups.push({ label: 'EARLIER', items: earlier });
  return groups;
}
