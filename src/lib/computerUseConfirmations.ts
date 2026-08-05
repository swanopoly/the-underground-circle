/**
 * computerUseConfirmations — client-side helpers for the stop-and-confirm
 * flow. The edge function inserts a row in `computer_use_confirmations`
 * and polls it; we write the user's decision via a simple UPDATE. RLS
 * enforces that only circle members can write.
 */

import { supabase } from './supabase';
import { safeGetUserId } from './authSession';
import { normalizeSteeringNote } from './computerUseSteering';

export async function resolveComputerUseConfirmation(
  id: string,
  choice: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!id || !choice) return { ok: false, error: 'id and choice required' };
  try {
    const userId = await safeGetUserId();
    const { error } = await supabase
      .from('computer_use_confirmations')
      .update({
        choice,
        resolved_at: new Date().toISOString(),
        user_id: userId,
      })
      .eq('id', id)
      .is('resolved_at', null); // don't overwrite an already-resolved row
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'unknown error' };
  }
}

/**
 * Post a mid-run steering note to a live computer task (plan §4e). Routed
 * through the edge function's `steer` action because clients have no INSERT
 * policy on `computer_use_confirmations` — the server verifies circle
 * membership (runs RLS read) and inserts with the service role. The running
 * loop injects the note at its next iteration boundary as guidance only;
 * consequential actions still confirm through ask_user.
 */
export async function sendComputerUseSteeringNote(
  runId: string,
  rawNote: string,
): Promise<{ ok: boolean; error?: string; code?: string }> {
  if (!runId) return { ok: false, error: 'runId required' };
  const normalized = normalizeSteeringNote(rawNote);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  try {
    const { data, error } = await supabase.functions.invoke('computer-use-agent', {
      body: { steer: { runId, note: normalized.note } },
    });
    if (error) return { ok: false, error: error.message || 'steering request failed' };
    if (data && data.ok === false) {
      return { ok: false, error: String(data.error || 'steering rejected'), code: data.code };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'unknown error' };
  }
}
