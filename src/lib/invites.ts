/**
 * Circle invite system — link invites, email invites, accept/revoke.
 */

import { supabase } from './supabase';
import { CircleInvite } from '../types';

const APP_BASE_URL = 'https://app.chrisswanson.xyz';

// ─── Create Invites ─────────────────────────────────────────────────

export async function createLinkInvite(
  circleId: string,
  options?: { maxUses?: number; expiresInDays?: number; role?: 'member' | 'admin' }
): Promise<{ invite?: CircleInvite; url?: string; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (options?.expiresInDays || 7));

  const { data, error } = await supabase
    .from('circle_invites')
    .insert({
      circle_id: circleId,
      invited_by: user.id,
      invite_type: 'link',
      role: options?.role || 'member',
      max_uses: options?.maxUses || 0, // 0 = unlimited
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();

  if (error) return { error: error.message };

  return {
    invite: data,
    url: `${APP_BASE_URL}/join/${data.invite_code}`,
  };
}

export async function createEmailInvite(
  circleId: string,
  email: string,
  role: 'member' | 'admin' = 'member'
): Promise<{ invite?: CircleInvite; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data, error } = await supabase
    .from('circle_invites')
    .insert({
      circle_id: circleId,
      invited_by: user.id,
      invite_type: 'email',
      email: email.toLowerCase().trim(),
      role,
      max_uses: 1,
    })
    .select()
    .single();

  if (error) return { error: error.message };

  // Trigger the send-invite-email edge function
  try {
    const { data: circle } = await supabase
      .from('circles')
      .select('name')
      .eq('id', circleId)
      .single();

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, username')
      .eq('id', user.id)
      .single();

    await supabase.functions.invoke('send-invite-email', {
      body: {
        email: email.toLowerCase().trim(),
        inviteCode: data.invite_code,
        circleName: circle?.name || 'a circle',
        inviterName: profile?.display_name || profile?.username || 'Someone',
      },
    });
  } catch (emailErr) {
    console.warn('Failed to send invite email:', emailErr);
    // Invite still created, email just didn't send
  }

  return { invite: data };
}

// ─── Read managed invites ───────────────────────────────────────────

export async function getCircleInvites(circleId: string): Promise<CircleInvite[]> {
  const { data } = await supabase
    .from('circle_invites')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });

  return data || [];
}

// ─── Accept Invite ──────────────────────────────────────────────────

export async function acceptInvite(inviteCode: string): Promise<{
  circleId?: string;
  error?: string;
}> {
  const { data, error } = await supabase.rpc('join_circle_by_invite_code', {
    p_invite_code: inviteCode.trim(),
  });
  if (error) {
    return {
      error: error.message?.includes('circle_full')
        ? 'This circle is full'
        : 'Invite not found, expired, or unavailable',
    };
  }

  const joined = Array.isArray(data) ? data[0] : data;
  return joined?.circle_id
    ? { circleId: joined.circle_id }
    : { error: 'The join could not be verified' };
}

// ─── Referral stats ─────────────────────────────────────────────────

/**
 * How many distinct people did this user invite who actually joined?
 * Used to display "X people joined through you" in profile/settings.
 */
export async function getReferralCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('circle_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('referred_by', userId);
  return count || 0;
}

// ─── Revoke Invite ──────────────────────────────────────────────────

export async function revokeInvite(inviteId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('circle_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId);

  if (error) return { error: error.message };
  return {};
}

// ─── Generate URL ───────────────────────────────────────────────────

export function generateInviteUrl(inviteCode: string): string {
  return `${APP_BASE_URL}/join/${inviteCode}`;
}
