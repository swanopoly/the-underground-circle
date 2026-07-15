// runAndFixGateCore — the PURE decision core for the P6 "run-and-fix verification
// gate" (docs/CODING_AGENT_UPGRADE_PLAN.md P6). Claude-Code-class coding agents do
// not just edit files — they RUN verification (typecheck/tests) after edits and fix
// failures before declaring the task done. Today our loop happily finishes on an
// unverified edit. This module owns the deterministic, side-effect-free half of the
// fix so it can be smoke-tested before it is wired into the agent loop's
// `onRoundComplete` hook (which may append ONE user note per round):
//
//   (A) STATE FOLDING — foldRunAndFixRound(state, calls): after each model round,
//       fold that round's tool calls into a dirty/verified state machine. A
//       successful call to a CODE_MUTATION tool marks the workspace dirty; any
//       `verification.*` call records a verification attempt, and an all-passing
//       verification with no successful mutation AFTER it (later in the same
//       round's call list) marks the workspace verified-clean. A mutation that
//       lands after the verification in the same round keeps the workspace dirty —
//       the passing run did not see that edit.
//
//   (B) NUDGE PLANNING — planVerificationNudge(state): decide whether to append a
//       user note this round, and with which deterministic text. Two reasons:
//       'verification_failed' (verification ran THIS round and failed — fix and
//       re-run before finishing) and 'dirty_unverified' (edits have sat unverified
//       for a full round — run verification.typecheck / verification.tests).
//       Capped at MAX_VERIFICATION_NUDGES_PER_RUN total and never twice for the
//       same round; markNudgeSent(state) records a sent nudge.
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: run-and-fix-gate-core). No
// filesystem, no network, no DB. Every export is total: it never throws on
// degenerate/undefined input, returning zeroed/neutral results instead, and
// foldRunAndFixRound/markNudgeSent always return a NEW state object (callers can
// safely keep old snapshots).

// ── Tunables (exported so the loop wiring shares the exact same policy) ─────────

/** Successful calls to these tools mark the workspace "dirty" (code was mutated
 *  and has not been re-verified since). */
export const CODE_MUTATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  'desktop.edit_file',
  'desktop.file_write_text',
]);

/** Any tool whose name starts with this prefix counts as a verification run
 *  (e.g. verification.typecheck, verification.tests, verification.lint). */
export const VERIFICATION_TOOL_PREFIX = 'verification.';

// ── Exec-aware classification (coding-agent P2/P3) ─────────────────────────────
// `local.run_shell` and `git.run` calls are classified by their INPUT, not
// their name: a test/build/lint run through the shell IS a verification (its
// non-zero exit already reports ok:false), while a working-tree-changing
// command dirties the workspace. The verification matcher is deliberately
// TIGHT (false "verified-clean" is the only dangerous direction) and the
// mutation matcher deliberately LOOSE (a spurious dirty just costs one nudge).

/** Bare binaries whose successful run counts as verification. */
const VERIFICATION_SHELL_LEADS: ReadonlySet<string> = new Set([
  'pytest', 'tsc', 'eslint', 'prettier', 'ruff', 'mypy', 'flake8', 'jest', 'vitest',
]);
/** Package-manager / toolchain subcommands that count as verification. */
const VERIFICATION_SUBCOMMANDS: Record<string, ReadonlySet<string>> = {
  npm: new Set(['test', 'run']),
  pnpm: new Set(['test', 'run']),
  yarn: new Set(['test', 'run']),
  bun: new Set(['test', 'run']),
  cargo: new Set(['test', 'check', 'clippy', 'build']),
  go: new Set(['test', 'vet', 'build']),
};
/** Read-only leads that neither verify nor dirty the workspace. */
const NEUTRAL_SHELL_LEADS: ReadonlySet<string> = new Set([
  'ls', 'cat', 'pwd', 'echo', 'printf', 'which', 'type', 'find', 'grep', 'rg', 'ag',
  'head', 'tail', 'wc', 'sort', 'uniq', 'cut', 'stat', 'file', 'tree', 'du', 'df',
  'date', 'whoami', 'id', 'uname', 'env', 'printenv', 'realpath', 'dirname',
  'basename', 'diff', 'cmp', 'jq', 'yq', 'ps', 'true', 'false', 'test',
]);
/** git verbs that change the WORKING TREE (invalidate a previous test pass).
 *  commit/add/tag/fetch touch index/refs only — a commit after a green run
 *  must NOT re-dirty the workspace. */
const GIT_WORKTREE_MUTATING_VERBS: ReadonlySet<string> = new Set([
  'checkout', 'switch', 'restore', 'stash', 'merge', 'rebase', 'cherry-pick',
  'revert', 'reset', 'rm', 'mv', 'pull',
]);

/**
 * Classify an exec-tool call for the gate. Returns null for every other tool
 * (callers fall back to the static name-based sets). Total: degenerate input
 * yields the fail-safe { isMutation: true, isVerification: false } for a
 * recognized exec tool.
 */
export function classifyExecCallForGate(
  toolName: unknown,
  input: unknown,
): { isMutation: boolean; isVerification: boolean } | null {
  if (toolName === 'git.run') {
    const verb = input && typeof input === 'object' && typeof (input as { verb?: unknown }).verb === 'string'
      ? ((input as { verb: string }).verb).trim().toLowerCase()
      : '';
    return { isMutation: GIT_WORKTREE_MUTATING_VERBS.has(verb), isVerification: false };
  }
  if (toolName !== 'local.run_shell') return null;
  const argv = input && typeof input === 'object' && Array.isArray((input as { argv?: unknown }).argv)
    ? ((input as { argv: unknown[] }).argv).filter((a): a is string => typeof a === 'string')
    : [];
  const lead = (argv[0] || '').split('/').pop()!.trim().toLowerCase();
  const sub = (argv[1] || '').trim().toLowerCase();
  if (!lead) return { isMutation: true, isVerification: false }; // degenerate → fail-safe dirty
  const isVerification = VERIFICATION_SHELL_LEADS.has(lead)
    || Boolean(VERIFICATION_SUBCOMMANDS[lead]?.has(sub));
  if (isVerification) return { isMutation: false, isVerification: true };
  if (NEUTRAL_SHELL_LEADS.has(lead)) return { isMutation: false, isVerification: false };
  return { isMutation: true, isVerification: false }; // unknown command → fail-safe dirty
}

/** Hard cap on nudges per run — the gate reminds, it does not nag forever. */
export const MAX_VERIFICATION_NUDGES_PER_RUN = 2;

// ── State ───────────────────────────────────────────────────────────────────────

export interface RunAndFixGateState {
  /** True when code was mutated after the last passing verification. */
  dirty: boolean;
  /** Round in which the workspace first became dirty (null when clean). */
  dirtySinceRound: number | null;
  /** Outcome of the most recent round that ran any verification.* tool. */
  lastVerificationOk: boolean | null;
  /** Round of the most recent verification.* call (null if never verified). */
  lastVerificationRound: number | null;
  /** Total nudges sent this run (capped at MAX_VERIFICATION_NUDGES_PER_RUN). */
  nudgesSent: number;
  /** Round in which the last nudge was sent (never nudge twice per round). */
  lastNudgeRound: number | null;
  /** Rounds folded so far (increments once per foldRunAndFixRound call). */
  round: number;
}

/** Zeroed initial state — clean workspace, no verification, no nudges, round 0. */
export function createRunAndFixGateState(): RunAndFixGateState {
  return {
    dirty: false,
    dirtySinceRound: null,
    lastVerificationOk: null,
    lastVerificationRound: null,
    nudgesSent: 0,
    lastNudgeRound: null,
    round: 0,
  };
}

/** One tool call observed in a round, in call order. `ok` is the tool result
 *  success flag — only ok:true mutations dirty the workspace, and a verification
 *  round passes only when EVERY verification.* call that round has ok:true. */
export interface RoundToolCall {
  name: string;
  ok: boolean;
  /** Raw tool input — only consulted for local.run_shell / git.run calls
   *  (exec-aware classification); other tools classify by name alone. */
  input?: unknown;
}

// ── Internal helpers ────────────────────────────────────────────────────────────

/** Coerce an arbitrary (possibly hostile/degenerate) value into a clean state. */
function normalizeState(state: RunAndFixGateState | null | undefined): RunAndFixGateState {
  if (!state || typeof state !== 'object') return createRunAndFixGateState();
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return {
    dirty: state.dirty === true,
    dirtySinceRound: num(state.dirtySinceRound),
    lastVerificationOk: typeof state.lastVerificationOk === 'boolean' ? state.lastVerificationOk : null,
    lastVerificationRound: num(state.lastVerificationRound),
    nudgesSent: Math.max(0, num(state.nudgesSent) ?? 0),
    lastNudgeRound: num(state.lastNudgeRound),
    round: Math.max(0, num(state.round) ?? 0),
  };
}

/** Extract the valid RoundToolCalls from an untyped calls payload, preserving
 *  call order. Junk entries are dropped; a non-array yields []. */
function sanitizeCalls(calls: unknown): RoundToolCall[] {
  if (!Array.isArray(calls)) return [];
  const out: RoundToolCall[] = [];
  for (const entry of calls) {
    if (!entry || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name !== 'string' || name.length === 0) continue;
    out.push({ name, ok: (entry as { ok?: unknown }).ok === true, input: (entry as { input?: unknown }).input });
  }
  return out;
}

// ── (A) State folding ───────────────────────────────────────────────────────────

/**
 * Fold one completed round's tool calls into the gate state. Always returns a NEW
 * state object (never mutates the input) and always increments `round`, even for
 * degenerate `calls` input.
 *
 * Semantics (call-list order matters within a round):
 *  - any ok:true call to a CODE_MUTATION tool → dirty=true (dirtySinceRound set to
 *    this round only if the workspace was not already dirty);
 *  - any verification.* call → lastVerificationRound=this round and
 *    lastVerificationOk = (every verification.* call this round was ok:true);
 *  - a passing verification marks the workspace clean UNLESS a successful mutation
 *    appears LATER in the call list than the last verification call — that edit
 *    was not covered by the run, so the workspace stays dirty.
 */
export function foldRunAndFixRound(
  state: RunAndFixGateState | null | undefined,
  calls: unknown,
): RunAndFixGateState {
  const prev = normalizeState(state);
  const round = prev.round + 1;
  const next: RunAndFixGateState = { ...prev, round };

  const list = sanitizeCalls(calls);
  if (list.length === 0) return next; // degenerate/empty round: just advance.

  let lastSuccessfulMutationIndex = -1;
  let lastVerificationIndex = -1;
  let sawVerification = false;
  let allVerificationsOk = true;

  for (let i = 0; i < list.length; i += 1) {
    const call = list[i];
    // Exec tools (local.run_shell / git.run) classify by INPUT; everything
    // else by the static name sets.
    const execKind = classifyExecCallForGate(call.name, call.input);
    const isMutation = execKind ? execKind.isMutation : CODE_MUTATION_TOOL_NAMES.has(call.name);
    const isVerification = execKind ? execKind.isVerification : call.name.startsWith(VERIFICATION_TOOL_PREFIX);
    if (isMutation && call.ok) {
      lastSuccessfulMutationIndex = i;
    }
    if (isVerification) {
      sawVerification = true;
      lastVerificationIndex = i;
      if (!call.ok) allVerificationsOk = false;
    }
  }

  if (lastSuccessfulMutationIndex >= 0 && !next.dirty) {
    next.dirty = true;
    next.dirtySinceRound = round;
  } else if (lastSuccessfulMutationIndex >= 0) {
    next.dirty = true; // already dirty: keep the original dirtySinceRound.
  }

  if (sawVerification) {
    next.lastVerificationRound = round;
    next.lastVerificationOk = allVerificationsOk;
    const mutationAfterVerification =
      lastSuccessfulMutationIndex > lastVerificationIndex;
    if (allVerificationsOk && !mutationAfterVerification) {
      next.dirty = false;
      next.dirtySinceRound = null;
    }
  }

  return next;
}

// ── (B) Nudge planning ──────────────────────────────────────────────────────────

export interface VerificationNudge {
  shouldNudge: boolean;
  note: string;
  reason: 'dirty_unverified' | 'verification_failed' | 'none';
}

/** Deterministic note for a failed verification in the current round. */
const VERIFICATION_FAILED_NOTE =
  'Verification failed this round. Read the failure output above, fix the code ' +
  'with precise edits, and re-run the SAME verification tool until it passes ' +
  'before finishing.';

/** Deterministic note for edits that have gone unverified for a full round. */
const DIRTY_UNVERIFIED_NOTE =
  'You have edited files but have not verified the changes. Run ' +
  'verification.typecheck (and verification.tests when tests cover the change) ' +
  'before declaring the task done.';

const NO_NUDGE: VerificationNudge = { shouldNudge: false, note: '', reason: 'none' };

/**
 * Decide whether the loop should append a verification nudge this round. Nudges
 * are capped at MAX_VERIFICATION_NUDGES_PER_RUN per run and never fire twice for
 * the same round. 'verification_failed' (a verification ran THIS round and
 * failed) takes precedence over 'dirty_unverified' (dirty for >= 2 rounds with no
 * passing verification since).
 */
export function planVerificationNudge(
  state: RunAndFixGateState | null | undefined,
): VerificationNudge {
  const s = normalizeState(state);
  if (s.nudgesSent >= MAX_VERIFICATION_NUDGES_PER_RUN) return NO_NUDGE;
  if (s.lastNudgeRound !== null && s.lastNudgeRound === s.round) return NO_NUDGE;

  if (s.lastVerificationOk === false && s.lastVerificationRound === s.round) {
    return { shouldNudge: true, note: VERIFICATION_FAILED_NOTE, reason: 'verification_failed' };
  }
  if (s.dirty && s.dirtySinceRound !== null && s.round - s.dirtySinceRound >= 1) {
    return { shouldNudge: true, note: DIRTY_UNVERIFIED_NOTE, reason: 'dirty_unverified' };
  }
  return NO_NUDGE;
}

/** Record that a nudge was actually appended this round. Returns a NEW state with
 *  nudgesSent incremented and lastNudgeRound pinned to the current round. */
export function markNudgeSent(
  state: RunAndFixGateState | null | undefined,
): RunAndFixGateState {
  const prev = normalizeState(state);
  return { ...prev, nudgesSent: prev.nudgesSent + 1, lastNudgeRound: prev.round };
}
