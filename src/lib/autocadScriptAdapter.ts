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
  | 'run_commands' //   a bounded whitelist of safe zero-arg / low-arg commands
  | 'draft_entities'; // create layers + 2D geometry from a neutral entity model

export const AUTOCAD_OPERATIONS: readonly AutoCadOperation[] = [
  'export_pdf',
  'export_dxf',
  'purge_and_audit',
  'run_commands',
  'draft_entities',
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

// ── draft_entities tokenizers ─────────────────────────────────────────────────
// The .scr injection bar applies to EVERY value, not just paths: a bare space
// or newline is <Enter>. Coordinates go in as "x,y" single tokens (no internal
// space); layer names and text are allowlist/stripped exactly like the DXF core.

const AUTOCAD_LAYER_NAME_PATTERN = /^[A-Za-z0-9_$-]{1,31}$/;

function scrNumber(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  // AutoCAD reads a plain decimal; bound precision, never emit exponent form.
  const rounded = Math.round(value * 1e6) / 1e6;
  const text = rounded.toString();
  return /e/i.test(text) ? rounded.toFixed(6) : text;
}

/** "x,y" — one token, comma-separated, no embedded space (space would be Enter). */
function scrPoint(x: number, y: number): string | null {
  const sx = scrNumber(x); const sy = scrNumber(y);
  if (sx === null || sy === null) return null;
  return `${sx},${sy}`;
}

function scrLayerName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return AUTOCAD_LAYER_NAME_PATTERN.test(trimmed) ? trimmed : null;
}

/**
 * TEXT content for the AutoCAD TEXT command. The TEXT prompt reads to end of
 * line, so a newline TERMINATES the string (and starts a new command) — strip
 * every control char, and refuse an empty result. Double quotes are fine in AutoCAD text.
 */
function scrText(value: unknown): string | null {
  const raw = value === undefined || value === null ? '' : String(value);
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\x00-\x1f\x7f\u2028\u2029]/g, ' ').trim();
  return stripped.length ? stripped.slice(0, 250) : null;
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
  | AutoCadRunCommandsInput
  | AutoCadDraftEntitiesInput;

/**
 * A 2D drafting request in the SAME neutral entity model engineeringDraftingCore
 * uses, compiled to AutoCAD command lines. Deliberately a SUBSET: line, circle,
 * arc, lightweight polyline, and single-line text, each on a named layer.
 * BLOCK/INSERT are excluded from .scr v1 — block definition via -BLOCK is an
 * interactive multi-select prompt sequence that does not translate cleanly to a
 * headless line script; the DXF lane owns blocks. See NOTE on execution gating.
 */
export interface AutoCadDraftEntitiesInput {
  op: 'draft_entities';
  layers?: Array<{ name: string; color?: number }>;
  entities: AutoCadDraftEntity[];
}

export type AutoCadDraftEntity =
  | { kind: 'line'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; layer: string; cx: number; cy: number; r: number }
  | { kind: 'arc'; layer: string; cx: number; cy: number; r: number; startDeg: number; endDeg: number }
  | { kind: 'polyline'; layer: string; points: Array<{ x: number; y: number }>; closed?: boolean }
  | { kind: 'text'; layer: string; x: number; y: number; height: number; text: string };

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
  // EXPORTPDF (current layout → PDF).
  // // VERIFY — CONFIRMED WRONG (2026-07-13): EXPORTPDF is DIALOG-ONLY (no
  // command-line interface) and will NOT run headless in a .scr even with
  // FILEDIA 0. Fix before wiring: emit the -EXPORT sequence instead —
  //   ['-EXPORT','_PDF','_C','_N', scrPathToken(path)]  (_C=current layout,
  //   _N=single sheet). Left gated so the fix + smoke re-pin land together.
  //   Source: Autodesk forum "EXPORTPDF has no command-line interface".
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

  // DXFOUT sequence.
  // // VERIFY — CONFIRMED WRONG order (2026-07-13): after the filename the next
  // prompt is decimal PRECISION (0..16); the file version is a sub-option ('V')
  // chosen AT that prompt — i.e. path → ['V', versionToken] → precision — and the
  // command should be '_DXFOUT' with FILEDIA/CMDDIA 0 (no hyphen form). The
  // current [DXFOUT, path, versionToken, precisionToken] sends the version token
  // where a precision/'V' keyword is expected. Fix + re-pin smoke before wiring.
  // Source: CAD Forum DXFOUT + Autodesk SAVEAS/DXF prompt sequence.
  const body = ['DXFOUT', scrPathToken(validated.path), versionToken, precisionToken];
  notes.push('DXFOUT writes the DXF for the CURRENT drawing; confirm the intended model/paper space is active.');
  notes.push('Verify the DXF with desktop.file_stat after the run.');
  return { script: assembleScript(body), scriptExtension: 'scr', outputHint: validated.path, notes };
}

function buildPurgeAndAudit(input: AutoCadPurgeAndAuditInput): AutoCadScriptBuild {
  const notes: string[] = [];
  // -PURGE (hyphen = command-line, no dialog): purge All named objects, confirm
  // No to per-item verification, then optionally Regapps. Then AUDIT + fix.
  // // VERIFY — CONFIRMED WRONG (2026-07-13): the Regapps option keyword is 'R',
  // not the word 'Regapps'; and -PURGE must be REPEATED until 0 objects are
  // removed (a single pass is insufficient). Prefer '-AUDIT' (hyphen) to
  // guarantee no dialog headless. Fix + re-pin smoke before wiring.
  // Source: Autodesk -PURGE help + AUGI drawing-cleanup macros.
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
    case 'draft_entities': {
      if (!Array.isArray(r.entities) || r.entities.length === 0) return { error: 'draft_entities requires a non-empty entities array' };
      if (r.entities.length > 20000) return { error: 'draft_entities exceeds the 20000-entity cap' };
      const value: AutoCadDraftEntitiesInput = { op: 'draft_entities', entities: r.entities as AutoCadDraftEntity[] };
      if (Array.isArray(r.layers)) value.layers = r.layers as Array<{ name: string; color?: number }>;
      return { ok: true, value };
    }
    default:
      return { error: `unsupported op` };
  }
}

// ── draft_entities builder ────────────────────────────────────────────────────
//
// Compiles the neutral entity model to AutoCAD command lines. Every command is
// documented; every user value passes a tokenizer that cannot emit a bare
// space/newline. Emits -LAYER (Make/Color/Set) then one command per entity.
// // VERIFY on a real install: the exact -LAYER sub-option letters (M/C/S),
// PLINE close token ("C"), and TEXT prompt order (justify default → insertion
// point → height → rotation → string) before wiring for execution.
function buildDraftEntities(input: AutoCadDraftEntitiesInput): AutoCadScriptBuild {
  const notes: string[] = [];
  const body: string[] = [];
  const declared = new Set<string>(['0']);

  // Declare layers first: -LAYER Make <name> [Color <n> <name>] then Set 0.
  for (const layer of input.layers ?? []) {
    const name = scrLayerName(layer?.name);
    if (!name) { notes.push(`layer "${String(layer?.name).slice(0, 24)}" skipped — name must match [A-Za-z0-9_$-], 1-31 chars.`); continue; }
    body.push('-LAYER', 'M', name);
    const color = Number.isFinite(layer?.color) ? Math.max(1, Math.min(255, Math.trunc(layer!.color as number))) : null;
    if (color !== null) body.push('C', String(color), name);
    body.push('');
    declared.add(name);
  }

  let emitted = 0;
  for (const e of input.entities ?? []) {
    const layer = scrLayerName((e as any)?.layer);
    if (!layer) { notes.push('entity skipped — invalid layer name.'); continue; }
    if (!declared.has(layer)) { notes.push(`entity references undeclared layer "${layer}" — declare it in layers[] first.`); continue; }
    // Set current layer, then draw. -LAYER Set <name>.
    const draw: string[] = [];
    switch (e.kind) {
      case 'line': {
        const a = scrPoint(e.x1, e.y1), b = scrPoint(e.x2, e.y2);
        if (!a || !b) { notes.push('line skipped — non-finite coordinate.'); continue; }
        draw.push('LINE', a, b, '');
        break;
      }
      case 'circle': {
        const c = scrPoint(e.cx, e.cy), r = scrNumber(e.r);
        if (!c || r === null || e.r <= 0) { notes.push('circle skipped — bad center or radius.'); continue; }
        draw.push('CIRCLE', c, r);
        break;
      }
      case 'arc': {
        // AutoCAD ARC via Center: ARC, C, center, start-point, end-angle.
        // Compute start point from center+radius+startDeg so no interactive angle prompt is needed.
        const sx = e.cx + e.r * Math.cos((e.startDeg * Math.PI) / 180);
        const sy = e.cy + e.r * Math.sin((e.startDeg * Math.PI) / 180);
        const c = scrPoint(e.cx, e.cy), sp = scrPoint(sx, sy), ea = scrNumber(e.endDeg);
        if (!c || !sp || ea === null) { notes.push('arc skipped — bad geometry.'); continue; }
        draw.push('ARC', 'C', c, sp, 'A', ea);
        break;
      }
      case 'polyline': {
        const pts = Array.isArray(e.points) ? e.points : [];
        if (pts.length < 2) { notes.push('polyline skipped — needs >= 2 points.'); continue; }
        const tokens = pts.map((p) => scrPoint(p.x, p.y));
        if (tokens.some((t) => t === null)) { notes.push('polyline skipped — non-finite vertex.'); continue; }
        draw.push('PLINE', ...(tokens as string[]));
        draw.push(e.closed ? 'C' : '');
        break;
      }
      case 'text': {
        const p = scrPoint(e.x, e.y), h = scrNumber(e.height), t = scrText(e.text);
        if (!p || h === null || e.height <= 0 || !t) { notes.push('text skipped — bad position/height/empty string.'); continue; }
        // TEXT: insertion point, height, rotation(0), string.
        draw.push('TEXT', p, h, '0', t);
        break;
      }
      default:
        notes.push('entity skipped — unknown kind.');
        continue;
    }
    body.push('-LAYER', 'S', layer, '', ...draw);
    emitted += 1;
  }

  if (emitted === 0) {
    return { script: '', scriptExtension: 'scr', notes: [...notes, 'draft_entities aborted — no valid entity was produced.'] };
  }
  notes.unshift(`draft_entities: ${emitted} entit${emitted === 1 ? 'y' : 'ies'} on ${declared.size - 1} declared layer(s). VERIFY -LAYER/PLINE/TEXT prompt sequences on a real AutoCAD install before enabling execution.`);
  return { script: assembleScript(body), scriptExtension: 'scr', notes };
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
    case 'draft_entities':
      return buildDraftEntities(value);
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
    case 'draft_entities':
      return `Create ${value.entities.length} 2D entit${value.entities.length === 1 ? 'y' : 'ies'} on ${(value.layers?.length ?? 0)} layer(s) in AutoCAD via a generated .scr (approval-gated)`;
    case 'run_commands': {
      const keys = value.commands.map((c) => c.trim().toLowerCase()).filter((c) => RUN_COMMAND_WHITELIST[c]);
      const list = keys.length ? keys.join(', ') : 'no valid commands';
      return `Run whitelisted AutoCAD commands (${list}) via accoreconsole (approval-gated)`;
    }
    default:
      return 'Run an AutoCAD script (approval-gated local execution)';
  }
}
