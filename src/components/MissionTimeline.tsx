/**
 * MissionTimeline — horizontal gantt-ish view of circle missions.
 *
 * Each row is a mission. Each row shows:
 *   - A bar spanning from created_at to deadline (or today + 7d if no deadline)
 *   - Colored by status (active/completed/overdue/draft)
 *   - Clickable to open mission detail
 *   - Progress fill showing completed-task ratio
 *
 * Columns are calendar days across the visible window. Window auto-fits the
 * earliest-created mission to the latest deadline, with sensible padding.
 *
 * Style: app slate surfaces matching Feed / Missions instead of the old
 * terminal black-and-white treatment.
 */

import React, { useMemo } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, useWindowDimensions } from "react-native";
import type { Mission } from "../lib/missions";
import { GRID, PIXEL_COLORS } from "../lib/pixelDesign";

interface Props {
  missions: Mission[];
  accentColor: string;
  onSelectMission: (id: string) => void;
}

const DAY_MS = 86_400_000;
const PX_PER_DAY = 28;
const ROW_HEIGHT = 44;
const LEFT_LABEL_WIDTH = 180;

// Safety cap to prevent pathological timelines (e.g. a mission from 2001 with
// deadline 2099) from producing a ~36,000-day canvas that pegs the renderer.
const MAX_DAYS = 200;

interface TimelineSpan {
  mission: Mission;
  startMs: number;
  endMs: number;
  overdue: boolean;
  progress: number; // 0..1
}

export default function MissionTimeline({ missions, accentColor, onSelectMission }: Props) {
  const { width } = useWindowDimensions();
  const narrow = width < 600;
  const spans: TimelineSpan[] = useMemo(() => {
    const now = Date.now();
    return missions
      .filter((m) => m.status !== "archived")
      .map((m) => {
        const startMs = new Date(m.created_at).getTime();
        const defaultEnd = Math.max(startMs + 7 * DAY_MS, now + 3 * DAY_MS);
        const endMs = m.deadline ? new Date(m.deadline).getTime() : defaultEnd;
        const overdue = !!(m.deadline && endMs < now && m.status !== "completed");
        const total = (m as any).task_count || 0;
        const done = (m as any).completed_tasks || 0;
        const progress = total > 0 ? Math.min(done / total, 1) : m.status === "completed" ? 1 : 0;
        return { mission: m, startMs, endMs, overdue, progress };
      });
  }, [missions]);

  // Narrow screens (< 600) — render a compact list with date strips instead
  // of the gantt grid. Horizontal scroll + 180px left label column eats too
  // much of a phone's width; the list keeps every mission visible.
  if (narrow && spans.length > 0) {
    const sortedForList = [...spans].sort((a, b) => a.endMs - b.endMs);
    return (
      <View style={s.narrowRoot} nativeID="section-mission-timeline">
        <View style={s.narrowHeader}>
          <Text style={s.narrowHeaderText}>TIMELINE · {spans.length} MISSIONS</Text>
        </View>
        <View style={{ gap: 6 }}>
          {sortedForList.map((span) => {
            const c = barColor(span, accentColor);
            const due = span.mission.deadline
              ? new Date(span.mission.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              : "NO DEADLINE";
            return (
              <Pressable
                key={span.mission.id}
                onPress={() => onSelectMission(span.mission.id)}
                style={[s.narrowRow, { borderLeftColor: c.border }]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.narrowTitle} numberOfLines={1}>
                    {span.overdue ? "⚠ " : ""}{span.mission.title}
                  </Text>
                  <Text style={s.narrowMeta}>
                    {due.toUpperCase()}
                    {span.mission.status === "completed" ? " · DONE" : span.overdue ? " · OVERDUE" : ""}
                  </Text>
                </View>
                {span.progress > 0 && (
                  <View style={s.narrowProgressTrack}>
                    <View style={[s.narrowProgressFill, { width: `${Math.min(span.progress * 100, 100)}%`, backgroundColor: c.border }]} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  const window = useMemo(() => {
    if (spans.length === 0) {
      const now = Date.now();
      return { startMs: now - 3 * DAY_MS, endMs: now + 14 * DAY_MS };
    }
    const now = Date.now();
    const minStart = Math.min(...spans.map((s) => s.startMs), now - 3 * DAY_MS);
    const maxEnd = Math.max(...spans.map((s) => s.endMs), now + 7 * DAY_MS);
    // Snap to day boundaries.
    const startMs = new Date(minStart).setHours(0, 0, 0, 0);
    const endMs = new Date(maxEnd).setHours(0, 0, 0, 0) + DAY_MS;
    // Cap width.
    const days = Math.round((endMs - startMs) / DAY_MS);
    if (days > MAX_DAYS) {
      return { startMs, endMs: startMs + MAX_DAYS * DAY_MS };
    }
    return { startMs, endMs };
  }, [spans]);

  const totalDays = Math.max(1, Math.round((window.endMs - window.startMs) / DAY_MS));
  const canvasWidth = totalDays * PX_PER_DAY;
  const todayOffsetDays = (Date.now() - window.startMs) / DAY_MS;
  const todayWithinWindow = todayOffsetDays >= 0 && todayOffsetDays <= totalDays;

  if (spans.length === 0) {
    return (
      <View style={s.emptyBox}>
        <Text style={s.emptyTitle}>NO MISSIONS TO PLOT</Text>
        <Text style={s.emptyHint}>CREATE A MISSION WITH A DEADLINE TO SEE IT HERE.</Text>
      </View>
    );
  }

  const dayMarkers = buildDayMarkers(window.startMs, totalDays);

  return (
    <View style={s.root} nativeID="section-mission-timeline">
      {/* Day header — scrolls with body */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={Platform.OS !== "web"}
        contentContainerStyle={{ flexDirection: "row" }}
        style={{ marginLeft: LEFT_LABEL_WIDTH }}
      >
        <View style={{ width: canvasWidth }}>
          <View style={s.dayHeaderRow}>
            {dayMarkers.map((d, i) => (
              <View
                key={d.ms}
                style={[
                  s.dayCell,
                  d.isMonthStart && s.dayCellMonthStart,
                  d.isToday && { borderColor: accentColor },
                ]}
              >
                <Text style={[s.dayLabel, d.isToday && { color: accentColor }]}>
                  {d.dayNum}
                </Text>
                {d.isMonthStart && <Text style={s.monthLabel}>{d.monthLabel}</Text>}
              </View>
            ))}
          </View>

          {/* Body — one row per mission */}
          {spans.map((span, rowIdx) => {
            const startOffsetDays = Math.max(0, (span.startMs - window.startMs) / DAY_MS);
            const endOffsetDays = Math.min(totalDays, (span.endMs - window.startMs) / DAY_MS);
            const widthDays = Math.max(0.5, endOffsetDays - startOffsetDays);
            const fillColor = barColor(span, accentColor);
            return (
              <Pressable
                key={span.mission.id}
                style={[s.bodyRow, { height: ROW_HEIGHT }]}
                onPress={() => onSelectMission(span.mission.id)}
              >
                {/* background grid */}
                <View style={[s.rowGrid, { width: canvasWidth }]}>
                  {dayMarkers.map((d) => (
                    <View
                      key={d.ms}
                      style={[
                        s.rowGridCell,
                        d.isMonthStart && s.dayCellMonthStart,
                      ]}
                    />
                  ))}
                </View>
                {/* today line */}
                {todayWithinWindow && (
                  <View style={[s.todayLine, { left: todayOffsetDays * PX_PER_DAY, backgroundColor: accentColor }]} />
                )}
                {/* mission bar */}
                <View
                  style={[
                    s.bar,
                    {
                      left: startOffsetDays * PX_PER_DAY,
                      width: widthDays * PX_PER_DAY - 4,
                      backgroundColor: fillColor.bg,
                      borderColor: fillColor.border,
                    },
                  ]}
                >
                  {span.progress > 0 && (
                    <View
                      style={[
                        s.barProgress,
                        { width: `${Math.min(span.progress * 100, 100)}%`, backgroundColor: fillColor.progress },
                      ]}
                    />
                  )}
                  <Text style={s.barLabel} numberOfLines={1}>
                    {span.overdue ? "! " : ""}
                    {span.mission.title}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Overlay label column (fixed, doesn't scroll horizontally) */}
      <View style={s.labelColumn}>
        <View style={[s.dayHeaderRow, { paddingLeft: 12, justifyContent: "center" }]}>
          <Text style={s.columnHeader}>MISSION</Text>
        </View>
        {spans.map((span) => (
          <Pressable
            key={span.mission.id}
            style={[s.labelRow, { height: ROW_HEIGHT }]}
            onPress={() => onSelectMission(span.mission.id)}
          >
            <View style={[s.statusDot, { backgroundColor: barColor(span, accentColor).border }]} />
            <Text style={s.labelText} numberOfLines={1}>{span.mission.title}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function buildDayMarkers(startMs: number, totalDays: number) {
  const out: Array<{
    ms: number;
    dayNum: number;
    monthLabel: string;
    isMonthStart: boolean;
    isToday: boolean;
  }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startMs + i * DAY_MS);
    out.push({
      ms: d.getTime(),
      dayNum: d.getDate(),
      monthLabel: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
      isMonthStart: d.getDate() === 1,
      isToday: d.getTime() === todayMs,
    });
  }
  return out;
}

function barColor(span: TimelineSpan, accent: string) {
  if (span.mission.status === "completed") {
    return { bg: "#22c55e15", border: "#22c55e", progress: "#22c55e40" };
  }
  if (span.overdue) {
    return { bg: "#ef444415", border: "#ef4444", progress: "#ef444440" };
  }
  if (span.mission.status === "draft") {
    return { bg: "#44444415", border: "#666", progress: "#66666640" };
  }
  return { bg: accent + "15", border: accent, progress: accent + "40" };
}

const s = StyleSheet.create({
  root: {
    flexDirection: "row",
    backgroundColor: PIXEL_COLORS.bg1,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 16,
    overflow: "hidden",
    minHeight: 280,
  },
  labelColumn: {
    position: "absolute",
    top: 0,
    left: 0,
    width: LEFT_LABEL_WIDTH,
    backgroundColor: PIXEL_COLORS.bg2,
    borderRightWidth: 1,
    borderRightColor: PIXEL_COLORS.border0,
  },
  columnHeader: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: PIXEL_COLORS.border0,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  labelText: {
    flex: 1,
    color: PIXEL_COLORS.text0,
    fontSize: 11,
    fontWeight: "600",
  },
  dayHeaderRow: {
    flexDirection: "row",
    height: 36,
    borderBottomWidth: 1,
    borderBottomColor: PIXEL_COLORS.border0,
    backgroundColor: PIXEL_COLORS.bg2,
  },
  dayCell: {
    width: PX_PER_DAY,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: "transparent",
  },
  dayCellMonthStart: {
    borderLeftColor: PIXEL_COLORS.border0,
  },
  dayLabel: {
    color: PIXEL_COLORS.text2,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
  },
  monthLabel: {
    position: "absolute",
    top: 2,
    left: 2,
    color: PIXEL_COLORS.text1,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.7,
  },
  bodyRow: {
    position: "relative",
    borderTopWidth: 1,
    borderTopColor: PIXEL_COLORS.border0,
    backgroundColor: PIXEL_COLORS.bg1,
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "background-color 0.15s ease" } as any : {}),
  },
  rowGrid: {
    flexDirection: "row",
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  rowGridCell: {
    width: PX_PER_DAY,
    borderLeftWidth: 1,
    borderLeftColor: "transparent",
  },
  todayLine: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    opacity: 0.6,
  },
  bar: {
    position: "absolute",
    top: 8,
    bottom: 8,
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  barProgress: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
  },
  barLabel: {
    color: PIXEL_COLORS.text0,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  emptyBox: {
    backgroundColor: PIXEL_COLORS.bg1,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 16,
    padding: 40,
    alignItems: "center",
    gap: 6,
  },
  emptyTitle: {
    color: PIXEL_COLORS.text0,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  emptyHint: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: "600",
    lineHeight: 16,
    textAlign: "center",
  },
  // Narrow-screen list fallback (<600px): app-surface slate card, rounded,
  // 1px border to match the new design system.
  narrowRoot: {
    backgroundColor: PIXEL_COLORS.bg1,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 16,
    padding: GRID.md,
  },
  narrowHeader: {
    marginBottom: 10,
  },
  narrowHeaderText: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  narrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 10,
    paddingRight: 12,
    backgroundColor: PIXEL_COLORS.bg2,
    borderRadius: 12,
    ...(Platform.OS === "web" ? { transition: "all 0.15s ease", cursor: "pointer" } as any : {}),
  },
  narrowTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 13,
    fontWeight: "700",
  },
  narrowMeta: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 3,
    letterSpacing: 0.5,
  },
  narrowProgressTrack: {
    width: 80,
    height: 4,
    borderRadius: 999,
    backgroundColor: PIXEL_COLORS.border0,
    overflow: "hidden",
  },
  narrowProgressFill: {
    height: "100%",
  },
});
