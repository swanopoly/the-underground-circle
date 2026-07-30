/**
 * engineeringSolidModelingCore — a PURE, engine-neutral parametric 3D solid
 * modeling core. The 3D counterpart to engineeringDraftingCore.
 *
 * WHY THIS EXISTS
 * The drafting core covers the 2D "core capabilities" (draft, layer, symbol,
 * block). This closes the 3D-modeling one WITHOUT faking it. A neutral CSG
 * model — a union of positive primitives minus a set of negative primitives —
 * compiles to TWO real backends:
 *
 *   1. Blender bpy Python  → runs on the ALREADY-LIVE-PROVEN `desktop.cad_compile`
 *      { engine: 'blender' } lane, exports STL. Blender is installed here, so
 *      this path is verifiable end to end today.
 *   2. OpenSCAD .scad      → the canonical parametric-CAD text format; runs on
 *      the same lane's { engine: 'openscad' } when OpenSCAD is installed. Ready
 *      now, un-proven locally (no OpenSCAD install) — same posture the AutoCAD
 *      .scr backend has.
 *
 * ONE model, two emitters — exactly the drafting core's DXF/`.scr` split, so an
 * engineer's part definition is written once and compiles wherever an engine
 * exists.
 *
 * SECURITY BARS — TWO GENERATED LANGUAGES.
 *   - The bpy script embeds the OUTPUT PATH as a Python string literal. A path
 *     with a quote/newline/backslash would break the literal (or worse), so it
 *     is embedded via `pyStringLiteral` (JSON.stringify — valid Python string
 *     syntax for our inputs — with the ES separators additionally escaped).
 *   - Every geometric value is forced finite before it reaches either script;
 *     a NaN/Infinity in a coordinate would emit `nan`/`inf` tokens that make the
 *     whole script a runtime error. No free-text ever enters geometry.
 *
 * MODELING SCOPE. Positives ∪, then negatives −. That single shape covers the
 * overwhelming majority of real mechanical parts: plates/blocks with bores and
 * mounting holes, brackets, tubes/washers/spacers, standoffs. It is deliberately
 * NOT a general CSG tree — arbitrary nested intersection graphs belong in a
 * hand-written OpenSCAD/FreeCAD script through the existing lane. This core is
 * the "generate the common part for me, verified" tool, not a CAD kernel.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-solid-modeling-core-smoketest.ts):
 * no imports, no Date.now(), no I/O, total functions.
 */

// ─── Numbers + safe literals ─────────────────────────────────────────────────

export type SolidResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Force a finite number; the generators reject rather than emit nan/inf. */
function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function allFinite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v));
}

/** Round to 6 decimals, plain decimal (no exponent) — both languages read it. */
function fmt(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const r = Math.round(v * 1e6) / 1e6;
  const s = r.toString();
  return /e/i.test(s) ? r.toFixed(6) : s;
}

/**
 * A Python string literal safe for arbitrary paths. JSON.stringify yields a
 * double-quoted string with \\, \", \n, \t, \uXXXX — all valid Python string
 * escapes — and we additionally escape U+2028/U+2029 which JSON emits raw.
 */
export function pyStringLiteral(value: string): string {
  return JSON.stringify(String(value ?? ''))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// ─── Neutral CSG model ───────────────────────────────────────────────────────

/** Axis a cylinder's height runs along. */
export type SolidAxis = 'x' | 'y' | 'z';

export type SolidPrimitive =
  | { kind: 'box'; w: number; d: number; h: number; cx?: number; cy?: number; cz?: number }
  | { kind: 'cylinder'; r: number; h: number; cx?: number; cy?: number; cz?: number; axis?: SolidAxis }
  | { kind: 'sphere'; r: number; cx?: number; cy?: number; cz?: number };

export type SolidModel = {
  /** Unioned to form the part body (must be >= 1). */
  positives: SolidPrimitive[];
  /** Subtracted from the body (bores, holes, pockets). */
  negatives?: SolidPrimitive[];
  /** Drawing units, informational only (mm default). */
  units?: 'mm' | 'cm' | 'in';
};

// ─── AABB + nominal bounding box (the dimensional expectation) ───────────────

type Aabb = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };

function primitiveAabb(p: SolidPrimitive): Aabb {
  const cx = finite(p.cx), cy = finite(p.cy), cz = finite(p.cz);
  if (p.kind === 'box') {
    const hw = Math.abs(finite(p.w)) / 2, hd = Math.abs(finite(p.d)) / 2, hh = Math.abs(finite(p.h)) / 2;
    return { minX: cx - hw, maxX: cx + hw, minY: cy - hd, maxY: cy + hd, minZ: cz - hh, maxZ: cz + hh };
  }
  if (p.kind === 'sphere') {
    const r = Math.abs(finite(p.r));
    return { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r, minZ: cz - r, maxZ: cz + r };
  }
  // cylinder: radius spans the two axes orthogonal to its height axis.
  const r = Math.abs(finite(p.r)), hh = Math.abs(finite(p.h)) / 2;
  const axis = p.axis ?? 'z';
  const half = { x: axis === 'x' ? hh : r, y: axis === 'y' ? hh : r, z: axis === 'z' ? hh : r };
  return { minX: cx - half.x, maxX: cx + half.x, minY: cy - half.y, maxY: cy + half.y, minZ: cz - half.z, maxZ: cz + half.z };
}

/**
 * Nominal bounding box of the FINISHED part = union of the positives' AABBs.
 * Negatives never grow a part, so they are excluded — this is the box an
 * exported STL should measure, which is exactly what the live drill checks.
 */
export function nominalBoundingBox(model: SolidModel): Aabb | null {
  const ps = model.positives ?? [];
  if (!ps.length) return null;
  let box: Aabb | null = null;
  for (const p of ps) {
    const a = primitiveAabb(p);
    box = box
      ? {
          minX: Math.min(box.minX, a.minX), minY: Math.min(box.minY, a.minY), minZ: Math.min(box.minZ, a.minZ),
          maxX: Math.max(box.maxX, a.maxX), maxY: Math.max(box.maxY, a.maxY), maxZ: Math.max(box.maxZ, a.maxZ),
        }
      : a;
  }
  return box;
}

export type SolidModelSummary = {
  positiveCount: number;
  negativeCount: number;
  primitiveKinds: Record<string, number>;
  nominalBBox: Aabb | null;
  /** Nominal outer dimensions W×D×H (from the bbox), rounded. */
  dimensions: { w: number; d: number; h: number } | null;
};

export function summarizeSolidModel(model: SolidModel): SolidModelSummary {
  const kinds: Record<string, number> = {};
  for (const p of [...(model.positives ?? []), ...(model.negatives ?? [])]) {
    kinds[p.kind] = (kinds[p.kind] || 0) + 1;
  }
  const bbox = nominalBoundingBox(model);
  return {
    positiveCount: (model.positives ?? []).length,
    negativeCount: (model.negatives ?? []).length,
    primitiveKinds: kinds,
    nominalBBox: bbox,
    dimensions: bbox
      ? { w: Math.round((bbox.maxX - bbox.minX) * 1e3) / 1e3, d: Math.round((bbox.maxY - bbox.minY) * 1e3) / 1e3, h: Math.round((bbox.maxZ - bbox.minZ) * 1e3) / 1e3 }
      : null,
  };
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validatePrimitive(p: SolidPrimitive, where: string): string | null {
  if (p.kind === 'box') {
    if (!allFinite(finite(p.w), finite(p.d), finite(p.h)) || finite(p.w) <= 0 || finite(p.d) <= 0 || finite(p.h) <= 0) {
      return `${where}: box needs positive finite w/d/h`;
    }
  } else if (p.kind === 'cylinder') {
    if (finite(p.r) <= 0 || finite(p.h) <= 0) return `${where}: cylinder needs positive finite r/h`;
    if (p.axis && !['x', 'y', 'z'].includes(p.axis)) return `${where}: cylinder axis must be x/y/z`;
  } else if (p.kind === 'sphere') {
    if (finite(p.r) <= 0) return `${where}: sphere needs positive finite r`;
  } else {
    return `${where}: unknown primitive kind "${(p as any).kind}"`;
  }
  for (const c of [(p as any).cx, (p as any).cy, (p as any).cz]) {
    if (c !== undefined && !Number.isFinite(Number(c))) return `${where}: non-finite center coordinate`;
  }
  return null;
}

export function validateSolidModel(model: SolidModel): SolidResult<SolidModel> {
  if (!model || !Array.isArray(model.positives) || model.positives.length === 0) {
    return { ok: false, error: 'solid model requires at least one positive primitive' };
  }
  const total = model.positives.length + (model.negatives?.length ?? 0);
  if (total > 2000) return { ok: false, error: `solid model has ${total} primitives, exceeding the 2000 cap` };
  for (let i = 0; i < model.positives.length; i += 1) {
    const err = validatePrimitive(model.positives[i], `positive[${i}]`);
    if (err) return { ok: false, error: err };
  }
  for (let i = 0; i < (model.negatives?.length ?? 0); i += 1) {
    const err = validatePrimitive(model.negatives![i], `negative[${i}]`);
    if (err) return { ok: false, error: err };
  }
  return { ok: true, value: model };
}

// ─── Blender bpy emitter (the live-proven backend) ───────────────────────────

const BPY_HELPERS = `
def _reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def _box(w, d, h, cx, cy, cz):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(cx, cy, cz))
    o = bpy.context.active_object
    o.scale = (w, d, h)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o

def _cyl(r, h, cx, cy, cz, axis):
    rot = {'z': (0.0, 0.0, 0.0), 'x': (0.0, math.pi / 2.0, 0.0), 'y': (math.pi / 2.0, 0.0, 0.0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=h, location=(cx, cy, cz), rotation=rot, vertices=64)
    o = bpy.context.active_object
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return o

def _sphere(r, cx, cy, cz):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(cx, cy, cz), segments=48, ring_count=24)
    return bpy.context.active_object

def _boolean(base, tool, op):
    m = base.modifiers.new(name='ucbool', type='BOOLEAN')
    m.operation = op
    m.solver = 'EXACT'
    m.object = tool
    bpy.context.view_layer.objects.active = base
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(tool, do_unlink=True)
`;

function bpyMakePrimitive(p: SolidPrimitive, varName: string): string {
  const cx = fmt(finite(p.cx)), cy = fmt(finite(p.cy)), cz = fmt(finite(p.cz));
  if (p.kind === 'box') {
    return `${varName} = _box(${fmt(finite(p.w))}, ${fmt(finite(p.d))}, ${fmt(finite(p.h))}, ${cx}, ${cy}, ${cz})`;
  }
  if (p.kind === 'cylinder') {
    return `${varName} = _cyl(${fmt(finite(p.r))}, ${fmt(finite(p.h))}, ${cx}, ${cy}, ${cz}, ${pyStringLiteral(p.axis ?? 'z')})`;
  }
  return `${varName} = _sphere(${fmt(finite(p.r))}, ${cx}, ${cy}, ${cz})`;
}

/**
 * Emit a self-contained Blender bpy script that builds the model and exports
 * STL to `outputStlPath`. The output path is embedded as a safe Python literal
 * because the `cad_compile` blender argv is FIXED
 * (`--background --factory-startup --python <script>`) and passes no output
 * argument to the script — the script must know where to write.
 */
export function writeBlenderSolidScript(model: SolidModel, outputStlPath: string): SolidResult<string> {
  const valid = validateSolidModel(model);
  if (!valid.ok) return valid;
  if (typeof outputStlPath !== 'string' || !outputStlPath.trim()) {
    return { ok: false, error: 'outputStlPath is required' };
  }

  const lines: string[] = ['import bpy', 'import math', '', BPY_HELPERS.trim(), '', '_reset()', ''];
  const positives = model.positives;
  const negatives = model.negatives ?? [];

  // Build the first positive as the accumulator, union the rest into it.
  lines.push(bpyMakePrimitive(positives[0], 'part'));
  for (let i = 1; i < positives.length; i += 1) {
    lines.push(bpyMakePrimitive(positives[i], `p${i}`));
    lines.push(`_boolean(part, p${i}, 'UNION')`);
  }
  // Subtract every negative.
  for (let i = 0; i < negatives.length; i += 1) {
    lines.push(bpyMakePrimitive(negatives[i], `n${i}`));
    lines.push(`_boolean(part, n${i}, 'DIFFERENCE')`);
  }

  // Only `part` remains; export the whole scene as STL.
  lines.push('');
  lines.push(`OUT = ${pyStringLiteral(outputStlPath)}`);
  // Blender 4.x built-in exporter (matches cadCodeExecutor's blender lane).
  lines.push('bpy.ops.wm.stl_export(filepath=OUT)');
  lines.push('');
  return { ok: true, value: lines.join('\n') + '\n' };
}

// ─── OpenSCAD emitter (ready, un-proven locally) ─────────────────────────────

function scadPrimitive(p: SolidPrimitive): string {
  const cx = fmt(finite(p.cx)), cy = fmt(finite(p.cy)), cz = fmt(finite(p.cz));
  const at = (body: string) => `translate([${cx}, ${cy}, ${cz}]) ${body}`;
  if (p.kind === 'box') {
    return at(`cube([${fmt(finite(p.w))}, ${fmt(finite(p.d))}, ${fmt(finite(p.h))}], center = true);`);
  }
  if (p.kind === 'sphere') {
    return at(`sphere(r = ${fmt(finite(p.r))}, $fn = 48);`);
  }
  const axis = p.axis ?? 'z';
  const rot = axis === 'x' ? 'rotate([0, 90, 0]) ' : axis === 'y' ? 'rotate([90, 0, 0]) ' : '';
  return at(`${rot}cylinder(h = ${fmt(finite(p.h))}, r = ${fmt(finite(p.r))}, center = true, $fn = 64);`);
}

/** Emit OpenSCAD `.scad` for the same model: difference(){ union(){positives} negatives }. */
export function writeOpenScadSolid(model: SolidModel): SolidResult<string> {
  const valid = validateSolidModel(model);
  if (!valid.ok) return valid;
  const positives = model.positives.map(scadPrimitive);
  const negatives = (model.negatives ?? []).map(scadPrimitive);
  const body = negatives.length
    ? [
        'difference() {',
        '  union() {',
        ...positives.map((l) => `    ${l}`),
        '  }',
        ...negatives.map((l) => `  ${l}`),
        '}',
      ]
    : ['union() {', ...positives.map((l) => `  ${l}`), '}'];
  const header = `// Generated by Underground Circle engineeringSolidModelingCore.\n// Units: ${model.units ?? 'mm'}. Compile: desktop.cad_compile { engine: "openscad" }.\n`;
  return { ok: true, value: header + body.join('\n') + '\n' };
}

// ─── Part generators (the high-value shapes) ─────────────────────────────────

export type PlateHole = { x: number; y: number; diameter: number };

export type PlateSpec = {
  /** Outer plate size in the drawing units (mm default). */
  width: number;
  depth: number;
  thickness: number;
  /** Through-holes drilled along Z, positioned in the plate's XY (origin = plate center). */
  holes?: PlateHole[];
  units?: 'mm' | 'cm' | 'in';
};

/** A flat plate/block, centered on origin, with optional through-holes. */
export function buildPlateWithHoles(spec: PlateSpec): SolidResult<SolidModel> {
  const w = finite(spec.width), d = finite(spec.depth), t = finite(spec.thickness);
  if (w <= 0 || d <= 0 || t <= 0) return { ok: false, error: 'plate width/depth/thickness must be positive' };
  const positives: SolidPrimitive[] = [{ kind: 'box', w, d, h: t, cx: 0, cy: 0, cz: t / 2 }];
  const negatives: SolidPrimitive[] = [];
  for (const hole of spec.holes ?? []) {
    const dia = finite(hole.diameter);
    if (dia <= 0) continue;
    negatives.push({ kind: 'cylinder', r: dia / 2, h: t * 2 + 2, cx: finite(hole.x), cy: finite(hole.y), cz: t / 2, axis: 'z' });
  }
  return validateSolidModel({ positives, negatives, units: spec.units });
}

export type BracketSpec = {
  /** L-bracket: two legs meeting at the origin corner. */
  legX: number;
  legZ: number;
  width: number;
  thickness: number;
  units?: 'mm' | 'cm' | 'in';
  /** Optional through-holes on the horizontal leg (drilled along Z). */
  holes?: PlateHole[];
};

/** An L-bracket = a horizontal plate + a vertical plate sharing the corner. */
export function buildBracket(spec: BracketSpec): SolidResult<SolidModel> {
  const lx = finite(spec.legX), lz = finite(spec.legZ), w = finite(spec.width), t = finite(spec.thickness);
  if (lx <= 0 || lz <= 0 || w <= 0 || t <= 0) return { ok: false, error: 'bracket legX/legZ/width/thickness must be positive' };
  const positives: SolidPrimitive[] = [
    // Horizontal leg: lies in +X, thickness up from z=0.
    { kind: 'box', w: lx, d: w, h: t, cx: lx / 2, cy: 0, cz: t / 2 },
    // Vertical leg: rises in +Z at x≈0, thickness in +X.
    { kind: 'box', w: t, d: w, h: lz, cx: t / 2, cy: 0, cz: lz / 2 },
  ];
  const negatives: SolidPrimitive[] = [];
  for (const hole of spec.holes ?? []) {
    const dia = finite(hole.diameter);
    if (dia <= 0) continue;
    negatives.push({ kind: 'cylinder', r: dia / 2, h: t * 2 + 2, cx: finite(hole.x), cy: finite(hole.y), cz: t / 2, axis: 'z' });
  }
  return validateSolidModel({ positives, negatives, units: spec.units });
}

export type TubeSpec = {
  outerDiameter: number;
  innerDiameter: number;
  height: number;
  axis?: SolidAxis;
  units?: 'mm' | 'cm' | 'in';
};

/** A tube / washer / spacer = outer cylinder minus a concentric inner bore. */
export function buildTube(spec: TubeSpec): SolidResult<SolidModel> {
  const od = finite(spec.outerDiameter), id = finite(spec.innerDiameter), h = finite(spec.height);
  if (od <= 0 || h <= 0) return { ok: false, error: 'tube outerDiameter/height must be positive' };
  if (id < 0 || id >= od) return { ok: false, error: 'tube innerDiameter must be >= 0 and < outerDiameter' };
  const axis = spec.axis ?? 'z';
  const positives: SolidPrimitive[] = [{ kind: 'cylinder', r: od / 2, h, axis }];
  const negatives: SolidPrimitive[] = id > 0 ? [{ kind: 'cylinder', r: id / 2, h: h + 2, axis }] : [];
  return validateSolidModel({ positives, negatives, units: spec.units });
}

// ─── STL header parse (used by the live drill's verifier bridge) ─────────────

/**
 * Read a binary-STL triangle count from its header bytes (80-byte header +
 * uint32 count). Pure helper so the drill can sanity-check the count our side
 * expected vs what an independent reader extracts. Returns null on a too-short
 * or ASCII-STL buffer (Blender writes binary STL).
 */
export function readBinaryStlTriangleCount(bytes: Uint8Array): number | null {
  if (!bytes || bytes.length < 84) return null;
  // ASCII STL starts with "solid " — those have no header count.
  const head = String.fromCharCode(...bytes.slice(0, 6)).toLowerCase();
  if (head === 'solid ') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + 80, 4);
  return view.getUint32(0, true);
}
