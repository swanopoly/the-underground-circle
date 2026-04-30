/**
 * agentDispatchIntent — parses chat input for "assign X to Y" patterns.
 *
 * Three entry points, all converging on the same shape so the chat
 * intercept doesn't care which form the user typed:
 *   1. Slash commands: /assign /delegate /spawn /send /queue
 *   2. Natural language: "assign npm test to whistling-taco"
 *   3. Reply chain: "@<name> handle this" with replyTo body as the task
 *
 * RN-free so smoketests can import without webpacking the dep graph.
 *
 * Spec: docs/superpowers/specs/2026-04-30-agent-dispatch-design.md
 */

export type DispatchVerb = 'spawn' | 'send' | 'queue' | 'auto';

export interface DispatchIntent {
  /** The session name / id the user typed. */
  target: string;
  /** Task body the user wants the agent to perform. */
  task: string;
  /** Slash form forces a specific verb; NL stays auto unless qualifier word. */
  verb: DispatchVerb;
  /** Which entry point produced this intent — useful for telemetry + UI. */
  source: 'slash' | 'natural' | 'reply';
}

/**
 * Slash form: /assign <target> <task>, /delegate, /spawn, /send, /queue.
 * <target> is a single word (allows hyphens, dots, slashes, '@' prefix).
 */
export function parseDispatchSlash(input: string): DispatchIntent | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const SLASH_VERBS: Record<string, DispatchVerb> = {
    '/assign':   'auto',
    '/delegate': 'auto',
    '/spawn':    'spawn',
    '/send':     'send',
    '/queue':    'queue',
  };

  for (const [prefix, verb] of Object.entries(SLASH_VERBS)) {
    if (trimmed.toLowerCase().startsWith(prefix + ' ')) {
      const rest = trimmed.slice(prefix.length + 1).trim();
      const m = rest.match(/^@?(\S+)\s+(.+)$/);
      if (!m) return null;
      const [, target, task] = m;
      if (!target || !task) return null;
      return { target, task: task.trim(), verb, source: 'slash' };
    }
    // Bare verb with no args — let the caller show usage.
    if (trimmed.toLowerCase() === prefix) {
      return { target: '', task: '', verb, source: 'slash' };
    }
  }
  return null;
}

/**
 * Natural language form. Three patterns covered in priority order:
 *   1. "assign|delegate|hand off|hand-off|send|give <task> to @<target>"
 *   2. "@<target> (handle|do|run|execute|please) <task>"
 *   3. "<task> — @<target>"  (em-dash or hyphen separator at end)
 *
 * Returns null when no pattern matches. Conservative — false positives
 * silently dispatch the wrong thing, so we err toward "let the LLM
 * handle it" when the input is ambiguous.
 */
export function parseDispatchNatural(input: string): DispatchIntent | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Pattern 1a: split phrasal "hand <task> off to <target>: <body>"
  //   "hand this off to codex: dig into the build error"
  // Captured first because pattern 1 below would consume "off" into the
  // task body otherwise.
  const m1a = trimmed.match(/^hand\s+(.+?)\s+off\s+to\s+@?([\w.\-/]+)\s*[:.]?\s*(.+)?$/i);
  if (m1a) {
    const [, before, target, after] = m1a;
    const task = (after && after.trim()) ? after.trim() : before.trim();
    if (target) {
      const isPlaceholder = ['this', 'this task', 'it', 'them'].includes(task.toLowerCase());
      return { target, task: isPlaceholder ? '' : task, verb: 'auto', source: 'natural' };
    }
  }

  // Pattern 1: "assign <task> to @<target>" or "send <task> to <target>"
  // Also matches "hand off <task> to <target>" (contiguous form).
  const m1 = trimmed.match(/^(assign|delegate|handoff|hand-off|hand\s+off|send|give)\s+(.+)\s+to\s+@?([\w.\-/]+)\s*[:.]?\s*(.+)?$/i);
  if (m1) {
    const [, , beforeTo, target, after] = m1;
    // If the user said "Assign this task to <target>: <real task>" we
    // prefer the colon-separated body when it exists.
    const task = (after && after.trim().length > 0)
      ? after.trim()
      : beforeTo.trim();
    if (target && task && task.toLowerCase() !== 'this' && task.toLowerCase() !== 'this task') {
      return { target, task, verb: 'auto', source: 'natural' };
    }
    // Bare "assign this to <target>" with no task body — caller can use
    // the previous message as the task (reply-chain style). Surface as
    // an intent with empty task so the caller decides.
    if (target) {
      return { target, task: '', verb: 'auto', source: 'natural' };
    }
  }

  // Pattern 2: "@<target> handle|do|run|execute|please <task>"
  const m2 = trimmed.match(/^@([\w.\-/]+)\s+(handle|do|run|execute|please|take|grab)\s+(.+)$/i);
  if (m2) {
    const [, target, , task] = m2;
    return { target, task: task.trim(), verb: 'auto', source: 'natural' };
  }

  // Pattern 3: "<task> — @<target>" or "<task> - <target>" at the very end.
  const m3 = trimmed.match(/^(.+?)\s+[—–-]\s+@?([\w.\-/]+)\s*$/);
  if (m3) {
    const [, task, target] = m3;
    if (task && target && task.length > 3) {
      return { target, task: task.trim(), verb: 'auto', source: 'natural' };
    }
  }

  return null;
}

/**
 * Try slash first, then natural language. Returns null when input is
 * unambiguously a regular chat message — caller falls through to the
 * existing LLM path.
 */
export function parseDispatchIntent(input: string): DispatchIntent | null {
  return parseDispatchSlash(input) || parseDispatchNatural(input);
}
