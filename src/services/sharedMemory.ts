/**
 * sharedMemory — Circle Memory Bank CRUD + realtime hook.
 *
 * Now supports three named docs per circle (`doc_kind`):
 *   - `brief`          — stable "what is this circle" summary
 *   - `active_context` — what we're working on right now
 *   - `progress`       — what has shipped, what remains
 *
 * Legacy callers that don't pass `docKind` still read/write the `brief`
 * doc, which matches the pre-migration semantics.
 */

import { supabase } from '../lib/supabase';
import { useEffect, useState } from 'react';
import {
  ALL_MEMORY_DOC_KINDS,
  MEMORY_DOC_KIND_LABELS,
  MEMORY_DOC_KIND_DESCRIPTIONS,
  parseMemoryDocKind,
  type MemoryDocKind,
} from '../lib/memoryBankKinds';

export {
  ALL_MEMORY_DOC_KINDS,
  MEMORY_DOC_KIND_LABELS,
  MEMORY_DOC_KIND_DESCRIPTIONS,
  parseMemoryDocKind,
  MemoryDocKind,
};

export interface MemoryDoc {
  id: string;
  circle_id: string;
  content: string;
  last_edited_by: string | null;
  last_edited_at: string;
  version: number;
  doc_kind: MemoryDocKind;
}

export interface MemoryHistory {
  id: string;
  circle_id: string;
  content: string;
  edited_by: string | null;
  edited_at: string;
  version: number;
  doc_kind: MemoryDocKind;
}

export async function getMemoryDoc(
  circleId: string,
  docKind: MemoryDocKind = 'brief',
): Promise<MemoryDoc | null> {
  const { data } = await supabase
    .from('circle_memory')
    .select('*')
    .eq('circle_id', circleId)
    .eq('doc_kind', docKind)
    .maybeSingle();
  return data as MemoryDoc | null;
}

export async function getAllMemoryDocs(
  circleId: string,
): Promise<Record<MemoryDocKind, MemoryDoc | null>> {
  const { data } = await supabase
    .from('circle_memory')
    .select('*')
    .eq('circle_id', circleId);
  const rows = (data || []) as MemoryDoc[];
  const out: Record<MemoryDocKind, MemoryDoc | null> = {
    brief: null,
    active_context: null,
    progress: null,
  };
  for (const row of rows) {
    if (row.doc_kind in out) out[row.doc_kind] = row;
  }
  return out;
}

export async function updateMemoryDoc(
  circleId: string,
  content: string,
  userId: string,
  docKind: MemoryDocKind = 'brief',
): Promise<void> {
  const existing = await getMemoryDoc(circleId, docKind);
  if (existing) {
    await supabase.from('circle_memory_history').insert({
      circle_id: circleId,
      doc_kind: docKind,
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
      .eq('circle_id', circleId)
      .eq('doc_kind', docKind);
  } else {
    await supabase.from('circle_memory').insert({
      circle_id: circleId,
      doc_kind: docKind,
      content,
      last_edited_by: userId,
      last_edited_at: new Date().toISOString(),
      version: 1,
    });
  }
}

export async function getMemoryHistory(
  circleId: string,
  docKind: MemoryDocKind | null = 'brief',
  limit = 20,
): Promise<MemoryHistory[]> {
  let q = supabase
    .from('circle_memory_history')
    .select('*')
    .eq('circle_id', circleId)
    .order('edited_at', { ascending: false })
    .limit(limit);
  if (docKind) q = q.eq('doc_kind', docKind);
  const { data } = await q;
  return (data || []) as MemoryHistory[];
}

/**
 * Realtime hook for a single doc. Pass `docKind` to subscribe to one
 * specific doc; omit to use the legacy `brief` default.
 */
export function useMemoryDoc(
  circleId?: string,
  docKind: MemoryDocKind = 'brief',
): MemoryDoc | null {
  const [doc, setDoc] = useState<MemoryDoc | null>(null);

  useEffect(() => {
    if (!circleId) return;
    getMemoryDoc(circleId, docKind).then(setDoc);
    const ch = supabase
      .channel('circle_memory_' + circleId + '_' + docKind)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'circle_memory',
          filter: 'circle_id=eq.' + circleId,
        },
        () => getMemoryDoc(circleId, docKind).then(setDoc),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [circleId, docKind]);

  return doc;
}

// `parseMemoryDocKind` is re-exported at the top of this file from the
// pure `memoryBankKinds` module — do not redefine it here.
