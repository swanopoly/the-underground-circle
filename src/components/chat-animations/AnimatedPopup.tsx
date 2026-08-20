/**
 * AnimatedPopup — restrained, reduced-motion-aware fade for the chat
 * composer's dropdown panels (Model and OpenSwan mode).
 *
 * Drop-in replacement for `<View>` — takes the same `style` prop and
 * passes children through. The legacy `origin` prop remains accepted so
 * existing callers do not need to change; a fade has no transform origin.
 *
 * Native-driver is intentionally left OFF to be compatible with the
 * project-wide `animationPatch.ts` policy on web (which forces
 * useNativeDriver: false). All three animated props work fine without
 * the native driver.
 *
 * Located in `chat-animations/` (sibling of `chat/`) because the
 * `chat/` directory is owned by root and can't be written without
 * sudo. Move when perms are fixed.
 */

import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, StyleProp, ViewStyle } from 'react-native';

export interface AnimatedPopupProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Retained for compatibility with the former scale animation. */
  origin?: 'top' | 'bottom' | 'left' | 'right';
  /** Total fade duration in ms. Default 150. */
  duration?: number;
  /** Any other props (e.g. `className` for RN Web, `nativeID`) — passed
   *  through to the underlying Animated.View. Lets callers keep existing
   *  attrs when swapping `<View>` for `<AnimatedPopup>`. */
  [key: string]: unknown;
}

export default function AnimatedPopup({
  children,
  style,
  origin = 'bottom',
  duration = 150,
  ...rest
}: AnimatedPopupProps) {
  void origin;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    let animation: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => true)
      .then((reduceMotion) => {
        if (cancelled) return;
        if (reduceMotion) {
          opacity.setValue(1);
          return;
        }
        animation = Animated.timing(opacity, {
          toValue: 1,
          duration,
          useNativeDriver: false,
        });
        animation.start();
      });
    return () => {
      cancelled = true;
      animation?.stop();
    };
    // Run only on mount — popups are conditionally rendered so a new
    // mount is always an open. Closing is handled by the parent
    // unmounting us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      {...(rest as any)}
      style={[
        style,
        { opacity },
      ]}
    >
      {children}
    </Animated.View>
  );
}
