/**
 * Auth-scoped, per-user-and-circle write queue for private Office preferences.
 *
 * The queue owns four safety boundaries:
 * - authority and JSON input are validated and immutably captured at enqueue;
 * - each exact user/circle scope has an independent serialized lane;
 * - the current app-owned authority is checked immediately before dispatch; and
 * - callers receive a bounded typed result without allowing a timed-out write
 *   to overlap a later write in the same lane.
 */

export type OfficePreferenceJsonPrimitive = string | number | boolean | null;

export type OfficePreferenceJsonValue =
  | OfficePreferenceJsonPrimitive
  | ReadonlyArray<OfficePreferenceJsonValue>
  | { readonly [key: string]: OfficePreferenceJsonValue };

export interface OfficePreferenceWriteInput {
  userId: unknown;
  circleId: unknown;
  accessToken: unknown;
  authorityGeneration: unknown;
  partial: unknown;
}

export interface CapturedOfficePreferenceWrite {
  readonly userId: string;
  readonly circleId: string;
  readonly accessToken: string;
  readonly authorityGeneration: number;
  readonly partial: Readonly<Record<string, OfficePreferenceJsonValue>>;
}

export type OfficePreferenceTransportResult =
  | { ok: true }
  | { ok: false; retryable: boolean };

export type OfficePreferenceWriteResult =
  | {
      ok: true;
      code: 'saved';
      userId: string;
      circleId: string;
      dispatched: true;
    }
  | {
      ok: false;
      code:
        | 'invalid_authority'
        | 'authority_too_large'
        | 'invalid_value'
        | 'value_too_large';
      retryable: false;
      dispatched: false;
      outcomeUnknown: false;
    }
  | {
      ok: false;
      code: 'scope_retired';
      userId: string;
      circleId: string;
      retryable: false;
      dispatched: false;
      outcomeUnknown: false;
    }
  | {
      ok: false;
      code: 'save_failed';
      userId: string;
      circleId: string;
      retryable: boolean;
      dispatched: true;
      outcomeUnknown: false;
    }
  | {
      ok: false;
      code: 'deadline_exceeded';
      userId: string;
      circleId: string;
      retryable: false;
      dispatched: true;
      outcomeUnknown: true;
    }
  | {
      ok: false;
      code: 'queue_failed';
      userId: string;
      circleId: string;
      retryable: false;
      dispatched: true;
      outcomeUnknown: true;
    };

export interface OfficePreferenceDeadlineScheduler {
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}

export interface OfficePreferenceWriteQueueOptions {
  /** Checked synchronously immediately before the transport is invoked. */
  getCurrentScope: () => Readonly<{
    userId: string;
    circleId: string;
    accessToken: string;
    generation: number;
  }> | null;
  save: (
    item: CapturedOfficePreferenceWrite,
    signal: AbortSignal,
  ) => PromiseLike<OfficePreferenceTransportResult>;
  deadlineMs?: number;
  scheduler?: OfficePreferenceDeadlineScheduler;
}

export interface OfficePreferenceWriteQueue {
  enqueue: (input: OfficePreferenceWriteInput) => Promise<OfficePreferenceWriteResult>;
  getLaneCount: () => number;
  dispose: () => void;
}

export const OFFICE_PREFERENCE_DEFAULT_DEADLINE_MS = 12_000;
export const OFFICE_PREFERENCE_MAX_DEADLINE_MS = 30_000;
export const OFFICE_PREFERENCE_MAX_USER_ID_BYTES = 128;
export const OFFICE_PREFERENCE_MAX_ACCESS_TOKEN_BYTES = 16 * 1024;
export const OFFICE_PREFERENCE_MAX_VALUE_BYTES = 128 * 1024;
export const OFFICE_PREFERENCE_MAX_VALUE_DEPTH = 12;
export const OFFICE_PREFERENCE_MAX_VALUE_NODES = 4_096;

const OFFICE_PREFERENCE_MAX_COLLECTION_ITEMS = 1_024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JWT_SEGMENT_RE = /^[A-Za-z0-9_-]+$/;
const BLOCKED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

type InputFailureCode =
  | 'invalid_authority'
  | 'authority_too_large'
  | 'invalid_value'
  | 'value_too_large';

type CaptureResult =
  | { ok: true; item: CapturedOfficePreferenceWrite }
  | { ok: false; code: InputFailureCode };

type ValueInspectionResult = { ok: true } | { ok: false; code: 'invalid_value' | 'value_too_large' };

function defaultSchedule(callback: () => void, delayMs: number): unknown {
  return setTimeout(callback, delayMs);
}

function defaultCancel(handle: unknown): void {
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function normalizeDeadlineMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return OFFICE_PREFERENCE_DEFAULT_DEADLINE_MS;
  }
  return Math.min(Math.max(1, Math.floor(value)), OFFICE_PREFERENCE_MAX_DEADLINE_MS);
}

function inspectJsonValue(
  value: unknown,
  depth: number,
  ancestors: Set<object>,
  budget: { nodes: number },
): ValueInspectionResult {
  budget.nodes += 1;
  if (budget.nodes > OFFICE_PREFERENCE_MAX_VALUE_NODES) {
    return { ok: false, code: 'value_too_large' };
  }
  if (depth > OFFICE_PREFERENCE_MAX_VALUE_DEPTH) {
    return { ok: false, code: 'value_too_large' };
  }

  if (value === null || typeof value === 'boolean') return { ok: true };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { ok: true } : { ok: false, code: 'invalid_value' };
  }
  if (typeof value === 'string') {
    return utf8ByteLength(value) <= OFFICE_PREFERENCE_MAX_VALUE_BYTES
      ? { ok: true }
      : { ok: false, code: 'value_too_large' };
  }
  if (typeof value !== 'object') return { ok: false, code: 'invalid_value' };
  if (ancestors.has(value)) return { ok: false, code: 'invalid_value' };

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > OFFICE_PREFERENCE_MAX_COLLECTION_ITEMS) {
        return { ok: false, code: 'value_too_large' };
      }
      const keys = Object.keys(value);
      if (keys.length !== value.length) return { ok: false, code: 'invalid_value' };
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          return { ok: false, code: 'invalid_value' };
        }
        const inspected = inspectJsonValue(value[index], depth + 1, ancestors, budget);
        if (!inspected.ok) return inspected;
      }
      return { ok: true };
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return { ok: false, code: 'invalid_value' };
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      return { ok: false, code: 'invalid_value' };
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (keys.length > OFFICE_PREFERENCE_MAX_COLLECTION_ITEMS) {
      return { ok: false, code: 'value_too_large' };
    }
    for (const key of keys) {
      if (BLOCKED_KEYS.has(key)) return { ok: false, code: 'invalid_value' };
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return { ok: false, code: 'invalid_value' };
      }
      const inspected = inspectJsonValue(descriptor.value, depth + 1, ancestors, budget);
      if (!inspected.ok) return inspected;
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 'invalid_value' };
  } finally {
    ancestors.delete(value);
  }
}

function deepFreezeJson<T extends OfficePreferenceJsonValue>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function validateAuthority(
  userIdValue: unknown,
  circleIdValue: unknown,
  accessTokenValue: unknown,
  generationValue: unknown,
): { ok: true; userId: string; circleId: string; accessToken: string; authorityGeneration: number } | { ok: false; code: InputFailureCode } {
  if (typeof userIdValue !== 'string' || typeof circleIdValue !== 'string' || typeof accessTokenValue !== 'string') {
    return { ok: false, code: 'invalid_authority' };
  }
  if (
    utf8ByteLength(userIdValue) > OFFICE_PREFERENCE_MAX_USER_ID_BYTES
    || utf8ByteLength(circleIdValue) > OFFICE_PREFERENCE_MAX_USER_ID_BYTES
    || utf8ByteLength(accessTokenValue) > OFFICE_PREFERENCE_MAX_ACCESS_TOKEN_BYTES
  ) {
    return { ok: false, code: 'authority_too_large' };
  }
  if (
    userIdValue !== userIdValue.trim()
    || circleIdValue !== circleIdValue.trim()
    || accessTokenValue !== accessTokenValue.trim()
    || !UUID_RE.test(userIdValue)
    || !UUID_RE.test(circleIdValue)
    || typeof generationValue !== 'number'
    || !Number.isSafeInteger(generationValue)
    || generationValue <= 0
  ) {
    return { ok: false, code: 'invalid_authority' };
  }

  const tokenSegments = accessTokenValue.split('.');
  if (
    tokenSegments.length !== 3
    || tokenSegments.some((segment) => !segment || !JWT_SEGMENT_RE.test(segment))
  ) {
    return { ok: false, code: 'invalid_authority' };
  }
  return {
    ok: true,
    userId: userIdValue,
    circleId: circleIdValue,
    accessToken: accessTokenValue,
    authorityGeneration: generationValue,
  };
}

function captureInput(input: OfficePreferenceWriteInput): CaptureResult {
  const authority = validateAuthority(
    input.userId,
    input.circleId,
    input.accessToken,
    input.authorityGeneration,
  );
  if (!authority.ok) return authority;

  try {
    if (!input.partial || typeof input.partial !== 'object' || Array.isArray(input.partial)) {
      return { ok: false, code: 'invalid_value' };
    }
    if (Object.keys(input.partial).length === 0) {
      return { ok: false, code: 'invalid_value' };
    }
    const inspected = inspectJsonValue(input.partial, 0, new Set<object>(), { nodes: 0 });
    if (!inspected.ok) return inspected;

    const serialized = JSON.stringify(input.partial);
    if (utf8ByteLength(serialized) > OFFICE_PREFERENCE_MAX_VALUE_BYTES) {
      return { ok: false, code: 'value_too_large' };
    }
    const partial = deepFreezeJson(
      JSON.parse(serialized) as Record<string, OfficePreferenceJsonValue>,
    );
    return {
      ok: true,
      item: Object.freeze({
        userId: authority.userId,
        circleId: authority.circleId,
        accessToken: authority.accessToken,
        authorityGeneration: authority.authorityGeneration,
        partial,
      }),
    };
  } catch {
    return { ok: false, code: 'invalid_value' };
  }
}

function isTransportResult(value: unknown): value is OfficePreferenceTransportResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { ok?: unknown; retryable?: unknown };
  return candidate.ok === true || (candidate.ok === false && typeof candidate.retryable === 'boolean');
}

export function createOfficePreferenceWriteQueue(
  options: OfficePreferenceWriteQueueOptions,
): OfficePreferenceWriteQueue {
  const deadlineMs = normalizeDeadlineMs(options.deadlineMs);
  const scheduler = options.scheduler ?? {
    schedule: defaultSchedule,
    cancel: defaultCancel,
  };
  const laneTails = new Map<string, Promise<void>>();
  let disposed = false;

  const runCapturedItem = async (
    item: CapturedOfficePreferenceWrite,
    settleCaller: (result: OfficePreferenceWriteResult) => void,
  ): Promise<void> => {
    let currentScope: ReturnType<OfficePreferenceWriteQueueOptions['getCurrentScope']> = null;
    try {
      currentScope = options.getCurrentScope();
    } catch {
      // Failing to prove the exact current authority retires the queued scope.
    }
    if (
      disposed
      || currentScope?.userId !== item.userId
      || currentScope?.circleId !== item.circleId
      || currentScope?.accessToken !== item.accessToken
      || currentScope?.generation !== item.authorityGeneration
    ) {
      settleCaller({
        ok: false,
        code: 'scope_retired',
        userId: item.userId,
        circleId: item.circleId,
        retryable: false,
        dispatched: false,
        outcomeUnknown: false,
      });
      return;
    }

    const controller = new AbortController();
    let transportPromise: Promise<OfficePreferenceTransportResult>;
    try {
      // Keep the authority check and invocation adjacent: there is no await or
      // callback boundary between proving the user and dispatching the save.
      transportPromise = Promise.resolve(options.save(item, controller.signal));
    } catch {
      transportPromise = Promise.reject(new Error('office_preference_save_threw'));
    }

    const transportOutcome: Promise<OfficePreferenceWriteResult> = transportPromise
      .then((result): OfficePreferenceWriteResult => {
        if (!isTransportResult(result)) {
          return {
            ok: false,
            code: 'save_failed',
            userId: item.userId,
            circleId: item.circleId,
            retryable: false,
            dispatched: true,
            outcomeUnknown: false,
          };
        }
        if (result.ok) {
          return { ok: true, code: 'saved', userId: item.userId, circleId: item.circleId, dispatched: true };
        }
        return {
          ok: false,
          code: 'save_failed',
          userId: item.userId,
          circleId: item.circleId,
          retryable: result.retryable,
          dispatched: true,
          outcomeUnknown: false,
        };
      })
      .catch((): OfficePreferenceWriteResult => ({
        ok: false,
        code: 'save_failed',
        userId: item.userId,
        circleId: item.circleId,
        retryable: true,
        dispatched: true,
        outcomeUnknown: false,
      }));

    let deadlineHandle: unknown = null;
    const deadlineOutcome = new Promise<OfficePreferenceWriteResult>((resolve) => {
      deadlineHandle = scheduler.schedule(() => {
        resolve({
          ok: false,
          code: 'deadline_exceeded',
          userId: item.userId,
          circleId: item.circleId,
          retryable: false,
          dispatched: true,
          outcomeUnknown: true,
        });
        controller.abort();
      }, deadlineMs);
    });

    const outcome = await Promise.race([transportOutcome, deadlineOutcome]);
    settleCaller(outcome);
    if (deadlineHandle !== null) scheduler.cancel(deadlineHandle);

    // A deadline bounds the caller, not mutation authority. Keep this exact
    // user/circle lane reserved until the dispatched transport settles so a
    // bridge/client that ignores AbortSignal cannot overlap and reorder a
    // later write.
    if (!outcome.ok && outcome.code === 'deadline_exceeded') {
      await transportPromise.then(
        () => undefined,
        () => undefined,
      );
    }
  };

  const enqueue = (input: OfficePreferenceWriteInput): Promise<OfficePreferenceWriteResult> => {
    const captured = captureInput(input);
    if (!captured.ok) {
      return Promise.resolve({
        ok: false,
        code: captured.code,
        retryable: false,
        dispatched: false,
        outcomeUnknown: false,
      });
    }

    const item = captured.item;
    if (disposed) {
      return Promise.resolve({
        ok: false,
        code: 'scope_retired',
        userId: item.userId,
        circleId: item.circleId,
        retryable: false,
        dispatched: false,
        outcomeUnknown: false,
      });
    }
    let settleCaller!: (result: OfficePreferenceWriteResult) => void;
    const callerResult = new Promise<OfficePreferenceWriteResult>((resolve) => {
      settleCaller = resolve;
    });
    const laneKey = `${item.userId}:${item.circleId}`;
    const previousTail = laneTails.get(laneKey) ?? Promise.resolve();
    const laneTail = previousTail
      .catch(() => undefined)
      .then(() => runCapturedItem(item, settleCaller))
      .catch(() => {
        settleCaller({
          ok: false,
          code: 'queue_failed',
          userId: item.userId,
          circleId: item.circleId,
          retryable: false,
          dispatched: true,
          outcomeUnknown: true,
        });
      });
    laneTails.set(laneKey, laneTail);
    void laneTail.finally(() => {
      if (laneTails.get(laneKey) === laneTail) laneTails.delete(laneKey);
    });
    return callerResult;
  };

  return {
    enqueue,
    getLaneCount: () => laneTails.size,
    dispose: () => { disposed = true; },
  };
}
