/**
 * Mission Chat Commands — /mission slash commands for ChatTab
 * See docs/NEXT_LEVEL_PLAN.md Phase 2.1
 */
import {
  getMissions,
  getMissionTasks,
  createMission,
  updateMission,
  updateMissionTask,
  missionProgress,
  formatDeadline,
  isOverdue,
  Mission,
  MissionTask,
} from './missions';

interface CommandContext {
  circleId: string;
  userId: string;
}

interface CommandResult {
  message: string;
  success: boolean;
}

/**
 * Execute a /mission command
 * Usage:
 *   /mission                 — show all active missions
 *   /mission status          — detailed status report
 *   /mission <title>         — create a new blank mission
 */
export async function executeMissionCommand(
  raw: string,
  ctx: CommandContext,
): Promise<CommandResult> {
  const args = raw.replace(/^\/mission\s*/i, '').trim();
  const cmd = args.toLowerCase();

  // /mission or /mission status — show mission status report
  if (!args || cmd === 'status' || cmd === 'report') {
    return missionStatusReport(ctx);
  }

  // /mission create <title> — create a new mission
  if (cmd.startsWith('create ')) {
    const title = args.slice(7).trim();
    if (!title) return { message: 'Usage: `/mission create <title>`', success: false };
    const { mission, error } = await createMission(ctx.circleId, ctx.userId, title);
    if (error) return { message: `Failed to create mission: ${error}`, success: false };
    return { message: `Mission created: **${mission!.title}**\nOpen the Missions tab to add tasks and set a deadline.`, success: true };
  }

  // /mission complete — mark most recent active mission as complete
  if (cmd === 'complete' || cmd === 'done') {
    const missions = await getMissions(ctx.circleId);
    const active = missions.filter(m => m.status === 'active');
    if (active.length === 0) return { message: 'No active missions to complete.', success: false };
    const latest = active[0];
    const { error } = await updateMission(latest.id, { status: 'completed' });
    if (error) return { message: `Failed: ${error}`, success: false };
    return { message: `Mission completed: **${latest.title}**`, success: true };
  }

  // /mission help
  if (cmd === 'help') {
    return {
      message: [
        '**Mission Commands**',
        '`/mission` — show active missions status',
        '`/mission status` — detailed progress report',
        '`/mission create <title>` — create a new mission',
        '`/mission complete` — mark latest mission as done',
        '`/mission help` — show this help',
      ].join('\n'),
      success: true,
    };
  }

  // Default: treat as create
  const { mission, error } = await createMission(ctx.circleId, ctx.userId, args);
  if (error) return { message: `Failed: ${error}`, success: false };
  return { message: `Mission created: **${mission!.title}**\nOpen the Missions tab to add tasks.`, success: true };
}

/** Generate a formatted mission status report */
async function missionStatusReport(ctx: CommandContext): Promise<CommandResult> {
  const missions = await getMissions(ctx.circleId);
  const active = missions.filter(m => m.status === 'active');
  const completed = missions.filter(m => m.status === 'completed');

  if (missions.length === 0) {
    return {
      message: 'No missions yet. Create one with `/mission create <title>` or from the Missions tab.',
      success: true,
    };
  }

  const lines: string[] = [];
  lines.push(`**Mission Status** — ${active.length} active, ${completed.length} completed`);
  lines.push('');

  for (const m of active) {
    const tasks = await getMissionTasks(m.id);
    const progress = missionProgress(tasks);
    const done = tasks.filter(t => t.status === 'done').length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;
    const overdue = isOverdue(m);
    const deadline = formatDeadline(m.deadline);

    const statusIcon = overdue ? '!!' : progress === 100 ? 'OK' : '>>';
    lines.push(`[${statusIcon}] **${m.title}** — ${progress}% (${done}/${tasks.length})${blocked > 0 ? ` | ${blocked} blocked` : ''} | ${deadline}${overdue ? ' OVERDUE' : ''}`);

    // Show incomplete tasks
    const remaining = tasks.filter(t => t.status !== 'done').slice(0, 3);
    for (const t of remaining) {
      const agent = t.agent_name ? ` (${t.agent_name})` : '';
      lines.push(`   [ ] ${t.title}${agent}`);
    }
    if (tasks.filter(t => t.status !== 'done').length > 3) {
      lines.push(`   ...and ${tasks.filter(t => t.status !== 'done').length - 3} more`);
    }
    lines.push('');
  }

  if (completed.length > 0) {
    lines.push(`${completed.length} completed: ${completed.slice(0, 3).map(m => m.title).join(', ')}${completed.length > 3 ? '...' : ''}`);
  }

  return { message: lines.join('\n'), success: true };
}
