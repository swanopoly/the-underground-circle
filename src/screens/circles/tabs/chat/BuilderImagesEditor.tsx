/**
 * BuilderImagesEditor — modal for managing the per-thread image library.
 * Add by URL, assign a role, optional alt text. Images auto-inject into
 * the next /build-page so the model uses them in appropriate slots.
 */

import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  type BuilderImage,
  type ImageRole,
  IMAGE_ROLE_LABELS,
  addBuilderImage,
  loadBuilderImages,
  removeBuilderImage,
  updateBuilderImage,
} from '../../../../lib/builderImages';

interface Props {
  threadId: string | null | undefined;
  visible: boolean;
  onClose: () => void;
  onChanged?: (images: BuilderImage[]) => void;
}

const ROLES: ImageRole[] = ['hero', 'feature', 'logo', 'background', 'avatar', 'product', 'gallery', 'other'];

export default function BuilderImagesEditor({ threadId, visible, onClose, onChanged }: Props) {
  const [images, setImages] = useState<BuilderImage[]>([]);
  const [urlDraft, setUrlDraft] = useState('');
  const [roleDraft, setRoleDraft] = useState<ImageRole>('hero');
  const [altDraft, setAltDraft] = useState('');

  useEffect(() => {
    if (!visible || !threadId) return;
    let cancelled = false;
    loadBuilderImages(threadId)
      .then(imgs => { if (!cancelled) setImages(imgs); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, threadId]);

  if (!threadId) return null;

  const commitAdd = async () => {
    const url = urlDraft.trim();
    if (!url) return;
    const next = await addBuilderImage(threadId, { url, role: roleDraft, alt: altDraft });
    setImages(next);
    onChanged?.(next);
    setUrlDraft('');
    setAltDraft('');
  };

  const commitRemove = async (id: string) => {
    const next = await removeBuilderImage(threadId, id);
    setImages(next);
    onChanged?.(next);
  };

  const commitRoleChange = async (id: string, role: ImageRole) => {
    const next = await updateBuilderImage(threadId, id, { role });
    setImages(next);
    onChanged?.(next);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>IMAGE LIBRARY</Text>
            <Text style={styles.subtitle}>
              URLs here are auto-injected into every /build-page so the model uses them.
              Paste a URL, pick a role, save. Up to 20 per thread.
            </Text>
          </View>

          <View style={styles.addRow}>
            <TextInput
              value={urlDraft}
              onChangeText={setUrlDraft}
              placeholder="https://…  (CDN, unsplash.com, Supabase Storage, etc.)"
              placeholderTextColor="#475569"
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roleRow}>
              {ROLES.map(r => {
                const active = roleDraft === r;
                return (
                  <Pressable
                    key={r}
                    onPress={() => setRoleDraft(r)}
                    style={[styles.roleChip, active && styles.roleChipActive]}
                  >
                    <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
                      {IMAGE_ROLE_LABELS[r]}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextInput
              value={altDraft}
              onChangeText={setAltDraft}
              placeholder="Alt text (optional but recommended)"
              placeholderTextColor="#475569"
              style={styles.input}
            />
            <Pressable onPress={commitAdd} style={[styles.primaryBtn, !urlDraft.trim() && { opacity: 0.5 }]}>
              <Text style={styles.primaryBtnText}>+ ADD IMAGE</Text>
            </Pressable>
          </View>

          <Text style={styles.listHeader}>IN LIBRARY · {images.length}</Text>
          <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={styles.list}>
            {images.length === 0 ? (
              <Text style={styles.empty}>No images yet. Add a few URLs above and the next build will use them.</Text>
            ) : (
              images.map(img => (
                <View key={img.id} style={styles.imageRow}>
                  <View style={styles.thumbWrap}>
                    <Image source={{ uri: img.url }} style={styles.thumb} resizeMode="cover" />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.imageUrl} numberOfLines={1}>{img.url}</Text>
                    <View style={styles.imageMeta}>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4 }}>
                        {ROLES.map(r => {
                          const active = img.role === r;
                          return (
                            <Pressable
                              key={r}
                              onPress={() => commitRoleChange(img.id, r)}
                              style={[styles.rolePill, active && styles.rolePillActive]}
                            >
                              <Text style={[styles.rolePillText, active && styles.rolePillTextActive]}>{r}</Text>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                    {img.alt && <Text style={styles.imageAlt} numberOfLines={1}>alt: {img.alt}</Text>}
                  </View>
                  <Pressable onPress={() => commitRemove(img.id)} style={styles.removeBtn}>
                    <Text style={styles.removeBtnText}>×</Text>
                  </Pressable>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={onClose} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>DONE</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  card: {
    width: '100%', maxWidth: 640, borderRadius: 12,
    backgroundColor: '#05070b', borderWidth: 1, borderColor: '#152032',
    padding: 14, gap: 12,
  },
  header: { gap: 4 },
  title: { color: '#d8e1ef', fontSize: 11, fontWeight: '900', letterSpacing: 1.3, fontFamily: 'monospace' },
  subtitle: { color: '#7f8ea3', fontSize: 11, lineHeight: 15 },
  addRow: {
    gap: 8, padding: 10,
    borderWidth: 1, borderColor: '#243246', borderRadius: 8, backgroundColor: '#0a0f17',
  },
  input: {
    color: '#e2e8f0', fontSize: 12, fontFamily: 'monospace',
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: '#152032', backgroundColor: '#05070b',
  },
  roleRow: { flexDirection: 'row', gap: 4, paddingVertical: 2 },
  roleChip: {
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17',
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
  },
  roleChipActive: { borderColor: '#22d3ee', backgroundColor: '#22d3ee1a' },
  roleChipText: { color: '#94a3b8', fontSize: 10, fontWeight: '800', letterSpacing: 0.5, fontFamily: 'monospace' },
  roleChipTextActive: { color: '#22d3ee' },
  primaryBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: '#22d3ee', backgroundColor: '#22d3ee18',
  },
  primaryBtnText: { color: '#22d3ee', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  listHeader: { color: '#425066', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, fontFamily: 'monospace' },
  list: { gap: 6 },
  empty: { color: '#475569', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', paddingVertical: 24 },
  imageRow: {
    flexDirection: 'row', gap: 10, padding: 8,
    borderRadius: 8, borderWidth: 1, borderColor: '#152032', backgroundColor: '#0a0f17',
    alignItems: 'center',
  },
  thumbWrap: { width: 56, height: 56, borderRadius: 4, overflow: 'hidden', backgroundColor: '#05070b' },
  thumb: { width: '100%', height: '100%' },
  imageUrl: { color: '#d8e1ef', fontSize: 11, fontFamily: 'monospace' },
  imageMeta: { flexDirection: 'row' },
  rolePill: {
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#05070b',
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  rolePillActive: { borderColor: '#22d3ee', backgroundColor: '#22d3ee1a' },
  rolePillText: { color: '#7f8ea3', fontSize: 9, fontWeight: '800', letterSpacing: 0.3, fontFamily: 'monospace' },
  rolePillTextActive: { color: '#22d3ee' },
  imageAlt: { color: '#64748b', fontSize: 10, fontFamily: 'monospace' },
  removeBtn: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1a1a1a', backgroundColor: '#05070b',
  },
  removeBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '900', lineHeight: 14 },
  footer: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  ghostBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17',
  },
  ghostBtnText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
});
