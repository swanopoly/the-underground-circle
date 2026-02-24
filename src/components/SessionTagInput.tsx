// Session Tag Input Component
// Quick tag input for sessions with auto-complete

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView, Platform,
} from 'react-native';
import {
  SessionTag, TAG_CATEGORIES, TagCategory,
  parseTagString, createTag, loadTagSuggestions,
} from '../lib/sessionTags';

interface Props {
  sessionKey: string;
  currentTags: SessionTag[];
  onAddTag: (tag: SessionTag) => void;
  onRemoveTag: (tagKey: string) => void;
}

export default function SessionTagInput({ sessionKey, currentTags, onAddTag, onRemoveTag }: Props) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<SessionTag[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Load suggestions on mount
  useEffect(() => {
    loadTagSuggestions().then(setSuggestions);
  }, []);

  // Filter suggestions based on input
  const filteredSuggestions = input.trim()
    ? suggestions.filter(s => 
        s.key.toLowerCase().includes(input.toLowerCase()) ||
        s.label.toLowerCase().includes(input.toLowerCase())
      ).filter(s => 
        // Don't show already-added tags
        !currentTags.some(ct => ct.key === s.key)
      ).slice(0, 5)
    : [];

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const parsed = parseTagString(trimmed);
    if (parsed) {
      const tag = createTag(parsed.category, parsed.value);
      onAddTag(tag);
      setInput('');
      setShowSuggestions(false);
    }
  };

  const handleSelectSuggestion = (tag: SessionTag) => {
    onAddTag(tag);
    setInput('');
    setShowSuggestions(false);
  };

  const handleQuickTag = (category: TagCategory) => {
    setInput(`${category}:`);
    setShowSuggestions(true);
  };

  return (
    <View style={styles.container}>
      {/* Current Tags */}
      {currentTags.length > 0 && (
        <View style={styles.tagsRow}>
          {currentTags.map(tag => (
            <View key={tag.key} style={[styles.tag, { borderColor: tag.color + '60', backgroundColor: tag.color + '15' }]}>
              <Text style={[styles.tagText, { color: tag.color }]}>{tag.label}</Text>
              <Pressable
                onPress={() => onRemoveTag(tag.key)}
                style={[styles.tagRemove, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={[styles.tagRemoveText, { color: tag.color }]}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      {/* Input Row */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={(text) => {
            setInput(text);
            setShowSuggestions(text.trim().length > 0);
          }}
          onSubmitEditing={handleSubmit}
          placeholder="Add tag (e.g., project:website)"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          onPress={handleSubmit}
          style={[styles.addBtn, !input.trim() && { opacity: 0.4 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          disabled={!input.trim()}
        >
          <Text style={styles.addBtnText}>+</Text>
        </Pressable>
      </View>

      {/* Quick Tag Buttons */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickTagsScroll}>
        <View style={styles.quickTags}>
          {(Object.keys(TAG_CATEGORIES) as TagCategory[]).map(category => {
            const meta = TAG_CATEGORIES[category];
            return (
              <Pressable
                key={category}
                onPress={() => handleQuickTag(category)}
                style={[styles.quickTag, { borderColor: meta.color + '40' }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={styles.quickTagIcon}>{meta.icon}</Text>
                <Text style={[styles.quickTagText, { color: meta.color }]}>{meta.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Suggestions Dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          {filteredSuggestions.map(suggestion => (
            <Pressable
              key={suggestion.key}
              onPress={() => handleSelectSuggestion(suggestion)}
              style={[styles.suggestion, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <View style={[styles.suggestionDot, { backgroundColor: suggestion.color }]} />
              <Text style={styles.suggestionText}>{suggestion.label}</Text>
              <Text style={styles.suggestionKey}>{suggestion.key}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Help Text */}
      <Text style={styles.helpText}>
        💡 Format: category:value (e.g., "project:website", "client:acme", "priority:high")
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },

  // Current tags
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  tagRemove: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff10',
  },
  tagRemoveText: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 14,
  },

  // Input
  inputRow: {
    flexDirection: 'row',
    gap: 6,
  },
  input: {
    flex: 1,
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 12,
    color: '#fff',
    fontFamily: 'monospace',
  },
  addBtn: {
    width: 44,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    fontSize: 20,
    color: '#fff',
    fontWeight: '700',
  },

  // Quick tags
  quickTagsScroll: {
    marginTop: -4,
  },
  quickTags: {
    flexDirection: 'row',
    gap: 6,
  },
  quickTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: '#0a0a10',
  },
  quickTagIcon: {
    fontSize: 10,
  },
  quickTagText: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // Suggestions
  suggestions: {
    backgroundColor: '#0a0a10',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 8,
    overflow: 'hidden',
    maxHeight: 200,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  suggestionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  suggestionText: {
    fontSize: 11,
    color: '#ddd',
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  suggestionKey: {
    fontSize: 9,
    color: '#666',
    fontFamily: 'monospace',
    marginLeft: 'auto',
  },

  // Help
  helpText: {
    fontSize: 9,
    color: '#666',
    fontFamily: 'monospace',
    fontStyle: 'italic',
    lineHeight: 14,
  },
});
