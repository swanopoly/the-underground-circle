// adobeCloudService — pure request/validate/receipt builders for the Adobe
// cloud imaging lane (Firefly Services + Photoshop API), the HEADLESS Adobe
// path that needs no local Photoshop. This is the P1 foundation of
// docs/AGENT_APP_AUTOMATION_IMPLEMENTATION_PLAN.md and fulfills the named gap
// tools the creative-AI planner already routes to:
//   - text_to_image      → desktop.firefly_generate_image_asset
//   - generative_expand  → desktop.photoshop_generative_expand
//   - background_remove  → (Photoshop remove-background v2)
// (see designAppCreativeAi.ts / designAppAdapterGaps.ts).
//
// House pattern (mirrors messagingNotify.ts → messaging-notify edge fn): this
// module is dependency-LIGHT (only a pure `scrubSecrets` import + `import type`)
// so tsx smokes and a future Deno edge fn can both load it. It contains ZERO
// network, ZERO secret, and ZERO Supabase access — it only shapes/bounds the
// request BODY, validates args, and parses the async-job receipt. Auth (the
// Adobe IMS OAuth bearer + x-api-key from the connected integration) is injected
// SERVER-SIDE by the guarded edge proxy, never here.
//
// REALITY NOTE (from docs/apps/firefly-services.md): the Firefly Services REST
// API is enterprise-gated (~$1k/mo minimum). So this lane stays behind a
// Marketplace integration (user supplies Adobe IMS client_id/secret), fails
// CLOSED with an honest connect hint when absent, and is NOT the consumer
// default — the firefly.adobe.com browser-UI lane remains the interim path.
//
// ENDPOINT VERIFICATION (verified 2026-07-13 against developer.adobe.com):
//   - text_to_image     /v3/images/generate       CONFIRMED (sync; async twin
//                                                  /v3/images/generate-async exists).
//   - generative_expand /v3/images/expand-async    Adobe documents the ASYNC path
//                                                  (returns jobId + statusUrl; the
//                                                  receipt parser already polls it).
//   - background_remove /v2/remove-background       CORRECTED — the old
//                                                  image.adobe.io/sensei/cutout
//                                                  endpoint reached EOL 2025-10-15.
// A live IMS-authenticated run must still confirm scopes + exact body before the
// edge fn deploys; the value of this module (validation, bounds, receipt parsing,
// secret-scrub) is correct regardless of the exact URLs, isolated in one constant.

import { scrubSecrets } from './messagingNotify';

export type AdobeCloudOperation =
  | 'text_to_image'
  | 'generative_expand'
  | 'background_remove';

export const ADOBE_CLOUD_OPERATIONS: readonly AdobeCloudOperation[] = [
  'text_to_image',
  'generative_expand',
  'background_remove',
] as const;

/** Human labels for approval previews / notices. */
export const ADOBE_CLOUD_OPERATION_LABELS: Record<AdobeCloudOperation, string> = {
  text_to_image: 'Generate an image from a prompt (Adobe Firefly)',
  generative_expand: 'Generatively expand an image to a new size (Adobe Firefly)',
  background_remove: 'Remove an image background (Adobe Photoshop API)',
};

// The gap-tool each operation fulfills (designAppAdapterGaps.ts naming), so the
// planner/buildout layer can map a satisfied gap → this adapter.
export const ADOBE_CLOUD_OPERATION_GAP_TOOL: Record<AdobeCloudOperation, string> = {
  text_to_image: 'desktop.firefly_generate_image_asset',
  generative_expand: 'desktop.photoshop_generative_expand',
  background_remove: 'desktop.photoshop_background_remove',
};

// ── Endpoints (VERIFY before deploy — see header) ────────────────────────────
// Isolated so a correction is a one-line change and never touches logic/tests.
export const ADOBE_CLOUD_ENDPOINTS: Record<AdobeCloudOperation, { method: 'POST'; url: string }> = {
  text_to_image: { method: 'POST', url: 'https://firefly-api.adobe.io/v3/images/generate' },
  generative_expand: { method: 'POST', url: 'https://firefly-api.adobe.io/v3/images/expand-async' },
  background_remove: { method: 'POST', url: 'https://image.adobe.io/v2/remove-background' },
};

// ── Bounds (an asset request is not a document) ──────────────────────────────
export const ADOBE_CLOUD_LIMITS = {
  prompt: 1024,
  numImages: 4,
  dimensionMin: 64,
  dimensionMax: 2688, // Firefly v3 max edge (verify)
  imageRefUrl: 2000,
  uploadId: 200,
} as const;

/** An input image reference: a public/presigned https URL, or an Adobe storage upload id. */
export interface AdobeImageRef {
  url?: string;
  uploadId?: string;
}

export interface AdobeCloudInput {
  /** For text_to_image / generative_expand (fill). */
  prompt?: string;
  /** 1..4 images to produce (text_to_image). */
  numImages?: number;
  /** Target output size, e.g. {width,height}. */
  size?: { width?: number; height?: number };
  /** Source image (generative_expand, background_remove). */
  image?: AdobeImageRef;
  /** Short reason for the approval/audit trail. */
  taskContext?: string;
}

export interface AdobeCloudArgs extends AdobeCloudInput {
  operation: AdobeCloudOperation;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clip(value: unknown, max: number): string {
  const scrubbed = scrubSecrets(value).replace(/\r\n/g, '\n');
  const trimmed = scrubbed.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function isHttpsUrl(value: unknown, max: number): value is string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > max || /\s/.test(text)) return false;
  // Reject URLs carrying userinfo (https://user:SECRET@host/…): a credential in
  // the authority would otherwise ride verbatim into the request body AND the
  // receipt assetUrls[] (the URL is not run through scrubSecrets). Fail closed.
  if (/^https:\/\/[^/?#]*@/i.test(text)) return false;
  return /^https:\/\/[^\s]+$/i.test(text);
}

function clampDimension(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(ADOBE_CLOUD_LIMITS.dimensionMin, Math.min(ADOBE_CLOUD_LIMITS.dimensionMax, Math.floor(n)));
}

/** Normalize an image ref to a safe {url}|{uploadId}, or null if unusable. */
function normalizeImageRef(ref: unknown): AdobeImageRef | null {
  if (!ref || typeof ref !== 'object') return null;
  const r = ref as Record<string, unknown>;
  if (isHttpsUrl(r.url, ADOBE_CLOUD_LIMITS.imageRefUrl)) return { url: (r.url as string).trim() };
  if (typeof r.uploadId === 'string' && r.uploadId.trim() && r.uploadId.length <= ADOBE_CLOUD_LIMITS.uploadId) {
    // upload ids are opaque handles; strip control chars defensively
    return { uploadId: r.uploadId.trim().replace(/[\r\n\t]/g, '') };
  }
  return null;
}

export function isAdobeCloudOperation(value: unknown): value is AdobeCloudOperation {
  return typeof value === 'string' && (ADOBE_CLOUD_OPERATIONS as readonly string[]).includes(value);
}

// ── Validation ───────────────────────────────────────────────────────────────

export type AdobeCloudValidation =
  | { ok: true; value: AdobeCloudArgs }
  | { ok: false; error: string };

/**
 * Validate + normalize raw args into a typed, bounded, scrubbed `AdobeCloudArgs`
 * or a typed `{ error }`. Bounds/scrubbing happen once here so the approval
 * preview, the persisted approval key, and the actual request all agree.
 */
export function validateAdobeCloudArgs(args: unknown): AdobeCloudValidation {
  if (!args || typeof args !== 'object') {
    return { ok: false, error: 'Adobe cloud request requires an args object with an operation.' };
  }
  const raw = args as Record<string, unknown>;
  const operation = raw.operation;
  if (!isAdobeCloudOperation(operation)) {
    return { ok: false, error: `Adobe cloud operation must be one of ${ADOBE_CLOUD_OPERATIONS.join(', ')}.` };
  }

  const value: AdobeCloudArgs = { operation };
  const taskContext = clip(raw.taskContext, 200);
  if (taskContext) value.taskContext = taskContext;

  if (operation === 'text_to_image') {
    const prompt = clip(raw.prompt, ADOBE_CLOUD_LIMITS.prompt);
    if (!prompt) return { ok: false, error: 'text_to_image requires a non-empty prompt.' };
    value.prompt = prompt;
    const n = typeof raw.numImages === 'number' ? Math.floor(raw.numImages) : 1;
    value.numImages = Math.max(1, Math.min(ADOBE_CLOUD_LIMITS.numImages, Number.isFinite(n) ? n : 1));
    const w = clampDimension((raw.size as Record<string, unknown>)?.width);
    const h = clampDimension((raw.size as Record<string, unknown>)?.height);
    if (w || h) value.size = { ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) };
    return { ok: true, value };
  }

  // generative_expand + background_remove both require a source image.
  const image = normalizeImageRef(raw.image);
  if (!image) {
    return { ok: false, error: `${operation} requires a source image as { url: "https://…" } or { uploadId }.` };
  }
  value.image = image;

  if (operation === 'generative_expand') {
    const prompt = clip(raw.prompt, ADOBE_CLOUD_LIMITS.prompt);
    if (prompt) value.prompt = prompt; // optional fill prompt
    const w = clampDimension((raw.size as Record<string, unknown>)?.width);
    const h = clampDimension((raw.size as Record<string, unknown>)?.height);
    if (!w && !h) return { ok: false, error: 'generative_expand requires a target size (width and/or height).' };
    value.size = { ...(w ? { width: w } : {}), ...(h ? { height: h } : {}) };
  }

  return { ok: true, value };
}

// ── Request builder ──────────────────────────────────────────────────────────

export interface AdobeCloudRequestSpec {
  operation: AdobeCloudOperation;
  method: 'POST';
  url: string;
  /** The JSON request body (NO auth — the edge proxy injects IMS bearer + x-api-key). */
  body: Record<string, unknown>;
}

/**
 * Build the auth-free request spec for a VALIDATED args object. Callers should
 * validate first (validateAdobeCloudArgs). Returns null on invalid input rather
 * than throwing, so the edge fn can fail closed.
 */
export function buildAdobeCloudRequest(args: AdobeCloudArgs): AdobeCloudRequestSpec | null {
  const v = validateAdobeCloudArgs(args);
  if (!v.ok) return null;
  const a = v.value;
  const endpoint = ADOBE_CLOUD_ENDPOINTS[a.operation];

  let body: Record<string, unknown>;
  switch (a.operation) {
    case 'text_to_image':
      body = {
        prompt: a.prompt,
        numVariations: a.numImages ?? 1,
        ...(a.size ? { size: a.size } : {}),
      };
      break;
    case 'generative_expand':
      body = {
        image: { source: a.image },
        size: a.size,
        ...(a.prompt ? { prompt: a.prompt } : {}),
      };
      break;
    case 'background_remove':
      // Photoshop remove-background v2: { image: { source: {url|uploadId} },
      // mode, output } — same source-ref shape as expand (verified 2026-07-13).
      body = { image: { source: a.image }, mode: 'cutout', output: { mediaType: 'image/png' } };
      break;
    default:
      return null;
  }
  return { operation: a.operation, method: endpoint.method, url: endpoint.url, body };
}

// ── Receipt / outcome extraction ─────────────────────────────────────────────

export type AdobeCloudVerdict = 'succeeded' | 'running' | 'failed' | 'unknown';

export interface AdobeCloudReceipt {
  ok: boolean;
  verdict: AdobeCloudVerdict;
  /** Output asset URLs (https), secret-scrubbed & bounded. */
  assetUrls: string[];
  /** Async job/status URL when the API returned one for polling. */
  jobUrl: string | null;
  summary: string;
}

const MAX_ASSET_URLS = 8;

/** Pull https asset URLs out of an Adobe response (sync outputs OR async job). */
function collectAssetUrls(node: unknown, out: string[], depth = 0): void {
  if (out.length >= MAX_ASSET_URLS || depth > 6 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectAssetUrls(item, out, depth + 1);
    return;
  }
  for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
    if (out.length >= MAX_ASSET_URLS) break;
    // Adobe returns output image links under url / presignedUrl / href / destination.
    if (/^(url|presignedUrl|href|destination|image)$/i.test(key) && isHttpsUrl(val, ADOBE_CLOUD_LIMITS.imageRefUrl)) {
      const clean = (val as string).trim();
      if (!out.includes(clean)) out.push(clean);
    } else if (val && typeof val === 'object') {
      collectAssetUrls(val, out, depth + 1);
    }
  }
}

/**
 * Parse an Adobe cloud API response into a bounded, secret-safe receipt.
 * Handles sync outputs, async job envelopes ({ jobId, statusUrl }), and
 * error/failed states. Never throws.
 */
export function extractAdobeCloudReceipt(
  operation: AdobeCloudOperation,
  response: { ok?: boolean; status?: number | null; body?: unknown } | null | undefined,
): AdobeCloudReceipt {
  const label = ADOBE_CLOUD_OPERATION_LABELS[operation] || 'Adobe cloud operation';
  const status = typeof response?.status === 'number' ? response.status : null;
  const httpOk = response?.ok === true && (status === null || (status >= 200 && status < 300));
  const bodyObj = response?.body && typeof response.body === 'object' ? (response.body as Record<string, unknown>) : {};

  const assetUrls: string[] = [];
  collectAssetUrls(bodyObj, assetUrls);

  // Async job envelope: no assets yet, but a status/job URL to poll.
  const links = bodyObj._links && typeof bodyObj._links === 'object' ? (bodyObj._links as Record<string, unknown>) : null;
  const jobUrlRaw = bodyObj.statusUrl ?? bodyObj.jobUrl ?? (links ? links.self : undefined);
  const jobUrl = isHttpsUrl(jobUrlRaw, ADOBE_CLOUD_LIMITS.imageRefUrl) ? (jobUrlRaw as string).trim() : null;

  const jobStatus = typeof bodyObj.status === 'string' ? bodyObj.status.toLowerCase() : '';

  let verdict: AdobeCloudVerdict;
  if (!httpOk || jobStatus === 'failed' || jobStatus === 'error') verdict = 'failed';
  else if (assetUrls.length > 0 || jobStatus === 'succeeded' || jobStatus === 'done') verdict = 'succeeded';
  else if (jobUrl || jobStatus === 'running' || jobStatus === 'pending' || jobStatus === 'in_progress') verdict = 'running';
  else verdict = httpOk ? 'succeeded' : 'unknown';

  let summary: string;
  if (verdict === 'succeeded' && assetUrls.length > 0) {
    summary = `✅ ${label}: ${assetUrls.length} asset${assetUrls.length === 1 ? '' : 's'} — ${assetUrls[0]}`;
  } else if (verdict === 'succeeded') {
    summary = `✅ ${label} completed.`;
  } else if (verdict === 'running') {
    summary = `⏳ ${label} is generating — poll the job to collect the asset.`;
  } else if (verdict === 'failed') {
    summary = `⚠️ ${label} failed${status !== null ? ` (HTTP ${status})` : ''}.`;
  } else {
    summary = `${label}${status !== null ? ` — HTTP ${status}` : ''}.`;
  }

  return { ok: verdict === 'succeeded' || verdict === 'running', verdict, assetUrls, jobUrl, summary: clip(summary, 240) };
}

// ── Approval preview ─────────────────────────────────────────────────────────

/** One-line approval/notice summary. Never throws. */
export function describeAdobeCloudOperation(args: unknown): string {
  const raw = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  const op = raw.operation;
  const label = isAdobeCloudOperation(op) ? ADOBE_CLOUD_OPERATION_LABELS[op] : 'Run an Adobe cloud imaging operation';
  if (op === 'text_to_image') {
    const p = clip(raw.prompt, 80);
    return p ? `${label}: "${p}"` : label;
  }
  return label;
}
