/**
 * Authoritative terminal outcome for native, file, and hybrid computer tasks.
 *
 * Keep this contract independent from chat transport status. The chat
 * dispatcher currently has a coarser status union, so callers must preserve
 * this value in metadata even when adapting it for that outer envelope.
 */
export type ComputerTaskOutcomeStatus =
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'needs_input'
  | 'waiting_approval'
  | 'failed'
  | 'cancelled';

export type AgentTaskCompletionExpectation = 'response' | 'verified_task';

/**
 * Transport success and task completion are deliberately separate.
 *
 * `inconclusive` means the model returned a response, but the active runtime
 * did not expose structured evidence that the requested mutation completed.
 */
export type AgentTaskTerminalOutcomeStatus =
  | 'completed'
  | 'inconclusive'
  | 'failed'
  | 'cancelled';

export interface AgentTaskTerminalOutcome {
  status: AgentTaskTerminalOutcomeStatus;
  source: 'response_received' | 'structured_runtime' | 'transport_error';
  reason: string;
}

export type ComputerTaskCapabilityBuildoutStatusLike =
  | 'approval_required'
  | 'requested'
  | 'ready_to_retry'
  | 'incomplete'
  | 'blocked'
  | 'failed'
  | null
  | undefined;

export type ChatComputerTaskOutcomeStatus =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'deferred'
  | 'needs_input';

const COMPUTER_TASK_OUTCOME_STATUSES = new Set<ComputerTaskOutcomeStatus>([
  'completed',
  'partial',
  'blocked',
  'needs_input',
  'waiting_approval',
  'failed',
  'cancelled',
]);

export function normalizeComputerTaskOutcomeStatus(
  value: unknown,
): ComputerTaskOutcomeStatus | null {
  return typeof value === 'string' && COMPUTER_TASK_OUTCOME_STATUSES.has(value as ComputerTaskOutcomeStatus)
    ? value as ComputerTaskOutcomeStatus
    : null;
}

export function deriveAgentTaskTerminalOutcome(input: {
  transportSuccess: boolean;
  expectation?: AgentTaskCompletionExpectation;
  structuredStatus?: Exclude<AgentTaskTerminalOutcomeStatus, 'inconclusive'> | null;
}): AgentTaskTerminalOutcome {
  if (!input.transportSuccess) {
    return {
      status: input.structuredStatus === 'cancelled' ? 'cancelled' : 'failed',
      source: input.structuredStatus ? 'structured_runtime' : 'transport_error',
      reason: input.structuredStatus === 'cancelled'
        ? 'The runtime reported cancellation.'
        : 'The agent transport failed before a successful response was returned.',
    };
  }
  if (input.structuredStatus) {
    return {
      status: input.structuredStatus,
      source: 'structured_runtime',
      reason: `The runtime reported a structured ${input.structuredStatus} terminal outcome.`,
    };
  }
  if ((input.expectation || 'response') === 'verified_task') {
    return {
      status: 'inconclusive',
      source: 'response_received',
      reason: 'The model returned prose, but this runtime exposed no structured proof that the requested task completed.',
    };
  }
  return {
    status: 'completed',
    source: 'response_received',
    reason: 'The requested outcome was a model response and a response was returned.',
  };
}

export function deriveComputerTaskAdapterOutcomeStatus(input: {
  ok: boolean;
  /** Explicit after-state/predicate proof for a mutating adapter result. */
  proofVerified: boolean;
  blocked?: boolean;
  cancelled?: boolean;
}): ComputerTaskOutcomeStatus {
  if (input.cancelled) return 'cancelled';
  if (input.blocked) return 'blocked';
  if (!input.ok) return 'failed';
  return input.proofVerified ? 'completed' : 'partial';
}

/**
 * A desktop sequence is proven complete only when its final dispatched step is
 * a successful after-state verification. Proof collected earlier in a batch
 * becomes stale as soon as a later click, type, navigation, or other mutation
 * runs.
 */
export function hasTerminalDesktopSequenceCompletionProof(
  steps: ReadonlyArray<{ kind?: unknown; ok?: unknown }> | null | undefined,
): boolean {
  if (!steps?.length) return false;
  const terminalStep = steps[steps.length - 1];
  return terminalStep?.kind === 'output_verification' && terminalStep.ok === true;
}

export function deriveComputerTaskAgentOutcomeStatus(input: {
  success: boolean;
  terminalOutcomeStatus?: AgentTaskTerminalOutcomeStatus | null;
  partialProgress?: boolean;
  blocked?: boolean;
  cancelled?: boolean;
  capabilityBuildoutStatus?: ComputerTaskCapabilityBuildoutStatusLike;
}): ComputerTaskOutcomeStatus {
  if (input.cancelled) return 'cancelled';

  switch (input.capabilityBuildoutStatus) {
    case 'approval_required':
      return 'waiting_approval';
    case 'requested':
      return input.partialProgress ? 'partial' : 'blocked';
    case 'ready_to_retry':
    case 'incomplete':
    case 'blocked':
      return 'blocked';
    case 'failed':
      return 'failed';
    default:
      break;
  }

  if (input.blocked) return 'blocked';
  switch (input.terminalOutcomeStatus) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'inconclusive':
      return input.partialProgress ? 'partial' : 'blocked';
    case 'failed':
      return input.partialProgress ? 'partial' : 'failed';
    default:
      // Backward-compatible fallback for callers that have not adopted the
      // typed terminal seam yet. Computer-task callers always provide it.
      if (input.success) return 'completed';
      return input.partialProgress ? 'partial' : 'failed';
  }
}

/**
 * Temporary adapter for the coarser ChatAutomationOutcome union.
 *
 * Chat callers must also persist the original ComputerTaskOutcomeStatus in
 * `data.computerTaskStatus`; this mapping must never be used as the source of
 * truth for task completion.
 */
export function mapComputerTaskOutcomeToChatStatus(
  status: ComputerTaskOutcomeStatus,
): ChatComputerTaskOutcomeStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'needs_input':
      return 'needs_input';
    case 'waiting_approval':
      return 'deferred';
    case 'failed':
      return 'failed';
    case 'partial':
    case 'blocked':
    case 'cancelled':
      return 'blocked';
  }
}

export function isComputerTaskOutcomeComplete(
  status: ComputerTaskOutcomeStatus,
): boolean {
  return status === 'completed';
}
