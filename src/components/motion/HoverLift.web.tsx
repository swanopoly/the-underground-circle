/**
 * HoverLift — Web-only hover effect: lifts element up with shadow on hover.
 *
 * On native platforms, renders children without any hover effect.
 * Uses CSS transition via inline styles (Platform.OS === 'web').
 */

import React, { useState } from 'react';
import { View, Platform, Pressable } from 'react-native';

interface Props {
  children: React.ReactNode;
  liftPx?: number;
  accentColor?: string;
}

export default function HoverLift({
  children,
  liftPx = 2,
  accentColor = '#6366f1',
}: Props) {
  const [hovered, setHovered] = useState(false);

  if (Platform.OS !== 'web') {
    return <View>{children}</View>;
  }

  const baseStyle: any = {
    transition: 'transform 200ms cubic-bezier(0.25, 0.46, 0.45, 0.94), box-shadow 200ms ease',
    transform: hovered ? `translateY(-${liftPx}px)` : 'translateY(0px)',
    boxShadow: hovered
      ? `0 ${liftPx + 2}px ${(liftPx + 2) * 3}px -${liftPx}px ${accentColor}22`
      : '0 0 0 0 transparent',
  };

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={baseStyle}
    >
      {children}
    </Pressable>
  );
}
