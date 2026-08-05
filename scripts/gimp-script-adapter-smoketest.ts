/**
 * gimp-script-adapter-smoketest — the PURE GIMP batch-script generator
 * (src/lib/gimpScriptAdapter.ts, plan P6, Substrate A / headless-CLI). The
 * load-bearing assertions are SECURITY: the generated Python-Fu program is
 * passed as ONE argv token to `-b` and then EVAL'd, so a quote or newline in a
 * user value (input/output path, width/height, quality) is Python injection —
 * not a benign string escape. This smoke proves:
 *   - every user value is allowlist-validated and embedded ONLY via a
 *     pythonStringLiteral escaper (never raw-concatenated);
 *   - a concrete quote+newline injection is REJECTED (fail-closed stub, no
 *     `os.system`/`gimp_quit(0)` reaching the program body);
 *   - a legal quote/newline-bearing path is SAFELY escaped, and the assembled
 *     program stays a SINGLE newline-free line (the argv-token invariant);
 *   - dimensions/quality are bounded (out-of-range dropped/rejected, never raw);
 *   - per-op script shape pins (load → flatten/scale → save → verify);
 *   - the engine-descriptor request shape (id 'gimp', cross, -b buildArgs,
 *     verifiedInvocation:false);
 *   - degenerate inputs never throw.
 *
 * Run: npx tsx scripts/gimp-script-adapter-smoketest.ts
 *
 * Pure — gimpScriptAdapter has zero runtime imports (import type only).
 */

import {
  buildGimpScript,
  describeGimpInstallGuidance,
  describeGimpOperation,
  GIMP_ENGINE_DESCRIPTOR_REQUEST,
  GIMP_EXPORT_FORMATS,
  GIMP_INPUT_EXTENSIONS,
  GIMP_OPERATIONS,
  GIMP_SCRIPT_EXTENSION,
  validateGimpArgs,
} from '../src/lib/gimpScriptAdapter';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}

// A generated program must be a SINGLE line (no real newline) so it survives as
// one `-b` argv token — the whole GIMP-specific security invariant.
function isSingleLine(program: string): boolean {
  // eslint-disable-next-line no-control-regex
  return program.length > 0 && !/[\r\n]/.test(program) && !/[\x00-\x08\x0b-\x1f]/.test(program);
}

function main(): void {
  // ─── (0) constants + engine descriptor request pins ───────────────────────
  assert(GIMP_OPERATIONS.length === 3, '(0) three operations', JSON.stringify(GIMP_OPERATIONS));
  assert(GIMP_SCRIPT_EXTENSION === 'py', '(0) script extension is py');
  assert(GIMP_EXPORT_FORMATS.join(',') === 'png,jpg,webp,tiff', '(0) export formats png/jpg/webp/tiff');
  assert(GIMP_INPUT_EXTENSIONS.includes('xcf') && GIMP_INPUT_EXTENSIONS.includes('png'), '(0) inputs include xcf + png');
  {
    const d = GIMP_ENGINE_DESCRIPTOR_REQUEST;
    assert(d.id === 'gimp', '(0) descriptor id is gimp');
    assert(d.platform === 'cross', '(0) descriptor platform is cross');
    assert(d.verifiedInvocation === false, '(0) descriptor verifiedInvocation is FALSE (unverified)');
    assert(d.sourceExtensions.includes('py'), '(0) descriptor sourceExtensions includes py');
    assert(d.outputExtensions.includes('png') && d.outputExtensions.includes('webp'), '(0) descriptor outputExtensions cover raster formats');
    assert(/-b/.test(d.buildArgsShape) && /python-fu-eval/.test(d.buildArgsShape), '(0) buildArgs shape passes program via -b python-fu-eval');
    assert(/pdb\.gimp_quit\(1\)/.test(d.buildArgsShape), '(0) buildArgs shape ends with a second -b gimp_quit(1)');
    assert(d.binaryCandidates.some((b) => b.includes('GIMP.app')) && d.binaryCandidates.some((b) => b.includes('homebrew')), '(0) fixed binary candidates (GIMP.app + homebrew), never PATH');
    assert(d.installHint.includes('brew install --cask gimp'), '(0) install hint carries the brew command');
  }

  // ─── (1) convert_format happy path + script shape ─────────────────────────
  {
    const built = buildGimpScript('convert_format', { inputPath: '/Users/demo/Pics/my shot.xcf', outputPath: '/Users/demo/out/my shot.png' });
    assert(built.ok === true, '(1) convert_format builds ok');
    assert(built.scriptExtension === 'py', '(1) scriptExtension is py');
    assert(built.outputHint === '/Users/demo/out/my shot.png', '(1) outputHint is the PNG path');
    assert(isSingleLine(built.script), '(1) program is a single newline-free line (argv-token invariant)');
    // Paths embedded ONLY as escaped literals (JSON repr), never raw.
    assert(built.script.includes(JSON.stringify('/Users/demo/Pics/my shot.xcf')), '(1) input path embedded as escaped literal');
    assert(built.script.includes(JSON.stringify('/Users/demo/out/my shot.png')), '(1) output path embedded as escaped literal');
    // Documented 2.10 shape: load → flatten → png save → verify.
    assert(built.script.includes('pdb.gimp_file_load('), '(1) loads via pdb.gimp_file_load');
    assert(built.script.includes('pdb.gimp_image_flatten('), '(1) flattens before export');
    assert(built.script.includes('pdb.file_png_save('), '(1) PNG output uses file_png_save');
    assert(built.script.includes('UC_GIMP_DONE'), '(1) prints a done sentinel for proof');
    assert(built.script.includes(';'), '(1) statements are ;-joined (single-line program)');
  }

  // ─── (2) THE INJECTION CASE: quote+newline in path = Python injection ──────
  // The whole point. A path that closes the Python string, then adds a
  // destructive statement, would — if raw-concatenated — become executable
  // Python inside the eval'd -b token. It must be REJECTED, fail-closed.
  {
    const evil = '/Users/demo/out.png" ; __import__("os").system("rm -rf ~") ; pdb.gimp_quit(0) #';
    const built = buildGimpScript('convert_format', { inputPath: '/Users/demo/a.xcf', outputPath: evil });
    assert(built.ok === false, '(2) quote/newline-injected outputPath is REJECTED (ok:false)');
    assert(built.notes.some((n) => /metacharacter|control|outputPath/i.test(n)), '(2) rejection is explained in notes');
    // Belt+suspenders: the injected payload never reaches the program body.
    assert(!/os"\)\.system|rm -rf|gimp_quit\(0\)/.test(built.script), '(2) injected os.system / rm -rf / gimp_quit(0) never reaches the program');
    // The fail-closed stub still parses as a single-line program that only raises.
    assert(isSingleLine(built.script) && /raise Exception\(/.test(built.script), '(2) fail-closed stub is a single-line raise, mutating nothing');

    // A literal-newline injection in the INPUT path is likewise rejected.
    const evilNewline = '/Users/demo/a.xcf"\npdb.gimp_quit(0)\n#.xcf';
    const built2 = buildGimpScript('convert_format', { inputPath: evilNewline, outputPath: '/Users/demo/out.png' });
    assert(built2.ok === false, '(2) newline-injected inputPath is REJECTED');
    assert(!built2.script.includes('gimp_quit(0)'), '(2) newline-injected gimp_quit(0) never reaches the program');
  }

  // ─── (3) per-field path metachar rejection matrix ─────────────────────────
  {
    const hostile: Array<[string, string]> = [
      ['/p/a`whoami`.png', 'backtick'],
      ['/p/$(id).png', 'command substitution'],
      ['/p/a;b.png', 'semicolon'],
      ['/p/a|b.png', 'pipe'],
      ['/p/a&b.png', 'ampersand'],
      ['/p/a>b.png', 'redirect >'],
      ['/p/a<b.png', 'redirect <'],
      ['/p/a.png', 'control char (BEL)'],
      ['/p/../../etc/x.png', 'parent traversal'],
      ['/p/emoji-\u{1F600}.png', 'non-BMP code point'],
    ];
    for (const [p, why] of hostile) {
      const asOutput = buildGimpScript('convert_format', { inputPath: '/p/ok.xcf', outputPath: p });
      assert(asOutput.ok === false, `(3) reject outputPath: ${why}`, JSON.stringify(asOutput.script.slice(0, 60)));
      const asInput = buildGimpScript('convert_format', { inputPath: p.replace(/\.png$/, '.xcf'), outputPath: '/p/ok.png' });
      assert(asInput.ok === false, `(3) reject inputPath: ${why}`);
    }
    const long = buildGimpScript('convert_format', { inputPath: '/p/ok.xcf', outputPath: '/p/' + 'a'.repeat(1100) + '.png' });
    assert(long.ok === false, '(3) reject >1024-char path');
  }

  // ─── (4) SAFE EMBED: legal quote/backslash path is escaped, single-line ────
  // A double quote is NOT a shell metachar in our reject-set, so a path may
  // legitimately contain one; it must be JSON-escaped (never raw) and the
  // program must remain a single argv-safe line.
  {
    const tricky = '/Users/demo/say "hi"\\shot.png'; // embedded " and backslash
    const built = buildGimpScript('convert_format', { inputPath: '/p/ok.xcf', outputPath: tricky });
    assert(built.ok === true, '(4) path with double-quote + backslash still builds');
    assert(built.script.includes(JSON.stringify(tricky)), '(4) quotes/backslashes escaped via JSON repr, never raw');
    assert(!built.script.includes(`= "${tricky}"`), '(4) raw unescaped interpolation never happens');
    assert(isSingleLine(built.script), '(4) escaped-quote program is still a single newline-free line');
    // Sanity: the escaped literal itself contains \" and \\ (two-char escapes),
    // so no real quote/backslash breaks the eval'd token.
    assert(built.script.includes('\\"') && built.script.includes('\\\\'), '(4) escaped literal uses \\" and \\\\ (two-char escapes)');
  }

  // ─── (5) format resolution + mismatch/extension rules ─────────────────────
  {
    // Extension implies format.
    const jpg = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.jpg' });
    assert(jpg.ok && jpg.script.includes('pdb.file_jpeg_save('), '(5) .jpg output → file_jpeg_save');
    const jpeg = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.jpeg' });
    assert(jpeg.ok && jpeg.script.includes('pdb.file_jpeg_save('), '(5) .jpeg alias → file_jpeg_save');
    const webp = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.webp' });
    assert(webp.ok && webp.script.includes('pdb.file_webp_save('), '(5) .webp output → file_webp_save');
    const tiff = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.tiff' });
    assert(tiff.ok && tiff.script.includes('pdb.file_tiff_save('), '(5) .tiff output → file_tiff_save');
    const tif = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.tif' });
    assert(tif.ok && tif.script.includes('pdb.file_tiff_save('), '(5) .tif alias → file_tiff_save');
    // Unknown output extension rejected.
    const bad = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.exe' });
    assert(bad.ok === false && bad.notes.some((n) => /exportable format|\.exe/.test(n)), '(5) unknown output extension rejected');
    // Explicit format that mismatches the output extension is rejected.
    const mismatch = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.png', format: 'jpg' });
    assert(mismatch.ok === false && mismatch.notes.some((n) => /does not match/.test(n)), '(5) format/extension mismatch rejected');
    // Unknown input extension rejected.
    const badIn = buildGimpScript('convert_format', { inputPath: '/p/a.psd', outputPath: '/p/o.png' });
    assert(badIn.ok === false && badIn.notes.some((n) => /not a supported GIMP input/.test(n)), '(5) unsupported input extension rejected');
    // Output must differ from input (never overwrite source in place).
    const same = buildGimpScript('convert_format', { inputPath: '/p/a.png', outputPath: '/p/a.png' });
    assert(same.ok === false && same.notes.some((n) => /read-only|differ/.test(n)), '(5) refuses to overwrite the source in place');
  }

  // ─── (6) resize: dimension bounds + scale-then-flatten shape ──────────────
  {
    const ok = buildGimpScript('resize', { inputPath: '/p/a.xcf', outputPath: '/p/o.png', width: 800, height: 600 });
    assert(ok.ok === true, '(6) resize builds with valid dimensions');
    assert(ok.script.includes('pdb.gimp_image_scale(_img, 800, 600)'), '(6) scale uses the bounded integer dimensions verbatim');
    // scale must come BEFORE flatten (scale all layers, then flatten).
    assert(ok.script.indexOf('gimp_image_scale') < ok.script.indexOf('gimp_image_flatten'), '(6) scale precedes flatten');
    assert(isSingleLine(ok.script), '(6) resize program is a single newline-free line');
    // Dimensions are numeric literals — they can never carry an injected token
    // because boundedInt only ever yields a finite integer.
    assert(/gimp_image_scale\(_img, \d+, \d+\)/.test(ok.script), '(6) scale args are pure integer literals');

    // Out-of-range / non-integer / hostile dimensions are rejected, never raw.
    for (const bad of [0, -5, 30_001, 1.5, Number.POSITIVE_INFINITY, Number.NaN, '640; rm -rf ~', '1e5', '0x40']) {
      const r = buildGimpScript('resize', { inputPath: '/p/a.xcf', outputPath: '/p/o.png', width: bad as never, height: 480 });
      assert(r.ok === false, `(6) reject width=${JSON.stringify(bad)}`);
      assert(!/rm -rf|1e5|0x40/.test(r.script), `(6) hostile width string never reaches the program (${JSON.stringify(bad)})`);
    }
    const badH = buildGimpScript('resize', { inputPath: '/p/a.xcf', outputPath: '/p/o.png', width: 640, height: 99999 });
    assert(badH.ok === false && badH.notes.some((n) => /height/.test(n)), '(6) out-of-range height rejected with a note');
    // A resize missing dimensions fails closed (not defaulted to a mutation).
    const noDims = buildGimpScript('resize', { inputPath: '/p/a.xcf', outputPath: '/p/o.png' });
    assert(noDims.ok === false, '(6) resize without width/height fails closed');
  }

  // ─── (7) quality bounds (jpeg/webp) — clamped/dropped, never raw ──────────
  {
    const ok = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.jpg', quality: 80 });
    assert(ok.ok === true, '(7) valid quality accepted');
    // Out-of-range / hostile quality is DROPPED with a note (op still valid,
    // default quality used) — the hostile string never reaches the program.
    const bigQ = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.jpg', quality: 999 });
    assert(bigQ.ok === true && bigQ.notes.some((n) => /quality/i.test(n)), '(7) out-of-range quality dropped with a note (uses default)');
    const evilQ = buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.jpg', quality: '90) ; pdb.gimp_quit(0' as never });
    assert(evilQ.ok === true && evilQ.notes.some((n) => /quality/i.test(n)), '(7) hostile quality string dropped with a note');
    assert(!evilQ.script.includes('gimp_quit(0)'), '(7) hostile quality string never reaches the program');
    assert(isSingleLine(evilQ.script), '(7) program still single-line after quality drop');
  }

  // ─── (8) export_layers_to_png: outputDir + untrusted-name sanitize ────────
  {
    const built = buildGimpScript('export_layers_to_png', { inputPath: '/Users/demo/art.xcf', outputDir: '/Users/demo/layers out/' });
    assert(built.ok === true, '(8) export_layers_to_png builds ok');
    assert(built.outputHint === '/Users/demo/layers out', '(8) outputHint is the dir (trailing slash trimmed)');
    assert(isSingleLine(built.script), '(8) layer-export program is a single newline-free line');
    assert(built.script.includes(JSON.stringify('/Users/demo/art.xcf')), '(8) input embedded as escaped literal');
    assert(built.script.includes(JSON.stringify('/Users/demo/layers out')), '(8) output dir embedded as escaped literal');
    // Untrusted layer names are sanitized IN-Python before becoming filenames.
    assert(built.script.includes("re.sub(r'[^A-Za-z0-9._-]+'"), '(8) layer names sanitized to a safe filename charset inside Python');
    assert(built.script.includes('pdb.gimp_item_get_name('), '(8) reads each layer name from the PDB (untrusted → sanitized)');
    assert(built.script.includes('pdb.file_png_save('), '(8) each layer saved as PNG');
    // Hostile outputDir rejected.
    const bad = buildGimpScript('export_layers_to_png', { inputPath: '/p/a.xcf', outputDir: '/p/out`id`' });
    assert(bad.ok === false, '(8) hostile outputDir rejected');
  }

  // ─── (9) validateGimpArgs gate + ergonomics + describe ────────────────────
  {
    assert(validateGimpArgs('nope', {}).ok === false, '(9) unknown op rejected');
    assert(validateGimpArgs('convert_format', null).ok === false, '(9) null input rejected');
    assert(validateGimpArgs('convert_format', { inputPath: '/p/a.xcf' }).ok === false, '(9) convert without outputPath rejected');
    const good = validateGimpArgs('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.png' });
    assert(good.ok === true, '(9) valid convert accepted');
    // Two-arg vs single-object ergonomics produce identical output.
    const a = buildGimpScript('resize', { inputPath: '/p/a.xcf', outputPath: '/p/o.png', width: 100, height: 100 });
    const b = buildGimpScript({ op: 'resize', inputPath: '/p/a.xcf', outputPath: '/p/o.png', width: 100, height: 100 });
    assert(a.script === b.script, '(9) buildGimpScript(op,input) === build({op,...})');
    // describe never throws + names the operation.
    assert(describeGimpOperation('convert_format', { outputPath: '/p/o.webp' }).includes('WEBP'), '(9) describe names the target format');
    assert(describeGimpOperation('resize', { width: 800, height: 600 }).includes('800x600'), '(9) describe names the resize dims');
    assert(describeGimpOperation('export_layers_to_png', {}).toLowerCase().includes('layer'), '(9) describe names the layer export');
    assert(describeGimpOperation({}).length > 0, '(9) describe safe on empty');
    assert(describeGimpInstallGuidance().includes('brew install --cask gimp'), '(9) install guidance carries the brew command');
  }

  // ─── (10) whole-program invariant: NO generated program has a real newline ─
  {
    const samples = [
      buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.png' }),
      buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.jpg', quality: 70 }),
      buildGimpScript('resize', { inputPath: '/p/a.xcf', outputPath: '/p/o.webp', width: 1920, height: 1080 }),
      buildGimpScript('export_layers_to_png', { inputPath: '/p/a.xcf', outputDir: '/p/out' }),
      buildGimpScript('convert_format', { inputPath: '/p/a.xcf', outputPath: '/p/o.exe' }), // fail-closed stub
    ];
    for (const s of samples) {
      assert(isSingleLine(s.script), '(10) every generated program (incl. fail-closed stub) is a single newline-free argv token');
    }
  }

  // ─── (11) degenerate inputs never throw ───────────────────────────────────
  try {
    buildGimpScript(undefined as never);
    buildGimpScript(null as never);
    buildGimpScript('convert_format');
    buildGimpScript('resize', { inputPath: 42 as never, outputPath: {} as never });
    buildGimpScript('export_layers_to_png', { inputPath: '/p/a.xcf', outputDir: 123 as never });
    buildGimpScript({ op: 'resize', width: 'x' as never });
    validateGimpArgs(undefined, undefined);
    describeGimpOperation(undefined);
    describeGimpOperation('string' as never, []);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (11) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll gimp-script-adapter smoke cases passed (${passes} passed).`);
}

main();
