// autocadScriptAdapter — PURE generator of AutoCAD command scripts (.scr) for
// the headless `autocad_core` engine (plan P3, the "generate the script" half
// of the scriptable-app-adapter pattern).
//
// PAIRING: `src/lib/appScriptRunner.ts` owns the `autocad_core` engine
// descriptor — it takes a validated `sourcePath` (the .scr file the bridge
// already wrote) + optional `inputPath` (the drawing) and produces the argv
// `['/i', <dwg>, '/s', <scr>]` for `accoreconsole`. THIS module produces the
// TEXT that goes INTO that .scr: a validated, newline-separated list of AutoCAD
// commands. It never touches the filesystem, spawns a process, or resolves a
// binary. Zero runtime imports (`import type` only) → tsx-loadable
// (smoke: autocad-script-adapter).
//
// ── VERIFY BEFORE WIRING ─────────────────────────────────────────────────────
// The .scr command SYNTAX below was NOT freshly verified on a real AutoCAD
// install. VERIFY the `accoreconsole /i <dwg> /s <script.scr>` invocation AND
// each command's exact syntax/prompt sequence (EXPORTPDF vs PLOT, -PURGE
// switches, AUDIT Y/N, DXFOUT precision/version prompts, whether FILEDIA=0 is
// needed so the export commands accept a path on the command line instead of a
// dialog) on a real AutoCAD install before `desktop.run_app_script` is wired
// for autocad_core. Every generated command comes from the documented allowlist
// below; nothing is assembled from free-form user text.
//
// ── LOAD-BEARING SECURITY BAR ────────────────────────────────────────────────
// A .scr executes AutoCAD commands LINE BY LINE — a bare newline (or, for many
// prompts, a bare SPACE) is an <Enter> that terminates the current input and
// starts the next command. So a newline or a stray token inside a user-provided
// value (file path, layer name, block name, number) is a COMMAND INJECTION, not
// a benign string escape. This module therefore:
//   * validates every user value against a STRICT per-field allowlist
//     (mirrors cadCodeExecutor's OPENSCAD_PARAM_KEY/VALUE_REGEX + validateCadPath
//      discipline), and
//   * embeds paths ONLY through `scrPathToken` (double-quoted, with every
//     unsafe char — quotes, control chars, newlines, `;` script-comment, shell
//     metachars, non-BMP — rejected UP FRONT so no escaping-vs-splitting
//     ambiguity remains), never by raw concatenation.
// Anything that fails is DROPPED WITH A NOTE (or the whole build is rejected for
// a required field) — never silently mangled into a command line.

// ── Operation set (documented, bounded) ──────────────────────────────────────
export type AutoCadOperation =
  | 'export_pdf' //     current drawing → single PDF (EXPORTPDF)
  | 'export_dxf' //     current drawing → DXF (DXFOUT, version + precision bounded)
  | 'purge_and_audit' // headless cleanup: -PURGE all + AUDIT (fix errors)
  | 'run_commands'; //  a bounded whitelist of safe zero-arg / low-arg commands

export const AUTOCAD_OPERATIONS: readonly AutoCadOperation[] = [
  'export_pdf',
  'export_dxf',
  'purge_and_audit',
  'run_commands',
] as const;

/** The engine this script targets (see appScriptRunner.APP_SCRIPT_ENGINE_REGISTRY). */
export const AUTOCAD_SCRIPT_ENGINE = 'autocad_core';
/** .scr is the only extension accreconsole's `/s` switch accepts. */
export const AUTOCAD_SCRIPT_EXTENSION = 'scr';

// ── Value regexes (strict allowlists) ────────────────────────────────────────
// Numeric-only, plain decimals (no exponent, no metachars) — mirrors
// cadCodeExecutor.OPENSCAD_PARAM_VALUE_REGEX for the numeric case. Used for
// DXF precision only.
const PLAIN_INT_REGEX = /^\d{1,4}$/;

// AutoCAD symbol names (layer/block/style). AutoCAD permits letters, digits and
// `$ - _` in names; we deliberately EXCLUDE spaces, wildcards (`* ?`), commas,
// and every shell/script metachar. Comma is excluded because AutoCAD treats it
// as a list separator inside a single prompt (another injection vector). This
// is stricter than AutoCAD itself allows, on purpose.
const SYMBOL_NAME_REGEX = /^[A-Za-z0-9_$-]{1,255}$/;

// ── Path validation + safe .scr token ─────────────────────────────────────────
// LOCKSTEP with cadCodeExecutor.validateCadPath ↔ appScriptRunner.validateRunnerPath
// ↔ scripts/claude-bridge.js validateDesktopPathServer: keep the reject-set
// aligned. NOTE the bridge re-validates the OUTPUT path it stats and the .scr
// path it writes, so a path that passes here still passes there.
//
// Additional .scr-specific rejects beyond the shared shell reject-set:
//   * `"` — we wrap the path in double quotes so an embedded space is a single
//     token; an embedded quote would close the wrap and let the remainder leak
//     as separate command tokens. Reject rather than try to escape (AutoCAD's
//     script quoting has no universally reliable inner-quote escape).
//   * `;` — inside a .scr line, `;` is not shell; but AutoCAD SCRIPT treats a
//     leading `;` as a comment and it is a menu/command separator in some
//     contexts. Already covered by the shared shell-metachar reject, kept
//     explicit here for intent.
function validateAutoCadPath(
  raw: unknown,
  label: string,
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${label} is empty` };
  if (trimmed.length > 1024) return { ok: false, error: `${label} exceeds 1024 chars` };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: `${label} contains control characters` };
  // Shared shell-metachar reject-set (LOCKSTEP) + `"` (breaks the quote wrap).
  if (/[`$;|&><\n"]/.test(trimmed)) return { ok: false, error: `${label} contains a disallowed metacharacter` };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: `${label} contains characters outside the basic multilingual plane` };
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: `${label} must not contain ".." traversal` };
  return { ok: true, path: trimmed };
}

/**
 * Turn an already-VALIDATED path into a single safe .scr token. The path has no
 * quotes, newlines, control chars, or shell/script metachars (validateAutoCadPath
 * rejected all of them), so wrapping in double quotes makes any embedded SPACE a
 * single command token instead of an <Enter>-terminated field. This is the ONLY
 * way a path enters generated script text — never raw concatenation.
 */
function scrPathToken(validatedPath: string): string {
  return `"${validatedPath}"`;
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9_]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeExt(raw: unknown): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^\./, '')
    .slice(0, 12);
}

// ── run_commands whitelist ────────────────────────────────────────────────────
// Each entry is a fixed, documented AutoCAD command that is safe to run headless
// with NO user-supplied argument (or a fully-fixed argument sequence). The value
// is the exact line(s) emitted. Keeping the whole command text server-defined is
// the point: user input only SELECTS an entry by name, it never contributes
// tokens to the line. // VERIFY each command name + that it needs no interactive
// prompt under accoreconsole.
const RUN_COMMAND_WHITELIST: Record<string, { lines: readonly string[]; describe: string }> = {
  // Regenerate the drawing display / all viewports.
  regen: { lines: ['REGENALL'], describe: 'Regenerate all viewports (REGENALL)' },
  // Zoom to drawing extents (harmless view change; useful before a plot).
  zoom_extents: { lines: ['ZOOM', 'E'], describe: 'Zoom to drawing extents (ZOOM / Extents)' },
  // Recompute all fields.
  update_fields: { lines: ['UPDATEFIELD', 'ALL', ''], describe: 'Update all fields (UPDATEFIELD / All)' },
  // Purge zero-length geometry + empty text objects (documented cleanup).
  purge_zero_length: { lines: ['-OVERKILL', 'ALL', '', ''], describe: 'Remove duplicate/overlapping geometry (-OVERKILL / All)' },
  // Audit + fix without the purge (lighter than purge_and_audit operation).
  audit_fix: { lines: ['AUDIT', 'Y'], describe: 'Audit the drawing and fix detected errors (AUDIT / Yes)' },
};

export const AUTOCAD_RUN_COMMAND_KEYS: readonly string[] = Object.keys(RUN_COMMAND_WHITELIST);

// ── DXF version allowlist ─────────────────────────────────────────────────────
// DXFOUT's "version" prompt accepts a fixed set of release tokens. We allowlist
// a small documented set and map to the exact token DXFOUT expects. // VERIFY
// the exact prompt tokens (they differ subtly by AutoCAD release).
const DXF_VERSION_TOKENS: Record<string, string> = {
  r12: 'R12',
  '2000': '2000',
  '2004': '2004',
  '2007': '2007',
  '2010': '2010',
  '2013': '2013',
  '2018': '2018',
};

export const AUTOCAD_DXF_VERSIONS: readonly string[] = Object.keys(DXF_VERSION_TOKENS);

// ── Typed inputs ──────────────────────────────────────────────────────────────

export interface AutoCadExportPdfInput {
  op: 'export_pdf';
  /** Output PDF path (validated; must end in .pdf). */
  outputPath: string;
}

export interface AutoCadExportDxfInput {
  op: 'export_dxf';
  /** Output DXF path (validated; must end in .dxf). */
  outputPath: string;
  /** DXF release token; one of AUTOCAD_DXF_VERSIONS. Defaults to 2018 with a note. */
  version?: string;
  /** Decimal precision (0..16 in AutoCAD); clamped/validated, defaults to 16. */
  precision?: number;
}

export interface AutoCadPurgeAndAuditInput {
  op: 'purge_and_audit';
  /** When true, also run -PURGE Regapps. Defaults false (named objects only). */
  purgeRegapps?: boolean;
}

export interface AutoCadRunCommandsInput {
  op: 'run_commands';
  /** Whitelist keys (AUTOCAD_RUN_COMMAND_KEYS). Unknown keys dropped with a note. */
  commands: string[];
}

export type AutoCadScriptInput =
  | AutoCadExportPdfInput
  | AutoCadExportDxfInput
  | AutoCadPurgeAndAuditInput
  | AutoCadRunCommandsInput;

export interface AutoCadScriptBuild {
  /** Newline-separated AutoCAD command script (the .scr file body). */
  script: string;
  scriptExtension: 'scr';
  /** The output file the script writes, when the op produces one (for stat-verify). */
  outputHint?: string;
  notes: string[];
}

export type AutoCadArgsValidation =
  | { ok: true; value: AutoCadScriptInput }
  | { error: string };

// ── Script preamble ───────────────────────────────────────────────────────────
// Headless-safe defaults. FILEDIA/CMDDIA 0 so file/command dialogs never pop
// (accoreconsole has no GUI, but export commands otherwise expect a dialog);
// CMDECHO 0 to keep stdout clean. // VERIFY these system variables behave under
// accoreconsole (some are GUI-only no-ops there, which is harmless).
const SCRIPT_PREAMBLE: readonly string[] = [
  '; Generated by Underground Circle autocadScriptAdapter — DO NOT hand-edit.',
  '; Headless (accoreconsole /s) command script. One command per line.',
  'FILEDIA',
  '0',
  'CMDDIA',
  '0',
  'CMDECHO',
  '0',
];

// A trailing blank line ensures the last command's <Enter> is delivered.
function assembleScript(bodyLines: string[]): string {
  return [...SCRIPT_PREAMBLE, ...bodyLines, ''].join('\n');
}

// ── Per-op builders (each returns body lines + notes + outputHint) ────────────

function buildExportPdf(input: AutoCadExportPdfInput): AutoCadScriptBuild {
  const notes: string[] = [];
  const validated = validateAutoCadPath(input.outputPath, 'outputPath');
  if (!validated.ok) {
    return { script: '', scriptExtension: 'scr', notes: [`export_pdf aborted — ${validated.error}.`] };
  }
  const ext = extensionOf(validated.path);
  if (ext !== 'pdf') {
    return { script: '', scriptExtension: 'scr', notes: [`export_pdf aborted — outputPath must end in .pdf (got .${ext || '?'}).`] };
  }
  // EXPORTPDF (current layout → PDF). // VERIFY the exact prompt sequence: some
  // releases prompt "Current layout / All layouts", then a filename. We drive
  // the single-layout default and supply the quoted path.
  const body = ['EXPORTPDF', scrPathToken(validated.path)];
  notes.push(
    'EXPORTPDF exports the CURRENT layout to a single PDF; open the target layout first if a specific sheet is required.',
  );
  notes.push('Verify the PDF with desktop.file_stat after the run — accoreconsole reports no output path itself.');
  return { script: assembleScript(body), scriptExtension: 'scr', outputHint: validated.path, notes };
}

function buildExportDxf(input: AutoCadExportDxfInput): AutoCadScriptBuild {
  const notes: string[] = [];
  const validated = validateAutoCadPath(input.outputPath, 'outputPath');
  if (!validated.ok) {
    return { script: '', scriptExtension: 'scr', notes: [`export_dxf aborted — ${validated.error}.`] };
  }
  const ext = extensionOf(validated.path);
  if (ext !== 'dxf') {
    return { script: '', scriptExtension: 'scr', notes: [`export_dxf aborted — outputPath must end in .dxf (got .${ext || '?'}).`] };
  }

  // Version token (allowlist → exact DXFOUT token). Default 2018.
  let versionToken = DXF_VERSION_TOKENS['2018'];
  const rawVersion = normalizeExt(input.version).length ? String(input.version).trim().toLowerCase() : '';
  if (rawVersion) {
    if (DXF_VERSION_TOKENS[rawVersion]) {
      versionToken = DXF_VERSION_TOKENS[rawVersion];
    } else {
      notes.push(`Dropped DXF version "${String(input.version).slice(0, 20)}" (not one of ${AUTOCAD_DXF_VERSIONS.join(', ')}) — defaulted to 2018.`);
    }
  }

  // Precision: DXFOUT "Enter decimal places (0 to 16)". Strict int, clamped.
  let precisionToken = '16';
  if (input.precision !== undefined && input.precision !== null) {
    const asString = typeof input.precision === 'number' && Number.isFinite(input.precision)
      ? String(Math.trunc(input.precision))
      : '';
    if (asString && PLAIN_INT_REGEX.test(asString)) {
      const n = Math.max(0, Math.min(16, Number(asString)));
      precisionToken = String(n);
      if (String(n) !== asString) notes.push(`DXF precision ${asString} clamped to ${n} (valid range 0..16).`);
    } else {
      notes.push(`Dropped DXF precision "${String(input.precision).slice(0, 20)}" (must be an integer 0..16) — defaulted to 16.`);
    }
  }

  // DXFOUT sequence: filename → version → decimal precision.
  // // VERIFY: some releases prompt Binary/ASCII and the precision only for
  // certain versions; the quoted path is always the first token.
  const body = ['DXFOUT', scrPathToken(validated.path), versionToken, precisionToken];
  notes.push('DXFOUT writes the DXF for the CURRENT drawing; confirm the intended model/paper space is active.');
  notes.push('Verify the DXF with desktop.file_stat after the run.');
  return { script: assembleScript(body), scriptExtension: 'scr', outputHint: validated.path, notes };
}

function buildPurgeAndAudit(input: AutoCadPurgeAndAuditInput): AutoCadScriptBuild {
  const notes: string[] = [];
  // -PURGE (hyphen = command-line, no dialog): purge All named objects, confirm
  // No to per-item verification, then optionally Regapps. Then AUDIT + fix.
  // // VERIFY the exact -PURGE sub-prompts (All / Regapps / verify each Y/N).
  const body: string[] = ['-PURGE', 'All', '', 'N'];
  if (input.purgeRegapps === true) {
    body.push('-PURGE', 'Regapps', '', 'N');
    notes.push('Regapp purge included (purgeRegapps=true).');
  }
  body.push('AUDIT', 'Y');
  notes.push('-PURGE removes unused named objects (layers/blocks/styles); AUDIT then fixes structural errors.');
  notes.push('This MUTATES the drawing — it must be saved (QSAVE) or exported to persist; run under approval.');
  return { script: assembleScript(body), scriptExtension: 'scr', notes };
}

function buildRunCommands(input: AutoCadRunCommandsInput): AutoCadScriptBuild {
  const notes: string[] = [];
  const requested = Array.isArray(input.commands) ? input.commands : [];
  const body: string[] = [];
  let accepted = 0;
  for (const raw of requested.slice(0, 32)) {
    const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const entry = RUN_COMMAND_WHITELIST[key];
    if (!entry) {
      notes.push(`Dropped command "${String(raw).slice(0, 30)}" — not in the run_commands whitelist (${AUTOCAD_RUN_COMMAND_KEYS.join(', ')}).`);
      continue;
    }
    body.push(...entry.lines);
    accepted += 1;
  }
  if (requested.length > 32) notes.push(`run_commands truncated to the first 32 entries (got ${requested.length}).`);
  if (accepted === 0) {
    return {
      script: '',
      scriptExtension: 'scr',
      notes: [`run_commands aborted — no whitelisted commands supplied (allowed: ${AUTOCAD_RUN_COMMAND_KEYS.join(', ')}).`, ...notes],
    };
  }
  notes.push('run_commands emits only server-defined command lines; user input selected entries by name and contributed no tokens.');
  return { script: assembleScript(body), scriptExtension: 'scr', notes };
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate a raw request into a typed `AutoCadScriptInput` (or a typed error).
 * Only shape/enum checks here — per-field value validation (paths, versions,
 * precision, command keys) happens in the builders so a partial-but-usable
 * request can still drop bad fields with a note. Never throws.
 */
export function validateAutoCadArgs(input: unknown): AutoCadArgsValidation {
  if (!input || typeof input !== 'object') return { error: 'request must be an object' };
  const r = input as Record<string, unknown>;
  const op = r.op;
  if (typeof op !== 'string' || !(AUTOCAD_OPERATIONS as readonly string[]).includes(op)) {
    return { error: `op must be one of ${AUTOCAD_OPERATIONS.join(', ')}` };
  }
  switch (op as AutoCadOperation) {
    case 'export_pdf': {
      if (typeof r.outputPath !== 'string' || !r.outputPath.trim()) return { error: 'export_pdf requires a non-empty outputPath' };
      return { ok: true, value: { op: 'export_pdf', outputPath: r.outputPath } };
    }
    case 'export_dxf': {
      if (typeof r.outputPath !== 'string' || !r.outputPath.trim()) return { error: 'export_dxf requires a non-empty outputPath' };
      const value: AutoCadExportDxfInput = { op: 'export_dxf', outputPath: r.outputPath };
      if (typeof r.version === 'string') value.version = r.version;
      if (typeof r.precision === 'number') value.precision = r.precision;
      return { ok: true, value };
    }
    case 'purge_and_audit': {
      return { ok: true, value: { op: 'purge_and_audit', purgeRegapps: r.purgeRegapps === true } };
    }
    case 'run_commands': {
      if (!Array.isArray(r.commands)) return { error: 'run_commands requires a commands array' };
      return { ok: true, value: { op: 'run_commands', commands: r.commands.map((c) => String(c)) } };
    }
    default:
      return { error: `unsupported op` };
  }
}

// ── Public builder ────────────────────────────────────────────────────────────

/**
 * Build a validated AutoCAD .scr command script for a bounded operation.
 * Returns `{ script, scriptExtension:'scr', outputHint?, notes }`. On a fatal
 * input problem (bad op, unusable required path) the `script` is '' and the
 * reason is in `notes` — the caller checks `script` before staging + running.
 * Every user value is allowlist-validated and safely embedded; bad optional
 * fields are dropped with a note, never mangled. Never throws.
 */
export function buildAutoCadScript(op: unknown, input?: unknown): AutoCadScriptBuild {
  // Accept either buildAutoCadScript(input) with {op,...} or
  // buildAutoCadScript(op, {...}) for ergonomics.
  let request: unknown;
  if (typeof op === 'string') {
    request = { ...(input && typeof input === 'object' ? (input as Record<string, unknown>) : {}), op };
  } else {
    request = op;
  }

  const validation = validateAutoCadArgs(request);
  if (!('ok' in validation)) {
    return { script: '', scriptExtension: 'scr', notes: [`Invalid AutoCAD request — ${validation.error}.`] };
  }
  const value = validation.value;
  switch (value.op) {
    case 'export_pdf':
      return buildExportPdf(value);
    case 'export_dxf':
      return buildExportDxf(value);
    case 'purge_and_audit':
      return buildPurgeAndAudit(value);
    case 'run_commands':
      return buildRunCommands(value);
    default:
      return { script: '', scriptExtension: 'scr', notes: ['Unsupported AutoCAD operation.'] };
  }
}

/** One-line plain-language description of the operation for an approval preview. Never throws. */
export function describeAutoCadOperation(input: unknown): string {
  const validation = validateAutoCadArgs(input && typeof input === 'object' ? input : {});
  if (!('ok' in validation)) return 'Run an AutoCAD script (approval-gated local execution)';
  const value = validation.value;
  switch (value.op) {
    case 'export_pdf':
      return 'Export the current AutoCAD drawing to PDF (accoreconsole, approval-gated)';
    case 'export_dxf': {
      const v = typeof value.version === 'string' && DXF_VERSION_TOKENS[value.version.toLowerCase()] ? ` R${DXF_VERSION_TOKENS[value.version.toLowerCase()]}` : '';
      return `Export the current AutoCAD drawing to DXF${v} (accoreconsole, approval-gated)`;
    }
    case 'purge_and_audit':
      return 'Purge unused objects and audit/repair the AutoCAD drawing (accoreconsole, approval-gated, MUTATES the drawing)';
    case 'run_commands': {
      const keys = value.commands.map((c) => c.trim().toLowerCase()).filter((c) => RUN_COMMAND_WHITELIST[c]);
      const list = keys.length ? keys.join(', ') : 'no valid commands';
      return `Run whitelisted AutoCAD commands (${list}) via accoreconsole (approval-gated)`;
    }
    default:
      return 'Run an AutoCAD script (approval-gated local execution)';
  }
}
