import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const shell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const layout = read('src/screens/circles/tabs/office/useAgentPanelLayout.ts');

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  assert.ok(condition, message);
};

check(shell.includes('Modal,'), 'the shell imports the React Native Modal boundary');
check(
  shell.includes("if (Platform.OS !== 'web' && panelMode === 'center')"),
  'only native centered/compact presentation enters the native Modal window',
);
check(
  shell.includes("animationType={reduceMotion ? 'none' : 'fade'}")
    && panel.includes('reduceMotion={reduceMotion}')
    && shell.includes('onRequestClose={onClose}'),
  'the native boundary is static for reduced/unknown motion, retains normal fade, and routes hardware Back to close',
);
check(
  shell.includes('<View style={styles.nativeModalRoot}>{panelLayer}</View>')
    && shell.includes('nativeModalRoot: {\n    flex: 1,'),
  'the modal owns a full-window positioning root for its backdrop and sheet',
);
check(
  shell.includes("role: 'dialog'")
    && shell.includes("'aria-modal': panelMode === 'center' ? true : undefined")
    && shell.includes('return panelLayer;'),
  'web centered and docked presentation keeps its existing dialog/DOM path',
);
check(
  shell.includes('<Text nativeID="uc-agent-panel-title" style={styles.visuallyHiddenTitle}>{agent.name}</Text>')
    && shell.includes("'aria-labelledby': 'uc-agent-panel-title'"),
  'Rename keeps a valid accessible dialog title while the visible heading is replaced by the editor',
);
check(
  shell.includes('const wasEditingRef = React.useRef(editing);')
    && shell.includes('renameButtonRef.current?.focus?.()')
    && shell.includes('ref={renameButtonRef}'),
  'leaving Rename restores focus to its stable Rename control',
);
check(
  panel.includes("ev.key === 'Escape'")
    && panel.includes('if (ev.isComposing) return;')
    && panel.includes('if (editingRef.current)')
    && panel.includes('window.addEventListener(\'keydown\', onKey, { capture: true });'),
  'captured Escape cancels Rename first, closes otherwise, and preserves IME composition',
);
check(
  panel.includes("ev.key.toLowerCase() === 'k'")
    && panel.includes('ev.stopImmediatePropagation();'),
  'a centered Agent modal suppresses the Circle Search shortcut instead of stacking focus traps',
);

const arrowHandler = shell.slice(
  shell.indexOf('const handleArrowNavigation = ('),
  shell.indexOf('const renderRemoveButton'),
);
check(
  arrowHandler.includes('focusWebTab(nativeIdForKey(nextKey));')
    && !arrowHandler.includes('selectKey('),
  'arrow/Home/End navigation moves focus without activating a lazy route',
);
check(
  shell.includes('group.key,\n                      key => `uc-agent-panel-destination-${key}`')
    && shell.includes('tab.key,\n                        key => `uc-agent-panel-route-${key}`'),
  'repeated arrow presses calculate from the currently focused primary or contextual tab',
);
check(
  shell.includes("role: 'tabpanel',\n                'aria-labelledby': activeTabLabelId,\n                tabIndex: 0,"),
  'the active panel is a keyboard-reachable WAI-ARIA tabpanel',
);

check(
  layout.includes('const activeSideResizeRef = useRef<ActiveSideResize | null>(null);')
    && layout.includes('const stopSideResize = useCallback((updateState = true) => {'),
  'one lifecycle owner tracks and stops the active side resize',
);
for (const listener of ['mousemove', 'mouseup', 'blur']) {
  check(
    layout.includes(`window.addEventListener('${listener}'`)
      && layout.includes(`window.removeEventListener('${listener}'`),
    `${listener} resize listeners have paired registration and teardown`,
  );
}
check(
  layout.includes('document.body.style.cursor = activeResize.previousCursor;')
    && layout.includes('document.body.style.userSelect = activeResize.previousUserSelect;'),
  'resize teardown restores pre-existing body styles instead of blanking them',
);
check(
  layout.includes("if (panelMode !== 'side') stopSideResize();")
    && layout.includes('stopSideResize(false);'),
  'mode changes and unmount both tear down an in-flight resize',
);
check(
  layout.includes("window.addEventListener('blur', onUp);"),
  'losing the browser window ends resize even when mouseup is not observed',
);

console.log(`office agent panel modal/resize accessibility smoke passed (${assertions} assertions)`);
