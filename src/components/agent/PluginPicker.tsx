/**
 * PluginPicker — Select and activate plugins for the chat agent.
 * Shows available plugins grouped by category with quick-start prompts.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, TextInput } from 'react-native';
import { PLUGINS, getAllCategories, type Plugin } from '../../lib/pluginRegistry';
import { getMissingConnectorRequirements } from '../../lib/circleIntegrations';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  circleId?: string;
  activePluginIds: string[];
  onTogglePlugin: (pluginId: string) => void;
  onQuickStart: (prompt: string) => void;
  onClose: () => void;
  accentColor?: string;
}

export default function PluginPicker({ circleId, activePluginIds, onTogglePlugin, onQuickStart, onClose, accentColor = '#6366f1' }: Props) {
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const [missingByPlugin, setMissingByPlugin] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  const categories = getAllCategories();
  const searchLower = search.trim().toLowerCase();
  const readyCount = PLUGINS.filter((plugin) => (missingByPlugin[plugin.id] || []).length === 0).length;

  useEffect(() => {
    let cancelled = false;
    if (!circleId) {
      setMissingByPlugin({});
      return;
    }
    (async () => {
      const entries = await Promise.all(
        PLUGINS.map(async (plugin) => [
          plugin.id,
          plugin.connectorRequirements?.length
            ? await getMissingConnectorRequirements(circleId, plugin.connectorRequirements)
            : [],
        ] as const),
      );
      if (!cancelled) setMissingByPlugin(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [circleId]);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Plugins</Text>
        <Text style={s.headerSub}>{activePluginIds.length} active · {readyCount} ready</Text>
        <Pressable onPress={onClose} style={[s.closeBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.closeBtnText}>X</Text>
        </Pressable>
      </View>

      <View style={s.searchRow}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search plugins or capabilities..."
          placeholderTextColor="#4b5563"
          style={s.searchInput}
        />
      </View>

      <ScrollView style={s.list} nestedScrollEnabled showsVerticalScrollIndicator>
        {categories.map(cat => {
          const plugins = PLUGINS.filter((plugin) => {
            if (plugin.category !== cat.key) return false;
            if (!searchLower) return true;
            const haystack = [
              plugin.name,
              plugin.description,
              ...(plugin.connectorRequirements || []),
              ...(plugin.quickStarts?.map(qs => qs.label) || []),
            ].join(' ').toLowerCase();
            return haystack.includes(searchLower);
          }).sort((a, b) => {
            const aActive = activePluginIds.includes(a.id) ? 1 : 0;
            const bActive = activePluginIds.includes(b.id) ? 1 : 0;
            return bActive - aActive;
          });
          if (plugins.length === 0) return null;

          return (
            <View key={cat.key} style={s.categorySection}>
              <Text style={[s.categoryLabel, { color: cat.color }]}>{cat.label.toUpperCase()}</Text>
              {plugins.map(plugin => {
                const isActive = activePluginIds.includes(plugin.id);
                const isExpanded = expandedPlugin === plugin.id;

                return (
                  <View key={plugin.id} style={[s.pluginCard, isActive && { borderColor: plugin.color + '50' }]}>
                    <Pressable
                      onPress={() => setExpandedPlugin(isExpanded ? null : plugin.id)}
                      style={[s.pluginHeader, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                    >
                      <View style={[s.pluginIcon, { backgroundColor: plugin.color + '20' }]}>
                        <Text style={[s.pluginIconText, { color: plugin.color }]}>{plugin.icon}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.pluginName}>{plugin.name}</Text>
                        <Text style={s.pluginDesc}>{plugin.description}</Text>
                      </View>
                      <Pressable
                        onPress={(e) => { e.stopPropagation?.(); onTogglePlugin(plugin.id); }}
                        style={[s.toggleBtn, isActive && { backgroundColor: plugin.color + '20', borderColor: plugin.color + '50' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                      >
                        <Text style={[s.toggleBtnText, isActive && { color: plugin.color }]}>
                          {isActive ? 'ON' : 'OFF'}
                        </Text>
                      </Pressable>
                    </Pressable>

                    {isExpanded && plugin.quickStarts && (
                      <View style={s.quickStarts}>
                        {missingByPlugin[plugin.id]?.length ? (
                          <View style={s.warningBox}>
                            <Text style={s.warningLabel}>MISSING MARKETPLACE APPS</Text>
                            <Text style={s.warningText}>{missingByPlugin[plugin.id].join(', ')}</Text>
                          </View>
                        ) : null}
                        {plugin.connectorRequirements && plugin.connectorRequirements.length > 0 ? (
                          <>
                            <Text style={s.quickStartsLabel}>REQUIRES</Text>
                            <View style={s.requirementsRow}>
                              {plugin.connectorRequirements.map(req => (
                                <View key={req} style={s.requirementChip}>
                                  <Text style={s.requirementChipText}>{req}</Text>
                                </View>
                              ))}
                            </View>
                          </>
                        ) : null}
                        <Text style={s.quickStartsLabel}>QUICK STARTS</Text>
                        {plugin.quickStarts.map((qs, i) => (
                          <Pressable
                            key={i}
                            onPress={() => { onTogglePlugin(plugin.id); onQuickStart(qs.prompt); onClose(); }}
                            style={[s.quickStartBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
                          >
                            <Text style={[s.quickStartText, { color: plugin.color }]}>{qs.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, maxHeight: 500, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a28' },
  headerTitle: { color: '#f0f0f5', fontSize: 12, fontWeight: '700', fontFamily: MONO },
  headerSub: { color: '#3a3a4e', fontSize: 10, fontFamily: MONO },
  searchRow: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a28' },
  searchInput: { color: '#f0f0f5', fontSize: 11, fontFamily: MONO, paddingVertical: 4, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any,
  closeBtn: { marginLeft: 'auto', width: 22, height: 22, borderRadius: 2, backgroundColor: '#1a1a28', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a3e' },
  closeBtnText: { color: '#606075', fontSize: 10, fontWeight: '700' },
  list: { maxHeight: 420, padding: 8 },
  categorySection: { marginBottom: 12 },
  categoryLabel: { fontSize: 8, fontWeight: '800', letterSpacing: 1.5, fontFamily: MONO, marginBottom: 6 },
  pluginCard: { backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, marginBottom: 4, overflow: 'hidden' },
  pluginHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  pluginIcon: { width: 28, height: 28, borderRadius: 2, justifyContent: 'center', alignItems: 'center' },
  pluginIconText: { fontSize: 12, fontWeight: '800', fontFamily: MONO },
  pluginName: { color: '#f0f0f5', fontSize: 11, fontWeight: '700', fontFamily: MONO },
  pluginDesc: { color: '#606075', fontSize: 9, marginTop: 1 },
  toggleBtn: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e', backgroundColor: '#1a1a28' },
  toggleBtnText: { color: '#606075', fontSize: 8, fontWeight: '800', fontFamily: MONO },
  quickStarts: { paddingHorizontal: 8, paddingBottom: 8, borderTopWidth: 1, borderTopColor: '#1a1a28', paddingTop: 6 },
  warningBox: { marginBottom: 6, padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#5b2a2a', backgroundColor: '#231111' },
  warningLabel: { color: '#fca5a5', fontSize: 7, fontWeight: '800', letterSpacing: 1, fontFamily: MONO, marginBottom: 4 },
  warningText: { color: '#fecaca', fontSize: 9, fontFamily: MONO, lineHeight: 14 },
  quickStartsLabel: { color: '#3a3a4e', fontSize: 7, fontWeight: '700', letterSpacing: 1, fontFamily: MONO, marginBottom: 4 },
  requirementsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 6 },
  requirementChip: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 999, backgroundColor: '#131926', borderWidth: 1, borderColor: '#263248' },
  requirementChipText: { color: '#93c5fd', fontSize: 8, fontFamily: MONO, fontWeight: '700' },
  quickStartBtn: { paddingVertical: 4, paddingHorizontal: 6, backgroundColor: '#1a1a28', borderRadius: 2, marginBottom: 3, borderWidth: 1, borderColor: '#2a2a3e' },
  quickStartText: { fontSize: 9, fontFamily: MONO },
});
