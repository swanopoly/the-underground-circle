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
  let generation = 0;
  let activeAnimation: Animated.CompositeAnimation | null = null;

  const run = (activeGeneration: number) => {
    if (stopped || activeGeneration !== generation) return;
    // Office ambience uses this helper extensively. Honor the browser-level
    // motion preference before starting each cycle so decorative loops settle
    // without changing the underlying content or interaction state.
    if (prefersReducedMotion()) {
      stopped = true;
      return;
    }
    const animation = factory();
    activeAnimation = animation;
    animation.start(({ finished }) => {
      if (activeAnimation === animation) activeAnimation = null;
      if (finished && !stopped && activeGeneration === generation) run(activeGeneration);
    });
  };
  return {
    start: () => {
      // Retire the prior generation before stopping it. Some Animated
      // implementations invoke their completion callback synchronously from
      // `stop()`; fencing first prevents that callback from starting a
      // replacement cycle while this start is still in progress.
      stopped = true;
      generation += 1;
      const animation = activeAnimation;
      activeAnimation = null;
      animation?.stop();
      stopped = false;
      run(generation);
    },
    stop: () => {
      stopped = true;
      generation += 1;
      const animation = activeAnimation;
      activeAnimation = null;
      animation?.stop();
    },
  };
}
