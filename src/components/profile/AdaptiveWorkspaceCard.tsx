import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  AdaptiveWorkspaceSettings,
  buildAdaptiveWorkspaceSummary,
  loadAdaptiveWorkspaceSettings,
  loadCircleWorkspaceProfile,
  saveAdaptiveWorkspaceSettings,
  type WorkspaceTabKey,
  type FeedMobileMode,
  type FeedLowerMode,
} from '../../lib/workspaceAdaptation';

const LANDING_TABS: WorkspaceTabKey[] = ['OFFICE', 'CHAT', 'FEED', 'ROOMS', 'INTEGRATIONS'];
const FEED_MOBILE: FeedMobileMode[] = ['missions', 'activity', 'agents', 'ai-tools', 'plan'];
const FEED_LOWER: FeedLowerMode[] = ['activity', 'agents', 'ai-tools'];

export default function AdaptiveWorkspaceCard({ circleId }: { circleId: string }) {
  const [settings, setSettings] = useState<AdaptiveWorkspaceSettings>({ enabled: true });
  const [summary, setSummary] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadAdaptiveWorkspaceSettings(circleId),
      loadCircleWorkspaceProfile(circleId),
    ]).then(([loadedSettings, profile]) => {
      if (cancelled) return;
      setSettings(loadedSettings);
      setSummary(buildAdaptiveWorkspaceSummary(profile));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [circleId]);

  const persist = async (next: AdaptiveWorkspaceSettings) => {
    setSettings(next);
    setSaving(true);
    await saveAdaptiveWorkspaceSettings(circleId, next);
    setSaving(false);
  };

  const toggleEnabled = () => persist({ ...settings, enabled: settings.enabled === false ? true : false });

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Adaptive Workspace</Text>
          <Text style={styles.subtitle}>The app can learn how you use Chat, Feed, and Office, then choose better defaults. You can pin anything important.</Text>
        </View>
        <Pressable onPress={toggleEnabled} style={[styles.toggle, settings.enabled === false ? styles.toggleOff : styles.toggleOn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={styles.toggleText}>{settings.enabled === false ? 'OFF' : 'ON'}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Learned Usage</Text>
        {summary.map(item => (
          <Text key={item} style={styles.summaryItem}>- {item}</Text>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pinned Defaults</Text>
        <OptionRow
          label="Landing Tab"
          value={settings.pinLandingTab || 'Auto'}
          options={['Auto', ...LANDING_TABS]}
          onSelect={(value) => persist({ ...settings, pinLandingTab: value === 'Auto' ? null : value as WorkspaceTabKey })}
        />
        <OptionRow
          label="Feed Mobile"
          value={settings.pinFeedMobileTab || 'Auto'}
          options={['Auto', ...FEED_MOBILE]}
          onSelect={(value) => persist({ ...settings, pinFeedMobileTab: value === 'Auto' ? null : value as FeedMobileMode })}
        />
        <OptionRow
          label="Feed Lower"
          value={settings.pinFeedLowerTab || 'Auto'}
          options={['Auto', ...FEED_LOWER]}
          onSelect={(value) => persist({ ...settings, pinFeedLowerTab: value === 'Auto' ? null : value as FeedLowerMode })}
        />
        <OptionRow
          label="Chat Density"
          value={settings.pinChatDensity || 'Auto'}
          options={['Auto', 'compact', 'cozy']}
          onSelect={(value) => persist({ ...settings, pinChatDensity: value === 'Auto' ? null : value as 'compact' | 'cozy' })}
        />
        <OptionRow
          label="Office Runtime"
          value={settings.pinOfficeTerminalTab || 'Auto'}
          options={['Auto', 'commands', 'automations']}
          onSelect={(value) => persist({ ...settings, pinOfficeTerminalTab: value === 'Auto' ? null : value as 'commands' | 'automations' })}
        />
      </View>

      {saving ? <Text style={styles.saving}>Saving adaptive workspace settings…</Text> : null}
    </View>
  );
}

function OptionRow({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: string;
  options: string[];
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.optionRow}>
      <Text style={styles.optionLabel}>{label}</Text>
      <View style={styles.optionValues}>
        {options.map(option => {
          const active = value === option;
          return (
            <Pressable
              key={option}
              onPress={() => onSelect(option)}
              style={[styles.optionChip, active ? styles.optionChipActive : null, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={[styles.optionChipText, active ? styles.optionChipTextActive : null]}>{option}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 18,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1f2937',
    backgroundColor: '#0b1020',
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  title: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 4,
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
  toggle: {
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  toggleOn: {
    backgroundColor: '#1d4ed8',
  },
  toggleOff: {
    backgroundColor: '#334155',
  },
  toggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  summaryItem: {
    color: '#e2e8f0',
    fontSize: 13,
    lineHeight: 18,
  },
  optionRow: {
    gap: 8,
  },
  optionLabel: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  optionValues: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#111827',
  },
  optionChipActive: {
    borderColor: '#60a5fa',
    backgroundColor: '#172554',
  },
  optionChipText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
  },
  optionChipTextActive: {
    color: '#dbeafe',
  },
  saving: {
    color: '#60a5fa',
    fontSize: 12,
    fontWeight: '700',
  },
});
