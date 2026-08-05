/**
 * Presentation contract for OpenSwan's top-level Chat navigation.
 *
 * These React Native components are not safe to import in the tsx smoke
 * environment, so this pins the source-level wiring that must remain visible:
 * the main/circle thread cannot hide OpenSwan controls, the existing control
 * panel and run-history callbacks remain authoritative, and the bottom sheet
 * explains where mode, model, approval, and recovery controls live.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let passes = 0;
let failures = 0;

function assert(condition: unknown, message: string): void {
  if (condition) {
    passes += 1;
    console.log(`pass: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const repoRoot = process.cwd();
const header = readFileSync(
  join(repoRoot, 'src/screens/circles/tabs/chat/ChatThreadHeader.tsx'),
  'utf8',
);
const menu = readFileSync(
  join(repoRoot, 'src/screens/circles/tabs/chat/OpenSwanServiceMenu.tsx'),
  'utf8',
);

assert(
  !header.includes('if (isCircleThread) return null')
    && !header.includes('if (!thread) return null'),
  'thread loading and circle visibility no longer hide the OpenSwan controls',
);
assert(
  header.includes('const compactServiceBar = (')
    && header.includes('if (!thread || isCircleThread) return compactServiceBar;')
    && header.includes('setThread(null);')
    && header.includes('setMembers([]);')
    && header.includes('OpenSwan controls')
    && header.includes('Agents, modes, models, approvals & recovery'),
  'missing-thread and circle Chat states share a compact OpenSwan navigation strip',
);
assert(
  header.includes('onPress={() => setShowServiceMenu(true)}')
    && header.includes('accessibilityLabel="Open OpenSwan service controls"'),
  'the visible strip opens the existing service menu accessibly',
);
assert(
  header.includes('onOpenRunHistory={onOpenRunHistory}')
    && header.includes('accessibilityLabel="Open OpenSwan runs and recovery"'),
  'run history and recovery use the existing Chat callback',
);
assert(
  header.includes("circleBar: {")
    && header.includes("flexWrap: 'wrap'")
    && header.includes('minWidth: 180'),
  'the compact control strip can wrap on narrow screens',
);

assert(
  menu.includes('onOpenRunHistory?: () => void;')
    && menu.includes('onClose(); onOpenControlPanel();')
    && menu.includes('onClose(); onOpenSkills();')
    && menu.includes('onClose(); onOpenRunHistory();'),
  'the service menu closes before forwarding every navigation callback',
);
assert(
  menu.includes('Switch mode and crew here.')
    && menu.includes('Agent, model, approvals, and tools are in Control Panel.')
    && menu.includes('Past or blocked work is in Runs & recovery.'),
  'the service menu explains where each major control lives',
);
assert(
  menu.includes('Agent · model · approvals · tools')
    && menu.includes('Runs & recovery')
    && menu.includes('accessibilityLabel="Open OpenSwan runs and recovery"'),
  'control-panel and recovery routes have explicit, accessible labels',
);
assert(
  menu.includes("secondaryRow: {") && menu.includes("flexDirection: 'row'"),
  'secondary service routes share a compact mobile-friendly row',
);

assert(
  header.includes("const WEB_BUTTON_FOCUS_PROPS = Platform.OS === 'web'")
    && header.includes('focusable: true, tabIndex: 0')
    && occurrences(header, '{...WEB_BUTTON_FOCUS_PROPS}') >= 4,
  'OPEN and RUNS controls are explicit web tab stops without native-only props',
);
assert(
  occurrences(header, 'accessibilityRole="button"') >= 4
    && occurrences(header, 'accessibilityHint="Choose mode and crew') >= 2
    && occurrences(header, 'accessibilityHint="Review active, completed, or blocked runs') >= 2,
  'header OPEN and RUNS controls expose descriptive button semantics',
);
assert(
  occurrences(header, "focused && Platform.OS === 'web' && styles.keyboardFocus") >= 4
    && header.includes("outlineStyle: 'solid'")
    && header.includes('outlineWidth: 2'),
  'header keyboard focus receives a visible web-only ring',
);

assert(
  menu.includes("const WEB_BUTTON_FOCUS_PROPS = Platform.OS === 'web'")
    && menu.includes('focusable: true, tabIndex: 0')
    && occurrences(menu, '{...WEB_BUTTON_FOCUS_PROPS}') >= 7,
  'menu choices and route buttons are explicit web tab stops',
);
assert(
  occurrences(menu, 'accessibilityHint={option.description}') === 2
    && occurrences(menu, 'accessibilityState={{ selected: active }}') === 2
    && menu.includes("'aria-pressed': selected")
    && menu.includes("'aria-label': `${label}. ${description}`")
    && occurrences(menu, 'webChoiceSemantics(accessibilityLabel, option.description, active)') === 2,
  'mode and crew choices retain native state while emitting direct web pressed semantics',
);
assert(
  menu.includes('accessibilityHint="Choose the agent and model, review approvals, and manage tools."')
    && menu.includes('accessibilityHint="Review and manage OpenSwan skills for this circle."')
    && menu.includes('accessibilityHint="Review active, completed, or blocked runs and available recovery actions."')
    && occurrences(menu, 'accessibilityHint="Close the service menu and return to Chat."') >= 2,
  'Control Panel, Skills, Runs & recovery, and close actions have descriptive hints',
);
assert(
  occurrences(menu, "focused && Platform.OS === 'web' && styles.keyboardFocus") >= 7
    && menu.includes("outlineStyle: 'solid'")
    && menu.includes('outlineWidth: 2'),
  'every menu control receives a visible web-only keyboard focus ring',
);
assert(
  menu.includes('accessibilityLabel="OpenSwan service controls"')
    && menu.includes('<View accessibilityViewIsModal style={styles.sheet}>')
    && !menu.includes('WEB_CONTAINER_FOCUS_PROPS')
    && menu.includes('style={styles.dismissBackdrop}')
    && menu.indexOf('accessibilityLabel="Close OpenSwan service menu"') < menu.indexOf('style={styles.dismissBackdrop}'),
  'the named OpenSwan dialog exposes a real control before its non-focusable backdrop',
);
assert(
  header.includes("accessibilityLabel={isOwner ? 'Invite members to this Chat thread' : 'Chat thread members'}")
    && header.includes('<View accessibilityViewIsModal style={modalStyles.card}>')
    && header.includes('accessibilityLabel="Close thread members dialog"')
    && header.includes('style={modalStyles.dismissBackdrop}')
    && header.indexOf('accessibilityLabel="Close thread members dialog"') < header.indexOf('style={modalStyles.dismissBackdrop}'),
  'the named thread-members dialog exposes its close control before its backdrop',
);
assert(
  occurrences(menu, 'onStartShouldSetResponder={() => true}') === 1
    && occurrences(header, 'onStartShouldSetResponder={() => true}') === 1
    && occurrences(menu, 'accessible={false}') === 1
    && occurrences(header, 'accessible={false}') === 1,
  'both dismiss backdrops use pointer responders without becoming tab stops',
);
assert(
  menu.includes("function webDescriptiveLabel(label: string, hint: string)")
    && header.includes("function webDescriptiveLabel(label: string, hint: string)")
    && menu.includes("'aria-label': `${label}. ${hint}`")
    && header.includes("'aria-label': `${label}. ${hint}`"),
  'descriptive native hints also reach React Native Web through direct aria labels',
);

console.log(`\nOpenSwan chat navigation smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
