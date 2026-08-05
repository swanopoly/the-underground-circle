/**
 * useResilientSubscription — a thin React wrapper that gives ANY Supabase
 * Realtime channel automatic reconnect + silent-staleness recovery, so a
 * dropped socket surfaces and heals instead of freezing a board forever
 * (next-gaps FINDING 1).
 *
 * ─── Why this exists ──────────────────────────────────────────────────────
 * The app opens ~76 realtime `.subscribe()` channels, but only `agentPresence.ts`
 * ever handles a channel drop. After a network blip, laptop sleep/wake, or a
 * Supabase socket timeout every OTHER channel silently stops delivering events
 * and its surface shows stale data with no error and no recovery. This hook
 * lifts presence's battle-tested reconnect/backoff shape into a reusable place
 * so a bare `supabase.channel(...).on(...).subscribe()` site can adopt recovery
 * by moving its `.on(...)` wiring into `setup` and calling this hook.
 *
 * ─── Division of labour (thin wrapper) ────────────────────────────────────
 * ALL decisions come from the pure, deterministic core
 * (`src/lib/resilientSubscriptionCore.ts`):
 *   • normalizeSubscriptionState — raw Supabase status → canonical state.
 *   • planReconnect              — should we reconnect, and after what backoff?
 *   • assessSubscriptionHealth   — is a "subscribed" channel actually silent
 *                                  past its heartbeat window (silent-staleness)?
 *   • describeHealth             — one-line human status label (dev log here;
 *                                  consumers can call it on the returned health).
 * This file only does the impure plumbing the core deliberately refuses to do:
 * create the channel, run the caller's `setup`, `.subscribe()`, own the
 * setTimeout/setInterval timers, add reconnect JITTER (the core is jitter-free
 * on purpose — it says jitter is the caller's), refresh the realtime auth token
 * on (re)connect via the safe auth helper, and tear everything down cleanly.
 *
 * ─── Silent-staleness → catch-up refetch ──────────────────────────────────
 * A heartbeat interval asks the core whether the channel has gone silent while
 * still reporting "subscribed". When it has (`health.staleMs != null`) and an
 * `onEvent` catch-up handler was supplied, we fire it (a refetch) and reset the
 * freshness clock — turning a silently-dead socket into, at worst, a periodic
 * poll (matching the app's 30s poll floor) instead of a frozen surface. Real
 * incoming events keep the clock fresh (we wrap `.on` so every caller listener
 * bumps it), so a HEALTHY realtime channel never triggers a redundant refetch.
 *
 * ─── Teardown is intentional; the core is not consulted on purpose-close ───
 * On unmount or `enabled === false` we clear timers and `removeChannel`, and a
 * per-run `cancelled` flag guards every async continuation so a late auth
 * refresh, a queued reconnect, or a heartbeat tick can never resurrect a
 * closed channel (the StrictMode / rapid-remount zombie `agentPresence`
 * documents).
 */

import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getFreshAccessToken } from '../lib/authSession';
import {
  planReconnect,
  assessSubscriptionHealth,
  normalizeSubscriptionState,
  describeHealth,
  DEFAULT_HEARTBEAT_MS,
  type SubscriptionState,
  type SubscriptionHealth,
} from '../lib/resilientSubscriptionCore';

export interface UseResilientSubscriptionOptions {
  /** Stable channel name passed to `supabase.channel(name)`. Changing it (or
   *  toggling `enabled`) tears down and re-establishes the subscription. */
  channelName: string;
  /**
   * Attach your listeners to the channel and return it, e.g.
   *   setup: (ch) => ch
   *     .on('postgres_changes', { event: '*', schema: 'public', table: 'foo' }, onRow)
   * Do NOT call `.subscribe()` here — the hook owns subscribe (and re-subscribe).
   * Every listener you attach here also refreshes the freshness clock, so a live
   * channel is never mistaken for stale.
   */
  setup: (channel: RealtimeChannel) => RealtimeChannel;
  /** Catch-up refetch fired when a "subscribed" channel goes silent past the
   *  heartbeat window (silent-staleness). Omit it to detect staleness (visible
   *  in `health`) without an automatic refetch. */
  onEvent?: () => void;
  /** Silence window (ms) before a subscribed-but-silent channel is judged stale.
   *  Defaults to the core's 30s. The health CHECK runs about twice per window. */
  heartbeatMs?: number;
  /** Set false to keep the subscription torn down (e.g. no circle selected). */
  enabled?: boolean;
}

export interface UseResilientSubscriptionResult {
  /** Canonical current channel state (fail-visible: error/closed/reconnecting). */
  state: SubscriptionState;
  /** Full health record from the core, incl. consecutiveFailures + staleMs.
   *  Render `describeHealth(health)` for a live/reconnecting/stale strip. */
  health: SubscriptionHealth;
  /** Total reconnect attempts scheduled for the current channel epoch. */
  reconnectCount: number;
}

const IDLE_HEALTH: SubscriptionHealth = {
  state: 'connecting',
  consecutiveFailures: 0,
  lastEventMs: null,
  staleMs: null,
};

/** Small randomized spread added to the core's deterministic backoff so ~76
 *  channels dropped by the same blip don't reconnect in one thundering herd.
 *  Mirrors agentPresence's `Math.random() * 1000` jitter. */
const MAX_RECONNECT_JITTER_MS = 1_000;

export function useResilientSubscription(
  opts: UseResilientSubscriptionOptions,
): UseResilientSubscriptionResult {
  const { channelName, heartbeatMs } = opts;
  const enabled = opts.enabled !== false;

  const [state, setState] = useState<SubscriptionState>('connecting');
  const [health, setHealth] = useState<SubscriptionHealth>(IDLE_HEALTH);
  const [reconnectCount, setReconnectCount] = useState(0);

  // Latest callbacks kept in refs so their (changing) identity never re-runs
  // the subscription effect — only channelName/enabled/heartbeatMs do.
  const setupRef = useRef(opts.setup);
  setupRef.current = opts.setup;
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;

  // Cross-render mutable state read inside timer/status closures.
  const failuresRef = useRef(0); // consecutive failures; resets on 'subscribed'
  const lastEventRef = useRef<number | null>(null); // epoch ms of last real event
  const currentStateRef = useRef<SubscriptionState>('connecting');
  const reconnectCountRef = useRef(0);
  const healthRef = useRef<SubscriptionHealth>(IDLE_HEALTH);

  useEffect(() => {
    // Intentional teardown branch: nothing to subscribe. Surface it as offline
    // and stop consulting the core entirely.
    if (!enabled || !channelName) {
      failuresRef.current = 0;
      lastEventRef.current = null;
      currentStateRef.current = 'closed';
      const closed: SubscriptionHealth = {
        state: 'closed',
        consecutiveFailures: 0,
        lastEventMs: null,
        staleMs: null,
      };
      healthRef.current = closed;
      setState('closed');
      setHealth(closed);
      return;
    }

    // Per-run cancellation token: the authoritative "is this effect still the
    // live one" flag. A late auth refresh / queued reconnect / heartbeat tick
    // all bail on it, so a torn-down or superseded run can never resurrect a
    // channel (StrictMode double-invoke, rapid remount).
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const windowMs = typeof heartbeatMs === 'number' && heartbeatMs > 0
      ? heartbeatMs
      : DEFAULT_HEARTBEAT_MS;
    // Check ~twice per window so staleness is caught within ~1.5x the window
    // (the core's recommended window≈1.5–2x interval), floored at 1s.
    const intervalMs = Math.max(1_000, Math.floor(windowMs / 2));

    // Emit health only when it actually changed — avoids a re-render every tick.
    const emitHealth = (h: SubscriptionHealth) => {
      const p = healthRef.current;
      if (
        p.state === h.state &&
        p.consecutiveFailures === h.consecutiveFailures &&
        p.lastEventMs === h.lastEventMs &&
        p.staleMs === h.staleMs
      ) {
        return;
      }
      healthRef.current = h;
      setHealth(h);
    };

    const applyState = (s: SubscriptionState) => {
      currentStateRef.current = s;
      setState(s);
      emitHealth(
        assessSubscriptionHealth({
          state: s,
          lastEventMs: lastEventRef.current,
          nowMs: Date.now(),
          heartbeatMs: windowMs,
          consecutiveFailures: failuresRef.current,
        }),
      );
    };

    const scheduleReconnect = (delayMs: number) => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        reconnect();
      }, delayMs);
    };

    // Supabase `.subscribe()` status callback. Feed the raw status through the
    // core to decide reconnect + backoff; the hook only schedules the timer.
    const handleStatus = (status: unknown) => {
      if (cancelled) return;
      const s = normalizeSubscriptionState(status);

      if (s === 'subscribed') {
        failuresRef.current = 0;
        lastEventRef.current = Date.now(); // fresh baseline so we aren't instantly stale
        applyState('subscribed');
        return;
      }

      // Any non-subscribed status: ask the core whether it warrants a reconnect
      // and (if so) after what backoff, using the would-be next failure count so
      // the delay grows per attempt exactly like agentPresence.
      const nextFailures = failuresRef.current + 1;
      const plan = planReconnect({
        state: s,
        consecutiveFailures: nextFailures,
        nowMs: Date.now(),
      });
      applyState(s);

      if (plan.shouldReconnect) {
        failuresRef.current = nextFailures;
        reconnectCountRef.current += 1;
        setReconnectCount(reconnectCountRef.current);
        const jitter = Math.floor(Math.random() * MAX_RECONNECT_JITTER_MS);
        if (__DEV__) {
          console.log(
            `[useResilientSubscription] ${channelName}: ${describeHealth(healthRef.current)} — ${plan.reason}`,
          );
        }
        scheduleReconnect(plan.delayMs + jitter);
      }
    };

    const connect = async () => {
      if (cancelled) return;

      // Refresh the realtime socket's auth token before (re)subscribing. After
      // laptop sleep / near-expiry the cached socket token can be stale, which
      // makes an RLS channel reconnect "succeed" but deliver zero events — a
      // silent-staleness cause. getFreshAccessToken forces an inline refresh.
      try {
        const token = await getFreshAccessToken();
        const rt: any = (supabase as any).realtime;
        if (token && rt && typeof rt.setAuth === 'function') {
          await rt.setAuth(token);
        }
      } catch {
        // Non-fatal — fall through and subscribe with whatever the client holds.
      }
      if (cancelled) return;

      const raw = supabase.channel(channelName);

      // Wrap `.on` so every listener the caller attaches in `setup` also bumps
      // the freshness clock. Supabase returns `this` from `.on`, so chained
      // `.on(...).on(...)` stays on this same wrapped instance. This is what
      // keeps a HEALTHY channel from ever being judged stale.
      try {
        const originalOn = raw.on.bind(raw) as (...a: any[]) => any;
        (raw as any).on = (...args: any[]) => {
          const cb = args[args.length - 1];
          if (typeof cb === 'function') {
            const fn = cb as (...a: any[]) => any;
            args[args.length - 1] = (...cbArgs: any[]) => {
              lastEventRef.current = Date.now();
              return fn(...cbArgs);
            };
          }
          return originalOn(...args);
        };
      } catch {
        // If wrapping fails, staleness falls back to the heartbeat-poll model.
      }

      let configured: RealtimeChannel = raw;
      try {
        const ret = setupRef.current?.(raw);
        if (ret) configured = ret;
      } catch (err) {
        console.error('[useResilientSubscription] setup error:', err);
      }
      channel = configured;
      applyState('connecting');

      try {
        configured.subscribe((status) => handleStatus(status));
      } catch (err) {
        console.error('[useResilientSubscription] subscribe error:', err);
        handleStatus('CHANNEL_ERROR');
      }
    };

    const reconnect = () => {
      if (cancelled) return;
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {}
        channel = null;
      }
      applyState('reconnecting');
      void connect();
    };

    // Heartbeat: detect the silent-staleness case and fire the catch-up refetch.
    // Only a 'subscribed'-but-silent channel yields staleMs != null (the core
    // stays quiet for error/closed/reconnecting/connecting — those already show
    // an actionable state), so we never refetch while actively reconnecting.
    const heartbeatTimer = setInterval(() => {
      if (cancelled) return;
      const h = assessSubscriptionHealth({
        state: currentStateRef.current,
        lastEventMs: lastEventRef.current,
        nowMs: Date.now(),
        heartbeatMs: windowMs,
        consecutiveFailures: failuresRef.current,
      });
      emitHealth(h);
      if (h.staleMs != null && onEventRef.current) {
        lastEventRef.current = Date.now(); // catch-up performed; restart the window
        try {
          onEventRef.current();
        } catch (err) {
          console.error('[useResilientSubscription] onEvent (catch-up) error:', err);
        }
      }
    }, intervalMs);

    // Kick off a fresh epoch.
    failuresRef.current = 0;
    lastEventRef.current = null;
    reconnectCountRef.current = 0;
    healthRef.current = IDLE_HEALTH;
    currentStateRef.current = 'connecting';
    setState('connecting');
    setHealth(IDLE_HEALTH);
    setReconnectCount(0);
    void connect();

    return () => {
      cancelled = true;
      clearInterval(heartbeatTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {}
        channel = null;
      }
    };
  }, [channelName, enabled, heartbeatMs]);

  return { state, health, reconnectCount };
}
