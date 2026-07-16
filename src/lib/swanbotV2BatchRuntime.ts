/**
 * swanbotV2BatchRuntime — the INERT, flag-gated loop-convergence runtime.
 *
 * CONSOLIDATE #1 (`docs/adr/ADR-0002-loop-convergence.md`,
 * `docs/LOOP_CONVERGENCE_RUNBOOK.md` §2). This is the thin runtime that repoints
 * the `batch` chat lane's `callSwanBotV2` (`src/lib/swanbot.ts`) off the
 * `swanbot-v2-ai` edge round-trip and onto the client-side
 * `agentExecutionCore.runAgent` loop — via the committed adapter
 * `v2ToAgentCoreAdapterCore` and the `swanbot-ai` relay as provider. It COMPOSES
 * existing exports (no new engine), mirroring the proven `runTypedCoreToolLoop`
 * reference impl (`openswanSessionRuntime.ts:542`) without editing it.
 *
 * INERT (Phase 1): ZERO call sites. Nothing here consults the rollout flag
 * (`swanbotV2ClientLoopFlag`); the flag guard is the SEPARATE, coordinated
 * Phase-2 one-line delegation inside `swanbot.ts`. So this module carries zero
 * conflict risk on the hot `swanbot.ts` file and deleting it is a no-op until
 * that guard lands (runbook §1, ADR R6).
 *
 * DROP-IN CONTRACT: `runSwanbotV2Batch` matches `callSwanBotV2`'s positional
 * params + `V2CallResult` return shape EXACTLY, plus ONE trailing options bag
 * (`extra`) carrying the caller-built system prompt + volatile context. The edge
 * built its system prompt server-side (`buildFrozenBlock` + `MODE_CONTRACT`);
 * client-side that assembly lives in `swanbot.ts` internals, so it is supplied
 * as a param rather than imported here — keeping this module buildable without
 * touching `swanbot.ts` (runbook §2.2). The Phase-2 flip is therefore a single
 * line; see the module footer for the exact guard.
 *
 * TELEMETRY PARITY IS THE GATE (runbook §3): a client-loop `agent_runs` row must
 * be indistinguishable from the edge row it replaces. The four BLOCKING de-risk
 * requirements (runbook §0.5) are addressed inline and flagged `DE-RISK #n`.
 */

import { supabase } from './supabase';
import { getFreshAccessToken } from './authSession';
import {
  runAgent,
  type AgentEvent,
  type AgentMessage,
  type AgentProvider,
  type AgentToolDefinition,
} from './agentExecutionCore';
import { createPersistedRun } from './agentRunPersistence';
import { updateRunStatus } from './agentRunSystem';
import {
  toAgentCoreMessages,
  toAgentCoreToolDefs,
  fromAgentCoreResult,
} from './v2ToAgentCoreAdapterCore';
import {
  accumulateUsageFromEvents,
  agentEventToActivity,
  type AgentActivityRow,
} from './v2AgentEventActivityCore';
import { buildSnapshotAwareInitialMessages } from './circleSnapshotContextInjection';
import { getOpenSwanToolsForSurface } from './openswanBridge';
import type { OpenSwanRuntimeToolContext } from './openswanToolRuntime';
import {
  buildSwanbotToolTurnBody,
  toAnthropicToolShapes,
  parseSwanbotToolTurnData,
  createLegacyApprovalGateAdapter,
  type LegacyToolApprovalGate,
} from './openswanSessionRuntimeAdapters';
import {
  resolveV2BatchModel,
  resolveV2BatchMode,
  buildV2BatchRunTitle,
  buildV2BatchTerminalRow,
  buildV2BatchErrorRow,
  V2_BATCH_RUN_VERSION,
  V2_BATCH_RUN_SURFACE,
  V2_BATCH_DEFAULT_TARGET_AGENT,
  V2_BATCH_MAX_ITERATIONS,
} from './swanbotV2BatchRuntimeCore';

/** Same shape as the batch lane's private `V2BodyError` (`swanbot.ts`). */
export type SwanbotV2BatchBodyError = { code?: string; message: string };

/**
 * Same shape as the batch lane's private `V2CallResult` (`swanbot.ts`): the
 * terminal answer (`null` when v2 couldn't produce one) plus an optional
 * `bodyError` for a permanent-config reject (e.g. `model_unsupported_on_v2`)
 * that the orchestrator surfaces without counting toward the transport breaker.
 * Structurally identical, so the Phase-2 `return runSwanbotV2Batch(...)` inside
 * `callSwanBotV2` type-checks with no cast.
 */
export type SwanbotV2BatchResult = { text: string | null; bodyError?: SwanbotV2BatchBodyError };

/**
 * The caller-supplied context the edge built server-side and the drop-in
 * positional params cannot carry. Everything except `systemPrompt` is optional.
 */
export type SwanbotV2BatchContext = {
  /**
   * The FROZEN/cache-hot system prompt — the client-side equivalent of the
   * edge's `buildFrozenBlock` + `[MODE RESPONSE CONTRACT]` block. Built by the
   * Phase-2 caller from `swanbot.ts`'s own `buildSystemPromptAsync(...)` (+ the
   * mirrored `MODE_CONTRACT` line) and passed in verbatim (runbook §2.2).
   */
  systemPrompt: string;
  /**
   * Volatile Circle Context Snapshot + BlackSwan grounding block, injected as a
   * user-role context message AHEAD of the user turn so the frozen prompt stays
   * cache-hot (R15/O7). `null`/absent ⇒ no snapshot message (runbook §2.3).
   */
  snapshotContextMessage?: string | null;
  /** STOP-button cancellation the edge never had — aborts at a loop boundary. */
  signal?: AbortSignal;
  /** Batch iteration budget. Default `V2_BATCH_MAX_ITERATIONS` (edge cap = 5). */
  maxIterations?: number;
  /** Persisted target-agent name. Default `BlackSwan` (edge parity). */
  targetAgentName?: string;
  /** Chat mode override; default derived from `thinkingLevel` (fast→talk, else build). */
  mode?: string;
  /** Optional pre-dispatch approval gate — session-path parity (runbook §2.6). */
  toolApprovalGate?: LegacyToolApprovalGate;
  /** Optional live-narration sink ("Reading the screen…") — §2.8 UX parity. */
  onActivity?: (row: AgentActivityRow) => void;
  /** Optional thread id (steering scope / tool ctx). */
  threadId?: string;
  /** Optional active plugin ids (tool ctx). */
  activePluginIds?: string[];
  /** Optional parsed "never do X" constraints for the dispatch backstop (QW1). */
  userConstraints?: OpenSwanRuntimeToolContext['userConstraints'];
};

/**
 * Drive one `batch`-lane chat turn through the client-side `runAgent` loop.
 * Signature + return mirror `callSwanBotV2` (positional params 1-10) so the
 * Phase-2 flip is a one-line drop-in; `extra` carries the caller-built prompt.
 *
 * Underscored params (`_discordContext`, `_wikiContext`, `_maxTokens`) are kept
 * for positional parity and are unused on the typed-loop path — exactly as they
 * are unused by the edge round-trip today.
 */
export async function runSwanbotV2Batch(
  message: string,
  circleId: string,
  userId: string,
  _discordContext: string | undefined,
  model: string | null | undefined,
  _wikiContext: string | undefined,
  conversationMessages: Array<{ role: string; content: string }> | undefined,
  thinkingLevel: 'fast' | 'balanced' | 'deep' = 'balanced',
  _maxTokens = 4096,
  systemDirective: string | undefined,
  extra: SwanbotV2BatchContext = { systemPrompt: '' },
): Promise<SwanbotV2BatchResult> {
  // ── 2.1 Fail-closed model gate (R4) — BEFORE any run row. ─────────────────
  // Mirror `index.ts:2922`: a MODEL_MAP alias or a qualified claude-* id passes;
  // anything else returns the SAME `{ code:'model_unsupported_on_v2' }` body so
  // the orchestrator's breaker classification + readiness cohort stay identical.
  const resolved = resolveV2BatchModel(model);
  if ('bodyError' in resolved) return { text: null, bodyError: resolved.bodyError };
  const loopModel = resolved.model;

  const mode = (typeof extra.mode === 'string' && extra.mode) || resolveV2BatchMode(thinkingLevel);
  const targetAgentName = extra.targetAgentName || V2_BATCH_DEFAULT_TARGET_AGENT;
  const maxIterations = Math.max(1, Math.floor(extra.maxIterations || V2_BATCH_MAX_ITERATIONS));

  // The frozen system prompt is caller-built (§2.2). Fold in the per-turn
  // `systemDirective` (a drop-in positional param) so it is never silently lost.
  const baseSystemPrompt = String(extra.systemPrompt || '');
  const systemPrompt =
    systemDirective && systemDirective.trim()
      ? `${baseSystemPrompt}\n\n${systemDirective.trim()}`
      : baseSystemPrompt;

  // ── §3 create the run WITH the cohort tags (surface + metadata.version). ──
  // createPersistedRun → createRun inserts `status:'queued'` with NO started_at.
  const handle = await createPersistedRun({
    circleId,
    userId,
    surface: V2_BATCH_RUN_SURFACE,
    provider: 'anthropic',
    model: loopModel,
    mode,
    title: buildV2BatchRunTitle(mode, message),
    metadata: { version: V2_BATCH_RUN_VERSION, targetAgent: targetAgentName },
  });

  // ── DE-RISK #1 (CRITICAL — started_at parity). ───────────────────────────
  // The readiness gate windows on `started_at`; a run created with a NULL
  // started_at is INVISIBLE to the completion-rate check, so the v2-client
  // cohort would silently vanish and never fail the gate. createRun sets no
  // started_at, so stamp it immediately by flipping to 'running' (updateRunStatus
  // sets started_at when status==='running' and none was supplied) — mirroring
  // the edge INSERT's `started_at: new Date().toISOString()` (index.ts:2940).
  if (handle) {
    try {
      await updateRunStatus(handle.run.id, 'running');
    } catch {
      /* non-fatal — a telemetry write must never break a user-visible run */
    }
  }

  // ── DE-RISK #3 (HIGH — usage from turn_end events). ──────────────────────
  // AgentRunResult carries NO usage; aggregate it from the loop's `turn_end`
  // events. We also stream every event into the persistence handle (durable
  // agent_run_events parity) and, optionally, into the live-narration sink.
  const turnEndEvents: AgentEvent[] = [];
  const onEvent = (event: AgentEvent) => {
    if (event.kind === 'turn_end') turnEndEvents.push(event);
    // Durable trajectory rows (turn_start/turn_end/tool_call_*/final_response),
    // fire-and-forget inside the handle — matches the edge's event writes.
    if (handle) {
      try {
        handle.onEvent(event);
      } catch {
        /* telemetry must never break the loop */
      }
    }
    // §2.8 UX parity: "Reading the screen…" / "Running tests…" narration.
    if (extra.onActivity) {
      try {
        const row = agentEventToActivity(event);
        if (row) extra.onActivity(row);
      } catch {
        /* narration is best-effort */
      }
    }
  };

  // ── DE-RISK #2 (HIGH — terminal-write-on-throw + orphan finalizer). ───────
  // Wrap runAgent + the terminal write in try/catch mirroring the edge: on
  // throw, write an EXPLICIT error row (final_stop_reason='error',
  // status='failed', KEEP metadata.version) so a crashed run never leaves a
  // clean/NULL stop reason the gate miscounts.
  try {
    // 2.3 initialMessages — v2 wire history (adapter) + the fresh seed turn.
    const history = toAgentCoreMessages(conversationMessages);
    const seed = buildSnapshotAwareInitialMessages({
      userMessage: message,
      snapshotContextMessage: extra.snapshotContextMessage ?? null,
    });
    const initialMessages: AgentMessage[] = [...history, ...seed];

    // 2.4 tools — advertise the canonical main_chat catalog; dispatch IN-PROCESS
    // via `toAgentCoreToolDefs` (the clientOnly split evaporates — the loop is
    // client-side). Handlers are bound by name back to the wrapped catalog (so
    // policy/approval/image-side-channel observers ride along — R3).
    const toolCtx: OpenSwanRuntimeToolContext = {
      circleId,
      userId,
      surface: V2_BATCH_RUN_SURFACE,
      runId: handle?.run.id,
      threadId: extra.threadId,
      activePluginIds: extra.activePluginIds,
      userConstraints: extra.userConstraints ?? null,
    };
    const catalog = getOpenSwanToolsForSurface(V2_BATCH_RUN_SURFACE, toolCtx, { mode });
    const handlerByName = new Map<string, AgentToolDefinition['handler']>(
      catalog.map((t) => [t.name, t.handler] as const),
    );
    const tools = toAgentCoreToolDefs(
      catalog.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        ...(t.input_examples ? { input_examples: t.input_examples } : {}),
        ...(t.interactive ? { interactive: t.interactive } : {}),
      })),
      { resolveHandler: (name) => handlerByName.get(name) },
    );

    // 2.5 provider — the swanbot-ai relay, one model turn per round, non-
    // streaming. Edge-fail parity: on a terminal invoke failure END the turn
    // with partial text — do NOT throw, or already-executed tool work is lost
    // (openswanSessionRuntime.ts:808-818) — BUT record the failure (relayFailed)
    // so a transport blip is not miswritten as a clean completion below.
    let relayFailed = false;
    const provider: AgentProvider = {
      turn: async ({ messages, tools: turnTools }) => {
        let data: unknown = null;
        let error: unknown = null;
        try {
          const accessToken = await getFreshAccessToken();
          const res = await supabase.functions.invoke('swanbot-ai', {
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
            body: buildSwanbotToolTurnBody({
              userMessage: message,
              circleId,
              userId,
              model: loopModel,
              systemPrompt,
              tools: toAnthropicToolShapes(turnTools),
              messages,
            }),
          });
          data = res.data;
          error = res.error;
        } catch (e) {
          error = e;
        }
        if (error || !data) {
          // Record the transport failure (handled after runAgent) but END the turn
          // gracefully so any tool work already executed this round is not lost.
          relayFailed = true;
          return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Tool-use call failed.' }] };
        }
        return parseSwanbotToolTurnData(data).turn;
      },
    };

    // 2.6 runAgent — nine reliability layers + STOP-button cancellation.
    const runResult = await runAgent({
      initialMessages,
      tools,
      provider,
      maxIterations,
      signal: extra.signal,
      onEvent,
      // Sequential dispatch (safe superset of legacy ordering, incl. approval
      // prompts) — same posture the session path holds until T8 is flipped on.
      parallelToolConcurrency: 1,
      ...(extra.toolApprovalGate
        ? { toolApprovalGate: createLegacyApprovalGateAdapter(extra.toolApprovalGate) }
        : {}),
    });

    // A swanbot-ai relay transport failure must NOT read as a clean completion —
    // that would inflate the readiness completion rate, fool the transport breaker
    // into 'success', and deny the caller's v1 fallback. Mirror the edge /
    // openswanSessionRuntime edgeFailed handling: write the error terminal row
    // (final_stop_reason='error', status='failed', cohort tag kept) and return null
    // so the orchestrator counts a transport_failure and falls back to v1.
    if (relayFailed) {
      if (handle) {
        try {
          await supabase
            .from('agent_runs')
            .update(
              buildV2BatchErrorRow({
                targetAgentName,
                errorMessage: 'swanbot-ai relay failure',
                completedAt: new Date().toISOString(),
              }),
            )
            .eq('id', handle.run.id);
        } catch (e) {
          console.warn('[swanbotV2BatchRuntime] relay-failure error row write failed:', e);
        }
      }
      return { text: null };
    }

    // 2.7 result — adapter maps AgentRunResult → the v2 response contract.
    // DE-RISK #3: aggregate usage from the collected turn_end events and pass it
    // to the adapter (do NOT trust its `{}` default).
    // DE-RISK #4: pass initialMessagesLength so the reconstructed toolCalls
    // trace counts only THIS run's tool_use blocks, not seeded history.
    const usage = accumulateUsageFromEvents(turnEndEvents);
    const v2 = fromAgentCoreResult(runResult, {
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: usage.outputTokens,
        cached_tokens: usage.cachedTokens,
      },
      initialMessagesLength: initialMessages.length,
    });

    // §3 terminal write — EXPLICIT + normalized (NOT finalize's raw path). One
    // terminal writer only, so no write races the raw one.
    if (handle) {
      const row = buildV2BatchTerminalRow({
        toolCalls: v2.toolCalls,
        iterations: runResult.iterations,
        finalStopReason: v2.stopReason,
        usage,
        targetAgentName,
        rawStopReason: String(runResult.stopReason),
        completedAt: new Date().toISOString(),
      });
      try {
        await supabase.from('agent_runs').update(row).eq('id', handle.run.id);
      } catch (e) {
        console.warn('[swanbotV2BatchRuntime] terminal row write failed:', e);
      }
    }

    // §2.7: return text only — the caller resolves friendly stop copy via
    // resolveChatStopMessage, exactly as it did for the edge terminal body.
    return { text: v2.text || null };
  } catch (err) {
    // DE-RISK #2: orphan finalizer — stamp the crashed run as a failed error
    // run (keeping the cohort tag) so it can never masquerade as a completion.
    if (handle) {
      try {
        await supabase
          .from('agent_runs')
          .update(
            buildV2BatchErrorRow({
              targetAgentName,
              errorMessage: err,
              completedAt: new Date().toISOString(),
            }),
          )
          .eq('id', handle.run.id);
      } catch (e) {
        console.warn('[swanbotV2BatchRuntime] error row write failed:', e);
      }
    }
    console.warn(
      '[swanbotV2BatchRuntime] run failed:',
      err instanceof Error ? err.message : String(err),
    );
    // Fail closed to the same terminal `null` a transport failure yields — the
    // caller's v1 safety net + breaker handle it (runbook §4).
    return { text: null };
  }
}

/*
 * ── Phase-2 flip (NOT in this workflow — a separate coordinated swanbot.ts
 *    commit, ADR R6). Inside `callSwanBotV2`, right AFTER the existing
 *    `if (shouldBlockExternalAiProvider('anthropic')) return { text: null };`
 *    guard (so the killswitch still covers both paths), add one line:
 *
 *      if (isSwanbotV2ClientLoopEnabled())
 *        return runSwanbotV2Batch(
 *          message, circleId, userId, _discordContext, model, _wikiContext,
 *          conversationMessages, thinkingLevel, _maxTokens, systemDirective,
 *          { systemPrompt, snapshotContextMessage },
 *        );
 *
 *    where `systemPrompt` is built from swanbot.ts's own buildSystemPromptAsync(...)
 *    (+ the mirrored MODE_CONTRACT line) and `snapshotContextMessage` from the
 *    already-imported buildCircleSnapshotContextMessage(...) / BlackSwan grounding.
 *    Flag DEFAULT OFF ⇒ no behavior change on merge.
 */
