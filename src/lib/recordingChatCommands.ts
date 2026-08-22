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

export type RecordingReplayRuntimeRequirement =
  | 'authenticated_user_id'
  | 'circle_id'
  | 'persisted_agent_run_id'
  | 'provider_tool_use_id'
  | 'tool_iteration'
  | 'fresh_observation'
  | 'exact_openswan_runtime_approval';

export interface RecordingReplayRuntimeHandoff {
  schemaVersion: 1;
  kind: 'openswan_typed_runtime_plan';
  sourceLane: 'recording_replay';
  reasonCode: 'sealed_runtime_identity_and_approval_required';
  executable: false;
  blockedTools: string[];
  blockedStepCount: number;
  totalSteps: number;
  requiredContext: RecordingReplayRuntimeRequirement[];
  message: string;
}

export type RecordingCommandOutcome = {
  message: string;
  localOnly: true;
  runtimeHandoff?: RecordingReplayRuntimeHandoff;
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
    '- `/replay <name>` — repeat observation-only steps; mutations return a safe OpenSwan handoff',
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

/**
 * `/replay` is a local convenience for observation-only recordings, not an
 * alternate mutation runtime. The allowlist stays deliberately small. Any
 * future browser/desktop tool is blocked until explicitly reviewed here.
 */
const READ_ONLY_REPLAY_OBSERVATION_TOOLS = new Set([
  'browser.dom_snapshot',
  'browser.screenshot',
  'browser.verification_state',
  'desktop.list_running_apps',
  'desktop.read_a11y_tree',
  'desktop.screen_size',
  'desktop.screenshot',
  'desktop.window_state',
]);

const RECORDING_REPLAY_RUNTIME_REQUIREMENTS: RecordingReplayRuntimeRequirement[] = [
  'authenticated_user_id',
  'circle_id',
  'persisted_agent_run_id',
  'provider_tool_use_id',
  'tool_iteration',
  'fresh_observation',
  'exact_openswan_runtime_approval',
];

function buildReplayRuntimeHandoff(
  plan: ReplayInvocation[],
): RecordingReplayRuntimeHandoff | null {
  const blockedSteps = plan.filter((step) => {
    const tool = String(step.tool || '').trim().toLowerCase();
    const isComputerSurface = tool.startsWith('browser.') || tool.startsWith('desktop.');
    return isComputerSurface && !READ_ONLY_REPLAY_OBSERVATION_TOOLS.has(tool);
  });
  if (blockedSteps.length === 0) return null;
  const blockedTools = Array.from(new Set(
    blockedSteps.map((step) => String(step.tool || '').trim()).filter(Boolean),
  )).slice(0, 20);
  const message = 'Saved mutation replay requires the sealed OpenSwan typed runtime. '
    + 'Start a fresh authenticated Chat/OpenSwan run with a persisted run identity, '
    + 'freshly observe every target, and approve each exact mutating tool call. '
    + 'This recording cannot fabricate provider tool-use IDs, iterations, run IDs, '
    + 'observations, or approval receipts, so zero replay steps were executed.';
  return {
    schemaVersion: 1,
    kind: 'openswan_typed_runtime_plan',
    sourceLane: 'recording_replay',
    reasonCode: 'sealed_runtime_identity_and_approval_required',
    executable: false,
    blockedTools,
    blockedStepCount: blockedSteps.length,
    totalSteps: plan.length,
    requiredContext: [...RECORDING_REPLAY_RUNTIME_REQUIREMENTS],
    message,
  };
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
      const r = stopRecording({ userId: ctx.userId, circleId: ctx.circleId, description: rest || undefined });
      if (!r.ok) return { message: `Recording error: ${r.error}`, localOnly: true };
      return {
        message: `Saved recording **${r.recording.name}** — ${r.recording.steps.length} steps, ${(r.recording.durationMs / 1000).toFixed(1)}s. `
          + `Inspect observation-only steps with \`/replay ${r.recording.name}\`; mutation steps require a fresh OpenSwan run.`,
        localOnly: true,
      };
    }

    case 'status': {
      const active = getActiveSession(ctx);
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
      const r = abortRecording(ctx);
      return { message: `Aborted recording (discarded ${r.discardedSteps} steps).`, localOnly: true };
    }

    case 'list': {
      const rows = listRecordings(ctx);
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
      const ok = deleteRecording(rest, ctx);
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
  const recording = getRecording(name, ctx);
  if (!recording) {
    return { message: `No recording named **${name}**. Run \`/record list\` to see saved ones.`, localOnly: true };
  }
  const plan = planReplay(recording);
  if (plan.length === 0) {
    return { message: `Recording **${name}** has no successful steps to replay.`, localOnly: true };
  }
  // Preflight the complete plan before the first observation or mutation.
  // This prevents a semantic re-discovery read (or any earlier read-only step)
  // from running before a later recorded mutation is discovered.
  const runtimeHandoff = buildReplayRuntimeHandoff(plan);
  if (runtimeHandoff) {
    const blocked = runtimeHandoff.blockedTools.length > 0
      ? runtimeHandoff.blockedTools.map((tool) => `\`${tool}\``).join(', ')
      : 'one or more browser/desktop mutation steps';
    return {
      message: [
        `Replay **${name}** was not executed because its ${runtimeHandoff.blockedStepCount} blocked step${runtimeHandoff.blockedStepCount === 1 ? '' : 's'} require the OpenSwan typed runtime: ${blocked}.`,
        runtimeHandoff.message,
      ].join('\n'),
      localOnly: true,
      runtimeHandoff,
    };
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

/** Fires one already-preflighted observation invocation. */
async function runReplayStep(
  inv: ReplayInvocation,
  ctx: RecordingCommandContext,
): Promise<{ ok: boolean; note?: string; error?: string }> {
  const tool = String(inv.tool || '').trim().toLowerCase();
  if (!READ_ONLY_REPLAY_OBSERVATION_TOOLS.has(tool)) {
    return {
      ok: false,
      error: 'Replay invocation is outside the reviewed observation-only allowlist.',
    };
  }

  // Observation inputs are bounded by their individual runtime schemas.
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
