import React, { useState } from 'react';
import { Text, StyleSheet, Platform, Pressable, ActivityIndicator } from 'react-native';
import { PIXEL_COLORS, GRID } from '../lib/pixelDesign';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: any;
}

export default function Button({ title, onPress, loading, variant = 'primary', disabled, style }: ButtonProps) {
  const [pressed, setPressed] = useState(false);

  const buttonStyles = [
    styles.base,
    variant === 'primary' && styles.primary,
    variant === 'secondary' && styles.secondary,
    variant === 'ghost' && styles.ghost,
    pressed && variant === 'primary' && styles.primaryPressed,
    pressed && variant === 'secondary' && styles.secondaryPressed,
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
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled || loading}
      style={buttonStyles}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? PIXEL_COLORS.bg0 : '#fff'} size="small" />
      ) : (
        <Text style={textStyles}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 2,
    padding: GRID.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    minHeight: 48,
    borderWidth: 2,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  // Primary — raised pixel button (light top-left, dark bottom-right)
  primary: {
    backgroundColor: '#fff',
    borderTopColor: '#ffffff',
    borderLeftColor: '#ffffff',
    borderRightColor: '#888888',
    borderBottomColor: '#888888',
  },
  primaryPressed: {
    borderTopColor: '#888888',
    borderLeftColor: '#888888',
    borderRightColor: '#ffffff',
    borderBottomColor: '#ffffff',
  },
  // Secondary — outlined pixel button
  secondary: {
    backgroundColor: 'transparent',
    borderTopColor: PIXEL_COLORS.border2,
    borderLeftColor: PIXEL_COLORS.border2,
    borderRightColor: PIXEL_COLORS.bg0,
    borderBottomColor: PIXEL_COLORS.bg0,
  },
  secondaryPressed: {
    borderTopColor: PIXEL_COLORS.bg0,
    borderLeftColor: PIXEL_COLORS.bg0,
    borderRightColor: PIXEL_COLORS.border2,
    borderBottomColor: PIXEL_COLORS.border2,
  },
  // Ghost
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  disabled: {
    opacity: 0.4,
  },
  text: {
    fontSize: 12,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
  primaryText: {
    color: PIXEL_COLORS.bg0,
  },
  secondaryText: {
    color: '#fff',
  },
  ghostText: {
    color: PIXEL_COLORS.text2,
  },
});
