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

// ── Memory Extraction ───────────────────────────────────────────────────────

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || '';

interface ExtractedMemory {
  kind: MemoryKind;
  title: string;
  content: string;
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

  const prompt = `Analyze this conversation and extract important facts worth remembering for future sessions.

Extract ONLY information that would be useful in future conversations:
- User preferences (coding style, tools, languages, design preferences)
- Project details (what they're building, tech stack, goals, deadlines)
- Decisions made (architecture choices, approaches chosen, things rejected)
- Personal info (name, role, timezone, team size)
- Corrections (things the user said were wrong, approaches that didn't work)
- Instructions (how they want things done, what to avoid)

Do NOT extract:
- Casual chitchat or greetings
- Questions that were fully answered (the answer is the memory, not the question)
- Temporary task details (specific code being written right now)
- Things already in existing memories unless they've changed
${existingStr}

Conversation:
${conversationStr}

Return a JSON array of objects with these fields:
- kind: one of "preference", "fact", "decision", "finding", "instruction"
- title: short label (under 60 chars)
- content: the actual information (under 200 chars)

Return [] if nothing worth remembering. Return ONLY the JSON array, no other text.`;

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
    let text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Strip markdown fences
    text = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((m: any) =>
      m.kind && m.title && m.content &&
      ['preference', 'fact', 'decision', 'finding', 'instruction', 'policy', 'context'].includes(m.kind)
    ).slice(0, 10); // cap at 10 per extraction
  } catch (e) {
    console.warn('[AgentMemory] Extraction failed:', e);
    return [];
  }
}

// ── Auto-Extract and Save ───────────────────────────────────────────────────

/**
 * Run memory extraction on a conversation and save results.
 * Deduplicates against existing memories by title similarity.
 */
export async function autoExtractAndSave(
  circleId: string,
  userId: string,
  messages: Array<{ role: string; text: string }>,
): Promise<{ saved: number; updated: number }> {
  // Load existing memories for dedup (scoped to this user for user memories)
  const existing = await loadMemories({ circleId, userId, scopes: ['circle', 'user'], limit: 100 });

  // Extract new memories
  const extracted = await extractMemoriesFromConversation(messages, existing);
  if (extracted.length === 0) return { saved: 0, updated: 0 };

  let saved = 0;
  let updated = 0;

  for (const mem of extracted) {
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
        await supabase
          .from('memory_entries')
          .update({
            content: mem.content,
            memory_kind: mem.kind,
            updated_at: new Date().toISOString(),
            status: 'active',
          })
          .eq('id', duplicate.id);
        updated++;
      } catch {}
    } else {
      // Save new memory with proper scope, importance, and retrieval mode
      const scope: MemoryScope = ['preference', 'instruction'].includes(mem.kind) ? 'user' : 'circle';
      const importance = mem.kind === 'instruction' ? 0.9 : mem.kind === 'decision' ? 0.8 : mem.kind === 'preference' ? 0.7 : 0.5;
      const retrievalMode = ['instruction', 'preference'].includes(mem.kind) ? 'startup' : 'on_demand';

      await saveMemory({
        scope,
        circleId,
        userId: scope === 'user' ? userId : undefined,
        memoryKind: mem.kind as MemoryKind,
        title: mem.title,
        content: mem.content,
        sourceSurface: 'main_chat',
      });

      // Set importance and retrieval mode (columns added in privacy fix migration)
      // Non-blocking — these columns may not exist yet if migration hasn't run
      try {
        if (saved === 0) {
          // Only attempt once to check if columns exist
          const { data: latest } = await supabase
            .from('memory_entries')
            .select('id')
            .eq('circle_id', circleId)
            .eq('title', mem.title)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          if (latest) {
            await supabase.from('memory_entries').update({ importance, retrieval_mode: retrievalMode }).eq('id', latest.id);
          }
        }
      } catch {}

      saved++;
    }
  }

  return { saved, updated };
}

// ── Memory Management (User-Facing) ─────────────────────────────────────────

/**
 * Get all memories for a user, grouped by scope and kind.
 */
export async function getUserMemories(
  circleId: string,
  userId?: string,
): Promise<{
  circle: MemoryEntry[];
  user: MemoryEntry[];
  session: MemoryEntry[];
  total: number;
}> {
  const all = await loadMemories({ circleId, limit: 200 });

  const circle = all.filter(m => m.scope === 'circle');
  const user = userId ? all.filter(m => m.scope === 'user' && m.user_id === userId) : [];
  const session = all.filter(m => m.scope === 'session');

  return { circle, user, session, total: all.length };
}

/**
 * Edit a memory's content.
 */
export async function editMemory(
  memoryId: string,
  updates: { title?: string; content?: string; memory_kind?: MemoryKind },
): Promise<boolean> {
  const { error } = await supabase
    .from('memory_entries')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', memoryId);
  return !error;
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
    user_id: d.user_id, memory_kind: d.memory_kind, title: d.title,
    content: d.content, source_run_id: d.source_run_id, is_active: d.is_active,
    created_at: d.created_at,
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
