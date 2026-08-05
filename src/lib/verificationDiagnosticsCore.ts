// verificationDiagnosticsCore — the PURE compiler/linter/test diagnostic
// extractor that stops the model from going BLIND when a `verification.*` tool
// fails. openswanToolRuntime.ts's verification-failure branch currently returns
// `error || stderr || 'Verification failed.'` and DROPS `stdout` — but tsc,
// eslint, jest/vitest, and pytest all print their real diagnostics to stdout.
// The model is told "it failed" without a single line of WHY. This core parses
// that captured output into structured `Diagnostic`s and renders a compact,
// error-biased, bounded, secret-safe summary the failure branch can route
// through instead of throwing the diagnostics away.
//
// It recognizes the four toolchains that back the pinned verification commands:
//   • tsc      "src/x.ts(12,5): error TS2304: Cannot find name 'foo'."
//   • eslint   stylish (file header + "  L:C  sev  msg  rule") AND single-line
//              ("/path:12:5 error msg rule")
//   • jest/vitest  "FAIL src/a.test.ts", "✕ test name", "● test name"
//   • python   Traceback frames + terminal "ExceptionType: message", plus
//              pytest "FAILED path::test - message" summary lines
//
// PURITY: zero runtime imports, tsx-loadable (smoke: verification-diagnostics-
// core). No Date/Math.random anywhere. Deterministic: same input → same output.
// Every export is TOTAL — null / undefined / wrong-type / gigantic / hostile /
// ReDoS-shaped input never throws; it returns a safe neutral value ([] / '' /
// {errors:0,warnings:0}). Output is bounded on every axis (item count, per-line
// length, total chars) and every emitted message is run through an inline
// secret redactor, because test/traceback output can echo credential values.

/** Structured single diagnostic distilled from tool output. */
export interface Diagnostic {
  /** Source file the diagnostic points at (absent for file-less errors). */
  file?: string;
  /** 1-based line number, when the toolchain reported one. */
  line?: number;
  /** 1-based column number, when the toolchain reported one. */
  col?: number;
  /** Machine code / rule / exception type, e.g. TS2304, no-undef, ValueError. */
  code?: string;
  /** Human-readable message (trimmed, per-line capped, secret-redacted). */
  message: string;
  /** Severity bucket — everything that is not an explicit warning is an error. */
  severity: 'error' | 'warning';
}

/** Hard cap on diagnostics returned by parseDiagnostics (bounded output). */
export const MAX_DIAGNOSTICS = 50;
/** Default number of diagnostic lines rendered by summarizeDiagnostics. */
export const DEFAULT_SUMMARY_MAX_ITEMS = 20;
/** Default character budget for the summarizeDiagnostics string. */
export const DEFAULT_SUMMARY_MAX_CHARS = 2000;

// Internal safety ceilings — keep work + output bounded on hostile input.
const MAX_RAW_CHARS = 4_000_000; // slice the raw blob before splitting into lines
const MAX_SCAN_LINES = 50_000; // never scan more lines than this
const MAX_SCAN_MATCHES = 1_000; // stop collecting after this many diagnostics
const MAX_LINE_CHARS = 2_000; // slice any single line before regex (ReDoS guard)
const MAX_MESSAGE_CHARS = 240; // per-diagnostic message cap
const FALLBACK_TAIL_LINES = 12; // lines kept in the no-diagnostics fallback tail
const FALLBACK_TAIL_CHARS = 800; // char budget for the fallback tail

// ── Matchers (module-scope constants; no runtime state) ─────────────────────

// tsc: `src/x.ts(12,5): error TS2304: message`  (column optional).
const TSC_RE = /^\s*(\S.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning)\s+(TS\d+)\s*:\s*(.*)$/i;
// tsc file-less: `error TS18003: No inputs were found...`.
const TSC_GENERAL_RE = /^\s*(error|warning)\s+(TS\d+)\s*:\s*(.*)$/i;
// eslint single-line (unix/compact-ish): `/path/file.js:12:5 error msg rule`.
const ESLINT_LINE_RE = /^\s*((?:[A-Za-z]:)?[^\s:]+):(\d+):(\d+):?\s+(error|warning)\s+(.+)$/i;
// eslint stylish row (indented): `  12:5  error  message  rule` (rule optional).
const ESLINT_ROW_RE = /^\s+(\d+):(\d+)\s+(error|warning)\s+(.+?)(?:\s{2,}([@\w][\w./-]*))?\s*$/i;
// eslint stylish file header — a line that is ONLY a code-ish path.
const PATH_ONLY_RE = /^(?:[A-Za-z]:)?[\w.\-/\\]+\.(?:tsx?|jsx?|mjs|cjs|vue|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|css|scss|sass|less|json|ya?ml|md|txt|sh)$/i;
// python traceback frame: `File "path", line 12, in fn`.
const PY_FRAME_RE = /^\s*File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+.*)?$/;
// pytest short-traceback frame: `src/test_foo.py:12: in test_bar`.
const PYTEST_FRAME_RE = /^\s*(\S+\.py):(\d+):\s+in\s+\S+/;
// python terminal exception: `ValueError: bad value` (gated on being in a trace).
const PY_EXC_RE = /^([A-Za-z_][\w.]*(?:Error|Exception|Warning)|KeyboardInterrupt|StopIteration|StopAsyncIteration|SystemExit|GeneratorExit):\s?(.*)$/;
// python traceback header.
const PY_TRACE_HEAD_RE = /^Traceback \(most recent call last\):/;
// pytest failure summary: `FAILED src/test_foo.py::test_bar - assert 0 == 1`.
const PYTEST_FAILED_RE = /^\s*FAILED\s+(\S+?)(?:::(\S+))?(?:\s+-\s+(.*))?$/;
// jest/vitest failing file: `FAIL src/a.test.ts [> suite > test]`.
const JEST_FAIL_RE = /^\s*FAIL\s+(\S+\.[A-Za-z][\w.]*?)(?:\s*[>›»]\s*(.*))?$/;
// jest failing-test bullet: `✕ adds numbers (3 ms)` / `✗` / `×` / `● test name`.
const TEST_BULLET_RE = /^\s*[✕✗×●•]\s+(.+?)(?:\s+\(\d+\s*m?s\))?$/;

// Inline secret redactor — verification stdout (esp. tracebacks / test asserts)
// can echo credential values. Bias hard toward masking; each pass is wrapped so
// a pathological input can never make redaction throw.
const REDACTIONS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_KEY]'],
  [/eyJ[A-Za-z0-9_-]{6,}\.eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, '[REDACTED_JWT]'],
  [/sk-ant-[A-Za-z0-9\-_]{16,}/g, '[REDACTED_KEY]'],
  [/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]'],
  [/github_pat_[A-Za-z0-9_]{40,}/g, '[REDACTED_TOKEN]'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED_TOKEN]'],
  [/AKIA[0-9A-Z]{16}/g, '[REDACTED_AWS_KEY]'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED_TOKEN]'],
  [/Bearer\s+[A-Za-z0-9._\-]{16,}/g, 'Bearer [REDACTED]'],
  [/(:\/\/[^\s:@/]+:)[^\s:@/]+(@)/g, '$1[REDACTED]$2'],
  [/((?:api[_-]?key|secret|password|passwd|token)["'\s:=]{1,4})[A-Za-z0-9\-_./+]{12,}/gi, '$1[REDACTED]'],
];

function redact(input: string): string {
  let out = input;
  for (const [re, rep] of REDACTIONS) {
    try {
      out = out.replace(re, rep);
    } catch {
      // A single pathological pattern/input must never break redaction — the
      // invariant is "don't leak", so skip this detector and keep the rest.
    }
  }
  return out;
}

// ── Small total helpers ─────────────────────────────────────────────────────

function coerceStr(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of ['stdout', 'stderr', 'output', 'message', 'text']) {
      const v = o[key];
      if (typeof v === 'string' && v.length > 0) parts.push(v);
    }
    if (parts.length > 0) return parts.join('\n');
    return '';
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return '';
}

function toInt(s: string | undefined): number | undefined {
  if (typeof s !== 'string' || s === '') return undefined;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

function toSeverity(token: string): 'error' | 'warning' {
  return /warn/i.test(token) ? 'warning' : 'error';
}

function toMessage(s: string): string {
  const trimmed = (typeof s === 'string' ? s : '').trim();
  const capped = trimmed.length > MAX_MESSAGE_CHARS ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…` : trimmed;
  return redact(capped);
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Peel a trailing eslint rule id off a single-line message. Only a token that
 * carries a `-` or `/` (rule shapes such as `no-undef`,
 * `@typescript-eslint/no-explicit-any`) is treated as a rule — a bare trailing
 * word is left in the message so ordinary prose is never mangled.
 */
function splitEslintRule(rest: string): { message: string; code?: string } {
  const r = (rest || '').trim();
  const idx = r.lastIndexOf(' ');
  if (idx > 0) {
    const cand = r.slice(idx + 1);
    const head = r.slice(0, idx).trim();
    if (head.length > 0 && /[-/]/.test(cand) && /^(?:@[\w-]+\/)?[\w-]+(?:\/[\w-]+)*$/.test(cand)) {
      return { message: head, code: cand };
    }
  }
  return { message: r };
}

// ── Core scan ───────────────────────────────────────────────────────────────

interface ScanResult {
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  truncated: boolean;
}

function emptyScan(): ScanResult {
  return { diagnostics: [], errors: 0, warnings: 0, truncated: false };
}

/**
 * Single internal pass over the captured output. Line-oriented with a tiny bit
 * of state (current eslint file header, pending python frame / in-traceback
 * flag). Every branch is bounded; collection stops at MAX_SCAN_MATCHES and
 * scanning stops at MAX_SCAN_LINES. Wrapped by public callers in try/catch.
 */
function scan(raw: unknown): ScanResult {
  const text = coerceStr(raw);
  if (text === '') return emptyScan();

  const capped = text.length > MAX_RAW_CHARS ? text.slice(0, MAX_RAW_CHARS) : text;
  const allLines = capped.split(/\r?\n/);
  const lineCount = Math.min(allLines.length, MAX_SCAN_LINES);
  let truncated = allLines.length > MAX_SCAN_LINES || text.length > MAX_RAW_CHARS;

  const diagnostics: Diagnostic[] = [];
  let eslintFile: string | null = null;
  let pyFrame: { file: string; line: number | undefined } | null = null;
  let inPyTrace = false;

  const push = (d: Diagnostic): boolean => {
    if (diagnostics.length >= MAX_SCAN_MATCHES) {
      truncated = true;
      return false;
    }
    diagnostics.push(d);
    return true;
  };

  for (let i = 0; i < lineCount; i += 1) {
    if (diagnostics.length >= MAX_SCAN_MATCHES) {
      truncated = true;
      break;
    }
    const rawLine = allLines[i];
    if (typeof rawLine !== 'string') continue;
    const line = rawLine.length > MAX_LINE_CHARS ? rawLine.slice(0, MAX_LINE_CHARS) : rawLine;
    const trimmed = line.trim();

    // 1) tsc with file/line/col.
    let m = TSC_RE.exec(line);
    if (m) {
      push({
        file: m[1].trim(),
        line: toInt(m[2]),
        col: toInt(m[3]),
        code: m[5].toUpperCase(),
        message: toMessage(m[6]),
        severity: toSeverity(m[4]),
      });
      eslintFile = null;
      continue;
    }

    // 2) tsc file-less general error.
    m = TSC_GENERAL_RE.exec(line);
    if (m) {
      push({ code: m[2].toUpperCase(), message: toMessage(m[3]), severity: toSeverity(m[1]) });
      continue;
    }

    // 3) eslint single-line.
    m = ESLINT_LINE_RE.exec(line);
    if (m) {
      const { message, code } = splitEslintRule(m[5]);
      push({
        file: m[1],
        line: toInt(m[2]),
        col: toInt(m[3]),
        code,
        message: toMessage(message),
        severity: toSeverity(m[4]),
      });
      continue;
    }

    // 4) eslint stylish row (needs a current file header).
    m = ESLINT_ROW_RE.exec(line);
    if (m && eslintFile) {
      push({
        file: eslintFile,
        line: toInt(m[1]),
        col: toInt(m[2]),
        code: m[5] || undefined,
        message: toMessage(m[4]),
        severity: toSeverity(m[3]),
      });
      continue;
    }

    // 5) python traceback frame (standard + pytest short form).
    m = PY_FRAME_RE.exec(line);
    if (m) {
      pyFrame = { file: m[1], line: toInt(m[2]) };
      inPyTrace = true;
      continue;
    }
    m = PYTEST_FRAME_RE.exec(line);
    if (m) {
      pyFrame = { file: m[1], line: toInt(m[2]) };
      inPyTrace = true;
      continue;
    }

    // 6) python traceback header.
    if (PY_TRACE_HEAD_RE.test(line)) {
      inPyTrace = true;
      pyFrame = null;
      continue;
    }

    // 7) python terminal exception (only while inside a traceback).
    m = PY_EXC_RE.exec(line);
    if (m && inPyTrace) {
      push({
        file: pyFrame ? pyFrame.file : undefined,
        line: pyFrame ? pyFrame.line : undefined,
        code: m[1],
        message: toMessage(m[2] || m[1]),
        severity: 'error',
      });
      inPyTrace = false;
      pyFrame = null;
      continue;
    }

    // 8) pytest FAILED summary line.
    m = PYTEST_FAILED_RE.exec(line);
    if (m) {
      const testName = m[2] ? m[2] : '';
      const detail = m[3] ? m[3] : '';
      const composed = [testName, detail ? `— ${detail}` : ''].filter((p) => p.length > 0).join(' ');
      push({ file: m[1], message: toMessage(composed || 'test failed'), severity: 'error' });
      continue;
    }

    // 9) jest/vitest FAIL <file>.
    m = JEST_FAIL_RE.exec(line);
    if (m) {
      push({ file: m[1], message: toMessage(m[2] ? m[2] : 'test file failed'), severity: 'error' });
      continue;
    }

    // 10) jest failing-test bullet.
    m = TEST_BULLET_RE.exec(line);
    if (m) {
      push({ message: toMessage(m[1]), severity: 'error' });
      continue;
    }

    // 11) eslint stylish file header (path-only line).
    if (PATH_ONLY_RE.test(trimmed)) {
      eslintFile = trimmed;
      continue;
    }

    // A blank line ends a stylish file block — drop the header so rows can't
    // bleed across files.
    if (trimmed === '') eslintFile = null;
  }

  let errors = 0;
  let warnings = 0;
  for (const d of diagnostics) {
    if (d.severity === 'warning') warnings += 1;
    else errors += 1;
  }
  return { diagnostics, errors, warnings, truncated };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse captured verification output (tsc / eslint / jest / vitest / pytest /
 * python traceback) into structured diagnostics, in source order, capped at
 * MAX_DIAGNOSTICS. Accepts a raw string or, leniently, the whole verification
 * result object (reads its stdout/stderr/output/message/text). Non-parseable,
 * empty, or wrong-type input yields []. Never throws.
 */
export function parseDiagnostics(raw: unknown): Diagnostic[] {
  try {
    return scan(raw).diagnostics.slice(0, MAX_DIAGNOSTICS);
  } catch {
    return [];
  }
}

/**
 * Count diagnostics by severity across the whole scan (up to the internal
 * ceiling, so totals can exceed the MAX_DIAGNOSTICS display cap). Never throws.
 */
export function countDiagnostics(raw: unknown): { errors: number; warnings: number } {
  try {
    const s = scan(raw);
    return { errors: s.errors, warnings: s.warnings };
  } catch {
    return { errors: 0, warnings: 0 };
  }
}

function formatDiagnosticLine(d: Diagnostic): string {
  const parts: string[] = [];
  if (d.severity === 'warning') parts.push('warn');
  if (d.file) {
    let loc = d.file;
    if (typeof d.line === 'number') {
      loc += `:${d.line}`;
      if (typeof d.col === 'number') loc += `:${d.col}`;
    }
    parts.push(loc);
  }
  if (d.code) parts.push(d.code);
  if (d.message) parts.push(d.message);
  const line = parts.join(' ');
  return line.length > MAX_MESSAGE_CHARS + 80 ? line.slice(0, MAX_MESSAGE_CHARS + 80) : line;
}

/**
 * When nothing parsed but there IS output, hand the model a small, redacted,
 * bounded tail of the last non-empty lines rather than leaving it blind. This
 * is never a raw dump — it is capped by line count and total characters and
 * secret-redacted.
 */
function fallbackTail(text: string, maxChars: number): string {
  const budget = Math.min(maxChars, FALLBACK_TAIL_CHARS);
  const capped = text.length > MAX_RAW_CHARS ? text.slice(0, MAX_RAW_CHARS) : text;
  const lines = capped.split(/\r?\n/);
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < FALLBACK_TAIL_LINES; i -= 1) {
    const src = lines[i];
    if (typeof src !== 'string') continue;
    if (src.trim() === '') continue;
    const clipped = src.length > MAX_LINE_CHARS ? src.slice(0, MAX_LINE_CHARS) : src;
    const rendered = toMessage(clipped);
    if (rendered === '') continue;
    if (used + rendered.length + 1 > budget) break;
    kept.unshift(rendered);
    used += rendered.length + 1;
  }
  if (kept.length === 0) return '';
  return `[no structured diagnostics parsed; last output]\n${kept.join('\n')}`;
}

/**
 * Compact, error-biased, bounded, secret-safe summary suitable for dropping
 * into the model context on a verification failure. Errors are listed before
 * warnings; the header carries the true totals. Bounded by `maxItems` (default
 * DEFAULT_SUMMARY_MAX_ITEMS) and `maxChars` (default DEFAULT_SUMMARY_MAX_CHARS).
 * Empty / wrong-type input → ''. Non-parseable-but-nonempty input → a redacted,
 * bounded tail. Never a raw dump. Never throws.
 */
export function summarizeDiagnostics(
  raw: unknown,
  opts?: { maxChars?: number; maxItems?: number },
): string {
  try {
    const maxItems = clampInt(opts ? opts.maxItems : undefined, DEFAULT_SUMMARY_MAX_ITEMS, 1, 200);
    const maxChars = clampInt(opts ? opts.maxChars : undefined, DEFAULT_SUMMARY_MAX_CHARS, 80, 20_000);
    const text = coerceStr(raw);
    if (text.trim() === '') return '';

    const s = scan(text);
    if (s.diagnostics.length === 0) {
      const tail = fallbackTail(text, maxChars);
      return tail.length > maxChars ? tail.slice(0, maxChars) : tail;
    }

    // Error-biased stable ordering: errors first, warnings after, each in the
    // order they were collected (manual partition — never relies on sort).
    const ordered: Diagnostic[] = [];
    for (const d of s.diagnostics) if (d.severity === 'error') ordered.push(d);
    for (const d of s.diagnostics) if (d.severity === 'warning') ordered.push(d);

    const header =
      `${s.errors} error${s.errors === 1 ? '' : 's'}, ` +
      `${s.warnings} warning${s.warnings === 1 ? '' : 's'}` +
      (s.truncated ? '+' : '') +
      (ordered.length > maxItems ? ` (showing first ${maxItems})` : '') +
      ':';

    const out: string[] = [header];
    let used = header.length;
    let rendered = 0;
    for (const d of ordered) {
      if (rendered >= maxItems) break;
      const line = formatDiagnosticLine(d);
      if (used + line.length + 1 > maxChars) break;
      out.push(line);
      used += line.length + 1;
      rendered += 1;
    }
    const remaining = ordered.length - rendered;
    if (remaining > 0 && used + 16 <= maxChars) out.push(`… (+${remaining} more)`);

    const composed = out.join('\n');
    const bounded = composed.length > maxChars ? composed.slice(0, maxChars) : composed;
    return redact(bounded);
  } catch {
    return '';
  }
}
