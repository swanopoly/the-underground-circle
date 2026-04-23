import { callMcpTool, fetchAllMcpTools, type McpTool } from './mcpClient';

export interface ComputerFileAdapterResult {
  ok: boolean;
  message: string;
  warnings: string[];
  data?: Record<string, unknown>;
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

function stringifyResult(result: any): string {
  if (result == null) return 'No result returned.';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) return result.slice(0, 8).map((item) => JSON.stringify(item)).join('\n');
  if (typeof result === 'object') {
    if (Array.isArray(result.content)) {
      return result.content
        .slice(0, 8)
        .map((item: any) => typeof item?.text === 'string' ? item.text : JSON.stringify(item))
        .join('\n');
    }
    return JSON.stringify(result, null, 2).slice(0, 2000);
  }
  return String(result);
}

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
    const rendered = stringifyResult(result);
    return {
      ok: true,
      message: [
        `Executed file task with **${chosenTool.name}**.`,
        '',
        rendered || 'The tool returned successfully but did not include a readable payload.',
      ].join('\n'),
      warnings: [],
      data: {
        toolName: chosenTool.name,
        toolArgs,
        rawResult: result,
      },
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
