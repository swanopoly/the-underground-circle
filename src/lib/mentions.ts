/**
 * mentions — unified @ reference system for chat, missions, proofs.
 *
 * Token format: `@[kind:id:label]`
 * - kind: 'user' | 'mission' | 'mission_task'
 * - id: UUID
 * - label: display text (no `]`)
 *
 * Example:
 *   "Let's ship this by Friday @[mission:abc-123:Launch Dashboard]
 *    Assigned to @[user:def-456:alice]"
 *
 * This string form survives DB storage, re-edits, and copy-paste. The
 * {@link parseMentions} helper splits it into segments for rendering.
 * The {@link extractMentionRefs} helper pulls the structured refs for
 * logging to the `mentions` table.
 */

import { supabase } from "./supabase";

/**
 * Universal mention categories. Original three (user / mission /
 * mission_task) are server-backed by `search_mention_candidates` RPC;
 * the four new kinds added 2026-04-30 are queried client-side from
 * separate tables so we don't have to ship a migration to expand the
 * picker. They unlock "navigate everything from chat" — type @ to
 * reach any agent, circle, room, or slash command.
 */
export type MentionKind =
  | "user"
  | "mission"
  | "mission_task"
  | "agent"      // circle_office_agents + agent_identities (custom names)
  | "circle"     // cross-circle reference
  | "room"       // project_rooms within current circle
  | "slash";     // CHAT_COMMAND_REGISTRY entry

export interface MentionRef {
  kind: MentionKind;
  id: string;
  label: string;
}

export interface MentionCandidate {
  kind: MentionKind;
  id: string;
  label: string;
  sublabel: string;
}

export type SourceType = "message" | "mission" | "mission_task" | "proof" | "comment" | "check_in" | "goal";

// Segment type for rendering: either a text run or a mention token.
export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; ref: MentionRef };

// Token IDs are usually UUIDs (8+ hex chars / dashes). Slash entries use
// short stable string ids ("/run") so we allow the slash kind to match a
// non-UUID id pattern. Rooms / agents / circles all use UUID ids.
const TOKEN_RE = /@\[(user|mission|mission_task|agent|circle|room|slash):([^:]+):([^\]]+)\]/g;

export function parseMentions(content: string): MentionSegment[] {
  if (!content) return [];
  const out: MentionSegment[] = [];
  let lastIndex = 0;
  // Reset regex lastIndex in case the RE was used elsewhere (global state).
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(content)) !== null) {
    if (m.index > lastIndex) {
      out.push({ type: "text", text: content.slice(lastIndex, m.index) });
    }
    out.push({
      type: "mention",
      ref: { kind: m[1] as MentionKind, id: m[2], label: m[3] },
    });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < content.length) {
    out.push({ type: "text", text: content.slice(lastIndex) });
  }
  return out;
}

export function extractMentionRefs(content: string): MentionRef[] {
  return parseMentions(content)
    .filter((s): s is Extract<MentionSegment, { type: "mention" }> => s.type === "mention")
    .map((s) => s.ref);
}

export function renderMentionsPlain(content: string): string {
  return parseMentions(content)
    .map((s) => (s.type === "text" ? s.text : `@${s.ref.label}`))
    .join("");
}

export function formatMentionToken(ref: MentionRef): string {
  // Guard against stray `]` in a display label breaking the parser.
  const safeLabel = ref.label.replace(/\]/g, "");
  return `@[${ref.kind}:${ref.id}:${safeLabel}]`;
}

export async function searchMentionCandidates(
  circleId: string,
  query: string,
  limit: number = 12,
): Promise<MentionCandidate[]> {
  const q = (query || "").trim().toLowerCase();
  // Run all sources in parallel. Each returns its slice of candidates
  // already ranked; we merge with priority weighting at the end.
  const [serverHits, agentHits, circleHits, roomHits, slashHits] = await Promise.all([
    searchUserAndMissionCandidates(circleId, query, limit),
    searchAgentCandidates(circleId, q, limit),
    searchCircleCandidates(q, limit),
    searchRoomCandidates(circleId, q, limit),
    searchSlashCandidates(q, limit),
  ]);

  // Merge with kind priority — agents first because dispatch is the
  // most common @-action. Then people/missions, then circles/rooms,
  // then slash commands at the bottom.
  const KIND_PRIORITY: Record<MentionKind, number> = {
    agent: 0,
    user: 1,
    mission: 2,
    mission_task: 3,
    room: 4,
    circle: 5,
    slash: 6,
  };

  const merged = [...agentHits, ...serverHits, ...roomHits, ...circleHits, ...slashHits];
  // Stable sort by (kind priority, source order).
  merged.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);

  // Dedupe by (kind, id) — one source might return what another already covered.
  const seen = new Set<string>();
  const out: MentionCandidate[] = [];
  for (const c of merged) {
    const k = `${c.kind}:${c.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

// ─── Per-source searches ────────────────────────────────────────────────────

async function searchUserAndMissionCandidates(
  circleId: string,
  query: string,
  limit: number,
): Promise<MentionCandidate[]> {
  try {
    const { data, error } = await supabase.rpc("search_mention_candidates", {
      p_circle_id: circleId,
      p_query: query,
      p_limit: limit,
    });
    if (error || !data) return [];
    return (data as any[]).map((r) => ({
      kind:     r.kind as MentionKind,
      id:       r.id,
      label:    r.label ?? "",
      sublabel: r.sublabel ?? "",
    }));
  } catch {
    return [];
  }
}

/**
 * Agents = circle_office_agents in the current circle, plus the user's
 * own agent_identities (custom-named agents). Match on display name,
 * custom name, or session key.
 */
async function searchAgentCandidates(
  circleId: string,
  q: string,
  limit: number,
): Promise<MentionCandidate[]> {
  if (!circleId) return [];
  try {
    // Circle-scoped office agents (visible to all members).
    let officeQuery = supabase
      .from("circle_office_agents")
      .select("id, name, color, owner_display_name, status")
      .eq("circle_id", circleId)
      .eq("is_published", true)
      .limit(limit);
    if (q) officeQuery = officeQuery.ilike("name", `%${q}%`);

    // Personal agent identities (custom-named CLI sessions etc).
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as any));
    let identitiesQuery = user
      ? supabase
          .from("agent_identities")
          .select("session_key, custom_name, custom_color, bound_model")
          .eq("user_id", user.id)
          .limit(limit)
      : null;
    if (identitiesQuery && q) identitiesQuery = identitiesQuery.or(`custom_name.ilike.%${q}%,session_key.ilike.%${q}%`);

    const [officeRes, identitiesRes] = await Promise.all([
      officeQuery,
      identitiesQuery ? identitiesQuery : Promise.resolve({ data: null }),
    ]);

    const officeRows = (officeRes.data || []) as any[];
    const identityRows = (identitiesRes.data || []) as any[];

    const out: MentionCandidate[] = [];
    for (const a of officeRows) {
      out.push({
        kind: "agent",
        id: String(a.id),
        label: String(a.name || "agent"),
        sublabel: a.owner_display_name ? `${a.status || "idle"} · ${a.owner_display_name}` : (a.status || "agent"),
      });
    }
    for (const id of identityRows) {
      // Skip if this agent is already in the office list (dedupe by name).
      if (officeRows.some(o => String(o.name || "").toLowerCase() === String(id.custom_name || id.session_key || "").toLowerCase())) continue;
      out.push({
        kind: "agent",
        id: String(id.session_key),
        label: String(id.custom_name || id.session_key),
        sublabel: id.bound_model ? `your custom · ${id.bound_model}` : "your custom agent",
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Circles the user belongs to. Useful for cross-circle references in
 * messages: "@[circle:X:Other Crew] said the same thing".
 */
async function searchCircleCandidates(
  q: string,
  limit: number,
): Promise<MentionCandidate[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as any));
    if (!user) return [];
    // First find which circles the user is in.
    const { data: membership } = await supabase
      .from("circle_members")
      .select("circle_id")
      .eq("user_id", user.id);
    const ids = (membership || []).map((m: any) => m.circle_id);
    if (ids.length === 0) return [];

    let cQuery = supabase
      .from("circles")
      .select("id, name, circle_type")
      .in("id", ids)
      .limit(limit);
    if (q) cQuery = cQuery.ilike("name", `%${q}%`);
    const { data, error } = await cQuery;
    if (error || !data) return [];
    return (data as any[]).map((c) => ({
      kind: "circle" as const,
      id: String(c.id),
      label: String(c.name || "circle"),
      sublabel: c.circle_type ? String(c.circle_type) : "circle",
    }));
  } catch {
    return [];
  }
}

/**
 * Project rooms within the current circle.
 */
async function searchRoomCandidates(
  circleId: string,
  q: string,
  limit: number,
): Promise<MentionCandidate[]> {
  if (!circleId) return [];
  try {
    let rq = supabase
      .from("project_rooms")
      .select("id, name, description")
      .eq("circle_id", circleId)
      .limit(limit);
    if (q) rq = rq.ilike("name", `%${q}%`);
    const { data, error } = await rq;
    if (error || !data) return [];
    return (data as any[]).map((r) => ({
      kind: "room" as const,
      id: String(r.id),
      label: String(r.name || "room"),
      sublabel: r.description ? String(r.description).slice(0, 60) : "room",
    }));
  } catch {
    return [];
  }
}

/**
 * Slash commands matching the query. In-memory — no network.
 */
async function searchSlashCandidates(
  q: string,
  limit: number,
): Promise<MentionCandidate[]> {
  try {
    const { CHAT_COMMAND_REGISTRY } = await import("./chatCommandRegistry");
    const all = CHAT_COMMAND_REGISTRY;
    const lower = q.toLowerCase();
    const matches = all.filter(c => {
      if (!lower) return false; // only show slash when user is actively typing
      const hay = (c.command + " " + c.title + " " + (c.description || "") + " " + (c.keywords || []).join(" ")).toLowerCase();
      return hay.includes(lower);
    }).slice(0, limit);
    return matches.map(c => ({
      kind: "slash" as const,
      id: c.id,
      label: c.command,
      sublabel: c.title,
    }));
  } catch {
    return [];
  }
}

export async function persistMentions(args: {
  circleId: string;
  sourceType: SourceType;
  sourceId: string;
  authorId: string;
  refs: MentionRef[];
}): Promise<void> {
  if (args.refs.length === 0) return;
  const rows = args.refs.map((ref) => ({
    circle_id:   args.circleId,
    source_type: args.sourceType,
    source_id:   args.sourceId,
    target_type: ref.kind,
    target_id:   ref.id,
    author_id:   args.authorId,
  }));
  const { error } = await supabase.from("mentions").insert(rows);
  // Swallow — mentions logging is non-critical.
  if (error) console.warn("[mentions] persist failed:", error.message);
}

export async function getBacklinks(args: {
  targetType: MentionKind;
  targetId: string;
  limit?: number;
}): Promise<Array<{ source_type: SourceType; source_id: string; created_at: string; author_id: string | null }>> {
  const { data, error } = await supabase
    .from("mentions")
    .select("source_type, source_id, created_at, author_id")
    .eq("target_type", args.targetType)
    .eq("target_id", args.targetId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 20);
  if (error || !data) return [];
  return data as any[];
}
