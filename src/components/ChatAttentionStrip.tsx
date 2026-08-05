import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import type {
  ChatAttentionAction,
  ChatAttentionItem,
  ChatAttentionState,
} from '../lib/chatAttentionQueue';

/**
 * ChatAttentionStrip — renders the "Needs you" state from
 * `chatAttentionQueue` (Phase 1c of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md).
 *
 * Collapsed: one status line ("Needs you: 1 approval (next expires in 3m) ·
 * 1 question"). Expanded: one row per item with the module's typed actions.
 * Presentational only — the module decides wording/ranking/urgency, the
 * parent decides what each action does. Pending-approval rows are typically
 * filtered out by the parent because `HitlApprovalBanner` renders those with
 * live approve/reject buttons directly below this strip; the status line
 * still counts them so the summary stays truthful.
 */

interface Props {
  state: ChatAttentionState;
  /** Items to render rows for (parent may filter kinds covered elsewhere). */
  items: ChatAttentionItem[];
  onAction: (item: ChatAttentionItem, action: ChatAttentionAction) => void;
  accentColor?: string;
}

export default function ChatAttentionStrip({ state, items, onAction, accentColor = '#22c55e' }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!state.statusLine) return null;

  const urgentColor = state.hasUrgent ? '#f59e0b' : accentColor;

  return (
    <View style={[styles.container, { borderColor: urgentColor + '33' }]}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel="Toggle items that need your attention"
      >
        <View style={[styles.dot, { backgroundColor: urgentColor }]} />
        <Text style={styles.statusLine} numberOfLines={1}>{state.statusLine}</Text>
        {items.length > 0 ? (
          <Text style={[styles.chevron, { color: urgentColor }]}>{expanded ? '▾' : '▸'}</Text>
        ) : null}
      </Pressable>

      {expanded && items.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <View style={styles.itemText}>
            <Text style={[styles.itemTitle, item.urgency === 'now' && styles.itemTitleUrgent]} numberOfLines={2}>
              {item.title}
            </Text>
            {item.detail ? (
              <Text style={styles.itemDetail} numberOfLines={3}>{item.detail}</Text>
            ) : null}
          </View>
          <View style={styles.actions}>
            <Pressable
              style={[styles.actionButton, { backgroundColor: urgentColor + '22', borderColor: urgentColor + '55' }]}
              onPress={() => onAction(item, item.primaryAction)}
            >
              <Text style={[styles.actionLabel, { color: urgentColor }]} numberOfLines={1}>
                {item.primaryAction.label}
              </Text>
            </Pressable>
            {item.secondaryActions.map((action) => (
              <Pressable
                key={action.kind}
                style={styles.secondaryButton}
                onPress={() => onAction(item, action)}
              >
                <Text style={styles.secondaryLabel} numberOfLines={1}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#0d150d',
    borderWidth: 1,
    borderRadius: 10,
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 2,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLine: {
    flex: 1,
    color: '#e6efe2',
    fontSize: 12,
    fontWeight: '700',
  },
  chevron: {
    fontSize: 12,
    fontWeight: '700',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: '#1b271b',
    paddingVertical: 8,
    marginTop: 6,
  },
  itemText: {
    flex: 1,
  },
  itemTitle: {
    color: '#d9e4d3',
    fontSize: 12,
    fontWeight: '700',
  },
  itemTitleUrgent: {
    color: '#ffd28a',
  },
  itemDetail: {
    color: '#8e9f8e',
    fontSize: 11,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  actionButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 170,
  },
  actionLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#131d13',
    maxWidth: 120,
  },
  secondaryLabel: {
    color: '#9fb29b',
    fontSize: 11,
    fontWeight: '600',
  },
});
