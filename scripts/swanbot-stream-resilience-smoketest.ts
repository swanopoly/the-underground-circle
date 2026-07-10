/**
 * swanbot-stream-resilience-smoketest — pins the mid-stream SSE resilience
 * contract added to `src/lib/swanbotStream.ts`.
 *
 * `swanbotStream.ts` can't be imported under tsx — it top-level-imports the RN
 * Supabase client, which esbuild refuses to transform (same constraint the
 * `claude-retry-smoketest.ts` header documents for the Deno edge client). So
 * this smoke MIRRORS the two pure functions that are the single source of
 * truth for termination — `classifyStreamTermination` + `buildStreamResult` —
 * and drives a mocked SSE feed through a faithful mini-consumer that replays
 * the module's terminal branches. Keep the mirror in lock-step with the real
 * exported functions.
 *
 * Contract under test:
 *   - clean `done` event  → status 'complete',    incomplete=false, onDone fires
 *   - mid-stream `error`  → status 'interrupted',  incomplete=true,  onError fires
 *   - EOF w/o `done`      → status 'interrupted' ('truncated'),      onError fires
 *   - read throws         → status 'interrupted' ('broken_pipe' when partial
 *                           output had already been delivered, else 'truncated')
 *   - the stream is NEVER auto-retried after an interruption (partial output
 *     already emitted can't be un-emitted) and complete ≠ interrupted always.
 *
 * Run: `npm run smoke:swanbot-stream-resilience`
 */

// ─── Mirror of src/lib/swanbotStream.ts pure termination logic ──────────────

type StreamTerminalStatus = 'complete' | 'interrupted';
type StreamInterruptReason = 'error_event' | 'broken_pipe' | 'truncated';
type StreamTerminationSignal = 'done_event' | 'error_event' | 'eof_no_done' | 'read_threw';
interface StreamToolUse { id: string; name: string; input: unknown }
interface StreamChatResult {
  toolUses: StreamToolUse[];
  stopReason: string | null;
  status: StreamTerminalStatus;
  incomplete: boolean;
  interruptReason?: StreamInterruptReason;
}

function classifyStreamTermination(
  signal: StreamTerminationSignal,
  sawAnyOutput: boolean,
): { status: StreamTerminalStatus; interruptReason?: StreamInterruptReason } {
  switch (signal) {
    case 'done_event':
      return { status: 'complete' };
    case 'error_event':
      return { status: 'interrupted', interruptReason: 'error_event' };
    case 'eof_no_done':
      return { status: 'interrupted', interruptReason: 'truncated' };
    case 'read_threw':
      return { status: 'interrupted', interruptReason: sawAnyOutput ? 'broken_pipe' : 'truncated' };
  }
}

function buildStreamResult(
  classification: { status: StreamTerminalStatus; interruptReason?: StreamInterruptReason },
  fields: { toolUses: StreamToolUse[]; stopReason: string | null },
): StreamChatResult {
  return {
    toolUses: fields.toolUses,
    stopReason: fields.stopReason,
    status: classification.status,
    incomplete: classification.status === 'interrupted',
    ...(classification.interruptReason ? { interruptReason: classification.interruptReason } : {}),
  };
}

// ─── Mocked SSE feed + faithful mini-consumer ───────────────────────────────
//
// A mock feed is a list of "frames". The consumer walks them exactly like the
// real reader loop: `delta` accumulates + marks output, `done` finishes clean,
// `error` interrupts, and a frame that models the socket dying (EOF or throw)
// takes the corresponding terminal branch. Exactly one terminal callback fires.

type Frame =
  | { kind: 'delta'; text: string }
  | { kind: 'done'; stopReason?: string | null }
  | { kind: 'error'; message?: string }
  | { kind: 'eof' }        // reader returns done:true with no prior `done` event
  | { kind: 'throw'; message?: string }; // read() rejects mid-stream

interface ConsumeOutcome {
  deltas: string[];
  onDoneCalls: StreamChatResult[];
  onErrorCalls: Array<{ message: string; result?: StreamChatResult }>;
  streamAttempts: number; // how many times the feed was consumed (retry detector)
}

/** Drive one feed through the mirrored terminal logic. Fires exactly one of
 *  onDone / onError, mirroring the real `settled` guard. */
function consumeFeed(frames: Frame[], out: ConsumeOutcome) {
  out.streamAttempts += 1;
  const toolUses: StreamToolUse[] = [];
  let stopReason: string | null = null;
  let sawAnyOutput = false;
  let settled = false;

  const finishComplete = () => {
    if (settled) return;
    settled = true;
    const result = buildStreamResult(classifyStreamTermination('done_event', sawAnyOutput), { toolUses, stopReason });
    out.onDoneCalls.push(result);
  };
  const finishInterrupted = (message: string, signal: Exclude<StreamTerminationSignal, 'done_event'>) => {
    if (settled) return;
    settled = true;
    const result = buildStreamResult(classifyStreamTermination(signal, sawAnyOutput), { toolUses, stopReason });
    out.onErrorCalls.push({ message, result });
  };

  for (const f of frames) {
    if (settled) break;
    switch (f.kind) {
      case 'delta':
        sawAnyOutput = true;
        out.deltas.push(f.text);
        break;
      case 'done':
        if (typeof f.stopReason === 'string') stopReason = f.stopReason;
        finishComplete();
        return;
      case 'error':
        finishInterrupted(f.message || 'Stream error', 'error_event');
        return;
      case 'throw':
        finishInterrupted(f.message || 'Stream failed', 'read_threw');
        return;
      case 'eof':
        break; // fall out of the loop → EOF branch below
    }
  }
  // Reader hit EOF (loop ended) without a terminal `done`.
  if (!settled) finishInterrupted('Stream ended before completion (no terminal event)', 'eof_no_done');
}

function fresh(): ConsumeOutcome {
  return { deltas: [], onDoneCalls: [], onErrorCalls: [], streamAttempts: 0 };
}

// ─── Test runner ────────────────────────────────────────────────────────────

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(name); else fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
}

function main() {
  // ── Pure classifier: complete vs interrupted are distinct terminal states ──
  assertEqual(classifyStreamTermination('done_event', true), { status: 'complete' }, 'classify: done_event → complete');
  assertEqual(classifyStreamTermination('done_event', false), { status: 'complete' }, 'classify: done_event complete regardless of output');
  assertEqual(classifyStreamTermination('error_event', true), { status: 'interrupted', interruptReason: 'error_event' }, 'classify: error_event → interrupted/error_event');
  assertEqual(classifyStreamTermination('eof_no_done', true), { status: 'interrupted', interruptReason: 'truncated' }, 'classify: eof_no_done → interrupted/truncated');
  assertEqual(classifyStreamTermination('read_threw', true), { status: 'interrupted', interruptReason: 'broken_pipe' }, 'classify: read_threw + output → broken_pipe');
  assertEqual(classifyStreamTermination('read_threw', false), { status: 'interrupted', interruptReason: 'truncated' }, 'classify: read_threw + no output → truncated');
  // The verdict is binary and the two states are never conflated.
  const allSignals: StreamTerminationSignal[] = ['done_event', 'error_event', 'eof_no_done', 'read_threw'];
  for (const s of allSignals) {
    for (const saw of [true, false]) {
      const c = classifyStreamTermination(s, saw);
      const complete = c.status === 'complete';
      const interrupted = c.status === 'interrupted';
      assert(complete !== interrupted, `classify: ${s}/${saw} is exactly one of complete|interrupted`);
      assert(complete ? c.interruptReason === undefined : c.interruptReason !== undefined,
        `classify: ${s}/${saw} carries interruptReason iff interrupted`);
    }
  }

  // ── buildStreamResult: incomplete flag tracks status ──
  {
    const clean = buildStreamResult({ status: 'complete' }, { toolUses: [], stopReason: 'end_turn' });
    assertEqual(clean.status, 'complete', 'build: complete status');
    assertEqual(clean.incomplete, false, 'build: complete → incomplete=false');
    assert(!('interruptReason' in clean), 'build: complete omits interruptReason');
    assertEqual(clean.stopReason, 'end_turn', 'build: carries stopReason');

    const cut = buildStreamResult({ status: 'interrupted', interruptReason: 'truncated' }, { toolUses: [], stopReason: null });
    assertEqual(cut.status, 'interrupted', 'build: interrupted status');
    assertEqual(cut.incomplete, true, 'build: interrupted → incomplete=true');
    assertEqual(cut.interruptReason, 'truncated', 'build: interrupted carries reason');
  }

  // ── Feed: clean end fires onDone(complete) and NOT onError ──
  {
    const out = fresh();
    consumeFeed([{ kind: 'delta', text: 'Hello ' }, { kind: 'delta', text: 'world' }, { kind: 'done', stopReason: 'end_turn' }], out);
    assertEqual(out.onDoneCalls.length, 1, 'clean: onDone fired once');
    assertEqual(out.onErrorCalls.length, 0, 'clean: onError never fired');
    assertEqual(out.onDoneCalls[0].status, 'complete', 'clean: status complete');
    assertEqual(out.onDoneCalls[0].incomplete, false, 'clean: incomplete=false');
    assertEqual(out.onDoneCalls[0].stopReason, 'end_turn', 'clean: stopReason preserved');
    assertEqual(out.deltas, ['Hello ', 'world'], 'clean: deltas delivered in order (happy path bytes)');
  }

  // ── Feed: mid-stream error AFTER partial output → interrupted, incomplete ──
  {
    const out = fresh();
    consumeFeed([{ kind: 'delta', text: 'Partial answer so far' }, { kind: 'error', message: 'overloaded' }], out);
    assertEqual(out.onDoneCalls.length, 0, 'error: onDone NOT fired (not a clean end)');
    assertEqual(out.onErrorCalls.length, 1, 'error: onError fired once');
    assertEqual(out.onErrorCalls[0].result?.status, 'interrupted', 'error: status interrupted');
    assertEqual(out.onErrorCalls[0].result?.incomplete, true, 'error: incomplete=true set');
    assertEqual(out.onErrorCalls[0].result?.interruptReason, 'error_event', 'error: reason error_event');
    assertEqual(out.onErrorCalls[0].message, 'overloaded', 'error: message surfaced to caller');
    assertEqual(out.deltas, ['Partial answer so far'], 'error: partial delta was NOT truncated silently');
  }

  // ── Feed: EOF with no terminal done → interrupted/truncated (not silent complete) ──
  {
    const out = fresh();
    consumeFeed([{ kind: 'delta', text: 'cut off mid' }, { kind: 'eof' }], out);
    assertEqual(out.onDoneCalls.length, 0, 'eof: does NOT report a clean complete');
    assertEqual(out.onErrorCalls.length, 1, 'eof: surfaces an interruption via onError');
    assertEqual(out.onErrorCalls[0].result?.status, 'interrupted', 'eof: status interrupted');
    assertEqual(out.onErrorCalls[0].result?.incomplete, true, 'eof: incomplete=true');
    assertEqual(out.onErrorCalls[0].result?.interruptReason, 'truncated', 'eof: reason truncated');
  }

  // ── Feed: read throws mid-stream after output → broken_pipe ──
  {
    const out = fresh();
    consumeFeed([{ kind: 'delta', text: 'streaming...' }, { kind: 'throw', message: 'socket hang up' }], out);
    assertEqual(out.onErrorCalls.length, 1, 'throw: onError fired');
    assertEqual(out.onDoneCalls.length, 0, 'throw: onDone not fired');
    assertEqual(out.onErrorCalls[0].result?.status, 'interrupted', 'throw: interrupted');
    assertEqual(out.onErrorCalls[0].result?.incomplete, true, 'throw: incomplete=true');
    assertEqual(out.onErrorCalls[0].result?.interruptReason, 'broken_pipe', 'throw+output: broken_pipe');
  }

  // ── Feed: read throws BEFORE any output → truncated (no partial to blame) ──
  {
    const out = fresh();
    consumeFeed([{ kind: 'throw', message: 'ECONNRESET' }], out);
    assertEqual(out.onErrorCalls[0].result?.interruptReason, 'truncated', 'throw+no-output: truncated');
    assertEqual(out.deltas.length, 0, 'throw-early: nothing delivered');
  }

  // ── Never auto-retries: one feed consumption = one stream attempt ──
  {
    const out = fresh();
    consumeFeed([{ kind: 'delta', text: 'x' }, { kind: 'error', message: 'boom' }], out);
    assertEqual(out.streamAttempts, 1, 'no-retry: interrupted stream consumed exactly once (no blind re-stream)');
    // And exactly one terminal callback total across the whole run.
    assertEqual(out.onDoneCalls.length + out.onErrorCalls.length, 1, 'no-retry: exactly one terminal callback');
  }

  // ── `done` arriving after deltas still wins even if an error would follow ──
  {
    const out = fresh();
    consumeFeed([{ kind: 'delta', text: 'ok' }, { kind: 'done', stopReason: 'tool_use' }, { kind: 'error', message: 'late' }], out);
    assertEqual(out.onDoneCalls.length, 1, 'settled-guard: done wins, later error ignored');
    assertEqual(out.onErrorCalls.length, 0, 'settled-guard: no onError after clean done');
    assertEqual(out.onDoneCalls[0].stopReason, 'tool_use', 'settled-guard: tool_use stop_reason captured');
  }

  if (failures > 0) {
    console.error(`\n${failures} swanbot-stream-resilience smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll swanbot-stream-resilience smoke cases passed.');
}

main();
