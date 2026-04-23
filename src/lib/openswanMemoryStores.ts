import { supabase } from './supabase';
import { loadMemories, type MemoryEntry } from './agentRunSystem';
import { buildPromptMemoryBundle, loadStartupMemory, type PromptMemoryReference } from './memoryService';
import { loadUserMemory } from './userMemory';

export type OpenSwanMemoryStores = {
  /**
   * The user's USER.md-equivalent — global notes + circle-specific notes
   * merged from the `user_memory` table. Higher priority than
   * `userProfile` (which is derived from `memory_entries`) because these
   * are things the user wrote about themselves, not things the system
   * inferred.
   */
  userNotes: string;
  userProfile: string;
  runtimeMemory: string;
  workingMemory: string;
  combined: string;
  references: PromptMemoryReference[];
};

function rankMemories(memories: MemoryEntry[]): MemoryEntry[] {
  return [...memories].sort((a, b) => {
    const aStartup = a.retrieval_mode === 'startup' ? 1 : 0;
    const bStartup = b.retrieval_mode === 'startup' ? 1 : 0;
    if (bStartup !== aStartup) return bStartup - aStartup;
    if ((b.importance || 0) !== (a.importance || 0)) return (b.importance || 0) - (a.importance || 0);
    return new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime();
  });
}

function formatUserProfile(memories: MemoryEntry[], dedupAgainst?: string): string {
  const ranked = rankMemories(memories)
    .filter((memory) => memory.retrieval_mode !== 'manual_only')
    .slice(0, 8);
  if (ranked.length === 0) return '';
  // Strip any profile entry whose first ~40 content chars already appear
  // verbatim in the user-authored notes block. Two sources writing the
  // same fact (user notes + inferred profile) burns tokens and risks the
  // model treating near-duplicates as separate signals.
  const normalizedDedup = dedupAgainst
    ? dedupAgainst.toLowerCase().replace(/\s+/g, ' ')
    : null;
  const deduped = normalizedDedup
    ? ranked.filter((memory) => {
        const needle = memory.content.slice(0, 40).toLowerCase().replace(/\s+/g, ' ').trim();
        if (needle.length < 12) return true; // too short to be a reliable dedup match
        return !normalizedDedup.includes(needle);
      })
    : ranked;
  if (deduped.length === 0) return '';
  return `## User Profile\n${
    deduped
      .map((memory) => `- [${memory.memory_kind}] ${memory.title}: ${memory.content.slice(0, 180)}`)
      .join('\n')
  }`;
}

// Session-scope memories older than this are demoted — a cron is meant
// to strip `retrieval_mode='startup'` off 14-day-old sessions, but if the
// cron misses we still don't want month-old session chatter leaking into
// the context. Startup memories of any age bypass this (explicitly kept
// fresh) and non-session scopes are unaffected.
const SESSION_MEMORY_MAX_AGE_DAYS = 30;

async function formatRuntimeMemory(args: {
  circleId: string;
  userId: string;
  roomId?: string;
  agentId?: string;
}): Promise<string> {
  const scopes = args.agentId
    ? ['circle', 'room', 'session', 'agent'] as const
    : ['circle', 'room', 'session'] as const;
  const now = Date.now();
  const sessionCutoff = now - SESSION_MEMORY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const memories = rankMemories(await loadMemories({
    circleId: args.circleId,
    userId: args.userId,
    roomId: args.roomId,
    agentId: args.agentId,
    scopes: [...scopes],
    limit: 24,
  }))
    .filter((memory) => memory.retrieval_mode !== 'manual_only')
    .filter((memory) => {
      // Age filter applies to session-scope only. Circle/room/agent
      // memories are assumed durable; session memories are fire-and-
      // forget and shouldn't resurface weeks later.
      if (memory.scope !== 'session') return true;
      if (memory.retrieval_mode === 'startup') return true;
      const updated = new Date(memory.updated_at || memory.created_at).getTime();
      return Number.isFinite(updated) && updated >= sessionCutoff;
    });

  const sections: string[] = [];

  try {
    const { data: sharedDoc } = await supabase
      .from('circle_memory')
      .select('content')
      .eq('circle_id', args.circleId)
      .single();
    const sharedContent = sharedDoc?.content?.trim();
    if (sharedContent) {
      sections.push(`## Circle Operating Memory\n${sharedContent.slice(0, 900)}`);
    }
  } catch {}

  const grouped = {
    circle: memories.filter((memory) => memory.scope === 'circle').slice(0, 4),
    room: memories.filter((memory) => memory.scope === 'room').slice(0, 3),
    agent: memories.filter((memory) => memory.scope === 'agent').slice(0, 4),
    session: memories.filter((memory) => memory.scope === 'session').slice(0, 3),
  };

  if (grouped.circle.length > 0) {
    sections.push(`## Circle Runtime Memory\n${grouped.circle.map((memory) => `- ${memory.title}: ${memory.content.slice(0, 180)}`).join('\n')}`);
  }
  if (grouped.room.length > 0) {
    sections.push(`## Room Runtime Memory\n${grouped.room.map((memory) => `- ${memory.title}: ${memory.content.slice(0, 180)}`).join('\n')}`);
  }
  if (grouped.agent.length > 0) {
    sections.push(`## Agent Runtime Memory\n${grouped.agent.map((memory) => `- ${memory.title}: ${memory.content.slice(0, 180)}`).join('\n')}`);
  }
  if (grouped.session.length > 0) {
    sections.push(`## Session Runtime Memory\n${grouped.session.map((memory) => `- ${memory.title}: ${memory.content.slice(0, 180)}`).join('\n')}`);
  }

  const startup = await loadStartupMemory({
    circleId: args.circleId,
    userId: args.userId,
    roomId: args.roomId,
    agentId: args.agentId,
  });
  if (startup) {
    sections.push(startup);
  }

  return sections.join('\n\n').slice(0, 3200);
}

export async function buildOpenSwanMemoryStores(args: {
  circleId?: string;
  userId: string;
  query: string;
  roomId?: string;
  agentId?: string;
  agentName?: string;
  spiritId?: string | null;
  surface?: string;
  taskKind?: string;
  profile?: string;
  runId?: string;
  limit?: number;
}): Promise<OpenSwanMemoryStores> {
  if (!args.circleId) {
    return {
      userNotes: '',
      userProfile: '',
      runtimeMemory: '',
      workingMemory: '',
      combined: '',
      references: [],
    };
  }

  // loadUserMemory added as a fourth parallel load — reads the user_memory
  // table (USER.md equivalent) for global + circle-scoped rows. RLS enforces
  // caller == owner; never throws, degrades to empty on failure.
  const [userMemories, userMemoryContent, runtimeMemory, promptBundle] = await Promise.all([
    loadMemories({
      circleId: args.circleId,
      userId: args.userId,
      scopes: ['user'],
      limit: 16,
    }),
    loadUserMemory(args.userId, args.circleId),
    formatRuntimeMemory({
      circleId: args.circleId,
      userId: args.userId,
      roomId: args.roomId,
      agentId: args.agentId,
    }),
    buildPromptMemoryBundle({
      circleId: args.circleId,
      userId: args.userId,
      query: args.query,
      roomId: args.roomId,
      agentId: args.agentId,
      agentName: args.agentName,
      spiritId: args.spiritId,
      surface: args.surface,
      taskKind: args.taskKind,
      profile: args.profile,
      runId: args.runId,
      limit: args.limit,
    }),
  ]);

  const userNotes = userMemoryContent.combined
    ? `## User Notes\n${userMemoryContent.combined}`
    : '';
  // Dedup profile against notes — user-authored notes are the higher-
  // signal source, so we suppress system-inferred profile rows that
  // already appear there.
  const userProfile = formatUserProfile(userMemories, userMemoryContent.combined || undefined);
  const workingMemory = promptBundle.memoryContext;
  // Order: user-authored notes first (highest signal — user told us directly),
  // then system-inferred user profile, then runtime memory, then working
  // memory retrieved for this query. 5200-char cap preserved.
  const combined = [userNotes, userProfile, runtimeMemory, workingMemory]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 5200);

  return {
    userNotes,
    userProfile,
    runtimeMemory,
    workingMemory,
    combined,
    references: promptBundle.references,
  };
}

