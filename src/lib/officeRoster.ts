import type { CircleOfficeAgent } from './circleOffice';
import { PROVIDER_META, type ProviderType, type AgentConnection } from './connectionManager';
import { getAgentIdentityKey, type AgentIdentity } from './agentIdentity';
import { DEFAULT_AGENT, HUGGINGSWAN_AGENT, type OfficeAgent } from './officeAgents';
// HUGGINGSWAN_AGENT kept in import so isHuggingSwan() can compare ids; do not
// re-pin it as a roster slot.
void HUGGINGSWAN_AGENT;

type BuildOfficeRosterOptions = {
  agents: OfficeAgent[];
  currentUserId?: string;
  circleAgents?: CircleOfficeAgent[];
  connections?: AgentConnection[];
  identities?: Map<string, AgentIdentity>;
  selectedAgentId?: string | null;
};

const NON_PERSISTENT_PROVIDER_TYPES = new Set<ProviderType>([
  'blackswan-local',
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'ollama',
  'replicate',
  'figma',
  'github-models',
  'huggingface',
]);

function supportsPersistentProviderMain(providerType: ProviderType): boolean {
  return !NON_PERSISTENT_PROVIDER_TYPES.has(providerType);
}

const SUBAGENT_RECENT_WINDOW_MS = 2 * 60 * 60 * 1000;
const MAIN_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function getAgentTime(agent: OfficeAgent): number {
  return agent.lastActive ? new Date(agent.lastActive).getTime() : 0;
}

function isBlackSwan(agent: OfficeAgent): boolean {
  return agent.id === DEFAULT_AGENT.id || agent.name.toLowerCase() === 'blackswan' || agent.providerType === 'blackswan-local';
}

// HuggingSwan — second pinned synthesized agent. Sits right behind BlackSwan
// in the roster ordering. Detected by id, name, or the huggingface provider
// type (the synthesized one — real per-circle HF connections still slot
// into the normal provider-mains lane).
function isHuggingSwan(agent: OfficeAgent): boolean {
  return agent.id === HUGGINGSWAN_AGENT.id
    || (agent.providerType === 'huggingface' && agent.isSynthetic === true)
    || agent.name.toLowerCase() === 'huggingswan';
}

// Local CLI providers — these come from the user's machine via bridges
// (claude-bridge.js scans ~/.claude/projects, similar for cursor/codex/gemini).
// An agent of these provider types that isn't offline = a session the user
// has open in their terminal right now.
const LOCAL_CLI_PROVIDERS = new Set<ProviderType>(['claude-code', 'cursor', 'codex', 'gemini']);

function hasOpenLocalSession(agent: OfficeAgent): boolean {
  if (!LOCAL_CLI_PROVIDERS.has(agent.providerType)) return false;
  if (agent.status === 'offline') return false;
  // Also require the bridge to have published it — synthetic provider mains
  // (no real bridge connection) shouldn't elbow out actually-running sessions.
  if (agent.isSynthetic) return false;
  return true;
}

// Within the "active local session" tier, rank by:
//   1. building (currently executing a tool)   highest urgency
//   2. active  (live, responding)
//   3. idle    (terminal open, no current activity)
// Then by recency of activity.
function sortLocalSessions(a: OfficeAgent, b: OfficeAgent): number {
  const statusRank: Record<string, number> = { building: 0, active: 1, idle: 2 };
  const aRank = statusRank[a.status] ?? 3;
  const bRank = statusRank[b.status] ?? 3;
  if (aRank !== bRank) return aRank - bRank;
  return getAgentTime(b) - getAgentTime(a);
}

function isSubagent(agent: OfficeAgent): boolean {
  const kind = String(agent.runtimeKind || '').toLowerCase();
  const role = String(agent.role || '').toLowerCase();
  return kind === 'subagent' || role.includes('sub-agent') || !!agent.parentSessionKey;
}

function isRecentlyUseful(agent: OfficeAgent, now: number): boolean {
  if (agent.status === 'building' || agent.status === 'active') return true;
  const lastActive = getAgentTime(agent);
  if (!lastActive) return false;
  if (now - lastActive <= SUBAGENT_RECENT_WINDOW_MS) return true;
  return (agent.turns || agent.messagesProcessed || 0) > 0 && now - lastActive <= MAIN_RECENT_WINDOW_MS;
}

function scoreMainCandidate(agent: OfficeAgent, identities: Map<string, AgentIdentity>): number {
  const identity = identities.get(getAgentIdentityKey(agent));
  const kind = String(agent.runtimeKind || '').toLowerCase();
  let score = 0;
  if (identity?.isPrimary) score += 100;
  if (kind === 'main') score += 25;
  if (!isSubagent(agent)) score += 10;
  if (agent.status === 'building') score += 20;
  if (agent.status === 'active') score += 15;
  if (agent.status === 'idle') score += 8;
  score += Math.min(12, (agent.turns || agent.messagesProcessed || 0) / 5);
  score += getAgentTime(agent) / 1_000_000_000_000;
  return score;
}

function buildSyntheticProviderMain(providerType: ProviderType, opts: BuildOfficeRosterOptions): OfficeAgent | null {
  if (!supportsPersistentProviderMain(providerType)) return null;

  const providerMeta = PROVIDER_META[providerType];
  if (!providerMeta) return null;

  let identityEntry: [string, AgentIdentity] | undefined;
  for (const entry of Array.from(opts.identities?.entries() || [])) {
    if (entry[1].boundAiProvider === providerType) {
      if (!identityEntry || (entry[1].isPrimary && !identityEntry[1].isPrimary) || entry[1].lastSeen > identityEntry[1].lastSeen) {
        identityEntry = entry;
      }
    }
  }

  const dbAgent = (opts.circleAgents || [])
    .filter(agent => agent.ownerId === opts.currentUserId && agent.provider === providerType)
    .sort((a, b) => new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime())[0];

  const baseName =
    identityEntry?.[1].customName ||
    dbAgent?.name ||
    providerMeta.label;

  const lastSeenMs = identityEntry?.[1].lastSeen || (dbAgent?.lastActiveAt ? new Date(dbAgent.lastActiveAt).getTime() : 0);

  return {
    id: `provider-main::${providerType}`,
    name: baseName,
    role: 'Main Pixel Agent',
    status: dbAgent?.status === 'building' || dbAgent?.status === 'active' || dbAgent?.status === 'idle' ? dbAgent.status : 'idle',
    color: dbAgent?.color || providerMeta.color,
    deskIndex: 0,
    activity: dbAgent?.currentTask || `Ready for ${providerMeta.label} work`,
    messagesProcessed: identityEntry?.[1].totalMessages || dbAgent?.message_count_total || 0,
    uptimeHours: 0,
    uptime: dbAgent?.lastActiveAt ? 'recently seen' : 'saved for later',
    lastActive: dbAgent?.lastActiveAt || (lastSeenMs ? new Date(lastSeenMs).toISOString() : ''),
    recentActions: [],
    recentMessages: [],
    costToday: dbAgent?.estimated_cost_today || 0,
    costTotal: identityEntry?.[1].totalCostAllTime || dbAgent?.estimated_cost_total || 0,
    costWeek: 0,
    tokensUsed: identityEntry?.[1].totalTokensAllTime || dbAgent?.token_usage_total || 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    newTokens: 0,
    turns: identityEntry?.[1].totalTurns || 0,
    sessionKey: identityEntry?.[0] || `provider-main:${providerType}`,
    model: identityEntry?.[1].boundModel || dbAgent?.model_name || providerMeta.label,
    connectionId: `provider-main:${providerType}`,
    connectionName: providerMeta.label,
    providerType,
    spirit: dbAgent?.spirit,
    runtimeKind: 'main',
    isSynthetic: true,
    isProviderMain: true,
  };
}

export function buildOfficeRoster(opts: BuildOfficeRosterOptions): OfficeAgent[] {
  const identities = opts.identities || new Map<string, AgentIdentity>();
  const now = Date.now();

  const liveAgents = opts.agents.filter(agent => !isBlackSwan(agent));
  const byProvider = new Map<ProviderType, OfficeAgent[]>();
  for (const agent of liveAgents) {
    const list = byProvider.get(agent.providerType) || [];
    list.push(agent);
    byProvider.set(agent.providerType, list);
  }

  const providerTypes = new Set<ProviderType>();
  for (const agent of liveAgents) {
    if (supportsPersistentProviderMain(agent.providerType)) providerTypes.add(agent.providerType);
  }
  for (const conn of opts.connections || []) {
    if (supportsPersistentProviderMain(conn.provider)) providerTypes.add(conn.provider);
  }
  for (const identity of identities.values()) {
    if (identity.boundAiProvider && supportsPersistentProviderMain(identity.boundAiProvider as ProviderType)) {
      providerTypes.add(identity.boundAiProvider as ProviderType);
    }
  }
  for (const dbAgent of opts.circleAgents || []) {
    if (dbAgent.ownerId === opts.currentUserId && dbAgent.provider && supportsPersistentProviderMain(dbAgent.provider as ProviderType)) {
      providerTypes.add(dbAgent.provider as ProviderType);
    }
  }

  const providerMains: OfficeAgent[] = [];
  const extras: OfficeAgent[] = [];

  for (const providerType of providerTypes) {
    const candidates = (byProvider.get(providerType) || []).slice();
    const main = candidates
      .sort((a, b) => scoreMainCandidate(b, identities) - scoreMainCandidate(a, identities))[0]
      || buildSyntheticProviderMain(providerType, opts);

    if (main) {
      providerMains.push({ ...main, isProviderMain: true });
    }

    const mainId = main?.id;
    const providerExtras = candidates
      .filter(agent => agent.id !== mainId)
      .filter(agent => opts.selectedAgentId === agent.id || isRecentlyUseful(agent, now))
      .sort((a, b) => {
        const aWorking = a.status === 'building' || a.status === 'active';
        const bWorking = b.status === 'building' || b.status === 'active';
        if (aWorking !== bWorking) return aWorking ? -1 : 1;
        return getAgentTime(b) - getAgentTime(a);
      })
      .slice(0, 3);

    extras.push(...providerExtras);
  }

  const blackSwan = opts.agents.find(isBlackSwan) || DEFAULT_AGENT;

  // HuggingSwan is no longer pinned as its own roster slot — it lives as
  // OpenSwan's swan companion now. We still strip any HuggingSwan records
  // from the provider buckets below so they don't render as standalone
  // agents.

  // Within providerMains, tier the order so:
  //   1. Local CLI sessions the user has open in their terminal RIGHT NOW
  //      (claude-code/cursor/codex/gemini, status != offline, not synthetic)
  //   2. Everyone else
  // Within each tier, fall back to: primary identity → working > idle → recent.
  // BlackSwan is handled separately and always lands at index 0.
  providerMains.sort((a, b) => {
    const aLocal = hasOpenLocalSession(a);
    const bLocal = hasOpenLocalSession(b);
    if (aLocal !== bLocal) return aLocal ? -1 : 1;
    if (aLocal && bLocal) return sortLocalSessions(a, b);
    const aPrimary = identities.get(getAgentIdentityKey(a))?.isPrimary ? 1 : 0;
    const bPrimary = identities.get(getAgentIdentityKey(b))?.isPrimary ? 1 : 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    const aWorking = a.status === 'building' || a.status === 'active';
    const bWorking = b.status === 'building' || b.status === 'active';
    if (aWorking !== bWorking) return aWorking ? -1 : 1;
    return getAgentTime(b) - getAgentTime(a);
  });

  extras.sort((a, b) => {
    const aLocal = hasOpenLocalSession(a);
    const bLocal = hasOpenLocalSession(b);
    if (aLocal !== bLocal) return aLocal ? -1 : 1;
    if (aLocal && bLocal) return sortLocalSessions(a, b);
    const aWorking = a.status === 'building' || a.status === 'active';
    const bWorking = b.status === 'building' || b.status === 'active';
    if (aWorking !== bWorking) return aWorking ? -1 : 1;
    return getAgentTime(b) - getAgentTime(a);
  });

  // Filter HuggingSwan out of the provider-mains/extras buckets so it doesn't
  // double-render — it has its own pinned slot below.
  const mainsWithoutHs = providerMains.filter(a => !isHuggingSwan(a));
  const extrasWithoutHs = extras.filter(a => !isHuggingSwan(a));

  // Final order: OpenSwan first (untouchable), then local-session mains,
  // then non-local mains, then extras. Splitting providerMains into two
  // buckets here (instead of relying on the in-array sort alone) guarantees
  // every local session lands directly behind OpenSwan.
  const localMains = mainsWithoutHs.filter(hasOpenLocalSession);
  const otherMains = mainsWithoutHs.filter(a => !hasOpenLocalSession(a));
  const localExtras = extrasWithoutHs.filter(hasOpenLocalSession);
  const otherExtras = extrasWithoutHs.filter(a => !hasOpenLocalSession(a));

  const deduped = new Map<string, OfficeAgent>();
  for (const agent of [blackSwan, ...localMains, ...localExtras, ...otherMains, ...otherExtras]) {
    const key = `${agent.providerType}:${agent.id}`;
    if (!deduped.has(key)) deduped.set(key, agent);
  }

  return Array.from(deduped.values()).map((agent, index) => ({
    ...agent,
    deskIndex: index,
  }));
}
