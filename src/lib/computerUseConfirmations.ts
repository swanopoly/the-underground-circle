/**
 * computerUseConfirmations — client-side helpers for the stop-and-confirm
 * flow. The edge function inserts a row in `computer_use_confirmations`
 * and polls it; we write the user's decision via a simple UPDATE. RLS
 * enforces that only circle members can write.
 */

import { supabase } from './supabase';
import { safeGetUserId } from './authSession';

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
