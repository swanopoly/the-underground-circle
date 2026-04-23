/**
 * thinkingStatus — one-word, rotating status for the chat typing bar.
 *
 * The intent is a single, contemplative verb that names what the agent is
 * doing right now: "Perceiving", "Reasoning", "Distilling". Words rotate
 * every few seconds within the same phase so the bar feels alive without
 * becoming chatty.
 *
 * If you add a phase, add its pool below. Phrases are intentionally
 * single-word and lowercase in intent, capitalized for display.
 */

import { useEffect, useRef, useState } from 'react';

// Cadence for cycling within a phase. Slow enough to read, brisk enough to
// feel like the agent is moving.
const ROTATION_MS = 2200;

export type ThinkingPhase =
  | 'detecting'      // reading the user's message + entities
  | 'routing'        // choosing a runtime / tool set
  | 'thinking'       // the LLM is reasoning
  | 'tool_running'   // an agent tool is executing
  | 'streaming'      // response tokens are arriving
  | 'summarizing'    // post-response memory / recap
  | 'refining'       // codegen workbench polish pass
  | 'exploring'      // build discovery: asking clarifying questions
  | 'converging';    // build discovery: shaping a concrete brief

export interface ThinkingMeta {
  agentName?: string;
  modelLabel?: string;
  modeLabel?: string;
  complexity?: string;
  entitySummary?: string;
  toolName?: string;
}

// Pools are deliberately short and curated. Each verb should answer
// "what is the agent doing?" in one word, with weight.
const DETECTING_POOL = [
  'Perceiving',
  'Sensing',
  'Discerning',
  'Attuning',
  'Listening',
  'Reading',
];

const ROUTING_POOL = [
  'Routing',
  'Directing',
  'Orienting',
  'Dispatching',
  'Aligning',
];

const THINKING_POOL = [
  'Reasoning',
  'Pondering',
  'Deliberating',
  'Contemplating',
  'Weighing',
  'Ruminating',
  'Reflecting',
  'Considering',
];

const TOOL_POOL = [
  'Invoking',
  'Reaching',
  'Fetching',
  'Summoning',
  'Gathering',
];

const STREAMING_POOL = [
  'Composing',
  'Articulating',
  'Speaking',
  'Unfurling',
];

const SUMMARIZING_POOL = [
  'Distilling',
  'Consolidating',
  'Integrating',
  'Crystallizing',
];

const REFINING_POOL = [
  'Refining',
  'Honing',
  'Polishing',
  'Tempering',
];

const EXPLORING_POOL = [
  'Exploring',
  'Mapping',
  'Surveying',
  'Probing',
  'Tracing',
];

const CONVERGING_POOL = [
  'Converging',
  'Synthesizing',
  'Crystallizing',
  'Aligning',
  'Shaping',
];

function poolForPhase(phase: ThinkingPhase): string[] {
  switch (phase) {
    case 'detecting': return DETECTING_POOL;
    case 'routing': return ROUTING_POOL;
    case 'thinking': return THINKING_POOL;
    case 'tool_running': return TOOL_POOL;
    case 'streaming': return STREAMING_POOL;
    case 'summarizing': return SUMMARIZING_POOL;
    case 'refining': return REFINING_POOL;
    case 'exploring': return EXPLORING_POOL;
    case 'converging': return CONVERGING_POOL;
  }
}

function pickFrom(pool: string[], previous?: string): string {
  if (pool.length === 0) return '';
  if (pool.length === 1 || !previous) return pool[Math.floor(Math.random() * pool.length)];
  // Avoid repeating the exact word we just showed so the rotation feels
  // like motion rather than stutter.
  const filtered = pool.filter((w) => w !== previous);
  return filtered[Math.floor(Math.random() * filtered.length)];
}

/** Pick a single one-word status for this phase. Metadata is accepted for
 *  forward compatibility but intentionally ignored — the whole point of
 *  this pass is a clean, one-word label. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getThinkingPhrase(phase: ThinkingPhase, _meta: ThinkingMeta = {}): string {
  return pickFrom(poolForPhase(phase));
}

/** Back-compat shim for the old detection helper — also returns one word. */
export function getDetectedPhrase(_meta: ThinkingMeta = {}): string {
  return getThinkingPhrase('detecting');
}

/** React hook: returns a one-word status for the given phase that rotates
 *  every ~2.2s. Pass `null` as the phase to stop rotation. */
export function useRotatingThinkingPhrase(
  phase: ThinkingPhase | null,
  _meta: ThinkingMeta = {},
): string {
  const lastRef = useRef<string>('');
  const [phrase, setPhrase] = useState<string>(() => {
    if (!phase) return '';
    const first = pickFrom(poolForPhase(phase));
    lastRef.current = first;
    return first;
  });

  useEffect(() => {
    if (!phase) {
      lastRef.current = '';
      setPhrase('');
      return;
    }
    // Pick a fresh word on phase change too.
    const first = pickFrom(poolForPhase(phase), lastRef.current);
    lastRef.current = first;
    setPhrase(first);
    const id = setInterval(() => {
      const next = pickFrom(poolForPhase(phase), lastRef.current);
      lastRef.current = next;
      setPhrase(next);
    }, ROTATION_MS);
    return () => clearInterval(id);
  }, [phase]);

  return phrase;
}
