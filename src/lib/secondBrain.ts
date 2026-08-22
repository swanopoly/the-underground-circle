import { supabase } from './supabase';
import { saveMemory, type MemoryEntry, type MemoryScope } from './agentRunSystem';
import { EMBEDDING_MODEL, embedText } from './memoryEmbeddings';
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

export type SecondBrainSearchScope =
  | Readonly<{ mode: 'mine'; userId: string }>
  | Readonly<{ mode: 'circle' }>;

export type SecondBrainSearchOptions = SecondBrainSearchScope & Readonly<{
  limit?: number;
  includeMemories?: boolean;
}>;

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

const SECOND_BRAIN_MEMORY_READ_COLUMNS = [
  'id',
  'circle_id',
  'user_id',
  'scope',
  'memory_kind',
  'title',
  'content',
  'source_surface',
  'is_active',
  'visibility',
  'importance',
  'created_at',
  'updated_at',
  'metadata',
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
    // Missing visibility must fail closed. A legacy or malformed row is never
    // inferred to be circle-shareable.
    visibility: row.visibility === 'circle_shared' ? 'circle_shared' : 'private',
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

export function isCircleShareableSecondBrainNote(
  note: Pick<SecondBrainNote, 'visibility'>,
): boolean {
  return note.visibility === 'circle_shared';
}

export function isCircleShareableSecondBrainMemory(
  memory: Pick<MemoryEntry, 'visibility'>,
): boolean {
  return memory.visibility === 'circle_shared';
}

export function isPersonalSecondBrainMemory(
  memory: Pick<MemoryEntry, 'user_id' | 'visibility'>,
  userId: string,
): boolean {
  return memory.user_id === userId && memory.visibility === 'private';
}

function isSecondBrainNoteInSearchScope(
  note: SecondBrainNote,
  circleId: string,
  scope: SecondBrainSearchScope,
): boolean {
  if (note.circle_id !== circleId) return false;
  return scope.mode === 'circle'
    ? isCircleShareableSecondBrainNote(note)
    : note.created_by === scope.userId;
}

function isSecondBrainMemoryInSearchScope(
  memory: MemoryEntry,
  circleId: string,
  scope: SecondBrainSearchScope,
): boolean {
  if (memory.circle_id !== circleId || memory.is_active !== true) return false;
  return scope.mode === 'circle'
    ? isCircleShareableSecondBrainMemory(memory)
    : isPersonalSecondBrainMemory(memory, scope.userId);
}

export async function loadSecondBrainMemoriesForScope(input: {
  circleId: string;
  userId?: string;
  mode: 'mine' | 'circle';
  limit?: number;
}): Promise<{ memories: MemoryEntry[]; error?: string }> {
  if (!input.circleId) return { memories: [], error: 'A circle is required for Knowledge memory.' };
  if (input.mode === 'mine' && !input.userId?.trim()) {
    return { memories: [], error: 'A signed-in user is required for personal Knowledge memory.' };
  }
  const limit = input.limit || 200;
  try {
    const sharedRequest = supabase
      .from('memory_entries')
      .select(SECOND_BRAIN_MEMORY_READ_COLUMNS)
      .eq('circle_id', input.circleId)
      .eq('is_active', true)
      .eq('visibility', 'circle_shared')
      .order('updated_at', { ascending: false })
      .limit(limit);
    const privateRequest = input.mode === 'mine'
      ? supabase
        .from('memory_entries')
        .select(SECOND_BRAIN_MEMORY_READ_COLUMNS)
        .eq('circle_id', input.circleId)
        .eq('user_id', input.userId as string)
        .eq('is_active', true)
        .eq('visibility', 'private')
        .order('updated_at', { ascending: false })
        .limit(limit)
      : null;
    const [sharedResult, privateResult] = await Promise.all([
      sharedRequest,
      privateRequest || Promise.resolve({ data: [], error: null }),
    ]);
    if (sharedResult.error || privateResult.error) {
      return { memories: [], error: 'Knowledge memory could not be loaded.' };
    }
    const scope: SecondBrainSearchScope = input.mode === 'circle'
      ? { mode: 'circle' }
      : { mode: 'mine', userId: input.userId as string };
    const rows = input.mode === 'circle'
      ? (sharedResult.data || [])
      : [...(sharedResult.data || []), ...(privateResult.data || [])];
    const seen = new Set<string>();
    const memories = (rows as unknown as MemoryEntry[]).filter(memory => {
      if (seen.has(memory.id)) return false;
      const inScope = input.mode === 'circle'
        ? isSecondBrainMemoryInSearchScope(memory, input.circleId, scope)
        : memory.circle_id === input.circleId
          && memory.is_active === true
          && (
            isCircleShareableSecondBrainMemory(memory)
            || isPersonalSecondBrainMemory(memory, input.userId as string)
          );
      if (!inScope) return false;
      seen.add(memory.id);
      return true;
    });
    return { memories };
  } catch {
    return { memories: [], error: 'Knowledge memory could not be loaded.' };
  }
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
  let sourceNote = note;
  if (scope === 'circle') {
    // A circle-memory write is a distinct publication boundary. Never trust a
    // possibly stale client note here: the note must still be explicitly
    // circle-shared immediately before it is promoted.
    if (!isCircleShareableSecondBrainNote(note)) {
      return { memory: null, error: 'Share this note with the circle first, then promote it to circle memory.' };
    }
    const { data, error } = await supabase
      .from('circle_second_brain_notes')
      .select(SECOND_BRAIN_NOTE_READ_COLUMNS)
      .eq('id', note.id)
      .eq('circle_id', note.circle_id)
      .eq('visibility', 'circle_shared')
      .maybeSingle();
    if (error || !data) {
      return { memory: null, error: 'The note is no longer circle-shared. Share it again before promoting it.' };
    }
    sourceNote = normalizeRow(data);
  }
  const memory = await saveMemory({
    scope,
    circleId: sourceNote.circle_id,
    userId: scope === 'user' ? input.userId : undefined,
    memoryKind: sourceNote.note_kind === 'question' ? 'context' : sourceNote.note_kind === 'agent_summary' ? 'finding' : 'fact',
    title: sourceNote.title,
    content: sourceNote.content,
    visibility: scope === 'user' ? 'private' : 'circle_shared',
    importance: Math.max(0.6, Math.min(1, sourceNote.importance || 0.7)),
    retrievalMode: sourceNote.status === 'evergreen' ? 'startup' : 'on_demand',
    sourceSurface: 'backpack_digital_brain',
    metadata: {
      source: 'second_brain_note',
      secondBrainNoteId: sourceNote.id,
      secondBrainTags: sourceNote.tags,
      sourceUrl: sourceNote.metadata?.sourceUrl || null,
    },
  });
  if (!memory) return { memory: null, error: 'Could not save note to memory.' };
  await updateSecondBrainNote(sourceNote.id, {
    status: 'evergreen',
    metadata: {
      ...sourceNote.metadata,
      promotedMemoryId: memory.id,
      promotedAt: new Date().toISOString(),
    },
  });
  await createSecondBrainLink({
    circleId: sourceNote.circle_id,
    fromNoteId: sourceNote.id,
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

async function keywordSearchNotes(
  circleId: string,
  queryText: string,
  limit: number,
  scope: SecondBrainSearchScope,
): Promise<{ notes: SecondBrainNote[]; error?: string }> {
  const escaped = queryText.replace(/[%*,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!escaped) return { notes: [] };
  let query = supabase
    .from('circle_second_brain_notes')
    .select(SECOND_BRAIN_NOTE_READ_COLUMNS)
    .eq('circle_id', circleId)
    .neq('status', 'archived');
  query = scope.mode === 'circle'
    ? query.eq('visibility', 'circle_shared')
    : query.eq('created_by', scope.userId);
  const { data, error } = await query
    .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%,summary.ilike.%${escaped}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error || !data) return { notes: [], error: error?.message || 'Knowledge note search failed.' };
  return {
    notes: data
      .map(normalizeRow)
      .filter(note => isSecondBrainNoteInSearchScope(note, circleId, scope)),
  };
}

async function keywordSearchMemories(
  circleId: string,
  queryText: string,
  limit: number,
  scope: SecondBrainSearchScope,
): Promise<{ memories: MemoryEntry[]; error?: string }> {
  const escaped = queryText.replace(/[%*,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!escaped) return { memories: [] };
  let query = supabase
    .from('memory_entries')
    .select(SECOND_BRAIN_MEMORY_READ_COLUMNS)
    .eq('circle_id', circleId)
    .eq('is_active', true);
  query = scope.mode === 'circle'
    ? query.eq('visibility', 'circle_shared')
    : query.eq('user_id', scope.userId).eq('visibility', 'private');
  const { data, error } = await query
    .or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error || !data) return { memories: [], error: error?.message || 'Knowledge memory search failed.' };
  return {
    memories: (data as unknown as MemoryEntry[])
      .filter(memory => isSecondBrainMemoryInSearchScope(memory, circleId, scope)),
  };
}

export async function searchSecondBrain(
  circleId: string,
  queryText: string,
  opts: SecondBrainSearchOptions,
): Promise<{ results: SecondBrainSearchResult[]; error?: string }> {
  const limit = opts.limit || 12;
  const query = queryText.trim();
  if (!query) return { results: [] };
  if (opts.mode === 'mine' && !opts.userId.trim()) {
    return { results: [], error: 'A signed-in user is required for personal Knowledge search.' };
  }
  const scope: SecondBrainSearchScope = opts.mode === 'circle'
    ? { mode: 'circle' }
    : { mode: 'mine', userId: opts.userId };

  const results: SecondBrainSearchResult[] = [];
  let noteSearchError = '';
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
        if (!isSecondBrainNoteInSearchScope(note, circleId, scope)) continue;
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
    } else if (error) {
      noteSearchError = error.message || 'Semantic note search failed.';
    }
  }

  if (results.length === 0) {
    const keywordResult = await keywordSearchNotes(circleId, query, limit, scope);
    if (keywordResult.error) noteSearchError = keywordResult.error;
    else noteSearchError = '';
    results.push(...keywordResult.notes.map((note) => ({
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

  let memorySearchError = '';
  if (opts.includeMemories !== false) {
    // The legacy semantic-memory RPC does not return user_id or visibility, so
    // it cannot prove Personal vs Circle authority. Use an exactly filtered
    // memory query until that RPC has a scope-aware contract.
    const memoryResult = await keywordSearchMemories(
      circleId,
      query,
      Math.max(4, Math.floor(limit / 2)),
      scope,
    );
    memorySearchError = memoryResult.error || '';
    for (const mem of memoryResult.memories) {
      results.push({
        kind: 'memory',
        id: mem.id,
        title: mem.title,
        content: mem.content,
        source: `agent memory · ${mem.scope}/${mem.memory_kind}`,
        raw: mem,
      });
    }
  }

  const seen = new Set<string>();
  const error = noteSearchError || memorySearchError
    ? 'Knowledge search could not verify every requested source.'
    : undefined;
  return {
    results: results
      .filter((item) => {
        const key = `${item.kind}:${item.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit + 4),
    error,
  };
}

export async function loadSecondBrainAgentBriefInputs(input: {
  circleId: string;
  userId: string;
  mode: 'mine' | 'circle';
}): Promise<{ notes: SecondBrainNote[]; memories: MemoryEntry[]; error?: string }> {
  if (!input.circleId || !input.userId) {
    return { notes: [], memories: [], error: 'A signed-in Knowledge scope is required.' };
  }
  const noteOptions: Parameters<typeof loadSecondBrainNotes>[1] = {
    status: 'active',
    limit: 120,
    ...(input.mode === 'circle'
      ? { visibilityFilter: 'circle_shared' as const }
      : { createdBy: input.userId }),
  };
  const [noteResult, memoryResult] = await Promise.all([
    loadSecondBrainNotes(input.circleId, noteOptions),
    (async () => {
      let query = supabase
        .from('memory_entries')
        .select(SECOND_BRAIN_MEMORY_READ_COLUMNS)
        .eq('circle_id', input.circleId)
        .eq('is_active', true);
      query = input.mode === 'circle'
        ? query.eq('visibility', 'circle_shared')
        : query.eq('user_id', input.userId).eq('visibility', 'private');
      return query.order('updated_at', { ascending: false }).limit(200);
    })(),
  ]);
  if (noteResult.error || memoryResult.error || !Array.isArray(memoryResult.data)) {
    return { notes: [], memories: [], error: 'Brief inputs could not be revalidated.' };
  }
  const scope: SecondBrainSearchScope = input.mode === 'circle'
    ? { mode: 'circle' }
    : { mode: 'mine', userId: input.userId };
  const notes = noteResult.notes.filter(note => isSecondBrainNoteInSearchScope(note, input.circleId, scope));
  const memories = (memoryResult.data as unknown as MemoryEntry[])
    .filter(memory => isSecondBrainMemoryInSearchScope(memory, input.circleId, scope));
  if (input.mode === 'circle' && (
    notes.some(note => !isCircleShareableSecondBrainNote(note))
    || memories.some(memory => !isCircleShareableSecondBrainMemory(memory))
  )) {
    return { notes: [], memories: [], error: 'Circle brief inputs failed visibility validation.' };
  }
  return { notes, memories };
}

export async function buildSecondBrainGraph(
  circleId: string,
  opts?: { userId?: string; mode?: 'mine' | 'circle' },
): Promise<{ graph: SecondBrainGraph; error?: string; missing?: boolean; unavailable?: boolean }> {
  const notesFilter: Parameters<typeof loadSecondBrainNotes>[1] = { status: 'active', limit: 120 };
  if (opts?.mode === 'mine') {
    if (!opts.userId?.trim()) {
      return {
        graph: { notes: [], links: [], clusters: [] },
        error: 'A signed-in user is required for personal Knowledge.',
      };
    }
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
