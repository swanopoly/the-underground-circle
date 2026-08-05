import type { PersistedChatRecoveryReliabilitySummary } from './persistedChatMetadata';

const MAX_RECOVERY_TOUCHED_ITEMS = 24;

export type ChatSessionArchiveRecoveryMessageSnapshot = {
  messageId: string;
  content?: string | null;
  timestamp?: number;
  touched?: string[];
  recoveryReliabilitySummaries?: string[];
};

export type ChatSessionArchiveRecoveryRecommendation = {
  id: string;
  kind: 'recovery_pattern';
  title: string;
  summary: string;
  content: string;
  confidence: 'medium' | 'high';
  sources: string[];
};

function uniqueTrimmed(values: Array<string | null | undefined>, limit = MAX_RECOVERY_TOUCHED_ITEMS): string[] {
  return Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean))).slice(0, limit);
}

function formatRecoveryArchiveLabel(value?: string | null, fallback = 'Task'): string {
  const clean = String(value || '').trim();
  if (!clean) return fallback;
  return clean
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function collectChatSessionArchiveRecoveryEvidenceTools(
  summary?: PersistedChatRecoveryReliabilitySummary | null,
  limit = 4,
): string[] {
  if (!summary) return [];
  return uniqueTrimmed([
    ...(summary.nextEvidenceTools || []),
    ...(summary.requiredEvidenceTools || []),
  ], limit);
}

export function summarizeChatSessionArchiveRecoveryReliability(
  summary?: PersistedChatRecoveryReliabilitySummary | null,
): string[] {
  if (!summary) return [];
  const surface = formatRecoveryArchiveLabel(summary.surfaceKind || summary.routeDecisionSurface, 'Computer task');
  const target = summary.targetName ? ` for ${summary.targetName}` : '';
  const status = formatRecoveryArchiveLabel(
    summary.readinessStatus,
    summary.retryAllowed === false ? 'Blocked' : 'Needs evidence',
  );
  const failureArea = formatRecoveryArchiveLabel(summary.failureArea, 'Unknown failure');
  const details = [
    `${surface} recovery${target}: ${status}`,
    `area ${failureArea}`,
    summary.retryAllowed === false ? 'retry blocked' : summary.retryAllowed === true ? 'retry allowed' : null,
    summary.userActionRequired ? 'user step needed' : null,
    summary.connectedAgentAllowed ? 'agent repair allowed' : null,
  ];
  const evidenceTools = collectChatSessionArchiveRecoveryEvidenceTools(summary, 3);
  if (evidenceTools.length) {
    details.push(`evidence ${evidenceTools.join(', ')}`);
  }
  const verificationCommands = uniqueTrimmed(summary.verificationCommands || [], 2);
  if (verificationCommands.length) {
    details.push(`verify ${verificationCommands.join(', ')}`);
  }
  const compactDetails = uniqueTrimmed(details, 8);
  return compactDetails.length ? [compactDetails.join('; ')] : [];
}

export function collectChatSessionArchiveRecoveryReliabilityTouched(
  summary?: PersistedChatRecoveryReliabilitySummary | null,
): string[] {
  if (!summary) return [];
  const selectedOptionId = summary.selectedRecoveryOptionId || summary.recommendedOptionId || null;
  return uniqueTrimmed([
    'surface:failure_recovery',
    summary.surfaceKind ? `recovery_surface:${summary.surfaceKind}` : null,
    summary.failureArea ? `recovery_failure:${summary.failureArea}` : null,
    summary.readinessStatus ? `recovery_readiness:${summary.readinessStatus}` : null,
    selectedOptionId ? `recovery_option:${selectedOptionId}` : null,
    ...collectChatSessionArchiveRecoveryEvidenceTools(summary, 6).map((tool) => `recovery_tool:${tool}`),
  ]);
}

function touchedValue(touched: string[] | undefined, prefix: string): string | null {
  const match = (touched || []).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() || null : null;
}

function compactRecoveryKey(value: string | null | undefined, fallback: string): string {
  return String(value || fallback).trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80);
}

export function deriveChatSessionArchiveRecoveryRecommendations(
  opts: {
    threadId?: string | null;
    messages: ChatSessionArchiveRecoveryMessageSnapshot[];
    handledRecommendationIds?: Record<string, unknown>;
  },
  limit = 3,
): ChatSessionArchiveRecoveryRecommendation[] {
  const counts = new Map<string, {
    count: number;
    surface: string;
    failure: string;
    readiness: string;
    summaries: string[];
    tools: string[];
    samples: string[];
    latestTimestamp: number;
  }>();

  for (const message of opts.messages || []) {
    const summaries = uniqueTrimmed(message.recoveryReliabilitySummaries || [], 3);
    const touched = message.touched || [];
    if (summaries.length === 0 && !touched.some((value) => value.startsWith('recovery_'))) continue;
    const surface = touchedValue(touched, 'recovery_surface:') || 'unknown_surface';
    const failure = touchedValue(touched, 'recovery_failure:') || 'unknown_failure';
    const readiness = touchedValue(touched, 'recovery_readiness:') || 'unknown_readiness';
    const key = [
      compactRecoveryKey(surface, 'surface'),
      compactRecoveryKey(failure, 'failure'),
      compactRecoveryKey(readiness, 'readiness'),
    ].join(':');
    const entry = counts.get(key) || {
      count: 0,
      surface,
      failure,
      readiness,
      summaries: [],
      tools: [],
      samples: [],
      latestTimestamp: 0,
    };
    entry.count += 1;
    entry.latestTimestamp = Math.max(entry.latestTimestamp, message.timestamp || 0);
    entry.summaries = uniqueTrimmed([...entry.summaries, ...summaries], 4);
    entry.tools = uniqueTrimmed([
      ...entry.tools,
      ...touched
        .filter((value) => value.startsWith('recovery_tool:'))
        .map((value) => value.slice('recovery_tool:'.length)),
    ], 6);
    if (entry.samples.length < 3) {
      entry.samples.push((summaries[0] || message.content || 'Recovery reliability signal').slice(0, 220));
    }
    counts.set(key, entry);
  }

  return Array.from(counts.entries())
    .filter(([id, entry]) => entry.count >= 2 && !opts.handledRecommendationIds?.[`recovery:${id}`])
    .sort((a, b) => b[1].count - a[1].count || b[1].latestTimestamp - a[1].latestTimestamp)
    .slice(0, limit)
    .map(([id, entry]) => ({
      id: `recovery:${id}`,
      kind: 'recovery_pattern' as const,
      title: `Repeat recovery blocker: ${formatRecoveryArchiveLabel(entry.surface, 'Computer task')}`,
      summary: `${entry.count} related recovery signals in this thread`,
      content: [
        `Observed repeated recovery reliability pattern in thread ${opts.threadId || 'main'}.`,
        `Surface: ${entry.surface}`,
        `Failure area: ${entry.failure}`,
        `Readiness: ${entry.readiness}`,
        entry.tools.length ? `Evidence tools: ${entry.tools.join(', ')}` : '',
        entry.summaries.length ? 'Recent recovery status:' : '',
        ...entry.summaries.map((summary) => `- ${summary.slice(0, 220)}`),
        entry.samples.length && entry.summaries.length === 0 ? 'Recent samples:' : '',
        ...(entry.summaries.length === 0 ? entry.samples.map((sample) => `- ${sample}`) : []),
      ].filter(Boolean).join('\n'),
      confidence: entry.count >= 3 ? 'high' : 'medium',
      sources: uniqueTrimmed([...entry.summaries, ...entry.samples], 6),
    }));
}
