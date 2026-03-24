/**
 * GitBookEmbed — Embed GitBook documentation in the app
 *
 * Two modes:
 *  1. Full embed — uses GitBook's embeddable widget (requires docs URL)
 *  2. LLMs.txt — loads the docs index for AI consumption
 *
 * Usage:
 *   <GitBookEmbed docsUrl="https://your-docs.gitbook.io" />
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform,
  ActivityIndicator,
} from 'react-native';

const MONO = Platform.OS === 'web' ? 'monospace' : undefined;

interface Props {
  docsUrl?: string;
  height?: number;
  onClose?: () => void;
}

export default function GitBookEmbed({ docsUrl, height = 500, onClose }: Props) {
  const [url, setUrl] = useState(docsUrl || '');
  const [loading, setLoading] = useState(false);
  const [llmsTxt, setLlmsTxt] = useState<string | null>(null);
  const [mode, setMode] = useState<'embed' | 'index'>('embed');
  const [error, setError] = useState('');

  // Load llms.txt index
  const loadIndex = async () => {
    if (!url) return;
    setLoading(true);
    setError('');
    try {
      const base = url.endsWith('/') ? url.slice(0, -1) : url;
      const resp = await fetch(`${base}/llms.txt`);
      if (!resp.ok) throw new Error(`${resp.status}`);
      const text = await resp.text();
      setLlmsTxt(text);
    } catch (e: any) {
      setError(`Could not load llms.txt: ${e.message}`);
    }
    setLoading(false);
  };

  if (Platform.OS !== 'web') {
    return (
      <View style={s.container}>
        <Text style={s.fallback}>GitBook embed requires a web browser.</Text>
      </View>
    );
  }

  return (
    <View style={s.container} nativeID="section-gitbook-embed">
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerIcon}>📖</Text>
        <Text style={s.headerTitle}>Documentation</Text>
        <View style={s.modeToggle}>
          <Pressable onPress={() => setMode('embed')} style={[s.modeBtn, mode === 'embed' && s.modeBtnActive]}>
            <Text style={[s.modeBtnText, mode === 'embed' && { color: '#fff' }]}>Embed</Text>
          </Pressable>
          <Pressable onPress={() => { setMode('index'); loadIndex(); }} style={[s.modeBtn, mode === 'index' && s.modeBtnActive]}>
            <Text style={[s.modeBtnText, mode === 'index' && { color: '#fff' }]}>Index</Text>
          </Pressable>
        </View>
        {onClose && (
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeBtnText}>X</Text>
          </Pressable>
        )}
      </View>

      {/* URL input */}
      {!docsUrl && (
        <View style={s.urlRow}>
          <TextInput
            style={s.urlInput}
            value={url}
            onChangeText={setUrl}
            placeholder="https://your-docs.gitbook.io"
            placeholderTextColor="#4b5563"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {mode === 'index' && (
            <Pressable onPress={loadIndex} style={s.loadBtn}>
              <Text style={s.loadBtnText}>Load</Text>
            </Pressable>
          )}
        </View>
      )}

      {error ? <Text style={s.error}>{error}</Text> : null}

      {/* Embed mode — iframe */}
      {mode === 'embed' && url && (
        <>
          {loading && <ActivityIndicator color="#8b5cf6" style={{ marginTop: 20 }} />}
          <iframe
            src={url}
            style={{
              width: '100%',
              height: height,
              border: 'none',
              borderRadius: 8,
              backgroundColor: '#0a0a0a',
            }}
            onLoad={() => setLoading(false)}
            allow="clipboard-write"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          />
        </>
      )}

      {/* Index mode — llms.txt viewer */}
      {mode === 'index' && (
        <ScrollView style={[s.indexScroll, { maxHeight: height }]} showsVerticalScrollIndicator={false}>
          {loading && <ActivityIndicator color="#8b5cf6" style={{ marginTop: 20 }} />}
          {llmsTxt ? (
            <Text style={s.indexText} selectable>{llmsTxt}</Text>
          ) : !loading && !error ? (
            <View style={s.emptyState}>
              <Text style={s.emptyIcon}>📖</Text>
              <Text style={s.emptyText}>Enter your GitBook docs URL and click Load</Text>
              <Text style={s.emptyHint}>
                The llms.txt index shows all pages in your docs —{'\n'}
                perfect for feeding into AI tools and BlackSwan.
              </Text>
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* No URL */}
      {!url && mode === 'embed' && (
        <View style={s.emptyState}>
          <Text style={s.emptyIcon}>📖</Text>
          <Text style={s.emptyText}>Enter your GitBook docs URL above</Text>
          <Text style={s.emptyHint}>
            Embed your team's documentation directly in the app.{'\n'}
            Supports any GitBook published site.
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Popular doc templates ────────────────────────────────────────────────────

export const DOC_TEMPLATES = [
  { label: 'API Reference', style: 'reference', prompt: 'Document all API endpoints with parameters, responses, and examples' },
  { label: 'Getting Started', style: 'guide', prompt: 'Write a getting started guide for new developers joining the project' },
  { label: 'Architecture', style: 'guide', prompt: 'Document the system architecture, key components, and data flow' },
  { label: 'Deployment', style: 'guide', prompt: 'Write a deployment guide with environments, CI/CD, and rollback procedures' },
  { label: 'Troubleshooting', style: 'troubleshooting', prompt: 'Create a troubleshooting guide for common issues and their solutions' },
  { label: 'Changelog', style: 'changelog', prompt: 'Generate a changelog from recent commits and PRs' },
];

const s = StyleSheet.create({
  container: { borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0a0a0a' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 8, backgroundColor: '#111827', gap: 6 },
  headerIcon: { fontSize: 14 },
  headerTitle: { color: '#d1d5db', fontSize: 12, fontWeight: '600', fontFamily: MONO, flex: 1 },
  modeToggle: { flexDirection: 'row', backgroundColor: '#1e293b', borderRadius: 4, overflow: 'hidden' },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 3 },
  modeBtnActive: { backgroundColor: '#6366f1' },
  modeBtnText: { color: '#6b7280', fontSize: 10, fontWeight: '600', fontFamily: MONO },
  closeBtn: { padding: 4 },
  closeBtnText: { color: '#6b7280', fontSize: 14, fontWeight: '600' },
  urlRow: { flexDirection: 'row', padding: 8, gap: 6 },
  urlInput: { flex: 1, backgroundColor: '#111827', borderRadius: 6, borderWidth: 1, borderColor: '#1e293b', color: '#e8e8e8', fontFamily: MONO, fontSize: 12, paddingHorizontal: 10, paddingVertical: 6 },
  loadBtn: { backgroundColor: '#6366f1', borderRadius: 6, paddingHorizontal: 12, justifyContent: 'center' },
  loadBtnText: { color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: MONO },
  error: { color: '#ef4444', fontSize: 11, fontFamily: MONO, paddingHorizontal: 8, paddingBottom: 4 },
  indexScroll: { padding: 8 },
  indexText: { color: '#c9d1d9', fontSize: 11, fontFamily: MONO, lineHeight: 18 },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyIcon: { fontSize: 32, marginBottom: 8 },
  emptyText: { color: '#6b7280', fontSize: 13, fontFamily: MONO },
  emptyHint: { color: '#4b5563', fontSize: 11, fontFamily: MONO, textAlign: 'center', marginTop: 6, lineHeight: 18 },
  fallback: { color: '#6b7280', fontSize: 12, textAlign: 'center', padding: 24, fontFamily: MONO },
});
