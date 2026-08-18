import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const shell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const terminal = read('src/screens/circles/tabs/office/AgentTerminalPanels.tsx');

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  assert.ok(condition, message);
};

check(
  panel.includes('const [reduceMotionPreference, setReduceMotionPreference] = useState<boolean | null>(null);')
    && panel.includes('const reduceMotion = reduceMotionPreference !== false;'),
  'unknown native motion preference defaults to static presentation',
);
check(
  panel.includes('if (mounted) setReduceMotionPreference(true);')
    && panel.includes("AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotionPreference)"),
  'failed preference reads fail static and live preference changes remain subscribed',
);
check(
  panel.includes('const panelAnimationRef = useRef<Animated.CompositeAnimation | null>(null);')
    && panel.includes('panelAnimationRef.current?.stop();')
    && panel.includes('scaleAnim.stopAnimation();')
    && panel.includes('opacityAnim.stopAnimation();')
    && panel.includes('slideAnim.stopAnimation();'),
  'every panel animation is retained and all animated values have explicit stop paths',
);
check(
  panel.includes('const isOpening = !!agent && !wasOpen;')
    && panel.includes('if (reduceMotion || !isOpening) {\n          slideAnim.setValue(0);'),
  'a late non-reduced preference result cannot replay entrance motion on an already open sheet',
);
check(
  panel.includes('startPanelAnimation(Animated.spring(slideAnim, {')
    && !panel.includes('startPanelAnimation(Animated.parallel([')
    && panel.includes('not claim or start an invisible close animation')
    && !panel.includes('}).start();'),
  'native entrance uses the retained animation owner while parent-owned close stays immediate and truthful',
);
check(
  panel.includes('stopPanelAnimation();\n    };')
    && panel.includes('[agent, isDesktop, reduceMotion, setBackdropOn, startPanelAnimation, stopPanelAnimation]'),
  'preference changes and unmount stop the currently running animation',
);
check(
  panel.includes('reduceMotion={reduceMotion}')
    && shell.includes('reduceMotion: boolean;')
    && shell.includes("animationType={reduceMotion ? 'none' : 'fade'}"),
  'the fail-static preference also owns the native Modal boundary animation',
);

check(
  terminal.includes('const activeOutputResizeRef = useRef<ActiveOutputResize | null>(null);')
    && terminal.includes('const stopOutputResize = useCallback(() => {'),
  'Terminal owns one tracked output resize lifecycle',
);
for (const listener of ['mousemove', 'mouseup', 'blur']) {
  check(
    terminal.includes(`window.addEventListener('${listener}'`)
      && terminal.includes(`window.removeEventListener('${listener}'`),
    `Terminal pairs ${listener} registration with teardown`,
  );
}
check(
  terminal.includes('useEffect(() => () => {\n    stopOutputResize();\n  }, [stopOutputResize]);'),
  'Terminal removes output resize listeners when the tab unmounts',
);
check(
  terminal.includes('stopOutputResize();\n    dragStartY.current =')
    && terminal.includes('const onUp = () => stopOutputResize();'),
  'a replacement resize and normal pointer release share the same teardown owner',
);

console.log(`office agent panel motion/Terminal resize smoke passed (${assertions} assertions)`);
