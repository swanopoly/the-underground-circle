/**
 * folder-watch-smoketest — verifies the pure local-folder-watch model
 * (`src/lib/folderWatchModel.ts`): task encode/decode round-trips and the
 * rejection matrix (traversal, charset, pipes, bounds), conservative
 * free-text detection (well-known folder shorthands, explicit ~ paths,
 * "for new pdfs" → *.pdf, URL/domain text → null), runner-side pattern
 * matching, snapshot bounding (≤100 rows), snapshot diffing (added /
 * removed / changed, garbage-prev tolerance, ≤400-char summary), and the
 * chat copy carrying the honest runs-while-the-app-is-open constraint.
 *
 * Pure module — no supabase, no react-native, no desktop bridge.
 *
 * Run: npx tsx scripts/folder-watch-smoketest.ts
 */

import {
  FOLDER_DIFF_SUMMARY_MAX_CHARS,
  FOLDER_SNAPSHOT_MAX_FILES,
  FOLDER_WATCH_TASK_PREFIX,
  buildFolderSnapshotFindings,
  decodeFolderWatchTask,
  describeFolderWatchForChat,
  detectFolderWatchRequest,
  diffFolderSnapshots,
  encodeFolderWatchTask,
  formatFolderWatchLabel,
  isFolderWatchTask,
  matchesFolderWatchPattern,
  type FolderSnapshotFinding,
} from '../src/lib/folderWatchModel';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function snapshotRow(partial: Partial<FolderSnapshotFinding> & { name: string }): FolderSnapshotFinding {
  return { kind: 'file', sizeBytes: null, modifiedAt: null, ...partial };
}

// ── Encode / decode round-trip ──────────────────────────────────────────────

{
  expect(FOLDER_WATCH_TASK_PREFIX === 'local-folder:', 'prefix is the lockstep literal local-folder:');

  const plain = encodeFolderWatchTask({ path: '~/Downloads' });
  expect(plain === 'local-folder: ~/Downloads', 'encode path-only → "local-folder: ~/Downloads"');
  expect(isFolderWatchTask(plain!), 'isFolderWatchTask recognizes encoded task');
  const decodedPlain = decodeFolderWatchTask(plain!);
  expect(!!decodedPlain && decodedPlain.path === '~/Downloads' && decodedPlain.pattern === null,
    'path-only round-trip: path back, pattern null');

  const withPattern = encodeFolderWatchTask({ path: '~/Downloads', pattern: '*.pdf' });
  expect(withPattern === 'local-folder: ~/Downloads | *.pdf', 'encode with pattern uses " | " separator');
  const decodedPattern = decodeFolderWatchTask(withPattern!);
  expect(!!decodedPattern && decodedPattern.path === '~/Downloads' && decodedPattern.pattern === '*.pdf',
    'pattern round-trips through encode → decode');

  const messy = encodeFolderWatchTask({ path: '  "~/My   Project Files/"  ', pattern: ' *.png ' });
  expect(messy === 'local-folder: ~/My Project Files | *.png',
    'encode normalizes quotes, whitespace runs, and trailing slash');

  const home = encodeFolderWatchTask({ path: '~' });
  expect(home === 'local-folder: ~', 'bare ~ (home) is encodable');
  expect(decodeFolderWatchTask(home!)?.path === '~', 'bare ~ decodes back');

  const users = encodeFolderWatchTask({ path: '/Users/cswanson/Projects/drops' });
  expect(decodeFolderWatchTask(users!)?.path === '/Users/cswanson/Projects/drops', '/Users path round-trips');

  pass('encode/decode round-trip');
}

// ── Decode discriminator + tolerance ────────────────────────────────────────

{
  expect(decodeFolderWatchTask('check the pricing page for changes') === null, 'page-watch task decodes to null');
  expect(decodeFolderWatchTask('') === null, 'empty task → null');
  expect(decodeFolderWatchTask('local-folders: ~/Downloads') === null, 'near-miss prefix (local-folders:) → null');
  expect(isFolderWatchTask('check the pricing page') === false, 'isFolderWatchTask false for page task');

  const upper = decodeFolderWatchTask('LOCAL-FOLDER: ~/Downloads');
  expect(!!upper && upper.path === '~/Downloads', 'prefix match is case-insensitive');

  expect(decodeFolderWatchTask('local-folder:') === null, 'prefix with no path → null');
  expect(decodeFolderWatchTask('local-folder: ..') === null, 'corrupt traversal path → null (fail closed)');
  expect(decodeFolderWatchTask('local-folder: ~/Downloads | bad|pattern') === null,
    'pattern containing a second pipe → null (fail closed)');
  expect(decodeFolderWatchTask('local-folder: ~/Downloads | $(rm -rf)') === null,
    'pattern outside the charset → null (fail closed)');

  pass('decode discriminator + corrupt-row fail-closed');
}

// ── Encode rejection matrix ─────────────────────────────────────────────────

{
  expect(encodeFolderWatchTask({ path: '~/Downloads/../.ssh' }) === null, 'traversal ~/Downloads/../.ssh rejected');
  expect(encodeFolderWatchTask({ path: '~/..' }) === null, 'traversal ~/.. rejected');
  expect(encodeFolderWatchTask({ path: '/Users/x/../../etc' }) === null, 'traversal inside /Users path rejected');
  expect(encodeFolderWatchTask({ path: 'Downloads' }) === null, 'relative path rejected');
  expect(encodeFolderWatchTask({ path: './drops' }) === null, 'dot-relative path rejected');
  expect(encodeFolderWatchTask({ path: '/' }) === null, 'bare filesystem root rejected');
  expect(encodeFolderWatchTask({ path: '' }) === null, 'empty path rejected');
  expect(encodeFolderWatchTask({ path: '~/a|b' }) === null, 'pipe in path rejected (encoding separator)');
  expect(encodeFolderWatchTask({ path: `~/` + 'a'.repeat(300) }) === null, 'path over 300 chars rejected');
  expect(encodeFolderWatchTask({ path: `~/` + 'a'.repeat(200) }) !== null, 'long-but-legal path accepted');

  expect(encodeFolderWatchTask({ path: '~/Downloads', pattern: '*.pdf; rm -rf /' }) === null,
    'pattern outside [A-Za-z0-9*._ -] rejected (never silently widened)');
  expect(encodeFolderWatchTask({ path: '~/Downloads', pattern: 'a|b' }) === null, 'pipe in pattern rejected');
  expect(encodeFolderWatchTask({ path: '~/Downloads', pattern: 'x'.repeat(61) }) === null,
    'pattern over 60 chars rejected');
  expect(encodeFolderWatchTask({ path: '~/Downloads', pattern: '   ' }) === 'local-folder: ~/Downloads',
    'blank pattern treated as absent, not invalid');
  expect(encodeFolderWatchTask({ path: '~/Downloads', pattern: 'invoice 2026-q1' }) !== null,
    'spaces, digits and hyphens allowed in pattern');

  pass('encode rejection matrix');
}

// ── Free-text detection: folder phrasings ───────────────────────────────────

{
  const downloads = detectFolderWatchRequest('watch my downloads folder for new files, tell me in chat');
  expect(!!downloads && downloads.path === '~/Downloads', '"watch my downloads folder" → ~/Downloads');
  expect(!!downloads && downloads.pattern === null, '"for new files" is generic → no pattern');

  const pdfs = detectFolderWatchRequest('watch my Downloads folder for new pdfs');
  expect(!!pdfs && pdfs.path === '~/Downloads' && pdfs.pattern === '*.pdf', '"for new pdfs" → *.pdf');

  const desktop = detectFolderWatchRequest('watch ~/Desktop for new pdfs');
  expect(!!desktop && desktop.path === '~/Desktop' && desktop.pattern === '*.pdf',
    'explicit ~/Desktop path + "for new pdfs"');

  const invoices = detectFolderWatchRequest('watch the folder ~/Documents/Invoices');
  expect(!!invoices && invoices.path === '~/Documents/Invoices', 'explicit ~/Documents/Invoices path');

  const myDesktop = detectFolderWatchRequest('watch my desktop');
  expect(!!myDesktop && myDesktop.path === '~/Desktop', '"watch my desktop" shorthand → ~/Desktop');

  const documents = detectFolderWatchRequest('watch the documents folder');
  expect(!!documents && documents.path === '~/Documents', '"the documents folder" shorthand → ~/Documents');

  const usersPath = detectFolderWatchRequest('watch /Users/cswanson/Projects/drops for new zips');
  expect(!!usersPath && usersPath.path === '/Users/cswanson/Projects/drops' && usersPath.pattern === '*.zip',
    'explicit /Users path + "for new zips" → *.zip');

  const quoted = detectFolderWatchRequest('watch the folder "~/My Project Files" for new pngs');
  expect(!!quoted && quoted.path === '~/My Project Files' && quoted.pattern === '*.png',
    'quoted path with spaces detected');

  const glob = detectFolderWatchRequest('watch ~/Desktop for *.png files');
  expect(!!glob && glob.pattern === '*.png', 'explicit *.png glob token extracted');

  const dmgs = detectFolderWatchRequest('watch my downloads for new dmgs');
  expect(!!dmgs && dmgs.path === '~/Downloads' && dmgs.pattern === '*.dmg', '"my downloads" + dmgs shorthand');

  const trailingPunct = detectFolderWatchRequest('please watch ~/Downloads.');
  expect(!!trailingPunct && trailingPunct.path === '~/Downloads', 'trailing punctuation stripped from path token');

  pass('detection: folder phrasings');
}

// ── Free-text detection: cadence hints ──────────────────────────────────────

{
  const hourly = detectFolderWatchRequest('watch my downloads folder every hour');
  expect(!!hourly && hourly.cadencePhraseHint === 'hourly', '"every hour" → hourly hint');
  const weekly = detectFolderWatchRequest('watch my downloads folder weekly');
  expect(!!weekly && weekly.cadencePhraseHint === 'weekly', '"weekly" → weekly hint');
  const daily = detectFolderWatchRequest('watch my downloads folder once a day');
  expect(!!daily && daily.cadencePhraseHint === 'daily', '"once a day" → daily hint');
  const none = detectFolderWatchRequest('watch my downloads folder');
  expect(!!none && none.cadencePhraseHint === null, 'no cadence phrase → null hint');
  pass('detection: cadence hints');
}

// ── Free-text detection: rejections ─────────────────────────────────────────

{
  expect(detectFolderWatchRequest('my downloads folder') === null, 'no watch verb → null');
  expect(detectFolderWatchRequest('watch https://example.com/pricing for changes') === null,
    'http(s) URL → null (page watch)');
  expect(detectFolderWatchRequest('watch example.com for price drops') === null, 'bare domain → null');
  expect(detectFolderWatchRequest('watch www.example.org for updates') === null, 'www.-token → null');
  expect(detectFolderWatchRequest('watch the downloads page on cars.com') === null,
    'domain plus folder-adjacent words → null');
  expect(detectFolderWatchRequest('watch the downloads page for new links') === null,
    '"the downloads page" is not a folder → null');
  expect(detectFolderWatchRequest('watch the desktop app for updates') === null,
    '"the desktop app" is not a folder → null');
  expect(detectFolderWatchRequest('watch the pricing page for changes') === null,
    'ordinary page-watch task → null');
  expect(detectFolderWatchRequest('watch for new deals') === null, 'no folder/path at all → null');
  expect(detectFolderWatchRequest('watch ~/Downloads/../.ssh') === null,
    'explicit traversal path → null (fail closed, no shorthand fallback)');
  expect(detectFolderWatchRequest('') === null, 'empty text → null');
  pass('detection: rejections (URLs, non-folders, traversal)');
}

// ── Pattern matching (runner-side filter) ───────────────────────────────────

{
  expect(matchesFolderWatchPattern('Report.PDF', '*.pdf'), '*.pdf matches case-insensitively');
  expect(!matchesFolderWatchPattern('report.pdfx', '*.pdf'), '*.pdf is an extension match, not substring');
  expect(!matchesFolderWatchPattern('archive.png', '*.pdf'), 'wrong extension rejected');
  expect(matchesFolderWatchPattern('Invoice-2026.pdf', 'invoice'), 'plain pattern is a substring match');
  expect(matchesFolderWatchPattern('INVOICE.pdf', 'invoice'), 'substring match is case-insensitive');
  expect(!matchesFolderWatchPattern('notes.txt', 'invoice'), 'non-matching substring rejected');
  expect(matchesFolderWatchPattern('anything.bin', null), 'null pattern matches everything');
  expect(matchesFolderWatchPattern('anything.bin', ''), 'empty pattern matches everything');
  expect(matchesFolderWatchPattern('report-final.pdf', 'report*'), 'stray * in substring pattern tolerated');
  pass('pattern matching');
}

// ── Snapshot bounding ───────────────────────────────────────────────────────

{
  const many = Array.from({ length: 150 }, (_, i) => ({
    name: `file-${String(i).padStart(3, '0')}.pdf`,
    sizeBytes: i,
    modifiedAt: '2026-07-01T00:00:00Z',
  }));
  const bounded = buildFolderSnapshotFindings(many);
  expect(bounded.length === FOLDER_SNAPSHOT_MAX_FILES, `snapshot bounded to ${FOLDER_SNAPSHOT_MAX_FILES} rows`);
  expect(bounded.every((row) => row.kind === 'file'), 'every snapshot row is kind:file');
  expect(bounded[0].name === 'file-000.pdf' && bounded[99].name === 'file-099.pdf',
    'rows sorted by name before bounding (deterministic)');

  const messy = buildFolderSnapshotFindings([
    { name: 'z.txt', sizeBytes: Number.NaN, modifiedAt: '' },
    { name: '  ', sizeBytes: 1 },
    { name: 'a'.repeat(250), sizeBytes: 5, modifiedAt: '2026-07-01T00:00:00Z' },
    { name: 'b.png' },
  ]);
  expect(messy.length === 3, 'blank-name entries dropped');
  expect(messy[0].name.length === 200, 'oversized names clamped to 200 chars');
  expect(messy[0].name.endsWith('…'), 'clamped name marked with ellipsis');
  const zRow = messy.find((row) => row.name === 'z.txt');
  expect(!!zRow && zRow.sizeBytes === null && zRow.modifiedAt === null,
    'NaN size / empty mtime coerce to null');
  expect(buildFolderSnapshotFindings([]).length === 0, 'empty entries → empty snapshot');
  pass('snapshot bounding + coercion');
}

// ── Diff correctness ────────────────────────────────────────────────────────

{
  const prev = [
    snapshotRow({ name: 'a.pdf', sizeBytes: 100, modifiedAt: '2026-07-01T00:00:00Z' }),
    snapshotRow({ name: 'gone.txt', sizeBytes: 5 }),
    snapshotRow({ name: 'grew.zip', sizeBytes: 10, modifiedAt: '2026-07-01T00:00:00Z' }),
    snapshotRow({ name: 'touched.md', sizeBytes: 7, modifiedAt: '2026-07-01T00:00:00Z' }),
  ];
  const next = [
    snapshotRow({ name: 'a.pdf', sizeBytes: 100, modifiedAt: '2026-07-01T00:00:00Z' }),
    snapshotRow({ name: 'new.png', sizeBytes: 3 }),
    snapshotRow({ name: 'grew.zip', sizeBytes: 999, modifiedAt: '2026-07-01T00:00:00Z' }),
    snapshotRow({ name: 'touched.md', sizeBytes: 7, modifiedAt: '2026-07-02T09:00:00Z' }),
  ];
  const diff = diffFolderSnapshots(prev, next);
  expect(diff.added.length === 1 && diff.added[0] === 'new.png', 'added detected');
  expect(diff.removed.length === 1 && diff.removed[0] === 'gone.txt', 'removed detected');
  expect(diff.changed.includes('grew.zip'), 'size move detected as changed');
  expect(diff.changed.includes('touched.md'), 'mtime move detected as changed');
  expect(!diff.changed.includes('a.pdf'), 'identical file not marked changed');
  expect(diff.hasChanges === true, 'hasChanges true when anything moved');
  expect(diff.summary.includes('1 new: new.png'), 'summary names the new file');
  expect(diff.summary.includes('1 removed: gone.txt'), 'summary names the removed file');
  expect(diff.summary.includes('2 changed'), 'summary counts changed files');

  const same = diffFolderSnapshots(next, next);
  expect(same.hasChanges === false, 'identical snapshots → no changes');
  expect(same.added.length === 0 && same.removed.length === 0 && same.changed.length === 0,
    'identical snapshots → empty buckets');
  expect(/no changes/i.test(same.summary) && same.summary.includes('4 files'),
    'no-change summary says so and counts tracked files');

  const firstRun = diffFolderSnapshots(null, next);
  expect(firstRun.added.length === 4 && firstRun.hasChanges === true,
    'null prev (first run) → everything added, page-watch parity');
  expect(!/unreadable/i.test(firstRun.summary), 'null prev is NOT flagged unreadable');
  pass('diff correctness');
}

// ── Diff: garbage-prev tolerance + summary bound ────────────────────────────

{
  const next = [snapshotRow({ name: 'a.pdf', sizeBytes: 1 })];

  const fromString = diffFolderSnapshots('garbage' as unknown as unknown[], next);
  expect(fromString.added.length === 1, 'non-array prev treated as empty (all added)');
  expect(/unreadable/i.test(fromString.summary), 'non-array prev flagged in summary');

  const browserRows = [
    { title: 'MacBook Pro 14', url: 'https://example.com/mbp', price: '$1,999' },
    { title: 'Old finding', notes: 'from a page watch' },
  ];
  const fromBrowser = diffFolderSnapshots(browserRows as unknown[], next);
  expect(fromBrowser.added.length === 1 && fromBrowser.removed.length === 0,
    'old browser findings rows coerce to empty baseline');
  expect(/unreadable/i.test(fromBrowser.summary), 'browser-row prev flagged in summary');

  const mixed = diffFolderSnapshots(
    [snapshotRow({ name: 'a.pdf', sizeBytes: 1 }), { title: 'stray browser row' }] as unknown[],
    next,
  );
  expect(mixed.added.length === 0 && mixed.hasChanges === false,
    'valid rows inside a partly-garbage prev still diff');
  expect(!/unreadable/i.test(mixed.summary), 'partly-valid prev not flagged unreadable');

  const bigNext = Array.from({ length: 100 }, (_, i) =>
    snapshotRow({ name: `${'long-name-'.repeat(8)}${i}.pdf`, sizeBytes: i }));
  const bigDiff = diffFolderSnapshots([], bigNext);
  expect(bigDiff.summary.length <= FOLDER_DIFF_SUMMARY_MAX_CHARS,
    `summary clamped to ${FOLDER_DIFF_SUMMARY_MAX_CHARS} chars`);
  expect(bigDiff.summary.includes('100 new'), 'clamped summary still leads with the count');
  expect(bigDiff.summary.includes('+97 more'), 'added names truncated to 3 with +N more');
  pass('diff garbage tolerance + summary bound');
}

// ── Chat copy ───────────────────────────────────────────────────────────────

{
  const described = describeFolderWatchForChat({ path: '~/Downloads', pattern: '*.pdf', cadence: 'daily' });
  expect(described.includes('~/Downloads'), 'describe includes the path');
  expect(described.includes('(*.pdf)'), 'describe includes the pattern');
  expect(described.includes('every day'), 'describe includes the cadence phrase');
  expect(described.includes('runs while the app is open'), 'describe carries the honest while-open caveat');
  expect(described.includes('local desktop bridge'), 'describe names the local desktop bridge');
  expect(!described.includes('\n'), 'describe is a single line');

  const noPattern = describeFolderWatchForChat({ path: '~/Desktop', cadence: 'hourly' });
  expect(noPattern.includes('~/Desktop —'), 'no pattern → no parens after the path');
  expect(noPattern.includes('every hour'), 'hourly cadence phrased');

  expect(formatFolderWatchLabel({ path: '~/Downloads', pattern: '*.pdf' }) === '📁 ~/Downloads (*.pdf)',
    'label is the 📁 path (pattern) form');
  expect(formatFolderWatchLabel({ path: '~/Desktop' }) === '📁 ~/Desktop', 'label without pattern');
  pass('chat copy (describe + label)');
}

if (failures > 0) {
  console.error(`\n${failures} folder watch smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll folder watch smoke cases passed.');
