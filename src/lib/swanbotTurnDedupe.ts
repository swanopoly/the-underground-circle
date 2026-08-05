import { isCacheableTurnResult } from './turnCachePolicyCore';

export type SwanBotTurnDedupeKind = 'text' | 'structured';

export type SwanBotTurnDedupeContext = {
  userId?: string;
  circleId?: string;
  agentId?: string;
  agentName?: string;
  spiritId?: string | null;
  model?: string | null;
  modeKey?: string | null;
  taskKind?: string | null;
  sessionProfile?: string | null;
  thinkingLevel?: string;
  conversationMessages?: Array<{ role: string; content: string }>;
  buildState?: string;
  buildConverging?: boolean;
};

export const SWANBOT_TURN_DEDUPE_TTL_MS = 15_000;

const inFlightSwanBotTurns: Map<string, { startedAt: number; promise: Promise<unknown> }> = new Map();
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
    modeKey: context.modeKey || '',
    taskKind: context.taskKind || '',
    sessionProfile: context.sessionProfile || '',
    thinkingLevel: context.thinkingLevel || '',
    buildState: context.buildState || '',
    buildConverging: context.buildConverging === true,
    conversationTail: conversationTailFingerprint(context.conversationMessages),
    message: normalizeSwanBotTurnText(cleanedMessage),
  });
}

function pruneExpiredSwanBotTurns(now = Date.now()) {
  for (const [key, entry] of inFlightSwanBotTurns.entries()) {
    if (now - entry.startedAt > SWANBOT_TURN_DEDUPE_TTL_MS) {
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
  const now = Date.now();
  pruneExpiredSwanBotTurns(now);
  const key = buildSwanBotTurnDedupeKey(kind, cleanedMessage, context);
  const existing = inFlightSwanBotTurns.get(key);
  if (existing && now - existing.startedAt <= SWANBOT_TURN_DEDUPE_TTL_MS) {
    return existing.promise as Promise<T>;
  }
  const completed = completedSwanBotTurns.get(key);
  if (completed && now - completed.settledAt <= SWANBOT_TURN_DEDUPE_TTL_MS) {
    return Promise.resolve(completed.value as T);
  }

  const promise = Promise.resolve().then(runner);
  inFlightSwanBotTurns.set(key, { startedAt: now, promise });
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
