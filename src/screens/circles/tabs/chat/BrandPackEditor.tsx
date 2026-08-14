/**
 * BrandPackEditor — modal drawer for editing a per-circle brand pack.
 * Opens from the Builder toolbar's BRAND button. Saves to localStorage via
 * `saveBrandPack`. Every field is optional; blank fields omit that line
 * from the generated system_extra.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  type BrandPack,
  type BrandVoice,
  DEFAULT_BRAND_VOICE_LABEL,
  clearBrandPack,
  loadBrandPack,
  saveBrandPack,
} from '../../../../lib/brandPack';

interface Props {
  circleId: string | null | undefined;
  visible: boolean;
  onClose: () => void;
  onSaved?: (pack: BrandPack) => void;
}

const VOICE_OPTIONS: BrandVoice[] = ['professional', 'playful', 'minimal', 'bold', 'warm', 'technical'];

export default function BrandPackEditor({ circleId, visible, onClose, onSaved }: Props) {
  const [pack, setPack] = useState<BrandPack>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !circleId) return;
    let cancelled = false;
    loadBrandPack(circleId)
      .then((p) => { if (!cancelled && p) setPack(p); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible, circleId]);

  if (!circleId) return null;

  const patch = (partial: Partial<BrandPack>) => setPack(prev => ({ ...prev, ...partial }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBrandPack(circleId, pack);
      onSaved?.(pack);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    await clearBrandPack(circleId);
    setPack({});
    onSaved?.({});
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>BRAND PACK</Text>
            <Text style={styles.subtitle}>
              Auto-prepended to every /build-page in this circle so pages match your brand.
            </Text>
          </View>

          <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={styles.body}>
            <Row label="Primary color">
              <TextInput style={styles.input} value={pack.primaryColor || ''} onChangeText={t => patch({ primaryColor: t.trim() || undefined })} placeholder="#6366f1" placeholderTextColor="#475569" />
            </Row>
            <Row label="Secondary color">
              <TextInput style={styles.input} value={pack.secondaryColor || ''} onChangeText={t => patch({ secondaryColor: t.trim() || undefined })} placeholder="#06b6d4" placeholderTextColor="#475569" />
            </Row>
            <Row label="Background">
              <TextInput style={styles.input} value={pack.bgColor || ''} onChangeText={t => patch({ bgColor: t.trim() || undefined })} placeholder="#0a0a10" placeholderTextColor="#475569" />
            </Row>
            <Row label="Text color">
              <TextInput style={styles.input} value={pack.textColor || ''} onChangeText={t => patch({ textColor: t.trim() || undefined })} placeholder="#e2e8f0" placeholderTextColor="#475569" />
            </Row>
            <Row label="Heading font">
              <TextInput style={styles.input} value={pack.fontHeading || ''} onChangeText={t => patch({ fontHeading: t.trim() || undefined })} placeholder='"Inter", sans-serif' placeholderTextColor="#475569" />
            </Row>
            <Row label="Body font">
              <TextInput style={styles.input} value={pack.fontBody || ''} onChangeText={t => patch({ fontBody: t.trim() || undefined })} placeholder='system-ui, sans-serif' placeholderTextColor="#475569" />
            </Row>

            <Text style={styles.sectionLabel}>VOICE</Text>
            <View style={styles.voiceGrid}>
              {VOICE_OPTIONS.map(v => {
                const active = pack.voice === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => patch({ voice: active ? undefined : v })}
                    style={[styles.voiceChip, active && styles.voiceChipActive]}
                  >
                    <Text style={[styles.voiceChipText, active && styles.voiceChipTextActive]}>{v}</Text>
                    {active && (
                      <Text style={styles.voiceChipSub} numberOfLines={1}>
                        {DEFAULT_BRAND_VOICE_LABEL[v].split('—')[1]?.trim() || ''}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>

            <Row label="Tagline">
              <TextInput style={styles.input} value={pack.tagline || ''} onChangeText={t => patch({ tagline: t || undefined })} placeholder="Ship in public." placeholderTextColor="#475569" />
            </Row>
            <Row label="Logo URL">
              <TextInput style={styles.input} value={pack.logoUrl || ''} onChangeText={t => patch({ logoUrl: t.trim() || undefined })} placeholder="https://…" placeholderTextColor="#475569" autoCapitalize="none" />
            </Row>

            <Text style={styles.sectionLabel}>NOTES (free-form)</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              value={pack.customNotes || ''}
              onChangeText={t => patch({ customNotes: t || undefined })}
              placeholder="Anything else the builder should know — mood, references, constraints…"
              placeholderTextColor="#475569"
              multiline
            />
          </ScrollView>

          <View style={styles.footer}>
            <Pressable onPress={handleReset} style={styles.footerBtnGhost}>
              <Text style={styles.footerBtnGhostText}>RESET</Text>
            </Pressable>
            <View style={{ flex: 1 }} />
            <Pressable onPress={onClose} style={styles.footerBtnGhost}>
              <Text style={styles.footerBtnGhostText}>CANCEL</Text>
            </Pressable>
            <Pressable onPress={handleSave} disabled={saving} style={[styles.footerBtnPrimary, saving && { opacity: 0.5 }]}>
              <Text style={styles.footerBtnPrimaryText}>{saving ? 'SAVING…' : 'SAVE'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center', justifyContent: 'center', padding: 16,
  },
  card: {
    width: '100%', maxWidth: 540, borderRadius: 12,
    backgroundColor: '#05070b', borderWidth: 1, borderColor: '#152032',
    padding: 16, gap: 12,
  },
  header: { gap: 4 },
  title: {
    color: '#d8e1ef', fontSize: 12, fontWeight: '900',
    letterSpacing: 1.5, fontFamily: 'monospace',
  },
  subtitle: { color: '#7f8ea3', fontSize: 11, lineHeight: 15 },
  body: { gap: 12 },
  row: { gap: 4 },
  rowLabel: { color: '#425066', fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: 'monospace' },
  input: {
    color: '#e2e8f0', fontSize: 13, fontFamily: 'monospace',
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17',
  },
  inputMultiline: { minHeight: 72, textAlignVertical: 'top' as any },
  sectionLabel: {
    color: '#425066', fontSize: 9, fontWeight: '900',
    letterSpacing: 1.1, fontFamily: 'monospace', marginTop: 4,
  },
  voiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  voiceChip: {
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17',
    borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6,
    minWidth: 96,
  },
  voiceChipActive: { borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#6366f11a' },
  voiceChipText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  voiceChipTextActive: { color: '#6366f1' },
  voiceChipSub: { color: '#7f8ea3', fontSize: 9, marginTop: 2, fontFamily: 'monospace' },
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4,
    borderTopWidth: 1, borderTopColor: '#152032', paddingTop: 12,
  },
  footerBtnGhost: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: '#243246', backgroundColor: '#0a0f17',
  },
  footerBtnGhostText: { color: '#94a3b8', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  footerBtnPrimary: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#6366f118',
  },
  footerBtnPrimaryText: { color: '#6366f1', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
});
