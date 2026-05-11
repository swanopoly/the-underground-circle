/**
 * AddModelPanel — Browse, search, and select Hugging Face models.
 * Full model marketplace with categories, trending, and search.
 */
import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import {
  searchHuggingFaceModels, fetchTrendingModels, addCustomModel,
  HF_CATEGORIES, type CustomModel, type HFModelResult, type HFCategory,
} from '../../lib/customModels';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  onModelAdded: (model: CustomModel) => void;
  onClose: () => void;
  accentColor?: string;
  marketplaceConnected?: boolean;
  marketplaceHint?: string;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default function AddModelPanel({
  onModelAdded,
  onClose,
  accentColor = '#6366f1',
  marketplaceConnected,
  marketplaceHint,
}: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<HFCategory>('text-generation');
  const [results, setResults] = useState<HFModelResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Load trending on mount and when category changes
  useEffect(() => {
    setLoading(true);
    fetchTrendingModels(category).then(r => {
      setResults(r);
      setLoading(false);
    });
  }, [category]);

  // Search when query changes
  useEffect(() => {
    if (!query || query.length < 2) return;
    const timer = setTimeout(() => {
      setLoading(true);
      searchHuggingFaceModels(query, category).then(r => {
        setResults(r);
        setLoading(false);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [query, category]);

  const handleSelect = useCallback(async (hfModel: HFModelResult) => {
    setAdding(hfModel.id);
    try {
      const parts = hfModel.id.split('/');
      const shortName = parts[parts.length - 1]
        .replace(/-/g, ' ')
        .replace(/instruct|chat|hf|gguf|fp16|bf16|awq|gptq/gi, '')
        .trim()
        .split(' ')
        .slice(0, 3)
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      const model = await addCustomModel({
        id: hfModel.id,
        label: shortName || parts[parts.length - 1],
        desc: `${hfModel.author} · ${formatNum(hfModel.downloads)} downloads`,
        color: '',
        icon: shortName ? shortName.charAt(0) : 'H',
        provider: 'huggingface',
      });
      onModelAdded(model);
    } catch {}
    setAdding(null);
  }, [onModelAdded]);

  return (
    <View style={s.container} nativeID="section-hf-model-browser">
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Hugging Face Models</Text>
          <Text style={s.subtitle}>
            {marketplaceConnected
              ? 'Browse and add models that can use your connected Hugging Face key'
              : marketplaceHint || 'Browse and add AI models to your workspace'}
          </Text>
        </View>
        <Pressable onPress={onClose} accessibilityRole="button" style={s.closeBtn}>
          <Text style={s.closeBtnText}>X</Text>
        </Pressable>
      </View>

      {/* Category pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.categoryBar} contentContainerStyle={{ paddingHorizontal: 12, gap: 4 }}>
        {HF_CATEGORIES.map(cat => (
          <Pressable
            key={cat.key}
            onPress={() => { setCategory(cat.key); setQuery(''); }}
            accessibilityRole="button"
            style={[
              s.categoryPill,
              category === cat.key && { backgroundColor: cat.color + '20', borderColor: cat.color + '50' },
              ...(Platform.OS === 'web' ? [{ cursor: 'pointer', transition: 'all 0.15s ease' } as any] : []),
            ]}
          >
            <View style={[s.catIconBox, { backgroundColor: cat.color + '25' }]}>
              <Text style={[s.catIconText, { color: cat.color }]}>{cat.icon}</Text>
            </View>
            <Text style={[s.categoryLabel, category === cat.key && { color: cat.color }]}>{cat.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Search */}
      <View style={s.searchRow}>
        <Text style={s.searchIcon}>{'>'}</Text>
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={`Search ${HF_CATEGORIES.find(c => c.key === category)?.label || 'models'}...`}
          placeholderTextColor="#3a3a4e"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {loading && <ActivityIndicator size="small" color={accentColor} />}
      </View>

      {/* Results grid */}
      <ScrollView style={s.results} nestedScrollEnabled showsVerticalScrollIndicator>
        {!loading && results.length === 0 && (
          <Text style={s.emptyText}>No models found{query ? ` for "${query}"` : ''}. Try a different search.</Text>
        )}
        {results.map(r => {
          const isHovered = hoveredId === r.id;
          return (
            <Pressable
              key={r.id}
              onPress={() => handleSelect(r)}
              onHoverIn={() => setHoveredId(r.id)}
              onHoverOut={() => setHoveredId(null)}
              disabled={adding === r.id}
              accessibilityRole="button"
              accessibilityLabel={`Add ${r.id}`}
              style={[
                s.modelCard,
                isHovered && { borderColor: accentColor + '50', backgroundColor: '#0f0f18' },
                ...(Platform.OS === 'web' ? [{ cursor: 'pointer', transition: 'all 0.15s ease' } as any] : []),
              ]}
            >
              <View style={s.modelCardHeader}>
                <View style={[s.modelAvatar, { backgroundColor: accentColor + '15' }]}>
                  <Text style={[s.modelAvatarText, { color: accentColor }]}>{r.author?.charAt(0)?.toUpperCase() || 'H'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.modelName} numberOfLines={1}>{r.id.split('/').pop()}</Text>
                  <Text style={s.modelAuthor}>{r.author}</Text>
                </View>
                <View style={[s.selectBtn, adding === r.id && { opacity: 0.4 }]}>
                  <Text style={[s.selectBtnText, { color: accentColor }]}>{adding === r.id ? '...' : 'Select'}</Text>
                </View>
              </View>
              <View style={s.modelStats}>
                <View style={s.statPill}>
                  <Text style={s.statText}>{formatNum(r.downloads)} DL</Text>
                </View>
                <View style={s.statPill}>
                  <Text style={s.statText}>{r.likes} likes</Text>
                </View>
                {r.pipeline_tag && (
                  <View style={[s.statPill, { backgroundColor: '#6366f120', borderColor: '#6366f140' }]}>
                    <Text style={[s.statText, { color: '#6366f1' }]}>{r.pipeline_tag}</Text>
                  </View>
                )}
              </View>
              <Text style={s.modelId} numberOfLines={1}>{r.id}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { backgroundColor: '#0a0a10', borderRadius: 2, overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a28' },
  title: { color: '#f0f0f5', fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  subtitle: { color: '#606075', fontSize: 10, marginTop: 2 },
  closeBtn: { width: 26, height: 26, borderRadius: 6, backgroundColor: '#1a1a28', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a3e' },
  closeBtnText: { color: '#606075', fontSize: 11, fontWeight: '700' },
  categoryBar: { maxHeight: 40, borderBottomWidth: 1, borderBottomColor: '#1a1a28' },
  categoryPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8,
    borderWidth: 1, borderColor: 'transparent',
  },
  catIconBox: { width: 18, height: 18, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  catIconText: { fontSize: 8, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  categoryLabel: { color: '#606075', fontSize: 10, fontWeight: '600' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#1a1a28' },
  searchIcon: { color: '#606075', fontSize: 12, fontWeight: '700', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  searchInput: { flex: 1, color: '#f0f0f5', fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', paddingVertical: 4, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any,
  results: { maxHeight: 320, paddingVertical: 6, paddingHorizontal: 8 },
  emptyText: { color: '#3a3a4e', fontSize: 11, textAlign: 'center', padding: 20, fontStyle: 'italic' },
  modelCard: {
    backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 8,
    padding: 10, marginBottom: 6,
  },
  modelCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  modelAvatar: { width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  modelAvatarText: { fontSize: 13, fontWeight: '800', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  modelName: { color: '#f0f0f5', fontSize: 13, fontWeight: '700' },
  modelAuthor: { color: '#606075', fontSize: 10, marginTop: 1 },
  selectBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a3e', backgroundColor: '#1a1a28' },
  selectBtnText: { fontSize: 10, fontWeight: '700' },
  modelStats: { flexDirection: 'row', gap: 4, marginBottom: 4, flexWrap: 'wrap' },
  statPill: { backgroundColor: '#1a1a28', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: '#2a2a3e' },
  statText: { color: '#a0a0b0', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  modelId: { color: '#3a3a4e', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
