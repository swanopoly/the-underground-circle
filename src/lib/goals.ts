/**
 * Goal Alignment — Hierarchical goal system.
 * North Star → OKR Objectives → Key Results → Circle Goals
 */

import { supabase } from './supabase';
import type { OrgGoal, GoalType, GoalStatus } from '../types';

// ─── Read ────────────────────────────────────────────────────────────

export async function getOrgGoals(orgId: string): Promise<OrgGoal[]> {
  const { data } = await supabase
    .from('org_goals')
    .select('*, owner:profiles!owner_id(id, username, display_name, avatar_url)')
    .eq('org_id', orgId)
    .order('goal_type', { ascending: true })
    .order('created_at', { ascending: true });

  if (!data) return [];

  // Build tree structure
  return buildGoalTree(data);
}

export async function getCircleGoals(circleId: string): Promise<OrgGoal[]> {
  const { data } = await supabase
    .from('org_goals')
    .select('*, owner:profiles!owner_id(id, username, display_name, avatar_url)')
    .eq('circle_id', circleId)
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  return data || [];
}

export async function getGoal(goalId: string): Promise<OrgGoal | null> {
  const { data } = await supabase
    .from('org_goals')
    .select('*, owner:profiles!owner_id(id, username, display_name, avatar_url)')
    .eq('id', goalId)
    .single();

  return data;
}

// ─── Write ───────────────────────────────────────────────────────────

export async function createGoal(goal: {
  orgId: string;
  parentId?: string;
  goalType: GoalType;
  title: string;
  description?: string;
  circleId?: string;
  ownerId?: string;
  targetValue?: number;
  unit?: string;
  dueDate?: string;
}): Promise<{ data?: OrgGoal; error?: string }> {
  const { data, error } = await supabase
    .from('org_goals')
    .insert({
      org_id: goal.orgId,
      parent_id: goal.parentId || null,
      goal_type: goal.goalType,
      title: goal.title,
      description: goal.description || null,
      circle_id: goal.circleId || null,
      owner_id: goal.ownerId || null,
      target_value: goal.targetValue || null,
      unit: goal.unit || null,
      due_date: goal.dueDate || null,
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { data };
}

export async function updateGoalProgress(
  goalId: string,
  currentValue: number
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('org_goals')
    .update({ current_value: currentValue, updated_at: new Date().toISOString() })
    .eq('id', goalId);

  if (error) return { error: error.message };
  return {};
}

export async function updateGoalStatus(
  goalId: string,
  status: GoalStatus
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('org_goals')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', goalId);

  if (error) return { error: error.message };
  return {};
}

export async function updateGoal(
  goalId: string,
  updates: Partial<Pick<OrgGoal, 'title' | 'description' | 'target_value' | 'unit' | 'due_date'>>
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('org_goals')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', goalId);

  if (error) return { error: error.message };
  return {};
}

export async function deleteGoal(goalId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('org_goals')
    .delete()
    .eq('id', goalId);

  if (error) return { error: error.message };
  return {};
}

// ─── Check-in Links ──────────────────────────────────────────────────

export async function linkCheckInToGoal(
  goalId: string,
  checkInId: string,
  contributedValue: number = 1
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('goal_check_in_links')
    .insert({ goal_id: goalId, check_in_id: checkInId, contributed_value: contributedValue });

  if (error) return { error: error.message };

  // Auto-update goal progress
  const { data: goal } = await supabase
    .from('org_goals')
    .select('current_value')
    .eq('id', goalId)
    .single();

  if (goal) {
    await updateGoalProgress(goalId, (goal.current_value || 0) + contributedValue);
  }

  return {};
}

export async function getGoalCheckInLinks(goalId: string) {
  const { data } = await supabase
    .from('goal_check_in_links')
    .select('*, check_in:check_ins(id, content, created_at, user:profiles!user_id(username, display_name))')
    .eq('goal_id', goalId)
    .order('created_at', { ascending: false });

  return data || [];
}

// ─── Helpers ─────────────────────────────────────────────────────────

function buildGoalTree(goals: OrgGoal[]): OrgGoal[] {
  const map = new Map<string, OrgGoal>();
  const roots: OrgGoal[] = [];

  goals.forEach(g => {
    map.set(g.id, { ...g, children: [] });
  });

  map.forEach(g => {
    if (g.parent_id && map.has(g.parent_id)) {
      map.get(g.parent_id)!.children!.push(g);
    } else {
      roots.push(g);
    }
  });

  return roots;
}

export function getGoalProgress(goal: OrgGoal): number {
  if (!goal.target_value || goal.target_value <= 0) return 0;
  return Math.min((goal.current_value / goal.target_value) * 100, 100);
}

const GOAL_TYPE_LABELS: Record<GoalType, string> = {
  north_star: 'North Star',
  okr_objective: 'OKR Objective',
  key_result: 'Key Result',
  circle_goal: 'Circle Goal',
};

export function getGoalTypeLabel(type: GoalType): string {
  return GOAL_TYPE_LABELS[type] || type;
}
