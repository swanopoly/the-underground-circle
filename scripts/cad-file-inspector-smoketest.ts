/**
 * cad-file-inspector-smoketest — verifies the pure text/size-based CAD file
 * inspector (src/lib/cadFileInspector.ts): ASCII STL triangle/bbox scan,
 * binary STL size formula, DXF header/layer/entity parsing, STEP header
 * extraction, never-throws behavior on malformed input, and plain-language
 * chat descriptions.
 *
 * Run: npx tsx scripts/cad-file-inspector-smoketest.ts
 */

import {
  describeCadInspectionForChat,
  inspectCadFileText,
} from '../src/lib/cadFileInspector';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const ASCII_STL = [
  'solid plate',
  '  facet normal 0 0 1',
  '    outer loop',
  '      vertex 0 0 0',
  '      vertex 120 0 0',
  '      vertex 120 80 15',
  '    endloop',
  '  endfacet',
  '  facet normal 0 0 1',
  '    outer loop',
  '      vertex 0 0 0',
  '      vertex 120 80 15',
  '      vertex 0 80 0',
  '    endloop',
  '  endfacet',
  'endsolid plate',
].join('\n');

const DXF_FIXTURE = [
  '0', 'SECTION',
  '2', 'HEADER',
  '9', '$ACADVER',
  '1', 'AC1027',
  '9', '$INSUNITS',
  '70', '4',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'TABLES',
  '0', 'TABLE',
  '2', 'LAYER',
  '70', '2',
  '0', 'LAYER',
  '2', 'WALLS',
  '70', '0',
  '0', 'LAYER',
  '2', 'DIMS',
  '70', '0',
  '0', 'ENDTAB',
  '0', 'ENDSEC',
  '0', 'SECTION',
  '2', 'ENTITIES',
  '0', 'LINE',
  '8', 'WALLS',
  '10', '0.0',
  '20', '0.0',
  '11', '100.0',
  '21', '0.0',
  '0', 'CIRCLE',
  '8', 'WALLS',
  '10', '50.0',
  '20', '50.0',
  '40', '10.0',
  '0', 'LWPOLYLINE',
  '8', 'DIMS',
  '90', '2',
  '0', 'ENDSEC',
  '0', 'EOF',
].join('\r\n');

const STEP_FIXTURE = [
  'ISO-10303-21;',
  'HEADER;',
  "FILE_DESCRIPTION((''),'2;1');",
  "FILE_NAME('bracket.step','2024-03-01T10:00:00',('author'),(''),'processor','origin','');",
  "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));",
  'ENDSEC;',
  'DATA;',
  "#1=PRODUCT('bracket','bracket','',(#2));",
  "#2=PRODUCT_CONTEXT('',#3,'mechanical');",
  "#10 = PRODUCT('lid','lid','',(#2));",
  "#11=PRODUCT_DEFINITION('design','',#4,#5);",
  'ENDSEC;',
  'END-ISO-10303-21;',
].join('\n');

// ── ASCII STL ───────────────────────────────────────────────────────────────
{
  const inspection = inspectCadFileText({ fileName: 'plate.stl', textContent: ASCII_STL });
  expect(inspection.format === 'stl_ascii', `ascii stl detected (got ${inspection.format})`);
  expect(inspection.triangleCount === 2, `facet count = 2 (got ${inspection.triangleCount})`);
  expect(!!inspection.boundingBox, 'bounding box computed from vertex lines');
  expect(inspection.boundingBox?.minX === 0 && inspection.boundingBox?.minY === 0 && inspection.boundingBox?.minZ === 0, 'bbox min is 0,0,0');
  expect(inspection.boundingBox?.maxX === 120 && inspection.boundingBox?.maxY === 80 && inspection.boundingBox?.maxZ === 15, 'bbox max is 120,80,15');
  expect(inspection.warnings.length === 0, 'well-formed ascii stl has no warnings');
  const description = describeCadInspectionForChat(inspection);
  expect(description.includes('2 triangles'), 'description states the triangle count');
  expect(description.includes('120 × 80 × 15'), `description states bbox dims (got: ${description})`);
  expect(/units unspecified|no units/i.test(description), 'description is honest about STL having no units');
  pass('ascii stl: triangles, bbox, honest units note');
}

// ── ASCII STL malformed ─────────────────────────────────────────────────────
{
  const truncated = 'solid broken\n  facet normal 0 0 1\n    outer loop\n      vertex 1 2 3\n      vertex 4 5 6\n    endloop\n  endfacet\n';
  const inspection = inspectCadFileText({ fileName: 'broken.stl', textContent: truncated });
  expect(inspection.format === 'stl_ascii', 'truncated ascii stl still classified');
  expect(inspection.triangleCount === 1, 'facet still counted');
  expect(inspection.warnings.some((w) => w.includes('not 3 per facet')), 'vertex/facet mismatch warned');
  const garbageVertices = 'solid g\n  facet normal 0 0 1\n    vertex a b c\n  endfacet\nendsolid g';
  const inspection2 = inspectCadFileText({ fileName: 'g.stl', textContent: garbageVertices });
  expect(inspection2.boundingBox === null, 'non-numeric vertices yield no bbox');
  expect(inspection2.warnings.length > 0, 'non-numeric vertices produce warnings, not throws');
  pass('malformed ascii stl: partial results + warnings, no throw');
}

// ── Binary STL (size formula) ───────────────────────────────────────────────
{
  const inspection = inspectCadFileText({ fileName: 'housing.stl', fileSizeBytes: 84 + 50 * 5000 });
  expect(inspection.format === 'stl_binary', 'stl without ascii content treated as binary');
  expect(inspection.triangleCount === 5000, `size formula (size-84)/50 (got ${inspection.triangleCount})`);
  expect(inspection.boundingBox === null, 'binary stl honestly has no bbox from text inspection');
  expect(!!inspection.note && /binary parse/i.test(inspection.note), 'note explains the binary-parse limitation');
  const description = describeCadInspectionForChat(inspection);
  expect(description.includes('5,000'), 'description formats the count with separators');
  expect(/file size/i.test(description), 'description says the count came from file size');
  const badSize = inspectCadFileText({ fileName: 'odd.stl', fileSizeBytes: 100 });
  expect(badSize.triangleCount === null, 'size not matching the 84+50n layout gives null count');
  expect(badSize.warnings.some((w) => w.includes('50 bytes per triangle')), 'layout mismatch warned');
  const noSize = inspectCadFileText({ fileName: 'nosize.stl' });
  expect(noSize.format === 'stl_binary' && noSize.triangleCount === null, 'no size + no text still classifies, count honest null');
  const garbageText = inspectCadFileText({ fileName: 'weird.stl', textContent: 'PK\u0003\u0004 not really stl text', fileSizeBytes: 84 + 50 * 3 });
  expect(garbageText.format === 'stl_binary' && garbageText.triangleCount === 3, 'non-ascii content falls back to binary size formula');
  pass('binary stl: size formula, honest nulls, warnings');
}

// ── DXF ─────────────────────────────────────────────────────────────────────
{
  const inspection = inspectCadFileText({ fileName: 'floorplan.dxf', textContent: DXF_FIXTURE });
  expect(inspection.format === 'dxf', 'dxf detected');
  expect(inspection.totalEntities === 3, `3 entities counted (got ${inspection.totalEntities})`);
  expect(inspection.entityCounts?.LINE === 1 && inspection.entityCounts?.CIRCLE === 1 && inspection.entityCounts?.LWPOLYLINE === 1, 'per-type entity counts');
  expect(JSON.stringify(inspection.layers) === JSON.stringify(['WALLS', 'DIMS']), `layer names from LAYER table (got ${JSON.stringify(inspection.layers)})`);
  expect(inspection.insUnits === 4, '$INSUNITS raw code captured');
  expect(inspection.unitsLabel === 'millimeters', '$INSUNITS mapped to plain language');
  expect(inspection.acadVersion === 'AC1027', '$ACADVER captured');
  const description = describeCadInspectionForChat(inspection);
  expect(description.includes('3 entities'), 'description states entity total');
  expect(description.includes('WALLS'), 'description lists layer names');
  expect(description.includes('millimeters'), 'description states units');
  expect(description.includes('AC1027'), 'description states drawing version');
  pass('dxf: entities, layers, units, version + description');
}

// ── DXF bounds + edge cases ─────────────────────────────────────────────────
{
  const manyLayers: string[] = ['0', 'SECTION', '2', 'TABLES'];
  for (let i = 0; i < 120; i += 1) manyLayers.push('0', 'LAYER', '2', `L${i}`);
  manyLayers.push('0', 'ENDSEC', '0', 'EOF');
  const inspection = inspectCadFileText({ fileName: 'layers.dxf', textContent: manyLayers.join('\n') });
  expect(inspection.layers?.length === 100, `layer list capped at 100 (got ${inspection.layers?.length})`);
  expect(inspection.warnings.some((w) => w.includes('truncated')), 'layer cap warned');
  const noText = inspectCadFileText({ fileName: 'empty.dxf' });
  expect(noText.format === 'unknown', 'dxf name without content stays unknown');
  expect(!!noText.note && /text content/i.test(noText.note), 'note asks for text content');
  const emptyEntities = inspectCadFileText({ fileName: 'tables-only.dxf', textContent: '0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF' });
  expect(emptyEntities.format === 'dxf' && emptyEntities.totalEntities === 0, 'entity-free dxf counts zero');
  expect(emptyEntities.warnings.some((w) => w.includes('no entities')), 'zero entities warned');
  pass('dxf bounds: 100-layer cap, missing content, empty entities');
}

// ── STEP ────────────────────────────────────────────────────────────────────
{
  const inspection = inspectCadFileText({ fileName: 'bracket.step', textContent: STEP_FIXTURE });
  expect(inspection.format === 'step', 'step detected via ISO-10303-21 header');
  expect(inspection.schema?.startsWith('AUTOMOTIVE_DESIGN'), `FILE_SCHEMA captured (got ${inspection.schema})`);
  expect(inspection.stepFileName === 'bracket.step', 'FILE_NAME name captured');
  expect(inspection.stepTimestamp === '2024-03-01T10:00:00', 'FILE_NAME timestamp captured');
  expect(inspection.productCount === 2, `PRODUCT count excludes PRODUCT_CONTEXT/_DEFINITION (got ${inspection.productCount})`);
  const description = describeCadInspectionForChat(inspection);
  expect(description.includes('2 products'), 'description states product count');
  expect(description.includes('AUTOMOTIVE_DESIGN'), 'description states schema');
  const renamed = inspectCadFileText({ fileName: 'export.txt', textContent: STEP_FIXTURE });
  expect(renamed.format === 'step', 'header wins over file extension');
  const headerless = inspectCadFileText({ fileName: 'fake.step', textContent: 'not a step file at all' });
  expect(headerless.format === 'unknown', 'named .step without header is not claimed as step');
  expect(headerless.warnings.some((w) => w.includes('ISO-10303-21')), 'missing header warned');
  pass('step: schema, file name, timestamp, product count, header rules');
}

// ── Unknown + never-throws ──────────────────────────────────────────────────
{
  const unknown = inspectCadFileText({ fileName: 'notes.xyz', textContent: 'hello world' });
  expect(unknown.format === 'unknown', 'unrecognized content is unknown');
  expect(!!unknown.note, 'unknown result carries an explanatory note');
  const noArgs = inspectCadFileText({} as never);
  expect(noArgs.format === 'unknown', 'missing fields never throw');
  const nullish = inspectCadFileText({ fileName: null as never, textContent: null, fileSizeBytes: Number.NaN });
  expect(nullish.format === 'unknown', 'null-ish fields never throw');
  const controlChars = inspectCadFileText({ fileName: 'x.dxf', textContent: '0\u0000\nSECTION\u0007\n\u0001garbage' });
  expect(controlChars.format === 'dxf' || controlChars.format === 'unknown', 'control characters never throw');
  const huge = inspectCadFileText({ fileName: 'big.stl', textContent: `solid big\nfacet normal 0 0 1\n${'vertex 1 2 3\n'.repeat(200_000)}` + 'x'.repeat(2_500_000) });
  expect(huge.format === 'stl_ascii', 'huge input still classifies');
  expect(huge.warnings.some((w) => w.includes('truncated')), 'oversize text truncation warned');
  const longName = inspectCadFileText({ fileName: 'n'.repeat(500) + '.stl', fileSizeBytes: 84 });
  expect(longName.fileName.length <= 200, 'file name bounded to 200 chars');
  expect(longName.triangleCount === 0, 'size exactly 84 → zero triangles via formula');
  pass('unknown + hostile inputs: bounded, warned, never throw');
}

// ── Descriptions are plain language ─────────────────────────────────────────
{
  const samples = [
    inspectCadFileText({ fileName: 'plate.stl', textContent: ASCII_STL }),
    inspectCadFileText({ fileName: 'housing.stl', fileSizeBytes: 84 + 50 * 12 }),
    inspectCadFileText({ fileName: 'floorplan.dxf', textContent: DXF_FIXTURE }),
    inspectCadFileText({ fileName: 'bracket.step', textContent: STEP_FIXTURE }),
    inspectCadFileText({ fileName: 'notes.xyz', textContent: 'hello' }),
  ];
  for (const sample of samples) {
    const description = describeCadInspectionForChat(sample);
    expect(typeof description === 'string' && description.length > 0, `description exists for ${sample.format}`);
    expect(!description.includes('undefined') && !description.includes('null'), `no leaked undefined/null for ${sample.format}`);
    expect(!description.includes('{') && !description.includes('}'), `no JSON braces for ${sample.format}`);
    expect(description.length <= 400, `description bounded for ${sample.format}`);
    const sentenceCount = (description.match(/\./g) || []).length;
    expect(sentenceCount >= 1 && sentenceCount <= 4, `1-3 sentences for ${sample.format} (got ~${sentenceCount})`);
  }
  pass('chat descriptions: plain language, bounded, 1-3 sentences');
}

// ── HUNT invariant pin: pathological input never hangs (ReDoS/unbounded loop) ─
{
  const budgetMs = 2000;
  const cases: Array<[string, () => void]> = [
    // Unterminated STEP quoted headers (regex has bounded {1,200} — must not backtrack forever).
    ['step-unterminated-quote', () => inspectCadFileText({ fileName: 'x.step', textContent: 'ISO-10303-21;\nFILE_SCHEMA(((\'' + 'A'.repeat(2_000_000) })],
    ['step-many-quotes', () => inspectCadFileText({ fileName: 'x.step', textContent: 'ISO-10303-21;\nFILE_NAME(' + "'".repeat(400_000) })],
    // Many =PRODUCT( hits (global-regex loop advances lastIndex; bounded by 2MB text cap).
    ['step-many-products', () => inspectCadFileText({ fileName: 'x.step', textContent: 'ISO-10303-21;\n' + '=PRODUCT('.repeat(250_000) })],
    // Dense DXF group-code pairs (bounded line scan).
    ['dxf-many-entities', () => inspectCadFileText({ fileName: 'x.dxf', textContent: '0\nSECTION\n2\nENTITIES\n' + '0\nLINE\n'.repeat(300_000) })],
    // Giant single-line STL (facet substring + line-anchored vertex regex on one huge line).
    ['stl-one-huge-line', () => inspectCadFileText({ fileName: 'x.stl', textContent: 'solid x facet ' + 'vertex 1 2 3 '.repeat(300_000) })],
  ];
  for (const [name, run] of cases) {
    const started = Date.now();
    run();
    const elapsed = Date.now() - started;
    expect(elapsed < budgetMs, `pathological ${name} completes under ${budgetMs}ms (got ${elapsed}ms) — no ReDoS/hang`);
  }
  pass('pathological input is bounded — no ReDoS or unbounded loop');
}

// ── HUNT invariant pin: file-controlled names (periods, over-long, huge counts)
// keep the chat description bounded and never leak JSON/undefined/null ──────────
{
  const dottedDxf = [
    '0', 'SECTION', '2', 'TABLES',
    '0', 'LAYER', '2', 'A.B.C.D.E.F',
    '0', 'LAYER', '2', 'L'.repeat(400),
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '0', 'CIRCLE',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\n');
  const dottedStep = [
    'ISO-10303-21;',
    "FILE_NAME('my.file.v1.2.3.step','2024.01.02',('a'),(''),'p','o','');",
    "FILE_SCHEMA(('CONFIG_CONTROL_DESIGN v1.2.3 { ... dotted ... }'));",
    "#1=PRODUCT('p','p','',(#2));",
  ].join('\n');
  for (const [label, inspection] of [
    ['dotted-dxf', inspectCadFileText({ fileName: 'weird.name.with.dots.dxf', textContent: dottedDxf })],
    ['dotted-step', inspectCadFileText({ fileName: 'x.step', textContent: dottedStep })],
  ] as const) {
    const description = describeCadInspectionForChat(inspection);
    expect(description.length <= 400, `${label}: dotted/over-long names keep description ≤400 chars (got ${description.length})`);
    expect(!description.includes('undefined') && !description.includes('null'), `${label}: no leaked undefined/null`);
    expect(!description.includes('{') && !description.includes('}'), `${label}: no JSON braces leak`);
  }
  pass('dotted/over-long file-controlled names keep descriptions bounded and clean');
}

if (failures > 0) {
  console.error(`\n${failures} cad file inspector smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll cad file inspector smoke cases passed.');
