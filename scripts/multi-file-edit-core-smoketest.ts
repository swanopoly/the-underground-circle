/**
 * multi-file-edit-core-smoketest — the TRANSACTIONAL multi-file edit planner
 * (src/lib/multiFileEditCore.ts) behind a Claude-Code-style desktop.edit_files
 * tool. Load-bearing assertions: an all-clean batch plans every file with correct
 * per-file replacements; a SINGLE bad oldString anywhere fails the WHOLE plan
 * (ok:false + failedPath) so nothing is written (atomic all-or-nothing — the point
 * of the tool); uniqueness/replaceAll is inherited from fileEditCore; create-in-
 * batch works; duplicate paths, empty/oversized batches, and hostile input all
 * fail closed without throwing; the summary is bounded.
 *
 * Pure — loads under tsx (multiFileEditCore imports only the zero-import fileEditCore).
 */

import {
  planMultiFileEdits,
  summarizeMultiFilePlan,
  MAX_FILES_PER_PLAN,
  MAX_EDITS_PER_FILE,
  type MultiFilePlan,
} from '../src/lib/multiFileEditCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
/** Assert a hostile call returns a safe MultiFilePlan shape without throwing. */
function safe(fn: () => MultiFilePlan, msg: string): MultiFilePlan {
  try {
    const r = fn();
    assert(
      r != null && typeof r === 'object' && typeof r.ok === 'boolean' && Array.isArray(r.files),
      `${msg} → safe MultiFilePlan shape`,
      JSON.stringify(r),
    );
    return r;
  } catch (e: any) {
    assert(false, `${msg} threw`, e && e.message);
    return { ok: false, files: [] };
  }
}
/** Assert summarize returns a bounded string without throwing. */
function safeStr(fn: () => string, msg: string): void {
  try {
    const s = fn();
    assert(typeof s === 'string' && s.length <= 5000, `${msg} → bounded string`, typeof s === 'string' ? String(s.length) : typeof s);
  } catch (e: any) {
    assert(false, `${msg} threw`, e && e.message);
  }
}

function main(): void {
  const readContents: Record<string, string> = {
    'a.ts': 'const a = 1;\n',
    'b.ts': 'let b = 2;\nlet b2 = 3;\n',
    'c.ts': 'x\ny\nz\n',
  };

  // ─── (1) three files, all clean → ok, per-file replacements + newContent ────
  const p1 = planMultiFileEdits({
    files: [
      { path: 'a.ts', edits: [{ oldString: 'const a = 1;', newString: 'const a = 10;' }] },
      { path: 'b.ts', edits: [
        { oldString: 'let b = 2;', newString: 'let b = 20;' },
        { oldString: 'let b2 = 3;', newString: 'let b2 = 30;' },
      ] },
      { path: 'c.ts', edits: [{ oldString: 'y', newString: 'Y' }] },
    ],
    readContents,
  });
  assert(p1.ok, '(1) all-clean plan is ok');
  assertEq(p1.failedPath, undefined, '(1) no failedPath on success');
  assertEq(p1.reason, undefined, '(1) no reason on success');
  assertEq(p1.files.length, 3, '(1) one result per file');
  assert(p1.files.every((f) => f.ok), '(1) every file ok');
  assertEq(p1.files[0].newContent, 'const a = 10;\n', '(1) a.ts planned content');
  assertEq(p1.files[0].replacements, 1, '(1) a.ts one replacement');
  assertEq(p1.files[1].newContent, 'let b = 20;\nlet b2 = 30;\n', '(1) b.ts sequential edits applied in order');
  assertEq(p1.files[1].replacements, 2, '(1) b.ts two replacements');
  assertEq(p1.files[2].newContent, 'x\nY\nz\n', '(1) c.ts planned content');
  assertEq(p1.files[2].replacements, 1, '(1) c.ts one replacement');
  // Planning must not mutate the caller's read map.
  assertEq(readContents['a.ts'], 'const a = 1;\n', '(1) source read map is not mutated');

  // ─── (2) ATOMIC: one bad oldString fails the whole plan, no partial write ───
  const p2 = planMultiFileEdits({
    files: [
      { path: 'a.ts', edits: [{ oldString: 'const a = 1;', newString: 'const a = 2;' }] }, // would apply
      { path: 'b.ts', edits: [{ oldString: 'NOT PRESENT ANYWHERE', newString: 'x' }] },     // cannot match
      { path: 'c.ts', edits: [{ oldString: 'z', newString: 'Z' }] },                        // would apply
    ],
    readContents,
  });
  assertEq(p2.ok, false, '(2) a single unmatched edit fails the whole plan');
  assertEq(p2.failedPath, 'b.ts', '(2) failedPath names the offending file');
  assert(/not found/i.test(p2.reason || ''), '(2) reason explains the match failure', p2.reason);
  assertEq(p2.files[0].ok, true, '(2) preceding good file is still validated (informative)');
  assertEq(p2.files[1].ok, false, '(2) offending file marked not ok');
  assertEq(p2.files[1].replacements, 0, '(2) failed file reports zero replacements');
  // The atomic guarantee: caller writes only when plan.ok — so nothing is applied.
  assert(p2.ok === false, '(2) atomic gate: nothing is applied when ok is false');

  // ─── (3) UNIQUENESS inherited from fileEditCore; replaceAll resolves it ─────
  const dupRead = { 'd.ts': 'k=1\nk=1\n' };
  const p3 = planMultiFileEdits({ files: [{ path: 'd.ts', edits: [{ oldString: 'k=1', newString: 'k=2' }] }], readContents: dupRead });
  assertEq(p3.ok, false, '(3) non-unique oldString fails the plan');
  assertEq(p3.failedPath, 'd.ts', '(3) failedPath set for non-unique match');
  assert(/not unique|matches/i.test(p3.reason || ''), '(3) reason mentions non-uniqueness', p3.reason);
  const p3b = planMultiFileEdits({ files: [{ path: 'd.ts', edits: [{ oldString: 'k=1', newString: 'k=2', replaceAll: true }] }], readContents: dupRead });
  assert(p3b.ok, '(3) replaceAll makes it apply');
  assertEq(p3b.files[0].replacements, 2, '(3) replaceAll counts both occurrences');
  assertEq(p3b.files[0].newContent, 'k=2\nk=2\n', '(3) replaceAll planned content');

  // ─── (4) create-in-batch: a file absent from readContents is created ───────
  const p4 = planMultiFileEdits({
    files: [
      { path: 'a.ts', edits: [{ oldString: 'const a = 1;', newString: 'const a = 9;' }] },
      { path: 'new.ts', edits: [{ oldString: '', newString: 'export const N = 1;\n' }] },
    ],
    readContents,
  });
  assert(p4.ok, '(4) edit + create in one batch is ok');
  assertEq(p4.files[1].path, 'new.ts', '(4) created file present in results');
  assertEq(p4.files[1].newContent, 'export const N = 1;\n', '(4) created file body is newString');
  assertEq(p4.files[1].replacements, 1, '(4) a create counts as one replacement');
  // A missing-content file with a NON-create edit must fail closed (never silent).
  const p4b = planMultiFileEdits({ files: [{ path: 'ghost.ts', edits: [{ oldString: 'foo', newString: 'bar' }] }], readContents: {} });
  assertEq(p4b.ok, false, '(4) edit against an unread file fails closed');
  assertEq(p4b.failedPath, 'ghost.ts', '(4) failedPath names the unread file');

  // ─── (5) duplicate path in one batch is rejected (ambiguous write) ─────────
  const p5 = planMultiFileEdits({
    files: [
      { path: 'a.ts', edits: [{ oldString: 'const a = 1;', newString: 'const a = 2;' }] },
      { path: 'a.ts', edits: [{ oldString: 'const a = 1;', newString: 'const a = 3;' }] },
    ],
    readContents,
  });
  assertEq(p5.ok, false, '(5) duplicate path fails the plan');
  assertEq(p5.failedPath, 'a.ts', '(5) failedPath is the duplicated path');
  assert(/duplicate/i.test(p5.reason || ''), '(5) reason mentions duplicate', p5.reason);

  // ─── (6) empty / malformed batch → ok:false ────────────────────────────────
  const e1 = planMultiFileEdits({ files: [], readContents: {} });
  assertEq(e1.ok, false, '(6) empty files array → not ok');
  assertEq(e1.files.length, 0, '(6) empty files → empty results');
  assert(/no files/i.test(e1.reason || ''), '(6) reason for empty batch', e1.reason);
  const e2 = planMultiFileEdits({ files: null as any, readContents: {} });
  assertEq(e2.ok, false, '(6) non-array files → not ok');
  assert(/array/i.test(e2.reason || ''), '(6) reason mentions array', e2.reason);

  // ─── (7) BOUNDS: too many files / too many edits per file ──────────────────
  const manyFiles: any[] = [];
  for (let i = 0; i < MAX_FILES_PER_PLAN + 5; i += 1) manyFiles.push({ path: `f${i}.ts`, edits: [{ oldString: '', newString: 'x' }] });
  const b1 = planMultiFileEdits({ files: manyFiles, readContents: {} });
  assertEq(b1.ok, false, '(7) batch beyond MAX_FILES_PER_PLAN rejected');
  assert(/too many files/i.test(b1.reason || ''), '(7) reason mentions too many files', b1.reason);
  assertEq(b1.files.length, 0, '(7) oversized batch plans nothing');
  // exactly at the cap is allowed (all creates)
  const atCap: any[] = [];
  for (let i = 0; i < MAX_FILES_PER_PLAN; i += 1) atCap.push({ path: `g${i}.ts`, edits: [{ oldString: '', newString: 'x' }] });
  const b1ok = planMultiFileEdits({ files: atCap, readContents: {} });
  assert(b1ok.ok, '(7) exactly MAX_FILES_PER_PLAN files is allowed');
  assertEq(b1ok.files.length, MAX_FILES_PER_PLAN, '(7) all files planned at the cap');
  // per-file edit overflow (our outer 200 guard)
  const bigEdits: any[] = [];
  for (let i = 0; i < MAX_EDITS_PER_FILE + 1; i += 1) bigEdits.push({ oldString: `q${i}`, newString: `r${i}` });
  const b2 = planMultiFileEdits({ files: [{ path: 'z.ts', edits: bigEdits }], readContents: { 'z.ts': 'q0' } });
  assertEq(b2.ok, false, '(7) edits beyond MAX_EDITS_PER_FILE rejected');
  assertEq(b2.failedPath, 'z.ts', '(7) failedPath set for edit overflow');
  assert(/too many edits/i.test(b2.reason || ''), '(7) reason mentions too many edits', b2.reason);
  // delegate's own lower batch cap also fails closed (65..200 edits)
  const midEdits: any[] = [];
  for (let i = 0; i < 70; i += 1) midEdits.push({ oldString: `qq${i}`, newString: `rr${i}` });
  const b3 = planMultiFileEdits({ files: [{ path: 'z.ts', edits: midEdits }], readContents: { 'z.ts': 'qq0' } });
  assertEq(b3.ok, false, '(7) delegate batch cap also fails closed');
  assertEq(b3.failedPath, 'z.ts', '(7) failedPath from delegate cap');

  // ─── (8) summarizeMultiFilePlan ────────────────────────────────────────────
  const s1 = summarizeMultiFilePlan(p1); // ok: a(+1) b(+2) c(+1) → 4 total
  assert(/3 files/.test(s1), '(8) summary counts files', s1);
  assert(/4 edits/.test(s1), '(8) summary totals replacements (1+2+1)', s1);
  assert(/a\.ts \(\+1\)/.test(s1), '(8) summary lists a.ts (+1)', s1);
  assert(/b\.ts \(\+2\)/.test(s1), '(8) summary lists b.ts (+2)', s1);
  const s2 = summarizeMultiFilePlan(p2); // failed at b.ts
  assert(/blocked/i.test(s2), '(8) failed summary marks blocked', s2);
  assert(/b\.ts/.test(s2), '(8) failed summary names the failed path', s2);
  assert(/no files written/i.test(s2), '(8) failed summary states nothing written', s2);
  const s1one = summarizeMultiFilePlan(planMultiFileEdits({ files: [{ path: 'a.ts', edits: [{ oldString: 'const a = 1;', newString: 'const a = 5;' }] }], readContents }));
  assert(/1 file,/.test(s1one), '(8) singular "file" for one file', s1one);
  // many-file summary stays bounded and elides
  const okMany: any[] = [];
  for (let i = 0; i < 20; i += 1) okMany.push({ path: `m${i}.ts`, edits: [{ oldString: '', newString: 'x' }] });
  const pMany = planMultiFileEdits({ files: okMany, readContents: {} });
  assert(pMany.ok, '(8) 20-file create plan is ok');
  const sMany = summarizeMultiFilePlan(pMany);
  assert(sMany.length <= 2100, '(8) summary bounded for many files', String(sMany.length));
  assert(/more/.test(sMany), '(8) summary elides beyond the listed cap', sMany);

  // ─── (9) hostile / degenerate — never throws, always safe shape ────────────
  const h1 = safe(() => planMultiFileEdits(null as any), '(9) null input');
  assertEq(h1.ok, false, '(9) null input → ok false');
  const h2 = safe(() => planMultiFileEdits(undefined as any), '(9) undefined input');
  assertEq(h2.ok, false, '(9) undefined input → ok false');
  safe(() => planMultiFileEdits(42 as any), '(9) number input');
  safe(() => planMultiFileEdits('str' as any), '(9) string input');
  safe(() => planMultiFileEdits([] as any), '(9) array input');
  safe(() => planMultiFileEdits({ files: 'nope' as any, readContents: {} }), '(9) files not an array');
  const h3 = safe(() => planMultiFileEdits({ files: [null as any], readContents: {} }), '(9) null spec element');
  assertEq(h3.ok, false, '(9) null spec → ok false');
  assertEq(h3.files[0].ok, false, '(9) null spec result not ok');
  safe(() => planMultiFileEdits({ files: [42 as any], readContents: {} }), '(9) number spec element');
  safe(() => planMultiFileEdits({ files: [{ path: 5 as any, edits: [] as any }], readContents: {} }), '(9) non-string path');
  safe(() => planMultiFileEdits({ files: [{ path: '', edits: [] as any }], readContents: {} }), '(9) empty-string path');
  safe(() => planMultiFileEdits({ files: [{ path: 'x', edits: null as any }], readContents: { x: 'a' } }), '(9) null edits');
  safe(() => planMultiFileEdits({ files: [{ path: 'x', edits: 'nope' as any }], readContents: { x: 'a' } }), '(9) string edits');
  safe(() => planMultiFileEdits({ files: [{ path: 'x', edits: [] as any }], readContents: { x: 'a' } }), '(9) empty edits array');
  safe(() => planMultiFileEdits({ files: [{ path: 'x', edits: [{ oldString: 1 as any, newString: 2 as any }] }], readContents: { x: 'a' } }), '(9) non-string edit fields');
  safe(() => planMultiFileEdits({ files: [{ path: 'x', edits: [{ oldString: 'a', newString: 'b' }] }], readContents: null as any }), '(9) null readContents');
  safe(() => planMultiFileEdits({ files: [{ path: 'x', edits: [{ oldString: 'a', newString: 'b' }] }], readContents: 'str' as any }), '(9) string readContents');
  safe(() => planMultiFileEdits({ files: [{ path: 'x', edits: [{ oldString: 'a', newString: 'b' }] }], readContents: [] as any }), '(9) array readContents');
  // prototype-pollution style keys must not leak inherited content
  const hProto = safe(() => planMultiFileEdits({ files: [{ path: 'constructor', edits: [{ oldString: 'a', newString: 'b' }] }], readContents: {} }), '(9) prototype-key path');
  assertEq(hProto.ok, false, '(9) prototype-key path reads as absent → non-create edit fails closed');
  // huge path + huge content stays bounded and does not throw
  const hugePath = 'p'.repeat(300000);
  const hugeContent = 'z'.repeat(300000);
  const hHuge = safe(
    () => planMultiFileEdits({ files: [{ path: hugePath, edits: [{ oldString: 'z', newString: 'Z', replaceAll: true }] }], readContents: { [hugePath]: hugeContent } }),
    '(9) huge path + content',
  );
  assert(hHuge.ok, '(9) huge replaceAll still plans');
  assertEq(hHuge.files[0].replacements, 300000, '(9) huge replaceAll replacement count');
  safeStr(() => summarizeMultiFilePlan(hHuge), '(9) summarize huge-path plan');

  // summarize hostile inputs
  safeStr(() => summarizeMultiFilePlan(null as any), '(9) summarize null');
  safeStr(() => summarizeMultiFilePlan(undefined as any), '(9) summarize undefined');
  safeStr(() => summarizeMultiFilePlan(42 as any), '(9) summarize number');
  safeStr(() => summarizeMultiFilePlan('str' as any), '(9) summarize string');
  safeStr(() => summarizeMultiFilePlan({} as any), '(9) summarize empty object');
  safeStr(() => summarizeMultiFilePlan({ ok: true, files: null as any } as any), '(9) summarize bad files');
  safeStr(() => summarizeMultiFilePlan({ ok: true, files: [{ path: 'x' } as any] } as any), '(9) summarize file missing replacements');

  if (failures > 0) { console.error(`\n${failures} fail`); process.exit(1); }
  console.log(`\nAll multi-file-edit-core smoke cases passed (${passes} passed).`);
}
main();
