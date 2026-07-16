// chatSourcesSurfaceCore — RESPONSE_QUALITY R7: a user-facing "Sources" surface.
//
// The chat response path already EXTRACTS grounding references
// (src/lib/citationExtractCore.ts pulls file / file:line / url / commit citations
// out of the assistant's own text) and runs tools that fetch/read real sources —
// but it never ATTRIBUTES them back to the user. This core turns those extracted
// citations plus tool-result sources into ONE compact, deduped, ranked "Sources"
// list and a small markdown block a renderer can show under an answer, so a user
// sees WHERE the facts came from (docs/SWANBOT_RESPONSE_QUALITY_PLAN.md R4 + R7).
//
// It REUSES the pure citation extractor at runtime (citationExtractCore has zero
// imports, so this module stays tsx-loadable): `extractCitations` mines a raw text
// blob or a tool result for references, and `dedupeCitations` validates a
// caller-supplied citation array. No fetching, no resolving, no validation that a
// path/url exists — purely shaping already-known references into display.
//
// SECRET-SAFE: URLs are stripped of `user:pass@` userinfo and their sensitive
// query values are redacted; absolute / home-dir paths are reduced to a basename
// (so `/Users/<name>/…/foo.ts` never leaks a username); commit SHAs are shortened;
// labels/refs are cleaned of control chars, the Unicode-Tag smuggling block
// (U+E0000–U+E007F), backticks and angle brackets, and the auto-loading markdown
// image marker is defanged. Everything is bounded and every export is TOTAL —
// null / undefined / wrong-type / huge / hostile / cyclic input yields the neutral
// `{ sources: [], markdown: '', count: 0 }` and NEVER throws.
//
// PURITY: only import is citationExtractCore (pure). DETERMINISTIC (no Date.now /
// Math.random). Smoke: scripts/chat-sources-surface-core-smoketest.ts.

import { extractCitations, dedupeCitations, type Citation } from './citationExtractCore';

/** One attributed source line: a display `label`, its `kind`, and a stable `ref`. */
export interface SourceItem {
  /** Compact, secret-safe display text (basename, hostname, short sha, tool name). */
  label: string;
  /** Category: 'file' | 'url' | 'commit' | 'tool'. */
  kind: string;
  /** Stable, secret-safe reference string (also the dedupe key with `kind`). */
  ref: string;
}

/** The built Sources surface: the shaped list, a markdown block, and its size. */
export interface SourcesSurface {
  sources: SourceItem[];
  markdown: string;
  count: number;
}

export interface BuildSourcesSurfaceInput {
  /** Extracted citations (Citation[]) OR a raw text blob to extract from. */
  citations?: unknown;
  /** Tool events whose results/metadata referenced a source. */
  toolEvents?: unknown;
  /** Max sources to surface (default 12, clamped to 0..50). */
  maxSources?: unknown;
}

const DEFAULT_MAX_SOURCES = 12;
const HARD_MAX_SOURCES = 50;
const MAX_TOOL_EVENTS = 500;
const MAX_CITATIONS_IN = 20_000;
const MAX_RAW_ITEMS = 4_000;
const MAX_TEXT_SCAN = 20_000;
const MAX_LABEL_LEN = 120;
const MAX_REF_LEN = 300;
const MAX_URL_PRECLEAN = 2_000;

const EMPTY: SourcesSurface = { sources: [], markdown: '', count: 0 };

// Rank drives grouping: most-specific code references first, generic tool markers
// last. file_line (0) and bare file (1) both DISPLAY as kind 'file'.
const RANK_FILE_LINE = 0;
const RANK_FILE = 1;
const RANK_URL = 2;
const RANK_COMMIT = 3;
const RANK_TOOL = 4;

// Query-param keys whose VALUE is redacted from a surfaced URL. Compared after
// lowercasing and removing `_`/`-`, so `api_key`, `apiKey`, `API-KEY` all match.
const SENSITIVE_PARAM_KEYS = new Set<string>([
  'apikey', 'key', 'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken',
  'secret', 'clientsecret', 'password', 'passwd', 'pwd', 'signature', 'sig',
  'auth', 'authorization', 'bearer', 'credential', 'credentials', 'session',
  'sessionid', 'sid', 'code', 'assertion', 'privatekey',
]);

/** Coerce to a bounded integer; invalid → default. */
function clampInt(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  let x = Math.floor(n);
  if (x < min) x = min;
  if (x > max) x = max;
  return x;
}

/** First non-empty string among the arguments, else ''. */
function firstString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return '';
}

/**
 * Strip anything unsafe/noisy for display: control chars, DEL, the Unicode Tag
 * block (ASCII-smuggling), backticks and angle brackets, defang the markdown
 * image marker `![`, collapse whitespace, trim, and cap length. Non-string → ''.
 */
function cleanDisplay(input: unknown, cap: number): string {
  if (typeof input !== 'string') return '';
  const src = input.length > cap * 4 ? input.slice(0, cap * 4) : input;
  let out = '';
  for (const ch of src) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp < 0x20 || cp === 0x7f) continue; // C0 controls + DEL
    if (cp >= 0xe0000 && cp <= 0xe007f) continue; // Unicode Tag smuggling block
    if (ch === '`' || ch === '<' || ch === '>') continue;
    out += ch;
  }
  out = out.replace(/!\[/g, '[').replace(/\s+/g, ' ').trim();
  if (out.length > cap) out = `${out.slice(0, cap - 1).trimEnd()}…`;
  return out;
}

/** Last path segment (handles `/` and `\`). */
function basenameOf(path: string): string {
  const norm = path.replace(/\\/g, '/');
  const trimmed = norm.replace(/\/+$/g, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** True when a path is absolute or carries a home-dir prefix that could leak a username. */
function isSensitivePath(path: string): boolean {
  if (path.startsWith('/') || path.startsWith('~')) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true; // Windows drive
  if (/(?:^|[/\\])(?:Users|home)[/\\]/.test(path)) return true;
  return false;
}

/** Display path: a relative path is kept; an absolute/home path is reduced to a basename. */
function displayPathOf(path: unknown): string {
  if (typeof path !== 'string') return '';
  const cleaned = cleanDisplay(path, MAX_REF_LEN);
  if (!cleaned) return '';
  return isSensitivePath(cleaned) ? basenameOf(cleaned) : cleaned;
}

/** Extract the host from an http(s) URL, dropping userinfo and port. */
function hostnameOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  if (!m) return '';
  let host = m[1];
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1);
  return host.replace(/:\d+$/, '');
}

/** Redact sensitive query-param VALUES; leaves benign params (`q`, `page`) intact. */
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

/**
 * Secret-safe http(s) URL: strip `user:pass@` userinfo, redact sensitive query
 * values, lowercase scheme+host, cap length. Non-http or garbage → ''.
 */
function sanitizeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  if (!s) return '';
  if (s.length > MAX_URL_PRECLEAN) s = s.slice(0, MAX_URL_PRECLEAN);
  const m = /^(https?:\/\/)([^]*)$/i.exec(s);
  if (!m) return '';
  const scheme = m[1].toLowerCase();
  const rest = m[2];

  const sepIdx = rest.search(/[/?#]/);
  const authority = sepIdx === -1 ? rest : rest.slice(0, sepIdx);
  let tail = sepIdx === -1 ? '' : rest.slice(sepIdx);

  const at = authority.lastIndexOf('@');
  const host = at === -1 ? authority : authority.slice(at + 1);
  if (!host) return '';

  // Split off the fragment FIRST — OAuth / Supabase implicit-flow tokens ride in
  // the `#access_token=…&refresh_token=…` fragment, so it must be redacted too.
  // (The previous code re-appended the fragment verbatim, or skipped it entirely
  // when there was no `?`, leaking those session tokens into the Sources block.)
  let frag = '';
  const fIdx = tail.indexOf('#');
  if (fIdx !== -1) {
    frag = tail.slice(fIdx + 1);
    tail = tail.slice(0, fIdx);
  }
  const qIdx = tail.indexOf('?');
  if (qIdx !== -1) {
    const path = tail.slice(0, qIdx);
    const query = tail.slice(qIdx + 1);
    tail = `${path}?${redactQuery(query)}`;
  }
  if (frag) tail = `${tail}#${redactQuery(frag)}`;

  const out = `${scheme}${host}${tail}`;
  const safe = cleanDisplay(out, MAX_REF_LEN);
  return safe;
}

type RankedItem = { item: SourceItem; rank: number };

/** Map an extracted citation to a ranked, secret-safe SourceItem. Junk → null. */
function citationToItem(c: Citation): RankedItem | null {
  if (!c || typeof c !== 'object' || typeof c.kind !== 'string') return null;
  switch (c.kind) {
    case 'file_line': {
      const p = displayPathOf(c.path);
      if (!p) return null;
      const line = typeof c.line === 'number' && Number.isFinite(c.line) && c.line >= 0
        ? Math.floor(c.line)
        : undefined;
      const ref = cleanDisplay(line !== undefined ? `${p}:${line}` : p, MAX_REF_LEN);
      if (!ref) return null;
      return { item: { label: ref, kind: 'file', ref }, rank: RANK_FILE_LINE };
    }
    case 'file': {
      const p = displayPathOf(c.path);
      if (!p) return null;
      return { item: { label: p, kind: 'file', ref: p }, rank: RANK_FILE };
    }
    case 'url': {
      const u = sanitizeUrl(typeof c.url === 'string' ? c.url : c.raw);
      if (!u) return null;
      const label = cleanDisplay(hostnameOf(u) || u, MAX_LABEL_LEN);
      return { item: { label: label || u, kind: 'url', ref: u }, rank: RANK_URL };
    }
    case 'commit': {
      const shaRaw = typeof c.sha === 'string' ? c.sha : c.raw;
      const sha = cleanDisplay(typeof shaRaw === 'string' ? shaRaw : '', 40);
      if (!sha) return null;
      const short = sha.slice(0, 10);
      return { item: { label: short, kind: 'commit', ref: sha }, rank: RANK_COMMIT };
    }
    default:
      return null;
  }
}

/** Pick the strongest citation from a set: url > file/file_line > commit. */
function strongestCitation(cites: Citation[]): Citation | undefined {
  return (
    cites.find((c) => c && c.kind === 'url') ||
    cites.find((c) => c && (c.kind === 'file' || c.kind === 'file_line')) ||
    cites.find((c) => c && c.kind === 'commit')
  );
}

/**
 * Map one tool event to a ranked source. If the event's metadata/input/result
 * text carries a real url/file/commit reference, that natural source is emitted
 * (so a tool-fetched URL DEDUPES against the same URL cited in the answer text).
 * Otherwise a generic `tool` marker (labelled by tool name) is emitted so the
 * user still sees the tool contributed. No usable info → null.
 */
function toolEventToItem(ev: unknown): RankedItem | null {
  if (!ev || typeof ev !== 'object') return null;
  const o = ev as Record<string, unknown>;
  const toolName = cleanDisplay(firstString(o.tool, o.tool_name, o.toolName, o.name), MAX_LABEL_LEN);

  const md = o.metadata && typeof o.metadata === 'object' ? (o.metadata as Record<string, unknown>) : null;
  const inp = o.input && typeof o.input === 'object' ? (o.input as Record<string, unknown>) : null;
  const explicitRef = firstString(
    md?.url, md?.href, md?.link, md?.source, md?.path, md?.file, md?.ref, md?.location,
    inp?.url, inp?.href, inp?.path, inp?.file,
  );

  let cite: Citation | undefined;
  if (explicitRef) {
    cite = strongestCitation(extractCitations(explicitRef.slice(0, MAX_TEXT_SCAN)));
  }
  if (!cite) {
    const text = firstString(o.summary) + '\n' + firstString(o.result) + '\n'
      + firstString(o.command) + '\n' + firstString(o.output);
    cite = strongestCitation(extractCitations(text.slice(0, MAX_TEXT_SCAN)));
  }
  if (cite) {
    const mapped = citationToItem(cite);
    if (mapped) return mapped;
  }

  if (!toolName) return null;
  return { item: { label: toolName, kind: 'tool', ref: toolName }, rank: RANK_TOOL };
}

/** Resolve the `citations` input into a Citation[] (raw text → extract; array → validate). */
function resolveCitations(input: unknown): Citation[] {
  if (typeof input === 'string') return extractCitations(input);
  if (!Array.isArray(input)) return [];
  const bounded = input.length > MAX_CITATIONS_IN ? input.slice(0, MAX_CITATIONS_IN) : input;
  const objs: unknown[] = [];
  const out: Citation[] = [];
  for (const x of bounded) {
    if (typeof x === 'string') {
      for (const c of extractCitations(x)) out.push(c);
    } else if (x && typeof x === 'object') {
      objs.push(x);
    }
  }
  // dedupeCitations validates each object carries a string `kind`.
  return [...dedupeCitations(objs), ...out];
}

function renderLine(item: SourceItem): string {
  const label = cleanDisplay(item.label, MAX_LABEL_LEN);
  const ref = cleanDisplay(item.ref, MAX_REF_LEN);
  switch (item.kind) {
    case 'file':
      return `\`${label || ref}\``;
    case 'commit':
      return `commit \`${label || ref}\``;
    case 'url':
      return ref || label;
    case 'tool':
      return `${label || ref} (tool)`;
    default:
      return label || ref;
  }
}

function renderMarkdown(items: SourceItem[]): string {
  if (items.length === 0) return '';
  const lines = ['**Sources**'];
  for (const it of items) lines.push(`- ${renderLine(it)}`);
  return lines.join('\n');
}

/**
 * Build a compact, deduped, ranked "Sources" surface from extracted citations
 * and/or tool events. Returns the shaped list, a markdown block for display, and
 * the count. TOTAL and secret-safe: any bad/hostile input yields the neutral
 * `{ sources: [], markdown: '', count: 0 }` and never throws.
 */
export function buildSourcesSurface(input: BuildSourcesSurfaceInput): SourcesSurface {
  try {
    if (!input || typeof input !== 'object') return { ...EMPTY, sources: [] };
    const maxSources = clampInt(input.maxSources, DEFAULT_MAX_SOURCES, 0, HARD_MAX_SOURCES);

    const raw: RankedItem[] = [];

    for (const c of resolveCitations(input.citations)) {
      if (raw.length >= MAX_RAW_ITEMS) break;
      const mapped = citationToItem(c);
      if (mapped) raw.push(mapped);
    }

    if (Array.isArray(input.toolEvents)) {
      const events = input.toolEvents.length > MAX_TOOL_EVENTS
        ? input.toolEvents.slice(0, MAX_TOOL_EVENTS)
        : input.toolEvents;
      for (const ev of events) {
        if (raw.length >= MAX_RAW_ITEMS) break;
        const mapped = toolEventToItem(ev);
        if (mapped) raw.push(mapped);
      }
    }

    // Stable rank: group by kind priority, preserve discovery order within a group.
    const ordered = raw
      .map((r, index) => ({ r, index }))
      .sort((a, b) => a.r.rank - b.r.rank || a.index - b.index)
      .map((x) => x.r);

    const seen = new Set<string>();
    const sources: SourceItem[] = [];
    for (const r of ordered) {
      if (sources.length >= maxSources) break;
      const key = `${r.item.kind}|${r.item.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push(r.item);
    }

    return { sources, markdown: renderMarkdown(sources), count: sources.length };
  } catch {
    return { sources: [], markdown: '', count: 0 };
  }
}
