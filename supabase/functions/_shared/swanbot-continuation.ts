// Oversized client tool-result content is now SUMMARIZED — head + tail kept
// verbatim (line-boundary-snapped) with error-signal lines surfaced from the
// omitted middle — via summarizeToolResultForModel, a Deno LOCKSTEP mirror of
// the client core src/lib/toolResultSummaryCore.ts. This replaced the previous
// DUMB hard truncation (slice to SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS +
// a "[client tool result truncated from N chars]" suffix) so the v2 edge loop
// and the client show the model the exact same thing. Summarization is a no-op
// below TOOL_RESULT_SUMMARY_THRESHOLD_CHARS (20k) and a head+tail+signal summary
// above it.
import { summarizeToolResultForModel } from "./tool-result-summary.ts";

export type SwanBotResumeToolResult = {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  /**
   * Hidden, durable-only receipt projection supplied by newer clients.
   * This field is never copied into the Anthropic tool_result block. The edge
   * re-sanitizes it before any event/run write; old clients simply omit it.
   */
  receipt_metadata?: SwanBotClientToolReceiptMetadata;
};

export const SWANBOT_MAX_CLIENT_TOOL_RESULTS = 40;
/** Exact two-phase dispatch/results protocol. Version 2 intentionally rejects
 * legacy snapshots that allowed local execution before the edge owned a
 * dispatch claim. */
export const SWANBOT_CONTINUATION_PROTOCOL_VERSION = 2;
// Retained for backward-compat imports. NO LONGER the truncation mechanism:
// summarization (summarizeToolResultForModel above) replaced the hard cap, and
// it keys off TOOL_RESULT_SUMMARY_THRESHOLD_CHARS (20k), not this value.
export const SWANBOT_MAX_CLIENT_TOOL_RESULT_CONTENT_CHARS = 16_000;
export const SWANBOT_CLIENT_RECEIPT_STRING_MAX_CHARS = 240;
export const SWANBOT_MAX_DURABLE_TOOL_CALLS = 50;

export type SwanBotContinuationResumeState =
  | "pending"
  | "dispatch_claimed"
  | "results_claimed";

export type SwanBotContinuationDispatchClaim = {
  continuationIdentity: string;
  continuationVersion: number;
  continuationNonce: string;
  dispatchClaimId: string;
};

export type SwanBotContinuationDispatchSnapshot = {
  continuationIdentity?: unknown;
  continuationVersion?: unknown;
  continuationNonce?: unknown;
  resumeState?: unknown;
  dispatchClaimId?: unknown;
};

export type SwanBotContinuationDispatchDecision =
  | { ok: true; kind: "claim" | "acknowledge" }
  | { ok: false; error: string };

const CONTINUATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactContinuationUuid(value: unknown): string | null {
  return typeof value === "string"
    && value.length === 36
    && CONTINUATION_UUID_RE.test(value)
    ? value.toLowerCase()
    : null;
}

/**
 * Parse the exact bounded token that both dispatch-claim and result-submit
 * requests must present. No coercion, truncation, legacy aliases, or missing
 * fields are accepted.
 */
export function parseSwanBotContinuationDispatchClaim(
  value: unknown,
): { ok: true; claim: SwanBotContinuationDispatchClaim } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "continuation dispatch claim must be an object" };
  }
  const row = value as Record<string, unknown>;
  const continuationIdentity = exactContinuationUuid(row.continuationIdentity);
  const continuationNonce = exactContinuationUuid(row.continuationNonce);
  const dispatchClaimId = exactContinuationUuid(row.dispatchClaimId);
  if (!continuationIdentity) {
    return { ok: false, error: "continuationIdentity must be an exact UUID" };
  }
  if (row.continuationVersion !== SWANBOT_CONTINUATION_PROTOCOL_VERSION) {
    return { ok: false, error: "continuationVersion is unsupported" };
  }
  if (!continuationNonce) {
    return { ok: false, error: "continuationNonce must be an exact UUID" };
  }
  if (!dispatchClaimId) {
    return { ok: false, error: "dispatchClaimId must be an exact UUID" };
  }
  return {
    ok: true,
    claim: {
      continuationIdentity,
      continuationVersion: SWANBOT_CONTINUATION_PROTOCOL_VERSION,
      continuationNonce,
      dispatchClaimId,
    },
  };
}

/**
 * Pure first-phase decision. A pending snapshot may transition once; an exact
 * retry of the winning claim is acknowledged idempotently; every competing or
 * mixed-version/state claim fails closed.
 */
export function decideSwanBotContinuationDispatchClaim(
  snapshot: SwanBotContinuationDispatchSnapshot,
  claim: SwanBotContinuationDispatchClaim,
): SwanBotContinuationDispatchDecision {
  const snapshotIdentity = exactContinuationUuid(snapshot.continuationIdentity);
  const snapshotNonce = exactContinuationUuid(snapshot.continuationNonce);
  if (
    !snapshotIdentity
    || snapshot.continuationVersion !== SWANBOT_CONTINUATION_PROTOCOL_VERSION
    || !snapshotNonce
    || snapshotIdentity !== claim.continuationIdentity
    || snapshotNonce !== claim.continuationNonce
    || claim.continuationVersion !== SWANBOT_CONTINUATION_PROTOCOL_VERSION
  ) {
    return { ok: false, error: "dispatch claim does not match the exact continuation" };
  }
  if (snapshot.resumeState === "pending") {
    return { ok: true, kind: "claim" };
  }
  if (
    snapshot.resumeState === "dispatch_claimed"
    && exactContinuationUuid(snapshot.dispatchClaimId) === claim.dispatchClaimId
  ) {
    return { ok: true, kind: "acknowledge" };
  }
  return { ok: false, error: "continuation is owned by a different or consumed dispatch claim" };
}

/**
 * Pure second-phase decision. Results may consume only the exact active
 * dispatch claim. Once results are claimed, no retry can re-enter the model
 * loop.
 */
export function canConsumeSwanBotContinuationDispatchClaim(
  snapshot: SwanBotContinuationDispatchSnapshot,
  claim: SwanBotContinuationDispatchClaim,
): { ok: true } | { ok: false; error: string } {
  const firstPhase = decideSwanBotContinuationDispatchClaim(snapshot, claim);
  if (!firstPhase.ok) return firstPhase;
  if (firstPhase.kind !== "acknowledge") {
    return { ok: false, error: "client tools have not been dispatch-claimed" };
  }
  return { ok: true };
}

type ReceiptPrimitive = string | number | boolean | null;
type ReceiptSubset = Record<string, ReceiptPrimitive>;

export type SwanBotClientToolReceiptMetadata = {
  mutationDispatchReceipt?: ReceiptSubset;
  computerAppVerificationReceipt?: ReceiptSubset;
};

export type SwanBotPendingClientTool = {
  id: string;
  name: string;
};

export type SwanBotClientToolPersistenceEntry = {
  toolUseId: string;
  toolName: string;
  eventPayload: {
    iteration: number;
    tool: string;
    tool_use_id: string;
    ok: boolean;
    dispatched: true | null;
    client_delegated: true;
    metadata?: SwanBotClientToolReceiptMetadata;
    error?: "client_tool_error";
  };
  toolCall: {
    toolName: string;
    toolUseId: string;
    ok: boolean;
    dispatched: true | null;
    clientDelegated: true;
    metadata?: SwanBotClientToolReceiptMetadata;
    error?: "client_tool_error";
  };
};

const SECRET_STRING_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /sk-ant-[A-Za-z0-9_-]{20,}/i,
  /sk-[A-Za-z0-9]{20,}/i,
  /github_pat_[A-Za-z0-9_]{50,}/i,
  /ghp_[A-Za-z0-9]{36,}/i,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/i,
  /Bearer\s+[A-Za-z0-9._-]{16,}/i,
  /api[_-]?key["'\s:=]+[A-Za-z0-9_-]{16,}/i,
  /:\/\/[^\s:@/]+:[^\s:@/]+@/,
  /(?:^|[\\/])Users[\\/][^\\/]+/i,
  /(?:^|[\\/])home[\\/][^\\/]+/i,
] as const;

const RECEIPT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:+-]*$/;
const RECEIPT_TOOL_RE = /^[a-z][a-z0-9_.:-]*$/;
const RECEIPT_VERIFICATION_STATUSES = new Set(["verified", "failed", "inconclusive"]);

function receiptRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readReceiptField(source: Record<string, unknown>, key: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
  } catch {
    return undefined;
  }
}

function containsSecretShape(value: string): boolean {
  for (const pattern of SECRET_STRING_PATTERNS) {
    try {
      if (pattern.test(value)) return true;
    } catch {
      // Continue through the remaining independent detectors.
    }
  }
  return false;
}

function boundedReceiptString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const scan = value.slice(0, SWANBOT_CLIENT_RECEIPT_STRING_MAX_CHARS * 4);
  let out = "";
  let pendingSpace = false;
  for (let i = 0; i < scan.length && out.length < SWANBOT_CLIENT_RECEIPT_STRING_MAX_CHARS; i++) {
    const code = scan.charCodeAt(i);
    if (code <= 32 || code === 127) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace && out.length < SWANBOT_CLIENT_RECEIPT_STRING_MAX_CHARS) out += " ";
    pendingSpace = false;
    if (out.length < SWANBOT_CLIENT_RECEIPT_STRING_MAX_CHARS) out += scan[i];
  }
  if (!out || containsSecretShape(out)) return undefined;
  return out;
}

function boundedReceiptIdentifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > SWANBOT_CLIENT_RECEIPT_STRING_MAX_CHARS) {
    return undefined;
  }
  const bounded = boundedReceiptString(value);
  return bounded === value && RECEIPT_ID_RE.test(bounded) ? bounded : undefined;
}

function boundedReceiptTool(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 120) return undefined;
  const bounded = boundedReceiptString(value);
  return bounded === value && RECEIPT_TOOL_RE.test(bounded) ? bounded : undefined;
}

function boundedReceiptTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 48) return undefined;
  const bounded = boundedReceiptString(value);
  if (!bounded || bounded !== value) return undefined;
  const timestamp = Date.parse(bounded);
  if (!Number.isFinite(timestamp)) return undefined;
  try {
    return new Date(timestamp).toISOString();
  } catch {
    return undefined;
  }
}

function boundedReceiptCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(10_000, Math.floor(value)));
}

/**
 * Re-sanitize the client receipt side channel at the edge boundary.
 *
 * The projection is deliberately narrower than generic AgentToolResult
 * metadata: a complete runtime-issued dispatch receipt is required, its tool
 * must match the exact pending call when supplied, and verification proof is
 * retained only when it binds to the same action/observation/timeline.
 */
export function sanitizeSwanBotClientToolReceiptMetadata(
  value: unknown,
  expectedToolName?: string,
): SwanBotClientToolReceiptMetadata | undefined {
  const source = receiptRecord(value);
  if (!source) return undefined;

  const rawDispatch = receiptRecord(readReceiptField(source, "mutationDispatchReceipt"));
  if (!rawDispatch || readReceiptField(rawDispatch, "schemaVersion") !== 1) return undefined;
  const actionId = boundedReceiptIdentifier(readReceiptField(rawDispatch, "actionId"));
  const tool = boundedReceiptTool(readReceiptField(rawDispatch, "tool"));
  const epochId = boundedReceiptIdentifier(readReceiptField(rawDispatch, "epochId"));
  const authorizedAt = boundedReceiptTimestamp(readReceiptField(rawDispatch, "authorizedAt"));
  const dispatchedAt = boundedReceiptTimestamp(readReceiptField(rawDispatch, "dispatchedAt"));
  if (!actionId || !tool || !epochId || !authorizedAt || !dispatchedAt) return undefined;
  if (expectedToolName && tool !== expectedToolName) return undefined;
  if (Date.parse(dispatchedAt) < Date.parse(authorizedAt)) return undefined;

  const mutationDispatchReceipt: ReceiptSubset = {
    schemaVersion: 1,
    actionId,
    tool,
    epochId,
    authorizedAt,
    dispatchedAt,
  };
  const out: SwanBotClientToolReceiptMetadata = { mutationDispatchReceipt };

  const rawVerification = receiptRecord(readReceiptField(source, "computerAppVerificationReceipt"));
  if (!rawVerification || readReceiptField(rawVerification, "schemaVersion") !== 1) return out;
  const verificationActionId = boundedReceiptIdentifier(readReceiptField(rawVerification, "actionId"));
  const beforeEpochId = boundedReceiptIdentifier(readReceiptField(rawVerification, "beforeEpochId"));
  const afterEpochRaw = readReceiptField(rawVerification, "afterEpochId");
  const afterEpochId = afterEpochRaw === null ? null : boundedReceiptIdentifier(afterEpochRaw);
  const statusRaw = boundedReceiptString(readReceiptField(rawVerification, "status"));
  const status = statusRaw && RECEIPT_VERIFICATION_STATUSES.has(statusRaw) ? statusRaw : undefined;
  const checkedAt = boundedReceiptTimestamp(readReceiptField(rawVerification, "checkedAt"));
  const canComplete = readReceiptField(rawVerification, "canComplete");
  const evidenceCount = boundedReceiptCount(readReceiptField(rawVerification, "evidenceCount"));
  const blockerCount = boundedReceiptCount(readReceiptField(rawVerification, "blockerCount"));
  if (
    !verificationActionId
    || verificationActionId !== actionId
    || !beforeEpochId
    || beforeEpochId !== epochId
    || afterEpochRaw !== null && !afterEpochId
    || !status
    || !checkedAt
    || typeof canComplete !== "boolean"
    || evidenceCount === undefined
    || blockerCount === undefined
    || Date.parse(checkedAt) < Date.parse(dispatchedAt)
  ) {
    return out;
  }
  if (
    status === "verified"
      ? canComplete !== true || !afterEpochId || evidenceCount < 1 || blockerCount !== 0
      : canComplete !== false
  ) {
    return out;
  }
  const durableAfterEpochId: string | null = afterEpochRaw === null ? null : afterEpochId!;

  out.computerAppVerificationReceipt = {
    schemaVersion: 1,
    actionId: verificationActionId,
    beforeEpochId,
    afterEpochId: durableAfterEpochId,
    status,
    checkedAt,
    canComplete,
    evidenceCount,
    blockerCount,
  };
  return out;
}

/**
 * Build the durable event/run summaries for one exact pending client batch.
 * Raw result content is intentionally absent from both outputs.
 */
export function buildSwanBotClientToolPersistenceEntries(args: {
  pendingTools: SwanBotPendingClientTool[];
  results: SwanBotResumeToolResult[];
  iteration: number;
}): { ok: true; entries: SwanBotClientToolPersistenceEntry[] } | { ok: false; error: string } {
  const pendingById = new Map<string, SwanBotPendingClientTool>();
  for (const pending of args.pendingTools) {
    const id = boundedReceiptIdentifier(pending?.id);
    const name = boundedReceiptTool(pending?.name);
    if (!id || !name) return { ok: false, error: "pending client tool identity is invalid" };
    if (pendingById.has(id)) return { ok: false, error: `duplicate pending client tool id: ${id}` };
    pendingById.set(id, { id, name });
  }
  const resultById = new Map<string, SwanBotResumeToolResult>();
  for (const result of args.results) {
    if (!pendingById.has(result.tool_use_id)) {
      return { ok: false, error: `unexpected persisted client tool result id: ${result.tool_use_id}` };
    }
    if (resultById.has(result.tool_use_id)) {
      return { ok: false, error: `duplicate persisted client tool result id: ${result.tool_use_id}` };
    }
    resultById.set(result.tool_use_id, result);
  }
  const missing = [...pendingById.keys()].filter((id) => !resultById.has(id));
  if (missing.length > 0) {
    return { ok: false, error: `missing persisted client tool result id(s): ${missing.join(", ")}` };
  }

  const iteration = Number.isFinite(args.iteration)
    ? Math.max(1, Math.min(1_000, Math.floor(args.iteration)))
    : 1;
  const entries: SwanBotClientToolPersistenceEntry[] = [];
  for (const pending of pendingById.values()) {
    const result = resultById.get(pending.id)!;
    const metadata = sanitizeSwanBotClientToolReceiptMetadata(
      result.receipt_metadata,
      pending.name,
    );
    const ok = result.is_error !== true;
    const dispatched = metadata?.mutationDispatchReceipt ? true : null;
    entries.push({
      toolUseId: pending.id,
      toolName: pending.name,
      eventPayload: {
        iteration,
        tool: pending.name,
        tool_use_id: pending.id,
        ok,
        dispatched,
        client_delegated: true,
        ...(metadata ? { metadata } : {}),
        ...(ok ? {} : { error: "client_tool_error" as const }),
      },
      toolCall: {
        toolName: pending.name,
        toolUseId: pending.id,
        ok,
        dispatched,
        clientDelegated: true,
        ...(metadata ? { metadata } : {}),
        ...(ok ? {} : { error: "client_tool_error" as const }),
      },
    });
  }
  return { ok: true, entries };
}

/**
 * Merge exact result summaries into the run aggregate without duplicating a
 * resumed call. Latest calls are retained under a hard item ceiling.
 */
export function mergeSwanBotDurableToolCalls(
  existing: unknown,
  clientEntries: SwanBotClientToolPersistenceEntry[],
): unknown[] {
  const prior = Array.isArray(existing) ? existing : [];
  const resultIds = new Set(clientEntries.map((entry) => entry.toolUseId));
  const retained = prior.filter((entry) => {
    const record = receiptRecord(entry);
    const id = record ? readReceiptField(record, "toolUseId") : undefined;
    return typeof id !== "string" || !resultIds.has(id);
  });
  const merged = [...retained, ...clientEntries.map((entry) => entry.toolCall)];
  if (merged.length <= SWANBOT_MAX_DURABLE_TOOL_CALLS) return merged;
  const keep = SWANBOT_MAX_DURABLE_TOOL_CALLS - 1;
  const omitted = merged.length - keep;
  return [
    { __truncated: true, omitted, total: merged.length },
    ...merged.slice(-keep),
  ];
}

/**
 * Explicit model projection. Hidden receipt metadata can never enter model
 * content through an object spread or future type widening.
 */
export function projectSwanBotResumeToolResultsForModel(
  results: SwanBotResumeToolResult[],
): Array<{ tool_use_id: string; content: string; is_error?: boolean }> {
  return results.map((result) => ({
    tool_use_id: result.tool_use_id,
    content: result.content,
    ...(result.is_error ? { is_error: true } : {}),
  }));
}

function normalizeClientToolResultContent(value: unknown): string {
  if (typeof value === "string") return summarizeToolResultForModel(value);
  try {
    return summarizeToolResultForModel(JSON.stringify(value ?? {}));
  } catch {
    return summarizeToolResultForModel(String(value ?? ""));
  }
}

export function validateSwanBotResumeToolResults(
  rawResults: unknown,
  pendingToolUseIds: string[],
  pendingTools?: SwanBotPendingClientTool[],
): { ok: true; results: SwanBotResumeToolResult[] } | { ok: false; error: string } {
  if (!Array.isArray(rawResults)) {
    return { ok: false, error: "toolResults must be an array" };
  }
  if (pendingToolUseIds.length === 0) {
    return { ok: false, error: "continuation has no pending tool ids" };
  }
  if (pendingToolUseIds.length > SWANBOT_MAX_CLIENT_TOOL_RESULTS) {
    return { ok: false, error: `too many pending client tool calls (${pendingToolUseIds.length})` };
  }
  const expected = new Set(pendingToolUseIds);
  if (expected.size !== pendingToolUseIds.length) {
    return { ok: false, error: "continuation contains duplicate pending tool ids" };
  }
  const expectedToolNames = new Map<string, string>();
  if (pendingTools) {
    for (const pending of pendingTools) {
      const id = boundedReceiptIdentifier(pending?.id);
      const name = boundedReceiptTool(pending?.name);
      if (!id || !name || !expected.has(id)) {
        return { ok: false, error: "continuation contains an invalid pending tool identity" };
      }
      if (expectedToolNames.has(id)) {
        return { ok: false, error: `continuation contains duplicate pending tool identity: ${id}` };
      }
      expectedToolNames.set(id, name);
    }
    if (expectedToolNames.size !== expected.size) {
      return { ok: false, error: "continuation pending tool identities are incomplete" };
    }
  }
  if (rawResults.length > SWANBOT_MAX_CLIENT_TOOL_RESULTS) {
    return { ok: false, error: `too many toolResults (${rawResults.length})` };
  }

  const byId = new Map<string, SwanBotResumeToolResult>();
  for (const item of rawResults) {
    const row = receiptRecord(item);
    if (!row) return { ok: false, error: "toolResults entries must be objects" };
    const rawToolUseId = readReceiptField(row, "tool_use_id") || readReceiptField(row, "id") || "";
    const toolUseId = boundedReceiptIdentifier(
      typeof rawToolUseId === "string" ? rawToolUseId.trim() : "",
    );
    if (!toolUseId) return { ok: false, error: "toolResults entries must include tool_use_id" };
    if (!expected.has(toolUseId)) {
      return { ok: false, error: `unexpected tool_result id: ${toolUseId}` };
    }
    if (byId.has(toolUseId)) {
      return { ok: false, error: `duplicate tool_result id: ${toolUseId}` };
    }
    const receiptMetadata = Object.prototype.hasOwnProperty.call(row, "receipt_metadata")
      ? sanitizeSwanBotClientToolReceiptMetadata(
          readReceiptField(row, "receipt_metadata"),
          expectedToolNames.get(toolUseId),
        )
      : undefined;
    byId.set(toolUseId, {
      tool_use_id: toolUseId,
      content: normalizeClientToolResultContent(
        Object.prototype.hasOwnProperty.call(row, "content") ? readReceiptField(row, "content") : {},
      ),
      is_error: readReceiptField(row, "is_error") === true,
      ...(receiptMetadata ? { receipt_metadata: receiptMetadata } : {}),
    });
  }

  const missing = pendingToolUseIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    return { ok: false, error: `missing tool_result id(s): ${missing.join(", ")}` };
  }

  return { ok: true, results: pendingToolUseIds.map((id) => byId.get(id)!) };
}
