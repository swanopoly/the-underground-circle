// acrobatScriptAdapter — PURE generator that turns a bounded op request into a
// validated Adobe Acrobat automation payload for the macOS AppleScript hook
// `tell application "Adobe Acrobat" ... do script <js>`, which runs a snippet
// inside Acrobat's PRIVILEGED JavaScript context (docs/apps/acrobat.md control
// surface #1: "Acrobat JavaScript API ... On macOS Acrobat's AppleScript
// dictionary can execute JavaScript (`do script`)"). This is the top-ranked
// external-drive surface, so it is the one encoded here.
//
// VERIFY (web-checked against current official Adobe docs 2026-07, but NOT run
// against a live Acrobat Pro install — `verifiedInvocation: false`):
//   - The `do script` AppleScript verb + that it runs in a privileged context
//     (batch/console-equivalent) so `saveAs`/`insertPages`/`extractPages` with a
//     cPath are allowed. Source: Adobe DC SDK jsapiref + macOS IAC dictionary.
//   - `Doc.insertPages(nPage, cPath, nStart, nEnd)` for combine (there is NO
//     `app.combinePDFs` — that name is a common hallucination; the real path is
//     app.newDoc() then a series of insertPages calls then saveAs).
//   - `Doc.saveAs(cPath, cConvID, ...)` with `com.adobe.acrobat.docx` /
//     `com.adobe.acrobat.xlsx` conversion IDs for Office export. cConvID values
//     vary by Acrobat version and older ones are being deprecated — a live
//     install MUST confirm the exact registered ID before wiring.
//   - `Doc.flattenPages(nStart, nEnd, nNonPrint)` (Acrobat Pro-only, PRIVILEGED,
//     IRREVERSIBLE — erases annotations + JavaScript).
//   - `Doc.extractPages(nStart, nEnd, cPath)` for split (0-based, cPath needs a
//     privileged context; Acrobat cannot create folders, so the target dir must
//     already exist).
// DELIBERATELY OMITTED: OCR. There is NO documented Acrobat JavaScript OCR
// method (`OCRTextEx` and friends do not exist in the DOM); OCR via JS only
// works through fragile `PaperCapture`/menu hacks. Encoding a made-up OCR call
// is exactly the wrong-syntax trap this adapter avoids — OCR stays a cloud
// PDF-Services / buildout concern (see docs/apps/acrobat.md gaps).
//
// This module is the PURE generator ONLY: it is NOT wired to any tool or bridge,
// never touches the filesystem, never runs osascript, and never resolves a
// binary. Acrobat is NOT in any engine/tool registry — the descriptor a future
// wiring commit would add is reported in the task summary and gap constant.
//
// PURITY: zero runtime imports (`import type` only, and none are needed), so
// `npx tsx scripts/acrobat-script-adapter-smoketest.ts` loads it directly.
//
// SECURITY (mirrors src/lib/mayaScriptAdapter.ts / cadCodeExecutor.ts exactly):
// every user value — input/output PDF path, output Office/Text path, conversion
// format, page range integers — is allowlist-validated FIRST. Strings are then
// embedded ONLY as escaped literals. There is a DOUBLE embedding here that Maya
// (single-language Python) does not have: the generated JavaScript is itself
// carried inside an AppleScript string passed to `do script`. So a path travels
// user -> `jsStringLiteral` (a JS string literal, pure ASCII via \uXXXX) ->
// `appleScriptStringLiteral` wraps the whole JS blob for the AppleScript layer.
// Paths pass a validateCadPath-style check (length / control-char /
// shell-metachar / BMP / traversal) BEFORE either escaper, so quotes,
// backslashes, and the AppleScript `\` / `"` metacharacters can never break out
// of either layer. Page ranges are bounded non-negative integers emitted as
// digits only. On any validation failure the builder DROPS the request with an
// explanatory note and a fail-closed stub — it never throws and never emits a
// half-validated mutation.
//
// APPROVAL/PROOF (docs/apps/acrobat.md approval rules): combine/split/export
// WRITE files and flatten is IRREVERSIBLE + destroys signatures, so the wiring
// layer must approval-gate them and verify each output with desktop.file_stat
// (+ page-count/text-sample proof) after the run. Scripts NEVER save over the
// source PDF. Redaction, signature, and form submission are explicitly out of
// scope here and remain human actions.

// ── Operations ─────────────────────────────────────────────────────────────

export type AcrobatOperation = 'combine_pdfs' | 'export_to_office' | 'flatten_pdf' | 'extract_pages';

export const ACROBAT_OPERATIONS: readonly AcrobatOperation[] = [
  'combine_pdfs',
  'export_to_office',
  'flatten_pdf',
  'extract_pages',
] as const;

/** Office/text export targets — each maps to a VERIFY-marked Acrobat cConvID. */
export type AcrobatExportFormat = 'docx' | 'xlsx' | 'rtf' | 'txt';

export const ACROBAT_EXPORT_FORMATS: readonly AcrobatExportFormat[] = ['docx', 'xlsx', 'rtf', 'txt'] as const;

/** File extension produced per export format. */
const ACROBAT_EXPORT_EXTENSION: Record<AcrobatExportFormat, string> = {
  docx: 'docx',
  xlsx: 'xlsx',
  rtf: 'rtf',
  txt: 'txt',
};

/**
 * Acrobat `Doc.saveAs` conversion-ID (`cConvID`) per export format. // VERIFY:
 * these follow the documented `com.adobe.acrobat.*` naming and match current
 * Adobe examples, but the registered IDs CHANGE BETWEEN ACROBAT VERSIONS and
 * older IDs are being deprecated. A live Acrobat Pro install must confirm the
 * exact string (run the console listing described at pdfscripting.com) before
 * this is trusted. These are constants embedded verbatim by the builder — they
 * are never derived from user input.
 */
export const ACROBAT_EXPORT_CONV_ID: Record<AcrobatExportFormat, string> = {
  docx: 'com.adobe.acrobat.docx',
  xlsx: 'com.adobe.acrobat.xlsx',
  rtf: 'com.adobe.acrobat.rtf',
  // Plain-text export id has varied ("com.adobe.acrobat.plain-text" in some
  // builds, "...accesstext" in others). // VERIFY on a live install.
  txt: 'com.adobe.acrobat.plain-text',
};

/** PDF is the only accepted INPUT container across every op. */
const ACROBAT_PDF_EXTENSIONS: readonly string[] = ['pdf'];

// Page-range bounds: non-negative 0-based page indices within a generous cap.
// Keeps the emitted integer literals small and finite (no exponent, Infinity,
// or absurd page number). Acrobat pages are 0-based (page 0 == first page).
export const ACROBAT_PAGE_MIN = 0;
export const ACROBAT_PAGE_MAX = 100_000;

// combine accepts a bounded list of source PDFs (the primary + appended files).
export const ACROBAT_COMBINE_MIN_INPUTS = 2;
export const ACROBAT_COMBINE_MAX_INPUTS = 50;

export const ACROBAT_SCRIPT_EXTENSION = 'applescript' as const;

// ── Path validation (pure mirror of mayaScriptAdapter.validateMayaPath) ──────
// LOCKSTEP intent: byte-identical reject-set to cadCodeExecutor.validateCadPath
// / appScriptRunner.validateRunnerPath / the bridge's validateDesktopPathServer,
// PLUS the ".." traversal reject. A path that passes here must not fail a
// downstream validator for a different reason. Non-BMP code points are rejected
// because paths are embedded in generated JS string literals via \uXXXX escapes
// (lone surrogates are not encodable), and because the AppleScript layer around
// them is likewise ASCII-only here.
//
// NOTE on device-independent paths: Acrobat's `cPath` wants a device-independent
// format (forward-slash, e.g. `/C/Users/...`). This validator does NOT rewrite
// the path into that form — it only guarantees the path is SAFE to embed. The
// wiring/preview layer is responsible for presenting/normalizing the OS path
// into Acrobat's device-independent form; the reject-set (control/metachar/BMP/
// traversal) is identical either way and forward slashes are unaffected.
function validateAcrobatPath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'path must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'path is empty' };
  if (trimmed.length > 1024) return { ok: false, error: 'path exceeds 1024 chars' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: 'path contains control characters' };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: 'path contains a shell metacharacter' };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return {
        ok: false,
        error: 'path contains characters outside the basic multilingual plane (cannot be embedded safely in a generated script literal)',
      };
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: 'path must not contain ".." traversal' };
  return { ok: true, path: trimmed };
}

/**
 * Emit a value as a JavaScript string literal. IDENTICAL technique to
 * mayaScriptAdapter.pythonStringLiteral / cadCodeExecutor.pythonStringLiteral:
 * JSON.stringify (double-quoted, backslash/quote/control escaped) then escape
 * every non-ASCII char to \uXXXX so the generated JS is pure ASCII. A JSON
 * string literal is a valid JavaScript string literal, so this is exact for
 * ECMAScript. `validateAcrobatPath` rejects non-BMP code points, so surrogate
 * escapes never reach the engine. User values are NEVER concatenated raw into
 * script text — they only ever pass through here.
 */
function jsStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/[-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Wrap an ENTIRE generated-JavaScript blob as an AppleScript string literal for
 * `do script "..."`. AppleScript string literals are double-quoted and use
 * backslash escapes for `"` and `\`. Because the JS blob is already pure ASCII
 * (every user value went through `jsStringLiteral`, and the JS we author is
 * ASCII), the only characters needing escaping at this outer layer are `\` and
 * `"`. We deliberately escape backslash FIRST, then the double-quote, so the
 * two passes do not interfere. This is the SECOND embedding layer that Maya
 * (single-language) does not need; it exists because `do script` takes the JS
 * as an AppleScript string. Newlines in the JS are represented via `\n` inside
 * this literal so the AppleScript stays single-line-safe.
 */
function appleScriptStringLiteral(jsBlob: string): string {
  const escaped = jsBlob
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
  return `"${escaped}"`;
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeExportFormat(raw: unknown): AcrobatExportFormat | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (ACROBAT_EXPORT_FORMATS as readonly string[]).includes(value) ? (value as AcrobatExportFormat) : null;
}

/**
 * Validate a page index into a bounded non-negative integer, or null. Accepts a
 * finite number or a plain-integer string; rejects decimals, exponents,
 * Infinity/NaN, hex, negatives, and out-of-range values. The result is a JS
 * number re-stringified with `String()` before embedding, so no user-controlled
 * text ever reaches the script (only digits 0-9). Mirrors
 * mayaScriptAdapter.validateFrame exactly.
 */
function validatePage(raw: unknown): { ok: true; page: number } | { ok: false; error: string } {
  let n: number | null = null;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!/^\d{1,6}$/.test(trimmed)) {
      return { ok: false, error: 'page must be a plain non-negative integer' };
    }
    n = Number(trimmed);
  } else {
    return { ok: false, error: 'page must be a number or integer string' };
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: 'page must be a finite integer' };
  }
  if (n < ACROBAT_PAGE_MIN || n > ACROBAT_PAGE_MAX) {
    return { ok: false, error: `page must be between ${ACROBAT_PAGE_MIN} and ${ACROBAT_PAGE_MAX}` };
  }
  return { ok: true, page: n };
}

// ── Public request/result contracts ──────────────────────────────────────────

export interface AcrobatCombineInput {
  /** 2..50 absolute .pdf source paths to combine, in order (all validated). */
  inputPaths: string[];
  /** Absolute .pdf path the combined document is written to (validated; NEW file). */
  outputPath: string;
}

export interface AcrobatExportInput {
  /** Absolute .pdf source to open (validated). */
  inputPath: string;
  /** Absolute output path — extension must match `format` (validated; NEW file). */
  outputPath: string;
  /** docx / xlsx / rtf / txt — selects the VERIFY-marked cConvID. */
  format: AcrobatExportFormat;
}

export interface AcrobatFlattenInput {
  /** Absolute .pdf source to open (validated). */
  inputPath: string;
  /** Absolute .pdf path the flattened copy is written to (validated; NEW file). */
  outputPath: string;
}

export interface AcrobatExtractInput {
  /** Absolute .pdf source to open (validated). */
  inputPath: string;
  /** Absolute .pdf path the extracted page range is written to (validated; NEW file). */
  outputPath: string;
  /** 0-based first page to extract (bounded integer). */
  startPage: number | string;
  /** 0-based last page to extract, inclusive (bounded integer, >= startPage). */
  endPage: number | string;
}

export type AcrobatOperationInput =
  | AcrobatCombineInput
  | AcrobatExportInput
  | AcrobatFlattenInput
  | AcrobatExtractInput;

export interface AcrobatScriptResult {
  /** The generated AppleScript source (a `tell application "Adobe Acrobat"`
   *  block whose `do script` carries the validated JS). On validation failure
   *  this is a fail-closed stub that errors out and mutates nothing. */
  script: string;
  scriptExtension: typeof ACROBAT_SCRIPT_EXTENSION;
  /** The file the script writes, when the path validated. */
  outputHint?: string;
  notes: string[];
  /** True when the request validated into a real operation script. */
  ok: boolean;
}

export interface AcrobatArgsValidation {
  ok: boolean;
  /** Normalized, safe-to-embed values (present only when ok). Pages are strings
   *  of digits; inputPaths is a JSON array string of validated paths. */
  normalized?: Record<string, string>;
  /** Human-readable reasons any input was rejected (drop-with-note). */
  notes: string[];
}

const ACROBAT_ERROR_SENTINEL = 'UC_ACROBAT_ERROR';
const ACROBAT_DONE_SENTINEL = 'UC_ACROBAT_DONE';

/**
 * Operation-gap tool constant. When chat routes an Acrobat request and this
 * adapter is NOT wired live (which it is not — `verifiedInvocation:false`), the
 * connected-agent buildout path is requested via this tool. Mirrors the
 * `agent.build_app_capability` route named in docs/apps/acrobat.md gaps.
 */
export const ACROBAT_OPERATION_GAP_TOOL = 'agent.build_app_capability' as const;

/**
 * Doc-verified invocation descriptor, marked `// VERIFY`. This is the single
 * source of truth for HOW a future wiring commit would run the generated
 * script, and it advertises `verifiedInvocation: false` so no caller mistakes
 * this for a live, install-tested path.
 */
export const ACROBAT_INVOCATION = {
  // VERIFY: run the generated .applescript via `osascript <file>` on macOS with
  // Acrobat Pro installed and authorized for Apple-events automation. The
  // `do script` verb executes the embedded JS inside Acrobat's PRIVILEGED
  // context so saveAs/insertPages/extractPages with a cPath are permitted.
  runner: 'osascript',
  scriptExtension: ACROBAT_SCRIPT_EXTENSION,
  appleScriptVerb: 'do script',
  targetApplication: 'Adobe Acrobat',
  /** NOT run against a live Acrobat install — doc-verified shapes only. */
  verifiedInvocation: false,
  docSource: 'https://opensource.adobe.com/dc-acrobat-sdk-docs/library/jsapiref/doc.html',
} as const;

// Shared banner every generated script carries. The `-- VERIFY` marker is an
// AppleScript comment so a human reviewing a staged .applescript sees the
// unverified-API warning before running it.
const SCRIPT_BANNER = [
  '-- Generated by Underground Circle acrobatScriptAdapter - run on macOS via',
  '-- `osascript <this-script.applescript>` with Adobe Acrobat Pro installed.',
  '-- It uses the AppleScript `do script` hook to run Acrobat JavaScript in the',
  '-- app\'s PRIVILEGED context (so saveAs/insertPages/extractPages are allowed).',
  '-- VERIFY the do-script hook + Doc.saveAs/insertPages/flattenPages/extractPages',
  '-- calls + cConvID values on a real Acrobat Pro install before wiring: entry',
  '-- points follow documented shapes but are unverified. Acrobat JS has NO OCR',
  '-- method - OCR is intentionally not an operation here.',
];

/**
 * Assemble the full AppleScript: banner + a `tell application "Adobe Acrobat"`
 * block whose `do script` runs the validated JS blob. The JS blob is authored
 * as pure ASCII (all user values already escaped via jsStringLiteral) and then
 * wrapped for the AppleScript layer via appleScriptStringLiteral. On the JS
 * side we wrap the body in a try/catch that reports the done/error sentinel so
 * the runner can detect success deterministically.
 */
function assembleScript(operationComment: string, jsBodyLines: string[]): string {
  const jsBlob = [
    'try {',
    ...jsBodyLines.map((l) => `  ${l}`),
    `  "${ACROBAT_DONE_SENTINEL}";`,
    `} catch (e) { "${ACROBAT_ERROR_SENTINEL}: " + e; }`,
  ].join('\n');
  return [
    ...SCRIPT_BANNER,
    operationComment,
    'tell application "Adobe Acrobat"',
    '  activate',
    `  do script ${appleScriptStringLiteral(jsBlob)}`,
    'end tell',
    '',
  ].join('\n');
}

/**
 * Fail-closed stub: a syntactically valid AppleScript that mutates nothing,
 * never opens Acrobat, and surfaces the (bounded, plain-text) reason via an
 * `error` so the runner sees a nonzero result. Mirrors mayaScriptAdapter's
 * failClosedScript intent.
 */
function failClosedScript(reason: string): string {
  const safeReason = String(reason || 'invalid request').slice(0, 300);
  // The reason is bounded plain text; escape it for the AppleScript string.
  const reasonLiteral = appleScriptStringLiteral(`${ACROBAT_ERROR_SENTINEL}: ${safeReason}`);
  return [
    ...SCRIPT_BANNER,
    '-- FAIL-CLOSED STUB: the request did not validate; this script mutates',
    '-- nothing, never launches Acrobat, and raises an error so no partial',
    '-- operation can run.',
    `error ${reasonLiteral}`,
    '',
  ].join('\n');
}

// ── validateAcrobatArgs ──────────────────────────────────────────────────────

/**
 * Allowlist-validate an operation's inputs into safe, normalized string values.
 * Never throws; returns ok:false + notes on any rejection. This is the single
 * gate every user value passes before it can reach `jsStringLiteral` / the
 * emitted integer literal.
 */
export function validateAcrobatArgs(op: unknown, input: unknown): AcrobatArgsValidation {
  const notes: string[] = [];
  if (!(ACROBAT_OPERATIONS as readonly string[]).includes(op as string)) {
    return { ok: false, notes: [`Unknown Acrobat operation "${String(op).slice(0, 40)}".`] };
  }
  const operation = op as AcrobatOperation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  if (operation === 'combine_pdfs') {
    const rawList = Array.isArray(record.inputPaths) ? record.inputPaths : null;
    if (!rawList) {
      notes.push('combine_pdfs inputPaths must be an array of PDF paths.');
      return { ok: false, notes };
    }
    if (rawList.length < ACROBAT_COMBINE_MIN_INPUTS || rawList.length > ACROBAT_COMBINE_MAX_INPUTS) {
      notes.push(`combine_pdfs needs ${ACROBAT_COMBINE_MIN_INPUTS}-${ACROBAT_COMBINE_MAX_INPUTS} input PDFs (got ${rawList.length}).`);
      return { ok: false, notes };
    }
    const validatedInputs: string[] = [];
    for (let i = 0; i < rawList.length; i += 1) {
      const p = validateAcrobatPath(rawList[i]);
      if (!p.ok) {
        notes.push(`combine_pdfs inputPaths[${i}]: ${p.error}.`);
        return { ok: false, notes };
      }
      const ext = extensionOf(p.path);
      if (!ACROBAT_PDF_EXTENSIONS.includes(ext)) {
        notes.push(`combine_pdfs inputPaths[${i}] must be a .pdf (got .${ext || '?'}).`);
        return { ok: false, notes };
      }
      validatedInputs.push(p.path);
    }
    const out = validateAcrobatPath(record.outputPath);
    if (!out.ok) {
      notes.push(`combine_pdfs outputPath: ${out.error}.`);
      return { ok: false, notes };
    }
    if (extensionOf(out.path) !== 'pdf') {
      notes.push(`combine_pdfs outputPath must be a .pdf (got .${extensionOf(out.path) || '?'}).`);
      return { ok: false, notes };
    }
    if (validatedInputs.includes(out.path)) {
      notes.push('combine_pdfs outputPath must differ from every source PDF (never write over a source).');
      return { ok: false, notes };
    }
    // Store inputs as a JSON array string; each element is a validated path that
    // the builder re-escapes via jsStringLiteral before embedding.
    return { ok: true, normalized: { inputPaths: JSON.stringify(validatedInputs), outputPath: out.path }, notes };
  }

  // The remaining ops all open a single source PDF — validate it uniformly.
  const src = validateAcrobatPath(record.inputPath);
  if (!src.ok) {
    notes.push(`inputPath: ${src.error}.`);
    return { ok: false, notes };
  }
  if (!ACROBAT_PDF_EXTENSIONS.includes(extensionOf(src.path))) {
    notes.push(`inputPath must be a .pdf (got .${extensionOf(src.path) || '?'}).`);
    return { ok: false, notes };
  }

  if (operation === 'export_to_office') {
    const format = normalizeExportFormat(record.format);
    if (!format) {
      notes.push(`export_to_office format must be one of ${ACROBAT_EXPORT_FORMATS.join(', ')}.`);
      return { ok: false, notes };
    }
    const out = validateAcrobatPath(record.outputPath);
    if (!out.ok) {
      notes.push(`export_to_office outputPath: ${out.error}.`);
      return { ok: false, notes };
    }
    const expectedExt = ACROBAT_EXPORT_EXTENSION[format];
    if (extensionOf(out.path) !== expectedExt) {
      notes.push(`export_to_office outputPath must end in .${expectedExt} for format ${format} (got .${extensionOf(out.path) || '?'}).`);
      return { ok: false, notes };
    }
    if (out.path === src.path) {
      notes.push('export_to_office outputPath must differ from the source PDF.');
      return { ok: false, notes };
    }
    return { ok: true, normalized: { inputPath: src.path, outputPath: out.path, format }, notes };
  }

  if (operation === 'flatten_pdf') {
    const out = validateAcrobatPath(record.outputPath);
    if (!out.ok) {
      notes.push(`flatten_pdf outputPath: ${out.error}.`);
      return { ok: false, notes };
    }
    if (extensionOf(out.path) !== 'pdf') {
      notes.push(`flatten_pdf outputPath must be a .pdf (got .${extensionOf(out.path) || '?'}).`);
      return { ok: false, notes };
    }
    if (out.path === src.path) {
      notes.push('flatten_pdf outputPath must differ from the source PDF (flatten is irreversible; never write over the source).');
      return { ok: false, notes };
    }
    return { ok: true, normalized: { inputPath: src.path, outputPath: out.path }, notes };
  }

  // operation === 'extract_pages'
  const out = validateAcrobatPath(record.outputPath);
  if (!out.ok) {
    notes.push(`extract_pages outputPath: ${out.error}.`);
    return { ok: false, notes };
  }
  if (extensionOf(out.path) !== 'pdf') {
    notes.push(`extract_pages outputPath must be a .pdf (got .${extensionOf(out.path) || '?'}).`);
    return { ok: false, notes };
  }
  if (out.path === src.path) {
    notes.push('extract_pages outputPath must differ from the source PDF.');
    return { ok: false, notes };
  }
  const start = validatePage(record.startPage);
  if (!start.ok) {
    notes.push(`extract_pages startPage: ${start.error}.`);
    return { ok: false, notes };
  }
  const end = validatePage(record.endPage);
  if (!end.ok) {
    notes.push(`extract_pages endPage: ${end.error}.`);
    return { ok: false, notes };
  }
  if (end.page < start.page) {
    notes.push('extract_pages endPage must be >= startPage.');
    return { ok: false, notes };
  }
  return {
    ok: true,
    normalized: {
      inputPath: src.path,
      outputPath: out.path,
      startPage: String(start.page),
      endPage: String(end.page),
    },
    notes,
  };
}

// ── buildAcrobatScript ────────────────────────────────────────────────────────

/**
 * Turn a bounded op request into a validated Acrobat AppleScript. All user
 * values are validated by `validateAcrobatArgs` FIRST and embedded only via
 * `jsStringLiteral` (paths) or a re-stringified bounded integer (pages). The
 * whole JS blob is then wrapped for the AppleScript layer via
 * `appleScriptStringLiteral`. On any validation failure a fail-closed stub is
 * returned (ok:false) — never a partial mutation, never a throw.
 */
export function buildAcrobatScript(op: unknown, input: unknown): AcrobatScriptResult {
  const validation = validateAcrobatArgs(op, input);
  if (!validation.ok || !validation.normalized) {
    const reason = validation.notes[0] ?? 'invalid Acrobat request';
    return {
      script: failClosedScript(reason),
      scriptExtension: ACROBAT_SCRIPT_EXTENSION,
      notes: validation.notes.length ? validation.notes : ['Request did not validate; emitted a fail-closed stub.'],
      ok: false,
    };
  }
  const operation = op as AcrobatOperation;
  const values = validation.normalized;
  const notes = [...validation.notes];

  if (operation === 'combine_pdfs') {
    const inputPaths = JSON.parse(values.inputPaths) as string[];
    const outputLiteral = jsStringLiteral(values.outputPath);
    // Open the FIRST source, then a series of insertPages appends each of the
    // rest, then saveAs writes the NEW combined file. Opening the first source
    // (rather than app.newDoc()) avoids a leftover blank page. // VERIFY nPage
    // append semantics on a live install: we insert with nPage = numPages-1
    // (append after the last page).
    const jsBody = [
      `var oDoc = app.openDoc({ cPath: ${jsStringLiteral(inputPaths[0])} });`,
      // Append every source AFTER the first.
      ...inputPaths.slice(1).map((p) => `oDoc.insertPages({ nPage: oDoc.numPages - 1, cPath: ${jsStringLiteral(p)}, nStart: 0 });`),
      `oDoc.saveAs({ cPath: ${outputLiteral}, bPromptToOverwrite: false });`,
      'oDoc.closeDoc(true);',
    ];
    const script = assembleScript(
      `-- Operation: combine_pdfs (${inputPaths.length} PDFs -> 1). Approval-gated, writes a NEW file.`,
      jsBody,
    );
    notes.push(
      `Run on macOS: osascript <staged-script>.applescript — it opens ${inputPaths.length} PDFs (privileged do-script context) and writes ${values.outputPath} (verify with desktop.file_stat + page count after).`,
      'Approval-gated: this writes a NEW combined PDF. openDoc/insertPages/saveAs with a cPath only work in Acrobat\'s privileged context, which is why the do-script hook is required. It never writes over a source PDF.',
      'VERIFY on a live Acrobat Pro install: insertPages append semantics, that the source files are "disclosed" enough for openDoc to return a reference, and cConvID is not needed for PDF->PDF.',
    );
    return { script, scriptExtension: ACROBAT_SCRIPT_EXTENSION, outputHint: values.outputPath, notes, ok: true };
  }

  if (operation === 'export_to_office') {
    const format = values.format as AcrobatExportFormat;
    const inputLiteral = jsStringLiteral(values.inputPath);
    const outputLiteral = jsStringLiteral(values.outputPath);
    // cConvID is a fixed, VERIFY-marked constant — never user-derived.
    const convLiteral = jsStringLiteral(ACROBAT_EXPORT_CONV_ID[format]);
    const jsBody = [
      `var oDoc = app.openDoc({ cPath: ${inputLiteral} });`,
      // Doc.saveAs(cPath, cConvID, ...) — object form. // VERIFY cConvID per version.
      `oDoc.saveAs({ cPath: ${outputLiteral}, cConvID: ${convLiteral}, bPromptToOverwrite: false });`,
      'oDoc.closeDoc(true);',
    ];
    const script = assembleScript(
      `-- Operation: export_to_office (PDF -> ${format.toUpperCase()}). Approval-gated, writes a NEW file.`,
      jsBody,
    );
    notes.push(
      `Run on macOS: osascript <staged-script>.applescript — it opens ${values.inputPath} and writes ${values.outputPath} via Doc.saveAs (verify with desktop.file_stat after).`,
      `Approval-gated: this writes a NEW ${format.toUpperCase()} file. saveAs conversion does NOT work in Acrobat Reader (Pro only). cConvID "${ACROBAT_EXPORT_CONV_ID[format]}" is VERIFY-marked and version-dependent - confirm on a live install.`,
      'It never writes over the source PDF.',
    );
    return { script, scriptExtension: ACROBAT_SCRIPT_EXTENSION, outputHint: values.outputPath, notes, ok: true };
  }

  if (operation === 'flatten_pdf') {
    const inputLiteral = jsStringLiteral(values.inputPath);
    const outputLiteral = jsStringLiteral(values.outputPath);
    // Save a COPY first, then flatten the copy, so the source is never mutated.
    // flattenPages(nStart, nEnd, nNonPrint) — 0-based, whole doc, keep
    // non-printing annots (nNonPrint=1). flatten is IRREVERSIBLE + Pro-only.
    const jsBody = [
      `var oSrc = app.openDoc({ cPath: ${inputLiteral} });`,
      // Save a fresh copy to the NEW path, then reopen and flatten THAT copy so
      // the original file on disk is never touched. // VERIFY that saveAs with a
      // new cPath followed by reopen is the right no-mutate pattern on install.
      `oSrc.saveAs({ cPath: ${outputLiteral}, bPromptToOverwrite: false });`,
      'oSrc.closeDoc(true);',
      `var oCopy = app.openDoc({ cPath: ${outputLiteral} });`,
      // nNonPrint = 1 => ignore "do not print" annotations while flattening.
      'oCopy.flattenPages(0, oCopy.numPages - 1, 1);',
      `oCopy.saveAs({ cPath: ${outputLiteral}, bPromptToOverwrite: false });`,
      'oCopy.closeDoc(true);',
    ];
    const script = assembleScript(
      '-- Operation: flatten_pdf (annotations/forms -> page content). IRREVERSIBLE, Pro-only, writes a NEW file.',
      jsBody,
    );
    notes.push(
      `Run on macOS: osascript <staged-script>.applescript — it copies ${values.inputPath} to ${values.outputPath}, flattens the COPY, and re-saves it (verify with desktop.file_stat after).`,
      'Approval-gated + HIGH RISK: flattenPages is IRREVERSIBLE (erases annotations AND embedded JavaScript) and is a PRIVILEGED, Acrobat-Pro-only method. It runs on a NEW copy so the source is never mutated. Signatures become non-interactive artwork - the approval must say so.',
      'VERIFY on a live install: flattenPages availability (Pro license), the nNonPrint semantics, and that the copy-then-flatten pattern preserves the source.',
    );
    return { script, scriptExtension: ACROBAT_SCRIPT_EXTENSION, outputHint: values.outputPath, notes, ok: true };
  }

  // operation === 'extract_pages'
  const inputLiteral = jsStringLiteral(values.inputPath);
  const outputLiteral = jsStringLiteral(values.outputPath);
  const startPage = values.startPage; // bounded digit string
  const endPage = values.endPage; // bounded digit string
  // Doc.extractPages({ nStart, nEnd, cPath }) writes the range to a NEW file.
  // Pages are 0-based; cPath needs the privileged context (do-script provides
  // it); Acrobat cannot create folders so the target dir must already exist.
  const jsBody = [
    `var oDoc = app.openDoc({ cPath: ${inputLiteral} });`,
    // Clamp nEnd to the last page so an out-of-range endPage cannot overrun.
    `var nEndClamped = Math.min(${endPage}, oDoc.numPages - 1);`,
    `oDoc.extractPages({ nStart: ${startPage}, nEnd: nEndClamped, cPath: ${outputLiteral} });`,
    'oDoc.closeDoc(true);',
  ];
  const script = assembleScript(
    `-- Operation: extract_pages (pages ${startPage}-${endPage}, 0-based -> new PDF). Approval-gated, writes a NEW file.`,
    jsBody,
  );
  notes.push(
    `Run on macOS: osascript <staged-script>.applescript — it opens ${values.inputPath} and writes pages ${startPage}-${endPage} to ${values.outputPath} (verify with desktop.file_stat + page count after).`,
    'Approval-gated: this writes a NEW PDF of the extracted range. extractPages with a cPath only works in the privileged do-script context, and the target folder must already exist (Acrobat cannot create folders). It never writes over the source PDF.',
    'VERIFY on a live install: extractPages 0-based inclusive range semantics and the privileged-context requirement for cPath.',
  );
  return { script, scriptExtension: ACROBAT_SCRIPT_EXTENSION, outputHint: values.outputPath, notes, ok: true };
}

// ── describeAcrobatOperation ─────────────────────────────────────────────────

/** One-line plain-language description for an approval preview / notice. Never
 *  throws — returns a generic line for unknown ops/inputs. */
export function describeAcrobatOperation(op: unknown, input: unknown): string {
  if (!(ACROBAT_OPERATIONS as readonly string[]).includes(op as string)) {
    return 'Run an Adobe Acrobat script (approval-gated, macOS do-script)';
  }
  const operation = op as AcrobatOperation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (operation === 'combine_pdfs') {
    const count = Array.isArray(record.inputPaths) ? record.inputPaths.length : 0;
    return `Combine ${count > 0 ? `${count} ` : ''}PDFs into one (Acrobat, approval-gated)`;
  }
  if (operation === 'export_to_office') {
    const format = normalizeExportFormat(record.format);
    return `Export the PDF to ${format ? format.toUpperCase() : 'an Office file'} (Acrobat Pro, approval-gated)`;
  }
  if (operation === 'flatten_pdf') {
    return 'Flatten the PDF annotations/forms into page content (Acrobat Pro, irreversible, approval-gated)';
  }
  const start = validatePage(record.startPage);
  const end = validatePage(record.endPage);
  return `Extract PDF pages${start.ok && end.ok ? ` ${start.page}-${end.page}` : ''} to a new file (Acrobat, approval-gated)`;
}
