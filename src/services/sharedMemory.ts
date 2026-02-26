import { supabase } from '../lib/supabase';
import { useEffect, useState } from 'react';

export interface MemoryDoc {
  id: string;
  circle_id: string;
  content: string;
  last_edited_by: string | null;
  last_edited_at: string;
  version: number;
}

export interface MemoryHistory {
  id: string;
  circle_id: string;
  content: string;
  edited_by: string | null;
  edited_at: string;
  version: number;
}

export async function getMemoryDoc(circleId: string): Promise<MemoryDoc | null> {
  const { data } = await supabase
    .from('circle_memory')
    .select('*')
    .eq('circle_id', circleId)
    .single();
  return data;
}

export async function updateMemoryDoc(
  circleId: string,
  content: string,
  userId: string,
): Promise<void> {
  const existing = await getMemoryDoc(circleId);
  if (existing) {
    // Archive current version
    await supabase.from('circle_memory_history').insert({
      circle_id: circleId,
      content: existing.content,
      edited_by: existing.last_edited_by,
      edited_at: existing.last_edited_at,
      version: existing.version,
    });
    await supabase
      .from('circle_memory')
      .update({
        content,
        last_edited_by: userId,
        last_edited_at: new Date().toISOString(),
        version: existing.version + 1,
      })
      .eq('circle_id', circleId);
  } else {
    await supabase.from('circle_memory').insert({
      circle_id: circleId,
      content,
      last_edited_by: userId,
      last_edited_at: new Date().toISOString(),
      version: 1,
    });
  }
}

export async function getMemoryHistory(
  circleId: string,
  limit = 20,
): Promise<MemoryHistory[]> {
  const { data } = await supabase
    .from('circle_memory_history')
    .select('*')
    .eq('circle_id', circleId)
    .order('edited_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export function useMemoryDoc(circleId?: string): MemoryDoc | null {
  const [doc, setDoc] = useState<MemoryDoc | null>(null);

  useEffect(() => {
    if (!circleId) return;
    getMemoryDoc(circleId).then(setDoc);
    const ch = supabase
      .channel('circle_memory_' + circleId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'circle_memory',
          filter: 'circle_id=eq.' + circleId,
        },
        () => getMemoryDoc(circleId).then(setDoc),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [circleId]);

  return doc;
}
