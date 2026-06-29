import type { ChatComputerRequestRoute } from './chatComputerRequestRouter';
import type { DesktopFileSearchMatch, DesktopFileStat } from './desktopBridge';

type DirectLocalFileMode = 'rename' | 'copy' | 'trash' | 'mkdir' | 'write_text' | 'open_path';
type DirectLocalFilePlanMode = DirectLocalFileMode | 'other';

export interface DirectLocalFilePlan {
  mode: DirectLocalFilePlanMode;
  path?: string;
  appName?: string | null;
}

export interface DirectLocalFileAdapterResult {
  ok: boolean;
  message: string;
  warnings: string[];
  data?: Record<string, unknown>;
}

const DIRECT_LOCAL_FILE_MODES = new Set<string>([
  'rename',
  'copy',
  'trash',
  'mkdir',
  'write_text',
  'open_path',
]);

const DIRECT_LOCAL_FILE_TOOLS = new Set<string>([
  'desktop.file_rename',
  'desktop.file_copy',
  'desktop.file_trash',
  'desktop.file_mkdir',
  'desktop.file_write_text',
  'desktop.open_path',
]);

export type DirectLocalFileExecutor = (
  task: string,
  plan: DirectLocalFilePlan,
) => Promise<DirectLocalFileAdapterResult | null>;

export interface DirectLocalFileRuntimeOutcome {
  handled: boolean;
  status: 'completed' | 'failed';
  message: string;
  warnings: string[];
  data?: {
    plan: DirectLocalFilePlan;
    result?: Record<string, unknown>;
    proofSignals?: string[];
  };
}

export function planDirectLocalFileRequest(task: string): DirectLocalFilePlan {
  const text = String(task || '');
  if (/\b(?:write|save|create|make)\b[\s\S]{0,140}\b(?:text\s+file|file|txt|markdown|md)\b/i.test(text)) {
    return { mode: 'write_text' };
  }
  if (/\b(?:called|named)\s+[^.]+\.(?:txt|md|json|csv)\b[\s\S]{0,120}\b(?:with|containing|that says|saying)\b/i.test(text)) {
    return { mode: 'write_text' };
  }
  if (/\b(?:create|make|new)\b[\s\S]{0,80}\b(?:folder|directory)\b/i.test(text)) return { mode: 'mkdir' };
  if (/\b(?:copy|duplicate|make a copy of)\b/i.test(text)) return { mode: 'copy' };
  if (/\b(?:delete|remove|trash|move\s+[\s\S]{1,120}\s+to\s+trash)\b/i.test(text)) return { mode: 'trash' };
  if (/\b(?:rename|change)\b[\s\S]{0,140}\b(?:to|as)\b/i.test(text)) return { mode: 'rename' };
  const openPath = extractOpenPathPlan(text);
  if (openPath) return openPath;
  return { mode: 'other' };
}

function extractAppNameForOpenPath(text: string): string | null {
  if (/\b(?:microsoft\s+word|ms\s+word|word)\b/i.test(text)) return 'Microsoft Word';
  if (/\b(?:microsoft\s+excel|ms\s+excel|excel)\b/i.test(text)) return 'Microsoft Excel';
  if (/\b(?:microsoft\s+powerpoint|ms\s+powerpoint|powerpoint)\b/i.test(text)) return 'Microsoft PowerPoint';
  if (/\b(?:adobe\s+acrobat|acrobat)\b/i.test(text)) return 'Adobe Acrobat';
  if (/\bphotoshop\b/i.test(text)) return 'Adobe Photoshop';
  if (/\bphotos\b/i.test(text)) return 'Photos';
  if (/\bfinder\b/i.test(text)) return 'Finder';
  if (/\bpreview\b/i.test(text)) return 'Preview';
  if (/\btext\s*edit\b/i.test(text)) return 'TextEdit';
  return null;
}

function normalizeFolderName(value: string): string | null {
  const lower = String(value || '').toLowerCase();
  if (/\bdesktop\b/.test(lower)) return '~/Desktop';
  if (/\bdownloads?\b/.test(lower)) return '~/Downloads';
  if (/\bdocuments?\b/.test(lower)) return '~/Documents';
  if (/\b(pictures?|photos?)\b/.test(lower)) return '~/Pictures';
  if (/\bmovies?|videos?\b/.test(lower)) return '~/Movies';
  if (/\bmusic|audio\b/.test(lower)) return '~/Music';
  return null;
}

function rootTargetPath(rootPath: string, pathOrName: string): string {
  const target = String(pathOrName || '').trim();
  if (target.startsWith('/') || target.startsWith('~/') || target.startsWith('./') || target.startsWith('../')) return target;
  return `${String(rootPath || '~').replace(/\/+$/, '')}/${target.replace(/^\/+/, '')}`;
}

function extractExplicitPath(text: string): string | null {
  const match = String(text || '').match(/(?:~\/[\w.\- /()@]+|\/[\w.\- /()@]+|\b(?:desktop|downloads|documents|pictures|photos|movies|music)\/[\w.\- /()@]+)/i);
  if (!match) return null;
  const raw = match[0].trim().replace(/[.!?]+$/g, '');
  if (/^(desktop|downloads|documents|pictures|photos|movies|music)\//i.test(raw)) return `~/${raw[0].toUpperCase()}${raw.slice(1)}`;
  return raw;
}

function extractFilename(text: string): string | null {
  const match = String(text || '').match(/\b([A-Za-z0-9][A-Za-z0-9 ._@()+-]{0,120}\.(?:pdf|txt|md|json|csv|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|tiff?|bmp|heic|psd|psb|indd|idml|zip))\b/i);
  return match?.[1]
    ?.trim()
    .replace(/^(?:open|show|preview|view|reveal|browse|display)\s+(?:the\s+)?(?:(?:file|image|photo|picture|document)\s+)?/i, '')
    .replace(/[.!?]+$/g, '') || null;
}

function extractOpenPathPlan(text: string): DirectLocalFilePlan | null {
  if (!/\b(?:open|show|preview|view|reveal|browse|display)\b/i.test(text)) return null;
  const appName = extractAppNameForOpenPath(text);
  const explicitPath = extractExplicitPath(text);
  if (explicitPath) return { mode: 'open_path', path: explicitPath, appName };
  const filename = extractFilename(text);
  const root = normalizeFolderName(text);
  if (filename && root) return { mode: 'open_path', path: rootTargetPath(root, filename), appName };
  if (!filename && root && /\b(?:open|show|browse|view|reveal)\b/i.test(text)) {
    return { mode: 'open_path', path: root, appName: appName || 'Finder' };
  }
  return null;
}

function splitRootAndBasename(rawPath: string): { rootPath: string; basename: string } | null {
  const value = String(rawPath || '').trim().replace(/\/+$/g, '');
  const slash = value.lastIndexOf('/');
  if (slash <= 0 || slash >= value.length - 1) return null;
  return {
    rootPath: value.slice(0, slash),
    basename: value.slice(slash + 1),
  };
}

function extensionFromFilename(filename: string): string | null {
  return String(filename || '').match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase() || null;
}

function uniqueBestFileSearchMatch(matches: DesktopFileSearchMatch[], basename: string): DesktopFileSearchMatch | null {
  const expected = String(basename || '').trim().toLowerCase();
  if (!expected) return null;
  const exact = matches.filter((match) => String(match.name || '').trim().toLowerCase() === expected);
  if (exact.length === 1) return exact[0] || null;
  if (exact.length > 1) return null;
  return matches.length === 1 ? matches[0] || null : null;
}

function simpleOpenPathMissingMessage(): string {
  return 'I could not tell which file or folder to open. Send the exact path and I will try again.';
}

function simpleOpenPathNotFoundMessage(): string {
  return 'I could not find that file or folder. Check the name or send the exact path, then try again.';
}

function simpleOpenPathVerifyMessage(): string {
  return 'I could not verify that file before opening it. Reconnect the desktop bridge or send the exact path.';
}

function simpleOpenPathAmbiguousMessage(): string {
  return 'I found more than one matching file. Send the exact path and I will open that one.';
}

function simpleOpenPathLaunchMessage(): string {
  return 'I could not open that file or folder. Check the path and try again.';
}

function directLocalFileSafeFailureMessage(plan: DirectLocalFilePlan, rawMessage: string): string {
  const text = String(rawMessage || '');
  if (/ambiguous|multiple/i.test(text)) {
    return 'I found more than one matching file. Send the exact path and I will use that one.';
  }
  if (/already exists|exist(s|ed)|conflict|EEXIST/i.test(text)) {
    return 'A file or folder already exists at the requested destination. Choose a different name or confirm what to replace.';
  }
  if (/not found|does not exist|ENOENT|missing/i.test(text)) {
    return plan.mode === 'open_path'
      ? simpleOpenPathNotFoundMessage()
      : 'I could not find that file or folder. Check the name or send the exact path, then try again.';
  }
  if (/permission|access|EACCES|EPERM|grant|not_paired|bridge|ECONN|fetch failed|timeout/i.test(text)) {
    return 'I need the desktop bridge connected and folder access approved before I can work with that file. Reconnect it, grant the folder, then try again.';
  }
  switch (plan.mode) {
    case 'open_path':
      return simpleOpenPathLaunchMessage();
    case 'rename':
      return 'I could not rename that file. Check the filename and folder access, then try again.';
    case 'copy':
      return 'I could not copy that file. Check the filename and folder access, then try again.';
    case 'trash':
      return 'I could not move that file to Trash. Check the filename and folder access, then try again.';
    case 'mkdir':
      return 'I could not create that folder. Check the destination and folder access, then try again.';
    case 'write_text':
      return 'I could not write that file. Check the destination and folder access, then try again.';
    default:
      return 'I could not complete that local file task. Check the file path and try again.';
  }
}

async function resolveOpenPathBeforeLaunch(
  bridge: typeof import('./desktopBridge'),
  plan: DirectLocalFilePlan,
): Promise<{ ok: true; path: string; stat?: DesktopFileStat; warnings: string[] } | { ok: false; result: DirectLocalFileAdapterResult }> {
  if (!plan.path) {
    return {
      ok: false,
      result: {
        ok: false,
        message: simpleOpenPathMissingMessage(),
        warnings: ['Desktop bridge open path missing a parsed path.'],
        data: { adapter: 'desktop_bridge', plan },
      },
    };
  }

  const directStat = await bridge.statFile(plan.path).catch((error) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
    errorCode: 'unknown' as const,
  }));
  if (directStat.ok && directStat.data?.exists) {
    return { ok: true, path: directStat.data.path || plan.path, stat: directStat.data, warnings: [] };
  }

  const searchTarget = splitRootAndBasename(plan.path);
  if (!searchTarget) {
    const reason = directStat.ok && directStat.data?.exists === false
      ? 'the path does not exist'
      : directStat.error || 'the path could not be verified';
    return {
      ok: false,
      result: {
        ok: false,
        message: directStat.ok && directStat.data?.exists === false
          ? simpleOpenPathNotFoundMessage()
          : simpleOpenPathVerifyMessage(),
        warnings: [`Desktop bridge open path was not verified before launch: ${reason}.`],
        data: { adapter: 'desktop_bridge', plan, stat: directStat.ok ? directStat.data : undefined },
      },
    };
  }

  const extension = extensionFromFilename(searchTarget.basename);
  const search = await bridge.searchFiles(searchTarget.rootPath, searchTarget.basename, {
    maxResults: 5,
    maxDepth: 1,
    includeContent: false,
    ...(extension ? { extensions: [extension] } : {}),
  }).catch((error) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
    errorCode: 'unknown' as const,
  }));

  if (!search.ok) {
    return {
      ok: false,
      result: {
        ok: false,
        message: simpleOpenPathVerifyMessage(),
        warnings: [`Desktop bridge file search failed before open_path: ${search.error || 'unknown error'}.`],
        data: { adapter: 'desktop_bridge', plan, stat: directStat.ok ? directStat.data : undefined },
      },
    };
  }

  const matches = Array.isArray(search.data?.matches) ? search.data.matches : [];
  const match = uniqueBestFileSearchMatch(matches, searchTarget.basename);
  if (!match) {
    const detail = matches.length > 1
      ? `multiple matches found for ${searchTarget.basename}; choose the exact file before opening`
      : `no file named ${searchTarget.basename} was found in ${searchTarget.rootPath}`;
    return {
      ok: false,
      result: {
        ok: false,
        message: matches.length > 1 ? simpleOpenPathAmbiguousMessage() : simpleOpenPathNotFoundMessage(),
        warnings: [`Desktop bridge open path needs an exact file match before launch: ${detail}.`],
        data: { adapter: 'desktop_bridge', plan, stat: directStat.ok ? directStat.data : undefined, search: search.data },
      },
    };
  }

  const matchedStat = await bridge.statFile(match.path).catch((error) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
    errorCode: 'unknown' as const,
  }));
  if (!matchedStat.ok || !matchedStat.data?.exists) {
    return {
      ok: false,
      result: {
        ok: false,
        message: simpleOpenPathVerifyMessage(),
        warnings: [`Desktop bridge open path matched a file but could not verify it: ${matchedStat.ok ? 'missing file' : matchedStat.error || 'unknown error'}.`],
        data: { adapter: 'desktop_bridge', plan, search: search.data, stat: matchedStat.ok ? matchedStat.data : undefined },
      },
    };
  }

  return {
    ok: true,
    path: matchedStat.data.path || match.path,
    stat: matchedStat.data,
    warnings: [`Resolved ${searchTarget.basename} via desktop.file_search before open_path.`],
  };
}

async function executeDefaultDesktopBridgeFileTask(task: string, plan: DirectLocalFilePlan): Promise<DirectLocalFileAdapterResult | null> {
  if (plan.mode === 'open_path' && plan.path) {
    const bridge = await import('./desktopBridge');
    const bridgeAvailable = await bridge.isDesktopBridgeAvailable().catch(() => false);
    if (!bridgeAvailable) return null;
    const resolved = await resolveOpenPathBeforeLaunch(bridge, plan);
    if (!resolved.ok) return resolved.result;
    const result = await bridge.openPath(resolved.path, plan.appName ? { appName: plan.appName } : {});
    if (!result.ok) {
      return {
        ok: false,
        message: simpleOpenPathLaunchMessage(),
        warnings: [`Desktop bridge open path failed: ${result.error || 'unknown error'}.`],
        data: { adapter: 'desktop_bridge', plan, resolvedPath: resolved.path, stat: resolved.stat },
      };
    }
    return {
      ok: true,
      message: `Opened ${result.data?.path || resolved.path}${result.data?.appName ? ` in ${result.data.appName}` : ''}.`,
      warnings: resolved.warnings,
      data: { adapter: 'desktop_bridge', plan, resolvedPath: resolved.path, stat: resolved.stat, result: result.data },
    };
  }
  const adapter = await import('./computerFileAdapter');
  return adapter.executeDesktopBridgeFileTask(task);
}

export function directLocalFileToolForMode(mode: string): string | null {
  switch (mode) {
    case 'rename':
      return 'desktop.file_rename';
    case 'copy':
      return 'desktop.file_copy';
    case 'trash':
      return 'desktop.file_trash';
    case 'mkdir':
      return 'desktop.file_mkdir';
    case 'write_text':
      return 'desktop.file_write_text';
    case 'open_path':
      return 'desktop.open_path';
    default:
      return null;
  }
}

export function isDirectLocalFileMode(mode: string): mode is DirectLocalFileMode {
  return DIRECT_LOCAL_FILE_MODES.has(mode);
}

export function routeHasDirectLocalFileActionItems(
  route: Pick<ChatComputerRequestRoute, 'kind' | 'actionItems' | 'sourceMessage'> | null | undefined,
): boolean {
  if (route?.kind !== 'local_file') return false;
  return Boolean(route.actionItems?.some((item) => {
    if (!DIRECT_LOCAL_FILE_TOOLS.has(item.tool)) return false;
    if (item.tool !== 'desktop.open_path') return true;
    return planDirectLocalFileRequest(route.sourceMessage || '').mode === 'open_path';
  }));
}

export async function executeDirectLocalFileRequest(
  task: string,
  executor: DirectLocalFileExecutor = executeDefaultDesktopBridgeFileTask,
): Promise<DirectLocalFileRuntimeOutcome> {
  const plan = planDirectLocalFileRequest(task);
  const tool = directLocalFileToolForMode(plan.mode);
  if (!tool || !isDirectLocalFileMode(plan.mode)) {
    return {
      handled: false,
      status: 'failed',
      message: 'This is not a direct local-file mutation request.',
      warnings: [],
      data: { plan },
    };
  }

  const result = await executor(task, plan);
  if (!result) {
    return {
      handled: true,
      status: 'failed',
      message: 'I need the desktop bridge connected and folder access approved before I can work with that file. Reconnect it, grant the folder, then try again.',
      warnings: [`${tool} blocked because the desktop bridge is unavailable`],
      data: { plan },
    };
  }

  if (!result.ok) {
    return {
      handled: true,
      status: 'failed',
      message: directLocalFileSafeFailureMessage(plan, [
        result.message,
        ...(Array.isArray(result.warnings) ? result.warnings : []),
      ].join('\n')),
      warnings: result.warnings,
      data: {
        plan,
        result: result.data,
      },
    };
  }

  if (!result.data) {
    return {
      handled: true,
      status: 'failed',
      message: 'The file action ran without proof, so I stopped instead of saying it was done.',
      warnings: [`${tool} missing result proof`],
      data: { plan },
    };
  }

  return {
    handled: true,
    status: 'completed',
    message: result.message,
    warnings: result.warnings,
    data: {
      plan,
      result: result.data,
      proofSignals: [
        tool,
        'adapter:desktop_bridge',
        `mode:${plan.mode}`,
        ...(plan.path ? [`path:${plan.path}`] : []),
        ...(plan.appName ? [`app:${plan.appName}`] : []),
      ],
    },
  };
}
