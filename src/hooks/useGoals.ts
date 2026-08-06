import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Goal } from '../types/kanban';

export interface GoalWithCount extends Goal {
  task_count: number;
  completed_count: number;
}

export function useGoals(circleId: string) {
  const [goals, setGoals] = useState<GoalWithCount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGoals = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('goals')
        .select('*')
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false });

      if (error || !data) { setLoading(false); return; }

      // Get task counts per goal
      const goalIds = data.map((g: any) => g.id);
      let taskCounts: Record<string, { total: number; done: number }> = {};

      if (goalIds.length > 0) {
        const { data: tasks } = await supabase
          .from('tasks')
          .select('goal_id, status')
          .in('goal_id', goalIds);

        for (const t of (tasks || [])) {
          if (!t.goal_id) continue;
          if (!taskCounts[t.goal_id]) taskCounts[t.goal_id] = { total: 0, done: 0 };
          taskCounts[t.goal_id].total++;
          if (t.status === 'done') taskCounts[t.goal_id].done++;
        }
      }

      const enriched: GoalWithCount[] = data.map((g: any) => ({
        ...g,
        assigned_agent_ids: Array.isArray(g.assigned_agent_ids) ? g.assigned_agent_ids : [],
        task_count: taskCounts[g.id]?.total || 0,
        completed_count: taskCounts[g.id]?.done || 0,
      }));

      setGoals(enriched);
    } catch (err) {
      console.error('useGoals error:', err);
    } finally {
      setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    fetchGoals();

    const channel = supabase
      .channel(`goals:${circleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goals', filter: `circle_id=eq.${circleId}` }, fetchGoals)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [circleId, fetchGoals]);

  const createGoal = async (fields: Partial<Goal>) => {
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
    if (!user) return;
    const { error } = await supabase.from('goals').insert({
      circle_id: circleId,
      name: fields.name || 'New Goal',
      description: fields.description || null,
      status: fields.status || 'active',
      assigned_agent_ids: fields.assigned_agent_ids || [],
      target_count: fields.target_count || 0,
      created_by: user.id,
    });
    // Report the outcome — `if (!error) fetchGoals()` with no else branch
    // meant a denied write was indistinguishable from success, so the create
    // form closed and the goal simply never appeared.
    if (error) { console.error('createGoal error:', error); return false; }
    fetchGoals();
    return true;
  };

  const updateGoal = async (goalId: string, fields: Partial<Goal>) => {
    const { error } = await supabase
      .from('goals')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('id', goalId);
    if (error) { console.error('updateGoal error:', error); return false; }
    fetchGoals();
    return true;
  };

  const deleteGoal = async (goalId: string) => {
    const { error } = await supabase.from('goals').delete().eq('id', goalId);
    if (error) { console.error('deleteGoal error:', error); return false; }
    fetchGoals();
    return true;
  };

  return { goals, loading, fetchGoals, createGoal, updateGoal, deleteGoal };
}
