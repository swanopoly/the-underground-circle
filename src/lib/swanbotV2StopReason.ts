/**
 * swanbotV2StopReason — shared normalization of a swanbot-v2 run's terminal
 * stop reason into the four semantic buckets the readiness gate reasons about.
 *
 * The v2 edge function (supabase/functions/swanbot-v2-ai/index.ts) ends a run
 * in one of two shapes: a `terminal` result (carrying the model `stopReason`
 * plus a `hitMax` flag) or a `pending` result (paused awaiting a client-side
 * tool round). This classifier maps those into `end_turn | max_tokens |
 * client_pending | error` so the v1-vs-v2 readiness comparison
 * (swanbotOpenSwanReadiness.ts) reasons over the same vocabulary the edge
 * function writes to `agent_runs.final_stop_reason`.
 *
 * Pure module (no runtime imports). Edge code can't import it (Deno https
 * imports), so AR4 writes the equivalent literals directly into the edge update
 * calls; this module is the smoke-testable ground truth those literals match.
 */

export type V2StopReasonKind = 'terminal' | 'pending';

export type NormalizedStopReason = 'end_turn' | 'max_tokens' | 'client_pending' | 'error';

/**
 * Classify a v2 run's stop reason.
 *  - `pending`              -> `client_pending` (hitMax / modelStopReason ignored).
 *  - `terminal` + hitMax    -> `max_tokens` (edge forces this; precedence over modelStopReason).
 *  - `terminal`, no hitMax  -> normalized modelStopReason:
 *      end_turn | stop_sequence -> end_turn
 *      max_tokens               -> max_tokens
 *      everything else / tool_use / empty / null -> error (defensive)
 */
export function classifyV2StopReason(args: {
  kind: V2StopReasonKind;
  hitMax: boolean;
  modelStopReason?: string | null;
}): NormalizedStopReason {
  if (args.kind === 'pending') return 'client_pending';
  if (args.hitMax) return 'max_tokens';

  const reason = (args.modelStopReason ?? '').trim().toLowerCase();
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    default:
      // 'tool_use' should never reach a terminal (the loop would continue),
      // and any unknown/empty/'error' value is a defensive error signal.
      return 'error';
  }
}
