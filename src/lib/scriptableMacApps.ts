/**
 * scriptableMacApps — the "research how, then do it" knowledge layer for
 * AppleScript-scriptable macOS apps.
 *
 * The problem this solves: a simple task like "create a note" was getting
 * routed to "unknown app -> needs capability buildout" and stalling, when in
 * fact every scriptable Mac app exposes a native automation surface
 * (AppleScript) the agent can just use. Instead of a per-app adapter, the
 * agent drives the app via a small AppleScript program — the same surface the
 * system's own control-surface order already lists FIRST ("vendor
 * script/plugin/CLI/API surface").
 *
 * This module holds two things:
 *   1. Which common apps are AppleScript-scriptable (so routing can prefer the
 *      script surface instead of demanding buildout).
 *   2. Deterministic AppleScript recipes for the most common "create/add"
 *      intents, built with the safe `on run argv` pattern — user content is
 *      passed as argv and read with `item N of argv`, so quotes, newlines, and
 *      shell/AppleScript metacharacters need no escaping and cannot inject.
 *
 * Pure — no bridge / React Native imports — so it stays smoke-testable. The
 * bridge's `/desktop/applescript` endpoint executes the `{ scriptLines, args }`
 * this produces. For apps/intents without a recipe, the agent can still supply
 * its own `scriptLines` (the "research how" escape hatch) — this module just
 * removes buildout friction for the common cases.
 */

export interface AppleScriptProgram {
  /** `osascript -e` lines, in order. Uses `on run argv` to read params. */
  scriptLines: string[];
  /** argv passed after `--`; referenced as `item N of argv` in the script. */
  args: string[];
  /** Human summary of the effect — for approval prompts and proof. */
  summary: string;
}

// Common AppleScript-scriptable macOS apps, keyed by canonical id with the
// name aliases the agent/router might see. Not exhaustive — the raw-script
// path covers anything not listed.
const SCRIPTABLE_APPS: Record<string, string[]> = {
  notes: ['notes', 'apple notes'],
  reminders: ['reminders'],
  calendar: ['calendar', 'ical'],
  mail: ['mail', 'apple mail'],
  music: ['music', 'itunes'],
  messages: ['messages'],
  contacts: ['contacts', 'address book'],
  finder: ['finder'],
  safari: ['safari'],
  textedit: ['textedit'],
  terminal: ['terminal'],
  'system events': ['system events', 'systemevents'],
};

export function canonicalScriptableApp(name: string | null | undefined): string | null {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  for (const [canon, aliases] of Object.entries(SCRIPTABLE_APPS)) {
    if (canon === n || aliases.includes(n)) return canon;
  }
  return null;
}

export function isScriptableMacApp(name: string | null | undefined): boolean {
  return canonicalScriptableApp(name) !== null;
}

export type ScriptableIntent = 'create_note' | 'create_reminder';

/** Apple Notes: create a new note. Title (optional) becomes the first line so
 *  Notes names the note as requested. */
export function buildCreateNoteProgram(params: { body: string; title?: string }): AppleScriptProgram {
  const title = String(params?.title || '').trim();
  const body = String(params?.body || '');
  const noteBody = title && body.trim() ? `${title}\n${body}` : (title || body);
  return {
    scriptLines: [
      'on run argv',
      'set noteBody to item 1 of argv',
      'tell application "Notes"',
      'activate',
      'set newNote to make new note with properties {body:noteBody}',
      'set noteName to name of newNote',
      'end tell',
      'return noteName',
      'end run',
    ],
    args: [noteBody],
    summary: `Create a Notes note: "${noteBody.replace(/\s+/g, ' ').slice(0, 60)}"`,
  };
}

/** Apple Reminders: create a reminder, optionally in a named list. */
export function buildCreateReminderProgram(params: { text: string; listName?: string }): AppleScriptProgram {
  const text = String(params?.text || '');
  const listName = String(params?.listName || '').trim();
  return {
    scriptLines: [
      'on run argv',
      'set reminderText to item 1 of argv',
      'set listName to item 2 of argv',
      'tell application "Reminders"',
      'activate',
      'if listName is "" then',
      'make new reminder with properties {name:reminderText}',
      'else',
      'tell list listName to make new reminder with properties {name:reminderText}',
      'end if',
      'end tell',
      'return reminderText',
      'end run',
    ],
    args: [text, listName],
    summary: listName
      ? `Create a Reminder in "${listName}": "${text.replace(/\s+/g, ' ').slice(0, 60)}"`
      : `Create a Reminder: "${text.replace(/\s+/g, ' ').slice(0, 60)}"`,
  };
}

/**
 * Map a recognized intent + params to a deterministic program. Returns null
 * when there's no built-in recipe — the caller then either asks the model to
 * supply `scriptLines` (research path) or falls back to UI automation.
 */
export function buildScriptableProgram(
  intent: ScriptableIntent,
  params: Record<string, unknown>,
): AppleScriptProgram | null {
  switch (intent) {
    case 'create_note':
      return buildCreateNoteProgram({
        body: String(params?.body ?? params?.text ?? ''),
        title: params?.title != null ? String(params.title) : undefined,
      });
    case 'create_reminder':
      return buildCreateReminderProgram({
        text: String(params?.text ?? params?.body ?? ''),
        listName: params?.listName != null ? String(params.listName) : undefined,
      });
    default:
      return null;
  }
}

/**
 * Build a program from the `desktop.run_applescript` tool input — the single
 * source of truth for how that tool's args map to a program, used by both the
 * OpenSwan executor and the v2 client dispatcher. Accepts either a recipe
 * (`intent` + `params`) or a raw `scriptLines` (+`args`/`summary`) program.
 * Returns null when neither is usable so callers fail with a clear message.
 */
export function buildProgramFromToolInput(input: Record<string, unknown> | null | undefined): AppleScriptProgram | null {
  const data = input || {};
  const intent = typeof (data as any).intent === 'string' ? (data as any).intent : '';
  if (intent === 'create_note' || intent === 'create_reminder') {
    const params = ((data as any).params && typeof (data as any).params === 'object')
      ? (data as any).params as Record<string, unknown>
      : (data as Record<string, unknown>);
    return buildScriptableProgram(intent, params);
  }
  if (Array.isArray((data as any).scriptLines)) {
    return buildRawAppleScriptProgram(
      ((data as any).scriptLines as unknown[]).map(String),
      Array.isArray((data as any).args) ? ((data as any).args as unknown[]).map(String) : [],
      typeof (data as any).summary === 'string' ? (data as any).summary : 'Run AppleScript',
    );
  }
  return null;
}

/** Wrap caller-supplied AppleScript body lines into a runnable program. Used by
 *  the agent's "research the app's AppleScript, then run it" path for apps
 *  without a built-in recipe. `args` are passed through to `on run argv`. */
export function buildRawAppleScriptProgram(
  scriptLines: string[],
  args: string[] = [],
  summary = 'Run AppleScript',
): AppleScriptProgram | null {
  const lines = (scriptLines || []).map((l) => String(l)).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  // Bound size so a runaway script can't be posted.
  const total = lines.join('\n').length;
  if (total > 10_000) return null;
  return {
    scriptLines: lines,
    args: (args || []).map((a) => String(a)).slice(0, 16),
    summary: String(summary || 'Run AppleScript').slice(0, 120),
  };
}
