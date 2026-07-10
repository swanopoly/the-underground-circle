/**
 * photoshopExtendScriptAdapters — pure JSX (ExtendScript) builders for the
 * Mac bridge's deterministic Photoshop mutation tools:
 *
 *   - photoshop_apply_adjustment_layer  (add ONE new adjustment layer)
 *   - photoshop_apply_selection_or_mask (Select Subject -> select/mask, never delete)
 *   - photoshop_resize_canvas_or_image  (image/canvas resize, crop to selection)
 *   - photoshop_manage_layers           (rename/duplicate/reorder/group ONLY —
 *                                        no delete, no merge, no flatten action exists)
 *   - photoshop_transform_layer         (move/scale/rotate ONE unlocked,
 *                                        non-background layer)
 *   - photoshop_convert_color_mode      (rgb/cmyk/grayscale via changeMode with an
 *                                        honest converted:false no-op; narrowing
 *                                        conversions discard color data in the
 *                                        UNSAVED working copy only — reversible
 *                                        until save, and these scripts never save)
 *
 * LOCKSTEP(scripts/claude-bridge.js): the bridge is a standalone Node script
 * that cannot import TS, so it carries byte-identical duplicates of the JSX
 * prelude, the JSX bodies, and the enum/range validation below (see the
 * `// LOCKSTEP(src/lib/photoshopExtendScriptAdapters.ts)` markers there —
 * same convention as computerUseSteering's edge duplicate). This module is
 * the smoke-tested source of truth; keep both sides in step.
 *
 * Pure module — no react-native, no supabase, no imports. Smoke:
 * `npx tsx scripts/photoshop-extendscript-adapters-smoketest.ts`.
 *
 * Safety contract shared by all three builders:
 *   - Mutations verify the target document first (prelude `documentMatches`
 *     with the expected document name) and fail closed with
 *     `{ok:false,error:'document_mismatch'}` when a name was given but does
 *     not match.
 *   - NEVER saves the document (no doc.save()/saveAs()) — saving stays a
 *     separate approval-gated step.
 *   - NEVER deletes pixels: "remove background" is expressed as a selection
 *     or a reveal-selection layer mask only.
 *   - All embedded arguments go through JSON.stringify so user text can never
 *     escape its ExtendScript string literal.
 *   - Every script returns a single JSON.stringify-shaped result line with
 *     `ok` and `error` so callers can fail closed on anything unexpected.
 */

export type PhotoshopExtendScriptBuild = { jsx: string; errors: string[] };

export type PhotoshopParamCheck<T> = { ok: true; value: T } | { ok: false; error: string };

// ─── Enums (LOCKSTEP(scripts/claude-bridge.js): PHOTOSHOP_* consts) ────────

export const PHOTOSHOP_BRIDGE_APP_NAME_PATTERN = /^[A-Za-z0-9 .\-_()]+$/;

export const PHOTOSHOP_ADJUSTMENT_LAYER_KINDS = [
  'levels',
  'curves',
  'hue_saturation',
  'brightness_contrast',
  'black_white',
] as const;
export type PhotoshopAdjustmentLayerKind = (typeof PHOTOSHOP_ADJUSTMENT_LAYER_KINDS)[number];

/**
 * ActionManager class stringIDs for `make adjustmentLayer using <type>`.
 * Note the Photoshop quirk: the brightness/contrast class stringID is
 * "brightnessEvent" (charID 'BrgC'), not "brightnessContrast".
 */
export const PHOTOSHOP_ADJUSTMENT_KIND_EVENT_IDS: Record<PhotoshopAdjustmentLayerKind, string> = {
  levels: 'levels',
  curves: 'curves',
  hue_saturation: 'hueSaturation',
  brightness_contrast: 'brightnessEvent',
  black_white: 'blackAndWhite',
};

export const PHOTOSHOP_SELECTION_MASK_MODES = ['select_only', 'mask_layer'] as const;
export type PhotoshopSelectionMaskMode = (typeof PHOTOSHOP_SELECTION_MASK_MODES)[number];

export const PHOTOSHOP_RESIZE_OPS = ['image_resize', 'canvas_resize', 'crop_to_selection'] as const;
export type PhotoshopResizeOp = (typeof PHOTOSHOP_RESIZE_OPS)[number];

export const PHOTOSHOP_CANVAS_ANCHORS = [
  'top_left',
  'top_center',
  'top_right',
  'middle_left',
  'middle_center',
  'middle_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
] as const;
export type PhotoshopCanvasAnchor = (typeof PHOTOSHOP_CANVAS_ANCHORS)[number];

export const PHOTOSHOP_CANVAS_ANCHOR_POSITIONS: Record<PhotoshopCanvasAnchor, string> = {
  top_left: 'TOPLEFT',
  top_center: 'TOPCENTER',
  top_right: 'TOPRIGHT',
  middle_left: 'MIDDLELEFT',
  middle_center: 'MIDDLECENTER',
  middle_right: 'MIDDLERIGHT',
  bottom_left: 'BOTTOMLEFT',
  bottom_center: 'BOTTOMCENTER',
  bottom_right: 'BOTTOMRIGHT',
};

export const PHOTOSHOP_MAX_PIXEL_DIMENSION = 30000;

/**
 * manage_layers actions are intentionally additive/organizational ONLY: there
 * is no delete, merge, or flatten action, and the emitted JSX never contains
 * a destructive layer call (smoke-asserted).
 */
export const PHOTOSHOP_MANAGE_LAYER_ACTIONS = ['rename', 'duplicate', 'reorder', 'group'] as const;
export type PhotoshopManageLayerAction = (typeof PHOTOSHOP_MANAGE_LAYER_ACTIONS)[number];

export const PHOTOSHOP_LAYER_REORDER_POSITIONS = ['top', 'bottom', 'above', 'below'] as const;
export type PhotoshopLayerReorderPosition = (typeof PHOTOSHOP_LAYER_REORDER_POSITIONS)[number];

export const PHOTOSHOP_TRANSFORM_OPS = ['move', 'scale', 'rotate'] as const;
export type PhotoshopTransformOp = (typeof PHOTOSHOP_TRANSFORM_OPS)[number];

export const PHOTOSHOP_MAX_TRANSLATE_PX = 30000;
export const PHOTOSHOP_MIN_SCALE_PERCENT = 1;
export const PHOTOSHOP_MAX_SCALE_PERCENT = 1000;
export const PHOTOSHOP_MAX_ROTATE_DEGREES = 360;

export const PHOTOSHOP_COLOR_MODES = ['rgb', 'cmyk', 'grayscale'] as const;
export type PhotoshopColorMode = (typeof PHOTOSHOP_COLOR_MODES)[number];

/** DOM `ChangeMode.<CONSTANT>` names for doc.changeMode. */
export const PHOTOSHOP_COLOR_MODE_CHANGE_MODES: Record<PhotoshopColorMode, string> = {
  rgb: 'RGB',
  cmyk: 'CMYK',
  grayscale: 'GRAYSCALE',
};

// ─── Scalar validators (LOCKSTEP(scripts/claude-bridge.js): endpoint 400s) ─

export function normalizePhotoshopBridgeAppName(value: unknown): PhotoshopParamCheck<string> {
  const appName = String(value ?? 'Photoshop').trim() || 'Photoshop';
  if (!PHOTOSHOP_BRIDGE_APP_NAME_PATTERN.test(appName)) {
    return { ok: false, error: 'Invalid appName.' };
  }
  return { ok: true, value: appName };
}

export function normalizePhotoshopTargetDocumentName(value: unknown): PhotoshopParamCheck<string> {
  const name = value == null ? '' : String(value).trim();
  if (name.length > 260 || /[\x00]/.test(name)) {
    return { ok: false, error: 'targetDocumentName must be <= 260 chars and cannot contain NUL.' };
  }
  return { ok: true, value: name };
}

export function normalizePhotoshopLayerNameParam(value: unknown): PhotoshopParamCheck<string> {
  const name = value == null ? '' : String(value).trim();
  if (name.length > 160 || /[\x00-\x1f]/.test(name)) {
    return { ok: false, error: 'layerName must be <= 160 chars and cannot contain control chars.' };
  }
  return { ok: true, value: name };
}

/**
 * Optional pixel dimension: undefined/null -> null (not provided). When
 * provided it must be an actual finite integer 1..30000 — numeric strings and
 * fractions are rejected (fail closed, mirrors the endpoint 400s).
 */
export function normalizePhotoshopPixelDimension(value: unknown, label: string): PhotoshopParamCheck<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > PHOTOSHOP_MAX_PIXEL_DIMENSION) {
    return { ok: false, error: `${label} must be a finite integer between 1 and ${PHOTOSHOP_MAX_PIXEL_DIMENSION}.` };
  }
  return { ok: true, value };
}

/** Required exact layer name: non-empty, <= 160 chars, no control chars. */
export function normalizePhotoshopRequiredLayerNameParam(value: unknown, label: string): PhotoshopParamCheck<string> {
  const name = value == null ? '' : String(value).trim();
  if (!name) return { ok: false, error: `${label} is required (exact layer name).` };
  if (name.length > 160 || /[\x00-\x1f]/.test(name)) {
    return { ok: false, error: `${label} must be <= 160 chars and cannot contain control chars.` };
  }
  return { ok: true, value: name };
}

/** Optional name (newName/referenceLayerName): '' when absent, same bounds as layer names. */
export function normalizePhotoshopOptionalNameParam(value: unknown, label: string): PhotoshopParamCheck<string> {
  const name = value == null ? '' : String(value).trim();
  if (name.length > 160 || /[\x00-\x1f]/.test(name)) {
    return { ok: false, error: `${label} must be <= 160 chars and cannot contain control chars.` };
  }
  return { ok: true, value: name };
}

/**
 * Optional move delta: undefined/null -> null (not provided). When provided it
 * must be an actual finite integer -30000..30000 px — numeric strings and
 * fractions are rejected (fail closed, mirrors the endpoint 400s).
 */
export function normalizePhotoshopTranslateDelta(value: unknown, label: string): PhotoshopParamCheck<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < -PHOTOSHOP_MAX_TRANSLATE_PX || value > PHOTOSHOP_MAX_TRANSLATE_PX) {
    return { ok: false, error: `${label} must be a finite integer between -${PHOTOSHOP_MAX_TRANSLATE_PX} and ${PHOTOSHOP_MAX_TRANSLATE_PX}.` };
  }
  return { ok: true, value };
}

/**
 * Optional bounded finite number (scalePercent/rotateDegrees). Fractional
 * values are allowed; NaN/Infinity/strings are rejected.
 */
export function normalizePhotoshopRangeNumber(value: unknown, label: string, min: number, max: number): PhotoshopParamCheck<number | null> {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return { ok: false, error: `${label} must be a finite number between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

// ─── JSX prelude ────────────────────────────────────────────────────────────

/**
 * LOCKSTEP(scripts/claude-bridge.js): byte-identical copy of the bridge's
 * `photoshopJsxPrelude` — document matching, JSON emit helpers, selection and
 * layer helpers shared by every Photoshop JSX script.
 */
export function photoshopExtendScriptJsxPrelude(
  { expectedDocumentName, sourceDocumentPath }: { expectedDocumentName?: string | null; sourceDocumentPath?: string | null },
): string {
  return `
var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};

function normalizeDocName(value) {
  return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
}

function normalizeDocPath(value) {
  try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
  return String(value || "").toLowerCase();
}

function documentPath(value) {
  try { return value.fullName.fsName; } catch (_) { return ""; }
}

function collectionLength(value) {
  try { return value ? value.length : 0; } catch (_) { return 0; }
}

function unitPx(value) {
  try { return Math.round(Number(value.as("px"))); } catch (_) {}
  try { return Math.round(Number(value)); } catch (_) {}
  return 0;
}

function documentMatches(value) {
  if (!value) return false;
  var docName = String(value.name || "");
  if (sourceDocumentPath) {
    var targetPath = normalizeDocPath(sourceDocumentPath);
    var currentPath = normalizeDocPath(documentPath(value));
    if (currentPath && currentPath === targetPath) return true;
    if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
  }
  if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
  return !sourceDocumentPath && !expectedDocumentName;
}

function findTargetDocument() {
  try {
    for (var i = 0; i < app.documents.length; i += 1) {
      if (documentMatches(app.documents[i])) return app.documents[i];
    }
  } catch (_) {}
  if (!sourceDocumentPath && !expectedDocumentName && collectionLength(app.documents) > 0) {
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

function hasActiveSelection(doc) {
  try {
    var bounds = doc.selection.bounds;
    return bounds && bounds.length === 4;
  } catch (_) {
    return false;
  }
}

function layerKindText(layer) {
  try { return String(layer.kind || ""); } catch (_) { return ""; }
}

function isTextLayer(layer) {
  return /text/i.test(layerKindText(layer));
}

function isSmartObjectLayer(layer) {
  return /smart/i.test(layerKindText(layer));
}

function isAdjustmentLayer(layer) {
  var kind = layerKindText(layer).toLowerCase();
  return /(brightness|contrast|curves|levels|exposure|hue|saturation|colorbalance|gradientmap|selectivecolor|threshold|posterize|channelmixer|photofilter|vibrance|blackandwhite|solidfill|gradientfill|patternfill)/.test(kind);
}

function layerLocked(layer) {
  try { if (layer.allLocked === true) return true; } catch (_) {}
  try { if (layer.pixelsLocked === true || layer.positionLocked === true || layer.transparentPixelsLocked === true) return true; } catch (_) {}
  return false;
}

function layerHasMask(layer) {
  try {
    if (!layer.id) return false;
    var ref = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    var desc = executeActionGet(ref);
    if (desc.hasKey(charIDToTypeID("UsrM"))) return true;
    if (desc.hasKey(stringIDToTypeID("hasUserMask"))) return true;
    if (desc.hasKey(stringIDToTypeID("hasVectorMask"))) return true;
  } catch (_) {}
  return false;
}

function layerBounds(layer) {
  var out = [];
  try {
    var bounds = layer.bounds;
    for (var i = 0; i < Math.min(4, bounds.length); i += 1) out.push(unitPx(bounds[i]));
  } catch (_) {}
  return out;
}

function textPreview(layer) {
  if (!isTextLayer(layer)) return "";
  try { return String(layer.textItem.contents || "").replace(/\\s+/g, " ").slice(0, 240); } catch (_) {}
  return "";
}

function layerMatches(layer, pathText, query) {
  if (!query) return true;
  var q = String(query || "").toLowerCase();
  var haystack = [
    String(layer && layer.name ? layer.name : ""),
    String(pathText || ""),
    textPreview(layer),
    layerKindText(layer)
  ].join(" ").toLowerCase();
  return haystack.indexOf(q) >= 0;
}

function walkLayers(parent, prefix, query, maxItems, stats, out, collect) {
  var layers;
  try { layers = parent.layers; } catch (_) { return; }
  var len = collectionLength(layers);
  for (var i = 0; i < len; i += 1) {
    var layer = layers[i];
    var name = "";
    try { name = String(layer.name || ""); } catch (_) {}
    var pathText = prefix ? prefix + " / " + name : name;
    var typename = "";
    try { typename = String(layer.typename || ""); } catch (_) {}
    var kind = layerKindText(layer);
    var isGroup = /LayerSet/i.test(typename);
    var isText = isTextLayer(layer);
    var isSmart = isSmartObjectLayer(layer);
    var isAdjustment = isAdjustmentLayer(layer);
    var hasMask = layerHasMask(layer);
    stats.layerCount += 1;
    if (isGroup) stats.groupCount += 1;
    if (isText) stats.textLayerCount += 1;
    if (isSmart) stats.smartObjectCount += 1;
    if (isAdjustment) stats.adjustmentLayerCount += 1;
    if (hasMask) stats.maskLayerCount += 1;
    try { if (layer.visible === false) stats.hiddenLayers += 1; } catch (_) {}
    if (layerLocked(layer)) stats.lockedLayers += 1;
    if (layerMatches(layer, pathText, query)) {
      stats.matchedLayers += 1;
      if (collect && out.length < maxItems) {
        var bounds = layerBounds(layer);
        var boundValues = [];
        for (var b = 0; b < bounds.length; b += 1) boundValues.push(jsonNumber(bounds[b]));
        out.push("{" + [
          "\\"name\\":" + jsonString(name),
          "\\"path\\":" + jsonString(pathText),
          "\\"type\\":" + jsonString(isGroup ? "group" : "layer"),
          "\\"kind\\":" + jsonString(kind),
          "\\"visible\\":" + jsonBoolean((function () { try { return layer.visible !== false; } catch (_) { return true; } }())),
          "\\"locked\\":" + jsonBoolean(layerLocked(layer)),
          "\\"opacity\\":" + jsonNumber((function () { try { return layer.opacity; } catch (_) { return 0; } }())),
          "\\"textPreview\\":" + jsonString(textPreview(layer)),
          "\\"hasMask\\":" + jsonBoolean(hasMask),
          "\\"bounds\\":" + jsonArray(boundValues),
          "\\"depth\\":" + jsonNumber(prefix ? prefix.split(" / ").length : 0)
        ].join(",") + "}");
      }
    }
    if (isGroup) walkLayers(layer, pathText, query, maxItems, stats, out, collect);
  }
}

function blankLayerStats() {
  return {
    layerCount: 0,
    matchedLayers: 0,
    textLayerCount: 0,
    smartObjectCount: 0,
    adjustmentLayerCount: 0,
    groupCount: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    maskLayerCount: 0
  };
}

function getLayerStats(doc) {
  var stats = blankLayerStats();
  walkLayers(doc, "", "", 0, stats, [], false);
  return stats;
}
`;
}

// ─── Shared JSX fragments ───────────────────────────────────────────────────

/**
 * LOCKSTEP(scripts/claude-bridge.js): photoshopFindLayerByExactNameJsx — exact
 * (case-sensitive) layer lookup, depth-first through layer sets.
 */
function photoshopFindLayerByExactNameJsx(): string {
  return `
  function findLayerByExactName(parent, targetLayerName) {
    var layers;
    try { layers = parent.layers; } catch (_) { return null; }
    for (var i = 0; i < collectionLength(layers); i += 1) {
      var layer = layers[i];
      var currentName = "";
      try { currentName = String(layer.name || ""); } catch (_) {}
      if (currentName === targetLayerName) return layer;
      var typename = "";
      try { typename = String(layer.typename || ""); } catch (_) {}
      if (/LayerSet/i.test(typename)) {
        var nested = findLayerByExactName(layer, targetLayerName);
        if (nested) return nested;
      }
    }
    return null;
  }
`;
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): photoshopCollectLayersByExactNameJsx —
 * exact (case-sensitive) layer lookup that counts every match so mutating
 * adapters can fail closed on 0 matches (missingError) or on ambiguous names
 * (>1 matches, ambiguousError) instead of guessing a target.
 */
function photoshopCollectLayersByExactNameJsx(): string {
  return `
  function collectLayersByExactName(parent, targetLayerName, out) {
    var layers;
    try { layers = parent.layers; } catch (_) { return out; }
    for (var i = 0; i < collectionLength(layers); i += 1) {
      var layer = layers[i];
      var currentName = "";
      try { currentName = String(layer.name || ""); } catch (_) {}
      if (currentName === targetLayerName) out.push(layer);
      var typename = "";
      try { typename = String(layer.typename || ""); } catch (_) {}
      if (/LayerSet/i.test(typename)) collectLayersByExactName(layer, targetLayerName, out);
    }
    return out;
  }

  function findUniqueLayerByExactName(doc, targetLayerName, result, missingError, ambiguousError) {
    var matches = collectLayersByExactName(doc, targetLayerName, []);
    if (matches.length < 1) { result.error = missingError; return null; }
    if (matches.length > 1) { result.error = ambiguousError; return null; }
    return matches[0];
  }
`;
}

// ─── 1) Apply adjustment layer ──────────────────────────────────────────────

export type PhotoshopApplyAdjustmentLayerParams = {
  appName?: string;
  targetDocumentName?: string | null;
  /** Optional anchor: the new adjustment layer is created above this layer (exact name), else at the top. */
  layerName?: string | null;
  kind: PhotoshopAdjustmentLayerKind | string;
  /** Default true. This adapter is additive-only either way — existing adjustment layers are never modified. */
  preserveExisting?: boolean;
};

export type NormalizedPhotoshopApplyAdjustmentLayerParams = {
  appName: string;
  targetDocumentName: string;
  layerName: string;
  kind: PhotoshopAdjustmentLayerKind;
  preserveExisting: boolean;
};

export function validatePhotoshopApplyAdjustmentLayerParams(
  params: PhotoshopApplyAdjustmentLayerParams,
): { ok: true; params: NormalizedPhotoshopApplyAdjustmentLayerParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizePhotoshopBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const targetDocumentName = normalizePhotoshopTargetDocumentName(params?.targetDocumentName);
  if (!targetDocumentName.ok) errors.push(targetDocumentName.error);
  const layerName = normalizePhotoshopLayerNameParam(params?.layerName);
  if (!layerName.ok) errors.push(layerName.error);
  const kind = String(params?.kind ?? '').trim();
  if (!(PHOTOSHOP_ADJUSTMENT_LAYER_KINDS as readonly string[]).includes(kind)) {
    errors.push('kind must be one of levels, curves, hue_saturation, brightness_contrast, black_white.');
  }
  if (params?.preserveExisting !== undefined && typeof params.preserveExisting !== 'boolean') {
    errors.push('preserveExisting must be a boolean.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Photoshop',
      targetDocumentName: targetDocumentName.ok ? targetDocumentName.value : '',
      layerName: layerName.ok ? layerName.value : '',
      kind: kind as PhotoshopAdjustmentLayerKind,
      preserveExisting: params?.preserveExisting !== false,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): photoshopApplyAdjustmentLayerJsxBody —
 * keep this JSX body byte-identical with the bridge duplicate.
 */
function photoshopApplyAdjustmentLayerJsxBody(
  { layerName, kind, kindEventId, preserveExisting }: { layerName: string; kind: string; kindEventId: string; preserveExisting: boolean },
): string {
  return `
  var layerName = ${JSON.stringify(String(layerName ?? ''))};
  var kind = ${JSON.stringify(String(kind ?? ''))};
  var kindEventId = ${JSON.stringify(String(kindEventId ?? ''))};
  var preserveExisting = ${preserveExisting === false ? 'false' : 'true'};

  function stringifyAdjustmentResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"kind\\":" + jsonString(value.kind),
      "\\"createdLayerName\\":" + jsonNullableString(value.createdLayerName),
      "\\"layerCountBefore\\":" + jsonNumber(value.layerCountBefore),
      "\\"layerCountAfter\\":" + jsonNumber(value.layerCountAfter),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }
${photoshopFindLayerByExactNameJsx()}
  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    documentName: null,
    kind: kind,
    createdLayerName: null,
    layerCountBefore: 0,
    layerCountAfter: 0,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyAdjustmentResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyAdjustmentResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");
  result.layerCountBefore = getLayerStats(doc).layerCount;

  var anchorLayer = layerName ? findLayerByExactName(doc, layerName) : null;
  try {
    if (anchorLayer) doc.activeLayer = anchorLayer;
    else if (collectionLength(doc.layers) > 0) doc.activeLayer = doc.layers[0];
  } catch (_) {}

  // preserveExisting contract: this adapter is additive-only. It creates ONE
  // new adjustment layer above the anchor (or at the top) and never edits,
  // moves, merges, or removes existing layers on any path.
  try {
    var makeDescriptor = new ActionDescriptor();
    var adjustmentRef = new ActionReference();
    adjustmentRef.putClass(stringIDToTypeID("adjustmentLayer"));
    makeDescriptor.putReference(stringIDToTypeID("null"), adjustmentRef);
    var usingDescriptor = new ActionDescriptor();
    usingDescriptor.putClass(stringIDToTypeID("type"), stringIDToTypeID(kindEventId));
    makeDescriptor.putObject(stringIDToTypeID("using"), stringIDToTypeID("adjustmentLayer"), usingDescriptor);
    executeAction(stringIDToTypeID("make"), makeDescriptor, DialogModes.NO);
    try { result.createdLayerName = String(doc.activeLayer.name || ""); } catch (_) {}
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  result.layerCountAfter = getLayerStats(doc).layerCount;
  if (result.ok && result.layerCountAfter <= result.layerCountBefore) {
    result.ok = false;
    result.error = "adjustment_layer_not_created";
  }
  return stringifyAdjustmentResult(result);
`;
}

export function buildPhotoshopApplyAdjustmentLayerJsx(params: PhotoshopApplyAdjustmentLayerParams): PhotoshopExtendScriptBuild {
  const validated = validatePhotoshopApplyAdjustmentLayerParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${photoshopExtendScriptJsxPrelude({ expectedDocumentName: normalized.targetDocumentName, sourceDocumentPath: '' })}
${photoshopApplyAdjustmentLayerJsxBody({
    layerName: normalized.layerName,
    kind: normalized.kind,
    kindEventId: PHOTOSHOP_ADJUSTMENT_KIND_EVENT_IDS[normalized.kind],
    preserveExisting: normalized.preserveExisting,
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 2) Apply selection or mask (Select Subject core) ───────────────────────

export type PhotoshopApplySelectionOrMaskParams = {
  appName?: string;
  targetDocumentName?: string | null;
  /** Optional exact-name target layer; defaults to the active layer. Missing name fails closed. */
  layerName?: string | null;
  mode: PhotoshopSelectionMaskMode | string;
};

export type NormalizedPhotoshopApplySelectionOrMaskParams = {
  appName: string;
  targetDocumentName: string;
  layerName: string;
  mode: PhotoshopSelectionMaskMode;
};

export function validatePhotoshopApplySelectionOrMaskParams(
  params: PhotoshopApplySelectionOrMaskParams,
): { ok: true; params: NormalizedPhotoshopApplySelectionOrMaskParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizePhotoshopBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const targetDocumentName = normalizePhotoshopTargetDocumentName(params?.targetDocumentName);
  if (!targetDocumentName.ok) errors.push(targetDocumentName.error);
  const layerName = normalizePhotoshopLayerNameParam(params?.layerName);
  if (!layerName.ok) errors.push(layerName.error);
  const mode = String(params?.mode ?? '').trim();
  if (!(PHOTOSHOP_SELECTION_MASK_MODES as readonly string[]).includes(mode)) {
    errors.push('mode must be select_only or mask_layer.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Photoshop',
      targetDocumentName: targetDocumentName.ok ? targetDocumentName.value : '',
      layerName: layerName.ok ? layerName.value : '',
      mode: mode as PhotoshopSelectionMaskMode,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): photoshopApplySelectionOrMaskJsxBody —
 * keep this JSX body byte-identical with the bridge duplicate. The mode
 * branch is resolved at build time so the emitted script contains ONLY the
 * non-destructive path it was asked for; there is no pixel-deleting mode.
 */
function photoshopApplySelectionOrMaskJsxBody({ layerName, mode }: { layerName: string; mode: PhotoshopSelectionMaskMode }): string {
  const head = `
  var layerName = ${JSON.stringify(String(layerName ?? ''))};
  var mode = ${JSON.stringify(String(mode ?? ''))};

  function stringifySelectionResult(value) {
    var boundsJson = "null";
    if (value.selectionBounds) {
      boundsJson = "{" + [
        "\\"left\\":" + jsonNumber(value.selectionBounds.left),
        "\\"top\\":" + jsonNumber(value.selectionBounds.top),
        "\\"right\\":" + jsonNumber(value.selectionBounds.right),
        "\\"bottom\\":" + jsonNumber(value.selectionBounds.bottom)
      ].join(",") + "}";
    }
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"layerName\\":" + jsonNullableString(value.layerName),
      "\\"mode\\":" + jsonString(value.mode),
      "\\"selectionBounds\\":" + boundsJson,
      "\\"maskApplied\\":" + jsonBoolean(value.maskApplied),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }
${photoshopFindLayerByExactNameJsx()}
  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    documentName: null,
    layerName: null,
    mode: mode,
    selectionBounds: null,
    maskApplied: false,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifySelectionResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifySelectionResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");

  if (layerName) {
    var targetLayer = findLayerByExactName(doc, layerName);
    if (!targetLayer) {
      result.error = "layer_not_found";
      return stringifySelectionResult(result);
    }
    try { doc.activeLayer = targetLayer; } catch (_) {}
  }
  try { result.layerName = String(doc.activeLayer.name || ""); } catch (_) {}

  // Select Subject (stable ExtendScript event since Photoshop 2020).
  try {
    var selectSubjectDescriptor = new ActionDescriptor();
    selectSubjectDescriptor.putBoolean(stringIDToTypeID("sampleAllLayers"), false);
    executeAction(stringIDToTypeID("autoCutout"), selectSubjectDescriptor, DialogModes.NO);
  } catch (err) {
    result.error = "select_subject_failed: " + String(err && err.message ? err.message : err);
    return stringifySelectionResult(result);
  }
  if (!hasActiveSelection(doc)) {
    result.error = "selection_empty";
    return stringifySelectionResult(result);
  }
  try {
    var selectionBounds = doc.selection.bounds;
    result.selectionBounds = {
      left: unitPx(selectionBounds[0]),
      top: unitPx(selectionBounds[1]),
      right: unitPx(selectionBounds[2]),
      bottom: unitPx(selectionBounds[3])
    };
  } catch (_) {}
`;
  if (mode === 'select_only') {
    return `${head}
  // select_only: leave the subject selection active and report its bounds.
  result.ok = true;
  return stringifySelectionResult(result);
`;
  }
  return `${head}
  // mask_layer: apply the subject selection as a NON-destructive layer mask
  // (make channel at mask using revealSelection). Pixels are never deleted.
  try {
    var maskDescriptor = new ActionDescriptor();
    maskDescriptor.putClass(stringIDToTypeID("new"), stringIDToTypeID("channel"));
    var maskRef = new ActionReference();
    maskRef.putEnumerated(stringIDToTypeID("channel"), stringIDToTypeID("channel"), stringIDToTypeID("mask"));
    maskDescriptor.putReference(stringIDToTypeID("at"), maskRef);
    maskDescriptor.putEnumerated(stringIDToTypeID("using"), stringIDToTypeID("userMaskEnabled"), stringIDToTypeID("revealSelection"));
    executeAction(stringIDToTypeID("make"), maskDescriptor, DialogModes.NO);
  } catch (err) {
    result.error = "mask_apply_failed: " + String(err && err.message ? err.message : err);
    return stringifySelectionResult(result);
  }
  try { result.maskApplied = layerHasMask(doc.activeLayer); } catch (_) {}
  if (!result.maskApplied) {
    result.error = "mask_not_verified";
    return stringifySelectionResult(result);
  }
  result.ok = true;
  return stringifySelectionResult(result);
`;
}

export function buildPhotoshopApplySelectionOrMaskJsx(params: PhotoshopApplySelectionOrMaskParams): PhotoshopExtendScriptBuild {
  const validated = validatePhotoshopApplySelectionOrMaskParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${photoshopExtendScriptJsxPrelude({ expectedDocumentName: normalized.targetDocumentName, sourceDocumentPath: '' })}
${photoshopApplySelectionOrMaskJsxBody({ layerName: normalized.layerName, mode: normalized.mode })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 3) Resize canvas or image / crop to selection ──────────────────────────

export type PhotoshopResizeCanvasOrImageParams = {
  appName?: string;
  targetDocumentName?: string | null;
  op: PhotoshopResizeOp | string;
  widthPx?: number | null;
  heightPx?: number | null;
  /** canvas_resize only; defaults to middle_center. */
  anchor?: PhotoshopCanvasAnchor | string | null;
};

export type NormalizedPhotoshopResizeCanvasOrImageParams = {
  appName: string;
  targetDocumentName: string;
  op: PhotoshopResizeOp;
  widthPx: number | null;
  heightPx: number | null;
  anchor: PhotoshopCanvasAnchor;
};

export function validatePhotoshopResizeCanvasOrImageParams(
  params: PhotoshopResizeCanvasOrImageParams,
): { ok: true; params: NormalizedPhotoshopResizeCanvasOrImageParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizePhotoshopBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const targetDocumentName = normalizePhotoshopTargetDocumentName(params?.targetDocumentName);
  if (!targetDocumentName.ok) errors.push(targetDocumentName.error);
  const op = String(params?.op ?? '').trim();
  const opValid = (PHOTOSHOP_RESIZE_OPS as readonly string[]).includes(op);
  if (!opValid) errors.push('op must be image_resize, canvas_resize, or crop_to_selection.');
  const widthPx = normalizePhotoshopPixelDimension(params?.widthPx, 'widthPx');
  if (!widthPx.ok) errors.push(widthPx.error);
  const heightPx = normalizePhotoshopPixelDimension(params?.heightPx, 'heightPx');
  if (!heightPx.ok) errors.push(heightPx.error);
  const rawAnchor = params?.anchor == null ? '' : String(params.anchor).trim();
  if (rawAnchor && !(PHOTOSHOP_CANVAS_ANCHORS as readonly string[]).includes(rawAnchor)) {
    errors.push('anchor must be one of top_left, top_center, top_right, middle_left, middle_center, middle_right, bottom_left, bottom_center, bottom_right.');
  }
  if (opValid && widthPx.ok && heightPx.ok) {
    if (op === 'crop_to_selection') {
      if (widthPx.value != null || heightPx.value != null) {
        errors.push('crop_to_selection does not accept widthPx or heightPx.');
      }
    } else if (widthPx.value == null && heightPx.value == null) {
      errors.push(`${op} requires widthPx and/or heightPx.`);
    }
  }
  if (opValid && rawAnchor && op !== 'canvas_resize') {
    errors.push('anchor is only valid for canvas_resize.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Photoshop',
      targetDocumentName: targetDocumentName.ok ? targetDocumentName.value : '',
      op: op as PhotoshopResizeOp,
      widthPx: widthPx.ok ? widthPx.value : null,
      heightPx: heightPx.ok ? heightPx.value : null,
      anchor: (rawAnchor || 'middle_center') as PhotoshopCanvasAnchor,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): photoshopResizeCanvasOrImageJsxBody —
 * keep this JSX body byte-identical with the bridge duplicate. The op branch
 * is resolved at build time; crop_to_selection fails closed with
 * `no_active_selection` when nothing is selected.
 */
function photoshopResizeCanvasOrImageJsxBody(
  { op, widthPx, heightPx, anchor }: { op: PhotoshopResizeOp; widthPx: number | null; heightPx: number | null; anchor: PhotoshopCanvasAnchor },
): string {
  const widthLiteral = widthPx == null ? 0 : Math.trunc(widthPx);
  const heightLiteral = heightPx == null ? 0 : Math.trunc(heightPx);
  const head = `
  var op = ${JSON.stringify(String(op ?? ''))};
  var widthPxParam = ${JSON.stringify(widthLiteral)};
  var heightPxParam = ${JSON.stringify(heightLiteral)};

  function stringifyResizeResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"op\\":" + jsonString(value.op),
      "\\"widthPxBefore\\":" + jsonNumber(value.widthPxBefore),
      "\\"heightPxBefore\\":" + jsonNumber(value.heightPxBefore),
      "\\"widthPxAfter\\":" + jsonNumber(value.widthPxAfter),
      "\\"heightPxAfter\\":" + jsonNumber(value.heightPxAfter),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    documentName: null,
    op: op,
    widthPxBefore: 0,
    heightPxBefore: 0,
    widthPxAfter: 0,
    heightPxAfter: 0,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyResizeResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyResizeResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");
  try { result.widthPxBefore = unitPx(doc.width); } catch (_) {}
  try { result.heightPxBefore = unitPx(doc.height); } catch (_) {}
`;
  const foot = `
  try { result.widthPxAfter = unitPx(doc.width); } catch (_) {}
  try { result.heightPxAfter = unitPx(doc.height); } catch (_) {}
  return stringifyResizeResult(result);
`;
  if (op === 'image_resize') {
    return `${head}
  // image_resize: bicubic resample; when only one dimension is given the
  // other is derived from the current aspect ratio (keep proportions).
  var targetWidth = widthPxParam;
  var targetHeight = heightPxParam;
  if (targetWidth > 0 && !(targetHeight > 0) && result.widthPxBefore > 0) {
    targetHeight = Math.max(1, Math.round(targetWidth * result.heightPxBefore / result.widthPxBefore));
  }
  if (targetHeight > 0 && !(targetWidth > 0) && result.heightPxBefore > 0) {
    targetWidth = Math.max(1, Math.round(targetHeight * result.widthPxBefore / result.heightPxBefore));
  }
  if (!(targetWidth > 0) || !(targetHeight > 0)) {
    result.error = "invalid_dimensions";
    return stringifyResizeResult(result);
  }
  try {
    doc.resizeImage(UnitValue(targetWidth, "px"), UnitValue(targetHeight, "px"), null, ResampleMethod.BICUBIC);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
${foot}`;
  }
  if (op === 'canvas_resize') {
    return `${head}
  // canvas_resize: content is never scaled; a missing dimension keeps the
  // current canvas size on that axis.
  var anchorPosition = AnchorPosition.${PHOTOSHOP_CANVAS_ANCHOR_POSITIONS[anchor]};
  var targetWidth = widthPxParam > 0 ? widthPxParam : result.widthPxBefore;
  var targetHeight = heightPxParam > 0 ? heightPxParam : result.heightPxBefore;
  if (!(targetWidth > 0) || !(targetHeight > 0)) {
    result.error = "invalid_dimensions";
    return stringifyResizeResult(result);
  }
  try {
    doc.resizeCanvas(UnitValue(targetWidth, "px"), UnitValue(targetHeight, "px"), anchorPosition);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
${foot}`;
  }
  return `${head}
  // crop_to_selection: only crops to an existing active selection — fails
  // closed when nothing is selected.
  if (!hasActiveSelection(doc)) {
    result.error = "no_active_selection";
    return stringifyResizeResult(result);
  }
  try {
    doc.crop(doc.selection.bounds);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
${foot}`;
}

export function buildPhotoshopResizeCanvasOrImageJsx(params: PhotoshopResizeCanvasOrImageParams): PhotoshopExtendScriptBuild {
  const validated = validatePhotoshopResizeCanvasOrImageParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${photoshopExtendScriptJsxPrelude({ expectedDocumentName: normalized.targetDocumentName, sourceDocumentPath: '' })}
${photoshopResizeCanvasOrImageJsxBody({
    op: normalized.op,
    widthPx: normalized.widthPx,
    heightPx: normalized.heightPx,
    anchor: normalized.anchor,
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 4) Manage layers (rename / duplicate / reorder / group) ────────────────

export type PhotoshopManageLayersParams = {
  appName?: string;
  targetDocumentName?: string | null;
  action: PhotoshopManageLayerAction | string;
  /** Required exact-name target layer. 0 or >1 matches fail closed. */
  layerName: string;
  /** rename (required) / duplicate / group (optional): new layer/copy/group name. */
  newName?: string | null;
  /** reorder only. */
  position?: PhotoshopLayerReorderPosition | string | null;
  /** reorder above/below only: exact-name anchor layer. */
  referenceLayerName?: string | null;
};

export type NormalizedPhotoshopManageLayersParams = {
  appName: string;
  targetDocumentName: string;
  action: PhotoshopManageLayerAction;
  layerName: string;
  newName: string;
  position: string;
  referenceLayerName: string;
};

export function validatePhotoshopManageLayersParams(
  params: PhotoshopManageLayersParams,
): { ok: true; params: NormalizedPhotoshopManageLayersParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizePhotoshopBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const targetDocumentName = normalizePhotoshopTargetDocumentName(params?.targetDocumentName);
  if (!targetDocumentName.ok) errors.push(targetDocumentName.error);
  const action = String(params?.action ?? '').trim();
  const actionValid = (PHOTOSHOP_MANAGE_LAYER_ACTIONS as readonly string[]).includes(action);
  if (!actionValid) errors.push('action must be one of rename, duplicate, reorder, group.');
  const layerName = normalizePhotoshopRequiredLayerNameParam(params?.layerName, 'layerName');
  if (!layerName.ok) errors.push(layerName.error);
  const newName = normalizePhotoshopOptionalNameParam(params?.newName, 'newName');
  if (!newName.ok) errors.push(newName.error);
  const rawPosition = params?.position == null ? '' : String(params.position).trim();
  const positionValid = !rawPosition || (PHOTOSHOP_LAYER_REORDER_POSITIONS as readonly string[]).includes(rawPosition);
  if (!positionValid) errors.push('position must be one of top, bottom, above, below.');
  const referenceLayerName = normalizePhotoshopOptionalNameParam(params?.referenceLayerName, 'referenceLayerName');
  if (!referenceLayerName.ok) errors.push(referenceLayerName.error);
  if (actionValid && layerName.ok && newName.ok && positionValid && referenceLayerName.ok) {
    if (action === 'rename' && !newName.value) errors.push('rename requires newName.');
    if (action !== 'reorder' && rawPosition) errors.push('position is only valid for reorder.');
    if (action === 'reorder') {
      if (newName.value) errors.push('newName is only valid for rename, duplicate, or group.');
      if (!rawPosition) errors.push('reorder requires position (top, bottom, above, or below).');
      if ((rawPosition === 'above' || rawPosition === 'below') && !referenceLayerName.value) {
        errors.push('position above/below requires referenceLayerName.');
      }
      if ((rawPosition === 'top' || rawPosition === 'bottom') && referenceLayerName.value) {
        errors.push('referenceLayerName is only valid for position above or below.');
      }
    } else if (referenceLayerName.value) {
      errors.push('referenceLayerName is only valid for reorder above/below.');
    }
    if (referenceLayerName.value && referenceLayerName.value === layerName.value) {
      errors.push('referenceLayerName must differ from layerName.');
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Photoshop',
      targetDocumentName: targetDocumentName.ok ? targetDocumentName.value : '',
      action: action as PhotoshopManageLayerAction,
      layerName: layerName.ok ? layerName.value : '',
      newName: newName.ok ? newName.value : '',
      position: rawPosition,
      referenceLayerName: referenceLayerName.ok ? referenceLayerName.value : '',
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): photoshopManageLayersJsxBody — keep this
 * JSX body byte-identical with the bridge duplicate. The action branch is
 * resolved at build time so the emitted script contains ONLY the requested
 * organizational path; no destructive layer call exists in any branch.
 */
function photoshopManageLayersJsxBody(
  { action, layerName, newName, position, referenceLayerName }: {
    action: PhotoshopManageLayerAction;
    layerName: string;
    newName: string;
    position: string;
    referenceLayerName: string;
  },
): string {
  const head = `
  var action = ${JSON.stringify(String(action ?? ''))};
  var layerName = ${JSON.stringify(String(layerName ?? ''))};
  var newName = ${JSON.stringify(String(newName ?? ''))};
  var position = ${JSON.stringify(String(position ?? ''))};
  var referenceLayerName = ${JSON.stringify(String(referenceLayerName ?? ''))};

  function stringifyManageResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"action\\":" + jsonString(value.action),
      "\\"layerName\\":" + jsonNullableString(value.layerName),
      "\\"resultLayerName\\":" + jsonNullableString(value.resultLayerName),
      "\\"layerCountBefore\\":" + jsonNumber(value.layerCountBefore),
      "\\"layerCountAfter\\":" + jsonNumber(value.layerCountAfter),
      "\\"layerIndexBefore\\":" + jsonNumber(value.layerIndexBefore),
      "\\"layerIndexAfter\\":" + jsonNumber(value.layerIndexAfter),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }
${photoshopCollectLayersByExactNameJsx()}
  function layerItemIndex(layer) {
    try { return Math.round(Number(layer.itemIndex)); } catch (_) {}
    return 0;
  }

  // manage_layers contract: rename/duplicate/reorder/group ONLY. No action in
  // this adapter can discard or combine existing layers.
  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    documentName: null,
    action: action,
    layerName: layerName,
    resultLayerName: null,
    layerCountBefore: 0,
    layerCountAfter: 0,
    layerIndexBefore: 0,
    layerIndexAfter: 0,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyManageResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyManageResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");
  result.layerCountBefore = getLayerStats(doc).layerCount;

  var target = findUniqueLayerByExactName(doc, layerName, result, "layer_not_found", "layer_ambiguous");
  if (!target) return stringifyManageResult(result);
  result.layerIndexBefore = layerItemIndex(target);
  var resultLayer = target;
`;
  const foot = `
  result.layerCountAfter = getLayerStats(doc).layerCount;
  result.layerIndexAfter = layerItemIndex(resultLayer);
  return stringifyManageResult(result);
`;
  if (action === 'rename') {
    return `${head}
  // rename: metadata-only change — sets the layer's .name and verifies it.
  try {
    target.name = newName;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    return stringifyManageResult(result);
  }
  var renamedTo = "";
  try { renamedTo = String(target.name || ""); } catch (_) {}
  if (renamedTo !== newName) {
    result.error = "rename_not_applied";
    return stringifyManageResult(result);
  }
  result.resultLayerName = renamedTo;
  result.ok = true;
${foot}`;
  }
  if (action === 'duplicate') {
    return `${head}
  // duplicate: creates ONE copy above the source layer; the source layer
  // itself is never changed.
  try {
    resultLayer = target.duplicate();
    if (newName) resultLayer.name = newName;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    return stringifyManageResult(result);
  }
  try { result.resultLayerName = String(resultLayer.name || ""); } catch (_) {}
  result.ok = true;
  result.layerCountAfter = getLayerStats(doc).layerCount;
  result.layerIndexAfter = layerItemIndex(resultLayer);
  if (result.layerCountAfter <= result.layerCountBefore) {
    result.ok = false;
    result.error = "duplicate_not_created";
  }
  return stringifyManageResult(result);
`;
  }
  if (action === 'reorder') {
    return `${head}
  // reorder: repositions the layer in the stack via ElementPlacement moves;
  // layer content is untouched.
  try {
    if (position === "top") {
      target.move(doc, ElementPlacement.INSIDE);
    } else if (position === "bottom") {
      var bottomAnchor = doc.layers[collectionLength(doc.layers) - 1];
      if (bottomAnchor !== target) target.move(bottomAnchor, ElementPlacement.PLACEAFTER);
    } else {
      var referenceLayer = findUniqueLayerByExactName(doc, referenceLayerName, result, "reference_layer_not_found", "reference_layer_ambiguous");
      if (!referenceLayer) return stringifyManageResult(result);
      target.move(referenceLayer, position === "above" ? ElementPlacement.PLACEBEFORE : ElementPlacement.PLACEAFTER);
    }
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    return stringifyManageResult(result);
  }
  try { result.resultLayerName = String(target.name || ""); } catch (_) {}
  result.ok = true;
${foot}`;
  }
  return `${head}
  // group: creates ONE new empty layer set and moves the layer inside it;
  // no other layer is touched.
  var groupSet = null;
  try {
    groupSet = doc.layerSets.add();
    if (newName) groupSet.name = newName;
    target.move(groupSet, ElementPlacement.INSIDE);
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
    return stringifyManageResult(result);
  }
  resultLayer = groupSet;
  try { result.resultLayerName = String(groupSet.name || ""); } catch (_) {}
  result.ok = true;
  result.layerCountAfter = getLayerStats(doc).layerCount;
  result.layerIndexAfter = layerItemIndex(resultLayer);
  if (result.layerCountAfter <= result.layerCountBefore) {
    result.ok = false;
    result.error = "group_not_created";
  }
  return stringifyManageResult(result);
`;
}

export function buildPhotoshopManageLayersJsx(params: PhotoshopManageLayersParams): PhotoshopExtendScriptBuild {
  const validated = validatePhotoshopManageLayersParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${photoshopExtendScriptJsxPrelude({ expectedDocumentName: normalized.targetDocumentName, sourceDocumentPath: '' })}
${photoshopManageLayersJsxBody({
    action: normalized.action,
    layerName: normalized.layerName,
    newName: normalized.newName,
    position: normalized.position,
    referenceLayerName: normalized.referenceLayerName,
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 5) Transform layer (move / scale / rotate) ─────────────────────────────

export type PhotoshopTransformLayerParams = {
  appName?: string;
  targetDocumentName?: string | null;
  /** Required exact-name target layer. 0 or >1 matches fail closed. */
  layerName: string;
  op: PhotoshopTransformOp | string;
  /** move only: integer px, -30000..30000. */
  deltaX?: number | null;
  deltaY?: number | null;
  /** scale only: uniform percent, 1..1000. */
  scalePercent?: number | null;
  /** rotate only: degrees, -360..360. */
  rotateDegrees?: number | null;
};

export type NormalizedPhotoshopTransformLayerParams = {
  appName: string;
  targetDocumentName: string;
  layerName: string;
  op: PhotoshopTransformOp;
  deltaX: number | null;
  deltaY: number | null;
  scalePercent: number | null;
  rotateDegrees: number | null;
};

export function validatePhotoshopTransformLayerParams(
  params: PhotoshopTransformLayerParams,
): { ok: true; params: NormalizedPhotoshopTransformLayerParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizePhotoshopBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const targetDocumentName = normalizePhotoshopTargetDocumentName(params?.targetDocumentName);
  if (!targetDocumentName.ok) errors.push(targetDocumentName.error);
  const layerName = normalizePhotoshopRequiredLayerNameParam(params?.layerName, 'layerName');
  if (!layerName.ok) errors.push(layerName.error);
  const op = String(params?.op ?? '').trim();
  const opValid = (PHOTOSHOP_TRANSFORM_OPS as readonly string[]).includes(op);
  if (!opValid) errors.push('op must be move, scale, or rotate.');
  const deltaX = normalizePhotoshopTranslateDelta(params?.deltaX, 'deltaX');
  if (!deltaX.ok) errors.push(deltaX.error);
  const deltaY = normalizePhotoshopTranslateDelta(params?.deltaY, 'deltaY');
  if (!deltaY.ok) errors.push(deltaY.error);
  const scalePercent = normalizePhotoshopRangeNumber(params?.scalePercent, 'scalePercent', PHOTOSHOP_MIN_SCALE_PERCENT, PHOTOSHOP_MAX_SCALE_PERCENT);
  if (!scalePercent.ok) errors.push(scalePercent.error);
  const rotateDegrees = normalizePhotoshopRangeNumber(params?.rotateDegrees, 'rotateDegrees', -PHOTOSHOP_MAX_ROTATE_DEGREES, PHOTOSHOP_MAX_ROTATE_DEGREES);
  if (!rotateDegrees.ok) errors.push(rotateDegrees.error);
  if (opValid && deltaX.ok && deltaY.ok && scalePercent.ok && rotateDegrees.ok) {
    if (op === 'move' && deltaX.value == null && deltaY.value == null) {
      errors.push('move requires deltaX and/or deltaY.');
    }
    if (op !== 'move' && (deltaX.value != null || deltaY.value != null)) {
      errors.push('deltaX/deltaY are only valid for move.');
    }
    if (op === 'scale' && scalePercent.value == null) errors.push('scale requires scalePercent.');
    if (op !== 'scale' && scalePercent.value != null) errors.push('scalePercent is only valid for scale.');
    if (op === 'rotate' && rotateDegrees.value == null) errors.push('rotate requires rotateDegrees.');
    if (op !== 'rotate' && rotateDegrees.value != null) errors.push('rotateDegrees is only valid for rotate.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Photoshop',
      targetDocumentName: targetDocumentName.ok ? targetDocumentName.value : '',
      layerName: layerName.ok ? layerName.value : '',
      op: op as PhotoshopTransformOp,
      deltaX: deltaX.ok ? deltaX.value : null,
      deltaY: deltaY.ok ? deltaY.value : null,
      scalePercent: scalePercent.ok ? scalePercent.value : null,
      rotateDegrees: rotateDegrees.ok ? rotateDegrees.value : null,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): photoshopTransformLayerJsxBody — keep
 * this JSX body byte-identical with the bridge duplicate. The op branch is
 * resolved at build time; background layers ('background_layer_locked') and
 * locked layers ('layer_locked') fail closed before any mutation.
 */
function photoshopTransformLayerJsxBody(
  { layerName, op, deltaX, deltaY, scalePercent, rotateDegrees }: {
    layerName: string;
    op: PhotoshopTransformOp;
    deltaX: number | null;
    deltaY: number | null;
    scalePercent: number | null;
    rotateDegrees: number | null;
  },
): string {
  const deltaXLiteral = deltaX == null ? 0 : Math.trunc(deltaX);
  const deltaYLiteral = deltaY == null ? 0 : Math.trunc(deltaY);
  const scalePercentLiteral = scalePercent == null ? 100 : Number(scalePercent);
  const rotateDegreesLiteral = rotateDegrees == null ? 0 : Number(rotateDegrees);
  const head = `
  var layerName = ${JSON.stringify(String(layerName ?? ''))};
  var op = ${JSON.stringify(String(op ?? ''))};
  var deltaXParam = ${JSON.stringify(deltaXLiteral)};
  var deltaYParam = ${JSON.stringify(deltaYLiteral)};
  var scalePercentParam = ${JSON.stringify(scalePercentLiteral)};
  var rotateDegreesParam = ${JSON.stringify(rotateDegreesLiteral)};

  function stringifyTransformResult(value) {
    function boundsJson(bounds) {
      if (!bounds) return "null";
      return "{" + [
        "\\"left\\":" + jsonNumber(bounds.left),
        "\\"top\\":" + jsonNumber(bounds.top),
        "\\"right\\":" + jsonNumber(bounds.right),
        "\\"bottom\\":" + jsonNumber(bounds.bottom)
      ].join(",") + "}";
    }
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"layerName\\":" + jsonNullableString(value.layerName),
      "\\"op\\":" + jsonString(value.op),
      "\\"boundsBefore\\":" + boundsJson(value.boundsBefore),
      "\\"boundsAfter\\":" + boundsJson(value.boundsAfter),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }
${photoshopCollectLayersByExactNameJsx()}
  function layerBoundsObject(layer) {
    var bounds = layerBounds(layer);
    if (bounds.length !== 4) return null;
    return { left: bounds[0], top: bounds[1], right: bounds[2], bottom: bounds[3] };
  }

  function isBackgroundLayer(layer) {
    try { return layer.isBackgroundLayer === true; } catch (_) { return false; }
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    documentName: null,
    layerName: layerName,
    op: op,
    boundsBefore: null,
    boundsAfter: null,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyTransformResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyTransformResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");

  var target = findUniqueLayerByExactName(doc, layerName, result, "layer_not_found", "layer_ambiguous");
  if (!target) return stringifyTransformResult(result);
  if (isBackgroundLayer(target)) {
    result.error = "background_layer_locked";
    return stringifyTransformResult(result);
  }
  if (layerLocked(target)) {
    result.error = "layer_locked";
    return stringifyTransformResult(result);
  }
  try { doc.activeLayer = target; } catch (_) {}
  result.boundsBefore = layerBoundsObject(target);
`;
  const foot = `
  result.boundsAfter = layerBoundsObject(target);
  return stringifyTransformResult(result);
`;
  if (op === 'move') {
    return `${head}
  // move: relative pixel translation of the layer; content is not resampled.
  try {
    target.translate(UnitValue(deltaXParam, "px"), UnitValue(deltaYParam, "px"));
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
${foot}`;
  }
  if (op === 'scale') {
    return `${head}
  // scale: uniform percentage resize anchored on the layer center.
  try {
    target.resize(scalePercentParam, scalePercentParam, AnchorPosition.MIDDLECENTER);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
${foot}`;
  }
  return `${head}
  // rotate: rotation anchored on the layer center.
  try {
    target.rotate(rotateDegreesParam, AnchorPosition.MIDDLECENTER);
    result.ok = true;
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
${foot}`;
}

export function buildPhotoshopTransformLayerJsx(params: PhotoshopTransformLayerParams): PhotoshopExtendScriptBuild {
  const validated = validatePhotoshopTransformLayerParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${photoshopExtendScriptJsxPrelude({ expectedDocumentName: normalized.targetDocumentName, sourceDocumentPath: '' })}
${photoshopTransformLayerJsxBody({
    layerName: normalized.layerName,
    op: normalized.op,
    deltaX: normalized.deltaX,
    deltaY: normalized.deltaY,
    scalePercent: normalized.scalePercent,
    rotateDegrees: normalized.rotateDegrees,
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── 6) Convert color mode (rgb / cmyk / grayscale) ─────────────────────────

export type PhotoshopConvertColorModeParams = {
  appName?: string;
  targetDocumentName?: string | null;
  /**
   * Target mode. CMYK/Grayscale conversion discards color data in the UNSAVED
   * working copy — reversible only until save, and these scripts never save.
   */
  mode: PhotoshopColorMode | string;
};

export type NormalizedPhotoshopConvertColorModeParams = {
  appName: string;
  targetDocumentName: string;
  mode: PhotoshopColorMode;
};

export function validatePhotoshopConvertColorModeParams(
  params: PhotoshopConvertColorModeParams,
): { ok: true; params: NormalizedPhotoshopConvertColorModeParams } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const appName = normalizePhotoshopBridgeAppName(params?.appName);
  if (!appName.ok) errors.push(appName.error);
  const targetDocumentName = normalizePhotoshopTargetDocumentName(params?.targetDocumentName);
  if (!targetDocumentName.ok) errors.push(targetDocumentName.error);
  const mode = String(params?.mode ?? '').trim();
  if (!(PHOTOSHOP_COLOR_MODES as readonly string[]).includes(mode)) {
    errors.push('mode must be rgb, cmyk, or grayscale.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    params: {
      appName: appName.ok ? appName.value : 'Photoshop',
      targetDocumentName: targetDocumentName.ok ? targetDocumentName.value : '',
      mode: mode as PhotoshopColorMode,
    },
  };
}

/**
 * LOCKSTEP(scripts/claude-bridge.js): photoshopConvertColorModeJsxBody — keep
 * this JSX body byte-identical with the bridge duplicate. Reports an honest
 * no-op (converted:false, ok:true) when the document is already in the
 * requested mode, and verifies the resulting mode before claiming success.
 */
function photoshopConvertColorModeJsxBody(
  { mode, changeModeConstant }: { mode: PhotoshopColorMode; changeModeConstant: string },
): string {
  return `
  var mode = ${JSON.stringify(String(mode ?? ''))};

  function stringifyConvertResult(value) {
    return "{" + [
      "\\"ok\\":" + jsonBoolean(value.ok),
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"modeBefore\\":" + jsonNullableString(value.modeBefore),
      "\\"modeAfter\\":" + jsonNullableString(value.modeAfter),
      "\\"converted\\":" + jsonBoolean(value.converted),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  function documentModeToken(value) {
    var text = "";
    try { text = String(value.mode || ""); } catch (_) {}
    return text.replace(/^DocumentMode\\./, "").toLowerCase();
  }

  var result = {
    ok: false,
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    documentName: null,
    modeBefore: null,
    modeAfter: null,
    converted: false,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "no_document";
    return stringifyConvertResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "document_mismatch";
    return stringifyConvertResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");
  result.modeBefore = documentModeToken(doc);

  if (result.modeBefore === mode) {
    // Honest no-op: the document is already in the requested mode.
    result.modeAfter = result.modeBefore;
    result.converted = false;
    result.ok = true;
    return stringifyConvertResult(result);
  }

  // changeMode discards color data when narrowing (e.g. to grayscale). The
  // change lives only in the unsaved working copy — this script NEVER saves,
  // so it stays reversible until the separate approval-gated save step.
  var previousDialogs = null;
  try { previousDialogs = app.displayDialogs; app.displayDialogs = DialogModes.NO; } catch (_) {}
  try {
    doc.changeMode(ChangeMode.${changeModeConstant});
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  try { if (previousDialogs !== null) app.displayDialogs = previousDialogs; } catch (_) {}
  result.modeAfter = documentModeToken(doc);
  if (result.error) return stringifyConvertResult(result);
  if (result.modeAfter !== mode) {
    result.error = "mode_not_converted";
    return stringifyConvertResult(result);
  }
  result.converted = true;
  result.ok = true;
  return stringifyConvertResult(result);
`;
}

export function buildPhotoshopConvertColorModeJsx(params: PhotoshopConvertColorModeParams): PhotoshopExtendScriptBuild {
  const validated = validatePhotoshopConvertColorModeParams(params);
  if (!validated.ok) return { jsx: '', errors: validated.errors };
  const normalized = validated.params;
  const jsx = `
(function () {
${photoshopExtendScriptJsxPrelude({ expectedDocumentName: normalized.targetDocumentName, sourceDocumentPath: '' })}
${photoshopConvertColorModeJsxBody({
    mode: normalized.mode,
    changeModeConstant: PHOTOSHOP_COLOR_MODE_CHANGE_MODES[normalized.mode],
  })}
}());
`;
  return { jsx, errors: [] };
}

// ─── Receipt types + guards ─────────────────────────────────────────────────

export type PhotoshopAdjustmentLayerReceipt = {
  ok: boolean;
  appName: string | null;
  documentName: string | null;
  createdLayerName: string | null;
  layerCountBefore: number;
  layerCountAfter: number;
  error: string | null;
};

export type PhotoshopSelectionBoundsPx = { left: number; top: number; right: number; bottom: number };

export type PhotoshopSelectionMaskReceipt = {
  ok: boolean;
  documentName: string | null;
  layerName: string | null;
  mode: PhotoshopSelectionMaskMode;
  selectionBounds: PhotoshopSelectionBoundsPx | null;
  maskApplied: boolean;
  error: string | null;
};

export type PhotoshopResizeReceipt = {
  ok: boolean;
  documentName: string | null;
  op: PhotoshopResizeOp;
  widthPxBefore: number;
  heightPxBefore: number;
  widthPxAfter: number;
  heightPxAfter: number;
  error: string | null;
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPhotoshopSelectionBoundsPx(value: unknown): value is PhotoshopSelectionBoundsPx {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return isFiniteNumber(v.left) && isFiniteNumber(v.top) && isFiniteNumber(v.right) && isFiniteNumber(v.bottom);
}

export function isPhotoshopAdjustmentLayerReceipt(value: unknown): value is PhotoshopAdjustmentLayerReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.appName)
    && isNullableString(v.documentName)
    && isNullableString(v.createdLayerName)
    && isFiniteNumber(v.layerCountBefore)
    && isFiniteNumber(v.layerCountAfter)
    && isNullableString(v.error);
}

export function isPhotoshopSelectionMaskReceipt(value: unknown): value is PhotoshopSelectionMaskReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.documentName)
    && isNullableString(v.layerName)
    && (PHOTOSHOP_SELECTION_MASK_MODES as readonly string[]).includes(String(v.mode))
    && (v.selectionBounds === null || isPhotoshopSelectionBoundsPx(v.selectionBounds))
    && typeof v.maskApplied === 'boolean'
    && isNullableString(v.error);
}

export function isPhotoshopResizeReceipt(value: unknown): value is PhotoshopResizeReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.documentName)
    && (PHOTOSHOP_RESIZE_OPS as readonly string[]).includes(String(v.op))
    && isFiniteNumber(v.widthPxBefore)
    && isFiniteNumber(v.heightPxBefore)
    && isFiniteNumber(v.widthPxAfter)
    && isFiniteNumber(v.heightPxAfter)
    && isNullableString(v.error);
}

export type PhotoshopManageLayersReceipt = {
  ok: boolean;
  documentName: string | null;
  action: PhotoshopManageLayerAction;
  layerName: string | null;
  resultLayerName: string | null;
  layerCountBefore: number;
  layerCountAfter: number;
  layerIndexBefore: number;
  layerIndexAfter: number;
  error: string | null;
};

export function isPhotoshopManageLayersReceipt(value: unknown): value is PhotoshopManageLayersReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.documentName)
    && (PHOTOSHOP_MANAGE_LAYER_ACTIONS as readonly string[]).includes(String(v.action))
    && isNullableString(v.layerName)
    && isNullableString(v.resultLayerName)
    && isFiniteNumber(v.layerCountBefore)
    && isFiniteNumber(v.layerCountAfter)
    && isFiniteNumber(v.layerIndexBefore)
    && isFiniteNumber(v.layerIndexAfter)
    && isNullableString(v.error);
}

export type PhotoshopTransformLayerReceipt = {
  ok: boolean;
  documentName: string | null;
  layerName: string | null;
  op: PhotoshopTransformOp;
  boundsBefore: PhotoshopSelectionBoundsPx | null;
  boundsAfter: PhotoshopSelectionBoundsPx | null;
  error: string | null;
};

export function isPhotoshopTransformLayerReceipt(value: unknown): value is PhotoshopTransformLayerReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.documentName)
    && isNullableString(v.layerName)
    && (PHOTOSHOP_TRANSFORM_OPS as readonly string[]).includes(String(v.op))
    && (v.boundsBefore === null || isPhotoshopSelectionBoundsPx(v.boundsBefore))
    && (v.boundsAfter === null || isPhotoshopSelectionBoundsPx(v.boundsAfter))
    && isNullableString(v.error);
}

export type PhotoshopConvertColorModeReceipt = {
  ok: boolean;
  documentName: string | null;
  /** Normalized DocumentMode token, e.g. 'rgb', 'cmyk', 'grayscale', 'lab'. */
  modeBefore: string | null;
  modeAfter: string | null;
  converted: boolean;
  error: string | null;
};

export function isPhotoshopConvertColorModeReceipt(value: unknown): value is PhotoshopConvertColorModeReceipt {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ok === 'boolean'
    && isNullableString(v.documentName)
    && isNullableString(v.modeBefore)
    && isNullableString(v.modeAfter)
    && typeof v.converted === 'boolean'
    && isNullableString(v.error);
}
