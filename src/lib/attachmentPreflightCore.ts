/**
 * attachmentPreflightCore — pure, dependency-free validation of chat
 * attachments BEFORE they are uploaded/sent, so the user gets one upfront
 * friendly explanation ("that PDF is 41 MB — max is 25 MB") instead of a
 * silent drop or a late upload failure.
 *
 * Wiring target: `sendMessage` in
 * `src/screens/circles/tabs/ChatTab.tsx` — right after it captures
 * `currentAttachments` (ChatAttachment[]) and `currentStagedFiles`
 * (StagedFile[]), map both into AttachmentInput[] and call
 * `preflightAttachments(...)` before any upload/desktop staging. Surface
 * `rejected[].reason` + `warning` to the user and proceed with the accepted
 * subset only. Note field mapping: ChatAttachment uses `size`, StagedFile
 * uses `sizeBytes` — both map onto AttachmentInput.sizeBytes.
 *
 * Purity contract (smoke-tested under tsx/esbuild, which cannot load
 * react-native): zero runtime imports, no side effects at import, no
 * Date.now()/Math.random() at module scope, and every export is TOTAL —
 * null / undefined / wrong-type / hostile / huge input degrades to a safe,
 * bounded, neutral value instead of throwing.
 */

/** One candidate attachment as seen at the pre-send gate. All fields
 *  optional because the caller normalizes from heterogeneous sources. */
export interface AttachmentInput {
  name?: string;
  sizeBytes?: number;
  mimeType?: string;
}

/** Result of a pre-send validation pass. `ok` is true only when at least
 *  one file is safe to send. `rejected` explains, per skipped file, why —
 *  in human copy. `warning` is a single-line batch summary or null. */
export interface AttachmentPreflight {
  ok: boolean;
  acceptedCount: number;
  rejected: Array<{ name: string; reason: string }>;
  warning: string | null;
}

/** Options with the same defaults the exported constants describe. */
export interface PreflightOptions {
  maxCount?: number;
  maxBytesPerFile?: number;
  maxTotalBytes?: number;
}

// ── Public defaults ─────────────────────────────────────────────────────
export const DEFAULT_MAX_ATTACHMENTS = 10;
export const DEFAULT_MAX_BYTES_PER_FILE = 25 * 1024 * 1024; // 25 MB
export const DEFAULT_MAX_TOTAL_BYTES = 60 * 1024 * 1024; // 60 MB

// ── Internal bounds (keep output bounded on hostile input) ──────────────
/** Max input elements walked; anything past this is counted as skipped. */
const MAX_PREFLIGHT_ITEMS = 1000;
/** Max individual {name, reason} entries returned; the rest are summarized
 *  in `warning` via the running skipped count. */
const MAX_REPORTED_REJECTIONS = 25;
/** Sane ceiling for a caller-supplied maxCount. */
const MAX_COUNT_CAP = 1000;
/** Displayed file names are trimmed to this length. */
const MAX_NAME_CHARS = 120;
/** Byte values are clamped to this before formatting/summing. */
const MAX_BYTES_CLAMP = Number.MAX_SAFE_INTEGER;

/**
 * Executable / native-binary / script extensions that must never be sent
 * as chat attachments. Includes the explicitly-required .exe/.dll/.app/.sh
 * plus the well-known dangerous siblings. Extension match is the primary
 * signal; MIME is a secondary backstop below.
 */
export const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe', 'dll', 'app', 'sh', 'bat', 'cmd', 'com', 'msi', 'scr', 'vbs',
  'vbe', 'jar', 'apk', 'deb', 'dmg', 'pkg', 'dylib', 'so', 'ps1', 'jse',
]);

/** Secondary MIME backstop for the same executable/script family. */
const DANGEROUS_MIME: ReadonlySet<string> = new Set([
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-ms-installer',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-executable',
  'application/vnd.microsoft.portable-executable',
  'application/x-mach-binary',
  'application/x-apple-diskimage',
]);

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'oga']);

/** Round to one decimal, then drop a trailing ".0" so integers read clean. */
function trimNum(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/**
 * Human-readable byte size, e.g. "512 KB", "1.5 MB", "41 MB", "2 GB".
 * TOTAL: non-numeric / NaN / negative / Infinity → "0 B". Numeric strings
 * are tolerated ("1048576" → "1 MB").
 */
export function formatBytes(n: unknown): string {
  let bytes: number;
  if (typeof n === 'number' && Number.isFinite(n)) {
    bytes = n;
  } else if (typeof n === 'string') {
    const parsed = Number(n.trim());
    bytes = Number.isFinite(parsed) ? parsed : 0;
  } else {
    bytes = 0;
  }
  if (!(bytes > 0)) return '0 B'; // NaN, 0, negative
  if (bytes > MAX_BYTES_CLAMP) bytes = MAX_BYTES_CLAMP;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${trimNum(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${trimNum(mb)} MB`;
  const gb = mb / 1024;
  return `${trimNum(gb)} GB`;
}

/** Lower-cased file extension (no dot), or '' when there is none. Handles
 *  paths, query/hash suffixes, and dotfiles. Total on any input. */
function fileExtension(name: unknown): string {
  if (typeof name !== 'string') return '';
  let s = name.trim();
  if (!s) return '';
  const cut = s.search(/[?#]/);
  if (cut >= 0) s = s.slice(0, cut);
  const slash = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  if (slash >= 0) s = s.slice(slash + 1);
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return ''; // no dot, or leading-dot dotfile (".bashrc")
  const ext = s.slice(dot + 1).toLowerCase();
  if (!ext || ext.length > 12) return '';
  if (!/^[a-z0-9]+$/.test(ext)) return '';
  return ext;
}

/** Normalized MIME essence: lower-cased, parameters stripped, or ''. */
function mimeEssence(mime: unknown): string {
  if (typeof mime !== 'string') return '';
  const first = mime.split(';')[0];
  return first ? first.trim().toLowerCase() : '';
}

/** Would-block executable / script / native-binary detection. */
function isDangerous(name: unknown, mime: unknown): boolean {
  const ext = fileExtension(name);
  if (ext && DANGEROUS_EXTENSIONS.has(ext)) return true;
  const m = mimeEssence(mime);
  if (m && DANGEROUS_MIME.has(m)) return true;
  return false;
}

/** Friendly noun for a file, used in the oversize reason copy. */
function nounFor(name: unknown, mime: unknown): string {
  const ext = fileExtension(name);
  const m = mimeEssence(mime);
  if (ext === 'pdf' || m === 'application/pdf') return 'PDF';
  if (m.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (m.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (m.startsWith('audio/') || AUDIO_EXTENSIONS.has(ext)) return 'audio file';
  return 'file';
}

interface NormalizedItem {
  name: string;
  size: number;
  mime: string;
  hasSize: boolean;
}

/** Project one raw element to a safe normalized item. Never throws — even a
 *  throwing getter / revoked proxy degrades to empty/neutral fields. */
function normalizeItem(raw: unknown): NormalizedItem {
  let name: unknown;
  let size: unknown;
  let mime: unknown;
  try {
    if (raw !== null && (typeof raw === 'object' || typeof raw === 'function')) {
      const rec = raw as Record<string, unknown>;
      name = rec.name;
      size = rec.sizeBytes;
      mime = rec.mimeType;
    }
  } catch {
    // adversarial getter/proxy — leave fields undefined
  }
  // Bound the display name to MAX_NAME_CHARS, but PRESERVE the extension —
  // a naive head-slice on a very long name (e.g. `zzz…zzz.exe`) would cut off
  // `.exe`, so the dangerous-extension check would miss it. Keep head + ext.
  const rawName = typeof name === 'string' ? name.trim() : '';
  let nm = rawName;
  if (rawName.length > MAX_NAME_CHARS) {
    const ext = fileExtension(rawName);
    const suffix = ext ? `.${ext}` : '';
    const headLen = Math.max(0, MAX_NAME_CHARS - suffix.length - 1);
    nm = `${rawName.slice(0, headLen)}…${suffix}`;
  }
  let sz = 0;
  let hasSize = false;
  if (typeof size === 'number' && Number.isFinite(size) && size >= 0) {
    sz = size > MAX_BYTES_CLAMP ? MAX_BYTES_CLAMP : size;
    hasSize = true;
  }
  const mt = typeof mime === 'string' ? mime.trim().slice(0, 200) : '';
  return { name: nm, size: sz, mime: mt, hasSize };
}

function sanitizeCount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 1) {
    return Math.min(Math.floor(v), MAX_COUNT_CAP);
  }
  return DEFAULT_MAX_ATTACHMENTS;
}

function sanitizeBytes(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return Math.min(v, MAX_BYTES_CLAMP);
  }
  return fallback;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function buildWarning(accepted: number, skipped: number, total: number): string | null {
  if (total <= 0) return null;
  if (accepted === 0) {
    return total === 1 ? "That file couldn't be attached." : 'None of these files could be attached.';
  }
  if (skipped > 0) {
    return `Sending ${plural(accepted, 'file')}; skipped ${skipped}.`;
  }
  return null;
}

/**
 * Validate a batch of candidate attachments before send.
 *
 * Rules (each file evaluated in order; first failure wins):
 *   1. dangerous/executable type (.exe/.dll/.app/.sh …) → rejected;
 *   2. size > maxBytesPerFile (default 25 MB) → rejected with a human size
 *      reason ("that PDF is 41 MB — max is 25 MB");
 *   3. more than maxCount (default 10) already accepted → rejected;
 *   4. would push the batch over maxTotalBytes (default 60 MB) → rejected.
 * Files with an unknown size are size-tolerated (never rejected for size and
 * consume no total budget).
 *
 * `ok` is true only when at least one file is accepted (and, implicitly,
 * there is no state that blocks the whole batch). Empty / non-array / hostile
 * input yields the neutral `{ ok:false, acceptedCount:0, rejected:[],
 * warning:null }`. Output is bounded: at most MAX_REPORTED_REJECTIONS
 * detailed entries, with the remainder summarized in `warning`.
 */
export function preflightAttachments(items: unknown, opts?: PreflightOptions): AttachmentPreflight {
  try {
    const maxCount = sanitizeCount(opts ? opts.maxCount : undefined);
    const maxPerFile = sanitizeBytes(opts ? opts.maxBytesPerFile : undefined, DEFAULT_MAX_BYTES_PER_FILE);
    const maxTotal = sanitizeBytes(opts ? opts.maxTotalBytes : undefined, DEFAULT_MAX_TOTAL_BYTES);

    if (!Array.isArray(items) || items.length === 0) {
      return { ok: false, acceptedCount: 0, rejected: [], warning: null };
    }

    const total = items.length;
    const limit = Math.min(total, MAX_PREFLIGHT_ITEMS);
    const rejected: Array<{ name: string; reason: string }> = [];
    let skipped = 0;
    let acceptedCount = 0;
    let runningTotal = 0;

    const reject = (name: string, reason: string): void => {
      skipped += 1;
      if (rejected.length < MAX_REPORTED_REJECTIONS) rejected.push({ name, reason });
    };

    for (let i = 0; i < limit; i += 1) {
      const it = normalizeItem(items[i]);
      const display = it.name || 'unnamed file';

      // Junk entry with nothing to validate (no name, no size, no type):
      // skip transparently instead of admitting an empty attachment.
      if (!it.name && !it.hasSize && !it.mime) {
        reject(display, 'empty or unreadable attachment');
        continue;
      }
      if (isDangerous(it.name, it.mime)) {
        const ext = fileExtension(it.name);
        reject(
          display,
          ext && DANGEROUS_EXTENSIONS.has(ext)
            ? `.${ext} files can't be attached for security`
            : "that file type can't be attached for security",
        );
        continue;
      }
      if (it.hasSize && it.size > maxPerFile) {
        reject(display, `that ${nounFor(it.name, it.mime)} is ${formatBytes(it.size)} — max is ${formatBytes(maxPerFile)}`);
        continue;
      }
      if (acceptedCount >= maxCount) {
        reject(display, `too many files — max is ${maxCount} at once`);
        continue;
      }
      if (runningTotal + it.size > maxTotal) {
        reject(display, `skipped to keep this batch under ${formatBytes(maxTotal)}`);
        continue;
      }
      acceptedCount += 1;
      runningTotal += it.size;
    }

    // Elements past the processing cap are effectively skipped too.
    const truncated = total - limit;
    if (truncated > 0) skipped += truncated;

    return {
      ok: acceptedCount >= 1,
      acceptedCount,
      rejected,
      warning: buildWarning(acceptedCount, skipped, total),
    };
  } catch {
    // Totality backstop (e.g. revoked-proxy Array.isArray) — neutral value.
    return { ok: false, acceptedCount: 0, rejected: [], warning: null };
  }
}
