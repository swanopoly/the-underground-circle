import type { MemoryEntry } from './agentRunSystem';
import type { SecondBrainNote } from './secondBrain';

export type DigitalBrainNodeType = 'surface' | 'database' | 'memory' | 'model' | 'automation' | 'security' | 'agent';
export type DigitalBrainFlowKind = 'read' | 'write' | 'sync' | 'trigger' | 'memory' | 'credential' | 'model' | 'event';

export interface DigitalBrainDbTableConfig {
  table: string;
  label: string;
  description: string;
  filter: 'circle' | 'user' | 'owner' | 'id';
  probe?: 'auto' | 'skip';
  skipReason?: string;
}

export interface DigitalBrainDbStat {
  table: string;
  label: string;
  count: number | null;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

export interface DigitalBrainSystemNode {
  id: string;
  label: string;
  subtitle: string;
  cluster: string;
  type: DigitalBrainNodeType;
  description: string;
  weight: number;
  color?: string;
  metadata?: Record<string, unknown>;
}

export interface DigitalBrainSystemEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: DigitalBrainFlowKind;
  strength: number;
  description: string;
}

export interface DigitalBrainSystemCluster {
  id: string;
  label: string;
  color: string;
  description: string;
  nodeIds: string[];
}

export interface DigitalBrainSystemMap {
  nodes: DigitalBrainSystemNode[];
  edges: DigitalBrainSystemEdge[];
  clusters: DigitalBrainSystemCluster[];
  stats: {
    memories: number;
    syncedMemories: number;
    databaseTables: number;
    appSurfaces: number;
    flows: number;
  };
}

export const DIGITAL_BRAIN_DB_TABLES: DigitalBrainDbTableConfig[] = [
  { table: 'circles', label: 'Circle', description: 'Circle root settings, ownership, and workspace identity.', filter: 'id' },
  { table: 'circle_members', label: 'Members', description: 'Circle membership, permissions, and collaboration access.', filter: 'circle' },
  { table: 'messages', label: 'Chat messages', description: 'Main chat conversation messages.', filter: 'circle' },
  { table: 'chat_sessions', label: 'Chat sessions', description: 'Optional legacy agent chat sessions and model context.', filter: 'circle', probe: 'skip', skipReason: 'Optional legacy table; skipped to avoid noisy missing-table probes.' },
  { table: 'agent_runs', label: 'Agent runs', description: 'Unified automation run records across chat, office, feed, and scheduled work.', filter: 'circle' },
  { table: 'memory_entries', label: 'Memories', description: 'Durable user, circle, session, and agent memory.', filter: 'circle' },
  { table: 'circle_second_brain_notes', label: 'Brain notes', description: 'Digital Brain notes, clips, summaries, and imported memories.', filter: 'circle', probe: 'skip', skipReason: 'Covered by the graph loader; skipped here to avoid duplicate failing probes.' },
  { table: 'circle_second_brain_links', label: 'Brain links', description: 'Saved note-to-note and note-to-memory relationships.', filter: 'circle', probe: 'skip', skipReason: 'Covered by the graph loader; skipped here to avoid duplicate failing probes.' },
  { table: 'circle_integrations', label: 'Integrations', description: 'Marketplace integrations enabled for the circle.', filter: 'circle' },
  { table: 'user_api_keys', label: 'User model keys', description: 'Per-user BYO model/API credentials.', filter: 'user' },
  { table: 'circle_site_credentials', label: 'Circle vault', description: 'Circle-scoped website credentials for automation.', filter: 'circle' },
  { table: 'user_site_credentials', label: 'User vault', description: 'Private user-scoped website credentials for automation.', filter: 'user' },
  { table: 'office_terminal_messages', label: 'Terminal commands', description: 'Office command center prompts sent to agents.', filter: 'circle' },
  { table: 'circle_office_agents', label: 'Office agents', description: 'Agent identities, desks, stats, and customization.', filter: 'circle' },
  { table: 'task_runs', label: 'Task runs', description: 'Feed and mission task execution records.', filter: 'circle' },
  { table: 'computer_use_runs', label: 'Computer use', description: 'Browser and desktop automation run ledger.', filter: 'circle' },
  { table: 'scheduled_actions', label: 'Scheduled actions', description: 'Deferred automations and approval-gated work.', filter: 'circle' },
  { table: 'circle_rooms', label: 'Rooms', description: 'Circle rooms and project collaboration surfaces.', filter: 'circle' },
  { table: 'project_rooms', label: 'Projects', description: 'Project rooms, files, and shared project context.', filter: 'circle' },
  { table: 'claude_api_usage', label: 'Claude usage', description: 'Provider usage tracking and cost audit data.', filter: 'user' },
  { table: 'user_ai_usage', label: 'User AI usage', description: 'Optional per-user AI usage tracking for owner-safe billing.', filter: 'user', probe: 'skip', skipReason: 'Optional cost telemetry table; skipped to avoid noisy missing-table probes.' },
];

const STATIC_NODES: DigitalBrainSystemNode[] = [
  {
    id: 'app-shell',
    label: 'Site shell',
    subtitle: 'Navigation + route state',
    cluster: 'site',
    type: 'surface',
    description: 'The app shell connects Circle dashboards, Backpack, Chat, Office, Feed, Rooms, Marketplace, and Vault.',
    weight: 0.9,
  },
  {
    id: 'auth-profile',
    label: 'Auth + profile',
    subtitle: 'Supabase auth',
    cluster: 'security',
    type: 'security',
    description: 'User identity, profile, RLS membership checks, and account-level ownership.',
    weight: 0.9,
  },
  {
    id: 'circle-dashboard',
    label: 'Circle dashboard',
    subtitle: 'Workspace root',
    cluster: 'site',
    type: 'surface',
    description: 'The circle detail screen routes every major surface through the active circle.',
    weight: 1,
  },
  {
    id: 'chat-dashboard',
    label: 'Chat',
    subtitle: 'Models + tools + agents',
    cluster: 'chat',
    type: 'surface',
    description: 'Main user prompt surface for LLM routing, OpenSwan, browser use, computer use, and terminal agents.',
    weight: 1,
  },
  {
    id: 'openswan-control',
    label: 'OpenSwan control',
    subtitle: 'Planner + tool runtime',
    cluster: 'automation',
    type: 'automation',
    description: 'Turns chat intent into task plans, tool calls, approvals, browser/computer actions, and agent dispatch.',
    weight: 0.95,
  },
  {
    id: 'browser-computer',
    label: 'Browser + desktop',
    subtitle: 'Computer use tunnel',
    cluster: 'automation',
    type: 'automation',
    description: 'Browserbase, local desktop bridges, terminal launchers, and website/computer automation flows.',
    weight: 0.9,
  },
  {
    id: 'office-dashboard',
    label: 'Office',
    subtitle: 'Agents + command center',
    cluster: 'agents',
    type: 'agent',
    description: 'Agent roster, terminal sessions, token/cost telemetry, identity customization, and work management.',
    weight: 0.9,
  },
  {
    id: 'feeds-missions',
    label: 'Feed + missions',
    subtitle: 'Work execution',
    cluster: 'workflow',
    type: 'surface',
    description: 'Tasks, mission execution, run approvals, artifacts, and acceptance checks.',
    weight: 0.82,
  },
  {
    id: 'rooms-projects',
    label: 'Rooms + projects',
    subtitle: 'Project context',
    cluster: 'workflow',
    type: 'surface',
    description: 'Project rooms, files, shared memory, prompts, and collaboration context.',
    weight: 0.82,
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    subtitle: 'APIs + apps',
    cluster: 'models',
    type: 'model',
    description: 'Provider integrations, model keys, search tools, Browserbase, Brave, and app connectors.',
    weight: 0.86,
  },
  {
    id: 'model-router',
    label: 'Model router',
    subtitle: 'Auto pick + BYO keys',
    cluster: 'models',
    type: 'model',
    description: 'Chooses model/provider based on task needs, connected user keys, cost, and computer-use capabilities.',
    weight: 0.9,
  },
  {
    id: 'vault',
    label: 'Vault',
    subtitle: 'Credentials',
    cluster: 'security',
    type: 'security',
    description: 'Encrypted site credentials for website automation, WordPress posting, and browser login flows.',
    weight: 0.86,
  },
  {
    id: 'backpack-brain',
    label: '.web Digital Brain',
    subtitle: 'Private system map',
    cluster: 'brain',
    type: 'surface',
    description: 'Graph, base views, review queue, agent brief, memory import, and this information-flow map.',
    weight: 1,
  },
];

const DB_NODE_GROUPS: Array<{ id: string; label: string; subtitle: string; tables: string[]; description: string; weight: number }> = [
  {
    id: 'db-core',
    label: 'Core DB',
    subtitle: 'circles + members',
    tables: ['circles', 'circle_members'],
    description: 'Circle identity and membership access used by RLS and every dashboard surface.',
    weight: 0.92,
  },
  {
    id: 'db-chat',
    label: 'Chat DB',
    subtitle: 'messages + sessions',
    tables: ['messages', 'chat_sessions'],
    description: 'Conversation persistence, model session state, and chat history.',
    weight: 0.88,
  },
  {
    id: 'db-runs',
    label: 'Run ledger',
    subtitle: 'agent + computer runs',
    tables: ['agent_runs', 'task_runs', 'computer_use_runs', 'scheduled_actions'],
    description: 'Execution records for agent, browser, computer, feed, and scheduled tasks.',
    weight: 0.9,
  },
  {
    id: 'db-memory',
    label: 'Memory DB',
    subtitle: 'memory_entries',
    tables: ['memory_entries'],
    description: 'Durable memory storage that feeds chat, agents, and the Digital Brain.',
    weight: 0.96,
  },
  {
    id: 'db-brain',
    label: 'Brain DB',
    subtitle: 'notes + links',
    tables: ['circle_second_brain_notes', 'circle_second_brain_links'],
    description: 'Digital Brain notes, links, clusters, embeddings, review metadata, and memory imports.',
    weight: 1,
  },
  {
    id: 'db-integrations',
    label: 'Integration DB',
    subtitle: 'keys + apps',
    tables: ['circle_integrations', 'user_api_keys'],
    description: 'Marketplace app connections and user-owned model/search provider keys.',
    weight: 0.86,
  },
  {
    id: 'db-vault',
    label: 'Vault DB',
    subtitle: 'site credentials',
    tables: ['circle_site_credentials', 'user_site_credentials'],
    description: 'Credential records that browser and desktop automation can request with permission.',
    weight: 0.82,
  },
  {
    id: 'db-office',
    label: 'Office DB',
    subtitle: 'agents + terminal',
    tables: ['office_terminal_messages', 'circle_office_agents'],
    description: 'Office agent roster, terminal prompts, identity customization, and agent telemetry.',
    weight: 0.84,
  },
  {
    id: 'db-projects',
    label: 'Project DB',
    subtitle: 'rooms + projects',
    tables: ['circle_rooms', 'project_rooms'],
    description: 'Rooms and project workspace context feeding collaborative agent work.',
    weight: 0.76,
  },
  {
    id: 'db-costs',
    label: 'Usage DB',
    subtitle: 'cost telemetry',
    tables: ['claude_api_usage', 'user_ai_usage'],
    description: 'Usage records that explain model spend and protect platform keys from other users.',
    weight: 0.78,
  },
];

const STATIC_EDGES: DigitalBrainSystemEdge[] = [
  flow('app-shell', 'auth-profile', 'auth session', 'event', 'The app starts by resolving the signed-in user and profile.'),
  flow('auth-profile', 'db-core', 'RLS scope', 'read', 'User identity limits data access to owned or joined circles.'),
  flow('db-core', 'circle-dashboard', 'circle context', 'read', 'Circle membership drives the dashboard and all child surfaces.'),
  flow('circle-dashboard', 'chat-dashboard', 'open chat', 'event', 'The user moves from the circle dashboard into chat.'),
  flow('circle-dashboard', 'office-dashboard', 'open office', 'event', 'The user moves into the Office roster and command center.'),
  flow('circle-dashboard', 'feeds-missions', 'open work', 'event', 'Feed and mission surfaces generate task execution data.'),
  flow('circle-dashboard', 'rooms-projects', 'open project context', 'event', 'Rooms and projects provide shared context for agents.'),
  flow('circle-dashboard', 'backpack-brain', 'open brain', 'event', 'Backpack hosts the private Digital Brain map.'),
  flow('chat-dashboard', 'model-router', 'select model', 'model', 'Chat requests are routed to the best connected model/provider for the task.'),
  flow('marketplace', 'db-integrations', 'save keys', 'write', 'Marketplace settings persist provider connections and BYO keys.'),
  flow('db-integrations', 'model-router', 'available models', 'read', 'The router uses connected providers and keys before calling a model.'),
  flow('model-router', 'db-chat', 'assistant output', 'write', 'Chat messages and model responses are stored for refresh-safe sessions.'),
  flow('chat-dashboard', 'openswan-control', 'agent intent', 'trigger', 'Automation requests are planned through OpenSwan.'),
  flow('openswan-control', 'browser-computer', 'execute tools', 'trigger', 'OpenSwan can route approved browser, computer, terminal, and app actions.'),
  flow('vault', 'db-vault', 'encrypted secrets', 'credential', 'Credentials are stored in vault tables, not directly in prompts.'),
  flow('db-vault', 'browser-computer', 'login grant', 'credential', 'Browser automation can request approved site credentials.'),
  flow('browser-computer', 'db-runs', 'run telemetry', 'write', 'Automation writes run status, steps, artifacts, and approvals.'),
  flow('feeds-missions', 'db-runs', 'task execution', 'write', 'Feed and mission tasks become ledgered task runs.'),
  flow('office-dashboard', 'db-office', 'terminal prompts', 'write', 'Office terminal prompts and agent identity data are persisted.'),
  flow('office-dashboard', 'db-runs', 'terminal agents', 'write', 'Launched terminal agents write run and cost telemetry.'),
  flow('rooms-projects', 'db-projects', 'project state', 'write', 'Project rooms store shared files, activity, and collaboration context.'),
  flow('db-runs', 'db-memory', 'save memory', 'memory', 'Agent runs create durable facts, decisions, findings, and preferences.'),
  flow('db-chat', 'db-memory', 'chat memory', 'memory', 'Useful chat context can be extracted into memory.'),
  flow('db-memory', 'db-brain', 'import memory', 'sync', 'Memories are linked into the Digital Brain as private or circle-shared nodes.'),
  flow('db-brain', 'backpack-brain', 'graph data', 'read', 'Digital Brain notes and links build clusters, bases, review queue, and graph views.'),
  flow('backpack-brain', 'chat-dashboard', 'agent brief', 'sync', 'The Digital Brain can compress context back into chat and agent prompts.'),
  flow('db-costs', 'office-dashboard', 'cost audit', 'read', 'Usage telemetry appears in Office and Backpack dashboards.'),
  flow('model-router', 'db-costs', 'usage records', 'write', 'Model calls should record token and cost usage for owner-safe billing.'),
];

function flow(
  from: string,
  to: string,
  label: string,
  kind: DigitalBrainFlowKind,
  description: string,
  strength = 0.85,
): DigitalBrainSystemEdge {
  return { id: `${from}->${to}:${label}`, from, to, label, kind, description, strength };
}

function countTables(tables: string[], dbStats: Record<string, DigitalBrainDbStat>): number | null {
  let total = 0;
  let any = false;
  for (const table of tables) {
    const count = dbStats[table]?.count;
    if (typeof count === 'number') {
      any = true;
      total += count;
    }
  }
  return any ? total : null;
}

function clusterForMemory(memory: MemoryEntry): DigitalBrainSystemCluster {
  const colorByScope: Record<string, string> = {
    user: '#f59e0b',
    circle: '#22c55e',
    session: '#38bdf8',
    agent: '#a855f7',
    room: '#f43f5e',
    org: '#84cc16',
  };
  const scope = memory.scope || 'circle';
  return {
    id: `memory-${scope}`,
    label: `${scope} memories`,
    color: colorByScope[scope] || '#94a3b8',
    description: `Loaded ${scope}-scoped memories available to this Digital Brain.`,
    nodeIds: [],
  };
}

function sourceSurfaceNode(memory: MemoryEntry): string {
  const surface = String(memory.source_surface || '').toLowerCase();
  if (surface.includes('chat')) return 'chat-dashboard';
  if (surface.includes('terminal') || surface.includes('office')) return 'office-dashboard';
  if (surface.includes('feed') || surface.includes('task') || surface.includes('mission')) return 'feeds-missions';
  if (surface.includes('room') || surface.includes('project')) return 'rooms-projects';
  if (surface.includes('computer') || surface.includes('browser')) return 'browser-computer';
  if (surface.includes('second_brain') || surface.includes('digital_brain')) return 'backpack-brain';
  return 'db-memory';
}

export function buildDigitalBrainSystemMap(input: {
  notes: SecondBrainNote[];
  memories: MemoryEntry[];
  dbStats?: Record<string, DigitalBrainDbStat>;
}): DigitalBrainSystemMap {
  const dbStats = input.dbStats || {};
  const syncedMemoryIds = new Set(input.notes.map((note) => note.source_memory_id).filter(Boolean) as string[]);
  const nodes: DigitalBrainSystemNode[] = [...STATIC_NODES];
  const edges: DigitalBrainSystemEdge[] = [...STATIC_EDGES];
  const clusters = new Map<string, DigitalBrainSystemCluster>([
    ['site', { id: 'site', label: 'Site surfaces', color: '#6366f1', description: 'Primary app surfaces and navigation routes.', nodeIds: [] }],
    ['chat', { id: 'chat', label: 'Chat + prompts', color: '#38bdf8', description: 'Chat, model selection, and prompt execution.', nodeIds: [] }],
    ['automation', { id: 'automation', label: 'Automation', color: '#f59e0b', description: 'OpenSwan, browser use, computer use, and tool execution.', nodeIds: [] }],
    ['agents', { id: 'agents', label: 'Agents', color: '#a855f7', description: 'Office, terminal agents, Codex/Claude sessions, and agent identities.', nodeIds: [] }],
    ['models', { id: 'models', label: 'Models + APIs', color: '#84cc16', description: 'Marketplace model providers, user keys, and routing decisions.', nodeIds: [] }],
    ['security', { id: 'security', label: 'Security + vault', color: '#f43f5e', description: 'Auth, RLS, API keys, and encrypted site credentials.', nodeIds: [] }],
    ['workflow', { id: 'workflow', label: 'Workflows', color: '#fb923c', description: 'Feed, missions, rooms, projects, tasks, and artifacts.', nodeIds: [] }],
    ['database', { id: 'database', label: 'Database', color: '#64748b', description: 'Supabase tables used by the app and Digital Brain.', nodeIds: [] }],
    ['brain', { id: 'brain', label: '.web Digital Brain', color: '#22c55e', description: 'Notes, links, review queue, graph, and agent brief.', nodeIds: [] }],
  ]);

  for (const group of DB_NODE_GROUPS) {
    const count = countTables(group.tables, dbStats);
    nodes.push({
      id: group.id,
      label: group.label,
      subtitle: count == null ? group.subtitle : `${count} visible rows`,
      cluster: 'database',
      type: 'database',
      description: group.description,
      weight: group.weight,
      metadata: { tables: group.tables, count },
    });
  }

  for (const memory of input.memories) {
    const cluster = clusterForMemory(memory);
    if (!clusters.has(cluster.id)) clusters.set(cluster.id, cluster);
    const memoryNodeId = `memory-${memory.id}`;
    const synced = syncedMemoryIds.has(memory.id);
    nodes.push({
      id: memoryNodeId,
      label: memory.title || `${memory.memory_kind} memory`,
      subtitle: `${memory.scope}/${memory.memory_kind}${synced ? ' · synced' : ' · live'}`,
      cluster: cluster.id,
      type: 'memory',
      description: memory.content,
      weight: Math.max(0.45, Math.min(1, Number(memory.importance ?? 0.6))),
      metadata: {
        memoryId: memory.id,
        scope: memory.scope,
        synced,
        sourceSurface: memory.source_surface || null,
      },
    });
    edges.push(flow('db-memory', memoryNodeId, 'loads', 'read', 'Loaded from memory_entries for this signed-in user/circle.', 0.72));
    edges.push(flow(memoryNodeId, 'backpack-brain', synced ? 'synced note' : 'live memory', 'memory', synced
      ? 'This memory already has a linked Digital Brain note.'
      : 'This memory is visible in the map and can be synced into brain notes.', synced ? 0.9 : 0.62));
    const source = sourceSurfaceNode(memory);
    if (source !== 'db-memory') {
      edges.push(flow(source, memoryNodeId, 'created memory', 'memory', `Memory source surface: ${memory.source_surface || source}.`, 0.6));
    }
  }

  for (const node of nodes) {
    const cluster = clusters.get(node.cluster);
    if (cluster) cluster.nodeIds.push(node.id);
  }

  return {
    nodes,
    edges: edges.filter((edge) => nodes.some((node) => node.id === edge.from) && nodes.some((node) => node.id === edge.to)),
    clusters: Array.from(clusters.values()).filter((cluster) => cluster.nodeIds.length > 0),
    stats: {
      memories: input.memories.length,
      syncedMemories: input.memories.filter((memory) => syncedMemoryIds.has(memory.id)).length,
      databaseTables: DIGITAL_BRAIN_DB_TABLES.length,
      appSurfaces: STATIC_NODES.length,
      flows: edges.length,
    },
  };
}
