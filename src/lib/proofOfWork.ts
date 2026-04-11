/**
 * Proof of Work — auto-generate feed entries from GitHub events, agent runs, and check-ins
 * See docs/NEXT_LEVEL_PLAN.md Phase 1.2
 *
 * This module bridges existing data sources (circle_github_events, agent_runs, check-ins)
 * into the proof_of_work table for the unified mission feed.
 */
import { supabase } from './supabase';
import { addProofOfWork, PowType } from './missions';

// ─── GitHub Event → Proof of Work ───────────────────────────────────────────

interface GitHubEvent {
  id: string;
  circle_id: string;
  event_type: string;  // 'push', 'pull_request', 'check_run', 'workflow_run', etc.
  payload: any;
  created_at: string;
}

/** Convert a GitHub push event to proof-of-work entries (one per commit) */
export function githubPushToProof(event: GitHubEvent): {
  pow_type: PowType; title: string; detail: Record<string, any>;
}[] {
  const payload = event.payload;
  const commits = payload?.commits || [];
  const repo = payload?.repository?.full_name || 'unknown';
  const pusher = payload?.pusher?.name || payload?.sender?.login || 'unknown';
  const branch = (payload?.ref || '').replace('refs/heads/', '');

  return commits.map((c: any) => ({
    pow_type: 'commit' as PowType,
    title: `${pusher} pushed: ${c.message?.split('\n')[0] || 'commit'}`,
    detail: {
      sha: c.id?.substring(0, 7),
      message: c.message,
      repo,
      branch,
      url: c.url,
      author: c.author?.name || pusher,
      added: c.added?.length || 0,
      modified: c.modified?.length || 0,
      removed: c.removed?.length || 0,
    },
  }));
}

/** Convert a GitHub pull_request event to a proof-of-work entry */
export function githubPRToProof(event: GitHubEvent): {
  pow_type: PowType; title: string; detail: Record<string, any>;
} | null {
  const payload = event.payload;
  const action = payload?.action; // opened, closed, merged, etc.
  const pr = payload?.pull_request;
  if (!pr) return null;

  const author = pr.user?.login || 'unknown';
  const repo = payload?.repository?.full_name || 'unknown';

  // Only track meaningful actions
  if (!['opened', 'closed', 'merged'].includes(action)) return null;

  const merged = action === 'closed' && pr.merged;
  const verb = merged ? 'merged' : action;

  return {
    pow_type: 'pr' as PowType,
    title: `${author} ${verb} PR: ${pr.title}`,
    detail: {
      action: merged ? 'merged' : action,
      pr_number: pr.number,
      pr_title: pr.title,
      repo,
      url: pr.html_url,
      author,
      additions: pr.additions,
      deletions: pr.deletions,
      changed_files: pr.changed_files,
    },
  };
}

/** Convert a GitHub workflow/deploy event to a proof-of-work entry */
export function githubDeployToProof(event: GitHubEvent): {
  pow_type: PowType; title: string; detail: Record<string, any>;
} | null {
  const payload = event.payload;
  const action = payload?.action;
  const run = payload?.workflow_run || payload?.check_run;
  if (!run) return null;

  const status = run.conclusion || run.status;
  const repo = payload?.repository?.full_name || 'unknown';
  const name = run.name || 'workflow';

  return {
    pow_type: 'deploy' as PowType,
    title: `${name}: ${status}`,
    detail: {
      workflow: name,
      status,
      repo,
      url: run.html_url,
      branch: run.head_branch,
    },
  };
}

/** Process a raw GitHub event and write proof-of-work entries */
export async function processGitHubEvent(event: GitHubEvent, missionId?: string): Promise<number> {
  let entries: { pow_type: PowType; title: string; detail: Record<string, any> }[] = [];

  switch (event.event_type) {
    case 'push':
      entries = githubPushToProof(event);
      break;
    case 'pull_request':
      const pr = githubPRToProof(event);
      if (pr) entries = [pr];
      break;
    case 'workflow_run':
    case 'check_run':
      const deploy = githubDeployToProof(event);
      if (deploy) entries = [deploy];
      break;
  }

  let count = 0;
  for (const entry of entries) {
    const { error } = await addProofOfWork({
      circle_id: event.circle_id,
      mission_id: missionId,
      pow_type: entry.pow_type,
      title: entry.title,
      detail: entry.detail,
    });
    if (!error) count++;
  }

  return count;
}

// ─── Agent Run → Proof of Work ──────────────────────────────────────────────

interface AgentRunSummary {
  circle_id: string;
  agent_name: string;
  mission_id?: string;
  user_id?: string;
  status: string;       // 'completed', 'failed', etc.
  task_description: string;
  result_summary?: string;
  tokens_used?: number;
  cost?: number;
  duration_ms?: number;
}

/** Convert a completed agent run to a proof-of-work entry */
export async function recordAgentRunProof(run: AgentRunSummary): Promise<{ error: string | null }> {
  const costStr = run.cost ? ` ($${run.cost.toFixed(3)})` : '';
  const title = run.status === 'completed'
    ? `${run.agent_name} completed: ${run.task_description}`
    : `${run.agent_name} ${run.status}: ${run.task_description}`;

  return addProofOfWork({
    circle_id: run.circle_id,
    mission_id: run.mission_id,
    user_id: run.user_id,
    agent_name: run.agent_name,
    pow_type: 'agent_run',
    title: title.substring(0, 200), // truncate for safety
    detail: {
      status: run.status,
      task: run.task_description,
      result: run.result_summary,
      tokens: run.tokens_used,
      cost: run.cost,
      duration_ms: run.duration_ms,
    },
  });
}

// ─── Check-in → Proof of Work ───────────────────────────────────────────────

/** Record a user check-in as proof of work */
export async function recordCheckinProof(opts: {
  circle_id: string;
  user_id: string;
  mission_id?: string;
  message: string;
}): Promise<{ error: string | null }> {
  return addProofOfWork({
    circle_id: opts.circle_id,
    user_id: opts.user_id,
    mission_id: opts.mission_id,
    pow_type: 'checkin',
    title: opts.message.substring(0, 200),
    detail: {
      full_message: opts.message,
    },
  });
}

// ─── Batch import existing GitHub events ────────────────────────────────────

/**
 * One-time import: read recent circle_github_events and backfill proof_of_work.
 * Useful when first setting up the mission system on a circle that already has GitHub connected.
 */
export async function backfillGitHubProof(circleId: string, limit = 100): Promise<number> {
  const { data: events } = await supabase
    .from('circle_github_events')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!events?.length) return 0;

  let total = 0;
  for (const event of events) {
    const count = await processGitHubEvent(event as GitHubEvent);
    total += count;
  }

  return total;
}
