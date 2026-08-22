import { getAgentIdentityKey } from './agentIdentityKey';
import type { OfficeAgent } from './officeAgents';

type AgentSubjectLike = Pick<OfficeAgent, 'id' | 'name'> & Partial<OfficeAgent>;

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function isOpenSwanMainAgent(agent: AgentSubjectLike): boolean {
  const id = String(agent.id || '').toLowerCase();
  return id === 'default::blackswan'
    || id === 'blackswan-default'
    || id === 'blackswan'
    || id === 'openswan:main_chat';
}

export type AgentRuntimeSubject = {
  rawAgentId: string;
  agentName: string;
  displayName: string;
  subjectKey: string;
  identityKey: string;
  sessionKey: string | null;
  dbAgentId: string | null;
  providerType: string | null;
  spiritId: string | null;
  memoryAgentId: string;
  memoryAgentAliases: string[];
  runAgentId: string;
  runAgentAliases: string[];
  legacyIds: string[];
  metadata: AgentRuntimeSubjectMetadata;
};

export type AgentRuntimeSubjectMetadata = {
  agentSubjectKey: string;
  agentDisplayName: string;
  agentDbId?: string | null;
  agentProvider?: string | null;
  agentSessionKey?: string | null;
  agentSpiritId?: string | null;
  legacyAgentIds: string[];
};

export type AgentRuntimeSubjectPayloadInput = {
  agentId?: string;
  agentName?: string;
  agentSubjectKey?: string;
  agentDbId?: string | null;
  agentSessionKey?: string | null;
  agentLegacyIds?: string[];
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
  targetAgentSubjects?: AgentRuntimeSubjectMetadata[] | null;
};

export type AgentRuntimeSubjectContextPatch = {
  agentId?: string;
  agentName?: string;
  agentSubjectKey?: string;
  agentDbId?: string | null;
  agentSessionKey?: string | null;
  agentLegacyIds?: string[];
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata;
};

function cleanSubjectString(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text ? text : undefined;
}

function uniqueSubjectStrings(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const text = cleanSubjectString(value);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  values.forEach(visit);
  return out;
}

function pushMetadataValue(out: Record<string, unknown>, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    if (value.length > 0) out[key] = value;
    return;
  }
  if (value && typeof value === 'object') {
    out[key] = value;
    return;
  }
  const text = cleanSubjectString(value);
  if (text) out[key] = text;
}

export function buildAgentRuntimeSubjectPayload(request: AgentRuntimeSubjectPayloadInput): {
  subject: AgentRuntimeSubjectMetadata | null;
  targetSubjects: AgentRuntimeSubjectMetadata[];
  runMetadata: Record<string, unknown>;
  swanContextPatch: AgentRuntimeSubjectContextPatch;
} {
  const supplied = request.agentSubjectMetadata || null;
  const subjectKey = cleanSubjectString(supplied?.agentSubjectKey)
    || cleanSubjectString(request.agentSubjectKey)
    || cleanSubjectString(request.agentId);
  const displayName = cleanSubjectString(supplied?.agentDisplayName)
    || cleanSubjectString(request.agentName)
    || subjectKey;
  if (!subjectKey) {
    return {
      subject: null,
      targetSubjects: [],
      runMetadata: {},
      swanContextPatch: {
        agentId: cleanSubjectString(request.agentId),
        agentName: cleanSubjectString(request.agentName),
      },
    };
  }

  const dbId = cleanSubjectString(supplied?.agentDbId) || cleanSubjectString(request.agentDbId) || null;
  const sessionKey = cleanSubjectString(supplied?.agentSessionKey) || cleanSubjectString(request.agentSessionKey) || null;
  const legacyAgentIds = uniqueSubjectStrings([
    supplied?.legacyAgentIds,
    request.agentLegacyIds,
    request.agentId,
    request.agentSubjectKey,
    request.agentSessionKey,
  ]).filter((id) => id.toLowerCase() !== subjectKey.toLowerCase());
  const subject: AgentRuntimeSubjectMetadata = {
    agentSubjectKey: subjectKey,
    agentDisplayName: displayName || subjectKey,
    agentDbId: dbId,
    agentProvider: cleanSubjectString(supplied?.agentProvider) || null,
    agentSessionKey: sessionKey,
    agentSpiritId: cleanSubjectString(supplied?.agentSpiritId) || null,
    legacyAgentIds,
  };
  const targetSubjects = uniqueSubjectStrings([
    subject.agentSubjectKey,
    ...(request.targetAgentSubjects || []).map((target) => target.agentSubjectKey),
  ])
    .map((key) => key === subject.agentSubjectKey
      ? subject
      : (request.targetAgentSubjects || []).find((target) => target.agentSubjectKey === key))
    .filter((target): target is AgentRuntimeSubjectMetadata => Boolean(target));

  const runMetadata: Record<string, unknown> = {};
  pushMetadataValue(runMetadata, 'agentId', subject.agentSubjectKey);
  pushMetadataValue(runMetadata, 'agentName', subject.agentDisplayName);
  pushMetadataValue(runMetadata, 'agentSubjectKey', subject.agentSubjectKey);
  pushMetadataValue(runMetadata, 'agentDisplayName', subject.agentDisplayName);
  pushMetadataValue(runMetadata, 'agentDbId', subject.agentDbId);
  pushMetadataValue(runMetadata, 'agentSessionKey', subject.agentSessionKey);
  pushMetadataValue(runMetadata, 'agentLegacyIds', subject.legacyAgentIds);
  pushMetadataValue(runMetadata, 'legacyAgentIds', subject.legacyAgentIds);
  pushMetadataValue(runMetadata, 'targetAgent', subject.agentDisplayName);
  pushMetadataValue(runMetadata, 'targetAgentName', subject.agentDisplayName);
  pushMetadataValue(runMetadata, 'targetAgentSubjectKey', subject.agentSubjectKey);
  pushMetadataValue(runMetadata, 'targetAgentDbId', subject.agentDbId);
  pushMetadataValue(runMetadata, 'targetAgentLegacyIds', subject.legacyAgentIds);
  pushMetadataValue(runMetadata, 'agentSubject', subject);
  pushMetadataValue(runMetadata, 'targetAgentSubject', subject);
  pushMetadataValue(runMetadata, 'targetAgentSubjects', targetSubjects);

  return {
    subject,
    targetSubjects,
    runMetadata,
    swanContextPatch: {
      agentId: subject.agentSubjectKey,
      agentName: subject.agentDisplayName,
      agentSubjectKey: subject.agentSubjectKey,
      agentDbId: subject.agentDbId,
      agentSessionKey: subject.agentSessionKey,
      agentLegacyIds: subject.legacyAgentIds,
      agentSubjectMetadata: subject,
    },
  };
}

export function buildAgentRuntimeSubject(
  agent: AgentSubjectLike,
  opts: { dbAgentId?: string | null } = {},
): AgentRuntimeSubject {
  const identityKey = getAgentIdentityKey(agent) || agent.id || agent.name || 'agent';
  const sessionKey = agent.sessionKey?.trim() || null;
  const isOpenSwanMain = isOpenSwanMainAgent(agent);
  const dbAgentId = opts.dbAgentId || null;
  const subjectKey = isOpenSwanMain ? 'blackswan' : (dbAgentId || sessionKey || identityKey);
  const memoryAgentId = subjectKey;
  const runAgentId = subjectKey;
  const baseAliases = unique([
    memoryAgentId,
    identityKey,
    sessionKey,
    agent.id,
    dbAgentId,
    isOpenSwanMain ? 'default::blackswan' : null,
    isOpenSwanMain ? 'blackswan' : null,
    isOpenSwanMain ? 'openswan:main_chat' : null,
  ]);

  const legacyIds = baseAliases.filter((alias) => alias !== subjectKey);
  const metadata: AgentRuntimeSubjectMetadata = {
    agentSubjectKey: subjectKey,
    agentDisplayName: agent.name,
    agentDbId: dbAgentId,
    agentProvider: agent.providerType || null,
    agentSessionKey: sessionKey,
    agentSpiritId: agent.spirit || null,
    legacyAgentIds: legacyIds,
  };

  return {
    rawAgentId: agent.id,
    agentName: agent.name,
    displayName: agent.name,
    subjectKey,
    identityKey,
    sessionKey,
    dbAgentId,
    providerType: agent.providerType || null,
    spiritId: agent.spirit || null,
    memoryAgentId,
    memoryAgentAliases: baseAliases,
    runAgentId,
    runAgentAliases: unique([
      runAgentId,
      dbAgentId,
      ...baseAliases,
    ]),
    legacyIds,
    metadata,
  };
}

export function isUuidLike(value: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}
