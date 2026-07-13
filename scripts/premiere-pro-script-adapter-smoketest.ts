/**
 * premiere-pro-script-adapter-smoketest — the PURE Premiere Pro generator
 * (src/lib/premiereProScriptAdapter.ts). One surface: JSX ExtendScript ops a
 * resident panel runs INSIDE Premiere:
 *   import_media          → app.project.importFiles([...])
 *   add_to_timeline       → sequence.videoTracks[i].overwriteClip/insertClip
 *   export_sequence       → app.encoder.encodeSequence(...) (AME handoff)
 *   set_sequence_setting  → sequence.getSettings()/setSettings()
 *
 * The load-bearing assertions are SECURITY. Every user value is embedded ONLY
 * through the ES3 escaper (paths/labels) or a bounded numeric literal, so it can
 * never break out of its string literal into executable ExtendScript. A sequence
 * name / path with a quote is ESCAPED (Premiere allows quotes; the payload stays
 * inert CONTENT); a newline / control / non-BMP / traversal / shell-metachar is
 * REFUSED (fail closed). Plus shape pins, bounds, verifiedInvocation:false,
 * no-save invariant, whole-jsx control-char invariant, and never-throws.
 *
 * Run: npx tsx scripts/premiere-pro-script-adapter-smoketest.ts
 *
 * Pure — premiereProScriptAdapter has zero runtime imports (import type only).
 */

import {
  PREMIERE_PRO_BUILDOUT_ROUTE_TOOL,
  PREMIERE_PRO_DOC_VERIFIED_INVOCATION,
  PREMIERE_PRO_MAX_IMPORT_FILES,
  PREMIERE_PRO_MAX_TRACK_INDEX,
  PREMIERE_PRO_OPERATION_GAP_TOOL,
  PREMIERE_PRO_PROJECT_EXTENSIONS,
  PREMIERE_PRO_SCRIPT_EXTENSION,
  PREMIERE_PRO_SCRIPT_OPERATIONS,
  PREMIERE_PRO_SEQUENCE_SETTING_KEYS,
  PREMIERE_PRO_WORK_AREAS,
  buildPremiereProScript,
  describePremiereProOperation,
  extendScriptStringLiteral,
  validatePremiereProArgs,
  validatePremiereProIndex,
  validatePremiereProPath,
  validatePremiereProScriptLabel,
  validatePremiereProTime,
} from '../src/lib/premiereProScriptAdapter';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}

function main(): void {
  // ─── (0) constants + surface identifiers ──────────────────────────────────
  assert(PREMIERE_PRO_SCRIPT_EXTENSION === 'jsx', '(0) script extension is jsx');
  assert(PREMIERE_PRO_PROJECT_EXTENSIONS.includes('prproj'), '(0) project extensions include prproj');
  assert(PREMIERE_PRO_SCRIPT_OPERATIONS.length === 4, '(0) four JSX operations', JSON.stringify(PREMIERE_PRO_SCRIPT_OPERATIONS));
  assert(PREMIERE_PRO_SEQUENCE_SETTING_KEYS.length === 2, '(0) two sequence-setting keys');
  assert(PREMIERE_PRO_WORK_AREAS.length === 3, '(0) three work-area types');
  assert(PREMIERE_PRO_OPERATION_GAP_TOOL === 'desktop.premiere_run_script', '(0) operation-gap tool constant');
  assert(PREMIERE_PRO_BUILDOUT_ROUTE_TOOL === 'agent.build_app_capability', '(0) buildout route tool constant');

  // ─── (1) import_media happy path + array embedding ────────────────────────
  {
    const built = buildPremiereProScript('import_media', {
      mediaPaths: ['/Users/demo/Footage/clip 01.mov', '/Users/demo/Footage/clip 02.mp4'],
    });
    assert(built.script.length > 0, '(1) import_media builds a jsx');
    assert(built.scriptExtension === 'jsx', '(1) scriptExtension is jsx');
    assert(built.verifiedInvocation === false, '(1) verifiedInvocation false (not verified)');
    assert(built.mutatesProject === true, '(1) import_media mutatesProject true');
    assert(built.writesFiles === false, '(1) import_media does not write files');
    assert(built.outputHint === null, '(1) import_media has no outputHint');
    assert(built.script.includes('(function () {') && built.script.includes('}());'), '(1) jsx is a self-invoking IIFE');
    // Each path is embedded as an escaped literal inside the array (spaces preserved).
    assert(built.script.includes('var MEDIA_PATHS = ["/Users/demo/Footage/clip 01.mov", "/Users/demo/Footage/clip 02.mp4"];'), '(1) media paths embedded as an escaped JSX array literal');
    assert(built.script.includes('app.project.importFiles(MEDIA_PATHS'), '(1) calls app.project.importFiles with the array');
    assert(built.script.includes('var SUPPRESS_UI = true;'), '(1) suppressUI defaults true');
    assert(!/\.save\s*\(/.test(built.script), '(1) import_media never saves the project');
    assert(built.script.includes('"no_open_project"'), '(1) fails closed when no project open');
    // suppressUI:false honored.
    const noSuppress = buildPremiereProScript('import_media', { mediaPaths: ['/a/b.mov'], suppressUI: false });
    assert(noSuppress.script.includes('var SUPPRESS_UI = false;'), '(1) suppressUI:false emitted');
  }

  // ─── (2) add_to_timeline happy path + projectItem + placement ─────────────
  {
    const built = buildPremiereProScript('add_to_timeline', {
      sequenceName: 'Main Sequence',
      projectItemName: 'clip 01.mov',
      videoTrackIndex: 0,
      timeSeconds: 12.5,
      placement: 'overwrite',
    });
    assert(built.script.length > 0 && built.mutatesProject === true, '(2) add_to_timeline builds + mutatesProject');
    assert(built.writesFiles === false, '(2) add_to_timeline does not write files');
    assert(built.script.includes('var EXPECTED_SEQUENCE_NAME = "Main Sequence";'), '(2) sequence name embedded via escaper');
    assert(built.script.includes('var TARGET_ITEM_NAME = "clip 01.mov";'), '(2) project item name embedded via escaper');
    assert(built.script.includes('var VIDEO_TRACK_INDEX = 0;'), '(2) track index a plain numeric literal');
    assert(built.script.includes('var PLACEMENT_TIME = 12.5;'), '(2) fractional time preserved as numeric literal');
    assert(built.script.includes('var PLACEMENT_METHOD = "overwriteClip";'), '(2) overwrite maps to overwriteClip');
    assert(built.script.includes('track.overwriteClip(projectItem, PLACEMENT_TIME)'), '(2) calls overwriteClip with the projectItem');
    assert(built.script.includes('findProjectItemByName(TARGET_ITEM_NAME)'), '(2) looks up the project item by exact name');
    assert(built.script.includes('"sequence_not_found"') && built.script.includes('"project_item_not_found"'), '(2) fails closed on sequence/item miss');
    assert(built.script.includes('"video_track_not_found"'), '(2) fails closed on missing video track');
    assert(!/\.save\s*\(/.test(built.script), '(2) add_to_timeline never saves the project');
    // insert placement + default time.
    const ins = buildPremiereProScript('add_to_timeline', { sequenceName: 'S', projectItemName: 'i', videoTrackIndex: 2 });
    assert(ins.script.includes('var PLACEMENT_METHOD = "overwriteClip";'), '(2) placement defaults to overwrite');
    assert(ins.script.includes('var PLACEMENT_TIME = 0;'), '(2) time defaults to 0 (sequence start)');
    const insTrue = buildPremiereProScript('add_to_timeline', { sequenceName: 'S', projectItemName: 'i', videoTrackIndex: 1, placement: 'insert' });
    assert(insTrue.script.includes('var PLACEMENT_METHOD = "insertClip";') && insTrue.script.includes('track.insertClip(projectItem, PLACEMENT_TIME)'), '(2) insert maps to insertClip');
  }

  // ─── (3) export_sequence happy path (AME) ─────────────────────────────────
  {
    const built = buildPremiereProScript('export_sequence', {
      sequenceName: 'Final v3',
      outputPath: '/Users/demo/Exports/final v3.mp4',
      presetPath: '/Users/demo/Presets/H264 High.epr',
      workArea: 'entire',
    });
    assert(built.script.length > 0, '(3) export_sequence builds a jsx');
    assert(built.writesFiles === true, '(3) export_sequence writesFiles true (AME writes a file)');
    assert(built.mutatesProject === false, '(3) export_sequence does not mutate the project');
    assert(built.outputHint === '/Users/demo/Exports/final v3.mp4', '(3) outputHint is the export path');
    assert(built.script.includes('var OUTPUT_PATH = "/Users/demo/Exports/final v3.mp4";'), '(3) output path embedded via escaper');
    assert(built.script.includes('var PRESET_PATH = "/Users/demo/Presets/H264 High.epr";'), '(3) preset path embedded via escaper');
    assert(built.script.includes('var WORK_AREA = 0;'), '(3) work area entire → 0');
    assert(built.script.includes('var REMOVE_ON_COMPLETION = 1;'), '(3) removeOnCompletion defaults 1');
    assert(built.script.includes('app.encoder.encodeSequence(seq, OUTPUT_PATH, PRESET_PATH, WORK_AREA, REMOVE_ON_COMPLETION)'), '(3) calls encodeSequence with validated args');
    assert(built.script.includes('"sequence_not_found"') && built.script.includes('"no_encoder"'), '(3) fails closed on missing sequence/encoder');
    assert(built.script.includes('"encode_sequence_failed"'), '(3) reports encode failure (jobId 0)');
    assert(!/\.save\s*\(/.test(built.script), '(3) export_sequence never saves the project');
    // async note: proof is a file stat, not the job id (across the notes).
    assert(built.notes.some((n) => /file_stat/i.test(n)), '(3) notes require a desktop.file_stat output proof');
    assert(built.notes.some((n) => /ASYNCHRONOUS|finish/i.test(n) && /job id|stat/i.test(n)), '(3) note says export is async → stat the output file, not the job id');
    // work-area variants.
    assert(buildPremiereProScript('export_sequence', { sequenceName: 'S', outputPath: '/o/o.mp4', presetPath: '/p/p.epr', workArea: 'in_to_out' }).script.includes('var WORK_AREA = 1;'), '(3) in_to_out → 1');
    assert(buildPremiereProScript('export_sequence', { sequenceName: 'S', outputPath: '/o/o.mp4', presetPath: '/p/p.epr', workArea: 'work_area' }).script.includes('var WORK_AREA = 2;'), '(3) work_area → 2');
    // removeOnCompletion:false → 0.
    assert(buildPremiereProScript('export_sequence', { sequenceName: 'S', outputPath: '/o/o.mp4', presetPath: '/p/p.epr', removeOnCompletion: false }).script.includes('var REMOVE_ON_COMPLETION = 0;'), '(3) removeOnCompletion:false → 0');
  }

  // ─── (4) set_sequence_setting happy path + single mutation ────────────────
  {
    const built = buildPremiereProScript('set_sequence_setting', { sequenceName: 'Main', setting: 'frameWidth', value: 1920 });
    assert(built.script.length > 0 && built.mutatesProject === true, '(4) set_sequence_setting builds + mutatesProject');
    assert(built.script.includes('var SETTING_PROPERTY = "frameSizeHorizontal";'), '(4) frameWidth maps to frameSizeHorizontal');
    assert(built.script.includes('var NEW_VALUE = 1920;'), '(4) value is a plain numeric literal');
    assert(built.script.includes('seq.getSettings()') && built.script.includes('seq.setSettings(settings)'), '(4) uses getSettings/setSettings round-trip');
    assert(built.script.includes('settings[SETTING_PROPERTY] = NEW_VALUE;'), '(4) the ONLY mutation is the single property assignment');
    assert(built.script.includes('"no_sequence_settings"'), '(4) fails closed if settings unavailable');
    assert(!/\.save\s*\(/.test(built.script), '(4) set_sequence_setting never saves the project');
    const h = buildPremiereProScript('set_sequence_setting', { sequenceName: 'Main', setting: 'frameHeight', value: 1080 });
    assert(h.script.includes('var SETTING_PROPERTY = "frameSizeVertical";'), '(4) frameHeight maps to frameSizeVertical');
  }

  // ─── (5) THE INJECTION CASES: quote NEUTRALIZED, newline/control/etc REFUSED ─
  // (a) A sequence/item/path name legitimately CAN contain a quote, so the JSX
  // lane ESCAPES it — the payload becomes inert string CONTENT, never executable
  // ExtendScript (the escaper is the load-bearing guard). (b) A newline/control/
  // non-BMP/traversal/shell-metachar cannot be represented safely (or is a path
  // attack), so those are REFUSED (empty script) — fail closed.
  {
    // (a) Quote-injection attempt in a sequence name → escaped, not rejected. The
    // realistic JSX breakout closes the literal with `"` then `+` concatenates an
    // expression. After escaping, the payload survives ONLY as inert CONTENT
    // inside the quoted literal (backslash-escaped quote), never executable.
    const injSeq = 'x" + app.project.save() + "';
    const q = buildPremiereProScript('add_to_timeline', { sequenceName: injSeq, projectItemName: 'clip', videoTrackIndex: 0 });
    assert(q.script.length > 0, '(5a) quote-containing sequence name is ACCEPTED (Premiere allows quotes; escaped, not rejected)');
    assert(
      q.script.includes('var EXPECTED_SEQUENCE_NAME = "x\\" + app.project.save() + \\"";'),
      '(5a) the injected quotes are backslash-escaped inside the literal (payload neutralized)',
    );
    // Critical: the payload never appears as an unescaped/broken-out expression.
    assert(!/"x" \+ app\.project\.save\(\) \+ ""/.test(q.script), '(5a) payload never appears as an unescaped/broken-out expression');
    // And the escaped-but-inert form must not have accidentally executed a real save.
    assert(!/\.save\s*\(/.test(q.script.replace(/app\.project\.save\(\) \+ \\"/g, '')), '(5a) no real .save( call slipped into the script');

    // (a) Quote-injection attempt in a MEDIA PATH → still path-validated then
    // escaped. A quote is not a shell metachar, so it survives path validation
    // and lands escaped in the array literal (inert content).
    const injPath = buildPremiereProScript('import_media', { mediaPaths: ['/x/a" + app.project.save() + ".mov'] });
    assert(injPath.script.includes('"/x/a\\" + app.project.save() + \\".mov"'), '(5a) quote in a media path is escaped inside the array literal');

    // (b) A newline in the sequence name → REFUSED (ES3 literal cannot hold it).
    const nl = buildPremiereProScript('add_to_timeline', { sequenceName: 'Main\napp.quit();', projectItemName: 'i', videoTrackIndex: 0 });
    assert(nl.script === '', '(5b) sequence name with a newline is REJECTED (empty script)');
    assert(!/app\.quit/.test(nl.script), '(5b) injected app.quit() never reaches the jsx');

    // (b) A control char in the sequence name → REFUSED.
    const ctrl = buildPremiereProScript('add_to_timeline', { sequenceName: 'Main\x07', projectItemName: 'i', videoTrackIndex: 0 });
    assert(ctrl.script === '', '(5b) sequence name with a control char is REJECTED');

    // (b) A non-BMP code point in the project item name → REFUSED.
    const emoji = buildPremiereProScript('add_to_timeline', { sequenceName: 'Main', projectItemName: 'clip \u{1F600}', videoTrackIndex: 0 });
    assert(emoji.script === '', '(5b) project item name with a non-BMP code point is REJECTED');

    // (b) A shell-metachar / command-substitution in a media path → REFUSED.
    const meta = buildPremiereProScript('import_media', { mediaPaths: ['/x/$(reboot).mov'] });
    assert(meta.script === '', '(5b) media path with command-substitution is REJECTED');
    const tick = buildPremiereProScript('import_media', { mediaPaths: ['/x/`whoami`.mov'] });
    assert(tick.script === '', '(5b) media path with a backtick is REJECTED');

    // (b) A ".." traversal in the output path → REFUSED.
    const trav = buildPremiereProScript('export_sequence', { sequenceName: 'S', outputPath: '/o/../../etc/x.mp4', presetPath: '/p/p.epr' });
    assert(trav.script === '', '(5b) output path with ".." traversal is REJECTED');

    // (b) A newline in the media path → REFUSED (path validator rejects it).
    const nlPath = buildPremiereProScript('import_media', { mediaPaths: ['/x/a\n/etc/evil.mov'] });
    assert(nlPath.script === '', '(5b) media path with a newline is REJECTED');
  }

  // ─── (6) escaper unit checks ──────────────────────────────────────────────
  {
    assert(extendScriptStringLiteral('a\\b') === '"a\\\\b"', '(6) ES3 escaper doubles a lone backslash');
    assert(extendScriptStringLiteral('he said "hi"') === '"he said \\"hi\\""', '(6) ES3 escaper escapes embedded quotes');
    // The classic backslash-before-quote forge: `\` then `"` must become `\\`
    // then `\"` — NOT `\` + `\"` (which would leave a live closing quote).
    assert(extendScriptStringLiteral('a\\"b') === '"a\\\\\\"b"', '(6) ES3 escaper handles backslash-then-quote (no forged escape)');
    assert(extendScriptStringLiteral('a\x01b') === null, '(6) ES3 escaper returns null on a control char (fail closed)');
    assert(extendScriptStringLiteral('a\u{1F600}b') === null, '(6) ES3 escaper returns null on a non-BMP char');
  }

  // ─── (7) param bounds + allowlists ────────────────────────────────────────
  {
    // frame size: integer, bounded 1..16384.
    assert(buildPremiereProScript('set_sequence_setting', { sequenceName: 'M', setting: 'frameWidth', value: 0 }).script === '', '(7) frameWidth 0 rejected (below min)');
    assert(buildPremiereProScript('set_sequence_setting', { sequenceName: 'M', setting: 'frameWidth', value: 16385 }).script === '', '(7) frameWidth above max rejected');
    assert(buildPremiereProScript('set_sequence_setting', { sequenceName: 'M', setting: 'frameHeight', value: 1080.5 }).script === '', '(7) fractional frame size rejected (integer-only)');
    assert(buildPremiereProScript('set_sequence_setting', { sequenceName: 'M', setting: 'frameWidth', value: '1920' as unknown as number }).script === '', '(7) numeric-string frame size rejected (strict number)');
    assert(buildPremiereProScript('set_sequence_setting', { sequenceName: 'M', setting: 'bogus' as never, value: 1 }).script === '', '(7) unknown setting rejected');

    // track index bounds.
    assert(buildPremiereProScript('add_to_timeline', { sequenceName: 'S', projectItemName: 'i', videoTrackIndex: -1 }).script === '', '(7) negative track index rejected');
    assert(buildPremiereProScript('add_to_timeline', { sequenceName: 'S', projectItemName: 'i', videoTrackIndex: 1.5 }).script === '', '(7) fractional track index rejected');
    assert(buildPremiereProScript('add_to_timeline', { sequenceName: 'S', projectItemName: 'i', videoTrackIndex: PREMIERE_PRO_MAX_TRACK_INDEX + 1 }).script === '', '(7) over-max track index rejected');

    // time bounds: negative rejected, fractional allowed.
    assert(buildPremiereProScript('add_to_timeline', { sequenceName: 'S', projectItemName: 'i', videoTrackIndex: 0, timeSeconds: -1 }).script === '', '(7) negative time rejected');
    assert(buildPremiereProScript('add_to_timeline', { sequenceName: 'S', projectItemName: 'i', videoTrackIndex: 0, timeSeconds: '5' as unknown as number }).script === '', '(7) numeric-string time rejected (strict)');

    // import: empty / over-limit arrays rejected.
    assert(buildPremiereProScript('import_media', { mediaPaths: [] }).script === '', '(7) empty mediaPaths rejected');
    assert(buildPremiereProScript('import_media', { mediaPaths: 'x' as unknown as string[] }).script === '', '(7) non-array mediaPaths rejected');
    const tooMany = Array.from({ length: PREMIERE_PRO_MAX_IMPORT_FILES + 1 }, (_v, i) => `/x/${i}.mov`);
    assert(buildPremiereProScript('import_media', { mediaPaths: tooMany }).script === '', '(7) over-limit mediaPaths rejected');
    // If ANY path in the array is bad, the whole import is rejected.
    assert(buildPremiereProScript('import_media', { mediaPaths: ['/ok/a.mov', '/bad/`x`.mov'] }).script === '', '(7) one bad path rejects the whole import array');

    // export: preset must be .epr, output must differ from preset, work area allowlist.
    assert(buildPremiereProScript('export_sequence', { sequenceName: 'S', outputPath: '/o/o.mp4', presetPath: '/p/p.txt' }).script === '', '(7) non-.epr preset rejected');
    assert(buildPremiereProScript('export_sequence', { sequenceName: 'S', outputPath: '/p/same.epr', presetPath: '/p/same.epr' }).script === '', '(7) output === preset rejected');
    assert(buildPremiereProScript('export_sequence', { sequenceName: 'S', outputPath: '/o/o.mp4', presetPath: '/p/p.epr', workArea: 'nope' as never }).script === '', '(7) unknown work area rejected');
  }

  // ─── (8) whole-jsx invariant: no stray control chars in any generated body ─
  {
    const samples = [
      buildPremiereProScript('import_media', { mediaPaths: ['/f/clip 01.mov'] }),
      buildPremiereProScript('add_to_timeline', { sequenceName: 'Seq 01', projectItemName: 'clip 01.mov', videoTrackIndex: 0, timeSeconds: 3.5 }),
      buildPremiereProScript('export_sequence', { sequenceName: 'Seq 01', outputPath: '/o/out.mp4', presetPath: '/p/p.epr' }),
      buildPremiereProScript('set_sequence_setting', { sequenceName: 'Seq 01', setting: 'frameWidth', value: 3840 }),
    ];
    for (const s of samples) {
      // Only \n line separators are allowed; no other control chars.
      // eslint-disable-next-line no-control-regex
      assert(!/[\x00-\x09\x0b-\x1f]/.test(s.script), '(8) no stray control chars in generated jsx (only \\n separators)');
    }
  }

  // ─── (9) validatePremiereProArgs gate + ergonomics + describe ─────────────
  {
    assert(!validatePremiereProArgs({ op: 'nope' }).ok, '(9) unknown op rejected');
    assert(!validatePremiereProArgs(null).ok, '(9) null rejected');
    assert(!validatePremiereProArgs({ op: 'set_sequence_setting', setting: 'frameWidth', value: 1 }).ok, '(9) set_sequence_setting without sequenceName rejected');
    assert(validatePremiereProArgs({ op: 'set_sequence_setting', sequenceName: 'M', setting: 'frameWidth', value: 100 }).ok, '(9) valid set_sequence_setting accepted');

    // Two-arg vs one-arg produce identical scripts.
    const a = buildPremiereProScript('set_sequence_setting', { sequenceName: 'M', setting: 'frameWidth', value: 100 });
    const b = buildPremiereProScript({ op: 'set_sequence_setting', sequenceName: 'M', setting: 'frameWidth', value: 100 });
    assert(a.script === b.script, '(9) build(op,input) === build({op,...})');

    // describe: every op + safe on garbage.
    assert(/import/i.test(describePremiereProOperation({ op: 'import_media', mediaPaths: ['/a/b.mov'] })), '(9) describe names import');
    assert(/MUTATES/.test(describePremiereProOperation({ op: 'add_to_timeline', sequenceName: 'S', projectItemName: 'i', videoTrackIndex: 0 })), '(9) describe flags mutation for add_to_timeline');
    assert(/Media Encoder/i.test(describePremiereProOperation({ op: 'export_sequence', sequenceName: 'S', outputPath: '/o/o.mp4', presetPath: '/p/p.epr' })), '(9) describe names Media Encoder for export');
    assert(/MUTATES/.test(describePremiereProOperation({ op: 'set_sequence_setting', sequenceName: 'S', setting: 'frameWidth', value: 100 })), '(9) describe flags mutation for set_sequence_setting');
    assert(describePremiereProOperation({}).length > 0, '(9) describe safe on empty');
    assert(describePremiereProOperation(undefined).length > 0, '(9) describe safe on undefined');
  }

  // ─── (10) primitive validators (unit) ─────────────────────────────────────
  {
    // Path validator: BMP/traversal/metachar reject; plain path ok.
    assert(validatePremiereProPath('/Users/x/a b.mov', 'p').ok, '(10) plain path validates');
    assert(!validatePremiereProPath('/x/../y.mov', 'p').ok, '(10) traversal path rejected');
    assert(!validatePremiereProPath('/x/$(y).mov', 'p').ok, '(10) command-substitution path rejected');
    assert(!validatePremiereProPath('', 'p').ok, '(10) empty path rejected');
    // Script label: quote ALLOWED (escaped), newline/path-sep/metachar rejected.
    assert(validatePremiereProScriptLabel('Final "v3"', 'seq').ok, '(10) script label ALLOWS a quote (escaped in the literal)');
    assert(!validatePremiereProScriptLabel('Main\napp.quit()', 'seq').ok, '(10) script label rejects a newline');
    assert(!validatePremiereProScriptLabel('a/b', 'seq').ok, '(10) script label rejects a path separator');
    assert(!validatePremiereProScriptLabel('a$b', 'seq').ok, '(10) script label rejects a shell metachar (tight allowlist)');
    // Index: required vs nullable.
    assert(!validatePremiereProIndex(undefined, 'idx', 10).ok, '(10) required index rejects undefined');
    const nullable = validatePremiereProIndex(undefined, 'idx', 10, true);
    assert(nullable.ok && nullable.value === null, '(10) nullable index → null on undefined');
    const idxOk = validatePremiereProIndex(3, 'idx', 10);
    assert(idxOk.ok && idxOk.value === 3, '(10) integer index validates');
    // Time: undefined → 0, fractional ok, negative rejected.
    const t0 = validatePremiereProTime(undefined, 't');
    assert(t0.ok && t0.value === 0, '(10) undefined time → 0');
    const tf = validatePremiereProTime(9.75, 't');
    assert(tf.ok && tf.value === 9.75, '(10) fractional time validates');
    assert(!validatePremiereProTime(-1, 't').ok, '(10) negative time rejected');
  }

  // ─── (11) doc-verified invocation constant (report-only shape) ────────────
  {
    const inv = PREMIERE_PRO_DOC_VERIFIED_INVOCATION;
    assert(inv.surface === 'extendscript_panel', '(11) surface is extendscript_panel');
    assert(inv.verifiedInvocation === false, '(11) verifiedInvocation false (not live-verified)');
    assert(inv.extendScriptStillDocumented === true, '(11) notes ExtendScript is still documented (but frozen)');
    assert(inv.entryPoints.some((e) => /encodeSequence/.test(e)), '(11) entry points include encodeSequence');
    assert(inv.entryPoints.some((e) => /importFiles/.test(e)), '(11) entry points include importFiles');
    assert(inv.docSource.some((u) => /ppro-scripting\.docsforadobe\.dev/.test(u)), '(11) docSource cites the Premiere scripting guide');
    assert(inv.docSource.some((u) => /developer\.adobe\.com\/premiere-pro\/uxp/.test(u)), '(11) docSource cites the UXP reference (go-forward)');
    assert(inv.notes.some((n) => /UXP/.test(n) && /FROZEN|frozen/.test(n)), '(11) notes flag UXP transition + frozen ExtendScript');
  }

  // ─── (12) degenerate inputs never throw ───────────────────────────────────
  try {
    buildPremiereProScript(undefined as never);
    buildPremiereProScript(null as never);
    buildPremiereProScript('import_media');
    buildPremiereProScript('import_media', { mediaPaths: [42, {}, null] as never });
    buildPremiereProScript('add_to_timeline', { sequenceName: 42 as never, projectItemName: [] as never, videoTrackIndex: 'x' as never });
    buildPremiereProScript('export_sequence', { sequenceName: {} as never });
    buildPremiereProScript('set_sequence_setting', { sequenceName: 'M', setting: 'frameWidth', value: 'x' as never });
    buildPremiereProScript({ op: 'add_to_timeline' } as never);
    validatePremiereProArgs(undefined);
    describePremiereProOperation(undefined);
    describePremiereProOperation('string' as never);
    extendScriptStringLiteral(undefined as never);
    validatePremiereProPath(42 as never, 'p');
    validatePremiereProTime('nope' as never, 't');
    validatePremiereProIndex({} as never, 'i', 10);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (12) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll premiere-pro-script-adapter smoke cases passed (${passes} passed).`);
}

main();
