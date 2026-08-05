// chatCommandDispatchCore — pure slash-command matcher / dispatch-table builder.
//
// De-risks CONSOLIDATE #4 of docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md:
// table-dispatch the ~54 inline slash intercepts out of ChatTab.tsx's 19k-line
// send path. Today `sendMessage` hand-rolls dozens of
//   `if (lowerContent === '/x' || lowerContent.startsWith('/x '))`
// intercepts (grep: ChatTab.tsx lines ~7396-9312). This module extracts the
// HARD, testable part of that consolidation — the exact/prefix matcher, the
// longest-command-wins specificity rule, and the argsText slice — as a pure
// core so the eventual wiring is "call matchChatCommand, dispatch by commandId",
// not "re-implement matching in a god-component".
//
// Matching semantics (mirrors ChatTab's literal-space intercepts exactly):
//   - Only string input beginning with '/' (after trim) can match.
//   - A command/alias token matches when the trimmed input EQUALS it
//     (case-insensitive) or STARTS WITH `token + ' '` (a single space, like
//     `lowerContent[8] === ' '` in the /mission intercept).
//   - The MOST SPECIFIC (longest) token wins, so `/mission status` resolves to
//     the mission-status definition rather than `/mission` treating "status"
//     as args, and a short `/c` can never shadow `/context`.
//   - A definition's own canonical `command` outranks another definition's
//     alias of the same string (so `/help` → the help def, not commands').
//   - argsText is the trailing text after the matched token, trimmed, with the
//     ORIGINAL case preserved.
//
// PURITY: no runtime imports (type-only), no Date.now()/Math.random(). Every
// export is TOTAL — null/undefined/wrong-type/huge/hostile/cyclic input yields
// a safe neutral value ({matched:false} / {}) and never throws. Bounded (token,
// args, entry, and alias caps). Secret-safe (echoes only the caller's own args).

// Type-only grounding against the real registry shape (erased at compile time,
// so this stays loadable under tsx with no react-native/supabase in the graph).
import type { ChatCommandDefinition } from './chatCommandRegistry';

export interface CommandMatch {
  matched: boolean;
  commandId?: string;
  routeId?: string;
  argsText?: string;
  command?: string;
}

export interface CommandDispatchEntry {
  commandId: string;
  routeId: string;
}

// Bounds — keep every path cheap even for hostile / giant inputs.
const MAX_TOKEN = 64; // longest real command is '/memory-bank update' (19)
const HEAD = 320; // only the leading slice decides the command token
const MAX_ARGS = 100_000; // cap echoed trailing text
const MAX_ENTRIES = 5_000; // cap registry rows processed
const MAX_ALIASES = 64; // cap aliases per entry

const NO_MATCH: CommandMatch = { matched: false };
const SPACE = 32;
const SLASH = 47;

interface NormalizedEntry {
  id: string;
  routeId: string;
  command: string; // trimmed, original case, guaranteed to start with '/'
  aliasTokens: string[]; // trimmed, original case, each starts with '/'
}

interface Candidate {
  token: string; // lowercased command/alias, e.g. '/hf help'
  command: string; // canonical (original-case) command of the owning def
  commandId: string;
  routeId: string;
  order: number; // insertion order for a stable tiebreak
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Validate one raw registry row into a normalized entry, or null if unusable.
function readEntry(raw: unknown): NormalizedEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<ChatCommandDefinition>;
  const id = readString(row.id).trim();
  const command = readString(row.command).trim();
  if (!id || !command) return null;
  if (command.charCodeAt(0) !== SLASH) return null;
  if (command.length > MAX_TOKEN) return null;
  const routeId = readString(row.routeId).trim();

  const aliasTokens: string[] = [];
  const rawAliases = Array.isArray(row.aliases) ? row.aliases : [];
  const aliasLimit = Math.min(rawAliases.length, MAX_ALIASES);
  for (let i = 0; i < aliasLimit; i++) {
    const alias = readString(rawAliases[i]).trim();
    if (!alias || alias.charCodeAt(0) !== SLASH || alias.length > MAX_TOKEN) continue;
    aliasTokens.push(alias);
  }

  return { id, routeId, command, aliasTokens };
}

function normalizeRegistry(registry: unknown): NormalizedEntry[] {
  const rows = Array.isArray(registry) ? registry : [];
  const limit = Math.min(rows.length, MAX_ENTRIES);
  const entries: NormalizedEntry[] = [];
  for (let i = 0; i < limit; i++) {
    const entry = readEntry(rows[i]);
    if (entry) entries.push(entry);
  }
  return entries;
}

// Build the candidate list sorted longest-token-first. Canonical commands are
// pushed before aliases so that, at equal length, a definition's own command
// outranks another definition's alias of the same string.
function buildCandidates(registry: unknown): Candidate[] {
  const entries = normalizeRegistry(registry);
  const cands: Candidate[] = [];
  for (const entry of entries) {
    cands.push({
      token: entry.command.toLowerCase(),
      command: entry.command,
      commandId: entry.id,
      routeId: entry.routeId,
      order: cands.length,
    });
  }
  for (const entry of entries) {
    for (const alias of entry.aliasTokens) {
      cands.push({
        token: alias.toLowerCase(),
        command: entry.command,
        commandId: entry.id,
        routeId: entry.routeId,
        order: cands.length,
      });
    }
  }
  cands.sort((a, b) => (b.token.length - a.token.length) || (a.order - b.order));
  return cands;
}

function capArgs(text: string): string {
  return text.length > MAX_ARGS ? text.slice(0, MAX_ARGS) : text;
}

/**
 * Match a chat input line against the command registry.
 *
 * Returns the most-specific (longest) command whose canonical command or an
 * alias matches the input exactly or as a `token + ' '` prefix. Non-slash,
 * empty, unknown-type, or unmatched input returns `{ matched: false }`.
 */
export function matchChatCommand(input: unknown, registry: unknown): CommandMatch {
  try {
    if (typeof input !== 'string') return NO_MATCH;
    const trimmed = input.trim();
    if (!trimmed || trimmed.charCodeAt(0) !== SLASH) return NO_MATCH;

    const candidates = buildCandidates(registry);
    if (candidates.length === 0) return NO_MATCH;

    // Only the leading portion decides the command token; everything after the
    // separating space is argsText. This keeps huge pastes O(token) to match.
    const headLen = trimmed.length > HEAD ? HEAD : trimmed.length;
    const lowerHead = trimmed.slice(0, headLen).toLowerCase();
    const fullLen = trimmed.length;

    for (const cand of candidates) {
      const token = cand.token;
      const tokLen = token.length;

      // Exact match: the whole trimmed input equals the token (ci).
      if (fullLen === tokLen && lowerHead === token) {
        return {
          matched: true,
          commandId: cand.commandId,
          routeId: cand.routeId,
          command: cand.command,
          argsText: '',
        };
      }

      // Prefix match: token immediately followed by a single space, then args.
      if (
        fullLen > tokLen
        && lowerHead.length > tokLen
        && lowerHead.charCodeAt(tokLen) === SPACE
        && lowerHead.startsWith(token)
      ) {
        const argsText = capArgs(trimmed.slice(tokLen + 1).trim());
        return {
          matched: true,
          commandId: cand.commandId,
          routeId: cand.routeId,
          command: cand.command,
          argsText,
        };
      }
    }

    return NO_MATCH;
  } catch {
    return { matched: false };
  }
}

/**
 * Build a normalized O(1) lookup table (each command + alias → entry) for
 * dispatch. A definition's own canonical command wins over another definition's
 * alias of the same string. Keys are lowercased/trimmed command strings.
 */
export function buildCommandDispatchTable(
  registry: unknown,
): Record<string, CommandDispatchEntry> {
  // Null-proto map so hostile keys like '/__proto__' become normal own
  // properties and can never pollute Object.prototype.
  const table = Object.create(null) as Record<string, CommandDispatchEntry>;
  try {
    const entries = normalizeRegistry(registry);

    // Pass 1: canonical commands claim their key first.
    for (const entry of entries) {
      const key = entry.command.toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(table, key)) {
        table[key] = { commandId: entry.id, routeId: entry.routeId };
      }
    }
    // Pass 2: aliases only fill keys not already owned by a canonical command.
    for (const entry of entries) {
      for (const alias of entry.aliasTokens) {
        const key = alias.toLowerCase();
        if (!Object.prototype.hasOwnProperty.call(table, key)) {
          table[key] = { commandId: entry.id, routeId: entry.routeId };
        }
      }
    }
  } catch {
    return Object.create(null) as Record<string, CommandDispatchEntry>;
  }
  return table;
}
