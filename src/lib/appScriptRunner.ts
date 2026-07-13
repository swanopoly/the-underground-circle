// appScriptRunner — the GENERALIZED headless-script substrate (plan P2).
//
// cadCodeExecutor.ts already ships a hardened, LOCKSTEP-with-the-bridge runner
// for OpenSCAD/FreeCAD/Blender: fixed binary paths, strict arg allowlists,
// execFile argv (no shell), timeout clamps, path validation. This module
// generalizes that SAME proven model to more headless apps (MATLAB, KiCad,
// AutoCAD core console, …) so adding an app N+1 becomes a new engine
// descriptor + a script generator — NOT a new bespoke endpoint. It is the pure
// contract behind a future `desktop.run_app_script` bridge tool.
//
// PURITY: zero imports, tsx-loadable (smoke: app-script-runner). It shapes and
// VALIDATES a run request into a safe argv the bridge will execute; it never
// touches the filesystem, spawns a process, or resolves a real binary — the
// bridge does that (LOCKSTEP), resolving the binary from FIXED install paths.
//
// SECURITY (mirrors cadCodeExecutor + claude-bridge.js validateDesktopPathServer,
// kept in LOCKSTEP): every path is length-bounded, control-char-free,
// shell-metacharacter-free, and BMP-only; extraArgs pass a strict per-engine
// allowlist (no metachars, bounded); timeouts clamp to the engine's window.
// The validation core below is engine-AGNOSTIC and is the tested value.
//
// INVOCATION VERIFICATION: each engine's `buildArgs` template encodes a
// real-world headless CLI contract, but the exact binary name / flag form was
// NOT freshly verified (the P69 research run's verification hit the account
// rate limit). Every engine carries `verifiedInvocation: false` and a
// `// VERIFY` note; the bridge LOCKSTEP + a live run must confirm each before
// `desktop.run_app_script` is wired for that engine. The validation/security
// logic is correct regardless of those specifics.

export type AppScriptEngine = 'matlab' | 'kicad_cli' | 'autocad_core';

export const APP_SCRIPT_ENGINES: readonly AppScriptEngine[] = ['matlab', 'kicad_cli', 'autocad_core'] as const;

export type AppScriptPlatform = 'mac' | 'windows' | 'cross';

export interface AppScriptEngineDescriptor {
  id: AppScriptEngine;
  label: string;
  platform: AppScriptPlatform;
  /** Allowed source-script extensions (lowercase, no dot). */
  sourceExtensions: readonly string[];
  /** Allowed produced-output extensions (lowercase, no dot). Empty = engine
   *  writes side-effect files the script chooses (still stat-verified). */
  outputExtensions: readonly string[];
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  /** Strict per-engine extraArg allowlist. Conservative by default (none). */
  isAllowedExtraArg: (arg: string) => boolean;
  /** Build the validated arg vector (AFTER the binary; the bridge prepends the
   *  fixed-path binary and runs execFile — no shell). Inputs are already
   *  path-validated. */
  buildArgs: (input: { sourcePath: string; outputPath: string; inputPath?: string; extraArgs: string[] }) => string[];
  /** false until a live bridge run confirms the invocation — see header. */
  verifiedInvocation: boolean;
}

// No extra args accepted for any seed engine yet (fail-closed; widen per engine
// with a strict regex allowlist when a real need appears, like OpenSCAD's).
const denyAllExtraArgs = (_arg: string): boolean => false;

export const APP_SCRIPT_ENGINE_REGISTRY: Record<AppScriptEngine, AppScriptEngineDescriptor> = {
  // MATLAB non-interactive: `matlab -batch "<statement>"` (documented since
  // R2019a; exits with the script's status, no desktop). We run the validated
  // .m file by name from its directory. // VERIFY: binary name (`matlab`) +
  // `-batch` form on the target install before wiring.
  matlab: {
    id: 'matlab',
    label: 'MATLAB (headless -batch)',
    platform: 'cross',
    sourceExtensions: ['m'],
    outputExtensions: [], // scripts write .mat/.csv/.png/etc. — stat-verified by the caller
    defaultTimeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    isAllowedExtraArg: denyAllExtraArgs,
    buildArgs: ({ sourcePath }) => ['-batch', `run('${sourcePath}')`],
    verifiedInvocation: false,
  },
  // KiCad 7+ modern headless CLI.
  // // VERIFY — CONFIRMED WRONG (2026-07-13): there is NO bare `export` verb.
  // Every export needs `<domain> export <fmt>` with the INPUT as the LAST
  // positional arg, e.g. `pcb export gerbers --output <dir> <board.kicad_pcb>`,
  // `pcb export step --output <file.step> <board>`, `sch export pdf --output
  // <file.pdf> <sch>`. gerbers/drill --output is a DIRECTORY; step/pdf/svg a FILE.
  // This flat buildArgs cannot serve all kinds — needs a per-export-kind branch
  // (tied to the P2 `mode` work). Source: docs.kicad.org CLI 8.0/9.0.
  kicad_cli: {
    id: 'kicad_cli',
    label: 'KiCad (kicad-cli export)',
    platform: 'cross',
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
  // // VERIFY: accoreconsole path + /i//s flags on the target install.
  autocad_core: {
    id: 'autocad_core',
    label: 'AutoCAD (accoreconsole /s script)',
    platform: 'windows',
    sourceExtensions: ['scr'],
    outputExtensions: [], // the script chooses what it writes (DXF/PDF/…)
    defaultTimeoutMs: 120_000,
    maxTimeoutMs: 600_000,
    isAllowedExtraArg: denyAllExtraArgs,
    buildArgs: ({ sourcePath, inputPath }) =>
      inputPath ? ['/i', inputPath, '/s', sourcePath] : ['/s', sourcePath],
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
  /** The generated script file the bridge already wrote (validated path). */
  sourcePath: string;
  /** Where the run should produce its primary output (stat-verified after). */
  outputPath?: string;
  /** Optional input document (e.g. AutoCAD drawing for a .scr). */
  inputPath?: string;
  extraArgs?: string[];
  timeoutMs?: number;
}

export interface AppScriptRunPlan {
  engine: AppScriptEngine;
  /** Validated arg vector AFTER the binary (bridge prepends the fixed-path binary). */
  args: string[];
  timeoutMs: number;
  sourcePath: string;
  outputPath: string | null;
  inputPath: string | null;
  /** Non-fatal notes (e.g. dropped extra args). */
  notes: string[];
}

export type AppScriptRunValidation =
  | { ok: true; plan: AppScriptRunPlan }
  | { ok: false; error: string };

/**
 * Validate a run request into a safe `AppScriptRunPlan` (or a typed error).
 * Engine-agnostic security core: engine gate, path safety, source/output
 * extension allowlists, strict extraArg allowlist, timeout clamp. Never throws.
 */
export function validateAppScriptRunRequest(req: unknown): AppScriptRunValidation {
  if (!req || typeof req !== 'object') return { ok: false, error: 'run request must be an object' };
  const r = req as Record<string, unknown>;

  if (!isAppScriptEngine(r.engine)) {
    return { ok: false, error: `engine must be one of ${APP_SCRIPT_ENGINES.join(', ')}` };
  }
  const engine = APP_SCRIPT_ENGINE_REGISTRY[r.engine];

  const src = validateRunnerPath(r.sourcePath, 'sourcePath');
  if (!src.ok) return { ok: false, error: src.error };
  const srcExt = extensionOf(src.path);
  if (!engine.sourceExtensions.includes(srcExt)) {
    return { ok: false, error: `${engine.label} source must be one of .${engine.sourceExtensions.join(', .')} (got .${srcExt || '?'})` };
  }

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

  let inputPath: string | null = null;
  if (r.inputPath != null && String(r.inputPath).trim()) {
    const inp = validateRunnerPath(r.inputPath, 'inputPath');
    if (!inp.ok) return { ok: false, error: inp.error };
    inputPath = inp.path;
  }

  const notes: string[] = [];
  const cleanExtras: string[] = [];
  for (const raw of Array.isArray(r.extraArgs) ? r.extraArgs : []) {
    const arg = typeof raw === 'string' ? raw : String(raw ?? '');
    if (engine.isAllowedExtraArg(arg)) cleanExtras.push(arg);
    else notes.push(`Dropped disallowed extra arg for ${engine.label}: ${arg.slice(0, 40)}`);
  }

  const timeoutMs = clampInt(r.timeoutMs, engine.defaultTimeoutMs, 5_000, engine.maxTimeoutMs);

  // buildArgs consumes only validated inputs. It must not introduce a token
  // that fails the metachar reject — belt+suspenders re-check below.
  const args = engine.buildArgs({ sourcePath: src.path, outputPath: outputPath ?? '', inputPath: inputPath ?? undefined, extraArgs: cleanExtras });
  for (const token of args) {
    if (typeof token !== 'string') return { ok: false, error: 'engine produced a non-string arg token' };
    // The path tokens already passed validation; a template-literal token
    // (e.g. MATLAB `run('…')`) may legitimately contain quotes/parens but must
    // never contain a raw control char or newline.
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\n]/.test(token)) return { ok: false, error: 'engine produced an arg with a control character' };
  }

  return {
    ok: true,
    plan: { engine: engine.id, args, timeoutMs, sourcePath: src.path, outputPath, inputPath, notes },
  };
}

// ── Run spec for the bridge ──────────────────────────────────────────────────

export interface AppScriptRunSpec {
  engine: AppScriptEngine;
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
