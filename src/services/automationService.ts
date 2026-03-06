/**
 * automationService.ts — Circle Automations CRUD + Hooks
 *
 * Manages circle automations lifecycle: create, read, update, delete, toggle, trigger.
 * Provides React hooks with Supabase realtime subscriptions.
 */

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ─── Types ───────────────────────────────────────────────────────────────────

export type TriggerType = 'schedule' | 'event' | 'manual';
export type OutputTarget = 'activity' | 'chat' | 'webhook' | 'silent';
export type RunStatus = 'running' | 'completed' | 'failed' | 'skipped';

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
    case 'hourly':  now.setHours(now.getHours() + 1); break;
    case 'daily':   now.setDate(now.getDate() + 1); break;
    case 'weekly':  now.setDate(now.getDate() + 7); break;
    case 'monthly': now.setMonth(now.getMonth() + 1); break;
    default:        now.setDate(now.getDate() + 1); break;
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
  const { data: auth } = await supabase.auth.getUser();

  const { data, error } = await supabase.functions.invoke('automation-executor', {
    body: {
      automationId: id,
      circleId,
      triggerSource: 'manual',
      triggeredBy: auth.user?.id,
    },
  });

  if (error) return { error: error.message };
  return { runId: data?.runId };
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

  return { runs, isLoading, refresh };
}
