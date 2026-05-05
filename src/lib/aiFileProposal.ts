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
