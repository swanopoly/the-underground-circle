/**
 * PluginPicker — Select and activate plugins for the chat agent.
 * Shows available plugins grouped by category with quick-start prompts.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import { PLUGINS, getAllCategories, type Plugin } from '../../lib/pluginRegistry';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  activePluginIds: string[];
  onTogglePlugin: (pluginId: string) => void;
  onQuickStart: (prompt: string) => void;
  onClose: () => void;
  accentColor?: string;
}

export default function PluginPicker({ activePluginIds, onTogglePlugin, onQuickStart, onClose, accentColor = '#6366f1' }: Props) {
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null);
  const categories = getAllCategories();

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Plugins</Text>
        <Text style={s.headerSub}>{activePluginIds.length} active</Text>
        <Pressable onPress={onClose} style={[s.closeBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.closeBtnText}>X</Text>
        </Pressable>
      </View>

      <ScrollView style={s.list} nestedScrollEnabled showsVerticalScrollIndicator>
        {categories.map(cat => {
          const plugins = PLUGINS.filter(p => p.category === cat.key);
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
  quickStartsLabel: { color: '#3a3a4e', fontSize: 7, fontWeight: '700', letterSpacing: 1, fontFamily: MONO, marginBottom: 4 },
  quickStartBtn: { paddingVertical: 4, paddingHorizontal: 6, backgroundColor: '#1a1a28', borderRadius: 2, marginBottom: 3, borderWidth: 1, borderColor: '#2a2a3e' },
  quickStartText: { fontSize: 9, fontFamily: MONO },
});
