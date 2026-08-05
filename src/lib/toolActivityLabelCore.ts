/**
 * toolActivityLabelCore — pure tool-name → present-tense activity label map
 * for the chat "is typing…" indicator.
 *
 * Problem this fixes: during stream-escalated tool loops
 * (`maybeEscalateStreamedTurnToToolLoop` in `src/lib/swanbot.ts`) and SwanBot
 * v2 client-tool continuations (`callSwanBotV2`'s continuation loop), the user
 * stares at a generic rotating verb ("is noodling…") for 1–3 minutes with no
 * idea which tool is actually running. This module turns a tool name (plus
 * optional args) into a short, user-safe, present-tense label — "Running
 * tests…", "Creating the room…", "git commit…" — that the caller can push
 * into `setCurrentRunStep` / `onStageChange` so the typing strip narrates the
 * loop instead of vamping.
 *
 * PURITY CONTRACT (load-bearing — smoke test runs under tsx/esbuild):
 *  - Zero runtime imports. No react-native, no supabase, no app modules.
 *  - Every export is TOTAL: never throws on any input (null / undefined /
 *    wrong types / Proxies with throwing getters / megabyte strings) — it
 *    returns a safe neutral label instead.
 *  - Deterministic: no Date.now()/Math.random(); same input, same output.
 *  - Bounded: labels are capped at MAX_ACTIVITY_LABEL_CHARS, control
 *    characters are stripped, and args-derived fragments are whitelisted to
 *    command-safe characters so raw tool input can never smuggle secrets,
 *    newlines, or ANSI junk into the UI.
 *
 * Wiring sketch (callers, not this module):
 *  - v2 continuation loop: before `executeClientToolCalls(pendingCalls…)`,
 *    surface `toolActivityLabel(pendingCalls[0]?.name, pendingCalls[0]?.input)`.
 *  - stream-escalated loop: on the `tool_call_start` AgentEvent, surface
 *    `toolActivityLabel(event.toolName, event.input)`.
 *  - ChatTab feeds the label into `setCurrentRunStep`, which
 *    `buildSessionThinkingLabel` already prefers over the rotating verb.
 */

/** Hard cap on any label this module returns. */
export const MAX_ACTIVITY_LABEL_CHARS = 80;

/** The safe neutral label — returned whenever nothing better can be said. */
export const FALLBACK_ACTIVITY_LABEL = 'Working…';

/**
 * Friendly present-tense labels for common tools, keyed by canonical
 * (lowercase) tool name. Names match the OpenSwan tool catalog
 * (`src/lib/openswanToolRuntime.ts`) plus the dot-less legacy client tools
 * (`save_memory`, `search_memories`, `fetch_url`). Frozen so no caller can
 * mutate shared state.
 */
export const TOOL_ACTIVITY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  // ── Workspace: rooms / tasks / missions / goals ──────────────────────────
  'rooms.create': 'Creating the room…',
  'rooms.list': 'Loading rooms…',
  'rooms.send_message': 'Posting to the room…',
  'tasks.create': 'Adding the task…',
  'tasks.list': 'Loading tasks…',
  'tasks.update_status': 'Updating the task…',
  'missions.create': 'Creating the mission…',
  'goals.create': 'Creating the goal…',
  'todo.write': 'Updating the plan…',
  'approvals.request': 'Asking for approval…',

  // ── Local shell / git / verification ─────────────────────────────────────
  'local.run_shell': 'Running the command…',
  'git.run': 'Checking git…',
  'verification.tests': 'Running tests…',
  'verification.typecheck': 'Type-checking…',
  'verification.lint': 'Linting…',
  'verification.preview': 'Building the preview…',

  // ── Codebase / code ───────────────────────────────────────────────────────
  'codebase.search': 'Searching the codebase…',
  'codebase.index': 'Indexing the codebase…',
  'code.generate': 'Writing code…',
  'code.review': 'Reviewing code…',
  'github.read_file': 'Reading from GitHub…',
  'github.activity': 'Checking GitHub…',

  // ── Desktop bridge ────────────────────────────────────────────────────────
  'desktop.read_a11y_tree': 'Reading the screen…',
  'desktop.screenshot': 'Taking a screenshot…',
  'desktop.observe_app': 'Looking at the app…',
  'desktop.launch_app': 'Opening the app…',
  'desktop.open_url': 'Opening the link…',
  'desktop.edit_file': 'Editing the file…',
  'desktop.file_read': 'Reading the file…',
  'desktop.file_write_text': 'Writing the file…',
  'desktop.file_search': 'Searching files…',
  'desktop.click_element': 'Clicking…',
  'desktop.type_text': 'Typing…',

  // ── Engineering / CAD ─────────────────────────────────────────────────────
  'engineering.calc': 'Running the calculation…',
  'engineering.design_part': 'Sizing the part…',
  'engineering.draft_dxf': 'Drafting the drawing…',
  'engineering.model_3d': 'Building the 3D model…',
  'engineering.inspect_mesh': 'Measuring the mesh…',
  'desktop.cad_compile': 'Compiling the CAD model…',

  // ── Browser computer use ──────────────────────────────────────────────────
  'browser.open_url': 'Opening the page…',
  'browser.dom_snapshot': 'Reading the page…',
  'browser.locator_actionability': 'Checking the page target…',
  'browser.screenshot': 'Taking a screenshot…',
  'browser.click_role': 'Clicking on the page…',
  'browser.set_toggle': 'Setting the browser control…',
  'browser.fill_field': 'Filling in the form…',
  'browser.plan_task': 'Planning the browser task…',

  // ── Memory / knowledge ────────────────────────────────────────────────────
  save_memory: 'Saving to memory…',
  search_memories: 'Recalling…',
  fetch_url: 'Fetching…',
  'memory.pin': 'Pinning the memory…',
  'user_memory.manage': 'Updating memory…',
  'context.search': 'Searching past context…',
  'research.search': 'Researching…',

  // ── Google Workspace ──────────────────────────────────────────────────────
  'gmail.write': 'Sending the email…',
  'gmail.read': 'Checking email…',
  'gcal.read': 'Checking the calendar…',
  'gcal.write': 'Updating the calendar…',
  'gdocs.read': 'Reading the doc…',
  'gdocs.append': 'Updating the doc…',
  'gsheets.read': 'Reading the sheet…',
  'gsheets.write': 'Updating the sheet…',
  'gdrive.read': 'Looking in Drive…',

  // ── Misc runtime ──────────────────────────────────────────────────────────
  'tools.search': 'Finding the right tool…',
  'integrations.list': 'Checking integrations…',
  'messaging.notify': 'Sending a heads-up…',
  'vault.find': 'Checking the vault…',
});

/** Canonical verbs `toolFamilyVerb` can return (besides 'work'). */
const VERB_LABELS: Readonly<Record<string, string>> = Object.freeze({
  create: 'Creating…',
  read: 'Reading…',
  list: 'Loading…',
  search: 'Searching…',
  update: 'Updating…',
  delete: 'Removing…',
  run: 'Running…',
  write: 'Writing…',
  send: 'Sending…',
  open: 'Opening…',
  close: 'Closing…',
  click: 'Clicking…',
  check: 'Checking…',
  save: 'Saving…',
});

/** First-token synonyms → canonical verb. Keep lowercase. */
const VERB_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
  create: 'create', add: 'create', make: 'create',
  read: 'read', get: 'read', view: 'read', observe: 'read', inspect: 'read',
  fetch: 'read', screenshot: 'read', snapshot: 'read',
  list: 'list',
  search: 'search', find: 'search', query: 'search',
  update: 'update', set: 'update', edit: 'update', rename: 'update',
  toggle: 'update', assign: 'update', manage: 'update',
  delete: 'delete', remove: 'delete', trash: 'delete', forget: 'delete',
  clear: 'delete', revoke: 'delete',
  run: 'run', execute: 'run', exec: 'run', compile: 'run', apply: 'run',
  write: 'write', append: 'write', upload: 'write', fill: 'write',
  send: 'send', notify: 'send',
  open: 'open', launch: 'open', focus: 'open',
  close: 'close', quit: 'close',
  click: 'click', press: 'click', tap: 'click',
  check: 'check', verify: 'check', test: 'check', actionability: 'check',
  save: 'save',
});

/** Family fallback when the action segment yields no recognizable verb. */
const FAMILY_FALLBACK_VERBS: Readonly<Record<string, string>> = Object.freeze({
  verification: 'check',
});

/** Characters allowed in args-derived command fragments ("npm", "-rf",
 *  "scripts/x.ts", "pnpm@8"). Everything else is stripped. */
const SAFE_FRAGMENT_CHARS = /[^A-Za-z0-9@._/:+=-]/g;
const MAX_FRAGMENT_CHARS = 24;
const MAX_TOOL_NAME_PARSE_CHARS = 200;

/** Control characters (C0, DEL, C1) — built via fromCharCode so the source
 *  file itself stays plain ASCII. Deterministic module-init construction. */
const CONTROL_CHARS = new RegExp(
  '[' + String.fromCharCode(0) + '-' + String.fromCharCode(31)
      + String.fromCharCode(127) + '-' + String.fromCharCode(159) + ']',
  'g',
);

/** Own-property string lookup — immune to prototype keys ('constructor',
 *  '__proto__', …) leaking non-label values out of Record lookups. */
function ownString(map: Readonly<Record<string, string>>, key: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(map, key)) return undefined;
  const v = map[key];
  return typeof v === 'string' && v ? v : undefined;
}

/** Strip control chars, collapse whitespace, cap length, never empty. */
function finalizeLabel(raw: unknown): string {
  try {
    if (typeof raw !== 'string') return FALLBACK_ACTIVITY_LABEL;
    const cleaned = raw.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
    if (!cleaned) return FALLBACK_ACTIVITY_LABEL;
    if (cleaned.length <= MAX_ACTIVITY_LABEL_CHARS) return cleaned;
    return `${cleaned.slice(0, MAX_ACTIVITY_LABEL_CHARS - 1)}…`;
  } catch {
    return FALLBACK_ACTIVITY_LABEL;
  }
}

/** Canonical lowercase tool name, or '' when the input is not usable. */
function normalizeToolName(toolName: unknown): string {
  if (typeof toolName !== 'string') return '';
  try {
    return toolName.slice(0, MAX_TOOL_NAME_PARSE_CHARS).trim().toLowerCase();
  } catch {
    return '';
  }
}

/** Sanitize one args-derived token into a UI-safe command fragment. */
function sanitizeFragment(token: unknown): string {
  if (typeof token !== 'string') return '';
  try {
    return token
      .slice(0, MAX_FRAGMENT_CHARS * 4)
      .replace(CONTROL_CHARS, '')
      .replace(SAFE_FRAGMENT_CHARS, '')
      .slice(0, MAX_FRAGMENT_CHARS);
  } catch {
    return '';
  }
}

/** "/opt/homebrew/bin/npm" → "npm" (first command token only). */
function basenameFragment(fragment: string): string {
  const idx = fragment.lastIndexOf('/');
  if (idx < 0 || idx === fragment.length - 1) return fragment;
  const base = fragment.slice(idx + 1);
  return base || fragment;
}

/** Extract up to two safe command words from local.run_shell-style args. */
function extractCommandWords(args: unknown): string[] {
  try {
    if (!args || typeof args !== 'object') return [];
    const rec = args as Record<string, unknown>;
    let rawTokens: unknown[] = [];
    const argv = rec.argv;
    if (Array.isArray(argv)) {
      rawTokens = argv;
    } else if (typeof rec.command === 'string') {
      rawTokens = rec.command.slice(0, 400).split(/\s+/);
    }
    const words: string[] = [];
    for (let i = 0; i < rawTokens.length && words.length < 2; i++) {
      let frag = sanitizeFragment(rawTokens[i]);
      if (!frag) continue;
      if (words.length === 0) frag = basenameFragment(frag);
      if (frag) words.push(frag);
    }
    return words;
  } catch {
    return [];
  }
}

/** local.run_shell → "Running npm test…" (or the base map label). */
function runShellLabel(args: unknown): string {
  const words = extractCommandWords(args);
  if (words.length === 0) return TOOL_ACTIVITY_LABELS['local.run_shell'];
  return finalizeLabel(`Running ${words.join(' ')}…`);
}

/** git.run → "git commit…" (or the base map label). */
function gitRunLabel(args: unknown): string {
  try {
    if (!args || typeof args !== 'object') return TOOL_ACTIVITY_LABELS['git.run'];
    const rawVerb = (args as Record<string, unknown>).verb;
    if (typeof rawVerb !== 'string') return TOOL_ACTIVITY_LABELS['git.run'];
    const verb = rawVerb
      .slice(0, MAX_FRAGMENT_CHARS * 4)
      .replace(CONTROL_CHARS, '')
      .replace(/[^a-z0-9_-]/gi, '')
      .toLowerCase()
      .slice(0, MAX_FRAGMENT_CHARS);
    if (!verb) return TOOL_ACTIVITY_LABELS['git.run'];
    return finalizeLabel(`git ${verb}…`);
  } catch {
    return TOOL_ACTIVITY_LABELS['git.run'];
  }
}

/** Split "family.action_more" → { family, action }. Dot-less names are all action. */
function splitToolName(name: string): { family: string; action: string } {
  const dot = name.indexOf('.');
  if (dot < 0) return { family: '', action: name };
  return { family: name.slice(0, dot), action: name.slice(dot + 1) };
}

/**
 * The bare canonical verb for a tool name — 'create', 'read', 'run',
 * 'search', 'list', 'update', 'delete', 'write', 'send', 'open', 'close',
 * 'click', 'check', 'save' — or 'work' when nothing recognizable is found.
 * Total: never throws; any junk input → 'work'.
 */
export function toolFamilyVerb(toolName: unknown): string {
  try {
    const name = normalizeToolName(toolName);
    if (!name) return 'work';
    const { family, action } = splitToolName(name);
    // Scan the first few underscore tokens for a recognizable verb —
    // "file_trash" → trash → delete, "run_shell" → run, "tests" → test →
    // check (plural strip). Bounded at 6 tokens.
    const tokens = action.split('_', 6);
    for (const token of tokens) {
      let canon = ownString(VERB_SYNONYMS, token);
      if (!canon && token.endsWith('s')) {
        canon = ownString(VERB_SYNONYMS, token.slice(0, -1));
      }
      if (canon) return canon;
    }
    const familyFallback = ownString(FAMILY_FALLBACK_VERBS, family);
    if (familyFallback) return familyFallback;
    return 'work';
  } catch {
    return 'work';
  }
}

/**
 * Friendly present-tense activity label for a tool call. Resolution order:
 *  1. local.run_shell / git.run → refined from args ("Running npm test…",
 *     "git commit…"), falling back to their base labels.
 *  2. Exact TOOL_ACTIVITY_LABELS hit (case/whitespace-insensitive).
 *  3. Family/verb derivation ("x.create" → "Creating…", "*.list" → "Loading…").
 *  4. FALLBACK_ACTIVITY_LABEL ("Working…").
 * Total + bounded: never throws, always returns a non-empty user-safe string
 * of at most MAX_ACTIVITY_LABEL_CHARS characters with no control characters.
 */
export function toolActivityLabel(toolName: unknown, args?: unknown): string {
  try {
    const name = normalizeToolName(toolName);
    if (!name) return FALLBACK_ACTIVITY_LABEL;
    if (name === 'local.run_shell') return runShellLabel(args);
    if (name === 'git.run') return gitRunLabel(args);
    const mapped = ownString(TOOL_ACTIVITY_LABELS, name);
    if (mapped) return finalizeLabel(mapped);
    const verb = toolFamilyVerb(name);
    const derived = ownString(VERB_LABELS, verb);
    if (derived) return finalizeLabel(derived);
    return FALLBACK_ACTIVITY_LABEL;
  } catch {
    return FALLBACK_ACTIVITY_LABEL;
  }
}
