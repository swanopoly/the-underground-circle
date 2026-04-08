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
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const ALLOWED_AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4'];
const ALLOWED_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES, ...ALLOWED_AUDIO_TYPES];

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

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('chat-media')
      .getPublicUrl(data.path);

    return urlData?.publicUrl || null;
  } catch (err) {
    console.error('[chatMedia] uploadToStorage error:', err);
    return null;
  }
}

// ─── Prepare Image for AI ────────────────────────────────────────────────────

export function prepareImageForAI(attachment: ChatAttachment): string {
  if (attachment.type !== 'image') {
    return `The user has attached a ${attachment.type} file: "${attachment.name}" (${formatFileSize(attachment.size)}). Acknowledge the attachment and respond to their message.`;
  }

  if (attachment.base64) {
    // Truncate base64 for context window — provide enough for description
    const preview = attachment.base64.slice(0, 200);
    return `[User attached an image: "${attachment.name}" (${formatFileSize(attachment.size)}, ${attachment.mimeType}). Base64 preview: ${preview}... Describe what context this image might provide and respond helpfully to their message.]`;
  }

  return `[User attached an image: "${attachment.name}" (${formatFileSize(attachment.size)}). Acknowledge the image and respond to their message.]`;
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
