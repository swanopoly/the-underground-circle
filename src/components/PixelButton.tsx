// Pixel Button Component - Retro-styled action buttons
import React, { useState } from 'react';
import { Pressable, Text, StyleSheet, View, Platform } from 'react-native';

interface Props {
  icon: string;
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  badge?: string | number;
}

export default function PixelButton({
  icon,
  label,
  onPress,
  color = '#6366f1',
  disabled = false,
  size = 'medium',
  badge,
}: Props) {
  const [pressed, setPressed] = useState(false);

  const sizeStyles = {
    small: {
      button: { paddingHorizontal: 8, paddingVertical: 6, minWidth: 60 },
      icon: { fontSize: 14 },
      label: { fontSize: 8 },
      badge: { width: 12, height: 12, fontSize: 7 },
    },
    medium: {
      button: { paddingHorizontal: 12, paddingVertical: 8, minWidth: 80 },
      icon: { fontSize: 18 },
      label: { fontSize: 9 },
      badge: { width: 14, height: 14, fontSize: 8 },
    },
    large: {
      button: { paddingHorizontal: 16, paddingVertical: 10, minWidth: 100 },
      icon: { fontSize: 22 },
      label: { fontSize: 10 },
      badge: { width: 16, height: 16, fontSize: 9 },
    },
  };

  const currentSize = sizeStyles[size];

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      style={[
        styles.button,
        currentSize.button,
        {
          backgroundColor: disabled ? '#333' : pressed ? color : color + 'dd',
          borderColor: color,
          borderBottomColor: pressed ? color + '66' : color,
          borderRightColor: pressed ? color + '66' : color,
          transform: pressed ? [{ translateY: 2 }] : [{ translateY: 0 }],
        },
        disabled && styles.disabled,
        Platform.OS === 'web' && !disabled && { cursor: 'pointer' } as any,
      ]}
    >
      {badge !== undefined && (
        <View style={[styles.badge, currentSize.badge, { backgroundColor: '#ef4444' }]}>
          <Text style={[styles.badgeText, { fontSize: currentSize.badge.fontSize }]}>
            {typeof badge === 'number' && badge > 9 ? '9+' : badge}
          </Text>
        </View>
      )}
      
      <Text style={[styles.icon, currentSize.icon, disabled && styles.disabledText]}>
        {icon}
      </Text>
      
      <Text
        style={[styles.label, currentSize.label, disabled && styles.disabledText]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRadius: 6,
    gap: 2,
    position: 'relative',
    // Pixel-art shadow effect
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 0,
  },
  disabled: {
    opacity: 0.5,
  },
  icon: {
    fontWeight: '700',
  },
  label: {
    color: '#fff',
    fontFamily: 'monospace',
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  disabledText: {
    color: '#666',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  badgeText: {
    color: '#fff',
    fontWeight: '900',
    fontFamily: 'monospace',
  },
});
