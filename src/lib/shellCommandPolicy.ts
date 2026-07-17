// shellCommandPolicy — the PURE safety/classification brain for a coding-agent
// shell tool (plan P2). It does NOT execute anything: a gated bridge endpoint
// (execFile) runs the command later. This module decides, for a proposed
// command, whether it is a safe READ (auto), a mutating action (needs approval),
// or a CATASTROPHIC pattern that is refused outright — plus a timeout clamp and a
// secret-redacted preview for the approval banner.
//
// Posture (fail-safe): an UNKNOWN leading command defaults to `mutate` (ask), any
// command that chains/pipes/substitutes escalates to the HIGHEST tier of its
// parts (a read piped into a mutation is NOT auto), and a small set of
// unrecoverable patterns (rm -rf / , curl|sh , sudo , dd of=/dev , fork bomb ,
// force-push , …) are BLOCKED. Over-classifying toward ask/blocked is safe; the
// only real failure would be calling something `read` that mutates — so the read
// allowlist is deliberately conservative.
//
// PURITY: zero imports, tsx-loadable (smoke: shell-command-policy). Never throws.

export type ShellClassification = 'read' | 'mutate' | 'blocked';
export type ShellApprovalTier = 'auto' | 'ask' | 'never';

export interface ShellCommandDecision {
  /** true when the command may proceed (read or mutate); false = blocked/invalid. */
  ok: boolean;
  classification: ShellClassification;
  /** auto = run now; ask = approval-gate; never = refuse. */
  approvalTier: ShellApprovalTier;
  reason: string;
  /** Timeout clamped into [MIN, MAX]. */
  clampedTimeoutMs: number;
  /** Secret-redacted, length-bounded echo for the approval preview. */
  preview: string;
  notes: string[];
}

export const SHELL_TIMEOUT_MIN_MS = 1_000;
export const SHELL_TIMEOUT_DEFAULT_MS = 120_000;
export const SHELL_TIMEOUT_MAX_MS = 600_000;
export const MAX_COMMAND_LEN = 8_192;
export const MAX_PREVIEW_LEN = 200;

// Leading commands that only READ (auto). Conservative: iterative-dev commands
// (test/build/typecheck/lint) are included because the run-and-fix loop needs
// them auto — but anything that installs, writes, or is unknown is NOT here.
const READ_LEADS = new Set([
  'ls', 'cat', 'pwd', 'echo', 'printf', 'which', 'type', 'find', 'grep', 'rg', 'ag',
  // `uniq in out` writes a file and `env CMD …` execs an arbitrary wrapped
  // command (also launders the bridge's argv[0] blocklist) — both removed so
  // they fall through to mutate→ask. `sort` stays but is guarded below (`-o`).
  'head', 'tail', 'wc', 'sort', 'cut', 'stat', 'file', 'tree', 'du', 'df',
  'date', 'whoami', 'id', 'uname', 'printenv', 'realpath', 'dirname',
  'basename', 'cksum', 'shasum', 'md5', 'md5sum', 'diff', 'cmp', 'tac', 'nl',
  'column', 'jq', 'yq', 'pgrep', 'ps', 'top', 'hostname', 'true', 'false', 'test',
  // dev toolchain — non-mutating runs (build output dirs are recoverable)
  'pytest', 'tsc', 'eslint', 'prettier', 'ruff', 'mypy', 'flake8', 'jest', 'vitest',
]);

// npm/cargo/go/etc. subcommands that only READ/test/build (auto). The install/
// publish/mutate subcommands are NOT here → default mutate.
const SUBCOMMAND_READS: Record<string, Set<string>> = {
  npm: new Set(['test', 'run', 'ls', 'list', 'view', 'why', 'outdated', 'doctor', 'ping', 'exec']),
  pnpm: new Set(['test', 'run', 'ls', 'list', 'why', 'outdated', 'exec']),
  yarn: new Set(['test', 'run', 'why', 'list', 'info']),
  cargo: new Set(['build', 'test', 'check', 'clippy', 'fmt', 'tree', 'metadata', 'bench']),
  go: new Set(['build', 'test', 'vet', 'list', 'version', 'env', 'doc']),
  // NOTE: `-c <code>` is arbitrary-code eval and `-m <module>` runs a module
  // (pip/venv/…), so neither is read-only — both must fall through to mutate→ask.
  // Only `--version` stays auto; `-V` is omitted because secondWord lowercases it
  // to `-v` (verbose-RUN, which executes a script) — so `python -V` safely over-asks.
  python: new Set(['--version']),
  python3: new Set(['--version']),
  npx: new Set(['tsc', 'eslint', 'prettier', 'vitest', 'jest']),
  // config/branch/tag/remote each have a mutating form the shell classifier
  // can't see (`git config k v`, `git branch -D`, `git tag -d`, `git remote add`);
  // route git mutation through gitCommandPolicy, not this auto path.
  git: new Set(['status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'describe', 'ls-files', 'shortlog']),
  dotnet: new Set(['build', 'test']),
  mvn: new Set(['test', 'compile', 'verify']),
  gradle: new Set(['test', 'build', 'check']),
};

// Leading commands that MUTATE (ask).
const MUTATE_LEADS = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'chgrp', 'ln',
  'tee', 'kill', 'killall', 'pkill', 'sed', 'patch', 'install', 'ln', 'truncate',
  'npm', 'pnpm', 'yarn', 'pip', 'pip3', 'poetry', 'gem', 'bundle', 'brew', 'apt',
  'apt-get', 'yum', 'dnf', 'pacman', 'make', 'cmake', 'docker', 'kubectl', 'helm',
  'terraform', 'ansible', 'systemctl', 'launchctl', 'crontab', 'git', 'svn', 'hg',
  'go', 'cargo', 'rustup', 'node', 'python', 'python3', 'ruby', 'perl', 'deno',
  'bun', 'dotnet', 'mvn', 'gradle', 'npx', 'xargs',
]);

// CATASTROPHIC / unrecoverable patterns — refused outright (never). Tested on the
// whole command (not per-segment) so a piped/quoted variant is still caught.
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/(^|[\s;|&(])sudo\s/, 'privilege escalation (sudo)'],
  [/\bdoas\s/, 'privilege escalation (doas)'],
  // rm -r… targeting root / home / a wildcard root (with or without -f)
  [/\brm\s+(-\S+\s+)*-[a-zA-Z]*[rR][a-zA-Z]*\s+(\/|~|\$HOME)([/\s*]|$)/, 'recursive delete of root/home'],
  [/:\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:[^}]*&[^}]*\}/, 'fork bomb'],
  [/\b(mkfs|mke2fs|mkswap|fdisk|parted)\b/, 'disk/partition mutation'],
  [/\bdd\b[^;|&\n]*\bof=\/dev\//, 'dd write to a device'],
  [/[>|]\s*\/dev\/(sd|disk|hd|nvme|rdisk|mmcblk)/, 'write to a raw disk device'],
  [/>\s*\/(etc|boot|sys|proc|dev\/mem)\b/, 'write to a protected system path'],
  [/\b(curl|wget|fetch)\b[^;|&\n]*\|\s*(sudo\s+)?(sh|bash|zsh|dash|fish|python[0-9.]*|node|perl|ruby)\b/, 'pipe remote content into a shell interpreter'],
  [/\bchmod\s+(-R\s+)?[0-7]*7{3}[0-7]*\s+(\/|~|\$HOME)(\s|$)/, 'world-writable chmod on root/home'],
  [/\bgit\s+push\b[^;|&\n]*(--force\b|-f\b|--mirror\b|--delete\b)/, 'destructive git push'],
  [/\bgit\s+push\s+\S+\s+\+/, 'force-push refspec'],
  [/\bgit\s+(.*\s)?(filter-branch|filter-repo)\b/, 'git history rewrite'],
  [/(^|[\s;|&(])(eval|exec)\s/, 'shell eval/exec of a dynamic string'],
  [/>\s*~?\/\.(ssh|aws|gnupg|config\/gh)\b/, 'write into a credentials directory'],
];

// Segment separators — a command with any of these is compound; classify each
// part and take the highest tier.
// Split on &&, ||, ;, |, and newlines. Bare `&` (background) is intentionally
// NOT a separator here — matching it would wrongly split fd-dups like `2>&1`;
// the whole-command BLOCKED scan still catches a catastrophic backgrounded part.
const SEGMENT_SPLIT = /(?:&&|\|\||;|\||\n|\r)/;

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Redact secret-shaped tokens and clip for the approval preview. */
function redactPreview(command: string): string {
  let out = command
    .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9]{8,}/g, '$1-[redacted]')
    .replace(/\bghp_[A-Za-z0-9]{8,}/g, 'ghp_[redacted]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}/g, 'github_pat_[redacted]')
    .replace(/\bAKIA[A-Z0-9]{12,}/g, 'AKIA[redacted]')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, 'xox-[redacted]')
    .replace(/\b(bearer)\s+[A-Za-z0-9._-]{8,}/gi, '$1 [redacted]')
    .replace(/(--?(?:password|token|secret|api[-_]?key|auth)[=\s])(\S+)/gi, '$1[redacted]')
    .replace(/\b([A-Z_]*(?:PASSWORD|SECRET|TOKEN|API_?KEY)[A-Z_]*=)(\S+)/g, '$1[redacted]')
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, '[redacted-hex]');
  if (out.length > MAX_PREVIEW_LEN) out = `${out.slice(0, MAX_PREVIEW_LEN - 1)}…`;
  return out;
}

function leadingCommandWord(segment: string): string {
  // Skip leading VAR=value environment assignments to find the real command.
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  return (tokens[i] || '').toLowerCase();
}

function secondWord(segment: string): string {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1;
  return (tokens[i + 1] || '').toLowerCase();
}

/** Does this segment write output to a real file (not &N or /dev/null)? */
function hasFileRedirection(segment: string): boolean {
  // Strip 2>&1-style fd dups and /dev/null redirects, then look for a remaining >.
  const stripped = segment
    .replace(/\d*>&\d*/g, ' ')
    .replace(/\d*>>?\s*\/dev\/(null|stderr|stdout)\b/g, ' ');
  return /(^|\s)\d*>>?\s*\S/.test(stripped);
}

function classifySegment(segment: string): ShellClassification {
  const seg = segment.trim();
  if (!seg) return 'read';
  // Command substitution can hide anything → at least mutate.
  if (/\$\(|`/.test(seg)) return 'mutate';
  if (hasFileRedirection(seg)) return 'mutate';
  const lead = leadingCommandWord(seg);
  if (!lead) return 'read';
  // Subcommand-aware read (npm test, git diff, cargo build, …).
  if (SUBCOMMAND_READS[lead]) {
    const sub = secondWord(seg);
    if (SUBCOMMAND_READS[lead].has(sub)) return 'read';
    return 'mutate'; // known tool, non-read subcommand (install/commit/publish/…)
  }
  // A few read-leads have write/exec forms the lead word alone can't reveal:
  // `find … -delete/-exec` runs programs / deletes files (execvp, no shell), and
  // `sort -o FILE` writes a file. execFile passes argv literally, so those forms
  // really mutate → escalate to mutate (ask). Over-asking is the safe direction.
  if (lead === 'find' && /(?:^|\s)-(?:execdir|exec|okdir|ok|delete|fprintf|fprint0|fprint|fls)\b/.test(seg)) {
    return 'mutate';
  }
  if (lead === 'sort' && /(?:^|\s)(?:-o|--output)/.test(seg)) {
    return 'mutate';
  }
  if (READ_LEADS.has(lead)) return 'read';
  if (MUTATE_LEADS.has(lead)) return 'mutate';
  return 'mutate'; // unknown leading command → fail-safe to ask
}

/**
 * Classify a proposed shell command. Never throws; always returns a decision.
 * `ok` is false only for blocked/invalid commands.
 */
export function classifyShellCommand(command: unknown, opts?: { timeoutMs?: number }): ShellCommandDecision {
  const clampedTimeoutMs = clampInt(opts?.timeoutMs, SHELL_TIMEOUT_DEFAULT_MS, SHELL_TIMEOUT_MIN_MS, SHELL_TIMEOUT_MAX_MS);
  const base = { clampedTimeoutMs, notes: [] as string[] };

  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, classification: 'blocked', approvalTier: 'never', reason: 'empty or non-string command', preview: '', ...base };
  }
  const cmd = command.trim();
  if (cmd.length > MAX_COMMAND_LEN) {
    return { ok: false, classification: 'blocked', approvalTier: 'never', reason: `command exceeds ${MAX_COMMAND_LEN} chars`, preview: redactPreview(cmd), ...base };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(cmd)) {
    return { ok: false, classification: 'blocked', approvalTier: 'never', reason: 'command contains control characters', preview: redactPreview(cmd), ...base };
  }

  const preview = redactPreview(cmd);

  // 1) Catastrophic patterns — refuse outright.
  for (const [re, why] of BLOCKED_PATTERNS) {
    if (re.test(cmd)) {
      return { ok: false, classification: 'blocked', approvalTier: 'never', reason: `refused: ${why}`, preview, ...base };
    }
  }

  // 2) Classify each chained segment; overall = highest tier.
  const segments = cmd.split(SEGMENT_SPLIT).map((s) => s.trim()).filter(Boolean);
  const chained = segments.length > 1;
  let worst: ShellClassification = 'read';
  for (const seg of segments) {
    const c = classifySegment(seg);
    if (c === 'mutate' && worst === 'read') worst = 'mutate';
  }
  const notes: string[] = [];
  if (chained && worst === 'mutate') notes.push('compound command escalated to the highest-risk segment');

  if (worst === 'read') {
    return { ok: true, classification: 'read', approvalTier: 'auto', reason: 'read-only command', preview, clampedTimeoutMs, notes };
  }
  return { ok: true, classification: 'mutate', approvalTier: 'ask', reason: 'mutating or unrecognized command — approval required', preview, clampedTimeoutMs, notes };
}

/** One-line, bounded description for an approval preview. Never throws. */
export function describeShellCommand(command: unknown, opts?: { timeoutMs?: number }): string {
  const d = classifyShellCommand(command, opts);
  if (d.classification === 'blocked') return `Refused shell command (${d.reason})`;
  const verb = d.classification === 'read' ? 'Run (read-only)' : 'Run (approval-gated)';
  return `${verb}: ${d.preview}`;
}
