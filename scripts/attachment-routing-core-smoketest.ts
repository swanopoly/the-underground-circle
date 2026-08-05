/**
 * attachment-routing-core-smoketest — the PURE attachment classification +
 * consumption-routing core (src/lib/attachmentRoutingCore.ts). It turns the
 * blobs on a chat turn into per-item {category, lane, needsVision} plus the
 * turn-level plan (visionRequired / desktopCandidate / needsTextExtraction /
 * needsSummarization + fixed-keyset laneCounts/categoryCounts + count-only
 * summary) so multimodal input dispatches to a capable path instead of being
 * flattened into a base64 stub.
 *
 * Load-bearing assertions:
 *   GOLDEN: png→image/vision/needsVision; 40KB .ts w/ extracted text→code/inline_text;
 *   5MB .csv→data/summarize_oversize; 12MB .png→image/reference_only (over vision
 *   size); .pdf no-text→document/extract_then_inline; .psd→desktop_handoff_candidate;
 *   .zip→archive/reference_only; .mp3→audio/reference_only.
 *   PLAN: visionRequired/desktopCandidate/needsTextExtraction/needsSummarization
 *   booleans; laneCounts & categoryCounts each sum to items.length with their full
 *   fixed keyset; count-only summary contains a digit but no filename.
 *   BOUNDS: 10k array → items===MAX_ROUTED_ITEMS; name/reason/summary clamped.
 *   DETERMINISM: identical input twice → identical JSON.
 *   HOSTILE: null/undefined/''/number/{}/'str'/NaN/bigint/huge/control-chars/
 *   cyclic/throwing-proxy/__proto__+constructor+toString keys/path-traversal &
 *   data-uri & emoji filenames → never throw, bounded, no phantom count buckets,
 *   no prototype pollution, no secret echo.
 *
 * Pure — loads under tsx (attachmentRoutingCore has zero imports).
 * Run: npx tsx scripts/attachment-routing-core-smoketest.ts
 */

import {
  classifyAttachment,
  routeAttachment,
  planAttachmentRouting,
  DEFAULT_MAX_INLINE_TEXT_CHARS,
  DEFAULT_MAX_VISION_IMAGE_BYTES,
  DEFAULT_MAX_EXTRACT_BYTES,
  MAX_ROUTED_ITEMS,
  MAX_NAME_CHARS,
  MAX_REASON_CHARS,
  MAX_SUMMARY_CHARS,
  type AttachmentCategory,
  type AttachmentRouteLane,
  type AttachmentRoutingPlan,
  type RoutedAttachment,
} from '../src/lib/attachmentRoutingCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function assertLE(a: number, b: number, m: string): void {
  assert(typeof a === 'number' && a <= b, m, 'got ' + a + ' want <= ' + b);
}
function assertNoThrow(fn: () => void, m: string): void {
  let threw = false;
  let err = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    try {
      err = String((e as Error)?.message ?? e);
    } catch {
      err = 'unstringifiable';
    }
  }
  assert(!threw, m, err);
}

// ── code-point + control-char helpers ────────────────────────────────────────
const cpLen = (s: string): number => Array.from(s).length;

function noControlChars(s: string): boolean {
  if (typeof s !== 'string') return false;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c <= 0x9f) || c === 0x2028 || c === 0x2029) return false;
    if (c >= 0xe0000 && c <= 0xe007f) return false;
  }
  return true;
}
function hasLoneSurrogate(s: string): boolean {
  for (const ch of Array.from(s)) {
    if (ch.length === 1) {
      const c = ch.charCodeAt(0);
      if (c >= 0xd800 && c <= 0xdfff) return true;
    }
  }
  return false;
}

const ALL_LANES: AttachmentRouteLane[] = [
  'vision', 'inline_text', 'extract_then_inline', 'summarize_oversize',
  'desktop_handoff_candidate', 'reference_only',
];
const ALL_CATEGORIES: AttachmentCategory[] = [
  'image', 'document', 'code', 'data', 'log', 'archive', 'audio', 'video', 'unknown',
];

function sumValues(o: Record<string, number>): number {
  let t = 0;
  for (const k of Object.keys(o)) t += o[k];
  return t;
}

/** Structural + bounds check for a RoutedAttachment. */
function wellFormedItem(it: RoutedAttachment): boolean {
  return (
    !!it &&
    typeof it === 'object' &&
    typeof it.index === 'number' &&
    typeof it.name === 'string' &&
    cpLen(it.name) <= MAX_NAME_CHARS &&
    noControlChars(it.name) &&
    !hasLoneSurrogate(it.name) &&
    (ALL_CATEGORIES as string[]).includes(it.category) &&
    (ALL_LANES as string[]).includes(it.lane) &&
    typeof it.needsVision === 'boolean' &&
    it.needsVision === (it.lane === 'vision') &&
    typeof it.reason === 'string' &&
    cpLen(it.reason) <= MAX_REASON_CHARS &&
    noControlChars(it.reason)
  );
}

/** Structural + bounds check for a whole plan. */
function wellFormedPlan(p: AttachmentRoutingPlan): boolean {
  if (!p || typeof p !== 'object') return false;
  if (!Array.isArray(p.items)) return false;
  if (p.items.length > MAX_ROUTED_ITEMS) return false;
  if (!p.items.every(wellFormedItem)) return false;
  // fixed keysets
  if (Object.keys(p.laneCounts).sort().join(',') !== [...ALL_LANES].sort().join(',')) return false;
  if (Object.keys(p.categoryCounts).sort().join(',') !== [...ALL_CATEGORIES].sort().join(',')) return false;
  // counts sum to items.length
  if (sumValues(p.laneCounts as Record<string, number>) !== p.items.length) return false;
  if (sumValues(p.categoryCounts as Record<string, number>) !== p.items.length) return false;
  // booleans consistent with counts
  if (p.visionRequired !== (p.laneCounts.vision > 0)) return false;
  if (p.desktopCandidate !== (p.laneCounts.desktop_handoff_candidate > 0)) return false;
  if (p.needsTextExtraction !== (p.laneCounts.extract_then_inline > 0)) return false;
  if (p.needsSummarization !== (p.laneCounts.summarize_oversize > 0)) return false;
  if (typeof p.summary !== 'string') return false;
  if (cpLen(p.summary) > MAX_SUMMARY_CHARS) return false;
  if (!noControlChars(p.summary)) return false;
  return true;
}

const KB = 1024;
const MB = 1024 * 1024;

function main(): void {
  // ─── (1) exported constants ────────────────────────────────────────────────
  assertEq(DEFAULT_MAX_INLINE_TEXT_CHARS, 8000, '(1) inline text default');
  assertEq(DEFAULT_MAX_VISION_IMAGE_BYTES, 5 * MB, '(1) vision image byte default');
  assertEq(DEFAULT_MAX_EXTRACT_BYTES, 2 * MB, '(1) extract byte default');
  assertEq(MAX_ROUTED_ITEMS, 64, '(1) max routed items');
  assertEq(MAX_NAME_CHARS, 120, '(1) max name chars');
  assertEq(MAX_REASON_CHARS, 120, '(1) max reason chars');
  assertEq(MAX_SUMMARY_CHARS, 200, '(1) max summary chars');

  // ─── (2) classifyAttachment — mime-first + extension ───────────────────────
  assertEq(classifyAttachment({ mimeType: 'image/png' }), 'image', '(2) image/* mime → image');
  assertEq(classifyAttachment({ mimeType: 'audio/mpeg' }), 'audio', '(2) audio/* mime → audio');
  assertEq(classifyAttachment({ mimeType: 'video/mp4' }), 'video', '(2) video/* mime → video');
  assertEq(classifyAttachment({ mimeType: 'application/pdf' }), 'document', '(2) application/pdf → document');
  assertEq(classifyAttachment({ mimeType: 'application/zip' }), 'archive', '(2) application/zip → archive');
  assertEq(classifyAttachment({ mimeType: 'application/x-tar' }), 'archive', '(2) x-tar → archive');
  assertEq(classifyAttachment({ name: 'main.ts' }), 'code', '(2) .ts → code');
  assertEq(classifyAttachment({ name: 'server.py' }), 'code', '(2) .py → code');
  assertEq(classifyAttachment({ name: 'data.csv' }), 'data', '(2) .csv → data');
  assertEq(classifyAttachment({ name: 'config.yaml' }), 'data', '(2) .yaml → data');
  assertEq(classifyAttachment({ name: 'sheet.xlsx' }), 'data', '(2) .xlsx → data (category), desktop is a lane concern');
  assertEq(classifyAttachment({ name: 'server.log' }), 'log', '(2) .log → log');
  assertEq(classifyAttachment({ name: 'error_log.txt' }), 'log', '(2) .txt named *_log → log');
  assertEq(classifyAttachment({ name: 'catalog.txt' }), 'document', '(2) catalog.txt is NOT a log (token boundary)');
  assertEq(classifyAttachment({ name: 'notes.md' }), 'document', '(2) .md → document');
  assertEq(classifyAttachment({ name: 'paper.pdf' }), 'document', '(2) .pdf ext → document');
  assertEq(classifyAttachment({ name: 'photo.png' }), 'image', '(2) .png ext → image');
  assertEq(classifyAttachment({ name: 'clip.mov' }), 'video', '(2) .mov → video');
  assertEq(classifyAttachment({ name: 'song.mp3' }), 'audio', '(2) .mp3 → audio');
  assertEq(classifyAttachment({ name: 'bundle.zip' }), 'archive', '(2) .zip → archive');
  assertEq(classifyAttachment({ name: 'mystery.qqq' }), 'unknown', '(2) unknown ext → unknown');
  assertEq(classifyAttachment({ name: 'noext' }), 'unknown', '(2) no ext, no mime → unknown');
  assertEq(classifyAttachment({ name: 'art.psd' }), 'unknown', '(2) .psd has no content category → unknown');
  assertEq(classifyAttachment({ name: 'plain', mimeType: 'text/plain' }), 'document', '(2) generic text/* → document');
  // mime wins for image even if ext would say otherwise
  assertEq(classifyAttachment({ name: 'foo.ts', mimeType: 'image/png' }), 'image', '(2) mime image/* beats .ts ext');

  // ─── (3) routeAttachment — golden lanes ────────────────────────────────────
  const png = routeAttachment({ name: 'photo.png', mimeType: 'image/png', sizeBytes: 300 * KB });
  assertEq(png.category, 'image', '(3) png category image');
  assertEq(png.lane, 'vision', '(3) png lane vision');
  assertEq(png.needsVision, true, '(3) png needsVision true');
  assertEq(png.name, 'photo.png', '(3) png name echoed');

  const ts = routeAttachment({ name: 'main.ts', sizeBytes: 40 * KB, hasExtractedText: true, extractedTextChars: 1200 });
  assertEq(ts.category, 'code', '(3) 40KB .ts category code');
  assertEq(ts.lane, 'inline_text', '(3) 40KB .ts w/ small extracted text → inline_text');
  assertEq(ts.needsVision, false, '(3) .ts needsVision false');

  const csv = routeAttachment({ name: 'big.csv', sizeBytes: 5 * MB });
  assertEq(csv.category, 'data', '(3) 5MB .csv category data');
  assertEq(csv.lane, 'summarize_oversize', '(3) 5MB .csv → summarize_oversize (over extract budget)');

  const bigPng = routeAttachment({ name: 'huge.png', mimeType: 'image/png', sizeBytes: 12 * MB });
  assertEq(bigPng.category, 'image', '(3) 12MB .png category image');
  assertEq(bigPng.lane, 'reference_only', '(3) 12MB .png over vision size → reference_only');
  assertEq(bigPng.needsVision, false, '(3) oversize image needsVision false');

  const pdf = routeAttachment({ name: 'doc.pdf', mimeType: 'application/pdf', hasExtractedText: false });
  assertEq(pdf.category, 'document', '(3) pdf category document');
  assertEq(pdf.lane, 'extract_then_inline', '(3) pdf no extracted text → extract_then_inline');

  const psd = routeAttachment({ name: 'design.psd', sizeBytes: 8 * MB });
  assertEq(psd.lane, 'desktop_handoff_candidate', '(3) .psd → desktop_handoff_candidate');
  assertEq(psd.needsVision, false, '(3) .psd needsVision false');

  const zip = routeAttachment({ name: 'archive.zip', sizeBytes: 1 * MB });
  assertEq(zip.category, 'archive', '(3) zip category archive');
  assertEq(zip.lane, 'reference_only', '(3) zip → reference_only');

  const mp3 = routeAttachment({ name: 'track.mp3', mimeType: 'audio/mpeg' });
  assertEq(mp3.category, 'audio', '(3) mp3 category audio');
  assertEq(mp3.lane, 'reference_only', '(3) mp3 → reference_only');

  // app-native beats image: a .psd delivered with an image mime still goes desktop
  const psdImageMime = routeAttachment({ name: 'layered.psd', mimeType: 'image/vnd.adobe.photoshop', sizeBytes: 3 * MB });
  assertEq(psdImageMime.lane, 'desktop_handoff_candidate', '(3) app-native forces desktop even with image mime');
  // xlsx is data category but app-native → desktop lane
  const xlsx = routeAttachment({ name: 'report.xlsx', sizeBytes: 20 * KB });
  assertEq(xlsx.category, 'data', '(3) xlsx category data');
  assertEq(xlsx.lane, 'desktop_handoff_candidate', '(3) xlsx app-native → desktop lane');
  // a .ai illustrator file with pdf mime → desktop
  const aiFile = routeAttachment({ name: 'logo.ai', mimeType: 'application/pdf' });
  assertEq(aiFile.lane, 'desktop_handoff_candidate', '(3) .ai app-native → desktop even w/ pdf mime');

  // ─── (4) routeAttachment — text-bearing budget boundaries ──────────────────
  // in-hand text exactly at inline budget → inline
  const atInline = routeAttachment({ name: 'a.md', hasExtractedText: true, extractedTextChars: DEFAULT_MAX_INLINE_TEXT_CHARS });
  assertEq(atInline.lane, 'inline_text', '(4) extractedTextChars == budget → inline_text');
  // one over inline budget → summarize
  const overInline = routeAttachment({ name: 'a.md', hasExtractedText: true, extractedTextChars: DEFAULT_MAX_INLINE_TEXT_CHARS + 1 });
  assertEq(overInline.lane, 'summarize_oversize', '(4) extractedTextChars > budget → summarize_oversize');
  // small code file, no extracted text yet → extract_then_inline
  const smallNoText = routeAttachment({ name: 'util.py', sizeBytes: 5 * KB });
  assertEq(smallNoText.lane, 'extract_then_inline', '(4) small text-bearing, no extracted text → extract_then_inline');
  // file exactly at extract budget (no text) → still extract (not > budget)
  const atExtract = routeAttachment({ name: 'x.json', sizeBytes: DEFAULT_MAX_EXTRACT_BYTES });
  assertEq(atExtract.lane, 'extract_then_inline', '(4) size == extract budget → extract_then_inline');
  // one byte over extract budget (no text) → summarize
  const overExtract = routeAttachment({ name: 'x.json', sizeBytes: DEFAULT_MAX_EXTRACT_BYTES + 1 });
  assertEq(overExtract.lane, 'summarize_oversize', '(4) size > extract budget → summarize_oversize');
  // image exactly at vision budget → vision
  const atVision = routeAttachment({ name: 'v.png', mimeType: 'image/png', sizeBytes: DEFAULT_MAX_VISION_IMAGE_BYTES });
  assertEq(atVision.lane, 'vision', '(4) image size == vision budget → vision');
  // custom opts respected
  const tiny = routeAttachment({ name: 'z.txt', hasExtractedText: true, extractedTextChars: 500 }, { maxInlineTextChars: 100 });
  assertEq(tiny.lane, 'summarize_oversize', '(4) custom maxInlineTextChars honored');
  // unknown category → reference_only
  const unk = routeAttachment({ name: 'thing.qqq', sizeBytes: 10 });
  assertEq(unk.lane, 'reference_only', '(4) unknown category → reference_only');

  // reason is secret-safe: enums + byte size, no filename, no base64/text
  assert(!png.reason.includes('photo'), '(4) reason has no filename (png)');
  assert(!csv.reason.includes('big'), '(4) reason has no filename (csv)');
  ALL_LANES.forEach(() => {});
  assert(png.reason.length > 0 && noControlChars(png.reason), '(4) png reason non-empty + clean');

  // ─── (5) planAttachmentRouting — aggregation ───────────────────────────────
  const batch = planAttachmentRouting([
    { name: 'a.png', mimeType: 'image/png', sizeBytes: 200 * KB },
    { name: 'b.png', mimeType: 'image/png', sizeBytes: 200 * KB },
    { name: 'main.ts', sizeBytes: 40 * KB, hasExtractedText: true, extractedTextChars: 1200 },
    { name: 'big.csv', sizeBytes: 5 * MB },
    { name: 'doc.pdf', mimeType: 'application/pdf' },
    { name: 'design.psd', sizeBytes: 8 * MB },
    { name: 'archive.zip' },
    { name: 'track.mp3', mimeType: 'audio/mpeg' },
  ]);
  assert(wellFormedPlan(batch), '(5) batch plan well-formed', JSON.stringify(batch.laneCounts));
  assertEq(batch.items.length, 8, '(5) 8 items routed');
  assertEq(batch.laneCounts.vision, 2, '(5) 2 vision lanes');
  assertEq(batch.laneCounts.inline_text, 1, '(5) 1 inline_text lane');
  assertEq(batch.laneCounts.summarize_oversize, 1, '(5) 1 summarize lane');
  assertEq(batch.laneCounts.extract_then_inline, 1, '(5) 1 extract lane');
  assertEq(batch.laneCounts.desktop_handoff_candidate, 1, '(5) 1 desktop lane');
  assertEq(batch.laneCounts.reference_only, 2, '(5) 2 reference lanes (zip + mp3)');
  assertEq(batch.categoryCounts.image, 2, '(5) 2 image categories');
  assertEq(batch.categoryCounts.code, 1, '(5) 1 code category');
  assertEq(batch.categoryCounts.data, 1, '(5) 1 data category');
  assertEq(batch.categoryCounts.document, 1, '(5) 1 document category');
  assertEq(batch.categoryCounts.unknown, 1, '(5) 1 unknown category (psd)');
  assertEq(batch.categoryCounts.archive, 1, '(5) 1 archive category');
  assertEq(batch.categoryCounts.audio, 1, '(5) 1 audio category');
  assertEq(sumValues(batch.laneCounts as Record<string, number>), 8, '(5) laneCounts sum == items.length');
  assertEq(sumValues(batch.categoryCounts as Record<string, number>), 8, '(5) categoryCounts sum == items.length');
  assertEq(batch.visionRequired, true, '(5) visionRequired true');
  assertEq(batch.desktopCandidate, true, '(5) desktopCandidate true');
  assertEq(batch.needsTextExtraction, true, '(5) needsTextExtraction true');
  assertEq(batch.needsSummarization, true, '(5) needsSummarization true');
  // indices are the batch positions
  assertEq(batch.items[0].index, 0, '(5) first item index 0');
  assertEq(batch.items[7].index, 7, '(5) last item index 7');

  // summary is count-only: has a digit, mentions vision, no filename
  assert(/\d/.test(batch.summary), '(5) summary contains a digit');
  assert(batch.summary.includes('vision'), '(5) summary mentions vision routing');
  assert(!batch.summary.includes('.png') && !batch.summary.includes('main') && !batch.summary.includes('design'), '(5) summary carries NO filename');
  assertLE(cpLen(batch.summary), MAX_SUMMARY_CHARS, '(5) summary bounded');

  // all-vision batch → only vision booleans set
  const visOnly = planAttachmentRouting([
    { name: 'a.png', mimeType: 'image/png' },
    { name: 'b.jpg', mimeType: 'image/jpeg' },
  ]);
  assertEq(visOnly.visionRequired, true, '(5) vision-only visionRequired');
  assertEq(visOnly.desktopCandidate, false, '(5) vision-only desktopCandidate false');
  assertEq(visOnly.needsSummarization, false, '(5) vision-only needsSummarization false');

  // empty array → empty plan, but full fixed keysets
  const emptyArr = planAttachmentRouting([]);
  assert(wellFormedPlan(emptyArr), '(5) empty array → well-formed empty plan');
  assertEq(emptyArr.items.length, 0, '(5) empty array items 0');
  assertEq(emptyArr.summary, '', '(5) empty array summary is empty');
  assertEq(Object.keys(emptyArr.laneCounts).length, 6, '(5) empty plan still has 6 lane keys');
  assertEq(Object.keys(emptyArr.categoryCounts).length, 9, '(5) empty plan still has 9 category keys');

  // ─── (6) bounds — MAX_ROUTED_ITEMS + clamping ──────────────────────────────
  const many = planAttachmentRouting(Array.from({ length: 10_000 }, () => ({ name: 'x.png', mimeType: 'image/png' })));
  assertEq(many.items.length, MAX_ROUTED_ITEMS, '(6) 10k array clamped to MAX_ROUTED_ITEMS');
  assert(wellFormedPlan(many), '(6) clamped plan still well-formed');
  assertEq(sumValues(many.laneCounts as Record<string, number>), MAX_ROUTED_ITEMS, '(6) clamped laneCounts sum == MAX_ROUTED_ITEMS');

  // very long name preserved-extension clamp, code-point safe
  const longName = 'z'.repeat(500) + '.pdf';
  const longRouted = routeAttachment({ name: longName, mimeType: 'application/pdf' });
  assertLE(cpLen(longRouted.name), MAX_NAME_CHARS, '(6) long name clamped to MAX_NAME_CHARS');
  assert(longRouted.name.endsWith('.pdf'), '(6) long name preserves extension');

  // ─── (7) determinism ───────────────────────────────────────────────────────
  const detInput = [
    { name: 'a.png', mimeType: 'image/png', sizeBytes: 100 * KB },
    { name: 'b.ts', sizeBytes: 10 * KB, hasExtractedText: true, extractedTextChars: 300 },
    { name: 'c.psd', sizeBytes: 4 * MB },
    { name: 'd.zip' },
  ];
  assertEq(
    JSON.stringify(planAttachmentRouting(detInput)),
    JSON.stringify(planAttachmentRouting(detInput)),
    '(7) planAttachmentRouting deterministic',
  );
  assertEq(
    JSON.stringify(routeAttachment(detInput[0])),
    JSON.stringify(routeAttachment(detInput[0])),
    '(7) routeAttachment deterministic',
  );
  assertEq(classifyAttachment(detInput[1]), classifyAttachment(detInput[1]), '(7) classifyAttachment deterministic');

  // ─── (8) HOSTILE — never throws, always safe + bounded ─────────────────────
  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);
  const DEL = String.fromCharCode(0x7f);
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  const C1 = String.fromCharCode(0x9b);
  const TAG = String.fromCodePoint(0xe0041); // Unicode Tag block
  const ctrl = 'a' + NUL + BEL + DEL + LS + PS + C1 + TAG + 'b';
  const hugeStr = 'q'.repeat(200_000);

  // cyclic object
  const cyclic: Record<string, unknown> = { name: 'cyclic.png', mimeType: 'image/png' };
  cyclic.self = cyclic;

  // throwing proxy (all traps hostile)
  const throwingProxy = new Proxy(
    {},
    {
      get() { throw new Error('boom-get'); },
      has() { throw new Error('boom-has'); },
      ownKeys() { throw new Error('boom-keys'); },
      getOwnPropertyDescriptor() { throw new Error('boom-desc'); },
    },
  );

  // element with a throwing name getter
  const throwingEl: Record<string, unknown> = { mimeType: 'image/png' };
  Object.defineProperty(throwingEl, 'name', {
    get() { throw new Error('boom-name'); },
    enumerable: true,
  });

  // data-uri as name (must NOT echo base64 bytes) + emoji-only name
  const dataUriName = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAASECRETBYTES';
  const emojiName = '😀'.repeat(300) + '.png';
  const protoKeyEl = JSON.parse('{"__proto__":{"polluted":true},"name":"safe.png","mimeType":"image/png"}');

  // Each entry: [fixed label, input] — the label (never String(value)) in messages.
  const hostiles: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty-string', ''],
    ['number', 42],
    ['negative', -1],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['string', 'just a string'],
    ['empty-object', {}],
    ['array-of-nonobjects', [1, 'x', true, null, undefined, NaN, 10n]],
    ['boolean', true],
    ['bigint', 10n],
    ['cyclic', [cyclic]],
    ['throwing-proxy-top', throwingProxy],
    ['throwing-proxy-el', [throwingProxy, throwingProxy]],
    ['throwing-name-getter', [throwingEl]],
    ['control-chars', [{ name: 'x' + ctrl + '.png', mimeType: 'image/png' + ctrl }]],
    ['huge-name', [{ name: hugeStr + '.pdf', mimeType: 'application/pdf' }]],
    ['huge-mime', [{ name: 'a.png', mimeType: hugeStr }]],
    ['proto-name', [{ name: '__proto__.exe' }]],
    ['constructor-name', [{ name: 'constructor' }]],
    ['toString-name', [{ name: 'toString' }]],
    ['proto-key-element', [protoKeyEl]],
    ['path-traversal-name', [{ name: '../../../etc/passwd', mimeType: 'text/plain' }]],
    ['windows-traversal', [{ name: '..\\..\\secret.psd' }]],
    ['data-uri-name', [{ name: dataUriName, mimeType: 'image/png' }]],
    ['emoji-name', [{ name: emojiName, mimeType: 'image/png' }]],
    ['nan-size', [{ name: 'a.csv', sizeBytes: NaN }]],
    ['neg-size', [{ name: 'a.csv', sizeBytes: -1 }]],
    ['inf-size', [{ name: 'a.csv', sizeBytes: Infinity }]],
    ['string-size', [{ name: 'a.csv', sizeBytes: '123' as unknown as number }]],
    ['neg-textchars', [{ name: 'a.md', hasExtractedText: true, extractedTextChars: -5 }]],
    ['inf-textchars', [{ name: 'a.md', hasExtractedText: true, extractedTextChars: Infinity }]],
    ['bigint-size', [{ name: 'a.csv', sizeBytes: 9999999999999999n as unknown as number }]],
    ['5000-char-mime', [{ name: 'a', mimeType: 'x/'.repeat(2500) }]],
    ['nested-junk', [null, undefined, 5, 'str', {}, [], NaN, { name: 42 }, { mimeType: {} }]],
  ];

  for (const [label, input] of hostiles) {
    assertNoThrow(() => {
      const plan = planAttachmentRouting(input as unknown);
      assert(wellFormedPlan(plan), '(8) ' + label + ' → well-formed plan', JSON.stringify(plan && plan.laneCounts));
    }, '(8) planAttachmentRouting never throws :: ' + label);
  }

  // non-array hostiles → neutral EMPTY plan specifically
  for (const label of ['null', 'undefined', 'empty-string', 'number', 'string', 'empty-object', 'boolean', 'bigint', 'throwing-proxy-top', 'NaN', 'Infinity']) {
    const input = hostiles.find(([l]) => l === label)![1];
    const plan = planAttachmentRouting(input as unknown);
    assertEq(plan.items.length, 0, '(8) non-array ' + label + ' → 0 items');
    assertEq(plan.summary, '', '(8) non-array ' + label + ' → empty summary');
    assertEq(plan.visionRequired, false, '(8) non-array ' + label + ' → visionRequired false');
  }

  // direct helper hostility — classify + route independently total.
  const safeGet = (o: unknown, k: string): unknown => {
    try {
      return o && (typeof o === 'object' || typeof o === 'function') ? (o as Record<string, unknown>)[k] : undefined;
    } catch {
      return undefined;
    }
  };
  for (const [label, input] of hostiles) {
    assertNoThrow(() => {
      const el = Array.isArray(input) ? safeGet(input, '0') : input;
      const cat = classifyAttachment(el as never);
      assert((ALL_CATEGORIES as string[]).includes(cat), '(8) classifyAttachment → valid category :: ' + label);
      const routed = routeAttachment(el as never, undefined, 3);
      assert(wellFormedItem(routed), '(8) routeAttachment → well-formed item :: ' + label);
    }, '(8) classify/route never throw :: ' + label);
  }

  // 10k huge array does not blow the item cap even when hostile
  const hugeHostile = planAttachmentRouting(Array.from({ length: 5000 }, (_, i) => (i % 2 ? null : { name: 'x' + ctrl })));
  assertLE(hugeHostile.items.length, MAX_ROUTED_ITEMS, '(8) huge hostile array bounded to cap');
  assert(wellFormedPlan(hugeHostile), '(8) huge hostile plan well-formed');

  // ─── (9) hostile output details: no pollution, no secret echo, no phantom keys ─
  // __proto__/constructor/toString names produce NO phantom count buckets.
  const protoBatch = planAttachmentRouting([
    { name: 'ok.png', mimeType: 'image/png' },
    { name: '__proto__.exe' },
    { name: 'constructor' },
    { name: 'toString' },
    { name: 'valueOf' },
  ]);
  assertEq(Object.keys(protoBatch.laneCounts).length, 6, '(9) laneCounts still exactly 6 keys after hostile names');
  assertEq(Object.keys(protoBatch.categoryCounts).length, 9, '(9) categoryCounts still exactly 9 keys after hostile names');
  assertEq(protoBatch.laneCounts.vision, 1, '(9) only the real png counts toward vision');
  assertEq(protoBatch.categoryCounts.image, 1, '(9) image count unpolluted');
  assertEq(sumValues(protoBatch.laneCounts as Record<string, number>), 5, '(9) all 5 items counted exactly once');

  // no Object.prototype pollution from a __proto__ key element
  assertEq(({} as Record<string, unknown>).polluted, undefined, '(9) no Object.prototype pollution (polluted)');
  assertEq((Object.prototype as Record<string, unknown>).polluted, undefined, '(9) Object.prototype untouched');
  assertEq((Object.prototype as Record<string, unknown>).vision, undefined, '(9) prototype has no lane key');

  // data-uri name never echoes base64 payload
  const dataUriPlan = planAttachmentRouting([{ name: dataUriName, mimeType: 'image/png' }]);
  const dataUriItem = dataUriPlan.items[0];
  assert(!dataUriItem.name.includes('base64'), '(9) data-uri name does not echo "base64"');
  assert(!dataUriItem.name.includes('SECRETBYTES'), '(9) data-uri name does not echo payload bytes');
  assert(!dataUriItem.name.includes('iVBOR'), '(9) data-uri name does not echo base64 prefix');
  assertEq(dataUriItem.category, 'image', '(9) data-uri still classified via mime → image');

  // emoji name: bounded by code points, no split surrogate
  const emojiPlan = planAttachmentRouting([{ name: emojiName, mimeType: 'image/png' }]);
  const emojiItem = emojiPlan.items[0];
  assertLE(cpLen(emojiItem.name), MAX_NAME_CHARS, '(9) emoji name code-point bounded');
  assert(!hasLoneSurrogate(emojiItem.name), '(9) emoji name has no split surrogate');

  // path traversal is stripped to a basename
  const travPlan = planAttachmentRouting([{ name: '../../../etc/passwd', mimeType: 'text/plain' }]);
  const travItem = travPlan.items[0];
  assert(!travItem.name.includes('..'), '(9) traversal name has no ".." segment');
  assert(!travItem.name.includes('/'), '(9) traversal name reduced to basename (no slash)');
  assertEq(travItem.name, 'passwd', '(9) traversal name is the basename');

  // control-char name/mime yields clean output
  const ctrlPlan = planAttachmentRouting([{ name: 'na' + ctrl + 'me.png', mimeType: 'image/png' + ctrl }]);
  const ctrlItem = ctrlPlan.items[0];
  assert(noControlChars(ctrlItem.name), '(9) control chars stripped from name');
  assert(!ctrlItem.name.includes(NUL) && !ctrlItem.name.includes(LS) && !ctrlItem.name.includes(PS), '(9) NUL/LS/PS stripped from name');
  assert(noControlChars(ctrlItem.reason), '(9) reason control-clean');

  // reason across a full plan never leaks a filename or base64
  for (const it of batch.items) {
    assert(!it.reason.includes('.png') && !it.reason.includes('.csv') && !it.reason.includes('base64'), '(9) reason has no filename/base64 :: ' + it.category);
  }

  // determinism under hostility (control-char input twice → identical)
  const hInput = [{ name: 'a' + ctrl + '.png', mimeType: 'image/png' }, { name: '__proto__.exe' }];
  assertEq(JSON.stringify(planAttachmentRouting(hInput)), JSON.stringify(planAttachmentRouting(hInput)), '(9) hostile input deterministic');

  // ─── (10) REGRESSION — invisible-char-split data-uri must NOT echo base64 payload ─
  // A control/format char that splits or precedes the `data:` scheme dodges a naive
  // `^data:` guard; a later sanitizeLabel() pass then strips it and would echo the
  // base64 payload verbatim (the redact-then-strip leak class). safeBasename must
  // collapse such a name to '' regardless of the splitter. All hostile chars are
  // built via fromCharCode/fromCodePoint so no literal invisibles live in this file.
  const NUL0 = String.fromCharCode(0);        // interior C0 splitter (exact bug input)
  const ZWSP0 = String.fromCharCode(0x200b);  // zero-width space (survives sanitizeLabel)
  const RLI0 = String.fromCharCode(0x2067);   // Trojan-Source isolate (U+2066-2069)
  const TAG0 = String.fromCodePoint(0xe0041); // astral Tag block
  const SECRET_B64 = 'U0VDUkVU';              // base64 for "SECRET" — must never be echoed
  // exact failing input from the bug report: "dat\x00a:;base64,U0VDUkVU"
  const splitUri = 'dat' + NUL0 + 'a:;base64,' + SECRET_B64;
  const splitName = routeAttachment({ name: splitUri }).name;
  assertEq(splitName, '', '(10) NUL-split data-uri collapses to "" (exact bug input)');
  assert(!splitName.includes(SECRET_B64), '(10) split data-uri name does NOT echo base64 secret value');
  assert(!splitName.toLowerCase().includes('data:') && !splitName.includes('base64'), '(10) split data-uri leaves no data:/base64 remnant');
  // leading-NUL variant (bug: "reproduces with a leading NUL")
  assertEq(routeAttachment({ name: NUL0 + 'data:;base64,' + SECRET_B64 }).name, '', '(10) leading-NUL data-uri collapses to ""');
  // mediatype-slash variant: split defeats ^data: AND the path/slash strip would drop
  // the scheme, leaking the `png;base64,<payload>` tail — must still collapse.
  const slashName = routeAttachment({ name: 'dat' + NUL0 + 'a:image/png;base64,' + SECRET_B64 }).name;
  assert(!slashName.includes(SECRET_B64), '(10) mediatype-slash split data-uri does NOT echo payload tail');
  assertEq(slashName, '', '(10) mediatype-slash split data-uri collapses to ""');
  // zero-width / isolate / astral-tag splitters (these survive sanitizeLabel, so the
  // payload would otherwise be echoed with the junk char sitting inside it).
  assert(!routeAttachment({ name: 'da' + ZWSP0 + 'ta:;base64,' + SECRET_B64 }).name.includes(SECRET_B64), '(10) zero-width-split data-uri does NOT echo payload');
  assert(!routeAttachment({ name: 'da' + RLI0 + 'ta:;base64,' + SECRET_B64 }).name.includes(SECRET_B64), '(10) isolate-split data-uri does NOT echo payload');
  assert(!routeAttachment({ name: 'da' + TAG0 + 'ta:;base64,' + SECRET_B64 }).name.includes(SECRET_B64), '(10) astral-tag-split data-uri does NOT echo payload');
  // through the batch plan surface (the wiring target that reaches prompts/metadata)
  const splitPlan = planAttachmentRouting([{ name: splitUri, mimeType: 'image/png' }]);
  assert(!splitPlan.items[0].name.includes(SECRET_B64), '(10) plan surface: split data-uri name carries no secret payload');
  assertEq(splitPlan.items[0].category, 'image', '(10) split data-uri still classified via mime → image');
  // no false-collapse: an interior control char in an ORDINARY name still routes normally
  assertEq(routeAttachment({ name: 're' + NUL0 + 'port.png', mimeType: 'image/png' }).name, 'report.png', '(10) control char in a normal name does NOT trigger data-uri collapse');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll attachment-routing-core smoke cases passed (' + passes + ' passed).');
}

main();
