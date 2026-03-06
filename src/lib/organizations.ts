/**
 * Organization management — CRUD for orgs, members, and feature gating.
 */

import { supabase } from './supabase';

// ─── Types ───────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url?: string;
  created_by: string;
  plan: 'free' | 'pro' | 'business' | 'enterprise';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  subscription_status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete';
  seat_count: number;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface OrgMember {
  id: string;
  org_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  invited_by?: string;
  joined_at: string;
  user?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
}

export interface OrgFeatures {
  org_id: string;
  max_circles: number;
  max_members_per_circle: number;
  analytics_enabled: boolean;
  slack_enabled: boolean;
  teams_enabled: boolean;
  sso_enabled: boolean;
  export_enabled: boolean;
  whitelabel_enabled: boolean;
  custom_branding: boolean;
  goal_alignment: boolean;
}

export interface OrgWithCounts extends Organization {
  member_count?: number;
  circle_count?: number;
}

// ─── Create ─────────────────────────────────────────────────────────

export async function createOrganization(
  name: string,
  slug: string,
  logoUrl?: string
): Promise<{ org?: Organization; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Create organization
  const { data: org, error: orgError } = await supabase
    .from('organizations')
    .insert({
      name,
      slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      logo_url: logoUrl || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (orgError) {
    if (orgError.code === '23505') return { error: 'That slug is already taken' };
    return { error: orgError.message };
  }

  // Add creator as owner
  const { error: memberError } = await supabase
    .from('org_members')
    .insert({
      org_id: org.id,
      user_id: user.id,
      role: 'owner',
    });

  if (memberError) return { error: memberError.message };

  return { org };
}

// ─── Read ───────────────────────────────────────────────────────────

export async function getMyOrganizations(): Promise<OrgWithCounts[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberships } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', user.id);

  if (!memberships || memberships.length === 0) return [];

  const orgIds = memberships.map(m => m.org_id);

  const { data: orgs } = await supabase
    .from('organizations')
    .select('*')
    .in('id', orgIds)
    .order('created_at', { ascending: false });

  if (!orgs) return [];

  // Get member + circle counts per org
  const results: OrgWithCounts[] = [];
  for (const org of orgs) {
    const { count: memberCount } = await supabase
      .from('org_members')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', org.id);

    const { count: circleCount } = await supabase
      .from('circles')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', org.id);

    results.push({
      ...org,
      member_count: memberCount || 0,
      circle_count: circleCount || 0,
    });
  }

  return results;
}

export async function getOrgDetails(orgId: string): Promise<Organization | null> {
  const { data } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .single();

  return data;
}

export async function getOrgMembers(orgId: string): Promise<OrgMember[]> {
  const { data } = await supabase
    .from('org_members')
    .select('*, user:profiles(id, username, display_name, avatar_url)')
    .eq('org_id', orgId)
    .order('joined_at');

  return data || [];
}

export async function getOrgCircles(orgId: string) {
  const { data } = await supabase
    .from('circles')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  return data || [];
}

export async function getOrgFeatures(orgId: string): Promise<OrgFeatures | null> {
  const { data } = await supabase
    .from('org_features')
    .select('*')
    .eq('org_id', orgId)
    .single();

  return data;
}

export async function getOrgPlan(orgId: string): Promise<{ plan: string; status: string; seats: number }> {
  const { data } = await supabase
    .from('organizations')
    .select('plan, subscription_status, seat_count')
    .eq('id', orgId)
    .single();

  return {
    plan: data?.plan || 'free',
    status: data?.subscription_status || 'active',
    seats: data?.seat_count || 1,
  };
}

// ─── Members ────────────────────────────────────────────────────────

export async function addOrgMember(
  orgId: string,
  userId: string,
  role: 'admin' | 'member' = 'member'
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('org_members')
    .insert({ org_id: orgId, user_id: userId, role });

  if (error) {
    if (error.code === '23505') return { error: 'User is already a member' };
    return { error: error.message };
  }
  return {};
}

export async function removeOrgMember(
  orgId: string,
  userId: string
): Promise<{ error?: string }> {
  // Prevent removing the last owner
  const { data: owners } = await supabase
    .from('org_members')
    .select('id')
    .eq('org_id', orgId)
    .eq('role', 'owner');

  const { data: target } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();

  if (target?.role === 'owner' && (owners?.length || 0) <= 1) {
    return { error: 'Cannot remove the last owner' };
  }

  const { error } = await supabase
    .from('org_members')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) return { error: error.message };
  return {};
}

export async function updateOrgMemberRole(
  orgId: string,
  userId: string,
  newRole: 'owner' | 'admin' | 'member'
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('org_members')
    .update({ role: newRole })
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) return { error: error.message };
  return {};
}

// ─── Update ─────────────────────────────────────────────────────────

export async function updateOrganization(
  orgId: string,
  updates: Partial<Pick<Organization, 'name' | 'logo_url' | 'settings'>>
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('organizations')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', orgId);

  if (error) return { error: error.message };
  return {};
}

// ─── Circle Assignment ──────────────────────────────────────────────

export async function moveCircleToOrg(
  circleId: string,
  orgId: string | null
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('circles')
    .update({ org_id: orgId })
    .eq('id', circleId);

  if (error) return { error: error.message };
  return {};
}

// ─── Delete ─────────────────────────────────────────────────────────

export async function deleteOrganization(orgId: string): Promise<{ error?: string }> {
  // Unlink circles first (set org_id to null rather than deleting them)
  await supabase
    .from('circles')
    .update({ org_id: null })
    .eq('org_id', orgId);

  const { error } = await supabase
    .from('organizations')
    .delete()
    .eq('id', orgId);

  if (error) return { error: error.message };
  return {};
}

// ─── Role Check ─────────────────────────────────────────────────────

export async function getMyOrgRole(orgId: string): Promise<'owner' | 'admin' | 'member' | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('user_id', user.id)
    .single();

  return data?.role || null;
}

// ─── Slug Check ─────────────────────────────────────────────────────

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const { data } = await supabase
    .from('organizations')
    .select('id')
    .eq('slug', slug.toLowerCase())
    .single();

  return !data;
}

// ─── Lookup by Slug ─────────────────────────────────────────────────

export async function getOrgBySlug(slug: string): Promise<Organization | null> {
  const { data } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', slug.toLowerCase())
    .single();

  return data;
}
