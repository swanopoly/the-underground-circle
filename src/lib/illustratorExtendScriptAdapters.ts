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

// ─── 3) Vectorize (Image Trace → expand → SVG in a throwaway document) ───────
//
// Turns a raster image into true vector paths and writes an .svg. To honor the
// never-touch-the-source contract, the trace happens in a FRESH document the
// script creates and then closes WITHOUT saving — the user's open document is
// never modified. Two input modes cover the chat asks:
//   - imagePath given  → trace that file ("pull an image first, then vectorize")
//   - imagePath omitted → read the front document's FIRST placed image's linked
//                         file path (read-only) and trace a fresh copy of it
//                         ("vectorize the image I already have up"). An embedded
//                         image with no source file fails closed (honest).

export const ILLUSTRATOR_TRACING_MODES = ['color', 'gray', 'blackwhite'] as const;
export type IllustratorTracingMode = (typeof ILLUSTRATOR_TRACING_MODES)[number];

export const ILLUSTRATOR_MIN_TRACE_COLORS = 2;
export const ILLUSTRATOR_MAX_TRACE_COLORS = 256;
export const ILLUSTRATOR_DEFAULT_TRACE_COLORS = 6;
export const ILLUSTRATOR_MIN_TRACE_THRESHOLD = 0;
export const ILLUSTRATOR_MAX_TRACE_THRESHOLD = 255;
export const ILLUSTRATOR_DEFAULT_TRACE_THRESHOLD = 128;

/** Raster extensions Illustrator can place + trace. */
export const ILLUSTRATOR_TRACE_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff', 'bmp', 'psd', 'webp'] as const;

/**
 * Friendly presets the user names in chat, resolved DETERMINISTICALLY to a
 * tracing mode + params. We set tracingMode/maxColors/threshold explicitly
 * rather than call tracingOptions.loadFromPreset, which is unreliable and
 * version-dependent (LOCKSTEP(scripts/claude-bridge.js): same table).
 */
export const ILLUSTRATOR_TRACE_PRESETS: Record<string, { mode: IllustratorTracingMode; maxColors?: number; threshold?: number }> = {
  'black-and-white-logo': { mode: 'blackwhite', threshold: 128 },
  'bw-logo':              { mode: 'blackwhite', threshold: 128 },
  'silhouettes':          { mode: 'blackwhite', threshold: 200 },
  'grayscale':            { mode: 'gray', maxColors: 50 },
  '3-colors':             { mode: 'color', maxColors: 3 },
  '6-colors':             { mode: 'color', maxColors: 6 },
  '16-colors':            { mode: 'color', maxColors: 16 },
};

/** ExtendScript enum literal for a tracing mode (resolved at build time). */
function tracingModeEnumLiteral(mode: IllustratorTracingMode): string {
  if (mode === 'blackwhite') return 'TracingModeType.TRACINGMODEBLACKANDWHITE';
  if (mode === 'gray') return 'TracingModeType.TRACINGMODEGRAY';
  return 'TracingModeType.TRACINGMODECOLOR';
}

/** Validate the optional input image path: same shell/control-char/length
 *  safety as the output path, but the extension must be a placeable raster. */
export function validateIllustratorTraceImagePathParam(raw: unknown): IllustratorParamCheck<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'imagePath must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'imagePath is empty' };
  if (trimmed.length > 1024) return { ok: false, error: 'imagePath exceeds 1024 chars' };
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\u2028\u2029]/.test(trimmed)) return { ok: false, error: 'imagePath contains control characters' };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: 'imagePath contains shell metacharacter' };
  const ext = extensionOf(trimmed);
  if (!(ILLUSTRATOR_TRACE_IMAGE_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: `imagePath must be a raster image (${ILLUSTRATOR_TRACE_IMAGE_EXTENSIONS.join(', ')}).` };
  }
  return { ok: true, value: trimmed };
}

function normalizeIllustratorTracingMode(value: unknown): IllustratorParamCheck<IllustratorTracingMode | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const mode = String(value).trim().toLowerCase();
  if (!(ILLUSTRATOR_TRACING_MODES as readonly string[]).includes(mode)) {
    return { ok: false, error: `mode must be one of: ${ILLUSTRATOR_TRACING_MODES.join(', ')}.` };
  }
  return { ok: true, value: mode as IllustratorTracingMode };
}

function normalizeTraceIntInRange(value: unknown, min: number, max: number, label: string): IllustratorParamCheck<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    return { ok: false, error: `${label} must be a finite integer between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

export type IllustratorVectorizeParams = {
  appName?: string;
  /** Raster to vectorize. Omit to trace the front document's placed image. */
  imagePath?: string | null;
  /** Output path; must end in .svg. */
  outputPath: string;
  /** color | gray | blackwhite. Defaults to color (or the preset's mode). */
  mode?: IllustratorTracingMode | string | null;
  /** color/gray only, 2..256. Defaults to 6 (or the preset's colors). */
  maxColors?: number | null;
  /** blackwhite only, 0..255. Defaults to 128 (or the preset's threshold). */
  threshold?: number | null;
  /** Best-effort white-background removal (unreliable on Illustrator 2024+). */
  ignoreWhite?: boolean | null;
  /** Friendly preset name; resolves to mode + params. See ILLUSTRATOR_TRACE_PRESETS. */
  preset?: string | null;
};

export type NormalizedIllustratorVectorizeParams = {
  appName: string;
  imagePath: string | null;
  outputPath: string;
  mode: IllustratorTracingMode;
  maxColors: number;
  threshold: number;
  ignoreWhite: boolean;
};

export function validateIllustratorVectorizeParams(
  params: IllustratorVectorizeParams,
): { ok: true; params: NormalizedIllustratorVectorizeParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);

  // imagePath is optional (null = use the front document's placed image).
  let imagePath: string | null = null;
  if (params?.imagePath != null && String(params.imagePath).trim() !== '') {
    const checked = validateIllustratorTraceImagePathParam(params.imagePath);
    if (!checked.ok) errors.push(checked.error);
    else imagePath = checked.value;
  }

  const outputPath = validateIllustratorOutputPathParam(params?.outputPath);
  if (!outputPath.ok) errors.push(outputPath.error);
  else if (extensionOf(outputPath.value) !== 'svg') {
    errors.push('vectorize outputPath must end in .svg (Image Trace produces vector paths).');
  }

  // Resolve preset first; explicit mode/maxColors/threshold override it.
  let presetMode: IllustratorTracingMode | null = null;
  let presetMaxColors: number | null = null;
  let presetThreshold: number | null = null;
  if (params?.preset != null && String(params.preset).trim() !== '') {
    const key = String(params.preset).trim().toLowerCase();
    const preset = ILLUSTRATOR_TRACE_PRESETS[key];
    if (!preset) {
      errors.push(`preset must be one of: ${Object.keys(ILLUSTRATOR_TRACE_PRESETS).join(', ')}.`);
    } else {
      presetMode = preset.mode;
      presetMaxColors = preset.maxColors ?? null;
      presetThreshold = preset.threshold ?? null;
    }
  }

  const modeCheck = normalizeIllustratorTracingMode(params?.mode);
  if (!modeCheck.ok) errors.push(modeCheck.error);
  const maxColorsCheck = normalizeTraceIntInRange(params?.maxColors, ILLUSTRATOR_MIN_TRACE_COLORS, ILLUSTRATOR_MAX_TRACE_COLORS, 'maxColors');
  if (!maxColorsCheck.ok) errors.push(maxColorsCheck.error);
  const thresholdCheck = normalizeTraceIntInRange(params?.threshold, ILLUSTRATOR_MIN_TRACE_THRESHOLD, ILLUSTRATOR_MAX_TRACE_THRESHOLD, 'threshold');
  if (!thresholdCheck.ok) errors.push(thresholdCheck.error);

  if (errors.length > 0) return { ok: false, errors };

  const mode: IllustratorTracingMode = (modeCheck.ok && modeCheck.value) || presetMode || 'color';
  const maxColors = (maxColorsCheck.ok ? maxColorsCheck.value : null)
    ?? presetMaxColors
    ?? ILLUSTRATOR_DEFAULT_TRACE_COLORS;
  const threshold = (thresholdCheck.ok ? thresholdCheck.value : null)
    ?? presetThreshold
    ?? ILLUSTRATOR_DEFAULT_TRACE_THRESHOLD;

  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      imagePath,
      outputPath: outputPath.ok ? outputPath.value : '',
      mode,
      maxColors,
      threshold,
      ignoreWhite: params?.ignoreWhite === true,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): illustratorVectorizeJsxBody — keep this
 * JSX body byte-identical with the bridge duplicate. It creates its OWN
 * document, places + traces the image, expands to vectors, exports SVG, and
 * closes ITS document without saving. It never saves, exports from, or closes
 * the user's open (source) document — the only doc it closes is the one it
 * created via app.documents.add().
 */
function illustratorVectorizeJsxBody(
  { imagePath, outputPath, mode, maxColors, threshold, ignoreWhite }:
  { imagePath: string | null; outputPath: string; mode: IllustratorTracingMode; maxColors: number; threshold: number; ignoreWhite: boolean },
): string {
  const imagePathLiteral = imagePath == null ? 'null' : jsxLiteral(String(imagePath));
  const modeLiteral = tracingModeEnumLiteral(mode);
  return `
  var imagePath = ${imagePathLiteral};
  var outputPath = ${jsxLiteral(String(outputPath ?? ''))};

  function stringifyVectorizeResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"sourceImagePath\\":" + jsonNullableString(value.sourceImagePath),
      "\\"sourceKind\\":" + jsonNullableString(value.sourceKind),
      "\\"outputFileName\\":" + jsonNullableString(value.outputFileName),
      "\\"mode\\":" + jsonString(value.mode),
      "\\"maxColors\\":" + jsonNumber(value.maxColors),
      "\\"threshold\\":" + jsonNumber(value.threshold),
      "\\"ignoreWhite\\":" + jsonBoolean(value.ignoreWhite),
      "\\"pathCount\\":" + jsonNumber(value.pathCount),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  function firstPlacedImagePath() {
    if (collectionLength(app.documents) < 1) return "";
    var src;
    try { src = app.activeDocument; } catch (_) { return ""; }
    try {
      for (var i = 0; i < src.placedItems.length; i += 1) {
        try { return src.placedItems[i].file.fsName; } catch (_) {}
      }
    } catch (_) {}
    try {
      for (var r = 0; r < src.rasterItems.length; r += 1) {
        try { return src.rasterItems[r].file.fsName; } catch (_) {}
      }
    } catch (_) {}
    return "";
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Adobe Illustrator"),
    sourceImagePath: null,
    sourceKind: null,
    outputFileName: String(outputPath).split("/").pop() || null,
    mode: "${mode}",
    maxColors: ${String(Math.trunc(maxColors))},
    threshold: ${String(Math.trunc(threshold))},
    ignoreWhite: ${ignoreWhite ? 'true' : 'false'},
    pathCount: 0,
    error: null
  };

  // Resolve the raster to trace. Omitted imagePath => read the front
  // document's placed/linked image path (READ-ONLY: the source doc is only
  // inspected for a file path, never modified).
  if (imagePath) {
    result.sourceImagePath = imagePath;
    result.sourceKind = "provided";
  } else {
    var resolved = firstPlacedImagePath();
    if (!resolved) {
      result.error = collectionLength(app.documents) < 1 ? "no_document" : "no_source_image";
      return stringifyVectorizeResult(result);
    }
    imagePath = resolved;
    result.sourceImagePath = resolved;
    result.sourceKind = "active_document_placed";
  }

  var inFile = new File(imagePath);
  if (!inFile.exists) {
    result.error = "image_not_found";
    return stringifyVectorizeResult(result);
  }

  // Work entirely in a throwaway document so the user's open document is never
  // touched. The ONLY document this script closes is the one it creates here.
  var tempDoc = app.documents.add();
  try {
    var placed = tempDoc.placedItems.add();
    placed.file = inFile;
    var traced = placed.trace();
    var opts = traced.tracing.tracingOptions;
    opts.tracingMode = ${modeLiteral};
    try { opts.ignoreWhite = result.ignoreWhite; } catch (_) {}
    if (${mode === 'blackwhite' ? 'true' : 'false'}) {
      try { opts.threshold = result.threshold; } catch (_) {}
    } else {
      try { opts.maxColors = result.maxColors; } catch (_) {}
    }
    try { app.redraw(); } catch (_) {}
    traced.tracing.expandTracing();
    try {
      var total = 0;
      for (var p = 0; p < tempDoc.pathItems.length; p += 1) total += 1;
      result.pathCount = total;
    } catch (_) {}
    var outFile = new File(outputPath);
    var svgOptions = new ExportOptionsSVG();
    svgOptions.embedRasterImages = false;
    tempDoc.exportFile(outFile, ExportType.SVG, svgOptions);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  try { tempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (_) {}
  return stringifyVectorizeResult(result);
`;
}

export function buildIllustratorVectorizeJsx(params: IllustratorVectorizeParams): IllustratorExtendScriptBuild {
  const validated = validateIllustratorVectorizeParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: '' })}
${illustratorVectorizeJsxBody({
    imagePath: normalized.imagePath,
    outputPath: normalized.outputPath,
    mode: normalized.mode,
    maxColors: normalized.maxColors,
    threshold: normalized.threshold,
    ignoreWhite: normalized.ignoreWhite,
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 4) Arrange (in-place z-order of the current selection) ──────────────────
//
// The SIMPLEST mutating op: reorder the currently selected objects front/back
// via pageItem.zOrder. It mutates the OPEN target document in place, NEVER
// saves/exports/closes it (the user keeps undo), and stays entirely on the
// typed DOM (no executeAction/executeMenuCommand). Fails closed with
// 'no_document'/'document_mismatch'/'no_selection'.

export const ILLUSTRATOR_ARRANGE_DIRECTIONS = ['bringToFront', 'sendToBack', 'bringForward', 'sendBackward'] as const;
export type IllustratorArrangeDirection = (typeof ILLUSTRATOR_ARRANGE_DIRECTIONS)[number];

export type IllustratorArrangeParams = {
  appName?: string;
  expectedDocumentName?: string | null;
  /** bringToFront | sendToBack | bringForward | sendBackward (case-sensitive). */
  direction: IllustratorArrangeDirection | string;
};

export type NormalizedIllustratorArrangeParams = {
  appName: string;
  expectedDocumentName: string;
  direction: IllustratorArrangeDirection;
};

export function validateIllustratorArrangeParams(
  params: IllustratorArrangeParams,
): { ok: true; params: NormalizedIllustratorArrangeParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  // Case-sensitive enum (the ZOrderMethod names are camelCase) — do NOT lowercase.
  const direction = String(params?.direction ?? '').trim();
  if (!(ILLUSTRATOR_ARRANGE_DIRECTIONS as readonly string[]).includes(direction)) {
    errors.push('direction must be bringToFront, sendToBack, bringForward, or sendBackward.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
      direction: direction as IllustratorArrangeDirection,
    },
  };
}

/**
 * ExtendScript ZOrderMethod enum literal for a direction (resolved at BUILD
 * time, like tracingModeEnumLiteral). LOCKSTEP(scripts/claude-bridge.js): keep
 * byte-identical. Only ever called with a validated direction, so the final
 * return is the sendBackward case.
 */
function zOrderMethodEnumLiteral(direction: IllustratorArrangeDirection): string {
  if (direction === 'bringToFront') return 'ZOrderMethod.BRINGTOFRONT';
  if (direction === 'sendToBack') return 'ZOrderMethod.SENDTOBACK';
  if (direction === 'bringForward') return 'ZOrderMethod.BRINGFORWARD';
  return 'ZOrderMethod.SENDBACKWARD';
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): illustratorArrangeJsxBody — keep this JSX
 * body byte-identical with the bridge duplicate. The zOrder enum is resolved at
 * build time. It reorders the OPEN document's current selection in place and
 * NEVER saves, exports, or closes it; the user keeps undo.
 */
function illustratorArrangeJsxBody(
  { direction }: { direction: IllustratorArrangeDirection },
): string {
  const zOrderLiteral = zOrderMethodEnumLiteral(direction);
  return `
  var direction = ${jsxLiteral(String(direction ?? ''))};

  function stringifyArrangeResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"direction\\":" + jsonString(value.direction),
      "\\"movedCount\\":" + jsonNumber(value.movedCount),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Adobe Illustrator"),
    documentName: null,
    direction: direction,
    movedCount: 0,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyArrangeResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyArrangeResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");

  // Snapshot the live selection into a stable array BEFORE reordering:
  // doc.selection returns a fresh array and can reindex as items move, so we
  // capture references first and reorder each in place. The user keeps undo.
  var selection = null;
  try { selection = doc.selection; } catch (_) { selection = null; }
  var selectionCount = 0;
  try { selectionCount = selection ? Number(selection.length) || 0 : 0; } catch (_) { selectionCount = 0; }
  if (selectionCount < 1) {
    result.error = "no_selection";
    return stringifyArrangeResult(result);
  }
  var items = [];
  for (var s = 0; s < selectionCount; s += 1) {
    try { if (selection[s]) items.push(selection[s]); } catch (_) {}
  }

  // In-place reorder only: zOrder never saves, exports, or closes the document.
  // Each selected object is reordered independently; failures are counted out
  // and the first message is surfaced.
  var moved = 0;
  for (var i = 0; i < items.length; i += 1) {
    try {
      items[i].zOrder(${zOrderLiteral});
      moved += 1;
    } catch (err) {
      if (!result.error) result.error = String(err && err.message ? err.message : err);
    }
  }
  result.movedCount = moved;
  result.ok = moved > 0;
  if (moved < 1 && !result.error) result.error = "arrange_failed";
  return stringifyArrangeResult(result);
`;
}

export function buildIllustratorArrangeJsx(params: IllustratorArrangeParams): IllustratorExtendScriptBuild {
  const validated = validateIllustratorArrangeParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: normalized.expectedDocumentName })}
${illustratorArrangeJsxBody({ direction: normalized.direction })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 5) Add text (additive point-text frame in the OPEN document) ────────────
//
// "Add a headline that says X." Creates a NEW point-text frame via the typed
// DOM (doc.textFrames.pointText) in the OPEN target document. Additive and
// non-destructive: it only adds an object, mutates the OPEN document in place,
// NEVER saves/exports/closes it (the user keeps undo), and stays entirely on
// the typed DOM (no executeAction/executeMenuCommand). Fails closed with
// 'no_document'/'document_mismatch'. fillColor is built as an RGBColor or
// CMYKColor to match the document color space; a requested fontName that cannot
// be resolved is reported as fontWarning='font_not_found' and the text is still
// created with the default font (honest appliedFont in the receipt).

export const ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS = 2000;
export const ILLUSTRATOR_ADD_TEXT_MIN_SIZE_PT = 1;
export const ILLUSTRATOR_ADD_TEXT_MAX_SIZE_PT = 1400;
export const ILLUSTRATOR_ADD_TEXT_DEFAULT_SIZE_PT = 24;
export const ILLUSTRATOR_ADD_TEXT_MAX_COORD_PT = 100000;
export const ILLUSTRATOR_ADD_TEXT_MAX_FONT_NAME = 200;
export const ILLUSTRATOR_HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Non-empty text, capped at ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS; no NUL. */
function normalizeIllustratorAddTextContents(value: unknown): IllustratorParamCheck<string> {
  if (typeof value !== 'string') return { ok: false, error: 'contents must be a string.' };
  if (value.trim().length < 1) return { ok: false, error: 'contents must be a non-empty string.' };
  if (value.length > ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS) {
    return { ok: false, error: `contents must be <= ${ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS} characters.` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00]/.test(value)) return { ok: false, error: 'contents cannot contain NUL.' };
  return { ok: true, value };
}

/** Finite point coordinate within a sane bound (fractions allowed). */
function normalizeIllustratorAddTextCoord(value: unknown, label: string): IllustratorParamCheck<number> {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > ILLUSTRATOR_ADD_TEXT_MAX_COORD_PT) {
    return { ok: false, error: `${label} must be a finite number between -${ILLUSTRATOR_ADD_TEXT_MAX_COORD_PT} and ${ILLUSTRATOR_ADD_TEXT_MAX_COORD_PT}.` };
  }
  return { ok: true, value };
}

/** Optional font size: undefined/null -> default 24. Finite 1..1400. */
function normalizeIllustratorAddTextSize(value: unknown): IllustratorParamCheck<number> {
  if (value === undefined || value === null) return { ok: true, value: ILLUSTRATOR_ADD_TEXT_DEFAULT_SIZE_PT };
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < ILLUSTRATOR_ADD_TEXT_MIN_SIZE_PT
    || value > ILLUSTRATOR_ADD_TEXT_MAX_SIZE_PT
  ) {
    return { ok: false, error: `sizePt must be a finite number between ${ILLUSTRATOR_ADD_TEXT_MIN_SIZE_PT} and ${ILLUSTRATOR_ADD_TEXT_MAX_SIZE_PT}.` };
  }
  return { ok: true, value };
}

/** Optional #RRGGBB hex fill: undefined/null/'' -> null. Strict format. */
function normalizeIllustratorAddTextFillColor(value: unknown): IllustratorParamCheck<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !ILLUSTRATOR_HEX_COLOR_PATTERN.test(value.trim())) {
    return { ok: false, error: 'fillColor must be a hex color in #RRGGBB format.' };
  }
  return { ok: true, value: value.trim() };
}

/** Optional font name: undefined/null/'' -> null. Bounded, no control chars. */
function normalizeIllustratorAddTextFontName(value: unknown): IllustratorParamCheck<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'fontName must be a string.' };
  const name = value.trim();
  if (!name) return { ok: true, value: null };
  if (name.length > ILLUSTRATOR_ADD_TEXT_MAX_FONT_NAME) {
    return { ok: false, error: `fontName must be <= ${ILLUSTRATOR_ADD_TEXT_MAX_FONT_NAME} characters.` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) return { ok: false, error: 'fontName contains control characters.' };
  return { ok: true, value: name };
}

export type IllustratorAddTextParams = {
  appName?: string;
  expectedDocumentName?: string | null;
  /** Non-empty text to add (capped at 2000 chars). */
  contents: string;
  /** X anchor in points. */
  xPt: number;
  /** Y anchor in points. */
  yPt: number;
  /** Font size in points (1..1400). Defaults to 24. */
  sizePt?: number | null;
  /** Optional #RRGGBB hex fill. */
  fillColor?: string | null;
  /** Optional font name; falls back to the default font (fontWarning) if missing. */
  fontName?: string | null;
};

export type NormalizedIllustratorAddTextParams = {
  appName: string;
  expectedDocumentName: string;
  contents: string;
  xPt: number;
  yPt: number;
  sizePt: number;
  fillColor: string | null;
  fontName: string | null;
};

export function validateIllustratorAddTextParams(
  params: IllustratorAddTextParams,
): { ok: true; params: NormalizedIllustratorAddTextParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  const contents = normalizeIllustratorAddTextContents(params?.contents);
  if (!contents.ok) errors.push(contents.error);
  const xPt = normalizeIllustratorAddTextCoord(params?.xPt, 'xPt');
  if (!xPt.ok) errors.push(xPt.error);
  const yPt = normalizeIllustratorAddTextCoord(params?.yPt, 'yPt');
  if (!yPt.ok) errors.push(yPt.error);
  const sizePt = normalizeIllustratorAddTextSize(params?.sizePt);
  if (!sizePt.ok) errors.push(sizePt.error);
  const fillColor = normalizeIllustratorAddTextFillColor(params?.fillColor);
  if (!fillColor.ok) errors.push(fillColor.error);
  const fontName = normalizeIllustratorAddTextFontName(params?.fontName);
  if (!fontName.ok) errors.push(fontName.error);
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
      contents: contents.ok ? contents.value : '',
      xPt: xPt.ok ? xPt.value : 0,
      yPt: yPt.ok ? yPt.value : 0,
      sizePt: sizePt.ok ? sizePt.value : ILLUSTRATOR_ADD_TEXT_DEFAULT_SIZE_PT,
      fillColor: fillColor.ok ? fillColor.value : null,
      fontName: fontName.ok ? fontName.value : null,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): illustratorAddTextJsxBody — keep this JSX
 * body byte-identical with the bridge duplicate. It adds a NEW point-text frame
 * to the OPEN document and NEVER saves, exports, or closes it; the user keeps
 * undo. fillColor/fontName are optional; a requested font that cannot be
 * resolved is reported as fontWarning and the text is still created with the
 * default font (honest appliedFont).
 */
function illustratorAddTextJsxBody(
  { contents, xPt, yPt, sizePt, fillColor, fontName }:
  { contents: string; xPt: number; yPt: number; sizePt: number; fillColor: string | null; fontName: string | null },
): string {
  const fillColorLiteral = fillColor == null ? 'null' : jsxLiteral(String(fillColor));
  const fontNameLiteral = fontName == null ? 'null' : jsxLiteral(String(fontName));
  return `
  var contents = ${jsxLiteral(String(contents ?? ''))};
  var xPt = ${jsxLiteral(xPt)};
  var yPt = ${jsxLiteral(yPt)};
  var sizePt = ${jsxLiteral(sizePt)};
  var fillColor = ${fillColorLiteral};
  var fontName = ${fontNameLiteral};

  function normalizeHex(hex) {
    var h = String(hex == null ? "" : hex);
    if (h.charAt(0) === "#") h = h.substring(1);
    return h;
  }

  function hexToRgbColor(hex) {
    var h = normalizeHex(hex);
    var color = new RGBColor();
    color.red = parseInt(h.substring(0, 2), 16);
    color.green = parseInt(h.substring(2, 4), 16);
    color.blue = parseInt(h.substring(4, 6), 16);
    return color;
  }

  function hexToCmykColor(hex) {
    var h = normalizeHex(hex);
    var r = parseInt(h.substring(0, 2), 16) / 255;
    var g = parseInt(h.substring(2, 4), 16) / 255;
    var b = parseInt(h.substring(4, 6), 16) / 255;
    var k = 1 - Math.max(r, Math.max(g, b));
    var c = 0, m = 0, y = 0;
    if (k < 1) {
      c = (1 - r - k) / (1 - k);
      m = (1 - g - k) / (1 - k);
      y = (1 - b - k) / (1 - k);
    }
    var color = new CMYKColor();
    color.cyan = c * 100;
    color.magenta = m * 100;
    color.yellow = y * 100;
    color.black = k * 100;
    return color;
  }

  function stringifyAddTextResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"contents\\":" + jsonString(value.contents),
      "\\"xPt\\":" + jsonNumber(value.xPt),
      "\\"yPt\\":" + jsonNumber(value.yPt),
      "\\"sizePt\\":" + jsonNumber(value.sizePt),
      "\\"appliedFont\\":" + jsonNullableString(value.appliedFont),
      "\\"fillApplied\\":" + jsonBoolean(value.fillApplied),
      "\\"fontWarning\\":" + jsonNullableString(value.fontWarning),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Adobe Illustrator"),
    documentName: null,
    contents: String(contents).slice(0, 2000),
    xPt: xPt,
    yPt: yPt,
    sizePt: sizePt,
    appliedFont: null,
    fillApplied: false,
    fontWarning: null,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyAddTextResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyAddTextResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");

  // Additive/non-destructive: create a NEW point-text frame in the OPEN
  // document. Never saves, exports, or closes it; the user keeps undo.
  try {
    var tf = doc.textFrames.pointText([xPt, yPt]);
    tf.contents = contents;
    var attrs = tf.textRange.characterAttributes;
    attrs.size = sizePt;

    if (fontName) {
      var resolvedFont = null;
      try { resolvedFont = doc.textFonts.getByName(fontName); } catch (_) { resolvedFont = null; }
      if (resolvedFont) {
        try { attrs.textFont = resolvedFont; } catch (_) {}
      } else {
        result.fontWarning = "font_not_found";
      }
    }
    try { result.appliedFont = String(attrs.textFont.name || ""); } catch (_) {}

    if (fillColor) {
      try {
        var fillObj;
        var isCmyk = false;
        try { isCmyk = (doc.documentColorSpace == DocumentColorSpace.CMYK); } catch (_) { isCmyk = false; }
        if (isCmyk) {
          fillObj = hexToCmykColor(fillColor);
        } else {
          fillObj = hexToRgbColor(fillColor);
        }
        attrs.fillColor = fillObj;
        result.fillApplied = true;
      } catch (_) {
        result.fillApplied = false;
      }
    }

    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  return stringifyAddTextResult(result);
`;
}

export function buildIllustratorAddTextJsx(params: IllustratorAddTextParams): IllustratorExtendScriptBuild {
  const validated = validateIllustratorAddTextParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: normalized.expectedDocumentName })}
${illustratorAddTextJsxBody({
    contents: normalized.contents,
    xPt: normalized.xPt,
    yPt: normalized.yPt,
    sizePt: normalized.sizePt,
    fillColor: normalized.fillColor,
    fontName: normalized.fontName,
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 6) Add shape (additive rectangle/ellipse/line in the OPEN document) ─────
//
// "Draw a 200x100 box / a circle / a line." Creates a NEW path item via the
// typed DOM (doc.pathItems.rectangle/ellipse, or doc.pathItems.add +
// setEntirePath for a line) in the OPEN target document. Additive and
// non-destructive: it only adds an object, mutates the OPEN document in place,
// NEVER saves/exports/closes it (the user keeps undo), and stays entirely on
// the typed DOM (no executeAction/executeMenuCommand). Fails closed with
// 'no_document'/'document_mismatch'. fillColor/strokeColor are optional and
// built as an RGBColor or CMYKColor to match the document color space.
//
// Illustrator uses a Y-UP axis and pathItems.rectangle/ellipse take
// (top, left, width, height) — so the top-left anchor is (yPt as top, xPt as
// left). The arg order is noted inline in the JSX body.

export const ILLUSTRATOR_ADD_SHAPE_KINDS = ['rectangle', 'ellipse', 'line'] as const;
export type IllustratorAddShapeKind = (typeof ILLUSTRATOR_ADD_SHAPE_KINDS)[number];

export const ILLUSTRATOR_ADD_SHAPE_MAX_COORD_PT = 100000;
export const ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT = 100000;
export const ILLUSTRATOR_ADD_SHAPE_MAX_STROKE_WIDTH_PT = 1000;

/** rectangle|ellipse|line (case-insensitive). Fail-closed on anything else. */
function normalizeIllustratorAddShapeKind(value: unknown): IllustratorParamCheck<IllustratorAddShapeKind> {
  if (value === undefined || value === null || value === '') {
    return { ok: false, error: `kind must be one of: ${ILLUSTRATOR_ADD_SHAPE_KINDS.join(', ')}.` };
  }
  const kind = String(value).trim().toLowerCase();
  if (!(ILLUSTRATOR_ADD_SHAPE_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: `kind must be one of: ${ILLUSTRATOR_ADD_SHAPE_KINDS.join(', ')}.` };
  }
  return { ok: true, value: kind as IllustratorAddShapeKind };
}

/** Finite point coordinate within a sane bound (fractions allowed). */
function normalizeIllustratorAddShapeCoord(value: unknown, label: string): IllustratorParamCheck<number> {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > ILLUSTRATOR_ADD_SHAPE_MAX_COORD_PT) {
    return { ok: false, error: `${label} must be a finite number between -${ILLUSTRATOR_ADD_SHAPE_MAX_COORD_PT} and ${ILLUSTRATOR_ADD_SHAPE_MAX_COORD_PT}.` };
  }
  return { ok: true, value };
}

/** Positive finite dimension (width/height) within a sane bound. */
function normalizeIllustratorAddShapeDimension(value: unknown, label: string): IllustratorParamCheck<number> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT) {
    return { ok: false, error: `${label} must be a positive finite number up to ${ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT}.` };
  }
  return { ok: true, value };
}

/** Optional #RRGGBB hex color: undefined/null/'' -> null. Strict format. */
function normalizeIllustratorAddShapeHexColor(value: unknown, label: string): IllustratorParamCheck<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !ILLUSTRATOR_HEX_COLOR_PATTERN.test(value.trim())) {
    return { ok: false, error: `${label} must be a hex color in #RRGGBB format.` };
  }
  return { ok: true, value: value.trim() };
}

/** Optional stroke width in points: undefined/null -> null. Finite 0..1000. */
function normalizeIllustratorAddShapeStrokeWidth(value: unknown): IllustratorParamCheck<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > ILLUSTRATOR_ADD_SHAPE_MAX_STROKE_WIDTH_PT) {
    return { ok: false, error: `strokeWidthPt must be a finite number between 0 and ${ILLUSTRATOR_ADD_SHAPE_MAX_STROKE_WIDTH_PT}.` };
  }
  return { ok: true, value };
}

export type IllustratorAddShapeParams = {
  appName?: string;
  expectedDocumentName?: string | null;
  /** rectangle | ellipse | line (case-insensitive). */
  kind: IllustratorAddShapeKind | string;
  /** rectangle/ellipse: top-left X in points. */
  xPt?: number;
  /** rectangle/ellipse: top-left Y in points (y-up). */
  yPt?: number;
  /** rectangle/ellipse: positive width in points. */
  widthPt?: number;
  /** rectangle/ellipse: positive height in points. */
  heightPt?: number;
  /** line: start X in points. */
  x1Pt?: number;
  /** line: start Y in points. */
  y1Pt?: number;
  /** line: end X in points. */
  x2Pt?: number;
  /** line: end Y in points. */
  y2Pt?: number;
  /** Optional #RRGGBB fill. */
  fillColor?: string | null;
  /** Optional #RRGGBB stroke. */
  strokeColor?: string | null;
  /** Optional stroke width in points (0..1000). */
  strokeWidthPt?: number | null;
};

export type NormalizedIllustratorAddShapeParams = {
  appName: string;
  expectedDocumentName: string;
  kind: IllustratorAddShapeKind;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  x1Pt: number;
  y1Pt: number;
  x2Pt: number;
  y2Pt: number;
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidthPt: number | null;
};

export function validateIllustratorAddShapeParams(
  params: IllustratorAddShapeParams,
): { ok: true; params: NormalizedIllustratorAddShapeParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  const kindCheck = normalizeIllustratorAddShapeKind(params?.kind);
  if (!kindCheck.ok) errors.push(kindCheck.error);
  const kind = kindCheck.ok ? kindCheck.value : null;

  // Geometry depends on the kind: rectangle/ellipse use xPt,yPt (top-left) +
  // widthPt,heightPt; line uses x1Pt,y1Pt,x2Pt,y2Pt. Validate only the geometry
  // the resolved kind needs (an invalid kind already failed above).
  let xPt = 0;
  let yPt = 0;
  let widthPt = 0;
  let heightPt = 0;
  let x1Pt = 0;
  let y1Pt = 0;
  let x2Pt = 0;
  let y2Pt = 0;
  if (kind === 'rectangle' || kind === 'ellipse') {
    const x = normalizeIllustratorAddShapeCoord(params?.xPt, 'xPt');
    if (!x.ok) errors.push(x.error); else xPt = x.value;
    const y = normalizeIllustratorAddShapeCoord(params?.yPt, 'yPt');
    if (!y.ok) errors.push(y.error); else yPt = y.value;
    const w = normalizeIllustratorAddShapeDimension(params?.widthPt, 'widthPt');
    if (!w.ok) errors.push(w.error); else widthPt = w.value;
    const h = normalizeIllustratorAddShapeDimension(params?.heightPt, 'heightPt');
    if (!h.ok) errors.push(h.error); else heightPt = h.value;
  } else if (kind === 'line') {
    const a = normalizeIllustratorAddShapeCoord(params?.x1Pt, 'x1Pt');
    if (!a.ok) errors.push(a.error); else x1Pt = a.value;
    const b = normalizeIllustratorAddShapeCoord(params?.y1Pt, 'y1Pt');
    if (!b.ok) errors.push(b.error); else y1Pt = b.value;
    const c = normalizeIllustratorAddShapeCoord(params?.x2Pt, 'x2Pt');
    if (!c.ok) errors.push(c.error); else x2Pt = c.value;
    const d = normalizeIllustratorAddShapeCoord(params?.y2Pt, 'y2Pt');
    if (!d.ok) errors.push(d.error); else y2Pt = d.value;
  }

  const fillColor = normalizeIllustratorAddShapeHexColor(params?.fillColor, 'fillColor');
  if (!fillColor.ok) errors.push(fillColor.error);
  const strokeColor = normalizeIllustratorAddShapeHexColor(params?.strokeColor, 'strokeColor');
  if (!strokeColor.ok) errors.push(strokeColor.error);
  const strokeWidthPt = normalizeIllustratorAddShapeStrokeWidth(params?.strokeWidthPt);
  if (!strokeWidthPt.ok) errors.push(strokeWidthPt.error);

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
      kind: kind as IllustratorAddShapeKind,
      xPt,
      yPt,
      widthPt,
      heightPt,
      x1Pt,
      y1Pt,
      x2Pt,
      y2Pt,
      fillColor: fillColor.ok ? fillColor.value : null,
      strokeColor: strokeColor.ok ? strokeColor.value : null,
      strokeWidthPt: strokeWidthPt.ok ? strokeWidthPt.value : null,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): illustratorAddShapeJsxBody — keep this JSX
 * body byte-identical with the bridge duplicate. It adds a NEW path item
 * (rectangle/ellipse/line) to the OPEN document and NEVER saves, exports, or
 * closes it; the user keeps undo. Illustrator's Y-UP axis + the
 * pathItems.rectangle/ellipse (top, left, width, height) arg order are noted
 * inline. fillColor/strokeColor build an RGBColor or CMYKColor to match the
 * document color space; both are optional.
 */
function illustratorAddShapeJsxBody(
  { kind, xPt, yPt, widthPt, heightPt, x1Pt, y1Pt, x2Pt, y2Pt, fillColor, strokeColor, strokeWidthPt }:
  { kind: IllustratorAddShapeKind; xPt: number; yPt: number; widthPt: number; heightPt: number; x1Pt: number; y1Pt: number; x2Pt: number; y2Pt: number; fillColor: string | null; strokeColor: string | null; strokeWidthPt: number | null },
): string {
  const fillColorLiteral = fillColor == null ? 'null' : jsxLiteral(String(fillColor));
  const strokeColorLiteral = strokeColor == null ? 'null' : jsxLiteral(String(strokeColor));
  const strokeWidthLiteral = strokeWidthPt == null ? 'null' : jsxLiteral(strokeWidthPt);
  return `
  var kind = ${jsxLiteral(String(kind ?? ''))};
  var xPt = ${jsxLiteral(xPt)};
  var yPt = ${jsxLiteral(yPt)};
  var widthPt = ${jsxLiteral(widthPt)};
  var heightPt = ${jsxLiteral(heightPt)};
  var x1Pt = ${jsxLiteral(x1Pt)};
  var y1Pt = ${jsxLiteral(y1Pt)};
  var x2Pt = ${jsxLiteral(x2Pt)};
  var y2Pt = ${jsxLiteral(y2Pt)};
  var fillColor = ${fillColorLiteral};
  var strokeColor = ${strokeColorLiteral};
  var strokeWidthPt = ${strokeWidthLiteral};

  function normalizeHex(hex) {
    var h = String(hex == null ? "" : hex);
    if (h.charAt(0) === "#") h = h.substring(1);
    return h;
  }

  function hexToRgbColor(hex) {
    var h = normalizeHex(hex);
    var color = new RGBColor();
    color.red = parseInt(h.substring(0, 2), 16);
    color.green = parseInt(h.substring(2, 4), 16);
    color.blue = parseInt(h.substring(4, 6), 16);
    return color;
  }

  function hexToCmykColor(hex) {
    var h = normalizeHex(hex);
    var r = parseInt(h.substring(0, 2), 16) / 255;
    var g = parseInt(h.substring(2, 4), 16) / 255;
    var b = parseInt(h.substring(4, 6), 16) / 255;
    var k = 1 - Math.max(r, Math.max(g, b));
    var c = 0, m = 0, y = 0;
    if (k < 1) {
      c = (1 - r - k) / (1 - k);
      m = (1 - g - k) / (1 - k);
      y = (1 - b - k) / (1 - k);
    }
    var color = new CMYKColor();
    color.cyan = c * 100;
    color.magenta = m * 100;
    color.yellow = y * 100;
    color.black = k * 100;
    return color;
  }

  function makeColor(doc, hex) {
    var isCmyk = false;
    try { isCmyk = (doc.documentColorSpace == DocumentColorSpace.CMYK); } catch (_) { isCmyk = false; }
    return isCmyk ? hexToCmykColor(hex) : hexToRgbColor(hex);
  }

  function stringifyAddShapeResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"kind\\":" + jsonString(value.kind),
      "\\"fillApplied\\":" + jsonBoolean(value.fillApplied),
      "\\"strokeApplied\\":" + jsonBoolean(value.strokeApplied),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Adobe Illustrator"),
    documentName: null,
    kind: kind,
    fillApplied: false,
    strokeApplied: false,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyAddShapeResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyAddShapeResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");

  // Additive/non-destructive: create a NEW path item in the OPEN document.
  // Never saves, exports, or closes it; the user keeps undo. Illustrator uses a
  // Y-UP axis and pathItems.rectangle/ellipse take (top, left, width, height),
  // so yPt is the TOP and xPt is the LEFT of the top-left anchor.
  try {
    var shape = null;
    if (kind === "rectangle") {
      shape = doc.pathItems.rectangle(yPt, xPt, widthPt, heightPt);
    } else if (kind === "ellipse") {
      shape = doc.pathItems.ellipse(yPt, xPt, widthPt, heightPt);
    } else {
      shape = doc.pathItems.add();
      shape.setEntirePath([[x1Pt, y1Pt], [x2Pt, y2Pt]]);
      shape.filled = false;
    }

    if (fillColor) {
      try {
        shape.filled = true;
        shape.fillColor = makeColor(doc, fillColor);
        result.fillApplied = true;
      } catch (_) {
        result.fillApplied = false;
      }
    }

    if (strokeColor) {
      try {
        shape.stroked = true;
        shape.strokeColor = makeColor(doc, strokeColor);
        result.strokeApplied = true;
      } catch (_) {
        result.strokeApplied = false;
      }
    }

    if (strokeWidthPt !== null) {
      try { shape.strokeWidth = strokeWidthPt; } catch (_) {}
    }

    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  return stringifyAddShapeResult(result);
`;
}

export function buildIllustratorAddShapeJsx(params: IllustratorAddShapeParams): IllustratorExtendScriptBuild {
  const validated = validateIllustratorAddShapeParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: normalized.expectedDocumentName })}
${illustratorAddShapeJsxBody({
    kind: normalized.kind,
    xPt: normalized.xPt,
    yPt: normalized.yPt,
    widthPt: normalized.widthPt,
    heightPt: normalized.heightPt,
    x1Pt: normalized.x1Pt,
    y1Pt: normalized.y1Pt,
    x2Pt: normalized.x2Pt,
    y2Pt: normalized.y2Pt,
    fillColor: normalized.fillColor,
    strokeColor: normalized.strokeColor,
    strokeWidthPt: normalized.strokeWidthPt,
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 7) Set appearance (recolor/re-stroke the current selection in place) ────
//
// "Make the selection red / give it a 3pt black stroke / apply swatch X."
// Recolors and/or re-strokes the CURRENTLY SELECTED objects in the OPEN target
// document via the typed DOM (item.fillColor/strokeColor/strokeWidth), recursing
// into GroupItem.pageItems. It mutates the OPEN document in place, NEVER
// saves/exports/closes it (the user keeps undo), and stays entirely on the typed
// DOM (no executeAction/executeMenuCommand). Fails closed with
// 'no_document'/'document_mismatch'/'no_selection', and — when a swatch is
// named — 'swatch_not_found'/'swatch_not_solid'. fillColor/strokeColor are
// #RRGGBB hex built as an RGBColor or CMYKColor to match the document color
// space; swatchName resolves at runtime to a named swatch's SOLID color (no
// gradient/pattern) and is the FILL source (mutually exclusive with fillColor).
// At least one of fillColor/strokeColor/strokeWidthPt/swatchName is required.

export const ILLUSTRATOR_SET_APPEARANCE_MAX_STROKE_WIDTH_PT = 1000;
export const ILLUSTRATOR_SET_APPEARANCE_MAX_SWATCH_NAME = 200;

/** Optional #RRGGBB hex color: undefined/null/'' -> null. Strict format. */
function normalizeIllustratorSetAppearanceHexColor(value: unknown, label: string): IllustratorParamCheck<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string' || !ILLUSTRATOR_HEX_COLOR_PATTERN.test(value.trim())) {
    return { ok: false, error: `${label} must be a hex color in #RRGGBB format.` };
  }
  return { ok: true, value: value.trim() };
}

/** Optional stroke width in points: undefined/null -> null. Finite 0..1000. */
function normalizeIllustratorSetAppearanceStrokeWidth(value: unknown): IllustratorParamCheck<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > ILLUSTRATOR_SET_APPEARANCE_MAX_STROKE_WIDTH_PT) {
    return { ok: false, error: `strokeWidthPt must be a finite number between 0 and ${ILLUSTRATOR_SET_APPEARANCE_MAX_STROKE_WIDTH_PT}.` };
  }
  return { ok: true, value };
}

/** Optional swatch name: undefined/null/'' -> null. Bounded, no control chars. */
function normalizeIllustratorSetAppearanceSwatchName(value: unknown): IllustratorParamCheck<string | null> {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: 'swatchName must be a string.' };
  const name = value.trim();
  if (!name) return { ok: true, value: null };
  if (name.length > ILLUSTRATOR_SET_APPEARANCE_MAX_SWATCH_NAME) {
    return { ok: false, error: `swatchName must be <= ${ILLUSTRATOR_SET_APPEARANCE_MAX_SWATCH_NAME} characters.` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) return { ok: false, error: 'swatchName contains control characters.' };
  return { ok: true, value: name };
}

export type IllustratorSetAppearanceParams = {
  appName?: string;
  expectedDocumentName?: string | null;
  /** Optional #RRGGBB fill color (mutually exclusive with swatchName). */
  fillColor?: string | null;
  /** Optional #RRGGBB stroke color. */
  strokeColor?: string | null;
  /** Optional stroke width in points (0..1000). */
  strokeWidthPt?: number | null;
  /** Optional named swatch; its SOLID color becomes the fill. */
  swatchName?: string | null;
};

export type NormalizedIllustratorSetAppearanceParams = {
  appName: string;
  expectedDocumentName: string;
  fillColor: string | null;
  strokeColor: string | null;
  strokeWidthPt: number | null;
  swatchName: string | null;
};

export function validateIllustratorSetAppearanceParams(
  params: IllustratorSetAppearanceParams,
): { ok: true; params: NormalizedIllustratorSetAppearanceParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizeIllustratorBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const expectedDocumentName = normalizeIllustratorExpectedDocumentName(params?.expectedDocumentName);
  if (!expectedDocumentName.ok) errors.push(expectedDocumentName.error);
  const fillColor = normalizeIllustratorSetAppearanceHexColor(params?.fillColor, 'fillColor');
  if (!fillColor.ok) errors.push(fillColor.error);
  const strokeColor = normalizeIllustratorSetAppearanceHexColor(params?.strokeColor, 'strokeColor');
  if (!strokeColor.ok) errors.push(strokeColor.error);
  const strokeWidthPt = normalizeIllustratorSetAppearanceStrokeWidth(params?.strokeWidthPt);
  if (!strokeWidthPt.ok) errors.push(strokeWidthPt.error);
  const swatchName = normalizeIllustratorSetAppearanceSwatchName(params?.swatchName);
  if (!swatchName.ok) errors.push(swatchName.error);

  const resolvedFill = fillColor.ok ? fillColor.value : null;
  const resolvedStroke = strokeColor.ok ? strokeColor.value : null;
  const resolvedWidth = strokeWidthPt.ok ? strokeWidthPt.value : null;
  const resolvedSwatch = swatchName.ok ? swatchName.value : null;

  // fillColor and swatchName both set the fill — a contradiction. Fail closed.
  if (resolvedFill && resolvedSwatch) {
    errors.push('Provide either fillColor or swatchName for the fill, not both.');
  }
  // At least one appearance change must be requested (only when nothing else is
  // already invalid, so a bad-format error is not drowned by this one).
  if (errors.length === 0 && !resolvedFill && !resolvedStroke && resolvedWidth === null && !resolvedSwatch) {
    errors.push('At least one of fillColor, strokeColor, strokeWidthPt, or swatchName is required.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Illustrator',
      expectedDocumentName: expectedDocumentName.ok ? expectedDocumentName.value : '',
      fillColor: resolvedFill,
      strokeColor: resolvedStroke,
      strokeWidthPt: resolvedWidth,
      swatchName: resolvedSwatch,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): illustratorSetAppearanceJsxBody — keep
 * this JSX body byte-identical with the bridge duplicate. It recolors/re-strokes
 * the OPEN document's current selection in place (recursing into groups) and
 * NEVER saves, exports, or closes it; the user keeps undo. fillColor/strokeColor
 * build an RGBColor or CMYKColor to match the document color space; swatchName
 * resolves at runtime to a named swatch's SOLID color (the fill source). Solid
 * color only — a gradient/pattern swatch fails closed with 'swatch_not_solid'.
 */
function illustratorSetAppearanceJsxBody(
  { fillColor, strokeColor, strokeWidthPt, swatchName }:
  { fillColor: string | null; strokeColor: string | null; strokeWidthPt: number | null; swatchName: string | null },
): string {
  const fillColorLiteral = fillColor == null ? 'null' : jsxLiteral(String(fillColor));
  const strokeColorLiteral = strokeColor == null ? 'null' : jsxLiteral(String(strokeColor));
  const strokeWidthLiteral = strokeWidthPt == null ? 'null' : jsxLiteral(strokeWidthPt);
  const swatchNameLiteral = swatchName == null ? 'null' : jsxLiteral(String(swatchName));
  return `
  var fillColor = ${fillColorLiteral};
  var strokeColor = ${strokeColorLiteral};
  var strokeWidthPt = ${strokeWidthLiteral};
  var swatchName = ${swatchNameLiteral};

  function normalizeHex(hex) {
    var h = String(hex == null ? "" : hex);
    if (h.charAt(0) === "#") h = h.substring(1);
    return h;
  }

  function hexToRgbColor(hex) {
    var h = normalizeHex(hex);
    var color = new RGBColor();
    color.red = parseInt(h.substring(0, 2), 16);
    color.green = parseInt(h.substring(2, 4), 16);
    color.blue = parseInt(h.substring(4, 6), 16);
    return color;
  }

  function hexToCmykColor(hex) {
    var h = normalizeHex(hex);
    var r = parseInt(h.substring(0, 2), 16) / 255;
    var g = parseInt(h.substring(2, 4), 16) / 255;
    var b = parseInt(h.substring(4, 6), 16) / 255;
    var k = 1 - Math.max(r, Math.max(g, b));
    var c = 0, m = 0, y = 0;
    if (k < 1) {
      c = (1 - r - k) / (1 - k);
      m = (1 - g - k) / (1 - k);
      y = (1 - b - k) / (1 - k);
    }
    var color = new CMYKColor();
    color.cyan = c * 100;
    color.magenta = m * 100;
    color.yellow = y * 100;
    color.black = k * 100;
    return color;
  }

  function makeColor(doc, hex) {
    var isCmyk = false;
    try { isCmyk = (doc.documentColorSpace == DocumentColorSpace.CMYK); } catch (_) { isCmyk = false; }
    return isCmyk ? hexToCmykColor(hex) : hexToRgbColor(hex);
  }

  function stringifySetAppearanceResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"appliedToCount\\":" + jsonNumber(value.appliedToCount),
      "\\"fillApplied\\":" + jsonBoolean(value.fillApplied),
      "\\"strokeApplied\\":" + jsonBoolean(value.strokeApplied),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Adobe Illustrator"),
    documentName: null,
    appliedToCount: 0,
    fillApplied: false,
    strokeApplied: false,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifySetAppearanceResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifySetAppearanceResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");

  // Snapshot the live selection into a stable array BEFORE mutating, mirroring
  // arrange: doc.selection returns a fresh array, so capture references first.
  var selection = null;
  try { selection = doc.selection; } catch (_) { selection = null; }
  var selectionCount = 0;
  try { selectionCount = selection ? Number(selection.length) || 0 : 0; } catch (_) { selectionCount = 0; }
  if (selectionCount < 1) {
    result.error = "no_selection";
    return stringifySetAppearanceResult(result);
  }
  var items = [];
  for (var s = 0; s < selectionCount; s += 1) {
    try { if (selection[s]) items.push(selection[s]); } catch (_) {}
  }

  // Resolve the FILL color: an explicit hex wins; otherwise a named swatch's
  // SOLID color. getByName throws when the swatch is missing (fail closed), and
  // a gradient/pattern swatch is rejected (solid color only).
  var fillColorObj = null;
  if (fillColor) {
    try { fillColorObj = makeColor(doc, fillColor); } catch (_) { fillColorObj = null; }
  } else if (swatchName) {
    var swatch = null;
    try { swatch = doc.swatches.getByName(swatchName); } catch (_) { swatch = null; }
    if (!swatch) {
      result.error = "swatch_not_found";
      return stringifySetAppearanceResult(result);
    }
    var swatchColor = null;
    try { swatchColor = swatch.color; } catch (_) { swatchColor = null; }
    if (swatchColor === null) {
      result.error = "swatch_not_found";
      return stringifySetAppearanceResult(result);
    }
    var swatchColorType = "";
    try { swatchColorType = String(swatchColor.typename || ""); } catch (_) { swatchColorType = ""; }
    if (swatchColorType === "GradientColor" || swatchColorType === "PatternColor") {
      result.error = "swatch_not_solid";
      return stringifySetAppearanceResult(result);
    }
    fillColorObj = swatchColor;
  }

  // Resolve the STROKE color from an explicit hex only.
  var strokeColorObj = null;
  if (strokeColor) {
    try { strokeColorObj = makeColor(doc, strokeColor); } catch (_) { strokeColorObj = null; }
  }

  // Apply the appearance in place, recursing into groups. Solid color only (no
  // gradient). Never saves, exports, or closes the document; the user keeps undo.
  var applied = 0;
  function applyAppearance(item) {
    if (!item) return;
    var typeName = "";
    try { typeName = String(item.typename || ""); } catch (_) { typeName = ""; }
    if (typeName === "GroupItem") {
      var kids = null;
      try { kids = item.pageItems; } catch (_) { kids = null; }
      var kidCount = 0;
      try { kidCount = kids ? Number(kids.length) || 0 : 0; } catch (_) { kidCount = 0; }
      for (var k = 0; k < kidCount; k += 1) {
        try { applyAppearance(kids[k]); } catch (_) {}
      }
      return;
    }
    var touched = false;
    if (fillColorObj !== null) {
      try {
        item.filled = true;
        item.fillColor = fillColorObj;
        result.fillApplied = true;
        touched = true;
      } catch (_) {}
    }
    if (strokeColorObj !== null) {
      try {
        item.stroked = true;
        item.strokeColor = strokeColorObj;
        result.strokeApplied = true;
        touched = true;
      } catch (_) {}
    }
    if (strokeWidthPt !== null) {
      try {
        item.strokeWidth = strokeWidthPt;
        touched = true;
      } catch (_) {}
    }
    if (touched) applied += 1;
  }

  try {
    for (var i = 0; i < items.length; i += 1) {
      try { applyAppearance(items[i]); } catch (_) {}
    }
    result.appliedToCount = applied;
    result.ok = applied > 0;
    if (applied < 1 && !result.error) result.error = "set_appearance_failed";
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  return stringifySetAppearanceResult(result);
`;
}

export function buildIllustratorSetAppearanceJsx(params: IllustratorSetAppearanceParams): IllustratorExtendScriptBuild {
  const validated = validateIllustratorSetAppearanceParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${illustratorExtendScriptJsxPrelude({ expectedDocumentName: normalized.expectedDocumentName })}
${illustratorSetAppearanceJsxBody({
    fillColor: normalized.fillColor,
    strokeColor: normalized.strokeColor,
    strokeWidthPt: normalized.strokeWidthPt,
    swatchName: normalized.swatchName,
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

export type IllustratorVectorizeReceipt = {
  ok: boolean;
  appName: string | null;
  appRunning: boolean;
  /** Resolved raster path traced (provided, or read from the front document). */
  sourceImagePath: string | null;
  /** 'provided' | 'active_document_placed' — where the raster came from. */
  sourceKind: string | null;
  outputFileName: string | null;
  mode: IllustratorTracingMode;
  maxColors: number;
  threshold: number;
  ignoreWhite: boolean;
  /** Vector paths produced by the expand (0 on failure). */
  pathCount: number;
  /** stat()'d by the bridge AFTER the export — the proof the .svg landed. */
  fileExists: boolean;
  sizeBytes: number;
  error: string | null;
};

export function isIllustratorVectorizeReceipt(value: unknown): value is IllustratorVectorizeReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.appName)
    && typeof v.appRunning === 'boolean'
    && isNullableString(v.sourceImagePath)
    && isNullableString(v.sourceKind)
    && isNullableString(v.outputFileName)
    && (ILLUSTRATOR_TRACING_MODES as readonly string[]).includes(String(v.mode))
    && isFiniteNumber(v.maxColors)
    && isFiniteNumber(v.threshold)
    && typeof v.ignoreWhite === 'boolean'
    && isFiniteNumber(v.pathCount)
    && typeof v.fileExists === 'boolean'
    && isFiniteNumber(v.sizeBytes)
    && isNullableString(v.error);
}

export type IllustratorArrangeReceipt = {
  ok: boolean;
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  direction: IllustratorArrangeDirection;
  /** Selected objects whose z-order was changed (0 on failure). */
  movedCount: number;
  error: string | null;
};

export function isIllustratorArrangeReceipt(value: unknown): value is IllustratorArrangeReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.appName)
    && typeof v.appRunning === 'boolean'
    && isNullableString(v.documentName)
    && (ILLUSTRATOR_ARRANGE_DIRECTIONS as readonly string[]).includes(String(v.direction))
    && isFiniteNumber(v.movedCount)
    && isNullableString(v.error);
}

export type IllustratorAddTextReceipt = {
  ok: boolean;
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  /** Text that was added (truncated for the receipt). */
  contents: string;
  xPt: number;
  yPt: number;
  sizePt: number;
  /** Font actually applied (requested if resolved, else the inherited default). */
  appliedFont: string | null;
  fillApplied: boolean;
  /** 'font_not_found' when a requested font could not be resolved (text still created). */
  fontWarning: string | null;
  error: string | null;
};

export function isIllustratorAddTextReceipt(value: unknown): value is IllustratorAddTextReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.appName)
    && typeof v.appRunning === 'boolean'
    && isNullableString(v.documentName)
    && typeof v.contents === 'string'
    && isFiniteNumber(v.xPt)
    && isFiniteNumber(v.yPt)
    && isFiniteNumber(v.sizePt)
    && isNullableString(v.appliedFont)
    && typeof v.fillApplied === 'boolean'
    && isNullableString(v.fontWarning)
    && isNullableString(v.error);
}

export type IllustratorAddShapeReceipt = {
  ok: boolean;
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  kind: IllustratorAddShapeKind;
  fillApplied: boolean;
  strokeApplied: boolean;
  error: string | null;
};

export function isIllustratorAddShapeReceipt(value: unknown): value is IllustratorAddShapeReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.appName)
    && typeof v.appRunning === 'boolean'
    && isNullableString(v.documentName)
    && (ILLUSTRATOR_ADD_SHAPE_KINDS as readonly string[]).includes(String(v.kind))
    && typeof v.fillApplied === 'boolean'
    && typeof v.strokeApplied === 'boolean'
    && isNullableString(v.error);
}

export type IllustratorSetAppearanceReceipt = {
  ok: boolean;
  appName: string | null;
  appRunning: boolean;
  documentName: string | null;
  /** Leaf items (recursing into groups) whose appearance was changed (0 on failure). */
  appliedToCount: number;
  fillApplied: boolean;
  strokeApplied: boolean;
  error: string | null;
};

export function isIllustratorSetAppearanceReceipt(value: unknown): value is IllustratorSetAppearanceReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.appName)
    && typeof v.appRunning === 'boolean'
    && isNullableString(v.documentName)
    && isFiniteNumber(v.appliedToCount)
    && typeof v.fillApplied === 'boolean'
    && typeof v.strokeApplied === 'boolean'
    && isNullableString(v.error);
}
