export type LocalComputerAwarenessKind =
  | 'browser_tabs'
  | 'window_state'
  | 'running_apps'
  | 'clipboard'
  | 'screen_state'
  | 'launch_app'
  | 'focus_app'
  | 'open_url'
  | 'open_path'
  | 'clipboard_write'
  | 'clipboard_clear'
  | 'shortcuts_list'
  | 'shortcut_run'
  | 'file_list'
  | 'file_read'
  | 'file_search'
  | 'a11y_tree'
  | 'window_manage'
  | 'mouse_move'
  | 'mouse_click'
  | 'mouse_drag';

export type LocalComputerAwarenessIntent = {
  route: boolean;
  kind: LocalComputerAwarenessKind | null;
  browsers?: string[];
  appQuery?: string;
  url?: string;
  path?: string;
  text?: string;
  query?: string;
  rootPath?: string;
  shortcutName?: string;
  windowAction?: 'focus' | 'raise' | 'minimize' | 'unminimize' | 'zoom' | 'resize';
  mouseButton?: 'left' | 'right';
  clickCount?: number;
  x?: number;
  y?: number;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  width?: number;
  height?: number;
  reason: string;
};

const CHROME_RE = /\b(chrome|google chrome)\b/i;
const SAFARI_RE = /\bsafari\b/i;
const BRAVE_RE = /\bbrave\b/i;
const EDGE_RE = /\b(edge|microsoft edge)\b/i;
const ARC_RE = /\barc\b/i;
const OPERA_RE = /\bopera\b/i;
const VIVALDI_RE = /\bvivaldi\b/i;

const BROWSER_TAB_RE = /\b(tabs?|browser tabs?|open tabs?|current tabs?)\b/i;
const TAB_AWARENESS_RE = /\b(can you|are you able to|tell me|show me|list|see|view|what|which|all)\b[\s\S]{0,120}\b(tabs?|browser tabs?|open tabs?|current tabs?)\b/i;
const WINDOW_STATE_RE = /\b(active window|focused window|frontmost|window state|open windows?|what(?:'s| is) on my screen|screen state|desktop state)\b/i;
const RUNNING_APPS_RE = /\b(running apps?|open apps?|apps? (?:are|is) open|what apps?|which apps?)\b/i;
const CLIPBOARD_RE = /\b(clipboard|pasteboard|copied text|what did i copy)\b/i;
const CLIPBOARD_WRITE_RE = /^\s*(?:please\s+)?(?:copy|put|write|save)\s+([\s\S]{1,4000}?)\s+(?:to|in|on)\s+(?:my\s+)?(?:clipboard|pasteboard)\s*[.!?]?\s*$/i;
const CLIPBOARD_WRITE_AFTER_RE = /^\s*(?:please\s+)?(?:copy|put|write|save)\s+(?:to|in|on)\s+(?:my\s+)?(?:clipboard|pasteboard)\s*:?\s+([\s\S]{1,4000})$/i;
const CLIPBOARD_SET_TO_RE = /^\s*(?:please\s+)?(?:set|write|save)\s+(?:my\s+)?(?:clipboard|pasteboard)\s+(?:to|as)\s+([\s\S]{1,4000})$/i;
const CLIPBOARD_CLEAR_RE = /\b(clear|empty|wipe)\b[\s\S]{0,80}\b(?:clipboard|pasteboard)\b/i;
const SCREEN_STATE_RE = /\b(screenshot|screen shot|see my screen|view my screen)\b/i;
const A11Y_TREE_RE = /\b(accessibility tree|a11y tree|ui tree|interface tree|ui elements?|screen elements?|clickable elements?|buttons?|controls?)\b/i;
const A11Y_APP_RE = /\b(?:for|in|inside)\s+([A-Za-z0-9 .\-_()]{2,80})(?:\s+(?:app|application|window))?\s*[.!?]?$/i;
const SHORTCUTS_LIST_RE = /\b(?:list|show|what|which)\b[\s\S]{0,80}\b(?:apple\s+|macos\s+|mac\s+)?shortcuts?\b/i;
const SHORTCUT_RUN_RE = /^\s*(?:please\s+)?(?:confirm\s+)?(?:run|start|trigger|execute)\s+(?:the\s+)?(?:(?:apple|macos|mac)\s+)?shortcut\s+(.+?)\s*[.!?]?\s*$/i;
const FILE_LIST_RE = /^\s*(?:please\s+)?(?:list|show)\s+(?:the\s+)?(?:files?|folders?|contents|items)\s+(?:in|inside|at|under)\s+(.+?)\s*[.!?]?\s*$/i;
const FILE_READ_RE = /^\s*(?:please\s+)?(?:read|show|preview|inspect|summari[sz]e)\s+(?:the\s+)?(?:file\s+)?(.+?)\s*[.!?]?\s*$/i;
const FILE_SEARCH_IN_FOR_RE = /^\s*(?:please\s+)?(?:search|find|locate)\s+(?:files?|folders?)?\s*(?:in|inside|under)\s+(.+?)\s+(?:for|matching|named|containing)\s+(.+?)\s*[.!?]?\s*$/i;
const FILE_SEARCH_FOR_IN_RE = /^\s*(?:please\s+)?(?:search|find|locate)\s+(?:files?|folders?)?\s*(?:for\s+)?(.+?)\s+(?:in|inside|under)\s+(.+?)\s*[.!?]?\s*$/i;
const MOUSE_DRAG_RE = /^\s*(?:please\s+)?drag(?:\s+(?:the\s+)?(?:mouse|cursor))?\s+(?:from\s+)?(\d{1,5})\s*,\s*(\d{1,5})\s+(?:to|into|onto)\s+(\d{1,5})\s*,\s*(\d{1,5})\s*[.!?]?\s*$/i;
const MOUSE_MOVE_RE = /^\s*(?:please\s+)?(?:move|hover|position)\s+(?:the\s+)?(?:mouse|cursor)(?:\s+(?:to|at|over))?\s+(\d{1,5})\s*,\s*(\d{1,5})\s*[.!?]?\s*$/i;
const MOUSE_CLICK_RE = /^\s*(?:please\s+)?(?:(right|left)\s+)?(?:(double|single)\s+)?click(?:\s+(?:the\s+)?(?:mouse|cursor))?(?:\s+(?:at|on))?\s+(\d{1,5})\s*,\s*(\d{1,5})\s*[.!?]?\s*$/i;
const WINDOW_RESIZE_RE = /^\s*(?:please\s+)?resize\s+(?:(.+?)\s+)?window\s+(?:to|at)\s+(\d{2,5})\s*x\s*(\d{2,5})\s*[.!?]?\s*$/i;
const WINDOW_MANAGE_RE = /^\s*(?:please\s+)?(minimi[sz]e|unminimi[sz]e|maximi[sz]e|zoom|raise|focus)\s+(?:(active|frontmost|current)\s+)?(?:(.+?)\s+)?window\s*[.!?]?\s*$/i;
const LAUNCH_APP_RE = /^\s*(?:please\s+)?(?:open|launch|start|fire\s+up)\s+(.+?)(?:\s+(?:app|application|program))?(?:\s+(?:on|in)\s+(?:my\s+)?(?:computer|mac|desktop))?\s*[.!?]?$/i;
const FOCUS_APP_RE = /^\s*(?:please\s+)?(?:focus|switch\s+to|bring\s+(?:up|forward)|bring\s+.+?\s+to\s+(?:front|the\s+front))\s+(.+?)(?:\s+(?:app|application|window))?\s*[.!?]?$/i;
const BRING_TO_FRONT_RE = /^\s*(?:please\s+)?bring\s+(.+?)\s+to\s+(?:front|the\s+front)\s*[.!?]?$/i;
const OPEN_URL_RE = /^\s*(?:please\s+)?(?:open|visit|go\s+to|launch)\s+(https?:\/\/\S+|mailto:\S+|file:\/\/\S+)\s*$/i;
const OPEN_BARE_URL_RE = /^\s*(?:please\s+)?(?:open|visit|go\s+to|launch)\s+((?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+(?:\/\S*)?)\s*$/i;
const OPEN_PATH_RE = /^\s*(?:please\s+)?(?:open|reveal|show)\s+((?:~\/|\/|\.\/|\.\.\/)[^\n\r]+)\s*$/i;

function isPathish(value: string): boolean {
  return /^(~|~\/|\/|\.\/|\.\.\/)/.test(value.trim()) ||
    /\b(downloads?|documents?|desktop|home folder|home directory)\b/i.test(value);
}

function normalizeWindowAction(action: string): LocalComputerAwarenessIntent['windowAction'] {
  const normalized = action.toLowerCase();
  if (normalized.startsWith('min')) return 'minimize';
  if (normalized.startsWith('unmin')) return 'unminimize';
  if (normalized.startsWith('max') || normalized === 'zoom') return 'zoom';
  if (normalized === 'raise') return 'raise';
  return 'focus';
}

function inferBrowsers(message: string): string[] | undefined {
  const browsers: string[] = [];
  if (CHROME_RE.test(message)) browsers.push('chrome');
  if (SAFARI_RE.test(message)) browsers.push('safari');
  if (BRAVE_RE.test(message)) browsers.push('brave');
  if (EDGE_RE.test(message)) browsers.push('edge');
  if (ARC_RE.test(message)) browsers.push('arc');
  if (OPERA_RE.test(message)) browsers.push('opera');
  if (VIVALDI_RE.test(message)) browsers.push('vivaldi');
  return browsers.length > 0 ? Array.from(new Set(browsers)) : undefined;
}

export function detectLocalComputerAwarenessIntent(message: string): LocalComputerAwarenessIntent {
  const text = String(message || '').trim();
  if (!text) return { route: false, kind: null, reason: 'empty' };
  const openUrl = text.match(OPEN_URL_RE);
  if (openUrl?.[1]) return { route: true, kind: 'open_url', url: openUrl[1].trim(), reason: 'local-open-url' };
  const bareUrl = text.match(OPEN_BARE_URL_RE);
  if (bareUrl?.[1]) return { route: true, kind: 'open_url', url: `https://${bareUrl[1].trim()}`, reason: 'local-open-url' };
  const openPath = text.match(OPEN_PATH_RE);
  if (openPath?.[1]) return { route: true, kind: 'open_path', path: openPath[1].trim(), reason: 'local-open-path' };
  if (CLIPBOARD_CLEAR_RE.test(text)) return { route: true, kind: 'clipboard_clear', reason: 'local-clipboard-clear' };
  const clipboardWrite =
    text.match(CLIPBOARD_WRITE_RE) ||
    text.match(CLIPBOARD_WRITE_AFTER_RE) ||
    text.match(CLIPBOARD_SET_TO_RE);
  if (clipboardWrite?.[1]) {
    return { route: true, kind: 'clipboard_write', text: clipboardWrite[1].trim(), reason: 'local-clipboard-write' };
  }
  if (TAB_AWARENESS_RE.test(text) || (BROWSER_TAB_RE.test(text) && /\b(open|have|current|all|chrome|safari|brave|edge|arc|browser)\b/i.test(text))) {
    return {
      route: true,
      kind: 'browser_tabs',
      browsers: inferBrowsers(text),
      reason: 'local-browser-tab-awareness',
    };
  }
  const mouseDrag = text.match(MOUSE_DRAG_RE);
  if (mouseDrag?.[1] && mouseDrag[2] && mouseDrag[3] && mouseDrag[4]) {
    return {
      route: true,
      kind: 'mouse_drag',
      fromX: Number(mouseDrag[1]),
      fromY: Number(mouseDrag[2]),
      toX: Number(mouseDrag[3]),
      toY: Number(mouseDrag[4]),
      reason: 'local-mouse-drag',
    };
  }
  const mouseMove = text.match(MOUSE_MOVE_RE);
  if (mouseMove?.[1] && mouseMove[2]) {
    return {
      route: true,
      kind: 'mouse_move',
      x: Number(mouseMove[1]),
      y: Number(mouseMove[2]),
      reason: 'local-mouse-move',
    };
  }
  const mouseClick = text.match(MOUSE_CLICK_RE);
  if (mouseClick?.[3] && mouseClick[4]) {
    return {
      route: true,
      kind: 'mouse_click',
      mouseButton: mouseClick[1]?.toLowerCase() === 'right' ? 'right' : 'left',
      clickCount: mouseClick[2]?.toLowerCase() === 'double' ? 2 : 1,
      x: Number(mouseClick[3]),
      y: Number(mouseClick[4]),
      reason: 'local-mouse-click',
    };
  }
  const resizeWindow = text.match(WINDOW_RESIZE_RE);
  if (resizeWindow?.[2] && resizeWindow[3]) {
    return {
      route: true,
      kind: 'window_manage',
      appQuery: resizeWindow[1]?.trim(),
      windowAction: 'resize',
      width: Number(resizeWindow[2]),
      height: Number(resizeWindow[3]),
      reason: 'local-window-manage',
    };
  }
  const windowManage = text.match(WINDOW_MANAGE_RE);
  if (windowManage?.[1]) {
    return {
      route: true,
      kind: 'window_manage',
      appQuery: windowManage[3]?.trim(),
      windowAction: normalizeWindowAction(windowManage[1]),
      reason: 'local-window-manage',
    };
  }
  if (WINDOW_STATE_RE.test(text)) return { route: true, kind: 'window_state', reason: 'local-window-awareness' };
  if (RUNNING_APPS_RE.test(text)) return { route: true, kind: 'running_apps', reason: 'local-running-app-awareness' };
  if (CLIPBOARD_RE.test(text)) return { route: true, kind: 'clipboard', reason: 'local-clipboard-awareness' };
  const shortcutRun = text.match(SHORTCUT_RUN_RE);
  if (shortcutRun?.[1]) return { route: true, kind: 'shortcut_run', shortcutName: shortcutRun[1].trim(), reason: 'local-shortcut-run' };
  if (SHORTCUTS_LIST_RE.test(text)) return { route: true, kind: 'shortcuts_list', reason: 'local-shortcuts-list' };
  const fileSearchInFor = text.match(FILE_SEARCH_IN_FOR_RE);
  if (fileSearchInFor?.[1] && fileSearchInFor[2]) {
    return {
      route: true,
      kind: 'file_search',
      rootPath: fileSearchInFor[1].trim(),
      query: fileSearchInFor[2].trim(),
      reason: 'local-file-search',
    };
  }
  const fileSearchForIn = text.match(FILE_SEARCH_FOR_IN_RE);
  if (fileSearchForIn?.[1] && fileSearchForIn[2] && isPathish(fileSearchForIn[2])) {
    return {
      route: true,
      kind: 'file_search',
      query: fileSearchForIn[1].trim(),
      rootPath: fileSearchForIn[2].trim(),
      reason: 'local-file-search',
    };
  }
  const fileList = text.match(FILE_LIST_RE);
  if (fileList?.[1] && isPathish(fileList[1])) {
    return { route: true, kind: 'file_list', path: fileList[1].trim(), reason: 'local-file-list' };
  }
  const fileRead = text.match(FILE_READ_RE);
  if (fileRead?.[1] && isPathish(fileRead[1])) {
    return { route: true, kind: 'file_read', path: fileRead[1].trim(), reason: 'local-file-read' };
  }
  if (A11Y_TREE_RE.test(text)) {
    const appMatch = text.match(A11Y_APP_RE);
    return {
      route: true,
      kind: 'a11y_tree',
      appQuery: appMatch?.[1]?.trim(),
      reason: 'local-a11y-tree',
    };
  }
  if (SCREEN_STATE_RE.test(text)) return { route: true, kind: 'screen_state', reason: 'local-screen-awareness' };
  const bringToFront = text.match(BRING_TO_FRONT_RE);
  if (bringToFront?.[1]) return { route: true, kind: 'focus_app', appQuery: bringToFront[1].trim(), reason: 'local-focus-app' };
  const focusApp = text.match(FOCUS_APP_RE);
  if (focusApp?.[1]) return { route: true, kind: 'focus_app', appQuery: focusApp[1].trim(), reason: 'local-focus-app' };
  const launchApp = text.match(LAUNCH_APP_RE);
  if (launchApp?.[1] && !/\b(website|webpage|site|page|tab|url|link)\b/i.test(launchApp[1])) {
    return { route: true, kind: 'launch_app', appQuery: launchApp[1].trim(), reason: 'local-launch-app' };
  }
  return { route: false, kind: null, reason: 'no-local-awareness-match' };
}

export function looksLikeLocalComputerAwarenessRequest(message: string): boolean {
  return detectLocalComputerAwarenessIntent(message).route;
}

export function getLocalComputerAwarenessRisk(intent: LocalComputerAwarenessIntent): 'safe' | 'review' | 'external_side_effect' {
  switch (intent.kind) {
    case 'browser_tabs':
    case 'window_state':
    case 'running_apps':
    case 'clipboard':
    case 'screen_state':
    case 'file_list':
    case 'file_read':
    case 'file_search':
    case 'shortcuts_list':
    case 'a11y_tree':
      return 'safe';
    case 'shortcut_run':
      return 'external_side_effect';
    case 'launch_app':
    case 'focus_app':
    case 'open_url':
    case 'open_path':
    case 'clipboard_write':
    case 'clipboard_clear':
    case 'window_manage':
    case 'mouse_move':
    case 'mouse_click':
    case 'mouse_drag':
      return 'review';
    default:
      return 'safe';
  }
}

export function requiresLocalComputerAwarenessApproval(intent: LocalComputerAwarenessIntent): boolean {
  return getLocalComputerAwarenessRisk(intent) !== 'safe';
}
