/**
 * cadFileInspector — pure, text/size-based inspection of common CAD exchange
 * files (ASCII/binary STL, DXF, STEP) for the engineering/CAD runbooks'
 * 'inspect_measure' evidence steps. Everything here works from a file NAME
 * plus optional TEXT CONTENT and BYTE SIZE the caller already read via the
 * desktop bridge — no fs, no fetch, no react-native, so
 * `npx tsx scripts/cad-file-inspector-smoketest.ts` loads it directly.
 *
 * Honest limitations, stated in results instead of guessed around:
 *   - binary STL: triangle count comes from the size formula
 *     (84-byte header + 50 bytes/triangle); bounding box would need a binary
 *     parse this text inspector does not attempt.
 *   - STL has no units; DXF units come from $INSUNITS when present.
 *   - malformed input yields best-effort partial results + warnings[] —
 *     `inspectCadFileText` NEVER throws.
 */

export type CadFileFormat = 'stl_ascii' | 'stl_binary' | 'dxf' | 'step' | 'unknown';

export interface CadBoundingBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface CadFileInspection {
  format: CadFileFormat;
  fileName: string;
  /** STL: triangle count (ascii: counted; binary: from size formula). */
  triangleCount: number | null;
  /** ASCII STL only — from vertex scan. Binary STL honestly reports null. */
  boundingBox: CadBoundingBox | null;
  /** DXF: entity counts by type inside the ENTITIES section. */
  entityCounts: Record<string, number> | null;
  totalEntities: number | null;
  /** DXF: layer names from the LAYER table (≤100). */
  layers: string[] | null;
  /** DXF: $INSUNITS raw code + plain-language label. */
  insUnits: number | null;
  unitsLabel: string | null;
  /** DXF: $ACADVER value, e.g. AC1027. */
  acadVersion: string | null;
  /** STEP: FILE_SCHEMA value. */
  schema: string | null;
  /** STEP: FILE_NAME name + timestamp fields. */
  stepFileName: string | null;
  stepTimestamp: string | null;
  /** STEP: count of `= PRODUCT(` entities. */
  productCount: number | null;
  note: string | null;
  warnings: string[];
}

// ── Bounds (everything the inspector emits is capped) ────────────────────
const MAX_TEXT_SCAN_CHARS = 2 * 1024 * 1024; // 2MB of text
const MAX_SCAN_LINES = 400_000;
const MAX_LAYERS = 100;
const MAX_COUNT = 1_000_000_000; // 1e9
const MAX_STRING = 200;
const MAX_WARNINGS = 20;
const MAX_DISTINCT_ENTITY_TYPES = 40;

const DXF_INSUNITS_LABELS: Record<number, string> = {
  0: 'unitless',
  1: 'inches',
  2: 'feet',
  3: 'miles',
  4: 'millimeters',
  5: 'centimeters',
  6: 'meters',
  7: 'kilometers',
  8: 'microinches',
  9: 'mils',
  10: 'yards',
  11: 'angstroms',
  12: 'nanometers',
  13: 'microns',
  14: 'decimeters',
};

const ACAD_VERSION_LABELS: Record<string, string> = {
  AC1009: 'AutoCAD R12',
  AC1012: 'AutoCAD R13',
  AC1014: 'AutoCAD R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018',
};

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(MAX_COUNT, Math.trunc(value)));
}

function boundString(value: unknown): string {
  return String(value ?? '').slice(0, MAX_STRING);
}

function pushWarning(inspection: CadFileInspection, warning: string) {
  if (inspection.warnings.length < MAX_WARNINGS) inspection.warnings.push(warning.slice(0, MAX_STRING));
}

function emptyInspection(fileName: string): CadFileInspection {
  return {
    format: 'unknown',
    fileName: boundString(fileName),
    triangleCount: null,
    boundingBox: null,
    entityCounts: null,
    totalEntities: null,
    layers: null,
    insUnits: null,
    unitsLabel: null,
    acadVersion: null,
    schema: null,
    stepFileName: null,
    stepTimestamp: null,
    productCount: null,
    note: null,
    warnings: [],
  };
}

function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(fileName || '').trim());
  return match ? match[1].toLowerCase() : '';
}

// ── ASCII STL ────────────────────────────────────────────────────────────

function looksLikeAsciiStl(text: string): boolean {
  if (!text) return false;
  const head = text.slice(0, 400).trimStart().toLowerCase();
  return head.startsWith('solid') && text.toLowerCase().includes('facet');
}

function inspectAsciiStl(inspection: CadFileInspection, text: string) {
  inspection.format = 'stl_ascii';
  // Triangle count: occurrences of 'facet normal' (case-insensitive, bounded
  // by the 2MB text cap upstream).
  let facetCount = 0;
  const lower = text.toLowerCase();
  let cursor = 0;
  while (facetCount < MAX_COUNT) {
    const idx = lower.indexOf('facet normal', cursor);
    if (idx < 0) break;
    facetCount += 1;
    cursor = idx + 12;
  }
  inspection.triangleCount = clampCount(facetCount);

  // Bounding box from vertex lines (bounded line scan).
  const lines = text.split('\n', MAX_SCAN_LINES);
  let vertexCount = 0;
  let badVertexLines = 0;
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  const vertexRegex = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/i;
  for (const line of lines) {
    const match = vertexRegex.exec(line);
    if (!match) continue;
    const x = Number(match[1]);
    const y = Number(match[2]);
    const z = Number(match[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      badVertexLines += 1;
      continue;
    }
    vertexCount += 1;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (vertexCount > 0) {
    inspection.boundingBox = { minX, minY, minZ, maxX, maxY, maxZ };
  } else {
    pushWarning(inspection, 'no parseable vertex lines found — bounding box unavailable');
  }
  if (badVertexLines > 0) pushWarning(inspection, `${badVertexLines} vertex line(s) had non-numeric coordinates and were skipped`);
  if (facetCount > 0 && vertexCount > 0 && vertexCount !== facetCount * 3) {
    pushWarning(inspection, `vertex count (${vertexCount}) is not 3 per facet (${facetCount} facets) — file may be truncated or malformed`);
  }
  inspection.note = 'STL geometry is unitless — dimensions are in the modeling tool\'s working units (conventionally millimeters).';
}

// ── Binary STL (size formula only) ───────────────────────────────────────

function inspectBinaryStl(inspection: CadFileInspection, fileSizeBytes: number | null) {
  inspection.format = 'stl_binary';
  if (typeof fileSizeBytes === 'number' && Number.isFinite(fileSizeBytes) && fileSizeBytes >= 84 && (fileSizeBytes - 84) % 50 === 0) {
    inspection.triangleCount = clampCount((fileSizeBytes - 84) / 50);
  } else {
    inspection.triangleCount = null;
    if (typeof fileSizeBytes === 'number' && Number.isFinite(fileSizeBytes)) {
      pushWarning(inspection, 'file size does not match the binary STL layout (84-byte header + 50 bytes per triangle) — triangle count unavailable');
    } else {
      pushWarning(inspection, 'fileSizeBytes not provided — binary STL triangle count unavailable');
    }
  }
  inspection.note = 'Binary STL: bounding box requires a binary parse this text inspector does not attempt; triangle count is derived from the file size formula.';
}

// ── DXF ──────────────────────────────────────────────────────────────────

function looksLikeDxf(text: string): boolean {
  if (!text) return false;
  return /(^|\r?\n)\s*0\s*\r?\nSECTION\b/.test(text.slice(0, 4000)) || text.includes('$ACADVER');
}

function inspectDxf(inspection: CadFileInspection, text: string) {
  inspection.format = 'dxf';
  const lines = text.split(/\r\n|\n|\r/, MAX_SCAN_LINES);
  const entityCounts: Record<string, number> = {};
  const layers: string[] = [];
  let totalEntities = 0;
  let distinctEntityTypes = 0;
  let entityTypesCapped = false;
  let layersCapped = false;
  let section = '';
  let expectSectionName = false;
  let awaitingLayerName = false;
  let pendingHeaderVar = '';

  // DXF is strictly (group-code line, value line) pairs from the first line.
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = lines[i].trim();
    const value = lines[i + 1].trim();
    if (code === '0' && value === 'SECTION') {
      expectSectionName = true;
      continue;
    }
    if (expectSectionName && code === '2') {
      section = value.toUpperCase();
      expectSectionName = false;
      continue;
    }
    if (code === '0' && value === 'ENDSEC') {
      section = '';
      awaitingLayerName = false;
      continue;
    }
    if (section === 'HEADER') {
      if (code === '9') {
        pendingHeaderVar = value.toUpperCase();
      } else if (code === '1' && pendingHeaderVar === '$ACADVER' && !inspection.acadVersion) {
        inspection.acadVersion = boundString(value);
      } else if (code === '70' && pendingHeaderVar === '$INSUNITS' && inspection.insUnits === null) {
        const units = parseInt(value, 10);
        if (Number.isFinite(units) && units >= 0 && units <= 30) {
          inspection.insUnits = units;
          inspection.unitsLabel = DXF_INSUNITS_LABELS[units] || `unit code ${units}`;
        }
      }
      continue;
    }
    if (section === 'TABLES') {
      if (code === '0' && value.toUpperCase() === 'LAYER') {
        awaitingLayerName = true;
      } else if (awaitingLayerName && code === '2') {
        if (layers.length < MAX_LAYERS) layers.push(boundString(value));
        else layersCapped = true;
        awaitingLayerName = false;
      }
      continue;
    }
    if (section === 'ENTITIES' && code === '0') {
      const entityType = value.toUpperCase().slice(0, 40);
      if (!entityType || entityType === 'ENDSEC' || entityType === 'SECTION') continue;
      totalEntities += 1;
      if (Object.prototype.hasOwnProperty.call(entityCounts, entityType)) {
        entityCounts[entityType] = clampCount(entityCounts[entityType] + 1);
      } else if (distinctEntityTypes < MAX_DISTINCT_ENTITY_TYPES) {
        entityCounts[entityType] = 1;
        distinctEntityTypes += 1;
      } else {
        entityTypesCapped = true;
      }
    }
  }

  inspection.entityCounts = entityCounts;
  inspection.totalEntities = clampCount(totalEntities);
  inspection.layers = layers;
  if (layersCapped) pushWarning(inspection, `layer table exceeded ${MAX_LAYERS} entries — layer list truncated`);
  if (entityTypesCapped) pushWarning(inspection, `entity type list capped at ${MAX_DISTINCT_ENTITY_TYPES} distinct types (total count still includes the rest)`);
  if (totalEntities === 0) pushWarning(inspection, 'no entities found in the ENTITIES section (file may be tables/blocks only, or truncated)');
  if (inspection.insUnits === null) pushWarning(inspection, '$INSUNITS header not found — drawing units unspecified');
}

// ── STEP ─────────────────────────────────────────────────────────────────

function looksLikeStep(text: string): boolean {
  return !!text && text.slice(0, 200).includes('ISO-10303-21');
}

function inspectStep(inspection: CadFileInspection, text: string) {
  inspection.format = 'step';
  const schemaMatch = /FILE_SCHEMA\s*\(\s*\(\s*'([^']{1,200})'/.exec(text);
  if (schemaMatch) inspection.schema = boundString(schemaMatch[1]);
  else pushWarning(inspection, 'FILE_SCHEMA header not found');
  const fileNameMatch = /FILE_NAME\s*\(\s*'([^']{0,200})'\s*,\s*'([^']{0,200})'/.exec(text);
  if (fileNameMatch) {
    inspection.stepFileName = boundString(fileNameMatch[1]) || null;
    inspection.stepTimestamp = boundString(fileNameMatch[2]) || null;
  } else {
    pushWarning(inspection, 'FILE_NAME header not found');
  }
  // `#12 = PRODUCT(` — the `(` right after PRODUCT keeps PRODUCT_DEFINITION /
  // PRODUCT_CONTEXT entities out of the count.
  let productCount = 0;
  const productRegex = /=\s*PRODUCT\s*\(/g;
  while (productCount < MAX_COUNT) {
    if (!productRegex.exec(text)) break;
    productCount += 1;
  }
  inspection.productCount = clampCount(productCount);
}

// ── Entry point ──────────────────────────────────────────────────────────

export interface CadFileInspectArgs {
  fileName: string;
  textContent?: string | null;
  fileSizeBytes?: number | null;
}

/**
 * Inspect a CAD exchange file from its name + optional text content + size.
 * Detection: ASCII STL (starts with `solid`, contains `facet`), STEP
 * (`ISO-10303-21` header), DXF (group-code structure or .dxf extension with
 * content), binary STL (.stl name without ASCII content — size formula).
 * Never throws; malformed input yields partial results + warnings.
 */
export function inspectCadFileText(args: CadFileInspectArgs): CadFileInspection {
  const fileName = typeof args?.fileName === 'string' ? args.fileName : '';
  const inspection = emptyInspection(fileName);
  try {
    const rawText = typeof args?.textContent === 'string' ? args.textContent : '';
    const text = rawText.slice(0, MAX_TEXT_SCAN_CHARS);
    if (rawText.length > MAX_TEXT_SCAN_CHARS) {
      pushWarning(inspection, 'text content truncated to 2MB for scanning — counts may be partial');
    }
    const sizeRaw = args?.fileSizeBytes;
    const fileSizeBytes = typeof sizeRaw === 'number' && Number.isFinite(sizeRaw) ? Math.max(0, Math.trunc(sizeRaw)) : null;
    const ext = extensionOf(fileName);

    if (looksLikeStep(text)) {
      inspectStep(inspection, text);
      return inspection;
    }
    if (looksLikeAsciiStl(text)) {
      inspectAsciiStl(inspection, text);
      return inspection;
    }
    if (text && (ext === 'dxf' || looksLikeDxf(text))) {
      inspectDxf(inspection, text);
      return inspection;
    }
    if (ext === 'stl') {
      // .stl without ASCII markers → treat as binary (spec: content absent
      // or not ascii). Size formula only; no fabricated geometry.
      inspectBinaryStl(inspection, fileSizeBytes);
      return inspection;
    }
    if (ext === 'step' || ext === 'stp') {
      inspection.note = text
        ? 'File is named like STEP but the ISO-10303-21 header is missing — not a readable STEP file.'
        : 'File is named like STEP but no text content was provided — pass the file text to inspect it.';
      if (text) pushWarning(inspection, 'missing ISO-10303-21 header');
      return inspection;
    }
    if (ext === 'dxf') {
      inspection.note = 'File is named like DXF but no text content was provided — pass the file text to inspect it.';
      return inspection;
    }
    inspection.note = `Could not identify ${boundString(fileName) || 'the file'} as STL, DXF, or STEP from the provided name/content.`;
    return inspection;
  } catch (err) {
    pushWarning(inspection, `inspection stopped early: ${String((err as Error)?.message || err).slice(0, 120)}`);
    return inspection;
  }
}

// ── Plain-language description ───────────────────────────────────────────

function formatInt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'an unknown number of';
  return Math.trunc(value).toLocaleString('en-US');
}

function formatDim(value: number): string {
  return String(Number(value.toFixed(1)));
}

/** 1-3 plain sentences a chat user can read without knowing CAD internals. */
export function describeCadInspectionForChat(inspection: CadFileInspection): string {
  if (!inspection || typeof inspection !== 'object') return 'No inspection result available.';
  const name = inspection.fileName ? ` (${inspection.fileName})` : '';
  if (inspection.format === 'stl_ascii') {
    const parts: string[] = [`ASCII STL${name} with ${formatInt(inspection.triangleCount)} triangles.`];
    if (inspection.boundingBox) {
      const b = inspection.boundingBox;
      parts.push(`Bounding box ${formatDim(b.maxX - b.minX)} × ${formatDim(b.maxY - b.minY)} × ${formatDim(b.maxZ - b.minZ)} (units unspecified — STL files carry no units).`);
    }
    if (inspection.warnings.length > 0) parts.push(`Note: ${inspection.warnings[0]}.`);
    return parts.slice(0, 3).join(' ');
  }
  if (inspection.format === 'stl_binary') {
    const count = inspection.triangleCount !== null
      ? `about ${formatInt(inspection.triangleCount)} triangles (calculated from file size)`
      : 'a triangle count that could not be determined from the file size';
    return `Binary STL${name} with ${count}. Reading the bounding box would need a binary parse, which this quick inspection does not do.`;
  }
  if (inspection.format === 'dxf') {
    const parts: string[] = [];
    const topTypes = Object.entries(inspection.entityCounts || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([type, count]) => `${formatInt(count)} ${type}`)
      .join(', ');
    const layerCount = inspection.layers?.length ?? 0;
    const layerNames = (inspection.layers || []).slice(0, 3).join(', ');
    parts.push(`DXF drawing${name} with ${formatInt(inspection.totalEntities)} entities${topTypes ? ` (${topTypes})` : ''} across ${formatInt(layerCount)} layer${layerCount === 1 ? '' : 's'}${layerNames ? `: ${layerNames}` : ''}.`);
    if (inspection.unitsLabel) parts.push(`Units: ${inspection.unitsLabel}.`);
    else parts.push('Units are unspecified in the header.');
    if (inspection.acadVersion) {
      const label = ACAD_VERSION_LABELS[inspection.acadVersion];
      parts.push(`Format version ${inspection.acadVersion}${label ? ` (${label})` : ''}.`);
    }
    return parts.slice(0, 3).join(' ');
  }
  if (inspection.format === 'step') {
    const parts: string[] = [`STEP model${name}${inspection.schema ? ` using schema ${inspection.schema.split(' ')[0]}` : ''} with ${formatInt(inspection.productCount)} product${inspection.productCount === 1 ? '' : 's'}.`];
    if (inspection.stepFileName || inspection.stepTimestamp) {
      parts.push(`Header says it was written${inspection.stepTimestamp ? ` on ${inspection.stepTimestamp}` : ''}${inspection.stepFileName ? ` as ${inspection.stepFileName}` : ''}.`);
    }
    return parts.slice(0, 3).join(' ');
  }
  return inspection.note || `Could not identify ${inspection.fileName || 'the file'} as a known CAD format.`;
}
