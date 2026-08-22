/**
 * chatAttachments — Phase C1 of the OpenSwan/Chat Architecture Plan.
 *
 * Upload any file to Supabase Storage `chat-attachments` bucket, track
 * metadata in `message_attachments`, create signed URLs for reading,
 * extract text from text-like files for inline context injection.
 *
 * Upload path: {circle_id}/{thread_id}/{user_id}/{uuid}-{filename}
 * Signed URLs: 1h expiry, generated on demand.
 * Text extraction: inline for text/* and .csv/.json/.md/.ts/.js/.py
 *   (up to 10k chars); images/PDFs deferred to async OCR pipeline.
 */

import { supabase } from './supabase';
import { Platform } from 'react-native';

const BUCKET = 'chat-attachments';
const MAX_FILE_SIZE = 50 * 1024 * 1024;     // 50 MB
const MAX_FILES_PER_MESSAGE = 10;
const MAX_EXTRACT_CHARS = 10_000;
const SIGN_URL_EXPIRY_S = 3600;              // 1 hour
const PERSISTED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Types ───────────────────────────────────────────────────────────────────

export interface ChatAttachment {
  id: string;
  messageId: string | null;
  circleId: string;
  threadId: string | null;
  userId: string;
  storagePath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  extractText: string | null;
  ocrText: string | null;
  createdAt: string;
  signedUrl?: string;
}

export interface StagedFile {
  file: File;
  id: string;             // client-side temp id for the chip strip
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewUrl?: string;     // object URL for image thumbnails
  uploading: boolean;
  error?: string;
  attachment?: ChatAttachment;   // filled after upload succeeds
}

// ── Upload ──────────────────────────────────────────────────────────────────

function storagePath(circleId: string, threadId: string | null, userId: string, filename: string): string {
  const safeThread = threadId || '_direct';
  const uuid = crypto.randomUUID();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return `${circleId}/${safeThread}/${userId}/${uuid}-${safeName}`;
}

function isTextLike(mimeType: string, name: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ['json', 'csv', 'md', 'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'sql', 'sh', 'yaml', 'yml', 'toml', 'xml', 'html', 'css', 'scss', 'env', 'conf', 'cfg', 'ini', 'log'].includes(ext);
}

async function readTextFromFile(file: File): Promise<string | null> {
  try {
    const text = await file.text();
    return text.slice(0, MAX_EXTRACT_CHARS) || null;
  } catch {
    return null;
  }
}

export async function uploadAttachment(opts: {
  file: File;
  circleId: string;
  threadId: string | null;
  userId: string;
}): Promise<ChatAttachment> {
  const { file, circleId, threadId, userId } = opts;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max is 50 MB.`);
  }

  const path = storagePath(circleId, threadId, userId, file.name);
  const mime = file.type || 'application/octet-stream';

  // 1. Upload to storage
  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: mime, upsert: false });
  if (storageErr) throw new Error(`Upload failed: ${storageErr.message}`);

  // 2. Extract text for text-like files (inline, sync)
  let extractText: string | null = null;
  if (isTextLike(mime, file.name) && file.size < MAX_EXTRACT_CHARS * 2) {
    extractText = await readTextFromFile(file);
  }

  // 3. Write metadata row
  const { data, error: dbErr } = await supabase
    .from('message_attachments')
    .insert({
      circle_id: circleId,
      thread_id: threadId,
      user_id: userId,
      storage_path: path,
      original_name: file.name,
      mime_type: mime,
      size_bytes: file.size,
      extract_text: extractText,
    })
    .select()
    .single();
  if (dbErr || !data) throw new Error(`Metadata insert failed: ${dbErr?.message || 'unknown'}`);

  return mapRow(data);
}

// ── Link staged attachments to a message after send ─────────────────────────

export async function linkAttachmentsToMessage(
  attachmentIds: string[],
  messageId: string,
  expectedScope: Readonly<{
    circleId: string;
    threadId: string;
    userId: string;
  }>,
): Promise<readonly string[]> {
  const uniqueIds = Array.from(new Set(attachmentIds));
  if (
    uniqueIds.length > MAX_FILES_PER_MESSAGE
    || uniqueIds.length !== attachmentIds.length
    || uniqueIds.some((id) => !PERSISTED_UUID_RE.test(id))
    || !PERSISTED_UUID_RE.test(messageId)
    || !PERSISTED_UUID_RE.test(expectedScope.circleId)
    || !PERSISTED_UUID_RE.test(expectedScope.threadId)
    || !PERSISTED_UUID_RE.test(expectedScope.userId)
  ) {
    throw new Error('Attachment linkage requires unique persisted UUID identities in one exact Chat scope.');
  }
  if (uniqueIds.length === 0) return Object.freeze([]);

  // Compare-and-set only unlinked rows (or the same message on a safe retry).
  // The circle/thread/user filters mirror the expected upload scope, while the
  // returned rows prove that RLS admitted every requested owned attachment.
  const { data, error } = await supabase
    .from('message_attachments')
    .update({ message_id: messageId })
    .in('id', uniqueIds)
    .eq('circle_id', expectedScope.circleId)
    .eq('thread_id', expectedScope.threadId)
    .eq('user_id', expectedScope.userId)
    .or(`message_id.is.null,message_id.eq.${messageId}`)
    .select('id, message_id, circle_id, thread_id, user_id');
  if (error) throw new Error(`Attachment linkage failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];
  const returnedIds = new Set<string>();
  for (const row of rows) {
    if (
      !row
      || typeof row.id !== 'string'
      || returnedIds.has(row.id)
      || !uniqueIds.includes(row.id)
      || row.message_id !== messageId
      || row.circle_id !== expectedScope.circleId
      || row.thread_id !== expectedScope.threadId
      || row.user_id !== expectedScope.userId
    ) {
      throw new Error('Attachment linkage returned an ambiguous or cross-scope row.');
    }
    returnedIds.add(row.id);
  }
  if (returnedIds.size !== uniqueIds.length || uniqueIds.some((id) => !returnedIds.has(id))) {
    throw new Error('Attachment linkage did not verify every requested attachment.');
  }
  return Object.freeze([...uniqueIds]);
}

// ── List attachments for a message / thread ─────────────────────────────────

export async function listAttachmentsForMessage(messageId: string): Promise<ChatAttachment[]> {
  const { data, error } = await supabase
    .from('message_attachments')
    .select('*')
    .eq('message_id', messageId)
    .order('created_at');
  if (error || !data) return [];
  return data.map(mapRow);
}

export async function listAttachmentsForThread(threadId: string): Promise<ChatAttachment[]> {
  const { data, error } = await supabase
    .from('message_attachments')
    .select('*')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map(mapRow);
}

// ── Signed URLs ─────────────────────────────────────────────────────────────

export async function getSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, SIGN_URL_EXPIRY_S);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function getSignedUrls(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;
  // Batch in groups of 20 (Supabase limit)
  for (let i = 0; i < paths.length; i += 20) {
    const batch = paths.slice(i, i + 20);
    const { data } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(batch, SIGN_URL_EXPIRY_S);
    if (data) {
      for (const item of data) {
        if (item.signedUrl && item.path) map.set(item.path, item.signedUrl);
      }
    }
  }
  return map;
}

// ── Delete ──────────────────────────────────────────────────────────────────

export async function deleteAttachment(attachmentId: string): Promise<boolean> {
  const { data } = await supabase
    .from('message_attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .single();
  if (!data) return false;
  // Remove from storage
  await supabase.storage.from(BUCKET).remove([(data as any).storage_path]);
  // Remove metadata
  const { error } = await supabase
    .from('message_attachments')
    .delete()
    .eq('id', attachmentId);
  return !error;
}

// ── Context for prompt injection (Block D) ──────────────────────────────────
// Build the text that gets injected into the OpenSwan system prompt when
// the current message has attachments. Text files get inlined; images and
// binaries get a signed URL + summary.

export async function buildAttachmentContext(attachments: ChatAttachment[]): Promise<string> {
  if (attachments.length === 0) return '';
  const lines: string[] = ['## Attached files'];

  for (const att of attachments.slice(0, MAX_FILES_PER_MESSAGE)) {
    const isImage = att.mimeType.startsWith('image/');
    const isText = isTextLike(att.mimeType, att.originalName);

    if (isText && att.extractText) {
      const preview = att.extractText.length > 2000
        ? att.extractText.slice(0, 2000) + '\n...(truncated)'
        : att.extractText;
      lines.push(`### ${att.originalName} (${att.mimeType}, ${formatSize(att.sizeBytes)})`);
      lines.push('```');
      lines.push(preview);
      lines.push('```');
    } else if (isImage) {
      lines.push(`### ${att.originalName} (${att.mimeType}, ${formatSize(att.sizeBytes)})`);
      if (att.ocrText) lines.push(`OCR text: ${att.ocrText.slice(0, 500)}`);
      else lines.push('[Image — no OCR available yet]');
    } else {
      lines.push(`### ${att.originalName} (${att.mimeType}, ${formatSize(att.sizeBytes)})`);
      lines.push('[Binary file — filename + type available for reference]');
    }
  }
  return lines.join('\n');
}

// ── Staging helpers for the composer ────────────────────────────────────────

export function createStagedFile(file: File): StagedFile {
  const isImage = file.type.startsWith('image/');
  return {
    file,
    id: crypto.randomUUID(),
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    sizeBytes: file.size,
    previewUrl: isImage && Platform.OS === 'web' ? URL.createObjectURL(file) : undefined,
    uploading: false,
  };
}

export function revokeStagedPreviews(staged: StagedFile[]): void {
  for (const s of staged) {
    if (s.previewUrl) {
      try { URL.revokeObjectURL(s.previewUrl); } catch {}
    }
  }
}

// ── Internal helpers ────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function mapRow(d: any): ChatAttachment {
  return {
    id: d.id,
    messageId: d.message_id,
    circleId: d.circle_id,
    threadId: d.thread_id,
    userId: d.user_id,
    storagePath: d.storage_path,
    originalName: d.original_name,
    mimeType: d.mime_type,
    sizeBytes: d.size_bytes,
    extractText: d.extract_text,
    ocrText: d.ocr_text,
    createdAt: d.created_at,
  };
}
