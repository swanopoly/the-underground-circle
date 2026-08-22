// chatMessageTypes — shared chat message type declarations (decomposition U0).
//
// SINGLE SOURCE OF TRUTH: these types were previously declared inline in
// `src/screens/circles/tabs/ChatTab.tsx`; that file now imports them from here
// (no local mirror remains). They are the linchpin the decomposition plan
// (docs/CHATTAB_OPENSWANCONSOLE_DECOMPOSITION_PLAN.md, unit U0) needs before the
// message-coupled cores (U5, U12, and 3 U2 helpers) can be extracted.
//
// PURITY: this module uses `import type` only — every referenced type is erased
// at compile time, so nothing here pulls in react-native / supabase / deno and
// the file stays tsx-loadable for its smoke. The runtime helpers below are pure,
// total (never throw on null/undefined/hostile/cyclic input), bounded, and
// secret-safe. No `Date.now()` / `Math.random()` at module scope.

import type { SwanBotStructuredArtifact, SwanBotStructuredResponse } from './swanbot';
import type { WikiArticleReference } from './wikiData';
import type { ResearchDocumentReference } from './researchControl';
import type { PromptMemoryReference, OpenSwanMemoryRecommendation } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import type { AgentPlanDraft } from './agentPlanMode';
import type { BrowserPlanCardData, BrowserPlanEvent, BrowserSessionRecord } from './computerUse';
import type { ChatFailureRecoveryOption } from './chatFailureRecovery';
import type {
  PersistedChatBotMetadata,
  PersistedChatRecoveryReliabilitySummary,
  PersistedComputerFindings,
  PersistedBestOfNRace,
  PersistedOpenSwanMultiActionCompletion,
  PersistedOpenSwanTerminal,
} from './persistedChatMetadata';
import type { OpenSwanResumeLocator } from './toolLoopResume';
import type { ChatComputerHandoffMetadata } from './chatComputerHandoffContext';
import type { ChatAutomationPlanPreview } from './chatAutomationPlanPreview';
import type { ChatOutcomeVerdict, ChatUserSignal } from './chatOutcomeSignals';
import type { CrossSurfaceFollowup } from './crossSurfaceFollowupCore';
import type { SurfaceReferenceMatch } from './crossSurfaceReferenceResolverCore';
import type { OpenSwanTaskPlan } from './openswanTaskPlanner';
import type { OpenSwanToolEvent } from './openswanToolRuntime';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';
import type { AutomationProposal } from './automationChatBuilder';
import type { AgentRuntimeSubjectMetadata } from './agentRuntimeSubject';
import type { BridgeProbeResult } from './bridgeHealthDiag';
import type { PreflightBlockerItem } from '../screens/circles/tabs/chat/PreflightBlockersCard';
import type { SearchResultRow } from '../screens/circles/tabs/chat/SearchResultsCard';
import type { AssignPickerAgent } from '../screens/circles/tabs/chat/AssignPickerCard';
import type { ComputerTaskOutcomeStatus } from './computerTaskOutcome';
import type { ConnectedAgentHandoffSnapshot } from './connectedAgentHandoffCore';

// ─── Types (moved verbatim from ChatTab.tsx) ─────────────────────────────────

export type ChatMessageSource = {
  actor?: string;
  surface?: string;
  selectedModel?: string | null;
  effectiveModel?: string | null;
  provider?: string | null;
  showRouteChips?: boolean;
};

export type ChatMessage = {
  id: string;
  content: string;
  isBot: boolean;
  isUser: boolean;
  userName?: string;
  /** Stable database row author id, including persisted bot envelopes. */
  authorId?: string | null;
  timestamp: Date;
  reactions: Record<string, string[]>;
  replyTo?: { name: string; content: string } | null;
  dbId?: string;
  isCheckIn?: boolean;
  isAchievement?: boolean;
  artifacts?: SwanBotStructuredArtifact[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  // Memory indicators
  memoriesSaved?: string[];   // titles of memories extracted from this exchange
  memoriesUsed?: string[];    // titles of memories that informed this response
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  source?: ChatMessageSource;
  /** Mounted-only guidance is excluded from persistence, recovery, and model/memory history. */
  durability?: 'transcript' | 'ephemeral';
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
  /** Durable accepted/drafted/failed handoff identity; never task completion. */
  connectedAgentHandoff?: ConnectedAgentHandoffSnapshot | null;
  /** Durable enum-only OpenSwan outcome. Resumability alone never enables a
   * chip; only an exact locally-resolved openSwanResumeLocator is actionable. */
  openSwanTerminal?: PersistedOpenSwanTerminal | null;
  /** Value-free pointer to one exact local OpenSwan checkpoint event. */
  openSwanResumeLocator?: OpenSwanResumeLocator | null;
  /** Value-free A1-A3 completion snapshot; raw evidence remains runtime-only. */
  openSwanMultiActionCompletion?: PersistedOpenSwanMultiActionCompletion | null;
  usage?: SwanBotStructuredResponse['usage'];
  executionStream?: OpenSwanExecutionContract[];
  agentPlan?: AgentPlanDraft | Record<string, unknown>;
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: ChatFailureRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  computerTaskStatus?: ComputerTaskOutcomeStatus | null;
  computerHandoff?: ChatComputerHandoffMetadata;
  chatAutomationPlanPreview?: ChatAutomationPlanPreview | null;
  computerPreflightBlockers?: { task: string; items: PreflightBlockerItem[] };
  /** Structured browser-run findings (bounded) persisted on the completion
   *  message so "book option N" follow-ups can resolve durably after reload. */
  computerFindings?: PersistedComputerFindings | null;
  /** Best-of-N race results (bounded) — interactive adopt/race-again card. */
  bestOfN?: PersistedBestOfNRace | null;
  /** Flywheel telemetry (Cursor-Tab precedent): machine-derived outcome
   *  verdict + the user's accept/reject/edit-resend/steer signal, persisted as
   *  tiny enums so it becomes BlackSwan training data. See chatOutcomeSignals. */
  outcomeSignal?: { verdict: ChatOutcomeVerdict; signal?: ChatUserSignal; lane?: string; model?: string } | null;
  quickReplies?: string[];    // tappable suggested replies (e.g. clarification answers)
  /** Optional kicker above the quickReplies chips (defaults to "Tap to answer"
   *  in QuickReplyChips). Session-local only — never persisted. */
  quickRepliesLabel?: string;
  /** Cross-surface follow-up chips (create Feed task / open run / approve /
   *  retry) derived at finalize time by crossSurfaceFollowupCore. NOT
   *  persisted — cheap to re-derive and keeps message rows bounded. */
  crossSurfaceFollowups?: CrossSurfaceFollowup[];
  /** Jump-to chips for entities the USER's own message referenced ("open the
   *  Acme mission"), resolved fire-and-forget against the circle snapshot by
   *  crossSurfaceReferenceResolverCore. Transient — NOT persisted (the
   *  user-row persist sends explicit fields only), gone on reload. */
  referenceChips?: SurfaceReferenceMatch[];
  delegatedTo?: string;       // subagent that handled this message
  delegatedSubagents?: string[];
  runId?: string | null;
  /** Immutable provider/client request lineage when a turn spans run ids. */
  requestId?: string | null;
  /** Stable human requester for this bot turn. Unlike nearest-message
   *  inference, this remains correct when multiple circle members interleave. */
  requestAuthorId?: string | null;
  /** Exact persisted user-message row that originated this bot run. Value-free
   *  lineage for reload ownership; never inferred from transcript adjacency. */
  requestSourceMessageId?: string | null;
  /** Last complete parsed envelope. Sync paths merge into this snapshot so a
   *  small reaction/status update cannot erase metadata not rendered in UI. */
  persistedMetadataSnapshot?: PersistedChatBotMetadata | null;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  routing?: SwanBotStructuredResponse['routing'];
  /** Automation proposal parsed from a natural-language request like
   *  "every Friday at 5pm post a weekly summary". When present, the
   *  message renders an AutomationProposalCard with a CREATE button. */
  automationProposal?: AutomationProposal;
  /** Agent subject snapshot used when the proposal is accepted later. */
  automationAgentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
  /** Search results from `/search <query>`. Renders as a clickable
   *  list with JUMP buttons per row. */
  searchResults?: { query: string; rows: SearchResultRow[] };
  /** When true, render the structured `/help` panel under this
   *  message — interactive, filterable, click-to-insert. */
  commandsHelp?: boolean;
  /** Live agents to render under a /assign picker. */
  assignPickerAgents?: AssignPickerAgent[];
  /** Bridge probe results to render under a /diag card. */
  bridgeDiagResults?: BridgeProbeResult[];
  /** When true and runId is set, render a live RunTraceCard under
   *  this message that subscribes to agent_run_steps in real time. */
  showRunTrace?: boolean;
  isPending?: boolean;
};

export type ChatBotMessageExtra = {
  delegatedTo?: string;
  delegatedSubagents?: string[];
  connectedAgentHandoff?: ConnectedAgentHandoffSnapshot | null;
  openSwanTerminal?: PersistedOpenSwanTerminal | null;
  openSwanResumeLocator?: OpenSwanResumeLocator | null;
  openSwanMultiActionCompletion?: PersistedOpenSwanMultiActionCompletion | null;
  memoriesUsed?: string[];
  memoryRefs?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  executionStream?: OpenSwanExecutionContract[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  browserSessions?: BrowserSessionRecord[];
  recoveryOptions?: ChatFailureRecoveryOption[];
  recoveryReliability?: PersistedChatRecoveryReliabilitySummary | null;
  computerTaskStatus?: ComputerTaskOutcomeStatus | null;
  computerHandoff?: ChatComputerHandoffMetadata;
  chatAutomationPlanPreview?: ChatAutomationPlanPreview | null;
  computerPreflightBlockers?: { task: string; items: PreflightBlockerItem[] };
  computerFindings?: PersistedComputerFindings | null;
  bestOfN?: PersistedBestOfNRace | null;
  quickReplies?: string[];
  /** Optional kicker above the quickReplies chips (see ChatMessage). */
  quickRepliesLabel?: string;
  localOnly?: boolean;
  /**
   * Transcript rows survive refresh and sync to other clients. Ephemeral rows
   * are mounted UI guidance only (greetings, routing hints, progress notices)
   * and must never enter pending recovery, Supabase, session archives, or
   * memory extraction. `localOnly` controls surface behavior, not durability.
   */
  durability?: 'transcript' | 'ephemeral';
  runId?: string | null;
  /**
   * Typed non-terminal lanes (for example, a connected-agent bridge that only
   * accepted a task) may override generic clean-text inference. Runtime-owned
   * computer/browser terminal states still take precedence in ChatTab.
   */
  outcomeVerdict?: ChatOutcomeVerdict;
  requestId?: string | null;
  requestAuthorId?: string | null;
  /** Exact persisted user-message row that originated this bot run. */
  requestSourceMessageId?: string | null;
  /**
   * followup-chips: set true by error-path callers so the outcome verdict can
   * reach 'failed' (deriveOutcomeVerdict) independently of recoveryOptions —
   * without it the retry_run chip's emission condition (failed/partial +
   * canRetry) was exactly its suppression condition (recoveryOptions present)
   * and the chip was provably unreachable.
   */
  hadError?: boolean;
  agentPlan?: AgentPlanDraft | Record<string, unknown>;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  wikiRefs?: WikiArticleReference[];
  researchRefs?: ResearchDocumentReference[];
  automationProposal?: AutomationProposal;
  automationAgentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
  searchResults?: { query: string; rows: SearchResultRow[] };
  commandsHelp?: boolean;
  assignPickerAgents?: AssignPickerAgent[];
  bridgeDiagResults?: BridgeProbeResult[];
  showRunTrace?: boolean;
  routing?: SwanBotStructuredResponse['routing'];
  source?: ChatMessageSource;
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
  usage?: SwanBotStructuredResponse['usage'] | null;
};

// ─── Pure runtime helpers (tsx-loadable; total; bounded; never throw) ─────────

const MAX_REACTION_EMOJIS = 128;
const MAX_MODEL_LABEL_LEN = 200;

/** Narrow to a non-null, non-array plain object without throwing on hostile
 *  inputs (primitives, arrays, null all return null). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Read a property without ever throwing — guards against Proxy getter traps. */
function safeGet(rec: Record<string, unknown> | null, key: string): unknown {
  if (!rec) return undefined;
  try {
    return rec[key];
  } catch {
    return undefined;
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * Structural guard for a {@link ChatMessage}: the six non-optional fields
 * (`id`, `content`, `isBot`, `isUser`, `timestamp`, `reactions`) must be
 * present and correctly typed. Extra optional fields are never validated.
 */
export function isChatMessage(value: unknown): value is ChatMessage {
  const rec = asRecord(value);
  if (!rec) return false;
  if (typeof safeGet(rec, 'id') !== 'string') return false;
  if (typeof safeGet(rec, 'content') !== 'string') return false;
  if (typeof safeGet(rec, 'isBot') !== 'boolean') return false;
  if (typeof safeGet(rec, 'isUser') !== 'boolean') return false;
  if (!(safeGet(rec, 'timestamp') instanceof Date)) return false;
  if (asRecord(safeGet(rec, 'reactions')) === null) return false;
  return true;
}

/** True when `value` is a {@link ChatMessage} authored by the bot/agent. */
export function isChatBotMessage(value: unknown): value is ChatMessage {
  if (!isChatMessage(value)) return false;
  return safeGet(asRecord(value), 'isBot') === true;
}

/** True when `value` is a {@link ChatMessage} authored by a human user. */
export function isChatUserMessage(value: unknown): value is ChatMessage {
  if (!isChatMessage(value)) return false;
  return safeGet(asRecord(value), 'isUser') === true;
}

/**
 * Shape guard for {@link ChatMessageSource}. Every field is optional, so any
 * plain object whose present fields carry the right type qualifies — including
 * the empty object `{}`.
 */
export function isChatMessageSource(value: unknown): value is ChatMessageSource {
  const rec = asRecord(value);
  if (!rec) return false;
  const actor = safeGet(rec, 'actor');
  if (actor !== undefined && typeof actor !== 'string') return false;
  const surface = safeGet(rec, 'surface');
  if (surface !== undefined && typeof surface !== 'string') return false;
  const showRouteChips = safeGet(rec, 'showRouteChips');
  if (showRouteChips !== undefined && typeof showRouteChips !== 'boolean') return false;
  const selectedModel = safeGet(rec, 'selectedModel');
  if (selectedModel !== undefined && selectedModel !== null && typeof selectedModel !== 'string') return false;
  const effectiveModel = safeGet(rec, 'effectiveModel');
  if (effectiveModel !== undefined && effectiveModel !== null && typeof effectiveModel !== 'string') return false;
  const provider = safeGet(rec, 'provider');
  if (provider !== undefined && provider !== null && typeof provider !== 'string') return false;
  return true;
}

/**
 * Shape guard for {@link ChatBotMessageExtra}. Every field is optional; a few
 * representative typed fields are validated when present so obviously-wrong
 * payloads are rejected.
 */
export function isChatBotMessageExtra(value: unknown): value is ChatBotMessageExtra {
  const rec = asRecord(value);
  if (!rec) return false;
  const localOnly = safeGet(rec, 'localOnly');
  if (localOnly !== undefined && typeof localOnly !== 'boolean') return false;
  const durability = safeGet(rec, 'durability');
  if (durability !== undefined && durability !== 'transcript' && durability !== 'ephemeral') return false;
  const runId = safeGet(rec, 'runId');
  if (runId !== undefined && runId !== null && typeof runId !== 'string') return false;
  const requestId = safeGet(rec, 'requestId');
  if (requestId !== undefined && requestId !== null && typeof requestId !== 'string') return false;
  const commandsHelp = safeGet(rec, 'commandsHelp');
  if (commandsHelp !== undefined && typeof commandsHelp !== 'boolean') return false;
  const showRunTrace = safeGet(rec, 'showRunTrace');
  if (showRunTrace !== undefined && typeof showRunTrace !== 'boolean') return false;
  return true;
}

/** Safe `id` read → `''` when absent or malformed. */
export function getChatMessageId(value: unknown): string {
  const id = safeGet(asRecord(value), 'id');
  return typeof id === 'string' ? id : '';
}

/** Safe `content` read → `''` when absent or malformed (passthrough, unbounded). */
export function getChatMessageText(value: unknown): string {
  const content = safeGet(asRecord(value), 'content');
  return typeof content === 'string' ? content : '';
}

/** True when the message carries at least one structured artifact. */
export function chatMessageHasArtifacts(value: unknown): boolean {
  const artifacts = safeGet(asRecord(value), 'artifacts');
  return Array.isArray(artifacts) && artifacts.length > 0;
}

/** True when the message is a still-streaming / optimistic pending row. */
export function isPendingChatMessage(value: unknown): boolean {
  return safeGet(asRecord(value), 'isPending') === true;
}

/** True when the message's source opts into visible route chips. */
export function chatMessageShowsRouteChips(value: unknown): boolean {
  const source = asRecord(safeGet(asRecord(value), 'source'));
  return safeGet(source, 'showRouteChips') === true;
}

/**
 * Best-effort model label from a {@link ChatMessageSource}: prefers the
 * effective model, then the selected model. Bounded (≤200 chars) and
 * secret-free (model ids only, no keys).
 */
export function chatMessageSourceModelLabel(value: unknown): string {
  const rec = asRecord(value);
  if (!rec) return '';
  const effective = safeGet(rec, 'effectiveModel');
  if (typeof effective === 'string' && effective.trim()) return truncate(effective.trim(), MAX_MODEL_LABEL_LEN);
  const selected = safeGet(rec, 'selectedModel');
  if (typeof selected === 'string' && selected.trim()) return truncate(selected.trim(), MAX_MODEL_LABEL_LEN);
  return '';
}

/** Provider token from a {@link ChatMessageSource} → `''` when absent. */
export function chatMessageSourceProvider(value: unknown): string {
  const provider = safeGet(asRecord(value), 'provider');
  return typeof provider === 'string' ? truncate(provider, MAX_MODEL_LABEL_LEN) : '';
}

/** Bounded list (≤128) of reaction emoji keys present on a message. */
export function chatMessageReactionEmojis(value: unknown): string[] {
  const reactions = asRecord(safeGet(asRecord(value), 'reactions'));
  if (!reactions) return [];
  let keys: string[];
  try {
    keys = Object.keys(reactions);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const key of keys) {
    if (typeof key === 'string') out.push(key);
    if (out.length >= MAX_REACTION_EMOJIS) break;
  }
  return out;
}

/** Number of reactors for a given emoji on a message → `0` when absent. */
export function chatMessageReactionCount(value: unknown, emoji: unknown): number {
  if (typeof emoji !== 'string') return 0;
  const reactions = asRecord(safeGet(asRecord(value), 'reactions'));
  const list = safeGet(reactions, emoji);
  return Array.isArray(list) ? list.length : 0;
}

/** Number of memory references attached to a message → `0` when absent. */
export function countChatMessageMemoryRefs(value: unknown): number {
  const refs = safeGet(asRecord(value), 'memoryRefs');
  return Array.isArray(refs) ? refs.length : 0;
}
