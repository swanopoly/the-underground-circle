import { supabase } from './supabase';
import {
  createSecondBrainNote,
  createSecondBrainLink,
  getSecondBrainUnavailableMessage,
  rememberSecondBrainStorageError,
  updateSecondBrainNote,
  type SecondBrainNote,
} from './secondBrain';

// ─── Section definitions ───────────────────────────────────────────────────────

interface SiteSection {
  key: string;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  linksTo: string[]; // keys of related sections
}

const SITE_SECTIONS: SiteSection[] = [
  {
    key: 'chat',
    title: 'Chat — AI Agent Interface',
    content: `The Chat screen is the primary interaction surface for OpenSwan and BlackSwan agents. It hosts the model picker (Anthropic, OpenAI, OpenRouter, Hugging Face, Groq, Google AI, DeepSeek, and 14+ more), chat automation planning via chatAutomationPlanner, and full execution via runChatAutomationPlan. Chat threads persist with compact metadata covering source, routing, usage, browser plans, artifacts, memories, and execution stream. Computer task routing, memory references, skill injection, and artifact rendering all live here. The swanbot-ai and swanbot-v2-ai edge functions handle the agent response path.`,
    tags: ['chat', 'ai-agent', 'blackswan', 'openswan', 'model-picker', 'automation'],
    importance: 0.95,
    linksTo: ['openswan', 'blackswan', 'memory-bank', 'computer-use'],
  },
  {
    key: 'office',
    title: 'Office — Live Agent Dashboard',
    content: `The Office screen is the real-time control panel for all running agents and sessions. It shows the local bridge status (OpenSwan proxy port 18790, Claude bridge 7778), live activity feed, agent approval queues, memory bank controls, and agent identity management. The office surfaces active OpenSwan sessions, pending HITL approvals, and checkpoint strips for tool-call review. Circle members see the same agent state in real time via Supabase Realtime subscriptions. Key owners: circleOffice.ts, openswanSessionRuntime.ts, agentRunPersistence.ts.`,
    tags: ['office', 'dashboard', 'agents', 'approvals', 'bridge', 'realtime'],
    importance: 0.88,
    linksTo: ['openswan', 'memory-bank', 'chat', 'computer-use'],
  },
  {
    key: 'feed',
    title: 'Feed — Goals, Missions & Proof of Work',
    content: `The Feed is the team accountability loop. It shows OKR-style goals (north_star, okr_objective, key_result, circle_goal), mission tracking with Kanban task boards, and Proof of Work records (commit, pr, deploy, agent_run, checkin, manual). Missions have tasks with assignees, agent executors, status tracking, and evidence chains. The Feed integrates with the Office to show what agents actually shipped. Key owners: missions.ts, goals.ts, FeedTab.tsx. Tables: circle_missions, org_goals, mission_tasks.`,
    tags: ['feed', 'missions', 'goals', 'okr', 'tasks', 'proof-of-work', 'accountability'],
    importance: 0.88,
    linksTo: ['office', 'chat', 'rooms'],
  },
  {
    key: 'rooms',
    title: 'Rooms — Project Rooms & Code Sandboxes',
    content: `Rooms are shared project spaces within a circle. Each room has files (with content, type, storage URL), services, agent participants, real-time chat (room_messages), and task execution. Rooms act as persistent sandboxes where agents can read/write files, run code, and coordinate with each other. Room messages support types: chat, agent_output, edit_event, system. Tables: circle_rooms, room_messages. Key owner: roomRepository.ts.`,
    tags: ['rooms', 'project', 'files', 'sandbox', 'code', 'collaboration'],
    importance: 0.78,
    linksTo: ['feed', 'office', 'openswan'],
  },
  {
    key: 'marketplace',
    title: 'Marketplace — Providers, BYOK & Model Catalog',
    content: `The Marketplace manages AI provider integrations, BYOK (Bring Your Own Key) credentials, model catalog, and billing preferences. Supports 18+ providers: Anthropic, OpenAI, OpenRouter, Hugging Face, Groq, Google AI, Mistral, Cohere, Perplexity, Together AI, Fireworks, DeepSeek, z.ai, MiniMax, Ollama, GitHub Models, Replicate, Brave Search, Browserbase, Stagehand. Provider routing is multi-surface — changes must be reflected in llmProviders.ts, circleIntegrations.ts, crossProviderRouter.ts, billingPriority.ts, and llm-proxy. Key: circleIntegrations.ts, serviceProfileSouls.ts.`,
    tags: ['marketplace', 'providers', 'byok', 'models', 'integrations', 'api-keys'],
    importance: 0.82,
    linksTo: ['chat', 'provider-routing', 'blackswan'],
  },
  {
    key: 'backpack',
    title: 'Backpack / Digital Brain — Knowledge Graph',
    content: `The Backpack hosts the Circle Second Brain: a personal knowledge graph with Obsidian-style note capture, 3D force-directed visualization, semantic search via pgvector embeddings, spaced-repetition review queue, and agent brief generation. Notes have status (inbox, processed, evergreen, archived), kinds (note, inbox, web_clip, agent_summary, memory_digest, question), and visibility (private or circle_shared). The brain digests agent memories, surfaces review-due notes, and generates compressed context briefs for chat sessions. Key owners: secondBrain.ts, secondBrainCore.ts, SecondBrainDashboard.tsx. Tables: circle_second_brain_notes, circle_second_brain_links.`,
    tags: ['backpack', 'digital-brain', 'knowledge-graph', 'notes', 'memory', 'pkm'],
    importance: 0.92,
    linksTo: ['memory-bank', 'chat', 'feed', 'openswan'],
  },
  {
    key: 'computer-use',
    title: 'Computer Use — Browser & Desktop Automation',
    content: `Computer Use handles both cloud browser automation (Browserbase) and local desktop awareness. The cloud path uses Anthropic native computer use with screenshot/action loops requiring a Sonnet-capable model. Local awareness reads tabs, running apps, clipboard, screen state, file list, and accessibility tree through bridge tools. Actions (launch app, open URL, clipboard write, shortcuts, window management) go through the risk/approval path. Split ownership: computerUse.ts (planning), useComputerUseTask.ts (run state), computer-use-agent edge function (execution). Local bridge: port 7778.`,
    tags: ['computer-use', 'browser-automation', 'browserbase', 'desktop', 'bridge', 'local'],
    importance: 0.78,
    linksTo: ['chat', 'office', 'openswan'],
  },
  {
    key: 'openswan',
    title: 'OpenSwan — In-App Agent Runtime',
    content: `OpenSwan is the in-app shared agent runtime brand. It manages session lifecycle, tool execution, mode-aware tool filtering (TOOL_MODE_TAGS), and chat mode selection (SELECTABLE_CHAT_MODES). The tool catalog (openswanToolRuntime.ts) enumerates all available tools per mode. Subagents inherit their parent's agentId and mode. The default internal agent id is default::blackswan. Control Panel shows diagnostics: memory age cutoff (30 days), active sessions, tool availability. Key: openswanSessionRuntime.ts, openswanToolRuntime.ts, agentExecutionCore.ts.`,
    tags: ['openswan', 'agent-runtime', 'tools', 'sessions', 'modes'],
    importance: 0.88,
    linksTo: ['blackswan', 'chat', 'office', 'memory-bank'],
  },
  {
    key: 'blackswan',
    title: 'BlackSwan — Custom Foundation Model',
    content: `BlackSwan is the project's custom HuggingFace model (cswan801/BlackSwan-v5). It provides app-grounding context through buildBlackSwanGroundingBlock which injects app-state rules and safe memory references without exposing secrets. Tool-heavy BlackSwan requests use claude-sonnet-4-6 as the reliable executor while BlackSwan remains app context. Routing paths: public HF huggingface/cswan801/BlackSwan-v5, dedicated endpoint huggingface_endpoint/cswan801/BlackSwan-v5. Key: swanbot.ts, blackswanRouting.ts, swanbot-ai edge function.`,
    tags: ['blackswan', 'foundation-model', 'huggingface', 'grounding', 'custom-model'],
    importance: 0.90,
    linksTo: ['openswan', 'chat', 'provider-routing'],
  },
  {
    key: 'memory-bank',
    title: 'Memory Bank — Agent Memory System',
    content: `The Memory Bank stores durable agent knowledge across scopes: circle (shared), user (private), session, and agent. Memory kinds: fact, finding, context, directive. Retrieval modes: startup (always loaded), on_demand, semantic (embedding search). Memories have importance scores, source surfaces, and visibility. The second brain can digest memories into notes and promote notes back to memory. Circle memory has bank-level commands for bulk operations. Key: agentRunSystem.ts, userMemory.ts, memoryBankKinds.ts, sharedMemory.ts. Semantic search uses pgvector with text-embedding-3-small.`,
    tags: ['memory', 'agent-memory', 'embeddings', 'semantic-search', 'knowledge'],
    importance: 0.88,
    linksTo: ['backpack', 'chat', 'openswan', 'office'],
  },
  {
    key: 'provider-routing',
    title: 'Provider Routing — Multi-Provider LLM Orchestration',
    content: `Provider routing is a first-class system managing requests across 18+ AI providers. crossProviderRouter.ts handles fallback chains, universalInvoke.ts provides a unified invocation API, and billingPriority.ts determines cost-aware routing order. Model IDs use provider prefixes: openrouter/auto, google_ai/gemini-2.5-pro, deepseek/deepseek-reasoner. Alias normalization: hugging_face → huggingface, z_ai → zai. The llm-proxy edge function routes authenticated requests server-side. Provider changes must be reflected in 8 files simultaneously. Key: crossProviderRouter.ts, universalInvoke.ts, billingPriority.ts, llm-proxy.`,
    tags: ['routing', 'providers', 'llm', 'fallback', 'model-ids', 'cross-provider'],
    importance: 0.82,
    linksTo: ['marketplace', 'chat', 'blackswan'],
  },
];

// ─── Dynamic content loaders ──────────────────────────────────────────────────

interface DynamicItem {
  key: string;
  title: string;
  content: string;
  tags: string[];
  importance: number;
  parentSectionKey: string;
}

export const SECOND_BRAIN_SITE_MAP_AGENT_STATUSES = ['building', 'idle'] as const;

async function loadActiveMissions(circleId: string): Promise<DynamicItem[]> {
  const { data } = await supabase
    .from('circle_missions')
    .select('id, title, description, status, deadline, created_at')
    .eq('circle_id', circleId)
    .in('status', ['active', 'draft'])
    .order('created_at', { ascending: false })
    .limit(12);
  if (!data?.length) return [];
  return data.map(m => ({
    key: `mission:${m.id}`,
    title: `Mission: ${m.title}`,
    content: [
      m.description || `Active mission: ${m.title}`,
      `Status: ${m.status}`,
      m.deadline ? `Deadline: ${new Date(m.deadline).toLocaleDateString()}` : '',
    ].filter(Boolean).join('\n'),
    tags: ['mission', m.status, 'feed'],
    importance: m.status === 'active' ? 0.80 : 0.65,
    parentSectionKey: 'feed',
  }));
}

async function loadActiveRooms(circleId: string): Promise<DynamicItem[]> {
  const { data } = await supabase
    .from('circle_rooms')
    .select('id, name, description, language, created_at')
    .eq('circle_id', circleId)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (!data?.length) return [];
  return data.map(r => ({
    key: `room:${r.id}`,
    title: `Room: ${r.name}`,
    content: [
      r.description || `Project room: ${r.name}`,
      r.language ? `Language: ${r.language}` : '',
    ].filter(Boolean).join('\n'),
    tags: ['room', r.language || 'code', 'project'],
    importance: 0.72,
    parentSectionKey: 'rooms',
  }));
}

async function loadCircleAgents(circleId: string): Promise<DynamicItem[]> {
  const { data } = await supabase
    .from('circle_office_agents')
    .select('id, display_name, agent_type, status, description')
    .eq('circle_id', circleId)
    .in('status', [...SECOND_BRAIN_SITE_MAP_AGENT_STATUSES])
    .order('created_at', { ascending: false })
    .limit(10);
  if (!data?.length) return [];
  return data.map(a => ({
    key: `agent:${a.id}`,
    title: `Agent: ${a.display_name || a.agent_type || 'Unnamed Agent'}`,
    content: [
      a.description || `Circle agent of type ${a.agent_type}`,
      `Status: ${a.status}`,
    ].filter(Boolean).join('\n'),
    tags: ['agent', a.agent_type || 'custom', 'office'],
    importance: a.status === 'building' ? 0.78 : 0.62,
    parentSectionKey: 'office',
  }));
}

// ─── Upsert helper ────────────────────────────────────────────────────────────

async function upsertSiteMapNote(
  circleId: string,
  userId: string,
  key: string,
  fields: { title: string; content: string; tags: string[]; importance: number },
): Promise<{ note: SecondBrainNote | null; wasNew: boolean; error?: string }> {
  const unavailable = getSecondBrainUnavailableMessage();
  if (unavailable) return { note: null, wasNew: false, error: unavailable };

  const { data: existing, error: existingError } = await supabase
    .from('circle_second_brain_notes')
    .select('id')
    .eq('circle_id', circleId)
    .eq('created_by', userId)
    .contains('metadata', { siteMapKey: key })
    .maybeSingle();

  if (existingError) {
    if (rememberSecondBrainStorageError(existingError)) {
      return { note: null, wasNew: false, error: existingError.message };
    }
    return { note: null, wasNew: false, error: existingError.message };
  }

  if (existing?.id) {
    const result = await updateSecondBrainNote(existing.id, {
      title: fields.title,
      content: fields.content,
      tags: fields.tags,
      importance: fields.importance,
    });
    return { note: result.note, wasNew: false, error: result.error };
  }

  const result = await createSecondBrainNote({
    circleId,
    userId,
    title: fields.title,
    content: fields.content,
    noteKind: 'agent_summary',
    status: 'processed',
    visibility: 'private',
    tags: fields.tags,
    importance: fields.importance,
    metadata: {
      siteMapKey: key,
      source: 'site_map',
      mappedAt: new Date().toISOString(),
    },
  });
  return { note: result.note, wasNew: true, error: result.error };
}

// ─── Main export ──────────────────────────────────────────────────────────────

export interface SiteMapResult {
  created: number;
  updated: number;
  linked: number;
  error?: string;
}

export async function autoMapSiteToSecondBrain(
  circleId: string,
  userId: string,
  onProgress?: (msg: string, pct: number) => void,
): Promise<SiteMapResult> {
  const report = { progress: onProgress || (() => {}) };
  let created = 0, updated = 0, linked = 0;

  try {
    const unavailable = getSecondBrainUnavailableMessage();
    if (unavailable) return { created, updated, linked, error: unavailable };

    // ── 1. Create/update static app sections ──
    const sectionNoteMap = new Map<string, string>(); // key → note id
    const total = SITE_SECTIONS.length;

    for (let i = 0; i < SITE_SECTIONS.length; i++) {
      const section = SITE_SECTIONS[i];
      report.progress(`Mapping: ${section.title}`, Math.round((i / (total * 3)) * 100));
      const { note, wasNew } = await upsertSiteMapNote(circleId, userId, section.key, {
        title: section.title,
        content: section.content,
        tags: section.tags,
        importance: section.importance,
      });
      if (!note && getSecondBrainUnavailableMessage()) {
        return { created, updated, linked, error: getSecondBrainUnavailableMessage() || 'Second brain storage is unavailable.' };
      }
      if (note) {
        sectionNoteMap.set(section.key, note.id);
        wasNew ? created++ : updated++;
      }
      await pause(80);
    }

    // ── 2. Create inter-section links ──
    report.progress('Linking app sections…', 40);
    const linkedPairs = new Set<string>();
    for (const section of SITE_SECTIONS) {
      const fromId = sectionNoteMap.get(section.key);
      if (!fromId) continue;
      for (const targetKey of section.linksTo) {
        const toId = sectionNoteMap.get(targetKey);
        if (!toId) continue;
        const pairKey = [fromId, toId].sort().join(':');
        if (linkedPairs.has(pairKey)) continue;
        linkedPairs.add(pairKey);
        const linkResult = await createSecondBrainLink({
          circleId,
          fromNoteId: fromId,
          toNoteId: toId,
          linkType: 'related',
          strength: 0.75,
          reason: `${section.key} ↔ ${targetKey}`,
        });
        if (linkResult.unavailable) {
          return { created, updated, linked, error: linkResult.error || 'Second brain storage is unavailable.' };
        }
        if (linkResult.link) linked++;
        await pause(40);
      }
    }

    // ── 3. Load and map dynamic content ──
    report.progress('Loading missions, rooms, agents…', 55);
    const [missions, rooms, agents] = await Promise.all([
      loadActiveMissions(circleId),
      loadActiveRooms(circleId),
      loadCircleAgents(circleId),
    ]);

    const dynamicItems = [...missions, ...rooms, ...agents];
    for (let i = 0; i < dynamicItems.length; i++) {
      const item = dynamicItems[i];
      report.progress(`Mapping: ${item.title}`, 55 + Math.round((i / Math.max(dynamicItems.length, 1)) * 35));
      const { note, wasNew } = await upsertSiteMapNote(circleId, userId, item.key, {
        title: item.title,
        content: item.content,
        tags: item.tags,
        importance: item.importance,
      });
      if (!note && getSecondBrainUnavailableMessage()) {
        return { created, updated, linked, error: getSecondBrainUnavailableMessage() || 'Second brain storage is unavailable.' };
      }
      if (note) {
        wasNew ? created++ : updated++;
        const parentId = sectionNoteMap.get(item.parentSectionKey);
        if (parentId) {
          const linkResult = await createSecondBrainLink({
            circleId,
            fromNoteId: parentId,
            toNoteId: note.id,
            linkType: 'source',
            strength: 0.82,
            reason: `Discovered from ${item.parentSectionKey}`,
          });
          if (linkResult.unavailable) {
            return { created, updated, linked, error: linkResult.error || 'Second brain storage is unavailable.' };
          }
          if (linkResult.link) linked++;
        }
      }
      await pause(60);
    }

    report.progress('Site map complete.', 100);
    return { created, updated, linked };
  } catch (err: any) {
    return { created, updated, linked, error: err?.message || 'Site map failed.' };
  }
}

function pause(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
