// responseArtifactExtractCore — the PURE scanner that mines a FINISHED agent
// answer for the typed, REUSABLE artifacts a UI can save / copy / apply: a full
// code block (with an inferred save filename), a diff/patch, a command runbook,
// and an openable link set. It reads text and returns typed objects; it does NOT
// render, fetch, mutate, or call a model.
//
// Why this exists: the app's structured-artifact pipeline (ChatArtifacts render +
// workspace.apply_artifacts "Apply to room" + csv→table upgrade + Download) is fed
// only by (1) the edge's tool-action mapper and (2) edge-emitted `data.artifacts`.
// Neither scans the assistant's TEXT — yet the app routes heavily to open /
// marketplace / BlackSwan models that emit plain markdown with fenced code,
// patches, and shell blocks and NO structured-artifact JSON. Today those outputs
// render but offer no save/copy/apply affordance. This core recovers them so the
// "proof / artifacts become visible" loop works for the majority of routed models.
// The caller (swanbot.ts) maps each ExtractedArtifact → SwanBotStructuredArtifact
// (code/diff/commands → kind 'code' with metadata.language + metadata.fileName so
// the EXISTING chatWorkspace.inferCodeFileName names the save target; links → a
// summary/webpage surface) and runs the existing csv→table upgrade unchanged.
//
// NON-DUPLICATION: markdownSegmentCore segments for RENDER (coalesced, content
// capped, info-string reduced to a token, no filename/classification). This is the
// EXTRACT complement — full body, full info string kept for a path hint, preceding
// heading kept for naming, diff/command/link classification, worth-surfacing
// thresholds. It emits csv-ish blocks as kind 'code' and lets the caller's
// tableArtifact upgrade run (zero table logic here). Attribution (chatSources /
// citationExtract) answers "where facts came from"; this answers "what reusable
// OUTPUTS did the answer produce" (links needs ≥3 urls — a batch, not a source).
// It REUSES parseUnifiedDiff (diffHunkSelectCore) to validate/summarize a diff and
// extractCitations (citationExtractCore) to mine urls — both zero-import pure
// siblings, so this module stays tsx-loadable. Plans are delegated to
// planModeCore and are deliberately NOT emitted.
//
// PURITY / SAFETY CONTRACT (load-bearing — the smoke runs under tsx/esbuild):
//  - Runtime imports ONLY from zero-dep pure sibling cores.
//  - Every export is TOTAL: never throws on null / undefined / wrong-type / huge /
//    bigint / cyclic / proxy / hostile input — returns a safe neutral value.
//  - DETERMINISTIC: no Date.now / Math.random / argless `new Date`; frozen const
//    sets; code-POINT-aware text (never splits a surrogate pair).
//  - BOUNDED: exported RESPONSE_ARTIFACT_* caps clamp every string / array and the
//    whole input is scanned only up to a fixed window so megabyte pastes stay cheap.
//  - SECRET-SAFE: titles / filenames / urls are stripped of control / line-sep /
//    format (zero-width, bidi) / Unicode-Tag / prompt-fence chars; url userinfo and
//    sensitive query values are redacted; a filename hint is reduced to a safe
//    basename (no `../` traversal). A code BODY is kept verbatim except control /
//    NUL / smuggling / trojan-source format chars.
//
// Smoke: scripts/response-artifact-extract-core-smoketest.ts

import { parseUnifiedDiff, type ParsedFileDiff } from './diffHunkSelectCore';
import { extractCitations } from './citationExtractCore';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ExtractedArtifactKind = 'code' | 'diff' | 'commands' | 'links';

/** Parsed stats for a diff artifact (cross-checks parseUnifiedDiff). */
export interface ExtractedDiffStats {
  fileCount: number;
  additions: number;
  deletions: number;
  /** Secret-safe display paths (basename for absolute/home paths). */
  paths: string[];
}

export interface ExtractedArtifact {
  /** Stable, deterministic id in first-appearance order: `artifact-0`, `artifact-1`, … */
  id: string;
  kind: ExtractedArtifactKind;
  /** Secret-safe, single-line, control/format-char-free display title. */
  title: string;
  /**
   * The reusable body. code: verbatim (clamped) block text. diff: verbatim diff.
   * commands: the cleaned commands joined by newlines. links: the urls joined by
   * newlines.
   */
  content: string;
  /** Fenced-code info-string language token (sanitized, lowercased). code/diff/commands. */
  language?: string;
  /** Safe basename to save to (no traversal); undefined lets the caller infer from title+language. */
  suggestedFilename?: string;
  /** diff only. */
  diff?: ExtractedDiffStats;
  /** commands only: ordered, cleaned shell commands. */
  commands?: string[];
  /** links only: the deduped, secret-safe url set (≥ RESPONSE_ARTIFACT_MIN_LINKS). */
  urls?: string[];
}

// ---------------------------------------------------------------------------
// Bounds (exported so callers/tests can reason about the caps)
// ---------------------------------------------------------------------------

/** Hard cap on the number of artifacts returned. */
export const RESPONSE_ARTIFACT_MAX = 24;
/** Hard cap on an artifact `content` length (code points). */
export const RESPONSE_ARTIFACT_CONTENT_MAX = 64_000;
/** Only the first N chars of the input are ever examined. */
export const RESPONSE_ARTIFACT_INPUT_SCAN_MAX = 200_000;
/** Cap on a title (code points). */
export const RESPONSE_ARTIFACT_TITLE_MAX = 120;
/** Cap on a suggested filename (chars, whitelisted charset). */
export const RESPONSE_ARTIFACT_FILENAME_MAX = 80;
/** Cap on a language token (chars). */
export const RESPONSE_ARTIFACT_LANG_MAX = 24;
/** Cap on the number of commands in a commands artifact. */
export const RESPONSE_ARTIFACT_MAX_COMMANDS = 100;
/** Cap on a single command's length (code points). */
export const RESPONSE_ARTIFACT_COMMAND_MAX = 800;
/** Cap on urls surfaced in a links artifact. */
export const RESPONSE_ARTIFACT_MAX_LINKS = 50;
/** Minimum distinct urls before a links artifact is worth surfacing (a batch). */
export const RESPONSE_ARTIFACT_MIN_LINKS = 3;
/** Cap on the number of paths listed on a diff artifact. */
export const RESPONSE_ARTIFACT_MAX_DIFF_PATHS = 50;

// Internal bounds (not exported — implementation detail).
const MAX_CANDIDATES = 200;
const MAX_BLOCK_SCAN_LINES = 5_000;
const MAX_URL_LEN = 300;
const MAX_URL_PRECLEAN = 2_000;
const ELLIPSIS = String.fromCharCode(0x2026); // '…' — built, never a raw literal

// ---------------------------------------------------------------------------
// Frozen classification sets (Sets are inherently pollution-safe: `.has('__proto__')`
// never touches the prototype chain, so no hasOwnProperty guard is needed).
// ---------------------------------------------------------------------------

const SHELL_LANGS: ReadonlySet<string> = new Set([
  'bash', 'sh', 'shell', 'zsh', 'console', 'shell-session', 'shellsession',
  'sh-session', 'terminal', 'cmd', 'bat', 'batch', 'powershell', 'ps', 'ps1',
  'pwsh', 'fish', 'ksh', 'dash',
]);

const DIFF_LANGS: ReadonlySet<string> = new Set(['diff', 'patch', 'udiff']);

// Query-param keys whose VALUE is redacted from a surfaced url.
const SENSITIVE_PARAM_KEYS: ReadonlySet<string> = new Set([
  'apikey', 'key', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken',
  'secret', 'clientsecret', 'password', 'passwd', 'pwd', 'signature', 'sig',
  'auth', 'authorization', 'bearer', 'credential', 'credentials', 'session',
  'sessionid', 'sid', 'code', 'assertion', 'privatekey', 'access_token',
]);

// ---------------------------------------------------------------------------
// Code-point-aware primitives (never split a surrogate pair; never throw)
// ---------------------------------------------------------------------------

/** True for a lone (unpaired) surrogate code unit. */
function isLoneSurrogate(cp: number): boolean {
  return cp >= 0xd800 && cp <= 0xdfff;
}

/** Unicode format chars we defang from labels/urls: zero-width + bidi controls + BOM. */
function isFormatChar(cp: number): boolean {
  return (
    cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x200e || cp === 0x200f ||
    cp === 0x2060 || cp === 0xfeff ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069)
  );
}

/** Control / DEL / C1 / line-separator / Unicode-Tag smuggling code points. */
function isControlChar(cp: number): boolean {
  return (
    cp < 0x20 || cp === 0x7f ||
    (cp >= 0x80 && cp <= 0x9f) ||
    cp === 0x2028 || cp === 0x2029 ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  );
}

/** Count code points in a string (bounded by the string length). */
function codePointLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i) as number;
    i += cp > 0xffff ? 2 : 1;
    n += 1;
  }
  return n;
}

/** Keep the first `maxCp` code points, appending an ellipsis when truncated. */
function clampCodePoints(s: string, maxCp: number): string {
  if (maxCp <= 0) return '';
  let out = '';
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i) as number;
    const wide = cp > 0xffff;
    if (n >= maxCp) return out + ELLIPSIS;
    out += wide ? String.fromCodePoint(cp) : s[i];
    n += 1;
    i += wide ? 2 : 1;
  }
  return out;
}

/**
 * Single-line, secret-safe display label: drop control / DEL / C1 / line-sep /
 * Unicode-Tag / format (zero-width, bidi) / lone-surrogate / backtick / angle
 * brackets, collapse whitespace, trim, cap to `maxCp` code points. Non-string → ''.
 */
function cleanLabel(input: unknown, maxCp: number): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const src = input.length > maxCp * 8 ? input.slice(0, maxCp * 8) : input;
  let out = '';
  for (let i = 0; i < src.length; ) {
    const cp = src.codePointAt(i) as number;
    const wide = cp > 0xffff;
    if (!isLoneSurrogate(cp) && !isControlChar(cp) && !isFormatChar(cp) &&
        cp !== 0x60 /* ` */ && cp !== 0x3c /* < */ && cp !== 0x3e /* > */) {
      out += wide ? String.fromCodePoint(cp) : src[i];
    }
    i += wide ? 2 : 1;
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (codePointLen(out) > maxCp) out = clampCodePoints(out, maxCp - 1) + ELLIPSIS;
  return out;
}

/**
 * A code/diff/command body kept essentially verbatim: preserve TAB + LF, drop
 * NUL / other C0 / DEL / C1 / line-sep / Unicode-Tag / format (trojan-source bidi
 * & zero-width) / lone surrogates, then clamp to RESPONSE_ARTIFACT_CONTENT_MAX
 * code points. Non-string → ''.
 */
function clampBody(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  let out = '';
  let n = 0;
  let truncated = false;
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i) as number;
    const wide = cp > 0xffff;
    const step = wide ? 2 : 1;
    if (isLoneSurrogate(cp)) { i += 1; continue; }
    const isKeptControl = cp === 0x09 || cp === 0x0a; // tab, newline
    if (!isKeptControl && (isControlChar(cp) || isFormatChar(cp))) { i += step; continue; }
    if (n >= RESPONSE_ARTIFACT_CONTENT_MAX) { truncated = true; break; }
    out += wide ? String.fromCodePoint(cp) : input[i];
    n += 1;
    i += step;
  }
  return truncated ? out + ELLIPSIS : out;
}

/** Clean a single command line (verbatim-ish, but keeps quotes/backticks that shells need). */
function cleanCommand(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i) as number;
    const wide = cp > 0xffff;
    if (!isLoneSurrogate(cp) && !isControlChar(cp) && !isFormatChar(cp)) {
      out += wide ? String.fromCodePoint(cp) : input[i];
    }
    i += wide ? 2 : 1;
  }
  out = out.replace(/\s+/g, ' ').trim();
  if (codePointLen(out) > RESPONSE_ARTIFACT_COMMAND_MAX) {
    out = clampCodePoints(out, RESPONSE_ARTIFACT_COMMAND_MAX - 1) + ELLIPSIS;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filename / path safety
// ---------------------------------------------------------------------------

/** Last path segment (handles `/` and `\`, trims trailing separators). */
function lastSegment(path: string): string {
  const norm = path.replace(/\\/g, '/').replace(/\/+$/g, '');
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? norm : norm.slice(idx + 1);
}

/**
 * Reduce any filename hint to a SAFE BASENAME: take the last path segment (so
 * `../../etc/passwd` → `passwd`, `/etc/shadow` → `shadow`), whitelist to
 * `[A-Za-z0-9._+-]` (dropping traversal dots-with-slashes, control, format, and
 * every other char), reject an all-dots / empty result, and cap the length.
 * Never throws; non-string / junk → ''.
 */
export function safeArtifactBasename(hint: unknown): string {
  if (typeof hint !== 'string' || hint.length === 0) return '';
  const seg = lastSegment(hint.length > 512 ? hint.slice(0, 512) : hint);
  let out = '';
  for (let i = 0; i < seg.length && out.length < RESPONSE_ARTIFACT_FILENAME_MAX; i += 1) {
    const c = seg.charCodeAt(i);
    const ok =
      (c >= 0x30 && c <= 0x39) || // 0-9
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x61 && c <= 0x7a) || // a-z
      c === 0x2e || c === 0x5f || c === 0x2d || c === 0x2b; // . _ - +
    if (ok) out += seg[i];
  }
  if (!out || /^\.+$/.test(out)) return '';
  return out;
}

// ---------------------------------------------------------------------------
// Fence + heading line classifiers (adapted from markdownSegmentCore)
// ---------------------------------------------------------------------------

const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/;
const FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
const HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/;

interface FenceOpen { char: string; len: number; info: string; }

function matchFenceOpen(line: string): FenceOpen | null {
  const m = FENCE_OPEN_RE.exec(line);
  if (!m) return null;
  const marker = m[1];
  return { char: marker[0], len: marker.length, info: m[2] || '' };
}

function isFenceClose(line: string, char: string, len: number): boolean {
  const m = FENCE_CLOSE_RE.exec(line);
  if (!m) return false;
  const marker = m[1];
  return marker[0] === char && marker.length >= len;
}

function matchHeadingText(line: string): string | null {
  const m = HEADING_RE.exec(line);
  if (!m) return null;
  const content = m[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
  return content.length > 0 ? content : null;
}

// ---------------------------------------------------------------------------
// Info-string parsing (language + filename hint)
// ---------------------------------------------------------------------------

function sanitizeLang(token: string): string {
  return token
    .replace(/[^A-Za-z0-9+#._-]/g, '')
    .slice(0, RESPONSE_ARTIFACT_LANG_MAX)
    .toLowerCase();
}

function looksLikeFilename(t: string): boolean {
  if (!t) return false;
  return /\.[A-Za-z0-9]{1,8}$/.test(t) || t.includes('/');
}

const INFO_ATTR_RE = /(?:title|filename|file|path)=["']?([^"'\s]+)["']?/i;

function parseInfoString(rawInfo: string): { language: string; fileHint: string } {
  const info = cleanLabel(rawInfo, 400);
  if (!info) return { language: '', fileHint: '' };
  const tokens = info.split(' ').filter(Boolean);
  const first = tokens[0] || '';
  let langPart = first;
  let colonPath = '';
  const ci = first.indexOf(':');
  if (ci > 0) { langPart = first.slice(0, ci); colonPath = first.slice(ci + 1); }
  const language = sanitizeLang(langPart);

  let fileHint = '';
  const attr = INFO_ATTR_RE.exec(info);
  if (attr) fileHint = attr[1];
  if (!fileHint && colonPath && looksLikeFilename(colonPath)) fileHint = colonPath;
  if (!fileHint) {
    for (let k = 1; k < tokens.length; k += 1) {
      if (looksLikeFilename(tokens[k])) { fileHint = tokens[k]; break; }
    }
  }
  return { language, fileHint };
}

// `// filepath: path`, `# filepath: path`, `<!-- filepath: path -->`, `/* filepath: path */`
const FILEPATH_COMMENT_RE =
  /^[ \t]*(?:\/\/+|#+|--|;+|<!--|\/\*|\*)[ \t]*filepath[ \t]*:[ \t]*(.+?)[ \t]*(?:\*\/|-->)?[ \t]*$/i;
// A first-line comment whose sole content is a path-with-extension.
const FIRST_LINE_PATH_RE =
  /^[ \t]*(?:\/\/+|#+)[ \t]*([A-Za-z0-9_.\-]+(?:\/[A-Za-z0-9_.\-]+)*\.[A-Za-z0-9]{1,8})[ \t]*$/;

/** Look at the first few body lines for a `// filepath:` / bare-path naming comment. */
function fileHintFromBody(body: string): string {
  const lines = body.split('\n');
  const scan = Math.min(lines.length, 3);
  let firstNonEmptySeen = false;
  for (let i = 0; i < scan; i += 1) {
    const line = lines[i];
    const fp = FILEPATH_COMMENT_RE.exec(line);
    if (fp && fp[1]) return fp[1];
    if (!firstNonEmptySeen && line.trim().length > 0) {
      firstNonEmptySeen = true;
      const bare = FIRST_LINE_PATH_RE.exec(line);
      if (bare && bare[1]) return bare[1];
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// URL sanitizing (secret-safe)
// ---------------------------------------------------------------------------

function redactQuery(query: string): string {
  return query
    .split('&')
    .map((kv) => {
      const eq = kv.indexOf('=');
      if (eq <= 0) return kv;
      const key = kv.slice(0, eq).toLowerCase().replace(/[_-]/g, '');
      return SENSITIVE_PARAM_KEYS.has(key) ? `${kv.slice(0, eq)}=REDACTED` : kv;
    })
    .join('&');
}

/** Strip control/format chars from a url and cap it. */
function cleanUrl(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i) as number;
    const wide = cp > 0xffff;
    if (!isLoneSurrogate(cp) && !isControlChar(cp) && !isFormatChar(cp) &&
        cp !== 0x60 && cp !== 0x3c && cp !== 0x3e && cp !== 0x20) {
      out += wide ? String.fromCodePoint(cp) : input[i];
    }
    i += wide ? 2 : 1;
  }
  if (codePointLen(out) > MAX_URL_LEN) out = clampCodePoints(out, MAX_URL_LEN - 1) + ELLIPSIS;
  return out;
}

/**
 * Secret-safe http(s) url: strip `user:pass@` userinfo, redact sensitive query +
 * fragment values, strip control/format chars, cap length. Non-http / junk → ''.
 */
function sanitizeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  if (!s) return '';
  if (s.length > MAX_URL_PRECLEAN) s = s.slice(0, MAX_URL_PRECLEAN);
  const m = /^(https?:\/\/)(.*)$/i.exec(s);
  if (!m) return '';
  const scheme = m[1].toLowerCase();
  const rest = m[2];

  const sepIdx = rest.search(/[/?#]/);
  const authority = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
  let tail = sepIdx === -1 ? '' : rest.slice(sepIdx);

  const at = authority.lastIndexOf('@');
  const host = at === -1 ? authority : authority.slice(at + 1);
  if (!host) return '';

  // Split the fragment off first — implicit-flow tokens ride in `#access_token=…`.
  let frag = '';
  const fIdx = tail.indexOf('#');
  if (fIdx !== -1) { frag = tail.slice(fIdx + 1); tail = tail.slice(0, fIdx); }
  const qIdx = tail.indexOf('?');
  if (qIdx !== -1) {
    const path = tail.slice(0, qIdx);
    tail = `${path}?${redactQuery(tail.slice(qIdx + 1))}`;
  }
  if (frag) tail = `${tail}#${redactQuery(frag)}`;

  return cleanUrl(`${scheme}${host.toLowerCase()}${tail}`);
}

// ---------------------------------------------------------------------------
// Command extraction
// ---------------------------------------------------------------------------

const PROMPT_RE = /^[ \t]*[$%][ \t]+(.*)$/;
const CONT_PROMPT_RE = /^[ \t]*>[ \t]?(.*)$/;
const COMMENT_RE = /^[ \t]*#/;
const TRAILING_BACKSLASH_RE = /\\[ \t]*$/;

function stripTrailingBackslash(s: string): string {
  return s.replace(TRAILING_BACKSLASH_RE, '').replace(/[ \t]+$/, '');
}

/**
 * Turn a shell block into an ordered command list. Transcript mode (any `$ `/`% `
 * prompt present): keep only prompt lines, folding `>`-prompt and `\`-continuation
 * lines into the preceding command; output lines are dropped. Script mode (no
 * prompts): every non-blank, non-`#`-comment line is a command, `\`-continuations
 * joined. Each command is cleaned + capped; the list is capped.
 */
function extractCommands(body: string): string[] {
  const lines = body.split('\n');
  const hasPrompt = lines.some((l) => PROMPT_RE.test(l));
  const out: string[] = [];

  if (hasPrompt) {
    let i = 0;
    while (i < lines.length && out.length < RESPONSE_ARTIFACT_MAX_COMMANDS) {
      const pm = PROMPT_RE.exec(lines[i]);
      if (!pm) { i += 1; continue; }
      let cmd = pm[1] ?? '';
      i += 1;
      // Fold continuations.
      let guard = 0;
      while (i < lines.length && guard < MAX_BLOCK_SCAN_LINES) {
        guard += 1;
        const cont = CONT_PROMPT_RE.exec(lines[i]);
        const endsBackslash = TRAILING_BACKSLASH_RE.test(cmd);
        if (cont) { cmd = `${stripTrailingBackslash(cmd)} ${cont[1]}`; i += 1; continue; }
        if (endsBackslash) { cmd = `${stripTrailingBackslash(cmd)} ${lines[i].trim()}`; i += 1; continue; }
        break;
      }
      const cleaned = cleanCommand(cmd);
      if (cleaned) out.push(cleaned);
    }
  } else {
    let i = 0;
    while (i < lines.length && out.length < RESPONSE_ARTIFACT_MAX_COMMANDS) {
      let line = lines[i];
      i += 1;
      if (line.trim().length === 0 || COMMENT_RE.test(line)) continue;
      let guard = 0;
      while (TRAILING_BACKSLASH_RE.test(line) && i < lines.length && guard < MAX_BLOCK_SCAN_LINES) {
        guard += 1;
        line = `${stripTrailingBackslash(line)} ${lines[i].trim()}`;
        i += 1;
      }
      const cleaned = cleanCommand(line);
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Diff detection + stats
// ---------------------------------------------------------------------------

const DIFF_BODY_RE =
  /^(?:diff --git |index |--- |\+\+\+ |@@|new file mode|deleted file mode|old mode|new mode|similarity index|dissimilarity index|rename (?:from|to) |copy (?:from|to) |Binary files |GIT binary patch|[ +\-\\])/;

/** Compute display stats from parsed files; counts only files with ≥1 hunk (matches summarizeHunks). */
function diffStats(files: ParsedFileDiff[]): ExtractedDiffStats {
  let fileCount = 0;
  let additions = 0;
  let deletions = 0;
  const paths: string[] = [];
  for (const file of files) {
    if (!file || !Array.isArray(file.hunks) || file.hunks.length === 0) continue;
    fileCount += 1;
    const rawPath = file.newPath && file.newPath !== '/dev/null' ? file.newPath : file.oldPath;
    if (rawPath && paths.length < RESPONSE_ARTIFACT_MAX_DIFF_PATHS) {
      const disp = displayPath(rawPath);
      if (disp) paths.push(disp);
    }
    for (const hunk of file.hunks) {
      if (!hunk || !Array.isArray(hunk.lines)) continue;
      for (const l of hunk.lines) {
        const c = typeof l === 'string' ? l[0] : '';
        if (c === '+') additions += 1;
        else if (c === '-') deletions += 1;
      }
    }
  }
  return { fileCount, additions, deletions, paths };
}

function isSensitivePath(path: string): boolean {
  if (path.startsWith('/') || path.startsWith('~')) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  if (/(?:^|[/\\])(?:Users|home)[/\\]/.test(path)) return true;
  return false;
}

/** Keep a repo-relative path; reduce an absolute/home path to a basename (no username leak). */
function displayPath(path: string): string {
  const cleaned = cleanLabel(path, 200);
  if (!cleaned) return '';
  return isSensitivePath(cleaned) ? lastSegment(cleaned) : cleaned;
}

// ---------------------------------------------------------------------------
// Candidate builders (return an artifact WITHOUT an id; id assigned after sort)
// ---------------------------------------------------------------------------

type Draft = Omit<ExtractedArtifact, 'id'>;

function buildCodeDraft(language: string, fileHint: string, body: string, heading: string): Draft | null {
  const content = clampBody(body);
  // Worth-surfacing: skip an empty fence (render already handles those).
  if (content.trim().length === 0) return null;

  const suggestedFilename =
    safeArtifactBasename(fileHint) ||
    safeArtifactBasename(fileHintFromBody(body)) ||
    (looksLikeFilename(heading) ? safeArtifactBasename(heading) : '');

  let title = cleanLabel(heading, RESPONSE_ARTIFACT_TITLE_MAX);
  if (!title && suggestedFilename) title = cleanLabel(suggestedFilename, RESPONSE_ARTIFACT_TITLE_MAX);
  if (!title) title = language ? `Code (${language})` : 'Code';

  const draft: Draft = { kind: 'code', title, content };
  if (language) draft.language = language;
  if (suggestedFilename) draft.suggestedFilename = suggestedFilename;
  return draft;
}

function buildDiffDraft(files: ParsedFileDiff[], body: string, fenceLang: string): Draft {
  const stats = diffStats(files);
  const content = clampBody(body);
  const title = stats.paths.length === 1
    ? cleanLabel(`Patch: ${stats.paths[0]}`, RESPONSE_ARTIFACT_TITLE_MAX)
    : `Patch (${stats.fileCount} file${stats.fileCount === 1 ? '' : 's'})`;
  return {
    kind: 'diff',
    title,
    content,
    language: fenceLang || 'diff',
    suggestedFilename: 'changes.patch',
    diff: stats,
  };
}

function buildCommandsDraft(commands: string[], fenceLang: string): Draft | null {
  const capped = commands.slice(0, RESPONSE_ARTIFACT_MAX_COMMANDS);
  if (capped.length === 0) return null;
  return {
    kind: 'commands',
    title: `Commands (${capped.length})`,
    content: clampBody(capped.join('\n')),
    language: fenceLang && SHELL_LANGS.has(fenceLang) ? fenceLang : 'bash',
    suggestedFilename: 'commands.sh',
    commands: capped,
  };
}

/** Classify a fenced block into a draft (or null when not worth surfacing). */
function classifyFence(fence: FenceOpen, body: string, heading: string): Draft | null {
  const { language, fileHint } = parseInfoString(fence.info);

  // 1) Diff — explicit diff/patch language, OR a no-language fence whose body
  //    parses as a real unified diff (≥1 hunk).
  const langIsDiff = DIFF_LANGS.has(language);
  if (langIsDiff || !language) {
    let files: ParsedFileDiff[] = [];
    try { files = parseUnifiedDiff(body); } catch { files = []; }
    const filesWithHunks = files.filter((f) => f && Array.isArray(f.hunks) && f.hunks.length > 0);
    if (filesWithHunks.length > 0) {
      return buildDiffDraft(files, body, langIsDiff ? language : 'diff');
    }
  }

  // 2) Commands — a shell language, OR a no-language fence with `$ `/`% ` prompts.
  const langIsShell = SHELL_LANGS.has(language);
  if (langIsShell || (!language && PROMPT_RE.test(body))) {
    const commands = extractCommands(body);
    const draft = buildCommandsDraft(commands, language);
    if (draft) return draft;
    // Fall through to code if a shell fence yielded no commands (e.g. all output).
  }

  // 3) Everything else (incl. csv, which the caller upgrades to a table) → code.
  return buildCodeDraft(language, fileHint, body, heading);
}

// ---------------------------------------------------------------------------
// Bare-block detectors (outside fences)
// ---------------------------------------------------------------------------

function looksLikeBareDiffStart(lines: string[], i: number): boolean {
  const l = lines[i];
  if (/^diff --git /.test(l)) return true;
  if (/^@@+ -\d/.test(l)) return true;
  if (/^--- /.test(l)) {
    const k = i + 1;
    if (k < lines.length && /^\+\+\+ /.test(lines[k])) {
      const end = Math.min(lines.length, k + 4);
      for (let m = k + 1; m < end; m += 1) {
        if (/^@@+ -\d/.test(lines[m])) return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

function normalizeInput(text: unknown): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  return text.slice(0, RESPONSE_ARTIFACT_INPUT_SCAN_MAX).replace(/\r\n?/g, '\n');
}

interface Candidate { pos: number; order: number; draft: Draft; }

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Scan a finished agent answer and extract the typed, reusable artifacts a UI can
 * save / copy / apply: fenced (or bare) code blocks with an inferred save
 * filename, diffs/patches (validated + summarized via parseUnifiedDiff), shell
 * command runbooks, and — when the answer names ≥ RESPONSE_ARTIFACT_MIN_LINKS
 * distinct urls — one openable, secret-safe links set. Artifacts are returned in
 * first-appearance order with stable ids. Plans are deliberately NOT emitted.
 *
 * TOTAL + bounded + deterministic + secret-safe: any null / undefined / wrong-type
 * / huge / hostile input yields a safe (possibly empty) array and NEVER throws.
 */
export function extractResponseArtifacts(text: unknown): ExtractedArtifact[] {
  try {
    const src = normalizeInput(text);
    if (src.length === 0) return [];

    const lines = src.split('\n');
    // Precompute char offset of each line start for first-appearance ordering.
    const lineStarts: number[] = new Array(lines.length);
    {
      let off = 0;
      for (let i = 0; i < lines.length; i += 1) { lineStarts[i] = off; off += lines[i].length + 1; }
    }

    const candidates: Candidate[] = [];
    let order = 0;
    const push = (pos: number, draft: Draft | null): void => {
      if (!draft) return;
      if (candidates.length >= MAX_CANDIDATES) return;
      candidates.push({ pos, order: order++, draft });
    };

    let lastHeading = '';
    let i = 0;
    while (i < lines.length && candidates.length < MAX_CANDIDATES) {
      const line = lines[i];

      // Fenced block.
      const fence = matchFenceOpen(line);
      if (fence) {
        const bodyLines: string[] = [];
        let j = i + 1;
        let closed = false;
        while (j < lines.length) {
          if (isFenceClose(lines[j], fence.char, fence.len)) { closed = true; break; }
          bodyLines.push(lines[j]);
          j += 1;
        }
        try {
          push(lineStarts[i], classifyFence(fence, bodyLines.join('\n'), lastHeading));
        } catch { /* never let one block break the scan */ }
        lastHeading = '';
        i = closed ? j + 1 : j;
        continue;
      }

      // Heading (naming hint for the next block).
      const heading = matchHeadingText(line);
      if (heading !== null) { lastHeading = heading; i += 1; continue; }

      // Bare unified diff.
      if (looksLikeBareDiffStart(lines, i)) {
        const blockLines: string[] = [];
        let j = i;
        while (j < lines.length && blockLines.length < MAX_BLOCK_SCAN_LINES && DIFF_BODY_RE.test(lines[j])) {
          blockLines.push(lines[j]);
          j += 1;
        }
        const body = blockLines.join('\n');
        let files: ParsedFileDiff[] = [];
        try { files = parseUnifiedDiff(body); } catch { files = []; }
        const filesWithHunks = files.filter((f) => f && Array.isArray(f.hunks) && f.hunks.length > 0);
        if (filesWithHunks.length > 0) push(lineStarts[i], buildDiffDraft(files, body, 'diff'));
        lastHeading = '';
        i = Math.max(j, i + 1);
        continue;
      }

      // Bare command run: ≥2 prompt lines in a consecutive prompt/continuation run.
      if (PROMPT_RE.test(line)) {
        const blockLines: string[] = [];
        let promptCount = 0;
        let j = i;
        while (j < lines.length && blockLines.length < MAX_BLOCK_SCAN_LINES) {
          const cur = lines[j];
          const isPrompt = PROMPT_RE.test(cur);
          const isCont = CONT_PROMPT_RE.test(cur);
          const prevBackslash = blockLines.length > 0 && TRAILING_BACKSLASH_RE.test(blockLines[blockLines.length - 1]);
          if (isPrompt || isCont || prevBackslash) {
            if (isPrompt) promptCount += 1;
            blockLines.push(cur);
            j += 1;
            continue;
          }
          break;
        }
        if (promptCount >= 2) {
          const commands = extractCommands(blockLines.join('\n'));
          push(lineStarts[i], buildCommandsDraft(commands, ''));
        }
        lastHeading = '';
        i = Math.max(j, i + 1);
        continue;
      }

      // Plain prose line — the pending heading still names the next block.
      i += 1;
    }

    // Links — mine urls across the whole answer (a batch, not source attribution).
    try {
      const cites = extractCitations(src);
      const seen = new Set<string>();
      const urls: string[] = [];
      let firstRaw = '';
      for (const c of cites) {
        if (!c || c.kind !== 'url') continue;
        const clean = sanitizeUrl(c.url ?? c.raw);
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (!firstRaw && typeof c.raw === 'string') firstRaw = c.raw;
        if (urls.length < RESPONSE_ARTIFACT_MAX_LINKS) urls.push(clean);
      }
      if (urls.length >= RESPONSE_ARTIFACT_MIN_LINKS) {
        const idx = firstRaw ? src.indexOf(firstRaw) : -1;
        push(idx >= 0 ? idx : 0, {
          kind: 'links',
          title: `Links (${urls.length})`,
          content: urls.join('\n'),
          urls,
        });
      }
    } catch { /* links are best-effort */ }

    // Stable first-appearance order (tiebreak on discovery order), then id + cap.
    candidates.sort((a, b) => (a.pos - b.pos) || (a.order - b.order));
    const out: ExtractedArtifact[] = [];
    for (let k = 0; k < candidates.length && out.length < RESPONSE_ARTIFACT_MAX; k += 1) {
      out.push({ id: `artifact-${out.length}`, ...candidates[k].draft });
    }
    return out;
  } catch {
    return [];
  }
}
