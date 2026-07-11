/**
 * userMemory — Phase 4a. Per-user USER.md-equivalent document the agent
 * injects alongside circle_memory so it remembers individual preferences
 * ("call me by first name", "I work in Go", "ship minimal code, not
 * frameworks").
 *
 * Scope model: one row per `(user_id, circle_id)` pair. Users can also
 * have a circle-independent profile (circle_id=NULL) — the loader merges
 * both, preferring the circle-specific override.
 *
 * RLS: only the user themselves can read/write their own row. Other
 * circle members cannot read another user's memory. See
 * `docs/AGENTS_ROADMAP.md` §6 rule 4.
 *
 * Tool shape (Phase 4b): `manageUserMemory` with `append | replace` actions
 * — `append` bypasses HITL (it's the user's own memory) but `replace`
 * is gated because it's destructive.
 */

import { supabase } from './supabase';

export type UserMemory = {
  id: string;
  userId: string;
  circleId: string | null;
  content: string;
  updatedAt: string;
};

// Cap helpers live in `userMemoryCaps` (pure, no Supabase) so smoke
// tests and edge functions can import them without react-native.
// Re-exported here so existing callers don't change.
export {
  USER_MEMORY_SOFT_CAP,
  USER_MEMORY_HARD_CAP,
  USER_MEMORY_CAP_ERROR,
  USER_MEMORY_CREDENTIAL_ERROR,
  checkUserMemoryCap,
  describeUserMemoryUsage,
  looksLikeCredentialMemoryContent,
  type UserMemoryCapCheck,
} from './userMemoryCaps';
import {
  USER_MEMORY_CAP_ERROR,
  USER_MEMORY_CREDENTIAL_ERROR,
  USER_MEMORY_HARD_CAP,
  checkUserMemoryCap,
  looksLikeCredentialMemoryContent,
} from './userMemoryCaps';

// Human-facing refusal shared by the append + replace credential guards.
const USER_MEMORY_CREDENTIAL_REFUSAL =
  "won't store credentials in memory — keep passwords, API keys, and other secrets in your vault (e.g. 1Password) and I can reference them by name.";

/**
 * Read the caller's memory for a circle. Merges the user's global profile
 * (circle_id=NULL) with the circle-specific row, preferring circle-
 * specific content. Never throws — returns `{ global: '', circle: '' }`
 * on failure.
 */
export async function loadUserMemory(userId: string, circleId: string): Promise<{
  global: string;
  circle: string;
  combined: string;
}> {
  try {
    const { data, error } = await supabase
      .from('user_memory')
      .select('circle_id, content')
      .eq('user_id', userId)
      .or(`circle_id.eq.${circleId},circle_id.is.null`);
    if (error) {
      if ((error as any).code !== 'PGRST205') console.warn('[userMemory] load failed:', error.message);
      return { global: '', circle: '', combined: '' };
    }
    let global = '';
    let circle = '';
    for (const row of (data || []) as Array<{ circle_id: string | null; content: string }>) {
      if (row.circle_id === null) global = row.content || '';
      else circle = row.content || '';
    }
    const parts: string[] = [];
    if (global) parts.push(`[USER GLOBAL]\n${global}`);
    if (circle) parts.push(`[USER IN THIS CIRCLE]\n${circle}`);
    return { global, circle, combined: parts.join('\n\n') };
  } catch (e) {
    console.warn('[userMemory] load exception:', e);
    return { global: '', circle: '', combined: '' };
  }
}

/**
 * Appends text to the user's memory row. Creates the row if missing.
 * The caller MUST be the owning user — RLS enforces this server-side.
 *
 * Appends are considered low-risk (user is writing their own notes), so
 * we don't route through HITL here. `replaceUserMemory` is the guarded
 * path for destructive rewrites.
 */
export async function appendUserMemory(
  userId: string,
  circleId: string | null,
  note: string,
): Promise<
  | { ok: true; currentChars: number; capChars: number }
  | { ok: false; error: string; suggestion?: 'consolidate'; currentChars?: number; capChars?: number; wouldBeChars?: number }
> {
  if (!note || note.trim().length === 0) return { ok: false, error: 'empty note' };
  const trimmed = note.trim();

  // Secret hygiene: refuse credential-shaped content BEFORE any persistence.
  // Passwords/keys/tokens belong in the vault, never in memory. This guards
  // the tool + UI writers directly (the /remember conversational path has its
  // own copy of this check upstream).
  if (looksLikeCredentialMemoryContent(trimmed)) {
    return { ok: false, error: `${USER_MEMORY_CREDENTIAL_ERROR}: ${USER_MEMORY_CREDENTIAL_REFUSAL}` };
  }

  // `upsert` with `onConflict` requires the user_id + circle_id unique index
  // we declared in RUN_THIS_SQL.sql §11. For PostgREST's upsert semantics we
  // need to fetch-then-insert-or-update because `circle_id IS NULL` can't
  // participate in a unique constraint cleanly across Supabase versions.
  const key = circleId === null ? 'is.null' : `eq.${circleId}`;
  const { data: existing, error: lookupError } = await supabase
    .from('user_memory')
    .select('id, content')
    .eq('user_id', userId)
    .filter('circle_id', ...parseFilter(key))
    .maybeSingle();
  if (lookupError) return { ok: false, error: `lookup failed: ${lookupError.message}` };

  // Cap check — if the proposed append would overflow HARD_CAP, return a
  // structured error the agent can act on by running consolidation.
  const capCheck = checkUserMemoryCap(existing?.content || '', trimmed);
  if (!capCheck.ok) {
    return {
      ok: false,
      error: capCheck.error,
      suggestion: capCheck.suggestion,
      currentChars: capCheck.currentChars,
      capChars: capCheck.capChars,
      wouldBeChars: capCheck.wouldBeChars,
    };
  }

  if (existing) {
    const merged = (existing.content || '').trim();
    const next = merged ? `${merged}\n${trimmed}` : trimmed;
    const { error } = await supabase
      .from('user_memory')
      .update({ content: next, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return { ok: false, error: `update failed: ${error.message}` };
    return { ok: true, currentChars: next.length, capChars: USER_MEMORY_HARD_CAP };
  }

  const { error } = await supabase.from('user_memory').insert({
    user_id: userId,
    circle_id: circleId,
    content: trimmed,
  });
  if (error) return { ok: false, error: `insert failed: ${error.message}` };
  return { ok: true, currentChars: trimmed.length, capChars: USER_MEMORY_HARD_CAP };
}

/**
 * Replaces the user's memory row entirely. Destructive — callers (notably
 * the agent via `manageUserMemory` tool) should file an HITL approval
 * first. This raw helper doesn't enforce HITL; it's meant for UI paths
 * where the user edits their own memory in a form.
 */
export async function replaceUserMemory(
  userId: string,
  circleId: string | null,
  content: string,
): Promise<
  | { ok: true; currentChars: number; capChars: number }
  | { ok: false; error: string; suggestion?: 'consolidate'; currentChars?: number; capChars?: number; wouldBeChars?: number }
> {
  // Even on replace, enforce the hard cap — prevents the agent from
  // "consolidating" past the ceiling with a single overlong rewrite.
  const trimmed = (content || '').trim();
  // Secret hygiene: a rewrite must not smuggle a credential into memory either.
  if (looksLikeCredentialMemoryContent(trimmed)) {
    return { ok: false, error: `${USER_MEMORY_CREDENTIAL_ERROR}: ${USER_MEMORY_CREDENTIAL_REFUSAL}` };
  }
  if (trimmed.length > USER_MEMORY_HARD_CAP) {
    return {
      ok: false,
      error: USER_MEMORY_CAP_ERROR,
      suggestion: 'consolidate',
      currentChars: 0,
      capChars: USER_MEMORY_HARD_CAP,
      wouldBeChars: trimmed.length,
    };
  }
  const key = circleId === null ? 'is.null' : `eq.${circleId}`;
  const { data: existing, error: lookupError } = await supabase
    .from('user_memory')
    .select('id')
    .eq('user_id', userId)
    .filter('circle_id', ...parseFilter(key))
    .maybeSingle();
  if (lookupError) return { ok: false, error: `lookup failed: ${lookupError.message}` };

  if (existing) {
    const { error } = await supabase
      .from('user_memory')
      .update({ content: trimmed, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return { ok: false, error: `update failed: ${error.message}` };
    return { ok: true, currentChars: trimmed.length, capChars: USER_MEMORY_HARD_CAP };
  }
  const { error } = await supabase.from('user_memory').insert({
    user_id: userId,
    circle_id: circleId,
    content: trimmed,
  });
  if (error) return { ok: false, error: `insert failed: ${error.message}` };
  return { ok: true, currentChars: trimmed.length, capChars: USER_MEMORY_HARD_CAP };
}

/**
 * Deletes the user's memory row. Destructive — same HITL rationale as
 * `replaceUserMemory`. Accepts circle_id=null to delete the global profile.
 */
export async function deleteUserMemory(
  userId: string,
  circleId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  let query = supabase.from('user_memory').delete().eq('user_id', userId);
  query = circleId === null ? query.is('circle_id', null) : query.eq('circle_id', circleId);
  const { error } = await query;
  if (error) return { ok: false, error: `delete failed: ${error.message}` };
  return { ok: true };
}

// ─── Internals ──────────────────────────────────────────────────────────────

// `.filter('col', 'op', 'value')` is the lowest-level escape hatch in the
// PostgREST client. We emulate `.eq()` / `.is()` from a compact string so
// the null case (`circle_id IS NULL`) and the value case both go through
// one code path without duplicating the rest of the query.
function parseFilter(spec: string): [string, string] {
  if (spec === 'is.null') return ['is', 'null'];
  const [op, ...rest] = spec.split('.');
  return [op, rest.join('.')];
}
