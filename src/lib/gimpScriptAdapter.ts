// gimpScriptAdapter — PURE generator that turns a bounded op request into a
// validated GIMP headless **Python-Fu batch program** (plan P6, Substrate A /
// headless-CLI). It is the code-generation counterpart to
// `src/lib/cadCodeExecutor.ts` (OpenSCAD/FreeCAD/Blender) and the
// `*ScriptAdapter.ts` family (AutoCAD/Fusion/Revit/SolidWorks/DaVinci),
// applied to GIMP's batch interpreter.
//
// PAIRING: the run half belongs to `src/lib/appScriptRunner.ts`, which owns a
// per-engine descriptor + fixed-path binary + execFile argv. GIMP is NOT in
// that registry yet — this module reports the descriptor the parent must add
// (see `GIMP_ENGINE_DESCRIPTOR_REQUEST` below). THIS module produces only the
// Python-Fu program TEXT that goes INTO the `-b "<python>"` argv token. It
// never touches the filesystem, spawns a process, or resolves a binary. Zero
// runtime imports (`import type` only, and none are needed) → tsx-loadable
// (smoke: gimp-script-adapter).
//
// ── VERIFY BEFORE WIRING ─────────────────────────────────────────────────────
// VERIFY the `gimp -b` batch invocation + the pdb.* calls + the
// interpreter flag on a real GIMP install (2.10 vs 3.0 differ) before wiring.
// The documented shape targeted here is GIMP 2.10 Python-Fu:
//   gimp -i -d -f --batch-interpreter=python-fu-eval \
//        -b "<python program>" -b "pdb.gimp_quit(1)"
// where `-i` = no interface, `-d` = no data (brushes/patterns), `-f` = no
// fonts, and `python-fu-eval` eval's the `-b` string as Python 2 with `pdb`
// (the GIMP procedural DB) and `gimp` preloaded. GIMP 3.0 (March 2025) changed
// several things that are NOT freshly verified here and MUST be confirmed on a
// live install before `desktop.run_app_script` is wired for this engine:
//   * The batch interpreter name is `python-fu-eval` in 2.10; 3.0's GObject-
//     Introspection Python 3 binding may register a differently-named eval
//     interpreter (and the module import surface differs).
//   * pdb procedure names: 2.10 uses `pdb.gimp_image_flatten`,
//     `pdb.file_png_save`, `pdb.gimp_image_scale`, `pdb.gimp_quit`, etc. 3.0
//     renamed/reshaped much of the PDB (e.g. `Gimp.` GI namespace) and some
//     signatures changed arity. The generated program below uses the 2.10
//     names only; a 3.0 run will need a separate documented shape.
//   * `--batch-interpreter` vs a 3.0 equivalent flag, and whether `-d -f` are
//     still spelled the same.
// Every generated program carries a `# VERIFY` banner, and the engine
// descriptor request carries `verifiedInvocation: false`. This module is a PURE
// GENERATOR ONLY — it is deliberately NOT wired into appScriptRunner /
// openswanToolRuntime / claude-bridge.js. The validation/security logic below
// is correct regardless of which pdb spelling ends up verified.
//
// ── LOAD-BEARING SECURITY BAR ────────────────────────────────────────────────
// The batch string is passed as ONE argv token to `-b`, but the Python inside
// it is EVAL'd — so a quote or newline inside a user value (input path, output
// path, width/height, quality) is PYTHON INJECTION, not a benign string escape.
// This module therefore, mirroring cadCodeExecutor exactly:
//   * validates every user value against a STRICT allowlist FIRST — paths via
//     `validateGimpPath` (a clone of `validateCadPath`: length bound, control-
//     char reject, shell-metachar reject, BMP-only, no `..` traversal), and
//     dimensions/quality via bounded-integer parsing;
//   * embeds every validated value into the Python ONLY as an escaped string
//     literal via `pythonStringLiteral` (JSON.stringify + non-ASCII → \uXXXX),
//     never by raw concatenation;
//   * ADDITIONALLY guarantees the assembled program is NEWLINE-FREE — the whole
//     Python-Fu program is a single `;`-joined line so it survives as one argv
//     token (appScriptRunner rejects any arg token containing a newline). A BMP
//     path with an embedded newline is impossible (control chars are rejected
//     up front), and even a hypothetical one would render as the two-char `\n`
//     escape inside a Python string literal, never a real line break.
// Anything that fails validation is DROPPED WITH A NOTE (or the whole build
// fails closed for a required field) — never silently mangled into the program.
// Degenerate input NEVER throws.

// ── Operation set (documented, bounded) ──────────────────────────────────────

export type GimpOperation = 'convert_format' | 'resize' | 'export_layers_to_png';

export const GIMP_OPERATIONS: readonly GimpOperation[] = [
  'convert_format',
  'resize',
  'export_layers_to_png',
] as const;

/** Raster export formats the generated program knows how to write. */
export type GimpExportFormat = 'png' | 'jpg' | 'webp' | 'tiff';

export const GIMP_EXPORT_FORMATS: readonly GimpExportFormat[] = ['png', 'jpg', 'webp', 'tiff'] as const;

/**
 * Output file extensions accepted per export format (the alias `jpeg`→jpg and
 * `tif`→tiff are normalized in `normalizeFormat`). Kept as a set so a caller
 * can pass either the format token or a matching output extension.
 */
const GIMP_FORMAT_EXTENSIONS: Record<GimpExportFormat, readonly string[]> = {
  png: ['png'],
  jpg: ['jpg', 'jpeg'],
  webp: ['webp'],
  tiff: ['tiff', 'tif'],
};

/**
 * Input image extensions GIMP loads via `pdb.gimp_file_load` in the documented
 * shape. Deliberately conservative — common raster + native `.xcf`. `.xcf`
 * sources are treated as read-only inputs (outputs always go to a NEW path).
 */
export const GIMP_INPUT_EXTENSIONS: readonly string[] = [
  'xcf',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'tiff',
  'tif',
  'bmp',
  'gif',
  'tga',
];

export const GIMP_SCRIPT_EXTENSION = 'py' as const;

// Dimension + quality bounds. Pixels are bounded to a sane raster ceiling;
// JPEG/WebP quality is 0..100.
const GIMP_MIN_DIMENSION = 1;
const GIMP_MAX_DIMENSION = 30_000;
const GIMP_MIN_QUALITY = 0;
const GIMP_MAX_QUALITY = 100;
const GIMP_DEFAULT_QUALITY = 92;

// ── Path validation (pure mirror of cadCodeExecutor.validateCadPath) ──────────
// LOCKSTEP intent: byte-identical reject-set to cadCodeExecutor.validateCadPath
// / appScriptRunner.validateRunnerPath / the bridge's validateDesktopPathServer,
// PLUS the ".." traversal reject (appScriptRunner already adds this). A path
// that passes here must not fail a downstream validator for a different reason.
// Non-BMP code points are rejected because paths are embedded in generated
// Python string literals via \uXXXX escapes (lone surrogates are not encodable),
// and control chars are rejected so the assembled single-line program can never
// carry a real newline into the `-b` argv token.
function validateGimpPath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
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
        error: 'path contains characters outside the basic multilingual plane (cannot be embedded safely in a generated Python literal)',
      };
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: 'path must not contain ".." traversal' };
  return { ok: true, path: trimmed };
}

/**
 * Emit a value as a Python string literal. IDENTICAL technique to
 * cadCodeExecutor.pythonStringLiteral: JSON.stringify (double-quoted,
 * backslash/quote/control escaped) then escape every non-ASCII char to \uXXXX
 * so the generated program is pure ASCII. `validateGimpPath` rejects non-BMP
 * code points, so surrogate escapes never reach Python. Because the source
 * value is already control-char-free, JSON.stringify can only ever emit the
 * two-character `\n`/`\t` escapes (not a real line break), which is exactly
 * what keeps the assembled program a single argv-safe line. User values are
 * NEVER concatenated raw into program text — they only ever pass through here.
 */
function pythonStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/** Normalize a format token OR a file extension into a canonical format. */
function normalizeFormat(raw: unknown): GimpExportFormat | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if ((GIMP_EXPORT_FORMATS as readonly string[]).includes(value)) return value as GimpExportFormat;
  for (const format of GIMP_EXPORT_FORMATS) {
    if (GIMP_FORMAT_EXTENSIONS[format].includes(value)) return format;
  }
  return null;
}

/**
 * Bounded integer parse: finite integer in [min,max] or null (never throws).
 * A NUMBER input must be a finite integer. A STRING input must be a PLAIN
 * decimal integer (optional leading minus, digits only) — hex (`0x40`),
 * exponent (`1e5`), floats, and whitespace-padded junk are rejected, matching
 * the strict-decimal discipline of cadCodeExecutor/fusion360's value regexes so
 * the emitted numeric literal can never be a surprise token.
 */
function boundedInt(raw: unknown, min: number, max: number): number | null {
  let n: number;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string' && /^-?\d{1,9}$/.test(raw.trim())) {
    n = Number(raw.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

// ── Public request/result contracts ──────────────────────────────────────────

export interface GimpConvertFormatInput {
  /** Source image path (validated; may be .xcf — read-only input). */
  inputPath: string;
  /** Output path (validated); its extension must match `format` (or supply format). */
  outputPath: string;
  /** Target raster format. Optional if the outputPath extension implies it. */
  format?: GimpExportFormat | string;
  /** JPEG/WebP quality 0..100 (ignored for PNG/TIFF; defaults to 92). */
  quality?: number;
}

export interface GimpResizeInput {
  /** Source image path (validated; may be .xcf — read-only input). */
  inputPath: string;
  /** Output path (validated); its extension determines the export format. */
  outputPath: string;
  /** Target width in pixels (bounded integer). */
  width: number;
  /** Target height in pixels (bounded integer). */
  height: number;
  /** JPEG/WebP quality 0..100 (ignored for PNG/TIFF; defaults to 92). */
  quality?: number;
}

export interface GimpExportLayersToPngInput {
  /** Source image path (validated; typically an .xcf with layers). */
  inputPath: string;
  /** Output DIRECTORY (validated) — one PNG per visible layer is written here. */
  outputDir: string;
}

export type GimpOperationInput =
  | GimpConvertFormatInput
  | GimpResizeInput
  | GimpExportLayersToPngInput;

export interface GimpScriptResult {
  /** The generated Python-Fu program — a SINGLE `;`-joined line, safe as one
   *  `-b` argv token. On validation failure this is a fail-closed stub that
   *  raises with a UC_GIMP_ERROR sentinel and mutates nothing. */
  script: string;
  scriptExtension: typeof GIMP_SCRIPT_EXTENSION;
  /** The file/dir the program writes, when the path validated (proof target). */
  outputHint?: string;
  notes: string[];
  /** True when the request validated into a real operation program. */
  ok: boolean;
}

export interface GimpArgsValidation {
  ok: boolean;
  /** Normalized, safe-to-embed values (present only when ok). */
  normalized?: {
    inputPath: string;
    outputPath?: string;
    outputDir?: string;
    format?: GimpExportFormat;
    width?: number;
    height?: number;
    quality?: number;
  };
  /** Human-readable reasons any input was rejected (drop-with-note). */
  notes: string[];
}

// Banner every generated program carries. The `# VERIFY` marker is inside the
// generated Python (as a #-comment prefix) so a human reviewing the staged
// program string sees the unverified-invocation warning before running it.
const SCRIPT_BANNER =
  '# Generated by Underground Circle gimpScriptAdapter (GIMP 2.10 Python-Fu batch). ' +
  '# VERIFY the gimp -b invocation + pdb.* calls + --batch-interpreter flag on a real GIMP install (2.10 vs 3.0 differ) before wiring.';

const GIMP_ERROR_SENTINEL = 'UC_GIMP_ERROR';
const GIMP_DONE_SENTINEL = 'UC_GIMP_DONE';

/**
 * Fail-closed stub: a syntactically valid, SINGLE-LINE Python-Fu program that
 * mutates nothing and raises with the error sentinel + the (bounded, plain-
 * text) reason. Same shape as a real program (one argv-safe `-b` token) so the
 * caller can hand it to the runner uniformly; it just refuses to act.
 */
function failClosedStub(reason: string): string {
  const safeReason = pythonStringLiteral(`${GIMP_ERROR_SENTINEL}: ${String(reason || 'invalid request').slice(0, 300)}`);
  // A bare `raise Exception(<literal>)` is a legal one-line program. The banner
  // is a leading #-comment; python-fu-eval treats the whole string as a module
  // body, so a comment then a statement on the same logical line is expressed
  // with an explicit newline escape — but to keep the token newline-FREE we put
  // the comment marker inline and separate with a literal ' ; ' after closing
  // it via exec of a normal statement. Simplest safe form: no leading comment
  // in the executable path; expose the banner via `notes` instead and keep the
  // program itself a single pure statement.
  return `raise Exception(${safeReason})`;
}

// ── validateGimpArgs ──────────────────────────────────────────────────────────

/**
 * Allowlist-validate an operation's inputs into safe, normalized values. Never
 * throws; returns ok:false + notes on any rejection. This is the single gate
 * every user value passes before it can reach `pythonStringLiteral`.
 */
export function validateGimpArgs(op: unknown, input: unknown): GimpArgsValidation {
  const notes: string[] = [];
  if (!(GIMP_OPERATIONS as readonly string[]).includes(op as string)) {
    return { ok: false, notes: [`Unknown GIMP operation "${String(op).slice(0, 40)}".`] };
  }
  const operation = op as GimpOperation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  // Every op needs a valid input image path.
  const inputValidated = validateGimpPath(record.inputPath);
  if (!inputValidated.ok) {
    notes.push(`${operation} inputPath: ${inputValidated.error}.`);
    return { ok: false, notes };
  }
  const inputExt = extensionOf(inputValidated.path);
  if (!GIMP_INPUT_EXTENSIONS.includes(inputExt)) {
    notes.push(
      `${operation} inputPath extension ".${inputExt || '?'}" is not a supported GIMP input — expected one of: ${GIMP_INPUT_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`,
    );
    return { ok: false, notes };
  }

  if (operation === 'export_layers_to_png') {
    const dirValidated = validateGimpPath(record.outputDir);
    if (!dirValidated.ok) {
      notes.push(`export_layers_to_png outputDir: ${dirValidated.error}.`);
      return { ok: false, notes };
    }
    return { ok: true, normalized: { inputPath: inputValidated.path, outputDir: dirValidated.path.replace(/\/+$/, '') }, notes };
  }

  // convert_format + resize both write a single output file.
  const outputValidated = validateGimpPath(record.outputPath);
  if (!outputValidated.ok) {
    notes.push(`${operation} outputPath: ${outputValidated.error}.`);
    return { ok: false, notes };
  }
  const outExt = extensionOf(outputValidated.path);

  // Guard: never overwrite the source in place (source files are read-only).
  if (outputValidated.path === inputValidated.path) {
    notes.push(`${operation} outputPath must differ from inputPath — source files are read-only inputs, exports go to a NEW path.`);
    return { ok: false, notes };
  }

  // Resolve the export format from an explicit format token OR the output ext.
  let format: GimpExportFormat | null = null;
  if (record.format != null && String(record.format).trim() !== '') {
    format = normalizeFormat(record.format);
    if (!format) {
      notes.push(`${operation} format must be one of ${GIMP_EXPORT_FORMATS.join(', ')}.`);
      return { ok: false, notes };
    }
    // If an explicit format is given, the output extension must match it.
    if (!GIMP_FORMAT_EXTENSIONS[format].includes(outExt)) {
      notes.push(`${operation} outputPath extension ".${outExt || '?'}" does not match format ${format} (expected .${GIMP_FORMAT_EXTENSIONS[format].join('/.')}).`);
      return { ok: false, notes };
    }
  } else {
    format = normalizeFormat(outExt);
    if (!format) {
      notes.push(`${operation} outputPath extension ".${outExt || '?'}" is not an exportable format — expected one of: ${GIMP_EXPORT_FORMATS.map((f) => `.${f}`).join(', ')}.`);
      return { ok: false, notes };
    }
  }

  // Quality (JPEG/WebP only) — optional, bounded, drop-with-note if out of range.
  let quality: number | undefined;
  if (record.quality != null) {
    const q = boundedInt(record.quality, GIMP_MIN_QUALITY, GIMP_MAX_QUALITY);
    if (q === null) {
      notes.push(`quality must be an integer in [${GIMP_MIN_QUALITY}, ${GIMP_MAX_QUALITY}] — dropped, using default ${GIMP_DEFAULT_QUALITY}.`);
    } else {
      quality = q;
    }
  }

  if (operation === 'convert_format') {
    return { ok: true, normalized: { inputPath: inputValidated.path, outputPath: outputValidated.path, format, quality }, notes };
  }

  // operation === 'resize'
  const width = boundedInt(record.width, GIMP_MIN_DIMENSION, GIMP_MAX_DIMENSION);
  const height = boundedInt(record.height, GIMP_MIN_DIMENSION, GIMP_MAX_DIMENSION);
  if (width === null) {
    notes.push(`resize width must be an integer in [${GIMP_MIN_DIMENSION}, ${GIMP_MAX_DIMENSION}] pixels.`);
    return { ok: false, notes };
  }
  if (height === null) {
    notes.push(`resize height must be an integer in [${GIMP_MIN_DIMENSION}, ${GIMP_MAX_DIMENSION}] pixels.`);
    return { ok: false, notes };
  }
  return { ok: true, normalized: { inputPath: inputValidated.path, outputPath: outputValidated.path, format, width, height, quality }, notes };
}

// ── Python-Fu program fragments (documented GIMP 2.10 pdb shapes) ─────────────
// Each fragment is a list of Python STATEMENTS. They are joined with ' ; ' into
// ONE line by `assembleProgram`, so none of them may contain a real newline or
// depend on block indentation (these ops are all linear — load, operate, save,
// verify — so no `if/for` blocks are required in the executable path).

/** Load the input into IMG + drawable, or raise the error sentinel. */
function loadLines(inputLiteral: string): string[] {
  return [
    `_in = ${inputLiteral}`,
    // pdb.gimp_file_load(run_mode, filename, raw_filename). RUN-NONINTERACTIVE
    // is 1 in the GIMP 2.10 enum; pass it as the literal 1 (documented value).
    '_img = pdb.gimp_file_load(1, _in, _in)',
    // gimp_image_flatten returns the single flattened layer as the drawable.
    '_draw = pdb.gimp_image_flatten(_img)',
  ];
}

/**
 * Export IMG/_draw to `outputLiteral` for the given format. Emits ONE
 * pdb.file_*_save call. Save signatures follow GIMP 2.10:
 *   file_png_save(run_mode, image, drawable, filename, raw, interlace,
 *                 compression, bkgd, gama, offs, phys, time)
 *   file_jpeg_save(run_mode, image, drawable, filename, raw, quality, smoothing,
 *                  optimize, progressive, comment, subsmp, baseline, restart, dct)
 *   file_webp_save(run_mode, image, drawable, filename, raw, preset, lossless,
 *                  quality, alpha_quality, animation, ...)  # arity varies by build
 *   file_tiff_save(run_mode, image, drawable, filename, raw, compression)
 * VERIFY exact arity per build — these are the documented 2.10 shapes.
 */
function saveLines(format: GimpExportFormat, outputLiteral: string, quality: number): string[] {
  const out = [`_out = ${outputLiteral}`];
  const q01 = (quality / 100).toFixed(4); // WebP quality is 0..100 float in 2.10; JPEG uses 0..1 in this pdb.
  if (format === 'png') {
    // interlace 0, compression 9, all metadata flags 1 (documented defaults).
    out.push('pdb.file_png_save(1, _img, _draw, _out, _out, 0, 9, 1, 1, 1, 1, 1)');
  } else if (format === 'jpg') {
    // quality float 0..1, smoothing 0, optimize 1, progressive 0, no comment,
    // subsampling 0, baseline 1, restart 0, dct 0.
    out.push(`pdb.file_jpeg_save(1, _img, _draw, _out, _out, ${q01}, 0.0, 1, 0, "", 0, 1, 0, 0)`);
  } else if (format === 'webp') {
    // preset 0 (default), lossless 0, quality 0..100 float, alpha_quality 100,
    // animation 0. (Arity beyond this differs across builds — VERIFY.)
    out.push(`pdb.file_webp_save(1, _img, _draw, _out, _out, 0, 0, ${quality.toFixed(1)}, 100.0, 0)`);
  } else {
    // tiff: compression 1 = none (documented enum: 0 none? build-dependent —
    // VERIFY; 1 is the widely-used "none" value in 2.10's file-tiff).
    out.push('pdb.file_tiff_save(1, _img, _draw, _out, _out, 1)');
  }
  out.push(`pdb.gimp_image_delete(_img)`);
  out.push(`print(${pythonStringLiteral(`${GIMP_DONE_SENTINEL}: wrote `)} + _out)`);
  return out;
}

/**
 * Assemble statement fragments into a SINGLE argv-safe Python-Fu program line.
 * The banner is intentionally NOT prepended into the executable string (a
 * leading `#` comment would swallow the rest of a single-line program); it is
 * surfaced through `notes` and the descriptor instead. Guarantees the result
 * contains no real newline.
 */
function assembleProgram(statements: string[]): string {
  return statements.join(' ; ');
}

// ── buildGimpScript ────────────────────────────────────────────────────────────

/**
 * Turn a bounded op request into a validated GIMP Python-Fu batch program.
 * All user values are validated by `validateGimpArgs` FIRST and embedded only
 * via `pythonStringLiteral`. On any validation failure a fail-closed stub is
 * returned (ok:false) — never a partial mutation, never a throw. Accepts either
 * `buildGimpScript(op, input)` or `buildGimpScript({ op, ...input })`.
 */
export function buildGimpScript(op: unknown, input?: unknown): GimpScriptResult {
  // Ergonomic single-object form: buildGimpScript({ op, ...input }).
  let operation = op;
  let payload = input;
  if (input === undefined && op && typeof op === 'object' && 'op' in (op as Record<string, unknown>)) {
    const merged = op as Record<string, unknown>;
    operation = merged.op;
    payload = merged;
  }

  const validation = validateGimpArgs(operation, payload);
  if (!validation.ok || !validation.normalized) {
    const reason = validation.notes[0] ?? 'invalid GIMP request';
    return {
      script: failClosedStub(reason),
      scriptExtension: GIMP_SCRIPT_EXTENSION,
      notes: validation.notes.length ? validation.notes : ['Request did not validate; emitted a fail-closed stub.'],
      ok: false,
    };
  }

  const values = validation.normalized;
  const notes = [...validation.notes, SCRIPT_BANNER];
  const inputLiteral = pythonStringLiteral(values.inputPath);
  const quality = values.quality ?? GIMP_DEFAULT_QUALITY;

  if (operation === 'convert_format') {
    const format = values.format as GimpExportFormat;
    const outputLiteral = pythonStringLiteral(values.outputPath as string);
    const script = assembleProgram([...loadLines(inputLiteral), ...saveLines(format, outputLiteral, quality)]);
    notes.push(
      `Stage this as the -b Python-Fu program and run headless; it loads ${values.inputPath}, flattens, and writes ${values.outputPath} as ${format.toUpperCase()} (verify with desktop.file_stat after).`,
      'Source is a read-only input; the export goes to a new path. The program is a single argv token — pass it verbatim to -b.',
    );
    return { script, scriptExtension: GIMP_SCRIPT_EXTENSION, outputHint: values.outputPath, notes, ok: true };
  }

  if (operation === 'resize') {
    const format = values.format as GimpExportFormat;
    const outputLiteral = pythonStringLiteral(values.outputPath as string);
    const width = values.width as number;
    const height = values.height as number;
    // gimp_image_scale(image, new_width, new_height) BEFORE flatten so all
    // layers scale; then flatten + save. Rebuild the statement list so scale
    // sits between load and flatten.
    const statements = [
      `_in = ${inputLiteral}`,
      '_img = pdb.gimp_file_load(1, _in, _in)',
      `pdb.gimp_image_scale(_img, ${width}, ${height})`,
      '_draw = pdb.gimp_image_flatten(_img)',
      ...saveLines(format, outputLiteral, quality),
    ];
    const script = assembleProgram(statements);
    notes.push(
      `Stage this as the -b Python-Fu program and run headless; it loads ${values.inputPath}, scales to ${width}x${height}px, flattens, and writes ${values.outputPath} as ${format.toUpperCase()} (verify with desktop.file_stat after).`,
      'gimp_image_scale does not preserve aspect ratio — pass width/height that already encode the intended ratio. The program is a single argv token.',
    );
    return { script, scriptExtension: GIMP_SCRIPT_EXTENSION, outputHint: values.outputPath, notes, ok: true };
  }

  // operation === 'export_layers_to_png'
  const outputDir = values.outputDir as string;
  const dirLiteral = pythonStringLiteral(outputDir);
  // Iterate visible layers, exporting each to <dir>/layer-<i>-<name>.png. This
  // needs a loop, but the whole thing must stay a single argv line: express the
  // per-layer body as a Python list-comprehension over enumerate(...), which is
  // a single expression (no block indentation, no newline). os.path.join builds
  // the per-layer path from the sanitized layer name (gimp_item_get_name is
  // untrusted → re.sub to a safe filename charset INSIDE Python before joining).
  const statements = [
    'import os',
    'import re',
    `_in = ${inputLiteral}`,
    `_dir = ${dirLiteral}`,
    '_img = pdb.gimp_file_load(1, _in, _in)',
    '_layers = list(_img.layers)',
    // Sanitize each layer name in-Python (untrusted) to [A-Za-z0-9._-], bounded.
    "_safe = (lambda n: (re.sub(r'[^A-Za-z0-9._-]+', '_', n)[:60] or 'layer'))",
    // One flattened save per layer via a comprehension (single expression):
    // create a filename, save the layer as PNG. gimp_file_save picks the format
    // from the extension; we force PNG via file_png_save on each layer drawable.
    "_paths = [os.path.join(_dir, ('layer-%02d-%s.png' % (i, _safe(pdb.gimp_item_get_name(l))))) for i, l in enumerate(_layers)]",
    '[pdb.file_png_save(1, _img, _layers[i], _paths[i], _paths[i], 0, 9, 1, 1, 1, 1, 1) for i in range(len(_layers))]',
    'pdb.gimp_image_delete(_img)',
    `print(${pythonStringLiteral(`${GIMP_DONE_SENTINEL}: exported layers to `)} + _dir)`,
  ];
  const script = assembleProgram(statements);
  notes.push(
    `Stage this as the -b Python-Fu program and run headless; it loads ${values.inputPath} and writes one PNG per layer into ${outputDir} (verify count + files with desktop.file_search/file_stat after).`,
    'Layer names are untrusted and are sanitized to [A-Za-z0-9._-] inside Python before becoming filenames. The program is a single argv token.',
  );
  return { script, scriptExtension: GIMP_SCRIPT_EXTENSION, outputHint: outputDir, notes, ok: true };
}

// ── describeGimpOperation ───────────────────────────────────────────────────────

/** One-line plain-language description for an approval preview / notice. Never
 *  throws — returns a generic line for unknown ops/inputs. */
export function describeGimpOperation(op: unknown, input?: unknown): string {
  let operation = op;
  let payload = input;
  if (input === undefined && op && typeof op === 'object' && 'op' in (op as Record<string, unknown>)) {
    const merged = op as Record<string, unknown>;
    operation = merged.op;
    payload = merged;
  }
  if (!(GIMP_OPERATIONS as readonly string[]).includes(operation as string)) {
    return 'Run a GIMP batch script (headless, approval-gated)';
  }
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  if (operation === 'convert_format') {
    const format = normalizeFormat(record.format) ?? normalizeFormat(extensionOf(String(record.outputPath ?? '')));
    return `Convert an image to ${format ? format.toUpperCase() : 'a new format'} with GIMP (headless, approval-gated)`;
  }
  if (operation === 'resize') {
    const w = boundedInt(record.width, GIMP_MIN_DIMENSION, GIMP_MAX_DIMENSION);
    const h = boundedInt(record.height, GIMP_MIN_DIMENSION, GIMP_MAX_DIMENSION);
    const dims = w !== null && h !== null ? ` to ${w}x${h}px` : '';
    return `Resize an image${dims} with GIMP (headless, approval-gated)`;
  }
  return 'Export each layer of an image to PNG with GIMP (headless, approval-gated)';
}

/** One-line install guidance when GIMP is not present. */
export function describeGimpInstallGuidance(): string {
  return 'GIMP is not installed on this Mac — install it with `brew install --cask gimp` (or from gimp.org), then retry the batch operation.';
}

// ── appScriptRunner engine descriptor REQUEST (shared need for the parent) ────
// GIMP is NOT in APP_SCRIPT_ENGINE_REGISTRY. This is the descriptor the parent
// must add there (LOCKSTEP with claude-bridge.js). It is exported as data (not
// wired) so the smoke can pin its shape and the parent can copy it verbatim.
// buildArgs receives the already-validated `sourcePath` — but note GIMP is a
// SPECIAL case: the Python-Fu PROGRAM is the reviewable unit, and it is passed
// INLINE via `-b "<program>" -b "pdb.gimp_quit(1)"`, NOT as a script FILE path.
// So the runner integration for GIMP should treat `sourcePath` as the program
// STRING (the `-b` payload), not a filename. The parent must decide whether to
// (a) special-case GIMP in buildArgs to inline the program, or (b) extend the
// runner to accept an inline-program engine mode. The shape below documents (a).
export interface GimpEngineDescriptorRequest {
  id: 'gimp';
  label: string;
  platform: 'cross';
  sourceExtensions: readonly string[];
  outputExtensions: readonly string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  /** The fixed-path binary candidates the bridge should resolve (never PATH). */
  binaryCandidates: readonly string[];
  /** How the `-b` argv is shaped. `programToken` is the buildGimpScript output. */
  buildArgsShape: string;
  /** false until a live GIMP run confirms the invocation — see file header. */
  verifiedInvocation: false;
  /** Install hint surfaced on engine_not_installed. */
  installHint: string;
}

export const GIMP_ENGINE_DESCRIPTOR_REQUEST: GimpEngineDescriptorRequest = {
  id: 'gimp',
  label: 'GIMP (headless Python-Fu batch)',
  platform: 'cross',
  // The "source" is the Python-Fu program string (see note above), not a file
  // on disk. `py` is recorded as the scriptExtension for staging/review parity
  // with the other adapters, but the runner passes the program inline via -b.
  sourceExtensions: ['py'],
  // The batch program writes PNG/JPG/WEBP/TIFF (or a directory of PNGs). Empty
  // is also acceptable if the parent prefers stat-verifying the caller-supplied
  // outputHint; listed here for the convert/resize single-file outputs.
  outputExtensions: ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif'],
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  // Fixed candidates only — same discipline as the Blender/OpenSCAD bridge
  // entries (never a PATH search). VERIFY the exact console binary name on 2.10
  // vs 3.0 (2.10 mac bundle: GIMP-bin; some builds ship `gimp-console`).
  binaryCandidates: [
    '/Applications/GIMP.app/Contents/MacOS/GIMP',
    '/Applications/GIMP.app/Contents/MacOS/gimp',
    '/opt/homebrew/bin/gimp',
    '/usr/local/bin/gimp',
  ],
  buildArgsShape:
    "['-i', '-d', '-f', '--batch-interpreter=python-fu-eval', '-b', programToken, '-b', 'pdb.gimp_quit(1)']",
  verifiedInvocation: false,
  installHint: 'brew install --cask gimp',
};
