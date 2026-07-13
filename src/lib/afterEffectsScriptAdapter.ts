// afterEffectsScriptAdapter — PURE generator for the TWO headless After Effects
// surfaces (plan P5, Substrate A / headless-CLI). It is the code-generation
// counterpart to autocadScriptAdapter.ts / davinciResolveScriptAdapter.ts and
// the ExtendScript sibling of illustratorExtendScriptAdapters.ts, applied to
// After Effects' two externally-drivable lanes:
//
//   1. `aerender` CLI — the TRUE headless render lane. It renders a comp (or a
//      whole render queue) with NO UI:
//        aerender -project <aep> -comp <name> -output <path> [-s <n> -e <m>]
//      `buildAfterEffectsRender(input)` validates the project/comp/output/frame
//      inputs and returns a validated argv token vector (`engine:'aerender'`) the
//      bridge would run via execFile (NO shell), exactly like
//      appScriptRunner.buildArgs. This module never spawns aerender.
//
//   2. JSX ExtendScript — pre-render SETUP ops a bridge runs INSIDE After Effects
//      (macOS `DoScriptFile`, or `afterfx -r <jsx>` on Windows). AE has no UXP
//      scripting in 2026 (see docs/apps/after-effects.md), so these stay
//      ExtendScript (ES3). `buildAfterEffectsScript(op, input)` emits the .jsx for
//      a bounded setup op (currently `set_comp_setting`) that mutates project
//      state prior to a render.
//
// PURITY: zero runtime imports (import type only) → tsx-loadable
// (smoke: after-effects-script-adapter). It shapes + validates + emits argv
// tokens / script TEXT only; it never touches the filesystem, spawns a process,
// or resolves a binary — the bridge does that (LOCKSTEP with its path/arg
// validators) resolving `aerender`/AE from FIXED install paths.
//
// ── VERIFY BEFORE WIRING ─────────────────────────────────────────────────────
// VERIFY aerender flags + AE ExtendScript (app.project.*/renderQueue) on a real
// After Effects install before wiring. The aerender flag set (`-project -comp
// -output -s -e -RStemplate -OMtemplate`) and the AE scripting DOM used in the
// JSX (`app.project.item(i)`, `CompItem`, `comp.frameRate`, `comp.duration`,
// `comp.workAreaStart/Duration`, `app.project.renderQueue`) come from the
// documented After Effects Scripting Guide + aerender docs and were NOT freshly
// run against a live AE install here. Every builder carries
// `verifiedInvocation: false`; a bridge LOCKSTEP + a live run must confirm the
// exact flag forms, whether aerender needs a trailing/leading form, and the
// exact scripting method names before `desktop.after_effects_*` /
// `desktop.run_app_script` is wired.
//
// ── LOAD-BEARING SECURITY BAR ────────────────────────────────────────────────
// Two DIFFERENT embedding contexts, two DIFFERENT safe-embed rules:
//
//   * aerender argv: each user value becomes ONE argv token passed to execFile
//     (no shell), so shell metacharacters are inert in principle — but we reject
//     them anyway (defense in depth, LOCKSTEP with the shared bridge reject-set)
//     and reject control chars / newlines so a value can never be mistaken for a
//     flag or split a token. Paths use the CAD `validateCadPath` discipline; the
//     comp name is a LABEL allowlist (bounded, no control/newline/metachar, no
//     path separators). Frame numbers are bounded non-negative integers.
//
//   * JSX string literals: ExtendScript is ES3 with a LIMITED escape set. We
//     embed every user value ONLY through `extendScriptStringLiteral` (a strict
//     ES3-safe escaper: double-quoted; escapes `\` and `"`; REJECTS control
//     chars / newlines up front rather than trying to emit `\n`/`\uXXXX` that
//     older ExtendScript hosts handle inconsistently), mirroring the
//     JSON.stringify-into-JSX approach in illustratorExtendScriptAdapters. Values
//     are NEVER raw-concatenated into script text.
//
// Anything that fails validation is DROPPED WITH A NOTE (optional fields) or the
// whole build is rejected (required fields) — never silently mangled. Degenerate
// input NEVER throws.
//
// ── APPROVAL / EVIDENCE (see docs/apps/after-effects.md) ─────────────────────
// A render WRITES A FILE and consumes machine time; a JSX setup op MUTATES the
// project. Both are approval-gated by the AE app profile (composition edits,
// render/export, overwrite project/media). The calling runtime must echo the
// project/comp identity in the approval text and prove a render with an
// `os.stat`-style file check on the output (aerender reports no output path
// itself). The JSX setup ops NEVER save the project (no side-effect save).

// ── Surface / operation identifiers ──────────────────────────────────────────

/** aerender CLI render engine id (pairs with a future appScriptRunner descriptor). */
export const AFTER_EFFECTS_RENDER_ENGINE = 'aerender';
/** AE project source extensions aerender / the JSX open. */
export const AFTER_EFFECTS_PROJECT_EXTENSIONS: readonly string[] = ['aep', 'aepx'];
/** ExtendScript source extension the bridge runs via AE. */
export const AFTER_EFFECTS_SCRIPT_EXTENSION = 'jsx';

/**
 * JSX setup operations (bounded). `set_comp_setting` is the clearest concrete
 * pre-render mutation; `add_to_render_queue` and `set_render_settings` are the
 * documented render-queue setup ops from the profile — added here as bounded
 * builders so the render-queue lane is not a stub, but all three are
 * `verifiedInvocation:false` until a live AE run confirms the DOM.
 */
export type AfterEffectsScriptOperation =
  | 'set_comp_setting'
  | 'add_to_render_queue'
  | 'set_render_settings';

export const AFTER_EFFECTS_SCRIPT_OPERATIONS: readonly AfterEffectsScriptOperation[] = [
  'set_comp_setting',
  'add_to_render_queue',
  'set_render_settings',
] as const;

/**
 * Comp settings `set_comp_setting` can change. A deliberately SMALL, safe,
 * numeric-only set: composition width/height (pixels) and frame rate (fps).
 * Each maps to a documented CompItem property. // VERIFY the exact property
 * names + that assigning them is permitted without a UI.
 */
export type AfterEffectsCompSettingKey = 'width' | 'height' | 'frameRate';

interface CompSettingContract {
  /** CompItem property name assigned in the JSX. */
  property: 'width' | 'height' | 'frameRate';
  min: number;
  max: number;
  /** Whether the value must be an integer (pixels) or may be fractional (fps). */
  integer: boolean;
  describe: string;
}

// // VERIFY: property names + assignable-without-UI on a real AE install.
const COMP_SETTING_CONTRACTS: Record<AfterEffectsCompSettingKey, CompSettingContract> = {
  // AE comps top out at 30000 px per side; keep a conservative sane floor.
  width: { property: 'width', min: 1, max: 30000, integer: true, describe: 'composition width (px)' },
  height: { property: 'height', min: 1, max: 30000, integer: true, describe: 'composition height (px)' },
  // Frame rate: fractional rates (23.976, 29.97) are legal, so not integer-only.
  frameRate: { property: 'frameRate', min: 1, max: 1000, integer: false, describe: 'composition frame rate (fps)' },
};

export const AFTER_EFFECTS_COMP_SETTING_KEYS: readonly AfterEffectsCompSettingKey[] = [
  'width',
  'height',
  'frameRate',
] as const;

// ── Frame bounds ─────────────────────────────────────────────────────────────
// aerender frame indices are non-negative integers. Bound the upper end so a
// degenerate value can never blow up the argv or the render window. 2,592,000
// frames is ~24h at 30fps — generous but finite.
export const AFTER_EFFECTS_MAX_FRAME = 2_592_000;

// ── Shared validation primitives ─────────────────────────────────────────────

export type AfterEffectsParamCheck<T> = { ok: true; value: T } | { ok: false; error: string };

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Path validation — LOCKSTEP with cadCodeExecutor.validateCadPath ↔
 * appScriptRunner.validateRunnerPath ↔ scripts/claude-bridge.js
 * validateDesktopPathServer. Rejects: non-string, empty, >1024 chars, control
 * chars, shell metachars, non-BMP code points (cannot be embedded in an ASCII
 * ExtendScript literal), and `..` traversal. A path that passes here is a safe
 * single argv token AND embeds safely via `extendScriptStringLiteral`.
 */
export function validateAfterEffectsPath(
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

/** Max length for label tokens (comp names, template names). */
export const AFTER_EFFECTS_MAX_LABEL_LENGTH = 255;

/**
 * ARGV-TOKEN label validation (aerender lane). A comp name here becomes ONE
 * argv token passed to execFile, so it is bounded, has no control chars /
 * newlines, no shell metachars (inert under execFile but rejected for defense
 * in depth), no path separators (a comp name must never smuggle a directory
 * change), no double quote, and is BMP-only. This is a strict allowlist by
 * rejection — stricter than AE itself allows a comp to be named, on purpose:
 * a comp name with a quote/newline is REFUSED for the CLI rather than escaped,
 * because there is no argv token to escape into.
 */
export function validateAfterEffectsLabel(
  raw: unknown,
  label: string,
): AfterEffectsParamCheck<string> {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${label} is empty` };
  if (trimmed.length > AFTER_EFFECTS_MAX_LABEL_LENGTH) {
    return { ok: false, error: `${label} exceeds ${AFTER_EFFECTS_MAX_LABEL_LENGTH} chars` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: `${label} contains control characters` };
  if (/[/\\]/.test(trimmed)) return { ok: false, error: `${label} must not contain a path separator` };
  if (/[`$;|&><\n"]/.test(trimmed)) return { ok: false, error: `${label} contains a disallowed metacharacter` };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: `${label} contains characters outside the basic multilingual plane` };
    }
  }
  return { ok: true, value: trimmed };
}

/**
 * STRING-LITERAL label validation (JSX lane). A comp name / template name here
 * becomes the CONTENTS of a double-quoted ExtendScript string literal, embedded
 * via `extendScriptStringLiteral`. That escaper safely handles `"` and `\`, so —
 * UNLIKE the argv-token validator — those two characters are PERMITTED here (AE
 * genuinely allows a comp named `Hero "Title"`). What is still refused, because
 * the ES3 escaper cannot represent it safely, is: control chars, newlines, and
 * non-BMP code points. Shell metachars (`$` `;` `|` `&` `<` `>` backtick) are
 * also rejected — they are harmless inside a quoted JS literal, but a comp name
 * has no legitimate reason to contain them and keeping them out preserves a
 * tight, boring allowlist. Path separators are still rejected (a comp name is
 * not a path). BMP-only.
 */
export function validateAfterEffectsScriptLabel(
  raw: unknown,
  label: string,
): AfterEffectsParamCheck<string> {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${label} is empty` };
  if (trimmed.length > AFTER_EFFECTS_MAX_LABEL_LENGTH) {
    return { ok: false, error: `${label} exceeds ${AFTER_EFFECTS_MAX_LABEL_LENGTH} chars` };
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
 * Non-negative integer frame index, bounded to AFTER_EFFECTS_MAX_FRAME. Strict:
 * numeric strings and fractions are rejected (fail closed) so a frame value can
 * never become a surprise argv token. undefined/null → not provided (null).
 */
export function validateAfterEffectsFrame(
  raw: unknown,
  label: string,
): AfterEffectsParamCheck<number | null> {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (
    typeof raw !== 'number'
    || !Number.isFinite(raw)
    || !Number.isInteger(raw)
    || raw < 0
    || raw > AFTER_EFFECTS_MAX_FRAME
  ) {
    return { ok: false, error: `${label} must be an integer between 0 and ${AFTER_EFFECTS_MAX_FRAME}` };
  }
  return { ok: true, value: raw };
}

/**
 * ES3-safe ExtendScript string literal. ExtendScript's escape handling is
 * limited and inconsistent for control chars across host versions, so instead of
 * emitting `\n`/`\uXXXX` we require the callers to have already REJECTED control
 * chars / newlines (validateAfterEffectsScriptLabel does for JSX-lane values).
 * The only escapes needed for the surviving BMP-printable text are `\` and `"`.
 * This mirrors the JSON.stringify-into-JSX technique in
 * illustratorExtendScriptAdapters but is spelled out for the ES3 escape set.
 *
 * If a caller (defensively) passes a value still containing a control char, we
 * FAIL CLOSED by returning null rather than emitting an ambiguous literal.
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

// ── Lane 1: aerender CLI render ──────────────────────────────────────────────

export interface AfterEffectsRenderInput {
  /** After Effects project file (validated; must end in .aep/.aepx). */
  projectPath: string;
  /** Comp name to render (label allowlist). */
  compName: string;
  /** Output file path aerender writes (validated; extension NOT enforced —
   *  the output module template decides the container). */
  outputPath: string;
  /** Optional start frame (non-negative integer). */
  startFrame?: number | null;
  /** Optional end frame (non-negative integer; must be >= startFrame). */
  endFrame?: number | null;
}

export interface AfterEffectsRenderBuild {
  engine: typeof AFTER_EFFECTS_RENDER_ENGINE;
  /** Validated argv tokens AFTER the binary (the bridge prepends fixed-path
   *  `aerender` and runs execFile — NO shell). Empty when the build failed. */
  args: string[];
  /** The output file to stat-verify after the render (null when build failed). */
  outputHint: string | null;
  /** false until a live aerender run confirms the flags — gates wiring. */
  verifiedInvocation: false;
  /** Renders write a file → approval + output stat proof required. */
  writesFiles: true;
  notes: string[];
}

/**
 * Build the validated aerender argv for a single-comp render. Returns
 * `{ engine:'aerender', args, outputHint, notes, verifiedInvocation:false }`.
 * On a fatal input problem (bad project/comp/output, or endFrame < startFrame)
 * `args` is `[]` and `outputHint` is null with the reason in `notes` — the
 * caller checks `args.length` before running. Every user value is
 * allowlist-validated and becomes a single argv token; bad OPTIONAL fields
 * (frame range) are dropped with a note. Never throws.
 */
export function buildAfterEffectsRender(input: unknown): AfterEffectsRenderBuild {
  const notes: string[] = [];
  const fail = (reason: string): AfterEffectsRenderBuild => ({
    engine: AFTER_EFFECTS_RENDER_ENGINE,
    args: [],
    outputHint: null,
    verifiedInvocation: false,
    writesFiles: true,
    notes: [reason, ...notes],
  });

  const r = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const project = validateAfterEffectsPath(r.projectPath, 'projectPath');
  if (!project.ok) return fail(`render aborted — ${project.error}.`);
  const projectExt = extensionOf(project.path);
  if (!AFTER_EFFECTS_PROJECT_EXTENSIONS.includes(projectExt)) {
    return fail(
      `render aborted — projectPath must end in .${AFTER_EFFECTS_PROJECT_EXTENSIONS.join(' or .')} (got .${projectExt || '?'}).`,
    );
  }

  const comp = validateAfterEffectsLabel(r.compName, 'compName');
  if (!comp.ok) return fail(`render aborted — ${comp.error}.`);

  const output = validateAfterEffectsPath(r.outputPath, 'outputPath');
  if (!output.ok) return fail(`render aborted — ${output.error}.`);

  // Frame range (optional). Both must validate if present; end >= start.
  const start = validateAfterEffectsFrame(r.startFrame, 'startFrame');
  if (!start.ok) return fail(`render aborted — ${start.error}.`);
  const end = validateAfterEffectsFrame(r.endFrame, 'endFrame');
  if (!end.ok) return fail(`render aborted — ${end.error}.`);
  if (start.value !== null && end.value !== null && end.value < start.value) {
    return fail(`render aborted — endFrame (${end.value}) must be >= startFrame (${start.value}).`);
  }

  // Assemble argv. Each token is a validated path/label/number — NO shell.
  // // VERIFY the exact flag spellings (-project/-comp/-output/-s/-e) on a real
  // aerender before wiring; some builds use -RStemplate/-OMtemplate too.
  const args: string[] = [
    '-project', project.path,
    '-comp', comp.value,
    '-output', output.path,
  ];
  if (start.value !== null) args.push('-s', String(start.value));
  if (end.value !== null) args.push('-e', String(end.value));

  // Belt + suspenders: NO token may contain a control char / newline (the path
  // + label validators already reject these; number tokens are digits only).
  for (const token of args) {
    // eslint-disable-next-line no-control-regex
    if (typeof token !== 'string' || /[\x00-\x1f\n]/.test(token)) {
      return fail('render aborted — assembled an unsafe argv token (control character).');
    }
  }

  notes.push(
    'aerender renders headlessly (no UI). // VERIFY the -project/-comp/-output/-s/-e flag spellings on a real After Effects install before wiring.',
  );
  notes.push('The output module template (not this adapter) fixes codec/container — the output extension is not enforced here.');
  notes.push('Verify the render with desktop.file_stat after the run — aerender reports no output path itself.');
  if (start.value === null && end.value === null) {
    notes.push('No frame range given — aerender renders the comp work area / full duration per its defaults.');
  }

  return {
    engine: AFTER_EFFECTS_RENDER_ENGINE,
    args,
    outputHint: output.path,
    verifiedInvocation: false,
    writesFiles: true,
    notes,
  };
}

// ── Lane 2: JSX ExtendScript setup ops ───────────────────────────────────────

export interface AfterEffectsSetCompSettingInput {
  op: 'set_comp_setting';
  /** Exact comp name to target (label allowlist). Fail-closed if not found. */
  compName: string;
  /** Which setting to change. */
  setting: AfterEffectsCompSettingKey;
  /** New numeric value (bounded per setting; integer for width/height). */
  value: number;
}

export interface AfterEffectsAddToRenderQueueInput {
  op: 'add_to_render_queue';
  /** Exact comp name to add to the render queue (label allowlist). */
  compName: string;
  /** Optional output-module template name to apply (label allowlist). */
  outputModuleTemplate?: string | null;
  /** Optional render-settings template name to apply (label allowlist). */
  renderSettingsTemplate?: string | null;
}

export interface AfterEffectsSetRenderSettingsInput {
  op: 'set_render_settings';
  /** Exact comp name whose queued render item(s) to retarget (label allowlist). */
  compName: string;
  /** Render-settings template name to apply (label allowlist). */
  renderSettingsTemplate: string;
}

export type AfterEffectsScriptInput =
  | AfterEffectsSetCompSettingInput
  | AfterEffectsAddToRenderQueueInput
  | AfterEffectsSetRenderSettingsInput;

export interface AfterEffectsScriptBuild {
  /** The .jsx ExtendScript body ('' when the build failed — check before running). */
  script: string;
  scriptExtension: typeof AFTER_EFFECTS_SCRIPT_EXTENSION;
  /** false until a live AE run confirms the scripting DOM — gates wiring. */
  verifiedInvocation: false;
  /** JSX setup ops MUTATE the project (approval-gated); none write a render file. */
  mutatesProject: boolean;
  notes: string[];
}

export type AfterEffectsArgsValidation =
  | { ok: true; value: AfterEffectsScriptInput }
  | { ok: false; error: string };

function isScriptOperation(value: unknown): value is AfterEffectsScriptOperation {
  return typeof value === 'string' && (AFTER_EFFECTS_SCRIPT_OPERATIONS as readonly string[]).includes(value);
}

function isCompSettingKey(value: unknown): value is AfterEffectsCompSettingKey {
  return typeof value === 'string' && (AFTER_EFFECTS_COMP_SETTING_KEYS as readonly string[]).includes(value);
}

/**
 * Validate a raw JSX-op request into a typed `AfterEffectsScriptInput` (or a
 * typed error). Shape/enum + required-field checks here; per-value validation
 * (label allowlist, numeric bounds) is enforced again in the builder so the
 * emitted script only ever embeds validated values. Never throws.
 */
export function validateAfterEffectsArgs(input: unknown): AfterEffectsArgsValidation {
  if (!input || typeof input !== 'object') return { ok: false, error: 'request must be an object' };
  const r = input as Record<string, unknown>;
  const op = r.op;
  if (!isScriptOperation(op)) {
    return { ok: false, error: `op must be one of ${AFTER_EFFECTS_SCRIPT_OPERATIONS.join(', ')}` };
  }

  if (op === 'set_comp_setting') {
    const comp = validateAfterEffectsScriptLabel(r.compName, 'compName');
    if (!comp.ok) return { ok: false, error: comp.error };
    if (!isCompSettingKey(r.setting)) {
      return { ok: false, error: `setting must be one of ${AFTER_EFFECTS_COMP_SETTING_KEYS.join(', ')}` };
    }
    const contract = COMP_SETTING_CONTRACTS[r.setting];
    const value = r.value;
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || (contract.integer && !Number.isInteger(value))
      || value < contract.min
      || value > contract.max
    ) {
      return {
        ok: false,
        error: `value for ${r.setting} must be a ${contract.integer ? 'n integer' : ' number'} between ${contract.min} and ${contract.max}`,
      };
    }
    return { ok: true, value: { op: 'set_comp_setting', compName: comp.value, setting: r.setting, value } };
  }

  if (op === 'add_to_render_queue') {
    const comp = validateAfterEffectsScriptLabel(r.compName, 'compName');
    if (!comp.ok) return { ok: false, error: comp.error };
    const value: AfterEffectsAddToRenderQueueInput = { op: 'add_to_render_queue', compName: comp.value };
    if (r.outputModuleTemplate != null && String(r.outputModuleTemplate).trim()) {
      const om = validateAfterEffectsScriptLabel(r.outputModuleTemplate, 'outputModuleTemplate');
      if (!om.ok) return { ok: false, error: om.error };
      value.outputModuleTemplate = om.value;
    }
    if (r.renderSettingsTemplate != null && String(r.renderSettingsTemplate).trim()) {
      const rs = validateAfterEffectsScriptLabel(r.renderSettingsTemplate, 'renderSettingsTemplate');
      if (!rs.ok) return { ok: false, error: rs.error };
      value.renderSettingsTemplate = rs.value;
    }
    return { ok: true, value };
  }

  // op === 'set_render_settings'
  const comp = validateAfterEffectsScriptLabel(r.compName, 'compName');
  if (!comp.ok) return { ok: false, error: comp.error };
  const rs = validateAfterEffectsScriptLabel(r.renderSettingsTemplate, 'renderSettingsTemplate');
  if (!rs.ok) return { ok: false, error: rs.error };
  return { ok: true, value: { op: 'set_render_settings', compName: comp.value, renderSettingsTemplate: rs.value } };
}

/**
 * LOCKSTEP-shaped JSX prelude: fail-closed comp lookup by exact name + a single
 * JSON.stringify-shaped result line so the caller can fail closed on anything
 * unexpected. NEVER saves the project. The `expectedCompName` is embedded via
 * `extendScriptStringLiteral` (already validated). Pure boilerplate otherwise.
 *
 * // VERIFY the AE scripting DOM: app.project, app.project.numItems,
 * // app.project.item(i) (1-indexed), `instanceof CompItem`, item.name.
 */
function afterEffectsJsxPrelude(compLiteral: string): string {
  return [
    'var EXPECTED_COMP_NAME = ' + compLiteral + ';',
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
    '// Locate the target comp by EXACT name. Fail closed (no fuzzy match, never',
    '// the "active" comp) so a mutation can only ever hit the named comp.',
    'function findTargetComp() {',
    '  try {',
    '    if (!app.project) return null;',
    '    var count = app.project.numItems;',
    '    for (var i = 1; i <= count; i += 1) {',
    '      var item = app.project.item(i);',
    '      if (item instanceof CompItem && String(item.name) === EXPECTED_COMP_NAME) return item;',
    '    }',
    '  } catch (_) {}',
    '  return null;',
    '}',
  ].join('\n');
}

function buildSetCompSettingJsx(value: AfterEffectsSetCompSettingInput): AfterEffectsScriptBuild {
  const compLiteral = extendScriptStringLiteral(value.compName);
  if (compLiteral === null) {
    return { script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, notes: ['set_comp_setting aborted — compName could not be safely embedded.'] };
  }
  const contract = COMP_SETTING_CONTRACTS[value.setting];
  // The numeric value is validated + bounded; emit it as a plain numeric token
  // (Number()-round-tripped so it can only ever be a number literal).
  const numericLiteral = contract.integer ? String(Math.trunc(value.value)) : String(value.value);
  const propertyLiteral = extendScriptStringLiteral(contract.property);
  if (propertyLiteral === null) {
    return { script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, notes: ['set_comp_setting aborted — internal property token unsafe.'] };
  }

  const body = [
    '(function () {',
    afterEffectsJsxPrelude(compLiteral),
    '',
    '  var SETTING_PROPERTY = ' + propertyLiteral + ';',
    '  var NEW_VALUE = ' + numericLiteral + ';',
    '',
    '  var result = {',
    '    ok: false,',
    '    appName: "",',
    '    compName: null,',
    '    setting: SETTING_PROPERTY,',
    '    newValue: NEW_VALUE,',
    '    oldValue: null,',
    '    error: null',
    '  };',
    '  try { result.appName = String(app.appName || "After Effects"); } catch (_) {}',
    '',
    '  function stringifyResult(v) {',
    '    return "{" + [',
    '      "\\"ok\\":" + jsonBoolean(v.ok),',
    '      "\\"appName\\":" + jsonString(v.appName),',
    '      "\\"compName\\":" + jsonNullableString(v.compName),',
    '      "\\"setting\\":" + jsonString(v.setting),',
    '      "\\"newValue\\":" + jsonNumber(v.newValue),',
    '      "\\"oldValue\\":" + (v.oldValue === null ? "null" : jsonNumber(v.oldValue)),',
    '      "\\"error\\":" + jsonNullableString(v.error)',
    '    ].join(",") + "}";',
    '  }',
    '',
    '  var comp = findTargetComp();',
    '  if (comp === null) {',
    '    result.error = "comp_not_found";',
    '    return stringifyResult(result);',
    '  }',
    '  result.compName = String(comp.name || "");',
    '  try { result.oldValue = Number(comp[SETTING_PROPERTY]); } catch (_) {}',
    '',
    '  // The ONLY mutation is assigning the one validated numeric property on the',
    '  // named comp. The project is NEVER saved by this script.',
    '  try {',
    '    comp[SETTING_PROPERTY] = NEW_VALUE;',
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
    notes: [
      `set_comp_setting changes ${contract.describe} on comp "${value.compName}" — MUTATES the project (approval-gated); it never saves the project.`,
      'Proof: parse the single JSON result line for ok/oldValue/newValue, then re-observe the comp to confirm the change.',
      '// VERIFY the CompItem property assignment (width/height/frameRate) is permitted headlessly on a real After Effects install.',
    ],
  };
}

function buildAddToRenderQueueJsx(value: AfterEffectsAddToRenderQueueInput): AfterEffectsScriptBuild {
  const compLiteral = extendScriptStringLiteral(value.compName);
  if (compLiteral === null) {
    return { script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, notes: ['add_to_render_queue aborted — compName could not be safely embedded.'] };
  }
  const omLiteral = value.outputModuleTemplate ? extendScriptStringLiteral(value.outputModuleTemplate) : 'null';
  const rsLiteral = value.renderSettingsTemplate ? extendScriptStringLiteral(value.renderSettingsTemplate) : 'null';
  if (omLiteral === null || rsLiteral === null) {
    return { script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, notes: ['add_to_render_queue aborted — a template name could not be safely embedded.'] };
  }

  const notes: string[] = [];
  const body = [
    '(function () {',
    afterEffectsJsxPrelude(compLiteral),
    '',
    '  var OUTPUT_MODULE_TEMPLATE = ' + omLiteral + ';',
    '  var RENDER_SETTINGS_TEMPLATE = ' + rsLiteral + ';',
    '',
    '  var result = {',
    '    ok: false,',
    '    appName: "",',
    '    compName: null,',
    '    outputModuleTemplateApplied: null,',
    '    renderSettingsTemplateApplied: null,',
    '    renderQueueLength: 0,',
    '    error: null',
    '  };',
    '  try { result.appName = String(app.appName || "After Effects"); } catch (_) {}',
    '',
    '  function stringifyResult(v) {',
    '    return "{" + [',
    '      "\\"ok\\":" + jsonBoolean(v.ok),',
    '      "\\"appName\\":" + jsonString(v.appName),',
    '      "\\"compName\\":" + jsonNullableString(v.compName),',
    '      "\\"outputModuleTemplateApplied\\":" + jsonNullableString(v.outputModuleTemplateApplied),',
    '      "\\"renderSettingsTemplateApplied\\":" + jsonNullableString(v.renderSettingsTemplateApplied),',
    '      "\\"renderQueueLength\\":" + jsonNumber(v.renderQueueLength),',
    '      "\\"error\\":" + jsonNullableString(v.error)',
    '    ].join(",") + "}";',
    '  }',
    '',
    '  var comp = findTargetComp();',
    '  if (comp === null) {',
    '    result.error = "comp_not_found";',
    '    return stringifyResult(result);',
    '  }',
    '  result.compName = String(comp.name || "");',
    '',
    '  // Add the named comp to the render queue. Applying a template is best-',
    '  // effort: an unknown template name is reported, not fatal (the item still',
    '  // queues with defaults). The project is NEVER saved by this script.',
    '  try {',
    '    var rq = app.project.renderQueue;',
    '    var rqItem = rq.items.add(comp);',
    '    if (RENDER_SETTINGS_TEMPLATE !== null) {',
    '      try { rqItem.applyTemplate(RENDER_SETTINGS_TEMPLATE); result.renderSettingsTemplateApplied = RENDER_SETTINGS_TEMPLATE; }',
    '      catch (_) { result.renderSettingsTemplateApplied = null; }',
    '    }',
    '    if (OUTPUT_MODULE_TEMPLATE !== null) {',
    '      try { rqItem.outputModule(1).applyTemplate(OUTPUT_MODULE_TEMPLATE); result.outputModuleTemplateApplied = OUTPUT_MODULE_TEMPLATE; }',
    '      catch (_) { result.outputModuleTemplateApplied = null; }',
    '    }',
    '    result.renderQueueLength = Number(rq.numItems) || 0;',
    '    result.ok = true;',
    '  } catch (err) {',
    '    result.error = String(err && err.message ? err.message : err);',
    '  }',
    '  return stringifyResult(result);',
    '}());',
    '',
  ].join('\n');

  notes.push(`add_to_render_queue queues comp "${value.compName}" for render — MUTATES the project (approval-gated); it never saves the project and never starts the render.`);
  if (value.renderSettingsTemplate) notes.push(`Attempts render-settings template "${value.renderSettingsTemplate}" (best-effort; unknown template reported, not fatal).`);
  if (value.outputModuleTemplate) notes.push(`Attempts output-module template "${value.outputModuleTemplate}" (best-effort; unknown template reported, not fatal).`);
  notes.push('The actual render still runs via the aerender lane (buildAfterEffectsRender) or an explicit approved render start.');
  notes.push('// VERIFY the renderQueue.items.add / applyTemplate / outputModule DOM on a real After Effects install.');

  return { script: body, scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: true, notes };
}

function buildSetRenderSettingsJsx(value: AfterEffectsSetRenderSettingsInput): AfterEffectsScriptBuild {
  const compLiteral = extendScriptStringLiteral(value.compName);
  const rsLiteral = extendScriptStringLiteral(value.renderSettingsTemplate);
  if (compLiteral === null || rsLiteral === null) {
    return { script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, notes: ['set_render_settings aborted — compName/template could not be safely embedded.'] };
  }

  const body = [
    '(function () {',
    afterEffectsJsxPrelude(compLiteral),
    '',
    '  var RENDER_SETTINGS_TEMPLATE = ' + rsLiteral + ';',
    '',
    '  var result = {',
    '    ok: false,',
    '    appName: "",',
    '    compName: null,',
    '    template: RENDER_SETTINGS_TEMPLATE,',
    '    itemsUpdated: 0,',
    '    error: null',
    '  };',
    '  try { result.appName = String(app.appName || "After Effects"); } catch (_) {}',
    '',
    '  function stringifyResult(v) {',
    '    return "{" + [',
    '      "\\"ok\\":" + jsonBoolean(v.ok),',
    '      "\\"appName\\":" + jsonString(v.appName),',
    '      "\\"compName\\":" + jsonNullableString(v.compName),',
    '      "\\"template\\":" + jsonString(v.template),',
    '      "\\"itemsUpdated\\":" + jsonNumber(v.itemsUpdated),',
    '      "\\"error\\":" + jsonNullableString(v.error)',
    '    ].join(",") + "}";',
    '  }',
    '',
    '  var comp = findTargetComp();',
    '  if (comp === null) {',
    '    result.error = "comp_not_found";',
    '    return stringifyResult(result);',
    '  }',
    '  result.compName = String(comp.name || "");',
    '',
    '  // Apply the render-settings template to every QUEUED render item whose',
    '  // source comp is the named comp. Does not queue new items, start a render,',
    '  // or save the project.',
    '  try {',
    '    var rq = app.project.renderQueue;',
    '    var updated = 0;',
    '    for (var i = 1; i <= rq.numItems; i += 1) {',
    '      var item = rq.item(i);',
    '      var matches = false;',
    '      try { matches = (item.comp === comp) || (String(item.comp.name) === String(comp.name)); } catch (_) {}',
    '      if (!matches) continue;',
    '      try { item.applyTemplate(RENDER_SETTINGS_TEMPLATE); updated += 1; } catch (_) {}',
    '    }',
    '    result.itemsUpdated = updated;',
    '    result.ok = updated > 0;',
    '    if (updated === 0) result.error = "no_matching_queued_items";',
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
    notes: [
      `set_render_settings applies template "${value.renderSettingsTemplate}" to queued render items for comp "${value.compName}" — MUTATES the project (approval-gated); it never saves the project or starts a render.`,
      'Proof: parse the JSON result line for itemsUpdated (0 → no matching queued item, add it first via add_to_render_queue).',
      '// VERIFY renderQueue.item(i).applyTemplate + item.comp identity on a real After Effects install.',
    ],
  };
}

/**
 * Build a validated After Effects JSX setup script for a bounded operation.
 * Returns `{ script, scriptExtension:'jsx', verifiedInvocation:false,
 * mutatesProject, notes }`. On a fatal input problem (bad op, unusable value)
 * `script` is '' and the reason is in `notes` — the caller checks `script`
 * before staging + running via the bridge (DoScriptFile / afterfx -r). Every
 * user value is allowlist-validated and embedded ONLY via
 * `extendScriptStringLiteral`; nothing is raw-concatenated. Never throws.
 *
 * Ergonomics: accepts buildAfterEffectsScript(input) with {op,...} OR
 * buildAfterEffectsScript(op, {...}) — same as autocadScriptAdapter.
 */
export function buildAfterEffectsScript(op: unknown, input?: unknown): AfterEffectsScriptBuild {
  let request: unknown;
  if (typeof op === 'string') {
    request = { ...(input && typeof input === 'object' ? (input as Record<string, unknown>) : {}), op };
  } else {
    request = op;
  }

  const validation = validateAfterEffectsArgs(request);
  if (!validation.ok) {
    return { script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, notes: [`Invalid After Effects request — ${validation.error}.`] };
  }
  const value = validation.value;
  switch (value.op) {
    case 'set_comp_setting':
      return buildSetCompSettingJsx(value);
    case 'add_to_render_queue':
      return buildAddToRenderQueueJsx(value);
    case 'set_render_settings':
      return buildSetRenderSettingsJsx(value);
    default:
      return { script: '', scriptExtension: 'jsx', verifiedInvocation: false, mutatesProject: false, notes: ['Unsupported After Effects operation.'] };
  }
}

// ── Human-readable describe (approval preview) ───────────────────────────────

/**
 * One-line plain-language description of a render or JSX op for an approval
 * preview / notice. Never throws; safe on garbage input. For the render lane
 * pass `{ render: true, projectPath, compName, outputPath }` or an
 * AfterEffectsRenderInput; for JSX pass the op request.
 */
export function describeAfterEffectsOperation(input: unknown): string {
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  // Render lane: recognised by op:'render' or the presence of projectPath.
  if (r.op === 'render' || r.render === true || (typeof r.projectPath === 'string' && r.op === undefined)) {
    const comp = typeof r.compName === 'string' && r.compName.trim() ? ` comp "${String(r.compName).slice(0, 60)}"` : ' the comp';
    return `Render${comp} headlessly via aerender to the approved output (writes a file; approval + output proof required)`;
  }

  const validation = validateAfterEffectsArgs(r);
  if (!validation.ok) return 'Run an After Effects operation (approval-gated local execution)';
  const value = validation.value;
  switch (value.op) {
    case 'set_comp_setting': {
      const contract = COMP_SETTING_CONTRACTS[value.setting];
      return `Set ${contract.describe} to ${value.value} on After Effects comp "${value.compName.slice(0, 60)}" (ExtendScript, approval-gated, MUTATES the project)`;
    }
    case 'add_to_render_queue':
      return `Add After Effects comp "${value.compName.slice(0, 60)}" to the render queue (ExtendScript, approval-gated, MUTATES the project)`;
    case 'set_render_settings':
      return `Apply render-settings template "${value.renderSettingsTemplate.slice(0, 40)}" to queued items for comp "${value.compName.slice(0, 40)}" (ExtendScript, approval-gated, MUTATES the project)`;
    default:
      return 'Run an After Effects operation (approval-gated local execution)';
  }
}

// ── appScriptRunner engine descriptor (REPORT-ONLY; NOT wired) ───────────────

/**
 * The `aerender` engine descriptor shape this adapter WOULD register in
 * `src/lib/appScriptRunner.ts` (APP_SCRIPT_ENGINE_REGISTRY) once the invocation
 * is verified. Exported as data (not imported into appScriptRunner) so this
 * module stays pure and does NOT edit the shared registry. The caller/report
 * carries this to whoever wires the bridge.
 *
 * NOTE the impedance mismatch with the existing registry: the seed engines run a
 * generated SCRIPT FILE by `sourcePath`. aerender instead renders a PROJECT with
 * a comp+output selected by flags — there is no generated script file. So this
 * descriptor models aerender as a RENDER JOB: `sourceExtensions` are the project
 * types ('aep'/'aepx'), and `buildArgs` would consume the render-job fields
 * (compName + output + frame range) rather than a script path. Wiring this may
 * warrant a small render-job variant of AppScriptRunRequest, or letting
 * buildAfterEffectsRender own the argv directly (recommended — it already
 * produces the validated argv). This descriptor is documentation of intent.
 */
export interface AfterEffectsRenderEngineDescriptor {
  id: typeof AFTER_EFFECTS_RENDER_ENGINE;
  label: string;
  platform: 'mac' | 'windows' | 'cross';
  /** The project file types aerender opens (the "source" of a render job). */
  sourceExtensions: readonly string[];
  /** Empty: the output module template chooses the container; stat-verified. */
  outputExtensions: readonly string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  /** false until a live aerender run confirms the flags. */
  verifiedInvocation: false;
}

export const AFTER_EFFECTS_RENDER_ENGINE_DESCRIPTOR: AfterEffectsRenderEngineDescriptor = {
  id: AFTER_EFFECTS_RENDER_ENGINE,
  label: 'After Effects (aerender headless render)',
  platform: 'cross',
  sourceExtensions: AFTER_EFFECTS_PROJECT_EXTENSIONS,
  outputExtensions: [], // output module template decides; stat-verified by the caller
  defaultTimeoutMs: 600_000, // renders are long; 10 min default
  maxTimeoutMs: 21_600_000, // hard ceiling ~6h
  verifiedInvocation: false,
};
