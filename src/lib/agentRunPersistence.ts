/**
 * agentRunPersistence — adapter that wires AgentExecutionCore events into the
 * existing agent_runs / agent_run_events tables.
 *
 * Call `createPersistedRun()` before `runAgent(...)`; pass the returned
 * `onEvent` handler into the core. Tool calls, results, model turns, and
 * final response all end up in `agent_run_events` (for trajectory replay
 * + the future evaluator), while per-run totals (iteration count, stop
 * reason, aggregate tool calls) land on `agent_runs` itself so the run
 * list UI shows accurate summaries without joining.
 *
 * Failures are non-fatal: we never block the agent loop on a DB write.
 * A bad row on the telemetry side should not kill a user-visible run.
 */

import { supabase } from './supabase';
import {
  PERSISTED_TOOL_FAILURE_TEXT,
  boundEventPayload,
  boundToolCallsAggregate,
} from './eventBoundCore';
import { estimateRunCostUsd } from './runCostRollupCore';
import { createRun, updateRunStatus, type AgentRun, type RunSurface } from './agentRunSystem';
import type { AgentEvent, AgentRunResult, AgentToolResult } from './agentExecutionCore';

export type PersistedRunHandle = {
  run: AgentRun;
  /** Pass this into `runAgent({ onEvent })`. */
  onEvent: (event: AgentEvent) => void;
  /** Call once the core finishes. Writes totals + final status. */
  finalize: (result: AgentRunResult, err?: unknown) => Promise<void>;
  /**
   * Stop the wall-clock heartbeat without finalize's raw terminal write.
   * For runtimes that own their terminal row (e.g. swanbotV2BatchRuntime):
   * MUST be called on every terminal path so the interval never keeps
   * forging liveness on a finished run. Idempotent (clearInterval), and
   * finalize already calls it — double-stop is harmless.
   */
  stopHeartbeat: () => void;
};

export type CreatePersistedRunOptions = {
  circleId: string;
  userId: string;
  surface: RunSurface;
  title: string;
  goal?: string;
  mode?: string;
  model?: string;
  provider?: string;
  roomId?: string;
  chatSessionId?: string;
  parentRunId?: string;
  /**
   * If true, every AgentEvent is written to agent_run_events in real time.
   * Default true for durability. Set false for latency-critical paths where
   * you only care about the final summary.
   */
  streamEvents?: boolean;
  /** Optional extra metadata merged onto the run row. */
  metadata?: Record<string, unknown>;
};

type PersistedReceiptPrimitive = string | number | boolean | null;
type PersistedReceiptSubset = Record<string, PersistedReceiptPrimitive>;

/**
 * The only AgentToolResult.metadata namespaces allowed into durable typed-loop
 * telemetry. Tool metadata is a hidden runtime side channel and may contain
 * policy objects, browser state, local paths, or provider payloads, so callers
 * must never persist it wholesale.
 */
export type PersistedToolResultReceiptMetadata = Partial<Record<
  | 'computerActionReceipt'
  | 'mutationDispatchReceipt'
  | 'computerAppVerificationReceipt'
  | 'verificationReceipt',
  PersistedReceiptSubset
>>;

export type PersistedToolActionMetadata = PersistedToolResultReceiptMetadata & {
  toolPolicy?: {
    family: string;
    approvalMode: 'auto' | 'ask';
    mutatesState: boolean;
    externalSideEffect: boolean;
    approvalKind?: string;
  };
  approvalRequest?: {
    id?: string;
    required: boolean;
    status: string;
  };
  source?: string;
  ledgerArtifactKind?: 'design_object_manifest';
};

type ReceiptFieldKind = 'string' | 'nullable_string' | 'number' | 'boolean';
type ReceiptFieldSpec = readonly [name: string, kind: ReceiptFieldKind];

const RECEIPT_STRING_MAX_CHARS = 240;
const RECEIPT_NUMBER_ABS_MAX = 1_000_000_000_000;
const RECEIPT_DERIVED_COUNT_MAX = 10_000;

const COMPUTER_ACTION_RECEIPT_FIELDS: readonly ReceiptFieldSpec[] = [
  ['schemaVersion', 'number'],
  ['tool', 'string'],
  ['surface', 'string'],
  ['toolArgsFingerprint', 'string'],
  ['argsFingerprint', 'string'],
  ['handlerEnteredAt', 'string'],
  ['handlerExitedAt', 'string'],
  ['dispatchedAt', 'string'],
  ['completedAt', 'string'],
  ['outcome', 'string'],
  ['status', 'string'],
  ['risk', 'string'],
  ['approvalState', 'string'],
  ['mutates', 'boolean'],
  ['approvalRequired', 'boolean'],
  ['ok', 'boolean'],
  ['canComplete', 'boolean'],
  ['iteration', 'number'],
  ['durationMs', 'number'],
  ['evidenceCount', 'number'],
  ['blockerCount', 'number'],
] as const;

const MUTATION_DISPATCH_RECEIPT_FIELDS: readonly ReceiptFieldSpec[] = [
  ['schemaVersion', 'number'],
  ['tool', 'string'],
  ['authorizedAt', 'string'],
  ['dispatchedAt', 'string'],
] as const;

const COMPUTER_APP_VERIFICATION_RECEIPT_FIELDS: readonly ReceiptFieldSpec[] = [
  ['schemaVersion', 'number'],
  ['status', 'string'],
  ['checkedAt', 'string'],
  ['canComplete', 'boolean'],
  ['evidenceCount', 'number'],
  ['blockerCount', 'number'],
] as const;

const VERIFICATION_RECEIPT_FIELDS: readonly ReceiptFieldSpec[] = [
  ['verdict', 'string'],
  ['committed', 'boolean'],
  ['commitRef', 'string'],
  ['editedFileCount', 'number'],
  ['checkCount', 'number'],
  ['passedCheckCount', 'number'],
  ['failedCheckCount', 'number'],
] as const;

function receiptRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readReceiptField(record: Record<string, unknown>, key: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
  } catch {
    return undefined;
  }
}

function boundedReceiptString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // Scan only a small bounded prefix, drop control characters, and collapse
  // whitespace before clipping. The persistence-boundary event/tool-call
  // bounders still perform the authoritative secret masking at write time.
  const scan = value.slice(0, RECEIPT_STRING_MAX_CHARS * 4);
  let out = '';
  let pendingSpace = false;
  for (let i = 0; i < scan.length && out.length < RECEIPT_STRING_MAX_CHARS; i++) {
    const code = scan.charCodeAt(i);
    if (code <= 32 || code === 127) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace && out.length < RECEIPT_STRING_MAX_CHARS) out += ' ';
    pendingSpace = false;
    if (out.length < RECEIPT_STRING_MAX_CHARS) out += scan[i];
  }
  return out || undefined;
}

const RECEIPT_TOOL_RE = /^[A-Za-z][A-Za-z0-9_-]{0,79}\.[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const RECEIPT_FINGERPRINT_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const RECEIPT_COMMIT_RE = /^[0-9a-f]{7,64}$/;
const RECEIPT_SURFACES = new Set([
  'browser', 'desktop', 'vault', 'terminal', 'file', 'code', 'research', 'approval', 'system',
]);
const RECEIPT_OUTCOMES = new Set([
  'succeeded', 'success', 'passed', 'completed', 'verified',
  'failed', 'error', 'blocked', 'cancelled', 'inconclusive', 'outcome_unknown',
]);
const RECEIPT_STATUSES = new Set([
  'pending', 'running', 'passed', 'completed', 'success', 'verified',
  'failed', 'error', 'blocked', 'skipped', 'cancelled',
  'manual_required', 'inconclusive', 'outcome_unknown',
]);
const RECEIPT_RISKS = new Set(['low', 'medium', 'high', 'critical']);
const RECEIPT_APPROVAL_STATES = new Set([
  'not_required', 'pending', 'approved', 'auto_approved', 'rejected',
]);
const RECEIPT_VERIFICATION_STATUSES = new Set(['verified', 'failed', 'inconclusive']);
const RECEIPT_VERDICTS = new Set(['verified', 'unverified', 'failed']);
const TOOL_POLICY_FAMILIES = new Set([
  'code', 'verification', 'memory', 'knowledge', 'coordination',
  'browser', 'workspace', 'approval', 'vault', 'agent',
]);
const TOOL_POLICY_APPROVAL_KINDS = new Set([
  'tool_use', 'publish', 'external_send', 'file_write', 'browser_action',
  'cost_threshold', 'privileged_action', 'plan_approval', 'deliverable_review',
]);
const APPROVAL_REQUEST_STATUSES = new Set([
  'pending', 'approved', 'rejected', 'expired', 'consumed', 'cancelled',
]);
const TOOL_ACTION_SOURCES = new Set([
  'openswan_runtime_tool_loop',
  'openswan_session_runtime',
  'subagent_runtime',
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validatedReceiptString(field: string, value: unknown): string | undefined {
  const bounded = boundedReceiptString(value);
  if (!bounded) return undefined;
  if (field === 'tool') return RECEIPT_TOOL_RE.test(bounded) ? bounded : undefined;
  if (field === 'toolArgsFingerprint' || field === 'argsFingerprint') {
    return RECEIPT_FINGERPRINT_RE.test(bounded) ? bounded : undefined;
  }
  if (
    field === 'handlerEnteredAt'
    || field === 'handlerExitedAt'
    || field === 'authorizedAt'
    || field === 'dispatchedAt'
    || field === 'completedAt'
    || field === 'checkedAt'
  ) {
    const timestamp = Date.parse(bounded);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === bounded
      ? bounded
      : undefined;
  }
  if (field === 'surface') return RECEIPT_SURFACES.has(bounded) ? bounded : undefined;
  if (field === 'outcome') return RECEIPT_OUTCOMES.has(bounded) ? bounded : undefined;
  if (field === 'status') return RECEIPT_STATUSES.has(bounded) || RECEIPT_VERIFICATION_STATUSES.has(bounded)
    ? bounded
    : undefined;
  if (field === 'risk') return RECEIPT_RISKS.has(bounded) ? bounded : undefined;
  if (field === 'approvalState') return RECEIPT_APPROVAL_STATES.has(bounded) ? bounded : undefined;
  if (field === 'verdict') return RECEIPT_VERDICTS.has(bounded) ? bounded : undefined;
  if (field === 'commitRef') return RECEIPT_COMMIT_RE.test(bounded) ? bounded : undefined;
  return undefined;
}

function boundedReceiptNumber(field: string, value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (field === 'schemaVersion') return value === 1 ? 1 : undefined;
  if (
    field === 'iteration'
    || field === 'evidenceCount'
    || field === 'blockerCount'
    || field === 'editedFileCount'
    || field === 'checkCount'
    || field === 'passedCheckCount'
    || field === 'failedCheckCount'
  ) {
    return Number.isInteger(value) && value >= 0 && value <= RECEIPT_DERIVED_COUNT_MAX
      ? value
      : undefined;
  }
  if (field === 'durationMs') {
    return Number.isInteger(value) && value >= 0 && value <= 86_400_000
      ? value
      : undefined;
  }
  return Math.max(-RECEIPT_NUMBER_ABS_MAX, Math.min(RECEIPT_NUMBER_ABS_MAX, value));
}

function boundedReceiptCount(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return Math.min(RECEIPT_DERIVED_COUNT_MAX, value.length);
  } catch {
    return undefined;
  }
}

function readReceiptArrayItem(value: unknown[], index: number): unknown {
  try {
    return value[index];
  } catch {
    return undefined;
  }
}

function pickReceiptFields(
  value: unknown,
  fields: readonly ReceiptFieldSpec[],
): PersistedReceiptSubset | undefined {
  const record = receiptRecord(value);
  if (!record) return undefined;
  const out: PersistedReceiptSubset = {};
  for (const [field, kind] of fields) {
    const raw = readReceiptField(record, field);
    if (kind === 'boolean') {
      if (typeof raw === 'boolean') out[field] = raw;
      continue;
    }
    if (kind === 'number') {
      const bounded = boundedReceiptNumber(field, raw);
      if (bounded !== undefined) out[field] = bounded;
      continue;
    }
    if (kind === 'nullable_string' && raw === null) {
      out[field] = null;
      continue;
    }
    const bounded = validatedReceiptString(field, raw);
    if (bounded !== undefined) out[field] = bounded;
  }
  const projectedFields = Object.keys(out);
  if (projectedFields.length === 0) return undefined;
  // A version marker alone is not evidence. If every semantic field was
  // invalid or rejected, omit the receipt instead of creating a misleading
  // durable `{schemaVersion: 1}` shell.
  if (projectedFields.length === 1 && projectedFields[0] === 'schemaVersion') return undefined;
  return out;
}

function withDerivedCount(
  receipt: PersistedReceiptSubset | undefined,
  source: Record<string, unknown> | null,
  sourceField: string,
  outputField: string,
): PersistedReceiptSubset | undefined {
  const count = source ? boundedReceiptCount(readReceiptField(source, sourceField)) : undefined;
  if (count === undefined) return receipt;
  return { ...(receipt || {}), [outputField]: count };
}

function sanitizeVerificationReceipt(value: unknown): PersistedReceiptSubset | undefined {
  const source = receiptRecord(value);
  let receipt = pickReceiptFields(source, VERIFICATION_RECEIPT_FIELDS);
  receipt = withDerivedCount(receipt, source, 'editedFiles', 'editedFileCount');
  receipt = withDerivedCount(receipt, source, 'checks', 'checkCount');

  const checks = source ? readReceiptField(source, 'checks') : undefined;
  if (Array.isArray(checks)) {
    let passed = 0;
    let failed = 0;
    const cap = boundedReceiptCount(checks) || 0;
    for (let i = 0; i < cap; i++) {
      const check = receiptRecord(readReceiptArrayItem(checks, i));
      if (!check) continue;
      if (readReceiptField(check, 'passed') === true) passed += 1;
      else if (readReceiptField(check, 'passed') === false) failed += 1;
    }
    receipt = {
      ...(receipt || {}),
      passedCheckCount: passed,
      failedCheckCount: failed,
    };
  }
  return receipt && Object.keys(receipt).length > 0 ? receipt : undefined;
}

/**
 * Return a compact, primitive-only proof/receipt subset from hidden tool result
 * metadata. Unknown namespaces and free-form fields are intentionally dropped.
 * This helper is total and side-effect free. Its field-specific validators are
 * the first authority boundary; the event/tool-call bounders remain a
 * defense-in-depth size and secret-pattern backstop at the final writes.
 */
export function sanitizeToolResultMetadataForPersistence(
  metadata: unknown,
): PersistedToolResultReceiptMetadata | undefined {
  const source = receiptRecord(metadata);
  if (!source) return undefined;
  const out: PersistedToolResultReceiptMetadata = {};

  const computerActionReceipt = pickReceiptFields(
    readReceiptField(source, 'computerActionReceipt'),
    COMPUTER_ACTION_RECEIPT_FIELDS,
  );
  if (computerActionReceipt) out.computerActionReceipt = computerActionReceipt;

  const mutationDispatchReceipt = pickReceiptFields(
    readReceiptField(source, 'mutationDispatchReceipt'),
    MUTATION_DISPATCH_RECEIPT_FIELDS,
  );
  if (mutationDispatchReceipt) out.mutationDispatchReceipt = mutationDispatchReceipt;

  const verificationSource = receiptRecord(readReceiptField(source, 'computerAppVerificationReceipt'));
  let computerAppVerificationReceipt = pickReceiptFields(
    verificationSource,
    COMPUTER_APP_VERIFICATION_RECEIPT_FIELDS,
  );
  computerAppVerificationReceipt = withDerivedCount(
    computerAppVerificationReceipt,
    verificationSource,
    'evidenceIds',
    'evidenceCount',
  );
  computerAppVerificationReceipt = withDerivedCount(
    computerAppVerificationReceipt,
    verificationSource,
    'blockers',
    'blockerCount',
  );
  if (computerAppVerificationReceipt) {
    out.computerAppVerificationReceipt = computerAppVerificationReceipt;
  }

  const verificationReceipt = sanitizeVerificationReceipt(
    readReceiptField(source, 'verificationReceipt'),
  );
  if (verificationReceipt) out.verificationReceipt = verificationReceipt;

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Project hidden runtime metadata into the only policy/correlation shapes that
 * durable action cards need. Browser plans and design-app captures are
 * deliberately excluded: the session runtime extracts those into their
 * dedicated, typed product records before calling this boundary.
 */
export function sanitizeToolActionMetadataForPersistence(
  metadata: unknown,
): PersistedToolActionMetadata | undefined {
  const source = receiptRecord(metadata);
  if (!source) return undefined;
  const out: PersistedToolActionMetadata = {
    ...(sanitizeToolResultMetadataForPersistence(source) || {}),
  };

  const policy = receiptRecord(readReceiptField(source, 'toolPolicy'));
  if (policy) {
    const family = readReceiptField(policy, 'family');
    const approvalMode = readReceiptField(policy, 'approvalMode');
    const mutatesState = readReceiptField(policy, 'mutatesState');
    const externalSideEffect = readReceiptField(policy, 'externalSideEffect');
    const approvalKind = readReceiptField(policy, 'approvalKind');
    if (
      typeof family === 'string'
      && TOOL_POLICY_FAMILIES.has(family)
      && (approvalMode === 'auto' || approvalMode === 'ask')
      && typeof mutatesState === 'boolean'
      && typeof externalSideEffect === 'boolean'
    ) {
      out.toolPolicy = {
        family,
        approvalMode,
        mutatesState,
        externalSideEffect,
        ...(typeof approvalKind === 'string' && TOOL_POLICY_APPROVAL_KINDS.has(approvalKind)
          ? { approvalKind }
          : {}),
      };
    }
  }

  const approvalRequest = receiptRecord(readReceiptField(source, 'approvalRequest'));
  if (approvalRequest) {
    const id = readReceiptField(approvalRequest, 'id');
    const required = readReceiptField(approvalRequest, 'required');
    const status = readReceiptField(approvalRequest, 'status');
    if (
      typeof required === 'boolean'
      && typeof status === 'string'
      && APPROVAL_REQUEST_STATUSES.has(status)
    ) {
      out.approvalRequest = {
        ...(typeof id === 'string' && UUID_RE.test(id) ? { id } : {}),
        required,
        status,
      };
    }
  }

  const actionSource = readReceiptField(source, 'source');
  if (typeof actionSource === 'string' && TOOL_ACTION_SOURCES.has(actionSource)) {
    out.source = actionSource;
  }
  if (readReceiptField(source, 'ledgerArtifactKind') === 'design_object_manifest') {
    out.ledgerArtifactKind = 'design_object_manifest';
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * #8: persist a single `solver_consultation` marker for a run that is NOT
 * driven by the typed-core event stream above.
 *
 * The typed core (via `onEvent` → `writeEvent`) and the browser edge already
 * write this row when the stuck-solver is consulted, so consultation rounds
 * show up in transcripts/dashboards. The LEGACY relay loop in `swanbot.ts`
 * consults the same solver but has only a bare `runId` string (no
 * PersistedRunHandle), so its consultations were invisible. This helper is
 * the same raw insert `writeEvent` uses — identical `kind` + `{ iteration,
 * reason }` payload shape — so the two paths are indistinguishable in the
 * event log. Non-fatal by the same rule: a telemetry write must never break
 * a user-visible run.
 */
export async function recordSolverConsultationEvent(opts: {
  runId: string;
  iteration: number;
  reason: string;
}): Promise<void> {
  if (!opts.runId) return;
  try {
    await supabase.from('agent_run_events').insert({
      run_id: opts.runId,
      kind: 'solver_consultation',
      payload: { iteration: opts.iteration, reason: opts.reason },
    });
  } catch (e) {
    // Non-fatal — telemetry failures should never bubble (writeEvent rule).
    console.warn('[agentRunPersistence] solver_consultation insert failed:', e);
  }
}

/** Timer period for {@link startRunHeartbeat} — well under RUN_STALL_STALE_MS (2 min). */
export const RUN_HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Timer-driven run heartbeat (run-reaper wire, shared). Event-driven bumps
 * alone starve during one long await — a long extended-thinking completion or
 * a bridge exec can legally outlast RUN_STALL_DEAD_MS with zero events — so a
 * live run must also beat on wall-clock time. Bumps `agent_runs.updated_at`
 * every ~60s via a direct column update on purpose — NOT `updateRunStatus`,
 * which resets `started_at` while status is 'running'. Fire-and-forget and
 * non-fatal like every other telemetry write here. Returns a `stop()` that
 * MUST be called on every terminal path (finalize / finally) so the timer
 * never keeps beating for a finished run.
 */
export function startRunHeartbeat(runId: string): () => void {
  const bump = () => {
    supabase
      .from('agent_runs')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', runId)
      .then(
        ({ error }) => {
          if (error) console.warn('[agentRunPersistence] heartbeat update failed:', error);
        },
        (e: unknown) => console.warn('[agentRunPersistence] heartbeat update failed:', e),
      );
  };
  const timer = setInterval(bump, RUN_HEARTBEAT_INTERVAL_MS);
  return () => clearInterval(timer);
}

export async function createPersistedRun(opts: CreatePersistedRunOptions): Promise<PersistedRunHandle | null> {
  const run = await createRun({
    circleId: opts.circleId,
    userId: opts.userId,
    surface: opts.surface,
    title: opts.title,
    goal: opts.goal,
    mode: opts.mode,
    model: opts.model,
    provider: opts.provider,
    roomId: opts.roomId,
    chatSessionId: opts.chatSessionId,
    parentRunId: opts.parentRunId,
    // Run-reaper opt-in (fail-safe floor): `heartbeat: true` marks this run as
    // provably heartbeating — event bumps + the wall-clock timer below — so the
    // dashboard reapers may flip it to 'failed' on a dead heartbeat. Runs
    // WITHOUT this flag (edge loops, legacy runtimes) must never be reaped;
    // they get at most a soft "stalled?" badge.
    metadata: { ...(opts.metadata || {}), heartbeat: true },
  });
  if (!run) return null;

  // Wall-clock heartbeat for the whole run lifetime (creation → finalize):
  // covers long single awaits (extended thinking, slow tools) where no event
  // fires. Stopped in finalize on both the success and error paths.
  const stopHeartbeat = startRunHeartbeat(run.id);

  const streamEvents = opts.streamEvents !== false;

  // Aggregates we roll up into agent_runs at finalize-time.
  const toolCalls: Array<{
    toolName: string;
    toolUseId: string;
    input: unknown;
    ok: boolean;
    durationMs: number;
    dispatched: boolean | null;
    metadata?: PersistedToolResultReceiptMetadata;
    error?: string;
  }> = [];
  let lastStopReason: string | undefined;
  let finalIteration = 0;
  let sawUsage = false;
  const tokenTotals = {
    input: 0,
    output: 0,
    cached: 0,
  };

  // Heartbeat (run-reaper wire): bump agent_runs.updated_at on model/tool
  // activity so runStallPolicyCore can tell a live run from a zombie. Direct
  // column update on purpose — NOT updateRunStatus, which resets started_at
  // when status is 'running'. Throttled so bursty tool loops don't hammer the
  // row; fire-and-forget and non-fatal like every other telemetry write here.
  const HEARTBEAT_MIN_INTERVAL_MS = 30_000;
  let lastHeartbeatAtMs = 0;
  const bumpHeartbeat = () => {
    const nowMs = Date.now();
    if (nowMs - lastHeartbeatAtMs < HEARTBEAT_MIN_INTERVAL_MS) return;
    lastHeartbeatAtMs = nowMs;
    supabase
      .from('agent_runs')
      .update({ updated_at: new Date(nowMs).toISOString() })
      .eq('id', run.id)
      .then(
        ({ error }) => {
          if (error) console.warn('[agentRunPersistence] heartbeat update failed:', error);
        },
        (e: unknown) => console.warn('[agentRunPersistence] heartbeat update failed:', e),
      );
  };

  const writeEvent = async (kind: string, payload: Record<string, unknown>) => {
    // Heartbeat fires on every model/tool event — even when event streaming
    // is disabled — so liveness stays truthful on latency-critical runs.
    bumpHeartbeat();
    if (!streamEvents) return;
    try {
      await supabase.from('agent_run_events').insert({
        run_id: run.id,
        kind,
        // Bound the payload (audit): this is the highest-frequency telemetry
        // table and the payload can carry arbitrary (even cyclic) tool input —
        // cap depth/size/strings, cyclic-safe, secret-masked, before insert.
        payload: boundEventPayload(kind, payload) as Record<string, unknown>,
      });
    } catch {
      // Non-fatal — telemetry failures should never bubble.
      console.warn('[agentRunPersistence] event_insert_failed');
    }
  };

  // Map each AgentEvent to a storage-friendly row. Fire-and-forget; we do
  // NOT await each write so the loop is not bottlenecked on Supabase
  // latency. The small accepted tradeoff: if the process dies mid-run,
  // the last few events may be lost.
  const onEvent = (event: AgentEvent) => {
    switch (event.kind) {
      case 'turn_start':
        void writeEvent('turn_start', { iteration: event.iteration });
        break;
      case 'turn_end':
        finalIteration = event.iteration;
        lastStopReason = event.stop_reason;
        if (event.usage) {
          sawUsage = true;
          tokenTotals.input += Math.max(0, Math.floor(event.usage.input_tokens || 0));
          tokenTotals.output += Math.max(0, Math.floor(event.usage.output_tokens || 0));
          tokenTotals.cached += Math.max(0, Math.floor(
            (event.usage.cache_read_input_tokens || 0) + (event.usage.cache_creation_input_tokens || 0),
          ));
        }
        void writeEvent('turn_end', {
          iteration: event.iteration,
          stop_reason: event.stop_reason,
          usage: event.usage || null,
        });
        break;
      case 'model_delta':
        // Skip streaming deltas for the event log — they're fine-grained
        // UI signal, not durable state. Keeping them would 10x the row
        // count for marginal replay value.
        break;
      case 'context_compressed':
        void writeEvent('context_compressed', {
          iteration: event.iteration,
          dropped_count: event.droppedCount,
          tokens_before: event.tokensBefore,
          tokens_after: event.tokensAfter,
        });
        break;
      case 'iteration_complete':
        // Checkpoint boundary (R12). Store the marker + size only — the
        // message snapshot itself is for in-process checkpoint consumers,
        // not the event log (it can be hundreds of KB).
        void writeEvent('iteration_complete', {
          iteration: event.iteration,
          message_count: event.messages.length,
        });
        break;
      case 'tool_call_start':
        void writeEvent('tool_call_start', {
          iteration: event.iteration,
          tool: event.toolName,
          tool_use_id: event.toolUseId,
          input: event.input,
        });
        break;
      case 'tool_call_result': {
        const tr = event.result as AgentToolResult;
        const dispatched = typeof event.dispatched === 'boolean' ? event.dispatched : null;
        const metadata = sanitizeToolResultMetadataForPersistence(tr.metadata);
        toolCalls.push({
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: undefined, // kept in tool_call_start event to save bytes
          ok: tr.ok,
          durationMs: event.durationMs,
          dispatched,
          ...(metadata ? { metadata } : {}),
          error: tr.ok ? undefined : PERSISTED_TOOL_FAILURE_TEXT,
        });
        void writeEvent('tool_call_result', {
          iteration: event.iteration,
          tool: event.toolName,
          tool_use_id: event.toolUseId,
          ok: tr.ok,
          duration_ms: event.durationMs,
          dispatched,
          ...(metadata ? { metadata } : {}),
          ...(tr.ok ? {} : { error: tr.error }),
        });
        break;
      }
      case 'final_response':
        void writeEvent('final_response', {
          iteration: event.iteration,
          preview: event.text.slice(0, 400),
          length: event.text.length,
        });
        break;
      case 'max_iterations_exceeded':
        void writeEvent('max_iterations_exceeded', { iteration: event.iteration });
        break;
      case 'solver_consultation':
        // P56/P62: stuck-solver rounds were invisible in run telemetry —
        // persist the marker so transcripts/dashboards can spot consultation
        // rounds (the toolLoopSolver module header promises this).
        void writeEvent('solver_consultation', {
          iteration: event.iteration,
          reason: event.reason,
        });
        break;
      case 'loop_stopped_no_progress':
        void writeEvent('loop_stopped_no_progress', {
          iteration: event.iteration,
          reason: event.reason,
        });
        break;
    }
  };

  const finalize = async (result: AgentRunResult, err?: unknown) => {
    stopHeartbeat();
    const status = err
      ? 'failed'
      : result.hitMaxIterations
        ? 'failed'
        : 'completed';

    try {
      await supabase
        .from('agent_runs')
        .update({
          // Bound the aggregate the same way writeEvent bounds each event row:
          // this jsonb column otherwise stored the FULL tool_calls array with raw,
          // un-truncated error strings — oversized rows and unmasked secret-shaped
          // tokens. boundToolCallsAggregate caps entries (~50 + marker), clips
          // per-entry size/strings, and secret-masks. (NOT boundEventPayload —
          // that is tuned for a single event row, not this aggregate.)
          tool_calls: boundToolCallsAggregate(toolCalls),
          iteration_count: result.iterations || finalIteration,
          final_stop_reason: result.stopReason || lastStopReason || null,
          ...(sawUsage ? {
            input_tokens: tokenTotals.input,
            output_tokens: tokenTotals.output,
            cached_tokens: tokenTotals.cached,
            // Cost attribution: the estimated_cost column (plain numeric DEFAULT 0,
            // no trigger) was never written on this path, so every run except the
            // openswanSessionRuntime path reported $0 to the office ops board,
            // console recent-runs, AgentRunsPanel, RunTraceCard, and
            // circleCostTelemetry. Price the token rollup with the zero-import core.
            // Honest caveat: a delegating parent already folds its child runs'
            // tokens into its own totals, so a parent's estimate double-counts the
            // child's spend — a pre-existing token-rollup property, not new here.
            estimated_cost: estimateRunCostUsd({
              model: run.model,
              inputTokens: tokenTotals.input,
              outputTokens: tokenTotals.output,
              cachedTokens: tokenTotals.cached,
            }),
          } : {}),
        })
        .eq('id', run.id);
    } catch {
      console.warn('[agentRunPersistence] finalize_columns_update_failed');
    }

    await updateRunStatus(run.id, status, {
      completed_at: new Date().toISOString(),
    });

    if (err) {
      await writeEvent('error', {
        message: PERSISTED_TOOL_FAILURE_TEXT,
        error_code: 'agent_run_failed',
        redacted: true,
      });
    }
  };

  return { run, onEvent, finalize, stopHeartbeat };
}
