import React, { useState } from 'react';
import { View, StyleSheet, Platform, Pressable } from 'react-native';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: any;
}

export default function Card({ children, onPress, style }: CardProps) {
  const [hovered, setHovered] = useState(false);

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[styles.card, hovered && styles.cardHovered, style]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { transition: 'all 0.2s ease', cursor: 'default' } as any : {}),
  },
  cardHovered: {
    borderColor: '#444',
    backgroundColor: '#161616',
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -2 }] } : {}),
  },
});
