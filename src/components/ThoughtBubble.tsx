// Thought Bubble Component - Appears above pixel agents
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Platform } from 'react-native';
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

  const typeColors = {
    info: '#3b82f6',
    warning: '#f59e0b',
    success: '#22c55e',
    funny: '#ec4899',
    idea: '#8b5cf6',
  };

  const bgColor = typeColors[thought.type] || '#666';

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <View style={[styles.bubble, { borderColor: bgColor }]}>
        <Text style={styles.text}>{thought.text}</Text>
      </View>
      {/* Speech bubble tail */}
      <View style={[styles.tail, { borderTopColor: bgColor }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 55, // Above agent sprite
    left: -20,
    zIndex: 100,
    minWidth: 180,
    maxWidth: 240,
  },
  bubble: {
    backgroundColor: '#0a0a10ee',
    borderWidth: 2,
    borderRadius: 12,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  text: {
    fontSize: 10,
    color: '#fff',
    fontFamily: 'monospace',
    lineHeight: 14,
  },
  tail: {
    width: 0,
    height: 0,
    marginLeft: 20,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
