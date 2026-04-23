/**
 * BlockBriefEditor — a lightweight, cross-platform block editor for mission
 * briefs. Replaces the old plain-text description field.
 *
 * Why not BlockNote/TipTap: those are React-DOM only and would force a
 * web/native split; UC ships to iOS, Android, and web from one codebase. This
 * editor stores structured blocks as JSON (see brief_blocks in
 * 20260425_notion_features.sql) and renders each block with a native-friendly
 * TextInput. That keeps us portable while still delivering the core Notion
 * primitives: headings, paragraphs, checkboxes, bullets, callouts, code.
 *
 * Block types:
 *   heading (level: 1|2|3)  paragraph  checkbox  bullet  callout  code  divider
 *
 * Slash commands: type "/" at the start of an empty block to pick its type.
 * Special "/ai …" runs the prompt through BlackSwan and inserts paragraphs
 * with the response.
 *
 * @mentions: typing "@query" opens the MentionPicker and inserts a mention
 * token into the current block's text.
 *
 * Style: UC B&W terminal aesthetic.
 */

import React, { useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Platform } from "react-native";
import { supabase } from "../lib/supabase";
import MentionPicker, { detectMentionQuery, insertMention } from "./MentionPicker";
import {
  extractMentionRefs,
  parseMentions,
  formatMentionToken,
  renderMentionsPlain,
} from "../lib/mentions";
import type { MentionCandidate } from "../lib/mentions";

export type BlockType =
  | "heading"
  | "paragraph"
  | "checkbox"
  | "bullet"
  | "callout"
  | "code"
  | "divider";

export interface Block {
  id: string;
  type: BlockType;
  text: string;
  level?: 1 | 2 | 3;    // for heading
  checked?: boolean;     // for checkbox
  language?: string;     // for code
  icon?: string;         // for callout, e.g. "!"
}

interface Props {
  blocks: Block[];
  onChange: (next: Block[]) => void;
  circleId: string;
  placeholder?: string;
  /** Optional: read-only rendering (for history preview). */
  readOnly?: boolean;
}

const SLASH_COMMANDS: Array<{ label: string; sub: string; cmd: string; type: BlockType; extras?: Partial<Block> }> = [
  { label: "HEADING 1",  sub: "# Large",             cmd: "/h1",   type: "heading", extras: { level: 1 } },
  { label: "HEADING 2",  sub: "## Medium",           cmd: "/h2",   type: "heading", extras: { level: 2 } },
  { label: "HEADING 3",  sub: "### Small",           cmd: "/h3",   type: "heading", extras: { level: 3 } },
  { label: "CHECKBOX",   sub: "[ ] Todo item",       cmd: "/todo", type: "checkbox" },
  { label: "BULLET",     sub: "- Item",              cmd: "/list", type: "bullet" },
  { label: "CALLOUT",    sub: "! Important note",    cmd: "/call", type: "callout", extras: { icon: "!" } },
  { label: "CODE",       sub: "`code`",              cmd: "/code", type: "code" },
  { label: "DIVIDER",    sub: "---",                 cmd: "/div",  type: "divider" },
  { label: "AI REWRITE", sub: "/ai <prompt> → Claude", cmd: "/ai", type: "paragraph" },
  { label: "MENTION",    sub: "@ member / mission / task",   cmd: "/mention", type: "paragraph" },
];

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeBlock(type: BlockType, extras: Partial<Block> = {}, text: string = ""): Block {
  return { id: newId(), type, text, ...extras };
}

export default function BlockBriefEditor({ blocks, onChange, circleId, placeholder, readOnly }: Props) {
  // Seed at least one paragraph so the user has somewhere to type.
  const effective = blocks.length > 0 ? blocks : [makeBlock("paragraph", {}, "")];
  const [focusId, setFocusId] = useState<string | null>(null);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [aiRunning, setAiRunning] = useState(false);
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  const updateBlock = (id: string, patch: Partial<Block>) => {
    onChange(effective.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const insertBlockAfter = (id: string, block: Block, focus: boolean = true) => {
    const idx = effective.findIndex((b) => b.id === id);
    const next = [...effective.slice(0, idx + 1), block, ...effective.slice(idx + 1)];
    onChange(next);
    if (focus) setTimeout(() => setFocusId(block.id), 0);
  };

  const deleteBlock = (id: string) => {
    if (effective.length === 1) {
      // Don't delete the last block — empty it instead so the user can keep typing.
      updateBlock(id, { text: "", type: "paragraph" });
      return;
    }
    const idx = effective.findIndex((b) => b.id === id);
    const next = effective.filter((b) => b.id !== id);
    onChange(next);
    const focusTarget = next[Math.max(0, idx - 1)];
    if (focusTarget) setFocusId(focusTarget.id);
  };

  const transformBlock = (id: string, type: BlockType, extras: Partial<Block> = {}) => {
    const block = effective.find((b) => b.id === id);
    if (!block) return;
    updateBlock(id, { type, ...extras, text: block.text.startsWith("/") ? "" : block.text });
    setSlashQuery(null);
  };

  const handleTextChange = (id: string, value: string) => {
    updateBlock(id, { text: value });

    // Slash command detection: first char is "/" AND block is empty-ish
    // (no newlines). Reset when the user types a space to cancel.
    if (value.startsWith("/") && !value.includes("\n") && !value.includes(" ")) {
      setSlashQuery(value.slice(1));
    } else if (!value.startsWith("/")) {
      setSlashQuery(null);
    } else if (value.startsWith("/") && value.includes(" ")) {
      setSlashQuery(null);
    }

    // Mention detection within the current block text (cursorPos updated in
    // onSelectionChange).
    const mq = detectMentionQuery(value, cursorPos);
    setMentionQuery(mq);
  };

  const handleSelectionChange = (pos: number) => {
    setCursorPos(pos);
  };

  const handleSlashSelect = (cmd: (typeof SLASH_COMMANDS)[number]) => {
    if (!focusId) return;
    if (cmd.cmd === "/ai") {
      // Keep the slash block so user can type the prompt and press enter.
      const block = effective.find((b) => b.id === focusId);
      if (block) updateBlock(block.id, { text: "/ai " });
      setSlashQuery(null);
      return;
    }
    if (cmd.cmd === "/mention") {
      // Replace the slash with a bare @ so the mention picker opens.
      const block = effective.find((b) => b.id === focusId);
      if (block) {
        const nextText = "@";
        updateBlock(block.id, { type: "paragraph", text: nextText });
        setCursorPos(nextText.length);
        setMentionQuery("");
      }
      setSlashQuery(null);
      return;
    }
    transformBlock(focusId, cmd.type, cmd.extras);
  };

  const handleMentionSelect = (cand: MentionCandidate) => {
    if (!focusId) return;
    const block = effective.find((b) => b.id === focusId);
    if (!block) return;
    const { text, cursor } = insertMention(block.text, cursorPos, cand);
    updateBlock(block.id, { text });
    setCursorPos(cursor);
    setMentionQuery(null);
  };

  const runAI = async (blockId: string, prompt: string) => {
    if (aiRunning) return;
    const cleaned = prompt.replace(/^\/ai\s*/, "").trim();
    if (!cleaned) return;
    setAiRunning(true);
    try {
      // Context: send the sibling blocks' text so Claude can reason about the brief.
      const contextText = effective
        .filter((b) => b.id !== blockId)
        .map((b) => renderBlockForAI(b))
        .join("\n\n")
        .slice(0, 4000);

      const { data, error } = await supabase.functions.invoke("swanbot-ai", {
        body: {
          circleId,
          message: `Mission brief context:\n---\n${contextText}\n---\n\nInstruction: ${cleaned}\n\nReturn a concise response suitable for inserting into the brief. Plain text or short markdown only.`,
          model: "claude-haiku",
          thinkingLevel: "fast",
          enableTools: false,
        },
      });

      if (error) throw error;
      const responseText = (data as any)?.response || (data as any)?.text || "(no response)";
      // Replace the /ai block with a callout showing the response.
      const lines = String(responseText).split(/\n\n+/).filter((l: string) => l.trim());
      if (lines.length === 0) {
        updateBlock(blockId, { type: "paragraph", text: responseText });
      } else {
        const [first, ...rest] = lines;
        updateBlock(blockId, { type: "callout", icon: "AI", text: first });
        let cursorBlockId = blockId;
        for (const l of rest) {
          const nb = makeBlock("paragraph", {}, l);
          insertBlockAfter(cursorBlockId, nb, false);
          cursorBlockId = nb.id;
        }
      }
    } catch (err: any) {
      updateBlock(blockId, { type: "callout", icon: "!", text: `AI FAILED: ${err?.message || err}` });
    }
    setAiRunning(false);
  };

  // Read-only rendering — used by the history preview.
  if (readOnly) {
    return (
      <View style={s.root}>
        {effective.map((b) => (
          <BlockReadView key={b.id} block={b} />
        ))}
      </View>
    );
  }

  return (
    <View style={s.root}>
      {effective.map((block, idx) => {
        const isFocused = focusId === block.id;
        const showSlash = isFocused && slashQuery !== null;
        const showMention = isFocused && mentionQuery !== null && !showSlash;
        const filteredSlash = slashQuery === null ? [] : SLASH_COMMANDS.filter((c) => {
          const q = slashQuery.toLowerCase();
          return c.cmd.toLowerCase().includes(q) || c.label.toLowerCase().includes(q);
        });
        return (
          <View key={block.id} style={s.blockRow}>
            <BlockPrefix block={block} onToggleCheck={() => updateBlock(block.id, { checked: !block.checked })} />
            <View style={{ flex: 1 }}>
              {block.type === "divider" ? (
                <View style={s.divider} />
              ) : (
                <TextInput
                  ref={(r) => { inputRefs.current[block.id] = r; }}
                  value={block.text}
                  onChangeText={(v) => handleTextChange(block.id, v)}
                  onSelectionChange={(e) => handleSelectionChange(e.nativeEvent.selection.end)}
                  onFocus={() => setFocusId(block.id)}
                  onBlur={() => setTimeout(() => {
                    // Let slash/mention picker clicks fire first.
                    setSlashQuery(null);
                    setMentionQuery(null);
                  }, 120)}
                  placeholder={idx === 0 && !block.text ? (placeholder || "Write, press '/' for commands, '@' to mention…") : ""}
                  placeholderTextColor="#333"
                  multiline={block.type !== "heading"}
                  onKeyPress={Platform.OS === "web" ? (e) => {
                    const ne = e.nativeEvent as any;
                    // Enter on /ai runs the AI instead of adding a newline.
                    if (ne.key === "Enter" && !ne.shiftKey && block.text.trimStart().startsWith("/ai ")) {
                      ne.preventDefault?.();
                      runAI(block.id, block.text);
                      return;
                    }
                    // Enter in a non-paragraph (heading/checkbox/bullet) starts
                    // a new paragraph after, instead of multiline.
                    if (
                      ne.key === "Enter" && !ne.shiftKey &&
                      (block.type === "heading" || block.type === "checkbox" || block.type === "bullet")
                    ) {
                      ne.preventDefault?.();
                      insertBlockAfter(block.id, makeBlock(block.type === "heading" ? "paragraph" : block.type));
                      return;
                    }
                    // Backspace on empty block removes it (+ focuses prev).
                    if (ne.key === "Backspace" && !block.text) {
                      ne.preventDefault?.();
                      deleteBlock(block.id);
                      return;
                    }
                  } : undefined}
                  style={[s.textInput, textStyleFor(block)]}
                />
              )}
              {showSlash && filteredSlash.length > 0 && (
                <View style={s.slashPanel}>
                  {filteredSlash.map((c) => (
                    <Pressable key={c.cmd} onPress={() => handleSlashSelect(c)} style={s.slashRow}>
                      <View style={s.slashLabelBox}>
                        <Text style={s.slashLabel}>{c.label}</Text>
                        <Text style={s.slashSub}>{c.sub}</Text>
                      </View>
                      <Text style={s.slashCmd}>{c.cmd}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              {showMention && (
                <MentionPicker
                  circleId={circleId}
                  query={mentionQuery}
                  onSelect={handleMentionSelect}
                  onDismiss={() => setMentionQuery(null)}
                  style={{ marginTop: 4 }}
                />
              )}
            </View>
          </View>
        );
      })}
      <Pressable
        onPress={() => {
          const last = effective[effective.length - 1];
          insertBlockAfter(last.id, makeBlock("paragraph"));
        }}
        style={s.addBlockBtn}
      >
        <Text style={s.addBlockText}>+ ADD BLOCK</Text>
      </Pressable>
      {aiRunning && (
        <View style={s.aiBadge}>
          <Text style={s.aiBadgeText}>AI RUNNING...</Text>
        </View>
      )}
    </View>
  );
}

// Render a plain-text preview of a block for feeding to the AI as context.
function renderBlockForAI(b: Block): string {
  const text = renderMentionsPlain(b.text || "");
  switch (b.type) {
    case "heading": return `${"#".repeat(b.level || 2)} ${text}`;
    case "checkbox": return `${b.checked ? "[x]" : "[ ]"} ${text}`;
    case "bullet": return `- ${text}`;
    case "callout": return `> ${b.icon || "!"} ${text}`;
    case "code": return "```" + (b.language || "") + "\n" + text + "\n```";
    case "divider": return "---";
    default: return text;
  }
}

// Renders the current mention tokens in-place. When there are no mentions the
// raw text shows through. For real live rendering in the input, React Native's
// TextInput doesn't support inline styled spans, so we rely on the parser
// on read and accept the raw token appearance during edit.
function BlockReadView({ block }: { block: Block }) {
  if (block.type === "divider") return <View style={s.divider} />;
  const segments = parseMentions(block.text || "");
  return (
    <View style={s.blockRow}>
      <BlockPrefix block={block} />
      <View style={{ flex: 1 }}>
        <Text style={[s.textInput, textStyleFor(block)]} selectable>
          {segments.map((seg, i) =>
            seg.type === "text"
              ? <Text key={i}>{seg.text}</Text>
              : <Text key={i} style={s.mentionChip}>@{seg.ref.label}</Text>
          )}
        </Text>
      </View>
    </View>
  );
}

function BlockPrefix({ block, onToggleCheck }: { block: Block; onToggleCheck?: () => void }) {
  if (block.type === "checkbox") {
    return (
      <Pressable onPress={onToggleCheck} style={[s.prefix, s.checkBox, block.checked && s.checkBoxChecked]}>
        {block.checked && <Text style={s.checkText}>x</Text>}
      </Pressable>
    );
  }
  if (block.type === "bullet") {
    return <View style={[s.prefix, s.bullet]} />;
  }
  if (block.type === "callout") {
    return (
      <View style={[s.prefix, s.calloutIcon]}>
        <Text style={s.calloutIconText}>{block.icon || "!"}</Text>
      </View>
    );
  }
  if (block.type === "code") {
    return (
      <View style={[s.prefix, s.codeIcon]}>
        <Text style={s.codeIconText}>{">_"}</Text>
      </View>
    );
  }
  return <View style={s.prefix} />;
}

function textStyleFor(block: Block): any {
  if (block.type === "heading") {
    const sizes = { 1: 22, 2: 18, 3: 14 } as const;
    return { fontSize: sizes[(block.level || 2) as 1 | 2 | 3], fontWeight: "900", letterSpacing: 2, color: "#fff" };
  }
  if (block.type === "code") {
    return { backgroundColor: "#0a0a0a", padding: 8, borderWidth: 1, borderColor: "#333", borderRadius: 2, color: "#22d3ee", fontSize: 12 };
  }
  if (block.type === "callout") {
    return { backgroundColor: "#0a0a0a", padding: 8, borderWidth: 1, borderColor: "#f59e0b", borderRadius: 2, borderLeftWidth: 3, color: "#fff", fontSize: 13 };
  }
  if (block.type === "checkbox" && block.checked) {
    return { color: "#555", textDecorationLine: "line-through" };
  }
  return { color: "#fff", fontSize: 13 };
}

const s = StyleSheet.create({
  root: {
    gap: 6,
  },
  blockRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  prefix: {
    width: 22,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBox: {
    width: 16,
    height: 16,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#666",
    borderRadius: 2,
  },
  checkBoxChecked: {
    backgroundColor: "#22c55e20",
    borderColor: "#22c55e",
  },
  checkText: {
    color: "#22c55e",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
  },
  bullet: {
    width: 4,
    height: 4,
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: "#888",
  },
  calloutIcon: {
    width: 20,
    height: 20,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#f59e0b",
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f59e0b20",
  },
  calloutIconText: {
    color: "#f59e0b",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
  },
  codeIcon: {
    width: 20,
    height: 20,
    marginTop: 6,
    borderWidth: 1,
    borderColor: "#22d3ee",
    borderRadius: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  codeIconText: {
    color: "#22d3ee",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
  },
  divider: {
    height: 1,
    backgroundColor: "#333",
    marginVertical: 10,
  },
  textInput: {
    flex: 1,
    fontFamily: "monospace",
    fontWeight: "700",
    paddingHorizontal: 0,
    paddingVertical: 4,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } as any : {}),
  },
  slashPanel: {
    marginTop: 6,
    backgroundColor: "#000",
    borderWidth: 2,
    borderColor: "#fff",
    borderRadius: 2,
    padding: 6,
    gap: 2,
    ...(Platform.OS === "web" ? { boxShadow: "0 0 60px rgba(255,255,255,0.08)" } as any : {}),
  },
  slashRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: "#222",
    gap: 8,
    ...(Platform.OS === "web" ? { cursor: "pointer", transition: "all 0.1s ease" } as any : {}),
  },
  slashLabelBox: {
    flex: 1,
  },
  slashLabel: {
    color: "#fff",
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  slashSub: {
    color: "#555",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 2,
  },
  slashCmd: {
    color: "#888",
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
  },
  addBlockBtn: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 2,
    ...(Platform.OS === "web" ? { cursor: "pointer" } as any : {}),
  },
  addBlockText: {
    color: "#888",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  aiBadge: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#22d3ee",
    borderRadius: 2,
    backgroundColor: "#22d3ee15",
  },
  aiBadgeText: {
    color: "#22d3ee",
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  mentionChip: {
    color: "#22d3ee",
    backgroundColor: "#22d3ee15",
    fontWeight: "900",
  },
});

/** Mint a Block[] from legacy plain-text description. Used when migrating an
 *  existing mission with no brief_blocks set yet. */
export function blocksFromText(text: string | null | undefined): Block[] {
  if (!text) return [makeBlock("paragraph")];
  const lines = String(text).split("\n");
  const out: Block[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("# "))  { out.push(makeBlock("heading", { level: 1 }, trimmed.slice(2))); continue; }
    if (trimmed.startsWith("## ")) { out.push(makeBlock("heading", { level: 2 }, trimmed.slice(3))); continue; }
    if (trimmed.startsWith("### ")){ out.push(makeBlock("heading", { level: 3 }, trimmed.slice(4))); continue; }
    if (/^[-*]\s/.test(trimmed))   { out.push(makeBlock("bullet", {}, trimmed.replace(/^[-*]\s/, ""))); continue; }
    if (/^\[\s?[xX ]\]\s/.test(trimmed)) {
      const checked = /^\[\s?[xX]\]/.test(trimmed);
      out.push(makeBlock("checkbox", { checked }, trimmed.replace(/^\[\s?[xX ]\]\s/, "")));
      continue;
    }
    out.push(makeBlock("paragraph", {}, trimmed));
  }
  return out.length > 0 ? out : [makeBlock("paragraph")];
}

/** Extract mention refs from all blocks (for persisting to the mentions table). */
export function extractAllMentionsFromBlocks(blocks: Block[]) {
  return blocks.flatMap((b) => extractMentionRefs(b.text || ""));
}

/** Convert blocks back to a plain-text description for backward compatibility. */
export function blocksToPlainText(blocks: Block[]): string {
  return blocks.map(renderBlockForAI).join("\n");
}

// Re-export `formatMentionToken` for convenience to any caller assembling
// blocks programmatically (e.g. mission templates).
export { formatMentionToken };
