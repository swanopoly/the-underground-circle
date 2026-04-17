/**
 * ChatAttachmentStrip — Phase C1 UI. Sits above the composer input.
 * Shows staged files as chips with thumbnails (images) or file-type
 * icons (everything else). Each chip has a remove button. Also handles
 * the hidden file input and drag-drop overlay on web.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  type StagedFile,
  createStagedFile,
  revokeStagedPreviews,
  uploadAttachment,
} from '../../../../lib/chatAttachments';

interface Props {
  circleId: string;
  threadId: string | null;
  userId: string;
  staged: StagedFile[];
  onStagedChange: React.Dispatch<React.SetStateAction<StagedFile[]>>;
  maxFiles?: number;
  accentColor?: string;
  showAttachButton?: boolean;
}

const FILE_TYPE_ICONS: Record<string, string> = {
  image: 'IMG', video: 'VID', audio: 'AUD', pdf: 'PDF',
  text: 'TXT', code: '</>', csv: 'CSV', zip: 'ZIP',
  default: 'FILE',
};

function fileIcon(mime: string, name: string): string {
  if (mime.startsWith('image/')) return FILE_TYPE_ICONS.image;
  if (mime.startsWith('video/')) return FILE_TYPE_ICONS.video;
  if (mime.startsWith('audio/')) return FILE_TYPE_ICONS.audio;
  if (mime === 'application/pdf') return FILE_TYPE_ICONS.pdf;
  if (mime.startsWith('text/') || /\.(ts|js|py|go|rs|rb|sh|sql)$/i.test(name)) return FILE_TYPE_ICONS.code;
  if (/\.csv$/i.test(name)) return FILE_TYPE_ICONS.csv;
  if (/\.(zip|tar|gz|rar|7z)$/i.test(name)) return FILE_TYPE_ICONS.zip;
  if (mime.startsWith('text/')) return FILE_TYPE_ICONS.text;
  return FILE_TYPE_ICONS.default;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export default function ChatAttachmentStrip({
  circleId, threadId, userId, staged, onStagedChange,
  maxFiles = 10, accentColor = '#22d3ee',
  showAttachButton = true,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = useCallback((files: File[]) => {
    const remaining = maxFiles - staged.length;
    if (remaining <= 0) return;
    const toAdd = files.slice(0, remaining).map(createStagedFile);
    const next = [...staged, ...toAdd];
    onStagedChange(next);

    // Start uploading each one
    for (const sf of toAdd) {
      void (async () => {
        onStagedChange(prev => prev.map(s => s.id === sf.id ? { ...s, uploading: true } : s));
        try {
          const att = await uploadAttachment({ file: sf.file, circleId, threadId, userId });
          onStagedChange(prev => prev.map(s => s.id === sf.id ? { ...s, uploading: false, attachment: att } : s));
        } catch (err: any) {
          onStagedChange(prev => prev.map(s => s.id === sf.id ? { ...s, uploading: false, error: err?.message || 'Upload failed' } : s));
        }
      })();
    }
  }, [staged, maxFiles, circleId, threadId, userId, onStagedChange]);

  const handleRemove = useCallback((id: string) => {
    const removed = staged.filter(s => s.id === id);
    revokeStagedPreviews(removed);
    onStagedChange(staged.filter(s => s.id !== id));
  }, [staged, onStagedChange]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) addFiles(files);
    if (e.target) e.target.value = '';
  }, [addFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
  }, [addFiles]);

  const openPicker = useCallback(() => {
    if (Platform.OS === 'web' && fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  return (
    <View
      style={[styles.container, dragOver && styles.dragOverContainer]}
      {...(Platform.OS === 'web' ? {
        onDragOver: (e: any) => { e.preventDefault(); setDragOver(true); },
        onDragLeave: () => setDragOver(false),
        onDrop: handleDrop,
      } as any : {})}
    >
      {/* Hidden file input (web only) */}
      {Platform.OS === 'web' && (
        <input
          ref={fileInputRef as any}
          type="file"
          multiple
          accept="*"
          onChange={handleFileInput as any}
          style={{ display: 'none' }}
        />
      )}

      {/* Optional + Attach button */}
      {showAttachButton ? (
        <Pressable onPress={openPicker} style={[styles.attachBtn, { borderColor: accentColor }]}>
          <Text style={[styles.attachBtnText, { color: accentColor }]}>+ ATTACH</Text>
        </Pressable>
      ) : null}

      {/* Staged file chips */}
      {staged.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {staged.map(sf => {
            const isImage = sf.mimeType.startsWith('image/');
            return (
              <View key={sf.id} style={[styles.chip, sf.error && styles.chipError]}>
                {isImage && sf.previewUrl ? (
                  <Image source={{ uri: sf.previewUrl }} style={styles.chipThumb} />
                ) : (
                  <View style={styles.chipIcon}>
                    <Text style={styles.chipIconText}>{fileIcon(sf.mimeType, sf.name)}</Text>
                  </View>
                )}
                <View style={styles.chipInfo}>
                  <Text style={styles.chipName} numberOfLines={1}>{sf.name}</Text>
                  <Text style={styles.chipSize}>
                    {sf.uploading ? 'uploading...' : sf.error ? 'failed' : formatSize(sf.sizeBytes)}
                  </Text>
                </View>
                <Pressable onPress={() => handleRemove(sf.id)} style={styles.chipRemove} hitSlop={4}>
                  <Text style={styles.chipRemoveText}>x</Text>
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Drag-drop hint */}
      {dragOver && (
        <View style={styles.dragHint}>
          <Text style={styles.dragHintText}>Drop files here</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  dragOverContainer: { borderWidth: 2, borderColor: '#22d3ee', borderStyle: 'dashed', borderRadius: 8, padding: 4 },
  attachBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 6, borderWidth: 1,
    backgroundColor: '#0b1220',
  },
  attachBtnText: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  chipRow: { gap: 6, paddingVertical: 4 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 6, borderWidth: 1, borderColor: '#1e293b',
    backgroundColor: '#0a0f17', maxWidth: 200,
  },
  chipError: { borderColor: '#ef4444' },
  chipThumb: { width: 28, height: 28, borderRadius: 4 },
  chipIcon: {
    width: 28, height: 28, borderRadius: 4,
    backgroundColor: '#152032', alignItems: 'center', justifyContent: 'center',
  },
  chipIconText: { fontSize: 8, fontWeight: '900', color: '#94a3b8', fontFamily: 'monospace' },
  chipInfo: { flex: 1, gap: 1 },
  chipName: { fontSize: 10, fontWeight: '700', color: '#e2e8f0', fontFamily: 'monospace' },
  chipSize: { fontSize: 9, color: '#64748b', fontFamily: 'monospace' },
  chipRemove: {
    width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1e293b',
  },
  chipRemoveText: { fontSize: 10, fontWeight: '900', color: '#94a3b8' },
  dragHint: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(34,211,238,0.08)',
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 8,
  },
  dragHintText: { fontSize: 12, fontWeight: '900', color: '#22d3ee', fontFamily: 'monospace' },
});
