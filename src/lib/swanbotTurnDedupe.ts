import { isCacheableTurnResult } from './turnCachePolicyCore';

export type SwanBotTurnDedupeKind = 'text' | 'structured';

export type SwanBotTurnDedupeContext = {
  userId?: string;
  circleId?: string;
  agentId?: string;
  agentName?: string;
  spiritId?: string | null;
  model?: string | null;
  /** A sealed Chat dispatch cannot share a result produced by an unsealed tier ladder. */
  modelDispatchSealed?: boolean;
  modeKey?: string | null;
  taskKind?: string | null;
  sessionProfile?: string | null;
  threadId?: string | null;
  /** Immutable identity of the outer run/request that owns side effects. */
  turnDedupeScope?: string | null;
  forceClientToolLoop?: boolean;
  completionExpectation?: string | null;
  executionSurfaceGuard?: string | null;
  thinkingLevel?: string;
  conversationMessages?: Array<{ role: string; content: string }>;
  buildState?: string;
  buildConverging?: boolean;
};

export const SWANBOT_TURN_DEDUPE_TTL_MS = 15_000;

const inFlightSwanBotTurns: Map<string, {
  startedAt: number;
  protectedTurn: boolean;
  promise: Promise<unknown>;
}> = new Map();
const completedSwanBotTurns: Map<string, { settledAt: number; value: unknown }> = new Map();

export function normalizeSwanBotTurnText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function conversationTailFingerprint(messages: SwanBotTurnDedupeContext['conversationMessages']): string {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  return messages
    .slice(-4)
    .map(message => `${message.role}:${normalizeSwanBotTurnText(message.content).slice(0, 500)}`)
    .join('|');
}

export function buildSwanBotTurnDedupeKey(
  kind: SwanBotTurnDedupeKind,
  cleanedMessage: string,
  context: SwanBotTurnDedupeContext,
): string {
  return JSON.stringify({
    kind,
    userId: context.userId || 'unknown-user',
    circleId: context.circleId || 'no-circle',
    agentId: context.agentId || '',
    agentName: context.agentName || '',
    spiritId: context.spiritId || '',
    model: context.model || '',
    modelDispatchSealed: context.modelDispatchSealed === true,
    modeKey: context.modeKey || '',
    taskKind: context.taskKind || '',
    sessionProfile: context.sessionProfile || '',
    threadId: context.threadId || '',
    turnDedupeScope: context.turnDedupeScope || '',
    forceClientToolLoop: context.forceClientToolLoop === true,
    completionExpectation: context.completionExpectation || '',
    executionSurfaceGuard: context.executionSurfaceGuard || '',
    thinkingLevel: context.thinkingLevel || '',
    buildState: context.buildState || '',
    buildConverging: context.buildConverging === true,
    conversationTail: conversationTailFingerprint(context.conversationMessages),
    message: normalizeSwanBotTurnText(cleanedMessage),
  });
}

function requiresIsolatedExecutionScope(context: SwanBotTurnDedupeContext): boolean {
  return context.forceClientToolLoop === true
    || context.completionExpectation === 'verified_task'
    || Boolean(context.executionSurfaceGuard);
}

function pruneExpiredSwanBotTurns(now = Date.now()) {
  for (const [key, entry] of inFlightSwanBotTurns.entries()) {
    // Receipt-bearing computer runs may legitimately stay in Photoshop or
    // another native app longer than the short UI double-submit window. Their
    // in-flight claim must live until the owning promise settles; expiring it
    // would allow the same run to dispatch a second mutation after 15s.
    if (!entry.protectedTurn && now - entry.startedAt > SWANBOT_TURN_DEDUPE_TTL_MS) {
      inFlightSwanBotTurns.delete(key);
    }
  }
  for (const [key, entry] of completedSwanBotTurns.entries()) {
    if (now - entry.settledAt > SWANBOT_TURN_DEDUPE_TTL_MS) {
      completedSwanBotTurns.delete(key);
    }
  }
}

export function runSwanBotTurnWithDuplicateGuard<T>(
  kind: SwanBotTurnDedupeKind,
  cleanedMessage: string,
  context: SwanBotTurnDedupeContext,
  runner: () => Promise<T>,
): Promise<T> {
  const protectedTurn = requiresIsolatedExecutionScope(context);
  // A completed computer turn may carry mutation receipts. Never share that
  // proof across outer executions. Callers in these lanes must supply an
  // immutable run/request scope; older callers fail safe by bypassing both the
  // in-flight and settled caches instead of replaying another run's result.
  if (
    protectedTurn
    && !String(context.turnDedupeScope || '').trim()
  ) {
    return Promise.resolve().then(runner);
  }
  const now = Date.now();
  pruneExpiredSwanBotTurns(now);
  const key = buildSwanBotTurnDedupeKey(kind, cleanedMessage, context);
  const existing = inFlightSwanBotTurns.get(key);
  if (
    existing
    && (
      existing.protectedTurn
      || now - existing.startedAt <= SWANBOT_TURN_DEDUPE_TTL_MS
    )
  ) {
    return existing.promise as Promise<T>;
  }
  const completed = completedSwanBotTurns.get(key);
  if (completed && now - completed.settledAt <= SWANBOT_TURN_DEDUPE_TTL_MS) {
    return Promise.resolve(completed.value as T);
  }

  const promise = Promise.resolve().then(runner);
  inFlightSwanBotTurns.set(key, { startedAt: now, protectedTurn, promise });
  void promise.then(
    (value) => {
      if (inFlightSwanBotTurns.get(key)?.promise === promise) {
        inFlightSwanBotTurns.delete(key);
        // Only cache a GENUINE success. A failure/recovery/empty result was
        // previously cached for the full TTL, so immediately retrying a failed
        // message replayed the identical failure and the retry was a silent
        // no-op (backlog finding #6). Not caching it lets the retry re-run.
        if (isCacheableTurnResult(value)) {
          completedSwanBotTurns.set(key, { settledAt: Date.now(), value });
        }
      }
    },
    () => {
      if (inFlightSwanBotTurns.get(key)?.promise === promise) {
        inFlightSwanBotTurns.delete(key);
      }
    },
  );
  return promise;
}

export function __resetSwanBotTurnDedupeForTests() {
  inFlightSwanBotTurns.clear();
  completedSwanBotTurns.clear();
}

export function __getSwanBotInFlightTurnCountForTests(): number {
  pruneExpiredSwanBotTurns();
  return inFlightSwanBotTurns.size;
}

export function __getSwanBotCompletedTurnCountForTests(): number {
  pruneExpiredSwanBotTurns();
  return completedSwanBotTurns.size;
}
