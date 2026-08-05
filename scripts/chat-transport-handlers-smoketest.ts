/**
 * chat-transport-handlers-smoketest — locks in the C1 "single executor
 * handler map" factory (`createChatTransportHandlers`) and its integration
 * with the real `dispatchChatAutomationPlan`.
 *
 * Pure: no Supabase, no React Native — deps are mocked.
 * Run: `npm run smoke:chat-transport-handlers`
 */

import { readFileSync } from 'node:fs';
import {
  createChatTransportHandlers,
  getOutcomeStateRequests,
  type ChatTransportDeps,
  type ChatTransportStateRequests,
} from '../src/lib/chatTransportHandlers';
import {
  dispatchChatAutomationPlan,
  type ChatTransportContext,
  type ChatClarificationResumePending,
  type ChatClarificationResumeStore,
} from '../src/lib/runChatAutomationPlan';
import {
  buildChatAutomationPlan,
  ChatAutomationPlan,
  ChatAutomationExecutionKind,
} from '../src/lib/chatAutomationPlanner';
// The REAL conversational router (statically dependency-light by design —
// heavy deps are dynamically imported per intent case, none of which the
// cases below trigger). Used to assert the R8 no-re-detection contract.
import {
  detectConversationalIntent,
  executeConversationalIntent,
  executeDetectedConversationalIntent,
  __conversationalRouterDiagnostics,
} from '../src/lib/conversationalRouter';

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assert(ok: boolean, name: string) { if (!ok) fail(name); else pass(name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`); else pass(name);
}

const ctx: ChatTransportContext = { circleId: 'c1', userId: 'u1' };

function planFor(kind: ChatAutomationExecutionKind, overrides: Partial<ChatAutomationPlan> = {}): ChatAutomationPlan {
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: 'hi' },
    execution: { kind, routeId: null, commandText: 'hi' },
    risk: 'safe',
    approval: { required: false, reason: null },
    confidence: 0.5,
    notes: [],
    ...overrides,
  };
}

async function main() {
  // ─── ChatTab cutover guard: gated WP intents cannot fall back silently ──
  {
    const chatTabSource = readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8');
    const allowlistBlock = chatTabSource.match(/const isUnifiedConversationalIntentType =[\s\S]*?;/)?.[0] || '';
    assert(
      allowlistBlock.includes("intentType === 'wordpress_publish'")
        && allowlistBlock.includes("intentType === 'wordpress_schedule'"),
      'ChatTab guard: WordPress publish/schedule stay on the unified conversational allowlist',
    );
    assert(
      chatTabSource.includes("outcome.status === 'skipped' && outcome.data?.planModeRefusal")
        && chatTabSource.includes('Boolean(outcome.data?.planModeRefusal)'),
      'ChatTab guard: plan-mode refusal stops legacy WordPress fallback',
    );
  }

  // ─── only provided kinds appear in the map ─────────────────────────────
  {
    const handlers = createChatTransportHandlers({
      run_openswan: async () => ({ message: 'ran' }),
      local_reply: async () => ({ message: 'local' }),
    });
    const keys = Object.keys(handlers).sort();
    assertEqual(keys, ['local_reply', 'run_openswan'], 'map: only provided kinds present');
  }

  // ─── terminal path: plain chat dispatches only run_plain_chat ───────────
  {
    let plainRan = 0;
    let openswanRan = 0;
    let seenCommand = '';
    let seenModel: string | undefined;
    let seenThread: string | undefined;
    const plainPlan = buildChatAutomationPlan({ message: 'hello there' });
    const handlers = createChatTransportHandlers({
      run_plain_chat: async (dispatchedPlan, dispatchedCtx) => {
        plainRan += 1;
        seenCommand = dispatchedPlan.execution.commandText || '';
        seenModel = dispatchedCtx.model || undefined;
        seenThread = dispatchedCtx.threadId || undefined;
        return { message: 'plain ok', runId: 'plain-run-1' };
      },
      run_openswan: async () => {
        openswanRan += 1;
        return { message: 'should not run' };
      },
    });
    const outcome = await dispatchChatAutomationPlan(plainPlan, {
      handlers,
      ctx: { ...ctx, model: 'claude-haiku-4-5', threadId: 'thread-1' },
    });
    assertEqual(outcome.status, 'completed', 'terminal plain: completed');
    assertEqual(outcome.executionKind, 'run_plain_chat', 'terminal plain: execution kind preserved');
    assertEqual(plainRan, 1, 'terminal plain: run_plain_chat handler ran once');
    assertEqual(openswanRan, 0, 'terminal plain: run_openswan handler did not run');
    assertEqual(seenCommand, 'hello there', 'terminal plain: command text forwarded');
    assertEqual(seenModel, 'claude-haiku-4-5', 'terminal plain: ctx.model forwarded');
    assertEqual(seenThread, 'thread-1', 'terminal plain: ctx.threadId forwarded');
    assertEqual(outcome.runId, 'plain-run-1', 'terminal plain: runId forwarded');
    assert(Boolean(outcome.data?.chatAutomationPlanPreview), 'terminal plain: plan preview attached');
  }

  // ─── terminal path: selected OpenSwan mode dispatches run_openswan ──────
  {
    let plainRan = 0;
    let openswanRan = 0;
    let seenCommand = '';
    let seenChatMode: string | undefined;
    const openswanPlan = buildChatAutomationPlan({
      message: 'review the latest office run',
      selectedMode: 'review',
    });
    const handlers = createChatTransportHandlers({
      run_plain_chat: async () => {
        plainRan += 1;
        return { message: 'should not run' };
      },
      run_openswan: async (dispatchedPlan, dispatchedCtx) => {
        openswanRan += 1;
        seenCommand = dispatchedPlan.execution.commandText || '';
        seenChatMode = dispatchedCtx.chatMode || undefined;
        return { message: 'openswan ok', runId: 'openswan-run-1' };
      },
    });
    const outcome = await dispatchChatAutomationPlan(openswanPlan, {
      handlers,
      ctx: { ...ctx, chatMode: 'act', model: 'claude-opus-4-6', threadId: 'thread-2' },
    });
    assertEqual(outcome.status, 'completed', 'terminal openswan: completed');
    assertEqual(outcome.executionKind, 'run_openswan', 'terminal openswan: execution kind preserved');
    assertEqual(plainRan, 0, 'terminal openswan: run_plain_chat handler did not run');
    assertEqual(openswanRan, 1, 'terminal openswan: run_openswan handler ran once');
    assertEqual(seenCommand, 'review the latest office run', 'terminal openswan: command text forwarded');
    assertEqual(seenChatMode, 'act', 'terminal openswan: ctx.chatMode forwarded');
    assertEqual(outcome.runId, 'openswan-run-1', 'terminal openswan: runId forwarded');
    assert(Boolean(outcome.data?.chatAutomationPlanPreview), 'terminal openswan: plan preview attached');
  }

  // ─── terminal path: plan-mode safety gates before model work ────────────
  {
    let handlerRan = false;
    const plainPlan = buildChatAutomationPlan({ message: 'hello there' });
    const safeOpenSwanPlan = buildChatAutomationPlan({ message: 'review the latest office run', selectedMode: 'review' });
    const riskyOpenSwanPlan = planFor('run_openswan', { risk: 'external_side_effect' });
    const handlers = createChatTransportHandlers({
      run_plain_chat: async () => {
        handlerRan = true;
        return { message: 'plain plan ok' };
      },
      run_openswan: async () => {
        handlerRan = true;
        return { message: 'openswan plan ok' };
      },
    });
    const plainOutcome = await dispatchChatAutomationPlan(plainPlan, {
      handlers,
      ctx: { ...ctx, chatMode: 'plan' },
    });
    assertEqual(plainOutcome.status, 'completed', 'terminal plan-mode: run_plain_chat is allowed');
    const safeOpenSwanOutcome = await dispatchChatAutomationPlan(safeOpenSwanPlan, {
      handlers,
      ctx: { ...ctx, chatMode: 'plan' },
    });
    assertEqual(safeOpenSwanOutcome.status, 'completed', 'terminal plan-mode: safe run_openswan is allowed');
    handlerRan = false;
    const riskyOpenSwanOutcome = await dispatchChatAutomationPlan(riskyOpenSwanPlan, {
      handlers,
      ctx: { ...ctx, chatMode: 'plan' },
    });
    assertEqual(riskyOpenSwanOutcome.status, 'skipped', 'terminal plan-mode: risky run_openswan is refused');
    assertEqual(Boolean(riskyOpenSwanOutcome.data?.planModeRefusal), true, 'terminal plan-mode: refusal is marked');
    assertEqual(handlerRan, false, 'terminal plan-mode: risky handler did not run');
  }

  // ─── handler routes to its dep + returns completed ─────────────────────
  {
    let seenMessage = '';
    const handlers = createChatTransportHandlers({
      run_openswan: async (plan) => {
        seenMessage = plan.execution.commandText || '';
        return { message: 'done', runId: 'r1' };
      },
    });
    const outcome = await handlers.run_openswan!(planFor('run_openswan'), ctx);
    assertEqual(outcome.status, 'completed', 'handler: completed status');
    assertEqual(outcome.executionKind, 'run_openswan', 'handler: executionKind echoed');
    assertEqual(outcome.message, 'done', 'handler: message passthrough');
    assertEqual(outcome.runId, 'r1', 'handler: runId passthrough');
    assertEqual(seenMessage, 'hi', 'handler: dep received the plan');
  }

  // ─── dep returning handled:false → skipped (legacy fallback) ───────────
  {
    const handlers = createChatTransportHandlers({
      run_computer_task: async () => ({ handled: false }),
    });
    const outcome = await handlers.run_computer_task!(planFor('run_computer_task'), ctx);
    assertEqual(outcome.status, 'skipped', 'decline: skipped status');
    assertEqual(outcome.executionKind, 'skipped', 'decline: executionKind skipped');
  }

  // ─── dep that throws → failed (never throws across boundary) ───────────
  {
    const handlers = createChatTransportHandlers({
      run_openswan: async () => {
        throw new Error('boom /Users/private/secret.txt sk-live-secret');
      },
    });
    let threw = false;
    let outcome;
    try { outcome = await handlers.run_openswan!(planFor('run_openswan'), ctx); }
    catch { threw = true; }
    assert(!threw, 'throw: handler did not rethrow');
    assertEqual(outcome?.status, 'failed', 'throw: failed status');
    assert(!!outcome && outcome.message.includes('internal error'), 'throw: safe error message surfaced');
    const serializedOutcome = JSON.stringify(outcome);
    assertEqual((outcome?.data as any)?.errorCode, 'transport_handler_error', 'throw: stable error code surfaced');
    assertEqual((outcome?.data as any)?.redacted, true, 'throw: outcome is marked redacted');
    assert(!serializedOutcome.includes('boom'), 'throw: raw error omitted');
    assert(!serializedOutcome.includes('/Users/private/secret.txt'), 'throw: path omitted');
    assert(!serializedOutcome.includes('sk-live-secret'), 'throw: secret omitted');
  }

  // ─── custom status + data/warnings passthrough ─────────────────────────
  {
    const handlers = createChatTransportHandlers({
      run_circle_automation: async () => ({
        status: 'deferred', message: 'awaiting', data: { x: 1 }, warnings: ['w'], approvalId: 'a1',
      }),
    });
    const outcome = await handlers.run_circle_automation!(planFor('run_circle_automation'), ctx);
    assertEqual(outcome.status, 'deferred', 'custom: status passthrough');
    assertEqual((outcome.data as any)?.x, 1, 'custom: data passthrough');
    assertEqual(outcome.warnings, ['w'], 'custom: warnings passthrough');
    assertEqual(outcome.approvalId, 'a1', 'custom: approvalId passthrough');
  }

  // ─── integration: dispatcher picks the right handler by kind ───────────
  {
    let ranKind = '';
    const handlers = createChatTransportHandlers({
      run_openswan: async () => { ranKind = 'run_openswan'; return { message: 'ok' }; },
      local_reply: async () => { ranKind = 'local_reply'; return { message: 'local' }; },
    });
    const outcome = await dispatchChatAutomationPlan(planFor('run_openswan'), { handlers, ctx });
    assertEqual(ranKind, 'run_openswan', 'dispatch: routed to run_openswan dep');
    assertEqual(outcome.status, 'completed', 'dispatch: completed');
    assert(typeof outcome.durationMs === 'number', 'dispatch: durationMs stamped');
  }

  // ─── integration: build discovery dispatch carries prompt text ─────────
  {
    let seenBrief = '';
    const buildPlan = planFor('run_build_discovery', {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: 'build me a landing page for recruits' },
      execution: {
        kind: 'run_build_discovery',
        routeId: 'build_page',
        commandText: 'build me a landing page for recruits',
      },
    });
    const handlers = createChatTransportHandlers({
      run_build_discovery: async (dispatchedPlan) => {
        seenBrief = dispatchedPlan.execution.commandText || '';
        return {
          status: 'completed',
          data: { buildStreamStarted: true },
        };
      },
    });
    const outcome = await dispatchChatAutomationPlan(buildPlan, { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'dispatch: build discovery completed');
    assertEqual(outcome.executionKind, 'run_build_discovery', 'dispatch: build discovery kind preserved');
    assertEqual(seenBrief, 'build me a landing page for recruits', 'dispatch: build discovery received command text');
    assertEqual(outcome.data?.buildStreamStarted, true, 'dispatch: build discovery data passthrough');
    assert(!!outcome.data?.chatAutomationPlanPreview, 'dispatch: build discovery plan preview attached');
  }

  // ─── integration: un-wired kind → dispatcher skipped (legacy fallback) ─
  {
    const handlers = createChatTransportHandlers({ run_openswan: async () => ({ message: 'ok' }) });
    const outcome = await dispatchChatAutomationPlan(planFor('run_browser_plan'), { handlers, ctx });
    assertEqual(outcome.status, 'skipped', 'dispatch: unwired kind → skipped');
    assert(outcome.message.toLowerCase().includes('no handler'), 'dispatch: skip message explains fallback');
  }

  // ═══ R7 — handler state-request contract ════════════════════════════════

  // ─── stateRequests pass through the handler AND the dispatcher ─────────
  {
    const requested: ChatTransportStateRequests = {
      typing: false,
      modalToOpen: 'memory_viewer',
      workbench: { action: 'stop', kind: 'coding' },
    };
    const handlers = createChatTransportHandlers({
      run_command_handler: async () => ({ message: 'done', stateRequests: requested }),
    });
    const outcome = await dispatchChatAutomationPlan(planFor('run_command_handler'), { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'R7 passthrough: completed');
    assertEqual(getOutcomeStateRequests(outcome), requested, 'R7 passthrough: stateRequests survive dispatch');
  }

  // ─── decline (handled:false) still carries cleanup state requests ──────
  {
    const handlers = createChatTransportHandlers({
      run_command_handler: async () => ({ handled: false, stateRequests: { typing: false } }),
    });
    const outcome = await dispatchChatAutomationPlan(planFor('run_command_handler'), { handlers, ctx });
    assertEqual(outcome.status, 'skipped', 'R7 decline: skipped status');
    assertEqual(getOutcomeStateRequests(outcome)?.typing, false, 'R7 decline: cleanup requests still pass through');
  }

  // ─── ordering: apply-after-dispatch in finally → no stuck state ─────────
  // Simulates ChatTab's pattern: the dep turns typing ON mid-handler then
  // THROWS, so its cleanup state requests are lost. The dispatcher reports
  // `failed` with NO stateRequests, and the caller's finally falls back to
  // fail-safe defaults — typing cannot stay stuck.
  {
    const sequence: string[] = [];
    let typing = false;
    let workbenchRunning = false;
    let workbenchStarted = false;
    const handlers = createChatTransportHandlers({
      run_command_handler: async () => {
        sequence.push('handler');
        workbenchRunning = true; workbenchStarted = true; // mid-handler start (visible during work)
        typing = true; // mid-handler typing ON (visible during work)
        throw new Error('executor exploded');
      },
    });
    let outcome;
    try {
      outcome = await dispatchChatAutomationPlan(planFor('run_command_handler'), { handlers, ctx });
    } finally {
      sequence.push('apply');
      const requests = getOutcomeStateRequests(outcome) ?? {
        typing: false,
        ...(workbenchStarted ? { workbench: { action: 'stop' as const } } : {}),
      };
      if (typeof requests.typing === 'boolean') typing = requests.typing;
      if (requests.workbench?.action === 'stop') workbenchRunning = false;
    }
    assertEqual(outcome?.status, 'failed', 'R7 throw: dispatch reports failed');
    assertEqual(getOutcomeStateRequests(outcome), null, 'R7 throw: no stateRequests on a thrown handler');
    assertEqual(sequence, ['handler', 'apply'], 'R7 ordering: state applied AFTER dispatch settled');
    assertEqual(typing, false, 'R7 throw: typing not stuck');
    assertEqual(workbenchRunning, false, 'R7 throw: workbench not stuck');
  }

  // ─── ordering: plan-mode gate refusal → handler skipped, no stuck state ─
  {
    let handlerRan = false;
    let typing = true; // pretend an earlier path left typing on
    const handlers = createChatTransportHandlers({
      run_command_handler: async () => { handlerRan = true; typing = true; return { message: 'ran' }; },
    });
    const destructivePlan = planFor('run_command_handler', { risk: 'destructive' });
    let outcome;
    try {
      outcome = await dispatchChatAutomationPlan(destructivePlan, {
        handlers,
        ctx: { ...ctx, chatMode: 'plan' },
      });
    } finally {
      const requests = getOutcomeStateRequests(outcome) ?? { typing: false };
      if (typeof requests.typing === 'boolean') typing = requests.typing;
    }
    assertEqual(outcome?.status, 'skipped', 'R7 gate: plan-mode refusal → skipped');
    assert(!handlerRan, 'R7 gate: handler never ran');
    assertEqual(typing, false, 'R7 gate: typing reset by the finally fail-safe');
  }

  // ═══ R8 — no re-classification on the detected-intent executor path ═════

  // ─── new path: planner intent → executeDetectedConversationalIntent ────
  // Mirrors ChatTab's memory-family dep: read `plan.intent.intent` and call
  // the detected-intent executor. `detectConversationalIntent` must NOT run.
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    const memoryPlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: { kind: 'conversational_action', intent: { type: 'show_memories' }, routeId: null },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async (dispatchedPlan) => {
        if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
        const result = await executeDetectedConversationalIntent(dispatchedPlan.intent.intent, {
          circleId: 'c1', userId: 'u1', fullMessage: 'what do you remember about us?',
        });
        if (result?.handled && result.message === '__SHOW_MEMORIES__') {
          return { status: 'completed', stateRequests: { typing: false, modalToOpen: 'memory_viewer' } };
        }
        return { handled: false };
      },
    });
    const outcome = await dispatchChatAutomationPlan(memoryPlan, { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'R8 new path: executor handled the detected intent');
    assertEqual(getOutcomeStateRequests(outcome)?.modalToOpen, 'memory_viewer', 'R8 new path: __SHOW_MEMORIES__ → modal request');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 new path: detectConversationalIntent NOT called');
  }

  // ─── new path: remember → detected executor → memory seam ──────────────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenContent = '';
    const memoryPlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: { kind: 'conversational_action', intent: { type: 'remember', content: 'Chris prefers Go' }, routeId: 'memory' },
      execution: { kind: 'run_command_handler', routeId: 'memory', commandText: 'Remember that Chris prefers Go' },
      risk: 'safe',
      approval: { required: false, reason: null },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async (dispatchedPlan) => {
        if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
        const result = await executeDetectedConversationalIntent(dispatchedPlan.intent.intent, {
          circleId: 'c1',
          userId: 'u1',
          fullMessage: 'Remember that Chris prefers Go',
          executeRemember: async (input) => {
            seenContent = input.content;
          },
        });
        if (result?.handled) return { status: 'completed', message: result.message, stateRequests: { typing: false } };
        return { handled: false };
      },
    });
    const outcome = await dispatchChatAutomationPlan(memoryPlan, { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'R8 remember path: executor handled the detected intent');
    assertEqual(seenContent, 'Chris prefers Go', 'R8 remember path: remembered content preserved');
    assertEqual(outcome.message.includes('Remembered'), true, 'R8 remember path: result message returned');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 remember path: detectConversationalIntent NOT called');
  }

  // ─── new path: forget → detected executor → memory seam ────────────────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenQuery = '';
    const memoryPlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: { kind: 'conversational_action', intent: { type: 'forget', query: 'old stack' }, routeId: 'memory' },
      execution: { kind: 'run_command_handler', routeId: 'memory', commandText: 'Forget the old stack preference' },
      risk: 'safe',
      approval: { required: false, reason: null },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async (dispatchedPlan) => {
        if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
        const result = await executeDetectedConversationalIntent(dispatchedPlan.intent.intent, {
          circleId: 'c1',
          userId: 'u1',
          fullMessage: 'Forget the old stack preference',
          executeForget: async (input) => {
            seenQuery = input.query;
            return { forgotten: 2 };
          },
        });
        if (result?.handled) return { status: 'completed', message: result.message, stateRequests: { typing: false } };
        return { handled: false };
      },
    });
    const outcome = await dispatchChatAutomationPlan(memoryPlan, { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'R8 forget path: executor handled the detected intent');
    assertEqual(seenQuery, 'old stack', 'R8 forget path: forget query preserved');
    assertEqual(outcome.message.includes('Forgot 2 memories'), true, 'R8 forget path: result message returned');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 forget path: detectConversationalIntent NOT called');
  }

  // ─── new path: generate_image → detected executor → HF /imagine ────────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenCommand = '';
    let seenModel: string | undefined;
    const imagePrompt = 'Generate an image of a neon swan';
    const imagePlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: {
        kind: 'conversational_action',
        intent: { type: 'generate_image', prompt: imagePrompt },
        routeId: 'hf_tools',
      },
      execution: { kind: 'run_command_handler', routeId: 'hf_tools', commandText: imagePrompt },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async (dispatchedPlan) => {
        if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
        const result = await executeDetectedConversationalIntent(dispatchedPlan.intent.intent, {
          circleId: 'c1',
          userId: 'u1',
          fullMessage: imagePrompt,
          model: 'hf-test-model',
          executeHfCommand: async (input, commandCtx) => {
            seenCommand = input;
            seenModel = commandCtx.model;
            return {
              success: true,
              message: '**Generated image:** _Generate an image of a neon swan_',
              artifacts: [{
                kind: 'image',
                title: 'Neon swan',
                url: 'data:image/png;base64,test',
                content: imagePrompt,
                metadata: { source: 'smoke' },
              }],
            };
          },
        });
        if (result?.handled) {
          return {
            status: 'completed',
            message: result.message,
            data: { artifactCount: result.artifacts?.length || 0 },
            stateRequests: { typing: false, workbench: { action: 'stop', kind: 'coding' } },
          };
        }
        return { handled: false };
      },
    });
    const outcome = await dispatchChatAutomationPlan(imagePlan, { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'R8 image path: executor handled the detected intent');
    assertEqual(seenCommand, '/imagine Generate an image of a neon swan', 'R8 image path: routed through HF /imagine');
    assertEqual(seenModel, 'hf-test-model', 'R8 image path: selected model forwarded to HF executor');
    assertEqual(outcome.data?.artifactCount, 1, 'R8 image path: image artifact count returned');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 image path: detectConversationalIntent NOT called');
  }

  // ─── new path: wordpress_list → detected executor → /wp list ────────────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenCommand = '';
    const wordpressPlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: {
        kind: 'conversational_action',
        intent: { type: 'wordpress_list' },
        routeId: 'wordpress',
      },
      execution: { kind: 'run_command_handler', routeId: 'wordpress', commandText: 'Show my WordPress posts' },
      risk: 'safe',
      approval: { required: false, reason: null },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async (dispatchedPlan) => {
        if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
        const result = await executeDetectedConversationalIntent(dispatchedPlan.intent.intent, {
          circleId: 'c1',
          userId: 'u1',
          fullMessage: 'Show my WordPress posts',
          executeWpCommand: async (input) => {
            seenCommand = input;
            return { success: true, message: '**Recent WordPress Posts**\n- Hello World' };
          },
        });
        if (result?.handled) {
          return {
            status: 'completed',
            message: result.message,
            stateRequests: { typing: false },
          };
        }
        return { handled: false };
      },
    });
    const outcome = await dispatchChatAutomationPlan(wordpressPlan, { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'R8 wordpress list path: executor handled the detected intent');
    assertEqual(seenCommand, '/wp list', 'R8 wordpress list path: routed through /wp list');
    assertEqual(outcome.message.includes('Recent WordPress Posts'), true, 'R8 wordpress list path: result message returned');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 wordpress list path: detectConversationalIntent NOT called');
  }

  // ─── new path: wordpress_list pages → detected executor → /wp list pages ─
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenCommand = '';
    const result = await executeDetectedConversationalIntent(
      { type: 'wordpress_list', target: 'pages' },
      {
        circleId: 'c1',
        userId: 'u1',
        fullMessage: 'List pages in WordPress',
        executeWpCommand: async (input) => {
          seenCommand = input;
          return { success: true, message: '**WordPress Pages**\n- Home' };
        },
      },
    );
    assertEqual(result?.handled, true, 'R8 wordpress list pages path: executor handled detected intent');
    assertEqual(seenCommand, '/wp list pages', 'R8 wordpress list pages path: routed through /wp list pages');
    assertEqual(result?.message.includes('WordPress Pages'), true, 'R8 wordpress list pages path: result message returned');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 wordpress list pages path: detectConversationalIntent NOT called');
  }

  // ─── new path: wordpress_publish approval defers before handler ─────────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let handlerRan = false;
    const wordpressPublishPlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: {
        kind: 'conversational_action',
        intent: { type: 'wordpress_publish', title: 'Launch notes', status: 'publish' },
        routeId: 'wordpress',
      },
      execution: { kind: 'run_command_handler', routeId: 'wordpress', commandText: 'Publish launch notes to WordPress' },
      risk: 'external_side_effect',
      approval: { required: true, reason: 'Route wordpress can affect external systems.' },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async () => {
        handlerRan = true;
        return { status: 'completed', message: 'should not run' };
      },
    });
    const outcome = await dispatchChatAutomationPlan(wordpressPublishPlan, {
      handlers,
      ctx,
      approvalGate: async () => ({
        pass: false,
        deferred: { approvalId: 'approval-wp-1', message: 'Waiting for WordPress approval.', category: 'filed' },
      }),
    });
    assertEqual(outcome.status, 'deferred', 'R8 wordpress publish path: approval defers before execution');
    assertEqual(handlerRan, false, 'R8 wordpress publish path: handler not run before approval');
    assertEqual(outcome.approvalId, 'approval-wp-1', 'R8 wordpress publish path: approval id returned');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 wordpress publish path: detectConversationalIntent NOT called before approval');
  }

  // ─── new path: wordpress_publish → detected executor after approval ─────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenTitle = '';
    let seenStatus = '';
    let seenIntentType = '';
    const wordpressPublishPlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: {
        kind: 'conversational_action',
        intent: { type: 'wordpress_publish', title: 'Launch notes', status: 'publish' },
        routeId: 'wordpress',
      },
      execution: { kind: 'run_command_handler', routeId: 'wordpress', commandText: 'Publish launch notes to WordPress' },
      risk: 'external_side_effect',
      approval: { required: true, reason: 'Route wordpress can affect external systems.' },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async (dispatchedPlan) => {
        if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
        const result = await executeDetectedConversationalIntent(dispatchedPlan.intent.intent, {
          circleId: 'c1',
          userId: 'u1',
          fullMessage: 'Publish launch notes to WordPress',
          executeWordPressPublish: async (input) => {
            seenTitle = input.title;
            seenStatus = input.status;
            seenIntentType = input.intentType;
            return { message: `**Published to WordPress** (${input.status}) ${input.title}` };
          },
        });
        if (result?.handled) return { status: 'completed', message: result.message, stateRequests: { typing: false } };
        return { handled: false };
      },
    });
    const outcome = await dispatchChatAutomationPlan(wordpressPublishPlan, {
      handlers,
      ctx,
      approvalGate: async () => ({ pass: true }),
    });
    assertEqual(outcome.status, 'completed', 'R8 wordpress publish path: executor handled approved intent');
    assertEqual(seenIntentType, 'wordpress_publish', 'R8 wordpress publish path: intent type forwarded');
    assertEqual(seenTitle, 'Launch notes', 'R8 wordpress publish path: title preserved');
    assertEqual(seenStatus, 'publish', 'R8 wordpress publish path: publish status preserved');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 wordpress publish path: detectConversationalIntent NOT called after approval');
  }

  // ─── detected executor: wordpress_schedule maps to confirmed /wp schedule ───
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenCommand = '';
    const result = await executeDetectedConversationalIntent(
      { type: 'wordpress_schedule', date: '2026-07-01', title: 'Launch recap' },
      {
        circleId: 'c1',
        userId: 'u1',
        fullMessage: 'Schedule a WordPress post about launch recap for 2026-07-01',
        executeWpCommand: async (input) => {
          seenCommand = input;
          return { success: true, message: 'Post scheduled: **Launch recap** (ID: 42)' };
        },
      },
    );
    assertEqual(result?.handled, true, 'R8 wordpress schedule path: executor handled detected intent');
    assertEqual(seenCommand, '/wp schedule 2026-07-01 Launch recap confirm', 'R8 wordpress schedule path: routed through confirmed /wp schedule');
    assertEqual(result?.message.includes('Post scheduled'), true, 'R8 wordpress schedule path: scheduled wording is explicit');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 wordpress schedule path: detectConversationalIntent NOT called');
  }

  // ─── new path: create_task → detected executor → task creation seam ─────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenTitle = '';
    let seenFullMessage = '';
    const taskMessage = 'Create a task to review the invoice';
    const createTaskPlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: {
        kind: 'conversational_action',
        intent: { type: 'create_task', title: 'review the invoice' },
        routeId: 'mission',
      },
      execution: { kind: 'run_command_handler', routeId: 'mission', commandText: taskMessage },
      risk: 'safe',
      approval: { required: false, reason: null },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async (dispatchedPlan) => {
        if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
        const result = await executeDetectedConversationalIntent(dispatchedPlan.intent.intent, {
          circleId: 'c1',
          userId: 'u1',
          fullMessage: taskMessage,
          executeCreateTask: async (input) => {
            seenTitle = input.title;
            seenFullMessage = input.fullMessage;
            return { message: `**Task created:** ${input.title}\n\nYou can find it in the Feed tab.` };
          },
        });
        if (result?.handled) {
          return {
            status: 'completed',
            message: result.message,
            stateRequests: { typing: false },
          };
        }
        return { handled: false };
      },
    });
    const outcome = await dispatchChatAutomationPlan(createTaskPlan, { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'R8 create_task path: executor handled the detected intent');
    assertEqual(seenTitle, 'review the invoice', 'R8 create_task path: task title preserved');
    assertEqual(seenFullMessage, taskMessage, 'R8 create_task path: original message forwarded');
    assertEqual(outcome.message.includes('Task created'), true, 'R8 create_task path: result message returned');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 create_task path: detectConversationalIntent NOT called');
  }

  // ─── new path: office_agent_task → detected executor → office seam ──────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    let seenAgentName = '';
    let seenModelName: string | undefined;
    let seenTaskTarget = '';
    const officeAgentMessage = 'Create an agent named Scout with Opus and add it to the task we just made';
    const officeAgentPlan = planFor('run_command_handler', {
      source: 'conversational_intent',
      intent: {
        kind: 'conversational_action',
        intent: {
          type: 'office_agent_task',
          agentName: 'Scout',
          modelName: 'claude-opus-4-6',
          taskTarget: 'latest_user_task',
        },
        routeId: 'mission',
      },
      execution: { kind: 'run_command_handler', routeId: 'mission', commandText: officeAgentMessage },
      risk: 'safe',
      approval: { required: false, reason: null },
    });
    const handlers = createChatTransportHandlers({
      run_command_handler: async (dispatchedPlan) => {
        if (dispatchedPlan.intent.kind !== 'conversational_action') return { handled: false };
        const result = await executeDetectedConversationalIntent(dispatchedPlan.intent.intent, {
          circleId: 'c1',
          userId: 'u1',
          fullMessage: officeAgentMessage,
          executeOfficeAgentTask: async (input) => {
            seenAgentName = input.agentName;
            seenModelName = input.modelName;
            seenTaskTarget = input.taskTarget;
            return { message: `Created office agent **${input.agentName}** with **${input.modelName}**.` };
          },
        });
        if (result?.handled) {
          return {
            status: 'completed',
            message: result.message,
            stateRequests: { typing: false },
          };
        }
        return { handled: false };
      },
    });
    const outcome = await dispatchChatAutomationPlan(officeAgentPlan, { handlers, ctx });
    assertEqual(outcome.status, 'completed', 'R8 office_agent_task path: executor handled the detected intent');
    assertEqual(seenAgentName, 'Scout', 'R8 office_agent_task path: agent name preserved');
    assertEqual(seenModelName, 'claude-opus-4-6', 'R8 office_agent_task path: model name preserved');
    assertEqual(seenTaskTarget, 'latest_user_task', 'R8 office_agent_task path: task target preserved');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 0, 'R8 office_agent_task path: detectConversationalIntent NOT called');
  }

  // ─── legacy path: detect-then-execute classifies exactly once ───────────
  {
    __conversationalRouterDiagnostics.detectCalls = 0;
    const intent = detectConversationalIntent('what do you know about our project?');
    assertEqual(intent.type, 'show_memories', 'R8 legacy: detector classified show_memories');
    const result = await executeConversationalIntent(intent, {
      circleId: 'c1', userId: 'u1', fullMessage: 'what do you know about our project?',
    });
    assertEqual(result?.message, '__SHOW_MEMORIES__', 'R8 legacy: same executor result');
    assertEqual(__conversationalRouterDiagnostics.detectCalls, 1, 'R8 legacy: classified exactly once (execute does not re-detect)');
  }

  // ═══ R9 — clarification park/resume through the dispatcher ctx ══════════
  {
    // Thread-scoped store backed by a Map — exactly how ChatTab wraps
    // `pendingClarificationRef` (the refs remain the backing store there).
    const backing = new Map<string, ChatClarificationResumePending>();
    const key = 'thread-1';
    const store: ChatClarificationResumeStore = {
      pending: backing.get(key) || null,
      setPending: (pending) => { backing.set(key, pending); },
      clearPending: () => { backing.delete(key); },
    };
    const clarifyPlan = planFor('ask_clarification', {
      intent: 'ask_clarification',
      execution: {
        kind: 'ask_clarification',
        routeId: null,
        commandText: 'create a task',
        clarification: {
          question: 'What should the task be called?',
          missingParams: ['title'],
          reason: 'No title given.',
          pendingIntent: 'create_task',
          examples: ['Call it "Review landing page"'],
        },
      },
    });
    const handlers = createChatTransportHandlers({
      ask_clarification: async (dispatchedPlan, depCtx) => {
        const clarification = dispatchedPlan.execution.clarification!;
        depCtx.clarificationResume?.setPending({
          originalMessage: dispatchedPlan.execution.commandText || '',
          pendingIntent: clarification.pendingIntent || null,
          missingParams: clarification.missingParams,
          askedAt: Date.now(),
        });
        return { status: 'needs_input', stateRequests: { typing: false } };
      },
    });
    const outcome = await dispatchChatAutomationPlan(clarifyPlan, {
      handlers,
      ctx: { ...ctx, threadId: key, clarificationResume: store },
    });
    assertEqual(outcome.status, 'needs_input', 'R9 park: handler asked for input');
    const parked = backing.get(key);
    assertEqual(parked?.pendingIntent, 'create_task', 'R9 park: pending intent parked via ctx seam');
    assertEqual(parked?.missingParams, ['title'], 'R9 park: missing params parked');
    assertEqual(parked?.originalMessage, 'create a task', 'R9 park: original message parked');

    // Resume: the next send reads `pending` off a fresh store snapshot and
    // clears it once consumed — the backing Map is the source of truth.
    const resumeStore: ChatClarificationResumeStore = {
      pending: backing.get(key) || null,
      setPending: (pending) => { backing.set(key, pending); },
      clearPending: () => { backing.delete(key); },
    };
    assert(!!resumeStore.pending, 'R9 resume: pending visible on the next dispatch ctx');
    resumeStore.clearPending();
    assertEqual(backing.size, 0, 'R9 resume: clearPending empties the backing store');
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nAll chat-transport-handlers smoke cases passed.');
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(1); });
