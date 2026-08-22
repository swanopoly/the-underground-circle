import type { SupabaseClient } from '@supabase/supabase-js';

const CIRCLE_IMAGE_BUCKET = 'circle-images';
const CIRCLE_IMAGE_REFERENCE_PREFIX = 'circle-image:';
const CIRCLE_IMAGE_SIGN_TTL_SECONDS = 15 * 60;
const CIRCLE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validCircleImagePath(value: string): boolean {
  const parts = value.split('/');
  return parts.length === 3
    && parts[0] === 'circles'
    && CIRCLE_UUID_RE.test(parts[1])
    && /^icon\.[a-z0-9]{2,8}$/i.test(parts[2]);
}

export function buildCircleImageStoragePath(circleId: string, extension: string): string {
  if (!CIRCLE_UUID_RE.test(circleId)) throw new Error('A persisted Circle id is required.');
  const normalizedExtension = String(extension || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'jpg';
  return `circles/${circleId}/icon.${normalizedExtension}`;
}

export function toCircleImageStorageReference(storagePath: string): string {
  if (!validCircleImagePath(storagePath)) throw new Error('Invalid Circle image path.');
  return `${CIRCLE_IMAGE_REFERENCE_PREFIX}${encodeURIComponent(storagePath)}`;
}

/**
 * Resolve only an opaque reference or a legacy URL from this exact project's
 * Circle image bucket. A foreign URL never gains Storage authorization here.
 */
export function circleImageStoragePathFromValue(
  value: string | null | undefined,
  supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '',
): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith(CIRCLE_IMAGE_REFERENCE_PREFIX)) {
    try {
      const decoded = decodeURIComponent(normalized.slice(CIRCLE_IMAGE_REFERENCE_PREFIX.length));
      return validCircleImagePath(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }
  try {
    const configured = new URL(supabaseUrl);
    const candidate = new URL(normalized);
    if (candidate.origin !== configured.origin) return null;
    const prefixes = [
      `/storage/v1/object/public/${CIRCLE_IMAGE_BUCKET}/`,
      `/storage/v1/object/sign/${CIRCLE_IMAGE_BUCKET}/`,
      `/storage/v1/object/authenticated/${CIRCLE_IMAGE_BUCKET}/`,
    ];
    const prefix = prefixes.find((item) => candidate.pathname.startsWith(item));
    if (!prefix) return null;
    const path = decodeURIComponent(candidate.pathname.slice(prefix.length));
    return validCircleImagePath(path) ? path : null;
  } catch {
    return null;
  }
}

export function persistedCircleImageValue(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const path = circleImageStoragePathFromValue(normalized);
  return path ? toCircleImageStorageReference(path) : normalized;
}

export function redactUnresolvedCircleImageValue(value: string | null | undefined): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return circleImageStoragePathFromValue(normalized) ? null : normalized;
}

export async function createCircleImageSignedUrl(
  client: SupabaseClient,
  value: string | null | undefined,
): Promise<string | null> {
  const path = circleImageStoragePathFromValue(value);
  if (!path) return redactUnresolvedCircleImageValue(value);
  const { data, error } = await client.storage
    .from(CIRCLE_IMAGE_BUCKET)
    .createSignedUrl(path, CIRCLE_IMAGE_SIGN_TTL_SECONDS);
  return error ? null : data?.signedUrl || null;
}

export async function resolveCircleImageValues(
  client: SupabaseClient,
  values: readonly (string | null | undefined)[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const originalsByPath = new Map<string, string[]>();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || result.has(value)) continue;
    const path = circleImageStoragePathFromValue(value);
    if (!path) {
      result.set(value, value);
      continue;
    }
    originalsByPath.set(path, [...(originalsByPath.get(path) || []), value]);
  }
  const paths = [...originalsByPath.keys()];
  for (let offset = 0; offset < paths.length; offset += 20) {
    const batch = paths.slice(offset, offset + 20);
    const { data, error } = await client.storage
      .from(CIRCLE_IMAGE_BUCKET)
      .createSignedUrls(batch, CIRCLE_IMAGE_SIGN_TTL_SECONDS);
    const signedByPath = new Map<string, string>();
    if (!error) {
      for (const item of data || []) {
        if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
      }
    }
    for (const path of batch) {
      const signed = signedByPath.get(path) || null;
      for (const original of originalsByPath.get(path) || []) result.set(original, signed);
    }
  }
  return result;
}

export const CIRCLE_IMAGE_PRIVATE_BUCKET = CIRCLE_IMAGE_BUCKET;
export const CIRCLE_IMAGE_PRIVATE_SIGN_TTL_SECONDS = CIRCLE_IMAGE_SIGN_TTL_SECONDS;
