/**
 * AI file-proposal parser.
 *
 * Closes the "review and apply" gap in the room chat without requiring
 * backend tool gating. The agent is instructed (via the PLAN-mode prefix
 * and a hint in the standard system prompt) to emit any proposed file
 * changes as fenced code blocks in this exact shape:
 *
 *   ```edit:path/to/file.ts
 *   <full content of the file after the change>
 *   ```
 *
 * The parser pulls these blocks out, the chat surface renders an
 * Apply / Reject card per block, and Apply writes the new content into
 * the room_files row.
 */

export interface AiFileProposal {
  filePath: string;
  /** Full file content the agent proposes. */
  content: string;
  /** Match index in the source string — used for stable card keys. */
  index: number;
}

/**
 * Extracts every ```edit:<path>``` block from an AI response. Returns
 * proposals in the order they appear so cards line up with the agent's
 * narrative above each block.
 */
export function parseAiFileProposals(source: string): AiFileProposal[] {
  if (!source) return [];
  const out: AiFileProposal[] = [];
  // Lazy-match the body so back-to-back proposals don't merge into one
  // and the closing ``` is the nearest one.
  const regex = /```edit:([^\n`]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(source)) !== null) {
    const filePath = (match[1] || '').trim();
    const content = match[2] || '';
    if (!filePath) continue;
    out.push({ filePath, content, index: match.index });
  }
  return out;
}

/**
 * Strips the ```edit:``` blocks out of the AI response so the narrative
 * text rendered above the apply cards isn't duplicated. Leaves a single
 * blank line where each block was so paragraphs above and below don't
 * collapse into each other.
 */
export function stripAiFileProposals(source: string): string {
  if (!source) return source;
  return source.replace(/```edit:[^\n`]+\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

export interface ProposalApplyTarget {
  fileId: string;
  fileName: string;
  /** Pre-existing content (used to render a quick line-delta hint). */
  previousContent: string | null;
}

export function describeProposalDelta(prev: string | null | undefined, next: string): {
  addedLines: number;
  removedLines: number;
  totalLines: number;
} {
  const nextLines = next.split('\n').length;
  if (!prev) {
    return { addedLines: nextLines, removedLines: 0, totalLines: nextLines };
  }
  const prevLines = prev.split('\n');
  const newLines = next.split('\n');
  // Quick line-set diff — order-insensitive but fine for a delta hint.
  // For a real visual diff we'd reach for a proper LCS, but most
  // proposals only touch a handful of lines and users can preview the
  // full content before applying.
  const prevSet = new Map<string, number>();
  for (const l of prevLines) prevSet.set(l, (prevSet.get(l) || 0) + 1);
  let added = 0;
  for (const l of newLines) {
    const remaining = prevSet.get(l) || 0;
    if (remaining > 0) prevSet.set(l, remaining - 1);
    else added++;
  }
  const removed = Array.from(prevSet.values()).reduce((s, n) => s + n, 0);
  return { addedLines: added, removedLines: removed, totalLines: newLines.length };
}

export const FILE_PROPOSAL_FORMAT_HINT =
  'When you would change a file, also emit the proposed final content as a fenced code block in this exact format:\n```edit:path/to/file.ext\n<full content of the file after your changes>\n```\nThe team will review each proposal and apply or reject it. Use the same path the user referenced (or the file you would create). Do not omit unchanged sections — emit the entire file content each time so apply is unambiguous.';

export type DiffLine =
  | { kind: 'context'; oldNum: number; newNum: number; text: string }
  | { kind: 'add'; newNum: number; text: string }
  | { kind: 'remove'; oldNum: number; text: string };

/**
 * Line-level LCS diff between two strings. Returns the lines in
 * source order with kind = 'context' | 'add' | 'remove' so the UI
 * can render them inline. O(n*m) — fine for typical room files
 * (a few hundred to a few thousand lines).
 */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = (oldText || '').split('\n');
  const newLines = (newText || '').split('\n');
  const m = oldLines.length;
  const n = newLines.length;
  // LCS DP table
  const lcs: number[][] = [];
  for (let i = 0; i <= m; i++) {
    lcs.push(new Array(n + 1).fill(0));
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }
  // Backtrack to produce diff
  const out: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      out.unshift({ kind: 'context', oldNum: i, newNum: j, text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      out.unshift({ kind: 'add', newNum: j, text: newLines[j - 1] });
      j--;
    } else if (i > 0) {
      out.unshift({ kind: 'remove', oldNum: i, text: oldLines[i - 1] });
      i--;
    } else {
      break;
    }
  }
  return out;
}

export function diffStats(diff: DiffLine[]): { added: number; removed: number; same: number } {
  let added = 0;
  let removed = 0;
  let same = 0;
  for (const line of diff) {
    if (line.kind === 'add') added++;
    else if (line.kind === 'remove') removed++;
    else same++;
  }
  return { added, removed, same };
}
