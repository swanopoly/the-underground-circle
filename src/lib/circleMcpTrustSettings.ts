/**
 * circleMcpTrustSettings — the deliberate trust source for external MCP
 * servers (T6 un-darking, docs/SWANBOT_OPENSWAN_CHAT_NEXT_PLAN_2026-06-08.md).
 *
 * `circle_mcp_servers` (supabase/migrations/20260319_mcp_servers.sql) has no
 * trusted/verified column and no jsonb config column, so trust lives in the
 * existing `circles.settings` JSONB (migration 20260411_circles_settings_column)
 * under `settings.mcpTrustedServerIds: string[]` — same read-merge-write
 * pattern as `chatWebSearchSettings.ts` / `chatAutoApproveSettings.ts`, so no
 * new migration is needed.
 *
 * Semantics (consumed by `mcpToolBridge.deriveMcpToolPolicy`):
 *   - A server id present in the list ⇒ that server's MCP tool annotations
 *     are believed: read-only non-destructive tools run WITHOUT approval.
 *     Mutating tools still hit the approval gate, and ALL result text stays
 *     fenced as untrusted data regardless of trust.
 *   - Absent / read failure / empty ⇒ all servers untrusted ⇒ every MCP tool
 *     fails closed to 'ask' (the bridge's default posture).
 *
 * The list is bounded (≤ MAX_TRUSTED_MCP_SERVER_IDS) so the settings row and
 * the per-turn trusted-set both stay small.
 *
 * Note: this module imports the live supabase client, so it is NOT
 * smoke-importable — runtime callers that must stay pure (mcpToolBridge)
 * load it via dynamic import only.
 */

import { supabase } from './supabase';

export const MAX_TRUSTED_MCP_SERVER_IDS = 20;

const SETTINGS_KEY = 'mcpTrustedServerIds';

/** Warning copy shown when a user flips a server to trusted. */
export const MCP_TRUST_WARNING_COPY =
  "Trusted servers' read-only tools run without approval and their output is still treated as untrusted data. Only trust servers you control.";

function coerceTrustedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const id = value.trim();
    if (!id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= MAX_TRUSTED_MCP_SERVER_IDS) break;
  }
  return out;
}

// Tiny read cache so per-turn tool assembly and the management UI don't
// re-query `circles.settings` on every call. Invalidated on every write.
const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { ids: string[]; at: number }>();

/**
 * Reads the circle's trusted MCP server ids. Silent failure → empty list
 * (= all servers untrusted = every MCP tool approval-gated, fail closed).
 */
export async function getTrustedMcpServerIds(circleId: string): Promise<string[]> {
  if (!circleId) return [];
  const hit = cache.get(circleId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return [...hit.ids];
  try {
    const { data, error } = await supabase
      .from('circles')
      .select('settings')
      .eq('id', circleId)
      .maybeSingle();
    if (error || !data) return [];
    const ids = coerceTrustedIds((data.settings as any)?.[SETTINGS_KEY]);
    cache.set(circleId, { ids, at: Date.now() });
    return [...ids];
  } catch {
    return [];
  }
}

/**
 * Adds/removes one server id from the circle's trusted list.
 * Read-merge-write so other `circles.settings` keys are never clobbered.
 * Refuses to grow the list past MAX_TRUSTED_MCP_SERVER_IDS.
 */
export async function setMcpServerTrusted(
  circleId: string,
  serverId: string,
  trusted: boolean,
): Promise<{ ok: boolean; trustedIds: string[]; error?: string }> {
  if (!circleId || !serverId) return { ok: false, trustedIds: [], error: 'missing circleId or serverId' };
  try {
    const { data: existing, error: readErr } = await supabase
      .from('circles')
      .select('settings')
      .eq('id', circleId)
      .maybeSingle();
    if (readErr) return { ok: false, trustedIds: [], error: readErr.message };
    const settings = (existing?.settings as any) || {};
    const current = coerceTrustedIds(settings[SETTINGS_KEY]);
    let next: string[];
    if (trusted) {
      if (current.includes(serverId)) {
        next = current;
      } else {
        if (current.length >= MAX_TRUSTED_MCP_SERVER_IDS) {
          return {
            ok: false,
            trustedIds: current,
            error: `Trusted MCP server limit reached (${MAX_TRUSTED_MCP_SERVER_IDS}). Untrust another server first.`,
          };
        }
        next = [...current, serverId];
      }
    } else {
      next = current.filter((id) => id !== serverId);
    }
    const merged = { ...settings, [SETTINGS_KEY]: next };
    const { error: updateErr } = await supabase
      .from('circles')
      .update({ settings: merged })
      .eq('id', circleId);
    if (updateErr) return { ok: false, trustedIds: current, error: updateErr.message };
    cache.set(circleId, { ids: next, at: Date.now() });
    return { ok: true, trustedIds: [...next] };
  } catch (err) {
    return { ok: false, trustedIds: [], error: err instanceof Error ? err.message : String(err) };
  }
}
