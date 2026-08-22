/**
 * MissionHistoryPanel — shows the mission_revisions log for a single mission.
 *
 * Every UPDATE on circle_missions auto-inserts a row via the
 * snapshot_mission_revision trigger. This panel reads those rows and renders
 * "who changed what when" — Notion page-history equivalent, scoped to
 * mission briefs.
 *
 * Style: app slate surfaces that match Feed / Board mission detail.
 */

import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from "react-native";
import { supabase } from "../lib/supabase";
import { GRID, PIXEL_COLORS } from "../lib/pixelDesign";
import { indexSafeProfiles, loadSafeCircleProfiles } from "../lib/safeProfiles";

interface Props {
  circleId: string;
  missionId: string;
  accentColor?: string;
  onClose?: () => void;
}

interface Revision {
  id: string;
  editor_id: string | null;
  title: string;
  description: string | null;
  status: string | null;
  deadline: string | null;
  change_summary: string | null;
  created_at: string;
  editor?: { username?: string | null; display_name?: string | null } | null;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "JUST NOW";
  if (mins < 60) return `${mins}M AGO`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H AGO`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}D AGO`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

function parseSummary(summary: string | null): string[] {
  if (!summary) return [];
  return summary.split(/\s+/).filter(Boolean);
}

export default function MissionHistoryPanel({ circleId, missionId, accentColor = PIXEL_COLORS.green, onClose }: Props) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("mission_revisions")
      .select("id, editor_id, title, description, status, deadline, change_summary, created_at")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(async ({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setLoading(false);
          return;
        }
        const profileById = indexSafeProfiles(await loadSafeCircleProfiles({
          circleId,
          userIds: (data || []).map(row => row.editor_id).filter(Boolean) as string[],
        }));
        if (cancelled) return;
        setRevisions((data || []).map(row => ({
          ...row,
          editor: row.editor_id ? profileById.get(row.editor_id) || null : null,
        })) as Revision[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [circleId, missionId]);

  const selected = useMemo(
    () => revisions.find((r) => r.id === selectedId) || null,
    [revisions, selectedId],
  );

  return (
    <View style={s.panel} nativeID="section-mission-history">
      <View style={s.header}>
        <View style={s.iconBox}><Text style={s.iconText}>~</Text></View>
        <Text style={s.title}>HISTORY</Text>
        <View style={s.countPill}><Text style={s.countText}>{revisions.length}</Text></View>
        {onClose && (
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeText}>x</Text>
          </Pressable>
        )}
      </View>
      <Text style={s.subtitle}>AUTO-CAPTURED EDITS · MOST RECENT FIRST</Text>
      <View style={s.divider} />

      {loading ? (
        <Text style={s.hint}>LOADING...</Text>
      ) : revisions.length === 0 ? (
        <View style={s.emptyBox}>
          <Text style={s.emptyTitle}>NO REVISIONS YET</Text>
          <Text style={s.emptyHint}>EVERY EDIT TO THIS MISSION IS AUTO-SNAPSHOTTED HERE.</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 400 }}>
          <View style={s.list}>
            {revisions.map((rev, idx) => {
              const active = rev.id === selectedId;
              const changes = parseSummary(rev.change_summary);
              const editor = rev.editor?.display_name || rev.editor?.username || "UNKNOWN";
              return (
                <Pressable
                  key={rev.id}
                  onPress={() => setSelectedId(active ? null : rev.id)}
                  style={[s.row, active && { borderColor: accentColor }]}
                >
                  <View style={s.rowMain}>
                    <View style={[s.bullet, { backgroundColor: idx === 0 ? accentColor : "#444" }]} />
                    <View style={s.rowTextBox}>
                      <Text style={s.rowTime}>{timeAgo(rev.created_at)}</Text>
                      <Text style={s.rowEditor}>{editor.toUpperCase()}</Text>
                    </View>
                    <View style={s.rowChanges}>
                      {changes.map((c) => (
                        <View key={c} style={s.chip}>
                          <Text style={s.chipText}>{c.toUpperCase()}</Text>
                        </View>
                      ))}
                      {changes.length === 0 && (
                        <Text style={s.muted}>MINOR EDIT</Text>
                      )}
                    </View>
                  </View>
                  {active && selected && (
                    <View style={s.detailBox}>
                      <DetailRow k="TITLE" v={selected.title || ""} />
                      {selected.description && <DetailRow k="DESCRIPTION" v={selected.description} multiline />}
                      {selected.status && <DetailRow k="STATUS" v={selected.status.toUpperCase()} />}
                      {selected.deadline && (
                        <DetailRow
                          k="DEADLINE"
                          v={new Date(selected.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        />
                      )}
                      <Text style={s.detailFoot}>
                        SNAPSHOT OF VALUES BEFORE THIS EDIT.
                      </Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function DetailRow({ k, v, multiline }: { k: string; v: string; multiline?: boolean }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailKey}>{k}</Text>
      <Text
        style={s.detailValue}
        numberOfLines={multiline ? undefined : 2}
      >{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  panel: {
    backgroundColor: PIXEL_COLORS.bg1,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 16,
    padding: GRID.lg,
    marginTop: 12,
    shadowColor: '#020617',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconBox: {
    width: 28,
    height: 28,
    borderWidth: 1,
    borderColor: `${PIXEL_COLORS.green}33`,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: `${PIXEL_COLORS.green}12`,
  },
  iconText: {
    color: PIXEL_COLORS.green,
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: "900",
  },
  title: {
    flex: 1,
    color: PIXEL_COLORS.text0,
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  countPill: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 999,
    alignItems: "center",
    backgroundColor: PIXEL_COLORS.bg2,
  },
  countText: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
  },
  closeBtn: {
    minWidth: 28,
    height: 28,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PIXEL_COLORS.bg2,
  },
  closeText: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "900",
  },
  subtitle: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.1,
    marginTop: 8,
  },
  divider: {
    height: 1,
    backgroundColor: PIXEL_COLORS.border0,
    marginVertical: 12,
  },
  hint: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    paddingVertical: 8,
  },
  emptyBox: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    gap: 6,
    backgroundColor: PIXEL_COLORS.bg2,
  },
  emptyTitle: {
    color: PIXEL_COLORS.text0,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  emptyHint: {
    color: PIXEL_COLORS.text2,
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
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 14,
    padding: 12,
    backgroundColor: PIXEL_COLORS.bg2,
    gap: 8,
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
  },
  rowMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  rowTextBox: {
    minWidth: 120,
  },
  rowTime: {
    color: PIXEL_COLORS.text0,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  rowEditor: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 2,
  },
  rowChanges: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    justifyContent: "flex-end",
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: `${PIXEL_COLORS.green}33`,
    borderRadius: 999,
    backgroundColor: `${PIXEL_COLORS.green}12`,
  },
  chipText: {
    color: PIXEL_COLORS.green,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  muted: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "700",
  },
  detailBox: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: PIXEL_COLORS.border0,
    gap: 6,
  },
  detailRow: {
    flexDirection: "row",
    gap: 8,
  },
  detailKey: {
    minWidth: 80,
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  detailValue: {
    flex: 1,
    color: PIXEL_COLORS.text0,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
  },
  detailFoot: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 4,
  },
});
