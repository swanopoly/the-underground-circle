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

export type MentionKind = "user" | "mission" | "mission_task";

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

const TOKEN_RE = /@\[(user|mission|mission_task):([0-9a-fA-F-]{8,}):([^\]]+)\]/g;

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
  limit: number = 8,
): Promise<MentionCandidate[]> {
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
