import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useMemoryDoc, updateMemoryDoc, getMemoryHistory, MemoryHistory } from '../services/sharedMemory';

interface Props {
  circleId: string;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SharedMemoryPanel({ circleId }: Props) {
  const doc = useMemoryDoc(circleId);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<MemoryHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (doc && !saving) setDraft(doc.content);
  }, [doc?.content]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await updateMemoryDoc(circleId, draft, user.id);
    } catch (e) {
      console.error(e);
    }
    setSaving(false);
  };

  const openHistory = async () => {
    setShowHistory(true);
    setLoadingHistory(true);
    const h = await getMemoryHistory(circleId, 15);
    setHistory(h);
    setLoadingHistory(false);
  };

  const handleRestore = async (content: string) => {
    setDraft(content);
    setShowHistory(false);
  };

  const isDirty = draft !== (doc?.content ?? '');

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>SHARED MEMORY</Text>
          {doc && (
            <Text style={styles.meta}>
              v{doc.version} · {relativeTime(doc.last_edited_at)}
            </Text>
          )}
        </View>
        <View style={styles.headerRight}>
          <Pressable style={styles.historyBtn} onPress={openHistory}>
            <Text style={styles.historyBtnText}>HISTORY</Text>
          </Pressable>
          <Pressable
            style={[styles.saveBtn, !isDirty && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!isDirty || saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#00FF9C" />
            ) : (
              <Text style={[styles.saveBtnText, !isDirty && styles.saveBtnTextDisabled]}>
                SAVE
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Editor */}
      <TextInput
        style={styles.editor}
        value={draft}
        onChangeText={setDraft}
        multiline
        placeholder="Add goals, context, decisions, agent instructions..."
        placeholderTextColor="#333"
        textAlignVertical="top"
      />

      {/* History Modal */}
      <Modal visible={showHistory} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>MEMORY HISTORY</Text>
              <Pressable onPress={() => setShowHistory(false)}>
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>
            {loadingHistory ? (
              <ActivityIndicator color="#00FF9C" style={{ marginTop: 20 }} />
            ) : history.length === 0 ? (
              <Text style={styles.emptyHistory}>No history yet</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {history.map((h, i) => (
                  <View key={h.id} style={styles.historyItem}>
                    <View style={styles.historyMeta}>
                      <Text style={styles.historyVersion}>v{h.version}</Text>
                      <Text style={styles.historyTime}>{relativeTime(h.edited_at)}</Text>
                    </View>
                    <Text style={styles.historyPreview} numberOfLines={2}>
                      {h.content || '(empty)'}
                    </Text>
                    <Pressable
                      style={styles.restoreBtn}
                      onPress={() => handleRestore(h.content)}
                    >
                      <Text style={styles.restoreBtnText}>RESTORE</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d0d14',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginVertical: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderColor: '#2a2a2a',
  },
  headerLeft: { flex: 1 },
  title: {
    color: '#eee',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  meta: { color: '#444', fontSize: 8, fontFamily: 'monospace', marginTop: 2 },
  headerRight: { flexDirection: 'row', gap: 8 },
  historyBtn: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  historyBtnText: { color: '#666', fontSize: 9, fontWeight: '700', fontFamily: 'monospace' },
  saveBtn: {
    backgroundColor: '#00FF9C20',
    borderWidth: 1,
    borderColor: '#00FF9C50',
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    minWidth: 48,
    alignItems: 'center',
  },
  saveBtnDisabled: { backgroundColor: '#000000', borderColor: '#000000' },
  saveBtnText: { color: '#00FF9C', fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  saveBtnTextDisabled: { color: '#333' },
  editor: {
    color: '#ccc',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
    minHeight: 90,
    padding: 14,
    backgroundColor: '#000000',
  },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    backgroundColor: '#111',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: '#eee',
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  modalClose: { color: '#666', fontSize: 16, padding: 4 },
  emptyHistory: { color: '#555', fontFamily: 'monospace', fontSize: 12, textAlign: 'center', marginTop: 20 },
  historyItem: {
    borderBottomWidth: 1,
    borderColor: '#000000',
    paddingVertical: 12,
  },
  historyMeta: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  historyVersion: { color: '#6366f1', fontSize: 10, fontFamily: 'monospace', fontWeight: '800' },
  historyTime: { color: '#555', fontSize: 10, fontFamily: 'monospace' },
  historyPreview: { color: '#888', fontSize: 11, fontFamily: 'monospace', lineHeight: 15, marginBottom: 6 },
  restoreBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  restoreBtnText: { color: '#aaa', fontSize: 9, fontWeight: '700', fontFamily: 'monospace' },
});
