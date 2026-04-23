import { Platform } from 'react-native';
import { storage } from './storage';

type ContextDiscoveryResult = {
  block: string;
  discoveredPaths: string[];
};

const DISCOVERY_CACHE_PREFIX = 'openswan_context_discovery::';
const DISCOVERY_TTL_MS = 10 * 60 * 1000;

/**
 * CA-8h: explicit priority order for project context files. UC prefers
 * `.openswan.md` (a UC-specific manifest lets teams override everything
 * else) → `AGENTS.md` (our canonical plan file per CLAUDE.md/AGENTS.md
 * conventions) → `CLAUDE.md` (project instructions Claude Code reads) →
 * `.cursorrules` (Cursor's convention, still widely used). Legacy
 * Hermes filenames kept at the back so pre-existing projects don't
 * silently lose their context file, but they yield to the UC-first
 * list. First match wins per directory.
 */
export const CONTEXT_FILE_PRIORITY: readonly string[] = [
  '.openswan.md',
  'AGENTS.md',
  'AGENT.md',
  'CLAUDE.md',
  '.cursorrules',
  '.hermes.md',
  'HERMES.md',
];

const ROOT_CANDIDATES = CONTEXT_FILE_PRIORITY;

/**
 * Pure resolver — given the list of context filenames a directory
 * actually contains (case-sensitive), return the highest-priority one
 * per the CONTEXT_FILE_PRIORITY order. Returns null when nothing
 * matches. Exported so smoke tests + any future server-side scanner
 * share one source of truth.
 */
export function resolveContextFilePriority(available: readonly string[]): string | null {
  const set = new Set(available);
  for (const name of CONTEXT_FILE_PRIORITY) {
    if (set.has(name)) return name;
  }
  return null;
}

function normalizeDirectory(input: string): string {
  return input
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function extractDirectories(inputs: string[]): string[] {
  const found = new Set<string>(['']);
  const pathPattern = /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+\b/g;

  for (const input of inputs) {
    const matches = input.match(pathPattern) || [];
    for (const match of matches) {
      const parts = normalizeDirectory(match).split('/');
      if (parts.length < 2) continue;
      parts.pop();
      let current = '';
      for (const part of parts.slice(0, 4)) {
        current = current ? `${current}/${part}` : part;
        found.add(current);
      }
    }
  }

  return Array.from(found).slice(0, 8);
}

async function readCachedBlock(cacheKey: string): Promise<string | null> {
  try {
    const raw = await storage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { block?: string; savedAt?: number };
    if (!parsed?.block || !parsed?.savedAt) return null;
    if (Date.now() - parsed.savedAt > DISCOVERY_TTL_MS) return null;
    return parsed.block;
  } catch {
    return null;
  }
}

async function writeCachedBlock(cacheKey: string, block: string): Promise<void> {
  try {
    await storage.setItem(cacheKey, JSON.stringify({ block, savedAt: Date.now() }));
  } catch {}
}

async function fetchContextFile(pathname: string): Promise<string | null> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const normalized = pathname.startsWith('/') ? pathname : `/${pathname}`;
  try {
    const response = await fetch(`${window.location.origin}${normalized}`, { method: 'GET' });
    if (!response.ok) return null;
    const text = (await response.text()).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

export async function discoverOpenSwanProjectContext(args: {
  currentMessage?: string;
  chatHistory?: string;
  conversationMessages?: Array<{ role: string; content: string }>;
}): Promise<ContextDiscoveryResult> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return { block: '', discoveredPaths: [] };
  }

  const inputs = [
    args.currentMessage || '',
    args.chatHistory || '',
    ...(args.conversationMessages || []).map((message) => message.content || ''),
  ].filter(Boolean);

  const directories = extractDirectories(inputs);
  const cacheKey = `${DISCOVERY_CACHE_PREFIX}${directories.join('|')}`;
  const cached = await readCachedBlock(cacheKey);
  if (cached) {
    return { block: cached, discoveredPaths: directories };
  }

  const sections: string[] = [];

  for (const directory of directories) {
    for (const candidate of ROOT_CANDIDATES) {
      const path = directory ? `${directory}/${candidate}` : candidate;
      const text = await fetchContextFile(path);
      if (!text) continue;
      const label = directory ? `${directory}/${candidate}` : candidate;
      const limit = directory ? 2200 : 5000;
      sections.push(`## Project Context · ${label}\n${text.slice(0, limit)}`);
      break;
    }
  }

  const block = sections.join('\n\n').slice(0, 8000);
  if (block) {
    await writeCachedBlock(cacheKey, block);
  }

  return {
    block,
    discoveredPaths: directories,
  };
}

