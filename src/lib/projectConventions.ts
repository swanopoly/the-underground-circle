/**
 * projectConventions — P4's per-turn project-conventions loader
 * (docs/CODING_AGENT_UPGRADE_PLAN.md): injects the ACTIVE local repo's
 * CLAUDE.md / AGENTS.md / .cursorrules into coding turns, the way Claude Code
 * and Cursor ground every turn in the project's own instructions.
 *
 * This is distinct from `openswanContextDiscovery.ts`, which fetches context
 * files over HTTP from the WEB APP's own origin — it can never see the user's
 * local repo. This module reads the repo the user indexed with
 * `codebase.index` (the active codebase root, `codebaseIndexRuntime.ts`)
 * through the desktop bridge, reusing the SAME filename priority order
 * (`resolveContextFilePriority`) so the two loaders never disagree about
 * which file wins.
 *
 * Fails soft everywhere: no active root / bridge offline / no context file →
 * null (the turn simply proceeds without the section). Content is fenced as
 * untrusted per the roadmap's quoted-content rules. A short in-memory TTL
 * cache keeps this from re-reading the file on every message.
 */

import { getActiveCodebaseRoot } from './codebaseIndexRuntime';
import { resolveContextFilePriority } from './openswanContextDiscovery';
import { wrapUntrusted } from './untrustedContent';

/** Chars of the conventions file injected per turn. */
export const PROJECT_CONVENTIONS_MAX_CHARS = 8_000;
const CACHE_TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { block: string | null; at: number }>();

/** Test/dev hook — clears the TTL cache (e.g. after re-indexing). */
export function clearProjectConventionsCache(): void {
  cache.clear();
}

/**
 * Build the `project_conventions` prompt section for the user's active
 * codebase root, or null when there is nothing to inject.
 */
export async function loadProjectConventionsBlock(args: {
  userId: string;
}): Promise<string | null> {
  try {
    const root = await getActiveCodebaseRoot(args.userId);
    if (!root) return null;

    const cached = cache.get(root);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.block;

    const { listFiles, readFile, isDesktopBridgeAvailable } = await import('./desktopBridge');
    if (!(await isDesktopBridgeAvailable())) return null; // don't cache offline

    const listing = await listFiles(root);
    if (!listing.ok || !listing.data) return null;
    const names = (listing.data.entries || [])
      .filter((e) => e.kind === 'file')
      .map((e) => String(e.name || ''));
    const winner = resolveContextFilePriority(names);
    if (!winner) {
      cache.set(root, { block: null, at: Date.now() });
      return null;
    }

    const read = await readFile(`${root}/${winner}`, PROJECT_CONVENTIONS_MAX_CHARS + 2_000);
    const content = read.ok ? (read.data?.content || '').trim() : '';
    if (!content) {
      cache.set(root, { block: null, at: Date.now() });
      return null;
    }

    const block = [
      '## Project Conventions',
      `Loaded from the active codebase root — follow these project rules when reading or editing this repo.`,
      wrapUntrusted(content.slice(0, PROJECT_CONVENTIONS_MAX_CHARS), {
        heading: `${root}/${winner}${content.length > PROJECT_CONVENTIONS_MAX_CHARS ? ' (head)' : ''}`,
      }),
    ].join('\n');

    cache.set(root, { block, at: Date.now() });
    return block;
  } catch {
    return null;
  }
}
