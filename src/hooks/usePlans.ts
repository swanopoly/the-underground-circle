import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { CirclePlan, PlanStep, PlanStatus } from '../types/kanban';

export function usePlans(circleId: string) {
  const [plans, setPlans] = useState<CirclePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('circle_plans')
        .select('*')
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
    const { error } = await supabase.from('circle_plans').insert({
      circle_id: circleId,
      title: fields.title || 'New Plan',
      description: fields.description || null,
      status: fields.status || 'draft',
      steps: fields.steps || [],
      context: fields.context || {},
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
    const { error } = await supabase
      .from('circle_plans')
      .update({ ...fields, updated_at: new Date().toISOString() })
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
