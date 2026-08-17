import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const evolution = read('src/components/rpg/AgentEvolutionCard.tsx');
const flame = read('src/components/rpg/StreakFlame.tsx');

let assertions = 0;
const check = (condition: unknown, message: string): void => {
  assertions += 1;
  assert.ok(condition, message);
};

for (const [name, source] of [['Evolution card', evolution], ['Streak flame', flame]] as const) {
  check(
    source.includes('AccessibilityInfo.isReduceMotionEnabled()')
      && source.includes("AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion)")
      && source.includes('const [reduceMotion, setReduceMotion] = useState(true)')
      && source.includes('if (mounted) setReduceMotion(true)')
      && source.includes('subscription.remove()'),
    `${name} starts static, follows the live platform preference, and fails safely to static motion`,
  );
}

check(
  evolution.includes('if (reduceMotion) {\n      fillAnim.setValue(progress);\n      return;\n    }')
    && evolution.includes('if (reduceMotion) {\n      entranceAnim.setValue(1);\n      return;\n    }'),
  'reduced motion renders the final XP fill and fully visible card without entrance motion',
);
check(
  (evolution.match(/reduceMotion=\{reduceMotion\}/g) || []).length === 2,
  'both Bond and Mastery bars receive the same platform motion preference',
);
check(
  evolution.includes('fillAnim.stopAnimation()')
    && evolution.includes('entranceAnim.stopAnimation()')
    && evolution.includes('return () => fillAnimation.stop()')
    && evolution.includes('return () => entranceAnimation.stop()'),
  'Evolution cancels in-flight transitions when preferences change or the card unmounts',
);
check(
  !evolution.includes('shimmer') && !evolution.includes('Animated.loop('),
  'the unused continuous shimmer loop is removed rather than consuming motion or CPU invisibly',
);

const staticResetIndex = flame.indexOf('// Static values preserve tier, flame colors, core, ring, and day count');
const reducedGuardIndex = flame.indexOf('if (reduceMotion) return;');
const firstLoopIndex = flame.indexOf('startLoop(Animated.loop(');
check(
  staticResetIndex >= 0
    && reducedGuardIndex > staticResetIndex
    && firstLoopIndex > reducedGuardIndex,
  'the flame resets to a deterministic static pose before any continuous loop can start',
);
check(
  flame.includes('pulseScale.setValue(1)')
    && flame.includes('flicker.setValue(0.5)')
    && flame.includes('coreGlow.setValue(0.8)')
    && flame.includes('ringRotate.setValue(0)')
    && flame.includes('floatY.setValue(0)')
    && flame.includes('ember.opacity.setValue(0)'),
  'reduced motion leaves a stable flame, glow, core, ring, and hidden embers',
);
check(
  flame.includes('const runningAnimations: Animated.CompositeAnimation[] = []')
    && flame.includes('for (const animation of runningAnimations) animation.stop()')
    && flame.includes('value.stopAnimation()')
    && flame.includes('ember.opacity.stopAnimation()'),
  'all base, tier, ring, and ember loops are stopped across preference and lifecycle changes',
);
check(
  flame.includes("accessibilityLabel={`${streakDays} day streak, ${tier} flame`}")
    && flame.includes("{tier === 'legendary' && (")
    && flame.includes("{(tier === 'epic' || tier === 'legendary') && (")
    && flame.includes('{streakDays}</Text>'),
  'static mode preserves tier meaning, legendary/core details, and the visible streak count',
);
check(
  flame.includes('if (reduceMotion) return;')
    && flame.includes('startLoop(Animated.loop('),
  'continuous flame motion remains available only after the reduced-motion guard',
);

console.log(`office Agent Evolution reduced-motion smoke passed (${assertions} assertions)`);
