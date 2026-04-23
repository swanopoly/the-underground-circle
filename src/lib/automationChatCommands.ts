/**
 * automationChatCommands — `/automation` slash-command family for ChatTab.
 *
 * Phase CA-2 of `docs/CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`. Codex's
 * audit called out that circle automations are a first-class product
 * surface but chat can't reach them today — this file closes that gap.
 * Same shape as `skillChatCommands.ts` and `missionChatCommands.ts`, so
 * `chatCommandRegistry` can route `/automation` through one dispatcher.
 *
 * Supported sub-commands (Phase CA-2):
 *   /automation                    → help
 *   /automation list               → enabled + disabled automations
 *   /automation status             → dashboard stats
 *   /automation run <name|id>      → manually triggers one (HITL: external side effect)
 *   /automation test <name|id>     → dry-run in sandbox (no external side effect)
 *   /automation pause <name|id>    → disable without deleting
 *   /automation resume <name|id>   → re-enable
 *   /automation runs <name|id>     → latest 10 runs with status + duration
 *
 * Not yet in this file (deferred to Phase CA-5): `/automation create …`
 * with natural-language config. That needs a multi-turn dialog (schedule,
 * prompt, context toggles) — better handled by the planner's
 * `create_circle_automation` execution kind.
 *
 * HITL policy: `run` counts as `external_side_effect` under
 * `chatAutomationPlanner.buildRiskForRoute('schedule')`, so the planner
 * will gate real triggers behind approval when routed via the chat
 * planner. This file is the handler side — it assumes the planner has
 * already approved or the user is calling via slash (manual intent).
 */

import {
  loadAutomations,
  triggerAutomation,
  testAutomation,
  toggleAutomation,
  loadRuns,
  loadDashboardStats,
  type CircleAutomation,
  type AutomationRun,
} from '../services/automationService';

export type AutomationCommandResult = {
  message: string;
  success: boolean;
};

export type AutomationCommandContext = {
  circleId: string;
  userId: string;
};

function helpMessage(): string {
  return [
    '**Automation commands**',
    '• `/automation list` — show enabled + disabled automations',
    '• `/automation status` — dashboard stats (7-day outcome roll-up)',
    '• `/automation run <name|id>` — trigger one manually',
    '• `/automation test <name|id>` — dry-run, no external side effect',
    '• `/automation pause <name|id>` — disable without deleting',
    '• `/automation resume <name|id>` — re-enable a paused automation',
    '• `/automation runs <name|id>` — recent runs (status, duration)',
    '',
    '_Need to create a new automation? Describe it in natural language and the planner will route to the create flow._',
  ].join('\n');
}

// ─── Name / id resolution ──────────────────────────────────────────────────

function short(id: string): string {
  return id.slice(0, 8);
}

function fuzzyMatch(needle: string, automations: CircleAutomation[]): CircleAutomation | null {
  if (!needle) return null;
  const exactId = automations.find((a) => a.id === needle);
  if (exactId) return exactId;
  const shortId = automations.find((a) => a.id.startsWith(needle));
  if (shortId) return shortId;
  const lower = needle.toLowerCase();
  const exactName = automations.find((a) => a.name.toLowerCase() === lower);
  if (exactName) return exactName;
  const contains = automations.filter((a) => a.name.toLowerCase().includes(lower));
  if (contains.length === 1) return contains[0];
  return null;
}

function ambiguityMessage(needle: string, automations: CircleAutomation[]): string {
  const lower = needle.toLowerCase();
  const candidates = automations.filter((a) => a.name.toLowerCase().includes(lower));
  if (candidates.length === 0) return `No automation matches "${needle}". Run \`/automation list\` to see what's available.`;
  const names = candidates.map((a) => `• **${a.name}** (\`${short(a.id)}\`)`).join('\n');
  return `Multiple automations match "${needle}":\n${names}\n_Specify a full name or 8-char id._`;
}

// ─── Formatters ────────────────────────────────────────────────────────────

function formatAutomationLine(a: CircleAutomation): string {
  const state = a.enabled ? '✓' : '⏸';
  const lastRun = a.lastRunAt
    ? ` — last ran ${formatRelative(a.lastRunAt)}`
    : '';
  const error = a.lastError ? ` · ⚠️ ${a.lastError.slice(0, 80)}` : '';
  return `${state} **${a.name}** (\`${short(a.id)}\`) — ${a.triggerType}${lastRun}${error}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const delta = now - then;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

function formatRunLine(run: AutomationRun): string {
  const when = formatRelative(run.startedAt);
  const duration = run.durationMs ? ` · ${Math.round(run.durationMs / 100) / 10}s` : '';
  const error = run.errorMessage ? ` · ${run.errorMessage.slice(0, 80)}` : '';
  return `• ${run.status.toUpperCase()} ${when}${duration}${error}`;
}

// ─── Subcommands ──────────────────────────────────────────────────────────

async function listSubcommand(ctx: AutomationCommandContext): Promise<AutomationCommandResult> {
  const automations = await loadAutomations(ctx.circleId);
  if (automations.length === 0) {
    return { success: true, message: 'No automations in this circle yet. Describe one in natural language and the planner will route to the create flow.' };
  }
  const enabled = automations.filter((a) => a.enabled);
  const disabled = automations.filter((a) => !a.enabled);
  const lines = [`**Circle automations** (${enabled.length} active, ${disabled.length} paused)`];
  if (enabled.length > 0) {
    lines.push('', '**Active**', ...enabled.map(formatAutomationLine));
  }
  if (disabled.length > 0) {
    lines.push('', '**Paused**', ...disabled.map(formatAutomationLine));
  }
  return { success: true, message: lines.join('\n') };
}

async function statusSubcommand(ctx: AutomationCommandContext): Promise<AutomationCommandResult> {
  // `DashboardStats` was simplified to just 7-day run counts (see
  // src/services/automationService.ts). We also enrich with the list of
  // active/total automations from the main loader so this command still
  // reads like a real status report.
  const [stats, all] = await Promise.all([
    loadDashboardStats(ctx.circleId),
    loadAutomations(ctx.circleId),
  ]);
  const totalRuns = stats.successfulLast7d + stats.failedLast7d;
  const successRate = totalRuns > 0 ? stats.successfulLast7d / totalRuns : 0;
  const active = all.filter((a) => a.enabled).length;
  const lines = [
    '**Automation dashboard**',
    `• Total automations: ${all.length}  (active: ${active})`,
    `• Runs in last 7 days: ${totalRuns}`,
    `• Success rate: ${Math.round(successRate * 100)}%`,
    stats.failedLast7d ? `• Failing (7d): ${stats.failedLast7d}` : '',
  ].filter(Boolean);
  return { success: true, message: lines.join('\n') };
}

async function resolveAndAct(
  needle: string,
  ctx: AutomationCommandContext,
  action: (a: CircleAutomation) => Promise<AutomationCommandResult>,
): Promise<AutomationCommandResult> {
  const automations = await loadAutomations(ctx.circleId);
  if (automations.length === 0) {
    return { success: false, message: 'No automations in this circle yet.' };
  }
  const target = fuzzyMatch(needle, automations);
  if (!target) {
    return { success: false, message: ambiguityMessage(needle, automations) };
  }
  return action(target);
}

async function runSubcommand(needle: string, ctx: AutomationCommandContext): Promise<AutomationCommandResult> {
  return resolveAndAct(needle, ctx, async (a) => {
    const result = await triggerAutomation(a.id, ctx.circleId);
    if (result.error) return { success: false, message: `Trigger failed: ${result.error}` };
    return {
      success: true,
      message: `Triggered **${a.name}** (\`${short(a.id)}\`). Run id: \`${result.runId || 'pending'}\`. Use \`/automation runs ${a.name}\` to watch progress.`,
    };
  });
}

async function testSubcommand(needle: string, ctx: AutomationCommandContext): Promise<AutomationCommandResult> {
  return resolveAndAct(needle, ctx, async (a) => {
    const result = await testAutomation(a.id, ctx.circleId);
    if (result.error) return { success: false, message: `Test failed: ${result.error}` };
    return {
      success: true,
      message: `Dry-run started for **${a.name}** (\`${short(a.id)}\`). Run id: \`${result.runId || 'pending'}\`.`,
    };
  });
}

async function pauseSubcommand(needle: string, ctx: AutomationCommandContext): Promise<AutomationCommandResult> {
  return resolveAndAct(needle, ctx, async (a) => {
    if (!a.enabled) return { success: true, message: `**${a.name}** is already paused.` };
    const result = await toggleAutomation(a.id, false);
    if (result.error) return { success: false, message: `Pause failed: ${result.error}` };
    return { success: true, message: `Paused **${a.name}** (\`${short(a.id)}\`).` };
  });
}

async function resumeSubcommand(needle: string, ctx: AutomationCommandContext): Promise<AutomationCommandResult> {
  return resolveAndAct(needle, ctx, async (a) => {
    if (a.enabled) return { success: true, message: `**${a.name}** is already active.` };
    const result = await toggleAutomation(a.id, true);
    if (result.error) return { success: false, message: `Resume failed: ${result.error}` };
    return { success: true, message: `Resumed **${a.name}** (\`${short(a.id)}\`).` };
  });
}

async function runsSubcommand(needle: string, ctx: AutomationCommandContext): Promise<AutomationCommandResult> {
  return resolveAndAct(needle, ctx, async (a) => {
    const runs = await loadRuns(a.id, 10);
    if (runs.length === 0) return { success: true, message: `**${a.name}** has no runs yet.` };
    const lines = [`**${a.name}** — latest ${runs.length} runs`, ...runs.map(formatRunLine)];
    return { success: true, message: lines.join('\n') };
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────

/**
 * Parse and execute an `/automation …` command. Returns null when the input
 * isn't an automation command so `chatCommandRegistry` can fall through.
 */
export async function executeAutomationCommand(
  input: string,
  ctx: AutomationCommandContext,
): Promise<AutomationCommandResult | null> {
  const m = input.trim().match(/^\/automations?\b\s*(.*)$/i);
  if (!m) return null;
  const rest = (m[1] || '').trim();
  if (!rest) return { success: true, message: helpMessage() };

  const [subcommand, ...rest2] = rest.split(/\s+/);
  const subArgs = rest2.join(' ').trim();

  switch (subcommand.toLowerCase()) {
    case 'help':   return { success: true, message: helpMessage() };
    case 'list':   return listSubcommand(ctx);
    case 'status':
    case 'health':
    case 'dashboard':
      return statusSubcommand(ctx);
    case 'run':
    case 'trigger':
      if (!subArgs) return { success: false, message: 'Usage: `/automation run <name|id>`.' };
      return runSubcommand(subArgs, ctx);
    case 'test':
    case 'dry-run':
    case 'dryrun':
      if (!subArgs) return { success: false, message: 'Usage: `/automation test <name|id>`.' };
      return testSubcommand(subArgs, ctx);
    case 'pause':
    case 'disable':
    case 'stop':
      if (!subArgs) return { success: false, message: 'Usage: `/automation pause <name|id>`.' };
      return pauseSubcommand(subArgs, ctx);
    case 'resume':
    case 'enable':
    case 'start':
      if (!subArgs) return { success: false, message: 'Usage: `/automation resume <name|id>`.' };
      return resumeSubcommand(subArgs, ctx);
    case 'runs':
    case 'history':
      if (!subArgs) return { success: false, message: 'Usage: `/automation runs <name|id>`.' };
      return runsSubcommand(subArgs, ctx);
    default:
      return {
        success: false,
        message: `Unknown subcommand \`${subcommand}\`. Run \`/automation\` for help.`,
      };
  }
}
