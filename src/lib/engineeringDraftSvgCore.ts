/**
 * engineeringDraftSvgCore — pure DXF/DraftDocument → SVG preview renderer.
 *
 * WHY THIS EXISTS
 * `engineering.draft_dxf` produces a real, verified drawing — but only as DXF
 * text written to disk. Nothing in the app can SHOW it. Chat artifacts already
 * render `kind:'image'` data: URLs and `kind:'webpage'` sandboxed iframes
 * (src/components/chat/ChatArtifacts.tsx), so the missing piece is exactly one
 * pure function: neutral drafting geometry → an SVG string. No SVG library is
 * used or needed — SVG is a text format and the geometry is already structured
 * (engineeringDraftingCore's DraftEntity/DraftDocument).
 *
 * COORDINATE RULE — Y-FLIP. DXF model space is y-UP; SVG is y-DOWN. Every
 * entity coordinate is mapped `sy(y) = maxY - y + margin` (a pure reflection +
 * translation, scale 1, so radii and lengths pass through unchanged). Arc
 * orientation flips with it: DXF arcs sweep CCW start→end, which after the
 * reflection is SVG sweep-flag 0.
 *
 * BBOX RULE — same as the core's verifier (`parseDxfForVerification`): a
 * CIRCLE/ARC expands the bbox by ±radius around its center, never just the
 * center point. TEXT additionally contributes an estimated glyph box
 * (height up from the baseline, ~0.6·height per char wide) so labels are not
 * clipped at the viewBox edge — a superset of the verifier's point rule.
 *
 * SECURITY BAR — SVG IS ACTIVE CONTENT. The rendered string is shown as an
 * <img> data: URL and inside a sandboxed iframe. Therefore:
 *   - every TEXT entity's content is XML-escaped (& < > " ') before emission —
 *     a hostile `<script>` label becomes inert text;
 *   - layer/block names are NEVER emitted into the SVG (they are only map keys
 *     for color lookup), so unvalidated names from parsed DXF cannot inject
 *     attributes;
 *   - the optional background option is validated against a strict color
 *     pattern before being placed in an attribute.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-draft-svg-core-smoketest.ts):
 * value-imports only from the pure engineeringDraftingCore, `import type` from
 * swanbot (erased at compile), no Date.now(), no I/O, total functions.
 */

import type { DraftDocument, DraftEntity, DraftLayer, DraftBlock, DraftPoint } from './engineeringDraftingCore';
import type { SwanBotStructuredArtifact } from './swanbot';

// ─── ACI color mapping ───────────────────────────────────────────────────────

/**
 * AutoCAD Color Index → hex, for the standard palette indices the drafting
 * core's layer palettes actually use (1,2,3,4,5,7,8) plus the rest of the
 * classic 1-9 band. Bright ACI yellow/white are unreadable on a light preview
 * background, so 2 and 7 are darkened to legible equivalents.
 */
export const ACI_HEX: Record<number, string> = {
  1: '#cc2222', // red
  2: '#b58900', // yellow → readable amber
  3: '#1a7f37', // green
  4: '#0e7490', // cyan → readable teal
  5: '#1d4ed8', // blue
  6: '#a21caf', // magenta
  7: '#222222', // white → dark (light background)
  8: '#808080', // dark gray
  9: '#c0c0c0', // light gray
};

export const DEFAULT_STROKE = '#222222';

export function aciToHex(index: unknown): string {
  const n = Math.trunc(Number(index));
  return Number.isFinite(n) && ACI_HEX[n] ? ACI_HEX[n] : DEFAULT_STROKE;
}

// ─── Small pure helpers ──────────────────────────────────────────────────────

function finite(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Bounded-precision attribute number: never NaN/Infinity, no long tails. */
function fmt(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  return String(Math.round(n * 1e4) / 1e4);
}

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Pure UTF-8 → base64 (no Buffer/btoa so the module stays platform-neutral). */
export function base64EncodeUtf8(text: string): string {
  const bytes: number[] = [];
  for (const ch of String(text ?? '')) {
    let cp = ch.codePointAt(0) as number;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += A[b0 >> 2];
    out += A[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : A[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : A[b2 & 63];
  }
  return out;
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${base64EncodeUtf8(svg)}`;
}

// ─── Insert flattening (bounded-depth block resolution) ──────────────────────

export const MAX_INSERT_DEPTH = 2;

type InsertTransform = { x: number; y: number; scale: number; rotDeg: number };

function transformPoint(px: number, py: number, t: InsertTransform): DraftPoint {
  const a = (t.rotDeg * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  return {
    x: t.x + t.scale * (px * c - py * s),
    y: t.y + t.scale * (px * s + py * c),
  };
}

function transformEntity(e: DraftEntity, t: InsertTransform): DraftEntity {
  switch (e.kind) {
    case 'line': {
      const p1 = transformPoint(e.x1, e.y1, t);
      const p2 = transformPoint(e.x2, e.y2, t);
      return { ...e, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    case 'circle': {
      const c = transformPoint(e.cx, e.cy, t);
      return { ...e, cx: c.x, cy: c.y, r: e.r * t.scale };
    }
    case 'arc': {
      const c = transformPoint(e.cx, e.cy, t);
      return { ...e, cx: c.x, cy: c.y, r: e.r * t.scale, startDeg: e.startDeg + t.rotDeg, endDeg: e.endDeg + t.rotDeg };
    }
    case 'polyline':
      return { ...e, points: e.points.map((p) => transformPoint(finite(p.x), finite(p.y), t)) };
    case 'text': {
      const p = transformPoint(e.x, e.y, t);
      return { ...e, x: p.x, y: p.y, height: e.height * t.scale, rotationDeg: (e.rotationDeg ?? 0) + t.rotDeg };
    }
    case 'insert': {
      const p = transformPoint(e.x, e.y, t);
      return { ...e, x: p.x, y: p.y, scale: (e.scale ?? 1) * t.scale, rotationDeg: (e.rotationDeg ?? 0) + t.rotDeg };
    }
    default:
      return e;
  }
}

/**
 * Resolve INSERT entities into their block's transformed entities, recursively,
 * bounded to MAX_INSERT_DEPTH nesting levels. An insert past the depth bound or
 * referencing a missing block contributes nothing (its position still counts in
 * the bbox via the caller when the insert survives — here it is simply dropped,
 * matching "render what is resolvable, never throw").
 */
export function flattenDraftEntities(doc: DraftDocument): DraftEntity[] {
  const blockByName = new Map<string, DraftBlock>();
  for (const b of doc.blocks ?? []) blockByName.set(b.name, b);

  const out: DraftEntity[] = [];
  const walk = (entities: DraftEntity[], depth: number) => {
    for (const e of entities ?? []) {
      if (!e || typeof e !== 'object') continue;
      if (e.kind === 'insert') {
        if (depth >= MAX_INSERT_DEPTH) continue;
        const block = blockByName.get(e.blockName);
        if (!block) continue;
        const t: InsertTransform = {
          x: finite(e.x), y: finite(e.y),
          scale: e.scale && Number.isFinite(e.scale) && e.scale > 0 ? e.scale : 1,
          rotDeg: finite(e.rotationDeg),
        };
        walk(block.entities.map((child) => transformEntity(child, t)), depth + 1);
      } else {
        out.push(e);
      }
    }
  };
  walk(doc.entities ?? [], 0);
  return out;
}

// ─── Bounding box (verifier rule: circles/arcs expand by radius) ─────────────

export type DraftBbox = { minX: number; minY: number; maxX: number; maxY: number };

/** Estimated glyph advance per char, as a fraction of text height. */
const TEXT_WIDTH_PER_CHAR = 0.6;

export function computeDraftBbox(doc: DraftDocument): DraftBbox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const seen = (x: number, y: number) => {
    if (Number.isFinite(x)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    if (Number.isFinite(y)) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  };
  for (const e of flattenDraftEntities(doc)) {
    switch (e.kind) {
      case 'line':
        seen(finite(e.x1), finite(e.y1)); seen(finite(e.x2), finite(e.y2));
        break;
      case 'circle':
      case 'arc': {
        // Same rule as parseDxfForVerification: center ± radius.
        const r = Math.abs(finite(e.r));
        const cx = finite(e.cx), cy = finite(e.cy);
        seen(cx - r, cy - r); seen(cx + r, cy + r);
        break;
      }
      case 'polyline':
        for (const p of e.points ?? []) seen(finite(p.x), finite(p.y));
        break;
      case 'text': {
        const h = Math.abs(finite(e.height));
        const x = finite(e.x), y = finite(e.y);
        seen(x, y);
        seen(x + h * TEXT_WIDTH_PER_CHAR * String(e.text ?? '').length, y + h);
        break;
      }
      default:
        break;
    }
  }
  return Number.isFinite(minX) && Number.isFinite(minY) ? { minX, minY, maxX, maxY } : null;
}

// ─── SVG rendering ───────────────────────────────────────────────────────────

export type DraftSvgOptions = {
  /** Rendered pixel bounds the drawing aspect-fits into (defaults 960×640). */
  maxWidth?: number;
  maxHeight?: number;
  /** Background color; validated against a strict pattern (default #ffffff). */
  background?: string;
};

const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/;

function layerColorMap(layers: DraftLayer[] | undefined): Map<string, string> {
  const m = new Map<string, string>();
  m.set('0', aciToHex(7));
  for (const layer of layers ?? []) {
    if (layer && typeof layer.name === 'string') m.set(layer.name, aciToHex(layer.color ?? 7));
  }
  return m;
}

/**
 * Render a neutral DraftDocument to a standalone SVG string. Total: an empty or
 * degenerate document still yields a valid (blank) SVG; NaN coordinates render
 * as 0; nothing throws.
 */
export function draftDocumentToSvg(doc: DraftDocument, opts?: DraftSvgOptions): string {
  const entities = flattenDraftEntities(doc ?? { layers: [], blocks: [], entities: [] });
  const bbox = computeDraftBbox(doc ?? { layers: [], blocks: [], entities: [] })
    ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  const spanX = Math.max(bbox.maxX - bbox.minX, 1e-9);
  const spanY = Math.max(bbox.maxY - bbox.minY, 1e-9);
  const margin = 0.05 * Math.max(spanX, spanY);
  const W = spanX + 2 * margin;
  const H = spanY + 2 * margin;

  // Y-FLIP: DXF y-up → SVG y-down. Pure reflection+translation (scale 1).
  const sx = (x: number) => finite(x) - bbox.minX + margin;
  const sy = (y: number) => bbox.maxY - finite(y) + margin;

  const maxW = finite(opts?.maxWidth, 960) > 0 ? finite(opts?.maxWidth, 960) : 960;
  const maxH = finite(opts?.maxHeight, 640) > 0 ? finite(opts?.maxHeight, 640) : 640;
  const fit = Math.min(maxW / W, maxH / H);
  const pxW = Math.max(1, Math.round(W * fit));
  const pxH = Math.max(1, Math.round(H * fit));

  const background = opts?.background && SAFE_COLOR.test(opts.background) ? opts.background : '#ffffff';
  const strokeWidth = Math.max(W, H) / 400;
  const colors = layerColorMap(doc?.layers);
  const strokeFor = (layer: string) => colors.get(layer) ?? DEFAULT_STROKE;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(W)} ${fmt(H)}" width="${pxW}" height="${pxH}" role="img">`,
  );
  parts.push(`<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="${background}"/>`);
  parts.push(`<g fill="none" stroke-width="${fmt(strokeWidth)}" stroke-linecap="round" stroke-linejoin="round">`);

  for (const e of entities) {
    switch (e.kind) {
      case 'line':
        parts.push(
          `<line x1="${fmt(sx(e.x1))}" y1="${fmt(sy(e.y1))}" x2="${fmt(sx(e.x2))}" y2="${fmt(sy(e.y2))}" stroke="${strokeFor(e.layer)}"/>`,
        );
        break;
      case 'circle':
        parts.push(
          `<circle cx="${fmt(sx(e.cx))}" cy="${fmt(sy(e.cy))}" r="${fmt(Math.abs(finite(e.r)))}" stroke="${strokeFor(e.layer)}" fill="none"/>`,
        );
        break;
      case 'arc': {
        const r = Math.abs(finite(e.r));
        const start = (finite(e.startDeg) * Math.PI) / 180;
        const end = (finite(e.endDeg) * Math.PI) / 180;
        const delta = ((finite(e.endDeg) - finite(e.startDeg)) % 360 + 360) % 360;
        if (r <= 0) break;
        if (delta === 0) {
          // 360° arc — render as a full circle.
          parts.push(
            `<circle cx="${fmt(sx(e.cx))}" cy="${fmt(sy(e.cy))}" r="${fmt(r)}" stroke="${strokeFor(e.layer)}" fill="none"/>`,
          );
          break;
        }
        const p1x = finite(e.cx) + r * Math.cos(start), p1y = finite(e.cy) + r * Math.sin(start);
        const p2x = finite(e.cx) + r * Math.cos(end), p2y = finite(e.cy) + r * Math.sin(end);
        const largeArc = delta > 180 ? 1 : 0;
        // DXF arcs sweep CCW; the y-flip reverses orientation → SVG sweep 0.
        parts.push(
          `<path d="M ${fmt(sx(p1x))} ${fmt(sy(p1y))} A ${fmt(r)} ${fmt(r)} 0 ${largeArc} 0 ${fmt(sx(p2x))} ${fmt(sy(p2y))}" stroke="${strokeFor(e.layer)}" fill="none"/>`,
        );
        break;
      }
      case 'polyline': {
        const pts = (e.points ?? []).map((p) => `${fmt(sx(finite(p.x)))},${fmt(sy(finite(p.y)))}`).join(' ');
        if (!pts) break;
        const tagName = e.closed ? 'polygon' : 'polyline';
        parts.push(`<${tagName} points="${pts}" stroke="${strokeFor(e.layer)}" fill="none"/>`);
        break;
      }
      case 'text': {
        const h = Math.abs(finite(e.height)) || 1;
        const x = fmt(sx(e.x)), y = fmt(sy(e.y));
        const rot = finite(e.rotationDeg);
        // DXF rotation is CCW-positive; SVG rotate() is CW-positive in y-down.
        const transform = rot ? ` transform="rotate(${fmt(-rot)} ${x} ${y})"` : '';
        parts.push(
          `<text x="${x}" y="${y}" font-size="${fmt(h)}" font-family="sans-serif" fill="${strokeFor(e.layer)}" stroke="none"${transform}>${escapeXml(e.text)}</text>`,
        );
        break;
      }
      default:
        break;
    }
  }

  parts.push('</g>');
  parts.push('</svg>');
  return parts.join('\n');
}

// ─── Chat artifacts ──────────────────────────────────────────────────────────

/**
 * Package a DraftDocument as ready-to-append chat artifacts, matching the
 * real SwanBotStructuredArtifact shape (src/lib/swanbot.ts) and its
 * normalizeArtifact allowlist fields exactly: { kind, title, content, url,
 * metadata } with kind ∈ the allowlist ('image' and 'webpage' here).
 *
 *   [0] kind:'image'   — data:image/svg+xml;base64 URL, rendered inline by
 *                        ChatArtifacts with its "Open Full Size" path.
 *   [1] kind:'webpage' — standalone HTML document embedding the same SVG,
 *                        rendered as a sandboxed iframe fallback with
 *                        "Open in New Tab"/"Download HTML".
 */
export function draftSvgToArtifacts(
  doc: DraftDocument,
  title: string,
  opts?: DraftSvgOptions,
): SwanBotStructuredArtifact[] {
  const safeTitle = (String(title ?? '').trim() || 'Engineering drawing').slice(0, 200);
  const svg = draftDocumentToSvg(doc, opts);
  const entityCount = flattenDraftEntities(doc ?? { layers: [], blocks: [], entities: [] }).length;

  const html = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<title>${escapeXml(safeTitle)}</title>`,
    '<style>html,body{margin:0;padding:16px;background:#0a0a10;display:flex;align-items:center;justify-content:center;min-height:100vh;box-sizing:border-box}svg{max-width:100%;height:auto;border-radius:8px}</style>',
    '</head><body>',
    svg,
    '</body></html>',
  ].join('\n');

  return [
    {
      kind: 'image',
      title: safeTitle,
      content: null,
      url: svgToDataUrl(svg),
      metadata: { source: 'engineering.draft_dxf', format: 'svg', entityCount },
    },
    {
      kind: 'webpage',
      title: `${safeTitle} (HTML preview)`.slice(0, 200),
      content: html,
      url: null,
      metadata: { source: 'engineering.draft_dxf', format: 'svg-html', entityCount },
    },
  ];
}

// ─── DXF text → entities → SVG ───────────────────────────────────────────────
//
// parseDxfForVerification returns only a summary/bbox, not entities, so this
// is a minimal group-code ENTITY reader (LINE/CIRCLE/ARC/POLYLINE/LWPOLYLINE/
// TEXT/INSERT + LAYER-table colors + BLOCK definitions) for when only the DXF
// text is available.

type PendingEntity = {
  type: string;
  layer: string;
  xs: number[];
  ys: number[];
  x11?: number;
  y21?: number;
  r?: number;
  startDeg?: number;
  endDeg?: number;
  height?: number;
  text?: string;
  rotDeg?: number;
  scale41?: number;
  blockName?: string;
  flag70?: number;
};

function pendingToEntity(p: PendingEntity): DraftEntity | null {
  const layer = p.layer || '0';
  switch (p.type) {
    case 'LINE':
      return { kind: 'line', layer, x1: finite(p.xs[0]), y1: finite(p.ys[0]), x2: finite(p.x11), y2: finite(p.y21) };
    case 'CIRCLE':
      return { kind: 'circle', layer, cx: finite(p.xs[0]), cy: finite(p.ys[0]), r: Math.abs(finite(p.r)) };
    case 'ARC':
      return {
        kind: 'arc', layer, cx: finite(p.xs[0]), cy: finite(p.ys[0]), r: Math.abs(finite(p.r)),
        startDeg: finite(p.startDeg), endDeg: finite(p.endDeg),
      };
    case 'TEXT':
      return {
        kind: 'text', layer, x: finite(p.xs[0]), y: finite(p.ys[0]),
        height: Math.abs(finite(p.height, 1)), text: String(p.text ?? ''), rotationDeg: finite(p.rotDeg),
      };
    case 'INSERT':
      return {
        kind: 'insert', layer, blockName: String(p.blockName ?? ''), x: finite(p.xs[0]), y: finite(p.ys[0]),
        scale: p.scale41 && p.scale41 > 0 ? p.scale41 : 1, rotationDeg: finite(p.rotDeg),
      };
    case 'LWPOLYLINE': {
      const points: DraftPoint[] = [];
      for (let i = 0; i < Math.min(p.xs.length, p.ys.length); i += 1) points.push({ x: p.xs[i], y: p.ys[i] });
      if (!points.length) return null;
      return { kind: 'polyline', layer, points, closed: ((p.flag70 ?? 0) & 1) === 1 };
    }
    default:
      return null;
  }
}

/**
 * Parse DXF text into a renderable DraftDocument. A verification-style
 * group-code walk (same pairing rule as parseDxfForVerification), collecting
 * full entity geometry instead of counts. Total: malformed input yields a
 * document with whatever was parseable, never a throw.
 */
export function parseDxfToDraftDocument(dxf: string): DraftDocument {
  const rawLines = String(dxf ?? '').split('\n');
  const pairs: Array<{ code: number; value: string }> = [];
  for (let i = 0; i + 1 < rawLines.length; i += 2) {
    const code = Number(rawLines[i].trim());
    if (!Number.isFinite(code)) continue;
    pairs.push({ code, value: rawLines[i + 1] ?? '' });
  }

  const layers: DraftLayer[] = [];
  const blocks: DraftBlock[] = [];
  const entities: DraftEntity[] = [];

  let section: string | null = null;
  let sectionNamePending = false;
  let inLayerTable = false;
  let curLayer: { name?: string; color?: number } | null = null;
  let curBlock: { name: string | null; named: boolean; entities: DraftEntity[] } | null = null;
  let cur: PendingEntity | null = null;
  // POLYLINE/VERTEX/SEQEND accumulation.
  let pendingPoly: { layer: string; closed: boolean; points: DraftPoint[] } | null = null;
  let curVertex: { x?: number; y?: number } | null = null;

  const target = () => (section === 'BLOCKS' && curBlock ? curBlock.entities : entities);

  const flushLayerRec = () => {
    if (curLayer && curLayer.name) layers.push({ name: curLayer.name, color: curLayer.color ?? 7 });
    curLayer = null;
  };
  const flushPoly = () => {
    if (pendingPoly && pendingPoly.points.length) {
      target().push({ kind: 'polyline', layer: pendingPoly.layer, points: pendingPoly.points, closed: pendingPoly.closed });
    }
    pendingPoly = null;
  };
  const flushEntity = () => {
    if (curVertex && pendingPoly && curVertex.x !== undefined && curVertex.y !== undefined) {
      pendingPoly.points.push({ x: curVertex.x, y: curVertex.y });
    }
    curVertex = null;
    if (cur) {
      if (cur.type === 'POLYLINE') {
        flushPoly();
        pendingPoly = { layer: cur.layer || '0', closed: ((cur.flag70 ?? 0) & 1) === 1, points: [] };
      } else {
        const e = pendingToEntity(cur);
        if (e) target().push(e);
      }
    }
    cur = null;
  };

  for (const { code, value } of pairs) {
    const v = value.trim();

    if (code === 0) {
      flushEntity();
      if (v === 'SECTION') { section = null; sectionNamePending = true; inLayerTable = false; continue; }
      if (v === 'ENDSEC') { flushPoly(); flushLayerRec(); section = null; inLayerTable = false; curBlock = null; continue; }
      if (v === 'EOF') { flushPoly(); continue; }
      if (section === 'TABLES') {
        if (v === 'TABLE') { inLayerTable = false; continue; }
        if (v === 'ENDTAB') { flushLayerRec(); inLayerTable = false; continue; }
        if (v === 'LAYER') {
          // First LAYER 0-tag both confirms the table and starts a record.
          flushLayerRec();
          inLayerTable = true;
          curLayer = {};
          continue;
        }
        continue;
      }
      if (section === 'BLOCKS') {
        if (v === 'BLOCK') { flushPoly(); curBlock = { name: null, named: false, entities: [] }; continue; }
        if (v === 'ENDBLK') {
          flushPoly();
          if (curBlock && curBlock.name) blocks.push({ name: curBlock.name, entities: curBlock.entities });
          curBlock = null;
          continue;
        }
      }
      if (section === 'ENTITIES' || (section === 'BLOCKS' && curBlock)) {
        if (v === 'VERTEX') { curVertex = {}; continue; }
        if (v === 'SEQEND') { flushPoly(); continue; }
        cur = { type: v, layer: '0', xs: [], ys: [] };
      }
      continue;
    }

    if (sectionNamePending && code === 2) {
      if (['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES'].includes(v)) section = v;
      sectionNamePending = false;
      continue;
    }

    if (inLayerTable && curLayer) {
      if (code === 2 && v) curLayer.name = v;
      if (code === 62) curLayer.color = Math.trunc(finite(v, 7));
      // fall through: layer records share no codes with entities here
    }

    if (section === 'BLOCKS' && curBlock && !curBlock.named && code === 2 && v && !cur) {
      curBlock.name = v;
      curBlock.named = true;
      continue;
    }

    if (curVertex) {
      if (code === 10) curVertex.x = finite(v);
      if (code === 20) curVertex.y = finite(v);
      continue;
    }

    if (cur) {
      switch (code) {
        case 8: cur.layer = v || '0'; break;
        case 10: cur.xs.push(finite(v)); break;
        case 20: cur.ys.push(finite(v)); break;
        case 11: cur.x11 = finite(v); break;
        case 21: cur.y21 = finite(v); break;
        case 40: {
          if (cur.type === 'TEXT') cur.height = finite(v);
          else cur.r = finite(v);
          break;
        }
        case 50: {
          if (cur.type === 'ARC') cur.startDeg = finite(v);
          else cur.rotDeg = finite(v);
          break;
        }
        case 51: cur.endDeg = finite(v); break;
        case 41: cur.scale41 = finite(v); break;
        case 1: if (cur.type === 'TEXT') cur.text = value; break;
        case 2: if (cur.type === 'INSERT') cur.blockName = v; break;
        case 70: cur.flag70 = Math.trunc(finite(v)); break;
        default: break;
      }
    }
  }
  flushEntity();
  flushPoly();
  flushLayerRec();

  return { layers, blocks, entities };
}

/**
 * Render DXF text straight to an SVG preview — for when only the serialized
 * DXF is available (e.g. read back from disk). Total: garbage in → blank SVG.
 */
export function dxfTextToSvg(dxfText: string, opts?: DraftSvgOptions): string {
  return draftDocumentToSvg(parseDxfToDraftDocument(dxfText), opts);
}
