/**
 * Builder revision history
 *
 * Tracks the last N webpage/code artifacts per chat thread so users can
 * revert to a prior build instead of re-prompting. Storage is localStorage
 * only — no DB writes — because this is scratch state the user doesn't
 * need shared across devices (yet). Cap at 10 revisions per thread,
 * newest-first. When a new revision pushes past the cap, we drop the
 * oldest.
 *
 * Each revision snapshots the full artifact plus an optional `brief`
 * (the prompt that produced it) so the strip in the Builder header can
 * show something meaningful instead of just the title.
 */

import type { SwanBotStructuredArtifact } from './swanbot';
import { storage } from './storage';

export const BUILDER_HISTORY_STORAGE_KEY = 'uc_builder_history';
const MAX_REVISIONS = 10;

export interface BuilderRevision {
  id: string;
  createdAt: string;           // ISO
  brief: string | null;
  artifact: SwanBotStructuredArtifact;
}

function historyKey(threadId: string): string {
  return `${BUILDER_HISTORY_STORAGE_KEY}_${threadId}`;
}

function isPreviewable(artifact: SwanBotStructuredArtifact | null | undefined): boolean {
  if (!artifact) return false;
  if (artifact.kind !== 'webpage' && artifact.kind !== 'code') return false;
  return typeof artifact.content === 'string' && artifact.content.length > 0;
}

export async function loadBuilderHistory(threadId: string | null | undefined): Promise<BuilderRevision[]> {
  if (!threadId) return [];
  try {
    const raw = await storage.getItem(historyKey(threadId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r: unknown): r is BuilderRevision => {
        if (!r || typeof r !== 'object') return false;
        const rev = r as Partial<BuilderRevision>;
        return typeof rev.id === 'string'
          && typeof rev.createdAt === 'string'
          && isPreviewable(rev.artifact);
      })
      .slice(0, MAX_REVISIONS);
  } catch {
    return [];
  }
}

/** Push a new revision onto the stack. Newest-first. Deduplicates by
 * content hash so streaming the same build twice doesn't spam history. */
export async function pushBuilderRevision(
  threadId: string | null | undefined,
  artifact: SwanBotStructuredArtifact | null | undefined,
  brief: string | null = null,
): Promise<BuilderRevision[]> {
  if (!threadId || !isPreviewable(artifact)) return [];
  const existing = await loadBuilderHistory(threadId);
  const newContent = (artifact!.content || '').trim();
  // Dedup: if the most recent revision already has this exact content,
  // skip. Users re-clicking the same artifact shouldn't create fake history.
  if (existing[0] && (existing[0].artifact.content || '').trim() === newContent) {
    return existing;
  }
  const next: BuilderRevision[] = [
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
      brief: brief?.trim() || null,
      artifact: artifact!,
    },
    ...existing,
  ].slice(0, MAX_REVISIONS);
  try {
    await storage.setItem(historyKey(threadId), JSON.stringify(next));
  } catch {
    // Storage full or unavailable — not fatal; history just won't persist.
  }
  return next;
}

export async function clearBuilderHistory(threadId: string | null | undefined): Promise<void> {
  if (!threadId) return;
  try { await storage.removeItem(historyKey(threadId)); } catch {}
}

export async function removeBuilderRevision(
  threadId: string | null | undefined,
  revisionId: string,
): Promise<BuilderRevision[]> {
  if (!threadId) return [];
  const existing = await loadBuilderHistory(threadId);
  const next = existing.filter(r => r.id !== revisionId);
  try { await storage.setItem(historyKey(threadId), JSON.stringify(next)); } catch {}
  return next;
}

/** Relative time formatter for the strip ("2m", "3h", "Apr 12"). */
export function describeRevisionAge(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return 'now';
  if (delta < 60 * 60_000) return `${Math.round(delta / 60_000)}m`;
  if (delta < 24 * 60 * 60_000) return `${Math.round(delta / 3_600_000)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
