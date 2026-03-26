/**
 * FocusChainPanel -- Checklist panel for task focus chain items
 * Shows inside TaskDetailModal. Supports add, toggle, delete, auto-generate.
 */

import React, { useState, useCallback } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { FocusChainItem } from '../../../../types/kanban';
import { supabase } from '../../../../lib/supabase';

interface Props {
  taskId: string;
  items: FocusChainItem[];
  onUpdate: (chain: FocusChainItem[]) => void;
  circleId: string;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function FocusChainPanel({ taskId, items, onUpdate, circleId }: Props) {
  const [showInput, setShowInput] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [generating, setGenerating] = useState(false);

  const doneCount = items.filter(i => i.done).length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? doneCount / totalCount : 0;

  const toggleItem = useCallback((id: string) => {
    const updated = items.map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    );
    onUpdate(updated);
  }, [items, onUpdate]);

  const deleteItem = useCallback((id: string) => {
    const updated = items.filter(item => item.id !== id);
    onUpdate(updated);
  }, [items, onUpdate]);

  const addItem = useCallback(() => {
    const text = newItemText.trim();
    if (!text) return;
    const newItem: FocusChainItem = { id: generateId(), text, done: false, auto_generated: false, order: items.length };
    onUpdate([...items, newItem]);
    setNewItemText('');
    setShowInput(false);
  }, [newItemText, items, onUpdate]);

  const autoGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('swanbot-ai', {
        body: {
          message: 'Generate a checklist of actionable steps for this task. Return a JSON array of objects with "text" (string) fields. Only return the JSON array, no other text.',
          circleId,
        },
      });

      if (error) throw error;

      let parsed: { text: string }[] = [];
      const content = typeof data === 'string' ? data : data?.response || data?.content || data?.message || JSON.stringify(data);

      if (typeof content === 'string') {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      } else if (Array.isArray(content)) {
        parsed = content;
      }

      if (parsed.length > 0) {
        const newItems: FocusChainItem[] = parsed.map((p, idx) => ({
          id: generateId(),
          text: typeof p === 'string' ? p : p.text || String(p),
          done: false,
          auto_generated: true,
          order: items.length + idx,
        }));
        onUpdate([...items, ...newItems]);
      }
    } catch (err) {
      console.warn('[FocusChainPanel] auto-generate failed:', err);
    } finally {
      setGenerating(false);
    }
  }, [circleId, items, onUpdate]);

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Focus Chain</Text>
        <View style={s.headerRight}>
          <Text style={s.progressText}>{doneCount}/{totalCount}</Text>
        </View>
      </View>

      {/* Progress bar */}
      {totalCount > 0 && (
        <View style={s.progressBarTrack}>
          <View style={[s.progressBarFill, { width: `${progress * 100}%` as any }]} />
        </View>
      )}

      {/* Checklist items */}
      <View style={s.list}>
        {items.map((item) => (
          <View key={item.id} style={s.itemRow}>
            <Pressable
              onPress={() => toggleItem(item.id)}
              style={[s.checkbox, item.done && s.checkboxDone]}
            >
              {item.done && <Text style={s.checkmark}>{'\u2713'}</Text>}
            </Pressable>
            <Text style={[s.itemText, item.done && s.itemTextDone]} numberOfLines={3}>
              {item.text}
            </Text>
            <Pressable
              onPress={() => deleteItem(item.id)}
              style={s.deleteBtn}
              hitSlop={6}
            >
              <Text style={s.deleteBtnText}>{'\u00D7'}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      {/* Empty state */}
      {totalCount === 0 && !showInput && (
        <Text style={s.emptyText}>No checklist items yet.</Text>
      )}

      {/* Inline add input */}
      {showInput && (
        <View style={s.addInputRow}>
          <TextInput
            style={s.addInput}
            value={newItemText}
            onChangeText={setNewItemText}
            placeholder="Enter checklist item..."
            placeholderTextColor="#555"
            autoFocus
            onSubmitEditing={addItem}
            returnKeyType="done"
          />
          <Pressable onPress={addItem} style={s.addConfirmBtn}>
            <Text style={s.addConfirmText}>Add</Text>
          </Pressable>
          <Pressable onPress={() => { setShowInput(false); setNewItemText(''); }} style={s.cancelBtn}>
            <Text style={s.cancelText}>{'\u00D7'}</Text>
          </Pressable>
        </View>
      )}

      {/* Action buttons */}
      <View style={s.actions}>
        {!showInput && (
          <Pressable onPress={() => setShowInput(true)} style={s.actionBtn}>
            <Text style={s.actionBtnText}>+ Add Item</Text>
          </Pressable>
        )}
        <Pressable
          onPress={autoGenerate}
          style={[s.actionBtn, s.generateBtn]}
          disabled={generating}
        >
          {generating ? (
            <ActivityIndicator size="small" color="#8b5cf6" />
          ) : (
            <Text style={[s.actionBtnText, s.generateBtnText]}>Auto-generate</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#0a0a0a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e1e3a',
    padding: 14,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: '#c0c0c0',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressText: {
    color: '#8b8b8b',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  progressBarTrack: {
    height: 3,
    backgroundColor: '#1a1a2e',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%' as any,
    backgroundColor: '#22c55e',
    borderRadius: 2,
    ...(Platform.OS === 'web' ? { transition: 'width 0.3s ease' } as any : {}),
  },
  list: {
    gap: 6,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 6,
    backgroundColor: '#111118',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: '#3e3e5a',
    backgroundColor: '#0a0a14',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  checkboxDone: {
    backgroundColor: '#22c55e20',
    borderColor: '#22c55e60',
  },
  checkmark: {
    color: '#22c55e',
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 14,
  },
  itemText: {
    flex: 1,
    color: '#c8c8d0',
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  itemTextDone: {
    textDecorationLine: 'line-through',
    color: '#555565',
  },
  deleteBtn: {
    width: 20,
    height: 20,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 0,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteBtnText: {
    color: '#555',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 18,
  },
  emptyText: {
    color: '#444',
    fontSize: 12,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    textAlign: 'center',
    paddingVertical: 12,
  },
  addInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addInput: {
    flex: 1,
    backgroundColor: '#111118',
    borderWidth: 1,
    borderColor: '#1e1e3a',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: '#e0e0e8',
    fontSize: 13,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  addConfirmBtn: {
    backgroundColor: '#22c55e18',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#22c55e30',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addConfirmText: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '700',
  },
  cancelBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cancelText: {
    color: '#666',
    fontSize: 18,
    fontWeight: '600',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionBtn: {
    backgroundColor: '#161622',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#1e1e3a',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'background 0.15s' } as any : {}),
  },
  actionBtnText: {
    color: '#8b8b9e',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  generateBtn: {
    borderColor: '#8b5cf630',
    backgroundColor: '#8b5cf610',
  },
  generateBtnText: {
    color: '#8b5cf6',
  },
});
