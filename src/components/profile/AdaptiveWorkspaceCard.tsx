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
import { PROFILE_DASHBOARD_TOKENS as PD } from './profileDashboardTheme';

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
        <Pressable
          onPress={toggleEnabled}
          disabled={saving}
          accessibilityRole="switch"
          accessibilityLabel="Adaptive workspace"
          accessibilityState={{ checked: settings.enabled !== false, disabled: saving }}
          style={[styles.toggle, settings.enabled === false ? styles.toggleOff : styles.toggleOn, saving && styles.disabled, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={styles.toggleText}>{settings.enabled === false ? 'OFF' : 'ON'}</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Learned Usage</Text>
        {summary.length > 0
          ? summary.map(item => <Text key={item} style={styles.summaryItem}>- {item}</Text>)
          : <Text style={styles.summaryMuted}>No learned patterns yet.</Text>}
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

      {saving ? <Text accessibilityLiveRegion="polite" style={styles.saving}>Saving adaptive workspace settings…</Text> : null}
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
              accessibilityRole="button"
              accessibilityLabel={`Set ${label} to ${option}`}
              accessibilityState={{ selected: active }}
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
    padding: 16,
    borderRadius: PD.panelRadius,
    borderWidth: 1,
    borderColor: PD.border,
    backgroundColor: PD.panel,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  title: {
    color: PD.text,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: 'monospace',
  },
  subtitle: {
    marginTop: 4,
    color: PD.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  toggle: {
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: 'center',
  },
  toggleOn: {
    backgroundColor: `${PD.accent}30`,
    borderWidth: 1,
    borderColor: `${PD.accent}70`,
  },
  toggleOff: {
    backgroundColor: PD.inset,
    borderWidth: 1,
    borderColor: PD.borderStrong,
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
    color: PD.textSecondary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  summaryItem: {
    color: PD.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  summaryMuted: {
    color: PD.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  optionRow: {
    gap: 8,
  },
  optionLabel: {
    color: PD.text,
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
    borderColor: PD.borderStrong,
    backgroundColor: PD.inset,
  },
  optionChipActive: {
    borderColor: PD.accent,
    backgroundColor: `${PD.accent}20`,
  },
  optionChipText: {
    color: PD.textSecondary,
    fontSize: 12,
    fontWeight: '700',
  },
  optionChipTextActive: {
    color: PD.text,
  },
  saving: {
    color: PD.accent,
    fontSize: 12,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.55,
  },
});
