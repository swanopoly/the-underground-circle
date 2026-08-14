import { Animated } from 'react-native';

function prefersReducedMotion(): boolean {
  try {
    const matcher = (globalThis as any)?.matchMedia;
    return typeof matcher === 'function'
      && matcher.call(globalThis, '(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

// Web-safe animation loop. Animated.loop() is broken on RN Web (runs once then stops).
// This helper recursively restarts the animation via .start(callback).
export function animLoop(
  factory: () => Animated.CompositeAnimation
): { start: () => void; stop: () => void } {
  let stopped = false;
  const run = () => {
    if (stopped) return;
    // Office ambience uses this helper extensively. Honor the browser-level
    // motion preference before starting each cycle so decorative loops settle
    // without changing the underlying content or interaction state.
    if (prefersReducedMotion()) {
      stopped = true;
      return;
    }
    factory().start(({ finished }) => {
      if (finished && !stopped) run();
    });
  };
  return {
    start: () => { stopped = false; run(); },
    stop: () => { stopped = true; },
  };
}
