import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  TextInput, ActivityIndicator, Platform,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';

interface Props {
  circleId: string;
  onClose: () => void;
  onAdded?: (spaceName: string) => void;
}

interface HFSpace {
  id: string;
  author: string;
  lastModified: string;
  likes: number;
  sdk: string;
  cardData?: { title?: string; emoji?: string };
}

type SearchTab = 'spaces' | 'models';

const POPULAR_SEARCHES = ['FLUX', 'Whisper', 'Stable Diffusion', 'Llama', 'Sentiment', 'Summarization'];

export default function HuggingFaceExplorer({ circleId, onClose, onAdded }: Props) {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<SearchTab>('spaces');
  const [spaces, setSpaces] = useState<HFSpace[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const searchHF = async (query: string) => {
    if (!query) return;
    setLoading(true);
    try {
      if (tab === 'spaces') {
        const response = await fetch(
          `https://huggingface.co/api/spaces?search=${encodeURIComponent(query)}&limit=12&full=full`
        );
        setSpaces(await response.json());
      } else {
        const response = await fetch(
          `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&sort=trending&limit=12`
        );
        setModels(await response.json());
      }
    } catch (e) {
      console.error('HF search failed:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    const timer = setTimeout(() => { if (search) searchHF(search); }, 400);
    return () => clearTimeout(timer);
  }, [search, tab]);

  const addSpace = async (id: string, name: string, sdk?: string) => {
    setAdding(id);
    try {
      const { error } = await supabase.from('circle_hf_tools').insert({
        circle_id: circleId,
        space_id: id,
        space_name: name,
        input_schema: sdk ? { sdk } : {},
      });
      if (error) throw error;
      onAdded?.(id);
      onClose();
    } catch (e) {
      console.error('Failed to add:', e);
    }
    setAdding(null);
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>Hugging Face</Text>
          <Text style={s.subtitle}>200k+ open source models and tools</Text>
        </View>
        <Pressable onPress={onClose} style={s.closeBtn}>
          <Text style={s.closeText}>x</Text>
        </Pressable>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(['spaces', 'models'] as SearchTab[]).map(t => (
          <Pressable key={t} onPress={() => setTab(t)} style={[s.tab, tab === t && s.tabActive]}>
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t === 'spaces' ? 'Spaces' : 'Models'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          style={s.searchInput}
          placeholder={tab === 'spaces' ? 'Search Spaces...' : 'Search Models...'}
          placeholderTextColor="#4f4f4f"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading && <ActivityIndicator size="small" color="#9e9e9e" style={{ marginLeft: -36, marginRight: 12 }} />}
      </View>

      {/* Quick searches */}
      {!search && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRow}>
          {POPULAR_SEARCHES.map(q => (
            <Pressable key={q} style={s.quickChip} onPress={() => setSearch(q)}>
              <Text style={s.quickText}>{q}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Results */}
      <ScrollView contentContainerStyle={s.results} showsVerticalScrollIndicator={false}>
        {tab === 'spaces' && spaces.length === 0 && !loading && !search && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>HF</Text>
            <Text style={s.emptyText}>Search the Hugging Face Hub to find tools for your circle.</Text>
          </View>
        )}

        {tab === 'spaces' && spaces.map(space => (
          <View key={space.id} style={s.card}>
            <View style={s.cardInfo}>
              <View style={s.iconBox}>
                <Text style={s.iconText}>{space.cardData?.emoji || '>'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle} numberOfLines={1}>
                  {space.cardData?.title || space.id.split('/')[1]}
                </Text>
                <Text style={s.cardSub} numberOfLines={1}>{space.id}</Text>
                <View style={s.badges}>
                  <View style={s.badge}>
                    <Text style={s.badgeText}>{(space.sdk || 'unknown').toUpperCase()}</Text>
                  </View>
                  <Text style={s.likes}>{space.likes} likes</Text>
                </View>
              </View>
            </View>
            <Pressable
              style={[s.addBtn, adding === space.id && { opacity: 0.5 }]}
              onPress={() => addSpace(space.id, space.cardData?.title || space.id.split('/')[1], space.sdk)}
              disabled={adding === space.id}
            >
              <Text style={s.addText}>{adding === space.id ? '...' : 'Add'}</Text>
            </Pressable>
          </View>
        ))}

        {tab === 'models' && models.map((m: any) => (
          <View key={m.id || m.modelId} style={s.card}>
            <View style={s.cardInfo}>
              <View style={s.iconBox}>
                <Text style={s.iconText}>M</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.cardTitle} numberOfLines={1}>
                  {m.id?.split('/')[1] || m.id}
                </Text>
                <Text style={s.cardSub} numberOfLines={1}>{m.id}</Text>
                <View style={s.badges}>
                  {m.pipeline_tag && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>{m.pipeline_tag.toUpperCase()}</Text>
                    </View>
                  )}
                  <Text style={s.likes}>{m.downloads ? `${(m.downloads / 1000).toFixed(0)}K dl` : ''}</Text>
                </View>
              </View>
            </View>
            <Pressable
              style={[s.addBtn, adding === m.id && { opacity: 0.5 }]}
              onPress={() => addSpace(m.id, m.id?.split('/')[1] || m.id, m.pipeline_tag)}
              disabled={adding === m.id}
            >
              <Text style={s.addText}>{adding === m.id ? '...' : 'Add'}</Text>
            </Pressable>
          </View>
        ))}

        {loading && (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color="#9e9e9e" />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  title: { color: '#e8e8e8', fontSize: 18, fontWeight: '600' },
  subtitle: { color: '#6f6f6f', fontSize: 12, marginTop: 2 },
  closeBtn: { padding: 10 },
  closeText: { color: '#6f6f6f', fontSize: 18, fontWeight: '600' },
  tabs: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
    paddingHorizontal: 16,
  },
  tab: {
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabActive: { borderBottomColor: '#e8e8e8' },
  tabText: { color: '#4f4f4f', fontSize: 13, fontWeight: '500' },
  tabTextActive: { color: '#e8e8e8', fontWeight: '600' },
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  searchInput: {
    flex: 1, backgroundColor: '#0a0a0a', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10,
    color: '#e8e8e8', fontSize: 14,
    borderWidth: 1, borderColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  quickRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 8 },
  quickChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10,
    backgroundColor: '#161616', borderWidth: 1, borderColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  quickText: { color: '#9e9e9e', fontSize: 12 },
  results: { padding: 16, gap: 10 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIcon: {
    fontSize: 24, fontWeight: '900', color: '#3e3e3e',
    backgroundColor: '#161616', width: 56, height: 56, lineHeight: 56,
    textAlign: 'center', borderRadius: 16, overflow: 'hidden', marginBottom: 16,
  },
  emptyText: { color: '#4f4f4f', fontSize: 13, textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: '#161616', borderRadius: 12, padding: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1, borderColor: '#1a1a1a',
  },
  cardInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 12 },
  iconBox: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: '#252525',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  iconText: { color: '#9e9e9e', fontSize: 16, fontWeight: '700' },
  cardTitle: { color: '#e8e8e8', fontSize: 14, fontWeight: '600' },
  cardSub: { color: '#4f4f4f', fontSize: 11, marginTop: 1 },
  badges: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 },
  badge: {
    backgroundColor: '#ffffff08', paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: { color: '#9e9e9e', fontSize: 9, fontWeight: '700' },
  likes: { color: '#4f4f4f', fontSize: 10 },
  addBtn: {
    backgroundColor: '#ffffff', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 10, minWidth: 60, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addText: { color: '#000000', fontSize: 12, fontWeight: '700' },
});
