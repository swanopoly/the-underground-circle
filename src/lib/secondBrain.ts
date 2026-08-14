import { supabase } from './supabase';
import { saveMemory, type MemoryEntry, type MemoryScope } from './agentRunSystem';
import { EMBEDDING_MODEL, embedText, semanticSearchMemories } from './memoryEmbeddings';
import {
  buildNextSecondBrainReviewMetadata,
  buildSecondBrainAgentBrief,
  buildSecondBrainBaseViews,
  buildSecondBrainTitle,
  extractSecondBrainTags,
  getSecondBrainReviewState,
  scoreSecondBrainConnection,
  summarizeSecondBrainContent,
  uniqueSecondBrainStrings,
} from './secondBrainCore';

export {
  buildNextSecondBrainReviewMetadata,
  buildSecondBrainAgentBrief,
  buildSecondBrainBaseViews,
  buildSecondBrainPromptContext,
  buildSecondBrainTitle,
  extractSecondBrainTags,
  getSecondBrainReviewState,
  scoreSecondBrainConnection,
  summarizeSecondBrainContent,
  type SecondBrainBaseView,
  type SecondBrainReviewState,
  type SecondBrainReviewUrgency,
} from './secondBrainCore';

export type SecondBrainNoteStatus = 'inbox' | 'processed' | 'evergreen' | 'archived';
export type SecondBrainNoteKind = 'note' | 'inbox' | 'web_clip' | 'agent_summary' | 'memory_digest' | 'question';
export type SecondBrainVisibility = 'private' | 'circle_shared';
export type SecondBrainLinkType = 'related' | 'supports' | 'contradicts' | 'source' | 'next_step' | 'same_topic';

export interface SecondBrainNote {
  id: string;
  circle_id: string;
  created_by: string;
  source_memory_id?: string | null;
  parent_note_id?: string | null;
  status: SecondBrainNoteStatus;
  note_kind: SecondBrainNoteKind;
  visibility: SecondBrainVisibility;
  title: string;
  content: string;
  summary?: string | null;
  tags: string[];
  aliases: string[];
  importance: number;
  metadata: Record<string, unknown>;
  embedding_model?: string | null;
  embedded_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecondBrainLink {
  id: string;
  circle_id: string;
  from_note_id: string;
  to_note_id?: string | null;
  to_memory_id?: string | null;
  link_type: SecondBrainLinkType;
  strength: number;
  reason?: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SecondBrainSearchResult {
  kind: 'note' | 'memory';
  id: string;
  title: string;
  content: string;
  summary?: string | null;
  tags?: string[];
  similarity?: number;
  source?: string;
  raw: SecondBrainNote | MemoryEntry | Record<string, unknown>;
}

export interface SecondBrainCaptureInput {
  circleId: string;
  userId: string;
  title?: string;
  content: string;
  url?: string;
  noteKind?: SecondBrainNoteKind;
  status?: SecondBrainNoteStatus;
  visibility?: SecondBrainVisibility;
  tags?: string[];
  sourceMemoryId?: string | null;
  parentNoteId?: string | null;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export interface SecondBrainGraph {
  notes: SecondBrainNote[];
  links: Array<{
    from: string;
    to: string;
    toKind: 'note' | 'memory';
    label: string;
    strength: number;
    reason: string;
  }>;
  clusters: Array<{ tag: string; count: number; noteIds: string[] }>;
}

// Keep routine reads lightweight and avoid asking PostgREST to serialize the
// pgvector payload. Semantic search still retrieves through the dedicated RPC.
const SECOND_BRAIN_NOTE_READ_COLUMNS = [
  'id',
  'circle_id',
  'created_by',
  'source_memory_id',
  'parent_note_id',
  'status',
  'note_kind',
  'visibility',
  'title',
  'content',
  'summary',
  'tags',
  'aliases',
  'importance',
  'metadata',
  'embedding_model',
  'embedded_at',
  'created_at',
  'updated_at',
].join(',');

const SECOND_BRAIN_UNAVAILABLE_CACHE_KEY = 'openswan:second_brain_unavailable_until';
const SECOND_BRAIN_UNAVAILABLE_REASON_KEY = 'openswan:second_brain_unavailable_reason';
const SECOND_BRAIN_UNAVAILABLE_COOLDOWN_MS = 60_000;

let secondBrainUnavailableUntil = 0;
let secondBrainUnavailableReason = '';

function readStoredSecondBrainUnavailable(): { until: number; reason: string } {
  try {
    if (typeof sessionStorage === 'undefined') return { until: 0, reason: '' };
    const until = Number(sessionStorage.getItem(SECOND_BRAIN_UNAVAILABLE_CACHE_KEY) || 0);
    const reason = sessionStorage.getItem(SECOND_BRAIN_UNAVAILABLE_REASON_KEY) || '';
    return { until: Number.isFinite(until) ? until : 0, reason };
  } catch {
    return { until: 0, reason: '' };
  }
}

function writeStoredSecondBrainUnavailable(until: number, reason: string) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(SECOND_BRAIN_UNAVAILABLE_CACHE_KEY, String(until));
    sessionStorage.setItem(SECOND_BRAIN_UNAVAILABLE_REASON_KEY, reason);
  } catch {}
}

export function getSecondBrainUnavailableMessage(): string | null {
  const stored = readStoredSecondBrainUnavailable();
  const until = Math.max(secondBrainUnavailableUntil, stored.until);
  if (until <= Date.now()) {
    if (secondBrainUnavailableUntil > 0) {
      secondBrainUnavailableUntil = 0;
      secondBrainUnavailableReason = '';
    }
    return null;
  }
  return secondBrainUnavailableReason
    || stored.reason
    || 'Second brain storage is temporarily unavailable.';
}

function classifySecondBrainStorageError(error: any): { missing: boolean; unavailable: boolean; message: string } {
  const status = Number(error?.status || error?.statusCode || 0);
  const code = String(error?.code || '');
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.trim();
  const lower = message.toLowerCase();
  const missing = code === '42P01'
    || code === 'PGRST204'
    || code === 'PGRST205'
    || status === 404
    || lower.includes('does not exist')
    || lower.includes('schema cache')
    || lower.includes('relation');
  const unavailable = missing
    || status >= 500
    || code.startsWith('XX')
    || lower.includes('internal server error')
    || lower.includes('server error')
    || lower.includes('failed to fetch');
  return {
    missing,
    unavailable,
    message: message || 'Second brain storage is temporarily unavailable.',
  };
}

export function rememberSecondBrainStorageError(error: any, fallback = 'Second brain storage is temporarily unavailable.'): boolean {
  const classified = classifySecondBrainStorageError(error);
  if (!classified.unavailable) return false;
  const until = Date.now() + SECOND_BRAIN_UNAVAILABLE_COOLDOWN_MS;
  secondBrainUnavailableUntil = until;
  secondBrainUnavailableReason = classified.message || fallback;
  writeStoredSecondBrainUnavailable(until, secondBrainUnavailableReason);
  return true;
}

function normalizeRow(row: any): SecondBrainNote {
  return {
    id: row.id,
    circle_id: row.circle_id,
    created_by: row.created_by,
    source_memory_id: row.source_memory_id ?? null,
    parent_note_id: row.parent_note_id ?? null,
    status: row.status || 'inbox',
    note_kind: row.note_kind || 'note',
    visibility: row.visibility || 'circle_shared',
    title: row.title || '',
    content: row.content || '',
    summary: row.summary ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    importance: typeof row.importance === 'number' ? row.importance : Number(row.importance ?? 0.5),
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    embedding_model: row.embedding_model ?? null,
    embedded_at: row.embedded_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function normalizeLink(row: any): SecondBrainLink {
  return {
    id: row.id,
    circle_id: row.circle_id,
    from_note_id: row.from_note_id,
    to_note_id: row.to_note_id ?? null,
    to_memory_id: row.to_memory_id ?? null,
    link_type: row.link_type || 'related',
    strength: typeof row.strength === 'number' ? row.strength : Number(row.strength ?? 0.5),
    reason: row.reason ?? null,
    metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    created_at: row.created_at,
  };
}

export async function loadSecondBrainNotes(
  circleId: string,
  opts: {
    status?: SecondBrainNoteStatus | 'active';
    limit?: number;
    createdBy?: string;
    visibilityFilter?: SecondBrainVisibility;
  } = {},
): Promise<{ notes: SecondBrainNote[]; error?: string; missing?: boolean; unavailable?: boolean }> {
  const unavailableMessage = getSecondBrainUnavailableMessage();
  if (unavailableMessage) {
    return { notes: [], error: unavailableMessage, unavailable: true };
  }
  try {
    let query = supabase
      .from('circle_second_brain_notes')
      .select(SECOND_BRAIN_NOTE_READ_COLUMNS)
      .eq('circle_id', circleId)
      .order('updated_at', { ascending: false })
      .limit(opts.limit || 80);
    if (opts.status === 'active') {
      query = query.neq('status', 'archived');
    } else if (opts.status) {
      query = query.eq('status', opts.status);
    }
    if (opts.createdBy) {
      query = query.eq('created_by', opts.createdBy);
    }
    if (opts.visibilityFilter) {
      query = query.eq('visibility', opts.visibilityFilter);
    }
    const { data, error } = await query;
    if (error) {
      const classified = classifySecondBrainStorageError(error);
      if (classified.unavailable) rememberSecondBrainStorageError(error);
      return { notes: [], error: error.message, missing: classified.missing, unavailable: classified.unavailable };
    }
    return { notes: (data || []).map(normalizeRow) };
  } catch (err: any) {
    const classified = classifySecondBrainStorageError(err);
    if (classified.unavailable) rememberSecondBrainStorageError(err);
    return { notes: [], error: err?.message || 'Failed to load second brain notes', missing: classified.missing, unavailable: classified.unavailable };
  }
}

export async function loadSecondBrainLinks(
  circleId: string,
): Promise<{ links: SecondBrainLink[]; error?: string; missing?: boolean; unavailable?: boolean }> {
  const unavailableMessage = getSecondBrainUnavailableMessage();
  if (unavailableMessage) {
    return { links: [], error: unavailableMessage, unavailable: true };
  }
  const { data, error } = await supabase
    .from('circle_second_brain_links')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) {
    const classified = classifySecondBrainStorageError(error);
    if (classified.unavailable) rememberSecondBrainStorageError(error);
    return { links: [], error: error.message, missing: classified.missing, unavailable: classified.unavailable };
  }
  return { links: (data || []).map(normalizeLink) };
}

async function embedAndStoreSecondBrainNote(note: SecondBrainNote): Promise<boolean> {
  const vector = await embedText(`${note.title}\n${note.summary || note.content}`.slice(0, 30000));
  if (!vector) return false;
  const vectorStr = `[${vector.join(',')}]`;
  const { error } = await supabase
    .from('circle_second_brain_notes')
    .update({
      embedding: vectorStr as any,
      embedding_model: EMBEDDING_MODEL,
      embedded_at: new Date().toISOString(),
    })
    .eq('id', note.id);
  if (error) {
    if (!['PGRST204', '42703'].includes((error as any).code)) {
      console.warn('[secondBrain] embedding store failed:', error.message);
    }
    return false;
  }
  return true;
}

export async function createSecondBrainNote(
  input: SecondBrainCaptureInput,
): Promise<{ note: SecondBrainNote | null; error?: string; missing?: boolean; unavailable?: boolean }> {
  const unavailableMessage = getSecondBrainUnavailableMessage();
  if (unavailableMessage) {
    return { note: null, error: unavailableMessage, unavailable: true };
  }
  const content = input.content.trim();
  if (!content) return { note: null, error: 'Note content is required.' };
  const explicitTags = input.tags || [];
  const tags = uniqueSecondBrainStrings([...explicitTags, ...extractSecondBrainTags(`${input.title || ''}\n${content}\n${input.url || ''}`)]);
  const title = (input.title || '').trim() || buildSecondBrainTitle(content, input.url || 'Untitled brain note');
  const noteKind: SecondBrainNoteKind = input.noteKind || (input.url ? 'web_clip' : 'inbox');
  const metadata = {
    ...(input.metadata || {}),
    source: input.metadata?.source || 'backpack_digital_brain',
    sourceUrl: input.url || input.metadata?.sourceUrl || null,
    capturedAt: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('circle_second_brain_notes')
    .insert({
      circle_id: input.circleId,
      created_by: input.userId,
      source_memory_id: input.sourceMemoryId || null,
      parent_note_id: input.parentNoteId || null,
      status: input.status || 'inbox',
      note_kind: noteKind,
      visibility: input.visibility || 'private',
      title: title.slice(0, 140),
      content,
      summary: summarizeSecondBrainContent(content),
      tags,
      importance: Math.max(0, Math.min(1, input.importance ?? 0.62)),
      metadata,
    })
    .select()
    .single();

  if (error) {
    const classified = classifySecondBrainStorageError(error);
    if (classified.unavailable) rememberSecondBrainStorageError(error);
    return { note: null, error: error.message, missing: classified.missing, unavailable: classified.unavailable };
  }

  const note = normalizeRow(data);
  if (input.sourceMemoryId) {
    void createSecondBrainLink({
      circleId: input.circleId,
      fromNoteId: note.id,
      toMemoryId: input.sourceMemoryId,
      linkType: 'source',
      strength: 1,
      reason: 'Created from an existing agent memory.',
    });
  }
  void embedAndStoreSecondBrainNote(note).catch((err) => console.warn('[secondBrain] embed failed:', err));
  return { note };
}

export async function updateSecondBrainNote(
  noteId: string,
  updates: Partial<Pick<SecondBrainNote, 'title' | 'content' | 'summary' | 'tags' | 'status' | 'note_kind' | 'visibility' | 'importance' | 'metadata'>>,
): Promise<{ note: SecondBrainNote | null; error?: string; unavailable?: boolean }> {
  const unavailableMessage = getSecondBrainUnavailableMessage();
  if (unavailableMessage) {
    return { note: null, error: unavailableMessage, unavailable: true };
  }
  const payload: Record<string, unknown> = { ...updates };
  if (typeof updates.content === 'string' && !updates.summary) {
    payload.summary = summarizeSecondBrainContent(updates.content);
  }
  if (updates.tags) payload.tags = uniqueSecondBrainStrings(updates.tags);
  const { data, error } = await supabase
    .from('circle_second_brain_notes')
    .update(payload)
    .eq('id', noteId)
    .select()
    .single();
  if (error) {
    const unavailable = rememberSecondBrainStorageError(error);
    return { note: null, error: error.message, unavailable };
  }
  const note = normalizeRow(data);
  if (updates.title || updates.content || updates.summary) {
    void embedAndStoreSecondBrainNote(note).catch((err) => console.warn('[secondBrain] re-embed failed:', err));
  }
  return { note };
}

export async function createSecondBrainLink(input: {
  circleId: string;
  fromNoteId: string;
  toNoteId?: string | null;
  toMemoryId?: string | null;
  linkType?: SecondBrainLinkType;
  strength?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ link: SecondBrainLink | null; error?: string; unavailable?: boolean }> {
  const unavailableMessage = getSecondBrainUnavailableMessage();
  if (unavailableMessage) {
    return { link: null, error: unavailableMessage, unavailable: true };
  }
  if (!input.toNoteId && !input.toMemoryId) return { link: null, error: 'Link target is required.' };
  const { data, error } = await supabase
    .from('circle_second_brain_links')
    .insert({
      circle_id: input.circleId,
      from_note_id: input.fromNoteId,
      to_note_id: input.toNoteId || null,
      to_memory_id: input.toMemoryId || null,
      link_type: input.linkType || 'related',
      strength: Math.max(0, Math.min(1, input.strength ?? 0.5)),
      reason: input.reason || null,
      metadata: input.metadata || {},
    })
    .select()
    .single();
  if (error) {
    const unavailable = rememberSecondBrainStorageError(error);
    return { link: null, error: error.message, unavailable };
  }
  return { link: normalizeLink(data) };
}

export async function createSecondBrainNoteFromMemory(
  memory: MemoryEntry,
  userId: string,
  fallbackCircleId?: string,
  visibilityOverride?: SecondBrainVisibility,
): Promise<{ note: SecondBrainNote | null; error?: string; missing?: boolean }> {
  const circleId = memory.circle_id || fallbackCircleId;
  if (!circleId) return { note: null, error: 'Memory is not attached to a circle.' };
  return createSecondBrainNote({
    circleId,
    userId,
    sourceMemoryId: memory.id,
    title: memory.title,
    content: [
      memory.content,
      '',
      `Memory source: ${memory.scope}/${memory.memory_kind}`,
      memory.source_surface ? `Surface: ${memory.source_surface}` : '',
    ].filter(Boolean).join('\n'),
    noteKind: 'memory_digest',
    status: 'processed',
    visibility: visibilityOverride || (memory.scope === 'user' || memory.visibility === 'private' ? 'private' : 'circle_shared'),
    tags: extractSecondBrainTags(`${memory.title}\n${memory.content}\n${memory.memory_kind}\n${memory.scope}`),
    importance: Math.max(0.55, Math.min(1, memory.importance || 0.65)),
    metadata: {
      source: 'agent_memory',
      memoryScope: memory.scope,
      memoryKind: memory.memory_kind,
      sourceSurface: memory.source_surface || null,
    },
  });
}

export async function promoteSecondBrainNoteToMemory(
  note: SecondBrainNote,
  input: { userId: string; scope?: Extract<MemoryScope, 'circle' | 'user'> },
): Promise<{ memory: MemoryEntry | null; error?: string }> {
  const scope = input.scope || (note.visibility === 'private' ? 'user' : 'circle');
  const memory = await saveMemory({
    scope,
    circleId: note.circle_id,
    userId: scope === 'user' ? input.userId : undefined,
    memoryKind: note.note_kind === 'question' ? 'context' : note.note_kind === 'agent_summary' ? 'finding' : 'fact',
    title: note.title,
    content: note.content,
    visibility: scope === 'user' ? 'private' : 'circle_shared',
    importance: Math.max(0.6, Math.min(1, note.importance || 0.7)),
    retrievalMode: note.status === 'evergreen' ? 'startup' : 'on_demand',
    sourceSurface: 'backpack_digital_brain',
    metadata: {
      source: 'second_brain_note',
      secondBrainNoteId: note.id,
      secondBrainTags: note.tags,
      sourceUrl: note.metadata?.sourceUrl || null,
    },
  });
  if (!memory) return { memory: null, error: 'Could not save note to memory.' };
  await updateSecondBrainNote(note.id, {
    status: 'evergreen',
    metadata: {
      ...note.metadata,
      promotedMemoryId: memory.id,
      promotedAt: new Date().toISOString(),
    },
  });
  await createSecondBrainLink({
    circleId: note.circle_id,
    fromNoteId: note.id,
    toMemoryId: memory.id,
    linkType: 'source',
    strength: 1,
    reason: 'Promoted from digital brain note to agent memory.',
  });
  return { memory };
}

export async function shareSecondBrainNote(
  noteId: string,
  visibility: SecondBrainVisibility,
): Promise<{ note: SecondBrainNote | null; error?: string }> {
  return updateSecondBrainNote(noteId, { visibility });
}

export async function reviewSecondBrainNote(
  note: SecondBrainNote,
  action: 'reviewed' | 'snoozed' | 'evergreen' = 'reviewed',
): Promise<{ note: SecondBrainNote | null; error?: string }> {
  const metadata = buildNextSecondBrainReviewMetadata(note, action);
  const status = action === 'evergreen'
    ? 'evergreen'
    : note.status === 'inbox'
      ? 'processed'
      : note.status;
  return updateSecondBrainNote(note.id, { status, metadata });
}

async function keywordSearchNotes(circleId: string, queryText: string, limit: number): Promise<SecondBrainNote[]> {
  const escaped = queryText.replace(/[%*,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!escaped) return [];
  const { data, error } = await supabase
    .from('circle_second_brain_notes')
    .select(SECOND_BRAIN_NOTE_READ_COLUMNS)
    .eq('circle_id', circleId)
    .neq('status', 'archived')
    .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%,summary.ilike.%${escaped}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map(normalizeRow);
}

export async function searchSecondBrain(
  circleId: string,
  queryText: string,
  opts: { limit?: number; includeMemories?: boolean } = {},
): Promise<{ results: SecondBrainSearchResult[]; error?: string }> {
  const limit = opts.limit || 12;
  const query = queryText.trim();
  if (!query) return { results: [] };

  const results: SecondBrainSearchResult[] = [];
  const embedding = await embedText(query);
  if (embedding) {
    const { data, error } = await supabase.rpc('match_second_brain_notes', {
      p_query_embedding: `[${embedding.join(',')}]`,
      p_circle_id: circleId,
      p_match_threshold: 0,
      p_match_count: limit,
    });
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const note = normalizeRow(row);
        results.push({
          kind: 'note',
          id: note.id,
          title: note.title,
          content: note.content,
          summary: note.summary,
          tags: note.tags,
          similarity: typeof row.similarity === 'number' ? row.similarity : undefined,
          source: 'semantic',
          raw: note,
        });
      }
    }
  }

  if (results.length === 0) {
    const notes = await keywordSearchNotes(circleId, query, limit);
    results.push(...notes.map((note) => ({
      kind: 'note' as const,
      id: note.id,
      title: note.title,
      content: note.content,
      summary: note.summary,
      tags: note.tags,
      source: 'keyword',
      raw: note,
    })));
  }

  if (opts.includeMemories !== false) {
    const memoryMatches = await semanticSearchMemories({
      queryText: query,
      circleId,
      limit: Math.max(4, Math.floor(limit / 2)),
    }).catch(() => []);
    for (const mem of memoryMatches) {
      results.push({
        kind: 'memory',
        id: mem.id,
        title: mem.title,
        content: mem.content,
        similarity: mem.similarity,
        source: `agent memory · ${mem.scope}/${mem.memory_kind}`,
        raw: mem as any,
      });
    }
  }

  const seen = new Set<string>();
  return {
    results: results
      .filter((item) => {
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit + 4),
  };
}

export async function buildSecondBrainGraph(
  circleId: string,
  opts?: { userId?: string; mode?: 'mine' | 'circle' },
): Promise<{ graph: SecondBrainGraph; error?: string; missing?: boolean; unavailable?: boolean }> {
  const notesFilter: Parameters<typeof loadSecondBrainNotes>[1] = { status: 'active', limit: 120 };
  if (opts?.mode === 'mine' && opts.userId) {
    notesFilter.createdBy = opts.userId;
  } else if (opts?.mode === 'circle') {
    notesFilter.visibilityFilter = 'circle_shared';
  }
  const [notesResult, linksResult] = await Promise.all([
    loadSecondBrainNotes(circleId, notesFilter),
    loadSecondBrainLinks(circleId),
  ]);
  const notes = notesResult.notes;
  const storedLinks = linksResult.links.map((link) => ({
    from: link.from_note_id,
    to: link.to_note_id || link.to_memory_id || '',
    toKind: link.to_note_id ? 'note' as const : 'memory' as const,
    label: link.link_type,
    strength: link.strength,
    reason: link.reason || 'Saved connection',
  })).filter((link) => link.to);

  const inferred: SecondBrainGraph['links'] = [];
  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const strength = scoreSecondBrainConnection(notes[i], notes[j]);
      if (strength >= 0.35) {
        inferred.push({
          from: notes[i].id,
          to: notes[j].id,
          toKind: 'note',
          label: 'same_topic',
          strength,
          reason: `Shared tags: ${notes[i].tags.filter((tag) => notes[j].tags.includes(tag)).slice(0, 4).join(', ')}`,
        });
      }
    }
  }

  const clusterMap = new Map<string, string[]>();
  for (const note of notes) {
    const derivedTags = note.tags.length
      ? note.tags
      : extractSecondBrainTags(`${note.title}\n${note.summary || note.content}`);
    const clusterTags = derivedTags.length
      ? derivedTags
      : [note.note_kind.replace(/_/g, '-'), note.status];
    for (const tag of clusterTags.slice(0, 8)) {
      const list = clusterMap.get(tag) || [];
      list.push(note.id);
      clusterMap.set(tag, list);
    }
  }
  const clusters = Array.from(clusterMap.entries())
    .map(([tag, noteIds]) => ({ tag, count: noteIds.length, noteIds }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 18);

  return {
    graph: {
      notes,
      links: [...storedLinks, ...inferred].slice(0, 180),
      clusters,
    },
    error: notesResult.error || linksResult.error,
    missing: notesResult.missing || linksResult.missing,
    unavailable: notesResult.unavailable || linksResult.unavailable,
  };
}
