// image-generate — exact-authority, durable Chat image generation.
//
// Chat requests are bound to one persisted caller-owned source message before
// provider I/O. Provider output is validated and stored in a private bucket;
// messages persist only an opaque receipt id and obtain short-lived signed
// URLs through the `sign` action. The actionless branch is a deliberately
// isolated OfficeTerminal compatibility lane.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import {
  byokUnreadableMessage,
  corsHeaders,
  createServiceRoleClient,
  getAuthenticatedUser,
  getRequiredEnv,
  resolveUserModelApiKey,
  StoredApiKeyLookupError,
} from "../_shared/edge.ts";

const GENERATED_IMAGE_BUCKET = "chat-generated-images";
const MAX_BODY_BYTES = 12_000;
const MAX_PROMPT_CHARS = 8_000;
const MAX_LABEL_CHARS = 160;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_PROVIDER_JSON_BYTES = 30 * 1024 * 1024;
const MAX_PROVIDER_CONTROL_JSON_BYTES = 512 * 1024;
const MAX_DIMENSION = 8_192;
const MAX_PIXELS = 40_000_000;
const REQUEST_BUDGET_MS = 88_000;
const PROVIDER_STARTED_STALE_MS = 110_000;
const SIGNED_URL_TTL_SECONDS = 10 * 60;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_REQUEST_ID_RE = /^[A-Za-z0-9._:/-]{1,200}$/;
const REPLICATE_PREDICTION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

type ImageProvider = "openai" | "huggingface" | "replicate";
type ImageMimeType = "image/png" | "image/jpeg" | "image/webp";
type GenerationScope = "chat" | "terminal";

type UnknownRecord = Record<string, unknown>;

interface GeneratorSpec {
  provider: ImageProvider;
  model: string;
  logicalModel:
    | "gpt-image-2"
    | "flux-schnell"
    | "flux-dev"
    | "stable-diffusion-xl";
}

interface GeneratedImageInspection {
  bytes: Uint8Array;
  mimeType: ImageMimeType;
  width: number;
  height: number;
  sha256: string;
}

interface ProviderImageResult {
  bytes: Uint8Array;
  declaredMimeType?: string | null;
  providerRequestId?: string | null;
  revisedPrompt?: string | null;
}

interface GeneratedImageRow extends UnknownRecord {
  id: string;
  generation_scope: GenerationScope;
  circle_id: string;
  thread_id: string | null;
  source_message_id: string | null;
  requested_by: string;
  provider: ImageProvider;
  model: string;
  requested_model: string | null;
  prompt_sha256: string;
  storage_path: string;
  status: "pending" | "ready" | "outcome_unknown";
  provider_started_at: string | null;
  provider_request_id: string | null;
  mime_type: ImageMimeType | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  failure_code: string | null;
  completed_at: string | null;
  created_at: string;
}

class ImageFunctionError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "ImageFunctionError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const OPENAI_GPT_IMAGE_2: GeneratorSpec = Object.freeze({
  provider: "openai",
  model: "gpt-image-2",
  logicalModel: "gpt-image-2",
});
const HF_FLUX_SCHNELL: GeneratorSpec = Object.freeze({
  provider: "huggingface",
  model: "black-forest-labs/FLUX.1-schnell",
  logicalModel: "flux-schnell",
});
const REPLICATE_FLUX_SCHNELL: GeneratorSpec = Object.freeze({
  provider: "replicate",
  model: "black-forest-labs/flux-schnell",
  logicalModel: "flux-schnell",
});
const REPLICATE_FLUX_DEV: GeneratorSpec = Object.freeze({
  provider: "replicate",
  model: "black-forest-labs/flux-dev",
  logicalModel: "flux-dev",
});
const HF_SDXL: GeneratorSpec = Object.freeze({
  provider: "huggingface",
  model: "stabilityai/stable-diffusion-xl-base-1.0",
  logicalModel: "stable-diffusion-xl",
});

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function boundedString(value: unknown, max = MAX_LABEL_CHARS): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    !normalized || normalized.length > max ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) return null;
  return normalized;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function noStoreJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function failure(error: ImageFunctionError): Response {
  return noStoreJson({
    ok: false,
    error: error.message,
    code: error.code,
    retryable: error.retryable,
  }, error.status);
}

function publicError(
  status: number,
  code: string,
  message: string,
  retryable = false,
): ImageFunctionError {
  return new ImageFunctionError(status, code, message, retryable);
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  declaredLength?: string | null,
  options: Readonly<{
    signal?: AbortSignal;
    deadlineAt?: number;
  }> = {},
): Promise<Uint8Array> {
  if (declaredLength) {
    const parsed = Number(declaredLength);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxBytes) {
      throw publicError(
        413,
        "validation",
        "Request or provider response was too large.",
      );
    }
  }
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let aborted = false;
  let rejectAbort: ((reason: DOMException) => void) | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const abortPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abortRead = () => {
    if (aborted) return;
    aborted = true;
    void reader.cancel().catch(() => undefined);
    rejectAbort?.(
      new DOMException("Bounded response read aborted", "AbortError"),
    );
  };
  if (options.signal?.aborted) abortRead();
  else options.signal?.addEventListener("abort", abortRead, { once: true });
  if (Number.isFinite(options.deadlineAt)) {
    const remaining = Number(options.deadlineAt) - Date.now();
    if (remaining <= 0) abortRead();
    else deadlineTimer = setTimeout(abortRead, remaining);
  }
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (aborted) {
        throw new DOMException("Bounded response read aborted", "AbortError");
      }
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw publicError(
          413,
          "invalid_response",
          "Image provider returned an oversized response.",
        );
      }
      chunks.push(value);
    }
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    options.signal?.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw publicError(
      400,
      "validation",
      "Request body must be valid UTF-8 JSON.",
    );
  }
}

async function readRequestJson(
  req: Request,
  deadlineAt: number,
): Promise<UnknownRecord> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    throw publicError(
      415,
      "validation",
      "Content-Type must be application/json.",
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = await readBoundedStream(
      req.body,
      MAX_BODY_BYTES,
      req.headers.get("content-length"),
      { signal: req.signal, deadlineAt },
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw publicError(
        408,
        "request_timeout",
        "Image request body did not arrive before the deadline.",
        true,
      );
    }
    throw error;
  }
  if (bytes.byteLength === 0) {
    throw publicError(400, "validation", "Request body is required.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeUtf8(bytes));
  } catch (error) {
    if (error instanceof ImageFunctionError) throw error;
    throw publicError(400, "validation", "Request body must be valid JSON.");
  }
  const record = asRecord(parsed);
  if (!record) {
    throw publicError(400, "validation", "Request body must be a JSON object.");
  }
  if (Object.prototype.hasOwnProperty.call(record, "api_key")) {
    throw publicError(
      400,
      "validation",
      "Client-supplied provider keys are not accepted.",
    );
  }
  return record;
}

async function readResponseJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<UnknownRecord> {
  const bytes = await readBoundedStream(
    response.body,
    maxBytes,
    response.headers.get("content-length"),
    { signal, deadlineAt },
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw publicError(
      502,
      "invalid_response",
      "Image provider returned an invalid response.",
    );
  }
  const record = asRecord(parsed);
  if (!record) {
    throw publicError(
      502,
      "invalid_response",
      "Image provider returned an invalid response.",
    );
  }
  return record;
}

function joinAbortSignals(
  parent: AbortSignal,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(1, timeoutMs));
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}

async function fixedFetch(
  url: string,
  init: RequestInit,
  requestSignal: AbortSignal,
  deadlineAt: number,
): Promise<Response> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) {
    throw new DOMException("Request deadline exceeded", "AbortError");
  }
  const bounded = joinAbortSignals(requestSignal, remaining);
  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: bounded.signal,
    });
  } finally {
    bounded.cleanup();
  }
}

async function delayWithinDeadline(
  ms: number,
  requestSignal: AbortSignal,
  deadlineAt: number,
): Promise<void> {
  const duration = Math.min(ms, Math.max(0, deadlineAt - Date.now()));
  if (duration <= 0) {
    throw new DOMException("Request deadline exceeded", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      requestSignal.removeEventListener("abort", abort);
      resolve();
    }, duration);
    const abort = () => {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", abort);
      reject(new DOMException("Request aborted", "AbortError"));
    };
    if (requestSignal.aborted) abort();
    else requestSignal.addEventListener("abort", abort, { once: true });
  });
}

function sanitizeProviderRequestId(value: unknown): string | null {
  const candidate = boundedString(value, 200);
  return candidate && PROVIDER_REQUEST_ID_RE.test(candidate) ? candidate : null;
}

function decodeBase64Image(value: unknown): Uint8Array {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 8
  ) {
    throw publicError(
      502,
      "invalid_response",
      "Image provider returned invalid image data.",
    );
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw publicError(
      502,
      "invalid_response",
      "Image provider returned invalid image data.",
    );
  }
  if (binary.length === 0 || binary.length > MAX_IMAGE_BYTES) {
    throw publicError(
      502,
      "invalid_response",
      "Image provider returned an oversized image.",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (((bytes[offset] << 24) >>> 0) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]) >>> 0;
}

function parseJpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const sofMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = readUint16Be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
    if (sofMarkers.has(marker) && segmentLength >= 7) {
      return {
        height: readUint16Be(bytes, offset + 3),
        width: readUint16Be(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return null;
}

function parseWebpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
    String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP"
  ) return null;
  const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: readUint24Le(bytes, 24) + 1,
      height: readUint24Le(bytes, 27) + 1,
    };
  }
  if (
    chunk === "VP8 " && bytes.length >= 30 &&
    bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a
  ) {
    return {
      width: readUint16Le(bytes, 26) & 0x3fff,
      height: readUint16Le(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits =
      (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>>
      0;
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

async function inspectImage(
  bytes: Uint8Array,
  declaredMimeType?: string | null,
): Promise<GeneratedImageInspection> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw publicError(
      502,
      "invalid_response",
      "Image provider returned an invalid image size.",
    );
  }
  let mimeType: ImageMimeType | null = null;
  let dimensions: { width: number; height: number } | null = null;
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    String.fromCharCode(...bytes.slice(12, 16)) === "IHDR"
  ) {
    mimeType = "image/png";
    dimensions = {
      width: readUint32Be(bytes, 16),
      height: readUint32Be(bytes, 20),
    };
  } else {
    const jpeg = parseJpegDimensions(bytes);
    if (jpeg) {
      mimeType = "image/jpeg";
      dimensions = jpeg;
    } else {
      const webp = parseWebpDimensions(bytes);
      if (webp) {
        mimeType = "image/webp";
        dimensions = webp;
      }
    }
  }
  if (!mimeType || !dimensions) {
    throw publicError(
      502,
      "invalid_response",
      "Image provider returned an unsupported or malformed image.",
    );
  }
  const declared = (declaredMimeType || "").split(";", 1)[0].trim()
    .toLowerCase();
  if (
    declared && declared !== "application/octet-stream" && declared !== mimeType
  ) {
    throw publicError(
      502,
      "invalid_response",
      "Image provider response type did not match its image bytes.",
    );
  }
  const { width, height } = dimensions;
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width > MAX_DIMENSION ||
    height > MAX_DIMENSION ||
    width * height > MAX_PIXELS
  ) {
    throw publicError(
      502,
      "invalid_response",
      "Image provider returned unsupported image dimensions.",
    );
  }
  // Deno's Web Crypto types require an ArrayBuffer-backed view. Copy the
  // bounded provider bytes so a SharedArrayBuffer-like backing store can
  // never cross this trust boundary.
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestInput.buffer);
  const sha256 = Array.from(
    new Uint8Array(digest),
    (value) => value.toString(16).padStart(2, "0"),
  ).join("");
  return { bytes, mimeType, width, height, sha256 };
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(
    new Uint8Array(digest),
    (item) => item.toString(16).padStart(2, "0"),
  ).join("");
}

function providerFromInput(value: unknown): ImageProvider | null {
  if (value == null) return null;
  const normalized = boundedString(value)?.toLowerCase();
  if (!normalized) {
    throw publicError(
      400,
      "validation",
      "Image provider selection is invalid.",
    );
  }
  if (normalized === "openai") return "openai";
  if (["huggingface", "hugging_face", "hf"].includes(normalized)) {
    return "huggingface";
  }
  if (normalized === "replicate") return "replicate";
  throw publicError(
    400,
    "unsupported_model",
    "That image provider is not supported by Chat yet.",
  );
}

function specFromPersistedRow(row: GeneratedImageRow): GeneratorSpec | null {
  return [
    OPENAI_GPT_IMAGE_2,
    HF_FLUX_SCHNELL,
    REPLICATE_FLUX_SCHNELL,
    REPLICATE_FLUX_DEV,
    HF_SDXL,
  ]
    .find((spec) =>
      spec.provider === row.provider && spec.model === row.model
    ) || null;
}

function classifyLogicalImageModel(
  value: string | null,
): GeneratorSpec["logicalModel"] | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "gpt-image-2" || normalized.endsWith("/gpt-image-2")) {
    return "gpt-image-2";
  }
  if (
    normalized === "flux-dev" || normalized.endsWith("/flux-dev") ||
    normalized.endsWith("/flux.1-dev")
  ) return "flux-dev";
  if (
    normalized === "stable-diffusion-xl" ||
    normalized.includes("stable-diffusion-xl-base-1.0")
  ) return "stable-diffusion-xl";
  if (
    normalized === "flux-schnell" || normalized.endsWith("/flux-schnell") ||
    normalized.endsWith("/flux.1-schnell")
  ) return "flux-schnell";
  return null;
}

function looksLikeUnsupportedImageModel(value: string | null): boolean {
  return Boolean(
    value &&
      /(?:image|dall[.-]?e|flux|stable-diffusion|sdxl|imagen)/i.test(value),
  );
}

function candidateSpecs(
  body: UnknownRecord,
  requestedModel: string | null,
): GeneratorSpec[] {
  const provider = providerFromInput(body.provider);
  const exactModelInput = body.model == null ? null : boundedString(body.model);
  if (body.model != null && !exactModelInput) {
    throw publicError(400, "validation", "Image model selection is invalid.");
  }
  const logicalModel = classifyLogicalImageModel(
    exactModelInput || requestedModel,
  );
  if (exactModelInput && !logicalModel) {
    throw publicError(
      400,
      "unsupported_model",
      "That image model is not supported by Chat yet.",
    );
  }
  if (!logicalModel && looksLikeUnsupportedImageModel(requestedModel)) {
    throw publicError(
      400,
      "unsupported_model",
      "That selected image model is not supported by Chat yet.",
    );
  }

  let candidates: GeneratorSpec[];
  switch (logicalModel) {
    case "gpt-image-2":
      candidates = [OPENAI_GPT_IMAGE_2];
      break;
    case "flux-dev":
      candidates = [REPLICATE_FLUX_DEV];
      break;
    case "stable-diffusion-xl":
      candidates = [HF_SDXL];
      break;
    case "flux-schnell":
      candidates = [HF_FLUX_SCHNELL, REPLICATE_FLUX_SCHNELL];
      break;
    default:
      candidates = provider === "openai"
        ? [OPENAI_GPT_IMAGE_2]
        : provider === "huggingface"
        ? [HF_FLUX_SCHNELL]
        : provider === "replicate"
        ? [REPLICATE_FLUX_SCHNELL]
        : [OPENAI_GPT_IMAGE_2, HF_FLUX_SCHNELL, REPLICATE_FLUX_SCHNELL];
  }
  if (provider) {
    candidates = candidates.filter((candidate) =>
      candidate.provider === provider
    );
  }
  if (candidates.length === 0) {
    throw publicError(
      400,
      "unsupported_model",
      "The selected image model does not run on that provider.",
    );
  }
  return candidates;
}

async function selectGenerator(
  serviceClient: any,
  userId: string,
  body: UnknownRecord,
  requestedModel: string | null,
): Promise<{ spec: GeneratorSpec; apiKey: string }> {
  const candidates = candidateSpecs(body, requestedModel);
  const keyCache = new Map<ImageProvider, string | null>();
  let unreadableProvider: ImageProvider | null = null;
  for (const spec of candidates) {
    if (!keyCache.has(spec.provider)) {
      try {
        const resolved = await resolveUserModelApiKey({
          supabase: serviceClient,
          userId,
          provider: spec.provider,
          label: null,
          credentialPolicy: "user_required",
          failOnStoredLookupError: true,
        });
        keyCache.set(spec.provider, resolved?.apiKey || null);
      } catch (error) {
        if (
          error instanceof StoredApiKeyLookupError ||
          asRecord(error)?.code === "credential_unreadable"
        ) {
          unreadableProvider ||= spec.provider;
          keyCache.set(spec.provider, null);
        } else {
          throw publicError(
            503,
            "credential_unavailable",
            "Saved image-provider access could not be verified. Try again later.",
            true,
          );
        }
      }
    }
    const apiKey = keyCache.get(spec.provider);
    if (apiKey) return { spec, apiKey };
  }
  if (unreadableProvider) {
    throw publicError(
      503,
      "credential_unreadable",
      byokUnreadableMessage(unreadableProvider),
      false,
    );
  }
  const providers = Array.from(
    new Set(candidates.map((candidate) => candidate.provider)),
  );
  const providerLabel = providers.map((provider) =>
    provider === "huggingface"
      ? "Hugging Face"
      : provider === "openai"
      ? "OpenAI"
      : "Replicate"
  ).join(" or ");
  throw publicError(
    400,
    "key_missing",
    `Connect your ${providerLabel} API key in Marketplace before generating this image.`,
  );
}

async function generateOpenAi(
  apiKey: string,
  prompt: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<ProviderImageResult> {
  let response: Response;
  try {
    response = await fixedFetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt,
          n: 1,
          size: "1024x1024",
          output_format: "png",
        }),
      },
      signal,
      deadlineAt,
    );
  } catch {
    throw publicError(
      502,
      "outcome_unknown",
      "OpenAI image generation did not return a final receipt. It will not be replayed automatically.",
    );
  }
  if (!response.ok || response.status >= 300) {
    await readBoundedStream(
      response.body,
      8_192,
      response.headers.get("content-length"),
      { signal, deadlineAt },
    ).catch(() => undefined);
    throw publicError(
      502,
      "upstream_error",
      "OpenAI rejected the image request. Check the connected key and prompt, then start a new image request.",
    );
  }
  const data = await readResponseJson(
    response,
    MAX_PROVIDER_JSON_BYTES,
    signal,
    deadlineAt,
  );
  const images = Array.isArray(data.data) ? data.data : [];
  const first = asRecord(images[0]);
  return {
    bytes: decodeBase64Image(first?.b64_json),
    declaredMimeType: "image/png",
    providerRequestId: sanitizeProviderRequestId(
      response.headers.get("x-request-id"),
    ),
    revisedPrompt: boundedString(first?.revised_prompt, 1_000),
  };
}

async function generateHuggingFace(
  spec: GeneratorSpec,
  apiKey: string,
  prompt: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<ProviderImageResult> {
  const url = `https://router.huggingface.co/hf-inference/models/${spec.model}`;
  let response: Response;
  try {
    response = await fixedFetch(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inputs: prompt }),
      },
      signal,
      deadlineAt,
    );
  } catch {
    throw publicError(
      502,
      "outcome_unknown",
      "Hugging Face image generation did not return a final receipt. It will not be replayed automatically.",
    );
  }
  if (!response.ok || response.status >= 300) {
    await readBoundedStream(
      response.body,
      8_192,
      response.headers.get("content-length"),
      { signal, deadlineAt },
    ).catch(() => undefined);
    throw publicError(
      502,
      "upstream_error",
      "Hugging Face rejected the image request. Check the connected key and prompt, then start a new image request.",
    );
  }
  return {
    bytes: await readBoundedStream(
      response.body,
      MAX_IMAGE_BYTES,
      response.headers.get("content-length"),
      { signal, deadlineAt },
    ),
    declaredMimeType: response.headers.get("content-type"),
    providerRequestId: sanitizeProviderRequestId(
      response.headers.get("x-request-id"),
    ),
  };
}

function replicateOutputUrl(value: unknown): URL {
  const raw = Array.isArray(value)
    ? value.find((item) => typeof item === "string")
    : value;
  if (typeof raw !== "string" || raw.length > 4_096) {
    throw publicError(
      502,
      "invalid_response",
      "Replicate returned no validated image output.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw publicError(
      502,
      "invalid_response",
      "Replicate returned an invalid image output URL.",
    );
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" || url.username || url.password ||
    (url.port && url.port !== "443") ||
    (host !== "replicate.delivery" && !host.endsWith(".replicate.delivery"))
  ) {
    throw publicError(
      502,
      "invalid_response",
      "Replicate returned an untrusted image output URL.",
    );
  }
  return url;
}

async function generateReplicate(
  spec: GeneratorSpec,
  apiKey: string,
  prompt: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<ProviderImageResult> {
  const [, owner, model] = /^([^/]+)\/([^/]+)$/.exec(spec.model) || [];
  if (!owner || !model) {
    throw publicError(
      500,
      "internal",
      "Replicate model configuration is invalid.",
    );
  }
  let response: Response;
  try {
    response = await fixedFetch(
      `https://api.replicate.com/v1/models/${owner}/${model}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Prefer: "wait=45",
        },
        body: JSON.stringify({ input: { prompt } }),
      },
      signal,
      deadlineAt,
    );
  } catch {
    throw publicError(
      502,
      "outcome_unknown",
      "Replicate image generation did not return a final receipt. It will not be replayed automatically.",
    );
  }
  if (!response.ok || response.status >= 300) {
    await readBoundedStream(
      response.body,
      8_192,
      response.headers.get("content-length"),
      { signal, deadlineAt },
    ).catch(() => undefined);
    throw publicError(
      502,
      "upstream_error",
      "Replicate rejected the image request. Check the connected key and prompt, then start a new image request.",
    );
  }
  let prediction = await readResponseJson(
    response,
    MAX_PROVIDER_CONTROL_JSON_BYTES,
    signal,
    deadlineAt,
  );
  const predictionId = boundedString(prediction.id, 128);
  if (!predictionId || !REPLICATE_PREDICTION_ID_RE.test(predictionId)) {
    throw publicError(
      502,
      "invalid_response",
      "Replicate returned an invalid prediction receipt.",
    );
  }
  while (prediction.status !== "succeeded") {
    if (
      ["failed", "canceled", "cancelled"].includes(
        String(prediction.status || "").toLowerCase(),
      )
    ) {
      throw publicError(
        502,
        "upstream_error",
        "Replicate could not complete the image request. Start a new request to try again.",
      );
    }
    if (Date.now() >= deadlineAt - 2_000) {
      throw publicError(
        502,
        "outcome_unknown",
        "Replicate did not return a final image receipt in time. It will not be replayed automatically.",
      );
    }
    await delayWithinDeadline(1_500, signal, deadlineAt);
    let poll: Response;
    try {
      poll = await fixedFetch(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        signal,
        deadlineAt,
      );
    } catch {
      throw publicError(
        502,
        "outcome_unknown",
        "Replicate prediction status became unavailable. It will not be replayed automatically.",
      );
    }
    if (!poll.ok || poll.status >= 300) {
      await readBoundedStream(
        poll.body,
        8_192,
        poll.headers.get("content-length"),
        { signal, deadlineAt },
      ).catch(() => undefined);
      throw publicError(
        502,
        "outcome_unknown",
        "Replicate prediction status became unavailable. It will not be replayed automatically.",
      );
    }
    prediction = await readResponseJson(
      poll,
      MAX_PROVIDER_CONTROL_JSON_BYTES,
      signal,
      deadlineAt,
    );
    if (prediction.id !== predictionId) {
      throw publicError(
        502,
        "invalid_response",
        "Replicate prediction identity changed unexpectedly.",
      );
    }
  }
  const outputUrl = replicateOutputUrl(prediction.output);
  let output: Response;
  try {
    output = await fixedFetch(
      outputUrl.toString(),
      { method: "GET" },
      signal,
      deadlineAt,
    );
  } catch {
    throw publicError(
      502,
      "outcome_unknown",
      "Replicate image output could not be retrieved. It will not be replayed automatically.",
    );
  }
  if (!output.ok || output.status >= 300) {
    await readBoundedStream(
      output.body,
      8_192,
      output.headers.get("content-length"),
      { signal, deadlineAt },
    ).catch(() => undefined);
    throw publicError(
      502,
      "outcome_unknown",
      "Replicate image output could not be retrieved. It will not be replayed automatically.",
    );
  }
  return {
    bytes: await readBoundedStream(
      output.body,
      MAX_IMAGE_BYTES,
      output.headers.get("content-length"),
      { signal, deadlineAt },
    ),
    declaredMimeType: output.headers.get("content-type"),
    providerRequestId: predictionId,
  };
}

async function callProvider(
  spec: GeneratorSpec,
  apiKey: string,
  prompt: string,
  signal: AbortSignal,
  deadlineAt: number,
): Promise<ProviderImageResult> {
  if (spec.provider === "openai") {
    return generateOpenAi(apiKey, prompt, signal, deadlineAt);
  }
  if (spec.provider === "huggingface") {
    return generateHuggingFace(spec, apiKey, prompt, signal, deadlineAt);
  }
  return generateReplicate(spec, apiKey, prompt, signal, deadlineAt);
}

function createCallerClient(authorization: string): any {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: authorization } },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}

async function verifyOwnedSourceMessage(
  callerClient: any,
  userId: string,
  circleId: string,
  threadId: string,
  sourceMessageId: string,
): Promise<void> {
  const { data, error } = await callerClient
    .from("messages")
    .select("id,circle_id,thread_id,user_id,is_bot")
    .eq("id", sourceMessageId)
    .eq("circle_id", circleId)
    .eq("thread_id", threadId)
    .maybeSingle();
  if (error) {
    throw publicError(
      503,
      "authority_unavailable",
      "Chat image authority could not be verified. Try again later.",
      true,
    );
  }
  if (!data || data.user_id !== userId || data.is_bot === true) {
    throw publicError(
      403,
      "forbidden",
      "The source Chat message is unavailable or not owned by this account.",
    );
  }
}

async function verifyCircleMembership(
  callerClient: any,
  userId: string,
  circleId: string,
): Promise<void> {
  const { data, error } = await callerClient
    .from("circle_members")
    .select("circle_id,user_id")
    .eq("circle_id", circleId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw publicError(
      503,
      "authority_unavailable",
      "Circle membership could not be verified. Try again later.",
      true,
    );
  }
  if (!data) {
    throw publicError(
      403,
      "forbidden",
      "You are not a current member of this circle.",
    );
  }
}

function assertReadyRow(row: GeneratedImageRow): void {
  if (
    row.status !== "ready" || !isUuid(row.id) ||
    !row.mime_type ||
    !["image/png", "image/jpeg", "image/webp"].includes(row.mime_type) ||
    !Number.isInteger(row.size_bytes) || Number(row.size_bytes) < 1 ||
    Number(row.size_bytes) > MAX_IMAGE_BYTES ||
    !Number.isInteger(row.width) || Number(row.width) < 1 ||
    Number(row.width) > MAX_DIMENSION ||
    !Number.isInteger(row.height) || Number(row.height) < 1 ||
    Number(row.height) > MAX_DIMENSION ||
    Number(row.width) * Number(row.height) > MAX_PIXELS ||
    typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)
  ) {
    throw publicError(
      500,
      "invalid_receipt",
      "Generated image receipt is incomplete.",
    );
  }
}

async function signReadyImage(
  serviceClient: any,
  row: GeneratedImageRow,
): Promise<UnknownRecord> {
  assertReadyRow(row);
  const { data, error } = await serviceClient.storage
    .from(GENERATED_IMAGE_BUCKET)
    .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    throw publicError(
      503,
      "signing_unavailable",
      "The generated image is saved, but its secure link is temporarily unavailable. Try loading it again.",
      true,
    );
  }
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1_000)
    .toISOString();
  return {
    id: row.id,
    signedUrl: data.signedUrl,
    expiresAt,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
  };
}

function rowMatchesRequest(
  row: GeneratedImageRow,
  input: {
    scope: GenerationScope;
    circleId: string;
    threadId: string | null;
    sourceMessageId: string | null;
    userId: string;
    spec: GeneratorSpec;
    requestedModel: string | null;
    promptSha256: string;
  },
): boolean {
  return row.generation_scope === input.scope &&
    row.circle_id === input.circleId &&
    row.thread_id === input.threadId &&
    row.source_message_id === input.sourceMessageId &&
    row.requested_by === input.userId &&
    row.provider === input.spec.provider &&
    row.model === input.spec.model &&
    row.requested_model === input.requestedModel &&
    row.prompt_sha256 === input.promptSha256;
}

async function markOutcomeUnknown(
  serviceClient: any,
  rowId: string,
  code: string,
): Promise<void> {
  await serviceClient
    .from("chat_generated_images")
    .update({
      status: "outcome_unknown",
      failure_code: code.replace(/[^a-z0-9_]/g, "_").slice(0, 80) ||
        "outcome_unknown",
      completed_at: new Date().toISOString(),
    })
    .eq("id", rowId)
    .eq("status", "pending")
    .not("provider_started_at", "is", null)
    .select("id")
    .maybeSingle()
    .catch(() => undefined);
}

async function readGeneratedRowById(
  serviceClient: any,
  id: string,
): Promise<GeneratedImageRow | null> {
  const { data, error } = await serviceClient
    .from("chat_generated_images")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw publicError(
      503,
      "storage_unavailable",
      "Generated image receipt could not be read. Try again later.",
      true,
    );
  }
  return data as GeneratedImageRow | null;
}

async function readGeneratedRowBySource(
  serviceClient: any,
  sourceMessageId: string,
): Promise<GeneratedImageRow | null> {
  const { data, error } = await serviceClient
    .from("chat_generated_images")
    .select("*")
    .eq("source_message_id", sourceMessageId)
    .eq("generation_scope", "chat")
    .maybeSingle();
  if (error) {
    throw publicError(
      503,
      "reservation_unavailable",
      "The existing image receipt could not be verified. Try again later.",
      true,
    );
  }
  return data as GeneratedImageRow | null;
}

async function completeClaimedGeneration(input: {
  serviceClient: any;
  row: GeneratedImageRow;
  spec: GeneratorSpec;
  apiKey: string;
  prompt: string;
  requestSignal: AbortSignal;
  deadlineAt: number;
}): Promise<
  { row: GeneratedImageRow; image: UnknownRecord; revisedPrompt: string | null }
> {
  const {
    serviceClient,
    row,
    spec,
    apiKey,
    prompt,
    requestSignal,
    deadlineAt,
  } = input;
  try {
    const providerResult = await callProvider(
      spec,
      apiKey,
      prompt,
      requestSignal,
      deadlineAt,
    );
    const inspected = await inspectImage(
      providerResult.bytes,
      providerResult.declaredMimeType,
    );
    const { error: uploadError } = await serviceClient.storage
      .from(GENERATED_IMAGE_BUCKET)
      .upload(row.storage_path, inspected.bytes, {
        contentType: inspected.mimeType,
        cacheControl: "0",
        upsert: false,
      });
    if (uploadError) {
      throw publicError(
        503,
        "outcome_unknown",
        "The provider returned an image, but durable storage could not be confirmed. It will not be replayed automatically.",
      );
    }

    const completedAt = new Date().toISOString();
    const { data: readyData, error: readyError } = await serviceClient
      .from("chat_generated_images")
      .update({
        status: "ready",
        provider_request_id: providerResult.providerRequestId || null,
        mime_type: inspected.mimeType,
        size_bytes: inspected.bytes.byteLength,
        width: inspected.width,
        height: inspected.height,
        sha256: inspected.sha256,
        failure_code: null,
        completed_at: completedAt,
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();

    let readyRow = readyData as GeneratedImageRow | null;
    if (readyError || !readyRow) {
      const recovered = await readGeneratedRowById(serviceClient, row.id).catch(
        () => null,
      );
      if (
        recovered?.status === "ready" && recovered.sha256 === inspected.sha256
      ) readyRow = recovered;
      else {throw publicError(
          503,
          "outcome_unknown",
          "The image was generated, but its durable receipt could not be confirmed. It will not be replayed automatically.",
        );}
    }
    const image = await signReadyImage(serviceClient, readyRow);
    return {
      row: readyRow,
      image,
      revisedPrompt: providerResult.revisedPrompt || null,
    };
  } catch (error) {
    const normalized = error instanceof ImageFunctionError
      ? error
      : publicError(
        502,
        "outcome_unknown",
        "Image generation ended without a final durable receipt. It will not be replayed automatically.",
      );
    await markOutcomeUnknown(serviceClient, row.id, normalized.code);
    throw normalized;
  }
}

async function reserveAndClaimChatImage(input: {
  serviceClient: any;
  circleId: string;
  threadId: string;
  sourceMessageId: string;
  userId: string;
  spec: GeneratorSpec;
  requestedModel: string | null;
  promptSha256: string;
}): Promise<{ row: GeneratedImageRow; existingReady: boolean }> {
  const imageId = crypto.randomUUID();
  const storagePath =
    `${input.circleId}/${input.threadId}/${input.sourceMessageId}/${input.userId}/${imageId}`;
  const insertPayload = {
    id: imageId,
    generation_scope: "chat",
    circle_id: input.circleId,
    thread_id: input.threadId,
    source_message_id: input.sourceMessageId,
    requested_by: input.userId,
    provider: input.spec.provider,
    model: input.spec.model,
    requested_model: input.requestedModel,
    prompt_sha256: input.promptSha256,
    storage_path: storagePath,
    status: "pending",
  };
  let row: GeneratedImageRow | null = null;
  const { data: inserted, error: insertError } = await input.serviceClient
    .from("chat_generated_images")
    .insert(insertPayload)
    .select("*")
    .maybeSingle();
  if (!insertError && inserted) row = inserted as GeneratedImageRow;
  else if (insertError?.code === "23505") {
    const { data: existing, error: existingError } = await input.serviceClient
      .from("chat_generated_images")
      .select("*")
      .eq("source_message_id", input.sourceMessageId)
      .eq("generation_scope", "chat")
      .maybeSingle();
    if (existingError || !existing) {
      throw publicError(
        503,
        "reservation_unavailable",
        "The image request could not be reserved safely. Try again later.",
        true,
      );
    }
    row = existing as GeneratedImageRow;
  } else {
    throw publicError(
      503,
      "reservation_unavailable",
      "The image request could not be reserved safely. Try again later.",
      true,
    );
  }

  if (!rowMatchesRequest(row, { ...input, scope: "chat" })) {
    throw publicError(
      409,
      "source_conflict",
      "This Chat message is already bound to a different image request. Send a new message for another image.",
    );
  }
  if (row.status === "ready") return { row, existingReady: true };
  if (row.status === "outcome_unknown") {
    throw publicError(
      409,
      "outcome_unknown",
      "This source message already reached an image provider without a recoverable final receipt. It will not be replayed; send a new image request if you want to try again.",
    );
  }
  if (row.provider_started_at) {
    const startedAt = Date.parse(row.provider_started_at);
    if (
      Number.isFinite(startedAt) &&
      Date.now() - startedAt > PROVIDER_STARTED_STALE_MS
    ) {
      await markOutcomeUnknown(
        input.serviceClient,
        row.id,
        "provider_receipt_expired",
      );
      throw publicError(
        409,
        "outcome_unknown",
        "The earlier image attempt did not produce a recoverable final receipt. It will not be replayed; send a new image request to try again.",
      );
    }
    throw publicError(
      409,
      "generation_in_progress",
      "This image request is already in progress. It was not dispatched a second time.",
    );
  }

  const providerStartedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await input.serviceClient
    .from("chat_generated_images")
    .update({ provider_started_at: providerStartedAt })
    .eq("id", row.id)
    .eq("status", "pending")
    .is("provider_started_at", null)
    .select("*")
    .maybeSingle();
  if (claimError) {
    throw publicError(
      409,
      "outcome_unknown",
      "The image dispatch claim could not be confirmed, so no provider request was sent and this source will not be replayed automatically.",
    );
  }
  if (!claimed) {
    const current = await readGeneratedRowById(input.serviceClient, row.id);
    if (current?.status === "ready") {
      return { row: current, existingReady: true };
    }
    throw publicError(
      409,
      current?.status === "outcome_unknown"
        ? "outcome_unknown"
        : "generation_in_progress",
      "This image request was already claimed. It was not dispatched a second time.",
    );
  }
  return { row: claimed as GeneratedImageRow, existingReady: false };
}

async function createAndClaimTerminalImage(input: {
  serviceClient: any;
  circleId: string;
  userId: string;
  spec: GeneratorSpec;
  promptSha256: string;
}): Promise<GeneratedImageRow> {
  const imageId = crypto.randomUUID();
  const storagePath = `${input.circleId}/_terminal/${input.userId}/${imageId}`;
  const { data: inserted, error: insertError } = await input.serviceClient
    .from("chat_generated_images")
    .insert({
      id: imageId,
      generation_scope: "terminal",
      circle_id: input.circleId,
      thread_id: null,
      source_message_id: null,
      requested_by: input.userId,
      provider: input.spec.provider,
      model: input.spec.model,
      requested_model: null,
      prompt_sha256: input.promptSha256,
      storage_path: storagePath,
      status: "pending",
    })
    .select("*")
    .maybeSingle();
  if (insertError || !inserted) {
    throw publicError(
      503,
      "reservation_unavailable",
      "The terminal image request could not be reserved safely. Try again later.",
      true,
    );
  }
  const { data: claimed, error: claimError } = await input.serviceClient
    .from("chat_generated_images")
    .update({ provider_started_at: new Date().toISOString() })
    .eq("id", imageId)
    .eq("status", "pending")
    .is("provider_started_at", null)
    .select("*")
    .maybeSingle();
  if (claimError || !claimed) {
    throw publicError(
      409,
      "outcome_unknown",
      "The terminal image dispatch claim could not be confirmed, so no provider request was sent.",
    );
  }
  return claimed as GeneratedImageRow;
}

function validatePrompt(body: UnknownRecord): string {
  if (typeof body.prompt !== "string") {
    throw publicError(400, "validation", "prompt is required.");
  }
  const prompt = body.prompt.trim();
  if (!prompt || prompt.length > MAX_PROMPT_CHARS || /\u0000/.test(prompt)) {
    throw publicError(
      400,
      "validation",
      `Describe the image in 1-${MAX_PROMPT_CHARS} characters.`,
    );
  }
  return prompt;
}

async function handleChatGenerate(input: {
  body: UnknownRecord;
  userId: string;
  callerClient: any;
  serviceClient: any;
  requestSignal: AbortSignal;
  deadlineAt: number;
}): Promise<Response> {
  const {
    body,
    userId,
    callerClient,
    serviceClient,
    requestSignal,
    deadlineAt,
  } = input;
  const prompt = validatePrompt(body);
  const circleId = body.circleId;
  const threadId = body.threadId;
  const sourceMessageId = body.sourceMessageId;
  if (!isUuid(circleId) || !isUuid(threadId) || !isUuid(sourceMessageId)) {
    throw publicError(
      400,
      "validation",
      "Image generation requires one persisted source message in the active circle and thread.",
    );
  }
  const requestedModel = body.requestedModel == null
    ? null
    : boundedString(body.requestedModel);
  if (body.requestedModel != null && !requestedModel) {
    throw publicError(
      400,
      "validation",
      "Requested model identity is invalid.",
    );
  }
  await verifyOwnedSourceMessage(
    callerClient,
    userId,
    circleId,
    threadId,
    sourceMessageId,
  );
  const promptSha256 = await sha256Text(prompt);
  const existing = await readGeneratedRowBySource(
    serviceClient,
    sourceMessageId,
  );
  if (existing) {
    const existingSpec = specFromPersistedRow(existing);
    if (
      !existingSpec || !rowMatchesRequest(existing, {
        scope: "chat",
        circleId,
        threadId,
        sourceMessageId,
        userId,
        spec: existingSpec,
        requestedModel,
        promptSha256,
      })
    ) {
      throw publicError(
        409,
        "source_conflict",
        "This Chat message is already bound to a different image request. Send a new message for another image.",
      );
    }
    if (existing.status === "ready") {
      const image = await signReadyImage(serviceClient, existing);
      return noStoreJson({
        ok: true,
        image,
        provider: existing.provider,
        model: existing.model,
      });
    }
    if (existing.status === "outcome_unknown") {
      throw publicError(
        409,
        "outcome_unknown",
        "This source message already reached an image provider without a recoverable final receipt. It will not be replayed; send a new image request if you want to try again.",
      );
    }
    if (existing.provider_started_at) {
      const startedAt = Date.parse(existing.provider_started_at);
      if (
        Number.isFinite(startedAt) &&
        Date.now() - startedAt > PROVIDER_STARTED_STALE_MS
      ) {
        await markOutcomeUnknown(
          serviceClient,
          existing.id,
          "provider_receipt_expired",
        );
        throw publicError(
          409,
          "outcome_unknown",
          "The earlier image attempt did not produce a recoverable final receipt. It will not be replayed; send a new image request to try again.",
        );
      }
      throw publicError(
        409,
        "generation_in_progress",
        "This image request is already in progress. It was not dispatched a second time.",
      );
    }
    const exactSelection = await selectGenerator(serviceClient, userId, {
      provider: existingSpec.provider,
      model: existingSpec.logicalModel,
    }, requestedModel);
    const reservation = await reserveAndClaimChatImage({
      serviceClient,
      circleId,
      threadId,
      sourceMessageId,
      userId,
      spec: exactSelection.spec,
      requestedModel,
      promptSha256,
    });
    if (reservation.existingReady) {
      const image = await signReadyImage(serviceClient, reservation.row);
      return noStoreJson({
        ok: true,
        image,
        provider: reservation.row.provider,
        model: reservation.row.model,
      });
    }
    const completed = await completeClaimedGeneration({
      serviceClient,
      row: reservation.row,
      spec: exactSelection.spec,
      apiKey: exactSelection.apiKey,
      prompt,
      requestSignal,
      deadlineAt,
    });
    return noStoreJson({
      ok: true,
      image: completed.image,
      provider: completed.row.provider,
      model: completed.row.model,
      ...(requestedModel ? { requestedModel } : {}),
      ...(completed.revisedPrompt
        ? { revisedPrompt: completed.revisedPrompt }
        : {}),
      message: `Generated an image with ${
        completed.row.provider === "huggingface"
          ? "Hugging Face"
          : completed.row.provider === "openai"
          ? "OpenAI"
          : "Replicate"
      } ${completed.row.model}.`,
    });
  }

  const { spec, apiKey } = await selectGenerator(
    serviceClient,
    userId,
    body,
    requestedModel,
  );
  const reservation = await reserveAndClaimChatImage({
    serviceClient,
    circleId,
    threadId,
    sourceMessageId,
    userId,
    spec,
    requestedModel,
    promptSha256,
  });
  if (reservation.existingReady) {
    const image = await signReadyImage(serviceClient, reservation.row);
    return noStoreJson({
      ok: true,
      image,
      provider: reservation.row.provider,
      model: reservation.row.model,
    });
  }
  const completed = await completeClaimedGeneration({
    serviceClient,
    row: reservation.row,
    spec,
    apiKey,
    prompt,
    requestSignal,
    deadlineAt,
  });
  return noStoreJson({
    ok: true,
    image: completed.image,
    provider: completed.row.provider,
    model: completed.row.model,
    ...(requestedModel ? { requestedModel } : {}),
    ...(completed.revisedPrompt
      ? { revisedPrompt: completed.revisedPrompt }
      : {}),
    message: `Generated an image with ${
      completed.row.provider === "huggingface"
        ? "Hugging Face"
        : completed.row.provider === "openai"
        ? "OpenAI"
        : "Replicate"
    } ${completed.row.model}.`,
  });
}

async function handleSign(input: {
  body: UnknownRecord;
  userId: string;
  callerClient: any;
  serviceClient: any;
}): Promise<Response> {
  const { body, userId, callerClient, serviceClient } = input;
  const imageId = body.imageId;
  const circleId = body.circleId;
  if (!isUuid(imageId) || !isUuid(circleId)) {
    throw publicError(
      400,
      "validation",
      "A valid circle-scoped image receipt is required.",
    );
  }
  const { data, error } = await serviceClient
    .from("chat_generated_images")
    .select("*")
    .eq("id", imageId)
    .eq("circle_id", circleId)
    .eq("status", "ready")
    .maybeSingle();
  if (error) {
    throw publicError(
      503,
      "storage_unavailable",
      "Generated image receipt could not be read. Try again later.",
      true,
    );
  }
  if (!data) {
    throw publicError(
      404,
      "not_found",
      "Generated image was not found or is no longer available.",
    );
  }
  const row = data as GeneratedImageRow;
  if (row.generation_scope === "chat") {
    if (!row.thread_id || !row.source_message_id) {
      throw publicError(
        500,
        "invalid_receipt",
        "Generated image receipt is incomplete.",
      );
    }
    const { data: visible, error: visibilityError } = await callerClient
      .from("messages")
      .select("id")
      .eq("id", row.source_message_id)
      .eq("circle_id", row.circle_id)
      .eq("thread_id", row.thread_id)
      .maybeSingle();
    if (visibilityError) {
      throw publicError(
        503,
        "authority_unavailable",
        "Image access could not be verified. Try again later.",
        true,
      );
    }
    if (!visible) {
      throw publicError(
        403,
        "forbidden",
        "You no longer have access to this generated image.",
      );
    }
  } else {
    if (row.requested_by !== userId) {
      throw publicError(
        403,
        "forbidden",
        "You do not own this terminal image.",
      );
    }
    await verifyCircleMembership(callerClient, userId, row.circle_id);
  }
  const image = await signReadyImage(serviceClient, row);
  return noStoreJson({
    ok: true,
    image,
    provider: row.provider,
    model: row.model,
  });
}

async function handleTerminalCompatibility(input: {
  body: UnknownRecord;
  userId: string;
  callerClient: any;
  serviceClient: any;
  requestSignal: AbortSignal;
  deadlineAt: number;
}): Promise<Response> {
  const {
    body,
    userId,
    callerClient,
    serviceClient,
    requestSignal,
    deadlineAt,
  } = input;
  if (
    body.threadId != null || body.sourceMessageId != null ||
    body.imageId != null || body.action != null
  ) {
    throw publicError(
      400,
      "validation",
      "Malformed Chat image requests cannot use the terminal compatibility lane.",
    );
  }
  const prompt = validatePrompt(body);
  const circleId = body.circleId;
  if (!isUuid(circleId)) {
    throw publicError(400, "validation", "A valid circle is required.");
  }
  const provider = providerFromInput(body.provider);
  if (provider && provider !== "openai") {
    throw publicError(
      400,
      "unsupported_model",
      "OfficeTerminal image generation currently requires OpenAI GPT Image 2.",
    );
  }
  await verifyCircleMembership(callerClient, userId, circleId);
  const { spec, apiKey } = await selectGenerator(serviceClient, userId, {
    provider: "openai",
    model: "gpt-image-2",
  }, null);
  const row = await createAndClaimTerminalImage({
    serviceClient,
    circleId,
    userId,
    spec,
    promptSha256: await sha256Text(prompt),
  });
  const completed = await completeClaimedGeneration({
    serviceClient,
    row,
    spec,
    apiKey,
    prompt,
    requestSignal,
    deadlineAt,
  });
  return noStoreJson({
    ok: true,
    url: (completed.image as UnknownRecord).signedUrl,
    image: completed.image,
    provider: completed.row.provider,
    model: completed.row.model,
    revised_prompt: completed.revisedPrompt || undefined,
    estimated_cost: null,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return failure(
      publicError(405, "method_not_allowed", "Use POST for image generation."),
    );
  }

  try {
    const deadlineAt = Date.now() + REQUEST_BUDGET_MS;
    const user = await getAuthenticatedUser(req);
    if (!user?.id) {
      throw publicError(
        401,
        "unauthenticated",
        "Sign in before generating or loading an image.",
      );
    }
    const authorization = req.headers.get("authorization") ||
      req.headers.get("Authorization") || "";
    if (!authorization) {
      throw publicError(
        401,
        "unauthenticated",
        "A valid user session is required.",
      );
    }
    const callerClient = createCallerClient(authorization);
    const serviceClient = createServiceRoleClient();
    const body = await readRequestJson(req, deadlineAt);
    const action = body.action == null
      ? null
      : boundedString(body.action, 24)?.toLowerCase();
    if (body.action != null && !action) {
      throw publicError(400, "validation", "Image action is invalid.");
    }
    if (action === "generate") {
      return await handleChatGenerate({
        body,
        userId: user.id,
        callerClient,
        serviceClient,
        requestSignal: req.signal,
        deadlineAt,
      });
    }
    if (action === "sign") {
      return await handleSign({
        body,
        userId: user.id,
        callerClient,
        serviceClient,
      });
    }
    if (action) {
      throw publicError(400, "validation", "Unsupported image action.");
    }
    return await handleTerminalCompatibility({
      body,
      userId: user.id,
      callerClient,
      serviceClient,
      requestSignal: req.signal,
      deadlineAt,
    });
  } catch (error) {
    if (error instanceof ImageFunctionError) return failure(error);
    return failure(
      publicError(
        500,
        "internal",
        "Image service could not complete the request.",
      ),
    );
  }
});
