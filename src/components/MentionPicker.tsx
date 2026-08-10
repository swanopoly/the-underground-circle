/**
 * MentionPicker — autocomplete popup triggered by `@` in a text input.
 *
 * Usage pattern:
 *   <TextInput
 *     value={text}
 *     onChangeText={(t) => {
 *       setText(t);
 *       const q = detectMentionQuery(t, cursorPos);
 *       setQuery(q);  // null when no `@` context active
 *     }}
 *     onSelectionChange={(e) => setCursorPos(e.nativeEvent.selection.end)}
 *   />
 *   <MentionPicker
 *     circleId={circleId}
 *     query={query}
 *     onSelect={(cand) => {
 *       const next = insertMention(text, cursorPos, cand);
 *       setText(next.text);
 *       setCursorPos(next.cursor);
 *       setQuery(null);
 *     }}
 *     onDismiss={() => setQuery(null)}
 *   />
 *
 * Style: UC B&W terminal aesthetic (docs/UC_STYLE_GUIDE.md).
 */

import React, { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import {
  searchMentionCandidates,
  formatMentionToken,
  type MentionCandidate,
  type MentionKind,
} from "../lib/mentions";

interface Props {
  circleId: string;
  query: string | null;
  onSelect: (cand: MentionCandidate) => void;
  onDismiss: () => void;
  /** Optional: position as an absolute overlay. Default is an inline panel. */
  style?: any;
}

/** Given a text value + cursor position, return the query after the most
 *  recent `@` if we're inside a mention context, else null. */
export function detectMentionQuery(text: string, cursor: number): string | null {
  if (cursor <= 0) return null;
  const upTo = text.slice(0, cursor);
  const atIdx = upTo.lastIndexOf("@");
  if (atIdx < 0) return null;
  // Must be at start of input or preceded by whitespace.
  if (atIdx > 0 && !/\s/.test(upTo[atIdx - 1])) return null;
  const query = upTo.slice(atIdx + 1);
  // Cancel on whitespace or newline — those end the mention context.
  if (/\s/.test(query)) return null;
  // Cap query length to prevent runaway RPC queries on pathological input.
  if (query.length > 40) return null;
  return query;
}

export function insertMention(
  text: string,
  cursor: number,
  cand: MentionCandidate,
): { text: string; cursor: number } {
  const upTo = text.slice(0, cursor);
  const atIdx = upTo.lastIndexOf("@");
  if (atIdx < 0) return { text, cursor };
  const token = formatMentionToken({ kind: cand.kind, id: cand.id, label: cand.label });
  const before = text.slice(0, atIdx);
  const after = text.slice(cursor);
  const inserted = token + " ";
  return { text: before + inserted + after, cursor: atIdx + inserted.length };
}

export default function MentionPicker({ circleId, query, onSelect, onDismiss, style }: Props) {
  const [candidates, setCandidates] = useState<MentionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const seqRef = useRef(0);

  // 120ms debounce so fast typing doesn't fire a Supabase RPC per keystroke.
  // Empty-query case (just typed "@") should still fire immediately so the
  // user sees candidates right away without a perceptible delay.
  useEffect(() => {
    if (query === null) {
      setCandidates([]);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const delay = query.length === 0 ? 0 : 120;
    const timer = setTimeout(() => {
      // Bumped to 12 — with 7 categories, 8 was too restrictive; users
      // typing a vague query frequently saw their target in the bottom
      // of the truncated list.
      searchMentionCandidates(circleId, query, 12)
        .then((rows) => {
          if (seq !== seqRef.current) return;
          setCandidates(rows);
          setHighlight(0);
          setLoading(false);
        })
        .catch(() => {
          if (seq !== seqRef.current) return;
          setCandidates([]);
          setLoading(false);
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [circleId, query]);

  useEffect(() => {
    if (Platform.OS !== "web" || query === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onDismiss(); return; }
      if (candidates.length === 0) return;
      if (e.key === "ArrowDown") { e.preventDefault(); setHighlight((h) => (h + 1) % candidates.length); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setHighlight((h) => (h - 1 + candidates.length) % candidates.length); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        onSelect(candidates[highlight]);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [query, candidates, highlight, onSelect, onDismiss]);

  if (query === null) return null;

  return (
    <View style={[s.panel, style]} nativeID="section-mention-picker">
      {loading && candidates.length === 0 ? (
        <Text style={s.loading}>SEARCHING...</Text>
      ) : candidates.length === 0 ? (
        <Text style={s.loading}>NO MATCHES FOR "{query}"</Text>
      ) : (
        candidates.map((cand, i) => {
          const active = i === highlight;
          return (
            <Pressable
              key={`${cand.kind}-${cand.id}`}
              onPress={() => onSelect(cand)}
              onHoverIn={Platform.OS === "web" ? () => setHighlight(i) : undefined}
              style={[s.row, active && s.rowActive]}
            >
              <View style={[s.kindBadge, kindBadgeColor(cand.kind)]}>
                <Text style={s.kindText}>{kindGlyph(cand.kind)}</Text>
              </View>
              <View style={s.rowTextBox}>
                <Text style={s.rowLabel} numberOfLines={1}>{cand.label}</Text>
                {cand.sublabel ? (
                  <Text style={s.rowSub} numberOfLines={1}>{cand.sublabel}</Text>
                ) : null}
              </View>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

function kindGlyph(kind: MentionKind): string {
  switch (kind) {
    case "user":         return "@";
    case "mission":      return "#";
    case "mission_task": return ">";
    case "agent":        return "✦";   // distinct from @ to surface the dispatch lane
    case "circle":       return "◎";
    case "room":         return "▢";
    case "slash":        return "/";
    default:             return ">";
  }
}

function kindBadgeColor(kind: MentionKind) {
  switch (kind) {
    case "user":         return { borderColor: "rgba(99, 102, 241, 0.67)" };
    case "mission":      return { borderColor: "#f59e0b" };
    case "mission_task": return { borderColor: "#a855f7" };
    case "agent":        return { borderColor: "#22c55e" };
    case "circle":       return { borderColor: "#6366f1" };
    case "room":         return { borderColor: "#a855f7" };
    case "slash":        return { borderColor: "#94a3b8" };
    default:             return { borderColor: "#94a3b8" };
  }
}

const s = StyleSheet.create({
  panel: {
    backgroundColor: "#000",
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 2,
    padding: 6,
    gap: 2,
    maxWidth: 340,
    ...(Platform.OS === "web" ? { boxShadow: "0 0 60px rgba(255,255,255,0.08)" } as any : {}),
  },
  loading: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
    padding: 10,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: "transparent",
    ...(Platform.OS === "web" ? { transition: "all 0.1s ease", cursor: "pointer" } as any : {}),
  },
  rowActive: {
    borderColor: "#333",
    backgroundColor: "#0a0a0a",
  },
  kindBadge: {
    width: 22,
    height: 22,
    borderWidth: 1,
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0a0a",
  },
  kindText: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "900",
  },
  rowTextBox: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1,
  },
  rowSub: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 2,
  },
});
