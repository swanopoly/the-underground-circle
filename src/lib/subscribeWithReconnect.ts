/**
 * subscribeWithReconnect — the NON-React sibling of the useResilientSubscription
 * hook: gives any Supabase Realtime channel automatic reconnect + silent-staleness
 * recovery for call sites that live OUTSIDE a React component (plain lib functions
 * like agentRunSystem.subscribeToCircleRuns) or inside an existing `useEffect`
 * where dropping in a wrapper is less invasive than restructuring to the hook
 * (next-gaps FINDING 1).
 *
 * Same division of labour as the hook: ALL decisions come from the pure core
 * `src/lib/resilientSubscriptionCore.ts` (normalizeSubscriptionState / planReconnect
 * / assessSubscriptionHealth); this file only does the impure plumbing — create
 * the channel, run the caller's `setup`, own the reconnect/heartbeat timers, add
 * reconnect jitter, refresh the realtime auth token on (re)connect, wrap `.on` so
 * live events keep the freshness clock fresh, and tear down cleanly.
 *
 * Catch-up semantics: `onCatchUp` fires (a) after a RE-subscribe — backfilling the
 * rows missed while the socket was down — and (b) when a subscribed-but-silent
 * channel crosses the staleness window. It deliberately does NOT fire on the FIRST
 * subscribe (the caller already did its initial fetch), so adoption is drop-in.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { getFreshAccessToken } from './authSession';
import {
  planReconnect,
  assessSubscriptionHealth,
  normalizeSubscriptionState,
  DEFAULT_HEARTBEAT_MS,
  type SubscriptionState,
  type SubscriptionHealth,
} from './resilientSubscriptionCore';

export interface ResilientSubscriptionHandle {
  /** Idempotent teardown: clears timers + removes the channel; safe to call in a
   *  `useEffect` cleanup or an unmount path. */
  unsubscribe: () => void;
  /** The CURRENT underlying channel, for call sites that also `.send()` on it
   *  (broadcast). Must be read per-send, never cached: reconnect replaces the
   *  channel object, so a captured reference would send into a dead channel.
   *  Null before the first connect and after `unsubscribe()`. */
  getChannel: () => RealtimeChannel | null;
}

export interface SubscribeWithReconnectOptions {
  /** Stable channel name for `supabase.channel(name)`. */
  channelName: string;
  /** Optional `supabase.channel(name, opts)` config, re-applied on every
   *  reconnect. Required for broadcast channels that rely on `{ self: true }`
   *  or presence keys — dropping it on reconnect would silently change the
   *  channel's semantics after the first drop. */
  channelConfig?: Parameters<typeof supabase.channel>[1];
  /** Attach listeners and return the channel; do NOT call `.subscribe()` here. */
  setup: (channel: RealtimeChannel) => RealtimeChannel;
  /** Catch-up refetch on re-subscribe + on silent-staleness. Omit to only reconnect. */
  onCatchUp?: () => void;
  /** Silence window (ms) before a subscribed-but-silent channel is judged stale. */
  heartbeatMs?: number;
  /** Optional observer for the canonical state + health (e.g. a status strip). */
  onStateChange?: (state: SubscriptionState, health: SubscriptionHealth) => void;
}

/** Randomized spread on the core's deterministic backoff so many channels dropped
 *  by one blip don't reconnect in a thundering herd. Mirrors agentPresence. */
const MAX_RECONNECT_JITTER_MS = 1_000;

export function subscribeWithReconnect(
  opts: SubscribeWithReconnectOptions,
): ResilientSubscriptionHandle {
  const { channelName } = opts;

  let cancelled = false;
  let channel: RealtimeChannel | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0; // consecutive failures; resets on 'subscribed'
  let lastEventMs: number | null = null;
  let currentState: SubscriptionState = 'connecting';
  let epoch = 0; // 0 = initial connect; >0 = a reconnect (catch-up on subscribe)
  let healthPrev: SubscriptionHealth | null = null;

  const windowMs = typeof opts.heartbeatMs === 'number' && opts.heartbeatMs > 0
    ? opts.heartbeatMs
    : DEFAULT_HEARTBEAT_MS;
  const intervalMs = Math.max(1_000, Math.floor(windowMs / 2));

  const observe = (state: SubscriptionState) => {
    currentState = state;
    const h = assessSubscriptionHealth({
      state,
      lastEventMs,
      nowMs: Date.now(),
      heartbeatMs: windowMs,
      consecutiveFailures: failures,
    });
    if (
      opts.onStateChange &&
      (!healthPrev ||
        healthPrev.state !== h.state ||
        healthPrev.consecutiveFailures !== h.consecutiveFailures ||
        healthPrev.staleMs !== h.staleMs)
    ) {
      healthPrev = h;
      try { opts.onStateChange(state, h); } catch { /* observer must never break the sub */ }
    }
  };

  const scheduleReconnect = (delayMs: number) => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; reconnect(); }, delayMs);
  };

  const handleStatus = (status: unknown) => {
    if (cancelled) return;
    const s = normalizeSubscriptionState(status);
    if (s === 'subscribed') {
      failures = 0;
      lastEventMs = Date.now();
      observe('subscribed');
      // Catch-up only after a RECONNECT (epoch>0) — the first subscribe rides the
      // caller's own initial fetch, so we don't double-fetch on mount.
      if (epoch > 0 && opts.onCatchUp) {
        try { opts.onCatchUp(); } catch (err) { console.error('[subscribeWithReconnect] catch-up error:', err); }
      }
      return;
    }
    const nextFailures = failures + 1;
    const plan = planReconnect({ state: s, consecutiveFailures: nextFailures, nowMs: Date.now() });
    observe(s);
    if (plan.shouldReconnect) {
      failures = nextFailures;
      scheduleReconnect(plan.delayMs + Math.floor(Math.random() * MAX_RECONNECT_JITTER_MS));
    }
  };

  const connect = async () => {
    if (cancelled) return;
    // Refresh the realtime auth token before (re)subscribing — a stale cached token
    // after sleep/near-expiry makes an RLS channel reconnect "succeed" but deliver
    // zero events (a silent-staleness cause).
    try {
      const token = await getFreshAccessToken();
      const rt: any = (supabase as any).realtime;
      if (token && rt && typeof rt.setAuth === 'function') await rt.setAuth(token);
    } catch { /* non-fatal — subscribe with whatever the client holds */ }
    if (cancelled) return;

    const raw = opts.channelConfig
      ? supabase.channel(channelName, opts.channelConfig)
      : supabase.channel(channelName);
    // Wrap `.on` so every listener the caller attaches also bumps the freshness
    // clock — keeps a HEALTHY channel from ever being judged stale.
    try {
      const originalOn = raw.on.bind(raw) as (...a: any[]) => any;
      (raw as any).on = (...args: any[]) => {
        const cb = args[args.length - 1];
        if (typeof cb === 'function') {
          const fn = cb as (...a: any[]) => any;
          args[args.length - 1] = (...cbArgs: any[]) => { lastEventMs = Date.now(); return fn(...cbArgs); };
        }
        return originalOn(...args);
      };
    } catch { /* falls back to heartbeat-poll staleness */ }

    let configured: RealtimeChannel = raw;
    try {
      const ret = opts.setup?.(raw);
      if (ret) configured = ret;
    } catch (err) {
      console.error('[subscribeWithReconnect] setup error:', err);
    }
    channel = configured;
    observe('connecting');
    try {
      configured.subscribe((status) => handleStatus(status));
    } catch (err) {
      console.error('[subscribeWithReconnect] subscribe error:', err);
      handleStatus('CHANNEL_ERROR');
    }
  };

  const reconnect = () => {
    if (cancelled) return;
    if (channel) { try { supabase.removeChannel(channel); } catch { /* ignore */ } channel = null; }
    epoch += 1;
    observe('reconnecting');
    void connect();
  };

  const heartbeatTimer = setInterval(() => {
    if (cancelled) return;
    const h = assessSubscriptionHealth({
      state: currentState,
      lastEventMs,
      nowMs: Date.now(),
      heartbeatMs: windowMs,
      consecutiveFailures: failures,
    });
    if (opts.onStateChange && (!healthPrev || healthPrev.staleMs !== h.staleMs || healthPrev.state !== h.state)) {
      healthPrev = h;
      try { opts.onStateChange(currentState, h); } catch { /* ignore */ }
    }
    if (h.staleMs != null && opts.onCatchUp) {
      lastEventMs = Date.now(); // catch-up performed; restart the window
      try { opts.onCatchUp(); } catch (err) { console.error('[subscribeWithReconnect] stale catch-up error:', err); }
    }
  }, intervalMs);

  void connect();

  return {
    unsubscribe: () => {
      cancelled = true;
      clearInterval(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) { try { supabase.removeChannel(channel); } catch { /* ignore */ } channel = null; }
    },
    getChannel: () => (cancelled ? null : channel),
  };
}
