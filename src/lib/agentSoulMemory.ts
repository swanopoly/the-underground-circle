import { AGENT_SPIRITS } from './agentSpirits';
import { supabase } from './supabase';

export interface AgentSoulInfo {
  dbAgentId: string | null;
  spiritId: string | null;
  soulKey: string | null;
  soulLabel: string | null;
}

export interface SoulMatch {
  spiritId: string;
  soulKey: string;
  score: number;
}

export interface SoulMemoryRouting {
  primarySoulKey: string | null;
  relevantSoulKeys: string[];
  ownershipMode: 'exclusive' | 'shared_multi' | 'agent_core';
  confidence: number;
  rationale: string;
}

function buildSoulKey(spiritId?: string | null): string | null {
  if (!spiritId) return null;
  return `soul:${spiritId}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value);
}

export async function getAgentSoulInfo(opts: {
  circleId?: string;
  agentId?: string;
  agentName?: string;
  userId?: string | null;
}): Promise<AgentSoulInfo> {
  if (!opts.circleId) {
    return { dbAgentId: null, spiritId: null, soulKey: null, soulLabel: null };
  }

  let ownerId = opts.userId || null;
  if (!ownerId) {
    const { data: auth } = await supabase.auth.getUser();
    ownerId = auth.user?.id || null;
  }
  if (!ownerId) {
    return { dbAgentId: null, spiritId: null, soulKey: null, soulLabel: null };
  }

  let data: any = null;
  // Only filter by DB id when the agentId is an actual UUID. Live session
  // ids like `codex::codex-70025` aren't in the circle_office_agents.id
  // column and would cause a 400 (uuid type error), breaking AgentMemoryPanel's
  // Promise.all and preventing memories from loading at all.
  if (isUuid(opts.agentId)) {
    const byId = await supabase
      .from('circle_office_agents')
      .select('id, spirit')
      .eq('circle_id', opts.circleId)
      .eq('owner_id', ownerId)
      .eq('id', opts.agentId)
      .maybeSingle();
    data = byId.data || null;
  }
  if (!data && opts.agentName) {
    const byName = await supabase
      .from('circle_office_agents')
      .select('id, spirit')
      .eq('circle_id', opts.circleId)
      .eq('owner_id', ownerId)
      .ilike('name', opts.agentName)
      .maybeSingle();
    data = byName.data || null;
  }
  if (!data) {
    return { dbAgentId: null, spiritId: null, soulKey: null, soulLabel: null };
  }

  const spiritId = data?.spirit || null;
  return {
    dbAgentId: data?.id || null,
    spiritId,
    soulKey: buildSoulKey(spiritId),
    soulLabel: spiritId || null,
  };
}

export function getMemorySoulKey(mem: { metadata?: Record<string, unknown> | null }): string | null {
  const raw = mem.metadata?.soul_key;
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

const SPIRIT_ALIASES: Record<string, string[]> = {
  'sr-engineer': ['software', 'typescript', 'javascript', 'debug', 'refactor', 'implementation', 'codebase', 'api', 'backend', 'frontend'],
  architect: ['architecture', 'scalability', 'system design', 'service boundary', 'tradeoff', 'distributed'],
  devops: ['deploy', 'infrastructure', 'ops', 'incident', 'monitoring', 'ci', 'cd', 'cron', 'runtime'],
  security: ['security', 'vulnerability', 'auth', 'permission', 'credential', 'risk'],
  'github-devops': ['github', 'actions', 'workflow', 'pull request', 'ci/cd', 'dependabot'],
  'code-reviewer': ['review', 'regression', 'bug', 'line reference', 'test coverage', 'pull request'],
  'ml-engineer': ['model', 'ml', 'ai', 'dataset', 'inference', 'training', 'hugging face'],
  'ai-researcher': ['ai research', 'research scientist', 'ablation', 'benchmark', 'eval harness', 'llm', 'multimodal', 'paper reproduction', 'agentic ai'],
  'security-analyst': ['threat', 'scan', 'dependency', 'owasp', 'secret'],
  designer: ['design', 'ui', 'ux', 'layout', 'visual', 'figma', 'component'],
  writer: ['writing', 'docs', 'copy', 'article', 'explain', 'narrative'],
  marketer: ['marketing', 'growth', 'campaign', 'funnel', 'conversion'],
  pm: ['product', 'roadmap', 'requirement', 'priority', 'user story'],
  'tech-lead': ['team', 'execution', 'standards', 'delivery', 'coordination', 'leadership'],
  coach: ['goal', 'accountability', 'habit', 'improvement'],
  philosopher: ['meaning', 'ethics', 'assumption', 'culture'],
  strategist: ['strategy', 'scenario', 'premortem', 'positioning'],
  researcher: ['research', 'source', 'evidence', 'citation', 'investigation'],
  mentor: ['teach', 'learning', 'guide', 'explain', 'unblock'],
  'data-engineer': ['pipeline', 'warehouse', 'etl', 'schema', 'dbt', 'analytics'],
  'qa-engineer': ['test', 'qa', 'regression', 'edge case', 'verification', 'automation'],
  devrel: ['developer community', 'docs', 'tutorial', 'community', 'sdk'],
  '3d-designer': ['3d', 'spatial', 'scene', 'render', 'three.js'],
  trader: ['trade', 'market', 'risk', 'position', 'execution'],
  analyst: ['thesis', 'analysis', 'evidence', 'market research'],
};

function extractTerms(text: string): string[] {
  return Array.from(new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9.+#/-]+/i)
      .map(token => token.trim())
      .filter(token => token.length > 2)
  ));
}

export function inferRelevantSoulMatches(text: string, limit = 4): SoulMatch[] {
  const haystack = text.toLowerCase();
  const terms = extractTerms(text);

  const scored = AGENT_SPIRITS.map(spirit => {
    let score = 0;
    const signatureTerms = [
      spirit.id,
      spirit.name,
      spirit.tagline,
      spirit.skillBundle,
      spirit.category,
      ...(SPIRIT_ALIASES[spirit.id] || []),
    ]
      .join(' ')
      .toLowerCase();

    for (const term of terms) {
      if (signatureTerms.includes(term)) score += term.length > 6 ? 2 : 1;
      if (haystack.includes(term) && (SPIRIT_ALIASES[spirit.id] || []).some(alias => alias.includes(term))) {
        score += 1.5;
      }
    }

    if (haystack.includes(spirit.name.toLowerCase())) score += 4;
    if (haystack.includes(spirit.skillBundle.toLowerCase())) score += 3;
    if (haystack.includes(spirit.category)) score += 1;

    return { spirit, score };
  })
    .filter(item => item.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored
    .map(item => ({
      spiritId: item.spirit.id,
      soulKey: buildSoulKey(item.spirit.id)!,
      score: item.score,
    }))
    .filter(item => !!item.soulKey);
}

export function inferRelevantSoulKeys(text: string, limit = 3): string[] {
  return inferRelevantSoulMatches(text, limit).map(item => item.soulKey);
}

export function decideSoulMemoryRouting(opts: {
  text: string;
  currentSoulKey?: string | null;
}): SoulMemoryRouting {
  const textLower = opts.text.toLowerCase();
  const matches = inferRelevantSoulMatches(opts.text, 4);
  const currentSoulKey = opts.currentSoulKey || null;
  const currentMatch = currentSoulKey ? matches.find(match => match.soulKey === currentSoulKey) : null;
  const top = matches[0];
  const second = matches[1];

  const ownershipSignals = /\b(owner|ownership|own|responsible|primary|lead|specialist|specialty|expert)\b/.test(textLower);
  const collaborationSignals = /\b(shared|collaborat|handoff|cross-functional|cross functional|interdisciplinary|multi-domain|multi domain)\b/.test(textLower);
  const broadSignals = /\b(agent core|core memory|general guidance|general pattern|global guidance|all agents|cross-cutting|cross cutting)\b/.test(textLower);

  if (matches.length === 0) {
    return {
      primarySoulKey: currentSoulKey,
      relevantSoulKeys: currentSoulKey ? [currentSoulKey] : [],
      ownershipMode: currentSoulKey ? 'exclusive' : 'agent_core',
      confidence: currentSoulKey ? 0.45 : 0.25,
      rationale: currentSoulKey
        ? 'No strong Soul match found, so keep the memory with the current Soul.'
        : 'No strong Soul match found, so keep the memory in core agent memory.',
    };
  }

  const strongMatches = matches.filter(match => match.score >= Math.max(3.5, (top?.score || 0) - 1.25)).slice(0, 3);
  const hasStrongTop = (top?.score || 0) >= 4.5;
  const closeSecond = !!second && second.score >= 3.5 && ((top?.score || 0) - second.score <= 1.25);

  if (broadSignals && (!top || top.score < 5.5) && strongMatches.length <= 1) {
    return {
      primarySoulKey: null,
      relevantSoulKeys: [],
      ownershipMode: 'agent_core',
      confidence: 0.72,
      rationale: 'The memory reads as broad agent guidance rather than Soul-specific specialization.',
    };
  }

  if (currentMatch && ownershipSignals && (!top || top.soulKey === currentSoulKey || top.score - currentMatch.score <= 1)) {
    return {
      primarySoulKey: currentSoulKey,
      relevantSoulKeys: currentSoulKey ? [currentSoulKey] : [],
      ownershipMode: 'exclusive',
      confidence: 0.82,
      rationale: 'Ownership cues favor the current Soul as the primary owner of this memory.',
    };
  }

  if (hasStrongTop && !closeSecond) {
    return {
      primarySoulKey: top.soulKey,
      relevantSoulKeys: [top.soulKey],
      ownershipMode: 'exclusive',
      confidence: Math.min(0.95, 0.55 + top.score / 10),
      rationale: 'One Soul clearly dominates the content, so the memory should stay exclusive.',
    };
  }

  const sharedKeys = strongMatches
    .filter(match => match.score >= Math.max(3.5, (top?.score || 0) - 1.5))
    .slice(0, 3)
    .map(match => match.soulKey);

  const primarySoulKey = currentSoulKey && sharedKeys.includes(currentSoulKey)
    ? currentSoulKey
    : sharedKeys[0] || currentSoulKey || null;

  if (sharedKeys.length > 1 && (collaborationSignals || closeSecond || !hasStrongTop)) {
    return {
      primarySoulKey,
      relevantSoulKeys: Array.from(new Set([primarySoulKey, ...sharedKeys].filter(Boolean))) as string[],
      ownershipMode: 'shared_multi',
      confidence: Math.min(0.92, 0.5 + (top?.score || 0) / 12),
      rationale: 'Multiple Souls scored closely enough that this learning should be shared across them.',
    };
  }

  return {
    primarySoulKey: primarySoulKey || currentSoulKey,
    relevantSoulKeys: primarySoulKey ? [primarySoulKey] : currentSoulKey ? [currentSoulKey] : [],
    ownershipMode: primarySoulKey || currentSoulKey ? 'exclusive' : 'agent_core',
    confidence: primarySoulKey || currentSoulKey ? 0.68 : 0.35,
    rationale: primarySoulKey || currentSoulKey
      ? 'The memory is still specific enough to keep a single Soul owner.'
      : 'The memory is not specific enough to assign to a Soul reliably.',
  };
}
