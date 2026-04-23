/**
 * AnimatedPopup — fade + snap mount animation for the chat composer's
 * dropdown panels (Model / Actions / OpenSwan mode). Gives each popup
 * a quick ~150ms fade-in while scaling from 0.97 → 1 and translating
 * up 6px → 0, so the dropdown feels like it's emerging from the button
 * below rather than appearing out of nowhere.
 *
 * Drop-in replacement for `<View>` — takes the same `style` prop and
 * passes children through. Also accepts an `origin` prop (default
 * 'bottom') that controls transform-origin on web so the snap lands
 * at the right anchor point visually.
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
import { Animated, Platform, StyleProp, ViewStyle } from 'react-native';

export interface AnimatedPopupProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Which edge of the popup is anchored to the triggering button.
   *  Controls web transform-origin so the scale feels like it's
   *  emanating from the button. Default 'bottom' (popup opens upward
   *  above the composer row). */
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
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.97)).current;
  const translateY = useRef(new Animated.Value(origin === 'top' ? -6 : 6)).current;

  useEffect(() => {
    // Parallel: quick opacity timing + snappy spring on scale/translate.
    // High tension + low friction = "snap into place" feel; duration on
    // opacity keeps the fade independent so it reads as quick even if
    // the spring overshoots slightly.
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        useNativeDriver: false,
      }),
      Animated.spring(scale, {
        toValue: 1,
        tension: 180,
        friction: 14,
        useNativeDriver: false,
      }),
      Animated.spring(translateY, {
        toValue: 0,
        tension: 180,
        friction: 14,
        useNativeDriver: false,
      }),
    ]).start();
    // Run only on mount — popups are conditionally rendered so a new
    // mount is always an open. Closing is handled by the parent
    // unmounting us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Web transform-origin so the scale animation feels like it's
  // growing from the triggering button. Maps the `origin` prop to the
  // CSS equivalent. No-op on native (native scales around center).
  const webOriginStyle = Platform.OS === 'web' ? ({
    transformOrigin:
      origin === 'bottom' ? 'bottom center' :
      origin === 'top'    ? 'top center' :
      origin === 'left'   ? 'center left' :
                            'center right',
  } as any) : null;

  return (
    <Animated.View
      {...(rest as any)}
      style={[
        style,
        webOriginStyle,
        {
          opacity,
          transform: [{ scale }, { translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
