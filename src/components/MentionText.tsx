/**
 * MentionText — renders a string that may contain @[kind:id:label] tokens,
 * turning mention tokens into visually distinct chips while preserving
 * surrounding text as plain text.
 *
 * Drop-in replacement for <Text>{content}</Text> in any place where
 * mentions might appear. Passes styles through to the base Text so you can
 * inherit parent styling (muted, sized, colored, etc.).
 *
 *   <MentionText content={message.content} style={styles.bubble} />
 *
 * Styles for mention chips: cyan accent + subtle background. Users can still
 * select text around them on web.
 */

import React from "react";
import { Text, StyleSheet, Platform } from "react-native";
import { parseMentions, type MentionKind } from "../lib/mentions";

interface Props {
  content: string | null | undefined;
  style?: any;
  /** Optional handler fires when a mention chip is tapped. */
  onMentionPress?: (kind: MentionKind, id: string) => void;
  /** Render mentions with even less chrome (for small UI like feed rows). */
  compact?: boolean;
}

/** Fallback press handler: stores the mention id as a deeplink so the
 *  target screen (Missions tab, profile, etc.) picks it up next mount. */
function defaultMentionPress(kind: MentionKind, id: string) {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    if (kind === "mission") {
      window.localStorage.setItem("uc_pending_mission_deeplink", id);
    } else if (kind === "mission_task") {
      window.localStorage.setItem("uc_pending_task_deeplink", id);
    } else if (kind === "user") {
      window.localStorage.setItem("uc_pending_user_deeplink", id);
    }
  } catch {}
}

export default function MentionText({ content, style, onMentionPress, compact }: Props) {
  const segments = parseMentions(content || "");
  if (segments.length === 0) return <Text style={style}>{content || ""}</Text>;
  const handlePress = onMentionPress ?? defaultMentionPress;
  return (
    <Text style={style} selectable>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <Text key={i}>{seg.text}</Text>;
        const chipStyle = compact ? s.chipCompact : s.chip;
        const colorStyle = kindTint(seg.ref.kind);
        return (
          <Text
            key={i}
            style={[chipStyle, colorStyle]}
            onPress={() => handlePress(seg.ref.kind, seg.ref.id)}
          >
            {kindPrefix(seg.ref.kind)}{seg.ref.label}
          </Text>
        );
      })}
    </Text>
  );
}

function kindPrefix(kind: MentionKind): string {
  if (kind === "user") return "@";
  if (kind === "mission") return "#";
  return "›";
}

function kindTint(kind: MentionKind) {
  if (kind === "user") return { color: "#6366f1", backgroundColor: "#6366f115" };
  if (kind === "mission") return { color: "#f59e0b", backgroundColor: "#f59e0b15" };
  return { color: "#a855f7", backgroundColor: "#a855f715" };
}

const s = StyleSheet.create({
  chip: {
    fontFamily: "monospace",
    fontWeight: "900",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
    borderRadius: 2,
  },
  chipCompact: {
    fontFamily: "monospace",
    fontWeight: "900",
  },
});
