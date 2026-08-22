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
  addProofOfWork,
  missionProgress,
  formatDeadline,
  isOverdue,
  Mission,
  MissionTask,
} from './missions';
import { buildChatSlashHelpMessage } from './chatSlashCommands';
import {
  buildMissionCreatedProofTitle,
  buildProofOriginDetail,
} from './chatProofReceipts';

interface CommandContext {
  circleId: string;
  userId: string;
  /**
   * Originating chat thread, when the command came from main chat. Stamped
   * onto a `proof_of_work` row at creation so task dispatches can post
   * receipts back to this conversation (Phase 3c of
   * docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md).
   */
  threadId?: string | null;
}

/**
 * Fire-and-forget origin stamp: a `manual` proof row recording that the
 * mission started in chat. `missionAgentDispatch` reads this stamp to route
 * task receipts back to the thread. A failed stamp never fails creation.
 */
async function stampMissionChatOrigin(
  ctx: CommandContext,
  missionId: string,
  missionTitle: string,
): Promise<void> {
  if (!ctx.threadId) return;
  try {
    await addProofOfWork({
      circle_id: ctx.circleId,
      mission_id: missionId,
      user_id: ctx.userId,
      pow_type: 'manual',
      title: buildMissionCreatedProofTitle(missionTitle),
      detail: buildProofOriginDetail(ctx.threadId),
    });
  } catch { /* stamp is best-effort */ }
}

interface CommandResult {
  message: string;
  success: boolean;
}

// ─── /help — All Available Commands ──────────────────────────────────────────

export function executeHelpCommand(): CommandResult {
  return {
    message: buildChatSlashHelpMessage(),
    success: true,
  };
}

// ─── /summary — Full Circle Status Report ────────────────────────────────────

export async function executeSummaryCommand(ctx: CommandContext): Promise<CommandResult> {
  const lines: string[] = [];
  lines.push('**Circle Status Report**\n');

  // Missions
  const missions = await getMissions(ctx.circleId);
  const active = missions.filter(m => m.status === 'active');
  const completed = missions.filter(m => m.status === 'completed');

  lines.push(`**Missions** — ${active.length} active, ${completed.length} completed`);
  for (const m of active.slice(0, 5)) {
    const tasks = await getMissionTasks(m.id);
    const progress = missionProgress(tasks);
    const done = tasks.filter(t => t.status === 'done').length;
    const overdue = isOverdue(m);
    lines.push(`  ${overdue ? '!!' : '>>'} ${m.title} — ${progress}% (${done}/${tasks.length}) — ${formatDeadline(m.deadline)}${overdue ? ' OVERDUE' : ''}`);
  }

  // Proof of work (recent)
  try {
    const { getProofOfWork } = await import('./missions');
    const proof = await getProofOfWork(ctx.circleId, 10);
    if (proof.length > 0) {
      lines.push('');
      lines.push(`**Recent Proof** — ${proof.length} entries`);
      for (const p of proof.slice(0, 5)) {
        const age = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 3600000);
        const ageStr = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.floor(age / 24)}d ago`;
        lines.push(`  [${p.pow_type}] ${p.title.slice(0, 60)} — ${ageStr}`);
      }
    }
  } catch {}

  // Members
  try {
    const { supabase } = await import('./supabase');
    const { indexSafeProfiles, loadSafeCircleProfiles } = await import('./safeProfiles');
    const { data: members } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', ctx.circleId);
    if (members) {
      const profileById = indexSafeProfiles(await loadSafeCircleProfiles({
        circleId: ctx.circleId,
        userIds: members.map((member: any) => member.user_id),
      }));
      lines.push('');
      lines.push(`**Team** — ${members.length} member${members.length !== 1 ? 's' : ''}`);
      lines.push(`  ${members.map((m: any) => {
        const profile = profileById.get(m.user_id);
        return profile?.display_name || profile?.username || 'member';
      }).join(', ')}`);
    }
  } catch {}

  // Streak info
  try {
    const { loadStreak, isStreakActive } = await import('./missionStreaks');
    const streak = loadStreak(ctx.userId);
    if (streak.totalTasksCompleted > 0) {
      lines.push('');
      lines.push(`**Your Stats** — ${streak.totalTasksCompleted} tasks completed, ${streak.currentStreak}d streak${isStreakActive(streak) ? ' (active)' : ' (broken)'}, longest: ${streak.longestStreak}d`);
    }
  } catch {}

  if (lines.length <= 1) {
    return { message: 'No activity yet. Create a mission and start shipping!', success: true };
  }

  return { message: lines.join('\n'), success: true };
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

  // /mission create <title> — opens the mission create modal with the title
  // pre-filled so the user can add description, deadline, template choice,
  // and tasks before saving. Previously this created immediately with just a
  // title and dropped the user on the Missions tab to fill in the rest,
  // which was confusing.
  if (cmd.startsWith('create ') || cmd === 'create' || cmd.startsWith('new ') || cmd === 'new') {
    const stripped = cmd.startsWith('create ')
      ? args.slice(7)
      : cmd === 'create'
        ? ''
        : cmd.startsWith('new ')
          ? args.slice(4)
          : '';
    const title = stripped.trim();
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('uc_pending_mission_create', title); } catch {}
      try { window.dispatchEvent(new CustomEvent('uc:open-mission-create', { detail: { title } })); } catch {}
      // Bring the user to the tab that hosts the Missions surface so the
      // modal (which is View-based, not a portal) actually renders.
      try { window.dispatchEvent(new CustomEvent('uc:switch-tab', { detail: { tab: 'FEED' } })); } catch {}
    }
    return {
      message: title
        ? `Opening the mission creation form with **${title}** pre-filled. Add description, deadline, and tasks before you save.`
        : 'Opening the mission creation form. Pick a template or start blank.',
      success: true,
    };
  }

  // Legacy /mission quickcreate <title> — bypasses the modal and creates
  // immediately. Preserved for scripting + agents that want a one-shot call.
  if (cmd.startsWith('quickcreate ')) {
    const title = args.slice(12).trim();
    if (!title) return { message: 'Usage: `/mission quickcreate <title>`', success: false };
    const { mission, error } = await createMission(ctx.circleId, ctx.userId, title);
    if (error) return { message: `Failed to create mission: ${error}`, success: false };
    await stampMissionChatOrigin(ctx, mission!.id, mission!.title);
    return {
      message: `Mission created: **${mission!.title}**\nOpen the Missions tab to add tasks and set a deadline.${ctx.threadId ? ' Task receipts will post back to this conversation.' : ''}`,
      success: true,
    };
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
  await stampMissionChatOrigin(ctx, mission!.id, mission!.title);
  return {
    message: `Mission created: **${mission!.title}**\nOpen the Missions tab to add tasks.${ctx.threadId ? ' Task receipts will post back to this conversation.' : ''}`,
    success: true,
  };
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
