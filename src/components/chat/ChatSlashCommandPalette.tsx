import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getChatSlashCategoryLabel, type ChatSlashCommand } from '../../lib/chatSlashCommands';

type ChatSlashCommandPaletteProps = {
  accentColor: string;
  commands: ChatSlashCommand[];
  highlightedIndex: number;
  onHighlightIndexChange: (index: number) => void;
  onSelect: (command: ChatSlashCommand) => void;
  variant?: 'default' | 'compact';
};

export default function ChatSlashCommandPalette({
  accentColor,
  commands,
  highlightedIndex,
  onHighlightIndexChange,
  onSelect,
  variant = 'default',
}: ChatSlashCommandPaletteProps) {
  const compact = variant === 'compact';

  return (
    <View style={[styles.popup, compact ? styles.popupCompact : styles.popupDefault]}>
      <View style={styles.header}>
        <Text style={[styles.headerText, compact && styles.headerTextCompact]}>SLASH COMMANDS</Text>
        <Text style={[styles.headerHint, compact && styles.headerHintCompact]}>
          {commands.length} total • ↵ select • ↑↓ navigate
        </Text>
      </View>
      <ScrollView style={[styles.list, compact && styles.listCompact]} keyboardShouldPersistTaps="handled">
        {commands.map((command, index) => {
          const isActive = index === highlightedIndex;
          const previousCategory = index > 0 ? commands[index - 1]?.category : null;
          const showCategoryDivider = index === 0 || previousCategory !== command.category;

          return (
            <React.Fragment key={command.id}>
              {showCategoryDivider && (
                <View style={[styles.categoryDivider, compact && styles.categoryDividerCompact]}>
                  <Text style={styles.categoryDividerText}>{getChatSlashCategoryLabel(command.category)}</Text>
                </View>
              )}
              <Pressable
                onPress={() => onSelect(command)}
                onHoverIn={() => onHighlightIndexChange(index)}
                style={[
                  styles.item,
                  compact ? styles.itemCompact : styles.itemDefault,
                  isActive && { borderColor: `${accentColor}${compact ? '50' : '60'}`, backgroundColor: `${accentColor}10` },
                  Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                ]}
              >
                <View style={styles.main}>
                  <View style={styles.topRow}>
                    <Text style={[styles.name, compact && styles.nameCompact, isActive && { color: accentColor }]}>
                      {command.command}
                    </Text>
                    <Text style={[styles.category, compact && styles.categoryCompact]}>
                      {getChatSlashCategoryLabel(command.category)}
                    </Text>
                  </View>
                  <Text style={[styles.title, compact && styles.titleCompact]}>{command.title}</Text>
                  <Text style={[styles.description, compact && styles.descriptionCompact]}>{command.description}</Text>
                </View>
              </Pressable>
            </React.Fragment>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  popup: {
    backgroundColor: '#0b0b12f2',
    borderWidth: 1,
    borderColor: '#232338',
    overflow: 'hidden',
  },
  popupDefault: {
    borderRadius: 16,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(14px)', boxShadow: '0 20px 48px rgba(0,0,0,0.45)' } as any) : {}),
  },
  popupCompact: {
    borderRadius: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 8,
    paddingTop: 8,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a28',
  },
  headerText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#7d7d95',
    letterSpacing: 1.2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  headerTextCompact: {
    fontSize: 9,
  },
  headerHint: {
    fontSize: 10,
    color: '#56566c',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  headerHintCompact: {
    fontSize: 9,
  },
  list: {
    maxHeight: 360,
  },
  listCompact: {
    maxHeight: 220,
  },
  categoryDivider: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 4,
  },
  categoryDividerCompact: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 2,
  },
  categoryDividerText: {
    color: '#66667d',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  itemDefault: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 6,
    borderRadius: 12,
  },
  itemCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 4,
    borderRadius: 10,
  },
  main: {
    flex: 1,
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    fontSize: 12,
    fontWeight: '700',
    color: '#f0f0f5',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  nameCompact: {
    fontSize: 11,
  },
  category: {
    fontSize: 9,
    color: '#6c6c84',
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  categoryCompact: {
    fontSize: 8,
    letterSpacing: 0.8,
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#d6d6e4',
  },
  titleCompact: {
    fontSize: 10,
    fontWeight: '700',
  },
  description: {
    fontSize: 11,
    color: '#80809a',
    lineHeight: 16,
  },
  descriptionCompact: {
    fontSize: 10,
    lineHeight: 14,
  },
});
