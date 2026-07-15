// Smoke test for a11yTargetResolverCore — pure, tsx-loadable, deterministic.
// Run: npx tsx scripts/a11y-target-resolver-core-smoketest.ts
import {
  parseA11yLines,
  resolveA11yTarget,
  type A11yTreeNode,
  type A11yTargetResolution,
} from '../src/lib/a11yTargetResolverCore';

let passes = 0,
  failures = 0;
function assert(c: any, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

function isRes(r: any): boolean {
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.found === 'boolean' &&
    typeof r.ambiguous === 'boolean' &&
    typeof r.candidates === 'number' &&
    typeof r.note === 'string'
  );
}

function main() {
  // ---- Group 1: parse basic no-index line -------------------------------
  const n1 = parseA11yLines(['[1.2.4.0] AXButton "Export"']);
  assertEq(n1.length, 1, 'G1 one node parsed');
  assertEq(n1[0].path, '1.2.4.0', 'G1 path');
  assertEq(n1[0].role, 'AXButton', 'G1 role');
  assertEq(n1[0].label, 'Export', 'G1 label');
  assertEq(n1[0].index, undefined, 'G1 no index');

  // ---- Group 2: parse SoM index prefix ----------------------------------
  const n2 = parseA11yLines(['[#7] [1.2.4.0] AXButton "Export"']);
  assertEq(n2[0].index, 7, 'G2 index 7');
  assertEq(n2[0].path, '1.2.4.0', 'G2 path');
  assertEq(n2[0].role, 'AXButton', 'G2 role');
  assertEq(n2[0].label, 'Export', 'G2 label');

  // ---- Group 3: indented + prompt-style lowercase role ------------------
  const n3 = parseA11yLines(['    [#3] [0.1.2] button "OK"']);
  assertEq(n3[0].index, 3, 'G3 index');
  assertEq(n3[0].path, '0.1.2', 'G3 path');
  assertEq(n3[0].role, 'button', 'G3 lowercase role');
  assertEq(n3[0].label, 'OK', 'G3 label');

  // ---- Group 4: role-only, no label -------------------------------------
  const n4 = parseA11yLines(['[0.2] AXGroup']);
  assertEq(n4[0].role, 'AXGroup', 'G4 role');
  assertEq(n4[0].label, undefined, 'G4 no label');
  assertEq(n4[0].path, '0.2', 'G4 path');

  // ---- Group 5: value-only line must NOT capture value as label ---------
  const n5 = parseA11yLines(['[0.3] AXTextField = "John"']);
  assertEq(n5[0].role, 'AXTextField', 'G5 role');
  assertEq(n5[0].label, undefined, 'G5 value is not a label');

  // ---- Group 6: label + value → keep only the label ---------------------
  const n6 = parseA11yLines(['[#5] [0.4] AXTextField "Name" = "John"']);
  assertEq(n6[0].label, 'Name', 'G6 label is Name not John');
  assertEq(n6[0].index, 5, 'G6 index');

  // ---- Group 7: escaped quotes inside a label ---------------------------
  const n7 = parseA11yLines(['[0.5] AXStaticText "Save \\"As\\""']);
  assertEq(n7[0].label, 'Save "As"', 'G7 escaped quotes decoded');

  // ---- Group 8: non-node lines rejected ---------------------------------
  const n8 = parseA11yLines([
    'Accessibility tree for Safari (pid 123, nodes 40):',
    '',
    '   ',
    '…[80 more nodes — ask for detailed if needed]',
    '[slice: 38 of 412 nodes — targeting "Export"]',
    'Δ since last read: +2 ~1',
    '[1.0.0] AXButton "Go"',
  ]);
  assertEq(n8.length, 1, 'G8 only the real node parsed');
  assertEq(n8[0].label, 'Go', 'G8 kept node label');
  assertEq(n8[0].path, '1.0.0', 'G8 kept node path');

  // ---- Group 9: parse from newline blob + junk-array coercion -----------
  const n9 = parseA11yLines('[#1] [0.0] AXButton "A"\n[#2] [0.1] AXButton "B"');
  assertEq(n9.length, 2, 'G9 blob two nodes');
  assertEq(n9[0].index, 1, 'G9 first index');
  assertEq(n9[1].label, 'B', 'G9 second label');
  const n9b = parseA11yLines([null, undefined, {}, 5, true, 'x', '[0.9] AXButton "Z"']);
  assertEq(n9b.length, 1, 'G9 junk array yields only real node');
  assertEq(n9b[0].label, 'Z', 'G9 junk array node label');

  // ---- Group 10: resolve unique → found + index + path + role -----------
  const lines10 = [
    '[#1] [0.0] AXGroup "Toolbar"',
    '[#2] [0.1] AXButton "Export"',
    '[#3] [0.2] AXButton "Cancel"',
  ];
  const r10 = resolveA11yTarget('Export', lines10);
  assertEq(r10.found, true, 'G10 found');
  assertEq(r10.ambiguous, false, 'G10 not ambiguous');
  assertEq(r10.elementIndex, 2, 'G10 elementIndex 2');
  assertEq(r10.path, '0.1', 'G10 path');
  assertEq(r10.role, 'AXButton', 'G10 role');
  assertEq(r10.candidates, 1, 'G10 candidates 1');
  assert(r10.note.indexOf('elementIndex') >= 0, 'G10 note mentions elementIndex');
  assert(r10.note.indexOf('2') >= 0, 'G10 note mentions the index value');

  // ---- Group 11: unique without a SoM index → path-only note ------------
  const lines11 = ['[0.1] AXButton "Export"', '[0.2] AXButton "Cancel"'];
  const r11 = resolveA11yTarget('export', lines11); // case-insensitive
  assertEq(r11.found, true, 'G11 found (case-insensitive)');
  assertEq(r11.elementIndex, undefined, 'G11 no elementIndex');
  assertEq(r11.path, '0.1', 'G11 path');
  assert(r11.note.indexOf('path 0.1') >= 0, 'G11 note mentions path');

  // ---- Group 12: two "OK" buttons → ambiguous ---------------------------
  const lines12 = [
    '[#1] [0.0] AXButton "OK"',
    '[#2] [0.5] AXButton "OK"',
    '[#3] [0.9] AXButton "Apply"',
  ];
  const r12 = resolveA11yTarget('OK', lines12);
  assertEq(r12.found, false, 'G12 not found');
  assertEq(r12.ambiguous, true, 'G12 ambiguous');
  assertEq(r12.candidates, 2, 'G12 candidates 2');
  assertEq(r12.elementIndex, undefined, 'G12 no index on ambiguous');
  assertEq(r12.path, undefined, 'G12 no path on ambiguous');
  assert(r12.note.indexOf('ambiguous') >= 0, 'G12 note says ambiguous');
  assert(r12.note.indexOf('#1') >= 0 && r12.note.indexOf('#2') >= 0, 'G12 note lists candidate tokens');

  // ---- Group 13: no match → not found -----------------------------------
  const r13 = resolveA11yTarget('Nonexistent', lines12);
  assertEq(r13.found, false, 'G13 not found');
  assertEq(r13.ambiguous, false, 'G13 not ambiguous');
  assertEq(r13.candidates, 0, 'G13 candidates 0');
  assert(r13.note.indexOf('No accessibility element matched') >= 0, 'G13 note wording');

  // ---- Group 14: match by role (AX-prefix tolerant), unique -------------
  const lines14 = ['[#4] [0.7] AXSlider "Volume"', '[#5] [0.8] AXButton "Mute"'];
  const r14 = resolveA11yTarget('button', lines14);
  assertEq(r14.found, true, 'G14 role match found');
  assertEq(r14.elementIndex, 5, 'G14 role match index');
  assertEq(r14.role, 'AXButton', 'G14 role field');

  // ---- Group 15: exact label beats role tier ----------------------------
  const lines15 = ['[#6] [1.0] AXButton "Slider"', '[#7] [1.1] AXSlider "Volume"'];
  const r15 = resolveA11yTarget('Slider', lines15);
  assertEq(r15.found, true, 'G15 found');
  assertEq(r15.elementIndex, 6, 'G15 label-exact beats role tier');
  assertEq(r15.role, 'AXButton', 'G15 resolved node role');

  // ---- Group 16: label-contains fallback + exact-beats-substring --------
  const lines16 = ['[#8] [2.0] AXButton "Export PDF"', '[#9] [2.1] AXButton "Print"'];
  const r16 = resolveA11yTarget('Export', lines16);
  assertEq(r16.found, true, 'G16 substring fallback found');
  assertEq(r16.elementIndex, 8, 'G16 substring index');
  const lines16b = ['[#8] [2.0] AXButton "Export PDF"', '[#9] [2.1] AXButton "Export"'];
  const r16b = resolveA11yTarget('Export', lines16b);
  assertEq(r16b.found, true, 'G16 exact beats substring found');
  assertEq(r16b.elementIndex, 9, 'G16 exact-label node chosen over substring');

  // ---- Group 17: resolve accepts a newline blob directly ----------------
  const r17 = resolveA11yTarget(
    'Export',
    '[#1] [0.0] AXButton "Cancel"\n[#2] [0.1] AXButton "Export"',
  );
  assertEq(r17.found, true, 'G17 blob resolve found');
  assertEq(r17.elementIndex, 2, 'G17 blob resolve index');

  // ---- Group 18: index-only node (no path bracket) ----------------------
  const r18 = resolveA11yTarget('Solo', ['[#9] AXButton "Solo"']);
  assertEq(r18.found, true, 'G18 index-only found');
  assertEq(r18.elementIndex, 9, 'G18 index');
  assertEq(r18.path, undefined, 'G18 no path');
  assert(r18.note.indexOf('elementIndex') >= 0, 'G18 note prefers elementIndex');

  // ---- Group 19: determinism (same input → identical result) ------------
  const d1 = JSON.stringify(resolveA11yTarget('Export', lines10));
  const d2 = JSON.stringify(resolveA11yTarget('Export', lines10));
  assertEq(d1, d2, 'G19 deterministic resolve');
  const p1 = JSON.stringify(parseA11yLines(lines10));
  const p2 = JSON.stringify(parseA11yLines(lines10));
  assertEq(p1, p2, 'G19 deterministic parse');

  // ---- Group 20: HOSTILE / DEGENERATE — must never throw ----------------
  const hostileTargets: unknown[] = [null, undefined, 123, {}, [], true, () => 1, NaN, Infinity];
  const hostileLines: unknown[] = [null, undefined, 42, {}, true, () => 1, NaN];
  for (let i = 0; i < hostileTargets.length; i++) {
    for (let j = 0; j < hostileLines.length; j++) {
      const r = resolveA11yTarget(hostileTargets[i], hostileLines[j]);
      assert(isRes(r), 'G20 resolve shape ok (' + i + ',' + j + ')');
      assertEq(r.found, false, 'G20 hostile not found (' + i + ',' + j + ')');
    }
  }
  // parseA11yLines on hostile inputs → always a bounded array
  const hp1 = parseA11yLines(null);
  const hp2 = parseA11yLines(undefined);
  const hp3 = parseA11yLines(42 as unknown);
  const hp4 = parseA11yLines({} as unknown);
  const hp5 = parseA11yLines(true as unknown);
  assert(Array.isArray(hp1) && hp1.length === 0, 'G20 parse(null) -> []');
  assert(Array.isArray(hp2) && hp2.length === 0, 'G20 parse(undefined) -> []');
  assert(Array.isArray(hp3) && hp3.length === 0, 'G20 parse(number) -> []');
  assert(Array.isArray(hp4) && hp4.length === 0, 'G20 parse(object) -> []');
  assert(Array.isArray(hp5) && hp5.length === 0, 'G20 parse(boolean) -> []');

  // empty / whitespace / quote-wrapped targets
  const rEmpty = resolveA11yTarget('', lines10);
  assertEq(rEmpty.found, false, 'G20 empty target not found');
  assert(rEmpty.note.indexOf('non-empty') >= 0, 'G20 empty target note');
  const rBlank = resolveA11yTarget('   ', lines10);
  assertEq(rBlank.found, false, 'G20 whitespace target not found');
  const rQuoted = resolveA11yTarget('"Export"', lines10);
  assertEq(rQuoted.found, true, 'G20 quote-wrapped target resolves');
  assertEq(rQuoted.elementIndex, 2, 'G20 quote-wrapped index');

  // no nodes to resolve against
  const rNoNodes = resolveA11yTarget('Export', ['(nothing here)', 'plain text']);
  assertEq(rNoNodes.found, false, 'G20 no-nodes not found');
  assertEq(rNoNodes.candidates, 0, 'G20 no-nodes candidates 0');

  // huge label → parsed but capped; resolve still total
  const hugeLabel = '[0.0] AXButton "' + 'A'.repeat(100_000) + '"';
  const hn = parseA11yLines([hugeLabel]);
  assertEq(hn.length, 1, 'G20 huge label parsed');
  assert(typeof hn[0].label === 'string' && hn[0].label!.length <= 200, 'G20 huge label capped <=200');

  // huge target → not found, note display truncated with ellipsis
  const rHugeTarget = resolveA11yTarget('B'.repeat(100_000), lines10);
  assert(isRes(rHugeTarget), 'G20 huge target shape ok');
  assertEq(rHugeTarget.found, false, 'G20 huge target not found');
  assert(rHugeTarget.note.indexOf('…') >= 0, 'G20 huge target note truncated');

  // huge line array → bounded, still resolves the planted node
  const bigLines: string[] = [];
  for (let i = 0; i < 60_000; i++) bigLines.push('[' + i + '.0] AXCell "row' + i + '"');
  bigLines.push('[#999] [9.9] AXButton "UniqueExport"');
  const rBig = resolveA11yTarget('row123', bigLines);
  assert(isRes(rBig), 'G20 big-array resolve shape ok');
  const rBigNodes = parseA11yLines(bigLines);
  assert(rBigNodes.length <= 20_000, 'G20 big-array parse bounded <=20000');

  // hostile smuggled content inside a label must not break parsing/matching
  const rSmug = resolveA11yTarget('safe', ['[0.0] AXButton "safe" ​']);
  assert(isRes(rSmug), 'G20 smuggled-label shape ok');
}

main();
if (failures > 0) {
  console.error('\n' + failures + ' fail');
  process.exit(1);
}
console.log('\nAll a11yTargetResolverCore smoke cases passed (' + passes + ' passed).');
