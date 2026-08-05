/**
 * revit-script-adapter-smoketest — the PURE Autodesk Revit script generator
 * (src/lib/revitScriptAdapter.ts, plan P4). SECURITY-HEAVY: the load-bearing
 * assertions are the allowlist + injection rejection for every user value
 * (sheet set / schedule / parameter name, parameter value, export path), the
 * SAFE embed of quote/newline/backslash values via the Python-literal escaper,
 * the mutation-needs-Transaction+approval contract for set_parameter, bounds,
 * script-shape pins, and degenerate-never-throws.
 *
 * Run: npx tsx scripts/revit-script-adapter-smoketest.ts
 * Pure — loads under tsx (revitScriptAdapter has zero imports).
 */

import {
  REVIT_SCRIPT_OPERATIONS,
  REVIT_RESULT_SENTINEL,
  REVIT_ERROR_SENTINEL,
  buildRevitScript,
  validateRevitArgs,
  describeRevitOperation,
  describeRevitEngineDescriptor,
  isRevitScriptOperation,
} from '../src/lib/revitScriptAdapter';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) operation catalog + describe ─────────────────────────────────────
  assertEq(REVIT_SCRIPT_OPERATIONS.length, 4, '(1) four operations');
  assert(isRevitScriptOperation('export_pdf') && !isRevitScriptOperation('nuke'), '(1) operation guard');
  assert(describeRevitOperation('set_parameter').mutates === true, '(1) set_parameter is a mutation');
  assert(describeRevitOperation('export_pdf').mutates === false, '(1) export_pdf is read-only');
  assert(describeRevitOperation('export_ifc').mutates === false, '(1) export_ifc is read-only');
  assert(describeRevitOperation('export_schedule_csv').mutates === false, '(1) export_schedule_csv is read-only');
  assert(describeRevitOperation('bogus').known === false, '(1) unknown op flagged known:false (never throws)');

  // ─── (2) export_pdf happy path + script shape ─────────────────────────────
  {
    const built = buildRevitScript('export_pdf', {
      sheetSetName: 'Issue Set A-01 (Rev.2)',
      outputPath: '/Users/demo/Documents/exports/set-a.pdf',
    });
    assert(built.ok, '(2) export_pdf builds');
    if (built.ok) {
      assertEq(built.mutates, false, '(2) export_pdf mutates:false');
      assert(built.expectedOutputPath === '/Users/demo/Documents/exports/set-a.pdf', '(2) expectedOutputPath carried');
      assert(built.python.includes('clr.AddReference("RevitAPI")'), '(2) loads RevitAPI via clr');
      assert(built.python.includes('__revit__.ActiveUIDocument'), '(2) reaches active doc from __revit__');
      assert(built.python.includes('PDFExportOptions()'), '(2) uses PDFExportOptions');
      assert(!built.python.includes('Transaction('), '(2) NO Transaction for read-only export');
      // Sheet-set name embedded as a u"…" unicode literal, never raw.
      assert(built.python.includes('SHEET_SET_NAME = u"Issue Set A-01 (Rev.2)"'), '(2) sheet set name embedded as u"…" literal', built.python.slice(0, 400));
      assert(built.python.includes(REVIT_RESULT_SENTINEL), '(2) prints result sentinel');
      assert(built.python.includes(REVIT_ERROR_SENTINEL), '(2) has error sentinel for fail-closed');
      assertEq(built.suggestedScriptFileName, 'uc-revit-export-pdf.py', '(2) deterministic staging name');
    }
  }

  // ─── (3) export_ifc + export_schedule_csv happy paths ─────────────────────
  {
    const ifc = buildRevitScript('export_ifc', { outputPath: '/Users/demo/Documents/model.ifc' });
    assert(ifc.ok, '(3) export_ifc builds');
    if (ifc.ok) {
      assert(ifc.python.includes('IFCExportOptions()'), '(3) uses IFCExportOptions');
      assert(!ifc.python.includes('Transaction('), '(3) NO Transaction for IFC export');
      assert(ifc.python.includes('OUTPUT_FILE_NAME = u"model.ifc"'), '(3) ifc file name embedded as literal');
    }
    const sched = buildRevitScript('export_schedule_csv', {
      scheduleName: 'Door Schedule',
      outputPath: '/Users/demo/Documents/doors.csv',
    });
    assert(sched.ok, '(3) export_schedule_csv builds');
    if (sched.ok) {
      assert(sched.python.includes('ViewSchedule)'), '(3) collects ViewSchedule class');
      assert(sched.python.includes('ViewScheduleExportOptions()'), '(3) uses ViewScheduleExportOptions');
      assert(!sched.python.includes('Transaction('), '(3) NO Transaction for schedule export');
      assert(sched.python.includes('SCHEDULE_NAME = u"Door Schedule"'), '(3) schedule name embedded as literal');
    }
    // .txt is an allowed schedule output too.
    const schedTxt = buildRevitScript('export_schedule_csv', { scheduleName: 'Sheet List', outputPath: '/tmp/sheets.txt' });
    assert(schedTxt.ok, '(3) schedule export accepts .txt output');
  }

  // ─── (4) set_parameter: MUTATION → Transaction + approval note ────────────
  {
    const built = buildRevitScript('set_parameter', {
      target: 'instance',
      elementId: 348912,
      parameterName: 'Comments',
      value: 'Reviewed 2026-07',
    });
    assert(built.ok, '(4) set_parameter builds');
    if (built.ok) {
      assertEq(built.mutates, true, '(4) set_parameter mutates:true');
      assertEq(built.expectedOutputPath, null, '(4) set_parameter has no expected output file');
      // Load-bearing: the write MUST be wrapped in a Transaction.
      assert(built.python.includes('Transaction(doc, "UC set parameter")'), '(4) write wrapped in a Transaction');
      assert(built.python.includes('transaction.Start()'), '(4) Transaction Start');
      assert(built.python.includes('transaction.Commit()'), '(4) Transaction Commit on success');
      assert(built.python.includes('transaction.RollBack()'), '(4) Transaction RollBack on failure');
      assert(built.python.includes('param.IsReadOnly'), '(4) refuses read-only parameters');
      assert(built.python.includes('ELEMENT_ID = 348912'), '(4) elementId embedded as integer literal (from validated int)');
      assert(built.python.includes('PARAMETER_NAME = u"Comments"'), '(4) parameter name embedded as literal');
      assert(built.python.includes('NEW_VALUE = u"Reviewed 2026-07"'), '(4) value embedded as u"…" literal');
      // Approval note is present and explicit.
      assert(built.notes.some((n) => /approval/i.test(n)), '(4) carries an approval note');
      assert(built.notes.some((n) => /Transaction/i.test(n)), '(4) carries a Transaction note');
    }
    // target 'type' edits the element's type.
    const typeBuilt = buildRevitScript('set_parameter', { target: 'type', elementId: 12, parameterName: 'Fire Rating', value: '2 HR' });
    assert(typeBuilt.ok && typeBuilt.ok && typeBuilt.python.includes('EDIT_TYPE = True'), '(4) target=type sets EDIT_TYPE True');
    assert(typeBuilt.ok && typeBuilt.python.includes('element.GetTypeId()'), '(4) type edit resolves the type element');
    // validateRevitArgs surfaces the same mutation flag + note without generating.
    const preview = validateRevitArgs('set_parameter', { target: 'instance', elementId: 5, parameterName: 'Mark', value: 'A1' });
    assert(preview.ok && preview.mutates === true, '(4) validateRevitArgs flags mutation for preview');
    assert(preview.ok && preview.notes.some((n) => /approval/i.test(n)), '(4) validateRevitArgs carries the approval note');
  }

  // ─── (5) numeric/boolean parameter value coercion is safe ─────────────────
  {
    const num = buildRevitScript('set_parameter', { target: 'instance', elementId: 5, parameterName: 'Height', value: 3000 });
    assert(num.ok, '(5) numeric value builds');
    // The number is embedded as a STRING literal and coerced in-script by StorageType —
    // never concatenated into code as a bare number.
    if (num.ok) {
      assert(num.python.includes('NEW_VALUE = u"3000"'), '(5) numeric value embedded as a safe string literal');
      assert(num.python.includes('param.Set(float(NEW_VALUE))'), '(5) Double storage coerces via float()');
      assert(num.python.includes('param.Set(int(float(NEW_VALUE)))'), '(5) Integer storage coerces via int(float())');
    }
    const bool = buildRevitScript('set_parameter', { target: 'instance', elementId: 5, parameterName: 'IsExternal', value: true });
    assert(bool.ok && bool.python.includes('NEW_VALUE = u"1"'), '(5) boolean true → "1" literal (Yes/No param)');
  }

  // ─── (6) SAFE EMBED — quotes, newlines, backslashes never break out ───────
  {
    // A value crafted to break a naive string interpolation: embedded double
    // quote, backslash, and (attempted) newline are all escaped; the code line
    // remains one physical line and the payload stays inside the u"…" literal.
    const evilValue = 'x"; import os; os.system("rm -rf ~")\\n#';
    const built = buildRevitScript('set_parameter', {
      target: 'instance',
      elementId: 7,
      parameterName: 'Comments',
      value: evilValue,
    });
    assert(built.ok, '(6) value with quotes/backslash still builds');
    if (built.ok) {
      // The escaped literal is exactly JSON.stringify(value) with a u prefix.
      const expectedLiteral = 'u' + JSON.stringify(evilValue);
      assert(built.python.includes(`NEW_VALUE = ${expectedLiteral}`), '(6) hostile value embedded as escaped u"…" literal', expectedLiteral);
      // No raw breakout: the naive `NEW_VALUE = "x"; import os...` must NOT appear.
      assert(!built.python.includes('NEW_VALUE = "x"; import os'), '(6) no raw unescaped interpolation of the payload');
      // The escaped backslash-n must be present as the two chars \\n, not a real newline inside the assignment.
      const assignLine = built.python.split('\n').find((l) => l.startsWith('NEW_VALUE = ')) || '';
      assert(assignLine.includes('\\n'), '(6) newline escaped to \\n inside the literal (stays one line)');
      assert(!assignLine.includes(String.fromCharCode(10)), '(6) assignment line contains no real newline');
    }
    // A newline in a NAME is rejected outright (names are allowlisted, not escaped).
    const nameNl = buildRevitScript('set_parameter', { target: 'instance', elementId: 7, parameterName: 'Com\nments', value: 'x' });
    assert(!nameNl.ok, '(6) newline in parameter NAME rejected (allowlist, not escape)');

    // Whole generated script is pure ASCII (escaper forces \uXXXX for non-ASCII).
    const unicodeVal = buildRevitScript('set_parameter', { target: 'instance', elementId: 7, parameterName: 'Comments', value: 'café — 日本' });
    assert(unicodeVal.ok, '(6) BMP unicode value builds');
    if (unicodeVal.ok) {
      // eslint-disable-next-line no-control-regex
      assert(/^[\x00-\x7f]*$/.test(unicodeVal.python), '(6) generated script is pure ASCII (non-ASCII → \\uXXXX)');
      assert(unicodeVal.python.includes('\\u00e9') || unicodeVal.python.includes('\\u65e5'), '(6) non-ASCII chars appear as \\uXXXX escapes');
    }
  }

  // ─── (7) ALLOWLIST + INJECTION REJECTION for names ────────────────────────
  {
    const hostileNames: Array<[string, string]> = [
      ['a"; rm -rf /', 'double quote + shell'],
      ['a`whoami`', 'backtick'],
      ['a$(id)', 'command sub'],
      ['a\\b', 'backslash'],
      ['a;b', 'semicolon'],
      ['a|b', 'pipe'],
      ['a<b>c', 'angle brackets'],
      ["a'b", 'single quote'],
      ['ab', 'control char'],
      ['a\u{1F600}b', 'non-BMP'],
      ['a{b}', 'braces'],
      ['a=b', 'equals'],
    ];
    for (const [name, why] of hostileNames) {
      const r = validateRevitArgs('set_parameter', { target: 'instance', elementId: 5, parameterName: name, value: 'x' });
      assertEq(r.ok, false, `(7) reject hostile parameterName: ${why}`);
      const rs = validateRevitArgs('export_pdf', { sheetSetName: name, outputPath: '/tmp/a.pdf' });
      assertEq(rs.ok, false, `(7) reject hostile sheetSetName: ${why}`);
      const rsch = validateRevitArgs('export_schedule_csv', { scheduleName: name, outputPath: '/tmp/a.csv' });
      assertEq(rsch.ok, false, `(7) reject hostile scheduleName: ${why}`);
    }
    // Legit names with allowed punctuation pass.
    assert(validateRevitArgs('export_pdf', { sheetSetName: 'A-101 (Level 1) #1 & 2, Rev.3/4', outputPath: '/tmp/a.pdf' }).ok, '(7) legit name with allowed punctuation passes');
    // Over-length name rejected.
    assertEq(validateRevitArgs('export_pdf', { sheetSetName: 'A'.repeat(300), outputPath: '/tmp/a.pdf' }).ok, false, '(7) over-length name rejected');
  }

  // ─── (8) PATH SAFETY (validateCadPath-style: metachar/control/BMP/traversal) ─
  {
    const badPaths: Array<[string, string]> = [
      ['/p/../../etc/passwd.pdf', 'traversal ..'],
      ['/p/a;rm -rf ~.pdf', 'shell metachar ;'],
      ['/p/`whoami`.pdf', 'backtick'],
      ['/p/$(id).pdf', 'command sub $'],
      ['/p/a|b.pdf', 'pipe'],
      ['/p/a>b.pdf', 'redirect >'],
      ['/p/a<b.pdf', 'redirect <'],
      ['/p/a&b.pdf', 'ampersand'],
      ['/p/a\nb.pdf', 'newline'],
      ['/p/a.pdf', 'control char'],
      ['/p/\u{1F600}.pdf', 'non-BMP'],
    ];
    for (const [p, why] of badPaths) {
      assertEq(validateRevitArgs('export_pdf', { sheetSetName: 'Set', outputPath: p }).ok, false, `(8) reject outputPath: ${why}`);
    }
    // over-length path rejected
    assertEq(validateRevitArgs('export_pdf', { sheetSetName: 'Set', outputPath: '/p/' + 'a'.repeat(1100) + '.pdf' }).ok, false, '(8) reject >1024 path');
    // wrong extension rejected per operation
    assertEq(validateRevitArgs('export_pdf', { sheetSetName: 'Set', outputPath: '/p/out.txt' }).ok, false, '(8) export_pdf requires .pdf');
    assertEq(validateRevitArgs('export_ifc', { outputPath: '/p/out.pdf' }).ok, false, '(8) export_ifc requires .ifc');
    assertEq(validateRevitArgs('export_schedule_csv', { scheduleName: 'S', outputPath: '/p/out.pdf' }).ok, false, '(8) schedule export requires .csv/.txt');
    // A hostile path passed to a build call is refused (build re-validates).
    const built = buildRevitScript('export_ifc', { outputPath: '/p/$(evil).ifc' });
    assert(!built.ok, '(8) buildRevitScript refuses a hostile export path');
  }

  // ─── (9) elementId bounds ─────────────────────────────────────────────────
  {
    assertEq(validateRevitArgs('set_parameter', { target: 'instance', elementId: 0, parameterName: 'Mark', value: 'x' }).ok, false, '(9) elementId 0 rejected');
    assertEq(validateRevitArgs('set_parameter', { target: 'instance', elementId: -5, parameterName: 'Mark', value: 'x' }).ok, false, '(9) negative elementId rejected');
    assertEq(validateRevitArgs('set_parameter', { target: 'instance', elementId: 1.5, parameterName: 'Mark', value: 'x' }).ok, false, '(9) non-integer elementId rejected');
    assertEq(validateRevitArgs('set_parameter', { target: 'instance', elementId: 1e12, parameterName: 'Mark', value: 'x' }).ok, false, '(9) out-of-range elementId rejected');
    assertEq(validateRevitArgs('set_parameter', { target: 'sideways' as never, elementId: 5, parameterName: 'Mark', value: 'x' }).ok, false, '(9) bad target rejected');
    // empty value rejected
    assertEq(validateRevitArgs('set_parameter', { target: 'instance', elementId: 5, parameterName: 'Mark', value: '' }).ok, false, '(9) empty value rejected');
  }

  // ─── (10) reported engine descriptor (NOT registered) ─────────────────────
  {
    const d = describeRevitEngineDescriptor();
    assertEq(d.id, 'revit_python', '(10) descriptor id');
    assertEq(d.platform, 'windows', '(10) Revit is Windows-only');
    assertEq(d.verifiedInvocation, false, '(10) invocation unverified — fail-closed for live wiring');
    assertEq(d.requiresApprovalForMutation, true, '(10) descriptor flags the mutation-approval need the runner lacks');
    assert(d.sourceExtensions.includes('py'), '(10) source is .py');
    assert(d.defaultTimeoutMs <= d.maxTimeoutMs, '(10) default ≤ max timeout');
    assert(/VERIFY/.test(d.verifyNote), '(10) verify note present');
  }

  // ─── (11) VERIFY header + IronPython-2.7 shape pins ───────────────────────
  {
    const built = buildRevitScript('export_pdf', { sheetSetName: 'Set', outputPath: '/tmp/a.pdf' });
    assert(built.ok, '(11) build for header inspection');
    if (built.ok) {
      assert(built.python.includes('VERIFY Revit API calls'), '(11) generated script carries the VERIFY header');
      // IronPython 2.7 except syntax (`except X, err:`) — not Py3 `except X as err:`.
      assert(built.python.includes('except Exception, err:'), '(11) uses IronPython 2.7 except syntax');
      assert(!/except\s+\w+\s+as\s+\w+:/.test(built.python), '(11) no Python-3 "except ... as ..." form');
      // No f-strings anywhere (Py2-safe).
      assert(!/[fF]"[^"]*\{/.test(built.python), '(11) no f-string literals (IronPython 2.7)');
    }
  }

  // ─── (12) degenerate inputs never throw ───────────────────────────────────
  try {
    buildRevitScript(undefined as never, undefined as never);
    buildRevitScript('export_pdf', undefined as never);
    buildRevitScript('export_pdf', {});
    buildRevitScript('set_parameter', {});
    buildRevitScript('bogus' as never, { sheetSetName: 'x', outputPath: '/tmp/a.pdf' });
    validateRevitArgs(undefined as never, null);
    validateRevitArgs('set_parameter', null);
    describeRevitOperation(null);
    describeRevitOperation(123 as never);
    describeRevitEngineDescriptor();
    // Explicit invalid-shape errors are typed, not thrown.
    const bad = buildRevitScript('export_pdf', { sheetSetName: '', outputPath: '' });
    assert(bad.ok === false, '(12) invalid export_pdf returns typed error');
    if (!bad.ok) assert(typeof bad.error === 'string' && bad.error.length > 0, '(12) typed error carries a message');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (12) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll revit-script-adapter smoke cases passed (${passes} passed).`);
}

main();
