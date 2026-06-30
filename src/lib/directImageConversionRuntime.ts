import {
  extractDirectLocalImageFormatConversionTask,
  type DirectLocalImageFormatConversionTask,
} from './computerTaskPlanner';
import type { DesktopFileSearchMatch, DesktopFileStat } from './desktopBridge';
import type { DesktopResult } from './desktopBridgeProtocol';

export interface DirectImageConversionProof {
  sourcePath: string;
  outputPath: string;
  format: string;
  bytes: number;
}

export type DirectImageConversionBridge = (
  request: DirectLocalImageFormatConversionTask,
) => Promise<DesktopResult<DirectImageConversionProof>>;

export interface DirectImageConversionBridgeTools {
  convertImage: DirectImageConversionBridge;
  statFile?: (path: string) => Promise<DesktopResult<DesktopFileStat>>;
  searchFiles?: (
    rootPath: string,
    query: string,
    options?: {
      maxResults?: number;
      maxDepth?: number;
      includeContent?: boolean;
      extensions?: string[];
    },
  ) => Promise<DesktopResult<{
    rootPath: string;
    query: string;
    matches: DesktopFileSearchMatch[];
    visited: number;
    searchedContent?: number;
    truncated: boolean;
  }>>;
}

export interface DirectImageConversionRuntimeOutcome {
  handled: boolean;
  status: 'completed' | 'failed';
  message: string;
  warnings: string[];
  data?: {
    request: DirectLocalImageFormatConversionTask;
    proof?: DirectImageConversionProof;
    proofSignals?: string[];
    preflightSignals?: string[];
  };
}

function buildDirectImageConversionFailureMessage(
  request: DirectLocalImageFormatConversionTask,
  result: DesktopResult<DirectImageConversionProof>,
): string {
  switch (result.errorCode) {
    case 'bridge_offline':
    case 'not_paired':
    case 'stale_bridge':
    case 'file_access_not_granted':
    case 'missing_permission':
    case 'permission_denied':
      return 'I could not access the local image tool yet. Reconnect the desktop bridge, approve the requested folder, then try again.';
    case 'file_not_found':
    case 'path_not_found':
      return 'I could not find that image. Check the filename or send the exact file path, then try again.';
    case 'ambiguous_file_match':
      return 'I found more than one matching image. Send the exact file path and I will convert that one.';
    case 'output_conflict':
      return 'A converted image with that name already exists. I stopped instead of overwriting it. Choose a different output name or move the existing file, then try again.';
    case 'path_not_allowed':
      return 'I could not save to that location with the current folder access. Approve that folder or choose a different destination.';
    case 'invalid_input':
      return `I could not understand which image to save as ${request.format.toUpperCase()}. Send the exact file path and format, then try again.`;
    default:
      return `I could not save the image as ${request.format.toUpperCase()}. Check the file and try again.`;
  }
}

function normalizeProof(value: DirectImageConversionProof | undefined | null): DirectImageConversionProof | null {
  const sourcePath = String(value?.sourcePath || '').trim();
  const outputPath = String(value?.outputPath || '').trim();
  const format = String(value?.format || '').trim().toLowerCase();
  const bytes = Number(value?.bytes ?? 0);
  if (!sourcePath || !outputPath || !format || !Number.isFinite(bytes) || bytes <= 0) return null;
  return { sourcePath, outputPath, format, bytes };
}

function normalizeBridge(
  bridge: DirectImageConversionBridge | DirectImageConversionBridgeTools,
): DirectImageConversionBridgeTools {
  return typeof bridge === 'function' ? { convertImage: bridge } : bridge;
}

function sourceLooksScopedPath(source: string): boolean {
  return /^(?:~\/|\/|\.\/|\.\.\/|desktop\/|downloads\/|documents\/|pictures\/|photos\/)/i.test(String(source || '').trim());
}

function sourceBasename(source: string): string {
  const value = String(source || '').trim().replace(/\/+$/g, '');
  const slash = value.lastIndexOf('/');
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function sourceRoot(source: string): string | null {
  const value = String(source || '').trim().replace(/\/+$/g, '');
  const slash = value.lastIndexOf('/');
  if (slash <= 0) return null;
  return value.slice(0, slash);
}

function sourceExtension(source: string): string | null {
  return String(source || '').match(/\.([A-Za-z0-9]{1,12})$/)?.[1]?.toLowerCase() || null;
}

function rootsForSource(task: string, source: string): string[] {
  const explicitRoot = sourceRoot(source);
  if (explicitRoot) return [explicitRoot];
  const text = `${task}\n${source}`.toLowerCase();
  const roots: string[] = [];
  if (/\bdesktop\b|^desktop\//i.test(text)) roots.push('~/Desktop');
  if (/\bdownloads?\b|^downloads\//i.test(text)) roots.push('~/Downloads');
  if (/\bdocuments?\b|^documents\//i.test(text)) roots.push('~/Documents');
  if (/\b(pictures?|photos?)\b|^(pictures|photos)\//i.test(text)) roots.push('~/Pictures');
  if (roots.length > 0) return Array.from(new Set(roots));
  return ['~/Desktop', '~/Downloads', '~/Documents', '~/Pictures'];
}

function bestImageMatch(matches: DesktopFileSearchMatch[], basename: string): DesktopFileSearchMatch | null {
  const expected = basename.trim().toLowerCase();
  if (!expected) return null;
  const exact = matches.filter((match) => String(match.name || '').trim().toLowerCase() === expected);
  if (exact.length === 1) return exact[0] || null;
  if (exact.length > 1) return null;
  return matches.length === 1 ? matches[0] || null : null;
}

async function preflightImageConversionSource(
  task: string,
  request: DirectLocalImageFormatConversionTask,
  bridge: DirectImageConversionBridgeTools,
): Promise<{
  ok: true;
  request: DirectLocalImageFormatConversionTask;
  preflightSignals: string[];
} | {
  ok: false;
  result: DesktopResult<DirectImageConversionProof>;
  preflightSignals: string[];
}> {
  if (!bridge.statFile && !bridge.searchFiles) {
    return { ok: true, request, preflightSignals: [] };
  }

  const source = String(request.source || '').trim();
  const directStat = bridge.statFile
    ? await bridge.statFile(source).catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error || 'unknown error'),
        errorCode: 'unknown' as const,
      }))
    : null;

  if (directStat?.ok && directStat.data?.exists && directStat.data.kind !== 'directory') {
    return {
      ok: true,
      request: { ...request, source: directStat.data.path || source },
      preflightSignals: ['desktop.file_stat:source_exists'],
    };
  }

  const basename = sourceBasename(source);
  const extension = sourceExtension(basename);
  if (!bridge.searchFiles || !basename) {
    if (sourceLooksScopedPath(source) && directStat?.ok && directStat.data?.exists === false) {
      return {
        ok: false,
        result: {
          ok: false,
          error: 'Source image does not exist at the requested path.',
          errorCode: 'file_not_found',
          requiredEvidence: ['desktop.file_search', 'desktop.file_stat'],
        },
        preflightSignals: ['desktop.file_stat:source_missing'],
      };
    }
    return { ok: true, request, preflightSignals: [] };
  }

  const roots = rootsForSource(task, source);
  const matches: DesktopFileSearchMatch[] = [];
  const preflightSignals = directStat ? ['desktop.file_stat:source_not_verified'] : [];
  const searchFailures: Array<DesktopResult<unknown>> = [];
  for (const root of roots) {
    const search = await bridge.searchFiles(root, basename, {
      maxResults: 5,
      maxDepth: 1,
      includeContent: false,
      ...(extension ? { extensions: [extension] } : {}),
    }).catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error || 'unknown error'),
      errorCode: 'unknown' as const,
    }));
    if (!search.ok) {
      searchFailures.push(search);
      preflightSignals.push(`desktop.file_search:${root}:failed`);
      continue;
    }
    preflightSignals.push(`desktop.file_search:${root}:ok`);
    matches.push(...(Array.isArray(search.data?.matches) ? search.data.matches : []));
  }

  const match = bestImageMatch(matches, basename);
  if (!match) {
    if (matches.length > 1) {
      return {
        ok: false,
        result: {
          ok: false,
          error: `Multiple matching images were found for ${basename}.`,
          errorCode: 'ambiguous_file_match',
          requiredEvidence: ['desktop.file_search', 'desktop.file_stat'],
        },
        preflightSignals,
      };
    }
    const firstFailure = searchFailures[0];
    if (searchFailures.length > 0 && searchFailures.length === roots.length) {
      return {
        ok: false,
        result: {
          ok: false,
          error: firstFailure?.error || 'Could not search the approved folders before conversion.',
          errorCode: firstFailure?.errorCode || 'file_access_not_granted',
          requiredEvidence: ['desktop.file_search', 'desktop.file_stat'],
        },
        preflightSignals,
      };
    }
    return {
      ok: false,
      result: {
        ok: false,
        error: `No matching source image named ${basename} was found in the allowed folders.`,
        errorCode: 'file_not_found',
        requiredEvidence: ['desktop.file_search', 'desktop.file_stat'],
      },
      preflightSignals,
    };
  }

  const matchedStat = bridge.statFile
    ? await bridge.statFile(match.path).catch((error) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error || 'unknown error'),
        errorCode: 'unknown' as const,
      }))
    : null;
  if (matchedStat && (!matchedStat.ok || !matchedStat.data?.exists || matchedStat.data.kind === 'directory')) {
    return {
      ok: false,
      result: {
        ok: false,
        error: matchedStat.ok ? 'Matched source image could not be verified.' : matchedStat.error || 'Matched source image stat failed.',
        errorCode: matchedStat.ok ? 'file_not_found' : matchedStat.errorCode || 'unknown',
        requiredEvidence: ['desktop.file_search', 'desktop.file_stat'],
      },
      preflightSignals: [...preflightSignals, 'desktop.file_stat:matched_source_failed'],
    };
  }

  return {
    ok: true,
    request: { ...request, source: matchedStat?.data?.path || match.path },
    preflightSignals: [...preflightSignals, 'desktop.file_stat:matched_source_exists'],
  };
}

export async function executeDirectImageConversionRequest(
  task: string,
  convertImage: DirectImageConversionBridge | DirectImageConversionBridgeTools,
): Promise<DirectImageConversionRuntimeOutcome> {
  const request = extractDirectLocalImageFormatConversionTask(task);
  if (!request) {
    return {
      handled: false,
      status: 'failed',
      message: 'This is not a bounded local image conversion request.',
      warnings: [],
    };
  }

  const bridge = normalizeBridge(convertImage);
  const preflight = await preflightImageConversionSource(task, request, bridge);
  if (!preflight.ok) {
    return {
      handled: true,
      status: 'failed',
      message: buildDirectImageConversionFailureMessage(request, preflight.result),
      warnings: [
        `desktop.convert_image preflight failed${preflight.result.errorCode ? ` (${preflight.result.errorCode})` : ''}${preflight.result.error ? `: ${preflight.result.error}` : ''}`,
        ...preflight.preflightSignals,
      ],
      data: {
        request,
        preflightSignals: preflight.preflightSignals,
      },
    };
  }

  let result: DesktopResult<DirectImageConversionProof>;
  try {
    result = await bridge.convertImage(preflight.request);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'unknown error');
    result = {
      ok: false,
      error: detail,
      errorCode: 'bridge_offline',
    };
  }
  if (!result.ok) {
    return {
      handled: true,
      status: 'failed',
      message: buildDirectImageConversionFailureMessage(request, result),
      warnings: [
        `desktop.convert_image failed${result.errorCode ? ` (${result.errorCode})` : ''}${result.error ? `: ${result.error}` : ''}`,
        ...preflight.preflightSignals,
      ],
      data: {
        request,
        preflightSignals: preflight.preflightSignals,
      },
    };
  }

  const proof = normalizeProof(result.data);
  if (!proof) {
    return {
      handled: true,
      status: 'failed',
      message: 'The image tool did not return output proof, so I stopped instead of saying it was done.',
      warnings: ['desktop.convert_image missing output proof', ...preflight.preflightSignals],
      data: {
        request,
        preflightSignals: preflight.preflightSignals,
      },
    };
  }

  return {
    handled: true,
    status: 'completed',
    message: `Saved ${proof.outputPath} (${proof.format}, ${proof.bytes} bytes).`,
    warnings: [],
    data: {
      request,
      proof,
      preflightSignals: preflight.preflightSignals,
      proofSignals: [
        'desktop.convert_image',
        ...preflight.preflightSignals,
        `outputPath:${proof.outputPath}`,
        `bytes:${proof.bytes}`,
      ],
    },
  };
}
