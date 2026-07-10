/**
 * chatRoomHandoff — decides when a main-chat conversation has become
 * project-shaped enough to suggest continuing in a project room, and builds
 * the context seed the room receives (Phase 4c of
 * `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`).
 *
 * Rooms have files, services, and a persistent workspace; main chat does
 * not. Today a user doing multi-file work in chat has to switch tabs and
 * rebuild context by hand. This module owns the detection heuristics and
 * seed copy; ChatTab wires the action (create room → seed context message →
 * navigate) through the existing room repository + workspace launcher.
 *
 * Pure module — smoke-testable via tsx (`npm run smoke:chat-room-handoff`).
 * Detection is deliberately conservative: it only fires on repeated
 * concrete file references plus build-intent language, and the suggestion
 * is a dismissible chip — never an automatic move.
 */

// ─── Inputs ─────────────────────────────────────────────────────────────────

export type RoomHandoffMessageInput = {
  content: string;
  isBot: boolean;
};

export type RoomHandoffSuggestion = {
  /** Why the suggestion fired — shown to the user verbatim. */
  reason: string;
  /** Proposed room name (bounded, from thread title or dominant file stem). */
  suggestedRoomName: string;
  /** Distinct file paths mentioned (bounded, most recent first). */
  filesMentioned: string[];
};

// ─── Constants ──────────────────────────────────────────────────────────────

/** Distinct files that must appear before a suggestion fires. */
export const ROOM_HANDOFF_MIN_FILES = 3;
/** How many trailing messages the detector considers. */
export const ROOM_HANDOFF_WINDOW = 20;
const MAX_FILES_LISTED = 8;
const MAX_ROOM_NAME = 60;

const FILE_PATH_PATTERN = /(?:^|[\s`'"(])((?:[\w.-]+\/)*[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|cs|css|scss|html|json|ya?ml|md|sql|sh|toml))(?=$|[\s`'"),:;])/gi;

const BUILD_INTENT_PATTERN = /\b(build|implement|refactor|fix|wire|migrate|component|module|function|endpoint|schema|test|deploy|repo|codebase|pull request|PR)\b/i;

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampText(value: string, max: number): string {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Distinct file paths across a message list, most recent mention first. */
export function extractMentionedFiles(messages: RoomHandoffMessageInput[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  // Walk newest → oldest so the most recently discussed files lead.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = String(messages[i]?.content || '');
    for (const match of content.matchAll(FILE_PATH_PATTERN)) {
      const path = match[1];
      // Skip bare domains that the extension regex can false-positive on.
      if (/\.(?:com|org|net|io)$/i.test(path)) continue;
      const key = path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(path);
    }
  }
  return ordered;
}

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Suggest a room when the recent conversation references several distinct
 * files AND carries build-intent language from the user. Null otherwise —
 * ordinary chat, research, or single-file questions never trigger it.
 */
export function detectRoomHandoffSuggestion(
  messages: RoomHandoffMessageInput[],
  opts: { threadTitle?: string | null } = {},
): RoomHandoffSuggestion | null {
  const window = messages.slice(-ROOM_HANDOFF_WINDOW);
  if (window.length === 0) return null;

  const files = extractMentionedFiles(window);
  if (files.length < ROOM_HANDOFF_MIN_FILES) return null;

  const userHasBuildIntent = window.some(
    (message) => !message.isBot && BUILD_INTENT_PATTERN.test(String(message.content || '')),
  );
  if (!userHasBuildIntent) return null;

  const title = String(opts.threadTitle || '').trim();
  const fallbackStem = files[0]?.split('/').pop()?.replace(/\.\w+$/, '') || 'project';
  const suggestedRoomName = clampText(
    title && !/^new (chat|thread|session)/i.test(title) ? title : `${fallbackStem} workspace`,
    MAX_ROOM_NAME,
  );

  return {
    reason: `This conversation touches ${files.length} files — a room keeps the files, services, and chat together.`,
    suggestedRoomName,
    filesMentioned: files.slice(0, MAX_FILES_LISTED),
  };
}

// ─── Seed message ───────────────────────────────────────────────────────────

/**
 * The context message posted into the new room (as agent output) so work
 * continues without rebuilding context by hand. Bounded — persisted rooms
 * follow the same compact-payload rule as chat metadata.
 */
export function buildRoomHandoffSeedMessage(input: {
  threadTitle?: string | null;
  filesMentioned: string[];
  /** The user's most recent substantive ask, when available. */
  latestUserAsk?: string | null;
}): string {
  const lines: string[] = ['**Continued from main chat.**'];
  const title = String(input.threadTitle || '').trim();
  if (title) lines.push(`Thread: ${clampText(title, 80)}`);
  const ask = String(input.latestUserAsk || '').trim();
  if (ask) lines.push(`Current goal: ${clampText(ask, 240)}`);
  if (input.filesMentioned.length > 0) {
    lines.push('Files in play:');
    for (const file of input.filesMentioned.slice(0, MAX_FILES_LISTED)) {
      lines.push(`- \`${clampText(file, 120)}\``);
    }
  }
  lines.push('Pick up from here — the originating chat thread stays available for follow-ups.');
  return lines.join('\n');
}
