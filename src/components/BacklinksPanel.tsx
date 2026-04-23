/**
 * BacklinksPanel — shows inbound @mention references for a target (mission,
 * mission_task, or user). Reads from the `mentions` table populated by the
 * block editor and (later) chat mention persistence.
 *
 * Style: UC B&W terminal aesthetic. Compact — lives as a sidebar/card.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { supabase } from "../lib/supabase";
import type { MentionKind } from "../lib/mentions";

interface Props {
  targetType: MentionKind;
  targetId: string;
  /** Optional: resolve a source row to a nav target. Default is no-op. */
  onOpenSource?: (sourceType: string, sourceId: string) => void;
}

interface Backlink {
  source_type: "message" | "mission" | "mission_task" | "proof" | "comment" | "check_in" | "goal";
  source_id: string;
  created_at: string;
  author_id: string | null;
  resolved?: { title: string; subtitle: string } | null;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "NOW";
  if (mins < 60) return `${mins}M`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}D`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

async function resolveSources(links: Array<Omit<Backlink, "resolved">>): Promise<Backlink[]> {
  // Group by source_type to issue minimal queries. Each branch reads just the
  // title/label fields needed for the list — avoids pulling full bodies.
  const out: Backlink[] = links.map((l) => ({ ...l, resolved: null }));
  const bySource = new Map<string, string[]>();
  for (const l of links) {
    const arr = bySource.get(l.source_type) || [];
    arr.push(l.source_id);
    bySource.set(l.source_type, arr);
  }

  const apply = (type: string, rows: any[] | null, keyField = "id") => {
    if (!rows) return;
    const byId = new Map(rows.map((r) => [r[keyField], r]));
    for (const link of out) {
      if (link.source_type === type) {
        const row = byId.get(link.source_id);
        if (row) link.resolved = projectRow(type, row);
      }
    }
  };

  // Missions
  if (bySource.has("mission")) {
    const ids = bySource.get("mission")!;
    const { data } = await supabase.from("circle_missions")
      .select("id, title, status").in("id", ids);
    apply("mission", data);
  }
  if (bySource.has("mission_task")) {
    const ids = bySource.get("mission_task")!;
    const { data } = await supabase.from("mission_tasks")
      .select("id, title, status").in("id", ids);
    apply("mission_task", data);
  }
  // Messages: `messages` table may be named differently; skip on error.
  if (bySource.has("message")) {
    const ids = bySource.get("message")!;
    const { data } = await supabase.from("messages")
      .select("id, content, created_at").in("id", ids).then(
        (r) => r,
        () => ({ data: null } as any),
      );
    apply("message", data);
  }
  if (bySource.has("proof")) {
    const ids = bySource.get("proof")!;
    const { data } = await supabase.from("proof_of_work")
      .select("id, title, pow_type").in("id", ids);
    apply("proof", data);
  }
  if (bySource.has("check_in")) {
    const ids = bySource.get("check_in")!;
    const { data } = await supabase.from("check_ins")
      .select("id, content, check_in_date").in("id", ids);
    apply("check_in", data);
  }
  if (bySource.has("goal")) {
    const ids = bySource.get("goal")!;
    const { data } = await supabase.from("goals")
      .select("id, name, status").in("id", ids);
    apply("goal", data);
  }
  return out;
}

function projectRow(type: string, row: any): { title: string; subtitle: string } {
  switch (type) {
    case "mission":      return { title: row.title || "(untitled)", subtitle: `MISSION · ${row.status || ""}` };
    case "mission_task": return { title: row.title || "(untitled)", subtitle: `TASK · ${row.status || ""}` };
    case "message":      return { title: (row.content || "(no text)").slice(0, 80), subtitle: "MESSAGE" };
    case "proof":        return { title: row.title || "(untitled)", subtitle: `PROOF · ${row.pow_type || ""}` };
    case "check_in":     return { title: (row.content || "(no text)").slice(0, 80), subtitle: `CHECK-IN · ${row.check_in_date || ""}` };
    case "goal":         return { title: row.name || "(untitled)", subtitle: `GOAL · ${row.status || ""}` };
    default:             return { title: row.id, subtitle: type.toUpperCase() };
  }
}

export default function BacklinksPanel({ targetType, targetId, onOpenSource }: Props) {
  const [links, setLinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("mentions")
        .select("source_type, source_id, created_at, author_id")
        .eq("target_type", targetType)
        .eq("target_id", targetId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (cancelled) return;
      if (error || !data) {
        setLinks([]);
        setLoading(false);
        return;
      }
      const resolved = await resolveSources(data as any);
      if (cancelled) return;
      setLinks(resolved);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [targetType, targetId]);

  const grouped = useMemo(() => {
    const g: Record<string, number> = {};
    for (const l of links) g[l.source_type] = (g[l.source_type] || 0) + 1;
    return g;
  }, [links]);

  return (
    <View style={s.card} nativeID="section-backlinks">
      <View style={s.header}>
        <View style={s.iconBox}><Text style={s.iconText}>›</Text></View>
        <Text style={s.title}>REFERENCED FROM</Text>
        <View style={s.countPill}><Text style={s.countText}>{links.length}</Text></View>
      </View>
      <Text style={s.subtitle}>INBOUND @MENTIONS</Text>

      {Object.keys(grouped).length > 0 && (
        <View style={s.chipRow}>
          {Object.entries(grouped).map(([type, count]) => (
            <View key={type} style={s.groupChip}>
              <Text style={s.groupChipText}>{count} {type.replace(/_/g, " ").toUpperCase()}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.divider} />

      {loading ? (
        <Text style={s.hint}>LOADING...</Text>
      ) : links.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>NO BACKLINKS</Text>
          <Text style={s.emptyHint}>MENTIONS OF THIS WILL APPEAR HERE.</Text>
        </View>
      ) : (
        <View style={s.list}>
          {links.map((l, i) => {
            const res = l.resolved;
            return (
              <Pressable
                key={`${l.source_type}-${l.source_id}-${i}`}
                style={s.row}
                onPress={() => onOpenSource?.(l.source_type, l.source_id)}
              >
                <View style={s.rowLeft}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {res?.title || l.source_id.slice(0, 8)}
                  </Text>
                  {res?.subtitle && (
                    <Text style={s.rowSub} numberOfLines={1}>{res.subtitle}</Text>
                  )}
                </View>
                <Text style={s.rowTime}>{timeAgo(l.created_at)}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#000",
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 2,
    padding: 14,
    marginTop: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    color: "#888",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "900",
  },
  title: {
    flex: 1,
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 2,
  },
  countPill: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 2,
    alignItems: "center",
  },
  countText: {
    color: "#888",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
  },
  subtitle: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
    marginTop: 6,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 8,
  },
  groupChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 2,
    backgroundColor: "#0a0a0a",
  },
  groupChipText: {
    color: "#888",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: "#222",
    marginVertical: 10,
  },
  hint: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    paddingVertical: 8,
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 2,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
  emptyHint: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    textAlign: "center",
  },
  list: {
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#222",
    borderRadius: 2,
    backgroundColor: "#0a0a0a",
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
  },
  rowLeft: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
  },
  rowSub: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 2,
  },
  rowTime: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
});
