// gitCommandPolicy — the PURE policy engine behind a coding-agent `git` tool
// (plan P3 of docs/CODING_AGENT_UPGRADE_PLAN.md). It turns a requested git verb
// + args into a VALIDATED argv vector (the tokens AFTER "git") plus a
// read/write/blocked classification and an auto/ask/never approval tier. A bridge
// endpoint runs execFile("git", argv) — never a shell string — so a metacharacter
// or quote inside any token (especially a commit message) is inert. This module
// decides WHAT is allowed and safe; it never spawns a process or touches git.
//
// SAFETY CONTRACT (mirrors fileEditCore / appScriptRunner):
//   - Never throws. Every path returns a typed result; any violation fails CLOSED
//     with classification:'blocked' / approvalTier:'never' and a reason.
//   - Default-DENY: an unknown verb is blocked (fail-safe), so new/unexpected git
//     subcommands can never slip through as auto-runnable.
//   - READ verbs are auto (safe to run without approval); WRITE verbs are ask
//     (approval-gated with a visible preview); dangerous forms are blocked
//     outright (never), regardless of verb.
//   - ARG SAFETY: every arg must be a control-char-free, ≤512-char string; a NUL /
//     newline / control char, or a disallowed exec-injection flag, blocks the
//     whole command. This is defense-in-depth — execFile passes an argv ARRAY, so
//     no token is ever shell-interpreted, but we still reject the injection
//     vectors (-c config, --upload-pack/--receive-pack/--exec, force-destructive
//     flags) so a plan never even *looks* runnable.
//   - The commit `message` is placed as its OWN argv element after `-m`; it is
//     NEVER concatenated into another token or shell-interpolated. A message like
//     `"; rm -rf ~` is therefore SAFE — it is one inert positional token.
//
// PURITY: zero runtime imports, tsx-loadable (smoke: git-command-policy). A future
// bridge tool (e.g. git.run) reads this plan, enforces the repo path grant, then
// execFiles git with `argv`, mapping approvalTier auto→run / ask→approval-gated.

export type GitClassification = 'read' | 'write' | 'blocked';
export type GitApprovalTier = 'auto' | 'ask' | 'never';

export interface GitCommandInput {
  /** The git subcommand, e.g. 'status', 'commit', 'push'. */
  verb: string;
  /** Positional args + flags AFTER the verb (each becomes one argv token). */
  args?: unknown[];
  /** Commit/tag message — placed as its OWN argv element after '-m' (never
   *  shell-interpolated). Only consumed by verbs that take -m (commit). */
  message?: string;
}

export interface GitCommandPlan {
  ok: boolean;
  /** Validated arg vector AFTER "git" (the bridge prepends the git binary and
   *  runs execFile — no shell). Empty on failure. */
  argv: string[];
  classification: GitClassification;
  approvalTier: GitApprovalTier;
  /** Human-readable reason (why blocked, or a short confirmation). */
  reason: string;
  /** Non-fatal notes (e.g. normalization details). */
  notes: string[];
}

/** Guard: a single git arg longer than this is rejected (a legit path/ref/flag is
 *  far shorter; an oversized arg is almost always a mistake or an attack). */
export const MAX_GIT_ARG_LENGTH = 512;
/** Guard: cap the number of args in one command (defense-in-depth). */
export const MAX_GIT_ARGS = 128;
/** Guard: commit/tag message length bound. */
export const MAX_GIT_MESSAGE_LENGTH = 20_000;

// ── Verb classification ────────────────────────────────────────────────────────
// READ verbs never mutate the repo → auto. Note: `branch`/`tag`/`remote` are READ
// only in their list/no-mutate form; a create/delete/move flag reclassifies them
// to WRITE (see reclassifyDualModeVerb). WRITE verbs mutate working tree, index,
// refs, or the remote → ask. Anything not listed is unknown → blocked.

const READ_VERBS: ReadonlySet<string> = new Set([
  'status',
  'diff',
  'log',
  'show',
  'blame',
  'branch', // list form (reclassified to write if a mutate flag is present)
  'remote', // read/list form (reclassified to write on add/remove/set/rename)
  'rev-parse',
  'describe',
  'ls-files',
  'shortlog',
  'tag', // list form (reclassified to write on create/delete)
]);

const WRITE_VERBS: ReadonlySet<string> = new Set([
  'add',
  'commit',
  'checkout',
  'switch',
  'branch', // create/delete form
  'reset',
  'restore',
  'rm',
  'mv',
  'merge',
  'rebase',
  'stash',
  'pull',
  'fetch',
  'tag', // create form
  'cherry-pick',
  'revert',
  'init',
]);

// Verbs whose read/write nature depends on their flags. A mutate flag flips the
// otherwise-read verb to write; the presence of any of these makes it WRITE.
const DUAL_MODE_MUTATE_FLAGS: Record<string, ReadonlySet<string>> = {
  branch: new Set(['-d', '-D', '--delete', '-m', '-M', '--move', '-c', '-C', '--copy', '--edit-description', '--set-upstream-to', '--unset-upstream']),
  tag: new Set(['-d', '--delete', '-a', '--annotate', '-s', '--sign', '-f', '--force', '-m', '--message']),
  remote: new Set(['add', 'remove', 'rm', 'set-url', 'set-head', 'set-branches', 'rename', 'prune', 'update']),
};

// ── Blocked forms (never — regardless of verb) ─────────────────────────────────
// These are irrecoverable-destructive or arbitrary-exec vectors. Blocking is
// substring/exact where noted; a match anywhere in the args blocks the command.

/** Exec-injection flags: git reads these as programs/commands to RUN over the
 *  transport or config, turning `git <x>` into arbitrary code execution. Blocked
 *  as an exact flag OR as a `--flag=value` form. */
const EXEC_INJECTION_FLAGS: ReadonlySet<string> = new Set([
  '--upload-pack',
  '--receive-pack',
  '--exec', // alias used by push/receive-pack (`git push --exec=...`)
]);

/** Force / destructive flags that are irrecoverable — blocked outright. */
const FORCE_FLAGS: ReadonlySet<string> = new Set(['--force', '-f', '--force-with-lease', '--force-if-includes']);

/** Remote-destructive flags (mass ref rewrite/removal on the remote). */
const REMOTE_DESTRUCTIVE_FLAGS: ReadonlySet<string> = new Set(['--mirror', '--delete', '--prune']);

/** Whole verbs that are always blocked (history-rewriting bulk tools). */
const BLOCKED_VERBS: ReadonlySet<string> = new Set(['filter-branch', 'filter-repo']);

// ── Arg safety ─────────────────────────────────────────────────────────────────

interface ArgCheck {
  ok: boolean;
  reason?: string;
}

/** Every arg must be a string, control-char-free (NUL/newline included), and
 *  length-bounded. Returns the first violation. Never throws. */
function checkArgSafety(arg: unknown, index: number): ArgCheck {
  if (typeof arg !== 'string') {
    return { ok: false, reason: `arg ${index} must be a string` };
  }
  if (arg.length > MAX_GIT_ARG_LENGTH) {
    return { ok: false, reason: `arg ${index} exceeds ${MAX_GIT_ARG_LENGTH} chars` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(arg)) {
    return { ok: false, reason: `arg ${index} contains a control character (NUL/newline/other)` };
  }
  return { ok: true };
}

/** Split `--flag=value` into the bare flag; a bare token returns itself. */
function bareFlag(arg: string): string {
  const eq = arg.indexOf('=');
  return eq >= 0 ? arg.slice(0, eq) : arg;
}

/** True when the arg is a `-c key=val` config-injection token. git's `-c`
 *  (and `--config-env`) lets a caller set ANY config for the invocation, which
 *  includes arbitrary-exec keys (core.sshCommand, core.pager, core.fsmonitor,
 *  protocol.*.allow, …). We block ALL of these — none is whitelisted. */
function isConfigInjection(arg: string): boolean {
  if (arg === '-c' || arg === '--config-env') return true;
  // `-c<key>=<val>` written without a space, or `--config-env=...`.
  if (/^-c[^-]/.test(arg)) return true;
  if (arg === '--config-env' || arg.startsWith('--config-env=')) return true;
  return false;
}

/** Detect a blocked force/exec/destructive/config token anywhere in the args.
 *  Returns a reason string when blocked, or null when clean. */
function findBlockedToken(verb: string, args: string[]): string | null {
  for (const arg of args) {
    const bare = bareFlag(arg);
    if (isConfigInjection(arg)) {
      return `blocked: "-c" config injection is not allowed (arbitrary-exec vector, e.g. core.sshCommand/core.pager)`;
    }
    if (EXEC_INJECTION_FLAGS.has(bare)) {
      return `blocked: "${bare}" is an exec-injection flag (--upload-pack/--receive-pack/--exec)`;
    }
    if (FORCE_FLAGS.has(bare)) {
      return `blocked: force flag "${bare}" is not allowed`;
    }
  }
  // reset --hard is irrecoverable (drops working-tree + index changes).
  if (verb === 'reset' && args.some((a) => bareFlag(a) === '--hard')) {
    return 'blocked: "reset --hard" is irrecoverable (discards working-tree changes)';
  }
  // clean -f / -fd / -fdx removes untracked files irrecoverably.
  if (verb === 'clean') {
    const hasForce = args.some((a) => a === '-f' || a === '--force' || (/^-[a-eg-z]*f[a-eg-z]*$/i.test(a)));
    if (hasForce) return 'blocked: "git clean -f" irrecoverably deletes untracked files';
  }
  // push --mirror / --delete / --prune rewrites or removes remote refs in bulk.
  if (verb === 'push') {
    for (const a of args) {
      if (REMOTE_DESTRUCTIVE_FLAGS.has(bareFlag(a))) {
        return `blocked: "push ${bareFlag(a)}" is a remote-destructive operation`;
      }
    }
  }
  return null;
}

/** A dual-mode verb (branch/tag/remote) is WRITE when it carries a mutate flag or
 *  subcommand; otherwise it stays READ. Returns the effective classification. */
function reclassifyDualModeVerb(verb: string, args: string[]): GitClassification {
  const mutate = DUAL_MODE_MUTATE_FLAGS[verb];
  if (!mutate) return 'read';
  for (const arg of args) {
    // For remote, the mutating token is a positional subcommand (add/remove/…);
    // for branch/tag it is a flag. Check both the raw token and the bare flag.
    if (mutate.has(arg) || mutate.has(bareFlag(arg))) return 'write';
  }
  // `branch <newname>` / `tag <newname>` with a NON-flag positional also creates.
  if ((verb === 'branch' || verb === 'tag') && args.some((a) => a.length > 0 && !a.startsWith('-'))) {
    return 'write';
  }
  return 'read';
}

// ── Plan ────────────────────────────────────────────────────────────────────────

/**
 * Validate a requested git command into a safe `GitCommandPlan`. READ verbs →
 * auto, WRITE verbs → ask, dangerous/unknown → blocked (never). Never throws.
 */
export function planGitCommand(input: unknown): GitCommandPlan {
  const blocked = (reason: string, notes: string[] = []): GitCommandPlan => ({
    ok: false,
    argv: [],
    classification: 'blocked',
    approvalTier: 'never',
    reason,
    notes,
  });

  if (!input || typeof input !== 'object') {
    return blocked('git command input must be an object with a verb');
  }
  const { verb: rawVerb, args: rawArgs, message: rawMessage } = input as GitCommandInput;

  // ── verb ──────────────────────────────────────────────────────────────────
  if (typeof rawVerb !== 'string' || !rawVerb.trim()) {
    return blocked('git verb must be a non-empty string');
  }
  const verb = rawVerb.trim();
  // The verb itself must be a clean subcommand token (letters/digits/hyphen),
  // never a flag or a path — this also stops `-c`-as-verb config injection.
  if (!/^[a-z][a-z0-9-]{0,31}$/i.test(verb)) {
    return blocked(`git verb "${verb.slice(0, 32)}" is not a valid subcommand name`);
  }

  // ── args: presence, count, and per-arg safety ───────────────────────────────
  const argsInput = rawArgs === undefined || rawArgs === null ? [] : rawArgs;
  if (!Array.isArray(argsInput)) {
    return blocked('git args must be an array when provided');
  }
  if (argsInput.length > MAX_GIT_ARGS) {
    return blocked(`too many git args (${argsInput.length} > ${MAX_GIT_ARGS})`);
  }
  const safeArgs: string[] = [];
  for (let i = 0; i < argsInput.length; i += 1) {
    const check = checkArgSafety(argsInput[i], i);
    if (!check.ok) return blocked(check.reason ?? `arg ${i} is unsafe`);
    safeArgs.push(argsInput[i] as string);
  }

  const notes: string[] = [];

  // ── always-blocked verbs (history-rewriting bulk tools) ─────────────────────
  if (BLOCKED_VERBS.has(verb)) {
    return blocked(`blocked: "git ${verb}" (history-rewriting bulk tool) is not permitted`);
  }

  // ── blocked forms in the args (force/exec/config/destructive) ───────────────
  const blockedToken = findBlockedToken(verb, safeArgs);
  if (blockedToken) return blocked(blockedToken);

  // ── classify: known read/write, with dual-mode reclassification ─────────────
  const isRead = READ_VERBS.has(verb);
  const isWrite = WRITE_VERBS.has(verb);
  if (!isRead && !isWrite) {
    // Default-deny: unknown verb fails safe (never auto-runs an unexpected git op).
    return blocked(`blocked: unknown git verb "${verb}" (default-deny — not a known read/write subcommand)`);
  }

  let classification: GitClassification = isRead && !isWrite ? 'read' : 'write';
  // branch/tag/remote can be read OR write depending on flags.
  if (verb === 'branch' || verb === 'tag' || verb === 'remote') {
    classification = reclassifyDualModeVerb(verb, safeArgs);
    if (classification === 'write') notes.push(`${verb} has a mutating flag/arg → treated as write`);
    else notes.push(`${verb} is in list/read form → treated as read`);
  }

  // ── build the argv deterministically: [verb, ...safeArgs] (+ -m message) ─────
  const argv: string[] = [verb, ...safeArgs];

  // ── commit message → its OWN argv element after -m (never interpolated) ──────
  if (rawMessage !== undefined && rawMessage !== null) {
    if (verb !== 'commit') {
      // Only commit consumes `message` here; ignore it elsewhere (don't silently
      // inject -m into verbs that don't take it) but note it.
      notes.push(`message ignored: "git ${verb}" does not take a -m message via this policy`);
    } else if (typeof rawMessage !== 'string') {
      return blocked('commit message must be a string');
    } else if (rawMessage.length > MAX_GIT_MESSAGE_LENGTH) {
      return blocked(`commit message exceeds ${MAX_GIT_MESSAGE_LENGTH} chars`);
    } else {
      // A NUL in the message would break the argv boundary at the OS layer; other
      // control chars (incl. newlines) are legitimate in a commit body, so only
      // NUL is rejected. Metacharacters/quotes are SAFE — this is a single argv
      // token passed to execFile, never a shell string.
      // eslint-disable-next-line no-control-regex
      if (/\x00/.test(rawMessage)) {
        return blocked('commit message contains a NUL byte');
      }
      argv.push('-m', rawMessage);
    }
  }

  // Belt-and-suspenders: no built token may carry a NUL (the argv boundary char).
  // Other control chars in args were already rejected; the message may contain
  // newlines (a valid multi-line commit body), so only NUL is fatal here.
  for (const token of argv) {
    if (typeof token !== 'string') {
      return blocked('built an argv token that is not a string');
    }
    // eslint-disable-next-line no-control-regex
    if (/\x00/.test(token)) {
      return blocked('built an argv token containing a NUL byte');
    }
  }

  const approvalTier: GitApprovalTier = classification === 'read' ? 'auto' : 'ask';
  const reason =
    classification === 'read'
      ? `read-only git ${verb} (safe to run)`
      : `git ${verb} mutates the repo — approval required`;

  return { ok: true, argv, classification, approvalTier, reason, notes };
}

/** One-line, bounded description for an approval preview / notice. Never throws.
 *  Reflects the SAME decision as planGitCommand (blocked plans say so). */
export function describeGitCommand(input: unknown): string {
  const plan = planGitCommand(input);
  const verb =
    input && typeof input === 'object' && typeof (input as GitCommandInput).verb === 'string'
      ? String((input as GitCommandInput).verb).trim().slice(0, 32)
      : '?';
  if (!plan.ok) {
    return `Blocked git command (${verb}): ${plan.reason}`.slice(0, 200);
  }
  // Show the argv compactly (message truncated so a long body never bloats the
  // preview). The bridge shows the full diff/preview at approval time.
  const shown = plan.argv
    .map((t) => (t.length > 48 ? `${t.slice(0, 45)}…` : t))
    .join(' ');
  const tier = plan.approvalTier === 'auto' ? 'auto' : 'approval-gated';
  return `git ${shown} (${plan.classification}, ${tier})`.slice(0, 200);
}
