import type {
  ComputerAppMutationAuthorization,
  ComputerAppMutationContract,
} from './computerAppGrounding';

export const AGENT_ACTION_CALL_STATES = [
  'claimed',
  'dispatched',
  'verified',
  'failed',
  'outcome_unknown',
] as const;

export type AgentActionCallState = typeof AGENT_ACTION_CALL_STATES[number];
export type AgentActionCallFinalState = Extract<
  AgentActionCallState,
  'verified' | 'failed' | 'outcome_unknown'
>;
export type AgentActionCallOperation = 'claim' | 'start' | 'finish';
export type AgentActionCallDisposition =
  | 'claimed'
  | 'already_claimed'
  | 'started'
  | 'finished'
  | 'already_finished'
  | 'duplicate';

export type AgentActionCallIdentity = Readonly<{
  schemaVersion: 1;
  userId: string;
  circleId: string;
  runId: string;
  tool: string;
  toolUseId: string;
  actionId: string;
  toolArgsFingerprint: string;
  contractFingerprint: string;
  idempotencyKey: string;
}>;

export type AgentActionCallMetadataPrimitive = string | number | boolean | null;
export type AgentActionCallMetadata = Record<string, AgentActionCallMetadataPrimitive>;

export type AgentActionCallRecord = AgentActionCallIdentity & {
  id: string;
  state: AgentActionCallState;
  claimToken?: string;
  claimedAt: string;
  expiresAt: string;
  dispatchedAt: string | null;
  finishedAt: string | null;
  stateVersion: number;
  attemptCount: number;
  metadata: AgentActionCallMetadata;
};

export type AgentActionCallSuccess = {
  ok: true;
  disposition: AgentActionCallDisposition;
  call: AgentActionCallRecord;
};

export type AgentActionCallErrorCode =
  | 'invalid_input'
  | 'not_authenticated'
  | 'run_identity_mismatch'
  | 'identity_conflict'
  | 'claim_not_found'
  | 'claim_token_mismatch'
  | 'claim_expired'
  | 'invalid_transition'
  | 'state_conflict'
  | 'rpc_error'
  | 'malformed_response';

export type AgentActionCallFailure = {
  ok: false;
  code: AgentActionCallErrorCode;
  message: string;
  retryable: false;
};

export type AgentActionCallResult = AgentActionCallSuccess | AgentActionCallFailure;

export interface AgentActionCallsRpcClient {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error?: unknown }>;
}

export interface AgentActionCallStore {
  claim: (input: AgentActionCallClaimInput) => Promise<AgentActionCallResult>;
  start: (input: AgentActionCallStartInput) => Promise<AgentActionCallResult>;
  finish: (input: AgentActionCallFinishInput) => Promise<AgentActionCallResult>;
}

export type AgentActionCallClaimInput = {
  identity: AgentActionCallIdentity;
  metadata?: unknown;
  /** Handler-entry lease. The database clamps this to 15..900 seconds. */
  ttlSeconds?: number;
};

export type AgentActionCallStartInput = {
  identity: AgentActionCallIdentity;
  claimToken: string;
};

export type AgentActionCallFinishInput = {
  identity: AgentActionCallIdentity;
  claimToken: string;
  finalState: AgentActionCallFinalState;
  metadata?: unknown;
};

export type BuildAgentActionCallIdentityInput = {
  userId: string;
  circleId: string;
  runId: string;
  toolUseId: string;
  action: Pick<
    ComputerAppMutationContract,
    | 'schemaVersion'
    | 'actionId'
    | 'tool'
    | 'toolArgsFingerprint'
    | 'idempotencyKey'
  >;
  authorization: Pick<
    ComputerAppMutationAuthorization,
    'allowed' | 'actionId' | 'contractBinding' | 'blockers'
  >;
};

export type AgentActionCallIdentityDependencies = {
  /**
   * Inject buildComputerAppToolArgsFingerprintAsync from
   * computerAppGrounding. The builder supplies the exact runtime-issued
   * contract binding; callers cannot substitute an unrelated digest.
   */
  fingerprintContractBinding: (
    value: Readonly<{ contractBinding: string }>,
  ) => Promise<string>;
};

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOOL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const CALL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const CRYPTO_FINGERPRINT_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const MAX_METADATA_STRING_CHARS = 240;
const MAX_ERROR_MESSAGE_CHARS = 240;

const METADATA_KEYS = [
  'surface',
  'risk',
  'approvalId',
  'observationEpochId',
  'verificationKind',
  'errorCode',
  'recoveryCode',
  'evidenceCount',
  'blockerCount',
  'completionVerified',
  'outcomeUnknown',
  'source',
  'actor',
  'redacted',
] as const;

const METADATA_KEY_SET = new Set<string>(METADATA_KEYS);
const METADATA_SURFACES = new Set([
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
const METADATA_RISKS = new Set(['low', 'medium', 'high', 'critical']);
const METADATA_VERIFICATION_KINDS = new Set([
  'app_state',
  'accessibility',
  'browser_dom',
  'artifact',
  'visual',
]);
const METADATA_SOURCES = new Set(['openswan_tool_runtime']);
const METADATA_ACTORS = new Set(['user_authorized_agent']);
const METADATA_OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const METADATA_CODE_RE = /^[a-z][a-z0-9_.:-]{0,79}$/;
const SECRET_OR_PRIVATE_VALUE_RE =
  /(?:bearer\s+[a-z0-9._~+/-]+|(?:api|access|refresh|session)[ _-]?token\s*[:=]|(?:api[ _-]?key|password|passcode|secret|credential)\s*[:=]|(?:sk|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{8,}|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}|^[a-z][a-z0-9+.-]*:|(?:^|[?&])[a-z0-9_.~-]{1,64}=[^&\s]*|^\/|^[a-z]:[\\/]|^\\\\|(?:^|[\\/])users[\\/][^\\/\s]+|%userprofile%|~[\\/]|[\s<>{}\[\]"'`])/i;

const FAILURE_CODES = new Set<AgentActionCallErrorCode>([
  'invalid_input',
  'not_authenticated',
  'run_identity_mismatch',
  'identity_conflict',
  'claim_not_found',
  'claim_token_mismatch',
  'claim_expired',
  'invalid_transition',
  'state_conflict',
  'rpc_error',
  'malformed_response',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedCleanText(value: unknown, maxChars: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxChars);
}

function parseUuid(value: unknown): string | null {
  const text = boundedCleanText(value, 64);
  return UUID_RE.test(text) ? text.toLowerCase() : null;
}

function parseBoundedId(
  value: unknown,
  pattern: RegExp,
  maxChars: number,
): string | null {
  const text = boundedCleanText(value, maxChars);
  return pattern.test(text) ? text : null;
}

function parseCryptographicFingerprint(value: unknown): string | null {
  const text = boundedCleanText(value, 96).toLowerCase();
  return CRYPTO_FINGERPRINT_RE.test(text) ? text : null;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  try {
    return new Date(parsed).toISOString();
  } catch {
    return null;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Allowlist-only, per-key metadata projection. Every key has one exact
 * primitive type plus an enum or bounded token format. Unknown, nested,
 * oversized, URI/query/content-looking, secret-shaped, email-shaped, and
 * POSIX/Windows path values never reach the durable RPC payload.
 */
export function sanitizeAgentActionCallMetadata(value: unknown): AgentActionCallMetadata {
  if (!isRecord(value)) return {};
  const output: AgentActionCallMetadata = {};
  let redacted = false;
  for (const key of Object.keys(value)) {
    if (!METADATA_KEY_SET.has(key)) redacted = true;
  }
  for (const key of METADATA_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key) || key === 'redacted') continue;
    const candidate = value[key];
    if (key === 'completionVerified' || key === 'outcomeUnknown') {
      if (typeof candidate === 'boolean') output[key] = candidate;
      else redacted = true;
      continue;
    }
    if (key === 'evidenceCount' || key === 'blockerCount') {
      if (
        typeof candidate === 'number'
        && Number.isSafeInteger(candidate)
        && candidate >= 0
        && candidate <= 10_000
      ) {
        output[key] = candidate;
      } else {
        redacted = true;
      }
      continue;
    }
    if (typeof candidate !== 'string' || candidate.length > MAX_METADATA_STRING_CHARS) {
      redacted = true;
      continue;
    }
    const clean = boundedCleanText(candidate, MAX_METADATA_STRING_CHARS);
    if (!clean) {
      redacted = true;
      continue;
    }
    if (
      clean !== candidate
      || SECRET_OR_PRIVATE_VALUE_RE.test(clean)
    ) {
      redacted = true;
      continue;
    }
    const valid = (
      (key === 'surface' && METADATA_SURFACES.has(clean))
      || (key === 'risk' && METADATA_RISKS.has(clean))
      || (key === 'approvalId' && UUID_RE.test(clean))
      || (key === 'observationEpochId' && METADATA_OPAQUE_ID_RE.test(clean))
      || (key === 'verificationKind' && METADATA_VERIFICATION_KINDS.has(clean))
      || ((key === 'errorCode' || key === 'recoveryCode') && METADATA_CODE_RE.test(clean))
      || (key === 'source' && METADATA_SOURCES.has(clean))
      || (key === 'actor' && METADATA_ACTORS.has(clean))
    );
    if (valid) {
      output[key] = key === 'approvalId' ? clean.toLowerCase() : clean;
    } else {
      redacted = true;
    }
  }
  if (value.redacted === true || redacted) output.redacted = true;
  return output;
}

export function parseAgentActionCallIdentity(value: unknown): ParseResult<AgentActionCallIdentity> {
  if (!isRecord(value)) return { ok: false, error: 'Action-call identity must be an object.' };
  const allowed = new Set([
    'schemaVersion',
    'userId',
    'circleId',
    'runId',
    'tool',
    'toolUseId',
    'actionId',
    'toolArgsFingerprint',
    'contractFingerprint',
    'idempotencyKey',
  ]);
  if (!hasOnlyKeys(value, allowed) || value.schemaVersion !== 1) {
    return { ok: false, error: 'Action-call identity has unsupported or unexpected fields.' };
  }
  const userId = parseUuid(value.userId);
  const circleId = parseUuid(value.circleId);
  const runId = parseUuid(value.runId);
  const tool = parseBoundedId(value.tool, TOOL_RE, 120);
  const toolUseId = parseBoundedId(value.toolUseId, CALL_ID_RE, 180);
  const actionId = parseBoundedId(value.actionId, CALL_ID_RE, 180);
  const toolArgsFingerprint = parseCryptographicFingerprint(value.toolArgsFingerprint);
  const contractFingerprint = parseCryptographicFingerprint(value.contractFingerprint);
  const idempotencyKey = parseBoundedId(value.idempotencyKey, CALL_ID_RE, 180);
  if (
    !userId
    || !circleId
    || !runId
    || !tool
    || !toolUseId
    || !actionId
    || !toolArgsFingerprint
    || !contractFingerprint
    || !idempotencyKey
    || idempotencyKey.length < 8
  ) {
    return {
      ok: false,
      error: 'Action-call identity is missing an exact UUID, tool/call/action id, idempotency key, or SHA-256 binding.',
    };
  }
  return {
    ok: true,
    value: Object.freeze({
      schemaVersion: 1,
      userId,
      circleId,
      runId,
      tool,
      toolUseId,
      actionId,
      toolArgsFingerprint,
      contractFingerprint,
      idempotencyKey,
    }),
  };
}

/**
 * Bind the database identity directly to a computerAppGrounding
 * mutation/authorization pair. This structurally refuses blocked or mismatched
 * inputs before any RPC is attempted; it does not replace the issued-object
 * checks in dispatchAuthorizedComputerAppMutation, so callers must pass the
 * authorization returned by the trusted grounding runtime.
 */
export async function buildAgentActionCallIdentity(
  input: BuildAgentActionCallIdentityInput,
  dependencies: AgentActionCallIdentityDependencies,
): Promise<ParseResult<AgentActionCallIdentity>> {
  if (
    !input
    || !input.action
    || !input.authorization
    || !Array.isArray(input.authorization.blockers)
    || input.action.schemaVersion !== 1
    || input.authorization.allowed !== true
    || input.authorization.blockers.length > 0
    || input.authorization.actionId !== input.action.actionId
    || !input.authorization.contractBinding
    || typeof dependencies?.fingerprintContractBinding !== 'function'
  ) {
    return {
      ok: false,
      error: 'Durable action identity requires the exact allowed runtime authorization and mutation action.',
    };
  }
  let contractFingerprint = '';
  try {
    contractFingerprint = await dependencies.fingerprintContractBinding(
      Object.freeze({ contractBinding: input.authorization.contractBinding }),
    );
  } catch {
    contractFingerprint = '';
  }
  return parseAgentActionCallIdentity({
    schemaVersion: 1,
    userId: input.userId,
    circleId: input.circleId,
    runId: input.runId,
    tool: input.action.tool,
    toolUseId: input.toolUseId,
    actionId: input.action.actionId,
    toolArgsFingerprint: input.action.toolArgsFingerprint,
    contractFingerprint,
    idempotencyKey: input.action.idempotencyKey,
  });
}

const SUCCESS_KEYS = new Set([
  'schemaVersion',
  'ok',
  'disposition',
  'id',
  'state',
  'userId',
  'circleId',
  'runId',
  'tool',
  'toolUseId',
  'actionId',
  'toolArgsFingerprint',
  'contractFingerprint',
  'idempotencyKey',
  'claimToken',
  'claimedAt',
  'expiresAt',
  'dispatchedAt',
  'finishedAt',
  'stateVersion',
  'attemptCount',
  'metadata',
]);

const FAILURE_KEYS = new Set(['schemaVersion', 'ok', 'code', 'message']);

function identitiesEqual(
  left: AgentActionCallIdentity,
  right: AgentActionCallIdentity,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion
    && left.userId === right.userId
    && left.circleId === right.circleId
    && left.runId === right.runId
    && left.tool === right.tool
    && left.toolUseId === right.toolUseId
    && left.actionId === right.actionId
    && left.toolArgsFingerprint === right.toolArgsFingerprint
    && left.contractFingerprint === right.contractFingerprint
    && left.idempotencyKey === right.idempotencyKey
  );
}

function malformedResponse(message: string): AgentActionCallFailure {
  return {
    ok: false,
    code: 'malformed_response',
    message: boundedCleanText(message, MAX_ERROR_MESSAGE_CHARS)
      || 'Durable action-call response failed validation.',
    retryable: false,
  };
}

/**
 * Parse and correlate an untrusted RPC response. Success is accepted only when
 * every durable identity field exactly matches the caller's expected call.
 */
export function parseAgentActionCallRpcResponse(
  value: unknown,
  expectedIdentity: AgentActionCallIdentity,
  operation: AgentActionCallOperation,
): AgentActionCallResult {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.ok !== 'boolean') {
    return malformedResponse('Durable action-call RPC returned an unsupported envelope.');
  }
  if (value.ok === false) {
    if (!hasOnlyKeys(value, FAILURE_KEYS)) {
      return malformedResponse('Durable action-call failure contained unexpected fields.');
    }
    const code = boundedCleanText(value.code, 80) as AgentActionCallErrorCode;
    const message = boundedCleanText(value.message, MAX_ERROR_MESSAGE_CHARS);
    if (!FAILURE_CODES.has(code) || !message) {
      return malformedResponse('Durable action-call failure was missing a safe code or message.');
    }
    return { ok: false, code, message, retryable: false };
  }
  if (!hasOnlyKeys(value, SUCCESS_KEYS)) {
    return malformedResponse('Durable action-call success contained unexpected fields.');
  }
  const identityResult = parseAgentActionCallIdentity({
    schemaVersion: value.schemaVersion,
    userId: value.userId,
    circleId: value.circleId,
    runId: value.runId,
    tool: value.tool,
    toolUseId: value.toolUseId,
    actionId: value.actionId,
    toolArgsFingerprint: value.toolArgsFingerprint,
    contractFingerprint: value.contractFingerprint,
    idempotencyKey: value.idempotencyKey,
  });
  if (!identityResult.ok || !identitiesEqual(identityResult.value, expectedIdentity)) {
    return malformedResponse('Durable action-call success did not match the exact requested identity.');
  }
  const id = parseUuid(value.id);
  const state = AGENT_ACTION_CALL_STATES.includes(value.state as AgentActionCallState)
    ? value.state as AgentActionCallState
    : null;
  const disposition = [
    'claimed',
    'already_claimed',
    'started',
    'finished',
    'already_finished',
    'duplicate',
  ].includes(String(value.disposition))
    ? value.disposition as AgentActionCallDisposition
    : null;
  const hasClaimToken = Object.prototype.hasOwnProperty.call(value, 'claimToken');
  const claimToken = hasClaimToken ? parseUuid(value.claimToken) : null;
  const claimedAt = parseTimestamp(value.claimedAt);
  const expiresAt = parseTimestamp(value.expiresAt);
  const dispatchedAt = value.dispatchedAt === null ? null : parseTimestamp(value.dispatchedAt);
  const finishedAt = value.finishedAt === null ? null : parseTimestamp(value.finishedAt);
  const stateVersion = Number(value.stateVersion);
  const attemptCount = Number(value.attemptCount);
  const metadata = sanitizeAgentActionCallMetadata(value.metadata);
  if (
    !id
    || !state
    || !disposition
    || !claimedAt
    || !expiresAt
    || Date.parse(expiresAt) <= Date.parse(claimedAt)
    || !Number.isSafeInteger(stateVersion)
    || stateVersion < 1
    || stateVersion > 1_000_000
    || !Number.isSafeInteger(attemptCount)
    || attemptCount < 1
    || attemptCount > 10_000
    || (hasClaimToken && !claimToken)
    || !isRecord(value.metadata)
    || stableJson(metadata) !== stableJson(value.metadata)
  ) {
    return malformedResponse('Durable action-call success contained invalid state, time, version, or metadata.');
  }
  const stateTimelineValid = (
    (state === 'claimed' && dispatchedAt === null && finishedAt === null)
    || (state === 'dispatched' && dispatchedAt !== null && finishedAt === null)
    || ((state === 'verified' || state === 'outcome_unknown')
      && dispatchedAt !== null
      && finishedAt !== null)
    || (state === 'failed' && dispatchedAt === null && finishedAt !== null)
  );
  const chronologyValid = (
    (!dispatchedAt || Date.parse(dispatchedAt) >= Date.parse(claimedAt))
    && (!finishedAt || Date.parse(finishedAt) >= Date.parse(dispatchedAt || claimedAt))
  );
  const operationValid = (
    operation === 'claim'
      ? (
          ((disposition === 'claimed' || disposition === 'already_claimed')
            && state === 'claimed'
            && hasClaimToken
            && Boolean(claimToken))
          || (disposition === 'duplicate' && state !== 'claimed' && !hasClaimToken)
        )
      : operation === 'start'
        ? (
            (disposition === 'started' && state === 'dispatched' && !hasClaimToken)
            || (disposition === 'duplicate' && state !== 'claimed' && !hasClaimToken)
          )
        : (
            (disposition === 'finished' || disposition === 'already_finished')
            && (state === 'verified' || state === 'failed' || state === 'outcome_unknown')
            && !hasClaimToken
          )
  );
  if (!stateTimelineValid || !chronologyValid || !operationValid) {
    return malformedResponse('Durable action-call state transition or timeline was incoherent.');
  }
  return {
    ok: true,
    disposition,
    call: {
      ...identityResult.value,
      id,
      state,
      ...(claimToken ? { claimToken } : {}),
      claimedAt,
      expiresAt,
      dispatchedAt,
      finishedAt,
      stateVersion,
      attemptCount,
      metadata,
    },
  };
}

function invalidInput(message: string): AgentActionCallFailure {
  return {
    ok: false,
    code: 'invalid_input',
    message: boundedCleanText(message, MAX_ERROR_MESSAGE_CHARS) || 'Invalid durable action-call input.',
    retryable: false,
  };
}

function rpcFailure(): AgentActionCallFailure {
  return {
    ok: false,
    code: 'rpc_error',
    message: 'Durable action-call storage failed closed before accepting a state transition.',
    retryable: false,
  };
}

function identityRpcArgs(identity: AgentActionCallIdentity): Record<string, unknown> {
  return {
    p_user_id: identity.userId,
    p_circle_id: identity.circleId,
    p_run_id: identity.runId,
    p_tool_name: identity.tool,
    p_tool_use_id: identity.toolUseId,
    p_action_id: identity.actionId,
    p_tool_args_fingerprint: identity.toolArgsFingerprint,
    p_contract_fingerprint: identity.contractFingerprint,
    p_idempotency_key: identity.idempotencyKey,
  };
}

async function invokeActionCallRpc(
  client: AgentActionCallsRpcClient,
  functionName: string,
  args: Record<string, unknown>,
  expectedIdentity: AgentActionCallIdentity,
  operation: AgentActionCallOperation,
): Promise<AgentActionCallResult> {
  try {
    const response = await client.rpc(functionName, args);
    if (!response || response.error) return rpcFailure();
    return parseAgentActionCallRpcResponse(response.data, expectedIdentity, operation);
  } catch {
    return rpcFailure();
  }
}

export function createAgentActionCallStore(
  client: AgentActionCallsRpcClient,
): AgentActionCallStore {
  return {
    async claim(input) {
      const identity = parseAgentActionCallIdentity(input?.identity);
      if (!identity.ok) return invalidInput(identity.error);
      const requestedTtl = Number(input.ttlSeconds ?? 120);
      const ttlSeconds = Number.isFinite(requestedTtl)
        ? Math.max(15, Math.min(900, Math.floor(requestedTtl)))
        : 120;
      return invokeActionCallRpc(
        client,
        'claim_agent_action_call',
        {
          ...identityRpcArgs(identity.value),
          p_metadata: sanitizeAgentActionCallMetadata(input.metadata),
          p_ttl_seconds: ttlSeconds,
        },
        identity.value,
        'claim',
      );
    },

    async start(input) {
      const identity = parseAgentActionCallIdentity(input?.identity);
      if (!identity.ok) return invalidInput(identity.error);
      const claimToken = parseUuid(input.claimToken);
      if (!claimToken) return invalidInput('A valid durable action-call claim token is required.');
      return invokeActionCallRpc(
        client,
        'start_agent_action_call',
        {
          ...identityRpcArgs(identity.value),
          p_claim_token: claimToken,
        },
        identity.value,
        'start',
      );
    },

    async finish(input) {
      const identity = parseAgentActionCallIdentity(input?.identity);
      if (!identity.ok) return invalidInput(identity.error);
      const claimToken = parseUuid(input.claimToken);
      if (!claimToken) return invalidInput('A valid durable action-call claim token is required.');
      if (!['verified', 'failed', 'outcome_unknown'].includes(input.finalState)) {
        return invalidInput('Final state must be verified, failed, or outcome_unknown.');
      }
      return invokeActionCallRpc(
        client,
        'finish_agent_action_call',
        {
          ...identityRpcArgs(identity.value),
          p_claim_token: claimToken,
          p_final_state: input.finalState,
          p_metadata: sanitizeAgentActionCallMetadata(input.metadata),
        },
        identity.value,
        'finish',
      );
    },
  };
}
