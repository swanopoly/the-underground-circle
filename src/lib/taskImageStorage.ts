import type { SupabaseClient } from '@supabase/supabase-js';

const TASK_IMAGE_BUCKET = 'task-images';
const TASK_IMAGE_REFERENCE_PREFIX = 'task-image:';
const TASK_IMAGE_SIGN_TTL_SECONDS = 15 * 60;
const TASK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validTaskImagePath(value: string): boolean {
  const slash = value.indexOf('/');
  return slash > 0
    && slash === value.lastIndexOf('/')
    && TASK_UUID_RE.test(value.slice(0, slash))
    && value.slice(slash + 1).length > 0
    && value.slice(slash + 1).length <= 180;
}

export function buildTaskImageStoragePath(taskId: string, filename: string): string {
  if (!TASK_UUID_RE.test(taskId)) throw new Error('A persisted task id is required for an attachment.');
  const safeName = String(filename || 'attachment')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 120) || 'attachment';
  return `${taskId}/${Date.now()}-${safeName}`;
}

export function toTaskImageStorageReference(storagePath: string): string {
  if (!validTaskImagePath(storagePath)) throw new Error('Invalid task attachment path.');
  return `${TASK_IMAGE_REFERENCE_PREFIX}${encodeURIComponent(storagePath)}`;
}

/**
 * Resolve only our opaque reference or a legacy URL from this exact Supabase
 * project's task-images bucket. Arbitrary external HTTPS images are not
 * rewritten and never gain Storage authorization through this parser.
 */
export function taskImageStoragePathFromValue(
  value: string | null | undefined,
  supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '',
): string | null {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  if (normalized.startsWith(TASK_IMAGE_REFERENCE_PREFIX)) {
    try {
      const decoded = decodeURIComponent(normalized.slice(TASK_IMAGE_REFERENCE_PREFIX.length));
      return validTaskImagePath(decoded) ? decoded : null;
    } catch {
      return null;
    }
  }

  try {
    const configured = new URL(supabaseUrl);
    const candidate = new URL(normalized);
    if (candidate.origin !== configured.origin) return null;
    const prefixes = [
      `/storage/v1/object/public/${TASK_IMAGE_BUCKET}/`,
      `/storage/v1/object/sign/${TASK_IMAGE_BUCKET}/`,
      `/storage/v1/object/authenticated/${TASK_IMAGE_BUCKET}/`,
    ];
    const prefix = prefixes.find(item => candidate.pathname.startsWith(item));
    if (!prefix) return null;
    const path = decodeURIComponent(candidate.pathname.slice(prefix.length));
    return validTaskImagePath(path) ? path : null;
  } catch {
    return null;
  }
}

export function redactUnresolvedTaskImageValue(value: string | null | undefined): string | null {
  if (!value) return null;
  return taskImageStoragePathFromValue(value) ? null : value;
}

export async function createTaskImageSignedUrl(
  client: SupabaseClient,
  storagePath: string,
): Promise<string | null> {
  if (!validTaskImagePath(storagePath)) return null;
  const { data, error } = await client.storage
    .from(TASK_IMAGE_BUCKET)
    .createSignedUrl(storagePath, TASK_IMAGE_SIGN_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function resolveTaskImageValues(
  client: SupabaseClient,
  values: readonly (string | null | undefined)[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const valuesByPath = new Map<string, string[]>();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value || result.has(value)) continue;
    const path = taskImageStoragePathFromValue(value);
    if (!path) {
      result.set(value, value);
      continue;
    }
    const originals = valuesByPath.get(path) || [];
    originals.push(value);
    valuesByPath.set(path, originals);
  }

  const paths = [...valuesByPath.keys()];
  for (let offset = 0; offset < paths.length; offset += 20) {
    const batch = paths.slice(offset, offset + 20);
    const { data, error } = await client.storage
      .from(TASK_IMAGE_BUCKET)
      .createSignedUrls(batch, TASK_IMAGE_SIGN_TTL_SECONDS);
    const signedByPath = new Map<string, string>();
    if (!error) {
      for (const item of data || []) {
        if (item.path && item.signedUrl) signedByPath.set(item.path, item.signedUrl);
      }
    }
    for (const path of batch) {
      const signedUrl = signedByPath.get(path) || null;
      for (const original of valuesByPath.get(path) || []) result.set(original, signedUrl);
    }
  }
  return result;
}
