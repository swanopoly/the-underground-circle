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
import { supabase } from './supabase';

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

export async function listThreadMembers(threadId: string): Promise<CircleChatThreadMember[]> {
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
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name, username')
    .in('id', ids);
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
    p_default_model: 'auto',
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
      default_model: 'auto',
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
  const nextModel = defaultModel?.trim() || 'auto';
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
    setLoading(true);
    listVisibleThreads(circleId)
      .then(rows => { if (!cancelled) setThreads(rows); })
      .catch(err => console.warn('[circleChatThreads] listVisibleThreads failed:', err))
      .finally(() => { if (!cancelled) setLoading(false); });

    const channel = supabase
      .channel(`circle_chat_threads:${circleId}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'circle_chat_threads', filter: `circle_id=eq.${circleId}` },
          async () => {
            try {
              const rows = await listVisibleThreads(circleId);
              if (!cancelled) setThreads(rows);
            } catch {}
          })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
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
