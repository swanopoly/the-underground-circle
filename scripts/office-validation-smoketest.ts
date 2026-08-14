/**
 * office-validation-smoketest
 *
 * Office customization is untrusted input (labels, notes, URLs, base64 images,
 * the whole layout JSON). This pins the sanitize/validate guards — especially:
 *  - sanitizeOfficeText removes ALL occurrences of a dangerous pattern (not just
 *    the first) and patterns re-formed by an earlier removal;
 *  - validateOfficeLayout FAILS CLOSED instead of throwing on malformed input;
 *  - saved floors and items are normalized into render-safe canonical shapes.
 *
 * Run: npm run smoke:office-validation
 */

import assert from 'node:assert/strict';

import {
  constrainOfficeFurnitureGeometry,
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
assert.equal(validateOfficeLayout(Symbol('bad') as any).valid, false, 'non-JSON root rejected without throwing');
assert.equal(validateOfficeLayout(Number.NaN as any).valid, false, 'non-object root rejected');

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
assert.equal(malformed.sanitizedLayout.floors.length, 1, 'malformed floor rows are dropped');
assert.equal(malformed.sanitizedLayout.floors[0].id, 'floor_2', 'missing floor id is generated');
assert.deepEqual(malformed.sanitizedLayout.floors[0].furniture, [], 'structurally unusable items are dropped');
assert.doesNotThrow(() => validateOfficeLayout({ floors: [{ furniture: [{ nftImageUrl: 12345 }] }] }), 'non-string nftImageUrl does not crash');

// Limits still enforced.
const tooManyFloors = validateOfficeLayout({ floors: Array.from({ length: 11 }, () => ({})) });
assert.equal(tooManyFloors.valid, false, '>10 floors rejected');
const tooMuchFurniture = validateOfficeLayout({ floors: [{ furniture: Array.from({ length: 101 }, () => ({})) }] });
assert.equal(tooMuchFurniture.valid, false, '>100 furniture rejected');

// Nested untrusted fields are actually sanitized + url/image-validated.
const dirty: any = {
  floors: [{
    id: 'floor-safe',
    furniture: [{
      id: 'video-safe', type: 'video_call', x: 12, y: 20,
      label: '<script>x</script>danger', videoCallLink: 'javascript:evil',
      nftImageUrl: 'data:image/svg+xml,<svg>',
      worldClockZones: { malformed: true }, roguePluginPayload: { nested: true },
    }],
  }],
  currentFloorId: 'floor-safe',
};
const cleaned = validateOfficeLayout(dirty);
assert.equal(cleaned.valid, true, 'sanitizable layout is valid after cleaning');
const item = cleaned.sanitizedLayout.floors[0].furniture[0];
assert(!/<script/i.test(item.label), 'nested label sanitized');
assert.equal(item.videoCallLink, null, 'dangerous nested videoCallLink nulled');
assert.equal(item.nftImageUrl, null, 'invalid nested nftImageUrl (svg) nulled');

const durableFarm = validateOfficeLayout({
  floors: [{ id: 'farm-floor', furniture: [{
    id: 'farm', type: 'farm_plot', x: 10, y: 210,
    farmUpgrades: JSON.stringify(['sprinkler', 'scarecrow']),
    farmFertilizerUses: 5,
    farmCropsGrown: JSON.stringify(['t', 'w']),
  }] }],
  currentFloorId: 'farm-floor',
});
assert.equal(durableFarm.sanitizedLayout.floors[0].furniture[0].farmFertilizerUses, 5, 'Farm fertilizer progress survives the layout trust boundary');
assert.equal(durableFarm.sanitizedLayout.floors[0].furniture[0].farmUpgrades, '["sprinkler","scarecrow"]', 'Farm upgrades survive the layout trust boundary');
assert.equal(durableFarm.sanitizedLayout.floors[0].furniture[0].farmCropsGrown, '["t","w"]', 'Farm achievements survive the layout trust boundary');
assert.equal(item.worldClockZones, undefined, 'mistyped renderer state is stripped');
assert.equal(item.roguePluginPayload, undefined, 'unknown nested item payload is stripped');

// Unknown add-ons never reach render switches. A valid sibling survives.
const unknownType = validateOfficeLayout({
  floors: [{
    id: 'main', name: 'Main', themeId: 'underground', order: 0, agentIds: [],
    furniture: [
      { id: 'legacy-plugin', type: 'not_a_real_addon', x: 1, y: 2, itemWidth: 30, itemHeight: 30 },
      { id: 'desk', type: 'desk', x: 4, y: 5 },
    ],
  }],
  currentFloorId: 'main',
});
assert.equal(unknownType.valid, true, 'unknown item type is recoverable');
assert.deepEqual(unknownType.sanitizedLayout.floors[0].furniture.map((entry: any) => entry.type), ['desk'], 'unknown item type is dropped');
assert.equal(unknownType.sanitizedLayout.floors[0].furniture[0].itemWidth, 100, 'legacy missing width gets canonical catalog width');
assert.equal(unknownType.sanitizedLayout.floors[0].furniture[0].itemHeight, 50, 'legacy missing height gets canonical catalog height');

// Non-finite positions are unusable; bad/missing dimensions normalize to
// canonical values, and every surviving rectangle is bounded to the floor.
const geometry = validateOfficeLayout({
  floors: [{
    id: 'geometry', furniture: [
      { id: 'nan-position', type: 'desk', x: Number.NaN, y: 2, itemWidth: 30, itemHeight: 30 },
      { id: 'missing-size', type: 'plant', x: 899, y: 969 },
      { id: 'bad-size', type: 'couch', x: -500, y: 5_000, itemWidth: -2, itemHeight: 99_999 },
    ],
  }],
  currentFloorId: 'geometry',
});
assert.equal(geometry.valid, true, 'malformed geometry is recovered without rejecting healthy siblings');
assert.equal(geometry.sanitizedLayout.floors[0].furniture.length, 2, 'non-finite position item is dropped');
for (const entry of geometry.sanitizedLayout.floors[0].furniture) {
  assert(Number.isFinite(entry.x) && entry.x >= 0, 'x is finite and non-negative');
  assert(Number.isFinite(entry.y) && entry.y >= 0, 'y is finite and non-negative');
  assert(Number.isFinite(entry.itemWidth) && entry.itemWidth >= 16 && entry.x + entry.itemWidth <= 900, 'width is finite and floor-bounded');
  assert(Number.isFinite(entry.itemHeight) && entry.itemHeight >= 16 && entry.y + entry.itemHeight <= 970, 'height is finite and floor-bounded');
}

// Rotation is center-based, so the visual bounding box—not only the stored
// unrotated rectangle—must remain within the 900x970 floor.
const rotatedAtEdge = constrainOfficeFurnitureGeometry({
  x: 899,
  y: 969,
  itemWidth: 100,
  itemHeight: 50,
  rotation: 90,
});
assert.equal(rotatedAtEdge.x, 800, '90-degree rotation keeps the layout box inside the right edge');
assert.equal(rotatedAtEdge.y, 895, '90-degree rotation shifts the visual footprint above the bottom edge');
assert.equal(rotatedAtEdge.rotatedWidth, 50, '90-degree rotated width is exact');
assert.equal(rotatedAtEdge.rotatedHeight, 100, '90-degree rotated height is exact');

const arbitraryRotation = constrainOfficeFurnitureGeometry({
  x: -1_000,
  y: 9_000,
  itemWidth: 900,
  itemHeight: 970,
  rotation: 45,
});
const arbitraryLeft = arbitraryRotation.x + (arbitraryRotation.itemWidth - arbitraryRotation.rotatedWidth) / 2;
const arbitraryTop = arbitraryRotation.y + (arbitraryRotation.itemHeight - arbitraryRotation.rotatedHeight) / 2;
assert(arbitraryLeft >= -1e-9, 'arbitrary rotation visual left edge is floor-bounded');
assert(arbitraryTop >= -1e-9, 'arbitrary rotation visual top edge is floor-bounded');
assert(arbitraryLeft + arbitraryRotation.rotatedWidth <= 900 + 1e-9, 'arbitrary rotation visual right edge is floor-bounded');
assert(arbitraryTop + arbitraryRotation.rotatedHeight <= 970 + 1e-9, 'arbitrary rotation visual bottom edge is floor-bounded');

const hydratedRotation = validateOfficeLayout({
  floors: [{ id: 'rotated', furniture: [{
    id: 'edge-desk', type: 'desk', x: 899, y: 969, itemWidth: 100, itemHeight: 50, rotation: 90,
  }] }],
  currentFloorId: 'rotated',
});
assert.equal(hydratedRotation.sanitizedLayout.floors[0].furniture[0].y, 895, 'hydration uses rotation-aware geometry');

// Floor/item ids are always present and unique, and a stale current-floor id
// deterministically falls back to the first surviving floor.
const badIds = validateOfficeLayout({
  floors: [
    { id: 'same id', furniture: [{ id: 'dup', type: 'desk', x: 1, y: 1 }, { id: 'dup', type: 'plant', x: 2, y: 2 }] },
    ['malformed floor'],
    { id: 'same id', furniture: [] },
  ],
  currentFloorId: 'deleted-floor',
});
assert.equal(badIds.valid, true, 'bad ids and malformed floor are recoverable');
assert.deepEqual(badIds.sanitizedLayout.floors.map((floor: any) => floor.id), ['same_id', 'same_id_2'], 'floor ids are normalized and deduplicated');
assert.deepEqual(badIds.sanitizedLayout.floors[0].furniture.map((entry: any) => entry.id), ['dup', 'dup_2'], 'item ids are deduplicated');
assert.equal(badIds.sanitizedLayout.currentFloorId, 'same_id', 'bad currentFloorId falls back to first usable floor');
assert(badIds.sanitizedLayout.floors.some((floor: any) => floor.id === badIds.sanitizedLayout.currentFloorId), 'currentFloorId always names a surviving floor');

console.log('All office validation smoke cases passed.');
