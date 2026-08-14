/**
 * multiAgentDispatch — parse "talk to multiple agents at once" requests
 * out of chat input. RN-free so Node smoketests can import it.
 *
 * Input pattern: 2+ leading @mentions followed by a prompt body.
 *   "@blackswan @claudia summarize what shipped today"
 *   "@swan @gabe @rio plan the next sprint"
 *
 * The caller passes a resolver that maps lowercase aliases ("blackswan",
 * "swanbot") to canonical agent names. We stop at the first unresolved
 * alias — that signals the user wasn't actually addressing multiple
 * agents (e.g. "@blackswan @everyone please" is not multi-agent).
 *
 * Returns null when fewer than 2 distinct agents resolve, so the
 * caller's normal single-agent path runs unchanged.
 */

export interface AgentMentionRef {
  /** Original mention with @, e.g. "@BlackSwan". */
  raw: string;
  /** Lowercased alias as typed, e.g. "blackswan". */
  alias: string;
  /** Canonical agent name from the resolver. */
  resolvedName: string;
}

export interface MultiAgentParseResult {
  agents: AgentMentionRef[];
  /** The prompt body with leading mentions stripped. */
  cleanedPrompt: string;
}

export type AliasResolver = (alias: string) => string | null;
export type MultiAgentStrategy = 'parallel' | 'roundtable' | 'sequential' | 'debate';

export interface MultiAgentAvailableAgent {
  id: string;
  name: string;
  provider?: string | null;
  status?: string | null;
  model?: string | null;
}

export interface MultiAgentDeploymentIntent {
  bounded: true;
  strategy: MultiAgentStrategy;
  maxTargets: number;
  targetIds: string[];
  truncatedCount: number;
  requestedScope: string;
  modelPolicy: 'agent_select_from_connected_providers';
}

export interface MultiAgentOrchestrationPlan {
  kind: 'dispatch' | 'help';
  prompt: string;
  targetIds: string[];
  targetNames: string[];
  targetDescription: string;
  strategy: MultiAgentStrategy;
  truncatedCount: number;
  reason?: string;
  deploymentIntent?: MultiAgentDeploymentIntent;
}

export interface MultiAgentRunResult {
  agentName: string;
  provider?: string | null;
  ok: boolean;
  replyPreview?: string | null;
}

// Immutable runtime ids use `::` (for example
// `bridge::codex::session-id` and `connection-id::session-key`). A colon is
// part of a mention only when another id segment follows it, so `@agent: task`
// still leaves the prompt delimiter untouched.
const MENTION_HEAD = /^@([A-Za-z0-9_][A-Za-z0-9_.-]*(?::+[A-Za-z0-9_][A-Za-z0-9_.-]*)*)/;

export function parseMultiAgentRequest(
  input: string,
  resolveAlias: AliasResolver,
): MultiAgentParseResult | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('@')) return null;

  const agents: AgentMentionRef[] = [];
  const seen = new Set<string>();
  let rest = trimmed;

  while (rest.startsWith('@')) {
    const m = rest.match(MENTION_HEAD);
    if (!m) break;
    const alias = m[1].toLowerCase();
    const resolved = resolveAlias(alias);
    if (!resolved) break;
    if (!seen.has(resolved)) {
      seen.add(resolved);
      agents.push({ raw: m[0], alias, resolvedName: resolved });
    }
    rest = rest.slice(m[0].length).trimStart();
  }

  if (agents.length < 2) return null;
  if (rest.length === 0) return null;
  return { agents, cleanedPrompt: rest };
}

/**
 * Build a resolver from a map of lowercase-keyed aliases. Convenience
 * wrapper for the most common case where the caller has a static map.
 */
export function makeAliasResolver(aliases: Record<string, string>): AliasResolver {
  return (alias: string) => aliases[alias.toLowerCase()] || null;
}

/**
 * Default BlackSwan aliases — every UC circle has BlackSwan, and the
 * user calls it via several names. Exported so the ChatTab integration
 * can merge these with circle-specific agent names.
 */
export const BLACKSWAN_ALIASES = ['blackswan', 'swanbot', 'swan', 'agent'];

const MAX_MULTI_AGENT_TARGETS = 12;
const MAX_ROUNDTABLE_TARGETS = 5;
const MAX_SEQUENTIAL_TARGETS = 8;
const MAX_DEBATE_TARGETS = 6;

function maxTargetsForStrategy(strategy: MultiAgentStrategy): number {
  return strategy === 'roundtable'
    ? MAX_ROUNDTABLE_TARGETS
    : strategy === 'sequential'
      ? MAX_SEQUENTIAL_TARGETS
      : strategy === 'debate'
        ? MAX_DEBATE_TARGETS
        : MAX_MULTI_AGENT_TARGETS;
}

function normalizeAlias(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[’']/g, '')
    .replace(/[_:]+/g, ' ')
    .replace(/[^\w#.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactAlias(value: string): string {
  return normalizeAlias(value).replace(/\s+/g, '');
}

function uniqueAgents(agents: MultiAgentAvailableAgent[]): MultiAgentAvailableAgent[] {
  const seen = new Set<string>();
  const out: MultiAgentAvailableAgent[] = [];
  for (const agent of agents) {
    if (!agent?.id || !agent.name) continue;
    if (seen.has(agent.id)) continue;
    seen.add(agent.id);
    out.push(agent);
  }
  return out;
}

function isUsableAgent(agent: MultiAgentAvailableAgent): boolean {
  const status = String(agent.status || '').toLowerCase();
  return status !== 'offline' && status !== 'error';
}

function isActiveAgent(agent: MultiAgentAvailableAgent): boolean {
  const status = String(agent.status || '').toLowerCase();
  return status === 'active' || status === 'building' || status === 'idle' || !status;
}

type MultiAgentAliasIndex = {
  aliases: Record<string, string>;
  agentIds: Record<string, string>;
  ambiguous: Set<string>;
};

function buildMultiAgentAliasIndex(agents: MultiAgentAvailableAgent[]): MultiAgentAliasIndex {
  const candidates = new Map<string, Map<string, string>>();
  const aliases: Record<string, string> = {};
  const agentIds: Record<string, string> = {};
  const ambiguous = new Set<string>();
  const add = (alias: string, agent: MultiAgentAvailableAgent) => {
    const raw = String(alias || '').trim().toLowerCase().replace(/^@/, '');
    const normalized = normalizeAlias(alias);
    const compact = compactAlias(alias);
    for (const key of new Set([raw, normalized, compact])) {
      if (!key) continue;
      const matches = candidates.get(key) || new Map<string, string>();
      matches.set(agent.id, agent.name);
      candidates.set(key, matches);
    }
  };

  for (const agent of uniqueAgents(agents)) {
    add(agent.name, agent);
    add(agent.id, agent);
    if (agent.provider) add(`${agent.provider} ${agent.name}`, agent);
    if (agent.name.includes('#')) add(agent.name.replace('#', ''), agent);
  }

  const openswan = agents.find(agent =>
    normalizeAlias(agent.name) === 'openswan'
    || normalizeAlias(agent.provider || '') === 'openswan'
    || agent.id === 'default::blackswan'
  );
  if (openswan) {
    for (const alias of BLACKSWAN_ALIASES) add(alias, openswan);
    add('open swan', openswan);
    add('openswan', openswan);
  }

  for (const [key, matches] of candidates) {
    if (matches.size === 1) {
      const [agentId, agentName] = Array.from(matches.entries())[0];
      aliases[key] = agentName;
      agentIds[key] = agentId;
    } else {
      ambiguous.add(key);
    }
  }

  return { aliases, agentIds, ambiguous };
}

export function buildMultiAgentAliasMap(agents: MultiAgentAvailableAgent[]): Record<string, string> {
  return buildMultiAgentAliasIndex(agents).aliases;
}

function findExplicitAmbiguousAlias(raw: string, ambiguous: Set<string>): string | null {
  for (const match of raw.matchAll(/@([A-Za-z0-9_][A-Za-z0-9_.-]*(?::+[A-Za-z0-9_][A-Za-z0-9_.-]*)*)/g)) {
    const candidate = match[1] || '';
    const normalized = normalizeAlias(candidate);
    const compact = compactAlias(candidate);
    if (ambiguous.has(normalized) || ambiguous.has(compact)) return candidate;
  }

  const colon = raw.indexOf(':');
  if (colon > 0) {
    const targetText = raw.slice(0, colon).replace(/^\/(?:multi|multi-agent|all-agents|roundtable|agent-roundtable|sequence|sequential|agent-chain|debate|agent-debate|agents)\b/i, '');
    for (const candidate of splitTargetList(targetText)) {
      const normalized = normalizeAlias(candidate);
      const compact = compactAlias(candidate);
      if (ambiguous.has(normalized) || ambiguous.has(compact)) return candidate;
    }
  }
  return null;
}

function resolveUniqueAgentsByIds(
  ids: string[],
  agents: MultiAgentAvailableAgent[],
): MultiAgentAvailableAgent[] | null {
  const resolved: MultiAgentAvailableAgent[] = [];
  for (const id of ids) {
    const matches = agents.filter(agent => agent.id === id);
    if (matches.length !== 1) return null;
    if (!resolved.some(agent => agent.id === matches[0].id)) resolved.push(matches[0]);
  }
  return resolved;
}

function resolveTargetsByMentions(
  raw: string,
  agents: MultiAgentAvailableAgent[],
  resolver: AliasResolver,
): { targetIds: string[]; prompt: string } | null {
  const parsed = parseMultiAgentRequest(raw, resolver);
  if (!parsed) return null;
  const availableIds = new Set(agents.map(agent => agent.id));
  const ids = parsed.agents
    .map(ref => ref.resolvedName)
    .filter(id => availableIds.has(id));
  if (ids.length < 2) return null;
  return { targetIds: ids, prompt: parsed.cleanedPrompt };
}

function splitTargetList(value: string): string[] {
  const matches = Array.from(value.matchAll(/"([^"]+)"|'([^']+)'|@?([\w][\w#.:\-\s]*?)(?=,|&|\band\b|$)/gi));
  if (matches.length > 0) {
    return matches
      .map(match => (match[1] || match[2] || match[3] || '').trim())
      .filter(Boolean);
  }
  return value.split(/\s*(?:,|&|\band\b)\s*/i).map(part => part.trim()).filter(Boolean);
}

function resolveTargetId(input: string, aliases: Record<string, string>): string | null {
  const raw = String(input || '').trim().toLowerCase().replace(/^@/, '');
  if (aliases[raw]) return aliases[raw];
  const key = normalizeAlias(input);
  if (aliases[key]) return aliases[key];
  const compact = compactAlias(input);
  if (aliases[compact]) return aliases[compact];
  const matches = Array.from(new Set(
    Object.entries(aliases)
      .filter(([alias]) => alias.startsWith(key) || key.startsWith(alias))
      .map(([, id]) => id),
  ));
  return matches.length === 1 ? matches[0] : null;
}

function splitNamedTargetsAndPrompt(body: string): { targetText: string; prompt: string } | null {
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if ((char === '"' || char === "'") && body[index - 1] !== '\\') {
      quote = quote === char ? null : quote || char;
      continue;
    }
    if (char !== ':' || quote) continue;
    if (body[index - 1] === ':' || body[index + 1] === ':') continue;
    const targetText = body.slice(0, index).trim();
    const prompt = body.slice(index + 1).trim();
    if (targetText && prompt) return { targetText, prompt };
  }
  return null;
}

function providerKeysFromText(value: string): string[] {
  const raw = normalizeAlias(value);
  const keys: string[] = [];
  if (/\bclaude(?:\s+code)?\b/.test(raw)) keys.push('claude-code');
  if (/\bcodex\b/.test(raw)) keys.push('codex');
  if (/\bgemini(?:\s+cli)?\b/.test(raw)) keys.push('gemini');
  if (/\bcursor\b/.test(raw)) keys.push('cursor');
  if (/\bopenswan|open swan|swanbot|blackswan|black swan\b/.test(raw)) keys.push('openswan');
  if (/\bterminal|local|cli\b/.test(raw)) keys.push('terminal');
  return Array.from(new Set(keys));
}

function providerMatches(agent: MultiAgentAvailableAgent, providers: string[]): boolean {
  const provider = normalizeAlias(agent.provider || '');
  return providers.some(key => {
    if (key === 'terminal') return ['claude-code', 'codex', 'gemini', 'gemini-cli', 'cursor'].includes(provider);
    if (key === 'gemini') return provider === 'gemini' || provider === 'gemini-cli';
    if (key === 'openswan') return provider === 'openswan' || agent.id === 'default::blackswan';
    return provider === key;
  });
}

function normalizeStrategy(value: string | null | undefined): MultiAgentStrategy | null {
  const raw = normalizeAlias(value || '');
  if (!raw) return null;
  if (raw === 'parallel' || raw === 'fan out' || raw === 'fanout') return 'parallel';
  if (raw === 'roundtable' || raw === 'round table' || raw === 'council') return 'roundtable';
  if (raw === 'sequential' || raw === 'sequence' || raw === 'chain' || raw === 'handoff') return 'sequential';
  if (raw === 'debate' || raw === 'peer review' || raw === 'review' || raw === 'red team') return 'debate';
  return null;
}

function strategyLabel(strategy: MultiAgentStrategy): string {
  if (strategy === 'roundtable') return 'roundtable';
  if (strategy === 'sequential') return 'chain';
  if (strategy === 'debate') return 'debate';
  return 'run';
}

function capTargets(
  targets: MultiAgentAvailableAgent[],
  strategy: MultiAgentStrategy,
): { targets: MultiAgentAvailableAgent[]; truncatedCount: number } {
  const cap = maxTargetsForStrategy(strategy);
  const usable = uniqueAgents(targets).filter(isUsableAgent);
  return {
    targets: usable.slice(0, cap),
    truncatedCount: Math.max(0, usable.length - cap),
  };
}

function makeDispatchPlan(input: {
  agents: MultiAgentAvailableAgent[];
  prompt: string;
  strategy?: MultiAgentStrategy;
  targetDescription: string;
  reason?: string;
}): MultiAgentOrchestrationPlan {
  const strategy = input.strategy || 'parallel';
  const prompt = input.prompt.trim();
  if (!prompt) {
    return {
      kind: 'help',
      prompt: '',
      targetIds: [],
      targetNames: [],
      targetDescription: input.targetDescription,
      strategy,
      truncatedCount: 0,
      reason: input.reason || 'Add a task or question for the selected agents.',
    };
  }
  const capped = capTargets(input.agents, strategy);
  const targetIds = capped.targets.map(agent => agent.id);
  const targetNames = capped.targets.map(agent => agent.name);
  if (capped.targets.length < 2) {
    return {
      kind: 'help',
      prompt: '',
      targetIds: [],
      targetNames: [],
      targetDescription: input.targetDescription,
      strategy,
      truncatedCount: 0,
      reason: input.reason || 'Need at least two available agents for a multi-agent run.',
    };
  }
  return {
    kind: 'dispatch',
    prompt,
    targetIds,
    targetNames,
    targetDescription: input.targetDescription,
    strategy,
    truncatedCount: capped.truncatedCount,
    reason: input.reason,
    deploymentIntent: {
      bounded: true,
      strategy,
      maxTargets: maxTargetsForStrategy(strategy),
      targetIds,
      truncatedCount: capped.truncatedCount,
      requestedScope: input.targetDescription,
      modelPolicy: 'agent_select_from_connected_providers',
    },
  };
}

function parseSlashMultiAgent(
  raw: string,
  agents: MultiAgentAvailableAgent[],
  aliases: Record<string, string>,
): MultiAgentOrchestrationPlan | null {
  const command = raw.match(/^\/(multi|multi-agent|all-agents|roundtable|agent-roundtable|sequence|sequential|agent-chain|debate|agent-debate|agents)\b\s*([\s\S]*)$/i);
  if (!command) return null;

  const commandName = command[1].toLowerCase();
  let body = (command[2] || '').trim();
  let strategy: MultiAgentStrategy = commandName.includes('roundtable')
    ? 'roundtable'
    : commandName.includes('sequence') || commandName.includes('sequential') || commandName.includes('chain')
      ? 'sequential'
      : commandName.includes('debate')
        ? 'debate'
        : 'parallel';

  if (commandName === 'all-agents') {
    if (!body) return makeDispatchPlan({ agents: [], prompt: '', strategy, targetDescription: 'all agents', reason: 'Add a task after `/all-agents`.' });
    return makeDispatchPlan({ agents, prompt: body, strategy, targetDescription: 'all agents' });
  }

  if (!body) {
    return {
      kind: 'help',
      prompt: '',
      targetIds: [],
      targetNames: [],
      targetDescription: 'multi-agent help',
      strategy,
      truncatedCount: 0,
      reason: 'No multi-agent task was provided.',
    };
  }

  body = body.replace(/^:/, '').trim();

  const strategyPrefix = body.match(/^(parallel|fanout|fan out|roundtable|round table|council|sequential|sequence|chain|handoff|debate|peer review|review|red team)\b\s*:?\s*([\s\S]+)$/i);
  if (strategyPrefix) {
    strategy = normalizeStrategy(strategyPrefix[1]) || strategy;
    body = strategyPrefix[2].trim();
  }

  if (/^(?:help|examples?)$/i.test(body)) {
    return {
      kind: 'help',
      prompt: '',
      targetIds: [],
      targetNames: [],
      targetDescription: 'multi-agent help',
      strategy,
      truncatedCount: 0,
      reason: 'Multi-agent command examples.',
    };
  }

  if (/^(?:all|everyone|active|available|providers?|team)$/i.test(body)) {
    return makeDispatchPlan({
      agents: [],
      prompt: '',
      strategy,
      targetDescription: body,
      reason: `Add a task after \`/${commandName} ${body}\`.`,
    });
  }

  const allMatch = body.match(/^(all|everyone|active|available)\b\s*:?\s*([\s\S]+)$/i);
  if (allMatch) {
    const scope = allMatch[1].toLowerCase();
    const prompt = allMatch[2].trim();
    const scoped = scope === 'active' || scope === 'available' ? agents.filter(isActiveAgent) : agents;
    return makeDispatchPlan({ agents: scoped, prompt, strategy, targetDescription: scope === 'everyone' ? 'all agents' : `${scope} agents` });
  }

  const providerMatch = body.match(/^(?:providers?|team)\s+(.+?)\s*:?\s+([\s\S]+)$/i);
  if (providerMatch) {
    const providers = providerKeysFromText(providerMatch[1]);
    if (providers.length > 0) {
      const scoped = agents.filter(agent => providerMatches(agent, providers));
      return makeDispatchPlan({
        agents: scoped,
        prompt: providerMatch[2],
        strategy,
        targetDescription: `${providerMatch[1].trim()} agents`,
      });
    }
  }

  const mentionTargets = resolveTargetsByMentions(body, agents, makeAliasResolver(aliases));
  if (mentionTargets) {
    const scoped = resolveUniqueAgentsByIds(mentionTargets.targetIds, agents);
    if (!scoped) {
      return makeDispatchPlan({
        agents: [],
        prompt: '',
        strategy,
        targetDescription: 'ambiguous agent targets',
        reason: 'Two or more agents share that name. Choose targets by their unique session or agent id.',
      });
    }
    return makeDispatchPlan({ agents: scoped, prompt: mentionTargets.prompt, strategy, targetDescription: scoped.map(agent => `@${agent.name}`).join(' ') });
  }

  const namedMatch = splitNamedTargetsAndPrompt(body);
  if (namedMatch && /[@'",]|\band\b/i.test(namedMatch.targetText)) {
    const ids = splitTargetList(namedMatch.targetText)
      .map(part => resolveTargetId(part, aliases))
      .filter((id): id is string => !!id);
    const scoped = resolveUniqueAgentsByIds(Array.from(new Set(ids)), agents);
    if (!scoped) {
      return makeDispatchPlan({
        agents: [],
        prompt: '',
        strategy,
        targetDescription: 'ambiguous agent targets',
        reason: 'Two or more agents share that name. Choose targets by their unique session or agent id.',
      });
    }
    return makeDispatchPlan({ agents: scoped, prompt: namedMatch.prompt, strategy, targetDescription: scoped.map(agent => `@${agent.name}`).join(' ') || 'selected agents' });
  }

  if (strategy === 'roundtable') {
    return makeDispatchPlan({ agents: agents.filter(isActiveAgent), prompt: body, strategy, targetDescription: 'agent roundtable' });
  }

  if (strategy === 'sequential') {
    return makeDispatchPlan({ agents: agents.filter(isActiveAgent), prompt: body, strategy, targetDescription: 'agent chain' });
  }

  if (strategy === 'debate') {
    return makeDispatchPlan({ agents: agents.filter(isActiveAgent), prompt: body, strategy, targetDescription: 'agent debate' });
  }

  return makeDispatchPlan({ agents: agents.filter(isActiveAgent), prompt: body, strategy, targetDescription: 'active agents' });
}

function parseNaturalMultiAgent(
  raw: string,
  agents: MultiAgentAvailableAgent[],
): MultiAgentOrchestrationPlan | null {
  const trailingMaxFanout = raw.match(/^([\s\S]+?)\s+(?:and\s+)?(?:use|deploy|spawn|run|assign|with|using|have|put)\s+as\s+many\s+agents?(?:\s+work\s+on\s+(?:it|this))?\s+as\s+possible\.?$/i);
  if (trailingMaxFanout) {
    return makeDispatchPlan({
      agents: agents.filter(isActiveAgent),
      prompt: trailingMaxFanout[1],
      strategy: 'parallel',
      targetDescription: 'as many active agents as possible',
    });
  }

  const leadingMaxFanout = raw.match(/^(?:please\s+)?(?:use|deploy|spawn|run|assign|have|put)\s+(?:as\s+many|all|multiple|parallel)\s+agents?(?:\s+as\s+possible)?(?:\s+(?:to|for|on|with|:))?\s+([\s\S]+)$/i);
  if (leadingMaxFanout) {
    return makeDispatchPlan({
      agents: agents.filter(isActiveAgent),
      prompt: leadingMaxFanout[1],
      strategy: 'parallel',
      targetDescription: 'as many active agents as possible',
    });
  }

  const roundtable = raw.match(/^(?:run\s+)?(?:a\s+)?(?:multi-agent\s+)?roundtable(?:\s+with\s+agents?)?(?:\s+about|\s+on|\s+for|:)\s+([\s\S]+)$/i);
  if (roundtable) {
    return makeDispatchPlan({
      agents: agents.filter(isActiveAgent),
      prompt: roundtable[1],
      strategy: 'roundtable',
      targetDescription: 'agent roundtable',
    });
  }

  const chain = raw.match(/^(?:run\s+)?(?:a\s+)?(?:multi-agent\s+)?(?:sequential|sequence|chain|handoff)\s+(?:workflow\s+)?(?:with\s+agents?\s+)?(?:about|on|for|to|:)\s+([\s\S]+)$/i);
  if (chain) {
    return makeDispatchPlan({
      agents: agents.filter(isActiveAgent),
      prompt: chain[1],
      strategy: 'sequential',
      targetDescription: 'agent chain',
    });
  }

  const debate = raw.match(/^(?:run\s+)?(?:a\s+)?(?:multi-agent\s+)?(?:debate|peer\s+review|red\s+team)\s+(?:with\s+agents?\s+)?(?:about|on|for|:)\s+([\s\S]+)$/i);
  if (debate) {
    return makeDispatchPlan({
      agents: agents.filter(isActiveAgent),
      prompt: debate[1],
      strategy: 'debate',
      targetDescription: 'agent debate',
    });
  }

  const all = raw.match(/^(?:ask|tell|have|send)\s+(?:the\s+)?(all|all active|active|available|every)\s+(?:available\s+)?agents?\s+(?:to|:)\s+([\s\S]+)$/i);
  if (all) {
    const scope = all[1].toLowerCase();
    const scoped = scope.includes('active') || scope === 'available' ? agents.filter(isActiveAgent) : agents;
    return makeDispatchPlan({
      agents: scoped,
      prompt: all[2],
      strategy: 'parallel',
      targetDescription: scope.includes('active') ? 'active agents' : 'all agents',
    });
  }

  const provider = raw.match(/^(?:ask|tell|have|send)\s+(?:all\s+)?(.+?)\s+agents?\s+(?:to|:)\s+([\s\S]+)$/i);
  if (provider) {
    const providerKeys = providerKeysFromText(provider[1]);
    if (providerKeys.length > 0) {
      const scoped = agents.filter(agent => providerMatches(agent, providerKeys));
      return makeDispatchPlan({
        agents: scoped,
        prompt: provider[2],
        strategy: 'parallel',
        targetDescription: `${provider[1].trim()} agents`,
      });
    }
  }

  return null;
}

export function parseMultiAgentOrchestrationRequest(
  input: string,
  availableAgents: MultiAgentAvailableAgent[],
): MultiAgentOrchestrationPlan | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const agents = uniqueAgents(availableAgents);
  const aliasIndex = buildMultiAgentAliasIndex(agents);
  const ambiguousAlias = findExplicitAmbiguousAlias(raw, aliasIndex.ambiguous);
  if (ambiguousAlias) {
    return makeDispatchPlan({
      agents: [],
      prompt: '',
      strategy: 'parallel',
      targetDescription: `ambiguous @${ambiguousAlias}`,
      reason: `More than one connected agent matches @${ambiguousAlias}. Choose targets by their unique session or agent id.`,
    });
  }
  const aliases = aliasIndex.agentIds;

  const slash = parseSlashMultiAgent(raw, agents, aliases);
  if (slash) return slash;

  const mentionTargets = resolveTargetsByMentions(raw, agents, makeAliasResolver(aliases));
  if (mentionTargets) {
    const scoped = resolveUniqueAgentsByIds(mentionTargets.targetIds, agents);
    if (!scoped) {
      return makeDispatchPlan({
        agents: [],
        prompt: '',
        strategy: 'parallel',
        targetDescription: 'ambiguous agent targets',
        reason: 'Two or more agents share that name. Choose targets by their unique session or agent id.',
      });
    }
    return makeDispatchPlan({
      agents: scoped,
      prompt: mentionTargets.prompt,
      strategy: 'parallel',
      targetDescription: scoped.map(agent => `@${agent.name}`).join(' '),
    });
  }

  return parseNaturalMultiAgent(raw, agents);
}

export function formatMultiAgentHelp(agents: MultiAgentAvailableAgent[], reason?: string): string {
  const available = uniqueAgents(agents).filter(isUsableAgent);
  const roster = available.length > 0
    ? available.slice(0, 12).map(agent => `- @${agent.name} · id: \`${agent.id}\` · ${agent.provider || 'agent'} · ${agent.status || 'ready'} · ${describeAgentCapabilities(agent)}`).join('\n')
    : '- No available agents detected. Start terminal sessions or connect agents in Office.';

  return [
    reason ? `Multi-agent setup: ${reason}` : 'Multi-agent chat commands',
    '',
    'Use one of these:',
    '- `/multi all <task>`',
    '- `/multi active <task>`',
    '- `/multi provider codex <task>`',
    '- `/multi @AgentA @AgentB <task>`',
    '- `/roundtable <question>`',
    '- `/sequence all <task>`',
    '- `/debate all <question>`',
    '- Natural language: `ask all agents to <task>`',
    '- Natural language: `use as many agents as possible to <task>`',
    '',
    `Available agents (${available.length}):`,
    roster,
  ].join('\n');
}

export function buildMultiAgentDispatchPrompt(
  plan: MultiAgentOrchestrationPlan,
  agent: MultiAgentAvailableAgent,
  index: number,
  priorContext?: string,
): string {
  const header = (() => {
    if (plan.strategy === 'roundtable') {
      return [
        'You are participating in a multi-agent roundtable from The Underground Circle chat.',
        `You are ${agent.name}${agent.provider ? ` (${agent.provider})` : ''}.`,
        'Give an independent, concise perspective. Do not wait for other agents. Include concrete next steps if useful.',
      ];
    }
    if (plan.strategy === 'sequential') {
      return [
        'You are executing a sequential multi-agent chain from The Underground Circle chat.',
        `You are ${agent.name}${agent.provider ? ` (${agent.provider})` : ''}, step ${index + 1}/${plan.targetNames.length}.`,
        'Use the prior handoff context if provided, improve the work, and produce a clear handoff for the next agent.',
      ];
    }
    if (plan.strategy === 'debate') {
      return [
        'You are participating in a multi-agent debate / peer review from The Underground Circle chat.',
        `You are ${agent.name}${agent.provider ? ` (${agent.provider})` : ''}, reviewer ${index + 1}/${plan.targetNames.length}.`,
        'Take a clear position, challenge weak assumptions, cite concrete risks, and propose the safest implementation path.',
      ];
    }
    return [
      'You are executing one lane of a multi-agent dispatch from The Underground Circle chat.',
      `You are ${agent.name}${agent.provider ? ` (${agent.provider})` : ''}, lane ${index + 1}/${plan.targetNames.length}.`,
      'Work independently. Return a concise result, blockers, and anything another agent should pick up.',
    ];
  })();
  return [
    ...header,
    '',
    'Output contract:',
    '- Result: what you completed or concluded.',
    '- Evidence: files, commands, observations, or reasoning that supports it.',
    '- Blockers/Risks: anything unsafe, missing, or uncertain.',
    '- Handoff: the next concrete action another agent or user should take.',
    priorContext?.trim() ? ['', 'Prior handoff context:', priorContext.trim()].join('\n') : '',
    '',
    'Shared task:',
    plan.prompt,
  ].filter(Boolean).join('\n');
}

export function describeAgentCapabilities(agent: MultiAgentAvailableAgent): string {
  const provider = normalizeAlias(agent.provider || '');
  if (provider === 'codex') return 'code + terminal';
  if (provider === 'claude-code') return 'code + terminal';
  if (provider === 'gemini' || provider === 'gemini-cli') return 'research + terminal';
  if (provider === 'cursor') return 'editor awareness';
  if (provider === 'openswan' || agent.id === 'default::blackswan') return 'orchestration + app context';
  return agent.model ? `model: ${agent.model}` : 'general agent';
}

export function formatMultiAgentStrategyLabel(strategy: MultiAgentStrategy): string {
  return strategyLabel(strategy);
}

export function formatMultiAgentRunSummary(
  plan: MultiAgentOrchestrationPlan,
  results: MultiAgentRunResult[],
): string {
  const succeeded = results.filter(result => result.ok);
  const failed = results.filter(result => !result.ok);
  const lines = [
    `Multi-agent ${strategyLabel(plan.strategy)} complete: ${succeeded.length} succeeded, ${failed.length} failed.`,
    `Task: ${plan.prompt}`,
  ];
  if (succeeded.length > 0) {
    lines.push(`Succeeded: ${succeeded.map(result => result.agentName).join(', ')}`);
  }
  if (failed.length > 0) {
    lines.push(`Needs attention: ${failed.map(result => result.agentName).join(', ')}`);
  }
  if (plan.strategy === 'sequential') {
    const last = [...succeeded].reverse().find(result => result.replyPreview);
    if (last?.replyPreview) {
      lines.push('');
      lines.push('Latest handoff preview:');
      lines.push(last.replyPreview.slice(0, 800));
    }
  }
  return lines.join('\n');
}
