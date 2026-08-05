/**
 * engineeringMeshInspectCore — a PURE mesh (binary-STL) inspection core. The
 * INPUT half of the engineering suite: it MEASURES a 3D part, where
 * engineeringSolidModelingCore GENERATES one. Symmetric partners — model_3d
 * builds, inspect_mesh measures — and each can verify the other.
 *
 * WHY THIS EXISTS
 * The generation cores answer "make me this part." The equally common real
 * question is "here is a part someone sent me — what ARE its dimensions,
 * volume, mass, and is it a valid closed solid I can print/machine?" The
 * existing text CAD inspector (cadFileInspector) is honest that it cannot do
 * this for binary STL: it reports triangle count from the file-size formula and
 * NULL for bounding box, because a real binary parse "this text inspector does
 * not attempt." This core is that binary parse.
 *
 * WHY THE VERIFICATION IS THE STRONGEST OF THE WHOLE SUITE
 * Mesh volume by the divergence theorem — V = (1/6)·|Σ v0·(v1×v2)| over all
 * triangles — is EXACT for a closed mesh, independent of shape. So this core
 * cross-verifies the GENERATORS: build a part whose analytical volume is known
 * in closed form (a plate is w·d·t minus Σπr²t for its holes), export it
 * through real Blender, measure the STL back here, and the two independent
 * computations must agree. Generation and inspection prove each other.
 *
 * Everything is pure and takes the STL BYTES (a Uint8Array) — file I/O stays in
 * the runtime/bridge. No imports, no Date.now(), no I/O, total functions.
 * Smoke: scripts/engineering-mesh-inspect-core-smoketest.ts.
 */

export type MeshResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type Vec3 = readonly [number, number, number];
export type Triangle = { v0: Vec3; v1: Vec3; v2: Vec3 };

/** Guard against a hostile/corrupt count claiming billions of triangles. */
export const MAX_STL_TRIANGLES = 2_000_000;

// ─── Binary STL parse ────────────────────────────────────────────────────────

/**
 * Parse a binary STL: 80-byte header, uint32 little-endian triangle count, then
 * per triangle 12 float32 LE (normal + 3 vertices) + 2 attribute bytes = 50.
 * ASCII STL (which Blender does not write) is rejected with a clear message.
 */
export function parseBinaryStl(bytes: Uint8Array): MeshResult<{ triangles: Triangle[]; declaredCount: number }> {
  if (!bytes || bytes.length < 84) return { ok: false, error: 'file too short to be a binary STL (need ≥ 84 bytes)' };

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredCount = view.getUint32(80, true);
  const expected = 84 + declaredCount * 50;

  // Primary binary signal is the exact length match. If it does not match and
  // the file looks like ASCII STL, say so specifically.
  if (bytes.length !== expected) {
    const head = String.fromCharCode(...bytes.slice(0, 6)).toLowerCase();
    if (head === 'solid ') {
      return { ok: false, error: 'this looks like ASCII STL; only binary STL is parsed here (re-export as binary STL)' };
    }
    return { ok: false, error: `binary STL length ${bytes.length} ≠ expected ${expected} for ${declaredCount} triangles (truncated or not a binary STL)` };
  }
  if (declaredCount > MAX_STL_TRIANGLES) {
    return { ok: false, error: `STL declares ${declaredCount} triangles, over the ${MAX_STL_TRIANGLES} cap` };
  }

  const triangles: Triangle[] = [];
  for (let i = 0; i < declaredCount; i += 1) {
    const off = 84 + i * 50;
    // Skip the normal (off..off+12); read the three vertices.
    const v0: Vec3 = [view.getFloat32(off + 12, true), view.getFloat32(off + 16, true), view.getFloat32(off + 20, true)];
    const v1: Vec3 = [view.getFloat32(off + 24, true), view.getFloat32(off + 28, true), view.getFloat32(off + 32, true)];
    const v2: Vec3 = [view.getFloat32(off + 36, true), view.getFloat32(off + 40, true), view.getFloat32(off + 44, true)];
    triangles.push({ v0, v1, v2 });
  }
  return { ok: true, value: { triangles, declaredCount } };
}

// ─── Vector helpers ──────────────────────────────────────────────────────────

function sub(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function mag(a: Vec3): number { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }

// ─── Geometry ────────────────────────────────────────────────────────────────

export type MeshBBox = { min: Vec3; max: Vec3; dims: { w: number; d: number; h: number } };

export function meshBoundingBox(tris: Triangle[]): MeshBBox | null {
  if (!tris.length) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of tris) {
    for (const v of [t.v0, t.v1, t.v2]) {
      minX = Math.min(minX, v[0]); maxX = Math.max(maxX, v[0]);
      minY = Math.min(minY, v[1]); maxY = Math.max(maxY, v[1]);
      minZ = Math.min(minZ, v[2]); maxZ = Math.max(maxZ, v[2]);
    }
  }
  const r3 = (n: number) => Math.round(n * 1e3) / 1e3;
  return {
    min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
    dims: { w: r3(maxX - minX), d: r3(maxY - minY), h: r3(maxZ - minZ) },
  };
}

/**
 * Enclosed volume (mm³) via the signed-tetrahedron / divergence-theorem sum.
 * Absolute value, so winding order does not matter. Exact for a closed mesh;
 * for an open mesh it returns a (meaningless) partial sum, which is why the
 * report always pairs volume with the watertight verdict.
 */
export function meshVolume(tris: Triangle[]): number {
  let sixV = 0;
  for (const t of tris) sixV += dot(t.v0, cross(t.v1, t.v2));
  return Math.abs(sixV) / 6;
}

/** Total surface area (mm²) = Σ ½·|(v1−v0)×(v2−v0)|. */
export function meshSurfaceArea(tris: Triangle[]): number {
  let area = 0;
  for (const t of tris) area += 0.5 * mag(cross(sub(t.v1, t.v0), sub(t.v2, t.v0)));
  return area;
}

/**
 * Watertight (closed 2-manifold) check. In a closed manifold, every edge is
 * shared by EXACTLY two triangles. STL does not weld vertices, so shared
 * vertices are matched by quantizing coordinates to `tolMm` (default 1 µm)
 * before keying — coincident points collapse to the same key. Returns the
 * verdict plus how many edges are non-manifold (open or over-shared).
 */
export function meshWatertight(tris: Triangle[], tolMm = 1e-3): { watertight: boolean; edgeCount: number; openEdges: number; nonManifoldEdges: number } {
  const q = (n: number) => Math.round(n / tolMm);
  const key = (v: Vec3) => `${q(v[0])},${q(v[1])},${q(v[2])}`;
  const edges = new Map<string, number>();
  const addEdge = (a: Vec3, b: Vec3) => {
    const ka = key(a), kb = key(b);
    const e = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; // undirected
    edges.set(e, (edges.get(e) || 0) + 1);
  };
  for (const t of tris) { addEdge(t.v0, t.v1); addEdge(t.v1, t.v2); addEdge(t.v2, t.v0); }
  let open = 0, nonManifold = 0;
  for (const count of edges.values()) {
    if (count < 2) open += 1;
    else if (count > 2) nonManifold += 1;
  }
  return { watertight: open === 0 && nonManifold === 0, edgeCount: edges.size, openEdges: open, nonManifoldEdges: nonManifold };
}

// ─── Full report + mass ──────────────────────────────────────────────────────

export type MeshInspection = {
  triangles: number;
  bbox: MeshBBox;
  volume_mm3: number;
  surfaceArea_mm2: number;
  watertight: boolean;
  openEdges: number;
  nonManifoldEdges: number;
  /** Present only for a watertight mesh — an open mesh's volume is unreliable. */
  volumeReliable: boolean;
};

export function inspectMesh(bytes: Uint8Array): MeshResult<MeshInspection> {
  const parsed = parseBinaryStl(bytes);
  if (!parsed.ok) return parsed;
  const tris = parsed.value.triangles;
  const bbox = meshBoundingBox(tris);
  if (!bbox) return { ok: false, error: 'mesh has no triangles' };
  const wt = meshWatertight(tris);
  const r3 = (n: number) => Math.round(n * 1e3) / 1e3;
  return {
    ok: true,
    value: {
      triangles: tris.length,
      bbox,
      volume_mm3: r3(meshVolume(tris)),
      surfaceArea_mm2: r3(meshSurfaceArea(tris)),
      watertight: wt.watertight,
      openEdges: wt.openEdges,
      nonManifoldEdges: wt.nonManifoldEdges,
      volumeReliable: wt.watertight,
    },
  };
}

/**
 * Mass (kg) from a volume and a material density (kg/mm³, as in the calc core's
 * MATERIALS table). Composes the two engineering cores: measure a part's
 * volume, then weigh it in any material.
 */
export function massFromVolume(volume_mm3: number, density_kg_per_mm3: number): MeshResult<{ mass_kg: number; volume_mm3: number; density: number }> {
  if (!Number.isFinite(volume_mm3) || volume_mm3 < 0) return { ok: false, error: 'volume must be a non-negative finite number (mm³)' };
  if (!Number.isFinite(density_kg_per_mm3) || density_kg_per_mm3 <= 0) return { ok: false, error: 'density must be a positive finite number (kg/mm³)' };
  return { ok: true, value: { mass_kg: Math.round(volume_mm3 * density_kg_per_mm3 * 1e6) / 1e6, volume_mm3, density: density_kg_per_mm3 } };
}

// ─── Binary-STL WRITER (test fixtures + round-trip) ──────────────────────────

/**
 * Serialize triangles to a binary STL Uint8Array. Not needed at runtime (the
 * generators emit bpy/scad, not STL), but it lets the smoke build a known mesh
 * — a unit cube of exactly 1000 mm³ — and round-trip it through the parser, so
 * the volume/area/watertight math is checked against a hand-computed truth with
 * no Blender in the loop.
 */
export function writeBinaryStl(tris: Triangle[]): Uint8Array {
  const buf = new Uint8Array(84 + tris.length * 50);
  const view = new DataView(buf.buffer);
  view.setUint32(80, tris.length, true);
  tris.forEach((t, i) => {
    const off = 84 + i * 50;
    const n = cross(sub(t.v1, t.v0), sub(t.v2, t.v0));
    const m = mag(n) || 1;
    const nn: Vec3 = [n[0] / m, n[1] / m, n[2] / m];
    const write = (o: number, v: Vec3) => { view.setFloat32(o, v[0], true); view.setFloat32(o + 4, v[1], true); view.setFloat32(o + 8, v[2], true); };
    write(off, nn); write(off + 12, t.v0); write(off + 24, t.v1); write(off + 36, t.v2);
  });
  return buf;
}

/** A closed 12-triangle box mesh from a min corner + size (test helper). */
export function boxMesh(x: number, y: number, z: number, w: number, d: number, h: number): Triangle[] {
  const p: Vec3[] = [
    [x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z], // bottom 0-3
    [x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h], // top 4-7
  ];
  const quad = (a: number, b: number, c: number, e: number): Triangle[] => [
    { v0: p[a], v1: p[b], v2: p[c] }, { v0: p[a], v1: p[c], v2: p[e] },
  ];
  return [
    ...quad(0, 3, 2, 1), // bottom (−Z)
    ...quad(4, 5, 6, 7), // top (+Z)
    ...quad(0, 1, 5, 4), // −Y
    ...quad(2, 3, 7, 6), // +Y
    ...quad(1, 2, 6, 5), // +X
    ...quad(3, 0, 4, 7), // −X
  ];
}
