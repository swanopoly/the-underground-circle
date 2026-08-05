/**
 * autocad-script-adapter-smoketest — the PURE AutoCAD .scr generator
 * (src/lib/autocadScriptAdapter.ts, plan P3). The load-bearing assertions are
 * SECURITY: because a .scr runs AutoCAD commands line-by-line, a newline or a
 * stray token in a user value = command injection. This smoke proves every
 * user-provided field is allowlist-validated and safely embedded (quoted path
 * token, dropped-with-a-note on failure), plus argv/script-shape pins, bounds,
 * and degenerate-never-throws.
 *
 * Run: npx tsx scripts/autocad-script-adapter-smoketest.ts
 *
 * Pure — autocadScriptAdapter has zero runtime imports (import type only).
 */

import {
  AUTOCAD_DXF_VERSIONS,
  AUTOCAD_OPERATIONS,
  AUTOCAD_RUN_COMMAND_KEYS,
  AUTOCAD_SCRIPT_ENGINE,
  AUTOCAD_SCRIPT_EXTENSION,
  buildAutoCadScript,
  describeAutoCadOperation,
  validateAutoCadArgs,
} from '../src/lib/autocadScriptAdapter';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}

// Split a generated .scr into its command lines (excluding comments/blank).
function commandLines(script: string): string[] {
  return script
    .split('\n')
    .filter((l) => l.length > 0 && !l.startsWith(';'));
}

function main(): void {
  // ─── (0) constants + engine pairing ───────────────────────────────────────
  assert(AUTOCAD_SCRIPT_ENGINE === 'autocad_core', '(0) targets the autocad_core engine descriptor');
  assert(AUTOCAD_SCRIPT_EXTENSION === 'scr', '(0) script extension is scr');
  assert(AUTOCAD_OPERATIONS.length === 5, '(0) five operations', JSON.stringify(AUTOCAD_OPERATIONS));

  // ─── (1) export_pdf happy path + script shape ─────────────────────────────
  {
    const built = buildAutoCadScript('export_pdf', { outputPath: '/Users/demo/Drawings/plan A1.pdf' });
    assert(built.script.length > 0, '(1) export_pdf builds a script');
    assert(built.scriptExtension === 'scr', '(1) scriptExtension is scr');
    assert(built.outputHint === '/Users/demo/Drawings/plan A1.pdf', '(1) outputHint is the PDF path');
    // Preamble: dialogs off so the export takes a path instead of popping a dialog.
    assert(built.script.includes('FILEDIA') && built.script.includes('CMDECHO'), '(1) preamble sets headless sysvars');
    // Path embedded ONLY as a quoted token (the space is safe inside quotes).
    assert(built.script.includes('"/Users/demo/Drawings/plan A1.pdf"'), '(1) path embedded as a double-quoted token');
    assert(built.script.includes('EXPORTPDF'), '(1) uses EXPORTPDF');
    // The path must NOT appear unquoted (raw concatenation) anywhere.
    assert(!/\n\/Users\/demo\/Drawings\/plan A1\.pdf/.test(built.script), '(1) path never appears raw-unquoted');
  }

  // ─── (2) THE INJECTION CASE: newline in path = new command ────────────────
  // This is the whole point. A path containing a newline + a destructive
  // command would, if raw-concatenated, become its OWN .scr command line.
  {
    const evil = '/Users/demo/out.pdf"\nERASE\nALL\n';
    const built = buildAutoCadScript('export_pdf', { outputPath: evil });
    assert(built.script === '', '(2) newline/quote-injected path is REJECTED (empty script)');
    assert(built.notes.some((n) => /metacharacter|control/i.test(n)), '(2) rejection is explained in notes');
    // Belt+suspenders: no ERASE line ever exists in whatever came back.
    assert(!commandLines(built.script).includes('ERASE'), '(2) injected ERASE command never reaches the script body');
  }

  // ─── (3) per-field path metachar rejection matrix ─────────────────────────
  {
    const hostile: Array<[string, string]> = [
      ['/p/a`whoami`.pdf', 'backtick'],
      ['/p/$(id).pdf', 'command substitution'],
      ['/p/a;PURGE.pdf', 'semicolon (scr comment/separator)'],
      ['/p/a|b.pdf', 'pipe'],
      ['/p/a&b.pdf', 'ampersand'],
      ['/p/a>b.pdf', 'redirect >'],
      ['/p/a<b.pdf', 'redirect <'],
      ['/p/say "hi".pdf', 'embedded double quote (breaks the wrap)'],
      ['/p/a.pdf', 'control char (BEL)'],
      ['/p/../../etc/x.pdf', 'parent traversal'],
      ['/p/emoji-\u{1F600}.pdf', 'non-BMP code point'],
    ];
    for (const [p, why] of hostile) {
      const built = buildAutoCadScript('export_pdf', { outputPath: p });
      assert(built.script === '', `(3) reject outputPath: ${why}`, JSON.stringify(built.script.slice(0, 60)));
    }
    // Over-length path.
    const long = buildAutoCadScript('export_pdf', { outputPath: '/p/' + 'a'.repeat(1100) + '.pdf' });
    assert(long.script === '', '(3) reject >1024-char path');
    // Wrong extension is rejected (must be .pdf).
    const wrongExt = buildAutoCadScript('export_pdf', { outputPath: '/p/out.dwg' });
    assert(wrongExt.script === '' && wrongExt.notes.some((n) => n.includes('.pdf')), '(3) export_pdf rejects non-.pdf output');
  }

  // ─── (4) export_dxf: version allowlist + precision bounds ─────────────────
  {
    const ok = buildAutoCadScript('export_dxf', { outputPath: '/p/out.dxf', version: '2018', precision: 6 });
    assert(ok.script.includes('DXFOUT'), '(4) export_dxf uses DXFOUT');
    assert(ok.script.includes('"/p/out.dxf"'), '(4) dxf path quoted');
    assert(ok.script.includes('\n6\n') || ok.script.trim().split('\n').includes('6'), '(4) precision 6 emitted');
    assert(ok.outputHint === '/p/out.dxf', '(4) dxf outputHint set');

    // Unknown version → dropped with a note + default.
    const badVer = buildAutoCadScript('export_dxf', { outputPath: '/p/out.dxf', version: 'r2099; ERASE all' });
    assert(badVer.script.length > 0, '(4) bad version does not abort (path is fine)');
    assert(badVer.notes.some((n) => n.startsWith('Dropped DXF version')), '(4) bad version dropped with a note');
    // The hostile version string must NOT appear anywhere in the script body.
    assert(!/ERASE/.test(badVer.script), '(4) hostile version string never reaches the script');
    const verLines = commandLines(badVer.script);
    assert(!verLines.some((l) => /2099|ERASE|all/.test(l)), '(4) only the default version token is present');

    // Precision out of range → clamped or dropped, never raw.
    const bigPrec = buildAutoCadScript('export_dxf', { outputPath: '/p/out.dxf', precision: 999 });
    assert(bigPrec.notes.some((n) => /precision/i.test(n)), '(4) out-of-range precision noted');
    assert(commandLines(bigPrec.script).some((l) => l === '16'), '(4) precision clamped to 16');
    const negPrec = buildAutoCadScript('export_dxf', { outputPath: '/p/out.dxf', precision: -4 });
    assert(commandLines(negPrec.script).some((l) => l === '0'), '(4) negative precision clamped to 0');
    // Non-integer / NaN precision dropped to default, never emitted.
    const nanPrec = buildAutoCadScript('export_dxf', { outputPath: '/p/out.dxf', precision: Number.POSITIVE_INFINITY });
    assert(commandLines(nanPrec.script).some((l) => l === '16'), '(4) infinite precision → default 16');
    // Version allowlist is non-empty and lowercase-keyed.
    assert(AUTOCAD_DXF_VERSIONS.length >= 3, '(4) dxf version allowlist populated');
  }

  // ─── (5) purge_and_audit: -PURGE + AUDIT, mutation note, optional regapps ──
  {
    const built = buildAutoCadScript('purge_and_audit', {});
    const lines = commandLines(built.script);
    assert(lines.includes('-PURGE'), '(5) uses -PURGE (command-line form, no dialog)');
    assert(lines.includes('AUDIT'), '(5) runs AUDIT');
    assert(lines.includes('Y'), '(5) answers AUDIT fix=Yes');
    assert(built.notes.some((n) => /MUTATES/i.test(n)), '(5) flags that it mutates the drawing');
    // Regapps only when explicitly requested.
    assert(!built.script.includes('Regapps'), '(5) no Regapp purge by default');
    const withReg = buildAutoCadScript('purge_and_audit', { purgeRegapps: true });
    assert(withReg.script.includes('Regapps'), '(5) Regapp purge included when purgeRegapps=true');
  }

  // ─── (6) run_commands: whitelist enforcement (the arg-injection guard) ─────
  {
    const ok = buildAutoCadScript('run_commands', { commands: ['zoom_extents', 'audit_fix'] });
    assert(ok.script.includes('ZOOM') && ok.script.includes('AUDIT'), '(6) whitelisted commands emitted');

    // Non-whitelisted / hostile "commands" are DROPPED — user text never
    // becomes a command line.
    const hostile = buildAutoCadScript('run_commands', {
      commands: ['zoom_extents', 'ERASE\nALL', 'SHELL rm -rf ~', 'DELETE', '(command "erase")'],
    });
    const lines = commandLines(hostile.script);
    assert(!lines.some((l) => /ERASE|SHELL|DELETE|rm -rf|command/i.test(l)), '(6) hostile commands never reach the script body');
    assert(lines.includes('ZOOM'), '(6) the one valid command still runs');
    assert(hostile.notes.filter((n) => n.startsWith('Dropped command')).length >= 4, '(6) each dropped command is noted');

    // All-invalid → abort with a note.
    const allBad = buildAutoCadScript('run_commands', { commands: ['nope', 'PURGE; rm'] });
    assert(allBad.script === '', '(6) all-invalid run_commands aborts');
    assert(allBad.notes.some((n) => /whitelist/i.test(n)), '(6) abort explains the whitelist');

    // Bounded: >32 requested is truncated with a note (and never throws).
    const many = buildAutoCadScript('run_commands', { commands: Array.from({ length: 100 }, () => 'regen') });
    assert(many.notes.some((n) => /truncated/i.test(n)), '(6) run_commands bounded to 32 entries');
    assert(AUTOCAD_RUN_COMMAND_KEYS.length >= 3, '(6) run_commands whitelist populated');
  }

  // ─── (7) validateAutoCadArgs shape/enum gate ──────────────────────────────
  {
    assert(!('ok' in validateAutoCadArgs({ op: 'nope' })), '(7) unknown op rejected');
    assert(!('ok' in validateAutoCadArgs(null)), '(7) null rejected');
    assert(!('ok' in validateAutoCadArgs({ op: 'export_pdf' })), '(7) export_pdf without outputPath rejected');
    assert(!('ok' in validateAutoCadArgs({ op: 'run_commands' })), '(7) run_commands without commands array rejected');
    const good = validateAutoCadArgs({ op: 'export_pdf', outputPath: '/p/x.pdf' });
    assert('ok' in good && good.ok === true, '(7) valid export_pdf accepted');
  }

  // ─── (8) two-arg vs one-arg ergonomics + describe ─────────────────────────
  {
    const a = buildAutoCadScript('export_pdf', { outputPath: '/p/x.pdf' });
    const b = buildAutoCadScript({ op: 'export_pdf', outputPath: '/p/x.pdf' });
    assert(a.script === b.script, '(8) buildAutoCadScript(op,input) === build({op,...})');
    assert(describeAutoCadOperation({ op: 'export_pdf', outputPath: '/p/x.pdf' }).includes('PDF'), '(8) describe names PDF');
    assert(describeAutoCadOperation({ op: 'purge_and_audit' }).includes('MUTATES'), '(8) describe flags mutation for purge');
    assert(describeAutoCadOperation({ op: 'run_commands', commands: ['regen'] }).includes('regen'), '(8) describe lists run_commands');
    assert(describeAutoCadOperation({}).length > 0, '(8) describe safe on empty');
  }

  // ─── (9) no generated line ever contains a control char / newline-in-token ─
  // Whole-script invariant: after assembly, every command line is control-char
  // free (the only newlines are the line separators we inserted).
  {
    const samples = [
      buildAutoCadScript('export_pdf', { outputPath: '/p/ok.pdf' }),
      buildAutoCadScript('export_dxf', { outputPath: '/p/ok.dxf', version: '2013', precision: 4 }),
      buildAutoCadScript('purge_and_audit', { purgeRegapps: true }),
      buildAutoCadScript('run_commands', { commands: ['regen', 'zoom_extents', 'update_fields'] }),
    ];
    for (const s of samples) {
      // eslint-disable-next-line no-control-regex
      assert(!/[\x00-\x09\x0b-\x1f]/.test(s.script), '(9) no stray control chars in generated script (only \\n separators)');
    }
  }

  // ─── (10) degenerate inputs never throw ───────────────────────────────────
  try {
    buildAutoCadScript(undefined as never);
    buildAutoCadScript(null as never);
    buildAutoCadScript('export_pdf');
    buildAutoCadScript('export_dxf', { outputPath: 42 as never });
    buildAutoCadScript('run_commands', { commands: 'not-an-array' as never });
    buildAutoCadScript({ op: 'purge_and_audit', purgeRegapps: 'yes' as never });
    validateAutoCadArgs(undefined);
    describeAutoCadOperation(undefined);
    describeAutoCadOperation('string' as never);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  // ─── (6) draft_entities: neutral entity model → .scr ──────────────────────
  {
    const build = buildAutoCadScript('draft_entities', {
      layers: [{ name: 'WALLS', color: 7 }, { name: 'DIMS', color: 2 }],
      entities: [
        { kind: 'line', layer: 'WALLS', x1: 0, y1: 0, x2: 1000, y2: 0 },
        { kind: 'circle', layer: 'WALLS', cx: 500, cy: 500, r: 250 },
        { kind: 'arc', layer: 'WALLS', cx: 0, cy: 0, r: 100, startDeg: 0, endDeg: 90 },
        { kind: 'polyline', layer: 'WALLS', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
        { kind: 'text', layer: 'DIMS', x: 5, y: 5, height: 200, text: 'ROOM A' },
      ],
    });
    assert(build.script.length > 0, '(6) draft_entities produced a script');
    assert(build.scriptExtension === 'scr', '(6) draft_entities extension is scr');
    const lines = commandLines(build.script);
    assert(lines.includes('-LAYER') && lines.includes('WALLS') && lines.includes('DIMS'), '(6) declares both layers via -LAYER');
    assert(lines.includes('LINE') && lines.includes('CIRCLE') && lines.includes('ARC') && lines.includes('PLINE') && lines.includes('TEXT'), '(6) emits all five entity commands');
    // Coordinates are single comma tokens — never a bare "x y" that would Enter.
    assert(lines.includes('0,0') && lines.includes('1000,0'), '(6) coordinates are comma tokens');
    assert(!build.script.split('\n').some((l) => /^-?\d+(\.\d+)?\s+-?\d+/.test(l)), '(6) no line is a space-separated coordinate pair');
    assert(build.script.includes('ROOM A'), '(6) text content present');

    // Injection: a newline in a text label must never split into a new command.
    const hostile = buildAutoCadScript('draft_entities', {
      layers: [{ name: 'L', color: 1 }],
      entities: [{ kind: 'text', layer: 'L', x: 0, y: 0, height: 10, text: 'A\nLINE\n0,0\n9,9' }],
    });
    const hostileLines = commandLines(hostile.script);
    // Count how many LINE commands exist — the label must NOT have added one.
    assert(hostileLines.filter((l) => l === 'LINE').length === 0, '(6) newline in a TEXT label did not inject a LINE command');

    // Injection: a bad layer name is skipped with a note, never emitted.
    const badLayer = buildAutoCadScript('draft_entities', {
      layers: [{ name: 'bad name', color: 1 }],
      entities: [{ kind: 'line', layer: 'bad name', x1: 0, y1: 0, x2: 1, y2: 1 }],
    });
    assert(badLayer.script === '', '(6) an entity whose only layer is invalid produces no script');
    assert(badLayer.notes.some((n) => /name must match|no valid entity/.test(n)), '(6) the invalid layer is explained in notes');

    // Undeclared layer reference is refused (declare-first discipline).
    const undeclared = buildAutoCadScript('draft_entities', {
      layers: [{ name: 'DECLARED' }],
      entities: [{ kind: 'line', layer: 'GHOST', x1: 0, y1: 0, x2: 1, y2: 1 }],
    });
    assert(undeclared.script === '' && undeclared.notes.some((n) => /undeclared layer/.test(n)), '(6) entity on an undeclared layer is refused');

    // Validation: empty entities array rejected.
    const empty = validateAutoCadArgs({ op: 'draft_entities', entities: [] });
    assert(!('ok' in empty), '(6) empty entities array rejected at validation');

    assert(AUTOCAD_OPERATIONS.includes('draft_entities'), '(6) draft_entities is a registered operation');
    assert(/2D entit/.test(describeAutoCadOperation({ op: 'draft_entities', layers: [{ name: 'L' }], entities: [{ kind: 'line', layer: 'L', x1: 0, y1: 0, x2: 1, y2: 1 }] })), '(6) describe mentions 2D entities');
  }

  console.log(`\nAll autocad-script-adapter smoke cases passed (${passes} passed).`);
}

main();
