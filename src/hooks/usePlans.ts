import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { CirclePlan, PlanStep, PlanStatus } from '../types/kanban';
import { inferTaskIntegrationRequirements } from '../lib/circleIntegrations';

function buildPlanMarketplaceContext(fields: {
  title?: string | null;
  description?: string | null;
  steps?: Array<{ title?: string | null; description?: string | null }>;
}) {
  const combinedDescription = [
    fields.description || '',
    ...(fields.steps || []).map(step => `${step.title || ''} ${step.description || ''}`),
  ].join(' ');
  const inferred = inferTaskIntegrationRequirements({
    title: fields.title || '',
    description: combinedDescription,
  });
  if (inferred.requiredConnectors.length === 0 && inferred.requiredCapabilities.length === 0) {
    return undefined;
  }
  return {
    required_connectors: inferred.requiredConnectors,
    required_capabilities: inferred.requiredCapabilities,
    last_audited_at: new Date().toISOString(),
  };
}

export function usePlans(circleId: string) {
  const [plans, setPlans] = useState<CirclePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('circle_plans')
        .select('*, room:project_rooms!circle_plans_room_id_fkey(id, name, status, color)')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false });

      if (error || !data) { setError(error?.message || 'Failed to fetch plans'); setLoading(false); return; }

      const parsed: CirclePlan[] = data.map((p: any) => ({
        ...p,
        steps: Array.isArray(p.steps) ? p.steps : [],
        context: p.context && typeof p.context === 'object' ? p.context : {},
        assigned_agent_ids: Array.isArray(p.assigned_agent_ids) ? p.assigned_agent_ids : [],
        tags: Array.isArray(p.tags) ? p.tags : [],
        estimated_cost: p.estimated_cost ?? 0,
        actual_cost: p.actual_cost ?? 0,
      }));

      setPlans(parsed);
      setError(null);
    } catch (err) {
      console.error('usePlans error:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch plans');
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    fetchPlans();

    const channelId = `circle_plans:${circleId}:${Math.random().toString(36).slice(2, 10)}`;
    const channel = supabase
      .channel(channelId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_plans', filter: `circle_id=eq.${circleId}` }, fetchPlans)
      .subscribe((status, err) => { if (err) console.error('[usePlans] realtime error:', err); });

    return () => { supabase.removeChannel(channel); };
  }, [circleId, fetchPlans]);

  const createPlan = async (fields: Partial<CirclePlan>) => {
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (!user) return;
    const marketplace = buildPlanMarketplaceContext({
      title: fields.title,
      description: fields.description,
      steps: fields.steps,
    });
    const { error } = await supabase.from('circle_plans').insert({
      circle_id: circleId,
      title: fields.title || 'New Plan',
      description: fields.description || null,
      status: fields.status || 'draft',
      steps: fields.steps || [],
      context: {
        ...(fields.context || {}),
        ...(marketplace ? { marketplace } : {}),
      },
      room_id: fields.room_id || null,
      assigned_agent_ids: fields.assigned_agent_ids || [],
      goal_id: fields.goal_id || null,
      tags: fields.tags || [],
      estimated_cost: fields.estimated_cost || 0,
      actual_cost: fields.actual_cost || 0,
      created_by: user.id,
    });
    if (error) console.error('createPlan error:', error);
    else fetchPlans();
  };

  const updatePlan = async (planId: string, fields: Partial<CirclePlan>) => {
    const existingPlan = plans.find(plan => plan.id === planId);
    const marketplace = buildPlanMarketplaceContext({
      title: fields.title ?? existingPlan?.title,
      description: fields.description ?? existingPlan?.description,
      steps: fields.steps ?? existingPlan?.steps,
    });
    const { error } = await supabase
      .from('circle_plans')
      .update({
        ...fields,
        context: {
          ...(existingPlan?.context || {}),
          ...(fields.context || {}),
          ...(marketplace ? { marketplace } : {}),
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', planId);
    if (error) console.error('updatePlan error:', error);
    else fetchPlans();
  };

  const deletePlan = async (planId: string) => {
    const { error } = await supabase.from('circle_plans').delete().eq('id', planId);
    if (error) console.error('deletePlan error:', error);
    else fetchPlans();
  };

  const updatePlanStep = async (planId: string, stepId: string, updates: Partial<PlanStep>) => {
    const plan = plans.find(p => p.id === planId);
    if (!plan) return;

    const updatedSteps = plan.steps.map(s =>
      s.id === stepId ? { ...s, ...updates } : s
    );

    const { error } = await supabase
      .from('circle_plans')
      .update({ steps: updatedSteps, updated_at: new Date().toISOString() })
      .eq('id', planId);
    if (error) console.error('updatePlanStep error:', error);
    else fetchPlans();
  };

  const generateTasksFromPlan = async (planId: string) => {
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (!user) return;

    const plan = plans.find(p => p.id === planId);
    if (!plan) return;

    const pendingSteps = plan.steps.filter(s => s.status !== 'done' && !s.task_id);
    if (pendingSteps.length === 0) return;

    let effectiveAgentIds = Array.isArray(plan.assigned_agent_ids) ? [...plan.assigned_agent_ids] : [];
    if (effectiveAgentIds.length === 0 && plan.room_id) {
      const { data: roomAgents } = await supabase
        .from('project_room_agents')
        .select('agent_session_key, status')
        .eq('room_id', plan.room_id)
        .neq('status', 'offline')
        .order('last_active_at', { ascending: false });
      effectiveAgentIds = Array.from(new Set((roomAgents || []).map((row: any) => String(row.agent_session_key || '').trim()).filter(Boolean)));
    }

    const { data: existingTasks } = await supabase
      .from('tasks')
      .select('position')
      .eq('circle_id', circleId)
      .eq('status', 'todo')
      .order('position', { ascending: false })
      .limit(1);

    let nextPos = (existingTasks && existingTasks.length > 0 ? existingTasks[0].position : -1) + 1;

    const tasksToInsert = pendingSteps.map((step, i) => ({
      circle_id: circleId,
      created_by: user.id,
      title: step.title,
      description: step.description || null,
      priority: 'normal' as const,
      status: 'todo' as const,
      position: nextPos + i,
      room_id: plan.room_id || null,
      assigned_agent_id: effectiveAgentIds[0] || null,
      completion_policy: effectiveAgentIds.length > 1 ? 'any_assigned' : 'single_owner',
      plan_id: planId,
      plan_step_id: step.id,
      goal_id: plan.goal_id || null,
      mode: 'execute' as const,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from('tasks')
      .insert(tasksToInsert)
      .select('id');

    if (insertError) {
      console.error('generateTasksFromPlan insert error:', insertError);
      return;
    }

    if (inserted && inserted.length === pendingSteps.length) {
      if (effectiveAgentIds.length) {
        try {
          const assignmentRows = inserted.flatMap((row: any) =>
            effectiveAgentIds.map((agentId, index) => ({
              task_id: row.id,
              circle_id: circleId,
              agent_id: agentId,
              role: index === 0 ? 'owner' : 'executor',
              assignment_type: 'plan',
              required_for_completion: true,
              required_for_review: false,
              status: 'assigned',
              order_index: index,
              assigned_by: user.id,
            }))
          );
          if (assignmentRows.length > 0) {
            await supabase.from('task_agent_assignments').upsert(assignmentRows, { onConflict: 'task_id,agent_id' });
          }
        } catch (assignmentErr) {
          console.warn('generateTasksFromPlan assignment sync skipped:', assignmentErr);
        }
      }

      const updatedSteps = plan.steps.map(s => {
        const idx = pendingSteps.findIndex(ps => ps.id === s.id);
        if (idx >= 0 && inserted[idx]) {
          return { ...s, task_id: inserted[idx].id };
        }
        return s;
      });

      await supabase
        .from('circle_plans')
        .update({
          steps: updatedSteps,
          status: 'active' as PlanStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', planId);
    }

    fetchPlans();
  };

  return { plans, loading, error, createPlan, updatePlan, deletePlan, updatePlanStep, generateTasksFromPlan, refresh: fetchPlans };
}
