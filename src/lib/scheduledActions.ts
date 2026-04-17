/**
 * Scheduled Actions
 *
 * Unified queue for "do this thing now or later". Backs the Pending Actions
 * Outbox UI and every connector that doesn't have native scheduling (Bluesky,
 * Gmail send, Slack post, webhooks). See supabase/migrations/20260414_scheduled_actions.sql.
 *
 * Kinds are typed at the union level — when you add a new kind to the DB
 * CHECK constraint, add it here too so callers get autocomplete on payloads.
 */

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

export type ScheduledActionKind =
  | 'wp_post'
  | 'bluesky_post'
  | 'tweet'
  | 'linkedin_post'
  | 'gmail_send'
  | 'gmail_draft'
  | 'outlook_send'
  | 'slack_post'
  | 'webhook'
  | 'reminder';

export type ScheduledActionStatus =
  | 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface ScheduledAction {
  id: string;
  user_id: string;
  circle_id: string | null;
  kind: ScheduledActionKind;
  status: ScheduledActionStatus;
  payload: Record<string, any>;
  scheduled_for: string;
  started_at: string | null;
  completed_at: string | null;
  result: Record<string, any> | null;
  error: string | null;
  retry_count: number;
  max_retries: number;
  requires_approval: boolean;
  approval_id: string | null;
  recurrence: string | null;          // cron expression e.g. '0 9 * * 1'
  recurrence_label: string | null;    // human label e.g. 'Every Monday 9am'
  parent_action_id: string | null;
  created_at: string;
  updated_at: string;
}

// Per-kind payload shapes. These get validated in the edge function but
// typing them here lets every caller build payloads with full intellisense.

export interface BlueskyPostPayload {
  text: string;
  reply_to_uri?: string;
  images?: Array<{ data_url: string; alt?: string }>;
}

export interface TweetPayload {
  text: string;
  reply_to_id?: string;
  media_ids?: string[];
}

export interface LinkedInPostPayload {
  text: string;
  visibility?: 'PUBLIC' | 'CONNECTIONS';
}

export interface GmailSendPayload {
  to: string[];
  subject: string;
  body_markdown: string;
  cc?: string[];
  bcc?: string[];
  reply_to_message_id?: string;
}

export interface GmailDraftPayload extends GmailSendPayload {
  // Same shape as send; kind=='gmail_draft' just saves instead of sending.
}

export interface SlackPostPayload {
  channel: string;
  text: string;
  blocks?: any[];
}

export interface WebhookPayload {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
}

export interface ReminderPayload {
  title: string;
  note?: string;
  notify_channels?: Array<'chat' | 'email' | 'push'>;
}

// ─── Create ──────────────────────────────────────────────────────────────────

export interface ScheduleInput<K extends ScheduledActionKind, P> {
  kind: K;
  payload: P;
  circleId?: string | null;
  scheduledFor?: Date | string;
  requiresApproval?: boolean;
  maxRetries?: number;
}

export async function scheduleAction<K extends ScheduledActionKind, P>(
  input: ScheduleInput<K, P>,
): Promise<ScheduledAction> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) throw new Error('Not authenticated');

  const scheduledFor = input.scheduledFor
    ? (typeof input.scheduledFor === 'string' ? input.scheduledFor : input.scheduledFor.toISOString())
    : new Date().toISOString();

  const row: Record<string, any> = {
    user_id: auth.user.id,
    circle_id: input.circleId ?? null,
    kind: input.kind,
    payload: input.payload as any,
    scheduled_for: scheduledFor,
    requires_approval: input.requiresApproval ?? false,
    max_retries: input.maxRetries ?? 3,
  };
  // Recurring actions get a cron expression + optional label
  if ((input as any).recurrence) row.recurrence = (input as any).recurrence;
  if ((input as any).recurrenceLabel) row.recurrence_label = (input as any).recurrenceLabel;
  if ((input as any).parentActionId) row.parent_action_id = (input as any).parentActionId;

  const { data, error } = await supabase
    .from('scheduled_actions')
    .insert(row)
    .select('*')
    .single();

  if (error) throw error;
  return data as ScheduledAction;
}

// ── Recurrence helpers ──────────────────────────────────────────────────────

const CRON_ALIASES: Record<string, { cron: string; label: string }> = {
  'every minute':   { cron: '* * * * *',    label: 'Every minute' },
  'every hour':     { cron: '0 * * * *',    label: 'Every hour' },
  'every day':      { cron: '0 9 * * *',    label: 'Daily at 9am UTC' },
  'daily':          { cron: '0 9 * * *',    label: 'Daily at 9am UTC' },
  'every monday':   { cron: '0 9 * * 1',    label: 'Every Monday 9am UTC' },
  'every tuesday':  { cron: '0 9 * * 2',    label: 'Every Tuesday 9am UTC' },
  'every wednesday':{ cron: '0 9 * * 3',    label: 'Every Wednesday 9am UTC' },
  'every thursday': { cron: '0 9 * * 4',    label: 'Every Thursday 9am UTC' },
  'every friday':   { cron: '0 9 * * 5',    label: 'Every Friday 9am UTC' },
  'every saturday': { cron: '0 9 * * 6',    label: 'Every Saturday 9am UTC' },
  'every sunday':   { cron: '0 9 * * 0',    label: 'Every Sunday 9am UTC' },
  'every week':     { cron: '0 9 * * 1',    label: 'Weekly (Monday 9am UTC)' },
  'weekly':         { cron: '0 9 * * 1',    label: 'Weekly (Monday 9am UTC)' },
  'every month':    { cron: '0 9 1 * *',    label: 'Monthly (1st, 9am UTC)' },
  'monthly':        { cron: '0 9 1 * *',    label: 'Monthly (1st, 9am UTC)' },
};

/**
 * Parse a natural-language recurrence phrase into a cron expression.
 * Returns null if no match. Also accepts raw cron (5-field) as passthrough.
 */
export function parseRecurrence(text: string): { cron: string; label: string } | null {
  const lower = text.toLowerCase().trim();
  // Direct cron expression: 5 space-separated fields
  if (/^[\d*,/-]+(\s+[\d*,/-]+){4}$/.test(lower)) {
    return { cron: lower, label: `Custom: ${lower}` };
  }
  // Alias lookup
  for (const [key, val] of Object.entries(CRON_ALIASES)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

/**
 * Compute the next occurrence from a cron expression relative to `after`.
 * Simplified: handles day-of-week + hour + minute fields for the common
 * "every <day> at <time>" pattern. For exotic expressions, falls back to
 * "1 day from now" so the action doesn't get stuck.
 */
export function nextCronOccurrence(cronExpr: string, after: Date = new Date()): Date {
  const parts = cronExpr.split(/\s+/);
  if (parts.length !== 5) return new Date(after.getTime() + 24 * 60 * 60 * 1000);
  const [minF, hourF, domF, _monF, dowF] = parts;
  const minute = minF === '*' ? 0 : parseInt(minF, 10);
  const hour = hourF === '*' ? after.getUTCHours() : parseInt(hourF, 10);

  const next = new Date(after);
  next.setUTCMinutes(minute);
  next.setUTCSeconds(0);
  next.setUTCMilliseconds(0);
  next.setUTCHours(hour);

  // Day-of-week specific
  if (dowF !== '*') {
    const targetDow = parseInt(dowF, 10); // 0=Sun
    let daysAhead = (targetDow - next.getUTCDay() + 7) % 7;
    if (daysAhead === 0 && next <= after) daysAhead = 7;
    next.setUTCDate(next.getUTCDate() + daysAhead);
    return next;
  }

  // Day-of-month specific
  if (domF !== '*') {
    const targetDom = parseInt(domF, 10);
    next.setUTCDate(targetDom);
    if (next <= after) next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  // Every day / hour / minute — just push to next occurrence
  if (next <= after) {
    if (hourF === '*') next.setUTCHours(next.getUTCHours() + 1);
    else next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * After a recurring action succeeds, create the next occurrence.
 * Call from the scheduled-action-runner edge fn after markSucceeded.
 */
export async function createNextRecurrence(action: ScheduledAction): Promise<ScheduledAction | null> {
  if (!action.recurrence) return null;
  const nextTime = nextCronOccurrence(action.recurrence, new Date());
  const { data, error } = await supabase
    .from('scheduled_actions')
    .insert({
      user_id: action.user_id,
      circle_id: action.circle_id,
      kind: action.kind,
      payload: action.payload,
      scheduled_for: nextTime.toISOString(),
      requires_approval: action.requires_approval,
      max_retries: action.max_retries,
      recurrence: action.recurrence,
      recurrence_label: action.recurrence_label,
      parent_action_id: action.id,
    })
    .select('*')
    .single();
  if (error) {
    console.warn('[scheduledActions] createNextRecurrence failed:', error.message);
    return null;
  }
  return data as ScheduledAction;
}

// ─── Read ────────────────────────────────────────────────────────────────────

export async function listScheduledActions(opts: {
  circleId?: string;
  statuses?: ScheduledActionStatus[];
  limit?: number;
} = {}): Promise<ScheduledAction[]> {
  let q = supabase
    .from('scheduled_actions')
    .select('*')
    .order('scheduled_for', { ascending: true })
    .limit(opts.limit ?? 50);
  if (opts.circleId) q = q.eq('circle_id', opts.circleId);
  if (opts.statuses?.length) q = q.in('status', opts.statuses);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as ScheduledAction[];
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function cancelAction(id: string): Promise<void> {
  const { error } = await supabase
    .from('scheduled_actions')
    .update({ status: 'canceled', completed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending');     // don't cancel already-running runs
  if (error) throw error;
}

export async function retryAction(id: string, scheduledFor?: Date): Promise<void> {
  const { error } = await supabase
    .from('scheduled_actions')
    .update({
      status: 'pending',
      error: null,
      started_at: null,
      completed_at: null,
      scheduled_for: (scheduledFor ?? new Date()).toISOString(),
      retry_count: 0,
    })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteAction(id: string): Promise<void> {
  const { error } = await supabase.from('scheduled_actions').delete().eq('id', id);
  if (error) throw error;
}

// ─── React hook ──────────────────────────────────────────────────────────────

export function usePendingActions(circleId?: string) {
  const [actions, setActions] = useState<ScheduledAction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const refresh = async () => {
      try {
        const rows = await listScheduledActions({
          circleId,
          statuses: ['pending', 'running', 'failed'],
          limit: 50,
        });
        if (!cancelled) setActions(rows);
      } catch (err) {
        console.warn('[scheduledActions] listScheduledActions failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    refresh();

    const channel = supabase
      .channel(`scheduled_actions_${circleId || 'all'}`)
      .on('postgres_changes',
          { event: '*', schema: 'public', table: 'scheduled_actions' },
          () => { refresh(); })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [circleId]);

  return { actions, loading };
}

// ─── Display helpers ─────────────────────────────────────────────────────────

export function describeAction(a: ScheduledAction): string {
  switch (a.kind) {
    case 'bluesky_post':
    case 'tweet':
    case 'linkedin_post':
    case 'slack_post':
      return (a.payload.text as string || '').slice(0, 80) || '(empty post)';
    case 'wp_post':
      return (a.payload.title as string || '(untitled)') + ' → WordPress';
    case 'gmail_send':
    case 'outlook_send':
      return `Email: ${a.payload.subject || '(no subject)'}`;
    case 'gmail_draft':
      return `Draft: ${a.payload.subject || '(no subject)'}`;
    case 'webhook':
      return `${a.payload.method || 'POST'} ${a.payload.url || '(no url)'}`;
    case 'reminder':
      return a.payload.title as string || '(reminder)';
    default:
      return a.kind;
  }
}

export function kindLabel(kind: ScheduledActionKind): string {
  switch (kind) {
    case 'bluesky_post':  return 'Bluesky';
    case 'tweet':         return 'X';
    case 'linkedin_post': return 'LinkedIn';
    case 'slack_post':    return 'Slack';
    case 'wp_post':       return 'WordPress';
    case 'gmail_send':    return 'Gmail';
    case 'gmail_draft':   return 'Gmail draft';
    case 'outlook_send':  return 'Outlook';
    case 'webhook':       return 'Webhook';
    case 'reminder':      return 'Reminder';
  }
}
