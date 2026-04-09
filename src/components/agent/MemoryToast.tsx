/**
 * MemoryToast — Non-blocking notification for memory events.
 * Shows briefly at the bottom of the screen when memories are saved/updated.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, Platform, Pressable } from 'react-native';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

interface Props {
  message: string;
  type?: 'saved' | 'updated' | 'conflict' | 'forgotten';
  onDismiss: () => void;
  onPress?: () => void;
  duration?: number;
}

export default function MemoryToast({ message, type = 'saved', onDismiss, onPress, duration = 3000 }: Props) {
  const slideAnim = useRef(new Animated.Value(50)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 50, duration: 200, useNativeDriver: true }),
        Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => onDismiss());
    }, duration);

    return () => clearTimeout(timer);
  }, []);

  const colors = {
    saved: { bg: '#22c55e', border: '#22c55e30', text: '#22c55e' },
    updated: { bg: '#6366f1', border: '#6366f130', text: '#6366f1' },
    conflict: { bg: '#f59e0b', border: '#f59e0b30', text: '#f59e0b' },
    forgotten: { bg: '#ef4444', border: '#ef444430', text: '#ef4444' },
  };
  const c = colors[type];

  return (
    <Animated.View style={{
      position: 'absolute', bottom: 80, left: 16, right: 16, zIndex: 100,
      transform: [{ translateY: slideAnim }], opacity: opacityAnim,
    }}>
      <Pressable
        onPress={onPress || onDismiss}
        style={[{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: '#0a0a10', borderWidth: 1, borderColor: c.border,
          borderRadius: 2, paddingHorizontal: 12, paddingVertical: 8,
          ...(Platform.OS === 'web' ? { boxShadow: `0 4px 12px ${c.bg}15` } as any : {}),
        }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
      >
        <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: c.bg + '20', justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: c.text, fontSize: 8, fontWeight: '800' }}>
            {type === 'saved' ? 'M' : type === 'updated' ? 'U' : type === 'conflict' ? '!' : 'X'}
          </Text>
        </View>
        <Text style={{ color: c.text, fontSize: 10, fontFamily: MONO, flex: 1 }}>{message}</Text>
        <Text style={{ color: '#3a3a4e', fontSize: 8, fontFamily: MONO }}>tap to view</Text>
      </Pressable>
    </Animated.View>
  );
}
