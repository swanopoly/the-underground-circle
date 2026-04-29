/**
 * terminalCommandParser — pure parsing logic for /run /sh /cd /pwd /diag.
 *
 * Extracted from terminalChatCommands.ts so smoketests can import it
 * without pulling in claudeCodeDetector / supabase / react-native.
 * No DOM, no fetch, no side effects — just string→struct.
 */

export type TerminalVerb = 'run' | 'cd' | 'pwd' | 'diag';

export interface ParsedTerminalCommand {
  verb: TerminalVerb;
  rest: string;
}

export function parseTerminalCommand(input: string): ParsedTerminalCommand | null {
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

  // /diag bridge — quick liveness probe for the local claude-bridge
  // (kept as an alias for back-compat). /diag without args probes ALL
  // bridges. /diag <name> drills into one (claude-code, codex,
  // gemini-cli, cursor, openswan-proxy).
  if (lower === '/diag bridge' || lower === '/diag-bridge') {
    return { verb: 'diag', rest: 'bridge' };
  }
  if (lower === '/diag' || lower === '/diag all') {
    return { verb: 'diag', rest: 'all' };
  }
  if (lower.startsWith('/diag ')) {
    return { verb: 'diag', rest: trimmed.slice(6).trim() };
  }

  return null;
}

/**
 * Wrap a user command with the sticky cwd if one is set.
 * Uses `&&` so a cd failure aborts before running the command.
 */
export function buildEffectiveCommand(rawCommand: string, cwd: string | null): string {
  if (!cwd) return rawCommand;
  // Single-quote escaping: terminate, escape, restart.
  const escapedCwd = cwd.replace(/'/g, `'\\''`);
  return `cd '${escapedCwd}' && ${rawCommand}`;
}
