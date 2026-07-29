/**
 * engineeringDraftingCore — a PURE, engine-neutral CAD drafting core.
 *
 * WHY THIS EXISTS
 * The five AutoCAD "core capabilities" an engineer asked for — 2D drafting, 3D
 * modeling, layer management, specialized symbol toolsets, and
 * automation/blocks — are, underneath the app, just structured geometry on
 * named layers. This module produces that geometry as **DXF R12 ASCII**, the
 * one interchange format every serious CAD tool imports: AutoCAD directly,
 * FreeCAD through the already-shipped `desktop.cad_compile` lane, LibreCAD,
 * QCAD, even Illustrator. So an engineer can get a real, dimensioned,
 * layer-organized drawing produced and VERIFIED today — with zero AutoCAD
 * install — and the exact same neutral model recompiles into AutoCAD `.scr`
 * commands (autocadScriptAdapter) the day a licensed install exists.
 *
 * Capability coverage, each a generator over the same primitives:
 *   - 2D drafting          → line/circle/arc/polyline/text primitives
 *   - layer management     → every entity carries a validated layer; the DXF
 *                            LAYER table declares them with color/linetype
 *   - specialized toolsets → electrical schematic symbols as reusable BLOCKs
 *   - automation & blocks  → BLOCK definitions + INSERT with scale/rotation,
 *                            plus insertGrid() for repeat-placement
 *   - 3D modeling          → a headed-off honest boundary (see MODELING NOTE):
 *                            R12 is a 2D-first format; solids belong to the
 *                            OpenSCAD/FreeCAD lane, and this core POINTS there
 *                            rather than emitting fake 3DFACE soup.
 *
 * MODELING NOTE. True parametric 3D solids (extrude/revolve/boolean) are the
 * OpenSCAD/Blender/FreeCAD lane's job — cadCodeExecutor already owns it. This
 * module deliberately does NOT fake solids in DXF; `suggestModelingLane()`
 * routes a 3D request to the engine that can actually build and render it.
 *
 * SECURITY BAR — DXF IS A TAGGED LINE FORMAT.
 * A DXF file is pairs of lines: a numeric group code, then its value, each
 * newline-terminated. So a newline inside a user-supplied value (a layer name,
 * a text label, a block name) is NOT a benign string — it terminates the
 * current value and the next line becomes a group code. That is ENTITY
 * INJECTION, the DXF analogue of the `.scr` newline-is-Enter bar in
 * autocadScriptAdapter. This module therefore validates every layer/block name
 * against a strict allowlist and strips control characters (including CR/LF and
 * the ES2028/2029 separators) from all text before it is ever emitted.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-drafting-core-smoketest.ts):
 * no imports, no Date.now(), no I/O, total functions.
 */

// ─── Names, text, numbers ────────────────────────────────────────────────────

/** DXF layer/block names: AutoCAD's own bar is letters/digits/`_-$`, <=31 chars. */
export const DXF_NAME_PATTERN = /^[A-Za-z0-9_$-]{1,31}$/;

export const MAX_TEXT_CHARS = 250;
export const MAX_ENTITIES = 20_000;

export type DraftResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateDxfName(value: unknown, kind = 'name'): DraftResult<string> {
  if (typeof value !== 'string') return { ok: false, error: `${kind} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: `${kind} is required` };
  if (!DXF_NAME_PATTERN.test(trimmed)) {
    return { ok: false, error: `${kind} "${trimmed.slice(0, 24)}" must match [A-Za-z0-9_$-], 1-31 chars (DXF entity-injection bar)` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Sanitize a free-text value for a TEXT/label entity. Never rejects on
 * content — drawings legitimately contain punctuation — but strips every
 * control character (CR, LF, tab, NUL, and U+2028/U+2029) so a value can never
 * break out of its DXF group line, and bounds the length.
 */
export function sanitizeDxfText(value: unknown): string {
  const raw = value === undefined || value === null ? '' : String(value);
  // eslint-disable-next-line no-control-regex
  const stripped = raw.replace(/[\x00-\x1f\x7f\u2028\u2029]/g, ' ').trim();
  return stripped.length > MAX_TEXT_CHARS ? stripped.slice(0, MAX_TEXT_CHARS) : stripped;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** DXF reals are locale-independent with a plain '.'; bound the precision. */
function real(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  // 6 decimals is well within R12 tolerance and keeps files compact.
  return (Math.round(v * 1e6) / 1e6).toString();
}

// ─── Neutral entity model (shared with autocadScriptAdapter) ─────────────────

export type DraftPoint = { x: number; y: number };

export type DraftEntity =
  | { kind: 'line'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; layer: string; cx: number; cy: number; r: number }
  | { kind: 'arc'; layer: string; cx: number; cy: number; r: number; startDeg: number; endDeg: number }
  | { kind: 'polyline'; layer: string; points: DraftPoint[]; closed?: boolean }
  | { kind: 'text'; layer: string; x: number; y: number; height: number; text: string; rotationDeg?: number }
  | { kind: 'insert'; layer: string; blockName: string; x: number; y: number; scale?: number; rotationDeg?: number };

export type DraftLayer = {
  name: string;
  /** DXF ACI color index 1-255 (1=red 2=yellow 3=green 4=cyan 5=blue 6=magenta 7=white). */
  color?: number;
  /** Linetype name declared in LTYPE table; defaults to CONTINUOUS. */
  linetype?: string;
};

export type DraftBlock = {
  name: string;
  /** Entities are defined in the block's own local coordinates (base point 0,0). */
  entities: DraftEntity[];
};

export type DraftDocument = {
  layers: DraftLayer[];
  blocks: DraftBlock[];
  entities: DraftEntity[];
};

const DEFAULT_LINETYPES = ['CONTINUOUS', 'DASHED', 'CENTER', 'HIDDEN'] as const;

// ─── DXF R12 writer ──────────────────────────────────────────────────────────

/** One group-code/value pair — the atomic DXF unit. */
function tag(code: number, value: string | number): string {
  return `${code}\n${value}`;
}

function entityCommon(kind: string, layer: string): string[] {
  return [tag(0, kind), tag(8, layer)];
}

function writeEntity(e: DraftEntity): string[] {
  switch (e.kind) {
    case 'line':
      return [
        ...entityCommon('LINE', e.layer),
        tag(10, real(e.x1)), tag(20, real(e.y1)), tag(30, '0.0'),
        tag(11, real(e.x2)), tag(21, real(e.y2)), tag(31, '0.0'),
      ];
    case 'circle':
      return [
        ...entityCommon('CIRCLE', e.layer),
        tag(10, real(e.cx)), tag(20, real(e.cy)), tag(30, '0.0'),
        tag(40, real(e.r)),
      ];
    case 'arc':
      return [
        ...entityCommon('ARC', e.layer),
        tag(10, real(e.cx)), tag(20, real(e.cy)), tag(30, '0.0'),
        tag(40, real(e.r)),
        tag(50, real(e.startDeg)), tag(51, real(e.endDeg)),
      ];
    case 'polyline': {
      const out = [
        ...entityCommon('POLYLINE', e.layer),
        tag(66, 1), // vertices-follow flag
        tag(10, '0.0'), tag(20, '0.0'), tag(30, '0.0'),
        tag(70, e.closed ? 1 : 0),
      ];
      for (const p of e.points) {
        out.push(...entityCommon('VERTEX', e.layer), tag(10, real(p.x)), tag(20, real(p.y)), tag(30, '0.0'));
      }
      out.push(tag(0, 'SEQEND'), tag(8, e.layer));
      return out;
    }
    case 'text':
      return [
        ...entityCommon('TEXT', e.layer),
        tag(10, real(e.x)), tag(20, real(e.y)), tag(30, '0.0'),
        tag(40, real(e.height)),
        tag(1, sanitizeDxfText(e.text)),
        tag(50, real(e.rotationDeg ?? 0)),
      ];
    case 'insert':
      return [
        ...entityCommon('INSERT', e.layer),
        tag(2, e.blockName),
        tag(10, real(e.x)), tag(20, real(e.y)), tag(30, '0.0'),
        tag(41, real(e.scale ?? 1)), tag(42, real(e.scale ?? 1)), tag(43, real(e.scale ?? 1)),
        tag(50, real(e.rotationDeg ?? 0)),
      ];
    default:
      return [];
  }
}

/**
 * Serialize a neutral document to DXF R12 ASCII. Validates every layer/block
 * name and entity layer reference; returns the injection-bar failure rather
 * than emitting an unsafe file.
 */
export function writeDxfR12(doc: DraftDocument): DraftResult<string> {
  const layerNames = new Set<string>();
  for (const layer of doc.layers) {
    const v = validateDxfName(layer.name, 'layer name');
    if (!v.ok) return v;
    layerNames.add(v.value);
  }
  // Layer 0 always exists in DXF.
  layerNames.add('0');

  const blockNames = new Set<string>();
  for (const block of doc.blocks) {
    const v = validateDxfName(block.name, 'block name');
    if (!v.ok) return v;
    blockNames.add(v.value);
  }

  const totalEntities = doc.entities.length
    + doc.blocks.reduce((sum, b) => sum + b.entities.length, 0);
  if (totalEntities > MAX_ENTITIES) {
    return { ok: false, error: `drawing has ${totalEntities} entities, exceeding the ${MAX_ENTITIES} cap` };
  }

  // Every entity's layer must have been declared, and an INSERT's block must
  // exist — a dangling reference is a silently-broken drawing.
  const checkEntity = (e: DraftEntity): string | null => {
    const ln = validateDxfName(e.layer, 'entity layer');
    if (!ln.ok) return ln.error;
    if (!layerNames.has(ln.value)) return `entity references undeclared layer "${e.layer}"`;
    if (e.kind === 'insert') {
      const bn = validateDxfName(e.blockName, 'insert block');
      if (!bn.ok) return bn.error;
      if (!blockNames.has(bn.value)) return `INSERT references undefined block "${e.blockName}"`;
    }
    return null;
  };
  for (const e of doc.entities) { const err = checkEntity(e); if (err) return { ok: false, error: err }; }
  for (const b of doc.blocks) for (const e of b.entities) { const err = checkEntity(e); if (err) return { ok: false, error: err }; }

  const lines: string[] = [];

  // HEADER — declare R12.
  lines.push(tag(0, 'SECTION'), tag(2, 'HEADER'), tag(9, '$ACADVER'), tag(1, 'AC1009'), tag(0, 'ENDSEC'));

  // TABLES — LTYPE then LAYER.
  lines.push(tag(0, 'SECTION'), tag(2, 'TABLES'));
  lines.push(tag(0, 'TABLE'), tag(2, 'LTYPE'), tag(70, DEFAULT_LINETYPES.length));
  for (const lt of DEFAULT_LINETYPES) {
    lines.push(tag(0, 'LTYPE'), tag(2, lt), tag(70, 0), tag(3, `${lt} linetype`), tag(72, 65), tag(73, 0), tag(40, '0.0'));
  }
  lines.push(tag(0, 'ENDTAB'));
  const declaredLayers = [{ name: '0', color: 7, linetype: 'CONTINUOUS' } as DraftLayer, ...doc.layers];
  lines.push(tag(0, 'TABLE'), tag(2, 'LAYER'), tag(70, declaredLayers.length));
  for (const layer of declaredLayers) {
    const lt = layer.linetype && DEFAULT_LINETYPES.includes(layer.linetype as any) ? layer.linetype : 'CONTINUOUS';
    const color = Number.isFinite(layer.color) ? Math.max(1, Math.min(255, Math.trunc(layer.color as number))) : 7;
    lines.push(tag(0, 'LAYER'), tag(2, layer.name), tag(70, 0), tag(62, color), tag(6, lt));
  }
  lines.push(tag(0, 'ENDTAB'), tag(0, 'ENDSEC'));

  // BLOCKS.
  lines.push(tag(0, 'SECTION'), tag(2, 'BLOCKS'));
  for (const block of doc.blocks) {
    lines.push(tag(0, 'BLOCK'), tag(8, '0'), tag(2, block.name), tag(70, 0), tag(10, '0.0'), tag(20, '0.0'), tag(30, '0.0'), tag(3, block.name));
    for (const e of block.entities) lines.push(...writeEntity(e));
    lines.push(tag(0, 'ENDBLK'), tag(8, '0'));
  }
  lines.push(tag(0, 'ENDSEC'));

  // ENTITIES.
  lines.push(tag(0, 'SECTION'), tag(2, 'ENTITIES'));
  for (const e of doc.entities) lines.push(...writeEntity(e));
  lines.push(tag(0, 'ENDSEC'));

  lines.push(tag(0, 'EOF'));
  return { ok: true, value: lines.join('\n') + '\n' };
}

// ─── Verification parser ─────────────────────────────────────────────────────

export type DxfParseSummary = {
  acadVersion: string | null;
  layers: string[];
  blocks: string[];
  /** Entity type → count, over the ENTITIES section (not block-internal). */
  entityCounts: Record<string, number>;
  /** Entity count per layer, over the ENTITIES section. */
  entitiesByLayer: Record<string, number>;
  insertsByBlock: Record<string, number>;
  totalEntities: number;
  /** Bounding box over LINE/CIRCLE/ARC/POLYLINE/INSERT/TEXT positions. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
  sectionsBalanced: boolean;
  hasEof: boolean;
};

/**
 * Parse a DXF for VERIFICATION — not a full loader. Reads the group/value line
 * pairs and reports what an agent needs to confirm a drawing matches intent:
 * declared layers, block definitions, per-type/per-layer entity counts, and a
 * bounding box. This is the drafting analogue of the accessibility-diff
 * verifier: proof that the intended geometry is actually present.
 */
export function parseDxfForVerification(dxf: string): DxfParseSummary {
  const rawLines = String(dxf ?? '').split('\n');
  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < rawLines.length; i += 2) {
    const code = Number(rawLines[i].trim());
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: rawLines[i + 1] ?? '' });
  }

  const summary: DxfParseSummary = {
    acadVersion: null,
    layers: [],
    blocks: [],
    entityCounts: {},
    entitiesByLayer: {},
    insertsByBlock: {},
    totalEntities: 0,
    bbox: null,
    sectionsBalanced: false,
    hasEof: false,
  };

  let section: string | null = null;
  let inTable: string | null = null;
  let sectionDepth = 0;
  let endsecCount = 0;
  const layerSet = new Set<string>();
  const blockSet = new Set<string>();

  // Entity-tracking state for the ENTITIES section.
  let curType: string | null = null;
  let curLayer = '0';
  let curBlock: string | null = null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const seenX = (x: number) => { if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); } };
  const seenY = (y: number) => { if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); } };

  const flushEntity = () => {
    if (!curType || section !== 'ENTITIES') { curType = null; curBlock = null; return; }
    if (curType === 'VERTEX' || curType === 'SEQEND') { curType = null; return; } // counted within POLYLINE
    summary.entityCounts[curType] = (summary.entityCounts[curType] || 0) + 1;
    summary.entitiesByLayer[curLayer] = (summary.entitiesByLayer[curLayer] || 0) + 1;
    summary.totalEntities += 1;
    if (curType === 'INSERT' && curBlock) summary.insertsByBlock[curBlock] = (summary.insertsByBlock[curBlock] || 0) + 1;
    curType = null; curBlock = null;
  };

  for (let i = 0; i < pairs.length; i += 1) {
    const { code, value } = pairs[i];
    const v = value.trim();

    if (code === 0) {
      flushEntity();
      if (v === 'SECTION') { section = null; sectionDepth += 1; }
      else if (v === 'ENDSEC') { section = null; inTable = null; endsecCount += 1; }
      else if (v === 'EOF') summary.hasEof = true;
      else if (v === 'TABLE') inTable = null;
      else if (v === 'ENDTAB') inTable = null;
      else if (v === 'LAYER' && section === 'TABLES') inTable = 'LAYER';
      else if (v === 'BLOCK' && section === 'BLOCKS') curBlock = null;
      else if (section === 'ENTITIES') { curType = v; curLayer = '0'; curBlock = null; }
      continue;
    }

    // Section name follows its SECTION 0-tag as a 2-code.
    if (code === 2 && section === null && sectionDepth > 0 && !inTable) {
      if (['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES'].includes(v)) { section = v; continue; }
    }
    if (code === 9 && v === '$ACADVER') { /* value is next 1-tag */ }
    if (code === 1 && section === 'HEADER' && summary.acadVersion === null && /^AC\d/.test(v)) summary.acadVersion = v;

    if (inTable === 'LAYER' && code === 2 && v) layerSet.add(v);
    if (section === 'BLOCKS' && code === 2 && v) blockSet.add(v);

    if (section === 'ENTITIES' && curType) {
      if (code === 8) curLayer = v || '0';
      if (curType === 'INSERT' && code === 2) curBlock = v;
      if (code === 10) seenX(num(v));
      if (code === 20) seenY(num(v));
      if (code === 11) seenX(num(v));
      if (code === 21) seenY(num(v));
    }
  }
  flushEntity();

  summary.layers = Array.from(layerSet);
  summary.blocks = Array.from(blockSet);
  summary.sectionsBalanced = sectionDepth === endsecCount && sectionDepth > 0;
  summary.bbox = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
  return summary;
}

// ─── Layer palette shared by the generators ──────────────────────────────────

export const ARCHITECTURAL_LAYERS: DraftLayer[] = [
  { name: 'WALLS', color: 7, linetype: 'CONTINUOUS' },
  { name: 'DOORS', color: 4, linetype: 'CONTINUOUS' },
  { name: 'WINDOWS', color: 5, linetype: 'CONTINUOUS' },
  { name: 'DIMS', color: 2, linetype: 'CONTINUOUS' },
  { name: 'TEXT', color: 3, linetype: 'CONTINUOUS' },
];

// ─── Generator 1: parametric floor plan (2D drafting + layers + blocks) ──────

export type FloorPlanRoom = {
  name?: string;
  /** Bottom-left corner + size, in millimetres (drawing units = mm). */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type FloorPlanSpec = {
  /** Overall building envelope in mm. */
  width: number;
  height: number;
  /** Wall thickness in mm (default 150). */
  wallThickness?: number;
  /** Interior rooms (drawn as inner wall rectangles). */
  rooms?: FloorPlanRoom[];
  /** Doors: a gap + swing arc block on a named wall-relative position. */
  doors?: Array<{ x: number; y: number; width?: number; rotationDeg?: number }>;
  windows?: Array<{ x: number; y: number; width?: number; rotationDeg?: number }>;
  /** Dimension labels ("12000" etc.) placed as TEXT on the DIMS layer. */
  dimensions?: boolean;
};

function rectPolyline(layer: string, x: number, y: number, w: number, h: number): DraftEntity {
  return { kind: 'polyline', layer, closed: true, points: [
    { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
  ] };
}

/** Door block: a leaf line + a quarter-circle swing arc, in local coords. */
function doorBlock(width: number): DraftBlock {
  return { name: 'DOOR', entities: [
    { kind: 'line', layer: 'DOORS', x1: 0, y1: 0, x2: width, y2: 0 },
    { kind: 'line', layer: 'DOORS', x1: 0, y1: 0, x2: 0, y2: width },
    { kind: 'arc', layer: 'DOORS', cx: 0, cy: 0, r: width, startDeg: 0, endDeg: 90 },
  ] };
}

function windowBlock(width: number): DraftBlock {
  return { name: 'WINDOW', entities: [
    { kind: 'line', layer: 'WINDOWS', x1: 0, y1: 0, x2: width, y2: 0 },
    { kind: 'line', layer: 'WINDOWS', x1: 0, y1: width / 3, x2: width, y2: width / 3 },
  ] };
}

/**
 * Build a dimensioned, layer-organized floor plan as a neutral document.
 * Exercises 2D drafting, layer management, and block automation at once.
 */
export function buildFloorPlan(spec: FloorPlanSpec): DraftResult<DraftDocument> {
  const width = num(spec.width);
  const height = num(spec.height);
  if (width <= 0 || height <= 0) return { ok: false, error: 'floor plan width and height must be positive (mm)' };
  const t = spec.wallThickness && spec.wallThickness > 0 ? num(spec.wallThickness) : 150;
  const doorWidth = 900;
  const windowWidth = 1200;

  const entities: DraftEntity[] = [];

  // Outer wall = two concentric rectangles (outer envelope + inner face).
  entities.push(rectPolyline('WALLS', 0, 0, width, height));
  entities.push(rectPolyline('WALLS', t, t, width - 2 * t, height - 2 * t));

  // Interior rooms as inner rectangles.
  for (const room of spec.rooms ?? []) {
    const rx = num(room.x), ry = num(room.y), rw = num(room.width), rh = num(room.height);
    if (rw > 0 && rh > 0) {
      entities.push(rectPolyline('WALLS', rx, ry, rw, rh));
      if (room.name) {
        entities.push({ kind: 'text', layer: 'TEXT', x: rx + rw / 2, y: ry + rh / 2, height: Math.min(400, rh / 4), text: sanitizeDxfText(room.name) });
      }
    }
  }

  // Doors and windows as INSERTs of their blocks.
  const blocks: DraftBlock[] = [];
  if ((spec.doors ?? []).length) blocks.push(doorBlock(doorWidth));
  if ((spec.windows ?? []).length) blocks.push(windowBlock(windowWidth));
  for (const d of spec.doors ?? []) {
    entities.push({ kind: 'insert', layer: 'DOORS', blockName: 'DOOR', x: num(d.x), y: num(d.y), scale: d.width && d.width > 0 ? num(d.width) / doorWidth : 1, rotationDeg: num(d.rotationDeg) });
  }
  for (const w of spec.windows ?? []) {
    entities.push({ kind: 'insert', layer: 'WINDOWS', blockName: 'WINDOW', x: num(w.x), y: num(w.y), scale: w.width && w.width > 0 ? num(w.width) / windowWidth : 1, rotationDeg: num(w.rotationDeg) });
  }

  // Overall dimension labels on the DIMS layer.
  if (spec.dimensions !== false) {
    const dimOffset = Math.max(300, Math.min(width, height) * 0.05);
    entities.push({ kind: 'line', layer: 'DIMS', x1: 0, y1: -dimOffset, x2: width, y2: -dimOffset });
    entities.push({ kind: 'text', layer: 'DIMS', x: width / 2, y: -dimOffset - 250, height: 250, text: `${Math.round(width)}` });
    entities.push({ kind: 'line', layer: 'DIMS', x1: -dimOffset, y1: 0, x2: -dimOffset, y2: height });
    entities.push({ kind: 'text', layer: 'DIMS', x: -dimOffset - 250, y: height / 2, height: 250, text: `${Math.round(height)}`, rotationDeg: 90 });
  }

  return { ok: true, value: { layers: ARCHITECTURAL_LAYERS, blocks, entities } };
}

// ─── Generator 2: electrical schematic symbols (specialized toolset) ─────────

export const ELECTRICAL_LAYERS: DraftLayer[] = [
  { name: 'WIRES', color: 7, linetype: 'CONTINUOUS' },
  { name: 'SYMBOLS', color: 5, linetype: 'CONTINUOUS' },
  { name: 'LABELS', color: 3, linetype: 'CONTINUOUS' },
];

export type ElectricalSymbol = 'resistor' | 'capacitor' | 'battery' | 'ground' | 'switch' | 'lamp' | 'junction';

export const ELECTRICAL_SYMBOLS: readonly ElectricalSymbol[] = ['resistor', 'capacitor', 'battery', 'ground', 'switch', 'lamp', 'junction'];

/** Each symbol is a BLOCK in a nominal 10-unit cell, local origin at its left lead. */
function electricalSymbolBlock(symbol: ElectricalSymbol): DraftBlock {
  const S = 'SYMBOLS';
  switch (symbol) {
    case 'resistor':
      return { name: 'SYM_RESISTOR', entities: [
        { kind: 'line', layer: S, x1: 0, y1: 0, x2: 2, y2: 0 },
        { kind: 'polyline', layer: S, points: [
          { x: 2, y: 0 }, { x: 3, y: 2 }, { x: 4, y: -2 }, { x: 5, y: 2 }, { x: 6, y: -2 }, { x: 7, y: 2 }, { x: 8, y: 0 },
        ] },
        { kind: 'line', layer: S, x1: 8, y1: 0, x2: 10, y2: 0 },
      ] };
    case 'capacitor':
      return { name: 'SYM_CAPACITOR', entities: [
        { kind: 'line', layer: S, x1: 0, y1: 0, x2: 4.5, y2: 0 },
        { kind: 'line', layer: S, x1: 4.5, y1: -3, x2: 4.5, y2: 3 },
        { kind: 'line', layer: S, x1: 5.5, y1: -3, x2: 5.5, y2: 3 },
        { kind: 'line', layer: S, x1: 5.5, y1: 0, x2: 10, y2: 0 },
      ] };
    case 'battery':
      return { name: 'SYM_BATTERY', entities: [
        { kind: 'line', layer: S, x1: 0, y1: 0, x2: 4, y2: 0 },
        { kind: 'line', layer: S, x1: 4, y1: -4, x2: 4, y2: 4 },
        { kind: 'line', layer: S, x1: 5, y1: -2, x2: 5, y2: 2 },
        { kind: 'line', layer: S, x1: 5, y1: 0, x2: 10, y2: 0 },
      ] };
    case 'ground':
      return { name: 'SYM_GROUND', entities: [
        { kind: 'line', layer: S, x1: 5, y1: 10, x2: 5, y2: 3 },
        { kind: 'line', layer: S, x1: 1, y1: 3, x2: 9, y2: 3 },
        { kind: 'line', layer: S, x1: 2.5, y1: 1.5, x2: 7.5, y2: 1.5 },
        { kind: 'line', layer: S, x1: 4, y1: 0, x2: 6, y2: 0 },
      ] };
    case 'switch':
      return { name: 'SYM_SWITCH', entities: [
        { kind: 'line', layer: S, x1: 0, y1: 0, x2: 3, y2: 0 },
        { kind: 'line', layer: S, x1: 3, y1: 0, x2: 7, y2: 3 },
        { kind: 'circle', layer: S, cx: 3, cy: 0, r: 0.4 },
        { kind: 'circle', layer: S, cx: 7, cy: 0, r: 0.4 },
        { kind: 'line', layer: S, x1: 7, y1: 0, x2: 10, y2: 0 },
      ] };
    case 'lamp':
      return { name: 'SYM_LAMP', entities: [
        { kind: 'line', layer: S, x1: 0, y1: 0, x2: 2, y2: 0 },
        { kind: 'circle', layer: S, cx: 5, cy: 0, r: 3 },
        { kind: 'line', layer: S, x1: 3, y1: -2, x2: 7, y2: 2 },
        { kind: 'line', layer: S, x1: 3, y1: 2, x2: 7, y2: -2 },
        { kind: 'line', layer: S, x1: 8, y1: 0, x2: 10, y2: 0 },
      ] };
    case 'junction':
      return { name: 'SYM_JUNCTION', entities: [
        { kind: 'circle', layer: S, cx: 5, cy: 0, r: 0.6 },
      ] };
    default:
      return { name: 'SYM_UNKNOWN', entities: [] };
  }
}

export type SchematicPlacement = { symbol: ElectricalSymbol; x: number; y: number; rotationDeg?: number; label?: string };
export type SchematicWire = { x1: number; y1: number; x2: number; y2: number };

export type SchematicSpec = {
  placements: SchematicPlacement[];
  wires?: SchematicWire[];
};

const SYMBOL_BLOCK_NAME: Record<ElectricalSymbol, string> = {
  resistor: 'SYM_RESISTOR', capacitor: 'SYM_CAPACITOR', battery: 'SYM_BATTERY',
  ground: 'SYM_GROUND', switch: 'SYM_SWITCH', lamp: 'SYM_LAMP', junction: 'SYM_JUNCTION',
};

/** Build an electrical schematic: symbol BLOCKs, INSERTs, wires, and labels. */
export function buildElectricalSchematic(spec: SchematicSpec): DraftResult<DraftDocument> {
  const placements = Array.isArray(spec.placements) ? spec.placements : [];
  if (!placements.length) return { ok: false, error: 'schematic requires at least one symbol placement' };

  // Define each block kind once, only for the symbols actually used.
  const usedSymbols = new Set<ElectricalSymbol>();
  for (const p of placements) {
    if (!ELECTRICAL_SYMBOLS.includes(p.symbol)) return { ok: false, error: `unknown electrical symbol "${p.symbol}"` };
    usedSymbols.add(p.symbol);
  }
  const blocks = Array.from(usedSymbols).map(electricalSymbolBlock);

  const entities: DraftEntity[] = [];
  for (const w of spec.wires ?? []) {
    entities.push({ kind: 'line', layer: 'WIRES', x1: num(w.x1), y1: num(w.y1), x2: num(w.x2), y2: num(w.y2) });
  }
  for (const p of placements) {
    entities.push({ kind: 'insert', layer: 'SYMBOLS', blockName: SYMBOL_BLOCK_NAME[p.symbol], x: num(p.x), y: num(p.y), rotationDeg: num(p.rotationDeg) });
    if (p.label) {
      entities.push({ kind: 'text', layer: 'LABELS', x: num(p.x) + 2, y: num(p.y) + 4, height: 2.5, text: sanitizeDxfText(p.label) });
    }
  }

  return { ok: true, value: { layers: ELECTRICAL_LAYERS, blocks, entities } };
}

// ─── Automation: repeat-placement of a block on a grid ───────────────────────

export type InsertGridSpec = {
  blockName: string;
  layer: string;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  spacingX: number;
  spacingY: number;
  scale?: number;
  rotationDeg?: number;
};

/** Generate INSERT entities on a regular grid — the "repeat a task" automation. */
export function insertGrid(spec: InsertGridSpec): DraftResult<DraftEntity[]> {
  const bn = validateDxfName(spec.blockName, 'block name');
  if (!bn.ok) return bn;
  const ln = validateDxfName(spec.layer, 'layer name');
  if (!ln.ok) return ln;
  const cols = Math.max(0, Math.trunc(num(spec.cols)));
  const rows = Math.max(0, Math.trunc(num(spec.rows)));
  if (cols * rows > MAX_ENTITIES) return { ok: false, error: `grid ${cols}×${rows} exceeds the ${MAX_ENTITIES} entity cap` };
  const out: DraftEntity[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push({
        kind: 'insert', layer: ln.value, blockName: bn.value,
        x: num(spec.originX) + c * num(spec.spacingX),
        y: num(spec.originY) + r * num(spec.spacingY),
        scale: spec.scale && spec.scale > 0 ? num(spec.scale) : 1,
        rotationDeg: num(spec.rotationDeg),
      });
    }
  }
  return { ok: true, value: out };
}

// ─── 3D routing (honest boundary) ────────────────────────────────────────────

export type ModelingLaneSuggestion = { engine: 'openscad' | 'freecadcmd' | 'blender'; reason: string; outputHint: string };

/**
 * A 3D-solid request does not belong in DXF R12. Route it to the engine that
 * can actually build and render it, rather than emitting a degenerate 2D
 * approximation. Keyword-based, deliberately simple — the runtime tool uses
 * this to REFUSE-and-redirect, not to guess geometry.
 */
export function suggestModelingLane(task: string): ModelingLaneSuggestion {
  const t = String(task || '').toLowerCase();
  if (/\b(assembl|step|iges|bim|revit|fillet|chamfer|boolean|revolve)\b/.test(t)) {
    return { engine: 'freecadcmd', reason: 'Parametric/BREP solids and STEP/IGES exchange are FreeCAD\'s domain.', outputHint: '.step or .stl' };
  }
  if (/\b(render|photoreal|material|lighting|camera|scene)\b/.test(t)) {
    return { engine: 'blender', reason: 'Photoreal rendering and scene work belong to Blender.', outputHint: '.png' };
  }
  return { engine: 'openscad', reason: 'Parametric 3D solids (extrude/difference/union) compile cleanly in OpenSCAD.', outputHint: '.stl or .3mf' };
}
