/**
 * TaskTable — Notion-style table view over the same KanbanTask data the
 * board and calendar consume. Sortable columns + group-by toggle.
 *
 * Columns: title, status, priority, assignee, due date, goal, last updated.
 * Group-by: none | status | priority | assignee.
 *
 * Style: Feed dashboard surface language. Dense but app-native rows,
 * softer cards, and chip controls that match the board filters.
 */

import React, { useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from "react-native";
import type { KanbanTask, TaskPriority, TaskStatus } from "../types/kanban";

interface Props {
  tasks: KanbanTask[];
  accentColor: string;
  onSelectTask?: (id: string) => void;
  /** Optional: advance a task's status inline when its status chip is
   *  clicked. When omitted, the chip stays display-only. */
  onStatusChange?: (taskId: string, nextStatus: TaskStatus) => void;
  /** Optional: caller passes `true` when the task list has been filtered
   *  (search text, priority/assignee/room) so the empty state can
   *  distinguish "no tasks match your filter" from "no tasks exist yet". */
  isFiltered?: boolean;
  /** Optional: callback to clear the caller's filters from within the
   *  empty state. Shown as a button when `isFiltered` is true. */
  onClearFilters?: () => void;
}

// Cycle order for inline status bumping. Matches the canonical flow:
// backlog → todo → in_progress → peer_review → done, then wraps.
const STATUS_CYCLE: TaskStatus[] = [
  "backlog", "todo", "in_progress", "peer_review", "done",
];
function nextStatus(current: TaskStatus): TaskStatus {
  const idx = STATUS_CYCLE.indexOf(current);
  if (idx < 0) return "todo";
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

type SortKey = "title" | "status" | "priority" | "assignee" | "due_date" | "updated_at";
type SortDir = "asc" | "desc";
type GroupKey = "none" | "status" | "priority" | "assignee";

const COLUMNS: Array<{ key: SortKey; label: string; width: number }> = [
  { key: "title",      label: "TITLE",     width: 320 },
  { key: "status",     label: "STATUS",    width: 110 },
  { key: "priority",   label: "PRIORITY",  width: 100 },
  { key: "assignee",   label: "ASSIGNEE",  width: 140 },
  { key: "due_date",   label: "DUE",       width: 90 },
  { key: "updated_at", label: "UPDATED",   width: 90 },
];

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = {
  backlog: 0, todo: 1, in_progress: 2, peer_review: 3, review: 4, approved: 5, done: 6,
};

function assigneeLabel(t: KanbanTask): string {
  return t.assignee?.display_name || t.assignee?.username || (t.assigned_to ? t.assigned_to.slice(0, 8) : "");
}

function taskValue(t: KanbanTask, key: SortKey): any {
  switch (key) {
    case "title":      return (t.title || "").toLowerCase();
    case "status":     return STATUS_ORDER[t.status] ?? 99;
    case "priority":   return PRIORITY_ORDER[t.priority] ?? 99;
    case "assignee":   return assigneeLabel(t).toLowerCase();
    case "due_date":   return t.due_date || "9999-12-31";
    case "updated_at": return (t as any).updated_at || t.created_at || "";
  }
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "NOW";
  if (mins < 60) return `${mins}M`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}H`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}D`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

function formatDue(d: string | null | undefined): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueMid = new Date(date);
  dueMid.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueMid.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "TODAY";
  if (diffDays === 1) return "TOMORROW";
  if (diffDays === -1) return "YESTERDAY";
  if (diffDays < 0) return `${Math.abs(diffDays)}D AGO`;
  if (diffDays <= 7) return `IN ${diffDays}D`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

export default function TaskTable({ tasks, accentColor, onSelectTask, onStatusChange, isFiltered, onClearFilters }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [groupBy, setGroupBy] = useState<GroupKey>("none");

  const sorted = useMemo(() => {
    const arr = [...tasks];
    arr.sort((a, b) => {
      const va = taskValue(a, sortKey);
      const vb = taskValue(b, sortKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [tasks, sortKey, sortDir]);

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ label: "ALL", tasks: sorted }];
    const map = new Map<string, KanbanTask[]>();
    for (const t of sorted) {
      const key =
        groupBy === "status" ? t.status :
        groupBy === "priority" ? (t.priority || "normal") :
        assigneeLabel(t) || "UNASSIGNED";
      const arr = map.get(key);
      if (arr) arr.push(t); else map.set(key, [t]);
    }
    // Preserve canonical order for status/priority; alphabetical for assignee.
    const ordered = Array.from(map.entries()).sort(([a], [b]) => {
      if (groupBy === "status")   return (STATUS_ORDER[a] ?? 99) - (STATUS_ORDER[b] ?? 99);
      if (groupBy === "priority") return (PRIORITY_ORDER[a] ?? 99) - (PRIORITY_ORDER[b] ?? 99);
      return a.localeCompare(b);
    });
    return ordered.map(([label, ts]) => ({ label: label.toUpperCase(), tasks: ts }));
  }, [sorted, groupBy]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const totalWidth = COLUMNS.reduce((n, c) => n + c.width, 0);

  return (
    <View style={s.root} nativeID="section-task-table">
      <View style={s.header}>
        <View style={s.iconBox}><Text style={s.iconText}>☰</Text></View>
        <Text style={s.title}>TASKS · TABLE</Text>
        <Text style={s.count}>{tasks.length}</Text>
      </View>

      <View style={s.toolbar}>
        <Text style={s.toolbarLabel}>GROUP</Text>
        {(["none", "status", "priority", "assignee"] as GroupKey[]).map((g) => {
          const active = g === groupBy;
          return (
            <Pressable key={g} onPress={() => setGroupBy(g)} style={[s.pill, active && s.pillActive]}>
              <Text style={[s.pillText, active && s.pillTextActive]}>{g.toUpperCase()}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS !== "web"}>
        <View style={{ width: totalWidth }}>
          {/* Column headers */}
          <View style={s.colHeaderRow}>
            {COLUMNS.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => toggleSort(c.key)}
                style={[s.colHeader, { width: c.width }]}
              >
                <Text style={s.colHeaderText}>
                  {c.label}
                  {sortKey === c.key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Groups */}
          <ScrollView style={{ maxHeight: 620 }}>
            {groups.map((g) => (
              <View key={g.label}>
                {groupBy !== "none" && (
                  <View style={s.groupHeader}>
                    <Text style={s.groupHeaderText}>{g.label}</Text>
                    <Text style={s.groupHeaderCount}>{g.tasks.length}</Text>
                  </View>
                )}
                {g.tasks.map((t, i) => (
                  <Pressable
                    key={t.id}
                    onPress={() => onSelectTask?.(t.id)}
                    style={[s.row, i % 2 === 1 && s.rowAlt]}
                  >
                    <CellTitle task={t} width={COLUMNS[0].width} />
                    <CellStatus
                      status={t.status}
                      width={COLUMNS[1].width}
                      accentColor={accentColor}
                      onAdvance={onStatusChange ? () => onStatusChange(t.id, nextStatus(t.status)) : undefined}
                    />
                    <CellPriority priority={t.priority} width={COLUMNS[2].width} />
                    <CellText text={assigneeLabel(t) || "—"} width={COLUMNS[3].width} muted={!t.assigned_to} />
                    <CellDue due={t.due_date} width={COLUMNS[4].width} status={t.status} />
                    <CellText text={relTime((t as any).updated_at || t.created_at)} width={COLUMNS[5].width} muted />
                  </Pressable>
                ))}
              </View>
            ))}
            {tasks.length === 0 && (
              <View style={s.empty}>
                <Text style={s.emptyText}>
                  {isFiltered ? 'NO TASKS MATCH THE CURRENT FILTERS.' : 'NO TASKS IN THIS CIRCLE YET.'}
                </Text>
                {isFiltered && onClearFilters ? (
                  <Pressable onPress={onClearFilters} style={s.emptyClearBtn}>
                    <Text style={s.emptyClearText}>CLEAR FILTERS</Text>
                  </Pressable>
                ) : null}
              </View>
            )}
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

function CellTitle({ task, width }: { task: KanbanTask; width: number }) {
  return (
    <View style={[s.cell, { width, paddingLeft: 12 }]}>
      <Text style={[s.cellText, task.status === "done" && s.cellTextDone]} numberOfLines={1}>
        {task.title || "(untitled)"}
      </Text>
    </View>
  );
}

function CellStatus({ status, width, accentColor, onAdvance }: { status: TaskStatus; width: number; accentColor: string; onAdvance?: () => void }) {
  const { bg, border, color } = statusColors(status, accentColor);
  const Wrapper: any = onAdvance ? Pressable : View;
  return (
    <View style={[s.cell, { width }]}>
      <Wrapper
        // Stop propagation so clicking the chip doesn't also open the task
        // modal via the row Pressable. `stopPropagation` exists on both
        // web synthetic events and RN GestureResponderEvents.
        onPress={onAdvance ? (e: any) => { e?.stopPropagation?.(); onAdvance(); } : undefined}
        style={[s.statusChip, { backgroundColor: bg, borderColor: border }, onAdvance && { ...(Platform.OS === "web" ? { cursor: "pointer" } as any : {}) }]}
      >
        <Text style={[s.statusChipText, { color }]}>{status.replace(/_/g, " ").toUpperCase()}</Text>
      </Wrapper>
    </View>
  );
}

function CellPriority({ priority, width }: { priority: TaskPriority; width: number }) {
  const color = priority === "urgent" ? "#ef4444"
    : priority === "high" ? "#f59e0b"
    : priority === "low" ? "#555"
    : "#888";
  const glyph = priority === "urgent" ? "!!"
    : priority === "high" ? "!"
    : priority === "low" ? "·"
    : "—";
  return (
    <View style={[s.cell, { width }]}>
      <View style={[s.priorityChip, { borderColor: color }]}>
        <Text style={[s.priorityChipText, { color }]}>{glyph} {priority.toUpperCase()}</Text>
      </View>
    </View>
  );
}

function CellText({ text, width, muted }: { text: string; width: number; muted?: boolean }) {
  return (
    <View style={[s.cell, { width }]}>
      <Text style={[s.cellText, muted && { color: "#555" }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function CellDue({ due, width, status }: { due: string | null; width: number; status: TaskStatus }) {
  const label = formatDue(due);
  const overdue = !!(due && new Date(due).getTime() < Date.now() - 86_400_000 && status !== "done");
  return (
    <View style={[s.cell, { width }]}>
      <Text style={[s.cellText, overdue && { color: "#ef4444" }, !due && { color: "#555" }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function statusColors(status: TaskStatus, accent: string) {
  switch (status) {
    case "done":        return { bg: "#22c55e15", border: "#22c55e", color: "#22c55e" };
    case "approved":    return { bg: "#22c55e15", border: "#22c55e", color: "#22c55e" };
    case "in_progress": return { bg: accent + "15", border: accent, color: accent };
    case "peer_review": return { bg: "#a855f715", border: "#a855f7", color: "#a855f7" };
    case "review":      return { bg: "#a855f715", border: "#a855f7", color: "#a855f7" };
    case "backlog":     return { bg: "#33333350", border: "#555", color: "#888" };
    default:            return { bg: "#0a0a0a", border: "#333", color: "#888" };
  }
}

const s = StyleSheet.create({
  root: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 16,
    padding: 0,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
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
    fontSize: 13,
    fontWeight: "700",
  },
  count: {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: "700",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    backgroundColor: "#0f172a",
  },
  toolbarLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
    marginRight: 4,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "#243041",
    borderRadius: 12,
    backgroundColor: "#101827",
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
  },
  pillActive: {
    backgroundColor: "#312e81",
    borderColor: "#4f46e5",
  },
  pillText: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "700",
  },
  pillTextActive: {
    color: "#eef2ff",
  },
  colHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  colHeader: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    ...(Platform.OS === "web" ? { cursor: "pointer" } as any : {}),
  },
  colHeaderText: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0f172a",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
    gap: 8,
  },
  groupHeaderText: {
    color: "#dbe7f5",
    fontSize: 10,
    fontWeight: "700",
  },
  groupHeaderCount: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#172033",
    backgroundColor: "#111827",
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "background-color 0.1s ease" } as any : {}),
  },
  rowAlt: {
    backgroundColor: "#0f1722",
  },
  cell: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  cellText: {
    color: "#e5eefc",
    fontSize: 11,
    fontWeight: "600",
  },
  cellTextDone: {
    color: "#64748b",
    textDecorationLine: "line-through",
  },
  statusChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 999,
  },
  statusChipText: {
    fontSize: 8,
    fontWeight: "700",
  },
  priorityChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: 999,
    backgroundColor: "#0f172a",
  },
  priorityChipText: {
    fontSize: 8,
    fontWeight: "700",
  },
  empty: {
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  emptyText: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
  },
  emptyClearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#243041",
    borderRadius: 8,
    backgroundColor: "#0f172a",
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.15s ease" } as any : {}),
  },
  emptyClearText: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
});
