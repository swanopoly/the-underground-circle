/**
 * Smoke: photoshopExtendScriptAdapters — pure JSX builders behind the Mac
 * bridge's photoshop_apply_adjustment_layer / photoshop_apply_selection_or_mask
 * / photoshop_resize_canvas_or_image / photoshop_manage_layers /
 * photoshop_transform_layer / photoshop_convert_color_mode endpoints.
 *
 * claude-bridge.js is a standalone server script (not safely require-able),
 * so this exercises the LOCKSTEP pure module that owns the JSX composition,
 * enum/range validators, and receipt guards.
 *
 * Run: npx tsx scripts/photoshop-extendscript-adapters-smoketest.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PHOTOSHOP_ADJUSTMENT_LAYER_KINDS,
  PHOTOSHOP_ADJUSTMENT_KIND_EVENT_IDS,
  PHOTOSHOP_CANVAS_ANCHORS,
  PHOTOSHOP_MANAGE_LAYER_ACTIONS,
  PHOTOSHOP_MAX_PIXEL_DIMENSION,
  PHOTOSHOP_MAX_TRANSLATE_PX,
  buildPhotoshopApplyAdjustmentLayerJsx,
  buildPhotoshopApplySelectionOrMaskJsx,
  buildPhotoshopResizeCanvasOrImageJsx,
  buildPhotoshopManageLayersJsx,
  buildPhotoshopTransformLayerJsx,
  buildPhotoshopConvertColorModeJsx,
  validatePhotoshopResizeCanvasOrImageParams,
  validatePhotoshopTransformLayerParams,
  isPhotoshopAdjustmentLayerReceipt,
  isPhotoshopSelectionMaskReceipt,
  isPhotoshopResizeReceipt,
  isPhotoshopManageLayersReceipt,
  isPhotoshopTransformLayerReceipt,
  isPhotoshopConvertColorModeReceipt,
  type PhotoshopAdjustmentLayerKind,
} from '../src/lib/photoshopExtendScriptAdapters';

// No built script may ever save the document or destroy pixels. Saving is a
// separate approval-gated step; "remove background" is selection/mask only.
function assertNeverSavesOrDeletes(jsx: string, label: string) {
  assert.equal(/\.save\s*\(/.test(jsx), false, `${label}: jsx must never call doc.save()`);
  assert.equal(/saveAs/i.test(jsx), false, `${label}: jsx must never call saveAs`);
  assert.equal(jsx.includes('stringIDToTypeID("save")'), false, `${label}: jsx must never dispatch a save event`);
  assert.equal(/\.clear\s*\(/.test(jsx), false, `${label}: jsx must never clear pixels`);
  assert.equal(/\.fill\s*\(/.test(jsx), false, `${label}: jsx must never fill pixels`);
  assert.equal(/\.cut\s*\(/.test(jsx), false, `${label}: jsx must never cut pixels`);
  assert.equal(/\bdelete\b/i.test(jsx), false, `${label}: jsx must never delete anything`);
  assert.equal(/flatten|mergeVisible|rasterize/i.test(jsx), false, `${label}: jsx must never flatten/merge/rasterize`);
  if (jsx.includes('executeAction(')) {
    assert.equal(jsx.includes('DialogModes.NO'), true, `${label}: executeAction must suppress dialogs`);
  }
  assert.equal(jsx.includes('DialogModes.ALL'), false, `${label}: jsx must never show dialogs`);
}

// ── 1) apply_adjustment_layer ───────────────────────────────────────────────

const levels = buildPhotoshopApplyAdjustmentLayerJsx({
  appName: 'Adobe Photoshop 2025',
  targetDocumentName: 'hero-banner.psd',
  layerName: 'Hero "Main" Layer',
  kind: 'levels',
});
assert.deepEqual(levels.errors, [], 'levels adjustment builds with no errors');
assert.ok(levels.jsx.length > 0, 'levels adjustment emits jsx');
assert.ok(levels.jsx.includes('stringIDToTypeID("adjustmentLayer")'), 'adjustment layer is created via the adjustmentLayer class');
assert.ok(levels.jsx.includes('executeAction(stringIDToTypeID("make")'), 'adjustment layer uses the make event');
assert.ok(levels.jsx.includes('var kindEventId = "levels";'), 'levels resolves the levels class stringID at build time');
assert.ok(levels.jsx.includes('findTargetDocument()'), 'adjustment jsx reuses the prelude document matcher');
assert.ok(levels.jsx.includes('"document_mismatch"'), 'adjustment jsx fails closed on document mismatch');
assert.ok(
  levels.jsx.includes(`var expectedDocumentName = ${JSON.stringify('hero-banner.psd')};`),
  'expectedDocumentName is embedded via JSON.stringify',
);
assert.ok(levels.jsx.includes(JSON.stringify('Hero "Main" Layer')), 'layerName quotes are escaped via JSON.stringify');
assert.equal(levels.jsx.includes('= "Hero "Main" Layer"'), false, 'raw unescaped layerName never reaches the jsx');
assert.ok(levels.jsx.includes('var preserveExisting = true;'), 'preserveExisting defaults to true');
assert.ok(levels.jsx.includes('"adjustment_layer_not_created"'), 'adjustment jsx verifies the layer-count delta');
assertNeverSavesOrDeletes(levels.jsx, 'apply_adjustment_layer');

for (const kind of PHOTOSHOP_ADJUSTMENT_LAYER_KINDS) {
  const built = buildPhotoshopApplyAdjustmentLayerJsx({ kind });
  assert.deepEqual(built.errors, [], `kind ${kind} builds with no errors`);
  assert.ok(
    built.jsx.includes(`var kindEventId = ${JSON.stringify(PHOTOSHOP_ADJUSTMENT_KIND_EVENT_IDS[kind])};`),
    `kind ${kind} maps to ActionManager stringID ${PHOTOSHOP_ADJUSTMENT_KIND_EVENT_IDS[kind]}`,
  );
}
assert.ok(
  buildPhotoshopApplyAdjustmentLayerJsx({ kind: 'brightness_contrast' }).jsx.includes('"brightnessEvent"'),
  'brightness_contrast uses the brightnessEvent stringID quirk',
);

const badKind = buildPhotoshopApplyAdjustmentLayerJsx({ kind: 'vibrance' });
assert.equal(badKind.jsx, '', 'invalid kind emits no jsx');
assert.ok(badKind.errors.some((e) => e.includes('kind must be one of')), 'invalid kind is rejected');

const badApp = buildPhotoshopApplyAdjustmentLayerJsx({ appName: 'Photoshop; rm -rf /', kind: 'levels' });
assert.equal(badApp.jsx, '', 'shell-metacharacter appName emits no jsx');
assert.ok(badApp.errors.includes('Invalid appName.'), 'appName regex rejects shell metacharacters');

const nulDoc = buildPhotoshopApplyAdjustmentLayerJsx({ targetDocumentName: 'evil\x00.psd', kind: 'levels' });
assert.ok(nulDoc.errors.some((e) => e.includes('targetDocumentName')), 'NUL in targetDocumentName is rejected');

const longDoc = buildPhotoshopApplyAdjustmentLayerJsx({ targetDocumentName: 'a'.repeat(261), kind: 'levels' });
assert.ok(longDoc.errors.some((e) => e.includes('targetDocumentName')), 'overlong targetDocumentName is rejected');

const longLayer = buildPhotoshopApplyAdjustmentLayerJsx({ layerName: 'x'.repeat(161), kind: 'levels' });
assert.ok(longLayer.errors.some((e) => e.includes('layerName')), 'overlong layerName is rejected');

const badPreserve = buildPhotoshopApplyAdjustmentLayerJsx({ kind: 'levels', preserveExisting: 'yes' as unknown as boolean });
assert.ok(badPreserve.errors.includes('preserveExisting must be a boolean.'), 'non-boolean preserveExisting is rejected');

// ── 2) apply_selection_or_mask ──────────────────────────────────────────────

const selectOnly = buildPhotoshopApplySelectionOrMaskJsx({
  targetDocumentName: 'product-shot.psd',
  layerName: 'Product',
  mode: 'select_only',
});
assert.deepEqual(selectOnly.errors, [], 'select_only builds with no errors');
assert.ok(selectOnly.jsx.includes('executeAction(stringIDToTypeID("autoCutout")'), 'select subject runs via the autoCutout event');
assert.ok(
  selectOnly.jsx.includes('putBoolean(stringIDToTypeID("sampleAllLayers"), false)'),
  'select subject samples only the target layer',
);
assert.equal(selectOnly.jsx.includes('revealSelection'), false, 'select_only never emits the mask descriptor');
assert.ok(selectOnly.jsx.includes('"layer_not_found"'), 'missing exact-name layer fails closed');
assert.ok(selectOnly.jsx.includes('"document_mismatch"'), 'selection jsx fails closed on document mismatch');
assert.ok(selectOnly.jsx.includes('"selection_empty"'), 'empty Select Subject result fails closed');
assert.ok(selectOnly.jsx.includes('\\"selectionBounds\\":'), 'receipt reports selection bounds');
assertNeverSavesOrDeletes(selectOnly.jsx, 'apply_selection_or_mask select_only');

const maskLayer = buildPhotoshopApplySelectionOrMaskJsx({ layerName: 'Subject "A"', mode: 'mask_layer' });
assert.deepEqual(maskLayer.errors, [], 'mask_layer builds with no errors');
assert.ok(maskLayer.jsx.includes('stringIDToTypeID("revealSelection")'), 'mask uses make-channel revealSelection');
assert.ok(maskLayer.jsx.includes('stringIDToTypeID("userMaskEnabled")'), 'mask targets the user mask channel');
assert.ok(maskLayer.jsx.includes('layerHasMask(doc.activeLayer)'), 'mask application is verified before ok');
assert.ok(maskLayer.jsx.includes('"mask_not_verified"'), 'unverified mask fails closed');
assert.ok(maskLayer.jsx.includes(JSON.stringify('Subject "A"')), 'mask layerName quotes are escaped');
assertNeverSavesOrDeletes(maskLayer.jsx, 'apply_selection_or_mask mask_layer');

const badMode = buildPhotoshopApplySelectionOrMaskJsx({ mode: 'delete_pixels' });
assert.equal(badMode.jsx, '', 'invalid mode emits no jsx');
assert.ok(badMode.errors.includes('mode must be select_only or mask_layer.'), 'destructive mode is rejected');

// ── 3) resize_canvas_or_image ───────────────────────────────────────────────

const imageResize = buildPhotoshopResizeCanvasOrImageJsx({
  targetDocumentName: 'poster "final".psd',
  op: 'image_resize',
  widthPx: 800,
});
assert.deepEqual(imageResize.errors, [], 'image_resize with width only builds');
assert.ok(imageResize.jsx.includes('doc.resizeImage(UnitValue(targetWidth, "px"), UnitValue(targetHeight, "px"), null, ResampleMethod.BICUBIC)'), 'image resize uses bicubic DOM resize');
assert.ok(imageResize.jsx.includes('var widthPxParam = 800;'), 'width literal is embedded as a validated number');
assert.ok(imageResize.jsx.includes('Math.round(targetWidth * result.heightPxBefore / result.widthPxBefore)'), 'single-dimension resize keeps proportions');
assert.ok(imageResize.jsx.includes(`var expectedDocumentName = ${JSON.stringify('poster "final".psd')};`), 'resize document name quotes are escaped');
assert.ok(imageResize.jsx.includes('"document_mismatch"'), 'resize jsx fails closed on document mismatch');
assertNeverSavesOrDeletes(imageResize.jsx, 'resize image_resize');

const canvasResize = buildPhotoshopResizeCanvasOrImageJsx({ op: 'canvas_resize', widthPx: 1200, heightPx: 628, anchor: 'bottom_right' });
assert.deepEqual(canvasResize.errors, [], 'canvas_resize with anchor builds');
assert.ok(canvasResize.jsx.includes('doc.resizeCanvas(UnitValue(targetWidth, "px"), UnitValue(targetHeight, "px"), anchorPosition)'), 'canvas resize uses the DOM resizeCanvas');
assert.ok(canvasResize.jsx.includes('AnchorPosition.BOTTOMRIGHT'), 'bottom_right maps to AnchorPosition.BOTTOMRIGHT');
assert.equal(canvasResize.jsx.includes('resizeImage'), false, 'canvas_resize never emits the image-resize branch');
assertNeverSavesOrDeletes(canvasResize.jsx, 'resize canvas_resize');

const defaultAnchor = buildPhotoshopResizeCanvasOrImageJsx({ op: 'canvas_resize', widthPx: 500 });
assert.ok(defaultAnchor.jsx.includes('AnchorPosition.MIDDLECENTER'), 'canvas anchor defaults to middle_center');

const crop = buildPhotoshopResizeCanvasOrImageJsx({ op: 'crop_to_selection' });
assert.deepEqual(crop.errors, [], 'crop_to_selection builds with no dims');
assert.ok(crop.jsx.includes('doc.crop(doc.selection.bounds)'), 'crop uses the active selection bounds');
assert.ok(crop.jsx.includes('"no_active_selection"'), 'crop fails closed without an active selection');
assert.equal(crop.jsx.includes('resizeImage'), false, 'crop never emits image resize');
assert.equal(crop.jsx.includes('resizeCanvas'), false, 'crop never emits canvas resize');
assertNeverSavesOrDeletes(crop.jsx, 'resize crop_to_selection');

const badOp = buildPhotoshopResizeCanvasOrImageJsx({ op: 'stretch', widthPx: 100 });
assert.equal(badOp.jsx, '', 'invalid op emits no jsx');
assert.ok(badOp.errors.includes('op must be image_resize, canvas_resize, or crop_to_selection.'), 'invalid op is rejected');

assert.ok(
  buildPhotoshopResizeCanvasOrImageJsx({ op: 'image_resize', widthPx: 0 }).errors.some((e) => e.includes('widthPx')),
  'widthPx 0 is rejected',
);
assert.ok(
  buildPhotoshopResizeCanvasOrImageJsx({ op: 'image_resize', widthPx: PHOTOSHOP_MAX_PIXEL_DIMENSION + 1 }).errors.some((e) => e.includes('widthPx')),
  'widthPx above 30000 is rejected',
);
assert.ok(
  buildPhotoshopResizeCanvasOrImageJsx({ op: 'image_resize', heightPx: 100.5 }).errors.some((e) => e.includes('heightPx')),
  'fractional heightPx is rejected',
);
assert.ok(
  buildPhotoshopResizeCanvasOrImageJsx({ op: 'image_resize', widthPx: '800' as unknown as number }).errors.some((e) => e.includes('widthPx')),
  'numeric-string widthPx is rejected (strict number)',
);
assert.ok(
  buildPhotoshopResizeCanvasOrImageJsx({ op: 'image_resize' }).errors.some((e) => e.includes('requires widthPx and/or heightPx')),
  'image_resize with no dimensions is rejected',
);
assert.ok(
  buildPhotoshopResizeCanvasOrImageJsx({ op: 'crop_to_selection', widthPx: 300 }).errors.some((e) => e.includes('crop_to_selection does not accept')),
  'crop_to_selection rejects dimensions',
);
assert.ok(
  buildPhotoshopResizeCanvasOrImageJsx({ op: 'canvas_resize', widthPx: 500, anchor: 'center' }).errors.some((e) => e.includes('anchor must be one of')),
  'anchor outside the 9-grid enum is rejected',
);
assert.ok(
  buildPhotoshopResizeCanvasOrImageJsx({ op: 'image_resize', widthPx: 500, anchor: 'top_left' }).errors.some((e) => e.includes('anchor is only valid for canvas_resize')),
  'anchor is rejected outside canvas_resize',
);

const maxOk = validatePhotoshopResizeCanvasOrImageParams({ op: 'image_resize', widthPx: PHOTOSHOP_MAX_PIXEL_DIMENSION, heightPx: 1 });
assert.ok(maxOk.ok, 'boundary dimensions 1 and 30000 validate');
assert.equal(PHOTOSHOP_CANVAS_ANCHORS.length, 9, 'canvas anchor enum is the full 9-grid');

// ── 4) manage_layers (rename / duplicate / reorder / group) ─────────────────

// The action enum is organizational ONLY: delete/merge/flatten must not exist
// as actions, and no emitted script may contain a destructive layer call.
assert.deepEqual(
  [...PHOTOSHOP_MANAGE_LAYER_ACTIONS],
  ['rename', 'duplicate', 'reorder', 'group'],
  'manage_layers action enum is exactly rename/duplicate/reorder/group',
);
function assertManageLayersNonDestructive(jsx: string, label: string) {
  assert.equal(
    /deleteLayer|merge|flatten|remove/i.test(jsx),
    false,
    `${label}: emitted jsx must never contain deleteLayer/merge/flatten/remove`,
  );
}

const renameLayer = buildPhotoshopManageLayersJsx({
  appName: 'Adobe Photoshop 2025',
  targetDocumentName: 'brand "kit".psd',
  action: 'rename',
  layerName: 'Old "Hero" Layer',
  newName: 'Hero Final',
});
assert.deepEqual(renameLayer.errors, [], 'rename builds with no errors');
assert.ok(renameLayer.jsx.includes('var action = "rename";'), 'rename embeds the action at build time');
assert.ok(renameLayer.jsx.includes('target.name = newName;'), 'rename sets the DOM layer name');
assert.ok(renameLayer.jsx.includes('"rename_not_applied"'), 'unverified rename fails closed');
assert.ok(renameLayer.jsx.includes(JSON.stringify('Old "Hero" Layer')), 'rename layerName quotes are escaped via JSON.stringify');
assert.ok(renameLayer.jsx.includes('"layer_not_found"'), 'zero exact-name matches fail closed');
assert.ok(renameLayer.jsx.includes('"layer_ambiguous"'), 'multiple exact-name matches fail closed');
assert.ok(
  renameLayer.jsx.includes('findUniqueLayerByExactName(doc, layerName, result, "layer_not_found", "layer_ambiguous")'),
  'manage jsx resolves the target through the unique-match helper',
);
assert.ok(renameLayer.jsx.includes('"document_mismatch"'), 'manage jsx fails closed on document mismatch');
assert.ok(renameLayer.jsx.includes('\\"layerIndexBefore\\":'), 'manage receipt reports layerIndexBefore');
assert.ok(renameLayer.jsx.includes('\\"layerIndexAfter\\":'), 'manage receipt reports layerIndexAfter');
assertNeverSavesOrDeletes(renameLayer.jsx, 'manage_layers rename');
assertManageLayersNonDestructive(renameLayer.jsx, 'manage_layers rename');

const duplicateLayer = buildPhotoshopManageLayersJsx({ action: 'duplicate', layerName: 'Hero', newName: 'Hero Copy' });
assert.deepEqual(duplicateLayer.errors, [], 'duplicate builds with no errors');
assert.ok(duplicateLayer.jsx.includes('resultLayer = target.duplicate();'), 'duplicate uses the DOM duplicate call');
assert.ok(duplicateLayer.jsx.includes('"duplicate_not_created"'), 'duplicate verifies the layer-count delta');
assert.equal(duplicateLayer.jsx.includes('target.name = newName;'), false, 'duplicate never renames the source layer');
assertNeverSavesOrDeletes(duplicateLayer.jsx, 'manage_layers duplicate');
assertManageLayersNonDestructive(duplicateLayer.jsx, 'manage_layers duplicate');

const reorderAbove = buildPhotoshopManageLayersJsx({
  action: 'reorder',
  layerName: 'Hero',
  position: 'above',
  referenceLayerName: 'Background Art',
});
assert.deepEqual(reorderAbove.errors, [], 'reorder above builds with no errors');
assert.ok(reorderAbove.jsx.includes('ElementPlacement.PLACEBEFORE'), 'reorder above maps to PLACEBEFORE');
assert.ok(reorderAbove.jsx.includes('ElementPlacement.PLACEAFTER'), 'reorder below path maps to PLACEAFTER');
assert.ok(reorderAbove.jsx.includes('"reference_layer_not_found"'), 'missing reference layer fails closed');
assert.ok(reorderAbove.jsx.includes('"reference_layer_ambiguous"'), 'ambiguous reference layer fails closed');
assertNeverSavesOrDeletes(reorderAbove.jsx, 'manage_layers reorder above');
assertManageLayersNonDestructive(reorderAbove.jsx, 'manage_layers reorder above');

const reorderTop = buildPhotoshopManageLayersJsx({ action: 'reorder', layerName: 'Hero', position: 'top' });
assert.deepEqual(reorderTop.errors, [], 'reorder top builds with no errors');
assert.ok(reorderTop.jsx.includes('target.move(doc, ElementPlacement.INSIDE);'), 'reorder top moves to the top of the document via INSIDE');
assertNeverSavesOrDeletes(reorderTop.jsx, 'manage_layers reorder top');
assertManageLayersNonDestructive(reorderTop.jsx, 'manage_layers reorder top');

const groupLayer = buildPhotoshopManageLayersJsx({ action: 'group', layerName: 'Hero', newName: 'Hero Group' });
assert.deepEqual(groupLayer.errors, [], 'group builds with no errors');
assert.ok(groupLayer.jsx.includes('doc.layerSets.add()'), 'group creates a new LayerSet');
assert.ok(groupLayer.jsx.includes('target.move(groupSet, ElementPlacement.INSIDE);'), 'group moves the layer inside the new set');
assert.ok(groupLayer.jsx.includes('"group_not_created"'), 'group verifies the layer-count delta');
assertNeverSavesOrDeletes(groupLayer.jsx, 'manage_layers group');
assertManageLayersNonDestructive(groupLayer.jsx, 'manage_layers group');

for (const destructive of ['delete', 'merge', 'flatten']) {
  const rejected = buildPhotoshopManageLayersJsx({ action: destructive, layerName: 'Hero' });
  assert.equal(rejected.jsx, '', `destructive action ${destructive} emits no jsx`);
  assert.ok(
    rejected.errors.some((e) => e.includes('action must be one of rename, duplicate, reorder, group.')),
    `destructive action ${destructive} is rejected`,
  );
}

assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'rename', layerName: '', newName: 'X' }).errors.some((e) => e.includes('layerName is required')),
  'missing layerName is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'rename', layerName: 'evil\x00name', newName: 'X' }).errors.some((e) => e.includes('layerName')),
  'NUL in layerName is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'rename', layerName: 'Hero' }).errors.some((e) => e.includes('rename requires newName.')),
  'rename without newName is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'duplicate', layerName: 'Hero', newName: 'y'.repeat(161) }).errors.some((e) => e.includes('newName')),
  'overlong newName is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'reorder', layerName: 'Hero' }).errors.some((e) => e.includes('reorder requires position')),
  'reorder without position is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'reorder', layerName: 'Hero', position: 'above' }).errors.some((e) => e.includes('position above/below requires referenceLayerName.')),
  'reorder above without referenceLayerName is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'reorder', layerName: 'Hero', position: 'top', referenceLayerName: 'Other' }).errors.some((e) => e.includes('referenceLayerName is only valid for position above or below.')),
  'reorder top with referenceLayerName is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'reorder', layerName: 'Hero', position: 'middle' }).errors.some((e) => e.includes('position must be one of top, bottom, above, below.')),
  'unknown position is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'rename', layerName: 'Hero', newName: 'X', position: 'top' }).errors.some((e) => e.includes('position is only valid for reorder.')),
  'position outside reorder is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'reorder', layerName: 'Hero', position: 'below', referenceLayerName: 'Anchor', newName: 'Nope' }).errors.some((e) => e.includes('newName is only valid for rename, duplicate, or group.')),
  'newName on reorder is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'reorder', layerName: 'Hero', position: 'above', referenceLayerName: 'Hero' }).errors.some((e) => e.includes('referenceLayerName must differ from layerName.')),
  'self-referencing reorder is rejected',
);
assert.ok(
  buildPhotoshopManageLayersJsx({ action: 'group', layerName: 'Hero', referenceLayerName: 'Other' }).errors.some((e) => e.includes('referenceLayerName is only valid for reorder above/below.')),
  'referenceLayerName outside reorder is rejected',
);

// ── 5) transform_layer (move / scale / rotate) ──────────────────────────────

const moveLayer = buildPhotoshopTransformLayerJsx({
  targetDocumentName: 'ad.psd',
  layerName: 'Logo',
  op: 'move',
  deltaX: 120,
  deltaY: -45,
});
assert.deepEqual(moveLayer.errors, [], 'move builds with no errors');
assert.ok(
  moveLayer.jsx.includes('target.translate(UnitValue(deltaXParam, "px"), UnitValue(deltaYParam, "px"))'),
  'move uses the DOM translate with explicit px units',
);
assert.ok(moveLayer.jsx.includes('var deltaXParam = 120;'), 'deltaX literal is embedded as a validated number');
assert.ok(moveLayer.jsx.includes('var deltaYParam = -45;'), 'deltaY literal is embedded as a validated number');
assert.equal(moveLayer.jsx.includes('target.resize('), false, 'move never emits the scale branch');
assert.equal(moveLayer.jsx.includes('target.rotate('), false, 'move never emits the rotate branch');
assert.ok(moveLayer.jsx.includes('"background_layer_locked"'), 'background layers fail closed before any mutation');
assert.ok(moveLayer.jsx.includes('"layer_locked"'), 'locked layers fail closed before any mutation');
assert.ok(moveLayer.jsx.includes('"layer_not_found"'), 'missing transform layer fails closed');
assert.ok(moveLayer.jsx.includes('"layer_ambiguous"'), 'ambiguous transform layer fails closed');
assert.ok(moveLayer.jsx.includes('"document_mismatch"'), 'transform jsx fails closed on document mismatch');
assert.ok(moveLayer.jsx.includes('\\"boundsBefore\\":'), 'transform receipt reports boundsBefore');
assert.ok(moveLayer.jsx.includes('\\"boundsAfter\\":'), 'transform receipt reports boundsAfter');
assertNeverSavesOrDeletes(moveLayer.jsx, 'transform_layer move');

const scaleLayer = buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'scale', scalePercent: 150 });
assert.deepEqual(scaleLayer.errors, [], 'scale builds with no errors');
assert.ok(
  scaleLayer.jsx.includes('target.resize(scalePercentParam, scalePercentParam, AnchorPosition.MIDDLECENTER)'),
  'scale is uniform and anchored on the layer center',
);
assert.ok(scaleLayer.jsx.includes('var scalePercentParam = 150;'), 'scalePercent literal is embedded as a validated number');
assert.equal(scaleLayer.jsx.includes('target.translate('), false, 'scale never emits the move branch');
assert.equal(scaleLayer.jsx.includes('target.rotate('), false, 'scale never emits the rotate branch');
assertNeverSavesOrDeletes(scaleLayer.jsx, 'transform_layer scale');

const rotateLayer = buildPhotoshopTransformLayerJsx({ layerName: 'Logo "v2"', op: 'rotate', rotateDegrees: -22.5 });
assert.deepEqual(rotateLayer.errors, [], 'rotate builds with no errors (fractional degrees allowed)');
assert.ok(
  rotateLayer.jsx.includes('target.rotate(rotateDegreesParam, AnchorPosition.MIDDLECENTER)'),
  'rotate is anchored on the layer center',
);
assert.ok(rotateLayer.jsx.includes('var rotateDegreesParam = -22.5;'), 'rotateDegrees literal is embedded as a validated number');
assert.ok(rotateLayer.jsx.includes(JSON.stringify('Logo "v2"')), 'rotate layerName quotes are escaped');
assert.equal(rotateLayer.jsx.includes('target.translate('), false, 'rotate never emits the move branch');
assert.equal(rotateLayer.jsx.includes('target.resize('), false, 'rotate never emits the scale branch');
assertNeverSavesOrDeletes(rotateLayer.jsx, 'transform_layer rotate');

const badTransformOp = buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'skew', rotateDegrees: 10 });
assert.equal(badTransformOp.jsx, '', 'invalid transform op emits no jsx');
assert.ok(badTransformOp.errors.some((e) => e.includes('op must be move, scale, or rotate.')), 'invalid transform op is rejected');
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: '', op: 'move', deltaX: 5 }).errors.some((e) => e.includes('layerName is required')),
  'transform without layerName is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'move' }).errors.some((e) => e.includes('move requires deltaX and/or deltaY.')),
  'move without deltas is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'move', deltaX: PHOTOSHOP_MAX_TRANSLATE_PX + 1 }).errors.some((e) => e.includes('deltaX')),
  'deltaX above 30000 is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'move', deltaY: -(PHOTOSHOP_MAX_TRANSLATE_PX + 1) }).errors.some((e) => e.includes('deltaY')),
  'deltaY below -30000 is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'move', deltaX: 10.5 }).errors.some((e) => e.includes('deltaX')),
  'fractional deltaX is rejected (integer px only)',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'move', deltaX: '10' as unknown as number }).errors.some((e) => e.includes('deltaX')),
  'numeric-string deltaX is rejected (strict number)',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'scale' }).errors.some((e) => e.includes('scale requires scalePercent.')),
  'scale without scalePercent is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'scale', scalePercent: 0 }).errors.some((e) => e.includes('scalePercent')),
  'scalePercent 0 is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'scale', scalePercent: 1001 }).errors.some((e) => e.includes('scalePercent')),
  'scalePercent above 1000 is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'rotate' }).errors.some((e) => e.includes('rotate requires rotateDegrees.')),
  'rotate without rotateDegrees is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'rotate', rotateDegrees: 361 }).errors.some((e) => e.includes('rotateDegrees')),
  'rotateDegrees above 360 is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'scale', scalePercent: 50, deltaX: 5 }).errors.some((e) => e.includes('deltaX/deltaY are only valid for move.')),
  'deltas outside move are rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'move', deltaX: 5, scalePercent: 50 }).errors.some((e) => e.includes('scalePercent is only valid for scale.')),
  'scalePercent outside scale is rejected',
);
assert.ok(
  buildPhotoshopTransformLayerJsx({ layerName: 'Logo', op: 'move', deltaX: 5, rotateDegrees: 15 }).errors.some((e) => e.includes('rotateDegrees is only valid for rotate.')),
  'rotateDegrees outside rotate is rejected',
);
assert.ok(
  validatePhotoshopTransformLayerParams({ layerName: 'L', op: 'move', deltaX: PHOTOSHOP_MAX_TRANSLATE_PX, deltaY: -PHOTOSHOP_MAX_TRANSLATE_PX }).ok,
  'boundary deltas +/-30000 validate',
);
assert.ok(validatePhotoshopTransformLayerParams({ layerName: 'L', op: 'scale', scalePercent: 1 }).ok, 'scalePercent lower bound 1 validates');
assert.ok(validatePhotoshopTransformLayerParams({ layerName: 'L', op: 'scale', scalePercent: 1000 }).ok, 'scalePercent upper bound 1000 validates');
assert.ok(validatePhotoshopTransformLayerParams({ layerName: 'L', op: 'scale', scalePercent: 12.5 }).ok, 'fractional scalePercent validates');
assert.ok(validatePhotoshopTransformLayerParams({ layerName: 'L', op: 'rotate', rotateDegrees: 360 }).ok, 'rotateDegrees upper bound 360 validates');
assert.ok(validatePhotoshopTransformLayerParams({ layerName: 'L', op: 'rotate', rotateDegrees: -360 }).ok, 'rotateDegrees lower bound -360 validates');

// ── 6) convert_color_mode (rgb / cmyk / grayscale) ──────────────────────────

const toCmyk = buildPhotoshopConvertColorModeJsx({ targetDocumentName: 'print "run".psd', mode: 'cmyk' });
assert.deepEqual(toCmyk.errors, [], 'cmyk conversion builds with no errors');
assert.ok(toCmyk.jsx.includes('doc.changeMode(ChangeMode.CMYK);'), 'cmyk maps to ChangeMode.CMYK');
assert.ok(toCmyk.jsx.includes('if (result.modeBefore === mode) {'), 'already-in-mode documents short-circuit before mutating');
assert.ok(toCmyk.jsx.includes('result.converted = false;'), 'no-op path reports converted:false honestly');
assert.ok(toCmyk.jsx.includes('"mode_not_converted"'), 'unverified conversion fails closed');
assert.ok(toCmyk.jsx.includes('\\"converted\\":'), 'convert receipt reports the converted flag');
assert.ok(toCmyk.jsx.includes('app.displayDialogs = DialogModes.NO'), 'conversion suppresses the discard-color dialog');
assert.ok(toCmyk.jsx.includes('app.displayDialogs = previousDialogs'), 'dialog preference is restored after conversion');
assert.ok(
  toCmyk.jsx.includes('replace(/^DocumentMode\\./, "").toLowerCase()'),
  'DocumentMode tokens are normalized for honest before/after reporting',
);
assert.ok(toCmyk.jsx.includes('"document_mismatch"'), 'convert jsx fails closed on document mismatch');
assert.ok(
  toCmyk.jsx.includes(`var expectedDocumentName = ${JSON.stringify('print "run".psd')};`),
  'convert document name quotes are escaped',
);
assertNeverSavesOrDeletes(toCmyk.jsx, 'convert_color_mode cmyk');

const toGray = buildPhotoshopConvertColorModeJsx({ mode: 'grayscale' });
assert.deepEqual(toGray.errors, [], 'grayscale conversion builds with no errors');
assert.ok(toGray.jsx.includes('doc.changeMode(ChangeMode.GRAYSCALE);'), 'grayscale maps to ChangeMode.GRAYSCALE');
assertNeverSavesOrDeletes(toGray.jsx, 'convert_color_mode grayscale');

const toRgb = buildPhotoshopConvertColorModeJsx({ mode: 'rgb' });
assert.deepEqual(toRgb.errors, [], 'rgb conversion builds with no errors');
assert.ok(toRgb.jsx.includes('doc.changeMode(ChangeMode.RGB);'), 'rgb maps to ChangeMode.RGB');
assertNeverSavesOrDeletes(toRgb.jsx, 'convert_color_mode rgb');

const badColorMode = buildPhotoshopConvertColorModeJsx({ mode: 'lab' });
assert.equal(badColorMode.jsx, '', 'invalid color mode emits no jsx');
assert.ok(badColorMode.errors.includes('mode must be rgb, cmyk, or grayscale.'), 'invalid color mode is rejected');

// ── Receipt guards ──────────────────────────────────────────────────────────

assert.ok(
  isPhotoshopAdjustmentLayerReceipt({
    ok: true,
    appName: 'Adobe Photoshop 2025',
    documentName: 'hero-banner.psd',
    createdLayerName: 'Levels 1',
    layerCountBefore: 7,
    layerCountAfter: 8,
    error: null,
  }),
  'valid adjustment receipt passes the guard',
);
assert.equal(
  isPhotoshopAdjustmentLayerReceipt({ ok: true, appName: null, documentName: null, createdLayerName: null, layerCountBefore: '7', layerCountAfter: 8, error: null }),
  false,
  'string layer count fails the adjustment receipt guard',
);
assert.equal(isPhotoshopAdjustmentLayerReceipt(null), false, 'null fails the adjustment receipt guard');

assert.ok(
  isPhotoshopSelectionMaskReceipt({
    ok: true,
    documentName: 'product-shot.psd',
    layerName: 'Product',
    mode: 'mask_layer',
    selectionBounds: { left: 10, top: 20, right: 300, bottom: 400 },
    maskApplied: true,
    error: null,
  }),
  'valid mask receipt with bounds passes the guard',
);
assert.ok(
  isPhotoshopSelectionMaskReceipt({ ok: false, documentName: null, layerName: null, mode: 'select_only', selectionBounds: null, maskApplied: false, error: 'document_mismatch' }),
  'fail-closed selection receipt with null bounds passes the guard',
);
assert.equal(
  isPhotoshopSelectionMaskReceipt({ ok: true, documentName: null, layerName: null, mode: 'mask_layer', selectionBounds: { left: 1, top: 2, right: 3 }, maskApplied: true, error: null }),
  false,
  'selection receipt with incomplete bounds fails the guard',
);
assert.equal(
  isPhotoshopSelectionMaskReceipt({ ok: true, documentName: null, layerName: null, mode: 'delete_pixels', selectionBounds: null, maskApplied: false, error: null }),
  false,
  'selection receipt with unknown mode fails the guard',
);

assert.ok(
  isPhotoshopResizeReceipt({
    ok: true,
    documentName: 'poster.psd',
    op: 'image_resize',
    widthPxBefore: 3000,
    heightPxBefore: 2000,
    widthPxAfter: 800,
    heightPxAfter: 533,
    error: null,
  }),
  'valid resize receipt passes the guard',
);
assert.equal(
  isPhotoshopResizeReceipt({ ok: true, documentName: null, op: 'stretch', widthPxBefore: 0, heightPxBefore: 0, widthPxAfter: 0, heightPxAfter: 0, error: null }),
  false,
  'resize receipt with unknown op fails the guard',
);

assert.ok(
  isPhotoshopManageLayersReceipt({
    ok: true,
    documentName: 'brand.psd',
    action: 'duplicate',
    layerName: 'Hero',
    resultLayerName: 'Hero Copy',
    layerCountBefore: 5,
    layerCountAfter: 6,
    layerIndexBefore: 3,
    layerIndexAfter: 4,
    error: null,
  }),
  'valid manage receipt passes the guard',
);
assert.equal(
  isPhotoshopManageLayersReceipt({ ok: true, documentName: null, action: 'delete', layerName: null, resultLayerName: null, layerCountBefore: 0, layerCountAfter: 0, layerIndexBefore: 0, layerIndexAfter: 0, error: null }),
  false,
  'manage receipt with a destructive action fails the guard',
);
assert.equal(
  isPhotoshopManageLayersReceipt({ ok: true, documentName: null, action: 'rename', layerName: null, resultLayerName: null, layerCountBefore: '1', layerCountAfter: 1, layerIndexBefore: 0, layerIndexAfter: 0, error: null }),
  false,
  'string layer count fails the manage receipt guard',
);
assert.equal(isPhotoshopManageLayersReceipt(null), false, 'null fails the manage receipt guard');

assert.ok(
  isPhotoshopTransformLayerReceipt({
    ok: true,
    documentName: 'ad.psd',
    layerName: 'Logo',
    op: 'move',
    boundsBefore: { left: 0, top: 0, right: 100, bottom: 50 },
    boundsAfter: { left: 120, top: -45, right: 220, bottom: 5 },
    error: null,
  }),
  'valid transform receipt passes the guard',
);
assert.ok(
  isPhotoshopTransformLayerReceipt({ ok: false, documentName: null, layerName: null, op: 'rotate', boundsBefore: null, boundsAfter: null, error: 'background_layer_locked' }),
  'fail-closed transform receipt with null bounds passes the guard',
);
assert.equal(
  isPhotoshopTransformLayerReceipt({ ok: true, documentName: null, layerName: null, op: 'move', boundsBefore: { left: 1, top: 2, right: 3 }, boundsAfter: null, error: null }),
  false,
  'transform receipt with incomplete bounds fails the guard',
);
assert.equal(
  isPhotoshopTransformLayerReceipt({ ok: true, documentName: null, layerName: null, op: 'skew', boundsBefore: null, boundsAfter: null, error: null }),
  false,
  'transform receipt with unknown op fails the guard',
);

assert.ok(
  isPhotoshopConvertColorModeReceipt({ ok: true, documentName: 'print.psd', modeBefore: 'rgb', modeAfter: 'cmyk', converted: true, error: null }),
  'valid convert receipt passes the guard',
);
assert.ok(
  isPhotoshopConvertColorModeReceipt({ ok: true, documentName: 'print.psd', modeBefore: 'cmyk', modeAfter: 'cmyk', converted: false, error: null }),
  'honest no-op convert receipt passes the guard',
);
assert.equal(
  isPhotoshopConvertColorModeReceipt({ ok: true, documentName: null, modeBefore: 'rgb', modeAfter: 'cmyk', converted: 'yes', error: null }),
  false,
  'non-boolean converted fails the convert receipt guard',
);

// Every valid build returns a single IIFE that emits one JSON result line.
for (const [label, jsx] of [
  ['adjustment', levels.jsx],
  ['selection', selectOnly.jsx],
  ['mask', maskLayer.jsx],
  ['resize', imageResize.jsx],
  ['crop', crop.jsx],
  ['manage rename', renameLayer.jsx],
  ['manage group', groupLayer.jsx],
  ['transform move', moveLayer.jsx],
  ['convert cmyk', toCmyk.jsx],
] as Array<[string, string]>) {
  assert.ok(jsx.includes('(function () {'), `${label} jsx is an IIFE`);
  assert.ok(jsx.includes('}());'), `${label} jsx closes its IIFE`);
}

const kindSpot: PhotoshopAdjustmentLayerKind = 'hue_saturation';
assert.ok(
  buildPhotoshopApplyAdjustmentLayerJsx({ kind: kindSpot }).jsx.includes('"hueSaturation"'),
  'hue_saturation maps to hueSaturation',
);

// ── LOCKSTEP drift check against scripts/claude-bridge.js ──────────────────
//
// The bridge cannot import this pure module, so it carries duplicated copies
// of the prelude and the three JSX bodies. Extract those top-level functions
// from the bridge source and assert they compose byte-identical jsx.

const bridgeSource = readFileSync(path.resolve(process.cwd(), 'scripts/claude-bridge.js'), 'utf8');

function extractBridgeTopLevel(name: string, opener: 'function' | 'const'): string {
  const startToken = opener === 'function' ? `\nfunction ${name}(` : `\nconst ${name} = {`;
  const startIdx = bridgeSource.indexOf(startToken);
  assert.ok(startIdx >= 0, `bridge defines ${name}`);
  // Walk to the first column-0 close brace that is outside every template
  // literal (the jsx templates themselves never contain backticks).
  const lines = bridgeSource.slice(startIdx + 1).split('\n');
  let backticks = 0;
  const out: string[] = [];
  let terminated = false;
  for (const line of lines) {
    out.push(line);
    backticks += (line.match(/`/g) || []).length;
    if (backticks % 2 === 0 && (line === '}' || line === '};')) { terminated = true; break; }
  }
  assert.ok(terminated, `bridge ${name} terminates`);
  return out.join('\n');
}

type BridgeJsxFns = {
  photoshopJsxPrelude: (args: { expectedDocumentName: string; sourceDocumentPath: string }) => string;
  photoshopApplyAdjustmentLayerJsxBody: (args: { layerName: string; kind: string; kindEventId: string; preserveExisting: boolean }) => string;
  photoshopApplySelectionOrMaskJsxBody: (args: { layerName: string; mode: string }) => string;
  photoshopResizeCanvasOrImageJsxBody: (args: { op: string; widthPx: number | null; heightPx: number | null; anchor: string }) => string;
  photoshopManageLayersJsxBody: (args: { action: string; layerName: string; newName: string; position: string; referenceLayerName: string }) => string;
  photoshopTransformLayerJsxBody: (args: { layerName: string; op: string; deltaX: number | null; deltaY: number | null; scalePercent: number | null; rotateDegrees: number | null }) => string;
  photoshopConvertColorModeJsxBody: (args: { mode: string; changeModeConstant: string }) => string;
};

const bridgeFns = new Function(`
${extractBridgeTopLevel('PHOTOSHOP_CANVAS_ANCHOR_POSITIONS', 'const')}
${extractBridgeTopLevel('photoshopJsxPrelude', 'function')}
${extractBridgeTopLevel('photoshopFindLayerByExactNameJsx', 'function')}
${extractBridgeTopLevel('photoshopApplyAdjustmentLayerJsxBody', 'function')}
${extractBridgeTopLevel('photoshopApplySelectionOrMaskJsxBody', 'function')}
${extractBridgeTopLevel('photoshopResizeCanvasOrImageJsxBody', 'function')}
${extractBridgeTopLevel('photoshopCollectLayersByExactNameJsx', 'function')}
${extractBridgeTopLevel('photoshopManageLayersJsxBody', 'function')}
${extractBridgeTopLevel('photoshopTransformLayerJsxBody', 'function')}
${extractBridgeTopLevel('photoshopConvertColorModeJsxBody', 'function')}
return { photoshopJsxPrelude, photoshopApplyAdjustmentLayerJsxBody, photoshopApplySelectionOrMaskJsxBody, photoshopResizeCanvasOrImageJsxBody, photoshopManageLayersJsxBody, photoshopTransformLayerJsxBody, photoshopConvertColorModeJsxBody };
`)() as BridgeJsxFns;

function composeBridgeJsx(targetDocumentName: string, body: string): string {
  return `
(function () {
${bridgeFns.photoshopJsxPrelude({ expectedDocumentName: targetDocumentName, sourceDocumentPath: '' })}
${body}
}());
`;
}

assert.equal(
  composeBridgeJsx('hero-banner.psd', bridgeFns.photoshopApplyAdjustmentLayerJsxBody({
    layerName: 'Hero "Main" Layer', kind: 'levels', kindEventId: 'levels', preserveExisting: true,
  })),
  levels.jsx,
  'LOCKSTEP: bridge adjustment-layer jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopApplySelectionOrMaskJsxBody({ layerName: 'Subject "A"', mode: 'mask_layer' })),
  maskLayer.jsx,
  'LOCKSTEP: bridge selection/mask jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopResizeCanvasOrImageJsxBody({ op: 'canvas_resize', widthPx: 1200, heightPx: 628, anchor: 'bottom_right' })),
  canvasResize.jsx,
  'LOCKSTEP: bridge canvas-resize jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopResizeCanvasOrImageJsxBody({ op: 'crop_to_selection', widthPx: null, heightPx: null, anchor: 'middle_center' })),
  crop.jsx,
  'LOCKSTEP: bridge crop jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('brand "kit".psd', bridgeFns.photoshopManageLayersJsxBody({
    action: 'rename', layerName: 'Old "Hero" Layer', newName: 'Hero Final', position: '', referenceLayerName: '',
  })),
  renameLayer.jsx,
  'LOCKSTEP: bridge manage-layers rename jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopManageLayersJsxBody({ action: 'duplicate', layerName: 'Hero', newName: 'Hero Copy', position: '', referenceLayerName: '' })),
  duplicateLayer.jsx,
  'LOCKSTEP: bridge manage-layers duplicate jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopManageLayersJsxBody({ action: 'reorder', layerName: 'Hero', newName: '', position: 'above', referenceLayerName: 'Background Art' })),
  reorderAbove.jsx,
  'LOCKSTEP: bridge manage-layers reorder jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopManageLayersJsxBody({ action: 'group', layerName: 'Hero', newName: 'Hero Group', position: '', referenceLayerName: '' })),
  groupLayer.jsx,
  'LOCKSTEP: bridge manage-layers group jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('ad.psd', bridgeFns.photoshopTransformLayerJsxBody({ layerName: 'Logo', op: 'move', deltaX: 120, deltaY: -45, scalePercent: null, rotateDegrees: null })),
  moveLayer.jsx,
  'LOCKSTEP: bridge transform move jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopTransformLayerJsxBody({ layerName: 'Logo', op: 'scale', deltaX: null, deltaY: null, scalePercent: 150, rotateDegrees: null })),
  scaleLayer.jsx,
  'LOCKSTEP: bridge transform scale jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopTransformLayerJsxBody({ layerName: 'Logo "v2"', op: 'rotate', deltaX: null, deltaY: null, scalePercent: null, rotateDegrees: -22.5 })),
  rotateLayer.jsx,
  'LOCKSTEP: bridge transform rotate jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('print "run".psd', bridgeFns.photoshopConvertColorModeJsxBody({ mode: 'cmyk', changeModeConstant: 'CMYK' })),
  toCmyk.jsx,
  'LOCKSTEP: bridge convert cmyk jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.photoshopConvertColorModeJsxBody({ mode: 'grayscale', changeModeConstant: 'GRAYSCALE' })),
  toGray.jsx,
  'LOCKSTEP: bridge convert grayscale jsx is byte-identical with the pure module',
);

console.log('All Photoshop ExtendScript adapter smoke cases passed.');
