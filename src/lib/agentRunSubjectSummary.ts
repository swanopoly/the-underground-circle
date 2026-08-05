export type AgentRunSubjectSummary = {
  subjectKey: string | null;
  displayName: string | null;
  dbId: string | null;
  aliases: string[];
};

type AgentRunLike = {
  agent_id?: unknown;
  delegated_to?: unknown;
  surface?: unknown;
  title?: unknown;
  metadata?: unknown;
};

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeMany(value: unknown): string[] {
  if (typeof value === 'string') return [normalize(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(normalizeMany);
  return [];
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanDisplay(value: unknown): string | null {
  const text = String(value || '').trim();
  return text ? text : null;
}

function uniqueDisplay(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      for (const child of uniqueDisplay(value)) {
        const key = child.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(child);
      }
      continue;
    }
    const text = cleanDisplay(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function getRunSubjectSummary(
  run: AgentRunLike | null | undefined,
  fallbackAgentName = '',
): AgentRunSubjectSummary {
  const meta = metadataObject(run?.metadata);
  const agentSubject = metadataObject(meta.agentSubject);
  const targetSubject = metadataObject(meta.targetAgentSubject);
  const subjectKey = cleanDisplay(meta.agentSubjectKey)
    || cleanDisplay(meta.targetAgentSubjectKey)
    || cleanDisplay(agentSubject.agentSubjectKey)
    || cleanDisplay(targetSubject.agentSubjectKey)
    || cleanDisplay(run?.agent_id)
    || null;
  const displayName = cleanDisplay(meta.agentDisplayName)
    || cleanDisplay(meta.agentName)
    || cleanDisplay(meta.targetAgent)
    || cleanDisplay(meta.targetAgentName)
    || cleanDisplay(agentSubject.agentDisplayName)
    || cleanDisplay(targetSubject.agentDisplayName)
    || cleanDisplay(fallbackAgentName);
  const dbId = cleanDisplay(meta.agentDbId)
    || cleanDisplay(meta.targetAgentDbId)
    || cleanDisplay(agentSubject.agentDbId)
    || cleanDisplay(targetSubject.agentDbId)
    || null;
  const ignoredAliases = new Set([subjectKey, dbId].map(normalize).filter(Boolean));
  const aliases = uniqueDisplay([
    meta.legacyAgentIds,
    meta.agentLegacyIds,
    meta.targetAgentLegacyIds,
    meta.runAgentAliases,
    meta.memoryAgentAliases,
    agentSubject.legacyAgentIds,
    targetSubject.legacyAgentIds,
  ]).filter((alias) => !ignoredAliases.has(normalize(alias)));
  return { subjectKey, displayName, dbId, aliases };
}

export function runMatchesAgent(
  run: AgentRunLike | null | undefined,
  agentAliases: string[],
  agentName = '',
): boolean {
  const aliases = new Set(agentAliases.map(normalize).filter(Boolean));
  const name = normalize(agentName);
  if (name) aliases.add(name);
  if (aliases.size === 0) return true;

  const meta = metadataObject(run?.metadata);
  const agentSubject = metadataObject(meta.agentSubject);
  const targetSubject = metadataObject(meta.targetAgentSubject);
  const metadataValues = [
    run?.agent_id,
    run?.delegated_to,
    meta.agentSubjectKey,
    meta.targetAgentSubjectKey,
    meta.agentId,
    meta.agent_id,
    meta.agentName,
    meta.agent_name,
    meta.targetAgent,
    meta.targetAgentName,
    meta.sessionKey,
    meta.session_key,
    meta.delegatedTo,
    meta.assignedAgentId,
    meta.assigned_agent_id,
    agentSubject.agentSubjectKey,
    agentSubject.agentDbId,
    targetSubject.agentSubjectKey,
    targetSubject.agentDbId,
    ...normalizeMany(meta.legacyAgentIds),
    ...normalizeMany(meta.agentLegacyIds),
    ...normalizeMany(meta.targetAgentLegacyIds),
    ...normalizeMany(meta.runAgentAliases),
    ...normalizeMany(meta.memoryAgentAliases),
    ...normalizeMany(agentSubject.legacyAgentIds),
    ...normalizeMany(targetSubject.legacyAgentIds),
  ].map(normalize).filter(Boolean);

  if (metadataValues.some((value) => aliases.has(value))) return true;
  const title = normalize(run?.title);
  if (name && title.includes(name)) return true;
  const surface = normalize(run?.surface);
  if (aliases.has('openswan:main_chat') && (surface === 'main_chat' || surface === 'floating_chat')) return true;
  return false;
}
