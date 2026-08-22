import type { OfficeFloor } from './officeConfig';
import { validateOfficeLayout } from './officeValidation';

export const OFFICE_LAYOUT_LOCAL_CACHE_PREFIX = '@office_layout_cache_v2:';
export const OFFICE_LAYOUT_LOCAL_CACHE_VERSION = 2 as const;

export interface OfficeLayoutLocalCacheEnvelope {
  schemaVersion: typeof OFFICE_LAYOUT_LOCAL_CACHE_VERSION;
  userId: string;
  circleId: string;
  floors: OfficeFloor[];
  currentFloorId: string;
  updatedAt: number;
}

export type OfficeLayoutLocalCacheWrite = Omit<OfficeLayoutLocalCacheEnvelope, 'schemaVersion'>;

export interface OfficeLayoutLocalCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

const OFFICE_LAYOUT_VERSION_MAX_FUTURE_MS = 5 * 60 * 1000;
const OFFICE_LAYOUT_LOCAL_CACHE_OPERATION_DEADLINE_MS = 10_000;

class OfficeLayoutLocalCacheDeadlineError extends Error {
  constructor(timeoutMs: number) {
    super(`Office layout local-cache operation exceeded its ${timeoutMs}ms deadline.`);
    this.name = 'OfficeLayoutLocalCacheDeadlineError';
  }
}

async function runOfficeLayoutLocalCacheOperationWithDeadline<T>(
  operation: () => PromiseLike<T>,
  timeoutMs: number,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new OfficeLayoutLocalCacheDeadlineError(0);
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new OfficeLayoutLocalCacheDeadlineError(timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isUsableOfficeLayoutVersion(version: unknown, nowMs: number = Date.now()): version is number {
  return typeof version === 'number'
    && Number.isSafeInteger(version)
    && version > 0
    && Number.isSafeInteger(nowMs)
    && version <= nowMs + OFFICE_LAYOUT_VERSION_MAX_FUTURE_MS;
}

function boundedId(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

export function officeLayoutLocalCacheKey(userId: string, circleId: string): string {
  return `${OFFICE_LAYOUT_LOCAL_CACHE_PREFIX}${boundedId(userId)}:${boundedId(circleId)}`;
}

export function readOfficeLayoutLocalCacheEnvelope(
  raw: unknown,
  expectedUserId: string,
  expectedCircleId: string,
): OfficeLayoutLocalCacheEnvelope | null {
  let decoded: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw || raw.length > 1_000_000) return null;
    try { decoded = JSON.parse(raw); } catch { return null; }
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) return null;
  const candidate = decoded as Record<string, unknown>;
  const userId = boundedId(candidate.userId);
  const circleId = boundedId(candidate.circleId);
  const expectedUser = boundedId(expectedUserId);
  const expectedCircle = boundedId(expectedCircleId);
  if (
    candidate.schemaVersion !== OFFICE_LAYOUT_LOCAL_CACHE_VERSION
    || !userId
    || !circleId
    || userId !== expectedUser
    || circleId !== expectedCircle
  ) return null;
  const validation = validateOfficeLayout(candidate);
  if (!validation.valid || !validation.sanitizedLayout) return null;
  const sanitized = validation.sanitizedLayout as Record<string, unknown>;
  const updatedAt = sanitized.updatedAt;
  if (!isUsableOfficeLayoutVersion(updatedAt)) return null;
  return {
    schemaVersion: OFFICE_LAYOUT_LOCAL_CACHE_VERSION,
    userId,
    circleId,
    floors: sanitized.floors as OfficeFloor[],
    currentFloorId: String(sanitized.currentFloorId || ''),
    updatedAt,
  };
}

export function serializeOfficeLayoutLocalCacheEnvelope(input: {
  userId: string;
  circleId: string;
  floors: OfficeFloor[];
  currentFloorId: string;
  updatedAt: number;
}): string | null {
  const userId = boundedId(input.userId);
  const circleId = boundedId(input.circleId);
  const validation = validateOfficeLayout(input);
  if (!userId || !circleId || !isUsableOfficeLayoutVersion(input.updatedAt)
    || !validation.valid || !validation.sanitizedLayout) return null;
  return JSON.stringify({
    schemaVersion: OFFICE_LAYOUT_LOCAL_CACHE_VERSION,
    userId,
    circleId,
    ...validation.sanitizedLayout,
  });
}

export async function writeVerifiedOfficeLayoutLocalCache(
  storage: OfficeLayoutLocalCacheStorage,
  input: OfficeLayoutLocalCacheWrite,
  timeoutMs = OFFICE_LAYOUT_LOCAL_CACHE_OPERATION_DEADLINE_MS,
): Promise<boolean> {
  return runOfficeLayoutLocalCacheOperationWithDeadline(
    () => writeAndVerifyOfficeLayoutLocalCache(storage, input),
    timeoutMs,
  ).catch(() => false);
}

async function writeAndVerifyOfficeLayoutLocalCache(
  storage: OfficeLayoutLocalCacheStorage,
  input: OfficeLayoutLocalCacheWrite,
): Promise<boolean> {
  const serialized = serializeOfficeLayoutLocalCacheEnvelope(input);
  if (!serialized) return false;
  const key = officeLayoutLocalCacheKey(input.userId, input.circleId);
  try {
    await storage.setItem(key, serialized);
    const roundTrip = await storage.getItem(key);
    if (roundTrip !== serialized) return false;
    const verified = readOfficeLayoutLocalCacheEnvelope(roundTrip, input.userId, input.circleId);
    return Boolean(verified && verified.updatedAt === Math.floor(input.updatedAt));
  } catch {
    return false;
  }
}

/**
 * Serialize local layout writes per exact user/circle. A caller receives a
 * bounded false result when storage stalls, but the same-scope lane remains
 * reserved until that unabortable operation actually settles. That prevents a
 * late timed-out write from overwriting a newer cache snapshot. An unrelated
 * user/circle owns an independent lane and is never blocked by the stall.
 */
export function createOfficeLayoutLocalWriteQueue(
  storage: OfficeLayoutLocalCacheStorage,
  operationTimeoutMs = OFFICE_LAYOUT_LOCAL_CACHE_OPERATION_DEADLINE_MS,
): {
  enqueue(input: OfficeLayoutLocalCacheWrite): Promise<boolean>;
} {
  const laneTails = new Map<string, Promise<void>>();
  return {
    enqueue(input) {
      const laneKey = officeLayoutLocalCacheKey(input.userId, input.circleId);
      const prior = laneTails.get(laneKey) ?? Promise.resolve();
      const operation = prior.then(() => writeAndVerifyOfficeLayoutLocalCache(storage, input));
      const tail = operation.then(() => undefined, () => undefined);
      laneTails.set(laneKey, tail);
      void tail.then(() => {
        if (laneTails.get(laneKey) === tail) laneTails.delete(laneKey);
      });
      return runOfficeLayoutLocalCacheOperationWithDeadline(
        () => operation,
        operationTimeoutMs,
      ).catch(() => false);
    },
  };
}
