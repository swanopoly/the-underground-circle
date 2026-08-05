/**
 * attachment-preflight-core-smoketest — pins the pure pre-send attachment
 * validator (src/lib/attachmentPreflightCore.ts) that the ChatTab
 * `sendMessage` path runs BEFORE upload so users get one upfront friendly
 * reason ("that PDF is 41 MB — max is 25 MB") instead of a silent drop or a
 * late upload failure.
 *
 * Load-bearing assertions:
 *   FORMAT: formatBytes renders clean human sizes (B/KB/MB/GB, trimmed
 *   decimals) and is total on junk / negative / NaN / Infinity / strings.
 *
 *   RULES: preflightAttachments rejects dangerous executables
 *   (.exe/.dll/.app/.sh + MIME), oversized files (> maxBytesPerFile) with a
 *   human size reason, files past maxCount, and files that would push the
 *   batch over maxTotalBytes — accepting the rest. ok is true only when at
 *   least one file is accepted; warning summarizes skips.
 *
 *   BOUNDS: huge input is capped (bounded rejected[] + accepted count);
 *   custom opts are honored and invalid opts fall back to the defaults.
 *
 *   And: every export is total — degenerate/hostile input (null, undefined,
 *   {}, [], wrong types, throwing getters, huge arrays) never throws.
 *
 * Pure — loads under tsx (attachmentPreflightCore has zero runtime imports).
 */

import {
  preflightAttachments,
  formatBytes,
  DEFAULT_MAX_ATTACHMENTS,
  DEFAULT_MAX_BYTES_PER_FILE,
  DEFAULT_MAX_TOTAL_BYTES,
  DANGEROUS_EXTENSIONS,
  type AttachmentInput,
  type AttachmentPreflight,
} from '../src/lib/attachmentPreflightCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const MB = 1024 * 1024;
const file = (name: string, sizeBytes: number, mimeType?: string): AttachmentInput => ({ name, sizeBytes, mimeType });
/** First rejection reason for a given (partial) name, or ''. */
function reasonFor(r: AttachmentPreflight, needle: string): string {
  const hit = r.rejected.find((x) => x.name.includes(needle));
  return hit ? hit.reason : '';
}

function main(): void {
  // ─── (1) formatBytes — clean human rendering ─────────────────────────────
  assertEq(formatBytes(0), '0 B', '(1) zero bytes');
  assertEq(formatBytes(500), '500 B', '(1) sub-KB stays in bytes');
  assertEq(formatBytes(1023), '1023 B', '(1) 1023 is still bytes');
  assertEq(formatBytes(1024), '1 KB', '(1) exactly 1 KB, no decimal');
  assertEq(formatBytes(1536), '1.5 KB', '(1) 1.5 KB one decimal');
  assertEq(formatBytes(MB), '1 MB', '(1) exactly 1 MB');
  assertEq(formatBytes(25 * MB), '25 MB', '(1) 25 MB integer');
  assertEq(formatBytes(41 * MB), '41 MB', '(1) 41 MB integer (the marquee example)');
  assertEq(formatBytes(60 * MB), '60 MB', '(1) 60 MB integer');
  assertEq(formatBytes(1024 * MB), '1 GB', '(1) exactly 1 GB');
  assertEq(formatBytes(1610612736), '1.5 GB', '(1) 1.5 GB one decimal');
  assertEq(formatBytes(2 * 1024 * MB), '2 GB', '(1) 2 GB integer');

  // ─── (2) formatBytes — totality on hostile input ─────────────────────────
  assertEq(formatBytes(-5), '0 B', '(2) negative → 0 B');
  assertEq(formatBytes(NaN), '0 B', '(2) NaN → 0 B');
  assertEq(formatBytes(Infinity), '0 B', '(2) Infinity → 0 B');
  assertEq(formatBytes(-Infinity), '0 B', '(2) -Infinity → 0 B');
  assertEq(formatBytes(null), '0 B', '(2) null → 0 B');
  assertEq(formatBytes(undefined), '0 B', '(2) undefined → 0 B');
  assertEq(formatBytes({}), '0 B', '(2) object → 0 B');
  assertEq(formatBytes([]), '0 B', '(2) array → 0 B');
  assertEq(formatBytes('abc'), '0 B', '(2) non-numeric string → 0 B');
  assertEq(formatBytes('1048576'), '1 MB', '(2) numeric string tolerated');
  assert(typeof formatBytes(Symbol('x') as unknown) === 'string', '(2) symbol → still a string');

  // ─── (3) exported defaults ───────────────────────────────────────────────
  assertEq(DEFAULT_MAX_ATTACHMENTS, 10, '(3) default max attachments is 10');
  assertEq(DEFAULT_MAX_BYTES_PER_FILE, 25 * MB, '(3) default per-file is 25 MB');
  assertEq(DEFAULT_MAX_TOTAL_BYTES, 60 * MB, '(3) default total is 60 MB');
  assertEq(formatBytes(DEFAULT_MAX_BYTES_PER_FILE), '25 MB', '(3) per-file default formats to 25 MB');
  assertEq(formatBytes(DEFAULT_MAX_TOTAL_BYTES), '60 MB', '(3) total default formats to 60 MB');
  assert(DANGEROUS_EXTENSIONS.has('exe') && DANGEROUS_EXTENSIONS.has('dll') && DANGEROUS_EXTENSIONS.has('app') && DANGEROUS_EXTENSIONS.has('sh'), '(3) required dangerous exts present');
  assert(!DANGEROUS_EXTENSIONS.has('pdf') && !DANGEROUS_EXTENSIONS.has('png'), '(3) safe types not flagged');

  // ─── (4) empty / non-array input → neutral, not ok ───────────────────────
  for (const bad of [null, undefined, {}, 'nope', 42, true, () => []] as unknown[]) {
    const r = preflightAttachments(bad);
    assertEq(r.ok, false, `(4) non-array ${String(bad)} → ok false`);
    assertEq(r.acceptedCount, 0, `(4) non-array ${String(bad)} → 0 accepted`);
    assertEq(r.rejected.length, 0, `(4) non-array ${String(bad)} → empty rejected`);
    assertEq(r.warning, null, `(4) non-array ${String(bad)} → null warning`);
  }
  const rEmpty = preflightAttachments([]);
  assertEq(rEmpty.ok, false, '(4) empty array → ok false');
  assertEq(rEmpty.warning, null, '(4) empty array → null warning');

  // ─── (5) happy path — all files accepted ─────────────────────────────────
  const r5 = preflightAttachments([
    file('shot.png', 2 * MB, 'image/png'),
    file('notes.pdf', 3 * MB, 'application/pdf'),
    file('data.csv', 1 * MB, 'text/csv'),
  ]);
  assertEq(r5.ok, true, '(5) all-valid batch is ok');
  assertEq(r5.acceptedCount, 3, '(5) all three accepted');
  assertEq(r5.rejected.length, 0, '(5) nothing rejected');
  assertEq(r5.warning, null, '(5) no warning when nothing skipped');

  // ─── (6) oversized single file → rejected, human reason, not ok ──────────
  const r6 = preflightAttachments([file('huge.pdf', 41 * MB, 'application/pdf')]);
  assertEq(r6.ok, false, '(6) lone oversized file → not ok');
  assertEq(r6.acceptedCount, 0, '(6) oversized file not accepted');
  assertEq(r6.rejected.length, 1, '(6) one rejection');
  assertEq(r6.rejected[0].name, 'huge.pdf', '(6) rejection carries the file name');
  assertEq(r6.rejected[0].reason, 'that PDF is 41 MB — max is 25 MB', '(6) exact marquee reason copy');
  assertEq(r6.warning, "That file couldn't be attached.", '(6) single all-rejected warning');

  // ─── (7) oversize noun derivation (image / video / plain file) ───────────
  const r7 = preflightAttachments([
    file('big.pdf', 30 * MB, 'application/pdf'),
    file('big.jpg', 30 * MB, 'image/jpeg'),
    file('clip.mp4', 30 * MB, 'video/mp4'),
    file('archive.zip', 30 * MB, 'application/zip'),
    { sizeBytes: 30 * MB, mimeType: 'application/pdf' }, // no name → PDF via mime
  ]);
  assertEq(reasonFor(r7, 'big.pdf'), 'that PDF is 30 MB — max is 25 MB', '(7) pdf noun');
  assertEq(reasonFor(r7, 'big.jpg'), 'that image is 30 MB — max is 25 MB', '(7) image noun');
  assertEq(reasonFor(r7, 'clip.mp4'), 'that video is 30 MB — max is 25 MB', '(7) video noun');
  assertEq(reasonFor(r7, 'archive.zip'), 'that file is 30 MB — max is 25 MB', '(7) generic noun');
  assertEq(reasonFor(r7, 'unnamed'), 'that PDF is 30 MB — max is 25 MB', '(7) noun from mime when name missing');
  assertEq(r7.acceptedCount, 0, '(7) all oversized → none accepted');

  // ─── (8) dangerous executables rejected (extension + MIME) ───────────────
  const r8 = preflightAttachments([
    file('safe.png', 1 * MB, 'image/png'),
    file('malware.exe', 1 * MB),
    file('lib.dll', 1 * MB),
    file('Bundle.app', 1 * MB),
    file('run.sh', 1 * MB),
    { name: 'installer', sizeBytes: 1 * MB, mimeType: 'application/x-sh' }, // dangerous via MIME, no ext
  ]);
  assertEq(r8.acceptedCount, 1, '(8) only the png survives');
  assertEq(r8.ok, true, '(8) still ok because one file accepted');
  assertEq(reasonFor(r8, 'malware.exe'), ".exe files can't be attached for security", '(8) .exe reason');
  assertEq(reasonFor(r8, 'lib.dll'), ".dll files can't be attached for security", '(8) .dll reason');
  assertEq(reasonFor(r8, 'Bundle.app'), ".app files can't be attached for security", '(8) .app reason');
  assertEq(reasonFor(r8, 'run.sh'), ".sh files can't be attached for security", '(8) .sh reason');
  assertEq(reasonFor(r8, 'installer'), "that file type can't be attached for security", '(8) MIME-only danger reason');
  assertEq(r8.warning, 'Sending 1 file; skipped 5.', '(8) skip summary warning');

  // ─── (9) count limit (default 10) → extras rejected ──────────────────────
  const twelve = Array.from({ length: 12 }, (_, i) => file(`f${i}.png`, 1 * MB, 'image/png'));
  const r9 = preflightAttachments(twelve);
  assertEq(r9.acceptedCount, 10, '(9) accepts exactly maxCount (10)');
  assertEq(r9.ok, true, '(9) ok — 10 accepted');
  assertEq(r9.rejected.length, 2, '(9) two extras rejected');
  assertEq(reasonFor(r9, 'f10.png'), 'too many files — max is 10 at once', '(9) count reason copy');
  assertEq(r9.warning, 'Sending 10 files; skipped 2.', '(9) count skip warning');

  // ─── (10) total-bytes limit → budget overflow rejected ───────────────────
  const r10 = preflightAttachments([
    file('a.mov', 20 * MB, 'video/quicktime'),
    file('b.mov', 20 * MB, 'video/quicktime'),
    file('c.mov', 20 * MB, 'video/quicktime'), // 60 MB total, exactly at cap → accepted
    file('d.mov', 20 * MB, 'video/quicktime'), // would be 80 MB → rejected
  ]);
  assertEq(r10.acceptedCount, 3, '(10) three fit under the 60 MB total');
  assertEq(r10.rejected.length, 1, '(10) fourth rejected on total budget');
  assertEq(reasonFor(r10, 'd.mov'), 'skipped to keep this batch under 60 MB', '(10) total reason copy');
  assertEq(r10.ok, true, '(10) ok — three accepted');

  // ─── (11) precedence — dangerous beats oversize beats count ──────────────
  const r11 = preflightAttachments([file('trap.exe', 999 * MB)]);
  assertEq(reasonFor(r11, 'trap.exe'), ".exe files can't be attached for security", '(11) dangerous checked before size');

  // ─── (12) custom opts honored ────────────────────────────────────────────
  const r12a = preflightAttachments([file('a.png', 5 * MB, 'image/png')], { maxBytesPerFile: 1 * MB });
  assertEq(r12a.acceptedCount, 0, '(12) tighter per-file limit rejects 5 MB');
  assertEq(r12a.rejected[0].reason, 'that image is 5 MB — max is 1 MB', '(12) reason reflects custom limit');

  const r12b = preflightAttachments(
    [file('a.png', 1 * MB), file('b.png', 1 * MB), file('c.png', 1 * MB)],
    { maxCount: 2 },
  );
  assertEq(r12b.acceptedCount, 2, '(12) custom maxCount honored');
  assertEq(reasonFor(r12b, 'c.png'), 'too many files — max is 2 at once', '(12) custom count reason');

  const r12c = preflightAttachments(
    [file('a.png', 5 * MB), file('b.png', 5 * MB)],
    { maxTotalBytes: 8 * MB },
  );
  assertEq(r12c.acceptedCount, 1, '(12) custom total budget honored');
  assertEq(reasonFor(r12c, 'b.png'), 'skipped to keep this batch under 8 MB', '(12) custom total reason');

  // ─── (13) invalid opts fall back to defaults ─────────────────────────────
  const oversized = [file('x.png', 30 * MB, 'image/png')];
  for (const badOpt of [{ maxBytesPerFile: 0 }, { maxBytesPerFile: -1 }, { maxBytesPerFile: NaN }, { maxBytesPerFile: 'big' as unknown as number }]) {
    const r = preflightAttachments(oversized, badOpt);
    assertEq(r.rejected[0]?.reason, 'that image is 30 MB — max is 25 MB', `(13) invalid opt ${JSON.stringify(badOpt)} → default 25 MB`);
  }
  const rCountBad = preflightAttachments(twelve, { maxCount: 0 });
  assertEq(rCountBad.acceptedCount, 10, '(13) maxCount 0 falls back to default 10');
  const rCountNeg = preflightAttachments(twelve, { maxCount: -5 });
  assertEq(rCountNeg.acceptedCount, 10, '(13) negative maxCount falls back to default 10');

  // ─── (14) unknown-size files are size-tolerated ──────────────────────────
  const r14 = preflightAttachments([
    { name: 'mystery.dat', mimeType: 'application/octet-stream' }, // no size
    { name: 'known.png', sizeBytes: 2 * MB, mimeType: 'image/png' },
  ]);
  assertEq(r14.acceptedCount, 2, '(14) missing size is not an oversize failure');
  assertEq(r14.ok, true, '(14) ok with unknown-size file accepted');

  // ─── (15) huge input is bounded ──────────────────────────────────────────
  const huge = Array.from({ length: 1200 }, () => file('f.png', 1000, 'image/png'));
  const r15 = preflightAttachments(huge);
  assertEq(r15.acceptedCount, 10, '(15) accepted capped by maxCount even on 1200 items');
  assert(r15.rejected.length <= 25, '(15) rejected[] bounded', `len ${r15.rejected.length}`);
  assertEq(r15.warning, 'Sending 10 files; skipped 1190.', '(15) warning summarizes all 1190 skips');
  assertEq(r15.ok, true, '(15) still ok');

  // ─── (16) junk array entries tolerated as transparent skips ──────────────
  const r16 = preflightAttachments([
    null,
    undefined,
    7,
    'not-a-file',
    file('real.png', 1 * MB, 'image/png'),
  ]);
  assertEq(r16.acceptedCount, 1, '(16) only the real file is accepted');
  assertEq(r16.ok, true, '(16) ok — one real file survived the junk');
  assert(r16.rejected.some((x) => x.reason === 'empty or unreadable attachment'), '(16) junk entries rejected transparently');

  const r16b = preflightAttachments([null, undefined, {}]);
  assertEq(r16b.ok, false, '(16) all-junk batch → not ok');
  assertEq(r16b.acceptedCount, 0, '(16) all-junk → nothing accepted');
  assertEq(r16b.warning, 'None of these files could be attached.', '(16) all-rejected multi warning');

  // ─── (17) return-shape invariants ────────────────────────────────────────
  assert(Array.isArray(r5.rejected), '(17) rejected is always an array');
  assert(typeof r5.ok === 'boolean', '(17) ok is a boolean');
  assert(typeof r5.acceptedCount === 'number' && r5.acceptedCount >= 0, '(17) acceptedCount is a non-negative number');
  assert(r6.warning === null || typeof r6.warning === 'string', '(17) warning is string|null');
  for (const entry of r8.rejected) {
    assert(typeof entry.name === 'string' && typeof entry.reason === 'string', '(17) rejection entries are {name,reason} strings');
  }

  // ─── (18) totality — throw hostile input at every export (no throw) ──────
  const hostile: unknown[] = [
    null, undefined, {}, [], '', 'x', 0, 42, -1, NaN, true, false,
    Symbol('sym'),
    () => { throw new Error('never'); },
    [null, undefined, 7, {}],
    [{ get name() { throw new Error('boom-name'); }, get sizeBytes() { throw new Error('boom-size'); }, get mimeType() { throw new Error('boom-mime'); } }],
    [Object.create(null)],
    [{ name: 123, sizeBytes: 'huge', mimeType: {} }],
    [{ name: 'a'.repeat(100000), sizeBytes: Number.MAX_VALUE, mimeType: 'x'.repeat(100000) }],
    new Array(5000).fill({ name: 'f.exe', sizeBytes: -1 }),
  ];
  for (const h of hostile) {
    try {
      const r = preflightAttachments(h);
      assert(typeof r.ok === 'boolean' && Array.isArray(r.rejected), '(18) hostile input yields a well-formed result');
      formatBytes(h);
      passes += 1;
    } catch (err) {
      failures += 1;
      console.error(`FAIL: (18) export threw on hostile input :: ${String(err)}`);
    }
  }

  // Throwing-getter element must degrade to a transparent skip, not throw.
  const rTrap = preflightAttachments([
    { get name() { throw new Error('boom'); }, get sizeBytes() { throw new Error('boom'); }, get mimeType() { throw new Error('boom'); } },
    file('ok.png', 1 * MB, 'image/png'),
  ]);
  assertEq(rTrap.acceptedCount, 1, '(18) throwing-getter element does not block the good file');
  assert(rTrap.rejected.some((x) => x.reason === 'empty or unreadable attachment'), '(18) throwing-getter degrades to junk skip');

  // Oversized name is bounded in the returned rejection.
  const rLongName = preflightAttachments([{ name: 'z'.repeat(100000) + '.exe', sizeBytes: 1 * MB }]);
  assert(rLongName.rejected[0].name.length <= 120, '(18) rejected name is bounded', `len ${rLongName.rejected[0].name.length}`);

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll attachment-preflight-core smoke cases passed (${passes} passed).`);
}

main();
