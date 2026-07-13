// premiereProScriptAdapter — PURE generator for bounded Adobe Premiere Pro
// automation. It is the ExtendScript (JSX) sibling of
// afterEffectsScriptAdapter.ts / illustratorExtendScriptAdapters.ts, applied to
// Premiere Pro's scriptable DOM (`app.project`, `app.encoder`). Like the AE
// adapter it emits VALIDATED .jsx TEXT only — it never spawns Premiere, resolves
// a binary, or touches the filesystem. A bridge would run the emitted script
// INSIDE a running Premiere (a CEP/UXP panel's `evalScript`, or `#target
// premierepro` DoScript) and parse the single JSON result line.
//
// PURITY: zero runtime imports (import type only, none needed) → tsx-loadable
// (smoke: premiere-pro-script-adapter). It shapes + validates + emits script
// TEXT only. LOCKSTEP with the bridge's path/arg validators.
//
// ── SURFACE CHOICE + VERIFY BEFORE WIRING ────────────────────────────────────
// docs/apps/premiere-pro.md ranks Premiere's control surfaces. Premiere 25.6
// (Nov 2025) moved its extensibility standard to UXP; the legacy ExtendScript
// (CEP) DOM is FROZEN (no further development) and Adobe's plan is to support it
// only through ~September 2026. There is NO documented, reliable one-shot
// command-line drive of Premiere — Adobe explicitly says passing scripts on the
// command line is "not recommended" and behavior varies by platform. So the
// realistic external lane is: a resident panel (CEP today / UXP for new work)
// runs this generated script inside Premiere.
//
// This adapter generates ExtendScript because that is still the DOCUMENTED,
// broadly-referenceable surface today and it is the closest sibling of the AE
// adapter (both ES3). New buildout SHOULD target the UXP DOM
// (https://developer.adobe.com/premiere-pro/uxp/ppro-reference/); the same
// validated inputs + JSON-result contract carry over, but every method here is
// unverified against a live install and MUST be re-confirmed before wiring —
// each builder carries `verifiedInvocation: false`.
//
// The API entry points below follow the Premiere Pro Scripting Guide
// (ppro-scripting.docsforadobe.dev) + Adobe-CEP PProPanel samples:
//   * app.project.importFiles([paths], suppressUI, importAsNumberedStills)
//   * app.project.activeSequence.videoTracks[i].overwriteClip(projectItem, timeSeconds)
//     (also insertClip; BOTH require a projectItem, NOT a trackItem)
//   * app.encoder.encodeSequence(sequence, outputPath, presetPath, workArea,
//     removeUponCompletion)  // workArea: 0 ENCODE_ENTIRE / 1 ENCODE_IN_TO_OUT /
//     2 ENCODE_WORK_AREA. Returns a job-id String, or 0 on failure.
//   * sequence.getSettings() / sequence.setSettings(SequenceSettings)  (numeric
//     props frameSizeHorizontal / frameSizeVertical)
// These were NOT freshly run against a live Premiere install here.
// See PREMIERE_PRO_DOC_VERIFIED_INVOCATION for the source URLs.
//
// ── LOAD-BEARING SECURITY BAR ────────────────────────────────────────────────
// EVERYTHING the script does with user input runs through ONE of two guards:
//
//   * Paths (project item source paths, export output path, preset path) use the
//     CAD `validateCadPath` discipline (length / control-char / shell-metachar /
//     non-BMP / ".." traversal reject) AND are embedded into JSX ONLY as a
//     double-quoted ES3 string literal via `extendScriptStringLiteral`. Premiere
//     ExtendScript is ES3; that escaper is strict — it REJECTS control chars /
//     newlines up front rather than emitting `\n`/`\uXXXX` that older hosts
//     mishandle. Values are NEVER raw-concatenated into script text.
//   * Enums (sequence-setting key, work-area type) pass an allowlist; numbers
//     (frame size, boolean-ish flags) are bounded and re-stringified from a
//     `Number`, so only digits ever reach the script.
//
// String-literal LABELS (a sequence NAME the script matches by exact string)
// permit `"`/`\` (Premiere allows a sequence named `Final "v3"`; the escaper
// makes them inert CONTENT) but still reject control chars / newlines / non-BMP
// / path separators. Anything failing validation is DROPPED WITH A NOTE
// (optional field) or the whole build is REJECTED (required field) — never
// silently mangled. Degenerate input NEVER throws.
//
// ── APPROVAL / EVIDENCE (see docs/apps/premiere-pro.md) ──────────────────────
// import_media / add_to_timeline / set_sequence_setting MUTATE the project;
// export_sequence WRITES A FILE (via the AME queue) and consumes machine time.
// All are approval-gated by the Premiere app profile (timeline edits, media
// relink, render/export, overwrite project/media). The generated scripts NEVER
// save the project. The caller must echo the project/sequence identity in the
// approval text, prove an export with a `desktop.file_stat` on the output file,
// and never overwrite source media. Timeline mutation targets an EXACT sequence
// by name and fails closed on mismatch (never the "active" sequence blindly).

// ── Surface / operation identifiers ──────────────────────────────────────────

/** ExtendScript source extension the bridge runs inside Premiere. */
export const PREMIERE_PRO_SCRIPT_EXTENSION = 'jsx' as const;

/** Premiere project source extension (informational; the JSX assumes a project
 *  is already OPEN — it does not open a .prproj itself). */
export const PREMIERE_PRO_PROJECT_EXTENSIONS: readonly string[] = ['prproj'];

/**
 * Bounded JSX operations. All four map to documented Premiere DOM calls but stay
 * `verifiedInvocation:false` until a live Premiere run confirms the DOM.
 *   - import_media        → app.project.importFiles([...])
 *   - add_to_timeline     → sequence.videoTracks[i].overwriteClip / insertClip
 *   - export_sequence     → app.encoder.encodeSequence(...) (AME handoff)
 *   - set_sequence_setting→ sequence.getSettings()/setSettings()
 */
export type PremiereProScriptOperation =
  | 'import_media'
  | 'add_to_timeline'
  | 'export_sequence'
  | 'set_sequence_setting';

export const PREMIERE_PRO_SCRIPT_OPERATIONS: readonly PremiereProScriptOperation[] = [
  'import_media',
  'add_to_timeline',
  'export_sequence',
  'set_sequence_setting',
] as const;

/**
 * Sequence settings `set_sequence_setting` can change. A deliberately SMALL,
 * safe, numeric-only set: the sequence frame size (pixels). Each maps to a
 * documented SequenceSettings property. // VERIFY the exact property names +
 * that assigning them via getSettings()/setSettings() is permitted.
 */
export type PremiereProSequenceSettingKey = 'frameWidth' | 'frameHeight';

interface SequenceSettingContract {
  /** SequenceSettings property name assigned in the JSX. */
  property: 'frameSizeHorizontal' | 'frameSizeVertical';
  min: number;
  max: number;
  describe: string;
}

// // VERIFY: SequenceSettings property names + assignable via setSettings on a
// real Premiere install.
const SEQUENCE_SETTING_CONTRACTS: Record<PremiereProSequenceSettingKey, SequenceSettingContract> = {
  // Premiere sequences top out at 16384 px per side; keep a conservative floor.
  frameWidth: { property: 'frameSizeHorizontal', min: 1, max: 16384, describe: 'sequence frame width (px)' },
  frameHeight: { property: 'frameSizeVertical', min: 1, max: 16384, describe: 'sequence frame height (px)' },
};

export const PREMIERE_PRO_SEQUENCE_SETTING_KEYS: readonly PremiereProSequenceSettingKey[] = [
  'frameWidth',
  'frameHeight',
] as const;

/**
 * AME work-area type for encodeSequence (documented integer values). We only
 * expose these three named values; the JSX emits the bounded integer.
 * // VERIFY the integer meanings on a live Premiere/AME install.
 */
export type PremiereProWorkArea = 'entire' | 'in_to_out' | 'work_area';

const WORK_AREA_VALUE: Record<PremiereProWorkArea, number> = {
  entire: 0, // ENCODE_ENTIRE
  in_to_out: 1, // ENCODE_IN_TO_OUT
  work_area: 2, // ENCODE_WORK_AREA
};

export const PREMIERE_PRO_WORK_AREAS: readonly PremiereProWorkArea[] = [
  'entire',
  'in_to_out',
  'work_area',
] as const;

// ── Bounds ───────────────────────────────────────────────────────────────────
/** Max media files a single import_media may stage (keeps the emitted array +
 *  approval text bounded). */
export const PREMIERE_PRO_MAX_IMPORT_FILES = 64;
/** Max length for label tokens (sequence names). */
export const PREMIERE_PRO_MAX_LABEL_LENGTH = 255;
/** Timeline placement time bound (seconds). ~1000h — generous but finite so a
 *  degenerate value can never produce an absurd numeric literal. */
export const PREMIERE_PRO_MAX_TIME_SECONDS = 3_600_000;
/** Max track index the timeline ops address (0-based; Premiere caps well below). */
export const PREMIERE_PRO_MAX_TRACK_INDEX = 255;

// ── Shared validation primitives ─────────────────────────────────────────────

export type PremiereProParamCheck<T> = { ok: true; value: T } | { ok: false; error: string };

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Path validation — LOCKSTEP with cadCodeExecutor.validateCadPath ↔
 * appScriptRunner.validateRunnerPath ↔ afterEffectsScriptAdapter
 * .validateAfterEffectsPath ↔ scripts/claude-bridge.js
 * validateDesktopPathServer. Rejects: non-string, empty, >1024 chars, control
 * chars, shell metachars, non-BMP code points (cannot be embedded in an ASCII
 * ExtendScript literal), and `..` traversal. A path that passes here embeds
 * safely via `extendScriptStringLiteral`.
 */
export function validatePremiereProPath(
  raw: unknown,
  label: string,
): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${label} is empty` };
  if (trimmed.length > 1024) return { ok: false, error: `${label} exceeds 1024 chars` };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: `${label} contains control characters` };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: `${label} contains a shell metacharacter` };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: `${label} contains characters outside the basic multilingual plane` };
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: `${label} must not contain ".." traversal` };
  return { ok: true, path: trimmed };
}

/**
 * STRING-LITERAL label validation (JSX lane). A sequence name here becomes the
 * CONTENTS of a double-quoted ExtendScript string literal, embedded via
 * `extendScriptStringLiteral`. That escaper safely handles `"` and `\`, so those
 * two characters are PERMITTED (Premiere genuinely allows a sequence named
 * `Final "v3"`). What is still refused, because the ES3 escaper cannot represent
 * it safely: control chars, newlines, and non-BMP code points. Shell metachars
 * are rejected too (tight allowlist; a sequence name has no reason to hold them).
 * Path separators are rejected (a sequence name is not a path). BMP-only.
 */
export function validatePremiereProScriptLabel(
  raw: unknown,
  label: string,
): PremiereProParamCheck<string> {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${label} is empty` };
  if (trimmed.length > PREMIERE_PRO_MAX_LABEL_LENGTH) {
    return { ok: false, error: `${label} exceeds ${PREMIERE_PRO_MAX_LABEL_LENGTH} chars` };
  }
  // Control chars + newline: the ES3 escaper cannot encode these safely.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: `${label} contains control characters` };
  if (/[/\\]/.test(trimmed)) return { ok: false, error: `${label} must not contain a path separator` };
  // Shell metachars stay out (tight allowlist); note `"` is deliberately ALLOWED
  // here because extendScriptStringLiteral escapes it into the literal.
  if (/[`$;|&><]/.test(trimmed)) return { ok: false, error: `${label} contains a disallowed metacharacter` };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: `${label} contains characters outside the basic multilingual plane` };
    }
  }
  return { ok: true, value: trimmed };
}

/**
 * Non-negative integer, bounded to `max`. Strict: numeric strings, fractions,
 * NaN/Infinity are rejected (fail closed). undefined/null → not provided (null)
 * when `allowNull`, else an error.
 */
export function validatePremiereProIndex(
  raw: unknown,
  label: string,
  max: number,
  allowNull = false,
): PremiereProParamCheck<number | null> {
  if (raw === undefined || raw === null) {
    return allowNull ? { ok: true, value: null } : { ok: false, error: `${label} is required` };
  }
  if (
    typeof raw !== 'number'
    || !Number.isFinite(raw)
    || !Number.isInteger(raw)
    || raw < 0
    || raw > max
  ) {
    return { ok: false, error: `${label} must be an integer between 0 and ${max}` };
  }
  return { ok: true, value: raw };
}

/**
 * Non-negative timeline time in seconds, bounded. May be fractional (Premiere
 * times are seconds with sub-frame precision), so integer is NOT required — but
 * it must be a finite number in range; numeric strings are rejected (strict).
 * undefined/null → 0 (start of the sequence) with a note left by the caller.
 */
export function validatePremiereProTime(
  raw: unknown,
  label: string,
): PremiereProParamCheck<number> {
  if (raw === undefined || raw === null) return { ok: true, value: 0 };
  if (
    typeof raw !== 'number'
    || !Number.isFinite(raw)
    || raw < 0
    || raw > PREMIERE_PRO_MAX_TIME_SECONDS
  ) {
    return { ok: false, error: `${label} must be a number between 0 and ${PREMIERE_PRO_MAX_TIME_SECONDS} (seconds)` };
  }
  return { ok: true, value: raw };
}

/**
 * ES3-safe ExtendScript string literal. IDENTICAL technique to
 * afterEffectsScriptAdapter.extendScriptStringLiteral: ExtendScript is ES3 with a
 * limited, inconsistent escape set for control chars, so instead of emitting
 * `\n`/`\uXXXX` we require callers to have REJECTED control chars / newlines
 * (validatePremiereProScriptLabel / validatePremiereProPath do). The only escapes
 * needed for surviving BMP-printable text are `\` and `"`. If a caller
 * defensively passes a value still containing a control char / non-BMP code
 * point, we FAIL CLOSED by returning null rather than emitting an ambiguous
 * literal.
 */
export function extendScriptStringLiteral(value: string): string | null {
  const text = String(value ?? '');
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(text)) return null;
  for (const ch of text) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) return null;
  }
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Emit a bounded finite number as a plain numeric literal (digits/dot only).
 *  Re-stringified from a Number so no user text can ride along. Fails closed
 *  (null) on a non-finite value. */
function numericLiteral(value: number, integer: boolean): string | null {
  if (!Number.isFinite(value)) return null;
  return integer ? String(Math.trunc(value)) : String(value);
}

// ── Public request/result contracts ──────────────────────────────────────────

export interface PremiereProImportMediaInput {
  op: 'import_media';
  /** 1..MAX absolute media paths to import (each path-validated). */
  mediaPaths: string[];
  /** If true, importFiles suppresses UI (default true — headless-friendly). */
  suppressUI?: boolean;
}

export interface PremiereProAddToTimelineInput {
  op: 'add_to_timeline';
  /** Exact sequence name to target (label allowlist). Fail-closed if not found. */
  sequenceName: string;
  /** Exact project-item NAME to place (label allowlist). Looked up in the
   *  project bins; fail-closed if not found. */
  projectItemName: string;
  /** 0-based video track index. */
  videoTrackIndex: number;
  /** Placement time in seconds (default 0 = sequence start). */
  timeSeconds?: number;
  /** 'overwrite' (default) places over existing clips; 'insert' ripples. */
  placement?: 'overwrite' | 'insert';
}

export interface PremiereProExportSequenceInput {
  op: 'export_sequence';
  /** Exact sequence name to export (label allowlist). Fail-closed if not found. */
  sequenceName: string;
  /** Absolute output file path AME writes (path-validated). */
  outputPath: string;
  /** Absolute .epr preset path (path-validated; must end .epr). */
  presetPath: string;
  /** Work-area type (default 'entire'). */
  workArea?: PremiereProWorkArea;
  /** Remove the job from the AME queue on completion (default true — avoids
   *  out-of-memory on repeated renders per Adobe's guidance). */
  removeOnCompletion?: boolean;
}

export interface PremiereProSetSequenceSettingInput {
  op: 'set_sequence_setting';
  /** Exact sequence name to target (label allowlist). Fail-closed if not found. */
  sequenceName: string;
  /** Which setting to change. */
  setting: PremiereProSequenceSettingKey;
  /** New numeric value (bounded, integer pixels). */
  value: number;
}

export type PremiereProScriptInput =
  | PremiereProImportMediaInput
  | PremiereProAddToTimelineInput
  | PremiereProExportSequenceInput
  | PremiereProSetSequenceSettingInput;

export interface PremiereProScriptBuild {
  /** The .jsx ExtendScript body ('' when the build failed — check before running). */
  script: string;
  scriptExtension: typeof PREMIERE_PRO_SCRIPT_EXTENSION;
  /** false until a live Premiere run confirms the DOM — gates wiring. */
  verifiedInvocation: false;
  /** JSX ops MUTATE the project (approval-gated). */
  mutatesProject: boolean;
  /** export_sequence WRITES a file (via AME) → output stat proof required. */
  writesFiles: boolean;
  /** The file to stat-verify after an export (null otherwise). */
  outputHint: string | null;
  notes: string[];
}

export type PremiereProArgsValidation =
  | { ok: true; value: PremiereProScriptInput }
  | { ok: false; error: string };

function isScriptOperation(value: unknown): value is PremiereProScriptOperation {
  return typeof value === 'string' && (PREMIERE_PRO_SCRIPT_OPERATIONS as readonly string[]).includes(value);
}

function isSequenceSettingKey(value: unknown): value is PremiereProSequenceSettingKey {
  return typeof value === 'string' && (PREMIERE_PRO_SEQUENCE_SETTING_KEYS as readonly string[]).includes(value);
}

function normalizeWorkArea(raw: unknown): PremiereProWorkArea | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (PREMIERE_PRO_WORK_AREAS as readonly string[]).includes(value) ? (value as PremiereProWorkArea) : null;
}

/**
 * Validate a raw JSX-op request into a typed `PremiereProScriptInput` (or a typed
 * error). Shape/enum + required-field checks here; per-value validation (label
 * allowlist, numeric bounds, path checks) is enforced again in the builders so
 * the emitted script only ever embeds validated values. Never throws.
 */
export function validatePremiereProArgs(input: unknown): PremiereProArgsValidation {
  if (!input || typeof input !== 'object') return { ok: false, error: 'request must be an object' };
  const r = input as Record<string, unknown>;
  const op = r.op;
  if (!isScriptOperation(op)) {
    return { ok: false, error: `op must be one of ${PREMIERE_PRO_SCRIPT_OPERATIONS.join(', ')}` };
  }

  if (op === 'import_media') {
    const rawList = r.mediaPaths;
    if (!Array.isArray(rawList) || rawList.length === 0) {
      return { ok: false, error: 'import_media requires a non-empty mediaPaths array' };
    }
    if (rawList.length > PREMIERE_PRO_MAX_IMPORT_FILES) {
      return { ok: false, error: `import_media accepts at most ${PREMIERE_PRO_MAX_IMPORT_FILES} paths` };
    }
    const paths: string[] = [];
    for (let i = 0; i < rawList.length; i += 1) {
      const p = validatePremiereProPath(rawList[i], `mediaPaths[${i}]`);
      if (!p.ok) return { ok: false, error: p.error };
      paths.push(p.path);
    }
    const suppressUI = r.suppressUI === undefined ? true : r.suppressUI === true;
    return { ok: true, value: { op: 'import_media', mediaPaths: paths, suppressUI } };
  }

  if (op === 'add_to_timeline') {
    const seq = validatePremiereProScriptLabel(r.sequenceName, 'sequenceName');
    if (!seq.ok) return { ok: false, error: seq.error };
    const item = validatePremiereProScriptLabel(r.projectItemName, 'projectItemName');
    if (!item.ok) return { ok: false, error: item.error };
    const track = validatePremiereProIndex(r.videoTrackIndex, 'videoTrackIndex', PREMIERE_PRO_MAX_TRACK_INDEX);
    if (!track.ok) return { ok: false, error: track.error };
    const time = validatePremiereProTime(r.timeSeconds, 'timeSeconds');
    if (!time.ok) return { ok: false, error: time.error };
    const placementRaw = r.placement === undefined ? 'overwrite' : r.placement;
    if (placementRaw !== 'overwrite' && placementRaw !== 'insert') {
      return { ok: false, error: "placement must be 'overwrite' or 'insert'" };
    }
    return {
      ok: true,
      value: {
        op: 'add_to_timeline',
        sequenceName: seq.value,
        projectItemName: item.value,
        videoTrackIndex: track.value as number,
        timeSeconds: time.value,
        placement: placementRaw,
      },
    };
  }

  if (op === 'export_sequence') {
    const seq = validatePremiereProScriptLabel(r.sequenceName, 'sequenceName');
    if (!seq.ok) return { ok: false, error: seq.error };
    const out = validatePremiereProPath(r.outputPath, 'outputPath');
    if (!out.ok) return { ok: false, error: out.error };
    const preset = validatePremiereProPath(r.presetPath, 'presetPath');
    if (!preset.ok) return { ok: false, error: preset.error };
    if (extensionOf(preset.path) !== 'epr') {
      return { ok: false, error: 'presetPath must be an Adobe .epr export preset' };
    }
    if (out.path === preset.path) {
      return { ok: false, error: 'outputPath must differ from presetPath' };
    }
    const workArea = normalizeWorkArea(r.workArea === undefined ? 'entire' : r.workArea);
    if (!workArea) {
      return { ok: false, error: `workArea must be one of ${PREMIERE_PRO_WORK_AREAS.join(', ')}` };
    }
    const removeOnCompletion = r.removeOnCompletion === undefined ? true : r.removeOnCompletion === true;
    return {
      ok: true,
      value: {
        op: 'export_sequence',
        sequenceName: seq.value,
        outputPath: out.path,
        presetPath: preset.path,
        workArea,
        removeOnCompletion,
      },
    };
  }

  // op === 'set_sequence_setting'
  const seq = validatePremiereProScriptLabel(r.sequenceName, 'sequenceName');
  if (!seq.ok) return { ok: false, error: seq.error };
  if (!isSequenceSettingKey(r.setting)) {
    return { ok: false, error: `setting must be one of ${PREMIERE_PRO_SEQUENCE_SETTING_KEYS.join(', ')}` };
  }
  const contract = SEQUENCE_SETTING_CONTRACTS[r.setting];
  const value = r.value;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || !Number.isInteger(value)
    || value < contract.min
    || value > contract.max
  ) {
    return { ok: false, error: `value for ${r.setting} must be an integer between ${contract.min} and ${contract.max}` };
  }
  return { ok: true, value: { op: 'set_sequence_setting', sequenceName: seq.value, setting: r.setting, value } };
}

// ── Shared JSX helpers ────────────────────────────────────────────────────────

/**
 * JSON-emit helpers + a fail-closed sequence/project-item lookup by EXACT name.
 * No fuzzy match, never the "active" sequence blindly, so a mutation can only
 * ever hit the named target. Pure boilerplate. The `expectedSequenceName` is
 * embedded via `extendScriptStringLiteral` (already validated).
 *
 * // VERIFY the Premiere DOM: app.project, app.project.sequences (indexable +
 * // .numSequences), sequence.name, app.project.rootItem / children traversal,
 * // projectItem.name.
 */
function premiereJsxPrelude(sequenceLiteral: string): string {
  return [
    'var EXPECTED_SEQUENCE_NAME = ' + sequenceLiteral + ';',
    '',
    'function jsonEscape(value) {',
    '  return String(value === undefined || value === null ? "" : value)',
    '    .replace(/\\\\/g, "\\\\\\\\")',
    '    .replace(/"/g, "\\\\\\"");',
    '}',
    'function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }',
    'function jsonNullableString(value) { return value === undefined || value === null || value === "" ? "null" : jsonString(value); }',
    'function jsonNumber(value) { var n = Number(value); return isFinite(n) ? String(n) : "0"; }',
    'function jsonBoolean(value) { return value === true ? "true" : "false"; }',
    '',
    '// Locate the target sequence by EXACT name. Fail closed (no fuzzy match,',
    '// never the "active" sequence) so a mutation can only ever hit the named one.',
    'function findTargetSequence() {',
    '  try {',
    '    if (!app.project || !app.project.sequences) return null;',
    '    var count = app.project.sequences.numSequences;',
    '    for (var i = 0; i < count; i += 1) {',
    '      var seq = app.project.sequences[i];',
    '      if (seq && String(seq.name) === EXPECTED_SEQUENCE_NAME) return seq;',
    '    }',
    '  } catch (_) {}',
    '  return null;',
    '}',
    '',
    '// Locate a project item by EXACT name, walking bins depth-first. Fail closed',
    '// (returns null) if not found or ambiguous is not resolved (first exact match).',
    'function findProjectItemByName(name) {',
    '  try {',
    '    if (!app.project || !app.project.rootItem) return null;',
    '    var stack = [app.project.rootItem];',
    '    while (stack.length > 0) {',
    '      var node = stack.pop();',
    '      var kids = node && node.children ? node.children : null;',
    '      if (!kids) continue;',
    '      for (var i = 0; i < kids.numItems; i += 1) {',
    '        var child = kids[i];',
    '        if (!child) continue;',
    '        if (String(child.name) === name) {',
    '          try { if (child.children && child.children.numItems > 0) { stack.push(child); continue; } } catch (_) {}',
    '          return child;',
    '        }',
    '        try { if (child.children && child.children.numItems > 0) stack.push(child); } catch (_) {}',
    '      }',
    '    }',
    '  } catch (_) {}',
    '  return null;',
    '}',
  ].join('\n');
}

// ── Per-op JSX builders ────────────────────────────────────────────────────────

function buildImportMediaJsx(value: PremiereProImportMediaInput): PremiereProScriptBuild {
  // Build a JSX array literal of validated path literals. Fail closed if ANY
  // path cannot be embedded (defensive — validation already passed).
  const literals: string[] = [];
  for (const p of value.mediaPaths) {
    const lit = extendScriptStringLiteral(p);
    if (lit === null) {
      return {
        script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
        notes: ['import_media aborted — a media path could not be safely embedded.'],
      };
    }
    literals.push(lit);
  }
  const arrayLiteral = '[' + literals.join(', ') + ']';
  const suppressLiteral = value.suppressUI ? 'true' : 'false';

  const body = [
    '(function () {',
    '  function jsonEscape(value) {',
    '    return String(value === undefined || value === null ? "" : value)',
    '      .replace(/\\\\/g, "\\\\\\\\")',
    '      .replace(/"/g, "\\\\\\"");',
    '  }',
    '  function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }',
    '  function jsonNullableString(value) { return value === undefined || value === null || value === "" ? "null" : jsonString(value); }',
    '  function jsonNumber(value) { var n = Number(value); return isFinite(n) ? String(n) : "0"; }',
    '  function jsonBoolean(value) { return value === true ? "true" : "false"; }',
    '',
    '  var MEDIA_PATHS = ' + arrayLiteral + ';',
    '  var SUPPRESS_UI = ' + suppressLiteral + ';',
    '',
    '  var result = {',
    '    ok: false,',
    '    appName: "",',
    '    requested: MEDIA_PATHS.length,',
    '    itemCountBefore: 0,',
    '    itemCountAfter: 0,',
    '    error: null',
    '  };',
    '  try { result.appName = String(app.appName || "Premiere Pro"); } catch (_) {}',
    '',
    '  function stringifyResult(v) {',
    '    return "{" + [',
    '      "\\"ok\\":" + jsonBoolean(v.ok),',
    '      "\\"appName\\":" + jsonString(v.appName),',
    '      "\\"requested\\":" + jsonNumber(v.requested),',
    '      "\\"itemCountBefore\\":" + jsonNumber(v.itemCountBefore),',
    '      "\\"itemCountAfter\\":" + jsonNumber(v.itemCountAfter),',
    '      "\\"error\\":" + jsonNullableString(v.error)',
    '    ].join(",") + "}";',
    '  }',
    '',
    '  if (!app.project) {',
    '    result.error = "no_open_project";',
    '    return stringifyResult(result);',
    '  }',
    '',
    '  // Import the validated media paths into the OPEN project. This never opens',
    '  // a project and never saves it. importFiles takes an ARRAY of path strings.',
    '  try {',
    '    try { result.itemCountBefore = Number(app.project.rootItem.children.numItems) || 0; } catch (_) {}',
    '    app.project.importFiles(MEDIA_PATHS, SUPPRESS_UI, false);',
    '    try { result.itemCountAfter = Number(app.project.rootItem.children.numItems) || 0; } catch (_) {}',
    '    result.ok = result.itemCountAfter >= result.itemCountBefore;',
    '  } catch (err) {',
    '    result.error = String(err && err.message ? err.message : err);',
    '  }',
    '  return stringifyResult(result);',
    '}());',
    '',
  ].join('\n');

  return {
    script: body,
    scriptExtension: 'jsx',
    verifiedInvocation: false,
    mutatesProject: true,
    writesFiles: false,
    outputHint: null,
    notes: [
      `import_media imports ${value.mediaPaths.length} file(s) into the OPEN project — MUTATES the project (approval-gated); it never opens or saves a project and never copies/moves the source media.`,
      'Proof: parse the JSON result line for itemCountBefore/itemCountAfter, then re-observe the project panel.',
      '// VERIFY app.project.importFiles([paths], suppressUI, importAsNumberedStills) + rootItem.children.numItems on a real Premiere install.',
    ],
  };
}

function buildAddToTimelineJsx(value: PremiereProAddToTimelineInput): PremiereProScriptBuild {
  const seqLiteral = extendScriptStringLiteral(value.sequenceName);
  const itemLiteral = extendScriptStringLiteral(value.projectItemName);
  if (seqLiteral === null || itemLiteral === null) {
    return {
      script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
      notes: ['add_to_timeline aborted — sequenceName/projectItemName could not be safely embedded.'],
    };
  }
  const trackLiteral = numericLiteral(value.videoTrackIndex, true);
  const timeLiteral = numericLiteral(value.timeSeconds ?? 0, false);
  if (trackLiteral === null || timeLiteral === null) {
    return {
      script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
      notes: ['add_to_timeline aborted — track/time numeric token unsafe.'],
    };
  }
  const method = value.placement === 'insert' ? 'insertClip' : 'overwriteClip';
  const methodLiteral = extendScriptStringLiteral(method);
  if (methodLiteral === null) {
    return {
      script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
      notes: ['add_to_timeline aborted — internal method token unsafe.'],
    };
  }

  const body = [
    '(function () {',
    premiereJsxPrelude(seqLiteral),
    '',
    '  var TARGET_ITEM_NAME = ' + itemLiteral + ';',
    '  var VIDEO_TRACK_INDEX = ' + trackLiteral + ';',
    '  var PLACEMENT_TIME = ' + timeLiteral + ';',
    '  var PLACEMENT_METHOD = ' + methodLiteral + ';',
    '',
    '  var result = {',
    '    ok: false,',
    '    appName: "",',
    '    sequenceName: null,',
    '    projectItemName: null,',
    '    videoTrackIndex: VIDEO_TRACK_INDEX,',
    '    placement: PLACEMENT_METHOD,',
    '    time: PLACEMENT_TIME,',
    '    error: null',
    '  };',
    '  try { result.appName = String(app.appName || "Premiere Pro"); } catch (_) {}',
    '',
    '  function stringifyResult(v) {',
    '    return "{" + [',
    '      "\\"ok\\":" + jsonBoolean(v.ok),',
    '      "\\"appName\\":" + jsonString(v.appName),',
    '      "\\"sequenceName\\":" + jsonNullableString(v.sequenceName),',
    '      "\\"projectItemName\\":" + jsonNullableString(v.projectItemName),',
    '      "\\"videoTrackIndex\\":" + jsonNumber(v.videoTrackIndex),',
    '      "\\"placement\\":" + jsonString(v.placement),',
    '      "\\"time\\":" + jsonNumber(v.time),',
    '      "\\"error\\":" + jsonNullableString(v.error)',
    '    ].join(",") + "}";',
    '  }',
    '',
    '  var seq = findTargetSequence();',
    '  if (seq === null) {',
    '    result.error = "sequence_not_found";',
    '    return stringifyResult(result);',
    '  }',
    '  result.sequenceName = String(seq.name || "");',
    '',
    '  var projectItem = findProjectItemByName(TARGET_ITEM_NAME);',
    '  if (projectItem === null) {',
    '    result.error = "project_item_not_found";',
    '    return stringifyResult(result);',
    '  }',
    '  result.projectItemName = String(projectItem.name || "");',
    '',
    '  // Place the PROJECT ITEM (not a timeline clip) on the named video track at',
    '  // the given time. overwriteClip/insertClip both require a projectItem. The',
    '  // project is NEVER saved by this script.',
    '  try {',
    '    var track = seq.videoTracks[VIDEO_TRACK_INDEX];',
    '    if (!track) {',
    '      result.error = "video_track_not_found";',
    '      return stringifyResult(result);',
    '    }',
    '    var placed;',
    '    if (PLACEMENT_METHOD === "insertClip") {',
    '      placed = track.insertClip(projectItem, PLACEMENT_TIME);',
    '    } else {',
    '      placed = track.overwriteClip(projectItem, PLACEMENT_TIME);',
    '    }',
    '    result.ok = (placed === true) || (placed && typeof placed === "object");',
    '    if (!result.ok) result.error = "placement_returned_false";',
    '  } catch (err) {',
    '    result.error = String(err && err.message ? err.message : err);',
    '  }',
    '  return stringifyResult(result);',
    '}());',
    '',
  ].join('\n');

  const notes: string[] = [];
  notes.push(`add_to_timeline places project item "${value.projectItemName}" on video track ${value.videoTrackIndex} of sequence "${value.sequenceName}" at ${value.timeSeconds ?? 0}s using ${method} — MUTATES the project (approval-gated); it never saves the project.`);
  notes.push('overwriteClip/insertClip require a PROJECT ITEM (not a timeline trackItem); timeline instance effects/keyframes are NOT carried by this call.');
  notes.push('Proof: parse the JSON result line for ok + re-observe the timeline (a timeline screenshot per the app profile).');
  notes.push('// VERIFY sequence.videoTracks[i].overwriteClip/insertClip(projectItem, timeSeconds) + findProjectItemByName traversal on a real Premiere install.');

  return { script: body, scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: true, writesFiles: false, outputHint: null, notes };
}

function buildExportSequenceJsx(value: PremiereProExportSequenceInput): PremiereProScriptBuild {
  const seqLiteral = extendScriptStringLiteral(value.sequenceName);
  const outLiteral = extendScriptStringLiteral(value.outputPath);
  const presetLiteral = extendScriptStringLiteral(value.presetPath);
  if (seqLiteral === null || outLiteral === null || presetLiteral === null) {
    return {
      script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
      notes: ['export_sequence aborted — sequenceName/output/preset could not be safely embedded.'],
    };
  }
  const workAreaLiteral = numericLiteral(WORK_AREA_VALUE[value.workArea ?? 'entire'], true);
  if (workAreaLiteral === null) {
    return {
      script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
      notes: ['export_sequence aborted — work-area numeric token unsafe.'],
    };
  }
  const removeLiteral = value.removeOnCompletion ? '1' : '0';

  const body = [
    '(function () {',
    premiereJsxPrelude(seqLiteral),
    '',
    '  var OUTPUT_PATH = ' + outLiteral + ';',
    '  var PRESET_PATH = ' + presetLiteral + ';',
    '  var WORK_AREA = ' + workAreaLiteral + ';',
    '  var REMOVE_ON_COMPLETION = ' + removeLiteral + ';',
    '',
    '  var result = {',
    '    ok: false,',
    '    appName: "",',
    '    sequenceName: null,',
    '    outputPath: OUTPUT_PATH,',
    '    jobId: null,',
    '    queued: false,',
    '    error: null',
    '  };',
    '  try { result.appName = String(app.appName || "Premiere Pro"); } catch (_) {}',
    '',
    '  function stringifyResult(v) {',
    '    return "{" + [',
    '      "\\"ok\\":" + jsonBoolean(v.ok),',
    '      "\\"appName\\":" + jsonString(v.appName),',
    '      "\\"sequenceName\\":" + jsonNullableString(v.sequenceName),',
    '      "\\"outputPath\\":" + jsonString(v.outputPath),',
    '      "\\"jobId\\":" + jsonNullableString(v.jobId),',
    '      "\\"queued\\":" + jsonBoolean(v.queued),',
    '      "\\"error\\":" + jsonNullableString(v.error)',
    '    ].join(",") + "}";',
    '  }',
    '',
    '  var seq = findTargetSequence();',
    '  if (seq === null) {',
    '    result.error = "sequence_not_found";',
    '    return stringifyResult(result);',
    '  }',
    '  result.sequenceName = String(seq.name || "");',
    '',
    '  if (!app.encoder) {',
    '    result.error = "no_encoder";',
    '    return stringifyResult(result);',
    '  }',
    '',
    '  // Hand the named sequence to Adobe Media Encoder. encodeSequence returns a',
    '  // job-id String (or 0 on failure). This does NOT block for the render and',
    '  // never saves the project. The FILE appears only once AME finishes the job',
    '  // - the caller must stat OUTPUT_PATH afterward (it may not exist yet here).',
    '  try {',
    '    try { app.encoder.launchEncoder(); } catch (_) {}',
    '    var jobId = app.encoder.encodeSequence(seq, OUTPUT_PATH, PRESET_PATH, WORK_AREA, REMOVE_ON_COMPLETION);',
    '    if (jobId && jobId !== 0 && String(jobId) !== "0") {',
    '      result.jobId = String(jobId);',
    '      result.queued = true;',
    '      result.ok = true;',
    '      try { app.encoder.startBatch(); } catch (_) {}',
    '    } else {',
    '      result.error = "encode_sequence_failed";',
    '    }',
    '  } catch (err) {',
    '    result.error = String(err && err.message ? err.message : err);',
    '  }',
    '  return stringifyResult(result);',
    '}());',
    '',
  ].join('\n');

  return {
    script: body,
    scriptExtension: 'jsx',
    verifiedInvocation: false,
    mutatesProject: false,
    writesFiles: true,
    outputHint: value.outputPath,
    notes: [
      `export_sequence hands sequence "${value.sequenceName}" to Adobe Media Encoder (preset ${value.presetPath}) writing ${value.outputPath} — WRITES A FILE (approval + output stat proof required); it never saves the project.`,
      'This is ASYNCHRONOUS: encodeSequence queues the job and returns a job id; the output file appears only when AME finishes. Do NOT treat queued===true as proof — verify with desktop.file_stat on the output file after the render, not the job id.',
      'The .epr preset (not this adapter) fixes codec/container; the output extension is not enforced here.',
      '// VERIFY app.encoder.encodeSequence(seq, output, preset, workArea{0/1/2}, remove{0/1}) + launchEncoder/startBatch on a real Premiere+AME install.',
    ],
  };
}

function buildSetSequenceSettingJsx(value: PremiereProSetSequenceSettingInput): PremiereProScriptBuild {
  const seqLiteral = extendScriptStringLiteral(value.sequenceName);
  if (seqLiteral === null) {
    return {
      script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
      notes: ['set_sequence_setting aborted — sequenceName could not be safely embedded.'],
    };
  }
  const contract = SEQUENCE_SETTING_CONTRACTS[value.setting];
  const propertyLiteral = extendScriptStringLiteral(contract.property);
  const valueLiteral = numericLiteral(value.value, true);
  if (propertyLiteral === null || valueLiteral === null) {
    return {
      script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
      notes: ['set_sequence_setting aborted — internal property/value token unsafe.'],
    };
  }

  const body = [
    '(function () {',
    premiereJsxPrelude(seqLiteral),
    '',
    '  var SETTING_PROPERTY = ' + propertyLiteral + ';',
    '  var NEW_VALUE = ' + valueLiteral + ';',
    '',
    '  var result = {',
    '    ok: false,',
    '    appName: "",',
    '    sequenceName: null,',
    '    setting: SETTING_PROPERTY,',
    '    newValue: NEW_VALUE,',
    '    oldValue: null,',
    '    error: null',
    '  };',
    '  try { result.appName = String(app.appName || "Premiere Pro"); } catch (_) {}',
    '',
    '  function stringifyResult(v) {',
    '    return "{" + [',
    '      "\\"ok\\":" + jsonBoolean(v.ok),',
    '      "\\"appName\\":" + jsonString(v.appName),',
    '      "\\"sequenceName\\":" + jsonNullableString(v.sequenceName),',
    '      "\\"setting\\":" + jsonString(v.setting),',
    '      "\\"newValue\\":" + jsonNumber(v.newValue),',
    '      "\\"oldValue\\":" + (v.oldValue === null ? "null" : jsonNumber(v.oldValue)),',
    '      "\\"error\\":" + jsonNullableString(v.error)',
    '    ].join(",") + "}";',
    '  }',
    '',
    '  var seq = findTargetSequence();',
    '  if (seq === null) {',
    '    result.error = "sequence_not_found";',
    '    return stringifyResult(result);',
    '  }',
    '  result.sequenceName = String(seq.name || "");',
    '',
    '  // Read settings, change the ONE validated numeric property, write settings',
    '  // back. This never saves the project.',
    '  try {',
    '    var settings = seq.getSettings();',
    '    if (!settings) {',
    '      result.error = "no_sequence_settings";',
    '      return stringifyResult(result);',
    '    }',
    '    try { result.oldValue = Number(settings[SETTING_PROPERTY]); } catch (_) {}',
    '    settings[SETTING_PROPERTY] = NEW_VALUE;',
    '    seq.setSettings(settings);',
    '    result.ok = true;',
    '  } catch (err) {',
    '    result.error = String(err && err.message ? err.message : err);',
    '  }',
    '  return stringifyResult(result);',
    '}());',
    '',
  ].join('\n');

  return {
    script: body,
    scriptExtension: 'jsx',
    verifiedInvocation: false,
    mutatesProject: true,
    writesFiles: false,
    outputHint: null,
    notes: [
      `set_sequence_setting changes ${contract.describe} on sequence "${value.sequenceName}" — MUTATES the project (approval-gated); it never saves the project.`,
      'Proof: parse the JSON result line for ok/oldValue/newValue, then re-observe the sequence.',
      '// VERIFY sequence.getSettings()/setSettings() + the SequenceSettings property name on a real Premiere install.',
    ],
  };
}

/**
 * Build a validated Premiere Pro JSX script for a bounded operation. Returns
 * `{ script, scriptExtension:'jsx', verifiedInvocation:false, mutatesProject,
 * writesFiles, outputHint, notes }`. On a fatal input problem `script` is '' and
 * the reason is in `notes` — the caller checks `script` before staging + running
 * via the panel/bridge. Every user value is allowlist-validated and embedded
 * ONLY via `extendScriptStringLiteral` (or a bounded numeric literal); nothing is
 * raw-concatenated. Never throws.
 *
 * Ergonomics: accepts buildPremiereProScript(input) with {op,...} OR
 * buildPremiereProScript(op, {...}) — same as afterEffectsScriptAdapter.
 */
export function buildPremiereProScript(op: unknown, input?: unknown): PremiereProScriptBuild {
  let request: unknown;
  if (typeof op === 'string') {
    request = { ...(input && typeof input === 'object' ? (input as Record<string, unknown>) : {}), op };
  } else {
    request = op;
  }

  const validation = validatePremiereProArgs(request);
  if (!validation.ok) {
    return {
      script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
      notes: [`Invalid Premiere Pro request — ${validation.error}.`],
    };
  }
  const value = validation.value;
  switch (value.op) {
    case 'import_media':
      return buildImportMediaJsx(value);
    case 'add_to_timeline':
      return buildAddToTimelineJsx(value);
    case 'export_sequence':
      return buildExportSequenceJsx(value);
    case 'set_sequence_setting':
      return buildSetSequenceSettingJsx(value);
    default:
      return {
        script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, writesFiles: false, outputHint: null,
        notes: ['Unsupported Premiere Pro operation.'],
      };
  }
}

// ── Human-readable describe (approval preview) ───────────────────────────────

/**
 * One-line plain-language description of a Premiere op for an approval preview /
 * notice. Never throws; safe on garbage input.
 */
export function describePremiereProOperation(input: unknown): string {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const validation = validatePremiereProArgs(r);
  if (!validation.ok) return 'Run a Premiere Pro operation (ExtendScript, approval-gated local execution)';
  const value = validation.value;
  switch (value.op) {
    case 'import_media':
      return `Import ${value.mediaPaths.length} media file(s) into the open Premiere Pro project (ExtendScript, approval-gated, MUTATES the project)`;
    case 'add_to_timeline':
      return `Place project item "${value.projectItemName.slice(0, 40)}" on video track ${value.videoTrackIndex} of Premiere sequence "${value.sequenceName.slice(0, 40)}" (${value.placement === 'insert' ? 'insert' : 'overwrite'}; ExtendScript, approval-gated, MUTATES the project)`;
    case 'export_sequence':
      return `Export Premiere sequence "${value.sequenceName.slice(0, 40)}" via Adobe Media Encoder to the approved output (writes a file; approval + output proof required)`;
    case 'set_sequence_setting': {
      const contract = SEQUENCE_SETTING_CONTRACTS[value.setting];
      return `Set ${contract.describe} to ${value.value} on Premiere sequence "${value.sequenceName.slice(0, 40)}" (ExtendScript, approval-gated, MUTATES the project)`;
    }
    default:
      return 'Run a Premiere Pro operation (ExtendScript, approval-gated local execution)';
  }
}

// ── Operation-gap tool constant (REPORT-ONLY; NOT wired) ─────────────────────

/**
 * The tool a connected-agent buildout WOULD register in
 * `src/lib/openswanToolRuntime.ts` once the Premiere DOM is verified and a
 * resident panel channel exists. Exported as DATA (not imported into the tool
 * runtime) so this module stays pure and does NOT edit the shared catalog. Per
 * docs/apps/premiere-pro.md there is no `desktop.premiere_*` tool today; Premiere
 * requests stop at the generic `agent.build_app_capability` route. This names the
 * concrete gap so the report/buildout prompt can carry it.
 */
export const PREMIERE_PRO_OPERATION_GAP_TOOL = 'desktop.premiere_run_script' as const;

/** The generic route Premiere requests take today until the gap tool exists. */
export const PREMIERE_PRO_BUILDOUT_ROUTE_TOOL = 'agent.build_app_capability' as const;

// ── Doc-verified invocation constant (VERIFY; NOT wired) ─────────────────────

export interface PremiereProDocVerifiedInvocation {
  /** Chosen control surface (from docs/apps/premiere-pro.md ranking). */
  surface: 'extendscript_panel';
  /** How a resident panel/bridge would run the generated script. */
  invocation: string;
  /** The documented DOM entry points this adapter targets. */
  entryPoints: readonly string[];
  /** Whether ExtendScript is still Adobe's DOCUMENTED surface (it is FROZEN,
   *  UXP is the go-forward standard as of Premiere 25.6 / Nov 2025). */
  extendScriptStillDocumented: true;
  /** false — nothing here was run against a live Premiere install; gates wiring. */
  verifiedInvocation: false;
  /** Documentation the entry points were derived from (source-ref for the route). */
  docSource: readonly string[];
  notes: readonly string[];
}

/**
 * // VERIFY — doc-verified (NOT live-verified) invocation record for the chosen
 * ExtendScript surface. `verifiedInvocation:false` gates wiring: a bridge
 * LOCKSTEP + a live Premiere run must confirm every entry point (importFiles /
 * overwriteClip|insertClip / encodeSequence / getSettings|setSettings) and the
 * exact panel evalScript form before `desktop.premiere_run_script` is wired.
 */
export const PREMIERE_PRO_DOC_VERIFIED_INVOCATION: PremiereProDocVerifiedInvocation = {
  surface: 'extendscript_panel',
  invocation:
    "A resident Premiere panel (CEP `csInterface.evalScript(jsx)` today, or a UXP plugin for new work) runs the generated JSX INSIDE a running Premiere with a project open, then parses the single JSON result line. Adobe explicitly does NOT recommend one-shot command-line script drive (behavior varies by platform).",
  entryPoints: [
    'app.project.importFiles([paths], suppressUI, importAsNumberedStills)',
    'sequence.videoTracks[i].overwriteClip(projectItem, timeSeconds) / insertClip(projectItem, timeSeconds) (require a projectItem, not a trackItem)',
    'app.encoder.encodeSequence(sequence, outputPath, presetPath, workArea{0=ENCODE_ENTIRE,1=ENCODE_IN_TO_OUT,2=ENCODE_WORK_AREA}, removeUponCompletion) -> jobId String or 0',
    'sequence.getSettings() / sequence.setSettings(SequenceSettings) (frameSizeHorizontal / frameSizeVertical)',
  ],
  extendScriptStillDocumented: true,
  verifiedInvocation: false,
  docSource: [
    'https://ppro-scripting.docsforadobe.dev/',
    'https://ppro-scripting.docsforadobe.dev/general/encoder/',
    'https://ppro-scripting.docsforadobe.dev/sequence/sequence/',
    'https://github.com/Adobe-CEP/Samples/tree/master/PProPanel',
    'https://developer.adobe.com/premiere-pro/uxp/ppro-reference/',
  ],
  notes: [
    'Premiere 25.6 (Nov 2025) made UXP the extensibility standard; the ExtendScript/CEP DOM is FROZEN (no further development) and planned to be supported only through ~September 2026. New buildout should target the UXP DOM — the same validated inputs + JSON-result contract carry over.',
    'encodeSequence is asynchronous (queues an AME job) — proof is a desktop.file_stat on the finished output file, never the returned job id.',
    'All entry points are DOC-verified only (Premiere Pro Scripting Guide + PProPanel samples), NOT run against a live install here.',
  ],
};
