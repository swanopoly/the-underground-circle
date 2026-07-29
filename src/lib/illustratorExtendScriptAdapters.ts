/**
 * illustratorExtendScriptAdapters — pure JSX (ExtendScript) builders for the
 * Mac bridge's deterministic Illustrator tools:
 *
 *   - illustrator_document_status (READ-ONLY document/artboard observation)
 *   - illustrator_export_proof    (PNG/SVG proof export to a NEW file)
 *
 * LOCKSTEP(scripts/claude-bridge.js): the bridge is a standalone Node script
 * that cannot import TS, so it carries byte-identical duplicates of the JSX
 * prelude and the two JSX bodies plus the enum/range validation below (see
 * the `// LOCKSTEP(src/lib/illustratorExtendScriptAdapters.ts)` markers there
 * — same convention as photoshopExtendScriptAdapters). This module is the
 * smoke-tested source of truth; keep both sides in step.
 *
 * Pure module — no react-native, no supabase, no imports. Smoke:
 * `npx tsx scripts/illustrator-extendscript-adapters-smoketest.ts`.
 *
 * Safety contract shared by both builders:
 *   - document_status is READ-ONLY: it never activates, saves, exports, or
 *     mutates any document or app state.
 *   - export_proof writes ONLY to the validated outputPath via
 *     doc.exportFile. The SOURCE document is never saved, closed, or
 *     re-associated with another file on any path.
 *   - PDF is deliberately NOT a supported export format: Illustrator's
 *     scripting DOM can only produce PDF through a source-document "save as"
 *     (PDFSaveOptions), which re-associates the open document with the new
 *     file — the document's backing file becomes the PDF and its saved flag
 *     flips. There is no ExportType for PDF, so an honest PDF export without
 *     touching the source is impossible; the format enum is png|svg only.
 *   - Guarded scripts verify the target document first (documentMatches on
 *     expectedDocumentName) and fail closed with 'document_mismatch' when a
 *     name was given but does not match.
 *   - All embedded arguments go through JSON.stringify so user text can never
 *     escape its ExtendScript string literal.
 *   - Every script returns a single JSON.stringify-shaped result line with
 *     `ok`/`error` fields so callers can fail closed on anything unexpected.
 */

export type IllustratorExtendScriptBuild = { jsx: string; errors: string[] };

export type IllustratorParamCheck<T> = { ok: true; value: T } | { ok: false; error: string };

// ─── Enums (LOCKSTEP(scripts/claude-bridge.js): ILLUSTRATOR_* consts) ──────

export const ILLUSTRATOR_BRIDGE_APP_NAME_PATTERN = /^[A-Za-z0-9 .\-_()]+$/;

/**
 * png|svg ONLY. PDF is excluded on purpose — see the module header: the
 * Illustrator DOM has no PDF ExportType, and the save-based PDF path would
 * re-associate (and effectively save) the source document.
 */
export const ILLUSTRATOR_EXPORT_PROOF_FORMATS = ['png', 'svg'] as const;
export type IllustratorExportProofFormat = (typeof ILLUSTRATOR_EXPORT_PROOF_FORMATS)[number];

export const ILLUSTRATOR_MIN_SCALE_PERCENT = 50;
export const ILLUSTRATOR_MAX_SCALE_PERCENT = 400;
export const ILLUSTRATOR_DEFAULT_SCALE_PERCENT = 100;

/** Document summaries reported by illustrator_document_status are bounded. */
export const ILLUSTRATOR_MAX_STATUS_DOCUMENTS = 12;

// ─── Scalar validators (LOCKSTEP(scripts/claude-bridge.js): endpoint 400s) ─

// Safe ExtendScript string/JSON embed: JSON.stringify + escape the ES3 line
// terminators U+2028/U+2029 (which JSON.stringify emits RAW) so an embedded
// value cannot break out of the generated string literal. LOCKSTEP with
// claude-bridge.js jsxLiteral.
function jsxLiteral(value: unknown): string {
  return JSON.stringify(value === undefined ? '' : value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function normalizeIllustratorBridgeAppName(value: unknown): IllustratorParamCheck<string> {
  const appName = String(value ?? 'Illustrator').trim() || 'Illustrator';
  if (!ILLUSTRATOR_BRIDGE_APP_NAME_PATTERN.test(appName)) {
    return { ok: false, error: 'Invalid appName.' };
  }
  return { ok: true, value: appName };
}

export function normalizeIllustratorExpectedDocumentName(value: unknown): IllustratorParamCheck<string> {
  const name = value == null ? '' : String(value).trim();
  if (name.length > 260 || /[\x00]/.test(name)) {
    return { ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' };
  }
  return { ok: true, value: name };
}

/**
 * Optional PNG raster scale: undefined/null -> null (not provided). When
 * provided it must be an actual finite integer 50..400 — numeric strings and
 * fractions are rejected (fail closed, mirrors the endpoint 400s).
 */
export function normalizeIllustratorScalePercent(value: unknown): IllustratorParamCheck<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || !Number.isInteger(value)
    || value < ILLUSTRATOR_MIN_SCALE_PERCENT
    || value > ILLUSTRATOR_MAX_SCALE_PERCENT
  ) {
    return { ok: false, error: `scalePercent must be a finite integer between ${ILLUSTRATOR_MIN_SCALE_PERCENT} and ${ILLUSTRATOR_MAX_SCALE_PERCENT}.` };
  }
  return { ok: true, value };
}

function extensionOf(pathValue: string): string {
  const match = /\.([A-Za-z0-9]{1,12})$/.exec(String(pathValue || '').trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Pure mirror of the bridge's `validateDesktopPathServer` (length,
 * control-char, and shell-metachar rejects — LOCKSTEP) plus the export-proof
 * extension contract: the output must be .png or .svg. `.pdf` is called out
 * explicitly in the error because it is excluded by design, not by omission.
 */
export function validateIllustratorOutputPathParam(raw: unknown): IllustratorParamCheck<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'outputPath must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'outputPath is empty' };
  if (trimmed.length > 1024) return { ok: false, error: 'outputPath exceeds 1024 chars' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\u2028\u2029]/.test(trimmed)) return { ok: false, error: 'outputPath contains control characters' };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: 'outputPath contains shell metacharacter' };
  const ext = extensionOf(trimmed);
  if (!(ILLUSTRATOR_EXPORT_PROOF_FORMATS as readonly string[]).includes(ext)) {
    return {
      ok: false,
      error: 'outputPath must end in .png or .svg (.pdf is unsupported: Illustrator can only write PDF by re-associating/saving the source document).',
    };
  }
  return { ok: true, value: trimmed };
}

// ─── JSX prelude ────────────────────────────────────────────────────────────

/**
 * LOCKSTEP(scripts/claude-bridge.js): byte-identical copy of the bridge's
 * `illustratorJsxPrelude` — document matching, JSON emit helpers, and the
 * artboard/layer/selection observers shared by every Illustrator JSX script.
 *
 * Illustrator DOM notes baked in here:
 *   - artboardRect is [left, top, right, bottom] in points with a y-up axis,
 *     so width = right - left and height = top - bottom.
 *   - doc.fullName/doc.path throw for never-saved documents — every access
 *     is try/catch-wrapped and degrades to ""/0 instead of aborting.
 *   - doc.saved === true means "no unsaved changes".
 */
export function illustratorExtendScriptJsxPrelude(
  { expectedDocumentName }: { expectedDocumentName?: string | null },
): string {
  return `
var expectedDocumentName = ${jsxLiteral(String(expectedDocumentName ?? ''))};

function normalizeDocName(value) {
  return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
}

function documentPath(value) {
  try { return value.fullName.fsName; } catch (_) { return ""; }
}

function collectionLength(value) {
  try { return value ? value.length : 0; } catch (_) { return 0; }
}

function roundPt(value) {
  var parsed = Number(value);
  return isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function documentMatches(value) {
  if (!value) return false;
  var docName = String(value.name || "");
  if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
  return !expectedDocumentName;
}

function findTargetDocument() {
  try {
    for (var i = 0; i < app.documents.length; i += 1) {
      if (documentMatches(app.documents[i])) return app.documents[i];
    }
  } catch (_) {}
  if (!expectedDocumentName && collectionLength(app.documents) > 0) {
    try { return app.activeDocument; } catch (_) {}
  }
  return null;
}

function jsonEscape(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\\\\/g, "\\\\\\\\")
    .replace(/"/g, "\\\\\\"")
    .replace(/\\r/g, "\\\\r")
    .replace(/\\n/g, "\\\\n")
    .replace(/\\t/g, "\\\\t");
}

function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }
function jsonNullableString(value) { return value === undefined || value === null || value === "" ? "null" : jsonString(value); }
function jsonNumber(value) { var parsed = Number(value); return isFinite(parsed) ? String(parsed) : "0"; }
function jsonBoolean(value) { return value === true ? "true" : "false"; }
function jsonArray(values) { return "[" + values.join(",") + "]"; }

function documentSaved(doc) {
  try { return doc.saved === true; } catch (_) { return false; }
}

function artboardWidthPt(doc) {
  try {
    var rect = doc.artboards[0].artboardRect;
    return roundPt(Number(rect[2]) - Number(rect[0]));
  } catch (_) {}
  try { return roundPt(doc.width); } catch (_) {}
  return 0;
}

function artboardHeightPt(doc) {
  try {
    var rect = doc.artboards[0].artboardRect;
    return roundPt(Number(rect[1]) - Number(rect[3]));
  } catch (_) {}
  try { return roundPt(doc.height); } catch (_) {}
  return 0;
}

function documentArtboardCount(doc) {
  try { return collectionLength(doc.artboards); } catch (_) { return 0; }
}

function documentLayerCount(doc) {
  try { return collectionLength(doc.layers); } catch (_) { return 0; }
}

function documentSelectionCount(doc) {
  try {
    var sel = doc.selection;
    if (!sel) return 0;
    return Number(sel.length) || 0;
  } catch (_) { return 0; }
}
`;
}

// ─── 1) Document status (READ-ONLY) ─────────────────────────────────────────

export type IllustratorDocumentStatusParams = {
  appName?: string;
  expectedDocumentName?: string | null;
};

export type NormalizedIllustratorDocumentStatusParams = {
  appName: string;
  expectedDocumentName: string;
};

export function validateIllustratorDocumentStatusParams(
  params: IllustratorDocumentStatusParams,
): { ok: true; params: NormalizedIllustratorDocumentStatusParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): illustratorDocumentStatusJsxBody —
 * keep this JSX body byte-identical with the bridge duplicate. READ-ONLY:
 * it never assigns app.activeDocument, never saves, never exports.
 */
function illustratorDocumentStatusJsxBody(): string {
  return `
  function documentSummaryJson(doc) {
    return "{" + [
      "\\"name\\":" + jsonString(doc.name),
      "\\"path\\":" + jsonNullableString(doc.path),
      "\\"modified\\":" + jsonBoolean(doc.modified),
      "\\"saved\\":" + jsonBoolean(doc.saved),
      "\\"widthPt\\":" + jsonNumber(doc.widthPt),
      "\\"heightPt\\":" + jsonNumber(doc.heightPt),
      "\\"artboardCount\\":" + jsonNumber(doc.artboardCount),
      "\\"layerCount\\":" + jsonNumber(doc.layerCount),
      "\\"selectionCount\\":" + jsonNumber(doc.selectionCount)
    ].join(",") + "}";
  }

  function makeDocumentSummary(doc) {
    var saved = documentSaved(doc);
    return {
      name: String(doc && doc.name ? doc.name : ""),
      path: documentPath(doc),
      modified: !saved,
      saved: saved,
      widthPt: artboardWidthPt(doc),
      heightPt: artboardHeightPt(doc),
      artboardCount: documentArtboardCount(doc),
      layerCount: documentLayerCount(doc),
      selectionCount: documentSelectionCount(doc)
    };
  }

  function stringifyIllustratorStatus(value) {
    var docs = [];
    try {
      for (var i = 0; i < value.documents.length; i += 1) docs.push(documentSummaryJson(value.documents[i]));
    } catch (_) {}
    return "{" + [
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"status\\":" + jsonString(value.status),
      "\\"documentCount\\":" + jsonNumber(value.documentCount),
      "\\"activeDocumentName\\":" + jsonNullableString(value.activeDocumentName),
      "\\"activeDocumentPath\\":" + jsonNullableString(value.activeDocumentPath),
      "\\"widthPt\\":" + jsonNumber(value.widthPt),
      "\\"heightPt\\":" + jsonNumber(value.heightPt),
      "\\"artboardCount\\":" + jsonNumber(value.artboardCount),
      "\\"layerCount\\":" + jsonNumber(value.layerCount),
      "\\"selectionCount\\":" + jsonNumber(value.selectionCount),
      "\\"documents\\":" + jsonArray(docs),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  // READ-ONLY observation: never activates, saves, exports, or mutates any
  // document or app state — it only reads collections and reports.
  var out = {
    appRunning: true,
    appName: String(app.name || "Adobe Illustrator"),
    status: "unknown",
    documentCount: collectionLength(app.documents),
    activeDocumentName: null,
    activeDocumentPath: null,
    widthPt: 0,
    heightPt: 0,
    artboardCount: 0,
    layerCount: 0,
    selectionCount: 0,
    documents: [],
    error: null
  };

  try {
    var maxDocs = Math.min(collectionLength(app.documents), 12);
    for (var docIndex = 0; docIndex < maxDocs; docIndex += 1) out.documents.push(makeDocumentSummary(app.documents[docIndex]));
  } catch (_) {}

  if (out.documentCount < 1) {
    out.status = "no_document";
    return stringifyIllustratorStatus(out);
  }

  var doc = findTargetDocument();
  if (!doc) {
    out.status = "document_mismatch";
    try { out.activeDocumentName = String(app.activeDocument.name || ""); } catch (_) {}
    out.error = "Expected Illustrator document is not open.";
    return stringifyIllustratorStatus(out);
  }

  out.activeDocumentName = String(doc.name || "");
  out.activeDocumentPath = documentPath(doc);
  out.widthPt = artboardWidthPt(doc);
  out.heightPt = artboardHeightPt(doc);
  out.artboardCount = documentArtboardCount(doc);
  out.layerCount = documentLayerCount(doc);
  out.selectionCount = documentSelectionCount(doc);
  out.status = "ready";
  return stringifyIllustratorStatus(out);
`;
}

export function buildIllustratorDocumentStatusJsx(params: IllustratorDocumentStatusParams): IllustratorExtendScriptBuild {
  const validated = validateIllustratorDocumentStatusParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: normalized.expectedDocumentName })}
${illustratorDocumentStatusJsxBody()}
}());
`;
  return { jsx, errors: [] };
}

// ─── 2) Export proof (writes outputPath ONLY — never the source doc) ────────

export type IllustratorExportProofParams = {
  appName?: string;
  /** Validated file path ending in .png or .svg (see module header for why PDF is excluded). */
  outputPath: string;
  /** Defaults from the outputPath extension; must match it when provided. */
  format?: IllustratorExportProofFormat | string | null;
  /** PNG only: integer raster scale 50..400 (default 100). */
  scalePercent?: number | null;
  expectedDocumentName?: string | null;
};

export type NormalizedIllustratorExportProofParams = {
  appName: string;
  outputPath: string;
  format: IllustratorExportProofFormat;
  /** Resolved: number for png (default 100), null for svg. */
  scalePercent: number | null;
  expectedDocumentName: string;
};

export function validateIllustratorExportProofParams(
  params: IllustratorExportProofParams,
): { ok: true; params: NormalizedIllustratorExportProofParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  const outputPath = validateIllustratorOutputPathParam(params?.outputPath);
  if (!outputPath.ok) errors.push(outputPath.error);
  const rawFormat = params?.format == null ? '' : String(params.format).trim().toLowerCase();
  if (rawFormat && !(ILLUSTRATOR_EXPORT_PROOF_FORMATS as readonly string[]).includes(rawFormat)) {
    errors.push('format must be png or svg (PDF is unsupported: Illustrator can only write PDF by re-associating/saving the source document).');
  }
  const extension = outputPath.ok ? extensionOf(outputPath.value) : '';
  const format = (rawFormat || extension) as IllustratorExportProofFormat;
  if (outputPath.ok && rawFormat && (ILLUSTRATOR_EXPORT_PROOF_FORMATS as readonly string[]).includes(rawFormat) && rawFormat !== extension) {
    errors.push('outputPath extension must match format (png|svg).');
  }
  const scalePercent = normalizeIllustratorScalePercent(params?.scalePercent);
  if (!scalePercent.ok) errors.push(scalePercent.error);
  if (scalePercent.ok && scalePercent.value != null && format !== 'png') {
    errors.push('scalePercent is only valid for png exports.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      outputPath: outputPath.ok ? outputPath.value : '',
      format,
      scalePercent: format === 'png'
        ? ((scalePercent.ok ? scalePercent.value : null) ?? ILLUSTRATOR_DEFAULT_SCALE_PERCENT)
        : null,
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): illustratorExportProofJsxBody — keep
 * this JSX body byte-identical with the bridge duplicate. The format branch
 * is resolved at build time so the emitted script contains ONLY the export
 * path it was asked for; there is no branch that writes the source document.
 */
function illustratorExportProofJsxBody(
  { outputPath, format, scalePercent }: { outputPath: string; format: IllustratorExportProofFormat; scalePercent: number | null },
): string {
  const scaleLiteral = format === 'png'
    ? String(Math.trunc(scalePercent == null ? ILLUSTRATOR_DEFAULT_SCALE_PERCENT : scalePercent))
    : 'null';
  const head = `
  var outputPath = ${jsxLiteral(String(outputPath ?? ''))};
  var format = ${jsxLiteral(String(format ?? ''))};

  function stringifyExportResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"outputFileName\\":" + jsonNullableString(value.outputFileName),
      "\\"format\\":" + jsonString(value.format),
      "\\"scalePercent\\":" + (value.scalePercent === null ? "null" : jsonNumber(value.scalePercent)),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Adobe Illustrator"),
    documentName: null,
    outputFileName: String(outputPath).split("/").pop() || null,
    format: format,
    scalePercent: ${scaleLiteral},
    docModified: false,
    docSaved: false,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyExportResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyExportResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");

  // Never-touch-the-source contract: the ONLY write below is doc.exportFile
  // to outputPath. The source document is never written, closed, or
  // re-associated with another file on any path through this script.
`;
  const foot = `
  try { result.docModified = doc.saved !== true; } catch (_) {}
  try { result.docSaved = doc.saved === true; } catch (_) {}
  return stringifyExportResult(result);
`;
  if (format === 'png') {
    return `${head}
  try {
    var outFile = new File(outputPath);
    var pngOptions = new ExportOptionsPNG24();
    pngOptions.horizontalScale = ${scaleLiteral};
    pngOptions.verticalScale = ${scaleLiteral};
    pngOptions.antiAliasing = true;
    pngOptions.transparency = true;
    pngOptions.artBoardClipping = true;
    doc.exportFile(outFile, ExportType.PNG24, pngOptions);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
${foot}`;
  }
  return `${head}
  try {
    var outFile = new File(outputPath);
    var svgOptions = new ExportOptionsSVG();
    svgOptions.embedRasterImages = true;
    doc.exportFile(outFile, ExportType.SVG, svgOptions);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
${foot}`;
}

export function buildIllustratorExportProofJsx(params: IllustratorExportProofParams): IllustratorExtendScriptBuild {
  const validated = validateIllustratorExportProofParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: normalized.expectedDocumentName })}
${illustratorExportProofJsxBody({
    outputPath: normalized.outputPath,
    format: normalized.format,
    scalePercent: normalized.scalePercent,
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── Receipt types + guards ─────────────────────────────────────────────────

export type IllustratorDocumentSummary = {
  name: string;
  path: string | null;
  modified: boolean;
  saved: boolean;
  widthPt: number;
  heightPt: number;
  artboardCount: number;
  layerCount: number;
  selectionCount: number;
};

export type IllustratorDocumentStatusReceipt = {
  ok: boolean;
  appName: string | null;
  appRunning: boolean;
  status: string;
  documentCount: number;
  activeDocumentName: string | null;
  activeDocumentPath: string | null;
  widthPt: number;
  heightPt: number;
  artboardCount: number;
  layerCount: number;
  selectionCount: number;
  documents: IllustratorDocumentSummary[];
  error: string | null;
};

export type IllustratorExportProofReceipt = {
  ok: boolean;
  appName: string | null;
  documentName: string | null;
  outputFileName: string | null;
  format: IllustratorExportProofFormat;
  scalePercent: number | null;
  /** stat()'d by the bridge AFTER the export — the proof the file landed. */
  fileExists: boolean;
  sizeBytes: number;
  error: string | null;
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isIllustratorDocumentSummary(value: unknown): value is IllustratorDocumentSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string'
    && isNullableString(v.path)
    && typeof v.modified === 'boolean'
    && typeof v.saved === 'boolean'
    && isFiniteNumber(v.widthPt)
    && isFiniteNumber(v.heightPt)
    && isFiniteNumber(v.artboardCount)
    && isFiniteNumber(v.layerCount)
    && isFiniteNumber(v.selectionCount);
}

export function isIllustratorDocumentStatusReceipt(value: unknown): value is IllustratorDocumentStatusReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.appName)
    && typeof v.appRunning === 'boolean'
    && typeof v.status === 'string'
    && isFiniteNumber(v.documentCount)
    && isNullableString(v.activeDocumentName)
    && isNullableString(v.activeDocumentPath)
    && isFiniteNumber(v.widthPt)
    && isFiniteNumber(v.heightPt)
    && isFiniteNumber(v.artboardCount)
    && isFiniteNumber(v.layerCount)
    && isFiniteNumber(v.selectionCount)
    && Array.isArray(v.documents)
    && v.documents.length <= ILLUSTRATOR_MAX_STATUS_DOCUMENTS
    && v.documents.every(isIllustratorDocumentSummary)
    && isNullableString(v.error);
}

export function isIllustratorExportProofReceipt(value: unknown): value is IllustratorExportProofReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.appName)
    && isNullableString(v.documentName)
    && isNullableString(v.outputFileName)
    && (ILLUSTRATOR_EXPORT_PROOF_FORMATS as readonly string[]).includes(String(v.format))
    && (v.scalePercent === null || isFiniteNumber(v.scalePercent))
    && typeof v.fileExists === 'boolean'
    && isFiniteNumber(v.sizeBytes)
    && isNullableString(v.error);
}

// ─── 3) Text inventory (READ-ONLY) ──────────────────────────────────────────
//
// The observation half of copy work, and the direct parallel of
// `indesign_text_inventory`. Recipe 3/4 in docs/apps/illustrator.md were
// buildout-only because there was no way to even SEE the text frames, let
// alone address one by name.

/** Text frames reported per call are bounded (parallels the status doc cap). */
export const ILLUSTRATOR_MAX_TEXT_FRAMES = 60;

/** Per-frame contents are truncated so one poster-sized story cannot flood a result. */
export const ILLUSTRATOR_MAX_TEXT_FRAME_CHARS = 600;

/** Upper bound on copy accepted by update_text_layer. */
export const ILLUSTRATOR_MAX_UPDATE_TEXT_CHARS = 20_000;

export type IllustratorTextInventoryParams = {
  appName?: string;
  expectedDocumentName?: string | null;
};

/**
 * Named-target resolution shared by set_layer_state and update_text_layer.
 *
 * Empty is rejected rather than defaulted: "apply to whichever layer happens
 * to be first" is precisely the blind-mutation behaviour the app profile
 * refuses. A caller that cannot name its target must observe first.
 */
export function normalizeIllustratorTargetName(value: unknown): IllustratorParamCheck<string> {
  if (typeof value !== 'string') return { ok: false, error: 'name must be a string' };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: 'name is required — observe with illustrator_text_inventory and pass an exact target.' };
  if (trimmed.length > 260) return { ok: false, error: 'name exceeds 260 chars' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\u2028\u2029]/.test(trimmed)) return { ok: false, error: 'name contains control characters' };
  return { ok: true, value: trimmed };
}

export function normalizeIllustratorUpdateText(value: unknown): IllustratorParamCheck<string> {
  if (typeof value !== 'string') return { ok: false, error: 'text must be a string' };
  if (value.length > ILLUSTRATOR_MAX_UPDATE_TEXT_CHARS) {
    return { ok: false, error: `text exceeds ${ILLUSTRATOR_MAX_UPDATE_TEXT_CHARS} chars` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00]/.test(value)) return { ok: false, error: 'text cannot contain NUL' };
  return { ok: true, value };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): shared text-frame observers for the
 * inventory and update scripts — byte-identical twin lives bridge-side.
 */
export function illustratorTextFrameHelpersJsx(): string {
  return `
function frameLayerName(frame) {
  try { return String(frame.layer.name || ""); } catch (_) { return ""; }
}

function frameOwnName(frame) {
  try { return String(frame.name || ""); } catch (_) { return ""; }
}

function frameContents(frame) {
  try { return String(frame.contents || ""); } catch (_) { return ""; }
}

function frameLocked(frame) {
  try { return frame.locked === true; } catch (_) { return false; }
}

function frameHidden(frame) {
  try { return frame.hidden === true; } catch (_) { return false; }
}

// Layer-level gates. Illustrator's DOM happily writes a text frame whose LAYER
// is locked or hidden — layer lock is a UI gate, not a DOM gate — which a live
// probe proved on 2026-07-29: lock the layer, write the frame, "applied".
// A designer who locked the layer meant the frame too, so both levels count.
function frameLayerLocked(frame) {
  try { return frame.layer.locked === true; } catch (_) { return false; }
}

function frameLayerHidden(frame) {
  try { return frame.layer.visible === false; } catch (_) { return false; }
}

// A frame is addressable by its own name OR by its layer name. Layer-name
// matching is what makes "update the headline layer" work in files where
// designers never named the frame itself.
function frameMatchesTarget(frame, target) {
  var wanted = normalizeDocName(target);
  if (!wanted) return false;
  if (normalizeDocName(frameOwnName(frame)) === wanted) return true;
  return normalizeDocName(frameLayerName(frame)) === wanted;
}
`;
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): byte-identical twin bridge-side.
 * Includes the shared text-frame helpers so the bridge can compose
 * prelude + body exactly like buildIllustratorTextInventoryJsx does.
 */
export function illustratorTextInventoryJsxBody(): string {
  return `${illustratorTextFrameHelpersJsx()}
  var out = { status: "unknown", documentName: null, frameCount: 0, truncated: false, frames: [], error: null };

  if (collectionLength(app.documents) < 1) {
    out.status = "no_document";
    return emitInventory(out);
  }
  var doc = findTargetDocument();
  if (!doc) {
    out.status = "document_mismatch";
    out.error = "Expected Illustrator document is not open.";
    return emitInventory(out);
  }
  out.documentName = String(doc.name || "");

  var frames = null;
  try { frames = doc.textFrames; } catch (_) { frames = null; }
  var total = collectionLength(frames);
  out.frameCount = total;
  var limit = Math.min(total, ${ILLUSTRATOR_MAX_TEXT_FRAMES});
  out.truncated = total > limit;

  for (var i = 0; i < limit; i += 1) {
    var f = null;
    try { f = frames[i]; } catch (_) { f = null; }
    if (!f) continue;
    var body = frameContents(f);
    out.frames.push({
      index: i,
      name: frameOwnName(f),
      layerName: frameLayerName(f),
      charCount: body.length,
      locked: frameLocked(f),
      hidden: frameHidden(f),
      contents: body.length > ${ILLUSTRATOR_MAX_TEXT_FRAME_CHARS} ? body.substring(0, ${ILLUSTRATOR_MAX_TEXT_FRAME_CHARS}) : body,
      contentsTruncated: body.length > ${ILLUSTRATOR_MAX_TEXT_FRAME_CHARS}
    });
  }
  out.status = "ready";
  return emitInventory(out);

  function emitInventory(value) {
    var parts = [];
    for (var j = 0; j < value.frames.length; j += 1) {
      var fr = value.frames[j];
      parts.push("{" +
        "\\"index\\":" + jsonNumber(fr.index) + "," +
        "\\"name\\":" + jsonNullableString(fr.name) + "," +
        "\\"layerName\\":" + jsonNullableString(fr.layerName) + "," +
        "\\"charCount\\":" + jsonNumber(fr.charCount) + "," +
        "\\"locked\\":" + jsonBoolean(fr.locked) + "," +
        "\\"hidden\\":" + jsonBoolean(fr.hidden) + "," +
        "\\"contentsTruncated\\":" + jsonBoolean(fr.contentsTruncated) + "," +
        "\\"contents\\":" + jsonString(fr.contents) +
      "}");
    }
    return "{" +
      "\\"ok\\":" + jsonBoolean(value.status === "ready") + "," +
      "\\"status\\":" + jsonString(value.status) + "," +
      "\\"documentName\\":" + jsonNullableString(value.documentName) + "," +
      "\\"frameCount\\":" + jsonNumber(value.frameCount) + "," +
      "\\"truncated\\":" + jsonBoolean(value.truncated) + "," +
      "\\"frames\\":" + jsonArray(parts) + "," +
      "\\"error\\":" + jsonNullableString(value.error) +
    "}";
  }`;
}

export function buildIllustratorTextInventoryJsx(
  params: IllustratorTextInventoryParams,
): IllustratorExtendScriptBuild {
  const appCheck = normalizeIllustratorBridgeAppName(params.appName);
  if (!appCheck.ok) return { jsx: '', errors: [appCheck.error] };
  const docCheck = normalizeIllustratorExpectedDocumentName(params.expectedDocumentName);
  if (!docCheck.ok) return { jsx: '', errors: [docCheck.error] };

  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: docCheck.value })}
${illustratorTextInventoryJsxBody()}
}());
`;
  return { jsx, errors: [] };
}


// ─── 4) Set layer state (visible / locked) ──────────────────────────────────
//
// The safest possible vector-app mutation and the natural first one: it is
// reversible, addresses an exactly-named layer, and its result is two booleans
// that can be re-read for proof. Parallels `indesign_set_layer_state`.

export type IllustratorSetLayerStateParams = {
  appName?: string;
  expectedDocumentName?: string | null;
  layerName: string;
  /** Omit to leave that dimension untouched. */
  visible?: boolean | null;
  locked?: boolean | null;
};

/** Optional tri-state flag: undefined/null means "do not change this". */
export function normalizeIllustratorLayerFlag(
  value: unknown,
  field: string,
): IllustratorParamCheck<boolean | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'boolean') return { ok: false, error: `${field} must be a boolean when provided.` };
  return { ok: true, value };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): byte-identical twin bridge-side.
 * Embeds go through jsxLiteral (NOT bare JSON.stringify): JSON.stringify
 * emits U+2028/U+2029 raw, and a layer name is user text.
 */
export function illustratorSetLayerStateJsxBody(args: {
  layerName: string;
  visible: boolean | null;
  locked: boolean | null;
}): string {
  return `  var targetLayerName = ${jsxLiteral(args.layerName)};
  var wantVisible = ${args.visible === null ? 'null' : String(args.visible)};
  var wantLocked = ${args.locked === null ? 'null' : String(args.locked)};

  var out = {
    status: "unknown", documentName: null, layerName: null,
    beforeVisible: null, beforeLocked: null,
    afterVisible: null, afterLocked: null,
    changed: false, error: null
  };

  if (collectionLength(app.documents) < 1) { out.status = "no_document"; return emitLayerState(out); }
  var doc = findTargetDocument();
  if (!doc) {
    out.status = "document_mismatch";
    out.error = "Expected Illustrator document is not open.";
    return emitLayerState(out);
  }
  out.documentName = String(doc.name || "");

  // Exact, unambiguous match only. Two layers with the same name is a
  // fail-closed condition — guessing which one the user meant is exactly the
  // blind mutation this lane refuses.
  var found = null, matches = 0;
  try {
    for (var i = 0; i < doc.layers.length; i += 1) {
      if (normalizeDocName(String(doc.layers[i].name || "")) === normalizeDocName(targetLayerName)) {
        matches += 1;
        if (!found) found = doc.layers[i];
      }
    }
  } catch (_) {}

  if (!found) {
    out.status = "layer_not_found";
    out.error = "No layer with that exact name is present in the document.";
    return emitLayerState(out);
  }
  if (matches > 1) {
    out.status = "layer_ambiguous";
    out.error = "More than one layer shares that name; rename or address a unique layer.";
    return emitLayerState(out);
  }

  out.layerName = String(found.name || "");
  try { out.beforeVisible = found.visible === true; } catch (_) {}
  try { out.beforeLocked = found.locked === true; } catch (_) {}

  // Unlock BEFORE changing visibility: Illustrator rejects visibility writes
  // on a locked layer, which would otherwise report success while doing
  // nothing. When the caller is locking, do that last for the same reason.
  try { if (wantLocked === false) found.locked = false; } catch (_) {}
  try { if (wantVisible !== null) found.visible = wantVisible; } catch (_) {}
  try { if (wantLocked === true) found.locked = true; } catch (_) {}

  try { out.afterVisible = found.visible === true; } catch (_) {}
  try { out.afterLocked = found.locked === true; } catch (_) {}
  out.changed = (out.beforeVisible !== out.afterVisible) || (out.beforeLocked !== out.afterLocked);

  // Proof is the observed after-state, not the fact that we ran. If the DOM
  // silently refused the write, this reports not_applied rather than success.
  var visibleOk = wantVisible === null || out.afterVisible === wantVisible;
  var lockedOk = wantLocked === null || out.afterLocked === wantLocked;
  out.status = (visibleOk && lockedOk) ? "applied" : "not_applied";
  if (!visibleOk || !lockedOk) out.error = "Illustrator did not accept the requested layer state.";
  return emitLayerState(out);

  function emitLayerState(v) {
    return "{" +
      "\\"ok\\":" + jsonBoolean(v.status === "applied") + "," +
      "\\"status\\":" + jsonString(v.status) + "," +
      "\\"documentName\\":" + jsonNullableString(v.documentName) + "," +
      "\\"layerName\\":" + jsonNullableString(v.layerName) + "," +
      "\\"beforeVisible\\":" + (v.beforeVisible === null ? "null" : jsonBoolean(v.beforeVisible)) + "," +
      "\\"beforeLocked\\":" + (v.beforeLocked === null ? "null" : jsonBoolean(v.beforeLocked)) + "," +
      "\\"afterVisible\\":" + (v.afterVisible === null ? "null" : jsonBoolean(v.afterVisible)) + "," +
      "\\"afterLocked\\":" + (v.afterLocked === null ? "null" : jsonBoolean(v.afterLocked)) + "," +
      "\\"changed\\":" + jsonBoolean(v.changed) + "," +
      "\\"error\\":" + jsonNullableString(v.error) +
    "}";
  }`;
}

export function buildIllustratorSetLayerStateJsx(
  params: IllustratorSetLayerStateParams,
): IllustratorExtendScriptBuild {
  const errors: string[] = [];
  const appCheck = normalizeIllustratorBridgeAppName(params.appName);
  if (!appCheck.ok) errors.push(appCheck.error);
  const docCheck = normalizeIllustratorExpectedDocumentName(params.expectedDocumentName);
  if (!docCheck.ok) errors.push(docCheck.error);
  const layerCheck = normalizeIllustratorTargetName(params.layerName);
  if (!layerCheck.ok) errors.push(layerCheck.error);
  const visibleCheck = normalizeIllustratorLayerFlag(params.visible, 'visible');
  if (!visibleCheck.ok) errors.push(visibleCheck.error);
  const lockedCheck = normalizeIllustratorLayerFlag(params.locked, 'locked');
  if (!lockedCheck.ok) errors.push(lockedCheck.error);
  if (errors.length) return { jsx: '', errors };

  const visible = visibleCheck.ok ? visibleCheck.value : null;
  const locked = lockedCheck.ok ? lockedCheck.value : null;
  // A call that changes nothing is a caller bug, not a no-op to absorb: it
  // would consume an approval and produce a "verified" receipt for no work.
  if (visible === null && locked === null) {
    return { jsx: '', errors: ['At least one of visible or locked must be supplied.'] };
  }

  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: docCheck.ok ? docCheck.value : '' })}
${illustratorSetLayerStateJsxBody({ layerName: layerCheck.ok ? layerCheck.value : '', visible, locked })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 5) Update text layer (replace copy in one named frame) ─────────────────
//
// Closes recipe 3/4's "no vector mutation tools exist yet" for the copy case.
// Parallels `indesign_update_text_layer`. The source document is NEVER saved:
// the user reviews and saves, exactly like the other Adobe lanes.

export type IllustratorUpdateTextLayerParams = {
  appName?: string;
  expectedDocumentName?: string | null;
  /** Exact text-frame name, or the exact name of the layer holding it. */
  target: string;
  text: string;
};

/**
 * LOCKSTEP(scripts/claude-bridge.js): byte-identical twin bridge-side.
 * `text` is ARBITRARY user copy — jsxLiteral is mandatory here, because a
 * U+2028/U+2029 in the copy would end the ES3 string literal mid-value
 * under bare JSON.stringify and the script would not even parse.
 */
export function illustratorUpdateTextLayerJsxBody(args: { target: string; text: string }): string {
  return `${illustratorTextFrameHelpersJsx()}
  var target = ${jsxLiteral(args.target)};
  var nextText = ${jsxLiteral(args.text)};

  var out = {
    status: "unknown", documentName: null, target: null,
    beforeCharCount: null, afterCharCount: null, changed: false, error: null
  };

  if (collectionLength(app.documents) < 1) { out.status = "no_document"; return emitUpdate(out); }
  var doc = findTargetDocument();
  if (!doc) {
    out.status = "document_mismatch";
    out.error = "Expected Illustrator document is not open.";
    return emitUpdate(out);
  }
  out.documentName = String(doc.name || "");

  var frames = null;
  try { frames = doc.textFrames; } catch (_) { frames = null; }
  var found = null, matches = 0;
  for (var i = 0; i < collectionLength(frames); i += 1) {
    var f = null;
    try { f = frames[i]; } catch (_) { f = null; }
    if (f && frameMatchesTarget(f, target)) {
      matches += 1;
      if (!found) found = f;
    }
  }

  if (!found) {
    out.status = "target_not_found";
    out.error = "No text frame matches that name or layer name.";
    return emitUpdate(out);
  }
  if (matches > 1) {
    out.status = "target_ambiguous";
    out.error = "More than one text frame matches that name; address a unique frame.";
    return emitUpdate(out);
  }
  // A locked or hidden frame silently swallows the write, so refuse up front
  // rather than reporting a success the user cannot see.
  if (frameLocked(found) || frameLayerLocked(found)) {
    out.status = "target_locked";
    out.error = "The target text frame or its layer is locked. Unlock it (illustrator_set_layer_state) and retry.";
    return emitUpdate(out);
  }
  if (frameHidden(found) || frameLayerHidden(found)) {
    out.status = "target_hidden";
    out.error = "The target text frame or its layer is hidden. Show it (illustrator_set_layer_state) and retry.";
    return emitUpdate(out);
  }

  out.target = frameOwnName(found) || frameLayerName(found);
  out.beforeCharCount = frameContents(found).length;
  try { found.contents = nextText; } catch (e) {
    out.status = "write_refused";
    out.error = "Illustrator refused the text write.";
    return emitUpdate(out);
  }

  // Re-read the SAME frame — the write is only proven by the after-state.
  var confirmed = frameContents(found);
  out.afterCharCount = confirmed.length;
  out.changed = out.afterCharCount !== out.beforeCharCount || confirmed === nextText;
  out.status = confirmed === nextText ? "applied" : "not_applied";
  if (out.status !== "applied") out.error = "The frame contents do not match the requested copy after the write.";
  return emitUpdate(out);

  function emitUpdate(v) {
    return "{" +
      "\\"ok\\":" + jsonBoolean(v.status === "applied") + "," +
      "\\"status\\":" + jsonString(v.status) + "," +
      "\\"documentName\\":" + jsonNullableString(v.documentName) + "," +
      "\\"target\\":" + jsonNullableString(v.target) + "," +
      "\\"beforeCharCount\\":" + (v.beforeCharCount === null ? "null" : jsonNumber(v.beforeCharCount)) + "," +
      "\\"afterCharCount\\":" + (v.afterCharCount === null ? "null" : jsonNumber(v.afterCharCount)) + "," +
      "\\"changed\\":" + jsonBoolean(v.changed) + "," +
      "\\"error\\":" + jsonNullableString(v.error) +
    "}";
  }`;
}

export function buildIllustratorUpdateTextLayerJsx(
  params: IllustratorUpdateTextLayerParams,
): IllustratorExtendScriptBuild {
  const errors: string[] = [];
  const appCheck = normalizeIllustratorBridgeAppName(params.appName);
  if (!appCheck.ok) errors.push(appCheck.error);
  const docCheck = normalizeIllustratorExpectedDocumentName(params.expectedDocumentName);
  if (!docCheck.ok) errors.push(docCheck.error);
  const targetCheck = normalizeIllustratorTargetName(params.target);
  if (!targetCheck.ok) errors.push(targetCheck.error);
  const textCheck = normalizeIllustratorUpdateText(params.text);
  if (!textCheck.ok) errors.push(textCheck.error);
  if (errors.length) return { jsx: '', errors };

  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: docCheck.ok ? docCheck.value : '' })}
${illustratorUpdateTextLayerJsxBody({ target: targetCheck.ok ? targetCheck.value : '', text: textCheck.ok ? textCheck.value : '' })}
}());
`;
  return { jsx, errors: [] };
}

// ─── Aggregate validators (desktopBridge reuse, mirrors document_status) ────

export type NormalizedIllustratorTextInventoryParams = {
  appName: string;
  expectedDocumentName: string;
};

export function validateIllustratorTextInventoryParams(
  params: IllustratorTextInventoryParams,
): { ok: true; params: NormalizedIllustratorTextInventoryParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
    },
  };
}

export type NormalizedIllustratorSetLayerStateParams = {
  appName: string;
  expectedDocumentName: string;
  layerName: string;
  visible: boolean | null;
  locked: boolean | null;
};

export function validateIllustratorSetLayerStateParams(
  params: IllustratorSetLayerStateParams,
): { ok: true; params: NormalizedIllustratorSetLayerStateParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  const layerName = normalizeIllustratorTargetName(params?.layerName);
  if (!layerName.ok) errors.push(layerName.error);
  const visible = normalizeIllustratorLayerFlag(params?.visible, 'visible');
  if (!visible.ok) errors.push(visible.error);
  const locked = normalizeIllustratorLayerFlag(params?.locked, 'locked');
  if (!locked.ok) errors.push(locked.error);
  if (
    visible.ok && locked.ok
    && visible.value === null && locked.value === null
  ) {
    errors.push('At least one of visible or locked must be supplied.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
      layerName: layerName.ok ? layerName.value : '',
      visible: visible.ok ? visible.value : null,
      locked: locked.ok ? locked.value : null,
    },
  };
}

export type NormalizedIllustratorUpdateTextLayerParams = {
  appName: string;
  expectedDocumentName: string;
  target: string;
  text: string;
};

export function validateIllustratorUpdateTextLayerParams(
  params: IllustratorUpdateTextLayerParams,
): { ok: true; params: NormalizedIllustratorUpdateTextLayerParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  const target = normalizeIllustratorTargetName(params?.target);
  if (!target.ok) errors.push(target.error);
  const text = normalizeIllustratorUpdateText(params?.text);
  if (!text.ok) errors.push(text.error);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
      target: target.ok ? target.value : '',
      text: text.ok ? text.value : '',
    },
  };
}
