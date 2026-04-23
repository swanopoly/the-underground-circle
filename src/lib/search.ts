/**
 * search — circle-scoped global search across missions, tasks, goals,
 * proofs, and messages. Wraps the `search_circle_content` RPC.
 */

import { supabase } from "./supabase";

export type SearchKind = "mission" | "mission_task" | "task" | "goal" | "proof" | "message";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  created_at: string;
}

export async function searchCircleContent(
  circleId: string,
  query: string,
  limit = 20,
): Promise<SearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.rpc("search_circle_content", {
    p_circle_id: circleId,
    p_query: q,
    p_limit: limit,
  });
  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    kind:       r.kind as SearchKind,
    id:         r.id,
    title:      r.title ?? "",
    subtitle:   r.subtitle ?? "",
    created_at: r.created_at ?? "",
  }));
}

/** Route a hit to the appropriate deeplink key so the target tab's
 *  existing consumer picks it up on next render. */
export function hitToDeeplink(hit: SearchHit): { key: string; value: string } | null {
  if (typeof window === "undefined") return null;
  switch (hit.kind) {
    case "mission":      return { key: "uc_pending_mission_deeplink", value: hit.id };
    case "mission_task": return { key: "uc_pending_task_deeplink",    value: hit.id };
    case "task":         return { key: "uc_pending_task_deeplink",    value: hit.id };
    case "goal":         return { key: "uc_pending_goal_deeplink",    value: hit.id };
    case "proof":        return null; // no consumer yet
    case "message":      return null; // no consumer yet
  }
}
