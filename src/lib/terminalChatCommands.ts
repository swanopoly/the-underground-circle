/**
 * terminalChatCommands — handles /run, /sh, /cd, /pwd slash commands.
 *
 * Routes through the existing claude-bridge `/exec` endpoint via
 * `execBridgeCommand` (claudeCodeDetector.ts). The bridge is
 * localhost-only and applies its own blocked-pattern filter; this
 * layer just wraps the command with a sticky working directory per
 * circle and formats the result for the chat UI.
 *
 * Output from /run is rendered with TerminalOutputCard and is NEVER
 * persisted to Supabase — shell output may contain secrets, paths,
 * env state, etc. It lives only in the local message timeline.
 */

import { execBridgeCommand, detectClaudeCodeBridge } from './claudeCodeDetector';

const CWD_STORAGE_PREFIX = 'uc_terminal_cwd_v1:';

export interface TerminalRunResult {
  command: string;             // raw command as the user typed it
  effectiveCommand: string;    // command actually sent to the bridge (with cd prefix)
  cwd: string | null;          // resolved working directory, or null if none
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
  durationMs: number;
  error?: string;
}

export type TerminalCommandOutcome =
  | { kind: 'run'; result: TerminalRunResult }
  | { kind: 'message'; text: string; tone: 'info' | 'warn' | 'error' };

// ── CWD persistence (per circle) ────────────────────────────────────────────

function cwdKey(circleId: string): string {
  return `${CWD_STORAGE_PREFIX}${circleId}`;
}

export function getStoredCwd(circleId: string): string | null {
  if (typeof window === 'undefined' || !circleId) return null;
  try {
    const v = window.localStorage.getItem(cwdKey(circleId));
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

export function setStoredCwd(circleId: string, cwd: string | null): void {
  if (typeof window === 'undefined' || !circleId) return;
  try {
    if (!cwd) window.localStorage.removeItem(cwdKey(circleId));
    else window.localStorage.setItem(cwdKey(circleId), cwd);
  } catch { /* localStorage may be disabled */ }
}

// ── Command parsing ─────────────────────────────────────────────────────────

/**
 * Detect whether the input is a terminal slash command. Returns the
 * normalized verb + remainder, or null if not a terminal command.
 */
export function parseTerminalCommand(input: string): { verb: 'run' | 'cd' | 'pwd' | 'diag'; rest: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const lower = trimmed.toLowerCase();

  // /run <cmd>  or  /sh <cmd>
  for (const prefix of ['/run ', '/sh ', '/exec ', '/$ ']) {
    if (lower.startsWith(prefix)) {
      const rest = trimmed.slice(prefix.length).trim();
      return { verb: 'run', rest };
    }
  }
  // Bare /run or /sh — show usage
  if (lower === '/run' || lower === '/sh' || lower === '/exec' || lower === '/$') {
    return { verb: 'run', rest: '' };
  }

  // /cd <path>  or  bare /cd  (clears)
  if (lower === '/cd') return { verb: 'cd', rest: '' };
  if (lower.startsWith('/cd ')) return { verb: 'cd', rest: trimmed.slice(4).trim() };

  // /pwd
  if (lower === '/pwd') return { verb: 'pwd', rest: '' };

  // /diag bridge — quick liveness probe for the local claude-bridge.
  // Useful when /run errors with "bridge unreachable" and the user
  // wants to confirm whether it's the bridge or the network.
  if (lower === '/diag bridge' || lower === '/diag-bridge') {
    return { verb: 'diag', rest: 'bridge' };
  }

  return null;
}

// ── Executor ────────────────────────────────────────────────────────────────

/**
 * Wrap a user command with the sticky cwd if one is set.
 * Uses `&&` so a cd failure aborts before running the command.
 */
function buildEffectiveCommand(rawCommand: string, cwd: string | null): string {
  if (!cwd) return rawCommand;
  // Single-quote escaping: terminate, escape, restart.
  const escapedCwd = cwd.replace(/'/g, `'\\''`);
  return `cd '${escapedCwd}' && ${rawCommand}`;
}

export async function executeTerminalCommand(opts: {
  circleId: string;
  input: string;
}): Promise<TerminalCommandOutcome> {
  const parsed = parseTerminalCommand(opts.input);
  if (!parsed) {
    return { kind: 'message', text: 'Not a terminal command.', tone: 'warn' };
  }

  // /pwd — show current cwd
  if (parsed.verb === 'pwd') {
    const cwd = getStoredCwd(opts.circleId);
    return {
      kind: 'message',
      tone: 'info',
      text: cwd
        ? `Working directory for this circle: \`${cwd}\``
        : 'No sticky working directory set. Use `/cd <path>` to set one. Otherwise commands run in the bridge\'s default directory.',
    };
  }

  // /cd <path> — set or clear cwd
  if (parsed.verb === 'cd') {
    if (!parsed.rest || parsed.rest === '~' || parsed.rest === '-') {
      setStoredCwd(opts.circleId, null);
      return { kind: 'message', tone: 'info', text: 'Cleared sticky working directory.' };
    }
    // Validate the path actually exists by running `cd <path> && pwd` through the bridge.
    const probe = await execBridgeCommand(`cd '${parsed.rest.replace(/'/g, `'\\''`)}' && pwd`);
    if (!probe.ok || !probe.stdout) {
      return {
        kind: 'message',
        tone: 'error',
        text: `Could not enter \`${parsed.rest}\`: ${probe.error || probe.stderr || 'unknown error'}`.trim(),
      };
    }
    const resolved = probe.stdout.trim().split('\n')[0] || parsed.rest;
    setStoredCwd(opts.circleId, resolved);
    return {
      kind: 'message',
      tone: 'info',
      text: `Working directory set to \`${resolved}\` for this circle. Future \`/run\` commands will execute there.`,
    };
  }

  // /diag bridge — quick liveness check
  if (parsed.verb === 'diag') {
    const startedAt = Date.now();
    const ok = await detectClaudeCodeBridge();
    const duration = Date.now() - startedAt;
    if (ok) {
      return {
        kind: 'message',
        tone: 'info',
        text: `Bridge online. Health responded in ${duration}ms. \`/run\`, \`/sh\`, and code-block RUN buttons should work.`,
      };
    }
    return {
      kind: 'message',
      tone: 'error',
      text: `Bridge offline (probe took ${duration}ms). Start it with \`npm run bridges:up\` or \`node scripts/claude-bridge.js\` from the project root.`,
    };
  }

  // /run <cmd>
  if (!parsed.rest) {
    return {
      kind: 'message',
      tone: 'info',
      text: 'Usage: `/run <command>` — runs the command on your local machine via the claude-bridge. Set a working directory with `/cd <path>`. Aliases: `/sh`, `/exec`. Diagnose with `/diag bridge`.',
    };
  }

  const cwd = getStoredCwd(opts.circleId);
  const effectiveCommand = buildEffectiveCommand(parsed.rest, cwd);
  const startedAt = Date.now();
  const bridge = await execBridgeCommand(effectiveCommand);
  const durationMs = Date.now() - startedAt;

  return {
    kind: 'run',
    result: {
      command: parsed.rest,
      effectiveCommand,
      cwd,
      ok: !!bridge.ok,
      stdout: bridge.stdout || '',
      stderr: bridge.stderr || '',
      code: typeof bridge.code === 'number' ? bridge.code : null,
      durationMs,
      error: bridge.error,
    },
  };
}
