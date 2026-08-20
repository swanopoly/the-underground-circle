import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import {
  updateMemoryDoc,
  type MemoryDoc,
  type MemoryHistory,
} from '../services/sharedMemory';

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
  const [doc, setDoc] = useState<MemoryDoc | null>(null);
  const [draft, setDraft] = useState('');
  const [baseContent, setBaseContent] = useState('');
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
    action?: 'retry' | 'reload';
  } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<MemoryHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const loadGenerationRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const historyGenerationRef = useRef(0);
  const baseContentRef = useRef('');
  const draftRef = useRef('');
  const circleIdRef = useRef(circleId);
  circleIdRef.current = circleId;

  const loadDoc = useCallback(async (options?: { replaceDraft?: boolean }) => {
    const generation = ++loadGenerationRef.current;
    setLoadingDoc(true);
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from('circle_memory')
        .select('*')
        .eq('circle_id', circleId)
        .eq('doc_kind', 'brief')
        .maybeSingle();
      if (error) throw error;
      if (generation !== loadGenerationRef.current) return;

      const nextDoc = (data as MemoryDoc | null) ?? null;
      const previousBase = baseContentRef.current;
      const nextBase = nextDoc?.content ?? '';
      setDoc(nextDoc);
      if (options?.replaceDraft || draftRef.current === previousBase) {
        draftRef.current = nextBase;
        setDraft(nextBase);
        setBaseContent(nextBase);
        baseContentRef.current = nextBase;
        if (options?.replaceDraft) setSaveFeedback(null);
      } else if (nextBase !== previousBase) {
        setSaveFeedback({
          type: 'error',
          action: 'reload',
          message: 'Shared memory changed elsewhere. Your draft was preserved; load the latest version before saving.',
        });
      }
    } catch (error) {
      console.error('[SharedMemoryPanel] Failed to load memory:', error);
      if (generation === loadGenerationRef.current) {
        setLoadError('Shared memory could not be loaded. Your editor is locked to prevent an accidental overwrite.');
      }
    } finally {
      if (generation === loadGenerationRef.current) setLoadingDoc(false);
    }
  }, [circleId]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    saveGenerationRef.current += 1;
    historyGenerationRef.current += 1;
    baseContentRef.current = '';
    draftRef.current = '';
    setDoc(null);
    setDraft('');
    setBaseContent('');
    setLoadError(null);
    setSaveFeedback(null);
    setSaving(false);
    setLoadingHistory(false);
    setHistoryError(null);
    void loadDoc();

    const channel = supabase
      .channel(`shared-memory-panel-${circleId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'circle_memory',
        filter: `circle_id=eq.${circleId}`,
      }, () => { void loadDoc(); })
      .subscribe();

    return () => {
      loadGenerationRef.current += 1;
      saveGenerationRef.current += 1;
      historyGenerationRef.current += 1;
      void supabase.removeChannel(channel);
    };
  }, [circleId, loadDoc]);

  const handleSave = async () => {
    const generation = ++saveGenerationRef.current;
    const capturedCircleId = circleId;
    const capturedDraft = draft;
    setSaving(true);
    setSaveFeedback(null);
    try {
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      if (authError) throw authError;
      if (!session?.user || !session.access_token) {
        throw new Error('Sign in before saving shared memory.');
      }

      const result = await updateMemoryDoc(
        capturedCircleId,
        capturedDraft,
        session.user.id,
        'brief',
        {
          guardBaseContent: baseContent,
          capturedAuth: {
            userId: session.user.id,
            accessToken: session.access_token,
          },
          isAuthorityCurrent: () => (
            generation === saveGenerationRef.current
            && capturedCircleId === circleIdRef.current
          ),
        },
      );
      if (generation !== saveGenerationRef.current) return;
      if (!result.ok) {
        const message = result.status === 'conflict'
          ? 'Shared memory changed elsewhere. Reload it, review the latest version, and save again.'
          : result.status === 'refused'
            ? 'This memory update was refused. Review the content and try again.'
            : 'Shared memory could not be saved. Try again.';
        console.error('[SharedMemoryPanel] Save failed:', result.message);
        setSaveFeedback({
          type: 'error',
          message,
          action: result.status === 'conflict' ? 'reload' : 'retry',
        });
        return;
      }

      baseContentRef.current = capturedDraft;
      draftRef.current = capturedDraft;
      setBaseContent(capturedDraft);
      setDoc(current => current ? {
        ...current,
        content: capturedDraft,
        version: result.version ?? current.version,
        last_edited_at: new Date().toISOString(),
      } : current);
      setSaveFeedback({ type: 'success', message: result.status === 'unchanged' ? 'Memory is already up to date.' : 'Shared memory saved.' });
      void loadDoc();
    } catch (error) {
      console.error('[SharedMemoryPanel] Save failed:', error);
      if (generation === saveGenerationRef.current) {
        const message = error instanceof Error && error.message.startsWith('Sign in')
          ? error.message
          : 'Shared memory could not be saved. Try again.';
        setSaveFeedback({ type: 'error', message, action: 'retry' });
      }
    } finally {
      if (generation === saveGenerationRef.current) setSaving(false);
    }
  };

  const loadHistory = async () => {
    const generation = ++historyGenerationRef.current;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase
        .from('circle_memory_history')
        .select('*')
        .eq('circle_id', circleId)
        .eq('doc_kind', 'brief')
        .order('edited_at', { ascending: false })
        .limit(15);
      if (error) throw error;
      if (generation !== historyGenerationRef.current) return;
      setHistory((data || []) as MemoryHistory[]);
    } catch (error) {
      console.error('[SharedMemoryPanel] Failed to load history:', error);
      if (generation === historyGenerationRef.current) {
        setHistoryError('Memory history could not be loaded.');
      }
    } finally {
      if (generation === historyGenerationRef.current) setLoadingHistory(false);
    }
  };

  const openHistory = () => {
    setShowHistory(true);
    void loadHistory();
  };

  const handleRestore = (content: string) => {
    draftRef.current = content;
    setDraft(content);
    setSaveFeedback(null);
    setShowHistory(false);
  };

  const isDirty = draft !== baseContent;
  const saveDisabled = !isDirty || saving || loadingDoc || Boolean(loadError);

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
          <Pressable
            style={styles.historyBtn}
            onPress={openHistory}
            accessibilityRole="button"
            accessibilityLabel="Open shared memory history"
          >
            <Text style={styles.historyBtnText}>HISTORY</Text>
          </Pressable>
          <Pressable
            style={[styles.saveBtn, saveDisabled && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saveDisabled}
            accessibilityRole="button"
            accessibilityLabel="Save shared memory"
            accessibilityState={{ disabled: saveDisabled, busy: saving }}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#00FF9C" />
            ) : (
              <Text style={[styles.saveBtnText, saveDisabled && styles.saveBtnTextDisabled]}>
                SAVE
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {loadingDoc && (
        <View style={styles.statusBanner} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color="#6366f1" />
          <Text style={styles.statusText}>Loading shared memory...</Text>
        </View>
      )}

      {loadError && (
        <View style={[styles.statusBanner, styles.errorBanner]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <Text style={[styles.statusText, styles.errorText]}>{loadError}</Text>
          <Pressable
            style={styles.inlineButton}
            onPress={() => { void loadDoc(); }}
            accessibilityRole="button"
            accessibilityLabel="Retry loading shared memory"
          >
            <Text style={styles.inlineButtonText}>RETRY</Text>
          </Pressable>
        </View>
      )}

      {saveFeedback && (
        <View
          style={[styles.statusBanner, saveFeedback.type === 'error' ? styles.errorBanner : styles.successBanner]}
          accessibilityRole={saveFeedback.type === 'error' ? 'alert' : 'summary'}
          accessibilityLiveRegion={saveFeedback.type === 'error' ? 'assertive' : 'polite'}
        >
          <Text style={[styles.statusText, saveFeedback.type === 'error' ? styles.errorText : styles.successText]}>
            {saveFeedback.message}
          </Text>
          {saveFeedback.type === 'error' && isDirty && !loadError && (
            <Pressable
              style={styles.inlineButton}
              onPress={() => {
                if (saveFeedback.action === 'reload') {
                  void loadDoc({ replaceDraft: true });
                } else {
                  void handleSave();
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={saveFeedback.action === 'reload'
                ? 'Load latest shared memory and replace this draft'
                : 'Retry saving shared memory'}
              accessibilityHint={saveFeedback.action === 'reload'
                ? 'Replaces the current draft with the newest saved version'
                : undefined}
            >
              <Text style={styles.inlineButtonText}>
                {saveFeedback.action === 'reload' ? 'LOAD LATEST' : 'TRY AGAIN'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Editor */}
      <TextInput
        style={styles.editor}
        value={draft}
        onChangeText={(value) => {
          draftRef.current = value;
          setDraft(value);
          if (saveFeedback) setSaveFeedback(null);
        }}
        multiline
        editable={!loadingDoc && !loadError && !saving}
        accessibilityLabel="Shared memory editor"
        accessibilityHint="Edit the shared brief for this circle"
        placeholder="Add goals, context, decisions, agent instructions..."
        placeholderTextColor="#333"
        textAlignVertical="top"
      />

      {/* History Modal */}
      <Modal visible={showHistory} transparent animationType="fade" onRequestClose={() => setShowHistory(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowHistory(false)}>
          <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>MEMORY HISTORY</Text>
              <Pressable
                onPress={() => setShowHistory(false)}
                accessibilityRole="button"
                accessibilityLabel="Close memory history"
              >
                <Text style={styles.modalClose}>✕</Text>
              </Pressable>
            </View>
            {loadingHistory ? (
              <ActivityIndicator color="#00FF9C" style={{ marginTop: 20 }} />
            ) : historyError ? (
              <View style={styles.historyError} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                <Text style={styles.errorText}>{historyError}</Text>
                <Pressable
                  style={styles.inlineButton}
                  onPress={() => { void loadHistory(); }}
                  accessibilityRole="button"
                  accessibilityLabel="Retry loading memory history"
                >
                  <Text style={styles.inlineButtonText}>RETRY</Text>
                </Pressable>
              </View>
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
                      accessibilityRole="button"
                      accessibilityLabel={`Restore memory version ${h.version}`}
                    >
                      <Text style={styles.restoreBtnText}>RESTORE</Text>
                    </Pressable>
                  </View>
                ))}
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
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
  statusBanner: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    backgroundColor: '#11111a',
  },
  errorBanner: { backgroundColor: '#2a1115', borderBottomColor: '#5b2029' },
  successBanner: { backgroundColor: '#0d211b', borderBottomColor: '#17563f' },
  statusText: { flex: 1, color: '#aaa', fontSize: 11, lineHeight: 16, fontFamily: 'monospace' },
  errorText: { color: '#fda4af', fontSize: 11, lineHeight: 16, fontFamily: 'monospace', textAlign: 'center' },
  successText: { color: '#86efac' },
  inlineButton: {
    minHeight: 36,
    minWidth: 72,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineButtonText: { color: '#c7d2fe', fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
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
  historyError: { alignItems: 'center', gap: 12, paddingVertical: 20 },
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
