/**
 * cadCodeExecutor — pure planning + validation layer for LOCAL code-CAD
 * execution (OpenSCAD compiles, FreeCAD headless Python scripts, Blender
 * headless bpy scripts) behind the desktop bridge's `/desktop/cad_compile`
 * endpoint.
 *
 * This converts the engineering/CAD runbooks
 * (`src/lib/engineeringCadOperationRunbooks.ts`) from plan-only scaffolding
 * into executable-when-installed steps:
 *   - 'inspect_measure'            → FreeCAD inspect script (bounded JSON on
 *                                    stdout behind `UC_CAD_JSON:` sentinel)
 *   - 'export_plot'                → OpenSCAD compile of a generated .scad
 *   - 'batch_convert_or_translate' → FreeCAD convert script per file
 *
 * Dependency-light on purpose: NO react-native / supabase / node imports, so
 * `npx tsx scripts/cad-code-executor-smoketest.ts` can load it directly and
 * `src/lib/desktopBridge.ts` can share the validators.
 *
 * Honest limitations (do not paper over these):
 *   - freecadcmd is headless: TechDraw/GUI thumbnail exports are unavailable
 *     (`buildFreeCadPythonScript` returns `{ unsupported: true }` for
 *     'thumbnail' instead of pretending).
 *   - Mesh → BREP (e.g. STL → STEP) is not a supported conversion; surface
 *     it as `mesh_to_brep_not_supported` rather than emitting a lossy stub —
 *     Blender moves meshes BETWEEN mesh formats, it does not rebuild solids.
 *   - Blender headless renders pin the Workbench engine: EEVEE needs a
 *     GPU/GL context that `--background` runs often lack.
 */

export type CadEngine = 'openscad' | 'freecadcmd' | 'blender';
export type OpenScadOutputKind = 'stl' | 'png' | 'dxf' | '3mf';
export type FreeCadScriptOperation = 'convert' | 'inspect' | 'thumbnail';
export type BlenderScriptOperation = 'convert' | 'render_preview';

/** Sentinel prefix the FreeCAD inspect script prints before its JSON line. */
export const FREECAD_INSPECT_SENTINEL = 'UC_CAD_JSON:';

// ── Extension contracts ──────────────────────────────────────────────────
// LOCKSTEP: scripts/claude-bridge.js `/desktop/cad_compile` duplicates these
// extension sets in its plain-JS validators (the bridge cannot import TS).
// If you change a set here, change the bridge regexes in the same commit.
export const OPENSCAD_SOURCE_EXTENSION = 'scad';
export const OPENSCAD_OUTPUT_EXTENSIONS: readonly string[] = ['stl', 'off', 'amf', '3mf', 'png', 'svg', 'dxf'];
export const FREECAD_INPUT_EXTENSIONS: readonly string[] = ['step', 'stp', 'iges', 'igs', 'fcstd', 'dxf'];
export const FREECAD_OUTPUT_EXTENSIONS: readonly string[] = ['step', 'stp', 'stl', 'dxf'];

/**
 * Mesh formats Blender imports/exports headlessly with BUILT-IN operators
 * (3MF/AMF need addons, so they are deliberately absent — those stay
 * honest `mesh_source_not_supported`).
 */
export const BLENDER_IMPORT_EXTENSIONS: readonly string[] = ['stl', 'obj', 'ply', 'gltf', 'glb'];
export const BLENDER_EXPORT_EXTENSIONS: readonly string[] = ['stl', 'obj', 'gltf', 'glb'];
export const BLENDER_PREVIEW_OUTPUT_EXTENSION = 'png';

const MESH_SOURCE_EXTENSIONS: readonly string[] = ['stl', 'obj', '3mf', 'amf', 'ply'];
const BREP_OUTPUT_EXTENSIONS: readonly string[] = ['step', 'stp', 'iges', 'igs', 'fcstd', 'brep'];

// ── OpenSCAD extraArgs allowlist ─────────────────────────────────────────
// LOCKSTEP: scripts/claude-bridge.js `isAllowedCadCompileExtraArg` mirrors
// these regexes + the 16..8192 imgsize bounds exactly. Keep identical.
export const OPENSCAD_DEFINE_ARG_REGEX = /^-D[A-Za-z_][A-Za-z0-9_]{0,63}=(?:-?\d{1,12}(?:\.\d{1,12})?|true|false)$/;
export const OPENSCAD_IMGSIZE_ARG_REGEX = /^--imgsize=(\d{2,5}),(\d{2,5})$/;

/**
 * Strict allowlist for OpenSCAD CLI extras: `-Dname=<number|true|false>`
 * parameter overrides, `--render` (full CGAL render), and
 * `--imgsize=W,H` (PNG raster size, 16..8192 per axis — note OpenSCAD's
 * real CLI syntax is comma-separated, not `WxH`). Everything else —
 * including any shell metacharacter, extra `-o`, `--export-format`,
 * spaces — is rejected.
 */
export function isAllowedOpenScadExtraArg(arg: unknown): boolean {
  if (typeof arg !== 'string' || arg.length === 0 || arg.length > 120) return false;
  if (arg === '--render') return true;
  const imgsize = OPENSCAD_IMGSIZE_ARG_REGEX.exec(arg);
  if (imgsize) {
    const width = Number(imgsize[1]);
    const height = Number(imgsize[2]);
    return width >= 16 && width <= 8192 && height >= 16 && height <= 8192;
  }
  return OPENSCAD_DEFINE_ARG_REGEX.test(arg);
}

// ── Path validation (pure mirror) ────────────────────────────────────────
// LOCKSTEP: mirrors `validateDesktopPathServer` in scripts/claude-bridge.js
// (length/control-char/shell-metachar rejects) so a plan that passes here
// cannot fail bridge validation for a different reason. Additionally rejects
// non-BMP code points because paths are embedded in generated Python string
// literals via \uXXXX escapes, and lone-surrogate escapes are not encodable.
function validateCadPath(raw: unknown): { ok: true; path: string } | { ok: false; error: string } {
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
  return { ok: true, path: trimmed };
}

/**
 * Emit a value as a Python 3 string literal. JSON.stringify output
 * (double-quoted, backslash/quote-escaped, control chars as \uXXXX) is a
 * valid Python string literal for BMP text; we additionally escape every
 * non-ASCII char to \uXXXX so the generated script is pure ASCII.
 * `validateCadPath` rejects non-BMP code points, so surrogate escapes never
 * reach Python. Paths are NEVER concatenated raw into script text.
 */
function pythonStringLiteral(value: string): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

function normalizeExt(raw: string): string {
  return String(raw || '').trim().toLowerCase().replace(/^\./, '').slice(0, 12);
}

// ── OpenSCAD compile plan ────────────────────────────────────────────────

export interface OpenScadCompilePlanArgs {
  /** Short task description; slugged into deterministic file names. */
  brief: string;
  /** Parameter overrides emitted as -D args (numbers/booleans only). */
  parameters?: Record<string, number | boolean | string>;
  outputKind: OpenScadOutputKind;
  /** Directory where source + output should be staged (e.g. ~/Documents/uc-cad). */
  workDir: string;
  /** Optional deterministic suffix (NOT Date.now — caller supplies, e.g. run id). */
  stamp?: string;
}

export interface OpenScadCompilePlan {
  sourceFileName: string;
  outputFileName: string;
  /** workDir-joined convenience paths ('' prefix when workDir was invalid). */
  sourcePath: string;
  outputPath: string;
  extraArgs: string[];
  notes: string[];
}

const OPENSCAD_PARAM_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const OPENSCAD_PARAM_VALUE_REGEX = /^(?:-?\d{1,12}(?:\.\d{1,12})?|true|false)$/;

function slugFromBrief(brief: string): string {
  const slug = String(brief || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'cad-part';
}

function normalizeStamp(stamp: unknown): string {
  return String(stamp || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
}

/**
 * Deterministic OpenSCAD compile plan: file names slugged from the brief
 * (same inputs → same plan; pass `stamp` for uniqueness across runs),
 * parameter overrides validated into -D args with the same allowlist the
 * bridge enforces. Invalid parameters are dropped with an explanatory note —
 * never silently mangled into an argv token.
 */
export function buildOpenScadCompilePlan(args: OpenScadCompilePlanArgs): OpenScadCompilePlan {
  const notes: string[] = [];
  const slug = slugFromBrief(args?.brief ?? '');
  const stamp = normalizeStamp(args?.stamp);
  const baseName = stamp ? `${slug}-${stamp}` : slug;

  let outputKind: OpenScadOutputKind = args?.outputKind;
  if (outputKind !== 'stl' && outputKind !== 'png' && outputKind !== 'dxf' && outputKind !== '3mf') {
    notes.push(`Unsupported outputKind "${String(args?.outputKind).slice(0, 20)}" — defaulted to stl.`);
    outputKind = 'stl';
  }

  const sourceFileName = `${baseName}.${OPENSCAD_SOURCE_EXTENSION}`;
  const outputFileName = `${baseName}.${outputKind}`;

  const extraArgs: string[] = [];
  if (outputKind === 'png') {
    // Headless raster preview: force a full render (no preview shortcuts)
    // at a bounded default size.
    extraArgs.push('--render', '--imgsize=1024,768');
    notes.push('PNG output renders headlessly via OpenSCAD --render; no GUI is opened.');
  }
  if (outputKind === 'dxf') {
    notes.push('DXF export is 2D only — the .scad program must produce a 2D profile (e.g. projection(cut=true) of the model).');
  }
  if (outputKind === 'stl' || outputKind === '3mf') {
    notes.push('STL/3MF geometry is unitless; OpenSCAD numbers are conventionally millimeters — state the convention in the proof.');
  }

  const parameters = args?.parameters && typeof args.parameters === 'object' ? args.parameters : {};
  for (const key of Object.keys(parameters).sort()) {
    const rawValue = (parameters as Record<string, unknown>)[key];
    if (!OPENSCAD_PARAM_KEY_REGEX.test(key)) {
      notes.push(`Dropped parameter "${String(key).slice(0, 40)}": name must match [A-Za-z_][A-Za-z0-9_]*.`);
      continue;
    }
    let value: string | null = null;
    if (typeof rawValue === 'boolean') value = rawValue ? 'true' : 'false';
    else if (typeof rawValue === 'number' && Number.isFinite(rawValue)) value = String(rawValue);
    else if (typeof rawValue === 'string') value = rawValue.trim();
    if (value === null || !OPENSCAD_PARAM_VALUE_REGEX.test(value)) {
      notes.push(`Dropped parameter "${key}": value must be a plain number, true, or false.`);
      continue;
    }
    const defineArg = `-D${key}=${value}`;
    // Belt + suspenders: the emitted token must itself pass the allowlist
    // the bridge re-checks (LOCKSTEP with /desktop/cad_compile).
    if (!isAllowedOpenScadExtraArg(defineArg)) {
      notes.push(`Dropped parameter "${key}": assembled -D argument failed the compile allowlist.`);
      continue;
    }
    extraArgs.push(defineArg);
  }

  const workDirValidated = validateCadPath(args?.workDir ?? '');
  let sourcePath = sourceFileName;
  let outputPath = outputFileName;
  if (workDirValidated.ok) {
    const dir = workDirValidated.path.replace(/\/+$/, '');
    sourcePath = `${dir}/${sourceFileName}`;
    outputPath = `${dir}/${outputFileName}`;
  } else {
    notes.push(`workDir invalid (${workDirValidated.error}); plan paths are bare file names — resolve a staging folder before compiling.`);
  }
  notes.push(`Write the OpenSCAD program to ${sourcePath} (desktop.file_write_text), then compile via desktop cad_compile { engine: "openscad" }.`);

  return { sourceFileName, outputFileName, sourcePath, outputPath, extraArgs, notes };
}

// ── FreeCAD headless script generation ───────────────────────────────────

export type FreeCadScriptBuild =
  | { ok: true; operation: FreeCadScriptOperation; python: string; suggestedScriptFileName: string; notes: string[] }
  | { ok: false; unsupported: boolean; reason: string; notes: string[] };

function freeCadOpenLines(inputLiteral: string, docName: string): string[] {
  return [
    `INPUT_PATH = ${inputLiteral}`,
    '',
    'import FreeCAD',
    'import Part',
    '',
    'if not os.path.isfile(INPUT_PATH):',
    '    raise SystemExit("UC_CAD_ERROR: input file not found: " + os.path.basename(INPUT_PATH))',
    'in_ext = os.path.splitext(INPUT_PATH)[1].lower()',
    'if in_ext == ".fcstd":',
    '    doc = FreeCAD.openDocument(INPUT_PATH)',
    'elif in_ext in (".step", ".stp", ".iges", ".igs"):',
    `    doc = FreeCAD.newDocument("${docName}")`,
    '    Part.insert(INPUT_PATH, doc.Name)',
    'elif in_ext == ".dxf":',
    '    import importDXF',
    `    doc = FreeCAD.newDocument("${docName}")`,
    '    importDXF.insert(INPUT_PATH, doc.Name)',
    'else:',
    '    raise SystemExit("UC_CAD_ERROR: unsupported input extension: " + in_ext)',
    'doc.recompute()',
  ];
}

/**
 * Generate the Python source freecadcmd executes. Paths are embedded ONLY as
 * escaped string literals (see `pythonStringLiteral`) — never interpolated
 * raw. The scripts import App-level modules only (FreeCAD/Part/Mesh/
 * importDXF); FreeCADGui and TechDraw are GUI-dependent and deliberately
 * absent, which is why 'thumbnail' is honestly unsupported headless.
 */
export function buildFreeCadPythonScript(args: {
  operation: FreeCadScriptOperation;
  inputPath: string;
  outputPath?: string;
}): FreeCadScriptBuild {
  const operation = args?.operation;
  if (operation !== 'convert' && operation !== 'inspect' && operation !== 'thumbnail') {
    return { ok: false, unsupported: false, reason: 'operation must be convert, inspect, or thumbnail', notes: [] };
  }
  if (operation === 'thumbnail') {
    return {
      ok: false,
      unsupported: true,
      reason: 'freecadcmd runs headless: thumbnail/preview rendering depends on FreeCADGui/TechDraw which are unavailable without a GUI session. For a visual preview, convert to STL and render it elsewhere, or compile a .scad model to PNG via OpenSCAD --render.',
      notes: ['Do not fabricate a thumbnail — report the headless limitation and offer the OpenSCAD PNG path when the source is code-CAD.'],
    };
  }

  const inputValidated = validateCadPath(args?.inputPath ?? '');
  if (!inputValidated.ok) {
    return { ok: false, unsupported: false, reason: `inputPath: ${inputValidated.error}`, notes: [] };
  }
  const inputExt = extensionOf(inputValidated.path);
  if (!FREECAD_INPUT_EXTENSIONS.includes(inputExt)) {
    return {
      ok: false,
      unsupported: false,
      reason: `inputPath extension ".${inputExt || '?'}" is not FreeCAD-openable here — expected one of: ${FREECAD_INPUT_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`,
      notes: [],
    };
  }
  const inputLiteral = pythonStringLiteral(inputValidated.path);

  if (operation === 'inspect') {
    const python = [
      '# Generated by Underground Circle cadCodeExecutor (FreeCAD inspect recipe).',
      '# Headless-safe: App-level modules only (no GUI-dependent imports).',
      'import json',
      'import os',
      '',
      ...freeCadOpenLines(inputLiteral, 'uc_cad_inspect'),
      '',
      'shape_objects = []',
      'invalid_count = 0',
      'bbox = None',
      'for obj in doc.Objects:',
      '    shape = getattr(obj, "Shape", None)',
      '    if shape is None or not hasattr(shape, "isNull") or shape.isNull():',
      '        continue',
      '    shape_objects.append(obj)',
      '    try:',
      '        if not shape.isValid():',
      '            invalid_count += 1',
      '    except Exception:',
      '        invalid_count += 1',
      '    try:',
      '        b = shape.BoundBox',
      '        edges = [b.XMin, b.YMin, b.ZMin, b.XMax, b.YMax, b.ZMax]',
      '        if bbox is None:',
      '            bbox = edges',
      '        else:',
      '            bbox = [min(bbox[0], edges[0]), min(bbox[1], edges[1]), min(bbox[2], edges[2]), max(bbox[3], edges[3]), max(bbox[4], edges[4]), max(bbox[5], edges[5])]',
      '    except Exception:',
      '        pass',
      'summary = {',
      '    "objectCount": len(doc.Objects),',
      '    "shapeObjectCount": len(shape_objects),',
      '    "invalidShapeCount": invalid_count,',
      '    "bbox": None if bbox is None else {',
      '        "minX": round(bbox[0], 3), "minY": round(bbox[1], 3), "minZ": round(bbox[2], 3),',
      '        "maxX": round(bbox[3], 3), "maxY": round(bbox[4], 3), "maxZ": round(bbox[5], 3),',
      '    },',
      '    "labels": [str(obj.Label)[:80] for obj in shape_objects[:20]],',
      '}',
      `print(${pythonStringLiteral(FREECAD_INSPECT_SENTINEL)} + json.dumps(summary)[:4000])`,
      '',
    ].join('\n');
    return {
      ok: true,
      operation,
      python,
      suggestedScriptFileName: 'uc-freecad-inspect.py',
      notes: [
        'Stage this script as a .py file, then run desktop cad_compile { engine: "freecadcmd" } with sourcePath = the script.',
        `Parse the ${FREECAD_INSPECT_SENTINEL} line from stdoutTail with parseFreeCadInspectOutput for the typed summary.`,
      ],
    };
  }

  // operation === 'convert'
  const outputValidated = validateCadPath(args?.outputPath ?? '');
  if (!outputValidated.ok) {
    return { ok: false, unsupported: false, reason: `outputPath: ${outputValidated.error}`, notes: [] };
  }
  const outputExt = extensionOf(outputValidated.path);
  if (!FREECAD_OUTPUT_EXTENSIONS.includes(outputExt)) {
    return {
      ok: false,
      unsupported: false,
      reason: `outputPath extension ".${outputExt || '?'}" is not exportable here — expected one of: ${FREECAD_OUTPUT_EXTENSIONS.map((e) => `.${e}`).join(', ')}.`,
      notes: [],
    };
  }
  const outputLiteral = pythonStringLiteral(outputValidated.path);
  const python = [
    '# Generated by Underground Circle cadCodeExecutor (FreeCAD convert recipe).',
    '# Headless-safe: App-level modules only (no GUI-dependent imports).',
    'import os',
    '',
    `OUTPUT_PATH = ${outputLiteral}`,
    ...freeCadOpenLines(inputLiteral, 'uc_cad_convert'),
    '',
    'objects = []',
    'for obj in doc.Objects:',
    '    shape = getattr(obj, "Shape", None)',
    '    if shape is not None and hasattr(shape, "isNull") and not shape.isNull():',
    '        objects.append(obj)',
    'if not objects:',
    '    raise SystemExit("UC_CAD_ERROR: no shape objects found in input document")',
    'out_ext = os.path.splitext(OUTPUT_PATH)[1].lower()',
    'if out_ext in (".step", ".stp"):',
    '    Part.export(objects, OUTPUT_PATH)',
    'elif out_ext == ".stl":',
    '    import Mesh',
    '    Mesh.export(objects, OUTPUT_PATH)',
    'elif out_ext == ".dxf":',
    '    import importDXF',
    '    importDXF.export(objects, OUTPUT_PATH)',
    'else:',
    '    raise SystemExit("UC_CAD_ERROR: unsupported output extension: " + out_ext)',
    'if not os.path.isfile(OUTPUT_PATH):',
    '    raise SystemExit("UC_CAD_ERROR: exporter finished without creating the output file")',
    'print("UC_CAD_DONE: exported " + str(len(objects)) + " object(s) -> " + os.path.basename(OUTPUT_PATH))',
    '',
  ].join('\n');
  return {
    ok: true,
    operation,
    python,
    suggestedScriptFileName: 'uc-freecad-convert.py',
    notes: [
      'Stage this script as a .py file, then run desktop cad_compile { engine: "freecadcmd" } with sourcePath = the script and outputPath = the export target (verified after the run).',
      'The compile response output.exists is the proof the export happened — freecadcmd scripts write outputs themselves.',
    ],
  };
}

// ── Blender headless script generation ───────────────────────────────────

export type BlenderScriptBuild =
  | { ok: true; operation: BlenderScriptOperation; python: string; suggestedScriptFileName: string; notes: string[] }
  | { ok: false; unsupported: boolean; reason: string; notes: string[] };

/**
 * Shared bpy header: hard-reset to an EMPTY factory scene (no default cube/
 * camera/light, no user prefs or addons can leak into the run), then import
 * the input mesh with Blender's BUILT-IN operators.
 *
 * Operator-name compat: the flat `bpy.ops.wm.*_import/_export` names
 * (wm.stl_import, wm.obj_export, ...) are the Blender 4.x C++ operators —
 * the legacy 3.x `import_mesh.stl` / `import_scene.obj` addon operators were
 * removed in 4.x. The glTF pair kept its `import_scene.gltf` /
 * `export_scene.gltf` name in 4.x. The bridge runs whatever Blender the
 * fixed install paths resolve, so 4.x+ is the supported floor.
 */
function blenderOpenLines(inputLiteral: string): string[] {
  return [
    `INPUT_PATH = ${inputLiteral}`,
    '',
    'if not os.path.isfile(INPUT_PATH):',
    '    raise SystemExit("UC_CAD_ERROR: input file not found: " + os.path.basename(INPUT_PATH))',
    '',
    'bpy.ops.wm.read_factory_settings(use_empty=True)',
    '',
    'in_ext = os.path.splitext(INPUT_PATH)[1].lower()',
    'if in_ext == ".stl":',
    '    bpy.ops.wm.stl_import(filepath=INPUT_PATH)',
    'elif in_ext == ".obj":',
    '    bpy.ops.wm.obj_import(filepath=INPUT_PATH)',
    'elif in_ext == ".ply":',
    '    bpy.ops.wm.ply_import(filepath=INPUT_PATH)',
    'elif in_ext in (".gltf", ".glb"):',
    '    bpy.ops.import_scene.gltf(filepath=INPUT_PATH)',
    'else:',
    '    raise SystemExit("UC_CAD_ERROR: unsupported input extension: " + in_ext)',
    '',
    "mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']",
    'if not mesh_objects:',
    '    raise SystemExit("UC_CAD_ERROR: no mesh objects imported from input file")',
  ];
}

/**
 * Generate the Python source Blender executes via
 * `--background --factory-startup --python <script>`:
 *
 *   - 'convert'        → mesh format conversion between STL/OBJ/PLY/glTF/GLB
 *   - 'render_preview' → import + auto-framed camera + Workbench render PNG
 *
 * Paths are embedded ONLY as escaped string literals (`pythonStringLiteral`,
 * same technique as `buildFreeCadPythonScript`) — never interpolated raw.
 * Headless honesty: the render pins engine 'BLENDER_WORKBENCH' because EEVEE
 * requires a GPU/GL context that `--background` runs often lack; Workbench
 * also needs no lights, so the empty factory scene renders deterministically.
 */
export function buildBlenderPythonScript(args: {
  operation: BlenderScriptOperation;
  inputPath: string;
  outputPath: string;
}): BlenderScriptBuild {
  const operation = args?.operation;
  if (operation !== 'convert' && operation !== 'render_preview') {
    return { ok: false, unsupported: false, reason: 'operation must be convert or render_preview', notes: [] };
  }

  const inputValidated = validateCadPath(args?.inputPath ?? '');
  if (!inputValidated.ok) {
    return { ok: false, unsupported: false, reason: `inputPath: ${inputValidated.error}`, notes: [] };
  }
  const inputExt = extensionOf(inputValidated.path);
  if (!BLENDER_IMPORT_EXTENSIONS.includes(inputExt)) {
    return {
      ok: false,
      unsupported: false,
      reason: `inputPath extension ".${inputExt || '?'}" is not Blender-importable here — expected one of: ${BLENDER_IMPORT_EXTENSIONS.map((e) => `.${e}`).join(', ')}. (B-rep documents like STEP/IGES belong to freecadcmd.)`,
      notes: [],
    };
  }
  const outputValidated = validateCadPath(args?.outputPath ?? '');
  if (!outputValidated.ok) {
    return { ok: false, unsupported: false, reason: `outputPath: ${outputValidated.error}`, notes: [] };
  }
  const outputExt = extensionOf(outputValidated.path);
  const inputLiteral = pythonStringLiteral(inputValidated.path);
  const outputLiteral = pythonStringLiteral(outputValidated.path);

  if (operation === 'render_preview') {
    if (outputExt !== BLENDER_PREVIEW_OUTPUT_EXTENSION) {
      return {
        ok: false,
        unsupported: false,
        reason: `render_preview outputPath must end in .${BLENDER_PREVIEW_OUTPUT_EXTENSION}.`,
        notes: [],
      };
    }
    const python = [
      '# Generated by Underground Circle cadCodeExecutor (Blender render-preview recipe).',
      '# Headless-safe: bpy only; Workbench engine (EEVEE needs a GPU/GL context',
      '# that --background runs often lack; Workbench also needs no lights).',
      'import os',
      'import bpy',
      'import mathutils',
      '',
      `OUTPUT_PATH = ${outputLiteral}`,
      ...blenderOpenLines(inputLiteral),
      '',
      'scene = bpy.context.scene',
      "scene.render.engine = 'BLENDER_WORKBENCH'",
      "scene.render.image_settings.file_format = 'PNG'",
      'scene.render.resolution_x = 1024',
      'scene.render.resolution_y = 768',
      'scene.render.filepath = OUTPUT_PATH',
      '',
      '# Auto-place a camera framing every imported mesh: world-space bbox,',
      '# then back off along a fixed 3/4 view direction by ~1.8x the diagonal.',
      '# (view3d camera-fit operators need a GUI viewport; this math does not.)',
      'min_corner = [1e18, 1e18, 1e18]',
      'max_corner = [-1e18, -1e18, -1e18]',
      'for obj in mesh_objects:',
      '    for corner in obj.bound_box:',
      '        world = obj.matrix_world @ mathutils.Vector(corner)',
      '        for axis in range(3):',
      '            min_corner[axis] = min(min_corner[axis], world[axis])',
      '            max_corner[axis] = max(max_corner[axis], world[axis])',
      'center = mathutils.Vector([(min_corner[axis] + max_corner[axis]) / 2.0 for axis in range(3)])',
      'diagonal = max((mathutils.Vector(max_corner) - mathutils.Vector(min_corner)).length, 0.001)',
      '',
      'camera_data = bpy.data.cameras.new("uc_preview_camera")',
      'camera_object = bpy.data.objects.new("uc_preview_camera", camera_data)',
      'scene.collection.objects.link(camera_object)',
      'scene.camera = camera_object',
      'view_direction = mathutils.Vector((1.0, -1.0, 0.8)).normalized()',
      'camera_object.location = center + view_direction * (diagonal * 1.8)',
      'camera_data.clip_start = max(diagonal / 1000.0, 0.001)',
      'camera_data.clip_end = max(diagonal * 10.0, 100.0)',
      'look = center - camera_object.location',
      "camera_object.rotation_euler = look.to_track_quat('-Z', 'Y').to_euler()",
      '',
      'bpy.ops.render.render(write_still=True)',
      'if not os.path.isfile(OUTPUT_PATH):',
      '    raise SystemExit("UC_CAD_ERROR: render finished without creating the output file")',
      'print("UC_CAD_DONE: rendered preview of " + str(len(mesh_objects)) + " mesh object(s) -> " + os.path.basename(OUTPUT_PATH))',
      '',
    ].join('\n');
    return {
      ok: true,
      operation,
      python,
      suggestedScriptFileName: 'uc-blender-render-preview.py',
      notes: [
        'Stage this script as a .py file, then run desktop cad_compile { engine: "blender" } with sourcePath = the script and outputPath = the PNG (verified after the run; no extraArgs — the argv is fixed).',
        'The render uses the Workbench engine headlessly — a shaded geometry proof, not a lit beauty render.',
      ],
    };
  }

  // operation === 'convert'
  if (!BLENDER_EXPORT_EXTENSIONS.includes(outputExt)) {
    return {
      ok: false,
      unsupported: false,
      reason: `outputPath extension ".${outputExt || '?'}" is not exportable here — expected one of: ${BLENDER_EXPORT_EXTENSIONS.map((e) => `.${e}`).join(', ')}. (Mesh → BREP such as .step is modeling work, not conversion — see mesh_to_brep_not_supported.)`,
      notes: [],
    };
  }
  const python = [
    '# Generated by Underground Circle cadCodeExecutor (Blender convert recipe).',
    '# Headless-safe: bpy only, empty factory scene, built-in operators only.',
    'import os',
    'import bpy',
    '',
    `OUTPUT_PATH = ${outputLiteral}`,
    ...blenderOpenLines(inputLiteral),
    '',
    'out_ext = os.path.splitext(OUTPUT_PATH)[1].lower()',
    'if out_ext == ".stl":',
    '    bpy.ops.wm.stl_export(filepath=OUTPUT_PATH)',
    'elif out_ext == ".obj":',
    '    bpy.ops.wm.obj_export(filepath=OUTPUT_PATH)',
    'elif out_ext == ".glb":',
    "    bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLB')",
    'elif out_ext == ".gltf":',
    "    bpy.ops.export_scene.gltf(filepath=OUTPUT_PATH, export_format='GLTF_SEPARATE')",
    'else:',
    '    raise SystemExit("UC_CAD_ERROR: unsupported output extension: " + out_ext)',
    'if not os.path.isfile(OUTPUT_PATH):',
    '    raise SystemExit("UC_CAD_ERROR: exporter finished without creating the output file")',
    'print("UC_CAD_DONE: converted " + str(len(mesh_objects)) + " mesh object(s) -> " + os.path.basename(OUTPUT_PATH))',
    '',
  ].join('\n');
  return {
    ok: true,
    operation,
    python,
    suggestedScriptFileName: 'uc-blender-convert.py',
    notes: [
      'Stage this script as a .py file, then run desktop cad_compile { engine: "blender" } with sourcePath = the script and outputPath = the export target (verified after the run; no extraArgs — the argv is fixed).',
      'Mesh conversion moves triangles between containers; it does not repair geometry or rebuild solids.',
    ],
  };
}

// ── FreeCAD inspect output parsing ───────────────────────────────────────

export interface FreeCadInspectBBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface FreeCadInspectSummary {
  objectCount: number;
  shapeObjectCount: number;
  invalidShapeCount: number;
  bbox: FreeCadInspectBBox | null;
  labels: string[];
}

function clampCount(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1_000_000_000, Math.trunc(n)));
}

/**
 * Extract the typed summary from a freecadcmd inspect run's stdout tail.
 * Finds the LAST `UC_CAD_JSON:` sentinel line (FreeCAD may print startup
 * noise first), parses at most 4000 chars of JSON, and bounds every field.
 * Returns null (never throws) when the sentinel/JSON is absent or malformed.
 */
export function parseFreeCadInspectOutput(stdoutTail: string): FreeCadInspectSummary | null {
  const text = String(stdoutTail || '').slice(-8000);
  const idx = text.lastIndexOf(FREECAD_INSPECT_SENTINEL);
  if (idx < 0) return null;
  const lineEnd = text.indexOf('\n', idx);
  const jsonText = text
    .slice(idx + FREECAD_INSPECT_SENTINEL.length, lineEnd < 0 ? text.length : lineEnd)
    .trim()
    .slice(0, 4000);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  let bbox: FreeCadInspectBBox | null = null;
  const rawBBox = record.bbox as Record<string, unknown> | null | undefined;
  if (rawBBox && typeof rawBBox === 'object') {
    const values = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'].map((key) => Number(rawBBox[key]));
    if (values.every((v) => Number.isFinite(v))) {
      bbox = { minX: values[0], minY: values[1], minZ: values[2], maxX: values[3], maxY: values[4], maxZ: values[5] };
    }
  }
  const labels = Array.isArray(record.labels)
    ? record.labels.slice(0, 20).map((label) => String(label).slice(0, 80)).filter((label) => label.length > 0)
    : [];
  return {
    objectCount: clampCount(record.objectCount),
    shapeObjectCount: clampCount(record.shapeObjectCount),
    invalidShapeCount: clampCount(record.invalidShapeCount),
    bbox,
    labels,
  };
}

// ── Engine resolution ────────────────────────────────────────────────────

export type CadEngineResolution = CadEngine | { unsupported: true; reason: string };

/**
 * Pick the local engine for a source→output pair, or say honestly why none
 * fits. OpenSCAD only compiles .scad programs; FreeCAD handles BREP/document
 * conversions (STEP/IGES/FCStd/DXF in → STEP/STL/DXF out — B-rep stays with
 * freecadcmd); Blender handles mesh↔mesh conversion between DIFFERENT
 * formats (STL/OBJ/PLY/glTF/GLB) plus PNG render previews of those meshes.
 * Mesh sources (STL/OBJ/…) cannot be up-converted to BREP formats headlessly
 * — surfaced as `mesh_to_brep_not_supported` instead of a lossy fake.
 */
export function resolveCadEngineForTask(args: { sourceExt: string; desiredOutputExt: string }): CadEngineResolution {
  const source = normalizeExt(args?.sourceExt ?? '');
  const output = normalizeExt(args?.desiredOutputExt ?? '');
  if (!source) return { unsupported: true, reason: 'missing_source_extension' };
  if (source === OPENSCAD_SOURCE_EXTENSION) {
    if (OPENSCAD_OUTPUT_EXTENSIONS.includes(output)) return 'openscad';
    return { unsupported: true, reason: 'openscad_output_not_supported' };
  }
  if (FREECAD_INPUT_EXTENSIONS.includes(source)) {
    if (FREECAD_OUTPUT_EXTENSIONS.includes(output)) return 'freecadcmd';
    return { unsupported: true, reason: 'freecad_output_not_supported' };
  }
  if (MESH_SOURCE_EXTENSIONS.includes(source) || BLENDER_IMPORT_EXTENSIONS.includes(source)) {
    if (BREP_OUTPUT_EXTENSIONS.includes(output)) {
      // Triangles carry no feature/topology data — rebuilding solids from a
      // mesh is modeling work, not conversion. Say so instead of faking it.
      return { unsupported: true, reason: 'mesh_to_brep_not_supported' };
    }
    if (BLENDER_IMPORT_EXTENSIONS.includes(source)) {
      // Same-extension "conversion" is a file copy, not a conversion — keep
      // it honestly unsupported rather than spinning Blender for a no-op.
      if (output !== source && BLENDER_EXPORT_EXTENSIONS.includes(output)) return 'blender';
      // Render-preview lane: any Blender-importable mesh → PNG proof.
      if (output === BLENDER_PREVIEW_OUTPUT_EXTENSION) return 'blender';
    }
    return { unsupported: true, reason: 'mesh_source_not_supported' };
  }
  return { unsupported: true, reason: 'unsupported_source_format' };
}

/** One-line plain-language install hint per engine. */
export function describeCadInstallGuidance(engine: CadEngine): string {
  if (engine === 'freecadcmd') {
    return 'FreeCAD is not installed on this Mac — install it with `brew install --cask freecad` (or from freecad.org), then retry the conversion.';
  }
  if (engine === 'blender') {
    return 'Blender is not installed on this Mac — install it with `brew install --cask blender` (or from blender.org), then retry the conversion.';
  }
  return 'OpenSCAD is not installed on this Mac — install it with `brew install --cask openscad` (or from openscad.org), then retry the compile.';
}

// ── Compile receipt (bounded evidence for persisted metadata) ────────────

export interface CadCompileReceipt {
  engine: string;
  exitOk: boolean;
  outputExists: boolean;
  outputBytes: number;
  durationMs: number;
  stderrExcerpt: string;
}

/**
 * Reduce a `/desktop/cad_compile` response (bridge body or client `data`)
 * into the bounded receipt shape safe for persisted chat metadata /
 * evidence contracts. Tolerates missing/garbage fields — never throws.
 */
export function buildCadCompileReceipt(bridgeResult: unknown): CadCompileReceipt {
  const record = bridgeResult && typeof bridgeResult === 'object' ? (bridgeResult as Record<string, unknown>) : {};
  const output = record.output && typeof record.output === 'object' ? (record.output as Record<string, unknown>) : {};
  const bytes = Number(output.bytes);
  const duration = Number(record.durationMs);
  return {
    engine: String(record.engine || 'unknown').slice(0, 40),
    // Strict: receipts are persisted evidence — only a literal numeric 0
    // exit counts as success (no string coercion).
    exitOk: record.exitCode === 0,
    outputExists: output.exists === true,
    outputBytes: Number.isFinite(bytes) ? Math.max(0, Math.min(1_000_000_000_000, Math.trunc(bytes))) : 0,
    durationMs: Number.isFinite(duration) ? Math.max(0, Math.min(86_400_000, Math.trunc(duration))) : 0,
    stderrExcerpt: String(record.stderrTail || '').slice(-300),
  };
}
