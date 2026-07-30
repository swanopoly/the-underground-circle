/**
 * engineeringDimensionCore — dimensions and a title block for engineering
 * drawings. This is what turns the drafting core's GEOMETRY into a
 * manufacturable DRAWING: a machinist cannot cut an undimensioned part.
 *
 * WHY EXPLODED (DRAWN) DIMENSIONS
 * A "real" associative DXF DIMENSION entity needs a dimension-style table and
 * an anonymous *D geometry block — heavy, and not every reader honors the
 * style. Instead this emits the VISIBLE geometry of a dimension directly:
 * extension lines, a dimension line with arrowheads, and the measurement text,
 * all as plain LINE + TEXT entities (arrowheads are short caret lines, so no
 * new writer primitive is needed). It always renders, in any CAD tool.
 *
 * THE CORRECTNESS PROPERTY THIS CORE EXISTS TO GUARANTEE
 * A dimension's TEXT must equal the actual geometric distance it spans. A
 * drawing that labels a 90 mm feature "100" does not just look wrong — it tells
 * the machinist to cut the wrong size. So every dimension builder MEASURES the
 * geometry and derives the text from that measurement, and the smoke asserts
 * `text === formatDim(measuredDistance)` for horizontal, vertical, and aligned
 * cases. The value is never passed in; it is always computed from the points.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-dimension-core-smoketest.ts):
 * type-only import of the DraftEntity shape, no runtime deps, no Date.now(),
 * total functions.
 */

import type { DraftEntity, DraftDocument, DraftLayer } from './engineeringDraftingCore';

export const DIMS_LAYER = 'DIMS';
export const TITLE_LAYER = 'TITLE';

/** Round to 2 dp and strip trailing zeros: 100 → "100", 49.996 → "50", 50.5 → "50.5". */
export function formatDim(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const r = Math.round(v * 100) / 100;
  // toFixed then trim trailing zeros and a dangling dot.
  return r.toFixed(2).replace(/\.?0+$/, '') || '0';
}

function n(value: unknown, fallback = 0): number {
  const x = Number(value);
  return Number.isFinite(x) ? x : fallback;
}

export type DimensionResult = { entities: DraftEntity[]; value: number; text: string };

export type LinearDimOptions = {
  orientation?: 'horizontal' | 'vertical' | 'aligned';
  /** Perpendicular distance from the measured feature to the dimension line. */
  offset?: number;
  textHeight?: number;
  arrowSize?: number;
  layer?: string;
  /** Prefix/suffix on the text (e.g. 'Ø', ' TYP'). */
  prefix?: string;
  suffix?: string;
};

/** Two short caret lines forming an arrowhead at `tip`, pointing along `dir` (unit). */
function arrowHead(tipX: number, tipY: number, dirX: number, dirY: number, size: number, layer: string): DraftEntity[] {
  // Rotate the (reversed) direction by ±20° and draw a short line to each.
  const ang = (20 * Math.PI) / 180;
  const bx = -dirX, by = -dirY; // back along the dimension line
  const rot = (x: number, y: number, a: number): [number, number] => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  const [ax1, ay1] = rot(bx, by, ang);
  const [ax2, ay2] = rot(bx, by, -ang);
  return [
    { kind: 'line', layer, x1: tipX, y1: tipY, x2: tipX + ax1 * size, y2: tipY + ay1 * size },
    { kind: 'line', layer, x1: tipX, y1: tipY, x2: tipX + ax2 * size, y2: tipY + ay2 * size },
  ];
}

/**
 * A linear dimension between two points. The measured value is ALWAYS derived
 * from the geometry: horizontal → |Δx|, vertical → |Δy|, aligned → true
 * distance. Extension lines run from the feature to the dimension line; the
 * dimension line carries an arrowhead at each end and the measurement text at
 * its midpoint.
 */
export function linearDimension(x1: number, y1: number, x2: number, y2: number, opts: LinearDimOptions = {}): DimensionResult {
  const ax = n(x1), ay = n(y1), bx = n(x2), by = n(y2);
  const orientation = opts.orientation ?? 'aligned';
  const offset = n(opts.offset, 10);
  const th = n(opts.textHeight, 2.5);
  const asz = n(opts.arrowSize, th);
  const layer = opts.layer || DIMS_LAYER;

  let value: number;
  const entities: DraftEntity[] = [];
  let midX: number, midY: number, textRot = 0;

  if (orientation === 'horizontal') {
    value = Math.abs(bx - ax);
    const dimY = Math.min(ay, by) - offset;
    // Extension lines (feature → just past the dim line).
    entities.push({ kind: 'line', layer, x1: ax, y1: ay, x2: ax, y2: dimY - Math.sign(offset || 1) * (asz * 0.4) });
    entities.push({ kind: 'line', layer, x1: bx, y1: by, x2: bx, y2: dimY - Math.sign(offset || 1) * (asz * 0.4) });
    entities.push({ kind: 'line', layer, x1: ax, y1: dimY, x2: bx, y2: dimY });
    const dir = Math.sign(bx - ax) || 1;
    entities.push(...arrowHead(ax, dimY, dir, 0, asz, layer));
    entities.push(...arrowHead(bx, dimY, -dir, 0, asz, layer));
    midX = (ax + bx) / 2; midY = dimY + th * 0.4;
  } else if (orientation === 'vertical') {
    value = Math.abs(by - ay);
    const dimX = Math.max(ax, bx) + offset;
    entities.push({ kind: 'line', layer, x1: ax, y1: ay, x2: dimX + Math.sign(offset || 1) * (asz * 0.4), y2: ay });
    entities.push({ kind: 'line', layer, x1: bx, y1: by, x2: dimX + Math.sign(offset || 1) * (asz * 0.4), y2: by });
    entities.push({ kind: 'line', layer, x1: dimX, y1: ay, x2: dimX, y2: by });
    const dir = Math.sign(by - ay) || 1;
    entities.push(...arrowHead(dimX, ay, 0, dir, asz, layer));
    entities.push(...arrowHead(dimX, by, 0, -dir, asz, layer));
    midX = dimX + th * 0.4; midY = (ay + by) / 2; textRot = 90;
  } else {
    // Aligned: dimension line parallel to p1→p2, offset perpendicular.
    const dx = bx - ax, dy = by - ay;
    value = Math.sqrt(dx * dx + dy * dy);
    const len = value || 1;
    const ux = dx / len, uy = dy / len; // along
    const px = -uy, py = ux; // perpendicular (left)
    const oX = px * offset, oY = py * offset;
    const p1x = ax + oX, p1y = ay + oY, p2x = bx + oX, p2y = by + oY;
    entities.push({ kind: 'line', layer, x1: ax, y1: ay, x2: p1x, y2: p1y });
    entities.push({ kind: 'line', layer, x1: bx, y1: by, x2: p2x, y2: p2y });
    entities.push({ kind: 'line', layer, x1: p1x, y1: p1y, x2: p2x, y2: p2y });
    entities.push(...arrowHead(p1x, p1y, ux, uy, asz, layer));
    entities.push(...arrowHead(p2x, p2y, -ux, -uy, asz, layer));
    midX = (p1x + p2x) / 2 + px * th * 0.4; midY = (p1y + p2y) / 2 + py * th * 0.4;
    textRot = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    if (textRot > 90 || textRot < -90) textRot += 180; // keep text upright
  }

  const text = `${opts.prefix ?? ''}${formatDim(value)}${opts.suffix ?? ''}`;
  entities.push({ kind: 'text', layer, x: midX, y: midY, height: th, text, rotationDeg: textRot });
  return { entities, value: Math.round(value * 1e6) / 1e6, text };
}

/** A diameter callout for a circle: a leader line across the circle + "Ø<d>" text. */
export function diameterDimension(cx: number, cy: number, radius: number, opts: { textHeight?: number; layer?: string; angleDeg?: number } = {}): DimensionResult {
  const c = [n(cx), n(cy)] as const;
  const r = Math.abs(n(radius));
  const th = n(opts.textHeight, 2.5);
  const layer = opts.layer || DIMS_LAYER;
  const a = ((opts.angleDeg ?? 45) * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  const value = 2 * r;
  const text = `Ø${formatDim(value)}`;
  const entities: DraftEntity[] = [
    // Leader across the diameter, extending a little past the circle.
    { kind: 'line', layer, x1: c[0] - ux * r, y1: c[1] - uy * r, x2: c[0] + ux * (r + th * 3), y2: c[1] + uy * (r + th * 3) },
    { kind: 'text', layer, x: c[0] + ux * (r + th * 3.2), y: c[1] + uy * (r + th * 3.2), height: th, text },
  ];
  return { entities, value, text };
}

/** A radius callout: leader from center outward + "R<r>" text. */
export function radiusDimension(cx: number, cy: number, radius: number, opts: { textHeight?: number; layer?: string; angleDeg?: number } = {}): DimensionResult {
  const c = [n(cx), n(cy)] as const;
  const r = Math.abs(n(radius));
  const th = n(opts.textHeight, 2.5);
  const layer = opts.layer || DIMS_LAYER;
  const a = ((opts.angleDeg ?? 45) * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  const text = `R${formatDim(r)}`;
  const entities: DraftEntity[] = [
    { kind: 'line', layer, x1: c[0], y1: c[1], x2: c[0] + ux * (r + th * 3), y2: c[1] + uy * (r + th * 3) },
    { kind: 'text', layer, x: c[0] + ux * (r + th * 3.2), y: c[1] + uy * (r + th * 3.2), height: th, text },
  ];
  return { entities, value: r, text };
}

// ─── Title block ─────────────────────────────────────────────────────────────

export type TitleBlockSpec = {
  name?: string;
  drawnBy?: string;
  date?: string;
  material?: string;
  scale?: string;
  /** Default tolerance note, e.g. "±0.1 unless noted". */
  tolerance?: string;
  /** Bottom-right corner of the block (defaults to the drawing's extents). */
  x?: number;
  y?: number;
  /** Block size; text is scaled to fit. */
  width?: number;
  height?: number;
  layer?: string;
};

/** Strip newlines/control chars from a field so it can't break the DXF text tag. */
function field(value: unknown, max = 60): string {
  // eslint-disable-next-line no-control-regex
  return String(value ?? '').replace(/[\x00-\x1f\x7f\u2028\u2029]/g, ' ').trim().slice(0, max);
}

/**
 * A standard title block (border box + labelled fields) anchored at its
 * bottom-right corner. Fields: drawing name, drawn-by, date, scale, material,
 * and a default-tolerance note — the metadata a shop needs to make the part.
 */
export function titleBlock(spec: TitleBlockSpec): DraftEntity[] {
  const w = n(spec.width, 180);
  const h = n(spec.height, 40);
  const x = n(spec.x); // bottom-left of the block
  const y = n(spec.y);
  const layer = spec.layer || TITLE_LAYER;
  const th = Math.max(2, h / 12);
  const rows = 5;
  const rowH = h / rows;

  const line = (x1: number, y1: number, x2: number, y2: number): DraftEntity => ({ kind: 'line', layer, x1, y1, x2, y2 });
  const text = (tx: number, ty: number, t: string, height = th): DraftEntity => ({ kind: 'text', layer, x: tx, y: ty, height, text: field(t) });

  const entities: DraftEntity[] = [
    // Outer box.
    line(x, y, x + w, y), line(x + w, y, x + w, y + h), line(x + w, y + h, x, y + h), line(x, y + h, x, y),
  ];
  // Row separators.
  for (let i = 1; i < rows; i += 1) entities.push(line(x, y + i * rowH, x + w, y + i * rowH));
  // A vertical divider for label | value.
  const labelW = w * 0.35;
  entities.push(line(x + labelW, y, x + labelW, y + h));

  const fields: Array<[string, string]> = [
    ['DRAWING', spec.name ?? ''],
    ['MATERIAL', spec.material ?? ''],
    ['SCALE', spec.scale ?? '1:1'],
    ['DRAWN BY', spec.drawnBy ?? ''],
    ['TOLERANCE', spec.tolerance ?? '±0.1 unless noted'],
  ];
  // Rows are drawn top-down.
  fields.forEach(([label, value], i) => {
    const ry = y + h - (i + 1) * rowH + rowH * 0.3;
    entities.push(text(x + rowH * 0.2, ry, label, th * 0.8));
    entities.push(text(x + labelW + rowH * 0.2, ry, value, th));
  });
  return entities;
}


// ─── Whole-drawing annotation (bbox dimensions + title block) ────────────────

export type DrawingBBox = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Bounding box of a whole DraftDocument's entities, expanding circles/arcs by
 * their radius (the same fix the DXF verifier needed). Returns null for an
 * empty drawing.
 */
export function documentBoundingBox(doc: DraftDocument): DrawingBBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const seen = (x: number, y: number) => {
    if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  };
  for (const e of doc.entities ?? []) {
    switch (e.kind) {
      case 'line': seen(e.x1, e.y1); seen(e.x2, e.y2); break;
      case 'circle': case 'arc': seen(e.cx - e.r, e.cy - e.r); seen(e.cx + e.r, e.cy + e.r); break;
      case 'polyline': for (const p of e.points) seen(p.x, p.y); break;
      case 'text': seen(e.x, e.y); break;
      case 'insert': seen(e.x, e.y); break;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export type AnnotateOptions = {
  /** Add overall width + height dimensions around the drawing. */
  autoDimension?: boolean;
  /** Add a title block; the object's fields populate it. */
  titleBlock?: TitleBlockSpec;
};

/**
 * Turn a geometry-only drawing into a manufacturable one: overall
 * width/height dimensions scaled to the drawing size, and a title block below
 * it. Declares the DIMS and TITLE layers if missing. Sizes (text, offset,
 * arrows) scale to the drawing's bounding box so annotations are legible on a
 * 120 mm bracket and a 12 000 mm floor plan alike.
 */
export function annotateDrawing(doc: DraftDocument, opts: AnnotateOptions = {}): DraftDocument {
  const bbox = documentBoundingBox(doc);
  if (!bbox) return doc;
  const W = bbox.maxX - bbox.minX;
  const H = bbox.maxY - bbox.minY;
  const minDim = Math.max(1, Math.min(W, H));
  const th = Math.max(2, minDim * 0.03);
  const off = Math.max(5, minDim * 0.1);
  const asz = th;

  const entities: DraftEntity[] = [...(doc.entities ?? [])];
  const layers: DraftLayer[] = [...(doc.layers ?? [])];
  const ensureLayer = (name: string, color: number) => {
    if (!layers.some((l) => l.name === name)) layers.push({ name, color, linetype: 'CONTINUOUS' });
  };

  if (opts.autoDimension) {
    ensureLayer(DIMS_LAYER, 2);
    // Overall width along the bottom, overall height up the right side.
    const width = linearDimension(bbox.minX, bbox.minY, bbox.maxX, bbox.minY, { orientation: 'horizontal', offset: off, textHeight: th, arrowSize: asz });
    const height = linearDimension(bbox.maxX, bbox.minY, bbox.maxX, bbox.maxY, { orientation: 'vertical', offset: off, textHeight: th, arrowSize: asz });
    entities.push(...width.entities, ...height.entities);
  }

  if (opts.titleBlock) {
    ensureLayer(TITLE_LAYER, 7);
    const tbW = Math.max(120, W);
    const tbH = Math.max(30, H * 0.22);
    // Below the drawing, clear of the overall-width dimension line.
    const tbY = bbox.minY - off - tbH - th * 4;
    entities.push(...titleBlock({ ...opts.titleBlock, x: bbox.minX, y: tbY, width: tbW, height: tbH }));
  }

  return { layers, blocks: doc.blocks, entities };
}
