/**
 * attachmentRoutingCore — pure, dependency-free classification + consumption
 * ROUTING for the attachments on one chat turn.
 *
 * The pre-send gate (attachmentPreflightCore) already ADMITS a safe subset of
 * attachments (accept/reject on size/count/dangerous-type). Nothing after that
 * decides HOW the model should actually CONSUME each admitted blob, so multimodal
 * input is silently mis-routed: a vision model never receives image bytes as a
 * vision part, a text-only model gets a truncated base64 stub, and every non-media
 * file is flattened into one coarse "file" bucket with scattered .slice(0,2000)
 * truncation. This core is the missing pure function that turns "the blobs on this
 * turn" into a routing plan — per-item category + a consumption LANE, plus the
 * turn-level booleans a caller needs (vision required, desktop handoff candidate,
 * text extraction needed, oversize summarization needed).
 *
 * Composition (not duplication):
 *   - attachmentPreflightCore runs BEFORE this (admit vs reject). This runs on
 *     the already-accepted set and answers ROUTE, not admit — oversize here
 *     becomes a summarize/reference LANE, never a rejection.
 *   - capabilityFallbackCore CONSUMES RequiredCapabilities.vision. This core is
 *     the missing PRODUCER of that boolean: plan.visionRequired → the caller maps
 *     it onto resolveCapabilityFallback(profile, { vision: plan.visionRequired }).
 *   - chatDesktopAttachmentRouting decides WHICH desktop app. This core stops at
 *     emitting a desktop_handoff_candidate LANE (plan.desktopCandidate) and defers
 *     the app choice entirely; APP_NATIVE_BINARY_EXT is a tiny signal, not an app
 *     map.
 *
 * Wiring target: `sendMessage` in `src/screens/circles/tabs/ChatTab.tsx`, at the
 * "Model capability routing" block, where `currentAttachments` are in scope. Map
 * each to AttachmentRouteInput { name, mimeType, sizeBytes:size,
 * hasExtractedText:!!extractText, extractedTextChars:extractText?.length } and
 * call planAttachmentRouting(...).
 *
 * Purity contract (smoke-tested under tsx/esbuild, which cannot load
 * react-native): ZERO runtime imports, self-contained, no side effects at import,
 * no Date.now()/Math.random()/argless new Date, and every export is TOTAL —
 * null / undefined / wrong-type / hostile / huge / cyclic / throwing-getter /
 * revoked-proxy / bigint input degrades to a safe, bounded, neutral value instead
 * of throwing. DETERMINISTIC (frozen const Sets + pure comparisons). BOUNDED
 * (items ≤ MAX_ROUTED_ITEMS; names/reasons/summary clamped; count maps have a
 * fixed literal keyset). SECRET-SAFE (per-item name is a bounded, control-clean,
 * extension-preserved basename with no ../ traversal; reason names only
 * category/lane enums + a human byte size; the aggregate summary is COUNTS ONLY;
 * extractedText content, base64, and data-uri bytes are NEVER echoed —
 * extractedTextChars is a length int the core never renders back).
 *
 * Smoke: scripts/attachment-routing-core-smoketest.ts.
 */

// ─── Contract types ──────────────────────────────────────────────────────────

/** Content-kind of one attachment. 7 file kinds + audio/video (distinct lane). */
export type AttachmentCategory =
  | 'image'
  | 'document'
  | 'code'
  | 'data'
  | 'log'
  | 'archive'
  | 'audio'
  | 'video'
  | 'unknown';

/** How the model should CONSUME the attachment. */
export type AttachmentRouteLane =
  /** Visual content a vision model consumes directly → sets needsVision. */
  | 'vision'
  /** Text already in hand & small → inline verbatim. */
  | 'inline_text'
  /** Text-bearing doc/data with no extracted text yet, small → EXTRACT then inline. */
  | 'extract_then_inline'
  /** Text/data over the inline budget (or file over the extract budget) → summarize. */
  | 'summarize_oversize'
  /** App-native binary (psd/indd/ai/dwg/xlsx…) → HINT to run desktop routing. */
  | 'desktop_handoff_candidate'
  /** Opaque binary / archive / audio-video w/o transcription → filename+type reference. */
  | 'reference_only';

/** One candidate attachment as seen at the routing gate. All fields optional
 *  because the caller normalizes from heterogeneous sources. */
export interface AttachmentRouteInput {
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  hasExtractedText?: boolean;
  extractedTextChars?: number;
}

/** A single routed attachment. `name` is a bounded, secret-safe basename. */
export interface RoutedAttachment {
  index: number;
  name: string;
  category: AttachmentCategory;
  lane: AttachmentRouteLane;
  needsVision: boolean;
  reason: string;
}

/** The turn-level routing plan. */
export interface AttachmentRoutingPlan {
  items: RoutedAttachment[];
  visionRequired: boolean;
  desktopCandidate: boolean;
  needsTextExtraction: boolean;
  needsSummarization: boolean;
  laneCounts: Record<AttachmentRouteLane, number>;
  categoryCounts: Record<AttachmentCategory, number>;
  summary: string;
}

/** Budget overrides. Each falls back to its DEFAULT_* when absent/invalid. */
export interface AttachmentRoutingOptions {
  maxInlineTextChars?: number;
  maxVisionImageBytes?: number;
  maxExtractBytes?: number;
}

// ─── Public defaults / caps ──────────────────────────────────────────────────

/** Inline text budget (mirrors chatMedia's ≈8k text-extract cap). */
export const DEFAULT_MAX_INLINE_TEXT_CHARS = 8000;
/** Above this an image is too big to send as a vision part → reference_only. */
export const DEFAULT_MAX_VISION_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
/** Above this a text-bearing file is too big to extract in-band → summarize. */
export const DEFAULT_MAX_EXTRACT_BYTES = 2 * 1024 * 1024; // 2 MB
/** Max attachments routed on one turn; the rest are dropped from the plan. */
export const MAX_ROUTED_ITEMS = 64;
/** Echoed per-item name is clamped to this many code points. */
export const MAX_NAME_CHARS = 120;
/** Per-item reason is clamped to this many code points. */
export const MAX_REASON_CHARS = 120;
/** Aggregate summary is clamped to this many code points. */
export const MAX_SUMMARY_CHARS = 200;

// ─── Internal bounds ─────────────────────────────────────────────────────────

const MAX_MIME_CHARS = 256;
const MAX_NAME_SCAN = MAX_NAME_CHARS * 4; // pre-bound before per-code-point work
const MAX_STEM_SCAN = 512;
const MAX_EXT_LEN = 12;
const MAX_BYTES_CLAMP = Number.MAX_SAFE_INTEGER;

// ─── Frozen classification tables (disjoint sets; deterministic) ─────────────

const CODE_EXT: ReadonlySet<string> = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'pyw', 'go', 'rs', 'java', 'c',
  'h', 'cc', 'cpp', 'hpp', 'cxx', 'hxx', 'rb', 'swift', 'kt', 'kts', 'php',
  'cs', 'sh', 'bash', 'zsh', 'fish', 'pl', 'pm', 'lua', 'r', 'scala', 'dart',
  'ex', 'exs', 'erl', 'clj', 'cljs', 'hs', 'ml', 'fs', 'vb', 'groovy', 'gradle',
  'vue', 'svelte', 'astro', 'sol', 'zig', 'nim', 'jl',
]);

const DATA_EXT: ReadonlySet<string> = new Set([
  'json', 'jsonl', 'csv', 'tsv', 'xml', 'yaml', 'yml', 'toml', 'sql', 'parquet',
  'ndjson', 'xlsx', 'xls', 'proto', 'avro', 'graphql',
]);

const LOG_EXT: ReadonlySet<string> = new Set(['log']);

const DOC_EXT: ReadonlySet<string> = new Set([
  'pdf', 'doc', 'docx', 'rtf', 'odt', 'md', 'markdown', 'mdx', 'txt', 'text',
  'pages', 'epub', 'tex',
]);

const ARCHIVE_EXT: ReadonlySet<string> = new Set([
  'zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'tbz', 'tbz2', 'xz', 'txz',
  'zst', 'lz', 'lzma', 'z', 'cab',
]);

const IMAGE_EXT: ReadonlySet<string> = new Set([
  'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic',
  'heif', 'svg', 'avif', 'ico',
]);

const AUDIO_EXT: ReadonlySet<string> = new Set([
  'mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aiff', 'aif',
]);

const VIDEO_EXT: ReadonlySet<string> = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', '3gp',
]);

/**
 * A tiny SIGNAL set (not an app map) of app-native binary formats that must be
 * opened in their native desktop app rather than inlined or sent as a vision
 * part. This FORCES the desktop_handoff_candidate lane even when the file's
 * content category is image/document/data.
 */
const APP_NATIVE_BINARY_EXT: ReadonlySet<string> = new Set([
  // Adobe / design
  'psd', 'psb', 'indd', 'idml', 'ai', 'eps', 'sketch', 'fig',
  // Spreadsheets (binary containers)
  'xlsx', 'xls',
  // CAD / 3D
  'dwg', 'dxf', 'step', 'stp', 'iges', 'igs', 'stl', 'skp', '3dm', 'sldprt',
  'sldasm', 'ipt', 'iam', 'f3d', 'blend',
]);

/** Archive MIME essences (mime-first bucketing before extension). */
const ARCHIVE_MIME: ReadonlySet<string> = new Set([
  'application/zip', 'application/x-zip-compressed', 'application/x-tar',
  'application/gzip', 'application/x-gzip', 'application/x-7z-compressed',
  'application/x-rar-compressed', 'application/vnd.rar', 'application/x-bzip2',
  'application/x-xz', 'application/x-compress', 'application/x-lzma',
  'application/zstd',
]);

// ─── Total primitives ────────────────────────────────────────────────────────

/** Read a property off an unknown without ever throwing (Proxy/getter safe). */
function safeGet(obj: unknown, key: string): unknown {
  if (obj === null || (typeof obj !== 'object' && typeof obj !== 'function')) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Safe indexed read off an array-like (throwing-element-getter safe). */
function safeIndex(arr: unknown, i: number): unknown {
  try {
    return (arr as unknown[])[i];
  } catch {
    return undefined;
  }
}

/** A plain string, or ''. */
function safeStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** A finite, non-negative byte count clamped to MAX_BYTES_CLAMP, else 0. */
function coerceBytes(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return v > MAX_BYTES_CLAMP ? MAX_BYTES_CLAMP : v;
  }
  return 0;
}

/** A finite, non-negative integer char count clamped to MAX_BYTES_CLAMP, else 0. */
function coerceCount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    const n = Math.floor(v);
    return n > MAX_BYTES_CLAMP ? MAX_BYTES_CLAMP : n;
  }
  return 0;
}

/** A positive finite option value, else the fallback. */
function coercePositive(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return v > MAX_BYTES_CLAMP ? MAX_BYTES_CLAMP : v;
  }
  return fallback;
}

/** Round to one decimal, dropping a trailing ".0". */
function trimNum(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Human-readable byte size ("512 KB", "1.5 MB"). Non-positive → ''. */
function formatBytes(bytes: number): string {
  if (!(bytes > 0)) return '';
  let b = bytes > MAX_BYTES_CLAMP ? MAX_BYTES_CLAMP : bytes;
  if (b < 1024) return `${Math.round(b)} B`;
  const kb = b / 1024;
  if (kb < 1024) return `${trimNum(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${trimNum(mb)} MB`;
  const gb = mb / 1024;
  return `${trimNum(gb)} GB`;
}

/** Normalized MIME essence: lower-cased, parameters stripped, bounded, or ''. */
function mimeEssence(mime: unknown): string {
  if (typeof mime !== 'string') return '';
  const bounded = mime.length > MAX_MIME_CHARS ? mime.slice(0, MAX_MIME_CHARS) : mime;
  const first = bounded.split(';')[0];
  return first ? first.trim().toLowerCase() : '';
}

/** Lower-cased extension (no dot), or ''. Total on any input; strips path,
 *  query/hash, and Windows trailing dots/spaces. */
function fileExtension(name: unknown): string {
  if (typeof name !== 'string') return '';
  let s = name.trim();
  if (!s) return '';
  if (s.length > MAX_STEM_SCAN) s = s.slice(0, MAX_STEM_SCAN);
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(/[.\s]+$/, '');
  if (!s) return '';
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return ''; // no dot, or leading-dot dotfile
  const ext = s.slice(dot + 1).toLowerCase();
  if (!ext || ext.length > MAX_EXT_LEN) return '';
  if (!/^[a-z0-9]+$/.test(ext)) return '';
  return ext;
}

/** Basename without extension, lowercased, bounded — for the log-name heuristic. */
function stemLower(name: unknown): string {
  let s = safeStr(name).trim();
  if (!s) return '';
  if (s.length > MAX_STEM_SCAN) s = s.slice(0, MAX_STEM_SCAN);
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (slash >= 0) s = s.slice(slash + 1);
  const dot = s.lastIndexOf('.');
  if (dot > 0) s = s.slice(0, dot);
  return s.toLowerCase();
}

/** True when a stem carries a standalone `log`/`logs` token (server.log → yes,
 *  catalog → no). Token-based so it never over-matches a substring. */
function looksLikeLogName(stem: string): boolean {
  if (!stem) return false;
  const tokens = stem.split(/[^a-z0-9]+/);
  for (const t of tokens) {
    if (t === 'log' || t === 'logs') return true;
  }
  return false;
}

/** True when the extension marks an app-native binary (forces desktop lane). */
function isAppNativeBinary(name: unknown): boolean {
  const ext = fileExtension(name);
  return !!ext && APP_NATIVE_BINARY_EXT.has(ext);
}

// ─── Secret-safe display name ────────────────────────────────────────────────

/** Code-point array (surrogate-pair safe). */
function codePoints(s: string): string[] {
  return Array.from(s);
}

/**
 * Strip anything unsafe/noisy for a single-line label: C0 controls, DEL, the C1
 * block, line/paragraph separators, the Unicode Tag smuggling block, lone
 * surrogates, and prompt-fence chars (backtick / angle brackets). Iterates by
 * code point so astral chars survive intact.
 */
function sanitizeLabel(input: string): string {
  let out = '';
  for (const ch of input) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp < 0x20 || cp === 0x7f) continue; // C0 + DEL
    if (cp >= 0x80 && cp <= 0x9f) continue; // C1
    if (cp === 0x2028 || cp === 0x2029) continue; // line/para separators
    if (cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogate
    if (cp >= 0xe0000 && cp <= 0xe007f) continue; // Unicode Tag smuggling
    if (ch === '`' || ch === '<' || ch === '>') continue; // prompt-fence
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Bound a name to MAX_NAME_CHARS code points while preserving the extension so
 * a truncated `zzz…zzz.pdf` still reads with its kind. Code-point aware. `ext`
 * is passed in (computed on the fuller pre-bound string) so a name long enough
 * to be front-clipped before sanitizing still recovers its extension.
 */
function boundNamePreservingExt(name: string, ext: string): string {
  const cps = codePoints(name);
  if (cps.length <= MAX_NAME_CHARS) return name;
  const suffix = ext ? `.${ext}` : '';
  const suffixLen = codePoints(suffix).length;
  const headLen = Math.max(0, MAX_NAME_CHARS - suffixLen - 1);
  return `${cps.slice(0, headLen).join('')}…${suffix}`;
}

/**
 * Turn a raw name/path hint into a bounded, control-clean, secret-safe basename
 * with NO ../ traversal. A data-uri (which would carry base64 bytes) collapses
 * to '' rather than echoing its payload.
 */
function safeBasename(name: unknown): string {
  let s = safeStr(name).trim();
  if (!s) return '';
  if (/^data:/i.test(s)) return ''; // never echo data-uri / base64 bytes
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  // Drop the whole path — this removes any ../ traversal segments. (indexOf on a
  // long string is cheap; the per-code-point work below is what we pre-bound.)
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (slash >= 0) s = s.slice(slash + 1);
  s = s.replace(/[.\s]+$/, ''); // Windows trailing dots/spaces
  if (!s) return '';
  // Capture the extension BEFORE the front-bound clip so a very long basename
  // still recovers its kind (the clip would otherwise drop a trailing `.pdf`).
  const ext = fileExtension(s);
  if (s.length > MAX_NAME_SCAN) s = s.slice(0, MAX_NAME_SCAN);
  s = sanitizeLabel(s);
  if (!s) return '';
  return boundNamePreservingExt(s, ext);
}

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify one attachment into a content category. MIME-essence first for the
 * coarse unambiguous buckets (image/audio/video/pdf/archive), then EXTENSION for
 * the fine text-bearing distinctions (code/data/log/document), then a generic
 * text/* fallback → document, else 'unknown'. TOTAL: hostile input → 'unknown'.
 */
export function classifyAttachment(input: AttachmentRouteInput): AttachmentCategory {
  try {
    const mime = mimeEssence(safeGet(input, 'mimeType'));
    const name = safeStr(safeGet(input, 'name'));

    if (mime) {
      if (mime.startsWith('image/')) return 'image';
      if (mime.startsWith('audio/')) return 'audio';
      if (mime.startsWith('video/')) return 'video';
      if (mime === 'application/pdf') return 'document';
      if (ARCHIVE_MIME.has(mime)) return 'archive';
    }

    const ext = fileExtension(name);
    if (ext) {
      if (LOG_EXT.has(ext)) return 'log';
      if (CODE_EXT.has(ext)) return 'code';
      if (DATA_EXT.has(ext)) {
        if (ext === 'ndjson' && looksLikeLogName(stemLower(name))) return 'log';
        return 'data';
      }
      if (DOC_EXT.has(ext)) {
        if ((ext === 'txt' || ext === 'text') && looksLikeLogName(stemLower(name))) return 'log';
        return 'document';
      }
      if (IMAGE_EXT.has(ext)) return 'image';
      if (AUDIO_EXT.has(ext)) return 'audio';
      if (VIDEO_EXT.has(ext)) return 'video';
      if (ARCHIVE_EXT.has(ext)) return 'archive';
    }

    // Generic text with no telling extension → treat as a document.
    if (mime.startsWith('text/')) return 'document';

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Categories whose content is text-bearing and inline/extract eligible. */
function isTextBearing(category: AttachmentCategory): boolean {
  return category === 'code' || category === 'data' || category === 'log' || category === 'document';
}

// ─── Reasons (secret-safe: category/lane enums + human byte size only) ────────

function sizeSuffix(size: number): string {
  const s = formatBytes(size);
  return s ? ` (${s})` : '';
}

function capReason(s: string): string {
  const cps = codePoints(s);
  return cps.length > MAX_REASON_CHARS ? cps.slice(0, MAX_REASON_CHARS).join('') : s;
}

// ─── Per-attachment routing ──────────────────────────────────────────────────

/**
 * Route ONE attachment to a consumption lane. Precedence:
 *   1. app-native binary  → desktop_handoff_candidate (forced, even if the
 *      content category is image/document/data).
 *   2. image              → vision when it fits maxVisionImageBytes, else
 *      reference_only (too big to send as a vision part).
 *   3. text-bearing (code/data/log/document):
 *        - in-hand text within the inline budget → inline_text;
 *        - in-hand text over budget, or file over the extract budget → summarize_oversize;
 *        - no extracted text yet & small → extract_then_inline
 *          (a binary pdf/docx with no text lands here — it needs extraction).
 *   4. archive/audio/video/unknown → reference_only.
 * needsVision === (lane === 'vision'). TOTAL: hostile input → a neutral
 * reference_only route, never a throw. `index` defaults to 0 (planAttachmentRouting
 * supplies the real batch index).
 */
export function routeAttachment(
  input: AttachmentRouteInput,
  opts?: AttachmentRoutingOptions,
  index = 0,
): RoutedAttachment {
  const idx = typeof index === 'number' && Number.isFinite(index) ? index : 0;
  try {
    const rawName = safeGet(input, 'name');
    const rawMime = safeGet(input, 'mimeType');
    const size = coerceBytes(safeGet(input, 'sizeBytes'));
    const hasText = safeGet(input, 'hasExtractedText') === true;
    const textChars = coerceCount(safeGet(input, 'extractedTextChars'));

    const maxInline = coercePositive(safeGet(opts, 'maxInlineTextChars'), DEFAULT_MAX_INLINE_TEXT_CHARS);
    const maxVision = coercePositive(safeGet(opts, 'maxVisionImageBytes'), DEFAULT_MAX_VISION_IMAGE_BYTES);
    const maxExtract = coercePositive(safeGet(opts, 'maxExtractBytes'), DEFAULT_MAX_EXTRACT_BYTES);

    const name = safeBasename(rawName);
    const category = classifyAttachment({ name: safeStr(rawName), mimeType: safeStr(rawMime) });

    let lane: AttachmentRouteLane;
    let reason: string;

    if (isAppNativeBinary(rawName)) {
      lane = 'desktop_handoff_candidate';
      reason = `app-native binary — desktop handoff${sizeSuffix(size)}`;
    } else if (category === 'image') {
      if (size > maxVision) {
        lane = 'reference_only';
        reason = `image over vision size budget — reference only${sizeSuffix(size)}`;
      } else {
        lane = 'vision';
        reason = `image fits the vision budget${sizeSuffix(size)}`;
      }
    } else if (isTextBearing(category)) {
      if (hasText && textChars <= maxInline) {
        lane = 'inline_text';
        reason = `${category} text ready — inline`;
      } else if ((hasText && textChars > maxInline) || size > maxExtract) {
        lane = 'summarize_oversize';
        reason = `${category} over inline budget — summarize${sizeSuffix(size)}`;
      } else {
        lane = 'extract_then_inline';
        reason = `${category} needs text extraction`;
      }
    } else {
      lane = 'reference_only';
      reason = `${category} — reference only${sizeSuffix(size)}`;
    }

    return {
      index: idx,
      name,
      category,
      lane,
      needsVision: lane === 'vision',
      reason: capReason(reason),
    };
  } catch {
    return {
      index: idx,
      name: '',
      category: 'unknown',
      lane: 'reference_only',
      needsVision: false,
      reason: 'reference only',
    };
  }
}

// ─── Fixed-keyset count maps (no dynamic keys → hostile-key safe) ─────────────

function zeroLaneCounts(): Record<AttachmentRouteLane, number> {
  return {
    vision: 0,
    inline_text: 0,
    extract_then_inline: 0,
    summarize_oversize: 0,
    desktop_handoff_candidate: 0,
    reference_only: 0,
  };
}

function zeroCategoryCounts(): Record<AttachmentCategory, number> {
  return {
    image: 0,
    document: 0,
    code: 0,
    data: 0,
    log: 0,
    archive: 0,
    audio: 0,
    video: 0,
    unknown: 0,
  };
}

function emptyPlan(): AttachmentRoutingPlan {
  return {
    items: [],
    visionRequired: false,
    desktopCandidate: false,
    needsTextExtraction: false,
    needsSummarization: false,
    laneCounts: zeroLaneCounts(),
    categoryCounts: zeroCategoryCounts(),
    summary: '',
  };
}

// ─── Count-only summary (secret-safe: never a filename) ──────────────────────

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function buildSummary(lc: Record<AttachmentRouteLane, number>): string {
  const clauses: string[] = [];
  if (lc.vision > 0) clauses.push(`${lc.vision} ${plural(lc.vision, 'image', 'images')} to a vision model`);
  if (lc.inline_text > 0) clauses.push(`${lc.inline_text} text ${plural(lc.inline_text, 'file', 'files')} inline`);
  if (lc.extract_then_inline > 0) {
    clauses.push(`${lc.extract_then_inline} ${plural(lc.extract_then_inline, 'file needs', 'files need')} text extraction`);
  }
  if (lc.summarize_oversize > 0) {
    clauses.push(`${lc.summarize_oversize} oversize ${plural(lc.summarize_oversize, 'file', 'files')} to summarize`);
  }
  if (lc.desktop_handoff_candidate > 0) {
    clauses.push(`${lc.desktop_handoff_candidate} ${plural(lc.desktop_handoff_candidate, 'file', 'files')} for a desktop app`);
  }
  if (lc.reference_only > 0) {
    clauses.push(`${lc.reference_only} ${plural(lc.reference_only, 'file', 'files')} referenced`);
  }
  if (clauses.length === 0) return '';
  const line = `routing ${clauses.join('; ')}`;
  const cps = codePoints(line);
  return cps.length > MAX_SUMMARY_CHARS ? cps.slice(0, MAX_SUMMARY_CHARS).join('') : line;
}

// ─── Batch entry point ───────────────────────────────────────────────────────

/**
 * Route every attachment on a turn into a plan. TOTAL batch entry point:
 * non-array / null / hostile input yields the neutral empty plan (all-zero
 * fixed-keyset counts, empty summary) and never throws. Walks at most
 * MAX_ROUTED_ITEMS elements; laneCounts and categoryCounts each sum to
 * items.length and always carry their full fixed keyset.
 */
export function planAttachmentRouting(
  inputs: unknown,
  opts?: AttachmentRoutingOptions,
): AttachmentRoutingPlan {
  try {
    if (!Array.isArray(inputs)) return emptyPlan();

    let len = 0;
    try {
      len = inputs.length >>> 0;
    } catch {
      len = 0;
    }
    const limit = Math.min(len, MAX_ROUTED_ITEMS);

    const items: RoutedAttachment[] = [];
    const laneCounts = zeroLaneCounts();
    const categoryCounts = zeroCategoryCounts();

    for (let i = 0; i < limit; i += 1) {
      const el = safeIndex(inputs, i);
      const routed = routeAttachment(el as AttachmentRouteInput, opts, i);
      items.push(routed);
      laneCounts[routed.lane] += 1;
      categoryCounts[routed.category] += 1;
    }

    return {
      items,
      visionRequired: laneCounts.vision > 0,
      desktopCandidate: laneCounts.desktop_handoff_candidate > 0,
      needsTextExtraction: laneCounts.extract_then_inline > 0,
      needsSummarization: laneCounts.summarize_oversize > 0,
      laneCounts,
      categoryCounts,
      summary: buildSummary(laneCounts),
    };
  } catch {
    return emptyPlan();
  }
}
