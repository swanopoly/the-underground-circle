/**
 * MentionsInbox — "your @mentions, across every circle you're in."
 *
 * Reads from the `get_my_mentions` RPC added in 20260427_mentions_inbox.sql.
 * Shows newest first. Each row resolves its source (message/mission/etc) so
 * the user sees a human-readable summary rather than a bare UUID. Clicking
 * a row sets the appropriate deeplink localStorage key so the matching tab
 * picks it up on next mount.
 *
 * Opening this panel marks everything up to now() as seen via the
 * `mark_my_mentions_seen` RPC, which is also what drives the unread badge.
 *
 * Style: Feed dashboard surface language — slate card, 1px border, rounded.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, Platform } from "react-native";
import { supabase } from "../lib/supabase";

interface MentionRow {
  id: string;
  circle_id: string;
  source_type: "message" | "mission" | "mission_task" | "proof" | "comment" | "check_in" | "goal";
  source_id: string;
  author_id: string | null;
  created_at: string;
  seen: boolean;
  // Enriched client-side
  resolved?: { title: string; subtitle: string } | null;
  authorName?: string;
  circleName?: string;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "NOW";
  if (mins < 60) return `${mins}M`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}D`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

function deepLinkFor(sourceType: string, sourceId: string) {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    if (sourceType === "mission")      window.localStorage.setItem("uc_pending_mission_deeplink", sourceId);
    if (sourceType === "mission_task") window.localStorage.setItem("uc_pending_task_deeplink", sourceId);
    if (sourceType === "goal")         window.localStorage.setItem("uc_pending_goal_deeplink", sourceId);
    if (sourceType === "check_in")     window.localStorage.setItem("uc_pending_checkin_deeplink", sourceId);
  } catch {}
}

async function resolveSources(rows: MentionRow[]): Promise<MentionRow[]> {
  const byType = new Map<string, string[]>();
  for (const r of rows) {
    const arr = byType.get(r.source_type) || [];
    arr.push(r.source_id);
    byType.set(r.source_type, arr);
  }

  const projections = new Map<string, { title: string; subtitle: string }>();

  const load = async (type: string, table: string, select: string, project: (row: any) => { title: string; subtitle: string }) => {
    const ids = byType.get(type);
    if (!ids?.length) return;
    const { data } = await supabase.from(table).select(select).in("id", ids);
    if (!data) return;
    for (const row of data as any[]) {
      projections.set(`${type}:${row.id}`, project(row));
    }
  };

  await Promise.all([
    load("mission", "circle_missions", "id, title, status",
      (r) => ({ title: r.title || "(untitled)", subtitle: `MISSION · ${r.status || ""}`.trim() })),
    load("mission_task", "mission_tasks", "id, title, status",
      (r) => ({ title: r.title || "(untitled)", subtitle: `TASK · ${r.status || ""}`.trim() })),
    load("message", "messages", "id, content",
      (r) => ({ title: (r.content || "(no text)").slice(0, 80), subtitle: "MESSAGE" })).catch(() => undefined),
    load("proof", "proof_of_work", "id, title, pow_type",
      (r) => ({ title: r.title || "(untitled)", subtitle: `PROOF · ${r.pow_type || ""}`.trim() })),
    load("check_in", "check_ins", "id, content, check_in_date",
      (r) => ({ title: (r.content || "(no text)").slice(0, 80), subtitle: `CHECK-IN · ${r.check_in_date || ""}`.trim() })),
    load("goal", "goals", "id, name, status",
      (r) => ({ title: r.name || "(untitled)", subtitle: `GOAL · ${r.status || ""}`.trim() })),
  ]);

  // Resolve author names + circle names with two small batched queries.
  const authorIds = Array.from(new Set(rows.map((r) => r.author_id).filter(Boolean) as string[]));
  const circleIds = Array.from(new Set(rows.map((r) => r.circle_id).filter(Boolean)));
  const [{ data: profiles }, { data: circles }] = await Promise.all([
    authorIds.length
      ? supabase.from("profiles").select("id, display_name, username").in("id", authorIds)
      : Promise.resolve({ data: [] as any[] } as any),
    circleIds.length
      ? supabase.from("circles").select("id, name").in("id", circleIds)
      : Promise.resolve({ data: [] as any[] } as any),
  ]);
  // Typed as any-valued maps so the .display_name / .name accessors below
  // don't trip the compiler on the {} default value.
  const profileById = new Map<string, any>(((profiles || []) as any[]).map((p) => [p.id, p]));
  const circleById = new Map<string, any>(((circles || []) as any[]).map((c) => [c.id, c]));

  return rows.map((r) => {
    const profile = r.author_id ? profileById.get(r.author_id) : null;
    const circle = circleById.get(r.circle_id);
    return {
      ...r,
      resolved: projections.get(`${r.source_type}:${r.source_id}`) || null,
      authorName: profile?.display_name || profile?.username || undefined,
      circleName: circle?.name || undefined,
    };
  });
}

export default function MentionsInbox() {
  const [rows, setRows] = useState<MentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("get_my_mentions", { p_limit: 100 });
      if (cancelled) return;
      if (error || !data) {
        setRows([]);
        setLoading(false);
        return;
      }
      const unread = (data as any[]).filter((r) => !r.seen).length;
      setUnreadCount(unread);
      const enriched = await resolveSources(data as any);
      if (cancelled) return;
      setRows(enriched);
      setLoading(false);
      // Mark everything up to now() as seen so the unread badge clears.
      // The Supabase RPC builder thens like a promise but needs explicit
      // .then() for the catch branch (no .catch() on the filter builder).
      supabase.rpc("mark_my_mentions_seen").then(() => undefined, () => undefined);
    })();
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const byDay = new Map<string, MentionRow[]>();
    for (const r of rows) {
      const day = new Date(r.created_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
      const arr = byDay.get(day) || [];
      arr.push(r);
      byDay.set(day, arr);
    }
    return Array.from(byDay.entries());
  }, [rows]);

  return (
    <View style={s.card} nativeID="section-mentions-inbox">
      <View style={s.header}>
        <View style={s.iconBox}><Text style={s.iconText}>@</Text></View>
        <Text style={s.title}>Your Mentions</Text>
        {unreadCount > 0 && (
          <View style={s.unreadPill}>
            <Text style={s.unreadText}>{unreadCount} NEW</Text>
          </View>
        )}
        <Text style={s.count}>{rows.length}</Text>
      </View>

      {loading ? (
        <Text style={s.hint}>LOADING…</Text>
      ) : rows.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>No mentions yet</Text>
          <Text style={s.emptyHint}>
            When someone @'s you from a mission, task, check-in, or chat, it shows up here.
          </Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 520 }}>
          {grouped.map(([day, dayRows]) => (
            <View key={day} style={{ marginBottom: 12 }}>
              <Text style={s.dayHeader}>{day}</Text>
              <View style={{ gap: 6 }}>
                {dayRows.map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => deepLinkFor(r.source_type, r.source_id)}
                    style={[s.row, !r.seen && s.rowUnread]}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.rowTitle} numberOfLines={1}>
                        {r.resolved?.title || `${r.source_type}:${r.source_id.slice(0, 8)}`}
                      </Text>
                      <Text style={s.rowMeta} numberOfLines={1}>
                        {r.resolved?.subtitle || r.source_type.toUpperCase()}
                        {r.authorName ? ` · from ${r.authorName}` : ""}
                        {r.circleName ? ` · in ${r.circleName}` : ""}
                      </Text>
                    </View>
                    <Text style={s.rowTime}>{timeAgo(r.created_at)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: "#243041",
    borderRadius: 10,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    color: "#8b5cf6",
    fontSize: 14,
    fontWeight: "700",
  },
  title: {
    flex: 1,
    color: "#e5eefc",
    fontSize: 16,
    fontWeight: "700",
  },
  unreadPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "#4f46e5",
  },
  unreadText: {
    color: "#eef2ff",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  count: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "700",
    fontFamily: "monospace",
    marginLeft: 6,
  },
  hint: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "600",
    paddingVertical: 16,
    textAlign: "center",
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#0f172a",
  },
  emptyTitle: {
    color: "#e5eefc",
    fontSize: 14,
    fontWeight: "700",
  },
  emptyHint: {
    color: "#64748b",
    fontSize: 12,
    fontWeight: "500",
    textAlign: "center",
  },
  dayHeader: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 6,
    fontFamily: "monospace",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 12,
    backgroundColor: "#0f172a",
    ...(Platform.OS === "web" ? { transition: "all 0.15s ease", cursor: "pointer" } as any : {}),
  },
  rowUnread: {
    borderColor: "#4f46e5",
    backgroundColor: "#1e1b4b",
  },
  rowTitle: {
    color: "#e5eefc",
    fontSize: 13,
    fontWeight: "700",
  },
  rowMeta: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "600",
    marginTop: 3,
    letterSpacing: 0.4,
    fontFamily: "monospace",
  },
  rowTime: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "700",
    fontFamily: "monospace",
  },
});
