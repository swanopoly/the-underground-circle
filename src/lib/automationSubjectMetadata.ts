export type AutomationAgentSubjectSummary = {
  label: string;
  subjectKey: string | null;
  dbId: string | null;
  sessionKey: string | null;
  provider: string | null;
  spiritId: string | null;
  aliases: string[];
};

const SUBJECT_METADATA_KEYS = [
  'agentSubjectMetadata',
  'agentSubject',
  'targetAgentSubject',
  'agent_subject_metadata',
  'target_agent_subject',
] as const;

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanSubjectText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeSubjectText(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function collectSubjectText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectSubjectText);
  const text = cleanSubjectText(value);
  return text ? [text] : [];
}

function uniqueSubjectText(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    for (const text of collectSubjectText(value)) {
      const key = normalizeSubjectText(text);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

function firstSubjectText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = cleanSubjectText(value);
    if (text) return text;
  }
  return null;
}

function maybeSubjectRecord(value: unknown): Record<string, unknown> | null {
  if (isObjectRecord(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hasSubjectFields(record: Record<string, unknown>): boolean {
  return [
    record.agentSubjectKey,
    record.agent_subject_key,
    record.targetAgentSubjectKey,
    record.target_agent_subject_key,
    record.subjectKey,
    record.subject_key,
    record.agentDisplayName,
    record.agent_display_name,
    record.agentDbId,
    record.agent_db_id,
  ].some(value => !!cleanSubjectText(value));
}

function readSubjectMetadata(source: unknown): Record<string, unknown> | null {
  if (!isObjectRecord(source)) return maybeSubjectRecord(source);

  for (const key of SUBJECT_METADATA_KEYS) {
    const value = source[key];
    const record = maybeSubjectRecord(value);
    if (record) return record;
    const subjectKey = cleanSubjectText(value);
    if (subjectKey) return { agentSubjectKey: subjectKey };
  }

  return hasSubjectFields(source) ? source : null;
}

export function getAgentSubjectSummary(source: unknown): AutomationAgentSubjectSummary | null {
  const subject = readSubjectMetadata(source);
  if (!subject) return null;

  const subjectKey = firstSubjectText(
    subject.agentSubjectKey,
    subject.agent_subject_key,
    subject.targetAgentSubjectKey,
    subject.target_agent_subject_key,
    subject.subjectKey,
    subject.subject_key,
  );
  const displayName = firstSubjectText(
    subject.agentDisplayName,
    subject.agent_display_name,
    subject.targetAgentName,
    subject.target_agent_name,
    subject.agentName,
    subject.agent_name,
    subject.displayName,
    subject.display_name,
  );
  const dbId = firstSubjectText(
    subject.agentDbId,
    subject.agent_db_id,
    subject.targetAgentDbId,
    subject.target_agent_db_id,
    subject.dbAgentId,
    subject.db_agent_id,
  );
  const sessionKey = firstSubjectText(
    subject.agentSessionKey,
    subject.agent_session_key,
    subject.sessionKey,
    subject.session_key,
  );
  const provider = firstSubjectText(
    subject.agentProvider,
    subject.agent_provider,
    subject.providerType,
    subject.provider_type,
  );
  const spiritId = firstSubjectText(
    subject.agentSpiritId,
    subject.agent_spirit_id,
    subject.spiritId,
    subject.spirit_id,
  );

  const ignoredAliases = new Set(
    [subjectKey, displayName, dbId, sessionKey].map(normalizeSubjectText).filter(Boolean),
  );
  const aliases = uniqueSubjectText([
    subject.legacyAgentIds,
    subject.legacy_agent_ids,
    subject.agentLegacyIds,
    subject.agent_legacy_ids,
    subject.targetAgentLegacyIds,
    subject.target_agent_legacy_ids,
    subject.runAgentAliases,
    subject.run_agent_aliases,
    subject.memoryAgentAliases,
    subject.memory_agent_aliases,
  ]).filter(alias => !ignoredAliases.has(normalizeSubjectText(alias)));

  const label = displayName || subjectKey || dbId || sessionKey || aliases[0] || null;
  if (!label) return null;

  return { label, subjectKey, dbId, sessionKey, provider, spiritId, aliases };
}
