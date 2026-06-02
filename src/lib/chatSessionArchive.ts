import { storage } from './storage';
import type { PromptMemoryReference, OpenSwanMemoryRecommendation } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanToolEvent } from './openswanToolRuntime';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type {
  PersistedChatRecoveryOption,
  PersistedChatRecoveryReliabilitySummary,
} from './persistedChatMetadata';
import { buildChatFailureRecoveryExecutionPlan, summarizeChatFailureRecoveryOptionForArchive } from './chatFailureRecovery';
import {
  collectChatSessionArchiveRecoveryReliabilityTouched,
  deriveChatSessionArchiveRecoveryRecommendations,
  summarizeChatSessionArchiveRecoveryReliability,
} from './chatSessionArchiveRecovery';
import { formatChatSessionArchiveRecommendationPromptLines } from './chatSessionArchivePrompt';

const STORAGE_PREFIX = '@chat_session_archive_v1';
const MAX_ARCHIVED_MESSAGES = 240;
const MAX_ARCHIVED_EVENTS = 360;
const MAX_TOUCHED_ITEMS = 240;

export type ChatSessionArchiveEventKind =
  | 'error'
  | 'tool'
  | 'verification'
  | 'browser_plan'
  | 'browser_session'
  | 'memory'
  | 'computer_task';

export type ChatSessionArchiveEvent = {
  id: string;
  kind: ChatSessionArchiveEventKind;
  timestamp: number;
  summary: string;
  detail?: string | null;
  touched?: string[];
  metadata?: Record<string, unknown>;
};

export type ChatSessionArchivedMessage = {
  messageId: string;
  dbId?: string | null;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  userName?: string | null;
  replyTo?: string | null;
  runId?: string | null;
  isPending?: boolean;
  memoriesUsed?: string[];
  memoryRefs?: string[];
  memoryRecommendations?: string[];
  toolSummaries?: string[];
  verificationSummaries?: string[];
  executionSummaries?: string[];
  browserPlanSummaries?: string[];
  browserEventSummaries?: string[];
  browserSessionSummaries?: string[];
  recoveryOptionSummaries?: string[];
  recoveryReliabilitySummaries?: string[];
  touched?: string[];
};

export type ChatSessionArchiveRecord = {
  circleId: string;
  threadId?: string | null;
  createdAt: number;
  updatedAt: number;
  messages: ChatSessionArchivedMessage[];
  events: ChatSessionArchiveEvent[];
  touched: string[];
  recommendationState?: Record<string, ChatSessionArchiveRecommendationState>;
};

export type ChatSessionArchiveSearchMatch = {
  kind: 'message' | 'event' | 'touch';
  id: string;
  title: string;
  excerpt: string;
  timestamp?: number;
};

export type ChatSessionArchiveRecommendation = {
  id: string;
  kind: 'failure_pattern' | 'tool_pattern' | 'browser_pattern' | 'recovery_pattern';
  title: string;
  summary: string;
  content: string;
  confidence: 'medium' | 'high';
  sources: string[];
};

export type ChatSessionArchiveRecommendationState = {
  status: 'saved_shared' | 'saved_private' | 'dismissed';
  updatedAt: number;
  memoryId?: string | null;
};

export type UpsertChatSessionArchiveMessageInput = {
  circleId: string;
  threadId?: string | null;
  messageId: string;
  dbId?: string | null;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  userName?: string | null;
  replyTo?: string | null;
  runId?: string | null;
  isPending?: boolean;
  memoriesUsed?: string[];
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  executionStream?: OpenSwanExecutionContract[];
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: PersistedChatRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
};

function archiveKey(circleId: string, threadId?: string | null): string {
  return `${STORAGE_PREFIX}:${circleId}:${threadId || 'main'}`;
}

function uniqueTrimmed(values: Array<string | null | undefined>, limit = MAX_TOUCHED_ITEMS): string[] {
  return Array.from(new Set(values.map((value) => (value || '').trim()).filter(Boolean))).slice(0, limit);
}

function summarizeToolEvents(toolEvents?: OpenSwanToolEvent[]): string[] {
  return (toolEvents || []).map((event) => `${event.tool}: ${event.summary}`);
}

function summarizeVerificationResults(results?: OpenSwanVerificationResult[]): string[] {
  return (results || []).map((result) => result.summary || `${result.check.label}: ${result.status}`);
}

function summarizeExecutionStream(stream?: OpenSwanExecutionContract[]): string[] {
  return (stream || []).map((entry) => entry.summary);
}

function summarizeBrowserPlans(plans?: BrowserPlanCardData[]): string[] {
  return (plans || []).map((plan) => `${plan.task} via ${plan.backendLabel}`);
}

function summarizeBrowserPlanEvents(events?: BrowserPlanEvent[]): string[] {
  return (events || []).map((event) => event.summary);
}

function summarizeBrowserSessions(sessions?: BrowserSessionRecord[]): string[] {
  return (sessions || []).map((session) => `${session.task} (${session.status})`);
}

function summarizeRecoveryOptions(options?: PersistedChatRecoveryOption[]): string[] {
  return (options || []).map((option) => summarizeChatFailureRecoveryOptionForArchive(option)).filter(Boolean);
}

function collectTouchedFromMessage(input: UpsertChatSessionArchiveMessageInput): string[] {
  return uniqueTrimmed([
    ...(input.memoriesUsed || []).map((value) => `memory:${value}`),
    ...((input.memoryRefs || []).map((ref) => `memory:${ref.title}`)),
    ...((input.memoryRecommendations || []).map((rec) => `memory_rec:${rec.title}`)),
    ...((input.toolEvents || []).map((event) => `tool:${event.tool}`)),
    ...((input.executionStream || []).map((entry) => entry.toolName ? `tool:${entry.toolName}` : entry.checkLabel ? `check:${entry.checkLabel}` : null)),
    ...((input.verificationResults || []).map((result) => `check:${result.check.label}`)),
    ...((input.browserPlans || []).flatMap((plan) => [
      'surface:browser',
      plan.backend ? `browser_backend:${plan.backend}` : null,
      plan.task ? `browser_task:${plan.task}` : null,
    ])),
    ...((input.browserPlanEvents || []).flatMap((event) => [
      'surface:browser',
      event.kind ? `browser_event:${event.kind}` : null,
      event.backend ? `browser_backend:${event.backend}` : null,
    ])),
    ...((input.browserSessions || []).flatMap((session) => [
      'surface:browser',
      session.backend ? `browser_backend:${session.backend}` : null,
      session.currentUrl ? `url:${session.currentUrl}` : null,
      session.backendLiveUrl ? `url:${session.backendLiveUrl}` : null,
      ...session.actions.flatMap((action) => [
        action.target ? `target:${action.target}` : null,
        action.value ? `value:${action.value}` : null,
        action.description ? `action:${action.description}` : null,
      ]),
    ])),
    ...((input.recoveryOptions || []).flatMap((option) => {
      const policy = buildChatFailureRecoveryExecutionPlan(option).policy;
      return [
        'surface:failure_recovery',
        option.id ? `recovery_option:${option.id}` : null,
        option.actor ? `recovery_actor:${option.actor}` : null,
        `recovery_action:${policy.action}`,
        `recovery_safety:${policy.safetyMode}`,
      ];
    })),
    ...collectChatSessionArchiveRecoveryReliabilityTouched(input.recoveryReliability),
  ]);
}

function normalizeArchive(record: ChatSessionArchiveRecord): ChatSessionArchiveRecord {
  return {
    ...record,
    messages: record.messages
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_ARCHIVED_MESSAGES),
    events: record.events
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_ARCHIVED_EVENTS),
    touched: uniqueTrimmed(record.touched),
    recommendationState: record.recommendationState || {},
  };
}

async function saveArchive(record: ChatSessionArchiveRecord): Promise<void> {
  await storage.setItem(archiveKey(record.circleId, record.threadId), JSON.stringify(normalizeArchive(record)));
}

function areArchivedMessagesEquivalent(
  a: ChatSessionArchivedMessage | undefined,
  b: ChatSessionArchivedMessage,
): boolean {
  if (!a) return false;
  return JSON.stringify({
    dbId: a.dbId || null,
    role: a.role,
    content: a.content,
    userName: a.userName || null,
    replyTo: a.replyTo || null,
    runId: a.runId || null,
    isPending: a.isPending === true,
    memoriesUsed: a.memoriesUsed || [],
    memoryRefs: a.memoryRefs || [],
    memoryRecommendations: a.memoryRecommendations || [],
    toolSummaries: a.toolSummaries || [],
    verificationSummaries: a.verificationSummaries || [],
    executionSummaries: a.executionSummaries || [],
    browserPlanSummaries: a.browserPlanSummaries || [],
    browserEventSummaries: a.browserEventSummaries || [],
    browserSessionSummaries: a.browserSessionSummaries || [],
    recoveryOptionSummaries: a.recoveryOptionSummaries || [],
    recoveryReliabilitySummaries: a.recoveryReliabilitySummaries || [],
    touched: a.touched || [],
  }) === JSON.stringify({
    dbId: b.dbId || null,
    role: b.role,
    content: b.content,
    userName: b.userName || null,
    replyTo: b.replyTo || null,
    runId: b.runId || null,
    isPending: b.isPending === true,
    memoriesUsed: b.memoriesUsed || [],
    memoryRefs: b.memoryRefs || [],
    memoryRecommendations: b.memoryRecommendations || [],
    toolSummaries: b.toolSummaries || [],
    verificationSummaries: b.verificationSummaries || [],
    executionSummaries: b.executionSummaries || [],
    browserPlanSummaries: b.browserPlanSummaries || [],
    browserEventSummaries: b.browserEventSummaries || [],
    browserSessionSummaries: b.browserSessionSummaries || [],
    recoveryOptionSummaries: b.recoveryOptionSummaries || [],
    recoveryReliabilitySummaries: b.recoveryReliabilitySummaries || [],
    touched: b.touched || [],
  });
}

export async function loadChatSessionArchive(
  circleId: string,
  threadId?: string | null,
): Promise<ChatSessionArchiveRecord | null> {
  try {
    const raw = await storage.getItem(archiveKey(circleId, threadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSessionArchiveRecord;
    if (!parsed?.circleId) return null;
    return normalizeArchive(parsed);
  } catch (error) {
    console.warn('[chatSessionArchive] Failed to load archive:', error);
    return null;
  }
}

export async function clearChatSessionArchive(circleId: string, threadId?: string | null): Promise<void> {
  await storage.removeItem(archiveKey(circleId, threadId));
}

export async function upsertChatSessionArchiveMessage(
  input: UpsertChatSessionArchiveMessageInput,
): Promise<ChatSessionArchiveRecord> {
  const existing = await loadChatSessionArchive(input.circleId, input.threadId);
  const archive: ChatSessionArchiveRecord = existing || {
    circleId: input.circleId,
    threadId: input.threadId || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    events: [],
    touched: [],
    recommendationState: {},
  };

  const nextMessage: ChatSessionArchivedMessage = {
    messageId: input.messageId,
    dbId: input.dbId || null,
    role: input.role,
    content: input.content,
    timestamp: input.timestamp || Date.now(),
    userName: input.userName || null,
    replyTo: input.replyTo || null,
    runId: input.runId || null,
    isPending: input.isPending === true,
    memoriesUsed: uniqueTrimmed(input.memoriesUsed || [], 40),
    memoryRefs: uniqueTrimmed((input.memoryRefs || []).map((ref) => ref.title), 40),
    memoryRecommendations: uniqueTrimmed((input.memoryRecommendations || []).map((rec) => rec.title), 40),
    toolSummaries: summarizeToolEvents(input.toolEvents).slice(0, 30),
    verificationSummaries: summarizeVerificationResults(input.verificationResults).slice(0, 30),
    executionSummaries: summarizeExecutionStream(input.executionStream).slice(0, 30),
    browserPlanSummaries: summarizeBrowserPlans(input.browserPlans).slice(0, 12),
    browserEventSummaries: summarizeBrowserPlanEvents(input.browserPlanEvents).slice(0, 20),
    browserSessionSummaries: summarizeBrowserSessions(input.browserSessions).slice(0, 10),
    recoveryOptionSummaries: summarizeRecoveryOptions(input.recoveryOptions).slice(0, 8),
    recoveryReliabilitySummaries: summarizeChatSessionArchiveRecoveryReliability(input.recoveryReliability).slice(0, 4),
    touched: collectTouchedFromMessage(input),
  };

  const existingMessage = archive.messages.find((message) => message.messageId === input.messageId);
  if (areArchivedMessagesEquivalent(existingMessage, nextMessage)) {
    return normalizeArchive(archive);
  }

  archive.messages = archive.messages.some((message) => message.messageId === input.messageId)
    ? archive.messages.map((message) => (message.messageId === input.messageId ? nextMessage : message))
    : [...archive.messages, nextMessage];
  archive.touched = uniqueTrimmed([...(archive.touched || []), ...(nextMessage.touched || [])]);
  archive.updatedAt = Date.now();
  await saveArchive(archive);
  return archive;
}

export async function appendChatSessionArchiveEvent(opts: {
  circleId: string;
  threadId?: string | null;
  kind: ChatSessionArchiveEventKind;
  summary: string;
  detail?: string | null;
  touched?: string[];
  metadata?: Record<string, unknown>;
}): Promise<ChatSessionArchiveRecord> {
  const existing = await loadChatSessionArchive(opts.circleId, opts.threadId);
  const archive: ChatSessionArchiveRecord = existing || {
    circleId: opts.circleId,
    threadId: opts.threadId || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    events: [],
    touched: [],
    recommendationState: {},
  };
  const latestEvent = archive.events[archive.events.length - 1];
  if (
    latestEvent &&
    latestEvent.kind === opts.kind &&
    latestEvent.summary === opts.summary &&
    (latestEvent.detail || null) === (opts.detail || null) &&
    Math.abs(Date.now() - latestEvent.timestamp) < 5000
  ) {
    return normalizeArchive(archive);
  }
  archive.events.push({
    id: `archive-event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    kind: opts.kind,
    timestamp: Date.now(),
    summary: opts.summary,
    detail: opts.detail || null,
    touched: uniqueTrimmed(opts.touched || [], 24),
    metadata: opts.metadata,
  });
  archive.touched = uniqueTrimmed([...(archive.touched || []), ...uniqueTrimmed(opts.touched || [], 24)]);
  archive.updatedAt = Date.now();
  await saveArchive(archive);
  return archive;
}

export function searchChatSessionArchive(
  archive: ChatSessionArchiveRecord | null,
  query: string,
  limit = 10,
): ChatSessionArchiveSearchMatch[] {
  const trimmed = query.trim().toLowerCase();
  if (!archive || !trimmed) return [];

  const matches: ChatSessionArchiveSearchMatch[] = [];

  for (const message of archive.messages) {
    const haystack = [
      message.content,
      message.userName,
      ...(message.memoriesUsed || []),
      ...(message.memoryRefs || []),
      ...(message.memoryRecommendations || []),
      ...(message.toolSummaries || []),
      ...(message.verificationSummaries || []),
      ...(message.browserPlanSummaries || []),
      ...(message.browserSessionSummaries || []),
      ...(message.recoveryOptionSummaries || []),
      ...(message.recoveryReliabilitySummaries || []),
    ].filter(Boolean).join('\n').toLowerCase();
    if (haystack.includes(trimmed)) {
      matches.push({
        kind: 'message',
        id: message.messageId,
        title: `${message.role === 'assistant' ? (message.userName || 'SwanBot') : (message.userName || 'User')}`,
        excerpt: message.content.slice(0, 180),
        timestamp: message.timestamp,
      });
    }
  }

  for (const event of archive.events) {
    const haystack = [event.summary, event.detail, ...(event.touched || [])].filter(Boolean).join('\n').toLowerCase();
    if (haystack.includes(trimmed)) {
      matches.push({
        kind: 'event',
        id: event.id,
        title: `[${event.kind}] ${event.summary}`,
        excerpt: (event.detail || (event.touched || []).join(' · ') || event.summary).slice(0, 180),
        timestamp: event.timestamp,
      });
    }
  }

  for (const touched of archive.touched) {
    if (touched.toLowerCase().includes(trimmed)) {
      matches.push({
        kind: 'touch',
        id: touched,
        title: 'Touched surface',
        excerpt: touched,
      });
    }
  }

  return matches
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);
}

export function deriveChatSessionArchiveRecommendations(
  archive: ChatSessionArchiveRecord | null,
  limit = 6,
): ChatSessionArchiveRecommendation[] {
  if (!archive) return [];

  const recommendations: ChatSessionArchiveRecommendation[] = [];
  const errorCounts = new Map<string, { count: number; samples: string[] }>();
  const toolCounts = new Map<string, { count: number; samples: string[] }>();
  const browserCounts = new Map<string, { count: number; samples: string[] }>();

  for (const event of archive.events) {
    if (event.kind === 'error') {
      const key = event.summary.trim();
      const entry = errorCounts.get(key) || { count: 0, samples: [] };
      entry.count += 1;
      if (entry.samples.length < 3) entry.samples.push(event.detail || event.summary);
      errorCounts.set(key, entry);
    }
    if (event.kind === 'verification' || event.kind === 'tool') {
      const key = event.summary.split(':')[0]?.trim() || event.summary.trim();
      const entry = toolCounts.get(key) || { count: 0, samples: [] };
      entry.count += 1;
      if (entry.samples.length < 3) entry.samples.push(event.summary);
      toolCounts.set(key, entry);
    }
    if (event.kind === 'browser_plan' || event.kind === 'browser_session' || event.kind === 'computer_task') {
      const touchedBrowserTask = (event.touched || []).find((value) => value.startsWith('browser_task:') || value.startsWith('computer_task:'));
      const key = touchedBrowserTask || event.summary.trim();
      const entry = browserCounts.get(key) || { count: 0, samples: [] };
      entry.count += 1;
      if (entry.samples.length < 3) entry.samples.push(event.summary);
      browserCounts.set(key, entry);
    }
  }

  for (const [summary, entry] of errorCounts.entries()) {
    if (entry.count < 2) continue;
    recommendations.push({
      id: `failure:${summary}`,
      kind: 'failure_pattern',
      title: `Repeated failure: ${summary.slice(0, 72)}`,
      summary: `${entry.count} similar failures in this thread`,
      content: [
        `Observed repeated failure in thread ${archive.threadId || 'main'}.`,
        `Failure: ${summary}`,
        `Examples:`,
        ...entry.samples.map((sample) => `- ${sample.slice(0, 220)}`),
      ].join('\n'),
      confidence: entry.count >= 3 ? 'high' : 'medium',
      sources: entry.samples,
    });
  }

  for (const [tool, entry] of toolCounts.entries()) {
    if (entry.count < 2) continue;
    recommendations.push({
      id: `tool:${tool}`,
      kind: 'tool_pattern',
      title: `Repeat tool/check pattern: ${tool.slice(0, 72)}`,
      summary: `${entry.count} tool or verification events in this thread`,
      content: [
        `Observed repeated tool/check pattern in thread ${archive.threadId || 'main'}.`,
        `Tool/check: ${tool}`,
        `Recent events:`,
        ...entry.samples.map((sample) => `- ${sample.slice(0, 220)}`),
      ].join('\n'),
      confidence: entry.count >= 3 ? 'high' : 'medium',
      sources: entry.samples,
    });
  }

  for (const [browserKey, entry] of browserCounts.entries()) {
    if (entry.count < 2) continue;
    recommendations.push({
      id: `browser:${browserKey}`,
      kind: 'browser_pattern',
      title: `Repeat computer/browser pattern`,
      summary: `${entry.count} related browser/computer events`,
      content: [
        `Observed repeated browser/computer pattern in thread ${archive.threadId || 'main'}.`,
        `Pattern key: ${browserKey}`,
        `Recent events:`,
        ...entry.samples.map((sample) => `- ${sample.slice(0, 220)}`),
      ].join('\n'),
      confidence: entry.count >= 3 ? 'high' : 'medium',
      sources: entry.samples,
    });
  }

  recommendations.push(...deriveChatSessionArchiveRecoveryRecommendations({
    threadId: archive.threadId || 'main',
    messages: archive.messages,
    handledRecommendationIds: archive.recommendationState,
  }, limit));

  return recommendations
    .sort((a, b) => {
      const rank = (value: ChatSessionArchiveRecommendation) => value.confidence === 'high' ? 1 : 0;
      return rank(b) - rank(a) || b.sources.length - a.sources.length;
    })
    .filter((recommendation) => !archive.recommendationState?.[recommendation.id])
    .slice(0, limit);
}

export async function setChatSessionArchiveRecommendationState(opts: {
  circleId: string;
  threadId?: string | null;
  recommendationId: string;
  status: ChatSessionArchiveRecommendationState['status'];
  memoryId?: string | null;
}): Promise<ChatSessionArchiveRecord> {
  const existing = await loadChatSessionArchive(opts.circleId, opts.threadId);
  const archive: ChatSessionArchiveRecord = existing || {
    circleId: opts.circleId,
    threadId: opts.threadId || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    events: [],
    touched: [],
    recommendationState: {},
  };

  archive.recommendationState = {
    ...(archive.recommendationState || {}),
    [opts.recommendationId]: {
      status: opts.status,
      updatedAt: Date.now(),
      memoryId: opts.memoryId || null,
    },
  };
  archive.updatedAt = Date.now();
  await saveArchive(archive);
  return archive;
}

export function formatChatSessionArchiveBlock(
  archive: ChatSessionArchiveRecord | null,
  opts: {
    maxMessages?: number;
    maxEvents?: number;
    maxRecommendations?: number;
    maxTouched?: number;
    maxChars?: number;
  } = {},
): string | null {
  if (!archive) return null;
  const maxMessages = opts.maxMessages || 10;
  const maxEvents = opts.maxEvents || 12;
  const maxRecommendations = opts.maxRecommendations ?? 3;
  const maxTouched = opts.maxTouched || 24;
  const maxChars = opts.maxChars || 3600;

  const recentMessages = archive.messages.slice(-maxMessages);
  const recentEvents = archive.events.slice(-maxEvents);
  const recentErrors = archive.events.filter((event) => event.kind === 'error').slice(-6);
  const archiveRecommendations = maxRecommendations > 0
    ? deriveChatSessionArchiveRecommendations(archive, maxRecommendations)
    : [];

  const lines: string[] = ['## Session Archive'];
  if (archive.touched.length > 0) {
    lines.push(`Touched: ${archive.touched.slice(-maxTouched).join(', ')}`);
  }
  if (recentErrors.length > 0) {
    lines.push('');
    lines.push('Recent errors:');
    for (const event of recentErrors) {
      lines.push(`- ${event.summary}`);
    }
  }
  if (recentEvents.length > 0) {
    lines.push('');
    lines.push('Recent tool and task events:');
    for (const event of recentEvents) {
      lines.push(`- [${event.kind}] ${event.summary}`);
    }
  }
  if (archiveRecommendations.length > 0) {
    lines.push(...formatChatSessionArchiveRecommendationPromptLines(archiveRecommendations, maxRecommendations));
  }
  if (recentMessages.length > 0) {
    lines.push('');
    lines.push('Recent transcript:');
    for (const message of recentMessages) {
      const who = message.role === 'assistant' ? (message.userName || 'SwanBot') : (message.userName || 'User');
      lines.push(`- ${who}: ${message.content.slice(0, 220)}`);
      if (message.toolSummaries?.length) {
        lines.push(`  tools: ${message.toolSummaries.slice(-4).join(' | ')}`);
      }
      if (message.verificationSummaries?.length) {
        lines.push(`  verification: ${message.verificationSummaries.slice(-3).join(' | ')}`);
      }
      if (message.browserPlanSummaries?.length || message.browserSessionSummaries?.length) {
        lines.push(`  browser: ${[...(message.browserPlanSummaries || []), ...(message.browserSessionSummaries || [])].slice(-3).join(' | ')}`);
      }
      if (message.recoveryOptionSummaries?.length) {
        lines.push(`  recovery: ${message.recoveryOptionSummaries.slice(0, 3).join(' | ')}`);
      }
      if (message.recoveryReliabilitySummaries?.length) {
        lines.push(`  recovery status: ${message.recoveryReliabilitySummaries.slice(0, 3).join(' | ')}`);
      }
      if (message.memoryRecommendations?.length) {
        lines.push(`  learned: ${message.memoryRecommendations.slice(-3).join(' | ')}`);
      }
    }
  }

  let block = lines.join('\n');
  if (block.length > maxChars) {
    block = block.slice(0, maxChars);
    const lastNewline = block.lastIndexOf('\n');
    if (lastNewline > maxChars * 0.75) {
      block = `${block.slice(0, lastNewline)}\n...(session archive truncated)`;
    }
  }
  return block;
}
