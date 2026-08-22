/**
 * SearchModal — circle-scoped global search. Opens on ⌘K / Ctrl+K on web,
 * or via the "/" button in AppHeader. Results are grouped by kind, keyboard
 * navigable (↑↓ to move, Enter to open, Esc to close).
 *
 * Style: Feed dashboard surface — slate card, 1px border, rounded.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, Modal, ScrollView, StyleSheet, Platform } from "react-native";
import { searchCircleContent, hitToDeeplink, type SearchHit, type SearchKind } from "../lib/search";
import { ALL_QUICK_ACTIONS, type QuickActionItem } from "../lib/chatActions";
import { getRecentActions, recordRecentAction, clearRecentActions } from "../lib/recentActions";
import { useAuth } from "../hooks/useAuth";

interface Props {
  circleId: string;
  visible: boolean;
  onClose: () => void;
  /** Optional: route the selected content hit somewhere. Defaults to
   *  setting the appropriate deeplink key and calling onClose so the
   *  corresponding consumer (FeedTab, MissionsTab, etc.) picks it up on
   *  next render. */
  onSelect?: (hit: SearchHit) => void;
  /** Optional: handle a quick-action selection (the "Actions" row in the
   *  omnibar). Defaults to dispatching a window event so the quick-action
   *  router in ChatTab picks it up. */
  onActionSelect?: (action: QuickActionItem) => void;
}

const KIND_META: Record<SearchKind, { label: string; color: string; glyph: string }> = {
  mission:      { label: "Missions",      color: "#f59e0b", glyph: "#" },
  mission_task: { label: "Mission tasks", color: "#a855f7", glyph: "›" },
  task:         { label: "Tasks",         color: "#60a5fa", glyph: "☐" },
  goal:         { label: "Goals",         color: "#22c55e", glyph: "◎" },
  proof:        { label: "Proofs",        color: "#eab308", glyph: "✓" },
  message:      { label: "Messages",      color: "#94a3b8", glyph: "…" },
};

const KIND_ORDER: SearchKind[] = ["mission", "mission_task", "task", "goal", "proof", "message"];

// Default action router: dispatches the quick-action text as a window event
// the existing quick-action handler in ChatTab already understands.
function defaultActionSelect(action: QuickActionItem) {
  if (typeof window === "undefined") return;
  try { window.dispatchEvent(new CustomEvent("uc:run-quick-action", { detail: action })); } catch {}
}

export default function SearchModal({ circleId, visible, onClose, onSelect, onActionSelect }: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<TextInput>(null);
  const seqRef = useRef(0);

  // Rehydrate the last query each open so users don't lose context when
  // they dismiss ⌘K to check something and come back. Stored per-circle
  // because search is circle-scoped. Cleared by the Clear Recent action
  // alongside the action history.
  const legacyQueryStorageKey = `uc_omnibar_query_${circleId}`;
  const queryStorageKey = user?.id
    ? `uc_omnibar_query_v2:${encodeURIComponent(user.id.toLowerCase())}:${encodeURIComponent(circleId)}`
    : null;
  const [recentActions, setRecentActions] = useState<QuickActionItem[]>([]);
  useEffect(() => {
    if (!visible) return;
    // Rehydrate the saved query (if any); fall back to empty. Debounced
    // search effect below will re-run based on the new value.
    let saved = "";
    if (typeof window !== "undefined") {
      try {
        // A circle-only query can contain personal names or task text. It has
        // no trustworthy owner, so retire it instead of migrating it.
        window.localStorage.removeItem(legacyQueryStorageKey);
        if (queryStorageKey) saved = window.localStorage.getItem(queryStorageKey) || "";
      } catch {}
    }
    setQuery(saved);
    setHits([]);
    setHighlight(0);
    setRecentActions(getRecentActions());
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [legacyQueryStorageKey, visible, queryStorageKey]);

  // Persist every keystroke so quick dismiss+reopen cycles keep context.
  useEffect(() => {
    if (!visible) return;
    if (typeof window === "undefined") return;
    if (!queryStorageKey) return;
    try { window.localStorage.setItem(queryStorageKey, query); } catch {}
  }, [visible, query, queryStorageKey]);

  // Debounced search: 140ms after the last keystroke, 0ms on first character.
  useEffect(() => {
    if (!visible) return;
    if (query.trim().length < 2) { setHits([]); setLoading(false); return; }
    const seq = ++seqRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      searchCircleContent(circleId, query, 30).then((rows) => {
        if (seq !== seqRef.current) return;
        setHits(rows);
        setHighlight(0);
        setLoading(false);
      }).catch(() => {
        if (seq !== seqRef.current) return;
        setHits([]);
        setLoading(false);
      });
    }, 140);
    return () => clearTimeout(timer);
  }, [circleId, query, visible]);

  const groupedHits = useMemo(() => {
    const groups = new Map<SearchKind, SearchHit[]>();
    for (const h of hits) {
      const arr = groups.get(h.kind) || [];
      arr.push(h);
      groups.set(h.kind, arr);
    }
    return KIND_ORDER
      .filter((k) => groups.has(k))
      .map((k) => ({ kind: k, items: groups.get(k)! }));
  }, [hits]);

  // Filtered quick actions — substring match on label when there's a query,
  // otherwise top 8 by declaration order. Mission-loop commands lead so
  // "New Mission" / "Log Proof" are one keystroke away.
  const filteredActions = useMemo<QuickActionItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ALL_QUICK_ACTIONS.slice(0, 8);
    return ALL_QUICK_ACTIONS.filter((a) => a.label.toLowerCase().includes(q)).slice(0, 8);
  }, [query]);

  // Recent actions — only shown when the input is empty. Dedupe against the
  // static filtered list so the user doesn't see the same label twice.
  const recentForRender = useMemo<QuickActionItem[]>(() => {
    if (query.trim().length > 0) return [];
    const seen = new Set(filteredActions.map((a) => a.text));
    return recentActions.filter((a) => !seen.has(a.text));
  }, [query, filteredActions, recentActions]);

  // Unified selectable list: recent first, then actions, then content hits.
  // Highlight index maps across all three so ↑↓↩ walks the whole list.
  const combined = useMemo(() => {
    const rows: Array<
      | { type: "recent"; action: QuickActionItem }
      | { type: "action"; action: QuickActionItem }
      | { type: "hit"; hit: SearchHit }
    > = [];
    for (const a of recentForRender) rows.push({ type: "recent", action: a });
    for (const a of filteredActions) rows.push({ type: "action", action: a });
    for (const h of hits) rows.push({ type: "hit", hit: h });
    return rows;
  }, [recentForRender, filteredActions, hits]);

  const handleSelectHit = (hit: SearchHit) => {
    if (onSelect) {
      onSelect(hit);
    } else {
      const link = hitToDeeplink(hit);
      if (link && typeof window !== "undefined") {
        try { window.localStorage.setItem(link.key, link.value); } catch {}
      }
    }
    onClose();
  };

  const handleSelectAction = (action: QuickActionItem) => {
    // Persist so the Recent row surfaces it on the next open.
    recordRecentAction(action);
    (onActionSelect ?? defaultActionSelect)(action);
    onClose();
  };

  // Keyboard nav (web) — intercepts before TextInput handles it. Walks the
  // combined action+hit list so Enter lands on whatever's highlighted.
  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return; }
      if (combined.length === 0) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => Math.min(h + 1, combined.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const row = combined[highlight];
        if (!row) return;
        if (row.type === "action" || row.type === "recent") handleSelectAction(row.action);
        else handleSelectHit(row.hit);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [visible, combined, highlight, onClose]);

  // Reset highlight when the combined list changes shape.
  useEffect(() => { setHighlight(0); }, [query]);

  // For hit-row highlighting, map each hit to its position in combined.
  const hitIndex = useMemo(() => {
    const map = new Map<string, number>();
    combined.forEach((row, i) => {
      if (row.type === "hit") map.set(row.hit.id, i);
    });
    return map;
  }, [combined]);

  // And for action + recent rows too, so onHover syncs highlight. Keyed
  // by `${type}:${text}` since the same action can appear in both rows.
  const actionIndex = useMemo(() => {
    const map = new Map<string, number>();
    combined.forEach((row, i) => {
      if (row.type === "action" || row.type === "recent") {
        map.set(`${row.type}:${row.action.text}`, i);
      }
    });
    return map;
  }, [combined]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          <View style={s.inputRow}>
            <Text style={s.inputGlyph}>/</Text>
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search missions, tasks, goals, messages…"
              placeholderTextColor="#475569"
              style={s.input}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable onPress={onClose} style={s.escBtn}>
              <Text style={s.escText}>ESC</Text>
            </Pressable>
          </View>
          <View style={s.divider} />

          <ScrollView style={{ maxHeight: 480 }}>
            <View style={{ gap: 4, paddingVertical: 4 }}>
              {/* Recent actions — only when the input is empty. Lets users
                  re-fire their last few quick actions without scanning the
                  full list. Includes a small clear affordance. */}
              {recentForRender.length > 0 && (
                <View style={{ gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingRight: 14 }}>
                    <Text style={[s.groupLabel, { color: "#6366f1" }]}>Recent</Text>
                    <Pressable
                      onPress={() => { clearRecentActions(); setRecentActions([]); }}
                      style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}
                    >
                      <Text style={{ color: "#64748b", fontSize: 9, fontWeight: "800", letterSpacing: 1, fontFamily: "monospace" }}>
                        CLEAR
                      </Text>
                    </Pressable>
                  </View>
                  {recentForRender.map((a) => {
                    const idx = actionIndex.get(`recent:${a.text}`) ?? 0;
                    const active = idx === highlight;
                    return (
                      <Pressable
                        key={`rec-${a.text}`}
                        onPress={() => handleSelectAction(a)}
                        onHoverIn={Platform.OS === "web" ? () => setHighlight(idx) : undefined}
                        style={[s.row, active && s.rowActive]}
                      >
                        <View style={[s.kindChip, { borderColor: "#6366f160" }]}>
                          <Text style={[s.kindChipText, { color: "#6366f1" }]}>↺</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.rowTitle} numberOfLines={1}>{a.label}</Text>
                          <Text style={s.rowSub} numberOfLines={1}>RECENT</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Quick actions section — always visible, filtered by the
                  query. Actions lead so Enter on an empty query hits the
                  most useful action instead of a stale message. */}
              {filteredActions.length > 0 && (
                <View style={{ gap: 2 }}>
                  <Text style={[s.groupLabel, { color: "#a855f7" }]}>Actions</Text>
                  {filteredActions.map((a) => {
                    const idx = actionIndex.get(`action:${a.text}`) ?? 0;
                    const active = idx === highlight;
                    return (
                      <Pressable
                        key={`act-${a.text}`}
                        onPress={() => handleSelectAction(a)}
                        onHoverIn={Platform.OS === "web" ? () => setHighlight(idx) : undefined}
                        style={[s.row, active && s.rowActive]}
                      >
                        <View style={[s.kindChip, { borderColor: "#a855f760" }]}>
                          <Text style={[s.kindChipText, { color: "#a855f7" }]}>⚡</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={s.rowTitle} numberOfLines={1}>{a.label}</Text>
                          <Text style={s.rowSub} numberOfLines={1}>
                            {a.mode === "prefill" ? "PREFILL" : a.mode === "special" ? "ACTION" : "SEND"}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Content results — missions, tasks, goals, proofs, messages.
                  Requires 2+ characters because the search RPC only fires then. */}
              {query.trim().length < 2 ? (
                <Text style={s.hint}>Type to search missions, tasks, goals, messages…</Text>
              ) : loading && hits.length === 0 ? (
                <Text style={s.hint}>Searching…</Text>
              ) : hits.length === 0 ? (
                <Text style={s.hint}>No content matches for "{query.trim()}".</Text>
              ) : (
                groupedHits.map((g) => (
                  <View key={g.kind} style={{ gap: 2 }}>
                    <Text style={[s.groupLabel, { color: KIND_META[g.kind].color }]}>
                      {KIND_META[g.kind].label}
                    </Text>
                    {g.items.map((h) => {
                      const idx = hitIndex.get(h.id) ?? 0;
                      const active = idx === highlight;
                      return (
                        <Pressable
                          key={`${h.kind}-${h.id}`}
                          onPress={() => handleSelectHit(h)}
                          onHoverIn={Platform.OS === "web" ? () => setHighlight(idx) : undefined}
                          style={[s.row, active && s.rowActive]}
                        >
                          <View style={[s.kindChip, { borderColor: KIND_META[h.kind].color + "60" }]}>
                            <Text style={[s.kindChipText, { color: KIND_META[h.kind].color }]}>
                              {KIND_META[h.kind].glyph}
                            </Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={s.rowTitle} numberOfLines={1}>{h.title || "(untitled)"}</Text>
                            {h.subtitle ? (
                              <Text style={s.rowSub} numberOfLines={1}>{h.subtitle.toUpperCase()}</Text>
                            ) : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              )}
            </View>
          </ScrollView>

          <View style={s.footer}>
            <Text style={s.footerHint}>↑↓ to move · ↵ to open · ESC to close</Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(3, 7, 18, 0.78)",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 80,
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    maxWidth: 640,
    backgroundColor: "#0f172a",
    borderWidth: 1,
    borderColor: "#1f2937",
    borderRadius: 16,
    padding: 4,
    ...(Platform.OS === "web" ? { boxShadow: "0 30px 80px rgba(0,0,0,0.55)" } as any : {}),
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inputGlyph: {
    color: "#64748b",
    fontSize: 16,
    fontWeight: "700",
  },
  input: {
    flex: 1,
    color: "#e5eefc",
    fontSize: 15,
    fontWeight: "500",
    ...(Platform.OS === "web" ? { outlineStyle: "none" } as any : {}),
  },
  escBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#243041",
    borderRadius: 8,
    backgroundColor: "#111827",
  },
  escText: {
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  divider: {
    height: 1,
    backgroundColor: "#1f2937",
  },
  hint: {
    color: "#64748b",
    fontSize: 13,
    fontWeight: "500",
    padding: 20,
    textAlign: "center",
  },
  groupLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    fontFamily: "monospace",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: 4,
    borderRadius: 10,
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "background-color 0.1s ease" } as any : {}),
  },
  rowActive: {
    backgroundColor: "#1e1b4b",
  },
  kindChip: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111827",
  },
  kindChipText: {
    fontSize: 11,
    fontWeight: "800",
    fontFamily: "monospace",
  },
  rowTitle: {
    color: "#e5eefc",
    fontSize: 13,
    fontWeight: "600",
  },
  rowSub: {
    color: "#64748b",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    marginTop: 2,
    fontFamily: "monospace",
  },
  footer: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#1f2937",
  },
  footerHint: {
    color: "#475569",
    fontSize: 10,
    fontWeight: "600",
    fontFamily: "monospace",
    letterSpacing: 0.5,
  },
});
