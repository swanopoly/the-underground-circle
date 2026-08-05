/**
 * design-cli-executor-smoketest — verifies the pure planning/validation layer
 * behind local headless design exports (src/lib/designCliExecutor.ts):
 * engine resolution matrix (svg→png/pdf/eps = inkscape, sketch→png =
 * sketchtool, honest unsupported everywhere else incl. the
 * raster→convert_image handoff), strict option validation (injection
 * rejection in dimensions/scales/versions), deterministic plan building,
 * install guidance, bounded export receipts, and the bridge-side LOCKSTEP
 * surface in scripts/claude-bridge.js (fixed binary candidates, fixed argv,
 * failure codes, health capability).
 *
 * Run: npx tsx scripts/design-cli-executor-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildDesignExportPlan,
  buildDesignExportReceipt,
  describeDesignExportInstallGuidance,
  DESIGN_EXPORT_DIMENSION_MAX_PX,
  DESIGN_EXPORT_DIMENSION_MIN_PX,
  INKSCAPE_OUTPUT_EXTENSIONS,
  isAllowedDesignExportDimension,
  isAllowedInkscapePdfVersion,
  isAllowedSketchtoolPreviewScale,
  resolveDesignExportEngine,
  SKETCHTOOL_OUTPUT_EXTENSIONS,
  validateDesignExportOptions,
} from '../src/lib/designCliExecutor';

let failures = 0;
let checks = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  checks += 1;
  if (!condition) fail(message);
}

function deepEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Engine resolution matrix ────────────────────────────────────────────────
{
  expect(resolveDesignExportEngine({ sourceExt: 'svg', outputExt: 'png' }) === 'inkscape', 'svg→png resolves to inkscape');
  expect(resolveDesignExportEngine({ sourceExt: 'svg', outputExt: 'pdf' }) === 'inkscape', 'svg→pdf resolves to inkscape');
  expect(resolveDesignExportEngine({ sourceExt: 'svg', outputExt: 'eps' }) === 'inkscape', 'svg→eps resolves to inkscape');
  expect(resolveDesignExportEngine({ sourceExt: '.SVG', outputExt: '.PNG' }) === 'inkscape', 'dotted/uppercase extensions normalize');
  expect(resolveDesignExportEngine({ sourceExt: 'sketch', outputExt: 'png' }) === 'sketchtool', 'sketch→png resolves to sketchtool');
  const svgToSvg = resolveDesignExportEngine({ sourceExt: 'svg', outputExt: 'svg' });
  expect(typeof svgToSvg === 'object' && svgToSvg.reason === 'inkscape_output_not_supported', 'svg→svg is honestly unsupported (no no-op copy)');
  const svgToJpg = resolveDesignExportEngine({ sourceExt: 'svg', outputExt: 'jpg' });
  expect(typeof svgToJpg === 'object' && svgToJpg.reason === 'inkscape_output_not_supported', 'svg→jpg is unsupported in v1 (png/pdf/eps only)');
  const sketchToPdf = resolveDesignExportEngine({ sourceExt: 'sketch', outputExt: 'pdf' });
  expect(typeof sketchToPdf === 'object' && sketchToPdf.reason === 'sketchtool_output_not_supported', 'sketch→pdf is unsupported (preview lane is png-only)');
  const pngToJpg = resolveDesignExportEngine({ sourceExt: 'png', outputExt: 'jpg' });
  expect(typeof pngToJpg === 'object' && pngToJpg.reason === 'raster_source_use_convert_image', 'raster→raster hands off to desktop.convert_image');
  const heic = resolveDesignExportEngine({ sourceExt: 'heic', outputExt: 'png' });
  expect(typeof heic === 'object' && heic.reason === 'raster_source_use_convert_image', 'heic source hands off to desktop.convert_image');
  const missing = resolveDesignExportEngine({ sourceExt: '', outputExt: 'png' });
  expect(typeof missing === 'object' && missing.reason === 'missing_source_extension', 'missing source extension is named');
  const docx = resolveDesignExportEngine({ sourceExt: 'docx', outputExt: 'png' });
  expect(typeof docx === 'object' && docx.reason === 'unsupported_source_format', 'unknown source format is honestly unsupported');
  pass('engine resolution matrix (inkscape/sketchtool/honest unsupported)');
}

// ── Dimension / scale / version guards (injection surface) ─────────────────
{
  expect(isAllowedDesignExportDimension(800), '800 is a valid dimension');
  expect(isAllowedDesignExportDimension(DESIGN_EXPORT_DIMENSION_MIN_PX), 'min dimension 16 allowed');
  expect(isAllowedDesignExportDimension(DESIGN_EXPORT_DIMENSION_MAX_PX), 'max dimension 16384 allowed');
  expect(!isAllowedDesignExportDimension(15), '15 rejected (below floor)');
  expect(!isAllowedDesignExportDimension(16385), '16385 rejected (above ceiling)');
  expect(!isAllowedDesignExportDimension(800.5), 'fractional dimension rejected');
  expect(!isAllowedDesignExportDimension(-600), 'negative dimension rejected');
  expect(!isAllowedDesignExportDimension(NaN), 'NaN rejected');
  expect(!isAllowedDesignExportDimension('800' as unknown), 'string "800" rejected — no coercion');
  expect(!isAllowedDesignExportDimension('800; rm -rf /' as unknown), 'shell-injection dimension rejected');
  expect(!isAllowedDesignExportDimension('$(reboot)' as unknown), 'subshell-injection dimension rejected');
  expect(isAllowedSketchtoolPreviewScale(2), 'scale 2 allowed');
  expect(!isAllowedSketchtoolPreviewScale(4), 'scale 4 rejected');
  expect(!isAllowedSketchtoolPreviewScale(1.5), 'scale 1.5 rejected');
  expect(!isAllowedSketchtoolPreviewScale('2' as unknown), 'string scale rejected — no coercion');
  expect(isAllowedInkscapePdfVersion('1.7'), 'pdf version 1.7 allowed');
  expect(!isAllowedInkscapePdfVersion('2.0'), 'pdf version 2.0 rejected');
  expect(!isAllowedInkscapePdfVersion('1.4; rm -rf /' as unknown), 'injection pdf version rejected');
  pass('dimension/scale/version guards reject injection and out-of-range values');
}

// ── validateDesignExportOptions (per-engine strict allowlist) ───────────────
{
  const ok = validateDesignExportOptions('inkscape', { widthPx: 1024, heightPx: 768, pdfVersion: '1.5' });
  expect(ok.ok && deepEquals(ok.options, { widthPx: 1024, heightPx: 768, pdfVersion: '1.5' }), 'valid inkscape options pass through');
  expect(validateDesignExportOptions('inkscape', undefined).ok, 'absent options default to {}');
  const empty = validateDesignExportOptions('sketchtool', null);
  expect(empty.ok && deepEquals(empty.options, {}), 'null options default to {}');
  expect(!validateDesignExportOptions('inkscape', [1] as unknown).ok, 'array options rejected');
  expect(!validateDesignExportOptions('inkscape', { widthPx: '900; open -a Calculator' }).ok, 'injection widthPx hard-rejected in options');
  expect(!validateDesignExportOptions('inkscape', { widthPx: 8 }).ok, 'out-of-range widthPx hard-rejected');
  expect(!validateDesignExportOptions('inkscape', { scale: 2 }).ok, 'cross-engine key (scale on inkscape) rejected');
  expect(!validateDesignExportOptions('inkscape', { extraArgs: ['-rf'] } as unknown).ok, 'unknown key rejected');
  expect(!validateDesignExportOptions('inkscape', { pdfVersion: '1.8' }).ok, 'unknown pdf version rejected');
  const sk = validateDesignExportOptions('sketchtool', { format: 'png', scale: 3 });
  expect(sk.ok && deepEquals(sk.options, { format: 'png', scale: 3 }), 'valid sketchtool options pass through');
  expect(!validateDesignExportOptions('sketchtool', { format: 'jpg' }).ok, 'non-png sketchtool format rejected');
  expect(!validateDesignExportOptions('sketchtool', { scale: '3' }).ok, 'string sketchtool scale rejected');
  expect(!validateDesignExportOptions('sketchtool', { widthPx: 800 }).ok, 'cross-engine key (widthPx on sketchtool) rejected');
  pass('option validation is a strict per-engine allowlist');
}

// ── buildDesignExportPlan: inkscape ─────────────────────────────────────────
{
  const plan = buildDesignExportPlan({ sourcePath: '/Users/demo/Desktop/logo.svg', outputKind: 'png', widthPx: 1024 });
  expect(plan.ok, 'svg→png plan builds');
  if (plan.ok) {
    expect(plan.engine === 'inkscape', 'plan engine is inkscape');
    expect(plan.outputPath === '/Users/demo/Desktop/logo.png', `outputPath swaps extension beside the source (got ${plan.outputPath})`);
    expect(plan.options.widthPx === 1024, 'valid widthPx carried into options');
    expect(plan.notes.some((n) => n.includes('design_export')), 'plan notes name the design_export lane');
    expect(plan.notes.some((n) => n.toLowerCase().includes('never overwrite the source')), 'plan notes carry the no-overwrite rule');
  }
  const again = buildDesignExportPlan({ sourcePath: '/Users/demo/Desktop/logo.svg', outputKind: 'png', widthPx: 1024 });
  expect(deepEquals(plan, again), 'plan is deterministic — same inputs, same plan (no Date.now)');
  const injected = buildDesignExportPlan({ sourcePath: '/Users/demo/Desktop/logo.svg', outputKind: 'png', widthPx: '1024; rm -rf /' as unknown as number });
  expect(injected.ok && injected.options.widthPx === undefined, 'injection widthPx dropped from plan options — never coerced');
  expect(injected.ok && injected.notes.some((n) => n.startsWith('Dropped widthPx')), 'dropped widthPx is noted');
  const pdf = buildDesignExportPlan({ sourcePath: '/Users/demo/Desktop/logo.svg', outputKind: 'pdf', widthPx: 1024, scale: 2 });
  expect(pdf.ok && pdf.options.widthPx === undefined, 'widthPx dropped for pdf output (PNG raster sizing only)');
  expect(pdf.ok && pdf.notes.some((n) => n.includes('pdfVersion')), 'pdf plan notes mention the pdfVersion pin');
  expect(pdf.ok && pdf.notes.some((n) => n.includes('sketchtool preview lane only')), 'scale on an inkscape plan is dropped with a note');
  pass('inkscape plans are deterministic, injection-safe, and honestly noted');
}

// ── buildDesignExportPlan: sketchtool ───────────────────────────────────────
{
  const plan = buildDesignExportPlan({ sourcePath: '/Users/demo/Documents/App Design.sketch', outputKind: 'png', scale: 2 });
  expect(plan.ok, 'sketch→png plan builds');
  if (plan.ok) {
    expect(plan.engine === 'sketchtool', 'plan engine is sketchtool');
    expect(plan.outputPath === '/Users/demo/Documents/App Design.png', `sketch outputPath swaps extension (got ${plan.outputPath})`);
    expect(plan.options.format === 'png' && plan.options.scale === 2, 'sketchtool options carry format png + scale');
    expect(plan.notes.some((n) => n.includes('DOCUMENT PREVIEW')), 'plan is honest that v1 is a document preview, not artboards');
    expect(plan.notes.some((n) => n.includes('follow-up')), 'artboard batch export named as a follow-up lane');
    expect(plan.notes.some((n) => n.includes('preview.png')), 'plan explains the preview.png rename contract');
  }
  const dims = buildDesignExportPlan({ sourcePath: '/Users/demo/a.sketch', outputKind: 'png', widthPx: 800, scale: 9 });
  expect(dims.ok && dims.options.scale === undefined, 'invalid scale 9 dropped with note');
  expect(dims.ok && dims.notes.some((n) => n.includes('Dropped widthPx/heightPx')), 'pixel dimensions dropped for the preview lane');
  pass('sketchtool plans are honest about the preview-only v1 contract');
}

// ── buildDesignExportPlan: rejections ───────────────────────────────────────
{
  const metachar = buildDesignExportPlan({ sourcePath: '/tmp/logo.svg; rm -rf ~', outputKind: 'png' });
  expect(!metachar.ok && metachar.reason.includes('shell metacharacter'), 'sourcePath with shell metachar rejected');
  const backtick = buildDesignExportPlan({ sourcePath: '/tmp/`reboot`.svg', outputKind: 'png' });
  expect(!backtick.ok, 'sourcePath with backtick rejected');
  const dollar = buildDesignExportPlan({ sourcePath: '/tmp/$(whoami)/logo.svg', outputKind: 'png' });
  expect(!dollar.ok, 'sourcePath with $() rejected');
  const newline = buildDesignExportPlan({ sourcePath: '/tmp/logo\n.svg', outputKind: 'png' });
  expect(!newline.ok, 'sourcePath with newline rejected');
  const control = buildDesignExportPlan({ sourcePath: '/tmp/logo\x07.svg', outputKind: 'png' });
  expect(!control.ok && control.reason.includes('control characters'), 'sourcePath with control char rejected');
  const long = buildDesignExportPlan({ sourcePath: `/tmp/${'a'.repeat(1100)}.svg`, outputKind: 'png' });
  expect(!long.ok && long.reason.includes('1024'), 'sourcePath >1024 chars rejected');
  const emptyPath = buildDesignExportPlan({ sourcePath: '   ', outputKind: 'png' });
  expect(!emptyPath.ok, 'empty sourcePath rejected');
  const raster = buildDesignExportPlan({ sourcePath: '/tmp/photo.png', outputKind: 'pdf' });
  expect(!raster.ok && raster.reason === 'raster_source_use_convert_image', 'raster source plan fails with the convert_image reason');
  expect(!raster.ok && raster.notes.some((n) => n.includes('desktop.convert_image')), 'raster rejection note names desktop.convert_image');
  const wrongKind = buildDesignExportPlan({ sourcePath: '/tmp/doc.sketch', outputKind: 'eps' });
  expect(!wrongKind.ok && wrongKind.reason === 'sketchtool_output_not_supported', 'sketch→eps plan fails honestly');
  pass('plan builder rejects traversal/injection paths and unsupported pairs');
}

// ── Install guidance ────────────────────────────────────────────────────────
{
  expect(describeDesignExportInstallGuidance('inkscape').includes('brew install --cask inkscape'), 'inkscape guidance names the brew cask');
  expect(describeDesignExportInstallGuidance('sketchtool').includes('sketch.com'), 'sketchtool guidance points at sketch.com');
  expect(describeDesignExportInstallGuidance('sketchtool').toLowerCase().includes('bundles sketchtool'), 'sketchtool guidance explains the app bundle relationship');
  pass('install guidance strings are actionable');
}

// ── buildDesignExportReceipt ────────────────────────────────────────────────
{
  const receipt = buildDesignExportReceipt({
    ok: true,
    engine: 'inkscape',
    binaryPath: '/Applications/Inkscape.app/Contents/MacOS/inkscape',
    exitCode: 0,
    durationMs: 2150,
    stdoutTail: '',
    stderrTail: 'y'.repeat(900),
    output: { path: '/Users/demo/Desktop/logo.png', bytes: 51234, exists: true },
  });
  expect(receipt.engine === 'inkscape' && receipt.exitOk && receipt.outputExists, 'success receipt fields');
  expect(receipt.outputBytes === 51234 && receipt.durationMs === 2150, 'numeric fields carried through');
  expect(receipt.stderrExcerpt.length === 300, 'stderr excerpt capped at 300 chars');
  const failed = buildDesignExportReceipt({ engine: 'sketchtool', exitCode: 1, output: { bytes: -5, exists: false } });
  expect(!failed.exitOk && !failed.outputExists && failed.outputBytes === 0, 'failure receipt: exitOk false, negative bytes clamp to 0');
  const garbage = buildDesignExportReceipt(null);
  expect(garbage.engine === 'unknown' && garbage.outputBytes === 0 && garbage.stderrExcerpt === '', 'null input yields safe defaults, never throws');
  const stringy = buildDesignExportReceipt({ engine: 'x'.repeat(100), durationMs: 1e12, exitCode: '0' });
  expect(stringy.engine.length === 40, 'engine name bounded to 40 chars');
  expect(stringy.durationMs === 86_400_000, 'duration clamped to 24h');
  expect(!stringy.exitOk, 'string exitCode is not treated as success');
  pass('export receipts are bounded and garbage-tolerant');
}

// ── Bridge LOCKSTEP surface (scripts/claude-bridge.js) ─────────────────────
{
  const bridgeSource = readFileSync(path.join(__dirname, 'claude-bridge.js'), 'utf8');
  expect(bridgeSource.includes("'/desktop/design_export'"), 'bridge exposes /desktop/design_export');
  expect(bridgeSource.includes("'/Applications/Inkscape.app/Contents/MacOS/inkscape'"), 'bridge carries the app-bundle inkscape candidate');
  expect(bridgeSource.includes("'/opt/homebrew/bin/inkscape'"), 'bridge carries the homebrew inkscape candidate');
  expect(bridgeSource.includes("'/usr/local/bin/inkscape'"), 'bridge carries the /usr/local inkscape candidate');
  expect(bridgeSource.includes("'/Applications/Sketch.app/Contents/MacOS/sketchtool'"), 'bridge carries the Sketch MacOS sketchtool candidate');
  expect(bridgeSource.includes("'/Applications/Sketch.app/Contents/Resources/sketchtool/bin/sketchtool'"), 'bridge carries the Sketch Resources sketchtool candidate');
  expect(bridgeSource.includes("'--export-filename', outputPath"), 'bridge inkscape argv uses --export-filename <out>');
  expect(bridgeSource.includes("'export', 'preview', sourcePath"), 'bridge sketchtool argv is export preview <doc>');
  expect(bridgeSource.includes("'--overwriting=YES'"), 'bridge sketchtool argv pins --overwriting=YES for deterministic reruns');
  expect(bridgeSource.includes("'--max-size=' + String(2048 * options.scale)"), 'bridge maps scale to --max-size=2048×scale');
  expect(bridgeSource.includes("engine !== 'inkscape' && engine !== 'sketchtool'"), 'bridge engine enum is inkscape|sketchtool');
  expect(bridgeSource.includes("'design_export_timeout'"), 'bridge emits design_export_timeout');
  expect(bridgeSource.includes("'design_export_failed'"), 'bridge emits design_export_failed');
  expect(bridgeSource.includes("'brew install --cask inkscape'"), 'bridge engine_not_installed hint covers inkscape');
  expect(bridgeSource.includes("'Install Sketch from sketch.com'"), 'bridge engine_not_installed hint covers sketchtool');
  expect(bridgeSource.includes("'cad_compile', 'design_export'"), 'health capability list includes design_export');
  expect(bridgeSource.includes('function validateDesignExportOptionsServer'), 'bridge duplicates the options allowlist (LOCKSTEP)');
  pass('bridge LOCKSTEP: fixed binary candidates, fixed argv, codes, health capability');
}

// ── Extension contract exports stay pinned ──────────────────────────────────
{
  expect(deepEquals([...INKSCAPE_OUTPUT_EXTENSIONS], ['png', 'pdf', 'eps']), 'inkscape output set pinned to png/pdf/eps');
  expect(deepEquals([...SKETCHTOOL_OUTPUT_EXTENSIONS], ['png']), 'sketchtool output set pinned to png');
  pass('extension contracts pinned');
}

if (failures > 0) {
  console.error(`\n${failures} design CLI executor smoke failure(s) (${checks} checks)`);
  process.exit(1);
}

console.log(`\nAll design CLI executor smoke cases passed (${checks} checks).`);
