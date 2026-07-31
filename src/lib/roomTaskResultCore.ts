/**
 * roomTaskResultCore — pure, dependency-free honesty layer for Room task
 * execution results (RoomsTab TasksPanel ⇄ room-task-executor edge).
 *
 * Why this exists (verified against source 2026-07-31):
 *
 * 1. RESULT PREVIEW: the edge writes `last_result` as
 *    `{ responseLength, taskType, completedAt }` on success
 *    (room-task-executor/index.ts ~:442) and `{ error }` on failure (~:472).
 *    RoomsTab previously fell through to `JSON.stringify(...).slice(0,120)`,
 *    showing raw JSON garbage while the real answer went to room_messages.
 *    `describeRoomTaskResult` turns every known shape into a human line and
 *    collapses unknown shapes to a safe "Completed" — JSON never reaches the
 *    user.
 *
 * 2. INVOKE ERRORS: `supabase.functions.invoke` does NOT throw on non-2xx.
 *    It resolves `{ data: null, error }` where `error` is a
 *    FunctionsHttpError carrying the fetch Response on `error.context`
 *    (numeric `error.context.status`; JSON body via
 *    `error.context.clone().json()`) — see `swanbotV2Retry.ts
 *    isRetryableInvokeError` and `swanbot.ts readSwanBotInvokeErrorBody`.
 *    Network failures surface as FunctionsFetchError / FunctionsRelayError.
 *    The edge's real failure bodies are:
 *      429 → { error: 'circle_claude_budget_exceeded', detail, spent24h, cap }
 *      400 → { error: <byok message>, code: 'key_missing' }
 *      401 → { error: 'Valid JWT required.', code: 'unauthenticated' }
 *      403 → { error: ..., code: 'forbidden' | 'task_mismatch' }
 *      404 → { error: 'Room not found.', code: 'room_not_found' }
 *      500 → { error: err.message }
 *    `describeRoomTaskInvokeError` maps all of these to honest user copy.
 *
 * 3. TASK TYPES: run_script / db_query / api_call do NOT execute — the edge
 *    posts advisory text with `execution_disabled: true` (index.ts ~:231,
 *    ~:277, ~:314). `describeRoomTaskType` labels them honestly.
 *
 * 4. SCHEDULES: schedule presets are stored but nothing ever runs them
 *    (`room_tasks.next_run_at` is written by nothing). `describeRoomTaskSchedule`
 *    says so instead of implying a cron exists.
 *
 * Every function is TOTAL: null/garbage input returns a safe value, never
 * throws. All surfaced strings are bounded and secret-redacted.
 */

export type RoomTaskResultTone = 'ok' | 'warn' | 'muted';

export interface RoomTaskResultSummary {
  headline: string;
  detail?: string;
  tone: RoomTaskResultTone;
  /** True when the real payload lives in room chat and a jump link helps. */
  jumpToChat: boolean;
}

export interface RoomTaskInvokeErrorSummary {
  headline: string;
  detail: string;
  tone: 'danger';
}

export interface RoomTaskTypeSummary {
  label: string;
  /** False for advisory-only types the edge never executes. */
  executes: boolean;
  advisoryNote?: string;
}

export interface RoomTaskScheduleSummary {
  label: string;
  /** Always false today — nothing in the system runs stored schedules. */
  scheduled: boolean;
  warning?: string;
}

// ─── bounded/secret-safe string helpers ──────────────────────────────────────

const HEADLINE_MAX = 120;
const DETAIL_MAX = 220;

/**
 * Redact anything that looks like a credential before it can reach the UI:
 * provider API keys (sk-…, sk-ant-…), bearer tokens, JWTs, and long opaque
 * token-ish runs. Conservative — favors over-redaction of blobs.
 */
function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9+/_-]{48,}={0,2}\b/g, '[redacted]');
}

function bound(text: string, max: number): string {
  const clean = redactSecrets(text.replace(/\s+/g, ' ').trim());
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatCharCount(n: number): string {
  const whole = Math.max(0, Math.floor(n));
  // Manual thousands separator — locale-independent, deterministic in tests.
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─── (a) result summary ──────────────────────────────────────────────────────

const RESULT_VERB_BY_TYPE: Record<string, string> = {
  general: 'Answered',
  web_research: 'Research posted',
  file_ops: 'Files analyzed',
  run_script: 'Script drafted (not executed)',
  db_query: 'Query reviewed (not executed)',
  api_call: 'API call reviewed (not executed)',
};

export function describeRoomTaskResult(input: {
  taskType?: unknown;
  lastResult?: unknown;
  status?: unknown;
}): RoomTaskResultSummary {
  const status = safeString(input?.status)?.toLowerCase() ?? null;
  const raw = input?.lastResult;

  // No result yet — status carries the story.
  if (raw === null || raw === undefined) {
    if (status === 'running') {
      return { headline: 'Running…', tone: 'muted', jumpToChat: false };
    }
    if (status === 'error') {
      return { headline: 'Failed — no result recorded', tone: 'warn', jumpToChat: false };
    }
    return { headline: 'Not run yet', tone: 'muted', jumpToChat: false };
  }

  // last_result may arrive as an object (jsonb) or occasionally a string.
  if (typeof raw === 'string') {
    const text = safeString(raw);
    return text
      ? { headline: bound(text, HEADLINE_MAX), tone: 'ok', jumpToChat: true }
      : { headline: 'Completed', tone: 'ok', jumpToChat: true };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    // Numbers, booleans, arrays, garbage — never stringify at the user.
    return { headline: 'Completed', tone: 'ok', jumpToChat: true };
  }

  const result = raw as Record<string, unknown>;

  // Failure shape written by the edge catch block: { error: message }.
  const errorText = safeString(result.error);
  if (errorText) {
    return {
      headline: 'Failed',
      detail: bound(errorText, DETAIL_MAX),
      tone: 'warn',
      jumpToChat: false,
    };
  }

  // The real success shape: { responseLength, taskType, completedAt }.
  const responseLength =
    typeof result.responseLength === 'number' && Number.isFinite(result.responseLength)
      ? result.responseLength
      : null;
  if (responseLength !== null) {
    const type =
      safeString(result.taskType) ?? safeString(input?.taskType) ?? 'general';
    const verb = RESULT_VERB_BY_TYPE[type] ?? 'Answered';
    return {
      headline: bound(
        `${verb} · ${formatCharCount(responseLength)} chars · posted to room chat`,
        HEADLINE_MAX,
      ),
      tone: 'ok',
      jumpToChat: true,
    };
  }

  // Legacy shape: { preview: '...' } — the old inline answer snippet.
  const preview = safeString(result.preview);
  if (preview) {
    return { headline: bound(preview, HEADLINE_MAX), tone: 'ok', jumpToChat: true };
  }

  // Unknown shape — never leak JSON. "Completed" is the honest floor.
  return {
    headline: 'Completed',
    tone: status === 'done' ? 'ok' : 'muted',
    jumpToChat: true,
  };
}

// ─── (b) invoke-error summary ────────────────────────────────────────────────

const GENERIC_ERROR: RoomTaskInvokeErrorSummary = {
  headline: 'Task run failed',
  detail: 'The task executor returned an error. Try again, or check room chat for details.',
  tone: 'danger',
};

function extractStatus(error: Record<string, unknown>, body: Record<string, unknown> | null): number | null {
  // FunctionsHttpError puts the Response on `.context` (numeric `.status`).
  const ctx = error.context as { status?: unknown } | undefined;
  if (ctx && typeof ctx.status === 'number') return ctx.status;
  if (typeof error.status === 'number') return error.status;
  if (body && typeof body.status === 'number') return body.status;
  return null;
}

/**
 * Map a `supabase.functions.invoke` failure to honest copy.
 *
 * `error` is the object from the `{ data, error }` return (invoke does not
 * throw on non-2xx) or a caught exception. `body` is the optional parsed JSON
 * of `error.context` (obtain via `error.context?.clone?.().json?.()` —
 * best-effort, pass undefined on any parse failure).
 */
export function describeRoomTaskInvokeError(
  error: unknown,
  body?: unknown,
): RoomTaskInvokeErrorSummary {
  const parsedBody =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;

  if (!error || (typeof error !== 'object' && typeof error !== 'string')) {
    return { ...GENERIC_ERROR };
  }

  const e = (typeof error === 'string' ? { message: error } : error) as Record<string, unknown>;
  const name = safeString(e.name) ?? '';
  const message = safeString(e.message) ?? '';
  const status = extractStatus(e, parsedBody);
  const code = parsedBody ? safeString(parsedBody.code) : null;
  const bodyError = parsedBody ? safeString(parsedBody.error) : null;

  // Network / relay failures — the request never reached the edge cleanly.
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') {
    return {
      headline: 'Could not reach the task executor',
      detail: 'Network error — check your connection and try again.',
      tone: 'danger',
    };
  }

  // 429 — circle Claude budget cap (body: circle_claude_budget_exceeded).
  if (status === 429 || bodyError === 'circle_claude_budget_exceeded' || code === 'circle_claude_budget_exceeded') {
    const spent = parsedBody && typeof parsedBody.spent24h === 'number' ? parsedBody.spent24h : null;
    const cap = parsedBody && typeof parsedBody.cap === 'number' ? parsedBody.cap : null;
    const detail =
      spent !== null && cap !== null
        ? `$${spent.toFixed(2)} of $${cap.toFixed(2)} spent in the last 24h. Raise the cap in circle settings → AI SPEND, or wait for the window to roll.`
        : 'Raise the cap in circle settings → AI SPEND, or wait for the 24h window to roll.';
    return { headline: 'Daily AI budget reached', detail, tone: 'danger' };
  }

  // 400 key_missing — no Anthropic key resolvable for this user.
  if (code === 'key_missing') {
    return {
      headline: 'Anthropic key missing — add it in Marketplace',
      detail: bodyError
        ? bound(bodyError, DETAIL_MAX)
        : 'Add your Anthropic API key in Marketplace (or Office → Customize → API Keys), then run the task again.',
      tone: 'danger',
    };
  }

  // Auth family.
  if (status === 401 || code === 'unauthenticated') {
    return {
      headline: 'Session expired — sign in again',
      detail: 'Your session is no longer authorized to run room tasks. Sign in again and retry.',
      tone: 'danger',
    };
  }
  if (status === 403 || code === 'forbidden' || code === 'task_mismatch') {
    return {
      headline: 'Not authorized for this room',
      detail: bodyError
        ? bound(bodyError, DETAIL_MAX)
        : 'You are not a member of this room’s circle, or the task belongs to another room.',
      tone: 'danger',
    };
  }
  if (status === 404 || code === 'room_not_found') {
    return {
      headline: 'Room not found',
      detail: 'This room no longer exists on the server. Refresh and try again.',
      tone: 'danger',
    };
  }

  // Other 4xx (e.g. missing required fields) — surface the bounded body.
  if (status !== null && status >= 400 && status < 500) {
    return {
      headline: 'Task request rejected',
      detail: bound(bodyError ?? message ?? 'The task executor rejected the request.', DETAIL_MAX) ||
        'The task executor rejected the request.',
      tone: 'danger',
    };
  }

  // 5xx — the edge itself failed.
  if (status !== null && status >= 500) {
    return {
      headline: 'Task executor error',
      detail: bodyError ?? message
        ? bound(bodyError ?? message, DETAIL_MAX)
        : 'The task executor hit an internal error. Try again in a moment.',
      tone: 'danger',
    };
  }

  // Plain Error / unknown shape — bounded, secret-safe message if present.
  if (message) {
    return { headline: 'Task run failed', detail: bound(message, DETAIL_MAX), tone: 'danger' };
  }
  return { ...GENERIC_ERROR };
}

// ─── (c) task type honesty ───────────────────────────────────────────────────

const ADVISORY_NOTE = 'Advisory — the agent explains, it does not execute';

const TASK_TYPE_SUMMARIES: Record<string, RoomTaskTypeSummary> = {
  general: { label: 'General', executes: true },
  web_research: { label: 'Web Research', executes: true },
  file_ops: { label: 'File Ops', executes: true },
  run_script: { label: 'Run Script', executes: false, advisoryNote: ADVISORY_NOTE },
  db_query: { label: 'DB Query', executes: false, advisoryNote: ADVISORY_NOTE },
  api_call: { label: 'API Call', executes: false, advisoryNote: ADVISORY_NOTE },
};

export function describeRoomTaskType(taskType: unknown): RoomTaskTypeSummary {
  const key = safeString(taskType)?.toLowerCase();
  if (key && TASK_TYPE_SUMMARIES[key]) {
    // Copy so callers can't mutate the table.
    return { ...TASK_TYPE_SUMMARIES[key] };
  }
  // Unknown types fall through to the edge's `default:` → handleGeneral.
  return { label: key ? bound(key, 40) : 'General', executes: true };
}

// ─── (d) schedule honesty ────────────────────────────────────────────────────

const SCHEDULE_PRESET_LABELS: Record<string, string> = {
  '0 9 * * *': 'Daily 9am',
  '0 * * * *': 'Hourly',
  '0 9 * * 1': 'Mon 9am',
  once: 'Once',
};

const SCHEDULE_WARNING = 'Manual run only — scheduling not yet wired';

export function describeRoomTaskSchedule(schedulePreset: unknown): RoomTaskScheduleSummary {
  const raw = safeString(schedulePreset);
  if (!raw || raw.toLowerCase() === 'once') {
    // "Once" (and empty) never promised automation — honest as-is.
    return { label: 'Once', scheduled: false };
  }
  const presetLabel = SCHEDULE_PRESET_LABELS[raw] ?? bound(raw, 40);
  return {
    label: `${presetLabel} — manual run only`,
    scheduled: false,
    warning: SCHEDULE_WARNING,
  };
}
