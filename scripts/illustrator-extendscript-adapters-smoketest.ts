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
  buildIllustratorDocumentStatusJsx,
  buildIllustratorExportProofJsx,
  isIllustratorDocumentStatusReceipt,
  isIllustratorExportProofReceipt,
  validateIllustratorExportProofParams,
  ILLUSTRATOR_MAX_TEXT_FRAMES,
  ILLUSTRATOR_MAX_UPDATE_TEXT_CHARS,
  buildIllustratorTextInventoryJsx,
  buildIllustratorSetLayerStateJsx,
  buildIllustratorUpdateTextLayerJsx,
  normalizeIllustratorTargetName,
  normalizeIllustratorLayerFlag,
  normalizeIllustratorUpdateText,
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

type BridgeJsxFns = {
  illustratorJsxPrelude: (args: { expectedDocumentName: string }) => string;
  illustratorDocumentStatusJsxBody: () => string;
  illustratorExportProofJsxBody: (args: { outputPath: string; format: string; scalePercent: number | null }) => string;
};

const bridgeFns = new Function(`
${extractBridgeConstLine('ILLUSTRATOR_DEFAULT_SCALE_PERCENT')}
${extractBridgeTopLevel('jsxLiteral')}
${extractBridgeTopLevel('illustratorJsxPrelude')}
${extractBridgeTopLevel('illustratorDocumentStatusJsxBody')}
${extractBridgeTopLevel('illustratorExportProofJsxBody')}
return { illustratorJsxPrelude, illustratorDocumentStatusJsxBody, illustratorExportProofJsxBody };
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

// The bridge-composed scripts must satisfy the same source-safety contract.
assertNeverTouchesSource(composeBridgeJsx('', bridgeFns.illustratorExportProofJsxBody({
  outputPath: '/tmp/x.png', format: 'png', scalePercent: null,
})), 'bridge-composed export_proof');


// ── 3) illustrator_text_inventory (READ-ONLY) ───────────────────────────────

const inventory = buildIllustratorTextInventoryJsx({ expectedDocumentName: 'poster "v2".ai' });
assert.deepEqual(inventory.errors, [], 'text inventory builds with no errors');
assert.ok(inventory.jsx.includes('doc.textFrames'), 'inventory reads textFrames');
assert.ok(
  inventory.jsx.includes(String(ILLUSTRATOR_MAX_TEXT_FRAMES)),
  'inventory embeds its frame cap',
);
// The document name is user text and must be embedded as a literal, never
// concatenated — a quote in a filename would otherwise break out of the string.
assert.ok(inventory.jsx.includes(JSON.stringify('poster "v2".ai')), 'inventory embeds doc name safely');
assertNeverTouchesSource(inventory.jsx, 'text_inventory');
// READ-ONLY means read-only: no assignment to contents anywhere.
assert.equal(/\.contents\s*=/.test(inventory.jsx), false, 'inventory never writes contents');

// ── 4) illustrator_set_layer_state ──────────────────────────────────────────

assert.equal(normalizeIllustratorTargetName('   ').ok, false, 'blank layer name is rejected');
assert.equal(normalizeIllustratorTargetName('x'.repeat(261)).ok, false, 'over-long name rejected');
assert.equal(normalizeIllustratorTargetName('Headline').ok, true, 'ordinary layer name accepted');
assert.equal(normalizeIllustratorLayerFlag(undefined, 'visible').ok, true, 'omitted flag is allowed');
assert.deepEqual(
  normalizeIllustratorLayerFlag(undefined, 'visible'),
  { ok: true, value: null },
  'omitted flag means "do not change"',
);
assert.equal(normalizeIllustratorLayerFlag('true', 'visible').ok, false, 'string flag rejected (fail closed)');

const noOp = buildIllustratorSetLayerStateJsx({ layerName: 'Art' });
assert.equal(noOp.errors.length, 1, 'a call that changes nothing is rejected, not silently absorbed');

const hide = buildIllustratorSetLayerStateJsx({ layerName: 'Guides', visible: false });
assert.deepEqual(hide.errors, [], 'set_layer_state builds with no errors');
assert.ok(hide.jsx.includes('var wantVisible = false'), 'requested visibility is embedded');
assert.ok(hide.jsx.includes('var wantLocked = null'), 'untouched dimension stays null');
assert.ok(hide.jsx.includes('layer_ambiguous'), 'duplicate layer names fail closed');
assert.ok(hide.jsx.includes('layer_not_found'), 'a missing layer fails closed');
// Proof must come from the re-read after-state, not from "we ran the write".
assert.ok(hide.jsx.includes('not_applied'), 'a refused write reports not_applied');
assertNeverTouchesSource(hide.jsx, 'set_layer_state');

// Unlock-before-visibility ordering: Illustrator rejects visibility writes on a
// locked layer, so a naive order reports success while changing nothing.
const unlockIdx = hide.jsx.indexOf('wantLocked === false');
const visibleIdx = hide.jsx.indexOf('wantVisible !== null');
const lockIdx = hide.jsx.indexOf('wantLocked === true');
assert.ok(unlockIdx < visibleIdx && visibleIdx < lockIdx, 'unlock -> visibility -> lock ordering is preserved');

// ── 5) illustrator_update_text_layer ────────────────────────────────────────

assert.equal(normalizeIllustratorUpdateText(42 as unknown).ok, false, 'non-string copy rejected');
assert.equal(
  normalizeIllustratorUpdateText('x'.repeat(ILLUSTRATOR_MAX_UPDATE_TEXT_CHARS + 1)).ok,
  false,
  'over-long copy rejected',
);
assert.equal(normalizeIllustratorUpdateText('').ok, true, 'empty copy is allowed (clearing a frame)');

const update = buildIllustratorUpdateTextLayerJsx({ target: 'Headline', text: 'Spring "Sale" — 40% off' });
assert.deepEqual(update.errors, [], 'update_text_layer builds with no errors');
assert.ok(
  update.jsx.includes(JSON.stringify('Spring "Sale" — 40% off')),
  'copy is embedded as a literal so quotes cannot escape',
);
assert.ok(update.jsx.includes('target_ambiguous'), 'ambiguous targets fail closed');
assert.ok(update.jsx.includes('target_locked'), 'a locked frame is refused, not silently swallowed');
assert.ok(update.jsx.includes('target_hidden'), 'a hidden frame is refused');
assert.ok(update.jsx.includes('confirmed === nextText'), 'success requires re-reading the same frame');
assertNeverTouchesSource(update.jsx, 'update_text_layer');

// The whole point of this lane: it edits copy but never persists the file.
for (const [label, built] of [
  ['text_inventory', inventory],
  ['set_layer_state', hide],
  ['update_text_layer', update],
] as const) {
  assert.equal(/app\.quit/.test(built.jsx), false, `${label}: never quits Illustrator`);
  assert.ok(built.jsx.includes('document_mismatch'), `${label}: wrong open document fails closed`);
}

console.log('All Illustrator ExtendScript adapter smoke cases passed.');
