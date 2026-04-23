/**
 * Tool: getGithubActivity — returns recent commits/PRs/CI events for a
 * circle's connected repo. This is THE tool for "what shipped this week?"
 * — without it the agent routinely hallucinates activity facts.
 *
 * Reads from `circle_github_events` (populated by the github-webhook edge
 * function). RLS ensures the calling user can only see events for circles
 * they belong to.
 */

import { supabase } from '../supabase';
import { registerTool } from './registry';

type GetGithubActivityInput = {
  circleId: string;
  /** Rolling window in hours. Default 168h (7 days), max 720h (30 days). */
  windowHours?: number;
  /** Optional event type filter: 'push' | 'pull_request' | 'workflow_run' | 'deployment_status'. */
  eventType?: string;
  /** Max rows. Default 25, hard-cap 100. */
  limit?: number;
};

function isGithubInput(value: unknown): value is GetGithubActivityInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.circleId === 'string' && v.circleId.length > 0;
}

type GithubEventRow = {
  id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

// Pull out the human-useful bits from each event's payload so the model
// doesn't have to parse GitHub's full webhook schema every turn.
function summarize(event: GithubEventRow): Record<string, unknown> {
  const payload = (event.payload || {}) as Record<string, any>;
  switch (event.event_type) {
    case 'push': {
      const commits = Array.isArray(payload.commits) ? payload.commits : [];
      return {
        type: 'push',
        at: event.created_at,
        ref: payload.ref,
        pusher: payload.pusher?.name || payload.sender?.login || null,
        commitCount: commits.length,
        commits: commits.slice(0, 5).map((c: any) => ({
          sha: String(c.id ?? '').slice(0, 7),
          author: c.author?.name || c.author?.username || null,
          message: (c.message || '').split('\n')[0],
        })),
      };
    }
    case 'pull_request': {
      const pr = payload.pull_request || {};
      return {
        type: 'pull_request',
        at: event.created_at,
        action: payload.action,
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user?.login || null,
        merged: !!pr.merged,
      };
    }
    case 'workflow_run': {
      const run = payload.workflow_run || {};
      return {
        type: 'workflow_run',
        at: event.created_at,
        name: run.name,
        conclusion: run.conclusion,
        status: run.status,
        actor: run.actor?.login || null,
      };
    }
    case 'deployment_status': {
      const s = payload.deployment_status || {};
      return {
        type: 'deployment_status',
        at: event.created_at,
        state: s.state,
        environment: payload.deployment?.environment,
        target: s.target_url,
      };
    }
    default:
      return {
        type: event.event_type,
        at: event.created_at,
        sender: payload.sender?.login || null,
      };
  }
}

registerTool({
  name: 'getGithubActivity',
  description:
    "Returns recent GitHub activity for a circle's connected repository — " +
    "commits, pull requests, workflow runs, and deployment status events " +
    "over the given window (default 7 days). Use instead of guessing about " +
    "recent ships, breaks, or who's been active in the repo.",
  input_schema: {
    type: 'object',
    properties: {
      circleId:    { type: 'string', description: 'Circle UUID.' },
      windowHours: { type: 'integer', minimum: 1, maximum: 720 },
      eventType:   {
        type: 'string',
        enum: ['push', 'pull_request', 'workflow_run', 'deployment_status'],
        description: 'Optional filter. Omit to include all event types.',
      },
      limit:       { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['circleId'],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (!isGithubInput(input)) {
      return { ok: false, error: 'getGithubActivity: expected { circleId: string }.' };
    }
    const { circleId } = input;
    const windowHours = Math.max(1, Math.min(720, input.windowHours ?? 168));
    const limit       = Math.max(1, Math.min(100, input.limit       ?? 25));
    const sinceIso    = new Date(Date.now() - windowHours * 3_600_000).toISOString();

    let query = supabase
      .from('circle_github_events')
      .select('id, event_type, payload, created_at')
      .eq('circle_id', circleId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (input.eventType) {
      query = query.eq('event_type', input.eventType);
    }

    const { data, error } = await query;
    if (error) {
      return { ok: false, error: `circle_github_events query failed: ${error.message}` };
    }

    const rows = (data || []) as GithubEventRow[];
    const summarized = rows.map(summarize);

    return {
      ok: true,
      data: {
        circleId,
        windowHours,
        count: summarized.length,
        events: summarized,
      },
    };
  },
});
