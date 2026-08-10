/**
 * SkillAdminPanel — Phase C5 UI. Modal for enabling/disabling skills
 * per (circle, SOUL). Shown from the OpenSwan service menu or a
 * dedicated admin surface.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  type Skill,
  disableSkillForSoul,
  enableSkillForSoul,
  getRecommendedSkillNamesForSoul,
  loadAllSkills,
  loadEnabledSkillsForSoul,
} from '../../../../lib/skillRegistry';

interface Props {
  visible: boolean;
  circleId: string;
  soulKey: string;
  userId: string;
  onClose: () => void;
}

const COST_COLORS: Record<string, string> = {
  free: '#22c55e', low: '#94a3b8', medium: '#f59e0b', high: '#ef4444',
};

export default function SkillAdminPanel({ visible, circleId, soulKey, userId, onClose }: Props) {
  const [allSkills, setAllSkills] = useState<Skill[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([loadAllSkills(), loadEnabledSkillsForSoul(circleId, soulKey)])
      .then(([all, enabled]) => {
        if (cancelled) return;
        setAllSkills(all);
        setEnabledIds(new Set(enabled.map(s => s.id)));
      })
      .catch(err => console.warn('[SkillAdminPanel] load failed:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, circleId, soulKey]);

  const handleToggle = async (skill: Skill) => {
    const isEnabled = enabledIds.has(skill.id);
    setToggling(skill.id);
    try {
      if (isEnabled) {
        await disableSkillForSoul(circleId, soulKey, skill.id);
        setEnabledIds(prev => { const n = new Set(prev); n.delete(skill.id); return n; });
      } else {
        await enableSkillForSoul(circleId, soulKey, skill.id, userId);
        setEnabledIds(prev => new Set(prev).add(skill.id));
      }
    } catch (err) {
      console.warn('[SkillAdminPanel] toggle failed:', err);
    } finally {
      setToggling(null);
    }
  };

  const soulName = soulKey.replace(/^soul:/, '').replace(/-/g, ' ');
  const recommendedSkillNames = new Set(getRecommendedSkillNamesForSoul(soulKey));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <Pressable style={styles.card} onPress={e => e.stopPropagation()}>
          <View style={styles.header}>
            <Text style={styles.title}>SKILLS FOR {soulName.toUpperCase()}</Text>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>x</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Toggle skills to give this SOUL new capabilities. Enabled skills inject tool-use prompts + register tools the model can call mid-turn.
          </Text>

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color="#94a3b8" />
              <Text style={styles.loadingText}>Loading skills...</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 400 }} contentContainerStyle={styles.list}>
              {allSkills.length === 0 ? (
                <Text style={styles.empty}>No skills available yet.</Text>
              ) : (
                allSkills.map(skill => {
                  const enabled = enabledIds.has(skill.id);
                  const busy = toggling === skill.id;
                  const recommended = recommendedSkillNames.has(skill.name);
                  return (
                    <Pressable
                      key={skill.id}
                      onPress={() => handleToggle(skill)}
                      disabled={busy}
                      style={({ hovered, pressed }: any) => [
                        styles.skillRow,
                        enabled && styles.skillRowEnabled,
                        Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                        hovered && !enabled && { borderColor: '#334155', backgroundColor: '#0f1520', transform: [{ translateY: -1 }] },
                        hovered && enabled && { borderColor: '#6366f166', backgroundColor: '#22d3ee14', transform: [{ translateY: -1 }] },
                        pressed && { transform: [{ scale: 0.98 }] },
                      ]}
                    >
                      <View style={styles.skillHeader}>
                        <Text style={[styles.skillName, enabled && { color: '#22d3ee' }]}>{skill.displayName}</Text>
                        <View style={styles.skillBadges}>
                          {recommended && (
                            <Text style={styles.recommendedBadge}>REC</Text>
                          )}
                          <Text style={[styles.costBadge, { color: COST_COLORS[skill.costTier] || '#94a3b8' }]}>{skill.costTier.toUpperCase()}</Text>
                          <Text style={[styles.toggleBadge, enabled ? styles.toggleOn : styles.toggleOff]}>
                            {busy ? '...' : enabled ? 'ON' : 'OFF'}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.skillDesc}>{skill.description}</Text>
                      {skill.requiredTools.length > 0 && (
                        <Text style={styles.toolsList}>tools: {skill.requiredTools.join(', ')}</Text>
                      )}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <Text style={styles.footerCount}>{enabledIds.size} skill{enabledIds.size !== 1 ? 's' : ''} enabled</Text>
            <Pressable
              onPress={onClose}
              style={({ hovered, pressed }: any) => [
                styles.doneBtn,
                Platform.OS === 'web' && { transition: 'all 0.15s ease' },
                hovered && { borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#22d3ee28', transform: [{ translateY: -1 }] },
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
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: {
    width: '100%', maxWidth: 520, borderRadius: 14,
    backgroundColor: '#0a0f1c', borderWidth: 1, borderColor: '#1e293b',
    padding: 16, gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#f8fafc', fontSize: 12, fontWeight: '900', letterSpacing: 1.4, fontFamily: 'monospace' },
  closeBtn: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#111827',
  },
  closeBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '900' },
  hint: { color: '#7f8ea3', fontSize: 11, lineHeight: 15 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  loadingText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },
  list: { gap: 6 },
  empty: { color: '#475569', fontSize: 11, fontFamily: 'monospace', textAlign: 'center', paddingVertical: 24 },
  skillRow: {
    padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#1e293b',
    backgroundColor: '#0b1220', gap: 4,
  },
  skillRowEnabled: { borderColor: '#6366f144', backgroundColor: '#22d3ee08' },
  skillHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  skillName: { fontSize: 12, fontWeight: '800', color: '#d8e1ef', fontFamily: 'monospace' },
  skillBadges: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  costBadge: { fontSize: 8, fontWeight: '900', letterSpacing: 0.5, fontFamily: 'monospace' },
  recommendedBadge: {
    fontSize: 8, fontWeight: '900', letterSpacing: 0.5, fontFamily: 'monospace',
    color: '#22c55e', borderColor: '#22c55e55', borderWidth: 1, backgroundColor: '#22c55e12',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  },
  toggleBadge: {
    fontSize: 9, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace',
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1,
  },
  toggleOn: { color: '#22d3ee', borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#22d3ee18' },
  toggleOff: { color: '#64748b', borderColor: '#334155', backgroundColor: '#0f172a' },
  skillDesc: { fontSize: 10, color: '#94a3b8', lineHeight: 14 },
  toolsList: { fontSize: 9, color: '#475569', fontFamily: 'monospace' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  footerCount: { fontSize: 10, color: '#64748b', fontFamily: 'monospace' },
  doneBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
    borderWidth: 1, borderColor: 'rgba(99, 102, 241, 0.67)', backgroundColor: '#22d3ee18',
  },
  doneBtnText: { color: '#22d3ee', fontSize: 10, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace' },
});
