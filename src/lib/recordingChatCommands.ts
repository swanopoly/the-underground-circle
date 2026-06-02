/**
 * recordingChatCommands — parses `/record` and `/replay` slash
 * commands from the chat composer. Pure parser + dispatcher (no UI);
 * ChatTab wires the chat-intercept to call `executeRecordingCommand`
 * before the planner sees the message.
 */
import {
  abortRecording,
  deleteRecording,
  getActiveSession,
  getRecording,
  listRecordings,
  planReplay,
  startRecording,
  stopRecording,
  type Recording,
  type ReplayInvocation,
} from './chatRecording';

export type RecordingCommandOutcome = {
  message: string;
  localOnly: true;
};

export interface RecordingCommandContext {
  circleId: string;
  userId: string;
  /** Dispatcher reference — injected so replay can fire tool calls
   *  through the same client path as the v2 continuation loop. */
  fireTool: (call: { tool: string; input: Record<string, unknown> }) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
}

// ─── Helpers ────────────────────────────────────────────────────────

function usage(): string {
  return [
    '**Recording commands**',
    '- `/record start <name>` — begin capturing tool calls',
    '- `/record stop [description]` — save current session',
    '- `/record status` — show what\'s being captured right now',
    '- `/record abort` — discard the current session',
    '- `/record list` — show saved recordings',
    '- `/record delete <name>` — delete a saved recording',
    '- `/replay <name>` — re-fire a saved recording\'s steps',
  ].join('\n');
}

function recordingLine(r: Recording): string {
  const ago = formatAgo(Date.now() - r.createdAt);
  return `- **${r.name}** · ${r.steps.length} steps · ${(r.durationMs / 1000).toFixed(1)}s · ${ago}: _${r.description}_`;
}

function formatAgo(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// ─── /record parser ────────────────────────────────────────────────

export function isRecordingCommand(text: string): boolean {
  const t = String(text || '').trim().toLowerCase();
  return t.startsWith('/record') || t.startsWith('/replay');
}

export async function executeRecordingCommand(
  text: string,
  ctx: RecordingCommandContext,
): Promise<RecordingCommandOutcome | null> {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  const head = parts[0].toLowerCase();

  if (head === '/replay') {
    const name = parts.slice(1).join(' ').trim();
    if (!name) return { message: 'Usage: `/replay <name>`. See `/record list`.', localOnly: true };
    return await doReplay(name, ctx);
  }

  if (head !== '/record') return null;

  const sub = (parts[1] || '').toLowerCase();
  const rest = parts.slice(2).join(' ').trim();

  switch (sub) {
    case '':
    case 'help':
      return { message: usage(), localOnly: true };

    case 'start': {
      if (!rest) return { message: 'Usage: `/record start <name>`', localOnly: true };
      const r = startRecording({ name: rest, circleId: ctx.circleId, userId: ctx.userId });
      if (!r.ok) return { message: `Recording error: ${r.error}`, localOnly: true };
      return {
        message: `Recording **${r.session.name}** started. Every desktop / browser action is captured. `
          + `Run the workflow, then \`/record stop\` to save.`,
        localOnly: true,
      };
    }

    case 'stop': {
      const r = stopRecording({ description: rest || undefined });
      if (!r.ok) return { message: `Recording error: ${r.error}`, localOnly: true };
      return {
        message: `Saved recording **${r.recording.name}** — ${r.recording.steps.length} steps, ${(r.recording.durationMs / 1000).toFixed(1)}s. `
          + `Replay with \`/replay ${r.recording.name}\`.`,
        localOnly: true,
      };
    }

    case 'status': {
      const active = getActiveSession();
      if (!active) return { message: 'No recording in progress. `/record start <name>` to begin.', localOnly: true };
      const sec = Math.max(0, Math.floor((Date.now() - active.startedAt) / 1000));
      const last = active.steps[active.steps.length - 1];
      const lastLine = last
        ? `  - Last: ${last.outcome.summary || last.tool}`
        : '  - No steps yet — run some actions to capture them.';
      return {
        message: [
          `Recording **${active.name}** — ${active.steps.length} steps captured · ${sec}s elapsed`,
          lastLine,
        ].join('\n'),
        localOnly: true,
      };
    }

    case 'abort': {
      const r = abortRecording();
      return { message: `Aborted recording (discarded ${r.discardedSteps} steps).`, localOnly: true };
    }

    case 'list': {
      const rows = listRecordings({ circleId: ctx.circleId });
      if (rows.length === 0) {
        return { message: 'No saved recordings yet for this circle. `/record start <name>` to capture one.', localOnly: true };
      }
      return {
        message: [
          `**${rows.length} recording${rows.length === 1 ? '' : 's'}** in this circle:`,
          ...rows.slice(0, 20).map(recordingLine),
        ].join('\n'),
        localOnly: true,
      };
    }

    case 'delete': {
      if (!rest) return { message: 'Usage: `/record delete <name>`', localOnly: true };
      const ok = deleteRecording(rest);
      return {
        message: ok ? `Deleted recording **${rest}**.` : `No recording named **${rest}**.`,
        localOnly: true,
      };
    }

    default:
      return { message: `Unknown subcommand \`${sub}\`. ${usage()}`, localOnly: true };
  }
}

// ─── /replay dispatcher ────────────────────────────────────────────

async function doReplay(name: string, ctx: RecordingCommandContext): Promise<RecordingCommandOutcome> {
  const recording = getRecording(name);
  if (!recording) {
    return { message: `No recording named **${name}**. Run \`/record list\` to see saved ones.`, localOnly: true };
  }
  const plan = planReplay(recording);
  if (plan.length === 0) {
    return { message: `Recording **${name}** has no successful steps to replay.`, localOnly: true };
  }

  const lines: string[] = [`Replaying **${name}** — ${plan.length} steps`];
  let okCount = 0;
  for (let i = 0; i < plan.length; i += 1) {
    const step = plan[i];
    const result = await runReplayStep(step, ctx);
    if (result.ok) {
      okCount += 1;
      lines.push(`- ✓ ${i + 1}. ${step.tool}${result.note ? ` — ${result.note}` : ''}`);
    } else {
      lines.push(`- ✗ ${i + 1}. ${step.tool} — ${result.error || 'failed'}`);
      // Stop on first failure — continuing usually makes things worse
      // (typing into the wrong field, clicking the wrong thing).
      lines.push(`  (halted; ran ${okCount}/${plan.length} steps)`);
      break;
    }
  }
  if (okCount === plan.length) {
    lines.push(`All ${plan.length} steps replayed successfully.`);
  }
  return { message: lines.join('\n'), localOnly: true };
}

/**
 * Fires a single replay invocation. For semantic desktop AX actions
 * with a captured target, we try re-discovery first (re-fetch the a11y
 * tree, find the element by label+role, act on its new path). If target
 * lookup fails, fall back to the original path as a last resort.
 */
async function runReplayStep(
  inv: ReplayInvocation,
  ctx: RecordingCommandContext,
): Promise<{ ok: boolean; note?: string; error?: string }> {
  if ((inv.tool === 'desktop.click_element' || inv.tool === 'desktop.set_element_value') && (inv.input as any)._target) {
    const target = (inv.input as any)._target as { role?: string; label?: string; app?: string };
    if (target.app && target.label) {
      // Refetch current tree — pid + text come back on this call.
      const tree = await ctx.fireTool({ tool: 'desktop.read_a11y_tree', input: { appName: target.app, maxDepth: 8, maxNodes: 250 } });
      if (tree.ok) {
        const data = (tree.data || {}) as { pid?: number; text?: string };
        const found = findInTree(data.text, target.label, target.role);
        if (data.pid && found.path) {
          const action = await ctx.fireTool({
            tool: inv.tool,
            input: inv.tool === 'desktop.set_element_value'
              ? { pid: data.pid, path: found.path, text: inv.input.text }
              : { pid: data.pid, path: found.path },
          });
          if (action.ok) return { ok: true, note: `resolved "${target.label}" → ${found.path}` };
          return { ok: false, error: action.error || `${inv.tool} failed` };
        }
      }
    }
    // Fallback: original path (may fail if tree shifted).
    const fallback = await ctx.fireTool({
      tool: inv.tool,
      input: inv.tool === 'desktop.set_element_value'
        ? { pid: inv.input.pid, path: inv.input.path, text: inv.input.text }
        : { pid: inv.input.pid, path: inv.input.path },
    });
    return { ok: fallback.ok, error: fallback.error, note: fallback.ok ? 'used recorded path (no semantic match)' : undefined };
  }

  // Everything else: re-fire verbatim.
  const cleanInput = { ...inv.input };
  delete (cleanInput as any)._target;
  const result = await ctx.fireTool({ tool: inv.tool, input: cleanInput });
  return { ok: result.ok, error: result.error };
}

/**
 * Tiny parser over the flattened a11y-tree text we send to the model
 * (format: `[path] role "label"`). Finds the first row whose label
 * matches (exact or substring) + role matches.
 *
 * Exported for smoke tests.
 */
export function findInTree(text: string | undefined, label: string, role?: string): { path?: string } {
  if (!text) return {};
  const needle = label.toLowerCase();
  const lines = String(text).split('\n');
  for (const line of lines) {
    const m = line.match(/\[([0-9.]+)\]\s+(\w+)(?:\s+"([^"]*)")?/);
    if (!m) continue;
    const [, path, rowRole, rowLabel = ''] = m;
    if (role && rowRole.toLowerCase() !== role.toLowerCase()) continue;
    if (!rowLabel.toLowerCase().includes(needle)) continue;
    return { path };
  }
  return {};
}
