/**
 * davinciResolveScriptAdapter — PURE planning + validation layer that turns a
 * bounded DaVinci Resolve operation into a validated **DaVinciResolveScript
 * Python program** (plan P5). It is the code-generation counterpart to
 * `cadCodeExecutor.ts` (OpenSCAD/FreeCAD/Blender) and `appScriptRunner.ts`,
 * applied to Resolve's official external scripting API.
 *
 * // VERIFY the DaVinciResolveScript API calls + headless/script run mode on a
 * // real Resolve install before wiring. The API entry points below
 * // (Resolve -> ProjectManager -> Project -> MediaPool/MediaStorage ->
 * // RenderJob) come from the documented/community API shape (README.txt in
 * // the Scripting/ folder + deric.github.io API docs) and were NOT freshly
 * // run against a live Resolve Studio here. Every builder carries
 * // `verifiedInvocation: false` and this module is a PURE GENERATOR ONLY —
 * // it is deliberately NOT wired into appScriptRunner / openswanToolRuntime /
 * // the bridge. A live run + a `desktop.resolve_*` bridge family must confirm
 * // the exact method names, the fixed fusionscript module path, and the
 * // Studio/scripting-enabled/app-running preconditions before execution.
 *
 * Operations (all documented, none freshly verified):
 *   - 'render_project'  → load a render preset, set the target directory +
 *                         filename on the current timeline, add ONE render job
 *                         to the queue, start rendering, and poll job status.
 *   - 'import_media'    → add on-disk media files to the current project's
 *                         media pool (MediaStorage.AddItemListToMediaPool).
 *   - 'export_timeline' → export the current timeline to an interchange file
 *                         (AAF / EDL / FCPXML / OTIO) via Timeline.Export.
 *
 * PURITY: zero runtime imports (no react-native / supabase / node), so
 * `npx tsx scripts/davinci-resolve-script-adapter-smoketest.ts` loads it
 * directly. It shapes + validates + emits script TEXT only; it never touches
 * the filesystem, spawns Python, or connects to Resolve.
 *
 * LOAD-BEARING SECURITY BAR (mirrors cadCodeExecutor exactly):
 *   - Every user value — target dir, media file paths → path-validated
 *     (`validateResolvePath`, a clone of `validateCadPath`: length bound,
 *     control-char reject, shell-metachar reject, BMP-only, no `..` traversal).
 *   - Filenames, render-preset names, timeline names → a LABEL allowlist
 *     (`validateResolveLabel`: bounded, no control chars, no path separators,
 *     no shell metachars, BMP-only) — these are display/identifier tokens, not
 *     paths.
 *   - Every validated value is embedded ONLY as an escaped Python string
 *     literal (`pythonStringLiteral`, identical technique to cadCodeExecutor —
 *     JSON.stringify then every non-ASCII char → \uXXXX so the script is pure
 *     ASCII). Values are NEVER raw-concatenated into script text.
 *   - Invalid input is dropped-with-note or fails closed (degenerate input
 *     NEVER throws) — it is never silently mangled into the program.
 *
 * APPROVAL / EVIDENCE (see docs/apps/davinci-resolve.md): render + export both
 * WRITE FILES and consume machine time, so the calling runtime must gate them
 * behind approval and prove the output with an `os.stat`-style file check.
 * These scripts print machine-parseable `UC_RESOLVE_*` sentinel lines so the
 * caller can verify job status / output existence rather than trusting a
 * silent exit. Free-edition / scripting-disabled / app-not-running are honest
 * named blockers the generated script surfaces (never a silent success).
 */

// ── Operation set ─────────────────────────────────────────────────────────

export type DavinciResolveOperation = 'render_project' | 'import_media' | 'export_timeline';

export const DAVINCI_RESOLVE_OPERATIONS: readonly DavinciResolveOperation[] = [
  'render_project',
  'import_media',
  'export_timeline',
] as const;

/** Sentinels the generated scripts print for the caller to parse (bounded). */
export const DAVINCI_RESOLVE_DONE_SENTINEL = 'UC_RESOLVE_DONE:';
export const DAVINCI_RESOLVE_ERROR_SENTINEL = 'UC_RESOLVE_ERROR:';
export const DAVINCI_RESOLVE_JSON_SENTINEL = 'UC_RESOLVE_JSON:';

/**
 * Timeline interchange export formats. `format`/`subtype` map to the
 * documented `Timeline.Export(fileName, exportType, exportSubtype)` enum
 * NAMES on the `resolve` object (e.g. `resolve.EXPORT_AAF`). The generated
 * script resolves the enum by attribute name at runtime (getattr on the
 * Resolve object) rather than hard-coding an integer, because the numeric
 * values are version-specific. // VERIFY the exact enum attribute names.
 */
export type DavinciTimelineExportFormat = 'aaf' | 'edl' | 'fcpxml' | 'otio';

interface TimelineExportContract {
  /** Resolve enum attribute for exportType, resolved via getattr at runtime. */
  exportTypeAttr: string;
  /** Optional exportSubtype enum attribute (AAF wants a subtype). */
  exportSubtypeAttr: string | null;
  /** File extension the export writes (lowercase, no dot). */
  extension: string;
}

// // VERIFY: enum attribute names + which formats require a subtype.
const TIMELINE_EXPORT_CONTRACTS: Record<DavinciTimelineExportFormat, TimelineExportContract> = {
  // AAF is documented to want a subtype (embedded-media vs new/linked).
  aaf: { exportTypeAttr: 'EXPORT_AAF', exportSubtypeAttr: 'EXPORT_AAF_NEW', extension: 'aaf' },
  edl: { exportTypeAttr: 'EXPORT_EDL', exportSubtypeAttr: null, extension: 'edl' },
  fcpxml: { exportTypeAttr: 'EXPORT_FCPXML_1_10', exportSubtypeAttr: null, extension: 'fcpxml' },
  otio: { exportTypeAttr: 'EXPORT_OTIO', exportSubtypeAttr: null, extension: 'otio' },
};

export const DAVINCI_TIMELINE_EXPORT_FORMATS: readonly DavinciTimelineExportFormat[] = [
  'aaf',
  'edl',
  'fcpxml',
  'otio',
] as const;

/** Media container extensions Resolve's media pool ingests (bounded allowlist). */
export const DAVINCI_MEDIA_EXTENSIONS: readonly string[] = [
  // video
  'mov', 'mp4', 'mxf', 'avi', 'mkv', 'r3d', 'braw', 'dng', 'm4v',
  // image sequences / stills
  'exr', 'dpx', 'png', 'jpg', 'jpeg', 'tif', 'tiff',
  // audio
  'wav', 'aif', 'aiff', 'mp3', 'aac',
];

const MAX_MEDIA_FILES = 200;

// ── Path validation (pure clone of cadCodeExecutor.validateCadPath) ─────────
// Rejects: non-string, empty, >1024 chars, control chars, shell metachars,
// non-BMP code points (cannot be encoded in the ASCII Python literal), and
// `..` traversal segments. A path that passes here can be embedded via
// pythonStringLiteral with no residual escape hazard.
export function validateResolvePath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: 'path must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'path is empty' };
  if (trimmed.length > 1024) return { ok: false, error: 'path exceeds 1024 chars' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: 'path contains control characters' };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: 'path contains shell metacharacter' };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: 'path contains characters outside the basic multilingual plane (cannot be embedded safely in a generated Python literal)' };
    }
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) return { ok: false, error: 'path must not contain ".." traversal' };
  return { ok: true, path: trimmed };
}

// ── Label validation (identifier/display tokens, NOT paths) ─────────────────
// Filenames, render-preset names, timeline names are labels: bounded, no
// control chars, no path separators (a label must not smuggle a directory
// change), no shell metachars, BMP-only. Kept as its own allowlist so a
// "filename" can never carry a slash into a path join.
const MAX_LABEL_LENGTH = 200;

export function validateResolveLabel(
  raw: unknown,
  label: string,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be a string` };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: `${label} is empty` };
  if (trimmed.length > MAX_LABEL_LENGTH) return { ok: false, error: `${label} exceeds ${MAX_LABEL_LENGTH} chars` };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: `${label} contains control characters` };
  if (/[/\\]/.test(trimmed)) return { ok: false, error: `${label} must not contain a path separator` };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: `${label} contains a shell metacharacter` };
  for (const ch of trimmed) {
    if ((ch.codePointAt(0) ?? 0) > 0xffff) {
      return { ok: false, error: `${label} contains characters outside the basic multilingual plane` };
    }
  }
  return { ok: true, value: trimmed };
}

/**
 * Emit a value as a Python 3 string literal. Identical technique to
 * `cadCodeExecutor.pythonStringLiteral`: JSON.stringify produces a
 * double-quoted, backslash/quote/control-escaped literal; we additionally
 * escape every non-ASCII char to \uXXXX so the emitted script is pure ASCII.
 * `validateResolvePath`/`validateResolveLabel` reject non-BMP code points, so
 * lone-surrogate escapes never reach Python. Values are NEVER concatenated raw.
 */
function pythonStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

// ── Args validation ─────────────────────────────────────────────────────────

export interface DavinciRenderProjectArgs {
  /** Render preset name to load (label allowlist). */
  renderPreset: string;
  /** Directory the render should write into (path-validated). */
  targetDir: string;
  /** Output filename / custom-name token (label allowlist — no separators). */
  customName: string;
}

export interface DavinciImportMediaArgs {
  /** On-disk media files to add to the media pool (each path-validated). */
  mediaPaths: string[];
}

export interface DavinciExportTimelineArgs {
  /** Interchange format. */
  format: DavinciTimelineExportFormat;
  /** Directory the export should write into (path-validated). */
  targetDir: string;
  /** Export filename token (label allowlist — extension appended by builder). */
  customName: string;
  /** Optional exact timeline name to select before export (label allowlist). */
  timelineName?: string;
}

export type DavinciResolveArgs =
  | ({ operation: 'render_project' } & DavinciRenderProjectArgs)
  | ({ operation: 'import_media' } & DavinciImportMediaArgs)
  | ({ operation: 'export_timeline' } & DavinciExportTimelineArgs);

export interface DavinciResolveValidated {
  operation: DavinciResolveOperation;
  /** Normalized, safe-to-embed values (already validated). */
  values: Record<string, unknown>;
  notes: string[];
}

export type DavinciResolveValidation =
  | { ok: true; validated: DavinciResolveValidated }
  | { ok: false; error: string; notes: string[] };

export function isDavinciResolveOperation(value: unknown): value is DavinciResolveOperation {
  return typeof value === 'string' && (DAVINCI_RESOLVE_OPERATIONS as readonly string[]).includes(value);
}

function isTimelineExportFormat(value: unknown): value is DavinciTimelineExportFormat {
  return typeof value === 'string' && (DAVINCI_TIMELINE_EXPORT_FORMATS as readonly string[]).includes(value);
}

/**
 * Validate a bounded operation's arguments into safe, normalized values (or a
 * typed error). Engine-of-record for the security bar: every user value is
 * routed through the path or label allowlist here, so `buildDavinciResolveScript`
 * only ever embeds already-validated strings. Never throws on garbage input.
 */
export function validateDavinciResolveArgs(input: unknown): DavinciResolveValidation {
  const notes: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'arguments must be an object', notes };
  }
  const r = input as Record<string, unknown>;
  const operation = r.operation;
  if (!isDavinciResolveOperation(operation)) {
    return { ok: false, error: `operation must be one of ${DAVINCI_RESOLVE_OPERATIONS.join(', ')}`, notes };
  }

  if (operation === 'render_project') {
    const preset = validateResolveLabel(r.renderPreset, 'renderPreset');
    if (!preset.ok) return { ok: false, error: preset.error, notes };
    const dir = validateResolvePath(r.targetDir);
    if (!dir.ok) return { ok: false, error: `targetDir: ${dir.error}`, notes };
    const name = validateResolveLabel(r.customName, 'customName');
    if (!name.ok) return { ok: false, error: name.error, notes };
    return {
      ok: true,
      validated: {
        operation,
        values: {
          renderPreset: preset.value,
          targetDir: dir.path.replace(/\/+$/, ''),
          customName: name.value,
        },
        notes,
      },
    };
  }

  if (operation === 'import_media') {
    const rawList = Array.isArray(r.mediaPaths) ? r.mediaPaths : [];
    if (rawList.length === 0) {
      return { ok: false, error: 'mediaPaths must be a non-empty array of file paths', notes };
    }
    const accepted: string[] = [];
    let considered = 0;
    for (const raw of rawList) {
      if (accepted.length >= MAX_MEDIA_FILES) {
        notes.push(`Truncated media list to the first ${MAX_MEDIA_FILES} valid files.`);
        break;
      }
      considered += 1;
      const p = validateResolvePath(raw);
      if (!p.ok) {
        notes.push(`Dropped media path #${considered}: ${p.error}.`);
        continue;
      }
      const ext = extensionOf(p.path);
      if (!DAVINCI_MEDIA_EXTENSIONS.includes(ext)) {
        notes.push(`Dropped media path #${considered}: extension ".${ext || '?'}" is not an ingestable media type.`);
        continue;
      }
      accepted.push(p.path);
    }
    if (accepted.length === 0) {
      return { ok: false, error: 'no valid media paths after validation (all dropped)', notes };
    }
    return { ok: true, validated: { operation, values: { mediaPaths: accepted }, notes } };
  }

  // operation === 'export_timeline'
  if (!isTimelineExportFormat(r.format)) {
    return { ok: false, error: `format must be one of ${DAVINCI_TIMELINE_EXPORT_FORMATS.join(', ')}`, notes };
  }
  const dir = validateResolvePath(r.targetDir);
  if (!dir.ok) return { ok: false, error: `targetDir: ${dir.error}`, notes };
  const name = validateResolveLabel(r.customName, 'customName');
  if (!name.ok) return { ok: false, error: name.error, notes };
  const values: Record<string, unknown> = {
    format: r.format,
    targetDir: dir.path.replace(/\/+$/, ''),
    customName: name.value,
    timelineName: null,
  };
  if (r.timelineName != null && String(r.timelineName).trim()) {
    const tl = validateResolveLabel(r.timelineName, 'timelineName');
    if (!tl.ok) return { ok: false, error: tl.error, notes };
    values.timelineName = tl.value;
  }
  return { ok: true, validated: { operation, values, notes } };
}

// ── Script generation ─────────────────────────────────────────────────────

export type DavinciResolveScriptBuild =
  | {
      ok: true;
      operation: DavinciResolveOperation;
      python: string;
      suggestedScriptFileName: string;
      /** false until a live Resolve run confirms the API — gates wiring. */
      verifiedInvocation: false;
      /** Whether this op writes files (→ approval + output stat proof). */
      writesFiles: boolean;
      notes: string[];
    }
  | { ok: false; error: string; notes: string[] };

/**
 * Shared preamble: locate the DaVinciResolveScript module, connect to the
 * RUNNING local Resolve, and fail CLOSED with a named blocker when Resolve is
 * not reachable (free edition refuses the connection, scripting disabled, or
 * the app is not running). No user values here — pure boilerplate.
 *
 * // VERIFY: the fixed module path + `GetResolve()` bootstrap. The documented
 * // path is
 * //   /Library/Application Support/Blackmagic Design/DaVinci Resolve/
 * //     Developer/Scripting/Modules
 * // (or the RESOLVE_SCRIPT_API env). The community `python_get_resolve`
 * // helper imports `DaVinciResolveScript` then calls `.scriptapp("Resolve")`.
 */
function resolveConnectPreamble(): string[] {
  return [
    'import os',
    'import sys',
    '',
    '# --- Locate the DaVinciResolveScript module (fixed install path; never a',
    '#     PATH search). // VERIFY this path + the module name on a real Studio',
    '#     install before wiring. ---',
    'def _uc_import_resolve_module():',
    '    try:',
    '        import DaVinciResolveScript as _dvr  # env already on sys.path',
    '        return _dvr',
    '    except ImportError:',
    '        pass',
    '    candidates = []',
    '    api_env = os.environ.get("RESOLVE_SCRIPT_API")',
    '    if api_env:',
    '        candidates.append(os.path.join(api_env, "Modules"))',
    '    candidates.append("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules")',
    '    for module_dir in candidates:',
    '        if os.path.isdir(module_dir) and module_dir not in sys.path:',
    '            sys.path.append(module_dir)',
    '    try:',
    '        import DaVinciResolveScript as _dvr',
    '        return _dvr',
    '    except ImportError:',
    '        return None',
    '',
    'dvr = _uc_import_resolve_module()',
    'if dvr is None:',
    `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'scripting_module_not_found (DaVinciResolveScript unavailable -- Studio + scripting enabled required)')})`,
    'resolve = dvr.scriptapp("Resolve")',
    'if resolve is None:',
    `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'resolve_not_running (no local DaVinci Resolve instance accepted the connection; free edition or scripting disabled)')})`,
    'project_manager = resolve.GetProjectManager()',
    'project = project_manager.GetCurrentProject() if project_manager is not None else None',
    'if project is None:',
    `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'no_current_project (open a project in Resolve before running this script)')})`,
  ];
}

/**
 * Generate the DaVinciResolveScript Python program for one bounded operation.
 * All user values are validated + embedded as escaped literals (never raw).
 * Returns a typed error (never throws) on invalid input.
 */
export function buildDavinciResolveScript(
  operation: DavinciResolveOperation,
  input: unknown,
): DavinciResolveScriptBuild {
  if (!isDavinciResolveOperation(operation)) {
    return { ok: false, error: `operation must be one of ${DAVINCI_RESOLVE_OPERATIONS.join(', ')}`, notes: [] };
  }
  const merged =
    input && typeof input === 'object' ? { ...(input as Record<string, unknown>), operation } : { operation };
  const validation = validateDavinciResolveArgs(merged);
  if (!validation.ok) return { ok: false, error: validation.error, notes: validation.notes };
  const { values, notes } = validation.validated;

  const header = [
    '# Generated by Underground Circle davinciResolveScriptAdapter.',
    '# VERIFY the DaVinciResolveScript API calls + headless/script run mode on a',
    '# real DaVinci Resolve Studio install before wiring. This is a documented-',
    '# shape generator only; it has NOT been run against a live Resolve.',
    '# All user values are embedded as escaped string literals (never raw).',
    'import json',
  ];

  if (operation === 'render_project') {
    const presetLiteral = pythonStringLiteral(String(values.renderPreset));
    const dirLiteral = pythonStringLiteral(String(values.targetDir));
    const nameLiteral = pythonStringLiteral(String(values.customName));
    const python = [
      ...header,
      ...resolveConnectPreamble(),
      '',
      `RENDER_PRESET = ${presetLiteral}`,
      `TARGET_DIR = ${dirLiteral}`,
      `CUSTOM_NAME = ${nameLiteral}`,
      '',
      'timeline = project.GetCurrentTimeline()',
      'if timeline is None:',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'no_current_timeline (open a timeline to render)')})`,
      '',
      '# Load the named render preset (must already exist in the project).',
      'if not project.LoadRenderPreset(RENDER_PRESET):',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'render_preset_not_found: ')} + RENDER_PRESET)`,
      '',
      '# Point the render at the approved directory + filename.',
      'if not project.SetRenderSettings({"TargetDir": TARGET_DIR, "CustomName": CUSTOM_NAME}):',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'set_render_settings_failed (target dir/filename rejected)')})`,
      '',
      '# Add exactly ONE render job for the current timeline, then start it.',
      'job_id = project.AddRenderJob()',
      'if not job_id:',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'add_render_job_failed')})`,
      'if not project.StartRendering(job_id):',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'start_rendering_failed')})`,
      '',
      '# Poll the render queue until this job leaves the rendering state.',
      'import time',
      'status = {}',
      'for _ in range(86400):  # bounded ~24h at 1s cadence; loop exits on completion',
      '    if not project.IsRenderingInProgress():',
      '        break',
      '    time.sleep(1)',
      'try:',
      '    status = project.GetRenderJobStatus(job_id) or {}',
      'except Exception:',
      '    status = {}',
      'job_state = str(status.get("JobStatus", "Unknown"))',
      'summary = {',
      '    "jobId": str(job_id),',
      '    "jobStatus": job_state,',
      '    "completionPercentage": status.get("CompletionPercentage"),',
      '    "targetDir": TARGET_DIR,',
      '    "customName": CUSTOM_NAME,',
      '}',
      `print(${pythonStringLiteral(DAVINCI_RESOLVE_JSON_SENTINEL)} + json.dumps(summary)[:2000])`,
      'if job_state.lower() != "complete":',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'render_not_complete: ')} + job_state)`,
      `print(${pythonStringLiteral(DAVINCI_RESOLVE_DONE_SENTINEL + 'render complete -> ')} + os.path.join(TARGET_DIR, CUSTOM_NAME))`,
      '',
    ].join('\n');
    return {
      ok: true,
      operation,
      python,
      suggestedScriptFileName: 'uc-resolve-render.py',
      verifiedInvocation: false,
      writesFiles: true,
      notes: [
        ...notes,
        'Rendering WRITES A LARGE FILE and consumes machine time — gate behind approval and echo project/timeline + preset + output folder in the approval text.',
        `Proof: parse the ${DAVINCI_RESOLVE_JSON_SENTINEL} line for JobStatus, then desktop.file_stat the render output (TargetDir/CustomName + the preset's extension).`,
        'The render preset already fixes codec/container/extension; the adapter does not set them (avoids overriding an approved preset).',
      ],
    };
  }

  if (operation === 'import_media') {
    const paths = (values.mediaPaths as string[]) || [];
    const listLiteral = `[${paths.map((p) => pythonStringLiteral(p)).join(', ')}]`;
    const python = [
      ...header,
      ...resolveConnectPreamble(),
      '',
      `MEDIA_PATHS = ${listLiteral}`,
      '',
      'media_pool = project.GetMediaPool()',
      'media_storage = resolve.GetMediaStorage()',
      'if media_pool is None or media_storage is None:',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'media_pool_unavailable')})`,
      '',
      '# Only import files that actually exist on disk (honest inventory).',
      'existing = [p for p in MEDIA_PATHS if os.path.isfile(p)]',
      'missing = [os.path.basename(p) for p in MEDIA_PATHS if not os.path.isfile(p)]',
      'if not existing:',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'no_media_files_found_on_disk')})`,
      '',
      '# AddItemListToMediaPool returns the MediaPoolItems it created.',
      'added_items = media_storage.AddItemListToMediaPool(existing) or []',
      'summary = {',
      '    "requested": len(MEDIA_PATHS),',
      '    "existingOnDisk": len(existing),',
      '    "added": len(added_items),',
      '    "missing": missing[:20],',
      '}',
      `print(${pythonStringLiteral(DAVINCI_RESOLVE_JSON_SENTINEL)} + json.dumps(summary)[:2000])`,
      'if not added_items:',
      `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'media_import_added_zero_items')})`,
      `print(${pythonStringLiteral(DAVINCI_RESOLVE_DONE_SENTINEL + 'imported ')} + str(len(added_items)) + " media item(s) into the media pool")`,
      '',
    ].join('\n');
    return {
      ok: true,
      operation,
      python,
      suggestedScriptFileName: 'uc-resolve-import-media.py',
      verifiedInvocation: false,
      writesFiles: false,
      notes: [
        ...notes,
        'Media import mutates the project (media pool) — gate behind approval and echo the current project identity first.',
        `Proof: parse the ${DAVINCI_RESOLVE_JSON_SENTINEL} line for added vs requested vs missing, then read back the media-pool clip count.`,
      ],
    };
  }

  // operation === 'export_timeline'
  const format = String(values.format) as DavinciTimelineExportFormat;
  const contract = TIMELINE_EXPORT_CONTRACTS[format];
  const dirLiteral = pythonStringLiteral(String(values.targetDir));
  const nameLiteral = pythonStringLiteral(String(values.customName));
  const fileName = `${values.customName}.${contract.extension}`;
  const typeAttrLiteral = pythonStringLiteral(contract.exportTypeAttr);
  const subtypeLine =
    contract.exportSubtypeAttr === null
      ? 'export_subtype = None'
      : `export_subtype = getattr(resolve, ${pythonStringLiteral(contract.exportSubtypeAttr)}, None)`;
  const selectTimelineLines =
    values.timelineName === null || values.timelineName === undefined
      ? [
          'timeline = project.GetCurrentTimeline()',
          'if timeline is None:',
          `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'no_current_timeline (open a timeline to export)')})`,
        ]
      : [
          `TIMELINE_NAME = ${pythonStringLiteral(String(values.timelineName))}`,
          'timeline = None',
          'for _idx in range(1, (project.GetTimelineCount() or 0) + 1):',
          '    candidate = project.GetTimelineByIndex(_idx)',
          '    if candidate is not None and str(candidate.GetName()) == TIMELINE_NAME:',
          '        timeline = candidate',
          '        break',
          'if timeline is None:',
          `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'timeline_not_found: ')} + TIMELINE_NAME)`,
          '# Make the matched timeline current so Export targets it.',
          'project.SetCurrentTimeline(timeline)',
        ];
  const python = [
    ...header,
    ...resolveConnectPreamble(),
    '',
    `TARGET_DIR = ${dirLiteral}`,
    `CUSTOM_NAME = ${nameLiteral}`,
    `OUTPUT_PATH = os.path.join(TARGET_DIR, ${pythonStringLiteral(fileName)})`,
    '',
    ...selectTimelineLines,
    '',
    '# Resolve export enum values are version-specific -- resolve by attribute',
    '# name on the Resolve object rather than hard-coding an integer.',
    `export_type = getattr(resolve, ${typeAttrLiteral}, None)`,
    'if export_type is None:',
    `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'export_type_unavailable: ')} + ${typeAttrLiteral})`,
    subtypeLine,
    '',
    'if export_subtype is None:',
    '    ok = timeline.Export(OUTPUT_PATH, export_type)',
    'else:',
    '    ok = timeline.Export(OUTPUT_PATH, export_type, export_subtype)',
    'if not ok:',
    `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'timeline_export_call_failed')})`,
    'if not os.path.isfile(OUTPUT_PATH):',
    `    raise SystemExit(${pythonStringLiteral(DAVINCI_RESOLVE_ERROR_SENTINEL + 'export_finished_without_creating_file')})`,
    'summary = {',
    `    "format": ${pythonStringLiteral(format)},`,
    '    "outputPath": OUTPUT_PATH,',
    '    "bytes": os.path.getsize(OUTPUT_PATH),',
    '}',
    `print(${pythonStringLiteral(DAVINCI_RESOLVE_JSON_SENTINEL)} + json.dumps(summary)[:2000])`,
    `print(${pythonStringLiteral(DAVINCI_RESOLVE_DONE_SENTINEL + 'exported timeline -> ')} + OUTPUT_PATH)`,
    '',
  ].join('\n');
  return {
    ok: true,
    operation,
    python,
    suggestedScriptFileName: 'uc-resolve-export-timeline.py',
    verifiedInvocation: false,
    writesFiles: true,
    notes: [
      ...notes,
      `Timeline export WRITES A FILE (${fileName}) — gate behind approval and echo the timeline identity being exported.`,
      `Proof: parse the ${DAVINCI_RESOLVE_JSON_SENTINEL} line for outputPath/bytes, then desktop.file_stat the ${contract.extension.toUpperCase()} output.`,
    ],
  };
}

// ── Human-readable operation describe (approval preview) ────────────────────

/**
 * One-line plain-language description of a bounded operation for an approval
 * preview / notice. Never throws; safe on garbage input.
 */
export function describeDavinciResolveOperation(operation: unknown, input?: unknown): string {
  if (!isDavinciResolveOperation(operation)) return 'Run a DaVinci Resolve script';
  const r = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (operation === 'render_project') {
    const preset = typeof r.renderPreset === 'string' && r.renderPreset.trim() ? ` with preset "${String(r.renderPreset).slice(0, 60)}"` : '';
    return `Render the current DaVinci Resolve timeline${preset} to the approved folder (writes a file; approval + output proof required)`;
  }
  if (operation === 'import_media') {
    const count = Array.isArray(r.mediaPaths) ? r.mediaPaths.length : 0;
    return `Import ${count} media file(s) into the DaVinci Resolve media pool (mutates the project; approval required)`;
  }
  // export_timeline
  const fmt = isTimelineExportFormat(r.format) ? String(r.format).toUpperCase() : 'interchange';
  return `Export the current DaVinci Resolve timeline as ${fmt} to the approved folder (writes a file; approval + output proof required)`;
}
