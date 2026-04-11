/**
 * Memory Consolidation Engine
 *
 * Based on research findings from Google's Always On Memory Agent,
 * Mem0's graph memory, and A-MemGuard defense framework.
 *
 * Key patterns implemented:
 * - Trust scoring: freshness * cross-reference * access frequency
 * - Staleness detection: memories decay after 90 days
 * - Contradiction detection: flag when new info conflicts with existing
 * - Consolidation: merge similar memories (Google's "sleep" pattern)
 * - Procedural memory: save successful workflow traces as templates
 * - Quality gating: reject vague/noisy/transient memories
 */

import { supabase } from './supabase';
import { loadMemories, saveMemory, type MemoryEntry, type MemoryScope, type MemoryKind } from './agentRunSystem';

// ── Trust Scoring ───────────────────────────────────────────────────────────

/**
 * Calculate a trust score for a memory (0.0 to 1.0).
 * Based on: freshness (0.25), specificity (0.25), access frequency (0.20),
 * source reliability (0.15), cross-reference (0.15)
 */
export function calculateTrustScore(memory: MemoryEntry & { access_count?: number; importance?: number }): number {
  // Freshness: exponential decay over 90 days
  const ageMs = Date.now() - new Date(memory.created_at).getTime();
  const ageDays = ageMs / 86_400_000;
  const freshness = Math.max(0, 1.0 - (ageDays / 90)); // 0 at 90 days

  // Specificity: contains names, numbers, paths, dates, URLs
  const content = memory.content.toLowerCase();
  let specificity = 0.3; // base
  if (/\d{4}-\d{2}-\d{2}|\d+\.\d+|\$\d+/.test(content)) specificity += 0.2; // dates/numbers
  if (/\/[\w\/]+\.\w+|https?:\/\//.test(content)) specificity += 0.2; // paths/URLs
  if (/[A-Z][a-z]+\s[A-Z][a-z]+/.test(memory.content)) specificity += 0.15; // proper nouns
  if (memory.memory_kind === 'instruction' || memory.memory_kind === 'decision') specificity += 0.15;
  specificity = Math.min(1.0, specificity);

  // Access frequency (higher = more useful)
  const accessCount = (memory as any).access_count || 0;
  const accessScore = Math.min(1.0, accessCount / 10);

  // Importance (from extraction)
  const importance = (memory as any).importance || 0.5;

  // Composite score
  return (freshness * 0.25) + (specificity * 0.25) + (accessScore * 0.20) + (importance * 0.15) + (0.5 * 0.15);
}

// ── Staleness Detection ─────────────────────────────────────────────────────

/**
 * Find memories that are likely stale (>90 days, low access, session-scope).
 */
export async function findStaleMemories(circleId: string): Promise<MemoryEntry[]> {
  const cutoffDate = new Date(Date.now() - 90 * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from('memory_entries')
    .select('*')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .lt('created_at', cutoffDate)
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !data) return [];
  return data.map(mapMem);
}

/**
 * Mark stale memories as inactive. Returns count of memories marked stale.
 */
export async function pruneStaleMemories(circleId: string): Promise<number> {
  const stale = await findStaleMemories(circleId);
  // Only prune session and context memories — keep decisions and instructions
  const pruneable = stale.filter(m => m.scope === 'session' || m.memory_kind === 'context');

  let pruned = 0;
  for (const mem of pruneable) {
    const score = calculateTrustScore(mem);
    if (score < 0.3) { // low trust = safe to prune
      await supabase.from('memory_entries')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', mem.id);
      pruned++;
    }
  }
  return pruned;
}

// ── Contradiction Detection ─────────────────────────────────────────────────

/**
 * Check if a new memory contradicts existing memories.
 * Uses keyword overlap + opposite sentiment detection.
 */
export async function detectContradictions(
  circleId: string,
  newMemory: { title: string; content: string; kind: string },
): Promise<{ contradicts: boolean; conflictingMemories: MemoryEntry[]; suggestion: string }> {
  // Find memories with overlapping topics
  const keywords = extractKeywords(newMemory.title + ' ' + newMemory.content);
  if (keywords.length === 0) return { contradicts: false, conflictingMemories: [], suggestion: '' };

  const existing = await loadMemories({ circleId, scopes: ['circle', 'user'], limit: 100 });

  const conflicts: MemoryEntry[] = [];
  for (const mem of existing) {
    const memKeywords = extractKeywords(mem.title + ' ' + mem.content);
    const overlap = keywords.filter(k => memKeywords.includes(k));

    if (overlap.length >= 2) {
      // Check for negation/opposite patterns
      const newLower = newMemory.content.toLowerCase();
      const existLower = mem.content.toLowerCase();

      const hasNegation =
        (newLower.includes('not ') && !existLower.includes('not ')) ||
        (!newLower.includes('not ') && existLower.includes('not ')) ||
        (newLower.includes("don't") && !existLower.includes("don't")) ||
        (newLower.includes('instead of') || newLower.includes('rather than') || newLower.includes('changed to') || newLower.includes('switched to'));

      // Check for value changes (e.g., "uses React" vs "uses Vue")
      const hasValueChange = overlap.length >= 2 && (
        newLower.includes('use ') !== existLower.includes('use ') ||
        newLower.includes('prefer') !== existLower.includes('prefer')
      );

      if (hasNegation || hasValueChange) {
        conflicts.push(mem);
      }
    }
  }

  if (conflicts.length === 0) return { contradicts: false, conflictingMemories: [], suggestion: '' };

  return {
    contradicts: true,
    conflictingMemories: conflicts,
    suggestion: `New memory "${newMemory.title}" may contradict ${conflicts.length} existing memor${conflicts.length === 1 ? 'y' : 'ies'}. Consider updating the old ${conflicts.length === 1 ? 'one' : 'ones'} instead.`,
  };
}

// ── Memory Consolidation ("Sleep" Pattern) ──────────────────────────────────

/**
 * Consolidate similar memories by merging overlapping facts.
 * Inspired by Google's Always On Memory Agent consolidation cycle.
 * Should run periodically (e.g., every session end or daily).
 */
export async function consolidateMemories(circleId: string): Promise<{ merged: number; pruned: number }> {
  const memories = await loadMemories({ circleId, scopes: ['circle', 'user', 'session'], limit: 200 });
  if (memories.length < 5) return { merged: 0, pruned: 0 };

  let merged = 0;
  const processed = new Set<string>();

  // Group memories by keyword similarity
  for (let i = 0; i < memories.length; i++) {
    if (processed.has(memories[i].id)) continue;
    const kw1 = extractKeywords(memories[i].title + ' ' + memories[i].content);

    const similar: MemoryEntry[] = [];
    for (let j = i + 1; j < memories.length; j++) {
      if (processed.has(memories[j].id)) continue;
      const kw2 = extractKeywords(memories[j].title + ' ' + memories[j].content);
      const overlap = kw1.filter(k => kw2.includes(k));
      // High overlap = similar memories
      if (overlap.length >= 3 && overlap.length >= Math.min(kw1.length, kw2.length) * 0.5) {
        similar.push(memories[j]);
      }
    }

    // Merge if there are similar memories
    if (similar.length >= 1) {
      const all = [memories[i], ...similar];
      // Keep the most recent, highest-importance version
      all.sort((a, b) => {
        const aScore = calculateTrustScore(a);
        const bScore = calculateTrustScore(b);
        return bScore - aScore;
      });

      const keeper = all[0];
      const others = all.slice(1);

      // Merge content from others into the keeper
      const extraContent = others
        .map(m => m.content)
        .filter(c => !keeper.content.includes(c.slice(0, 30)))
        .join('. ');

      if (extraContent) {
        const mergedContent = keeper.content + (keeper.content.endsWith('.') ? ' ' : '. ') + extraContent;
        await supabase.from('memory_entries')
          .update({ content: mergedContent.slice(0, 500), updated_at: new Date().toISOString() })
          .eq('id', keeper.id);
      }

      // Deactivate the merged duplicates
      for (const other of others) {
        await supabase.from('memory_entries')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', other.id);
        processed.add(other.id);
        merged++;
      }
      processed.add(keeper.id);
    }
  }

  // Also prune stale memories
  const pruned = await pruneStaleMemories(circleId);

  return { merged, pruned };
}

// ── Quality Gate ────────────────────────────────────────────────────────────

/**
 * Evaluate if a candidate memory is worth saving.
 * High-quality = specific, actionable, temporally bounded.
 * Noise = vague sentiment, transient small talk, redundant.
 */
export function isHighQualityMemory(candidate: { kind: string; title: string; content: string }): boolean {
  const c = candidate.content.toLowerCase();
  const t = candidate.title.toLowerCase();

  // Reject too short
  if (candidate.content.length < 15) return false;

  // Reject pure sentiment / chitchat
  const noisePatterns = [
    /^(ok|okay|sure|yes|no|thanks|thank you|got it|cool|nice|great|awesome)$/i,
    /^(i see|understood|makes sense|right|exactly|absolutely)$/i,
    /^(hello|hey|hi|how are you|good morning|good night)$/i,
  ];
  if (noisePatterns.some(p => p.test(candidate.content.trim()))) return false;

  // Reject very generic statements
  if (c.includes('something') && c.includes('maybe') && candidate.content.length < 50) return false;

  // Boost specific content
  let qualityScore = 0;
  if (/[A-Z][a-z]+\s[A-Z]/.test(candidate.content)) qualityScore += 1; // proper nouns
  if (/\d/.test(candidate.content)) qualityScore += 1; // numbers
  if (/https?:\/\/|\/[\w\/]+\.\w+/.test(candidate.content)) qualityScore += 1; // URLs/paths
  if (['instruction', 'decision', 'preference'].includes(candidate.kind)) qualityScore += 2;
  if (['fact', 'finding'].includes(candidate.kind)) qualityScore += 1;

  return qualityScore >= 1;
}

// ── Procedural Memory ───────────────────────────────────────────────────────

/**
 * Save a successful workflow trace as procedural memory.
 * These can be retrieved when the agent encounters similar tasks.
 */
export async function saveProceduralMemory(opts: {
  circleId: string;
  userId: string;
  taskType: string;
  steps: string[];
  outcome: 'success' | 'failure';
  learnings?: string;
}): Promise<void> {
  if (opts.outcome !== 'success' || opts.steps.length < 2) return;

  const content = [
    `Task: ${opts.taskType}`,
    `Steps: ${opts.steps.join(' → ')}`,
    opts.learnings ? `Learnings: ${opts.learnings}` : '',
  ].filter(Boolean).join('\n');

  await saveMemory({
    scope: 'circle',
    circleId: opts.circleId,
    memoryKind: 'context',
    title: `Workflow: ${opts.taskType}`,
    content,
    sourceSurface: 'main_chat',
  });
}

// ── Memory Health Report ────────────────────────────────────────────────────

export async function getMemoryHealthReport(circleId: string): Promise<{
  total: number;
  active: number;
  stale: number;
  avgTrustScore: number;
  oldestActive: string;
  newestActive: string;
  byScope: Record<string, number>;
  byKind: Record<string, number>;
  contradictionRisk: number;
}> {
  const all = await loadMemories({ circleId, limit: 500 });
  const staleEntries = await findStaleMemories(circleId);

  let totalTrust = 0;
  const byScope: Record<string, number> = {};
  const byKind: Record<string, number> = {};

  for (const m of all) {
    totalTrust += calculateTrustScore(m);
    byScope[m.scope] = (byScope[m.scope] || 0) + 1;
    byKind[m.memory_kind] = (byKind[m.memory_kind] || 0) + 1;
  }

  // Simple contradiction risk: high if many similar-titled memories exist
  const titles = all.map(m => m.title.toLowerCase());
  const duplicateTitles = titles.filter((t, i) => titles.indexOf(t) !== i);
  const contradictionRisk = Math.min(1.0, duplicateTitles.length / Math.max(all.length, 1));

  return {
    total: all.length,
    active: all.length,
    stale: staleEntries.length,
    avgTrustScore: all.length > 0 ? totalTrust / all.length : 0,
    oldestActive: all.length > 0 ? all[all.length - 1].created_at : '',
    newestActive: all.length > 0 ? all[0].created_at : '',
    byScope,
    byKind,
    contradictionRisk,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractKeywords(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'it', 'this', 'that', 'and', 'or', 'but', 'not', 'if', 'so', 'as', 'what', 'how', 'when', 'where', 'who', 'which', 'why', 'i', 'me', 'my', 'we', 'you', 'your', 'they', 'them', 'their']);
  return text.toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 2 && !stopWords.has(w));
}

function mapMem(d: any): MemoryEntry {
  return {
    id: d.id, scope: d.scope, circle_id: d.circle_id, room_id: d.room_id,
    user_id: d.user_id, memory_kind: d.memory_kind, title: d.title,
    content: d.content, source_run_id: d.source_run_id, is_active: d.is_active,
    created_at: d.created_at,
  };
}
