/**
 * Agent Memory System
 *
 * Persistent memory that survives across sessions. The agent remembers
 * user preferences, project decisions, findings, and context.
 *
 * Architecture (inspired by Mem0, Letta, ChatGPT Memory):
 * - Extraction: LLM analyzes conversation and extracts memory-worthy facts
 * - Dedup: new memories are checked against existing ones for contradictions
 * - Storage: Supabase memory_entries table with scope hierarchy
 * - Retrieval: loaded into system prompt at session start
 * - Management: user can view, edit, delete memories
 */

import { supabase } from './supabase';
import {
  saveMemory,
  loadMemories,
  type MemoryScope,
  type MemoryKind,
  type MemoryEntry,
} from './agentRunSystem';
import { decideSoulMemoryRouting, type SoulMemoryRouting } from './agentSoulMemory';
import { embedAndStoreMemory } from './memoryEmbeddings';

// ── Soul Link Persistence ───────────────────────────────────────────────────
// Phase 0 of AGENT_MEMORY_GOD_PLAN: every freshly-saved memory gets routed
// through `decideSoulMemoryRouting` and the result is persisted both in the
// new `memory_soul_links` table (structured ownership) and the existing
// `metadata.soul_key`/`metadata.relevant_souls` fields (so the current panel
// UI keeps working without a concurrent refactor).

interface SoulLinkRow {
  memory_id: string;
  soul_key: string;
  role: 'primary' | 'shared' | 'reference';
  ownership_mode: SoulMemoryRouting['ownershipMode'];
  confidence: number;
  rationale: string;
  circle_id: string | null | undefined;
}

function buildSoulLinkRows(
  memoryId: string,
  circleId: string | null | undefined,
  routing: SoulMemoryRouting,
): SoulLinkRow[] {
  // agent_core memories intentionally have no SOUL link — they belong to
  // the agent as a whole. Persist the decision in metadata instead.
  if (routing.ownershipMode === 'agent_core' || !routing.primarySoulKey) return [];

  const rows: SoulLinkRow[] = [{
    memory_id: memoryId,
    soul_key: routing.primarySoulKey,
    role: 'primary',
    ownership_mode: routing.ownershipMode,
    confidence: Math.max(0, Math.min(1, routing.confidence)),
    rationale: routing.rationale,
    circle_id: circleId,
  }];

  if (routing.ownershipMode === 'shared_multi') {
    for (const key of routing.relevantSoulKeys) {
      if (!key || key === routing.primarySoulKey) continue;
      rows.push({
        memory_id: memoryId,
        soul_key: key,
        role: 'shared',
        ownership_mode: 'shared_multi',
        confidence: Math.max(0, Math.min(1, routing.confidence * 0.85)),
        rationale: routing.rationale,
        circle_id: circleId,
      });
    }
  }
  return rows;
}

async function persistSoulRouting(
  memory: MemoryEntry,
  routing: SoulMemoryRouting,
): Promise<void> {
  // 1. The new authoritative store — the join table
  const rows = buildSoulLinkRows(memory.id, memory.circle_id, routing);
  if (rows.length > 0) {
    const { error } = await supabase.from('memory_soul_links').insert(rows);
    if (error && error.code !== 'PGRST205') {
      // PGRST205 = table not yet in the schema cache (migration not run)
      console.warn('[AgentMemory] soul link insert failed:', error.message);
    }
  }

  // 2. Back-compat mirror in metadata — the panel still reads these keys
  //    (AgentMemoryPanel.dedupeMemoryGroups + getRelevantSouls). Drop once
  //    the panel migrates to the memory_with_souls view.
  try {
    const existingMeta = (memory.metadata && typeof memory.metadata === 'object')
      ? { ...memory.metadata }
      : {};
    const mirrored = {
      ...existingMeta,
      soul_key: routing.primarySoulKey,
      relevant_souls: routing.relevantSoulKeys,
      ownership_mode: routing.ownershipMode,
      soul_confidence: routing.confidence,
    };
    await supabase
      .from('memory_entries')
      .update({ metadata: mirrored })
      .eq('id', memory.id);
  } catch (err) {
    console.warn('[AgentMemory] metadata soul mirror failed:', err);
  }
}

// ── Memory Extraction ───────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

interface ExtractedMemory {
  kind: MemoryKind;
  title: string;
  content: string;
}

function parseExtractedMemories(text: string): ExtractedMemory[] {
  const cleaned = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
  const candidates = [cleaned];
  const jsonArrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch && jsonArrayMatch[0] !== cleaned) {
    candidates.push(jsonArrayMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) continue;
      return parsed.filter((m: any) =>
        m.kind && m.title && m.content &&
        ['preference', 'fact', 'decision', 'finding', 'instruction', 'policy', 'context'].includes(m.kind)
      ).slice(0, 10);
    } catch {}
  }

  return [];
}

/**
 * Extract memories from a conversation using LLM analysis.
 * Uses Gemini Flash for cheap, fast extraction.
 */
export async function extractMemoriesFromConversation(
  messages: Array<{ role: string; text: string }>,
  existingMemories: MemoryEntry[],
): Promise<ExtractedMemory[]> {
  if (!GEMINI_API_KEY || messages.length < 2) return [];

  const existingStr = existingMemories.length > 0
    ? `\nExisting memories (update or replace if contradicted):\n${existingMemories.map(m => `- [${m.memory_kind}] ${m.title}: ${m.content}`).join('\n')}`
    : '';

  const conversationStr = messages.slice(-20).map(m =>
    `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text.slice(0, 300)}`
  ).join('\n');

  const prompt = `You are a memory extraction system. Analyze this conversation and extract DURABLE facts — things that will still be true and useful weeks from now.

EXTRACT (high-value, specific, long-lived):
- Decisions: "Chose Postgres over DynamoDB because of RLS support"
- Preferences: "User wants TypeScript strict mode, no any"
- Instructions: "Never suggest Kubernetes — solo founder context"
- Project facts: "Stack is React Native + Expo 54 + Supabase"
- Corrections: "The auth middleware was broken, not the JWT"
- Team patterns: "Sprint cadence is 2 weeks, retro on Fridays"

DO NOT EXTRACT (low-value, ephemeral, obvious):
- Greetings, thanks, "sounds good", casual chat
- Questions that were fully answered (extract the ANSWER, not the question)
- Code being written right now (it's in git, not memory)
- Obvious facts derivable from the codebase
- Anything that duplicates existing memories below
${existingStr}

Quality bar: if removing a candidate wouldn't hurt a future conversation, don't extract it. Prefer 2 great memories over 5 mediocre ones.

Conversation:
${conversationStr}

Return a JSON array (max 5 items, fewer is fine). Each object:
- kind: one of "preference", "fact", "decision", "finding", "instruction"
- title: short label (under 60 chars, no filler words)
- content: the actual information (under 200 chars, specific and prescriptive)

Return [] if nothing worth remembering. Return ONLY the JSON array.`;

  try {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1024, temperature: 0.1 },
        }),
      },
    );

    if (!resp.ok) return [];
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = parseExtractedMemories(text);
    return parsed;
  } catch (e) {
    console.warn('[AgentMemory] Extraction failed:', e);
    return [];
  }
}

// ── Auto-Extract and Save ───────────────────────────────────────────────────

/**
 * Run memory extraction on a conversation and save results.
 * Deduplicates against existing, quality-gates candidates, detects contradictions.
 */
export async function autoExtractAndSave(
  circleId: string,
  userId: string,
  messages: Array<{ role: string; text: string }>,
): Promise<{ saved: number; updated: number; rejected: number }> {
  // Load existing memories for dedup (scoped to this user for user memories)
  const existing = await loadMemories({ circleId, userId, scopes: ['circle', 'user'], limit: 100 });

  // Extract new memories
  const extracted = await extractMemoriesFromConversation(messages, existing);
  if (extracted.length === 0) return { saved: 0, updated: 0, rejected: 0 };

  let saved = 0;
  let updated = 0;
  let rejected = 0;

  // Import quality gate
  let isHighQuality: (c: { kind: string; title: string; content: string }) => boolean;
  try {
    const mod = await import('./memoryConsolidation');
    isHighQuality = mod.isHighQualityMemory;
  } catch {
    isHighQuality = () => true; // fallback: accept all
  }

  for (const mem of extracted) {
    // Quality gate: reject noise
    if (!isHighQuality(mem)) { rejected++; continue; }
    // Improved dedup: check title similarity + content overlap
    const titleLower = mem.title.toLowerCase();
    const contentLower = mem.content.toLowerCase();
    const duplicate = existing.find(e => {
      const eTitleLower = e.title.toLowerCase();
      const eContentLower = e.content.toLowerCase();
      // Exact title match
      if (eTitleLower === titleLower) return true;
      // Title contains the other
      if (eTitleLower.includes(titleLower) || titleLower.includes(eTitleLower)) return true;
      // Content substantially overlaps (>60% of shorter string)
      const shorter = contentLower.length < eContentLower.length ? contentLower : eContentLower;
      const longer = contentLower.length < eContentLower.length ? eContentLower : contentLower;
      if (shorter.length > 20 && longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.6)))) return true;
      return false;
    });

    if (duplicate) {
      // Update existing memory — supersedes the old version
      try {
        const { error } = await supabase
          .from('memory_entries')
          .update({
            content: mem.content,
            memory_kind: mem.kind,
            updated_at: new Date().toISOString(),
          })
          .eq('id', duplicate.id);
        if (error) {
          console.warn('[AgentMemory] Update failed:', error.message);
          rejected++;
        } else {
          updated++;
          // Content changed → existing embedding is stale. Re-embed in the
          // background so semantic retrieval reflects the current wording.
          void embedAndStoreMemory({
            memoryId: duplicate.id,
            title: duplicate.title,
            content: mem.content,
          }).catch(err => console.warn('[AgentMemory] re-embed failed (non-fatal):', err));
        }
      } catch (e) {
        console.warn('[AgentMemory] Update error:', e);
        rejected++;
      }
    } else {
      // Save new memory with proper scope, importance, and retrieval mode.
      // NOTE: scope (user/circle/agent/…) answers "who owns this row in the
      // visibility sense"; soul routing is a separate dimension that answers
      // "which persona(s) is this memory about." Both are captured.
      const scope: MemoryScope = ['preference', 'instruction'].includes(mem.kind) ? 'user' : 'circle';
      const importance = mem.kind === 'instruction' ? 0.9 : mem.kind === 'decision' ? 0.8 : mem.kind === 'preference' ? 0.7 : 0.5;
      const retrievalMode = ['instruction', 'preference'].includes(mem.kind) ? 'startup' : 'on_demand';

      const result = await saveMemory({
        scope,
        circleId,
        userId: scope === 'user' ? userId : undefined,
        memoryKind: mem.kind as MemoryKind,
        title: mem.title,
        content: mem.content,
        sourceSurface: 'main_chat',
        importance,
        retrievalMode: retrievalMode as any,
        visibility: scope === 'user' ? 'private' : 'circle_shared',
      });

      if (result) {
        // Phase 0: route to SOUL(s) and persist the links. The router
        // inspects the memory content and picks 0–3 SOULs; agent_core
        // memories get no link at all (they belong to the agent itself).
        try {
          const routing = decideSoulMemoryRouting({
            text: `${mem.title}\n${mem.content}`,
          });
          await persistSoulRouting(result, routing);
        } catch (err) {
          console.warn('[AgentMemory] soul routing failed (non-fatal):', err);
        }

        // Phase 1: embed for semantic retrieval. Fire-and-forget — we never
        // block the user's turn on an embedding call. Failures leave the row
        // un-embedded; the next backfill pass will catch it.
        void embedAndStoreMemory({
          memoryId: result.id,
          title: mem.title,
          content: mem.content,
        }).catch(err => console.warn('[AgentMemory] embed failed (non-fatal):', err));

        saved++;
      } else {
        rejected++;
      }
    }
  }

  // Run consolidation after extraction to merge duplicates
  try {
    const { consolidateMemories } = await import('./memoryConsolidation');
    await consolidateMemories(circleId);
  } catch {}

  return { saved, updated, rejected };
}

// ── Memory Management (User-Facing) ─────────────────────────────────────────

/**
 * Get all memories for a user, grouped by scope and kind.
 */
export async function getUserMemories(
  circleId: string,
  userId?: string,
  agentId?: string,
): Promise<{
  circle: MemoryEntry[];
  agent: MemoryEntry[];
  user: MemoryEntry[];
  session: MemoryEntry[];
  total: number;
}> {
  const scopes: MemoryScope[] = agentId ? ['circle', 'agent', 'user', 'session'] : ['circle', 'user', 'session'];
  const all = await loadMemories({ circleId, userId, agentId, scopes, limit: 200 });

  const circle = all.filter(m => m.scope === 'circle');
  const agent = all.filter(m => m.scope === 'agent');
  const user = all.filter(m => m.scope === 'user');
  const session = all.filter(m => m.scope === 'session');

  return { circle, agent, user, session, total: all.length };
}

/**
 * Edit a memory's content.
 *
 * If `editReason` is provided OR the content actually changes, the
 * `record_memory_edit` RPC is used to write a version-history row
 * BEFORE updating, so the prior body is preserved. The RPC is atomic
 * — a partial write can't leave version-and-memory state out of sync.
 *
 * Falls back to a direct UPDATE for kind/retrieval_mode-only changes
 * (those don't need versioning) and when the migration hasn't been
 * applied yet (PGRST202 = function not found).
 */
export async function editMemory(
  memoryId: string,
  updates: {
    title?: string;
    content?: string;
    memory_kind?: MemoryKind;
    retrieval_mode?: 'startup' | 'on_demand' | 'manual_only';
    editReason?: string;
  },
): Promise<boolean> {
  const { editReason, ...rest } = updates;
  const isContentChange = typeof rest.content === 'string';

  // Versioned path — only when the content is actually being edited.
  if (isContentChange) {
    try {
      const { error: rpcErr } = await supabase.rpc('record_memory_edit', {
        p_memory_id: memoryId,
        p_new_content: rest.content!,
        p_new_title: rest.title ?? null,
        p_edit_reason: editReason ?? null,
      });
      if (!rpcErr) {
        // Pick up any non-versioned fields the RPC doesn't touch.
        if (rest.memory_kind || rest.retrieval_mode) {
          await supabase
            .from('memory_entries')
            .update({
              ...(rest.memory_kind ? { memory_kind: rest.memory_kind } : {}),
              ...(rest.retrieval_mode ? { retrieval_mode: rest.retrieval_mode } : {}),
              updated_at: new Date().toISOString(),
            })
            .eq('id', memoryId);
        }
        return true;
      }
      // PGRST202 = RPC missing (migration not run yet) → fall through.
      if ((rpcErr as any).code !== 'PGRST202') {
        console.warn('[editMemory] record_memory_edit failed:', rpcErr.message);
      }
    } catch (err) {
      console.warn('[editMemory] record_memory_edit threw:', err);
    }
  }

  // Fallback / non-content edit path.
  const { error } = await supabase
    .from('memory_entries')
    .update({ ...rest, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
  return !error;
}

export interface MemoryVersion {
  id: string;
  memory_id: string;
  body: string;
  title: string | null;
  edited_by: string | null;
  edited_at: string;
  edit_reason: string | null;
}

/**
 * Render a soul's memories as a single Markdown document. Same format as
 * `.agent-memory/context.md` so users can drop the file into an Obsidian
 * vault, a Cursor workspace, or any tool that consumes plain Markdown.
 *
 * Memories are grouped by kind (decisions / policies / preferences /
 * facts / findings / instructions / context), ordered by importance
 * within each group, and tagged with relative date + importance score
 * so a reader can scan top-of-mind state first.
 */
export function renderMemoriesAsMarkdown(opts: {
  memories: Array<{
    id?: string;
    title: string;
    content: string;
    memory_kind?: string | null;
    importance?: number | null;
    updated_at?: string | null;
    created_at?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  soulName?: string | null;
  circleName?: string | null;
  exportedAt?: Date;
}): string {
  const exportedAt = opts.exportedAt || new Date();
  const total = opts.memories.length;

  const KIND_ORDER = ['decision', 'policy', 'instruction', 'preference', 'fact', 'finding', 'context'];
  const KIND_LABELS: Record<string, string> = {
    decision: 'Decisions',
    policy: 'Policies',
    instruction: 'Standing Instructions',
    preference: 'Preferences',
    fact: 'Facts',
    finding: 'Findings',
    context: 'Context',
  };

  const grouped = new Map<string, typeof opts.memories>();
  for (const m of opts.memories) {
    const kind = (m.memory_kind || 'context').toLowerCase();
    const arr = grouped.get(kind) || [];
    arr.push(m);
    grouped.set(kind, arr);
  }
  // Sort each group by importance desc, then recency.
  for (const arr of grouped.values()) {
    arr.sort((a, b) => {
      const impDiff = (b.importance || 0) - (a.importance || 0);
      if (impDiff !== 0) return impDiff;
      const at = a.updated_at || a.created_at || '';
      const bt = b.updated_at || b.created_at || '';
      return bt.localeCompare(at);
    });
  }

  const lines: string[] = [];
  const heading = opts.soulName ? `Soul Memory: ${opts.soulName}` : 'Memory Export';
  lines.push(`# ${heading}`);
  lines.push('');
  lines.push('> Exported ' + exportedAt.toISOString().split('T')[0] + ' from The Underground Circle');
  if (opts.circleName) lines.push(`> Circle: ${opts.circleName}`);
  lines.push(`> Total memories: ${total}`);
  lines.push('');

  if (total === 0) {
    lines.push('_No active memories for this soul yet._');
    lines.push('');
    return lines.join('\n');
  }

  // Render in canonical order, then any unrecognized kinds at the end.
  const seenKinds = new Set<string>();
  const renderGroup = (kind: string) => {
    const arr = grouped.get(kind);
    if (!arr || arr.length === 0) return;
    seenKinds.add(kind);
    lines.push(`## ${KIND_LABELS[kind] || kind}`);
    lines.push('');
    for (const m of arr) {
      const impPct = Math.round((m.importance || 0) * 100);
      const ts = m.updated_at || m.created_at;
      const rel = ts ? new Date(ts).toISOString().split('T')[0] : '';
      lines.push(`### ${m.title || '_untitled_'}`);
      lines.push(`*importance ${impPct}%${rel ? ` · captured ${rel}` : ''}*`);
      lines.push('');
      // Indent the content with no markdown processing — preserves the
      // user's text faithfully even if it contains backticks or asterisks.
      lines.push(m.content || '_(empty)_');
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  };

  for (const kind of KIND_ORDER) renderGroup(kind);
  // Catch anything unrecognized.
  for (const kind of grouped.keys()) {
    if (!seenKinds.has(kind)) renderGroup(kind);
  }

  return lines.join('\n');
}

/**
 * Load the version history for a memory, newest first. Each row is
 * the BEFORE state of an edit — so the most recent row in the list
 * is what the memory said immediately prior to the latest edit.
 */
export async function loadMemoryVersions(memoryId: string, limit = 20): Promise<MemoryVersion[]> {
  if (!memoryId) return [];
  try {
    const { data, error } = await supabase
      .from('memory_versions')
      .select('id, memory_id, body, title, edited_by, edited_at, edit_reason')
      .eq('memory_id', memoryId)
      .order('edited_at', { ascending: false })
      .limit(limit);
    if (error) {
      // PGRST205 = relation not found → migration not run yet
      if ((error as any).code !== 'PGRST205') {
        console.warn('[loadMemoryVersions] failed:', error.message);
      }
      return [];
    }
    return (data || []) as MemoryVersion[];
  } catch (err) {
    console.warn('[loadMemoryVersions] threw:', err);
    return [];
  }
}

/**
 * Restore a memory to a prior version. Implemented as another edit —
 * writes a NEW version row containing whatever's there now, then sets
 * content/title to the snapshot from `versionId`. Symmetric with
 * record_memory_edit so revert history is also preserved.
 */
export async function revertMemoryToVersion(versionId: string, reason?: string): Promise<boolean> {
  if (!versionId) return false;
  try {
    const { data: ver, error: verErr } = await supabase
      .from('memory_versions')
      .select('memory_id, body, title')
      .eq('id', versionId)
      .maybeSingle();
    if (verErr || !ver) return false;
    return await editMemory(ver.memory_id, {
      content: ver.body,
      title: ver.title || undefined,
      editReason: reason || `Reverted to version ${versionId.slice(0, 8)}`,
    });
  } catch (err) {
    console.warn('[revertMemoryToVersion] failed:', err);
    return false;
  }
}

// ── Memory links — explicit user-curated relationships ─────────────────────

export type MemoryLinkKind = 'relates' | 'contradicts' | 'supersedes' | 'example_of';

export interface MemoryLink {
  source_id: string;
  target_id: string;
  link_kind: MemoryLinkKind;
  note: string | null;
  created_by: string | null;
  created_at: string;
  // Joined fields when loaded with neighbor metadata.
  target_title?: string;
  target_kind?: string;
}

const LINK_KIND_LABELS: Record<MemoryLinkKind, string> = {
  relates: 'relates to',
  contradicts: 'contradicts',
  supersedes: 'supersedes',
  example_of: 'is an example of',
};

export function memoryLinkKindLabel(kind: MemoryLinkKind): string {
  return LINK_KIND_LABELS[kind] || kind;
}

/**
 * Create an explicit link between two memories. Idempotent — duplicates
 * (same source + target + kind) just update the note via upsert.
 */
export async function createMemoryLink(opts: {
  sourceId: string;
  targetId: string;
  kind: MemoryLinkKind;
  note?: string;
}): Promise<boolean> {
  if (!opts.sourceId || !opts.targetId || opts.sourceId === opts.targetId) return false;
  const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } } as any));
  try {
    const { error } = await supabase.from('memory_links').upsert({
      source_id: opts.sourceId,
      target_id: opts.targetId,
      link_kind: opts.kind,
      note: opts.note || null,
      created_by: user?.id || null,
    }, { onConflict: 'source_id,target_id,link_kind' });
    if (error && (error as any).code === 'PGRST205') {
      // Migration not applied — silently skip rather than crash the UI.
      return false;
    }
    return !error;
  } catch (err) {
    console.warn('[createMemoryLink] failed:', err);
    return false;
  }
}

export async function deleteMemoryLink(opts: {
  sourceId: string;
  targetId: string;
  kind: MemoryLinkKind;
}): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('memory_links')
      .delete()
      .eq('source_id', opts.sourceId)
      .eq('target_id', opts.targetId)
      .eq('link_kind', opts.kind);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Load explicit links originating from a memory, joined with the target
 * memory's title and kind so the UI can render "supersedes <title>".
 */
export async function loadMemoryLinks(sourceId: string): Promise<MemoryLink[]> {
  if (!sourceId) return [];
  try {
    const { data, error } = await supabase
      .from('memory_links')
      .select('source_id, target_id, link_kind, note, created_by, created_at, target:memory_entries!memory_links_target_id_fkey(title, memory_kind)')
      .eq('source_id', sourceId)
      .order('created_at', { ascending: false });
    if (error) {
      if ((error as any).code !== 'PGRST205') {
        console.warn('[loadMemoryLinks] failed:', error.message);
      }
      return [];
    }
    return ((data || []) as any[]).map(row => ({
      source_id: row.source_id,
      target_id: row.target_id,
      link_kind: row.link_kind,
      note: row.note,
      created_by: row.created_by,
      created_at: row.created_at,
      target_title: row.target?.title || '',
      target_kind: row.target?.memory_kind || '',
    }));
  } catch (err) {
    console.warn('[loadMemoryLinks] threw:', err);
    return [];
  }
}

/**
 * Delete a memory (soft-delete by deactivating).
 */
export async function deleteMemory(memoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
  return !error;
}

/**
 * Hard delete a memory permanently.
 */
export async function permanentlyDeleteMemory(memoryId: string): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .delete()
    .eq('id', memoryId);
  return !error;
}

/**
 * Search memories by keyword.
 */
export async function searchMemories(
  circleId: string,
  query: string,
  limit: number = 20,
): Promise<MemoryEntry[]> {
  // Use Supabase text search
  const { data, error } = await supabase
    .from('memory_entries')
    .select('*')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return data.map((d: any) => ({
    id: d.id, scope: d.scope, circle_id: d.circle_id, room_id: d.room_id,
    agent_id: d.agent_id, user_id: d.user_id, session_id: d.session_id,
    memory_kind: d.memory_kind, title: d.title,
    content: d.content, source_run_id: d.source_run_id, is_active: d.is_active,
    source_surface: d.source_surface, visibility: d.visibility, importance: d.importance,
    retrieval_mode: d.retrieval_mode, updated_at: d.updated_at, created_at: d.created_at,
    metadata: d.metadata || {},
  }));
}

// ── Memory Stats ────────────────────────────────────────────────────────────

export async function getMemoryStats(circleId: string): Promise<{
  total: number;
  byScope: Record<string, number>;
  byKind: Record<string, number>;
  oldestMemory?: string;
  newestMemory?: string;
}> {
  const all = await loadMemories({ circleId, limit: 500 });

  const byScope: Record<string, number> = {};
  const byKind: Record<string, number> = {};

  for (const m of all) {
    byScope[m.scope] = (byScope[m.scope] || 0) + 1;
    byKind[m.memory_kind] = (byKind[m.memory_kind] || 0) + 1;
  }

  return {
    total: all.length,
    byScope,
    byKind,
    oldestMemory: all.length > 0 ? all[all.length - 1].created_at : undefined,
    newestMemory: all.length > 0 ? all[0].created_at : undefined,
  };
}
