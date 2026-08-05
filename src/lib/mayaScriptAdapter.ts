// mayaScriptAdapter — PURE generator that turns a bounded op request into a
// validated Autodesk Maya Python script (maya.standalone + maya.cmds) to run
// HEADLESSLY via `mayapy <script.py>` (or `maya -batch -script <script.py>`).
//
// VERIFY mayapy invocation + maya.cmds export/render calls + required plugin
// loads (fbxmaya / AbcExport) on a real Maya install before wiring. Unlike
// Fusion (no headless mode), Maya IS genuinely headless: the bundled
// interpreter `/Applications/Autodesk/maya<version>/Maya.app/Contents/bin/
// mayapy` runs full `maya.cmds` with NO GUI once `maya.standalone.initialize()`
// has been called (docs/apps/maya.md control surface #1). The exact
// `maya.cmds` flag forms below follow the documented API shapes but were NOT
// freshly verified against a live install — every generated script carries a
// `# VERIFY` banner and every descriptor field is conservative. This module is
// the PURE generator only: it is NOT wired to any tool or bridge, never touches
// the filesystem, never spawns mayapy, and never resolves a binary. Maya is
// NOT in the appScriptRunner engine registry — see the descriptor reported in
// the task summary for the shape a future wiring commit would add.
//
// PURITY: zero runtime imports (`import type` only, and none are needed), so
// `npx tsx scripts/maya-script-adapter-smoketest.ts` loads it directly.
//
// SECURITY (mirrors src/lib/cadCodeExecutor.ts exactly): every user value —
// input scene path, output path, export/render format, frame number — is
// allowlist-validated FIRST, then embedded into the generated Python ONLY as an
// escaped string literal via `pythonStringLiteral` (JSON.stringify + non-ASCII
// → \uXXXX; Maya standalone Python is CPython so this applies directly) or, for
// the frame number, as an already-bounded integer emitted verbatim from a
// re-stringified `Number`. User input is NEVER raw-concatenated into script
// text. Paths pass a validateCadPath-style check (length / control-char /
// shell-metachar / BMP / traversal). Formats pass an enum allowlist; the frame
// is a bounded integer. On any validation failure the builder DROPS the request
// with an explanatory note and a fail-closed script stub — it never throws and
// never emits a half-validated mutation.
//
// APPROVAL/PROOF (docs/apps/maya.md approval rules): exports and renders WRITE
// files, so the wiring layer must approval-gate them and verify each output
// with desktop.file_stat (+ one frame/mesh proof) after the run. Scripts NEVER
// save over the source scene. Scenes can carry scriptJobs/scriptNodes, so the
// generated open call disables script-node evaluation by default (prompt off +
// ignoreVersion) and the notes say so — opening an untrusted scene is a
// code-execution risk that the approval text must surface.

// ── Operations ─────────────────────────────────────────────────────────────

export type MayaOperation = 'export_scene' | 'playblast_or_render_frame' | 'convert_format';

export const MAYA_OPERATIONS: readonly MayaOperation[] = [
  'export_scene',
  'playblast_or_render_frame',
  'convert_format',
] as const;

/** Geometry/scene export formats maya.cmds can write headlessly (plugin-gated). */
export type MayaExportFormat = 'fbx' | 'obj' | 'usd' | 'abc';

export const MAYA_EXPORT_FORMATS: readonly MayaExportFormat[] = ['fbx', 'obj', 'usd', 'abc'] as const;

/** File extension produced per export format. USD keeps .usd (ascii/crate both
 *  use the .usd container here; .usda/.usdc are deliberately out of scope). */
const MAYA_EXPORT_EXTENSION: Record<MayaExportFormat, string> = {
  fbx: 'fbx',
  obj: 'obj',
  usd: 'usd',
  abc: 'abc',
};

/** Maya scene container formats (the ONLY formats convert_format moves between). */
export type MayaSceneFormat = 'ma' | 'mb';

export const MAYA_SCENE_FORMATS: readonly MayaSceneFormat[] = ['ma', 'mb'] as const;

/** Maya scene `-type` flag string per container extension (mayaAscii/mayaBinary). */
const MAYA_SCENE_FILE_TYPE: Record<MayaSceneFormat, string> = {
  ma: 'mayaAscii',
  mb: 'mayaBinary',
};

/** Single-frame render image formats (the render output extension allowlist). */
export type MayaImageFormat = 'png' | 'jpg' | 'tif' | 'exr';

export const MAYA_IMAGE_FORMATS: readonly MayaImageFormat[] = ['png', 'jpg', 'tif', 'exr'] as const;

export const MAYA_SCRIPT_EXTENSION = 'py' as const;

/** Scene files the open lane accepts (both Maya containers). */
const MAYA_SCENE_INPUT_EXTENSIONS: readonly string[] = ['ma', 'mb'];

// Frame bounds: a non-negative integer within a generous production range.
// A single-frame render targets one frame; the bound keeps the emitted integer
// literal small and finite (no exponent, no Infinity, no absurd timeline value).
export const MAYA_FRAME_MIN = 0;
export const MAYA_FRAME_MAX = 1_000_000;

// ── Path validation (pure mirror of cadCodeExecutor.validateCadPath) ──────────
// LOCKSTEP intent: byte-identical reject-set to cadCodeExecutor.validateCadPath
// / appScriptRunner.validateRunnerPath / the bridge's validateDesktopPathServer,
// PLUS the ".." traversal reject (appScriptRunner already adds this). A path
// that passes here must not fail a downstream validator for a different reason.
// Non-BMP code points are rejected because paths are embedded in generated
// Python string literals via \uXXXX escapes (lone surrogates are not encodable).
function validateMayaPath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
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
 * Emit a value as a Python 3 string literal. IDENTICAL technique to
 * cadCodeExecutor.pythonStringLiteral: JSON.stringify (double-quoted,
 * backslash/quote/control escaped) then escape every non-ASCII char to \uXXXX
 * so the generated script is pure ASCII. Maya standalone Python is CPython, so
 * a JSON string literal is a valid Python string literal for BMP text.
 * `validateMayaPath` rejects non-BMP code points, so surrogate escapes never
 * reach Python. User values are NEVER concatenated raw into script text — they
 * only ever pass through here.
 */
function pythonStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeExportFormat(raw: unknown): MayaExportFormat | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (MAYA_EXPORT_FORMATS as readonly string[]).includes(value) ? (value as MayaExportFormat) : null;
}

function normalizeImageFormat(raw: unknown): MayaImageFormat | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (MAYA_IMAGE_FORMATS as readonly string[]).includes(value) ? (value as MayaImageFormat) : null;
}

function normalizeSceneFormat(raw: unknown): MayaSceneFormat | null {
  const value = String(raw ?? '').trim().toLowerCase();
  return (MAYA_SCENE_FORMATS as readonly string[]).includes(value) ? (value as MayaSceneFormat) : null;
}

/**
 * Validate a frame number into a bounded non-negative integer, or null.
 * Accepts a finite number or a plain-integer string; rejects decimals,
 * exponents, Infinity/NaN, hex, negatives, and out-of-range values. The result
 * is a JS number that is re-stringified with `String()` before embedding, so no
 * user-controlled text ever reaches the script (only digits 0-9).
 */
function validateFrame(raw: unknown): { ok: true; frame: number } | { ok: false; error: string } {
  let n: number | null = null;
  if (typeof raw === 'number') {
    n = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    // Plain non-negative integer only (no sign, no dot, no exponent, no hex).
    if (!/^\d{1,7}$/.test(trimmed)) {
      return { ok: false, error: 'frame must be a plain non-negative integer' };
    }
    n = Number(trimmed);
  } else {
    return { ok: false, error: 'frame must be a number or integer string' };
  }
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: 'frame must be a finite integer' };
  }
  if (n < MAYA_FRAME_MIN || n > MAYA_FRAME_MAX) {
    return { ok: false, error: `frame must be between ${MAYA_FRAME_MIN} and ${MAYA_FRAME_MAX}` };
  }
  return { ok: true, frame: n };
}

// ── Public request/result contracts ──────────────────────────────────────────

export interface MayaExportSceneInput {
  /** Absolute .ma/.mb scene to open read-only (validated). */
  scenePath: string;
  /** Absolute file path the export is written to (validated; NEW file). */
  outputPath: string;
  /** FBX / OBJ / USD / ABC — must match the outputPath extension. */
  format: MayaExportFormat;
}

export interface MayaRenderFrameInput {
  /** Absolute .ma/.mb scene to open read-only (validated). */
  scenePath: string;
  /** Absolute image file path the single frame is written to (validated). */
  outputPath: string;
  /** PNG / JPG / TIF / EXR — must match the outputPath extension. */
  format: MayaImageFormat;
  /** Frame number to render (bounded non-negative integer). */
  frame: number | string;
}

export interface MayaConvertFormatInput {
  /** Absolute .ma/.mb scene to open read-only (validated). */
  scenePath: string;
  /** Absolute .ma/.mb path the converted copy is written to (validated; NEW file). */
  outputPath: string;
}

export type MayaOperationInput =
  | MayaExportSceneInput
  | MayaRenderFrameInput
  | MayaConvertFormatInput;

export interface MayaScriptResult {
  /** The generated Python source. On validation failure this is a fail-closed
   *  stub that exits with a UC_MAYA_ERROR sentinel and mutates nothing. */
  script: string;
  scriptExtension: typeof MAYA_SCRIPT_EXTENSION;
  /** The file the script writes, when the path validated. */
  outputHint?: string;
  notes: string[];
  /** True when the request validated into a real operation script. */
  ok: boolean;
}

export interface MayaArgsValidation {
  ok: boolean;
  /** Normalized, safe-to-embed values (present only when ok). Frame is a string
   *  of digits (the re-stringified bounded integer). */
  normalized?: Record<string, string>;
  /** Human-readable reasons any input was rejected (drop-with-note). */
  notes: string[];
}

const MAYA_ERROR_SENTINEL = 'UC_MAYA_ERROR';
const MAYA_DONE_SENTINEL = 'UC_MAYA_DONE';

// Shared banner every generated Maya script carries. The // VERIFY marker is
// intentionally inside the generated Python (as a #-comment) so a human
// reviewing a staged .py sees the unverified-API warning before running it.
const SCRIPT_BANNER = [
  '# Generated by Underground Circle mayaScriptAdapter - run HEADLESSLY via',
  '# `mayapy <this-script.py>` (or `maya -batch -script <this-script.py>`).',
  '# VERIFY mayapy invocation + maya.cmds export/render calls + required plugin',
  '# loads (fbxmaya / AbcExport) on a real Maya install before wiring: entry',
  '# points follow documented shapes but are unverified.',
];

/**
 * Standard headless preamble: initialize maya.standalone (this is what makes
 * `maya.cmds` usable with NO GUI), import cmds, then open the source scene
 * script-node-SAFE. `maya.standalone.initialize()` MUST run before importing /
 * calling maya.cmds; `maya.standalone.uninitialize()` runs in the trailer.
 *
 * Script-node safety (docs/apps/maya.md): the open call passes prompt off and
 * ignoreVersion so a scriptJob/scriptNode in an untrusted scene does not get a
 * chance to prompt or run version dialogs. // VERIFY the exact flag combination
 * that fully disables scriptNode evaluation (e.g. `-lrd all` / executeScriptNodes
 * off) on the target Maya version before trusting this with unknown-origin scenes.
 */
function standaloneOpenLines(sceneLiteral: string): string[] {
  return [
    'import os',
    'import sys',
    'import traceback',
    '',
    'import maya.standalone',
    '',
    'def _main():',
    // initialize() first — everything below depends on it.
    "    maya.standalone.initialize(name='python')",
    '    import maya.cmds as cmds',
    `    SCENE_PATH = ${sceneLiteral}`,
    '    if not os.path.isfile(SCENE_PATH):',
    `        raise RuntimeError("${MAYA_ERROR_SENTINEL}: scene file not found: " + os.path.basename(SCENE_PATH))`,
    // Fresh empty scene, then open the source read-only, script-node-safe.
    '    cmds.file(new=True, force=True)',
    '    cmds.file(SCENE_PATH, open=True, force=True, prompt=False, ignoreVersion=True)',
  ];
}

/** Standard trailer: print the done sentinel, then ALWAYS uninitialize
 *  maya.standalone (even on error) and exit with a status code. */
function scriptTrailerLines(doneExpression: string): string[] {
  return [
    `    report = "${MAYA_DONE_SENTINEL}: " + ${doneExpression}`,
    '    sys.stdout.write(report + "\\n")',
    '    sys.stdout.flush()',
    '',
    'def main():',
    '    status = 0',
    '    try:',
    '        _main()',
    '    except Exception:',
    `        sys.stdout.write("${MAYA_ERROR_SENTINEL}: " + traceback.format_exc() + "\\n")`,
    '        sys.stdout.flush()',
    '        status = 1',
    '    finally:',
    '        try:',
    '            maya.standalone.uninitialize()',
    '        except Exception:',
    '            pass',
    '    sys.exit(status)',
    '',
    "if __name__ == '__main__':",
    '    main()',
    '',
  ];
}

/** Fail-closed stub: a syntactically valid script that mutates nothing, never
 *  even initializes maya.standalone, and exits nonzero with the error sentinel
 *  + the (bounded, plain-text) reason. */
function failClosedScript(reason: string): string {
  const safeReason = pythonStringLiteral(String(reason || 'invalid request').slice(0, 300));
  return [
    ...SCRIPT_BANNER,
    '# FAIL-CLOSED STUB: the request did not validate; this script mutates',
    '# nothing, never starts maya.standalone, and exits nonzero so no partial',
    '# operation can run.',
    'import sys',
    '',
    'def main():',
    `    message = "${MAYA_ERROR_SENTINEL}: " + ${safeReason}`,
    '    sys.stdout.write(message + "\\n")',
    '    sys.stdout.flush()',
    '    sys.exit(1)',
    '',
    "if __name__ == '__main__':",
    '    main()',
    '',
  ].join('\n');
}

// ── validateMayaArgs ──────────────────────────────────────────────────────────

/**
 * Allowlist-validate an operation's inputs into safe, normalized string values.
 * Never throws; returns ok:false + notes on any rejection. This is the single
 * gate every user value passes before it can reach `pythonStringLiteral` / the
 * emitted integer literal.
 */
export function validateMayaArgs(op: unknown, input: unknown): MayaArgsValidation {
  const notes: string[] = [];
  if (!(MAYA_OPERATIONS as readonly string[]).includes(op as string)) {
    return { ok: false, notes: [`Unknown Maya operation "${String(op).slice(0, 40)}".`] };
  }
  const operation = op as MayaOperation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  // Every op opens a source scene — validate it first, uniformly.
  const scene = validateMayaPath(record.scenePath);
  if (!scene.ok) {
    notes.push(`scenePath: ${scene.error}.`);
    return { ok: false, notes };
  }
  const sceneExt = extensionOf(scene.path);
  if (!MAYA_SCENE_INPUT_EXTENSIONS.includes(sceneExt)) {
    notes.push(`scenePath must be a Maya scene (.ma or .mb; got .${sceneExt || '?'}).`);
    return { ok: false, notes };
  }

  if (operation === 'export_scene') {
    const format = normalizeExportFormat(record.format);
    if (!format) {
      notes.push(`export_scene format must be one of ${MAYA_EXPORT_FORMATS.join(', ')}.`);
      return { ok: false, notes };
    }
    const out = validateMayaPath(record.outputPath);
    if (!out.ok) {
      notes.push(`export_scene outputPath: ${out.error}.`);
      return { ok: false, notes };
    }
    const ext = extensionOf(out.path);
    const expectedExt = MAYA_EXPORT_EXTENSION[format];
    if (ext !== expectedExt) {
      notes.push(`export_scene outputPath must end in .${expectedExt} for format ${format} (got .${ext || '?'}).`);
      return { ok: false, notes };
    }
    if (out.path === scene.path) {
      notes.push('export_scene outputPath must differ from the source scene (never write over the source).');
      return { ok: false, notes };
    }
    return { ok: true, normalized: { scenePath: scene.path, outputPath: out.path, format }, notes };
  }

  if (operation === 'playblast_or_render_frame') {
    const format = normalizeImageFormat(record.format);
    if (!format) {
      notes.push(`playblast_or_render_frame format must be one of ${MAYA_IMAGE_FORMATS.join(', ')}.`);
      return { ok: false, notes };
    }
    const out = validateMayaPath(record.outputPath);
    if (!out.ok) {
      notes.push(`playblast_or_render_frame outputPath: ${out.error}.`);
      return { ok: false, notes };
    }
    const ext = extensionOf(out.path);
    if (ext !== format) {
      notes.push(`playblast_or_render_frame outputPath must end in .${format} (got .${ext || '?'}).`);
      return { ok: false, notes };
    }
    const frame = validateFrame(record.frame);
    if (!frame.ok) {
      notes.push(`playblast_or_render_frame ${frame.error}.`);
      return { ok: false, notes };
    }
    return {
      ok: true,
      normalized: { scenePath: scene.path, outputPath: out.path, format, frame: String(frame.frame) },
      notes,
    };
  }

  // operation === 'convert_format'
  const out = validateMayaPath(record.outputPath);
  if (!out.ok) {
    notes.push(`convert_format outputPath: ${out.error}.`);
    return { ok: false, notes };
  }
  const outFormat = normalizeSceneFormat(extensionOf(out.path));
  if (!outFormat) {
    notes.push(`convert_format outputPath must be a Maya scene (.ma or .mb; got .${extensionOf(out.path) || '?'}).`);
    return { ok: false, notes };
  }
  if (out.path === scene.path) {
    notes.push('convert_format outputPath must differ from the source scene (never write over the source).');
    return { ok: false, notes };
  }
  return { ok: true, normalized: { scenePath: scene.path, outputPath: out.path, sceneFormat: outFormat }, notes };
}

// ── buildMayaScript ────────────────────────────────────────────────────────────

/**
 * Turn a bounded op request into a validated Maya Python script. All user
 * values are validated by `validateMayaArgs` FIRST and embedded only via
 * `pythonStringLiteral` (paths/formats) or a re-stringified bounded integer
 * (frame). On any validation failure a fail-closed stub is returned (ok:false)
 * — never a partial mutation, never a throw. Every real script initializes
 * maya.standalone first and uninitializes it in a finally block.
 */
export function buildMayaScript(op: unknown, input: unknown): MayaScriptResult {
  const validation = validateMayaArgs(op, input);
  if (!validation.ok || !validation.normalized) {
    const reason = validation.notes[0] ?? 'invalid Maya request';
    return {
      script: failClosedScript(reason),
      scriptExtension: MAYA_SCRIPT_EXTENSION,
      notes: validation.notes.length ? validation.notes : ['Request did not validate; emitted a fail-closed stub.'],
      ok: false,
    };
  }
  const operation = op as MayaOperation;
  const values = validation.normalized;
  const notes = [...validation.notes];
  const sceneLiteral = pythonStringLiteral(values.scenePath);

  if (operation === 'export_scene') {
    const outputPath = values.outputPath;
    const format = values.format as MayaExportFormat;
    const outputLiteral = pythonStringLiteral(outputPath);
    // Per-format export. FBX/Alembic need a plugin loaded first; OBJ needs the
    // objExport plugin; USD needs mayaUsdPlugin. We load the plugin, select all
    // DAG geometry (transforms), then export the SELECTION to the NEW path.
    // VERIFY the exact plugin names + file -type strings / command flags on a
    // live install (fbxmaya, AbcExport, objExport, mayaUsdPlugin).
    let exportLines: string[];
    if (format === 'fbx') {
      exportLines = [
        "    if not cmds.pluginInfo('fbxmaya', query=True, loaded=True):",
        "        cmds.loadPlugin('fbxmaya')",
        "    cmds.file(OUTPUT_PATH, force=True, options='v=0', type='FBX export', exportSelected=True)",
      ];
    } else if (format === 'obj') {
      exportLines = [
        "    if not cmds.pluginInfo('objExport', query=True, loaded=True):",
        "        cmds.loadPlugin('objExport')",
        "    cmds.file(OUTPUT_PATH, force=True, options='groups=1;ptgroups=1;materials=1;smoothing=1;normals=1', type='OBJexport', exportSelected=True)",
      ];
    } else if (format === 'usd') {
      exportLines = [
        "    if not cmds.pluginInfo('mayaUsdPlugin', query=True, loaded=True):",
        "        cmds.loadPlugin('mayaUsdPlugin')",
        '    cmds.mayaUSDExport(file=OUTPUT_PATH, selection=True)',
      ];
    } else {
      // abc
      exportLines = [
        "    if not cmds.pluginInfo('AbcExport', query=True, loaded=True):",
        "        cmds.loadPlugin('AbcExport')",
        '    roots = cmds.ls(selection=True, long=True) or []',
        "    root_flags = ' '.join('-root ' + r for r in roots)",
        "    cmds.AbcExport(jobArg=(root_flags + ' -file ' + OUTPUT_PATH).strip())",
      ];
    }
    const script = [
      ...SCRIPT_BANNER,
      `# Operation: export_scene (${format.toUpperCase()}). Approval-gated export to a NEW file.`,
      ...standaloneOpenLines(sceneLiteral),
      `    OUTPUT_PATH = ${outputLiteral}`,
      // Select all geometry transforms so exportSelected has a selection.
      "    cmds.select(cmds.ls(geometry=True, long=True) or [], replace=True)",
      "    cmds.select(cmds.listRelatives(cmds.ls(geometry=True) or [], parent=True, fullPath=True) or [], add=True)",
      ...exportLines,
      '    if not os.path.isfile(OUTPUT_PATH):',
      `        raise RuntimeError("${MAYA_ERROR_SENTINEL}: export finished without creating the output file")`,
      ...scriptTrailerLines('("exported ' + format.toUpperCase() + ' -> " + os.path.basename(OUTPUT_PATH))'),
    ].join('\n');
    notes.push(
      `Run headlessly: mayapy ${'<staged-script>.py'} — it opens ${values.scenePath} read-only and writes ${outputPath} (verify with desktop.file_stat after).`,
      'Approval-gated: this writes a NEW file and opens the scene (which may load references/plugins). It never saves over the source scene.',
      'Untrusted scenes carry code risk: the open call disables the version prompt; disable scriptNode evaluation for unknown-origin scenes and say so in the approval.',
    );
    return { script, scriptExtension: MAYA_SCRIPT_EXTENSION, outputHint: outputPath, notes, ok: true };
  }

  if (operation === 'playblast_or_render_frame') {
    const outputPath = values.outputPath;
    const format = values.format as MayaImageFormat;
    const frame = values.frame; // already a bounded digit string
    const outputLiteral = pythonStringLiteral(outputPath);
    // Maya's `render` command image-format token per extension. // VERIFY the
    // exact `-of` / image-format-string values on a live install (renderer
    // defaultRenderGlobals.imageFormat vs the software `render -of` string).
    const imageFormatToken: Record<MayaImageFormat, string> = {
      png: 'png',
      jpg: 'jpg',
      tif: 'tif',
      exr: 'exr',
    };
    const script = [
      ...SCRIPT_BANNER,
      `# Operation: playblast_or_render_frame (frame ${frame}, ${format.toUpperCase()}).`,
      '# Approval-gated single-frame render. Uses the software renderer headless;',
      '# batch renderers (Arnold) need a license and may watermark - report that',
      '# honestly instead of shipping a watermarked frame as proof. // VERIFY the',
      '# render command + image-format flags + renderer availability on install.',
      ...standaloneOpenLines(sceneLiteral),
      `    OUTPUT_PATH = ${outputLiteral}`,
      // Frame is a bounded integer emitted verbatim (digits only) - NOT a user string.
      `    FRAME = ${frame}`,
      `    IMAGE_FORMAT = ${pythonStringLiteral(imageFormatToken[format])}`,
      '    out_dir = os.path.dirname(OUTPUT_PATH) or os.getcwd()',
      '    if not os.path.isdir(out_dir):',
      `        raise RuntimeError("${MAYA_ERROR_SENTINEL}: output directory does not exist: " + out_dir)`,
      // Pin the single frame on the timeline and the render globals; set the
      // output image format string. // VERIFY the exact imageFormat / imfKey
      // attribute + accepted token per renderer on a live install.
      '    cmds.currentTime(FRAME, edit=True)',
      "    if cmds.objExists('defaultRenderGlobals'):",
      "        cmds.setAttr('defaultRenderGlobals.startFrame', FRAME)",
      "        cmds.setAttr('defaultRenderGlobals.endFrame', FRAME)",
      "        cmds.setAttr('defaultRenderGlobals.imageFormatStr', IMAGE_FORMAT, type='string')",
      // Software render of the current frame to an image on disk.
      '    rendered = cmds.render(batch=False)',
      // The render writes to the project images dir by name; move/copy it to the
      // requested OUTPUT_PATH so the caller's stat check is deterministic.
      '    if rendered and os.path.isfile(rendered) and os.path.abspath(rendered) != os.path.abspath(OUTPUT_PATH):',
      '        import shutil',
      '        shutil.copyfile(rendered, OUTPUT_PATH)',
      '    if not os.path.isfile(OUTPUT_PATH):',
      `        raise RuntimeError("${MAYA_ERROR_SENTINEL}: render finished without producing the requested output file")`,
      ...scriptTrailerLines('("rendered frame " + str(FRAME) + " -> " + os.path.basename(OUTPUT_PATH))'),
    ].join('\n');
    notes.push(
      `Run headlessly: mayapy ${'<staged-script>.py'} — it opens ${values.scenePath}, renders frame ${frame}, and writes ${outputPath} (verify with desktop.file_stat + attach the frame).`,
      'Approval-gated: rendering costs compute (and a renderer license for Arnold/etc.); the software renderer is the license-free floor. Report watermarking honestly.',
      'The exact render command, image-format flag, and where the renderer writes are UNVERIFIED — confirm on a live install before wiring.',
    );
    return { script, scriptExtension: MAYA_SCRIPT_EXTENSION, outputHint: outputPath, notes, ok: true };
  }

  // operation === 'convert_format'
  const outputPath = values.outputPath;
  const sceneFormat = values.sceneFormat as MayaSceneFormat;
  const outputLiteral = pythonStringLiteral(outputPath);
  const fileTypeLiteral = pythonStringLiteral(MAYA_SCENE_FILE_TYPE[sceneFormat]);
  const script = [
    ...SCRIPT_BANNER,
    `# Operation: convert_format (.ma<->.mb -> ${sceneFormat.toUpperCase()}). Approval-gated Save As to a NEW file.`,
    ...standaloneOpenLines(sceneLiteral),
    `    OUTPUT_PATH = ${outputLiteral}`,
    `    FILE_TYPE = ${fileTypeLiteral}`,
    // rename the in-memory scene to the target path, then save with the target
    // container type. This never touches the source file on disk.
    '    cmds.file(rename=OUTPUT_PATH)',
    '    cmds.file(save=True, type=FILE_TYPE, force=True)',
    '    if not os.path.isfile(OUTPUT_PATH):',
    `        raise RuntimeError("${MAYA_ERROR_SENTINEL}: save finished without creating the output file")`,
    ...scriptTrailerLines('("converted scene -> " + os.path.basename(OUTPUT_PATH))'),
  ].join('\n');
  notes.push(
    `Run headlessly: mayapy ${'<staged-script>.py'} — it opens ${values.scenePath} and writes a ${sceneFormat.toUpperCase()} copy at ${outputPath} (verify with desktop.file_stat after).`,
    'Approval-gated: this writes a NEW scene file. It renames the in-memory scene before saving, so the source file on disk is never overwritten.',
    'Untrusted scenes carry code risk: disable scriptNode evaluation for unknown-origin scenes and say so in the approval.',
  );
  return { script, scriptExtension: MAYA_SCRIPT_EXTENSION, outputHint: outputPath, notes, ok: true };
}

// ── describeMayaOperation ────────────────────────────────────────────────────

/** One-line plain-language description for an approval preview / notice. Never
 *  throws — returns a generic line for unknown ops/inputs. */
export function describeMayaOperation(op: unknown, input: unknown): string {
  if (!(MAYA_OPERATIONS as readonly string[]).includes(op as string)) {
    return 'Run a Maya headless script (approval-gated, mayapy)';
  }
  const operation = op as MayaOperation;
  const record = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  if (operation === 'export_scene') {
    const format = normalizeExportFormat(record.format);
    return `Export the Maya scene geometry to ${format ? format.toUpperCase() : 'a file'} (headless, approval-gated)`;
  }
  if (operation === 'playblast_or_render_frame') {
    const format = normalizeImageFormat(record.format);
    const frame = validateFrame(record.frame);
    return `Render a single Maya frame${frame.ok ? ` (frame ${frame.frame})` : ''}${format ? ` to ${format.toUpperCase()}` : ''} (headless, approval-gated)`;
  }
  const outFormat = normalizeSceneFormat(extensionOf(String(record.outputPath ?? '')));
  return `Convert the Maya scene${outFormat ? ` to ${outFormat.toUpperCase()}` : ' between .ma/.mb'} (headless, approval-gated)`;
}
