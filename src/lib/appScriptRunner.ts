// appScriptRunner — the GENERALIZED headless-script substrate (plan P2).
//
// cadCodeExecutor.ts already ships a hardened, LOCKSTEP-with-the-bridge runner
// for OpenSCAD/FreeCAD/Blender: fixed binary paths, strict arg allowlists,
// execFile argv (no shell), timeout clamps, path validation. This module
// generalizes that SAME proven model to more headless apps (MATLAB, KiCad,
// AutoCAD core console, Maya, GIMP, After Effects, …) so adding an app N+1
// becomes a new engine descriptor + a script generator — NOT a new bespoke
// endpoint. It is the pure contract behind a future `desktop.run_app_script`
// bridge tool.
//
// PURITY: zero imports, tsx-loadable (smoke: app-script-runner). It shapes and
// VALIDATES a run request into a safe argv the bridge will execute; it never
// touches the filesystem, spawns a process, or resolves a real binary — the
// bridge does that (LOCKSTEP), resolving the binary from FIXED install paths.
//
// THREE INVOCATION MODES (the P73 finding — Substrate A is not one shape):
//   * script_file    — a generated script is written to `sourcePath` first, then
//                       the binary runs it (matlab -batch run('f.m'); mayapy f.py;
//                       accoreconsole /s f.scr). The CALLER writes the file
//                       (desktop.file_write_text) before invoking the runner.
//   * inline_program — the generated program text is passed AS an argv token, no
//                       script file (gimp -b "<python-fu>"). Carried in
//                       `programText`; the adapter guarantees it is a single
//                       newline-free line so it survives as one token.
//   * render_job     — no generated code at all; structured flags over an
//                       EXISTING input file (kicad-cli export; aerender -project
//                       -comp -output). Carried in `sourcePath` (the input) +
//                       per-engine allowlisted `jobParams`.
// Each engine declares its `mode`; validation and the bridge branch on it.
//
// SECURITY (mirrors cadCodeExecutor + claude-bridge.js validateDesktopPathServer,
// kept in LOCKSTEP): every path is length-bounded, control-char-free,
// shell-metacharacter-free, and BMP-only; `programText` is length-bounded and
// (via the final token check) control-char/newline-free; `jobParams` values are
// ints or bounded metachar-free BMP tokens; extraArgs pass a strict per-engine
// allowlist; timeouts clamp to the engine's window. Because the bridge runs
// execFile with an argv ARRAY (never a shell), a metachar inside a token is
// inert — but we still reject them on paths/jobParams as defense-in-depth. The
// validation core below is engine-AGNOSTIC and is the tested value.
//
// INVOCATION VERIFICATION: each engine's `buildArgs` template encodes a
// real-world headless CLI contract. Some were doc-verified 2026-07-13 (see the
// per-engine notes + plan §10a) but NONE has had a live install run, so every
// engine carries `verifiedInvocation: false` and a `// VERIFY` note. Doc-verified
// ≠ install-verified: the flag flips only after the bridge LOCKSTEP + a live run
// confirm the invocation before `desktop.run_app_script` is wired for it. The
// validation/security logic is correct regardless of those specifics.

export type AppScriptEngine =
  | 'matlab'
  | 'kicad_cli'
  | 'autocad_core'
  | 'maya_python'
  | 'gimp'
  | 'aerender';

export const APP_SCRIPT_ENGINES: readonly AppScriptEngine[] = [
  'matlab',
  'kicad_cli',
  'autocad_core',
  'maya_python',
  'gimp',
  'aerender',
] as const;

export type AppScriptPlatform = 'mac' | 'windows' | 'cross';

/** How the engine is invoked — determines what the request must carry and
 *  whether the bridge writes a generated script first. See the header. */
export type AppScriptRunMode = 'script_file' | 'inline_program' | 'render_job';

export interface AppScriptEngineDescriptor {
  id: AppScriptEngine;
  label: string;
  platform: AppScriptPlatform;
  mode: AppScriptRunMode;
  /** Allowed source/input extensions (lowercase, no dot). For script_file this
   *  is the generated script's ext; for render_job the EXISTING input file's
   *  ext; for inline_program it is [] (no source file). */
  sourceExtensions: readonly string[];
  /** Allowed produced-output extensions (lowercase, no dot). Empty = the
   *  script/job writes files it chooses (still stat-verified by the caller). */
  outputExtensions: readonly string[];
  /** render_job only: jobParam keys that MUST be present after sanitization. */
  requiredJobParams?: readonly string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  /** Strict per-engine extraArg allowlist. Conservative by default (none). */
  isAllowedExtraArg: (arg: string) => boolean;
  /** Build the validated arg vector (AFTER the binary; the bridge prepends the
   *  fixed-path binary and runs execFile — no shell). All inputs are already
   *  validated: `sourcePath` is '' for inline_program; `programText` is present
   *  for inline_program; `jobParams` values are sanitized strings. */
  buildArgs: (input: {
    sourcePath: string;
    outputPath: string;
    inputPath?: string;
    programText?: string;
    jobParams: Record<string, string>;
    extraArgs: string[];
  }) => string[];
  /** false until a live bridge run confirms the invocation — see header. */
  verifiedInvocation: boolean;
}

// No extra args accepted for any seed engine yet (fail-closed; widen per engine
// with a strict regex allowlist when a real need appears, like OpenSCAD's).
const denyAllExtraArgs = (_arg: string): boolean => false;

export const APP_SCRIPT_ENGINE_REGISTRY: Record<AppScriptEngine, AppScriptEngineDescriptor> = {
  // MATLAB non-interactive: `matlab -batch "run('<script.m>')"` — doc-verified
  // 2026-07-13 (documented since R2019a; exits with the script's status, no
  // desktop; do NOT add -nodisplay/-nosplash — -batch implies them and -nosplash
  // is deprecated as of R2025a). // VERIFY: binary name + install path via a
  // live run before wiring.
  matlab: {
    id: 'matlab',
    label: 'MATLAB (headless -batch)',
    platform: 'cross',
    mode: 'script_file',
    sourceExtensions: ['m'],
    outputExtensions: [], // scripts write .mat/.csv/.png/etc. — stat-verified by the caller
    defaultTimeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    isAllowedExtraArg: denyAllExtraArgs,
    buildArgs: ({ sourcePath }) => ['-batch', `run('${sourcePath}')`],
    verifiedInvocation: false,
  },
  // KiCad 7+ modern headless CLI (render_job: flags over an existing board/sch).
  // // VERIFY — CONFIRMED WRONG (2026-07-13): there is NO bare `export` verb.
  // Every export needs `<domain> export <fmt>` with the INPUT as the LAST
  // positional arg, e.g. `pcb export gerbers --output <dir> <board.kicad_pcb>`,
  // `pcb export step --output <file.step> <board>`, `sch export pdf --output
  // <file.pdf> <sch>`. gerbers/drill --output is a DIRECTORY; step/pdf/svg a FILE.
  // This flat buildArgs cannot serve all kinds — needs a per-export-kind branch
  // (a `format` jobParam) before wiring. Source: docs.kicad.org CLI 8.0/9.0.
  kicad_cli: {
    id: 'kicad_cli',
    label: 'KiCad (kicad-cli export)',
    platform: 'cross',
    mode: 'render_job',
    sourceExtensions: ['kicad_pcb', 'kicad_sch'],
    outputExtensions: ['pdf', 'svg', 'gerber', 'zip', 'step', 'stp', 'png', 'dxf'],
    defaultTimeoutMs: 90_000,
    maxTimeoutMs: 300_000,
    isAllowedExtraArg: denyAllExtraArgs,
    buildArgs: ({ sourcePath, outputPath }) => ['export', '--output', outputPath, sourcePath],
    verifiedInvocation: false,
  },
  // AutoCAD headless: `accoreconsole /i <drawing.dwg> /s <script.scr>` (Windows).
  // The .scr is the generated command script; the drawing is the input doc.
  // Invocation shell doc-verified 2026-07-13 (/i optional; .scr = line-by-line,
  // newline=Enter); the COMMAND BODIES the .scr contains are corrected in
  // autocadScriptAdapter.ts. // VERIFY: accoreconsole path on the target install.
  autocad_core: {
    id: 'autocad_core',
    label: 'AutoCAD (accoreconsole /s script)',
    platform: 'windows',
    mode: 'script_file',
    sourceExtensions: ['scr'],
    outputExtensions: [], // the script chooses what it writes (DXF/PDF/…)
    defaultTimeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    isAllowedExtraArg: denyAllExtraArgs,
    buildArgs: ({ sourcePath, inputPath }) =>
      inputPath ? ['/i', inputPath, '/s', sourcePath] : ['/s', sourcePath],
    verifiedInvocation: false,
  },
  // Maya standalone Python: `mayapy <script.py>` (script_file) — doc-verified
  // 2026-07-13 (script brackets maya.standalone.initialize/uninitialize; the
  // generator is mayaScriptAdapter.ts). macOS binary lives in the app bundle
  // (…/Maya.app/Contents/bin/mayapy). // VERIFY: install path via a live run.
  maya_python: {
    id: 'maya_python',
    label: 'Maya (mayapy standalone)',
    platform: 'cross',
    mode: 'script_file',
    sourceExtensions: ['py'],
    outputExtensions: [], // exports .mb/.ma/.fbx/.obj/frames — stat-verified
    defaultTimeoutMs: 180_000,
    maxTimeoutMs: 900_000,
    isAllowedExtraArg: denyAllExtraArgs,
    buildArgs: ({ sourcePath }) => [sourcePath],
    verifiedInvocation: false,
  },
  // GIMP 2.10 batch (inline_program): the generated Python-Fu program is passed
  // as ONE `-b` argv token, then a `-b "pdb.gimp_quit(1)"` to exit — doc-verified
  // 2026-07-13 (-i no-interface, -d no-data, -f no-fonts; interpreter
  // `python-fu-eval`). The generator is gimpScriptAdapter.ts, which guarantees a
  // single newline-free program line. // VERIFY: GIMP 3.0 removes the pdb.* API
  // (needs a separate 3.0 shape) — wire only against 2.10 until then.
  gimp: {
    id: 'gimp',
    label: 'GIMP (headless Python-Fu batch)',
    platform: 'cross',
    mode: 'inline_program',
    sourceExtensions: [], // no source file — the program is inline
    outputExtensions: [], // the program chooses what it exports
    defaultTimeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    isAllowedExtraArg: denyAllExtraArgs,
    buildArgs: ({ programText }) => [
      '-i',
      '-d',
      '-f',
      '--batch-interpreter=python-fu-eval',
      '-b',
      programText ?? '',
      '-b',
      'pdb.gimp_quit(1)',
    ],
    verifiedInvocation: false,
  },
  // After Effects aerender (render_job): `aerender -project <p.aep> -comp <name>
  // -output <out> [-s <start> -e <end>]` — flags doc-verified 2026-07-13. No
  // generated code; the comp already exists in the project. Render-settings /
  // output-module templates must pre-exist in the project (a future jobParam).
  // // VERIFY: aerender binary path (macOS app bundle) via a live run.
  aerender: {
    id: 'aerender',
    label: 'After Effects (aerender render job)',
    platform: 'cross',
    mode: 'render_job',
    sourceExtensions: ['aep'],
    outputExtensions: [], // output module decides (.mov/.mp4/.png-seq) — stat-verified
    requiredJobParams: ['comp'],
    defaultTimeoutMs: 300_000,
    maxTimeoutMs: 1_800_000,
    isAllowedExtraArg: denyAllExtraArgs,
    buildArgs: ({ sourcePath, outputPath, jobParams }) => {
      const args = ['-project', sourcePath, '-comp', jobParams.comp, '-output', outputPath];
      if (jobParams.startFrame !== undefined) args.push('-s', jobParams.startFrame);
      if (jobParams.endFrame !== undefined) args.push('-e', jobParams.endFrame);
      return args;
    },
    verifiedInvocation: false,
  },
};

export function isAppScriptEngine(value: unknown): value is AppScriptEngine {
  return typeof value === 'string' && (APP_SCRIPT_ENGINES as readonly string[]).includes(value);
}

// ── Path validation (LOCKSTEP: cadCodeExecutor.validateCadPath ↔ bridge
//    validateDesktopPathServer). Keep the reject-set byte-identical. ──────────
function validateRunnerPath(raw: unknown, label: string): { ok: true; path: string } | { ok: false; error: string } {
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
  // Directory traversal is inert once the bridge enforces its file-access grant,
  // but reject it here too so a plan never *looks* like an escape.
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: `${label} must not contain ".." traversal` };
  return { ok: true, path: trimmed };
}

/** Sanitize a render_job param value → a safe string, or null to drop it. Ints
 *  become their floored string; strings must be bounded, control-char-free,
 *  shell-metachar-free (defense-in-depth; argv is inert), and BMP-only. */
function sanitizeJobValue(raw: unknown): string | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    const n = Math.floor(raw);
    if (n < 0 || n > 10_000_000) return null;
    return String(n);
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t || t.length > 128) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f]/.test(t)) return null;
    if (/[`$;|&><\n]/.test(t)) return null;
    for (const ch of t) if ((ch.codePointAt(0) ?? 0) > 0xffff) return null;
    return t;
  }
  return null;
}

// jobParam keys are short identifiers (comp, startFrame, format, …).
const JOB_PARAM_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
// A generated inline program (GIMP Python-Fu) is bounded; the final token check
// enforces control-char/newline-free, so the adapter's safe-embedding holds.
const MAX_PROGRAM_TEXT = 100_000;

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9_]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ── Validate + plan ──────────────────────────────────────────────────────────

export interface AppScriptRunRequest {
  engine: AppScriptEngine;
  /** script_file: the generated script the bridge/caller already wrote.
   *  render_job: the EXISTING input file (board/project). Absent for
   *  inline_program (the program is `programText`). */
  sourcePath?: string;
  /** inline_program: the generated program passed as an argv token. */
  programText?: string;
  /** render_job: engine-allowlisted structured params (e.g. { comp, startFrame }). */
  jobParams?: Record<string, unknown>;
  /** Where the run should produce its primary output (stat-verified after). */
  outputPath?: string;
  /** Optional input document (e.g. AutoCAD drawing for a .scr). */
  inputPath?: string;
  extraArgs?: string[];
  timeoutMs?: number;
}

export interface AppScriptRunPlan {
  engine: AppScriptEngine;
  mode: AppScriptRunMode;
  /** Validated arg vector AFTER the binary (bridge prepends the fixed-path binary). */
  args: string[];
  timeoutMs: number;
  /** The generated-script/input path ('' when inline_program). */
  sourcePath: string;
  outputPath: string | null;
  inputPath: string | null;
  /** Sanitized render_job params actually used. */
  jobParams: Record<string, string>;
  /** Non-fatal notes (e.g. dropped extra args / job params). */
  notes: string[];
}

export type AppScriptRunValidation =
  | { ok: true; plan: AppScriptRunPlan }
  | { ok: false; error: string };

/**
 * Validate a run request into a safe `AppScriptRunPlan` (or a typed error).
 * Engine-agnostic security core: engine gate, per-mode required inputs, path
 * safety, source/output extension allowlists, program-text bounds, jobParam
 * sanitization, strict extraArg allowlist, timeout clamp. Never throws.
 */
export function validateAppScriptRunRequest(req: unknown): AppScriptRunValidation {
  if (!req || typeof req !== 'object') return { ok: false, error: 'run request must be an object' };
  const r = req as Record<string, unknown>;

  if (!isAppScriptEngine(r.engine)) {
    return { ok: false, error: `engine must be one of ${APP_SCRIPT_ENGINES.join(', ')}` };
  }
  const engine = APP_SCRIPT_ENGINE_REGISTRY[r.engine];
  const notes: string[] = [];

  // ── sourcePath: required for script_file (generated script) + render_job
  //    (existing input file); absent for inline_program. ────────────────────
  let sourcePath = '';
  if (engine.mode === 'script_file' || engine.mode === 'render_job') {
    const src = validateRunnerPath(r.sourcePath, 'sourcePath');
    if (!src.ok) return { ok: false, error: src.error };
    const srcExt = extensionOf(src.path);
    if (engine.sourceExtensions.length > 0 && !engine.sourceExtensions.includes(srcExt)) {
      return { ok: false, error: `${engine.label} source must be one of .${engine.sourceExtensions.join(', .')} (got .${srcExt || '?'})` };
    }
    sourcePath = src.path;
  }

  // ── programText: required for inline_program. Bounds only; the final token
  //    check enforces control-char/newline-free (the adapter guarantees it). ──
  let programText: string | undefined;
  if (engine.mode === 'inline_program') {
    if (typeof r.programText !== 'string' || !r.programText.trim()) {
      return { ok: false, error: `${engine.label} requires a non-empty programText` };
    }
    if (r.programText.length > MAX_PROGRAM_TEXT) {
      return { ok: false, error: `${engine.label} programText exceeds ${MAX_PROGRAM_TEXT} chars` };
    }
    programText = r.programText;
  }

  // ── outputPath (optional, ext-checked if the engine constrains it) ─────────
  let outputPath: string | null = null;
  if (r.outputPath != null && String(r.outputPath).trim()) {
    const out = validateRunnerPath(r.outputPath, 'outputPath');
    if (!out.ok) return { ok: false, error: out.error };
    if (engine.outputExtensions.length > 0) {
      const outExt = extensionOf(out.path);
      if (!engine.outputExtensions.includes(outExt)) {
        return { ok: false, error: `${engine.label} output must be one of .${engine.outputExtensions.join(', .')} (got .${outExt || '?'})` };
      }
    }
    outputPath = out.path;
  }

  // ── inputPath (optional secondary input) ───────────────────────────────────
  let inputPath: string | null = null;
  if (r.inputPath != null && String(r.inputPath).trim()) {
    const inp = validateRunnerPath(r.inputPath, 'inputPath');
    if (!inp.ok) return { ok: false, error: inp.error };
    inputPath = inp.path;
  }

  // ── jobParams (render_job): sanitize each; enforce required keys ───────────
  const jobParams: Record<string, string> = {};
  if (engine.mode === 'render_job') {
    const rawJP = r.jobParams && typeof r.jobParams === 'object' ? (r.jobParams as Record<string, unknown>) : {};
    for (const [key, value] of Object.entries(rawJP)) {
      if (!JOB_PARAM_KEY_RE.test(key)) {
        notes.push(`Dropped job param with unsafe key: ${String(key).slice(0, 32)}`);
        continue;
      }
      const safe = sanitizeJobValue(value);
      if (safe === null) {
        notes.push(`Dropped job param ${key} (value not a safe int/token)`);
        continue;
      }
      jobParams[key] = safe;
    }
    for (const need of engine.requiredJobParams ?? []) {
      if (!(need in jobParams)) {
        return { ok: false, error: `${engine.label} requires job param "${need}"` };
      }
    }
  }

  // ── extraArgs (strict per-engine allowlist; fail-closed) ───────────────────
  const cleanExtras: string[] = [];
  for (const raw of Array.isArray(r.extraArgs) ? r.extraArgs : []) {
    const arg = typeof raw === 'string' ? raw : String(raw ?? '');
    if (engine.isAllowedExtraArg(arg)) cleanExtras.push(arg);
    else notes.push(`Dropped disallowed extra arg for ${engine.label}: ${arg.slice(0, 40)}`);
  }

  const timeoutMs = clampInt(r.timeoutMs, engine.defaultTimeoutMs, 5_000, engine.maxTimeoutMs);

  // buildArgs consumes only validated inputs. Belt+suspenders: every produced
  // token must be a string with NO control char (newline is a control char, so
  // this also enforces the single-line inline-program guarantee).
  const args = engine.buildArgs({
    sourcePath,
    outputPath: outputPath ?? '',
    inputPath: inputPath ?? undefined,
    programText,
    jobParams,
    extraArgs: cleanExtras,
  });
  for (const token of args) {
    if (typeof token !== 'string') return { ok: false, error: 'engine produced a non-string arg token' };
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f]/.test(token)) return { ok: false, error: 'engine produced an arg with a control character' };
  }

  return {
    ok: true,
    plan: {
      engine: engine.id,
      mode: engine.mode,
      args,
      timeoutMs,
      sourcePath,
      outputPath,
      inputPath,
      jobParams,
      notes,
    },
  };
}

// ── Run spec for the bridge ──────────────────────────────────────────────────

export interface AppScriptRunSpec {
  engine: AppScriptEngine;
  mode: AppScriptRunMode;
  args: string[];
  timeoutMs: number;
  expectedOutputPath: string | null;
  /** Whether the invocation contract is bridge-verified (gates live wiring). */
  verifiedInvocation: boolean;
}

/** Build the bridge run spec from a validated plan (or null on invalid input). */
export function buildAppScriptRunSpec(req: unknown): AppScriptRunSpec | null {
  const v = validateAppScriptRunRequest(req);
  if (!v.ok) return null;
  const engine = APP_SCRIPT_ENGINE_REGISTRY[v.plan.engine];
  return {
    engine: v.plan.engine,
    mode: v.plan.mode,
    args: v.plan.args,
    timeoutMs: v.plan.timeoutMs,
    expectedOutputPath: v.plan.outputPath,
    verifiedInvocation: engine.verifiedInvocation,
  };
}

/** One-line description for an approval preview / notice. Never throws. */
export function describeAppScriptRun(req: unknown): string {
  const r = (req && typeof req === 'object' ? req : {}) as Record<string, unknown>;
  const engine = isAppScriptEngine(r.engine) ? APP_SCRIPT_ENGINE_REGISTRY[r.engine] : null;
  if (!engine) return 'Run a headless app script';
  const out = typeof r.outputPath === 'string' && r.outputPath.trim() ? ` → ${extensionOf(r.outputPath).toUpperCase() || 'output'}` : '';
  return `Run a ${engine.label} script${out} (approval-gated local execution)`;
}
