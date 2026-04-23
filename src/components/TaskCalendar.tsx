/**
 * TaskCalendar — month-grid calendar showing tasks placed on their due_date.
 *
 * Complements the Kanban board: same task data, different view. Users toggle
 * between BOARD / CALENDAR above the kanban.
 *
 * Style: Feed dashboard surface language. Softer cards, app-native chips,
 * and task pills that match the board's richer dark treatment.
 */

import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, ScrollView, Modal } from "react-native";
import type { KanbanTask } from "../types/kanban";

interface Props {
  tasks: KanbanTask[];
  accentColor: string;
  onSelectTask?: (id: string) => void;
  /** Optional: caller passes `true` when the list has been filtered so the
   *  hint row can distinguish empty-circle from filtered-to-zero. */
  isFiltered?: boolean;
  onClearFilters?: () => void;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function ymd(d: Date): string {
  // Local ISO date — matches tasks.due_date stored as 'YYYY-MM-DD'
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const dy = String(d.getDate()).padStart(2, "0");
  return `${yr}-${mo}-${dy}`;
}
function sameYMD(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

export default function TaskCalendar({ tasks, accentColor, onSelectTask, isFiltered, onClearFilters }: Props) {
  const [cursor, setCursor] = useState<Date>(() => startOfMonth(new Date()));
  // When the user taps "+N MORE" on a dense day, we open a modal listing
  // every task scheduled for that day. Keyed by YYYY-MM-DD.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  // Index tasks by ISO date ('YYYY-MM-DD'). Supports both 'YYYY-MM-DD' and
  // full ISO timestamp values for due_date, since the column is typed date
  // but some writers may store a timestamptz.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, KanbanTask[]>();
    for (const t of tasks) {
      if (!t.due_date) continue;
      const key = String(t.due_date).slice(0, 10);
      if (!/\d{4}-\d{2}-\d{2}/.test(key)) continue;
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    // Sort each day's tasks by priority then status.
    const priOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const pa = priOrder[(a as any).priority || "normal"] ?? 2;
        const pb = priOrder[(b as any).priority || "normal"] ?? 2;
        if (pa !== pb) return pa - pb;
        return ((a.title || "") as string).localeCompare(b.title || "");
      });
    }
    return map;
  }, [tasks]);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  // Prepend days from the previous month so the grid starts on Sunday.
  const leading = monthStart.getDay();
  const gridStart = new Date(monthStart.getTime() - leading * DAY_MS);
  // 6 weeks × 7 days = 42 cells. Keeps month heights stable.
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(new Date(gridStart.getTime() + i * DAY_MS));
  const today = new Date();

  const prevMonth = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const nextMonth = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
  const thisMonth = () => setCursor(startOfMonth(new Date()));

  const monthLabel = cursor.toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
  const scheduledCount = tasks.filter((t) => !!t.due_date).length;
  const unscheduledCount = tasks.filter((t) => !t.due_date && t.status !== "done").length;

  return (
    <View style={s.root} nativeID="section-task-calendar">
      <View style={s.header}>
        <View style={s.iconBox}><Text style={s.iconText}>#</Text></View>
        <Text style={s.title}>{monthLabel}</Text>
        <View style={s.navRow}>
          <NavBtn label="<" onPress={prevMonth} />
          <NavBtn label="TODAY" onPress={thisMonth} accent />
          <NavBtn label=">" onPress={nextMonth} />
        </View>
      </View>
      <Text style={s.subtitle}>
        {scheduledCount} SCHEDULED
        {unscheduledCount > 0 ? ` · ${unscheduledCount} NO DATE` : ""}
      </Text>

      {/* Zero-task hint — distinguishes empty-circle from filtered-to-zero. */}
      {tasks.length === 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 4 }}>
          <Text style={[s.subtitle, { marginBottom: 0 }]}>
            {isFiltered ? 'NO TASKS MATCH THE CURRENT FILTERS' : 'NO TASKS IN THIS CIRCLE YET'}
          </Text>
          {isFiltered && onClearFilters ? (
            <Pressable onPress={onClearFilters} style={{
              paddingHorizontal: 10, paddingVertical: 4,
              borderWidth: 1, borderColor: '#243041', borderRadius: 8,
              backgroundColor: '#0f172a',
              ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
            }}>
              <Text style={{ color: '#94a3b8', fontSize: 9, fontWeight: '800', letterSpacing: 1 }}>
                CLEAR
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Weekday headers */}
      <View style={s.weekdayRow}>
        {WEEKDAYS.map((d) => (
          <View key={d} style={s.weekdayCell}>
            <Text style={s.weekdayText}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Grid */}
      <ScrollView style={{ maxHeight: 560 }}>
        <View style={s.grid}>
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === cursor.getMonth();
            const isToday = sameYMD(d, today);
            const items = tasksByDay.get(ymd(d)) || [];
            const overflow = items.length > 3 ? items.length - 3 : 0;
            return (
              <View
                key={i}
                style={[
                  s.cell,
                  !inMonth && s.cellOut,
                  isToday && { borderColor: accentColor },
                ]}
              >
                <View style={s.cellHeader}>
                  <Text style={[
                    s.cellDayNum,
                    !inMonth && { color: "#333" },
                    isToday && { color: accentColor },
                  ]}>
                    {d.getDate()}
                  </Text>
                  {items.length > 0 && (
                    <Text style={s.cellCount}>{items.length}</Text>
                  )}
                </View>
                <View style={s.cellTasks}>
                  {items.slice(0, 3).map((t) => (
                    <TaskPill key={t.id} task={t} onPress={() => onSelectTask?.(t.id)} />
                  ))}
                  {overflow > 0 && (
                    <Pressable
                      onPress={() => setExpandedDay(ymd(d))}
                      style={{ marginTop: 2, ...(Platform.OS === "web" ? { cursor: "pointer" } as any : {}) }}
                    >
                      <Text style={s.overflowText}>+{overflow} more</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* Expanded-day modal — full list of tasks scheduled for a single day */}
      <Modal
        visible={!!expandedDay}
        transparent
        animationType="fade"
        onRequestClose={() => setExpandedDay(null)}
      >
        <Pressable style={s.modalOverlay} onPress={() => setExpandedDay(null)}>
          <Pressable style={s.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>
                {expandedDay ? new Date(expandedDay + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : ""}
              </Text>
              <Pressable onPress={() => setExpandedDay(null)} style={s.modalClose}>
                <Text style={s.modalCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 440 }}>
              <View style={{ gap: 6 }}>
                {(expandedDay ? (tasksByDay.get(expandedDay) || []) : []).map((t) => (
                  <TaskPill
                    key={t.id}
                    task={t}
                    onPress={() => {
                      setExpandedDay(null);
                      onSelectTask?.(t.id);
                    }}
                  />
                ))}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function NavBtn({ label, onPress, accent }: { label: string; onPress: () => void; accent?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.navBtn, accent && s.navBtnAccent]}>
      <Text style={[s.navBtnText, accent && s.navBtnTextAccent]}>{label}</Text>
    </Pressable>
  );
}

function TaskPill({ task, onPress }: { task: KanbanTask; onPress?: () => void }) {
  const priority = (task as any).priority || "normal";
  const border = priority === "urgent" ? "#ef4444"
    : priority === "high" ? "#f59e0b"
    : "#444";
  const status = task.status;
  const done = status === "done";
  return (
    <Pressable onPress={onPress} style={[s.taskPill, { borderLeftColor: border }]}>
      <Text
        style={[s.taskPillText, done && s.taskPillTextDone]}
        numberOfLines={1}
      >
        {done ? "✓ " : ""}{task.title}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  root: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 16,
    padding: 12,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 4,
  },
  iconBox: {
    width: 24,
    height: 24,
    borderWidth: 1,
    borderColor: "#243041",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0f172a",
  },
  iconText: {
    color: "#8b5cf6",
    fontSize: 12,
    fontWeight: "700",
  },
  title: {
    flex: 1,
    color: "#e5eefc",
    fontSize: 15,
    fontWeight: "700",
  },
  navRow: {
    flexDirection: "row",
    gap: 4,
  },
  navBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#243041",
    borderRadius: 12,
    backgroundColor: "#0f172a",
    ...(Platform.OS === "web" ? { transition: "all 0.15s ease", cursor: "pointer" } as any : {}),
  },
  navBtnAccent: {
    borderColor: "#4f46e5",
    backgroundColor: "#312e81",
  },
  navBtnText: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
  },
  navBtnTextAccent: {
    color: "#eef2ff",
  },
  subtitle: {
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 10,
  },
  weekdayRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    backgroundColor: "#0f172a",
  },
  weekdayCell: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 6,
  },
  weekdayText: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  cell: {
    width: "14.2857%", // 1/7
    minHeight: 90,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#172033",
    padding: 4,
    backgroundColor: "#111827",
  },
  cellOut: {
    backgroundColor: "#0d141f",
  },
  cellHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cellDayNum: {
    color: "#e2e8f0",
    fontSize: 10,
    fontWeight: "700",
  },
  cellCount: {
    color: "#60a5fa",
    fontSize: 9,
    fontWeight: "700",
  },
  cellTasks: {
    marginTop: 4,
    gap: 2,
  },
  taskPill: {
    backgroundColor: "#162033",
    borderWidth: 1,
    borderColor: "#253248",
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingHorizontal: 5,
    paddingVertical: 3,
    ...(Platform.OS === "web" ? { transition: "all 0.1s ease", cursor: "pointer" } as any : {}),
  },
  taskPillText: {
    color: "#dbe7f5",
    fontSize: 9,
    fontWeight: "600",
  },
  taskPillTextDone: {
    color: "#7c8aa0",
    textDecorationLine: "line-through",
  },
  overflowText: {
    color: "#7c8aa0",
    fontSize: 8,
    fontWeight: "700",
    marginTop: 2,
  },
  // Overflow-day modal (click "+N more" on a dense day)
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 16,
    padding: 16,
    ...(Platform.OS === "web" ? { boxShadow: "0 20px 60px rgba(0,0,0,0.5)" } as any : {}),
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    flex: 1,
    color: "#e5eefc",
    fontSize: 15,
    fontWeight: "700",
  },
  modalClose: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#243041",
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: {
    color: "#94a3b8",
    fontSize: 18,
    fontWeight: "700",
  },
});
