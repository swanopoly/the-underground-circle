/**
 * computerRunDiff — pure owner for "what changed since the last run" on
 * repeated computer tasks (Phase 5c of
 * `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`).
 *
 * Re-running the same browser task ("check flight prices again") used to
 * re-dump the full findings list, leaving the user to eyeball the diff.
 * This module compares a run's structured findings against the previous
 * completed run of the SAME normalized task and produces a compact
 * change-first summary — the monitoring-with-memory pattern: say what
 * changed, or say explicitly that nothing did.
 *
 * Callers do the I/O (ChatTab fetches the previous `computer_use_runs` row
 * today; a future scheduler reuses this module unchanged). Pure —
 * smoke-testable via tsx (`npm run smoke:computer-run-diff`).
 */

import { formatChatAttentionDuration } from './chatAttentionQueue';

export type ComputerRunFindingLike = {
  title: string;
  url?: string | null;
  price?: string | null;
  rating?: string | null;
  notes?: string | null;
};

export type ComputerRunPriceChange = {
  title: string;
  before: string;
  after: string;
};

export type ComputerRunFindingsDiff = {
  added: ComputerRunFindingLike[];
  removed: ComputerRunFindingLike[];
  priceChanged: ComputerRunPriceChange[];
  unchangedCount: number;
  hasChanges: boolean;
};

/**
 * Task-text normalization for "same task?" matching. Kept in LOCKSTEP with
 * `normalizeTaskForReplay` in `supabase/functions/computer-use-agent/index.ts`
 * (the guided-replay matcher) so diffing and replay agree on what counts as
 * a re-run.
 */
export function normalizeComputerTaskForComparison(task: string | null | undefined): string {
  return String(task || '')
    .toLowerCase()
    .replace(/^run this computer task exactly as written:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Identity key for a finding: URL when present (host+path, query stripped), else title. */
function findingKey(finding: ComputerRunFindingLike): string {
  const url = String(finding.url || '').trim().toLowerCase();
  if (url) {
    const match = url.match(/^[a-z]+:\/\/(?:www\.)?([^?#]+)/i);
    if (match) return `url:${match[1].replace(/\/+$/, '')}`;
  }
  return `title:${String(finding.title || '').trim().toLowerCase()}`;
}

function normalizedPrice(finding: ComputerRunFindingLike): string {
  return String(finding.price || '').replace(/\s+/g, ' ').trim();
}

export function diffComputerRunFindings(
  previous: ComputerRunFindingLike[] | null | undefined,
  current: ComputerRunFindingLike[] | null | undefined,
): ComputerRunFindingsDiff {
  const prev = (previous || []).filter((f) => f && f.title);
  const curr = (current || []).filter((f) => f && f.title);
  const prevByKey = new Map(prev.map((f) => [findingKey(f), f] as const));
  const currByKey = new Map(curr.map((f) => [findingKey(f), f] as const));

  const added = curr.filter((f) => !prevByKey.has(findingKey(f)));
  const removed = prev.filter((f) => !currByKey.has(findingKey(f)));
  const priceChanged: ComputerRunPriceChange[] = [];
  let unchangedCount = 0;
  for (const [key, currFinding] of currByKey) {
    const prevFinding = prevByKey.get(key);
    if (!prevFinding) continue;
    const before = normalizedPrice(prevFinding);
    const after = normalizedPrice(currFinding);
    if (before && after && before !== after) {
      priceChanged.push({ title: String(currFinding.title).slice(0, 90), before, after });
    } else {
      unchangedCount += 1;
    }
  }

  return {
    added,
    removed,
    priceChanged,
    unchangedCount,
    hasChanges: added.length > 0 || removed.length > 0 || priceChanged.length > 0,
  };
}

/**
 * One compact, change-first block for the completion message. Empty string
 * when there was nothing to compare against (first run of a task).
 */
export function formatComputerRunDiffSummary(
  diff: ComputerRunFindingsDiff | null | undefined,
  opts: { previousAgeMs?: number | null } = {},
): string {
  if (!diff) return '';
  const age = typeof opts.previousAgeMs === 'number' && Number.isFinite(opts.previousAgeMs) && opts.previousAgeMs >= 0
    ? ` (${formatChatAttentionDuration(opts.previousAgeMs)} ago)`
    : '';

  if (!diff.hasChanges) {
    return `**No changes since the last run${age}.** Same ${diff.unchangedCount} item${diff.unchangedCount === 1 ? '' : 's'} as before.`;
  }

  const headBits: string[] = [];
  if (diff.added.length > 0) headBits.push(`${diff.added.length} new`);
  if (diff.priceChanged.length > 0) headBits.push(`${diff.priceChanged.length} price change${diff.priceChanged.length === 1 ? '' : 's'}`);
  if (diff.removed.length > 0) headBits.push(`${diff.removed.length} gone`);

  const lines = [`**Since the last run${age}: ${headBits.join(' · ')}.**`];
  for (const change of diff.priceChanged.slice(0, 3)) {
    lines.push(`• Price: ${change.title} — ${change.before} → ${change.after}`);
  }
  for (const finding of diff.added.slice(0, 3)) {
    const price = normalizedPrice(finding);
    lines.push(`• New: ${String(finding.title).slice(0, 90)}${price ? ` — ${price}` : ''}`);
  }
  for (const finding of diff.removed.slice(0, 2)) {
    lines.push(`• Gone: ${String(finding.title).slice(0, 90)}`);
  }
  return lines.join('\n').slice(0, 700);
}
