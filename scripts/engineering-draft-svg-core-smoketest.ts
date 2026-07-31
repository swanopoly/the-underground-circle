/**
 * Smoke test: engineeringDraftSvgCore — DXF/DraftDocument → SVG chat preview.
 *
 * Feeds REAL generator output (buildFloorPlan/buildBoltCircle/
 * buildElectricalSchematic from engineeringDraftingCore) plus adversarial and
 * hand-pinned documents, and asserts:
 *   - structural SVG validity (one root <svg>, balanced tags, valid viewBox)
 *   - viewBox matches computeDraftBbox + 5% margin exactly
 *   - Y-FLIP correctness (entity at min-y renders at max-svg-y, exact pin)
 *   - circle count parity with the flattened entity list
 *   - ACI → hex layer color mapping
 *   - XML-escape security (hostile <script> text entity stays inert)
 *   - data-URL base64 round-trip
 *   - bounded output size (500-entity doc < 300 KB)
 *   - block INSERT resolution (translation/scale/rotation, depth bound 2)
 *   - dxfTextToSvg parses real writeDxfR12 output (colors + geometry survive)
 *   - artifact shape matches the SwanBotStructuredArtifact allowlist
 *   - totality on empty/malformed input
 *
 * Run: npx tsx scripts/engineering-draft-svg-core-smoketest.ts
 */

import {
  ACI_HEX,
  aciToHex,
  base64EncodeUtf8,
  computeDraftBbox,
  draftDocumentToSvg,
  draftSvgToArtifacts,
  dxfTextToSvg,
  escapeXml,
  flattenDraftEntities,
  parseDxfToDraftDocument,
  svgToDataUrl,
} from '../src/lib/engineeringDraftSvgCore';
import {
  buildBoltCircle,
  buildElectricalSchematic,
  buildFloorPlan,
  writeDxfR12,
  type DraftDocument,
  type DraftEntity,
} from '../src/lib/engineeringDraftingCore';

let passed = 0;
const failures: string[] = [];

function assert(cond: boolean, msg: string) {
  if (cond) passed += 1;
  else {
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  }
}

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Minimal structural check: every opened tag closes, exactly one root <svg>. */
function checkBalanced(svg: string, label: string) {
  assert(svg.startsWith('<svg '), `${label}: starts with <svg`);
  assert(svg.trimEnd().endsWith('</svg>'), `${label}: ends with </svg>`);
  assert(count(svg, '<svg ') === 1 && count(svg, '</svg>') === 1, `${label}: exactly one root svg`);
  for (const tag of ['g', 'text']) {
    assert(count(svg, `<${tag}`) === count(svg, `</${tag}>`), `${label}: balanced <${tag}> tags`);
  }
  // Every non-container element is self-closed.
  for (const tag of ['line', 'circle', 'path', 'polyline', 'polygon', 'rect']) {
    const opens = count(svg, `<${tag} `);
    const selfClosed = (svg.match(new RegExp(`<${tag} [^>]*/>`, 'g')) ?? []).length;
    assert(opens === selfClosed, `${label}: all <${tag}> self-closed (${opens} vs ${selfClosed})`);
  }
}

function parseViewBox(svg: string): number[] | null {
  const m = svg.match(/viewBox="([^"]+)"/);
  if (!m) return null;
  const nums = m[1].split(/\s+/).map(Number);
  return nums.length === 4 && nums.every(Number.isFinite) ? nums : null;
}

// ─── 1. Real generator output: floor plan ────────────────────────────────────

const floorPlan = buildFloorPlan({
  width: 12000,
  height: 8000,
  rooms: [{ name: 'Office', x: 500, y: 500, width: 4000, height: 3000 }],
  doors: [{ x: 3000, y: 0 }, { x: 8000, y: 8000, rotationDeg: 180 }],
  windows: [{ x: 6000, y: 0 }],
  dimensions: true,
});
assert(floorPlan.ok, 'buildFloorPlan produced a document');
if (floorPlan.ok) {
  const svg = draftDocumentToSvg(floorPlan.value);
  checkBalanced(svg, 'floorPlan');

  // viewBox matches computed bbox + 5% margin.
  const bbox = computeDraftBbox(floorPlan.value);
  assert(bbox !== null, 'floorPlan: bbox computed');
  const vb = parseViewBox(svg);
  assert(vb !== null, 'floorPlan: viewBox present and numeric');
  if (bbox && vb) {
    const spanX = bbox.maxX - bbox.minX;
    const spanY = bbox.maxY - bbox.minY;
    const margin = 0.05 * Math.max(spanX, spanY);
    assert(vb[0] === 0 && vb[1] === 0, 'floorPlan: viewBox origin 0 0');
    assert(approx(vb[2], spanX + 2 * margin, 1e-3), `floorPlan: viewBox width ${vb[2]} = span+margin ${spanX + 2 * margin}`);
    assert(approx(vb[3], spanY + 2 * margin, 1e-3), `floorPlan: viewBox height ${vb[3]} = span+margin ${spanY + 2 * margin}`);
  }

  // Block insert resolution: 2 DOOR inserts → 2 swing arcs (<path A) rendered.
  assert(count(svg, '<path ') === 2, `floorPlan: 2 door swing arcs rendered as paths (got ${count(svg, '<path ')})`);
  // WINDOW block → lines beyond the walls; and room label text present.
  assert(svg.includes('>Office</text>'), 'floorPlan: room label text rendered');
  // Dimensions layer (DIMS, ACI 2) mapped through the color table.
  assert(svg.includes(`stroke="${ACI_HEX[2]}"`), 'floorPlan: DIMS layer stroked with ACI 2 hex');
  // Rotated dimension text uses negated-angle rotate (DXF CCW → SVG CW).
  assert(/transform="rotate\(-90 /.test(svg), 'floorPlan: 90° DXF text rotation becomes rotate(-90 ...)');
}

// ─── 2. Y-flip pin: exact coordinates ────────────────────────────────────────

{
  const doc: DraftDocument = {
    layers: [{ name: 'L1', color: 3 }],
    blocks: [],
    entities: [{ kind: 'line', layer: 'L1', x1: 0, y1: 0, x2: 10, y2: 20 }],
  };
  // bbox 0..10 × 0..20, margin = 0.05*20 = 1 → sx(x)=x+1, sy(y)=20-y+1.
  const svg = draftDocumentToSvg(doc);
  assert(svg.includes('<line x1="1" y1="21" x2="11" y2="1"'), 'y-flip: min-y endpoint (0,0) renders at max svg y=21, max-y at y=1');
  const vb = parseViewBox(svg);
  assert(vb !== null && approx(vb[2], 12) && approx(vb[3], 22), 'y-flip doc: viewBox 0 0 12 22');
  assert(svg.includes(`stroke="${ACI_HEX[3]}"`), 'y-flip doc: ACI 3 (green) applied');
}

// ─── 3. Bolt circle: circle-count parity + ACI mapping ───────────────────────

const bolt = buildBoltCircle({ outerDiameter: 120, centerBore: 30, count: 6, pcd: 90, holeDiameter: 9 });
assert(bolt.ok, 'buildBoltCircle produced a document');
if (bolt.ok) {
  const svg = draftDocumentToSvg(bolt.value);
  checkBalanced(svg, 'boltCircle');
  const flat = flattenDraftEntities(bolt.value);
  const circleEntities = flat.filter((e) => e.kind === 'circle').length;
  assert(circleEntities === 9, `boltCircle: 9 circle entities (outer+bore+pcd+6 holes), got ${circleEntities}`);
  assert(count(svg, '<circle ') === circleEntities, `boltCircle: SVG circle count ${count(svg, '<circle ')} matches entity count ${circleEntities}`);
  // HOLES layer is ACI 1 (red); OUTLINE is ACI 7 (dark); CONSTRUCTION ACI 8.
  assert(svg.includes(`stroke="${ACI_HEX[1]}"`), 'boltCircle: HOLES stroked ACI 1');
  assert(svg.includes(`stroke="${ACI_HEX[7]}"`), 'boltCircle: OUTLINE stroked ACI 7');
  assert(svg.includes(`stroke="${ACI_HEX[8]}"`), 'boltCircle: CONSTRUCTION stroked ACI 8');
  // Unicode Ø in the PCD callout survives escaping and base64 round-trip.
  assert(svg.includes('Ø'), 'boltCircle: Ø glyph present in dimension text');

  // ── 4. dxfTextToSvg over REAL writeDxfR12 output ──
  const dxf = writeDxfR12(bolt.value);
  assert(dxf.ok, 'boltCircle: writeDxfR12 ok');
  if (dxf.ok) {
    const reparsed = parseDxfToDraftDocument(dxf.value);
    assert(reparsed.entities.filter((e) => e.kind === 'circle').length === 9, 'dxf round-trip: 9 circles reparsed');
    assert(reparsed.entities.filter((e) => e.kind === 'line').length === 12, 'dxf round-trip: 12 center-mark lines reparsed');
    const holes = reparsed.layers.find((l) => l.name === 'HOLES');
    assert(!!holes && holes.color === 1, 'dxf round-trip: HOLES layer color 1 read from LAYER table');
    const svg2 = dxfTextToSvg(dxf.value);
    checkBalanced(svg2, 'dxfTextToSvg(boltCircle)');
    assert(count(svg2, '<circle ') === 9, 'dxfTextToSvg: 9 circles rendered from DXF text');
    assert(svg2.includes(`stroke="${ACI_HEX[1]}"`), 'dxfTextToSvg: layer-table color applied');
    // Same drawing → same extent whether rendered from doc or from DXF text.
    const vbA = parseViewBox(svg);
    const vbB = parseViewBox(svg2);
    assert(!!vbA && !!vbB && approx(vbA![2], vbB![2], 0.5) && approx(vbA![3], vbB![3], 0.5),
      'dxfTextToSvg: viewBox agrees with direct render');
  }
}

// ─── 5. Schematic: INSERT blocks + polyline + wires from DXF text ────────────

const schematic = buildElectricalSchematic({
  placements: [
    { symbol: 'resistor', x: 0, y: 0, label: 'R1' },
    { symbol: 'lamp', x: 20, y: 0, label: 'L1' },
    { symbol: 'ground', x: 40, y: -10 },
  ],
  wires: [{ x1: 10, y1: 0, x2: 20, y2: 0 }],
});
assert(schematic.ok, 'buildElectricalSchematic produced a document');
if (schematic.ok) {
  const svg = draftDocumentToSvg(schematic.value);
  checkBalanced(svg, 'schematic');
  // Resistor zigzag block resolves through the INSERT → one polyline.
  assert(count(svg, '<polyline ') >= 1, 'schematic: resistor zigzag polyline resolved from block');
  // Lamp block: circle resolved through INSERT.
  assert(count(svg, '<circle ') >= 1, 'schematic: lamp circle resolved from block');
  assert(svg.includes('>R1</text>'), 'schematic: label text rendered');

  const dxf = writeDxfR12(schematic.value);
  assert(dxf.ok, 'schematic: writeDxfR12 ok');
  if (dxf.ok) {
    const svg2 = dxfTextToSvg(dxf.value);
    checkBalanced(svg2, 'dxfTextToSvg(schematic)');
    // BLOCK definitions + INSERTs survive the DXF text round-trip.
    assert(count(svg2, '<polyline ') >= 1, 'dxfTextToSvg: block polyline resolved after reparse');
    assert(count(svg2, '<circle ') >= 1, 'dxfTextToSvg: block circle resolved after reparse');
  }
}

// ─── 6. Insert transform math (translate + scale + rotate) ───────────────────

{
  const doc: DraftDocument = {
    layers: [{ name: 'L', color: 5 }],
    blocks: [{ name: 'B', entities: [{ kind: 'line', layer: 'L', x1: 0, y1: 0, x2: 10, y2: 0 }] }],
    entities: [{ kind: 'insert', layer: 'L', blockName: 'B', x: 100, y: 50, scale: 2, rotationDeg: 90 }],
  };
  const flat = flattenDraftEntities(doc);
  assert(flat.length === 1 && flat[0].kind === 'line', 'insert transform: one flattened line');
  if (flat[0].kind === 'line') {
    // (10,0) rotated 90° CCW → (0,10), scaled ×2 → (0,20), translated → (100,70).
    assert(approx(flat[0].x1, 100) && approx(flat[0].y1, 50), 'insert transform: local origin lands at insert point');
    assert(approx(flat[0].x2, 100) && approx(flat[0].y2, 70), 'insert transform: rotate90+scale2 endpoint (100,70)');
  }

  // Depth bound: A inserts B inserts C — C's geometry (3rd level) is dropped.
  const nested: DraftDocument = {
    layers: [{ name: 'L', color: 5 }],
    blocks: [
      { name: 'C', entities: [{ kind: 'circle', layer: 'L', cx: 0, cy: 0, r: 1 }] },
      { name: 'B', entities: [
        { kind: 'line', layer: 'L', x1: 0, y1: 0, x2: 1, y2: 0 },
        { kind: 'insert', layer: 'L', blockName: 'C', x: 0, y: 0 },
      ] },
    ],
    entities: [{ kind: 'insert', layer: 'L', blockName: 'B', x: 0, y: 0 }],
  };
  const flatNested = flattenDraftEntities(nested);
  assert(flatNested.some((e) => e.kind === 'circle'), 'insert depth: 2-level nesting resolves');
  const deeper: DraftDocument = {
    ...nested,
    blocks: [
      { name: 'D', entities: [{ kind: 'circle', layer: 'L', cx: 0, cy: 0, r: 1 }] },
      { name: 'C', entities: [{ kind: 'insert', layer: 'L', blockName: 'D', x: 0, y: 0 }] },
      nested.blocks[1],
    ],
  };
  const flatDeeper = flattenDraftEntities(deeper);
  assert(!flatDeeper.some((e) => e.kind === 'circle'), 'insert depth: 3rd nesting level dropped (bounded depth 2)');
  assert(flatDeeper.some((e) => e.kind === 'line'), 'insert depth: shallower geometry still renders');
  // Missing block: contributes nothing, never throws.
  const dangling: DraftDocument = { layers: [], blocks: [], entities: [{ kind: 'insert', layer: '0', blockName: 'NOPE', x: 0, y: 0 }] };
  assert(flattenDraftEntities(dangling).length === 0, 'insert: dangling block reference drops cleanly');
  assert(draftDocumentToSvg(dangling).includes('<svg '), 'insert: dangling block reference still renders valid svg');
}

// ─── 7. XML-escape security ──────────────────────────────────────────────────

{
  const hostile: DraftDocument = {
    layers: [{ name: 'T', color: 3 }],
    blocks: [],
    entities: [
      { kind: 'line', layer: 'T', x1: 0, y1: 0, x2: 100, y2: 100 },
      { kind: 'text', layer: 'T', x: 10, y: 10, height: 5, text: '<script>alert(1)</script>"onload="x' },
    ],
  };
  const svg = draftDocumentToSvg(hostile);
  assert(!svg.includes('<script'), 'security: no raw <script in output');
  assert(svg.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'security: script tag XML-escaped');
  assert(svg.includes('&quot;onload=&quot;'), 'security: quotes escaped (no attribute breakout)');
  assert(escapeXml(`<&>"'`) === '&lt;&amp;&gt;&quot;&#39;', 'security: escapeXml covers all five entities');
  // Hostile background option is rejected to the default.
  const bgSvg = draftDocumentToSvg(hostile, { background: '"><script>1</script>' });
  assert(!bgSvg.includes('<script'), 'security: hostile background option rejected');
  assert(bgSvg.includes('fill="#ffffff"'), 'security: background falls back to default');
}

// ─── 8. Data-URL round-trip ──────────────────────────────────────────────────

{
  const doc: DraftDocument = {
    layers: [{ name: 'L', color: 1 }],
    blocks: [],
    entities: [
      { kind: 'circle', layer: 'L', cx: 0, cy: 0, r: 5 },
      { kind: 'text', layer: 'L', x: 0, y: 0, height: 2, text: 'Ø5 — unicode ✓' },
    ],
  };
  const svg = draftDocumentToSvg(doc);
  const url = svgToDataUrl(svg);
  assert(url.startsWith('data:image/svg+xml;base64,'), 'dataUrl: correct prefix');
  const decoded = Buffer.from(url.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8');
  assert(decoded === svg, 'dataUrl: base64 decodes back to the exact SVG (unicode-safe)');
  assert(base64EncodeUtf8('hello') === Buffer.from('hello', 'utf8').toString('base64'), 'base64: ascii parity with Buffer');
  assert(base64EncodeUtf8('Ø✓€') === Buffer.from('Ø✓€', 'utf8').toString('base64'), 'base64: multibyte parity with Buffer');
}

// ─── 9. Bounded size: 500-entity document ────────────────────────────────────

{
  const entities: DraftEntity[] = [];
  for (let i = 0; i < 500; i += 1) {
    entities.push({ kind: 'line', layer: 'L', x1: (i % 25) * 10.123456, y1: Math.floor(i / 25) * 10.654321, x2: (i % 25) * 10.123456 + 8, y2: Math.floor(i / 25) * 10.654321 + 8 });
  }
  const svg = draftDocumentToSvg({ layers: [{ name: 'L', color: 4 }], blocks: [], entities });
  assert(count(svg, '<line ') === 500, 'bounded: all 500 lines rendered');
  assert(svg.length < 300 * 1024, `bounded: 500-entity SVG is ${svg.length} bytes (< 300 KB)`);
}

// ─── 10. Artifact shape vs the swanbot allowlist ─────────────────────────────

{
  const artifacts = bolt.ok ? draftSvgToArtifacts(bolt.value, 'Bolt Circle Ø120') : [];
  assert(artifacts.length === 2, 'artifacts: image + webpage pair');
  const [img, web] = artifacts;
  // Mirror of normalizeArtifact (src/lib/swanbot.ts): kind allowlist + truthy title.
  const ALLOWED_KINDS = ['summary', 'image', 'translation', 'classification', 'vision', 'audio', 'code', 'webpage', 'table'];
  const ALLOWED_FIELDS = new Set(['kind', 'title', 'content', 'url', 'metadata']);
  for (const a of artifacts) {
    assert(ALLOWED_KINDS.includes(a.kind), `artifacts: kind '${a.kind}' in normalizeArtifact allowlist`);
    assert(typeof a.title === 'string' && a.title.length > 0 && a.title.length <= 200, 'artifacts: truthy bounded title');
    assert(Object.keys(a).every((k) => ALLOWED_FIELDS.has(k)), `artifacts: only allowlisted fields (got ${Object.keys(a).join(',')})`);
    assert(a.content === null || typeof a.content === 'string', 'artifacts: content null-or-string');
    assert(a.url === null || typeof a.url === 'string', 'artifacts: url null-or-string');
  }
  assert(img.kind === 'image' && typeof img.url === 'string' && img.url.startsWith('data:image/svg+xml;base64,'), 'artifacts: image carries svg data URL');
  assert(web.kind === 'webpage' && typeof web.content === 'string' && web.content.startsWith('<!doctype html>'), 'artifacts: webpage carries html doc');
  assert((web.content as string).includes('<svg '), 'artifacts: webpage embeds the svg');
  assert((img.metadata as any)?.source === 'engineering.draft_dxf', 'artifacts: metadata carries source tag');
  // Image data URL decodes to the same svg embedded in the webpage.
  const decoded = Buffer.from((img.url as string).split(',')[1], 'base64').toString('utf8');
  assert((web.content as string).includes(decoded), 'artifacts: image and webpage share one identical svg');
  // Untitled fallback.
  const untitled = draftSvgToArtifacts({ layers: [], blocks: [], entities: [] }, '');
  assert(untitled[0].title === 'Engineering drawing', 'artifacts: empty title falls back');
}

// ─── 11. Totality: empty / malformed / degenerate ────────────────────────────

{
  const empty = draftDocumentToSvg({ layers: [], blocks: [], entities: [] });
  assert(empty.includes('<svg ') && empty.includes('</svg>'), 'totality: empty doc renders valid blank svg');
  assert(parseViewBox(empty) !== null, 'totality: empty doc has a valid viewBox');

  const nan = draftDocumentToSvg({
    layers: [],
    blocks: [],
    entities: [{ kind: 'line', layer: '0', x1: NaN, y1: Infinity, x2: 5, y2: 5 } as DraftEntity],
  });
  assert(!nan.includes('NaN') && !nan.includes('Infinity'), 'totality: NaN/Infinity coords never reach the svg');

  assert(dxfTextToSvg('').includes('<svg '), 'totality: dxfTextToSvg("") renders');
  assert(dxfTextToSvg('complete\ngarbage\nnot dxf at all').includes('<svg '), 'totality: garbage dxf renders');
  assert(dxfTextToSvg(null as unknown as string).includes('<svg '), 'totality: null dxf renders');
  const emptyDxfDoc = parseDxfToDraftDocument('garbage');
  assert(emptyDxfDoc.entities.length === 0 && emptyDxfDoc.layers.length === 0, 'totality: garbage parses to empty doc');
  assert(draftDocumentToSvg(null as unknown as DraftDocument).includes('<svg '), 'totality: null document renders');

  // Zero-degree-span arc renders as a full circle; zero-radius arc drops.
  const arcs = draftDocumentToSvg({
    layers: [],
    blocks: [],
    entities: [
      { kind: 'arc', layer: '0', cx: 0, cy: 0, r: 10, startDeg: 0, endDeg: 360 },
      { kind: 'arc', layer: '0', cx: 0, cy: 0, r: 0, startDeg: 0, endDeg: 90 },
      { kind: 'arc', layer: '0', cx: 0, cy: 0, r: 10, startDeg: 0, endDeg: 270 },
    ],
  });
  assert(count(arcs, '<circle ') === 1, 'arc: 360° span renders as a circle');
  assert(count(arcs, '<path ') === 1 && arcs.includes(' 1 0 '), 'arc: 270° span renders as large-arc sweep-0 path');
}

// ─── 12. ACI table ───────────────────────────────────────────────────────────

{
  assert(aciToHex(1) === '#cc2222' && aciToHex(5) === '#1d4ed8', 'aci: standard indices mapped');
  assert(aciToHex(0) === '#222222' && aciToHex(999) === '#222222' && aciToHex(undefined) === '#222222', 'aci: unknown → default');
  const layered = draftDocumentToSvg({
    layers: [{ name: 'NOCOLOR' }],
    blocks: [],
    entities: [
      { kind: 'line', layer: 'NOCOLOR', x1: 0, y1: 0, x2: 1, y2: 1 },
      { kind: 'line', layer: 'UNDECLARED', x1: 0, y1: 1, x2: 1, y2: 0 },
    ],
  });
  assert(count(layered, 'stroke="#222222"') === 2, 'aci: colorless + undeclared layers both default #222222');
}

// ─── Report ──────────────────────────────────────────────────────────────────

const total = passed + failures.length;
if (failures.length) {
  console.error(`\nengineering-draft-svg-core: ${failures.length}/${total} FAILED`);
  process.exit(1);
}
console.log(`engineering-draft-svg-core: all ${total} assertions passed`);
