/**
 * Agent Session Memory — Generic session-to-memory persistence for ALL agent types.
 *
 * Works with Claude Code, Cursor, Codex, Gemini CLI, and any future agent detectors.
 * Sessions are grouped by project, deduped by content hash, and saved to memory_entries
 * for cross-session pickup.
 */

import { supabase } from './supabase';
import { promoteExternalAgentSessionKnowledge } from './memoryService';
import { devLog } from './devLog';

// ── Auth Helper ─────────────────────────────────────────────────────────────

async function verifyAuth(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id || null;
  } catch { return null; }
}

// ── Generic Session Interface ───────────────────────────────────────────────

export interface AgentSessionForMemory {
  sessionId: string;
  projectDir: string;
  model: string;
  status: 'active' | 'idle' | string;
  task?: string;
  lastActivity: string;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  recentActions: string[];
  // Rich context (optional — only Claude Code has these today)
  lastUserMessage?: string;
  lastAssistantText?: string;
  activeFiles?: string[];
  currentToolName?: string;
}

export type AgentProvider = 'claude-code' | 'cursor' | 'codex' | 'gemini';

const PROVIDER_LABELS: Record<AgentProvider, string> = {
  'claude-code': 'CC',
  'cursor': 'Cursor',
  'codex': 'Codex',
  'gemini': 'Gemini',
};

const PROVIDER_SURFACES: Record<AgentProvider, string> = {
  'claude-code': 'claude_code_bridge',
  'cursor': 'cursor_bridge',
  'codex': 'codex_bridge',
  'gemini': 'gemini_bridge',
};

// ── Dedup Cache ─────────────────────────────────────────────────────────────

const _savedHashes = new Map<string, string>(); // bucketId -> hash

function contextHash(s: { task: string; recentActions: string; messageCount: number }): string {
  return `${s.messageCount}:${s.task.slice(0, 50)}:${s.recentActions.slice(0, 50)}`;
}

function normalizeProjectKey(projectDir: string): string {
  const project = projectDir.split('/').filter(Boolean).pop() || 'project';
  return project.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

// ── Save Sessions to Memory ─────────────────────────────────────────────────

/**
 * Save agent sessions to the memory system, grouped by project.
 * Works with any agent type that implements AgentSessionForMemory.
 */
export async function saveAgentSessionsToMemory(
  provider: AgentProvider,
  circleId: string,
  userId: string,
  sessions: AgentSessionForMemory[],
): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  if (sessions.length === 0) return { saved: 0, skipped: 0 };

  // Verify auth session exists — RLS requires authenticated user
  const authUid = await verifyAuth();
  if (!authUid) {
    console.warn(`[agentSessionMemory] No auth session, skipping save for ${provider}`);
    return { saved: 0, skipped: sessions.length };
  }

  // Get circle session memory mode
  let sessionMode: 'shared' | 'private' = 'private';
  try {
    const { getCircleSessionMemoryMode } = await import('./agentRunSystem');
    sessionMode = await getCircleSessionMemoryMode(circleId);
  } catch {}
  const visibility = sessionMode === 'shared' ? 'circle_shared' : 'private';

  const label = PROVIDER_LABELS[provider];
  const sourceSurface = PROVIDER_SURFACES[provider];

  // Group sessions by project
  const grouped = new Map<string, AgentSessionForMemory[]>();
  for (const session of sessions) {
    // Skip sessions with no meaningful content
    if (!session.task && !session.lastUserMessage && !session.lastAssistantText && session.recentActions.length === 0) {
      skipped++;
      continue;
    }
    const projectKey = normalizeProjectKey(session.projectDir);
    const bucket = grouped.get(projectKey) || [];
    bucket.push(session);
    grouped.set(projectKey, bucket);
  }

  for (const [projectKey, projectSessions] of grouped) {
    // Sort by most recent activity
    const sorted = [...projectSessions].sort((a, b) => {
      const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bTime - aTime;
    });
    const latest = sorted[0];
    const project = latest.projectDir.split('/').filter(Boolean).pop() || 'project';

    const bucketId = sessionMode === 'shared'
      ? `${provider}-project:shared:${projectKey}`
      : `${provider}-project:private:${userId}:${projectKey}`;

    // Build combined context
    const combinedTask = sorted
      .map(s => s.task || s.lastUserMessage || '')
      .filter(Boolean)
      .slice(0, 4)
      .join(' | ');
    const combinedResponse = sorted
      .map(s => s.lastAssistantText || '')
      .filter(Boolean)
      .slice(0, 4)
      .join(' | ');
    const combinedActions = sorted
      .flatMap(s => s.recentActions)
      .filter(Boolean)
      .slice(0, 6)
      .join(', ');
    const messageCount = sorted.reduce((sum, s) => sum + (s.messageCount || 0), 0);
    const activeFiles = Array.from(new Set(
      sorted.flatMap(s => (s.activeFiles || []).slice(-5).map(f => f.split('/').pop() || f))
    )).slice(0, 8);

    // Hash check to avoid duplicate writes
    const hash = contextHash({
      task: combinedTask,
      recentActions: combinedActions,
      messageCount,
    });
    if (_savedHashes.get(bucketId) === hash) {
      skipped++;
      continue;
    }

    const content = [
      `${label} project memory for ${project}`,
      `Sessions: ${sorted.length} | Messages: ${messageCount} | Model: ${latest.model}`,
      combinedTask ? `Recent work: ${combinedTask.slice(0, 600)}` : '',
      combinedResponse ? `Recent responses: ${combinedResponse.slice(0, 600)}` : '',
      combinedActions ? `Tools/Actions: ${combinedActions}` : '',
      activeFiles.length > 0 ? `Active files: ${activeFiles.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const title = `${label} Project: ${project}`;
    try {
      // Look up by title + source_surface (session_id is UUID, can't use for text bucket keys)
      let existingQuery = supabase
        .from('memory_entries')
        .select('id')
        .eq('circle_id', circleId)
        .eq('scope', 'session')
        .eq('memory_kind', 'context')
        .eq('source_surface', sourceSurface)
        .eq('title', title)
        .order('created_at', { ascending: false })
        .limit(1);

      existingQuery = sessionMode === 'shared'
        ? existingQuery.is('user_id', null)
        : existingQuery.eq('user_id', userId);
      const { data: existing, error: existingError } = await existingQuery.maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { error: updateError } = await supabase.from('memory_entries').update({
          content,
          title,
          visibility,
          updated_at: new Date().toISOString(),
          metadata: {
            bucketId,
            projectKey,
            projectDir: latest.projectDir,
            provider,
            providerLabel: label,
            latestTask: latest.task || null,
            recentTasks: sorted.map(s => s.task || s.lastUserMessage || '').filter(Boolean).slice(0, 6),
            recentResponses: sorted.map(s => s.lastAssistantText || '').filter(Boolean).slice(0, 4),
            activeFiles,
            currentTools: sorted.map(s => s.currentToolName || '').filter(Boolean).slice(0, 6),
            recentActions: sorted.flatMap(s => s.recentActions || []).filter(Boolean).slice(0, 10),
            latestStatus: latest.status || null,
            latestModel: latest.model || null,
            mergedSessionIds: sorted.map(s => s.sessionId),
            sessionMemoryMode: sessionMode,
          },
        }).eq('id', existing.id);
        if (updateError) throw updateError;
      } else {
        // Insert new session memory — unique constraint prevents duplicates from race conditions
        const { error: insertError } = await supabase.from('memory_entries').insert({
          scope: 'session',
          circle_id: circleId,
          user_id: sessionMode === 'shared' ? null : userId,
          memory_kind: 'context',
          title,
          content,
          source_surface: sourceSurface,
          visibility,
          retrieval_mode: 'on_demand',
          importance: 0.72,
          is_active: true,
          metadata: {
            bucketId,
            projectKey,
            projectDir: latest.projectDir,
            provider,
            providerLabel: label,
            latestTask: latest.task || null,
            recentTasks: sorted.map(s => s.task || s.lastUserMessage || '').filter(Boolean).slice(0, 6),
            recentResponses: sorted.map(s => s.lastAssistantText || '').filter(Boolean).slice(0, 4),
            activeFiles,
            currentTools: sorted.map(s => s.currentToolName || '').filter(Boolean).slice(0, 6),
            recentActions: sorted.flatMap(s => s.recentActions || []).filter(Boolean).slice(0, 10),
            latestStatus: latest.status || null,
            latestModel: latest.model || null,
            mergedSessionIds: sorted.map(s => s.sessionId),
            sessionMemoryMode: sessionMode,
          },
        });
        if (insertError) {
          // Duplicate key = race condition, another process saved first — update instead
          if (insertError.code === '23505') {
            devLog.trace(`[agentSessionMemory] Duplicate detected for ${projectKey}, updating instead`);
          } else {
            throw insertError;
          }
        }
      }

      _savedHashes.set(bucketId, hash);
      saved++;

      void promoteExternalAgentSessionKnowledge({
        circleId,
        userId,
        provider,
        sessions: sorted,
        shareWithCircle: sessionMode === 'shared',
      }).catch((err) => {
        console.warn(`[agentSessionMemory] Failed to promote ${provider} knowledge for ${projectKey}:`, err);
      });
    } catch (err) {
      console.warn(`[agentSessionMemory] Failed to save ${provider} session context for ${projectKey}:`, err);
      skipped++;
    }
  }

  // ── Promote only the 3 most recent session memories to 'startup', demote rest ──
  // This prevents old session memories from bloating every system prompt.
  try {
    const { data: allSessionMems } = await supabase
      .from('memory_entries')
      .select('id, updated_at, retrieval_mode')
      .eq('circle_id', circleId)
      .eq('scope', 'session')
      .eq('source_surface', sourceSurface)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (allSessionMems && allSessionMems.length > 0) {
      const toPromote = allSessionMems.slice(0, 3).filter(m => m.retrieval_mode !== 'startup');
      const toDemote = allSessionMems.slice(3).filter(m => m.retrieval_mode === 'startup');

      if (toPromote.length > 0) {
        await supabase.from('memory_entries')
          .update({ retrieval_mode: 'startup' })
          .in('id', toPromote.map(m => m.id));
      }
      if (toDemote.length > 0) {
        await supabase.from('memory_entries')
          .update({ retrieval_mode: 'on_demand' })
          .in('id', toDemote.map(m => m.id));
      }
    }
  } catch (err) {
    console.warn(`[agentSessionMemory] Failed to promote/demote session memories:`, err);
  }

  if (saved > 0) {
    devLog.trace(`[agentSessionMemory] ${provider}: saved=${saved}, skipped=${skipped}`);
  }
  return { saved, skipped };
}
