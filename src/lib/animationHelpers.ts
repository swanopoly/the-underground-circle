import { Animated } from 'react-native';

// Web-safe animation loop. Animated.loop() is broken on RN Web (runs once then stops).
// This helper recursively restarts the animation via .start(callback).
export function animLoop(
  factory: () => Animated.CompositeAnimation
): { start: () => void; stop: () => void } {
  let stopped = false;
  const run = () => {
    if (stopped) return;
    factory().start(({ finished }) => {
      if (finished && !stopped) run();
    });
  };
  return {
    start: () => { stopped = false; run(); },
    stop: () => { stopped = true; },
  };
}
