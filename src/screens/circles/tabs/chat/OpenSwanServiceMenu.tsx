/**
 * OpenSwanServiceMenu — a single dropdown/modal replacing two inline chip
 * rows (profile + delegation). OpenSwan is framed as a service: the user
 * picks what kind of work to ask for (Build/Review/Debug/Architect) and
 * how much crew to use (Auto/Parallel/Solo).
 *
 * Shown on every thread (private, shared, or circle) so the controls are
 * consistent across conversations.
 */

import React from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  SESSION_DELEGATION_MODE_OPTIONS,
  SESSION_PROFILE_OPTIONS,
  type SessionCodingProfile,
  type SessionDelegationMode,
} from '../../../../lib/chatSessionProfile';

interface Props {
  visible: boolean;
  sessionProfile: SessionCodingProfile;
  delegationMode: SessionDelegationMode;
  onSessionProfileChange: (profile: SessionCodingProfile) => void;
  onDelegationModeChange: (mode: SessionDelegationMode) => void;
  onOpenSkills?: () => void;
  onClose: () => void;
}

export default function OpenSwanServiceMenu({
  visible,
  sessionProfile,
  delegationMode,
  onSessionProfileChange,
  onDelegationModeChange,
  onOpenSkills,
  onClose,
}: Props) {
  const profileMeta = SESSION_PROFILE_OPTIONS.find(o => o.id === sessionProfile) || SESSION_PROFILE_OPTIONS[0];
  const delegationMeta = SESSION_DELEGATION_MODE_OPTIONS.find(o => o.id === delegationMode) || SESSION_DELEGATION_MODE_OPTIONS[0];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>OPENSWAN SERVICE</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>×</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Pick the kind of work you want OpenSwan to do. The service stays running; only its
            objective and crew size change between messages.
          </Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>MODE</Text>
            <View style={styles.pillRow}>
              {SESSION_PROFILE_OPTIONS.map(option => {
                const active = option.id === sessionProfile;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => onSessionProfileChange(option.id)}
                    style={({ hovered, pressed }: any) => [
                      styles.pill,
                      {
                        borderColor: active ? option.color : '#1f2937',
                        backgroundColor: active ? `${option.color}18` : '#0b1220',
                      },
                      Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                      hovered && !active && { borderColor: `${option.color}66`, backgroundColor: `${option.color}0a`, transform: [{ translateY: -1 }] },
                      pressed && { transform: [{ scale: 0.95 }] },
                    ]}
                  >
                    <Text style={[styles.pillShort, { color: active ? option.color : '#64748b' }]}>{option.shortLabel}</Text>
                    <Text style={[styles.pillLabel, { color: active ? option.color : '#94a3b8' }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.desc, { borderLeftColor: profileMeta.color }]}>{profileMeta.description}</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>DELEGATION</Text>
            <View style={styles.pillRow}>
              {SESSION_DELEGATION_MODE_OPTIONS.map(option => {
                const active = option.id === delegationMode;
                return (
                  <Pressable
                    key={option.id}
                    onPress={() => onDelegationModeChange(option.id)}
                    style={({ hovered, pressed }: any) => [
                      styles.pill,
                      {
                        borderColor: active ? option.color : '#1f2937',
                        backgroundColor: active ? `${option.color}18` : '#0b1220',
                      },
                      Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                      hovered && !active && { borderColor: `${option.color}66`, backgroundColor: `${option.color}0a`, transform: [{ translateY: -1 }] },
                      pressed && { transform: [{ scale: 0.95 }] },
                    ]}
                  >
                    <Text style={[styles.pillShort, { color: active ? option.color : '#64748b' }]}>{option.shortLabel}</Text>
                    <Text style={[styles.pillLabel, { color: active ? option.color : '#94a3b8' }]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.desc, { borderLeftColor: delegationMeta.color }]}>{delegationMeta.description}</Text>
          </View>

          <View style={styles.footerRow}>
            {onOpenSkills && (
              <Pressable
                onPress={() => { onClose(); onOpenSkills(); }}
                style={({ hovered, pressed }: any) => [
                  styles.skillsBtn,
                  Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                  hovered && { borderColor: '#f59e0b', backgroundColor: '#f59e0b28', transform: [{ translateY: -1 }] },
                  pressed && { transform: [{ scale: 0.95 }] },
                ]}
              >
                <Text style={styles.skillsBtnText}>SKILLS</Text>
              </Pressable>
            )}
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={onClose}
              style={({ hovered, pressed }: any) => [
                styles.doneBtn,
                Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                hovered && { borderColor: '#f59e0b', backgroundColor: '#f59e0b20', transform: [{ translateY: -1 }] },
                pressed && { transform: [{ scale: 0.95 }] },
              ]}
            >
              <Text style={styles.doneBtnText}>DONE</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: {
    width: '100%', maxWidth: 520, borderRadius: 14,
    backgroundColor: '#0a0f1c', borderWidth: 1, borderColor: '#f59e0b25',
    padding: 20, gap: 14,
    ...(Platform.OS === 'web' ? { boxShadow: '4px 4px 0px #f59e0b0c, 0 0 30px #f59e0b06' } as any : {}),
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#e2e8f0', fontSize: 13, fontWeight: '900', letterSpacing: 2, fontFamily: 'monospace' },
  closeBtn: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: '#1e293b',
  },
  closeBtnText: { color: '#64748b', fontSize: 10, fontWeight: '800', letterSpacing: 1, fontFamily: 'monospace' },
  hint: { color: '#64748b', fontSize: 11, lineHeight: 15, fontFamily: 'monospace' },
  section: { gap: 8 },
  sectionLabel: { color: '#475569', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: 'monospace' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 8, borderWidth: 1,
    minWidth: 70,
  },
  pillShort: { fontSize: 9, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
  pillLabel: { fontSize: 11, fontWeight: '700', marginTop: 2, fontFamily: 'monospace' },
  desc: {
    color: '#aaa', fontSize: 11, lineHeight: 15, fontFamily: 'monospace',
    borderLeftWidth: 2, paddingLeft: 8, paddingVertical: 2,
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  skillsBtn: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b40',
    backgroundColor: '#f59e0b0a',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #f59e0b10' } as any : {}),
  },
  skillsBtnText: { color: '#f59e0b', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
  doneBtn: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1, borderColor: '#f59e0b40',
    backgroundColor: '#f59e0b0a',
    ...(Platform.OS === 'web' ? { boxShadow: '2px 2px 0px #f59e0b10' } as any : {}),
  },
  doneBtnText: { color: '#f59e0b', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, fontFamily: 'monospace' },
});
