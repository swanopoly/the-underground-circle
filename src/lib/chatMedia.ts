/**
 * Chat Media Attachments
 * Handles media picking, upload to Supabase Storage, and AI vision prep.
 */

import { supabase } from './supabase';
import { Platform } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatAttachment {
  id: string;
  type: 'image' | 'video' | 'file' | 'audio';
  uri: string;
  name: string;
  mimeType: string;
  size: number;
  base64?: string; // for AI vision
  uploadedUrl?: string; // after Supabase storage upload
  extractText?: string;
  isFigma?: boolean;
  /** Web-only in-memory authority used to migrate picker attachments into the
   * canonical staged upload flow. Never persist or include this object in a
   * model prompt. */
  sourceFile?: File;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ATTACHMENTS = 20;
const MAX_TEXT_EXTRACT = 8_000;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'];
const TEXT_LIKE_EXTENSIONS = ['txt', 'md', 'markdown', 'json', 'csv', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'scss', 'sql', 'py', 'rb', 'go', 'rs', 'java', 'xml', 'yaml', 'yml', 'toml'];
const FIGMA_EXTENSIONS = ['fig', 'figma'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];

function inferAttachmentType(mimeType: string): ChatAttachment['type'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'file';
}

function isTextLikeAttachment(name: string, mimeType: string): boolean {
  if (mimeType.startsWith('text/')) return true;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return TEXT_LIKE_EXTENSIONS.includes(ext);
}

function isFigmaLikeAttachment(name: string, mimeType: string): boolean {
  const lower = `${name} ${mimeType}`.toLowerCase();
  return FIGMA_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() || '') || lower.includes('figma') || lower.includes('application/vnd.figma');
}

async function readTextPreview(file: File): Promise<string | undefined> {
  try {
    const text = await file.text();
    return text.slice(0, MAX_TEXT_EXTRACT) || undefined;
  } catch {
    return undefined;
  }
}

// ─── Pick Image ──────────────────────────────────────────────────────────────

export async function pickImage(): Promise<ChatAttachment | null> {
  try {
    const ImagePicker = await import('expo-image-picker');

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[chatMedia] Media library permission not granted');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
      base64: true,
      exif: false,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const uri = asset.uri;
    const mimeType = asset.mimeType || 'image/jpeg';
    const fileName = asset.fileName || `image_${Date.now()}.jpg`;
    const fileSize = asset.fileSize || 0;

    if (fileSize > MAX_FILE_SIZE) {
      console.warn('[chatMedia] File too large:', fileSize);
      return null;
    }

    return {
      id: `attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'image',
      uri,
      name: fileName,
      mimeType,
      size: fileSize,
      base64: asset.base64 || undefined,
    };
  } catch (err) {
    console.error('[chatMedia] pickImage error:', err);
    return null;
  }
}

// ─── Pick Media (images + videos) ────────────────────────────────────────────

export async function pickMedia(): Promise<ChatAttachment | null> {
  try {
    const ImagePicker = await import('expo-image-picker');

    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      console.warn('[chatMedia] Media library permission not granted');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsEditing: false,
      quality: 0.8,
      base64: true,
      exif: false,
      videoMaxDuration: 60,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return null;
    }

    const asset = result.assets[0];
    const isVideo = asset.type === 'video';
    const uri = asset.uri;
    const mimeType = asset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');
    const fileName = asset.fileName || (isVideo ? `video_${Date.now()}.mp4` : `image_${Date.now()}.jpg`);
    const fileSize = asset.fileSize || 0;

    if (fileSize > MAX_FILE_SIZE) {
      console.warn('[chatMedia] File too large:', fileSize);
      return null;
    }

    return {
      id: `attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: isVideo ? 'video' : 'image',
      uri,
      name: fileName,
      mimeType,
      size: fileSize,
      base64: asset.base64 || undefined,
    };
  } catch (err) {
    console.error('[chatMedia] pickMedia error:', err);
    return null;
  }
}

// ─── Pick Files (web-first, multiple) ──────────────────────────────────────

export async function pickAttachments(): Promise<ChatAttachment[]> {
  if (Platform.OS !== 'web') {
    const single = await pickImage();
    return single ? [single] : [];
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = '*';
    input.onchange = async () => {
      const files = Array.from(input.files || []).slice(0, MAX_ATTACHMENTS);
      const picked = await Promise.all(files.map(async (file): Promise<ChatAttachment | null> => {
        if (file.size > MAX_FILE_SIZE) return null;
        const mimeType = file.type || 'application/octet-stream';
        const type = inferAttachmentType(mimeType);
        const isImage = type === 'image';
        let base64: string | undefined;
        if (isImage) {
          try {
            base64 = await new Promise<string | undefined>((res) => {
              const reader = new FileReader();
              reader.onload = () => {
                const result = typeof reader.result === 'string' ? reader.result : '';
                const comma = result.indexOf(',');
                res(comma >= 0 ? result.slice(comma + 1) : undefined);
              };
              reader.onerror = () => res(undefined);
              reader.readAsDataURL(file);
            });
          } catch {}
        }
        const extractText = isTextLikeAttachment(file.name, mimeType) ? await readTextPreview(file) : undefined;
        return {
          id: `attach-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          uri: URL.createObjectURL(file),
          name: file.name,
          mimeType,
          size: file.size,
          base64,
          extractText,
          isFigma: isFigmaLikeAttachment(file.name, mimeType),
          sourceFile: file,
        };
      }));
      resolve(picked.filter(Boolean) as ChatAttachment[]);
    };
    input.click();
  });
}

// ─── Upload to Supabase Storage ──────────────────────────────────────────────

export async function uploadToStorage(
  attachment: ChatAttachment,
  circleId: string,
  userId: string
): Promise<string | null> {
  try {
    // Validate size
    if (attachment.size > MAX_FILE_SIZE) {
      console.warn('[chatMedia] File exceeds 10MB limit');
      return null;
    }

    // Validate type
    if (!ALLOWED_TYPES.includes(attachment.mimeType)) {
      console.warn('[chatMedia] Unsupported file type:', attachment.mimeType);
      return null;
    }

    const ext = attachment.name.split('.').pop() || 'bin';
    const timestamp = Date.now();
    const path = `${circleId}/${userId}/${timestamp}.${ext}`;

    let uploadData: Blob | ArrayBuffer;
    if (attachment.base64) {
      // Convert base64 to blob for upload
      const binaryStr = atob(attachment.base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      uploadData = new Blob([bytes], { type: attachment.mimeType });
    } else if (Platform.OS === 'web') {
      // On web, fetch the blob from uri
      const response = await fetch(attachment.uri);
      uploadData = await response.blob();
    } else {
      // On native, use the URI directly via FormData approach
      const response = await fetch(attachment.uri);
      uploadData = await response.blob();
    }

    const { data, error } = await supabase.storage
      .from('chat-media')
      .upload(path, uploadData, {
        contentType: attachment.mimeType,
        upsert: false,
      });

    if (error) {
      console.error('[chatMedia] Upload error:', error.message);
      return null;
    }

    // Never turn a chat upload into a durable bearer-by-URL asset. This legacy
    // helper currently has no callers, but keeping its contract private avoids
    // reintroducing public image URLs if it is reused later.
    const { data: urlData, error: signedUrlError } = await supabase.storage
      .from('chat-media')
      .createSignedUrl(data.path, 3600);

    if (signedUrlError) {
      console.error('[chatMedia] Signed URL error:', signedUrlError.message);
      return null;
    }
    return urlData?.signedUrl || null;
  } catch (err) {
    console.error('[chatMedia] uploadToStorage error:', err);
    return null;
  }
}

// ─── Prepare Image for AI ────────────────────────────────────────────────────

export function prepareImageForAI(attachment: ChatAttachment): string {
  if (attachment.isFigma) {
    const preview = attachment.extractText ? `\nExtracted text preview:\n${attachment.extractText.slice(0, 1000)}` : '';
    return `[User attached a Figma design source "${attachment.name}" (${formatFileSize(attachment.size)}, ${attachment.mimeType}). Treat it as the visual source of truth. If they ask for a webpage, translate this design into a production-ready HTML page with faithful layout, spacing hierarchy, sections, and component structure.${preview}]`;
  }

  if (attachment.type !== 'image') {
    if (attachment.extractText) {
      return `[User attached file "${attachment.name}" (${formatFileSize(attachment.size)}, ${attachment.mimeType}). Use this file as context.\n${attachment.extractText.slice(0, 1500)}${attachment.extractText.length > 1500 ? '\n...(truncated)' : ''}]`;
    }
    return `The user has attached a ${attachment.type} file: "${attachment.name}" (${formatFileSize(attachment.size)}, ${attachment.mimeType}). Use it as supporting context and acknowledge any limitations if the file is binary.`;
  }

  // Image bytes are never meaningful as text. The old path copied the first
  // 200 base64 characters into the prompt and invited the model to guess what
  // they represented; that was neither vision nor a safe description. Actual
  // pixels now travel only through the typed multimodal vision boundary. This
  // helper remains metadata-only for callers that have not migrated yet.
  return `[User attached an image: "${attachment.name}" (${formatFileSize(attachment.size)}, ${attachment.mimeType}). No visual description has been generated in this text-only context. Do not infer image contents from the filename or encoded bytes.]`;
}

export function buildAttachmentPromptContext(attachments: ChatAttachment[]): string {
  if (!attachments.length) return '';
  const lines: string[] = ['## Attachments'];
  for (const attachment of attachments) {
    const prefix = attachment.isFigma ? '[FIGMA DESIGN]' : `[${attachment.type.toUpperCase()}]`;
    lines.push(`${prefix} ${attachment.name} — ${attachment.mimeType} — ${formatFileSize(attachment.size)}`);
    if (attachment.extractText) {
      lines.push('```');
      lines.push(attachment.extractText.slice(0, 2000));
      if (attachment.extractText.length > 2000) lines.push('...(truncated)');
      lines.push('```');
    }
  }
  if (attachments.some((attachment) => attachment.isFigma)) {
    lines.push('If the user is asking for a webpage or builder output, convert the Figma design references into a single self-contained HTML implementation.');
  }
  return lines.join('\n');
}

// ─── Media Type Icon ─────────────────────────────────────────────────────────

export function getMediaTypeIcon(type: string): string {
  switch (type) {
    case 'image': return 'IMG';
    case 'video': return 'VID';
    case 'file': return 'DOC';
    case 'audio': return 'AUD';
    default: return 'FILE';
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
