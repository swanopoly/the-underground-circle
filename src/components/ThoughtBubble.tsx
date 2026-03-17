// Thought Bubble Component - Appears above pixel agents
// Supports detailed text, "Read more" links to articles/posts, and color-coded types
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform, Pressable, Linking } from 'react-native';
import { ThoughtBubble as ThoughtData } from '../lib/agentMessaging';

interface Props {
  thought: ThoughtData | null;
  onDismiss: () => void;
}

export default function ThoughtBubble({ thought, onDismiss }: Props) {
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    if (thought) {
      // Fade in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: Platform.OS !== 'web',
      }).start();

      // Auto-dismiss after duration
      const timer = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: Platform.OS !== 'web',
        }).start(() => {
          onDismiss();
        });
      }, thought.duration);

      return () => clearTimeout(timer);
    }
  }, [thought]);

  if (!thought) return null;

  const typeColors: Record<string, string> = {
    info: '#3b82f6',       // blue — operational, model, cost
    warning: '#f59e0b',    // amber — errors, cost spikes
    success: '#22c55e',    // green — active work
    funny: '#ec4899',      // pink — humor
    idea: '#8b5cf6',       // purple — proactive suggestions
    news: '#06b6d4',       // cyan — tech news, HN, techmeme
    trending: '#f97316',   // orange — X/Twitter trends
    xp: '#fbbf24',         // gold — XP progress, badges
    personality: '#6366f1', // indigo — agent personality
  };

  const bgColor = typeColors[thought.type] || '#666';
  const hasUrl = !!thought.url;
  const isDetailed = thought.text.length > 80;

  // Source label from URL
  const getSourceLabel = (url: string): string => {
    try {
      const host = new URL(url).hostname.replace('www.', '');
      if (host.includes('news.ycombinator')) return 'Hacker News';
      if (host.includes('x.com') || host.includes('twitter.com')) return 'X/Twitter';
      if (host.includes('techmeme')) return 'Techmeme';
      if (host.includes('arxiv')) return 'arXiv';
      if (host.includes('github.com')) return 'GitHub';
      if (host.includes('reddit.com')) return 'Reddit';
      // Return clean domain
      return host.split('.').slice(-2).join('.');
    } catch {
      return 'Read more';
    }
  };

  const handleLinkPress = () => {
    if (!thought.url) return;
    if (Platform.OS === 'web') {
      window.open(thought.url, '_blank', 'noopener');
    } else {
      Linking.openURL(thought.url).catch(() => {});
    }
  };

  return (
    <Animated.View style={[styles.container, isDetailed && styles.containerWide, { opacity: fadeAnim }]}>
      <View style={[styles.bubble, { borderColor: bgColor }]}>
        {/* Type indicator dot */}
        <View style={styles.header}>
          <View style={[styles.typeDot, { backgroundColor: bgColor }]} />
          <Text style={[styles.typeLabel, { color: bgColor }]}>
            {thought.type.toUpperCase()}
          </Text>
        </View>
        {/* Main thought text */}
        <Text style={[styles.text, isDetailed && styles.textDetailed]}>{thought.text}</Text>
        {/* Read more link */}
        {hasUrl && (
          <Pressable onPress={handleLinkPress} style={styles.linkRow}>
            <Text style={[styles.linkText, { color: bgColor }]}>
              {getSourceLabel(thought.url!)} →
            </Text>
          </Pressable>
        )}
      </View>
      {/* Speech bubble tail */}
      <View style={[styles.tail, { borderTopColor: bgColor }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: -20,
    zIndex: 100,
    minWidth: 160,
    maxWidth: 220,
  },
  containerWide: {
    maxWidth: 280,
  },
  bubble: {
    backgroundColor: '#000000f0',
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  typeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  typeLabel: {
    fontSize: 6,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.5,
    opacity: 0.8,
  },
  text: {
    fontSize: 8.5,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    lineHeight: 12,
  },
  textDetailed: {
    fontSize: 8,
    lineHeight: 11.5,
    color: '#cbd5e1',
  },
  linkRow: {
    marginTop: 4,
    paddingTop: 3,
    borderTopWidth: 0.5,
    borderTopColor: '#333',
  },
  linkText: {
    fontSize: 7.5,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  tail: {
    width: 0,
    height: 0,
    marginLeft: 30,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
