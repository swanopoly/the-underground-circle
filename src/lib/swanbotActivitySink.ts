// swanbotActivitySink — a tiny module-scoped bridge that lets the async
// SwanBot turn pipeline (swanbot.ts, which is react-native-tainted and can't
// touch React state) push a LIVE progress label to whatever UI is currently
// showing the typing indicator (ChatTab's setCurrentRunStep). Same
// module-scoped-store pattern as agentTodoStore.
//
// Why a sink instead of threading a callback through callSwanBotV2 →
// executeClientToolCalls: the label is purely cosmetic (never affects
// correctness), the v2 continuation loop is 4 signatures deep, and only ONE
// chat surface is ever visibly running a turn at a time. The sink keeps the
// hot path clean and is fail-soft by construction: a missing or throwing sink
// never affects the tool flow.
//
// Contract: the UI registers a sink on mount and clears it on unmount;
// producers call emitSwanBotActivity() freely. Every function is total and
// never throws.

type ActivitySink = (label: string) => void;

let currentSink: ActivitySink | null = null;

/** Register the UI's progress setter. Last registration wins (one visible
 *  chat surface at a time). Guarded — a bad argument is ignored. */
export function setSwanBotActivitySink(sink: ActivitySink | null | undefined): void {
  currentSink = typeof sink === 'function' ? sink : null;
}

/** Clear the sink. Pass the same fn you registered to avoid clobbering a
 *  newer surface's sink (no-op if it isn't the active one); omit to force. */
export function clearSwanBotActivitySink(sink?: ActivitySink | null): void {
  if (!sink || sink === currentSink) currentSink = null;
}

/** Push a live progress label to the UI. Best-effort: never throws, no-op
 *  when nothing is registered or the label is empty. */
export function emitSwanBotActivity(label: unknown): void {
  try {
    if (!currentSink) return;
    const text = typeof label === 'string' ? label.trim() : '';
    if (!text) return;
    currentSink(text.slice(0, 120));
  } catch {
    /* a UI sink throwing must never break the tool flow */
  }
}

/** True when a UI is listening — lets producers skip building a label. */
export function hasSwanBotActivitySink(): boolean {
  return currentSink !== null;
}
