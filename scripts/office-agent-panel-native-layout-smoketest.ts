/**
 * Focused source contract for Office Agent popup responsive accessibility.
 *
 * A wide iPad/tablet enters Office's desktop content breakpoint, but it must
 * still use the native Modal boundary and live React Native window geometry.
 * Docking and persisted side-panel state are browser-only affordances. The
 * Customize sprite is a non-actionable image and follows the same fail-static
 * reduced-motion preference as the containing panel.
 *
 * Run: npx tsx scripts/office-agent-panel-native-layout-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const shell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const layout = read('src/screens/circles/tabs/office/useAgentPanelLayout.ts');
const customize = read('src/screens/circles/tabs/office/AgentCustomizePanel.tsx');
const pixelAgent = read('src/screens/circles/tabs/office/PixelAgent.tsx');
const office = read('src/screens/circles/tabs/OfficeTab.tsx');
const appHeader = read('src/components/AppHeader.tsx');
const floatingChat = read('src/components/FloatingChat.tsx');

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  assert.ok(condition, message);
};

check(
  panel.includes("const supportsDockedPanel = !!isDesktop && Platform.OS === 'web';")
    && panel.includes("const effectivePanelMode = supportsDockedPanel ? panelMode : 'center';"),
  'only a web desktop can activate the docked inspector mode',
);
check(
  shell.includes("{isDesktop && Platform.OS === 'web' ? (")
    && shell.includes("if (Platform.OS !== 'web' && panelMode === 'center')"),
  'native tablets hide the Dock control and retain the native Modal boundary',
);
check(
  layout.includes("import { Platform, useWindowDimensions } from 'react-native';")
    && layout.includes('const measuredViewport = useWindowDimensions();'),
  'panel geometry follows the platform-aware live viewport',
);
check(
  layout.includes('Number.isFinite(measuredViewport.width)')
    && layout.includes('Number.isFinite(measuredViewport.height)')
    && layout.includes(': 320,')
    && layout.includes(': 480,')
    && layout.includes('[measuredViewport.height, measuredViewport.width]'),
  'invalid measurements fail to bounded geometry and rotation refreshes both axes',
);
check(
  !layout.includes('window.innerWidth')
    && !layout.includes('window.innerHeight')
    && !layout.includes('w: 1920')
    && !layout.includes('h: 1080'),
  'native geometry never falls back to browser globals or a desktop-sized synthetic viewport',
);
check(
  layout.includes('const availableWidth = Math.max(SIDE_MIN_W, viewport.w - 80);')
    && layout.includes('Math.min(SIDE_MAX_W, availableWidth),'),
  'a saved web dock width is clamped after responsive viewport changes',
);
check(
  layout.includes('const parsed = Number(stored);')
    && layout.includes('if (Number.isFinite(parsed))')
    && layout.includes('Number.isFinite(width) ? width : SIDE_DEFAULT_W'),
  'corrupt persisted dock widths recover to a finite bounded value instead of propagating NaN',
);
check(
  layout.includes('const maxCenteredHeight = Math.max(1, viewport.h - (POPUP_PADDING * 2));')
    && layout.includes('const top = Math.min(APP_HEADER_OFFSET, Math.max(0, viewport.h - 1));')
    && layout.includes('height: Math.max(1, viewport.h - top)')
    && layout.includes('top: Math.max(0, Math.round((viewport.h - height) / 2))'),
  'centered and docked geometry remains inside very short landscape viewports',
);
check(
  panel.includes('reduceMotion={reduceMotion}')
    && customize.includes('reduceMotion: boolean;')
    && customize.includes('reduceMotion={reduceMotion}'),
  'the Customize preview receives the panel fail-static reduced-motion preference',
);
check(
  customize.includes('accessibilityRole="image"')
    && customize.includes('accessibilityLabel={`Appearance preview for ${agent.name}`}')
    && !customize.includes('onPress={() => {}}'),
  'the appearance preview is described as an image and owns no no-op action',
);
check(
  pixelAgent.includes("const interactive = typeof onPress === 'function';")
    && pixelAgent.includes('disabled={!interactive}')
    && pixelAgent.includes("importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}"),
  'PixelAgent removes inert previews from the nested button accessibility path',
);
check(
  pixelAgent.includes('const motionDisabled = reduceMotionPreference === true;')
    && pixelAgent.includes('if (motionDisabled || agent.status === \'offline\')')
    && pixelAgent.includes('if (motionDisabled) {\n      auraFlicker.stopAnimation();')
    && pixelAgent.includes('setFloatingText([]);')
    && pixelAgent.includes('reduceMotion={motionDisabled}'),
  'explicit reduced motion parks sprite, blink, aura, and XP animation lanes',
);
check(
  panel.includes('not claim or start an invisible close animation')
    && panel.includes('slideAnim.setValue(reduceMotion ? 0 : 400);')
    && !panel.includes('startPanelAnimation(Animated.parallel(['),
  'parent-owned close is immediate and only prepares stable values for the next open',
);
check(
  layout.includes('backdropOpacity: backdropOn ? 1 : 0')
    && !layout.includes("backdropOn && panelMode === 'center'"),
  'a compact effective modal cannot inherit a transparent backdrop from the saved desktop dock preference',
);
check(
  appHeader.includes("top: 0, zIndex: 1000")
    && floatingChat.includes('zIndex: 9000')
    && shell.includes('const WEB_AGENT_MODAL_BACKDROP_Z_INDEX = 12_000;')
    && shell.includes('const WEB_AGENT_MODAL_PANEL_Z_INDEX = WEB_AGENT_MODAL_BACKDROP_Z_INDEX + 1;')
    && shell.includes('zIndex: WEB_AGENT_MODAL_BACKDROP_Z_INDEX')
    && shell.includes('zIndex: WEB_AGENT_MODAL_PANEL_Z_INDEX'),
  'the web modal backdrop and dialog paint above the sticky header and persistent Floating Chat',
);
check(
  office.includes('const displayAgentsRef = useRef<readonly OfficeAgent[]>(displayAgents);')
    && office.includes('resolveUniqueOfficeAgentById(displayAgentsRef.current, agentId)')
    && office.includes('onPress={handleAgentPress}'),
  'a memoized sprite resolves its id against the synchronously current canonical roster before opening the panel',
);
check(
  pixelAgent.includes('onPress={interactive ? () => onPress?.(agent.id) : undefined}')
    && pixelAgent.includes('prev.agent.spirit === next.agent.spirit')
    && pixelAgent.includes('prev.onPress === next.onPress'),
  'the sprite forwards immutable identity, refreshes changed behavior, and never retains a replaced interaction callback',
);

console.log(`office agent panel native layout smoke passed (${assertions} assertions)`);
