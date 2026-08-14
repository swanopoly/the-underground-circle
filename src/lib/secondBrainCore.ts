import type { MemoryEntry } from './agentRunSystem';

export interface SecondBrainPromptNote {
  id?: string;
  title: string;
  content: string;
  summary?: string | null;
  status?: string;
  note_kind?: string;
  tags?: string[];
  importance?: number;
  source_memory_id?: string | null;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export type SecondBrainReviewUrgency = 'due' | 'soon' | 'later' | 'unscheduled';

export interface SecondBrainReviewState {
  urgency: SecondBrainReviewUrgency;
  dueAt: string | null;
  label: string;
  priorityScore: number;
  reviewCount: number;
  intervalDays: number;
}

export interface SecondBrainBaseView {
  id: string;
  title: string;
  description: string;
  queryHint: string;
  color: string;
  count: number;
  noteIds: string[];
}

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'agent', 'also', 'and', 'are', 'because', 'been', 'being', 'between',
  'build', 'can', 'circle', 'code', 'could', 'dashboard', 'data', 'does', 'done', 'from', 'have',
  'into', 'like', 'make', 'more', 'need', 'notes', 'open', 'other', 'should', 'that', 'their',
  'them', 'then', 'there', 'these', 'this', 'todo', 'using', 'want', 'when', 'where', 'with',
  'within', 'would', 'your',
]);

const DAY_MS = 24 * 60 * 60 * 1000;

function readNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function isoAfter(now: number, days: number): string {
  return new Date(now + days * DAY_MS).toISOString();
}

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

export function getSecondBrainReviewState(
  note: SecondBrainPromptNote,
  now = Date.now(),
): SecondBrainReviewState {
  const metadata = note.metadata || {};
  const status = note.status || 'processed';
  if (status === 'archived') {
    return {
      urgency: 'unscheduled',
      dueAt: null,
      label: 'Archived',
      priorityScore: -100,
      reviewCount: readNumber(metadata.reviewCount, 0),
      intervalDays: readNumber(metadata.reviewIntervalDays, 0),
    };
  }

  const reviewCount = Math.max(0, Math.floor(readNumber(metadata.reviewCount, 0)));
  const intervalDays = Math.max(1, Math.floor(readNumber(metadata.reviewIntervalDays, status === 'evergreen' ? 21 : status === 'inbox' ? 1 : 7)));
  const explicitDue = readTime(metadata.reviewDueAt);
  const lastReviewed = readTime(metadata.lastReviewedAt);
  const updatedAt = readTime(note.updated_at) || readTime(note.created_at) || now;
  const fallbackBase = lastReviewed || updatedAt;
  const fallbackDays = status === 'inbox'
    ? 0
    : note.note_kind === 'web_clip'
      ? 3
      : status === 'evergreen'
        ? 21
        : 7;
  const dueMs = explicitDue || (lastReviewed ? fallbackBase + intervalDays * DAY_MS : fallbackBase + fallbackDays * DAY_MS);
  const daysUntil = Math.ceil((dueMs - now) / DAY_MS);
  const daysLate = Math.max(0, Math.ceil((now - dueMs) / DAY_MS));
  const importance = Math.max(0, Math.min(1, readNumber(note.importance, 0.5)));

  const urgency: SecondBrainReviewUrgency = dueMs <= now
    ? 'due'
    : dueMs <= now + 3 * DAY_MS
      ? 'soon'
      : 'later';

  const label = urgency === 'due'
    ? (daysLate <= 1 ? 'Due now' : `${daysLate}d overdue`)
    : urgency === 'soon'
      ? `Due in ${Math.max(1, daysUntil)}d`
      : `Review ${new Date(dueMs).toLocaleDateString()}`;

  return {
    urgency,
    dueAt: new Date(dueMs).toISOString(),
    label,
    priorityScore: (urgency === 'due' ? 100 : urgency === 'soon' ? 50 : 10) + daysLate * 4 + importance * 20 - reviewCount,
    reviewCount,
    intervalDays,
  };
}

export function buildNextSecondBrainReviewMetadata(
  note: SecondBrainPromptNote,
  action: 'reviewed' | 'snoozed' | 'evergreen',
  now = Date.now(),
): Record<string, unknown> {
  const metadata = note.metadata || {};
  const state = getSecondBrainReviewState(note, now);
  const nextCount = state.reviewCount + 1;
  const nextInterval = action === 'snoozed'
    ? 2
    : action === 'evergreen'
      ? Math.max(21, state.intervalDays)
      : Math.min(90, Math.max(3, Math.ceil(state.intervalDays * 1.8)));

  return {
    ...metadata,
    reviewCount: nextCount,
    reviewIntervalDays: nextInterval,
    lastReviewedAt: new Date(now).toISOString(),
    reviewDueAt: isoAfter(now, nextInterval),
    lastReviewAction: action,
  };
}

export function buildSecondBrainBaseViews(
  notes: SecondBrainPromptNote[],
  now = Date.now(),
): SecondBrainBaseView[] {
  const active = notes.filter((note) => note.status !== 'archived');
  const byId = (items: SecondBrainPromptNote[]) => items.map((note) => note.id).filter(Boolean) as string[];
  const due = active
    .filter((note) => {
      const state = getSecondBrainReviewState(note, now);
      return state.urgency === 'due' || state.urgency === 'soon';
    });
  const questions = active.filter((note) => (
    note.note_kind === 'question'
    || /\?\s*$/.test(note.title || '')
    || /\b(how|why|what|when|where|should|could)\b/i.test(`${note.title}\n${note.summary || note.content}`)
  ));
  const fromAgents = active.filter((note) => (
    note.note_kind === 'agent_summary'
    || note.note_kind === 'memory_digest'
    || Boolean(note.source_memory_id)
    || note.metadata?.source === 'agent_memory'
  ));

  const views: Array<Omit<SecondBrainBaseView, 'count' | 'noteIds'> & { notes: SecondBrainPromptNote[] }> = [
    {
      id: 'all-active',
      title: 'All active',
      description: 'Every non-archived node in this circle brain.',
      queryHint: 'status != archived',
      color: '#6366f1',
      notes: active,
    },
    {
      id: 'review-due',
      title: 'Review due',
      description: 'Items that need resurfacing before agents rely on stale context.',
      queryHint: 'reviewDueAt <= next 3 days',
      color: '#f59e0b',
      notes: due,
    },
    {
      id: 'inbox',
      title: 'Inbox',
      description: 'Raw clips and unprocessed captures waiting for cleanup.',
      queryHint: 'status = inbox',
      color: '#fb923c',
      notes: active.filter((note) => note.status === 'inbox'),
    },
    {
      id: 'evergreen',
      title: 'Evergreen',
      description: 'Durable knowledge safe to inject into agent context.',
      queryHint: 'status = evergreen',
      color: '#22c55e',
      notes: active.filter((note) => note.status === 'evergreen'),
    },
    {
      id: 'web-clips',
      title: 'Web clips',
      description: 'Research and sourced web context captured into .web.',
      queryHint: 'note_kind = web_clip',
      color: '#38bdf8',
      notes: active.filter((note) => note.note_kind === 'web_clip'),
    },
    {
      id: 'agent-context',
      title: 'Agent context',
      description: 'Imported memories and summaries created by working agents.',
      queryHint: 'note_kind in (agent_summary, memory_digest)',
      color: '#a855f7',
      notes: fromAgents,
    },
    {
      id: 'open-questions',
      title: 'Open questions',
      description: 'Prompts and uncertainty that should drive future research.',
      queryHint: 'note_kind = question OR contains ?',
      color: '#f43f5e',
      notes: questions,
    },
  ];

  return views.map((view) => ({
    id: view.id,
    title: view.title,
    description: view.description,
    queryHint: view.queryHint,
    color: view.color,
    count: view.notes.length,
    noteIds: byId(view.notes),
  }));
}

function formatBriefNote(note: SecondBrainPromptNote, index: number): string {
  const tags = note.tags?.length ? ` #${note.tags.slice(0, 5).join(' #')}` : '';
  const review = getSecondBrainReviewState(note);
  return `${index + 1}. [${note.status || 'processed'}/${note.note_kind || 'note'} · ${review.label}] ${note.title}${tags}\n${summarizeSecondBrainContent(note.summary || note.content, 360)}`;
}

export function buildSecondBrainAgentBrief(
  notes: SecondBrainPromptNote[],
  memories: Array<Pick<MemoryEntry, 'title' | 'content' | 'memory_kind' | 'scope'>> = [],
  opts: { maxNotes?: number; maxMemories?: number } = {},
): string {
  const maxNotes = opts.maxNotes || 10;
  const maxMemories = opts.maxMemories || 6;
  const active = notes.filter((note) => note.status !== 'archived');
  const reviewQueue = active
    .map((note) => ({ note, state: getSecondBrainReviewState(note) }))
    .filter((item) => item.state.urgency === 'due' || item.state.urgency === 'soon')
    .sort((a, b) => b.state.priorityScore - a.state.priorityScore)
    .map((item) => item.note);
  const evergreen = active
    .filter((note) => note.status === 'evergreen')
    .sort((a, b) => readNumber(b.importance, 0) - readNumber(a.importance, 0));
  const recent = active
    .slice()
    .sort((a, b) => (readTime(b.updated_at) || 0) - (readTime(a.updated_at) || 0));
  const selected: SecondBrainPromptNote[] = [];
  const seen = new Set<string>();
  for (const note of [...reviewQueue, ...evergreen, ...recent]) {
    const key = note.id || `${note.title}:${note.content.slice(0, 32)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(note);
    if (selected.length >= maxNotes) break;
  }

  const noteLines = selected.map(formatBriefNote);
  const memoryLines = memories.slice(0, maxMemories).map((mem, index) => (
    `${index + 1}. [${mem.scope}/${mem.memory_kind}] ${mem.title}\n${summarizeSecondBrainContent(mem.content, 260)}`
  ));
  const dueCount = reviewQueue.length;
  const evergreenCount = evergreen.length;

  return [
    '.web Digital Brain Agent Brief',
    `Generated: ${new Date().toISOString()}`,
    `State: ${active.length} active notes, ${dueCount} review-due items, ${evergreenCount} evergreen notes, ${memories.length} memories available.`,
    'Operating rule: treat evergreen notes as durable context, review-due notes as potentially stale, and inbox notes as raw material that needs confirmation before automation.',
    noteLines.length ? `Priority notes:\n${noteLines.join('\n')}` : 'Priority notes: none yet.',
    memoryLines.length ? `Relevant agent memories:\n${memoryLines.join('\n')}` : 'Relevant agent memories: none loaded.',
    [
      'Suggested next actions:',
      '1. Resolve review-due notes first.',
      '2. Promote stable decisions to evergreen or memory.',
      '3. Link related research before assigning agents.',
      '4. Ask for clarification when inbox-only context conflicts with evergreen context.',
    ].join('\n'),
  ].join('\n\n');
}
