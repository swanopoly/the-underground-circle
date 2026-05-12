import type { MemoryEntry } from './agentRunSystem';

export interface SecondBrainPromptNote {
  title: string;
  content: string;
  summary?: string | null;
  status?: string;
  note_kind?: string;
  tags?: string[];
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'agent', 'also', 'and', 'are', 'because', 'been', 'being', 'between',
  'build', 'can', 'circle', 'code', 'could', 'dashboard', 'data', 'does', 'done', 'from', 'have',
  'into', 'like', 'make', 'more', 'need', 'notes', 'open', 'other', 'should', 'that', 'their',
  'them', 'then', 'there', 'these', 'this', 'todo', 'using', 'want', 'when', 'where', 'with',
  'within', 'would', 'your',
]);

export function uniqueSecondBrainStrings(values: Array<string | null | undefined>, limit = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^#/, '')
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!normalized || normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

export function extractSecondBrainTags(text: string): string[] {
  const raw = String(text || '');
  const explicit = Array.from(raw.matchAll(/#([a-zA-Z0-9_.-]{2,40})/g)).map((match) => match[1]);
  const words = raw
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .match(/[a-z0-9][a-z0-9_.-]{2,}/g) || [];
  const scored = new Map<string, number>();
  for (const word of words) {
    if (STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
    scored.set(word, (scored.get(word) || 0) + 1);
  }
  const keywords = Array.from(scored.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
  return uniqueSecondBrainStrings([...explicit, ...keywords], 10);
}

export function summarizeSecondBrainContent(content: string, maxLength = 260): string {
  const cleaned = String(content || '')
    .replace(/\s+/g, ' ')
    .replace(/\[[^\]]*\]\(([^)]+)\)/g, '$1')
    .trim();
  if (!cleaned) return '';
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

export function buildSecondBrainTitle(content: string, fallback = 'Untitled brain note'): string {
  const cleaned = String(content || '')
    .split('\n')
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 0) || fallback;
  return cleaned.replace(/\s+/g, ' ').slice(0, 90);
}

export function scoreSecondBrainConnection(
  a: Pick<SecondBrainPromptNote, 'title' | 'content' | 'tags'>,
  b: Pick<SecondBrainPromptNote, 'title' | 'content' | 'tags'>,
): number {
  const aTags = new Set([...(a.tags || []), ...extractSecondBrainTags(`${a.title}\n${a.content}`)]);
  const bTags = new Set([...(b.tags || []), ...extractSecondBrainTags(`${b.title}\n${b.content}`)]);
  if (aTags.size === 0 || bTags.size === 0) return 0;
  let overlap = 0;
  for (const tag of aTags) {
    if (bTags.has(tag)) overlap++;
  }
  const denominator = Math.max(4, Math.min(aTags.size, bTags.size));
  return Math.max(0, Math.min(1, overlap / denominator));
}

export function buildSecondBrainPromptContext(
  notes: SecondBrainPromptNote[],
  memories: Array<Pick<MemoryEntry, 'title' | 'content' | 'memory_kind' | 'scope'>> = [],
): string {
  const noteLines = notes
    .filter((note) => note.status !== 'archived')
    .slice(0, 12)
    .map((note, index) => {
      const tags = note.tags?.length ? ` #${note.tags.slice(0, 5).join(' #')}` : '';
      return `${index + 1}. [${note.status || 'processed'}/${note.note_kind || 'note'}] ${note.title}${tags}\n${summarizeSecondBrainContent(note.summary || note.content, 360)}`;
    });
  const memoryLines = memories.slice(0, 10).map((mem, index) => (
    `${index + 1}. [${mem.scope}/${mem.memory_kind}] ${mem.title}\n${summarizeSecondBrainContent(mem.content, 300)}`
  ));
  return [
    'Circle Digital Brain Context',
    noteLines.length ? `Second-brain notes:\n${noteLines.join('\n')}` : 'Second-brain notes: none yet',
    memoryLines.length ? `Agent memories:\n${memoryLines.join('\n')}` : 'Agent memories: none provided',
  ].join('\n\n');
}
