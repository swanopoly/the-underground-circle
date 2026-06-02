import { supabase } from './supabase';
import { classifyAgentFailure, type AgentFailureAssessment } from './agentFailureTaxonomy';
import type { AgentRunLedgerEvent, AgentRunLedgerEventType, AgentRunLedgerPreview } from './agentRunLedger';
import type { UserTaskPipelineRisk } from './userTaskPipelines';

type LedgerPersistStatus = 'persisted' | 'partial' | 'skipped' | 'schema_missing' | 'failed';

export type AgentRunLedgerPersistResult = {
  ok: boolean;
  status: LedgerPersistStatus;
  warnings: string[];
  wrote: {
    budget: boolean;
    events: number;
    failures: number;
    metadataFallback: boolean;
  };
};

export type RuntimeToolActionForLedger = {
  tool_name?: string | null;
  title?: string | null;
  status?: 'completed' | 'failed' | 'manual_required' | 'blocked' | string | null;
  input_preview?: string | null;
  output_preview?: string | null;
  artifact_refs?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

type LegacyToolEventStatus = 'planned' | 'running' | 'passed' | 'failed' | 'manual_required' | 'blocked';

const SECRET_KEY_RE = /(password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|refresh[_-]?token|access[_-]?token|client[_-]?secret)/i;
const SECRET_VALUE_RE = /\b(sk-(?:ant|proj|or|live|test)?[-_a-zA-Z0-9]{12,}|Bearer\s+[-_a-zA-Z0-9.]{12,}|xox[baprs]-[-_a-zA-Z0-9]{12,})\b/g;
const LOCAL_PATH_RE = /(\/Users\/[^\s;\n\r`'"]+|\/private\/[^\s;\n\r`'"]+|[A-Za-z]:\\[^\s;\n\r`'"]+)/g;

function emptyResult(status: LedgerPersistStatus = 'skipped'): AgentRunLedgerPersistResult {
  return {
    ok: status === 'persisted',
    status,
    warnings: [],
    wrote: { budget: false, events: 0, failures: 0, metadataFallback: false },
  };
}

function stringifyError(error: unknown): string {
  if (!error) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

export function isLedgerSchemaMissing(error: unknown): boolean {
  const text = stringifyError(error).toLowerCase();
  return (
    text.includes('relation') && text.includes('does not exist')
  ) || text.includes('schema cache') || text.includes('not found') || text.includes('404');
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function redactLocalPath(value: string): string {
  const basename = value.split(/[\\/]/).filter(Boolean).pop() || 'local-path';
  return `[local-path:${basename.slice(0, 120)}#${stableHash(value)}]`;
}

function redactString(value: string): string {
  return value
    .replace(SECRET_VALUE_RE, '[REDACTED_SECRET]')
    .replace(LOCAL_PATH_RE, redactLocalPath)
    .slice(0, 1600);
}

export function sanitizeLedgerPayload(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return String(value);
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (depth >= 5) return '[TRUNCATED_DEPTH]';

  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeLedgerPayload(item, depth + 1, seen));
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
      out[key] = SECRET_KEY_RE.test(key) ? '[REDACTED_SECRET]' : sanitizeLedgerPayload(item, depth + 1, seen);
    }
    return out;
  }

  return String(value);
}

function eventKey(source: string, event: Pick<AgentRunLedgerEvent, 'eventType' | 'actor' | 'toolName'>, index: number): string {
  return [source, event.eventType, event.actor, event.toolName || 'none', index].join(':').slice(0, 180);
}

function failureKey(source: string, failure: Pick<AgentFailureAssessment, 'failureClass'>, surface?: string | null, toolName?: string | null): string {
  return [source, failure.failureClass, surface || 'unknown', toolName || 'plan'].join(':').slice(0, 180);
}

function eventStatus(eventType: AgentRunLedgerEventType): 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped' {
  if (eventType === 'tool_started') return 'running';
  if (eventType === 'approval_requested') return 'pending';
  if (eventType === 'blocked') return 'blocked';
  if (eventType === 'failed') return 'failed';
  return 'completed';
}

function budgetStatus(preview: AgentRunLedgerPreview, outcomeStatus?: string | null): 'active' | 'exceeded' | 'approved_overage' | 'closed' {
  if (outcomeStatus === 'completed' || outcomeStatus === 'failed' || outcomeStatus === 'blocked' || outcomeStatus === 'skipped') return 'closed';
  if (preview.status === 'failed' || preview.status === 'cancelled' || preview.status === 'blocked') return 'closed';
  return 'active';
}

export function mapLegacyToolEventToLedgerStatus(status: LegacyToolEventStatus): {
  eventType: AgentRunLedgerEventType;
  rowStatus: 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped';
} {
  switch (status) {
    case 'planned':
      return { eventType: 'planned', rowStatus: 'pending' };
    case 'running':
      return { eventType: 'tool_started', rowStatus: 'running' };
    case 'passed':
      return { eventType: 'tool_finished', rowStatus: 'completed' };
    case 'manual_required':
      return { eventType: 'approval_requested', rowStatus: 'pending' };
    case 'blocked':
      return { eventType: 'blocked', rowStatus: 'blocked' };
    case 'failed':
    default:
      return { eventType: 'failed', rowStatus: 'failed' };
  }
}

function normalizeRisk(risk?: string | null): UserTaskPipelineRisk {
  if (risk === 'review' || risk === 'external_side_effect' || risk === 'destructive') return risk;
  return 'safe';
}

async function mergeLedgerFallback(runId: string, fallback: Record<string, unknown>): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('agent_runs')
      .select('metadata')
      .eq('id', runId)
      .maybeSingle();
    const existing = ((data as any)?.metadata || {}) as Record<string, unknown>;
    const existingFallbacks = Array.isArray(existing.ledgerPersistenceFallbacks)
      ? existing.ledgerPersistenceFallbacks.slice(-8)
      : [];
    const { error } = await supabase
      .from('agent_runs')
      .update({
        metadata: {
          ...existing,
          ledgerPersistenceFallbacks: [
          ...existingFallbacks,
          {
              ...(sanitizeLedgerPayload(fallback) as Record<string, unknown>),
              recordedAt: new Date().toISOString(),
          },
          ],
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId);
    return !error;
  } catch {
    return false;
  }
}

function previewEventRows(input: {
  preview: AgentRunLedgerPreview;
  actualRunId: string;
  circleId: string;
  userId?: string | null;
  source: string;
}): Record<string, unknown>[] {
  return input.preview.events.map((event, index) => ({
    run_id: input.actualRunId,
    circle_id: input.circleId,
    user_id: event.userId || input.userId || null,
    scenario_id: event.scenarioId || input.preview.scenarioId,
    event_key: eventKey(input.source, event, index),
    surface: input.preview.primarySurface || 'unknown',
    actor: event.actor,
    event_type: event.eventType,
    tool_name: event.toolName || null,
    risk: event.risk,
    status: eventStatus(event.eventType),
    sanitized_input: sanitizeLedgerPayload({ messageId: event.messageId, sessionId: event.sessionId }),
    sanitized_output: sanitizeLedgerPayload(event.metadata || {}),
    artifact_refs: event.artifactRefs || [],
    input_tokens: event.inputTokens || 0,
    output_tokens: event.outputTokens || 0,
    estimated_cost: event.costUsd || 0,
    metadata: sanitizeLedgerPayload({
      previewRunId: input.preview.runId,
      source: input.source,
      metadata: event.metadata || {},
    }),
    created_at: event.createdAt,
  }));
}

function extractPreviewFailures(preview: AgentRunLedgerPreview, actualRunId: string, circleId: string, userId?: string | null): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  preview.events.forEach((event, index) => {
    const failure = (event.metadata as any)?.failureAssessment as AgentFailureAssessment | undefined;
    if (!failure?.failureClass) return;
    rows.push({
      run_id: actualRunId,
      circle_id: circleId,
      user_id: event.userId || userId || null,
      failure_class: failure.failureClass,
      failure_key: failureKey(`preview:${index}`, failure, preview.primarySurface, event.toolName),
      severity: failure.severity,
      surface: failure.surface || preview.primarySurface || 'unknown',
      retryable: failure.retryable,
      user_action_required: failure.userActionRequired,
      recommended_recovery: failure.recommendedRecovery,
      raw_error: stringifyError((event.metadata as any)?.failureInput || (event.metadata as any)?.error || failure.failureClass),
      signals: failure.signals || [],
      metadata: sanitizeLedgerPayload({ source: 'preview', eventMetadata: event.metadata || {} }),
    });
  });
  return rows;
}

async function upsertRows(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<{ count: number; error?: unknown }> {
  if (rows.length === 0) return { count: 0 };
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  return error ? { count: 0, error } : { count: rows.length };
}

export async function persistAgentRunLedgerPreview(input: {
  preview?: AgentRunLedgerPreview | null;
  actualRunId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  outcomeStatus?: string | null;
  source?: string;
}): Promise<AgentRunLedgerPersistResult> {
  const preview = input.preview || null;
  const actualRunId = input.actualRunId || null;
  const circleId = input.circleId || null;
  if (!preview || !actualRunId || !circleId) return emptyResult('skipped');

  const result = emptyResult('partial');
  const source = input.source || 'planner';

  try {
    const { error } = await supabase.from('agent_run_budgets').upsert({
      run_id: actualRunId,
      circle_id: circleId,
      user_id: input.userId || null,
      scenario_id: preview.scenarioId,
      max_usd: preview.budget.maxUsd,
      max_steps: preview.budget.maxSteps,
      router_model_tier: preview.budget.routerModelTier,
      planner_model_tier: preview.budget.plannerModelTier,
      executor_model_tier: preview.budget.executorModelTier,
      prefer_cheap_models: preview.budget.preferCheapModels,
      allow_computer_use_model: preview.budget.allowComputerUseModel,
      status: budgetStatus(preview, input.outcomeStatus),
      metadata: sanitizeLedgerPayload({
        source,
        previewRunId: preview.runId,
        approvalsRequired: preview.approvalsRequired,
        persistenceTargets: preview.persistenceTargets,
      }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'run_id' });
    if (error) throw error;
    result.wrote.budget = true;
  } catch (error) {
    result.warnings.push(`budget: ${stringifyError(error)}`);
    if (isLedgerSchemaMissing(error)) result.status = 'schema_missing';
  }

  try {
    const events = await upsertRows(
      'agent_run_tool_events',
      previewEventRows({ preview, actualRunId, circleId, userId: input.userId, source }),
      'run_id,event_key',
    );
    if (events.error) throw events.error;
    result.wrote.events = events.count;
  } catch (error) {
    result.warnings.push(`events: ${stringifyError(error)}`);
    if (isLedgerSchemaMissing(error)) result.status = 'schema_missing';
  }

  try {
    const failures = await upsertRows(
      'agent_run_failures',
      extractPreviewFailures(preview, actualRunId, circleId, input.userId),
      'run_id,failure_key',
    );
    if (failures.error) throw failures.error;
    result.wrote.failures = failures.count;
  } catch (error) {
    result.warnings.push(`failures: ${stringifyError(error)}`);
    if (isLedgerSchemaMissing(error)) result.status = 'schema_missing';
  }

  if (result.warnings.length > 0) {
    result.wrote.metadataFallback = await mergeLedgerFallback(actualRunId, {
      kind: 'ledger_preview',
      status: result.status,
      warnings: result.warnings,
      preview,
    });
  }

  result.ok = result.warnings.length === 0;
  result.status = result.ok ? 'persisted' : result.status === 'schema_missing' ? 'schema_missing' : 'partial';
  return result;
}

export async function persistAgentRunToolEvent(input: {
  runId: string;
  circleId: string;
  userId?: string | null;
  stepId?: string | null;
  scenarioId?: string | null;
  surface?: string | null;
  risk?: string | null;
  event: {
    tool: string;
    status: LegacyToolEventStatus;
    summary: string;
    command?: string;
    metadata?: Record<string, unknown>;
  };
}): Promise<AgentRunLedgerPersistResult> {
  const result = emptyResult('partial');
  const mapped = mapLegacyToolEventToLedgerStatus(input.event.status);
  const risk = normalizeRisk(input.risk);
  const scenarioId = input.scenarioId || 'runtime_tool_event';
  const surface = input.surface || 'unknown';
  const row = {
    run_id: input.runId,
    step_id: input.stepId || null,
    circle_id: input.circleId,
    user_id: input.userId || null,
    scenario_id: scenarioId,
    event_key: ['runtime', input.event.tool, input.event.status, input.stepId || 'no-step'].join(':').slice(0, 180),
    surface,
    actor: 'tool',
    event_type: mapped.eventType,
    tool_name: input.event.tool,
    risk,
    status: mapped.rowStatus,
    sanitized_input: sanitizeLedgerPayload({ command: input.event.command }),
    sanitized_output: sanitizeLedgerPayload({ summary: input.event.summary }),
    metadata: sanitizeLedgerPayload(input.event.metadata || {}),
  };

  try {
    const eventResult = await upsertRows('agent_run_tool_events', [row], 'run_id,event_key');
    if (eventResult.error) throw eventResult.error;
    result.wrote.events = eventResult.count;
  } catch (error) {
    result.warnings.push(`event: ${stringifyError(error)}`);
    if (isLedgerSchemaMissing(error)) result.status = 'schema_missing';
  }

  if (mapped.rowStatus === 'failed' || mapped.rowStatus === 'blocked') {
    const failure = classifyAgentFailure(`${input.event.tool}: ${input.event.summary}`);
    if (failure.failureClass !== 'unknown') {
      try {
        const failureResult = await upsertRows('agent_run_failures', [{
          run_id: input.runId,
          step_id: input.stepId || null,
          circle_id: input.circleId,
          user_id: input.userId || null,
          failure_class: failure.failureClass,
          failure_key: failureKey('runtime-tool', failure, surface, input.event.tool),
          severity: failure.severity,
          surface: failure.surface || surface,
          retryable: failure.retryable,
          user_action_required: failure.userActionRequired,
          recommended_recovery: failure.recommendedRecovery,
          raw_error: `${input.event.tool}: ${input.event.summary}`,
          signals: failure.signals,
          metadata: sanitizeLedgerPayload({ source: 'runtime_tool_event', tool: input.event.tool }),
        }], 'run_id,failure_key');
        if (failureResult.error) throw failureResult.error;
        result.wrote.failures = failureResult.count;
      } catch (error) {
        result.warnings.push(`failure: ${stringifyError(error)}`);
        if (isLedgerSchemaMissing(error)) result.status = 'schema_missing';
      }
    }
  }

  if (result.warnings.length > 0) {
    result.wrote.metadataFallback = await mergeLedgerFallback(input.runId, {
      kind: 'runtime_tool_event',
      status: result.status,
      warnings: result.warnings,
      row,
    });
  }

  result.ok = result.warnings.length === 0;
  result.status = result.ok ? 'persisted' : result.status === 'schema_missing' ? 'schema_missing' : 'partial';
  return result;
}

export async function persistRuntimeToolActions(input: {
  runId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  scenarioId?: string | null;
  surface?: string | null;
  risk?: string | null;
  actions: RuntimeToolActionForLedger[];
}): Promise<AgentRunLedgerPersistResult> {
  if (!input.runId || !input.circleId || input.actions.length === 0) return emptyResult('skipped');

  const result = emptyResult('partial');
  const runId = input.runId;
  const circleId = input.circleId;
  const risk = normalizeRisk(input.risk);
  const scenarioId = input.scenarioId || 'openswan_runtime';
  const surface = input.surface || 'unknown';
  const rows = input.actions.map((action, index) => {
    const status = action.status === 'completed'
      ? 'passed'
      : action.status === 'manual_required'
        ? 'manual_required'
        : action.status === 'blocked'
          ? 'blocked'
          : action.status === 'failed'
            ? 'failed'
            : 'running';
    const mapped = mapLegacyToolEventToLedgerStatus(status);
    const toolName = action.tool_name || action.title || 'unknown_tool';
    return {
      run_id: runId,
      circle_id: circleId,
      user_id: input.userId || null,
      scenario_id: scenarioId,
      event_key: ['openswan', index, toolName, mapped.eventType].join(':').slice(0, 180),
      surface,
      actor: 'openswan',
      event_type: mapped.eventType,
      tool_name: toolName,
      risk,
      status: mapped.rowStatus,
      sanitized_input: sanitizeLedgerPayload({ inputPreview: action.input_preview || null }),
      sanitized_output: sanitizeLedgerPayload({ outputPreview: action.output_preview || null }),
      artifact_refs: Array.isArray(action.artifact_refs)
        ? action.artifact_refs.map((ref) => String(ref || '').trim()).filter(Boolean).slice(0, 20)
        : [],
      metadata: sanitizeLedgerPayload(action.metadata || {}),
    };
  });

  try {
    const eventResult = await upsertRows('agent_run_tool_events', rows, 'run_id,event_key');
    if (eventResult.error) throw eventResult.error;
    result.wrote.events = eventResult.count;
  } catch (error) {
    result.warnings.push(`events: ${stringifyError(error)}`);
    if (isLedgerSchemaMissing(error)) result.status = 'schema_missing';
  }

  const failureRows = input.actions.flatMap((action, index) => {
    if (action.status !== 'failed' && action.status !== 'blocked') return [];
    const failure = classifyAgentFailure(`${action.tool_name || action.title || 'tool'}: ${action.output_preview || ''}`);
    if (failure.failureClass === 'unknown') return [];
    return [{
      run_id: runId,
      circle_id: circleId,
      user_id: input.userId || null,
      failure_class: failure.failureClass,
      failure_key: failureKey(`openswan:${index}`, failure, surface, action.tool_name || action.title),
      severity: failure.severity,
      surface: failure.surface || surface,
      retryable: failure.retryable,
      user_action_required: failure.userActionRequired,
      recommended_recovery: failure.recommendedRecovery,
      raw_error: `${action.tool_name || action.title || 'tool'}: ${action.output_preview || ''}`,
      signals: failure.signals,
      metadata: sanitizeLedgerPayload({ source: 'openswan_tool_action', actionMetadata: action.metadata || {} }),
    }];
  });

  try {
    const failureResult = await upsertRows('agent_run_failures', failureRows, 'run_id,failure_key');
    if (failureResult.error) throw failureResult.error;
    result.wrote.failures = failureResult.count;
  } catch (error) {
    result.warnings.push(`failures: ${stringifyError(error)}`);
    if (isLedgerSchemaMissing(error)) result.status = 'schema_missing';
  }

  if (result.warnings.length > 0) {
    result.wrote.metadataFallback = await mergeLedgerFallback(runId, {
      kind: 'openswan_tool_actions',
      status: result.status,
      warnings: result.warnings,
      actions: input.actions,
    });
  }

  result.ok = result.warnings.length === 0;
  result.status = result.ok ? 'persisted' : result.status === 'schema_missing' ? 'schema_missing' : 'partial';
  return result;
}
