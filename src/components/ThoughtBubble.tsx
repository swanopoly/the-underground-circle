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
    bottom: 80,
    left: -20,
    zIndex: 100,
    minWidth: 130,
    maxWidth: 170,
  },
  bubble: {
    backgroundColor: '#0a0a10ee',
    borderWidth: 1.5,
    borderRadius: 8,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  text: {
    fontSize: 8,
    color: '#fff',
    fontFamily: 'monospace',
    lineHeight: 11,
  },
  tail: {
    width: 0,
    height: 0,
    marginLeft: 15,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 7,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
