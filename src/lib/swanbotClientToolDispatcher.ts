export type SwanBotClientToolCall = {
  id: string;
  name: string;
  input: unknown;
};

export type SwanBotClientToolDispatchResult = {
  ok: boolean;
  data?: unknown;
  error?: string;
};

export const SWANBOT_CLIENT_TOOL_RESULT_MAX_CHARS = 12_000;
export const SWANBOT_CLIENT_TOOL_RESULT_STRING_MAX_CHARS = 2_000;

const SWANBOT_CLIENT_TOOL_RESULT_ARRAY_MAX_ITEMS = 40;
const SWANBOT_CLIENT_TOOL_RESULT_OBJECT_MAX_KEYS = 60;
const SWANBOT_CLIENT_TOOL_RESULT_MAX_DEPTH = 6;

function clipString(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const suffix = `\n[truncated from ${value.length} chars]`;
  return `${value.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`;
}

function describeValue(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  return typeof value;
}

function clipSwanBotClientToolValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'string') {
    return clipString(value, SWANBOT_CLIENT_TOOL_RESULT_STRING_MAX_CHARS);
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return null;
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (depth >= SWANBOT_CLIENT_TOOL_RESULT_MAX_DEPTH) return '[truncated: depth]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: clipString(value.message, SWANBOT_CLIENT_TOOL_RESULT_STRING_MAX_CHARS),
    };
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[truncated: circular]';
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      const clipped = value
        .slice(0, SWANBOT_CLIENT_TOOL_RESULT_ARRAY_MAX_ITEMS)
        .map((item) => clipSwanBotClientToolValue(item, depth + 1, seen));
      if (value.length > SWANBOT_CLIENT_TOOL_RESULT_ARRAY_MAX_ITEMS) {
        clipped.push({ __truncated_items: value.length - SWANBOT_CLIENT_TOOL_RESULT_ARRAY_MAX_ITEMS });
      }
      return clipped;
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const out: Record<string, unknown> = {};
    for (const [key, child] of entries.slice(0, SWANBOT_CLIENT_TOOL_RESULT_OBJECT_MAX_KEYS)) {
      out[key] = clipSwanBotClientToolValue(child, depth + 1, seen);
    }
    if (entries.length > SWANBOT_CLIENT_TOOL_RESULT_OBJECT_MAX_KEYS) {
      out.__truncated_keys = entries.length - SWANBOT_CLIENT_TOOL_RESULT_OBJECT_MAX_KEYS;
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

export function serializeSwanBotClientToolResult(result: SwanBotClientToolDispatchResult): string {
  const payload = result.ok
    ? { ok: true, data: clipSwanBotClientToolValue(result.data) }
    : { ok: false, error: clipString(result.error || 'failed', SWANBOT_CLIENT_TOOL_RESULT_STRING_MAX_CHARS) };

  try {
    const text = JSON.stringify(payload);
    if (text.length <= SWANBOT_CLIENT_TOOL_RESULT_MAX_CHARS) return text;
    return JSON.stringify({
      ok: result.ok,
      truncated: true,
      originalChars: text.length,
      dataType: result.ok ? describeValue(result.data) : undefined,
      error: result.ok ? undefined : clipString(result.error || 'failed', SWANBOT_CLIENT_TOOL_RESULT_STRING_MAX_CHARS),
    });
  } catch {
    return JSON.stringify({
      ok: false,
      error: 'client tool result could not be serialized',
    });
  }
}

export function serializeSwanBotClientToolError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'client tool dispatch threw');
  return serializeSwanBotClientToolResult({ ok: false, error: message });
}

export interface SwanBotDesktopClientToolBridge {
  launchApp: (name: string) => Promise<SwanBotClientToolDispatchResult>;
  focusApp: (name: string) => Promise<SwanBotClientToolDispatchResult>;
  typeText: (text: string) => Promise<SwanBotClientToolDispatchResult>;
  pasteText: (
    text: string,
    options?: { appName?: string; restoreClipboard?: boolean },
  ) => Promise<SwanBotClientToolDispatchResult>;
  runDesktopAppleScript: (
    program: { scriptLines: string[]; args?: string[] },
  ) => Promise<SwanBotClientToolDispatchResult>;
  convertImage: (
    args: { source: string; format?: string },
  ) => Promise<SwanBotClientToolDispatchResult>;
  pressKeys: (combo: string) => Promise<SwanBotClientToolDispatchResult>;
  clickMenu: (
    args: { appName?: string; menuPath: string[] },
  ) => Promise<SwanBotClientToolDispatchResult>;
  listRunningApps: () => Promise<SwanBotClientToolDispatchResult>;
  waitForApp: (name: string, timeout?: number) => Promise<SwanBotClientToolDispatchResult>;
  takeScreenshot: () => Promise<SwanBotClientToolDispatchResult>;
  openUrl: (url: string) => Promise<SwanBotClientToolDispatchResult>;
  openPath: (path: string) => Promise<SwanBotClientToolDispatchResult>;
  searchFiles: (
    rootPath: string,
    query: string,
    options?: {
      maxResults?: number;
      maxFiles?: number;
      maxDepth?: number;
      includeContent?: boolean;
      extensions?: string[];
    },
  ) => Promise<SwanBotClientToolDispatchResult>;
  statFile: (path: string) => Promise<SwanBotClientToolDispatchResult>;
  clickAt: (x: number, y: number) => Promise<SwanBotClientToolDispatchResult>;
  mouseMove: (x: number, y: number) => Promise<SwanBotClientToolDispatchResult>;
  mouseClick: (
    args: { x: number; y: number; button?: 'left' | 'right'; count?: number },
  ) => Promise<SwanBotClientToolDispatchResult>;
  mouseDown: (
    args: { x: number; y: number; button?: 'left' | 'right' },
  ) => Promise<SwanBotClientToolDispatchResult>;
  mouseUp: (
    args?: { x?: number; y?: number; button?: 'left' | 'right' },
  ) => Promise<SwanBotClientToolDispatchResult>;
  mouseDrag: (
    args: { fromX: number; fromY: number; toX: number; toY: number; durationMs?: number },
  ) => Promise<SwanBotClientToolDispatchResult>;
  mouseScroll: (
    args?: { deltaY?: number; deltaX?: number; x?: number; y?: number },
  ) => Promise<SwanBotClientToolDispatchResult>;
  getScreenSize: () => Promise<SwanBotClientToolDispatchResult>;
  readA11yTree: (
    args: { appName?: string; maxDepth?: number; maxNodes?: number },
  ) => Promise<SwanBotClientToolDispatchResult>;
  renderA11yTree: (tree: any) => string[];
  clickElement: (
    args: { pid: number; path: string },
  ) => Promise<SwanBotClientToolDispatchResult>;
  setElementValue: (
    args: { pid: number; path: string; text: string },
  ) => Promise<SwanBotClientToolDispatchResult>;
}

export async function dispatchSwanBotDesktopClientTool(
  bridge: SwanBotDesktopClientToolBridge,
  call: SwanBotClientToolCall,
): Promise<SwanBotClientToolDispatchResult | null> {
  const input = (call.input || {}) as Record<string, any>;
  switch (call.name) {
    case 'desktop.launch_app':
      return bridge.launchApp(String(input.appName || ''));
    case 'desktop.focus_app':
      return bridge.focusApp(String(input.appName || ''));
    case 'desktop.type_text':
      return bridge.typeText(String(input.text || ''));
    case 'desktop.paste_text':
      return bridge.pasteText(String(input.text || ''), {
        appName: typeof input.appName === 'string' ? input.appName : undefined,
        restoreClipboard: input.restoreClipboard !== false,
      });
    case 'desktop.run_applescript': {
      const { buildProgramFromToolInput } = await import('./scriptableMacApps');
      const program = buildProgramFromToolInput(input);
      if (!program) {
        return { ok: false, error: 'desktop.run_applescript needs intent + params, or scriptLines (+args).' };
      }
      return bridge.runDesktopAppleScript({ scriptLines: program.scriptLines, args: program.args });
    }
    case 'desktop.convert_image':
      return bridge.convertImage({
        source: String(input.source || ''),
        format: typeof input.format === 'string' ? input.format : 'png',
      });
    case 'desktop.press_keys':
      return bridge.pressKeys(String(input.combo || ''));
    case 'desktop.menu_click':
      return bridge.clickMenu({
        appName: typeof input.appName === 'string' ? input.appName : undefined,
        menuPath: Array.isArray(input.menuPath) ? input.menuPath.map(String) : [],
      });
    case 'desktop.list_running_apps': {
      const result = await bridge.listRunningApps();
      return result.ok ? { ok: true, data: { apps: result.data || [] } } : result;
    }
    case 'desktop.wait_for_app':
      return bridge.waitForApp(
        String(input.appName || ''),
        typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
      );
    case 'desktop.screenshot': {
      const result = await bridge.takeScreenshot();
      if (!result.ok) return result;
      const data = result.data as any;
      return {
        ok: true,
        data: {
          sizeBytes: data?.sizeBytes ?? 0,
          mimeType: data?.mimeType || 'image/png',
          preview: String(data?.base64 || '').slice(0, 128) + '\u2026',
        },
      };
    }
    case 'desktop.open_url':
      return bridge.openUrl(String(input.url || ''));
    case 'desktop.open_path':
      return bridge.openPath(String(input.path || ''));
    case 'desktop.file_search': {
      const rootPaths = Array.isArray(input.rootPaths) && input.rootPaths.length > 0
        ? input.rootPaths.map(String)
        : [String(input.rootPath || '~')];
      const query = String(input.query || '');
      const options = {
        maxResults: typeof input.maxResults === 'number' ? input.maxResults : undefined,
        maxFiles: typeof input.maxFiles === 'number' ? input.maxFiles : undefined,
        maxDepth: typeof input.maxDepth === 'number' ? input.maxDepth : undefined,
        includeContent: typeof input.includeContent === 'boolean' ? input.includeContent : undefined,
        extensions: Array.isArray(input.extensions) ? input.extensions.map(String) : undefined,
      };
      const matches: unknown[] = [];
      let visited = 0;
      let searchedContent = 0;
      let truncated = false;
      let resolvedQuery = query;
      for (const rootPath of rootPaths.slice(0, 6)) {
        const result = await bridge.searchFiles(rootPath, query, options);
        if (!result.ok) return result;
        const data = (result.data || {}) as Record<string, any>;
        resolvedQuery = String(data.query || resolvedQuery);
        visited += Number(data.visited || 0);
        searchedContent += Number(data.searchedContent || 0);
        truncated = truncated || Boolean(data.truncated);
        if (Array.isArray(data.matches)) matches.push(...data.matches);
      }
      const maxMatches = typeof input.maxResults === 'number' ? Math.max(1, Math.min(80, input.maxResults)) : 60;
      return {
        ok: true,
        data: {
          rootPaths: rootPaths.slice(0, 6),
          query: resolvedQuery,
          matches: matches.slice(0, maxMatches),
          visited,
          searchedContent,
          truncated: truncated || matches.length > maxMatches,
        },
      };
    }
    case 'desktop.file_stat':
      return bridge.statFile(String(input.path || ''));
    case 'desktop.click_at':
      return bridge.clickAt(Number(input.x), Number(input.y));
    case 'desktop.screen_size':
      return bridge.getScreenSize();
    case 'desktop.mouse_move':
      return bridge.mouseMove(Number(input.x), Number(input.y));
    case 'desktop.mouse_click':
      return bridge.mouseClick({
        x: Number(input.x),
        y: Number(input.y),
        button: input.button === 'right' ? 'right' : 'left',
        count: typeof input.count === 'number' ? input.count : undefined,
      });
    case 'desktop.mouse_down':
      return bridge.mouseDown({
        x: Number(input.x),
        y: Number(input.y),
        button: input.button === 'right' ? 'right' : 'left',
      });
    case 'desktop.mouse_up': {
      const hasCoords = typeof input.x === 'number' && typeof input.y === 'number';
      return bridge.mouseUp({
        x: hasCoords ? Number(input.x) : undefined,
        y: hasCoords ? Number(input.y) : undefined,
        button: input.button === 'right' ? 'right' : 'left',
      });
    }
    case 'desktop.mouse_drag':
      return bridge.mouseDrag({
        fromX: Number(input.fromX),
        fromY: Number(input.fromY),
        toX: Number(input.toX),
        toY: Number(input.toY),
        durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
      });
    case 'desktop.mouse_scroll':
      return bridge.mouseScroll({
        deltaY: typeof input.deltaY === 'number' ? input.deltaY : undefined,
        deltaX: typeof input.deltaX === 'number' ? input.deltaX : undefined,
        x: typeof input.x === 'number' ? input.x : undefined,
        y: typeof input.y === 'number' ? input.y : undefined,
      });
    case 'desktop.read_a11y_tree': {
      const result = await bridge.readA11yTree({
        appName: typeof input.appName === 'string' ? input.appName : undefined,
        maxDepth: typeof input.maxDepth === 'number' ? input.maxDepth : undefined,
        maxNodes: typeof input.maxNodes === 'number' ? input.maxNodes : undefined,
      });
      if (!result.ok || !result.data) return result;
      const data = result.data as any;
      const rendered = bridge.renderA11yTree(data.tree).join('\n');
      return {
        ok: true,
        data: {
          app: data.app,
          pid: data.pid,
          nodeCount: data.budget_used,
          text: rendered.slice(0, 8192),
          truncated: rendered.length > 8192,
        },
      };
    }
    case 'desktop.click_element':
      return bridge.clickElement({
        pid: Number(input.pid),
        path: String(input.path || ''),
      });
    case 'desktop.set_element_value':
      return bridge.setElementValue({
        pid: Number(input.pid),
        path: String(input.path || ''),
        text: String(input.text || ''),
      });
    default:
      return call.name.startsWith('desktop.')
        ? { ok: false, error: `Unknown client tool "${call.name}"` }
        : null;
  }
}
