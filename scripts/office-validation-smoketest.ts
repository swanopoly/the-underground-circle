/**
 * office-validation-smoketest
 *
 * Office customization is untrusted input (labels, notes, URLs, base64 images,
 * the whole layout JSON). This pins the sanitize/validate guards — especially:
 *  - sanitizeOfficeText removes ALL occurrences of a dangerous pattern (not just
 *    the first) and patterns re-formed by an earlier removal;
 *  - validateOfficeLayout FAILS CLOSED instead of throwing on malformed input
 *    (circular refs, null floors/items, non-string image URLs).
 *
 * Run: npm run smoke:office-validation
 */

import assert from 'node:assert/strict';

import {
  sanitizeOfficeText,
  validateOfficeUrl,
  validateBase64Image,
  validateOfficeLayout,
} from '../src/lib/officeValidation';

// ── sanitizeOfficeText ───────────────────────────────────────────────────────
assert.equal(sanitizeOfficeText('' as any), '', 'empty → empty');
assert.equal(sanitizeOfficeText(null as any), '', 'null → empty');
assert.equal(sanitizeOfficeText(42 as any), '', 'non-string → empty');
assert.equal(sanitizeOfficeText('hello world'), 'hello world', 'plain text passes through');
assert.equal(sanitizeOfficeText('<b>bold</b> text'), 'bold text', 'HTML tags stripped');
// All occurrences removed (was: only the first).
assert(!/javascript:/i.test(sanitizeOfficeText('javascript:javascript:alert(1)')), 'every javascript: removed');
assert(!/onerror/i.test(sanitizeOfficeText('onerror=a onerror=b')), 'every onerror= removed');
// A pattern re-formed by an earlier removal is also caught (loop-until-stable).
assert(!/<script/i.test(sanitizeOfficeText('<scr<script>ipt>x')), 'reconstructed <script removed');
assert(!/javascript:/i.test(sanitizeOfficeText('javascjavascript:ript:x')), 'reconstructed javascript: removed');
// Length clamp still applies.
assert.equal(sanitizeOfficeText('a'.repeat(300), 50).length, 50, 'clamped to maxLength');

// ── validateOfficeUrl ────────────────────────────────────────────────────────
assert.equal(validateOfficeUrl('', 'genericUrl').valid, false, 'empty URL invalid');
assert.equal(validateOfficeUrl('javascript:alert(1)', 'genericUrl').valid, false, 'javascript: blocked');
assert.equal(validateOfficeUrl('data:text/html,x', 'genericUrl').valid, false, 'data: blocked');
assert.equal(validateOfficeUrl('http://insecure.com', 'genericUrl').valid, false, 'plain http rejected (https only)');
assert.equal(validateOfficeUrl('https://anything.com/x', 'genericUrl').valid, true, 'https generic ok');
assert.equal(validateOfficeUrl('https://zoom.us/j/123', 'videoCallLink').valid, true, 'zoom video link ok');
assert.equal(validateOfficeUrl('https://evil.com/j/123', 'videoCallLink').valid, false, 'non-allowlisted video host rejected');
// Lookalike host must not slip past the host-boundary anchor.
assert.equal(validateOfficeUrl('https://zoom.us.evil.com/x', 'videoCallLink').valid, false, 'zoom.us.evil.com rejected');
assert.equal(validateOfficeUrl('myrepo/cool-thing', 'githubRepo').valid, true, 'github owner/repo ok');
assert.equal(validateOfficeUrl('https://figma.com.evil.com/', 'figmaBoardUrl').valid, false, 'figma lookalike rejected');

// ── validateBase64Image ──────────────────────────────────────────────────────
assert.equal(validateBase64Image('data:image/png;base64,iVBOR').valid, true, 'png ok');
assert.equal(validateBase64Image('data:image/svg+xml,<svg>').valid, false, 'svg rejected');
assert.equal(validateBase64Image('data:text/html,x').valid, false, 'non-image rejected');
assert.equal(validateBase64Image('data:image/png;base64,' + 'A'.repeat(200 * 1024)).valid, false, 'oversized rejected');

// ── validateOfficeLayout: fail-closed, never throws ──────────────────────────
assert.equal(validateOfficeLayout(null).valid, true, 'null layout is a no-op valid');

// Circular layout → rejected, NOT thrown.
const circular: any = { floors: [] };
circular.self = circular;
const circularResult = validateOfficeLayout(circular);
assert.equal(circularResult.valid, false, 'circular layout rejected');
assert(circularResult.errors[0].includes('serializable'), 'circular layout names the reason');

// Null floor / null item / non-string image URL → no throw, treated safely.
let malformed: any;
assert.doesNotThrow(() => { malformed = validateOfficeLayout({ floors: [null, { furniture: [null, { label: 'ok' }] }] }); }, 'null floor/item does not crash');
assert.equal(malformed.valid, true, 'malformed-but-bounded layout is sanitized, not crashed');
assert.doesNotThrow(() => validateOfficeLayout({ floors: [{ furniture: [{ nftImageUrl: 12345 }] }] }), 'non-string nftImageUrl does not crash');

// Limits still enforced.
const tooManyFloors = validateOfficeLayout({ floors: Array.from({ length: 11 }, () => ({})) });
assert.equal(tooManyFloors.valid, false, '>10 floors rejected');
const tooMuchFurniture = validateOfficeLayout({ floors: [{ furniture: Array.from({ length: 101 }, () => ({})) }] });
assert.equal(tooMuchFurniture.valid, false, '>100 furniture rejected');

// Nested untrusted fields are actually sanitized + url/image-validated.
const dirty: any = { floors: [{ furniture: [{ label: '<script>x</script>danger', videoCallLink: 'javascript:evil', nftImageUrl: 'data:image/svg+xml,<svg>' }] }] };
const cleaned = validateOfficeLayout(dirty);
assert.equal(cleaned.valid, true, 'sanitizable layout is valid after cleaning');
const item = cleaned.sanitizedLayout.floors[0].furniture[0];
assert(!/<script/i.test(item.label), 'nested label sanitized');
assert.equal(item.videoCallLink, null, 'dangerous nested videoCallLink nulled');
assert.equal(item.nftImageUrl, null, 'invalid nested nftImageUrl (svg) nulled');

console.log('All office validation smoke cases passed.');
