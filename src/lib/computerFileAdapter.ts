import { callMcpTool, fetchAllMcpTools, type McpTool } from './mcpClient';
import {
  normalizeFileTaskResult,
  renderFileTaskResultText,
  type NormalizedFileTaskResult,
  type FileTaskMatch,
} from './computerFileTaskResult';

export interface ComputerFileAdapterResult {
  ok: boolean;
  message: string;
  warnings: string[];
  data?: Record<string, unknown>;
  /** Structured, normalized view of the filesystem tool result. Present
   *  whenever a tool call ran (success or failure) so the explorer UI
   *  can render a rich view regardless of which MCP shape came back. */
  normalized?: NormalizedFileTaskResult;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function toolMatches(tool: Pick<McpTool, 'name' | 'description'>, needles: string[]): boolean {
  const haystack = `${normalizeText(tool.name)} ${normalizeText(tool.description)}`;
  return needles.some((needle) => haystack.includes(needle));
}

function isFilesystemTool(tool: Pick<McpTool, 'name' | 'description'>): boolean {
  return toolMatches(tool, [
    'filesystem',
    'file system',
    'read file',
    'write file',
    'search files',
    'list directory',
    'glob',
    'ripgrep',
    'find file',
    'find files',
  ]);
}

function hasInputProp(tool: McpTool, key: string): boolean {
  const props = tool.inputSchema?.properties;
  return !!props && typeof props === 'object' && key in props;
}

function extractQuotedValue(task: string): string | null {
  const match = String(task || '').match(/"([^"]+)"|'([^']+)'/);
  return match ? (match[1] || match[2] || '').trim() : null;
}

function inferSearchQuery(task: string): string {
  const quoted = extractQuotedValue(task);
  if (quoted) return quoted;
  return String(task || '')
    .replace(/\b(find|search|locate|look for|open|read|show me|on my computer|in my files)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function inferPath(task: string): string | null {
  const pathMatch = String(task || '').match(/(?:\/[\w.\-\/]+|~\/[\w.\-\/]+|\b(?:desktop|downloads|documents)\/[\w.\-\/]+)/i);
  return pathMatch ? pathMatch[0] : null;
}

function pickTool(tools: McpTool[], scorer: (tool: McpTool) => number): McpTool | null {
  const ranked = [...tools]
    .map((tool) => ({ tool, score: scorer(tool) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.tool || null;
}

function buildArgs(tool: McpTool, task: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const query = inferSearchQuery(task);
  const path = inferPath(task);

  if (hasInputProp(tool, 'query')) args.query = query;
  if (hasInputProp(tool, 'q')) args.q = query;
  if (hasInputProp(tool, 'pattern')) args.pattern = query;
  if (hasInputProp(tool, 'search')) args.search = query;
  if (hasInputProp(tool, 'glob')) args.glob = query.includes('.') ? `**/*${query.startsWith('.') ? query : `*${query}`}` : `**/*${query}*`;
  if (hasInputProp(tool, 'path') && path) args.path = path;
  if (hasInputProp(tool, 'filePath') && path) args.filePath = path;
  if (hasInputProp(tool, 'directory') && path) args.directory = path;
  if (hasInputProp(tool, 'root') && path) args.root = path;
  if (hasInputProp(tool, 'limit')) args.limit = 10;

  const props = tool.inputSchema?.properties || {};
  for (const requiredKey of ['path', 'filePath', 'directory', 'root']) {
    if ((requiredKey in props) && !(requiredKey in args)) {
      args[requiredKey] = path || '.';
    }
  }

  if (Object.keys(args).length === 0) {
    return { query };
  }
  return args;
}

function inferTaskKind(task: string): 'search' | 'list' | 'read' | 'glob' | null {
  const lower = task.toLowerCase();
  if (/\b(read|open|show|inspect|summarize)\b/.test(lower)) return 'read';
  if (/\b(list|browse|show files|show folders|directory|folder)\b/.test(lower)) return 'list';
  if (/\b(glob|find files|find paths|match files)\b/.test(lower)) return 'glob';
  if (/\b(search|grep|find|locate|look for)\b/.test(lower)) return 'search';
  return null;
}

// ─── Claude-bridge filesystem fallback ──────────────────────────────────────

const BRIDGE_EXEC_URL = 'http://localhost:7778/exec';
const BRIDGE_CALL_TIMEOUT_MS = 15_000;
const BRIDGE_MAX_READ_BYTES = 50 * 1024; // 50 KB
const BRIDGE_MAX_SEARCH_ENTRIES = 50;

/** Classify the file operation the user wants from task text. */
function inferFileOpKind(task: string): 'search' | 'list' | 'read' {
  const lower = task.toLowerCase();
  if (/\b(find|locate|search)\b/.test(lower)) return 'search';
  if (/\b(list|show|what(?:'s| is) in|ls)\b/.test(lower)) return 'list';
  if (/\b(read|open|cat|view|print)\b/.test(lower)) return 'read';
  return 'search';
}

/** Allowed path prefixes for the bridge filesystem fallback. */
const SAFE_PATH_PREFIXES = [
  '~/',
  '/Users/',
];

/**
 * Strip shell metacharacters and validate the path starts with a
 * trusted root. Returns null when the path is unsafe.
 */
function sanitizePath(raw: string): string | null {
  // Strip characters that could break out of single-quoted shell strings
  // or introduce command injection.
  const cleaned = raw.replace(/[`$;|>&<\r\n"]/g, '').trim();
  if (!cleaned) return null;
  const safe = SAFE_PATH_PREFIXES.some(
    (prefix) => cleaned.startsWith(prefix),
  );
  if (!safe) return null;
  return cleaned;
}

/** POST a command to the local claude-bridge /exec endpoint. */
export async function callBridgeExec(
  command: string,
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_CALL_TIMEOUT_MS);
  try {
    const res = await fetch(BRIDGE_EXEC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, stdout: '', stderr: `HTTP ${res.status}` };
    const json = (await res.json()) as { ok?: boolean; stdout?: string; stderr?: string };
    return {
      ok: !!json?.ok,
      stdout: String(json?.stdout || ''),
      stderr: String(json?.stderr || ''),
    };
  } catch {
    clearTimeout(timer);
    return { ok: false, stdout: '', stderr: 'bridge unreachable' };
  }
}

/** Build a NormalizedFileTaskResult from raw find/ls/cat bridge output. */
function buildNormalizedFromBridge(
  kind: 'search' | 'list' | 'read',
  stdout: string,
  path?: string | null,
): NormalizedFileTaskResult {
  if (kind === 'read') {
    const content = stdout.length > BRIDGE_MAX_READ_BYTES
      ? stdout.slice(0, BRIDGE_MAX_READ_BYTES) + `\n… (truncated ${stdout.length - BRIDGE_MAX_READ_BYTES} bytes)`
      : stdout;
    return {
      kind: 'file_content',
      items: [],
      path: path ?? undefined,
      content,
    };
  }

  if (kind === 'list') {
    // ls -lh output: total NNN\n<perms> <links> <user> <group> <size> <date> <name>
    const lines = stdout.split('\n').filter(Boolean);
    const items: FileTaskMatch[] = [];
    for (const line of lines) {
      if (line.startsWith('total ')) continue;
      // Split on whitespace — name is at index 8 onwards
      const parts = line.split(/\s+/);
      const name = parts.slice(8).join(' ');
      if (!name) continue;
      const sizeRaw = parts[4];
      const isDir = line.startsWith('d');
      items.push({
        path: name,
        type: isDir ? 'directory' : 'file',
        size: parseHumanSize(sizeRaw),
      });
      if (items.length >= BRIDGE_MAX_SEARCH_ENTRIES) break;
    }
    return {
      kind: 'file_listing',
      items,
      totalCount: items.length,
    };
  }

  // search / find — one path per line
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const capped = lines.slice(0, BRIDGE_MAX_SEARCH_ENTRIES);
  const items: FileTaskMatch[] = capped.map((p) => {
    const segments = p.split('/');
    return { path: p, name: segments[segments.length - 1] };
  });
  return {
    kind: 'glob_paths',
    items,
    totalCount: lines.length,
  };
}

/** Parse ls -lh human-readable sizes like "4.2K", "1M", "128B" to bytes. */
function parseHumanSize(s: string): number | undefined {
  if (!s) return undefined;
  const m = s.match(/^([\d.]+)([BKMGTP]?)$/i);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 'B').toUpperCase();
  const multipliers: Record<string, number> = { B: 1, K: 1024, M: 1048576, G: 1073741824, T: 1099511627776 };
  return Math.round(n * (multipliers[unit] ?? 1));
}

/**
 * Try to satisfy the file task via the local claude-bridge /exec endpoint.
 * Returns null when the bridge is unreachable or the task can't be mapped
 * to a safe command — the caller falls through to the existing no-MCP path.
 */
async function tryBridgeFallback(task: string): Promise<ComputerFileAdapterResult | null> {
  const opKind = inferFileOpKind(task);
  const rawPath = inferPath(task);
  const query = inferSearchQuery(task);

  let command: string;
  let toolName: string;

  if (opKind === 'read') {
    if (!rawPath) return null;
    const safePath = sanitizePath(rawPath);
    if (!safePath) return null;
    // Single-quote the path; any embedded single quotes would break the
    // command but sanitizePath already rejected them.
    command = `cat '${safePath}' 2>/dev/null | head -c ${BRIDGE_MAX_READ_BYTES}`;
    toolName = 'claude-bridge:cat';
  } else if (opKind === 'list') {
    const dir = rawPath ? sanitizePath(rawPath) : '~/Downloads';
    if (!dir) return null;
    command = `ls -lh '${dir}' 2>/dev/null | head -50`;
    toolName = 'claude-bridge:ls';
  } else {
    // search — default to Downloads when no path hint
    const dir = rawPath ? sanitizePath(rawPath) : '~/Downloads';
    if (!dir) return null;
    const safeQuery = query.replace(/['"\\]/g, '').slice(0, 120);
    command = `find '${dir}' -iname '*${safeQuery}*' -type f -maxdepth 4 2>/dev/null | head -${BRIDGE_MAX_SEARCH_ENTRIES}`;
    toolName = 'claude-bridge:find';
  }

  const bridgeResult = await callBridgeExec(command);
  if (!bridgeResult.ok && !bridgeResult.stdout) {
    // Bridge offline or command hard-failed — let the caller handle gracefully.
    return null;
  }

  const normalized = buildNormalizedFromBridge(opKind, bridgeResult.stdout, rawPath);

  const itemCount = normalized.items.length;
  let message: string;
  if (opKind === 'read') {
    message = bridgeResult.stdout
      ? `File contents (via bridge)\n\n${renderFileTaskResultText(normalized)}`
      : 'File not found or empty.';
  } else if (opKind === 'list') {
    message = itemCount > 0
      ? `Listed ${itemCount} entr${itemCount === 1 ? 'y' : 'ies'} (via bridge)\n\n${renderFileTaskResultText(normalized)}`
      : 'Directory is empty or not found.';
  } else {
    const queryLabel = query.slice(0, 60);
    message = itemCount > 0
      ? `Found ${itemCount} file${itemCount === 1 ? '' : 's'} matching '${queryLabel}' (via bridge)\n\n${renderFileTaskResultText(normalized)}`
      : `No files matching '${queryLabel}' found.`;
  }

  return {
    ok: true,
    message,
    warnings: [],
    data: { toolName, command, rawStdout: bridgeResult.stdout },
    normalized,
  };
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function executeComputerFileTask(args: {
  circleId: string;
  task: string;
}): Promise<ComputerFileAdapterResult> {
  const task = String(args.task || '').trim();
  if (!task) {
    return {
      ok: false,
      message: 'No file task was provided.',
      warnings: [],
    };
  }

  const allTools = await fetchAllMcpTools(args.circleId).catch(() => [] as McpTool[]);
  const filesystemTools = allTools.filter(isFilesystemTool);
  if (filesystemTools.length === 0) {
    // No MCP filesystem surface — try the local claude-bridge /exec fallback.
    const bridgeResult = await tryBridgeFallback(task);
    if (bridgeResult) return bridgeResult;
    // Bridge also unavailable — return the original graceful error.
    return {
      ok: false,
      message: 'No filesystem MCP tools are active for this circle yet.',
      warnings: ['Missing filesystem MCP surface.'],
    };
  }

  const lowerTask = task.toLowerCase();
  const wantsRead = /\b(read|open|show|inspect|summarize)\b/.test(lowerTask);
  const wantsList = /\b(list|browse|show files|show folders|directory|folder)\b/.test(lowerTask);

  const chosenTool = pickTool(filesystemTools, (tool) => {
    let score = 1;
    if (wantsRead && toolMatches(tool, ['read file'])) score += 6;
    if (wantsList && toolMatches(tool, ['list directory'])) score += 6;
    if (!wantsRead && !wantsList && toolMatches(tool, ['search files', 'find file', 'glob', 'ripgrep'])) score += 6;
    if (toolMatches(tool, ['filesystem'])) score += 1;
    if (toolMatches(tool, ['search files', 'find file'])) score += 2;
    return score;
  });

  if (!chosenTool) {
    return {
      ok: false,
      message: 'Filesystem tools exist, but none matched this task shape well enough to run safely.',
      warnings: ['No suitable filesystem MCP tool found.'],
    };
  }

  const toolArgs = buildArgs(chosenTool, task);
  try {
    const result = await callMcpTool(chosenTool.serverId, chosenTool.name, toolArgs);
    const normalized = normalizeFileTaskResult(result, {
      toolName: chosenTool.name,
      taskKind: inferTaskKind(task),
    });
    return {
      ok: true,
      message: [
        `Executed file task with **${chosenTool.name}**.`,
        '',
        renderFileTaskResultText(normalized),
      ].join('\n'),
      warnings: [],
      data: {
        toolName: chosenTool.name,
        toolArgs,
        rawResult: result,
      },
      normalized,
    };
  } catch (error: any) {
    return {
      ok: false,
      message: `Filesystem tool execution failed: ${error?.message || 'Unknown error'}`,
      warnings: ['Filesystem MCP call failed.'],
      data: {
        toolName: chosenTool.name,
        toolArgs,
      },
    };
  }
}
