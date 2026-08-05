/**
 * PreflightBlockersCard — when a computer/app task is blocked because a required
 * capability isn't connected, the preflight already computes exactly what's
 * missing and how to fix it ("Connect Browserbase", "Start the desktop bridge").
 * This renders that as a user-facing card with tappable chips so the user can
 * enable the capability and retry, instead of only seeing it buried in prose.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export interface PreflightBlockerItem {
  id: string;        // e.g. "missing:browser_automation", "partial:app_tools"
  label: string;     // e.g. "Browser automation missing"
  fix: string;       // e.g. "Connect Browserbase or start the local browser bridge…"
  severity?: string;
}

// Capabilities served by the local desktop/app/file bridge vs the browser/
// computer-use runtime — drives which fix chip we surface.
const BRIDGE_CAPS = new Set(['desktop_control', 'app_tools', 'file_search', 'file_read', 'file_write', 'agent_bridges']);
const BROWSER_CAPS = new Set(['browser_automation', 'browser_sessions']);

function capabilityOf(id: string): string {
  return String(id || '').split(':').pop() || '';
}

interface Props {
  items: PreflightBlockerItem[];
  onConnectBridge?: () => void;
  onOpenComputerUse?: () => void;
  onRetry?: () => void;
  /** Keep the capability evidence visible without reviving actions from an
   *  older/superseded run. */
  readOnly?: boolean;
  accentColor?: string;
}

export default function PreflightBlockersCard({
  items,
  onConnectBridge,
  onOpenComputerUse,
  onRetry,
  readOnly = false,
  accentColor = '#f59e0b',
}: Props) {
  const caps = items.map((item) => capabilityOf(item.id));
  const needsBridge = caps.some((cap) => BRIDGE_CAPS.has(cap));
  const needsBrowser = caps.some((cap) => BROWSER_CAPS.has(cap));

  // De-duplicated action chips: at most one per fix surface, plus retry.
  const chips: Array<{ key: string; label: string; onPress: () => void }> = [];
  if (!readOnly) {
    if (needsBridge && onConnectBridge) chips.push({ key: 'bridge', label: 'Connect the bridge', onPress: onConnectBridge });
    if (needsBrowser && onOpenComputerUse) chips.push({ key: 'browser', label: 'Open Computer Use', onPress: onOpenComputerUse });
    if (onRetry) chips.push({ key: 'retry', label: 'Try again', onPress: onRetry });
  }

  return (
    <View style={[s.card, { borderColor: accentColor + '40' }]} nativeID="section-chat-preflight-blockers">
      <View style={s.header}>
        <Text style={[s.kicker, { color: accentColor }]}>CAPABILITY NEEDED</Text>
        <Text style={s.count}>{items.length} to enable</Text>
      </View>
      <Text style={s.hint}>
        {readOnly
          ? 'Historical capability snapshot from this earlier run. Its actions are no longer active.'
          : "This task needs a capability that isn't connected yet. Enable it, then retry:"}
      </Text>
      <View style={{ gap: 6 }}>
        {items.slice(0, 6).map((item, index) => (
          <View key={item.id || String(index)} style={[s.row, { borderColor: accentColor + '24' }]}>
            <Text style={[s.glyph, { color: accentColor }]}>!</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{item.label}</Text>
              <Text style={s.meta} numberOfLines={3}>{item.fix}</Text>
            </View>
          </View>
        ))}
      </View>
      {chips.length > 0 ? (
        <View style={s.chipRow}>
          {chips.map((chip) => (
            <Pressable
              key={chip.key}
              onPress={chip.onPress}
              style={({ pressed }) => [
                s.chip,
                { borderColor: accentColor + '50' },
                pressed && { backgroundColor: accentColor + '1e' },
              ]}
              accessibilityLabel={chip.label}
            >
              <Text style={[s.chipText, { color: accentColor }]}>{chip.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  count: { fontSize: 9, color: '#64748b', fontFamily: MONO },
  hint: { color: '#94a3b8', fontSize: 11, lineHeight: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 10,
  },
  glyph: { fontSize: 14, fontWeight: '900', fontFamily: MONO, width: 14, textAlign: 'center' },
  name: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' },
  meta: { color: '#94a3b8', fontSize: 10, lineHeight: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 11, fontWeight: '800', fontFamily: MONO },
});
