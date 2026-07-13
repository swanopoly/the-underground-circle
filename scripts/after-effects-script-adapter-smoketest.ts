/**
 * after-effects-script-adapter-smoketest — the PURE After Effects generator
 * (src/lib/afterEffectsScriptAdapter.ts, plan P5). Two headless surfaces:
 *   (1) aerender CLI render → a validated argv token vector, and
 *   (2) JSX ExtendScript setup ops (set_comp_setting / add_to_render_queue /
 *       set_render_settings) → a .jsx body.
 *
 * The load-bearing assertions are SECURITY. For aerender: every user value is
 * allowlist-validated and becomes a SINGLE argv token (paths CAD-validated, comp
 * name a label allowlist, frames bounded ints), and a hostile comp/path is
 * REJECTED (empty args). For JSX: user values are embedded ONLY through the ES3
 * escaper and a comp name with a quote/newline is refused rather than escaped —
 * so it can never break out of its string literal into executable ExtendScript.
 * Plus both-path shape pins, bounds, verifiedInvocation:false, and
 * degenerate-never-throws.
 *
 * Run: npx tsx scripts/after-effects-script-adapter-smoketest.ts
 *
 * Pure — afterEffectsScriptAdapter has zero runtime imports (import type only).
 */

import {
  AFTER_EFFECTS_COMP_SETTING_KEYS,
  AFTER_EFFECTS_MAX_FRAME,
  AFTER_EFFECTS_PROJECT_EXTENSIONS,
  AFTER_EFFECTS_RENDER_ENGINE,
  AFTER_EFFECTS_RENDER_ENGINE_DESCRIPTOR,
  AFTER_EFFECTS_SCRIPT_EXTENSION,
  AFTER_EFFECTS_SCRIPT_OPERATIONS,
  buildAfterEffectsRender,
  buildAfterEffectsScript,
  describeAfterEffectsOperation,
  extendScriptStringLiteral,
  validateAfterEffectsArgs,
  validateAfterEffectsFrame,
  validateAfterEffectsLabel,
  validateAfterEffectsScriptLabel,
} from '../src/lib/afterEffectsScriptAdapter';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}

// Return the argv value that immediately FOLLOWS a given flag (or undefined).
function argAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(): void {
  // ─── (0) constants + surface identifiers ──────────────────────────────────
  assert(AFTER_EFFECTS_RENDER_ENGINE === 'aerender', '(0) render engine id is aerender');
  assert(AFTER_EFFECTS_SCRIPT_EXTENSION === 'jsx', '(0) script extension is jsx');
  assert(AFTER_EFFECTS_PROJECT_EXTENSIONS.includes('aep'), '(0) project extensions include aep');
  assert(AFTER_EFFECTS_SCRIPT_OPERATIONS.length === 3, '(0) three JSX operations', JSON.stringify(AFTER_EFFECTS_SCRIPT_OPERATIONS));
  assert(AFTER_EFFECTS_COMP_SETTING_KEYS.length === 3, '(0) three comp-setting keys');

  // ─── (1) aerender happy path + argv shape + single-token embedding ────────
  {
    const built = buildAfterEffectsRender({
      projectPath: '/Users/demo/Projects/My Show.aep',
      compName: 'Main Comp',
      outputPath: '/Users/demo/Renders/main out.mov',
      startFrame: 0,
      endFrame: 240,
    });
    assert(built.engine === 'aerender', '(1) engine is aerender');
    assert(built.args.length > 0, '(1) render builds an argv');
    assert(built.verifiedInvocation === false, '(1) verifiedInvocation is false (not verified)');
    assert(built.writesFiles === true, '(1) writesFiles is true (render writes a file)');
    assert(built.outputHint === '/Users/demo/Renders/main out.mov', '(1) outputHint is the output path');
    // The values land as SINGLE tokens immediately after their flags (spaces
    // stay inside the one token — execFile, no shell).
    assert(argAfter(built.args, '-project') === '/Users/demo/Projects/My Show.aep', '(1) -project is the project path as one token');
    assert(argAfter(built.args, '-comp') === 'Main Comp', '(1) -comp is the comp name as one token (space preserved)');
    assert(argAfter(built.args, '-output') === '/Users/demo/Renders/main out.mov', '(1) -output is the output path as one token');
    assert(argAfter(built.args, '-s') === '0', '(1) -s start frame emitted as a digit token');
    assert(argAfter(built.args, '-e') === '240', '(1) -e end frame emitted as a digit token');
    // No token is a merged "flag=value" or split across the shell.
    assert(built.args.every((t) => typeof t === 'string' && t.length > 0), '(1) every argv token is a non-empty string');
  }

  // ─── (2) THE aerender INJECTION CASES ─────────────────────────────────────
  // A comp name / path with a quote or newline must be REJECTED, not escaped —
  // even though execFile makes shell metachars inert, we fail closed so a value
  // can never masquerade as a flag or split a token.
  {
    // Comp name with a double quote.
    const q = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'Main" ; rm -rf ~', outputPath: '/o/out.mov' });
    assert(q.args.length === 0, '(2) comp name with a quote/metachar is REJECTED (empty args)');
    assert(q.notes.some((n) => /metacharacter|aborted/i.test(n)), '(2) comp quote rejection explained in notes');

    // Comp name with a newline (the classic "new command" vector).
    const nl = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'Main\n-output\n/etc/evil.mov', outputPath: '/o/out.mov' });
    assert(nl.args.length === 0, '(2) comp name with a newline is REJECTED');
    assert(!nl.args.includes('/etc/evil.mov'), '(2) injected -output value never reaches the argv');

    // Output path with a shell metachar.
    const meta = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'Main', outputPath: '/o/$(reboot).mov' });
    assert(meta.args.length === 0, '(2) output path with command-substitution is REJECTED');

    // Project path with a backtick.
    const tick = buildAfterEffectsRender({ projectPath: '/p/`whoami`.aep', compName: 'Main', outputPath: '/o/out.mov' });
    assert(tick.args.length === 0, '(2) project path with a backtick is REJECTED');

    // Comp name with a control char (BEL).
    const ctrl = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'Main\x07', outputPath: '/o/out.mov' });
    assert(ctrl.args.length === 0, '(2) comp name with a control char is REJECTED');

    // Path with a parent-dir traversal.
    const trav = buildAfterEffectsRender({ projectPath: '/p/../../etc/x.aep', compName: 'Main', outputPath: '/o/out.mov' });
    assert(trav.args.length === 0, '(2) project path with ".." traversal is REJECTED');

    // Non-BMP code point in the comp name.
    const emoji = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'Main \u{1F600}', outputPath: '/o/out.mov' });
    assert(emoji.args.length === 0, '(2) comp name with a non-BMP code point is REJECTED');
  }

  // ─── (3) aerender project extension + frame-range validation ──────────────
  {
    // Wrong project extension.
    const wrongExt = buildAfterEffectsRender({ projectPath: '/p/x.mov', compName: 'Main', outputPath: '/o/out.mov' });
    assert(wrongExt.args.length === 0 && wrongExt.notes.some((n) => /\.aep/.test(n)), '(3) non-.aep/.aepx project is rejected');
    // .aepx is accepted.
    const aepx = buildAfterEffectsRender({ projectPath: '/p/x.aepx', compName: 'Main', outputPath: '/o/out.mov' });
    assert(aepx.args.length > 0, '(3) .aepx project is accepted');

    // Missing required fields.
    assert(buildAfterEffectsRender({ compName: 'Main', outputPath: '/o/out.mov' }).args.length === 0, '(3) missing projectPath rejected');
    assert(buildAfterEffectsRender({ projectPath: '/p/x.aep', outputPath: '/o/out.mov' }).args.length === 0, '(3) missing compName rejected');
    assert(buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'Main' }).args.length === 0, '(3) missing outputPath rejected');

    // Frame bounds: negative, fractional, numeric-string, over-max all rejected.
    assert(buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'M', outputPath: '/o/o.mov', startFrame: -1 }).args.length === 0, '(3) negative startFrame rejected');
    assert(buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'M', outputPath: '/o/o.mov', endFrame: 1.5 }).args.length === 0, '(3) fractional endFrame rejected');
    assert(buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'M', outputPath: '/o/o.mov', startFrame: '10' as unknown as number }).args.length === 0, '(3) numeric-string startFrame rejected (strict)');
    assert(buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'M', outputPath: '/o/o.mov', endFrame: AFTER_EFFECTS_MAX_FRAME + 1 }).args.length === 0, '(3) over-max endFrame rejected');

    // end < start rejected.
    const backwards = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'M', outputPath: '/o/o.mov', startFrame: 100, endFrame: 10 });
    assert(backwards.args.length === 0 && backwards.notes.some((n) => />=/.test(n)), '(3) endFrame < startFrame rejected');

    // No frame range → no -s/-e flags, and a note explains the default.
    const noRange = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'M', outputPath: '/o/o.mov' });
    assert(!noRange.args.includes('-s') && !noRange.args.includes('-e'), '(3) no frame flags when range omitted');
    assert(noRange.notes.some((n) => /work area|full duration|defaults/i.test(n)), '(3) note explains default render window');

    // Boundary frames validate.
    const boundary = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'M', outputPath: '/o/o.mov', startFrame: 0, endFrame: AFTER_EFFECTS_MAX_FRAME });
    assert(boundary.args.length > 0, '(3) boundary frames 0..MAX validate');
    // start-only is allowed (open-ended render).
    const startOnly = buildAfterEffectsRender({ projectPath: '/p/x.aep', compName: 'M', outputPath: '/o/o.mov', startFrame: 30 });
    assert(startOnly.args.includes('-s') && !startOnly.args.includes('-e'), '(3) start-only frame range allowed');
  }

  // ─── (4) argv invariant: no token has a control char / newline ────────────
  {
    const built = buildAfterEffectsRender({ projectPath: '/p/My Show.aep', compName: 'Comp 01', outputPath: '/o/render final.mov', startFrame: 5, endFrame: 50 });
    for (const token of built.args) {
      // eslint-disable-next-line no-control-regex
      assert(!/[\x00-\x1f\n]/.test(token), '(4) no argv token contains a control char / newline', JSON.stringify(token));
    }
  }

  // ─── (5) JSX set_comp_setting: escaping + fail-closed + single mutation ────
  {
    const quotedComp = 'Hero "Title" Comp';
    const built = buildAfterEffectsScript('set_comp_setting', { compName: quotedComp, setting: 'width', value: 1920 });
    assert(built.script.length > 0, '(5) set_comp_setting builds a jsx');
    assert(built.scriptExtension === 'jsx', '(5) scriptExtension is jsx');
    assert(built.verifiedInvocation === false, '(5) verifiedInvocation false');
    assert(built.mutatesProject === true, '(5) set_comp_setting mutatesProject true');
    assert(built.script.includes('(function () {') && built.script.includes('}());'), '(5) jsx is a self-invoking IIFE');
    // The comp name is embedded through the ES3 escaper: the inner quotes are
    // backslash-escaped, and the RAW unescaped name never appears.
    assert(built.script.includes('var EXPECTED_COMP_NAME = "Hero \\"Title\\" Comp";'), '(5) comp name embedded via ES3 escaper (quotes escaped)');
    assert(!built.script.includes('= "Hero "Title" Comp"'), '(5) raw unescaped comp name never reaches the jsx');
    // Fail-closed comp lookup + exact-name match + comp_not_found.
    assert(built.script.includes('instanceof CompItem') && built.script.includes('=== EXPECTED_COMP_NAME'), '(5) comp lookup is exact-name + CompItem type check');
    assert(built.script.includes('"comp_not_found"'), '(5) fails closed with comp_not_found');
    // The value is a plain numeric literal, not user text.
    assert(built.script.includes('var NEW_VALUE = 1920;'), '(5) value embedded as a plain numeric literal');
    assert(built.script.includes('comp[SETTING_PROPERTY] = NEW_VALUE;'), '(5) the ONLY mutation is the single property assignment');
    // NEVER saves the project.
    assert(!/\.save\s*\(/.test(built.script), '(5) jsx never saves the project');
    assert(!/saveWithDialog/i.test(built.script), '(5) jsx never saveWithDialog');
    // Single JSON result line contract.
    assert(built.script.includes('stringifyResult'), '(5) emits a single JSON result line');
  }

  // ─── (6) THE JSX INJECTION CASES: quote NEUTRALIZED, newline/control REFUSED ─
  // Two complementary defenses. (a) A comp name legitimately CAN contain a quote
  // in AE, so the JSX lane ESCAPES it — the `save()` payload becomes inert string
  // CONTENT, never executable code (the escaper is the load-bearing guard here).
  // (b) A newline/control char cannot be represented safely in an ES3 literal, so
  // those are REFUSED (empty script) — fail closed.
  {
    // (a) Quote-injection attempt → escaped, not rejected. The realistic JSX
    // breakout uses a bare `"` to close the literal then `+` to concatenate an
    // expression (no `;` needed — the tight allowlist rejects `;` anyway). After
    // escaping, the payload text survives ONLY as inert CONTENT inside the quoted
    // literal (backslash-escaped quote), never as executable ExtendScript. The
    // escaper is the load-bearing guard here.
    const inj = 'x" + app.project.save() + "';
    const q = buildAfterEffectsScript('set_comp_setting', { compName: inj, setting: 'width', value: 100 });
    assert(q.script.length > 0, '(6a) quote-containing comp name is ACCEPTED (AE allows quotes; escaped, not rejected)');
    // The injected quotes are escaped: the literal contains `\"` not a bare `"`.
    assert(
      q.script.includes('var EXPECTED_COMP_NAME = "x\\" + app.project.save() + \\"";'),
      '(6a) the injected quotes are backslash-escaped inside the literal (payload neutralized)',
    );
    // Critical: the payload never appears as a BARE (unescaped) breakout — i.e.
    // there is no place where a lone `"` closes the literal and app.project.save()
    // runs as a concatenated expression. The only occurrence is `\"`-wrapped.
    assert(!/"x" \+ app\.project\.save\(\) \+ ""/.test(q.script), '(6a) payload never appears as an unescaped/broken-out expression');

    // (b) A newline in the comp name → REFUSED (ES3 literal cannot hold it).
    const nl = buildAfterEffectsScript('set_comp_setting', { compName: 'Main\napp.quit();', setting: 'height', value: 100 });
    assert(nl.script === '', '(6b) comp name with a newline is REJECTED (empty script)');
    assert(!/app\.quit/.test(nl.script), '(6b) injected app.quit() never reaches the jsx');

    // (b) A control char in the comp name → REFUSED.
    const ctrl = buildAfterEffectsScript('set_comp_setting', { compName: 'Main\x07', setting: 'width', value: 100 });
    assert(ctrl.script === '', '(6b) comp name with a control char is REJECTED');

    // (b) A non-BMP code point in the comp name → REFUSED.
    const emoji = buildAfterEffectsScript('set_comp_setting', { compName: 'Main \u{1F600}', setting: 'width', value: 100 });
    assert(emoji.script === '', '(6b) comp name with a non-BMP code point is REJECTED');

    // Escaper unit checks: doubles a lone backslash (so `\"` cannot be forged),
    // fails closed on control/non-BMP.
    assert(extendScriptStringLiteral('a\\b') === '"a\\\\b"', '(6) ES3 escaper doubles a lone backslash');
    assert(extendScriptStringLiteral('he said "hi"') === '"he said \\"hi\\""', '(6) ES3 escaper escapes embedded quotes');
    // The classic backslash-before-quote forge attempt: `\` then `"` must become
    // `\\` then `\"` — NOT `\` + `\"` (which would leave a live closing quote).
    assert(extendScriptStringLiteral('a\\"b') === '"a\\\\\\"b"', '(6) ES3 escaper handles backslash-then-quote (no forged escape)');
    assert(extendScriptStringLiteral('a\x01b') === null, '(6) ES3 escaper returns null on a control char (fail closed)');
    assert(extendScriptStringLiteral('a\u{1F600}b') === null, '(6) ES3 escaper returns null on a non-BMP char');
    // P77: raw U+2028/U+2029 terminate an ES3 string literal → must fail closed.
    assert(extendScriptStringLiteral('a' + String.fromCharCode(0x2028) + 'app.pwned=1') === null, '(6) ES3 escaper rejects U+2028 LINE SEPARATOR (breakout)');
    assert(extendScriptStringLiteral('a' + String.fromCharCode(0x2029) + 'x') === null, '(6) ES3 escaper rejects U+2029 PARAGRAPH SEPARATOR');
  }

  // ─── (7) set_comp_setting value bounds (per-setting) ──────────────────────
  {
    // width/height are integer + bounded 1..30000.
    assert(buildAfterEffectsScript('set_comp_setting', { compName: 'M', setting: 'width', value: 0 }).script === '', '(7) width 0 rejected (below min)');
    assert(buildAfterEffectsScript('set_comp_setting', { compName: 'M', setting: 'width', value: 30001 }).script === '', '(7) width above max rejected');
    assert(buildAfterEffectsScript('set_comp_setting', { compName: 'M', setting: 'height', value: 1080.5 }).script === '', '(7) fractional height rejected (integer-only)');
    assert(buildAfterEffectsScript('set_comp_setting', { compName: 'M', setting: 'width', value: '1920' as unknown as number }).script === '', '(7) numeric-string width rejected (strict number)');
    // frameRate allows fractional (23.976).
    const fps = buildAfterEffectsScript('set_comp_setting', { compName: 'M', setting: 'frameRate', value: 23.976 });
    assert(fps.script.includes('var NEW_VALUE = 23.976;'), '(7) frameRate accepts a fractional value');
    assert(buildAfterEffectsScript('set_comp_setting', { compName: 'M', setting: 'frameRate', value: 0 }).script === '', '(7) frameRate 0 rejected');
    // Unknown setting rejected.
    assert(buildAfterEffectsScript('set_comp_setting', { compName: 'M', setting: 'bgColor' as never, value: 1 }).script === '', '(7) unknown setting rejected');
  }

  // ─── (8) add_to_render_queue + set_render_settings shape + no-save ────────
  {
    const rq = buildAfterEffectsScript('add_to_render_queue', {
      compName: 'Main Comp',
      renderSettingsTemplate: 'Best Settings',
      outputModuleTemplate: 'H.264 - Match Render Settings',
    });
    assert(rq.script.length > 0 && rq.mutatesProject === true, '(8) add_to_render_queue builds + mutatesProject');
    assert(rq.script.includes('app.project.renderQueue') && rq.script.includes('rq.items.add(comp)'), '(8) queues the comp via renderQueue.items.add');
    assert(rq.script.includes('var RENDER_SETTINGS_TEMPLATE = "Best Settings";'), '(8) render-settings template embedded via escaper');
    assert(rq.script.includes('var OUTPUT_MODULE_TEMPLATE = "H.264 - Match Render Settings";'), '(8) output-module template embedded via escaper');
    assert(!/\.save\s*\(/.test(rq.script), '(8) add_to_render_queue never saves the project');
    // Optional templates omitted → null literals, no applyTemplate value leakage.
    const rqBare = buildAfterEffectsScript('add_to_render_queue', { compName: 'Main Comp' });
    assert(rqBare.script.includes('var RENDER_SETTINGS_TEMPLATE = null;'), '(8) omitted render-settings template → null literal');
    assert(rqBare.script.includes('var OUTPUT_MODULE_TEMPLATE = null;'), '(8) omitted output-module template → null literal');
    // A template name with a NEWLINE is rejected at validation (ES3 literal
    // cannot hold it) — the strongest fail-closed case for a template.
    const badTpl = buildAfterEffectsScript('add_to_render_queue', { compName: 'Main', outputModuleTemplate: 'Best\napp.quit();' });
    assert(badTpl.script === '', '(8) newline-bearing output-module template is rejected');
    assert(!/app\.quit/.test(badTpl.script), '(8) injected app.quit() never reaches the jsx');
    // A template name with a quote IS accepted (AE allows it) and escaped inside
    // the literal — proving the template value is neutralized, not raw.
    const quoteTpl = buildAfterEffectsScript('add_to_render_queue', { compName: 'Main', renderSettingsTemplate: 'My "HD" Preset' });
    assert(quoteTpl.script.includes('var RENDER_SETTINGS_TEMPLATE = "My \\"HD\\" Preset";'), '(8) quote in template name is escaped inside the literal');

    const srs = buildAfterEffectsScript('set_render_settings', { compName: 'Main Comp', renderSettingsTemplate: 'Draft Settings' });
    assert(srs.script.length > 0 && srs.mutatesProject === true, '(8) set_render_settings builds + mutatesProject');
    assert(srs.script.includes('applyTemplate(RENDER_SETTINGS_TEMPLATE)'), '(8) applies the template to matching queued items');
    assert(srs.script.includes('"no_matching_queued_items"'), '(8) reports no_matching_queued_items when nothing matches');
    assert(!/\.save\s*\(/.test(srs.script), '(8) set_render_settings never saves the project');
    // Required template missing → rejected.
    assert(buildAfterEffectsScript('set_render_settings', { compName: 'Main' }).script === '', '(8) set_render_settings requires a template');
  }

  // ─── (9) whole-jsx invariant: no stray control chars in any generated body ─
  {
    const samples = [
      buildAfterEffectsScript('set_comp_setting', { compName: 'Comp 01', setting: 'width', value: 1920 }),
      buildAfterEffectsScript('set_comp_setting', { compName: 'Comp 01', setting: 'frameRate', value: 29.97 }),
      buildAfterEffectsScript('add_to_render_queue', { compName: 'Comp 01', renderSettingsTemplate: 'Best Settings' }),
      buildAfterEffectsScript('set_render_settings', { compName: 'Comp 01', renderSettingsTemplate: 'Best Settings' }),
    ];
    for (const s of samples) {
      // Only \n line separators are allowed; no other control chars.
      // eslint-disable-next-line no-control-regex
      assert(!/[\x00-\x09\x0b-\x1f]/.test(s.script), '(9) no stray control chars in generated jsx (only \\n separators)');
    }
  }

  // ─── (10) validateAfterEffectsArgs gate + ergonomics + describe ────────────
  {
    assert(!validateAfterEffectsArgs({ op: 'nope' }).ok, '(10) unknown op rejected');
    assert(!validateAfterEffectsArgs(null).ok, '(10) null rejected');
    assert(!validateAfterEffectsArgs({ op: 'set_comp_setting', setting: 'width', value: 1 }).ok, '(10) set_comp_setting without compName rejected');
    assert(validateAfterEffectsArgs({ op: 'set_comp_setting', compName: 'M', setting: 'width', value: 100 }).ok, '(10) valid set_comp_setting accepted');

    // Two-arg vs one-arg produce identical scripts.
    const a = buildAfterEffectsScript('set_comp_setting', { compName: 'M', setting: 'width', value: 100 });
    const b = buildAfterEffectsScript({ op: 'set_comp_setting', compName: 'M', setting: 'width', value: 100 });
    assert(a.script === b.script, '(10) build(op,input) === build({op,...})');

    // describe: render lane + JSX lane.
    assert(/aerender/i.test(describeAfterEffectsOperation({ render: true, compName: 'Main' })), '(10) describe render lane names aerender');
    assert(/aerender/i.test(describeAfterEffectsOperation({ projectPath: '/p/x.aep', compName: 'Main' })), '(10) describe recognizes render by projectPath');
    assert(/MUTATES/.test(describeAfterEffectsOperation({ op: 'set_comp_setting', compName: 'M', setting: 'width', value: 100 })), '(10) describe flags mutation for set_comp_setting');
    assert(/render queue/i.test(describeAfterEffectsOperation({ op: 'add_to_render_queue', compName: 'M' })), '(10) describe names the render queue op');
    assert(describeAfterEffectsOperation({}).length > 0, '(10) describe safe on empty');
    assert(describeAfterEffectsOperation(undefined).length > 0, '(10) describe safe on undefined');
  }

  // ─── (11) primitive validators (unit) ─────────────────────────────────────
  {
    // Argv-token label (aerender lane): a quote is REJECTED (no token to escape).
    assert(validateAfterEffectsLabel('Main Comp', 'compName').ok, '(11) plain comp name validates (argv label)');
    assert(!validateAfterEffectsLabel('a/b', 'compName').ok, '(11) argv label with a path separator rejected');
    assert(!validateAfterEffectsLabel('a"b', 'compName').ok, '(11) argv label with a quote rejected (no token to escape into)');
    assert(!validateAfterEffectsLabel('', 'compName').ok, '(11) empty comp name rejected');
    assert(!validateAfterEffectsLabel('a'.repeat(300), 'compName').ok, '(11) over-long comp name rejected');
    // String-literal label (JSX lane): a quote is ALLOWED (escaped), but
    // newline/control/path-sep/non-BMP still rejected. This is the key contrast.
    assert(validateAfterEffectsScriptLabel('Hero "Title"', 'compName').ok, '(11) script label ALLOWS a quote (escaped in the literal)');
    assert(!validateAfterEffectsScriptLabel('Main\napp.quit()', 'compName').ok, '(11) script label rejects a newline');
    assert(!validateAfterEffectsScriptLabel('a/b', 'compName').ok, '(11) script label rejects a path separator');
    assert(!validateAfterEffectsScriptLabel('a$b', 'compName').ok, '(11) script label rejects a shell metachar (tight allowlist)');
    const frameNull = validateAfterEffectsFrame(undefined, 'startFrame');
    assert(frameNull.ok && frameNull.value === null, '(11) undefined frame → null (not provided)');
    const frameOk = validateAfterEffectsFrame(42, 'startFrame');
    assert(frameOk.ok && frameOk.value === 42, '(11) integer frame validates');
    assert(!validateAfterEffectsFrame(-1, 'startFrame').ok, '(11) negative frame rejected');
  }

  // ─── (12) appScriptRunner engine descriptor (report-only shape) ───────────
  {
    const d = AFTER_EFFECTS_RENDER_ENGINE_DESCRIPTOR;
    assert(d.id === 'aerender', '(12) descriptor id is aerender');
    assert(d.sourceExtensions.includes('aep') && d.sourceExtensions.includes('aepx'), '(12) descriptor source extensions are aep/aepx');
    assert(Array.isArray(d.outputExtensions) && d.outputExtensions.length === 0, '(12) descriptor output extensions empty (template decides; stat-verified)');
    assert(d.verifiedInvocation === false, '(12) descriptor verifiedInvocation false (not verified)');
    assert(d.maxTimeoutMs > d.defaultTimeoutMs, '(12) descriptor max timeout > default');
  }

  // ─── (13) degenerate inputs never throw ───────────────────────────────────
  try {
    buildAfterEffectsRender(undefined as never);
    buildAfterEffectsRender(null as never);
    buildAfterEffectsRender({});
    buildAfterEffectsRender({ projectPath: 42 as never, compName: {} as never, outputPath: [] as never });
    buildAfterEffectsScript(undefined as never);
    buildAfterEffectsScript(null as never);
    buildAfterEffectsScript('set_comp_setting');
    buildAfterEffectsScript('set_comp_setting', { compName: 42 as never, setting: 'width', value: 'x' as never });
    buildAfterEffectsScript({ op: 'add_to_render_queue' } as never);
    validateAfterEffectsArgs(undefined);
    describeAfterEffectsOperation(undefined);
    describeAfterEffectsOperation('string' as never);
    extendScriptStringLiteral(undefined as never);
    validateAfterEffectsFrame('nope' as never, 'f');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (13) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll after-effects-script-adapter smoke cases passed (${passes} passed).`);
}

main();
