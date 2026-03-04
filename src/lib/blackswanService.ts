/**
 * blackswanService.ts — Unified React hook + service layer for BlackSwan LLM.
 *
 * Provides:
 *   useBlackSwan()   — React hook with health polling, chat, stream
 *   blackswanMetrics — Simple usage tracker (not persisted)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BlackSwanMessage,
  BlackSwanOptions,
  CircleContext,
  buildCircleSystemPrompt,
  callBlackSwanStream,
  callWithFallback,
  isBlackSwanAvailable,
  invalidateHealthCache,
} from './blackswanLLM';

// ─── Types ───────────────────────────────────────────────────────────────────

export type BlackSwanStatus = 'local' | 'ollama' | 'cloud' | 'offline' | 'checking';

export interface BlackSwanMetrics {
  callCount:    number;
  totalTokens:  number;
  localCalls:   number;
  cloudCalls:   number;
  avgLatencyMs: number;
}

export interface UseBlackSwanReturn {
  status:      BlackSwanStatus;
  isAvailable: boolean;
  isLocal:     boolean;
  metrics:     BlackSwanMetrics;
  /** Blocking chat — resolves with full response */
  chat: (
    messages: BlackSwanMessage[],
    options?: BlackSwanOptions & { circleContext?: CircleContext },
  ) => Promise<{ content: string; backend: BlackSwanStatus }>;
  /** Streaming chat — calls onToken for each chunk, resolves when done */
  streamChat: (
    messages: BlackSwanMessage[],
    options: BlackSwanOptions & { circleContext?: CircleContext; signal?: AbortSignal },
    onToken: (token: string) => void,
    onDone:  (fullText: string) => void,
  ) => Promise<void>;
  /** Force re-check health */
  refresh: () => void;
}

// ─── Module-level metrics ────────────────────────────────────────────────────

const metrics: BlackSwanMetrics = {
  callCount:    0,
  totalTokens:  0,
  localCalls:   0,
  cloudCalls:   0,
  avgLatencyMs: 0,
};

function recordCall(backend: string, latencyMs: number, tokens = 0) {
  metrics.callCount++;
  metrics.totalTokens += tokens;
  if (backend === 'blackswan' || backend === 'ollama') metrics.localCalls++;
  else metrics.cloudCalls++;
  // Rolling average
  metrics.avgLatencyMs = Math.round(
    (metrics.avgLatencyMs * (metrics.callCount - 1) + latencyMs) / metrics.callCount,
  );
}

export function getBlackSwanMetrics(): Readonly<BlackSwanMetrics> {
  return { ...metrics };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

export function useBlackSwan(): UseBlackSwanReturn {
  const [status, setStatus] = useState<BlackSwanStatus>('checking');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async () => {
    invalidateHealthCache();
    const ok = await isBlackSwanAvailable();
    setStatus(ok ? 'local' : 'offline');
  }, []);

  useEffect(() => {
    checkHealth();
    timerRef.current = setInterval(checkHealth, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkHealth]);

  const chat = useCallback(
    async (
      messages: BlackSwanMessage[],
      options: BlackSwanOptions & { circleContext?: CircleContext } = {},
    ): Promise<{ content: string; backend: BlackSwanStatus }> => {
      const { circleContext, ...rest } = options;

      // Prepend circle-aware system prompt if context provided and no system msg already
      let msgs = messages;
      if (circleContext && !messages.find(m => m.role === 'system')) {
        msgs = [{ role: 'system', content: buildCircleSystemPrompt(circleContext) }, ...messages];
      }

      const start = Date.now();
      const { content, backend } = await callWithFallback(msgs, rest);
      const latency = Date.now() - start;
      recordCall(backend, latency);

      const mappedBackend: BlackSwanStatus =
        backend === 'blackswan' ? 'local'
        : backend === 'ollama'  ? 'ollama'
        : 'cloud';

      setStatus(backend === 'cloud' ? 'cloud' : 'local');
      return { content, backend: mappedBackend };
    },
    [],
  );

  const streamChat = useCallback(
    async (
      messages: BlackSwanMessage[],
      options: BlackSwanOptions & { circleContext?: CircleContext; signal?: AbortSignal } = {},
      onToken: (token: string) => void,
      onDone:  (fullText: string) => void,
    ): Promise<void> => {
      const { circleContext, ...rest } = options;

      let msgs = messages;
      if (circleContext && !messages.find(m => m.role === 'system')) {
        msgs = [{ role: 'system', content: buildCircleSystemPrompt(circleContext) }, ...messages];
      }

      const start = Date.now();
      await callBlackSwanStream(msgs, rest, onToken, (fullText) => {
        recordCall('blackswan', Date.now() - start);
        setStatus('local');
        onDone(fullText);
      });
    },
    [],
  );

  return {
    status,
    isAvailable: status === 'local' || status === 'ollama',
    isLocal:     status === 'local' || status === 'ollama',
    metrics:     getBlackSwanMetrics(),
    chat,
    streamChat,
    refresh:     checkHealth,
  };
}
