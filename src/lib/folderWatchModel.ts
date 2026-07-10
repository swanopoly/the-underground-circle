/**
 * folderWatchModel — pure owner for LOCAL FOLDER WATCHES ("watch my
 * Downloads folder for new files, tell me in chat").
 *
 * Folder watches ride the existing `computer_use_schedules` row with NO
 * schema migration: the target folder (and optional filename pattern) is
 * encoded into the row's `task` text as `local-folder: <path>` /
 * `local-folder: <path> | <pattern>`, the folder snapshot persists in the
 * row's `last_findings` JSON, and the diff summary in `last_diff_summary`.
 *
 * Execution is honestly CLIENT-ONLY: the desktop bridge lives on the
 * user's machine (localhost:7778), so folder watches run while the app is
 * open via the client runner (`computerTaskScheduleRunner.ts` →
 * `desktopBridge.listFiles`), and the server-side `watch-scheduler` edge
 * function skips these rows entirely — it has no path to the user's disk.
 *
 * Pure module (memory rule: smoke-testable under tsx): the only import is
 * the equally pure `computerTaskScheduleModel` for cadence phrasing.
 * Smoke: `npx tsx scripts/folder-watch-smoketest.ts`.
 */

import {
  describeWatchCadence,
  type ComputerTaskScheduleCadence,
} from './computerTaskScheduleModel';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Task-text discriminator for folder watches. A `computer_use_schedules`
 * row whose task starts with this prefix is a LOCAL folder watch.
 *
 * LOCKSTEP: `supabase/functions/watch-scheduler/index.ts` skips due rows
 * whose task starts with this prefix (query filter + in-loop guard) —
 * local watches need the user's desktop bridge, which only the client
 * runner can reach. Change the prefix in both places or server/client
 * ownership of these rows breaks.
 */
export const FOLDER_WATCH_TASK_PREFIX = 'local-folder:';

/** Encoded folder paths are rejected past this many characters. */
export const FOLDER_WATCH_PATH_MAX_CHARS = 300;

/** Filename patterns are rejected past this many characters. */
export const FOLDER_WATCH_PATTERN_MAX_CHARS = 60;

/** Snapshot rows persisted into `last_findings` are bounded to this many. */
export const FOLDER_SNAPSHOT_MAX_FILES = 100;

/** Snapshot file names are clamped to this many characters. */
export const FOLDER_SNAPSHOT_NAME_MAX_CHARS = 200;

/** Folder diff summaries are clamped to this many characters. */
export const FOLDER_DIFF_SUMMARY_MAX_CHARS = 400;

/** Simple glob-ish pattern charset: `*.pdf`, `invoice 2026`, `report-*`. */
const PATTERN_CHARSET_RE = /^[A-Za-z0-9*._ -]+$/;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Decoded folder-watch target from an encoded task. */
export interface FolderWatchTarget {
  path: string;
  pattern: string | null;
}

/** Conservative free-text detection result. */
export interface FolderWatchRequest {
  path: string;
  pattern: string | null;
  /** Cadence phrase found inside the text ("every hour"), if any. */
  cadencePhraseHint: ComputerTaskScheduleCadence | null;
}

/** One snapshot row, shaped to live in `computer_use_schedules.last_findings`. */
export interface FolderSnapshotFinding {
  kind: 'file';
  name: string;
  sizeBytes: number | null;
  modifiedAt: string | null;
}

export interface FolderSnapshotDiff {
  added: string[];
  removed: string[];
  /** Same name, but size or modified time moved. */
  changed: string[];
  /** Chat-ready one-liner, ≤ FOLDER_DIFF_SUMMARY_MAX_CHARS. */
  summary: string;
  hasChanges: boolean;
}

// ─── Path / pattern normalization ───────────────────────────────────────────

/**
 * Normalize a folder path for encoding: trims, strips wrapping quotes,
 * collapses whitespace runs, drops trailing slashes. Returns null for
 * anything unsafe or un-encodable: relative paths, `..` traversal, the
 * bare filesystem root, the `|` encoding separator, control characters,
 * or paths past `FOLDER_WATCH_PATH_MAX_CHARS`. `~` (home) is allowed.
 */
export function normalizeFolderWatchPath(raw: string): string | null {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
  if (!text) return null;
  if (text.length > FOLDER_WATCH_PATH_MAX_CHARS) return null;
  // The pipe is the task-encoding separator; control chars never belong in
  // a folder path.
  if (text.includes('|')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(text)) return null;
  // Home-relative or absolute only — never a relative path we'd have to guess.
  if (!(text === '~' || text.startsWith('~/') || text.startsWith('/'))) return null;
  // No `..` traversal anywhere in the path.
  if (/(^|\/)\.\.(\/|$)/.test(text)) return null;
  // Trim trailing slashes; the bare root is never a sane watch target.
  text = text.replace(/\/+$/, '');
  if (!text || text === '/') return null;
  return text;
}

/**
 * Normalize a filename pattern: trims, collapses whitespace, enforces the
 * simple glob-ish charset and length bound. Returns null when empty or
 * invalid — callers that were GIVEN a pattern must treat null as a
 * rejection (never silently widen a filtered watch to the whole folder).
 */
export function normalizeFolderWatchPattern(raw: string | null | undefined): string | null {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (text.length > FOLDER_WATCH_PATTERN_MAX_CHARS) return null;
  if (!PATTERN_CHARSET_RE.test(text)) return null;
  return text;
}

// ─── Task encoding ──────────────────────────────────────────────────────────

/**
 * Encode a folder watch into the `computer_use_schedules.task` text:
 * `local-folder: <path>` or `local-folder: <path> | <pattern>`. Returns
 * null when the path is invalid, or when a pattern was provided but fails
 * validation (failing beats silently dropping the user's filter).
 */
export function encodeFolderWatchTask(input: { path: string; pattern?: string | null }): string | null {
  const path = normalizeFolderWatchPath(input.path);
  if (!path) return null;
  const rawPattern = String(input.pattern ?? '').trim();
  if (!rawPattern) return `${FOLDER_WATCH_TASK_PREFIX} ${path}`;
  const pattern = normalizeFolderWatchPattern(rawPattern);
  if (!pattern) return null;
  return `${FOLDER_WATCH_TASK_PREFIX} ${path} | ${pattern}`;
}

/** Cheap discriminator: is this stored task a folder watch (by prefix)? */
export function isFolderWatchTask(task: string): boolean {
  return String(task || '').trim().toLowerCase().startsWith(FOLDER_WATCH_TASK_PREFIX);
}

/**
 * Decode an encoded folder-watch task back into `{ path, pattern }`.
 * Returns null for non-folder tasks (the discriminator every other
 * surface branches on) AND for prefix-matched tasks whose path/pattern
 * fail validation — a corrupt encoded row must never decode into a
 * runnable target.
 */
export function decodeFolderWatchTask(task: string): FolderWatchTarget | null {
  const text = String(task || '').trim();
  if (!text.toLowerCase().startsWith(FOLDER_WATCH_TASK_PREFIX)) return null;
  const rest = text.slice(FOLDER_WATCH_TASK_PREFIX.length).trim();
  const pipeAt = rest.indexOf('|');
  const rawPath = (pipeAt >= 0 ? rest.slice(0, pipeAt) : rest).trim();
  const rawPattern = pipeAt >= 0 ? rest.slice(pipeAt + 1).trim() : '';
  const path = normalizeFolderWatchPath(rawPath);
  if (!path) return null;
  if (!rawPattern) return { path, pattern: null };
  const pattern = normalizeFolderWatchPattern(rawPattern);
  if (!pattern) return null;
  return { path, pattern };
}

// ─── Free-text detection ────────────────────────────────────────────────────

/** Well-known folder shorthands → home-relative paths. */
const WELL_KNOWN_FOLDER_PATHS: Record<string, string> = {
  download: '~/Downloads',
  downloads: '~/Downloads',
  desktop: '~/Desktop',
  document: '~/Documents',
  documents: '~/Documents',
  picture: '~/Pictures',
  pictures: '~/Pictures',
  photo: '~/Pictures',
  photos: '~/Pictures',
  movie: '~/Movies',
  movies: '~/Movies',
  video: '~/Movies',
  videos: '~/Movies',
  music: '~/Music',
};

const WELL_KNOWN_NAMES_SRC = 'downloads?|desktop|documents?|pictures?|photos?|movies?|videos?|music';

/**
 * "for new pdfs" → `*.pdf`. Only unambiguous extension words map; generic
 * words ("files", "invoices", "docs") deliberately do not.
 */
const PATTERN_EXTENSION_WORDS: Record<string, string> = {
  pdf: 'pdf', pdfs: 'pdf',
  png: 'png', pngs: 'png',
  jpg: 'jpg', jpgs: 'jpg',
  jpeg: 'jpeg', jpegs: 'jpeg',
  gif: 'gif', gifs: 'gif',
  heic: 'heic', heics: 'heic',
  webp: 'webp', webps: 'webp',
  svg: 'svg', svgs: 'svg',
  zip: 'zip', zips: 'zip',
  dmg: 'dmg', dmgs: 'dmg',
  pkg: 'pkg', pkgs: 'pkg',
  csv: 'csv', csvs: 'csv',
  json: 'json',
  txt: 'txt', txts: 'txt',
  md: 'md',
  doc: 'doc', docx: 'docx',
  xls: 'xls', xlsx: 'xlsx',
  ppt: 'ppt', pptx: 'pptx',
  mp3: 'mp3', mp3s: 'mp3',
  mp4: 'mp4', mp4s: 'mp4',
  mov: 'mov', movs: 'mov',
  wav: 'wav', wavs: 'wav',
};

/** A domain-looking token anywhere means "page watch", never "folder watch". */
const URL_TLDS = new Set([
  'com', 'net', 'org', 'io', 'co', 'ai', 'app', 'dev', 'edu', 'gov', 'mil',
  'info', 'biz', 'me', 'tv', 'us', 'uk', 'ca', 'au', 'de', 'fr', 'jp', 'in',
  'br', 'xyz', 'site', 'online', 'store', 'shop', 'cloud', 'gg', 'so', 'to',
  'ly', 'sh', 'fm', 'fyi', 'news', 'blog', 'wiki', 'live', 'today',
]);

function containsUrlLikeToken(text: string): boolean {
  for (const raw of String(text || '').split(/\s+/)) {
    const token = raw.replace(/^[('"<[]+/, '').replace(/[)'">\],.;:!?]+$/, '');
    if (!token) continue;
    if (/^https?:\/\//i.test(token) || /^www\./i.test(token)) return true;
    // Local paths and glob patterns are never domains.
    if (/^[~/*.]/.test(token)) continue;
    const host = token.split('/')[0].split(':')[0];
    if (!/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+$/i.test(host)) continue;
    const tld = host.split('.').pop();
    if (tld && URL_TLDS.has(tld.toLowerCase())) return true;
  }
  return false;
}

/** Quoted `"~/My Files"` first, then an unquoted `~`/`~/…`/`/Users/…` token. */
function extractExplicitPathToken(text: string): string | null {
  const quoted = text.match(/["'`]((?:~|\/)[^"'`]*)["'`]/);
  if (quoted && quoted[1]) return quoted[1];
  const unquoted = text.match(/(?:^|[\s(])(~(?:\/\S+)?|\/Users\/\S+)/);
  if (unquoted && unquoted[1]) return unquoted[1].replace(/[.,;:!?)'"]+$/, '');
  return null;
}

function resolveWellKnownFolder(text: string): string | null {
  // "downloads folder" / "desktop directory" — the word folder makes it safe.
  const folderForm = text.match(new RegExp(`\\b(${WELL_KNOWN_NAMES_SRC})\\s+(?:folder|directory|dir)\\b`, 'i'));
  if (folderForm && folderForm[1]) {
    return WELL_KNOWN_FOLDER_PATHS[folderForm[1].toLowerCase()] ?? null;
  }
  // "my downloads" / "the desktop" — only when the name ends the clause or
  // leads into a filter/cadence phrase, so "the downloads page" and "the
  // desktop app" never match.
  const possessiveForm = text.match(new RegExp(
    `\\b(?:my|the)\\s+(${WELL_KNOWN_NAMES_SRC})\\b(?=\\s+(?:folder|directory|dir|for|and|every|each|hourly|daily|weekly)\\b|\\s*(?:[,.;:!?]|$))`,
    'i',
  ));
  if (possessiveForm && possessiveForm[1]) {
    return WELL_KNOWN_FOLDER_PATHS[possessiveForm[1].toLowerCase()] ?? null;
  }
  return null;
}

function extractPatternFromText(text: string): string | null {
  const glob = text.match(/(?:^|\s)\*\.([A-Za-z0-9]{1,10})\b/);
  if (glob && glob[1]) return `*.${glob[1].toLowerCase()}`;
  const wordMatch = text.match(/\bfor\s+(?:(?:new|any|incoming|fresh|added)\s+)?([A-Za-z0-9]+)(?:\s+files?)?\b/i);
  if (wordMatch && wordMatch[1]) {
    const ext = PATTERN_EXTENSION_WORDS[wordMatch[1].toLowerCase()];
    if (ext) return `*.${ext}`;
  }
  return null;
}

function extractCadenceHint(text: string): ComputerTaskScheduleCadence | null {
  const t = text.toLowerCase();
  if (/\b(?:every\s+hour|each\s+hour|hourly)\b/.test(t)) return 'hourly';
  if (/\b(?:every\s+day|each\s+day|daily|once\s+a\s+day)\b/.test(t)) return 'daily';
  if (/\b(?:every\s+week|each\s+week|weekly|once\s+a\s+week)\b/.test(t)) return 'weekly';
  return null;
}

/**
 * Conservative detection of a LOCAL folder-watch request in free text:
 * requires the watch verb plus a resolvable folder — an explicit `~`/
 * `/Users` path, or a well-known folder name used folder-ishly ("my
 * downloads", "desktop folder"). Any http(s) URL or domain-looking token
 * means a browser PAGE watch and returns null, as does an explicit path
 * that fails validation (e.g. `..` traversal) — fail closed, never guess.
 *
 * Note for command handlers: `/watch <task>` already carries the watch
 * verb in the command itself — call this with `watch ${task}`.
 */
export function detectFolderWatchRequest(text: string): FolderWatchRequest | null {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (!/\bwatch(?:ing|es|ed)?\b/i.test(normalized)) return null;
  if (containsUrlLikeToken(normalized)) return null;

  const explicitToken = extractExplicitPathToken(normalized);
  let path: string | null;
  if (explicitToken !== null) {
    path = normalizeFolderWatchPath(explicitToken);
    if (!path) return null;
  } else {
    path = resolveWellKnownFolder(normalized);
  }
  if (!path) return null;

  return {
    path,
    pattern: extractPatternFromText(normalized),
    cadencePhraseHint: extractCadenceHint(normalized),
  };
}

// ─── Pattern matching (runner-side filter) ──────────────────────────────────

/**
 * Case-insensitive filename filter: `*.ext` matches by extension, anything
 * else is a substring match (stray `*`s stripped). No/empty pattern
 * matches everything.
 */
export function matchesFolderWatchPattern(name: string, pattern: string | null | undefined): boolean {
  const file = String(name || '').toLowerCase();
  const pat = String(pattern ?? '').trim().toLowerCase();
  if (!pat) return true;
  if (pat.startsWith('*.') && pat.length > 2 && !pat.slice(2).includes('*')) {
    return file.endsWith(pat.slice(1));
  }
  const needle = pat.replace(/\*/g, '');
  if (!needle) return true;
  return file.includes(needle);
}

// ─── Snapshot + diff ────────────────────────────────────────────────────────

/**
 * Shape bridge `listFiles` entries into bounded findings rows for
 * `computer_use_schedules.last_findings`: ≤ FOLDER_SNAPSHOT_MAX_FILES rows
 * of `{ kind: 'file', name, sizeBytes, modifiedAt }`, name-clamped and
 * sorted by name so snapshots diff deterministically.
 */
export function buildFolderSnapshotFindings(
  entries: Array<{ name: string; sizeBytes?: number | null; modifiedAt?: string | null }>,
): FolderSnapshotFinding[] {
  const rows: FolderSnapshotFinding[] = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = String(entry?.name ?? '').trim();
    if (!name) continue;
    const sizeBytes = typeof entry?.sizeBytes === 'number' && Number.isFinite(entry.sizeBytes)
      ? entry.sizeBytes
      : null;
    const modifiedAt = typeof entry?.modifiedAt === 'string' && entry.modifiedAt ? entry.modifiedAt : null;
    rows.push({
      kind: 'file',
      name: name.length > FOLDER_SNAPSHOT_NAME_MAX_CHARS
        ? `${name.slice(0, FOLDER_SNAPSHOT_NAME_MAX_CHARS - 1)}…`
        : name,
      sizeBytes,
      modifiedAt,
    });
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return rows.slice(0, FOLDER_SNAPSHOT_MAX_FILES);
}

/** Best-effort coercion of persisted `last_findings` back into snapshot rows. */
function coerceFolderSnapshot(value: unknown[] | null | undefined): {
  rows: FolderSnapshotFinding[];
  unreadable: boolean;
} {
  if (value == null) return { rows: [], unreadable: false };
  if (!Array.isArray(value)) return { rows: [], unreadable: true };
  const rows: FolderSnapshotFinding[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { kind?: unknown; name?: unknown; sizeBytes?: unknown; modifiedAt?: unknown };
    if (candidate.kind !== 'file' || typeof candidate.name !== 'string' || !candidate.name) continue;
    rows.push({
      kind: 'file',
      name: candidate.name,
      sizeBytes: typeof candidate.sizeBytes === 'number' && Number.isFinite(candidate.sizeBytes)
        ? candidate.sizeBytes
        : null,
      modifiedAt: typeof candidate.modifiedAt === 'string' && candidate.modifiedAt ? candidate.modifiedAt : null,
    });
  }
  // Old browser-watch findings ({title,…}) or other garbage coerce to zero
  // rows — flag it so the summary can say the baseline was reset.
  return { rows, unreadable: value.length > 0 && rows.length === 0 };
}

function clampSummaryName(name: string): string {
  return name.length > 48 ? `${name.slice(0, 47)}…` : name;
}

function summarizeNameGroup(label: string, names: string[], shown: number): string {
  const head = names.slice(0, shown).map(clampSummaryName).join(', ');
  const more = names.length > shown ? ` +${names.length - shown} more` : '';
  return `${names.length} ${label}: ${head}${more}`;
}

/**
 * Diff two folder snapshots by file name; `changed` = same name with a
 * moved size or modified time. `prev` is the raw persisted
 * `last_findings` value and may be garbage (non-array, old browser
 * findings rows) — that coerces to an empty baseline with a note in the
 * summary. Summary stays ≤ FOLDER_DIFF_SUMMARY_MAX_CHARS.
 */
export function diffFolderSnapshots(
  prev: unknown[] | null | undefined,
  next: FolderSnapshotFinding[] | null | undefined,
): FolderSnapshotDiff {
  const nextRows = (Array.isArray(next) ? next : []).filter(
    (row) => row && typeof row.name === 'string' && row.name.length > 0,
  );
  const { rows: prevRows, unreadable } = coerceFolderSnapshot(prev);

  const prevByName = new Map(prevRows.map((row) => [row.name, row] as const));
  const nextByName = new Map(nextRows.map((row) => [row.name, row] as const));

  const added = nextRows.filter((row) => !prevByName.has(row.name)).map((row) => row.name);
  const removed = prevRows.filter((row) => !nextByName.has(row.name)).map((row) => row.name);
  const changed: string[] = [];
  for (const [name, curr] of nextByName) {
    const before = prevByName.get(name);
    if (!before) continue;
    const sizeMoved = before.sizeBytes != null && curr.sizeBytes != null && before.sizeBytes !== curr.sizeBytes;
    const mtimeMoved = !!before.modifiedAt && !!curr.modifiedAt && before.modifiedAt !== curr.modifiedAt;
    if (sizeMoved || mtimeMoved) changed.push(name);
  }

  const hasChanges = added.length > 0 || removed.length > 0 || changed.length > 0;
  const parts: string[] = [];
  if (!hasChanges) {
    parts.push(`No changes — ${nextRows.length} file${nextRows.length === 1 ? '' : 's'} tracked.`);
  } else {
    if (added.length > 0) parts.push(summarizeNameGroup('new', added, 3));
    if (removed.length > 0) parts.push(summarizeNameGroup('removed', removed, 2));
    if (changed.length > 0) parts.push(summarizeNameGroup('changed', changed, 2));
  }
  if (unreadable) {
    parts.push('previous snapshot was unreadable — treating current files as the new baseline');
  }
  let summary = parts.join(' · ');
  if (summary.length > FOLDER_DIFF_SUMMARY_MAX_CHARS) {
    summary = `${summary.slice(0, FOLDER_DIFF_SUMMARY_MAX_CHARS - 1).trimEnd()}…`;
  }

  return { added, removed, changed, summary, hasChanges };
}

// ─── Chat-facing copy ───────────────────────────────────────────────────────

/** `📁 ~/Downloads (*.pdf)` — the readable stand-in for the encoded task. */
export function formatFolderWatchLabel(target: { path: string; pattern?: string | null }): string {
  const pattern = String(target?.pattern ?? '').trim();
  return `📁 ${target.path}${pattern ? ` (${pattern})` : ''}`;
}

/**
 * One plain confirmation line for chat, including the honest constraint
 * that folder watches only run while the app is open (the desktop bridge
 * is local — there is no server-side path to the user's disk).
 */
export function describeFolderWatchForChat(input: {
  path: string;
  pattern?: string | null;
  cadence: ComputerTaskScheduleCadence;
}): string {
  const pattern = String(input.pattern ?? '').trim();
  const target = `${input.path}${pattern ? ` (${pattern})` : ''}`;
  return `📁 Watching ${target} — ${describeWatchCadence(input.cadence)}, runs while the app is open (local desktop bridge).`;
}
