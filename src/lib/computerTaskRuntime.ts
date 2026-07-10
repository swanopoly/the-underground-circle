import { executeAgentRun, type AgentRunResult } from './agentRuntime';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import {
  prepareComputerTaskExecution,
  type ComputerTaskExecutionEnvelope,
} from './computerTaskExecution';
import { executeComputerFileTask } from './computerFileAdapter';
import { executeComputerAppTask } from './computerAppAdapter';
import { shouldRunLocalComputerAwarenessIntentSequence } from './localComputerAwarenessIntent';
import { listApiKeys } from './llmProviders';
import {
  buildAgentAppCapabilityGapSummary,
  buildAgentAppCapabilityRetryPrompt,
  formatAgentAppCapabilityBuildoutForUser,
  inferAppNameForCapabilityBuildout,
  parseAgentAppCapabilityBuildoutResult,
  parseAgentAppCapabilityBuildoutResultFromSession,
  shouldRequestAgentAppCapabilityBuildoutFromOutcome,
} from './agentAppCapabilityBuildout';
import {
  loadCircleBusinessModelProfiles,
  buildImplicitBusinessModelProfiles,
  planBusinessModelForComputerTask,
  type BusinessModelTaskPlan,
} from './businessModelProfiles';
import type { ComputerTaskCapabilityBuildout } from './computerTaskState';
import {
  DESKTOP_ATTACHMENT_TASK_MARKER,
  parseDesktopAttachmentTaskFiles,
  selectDesktopAttachmentsToPreOpen,
} from './chatDesktopAttachmentRouting';
import {
  formatComputerTaskModelResolutionNotice,
  resolveComputerTaskLoopModel,
  type ComputerTaskModelResolution,
} from './chatComputerHandoffContext';
import { openPath as bridgeOpenPath, waitForApp as bridgeWaitForApp } from './desktopBridge';
import {
  formatGenericAppNavigatorPromptBlock,
  shouldUseGenericAppNavigator,
} from './genericAppNavigator';
import {
  buildObserveBeforeActPromptBlock,
  deriveAuditObservedEvidence,
  deriveSurfaceCapabilityStatusFromAudit,
  type ComputerTaskSurfaceEscalation,
  type SurfaceEscalationDecision,
} from './appAutomationControlSurfaces';
import {
  deriveCapabilityHintsFromFacts,
  inferRunSurfaceIdFromEscalations,
  loadAppLearnedFacts,
  mergeCapabilityStatusWithLearnedHints,
  normalizeAppKey,
  recordAppLearnedFactsBuildoutProposal,
  recordAppLearnedFactsOutcome,
  shouldInjectDesktopExample,
  shouldProposeCapabilityBuildout,
  type AppLearnedFacts,
} from './appLearnedFacts';

/** E1: a descend decision the runtime still has to act on (narrowed union member). */
type PendingSurfaceDescent = Extract<SurfaceEscalationDecision, { action: 'descend' }>;

export type ComputerTaskRuntimeAdapterId =
  | 'browser_adapter'
  | 'file_adapter'
  | 'app_adapter'
  | 'hybrid_adapter';

export interface ComputerTaskRuntimeResult {
  adapterId: ComputerTaskRuntimeAdapterId;
  execution: ComputerTaskExecutionEnvelope;
  response: string;
  runId?: string | null;
  modeOutcomeSummary?: AgentRunResult['modeOutcomeSummary'];
  observedEval?: OpenSwanObservedEvalSummary | null;
  handoffSuggestion?: AgentRunResult['handoffSuggestion'];
  capabilityBuildout?: ComputerTaskCapabilityBuildout | null;
  /**
   * E1: bounded (≤3) mid-run surface-escalation breadcrumbs
   * ({fromSurface, toSurface, reason, atIso, appName?, failureCode?}).
   * Additive optional field — persistence/recovery consumers can adopt it
   * without a schema change. a11y-coded entries double as the macOS
   * AX-coverage telemetry described in appAutomationControlSurfaces.
   */
  surfaceEscalations?: ComputerTaskSurfaceEscalation[] | null;
  /**
   * 2.5 substitution visibility: non-null ONLY when the user's selected
   * model cannot drive the native screenshot/action loop, so the Sonnet pin
   * (owned by the computer-use edge function) will substitute it there.
   * Text-only planner/validator steps in this runtime always keep
   * `args.model` unchanged. Additive optional field — bounded (three short
   * strings + a flag) so persisted payloads stay small.
   */
  modelResolution?: ComputerTaskModelResolution | null;
  warnings: string[];
  /**
   * P54: set when the model-driven pre-flight clarifier decided the task
   * needs answers before execution — `response` carries the batched
   * questions; nothing was executed. The user's reply re-enters planning.
   */
  clarification?: { questions: string[]; assumptions: string[] } | null;
}

/**
 * Detects whether an app-task utterance has follow-up work beyond the
 * initial launch. "open Zoom" → false (we can short-circuit after
 * launching). "open Notes and create a note" → true (the agent needs
 * to keep going after launch). Conservative: any conjunction, any
 * action verb beyond open/launch/start/switch, or any "and then" / "then"
 * counts as follow-up.
 *
 * Exported for smoke tests — keeps the classifier pinned.
 */
export function hasFollowUpIntent(task: string): boolean {
  const lower = String(task || '').trim().toLowerCase();
  if (!lower) return false;
  if (/\b(then|and then|after|next|also|,)\b/i.test(lower)) return true;
  if (/\band\s+(?!(?:i|i'?m|the|a|an)\b)\w/i.test(lower)) return true;
  // Action verbs that imply work INSIDE the app — not just launching it.
  if (/\b(create|write|type|make|draft|send|post|compose|record|start a|new|save|crop|edit|resize|export|draw|paint|generate|render|retouch)\b/i.test(lower)) return true;
  // "with" / "about" / "for" + object — usually describes follow-up content.
  if (/\b(with|about|for)\s+\w+/i.test(lower) && lower.length > 25) return true;
  return false;
}

// ─── L1: Desktop action-trace capture + retrieval-as-context ────────────────
//
// Desktop twin of the browser guided-replay trace (D7c) in
// `supabase/functions/computer-use-agent/index.ts`:
//   - matcher (`normalizeTaskForReplay`, ~lines 332-336): lowercase, strip the
//     "run this computer task exactly as written:" schedule prefix, collapse
//     whitespace, trim; 45-day window; completed runs only; first (newest)
//     exact match wins.
//   - redaction (`redactForTrace`/`recordTrace`, ~lines 531-547): credential-
//     shaped keys (/password|secret|token|otp|credential|passcode|pin|cvv|card/i)
//     masked at write time, strings truncated to 200 chars, ≤40-action
//     sliding window (oldest dropped first).
//   - injection (~lines 354-358): numbered `tool(input)` steps + drift rules.
// Keep these semantics in lockstep with the edge function. One deliberate
// strengthening over the edge version: redaction here recurses into nested
// objects/arrays, so nested credential keys are masked too.
//
// Per UFO2/ActionEngine (verified findings 3-5 in
// docs/LEARNING_LOOP_RESEARCH_2026-06-12.md): recorded steps are HYPOTHESES
// with per-step precondition anchors (a11y verify before replay), never a
// forced script; retrieval is exact-match only; and a successful run that
// received an example writes back its NEW trace (newest successful trace
// wins — no in-place patching).
//
// NOTE: scripts/desktop-action-trace-smoketest.ts mirrors these pure helpers
// (it cannot import this module — agentRuntime drags in react-native). Keep
// the mirror in lockstep.

export interface DesktopActionTraceEntry {
  tool: string;
  input: unknown;
}

export interface DesktopActionTrace {
  v: 1;
  normalizedTask: string;
  capturedAtIso: string;
  actions: DesktopActionTraceEntry[];
}

export const DESKTOP_ACTION_TRACE_MAX_ACTIONS = 40;
export const DESKTOP_ACTION_TRACE_MAX_STRING_CHARS = 200;
/** Bounded run-row metadata payload (~12kb serialized). */
export const DESKTOP_ACTION_TRACE_MAX_PAYLOAD_CHARS = 12_000;
/** Bounded prompt example block (~2.5k chars). */
export const DESKTOP_ACTION_TRACE_EXAMPLE_MAX_CHARS = 2_500;
/** Same matching window as the edge replay matcher (45 days). */
export const DESKTOP_ACTION_TRACE_WINDOW_DAYS = 45;

/** Same key regex as the edge `SENSITIVE_KEY_RE` — keep in lockstep. */
const DESKTOP_TRACE_SENSITIVE_KEY_RE = /password|secret|token|otp|credential|passcode|pin|cvv|card/i;
const DESKTOP_TRACE_MAX_REDACTION_DEPTH = 4;
const DESKTOP_TRACE_MAX_ARRAY_ITEMS = 20;

/** Mirrors the edge `normalizeTaskForReplay` matcher exactly. */
export function normalizeDesktopTaskText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/^run this computer task exactly as written:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function redactDesktopTraceValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return value.slice(0, DESKTOP_ACTION_TRACE_MAX_STRING_CHARS);
  if (!value || typeof value !== 'object') return value;
  // Fail closed on very deep structures instead of persisting them unredacted.
  if (depth >= DESKTOP_TRACE_MAX_REDACTION_DEPTH) return '[depth-capped]';
  if (Array.isArray(value)) {
    return value.slice(0, DESKTOP_TRACE_MAX_ARRAY_ITEMS).map((item) => redactDesktopTraceValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (DESKTOP_TRACE_SENSITIVE_KEY_RE.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    out[key] = redactDesktopTraceValue(entry, depth + 1);
  }
  return out;
}

/**
 * Edge-parity redaction for one tool input: credential-shaped keys →
 * '[redacted]', strings truncated to 200 chars (nested keys also masked —
 * deliberate strengthening over the shallow edge version).
 */
export function redactDesktopTraceInput(input: unknown): unknown {
  return redactDesktopTraceValue(input, 0);
}

/**
 * Capture primitive — mirrors the edge `recordTrace`: push the redacted
 * action, keep a ≤40-entry sliding window (oldest dropped first). Mutates
 * and returns `trace` so callers can fold over a raw action list.
 */
export function recordDesktopActionTraceEntry(
  trace: DesktopActionTraceEntry[],
  action: { tool: string; input: unknown },
): DesktopActionTraceEntry[] {
  trace.push({
    tool: String(action.tool || 'unknown_tool'),
    input: redactDesktopTraceInput(action.input),
  });
  if (trace.length > DESKTOP_ACTION_TRACE_MAX_ACTIONS) trace.shift();
  return trace;
}

/**
 * Success-only persistence shape for `agent_runs.metadata.desktopActionTrace`.
 * Bounded to ~12kb serialized by dropping the OLDEST actions first; returns
 * null (fail closed) when there is nothing worth persisting or even a single
 * action cannot fit the bound.
 */
export function buildDesktopActionTracePayload(args: {
  task: string;
  actions: DesktopActionTraceEntry[];
  capturedAtIso?: string;
}): DesktopActionTrace | null {
  const normalizedTask = normalizeDesktopTaskText(args.task);
  if (!normalizedTask || !Array.isArray(args.actions) || args.actions.length === 0) return null;
  const payload: DesktopActionTrace = {
    v: 1,
    normalizedTask,
    capturedAtIso: args.capturedAtIso || new Date().toISOString(),
    actions: args.actions.slice(-DESKTOP_ACTION_TRACE_MAX_ACTIONS),
  };
  const serializedLength = () => {
    try {
      return JSON.stringify(payload).length;
    } catch {
      return Number.MAX_SAFE_INTEGER; // unserializable input → fail closed below
    }
  };
  while (payload.actions.length > 1 && serializedLength() > DESKTOP_ACTION_TRACE_MAX_PAYLOAD_CHARS) {
    payload.actions.shift();
  }
  if (serializedLength() > DESKTOP_ACTION_TRACE_MAX_PAYLOAD_CHARS) return null;
  return payload;
}

/**
 * Render a prior successful trace as an EXAMPLE block (never a command) for
 * prompt assembly. Numbered steps mirror the edge injection format; the rules
 * carry the UFO2-style per-step precondition anchors (verify the target
 * element/window via a11y before replaying; on ANY mismatch stop and
 * re-ground) and never relax approval gates. Capped at ~2.5k chars by
 * dropping the LAST steps (the opening steps anchor the example).
 */
export function buildDesktopActionTraceExampleBlock(trace: DesktopActionTrace): string {
  if (!trace || trace.v !== 1 || !Array.isArray(trace.actions) || trace.actions.length === 0) return '';
  const header = `## Example: previous successful run of this exact task (${String(trace.capturedAtIso || '').slice(0, 10)})`;
  const intro = 'A previous successful run of this exact task used these steps:';
  const rules = [
    'Treat each step as a HYPOTHESIS, not a script: before replaying a step, verify the target element/window still exists and is enabled (desktop.read_a11y_tree / desktop.window_state); on ANY mismatch stop following the example and re-ground normally (observe, then act).',
    'Never skip approval or ask_user steps — the example never overrides approval gates.',
    'The example shortens exploration — correctness rules are unchanged.',
  ].join('\n');
  const stepLines = trace.actions.map((action, index) => {
    let inputText = '{}';
    try {
      inputText = JSON.stringify(action.input ?? {}).slice(0, DESKTOP_ACTION_TRACE_MAX_STRING_CHARS);
    } catch { /* keep '{}' */ }
    return `${index + 1}. ${action.tool}(${inputText})`;
  });
  const render = (lines: string[]) => [header, intro, ...lines, rules].join('\n');
  let kept = stepLines.slice();
  let omitted = 0;
  const renderWithOmission = () =>
    render(omitted > 0 ? [...kept, `… (${omitted} more step(s) omitted)`] : kept);
  while (kept.length > 1 && renderWithOmission().length > DESKTOP_ACTION_TRACE_EXAMPLE_MAX_CHARS) {
    kept.pop();
    omitted += 1;
  }
  const text = renderWithOmission();
  // Even a single step won't fit — drop the example entirely (fail closed).
  return text.length <= DESKTOP_ACTION_TRACE_EXAMPLE_MAX_CHARS ? text : '';
}

/**
 * Write-back (ActionEngine lite): after a SUCCESSFUL desktop/app/hybrid run,
 * harvest the run's tool actions from the persisted event stream, fold them
 * through the redaction/window capture primitive, and merge the bounded
 * trace onto the run row metadata. Newest successful trace wins on the next
 * retrieval — there is no in-place patching of older traces. Best-effort
 * telemetry: never blocks or fails the user-visible task.
 */
async function persistDesktopActionTraceForRun(args: {
  runId: string;
  circleId: string;
  userId: string;
  task: string;
  sinceIso: string;
}): Promise<void> {
  try {
    const { harvestDesktopRunActionEntries, mergeRunMetadata } = await import('./agentRunSystem');
    const rawActions = await harvestDesktopRunActionEntries({
      runId: args.runId,
      circleId: args.circleId,
      userId: args.userId,
      sinceIso: args.sinceIso,
    });
    if (rawActions.length === 0) return;
    const trace: DesktopActionTraceEntry[] = [];
    for (const action of rawActions) recordDesktopActionTraceEntry(trace, action);
    const payload = buildDesktopActionTracePayload({ task: args.task, actions: trace });
    if (!payload) return;
    await mergeRunMetadata(args.runId, { desktopActionTrace: payload });
  } catch { /* trace persistence is telemetry — never block the task */ }
}

function shouldRequestConnectedAppCapabilityBuildout(args: {
  execution: ComputerTaskExecutionEnvelope;
  task: string;
  agentResponse?: string | null;
  errorMessage?: string | null;
  appAdapterMessage?: string | null;
}): boolean {
  return shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: args.execution.computerAppGrounding?.strategy.id || args.execution.preflight.strategy?.id || null,
    agentResponse: args.agentResponse,
    errorMessage: args.errorMessage,
    appAdapterMessage: args.appAdapterMessage,
  });
}

function visibleCapabilityBuildoutMessage(buildout: ComputerTaskCapabilityBuildout | null | undefined): string {
  return formatAgentAppCapabilityBuildoutForUser(buildout);
}

async function requestConnectedAppCapabilityBuildout(args: {
  circleId: string;
  userId: string;
  task: string;
  execution: ComputerTaskExecutionEnvelope;
  appAdapterMessage?: string | null;
  agentResponse?: string | null;
  errorMessage?: string | null;
  warnings?: string[];
  /**
   * L3: learned-facts propose reason. When set, the per-run outcome heuristic
   * gate is bypassed — the accumulated failure evidence IS the trigger.
   */
  learnedProposalReason?: string | null;
  /**
   * L3: run anchor for the HITL approval. With a runId, openswanToolRuntime's
   * 'ask' policy files an agent_run_approvals row (with the existing same-title
   * duplicate-pending guard) and the buildout dispatch WAITS for the human
   * decision instead of executing — the proposal stays a draft.
   */
  runId?: string | null;
}): Promise<ComputerTaskCapabilityBuildout | null> {
  if (!args.learnedProposalReason && !shouldRequestConnectedAppCapabilityBuildout({
    execution: args.execution,
    task: args.task,
    agentResponse: args.agentResponse,
    errorMessage: args.errorMessage,
    appAdapterMessage: args.appAdapterMessage,
  })) {
    return null;
  }

  try {
    const { executeOpenSwanRuntimeTool } = await import('./openswanToolRuntime');
    const context = {
      circleId: args.circleId,
      userId: args.userId,
      surface: 'main_chat' as const,
      ...(args.runId ? { runId: args.runId } : {}),
    };
    const roster = await executeOpenSwanRuntimeTool('office.list_agents', {}, context).catch((error: any) => ({
      ok: false,
      resultsText: error?.message || 'Could not inspect connected agents.',
    }));
    const capabilityGap = buildAgentAppCapabilityGapSummary({
      strategyId: args.execution.computerAppGrounding?.strategy.id || args.execution.preflight.strategy?.id || null,
      previewLabel: args.execution.preview.label,
      previewKind: args.execution.preview.kind,
      appAdapterMessage: args.appAdapterMessage,
      agentResponse: args.agentResponse,
      errorMessage: args.errorMessage || args.learnedProposalReason || null,
      warnings: args.warnings,
    });
    const buildout = await executeOpenSwanRuntimeTool('agent.build_app_capability', {
      task: args.task,
      appName: inferAppNameForCapabilityBuildout(args.task),
      capabilityGap,
      desiredOutcome: 'Chat/SwanBot can retry this unfamiliar app task through a reusable app recipe, adapter, bridge tool, or planner route after approval.',
      currentPlanSummary: [
        args.execution.preflight.summary,
        args.execution.computerAppGroundingTrace?.display.summary,
        args.execution.computerAppGroundingTrace?.display.nextAction
          ? `Next grounding action: ${args.execution.computerAppGroundingTrace.display.nextAction}`
          : '',
      ].filter(Boolean).join('\n'),
      launchIfMissing: true,
    }, context);
    const buildoutAny = buildout as any;
    const approvalRequest = buildoutAny.approvalRequest as { id?: string; status?: string } | undefined;
    const parsedResult = parseAgentAppCapabilityBuildoutResult(String(buildout.resultsText || ''));
    const rosterText = roster?.ok && roster.resultsText
      ? `Connected agents checked: ${String(roster.resultsText).split('\n').slice(0, 3).join(' | ')}`
      : `Connected agents check: ${String(roster?.resultsText || 'unavailable')}`;
    const status: ComputerTaskCapabilityBuildout['status'] = approvalRequest
      ? 'approval_required'
      : parsedResult.status === 'ready_to_retry'
        ? 'ready_to_retry'
      : parsedResult.status === 'blocked'
        ? 'blocked'
      : parsedResult.status === 'incomplete'
        ? 'incomplete'
      : buildout.ok
        ? 'requested'
        : 'failed';
    const message = [
      '**Connected-agent capability buildout**',
      rosterText,
      String(buildout.resultsText || 'Buildout request submitted.'),
    ].join('\n');
    return {
      status,
      message,
      appName: buildout.appName || inferAppNameForCapabilityBuildout(args.task) || null,
      buildoutKind: buildout.buildoutKind || null,
      risk: buildout.risk || null,
      sessionId: buildout.sessionId || null,
      launched: typeof buildout.launched === 'boolean' ? buildout.launched : null,
      approvalId: approvalRequest?.id || null,
      retryPlan: parsedResult.retryPlan || 'Retry the same chat task after the connected agent returns APP_CAPABILITY_SUMMARY and VERIFICATION, or after approving the pending buildout request.',
      summary: parsedResult.summary,
      controlSurface: parsedResult.controlSurface,
      sourceRefs: parsedResult.sourceRefs,
      filesChanged: parsedResult.filesChanged,
      verification: parsedResult.verification,
      userActionNeeded: parsedResult.userActionNeeded,
      missingEvidence: parsedResult.missingEvidence,
      updatedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      status: 'failed',
      message: [
        '**Connected-agent capability buildout**',
        `Buildout handoff failed: ${error?.message || String(error)}`,
      ].join('\n'),
      appName: inferAppNameForCapabilityBuildout(args.task) || null,
      buildoutKind: null,
      risk: null,
      sessionId: null,
      launched: null,
      approvalId: null,
      retryPlan: 'Fix the connected-agent handoff blocker, then retry the same chat task.',
      updatedAt: new Date().toISOString(),
    };
  }
}

async function retryComputerTaskAfterReadyCapabilityBuildout(args: {
  task: string;
  circleId: string;
  userId: string;
  userName?: string;
  model?: string;
  execution: ComputerTaskExecutionEnvelope;
  capabilityBuildout: ComputerTaskCapabilityBuildout | null | undefined;
  appAdapterMessage?: string | null;
  chatHistory?: string;
  sessionArchiveContext?: string;
  replyTo?: string;
}): Promise<{
  response?: string;
  runId?: string | null;
  modeOutcomeSummary?: AgentRunResult['modeOutcomeSummary'];
  observedEval?: OpenSwanObservedEvalSummary | null;
  handoffSuggestion?: AgentRunResult['handoffSuggestion'];
  warning?: string;
} | null> {
  if (args.capabilityBuildout?.status !== 'ready_to_retry') return null;

  const prompt = buildAgentAppCapabilityRetryPrompt({
    task: args.task,
    appName: args.capabilityBuildout.appName,
    summary: args.capabilityBuildout.summary,
    controlSurface: args.capabilityBuildout.controlSurface,
    sourceRefs: args.capabilityBuildout.sourceRefs,
    filesChanged: args.capabilityBuildout.filesChanged,
    retryPlan: args.capabilityBuildout.retryPlan,
    verification: args.capabilityBuildout.verification,
    appAdapterMessage: args.appAdapterMessage,
    dispatchPrefix: args.execution.dispatchPrefix,
  });

  try {
    const retryResult = await executeAgentRun({
      surface: 'main_chat',
      circleId: args.circleId,
      userId: args.userId,
      userName: args.userName,
      prompt,
      model: args.model,
      mode: args.execution.recommendedMode,
      capabilityProfile: args.execution.capabilityProfile,
      context: {
        chatHistory: args.chatHistory,
        sessionArchiveContext: args.sessionArchiveContext,
        replyTo: args.replyTo,
      },
    });
    const response = String(retryResult.response || '').trim()
      || '(The retry after app capability buildout completed, but it did not return follow-up text.)';
    return {
      response: `**Retried after connected app capability buildout**\n\n${response}`,
      runId: retryResult.runId,
      modeOutcomeSummary: retryResult.modeOutcomeSummary,
      observedEval: retryResult.observedEval,
      handoffSuggestion: retryResult.handoffSuggestion,
    };
  } catch (error: any) {
    return {
      warning: `capability buildout retry failed: ${error?.message || String(error)}`,
    };
  }
}

export async function refreshComputerTaskCapabilityBuildoutFromCodexSession(
  current: ComputerTaskCapabilityBuildout | null | undefined,
): Promise<ComputerTaskCapabilityBuildout | null> {
  if (!current?.sessionId) return null;
  if (current.status !== 'requested') return null;
  const { fetchCodexSessions } = await import('./codexDetector');
  const sessions = await fetchCodexSessions().catch(() => []);
  const target = sessions.find((session) =>
    session.sessionId === current.sessionId
    || session.sessionId.startsWith(current.sessionId || '')
    || (current.sessionId || '').startsWith(session.sessionId)
  );
  const parsed = parseAgentAppCapabilityBuildoutResultFromSession(target);
  if (!parsed || (parsed.status !== 'ready_to_retry' && parsed.status !== 'blocked' && parsed.status !== 'incomplete')) return null;
  return {
    ...current,
    status: parsed.status,
    summary: parsed.summary || current.summary || null,
    controlSurface: parsed.controlSurface || current.controlSurface || null,
    sourceRefs: parsed.sourceRefs.length > 0 ? parsed.sourceRefs : current.sourceRefs || [],
    filesChanged: parsed.filesChanged.length > 0 ? parsed.filesChanged : current.filesChanged || [],
    retryPlan: parsed.retryPlan || current.retryPlan || null,
    verification: parsed.verification || current.verification || null,
    userActionNeeded: parsed.userActionNeeded || current.userActionNeeded || null,
    missingEvidence: parsed.missingEvidence.length > 0 ? parsed.missingEvidence : current.missingEvidence || [],
    message: [
      current.message,
      '**Connected-agent capability result detected**',
      parsed.summary || parsed.verification || parsed.userActionNeeded || parsed.retryPlan || parsed.missingEvidence.join(', ') || 'Capability buildout session returned a parseable result.',
    ].filter(Boolean).join('\n'),
    updatedAt: new Date().toISOString(),
  };
}

function adapterIdForKind(kind: ComputerTaskExecutionEnvelope['preview']['kind']): ComputerTaskRuntimeAdapterId {
  switch (kind) {
    case 'file_task':
      return 'file_adapter';
    case 'app_task':
      return 'app_adapter';
    case 'hybrid_task':
      return 'hybrid_adapter';
    case 'browser_task':
    case 'unknown':
    default:
      return 'browser_adapter';
  }
}

/**
 * Observe-before-act: read the live desktop/app surface state (read-only)
 * before the agent is allowed to act, so it starts from ground truth instead of
 * only being told to go look. Fail-open by design — if the bridge isn't
 * connected (audit says so), or the read fails, we return [] and the caller
 * falls back to the existing prose directive. NEVER mutates anything.
 */
async function captureLiveSurfaceObservations(audit: ComputerCapabilityAudit | null): Promise<string[]> {
  const bridgeReady = audit?.findings?.find((finding) => finding.id === 'desktop_control')?.status === 'ready';
  if (!bridgeReady) return [];
  try {
    const { getWindowState } = await import('./desktopBridge');
    const win = await getWindowState();
    if (!win.ok || !win.data) return [];
    const observations: string[] = [];
    if (win.data.frontmostApp) observations.push(`Frontmost app: ${win.data.frontmostApp}`);
    if (win.data.activeWindowTitle) observations.push(`Active window: ${win.data.activeWindowTitle}`);
    if (Array.isArray(win.data.windows) && win.data.windows.length > 0) {
      observations.push(`Open windows: ${win.data.windows.slice(0, 8).join(', ')}`);
    }
    return observations;
  } catch {
    return []; // fail open — never block a task because observation failed
  }
}

/**
 * P54/P57 — the model-driven ONE-SHOT clarifier check, shared by BOTH
 * computer lanes: the app/file/hybrid runtime below AND ChatTab's
 * browser_runtime handler (which bypasses this runtime for execution).
 *
 * Returns null when execution should proceed (ready, gated off, opted out,
 * already asked, or ANY failure — fail-open by contract: a broken clarifier
 * must never block a task; the loop's observe/approve gates still protect
 * every mutation). Returns the batched questions + chat message otherwise.
 * Opt-out: localStorage['uc_model_clarifier']='0'. One shot per
 * (circle, task) via the module registry in computerTaskClarifier.
 */
export async function runComputerTaskClarifierCheck(input: {
  task: string;
  circleId: string;
  userId: string;
  executionSummary: string;
  appResolutionName?: string | null;
  hasAttachments?: boolean;
  chatHistoryTail?: string | null;
  isLaunchOnly: boolean;
}): Promise<{ questions: string[]; assumptions: string[]; message: string } | null> {
  try {
    let enabled = true;
    try { enabled = typeof localStorage === 'undefined' || localStorage.getItem('uc_model_clarifier') !== '0'; } catch {}
    if (!enabled) return null;

    const {
      shouldRunComputerTaskClarifier, markClarifierAsked, buildClarifierUserMessage,
      parseClarifierResponse, formatClarifierQuestionsForChat, CLARIFIER_SYSTEM_PROMPT,
    } = await import('./computerTaskClarifier');

    const gate = shouldRunComputerTaskClarifier({
      task: input.task,
      circleId: input.circleId,
      isLaunchOnly: input.isLaunchOnly,
    });
    if (!gate.run) return null;
    markClarifierAsked(gate.key);

    const { supabase } = await import('./supabase');
    const { getFreshAccessToken } = await import('./authSession');
    const accessToken = await getFreshAccessToken().catch(() => null);
    const invoke = supabase.functions.invoke('swanbot-ai', {
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      body: {
        message: buildClarifierUserMessage({
          task: input.task,
          executionSummary: input.executionSummary,
          appResolution: input.appResolutionName || null,
          hasAttachments: input.hasAttachments === true,
          chatHistoryTail: input.chatHistoryTail || null,
        }),
        circleId: input.circleId,
        userId: input.userId,
        model: 'claude-haiku-4-5',
        system_override: CLARIFIER_SYSTEM_PROMPT,
      },
    });
    const raced: any = await Promise.race([
      invoke,
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    const replyText: string = raced?.data?.response
      || (Array.isArray(raced?.data?.content)
        ? raced.data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('\n')
        : '');
    const verdict = parseClarifierResponse(replyText);
    if (!verdict.ready && verdict.questions.length > 0) {
      return {
        questions: verdict.questions.map((q) => q.q),
        assumptions: verdict.assumptions,
        message: formatClarifierQuestionsForChat(verdict),
      };
    }
    return null;
  } catch (clarifierErr) {
    console.warn('[computerTaskRuntime] clarifier skipped (fail-open):', clarifierErr);
    return null;
  }
}

export async function executeComputerTaskWithAgent(args: {
  task: string;
  circleId: string;
  userId: string;
  userName?: string;
  model?: string;
  audit: ComputerCapabilityAudit | null;
  grantedIds?: import('./computerTaskGrants').ComputerTaskGrantId[];
  businessModelPlan?: BusinessModelTaskPlan | null;
  chatHistory?: string;
  sessionArchiveContext?: string;
  replyTo?: string;
  readyCapabilityBuildout?: ComputerTaskCapabilityBuildout | null;
  disableCapabilityBuildout?: boolean;
  /** Route-level app choice — threads into the complexity plan's dispatch
   *  block so the agent opens the chosen app first (App-choice contract). */
  appResolution?: import('./computerTaskComplexityPlan').ComputerTaskAppChoiceResolution | null;
}): Promise<ComputerTaskRuntimeResult> {
  // L1: window start for the post-success action-trace harvest (the v2 tool
  // loop persists tool inputs under its own sibling run row — see
  // harvestDesktopRunActionEntries in agentRunSystem).
  const desktopTraceTaskStartedAtIso = new Date().toISOString();
  const previewForRouting = prepareComputerTaskExecution({
    task: args.task,
    audit: args.audit,
    grantedIds: args.grantedIds,
  }).preview;
  const businessModelPlan = args.businessModelPlan || await (async () => {
    const [businessProfiles, providerKeys] = await Promise.all([
      loadCircleBusinessModelProfiles(args.circleId).catch(() => []),
      listApiKeys().catch(() => []),
    ]);
    return planBusinessModelForComputerTask({
      task: args.task,
      preview: previewForRouting,
      profiles: [...businessProfiles, ...buildImplicitBusinessModelProfiles(providerKeys)],
      providerKeys,
    });
  })();
  const execution = prepareComputerTaskExecution({
    task: args.task,
    audit: args.audit,
    grantedIds: args.grantedIds,
    businessModelPlan,
    appResolution: args.appResolution ?? null,
  });
  const readyCapabilityBuildout = args.readyCapabilityBuildout?.status === 'ready_to_retry'
    ? args.readyCapabilityBuildout
    : null;
  const canRequestCapabilityBuildout = !args.disableCapabilityBuildout && !readyCapabilityBuildout;
  const isAttachedDesktopFileTask = args.task.includes(DESKTOP_ATTACHMENT_TASK_MARKER);

  // P54: model-driven ONE-SHOT clarification. Before activating bridges/
  // apps/pipelines, a cheap model pass judges whether the task is executable
  // as specified; when it isn't, we return the batched questions as this
  // turn's response (ChatTab renders it like any task response; the user's
  // reply re-enters planning with the answers). Shared with the BROWSER lane
  // via runComputerTaskClarifierCheck (P57 parity). Never runs on a
  // buildout-retry pass (the task was already clarified before the gap).
  if (!readyCapabilityBuildout) {
    const clarification = await runComputerTaskClarifierCheck({
      task: args.task,
      circleId: args.circleId,
      userId: args.userId,
      executionSummary: `${execution.preview.kind} · ${execution.preview.label}`,
      appResolutionName: args.appResolution?.best?.displayName || null,
      hasAttachments: isAttachedDesktopFileTask,
      chatHistoryTail: args.chatHistory ? args.chatHistory.slice(-1500) : null,
      isLaunchOnly: execution.preview.kind === 'app_task' && !hasFollowUpIntent(args.task),
    });
    if (clarification) {
      return {
        adapterId: adapterIdForKind(execution.preview.kind),
        execution,
        response: clarification.message,
        warnings: [],
        clarification: {
          questions: clarification.questions,
          assumptions: clarification.assumptions,
        },
      };
    }
  }
  const attachedDesktopFiles = isAttachedDesktopFileTask ? parseDesktopAttachmentTaskFiles(args.task) : [];

  // 2.5 substitution visibility: capability flags (via
  // resolveComputerTaskLoopModel → getModelCapabilityFlags) decide whether
  // the user's selected model can drive the NATIVE screenshot/action loop.
  // Every executeAgentRun call below — the text-only planner/validator
  // steps — KEEPS args.model unchanged; only the native computer-use loop
  // (browser route) pins Sonnet, and when it will, the swap is surfaced as
  // a compact notice instead of happening silently. A model with
  // computerUse:true produces no notice at all.
  const loopModelResolution = resolveComputerTaskLoopModel(args.model);
  const modelResolution = loopModelResolution.substituted ? loopModelResolution : null;

  const warnings: string[] = [];
  if (modelResolution && adapterIdForKind(execution.preview.kind) === 'browser_adapter') {
    warnings.push(formatComputerTaskModelResolutionNotice(modelResolution));
  }
  if (!execution.readiness.ready && execution.readiness.missing.length > 0) {
    warnings.push(execution.readiness.summary);
  }
  if (execution.preflight.status !== 'ready') {
    warnings.push(execution.preflight.summary);
    warnings.push(...execution.preflight.blockers.map((item) => `${item.label}: ${item.fix}`));
    warnings.push(...execution.preflight.warnings.map((item) => `${item.label}: ${item.fix}`));
  }
  if (execution.grants.approvalSummary) {
    warnings.push(execution.grants.approvalSummary);
  }

  // E1: live capability status per control-surface id, fed to the adapter so
  // the escalation policy can demote 'partial' rungs and exclude 'missing'
  // ones when a failure asks for a descent.
  // L4: learned per-app facts (device storage, per circle) layer conservative
  // hints onto the audit statuses — audit WINS on conflict; learned hints only
  // fill gaps or demote repeatedly-failing rungs, never promote a rung the
  // audit says is missing or partial.
  const learnedFactsAppKey = normalizeAppKey(inferAppNameForCapabilityBuildout(args.task) || '');
  const learnedFacts: AppLearnedFacts | null = learnedFactsAppKey
    ? await loadAppLearnedFacts(args.circleId, learnedFactsAppKey).catch(() => null)
    : null;
  const capabilityStatusById = mergeCapabilityStatusWithLearnedHints(
    deriveSurfaceCapabilityStatusFromAudit(args.audit),
    deriveCapabilityHintsFromFacts(learnedFacts),
  );
  let surfaceEscalations: ComputerTaskSurfaceEscalation[] | null = null;
  let pendingEscalation: PendingSurfaceDescent | null = null;
  let deterministicDescentMessage: string | null = null;

  // L4: fold the run outcome (final surface + E1 breadcrumbs) into the
  // learned facts. Success paths fire-and-forget; failure paths await the
  // updated facts so the L3 propose check can run on fresh evidence.
  // `exampleInjected` (when the L1 example seam was consulted) folds the
  // outcome into the assisted/unassisted gate buckets too — undefined (the
  // deterministic adapter + buildout-retry paths) touches neither bucket.
  const recordLearnedAppOutcome = async (
    ok: boolean,
    escalations: ComputerTaskSurfaceEscalation[] | null | undefined,
    exampleInjected?: boolean,
  ): Promise<AppLearnedFacts | null> => {
    if (!learnedFactsAppKey) return null;
    return recordAppLearnedFactsOutcome(args.circleId, learnedFactsAppKey, {
      surfaceId: inferRunSurfaceIdFromEscalations(escalations),
      ok,
      escalations,
      ...(typeof exampleInjected === 'boolean' ? { exampleInjected } : {}),
    }).catch(() => null);
  };

  // L3: at the end of a FAILED desktop/app task, consult the pure propose
  // trigger. On propose, route through the EXISTING connected-agent buildout
  // path. The proposal is a DRAFT for human approval — it is only filed when a
  // runId anchors the HITL approval row (openswanToolRuntime's 'ask' policy +
  // duplicate-pending guard); without that anchor, or when no connected agent
  // can take it, the proposal is recorded on the facts as unmet (reason
  // preserved for later buildout-UI surfacing) instead of auto-executing.
  const maybeProposeLearnedCapabilityBuildout = async (input: {
    updatedFacts: AppLearnedFacts | null;
    runId?: string | null;
    existingBuildout: ComputerTaskCapabilityBuildout | null | undefined;
    appAdapterMessage?: string | null;
    agentResponse?: string | null;
    errorMessage?: string | null;
  }): Promise<ComputerTaskCapabilityBuildout | null> => {
    if (!learnedFactsAppKey || !input.updatedFacts) return null;
    const decision = shouldProposeCapabilityBuildout(input.updatedFacts);
    if (!decision.propose) return null;
    if (input.existingBuildout) {
      // The per-run heuristic already filed a buildout this run — count it as
      // the proposal so the cooldown suppresses duplicate drafts.
      void recordAppLearnedFactsBuildoutProposal(args.circleId, learnedFactsAppKey, {
        filed: true,
        reason: decision.reason,
      });
      return null;
    }
    if (!canRequestCapabilityBuildout || !input.runId) {
      void recordAppLearnedFactsBuildoutProposal(args.circleId, learnedFactsAppKey, {
        filed: false,
        reason: decision.reason,
      });
      return null;
    }
    const proposed = await requestConnectedAppCapabilityBuildout({
      circleId: args.circleId,
      userId: args.userId,
      task: args.task,
      execution,
      appAdapterMessage: input.appAdapterMessage,
      agentResponse: input.agentResponse,
      errorMessage: input.errorMessage,
      warnings,
      learnedProposalReason: decision.reason,
      runId: input.runId,
    });
    void recordAppLearnedFactsBuildoutProposal(args.circleId, learnedFactsAppKey, {
      filed: Boolean(proposed && proposed.status !== 'failed'),
      reason: decision.reason,
    });
    return proposed;
  };

  // Deterministic local desktop sequences should execute locally even
  // when the preview labels the utterance "hybrid" because it mentions
  // both an app and a filename, e.g. "Open Photoshop and save the image
  // as test-it.jpg". Ready app-capability retries must still use the
  // capability-aware prompt so the newly built adapter context is tested.
  if (!isAttachedDesktopFileTask && shouldRunLocalComputerAwarenessIntentSequence(args.task, { hasReadyCapabilityBuildout: Boolean(readyCapabilityBuildout) })) {
    const appResult = await executeComputerAppTask({
      circleId: args.circleId,
      task: args.task,
      capabilityStatusById,
    });
    surfaceEscalations = appResult.surfaceEscalations || null;
    if (appResult.surfaceEscalation?.action === 'descend') {
      // E1: the deterministic rung failed and the policy descended — continue
      // on the next-ranked control surface via the agent loop below (fresh
      // observation + approval gate enforced there) instead of returning the
      // raw failure for a manual replan.
      warnings.push(...appResult.warnings);
      pendingEscalation = appResult.surfaceEscalation;
      deterministicDescentMessage = appResult.message;
    } else {
      // Success, a retry_same hint, or a stop (the message already carries the
      // attempted-surface history for recovery) — return as before.
      if (appResult.ok) {
        void recordLearnedAppOutcome(true, surfaceEscalations);
      } else {
        // L4 + L3: fold the failure, then check the propose trigger. No runId
        // exists on this deterministic path, so a propose is recorded as an
        // unmet proposal on the facts rather than dispatched.
        const updatedFacts = await recordLearnedAppOutcome(false, surfaceEscalations);
        await maybeProposeLearnedCapabilityBuildout({
          updatedFacts,
          runId: null,
          existingBuildout: null,
          appAdapterMessage: appResult.message,
        });
      }
      return {
        adapterId: 'app_adapter',
        execution,
        response: appResult.message,
        surfaceEscalations,
        modelResolution,
        warnings: [...warnings, ...appResult.warnings],
      };
    }
  }

  if (execution.preview.kind === 'file_task' && !pendingEscalation) {
    const fileResult = await executeComputerFileTask({
      circleId: args.circleId,
      task: args.task,
    });
    return {
      adapterId: 'file_adapter',
      execution,
      response: fileResult.message,
      modelResolution,
      warnings: [...warnings, ...fileResult.warnings],
    };
  }

  // UC-5 follow-up: "open Notes and create a note" was returning right
  // after the bridge launch because appResult.ok short-circuited the
  // runtime. That's correct for pure-launch intents ("open Zoom") but
  // wrong for multi-verb requests where the user wants follow-up
  // actions inside the app. Detect the difference and let multi-intent
  // utterances fall through to the agent loop (which has desktop.*
  // tools and can press Cmd+N / type / etc.).
  let appAdapterMessage: string | null = deterministicDescentMessage;
  let appBridgeLaunched = false;
  if (execution.preview.kind === 'app_task' && !pendingEscalation) {
    const appResult = await executeComputerAppTask({
      circleId: args.circleId,
      task: args.task,
      capabilityStatusById,
    });
    warnings.push(...appResult.warnings);
    surfaceEscalations = appResult.surfaceEscalations || surfaceEscalations;
    const escalation = appResult.surfaceEscalation || null;
    if (escalation?.action === 'stop') {
      // E1 stop: never send the agent off to keep mutating around a stop
      // decision (approval/user blockers, exhausted ladder). Fail with the
      // attempted-surface history (already appended to the message) so the
      // existing recovery/buildout diagnosis can pick the next move.
      const capabilityBuildout = canRequestCapabilityBuildout
        ? await requestConnectedAppCapabilityBuildout({
            circleId: args.circleId,
            userId: args.userId,
            task: args.task,
            execution,
            appAdapterMessage: appResult.message,
            errorMessage: escalation.reason,
            warnings,
          })
        : readyCapabilityBuildout;
      // L4 + L3: an E1 stop is a failed app task. Fold the failure (with the
      // breadcrumbs), then run the propose trigger — with no runId here, a
      // propose either rides the heuristic buildout above (cooldown stamp) or
      // is recorded as unmet on the facts.
      const updatedFacts = await recordLearnedAppOutcome(false, surfaceEscalations);
      await maybeProposeLearnedCapabilityBuildout({
        updatedFacts,
        runId: null,
        existingBuildout: canRequestCapabilityBuildout ? capabilityBuildout : null,
        appAdapterMessage: appResult.message,
        errorMessage: escalation.reason,
      });
      return {
        adapterId: 'app_adapter',
        execution,
        response: [appResult.message, visibleCapabilityBuildoutMessage(capabilityBuildout)].filter(Boolean).join('\n\n'),
        capabilityBuildout,
        surfaceEscalations,
        modelResolution,
        warnings,
      };
    }
    if (escalation?.action === 'descend') {
      // Breadcrumb already recorded on the adapter result; the agent run
      // below continues on the new rung with a forced fresh observation.
      pendingEscalation = escalation;
    }
    const wasBridgeLaunch = (appResult.data as any)?.kind === 'desktop_bridge_launch';
    // A capability gap (no adapter matched) is NOT a success even when the
    // adapter returns ok:true with a surface inventory — it must reach the
    // buildout gate, not short-circuit as a pure launch.
    const isCapabilityGap = (appResult.data as any)?.kind === 'app_capability_gap';
    const isCompletedDesktopSequence = (appResult.data as any)?.kind === 'desktop_action_sequence';
    if (appResult.ok && !isCapabilityGap && (!hasFollowUpIntent(args.task) || isCompletedDesktopSequence) && !readyCapabilityBuildout) {
      // Pure launch or a completed single-shot app action — no agent needed.
      void recordLearnedAppOutcome(true, surfaceEscalations); // L4
      return {
        adapterId: 'app_adapter',
        execution,
        response: appResult.message,
        modelResolution,
        warnings,
      };
    }
    // Multi-intent, a capability gap, or a non-launch failure: carry the
    // adapter message so the agent prompt + buildout gate can act on it
    // (this is what routes a single-verb "no adapter" task to buildout).
    appAdapterMessage = appResult.message;
    appBridgeLaunched = wasBridgeLaunch;
  }
  if (attachedDesktopFiles.length > 0) {
    const openMessages: string[] = [];
    let openedAnyAttachedFile = false;
    for (const file of selectDesktopAttachmentsToPreOpen(attachedDesktopFiles, args.task, 4)) {
      const opened = await bridgeOpenPath(file.localPath, file.appName ? { appName: file.appName } : {});
      if (!opened.ok) {
        warnings.push(`uploaded file open failed for ${file.name}: ${opened.error || opened.errorCode || 'unknown bridge error'}`);
        openMessages.push(`Could not pre-open **${file.name}** at **${file.localPath}**: ${opened.error || opened.errorCode || 'unknown bridge error'}.`);
        continue;
      }
      if (file.appName) {
        await bridgeWaitForApp(file.appName, 12_000).catch(() => null);
      }
      openedAnyAttachedFile = true;
      openMessages.push(`Pre-opened uploaded file **${file.name}** at **${opened.data?.path || file.localPath}**${file.appName ? ` in **${file.appName}**` : ''}.`);
    }
    if (openMessages.length > 0) {
      appAdapterMessage = [appAdapterMessage, ...openMessages].filter(Boolean).join('\n');
      appBridgeLaunched = appBridgeLaunched || openedAnyAttachedFile;
    }
  }

  const shouldInjectGenericNavigator =
    execution.preflight.strategy?.id === 'universal_app_control'
    || execution.computerAppGrounding?.strategy.id === 'universal_app_control'
    || shouldUseGenericAppNavigator(args.task);
  const genericNavigatorPreamble = shouldInjectGenericNavigator
    ? `${formatGenericAppNavigatorPromptBlock(args.task)}\n\n`
    : '';
  const followUpPreamble = appAdapterMessage
    ? `Bridge already ${appBridgeLaunched ? 'launched the target app' : 'attempted the app action'}: ${appAdapterMessage}\n`
      + 'Continue from there — use desktop.wait_for_app / desktop.window_state / desktop.read_a11y_tree / desktop.menu_click / desktop.click_element / desktop.set_element_value / desktop.press_keys / desktop.type_text as needed. Do NOT re-launch.\n\n'
      + genericNavigatorPreamble
    : genericNavigatorPreamble;
  // E1 descend: continue on the next-ranked control surface. The block forces
  // a FRESH observation on the new rung before any mutation (the policy sets
  // freshObservationRequired on every descend) and gates any approvals the new
  // rung adds BEFORE acting — approvals are never widened silently.
  let escalationPreamble = '';
  if (pendingEscalation) {
    const next = pendingEscalation.next;
    if (pendingEscalation.extraApprovalsRequired.length > 0) {
      warnings.push(`surface escalation to ${next.id} needs approval before acting: ${pendingEscalation.extraApprovalsRequired.join('; ')}`);
    }
    escalationPreamble = [
      '## Surface escalation (mid-run)',
      pendingEscalation.reason,
      `Continue on the **${next.label}** rung (\`${next.id}\`). Do NOT retry the failed surface.`,
      'FRESH OBSERVATION REQUIRED: re-observe on this rung (desktop.window_state + desktop.read_a11y_tree; desktop.screenshot + desktop.screen_size for the coordinate rung) BEFORE any mutation — observations from the failed surface are stale here.',
      ...(pendingEscalation.extraApprovalsRequired.length > 0
        ? [`APPROVAL GATE: this rung requires approvals the previous rung did not. Request them via approvals.request and WAIT for the grant BEFORE any mutating action: ${pendingEscalation.extraApprovalsRequired.join('; ')}.`]
        : []),
      ...(next.requirements.length > 0
        ? [`Rung requirements: ${next.requirements.slice(0, 4).join('; ')}.`]
        : []),
    ].join('\n') + '\n\n';
  }
  // Observe-before-act: for desktop/app surfaces, read the live state and hand
  // the agent the re-decided ground truth before it acts. Skipped for
  // capability-buildout retries (own prompt) and non-desktop task shapes;
  // fail-open if the bridge can't observe.
  let observeBeforeActBlock = '';
  const isDesktopTraceTaskKind =
    execution.preview.kind === 'app_task' || execution.preview.kind === 'hybrid_task';
  if (!readyCapabilityBuildout && isDesktopTraceTaskKind) {
    const liveObservations = await captureLiveSurfaceObservations(args.audit);
    if (liveObservations.length > 0) {
      const block = buildObserveBeforeActPromptBlock(args.task, liveObservations, {
        auditEvidence: deriveAuditObservedEvidence(args.audit),
      });
      if (block) observeBeforeActBlock = `${block}\n\n`;
    }
  }
  // L1 retrieval-as-context: if this EXACT task (normalized like the edge
  // replay matcher) succeeded recently in this circle, inject the prior
  // redacted action trace as an EXAMPLE block — never a forced script.
  // Exact-match only (verified finding 5: self-experience retrieval can
  // regress strong models, so injection stays conservative). Skipped for
  // capability-buildout retries, which carry their own prompt.
  // Evidence gate (research open question 3): the per-app MEASURED
  // assisted-vs-unassisted record decides whether the example is injected —
  // UFO2 saw retrieved self-experience regress a strong model's overall
  // success even while helping recovery, so suppression is earned by numbers,
  // never assumed. No facts ⇒ inject (the verified default).
  // `desktopExampleInjected` stays null when the seam was never consulted so
  // those outcomes don't pollute either gate bucket.
  let desktopTraceExampleBlock = '';
  let desktopExampleInjected: boolean | null = null;
  if (!readyCapabilityBuildout && isDesktopTraceTaskKind) {
    desktopExampleInjected = false;
    const exampleGate = shouldInjectDesktopExample(learnedFacts);
    if (!exampleGate.inject) {
      warnings.push(`desktop example injection suppressed by learned evidence: ${exampleGate.reason}`);
    } else {
      try {
        const { findRecentDesktopActionTrace } = await import('./agentRunSystem');
        const priorTrace = await findRecentDesktopActionTrace(
          args.circleId,
          normalizeDesktopTaskText(args.task),
        );
        if (priorTrace) {
          const block = buildDesktopActionTraceExampleBlock(priorTrace);
          if (block) {
            desktopTraceExampleBlock = `${block}\n\n`;
            desktopExampleInjected = true;
            warnings.push(`desktop example injected from a prior successful run (${exampleGate.reason})`);
          }
        }
      } catch { /* trace retrieval is an optimization — never block the task */ }
    }
  }
  const prompt = readyCapabilityBuildout
    ? buildAgentAppCapabilityRetryPrompt({
        task: args.task,
        appName: readyCapabilityBuildout.appName,
        summary: readyCapabilityBuildout.summary,
        controlSurface: readyCapabilityBuildout.controlSurface,
        sourceRefs: readyCapabilityBuildout.sourceRefs,
        filesChanged: readyCapabilityBuildout.filesChanged,
        retryPlan: readyCapabilityBuildout.retryPlan,
        verification: readyCapabilityBuildout.verification,
        appAdapterMessage,
        dispatchPrefix: execution.dispatchPrefix,
      })
    : `${execution.dispatchPrefix}\n${observeBeforeActBlock}${escalationPreamble}${followUpPreamble}${desktopTraceExampleBlock}USER COMPUTER TASK\n${args.task}`;

  // Belt-and-suspenders: if executeAgentRun throws (provider outage,
  // v2 continuation cap, model returns null), we still need to surface
  // SOMETHING to the user — otherwise the chat renders empty ("just
  // refreshed the chat" bug). Capture + fall back to a message that
  // at least confirms the bridge launch and names the error.
  let result: AgentRunResult;
  try {
    result = await executeAgentRun({
      surface: 'main_chat',
      circleId: args.circleId,
      userId: args.userId,
      userName: args.userName,
      prompt,
      model: args.model,
      mode: execution.recommendedMode,
      capabilityProfile: execution.capabilityProfile,
      context: {
        chatHistory: args.chatHistory,
        sessionArchiveContext: args.sessionArchiveContext,
        replyTo: args.replyTo,
      },
    });
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    warnings.push(`agent follow-up failed: ${errMsg}`);
    const capabilityBuildout = canRequestCapabilityBuildout
      ? await requestConnectedAppCapabilityBuildout({
          circleId: args.circleId,
          userId: args.userId,
          task: args.task,
          execution,
          appAdapterMessage,
          errorMessage: errMsg,
          warnings,
        })
      : readyCapabilityBuildout;
    // L4 + L3: the agent run itself failed — fold the failure and run the
    // propose trigger (no runId on a thrown run → propose is recorded on the
    // facts, never dispatched).
    if (isDesktopTraceTaskKind) {
      const updatedFacts = await recordLearnedAppOutcome(false, surfaceEscalations, desktopExampleInjected ?? undefined);
      await maybeProposeLearnedCapabilityBuildout({
        updatedFacts,
        runId: null,
        existingBuildout: canRequestCapabilityBuildout ? capabilityBuildout : null,
        appAdapterMessage,
        errorMessage: errMsg,
      });
    }
    const retryAttempt = await retryComputerTaskAfterReadyCapabilityBuildout({
      task: args.task,
      circleId: args.circleId,
      userId: args.userId,
      userName: args.userName,
      model: args.model,
      execution,
      capabilityBuildout,
      appAdapterMessage,
      chatHistory: args.chatHistory,
      sessionArchiveContext: args.sessionArchiveContext,
      replyTo: args.replyTo,
    });
    if (retryAttempt?.warning) warnings.push(retryAttempt.warning);
    // L4 (post-retry gap): fold the buildout-retry outcome into the learned
    // facts via the same recording closure — a success after buildout is
    // exactly the signal that resets the failure/a11y counters and records
    // lastSuccessSurfaceId; a thrown retry is one more genuine failure.
    // exampleInjected stays undefined: the retry prompt has no example seam.
    if (retryAttempt && isDesktopTraceTaskKind) {
      void recordLearnedAppOutcome(Boolean(retryAttempt.response), surfaceEscalations);
    }
    if (retryAttempt?.response) {
      const retriedAt = new Date().toISOString();
      const retriedCapabilityBuildout = capabilityBuildout
        ? {
            ...capabilityBuildout,
            autoRetryStatus: 'completed' as const,
            autoRetryAttemptedAt: capabilityBuildout.autoRetryAttemptedAt || retriedAt,
            autoRetryCompletedAt: retriedAt,
            autoRetryRunId: retryAttempt.runId || capabilityBuildout.autoRetryRunId || null,
            updatedAt: retriedAt,
          }
        : capabilityBuildout;
      return {
        adapterId: adapterIdForKind(execution.preview.kind),
        execution,
        response: [visibleCapabilityBuildoutMessage(retriedCapabilityBuildout), retryAttempt.response].filter(Boolean).join('\n\n'),
        runId: retryAttempt.runId || null,
        modeOutcomeSummary: retryAttempt.modeOutcomeSummary,
        observedEval: retryAttempt.observedEval,
        handoffSuggestion: retryAttempt.handoffSuggestion,
        capabilityBuildout: retriedCapabilityBuildout,
        surfaceEscalations,
        modelResolution,
        warnings,
      };
    }
    const fallback = appAdapterMessage
      ? `${appAdapterMessage}\n\n**Agent follow-up failed:** ${errMsg}\n\nThe app opened, but I couldn't complete the rest of the task. Try again or break it into smaller steps.`
      : `Agent follow-up failed: ${errMsg}`;
    return {
      adapterId: adapterIdForKind(execution.preview.kind),
      execution,
      response: [fallback, visibleCapabilityBuildoutMessage(capabilityBuildout)].filter(Boolean).join('\n\n'),
      runId: null,
      capabilityBuildout,
      surfaceEscalations,
      modelResolution,
      warnings,
    };
  }

  // Another silent-failure gap: executeAgentRun can return an empty
  // string when every provider tier punts. Keep the bridge-launch
  // message visible so the user isn't looking at a blank bubble.
  const agentResponse = String(result.response || '').trim();
  const heuristicCapabilityBuildout = canRequestCapabilityBuildout
    ? await requestConnectedAppCapabilityBuildout({
        circleId: args.circleId,
        userId: args.userId,
        task: args.task,
        execution,
        appAdapterMessage,
        agentResponse,
        warnings,
      })
    : readyCapabilityBuildout;
  // L4: record the run outcome. Failed = no usable agent response, or the
  // per-run heuristic detected a capability gap and filed a buildout.
  // L3: on failure, run the propose trigger. This is the one seam with a run
  // anchor (result.runId), so a propose that the heuristic missed files the
  // buildout DRAFT through the existing path with the HITL approval attached
  // (status `approval_required`) — it never executes before a human decision.
  let learnedProposalBuildout: ComputerTaskCapabilityBuildout | null = null;
  if (isDesktopTraceTaskKind) {
    const learnedRunFailed = !agentResponse
      || Boolean(canRequestCapabilityBuildout && heuristicCapabilityBuildout);
    if (learnedRunFailed) {
      const updatedFacts = await recordLearnedAppOutcome(false, surfaceEscalations, desktopExampleInjected ?? undefined);
      learnedProposalBuildout = await maybeProposeLearnedCapabilityBuildout({
        updatedFacts,
        runId: result.runId || null,
        existingBuildout: canRequestCapabilityBuildout ? heuristicCapabilityBuildout : null,
        appAdapterMessage,
        agentResponse,
      });
    } else {
      void recordLearnedAppOutcome(true, surfaceEscalations, desktopExampleInjected ?? undefined);
    }
  }
  const capabilityBuildout = heuristicCapabilityBuildout || learnedProposalBuildout;
  const retryAttempt = await retryComputerTaskAfterReadyCapabilityBuildout({
    task: args.task,
    circleId: args.circleId,
    userId: args.userId,
    userName: args.userName,
    model: args.model,
    execution,
    capabilityBuildout,
    appAdapterMessage,
    chatHistory: args.chatHistory,
    sessionArchiveContext: args.sessionArchiveContext,
    replyTo: args.replyTo,
  });
  if (retryAttempt?.warning) warnings.push(retryAttempt.warning);
  // L4 (post-retry gap): fold the buildout-retry outcome into the learned
  // facts via the same closure semantics — success after buildout resets
  // failure counters / sets lastSuccessSurfaceId. The main run's outcome was
  // already recorded above; this records the RETRY run. exampleInjected stays
  // undefined: the capability-retry prompt never carries the example block.
  if (retryAttempt && isDesktopTraceTaskKind) {
    void recordLearnedAppOutcome(Boolean(retryAttempt.response), surfaceEscalations);
  }
  if (retryAttempt?.response) {
    const retriedAt = new Date().toISOString();
    const retriedCapabilityBuildout = capabilityBuildout
      ? {
          ...capabilityBuildout,
          autoRetryStatus: 'completed' as const,
          autoRetryAttemptedAt: capabilityBuildout.autoRetryAttemptedAt || retriedAt,
          autoRetryCompletedAt: retriedAt,
          autoRetryRunId: retryAttempt.runId || capabilityBuildout.autoRetryRunId || null,
          updatedAt: retriedAt,
        }
      : capabilityBuildout;
    return {
      adapterId: adapterIdForKind(execution.preview.kind),
      execution,
      response: [visibleCapabilityBuildoutMessage(retriedCapabilityBuildout), retryAttempt.response].filter(Boolean).join('\n\n'),
      runId: retryAttempt.runId || result.runId,
      modeOutcomeSummary: retryAttempt.modeOutcomeSummary || result.modeOutcomeSummary,
      observedEval: retryAttempt.observedEval || result.observedEval,
      handoffSuggestion: retryAttempt.handoffSuggestion || result.handoffSuggestion,
      capabilityBuildout: retriedCapabilityBuildout,
      surfaceEscalations,
      modelResolution,
      warnings,
    };
  }
  const combinedResponse = agentResponse
    ? (appAdapterMessage ? `${appAdapterMessage}\n\n${agentResponse}` : agentResponse)
    : (appAdapterMessage
        ? `${appAdapterMessage}\n\n_(Agent didn't return follow-up text. The app is open — say what to do next and I'll continue from there.)_`
        : '(No response from the agent — try rephrasing.)');

  // L1 success-only persistence + write-back: only the clean-success path
  // stores a trace (desktop/app/hybrid kind, run row present, real agent
  // response, no capability-buildout escalation, no mid-run surface
  // escalations — perturbed-rung traces are brittle per verified finding 4).
  // A run that consumed an example block and succeeded persists its NEW
  // trace here, so the newest successful trace wins on the next retrieval.
  if (
    isDesktopTraceTaskKind
    && result.runId
    && agentResponse
    && !capabilityBuildout
    && !pendingEscalation
    && (!surfaceEscalations || surfaceEscalations.length === 0)
  ) {
    void persistDesktopActionTraceForRun({
      runId: result.runId,
      circleId: args.circleId,
      userId: args.userId,
      task: args.task,
      sinceIso: desktopTraceTaskStartedAtIso,
    });
  }

  return {
    adapterId: adapterIdForKind(execution.preview.kind),
    execution,
    response: [combinedResponse, visibleCapabilityBuildoutMessage(capabilityBuildout)].filter(Boolean).join('\n\n'),
    runId: result.runId,
    modeOutcomeSummary: result.modeOutcomeSummary,
    observedEval: result.observedEval,
    handoffSuggestion: result.handoffSuggestion,
    capabilityBuildout,
    surfaceEscalations,
    modelResolution,
    warnings,
  };
}
