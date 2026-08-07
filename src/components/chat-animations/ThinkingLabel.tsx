/**
 * ThinkingLabel — rainbow-flag verb label with synchronized word bounce
 * and a smooth cross-fade between adjectives. Pairs with `ThinkingDots`.
 *
 * Three layered animations on each rendered verb (web):
 *
 *  1. **Rainbow flag fill** — the text itself is transparent and painted
 *     with a moving linear-gradient of the 6 Pride-flag colors
 *     (red → orange → yellow → green → blue → violet). `background-size`
 *     is 200% so the gradient can slide past the text box, producing
 *     a continuous flash of color without any discrete frame.
 *
 *  2. **Whole-word bounce** — a single `translateY` animation on the
 *     wrapper so every letter moves together, not a per-letter ripple.
 *
 *  3. **Cross-fade on swap** — when the `text` prop changes, the old
 *     verb fades out while the new verb fades in, stacked in the same
 *     box so the transition is smooth with no reflow.
 *
 * Native fallback (mobile): a single Animated.Text with a color swap
 * cycle + opacity cross-fade. No gradient (React Native doesn't support
 * background-clip: text without extra packages) but the color-cycling
 * still reads as a rainbow.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Text, TextStyle, StyleProp, View } from 'react-native';

export interface ThinkingLabelProps {
  text: string;
  /** Ignored on web — verb renders solid amber with a shimmer band
   *  sliding across. Respected on native for the fallback. Default
   *  amber. */
  color?: string;
  /** Font size. Default 13 — smaller, quieter presence. */
  fontSize?: number;
  style?: StyleProp<TextStyle>;
}

// Amber base color + a brief brighter highlight that sweeps across the
// letters to fake a "light catching the surface" shimmer. The whole
// text reads as the amber rgb(245, 158, 11); the highlight is just a
// narrow band that slides past without changing the underlying hue.
const AMBER_BASE = 'rgb(245, 158, 11)';
const AMBER_HIGHLIGHT = '#fff3c8'; // very pale cream — the glint color

// Idempotent CSS install. Runs once on first mount.
function ensureVerbRainbowStyles() {
  if (typeof document === 'undefined') return;
  const ID = 'uc-verb-rainbow-style';
  if (document.getElementById(ID)) return;
  const el = document.createElement('style');
  el.id = ID;
  el.textContent = `
/* Shimmer: the verb is mostly solid amber; a narrow bright band
 * slides across the text every 2.4s to read as light glinting off
 * the letters. background-size:300% gives the highlight a full pass
 * from off-screen right to off-screen left. */
@keyframes uc-verb-shimmer {
  0%   { background-position: 200% 0; }
  60%  { background-position: -100% 0; }
  100% { background-position: -100% 0; }
}
/* Cross-fade animations — OPACITY ONLY. No translateY on these;
 * layering vertical motion on top of the shimmer causes the snap
 * at handoff. Smooth fade is enough to read as a clean swap. */
@keyframes uc-verb-in {
  0%   { opacity: 0; }
  100% { opacity: 1; }
}
@keyframes uc-verb-out {
  0%   { opacity: 1; }
  100% { opacity: 0; }
}
`;
  document.head.appendChild(el);
}

const CROSSFADE_MS = 480;

function WebThinkingLabel({
  text,
  fontSize = 13,
}: ThinkingLabelProps) {
  useEffect(() => {
    ensureVerbRainbowStyles();
  }, []);

  // Cross-fade two verb layers, both gradient-painted.
  // We drop into raw DOM (`createElement('span')`) so RN Web's Text
  // style synthesis can't override `color: transparent` with its own
  // default text color — which was silently turning the whole thing
  // black. The span inherits font from the document body (system
  // stack via pixelDesign.ts).
  const [displayText, setDisplayText] = useState(text);
  const [prevText, setPrevText] = useState<string | null>(null);

  useEffect(() => {
    if (text === displayText) return;
    setPrevText(displayText);
    setDisplayText(text);
    const timer = setTimeout(() => setPrevText(null), CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [text, displayText]);

  // Shimmer gradient: mostly amber with a narrow brighter slice
  // around 50%. background-size 300% means the slice has off-screen
  // room to glide from right to left.
  const shimmer = `linear-gradient(100deg, ${AMBER_BASE} 0%, ${AMBER_BASE} 40%, ${AMBER_HIGHLIGHT} 50%, ${AMBER_BASE} 60%, ${AMBER_BASE} 100%)`;

  const baseSpanStyle: React.CSSProperties = {
    fontSize,
    fontWeight: 700,
    letterSpacing: 0.3,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    display: 'inline-block',
    backgroundImage: shimmer,
    backgroundSize: '300% 100%',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    willChange: 'background-position',
  };

  return React.createElement(
    'div',
    {
      style: {
        position: 'relative',
        minHeight: fontSize * 1.4,
        display: 'flex',
        alignItems: 'center',
      },
    },
    prevText
      ? React.createElement(
          'span',
          {
            key: `prev-${prevText}`,
            style: {
              ...baseSpanStyle,
              position: 'absolute',
              left: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              animation: `uc-verb-out ${CROSSFADE_MS}ms ease-in-out forwards, uc-verb-shimmer 2.4s ease-in-out infinite`,
            } as any,
          },
          prevText,
        )
      : null,
    React.createElement(
      'span',
      {
        key: `cur-${displayText}`,
        style: {
          ...baseSpanStyle,
          animation: `uc-verb-in ${CROSSFADE_MS}ms ease-in-out forwards, uc-verb-shimmer 2.4s ease-in-out infinite`,
        } as any,
      },
      displayText,
    ),
  );
}

function NativeThinkingLabel({
  text,
  color = AMBER_BASE,
  fontSize = 13,
  style,
}: ThinkingLabelProps) {
  // Solid amber + opacity cross-fade on swap.
  // Shimmer via background-clip:text isn't portable to native, so we
  // just hold the solid color and rely on the cross-fade for motion.
  const opacity = useRef(new Animated.Value(1)).current;
  const lastTextRef = useRef(text);

  useEffect(() => {
    if (lastTextRef.current === text) return;
    lastTextRef.current = text;
    opacity.setValue(0.15);
    Animated.timing(opacity, { toValue: 1, duration: CROSSFADE_MS, useNativeDriver: false }).start();
  }, [text, opacity]);

  return (
    <Animated.Text
      style={[
        {
          color: color || AMBER_BASE,
          fontSize,
          fontWeight: '700',
          letterSpacing: 0.3,
          opacity,
        },
        style,
      ]}
    >
      {text}
    </Animated.Text>
  );
}

/**
 * Keep platform implementations in separate components so every mounted
 * component has one unconditional hook order. The former in-component web
 * return caused React's `Expected static flag was missing` development error
 * during Chat's animated task label lifecycle.
 */
export default function ThinkingLabel(props: ThinkingLabelProps) {
  return Platform.OS === 'web'
    ? <WebThinkingLabel {...props} />
    : <NativeThinkingLabel {...props} />;
}
