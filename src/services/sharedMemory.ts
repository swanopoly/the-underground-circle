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
import {
  planMemoryDocWrite,
  classifyMemoryWriteOutcome,
  MEMORY_WRITE_MAX_ATTEMPTS,
  type MemoryDocWriteResult,
} from '../lib/circleMemoryWriteCore';

export {
  ALL_MEMORY_DOC_KINDS,
  MEMORY_DOC_KIND_LABELS,
  MEMORY_DOC_KIND_DESCRIPTIONS,
  parseMemoryDocKind,
  MemoryDocKind,
  MemoryDocWriteResult,
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

/**
 * Write a shared circle-memory doc under OPTIMISTIC CONCURRENCY.
 *
 * The previous implementation read `existing`, then UPDATEd filtered only on
 * `(circle_id, doc_kind)` with `version: existing.version + 1` — no predicate on
 * the version it had actually read. Two concurrent editors both reading v3 both
 * wrote v4: the first edit vanished, and BOTH history rows archived the same
 * prior content, so the lost edit was unrecoverable even from the audit trail.
 * `circle_memory` is the shared operating doc of a multi-agent, multi-human
 * workspace (a realtime hook AND agents write it), so that race is routine.
 *
 * Now: every decision comes from the pure `circleMemoryWriteCore`; this function
 * only performs I/O. The UPDATE carries `.eq('version', expectedVersion)` and
 * `.select('id')` so a clobbered write reports 0 rows instead of succeeding
 * silently. A 0-row result is triaged against a fresh read and RETRIED against
 * the new base — a lost update must never be silent, and neither must a silent
 * no-op.
 *
 * `guardBaseContent` additionally pins the write to the content it was derived
 * from. Compaction needs this: an approved summary describes one specific
 * document, so applying it over a doc someone edited afterwards would destroy
 * that edit while looking perfectly well-audited.
 *
 * Returns a structured result, but the signature stays `Promise<…>` with all
 * existing call sites unchanged — they may keep ignoring it.
 */
export async function updateMemoryDoc(
  circleId: string,
  content: string,
  userId: string,
  docKind: MemoryDocKind = 'brief',
  opts?: { guardBaseContent?: string | null },
): Promise<MemoryDocWriteResult> {
  let attempt = 0;
  let lastMessage = 'Write did not run.';

  while (attempt < MEMORY_WRITE_MAX_ATTEMPTS) {
    attempt += 1;
    const existing = await getMemoryDoc(circleId, docKind);
    const plan = planMemoryDocWrite({
      circleId,
      existing,
      nextContent: content,
      editorId: userId,
      docKind,
      nowMs: Date.now(),
      guardBaseContent: opts?.guardBaseContent ?? null,
    });

    if (plan.action === 'refuse') {
      return {
        ok: false, status: 'refused', docKind: plan.docKind, version: existing?.version ?? null,
        conflict: null, refusedReason: plan.refusedReason, historyRecorded: false,
        attempts: attempt, message: `Refused: ${plan.refusedReason}`,
      };
    }
    if (plan.action === 'noop') {
      return {
        ok: true, status: 'unchanged', docKind: plan.docKind, version: existing?.version ?? null,
        conflict: null, refusedReason: null, historyRecorded: false,
        attempts: attempt, message: 'Content unchanged — nothing written.',
      };
    }

    if (plan.action === 'insert') {
      const { error } = await supabase.from('circle_memory').insert(plan.patch as Record<string, unknown>);
      if (!error) {
        return {
          ok: true, status: 'inserted', docKind: plan.docKind, version: plan.nextVersion,
          conflict: null, refusedReason: null, historyRecorded: false,
          attempts: attempt, message: 'Created shared memory doc.',
        };
      }
      // A racing insert (unique violation) means the row now exists — re-plan
      // as an update rather than reporting failure.
      lastMessage = error.message;
      continue;
    }

    // action === 'update'. Archive the undo row FIRST: if the guarded update
    // then loses the race it writes nothing, so a spare history row is the
    // harmless failure direction. Losing the undo row is not.
    let historyRecorded = false;
    if (plan.history) {
      const { error: historyError } = await supabase
        .from('circle_memory_history')
        .insert(plan.history as unknown as Record<string, unknown>);
      if (historyError) {
        console.warn('[sharedMemory] history insert failed:', historyError.message);
      } else {
        historyRecorded = true;
      }
    }

    let updateQuery = supabase
      .from('circle_memory')
      .update(plan.patch as Record<string, unknown>)
      .eq('circle_id', circleId)
      .eq('doc_kind', docKind);
    if (plan.expectedVersion !== null) {
      updateQuery = updateQuery.eq('version', plan.expectedVersion);
    }
    const { data: updated, error: updateError } = await updateQuery.select('id');

    if (updateError) {
      return {
        ok: false, status: 'error', docKind: plan.docKind, version: null,
        conflict: null, refusedReason: null, historyRecorded,
        attempts: attempt, message: updateError.message,
      };
    }

    const outcome = classifyMemoryWriteOutcome({
      plan,
      rowsAffected: updated?.length ?? 0,
      latest: (updated?.length ?? 0) === 0 ? await getMemoryDoc(circleId, docKind) : null,
      attempt,
      maxAttempts: MEMORY_WRITE_MAX_ATTEMPTS,
    });

    if (outcome.contentApplied) {
      return {
        ok: true, status: 'updated', docKind: plan.docKind, version: plan.nextVersion,
        conflict: outcome.conflict === 'none' ? null : outcome.conflict,
        refusedReason: null, historyRecorded, attempts: attempt, message: outcome.detail,
      };
    }
    lastMessage = outcome.detail;
    if (!outcome.retryable) {
      return {
        ok: false, status: 'conflict', docKind: plan.docKind, version: null,
        conflict: outcome.conflict, refusedReason: null, historyRecorded,
        attempts: attempt, message: outcome.detail,
      };
    }
    // retryable → loop and re-plan against the fresh row.
  }

  console.warn(`[sharedMemory] updateMemoryDoc gave up after ${MEMORY_WRITE_MAX_ATTEMPTS} attempts: ${lastMessage}`);
  return {
    ok: false, status: 'conflict', docKind, version: null,
    // Exhausted retries means a concurrent writer kept winning the race — the
    // doc genuinely diverged from every base we planned against.
    conflict: 'diverged', refusedReason: null, historyRecorded: false,
    attempts: MEMORY_WRITE_MAX_ATTEMPTS, message: lastMessage,
  };
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
