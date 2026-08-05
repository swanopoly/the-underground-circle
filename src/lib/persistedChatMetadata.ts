import type { ChatCommandDecision } from './chatCommandRegistry';
import type { AgentPlanDraft } from './agentPlanMode';
import type { ChatOutcomeVerdict, ChatUserSignal } from './chatOutcomeSignals';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { ChatAutomationPlanPreview } from './chatAutomationPlanPreview';
import type {
  ChatComputerAppRouteDecisionSummary,
  ChatComputerHandoffMetadata,
} from './chatComputerHandoffContext';
import type { OpenSwanMemoryRecommendation, PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { OpenSwanTaskPlan } from './openswanTaskPlanner';
import type { OpenSwanToolEvent } from './openswanToolRuntime';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';
import type { ResearchDocumentReference } from './researchControl';
import type { SwanBotStructuredArtifact, SwanBotStructuredResponse } from './swanbot';
import type { WikiArticleReference } from './wikiData';
import type { AgentRuntimeSubjectMetadata } from './agentRuntimeSubject';
import {
  normalizeComputerTaskOutcomeStatus,
  type ComputerTaskOutcomeStatus,
} from './computerTaskOutcome';

const LEGACY_CROWN_PREFIX = /^👑 \*\*OpenSwan:\*\* /u;
const BOT_PREFIX = /^(🦢|🤖) \*\*[^*]{1,80}:\*\* /u;
export const BOT_META_MARKER = '\n[[UC_CHAT_META]]';
const MAX_PERSISTED_BOT_MESSAGE_CHARS = 9000;
const MAX_PERSISTED_RESPONSE_CHARS = 6400;
const AGENT_SUBJECT_ID_MAX = 160;
const AGENT_SUBJECT_NAME_MAX = 120;
const AGENT_SUBJECT_PROVIDER_MAX = 80;
const AGENT_SUBJECT_ALIAS_MAX = 160;
const AGENT_SUBJECT_ALIAS_LIMIT = 8;

export type PersistedChatRecoveryOption = {
  id: string;
  label: string;
  detail: string;
  actor: 'user' | 'openswan' | 'connected_agent' | 'llm' | 'none';
  recommended: boolean;
  source: 'checkpoint_guard' | 'evidence_contract' | 'connected_agent_runbook' | 'recovery_policy' | 'safety_stop';
};

export type PersistedChatRecoveryReliabilitySummary = {
  surfaceKind?: string | null;
  targetName?: string | null;
  taskFamily?: string | null;
  failureArea?: string | null;
  retryAllowed?: boolean;
  userActionRequired?: boolean;
  connectedAgentAllowed?: boolean;
  recommendedOptionId?: string | null;
  readinessStatus?: string | null;
  nextEvidenceTools?: string[];
  requiredEvidenceTools?: string[];
  requiredFreshEvidence?: string[];
  requiredProof?: string[];
  approvalBoundaries?: string[];
  failClosedRules?: string[];
  routeDecisionStatus?: string | null;
  routeDecisionSurface?: string | null;
  selectedRecoveryOptionId?: string | null;
  verificationCommands?: string[];
};

// WI-4: bounded option-card findings persisted with a completed browser run so
// "book option 2" (WI-5) has durable, structured options to resolve against
// after the transient live card is gone. Kept tiny (<=10 items, per-field
// clamps) so it round-trips inside MAX_PERSISTED_BOT_MESSAGE_CHARS.
export type PersistedComputerFinding = {
  title: string;
  url?: string;
  price?: string;
  rating?: string;
  notes?: string;
};

export type PersistedComputerFindings = {
  runId?: string | null;
  sessionId?: string | null;
  items: PersistedComputerFinding[];
};

// Per-field clamps (chars) and item cap. Mirrors the edge Finding shape
// (index.ts:1261) but bounded for persistence.
const COMPUTER_FINDINGS_MAX_ITEMS = 10;
const COMPUTER_FINDING_TITLE_MAX = 140;
const COMPUTER_FINDING_URL_MAX = 240;
const COMPUTER_FINDING_PRICE_MAX = 40;
const COMPUTER_FINDING_RATING_MAX = 40;
const COMPUTER_FINDING_NOTES_MAX = 200;
const COMPUTER_FINDINGS_ID_MAX = 80;

// Best-of-N race summary persisted with the reply message so every candidate
// stays one tap to adopt after reload (the interactive answer to Cursor's
// read-the-worktree-diff adoption flow). Mirrors the computerFindings
// pattern: tiny bounded shape (<=4 candidates, per-field clamps) so it
// round-trips inside MAX_PERSISTED_BOT_MESSAGE_CHARS.
export type PersistedBestOfNRace = {
  task: string;
  winnerIndex: number | null;
  judged: boolean;
  candidates: Array<{
    model: string;
    ok: boolean;
    score: number | null;
    note: string;
    durationMs: number;
    text: string;
  }>;
};

// Per-field clamps (chars) and candidate cap. Mirrors BestOfNRaceSummary from
// bestOfNRace.ts (no import — this module stays standalone, like the edge
// Finding mirror above) but bounded for persistence: text stays adopt-sized.
const BEST_OF_N_MAX_CANDIDATES = 4;
const BEST_OF_N_TASK_MAX = 160;
const BEST_OF_N_MODEL_MAX = 80;
const BEST_OF_N_NOTE_MAX = 120;
const BEST_OF_N_TEXT_MAX = 1500;

export type PersistedChatBotMetadata = {
  localMessageId?: string;
  /** Optional durable execution lineage. Older callers may only supply the
   * handoff/computer-finding run id; the legacy-cap fallback promotes that
   * value into this bounded field when available. */
  runId?: string | null;
  /** Optional provider/client request lineage. Never derived from task text. */
  requestId?: string | null;
  /** Stable human requester for shared-thread ownership reconciliation. */
  requestAuthorId?: string | null;
  source?: {
    actor?: string;
    surface?: string;
    selectedModel?: string | null;
    effectiveModel?: string | null;
    provider?: string | null;
  };
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
  usage?: SwanBotStructuredResponse['usage'] | null;
  commandDecisions?: ChatCommandDecision[];
  artifacts?: SwanBotStructuredArtifact[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  memoriesUsed?: string[];
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  executionStream?: OpenSwanExecutionContract[];
  agentPlan?: AgentPlanDraft | Record<string, unknown>;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: PersistedChatRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  computerTaskStatus?: ComputerTaskOutcomeStatus | null;
  computerHandoff?: ChatComputerHandoffMetadata | null;
  chatAutomationPlanPreview?: ChatAutomationPlanPreview | null;
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints?: string[];
    blockers?: string[];
  };
  observedEval?: OpenSwanObservedEvalSummary | null;
  routing?: SwanBotStructuredResponse['routing'] | null;
  computerFindings?: PersistedComputerFindings | null;
  bestOfN?: PersistedBestOfNRace | null;
  // Flywheel signal (Cursor-Tab precedent): the machine-derived outcome
  // verdict plus the user's accept/reject/edit-resend/steer reaction, kept as
  // tiny enums (+ short lane/model ids) so it becomes BlackSwan training
  // signal with no free-text/PII. See chatOutcomeSignals.ts. It is so small it
  // rides the 'minimal' persistence tier and is dropped only in 'tiny'.
  outcomeSignal?: PersistedOutcomeSignal | null;
  // Coding-lane proof-of-work receipt ("edited N files · checks passed ·
  // committed sha") surfaced from the OpenSwan typed tool loop. Bounded by
  // compactVerificationReceipt (40 files / 20 checks; minimal tier tighter).
  verificationReceipt?: PersistedVerificationReceipt | null;
};

export type PersistedVerificationReceipt = {
  verdict: 'verified' | 'unverified' | 'failed';
  editedFiles: string[];
  checks: Array<{ name: string; passed: boolean }>;
  committed: boolean;
  commitRef?: string;
  summary: string;
};

export type PersistedOutcomeSignal = {
  verdict: ChatOutcomeVerdict;
  signal?: ChatUserSignal;
  lane?: string;
  model?: string;
};

// Enum/id whitelists so a persisted row (untrusted after round-trip) can only
// carry known-small values. Kept local — this module stays standalone rather
// than importing the chatOutcomeSignals runtime, mirroring the edge Finding /
// bestOfN mirror pattern above.
const OUTCOME_VERDICTS = ['completed', 'partial', 'blocked', 'failed', 'unknown'] as const;
const OUTCOME_SIGNALS = ['accept', 'reject', 'edit_resend', 'steer', 'retry', 'abandon'] as const;
const OUTCOME_LANE_MAX = 48;
const OUTCOME_MODEL_MAX = 80;

// Internal compaction reused by every persistence tier so the field is always
// bounded identically (mirrors compactComputerFindings). Hard id clamps keep
// the byte cost predictable; unknown verdicts collapse to 'unknown' and
// unknown signals drop. Returns undefined when there is no usable signal.
function compactOutcomeSignal(
  signal?: PersistedOutcomeSignal | null,
): PersistedOutcomeSignal | undefined {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) return undefined;
  const raw = signal as Record<string, unknown>;
  const verdict = (OUTCOME_VERDICTS as readonly string[]).includes(raw.verdict as string)
    ? (raw.verdict as ChatOutcomeVerdict)
    : 'unknown';
  const userSignal = (OUTCOME_SIGNALS as readonly string[]).includes(raw.signal as string)
    ? (raw.signal as ChatUserSignal)
    : undefined;
  const lane = typeof raw.lane === 'string' && raw.lane.trim()
    ? raw.lane.trim().slice(0, OUTCOME_LANE_MAX)
    : undefined;
  const model = typeof raw.model === 'string' && raw.model.trim()
    ? raw.model.trim().slice(0, OUTCOME_MODEL_MAX)
    : undefined;
  // Nothing worth persisting: no explicit verdict AND no reaction/ids.
  const hasVerdict = (OUTCOME_VERDICTS as readonly string[]).includes(raw.verdict as string);
  if (!hasVerdict && !userSignal && !lane && !model) return undefined;
  const compacted: PersistedOutcomeSignal = { verdict };
  if (userSignal) compacted.signal = userSignal;
  if (lane) compacted.lane = lane;
  if (model) compacted.model = model;
  return compacted;
}

// Verification receipt compaction — shared by both persistence tiers so the
// receipt is always bounded identically to the agent_run_events payload
// (40 files / 20 checks at the compact tier; the minimal tier keeps a tighter
// slice since it exists to shrink oversized rows). Defensive re-clamp: the
// value is untrusted after a round-trip.
function compactVerificationReceipt(
  receipt?: PersistedVerificationReceipt | null,
  tier: 'compact' | 'minimal' = 'compact',
): PersistedVerificationReceipt | undefined {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return undefined;
  const raw = receipt as Record<string, unknown>;
  const maxFiles = tier === 'minimal' ? 8 : 40;
  const maxChecks = tier === 'minimal' ? 6 : 20;
  const maxPathLen = tier === 'minimal' ? 120 : 300;
  const editedFiles = (Array.isArray(raw.editedFiles) ? raw.editedFiles : [])
    .filter((f): f is string => typeof f === 'string' && !!f)
    .slice(0, maxFiles)
    .map((f) => truncateText(f, maxPathLen));
  const checks = (Array.isArray(raw.checks) ? raw.checks : [])
    .filter((c) => !!c && typeof c === 'object' && !Array.isArray(c))
    .slice(0, maxChecks)
    .map((c) => ({
      name: truncateText(String((c as Record<string, unknown>).name || ''), 60),
      passed: (c as Record<string, unknown>).passed === true,
    }))
    .filter((c) => !!c.name);
  const committed = raw.committed === true;
  // Nothing worth persisting: no edits, no checks, no commit.
  if (editedFiles.length === 0 && checks.length === 0 && !committed) return undefined;
  const verdict: PersistedVerificationReceipt['verdict'] =
    raw.verdict === 'verified' || raw.verdict === 'failed' ? raw.verdict : 'unverified';
  const commitRef = typeof raw.commitRef === 'string' && raw.commitRef
    ? truncateText(raw.commitRef, 40)
    : undefined;
  return {
    verdict,
    editedFiles,
    checks,
    committed,
    ...(commitRef ? { commitRef } : {}),
    summary: truncateText(String(raw.summary || ''), 400),
  };
}

// Reader — pull the flywheel signal back off a persisted bot message (e.g. to
// re-stamp a user reaction, or aggregate for the dashboard). Re-clamps
// defensively since the row content is untrusted after a round-trip.
export function readPersistedOutcomeSignal(
  metadata: Record<string, unknown> | null | undefined,
): PersistedOutcomeSignal | null {
  const raw = metadata?.outcomeSignal;
  if (!raw || typeof raw !== 'object') return null;
  return compactOutcomeSignal(raw as PersistedOutcomeSignal) ?? null;
}

// WI-4 builder — turn raw run findings into the bounded persisted shape.
// Hard clamp with no verbose "[truncated]" suffix — findings fields are short
// and must have predictable byte cost so 10 items always fit the message cap.
function clampFindingText(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

// `findings` accepts the edge Finding-ish objects (title required; url/price/
// rating/notes optional; extra keys ignored). Returns undefined when there is
// nothing worth persisting so callers can spread it conditionally.
export function computerFindingsMetadata(
  findings: ReadonlyArray<{
    title?: unknown;
    url?: unknown;
    price?: unknown;
    rating?: unknown;
    notes?: unknown;
  } | null | undefined> | null | undefined,
  ids: { runId?: string | null; sessionId?: string | null },
): PersistedComputerFindings | undefined {
  const items: PersistedComputerFinding[] = [];
  if (Array.isArray(findings)) {
    for (const raw of findings) {
      if (!raw || typeof raw !== 'object') continue;
      const title = typeof raw.title === 'string' ? raw.title.trim() : '';
      if (!title) continue;
      const item: PersistedComputerFinding = {
        title: clampFindingText(title, COMPUTER_FINDING_TITLE_MAX),
      };
      if (typeof raw.url === 'string' && raw.url.trim()) {
        item.url = clampFindingText(raw.url.trim(), COMPUTER_FINDING_URL_MAX);
      }
      if (typeof raw.price === 'string' && raw.price.trim()) {
        item.price = clampFindingText(raw.price.trim(), COMPUTER_FINDING_PRICE_MAX);
      }
      if (typeof raw.rating === 'string' && raw.rating.trim()) {
        item.rating = clampFindingText(raw.rating.trim(), COMPUTER_FINDING_RATING_MAX);
      }
      if (typeof raw.notes === 'string' && raw.notes.trim()) {
        item.notes = clampFindingText(raw.notes.trim(), COMPUTER_FINDING_NOTES_MAX);
      }
      items.push(item);
      if (items.length >= COMPUTER_FINDINGS_MAX_ITEMS) break;
    }
  }
  const runId = typeof ids.runId === 'string' && ids.runId
    ? clampFindingText(ids.runId, COMPUTER_FINDINGS_ID_MAX)
    : null;
  const sessionId = typeof ids.sessionId === 'string' && ids.sessionId
    ? clampFindingText(ids.sessionId, COMPUTER_FINDINGS_ID_MAX)
    : null;
  if (items.length === 0 && !runId && !sessionId) return undefined;
  return { runId, sessionId, items };
}

// WI-4 reader — pull the findings back off a persisted bot message so WI-5 can
// match "book option 2" against durable options. Re-clamps defensively (the row
// content is untrusted after a round-trip).
export function readPersistedComputerFindings(
  metadata: PersistedChatBotMetadata | null | undefined,
): PersistedComputerFindings | null {
  const raw = metadata?.computerFindings;
  if (!raw || typeof raw !== 'object') return null;
  const compacted = compactComputerFindings(raw);
  return compacted ?? null;
}

// Internal compaction reused by every persistence tier so the field is always
// bounded identically no matter which tier survives the byte cap.
function compactComputerFindings(
  findings?: PersistedComputerFindings | null,
): PersistedComputerFindings | undefined {
  if (!findings || typeof findings !== 'object') return undefined;
  const items: PersistedComputerFinding[] = [];
  const rawItems = Array.isArray(findings.items) ? findings.items : [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!title) continue;
    const item: PersistedComputerFinding = {
      title: clampFindingText(title, COMPUTER_FINDING_TITLE_MAX),
    };
    if (typeof raw.url === 'string' && raw.url.trim()) {
      item.url = clampFindingText(raw.url.trim(), COMPUTER_FINDING_URL_MAX);
    }
    if (typeof raw.price === 'string' && raw.price.trim()) {
      item.price = clampFindingText(raw.price.trim(), COMPUTER_FINDING_PRICE_MAX);
    }
    if (typeof raw.rating === 'string' && raw.rating.trim()) {
      item.rating = clampFindingText(raw.rating.trim(), COMPUTER_FINDING_RATING_MAX);
    }
    if (typeof raw.notes === 'string' && raw.notes.trim()) {
      item.notes = clampFindingText(raw.notes.trim(), COMPUTER_FINDING_NOTES_MAX);
    }
    items.push(item);
    if (items.length >= COMPUTER_FINDINGS_MAX_ITEMS) break;
  }
  const runId = typeof findings.runId === 'string' && findings.runId
    ? clampFindingText(findings.runId, COMPUTER_FINDINGS_ID_MAX)
    : null;
  const sessionId = typeof findings.sessionId === 'string' && findings.sessionId
    ? clampFindingText(findings.sessionId, COMPUTER_FINDINGS_ID_MAX)
    : null;
  if (items.length === 0 && !runId && !sessionId) return undefined;
  return { runId, sessionId, items };
}

// Best-of-N builder — validate + clamp a race summary (`summarizeBestOfNRace`
// output from bestOfNRace.ts, or anything shaped like it) into the bounded
// persisted shape: <=4 candidates, task <=160, note <=120, text <=1500, so
// persisted rows stay bounded. Returns null when there are no usable
// candidates so callers can attach it conditionally.
export function bestOfNMetadata(summary: unknown): PersistedBestOfNRace | null {
  return compactBestOfNRace(summary) ?? null;
}

// Best-of-N reader — pull the race back off a persisted bot message so the
// adopt card can offer every candidate after reload. Re-clamps defensively
// (the row content is untrusted after a round-trip).
export function readPersistedBestOfNRace(
  metadata: Record<string, unknown> | null | undefined,
): PersistedBestOfNRace | null {
  const raw = metadata?.bestOfN;
  if (!raw || typeof raw !== 'object') return null;
  return compactBestOfNRace(raw) ?? null;
}

// Internal compaction reused by every persistence tier so the field is always
// bounded identically no matter which tier survives the byte cap (mirrors
// compactComputerFindings).
function compactBestOfNRace(race: unknown): PersistedBestOfNRace | undefined {
  if (!race || typeof race !== 'object' || Array.isArray(race)) return undefined;
  const raw = race as Record<string, unknown>;
  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidates: PersistedBestOfNRace['candidates'] = [];
  // Original index -> kept index, so winnerIndex survives dropped junk entries.
  const keptIndexByOriginal = new Map<number, number>();
  for (let index = 0; index < rawCandidates.length; index += 1) {
    if (candidates.length >= BEST_OF_N_MAX_CANDIDATES) break;
    const entry = rawCandidates[index];
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const model = typeof candidate.model === 'string' ? candidate.model.trim() : '';
    if (!model) continue;
    keptIndexByOriginal.set(index, candidates.length);
    candidates.push({
      model: clampFindingText(model, BEST_OF_N_MODEL_MAX),
      ok: candidate.ok === true,
      score: typeof candidate.score === 'number' && Number.isFinite(candidate.score)
        ? candidate.score
        : null,
      note: typeof candidate.note === 'string'
        ? clampFindingText(candidate.note, BEST_OF_N_NOTE_MAX)
        : '',
      durationMs: typeof candidate.durationMs === 'number' && Number.isFinite(candidate.durationMs)
        ? Math.max(0, Math.round(candidate.durationMs))
        : 0,
      text: typeof candidate.text === 'string'
        ? clampFindingText(candidate.text, BEST_OF_N_TEXT_MAX)
        : '',
    });
  }
  if (candidates.length === 0) return undefined;
  const task = typeof raw.task === 'string' ? clampFindingText(raw.task, BEST_OF_N_TASK_MAX) : '';
  // Winner must map to a kept, successful candidate — anything else is null
  // (adopt-card star + adopt button stay coherent on untrusted rows).
  let winnerIndex: number | null = null;
  if (typeof raw.winnerIndex === 'number' && Number.isInteger(raw.winnerIndex)) {
    const kept = keptIndexByOriginal.get(raw.winnerIndex);
    if (kept !== undefined && candidates[kept].ok) winnerIndex = kept;
  }
  return { task, winnerIndex, judged: raw.judged === true, candidates };
}

function normalizeChatAgentName(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'Agent') return 'OpenSwan';
  return trimmed;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 36)).trimEnd()}\n\n[truncated for saved chat]`;
}

function compactRecoveryOptions(
  options?: PersistedChatRecoveryOption[],
  limit = 5,
): PersistedChatRecoveryOption[] | undefined {
  if (!Array.isArray(options) || options.length === 0) return undefined;
  return options.slice(0, limit)
    .map((option: any) => ({
      id: truncateText(String(option?.id || option?.label || 'recovery_option'), 80),
      label: truncateText(String(option?.label || 'Recovery option'), 120),
      detail: truncateText(String(option?.detail || ''), 360),
      actor: option?.actor === 'user'
        || option?.actor === 'openswan'
        || option?.actor === 'connected_agent'
        || option?.actor === 'llm'
        || option?.actor === 'none'
        ? option.actor
        : 'none',
      recommended: option?.recommended === true,
      source: option?.source === 'checkpoint_guard'
        || option?.source === 'evidence_contract'
        || option?.source === 'connected_agent_runbook'
        || option?.source === 'recovery_policy'
        || option?.source === 'safety_stop'
        ? option.source
        : 'recovery_policy',
    }))
    .filter((option) => option.id && option.label) as PersistedChatRecoveryOption[];
}

function compactStringList(value: unknown, limit: number, maxChars: number): string[] {
  return Array.isArray(value)
    ? value.slice(0, limit).map((item) => truncateText(String(item || ''), maxChars)).filter(Boolean)
    : [];
}

function compactAgentSubjectString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxChars) : undefined;
}

function compactAgentSubjectMetadata(
  metadata?: AgentRuntimeSubjectMetadata | null,
): AgentRuntimeSubjectMetadata | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const raw = metadata as Record<string, unknown>;
  const agentSubjectKey = compactAgentSubjectString(raw.agentSubjectKey, AGENT_SUBJECT_ID_MAX);
  const agentDisplayName = compactAgentSubjectString(raw.agentDisplayName, AGENT_SUBJECT_NAME_MAX);
  if (!agentSubjectKey || !agentDisplayName) return undefined;

  const legacyAgentIds: string[] = [];
  const rawLegacyAgentIds = Array.isArray(raw.legacyAgentIds) ? raw.legacyAgentIds : [];
  for (const legacyId of rawLegacyAgentIds) {
    const value = compactAgentSubjectString(legacyId, AGENT_SUBJECT_ALIAS_MAX);
    if (!value || value === agentSubjectKey || legacyAgentIds.includes(value)) continue;
    legacyAgentIds.push(value);
    if (legacyAgentIds.length >= AGENT_SUBJECT_ALIAS_LIMIT) break;
  }

  const compacted: AgentRuntimeSubjectMetadata = {
    agentSubjectKey,
    agentDisplayName,
    legacyAgentIds,
  };
  const agentDbId = compactAgentSubjectString(raw.agentDbId, AGENT_SUBJECT_ID_MAX);
  if (agentDbId) compacted.agentDbId = agentDbId;
  const agentProvider = compactAgentSubjectString(raw.agentProvider, AGENT_SUBJECT_PROVIDER_MAX);
  if (agentProvider) compacted.agentProvider = agentProvider;
  const agentSessionKey = compactAgentSubjectString(raw.agentSessionKey, AGENT_SUBJECT_ID_MAX);
  if (agentSessionKey) compacted.agentSessionKey = agentSessionKey;
  const agentSpiritId = compactAgentSubjectString(raw.agentSpiritId, AGENT_SUBJECT_ID_MAX);
  if (agentSpiritId) compacted.agentSpiritId = agentSpiritId;
  return compacted;
}

function compactRecoveryReliability(
  summary?: PersistedChatRecoveryReliabilitySummary | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): PersistedChatRecoveryReliabilitySummary | undefined {
  if (!summary || typeof summary !== 'object') return undefined;
  const itemLimit = mode === 'full' ? 5 : mode === 'minimal' ? 3 : 2;
  const textLimit = mode === 'full' ? 180 : mode === 'minimal' ? 130 : 90;
  const compacted: PersistedChatRecoveryReliabilitySummary = {
    surfaceKind: summary.surfaceKind ? truncateText(String(summary.surfaceKind), 60) : null,
    targetName: summary.targetName ? truncateText(String(summary.targetName), 120) : null,
    taskFamily: summary.taskFamily ? truncateText(String(summary.taskFamily), 120) : null,
    failureArea: summary.failureArea ? truncateText(String(summary.failureArea), 80) : null,
    retryAllowed: summary.retryAllowed === true,
    userActionRequired: summary.userActionRequired === true,
    connectedAgentAllowed: summary.connectedAgentAllowed === true,
    recommendedOptionId: summary.recommendedOptionId ? truncateText(String(summary.recommendedOptionId), 100) : null,
    readinessStatus: summary.readinessStatus ? truncateText(String(summary.readinessStatus), 60) : null,
    nextEvidenceTools: compactStringList(summary.nextEvidenceTools, itemLimit, 120),
    requiredEvidenceTools: compactStringList(summary.requiredEvidenceTools, itemLimit, 120),
    requiredFreshEvidence: compactStringList(summary.requiredFreshEvidence, itemLimit, textLimit),
    requiredProof: compactStringList(summary.requiredProof, itemLimit, textLimit),
    approvalBoundaries: compactStringList(summary.approvalBoundaries, itemLimit, textLimit),
    failClosedRules: compactStringList(summary.failClosedRules, itemLimit, textLimit),
    routeDecisionStatus: summary.routeDecisionStatus ? truncateText(String(summary.routeDecisionStatus), 80) : null,
    routeDecisionSurface: summary.routeDecisionSurface ? truncateText(String(summary.routeDecisionSurface), 140) : null,
    selectedRecoveryOptionId: summary.selectedRecoveryOptionId ? truncateText(String(summary.selectedRecoveryOptionId), 100) : null,
    verificationCommands: compactStringList(summary.verificationCommands, mode === 'full' ? 8 : 4, 160),
  };
  return compacted.surfaceKind
    || compacted.failureArea
    || compacted.readinessStatus
    || compacted.nextEvidenceTools?.length
    || compacted.requiredEvidenceTools?.length
    ? compacted
    : undefined;
}

function compactComputerRequestNotice(
  notice?: ChatComputerHandoffMetadata['requestNotice'] | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): ChatComputerHandoffMetadata['requestNotice'] | null {
  if (!notice) return null;
  const maxSummary = mode === 'tiny' ? 160 : mode === 'minimal' ? 220 : 360;
  const maxDetail = mode === 'tiny' ? 140 : mode === 'minimal' ? 180 : 260;
  const autonomy = notice.autonomy || {
    userEffort: notice.visibility === 'hidden' ? 'none' : notice.tone === 'attention' ? 'unblock' : notice.primaryAction ? 'approve' : 'review',
    shouldShowUserNotice: notice.visibility === 'user',
    canRunQuietly: notice.visibility === 'hidden',
    canAutoPrepare: false,
    autoPreparationTargets: [],
    primaryUserAction: notice.primaryAction?.detail || null,
    hiddenReason: notice.hiddenReason || null,
    reason: notice.primaryAction?.detail || notice.hiddenReason || 'Saved chat notice predates autonomy metadata.',
    userActionBlockers: [],
    guardrails: [],
    automationSteps: [],
  };
  return {
    visibility: notice.visibility,
    tone: notice.tone,
    title: truncateText(String(notice.title || ''), 80),
    summary: truncateText(String(notice.summary || ''), maxSummary),
    autonomy: {
      userEffort: autonomy.userEffort,
      shouldShowUserNotice: autonomy.shouldShowUserNotice === true,
      canRunQuietly: autonomy.canRunQuietly === true,
      canAutoPrepare: autonomy.canAutoPrepare === true,
      autoPreparationTargets: compactStringList(autonomy.autoPreparationTargets, mode === 'full' ? 5 : 3, 100),
      primaryUserAction: autonomy.primaryUserAction ? truncateText(String(autonomy.primaryUserAction), maxDetail) : null,
      hiddenReason: autonomy.hiddenReason ? truncateText(String(autonomy.hiddenReason), maxDetail) : null,
      reason: truncateText(String(autonomy.reason || ''), maxDetail),
      userActionBlockers: compactStringList(autonomy.userActionBlockers, mode === 'full' ? 3 : 1, maxDetail),
      guardrails: compactStringList(autonomy.guardrails, mode === 'full' ? 4 : 2, maxDetail),
      automationSteps: compactStringList(autonomy.automationSteps, mode === 'full' ? 4 : 2, maxDetail),
    },
    primaryAction: notice.primaryAction
      ? {
          kind: notice.primaryAction.kind,
          label: truncateText(String(notice.primaryAction.label || ''), 120),
          detail: truncateText(String(notice.primaryAction.detail || ''), maxDetail),
        }
      : null,
    secondaryActions: mode === 'full'
      ? (notice.secondaryActions || []).slice(0, 2).map((action) => ({
          kind: action.kind,
          label: truncateText(String(action.label || ''), 120),
          detail: truncateText(String(action.detail || ''), 220),
        }))
      : [],
    badges: (notice.badges || []).slice(0, mode === 'full' ? 5 : 3).map((value) => truncateText(String(value), 80)),
    proof: (notice.proof || []).slice(0, mode === 'full' ? 3 : 2).map((value) => truncateText(String(value), mode === 'tiny' ? 120 : 220)),
    hiddenReason: notice.hiddenReason ? truncateText(String(notice.hiddenReason), maxDetail) : null,
    appChoiceLine: notice.appChoiceLine ? truncateText(String(notice.appChoiceLine), mode === 'tiny' ? 180 : 260) : null,
    appChoice: notice.appChoice
      ? {
          visibility: notice.appChoice.visibility === 'user' ? 'user' : 'hidden',
          selectedAppId: truncateText(String(notice.appChoice.selectedAppId || ''), 80),
          selectedAppName: truncateText(String(notice.appChoice.selectedAppName || ''), 120),
          selectedSurface: notice.appChoice.selectedSurface === 'desktop' ? 'desktop' : 'browser',
          openVia: notice.appChoice.openVia === 'desktop_launch' || notice.appChoice.openVia === 'url_scheme'
            ? notice.appChoice.openVia
            : 'browser_url',
          availability: notice.appChoice.availability === 'installed' || notice.appChoice.availability === 'maybe' || notice.appChoice.availability === 'web'
            ? notice.appChoice.availability
            : undefined,
          reason: truncateText(String(notice.appChoice.reason || ''), maxDetail),
          line: truncateText(String(notice.appChoice.line || notice.appChoiceLine || ''), mode === 'tiny' ? 180 : 260),
          alternatives: compactStringList(notice.appChoice.alternatives, mode === 'full' ? 3 : 2, 80),
          switchHint: notice.appChoice.switchHint ? truncateText(String(notice.appChoice.switchHint), 160) : null,
          explicitAppNamed: notice.appChoice.explicitAppNamed === true,
          namedAppIntent: notice.appChoice.namedAppIntent ? truncateText(String(notice.appChoice.namedAppIntent), 100) : null,
          openStepLines: compactStringList(notice.appChoice.openStepLines, mode === 'full' ? 3 : 2, 120),
          recoveryFallbackName: notice.appChoice.recoveryFallbackName ? truncateText(String(notice.appChoice.recoveryFallbackName), 120) : null,
        }
      : null,
    // Plan preview (D1) — persisted only in full mode and bounded hard so
    // message rows stay small; tiny/minimal drop it (the formatted text the
    // user saw is already in the message body).
    planPreview: mode === 'full' && notice.planPreview
      ? {
          visibility: notice.planPreview.visibility,
          target: truncateText(String(notice.planPreview.target || ''), 80),
          steps: compactStringList(notice.planPreview.steps, 6, 160),
          surfaces: compactStringList(notice.planPreview.surfaces, 3, 60),
          approvalGates: compactStringList(notice.planPreview.approvalGates, 3, 160),
          constraints: compactStringList(notice.planPreview.constraints, 3, 120),
          proof: compactStringList(notice.planPreview.proof, 3, 160),
          editHint: truncateText(String(notice.planPreview.editHint || ''), 120),
        }
      : null,
  };
}

function compactComputerTaskEvidenceContract(
  contract?: ChatComputerHandoffMetadata['evidenceContract'] | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): ChatComputerHandoffMetadata['evidenceContract'] | null {
  if (!contract) return null;
  const itemLimit = mode === 'full' ? 5 : mode === 'minimal' ? 3 : 2;
  const textLimit = mode === 'full' ? 180 : mode === 'minimal' ? 140 : 100;
  return {
    schemaVersion: 1,
    kind: contract.kind,
    targetName: truncateText(String(contract.targetName || ''), 120),
    taskFamily: truncateText(String(contract.taskFamily || ''), 120),
    observeBefore: (contract.observeBefore || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    actionabilityChecks: (contract.actionabilityChecks || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    approvalBefore: (contract.approvalBefore || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    mutationGuardrails: (contract.mutationGuardrails || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    proofAfter: (contract.proofAfter || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    failClosedRules: (contract.failClosedRules || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    freshEvidenceRequired: (contract.freshEvidenceRequired || []).slice(0, mode === 'full' ? 4 : 2).map((value) => truncateText(String(value), textLimit)),
    sourceRefs: mode === 'tiny'
      ? []
      : (contract.sourceRefs || []).slice(0, mode === 'full' ? 5 : 3).map((ref) => ({
          label: truncateText(String(ref.label || ''), 120),
          url: truncateText(String(ref.url || ''), 220),
          takeaway: truncateText(String(ref.takeaway || ''), 180),
        })),
    userSummary: truncateText(String(contract.userSummary || ''), mode === 'full' ? 260 : 160),
  };
}

function compactComputerAppRouteDecision(
  decision?: ChatComputerAppRouteDecisionSummary | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): ChatComputerAppRouteDecisionSummary | null {
  if (!decision) return null;
  const itemLimit = mode === 'full' ? 5 : mode === 'minimal' ? 3 : 2;
  const textLimit = mode === 'full' ? 180 : mode === 'minimal' ? 140 : 100;
  return {
    status: decision.status,
    targetName: truncateText(String(decision.targetName || ''), 120),
    taskFamily: truncateText(String(decision.taskFamily || ''), 120),
    chosenSurfaceId: decision.chosenSurfaceId,
    chosenSurfaceLabel: truncateText(String(decision.chosenSurfaceLabel || ''), 140),
    chosenSurfaceFit: truncateText(String(decision.chosenSurfaceFit || ''), 40),
    score: Number.isFinite(decision.score) ? decision.score : 0,
    missingConfirmations: (decision.missingConfirmations || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    missingApprovals: (decision.missingApprovals || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    userActionBlockers: (decision.userActionBlockers || []).slice(0, mode === 'full' ? 4 : 2).map((value) => truncateText(String(value), textLimit)),
    nextSteps: (decision.nextSteps || []).slice(0, itemLimit).map((value) => truncateText(String(value), textLimit)),
    sourceRefs: mode === 'tiny'
      ? []
      : (decision.sourceRefs || []).slice(0, mode === 'full' ? 5 : 3).map((ref) => ({
          label: truncateText(String(ref.label || ''), 120),
          url: truncateText(String(ref.url || ''), 220),
        })),
  };
}

function hasPersistedMetadata(metadata?: PersistedChatBotMetadata): boolean {
  return !!metadata && (
    !!metadata.localMessageId ||
    !!metadata.runId ||
    !!metadata.requestId ||
    !!metadata.requestAuthorId ||
    !!metadata.source ||
    !!compactAgentSubjectMetadata(metadata.agentSubjectMetadata) ||
    !!metadata.usage ||
    (metadata.commandDecisions?.length || 0) > 0 ||
    (metadata.artifacts?.length || 0) > 0 ||
    (metadata.wikiRefs?.length || 0) > 0 ||
    (metadata.researchRefs?.length || 0) > 0 ||
    (metadata.memoriesUsed?.length || 0) > 0 ||
    (metadata.memoryRefs?.length || 0) > 0 ||
    (metadata.memoryRecommendations?.length || 0) > 0 ||
    (metadata.executionStream?.length || 0) > 0 ||
    !!metadata.agentPlan ||
    !!metadata.taskPlan ||
    (metadata.toolEvents?.length || 0) > 0 ||
    (metadata.verificationResults?.length || 0) > 0 ||
    (metadata.browserPlans?.length || 0) > 0 ||
    (metadata.browserPlanEvents?.length || 0) > 0 ||
    (metadata.browserSessions?.length || 0) > 0 ||
    (metadata.recoveryOptions?.length || 0) > 0 ||
    !!metadata.recoveryReliability ||
    !!normalizeComputerTaskOutcomeStatus(metadata.computerTaskStatus) ||
    !!metadata.computerHandoff ||
    !!metadata.chatAutomationPlanPreview ||
    !!metadata.modeOutcomeSummary?.headline ||
    !!metadata.observedEval ||
    !!metadata.routing ||
    (metadata.computerFindings?.items?.length || 0) > 0 ||
    !!metadata.computerFindings?.runId ||
    !!metadata.computerFindings?.sessionId ||
    (metadata.bestOfN?.candidates?.length || 0) > 0 ||
    !!compactOutcomeSignal(metadata.outcomeSignal) ||
    !!compactVerificationReceipt(metadata.verificationReceipt)
  );
}

function compactChatAutomationPlanPreview(
  preview?: ChatAutomationPlanPreview | null,
  mode: 'full' | 'minimal' = 'full',
): ChatAutomationPlanPreview | undefined {
  if (!preview || typeof preview !== 'object') return undefined;
  const itemLimit = mode === 'full' ? 5 : 3;
  const evidencePanel = preview.evidencePanel && typeof preview.evidencePanel === 'object'
    ? {
        kind: truncateText(String(preview.evidencePanel.kind || ''), 40),
        targetLabel: truncateText(String(preview.evidencePanel.targetLabel || ''), mode === 'full' ? 100 : 70),
        taskFamilyLabel: truncateText(String(preview.evidencePanel.taskFamilyLabel || ''), mode === 'full' ? 100 : 70),
        observeBefore: compactStringList(preview.evidencePanel.observeBefore, mode === 'full' ? 4 : 2, mode === 'full' ? 150 : 90),
        actionabilityChecks: compactStringList(preview.evidencePanel.actionabilityChecks, mode === 'full' ? 4 : 2, mode === 'full' ? 150 : 90),
        approvalBefore: compactStringList(preview.evidencePanel.approvalBefore, mode === 'full' ? 4 : 2, mode === 'full' ? 150 : 90),
        proofAfter: compactStringList(preview.evidencePanel.proofAfter, mode === 'full' ? 4 : 2, mode === 'full' ? 150 : 90),
        failClosedRules: compactStringList(preview.evidencePanel.failClosedRules, mode === 'full' ? 4 : 2, mode === 'full' ? 150 : 90),
        freshEvidenceRequired: compactStringList(preview.evidencePanel.freshEvidenceRequired, mode === 'full' ? 3 : 1, mode === 'full' ? 150 : 90),
        sourceRefs: Array.isArray(preview.evidencePanel.sourceRefs)
          ? preview.evidencePanel.sourceRefs.slice(0, mode === 'full' ? 3 : 1).map((ref: any) => ({
              title: truncateText(String(ref?.title || 'source reference'), 80),
              url: truncateText(String(ref?.url || ''), 180),
            })).filter((ref) => ref.url)
          : [],
      }
    : undefined;
  return {
    title: truncateText(String(preview.title || 'Plan'), 80),
    intentLabel: truncateText(String(preview.intentLabel || ''), mode === 'full' ? 160 : 90),
    routeLabel: truncateText(String(preview.routeLabel || 'direct'), 60),
    surfaceLabel: truncateText(String(preview.surfaceLabel || ''), mode === 'full' ? 160 : 90),
    mode: preview.mode,
    riskLabel: truncateText(String(preview.riskLabel || ''), 80),
    riskTone: preview.riskTone,
    approvalLabel: truncateText(String(preview.approvalLabel || ''), mode === 'full' ? 180 : 100),
    approvalRequired: preview.approvalRequired === true,
    evidence: compactStringList(preview.evidence, itemLimit, mode === 'full' ? 160 : 90),
    recovery: compactStringList(preview.recovery, mode === 'full' ? 4 : 2, mode === 'full' ? 180 : 100),
    tools: compactStringList(preview.tools, itemLimit, 100),
    chips: Array.isArray(preview.chips)
      ? preview.chips.slice(0, itemLimit).map((chip: any) => ({
          label: truncateText(String(chip?.label || ''), 70),
          tone: chip?.tone === 'safe'
            || chip?.tone === 'review'
            || chip?.tone === 'danger'
            || chip?.tone === 'neutral'
            ? chip.tone
            : 'neutral',
        })).filter((chip) => chip.label)
      : [],
    evidencePanel,
  };
}

// Highest-risk / proof-bearing operations first, so a tight slice at a low
// persistence tier keeps the operations that matter most for accountability.
function sortDesignRunbooksByRisk<T extends { risk?: unknown; operation?: unknown }>(runbooks: readonly T[]): T[] {
  return runbooks.slice().sort((a, b) => {
    const score = (item: T) => {
      let value = item.risk === 'high' ? 30 : item.risk === 'review' ? 20 : 10;
      if (/generative|destructive|relink|asset|package|export|proof/i.test(String(item.operation))) value += 5;
      return value;
    };
    return score(b) - score(a);
  });
}

function compactComputerHandoff(
  handoff?: ChatComputerHandoffMetadata | null,
  mode: 'full' | 'minimal' | 'tiny' = 'full',
): ChatComputerHandoffMetadata | undefined {
  if (!handoff) return undefined;
  if (mode === 'tiny') {
    return {
      surface: handoff.surface,
      entrypoint: handoff.entrypoint || null,
      adapterId: handoff.adapterId || null,
      taskKind: handoff.taskKind || null,
      taskLabel: handoff.taskLabel ? truncateText(String(handoff.taskLabel), 120) : null,
      capabilityProfile: handoff.capabilityProfile || null,
      recommendedMode: handoff.recommendedMode || null,
      browserPlanId: null,
      browserActionCount: handoff.browserActionCount ?? null,
      runId: null,
      outcomeStatus: normalizeComputerTaskOutcomeStatus(handoff.outcomeStatus),
      replayPolicy: handoff.replayPolicy === 'manual_verify_only' ? 'manual_verify_only' : 'normal',
      mutationDispatched: handoff.mutationDispatched === true,
      verificationOnlyTools: (handoff.verificationOnlyTools || []).slice(0, 4).map((value) => truncateText(String(value), 120)),
      preflightStatus: handoff.preflightStatus || null,
      preflightSummary: handoff.preflightSummary ? truncateText(String(handoff.preflightSummary), 120) : null,
      groundingStatus: handoff.groundingStatus || null,
      groundingSummary: handoff.groundingSummary ? truncateText(String(handoff.groundingSummary), 120) : null,
      warningCount: handoff.warningCount || 0,
      blockerCount: handoff.blockerCount || 0,
      warnings: (handoff.warnings || []).slice(0, 1).map((value) => truncateText(String(value), 140)),
      blockers: (handoff.blockers || []).slice(0, 1).map((value) => truncateText(String(value), 140)),
      grantSummary: null,
      approvalSummary: handoff.approvalSummary ? truncateText(String(handoff.approvalSummary), 140) : null,
      desktopAttachmentPackage: handoff.desktopAttachmentPackage
        ? {
            fileCount: handoff.desktopAttachmentPackage.fileCount,
            primaryFileCount: handoff.desktopAttachmentPackage.primaryFileCount,
            stageDirectory: null,
            manifestPath: null,
            sha256Count: handoff.desktopAttachmentPackage.sha256Count,
            files: [],
          }
        : null,
      designAppTask: handoff.designAppTask
        ? {
            appId: handoff.designAppTask.appId,
            appName: handoff.designAppTask.appName,
            taskKind: truncateText(String(handoff.designAppTask.taskKind || ''), 80),
            documentSignals: handoff.designAppTask.documentSignals.slice(0, 2).map((value) => truncateText(String(value), 80)),
            operations: handoff.designAppTask.operations.slice(0, 5),
            requiredInventory: [],
            approvalGates: [],
            verificationSignals: [],
            recommendedTools: handoff.designAppTask.recommendedTools.slice(0, 5),
            creativeAiCapabilities: handoff.designAppTask.creativeAiCapabilities?.slice(0, 4),
          }
        : null,
      designCreativeAi: handoff.designCreativeAi
        ? {
            capabilities: (handoff.designCreativeAi.capabilities || []).slice(0, 2).map((capability) => ({
              id: capability.id,
              label: truncateText(String(capability.label || ''), 80),
              creativeOutcome: '',
              controlSurface: '',
              gapTool: truncateText(String(capability.gapTool || ''), 100),
              buildoutTrigger: '',
            })),
            recipes: (handoff.designCreativeAi.recipes || []).slice(0, 2).map((recipe) => ({
              id: recipe.id,
              capabilityId: recipe.capabilityId,
              label: truncateText(String(recipe.label || ''), 100),
              userVisibleSummary: truncateText(String(recipe.userVisibleSummary || ''), 120),
              approvalSummary: '',
              verificationSummary: '',
              buildoutTool: truncateText(String(recipe.buildoutTool || ''), 100),
              recoveryHint: truncateText(String(recipe.recoveryHint || ''), 120),
            })),
            userVisibleOptions: [],
            creativeBriefSignals: [],
            approvalGates: [],
            verificationSignals: [],
            buildoutTools: (handoff.designCreativeAi.buildoutTools || []).slice(0, 3).map((value) => truncateText(String(value), 100)),
            recoveryHints: (handoff.designCreativeAi.recoveryHints || []).slice(0, 2).map((value) => truncateText(String(value), 120)),
            failClosedRules: [],
            sourceRefs: [],
          }
        : null,
      designExecutionPipeline: handoff.designExecutionPipeline
        ? {
            quietUserSummary: truncateText(String(handoff.designExecutionPipeline.quietUserSummary || ''), 160),
            nextVisibleAction: truncateText(String(handoff.designExecutionPipeline.nextVisibleAction || ''), 140),
            requiredToolSequence: handoff.designExecutionPipeline.requiredToolSequence.slice(0, 6).map((value) => truncateText(String(value), 100)),
            approvalTools: handoff.designExecutionPipeline.approvalTools.slice(0, 2).map((value) => truncateText(String(value), 100)),
            mutationTools: handoff.designExecutionPipeline.mutationTools.slice(0, 4).map((value) => truncateText(String(value), 100)),
            proofTools: handoff.designExecutionPipeline.proofTools.slice(0, 4).map((value) => truncateText(String(value), 100)),
            buildoutTools: handoff.designExecutionPipeline.buildoutTools.slice(0, 4).map((value) => truncateText(String(value), 100)),
            creativeAiRecipeIds: handoff.designExecutionPipeline.creativeAiRecipeIds.slice(0, 4),
            adapterGapOperations: handoff.designExecutionPipeline.adapterGapOperations.slice(0, 4),
            failClosedRules: [],
            phases: handoff.designExecutionPipeline.phases.slice(0, 6).map((phase) => ({
              id: phase.id,
              label: truncateText(String(phase.label || ''), 90),
              operations: phase.operations.slice(0, 3),
              tools: phase.tools.slice(0, 3).map((value) => truncateText(String(value), 100)),
              approvalRequired: phase.approvalRequired === true,
              userVisibleWhen: phase.userVisibleWhen,
              requiredEvidence: [],
              recoveryAction: truncateText(String(phase.recoveryAction || ''), 100),
            })),
          }
        : null,
      designOperationRunbooks: handoff.designOperationRunbooks?.length
        ? sortDesignRunbooksByRisk(handoff.designOperationRunbooks).slice(0, 3).map((runbook) => ({
            operation: runbook.operation,
            label: truncateText(String(runbook.label || ''), 90),
            risk: truncateText(String(runbook.risk || ''), 60),
            controlSurface: '',
            requiredInputs: [],
            approvalBefore: (runbook.approvalBefore || []).slice(0, 1).map((value) => truncateText(String(value), 90)),
            successCriteria: [],
            failClosedConditions: [],
          }))
        : null,
      engineeringCadOperationRunbooks: null,
      designAdapterGaps: handoff.designAdapterGaps?.length
        ? handoff.designAdapterGaps.slice(0, 2).map((gap) => ({
            operation: gap.operation,
            adapterId: truncateText(String(gap.adapterId || ''), 90),
            controlSurface: '',
            missingBridgeTools: gap.missingBridgeTools.slice(0, 2).map((value) => truncateText(String(value), 100)),
            requiredBridgeToolsBeforeRetry: [],
            requiredEvidence: [],
            focusedSmokeCases: [],
            failClosedRules: [],
          }))
        : null,
      designObjectManifest: handoff.designObjectManifest
        ? {
            schemaVersion: 1,
            artifactKind: 'design_object_manifest',
            beforeSnapshotTools: handoff.designObjectManifest.beforeSnapshotTools.slice(0, 4),
            afterSnapshotTools: handoff.designObjectManifest.afterSnapshotTools.slice(0, 4),
            entityKinds: handoff.designObjectManifest.entityKinds.slice(0, 10).map((value) => truncateText(String(value), 80)),
            comparisons: [],
            approvalEvidence: [],
            failClosedConditions: handoff.designObjectManifest.failClosedConditions.slice(0, 2).map((value) => truncateText(String(value), 140)),
            redactionRules: handoff.designObjectManifest.redactionRules.slice(0, 2).map((value) => truncateText(String(value), 140)),
          }
        : null,
      designObjectManifestArtifact: null,
      requestNotice: compactComputerRequestNotice(handoff.requestNotice, 'tiny'),
      evidenceContract: compactComputerTaskEvidenceContract(handoff.evidenceContract, 'tiny'),
      appRouteDecision: compactComputerAppRouteDecision(handoff.appRouteDecision, 'tiny'),
      designProofReview: handoff.designProofReview
        ? {
            reviewTitle: truncateText(String(handoff.designProofReview.reviewTitle || ''), 120),
            userVisibleSummary: truncateText(String(handoff.designProofReview.userVisibleSummary || ''), 140),
            checklist: [],
            requiredEvidence: handoff.designProofReview.requiredEvidence.slice(0, 2).map((value) => truncateText(String(value), 140)),
            approvalBefore: [],
            passCriteria: handoff.designProofReview.passCriteria.slice(0, 2).map((value) => truncateText(String(value), 140)),
            failClosedConditions: [],
            artifactKinds: handoff.designProofReview.artifactKinds.slice(0, 3).map((value) => truncateText(String(value), 80)),
          }
        : null,
    };
  }
  const designRunbooks = sortDesignRunbooksByRisk(handoff.designOperationRunbooks || []);
  const cadRunbooks = (handoff.engineeringCadOperationRunbooks || [])
    .slice()
    .sort((a, b) => {
      const score = (item: typeof a) => {
        let value = item.risk === 'high' ? 30 : item.risk === 'review' ? 20 : 10;
        if (/model|bim|batch|convert|export|plot|draft/i.test(String(item.operation))) value += 5;
        return value;
      };
      return score(b) - score(a);
    });
  const files = handoff.desktopAttachmentPackage?.files?.slice(0, mode === 'minimal' ? 3 : 8).map((file) => ({
    name: truncateText(String(file.name || ''), 160),
    localPath: mode === 'minimal' ? '' : truncateText(String(file.localPath || ''), 320),
    appName: file.appName || null,
    sha256: file.sha256 ? String(file.sha256).slice(0, 16) : undefined,
  }));
  return {
    surface: handoff.surface,
    entrypoint: handoff.entrypoint || null,
    adapterId: handoff.adapterId || null,
    taskKind: handoff.taskKind || null,
    taskLabel: handoff.taskLabel ? truncateText(String(handoff.taskLabel), 160) : null,
    capabilityProfile: handoff.capabilityProfile || null,
    recommendedMode: handoff.recommendedMode || null,
    browserPlanId: mode === 'minimal' ? null : handoff.browserPlanId || null,
    browserActionCount: handoff.browserActionCount ?? null,
    runId: mode === 'minimal' ? null : handoff.runId || null,
    outcomeStatus: normalizeComputerTaskOutcomeStatus(handoff.outcomeStatus),
    replayPolicy: handoff.replayPolicy === 'manual_verify_only' ? 'manual_verify_only' : 'normal',
    mutationDispatched: handoff.mutationDispatched === true,
    verificationOnlyTools: (handoff.verificationOnlyTools || []).slice(0, 4).map((value) => truncateText(String(value), 120)),
    preflightStatus: handoff.preflightStatus || null,
    preflightSummary: handoff.preflightSummary ? truncateText(String(handoff.preflightSummary), mode === 'minimal' ? 160 : 360) : null,
    groundingStatus: handoff.groundingStatus || null,
    groundingSummary: handoff.groundingSummary ? truncateText(String(handoff.groundingSummary), mode === 'minimal' ? 160 : 360) : null,
    warningCount: handoff.warningCount || 0,
    blockerCount: handoff.blockerCount || 0,
    warnings: (handoff.warnings || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 260)),
    blockers: (handoff.blockers || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 260)),
    grantSummary: handoff.grantSummary ? truncateText(String(handoff.grantSummary), mode === 'minimal' ? 180 : 360) : null,
    approvalSummary: handoff.approvalSummary ? truncateText(String(handoff.approvalSummary), mode === 'minimal' ? 180 : 360) : null,
    desktopAttachmentPackage: handoff.desktopAttachmentPackage
      ? {
          fileCount: handoff.desktopAttachmentPackage.fileCount,
          primaryFileCount: handoff.desktopAttachmentPackage.primaryFileCount,
          stageDirectory: mode === 'minimal' ? null : handoff.desktopAttachmentPackage.stageDirectory || null,
          manifestPath: mode === 'minimal' ? null : handoff.desktopAttachmentPackage.manifestPath || null,
          sha256Count: handoff.desktopAttachmentPackage.sha256Count,
          files: files || [],
        }
      : null,
    designAppTask: handoff.designAppTask
      ? {
          appId: handoff.designAppTask.appId,
          appName: handoff.designAppTask.appName,
          taskKind: truncateText(String(handoff.designAppTask.taskKind || ''), 80),
          documentSignals: handoff.designAppTask.documentSignals.slice(0, 4).map((value) => truncateText(String(value), 120)),
          operations: handoff.designAppTask.operations.slice(0, 6),
          requiredInventory: handoff.designAppTask.requiredInventory.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          approvalGates: handoff.designAppTask.approvalGates.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          verificationSignals: handoff.designAppTask.verificationSignals.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          recommendedTools: handoff.designAppTask.recommendedTools.slice(0, mode === 'minimal' ? 6 : 10),
        }
      : null,
    designCreativeAi: handoff.designCreativeAi
      ? {
          capabilities: (handoff.designCreativeAi.capabilities || []).slice(0, mode === 'minimal' ? 2 : 4).map((capability) => ({
            id: capability.id,
            label: truncateText(String(capability.label || ''), 120),
            creativeOutcome: truncateText(String(capability.creativeOutcome || ''), mode === 'minimal' ? 120 : 180),
            controlSurface: truncateText(String(capability.controlSurface || ''), mode === 'minimal' ? 120 : 180),
            gapTool: truncateText(String(capability.gapTool || ''), 120),
            buildoutTrigger: truncateText(String(capability.buildoutTrigger || ''), mode === 'minimal' ? 140 : 240),
          })),
          recipes: (handoff.designCreativeAi.recipes || []).slice(0, mode === 'minimal' ? 2 : 4).map((recipe) => ({
            id: recipe.id,
            capabilityId: recipe.capabilityId,
            label: truncateText(String(recipe.label || ''), 120),
            userVisibleSummary: truncateText(String(recipe.userVisibleSummary || ''), mode === 'minimal' ? 140 : 220),
            approvalSummary: truncateText(String(recipe.approvalSummary || ''), mode === 'minimal' ? 120 : 220),
            verificationSummary: truncateText(String(recipe.verificationSummary || ''), mode === 'minimal' ? 120 : 220),
            buildoutTool: truncateText(String(recipe.buildoutTool || ''), 120),
            recoveryHint: truncateText(String(recipe.recoveryHint || ''), mode === 'minimal' ? 120 : 220),
          })),
          userVisibleOptions: (handoff.designCreativeAi.userVisibleOptions || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 140 : 220)),
          creativeBriefSignals: (handoff.designCreativeAi.creativeBriefSignals || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 120)),
          approvalGates: (handoff.designCreativeAi.approvalGates || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 140)),
          verificationSignals: (handoff.designCreativeAi.verificationSignals || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 140)),
          buildoutTools: (handoff.designCreativeAi.buildoutTools || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 120)),
          recoveryHints: (handoff.designCreativeAi.recoveryHints || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 140)),
          failClosedRules: (handoff.designCreativeAi.failClosedRules || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 140)),
          sourceRefs: (handoff.designCreativeAi.sourceRefs || []).slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 180)),
        }
      : null,
    designExecutionPipeline: handoff.designExecutionPipeline
      ? {
          quietUserSummary: truncateText(String(handoff.designExecutionPipeline.quietUserSummary || ''), 240),
          nextVisibleAction: truncateText(String(handoff.designExecutionPipeline.nextVisibleAction || ''), 220),
          requiredToolSequence: handoff.designExecutionPipeline.requiredToolSequence.slice(0, mode === 'minimal' ? 6 : 12).map((value) => truncateText(String(value), 120)),
          approvalTools: handoff.designExecutionPipeline.approvalTools.slice(0, mode === 'minimal' ? 3 : 6).map((value) => truncateText(String(value), 120)),
          mutationTools: handoff.designExecutionPipeline.mutationTools.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 120)),
          proofTools: handoff.designExecutionPipeline.proofTools.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 120)),
          buildoutTools: handoff.designExecutionPipeline.buildoutTools.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 120)),
          creativeAiRecipeIds: handoff.designExecutionPipeline.creativeAiRecipeIds.slice(0, mode === 'minimal' ? 4 : 8),
          adapterGapOperations: handoff.designExecutionPipeline.adapterGapOperations.slice(0, mode === 'minimal' ? 4 : 8),
          failClosedRules: handoff.designExecutionPipeline.failClosedRules.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 220)),
          phases: handoff.designExecutionPipeline.phases.slice(0, mode === 'minimal' ? 4 : 6).map((phase) => ({
            id: phase.id,
            label: truncateText(String(phase.label || ''), 120),
            operations: phase.operations.slice(0, mode === 'minimal' ? 3 : 5),
            tools: phase.tools.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 120)),
            approvalRequired: phase.approvalRequired === true,
            userVisibleWhen: phase.userVisibleWhen,
            requiredEvidence: phase.requiredEvidence.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 160)),
            recoveryAction: truncateText(String(phase.recoveryAction || ''), mode === 'minimal' ? 120 : 220),
          })),
        }
      : null,
    designObjectManifest: handoff.designObjectManifest && mode !== 'minimal'
      ? {
          schemaVersion: 1,
          artifactKind: 'design_object_manifest',
          beforeSnapshotTools: handoff.designObjectManifest.beforeSnapshotTools.slice(0, 8),
          afterSnapshotTools: handoff.designObjectManifest.afterSnapshotTools.slice(0, 8),
          entityKinds: handoff.designObjectManifest.entityKinds.slice(0, 10).map((value) => truncateText(String(value), 80)),
          comparisons: handoff.designObjectManifest.comparisons.slice(0, 8).map((value) => truncateText(String(value), 180)),
          approvalEvidence: handoff.designObjectManifest.approvalEvidence.slice(0, 8).map((value) => truncateText(String(value), 180)),
          failClosedConditions: handoff.designObjectManifest.failClosedConditions.slice(0, 6).map((value) => truncateText(String(value), 180)),
          redactionRules: handoff.designObjectManifest.redactionRules.slice(0, 4).map((value) => truncateText(String(value), 180)),
        }
      : null,
    designObjectManifestArtifact: handoff.designObjectManifestArtifact
      ? {
          schemaVersion: 1,
          artifactKind: 'design_object_manifest',
          appId: handoff.designObjectManifestArtifact.appId,
          appName: truncateText(String(handoff.designObjectManifestArtifact.appName || ''), 120),
          taskKind: handoff.designObjectManifestArtifact.taskKind,
          operations: handoff.designObjectManifestArtifact.operations.slice(0, mode === 'minimal' ? 6 : 10),
          generatedAt: truncateText(String(handoff.designObjectManifestArtifact.generatedAt || ''), 80),
          auditOk: handoff.designObjectManifestArtifact.auditOk === true,
          blockerCount: handoff.designObjectManifestArtifact.blockerCount || 0,
          warningCount: handoff.designObjectManifestArtifact.warningCount || 0,
          beforeToolCount: handoff.designObjectManifestArtifact.beforeToolCount || 0,
          afterToolCount: handoff.designObjectManifestArtifact.afterToolCount || 0,
          actionCount: handoff.designObjectManifestArtifact.actionCount || 0,
          artifactCount: handoff.designObjectManifestArtifact.artifactCount || 0,
          activeDocumentName: handoff.designObjectManifestArtifact.activeDocumentName
            ? truncateText(String(handoff.designObjectManifestArtifact.activeDocumentName), 160)
            : null,
          activeDocumentBasename: handoff.designObjectManifestArtifact.activeDocumentBasename
            ? truncateText(String(handoff.designObjectManifestArtifact.activeDocumentBasename), 160)
            : null,
          changedEntityKinds: handoff.designObjectManifestArtifact.changedEntityKinds.slice(0, mode === 'minimal' ? 6 : 10),
          artifactKinds: handoff.designObjectManifestArtifact.artifactKinds.slice(0, mode === 'minimal' ? 6 : 10),
          comparisonStatuses: handoff.designObjectManifestArtifact.comparisonStatuses.slice(0, mode === 'minimal' ? 5 : 10).map((item) => ({
            label: truncateText(String(item.label || ''), 160),
            status: item.status,
          })),
          proofArtifacts: handoff.designObjectManifestArtifact.proofArtifacts.slice(0, mode === 'minimal' ? 3 : 6).map((item) => ({
            label: truncateText(String(item.label || ''), 120),
            basename: item.basename ? truncateText(String(item.basename), 160) : null,
            format: item.format || null,
            sizeBytes: item.sizeBytes ?? null,
            widthPx: item.widthPx ?? null,
            heightPx: item.heightPx ?? null,
            pageCount: item.pageCount ?? null,
          })),
          packageArtifacts: handoff.designObjectManifestArtifact.packageArtifacts.slice(0, mode === 'minimal' ? 2 : 4).map((item) => ({
            label: truncateText(String(item.label || ''), 120),
            basename: item.basename ? truncateText(String(item.basename), 160) : null,
            sizeBytes: item.sizeBytes ?? null,
          })),
          blockers: handoff.designObjectManifestArtifact.blockers.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 220)),
          warnings: handoff.designObjectManifestArtifact.warnings.slice(0, mode === 'minimal' ? 4 : 8).map((value) => truncateText(String(value), 220)),
          redaction: 'basename_hash_only',
        }
      : null,
    designOperationRunbooks: designRunbooks.length
      ? designRunbooks.slice(0, mode === 'minimal' ? 2 : 4).map((runbook) => ({
          operation: runbook.operation,
          label: truncateText(String(runbook.label || ''), mode === 'minimal' ? 100 : 140),
          risk: truncateText(String(runbook.risk || ''), 60),
          controlSurface: truncateText(String(runbook.controlSurface || ''), mode === 'minimal' ? 100 : 160),
          requiredInputs: runbook.requiredInputs.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          approvalBefore: runbook.approvalBefore.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          successCriteria: runbook.successCriteria.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          failClosedConditions: runbook.failClosedConditions.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
        }))
      : null,
    engineeringCadOperationRunbooks: cadRunbooks.length
      ? cadRunbooks.slice(0, mode === 'minimal' ? 2 : 4).map((runbook) => ({
          operation: runbook.operation,
          label: truncateText(String(runbook.label || ''), mode === 'minimal' ? 100 : 140),
          risk: truncateText(String(runbook.risk || ''), 60),
          controlSurface: truncateText(String(runbook.controlSurface || ''), mode === 'minimal' ? 100 : 160),
          requiredInputs: runbook.requiredInputs.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          approvalBefore: runbook.approvalBefore.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          successCriteria: runbook.successCriteria.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
          failClosedConditions: runbook.failClosedConditions.slice(0, mode === 'minimal' ? 2 : 3).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 140)),
        }))
      : null,
    designAdapterGaps: handoff.designAdapterGaps?.length
      ? handoff.designAdapterGaps.slice(0, mode === 'minimal' ? 2 : 4).map((gap) => ({
          operation: gap.operation,
          adapterId: truncateText(String(gap.adapterId || ''), 120),
          controlSurface: truncateText(String(gap.controlSurface || ''), mode === 'minimal' ? 100 : 180),
          missingBridgeTools: gap.missingBridgeTools.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), 120)),
          requiredBridgeToolsBeforeRetry: gap.requiredBridgeToolsBeforeRetry.slice(0, mode === 'minimal' ? 2 : 5).map((value) => truncateText(String(value), 120)),
          requiredEvidence: gap.requiredEvidence.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 160)),
          focusedSmokeCases: gap.focusedSmokeCases.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 160)),
          failClosedRules: gap.failClosedRules.slice(0, mode === 'minimal' ? 2 : 4).map((value) => truncateText(String(value), mode === 'minimal' ? 100 : 180)),
        }))
      : null,
    requestNotice: compactComputerRequestNotice(handoff.requestNotice, mode),
    evidenceContract: compactComputerTaskEvidenceContract(handoff.evidenceContract, mode),
    appRouteDecision: compactComputerAppRouteDecision(handoff.appRouteDecision, mode),
    designProofReview: handoff.designProofReview
      ? {
          reviewTitle: truncateText(String(handoff.designProofReview.reviewTitle || ''), 140),
          userVisibleSummary: truncateText(String(handoff.designProofReview.userVisibleSummary || ''), 240),
          checklist: handoff.designProofReview.checklist.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          requiredEvidence: handoff.designProofReview.requiredEvidence.slice(0, mode === 'minimal' ? 4 : 6).map((value) => truncateText(String(value), 180)),
          approvalBefore: handoff.designProofReview.approvalBefore.slice(0, mode === 'minimal' ? 4 : 6).map((value) => truncateText(String(value), 180)),
          passCriteria: handoff.designProofReview.passCriteria.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          failClosedConditions: handoff.designProofReview.failClosedConditions.slice(0, mode === 'minimal' ? 3 : 5).map((value) => truncateText(String(value), 180)),
          artifactKinds: handoff.designProofReview.artifactKinds.slice(0, mode === 'minimal' ? 4 : 6).map((value) => truncateText(String(value), 80)),
        }
      : null,
  };
}

function compactPersistedMetadata(metadata?: PersistedChatBotMetadata): PersistedChatBotMetadata | undefined {
  if (!metadata) return undefined;
  return {
    localMessageId: metadata.localMessageId,
    runId: metadata.runId,
    requestId: metadata.requestId,
    requestAuthorId: metadata.requestAuthorId,
    source: metadata.source,
    agentSubjectMetadata: compactAgentSubjectMetadata(metadata.agentSubjectMetadata),
    usage: metadata.usage,
    commandDecisions: metadata.commandDecisions?.slice(0, 8),
    artifacts: metadata.artifacts?.slice(0, 8).map((artifact) => ({
      ...artifact,
      content: artifact.content ? truncateText(artifact.content, 1200) : artifact.content,
    })),
    wikiRefs: metadata.wikiRefs?.slice(0, 5),
    researchRefs: metadata.researchRefs?.slice(0, 5),
    memoriesUsed: metadata.memoriesUsed?.slice(0, 12),
    memoryRefs: metadata.memoryRefs?.slice(0, 8),
    memoryRecommendations: metadata.memoryRecommendations?.slice(0, 6),
    executionStream: metadata.executionStream?.slice(0, 12).map((step: any) => ({
      ...step,
      body: typeof step?.body === 'string' ? truncateText(step.body, 800) : step?.body,
      summary: typeof step?.summary === 'string' ? truncateText(step.summary, 800) : step?.summary,
    })) as any,
    agentPlan: metadata.agentPlan ? {
      id: (metadata.agentPlan as any).id || null,
      title: truncateText(String((metadata.agentPlan as any).title || 'Agent plan'), 180),
      task: truncateText(String((metadata.agentPlan as any).task || ''), 500),
      mode: (metadata.agentPlan as any).mode,
      status: (metadata.agentPlan as any).status,
      risk: (metadata.agentPlan as any).risk,
      buildReady: !!(metadata.agentPlan as any).buildReady,
      stepCount: Array.isArray((metadata.agentPlan as any).steps) ? (metadata.agentPlan as any).steps.length : (metadata.agentPlan as any).stepCount,
      questionCount: Array.isArray((metadata.agentPlan as any).questions) ? (metadata.agentPlan as any).questions.length : (metadata.agentPlan as any).questionCount,
      flow: (metadata.agentPlan as any).flow,
      steps: Array.isArray((metadata.agentPlan as any).steps)
        ? (metadata.agentPlan as any).steps.slice(0, 8).map((step: any) => ({
            order: step.order,
            kind: step.kind,
            title: truncateText(String(step.title || ''), 180),
            requiresApproval: !!step.requiresApproval,
            toolNames: Array.isArray(step.toolNames) ? step.toolNames.slice(0, 8) : [],
          }))
        : undefined,
      questions: Array.isArray((metadata.agentPlan as any).questions)
        ? (metadata.agentPlan as any).questions.slice(0, 5).map((question: any) => ({
            order: question.order,
            question: truncateText(String(question.question || ''), 240),
            status: question.status,
          }))
        : undefined,
    } as any : undefined,
    taskPlan: metadata.taskPlan ? {
      kind: metadata.taskPlan.kind,
      profile: metadata.taskPlan.profile,
      summary: truncateText(String(metadata.taskPlan.summary || ''), 800),
      recommendedTools: metadata.taskPlan.recommendedTools?.slice(0, 12),
      verification: metadata.taskPlan.verification?.slice(0, 12).map((check) => ({
        ...check,
        reason: truncateText(String(check.reason || ''), 300),
      })),
    } as any : undefined,
    toolEvents: metadata.toolEvents?.slice(-16).map((event) => ({
      tool: event.tool,
      status: event.status,
      summary: truncateText(String(event.summary || ''), 700),
      command: event.command ? truncateText(event.command, 500) : undefined,
      metadata: event.metadata,
    })) as any,
    verificationResults: metadata.verificationResults?.slice(-12).map((result) => ({
      check: result.check,
      status: result.status,
      ok: result.ok,
      executed: result.executed,
      summary: truncateText(String(result.summary || ''), 700),
      command: result.command ? truncateText(result.command, 500) : undefined,
      stdout: result.stdout ? truncateText(result.stdout, 500) : undefined,
      stderr: result.stderr ? truncateText(result.stderr, 500) : undefined,
      error: result.error ? truncateText(result.error, 500) : undefined,
      execution: result.execution ? {
        ...result.execution,
        summary: truncateText(String(result.execution.summary || ''), 500),
        command: result.execution.command ? truncateText(result.execution.command, 400) : undefined,
        error: result.execution.error ? truncateText(String(result.execution.error), 400) : result.execution.error,
      } : result.execution,
    })) as any,
    browserPlans: metadata.browserPlans?.slice(0, 3).map((plan: any) => ({
      planId: plan.planId,
      task: truncateText(String(plan.task || ''), 500),
      backend: plan.backend,
      backendLabel: plan.backendLabel,
      backendDetails: plan.backendDetails,
      requiresApproval: plan.requiresApproval,
      recommendedPermission: plan.recommendedPermission,
      status: plan.status,
      launchedAt: plan.launchedAt,
      completedAt: plan.completedAt,
      backendSessionId: plan.backendSessionId,
      backendLiveUrl: plan.backendLiveUrl,
      actions: Array.isArray(plan.actions)
        ? plan.actions.slice(0, 10).map((action: any) => ({
            id: action.id,
            type: action.type,
            target: typeof action.target === 'string' ? truncateText(action.target, 240) : action.target,
            value: typeof action.value === 'string' ? truncateText(action.value, 160) : action.value,
            description: typeof action.description === 'string' ? truncateText(action.description, 300) : action.description,
            requiresApproval: action.requiresApproval,
            approvalReason: action.approvalReason,
            blockedReason: action.blockedReason,
          }))
        : [],
    })) as any,
    browserPlanEvents: metadata.browserPlanEvents?.slice(-12),
    browserSessions: metadata.browserSessions?.slice(-3).map((session: any) => ({
      id: session.id,
      planId: session.planId,
      task: truncateText(String(session.task || ''), 500),
      backend: session.backend,
      backendLabel: session.backendLabel,
      status: session.status,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      currentUrl: session.currentUrl,
      backendSessionId: session.backendSessionId,
      backendLiveUrl: session.backendLiveUrl,
      recommendedPermission: session.recommendedPermission,
      actions: Array.isArray(session.actions) ? session.actions.slice(0, 10) : [],
    })) as any,
    recoveryOptions: compactRecoveryOptions(metadata.recoveryOptions, 5),
    recoveryReliability: compactRecoveryReliability(metadata.recoveryReliability),
    computerTaskStatus: normalizeComputerTaskOutcomeStatus(metadata.computerTaskStatus),
    computerHandoff: compactComputerHandoff(metadata.computerHandoff),
    chatAutomationPlanPreview: compactChatAutomationPlanPreview(metadata.chatAutomationPlanPreview),
    modeOutcomeSummary: metadata.modeOutcomeSummary,
    observedEval: metadata.observedEval,
    routing: metadata.routing,
    computerFindings: compactComputerFindings(metadata.computerFindings),
    bestOfN: compactBestOfNRace(metadata.bestOfN),
    outcomeSignal: compactOutcomeSignal(metadata.outcomeSignal),
    verificationReceipt: compactVerificationReceipt(metadata.verificationReceipt),
  };
}

function minimalPersistedMetadata(metadata?: PersistedChatBotMetadata): PersistedChatBotMetadata | undefined {
  if (!metadata) return undefined;
  return {
    localMessageId: metadata.localMessageId,
    runId: metadata.runId,
    requestId: metadata.requestId,
    requestAuthorId: metadata.requestAuthorId,
    source: metadata.source,
    agentSubjectMetadata: compactAgentSubjectMetadata(metadata.agentSubjectMetadata),
    usage: metadata.usage,
    artifacts: metadata.artifacts?.slice(0, 4).map((artifact) => ({
      kind: artifact.kind,
      title: artifact.title,
      url: artifact.url,
      metadata: artifact.metadata,
    })),
    wikiRefs: metadata.wikiRefs?.slice(0, 3),
    researchRefs: metadata.researchRefs?.slice(0, 3),
    memoriesUsed: metadata.memoriesUsed?.slice(0, 6),
    memoryRefs: metadata.memoryRefs?.slice(0, 4),
    memoryRecommendations: metadata.memoryRecommendations?.slice(0, 3),
    executionStream: metadata.executionStream?.slice(-6).map((step: any) => ({
      id: step?.id,
      status: step?.status,
      title: step?.title,
      kind: step?.kind,
      label: step?.label,
    })) as any,
    agentPlan: metadata.agentPlan ? {
      id: (metadata.agentPlan as any).id || null,
      title: truncateText(String((metadata.agentPlan as any).title || 'Agent plan'), 140),
      mode: (metadata.agentPlan as any).mode,
      status: (metadata.agentPlan as any).status,
      risk: (metadata.agentPlan as any).risk,
      buildReady: !!(metadata.agentPlan as any).buildReady,
      stepCount: Array.isArray((metadata.agentPlan as any).steps) ? (metadata.agentPlan as any).steps.length : (metadata.agentPlan as any).stepCount,
      questionCount: Array.isArray((metadata.agentPlan as any).questions) ? (metadata.agentPlan as any).questions.length : (metadata.agentPlan as any).questionCount,
    } as any : undefined,
    taskPlan: metadata.taskPlan ? {
      kind: metadata.taskPlan.kind,
      profile: metadata.taskPlan.profile,
      summary: truncateText(String(metadata.taskPlan.summary || ''), 240),
    } as any : undefined,
    toolEvents: metadata.toolEvents?.slice(-6).map((event) => ({
      tool: event.tool,
      status: event.status,
      summary: truncateText(String(event.summary || ''), 240),
    })) as any,
    verificationResults: metadata.verificationResults?.slice(-4).map((result) => ({
      check: result.check ? {
        id: result.check.id,
        label: result.check.label,
        kind: result.check.kind,
        required: result.check.required,
      } : result.check,
      status: result.status,
      ok: result.ok,
      executed: result.executed,
      summary: truncateText(String(result.summary || ''), 240),
    })) as any,
    browserPlans: metadata.browserPlans?.slice(0, 2).map((plan: any) => ({
      planId: plan.planId,
      task: truncateText(String(plan.task || ''), 240),
      backend: plan.backend,
      backendLabel: plan.backendLabel,
      requiresApproval: plan.requiresApproval,
      status: plan.status,
      backendSessionId: plan.backendSessionId,
      backendLiveUrl: plan.backendLiveUrl,
      actions: Array.isArray(plan.actions)
        ? plan.actions.slice(0, 5).map((action: any) => ({
            id: action.id,
            type: action.type,
            target: typeof action.target === 'string' ? truncateText(action.target, 120) : action.target,
            description: typeof action.description === 'string' ? truncateText(action.description, 160) : action.description,
            requiresApproval: action.requiresApproval,
          }))
        : [],
    })) as any,
    browserPlanEvents: metadata.browserPlanEvents?.slice(-6),
    browserSessions: metadata.browserSessions?.slice(-2).map((session: any) => ({
      id: session.id,
      planId: session.planId,
      task: truncateText(String(session.task || ''), 240),
      backend: session.backend,
      backendLabel: session.backendLabel,
      status: session.status,
      backendSessionId: session.backendSessionId,
      backendLiveUrl: session.backendLiveUrl,
    })) as any,
    recoveryOptions: compactRecoveryOptions(metadata.recoveryOptions, 3),
    recoveryReliability: compactRecoveryReliability(metadata.recoveryReliability, 'minimal'),
    computerTaskStatus: normalizeComputerTaskOutcomeStatus(metadata.computerTaskStatus),
    computerHandoff: compactComputerHandoff(metadata.computerHandoff, 'minimal'),
    chatAutomationPlanPreview: compactChatAutomationPlanPreview(metadata.chatAutomationPlanPreview, 'minimal'),
    modeOutcomeSummary: metadata.modeOutcomeSummary,
    observedEval: metadata.observedEval ? {
      outcome: (metadata.observedEval as any).outcome,
      responseQuality: (metadata.observedEval as any).responseQuality,
      verification: (metadata.observedEval as any).verification,
    } as any : metadata.observedEval,
    routing: metadata.routing,
    // Findings are the anchor for "book option 2"; keep them intact at the
    // minimal tier (already tightly bounded) so the follow-up seam survives.
    computerFindings: compactComputerFindings(metadata.computerFindings),
    // Same deal for the best-of-N race: it is the anchor for one-tap adopt
    // and already tightly bounded, so it rides through the minimal tier too.
    bestOfN: compactBestOfNRace(metadata.bestOfN),
    // Flywheel signal is a handful of enum bytes — the whole point is that it
    // is durable training data, so it rides the minimal tier and is dropped
    // only in the narrative-only 'tiny' fallback below.
    outcomeSignal: compactOutcomeSignal(metadata.outcomeSignal),
    // Proof-of-work receipt survives the minimal tier with tighter slices —
    // it is the honest "what changed / did checks pass / was it committed"
    // record for the message.
    verificationReceipt: compactVerificationReceipt(metadata.verificationReceipt, 'minimal'),
  };
}

export function isPersistedChatBotMessage(content: string | null | undefined, isBotFlag = false): boolean {
  if (isBotFlag) return true;
  const value = content || '';
  return BOT_PREFIX.test(value) || LEGACY_CROWN_PREFIX.test(value);
}

export function stripPersistedChatBotPrefix(content: string | null | undefined): string {
  const value = content || '';
  const withoutPrefix = value.replace(BOT_PREFIX, '').replace(LEGACY_CROWN_PREFIX, '');
  const metaIndex = withoutPrefix.indexOf(BOT_META_MARKER);
  return metaIndex >= 0 ? withoutPrefix.slice(0, metaIndex) : withoutPrefix;
}

export function readPersistedChatBotMetadata(content: string | null | undefined): PersistedChatBotMetadata | null {
  const value = content || '';
  const metaIndex = value.indexOf(BOT_META_MARKER);
  if (metaIndex < 0) return null;
  const raw = value.slice(metaIndex + BOT_META_MARKER.length).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedChatBotMetadata;
    if (!parsed || typeof parsed !== 'object') return null;
    const agentSubjectMetadata = compactAgentSubjectMetadata(parsed.agentSubjectMetadata);
    return {
      ...parsed,
      requestAuthorId: boundedLegacyValue(parsed.requestAuthorId, 160) || undefined,
      agentSubjectMetadata: agentSubjectMetadata || undefined,
      computerTaskStatus: normalizeComputerTaskOutcomeStatus(parsed.computerTaskStatus),
      computerHandoff: parsed.computerHandoff
        ? compactComputerHandoff(parsed.computerHandoff)
        : undefined,
    };
  } catch {
    return null;
  }
}

export type LegacyPersistedChatFallbackMode = 'metadata' | 'text_only';

export type LegacyPersistedChatFallback =
  | {
      content: string;
      mode: 'metadata';
      metadataRoundTrips: true;
      /** Safe to submit. Pending state still waits for the returned DB row to
       * pass `canReleasePendingAfterPersistedChatRoundTrip`. */
      safeToPersist: true;
    }
  | {
      content: string;
      mode: 'text_only';
      metadataRoundTrips: false;
      /** Invalid metadata was removed completely, so this explicit text-only
       * fallback is safe to submit without masquerading as structured data. */
      safeToPersist: true;
    };

const LEGACY_LINEAGE_ID_MAX = 96;
const LEGACY_SOURCE_VALUE_MAX = 80;

function boundedLegacyValue(value: unknown, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, max) : null;
}

function fitPersistedTextToBudget(value: string, maxChars: number): string {
  const budget = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 0;
  if (value.length <= budget) return value;
  if (budget === 0) return '';
  const marker = '\n\n[truncated for saved chat]';
  if (budget <= marker.length) return value.slice(0, budget);
  return `${value.slice(0, budget - marker.length).trimEnd()}${marker}`;
}

function buildLegacyMetadataEnvelope(
  metadata: PersistedChatBotMetadata,
): PersistedChatBotMetadata | null {
  const routing = metadata.routing as Record<string, unknown> | null | undefined;
  const localMessageId = boundedLegacyValue(metadata.localMessageId, LEGACY_LINEAGE_ID_MAX);
  const runId = boundedLegacyValue(
    metadata.runId
      || metadata.computerHandoff?.runId
      || metadata.computerFindings?.runId,
    LEGACY_LINEAGE_ID_MAX,
  );
  const requestId = boundedLegacyValue(
    metadata.requestId
      || routing?.requestId
      || routing?.request_id,
    LEGACY_LINEAGE_ID_MAX,
  );
  const requestAuthorId = boundedLegacyValue(
    metadata.requestAuthorId,
    LEGACY_LINEAGE_ID_MAX,
  );
  const sourceSurface = boundedLegacyValue(metadata.source?.surface, LEGACY_SOURCE_VALUE_MAX);
  const handoffSurface = metadata.computerHandoff?.surface;
  const safeHandoffSurface = handoffSurface === 'browser'
    || handoffSurface === 'desktop'
    || handoffSurface === 'local_files'
    || handoffSurface === 'computer'
    ? handoffSurface
    : null;
  const handoffStatus = normalizeComputerTaskOutcomeStatus(metadata.computerHandoff?.outcomeStatus);
  const handoffReplayPolicy = metadata.computerHandoff?.replayPolicy === 'manual_verify_only'
    ? 'manual_verify_only'
    : 'normal';
  const handoffMutationDispatched = handoffReplayPolicy === 'manual_verify_only'
    && metadata.computerHandoff?.mutationDispatched === true;
  const handoffVerificationOnlyTools = handoffMutationDispatched
    ? (metadata.computerHandoff?.verificationOnlyTools || [])
        .filter((tool) => tool === 'desktop.photoshop_document_status' || tool === 'desktop.window_state')
        .slice(0, 2)
    : [];
  const compactSignal = compactOutcomeSignal(metadata.outcomeSignal);
  const computerTaskStatus = normalizeComputerTaskOutcomeStatus(metadata.computerTaskStatus)
    || handoffStatus
    || (sourceSurface === 'main_chat_computer_task' && compactSignal?.verdict === 'completed'
      ? 'completed'
      : null);
  const handoff = metadata.computerHandoff && safeHandoffSurface
    ? {
        // Deliberately lineage/status only. Never persist task labels, paths,
        // document signals, warnings, or other app-observation text through
        // the emergency 1,000-char compatibility envelope.
        surface: safeHandoffSurface,
        runId: runId || null,
        outcomeStatus: handoffStatus || computerTaskStatus,
        replayPolicy: handoffReplayPolicy,
        mutationDispatched: handoffMutationDispatched,
        verificationOnlyTools: handoffVerificationOnlyTools,
        warningCount: 0,
        blockerCount: 0,
        warnings: [],
        blockers: [],
      } as ChatComputerHandoffMetadata
    : undefined;
  const source = sourceSurface
    ? {
        surface: sourceSurface,
      }
    : undefined;
  const envelope: PersistedChatBotMetadata = {
    localMessageId: localMessageId || undefined,
    runId: runId || undefined,
    requestId: requestId || undefined,
    requestAuthorId: requestAuthorId || undefined,
    source,
    computerTaskStatus,
    computerHandoff: handoff,
    outcomeSignal: compactSignal ? { verdict: compactSignal.verdict } : undefined,
  };
  return hasPersistedMetadata(envelope) ? envelope : null;
}

/**
 * Builds the retry body for deployments that still enforce the historical
 * `messages.content <= 1000` constraint. JSON is assembled before the visible
 * body is trimmed, then parsed again before return; arbitrary string slicing
 * can therefore never leave a metadata marker followed by invalid JSON.
 */
export function buildLegacyPersistedChatFallback(
  content: string,
  maxChars = 1000,
): LegacyPersistedChatFallback {
  const value = String(content || '');
  const cap = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 1000;
  const markerIndex = value.indexOf(BOT_META_MARKER);
  const visibleBase = markerIndex >= 0 ? value.slice(0, markerIndex) : value;
  const metadata = markerIndex >= 0 ? readPersistedChatBotMetadata(value) : null;
  const envelope = metadata ? buildLegacyMetadataEnvelope(metadata) : null;

  if (envelope) {
    const suffix = `${BOT_META_MARKER}${JSON.stringify(envelope)}`;
    const bodyBudget = cap - suffix.length;
    if (bodyBudget >= 0) {
      const candidate = `${fitPersistedTextToBudget(visibleBase, bodyBudget)}${suffix}`;
      const roundTrip = readPersistedChatBotMetadata(candidate);
      const expectedStatus = normalizeComputerTaskOutcomeStatus(envelope.computerTaskStatus);
      const expectedSurface = envelope.source?.surface || null;
      const expectedRunId = envelope.runId || envelope.computerHandoff?.runId || null;
      const expectedRequestId = envelope.requestId || null;
      const expectedRequestAuthorId = envelope.requestAuthorId || null;
      if (
        candidate.length <= cap
        && roundTrip
        && (!expectedStatus || roundTrip.computerTaskStatus === expectedStatus)
        && (!expectedSurface || roundTrip.source?.surface === expectedSurface)
        && (!expectedRunId || roundTrip.runId === expectedRunId || roundTrip.computerHandoff?.runId === expectedRunId)
        && (!expectedRequestId || roundTrip.requestId === expectedRequestId)
        && (!expectedRequestAuthorId || roundTrip.requestAuthorId === expectedRequestAuthorId)
      ) {
        return {
          content: candidate,
          mode: 'metadata',
          metadataRoundTrips: true,
          safeToPersist: true,
        };
      }
    }
  }

  // Invalid/oversized metadata degrades to an explicit marker-free text row.
  // The raw suffix is never exposed as narrative and can never be mistaken for
  // a structured completion after reload.
  return {
    content: fitPersistedTextToBudget(visibleBase, cap),
    mode: 'text_only',
    metadataRoundTrips: false,
    safeToPersist: true,
  };
}

/**
 * Persistence acknowledgement guard used before deleting the recoverable
 * local bot record. The returned DB content must either carry parseable
 * metadata or exactly reflect an explicitly marker-free text-only submission.
 */
export function canReleasePendingAfterPersistedChatRoundTrip(input: {
  submittedContent: string;
  persistedContent: string | null | undefined;
  isBot: boolean;
}): boolean {
  if (!input.isBot) return true;
  const submitted = String(input.submittedContent || '');
  const persisted = String(input.persistedContent || '');
  const submittedHasMetadata = submitted.includes(BOT_META_MARKER);
  const persistedHasMetadata = persisted.includes(BOT_META_MARKER);
  if (!submittedHasMetadata || !persistedHasMetadata) {
    return !submittedHasMetadata && !persistedHasMetadata && persisted === submitted;
  }

  const expected = readPersistedChatBotMetadata(submitted);
  const actual = readPersistedChatBotMetadata(persisted);
  if (!expected || !actual) return false;
  const asPresentString = (value: unknown): string | null => (
    typeof value === 'string' && value.length > 0 ? value : null
  );
  const routingRequestId = (metadata: PersistedChatBotMetadata): string | null => {
    const routing = metadata.routing as Record<string, unknown> | null | undefined;
    return asPresentString(metadata.requestId)
      || asPresentString(routing?.requestId)
      || asPresentString(routing?.request_id);
  };
  const runId = (metadata: PersistedChatBotMetadata): string | null => (
    asPresentString(metadata.runId)
      || asPresentString(metadata.computerHandoff?.runId)
      || asPresentString(metadata.computerFindings?.runId)
  );
  const status = (metadata: PersistedChatBotMetadata): ComputerTaskOutcomeStatus | null => (
    normalizeComputerTaskOutcomeStatus(metadata.computerTaskStatus)
      || normalizeComputerTaskOutcomeStatus(metadata.computerHandoff?.outcomeStatus)
  );
  const replayPolicy = (metadata: PersistedChatBotMetadata): string | null => (
    metadata.computerHandoff?.replayPolicy === 'manual_verify_only'
      ? 'manual_verify_only'
      : null
  );
  const mutationDispatched = (metadata: PersistedChatBotMetadata): boolean | null => (
    metadata.computerHandoff?.mutationDispatched === true ? true : null
  );
  const matchesWhenPresent = <T,>(expectedValue: T | null, actualValue: T | null): boolean => (
    expectedValue === null || actualValue === expectedValue
  );
  const expectedTopLevelRunId = asPresentString(expected.runId);
  const expectedTopLevelRequestId = asPresentString(expected.requestId);
  const expectedRequestAuthorId = asPresentString(expected.requestAuthorId);
  const expectedTopLevelStatus = normalizeComputerTaskOutcomeStatus(expected.computerTaskStatus);

  return matchesWhenPresent(asPresentString(expected.localMessageId), asPresentString(actual.localMessageId))
    && matchesWhenPresent(
      expectedTopLevelRunId || runId(expected),
      expectedTopLevelRunId ? asPresentString(actual.runId) : runId(actual),
    )
    && matchesWhenPresent(
      expectedTopLevelRequestId || routingRequestId(expected),
      expectedTopLevelRequestId ? asPresentString(actual.requestId) : routingRequestId(actual),
    )
    && matchesWhenPresent(
      expectedRequestAuthorId,
      asPresentString(actual.requestAuthorId),
    )
    && matchesWhenPresent(
      expectedTopLevelStatus || status(expected),
      expectedTopLevelStatus
        ? normalizeComputerTaskOutcomeStatus(actual.computerTaskStatus)
        : status(actual),
    )
    && matchesWhenPresent(
      asPresentString(expected.source?.surface),
      asPresentString(actual.source?.surface),
    )
    && matchesWhenPresent(replayPolicy(expected), replayPolicy(actual))
    && matchesWhenPresent(mutationDispatched(expected), mutationDispatched(actual));
}

export function formatPersistedChatBotMessage(
  agentName: string,
  content: string,
  metadata?: PersistedChatBotMetadata,
): string {
  const visibleContent = truncateText(content || '', MAX_PERSISTED_RESPONSE_CHARS);
  const base = `🦢 **${normalizeChatAgentName(agentName)}:** ${visibleContent}`;
  if (!hasPersistedMetadata(metadata)) return base;
  const normalizedMetadata = metadata
    ? {
        ...metadata,
        requestAuthorId: boundedLegacyValue(metadata.requestAuthorId, 160) || undefined,
        agentSubjectMetadata: compactAgentSubjectMetadata(metadata.agentSubjectMetadata),
        recoveryOptions: compactRecoveryOptions(metadata.recoveryOptions, 5),
        recoveryReliability: compactRecoveryReliability(metadata.recoveryReliability),
        computerTaskStatus: normalizeComputerTaskOutcomeStatus(metadata.computerTaskStatus),
        computerHandoff: compactComputerHandoff(metadata.computerHandoff),
        chatAutomationPlanPreview: compactChatAutomationPlanPreview(metadata.chatAutomationPlanPreview),
        computerFindings: compactComputerFindings(metadata.computerFindings),
        bestOfN: compactBestOfNRace(metadata.bestOfN),
        outcomeSignal: compactOutcomeSignal(metadata.outcomeSignal),
      }
    : undefined;

  // The 'tiny' tier now carries the proof-critical design fields (object
  // manifest, operation runbooks, proof review) packed alongside the narrative,
  // so large design tasks persist their evidence instead of dropping it. The
  // narrative-only variant follows as a guaranteed-smaller fallback: if the
  // evidence-bearing tier still exceeds the byte cap, we fall back to today's
  // behavior rather than collapsing straight to no metadata.
  const tinyHandoff = normalizedMetadata?.computerHandoff
    ? compactComputerHandoff(normalizedMetadata.computerHandoff, 'tiny')
    : undefined;
  const legacyLineageEnvelope = normalizedMetadata
    ? buildLegacyMetadataEnvelope(normalizedMetadata)
    : undefined;
  const candidates = [
    normalizedMetadata,
    compactPersistedMetadata(normalizedMetadata),
    minimalPersistedMetadata(normalizedMetadata),
    // 'tiny' tier: narrative + tiny handoff only. Drop the flywheel signal
    // here — it is telemetry, and at this tier we are already trimming to fit
    // the byte cap, so the visible answer wins over the training signal.
    tinyHandoff
      ? { ...minimalPersistedMetadata(normalizedMetadata), computerHandoff: tinyHandoff, outcomeSignal: undefined }
      : undefined,
    tinyHandoff
      ? {
          ...minimalPersistedMetadata(normalizedMetadata),
          outcomeSignal: undefined,
          computerHandoff: {
            ...tinyHandoff,
            designObjectManifest: null,
            designOperationRunbooks: null,
            designProofReview: null,
          },
        }
      : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate || !hasPersistedMetadata(candidate)) continue;
    const message = `${base}${BOT_META_MARKER}${JSON.stringify(candidate)}`;
    if (message.length <= MAX_PERSISTED_BOT_MESSAGE_CHARS) return message;
  }

  // WI-4/WI-5 last-ditch: nothing above fit with metadata attached, but the
  // findings are the anchor for "book option 2" and must survive. Persist ONLY
  // the findings (+ ids), trimming the visible body if needed to make room, so
  // the follow-up seam never loses its durable options.
  const findingsOnly = normalizedMetadata?.computerFindings;
  if (findingsOnly && hasPersistedMetadata({ computerFindings: findingsOnly })) {
    const findingsMeta: PersistedChatBotMetadata = {
      localMessageId: normalizedMetadata?.localMessageId,
      requestAuthorId: normalizedMetadata?.requestAuthorId,
      source: normalizedMetadata?.source,
      agentSubjectMetadata: normalizedMetadata?.agentSubjectMetadata,
      computerFindings: findingsOnly,
    };
    const suffix = `${BOT_META_MARKER}${JSON.stringify(findingsMeta)}`;
    const bodyBudget = MAX_PERSISTED_BOT_MESSAGE_CHARS - suffix.length;
    if (bodyBudget > 0) {
      const trimmedBase = base.length <= bodyBudget ? base : truncateText(base, bodyBudget);
      const message = `${trimmedBase}${suffix}`;
      if (message.length <= MAX_PERSISTED_BOT_MESSAGE_CHARS) return message;
    }
  }

  // Canonical app handoffs can still make every richer tier exceed the
  // 9,000-char row budget even after the visible answer is capped. Keep the
  // privacy-bounded lineage/status envelope as the final structured fallback,
  // after durable findings have had their dedicated chance to fit.
  if (legacyLineageEnvelope && hasPersistedMetadata(legacyLineageEnvelope)) {
    const suffix = `${BOT_META_MARKER}${JSON.stringify(legacyLineageEnvelope)}`;
    const bodyBudget = MAX_PERSISTED_BOT_MESSAGE_CHARS - suffix.length;
    if (bodyBudget > 0) {
      const trimmedBase = base.length <= bodyBudget ? base : truncateText(base, bodyBudget);
      const message = `${trimmedBase}${suffix}`;
      if (message.length <= MAX_PERSISTED_BOT_MESSAGE_CHARS) return message;
    }
  }

  return truncateText(base, MAX_PERSISTED_BOT_MESSAGE_CHARS);
}
