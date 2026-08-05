/**
 * NeedsAttentionPanel — "⚑ Needs attention" accountability strip for the Feed
 * tab. Renders the ranked output of `buildNeedsAttention` (accountabilityNagCore):
 * breached missions, overdue tasks, blocked/stalled work, and due-soon tasks.
 * Collapsed to the top 3 with a "show all" toggle; renders nothing when empty.
 */

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import type { NeedsAttentionItem, NeedsAttentionKind } from '../../lib/accountabilityNagCore';

interface Props {
  items: NeedsAttentionItem[];
  /** Called with the row's item when its chevron/action button is pressed. */
  onAction?: (item: NeedsAttentionItem) => void;
}

const COLLAPSED_COUNT = 3;

const KIND_META: Record<NeedsAttentionKind, { icon: string; color: string; badge: string }> = {
  mission_breached: { icon: '!!', color: '#ef4444', badge: 'BREACHED' },
  task_overdue:     { icon: '!',  color: '#f97316', badge: 'OVERDUE' },
  task_blocked:     { icon: 'x',  color: '#ef4444', badge: 'BLOCKED' },
  task_stalled:     { icon: 'z',  color: '#f59e0b', badge: 'STALLED' },
  task_due_soon:    { icon: '~',  color: '#eab308', badge: 'DUE SOON' },
};

export default function NeedsAttentionPanel({ items, onAction }: Props) {
  const [showAll, setShowAll] = useState(false);

  if (!Array.isArray(items) || items.length === 0) return null;

  const visible = showAll ? items : items.slice(0, COLLAPSED_COUNT);
  const hiddenCount = items.length - COLLAPSED_COUNT;

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <Text style={s.headerFlag}>&#x2691;</Text>
          <Text style={s.headerTitle}>NEEDS ATTENTION</Text>
          <View style={s.countBadge}>
            <Text style={s.countText}>{items.length}</Text>
          </View>
        </View>
      </View>

      {/* Rows */}
      {visible.map(item => {
        const meta = KIND_META[item.kind] || KIND_META.task_stalled;
        return (
          <View key={item.key} style={[s.item, { borderLeftColor: meta.color }]}>
            <View style={[s.iconCircle, { backgroundColor: meta.color + '20' }]}>
              <Text style={[s.iconText, { color: meta.color }]}>{meta.icon}</Text>
            </View>
            <View style={s.itemContent}>
              <View style={s.itemTitleRow}>
                <Text style={s.itemTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={[s.kindBadge, { color: meta.color }]}>{meta.badge}</Text>
              </View>
              <Text style={s.itemReason} numberOfLines={2}>{item.reason}</Text>
            </View>
            {onAction ? (
              <TouchableOpacity
                style={s.actionBtn}
                onPress={() => onAction(item)}
                accessibilityLabel={item.suggestedAction?.label || 'Act on this'}
              >
                <Text style={s.actionLabel} numberOfLines={1}>
                  {item.suggestedAction?.label || 'Open'}
                </Text>
                <Text style={s.actionChevron}>&#x203A;</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        );
      })}

      {/* Show all / show less */}
      {hiddenCount > 0 && (
        <TouchableOpacity style={s.toggleRow} onPress={() => setShowAll(v => !v)}>
          <Text style={s.toggleText}>
            {showAll ? 'show less' : `show all (${hiddenCount} more)`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: '#0d0d16',
    borderWidth: 1,
    borderColor: '#15151e',
    borderRadius: 10,
    marginHorizontal: 8,
    marginTop: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerFlag: {
    fontSize: 13,
    color: '#ef4444',
  },
  headerTitle: {
    color: '#9090a8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  countBadge: {
    backgroundColor: '#1a1a28',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '700',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderLeftWidth: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#15151e',
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  iconText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  itemContent: {
    flex: 1,
    gap: 2,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  itemTitle: {
    color: '#e4e4ed',
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
  },
  kindBadge: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    flexShrink: 0,
  },
  itemReason: {
    color: '#9090a8',
    fontSize: 11,
    lineHeight: 15,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#1a1a28',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    flexShrink: 0,
    maxWidth: 150,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  actionLabel: {
    color: '#a5b4fc',
    fontSize: 10,
    fontWeight: '600',
  },
  actionChevron: {
    color: '#6366f1',
    fontSize: 12,
    fontWeight: '700',
  },
  toggleRow: {
    alignItems: 'center',
    paddingVertical: 7,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  toggleText: {
    color: '#6366f1',
    fontSize: 11,
    fontWeight: '500',
  },
});
