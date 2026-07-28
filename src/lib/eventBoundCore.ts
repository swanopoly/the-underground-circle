// eventBoundCore — the PURE bounder that keeps agent_run_events payloads (the
// highest-frequency piece of agent telemetry) from ever exceeding a safe size,
// no matter what a tool handed us. `writeEvent` in agentRunPersistence.ts fires
// ONE INSERT per event, and some of those events (notably `tool_call_start`)
// carry `input: event.input` — arbitrary, caller-controlled tool input that can
// be huge, deeply nested, cyclic, or contain secret-shaped tokens. Inserting
// that raw would bloat rows, risk oversized-payload write failures, spin forever
// on a cycle, and could leak an API key / token / private key into a telemetry
// table that is read back into prompts and dashboards.
//
// `boundEventPayload()` deep-clones a payload under four INDEPENDENT ceilings —
// recursion depth, per-string length, array/object width, and TOTAL serialized
// size — and is cyclic-safe (an ancestor cycle becomes '[cyclic]', never an
// infinite loop or a JSON.stringify throw). Every string it keeps is first run
// through a conservative secret masker, so no secret-shaped token survives into
// a row. `boundToolCallsAggregate()` does the same for the `tool_calls` summary
// array rolled onto agent_runs at finalize-time: cap the array (~50) and bound
// each entry.
//
// PURITY: zero imports, tsx-loadable (smoke: event-bound-core). The secret
// masker is intentionally inlined (a compact, conservative subset of
// secretRedactionCore's shapes) so this module stays dependency-free.
// DETERMINISTIC: no Date.now()/Math.random(). Every export is TOTAL —
// null / undefined / wrong-type / huge / hostile / cyclic input yields a
// bounded, JSON-safe value and NEVER throws.

/** Hard ceiling on the serialized size of a single bounded event payload. */
export const EVENT_PAYLOAD_MAX_CHARS = 8_000;
/** Default recursion-depth ceiling; a node deeper than this becomes a marker. */
export const EVENT_MAX_DEPTH = 6;
/** Fixed durable/UI copy for a failed tool call. Raw provider text stays transient. */
export const PERSISTED_TOOL_FAILURE_TEXT = 'Tool call failed (details redacted).';

// --- Internal structural caps (tuning knobs, not part of the contract) --------
const MAX_STRING_CHARS = 2_000;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 100;
const KEY_MAX_CHARS = 200;

// Per-entry ceilings for the tool_calls aggregate (bounded independently so one
// hostile entry can't consume the whole array's budget).
const MAX_TOOL_CALLS = 50;
const TOOL_CALL_ENTRY_MAX_CHARS = 800;
const TOOL_CALL_STRING_CHARS = 500;
const TOOL_CALL_DEPTH = 4;
const TOOL_CALL_WIDTH = 32;

const MASK = '[REDACTED]';
const CYCLIC = '[cyclic]';
const DEPTH_MARK = '[max-depth]';
const TRUNC_MARK = '[truncated]';
const TOOL_INPUT_SUMMARY_VERSION = 2;
const TOOL_INPUT_MAX_FIELDS = 48;
const SENSITIVE_TOOL_INPUT_KEY_RE =
  /password|passwd|passcode|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|refresh[_-]?token|access[_-]?token|client[_-]?secret|otp|pin|cvv|card/i;
const SAFE_TOOL_RESULT_STATUSES = new Set([
  'planned',
  'running',
  'passed',
  'completed',
  'success',
  'verified',
  'manual_required',
  'blocked',
  'failed',
  'error',
  'skipped',
  'cancelled',
  'inconclusive',
  'outcome_unknown',
]);
type ToolResultReceiptFieldKind = 'string' | 'number' | 'boolean';
type ToolResultReceiptFieldSpec = readonly [
  field: string,
  kind: ToolResultReceiptFieldKind,
];

const TOOL_RESULT_RECEIPT_FIELD_ALLOWLIST: Readonly<
  Record<string, readonly ToolResultReceiptFieldSpec[]>
> = {
  computerActionReceipt: [
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
  ],
  mutationDispatchReceipt: [
    ['schemaVersion', 'number'],
    ['tool', 'string'],
    ['authorizedAt', 'string'],
    ['dispatchedAt', 'string'],
  ],
  computerAppVerificationReceipt: [
    ['schemaVersion', 'number'],
    ['status', 'string'],
    ['checkedAt', 'string'],
    ['canComplete', 'boolean'],
    ['evidenceCount', 'number'],
    ['blockerCount', 'number'],
  ],
  verificationReceipt: [
    ['verdict', 'string'],
    ['committed', 'boolean'],
    ['commitRef', 'string'],
    ['editedFileCount', 'number'],
    ['checkCount', 'number'],
    ['passedCheckCount', 'number'],
    ['failedCheckCount', 'number'],
  ],
};
const TOOL_RESULT_RECEIPT_SURFACES = new Set([
  'browser',
  'desktop',
  'vault',
  'terminal',
  'file',
  'code',
  'research',
  'approval',
  'system',
]);
const TOOL_RESULT_RECEIPT_OUTCOMES = new Set([
  'succeeded',
  'success',
  'passed',
  'completed',
  'verified',
  'failed',
  'error',
  'blocked',
  'cancelled',
  'inconclusive',
  'outcome_unknown',
]);
const TOOL_RESULT_RECEIPT_RISKS = new Set(['low', 'medium', 'high', 'critical']);
const TOOL_RESULT_RECEIPT_APPROVAL_STATES = new Set([
  'not_required',
  'pending',
  'approved',
  'auto_approved',
  'rejected',
]);
const TOOL_RESULT_RECEIPT_STATUSES = new Set([
  'pending',
  'running',
  'passed',
  'completed',
  'success',
  'verified',
  'failed',
  'error',
  'blocked',
  'skipped',
  'cancelled',
  'manual_required',
  'inconclusive',
  'outcome_unknown',
]);
const TOOL_RESULT_RECEIPT_VERDICTS = new Set(['verified', 'unverified', 'failed']);
const TOOL_RESULT_FINGERPRINT_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const TOOL_RESULT_COMMIT_RE = /^[0-9a-f]{7,64}$/;
const TOOL_RESULT_RECEIPT_TOOL_RE =
  /^[A-Za-z][A-Za-z0-9_-]{0,79}\.[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const TOOL_RESULT_EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,239}$/;

interface BoundCfg {
  maxDepth: number;
  maxStringChars: number;
  maxArrayItems: number;
  maxObjectKeys: number;
}

interface Budget {
  remaining: number;
}

// -----------------------------------------------------------------------------
// Secret masking (inlined, conservative). Mirrors the high-signal shapes from
// secretRedactionCore but carries no dependency so tsx purity is guaranteed.
// Each pattern runs inside its own try/catch: one pathological match can never
// crash the bounder — a failing detector is skipped, the rest still mask.
// -----------------------------------------------------------------------------
function maskSecrets(input: string): string {
  let s = input;
  // Credentials embedded in a URL — keep scheme+user+host, mask only the pass.
  try {
    s = s.replace(/(:\/\/[^\s:@/]+:)[^\s:@/]+(@)/g, (_m, prefix: string, at: string) => `${prefix}${MASK}${at}`);
  } catch {
    /* skip */
  }
  // Flat shapes (most-specific first) — the whole token becomes the mask.
  const flat: RegExp[] = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    /sk-ant-[A-Za-z0-9\-_]{20,}/g,
    /sk-[A-Za-z0-9]{20,}/g,
    /github_pat_[A-Za-z0-9_]{50,}/g,
    /ghp_[A-Za-z0-9]{36,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    /Bearer\s+[A-Za-z0-9._\-]{16,}/g,
    /api[_-]?key["'\s:=]+[A-Za-z0-9\-_]{16,}/gi,
    /(?:aws.{0,20})?secret[_-]?(?:access[_-]?)?key["'\s:=]+[A-Za-z0-9/+]{40}/gi,
  ];
  for (const re of flat) {
    try {
      s = s.replace(re, MASK);
    } catch {
      /* skip a pathological pattern, keep masking the rest */
    }
  }
  return s;
}

// -----------------------------------------------------------------------------
// Small total helpers.
// -----------------------------------------------------------------------------
function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function safeStringify(value: unknown): string {
  try {
    const s = JSON.stringify(value);
    return typeof s === 'string' ? s : '';
  } catch {
    // Our clones never contain a cycle or BigInt, so this should not fire — but
    // a hostile toJSON()/getter could still throw, and a bounder must not.
    return '';
  }
}

function safeToString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return '';
  }
}

function safeOwnKeys(value: object): string[] {
  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}

function safeKind(kind: unknown): string {
  if (typeof kind !== 'string' || kind.length === 0) return 'unknown';
  const clipped = kind.length > 80 ? kind.slice(0, 80) : kind;
  return maskSecrets(clipped);
}

function safeToolName(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  const clipped = value.slice(0, 180);
  return /^[A-Za-z][A-Za-z0-9_-]{0,79}(?:\.[A-Za-z0-9][A-Za-z0-9._:-]{0,99})?$/.test(clipped)
    ? clipped
    : 'unknown';
}

function safeToolResultStatus(value: unknown): string {
  if (typeof value !== 'string') return 'unknown';
  return SAFE_TOOL_RESULT_STATUSES.has(value) ? value : 'unknown';
}

function safeToolResultEventId(value: unknown): string | undefined {
  if (typeof value !== 'string' || !TOOL_RESULT_EVENT_ID_RE.test(value)) return undefined;
  return value;
}

function safeToolResultReceiptTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 48) return undefined;
  try {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function safeToolResultReceiptValue(
  field: string,
  kind: ToolResultReceiptFieldKind,
  value: unknown,
): unknown {
  if (kind === 'boolean') return typeof value === 'boolean' ? value : undefined;
  if (kind === 'number') {
    if (typeof value !== 'number') return undefined;
    if (!Number.isFinite(value)) return undefined;
    if (field === 'schemaVersion') return value === 1 ? 1 : undefined;
    if (!Number.isInteger(value) || value < 0) return undefined;
    if (field === 'durationMs') return value <= 86_400_000 ? value : undefined;
    return value <= 10_000 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  if (field === 'tool') {
    return TOOL_RESULT_RECEIPT_TOOL_RE.test(value) ? value : undefined;
  }
  if (field === 'toolArgsFingerprint' || field === 'argsFingerprint') {
    return TOOL_RESULT_FINGERPRINT_RE.test(value) ? value : undefined;
  }
  if (
    field === 'handlerEnteredAt'
    || field === 'handlerExitedAt'
    || field === 'authorizedAt'
    || field === 'dispatchedAt'
    || field === 'completedAt'
    || field === 'checkedAt'
  ) {
    return safeToolResultReceiptTimestamp(value);
  }
  if (field === 'surface') {
    return TOOL_RESULT_RECEIPT_SURFACES.has(value) ? value : undefined;
  }
  if (field === 'outcome') {
    return TOOL_RESULT_RECEIPT_OUTCOMES.has(value) ? value : undefined;
  }
  if (field === 'status') {
    return TOOL_RESULT_RECEIPT_STATUSES.has(value) ? value : undefined;
  }
  if (field === 'risk') {
    return TOOL_RESULT_RECEIPT_RISKS.has(value) ? value : undefined;
  }
  if (field === 'approvalState') {
    return TOOL_RESULT_RECEIPT_APPROVAL_STATES.has(value) ? value : undefined;
  }
  if (field === 'verdict') {
    return TOOL_RESULT_RECEIPT_VERDICTS.has(value) ? value : undefined;
  }
  if (field === 'commitRef') {
    return TOOL_RESULT_COMMIT_RE.test(value) ? value : undefined;
  }
  return undefined;
}

/**
 * Defense-in-depth projection for the hidden receipt side channel. The
 * primary persistence adapter already sanitizes these namespaces; this final
 * event boundary repeats the field allowlist so a future direct caller cannot
 * smuggle result text, paths, or provider payloads through `metadata`.
 */
function projectToolResultReceiptMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [namespace, fields] of Object.entries(TOOL_RESULT_RECEIPT_FIELD_ALLOWLIST)) {
    let rawReceipt: unknown;
    try {
      rawReceipt = source[namespace];
    } catch {
      continue;
    }
    if (!rawReceipt || typeof rawReceipt !== 'object' || Array.isArray(rawReceipt)) continue;
    const receiptSource = rawReceipt as Record<string, unknown>;
    const receipt: Record<string, unknown> = {};
    for (const [field, kind] of fields) {
      let raw: unknown;
      try {
        raw = receiptSource[field];
      } catch {
        continue;
      }
      const safe = safeToolResultReceiptValue(field, kind, raw);
      if (safe !== undefined) assignKey(receipt, field, safe);
    }
    const receiptFields = safeOwnKeys(receipt);
    if (
      receiptFields.length > 0
      && !(receiptFields.length === 1 && receiptFields[0] === 'schemaVersion')
    ) {
      assignKey(out, namespace, receipt);
    }
  }
  return safeOwnKeys(out).length > 0 ? out : undefined;
}

function toolInputValueKind(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind === 'object') return 'object';
  if (kind === 'string') return 'string';
  if (kind === 'number') return Number.isFinite(value as number) ? 'number' : 'non_finite_number';
  if (kind === 'boolean') return 'boolean';
  if (kind === 'bigint') return 'bigint';
  if (kind === 'undefined') return 'undefined';
  return 'unsupported';
}

/**
 * Build a value-free summary of tool arguments for durable telemetry and UI
 * previews. Exact arguments remain in memory for approval hashing, dispatch,
 * loop control, and proof extraction; no argument value is copied here.
 */
export function summarizeToolInputForPersistence(
  toolName: unknown,
  input: unknown,
): Record<string, unknown> {
  const tool = safeToolName(toolName);
  try {
    if (input === null || input === undefined) {
      return {
        schemaVersion: TOOL_INPUT_SUMMARY_VERSION,
        redacted: true,
        tool,
        inputKind: 'empty',
        fieldCount: 0,
        fieldKinds: [],
      };
    }
    if (Array.isArray(input)) {
      return {
        schemaVersion: TOOL_INPUT_SUMMARY_VERSION,
        redacted: true,
        tool,
        inputKind: 'array',
        itemCount: Math.min(input.length, 10_000),
        fieldKinds: [],
      };
    }
    if (typeof input !== 'object') {
      return {
        schemaVersion: TOOL_INPUT_SUMMARY_VERSION,
        redacted: true,
        tool,
        inputKind: toolInputValueKind(input),
        fieldCount: 0,
        fieldKinds: [],
      };
    }

    const keys = safeOwnKeys(input as object);
    const fieldKindCounts: Record<string, number> = {};
    for (const key of keys.slice(0, TOOL_INPUT_MAX_FIELDS)) {
      let value: unknown;
      try {
        value = (input as Record<string, unknown>)[key];
      } catch {
        value = undefined;
      }
      // Dynamic MCP/custom-tool maps may use data AS object keys (customer
      // identifiers, filenames, selectors, etc.). Persist only aggregate value
      // kinds, never the key names or their ordering.
      const kind = SENSITIVE_TOOL_INPUT_KEY_RE.test(key)
        ? 'redacted'
        : toolInputValueKind(value);
      fieldKindCounts[kind] = (fieldKindCounts[kind] || 0) + 1;
    }
    const summarizedFieldCount = Math.min(keys.length, TOOL_INPUT_MAX_FIELDS);
    return {
      schemaVersion: TOOL_INPUT_SUMMARY_VERSION,
      redacted: true,
      tool,
      inputKind: 'object',
      fieldCount: Math.min(keys.length, 10_000),
      fieldKinds: Object.keys(fieldKindCounts)
        .sort()
        .map((kind) => ({ kind, count: fieldKindCounts[kind] })),
      ...(keys.length > summarizedFieldCount
        ? { omittedFieldCount: keys.length - summarizedFieldCount }
        : {}),
    };
  } catch {
    return {
      schemaVersion: TOOL_INPUT_SUMMARY_VERSION,
      redacted: true,
      tool,
      inputKind: 'unavailable',
      fieldCount: 0,
      fieldKinds: [],
    };
  }
}

/**
 * Build the same value-free structural envelope for a tool result. Exact
 * observations remain transient so the live model can reason, verify, and
 * recover; durable transcripts, steps, action cards, and metadata retain only
 * result shape and controlled status.
 */
export function summarizeToolResultForPersistence(
  toolName: unknown,
  result: unknown,
  status: unknown,
): Record<string, unknown> {
  const structural = summarizeToolInputForPersistence(toolName, result);
  const {
    inputKind,
    ...rest
  } = structural;
  return {
    ...rest,
    status: safeToolResultStatus(status),
    resultKind: inputKind,
  };
}

/**
 * Strict-by-default durable projection for one tool result event.
 *
 * Only correlation/status scalars and the explicitly allowlisted receipt
 * metadata survive verbatim. Every other present property — including current
 * or future `result`, `output`, `data`, `content`, `body`, path-like, and
 * dynamically named fields — is reduced together into a key-free structural
 * summary. This keeps the generic boundary safe even if a future writer passes
 * the provider result object instead of selecting telemetry fields first.
 */
function prepareToolResultPayload(source: Record<string, unknown>): Record<string, unknown> {
  const prepared: Record<string, unknown> = {};
  const rawResultFields: Record<string, unknown> = {};
  let rawResultFieldCount = 0;
  let sawError = false;
  let ok: boolean | undefined;
  let toolName: unknown = 'unknown';
  let status: string = 'unknown';
  try {
    toolName = source.tool ?? source.toolName;
  } catch {
    toolName = 'unknown';
  }

  for (const key of safeOwnKeys(source)) {
    let value: unknown;
    try {
      value = source[key];
    } catch {
      continue;
    }
    if (key === 'tool' || key === 'toolName') {
      assignKey(prepared, key, safeToolName(value));
      continue;
    }
    if (key === 'tool_use_id' || key === 'toolUseId') {
      const id = safeToolResultEventId(value);
      if (id) assignKey(prepared, key, id);
      continue;
    }
    if (key === 'iteration') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        prepared.iteration = Math.max(1, Math.min(1_000_000, Math.floor(value)));
      }
      continue;
    }
    if (key === 'duration_ms' || key === 'durationMs') {
      if (typeof value === 'number' && Number.isFinite(value)) {
        assignKey(prepared, key, Math.max(0, Math.min(86_400_000, Math.floor(value))));
      }
      continue;
    }
    if (key === 'ok') {
      if (typeof value === 'boolean') {
        ok = value;
        prepared.ok = value;
      }
      continue;
    }
    if (
      key === 'dispatched'
      || key === 'client_delegated'
      || key === 'clientDelegated'
    ) {
      if (typeof value === 'boolean' || value === null) assignKey(prepared, key, value);
      continue;
    }
    if (key === 'status') {
      const safeStatus = safeToolResultStatus(value);
      if (safeStatus !== 'unknown') {
        status = safeStatus;
        prepared.status = safeStatus;
      }
      continue;
    }
    if (key === 'metadata') {
      const metadata = projectToolResultReceiptMetadata(value);
      if (metadata) prepared.metadata = metadata;
      continue;
    }
    if (key === 'error') {
      sawError = true;
      continue;
    }
    if (key === 'error_code' || key === 'redacted') {
      // Derived below from authoritative failure state; never trust caller copy.
      continue;
    }

    // Unknown/future result fields are intentionally not copied. Bundle their
    // values only long enough to derive a key-free structural summary.
    assignKey(rawResultFields, key, value);
    rawResultFieldCount += 1;
  }

  if (status === 'unknown') {
    status = ok === true ? 'success' : ok === false || sawError ? 'failed' : 'unknown';
  }
  if (rawResultFieldCount > 0) {
    prepared.result_summary = summarizeToolResultForPersistence(
      toolName,
      rawResultFields,
      status,
    );
  }
  if (sawError || ok === false) {
    prepared.error = PERSISTED_TOOL_FAILURE_TEXT;
    prepared.error_code = 'tool_call_failed';
    prepared.redacted = true;
  }
  return prepared;
}

function preparePayloadForBounding(kind: unknown, payload: unknown): unknown {
  const eventKind = safeKind(kind);
  if (
    (eventKind !== 'tool_call_start' && eventKind !== 'tool_call_result')
    || !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
  ) {
    return payload;
  }
  const source = payload as Record<string, unknown>;
  if (eventKind === 'tool_call_result') {
    return prepareToolResultPayload(source);
  }
  const prepared: Record<string, unknown> = {};
  for (const key of safeOwnKeys(source)) {
    let value: unknown;
    try {
      value = source[key];
    } catch {
      continue;
    }
    if (eventKind === 'tool_call_start' && key === 'input') {
      let toolName: unknown;
      try {
        toolName = source.tool ?? source.toolName;
      } catch {
        toolName = 'unknown';
      }
      prepared.input = summarizeToolInputForPersistence(toolName, value);
    } else {
      assignKey(prepared, key, value);
    }
  }
  return prepared;
}

/** Clip a string to `maxStringChars`, mask secrets, then honor the budget. */
function boundString(value: string, maxStringChars: number, budget: Budget): string {
  // Clip the HEAD first so we never run the secret regexes over a multi-MB
  // hostile string; only then mask secrets within the bounded head.
  const overLong = value.length > maxStringChars;
  let out = maskSecrets(overLong ? value.slice(0, maxStringChars) : value);
  if (overLong) out += `…[+${value.length - maxStringChars} chars]`;
  // Per-string budget clip (already secret-masked, so slicing cannot leak).
  if (out.length + 2 > budget.remaining) {
    out = out.slice(0, Math.max(0, budget.remaining - 2));
    budget.remaining = 0;
  } else {
    budget.remaining -= out.length + 2;
  }
  return out;
}

function boundKey(key: string): string {
  const clipped = key.length > KEY_MAX_CHARS ? `${key.slice(0, KEY_MAX_CHARS)}…` : key;
  return maskSecrets(clipped);
}

/** Assign a key without ever tripping the `__proto__` setter (pollution-safe). */
function assignKey(target: Record<string, unknown>, key: string, val: unknown): void {
  try {
    if (key === '__proto__') {
      Object.defineProperty(target, '__proto__', {
        value: val,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      target[key] = val;
    }
  } catch {
    /* skip a key we cannot assign */
  }
}

// -----------------------------------------------------------------------------
// Recursive bounder. `undefined` is the internal "drop this" sentinel (functions,
// symbols, and undefined all bound to it); callers map it to null / skip a key,
// matching JSON.stringify semantics.
// -----------------------------------------------------------------------------
function boundValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): unknown {
  if (budget.remaining <= 0) return TRUNC_MARK;

  if (value === null) {
    budget.remaining -= 4;
    return null;
  }

  const t = typeof value;
  if (t === 'string') return boundString(value as string, cfg.maxStringChars, budget);
  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      // NaN / ±Infinity are not valid JSON; JSON.stringify already emits null.
      budget.remaining -= 4;
      return null;
    }
    budget.remaining -= String(n).length;
    return n;
  }
  if (t === 'boolean') {
    budget.remaining -= 5;
    return value;
  }
  if (t === 'bigint') {
    // BigInt is unserializable by JSON.stringify — preserve it as a string.
    const str = safeToString(value);
    budget.remaining -= str.length + 2;
    return str;
  }
  if (t !== 'object') return undefined; // function / symbol / undefined → drop

  const obj = value as object;
  if (ancestors.has(obj)) {
    budget.remaining -= CYCLIC.length;
    return CYCLIC;
  }
  if (depth >= cfg.maxDepth) {
    budget.remaining -= DEPTH_MARK.length;
    return DEPTH_MARK;
  }

  // Leaf-ish objects that must not recurse (no cycle risk → outside ancestors).
  if (obj instanceof Date) {
    let iso = '[invalid-date]';
    try {
      iso = Number.isNaN(obj.getTime()) ? '[invalid-date]' : obj.toISOString();
    } catch {
      iso = '[invalid-date]';
    }
    budget.remaining -= iso.length + 2;
    return iso;
  }
  if (obj instanceof RegExp) {
    return boundString(safeToString(obj), cfg.maxStringChars, budget);
  }

  ancestors.add(obj);
  try {
    if (Array.isArray(obj)) return boundArray(obj, depth, ancestors, budget, cfg);
    if (obj instanceof Map) return boundMapLike(obj, depth, ancestors, budget, cfg);
    if (obj instanceof Set) return boundSetLike(obj, depth, ancestors, budget, cfg);
    if (obj instanceof Error) return boundError(obj, depth, ancestors, budget, cfg);
    return boundObject(obj as Record<string, unknown>, depth, ancestors, budget, cfg);
  } finally {
    // Ancestor-path semantics: remove on exit so a shared (non-cyclic) sibling
    // reference is NOT mis-flagged as a cycle.
    ancestors.delete(obj);
  }
}

function boundArray(
  arr: unknown[],
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): unknown[] {
  const out: unknown[] = [];
  const cap = Math.min(arr.length, cfg.maxArrayItems);
  for (let i = 0; i < cap; i++) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1; // comma
    const child = boundValue(arr[i], depth + 1, ancestors, budget, cfg);
    out.push(child === undefined ? null : child);
  }
  const omitted = arr.length - out.length;
  if (omitted > 0) out.push(`[+${omitted} more]`);
  budget.remaining -= 2; // brackets
  return out;
}

function boundObject(
  src: Record<string, unknown>,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = safeOwnKeys(src);
  const cap = Math.min(keys.length, cfg.maxObjectKeys);
  let processed = 0;
  for (let i = 0; i < cap; i++) {
    if (budget.remaining <= 0) break;
    const rawKey = keys[i];
    const safeKey = boundKey(rawKey);
    budget.remaining -= safeKey.length + 3;
    processed = i + 1;
    let childVal: unknown;
    try {
      childVal = src[rawKey];
    } catch {
      // A getter that throws — drop the key, keep going.
      continue;
    }
    const child = boundValue(childVal, depth + 1, ancestors, budget, cfg);
    if (child === undefined) continue; // drop undefined/function/symbol-valued keys
    assignKey(out, safeKey, child);
  }
  const omitted = keys.length - processed;
  if (omitted > 0) out.__omittedKeys = omitted;
  budget.remaining -= 2;
  return out;
}

function boundMapLike(
  map: Map<unknown, unknown>,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): Record<string, unknown> {
  const entries: unknown[] = [];
  let size = 0;
  try {
    size = map.size;
  } catch {
    size = 0;
  }
  let count = 0;
  try {
    for (const pair of map) {
      if (count >= cfg.maxArrayItems || budget.remaining <= 0) break;
      const k = boundValue(pair[0], depth + 1, ancestors, budget, cfg);
      const v = boundValue(pair[1], depth + 1, ancestors, budget, cfg);
      entries.push([k === undefined ? null : k, v === undefined ? null : v]);
      count += 1;
    }
  } catch {
    /* stop iterating on any hostile iterator */
  }
  const out: Record<string, unknown> = { __type: 'Map', size, entries };
  if (size > count) out.__omittedEntries = size - count;
  budget.remaining -= 2;
  return out;
}

function boundSetLike(
  set: Set<unknown>,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): Record<string, unknown> {
  const values: unknown[] = [];
  let size = 0;
  try {
    size = set.size;
  } catch {
    size = 0;
  }
  let count = 0;
  try {
    for (const item of set) {
      if (count >= cfg.maxArrayItems || budget.remaining <= 0) break;
      const v = boundValue(item, depth + 1, ancestors, budget, cfg);
      values.push(v === undefined ? null : v);
      count += 1;
    }
  } catch {
    /* stop iterating on any hostile iterator */
  }
  const out: Record<string, unknown> = { __type: 'Set', size, values };
  if (size > count) out.__omittedValues = size - count;
  budget.remaining -= 2;
  return out;
}

function boundError(
  err: Error,
  depth: number,
  ancestors: WeakSet<object>,
  budget: Budget,
  cfg: BoundCfg,
): Record<string, unknown> {
  const out: Record<string, unknown> = { __type: 'Error' };
  try {
    if (typeof err.name === 'string') out.name = boundString(err.name, cfg.maxStringChars, budget);
  } catch {
    /* skip */
  }
  try {
    if (typeof err.message === 'string') out.message = boundString(err.message, cfg.maxStringChars, budget);
  } catch {
    /* skip */
  }
  // Own enumerable extras, but NOT `stack` — it leaks absolute file paths and is
  // mostly noise for telemetry.
  const bag = err as unknown as Record<string, unknown>;
  for (const key of safeOwnKeys(bag)) {
    if (budget.remaining <= 0) break;
    if (key === 'name' || key === 'message' || key === 'stack') continue;
    const safeKey = boundKey(key);
    budget.remaining -= safeKey.length + 3;
    let childVal: unknown;
    try {
      childVal = bag[key];
    } catch {
      continue;
    }
    const child = boundValue(childVal, depth + 1, ancestors, budget, cfg);
    if (child === undefined) continue;
    assignKey(out, safeKey, child);
  }
  budget.remaining -= 2;
  return out;
}

/**
 * When the per-node budget under-counts JSON escaping and the real serialized
 * form still overshoots, collapse to a marked preview that provably fits.
 * `serialized` was produced from an already secret-masked clone, so slicing it
 * cannot leak. Preview is shrunk (halved) until the whole wrapper serializes at
 * or under `maxChars`, worst-case landing on an empty preview.
 */
function clipWrapper(kind: unknown, serialized: string, maxChars: number): Record<string, unknown> {
  let previewCap = Math.max(0, maxChars - 160);
  let wrapper: Record<string, unknown> = {
    __eventPayloadClipped: true,
    kind: safeKind(kind),
    chars: serialized.length,
    preview: serialized.slice(0, previewCap),
  };
  for (let guard = 0; guard < 24; guard++) {
    if (safeStringify(wrapper).length <= maxChars || previewCap === 0) break;
    previewCap = Math.floor(previewCap / 2);
    wrapper = {
      __eventPayloadClipped: true,
      kind: safeKind(kind),
      chars: serialized.length,
      preview: serialized.slice(0, previewCap),
    };
  }
  return wrapper;
}

// -----------------------------------------------------------------------------
// Public API.
// -----------------------------------------------------------------------------

/**
 * Bound an arbitrary event payload for a single agent_run_events INSERT.
 * Deep-clones under depth / string / width / total-size ceilings, is cyclic-safe
 * ('[cyclic]'), and secret-masks every kept string. `kind` is accepted for
 * context (and surfaced when a payload has to be clipped) but never widens the
 * bound. Returns a JSON-safe value; NEVER throws.
 */
export function boundEventPayload(
  kind: unknown,
  payload: unknown,
  opts?: { maxChars?: number; maxDepth?: number },
): unknown {
  try {
    const maxChars = clampInt(opts?.maxChars, 256, 64_000, EVENT_PAYLOAD_MAX_CHARS);
    const maxDepth = clampInt(opts?.maxDepth, 1, 24, EVENT_MAX_DEPTH);
    const cfg: BoundCfg = {
      maxDepth,
      maxStringChars: MAX_STRING_CHARS,
      maxArrayItems: MAX_ARRAY_ITEMS,
      maxObjectKeys: MAX_OBJECT_KEYS,
    };
    const budget: Budget = { remaining: maxChars };
    const preparedPayload = preparePayloadForBounding(kind, payload);
    const cloned = boundValue(preparedPayload, 0, new WeakSet<object>(), budget, cfg);
    const result = cloned === undefined ? null : cloned;

    // Authoritative total-size guard: the per-node budget is approximate (it
    // does not model JSON escaping), so verify the real serialized size and, if
    // still over, collapse to a marked preview that provably fits.
    const serialized = safeStringify(result);
    if (serialized.length > maxChars) {
      return clipWrapper(kind, serialized, maxChars);
    }
    return result;
  } catch {
    // Absolute backstop — a bounder must never break a telemetry write.
    return { __eventPayloadError: true, kind: safeKind(kind) };
  }
}

/**
 * Bound the `tool_calls` aggregate array rolled onto agent_runs at finalize.
 * Caps the array to ~50 entries (+ a truncation marker) and bounds each entry
 * independently. Non-array input yields an empty array. NEVER throws.
 */
export function boundToolCallsAggregate(toolCalls: unknown, opts?: { maxItems?: number }): unknown {
  try {
    if (!Array.isArray(toolCalls)) return [];
    const maxItems = clampInt(opts?.maxItems, 1, 500, MAX_TOOL_CALLS);
    const cap = Math.min(toolCalls.length, maxItems);
    const cfg: BoundCfg = {
      maxDepth: TOOL_CALL_DEPTH,
      maxStringChars: TOOL_CALL_STRING_CHARS,
      maxArrayItems: TOOL_CALL_WIDTH,
      maxObjectKeys: TOOL_CALL_WIDTH,
    };
    const out: unknown[] = [];
    for (let i = 0; i < cap; i++) {
      const budget: Budget = { remaining: TOOL_CALL_ENTRY_MAX_CHARS };
      const entry = boundValue(toolCalls[i], 0, new WeakSet<object>(), budget, cfg);
      out.push(entry === undefined ? null : entry);
    }
    const omitted = toolCalls.length - cap;
    if (omitted > 0) {
      out.push({ __truncated: true, omitted, total: toolCalls.length });
    }
    return out;
  } catch {
    return [];
  }
}
