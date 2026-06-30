/**
 * Subagent Registry — Specialist agents that the main agent can delegate to.
 *
 * Each subagent has a role, system prompt, allowed tools, and model preference.
 * The orchestrator routes tasks to the best specialist based on intent.
 */

import {
  executeToolUseLoop,
  buildStreamableSystemPrompt,
  type SwanBotContext,
  type SwanBotStructuredArtifact,
  type SwanBotStructuredToolAction,
} from './swanbot';
import { createRun, addStep, mergeRunMetadata, updateRunStatus, type RunSurface } from './agentRunSystem';
import {
  buildSubagentChildRunOptions,
  buildSubagentLoopSummary,
  buildSubagentParentSummary,
  canDelegate,
  isSubagentTypedCoreEnabled,
  runSubagentTypedCoreLoop,
  type SubagentParentSummary,
} from './delegationGate';
import { createPersistedRun, type PersistedRunHandle } from './agentRunPersistence';
import type { AgentEvent, AgentProvider, AgentToolDefinition } from './agentExecutionCore';
import { getOpenSwanToolsForSurface } from './openswanBridge';
import { getOpenSwanToolPolicy, type OpenSwanRuntimeToolContext, type OpenSwanRuntimeToolName } from './openswanToolRuntime';
import { dispatchToolDetailed, MAX_TOOL_ROUNDS } from './openswanTools/index';
import { EDGE_INVOKE_RETRIES, edgeRetryBackoffMs, isRetryableEdgeFailure } from './edgeInvokeRetry';
import { extractAssistantText } from './toolLoopProgress';
import { getFreshAccessToken } from './authSession';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from './privacyMode';
import {
  buildLegacyToolEventFromResult,
  buildLegacyToolLoopResult,
  buildSwanbotToolTurnBody,
  createLegacyRoundNudgeHook,
  needsCapExhaustionFinalization,
  parseSwanbotToolTurnData,
  shapeLegacyToolHandlerResult,
  toAnthropicToolShapes,
  type LegacyToolEvent,
  type LegacyToolLoopResult,
} from './openswanSessionRuntimeAdapters';
import { supabase } from './supabase';
import { logActivity } from '../services/agentActivityLogger';
import type { PromptMemoryReference } from './memoryService';
import type { OpenSwanExecutionContract } from './openswanExecution';
import { stripDesignAppRuntimeCaptureMetadata } from './designAppRuntimeManifest';
import { buildOpenSwanObservedEvalSummary } from './openswanObservedEvals';
import { OPENSWAN_RUNTIME_PLAN_VERSION } from './openswanRuntimePlan';
import { buildOpenSwanMemoryStores } from './openswanMemoryStores';
import { resolveOpenSwanSkills } from './openswanSkills';
import type { OpenSwanTaskPlan, OpenSwanToolName } from './openswanTaskPlanner';
import {
  detectSubagentCapability,
  getSubagentCapability,
  getSubagentCapabilitiesForRoles,
  listSubagentCapabilities,
  type SubagentCapabilityProfile,
  type SubagentRole,
} from './subagentCapabilities';
import { getPluginSubagentRoles } from './pluginRegistry';

// ── Subagent Definitions ────────────────────────────────────────────────────

export interface SubagentProfile {
  role: SubagentRole;
  displayName: string;
  description: string;
  systemPrompt: string;
  modelPreference?: string;
  triggerPatterns: RegExp[];
  icon: string;
  color: string;
  spiritId?: string;
  skillBundleId?: string;
  skills?: string[];
  allowedTools?: string[];
  preferredArtifacts?: string[];
  preferredVerification?: string[];
  preferredTaskKinds?: string[];
  riskTier?: string;
  evidencePosture?: string;
  communicationDensity?: string;
}
function capabilityToProfile(capability: SubagentCapabilityProfile): SubagentProfile {
  return {
    role: capability.role,
    displayName: capability.displayName,
    description: capability.description,
    systemPrompt: capability.systemPrompt,
    modelPreference: capability.modelPreference,
    triggerPatterns: capability.triggerPatterns,
    icon: capability.icon,
    color: capability.color,
    spiritId: capability.spiritId,
    skillBundleId: capability.skillBundleId,
    skills: capability.skills,
    allowedTools: capability.allowedTools,
    preferredArtifacts: capability.preferredArtifacts,
    preferredVerification: capability.preferredVerification,
    preferredTaskKinds: capability.preferredTaskKinds,
    riskTier: capability.riskTier,
    evidencePosture: capability.evidencePosture,
    communicationDensity: capability.communicationDensity,
  };
}

export const SUBAGENTS: SubagentProfile[] = listSubagentCapabilities().map(capabilityToProfile);

const SUBAGENT_SKILL_MAP: Partial<Record<string, string[]>> = {
  'planning.execution': ['summarize_thread'],
  'research.synthesis': ['research_topic', 'summarize_thread'],
  'writing.delivery': ['summarize_thread'],
  'coding.implementation': ['refactor', 'code_explain'],
  'coding.review': ['critique_pr'],
  'coding.architecture': ['refactor', 'code_explain'],
  'coding.debug': ['bug_hunt'],
  'qa.verification': ['test_writer'],
  'support.triage': ['bug_hunt', 'summarize_thread'],
};

function getPreferredSkillNamesForSubagent(subagent: SubagentProfile): string[] {
  return Array.from(new Set((subagent.skills || []).flatMap((skillId) => SUBAGENT_SKILL_MAP[skillId] || [])));
}

function getSubagentModeKey(role: SubagentRole): 'build' | 'review' | 'research' | 'support' | 'plan' {
  if (role === 'reviewer') return 'review';
  if (role === 'researcher') return 'research';
  if (role === 'support') return 'support';
  if (role === 'architect' || role === 'planner' || role === 'designer') return 'plan';
  return 'build';
}

// ── Intent Detection & Routing ──────────────────────────────────────────────

/**
 * Detect which subagent should handle a message.
 * Returns null if no specialist is needed (general conversation).
 */
export function detectSubagent(message: string): SubagentProfile | null {
  const capability = detectSubagentCapability(message);
  return capability ? capabilityToProfile(capability) : null;
}

// ── Delegated Execution ─────────────────────────────────────────────────────

export interface DelegationResult {
  /** Full child response text. Persisted to the Run Ledger for ops
   *  visibility (uncapped). Callers composing the PARENT's next turn
   *  should use `summary` instead so the child's output doesn't blow
   *  up the parent's context window. */
  response: string;
  /**
   * CA-8d summary-only contract: capped (~1200 chars) redacted digest
   * of the child's output, suitable for inclusion in the parent's
   * tool_result / digest. Derived via `redactSubagentOutput`. Falls
   * back to the full `response` only when redaction produces empty
   * output (e.g. child returned nothing — then the parent sees a
   * "no output" marker).
   */
  summary: string;
  /** Tool-call count + completion flag from the redaction payload.
   *  Lets the parent decide whether to accept or retry without
   *  seeing the full trace. */
  summaryMeta: {
    toolCallCount: number;
    completed: boolean;
    inputTokens?: number;
    outputTokens?: number;
  };
  /**
   * O3 summary-only contract: the ONLY shape parent-turn composers should
   * inject into the parent's context — `{ summary, status, runId,
   * tokens {input, output}, toolCallCount }`. Everything else on this
   * result (full `response`, toolActions, artifacts) is for the Run
   * Ledger / UI, never the parent model's context window.
   */
  parentSummary: SubagentParentSummary;
  subagent: SubagentProfile;
  runId?: string;
  artifacts?: SwanBotStructuredArtifact[];
  toolActions?: SwanBotStructuredToolAction[];
  memoryReferences?: PromptMemoryReference[];
  observedEval?: import('./openswanObservedEvals').OpenSwanObservedEvalSummary | null;
  usage?: {
    model?: string;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  /** CA-8d: set when the delegation was blocked by the gate (depth,
   *  concurrency, or O4 daily spend cap). Absent on normal delegations.
   *  Parent agent can read this to decide whether to retry in-line
   *  instead of spawning another subagent. */
  gateRejection?: {
    reason: 'depth_exceeded' | 'concurrency_exceeded' | 'spend_limit_exceeded';
    detail: string;
  };
}

export interface SubagentTaskSpec {
  subagent: SubagentProfile;
  task: string;
  reason: string;
  priority: 'high' | 'medium';
}

type DelegationPlanningOptions = {
  activePluginIds?: string[];
};

function getSubagent(role: string): SubagentProfile | null {
  const capability = getSubagentCapability(role as SubagentRole);
  return capability ? capabilityToProfile(capability) : null;
}

function addSubagentSpec(
  specs: SubagentTaskSpec[],
  role: string,
  task: string,
  reason: string,
  priority: 'high' | 'medium' = 'high',
) {
  const subagent = getSubagent(role);
  if (!subagent) return;
  if (specs.some((entry) => entry.subagent.role === role)) return;
  specs.push({ subagent, task, reason, priority });
}

export function shouldDelegateToSubagents(message: string, taskPlan: OpenSwanTaskPlan): boolean {
  if (taskPlan.kind === 'general') return false;
  if (taskPlan.verification.length >= 3) return true;
  if (/\b(and|also|plus|while|at the same time|simultaneously|parallel|along with)\b/i.test(message)) return true;
  if (message.length > 260) return true;
  return ['build', 'debug', 'architect', 'review', 'research', 'automation'].includes(taskPlan.kind);
}

export function planSubagentDelegation(
  message: string,
  taskPlan: OpenSwanTaskPlan,
  options: DelegationPlanningOptions = {},
): SubagentTaskSpec[] {
  const specs: SubagentTaskSpec[] = [];
  const previewNeeded = taskPlan.verification.some((check) => check.kind === 'preview');
  const testsNeeded = taskPlan.verification.some((check) => check.kind === 'tests');

  switch (taskPlan.kind) {
    case 'build':
      addSubagentSpec(specs, 'architect', `Define the cleanest implementation boundary for this task:\n\n${message}`, 'Set structure before building.');
      addSubagentSpec(specs, 'coder', `Implement the primary solution for this task:\n\n${message}`, 'Produce the main build direction.');
      if (testsNeeded || previewNeeded) {
        addSubagentSpec(specs, 'tester', `Define the verification strategy for this build task:\n\n${message}`, 'Cover preview and regression checks.', 'medium');
      }
      addSubagentSpec(specs, 'reviewer', `Review the likely risks and integration gaps for this implementation:\n\n${message}`, 'Catch issues before final synthesis.', 'medium');
      break;
    case 'debug':
      addSubagentSpec(specs, 'debugger', `Find the most likely root cause and smallest correct fix:\n\n${message}`, 'Isolate the real failure.');
      addSubagentSpec(specs, 'tester', `Define the regression checks for this bug or failure:\n\n${message}`, 'Make the fix provable.');
      addSubagentSpec(specs, 'reviewer', `Review likely regressions or hidden edge cases in this debugging task:\n\n${message}`, 'Catch secondary breakage.', 'medium');
      break;
    case 'architect':
      addSubagentSpec(specs, 'architect', `Design the architecture direction and module boundaries for this task:\n\n${message}`, 'Drive the system shape.');
      addSubagentSpec(specs, 'planner', `Break the architecture work into an implementation sequence:\n\n${message}`, 'Define rollout order.');
      addSubagentSpec(specs, 'reviewer', `Review the proposed architecture for coupling, integration risk, and maintainability:\n\n${message}`, 'Pressure-test the design.', 'medium');
      break;
    case 'review':
      addSubagentSpec(specs, 'reviewer', `Perform the primary review for this request:\n\n${message}`, 'Lead with findings.');
      addSubagentSpec(specs, 'tester', `Identify missing validation or regression coverage in this review request:\n\n${message}`, 'Surface verification gaps.', 'medium');
      if (/\b(security|vulnerab|auth|secret|performance|slow|latency)\b/i.test(message)) {
        addSubagentSpec(specs, 'architect', `Assess structural, security, or performance risks for this review task:\n\n${message}`, 'Look for deeper systemic issues.', 'medium');
      }
      break;
    case 'research':
      addSubagentSpec(specs, 'researcher', `Research the landscape and best options for this request:\n\n${message}`, 'Build the comparison base.');
      addSubagentSpec(specs, 'planner', `Turn the research into a practical execution plan:\n\n${message}`, 'Translate findings into action.', 'medium');
      break;
    case 'automation':
      addSubagentSpec(specs, 'planner', `Plan the automation or orchestration flow for this request:\n\n${message}`, 'Sequence the workflow.');
      addSubagentSpec(specs, 'coder', `Design or draft the automation implementation details for this request:\n\n${message}`, 'Shape the implementation.');
      addSubagentSpec(specs, 'reviewer', `Review the automation for failure modes and integration issues:\n\n${message}`, 'Catch risky edges.', 'medium');
      break;
    default:
      break;
  }

  const pluginRoles = getPluginSubagentRoles(options.activePluginIds || []);
  const pluginCapabilities = getSubagentCapabilitiesForRoles(pluginRoles);
  for (const capability of pluginCapabilities) {
    if (!capability.preferredTaskKinds.includes(taskPlan.kind)) continue;
    addSubagentSpec(
      specs,
      capability.role,
      `Handle the ${capability.displayName} responsibility for this task:\n\n${message}`,
      `Active plugins request ${capability.displayName.toLowerCase()} coverage.`,
      'medium',
    );
  }

  return specs.slice(0, 4);
}

export interface ParallelDelegationResult {
  specs: SubagentTaskSpec[];
  results: DelegationResult[];
}

/**
 * Execute a task via a specialist subagent with full tracking.
 */
// ─── CA-8d helpers (delegation gate wiring) ───────────────────────────────
//
// Depth tracking rides in `agent_runs.metadata.delegationDepth`. Root
// runs leave it absent (treated as 0). Each new child stamps its
// parent's depth + 1. `canDelegate` reads that at spawn time.
//
// In-flight count: a single COUNT against agent_runs scoped to this
// circle where parent_run_id IS NOT NULL AND status = 'running'. Not
// perfectly racy-free (two delegations proposed in the same ms could
// both see the same count) but good enough for a soft cap + an
// observer hook later.

async function readParentDelegationDepth(parentRunId: string | undefined): Promise<number> {
  if (!parentRunId) return 0;
  try {
    const { data } = await supabase
      .from('agent_runs')
      .select('metadata')
      .eq('id', parentRunId)
      .maybeSingle();
    const depth = (data?.metadata as any)?.delegationDepth;
    if (typeof depth === 'number' && Number.isFinite(depth) && depth >= 0) return depth;
    return 0;
  } catch {
    return 0;
  }
}

async function countInFlightDelegations(circleId: string): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('agent_runs')
      .select('id', { count: 'exact', head: true })
      .eq('circle_id', circleId)
      .eq('status', 'running')
      .not('parent_run_id', 'is', null);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}

// O4: spend-limit inputs for the delegation gate. Both reads are
// best-effort — a failed read yields null and the gate skips the spend
// check (budget guard fails open; depth/concurrency still enforce).
// Spend window is the rolling last 24h from `get_claude_usage_summary`,
// which is the closest existing telemetry to "daily".
async function readDelegationSpendContext(
  circleId: string,
): Promise<{ dailySpendUsd: number | null; dailySpendLimitUsd: number | null }> {
  const [spend, limit] = await Promise.all([
    (async () => {
      try {
        const { getClaudeUsageSummary } = await import('./claudeUsage');
        const summary = await getClaudeUsageSummary(circleId, 1);
        return Number.isFinite(summary.total_cost) ? summary.total_cost : null;
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { getCircleMinSpendingLimit } = await import('../services/hitlService');
        return await getCircleMinSpendingLimit(circleId);
      } catch {
        return null;
      }
    })(),
  ]);
  return { dailySpendUsd: spend, dailySpendLimitUsd: limit };
}

/**
 * Build a rejection DelegationResult when the gate blocks a spawn.
 * Parent sees this as a "no-op delegation" with `response` explaining
 * the limit, so the parent can gracefully continue in-line instead of
 * hitting an unhandled error.
 */
function rejectedDelegationResult(
  subagent: SubagentProfile,
  reason: 'depth_exceeded' | 'concurrency_exceeded' | 'spend_limit_exceeded',
  detail: string,
): DelegationResult {
  const response = reason === 'depth_exceeded'
    ? `Subagent delegation blocked — already at the recursion cap. Continuing in-line from the parent. (${detail})`
    : reason === 'spend_limit_exceeded'
      ? `Subagent delegation blocked — the circle's daily spending limit is reached. Continuing in-line from the parent. (${detail})`
      : `Subagent delegation blocked — too many parallel children. Continuing in-line from the parent. (${detail})`;
  return {
    response,
    summary: response, // short enough to pass through verbatim
    summaryMeta: { toolCallCount: 0, completed: false },
    parentSummary: buildSubagentParentSummary({
      payload: { summary: response, toolCallCount: 0, completed: false },
      status: 'blocked',
    }),
    subagent,
    gateRejection: { reason, detail },
  };
}

// ─── O3: typed-core child loop assembly ────────────────────────────────────
//
// The impure half of the O3 migration: assembles bridge tools, the
// swanbot-ai edge transport, and the legacy reliability nudges, then runs
// the child turn through `runSubagentTypedCoreLoop` (delegationGate →
// agentExecutionCore.runAgent). Mirrors the O1 parent migration
// (`openswanSessionRuntime.runTypedCoreToolLoop`) minus the pieces the
// legacy child path never had: NO approval gate (children ran ungated —
// we do not invent new approval UX here), NO MCP tools (T6 is typed-core
// session-runtime only; adding them would WIDEN the child tool surface),
// NO stage emission (children have no UI spinner).

/**
 * Same `swanbot-ai` edge invoke the legacy child loop used (fresh JWT per
 * round + bounded transient retry). Copied minimally from
 * `openswanSessionRuntime.runTypedCoreToolLoop`'s `invokeSwanbotToolTurn`
 * (not exported there; the original lives in `swanbot.executeToolUseLoop`).
 * The invoke is idempotent — it returns the model's next message and tools
 * run client-side after — so a retry can never double-execute a tool.
 */
async function invokeSwanbotChildToolTurn(
  body: Record<string, unknown>,
): Promise<{ data: any; error: any }> {
  let data: any = null;
  let error: any = null;
  for (let attempt = 0; attempt <= EDGE_INVOKE_RETRIES; attempt++) {
    const accessToken = await getFreshAccessToken();
    ({ data, error } = await supabase.functions.invoke('swanbot-ai', {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      body,
    }));
    if (data && !error) break;
    if (attempt < EDGE_INVOKE_RETRIES && isRetryableEdgeFailure({
      hasData: !!data,
      errorName: (error as any)?.name,
      errorMessage: (error as any)?.message,
      status: (error as any)?.context?.status ?? (error as any)?.status,
    })) {
      await new Promise((resolve) => setTimeout(resolve, edgeRetryBackoffMs(attempt)));
      continue;
    }
    break;
  }
  return { data, error };
}

/**
 * Typed-core replacement for the child's `executeToolUseLoop` call.
 * Returns the SAME legacy result shape (`{ response, toolEvents, routing,
 * incomplete, checkpoint, usage }`) so everything downstream in
 * `delegateToSubagent` (runtimeToolActions, run steps, observed eval)
 * stays path-agnostic. Contract parity with the legacy loop:
 *   - strict local-AI mode blocks the anthropic-routed turn up front,
 *   - tool scoping: same surface + allowedToolNames + mode filter the
 *     legacy `getToolDefinitions` applied (children never gain tools),
 *   - zero advertised tools → no model round,
 *   - round cap: MAX_TOOL_ROUNDS (the legacy child passed no override),
 *   - cap exhaustion → one no-tools finalization call + limit note +
 *     progress + resumable checkpoint,
 *   - edge transport failure → partial text + `incomplete`, never a throw.
 */
async function runTypedCoreSubagentToolLoop(args: {
  systemPrompt: string;
  userMessage: string;
  model: string;
  circleId: string;
  userId: string;
  runId?: string;
  activeSoulKey?: string;
  allowedToolNames?: string[];
  surface: 'main_chat' | 'room_chat' | 'task_run';
  mode?: string | null;
  /** Chain `createPersistedRun(...).onEvent` so child events hit the ledger. */
  onEvent?: (event: AgentEvent) => void;
}): Promise<LegacyToolLoopResult> {
  if (shouldBlockExternalAiProvider('anthropic')) {
    return { response: getStrictLocalAiModeMessage('anthropic'), toolEvents: [] };
  }
  const toolCtx: OpenSwanRuntimeToolContext = {
    circleId: args.circleId,
    userId: args.userId,
    runId: args.runId,
    activeSoulKey: args.activeSoulKey,
    activePluginIds: [],
    surface: args.surface,
  };
  const bridgeTools = getOpenSwanToolsForSurface(args.surface, toolCtx, {
    allowedToolNames: args.allowedToolNames as OpenSwanRuntimeToolName[] | undefined,
    mode: args.mode,
  });
  if (bridgeTools.length === 0) {
    // Legacy parity: no advertised tools → no model round.
    return { response: '', toolEvents: [] };
  }

  const toolEvents: LegacyToolEvent[] = [];
  const pendingToolInputs = new Map<string, unknown>();
  let routing: LegacyToolLoopResult['routing'];
  let edgeFailed = false;

  // Wrap each bridge handler so its result carries the legacy dispatch
  // metadata/status side channel (R14) and the legacy in-loop nudges —
  // identical wrapping to the O1 parent path.
  const wrappedTools: AgentToolDefinition[] = bridgeTools.map((tool) => ({
    ...tool,
    handler: async (input, handlerCtx) => {
      const normalizedInput = (input as Record<string, unknown>) || {};
      const inner = await tool.handler(normalizedInput, handlerCtx);
      let toolPolicy: Record<string, unknown> | null = null;
      try {
        toolPolicy = getOpenSwanToolPolicy(
          tool.name as OpenSwanRuntimeToolName,
          [],
        ) as unknown as Record<string, unknown>;
      } catch { /* policy lookup is best-effort metadata */ }
      return shapeLegacyToolHandlerResult({
        toolName: tool.name,
        input: normalizedInput,
        inner,
        toolPolicy,
        priorToolEvents: toolEvents,
      });
    },
  }));

  const provider: AgentProvider = {
    turn: async ({ messages, tools }) => {
      const { data, error } = await invokeSwanbotChildToolTurn(buildSwanbotToolTurnBody({
        userMessage: args.userMessage,
        circleId: args.circleId,
        userId: args.userId,
        model: args.model,
        systemPrompt: args.systemPrompt,
        tools: toAnthropicToolShapes(tools),
        messages,
      }));
      if (error || !data) {
        // Legacy parity: terminal edge failure ends the turn with partial
        // text and flags the result `incomplete` — never a throw, so
        // already-executed child tool work isn't lost.
        edgeFailed = true;
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: String((data as any)?.response || 'Tool-use call failed.') }],
        };
      }
      const parsed = parseSwanbotToolTurnData(data);
      if (!routing && parsed.routing) routing = parsed.routing;
      return parsed.turn;
    },
  };

  // Legacy reliability-nudge parity (deterministic re-observe, proof
  // coverage, tool-budget reminder). The legacy child loop never had an
  // approval gate, so re-observe stays enabled.
  const onRoundComplete = createLegacyRoundNudgeHook({
    toolEvents,
    hasApprovalGate: false,
    dispatchObservation: async (observationTool) => {
      const obs = await dispatchToolDetailed(observationTool, {}, toolCtx);
      return { text: obs.text, status: String(obs.status) };
    },
  });

  const { runResult, usage } = await runSubagentTypedCoreLoop({
    userMessage: args.userMessage,
    tools: wrappedTools,
    provider,
    maxIterations: MAX_TOOL_ROUNDS,
    onRoundComplete,
    onEvent: (event) => {
      if (event.kind === 'tool_call_start') {
        pendingToolInputs.set(event.toolUseId, event.input);
      } else if (event.kind === 'tool_call_result') {
        const input = pendingToolInputs.get(event.toolUseId);
        pendingToolInputs.delete(event.toolUseId);
        toolEvents.push(buildLegacyToolEventFromResult({
          toolName: event.toolName,
          input,
          result: event.result,
        }));
      }
      try { args.onEvent?.(event); } catch { /* ledger writes are best-effort */ }
    },
  });

  // Legacy parity: cap hit on a pure tool_use round → one no-tools
  // finalization call so the child summarizes what it gathered.
  let finalizationText: string | null = null;
  if (!edgeFailed && needsCapExhaustionFinalization(runResult)) {
    try {
      const { data: finalData } = await invokeSwanbotChildToolTurn({
        message: args.userMessage,
        circleId: args.circleId,
        userId: args.userId,
        model: args.model,
        tools: [],
        tool_messages: runResult.messages.map((m) => ({ role: m.role, content: m.content })),
        system_override: args.systemPrompt,
      });
      finalizationText = extractAssistantText((finalData as any)?.content)
        || String((finalData as any)?.response || '');
    } catch { /* fall back to the limit note */ }
  }

  return buildLegacyToolLoopResult({
    runResult,
    toolEvents,
    routing,
    maxRounds: MAX_TOOL_ROUNDS,
    edgeFailed,
    finalizationText,
    usage,
  });
}

export async function delegateToSubagent(opts: {
  circleId: string;
  userId: string;
  userName?: string;
  surface: RunSurface;
  message: string;
  subagent: SubagentProfile;
  parentRunId?: string;
  model?: string;
  chatHistory?: string;
  roomId?: string;
  /**
   * Parent agent scope id. Passed down so the subagent sees agent-scoped
   * memories the parent has (e.g. "BlackSwan prefers short bullet replies")
   * instead of rebuilding context from scratch without that signal.
   */
  parentAgentId?: string;
  /** Parent chat mode. If provided, overrides the role-derived mode so the
   *  subagent respects the user's current mode discipline. */
  parentMode?: string | null;
}): Promise<DelegationResult> {
  // CA-8d: gate-check BEFORE any DB writes so rejected delegations
  // don't leave orphan agent_runs rows. Depth = parent's depth + 1;
  // concurrency pulled from running delegation count on the circle.
  const [parentDepth, inFlight, spendContext] = await Promise.all([
    readParentDelegationDepth(opts.parentRunId),
    countInFlightDelegations(opts.circleId),
    readDelegationSpendContext(opts.circleId),
  ]);
  const proposedDepth = parentDepth + 1;
  const gate = canDelegate({
    proposedDepth,
    inFlight,
    circleId: opts.circleId,
    parentRunId: opts.parentRunId,
    requestedRole: opts.subagent.role,
    taskPreview: opts.message.slice(0, 120),
    dailySpendUsd: spendContext.dailySpendUsd,
    dailySpendLimitUsd: spendContext.dailySpendLimitUsd,
  });
  if (!gate.ok) {
    // Ops trail: gate rejections were previously invisible to the
    // Activity feed — ops couldn't see when the circle hit its cap.
    // Fire-and-forget so we never block the parent on a telemetry
    // write.
    const reason = gate.reason === 'depth_exceeded' || gate.reason === 'concurrency_exceeded' || gate.reason === 'spend_limit_exceeded'
      ? gate.reason
      : 'concurrency_exceeded';
    const capLabel = reason === 'depth_exceeded'
      ? 'recursion cap'
      : reason === 'spend_limit_exceeded'
        ? 'daily spending limit'
        : 'concurrency cap';
    void logActivity({
      circle_id: opts.circleId,
      agent_name: opts.subagent.displayName,
      source: 'system',
      source_detail: 'delegation_gate',
      activity_type: 'task_failed',
      title: `Delegation blocked — ${capLabel}`,
      body: gate.detail || '',
      status: 'failed',
      metadata: {
        gateReason: reason,
        proposedDepth,
        inFlight,
        dailySpendUsd: spendContext.dailySpendUsd,
        dailySpendLimitUsd: spendContext.dailySpendLimitUsd,
        parentRunId: opts.parentRunId || null,
        subagentRole: opts.subagent.role,
      },
    }).catch(() => {});
    if (gate.reason === 'depth_exceeded' || gate.reason === 'concurrency_exceeded' || gate.reason === 'spend_limit_exceeded') {
      return rejectedDelegationResult(opts.subagent, gate.reason, gate.detail || '');
    }
    // invalid_input shouldn't happen from this call-site (we control
    // both inputs) but surface it anyway rather than crashing.
    return rejectedDelegationResult(opts.subagent, 'concurrency_exceeded', gate.detail || 'gate rejected');
  }

  // O3 escape hatch — resolved ONCE per delegation, before any path-specific
  // work, so a flag flip mid-run can never mix the two loops.
  const useTypedCore = isSubagentTypedCoreEnabled();

  // Create a child run for the delegation. Stamp `delegationDepth`
  // so grandchildren see the right count when they call back in.
  let runId: string | undefined;
  let persisted: PersistedRunHandle | null = null;
  if (useTypedCore) {
    // O3: typed-core path persists through createPersistedRun so every
    // AgentEvent (turns, tool calls, final response) lands in
    // agent_run_events under the parent-linked child run.
    try {
      persisted = await createPersistedRun(buildSubagentChildRunOptions({
        circleId: opts.circleId,
        userId: opts.userId,
        surface: opts.surface,
        subagentRole: opts.subagent.role,
        subagentDisplayName: opts.subagent.displayName,
        task: opts.message,
        model: opts.model || opts.subagent.modelPreference,
        roomId: opts.roomId,
        parentRunId: opts.parentRunId,
        delegationDepth: proposedDepth,
        runtimePlanVersion: OPENSWAN_RUNTIME_PLAN_VERSION,
      }));
      if (persisted) {
        runId = persisted.run.id;
        await updateRunStatus(runId, 'running');
        // createPersistedRun has no delegatedTo passthrough — backfill the
        // column best-effort so listChildRuns keeps its role grouping.
        try {
          await supabase.from('agent_runs').update({ delegated_to: opts.subagent.role }).eq('id', runId);
        } catch { /* metadata.delegatedToRole still carries it */ }
      }
    } catch {}
  } else {
    try {
      const run = await createRun({
        circleId: opts.circleId,
        userId: opts.userId,
        surface: opts.surface,
        title: `${opts.subagent.displayName}: ${opts.message.slice(0, 80)}`,
        mode: opts.subagent.role,
        model: opts.model || opts.subagent.modelPreference,
        parentRunId: opts.parentRunId,
        delegatedTo: opts.subagent.role,
        roomId: opts.roomId,
        metadata: {
          runtimePlanVersion: OPENSWAN_RUNTIME_PLAN_VERSION,
          delegationDepth: proposedDepth,
        },
      });
      if (run) {
        runId = run.id;
        await updateRunStatus(run.id, 'running');
      }
    } catch {}
  }

  const preferredSkillNames = getPreferredSkillNamesForSubagent(opts.subagent);
  const activeSoulKey = opts.subagent.spiritId ? `soul:${opts.subagent.spiritId}` : null;
  const modeKey = getSubagentModeKey(opts.subagent.role);
  const memoryBundle = await buildOpenSwanMemoryStores({
    circleId: opts.circleId,
    userId: opts.userId,
    query: opts.message,
    roomId: opts.roomId,
    // Inherit parent's agent scope so subagents see agent-scoped memories
    // (preferences, learned behavior) instead of working from a clean
    // slate every delegation.
    agentId: opts.parentAgentId,
    agentName: opts.subagent.displayName,
    spiritId: opts.subagent.spiritId || null,
    surface: opts.surface === 'main_chat' ? 'main_chat' : opts.surface === 'room_chat' ? 'room_chat' : 'task_run',
    taskKind: opts.subagent.role,
    profile: opts.subagent.role,
    runId,
    limit: 6,
  });
  const skillResolution = await resolveOpenSwanSkills({
    circleId: opts.circleId,
    userId: opts.userId,
    soulKey: activeSoulKey,
    mode: modeKey,
    taskKind: opts.subagent.role,
    query: opts.message,
    maxSkills: 6,
    preferredSkillNames,
  });

  // Build the specialist prompt
  const fullPrompt = [
    opts.subagent.systemPrompt,
    opts.chatHistory ? `\n## Recent Conversation\n${opts.chatHistory}` : '',
    `\n## Task\n${opts.message}`,
  ].filter(Boolean).join('\n\n');

  // Execute via SwanBot
  const context: SwanBotContext = {
    userId: opts.userId,
    circleId: opts.circleId,
    userName: opts.userName,
    model: opts.model || opts.subagent.modelPreference,
    chatHistory: opts.chatHistory,
    memoryContext: memoryBundle.combined,
    memoryStores: memoryBundle,
    memoryRefs: memoryBundle.references,
    taskKind: opts.subagent.role,
    sessionProfile: opts.subagent.role,
    resolvedSkills: skillResolution.skills,
    resolvedSkillsPromptBlock: skillResolution.promptBlock,
    spiritId: opts.subagent.spiritId || null,
  };

  try {
    // Build system prompt for this specialist
    const subagentSystemPrompt = await buildStreamableSystemPrompt({
      circleId: opts.circleId,
      userId: opts.userId,
      currentMessage: opts.message,
      model: opts.model || opts.subagent.modelPreference,
      userName: opts.userName,
      modeKey,
      taskKind: opts.subagent.role,
      sessionProfile: opts.subagent.role,
      resolvedSkills: skillResolution.skills,
      resolvedSkillsPromptBlock: skillResolution.promptBlock,
      chatHistory: [
        opts.subagent.systemPrompt,
        opts.chatHistory ? `\n## Recent Conversation\n${opts.chatHistory}` : '',
        memoryBundle.combined ? `\n## Memory Context\n${memoryBundle.combined}` : '',
      ].filter(Boolean).join('\n\n'),
    });

    const surfaceForTools: 'main_chat' | 'room_chat' | 'office' | 'task_run' =
      opts.surface === 'main_chat' ? 'main_chat' : opts.surface === 'room_chat' ? 'room_chat' : 'task_run';

    // O3: typed-core child loop (agentExecutionCore.runAgent) by default;
    // the legacy executeToolUseLoop is retained VERBATIM behind the
    // `uc_subagent_typed_core` revert lever. Both return the same legacy
    // result shape, so everything below stays path-agnostic.
    const toolLoopResult: LegacyToolLoopResult = useTypedCore
      ? await runTypedCoreSubagentToolLoop({
          systemPrompt: subagentSystemPrompt,
          userMessage: fullPrompt,
          model: opts.model || opts.subagent.modelPreference || 'claude-haiku-4-5',
          circleId: opts.circleId,
          userId: opts.userId,
          runId,
          activeSoulKey: activeSoulKey || undefined,
          allowedToolNames: opts.subagent.allowedTools?.length ? opts.subagent.allowedTools as string[] : undefined,
          surface: surfaceForTools,
          // Respect the user's chosen mode when the parent turn had one —
          // e.g. the parent selected `review` so subagents shouldn't have
          // write tools either. Falls back to the role-derived mode so
          // planner / builder delegations still work when the user picked
          // `none` / `talk` at the top.
          mode: opts.parentMode || modeKey,
          onEvent: persisted?.onEvent,
        })
      : await executeToolUseLoop({
          systemPrompt: subagentSystemPrompt,
          userMessage: fullPrompt,
          model: opts.model || opts.subagent.modelPreference || 'claude-haiku-4-5',
          circleId: opts.circleId,
          userId: opts.userId,
          runId,
          activeSoulKey: activeSoulKey || undefined,
          activePluginIds: [],
          allowedToolNames: opts.subagent.allowedTools?.length ? opts.subagent.allowedTools as string[] : undefined,
          surface: surfaceForTools,
          // (Same mode discipline as the typed path above.)
          mode: opts.parentMode || modeKey,
        });

    const runtimeToolActions: SwanBotStructuredToolAction[] = toolLoopResult.toolEvents.map((evt) => {
      const status: 'completed' | 'failed' | 'manual_required' | 'blocked' =
        evt.status === 'passed' ? 'completed' : evt.status === 'manual_required' ? 'manual_required' : evt.status === 'blocked' ? 'blocked' : 'failed';
      return {
        kind: 'tool' as const,
        tool_name: evt.tool,
        title: evt.tool.replace(/_/g, ' ').replace(/\./g, ' > '),
        status,
        input_preview: typeof evt.input === 'string' ? evt.input.slice(0, 500) : JSON.stringify(evt.input).slice(0, 500),
        output_preview: typeof evt.result === 'string' ? evt.result.slice(0, 1200) : '',
        metadata: stripDesignAppRuntimeCaptureMetadata(evt.metadata || {}),
      };
    });

    const structured = {
      response: toolLoopResult.response,
      tool_actions: runtimeToolActions,
      artifacts: [] as SwanBotStructuredArtifact[],
      // Legacy loop reports no usage ({}); the typed loop aggregates real
      // per-turn token telemetry, which feeds the summary-only contract.
      usage: toolLoopResult.usage || {},
    };
    const observedEval = buildOpenSwanObservedEvalSummary({
      run: {
        status: 'completed',
        mode: modeKey,
        provider: 'openswan',
        metadata: {
          explicitMode: modeKey,
          resolvedSessionProfile: opts.subagent.role,
          taskKind: opts.subagent.role,
          runtimeToolActions: runtimeToolActions,
          activeSkills: skillResolution.skills.map((skill) => ({
            name: skill.name,
            displayName: skill.displayName,
            source: skill.source,
          })),
        },
      },
      artifacts: structured.artifacts.map((artifact) => ({
        artifact_kind: artifact.kind,
        title: artifact.title,
      })),
      toolActions: runtimeToolActions,
      responseText: structured.response,
    });
    void import('./memoryService')
      .then(({ recordArchiveDerivedMemorySuccess, recordArchiveDerivedMemoryWeakSignal }) => Promise.all([
        recordArchiveDerivedMemorySuccess({
          memoryReferences: memoryBundle.references,
          observedEval,
          userId: opts.userId,
          source: 'subagent_runtime_passive_success',
          runId,
        }),
        recordArchiveDerivedMemoryWeakSignal({
          memoryReferences: memoryBundle.references,
          observedEval,
          userId: opts.userId,
          source: 'subagent_runtime_passive_weak_signal',
          runId,
        }),
      ]))
      .catch(() => {});

    // Record step
    if (runId) {
      try {
        await mergeRunMetadata(runId, {
          memoryReferences: memoryBundle.references,
          memoriesUsed: memoryBundle.references.map((ref) => ref.title),
          spiritId: opts.subagent.spiritId || null,
          activeSkills: skillResolution.skills.map((skill) => ({
            name: skill.name,
            displayName: skill.displayName,
            source: skill.source,
          })),
          observedEval,
          runtimeToolActions: runtimeToolActions.map((action) => ({
            tool: action.tool_name,
            title: action.title,
            status: action.status,
            outputPreview: action.output_preview || null,
            toolPolicy: action.metadata?.toolPolicy || null,
            approvalRequest: action.metadata?.approvalRequest || null,
          })),
        });
        let currentStepIndex = 0;
        if (runtimeToolActions.length > 0) {
          await addStep({
            runId,
            circleId: opts.circleId,
            stepIndex: currentStepIndex,
            stepKind: 'tool_call',
            title: `${opts.subagent.displayName} runtime tool activity`,
            body: runtimeToolActions
              .map((action) => `- [${action.status}] ${action.title || action.tool_name}${action.output_preview ? `: ${action.output_preview}` : ''}`)
              .join('\n')
              .slice(0, 5000),
            delegatedTo: opts.subagent.role,
            metadata: {
              executions: runtimeToolActions.map((action) => ({
                status:
                  action.status === 'completed'
                    ? 'passed'
                    : action.status === 'manual_required'
                      ? 'manual_required'
                      : action.status === 'blocked'
                        ? 'blocked'
                        : 'failed',
                mode:
                  action.status === 'manual_required'
                    ? 'manual'
                    : action.status === 'blocked'
                      ? 'blocked'
                      : 'automatic',
                summary: action.output_preview || action.title,
                toolName: action.tool_name,
                executed: action.status === 'completed' || action.status === 'failed',
                error: action.status === 'failed' || action.status === 'blocked' ? action.output_preview || null : null,
              } satisfies OpenSwanExecutionContract)),
            },
          });
          currentStepIndex += 1;
        }
        await addStep({
          runId, circleId: opts.circleId, stepIndex: currentStepIndex, stepKind: 'delegation',
          title: `${opts.subagent.displayName} response`,
          body: structured.response.slice(0, 5000),
          delegatedTo: opts.subagent.role,
        });
        currentStepIndex += 1;
        if ((structured.tool_actions || []).length > runtimeToolActions.length) {
          await addStep({
            runId,
            circleId: opts.circleId,
            stepIndex: currentStepIndex,
            stepKind: 'tool_call',
            title: `${opts.subagent.displayName} tool activity`,
            body: (structured.tool_actions || [])
              .map((action) => `- [${action.status}] ${action.title || action.tool_name}`)
              .join('\n')
              .slice(0, 5000),
            delegatedTo: opts.subagent.role,
          });
          currentStepIndex += 1;
        }
        if ((structured.artifacts || []).length > 0) {
          await addStep({
            runId,
            circleId: opts.circleId,
            stepIndex: currentStepIndex,
            stepKind: 'artifact_create',
            title: `${opts.subagent.displayName} artifacts`,
            body: (structured.artifacts || [])
              .map((artifact) => `- ${artifact.kind}: ${artifact.title}`)
              .join('\n')
              .slice(0, 5000),
            delegatedTo: opts.subagent.role,
          });
        }
        if (useTypedCore) {
          // Typed path: per-event telemetry already streamed via
          // createPersistedRun.onEvent. Terminal status follows the
          // typed-core convention (cap exhaustion / edge failure → failed,
          // mirroring PersistedRunHandle.finalize) and the run row gets
          // the aggregated token totals the legacy loop never reported.
          await updateRunStatus(runId, toolLoopResult.incomplete ? 'failed' : 'completed', {
            ...(toolLoopResult.usage
              ? {
                  input_tokens: toolLoopResult.usage.input_tokens,
                  output_tokens: toolLoopResult.usage.output_tokens,
                  cached_tokens: typeof toolLoopResult.usage.total_tokens === 'number'
                    ? Math.max(0, toolLoopResult.usage.total_tokens - ((toolLoopResult.usage.input_tokens || 0) + (toolLoopResult.usage.output_tokens || 0)))
                    : 0,
                }
              : {}),
          });
        } else {
          await updateRunStatus(runId, 'completed');
        }
      } catch {}
    }

    // O3 summary-only contract: redact the child's output down to a
    // bounded digest. Parent consumers (openswanSessionRuntime, edge-fn
    // composers) inject `parentSummary` / `summary` into the PARENT's
    // tool_result, not the full response — the full response lives in
    // the Run Ledger for ops. `toolActions` drives the tool_call count;
    // `incomplete` (cap hit / edge failure) maps to completed=false so
    // the parent can decide retry-vs-accept-partial honestly.
    const summaryPayload = buildSubagentLoopSummary({
      finalText: structured.response,
      toolCalls: (structured.tool_actions || []).map((action) => ({
        name: action.tool_name,
        ok: action.status === 'completed',
      })),
      completedCleanly: !toolLoopResult.incomplete,
      usage: toolLoopResult.usage,
    });
    return {
      response: structured.response,
      summary: summaryPayload.summary,
      summaryMeta: {
        toolCallCount: summaryPayload.toolCallCount,
        completed: summaryPayload.completed,
        inputTokens: summaryPayload.inputTokens,
        outputTokens: summaryPayload.outputTokens,
      },
      parentSummary: buildSubagentParentSummary({
        payload: summaryPayload,
        status: toolLoopResult.incomplete ? 'incomplete' : 'completed',
        runId,
      }),
      subagent: opts.subagent,
      runId,
      artifacts: structured.artifacts || [],
      toolActions: structured.tool_actions || [],
      memoryReferences: memoryBundle.references,
      observedEval,
      usage: structured.usage,
    };
  } catch (err: any) {
    if (runId) {
      try {
        await addStep({ runId, circleId: opts.circleId, stepIndex: 0, stepKind: 'error', title: 'Delegation failed', body: err.message });
        await updateRunStatus(runId, 'failed');
      } catch {}
    }
    throw err;
  }
}

export async function delegateToSubagents(opts: {
  circleId: string;
  userId: string;
  userName?: string;
  surface: RunSurface;
  message: string;
  specs: SubagentTaskSpec[];
  parentRunId?: string;
  model?: string;
  chatHistory?: string;
  roomId?: string;
  parentAgentId?: string;
  parentMode?: string | null;
}): Promise<ParallelDelegationResult> {
  const settled = await Promise.allSettled(
    opts.specs.map((spec) =>
      delegateToSubagent({
        circleId: opts.circleId,
        userId: opts.userId,
        userName: opts.userName,
        surface: opts.surface,
        message: spec.task,
        subagent: spec.subagent,
        parentRunId: opts.parentRunId,
        model: opts.model || spec.subagent.modelPreference,
        chatHistory: opts.chatHistory,
        roomId: opts.roomId,
        parentAgentId: opts.parentAgentId,
        parentMode: opts.parentMode,
      }),
    ),
  );

  const results: DelegationResult[] = [];
  for (let index = 0; index < settled.length; index += 1) {
    const entry = settled[index];
    if (entry.status === 'fulfilled') {
      results.push(entry.value);
      continue;
    }
    const failMsg = `Specialist failed: ${entry.reason?.message || String(entry.reason || 'unknown error')}`;
    results.push({
      response: failMsg,
      summary: failMsg, // already short; no redaction needed
      summaryMeta: { toolCallCount: 0, completed: false },
      parentSummary: buildSubagentParentSummary({
        payload: { summary: failMsg, toolCallCount: 0, completed: false },
        status: 'failed',
      }),
      subagent: opts.specs[index].subagent,
    });
  }

  return {
    specs: opts.specs,
    results,
  };
}
