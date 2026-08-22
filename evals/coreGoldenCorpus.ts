// coreGoldenCorpus — the DETERMINISTIC, model-free tier-1 regression net over the
// highest-value PURE cores this session built for
// docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md (ADD #1: "an eval CI
// merge-gate … the safety net that makes every consolidation below safe").
//
// The plan's eval gate has TWO tiers:
//   • a LIVE-MODEL tier (drives golden cases through the real
//     `agentExecutionCore.runAgent` with a real model + mocked side-effecting
//     tools) — needs API keys, opt-in, lives in a separate file; and
//   • THIS tier — a golden net that pins the exact OUTPUT of each pure core on a
//     FIXED input, so CI catches ANY behavioral drift with NO API keys, NO
//     network, and NO flakiness. If a consolidation accidentally changes what a
//     core returns, a case here flips from pass→fail and the smoke exits non-zero.
//
// Each case is a `CoreGoldenCase` whose `run()` executes a real core function on a
// frozen input and returns `true` iff the output matches the pinned golden value
// (the case does its own assertion internally and returns a boolean). The corpus
// spans the ten load-bearing cores below; every golden value here was captured
// from the REAL core output, not invented.
//
// PURITY EXCEPTION (spec-sanctioned): unlike the pure cores, this corpus IMPORTS
// those cores AT RUNTIME — that is the whole point (it exercises them). Every
// imported core is itself dependency-light + tsx-loadable (verified), so the
// smoke (scripts/eval-core-corpus-smoketest.ts) runs under tsx with no
// react-native / supabase / deno in the graph. No Date.now()/Math.random() at
// module scope. `runCoreGoldenCase` / `runCoreGoldenCorpus` are TOTAL — a case
// that throws (or a hostile/garbage case object) yields a `passed:false` row and
// never crashes the run.
//
// WIRING: `scripts/run-evals.ts` imports `runCoreGoldenCorpus()` as its
// always-on, key-free tier-1 suite (the live-model tier is a separate opt-in
// file). This is the CI regression net over every pure core.

import { resolveApprovalDecision } from '../src/lib/unifiedApprovalPolicyCore';
import { matchChatCommand, buildCommandDispatchTable } from '../src/lib/chatCommandDispatchCore';
import {
  splitPromptAtCacheBoundary,
  buildCacheableSystemBlocks,
  isVolatileAboveBoundary,
  DEFAULT_CACHE_BOUNDARY_MARKER,
} from '../src/lib/promptCacheSplitCore';
import { describeLane, normalizeSurfaceLane, laneDescriptorKey } from '../src/lib/laneTaxonomyCore';
import { planMemoryTurnLoad } from '../src/lib/memoryTurnAssemblyCore';
import {
  buildRunCheckpoint,
  planResumeFromCheckpoint,
  isCheckpointStale,
} from '../src/lib/runCheckpointResumeCore';
import {
  buildInvokeAgentSpan,
  buildChatSpan,
  buildToolSpan,
  deriveGenAiSystem,
  spanDurationMs,
} from '../src/lib/otelGenAiSpanCore';
import {
  serializeMessageMetadata,
  hydrateMessageMetadata,
  MESSAGE_METADATA_MAX_BYTES,
} from '../src/lib/messageMetadataCore';
import { summarizeToolResultText, shouldSummarizeToolResult } from '../src/lib/toolResultSummaryCore';
import {
  foldRunAndFixRound,
  planVerificationNudge,
  createRunAndFixGateState,
} from '../src/lib/runAndFixGateCore';

// ─── Public types ────────────────────────────────────────────────────────────

/** One deterministic golden case: run a real core fn on a fixed input; return
 *  true iff the output matches the pinned golden value. */
export interface CoreGoldenCase {
  /** Stable, unique, lowercase-kebab id (used as the CI anchor). */
  id: string;
  /** The core family this case belongs to (used to group/report). */
  suite: string;
  /** Execute the real core on a frozen input; true iff the golden held. */
  run: () => boolean;
  /** One-sentence statement of the invariant this case pins. */
  describe: string;
}

/** One result row — shape matches the planned `evalGateCore.EvalCaseResult`
 *  (and mirrors `agentEvals.EvalCheckOutcome`) so the runner can merge tiers. */
export interface CoreGoldenResult {
  caseId: string;
  suite: string;
  passed: boolean;
  /** Present only on failure — a short, safe reason (never core content). */
  detail?: string;
}

// ─── Tiny deterministic, bounded, order-insensitive deep-equal ────────────────
// Used by cases that pin a whole object golden. Order-insensitive on object keys
// so a case never breaks on a cosmetic key-order change; depth-bounded so it is
// total even on a hostile/deep value.

function goldenEq(a: unknown, b: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (a === b) return true;
  const ta = typeof a;
  const tb = typeof b;
  if (ta !== tb) return false;
  if (a === null || b === null) return a === b;
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr || bArr) {
    if (!aArr || !bArr || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!goldenEq(a[i], b[i], depth + 1)) return false;
    }
    return true;
  }
  if (ta === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao).sort();
    const bk = Object.keys(bo).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i += 1) {
      if (ak[i] !== bk[i]) return false;
    }
    for (const k of ak) {
      if (!goldenEq(ao[k], bo[k], depth + 1)) return false;
    }
    return true;
  }
  return false;
}

function safeErr(err: unknown): string {
  try {
    if (err instanceof Error) return err.message.slice(0, 200);
    return String(err).slice(0, 200);
  } catch {
    return 'unstringifiable error';
  }
}

// ─── Fixed inputs shared by cases ─────────────────────────────────────────────

/** A frozen, synthetic command registry (only the fields
 *  `chatCommandDispatchCore` reads: id / command / routeId / aliases). Fixed so
 *  the golden is deterministic and independent of the live registry file. */
const GOLDEN_REGISTRY: ReadonlyArray<Record<string, unknown>> = [
  { id: 'context', routeId: 'context', command: '/context', aliases: ['/ctx'] },
  { id: 'mission', routeId: 'mission', command: '/mission' },
  { id: 'mission-status', routeId: 'mission_status', command: '/mission status' },
  { id: 'help', routeId: 'help', command: '/help', aliases: ['/commands'] },
];

/** A clean round-boundary transcript: one tool_use + its matching tool_result. */
const GOLDEN_MESSAGES: ReadonlyArray<unknown> = [
  { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_1', name: 'read' }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'ok' }] },
];

/** A composed prompt with the real cache-boundary marker between the two halves. */
const GOLDEN_COMPOSED_PROMPT = `FROZEN RULES${DEFAULT_CACHE_BOUNDARY_MARKER}DYNAMIC TAIL`;

// ─── The corpus ───────────────────────────────────────────────────────────────
// Aim: ≥40 cases across ≥8 suites; each pins the single highest-signal invariant
// of its core. Every golden below was captured from the real core output.

export const CORE_GOLDEN_CORPUS: CoreGoldenCase[] = [
  // ── suite: approval (unifiedApprovalPolicyCore.resolveApprovalDecision) ──────
  {
    id: 'approval-delete-floor-beats-auto',
    suite: 'approval',
    describe:
      'the always-exact delete effect requires approval even when the category is user-auto-approved AND the tool mode is auto',
    run: () => {
      const d = resolveApprovalDecision({
        category: 'delete',
        userAutoApprove: ['delete'],
        toolApprovalMode: 'auto',
        isFloorAction: true,
      });
      return d.kind === 'require_approval' && d.category === 'delete' && /always-exact/.test(d.reason);
    },
  },
  {
    id: 'approval-blocked-wins-over-everything',
    suite: 'approval',
    describe: 'a user-forbidden action is blocked, outranking floor/auto/default',
    run: () => {
      const d = resolveApprovalDecision({ category: 'memory_read', userConstraintsBlock: true });
      return d.kind === 'blocked' && d.category === 'memory_read';
    },
  },
  {
    id: 'approval-tool-auto-clean-auto-approves',
    suite: 'approval',
    describe: 'tool policy auto + positively classified observe + non-mutating/non-external → auto_approve',
    run: () => {
      const d = resolveApprovalDecision({
        toolApprovalMode: 'auto',
        effect: 'observe',
        mutatesState: false,
        externalSideEffect: false,
      });
      return d.kind === 'auto_approve';
    },
  },
  {
    id: 'approval-tool-auto-mutating-fails-closed',
    suite: 'approval',
    describe: 'even a positively classified observe tool fails closed when it reports a mutation',
    run: () => {
      const d = resolveApprovalDecision({ toolApprovalMode: 'auto', effect: 'observe', mutatesState: true });
      return d.kind === 'require_approval' && /fail-closed/.test(d.reason);
    },
  },
  {
    id: 'approval-user-category-auto-approves',
    suite: 'approval',
    describe: 'a category the user explicitly opted into auto-approve → auto_approve',
    run: () => {
      const d = resolveApprovalDecision({ category: 'memory_read', userAutoApprove: ['memory_read'] });
      return d.kind === 'auto_approve' && d.category === 'memory_read';
    },
  },
  {
    id: 'approval-default-requires-approval',
    suite: 'approval',
    describe: 'an un-opted, non-floor, non-auto action defaults to require_approval (fail-closed)',
    run: () => {
      const d = resolveApprovalDecision({ category: 'x' });
      return d.kind === 'require_approval' && d.category === 'x';
    },
  },
  {
    id: 'approval-pay-marker-category-floors',
    suite: 'approval',
    describe: 'the payment effect forces exact approval even under tool auto (defense-in-depth)',
    run: () => {
      const d = resolveApprovalDecision({ category: 'pay', toolApprovalMode: 'auto' });
      return d.kind === 'require_approval' && /always-exact/.test(d.reason);
    },
  },
  {
    id: 'approval-hostile-cyclic-total',
    suite: 'approval',
    describe: 'a cyclic input never throws and fails closed to require_approval',
    run: () => {
      const cyc: Record<string, unknown> = { category: 'x' };
      cyc.self = cyc;
      const d = resolveApprovalDecision(cyc);
      return d.kind === 'require_approval';
    },
  },

  // ── suite: command (chatCommandDispatchCore.matchChatCommand) ───────────────
  {
    id: 'command-context-max-parses-args',
    suite: 'command',
    describe: "'/context max' resolves to the context command with argsText 'max'",
    run: () => {
      const m = matchChatCommand('/context max', GOLDEN_REGISTRY);
      return (
        m.matched === true &&
        m.commandId === 'context' &&
        m.routeId === 'context' &&
        m.command === '/context' &&
        m.argsText === 'max'
      );
    },
  },
  {
    id: 'command-longest-token-wins',
    suite: 'command',
    describe: "'/mission status foo' picks '/mission status' (most specific) over '/mission'",
    run: () => {
      const m = matchChatCommand('/mission status foo', GOLDEN_REGISTRY);
      return m.matched === true && m.commandId === 'mission-status' && m.argsText === 'foo';
    },
  },
  {
    id: 'command-exact-match-empty-args',
    suite: 'command',
    describe: "an exact '/context' match yields argsText ''",
    run: () => {
      const m = matchChatCommand('/context', GOLDEN_REGISTRY);
      return m.matched === true && m.commandId === 'context' && m.argsText === '';
    },
  },
  {
    id: 'command-alias-resolves-to-owner',
    suite: 'command',
    describe: "alias '/ctx deep' resolves to the context command with args 'deep'",
    run: () => {
      const m = matchChatCommand('/ctx deep', GOLDEN_REGISTRY);
      return m.matched === true && m.commandId === 'context' && m.argsText === 'deep';
    },
  },
  {
    id: 'command-non-slash-no-match',
    suite: 'command',
    describe: 'a non-slash line does not match any command',
    run: () => {
      const m = matchChatCommand('hello world', GOLDEN_REGISTRY);
      return m.matched === false && m.commandId === undefined;
    },
  },
  {
    id: 'command-dispatch-table-maps-alias',
    suite: 'command',
    describe: 'buildCommandDispatchTable maps both canonical commands and aliases to their owner',
    run: () => {
      const table = buildCommandDispatchTable(GOLDEN_REGISTRY);
      return (
        goldenEq(table['/context'], { commandId: 'context', routeId: 'context' }) &&
        goldenEq(table['/ctx'], { commandId: 'context', routeId: 'context' }) &&
        goldenEq(table['/commands'], { commandId: 'help', routeId: 'help' })
      );
    },
  },
  {
    id: 'command-hostile-registry-total',
    suite: 'command',
    describe: 'a non-array registry never throws → {matched:false}',
    run: () => {
      const m = matchChatCommand('/x', { not: 'an array' });
      return m.matched === false;
    },
  },

  // ── suite: cache_split (promptCacheSplitCore) ───────────────────────────────
  {
    id: 'cache-split-reproduces-halves',
    suite: 'cache_split',
    describe: 'splitPromptAtCacheBoundary cuts a composed prompt into frozen prefix + dynamic tail',
    run: () => {
      const s = splitPromptAtCacheBoundary(GOLDEN_COMPOSED_PROMPT);
      return goldenEq(s, { frozenPrefix: 'FROZEN RULES', dynamicTail: 'DYNAMIC TAIL', splitApplied: true });
    },
  },
  {
    id: 'cache-split-no-marker-all-frozen',
    suite: 'cache_split',
    describe: 'with no boundary marker the whole prompt is frozen, tail empty, splitApplied false',
    run: () => {
      const s = splitPromptAtCacheBoundary('no boundary here');
      return goldenEq(s, { frozenPrefix: 'no boundary here', dynamicTail: '', splitApplied: false });
    },
  },
  {
    id: 'cache-split-non-string-neutral',
    suite: 'cache_split',
    describe: 'a non-string prompt coerces to a safe empty split (never throws)',
    run: () => {
      const s = splitPromptAtCacheBoundary(123 as unknown);
      return goldenEq(s, { frozenPrefix: '', dynamicTail: '', splitApplied: false });
    },
  },
  {
    id: 'cache-blocks-cache-control-frozen-only',
    suite: 'cache_split',
    describe: 'buildCacheableSystemBlocks puts cache_control ONLY on the frozen block, none on the tail',
    run: () => {
      const blocks = buildCacheableSystemBlocks('FROZEN', 'TAIL');
      return (
        blocks.length === 2 &&
        blocks[0].cache_control !== undefined &&
        blocks[0].cache_control.type === 'ephemeral' &&
        blocks[0].text === 'FROZEN' &&
        blocks[1].cache_control === undefined &&
        blocks[1].text === 'TAIL'
      );
    },
  },
  {
    id: 'cache-blocks-empty-tail-single-block',
    suite: 'cache_split',
    describe: 'an empty dynamic tail yields a single frozen (cache-controlled) block',
    run: () => {
      const blocks = buildCacheableSystemBlocks('FROZEN', '');
      return blocks.length === 1 && blocks[0].cache_control?.type === 'ephemeral';
    },
  },
  {
    id: 'cache-volatile-detects-current-context',
    suite: 'cache_split',
    describe: "isVolatileAboveBoundary flags '## Current Context' wrongly sitting in the frozen prefix",
    run: () => {
      const found = isVolatileAboveBoundary('rules ## Current Context here');
      return goldenEq(found, ['## Current Context']);
    },
  },
  {
    id: 'cache-volatile-clean-prefix-empty',
    suite: 'cache_split',
    describe: 'a clean frozen prefix reports no volatile markers (safe to cache)',
    run: () => {
      const found = isVolatileAboveBoundary('just frozen rules and capabilities');
      return Array.isArray(found) && found.length === 0;
    },
  },

  // ── suite: lane (laneTaxonomyCore.describeLane) ─────────────────────────────
  {
    id: 'lane-openswan_v2-agent-core-loop',
    suite: 'lane',
    describe: 'the openswan_v2 surface runs the client-side agent_core loop over v2 transport',
    run: () => {
      const d = describeLane({ surfaceLane: 'openswan_v2' });
      return goldenEq(d, { surface: 'openswan_v2', transport: 'v2', loop: 'agent_core' });
    },
  },
  {
    id: 'lane-batch-edge-v2-loop',
    suite: 'lane',
    describe: 'the batch surface runs the swanbot-v2-ai server loop (edge_v2) over v2 transport',
    run: () => {
      const d = describeLane({ surfaceLane: 'batch' });
      return goldenEq(d, { surface: 'batch', transport: 'v2', loop: 'edge_v2' });
    },
  },
  {
    id: 'lane-v1-relay-legacy-loop',
    suite: 'lane',
    describe: 'the v1_relay surface runs the legacy server loop over v1 transport',
    run: () => {
      const d = describeLane({ surfaceLane: 'v1_relay' });
      return goldenEq(d, { surface: 'v1_relay', transport: 'v1', loop: 'legacy' });
    },
  },
  {
    id: 'lane-stream-agent-core-loop',
    suite: 'lane',
    describe: 'the stream (SSE) surface renders the agent_core loop event stream',
    run: () => {
      const d = describeLane({ surfaceLane: 'stream' });
      return goldenEq(d, { surface: 'stream', transport: 'stream', loop: 'agent_core' });
    },
  },
  {
    id: 'lane-batch-v1-fallback-not-phantom-edge-v2',
    suite: 'lane',
    describe: 'a batch turn that fell back to the v1 relay resolves to the legacy loop, not a phantom edge_v2',
    run: () => {
      const d = describeLane({ surfaceLane: 'batch', transport: 'v1' });
      return goldenEq(d, { surface: 'batch', transport: 'v1', loop: 'legacy' });
    },
  },
  {
    id: 'lane-alias-automation-plan-folds-to-batch',
    suite: 'lane',
    describe: "the non-canonical 'automation_plan' surface folds onto the batch lane",
    run: () => {
      const d = describeLane({ surfaceLane: 'automation_plan' });
      return d.surface === 'batch' && d.loop === 'edge_v2';
    },
  },
  {
    id: 'lane-unrecognized-token-unknown',
    suite: 'lane',
    describe: 'an unrecognized surface token collapses to the unknown/none/none descriptor',
    run: () => {
      const d = describeLane({ surfaceLane: 'zzz-not-a-lane' });
      return (
        goldenEq(d, { surface: 'unknown', transport: 'none', loop: 'none' }) &&
        normalizeSurfaceLane({}) === 'unknown' &&
        laneDescriptorKey(d) === 'unknown/none/none'
      );
    },
  },

  // ── suite: memory (memoryTurnAssemblyCore.planMemoryTurnLoad) ────────────────
  {
    id: 'memory-reuse-suppresses-double-retrieve',
    suite: 'memory',
    describe:
      'a pre-resolved stores bundle is reused and SUPPRESSES the standalone retrieval+wisdom passes (no double embed+rank)',
    run: () => {
      const p = planMemoryTurnLoad({ complexity: 'complex', hasMemoryStores: true });
      return (
        p.reuseFromStores === true &&
        p.loadStartupBundle === true &&
        p.loadTurnRetrieval === false &&
        p.loadSoulWisdom === false
      );
    },
  },
  {
    id: 'memory-trivial-loads-nothing',
    suite: 'memory',
    describe: 'a trivial turn runs no memory passes at all',
    run: () => {
      const p = planMemoryTurnLoad({ complexity: 'trivial' });
      return !p.loadStartupBundle && !p.loadTurnRetrieval && !p.loadSoulWisdom && !p.reuseFromStores;
    },
  },
  {
    id: 'memory-complex-standalone-runs-all-once',
    suite: 'memory',
    describe: 'with no bundle, a complex turn runs startup + retrieval + wisdom, each once',
    run: () => {
      const p = planMemoryTurnLoad({ complexity: 'complex', hasMemoryStores: false });
      return (
        p.loadStartupBundle === true &&
        p.loadTurnRetrieval === true &&
        p.loadSoulWisdom === true &&
        p.reuseFromStores === false
      );
    },
  },
  {
    id: 'memory-lean-drops-wisdom',
    suite: 'memory',
    describe: "the 'lean' context dial drops the wisdom pass while keeping retrieval",
    run: () => {
      const p = planMemoryTurnLoad({ complexity: 'complex', hasMemoryStores: false, contextDepth: 'lean' });
      return p.loadTurnRetrieval === true && p.loadSoulWisdom === false;
    },
  },
  {
    id: 'memory-max-floors-to-complex',
    suite: 'memory',
    describe: "'max' floors a simple turn to complex, so wisdom loads",
    run: () => {
      const p = planMemoryTurnLoad({ complexity: 'simple', hasMemoryStores: false, contextDepth: 'max' });
      return p.loadSoulWisdom === true && p.loadTurnRetrieval === true;
    },
  },
  {
    id: 'memory-simple-no-wisdom',
    suite: 'memory',
    describe: 'a simple turn loads retrieval but not wisdom',
    run: () => {
      const p = planMemoryTurnLoad({ complexity: 'simple', hasMemoryStores: false });
      return p.loadTurnRetrieval === true && p.loadSoulWisdom === false;
    },
  },
  {
    id: 'memory-no-query-skips-retrieval',
    suite: 'memory',
    describe: 'with no query to embed, retrieval is skipped but wisdom still loads',
    run: () => {
      const p = planMemoryTurnLoad({ complexity: 'moderate', hasMemoryStores: false, hasQuery: '' });
      return p.loadTurnRetrieval === false && p.loadSoulWisdom === true;
    },
  },

  // ── suite: checkpoint (runCheckpointResumeCore) ─────────────────────────────
  {
    id: 'checkpoint-build-harvests-tool-ids-from-snapshot',
    suite: 'checkpoint',
    describe: 'buildRunCheckpoint collects completed tool ids from the message snapshot even when toolResults is empty',
    run: () => {
      const c = buildRunCheckpoint({ runId: 'run_9', stepIndex: 2, messages: GOLDEN_MESSAGES, toolResults: [], nowMs: 1000 });
      return (
        c.runId === 'run_9' &&
        c.stepIndex === 2 &&
        c.at === 1000 &&
        goldenEq(c.completedToolIds, ['tool_1'])
      );
    },
  },
  {
    id: 'checkpoint-build-resume-roundtrip-skips-completed',
    suite: 'checkpoint',
    describe: 'a built checkpoint resumes from its step and skips the already-completed tool id (idempotent side effects)',
    run: () => {
      const c = buildRunCheckpoint({ runId: 'run_9', stepIndex: 2, messages: GOLDEN_MESSAGES, toolResults: [], nowMs: 1000 });
      const plan = planResumeFromCheckpoint(c);
      return plan.canResume === true && plan.fromStep === 2 && goldenEq(plan.skipCompletedToolIds, ['tool_1']);
    },
  },
  {
    id: 'checkpoint-resume-step-zero-not-resumable',
    suite: 'checkpoint',
    describe: 'a checkpoint with no completed step (stepIndex 0) is not resumable',
    run: () => {
      const plan = planResumeFromCheckpoint({ runId: 'r', stepIndex: 0, messagesSnapshot: GOLDEN_MESSAGES, completedToolIds: [] });
      return plan.canResume === false && plan.fromStep === 0;
    },
  },
  {
    id: 'checkpoint-resume-empty-snapshot-not-resumable',
    suite: 'checkpoint',
    describe: 'an empty message snapshot cannot seed a resume',
    run: () => {
      const plan = planResumeFromCheckpoint({ runId: 'r', stepIndex: 2, messagesSnapshot: [], completedToolIds: [] });
      return plan.canResume === false;
    },
  },
  {
    id: 'checkpoint-resume-missing-run-id-not-resumable',
    suite: 'checkpoint',
    describe: 'a checkpoint with no run id is not resumable',
    run: () => {
      const plan = planResumeFromCheckpoint({ runId: '', stepIndex: 2, messagesSnapshot: GOLDEN_MESSAGES, completedToolIds: ['tool_1'] });
      return plan.canResume === false;
    },
  },
  {
    id: 'checkpoint-stale-old-checkpoint',
    suite: 'checkpoint',
    describe: 'a checkpoint older than the max age window is stale',
    run: () => isCheckpointStale({ at: 1000 }, 1000 + 86_400_001) === true,
  },
  {
    id: 'checkpoint-fresh-same-instant',
    suite: 'checkpoint',
    describe: 'a same-instant capture is fresh; an unreadable clock fails closed to stale',
    run: () => isCheckpointStale({ at: 1000 }, 1000) === false && isCheckpointStale({ at: 1000 }, 'bad-clock') === true,
  },
  {
    id: 'checkpoint-hostile-cyclic-messages-total',
    suite: 'checkpoint',
    describe: 'buildRunCheckpoint tolerates a cyclic message graph — bounded snapshot, no throw',
    run: () => {
      const cyc: Record<string, unknown> = { role: 'user' };
      cyc.self = cyc;
      const c = buildRunCheckpoint({ runId: 'rc', stepIndex: 1, messages: [cyc], toolResults: [], nowMs: 5 });
      return c.runId === 'rc' && Array.isArray(c.messagesSnapshot);
    },
  },

  // ── suite: otel (otelGenAiSpanCore) ─────────────────────────────────────────
  {
    id: 'otel-invoke-agent-root-has-no-parent',
    suite: 'otel',
    describe: 'the invoke_agent root span has NO parentId and carries the OTel GenAI semconv keys',
    run: () => {
      const s = buildInvokeAgentSpan({ runId: 'r1', agentName: 'coder', model: 'claude-haiku-4-5', startMs: 1000, spanId: 's1' });
      return (
        s.parentId === undefined &&
        s.kind === 'invoke_agent' &&
        s.attributes['gen_ai.operation.name'] === 'invoke_agent' &&
        s.attributes['gen_ai.system'] === 'anthropic' &&
        s.attributes['gen_ai.request.model'] === 'claude-haiku-4-5'
      );
    },
  },
  {
    id: 'otel-chat-maps-usage-to-semconv-keys',
    suite: 'otel',
    describe: 'the chat span maps usage onto gen_ai.usage.* token keys and links to its parent',
    run: () => {
      const s = buildChatSpan({
        parentId: 's1',
        iteration: 2,
        model: 'claude-haiku-4-5',
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 },
        startMs: 1000,
        endMs: 1500,
        spanId: 's2',
      });
      return (
        s.parentId === 's1' &&
        s.attributes['gen_ai.usage.input_tokens'] === 100 &&
        s.attributes['gen_ai.usage.output_tokens'] === 20 &&
        s.attributes['gen_ai.usage.cache_read_input_tokens'] === 80 &&
        s.attributes['gen_ai.operation.name'] === 'chat'
      );
    },
  },
  {
    id: 'otel-tool-failure-stamps-error-type',
    suite: 'otel',
    describe: 'a failed execute_tool span carries the standard error.type and openswan.tool.ok=false',
    run: () => {
      const s = buildToolSpan({ parentId: 's1', toolName: 'desktop.edit_file', ok: false, durationMs: 50, startMs: 1000, spanId: 's3' });
      return (
        s.attributes['error.type'] === 'tool_execution_error' &&
        s.attributes['openswan.tool.ok'] === false &&
        s.attributes['gen_ai.tool.name'] === 'desktop.edit_file'
      );
    },
  },
  {
    id: 'otel-tool-success-no-error-type',
    suite: 'otel',
    describe: 'a successful execute_tool span records ok=true and no error.type',
    run: () => {
      const s = buildToolSpan({ parentId: 's1', toolName: 'read', ok: true, durationMs: 10, startMs: 1000, spanId: 's4' });
      return s.attributes['openswan.tool.ok'] === true && s.attributes['error.type'] === undefined;
    },
  },
  {
    id: 'otel-derive-system-from-model',
    suite: 'otel',
    describe: 'gen_ai.system derives from a provider-prefixed or well-known model id',
    run: () =>
      deriveGenAiSystem('openrouter/auto') === 'openrouter' &&
      deriveGenAiSystem('gpt-4o') === 'openai' &&
      deriveGenAiSystem('huggingface_endpoint/cswan801/BlackSwan-v5') === 'huggingface' &&
      deriveGenAiSystem('') === 'openswan',
  },
  {
    id: 'otel-span-duration',
    suite: 'otel',
    describe: 'spanDurationMs returns endMs-startMs, or undefined when no valid endMs',
    run: () => spanDurationMs({ startMs: 1000, endMs: 1500 }) === 500 && spanDurationMs({ startMs: 1000 }) === undefined,
  },

  // ── suite: message_metadata (messageMetadataCore) ───────────────────────────
  {
    id: 'metadata-serialize-hydrate-roundtrip',
    suite: 'message_metadata',
    describe: 'metadata survives a serialize→hydrate roundtrip unchanged',
    run: () => {
      const meta = { source: 'chat', usage: { input_tokens: 5 }, memoriesUsed: [{ id: 'm1' }] };
      const hydrated = hydrateMessageMetadata(serializeMessageMetadata(meta));
      return goldenEq(hydrated, { source: 'chat', usage: { input_tokens: 5 }, memoriesUsed: [{ id: 'm1' }] });
    },
  },
  {
    id: 'metadata-oversized-bounded-under-ceiling',
    suite: 'message_metadata',
    describe: 'a hostile 500KB blob field serializes to a bounded object under the byte ceiling',
    run: () => {
      const ser = serializeMessageMetadata({ blob: 'z'.repeat(500_000), keep: 'v' });
      return JSON.stringify(ser).length <= MESSAGE_METADATA_MAX_BYTES;
    },
  },
  {
    id: 'metadata-cyclic-safe-marker',
    suite: 'message_metadata',
    describe: 'a cyclic metadata object is serialized with a [cyclic] marker and never throws',
    run: () => {
      const cyc: Record<string, unknown> = { a: 1 };
      cyc.loop = cyc;
      const ser = serializeMessageMetadata(cyc);
      return ser.a === 1 && ser.loop === '[cyclic]';
    },
  },
  {
    id: 'metadata-non-object-returns-empty',
    suite: 'message_metadata',
    describe: 'a non-object (number / array) is not valid metadata → {}',
    run: () => goldenEq(serializeMessageMetadata(42), {}) && goldenEq(serializeMessageMetadata([1, 2]), {}),
  },
  {
    id: 'metadata-hydrate-legacy-snake-case',
    suite: 'message_metadata',
    describe: 'hydrate reads legacy snake_case aliases (memories_used, execution_stream)',
    run: () => {
      const out = hydrateMessageMetadata({ memories_used: [1], execution_stream: ['x'] });
      return goldenEq(out.memoriesUsed, [1]) && goldenEq(out.executionStream, ['x']);
    },
  },
  {
    id: 'metadata-secret-masked',
    suite: 'message_metadata',
    describe: 'a secret-shaped token value is masked to [REDACTED] on serialize',
    run: () => {
      const ser = serializeMessageMetadata({ token: `sk-ant-${'a'.repeat(40)}` });
      return ser.token === '[REDACTED]';
    },
  },

  // ── suite: tool_result_summary (toolResultSummaryCore) ──────────────────────
  {
    id: 'summary-oversized-keeps-head-tail-and-marks',
    suite: 'tool_result_summary',
    describe: 'an oversized tool result keeps head+tail verbatim, drops the middle, and inserts a summary marker + signal lines',
    run: () => {
      const big = `HEAD_START\n${'x'.repeat(30_000)}\nError: boom\n${'y'.repeat(10_000)}\nTAIL_END`;
      const sum = summarizeToolResultText(big);
      return (
        sum.summarized === true &&
        sum.omittedChars > 0 &&
        sum.signalLineCount > 0 &&
        sum.text.includes('tool result summarized') &&
        sum.text.startsWith('HEAD_START') &&
        sum.text.endsWith('TAIL_END')
      );
    },
  },
  {
    id: 'summary-under-threshold-passthrough',
    suite: 'tool_result_summary',
    describe: 'a short output passes through unchanged (not summarized)',
    run: () => {
      const sum = summarizeToolResultText('short output');
      return sum.summarized === false && sum.text === 'short output' && shouldSummarizeToolResult('short output') === false;
    },
  },
  {
    id: 'summary-non-string-neutral',
    suite: 'tool_result_summary',
    describe: 'a non-string input yields an empty, non-summarized passthrough',
    run: () => {
      const sum = summarizeToolResultText(null);
      return sum.summarized === false && sum.text === '' && sum.originalChars === 0;
    },
  },

  // ── suite: run_and_fix_gate (runAndFixGateCore) ─────────────────────────────
  {
    id: 'gate-edit-marks-dirty',
    suite: 'run_and_fix_gate',
    describe: 'a successful code-mutation call marks the workspace dirty',
    run: () => {
      const st = foldRunAndFixRound(createRunAndFixGateState(), [{ name: 'desktop.edit_file', ok: true }]);
      return st.dirty === true && st.round === 1 && st.dirtySinceRound === 1;
    },
  },
  {
    id: 'gate-passing-verification-cleans',
    suite: 'run_and_fix_gate',
    describe: 'a passing verification after an edit marks the workspace verified-clean',
    run: () => {
      const dirty = foldRunAndFixRound(createRunAndFixGateState(), [{ name: 'desktop.edit_file', ok: true }]);
      const clean = foldRunAndFixRound(dirty, [{ name: 'verification.typecheck', ok: true }]);
      return clean.dirty === false && clean.lastVerificationOk === true;
    },
  },
  {
    id: 'gate-mutation-after-verify-stays-dirty',
    suite: 'run_and_fix_gate',
    describe: 'an edit that lands AFTER the passing verification in the same round keeps the workspace dirty',
    run: () => {
      const dirty = foldRunAndFixRound(createRunAndFixGateState(), [{ name: 'desktop.edit_file', ok: true }]);
      const st = foldRunAndFixRound(dirty, [
        { name: 'verification.typecheck', ok: true },
        { name: 'desktop.edit_file', ok: true },
      ]);
      return st.dirty === true;
    },
  },
  {
    id: 'gate-nudges-on-verification-failure',
    suite: 'run_and_fix_gate',
    describe: 'a failed verification this round plans a verification_failed nudge',
    run: () => {
      const st = foldRunAndFixRound(createRunAndFixGateState(), [{ name: 'verification.tests', ok: false }]);
      const nudge = planVerificationNudge(st);
      return nudge.shouldNudge === true && nudge.reason === 'verification_failed';
    },
  },
];

// ─── Runner (TOTAL) ────────────────────────────────────────────────────────────

/**
 * Run ONE golden case inside try/catch. TOTAL: a throwing `run()` (or a
 * hostile/garbage case object with no `run` function) yields a `passed:false`
 * row with a short detail — it never propagates. A `run()` that returns a
 * non-`true` value is a golden mismatch (drift), also `passed:false`.
 */
export function runCoreGoldenCase(c: CoreGoldenCase): CoreGoldenResult {
  const caseId = c && typeof c.id === 'string' ? c.id : '(unknown)';
  const suite = c && typeof c.suite === 'string' ? c.suite : '(unknown)';
  try {
    if (!c || typeof c.run !== 'function') {
      return { caseId, suite, passed: false, detail: 'invalid case: run is not a function' };
    }
    const ok = c.run() === true;
    return ok ? { caseId, suite, passed: true } : { caseId, suite, passed: false, detail: 'golden mismatch (behavioral drift)' };
  } catch (err) {
    return { caseId, suite, passed: false, detail: `threw: ${safeErr(err)}` };
  }
}

/**
 * Run the whole deterministic corpus and return one result row per case. This is
 * the tier-1 (no-keys, no-network) suite `scripts/run-evals.ts` runs on every CI
 * invocation: if any pure core drifts, its case flips to `passed:false` here.
 * TOTAL — never throws; a broken case becomes a failing row, not a crash.
 */
export function runCoreGoldenCorpus(): CoreGoldenResult[] {
  const rows: CoreGoldenResult[] = [];
  for (const c of CORE_GOLDEN_CORPUS) {
    rows.push(runCoreGoldenCase(c));
  }
  return rows;
}

/** Distinct suite names present in the corpus (stable, sorted). */
export function coreGoldenSuites(): string[] {
  const seen = new Set<string>();
  for (const c of CORE_GOLDEN_CORPUS) {
    if (c && typeof c.suite === 'string') seen.add(c.suite);
  }
  return Array.from(seen).sort();
}
