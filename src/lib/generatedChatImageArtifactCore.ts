/**
 * Pure generated-Chat-image artifact contract.
 *
 * Keep this module dependency-light: persisted transcript formatters and Node
 * smokes import it without loading React Native, auth, or a Supabase client.
 */

import type { SwanBotStructuredArtifact } from './swanbot';

export const GENERATED_CHAT_IMAGE_SOURCE = 'generated_chat_image';
export const GENERATED_CHAT_IMAGE_BUCKET = 'chat-generated-images';
export const GENERATED_CHAT_IMAGE_SIGNED_URL_SAFETY_WINDOW_MS = 30_000;

const MAX_LABEL_CHARS = 160;
const OPAQUE_IMAGE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface GeneratedChatImageMetadata extends Record<string, unknown> {
  source: typeof GENERATED_CHAT_IMAGE_SOURCE;
  generatedImageId: string;
  provider: string;
  model: string;
  requestedModel?: string;
  mimeType: string;
  sha256: string;
}

type UnknownRecord = Record<string, unknown>;

export function asGeneratedChatImageRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

export function boundedGeneratedChatImageString(
  value: unknown,
  maxChars = MAX_LABEL_CHARS,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxChars || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

export function isPersistedChatUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isOpaqueGeneratedChatImageId(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_IMAGE_ID_RE.test(value);
}

export function isGeneratedChatImageSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_RE.test(value);
}

export function isAllowedGeneratedChatImageMimeType(value: unknown): value is string {
  return typeof value === 'string' && ALLOWED_IMAGE_MIME_TYPES.has(value.toLowerCase());
}

export function isGeneratedChatImageArtifact(
  artifact: SwanBotStructuredArtifact | null | undefined,
): boolean {
  const metadata = asGeneratedChatImageRecord(artifact?.metadata);
  return artifact?.kind === 'image'
    && (
      metadata?.source === GENERATED_CHAT_IMAGE_SOURCE
      || Object.prototype.hasOwnProperty.call(metadata || {}, 'generatedImageId')
    );
}

/** Parse only the bounded, durable, allowlisted generated-image reference. */
export function readGeneratedChatImageMetadata(
  artifact: SwanBotStructuredArtifact | null | undefined,
): GeneratedChatImageMetadata | null {
  if (!artifact || artifact.kind !== 'image') return null;
  const metadata = asGeneratedChatImageRecord(artifact.metadata);
  if (!metadata || metadata.source !== GENERATED_CHAT_IMAGE_SOURCE) return null;

  const generatedImageId = metadata.generatedImageId;
  const provider = boundedGeneratedChatImageString(metadata.provider);
  const model = boundedGeneratedChatImageString(metadata.model);
  const requestedModel = boundedGeneratedChatImageString(metadata.requestedModel) || undefined;
  const mimeType = typeof metadata.mimeType === 'string' ? metadata.mimeType.toLowerCase() : null;
  const sha256 = typeof metadata.sha256 === 'string' ? metadata.sha256.toLowerCase() : null;
  if (
    !isOpaqueGeneratedChatImageId(generatedImageId)
    || !provider
    || !model
    || !isAllowedGeneratedChatImageMimeType(mimeType)
    || !isGeneratedChatImageSha256(sha256)
  ) {
    return null;
  }

  return {
    source: GENERATED_CHAT_IMAGE_SOURCE,
    generatedImageId,
    provider,
    model,
    ...(requestedModel ? { requestedModel } : {}),
    mimeType,
    sha256,
  };
}

/**
 * A generated artifact URL is an optional optimistic fast path only. Trust it
 * when it is an unexpired signed-object URL on this exact Supabase project and
 * private generated-image bucket. Every other URL is ignored and re-signed by
 * opaque id, preventing a forged member message from loading a tracker URL.
 */
export function readFreshGeneratedChatImageUrl(
  artifact: SwanBotStructuredArtifact | null | undefined,
  options: Readonly<{
    nowMs?: number;
    supabaseUrl?: string;
    circleId?: string;
  }> = {},
): string | null {
  if (!readGeneratedChatImageMetadata(artifact)) return null;
  const metadata = asGeneratedChatImageRecord(artifact?.metadata);
  const expiresAt = boundedGeneratedChatImageString(metadata?.expiresAt, 80);
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  if (!Number.isFinite(expiresAtMs)) return null;
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  if (expiresAtMs <= nowMs + GENERATED_CHAT_IMAGE_SIGNED_URL_SAFETY_WINDOW_MS) return null;

  return isTrustedGeneratedChatImageSignedUrl(artifact?.url, options.supabaseUrl, options.circleId)
    ? artifact!.url!
    : null;
}

export function isTrustedGeneratedChatImageSignedUrl(
  value: unknown,
  supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  circleId?: string,
): value is string {
  const url = typeof value === 'string' ? value : '';
  if (!url || url.length > 4_096) return false;
  const configuredUrl = supabaseUrl.trim();
  if (!configuredUrl) return false;
  try {
    const configured = new URL(configuredUrl);
    const candidate = new URL(url);
    if (candidate.protocol !== 'https:' && candidate.protocol !== 'http:') return false;
    if (candidate.origin !== configured.origin) return false;
    const configuredBasePath = configured.pathname.replace(/\/+$/, '');
    const expectedPrefix = `${configuredBasePath}/storage/v1/object/sign/${GENERATED_CHAT_IMAGE_BUCKET}/`;
    if (!candidate.pathname.startsWith(expectedPrefix) || candidate.pathname.length <= expectedPrefix.length) return false;
    if (circleId != null) {
      if (!isPersistedChatUuid(circleId) || !candidate.pathname.startsWith(`${expectedPrefix}${circleId}/`)) return false;
    }
    if (!candidate.searchParams.get('token')) return false;
    return true;
  } catch {
    return false;
  }
}

/** Remove every transient URL and non-allowlisted field before persistence. */
export function projectGeneratedChatImageArtifactForPersistence(
  artifact: SwanBotStructuredArtifact,
): SwanBotStructuredArtifact {
  if (!isGeneratedChatImageArtifact(artifact)) return artifact;
  const metadata = readGeneratedChatImageMetadata(artifact);
  return {
    kind: 'image',
    title: boundedGeneratedChatImageString(artifact.title, MAX_LABEL_CHARS) || 'Generated image',
    content: null,
    metadata: metadata || { source: GENERATED_CHAT_IMAGE_SOURCE },
  };
}
