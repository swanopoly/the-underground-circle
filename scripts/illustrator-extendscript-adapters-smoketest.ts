/**
 * Smoke: illustratorExtendScriptAdapters — pure JSX builders behind the Mac
 * bridge's illustrator_document_status / illustrator_export_proof endpoints.
 *
 * claude-bridge.js is a standalone server script (not safely require-able),
 * so this exercises the LOCKSTEP pure module that owns the JSX composition,
 * enum/range validators, and receipt guards — plus a byte-identity extraction
 * check against the bridge's duplicated prelude/bodies.
 *
 * Run: npx tsx scripts/illustrator-extendscript-adapters-smoketest.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ILLUSTRATOR_EXPORT_PROOF_FORMATS,
  ILLUSTRATOR_MAX_SCALE_PERCENT,
  ILLUSTRATOR_MIN_SCALE_PERCENT,
  ILLUSTRATOR_MAX_STATUS_DOCUMENTS,
  ILLUSTRATOR_TRACING_MODES,
  ILLUSTRATOR_MIN_TRACE_COLORS,
  ILLUSTRATOR_MAX_TRACE_COLORS,
  ILLUSTRATOR_MIN_TRACE_THRESHOLD,
  ILLUSTRATOR_MAX_TRACE_THRESHOLD,
  ILLUSTRATOR_TRACE_IMAGE_EXTENSIONS,
  ILLUSTRATOR_ARRANGE_DIRECTIONS,
  ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS,
  ILLUSTRATOR_ADD_TEXT_MAX_SIZE_PT,
  ILLUSTRATOR_ADD_SHAPE_KINDS,
  ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT,
  ILLUSTRATOR_ADD_SHAPE_MAX_STROKE_WIDTH_PT,
  ILLUSTRATOR_SET_APPEARANCE_MAX_STROKE_WIDTH_PT,
  ILLUSTRATOR_SET_APPEARANCE_MAX_SWATCH_NAME,
  buildIllustratorDocumentStatusJsx,
  buildIllustratorExportProofJsx,
  buildIllustratorVectorizeJsx,
  buildIllustratorArrangeJsx,
  buildIllustratorAddTextJsx,
  buildIllustratorAddShapeJsx,
  buildIllustratorSetAppearanceJsx,
  isIllustratorDocumentStatusReceipt,
  isIllustratorExportProofReceipt,
  isIllustratorVectorizeReceipt,
  isIllustratorArrangeReceipt,
  isIllustratorAddTextReceipt,
  isIllustratorAddShapeReceipt,
  isIllustratorSetAppearanceReceipt,
  validateIllustratorExportProofParams,
  validateIllustratorAddTextParams,
  validateIllustratorAddShapeParams,
  validateIllustratorSetAppearanceParams,
} from '../src/lib/illustratorExtendScriptAdapters';

// The core Illustrator safety contract: NO built script may ever write the
// SOURCE document. Exporting goes to the outputPath only; PDF is excluded
// because Illustrator can only produce it via a source-document save-as.
function assertNeverTouchesSource(jsx: string, label: string) {
  assert.equal(/\.save\s*\(/.test(jsx), false, `${label}: jsx must never call doc.save()`);
  assert.equal(/saveAs/i.test(jsx), false, `${label}: jsx must never call saveAs (the PDF save-as path is excluded by design)`);
  assert.equal(/PDFSaveOptions/i.test(jsx), false, `${label}: jsx must never construct PDFSaveOptions`);
  assert.equal(/\.close\s*\(/.test(jsx), false, `${label}: jsx must never close the document`);
  assert.equal(/\bexecuteAction\b/.test(jsx), false, `${label}: jsx stays on the typed DOM (no raw action dispatch)`);
}

// Vectorize has a DIFFERENT — but equally strict — source-safety contract than
// status/export: it legitimately CREATES its own throwaway document and closes
// it. It must still never save/saveAs/PDFSaveOptions/executeAction anything, and
// the ONLY `.close(` it performs must be the scoped
// `tempDoc.close(SaveOptions.DONOTSAVECHANGES)` on the doc it created — so the
// user's open document is never saved, exported from, or closed.
function assertVectorizeSafety(jsx: string, label: string) {
  assert.equal(/\.save\s*\(/.test(jsx), false, `${label}: vectorize jsx must never call .save( (incl. doc.save()/saveAs save path)`);
  assert.equal(/saveAs/i.test(jsx), false, `${label}: vectorize jsx must never call saveAs`);
  assert.equal(/PDFSaveOptions/i.test(jsx), false, `${label}: vectorize jsx must never construct PDFSaveOptions`);
  assert.equal(/\bexecuteAction\b/.test(jsx), false, `${label}: vectorize jsx stays on the typed DOM (no raw action dispatch)`);
  assert.ok(/app\.documents\.add\s*\(/.test(jsx), `${label}: vectorize traces in its OWN document (app.documents.add())`);
  const closeCalls = jsx.match(/\.close\s*\(/g) || [];
  assert.equal(closeCalls.length, 1, `${label}: vectorize closes exactly one document (the throwaway it created)`);
  assert.ok(
    /tempDoc\.close\(SaveOptions\.DONOTSAVECHANGES\)/.test(jsx),
    `${label}: the only close is the scoped tempDoc.close(SaveOptions.DONOTSAVECHANGES)`,
  );
}

// ── 1) illustrator_document_status (READ-ONLY) ──────────────────────────────

const status = buildIllustratorDocumentStatusJsx({
  appName: 'Adobe Illustrator 2025',
  expectedDocumentName: 'brand "kit".ai',
});
assert.deepEqual(status.errors, [], 'document status builds with no errors');
assert.ok(status.jsx.length > 0, 'document status emits jsx');
assert.ok(status.jsx.includes('(function () {'), 'status jsx is an IIFE');
assert.ok(status.jsx.includes('}());'), 'status jsx closes its IIFE');
assert.ok(
  status.jsx.includes(`var expectedDocumentName = ${JSON.stringify('brand "kit".ai')};`),
  'expectedDocumentName is embedded via JSON.stringify (quotes escaped)',
);
assert.equal(status.jsx.includes('= "brand "kit".ai"'), false, 'raw unescaped document name never reaches the jsx');
assert.ok(status.jsx.includes('Math.min(collectionLength(app.documents), 12)'), 'document summaries are bounded to 12');
assert.ok(status.jsx.includes('Number(rect[2]) - Number(rect[0])'), 'widthPt comes from artboard 0 rect (right - left)');
assert.ok(status.jsx.includes('Number(rect[1]) - Number(rect[3])'), 'heightPt comes from artboard 0 rect (top - bottom, y-up)');
assert.ok(status.jsx.includes('"document_mismatch"'), 'status reports document_mismatch when the expected doc is missing');
assert.ok(status.jsx.includes('"no_document"'), 'status reports no_document when nothing is open');
assert.ok(status.jsx.includes('\\"artboardCount\\":'), 'receipt reports artboardCount');
assert.ok(status.jsx.includes('\\"layerCount\\":'), 'receipt reports layerCount');
assert.ok(status.jsx.includes('\\"selectionCount\\":'), 'receipt reports selectionCount');
assert.ok(status.jsx.includes('\\"documents\\":'), 'receipt reports the documents array');
assert.equal(status.jsx.includes('app.activeDocument ='), false, 'READ-ONLY: status never assigns app.activeDocument');
assert.equal(status.jsx.includes('exportFile'), false, 'READ-ONLY: status never exports');
assertNeverTouchesSource(status.jsx, 'document_status');

const badApp = buildIllustratorDocumentStatusJsx({ appName: 'Illustrator; rm -rf /' });
assert.equal(badApp.jsx, '', 'shell-metacharacter appName emits no jsx');
assert.ok(badApp.errors.includes('Invalid appName.'), 'appName regex rejects shell metacharacters');

const nulDoc = buildIllustratorDocumentStatusJsx({ expectedDocumentName: 'evil\x00.ai' });
assert.ok(nulDoc.errors.some((e) => e.includes('expectedDocumentName')), 'NUL in expectedDocumentName is rejected');

const longDoc = buildIllustratorDocumentStatusJsx({ expectedDocumentName: 'a'.repeat(261) });
assert.ok(longDoc.errors.some((e) => e.includes('expectedDocumentName')), 'overlong expectedDocumentName is rejected');

// ── 2) illustrator_export_proof ─────────────────────────────────────────────

const quotedOutputPath = '/Users/demo/Desk "proofs"/hero art.png';
const pngExport = buildIllustratorExportProofJsx({
  appName: 'Adobe Illustrator',
  outputPath: quotedOutputPath,
  format: 'png',
  scalePercent: 200,
  expectedDocumentName: 'hero-art.ai',
});
assert.deepEqual(pngExport.errors, [], 'png export builds with no errors');
assert.ok(pngExport.jsx.includes('new ExportOptionsPNG24()'), 'png export uses ExportOptionsPNG24');
assert.ok(pngExport.jsx.includes('ExportType.PNG24'), 'png export uses ExportType.PNG24');
assert.ok(pngExport.jsx.includes('pngOptions.horizontalScale = 200;'), 'scalePercent lands on horizontalScale');
assert.ok(pngExport.jsx.includes('pngOptions.verticalScale = 200;'), 'scalePercent lands on verticalScale');
assert.ok(pngExport.jsx.includes('pngOptions.artBoardClipping = true;'), 'png export clips to the artboard');
assert.ok(pngExport.jsx.includes(`var outputPath = ${JSON.stringify(quotedOutputPath)};`), 'outputPath quotes are escaped via JSON.stringify');
assert.equal(pngExport.jsx.includes(`= "${quotedOutputPath}"`), false, 'raw unescaped outputPath never reaches the jsx');
assert.ok(pngExport.jsx.includes('"document_mismatch"'), 'export fails closed on document mismatch');
assert.ok(pngExport.jsx.includes('"no_document"'), 'export fails closed with no document');
assert.ok(pngExport.jsx.includes(`var expectedDocumentName = ${JSON.stringify('hero-art.ai')};`), 'export guard carries the expected document name');
assert.ok(pngExport.jsx.includes('doc.exportFile(outFile, ExportType.PNG24, pngOptions)'), 'the ONLY write is doc.exportFile to the output file');
assert.ok(pngExport.jsx.includes('\\"docSaved\\":'), 'export receipt echoes the source docSaved flag (source untouched evidence)');
assertNeverTouchesSource(pngExport.jsx, 'export_proof png');

const svgExport = buildIllustratorExportProofJsx({ outputPath: '/Users/demo/Desktop/logo.svg' });
assert.deepEqual(svgExport.errors, [], 'svg export builds with format defaulted from the extension');
assert.ok(svgExport.jsx.includes('new ExportOptionsSVG()'), 'svg export uses ExportOptionsSVG');
assert.ok(svgExport.jsx.includes('ExportType.SVG'), 'svg export uses ExportType.SVG');
assert.equal(svgExport.jsx.includes('PNG24'), false, 'svg export never emits the png branch');
assert.ok(svgExport.jsx.includes('scalePercent: null,'), 'svg export reports scalePercent null');
assert.ok(svgExport.jsx.includes('var format = "svg";'), 'svg format resolved at build time');
assertNeverTouchesSource(svgExport.jsx, 'export_proof svg');

const defaultScale = buildIllustratorExportProofJsx({ outputPath: '/tmp/proof.png' });
assert.deepEqual(defaultScale.errors, [], 'png export builds without explicit format/scale');
assert.ok(defaultScale.jsx.includes('pngOptions.horizontalScale = 100;'), 'scalePercent defaults to 100 for png');

const pdfPath = buildIllustratorExportProofJsx({ outputPath: '/tmp/proof.pdf' });
assert.equal(pdfPath.jsx, '', 'pdf outputPath emits no jsx');
assert.ok(
  pdfPath.errors.some((e) => /re-associating\/saving the source document/.test(e)),
  'pdf rejection explains the save/re-association reason (excluded by design, not omission)',
);

const pdfFormat = buildIllustratorExportProofJsx({ outputPath: '/tmp/proof.png', format: 'pdf' });
assert.ok(pdfFormat.errors.some((e) => e.includes('format must be png or svg')), 'format pdf is rejected');

const mismatch = buildIllustratorExportProofJsx({ outputPath: '/tmp/proof.svg', format: 'png' });
assert.ok(mismatch.errors.some((e) => e.includes('outputPath extension must match format')), 'format/extension mismatch is rejected');

assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/p.png', scalePercent: ILLUSTRATOR_MIN_SCALE_PERCENT - 1 }).errors.some((e) => e.includes('scalePercent')),
  'scalePercent below 50 is rejected',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/p.png', scalePercent: ILLUSTRATOR_MAX_SCALE_PERCENT + 1 }).errors.some((e) => e.includes('scalePercent')),
  'scalePercent above 400 is rejected',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/p.png', scalePercent: 150.5 }).errors.some((e) => e.includes('scalePercent')),
  'fractional scalePercent is rejected',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/p.png', scalePercent: '200' as unknown as number }).errors.some((e) => e.includes('scalePercent')),
  'numeric-string scalePercent is rejected (strict number)',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/p.svg', scalePercent: 200 }).errors.some((e) => e.includes('only valid for png')),
  'scalePercent on svg is rejected',
);
const boundaryScale = validateIllustratorExportProofParams({ outputPath: '/tmp/p.png', scalePercent: ILLUSTRATOR_MAX_SCALE_PERCENT });
assert.ok(boundaryScale.ok, 'boundary scalePercent 400 validates');
const boundaryScaleLow = validateIllustratorExportProofParams({ outputPath: '/tmp/p.png', scalePercent: ILLUSTRATOR_MIN_SCALE_PERCENT });
assert.ok(boundaryScaleLow.ok, 'boundary scalePercent 50 validates');

// outputPath validation (pure mirror of validateDesktopPathServer + extension)
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/a`b.png' }).errors.some((e) => e.includes('shell metacharacter')),
  'backtick in outputPath is rejected',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/a;b.png' }).errors.some((e) => e.includes('shell metacharacter')),
  'semicolon in outputPath is rejected',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/a\x1fb.png' }).errors.some((e) => e.includes('control characters')),
  'control chars in outputPath are rejected',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: `/tmp/${'a'.repeat(1030)}.png` }).errors.some((e) => e.includes('1024')),
  'overlong outputPath is rejected',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '/tmp/proof.jpg' }).errors.some((e) => e.includes('.png or .svg')),
  'non-png/svg extension is rejected',
);
assert.ok(
  buildIllustratorExportProofJsx({ outputPath: '' }).errors.some((e) => e.includes('outputPath')),
  'empty outputPath is rejected',
);

// ── 3) illustrator_vectorize (Image Trace → expand → SVG) ───────────────────

assert.equal(ILLUSTRATOR_TRACING_MODES.length, 3, 'tracing modes are exactly color|gray|blackwhite');
assert.ok((ILLUSTRATOR_TRACE_IMAGE_EXTENSIONS as readonly string[]).includes('png'), 'png is a traceable raster extension');

// Provided imagePath + preset (bw-logo → blackwhite, threshold 128).
const quotedImagePath = '/Users/demo/Desk "shots"/logo art.png';
const bwVectorize = buildIllustratorVectorizeJsx({
  appName: 'Adobe Illustrator',
  imagePath: quotedImagePath,
  outputPath: '/Users/demo/Desktop/logo.svg',
  preset: 'bw-logo',
});
assert.deepEqual(bwVectorize.errors, [], 'bw-logo vectorize builds with no errors');
assert.ok(bwVectorize.jsx.includes('(function () {'), 'vectorize jsx is an IIFE');
assert.ok(bwVectorize.jsx.includes('}());'), 'vectorize jsx closes its IIFE');
assert.ok(bwVectorize.jsx.includes(`var imagePath = ${JSON.stringify(quotedImagePath)};`), 'imagePath quotes are escaped via JSON.stringify');
assert.equal(bwVectorize.jsx.includes(`= "${quotedImagePath}"`), false, 'raw unescaped imagePath never reaches the jsx');
assert.ok(bwVectorize.jsx.includes('TracingModeType.TRACINGMODEBLACKANDWHITE'), 'bw-logo preset resolves to the blackwhite tracing enum');
assert.ok(bwVectorize.jsx.includes('mode: "blackwhite",'), 'bw-logo preset reports blackwhite mode');
assert.ok(bwVectorize.jsx.includes('threshold: 128,'), 'bw-logo preset resolves threshold 128');
assert.ok(bwVectorize.jsx.includes('expandTracing()'), 'vectorize expands the tracing to real vector paths');
assert.ok(bwVectorize.jsx.includes('ExportType.SVG'), 'vectorize exports SVG');
assert.ok(bwVectorize.jsx.includes(`var expectedDocumentName = ${JSON.stringify('')};`), 'vectorize composes the prelude with an EMPTY document guard (throwaway doc)');
assertVectorizeSafety(bwVectorize.jsx, 'vectorize bw-logo');

// Omitted imagePath → traces the front document's placed image (var imagePath = null;).
const activeDocVectorize = buildIllustratorVectorizeJsx({
  outputPath: '/tmp/trace.svg',
  mode: 'color',
  maxColors: 12,
});
assert.deepEqual(activeDocVectorize.errors, [], 'active-document vectorize builds with no errors');
assert.ok(activeDocVectorize.jsx.includes('var imagePath = null;'), 'omitted imagePath emits var imagePath = null; (trace the front document image)');
assert.ok(activeDocVectorize.jsx.includes('firstPlacedImagePath()'), 'active-document vectorize resolves the front placed/linked image path');
assert.ok(activeDocVectorize.jsx.includes('TracingModeType.TRACINGMODECOLOR'), 'explicit color mode resolves to the color tracing enum');
assert.ok(activeDocVectorize.jsx.includes('mode: "color",'), 'color mode reported in the receipt');
assert.ok(activeDocVectorize.jsx.includes('maxColors: 12,'), 'explicit maxColors lands in the receipt');
assert.ok(activeDocVectorize.jsx.includes('"no_source_image"'), 'active-document vectorize fails closed when no placed image exists');
assertVectorizeSafety(activeDocVectorize.jsx, 'vectorize active-document');

// Explicit params override the preset.
const overrideVectorize = buildIllustratorVectorizeJsx({ outputPath: '/tmp/o.svg', preset: '6-colors', maxColors: 24 });
assert.deepEqual(overrideVectorize.errors, [], '6-colors preset + explicit maxColors builds with no errors');
assert.ok(overrideVectorize.jsx.includes('mode: "color",'), '6-colors preset resolves to color mode');
assert.ok(overrideVectorize.jsx.includes('maxColors: 24,'), 'explicit maxColors overrides the preset value');

// Rejections (fail closed, no jsx).
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.png' }).errors.some((e) => e.includes('.svg')),
  'non-.svg vectorize output is rejected',
);
assert.equal(buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.png' }).jsx, '', 'rejected vectorize emits no jsx');
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.svg', preset: 'watercolor' }).errors.some((e) => e.includes('preset must be one of')),
  'unknown preset is rejected',
);
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.svg', imagePath: '/tmp/art.svg' }).errors.some((e) => e.includes('raster image')),
  'non-raster imagePath extension is rejected',
);
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.svg', imagePath: '/tmp/a;b.png' }).errors.some((e) => e.includes('shell metacharacter')),
  'shell-metacharacter imagePath is rejected',
);
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.svg', maxColors: ILLUSTRATOR_MAX_TRACE_COLORS + 1 }).errors.some((e) => e.includes('maxColors')),
  'above-range maxColors is rejected',
);
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.svg', maxColors: ILLUSTRATOR_MIN_TRACE_COLORS - 1 }).errors.some((e) => e.includes('maxColors')),
  'below-range maxColors is rejected',
);
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.svg', threshold: ILLUSTRATOR_MAX_TRACE_THRESHOLD + 1 }).errors.some((e) => e.includes('threshold')),
  'above-range threshold is rejected',
);
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.svg', threshold: ILLUSTRATOR_MIN_TRACE_THRESHOLD - 1 }).errors.some((e) => e.includes('threshold')),
  'below-range threshold is rejected',
);
assert.ok(
  buildIllustratorVectorizeJsx({ outputPath: '/tmp/trace.svg', mode: 'sepia' as unknown as 'color' }).errors.some((e) => e.includes('mode must be one of')),
  'unknown tracing mode is rejected',
);

// ── 4) illustrator_arrange (in-place z-order mutation of the selection) ──────

assert.equal(ILLUSTRATOR_ARRANGE_DIRECTIONS.length, 4, 'arrange directions are exactly the 4 z-order moves');

const bringToFront = buildIllustratorArrangeJsx({
  appName: 'Adobe Illustrator',
  expectedDocumentName: 'brand "kit".ai',
  direction: 'bringToFront',
});
assert.deepEqual(bringToFront.errors, [], 'bringToFront arrange builds with no errors');
assert.ok(bringToFront.jsx.includes('(function () {'), 'arrange jsx is an IIFE');
assert.ok(bringToFront.jsx.includes('}());'), 'arrange jsx closes its IIFE');
assert.ok(bringToFront.jsx.includes('items[i].zOrder(ZOrderMethod.BRINGTOFRONT);'), 'bringToFront resolves the BRINGTOFRONT enum at build time');
assert.ok(bringToFront.jsx.includes('var direction = "bringToFront";'), 'direction embedded via JSON.stringify');
assert.ok(bringToFront.jsx.includes('"no_selection"'), 'arrange fails closed when nothing is selected');
assert.ok(bringToFront.jsx.includes('"no_document"'), 'arrange fails closed with no document');
assert.ok(bringToFront.jsx.includes('"document_mismatch"'), 'arrange fails closed on document mismatch');
assert.ok(bringToFront.jsx.includes(`var expectedDocumentName = ${JSON.stringify('brand "kit".ai')};`), 'arrange guard carries the expected document name (quotes escaped)');
assert.equal(bringToFront.jsx.includes('= "brand "kit".ai"'), false, 'raw unescaped document name never reaches the jsx');
assert.ok(bringToFront.jsx.includes('\\"movedCount\\":'), 'receipt reports movedCount');
assert.equal(bringToFront.jsx.includes('exportFile'), false, 'arrange never exports');
assertNeverTouchesSource(bringToFront.jsx, 'arrange bringToFront');

// Every direction resolves its ZOrderMethod enum at build time (no runtime branch).
assert.ok(buildIllustratorArrangeJsx({ direction: 'sendToBack' }).jsx.includes('items[i].zOrder(ZOrderMethod.SENDTOBACK);'), 'sendToBack resolves SENDTOBACK');
assert.ok(buildIllustratorArrangeJsx({ direction: 'bringForward' }).jsx.includes('items[i].zOrder(ZOrderMethod.BRINGFORWARD);'), 'bringForward resolves BRINGFORWARD');
const sendBackward = buildIllustratorArrangeJsx({ direction: 'sendBackward' });
assert.ok(sendBackward.jsx.includes('items[i].zOrder(ZOrderMethod.SENDBACKWARD);'), 'sendBackward resolves SENDBACKWARD');
assertNeverTouchesSource(sendBackward.jsx, 'arrange sendBackward');

// Rejections (fail closed, no jsx).
assert.ok(
  buildIllustratorArrangeJsx({ direction: 'raise' as unknown as 'bringToFront' }).errors.some((e) => e.includes('direction must be')),
  'unknown direction is rejected',
);
assert.equal(buildIllustratorArrangeJsx({ direction: 'raise' as unknown as 'bringToFront' }).jsx, '', 'rejected arrange emits no jsx');
assert.ok(
  buildIllustratorArrangeJsx({ direction: 'BRINGTOFRONT' as unknown as 'bringToFront' }).errors.some((e) => e.includes('direction must be')),
  'direction is case-sensitive (upper-case BRINGTOFRONT is rejected)',
);
assert.ok(
  buildIllustratorArrangeJsx({ direction: '' as unknown as 'bringToFront' }).errors.some((e) => e.includes('direction must be')),
  'empty direction is rejected',
);
assert.ok(
  buildIllustratorArrangeJsx({ appName: 'Illustrator; rm -rf /', direction: 'bringToFront' }).errors.includes('Invalid appName.'),
  'shell-metacharacter appName is rejected',
);
assert.ok(
  buildIllustratorArrangeJsx({ direction: 'bringToFront', expectedDocumentName: 'evil\x00.ai' }).errors.some((e) => e.includes('expectedDocumentName')),
  'NUL in expectedDocumentName is rejected',
);

// ── 5) illustrator_add_text (additive point-text frame in the OPEN doc) ──────

const quotedHeadline = 'Summer "Sale" 2026';
const addText = buildIllustratorAddTextJsx({
  appName: 'Adobe Illustrator',
  expectedDocumentName: 'brand "kit".ai',
  contents: quotedHeadline,
  xPt: 72,
  yPt: 144,
  sizePt: 48,
  fillColor: '#ff3300',
  fontName: 'Helvetica Neue',
});
assert.deepEqual(addText.errors, [], 'add_text builds with no errors');
assert.ok(addText.jsx.includes('(function () {'), 'add_text jsx is an IIFE');
assert.ok(addText.jsx.includes('}());'), 'add_text jsx closes its IIFE');
assert.ok(addText.jsx.includes('doc.textFrames.pointText([xPt, yPt])'), 'add_text creates a point-text frame at [xPt, yPt]');
assert.ok(addText.jsx.includes('tf.contents = contents;'), 'add_text sets the text contents');
assert.ok(addText.jsx.includes('attrs.size = sizePt;'), 'add_text sets the font size');
assert.ok(addText.jsx.includes(`var contents = ${JSON.stringify(quotedHeadline)};`), 'contents quotes are escaped via JSON.stringify');
assert.equal(addText.jsx.includes(`= "${quotedHeadline}"`), false, 'raw unescaped contents never reaches the jsx');
assert.ok(addText.jsx.includes('var xPt = 72;'), 'xPt embedded as a numeric literal');
assert.ok(addText.jsx.includes('var yPt = 144;'), 'yPt embedded as a numeric literal');
assert.ok(addText.jsx.includes('var sizePt = 48;'), 'sizePt embedded as a numeric literal');
assert.ok(addText.jsx.includes('var fillColor = "#ff3300";'), 'fillColor embedded via JSON.stringify');
assert.ok(addText.jsx.includes('var fontName = "Helvetica Neue";'), 'fontName embedded via JSON.stringify');
assert.ok(addText.jsx.includes('doc.textFonts.getByName(fontName)'), 'add_text resolves the requested font');
assert.ok(addText.jsx.includes('"font_not_found"'), 'add_text reports font_not_found when the font is missing (text still created)');
assert.ok(addText.jsx.includes('doc.documentColorSpace == DocumentColorSpace.CMYK'), 'fill picks RGB/CMYK by the document color space');
assert.ok(addText.jsx.includes('new RGBColor()'), 'add_text can build an RGBColor fill');
assert.ok(addText.jsx.includes('new CMYKColor()'), 'add_text can build a CMYKColor fill');
assert.ok(addText.jsx.includes('"no_document"'), 'add_text fails closed with no document');
assert.ok(addText.jsx.includes('"document_mismatch"'), 'add_text fails closed on document mismatch');
assert.ok(addText.jsx.includes(`var expectedDocumentName = ${JSON.stringify('brand "kit".ai')};`), 'add_text guard carries the expected document name (quotes escaped)');
assert.equal(addText.jsx.includes('= "brand "kit".ai"'), false, 'raw unescaped document name never reaches the jsx');
assert.ok(addText.jsx.includes('\\"appliedFont\\":'), 'receipt reports appliedFont');
assert.ok(addText.jsx.includes('\\"fillApplied\\":'), 'receipt reports fillApplied');
assert.ok(addText.jsx.includes('\\"fontWarning\\":'), 'receipt reports fontWarning');
assert.equal(addText.jsx.includes('exportFile'), false, 'add_text never exports');
assertNeverTouchesSource(addText.jsx, 'add_text');

// Defaults: sizePt → 24, omitted fill/font → null literals.
const addTextDefaults = buildIllustratorAddTextJsx({ contents: 'Hello', xPt: 0, yPt: 0 });
assert.deepEqual(addTextDefaults.errors, [], 'add_text builds with defaults');
assert.ok(addTextDefaults.jsx.includes('var sizePt = 24;'), 'sizePt defaults to 24');
assert.ok(addTextDefaults.jsx.includes('var fillColor = null;'), 'omitted fillColor emits null');
assert.ok(addTextDefaults.jsx.includes('var fontName = null;'), 'omitted fontName emits null');
assert.ok(addTextDefaults.jsx.includes('var xPt = 0;'), 'xPt 0 embedded as a numeric literal');
assertNeverTouchesSource(addTextDefaults.jsx, 'add_text defaults');

// Rejections (fail closed, no jsx).
assert.ok(buildIllustratorAddTextJsx({ contents: '', xPt: 0, yPt: 0 }).errors.some((e) => e.includes('contents')), 'empty contents rejected');
assert.equal(buildIllustratorAddTextJsx({ contents: '', xPt: 0, yPt: 0 }).jsx, '', 'rejected add_text emits no jsx');
assert.ok(buildIllustratorAddTextJsx({ contents: '   ', xPt: 0, yPt: 0 }).errors.some((e) => e.includes('non-empty')), 'whitespace-only contents rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'a'.repeat(ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS + 1), xPt: 0, yPt: 0 }).errors.some((e) => e.includes(String(ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS))), 'overlong contents rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'a\x00b', xPt: 0, yPt: 0 }).errors.some((e) => e.includes('NUL')), 'NUL in contents rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: undefined as unknown as number, yPt: 0 }).errors.some((e) => e.includes('xPt')), 'missing xPt rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: Number.NaN, yPt: 0 }).errors.some((e) => e.includes('xPt')), 'NaN xPt rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: '5' as unknown as number, yPt: 0 }).errors.some((e) => e.includes('xPt')), 'string xPt rejected (strict number)');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 1e9 }).errors.some((e) => e.includes('yPt')), 'out-of-range yPt rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 0, sizePt: 0 }).errors.some((e) => e.includes('sizePt')), 'sizePt below range rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 0, sizePt: ILLUSTRATOR_ADD_TEXT_MAX_SIZE_PT + 1 }).errors.some((e) => e.includes('sizePt')), 'sizePt above range rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 0, fillColor: 'red' }).errors.some((e) => e.includes('fillColor')), 'named fillColor rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 0, fillColor: '#FFF' }).errors.some((e) => e.includes('fillColor')), 'short hex fillColor rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 0, fillColor: '#GGGGGG' }).errors.some((e) => e.includes('fillColor')), 'non-hex fillColor rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 0, fontName: 'a'.repeat(201) }).errors.some((e) => e.includes('fontName')), 'overlong fontName rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 0, appName: 'Illustrator; rm -rf /' }).errors.includes('Invalid appName.'), 'shell-metacharacter appName rejected');
assert.ok(buildIllustratorAddTextJsx({ contents: 'x', xPt: 0, yPt: 0, expectedDocumentName: 'evil\x00.ai' }).errors.some((e) => e.includes('expectedDocumentName')), 'NUL expectedDocumentName rejected');

// Boundary values validate.
const boundaryAddText = validateIllustratorAddTextParams({
  contents: 'a'.repeat(ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS),
  xPt: 0,
  yPt: 0,
  sizePt: ILLUSTRATOR_ADD_TEXT_MAX_SIZE_PT,
});
assert.ok(boundaryAddText.ok, 'boundary contents length + max size validates');

// ── 6) illustrator_add_shape (additive rectangle/ellipse/line in the OPEN doc) ─

assert.equal(ILLUSTRATOR_ADD_SHAPE_KINDS.length, 3, 'add_shape kinds are exactly rectangle|ellipse|line');

// Rectangle with fill + stroke (y-up: rectangle(top,left,width,height), yPt = top).
const rect = buildIllustratorAddShapeJsx({
  appName: 'Adobe Illustrator',
  expectedDocumentName: 'brand "kit".ai',
  kind: 'rectangle',
  xPt: 10,
  yPt: 20,
  widthPt: 200,
  heightPt: 100,
  fillColor: '#ff3300',
  strokeColor: '#000000',
  strokeWidthPt: 2,
});
assert.deepEqual(rect.errors, [], 'rectangle add_shape builds with no errors');
assert.ok(rect.jsx.includes('(function () {'), 'add_shape jsx is an IIFE');
assert.ok(rect.jsx.includes('}());'), 'add_shape jsx closes its IIFE');
assert.ok(rect.jsx.includes('doc.pathItems.rectangle(yPt, xPt, widthPt, heightPt)'), 'rectangle uses pathItems.rectangle(top,left,w,h) with y-up (yPt as top, xPt as left)');
assert.ok(rect.jsx.includes('var kind = "rectangle";'), 'kind embedded via JSON.stringify');
assert.ok(rect.jsx.includes('var xPt = 10;'), 'xPt embedded as a numeric literal');
assert.ok(rect.jsx.includes('var yPt = 20;'), 'yPt embedded as a numeric literal');
assert.ok(rect.jsx.includes('var widthPt = 200;'), 'widthPt embedded as a numeric literal');
assert.ok(rect.jsx.includes('var heightPt = 100;'), 'heightPt embedded as a numeric literal');
assert.ok(rect.jsx.includes('var fillColor = "#ff3300";'), 'fillColor embedded via JSON.stringify');
assert.ok(rect.jsx.includes('var strokeColor = "#000000";'), 'strokeColor embedded via JSON.stringify');
assert.ok(rect.jsx.includes('var strokeWidthPt = 2;'), 'strokeWidthPt embedded as a numeric literal');
assert.ok(rect.jsx.includes('new RGBColor()'), 'add_shape can build an RGBColor');
assert.ok(rect.jsx.includes('new CMYKColor()'), 'add_shape can build a CMYKColor');
assert.ok(rect.jsx.includes('doc.documentColorSpace == DocumentColorSpace.CMYK'), 'fill/stroke pick RGB/CMYK by the document color space');
assert.ok(rect.jsx.includes('\\"fillApplied\\":'), 'receipt reports fillApplied');
assert.ok(rect.jsx.includes('\\"strokeApplied\\":'), 'receipt reports strokeApplied');
assert.ok(rect.jsx.includes('\\"kind\\":'), 'receipt reports kind');
assert.ok(rect.jsx.includes('"no_document"'), 'add_shape fails closed with no document');
assert.ok(rect.jsx.includes('"document_mismatch"'), 'add_shape fails closed on document mismatch');
assert.ok(rect.jsx.includes(`var expectedDocumentName = ${JSON.stringify('brand "kit".ai')};`), 'add_shape guard carries the expected document name (quotes escaped)');
assert.equal(rect.jsx.includes('= "brand "kit".ai"'), false, 'raw unescaped document name never reaches the jsx');
assert.equal(rect.jsx.includes('exportFile'), false, 'add_shape never exports');
assertNeverTouchesSource(rect.jsx, 'add_shape rectangle');

// Ellipse resolves the ellipse DOM call; omitted paints emit null literals.
const ellipse = buildIllustratorAddShapeJsx({ kind: 'ellipse', xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 });
assert.deepEqual(ellipse.errors, [], 'ellipse add_shape builds with no errors');
assert.ok(ellipse.jsx.includes('doc.pathItems.ellipse(yPt, xPt, widthPt, heightPt)'), 'ellipse uses pathItems.ellipse(top,left,w,h)');
assert.ok(ellipse.jsx.includes('var xPt = 0;'), 'xPt 0 embedded as a numeric literal');
assert.ok(ellipse.jsx.includes('var fillColor = null;'), 'omitted fillColor emits null');
assert.ok(ellipse.jsx.includes('var strokeColor = null;'), 'omitted strokeColor emits null');
assert.ok(ellipse.jsx.includes('var strokeWidthPt = null;'), 'omitted strokeWidthPt emits null');
assertNeverTouchesSource(ellipse.jsx, 'add_shape ellipse');

// Line uses setEntirePath between the two points and defaults filled off.
const line = buildIllustratorAddShapeJsx({ kind: 'line', x1Pt: 5, y1Pt: 6, x2Pt: 105, y2Pt: 6, strokeColor: '#123456', strokeWidthPt: 0 });
assert.deepEqual(line.errors, [], 'line add_shape builds with no errors');
assert.ok(line.jsx.includes('shape.setEntirePath([[x1Pt, y1Pt], [x2Pt, y2Pt]]);'), 'line uses setEntirePath between the two points');
assert.ok(line.jsx.includes('shape.filled = false;'), 'line defaults filled off');
assert.ok(line.jsx.includes('var x1Pt = 5;'), 'x1Pt embedded as a numeric literal');
assert.ok(line.jsx.includes('var y2Pt = 6;'), 'y2Pt embedded as a numeric literal');
assert.ok(line.jsx.includes('var strokeColor = "#123456";'), 'strokeColor embedded via JSON.stringify');
assert.ok(line.jsx.includes('var strokeWidthPt = 0;'), 'strokeWidthPt 0 embedded as a numeric literal');
assertNeverTouchesSource(line.jsx, 'add_shape line');

// Rejections (fail closed, no jsx).
assert.ok(buildIllustratorAddShapeJsx({ kind: 'triangle' as unknown as 'rectangle', xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 }).errors.some((e) => e.includes('kind must be one of')), 'unknown kind rejected');
assert.equal(buildIllustratorAddShapeJsx({ kind: 'triangle' as unknown as 'rectangle', xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 }).jsx, '', 'rejected add_shape emits no jsx');
assert.ok(buildIllustratorAddShapeJsx({ kind: '' as unknown as 'rectangle', xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 }).errors.some((e) => e.includes('kind must be one of')), 'empty kind rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 0, heightPt: 10 }).errors.some((e) => e.includes('widthPt')), 'non-positive widthPt rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: -5, heightPt: 10 }).errors.some((e) => e.includes('widthPt')), 'negative widthPt rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT + 1 }).errors.some((e) => e.includes('heightPt')), 'above-range heightPt rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: undefined as unknown as number, yPt: 0, widthPt: 10, heightPt: 10 }).errors.some((e) => e.includes('xPt')), 'missing xPt rejected for rectangle');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: '5' as unknown as number, yPt: 0, widthPt: 10, heightPt: 10 }).errors.some((e) => e.includes('xPt')), 'string xPt rejected (strict number)');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 1e9, widthPt: 10, heightPt: 10 }).errors.some((e) => e.includes('yPt')), 'out-of-range yPt rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'line', x1Pt: 0, y1Pt: 0, x2Pt: 10, y2Pt: Number.NaN }).errors.some((e) => e.includes('y2Pt')), 'NaN y2Pt rejected for line');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'line', x1Pt: undefined as unknown as number, y1Pt: 0, x2Pt: 10, y2Pt: 0 }).errors.some((e) => e.includes('x1Pt')), 'missing x1Pt rejected for line');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, fillColor: 'red' }).errors.some((e) => e.includes('fillColor')), 'named fillColor rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, strokeColor: '#FFF' }).errors.some((e) => e.includes('strokeColor')), 'short hex strokeColor rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, strokeWidthPt: -1 }).errors.some((e) => e.includes('strokeWidthPt')), 'negative strokeWidthPt rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, strokeWidthPt: ILLUSTRATOR_ADD_SHAPE_MAX_STROKE_WIDTH_PT + 1 }).errors.some((e) => e.includes('strokeWidthPt')), 'above-range strokeWidthPt rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, appName: 'Illustrator; rm -rf /' }).errors.includes('Invalid appName.'), 'shell-metacharacter appName rejected');
assert.ok(buildIllustratorAddShapeJsx({ kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, expectedDocumentName: 'evil\x00.ai' }).errors.some((e) => e.includes('expectedDocumentName')), 'NUL expectedDocumentName rejected');

// Case-insensitive kind + boundary values validate.
const upperKind = validateIllustratorAddShapeParams({ kind: 'Rectangle' as unknown as 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 });
assert.ok(upperKind.ok && upperKind.params.kind === 'rectangle', 'kind is normalized case-insensitively to rectangle');
const boundaryShape = validateIllustratorAddShapeParams({
  kind: 'rectangle',
  xPt: 0,
  yPt: 0,
  widthPt: ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT,
  heightPt: ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT,
  strokeWidthPt: ILLUSTRATOR_ADD_SHAPE_MAX_STROKE_WIDTH_PT,
});
assert.ok(boundaryShape.ok, 'boundary dims + max stroke width validates');

// ── 7) illustrator_set_appearance (recolor/re-stroke the selection in place) ──

// Fill + stroke color + stroke width, all at once.
const setAppearanceFill = buildIllustratorSetAppearanceJsx({
  appName: 'Adobe Illustrator',
  expectedDocumentName: 'brand "kit".ai',
  fillColor: '#ff0000',
  strokeColor: '#000000',
  strokeWidthPt: 3,
});
assert.deepEqual(setAppearanceFill.errors, [], 'set_appearance (fill+stroke+width) builds with no errors');
assert.ok(setAppearanceFill.jsx.includes('(function () {'), 'set_appearance jsx is an IIFE');
assert.ok(setAppearanceFill.jsx.includes('}());'), 'set_appearance jsx closes its IIFE');
assert.ok(setAppearanceFill.jsx.includes('var fillColor = "#ff0000";'), 'fillColor embedded via JSON.stringify');
assert.ok(setAppearanceFill.jsx.includes('var strokeColor = "#000000";'), 'strokeColor embedded via JSON.stringify');
assert.ok(setAppearanceFill.jsx.includes('var strokeWidthPt = 3;'), 'strokeWidthPt embedded as a numeric literal');
assert.ok(setAppearanceFill.jsx.includes('var swatchName = null;'), 'omitted swatchName emits null');
assert.ok(setAppearanceFill.jsx.includes('item.fillColor = fillColorObj;'), 'fill is applied to each selected item');
assert.ok(setAppearanceFill.jsx.includes('item.strokeColor = strokeColorObj;'), 'stroke color is applied to each selected item');
assert.ok(setAppearanceFill.jsx.includes('item.strokeWidth = strokeWidthPt;'), 'stroke width is applied to each selected item');
assert.ok(setAppearanceFill.jsx.includes('doc.swatches.getByName(swatchName)'), 'set_appearance can resolve a named swatch');
assert.ok(setAppearanceFill.jsx.includes('"swatch_not_found"'), 'set_appearance fails closed when a named swatch is missing');
assert.ok(setAppearanceFill.jsx.includes('"swatch_not_solid"'), 'set_appearance fails closed on a gradient/pattern swatch (solid color only)');
assert.ok(setAppearanceFill.jsx.includes('typeName === "GroupItem"'), 'set_appearance recurses into groups');
assert.ok(setAppearanceFill.jsx.includes('item.pageItems'), 'set_appearance recurses into GroupItem.pageItems');
assert.ok(setAppearanceFill.jsx.includes('new RGBColor()'), 'set_appearance can build an RGBColor');
assert.ok(setAppearanceFill.jsx.includes('new CMYKColor()'), 'set_appearance can build a CMYKColor');
assert.ok(setAppearanceFill.jsx.includes('doc.documentColorSpace == DocumentColorSpace.CMYK'), 'fill/stroke pick RGB/CMYK by the document color space');
assert.ok(setAppearanceFill.jsx.includes('\\"appliedToCount\\":'), 'receipt reports appliedToCount');
assert.ok(setAppearanceFill.jsx.includes('\\"fillApplied\\":'), 'receipt reports fillApplied');
assert.ok(setAppearanceFill.jsx.includes('\\"strokeApplied\\":'), 'receipt reports strokeApplied');
assert.ok(setAppearanceFill.jsx.includes('"no_selection"'), 'set_appearance fails closed when nothing is selected');
assert.ok(setAppearanceFill.jsx.includes('"no_document"'), 'set_appearance fails closed with no document');
assert.ok(setAppearanceFill.jsx.includes('"document_mismatch"'), 'set_appearance fails closed on document mismatch');
assert.ok(setAppearanceFill.jsx.includes(`var expectedDocumentName = ${JSON.stringify('brand "kit".ai')};`), 'set_appearance guard carries the expected document name (quotes escaped)');
assert.equal(setAppearanceFill.jsx.includes('= "brand "kit".ai"'), false, 'raw unescaped document name never reaches the jsx');
assert.equal(setAppearanceFill.jsx.includes('exportFile'), false, 'set_appearance never exports');
assertNeverTouchesSource(setAppearanceFill.jsx, 'set_appearance fill+stroke');

// Swatch-only fill (mutually exclusive with fillColor; omitted paints emit null).
const setAppearanceSwatch = buildIllustratorSetAppearanceJsx({ swatchName: 'Brand Red' });
assert.deepEqual(setAppearanceSwatch.errors, [], 'set_appearance (swatch only) builds with no errors');
assert.ok(setAppearanceSwatch.jsx.includes('var swatchName = "Brand Red";'), 'swatchName embedded via JSON.stringify');
assert.ok(setAppearanceSwatch.jsx.includes('var fillColor = null;'), 'omitted fillColor emits null');
assert.ok(setAppearanceSwatch.jsx.includes('var strokeColor = null;'), 'omitted strokeColor emits null');
assert.ok(setAppearanceSwatch.jsx.includes('var strokeWidthPt = null;'), 'omitted strokeWidthPt emits null');
assertNeverTouchesSource(setAppearanceSwatch.jsx, 'set_appearance swatch');

// strokeWidthPt: 0 is a valid appearance request (a zero-width / hairline stroke).
const setAppearanceZeroWidth = buildIllustratorSetAppearanceJsx({ strokeWidthPt: 0 });
assert.deepEqual(setAppearanceZeroWidth.errors, [], 'strokeWidthPt 0 is a valid appearance request');
assert.ok(setAppearanceZeroWidth.jsx.includes('var strokeWidthPt = 0;'), 'strokeWidthPt 0 embedded as a numeric literal');

// Rejections (fail closed, no jsx).
assert.ok(buildIllustratorSetAppearanceJsx({}).errors.some((e) => e.includes('At least one of')), 'empty appearance request rejected');
assert.equal(buildIllustratorSetAppearanceJsx({}).jsx, '', 'rejected set_appearance emits no jsx');
assert.ok(buildIllustratorSetAppearanceJsx({ fillColor: '#ff0000', swatchName: 'Brand Red' }).errors.some((e) => e.includes('either fillColor or swatchName')), 'fillColor + swatchName conflict rejected');
assert.equal(buildIllustratorSetAppearanceJsx({ fillColor: '#ff0000', swatchName: 'Brand Red' }).jsx, '', 'conflicting fill sources emit no jsx');
assert.ok(buildIllustratorSetAppearanceJsx({ fillColor: 'red' }).errors.some((e) => e.includes('fillColor')), 'named fillColor rejected');
assert.ok(buildIllustratorSetAppearanceJsx({ fillColor: '#FFF' }).errors.some((e) => e.includes('fillColor')), 'short hex fillColor rejected');
assert.ok(buildIllustratorSetAppearanceJsx({ strokeColor: '#GGGGGG' }).errors.some((e) => e.includes('strokeColor')), 'non-hex strokeColor rejected');
assert.ok(buildIllustratorSetAppearanceJsx({ strokeWidthPt: -1 }).errors.some((e) => e.includes('strokeWidthPt')), 'negative strokeWidthPt rejected');
assert.ok(buildIllustratorSetAppearanceJsx({ strokeWidthPt: ILLUSTRATOR_SET_APPEARANCE_MAX_STROKE_WIDTH_PT + 1 }).errors.some((e) => e.includes('strokeWidthPt')), 'above-range strokeWidthPt rejected');
assert.ok(buildIllustratorSetAppearanceJsx({ strokeWidthPt: '2' as unknown as number }).errors.some((e) => e.includes('strokeWidthPt')), 'string strokeWidthPt rejected (strict number)');
assert.ok(buildIllustratorSetAppearanceJsx({ swatchName: 'a'.repeat(ILLUSTRATOR_SET_APPEARANCE_MAX_SWATCH_NAME + 1) }).errors.some((e) => e.includes('swatchName')), 'overlong swatchName rejected');
assert.ok(buildIllustratorSetAppearanceJsx({ swatchName: 'bad\x00name' }).errors.some((e) => e.includes('swatchName')), 'control-char swatchName rejected');
assert.ok(buildIllustratorSetAppearanceJsx({ strokeWidthPt: 2, appName: 'Illustrator; rm -rf /' }).errors.includes('Invalid appName.'), 'shell-metacharacter appName rejected');
assert.ok(buildIllustratorSetAppearanceJsx({ strokeWidthPt: 2, expectedDocumentName: 'evil\x00.ai' }).errors.some((e) => e.includes('expectedDocumentName')), 'NUL expectedDocumentName rejected');

// Boundary values validate.
const boundarySetAppearance = validateIllustratorSetAppearanceParams({
  strokeWidthPt: ILLUSTRATOR_SET_APPEARANCE_MAX_STROKE_WIDTH_PT,
  swatchName: 'a'.repeat(ILLUSTRATOR_SET_APPEARANCE_MAX_SWATCH_NAME),
});
assert.ok(boundarySetAppearance.ok, 'boundary max stroke width + max swatch-name length validates');

// ── Receipt guards ──────────────────────────────────────────────────────────

const validStatusReceipt = {
  ok: true,
  appName: 'Adobe Illustrator 2025',
  appRunning: true,
  status: 'ready',
  documentCount: 2,
  activeDocumentName: 'brand kit.ai',
  activeDocumentPath: '/Users/demo/brand kit.ai',
  widthPt: 612,
  heightPt: 792,
  artboardCount: 3,
  layerCount: 7,
  selectionCount: 0,
  documents: [
    { name: 'brand kit.ai', path: '/Users/demo/brand kit.ai', modified: false, saved: true, widthPt: 612, heightPt: 792, artboardCount: 3, layerCount: 7, selectionCount: 0 },
  ],
  error: null,
};
assert.ok(isIllustratorDocumentStatusReceipt(validStatusReceipt), 'valid status receipt passes the guard');
assert.equal(
  isIllustratorDocumentStatusReceipt({ ...validStatusReceipt, documentCount: '2' }),
  false,
  'string documentCount fails the status guard',
);
assert.equal(
  isIllustratorDocumentStatusReceipt({
    ...validStatusReceipt,
    documents: Array.from({ length: ILLUSTRATOR_MAX_STATUS_DOCUMENTS + 1 }, () => validStatusReceipt.documents[0]),
  }),
  false,
  'status receipt with more than 12 documents fails the guard (bounded)',
);
assert.equal(isIllustratorDocumentStatusReceipt(null), false, 'null fails the status guard');

const validExportReceipt = {
  ok: true,
  appName: 'Adobe Illustrator',
  documentName: 'hero-art.ai',
  outputFileName: 'hero art.png',
  format: 'png',
  scalePercent: 200,
  fileExists: true,
  sizeBytes: 48213,
  error: null,
};
assert.ok(isIllustratorExportProofReceipt(validExportReceipt), 'valid export receipt passes the guard');
assert.ok(
  isIllustratorExportProofReceipt({ ...validExportReceipt, format: 'svg', scalePercent: null }),
  'svg export receipt with null scalePercent passes the guard',
);
assert.equal(
  isIllustratorExportProofReceipt({ ...validExportReceipt, format: 'pdf' }),
  false,
  'export receipt with format pdf fails the guard (excluded by design)',
);
assert.equal(
  isIllustratorExportProofReceipt({ ...validExportReceipt, sizeBytes: '48213' }),
  false,
  'string sizeBytes fails the export guard',
);
assert.equal(isIllustratorExportProofReceipt(null), false, 'null fails the export guard');

const validVectorizeReceipt = {
  ok: true,
  appName: 'Adobe Illustrator',
  appRunning: true,
  sourceImagePath: '/Users/demo/logo.png',
  sourceKind: 'provided',
  outputFileName: 'logo.svg',
  mode: 'blackwhite',
  maxColors: 6,
  threshold: 128,
  ignoreWhite: false,
  pathCount: 42,
  fileExists: true,
  sizeBytes: 8123,
  error: null,
};
assert.ok(isIllustratorVectorizeReceipt(validVectorizeReceipt), 'valid vectorize receipt passes the guard');
assert.ok(
  isIllustratorVectorizeReceipt({ ...validVectorizeReceipt, sourceImagePath: null, sourceKind: null }),
  'vectorize receipt with a null source (front-document trace before resolve) passes the guard',
);
assert.equal(
  isIllustratorVectorizeReceipt({ ...validVectorizeReceipt, mode: 'duotone' }),
  false,
  'vectorize receipt with an unknown tracing mode fails the guard',
);
assert.equal(
  isIllustratorVectorizeReceipt({ ...validVectorizeReceipt, pathCount: '42' }),
  false,
  'string pathCount fails the vectorize guard',
);
assert.equal(
  isIllustratorVectorizeReceipt({ ...validVectorizeReceipt, ignoreWhite: 'false' }),
  false,
  'string ignoreWhite fails the vectorize guard',
);
assert.equal(isIllustratorVectorizeReceipt(null), false, 'null fails the vectorize guard');

const validArrangeReceipt = {
  ok: true,
  appName: 'Adobe Illustrator',
  appRunning: true,
  documentName: 'brand kit.ai',
  direction: 'bringToFront',
  movedCount: 3,
  error: null,
};
assert.ok(isIllustratorArrangeReceipt(validArrangeReceipt), 'valid arrange receipt passes the guard');
assert.ok(
  isIllustratorArrangeReceipt({ ...validArrangeReceipt, ok: false, movedCount: 0, error: 'no_selection' }),
  'failed arrange receipt (no_selection, movedCount 0) passes the guard',
);
assert.equal(
  isIllustratorArrangeReceipt({ ...validArrangeReceipt, direction: 'raise' }),
  false,
  'arrange receipt with an unknown direction fails the guard',
);
assert.equal(
  isIllustratorArrangeReceipt({ ...validArrangeReceipt, movedCount: '3' }),
  false,
  'string movedCount fails the arrange guard',
);
assert.equal(
  isIllustratorArrangeReceipt({ ...validArrangeReceipt, appRunning: 'true' }),
  false,
  'string appRunning fails the arrange guard',
);
assert.equal(isIllustratorArrangeReceipt(null), false, 'null fails the arrange guard');

const validAddTextReceipt = {
  ok: true,
  appName: 'Adobe Illustrator',
  appRunning: true,
  documentName: 'brand kit.ai',
  contents: 'Summer Sale',
  xPt: 72,
  yPt: 144,
  sizePt: 48,
  appliedFont: 'Helvetica Neue',
  fillApplied: true,
  fontWarning: null,
  error: null,
};
assert.ok(isIllustratorAddTextReceipt(validAddTextReceipt), 'valid add_text receipt passes the guard');
assert.ok(
  isIllustratorAddTextReceipt({ ...validAddTextReceipt, appliedFont: 'Myriad Pro', fontWarning: 'font_not_found' }),
  'add_text receipt with a font_not_found warning (text still created) passes the guard',
);
assert.ok(
  isIllustratorAddTextReceipt({ ...validAddTextReceipt, ok: false, appliedFont: null, fillApplied: false, error: 'document_mismatch' }),
  'failed add_text receipt (document_mismatch) passes the guard',
);
assert.equal(
  isIllustratorAddTextReceipt({ ...validAddTextReceipt, xPt: '72' }),
  false,
  'string xPt fails the add_text guard',
);
assert.equal(
  isIllustratorAddTextReceipt({ ...validAddTextReceipt, contents: 42 }),
  false,
  'non-string contents fails the add_text guard',
);
assert.equal(
  isIllustratorAddTextReceipt({ ...validAddTextReceipt, fillApplied: 'true' }),
  false,
  'string fillApplied fails the add_text guard',
);
assert.equal(isIllustratorAddTextReceipt(null), false, 'null fails the add_text guard');

const validAddShapeReceipt = {
  ok: true,
  appName: 'Adobe Illustrator',
  appRunning: true,
  documentName: 'brand kit.ai',
  kind: 'rectangle',
  fillApplied: true,
  strokeApplied: true,
  error: null,
};
assert.ok(isIllustratorAddShapeReceipt(validAddShapeReceipt), 'valid add_shape receipt passes the guard');
assert.ok(
  isIllustratorAddShapeReceipt({ ...validAddShapeReceipt, kind: 'line', fillApplied: false }),
  'line add_shape receipt (no fill) passes the guard',
);
assert.ok(
  isIllustratorAddShapeReceipt({ ...validAddShapeReceipt, ok: false, fillApplied: false, strokeApplied: false, error: 'document_mismatch' }),
  'failed add_shape receipt (document_mismatch) passes the guard',
);
assert.equal(
  isIllustratorAddShapeReceipt({ ...validAddShapeReceipt, kind: 'triangle' }),
  false,
  'add_shape receipt with an unknown kind fails the guard',
);
assert.equal(
  isIllustratorAddShapeReceipt({ ...validAddShapeReceipt, fillApplied: 'true' }),
  false,
  'string fillApplied fails the add_shape guard',
);
assert.equal(
  isIllustratorAddShapeReceipt({ ...validAddShapeReceipt, appRunning: 'true' }),
  false,
  'string appRunning fails the add_shape guard',
);
assert.equal(isIllustratorAddShapeReceipt(null), false, 'null fails the add_shape guard');

const validSetAppearanceReceipt = {
  ok: true,
  appName: 'Adobe Illustrator',
  appRunning: true,
  documentName: 'brand kit.ai',
  appliedToCount: 4,
  fillApplied: true,
  strokeApplied: true,
  error: null,
};
assert.ok(isIllustratorSetAppearanceReceipt(validSetAppearanceReceipt), 'valid set_appearance receipt passes the guard');
assert.ok(
  isIllustratorSetAppearanceReceipt({ ...validSetAppearanceReceipt, ok: false, appliedToCount: 0, fillApplied: false, strokeApplied: false, error: 'no_selection' }),
  'failed set_appearance receipt (no_selection) passes the guard',
);
assert.ok(
  isIllustratorSetAppearanceReceipt({ ...validSetAppearanceReceipt, ok: false, error: 'swatch_not_found' }),
  'set_appearance receipt with swatch_not_found passes the guard',
);
assert.ok(
  isIllustratorSetAppearanceReceipt({ ...validSetAppearanceReceipt, fillApplied: false, error: 'swatch_not_solid' }),
  'set_appearance receipt with swatch_not_solid passes the guard',
);
assert.equal(
  isIllustratorSetAppearanceReceipt({ ...validSetAppearanceReceipt, appliedToCount: '4' }),
  false,
  'string appliedToCount fails the set_appearance guard',
);
assert.equal(
  isIllustratorSetAppearanceReceipt({ ...validSetAppearanceReceipt, appRunning: 'true' }),
  false,
  'string appRunning fails the set_appearance guard',
);
assert.equal(isIllustratorSetAppearanceReceipt(null), false, 'null fails the set_appearance guard');

assert.equal(ILLUSTRATOR_EXPORT_PROOF_FORMATS.length, 2, 'format enum is exactly png|svg (PDF stays out by design)');

// ── LOCKSTEP drift check against scripts/claude-bridge.js ──────────────────
//
// The bridge cannot import this pure module, so it carries duplicated copies
// of the prelude and both JSX bodies. Extract those top-level functions from
// the bridge source and assert they compose byte-identical jsx.

const bridgeSource = readFileSync(path.resolve(process.cwd(), 'scripts/claude-bridge.js'), 'utf8');

function extractBridgeTopLevel(name: string): string {
  const startToken = `\nfunction ${name}(`;
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

function extractBridgeConstLine(name: string): string {
  const match = new RegExp(`\\nconst ${name} = [^\\n]+;`).exec(bridgeSource);
  assert.ok(match, `bridge defines ${name}`);
  return (match as RegExpExecArray)[0];
}

// The duplicated enum/range constants exist bridge-side with the same values.
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_EXPORT_PROOF_FORMATS').includes("['png', 'svg']"),
  'LOCKSTEP: bridge format enum is png|svg',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_MIN_SCALE_PERCENT').includes(String(ILLUSTRATOR_MIN_SCALE_PERCENT)),
  'LOCKSTEP: bridge min scale matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_MAX_SCALE_PERCENT').includes(String(ILLUSTRATOR_MAX_SCALE_PERCENT)),
  'LOCKSTEP: bridge max scale matches the pure module',
);

// The duplicated vectorize enum/range/preset constants exist bridge-side too.
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_TRACING_MODES').includes("['color', 'gray', 'blackwhite']"),
  'LOCKSTEP: bridge tracing-mode enum matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_MAX_TRACE_COLORS').includes(String(ILLUSTRATOR_MAX_TRACE_COLORS)),
  'LOCKSTEP: bridge max trace colors matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_MAX_TRACE_THRESHOLD').includes(String(ILLUSTRATOR_MAX_TRACE_THRESHOLD)),
  'LOCKSTEP: bridge max trace threshold matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_TRACE_IMAGE_EXTENSIONS').includes("'webp'"),
  'LOCKSTEP: bridge traceable raster extensions match the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_TRACE_PRESETS').includes("'bw-logo'"),
  'LOCKSTEP: bridge trace preset table matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_ARRANGE_DIRECTIONS').includes("'bringToFront'"),
  'LOCKSTEP: bridge arrange direction enum matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS').includes(String(ILLUSTRATOR_ADD_TEXT_MAX_CONTENTS)),
  'LOCKSTEP: bridge add_text max contents matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_ADD_TEXT_MAX_SIZE_PT').includes(String(ILLUSTRATOR_ADD_TEXT_MAX_SIZE_PT)),
  'LOCKSTEP: bridge add_text max size matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_ADD_SHAPE_KINDS').includes("['rectangle', 'ellipse', 'line']"),
  'LOCKSTEP: bridge add_shape kind enum matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT').includes(String(ILLUSTRATOR_ADD_SHAPE_MAX_DIM_PT)),
  'LOCKSTEP: bridge add_shape max dim matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_ADD_SHAPE_MAX_STROKE_WIDTH_PT').includes(String(ILLUSTRATOR_ADD_SHAPE_MAX_STROKE_WIDTH_PT)),
  'LOCKSTEP: bridge add_shape max stroke width matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_SET_APPEARANCE_MAX_STROKE_WIDTH_PT').includes(String(ILLUSTRATOR_SET_APPEARANCE_MAX_STROKE_WIDTH_PT)),
  'LOCKSTEP: bridge set_appearance max stroke width matches the pure module',
);
assert.ok(
  extractBridgeConstLine('ILLUSTRATOR_SET_APPEARANCE_MAX_SWATCH_NAME').includes(String(ILLUSTRATOR_SET_APPEARANCE_MAX_SWATCH_NAME)),
  'LOCKSTEP: bridge set_appearance max swatch-name length matches the pure module',
);

type BridgeJsxFns = {
  illustratorJsxPrelude: (args: { expectedDocumentName: string }) => string;
  illustratorDocumentStatusJsxBody: () => string;
  illustratorExportProofJsxBody: (args: { outputPath: string; format: string; scalePercent: number | null }) => string;
  illustratorVectorizeJsxBody: (args: {
    imagePath: string | null;
    outputPath: string;
    mode: string;
    maxColors: number;
    threshold: number;
    ignoreWhite: boolean;
  }) => string;
  illustratorArrangeJsxBody: (args: { direction: string }) => string;
  illustratorAddTextJsxBody: (args: {
    contents: string;
    xPt: number;
    yPt: number;
    sizePt: number;
    fillColor: string | null;
    fontName: string | null;
  }) => string;
  illustratorAddShapeJsxBody: (args: {
    kind: string;
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
  }) => string;
  illustratorSetAppearanceJsxBody: (args: {
    fillColor: string | null;
    strokeColor: string | null;
    strokeWidthPt: number | null;
    swatchName: string | null;
  }) => string;
};

// tracingModeEnumLiteral / zOrderMethodEnumLiteral are dependencies of the
// vectorize / arrange bodies, so they must be in the extracted scope even
// though they compose no jsx on their own.
const bridgeFns = new Function(`
${extractBridgeConstLine('ILLUSTRATOR_DEFAULT_SCALE_PERCENT')}
${extractBridgeTopLevel('jsxLiteral')}
${extractBridgeTopLevel('tracingModeEnumLiteral')}
${extractBridgeTopLevel('zOrderMethodEnumLiteral')}
${extractBridgeTopLevel('illustratorJsxPrelude')}
${extractBridgeTopLevel('illustratorDocumentStatusJsxBody')}
${extractBridgeTopLevel('illustratorExportProofJsxBody')}
${extractBridgeTopLevel('illustratorVectorizeJsxBody')}
${extractBridgeTopLevel('illustratorArrangeJsxBody')}
${extractBridgeTopLevel('illustratorAddTextJsxBody')}
${extractBridgeTopLevel('illustratorAddShapeJsxBody')}
${extractBridgeTopLevel('illustratorSetAppearanceJsxBody')}
return { illustratorJsxPrelude, illustratorDocumentStatusJsxBody, illustratorExportProofJsxBody, illustratorVectorizeJsxBody, illustratorArrangeJsxBody, illustratorAddTextJsxBody, illustratorAddShapeJsxBody, illustratorSetAppearanceJsxBody };
`)() as BridgeJsxFns;

function composeBridgeJsx(expectedDocumentName: string, body: string): string {
  return `
(function () {
${bridgeFns.illustratorJsxPrelude({ expectedDocumentName })}
${body}
}());
`;
}

assert.equal(
  composeBridgeJsx('brand "kit".ai', bridgeFns.illustratorDocumentStatusJsxBody()),
  status.jsx,
  'LOCKSTEP: bridge document-status jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('hero-art.ai', bridgeFns.illustratorExportProofJsxBody({
    outputPath: quotedOutputPath, format: 'png', scalePercent: 200,
  })),
  pngExport.jsx,
  'LOCKSTEP: bridge png export jsx is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.illustratorExportProofJsxBody({
    outputPath: '/Users/demo/Desktop/logo.svg', format: 'svg', scalePercent: null,
  })),
  svgExport.jsx,
  'LOCKSTEP: bridge svg export jsx is byte-identical with the pure module',
);

// Vectorize composes the prelude with an EMPTY expectedDocumentName (it always
// works in a throwaway document), so the bridge check uses composeBridgeJsx('').
assert.equal(
  composeBridgeJsx('', bridgeFns.illustratorVectorizeJsxBody({
    imagePath: quotedImagePath, outputPath: '/Users/demo/Desktop/logo.svg', mode: 'blackwhite', maxColors: 6, threshold: 128, ignoreWhite: false,
  })),
  bwVectorize.jsx,
  'LOCKSTEP: bridge vectorize jsx (provided image + bw-logo preset) is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.illustratorVectorizeJsxBody({
    imagePath: null, outputPath: '/tmp/trace.svg', mode: 'color', maxColors: 12, threshold: 128, ignoreWhite: false,
  })),
  activeDocVectorize.jsx,
  'LOCKSTEP: bridge vectorize jsx (omitted image → front-document trace) is byte-identical with the pure module',
);

// Arrange composes the prelude with the guarded expectedDocumentName (it mutates
// the OPEN document), so the bridge check mirrors the exact document name the
// pure build used. sendBackward exercises the default enum branch.
assert.equal(
  composeBridgeJsx('brand "kit".ai', bridgeFns.illustratorArrangeJsxBody({ direction: 'bringToFront' })),
  bringToFront.jsx,
  'LOCKSTEP: bridge arrange jsx (bringToFront) is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.illustratorArrangeJsxBody({ direction: 'sendBackward' })),
  sendBackward.jsx,
  'LOCKSTEP: bridge arrange jsx (sendBackward → default enum branch) is byte-identical with the pure module',
);

// Add-text mutates the OPEN document, so the bridge check mirrors the exact
// document name + params the pure build used (fill + font present, and the
// defaults path with null fill/font).
assert.equal(
  composeBridgeJsx('brand "kit".ai', bridgeFns.illustratorAddTextJsxBody({
    contents: quotedHeadline, xPt: 72, yPt: 144, sizePt: 48, fillColor: '#ff3300', fontName: 'Helvetica Neue',
  })),
  addText.jsx,
  'LOCKSTEP: bridge add_text jsx (fill + font) is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.illustratorAddTextJsxBody({
    contents: 'Hello', xPt: 0, yPt: 0, sizePt: 24, fillColor: null, fontName: null,
  })),
  addTextDefaults.jsx,
  'LOCKSTEP: bridge add_text jsx (defaults, null fill/font) is byte-identical with the pure module',
);

// Add-shape mutates the OPEN document, so the bridge check mirrors the exact
// document name + geometry the pure build used (rectangle with fill+stroke,
// ellipse with null paints, and the line branch with null fill).
assert.equal(
  composeBridgeJsx('brand "kit".ai', bridgeFns.illustratorAddShapeJsxBody({
    kind: 'rectangle', xPt: 10, yPt: 20, widthPt: 200, heightPt: 100, x1Pt: 0, y1Pt: 0, x2Pt: 0, y2Pt: 0, fillColor: '#ff3300', strokeColor: '#000000', strokeWidthPt: 2,
  })),
  rect.jsx,
  'LOCKSTEP: bridge add_shape jsx (rectangle + fill + stroke) is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.illustratorAddShapeJsxBody({
    kind: 'ellipse', xPt: 0, yPt: 0, widthPt: 50, heightPt: 50, x1Pt: 0, y1Pt: 0, x2Pt: 0, y2Pt: 0, fillColor: null, strokeColor: null, strokeWidthPt: null,
  })),
  ellipse.jsx,
  'LOCKSTEP: bridge add_shape jsx (ellipse, null paints) is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.illustratorAddShapeJsxBody({
    kind: 'line', xPt: 0, yPt: 0, widthPt: 0, heightPt: 0, x1Pt: 5, y1Pt: 6, x2Pt: 105, y2Pt: 6, fillColor: null, strokeColor: '#123456', strokeWidthPt: 0,
  })),
  line.jsx,
  'LOCKSTEP: bridge add_shape jsx (line → setEntirePath, null fill) is byte-identical with the pure module',
);

// Set-appearance mutates the OPEN document's selection, so the bridge check
// mirrors the exact document name + params the pure build used (hex fill +
// stroke + width with a guarded document, and the swatch-only fill path).
assert.equal(
  composeBridgeJsx('brand "kit".ai', bridgeFns.illustratorSetAppearanceJsxBody({
    fillColor: '#ff0000', strokeColor: '#000000', strokeWidthPt: 3, swatchName: null,
  })),
  setAppearanceFill.jsx,
  'LOCKSTEP: bridge set_appearance jsx (fill + stroke + width) is byte-identical with the pure module',
);
assert.equal(
  composeBridgeJsx('', bridgeFns.illustratorSetAppearanceJsxBody({
    fillColor: null, strokeColor: null, strokeWidthPt: null, swatchName: 'Brand Red',
  })),
  setAppearanceSwatch.jsx,
  'LOCKSTEP: bridge set_appearance jsx (swatch-only fill) is byte-identical with the pure module',
);

// The bridge-composed scripts must satisfy the same source-safety contract.
assertNeverTouchesSource(composeBridgeJsx('', bridgeFns.illustratorExportProofJsxBody({
  outputPath: '/tmp/x.png', format: 'png', scalePercent: null,
})), 'bridge-composed export_proof');
assertVectorizeSafety(composeBridgeJsx('', bridgeFns.illustratorVectorizeJsxBody({
  imagePath: '/tmp/x.png', outputPath: '/tmp/x.svg', mode: 'color', maxColors: 6, threshold: 128, ignoreWhite: false,
})), 'bridge-composed vectorize');
assertNeverTouchesSource(composeBridgeJsx('', bridgeFns.illustratorArrangeJsxBody({
  direction: 'bringToFront',
})), 'bridge-composed arrange');
assertNeverTouchesSource(composeBridgeJsx('', bridgeFns.illustratorAddTextJsxBody({
  contents: 'x', xPt: 0, yPt: 0, sizePt: 24, fillColor: '#000000', fontName: null,
})), 'bridge-composed add_text');
assertNeverTouchesSource(composeBridgeJsx('', bridgeFns.illustratorAddShapeJsxBody({
  kind: 'rectangle', xPt: 0, yPt: 0, widthPt: 10, heightPt: 10, x1Pt: 0, y1Pt: 0, x2Pt: 0, y2Pt: 0, fillColor: '#000000', strokeColor: '#ffffff', strokeWidthPt: 1,
})), 'bridge-composed add_shape');
assertNeverTouchesSource(composeBridgeJsx('', bridgeFns.illustratorSetAppearanceJsxBody({
  fillColor: '#000000', strokeColor: '#ffffff', strokeWidthPt: 1, swatchName: null,
})), 'bridge-composed set_appearance');

console.log('All Illustrator ExtendScript adapter smoke cases passed.');
