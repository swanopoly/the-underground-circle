/**
 * wordpress-media-upload-smoketest — offline guard for the pure raw-binary
 * media-upload helpers (WP R6).
 *
 * Run: npm run smoke:wordpress-media-upload
 */

import {
  sanitizeMediaFilename,
  resolveUploadMimeType,
  buildMediaUploadHeaders,
  buildCaptionFollowUpBody,
} from '../src/lib/wordpressMediaUpload';

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function pass(message: string): void {
  console.log('pass:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

// ── sanitizeMediaFilename ──────────────────────────────────────────────────
assert(sanitizeMediaFilename('a\r\nX: y.png') === 'aX: y.png', 'CRLF stripped from filename');
assert(!sanitizeMediaFilename('a\r\nX: y.png').includes('\n'), 'no newline leaks');
assert(sanitizeMediaFilename('he"llo\'.png') === 'hello.png', 'quotes stripped');
assert(sanitizeMediaFilename('../../etc/passwd.png') === 'passwd.png', 'path traversal reduced to basename');
assert(sanitizeMediaFilename('dir\\sub\\file.jpg') === 'file.jpg', 'backslash path reduced to basename');
assert(sanitizeMediaFilename('   ') === 'upload', 'whitespace-only -> upload');
assert(sanitizeMediaFilename('') === 'upload', 'empty -> upload');
assert(sanitizeMediaFilename(null) === 'upload', 'null -> upload');

// ── resolveUploadMimeType ──────────────────────────────────────────────────
assert(resolveUploadMimeType('', 'photo.png') === 'image/png', 'empty blobType + png filename -> image/png');
assert(resolveUploadMimeType('image/jpeg', 'whatever.bin') === 'image/jpeg', 'explicit mime passes through');
assert(resolveUploadMimeType('IMAGE/JPEG', 'x') === 'image/jpeg', 'mime lowercased');
assert(resolveUploadMimeType(undefined, 'doc.pdf') === 'application/pdf', 'pdf extension mapped');
assert(resolveUploadMimeType(null, 'clip.mp4') === 'video/mp4', 'mp4 extension mapped');
assert(resolveUploadMimeType('', 'mystery.xyz') === null, 'unknown extension -> null (caller keeps multipart)');
assert(resolveUploadMimeType('', 'noext') === null, 'no extension -> null');

// ── buildMediaUploadHeaders ────────────────────────────────────────────────
const headers = buildMediaUploadHeaders({
  authorization: 'Basic abc123',
  mimeType: 'image/png',
  filename: 'a\r\nb".png',
});
assert(headers.Authorization === 'Basic abc123', 'Authorization passed through unchanged');
assert(headers['Content-Type'] === 'image/png', 'Content-Type set to mime verbatim');
assert(
  headers['Content-Disposition'] === 'attachment; filename="ab.png"',
  'Content-Disposition uses sanitized filename',
  headers['Content-Disposition'],
);
assert(!headers['Content-Disposition'].includes('\n'), 'disposition has no raw CRLF');
assert((headers['Content-Disposition'].match(/"/g) || []).length === 2, 'disposition has exactly two quotes');

// ── buildCaptionFollowUpBody ───────────────────────────────────────────────
assert(JSON.stringify(buildCaptionFollowUpBody('hi')) === JSON.stringify({ caption: 'hi' }), 'non-empty caption -> { caption }');
assert(JSON.stringify(buildCaptionFollowUpBody('  trimmed  ')) === JSON.stringify({ caption: 'trimmed' }), 'caption trimmed');
assert(buildCaptionFollowUpBody('') === null, 'empty caption -> null');
assert(buildCaptionFollowUpBody('   ') === null, 'whitespace caption -> null');
assert(buildCaptionFollowUpBody(undefined) === null, 'undefined caption -> null');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nwordpress-media-upload-smoketest: all assertions passed.');
