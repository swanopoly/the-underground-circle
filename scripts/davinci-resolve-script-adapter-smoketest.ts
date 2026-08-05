/**
 * davinci-resolve-script-adapter-smoketest -- the PURE DaVinci Resolve script
 * generator (src/lib/davinciResolveScriptAdapter.ts, plan P5). Load-bearing
 * assertions are the SECURITY BAR that mirrors cadCodeExecutor:
 *   - path allowlist (control / shell-metachar / BMP / ".." traversal reject),
 *   - label allowlist (bounded, no path separators, no metachars, no controls),
 *   - SAFE embed: a value carrying a quote/newline/backslash never breaks out
 *     of its Python string literal (injection rejection at the embed layer),
 *   - bounds (media-file cap), operation gate, script-shape pins, and that
 *     degenerate input NEVER throws.
 *
 * Pure -- loads under tsx (davinciResolveScriptAdapter has zero imports).
 * Source is kept pure-ASCII (control chars / non-ASCII are written as escapes)
 * so esbuild/tsx never trips on a raw byte.
 *
 * Run: npm run smoke:davinci-resolve-script-adapter
 */

import {
  DAVINCI_RESOLVE_OPERATIONS,
  DAVINCI_TIMELINE_EXPORT_FORMATS,
  DAVINCI_MEDIA_EXTENSIONS,
  DAVINCI_RESOLVE_DONE_SENTINEL,
  DAVINCI_RESOLVE_ERROR_SENTINEL,
  DAVINCI_RESOLVE_JSON_SENTINEL,
  isDavinciResolveOperation,
  validateResolvePath,
  validateResolveLabel,
  validateDavinciResolveArgs,
  buildDavinciResolveScript,
  describeDavinciResolveOperation,
} from '../src/lib/davinciResolveScriptAdapter';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const BEL = '\x07'; // a raw C0 control char, written as an escape
const EURO_E = '\u00e9'; // 'e' with acute accent -- a BMP non-ASCII char

/** The emitted script must be pure ASCII (printable + tab/newline only). */
function scriptIsAscii(python: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x09\x0a\x20-\x7e]*$/.test(python);
}

function main(): void {
  // (1) surface constants
  assertEq(DAVINCI_RESOLVE_OPERATIONS.length, 3, '(1) three operations');
  assert(
    ['render_project', 'import_media', 'export_timeline'].every((o) => (DAVINCI_RESOLVE_OPERATIONS as readonly string[]).includes(o)),
    '(1) operation set is exactly the documented three',
  );
  assert(DAVINCI_TIMELINE_EXPORT_FORMATS.length >= 3, '(1) export formats present');
  assert(DAVINCI_MEDIA_EXTENSIONS.includes('mov') && DAVINCI_MEDIA_EXTENSIONS.includes('mp4'), '(1) media allowlist has common video');
  assert(isDavinciResolveOperation('render_project') && !isDavinciResolveOperation('delete_project'), '(1) operation guard');

  // (2) PATH SAFETY -- the core (mirror cadCodeExecutor)
  const badPaths: Array<[string, string]> = [
    ['/media/../../etc/passwd.mov', 'traversal ..'],
    ['/media/a;rm -rf ~.mov', 'shell metachar ;'],
    ['/media/`whoami`.mov', 'backtick'],
    ['/media/$(id).mov', 'command sub $'],
    ['/media/a|b.mov', 'pipe'],
    ['/media/a>b.mov', 'redirect out'],
    ['/media/a<b.mov', 'redirect in'],
    ['/media/a&b.mov', 'ampersand'],
    ['/media/a\nb.mov', 'newline'],
    [`/media/a${BEL}.mov`, 'control char'],
    ['/media/\u{1F600}.mov', 'non-BMP'],
  ];
  for (const [p, why] of badPaths) {
    assertEq(validateResolvePath(p).ok, false, `(2) reject path: ${why}`);
  }
  assertEq(validateResolvePath('/media/' + 'a'.repeat(1100) + '.mov').ok, false, '(2) reject >1024 path');
  assertEq(validateResolvePath('').ok, false, '(2) reject empty path');
  assertEq(validateResolvePath(42 as unknown).ok, false, '(2) reject non-string path');
  assert(validateResolvePath('/Users/x/media/clip.mov').ok, '(2) accept clean absolute path');

  // (3) LABEL SAFETY -- allowlist for filename / preset / timeline names
  const badLabels: Array<[unknown, string]> = [
    ['', 'empty'],
    ['a/b', 'path separator /'],
    ['a\\b', 'path separator \\'],
    ['a\nb', 'newline'],
    [`a${BEL}b`, 'control char'],
    ['a`b', 'backtick'],
    ['a$b', 'dollar'],
    ['a;b', 'semicolon'],
    ['a|b', 'pipe'],
    ['a&b', 'ampersand'],
    ['\u{1F600}name', 'non-BMP'],
    ['x'.repeat(300), 'over-length'],
    [123 as unknown, 'non-string'],
  ];
  for (const [v, why] of badLabels) {
    assertEq(validateResolveLabel(v, 'customName').ok, false, `(3) reject label: ${why}`);
  }
  assert(validateResolveLabel('My Render v2', 'customName').ok, '(3) accept a normal label with spaces');
  assert(validateResolveLabel('H.264 Master', 'renderPreset').ok, '(3) accept a preset name with dots');

  // (4) SAFE EMBED -- injection rejection at the literal boundary.
  // TWO complementary layers:
  //  (a) shell metachars in a label (";", "$", "|", "&", "<", ">", "`") are
  //      REJECTED outright by the allowlist -- a classic RCE payload never even
  //      reaches the escaper.
  assertEq(validateResolveLabel('evil"); import os; os.system("x', 'customName').ok, false, '(4a) a shell-metachar breakout payload is REJECTED by the label allowlist');
  //  (b) a value that IS allowed but contains a plain double-quote (not a
  //      metachar in our reject-set) must be SAFELY ESCAPED by the escaper, so
  //      it can never break out of the surrounding Python string literal.
  const injectionLabel = 'evil" then more';
  assertEq(validateResolveLabel(injectionLabel, 'customName').ok, true, '(4b) a quote-bearing label (no metachar/separator) is allowed -- must be ESCAPED not rejected');
  const injBuild = buildDavinciResolveScript('render_project', {
    renderPreset: 'H264',
    targetDir: '/Users/x/out',
    customName: injectionLabel,
  });
  assert(injBuild.ok, '(4b) build succeeds with a quote-bearing (escaped) label');
  if (injBuild.ok) {
    assert(scriptIsAscii(injBuild.python), '(4b) generated script is pure ASCII');
    // The embedded value appears ONLY as an escaped Python/JSON literal, so the
    // embedded quote sits inside the literal as \" (cannot close it early).
    const literal = JSON.stringify(injectionLabel);
    assert(literal.includes('\\"'), '(4b) escaper turned the embedded quote into \\" (no live breakout)');
    assert(injBuild.python.includes(`CUSTOM_NAME = ${literal}`), '(4b) CUSTOM_NAME assigned the escaped literal verbatim');
    // The raw (unquoted) value must never appear as a bare assignment RHS.
    assert(!injBuild.python.includes('= evil" then'), '(4b) value never appears raw (unescaped) in the script');
  }

  // A path carrying a plain double-quote (a quote is not a shell metachar in
  // our reject-set) must be embedded safely too.
  const quotePath = '/Users/x/o"ut/clip.mov';
  assert(validateResolvePath(quotePath).ok, '(4) a path with a plain double-quote is allowed');
  const quoteBuild = buildDavinciResolveScript('import_media', { mediaPaths: [quotePath] });
  assert(quoteBuild.ok, '(4) build with quote-in-path succeeds');
  if (quoteBuild.ok) {
    assert(scriptIsAscii(quoteBuild.python), '(4) quote-in-path script is pure ASCII');
    assert(quoteBuild.python.includes(JSON.stringify(quotePath)), '(4) quote-in-path embedded as escaped literal');
    assert(quoteBuild.python.includes('o\\"ut'), '(4) embedded quote was backslash-escaped');
  }

  // A value with a NEWLINE must be REJECTED (cannot be represented), proving we
  // never let a real line break into the literal.
  assertEq(validateResolvePath('/Users/x/li\nne.mov').ok, false, '(4) newline in path rejected outright');
  assertEq(validateResolveLabel('li\nne', 'customName').ok, false, '(4) newline in label rejected outright');

  // Non-ASCII (BMP) value -> escaped to \uXXXX; script stays pure ASCII.
  const unicodeName = `caf${EURO_E}`;
  assert(validateResolveLabel(unicodeName, 'customName').ok, '(4) BMP unicode label accepted');
  const uniBuild = buildDavinciResolveScript('export_timeline', {
    format: 'edl',
    targetDir: '/Users/x/out',
    customName: unicodeName,
  });
  assert(uniBuild.ok, '(4) build with unicode name succeeds');
  if (uniBuild.ok) {
    assert(scriptIsAscii(uniBuild.python), '(4) unicode name -> script still pure ASCII (\\uXXXX escape)');
    assert(uniBuild.python.includes('caf\\u00e9'), '(4) non-ASCII char emitted as \\uXXXX');
    assert(!uniBuild.python.includes(unicodeName), '(4) raw non-ASCII char is NOT present');
  }

  // (5) validateDavinciResolveArgs -- per-op contracts
  const rOk = validateDavinciResolveArgs({ operation: 'render_project', renderPreset: 'H264', targetDir: '/Users/x/out/', customName: 'final' });
  assert(rOk.ok, '(5) render args valid');
  if (rOk.ok) assertEq((rOk.validated.values as any).targetDir, '/Users/x/out', '(5) trailing slash trimmed from targetDir');
  assertEq(validateDavinciResolveArgs({ operation: 'render_project', renderPreset: 'a/b', targetDir: '/o', customName: 'x' }).ok, false, '(5) render rejects preset with separator');
  assertEq(validateDavinciResolveArgs({ operation: 'render_project', renderPreset: 'H264', targetDir: '/o/$(x)', customName: 'x' }).ok, false, '(5) render rejects metachar dir');
  assertEq(validateDavinciResolveArgs({ operation: 'render_project', renderPreset: 'H264', targetDir: '/o', customName: 'a/b' }).ok, false, '(5) render rejects filename with separator');

  // import_media: mixed valid/invalid -> drops with notes, keeps valid
  const imp = validateDavinciResolveArgs({
    operation: 'import_media',
    mediaPaths: ['/m/a.mov', '/m/b.txt', '/m/c;rm.mov', '/m/d.mp4'],
  });
  assert(imp.ok, '(5) import valid overall (some kept)');
  if (imp.ok) {
    const kept = (imp.validated.values as any).mediaPaths as string[];
    assertEq(kept.length, 2, '(5) only .mov + .mp4 kept (bad ext + metachar dropped)');
    assert(kept.includes('/m/a.mov') && kept.includes('/m/d.mp4'), '(5) kept the valid media paths');
    assert(imp.validated.notes.some((n) => n.includes('.txt') || n.includes('not an ingestable')), '(5) dropped-bad-ext note present');
    assert(imp.validated.notes.some((n) => n.toLowerCase().includes('metachar') || n.includes('#3')), '(5) dropped-metachar note present');
  }
  assertEq(validateDavinciResolveArgs({ operation: 'import_media', mediaPaths: [] }).ok, false, '(5) import rejects empty list');
  assertEq(validateDavinciResolveArgs({ operation: 'import_media', mediaPaths: ['/m/x.txt'] }).ok, false, '(5) import rejects all-invalid list');

  // export_timeline: format gate + optional timeline name
  assertEq(validateDavinciResolveArgs({ operation: 'export_timeline', format: 'mp4' as any, targetDir: '/o', customName: 'x' }).ok, false, '(5) export rejects unknown format');
  const exp = validateDavinciResolveArgs({ operation: 'export_timeline', format: 'aaf', targetDir: '/o', customName: 'seq', timelineName: 'Act 1' });
  assert(exp.ok, '(5) export valid with timeline name');
  if (exp.ok) assertEq((exp.validated.values as any).timelineName, 'Act 1', '(5) timeline name normalized');
  assertEq(validateDavinciResolveArgs({ operation: 'export_timeline', format: 'aaf', targetDir: '/o', customName: 'seq', timelineName: 'a/b' }).ok, false, '(5) export rejects timeline name with separator');

  // operation gate
  assertEq(validateDavinciResolveArgs({ operation: 'nuke_everything' }).ok, false, '(5) unknown operation rejected');
  assertEq(validateDavinciResolveArgs(null).ok, false, '(5) null input rejected');

  // (6) MEDIA CAP -- bounds
  const many = Array.from({ length: 500 }, (_, i) => `/m/clip${i}.mov`);
  const capped = validateDavinciResolveArgs({ operation: 'import_media', mediaPaths: many });
  assert(capped.ok, '(6) large media list still valid');
  if (capped.ok) {
    const kept = (capped.validated.values as any).mediaPaths as string[];
    assertEq(kept.length, 200, '(6) media list capped at 200');
    assert(capped.validated.notes.some((n) => n.includes('Truncated')), '(6) truncation note present');
  }

  // (7) SCRIPT SHAPE pins + verified gate + writesFiles
  const render = buildDavinciResolveScript('render_project', { renderPreset: 'H264', targetDir: '/Users/x/out', customName: 'final' });
  assert(render.ok, '(7) render script builds');
  if (render.ok) {
    assertEq(render.verifiedInvocation, false, '(7) render carries verifiedInvocation:false (blocks live wiring)');
    assertEq(render.writesFiles, true, '(7) render writesFiles:true (approval + output proof)');
    assert(render.python.includes('GetProjectManager()'), '(7) render walks ProjectManager');
    assert(render.python.includes('LoadRenderPreset'), '(7) render loads a preset');
    assert(render.python.includes('AddRenderJob()') && render.python.includes('StartRendering'), '(7) render adds job + starts render');
    assert(render.python.includes('GetRenderJobStatus'), '(7) render polls job status');
    assert(render.python.includes('# VERIFY') && render.python.includes('DaVinciResolveScript'), '(7) render carries VERIFY header + module ref');
    assert(render.python.includes(DAVINCI_RESOLVE_JSON_SENTINEL) && render.python.includes(DAVINCI_RESOLVE_DONE_SENTINEL), '(7) render prints JSON + DONE sentinels');
    assert(render.python.includes(DAVINCI_RESOLVE_ERROR_SENTINEL + 'resolve_not_running'), '(7) render fails closed with resolve_not_running blocker');
    assert(render.python.includes('scripting_module_not_found'), '(7) render fails closed when module missing');
  }

  const imported = buildDavinciResolveScript('import_media', { mediaPaths: ['/m/a.mov', '/m/b.mp4'] });
  assert(imported.ok, '(7) import script builds');
  if (imported.ok) {
    assertEq(imported.writesFiles, false, '(7) import writesFiles:false (mutates project, not disk)');
    assert(imported.python.includes('AddItemListToMediaPool'), '(7) import uses MediaStorage.AddItemListToMediaPool');
    assert(imported.python.includes('GetMediaStorage()') && imported.python.includes('GetMediaPool()'), '(7) import walks media storage + pool');
    assert(imported.python.includes('os.path.isfile'), '(7) import checks files exist on disk');
    assert(imported.python.includes(JSON.stringify('/m/a.mov')) && imported.python.includes(JSON.stringify('/m/b.mp4')), '(7) import embeds each path as a literal');
  }

  const exported = buildDavinciResolveScript('export_timeline', { format: 'fcpxml', targetDir: '/Users/x/out', customName: 'seq' });
  assert(exported.ok, '(7) export script builds');
  if (exported.ok) {
    assertEq(exported.writesFiles, true, '(7) export writesFiles:true');
    assert(exported.python.includes('timeline.Export('), '(7) export calls Timeline.Export');
    assert(exported.python.includes('getattr(resolve,'), '(7) export resolves the enum by attribute (version-safe)');
    assert(exported.python.includes('seq.fcpxml'), '(7) export output filename = name + format extension');
    assert(exported.python.includes('os.path.isfile(OUTPUT_PATH)'), '(7) export proves the output file exists');
  }
  // AAF export threads a subtype; EDL does not.
  const aaf = buildDavinciResolveScript('export_timeline', { format: 'aaf', targetDir: '/o', customName: 'x' });
  assert(aaf.ok && aaf.python.includes('EXPORT_AAF') && aaf.python.includes('export_subtype = getattr'), '(7) AAF export threads an exportSubtype');
  const edl = buildDavinciResolveScript('export_timeline', { format: 'edl', targetDir: '/o', customName: 'x' });
  assert(edl.ok && edl.python.includes('export_subtype = None'), '(7) EDL export has no subtype');

  // export with explicit timeline name -> selection loop present
  const exportNamed = buildDavinciResolveScript('export_timeline', { format: 'otio', targetDir: '/o', customName: 'x', timelineName: 'Reel 2' });
  assert(exportNamed.ok && exportNamed.python.includes('GetTimelineByIndex') && exportNamed.python.includes('SetCurrentTimeline'), '(7) named export selects the timeline by name');

  // build rejects bad input as a typed error (not a throw, not a script)
  const badBuild = buildDavinciResolveScript('render_project', { renderPreset: 'ok', targetDir: '/o/$(x)', customName: 'x' });
  assertEq(badBuild.ok, false, '(7) build returns typed error on unsafe input');

  // (8) describe (approval preview)
  assert(describeDavinciResolveOperation('render_project', { renderPreset: 'H264' }).includes('Render'), '(8) describe render');
  assert(describeDavinciResolveOperation('import_media', { mediaPaths: ['/m/a.mov'] }).includes('1 media'), '(8) describe import count');
  assert(describeDavinciResolveOperation('export_timeline', { format: 'aaf' }).includes('AAF'), '(8) describe export format');
  assert(describeDavinciResolveOperation('bogus').length > 0, '(8) describe safe on unknown op');

  // (9) DEGENERATE NEVER THROWS
  try {
    validateResolvePath(undefined as unknown);
    validateResolveLabel(undefined as unknown, 'x');
    validateDavinciResolveArgs(undefined);
    validateDavinciResolveArgs({});
    validateDavinciResolveArgs({ operation: 'import_media' });
    buildDavinciResolveScript('render_project' as any, undefined);
    buildDavinciResolveScript('nope' as any, {});
    buildDavinciResolveScript('import_media' as any, { mediaPaths: 'not-an-array' });
    describeDavinciResolveOperation(null);
    describeDavinciResolveOperation('render_project', null);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (9) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll davinci-resolve-script-adapter smoke cases passed (${passes} passed).`);
}

main();
