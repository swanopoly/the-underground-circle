/**
 * adobe-cloud-service-smoketest — the pure Adobe cloud imaging adapter
 * (src/lib/adobeCloudService.ts, plan P1). Guards validation, request-body
 * shaping (auth-free), async-job receipt parsing, secret-scrub, and bounds for
 * the headless Firefly Services / Photoshop API lane.
 *
 * Pure — loads under tsx (adobeCloudService only imports the pure scrubSecrets
 * from messagingNotify, which is import-type-only).
 */

import {
  ADOBE_CLOUD_OPERATIONS,
  ADOBE_CLOUD_ENDPOINTS,
  ADOBE_CLOUD_LIMITS,
  ADOBE_CLOUD_OPERATION_GAP_TOOL,
  validateAdobeCloudArgs,
  buildAdobeCloudRequest,
  extractAdobeCloudReceipt,
  describeAdobeCloudOperation,
  isAdobeCloudOperation,
  type AdobeCloudArgs,
} from '../src/lib/adobeCloudService';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) endpoint/constant sanity ─────────────────────────────────────────
  assertEq(ADOBE_CLOUD_OPERATIONS.length, 3, '(1) three operations');
  for (const op of ADOBE_CLOUD_OPERATIONS) {
    assert(/^https:\/\//.test(ADOBE_CLOUD_ENDPOINTS[op].url), `(1) ${op} endpoint is https`, ADOBE_CLOUD_ENDPOINTS[op].url);
    assertEq(ADOBE_CLOUD_ENDPOINTS[op].method, 'POST', `(1) ${op} is POST`);
    assert(!!ADOBE_CLOUD_OPERATION_GAP_TOOL[op], `(1) ${op} maps to a named gap tool`);
  }
  assert(isAdobeCloudOperation('text_to_image') && !isAdobeCloudOperation('nope'), '(1) operation guard');

  // ─── (2) validate: text_to_image ──────────────────────────────────────────
  const t2i = validateAdobeCloudArgs({ operation: 'text_to_image', prompt: 'a red sports car at dusk', numImages: 3 });
  assert(t2i.ok, '(2) valid text_to_image');
  if (t2i.ok) {
    assertEq(t2i.value.numImages, 3, '(2) numImages kept');
    assert(!!t2i.value.prompt, '(2) prompt kept');
  }
  assertEq((validateAdobeCloudArgs({ operation: 'text_to_image' }) as any).ok, false, '(2) text_to_image needs a prompt');
  // numImages clamps to [1,4]
  const clampHi = validateAdobeCloudArgs({ operation: 'text_to_image', prompt: 'x', numImages: 99 });
  assert(clampHi.ok && clampHi.value.numImages === ADOBE_CLOUD_LIMITS.numImages, '(2) numImages clamps to max');
  const clampLo = validateAdobeCloudArgs({ operation: 'text_to_image', prompt: 'x', numImages: 0 });
  assert(clampLo.ok && clampLo.value.numImages === 1, '(2) numImages floors to 1');
  // prompt bounded
  const longP = validateAdobeCloudArgs({ operation: 'text_to_image', prompt: 'p'.repeat(ADOBE_CLOUD_LIMITS.prompt + 500) });
  assert(longP.ok && longP.value.prompt!.length <= ADOBE_CLOUD_LIMITS.prompt, '(2) prompt bounded');
  // dimension clamp
  const dim = validateAdobeCloudArgs({ operation: 'text_to_image', prompt: 'x', size: { width: 999999, height: 10 } });
  assert(dim.ok && dim.value.size?.width === ADOBE_CLOUD_LIMITS.dimensionMax && dim.value.size?.height === ADOBE_CLOUD_LIMITS.dimensionMin, '(2) dimensions clamp to [min,max]');

  // ─── (3) validate: generative_expand + background_remove need an image ────
  assertEq((validateAdobeCloudArgs({ operation: 'generative_expand', size: { width: 1920 } }) as any).ok, false, '(3) expand needs an image');
  const exp = validateAdobeCloudArgs({ operation: 'generative_expand', image: { url: 'https://cdn.example.com/a.png' }, size: { width: 1920, height: 1080 } });
  assert(exp.ok, '(3) valid expand with image + size');
  assertEq((validateAdobeCloudArgs({ operation: 'generative_expand', image: { url: 'https://x/y.png' } }) as any).ok, false, '(3) expand needs a target size');
  const bg = validateAdobeCloudArgs({ operation: 'background_remove', image: { uploadId: 'abc-123' } });
  assert(bg.ok, '(3) valid background_remove with uploadId');
  // reject non-https image url + oversized
  assertEq((validateAdobeCloudArgs({ operation: 'background_remove', image: { url: 'http://insecure/x.png' } }) as any).ok, false, '(3) http image rejected (https only)');
  assertEq((validateAdobeCloudArgs({ operation: 'background_remove', image: { url: 'ftp://x' } }) as any).ok, false, '(3) non-http scheme rejected');

  // ─── (4) buildAdobeCloudRequest: correct body, NO auth, null on invalid ───
  if (t2i.ok) {
    const req = buildAdobeCloudRequest(t2i.value)!;
    assert(!!req, '(4) request built for text_to_image');
    assertEq(req.method, 'POST', '(4) POST');
    assert(req.url.startsWith('https://firefly-api.adobe.io'), '(4) firefly generate url');
    assert((req.body as any).prompt === t2i.value.prompt, '(4) body carries prompt');
    // No auth anywhere in the body (edge injects it).
    const bodyStr = JSON.stringify(req.body).toLowerCase();
    assert(!/authorization|bearer|x-api-key|client_secret|access_token/.test(bodyStr), '(4) body carries NO auth', bodyStr.slice(0, 80));
  }
  if (exp.ok) {
    const req = buildAdobeCloudRequest(exp.value)!;
    assert((req.body as any).size?.width === 1920, '(4) expand body carries target size');
    assert(!!(req.body as any).image, '(4) expand body carries source image');
  }
  assertEq(buildAdobeCloudRequest({ operation: 'text_to_image' } as AdobeCloudArgs), null, '(4) invalid args → null request');

  // ─── (5) receipt: sync outputs → succeeded + asset URLs ───────────────────
  const syncOk = extractAdobeCloudReceipt('text_to_image', {
    ok: true, status: 200,
    body: { outputs: [{ image: { url: 'https://cdn.adobe.io/out/1.png' } }, { image: { presignedUrl: 'https://cdn.adobe.io/out/2.png' } }] },
  });
  assertEq(syncOk.verdict, 'succeeded', '(5) sync outputs → succeeded');
  assertEq(syncOk.assetUrls.length, 2, '(5) two asset urls extracted');
  assert(/^✅ /.test(syncOk.summary) && syncOk.summary.includes('cdn.adobe.io'), '(5) success summary names an asset');

  // ─── (6) receipt: async job → running + jobUrl ────────────────────────────
  const asyncJob = extractAdobeCloudReceipt('generative_expand', {
    ok: true, status: 202, body: { jobId: 'j1', status: 'running', statusUrl: 'https://firefly-api.adobe.io/v3/status/j1' },
  });
  assertEq(asyncJob.verdict, 'running', '(6) async job → running');
  assertEq(asyncJob.jobUrl, 'https://firefly-api.adobe.io/v3/status/j1', '(6) job url captured');
  assert(/generating|poll/i.test(asyncJob.summary), '(6) running summary says poll');

  // ─── (7) receipt: failure verdicts ────────────────────────────────────────
  assertEq(extractAdobeCloudReceipt('text_to_image', { ok: false, status: 429, body: { error: 'rate' } }).verdict, 'failed', '(7) HTTP 429 → failed');
  assertEq(extractAdobeCloudReceipt('text_to_image', { ok: true, status: 200, body: { status: 'failed' } }).verdict, 'failed', '(7) job status failed → failed');
  assert(/^⚠️/.test(extractAdobeCloudReceipt('background_remove', { ok: false, status: 500, body: {} }).summary), '(7) failure summary is a warning');

  // ─── (8) receipt secret-safety + bounds ───────────────────────────────────
  const secretResp = extractAdobeCloudReceipt('text_to_image', {
    ok: true, status: 200,
    body: { access_token: 'sk-supersecret1234567890abcdef', outputs: [{ image: { url: 'https://cdn.adobe.io/ok.png' } }] },
  });
  assert(!/sk-supersecret/.test(JSON.stringify(secretResp)), '(8) receipt never surfaces a token value');
  assertEq(secretResp.assetUrls.length, 1, '(8) only the real https asset surfaced (token key ignored)');
  // non-https "asset" is not surfaced
  const badUrl = extractAdobeCloudReceipt('text_to_image', { ok: true, status: 200, body: { outputs: [{ image: { url: 'http://x/insecure.png' } }] } });
  assertEq(badUrl.assetUrls.length, 0, '(8) non-https output url not surfaced');
  // many outputs bounded to ≤8
  const many = extractAdobeCloudReceipt('text_to_image', { ok: true, status: 200, body: { outputs: Array.from({ length: 20 }, (_, i) => ({ image: { url: `https://cdn.adobe.io/${i}.png` } })) } });
  assert(many.assetUrls.length <= 8, '(8) asset urls bounded to 8', String(many.assetUrls.length));

  // ─── (9) prompt secret-scrub in validation ────────────────────────────────
  const scrubbed = validateAdobeCloudArgs({ operation: 'text_to_image', prompt: 'draw this but my key is sk-ant-abcdefghij1234567890 ok' });
  assert(scrubbed.ok && !/sk-ant-abcdefghij/.test(scrubbed.value.prompt || ''), '(9) secret-shaped token scrubbed from prompt');

  // ─── (10) describe + degenerate-never-throw ───────────────────────────────
  assert(describeAdobeCloudOperation({ operation: 'text_to_image', prompt: 'a cat' }).includes('a cat'), '(10) describe names the prompt');
  assert(!!describeAdobeCloudOperation({ operation: 'background_remove' }), '(10) describe works without prompt');
  try {
    validateAdobeCloudArgs(undefined as any);
    validateAdobeCloudArgs({});
    buildAdobeCloudRequest(undefined as any);
    extractAdobeCloudReceipt('text_to_image', null);
    extractAdobeCloudReceipt('text_to_image', { body: 'not-an-object' } as any);
    describeAdobeCloudOperation(null);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll adobe-cloud-service smoke cases passed (${passes} passed).`);
}

main();
