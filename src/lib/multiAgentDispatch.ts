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

const MENTION_HEAD = /^@([\w][\w.-]*)/;

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
