/**
 * toolLoopResume — auto-consume the tool-loop resume checkpoint on a
 * continuation turn.
 *
 * When a turn hits the per-turn step cap, executeToolUseLoop returns a
 * ToolLoopCheckpoint and the session runtime persists it to the transcript as a
 * "Tool-step limit reached" event (`data.checkpoint`). Previously a follow-up
 * turn had to re-derive the state from the transcript narrative. This module
 * lets the next turn pull that checkpoint forward automatically and inject a
 * compact resume block into the system prompt, so the model picks up from the
 * last confirmed observation + the failed step instead of starting over.
 *
 * Pure + side-effect free → smoke testable. The caller (openswanSessionRuntime)
 * scans `transcript.events` and appends the block to the system prompt.
 */

import type { ToolLoopCheckpoint } from './toolLoopProgress';

const RESUME_LOCATOR_VERSION = 1 as const;
const RESUME_LOCATOR_ID_MAX = 192;
const RESUME_LOCATOR_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@+-]*$/;

/**
 * Value-free pointer from a Chat message to one exact checkpoint event in the
 * device-local OpenSwan transcript. It deliberately contains no checkpoint,
 * prompt, tool argument, result, path, selector, credential, or user content.
 */
export type OpenSwanResumeLocator = Readonly<{
  version: typeof RESUME_LOCATOR_VERSION;
  circleId: string;
  userId: string;
  threadId: string;
  runId: string | null;
  messageId: string;
  eventId: string;
}>;

export type OpenSwanResumeScope = Readonly<{
  circleId: string;
  userId: string;
  threadId: string;
  runId: string | null;
  messageId: string;
}>;

export type OpenSwanResumeTranscript = Readonly<{
  key?: string | null;
  runId?: string | null;
  chatSessionId?: string | null;
  circleId?: string | null;
  userId?: string | null;
  events?: ResumeScanEvent[] | null;
}>;

export type OpenSwanResumeResolution =
  | Readonly<{
      status: 'matched';
      locator: OpenSwanResumeLocator;
      checkpoint: ToolLoopCheckpoint;
    }>
  | Readonly<{
      status: 'unavailable' | 'mismatch';
      reason:
        | 'invalid_locator'
        | 'invalid_scope'
        | 'scope_mismatch'
        | 'transcript_unavailable'
        | 'transcript_mismatch'
        | 'event_not_found'
        | 'event_mismatch'
        | 'checkpoint_unavailable'
        | 'checkpoint_invalid'
        | 'superseded';
    }>;

export class OpenSwanResumeUnavailableError extends Error {
  readonly code = 'openswan_resume_checkpoint_unavailable';
  readonly resolution: Exclude<OpenSwanResumeResolution, { status: 'matched' }>;

  constructor(resolution: Exclude<OpenSwanResumeResolution, { status: 'matched' }>) {
    super('This saved OpenSwan checkpoint is no longer available on this device. Resend the task to start a fresh run.');
    this.name = 'OpenSwanResumeUnavailableError';
    this.resolution = resolution;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function projectResumeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0
    && trimmed.length <= RESUME_LOCATOR_ID_MAX
    && RESUME_LOCATOR_ID_RE.test(trimmed)
    ? trimmed
    : null;
}

function projectNullableResumeId(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null;
  return projectResumeId(value) ?? undefined;
}

/** Strict, bounded trust-boundary parser for persisted or caller-supplied locators. */
export function projectOpenSwanResumeLocator(value: unknown): OpenSwanResumeLocator | null {
  const raw = asRecord(value);
  if (!raw || raw.version !== RESUME_LOCATOR_VERSION) return null;
  const circleId = projectResumeId(raw.circleId);
  const userId = projectResumeId(raw.userId);
  const threadId = projectResumeId(raw.threadId);
  const runId = projectNullableResumeId(raw.runId);
  const messageId = projectResumeId(raw.messageId);
  const eventId = projectResumeId(raw.eventId);
  if (!circleId || !userId || !threadId || runId === undefined || !messageId || !eventId) return null;
  return {
    version: RESUME_LOCATOR_VERSION,
    circleId,
    userId,
    threadId,
    runId,
    messageId,
    eventId,
  };
}

/** Build the locator only when every required scope id is safe and bounded. */
export function buildOpenSwanResumeLocator(
  value: Omit<OpenSwanResumeLocator, 'version'>,
): OpenSwanResumeLocator | null {
  return projectOpenSwanResumeLocator({ version: RESUME_LOCATOR_VERSION, ...value });
}

function equalOpenSwanResumeLocator(a: OpenSwanResumeLocator, b: OpenSwanResumeLocator): boolean {
  return a.version === b.version
    && a.circleId === b.circleId
    && a.userId === b.userId
    && a.threadId === b.threadId
    && a.runId === b.runId
    && a.messageId === b.messageId
    && a.eventId === b.eventId;
}

function projectOpenSwanResumeScope(value: unknown): OpenSwanResumeScope | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const circleId = projectResumeId(raw.circleId);
  const userId = projectResumeId(raw.userId);
  const threadId = projectResumeId(raw.threadId);
  const runId = projectNullableResumeId(raw.runId);
  const messageId = projectResumeId(raw.messageId);
  if (!circleId || !userId || !threadId || runId === undefined || !messageId) return null;
  return { circleId, userId, threadId, runId, messageId };
}

function projectCheckpointStep(value: unknown): ToolLoopCheckpoint['completedSteps'][number] | null {
  const raw = asRecord(value);
  if (!raw || typeof raw.tool !== 'string' || raw.tool.length < 1 || raw.tool.length > 160 || typeof raw.ok !== 'boolean') {
    return null;
  }
  if (raw.reason !== undefined && (typeof raw.reason !== 'string' || raw.reason.length > 500)) return null;
  return {
    tool: raw.tool,
    ok: raw.ok,
    ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
  };
}

function projectToolLoopCheckpoint(value: unknown): ToolLoopCheckpoint | null {
  const raw = asRecord(value);
  if (
    !raw
    || raw.schemaVersion !== 1
    || !Number.isInteger(raw.stepCount)
    || (raw.stepCount as number) < 0
    || (raw.stepCount as number) > 10_000
    || !Array.isArray(raw.completedSteps)
    || raw.completedSteps.length > 20
    || typeof raw.resumeHint !== 'string'
    || raw.resumeHint.length < 1
    || raw.resumeHint.length > 2_000
  ) return null;
  const completedSteps = raw.completedSteps.map(projectCheckpointStep);
  if (completedSteps.some((step) => step === null)) return null;
  const maxRounds = raw.maxRounds;
  if (maxRounds !== undefined && (
    !Number.isInteger(maxRounds) || (maxRounds as number) < 1 || (maxRounds as number) > 10_000
  )) return null;
  const observation = raw.lastObservation;
  if (observation !== undefined && observation !== null) {
    const projected = asRecord(observation);
    if (
      !projected
      || typeof projected.tool !== 'string'
      || projected.tool.length < 1
      || projected.tool.length > 160
      || typeof projected.summary !== 'string'
      || projected.summary.length > 1_000
    ) return null;
  }
  const failure = raw.lastFailure;
  const projectedFailure = failure === undefined || failure === null ? null : projectCheckpointStep(failure);
  if (failure !== undefined && failure !== null && !projectedFailure) return null;
  return {
    schemaVersion: 1,
    stepCount: raw.stepCount as number,
    ...(typeof maxRounds === 'number' ? { maxRounds } : {}),
    completedSteps: completedSteps as ToolLoopCheckpoint['completedSteps'],
    lastObservation: observation == null
      ? null
      : {
          tool: (observation as Record<string, unknown>).tool as string,
          summary: (observation as Record<string, unknown>).summary as string,
        },
    lastFailure: projectedFailure,
    resumeHint: raw.resumeHint,
  };
}

/**
 * Resolve one exact event. Supplying a locator never scans for another or the
 * latest checkpoint. A later user/session turn supersedes the event so an old
 * chip cannot replay work after the conversation has already moved forward.
 */
export function resolveOpenSwanResumeLocator(input: {
  locator: unknown;
  scope: unknown;
  transcript: OpenSwanResumeTranscript | null | undefined;
}): OpenSwanResumeResolution {
  const locator = projectOpenSwanResumeLocator(input.locator);
  if (!locator) return { status: 'unavailable', reason: 'invalid_locator' };
  const scope = projectOpenSwanResumeScope(input.scope);
  if (!scope) return { status: 'mismatch', reason: 'invalid_scope' };
  if (
    locator.circleId !== scope.circleId
    || locator.userId !== scope.userId
    || locator.threadId !== scope.threadId
    || locator.runId !== scope.runId
    || locator.messageId !== scope.messageId
  ) return { status: 'mismatch', reason: 'scope_mismatch' };

  const transcript = input.transcript;
  if (!transcript || !Array.isArray(transcript.events)) {
    return { status: 'unavailable', reason: 'transcript_unavailable' };
  }
  if (
    transcript.key !== `chat:${locator.threadId}`
    || transcript.chatSessionId !== locator.threadId
    || transcript.circleId !== locator.circleId
    || transcript.userId !== locator.userId
  ) return { status: 'mismatch', reason: 'transcript_mismatch' };

  const eventIndex = transcript.events.findIndex((event) => event?.id === locator.eventId);
  if (eventIndex < 0) return { status: 'unavailable', reason: 'event_not_found' };
  const event = transcript.events[eventIndex];
  const eventLocator = projectOpenSwanResumeLocator(event?.data?.resumeLocator);
  if (event?.kind !== 'tool_activity' || !eventLocator || !equalOpenSwanResumeLocator(locator, eventLocator)) {
    return { status: 'mismatch', reason: 'event_mismatch' };
  }
  if (transcript.events.slice(eventIndex + 1).some((later) => (
    later?.kind === 'session_started'
    || later?.kind === 'user_turn'
    || (later?.kind === 'run_finalized'
      && (later.data?.terminal as Record<string, unknown> | undefined)?.state === 'succeeded'
      && (later.data?.terminal as Record<string, unknown> | undefined)?.completionVerified === true
    )
  ))) return { status: 'unavailable', reason: 'superseded' };

  if (!event.data?.checkpoint) return { status: 'unavailable', reason: 'checkpoint_unavailable' };
  const checkpoint = projectToolLoopCheckpoint(event.data.checkpoint);
  if (!checkpoint) return { status: 'unavailable', reason: 'checkpoint_invalid' };
  return { status: 'matched', locator, checkpoint };
}

function resumeLocatorClaimKey(locator: OpenSwanResumeLocator): string {
  return [
    locator.version,
    locator.circleId,
    locator.userId,
    locator.threadId,
    locator.runId || '-',
    locator.messageId,
    locator.eventId,
  ].join('|');
}

/** Mounted-runtime single-flight gate. `claim` mutates synchronously. */
export function createOpenSwanResumeClaimGate(): {
  claim: (value: unknown) => 'claimed' | 'already_claimed';
  isClaimed: (value: unknown) => boolean;
  release: (value: unknown) => void;
  clear: () => void;
} {
  const claimed = new Set<string>();
  const keyFor = (value: unknown): string | null => {
    const locator = projectOpenSwanResumeLocator(value);
    return locator ? resumeLocatorClaimKey(locator) : null;
  };
  return {
    claim(value) {
      const key = keyFor(value);
      if (!key || claimed.has(key)) return 'already_claimed';
      claimed.add(key);
      return 'claimed';
    },
    isClaimed(value) {
      const key = keyFor(value);
      return !!key && claimed.has(key);
    },
    release(value) {
      const key = keyFor(value);
      if (key) claimed.delete(key);
    },
    clear() {
      claimed.clear();
    },
  };
}

/** Minimal structural shape of a transcript event this scan needs. */
export interface ResumeScanEvent {
  id?: string | null;
  kind?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * Returns the checkpoint to resume from when the *most recent* turn ended at the
 * step cap, or null otherwise. Turns are delimited by the once-per-turn
 * `assistant_response` event: scanning back from the end, a checkpoint found
 * before the second `assistant_response` (the previous turn's end) belongs to
 * the last turn — so it's still pending. A later clean turn (no checkpoint of
 * its own) yields null, so a completed task is never re-resumed.
 */
export function findPendingResumeCheckpoint(
  events: ResumeScanEvent[] | null | undefined,
): ToolLoopCheckpoint | null {
  if (!Array.isArray(events)) return null;
  let seenAssistantResponses = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.kind === 'assistant_response') {
      seenAssistantResponses += 1;
      if (seenAssistantResponses >= 2) break; // reached the previous turn's end
      continue;
    }
    const checkpoint = event?.data?.checkpoint;
    if (checkpoint && typeof checkpoint === 'object') {
      return checkpoint as ToolLoopCheckpoint;
    }
  }
  return null;
}

/**
 * A compact system-prompt block telling the model the previous turn was cut off
 * at the step cap and how to resume. Deliberately defers to the user's actual
 * new message — if they've moved on, the model should follow that instead of
 * forcing resumption. Returns '' for a null/empty checkpoint.
 */
export function buildResumeContextBlock(checkpoint: ToolLoopCheckpoint | null | undefined): string {
  if (!checkpoint || typeof checkpoint !== 'object') return '';
  const lines: string[] = [
    'CONTINUATION — the previous turn hit its tool-step limit before finishing. If the',
    "user's new message continues that task, resume from where it stopped instead of",
    "starting over (and don't redo steps that already succeeded). If they've moved on,",
    'follow their new request instead.',
    '',
    `- Steps already completed: ${typeof checkpoint.stepCount === 'number' ? checkpoint.stepCount : 0}`,
  ];
  if (checkpoint.lastObservation?.tool) {
    const summary = checkpoint.lastObservation.summary ? ` — ${checkpoint.lastObservation.summary}` : '';
    lines.push(`- Last confirmed observation: \`${checkpoint.lastObservation.tool}\`${summary}`);
  }
  if (checkpoint.lastFailure?.tool) {
    const reason = checkpoint.lastFailure.reason ? ` — ${checkpoint.lastFailure.reason}` : '';
    lines.push(`- Last failed step to retry: \`${checkpoint.lastFailure.tool}\`${reason}`);
  }
  if (checkpoint.resumeHint) {
    lines.push(`- Resume plan: ${checkpoint.resumeHint}`);
  }
  lines.push('');
  lines.push('Start by re-observing fresh state to confirm what is already done, then continue the remaining work.');
  return lines.join('\n');
}
