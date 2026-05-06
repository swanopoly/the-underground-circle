/**
 * chatWebSearchSettings — read/write the per-circle Web Search toggle
 * that the chat composer surfaces. Lives in `circles.settings
 * .chatWebSearch.enabled` (JSONB). Phase 0 of the OpenRouter
 * integration plan.
 *
 * The toggle is per-circle so different circles can have different
 * defaults (a research circle wants it always on; a builder circle
 * usually doesn't). Persisted server-side because the chat composer
 * shows in real time and we want the state to follow the user across
 * devices.
 *
 * Read failures fall back to `false` — settings are advisory, not
 * load-bearing. The chat composer always re-reads on mount and on
 * circle switch, so we don't need to invalidate caches on save.
 */

import { supabase } from './supabase';

export interface ChatWebSearchSettings {
  enabled: boolean;
  /** Optional per-circle override of the model used when the toggle is
   *  on. Defaults to `openrouter/auto` — OR picks a web-search-capable
   *  model. Useful when a circle wants to pin GPT-4o or Sonnet for
   *  consistency. */
  preferredModel?: string;
}

const DEFAULTS: ChatWebSearchSettings = { enabled: false };

function coerce(raw: any): ChatWebSearchSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS };
  const enabled = raw.enabled === true;
  const preferredModel = typeof raw.preferredModel === 'string' && raw.preferredModel.trim().length > 0
    ? raw.preferredModel.trim()
    : undefined;
  return { enabled, preferredModel };
}

export async function getChatWebSearchSettings(circleId: string): Promise<ChatWebSearchSettings> {
  if (!circleId) return { ...DEFAULTS };
  try {
    const { data, error } = await supabase
      .from('circles')
      .select('settings')
      .eq('id', circleId)
      .maybeSingle();
    if (error || !data) return { ...DEFAULTS };
    return coerce((data.settings as any)?.chatWebSearch);
  } catch {
    return { ...DEFAULTS };
  }
}

export async function setChatWebSearchEnabled(
  circleId: string,
  enabled: boolean,
): Promise<ChatWebSearchSettings> {
  // Read-merge-write so we don't clobber other settings keys.
  const { data: existing } = await supabase
    .from('circles')
    .select('settings')
    .eq('id', circleId)
    .maybeSingle();
  const current = coerce((existing?.settings as any)?.chatWebSearch);
  const next: ChatWebSearchSettings = { ...current, enabled };
  const merged = { ...(existing?.settings || {}), chatWebSearch: next };
  await supabase.from('circles').update({ settings: merged }).eq('id', circleId);
  return next;
}
