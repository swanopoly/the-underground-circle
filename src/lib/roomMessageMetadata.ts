import type { SwanBotStructuredArtifact } from './swanbot';
import type { BrowserPlanCardData, BrowserPlanEvent } from './computerUse';
import type { PromptMemoryReference } from './memoryService';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { OpenSwanToolEvent } from './openswanSessionRuntime';
import type { OpenSwanTaskPlan } from './openswanTaskPlanner';
import type { OpenSwanVerificationResult } from './openswanVerificationRuntime';

type RoomAgentStructuredPayload = {
  usage?: { model?: string | null } | null;
  runId?: string | null;
  taskPlan?: OpenSwanTaskPlan;
  toolEvents?: OpenSwanToolEvent[];
  verificationResults?: OpenSwanVerificationResult[];
  delegatedSubagents?: string[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
  memoriesUsed?: string[];
  memoryReferences?: PromptMemoryReference[];
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints: string[];
    blockers: string[];
  } | null;
  observedEval?: OpenSwanObservedEvalSummary | null;
  routing?: {
    provider_routed?: string;
    provider_model?: string;
    routing_fallback?: { provider: string; reason: string };
  };
};

// ─── Persistence-boundary bounds + secret scrub ──────────────────────────────
//
// This module is the ONLY place room agent output becomes `room_messages.metadata`,
// and every circle member can SELECT that row. Tool events carry raw `input`
// (arbitrary tool args — may include fetched credentials) and `result` (arbitrary
// tool output — file contents, screenshots, command stdout), and the OpenSwan
// turn result places NO bound on array length or string size. Storing those
// verbatim is the same unbounded-verbatim-field class the chat side already fixed
// (`persistedChatMetadata.ts` slices + `truncateText`s tool events and drops raw
// input; `chatComputerHandoffContext.ts` bounds its persisted summaries). Mirror
// that policy here so a tool-heavy room turn can't persist an oversized row or a
// secret-bearing blob. Fail closed: unknown-shaped input degrades to a bounded,
// scrubbed string rather than being trusted.

// Live-credential-shaped substrings. Kept in lockstep with the scrub regexes in
// `approvalIntentPreview.ts` / `messagingNotify.ts` — anything they redact we
// redact too, since this is a peer persistence/egress boundary.
const SECRET_VALUE_RE =
  /\b(?:sk-ant-[A-Za-z0-9._\-]{16,}|sk-[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._\-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|AIza[0-9A-Za-z._\-]{20,}|hf_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9._\-]{16,}\.[A-Za-z0-9._\-]{8,}\.[A-Za-z0-9._\-]{8,})/g;
const SECRET_KEYED_RE =
  /\b(?:api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key|refresh[_-]?token|private[_-]?key|credential|authorization)\b\s*[:=]\s*["']?[A-Za-z0-9._\-/+]{6,}["']?/gi;
const SECRET_REDACTION = '[redacted]';

const TOOL_EVENT_MAX = 16;
const VERIFICATION_MAX = 12;
const BROWSER_PLAN_MAX = 4;
const BROWSER_PLAN_EVENT_MAX = 24;
const MEMORY_REF_MAX = 24;
const MEMORY_USED_MAX = 24;
const DELEGATED_MAX = 12;
const SUMMARY_MAX = 700;
const LINE_MAX = 240;

function scrubSecrets(value: string): string {
  return value.replace(SECRET_VALUE_RE, SECRET_REDACTION).replace(SECRET_KEYED_RE, SECRET_REDACTION);
}

/** Bound + secret-scrub any string that lands in the persisted row. */
function boundedText(value: unknown, max = SUMMARY_MAX): string {
  const raw = typeof value === 'string' ? value : value == null ? '' : String(value);
  const scrubbed = scrubSecrets(raw.replace(/\r/g, '')).trim();
  return scrubbed.length <= max ? scrubbed : `${scrubbed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function boundedStringList(value: unknown, max: number, itemMax = LINE_MAX): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, max)
    .map((entry) => boundedText(entry, itemMax));
}

/**
 * Compact a tool event for persistence: keep the readable/queryable fields,
 * DROP raw `input` (may carry fetched credentials) and DROP raw `result`
 * (arbitrary, unbounded output) — the human-readable `summary` is bounded and
 * scrubbed instead. Exact parity with the chat-side policy.
 */
function compactToolEvent(event: OpenSwanToolEvent): {
  tool: string;
  status: OpenSwanToolEvent['status'];
  summary: string;
} {
  return {
    tool: boundedText(event?.tool, LINE_MAX),
    status: event?.status,
    summary: boundedText(event?.summary, SUMMARY_MAX),
  };
}

/**
 * Compact a browser plan for persistence: bound the free-text `task`/action
 * fields (untrusted — derived from the model's plan) and cap `actions`. Mirrors
 * the chat-side browser-plan compaction so a large staged plan can't blow the row.
 */
function compactBrowserPlan(plan: BrowserPlanCardData): Record<string, unknown> {
  const p = plan as unknown as Record<string, any>;
  return {
    planId: p.planId,
    task: boundedText(p.task, 500),
    backend: p.backend,
    backendLabel: p.backendLabel,
    requiresApproval: p.requiresApproval,
    recommendedPermission: p.recommendedPermission,
    status: p.status,
    launchedAt: p.launchedAt,
    completedAt: p.completedAt,
    backendSessionId: p.backendSessionId,
    backendLiveUrl: p.backendLiveUrl,
    actions: Array.isArray(p.actions)
      ? p.actions.slice(0, 10).map((action: any) => ({
          id: action?.id,
          type: action?.type,
          target: typeof action?.target === 'string' ? boundedText(action.target, LINE_MAX) : action?.target,
          value: typeof action?.value === 'string' ? boundedText(action.value, 160) : action?.value,
          description: typeof action?.description === 'string' ? boundedText(action.description, 300) : action?.description,
          requiresApproval: action?.requiresApproval,
          approvalReason: action?.approvalReason,
          blockedReason: action?.blockedReason,
        }))
      : [],
  };
}

function compactBrowserPlanEvent(event: BrowserPlanEvent): Record<string, unknown> {
  const e = event as unknown as Record<string, any>;
  return {
    id: e.id,
    planId: e.planId,
    kind: e.kind,
    at: e.at,
    summary: e.summary ? boundedText(e.summary, LINE_MAX) : e.summary,
  };
}

function compactVerificationResult(result: OpenSwanVerificationResult): Record<string, unknown> {
  const r = result as unknown as Record<string, unknown>;
  return {
    check: r.check,
    status: r.status,
    ok: r.ok,
    executed: r.executed,
    summary: boundedText(r.summary, SUMMARY_MAX),
    command: r.command ? boundedText(r.command, 500) : undefined,
    stdout: r.stdout ? boundedText(r.stdout, 500) : undefined,
    stderr: r.stderr ? boundedText(r.stderr, 500) : undefined,
    error: r.error ? boundedText(r.error, 500) : undefined,
  };
}

/**
 * Bound the free-text + array fields of the task plan without dropping the
 * structured sub-objects the room task card may render. The plan `summary` is
 * model-authored and otherwise unbounded; `verification` / `recommendedTools`
 * are list fields that grow with task complexity. Everything else is preserved
 * as-is (spread) so the card keeps working.
 */
function compactTaskPlan(plan: OpenSwanTaskPlan | undefined): OpenSwanTaskPlan | undefined {
  if (!plan || typeof plan !== 'object') return plan;
  const p = plan as unknown as Record<string, any>;
  return {
    ...(plan as any),
    summary: boundedText(p.summary, 800),
    verification: Array.isArray(p.verification) ? p.verification.slice(0, 12) : p.verification,
    recommendedTools: Array.isArray(p.recommendedTools) ? p.recommendedTools.slice(0, 12) : p.recommendedTools,
  } as OpenSwanTaskPlan;
}

export function buildRoomAgentMessageMetadata(
  structured: RoomAgentStructuredPayload,
  artifacts: SwanBotStructuredArtifact[],
): Record<string, unknown> {
  // When the call routed through a marketplace integration, surface the
  // actual provider model in the chip metadata (e.g. "openrouter/openai/gpt-5")
  // so the team sees "the model you picked actually answered" instead of
  // a generic Sonnet stand-in. Falls back to the usage-reported model
  // (the raw upstream id) if no marketplace routing happened.
  const routing = structured.routing;
  const routedModel = routing?.provider_routed && routing?.provider_model
    ? `${routing.provider_routed === 'hugging_face' ? 'huggingface' : routing.provider_routed}/${routing.provider_model}`
    : null;

  const toolEvents = Array.isArray(structured.toolEvents)
    ? structured.toolEvents.slice(-TOOL_EVENT_MAX).map(compactToolEvent)
    : [];
  const verificationResults = Array.isArray(structured.verificationResults)
    ? structured.verificationResults.slice(-VERIFICATION_MAX).map(compactVerificationResult)
    : [];

  return {
    bot: true,
    bot_name: 'Agent',
    model: routedModel || structured.usage?.model || null,
    // Artifacts are user-authored/agent-authored content shown in the room; the
    // room render already treats them as content. They are not bounded here to
    // avoid corrupting code patches, but the row as a whole stays compact
    // because the unbounded tool traces below are the actual size risk.
    artifacts,
    artifact_count: artifacts.length,
    run_id: structured.runId ? boundedText(structured.runId, LINE_MAX) : null,
    task_plan: compactTaskPlan(structured.taskPlan),
    tool_events: toolEvents,
    verification_results: verificationResults,
    delegated_subagents: boundedStringList(structured.delegatedSubagents, DELEGATED_MAX),
    browserPlans: Array.isArray(structured.browserPlans)
      ? structured.browserPlans.slice(0, BROWSER_PLAN_MAX).map(compactBrowserPlan)
      : [],
    browserPlanEvents: Array.isArray(structured.browserPlanEvents)
      ? structured.browserPlanEvents.slice(-BROWSER_PLAN_EVENT_MAX).map(compactBrowserPlanEvent)
      : [],
    memories_used: boundedStringList(structured.memoriesUsed, MEMORY_USED_MAX),
    memory_references: Array.isArray(structured.memoryReferences)
      ? structured.memoryReferences.slice(0, MEMORY_REF_MAX)
      : [],
    modeOutcomeSummary: structured.modeOutcomeSummary
      ? {
          headline: boundedText(structured.modeOutcomeSummary.headline, LINE_MAX),
          bulletPoints: boundedStringList(structured.modeOutcomeSummary.bulletPoints, 8),
          blockers: boundedStringList(structured.modeOutcomeSummary.blockers, 8),
        }
      : null,
    observedEval: structured.observedEval || null,
    routing: structured.routing || null,
  };
}
