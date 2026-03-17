/**
 * automationService.ts — Circle Automations CRUD + Hooks
 *
 * Manages circle automations lifecycle: create, read, update, delete, toggle, trigger.
 * Provides React hooks with Supabase realtime subscriptions.
 */

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TriggerType = 'schedule' | 'event' | 'manual' | 'webhook';
export type OutputTarget = 'activity' | 'chat' | 'webhook' | 'silent';
export type RunStatus = 'running' | 'completed' | 'failed' | 'skipped';
export type WebhookProvider = 'github' | 'slack' | 'linear';

export interface CircleAutomation {
  id: string;
  circleId: string;
  createdBy: string;
  name: string;
  description: string | null;
  icon: string;
  triggerType: TriggerType;
  cronExpression: string | null;
  eventConfig: Record<string, any>;
  agent: string;
  prompt: string;
  model: string;
  includeContext: Record<string, boolean>;
  outputTarget: OutputTarget;
  webhookUrl: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  lastError: string | null;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  circleId: string;
  status: RunStatus;
  triggerSource: TriggerType;
  triggeredBy: string | null;
  inputContext: Record<string, any>;
  promptUsed: string | null;
  outputText: string | null;
  outputTarget: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  tokenCount: number;
  modelUsed: string | null;
  errorMessage: string | null;
  estimatedCost: number;
}

export interface CreateAutomationInput {
  circleId: string;
  name: string;
  description?: string;
  icon?: string;
  triggerType: TriggerType;
  cronExpression?: string;
  eventConfig?: Record<string, any>;
  agent?: string;
  prompt: string;
  model?: string;
  includeContext?: Record<string, boolean>;
  outputTarget?: OutputTarget;
  webhookUrl?: string;
  templateId?: string;
  spirit?: string;
  spiritPrompt?: string;
}

// ─── Row mappers ─────────────────────────────────────────────────────────────

function fromRow(row: any): CircleAutomation {
  return {
    id: row.id,
    circleId: row.circle_id,
    createdBy: row.created_by,
    name: row.name,
    description: row.description,
    icon: row.icon || '⚡',
    triggerType: row.trigger_type,
    cronExpression: row.cron_expression,
    eventConfig: row.event_config || {},
    agent: row.agent || 'BlackSwan',
    prompt: row.prompt,
    model: row.model || 'claude-haiku',
    includeContext: row.include_context || {},
    outputTarget: row.output_target || 'activity',
    webhookUrl: row.webhook_url,
    enabled: row.enabled,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    runCount: row.run_count || 0,
    lastError: row.last_error,
    templateId: row.template_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function runFromRow(row: any): AutomationRun {
  return {
    id: row.id,
    automationId: row.automation_id,
    circleId: row.circle_id,
    status: row.status,
    triggerSource: row.trigger_source,
    triggeredBy: row.triggered_by,
    inputContext: row.input_context || {},
    promptUsed: row.prompt_used,
    outputText: row.output_text,
    outputTarget: row.output_target,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    tokenCount: row.token_count || 0,
    modelUsed: row.model_used,
    errorMessage: row.error_message,
    estimatedCost: Number(row.estimated_cost) || 0,
  };
}

// ─── Compute initial next_run_at ─────────────────────────────────────────────

function computeNextRun(cronExpression: string | undefined): string | null {
  if (!cronExpression) return null;
  const now = new Date();
  switch (cronExpression) {
    case 'hourly':      now.setHours(now.getHours() + 1); break;
    case 'every_6h':    now.setHours(now.getHours() + 6); break;
    case 'twice_daily': now.setHours(now.getHours() + 12); break;
    case 'daily':       now.setDate(now.getDate() + 1); break;
    case 'weekly':      now.setDate(now.getDate() + 7); break;
    case 'monthly':     now.setMonth(now.getMonth() + 1); break;
    default:            now.setDate(now.getDate() + 1); break;
  }
  return now.toISOString();
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function loadAutomations(circleId: string): Promise<CircleAutomation[]> {
  const { data, error } = await supabase
    .from('circle_automations')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[automationService] loadAutomations error:', error.message);
    return [];
  }
  return (data || []).map(fromRow);
}

export async function createAutomation(input: CreateAutomationInput): Promise<{ automation?: CircleAutomation; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Not authenticated' };

  const nextRun = input.triggerType === 'schedule' ? computeNextRun(input.cronExpression) : null;

  const { data, error } = await supabase
    .from('circle_automations')
    .insert({
      circle_id: input.circleId,
      created_by: auth.user.id,
      name: input.name,
      description: input.description || null,
      icon: input.icon || '⚡',
      trigger_type: input.triggerType,
      cron_expression: input.cronExpression || null,
      event_config: input.eventConfig || {},
      agent: input.agent || 'BlackSwan',
      prompt: input.prompt,
      model: input.model || 'claude-haiku',
      include_context: input.includeContext || { members: true, check_ins: true, tasks: true, streaks: true },
      output_target: input.outputTarget || 'activity',
      webhook_url: input.webhookUrl || null,
      template_id: input.templateId || null,
      spirit: input.spirit || null,
      spirit_prompt: input.spiritPrompt || null,
      enabled: true,
      next_run_at: nextRun,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { automation: fromRow(data) };
}

export async function updateAutomation(id: string, updates: Partial<{
  name: string;
  description: string;
  icon: string;
  prompt: string;
  model: string;
  cronExpression: string;
  eventConfig: Record<string, any>;
  includeContext: Record<string, boolean>;
  outputTarget: OutputTarget;
  webhookUrl: string;
  spirit: string | null;
  spiritPrompt: string | null;
}>): Promise<{ error?: string }> {
  const payload: any = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.description !== undefined) payload.description = updates.description;
  if (updates.icon !== undefined) payload.icon = updates.icon;
  if (updates.prompt !== undefined) payload.prompt = updates.prompt;
  if (updates.model !== undefined) payload.model = updates.model;
  if (updates.cronExpression !== undefined) payload.cron_expression = updates.cronExpression;
  if (updates.eventConfig !== undefined) payload.event_config = updates.eventConfig;
  if (updates.includeContext !== undefined) payload.include_context = updates.includeContext;
  if (updates.outputTarget !== undefined) payload.output_target = updates.outputTarget;
  if (updates.webhookUrl !== undefined) payload.webhook_url = updates.webhookUrl;
  if (updates.spirit !== undefined) payload.spirit = updates.spirit;
  if (updates.spiritPrompt !== undefined) payload.spirit_prompt = updates.spiritPrompt;

  const { error } = await supabase
    .from('circle_automations')
    .update(payload)
    .eq('id', id);

  return error ? { error: error.message } : {};
}

export async function deleteAutomation(id: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('circle_automations')
    .delete()
    .eq('id', id);
  return error ? { error: error.message } : {};
}

export async function toggleAutomation(id: string, enabled: boolean): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('circle_automations')
    .update({ enabled })
    .eq('id', id);
  return error ? { error: error.message } : {};
}

// ─── Trigger execution ──────────────────────────────────────────────────────

export async function triggerAutomation(id: string, circleId: string): Promise<{ runId?: string; error?: string }> {
  // Refresh session to get a fresh access token — avoids 401 from expired JWT
  const { data: refreshed } = await supabase.auth.refreshSession();
  const accessToken = refreshed?.session?.access_token;
  const userId = refreshed?.user?.id;

  if (!accessToken) {
    return { error: 'Not authenticated — please sign in again' };
  }

  // Call edge function directly with the fresh token to avoid stale SDK state
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/automation-executor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': anonKey,
      },
      body: JSON.stringify({
        automationId: id,
        circleId,
        triggerSource: 'manual',
        triggeredBy: userId,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { error: `${res.status}: ${text}` };
    }

    const data = await res.json();
    return { runId: data?.runId };
  } catch (e: any) {
    return { error: e.message };
  }
}

/** Test/dry-run an automation — runs AI but doesn't route output or create tasks */
export async function testAutomation(id: string, circleId: string): Promise<{ runId?: string; error?: string }> {
  const { data: refreshed } = await supabase.auth.refreshSession();
  const accessToken = refreshed?.session?.access_token;
  const userId = refreshed?.user?.id;
  if (!accessToken) return { error: 'Not authenticated' };

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/automation-executor`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'apikey': anonKey,
      },
      body: JSON.stringify({
        automationId: id,
        circleId,
        triggerSource: 'manual',
        triggeredBy: userId,
        dryRun: true,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { error: `${res.status}: ${text}` };
    }
    const data = await res.json();
    return { runId: data?.runId };
  } catch (e: any) {
    return { error: e.message };
  }
}

// ─── Load runs ──────────────────────────────────────────────────────────────

export async function loadRuns(automationId: string, limit = 20): Promise<AutomationRun[]> {
  const { data, error } = await supabase
    .from('automation_runs')
    .select('*')
    .eq('automation_id', automationId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[automationService] loadRuns error:', error.message);
    return [];
  }
  return (data || []).map(runFromRow);
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface AutomationStats {
  successRate: number;   // 0-100
  totalCost: number;
  avgDurationMs: number;
  totalRuns: number;
}

export async function loadAutomationStats(circleId: string): Promise<Record<string, AutomationStats>> {
  const { data, error } = await supabase
    .from('automation_runs')
    .select('automation_id, status, estimated_cost, duration_ms')
    .eq('circle_id', circleId)
    .order('started_at', { ascending: false })
    .limit(500);

  if (error || !data) return {};

  const agg: Record<string, { completed: number; total: number; cost: number; dur: number }> = {};
  for (const r of data) {
    if (!agg[r.automation_id]) agg[r.automation_id] = { completed: 0, total: 0, cost: 0, dur: 0 };
    const a = agg[r.automation_id];
    a.total++;
    if (r.status === 'completed') a.completed++;
    a.cost += Number(r.estimated_cost) || 0;
    a.dur += r.duration_ms || 0;
  }

  const result: Record<string, AutomationStats> = {};
  for (const [id, a] of Object.entries(agg)) {
    result[id] = {
      successRate: a.total > 0 ? Math.round((a.completed / a.total) * 100) : 0,
      totalCost: a.cost,
      avgDurationMs: a.total > 0 ? Math.round(a.dur / a.total) : 0,
      totalRuns: a.total,
    };
  }
  return result;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

export function useCircleAutomations(circleId: string | null) {
  const [automations, setAutomations] = useState<CircleAutomation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!circleId) return;
    const data = await loadAutomations(circleId);
    setAutomations(data);
    setIsLoading(false);
  }, [circleId]);

  useEffect(() => {
    if (!circleId) return;
    refresh();

    const channel = supabase
      .channel(`automations:${circleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'circle_automations',
          filter: `circle_id=eq.${circleId}`,
        },
        () => { refresh(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [circleId, refresh]);

  return { automations, isLoading, refresh };
}

export function useAutomationStats(circleId: string | null) {
  const [stats, setStats] = useState<Record<string, AutomationStats>>({});

  const refresh = useCallback(async () => {
    if (!circleId) return;
    const data = await loadAutomationStats(circleId);
    setStats(data);
  }, [circleId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { stats, refreshStats: refresh };
}

export function useAutomationRuns(automationId: string | null) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!automationId) { setRuns([]); return; }
    setIsLoading(true);
    const data = await loadRuns(automationId);
    setRuns(data);
    setIsLoading(false);
  }, [automationId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Realtime: subscribe to run updates for this automation
  useEffect(() => {
    if (!automationId) return;
    const channel = supabase
      .channel(`auto-runs:${automationId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'automation_runs',
        filter: `automation_id=eq.${automationId}`,
      }, (payload: any) => {
        const row = payload.new;
        if (!row) return;
        const updated = runFromRow(row);
        setRuns(prev => {
          const idx = prev.findIndex(r => r.id === updated.id);
          if (idx >= 0) {
            const next = [...prev]; next[idx] = updated; return next;
          }
          return [updated, ...prev];
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [automationId]);

  return { runs, isLoading, refresh };
}

/** Subscribe to ALL automation runs for a circle — for live run tracking */
export function useCircleRunStream(circleId: string | null) {
  const [liveRuns, setLiveRuns] = useState<AutomationRun[]>([]);

  useEffect(() => {
    if (!circleId) return;
    const channel = supabase
      .channel(`auto-runs-circle:${circleId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'automation_runs',
        filter: `circle_id=eq.${circleId}`,
      }, (payload: any) => {
        const row = payload.new;
        if (!row) return;
        const updated = runFromRow(row);
        setLiveRuns(prev => {
          const idx = prev.findIndex(r => r.id === updated.id);
          if (idx >= 0) {
            const next = [...prev]; next[idx] = updated; return next;
          }
          return [updated, ...prev];
        });
        // Auto-remove completed/failed runs from live list after 10s
        if (updated.status === 'completed' || updated.status === 'failed') {
          setTimeout(() => {
            setLiveRuns(prev => prev.filter(r => r.id !== updated.id));
          }, 10_000);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId]);

  return liveRuns;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────

export interface DashboardStats {
  successfulLast7d: number;
  failedLast7d: number;
}

export async function loadDashboardStats(circleId: string): Promise<DashboardStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('automation_runs')
    .select('status')
    .eq('circle_id', circleId)
    .gte('started_at', sevenDaysAgo);

  if (error || !data) return { successfulLast7d: 0, failedLast7d: 0 };

  return {
    successfulLast7d: data.filter((r) => r.status === 'completed').length,
    failedLast7d:     data.filter((r) => r.status === 'failed').length,
  };
}

export function useDashboardStats(circleId: string | null) {
  const [stats, setStats] = useState<DashboardStats>({ successfulLast7d: 0, failedLast7d: 0 });

  const refresh = useCallback(async () => {
    if (!circleId) return;
    const s = await loadDashboardStats(circleId);
    setStats(s);
  }, [circleId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { stats, refresh };
}

// ─── Recent Runs (cross-automation) ───────────────────────────────────────────

export async function loadRecentRuns(circleId: string, limit = 30): Promise<AutomationRun[]> {
  const { data, error } = await supabase
    .from('automation_runs')
    .select('*')
    .eq('circle_id', circleId)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[automationService] loadRecentRuns error:', error.message);
    return [];
  }
  return (data || []).map(runFromRow);
}

// ─── Memory Notes ─────────────────────────────────────────────────────────────

export interface MemoryNote {
  id: string;
  automationId: string;
  circleId: string;
  title: string;
  content: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function memoryNoteFromRow(row: any): MemoryNote {
  return {
    id: row.id,
    automationId: row.automation_id,
    circleId: row.circle_id,
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadMemoryNotes(automationId: string): Promise<MemoryNote[]> {
  const { data, error } = await supabase
    .from('automation_memory_notes')
    .select('*')
    .eq('automation_id', automationId)
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[automationService] loadMemoryNotes error:', error.message);
    return [];
  }
  return (data || []).map(memoryNoteFromRow);
}

export async function createMemoryNote(
  automationId: string,
  circleId: string,
  title: string,
  content: string,
): Promise<{ note?: MemoryNote; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('automation_memory_notes')
    .insert({
      automation_id: automationId,
      circle_id: circleId,
      title: title.trim(),
      content: content.trim(),
      created_by: auth.user.id,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { note: memoryNoteFromRow(data) };
}

export async function updateMemoryNote(
  id: string,
  updates: { title?: string; content?: string },
): Promise<{ error?: string }> {
  const payload: any = { updated_at: new Date().toISOString() };
  if (updates.title !== undefined) payload.title = updates.title.trim();
  if (updates.content !== undefined) payload.content = updates.content.trim();

  const { error } = await supabase
    .from('automation_memory_notes')
    .update(payload)
    .eq('id', id);

  return error ? { error: error.message } : {};
}

export async function deleteMemoryNote(id: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('automation_memory_notes')
    .delete()
    .eq('id', id);
  return error ? { error: error.message } : {};
}

export function useMemoryNotes(automationId: string | null) {
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!automationId) { setNotes([]); return; }
    setIsLoading(true);
    const data = await loadMemoryNotes(automationId);
    setNotes(data);
    setIsLoading(false);
  }, [automationId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { notes, isLoading, refresh };
}
