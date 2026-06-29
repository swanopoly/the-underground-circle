import { callMcpTool, fetchAllMcpTools, type McpTool } from './mcpClient';
import {
  copyFile,
  createDirectory,
  isDesktopBridgeAvailable,
  listFiles,
  readFile,
  renameFile,
  requestLocalFileSessionGrant,
  searchFiles,
  statFile,
  trashFile,
  writeTextFile,
} from './desktopBridge';
import {
  extractFilenameLikeFromText,
  normalizeDesktopFileSearchQuery,
} from './fileSearchQuery';
import { buildComputerTaskLocalFileAccessBlockedPresentation } from './computerTaskSurfacePreparation';

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

function extractFilenameLike(task: string): string | null {
  return extractFilenameLikeFromText(task);
}

function inferSearchQuery(task: string): string {
  const quoted = extractQuotedValue(task);
  if (quoted) return normalizeDesktopFileSearchQuery(quoted);
  const normalized = normalizeDesktopFileSearchQuery(task);
  if (normalized) return normalized;
  return String(task || '')
    .replace(/\b(can you|please|find|search|locate|look for|open|read|show me|show|tell me|where is|where are)\b/gi, ' ')
    .replace(/\b(the|a|an|file|folder|image|photo|picture|document|named|called)\b/gi, ' ')
    .replace(/\b(on|in|inside|under|from)\s+(my\s+)?(computer|mac|laptop|desktop|downloads?|documents?|pictures?|photos?|home folder|home directory|files?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

function inferPath(task: string): string | null {
  const pathMatch = String(task || '').match(/(?:\/[\w.\- /()]+|~\/[\w.\- /()]+|\b(?:desktop|downloads|documents|pictures|photos)\/[\w.\- /()]+)/i);
  return pathMatch ? pathMatch[0] : null;
}

function inferRootPath(task: string): string {
  const lower = String(task || '').toLowerCase();
  const path = inferPath(task);
  if (path && !extractFilenameLike(path)) return path;
  if (/\bdesktop\b/.test(lower)) return '~/Desktop';
  if (/\bdownloads?\b/.test(lower)) return '~/Downloads';
  if (/\bdocuments?\b/.test(lower)) return '~/Documents';
  if (/\b(pictures?|photos?)\b/.test(lower)) return '~/Pictures';
  if (/\bmovies?|videos?\b/.test(lower)) return '~/Movies';
  if (/\bmusic|audio\b/.test(lower)) return '~/Music';
  return '~';
}

function cleanRenamePart(value: string): string {
  return String(value || '')
    .replace(/^[\s"'`]+|[\s"'`.!?]+$/g, '')
    .replace(/\b(?:please|thanks|thank you)\b$/i, '')
    .trim();
}

function extractRenameIntent(task: string): { fromQuery: string; toPathOrName: string } | null {
  const text = String(task || '').trim();
  const match = text.match(/\b(?:rename|change)\s+(?:the\s+)?(?:(?:file|folder|image|photo|picture|document)\s+)?(.+?)\s+(?:to|as)\s+(.+?)\s*$/i);
  if (!match) return null;
  const fromQuery = normalizeDesktopFileSearchQuery(cleanRenamePart(match[1]));
  const toRaw = cleanRenamePart(match[2]);
  const toPath = inferPath(toRaw);
  const toPathOrName = toPath || normalizeDesktopFileSearchQuery(toRaw);
  if (!fromQuery || !toPathOrName) return null;
  return { fromQuery, toPathOrName };
}

function extractCopyIntent(task: string): { fromQuery: string; toPathOrName: string } | null {
  const text = String(task || '').trim();
  const match = text.match(/\b(?:copy|duplicate|make a copy of)\s+(?:the\s+)?(?:(?:file|folder|image|photo|picture|document)\s+)?(.+?)\s+(?:to|as)\s+(.+?)\s*$/i);
  if (!match) return null;
  const fromQuery = normalizeDesktopFileSearchQuery(cleanRenamePart(match[1]));
  const toRaw = cleanRenamePart(match[2]);
  const toPath = inferPath(toRaw);
  const toPathOrName = toPath || normalizeDesktopFileSearchQuery(toRaw);
  if (!fromQuery || !toPathOrName) return null;
  return { fromQuery, toPathOrName };
}

function extractTrashIntent(task: string): { query: string } | null {
  const text = String(task || '').trim();
  if (!/\b(delete|remove|trash|move\s+.+?\s+to\s+trash)\b/i.test(text)) return null;
  const query = inferSearchQuery(text);
  return query ? { query } : null;
}

function extractStatIntent(task: string): { pathOrQuery: string } | null {
  const text = String(task || '').trim();
  if (!/\b(exists?|metadata|info|details|size|modified|created|stat)\b/i.test(text)) return null;
  const explicitPath = inferPath(text);
  if (explicitPath) return { pathOrQuery: explicitPath };
  const query = inferSearchQuery(text);
  return query ? { pathOrQuery: query } : null;
}

function extractMkdirIntent(task: string): { pathOrName: string } | null {
  const text = String(task || '').trim();
  if (!/\b(create|make|new)\b[\s\S]{0,80}\b(folder|directory)\b/i.test(text)) return null;
  const explicitPath = inferPath(text);
  if (explicitPath) return { pathOrName: explicitPath };
  const quoted = extractQuotedValue(text);
  if (quoted) return { pathOrName: quoted };
  const called = text.match(/\b(?:called|named)\s+(.+?)(?:\s+(?:on|in|under)\s+(?:my\s+)?(?:desktop|downloads?|documents?|pictures?|photos?|home))?\s*$/i);
  if (called?.[1]) return { pathOrName: cleanRenamePart(called[1]) };
  const afterFolder = text.match(/\b(?:folder|directory)\s+(.+?)(?:\s+(?:on|in|under)\s+(?:my\s+)?(?:desktop|downloads?|documents?|pictures?|photos?|home))?\s*$/i);
  if (afterFolder?.[1]) return { pathOrName: cleanRenamePart(afterFolder[1]).replace(/^(?:called|named)\s+/i, '') };
  return null;
}

function extractWriteTextIntent(task: string): { pathOrName: string; content: string; append: boolean; overwrite: boolean } | null {
  const text = String(task || '').trim();
  if (!/\b(write|save|create|make|append)\b[\s\S]{0,120}\b(file|text file|note|notes|txt|markdown|md)\b/i.test(text)) return null;
  const append = /\bappend\b/i.test(text);
  const overwrite = /\b(overwrite|replace)\b/i.test(text) || !append;
  const withContent = text.match(/\b(?:with|containing|that says|saying|content:)\s+([\s\S]+)$/i);
  const content = withContent?.[1] ? cleanRenamePart(withContent[1]) : '';
  const explicitPath = inferPath(text);
  if (explicitPath && /\.[A-Za-z0-9]{1,12}$/.test(explicitPath)) {
    return { pathOrName: explicitPath, content, append, overwrite };
  }
  const quoted = extractQuotedValue(text);
  if (quoted && /\.[A-Za-z0-9]{1,12}$/.test(quoted)) {
    return { pathOrName: quoted, content, append, overwrite };
  }
  const named = text.match(/\b(?:called|named)\s+([A-Za-z0-9 ._-]+\.[A-Za-z0-9]{1,12})/i);
  if (named?.[1]) return { pathOrName: cleanRenamePart(named[1]), content, append, overwrite };
  return null;
}

function basenameFromPath(value: string): string {
  return String(value || '').split('/').filter(Boolean).pop() || String(value || '');
}

function dirnameFromPath(value: string): string {
  const trimmed = String(value || '').replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  if (index <= 0) return '/';
  return trimmed.slice(0, index);
}

function looksLikeExplicitPath(value: string): boolean {
  const trimmed = String(value || '').trim();
  return trimmed.startsWith('/')
    || trimmed.startsWith('~/')
    || trimmed.startsWith('./')
    || trimmed.startsWith('../')
    || /^[A-Za-z0-9 ._-]+\/.+/.test(trimmed);
}

function siblingTargetPath(sourcePath: string, toPathOrName: string): string {
  const target = String(toPathOrName || '').trim();
  if (looksLikeExplicitPath(target)) return target;
  return `${dirnameFromPath(sourcePath)}/${target.replace(/^\/+/, '')}`;
}

function rootTargetPath(rootPath: string, pathOrName: string): string {
  const target = String(pathOrName || '').trim();
  if (looksLikeExplicitPath(target)) return target;
  return `${String(rootPath || '~').replace(/\/+$/, '')}/${target.replace(/^\/+/, '')}`;
}

function localFileAccessRetryMessage(action: string): string {
  return `I could not ${action}. Reconnect the desktop bridge, approve the requested folder, then try again.`;
}

function localFileVerifyRetryMessage(action: string): string {
  return `I could not verify the file before trying to ${action}. Send the exact file path or reconnect the desktop bridge, then try again.`;
}

export type LocalFileMutationMatchSelection =
  | { status: 'matched'; match: { path: string; name?: string } }
  | { status: 'none' }
  | { status: 'ambiguous'; candidates: Array<{ path: string; name?: string }>; message: string };

function dedupeFileMatches(matches: Array<{ path: string; name?: string }>): Array<{ path: string; name?: string }> {
  const seen = new Set<string>();
  const deduped: Array<{ path: string; name?: string }> = [];
  for (const match of matches) {
    const key = String(match.path || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }
  return deduped;
}

export function selectUnambiguousFileMatchForMutation(
  matches: Array<{ path: string; name?: string }>,
  query: string,
): LocalFileMutationMatchSelection {
  const normalizedQuery = query.trim().toLowerCase();
  const uniqueMatches = dedupeFileMatches(matches);
  if (!uniqueMatches.length) return { status: 'none' };
  const exactMatches = uniqueMatches.filter((match) => (
    basenameFromPath(match.path).toLowerCase() === normalizedQuery
    || String(match.name || '').toLowerCase() === normalizedQuery
  ));
  if (exactMatches.length === 1) return { status: 'matched', match: exactMatches[0] };
  if (exactMatches.length > 1) {
    return {
      status: 'ambiguous',
      candidates: exactMatches.slice(0, 8),
      message: `Multiple local files exactly matched "${query}". Provide the full path before changing files.`,
    };
  }
  const fuzzyMatches = uniqueMatches.filter((match) => basenameFromPath(match.path).toLowerCase().includes(normalizedQuery));
  if (fuzzyMatches.length === 1) return { status: 'matched', match: fuzzyMatches[0] };
  if (fuzzyMatches.length > 1) {
    return {
      status: 'ambiguous',
      candidates: fuzzyMatches.slice(0, 8),
      message: `Multiple local files matched "${query}". Provide the full path before changing files.`,
    };
  }
  if (uniqueMatches.length === 1) return { status: 'matched', match: uniqueMatches[0] };
  return {
    status: 'ambiguous',
    candidates: uniqueMatches.slice(0, 8),
    message: `Multiple local files matched "${query}". Provide the full path before changing files.`,
  };
}

export function planDesktopBridgeFileTask(task: string): {
  mode: 'list' | 'read' | 'search' | 'stat' | 'rename' | 'copy' | 'trash' | 'mkdir' | 'write_text';
  rootPath: string;
  query: string;
  path: string | null;
  toPathOrName?: string;
  pathOrName?: string;
  content?: string;
  append?: boolean;
  overwrite?: boolean;
} {
  const lowerTask = String(task || '').toLowerCase();
  const path = inferPath(task);
  const wantsRead = /\b(read|open|show|inspect|summari[sz]e|preview)\b/.test(lowerTask);
  const wantsList = /\b(list|browse|show files|show folders|directory|folder)\b/.test(lowerTask);
  const rootPath = inferRootPath(task);
  const renameIntent = extractRenameIntent(task);
  const copyIntent = extractCopyIntent(task);
  const trashIntent = extractTrashIntent(task);
  const statIntent = extractStatIntent(task);
  const mkdirIntent = extractMkdirIntent(task);
  const writeTextIntent = extractWriteTextIntent(task);
  if (writeTextIntent) {
    return {
      mode: 'write_text',
      rootPath,
      query: '',
      path,
      pathOrName: writeTextIntent.pathOrName,
      content: writeTextIntent.content,
      append: writeTextIntent.append,
      overwrite: writeTextIntent.overwrite,
    };
  }
  if (mkdirIntent) {
    return {
      mode: 'mkdir',
      rootPath,
      query: '',
      path,
      pathOrName: mkdirIntent.pathOrName,
    };
  }
  if (renameIntent) {
    return {
      mode: 'rename',
      rootPath,
      query: renameIntent.fromQuery,
      path,
      toPathOrName: renameIntent.toPathOrName,
    };
  }
  if (copyIntent) {
    return {
      mode: 'copy',
      rootPath,
      query: copyIntent.fromQuery,
      path,
      toPathOrName: copyIntent.toPathOrName,
    };
  }
  if (trashIntent) {
    return {
      mode: 'trash',
      rootPath,
      query: trashIntent.query,
      path,
    };
  }
  if (statIntent) {
    return {
      mode: 'stat',
      rootPath,
      query: statIntent.pathOrQuery,
      path: looksLikeExplicitPath(statIntent.pathOrQuery) ? statIntent.pathOrQuery : path,
    };
  }
  return {
    mode: wantsList && !extractFilenameLike(task) ? 'list' : wantsRead && path ? 'read' : 'search',
    rootPath,
    query: inferSearchQuery(task),
    path,
  };
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

function formatDesktopBridgeSearchMatches(matches: Array<{ path: string; snippet?: string }>): string {
  return matches
    .slice(0, 40)
    .map((match, index) => `${index + 1}. ${match.path}${match.snippet ? ` — ${match.snippet}` : ''}`)
    .join('\n');
}

function formatDesktopBridgeStat(stat: {
  path: string;
  exists: boolean;
  kind: string | null;
  size: number | null;
  modifiedAt: string | null;
  createdAt: string | null;
}): string {
  if (!stat.exists) return `Path does not exist: ${stat.path}`;
  return [
    `Path: ${stat.path}`,
    `Kind: ${stat.kind || 'unknown'}`,
    `Size: ${stat.size ?? 'unknown'} bytes`,
    `Modified: ${stat.modifiedAt || 'unknown'}`,
    `Created: ${stat.createdAt || 'unknown'}`,
  ].join('\n');
}

export async function executeDesktopBridgeFileTask(task: string): Promise<ComputerFileAdapterResult | null> {
  const bridgeAvailable = await isDesktopBridgeAvailable().catch(() => false);
  if (!bridgeAvailable) return null;

  const plan = planDesktopBridgeFileTask(task);
  const writeModes = new Set<typeof plan.mode>(['rename', 'copy', 'trash', 'mkdir', 'write_text']);
  const requiredScope = writeModes.has(plan.mode) ? 'write' : 'read';
  const requiredRoots = (() => {
    if (plan.mode === 'read' && plan.path) return [plan.path];
    if (plan.mode === 'stat' && plan.path) return [plan.path];
    if ((plan.mode === 'mkdir' || plan.mode === 'write_text') && plan.pathOrName) {
      return [rootTargetPath(plan.rootPath, plan.pathOrName)];
    }
    if ((plan.mode === 'rename' || plan.mode === 'copy') && plan.toPathOrName && looksLikeExplicitPath(plan.toPathOrName)) {
      return [plan.rootPath, plan.toPathOrName];
    }
    return [plan.rootPath];
  })();
  const grant = await requestLocalFileSessionGrant({
    roots: requiredRoots,
    scope: requiredScope,
    reason: task,
  });
  if (!grant.ok) {
    const grantBlockedPresentation = buildComputerTaskLocalFileAccessBlockedPresentation({
      roots: requiredRoots,
      scope: requiredScope,
      error: grant.error || null,
      errorCode: grant.errorCode || null,
    });
    return {
      ok: false,
      message: grantBlockedPresentation.message,
      warnings: grantBlockedPresentation.blockers,
      data: {
        adapter: 'desktop_bridge',
        requiredRoots,
        nextSteps: grantBlockedPresentation.nextSteps,
      },
    };
  }

  try {
    if (plan.mode === 'list') {
      const result = await listFiles(plan.rootPath);
      if (!result.ok) {
        return {
          ok: false,
          message: localFileAccessRetryMessage('read that folder'),
          warnings: [`Desktop bridge file list failed: ${result.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const entries = result.data?.entries || [];
      return {
        ok: true,
        message: entries.length
          ? `Desktop files in ${result.data?.path || plan.rootPath}:\n${entries.slice(0, 40).map((entry) => `- ${entry.name}${entry.kind === 'directory' ? '/' : ''}`).join('\n')}${result.data?.truncated ? '\n...truncated' : ''}`
          : `No files found in ${result.data?.path || plan.rootPath}.`,
        warnings: [],
        data: { adapter: 'desktop_bridge', plan, result: result.data },
      };
    }

    if (plan.mode === 'mkdir') {
      const targetPath = rootTargetPath(plan.rootPath, String(plan.pathOrName || ''));
      if (!targetPath || targetPath.endsWith('/')) {
        return {
          ok: false,
          message: 'I could not infer the folder name to create.',
          warnings: ['Missing local folder destination.'],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const result = await createDirectory(targetPath, { recursive: true });
      if (!result.ok) {
        return {
          ok: false,
          message: localFileAccessRetryMessage('create that folder'),
          warnings: [`Desktop bridge folder creation failed: ${result.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      return {
        ok: true,
        message: `${result.data?.existed ? 'Folder already exists' : 'Created folder'}: ${result.data?.path || targetPath}.`,
        warnings: [],
        data: { adapter: 'desktop_bridge', plan, result: result.data },
      };
    }

    if (plan.mode === 'write_text') {
      const targetPath = rootTargetPath(plan.rootPath, String(plan.pathOrName || ''));
      if (!targetPath || !String(plan.pathOrName || '').trim()) {
        return {
          ok: false,
          message: 'I could not infer the text file path to write.',
          warnings: ['Missing local text file destination.'],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const result = await writeTextFile(targetPath, String(plan.content || ''), {
        append: Boolean(plan.append),
        overwrite: Boolean(plan.overwrite),
      });
      if (!result.ok) {
        return {
          ok: false,
          message: localFileAccessRetryMessage('write that file'),
          warnings: [`Desktop bridge text file write failed: ${result.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      return {
        ok: true,
        message: `${result.data?.append ? 'Appended' : 'Wrote'} ${result.data?.bytes || 0} bytes to ${result.data?.path || targetPath}.`,
        warnings: [],
        data: { adapter: 'desktop_bridge', plan, result: result.data },
      };
    }

    if (plan.mode === 'stat') {
      const explicitPath = plan.path || (looksLikeExplicitPath(plan.query) ? plan.query : null);
      if (explicitPath) {
        const result = await statFile(explicitPath);
        if (!result.ok) {
          return {
            ok: false,
            message: localFileAccessRetryMessage('check that file'),
            warnings: [`Desktop bridge file stat failed: ${result.error || 'unknown error'}.`],
            data: { adapter: 'desktop_bridge', plan },
          };
        }
        return {
          ok: true,
          message: formatDesktopBridgeStat(result.data!),
          warnings: [],
          data: { adapter: 'desktop_bridge', plan, result: result.data },
        };
      }

      const query = plan.query.trim();
      if (!query) {
        return {
          ok: false,
          message: 'I could not infer a local path or filename for the metadata check.',
          warnings: ['Missing local file metadata query.'],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const search = await searchFiles(plan.rootPath, query, {
        maxResults: 20,
        maxFiles: 4000,
        maxDepth: 8,
        includeContent: false,
      });
      if (!search.ok) {
        return {
          ok: false,
          message: localFileVerifyRetryMessage('check it'),
          warnings: [`Desktop bridge file search failed before metadata check: ${search.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const selection = selectUnambiguousFileMatchForMutation(search.data?.matches || [], query);
      if (selection.status === 'none') {
        return {
          ok: true,
          message: `No local file matches for "${search.data?.query || query}" under ${search.data?.rootPath || plan.rootPath}.`,
          warnings: [],
          data: { adapter: 'desktop_bridge', plan, result: search.data },
        };
      }
      if (selection.status === 'ambiguous') {
        return {
          ok: false,
          message: selection.message,
          warnings: ['Ambiguous local file metadata target.'],
          data: { adapter: 'desktop_bridge', plan, result: search.data, candidates: selection.candidates },
        };
      }
      const source = selection.match;
      const result = await statFile(source.path);
      if (!result.ok) {
        return {
          ok: false,
          message: localFileAccessRetryMessage('check that file'),
          warnings: [`Desktop bridge file stat failed: ${result.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan, source },
        };
      }
      return {
        ok: true,
        message: formatDesktopBridgeStat(result.data!),
        warnings: [],
        data: { adapter: 'desktop_bridge', plan, source, result: result.data },
      };
    }

    if (plan.mode === 'rename') {
      const query = plan.query.trim();
      const target = String(plan.toPathOrName || '').trim();
      if (!query || !target) {
        return {
          ok: false,
          message: 'I could not infer both the source file and the new filename for the rename.',
          warnings: ['Missing local file rename source or destination.'],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const search = await searchFiles(plan.rootPath, query, {
        maxResults: 40,
        maxFiles: 4000,
        maxDepth: 8,
        includeContent: false,
      });
      if (!search.ok) {
        return {
          ok: false,
          message: localFileVerifyRetryMessage('rename it'),
          warnings: [`Desktop bridge file search failed before rename: ${search.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const matches = search.data?.matches || [];
      const selection = selectUnambiguousFileMatchForMutation(matches, query);
      if (selection.status === 'none') {
        return {
          ok: false,
          message: `No local file matches for "${search.data?.query || query}" under ${search.data?.rootPath || plan.rootPath}.`,
          warnings: [],
          data: { adapter: 'desktop_bridge', plan, result: search.data },
        };
      }
      if (selection.status === 'ambiguous') {
        return {
          ok: false,
          message: selection.message,
          warnings: ['Ambiguous local file mutation target.'],
          data: { adapter: 'desktop_bridge', plan, result: search.data, candidates: selection.candidates },
        };
      }
      const source = selection.match;
      const toPath = siblingTargetPath(source.path, target);
      const result = await renameFile(source.path, toPath, { overwrite: false });
      if (!result.ok) {
        return {
          ok: false,
          message: localFileAccessRetryMessage('rename that file'),
          warnings: [`Desktop bridge file rename failed: ${result.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan, source },
        };
      }
      return {
        ok: true,
        message: `Renamed ${result.data?.fromPath || source.path} to ${result.data?.toPath || toPath}.`,
        warnings: [],
        data: { adapter: 'desktop_bridge', plan, source, result: result.data },
      };
    }

    if (plan.mode === 'copy') {
      const query = plan.query.trim();
      const target = String(plan.toPathOrName || '').trim();
      if (!query || !target) {
        return {
          ok: false,
          message: 'I could not infer both the source file and the copy destination.',
          warnings: ['Missing local file copy source or destination.'],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const search = await searchFiles(plan.rootPath, query, {
        maxResults: 40,
        maxFiles: 4000,
        maxDepth: 8,
        includeContent: false,
      });
      if (!search.ok) {
        return {
          ok: false,
          message: localFileVerifyRetryMessage('copy it'),
          warnings: [`Desktop bridge file search failed before copy: ${search.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const matches = search.data?.matches || [];
      const selection = selectUnambiguousFileMatchForMutation(matches, query);
      if (selection.status === 'none') {
        return {
          ok: false,
          message: `No local file matches for "${search.data?.query || query}" under ${search.data?.rootPath || plan.rootPath}.`,
          warnings: [],
          data: { adapter: 'desktop_bridge', plan, result: search.data },
        };
      }
      if (selection.status === 'ambiguous') {
        return {
          ok: false,
          message: selection.message,
          warnings: ['Ambiguous local file mutation target.'],
          data: { adapter: 'desktop_bridge', plan, result: search.data, candidates: selection.candidates },
        };
      }
      const source = selection.match;
      const toPath = siblingTargetPath(source.path, target);
      const result = await copyFile(source.path, toPath, { overwrite: false });
      if (!result.ok) {
        return {
          ok: false,
          message: localFileAccessRetryMessage('copy that file'),
          warnings: [`Desktop bridge file copy failed: ${result.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan, source },
        };
      }
      return {
        ok: true,
        message: `Copied ${result.data?.fromPath || source.path} to ${result.data?.toPath || toPath}.`,
        warnings: [],
        data: { adapter: 'desktop_bridge', plan, source, result: result.data },
      };
    }

    if (plan.mode === 'trash') {
      const query = plan.query.trim();
      if (!query) {
        return {
          ok: false,
          message: 'I could not infer the file or folder to move to Trash.',
          warnings: ['Missing local file trash source.'],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const search = await searchFiles(plan.rootPath, query, {
        maxResults: 40,
        maxFiles: 4000,
        maxDepth: 8,
        includeContent: false,
      });
      if (!search.ok) {
        return {
          ok: false,
          message: localFileVerifyRetryMessage('move it to Trash'),
          warnings: [`Desktop bridge file search failed before moving to Trash: ${search.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      const matches = search.data?.matches || [];
      const selection = selectUnambiguousFileMatchForMutation(matches, query);
      if (selection.status === 'none') {
        return {
          ok: false,
          message: `No local file matches for "${search.data?.query || query}" under ${search.data?.rootPath || plan.rootPath}.`,
          warnings: [],
          data: { adapter: 'desktop_bridge', plan, result: search.data },
        };
      }
      if (selection.status === 'ambiguous') {
        return {
          ok: false,
          message: selection.message,
          warnings: ['Ambiguous local file mutation target.'],
          data: { adapter: 'desktop_bridge', plan, result: search.data, candidates: selection.candidates },
        };
      }
      const source = selection.match;
      const result = await trashFile(source.path);
      if (!result.ok) {
        return {
          ok: false,
          message: localFileAccessRetryMessage('move that file to Trash'),
          warnings: [`Desktop bridge move-to-Trash failed: ${result.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan, source },
        };
      }
      return {
        ok: true,
        message: `Moved ${result.data?.path || source.path} to Trash${result.data?.trashPath ? ` at ${result.data.trashPath}` : ''}.`,
        warnings: [],
        data: { adapter: 'desktop_bridge', plan, source, result: result.data },
      };
    }

    if (plan.mode === 'read' && plan.path) {
      const result = await readFile(plan.path, 120_000);
      if (!result.ok) {
        return {
          ok: false,
          message: localFileAccessRetryMessage('read that file'),
          warnings: [`Desktop bridge file read failed: ${result.error || 'unknown error'}.`],
          data: { adapter: 'desktop_bridge', plan },
        };
      }
      return {
        ok: true,
        message: `Read ${result.data?.path || plan.path} (${result.data?.size || 0} bytes${result.data?.truncated ? ', truncated preview' : ''}):\n\n${result.data?.content || ''}`,
        warnings: [],
        data: { adapter: 'desktop_bridge', plan, result: result.data },
      };
    }

    const query = plan.query.trim();
    if (!query) {
      return {
        ok: false,
        message: 'I could not infer a filename or search phrase for the local file search.',
        warnings: ['Missing local file search query.'],
        data: { adapter: 'desktop_bridge', plan },
      };
    }

    const result = await searchFiles(plan.rootPath, query, {
      maxResults: 40,
      maxFiles: 4000,
      maxDepth: 8,
      includeContent: !extractFilenameLike(query),
    });
    if (!result.ok) {
      return {
        ok: false,
        message: localFileAccessRetryMessage('search those files'),
        warnings: [`Desktop bridge file search failed: ${result.error || 'unknown error'}.`],
        data: { adapter: 'desktop_bridge', plan },
      };
    }
    const matches = result.data?.matches || [];
    return {
      ok: true,
      message: matches.length
        ? `Found ${matches.length} local file match${matches.length === 1 ? '' : 'es'} for "${result.data?.query || query}" under ${result.data?.rootPath || plan.rootPath}:\n${formatDesktopBridgeSearchMatches(matches)}${result.data?.truncated ? '\n...truncated' : ''}`
        : `No local file matches for "${result.data?.query || query}" under ${result.data?.rootPath || plan.rootPath}.`,
      warnings: [],
      data: { adapter: 'desktop_bridge', plan, result: result.data },
    };
  } catch (error: any) {
    return {
      ok: false,
      message: 'I could not complete that file task. Reconnect the desktop bridge, approve the folder, then try again.',
      warnings: [`Desktop bridge file task failed: ${error?.message || 'Unknown error'}.`],
      data: { adapter: 'desktop_bridge', plan },
    };
  }
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

  const desktopBridgeResult = await executeDesktopBridgeFileTask(task);
  if (desktopBridgeResult) return desktopBridgeResult;

  const allTools = await fetchAllMcpTools(args.circleId).catch(() => [] as McpTool[]);
  const filesystemTools = allTools.filter(isFilesystemTool);
  if (filesystemTools.length === 0) {
    // We reach here only after the desktop-bridge path declined (it returns
    // null when the bridge is offline). Tailor the guidance: local files need
    // the bridge running; remote/cloud files need a filesystem integration.
    const bridgeUp = await isDesktopBridgeAvailable().catch(() => false);
    return {
      ok: false,
      message: bridgeUp
        ? 'No filesystem integration is connected for remote files, and this did not match a local-file action. For cloud/remote files, connect a filesystem integration in Marketplace; for local files, name the exact path (e.g. `~/Downloads/report.pdf`).'
        : 'To work with local files, I need the desktop bridge connected and folder access approved. Reconnect it, grant the folder, then ask again. For remote/cloud files, connect a filesystem integration in Marketplace.',
      warnings: [bridgeUp
        ? 'No filesystem MCP surface; desktop bridge up but task unmatched.'
        : 'Desktop bridge offline and no filesystem MCP surface.'],
      data: { kind: 'file_capability_gap', bridgeAvailable: bridgeUp },
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
      message: 'Filesystem tools are connected, but none safely matched this request. Name the exact file or folder path, or connect a filesystem integration that supports this operation in Marketplace.',
      warnings: ['No suitable filesystem MCP tool found.'],
      data: { kind: 'file_capability_gap', bridgeAvailable: true },
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
      message: 'I could not run the connected file tool for that request. Check the integration or send the exact path, then try again.',
      warnings: [`Filesystem MCP call failed: ${error?.message || 'Unknown error'}.`],
      data: {
        toolName: chosenTool.name,
        toolArgs,
      },
    };
  }
}
