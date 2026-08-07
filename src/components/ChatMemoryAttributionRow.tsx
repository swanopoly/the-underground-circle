import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * ChatMemoryAttributionRow — the "what made this answer smart" footer under
 * a bot reply (Phase 3b of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md).
 *
 * `memoriesUsed` / `memoryRefs` have been carried on persisted messages all
 * along but never rendered — users couldn't tell which memories informed a
 * response. This row shows the memory titles (tap → memory viewer).
 *
 * The one-tap "＋ Remember" chip that used to sit beside them was removed by
 * request (2026-08-07). `/remember` remains available as a typed command, so
 * no capability was lost — only the per-message affordance.
 */

interface Props {
  /** Memory titles that informed this response (from message metadata). */
  memoriesUsed?: string[] | null;
  /** Count of prompt memory references when titles are unavailable. */
  memoryRefCount?: number;
  onOpenMemories?: () => void;
  accentColor?: string;
}

export default function ChatMemoryAttributionRow({
  memoriesUsed,
  memoryRefCount = 0,
  onOpenMemories,
  accentColor = '#22c55e',
}: Props) {
  const titles = (memoriesUsed || []).filter(Boolean);
  const attributionText = titles.length > 0
    ? `Used memory: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` +${titles.length - 3}` : ''}`
    : memoryRefCount > 0
      ? `Used ${memoryRefCount} saved ${memoryRefCount === 1 ? 'memory' : 'memories'}`
      : null;

  if (!attributionText) return null;

  return (
    <View style={styles.row}>
      {attributionText ? (
        <Pressable
          onPress={onOpenMemories}
          disabled={!onOpenMemories}
          style={({ hovered }: any) => [
            styles.chip,
            hovered && onOpenMemories && { borderColor: accentColor + '66' },
            Platform.OS === 'web' && onOpenMemories && ({ cursor: 'pointer' } as any),
          ]}
        >
          <Text style={styles.chipText} numberOfLines={1}>🧠 {attributionText}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#1b271b',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#0d150d',
    maxWidth: 340,
  },
  chipText: {
    color: '#8e9f8e',
    fontSize: 10,
    fontWeight: '600',
  },
});
