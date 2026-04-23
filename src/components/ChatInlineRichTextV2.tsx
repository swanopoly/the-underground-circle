/**
 * ChatInlineRichTextV2 — rich-text renderer for chat messages. Replaces the
 * legacy ChatInlineRichText (which lives in a read-only dir from a prior
 * session) while preserving its features and adding structured
 * @[kind:id:label] mention-chip rendering.
 *
 * Handling order:
 *   1. Structured mention tokens → colored chips (user/mission/task)
 *   2. Legacy @username in remaining text runs → accent highlight
 *   3. **bold** segments → bold + white
 */

import React from "react";
import { Platform, StyleSheet, Text } from "react-native";
import { parseMentions, type MentionKind } from "../lib/mentions";

type Props = {
  content: string;
  accentColor: string;
  textColor?: string;
  /** Optional handler fires when a mention chip is tapped. If omitted, a
   *  sensible default (setting a deeplink) is used for mission chips so the
   *  user ends up on the right page when they switch tabs. */
  onMentionPress?: (kind: MentionKind, id: string) => void;
};

/** Default handler for mention chip presses. Writes a deeplink intent to
 *  localStorage so the target screen picks it up on next mount. Lives in
 *  one place so all message-rendering paths share behavior. */
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

function kindPrefix(kind: MentionKind): string {
  if (kind === "user") return "@";
  if (kind === "mission") return "#";
  return "›";
}

function kindTint(kind: MentionKind) {
  if (kind === "user") return { color: "#22d3ee", backgroundColor: "#22d3ee15" };
  if (kind === "mission") return { color: "#f59e0b", backgroundColor: "#f59e0b15" };
  return { color: "#a855f7", backgroundColor: "#a855f715" };
}

export default function ChatInlineRichTextV2({ content, accentColor, textColor = "#ccc", onMentionPress }: Props) {
  const segments = parseMentions(content);
  const handlePress = onMentionPress ?? defaultMentionPress;

  return (
    <Text style={[styles.base, { color: textColor }]}>
      {segments.map((seg, index) => {
        if (seg.type === "mention") {
          return (
            <Text
              key={`chip-${index}`}
              style={[styles.chip, kindTint(seg.ref.kind)]}
              onPress={() => handlePress(seg.ref.kind, seg.ref.id)}
            >
              {kindPrefix(seg.ref.kind)}{seg.ref.label}
            </Text>
          );
        }
        const parts = seg.text.split(/(@\w+)/g);
        return parts.map((part, i) => {
          if (part.startsWith("@")) {
            return (
              <Text key={`m-${index}-${i}`} style={[styles.mention, { color: accentColor }]}>
                {part}
              </Text>
            );
          }
          const boldParts = part.split(/(\*\*[^*]+\*\*)/g);
          return boldParts.map((bp, bi) => {
            if (bp.startsWith("**") && bp.endsWith("**")) {
              return (
                <Text key={`b-${index}-${i}-${bi}`} style={styles.bold}>
                  {bp.slice(2, -2)}
                </Text>
              );
            }
            return <Text key={`t-${index}-${i}-${bi}`}>{bp}</Text>;
          });
        });
      })}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontSize: 15,
    lineHeight: 22,
  },
  mention: {
    fontWeight: "700",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 4,
    borderRadius: 12,
  },
  chip: {
    fontFamily: "monospace",
    fontWeight: "900",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
    borderRadius: 2,
  },
  bold: {
    fontWeight: "800",
    color: "#fff",
    ...(Platform.OS === "web" ? { fontSynthesis: "none" } as any : {}),
  },
});
