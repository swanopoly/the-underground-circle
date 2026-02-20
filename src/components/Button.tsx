import React, { useState } from 'react';
import { Text, StyleSheet, Platform, Pressable, ActivityIndicator } from 'react-native';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: any;
}

export default function Button({ title, onPress, loading, variant = 'primary', disabled, style }: ButtonProps) {
  const [hovered, setHovered] = useState(false);

  const buttonStyles = [
    styles.base,
    variant === 'primary' && styles.primary,
    variant === 'secondary' && styles.secondary,
    variant === 'ghost' && styles.ghost,
    hovered && variant === 'primary' && styles.primaryHovered,
    hovered && variant === 'secondary' && styles.secondaryHovered,
    hovered && variant === 'ghost' && styles.ghostHovered,
    (disabled || loading) && styles.disabled,
    style,
  ];

  const textStyles = [
    styles.text,
    variant === 'primary' && styles.primaryText,
    variant === 'secondary' && styles.secondaryText,
    variant === 'ghost' && styles.ghostText,
  ];

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      disabled={disabled || loading}
      style={buttonStyles}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#0a0a0a' : '#fff'} size="small" />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 10,
    padding: 15,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: 50,
    ...(Platform.OS === 'web' ? { transition: 'all 0.2s ease', cursor: 'pointer' } as any : {}),
  },
  primary: {
    backgroundColor: '#fff',
  },
  primaryHovered: {
    backgroundColor: '#e0e0e0',
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -1 }] } : {}),
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#333',
  },
  secondaryHovered: {
    borderColor: '#555',
    backgroundColor: '#1a1a1a',
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  ghostHovered: {
    backgroundColor: '#1a1a1a',
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
  },
  primaryText: {
    color: '#0a0a0a',
  },
  secondaryText: {
    color: '#fff',
  },
  ghostText: {
    color: '#888',
  },
});
