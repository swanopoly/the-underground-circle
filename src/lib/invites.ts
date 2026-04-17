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

// ─── Read Invites ───────────────────────────────────────────────────

export async function getCircleInvites(circleId: string): Promise<CircleInvite[]> {
  const { data } = await supabase
    .from('circle_invites')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false });

  return data || [];
}

export async function lookupInvite(inviteCode: string): Promise<{
  invite?: CircleInvite;
  circleName?: string;
  inviterName?: string;
  error?: string;
}> {
  const { data, error } = await supabase
    .from('circle_invites')
    .select('*')
    .eq('invite_code', inviteCode)
    .eq('status', 'pending')
    .single();

  if (error || !data) return { error: 'Invite not found or expired' };

  // Check expiry
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return { error: 'This invite has expired' };
  }

  // Check usage limit
  if (data.max_uses > 0 && data.use_count >= data.max_uses) {
    return { error: 'This invite has reached its usage limit' };
  }

  // Get circle name
  const { data: circle } = await supabase
    .from('circles')
    .select('name')
    .eq('id', data.circle_id)
    .single();

  // Get inviter name
  const { data: inviter } = await supabase
    .from('profiles')
    .select('display_name, username')
    .eq('id', data.invited_by)
    .single();

  return {
    invite: data,
    circleName: circle?.name,
    inviterName: inviter?.display_name || inviter?.username,
  };
}

// ─── Accept Invite ──────────────────────────────────────────────────

export async function acceptInvite(inviteCode: string): Promise<{
  circleId?: string;
  error?: string;
}> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Look up invite
  const { invite, error: lookupError } = await lookupInvite(inviteCode);
  if (lookupError || !invite) return { error: lookupError || 'Invalid invite' };

  // Check if already a member
  const { data: existing } = await supabase
    .from('circle_members')
    .select('id')
    .eq('circle_id', invite.circle_id)
    .eq('user_id', user.id)
    .single();

  if (existing) return { error: 'You are already a member of this circle' };

  // Add to circle — record who invited them so we can award referral credit.
  // Self-referrals (which shouldn't happen via the UI) are skipped via the
  // RPC's guard, but we still set referred_by for analytics integrity.
  const isSelfReferral = invite.invited_by === user.id;
  const { error: joinError } = await supabase
    .from('circle_members')
    .insert({
      circle_id: invite.circle_id,
      user_id: user.id,
      role: invite.role === 'admin' ? 'creator' : 'member', // map admin → creator role
      referred_by: isSelfReferral ? null : invite.invited_by,
    });

  if (joinError) return { error: joinError.message };

  // Update invite usage
  await supabase
    .from('circle_invites')
    .update({
      use_count: invite.use_count + 1,
      ...(invite.max_uses > 0 && invite.use_count + 1 >= invite.max_uses
        ? { status: 'accepted' }
        : {}),
    })
    .eq('id', invite.id);

  // Award referral bonus to the inviter — atomic, idempotent server-side.
  // We don't await this strictly; if the RPC fails we still want the user
  // to land in the circle. Errors are logged so they're debuggable.
  if (!isSelfReferral && invite.invited_by) {
    supabase
      .rpc('award_referral_bonus', {
        p_inviter_id: invite.invited_by,
        p_invitee_id: user.id,
        p_circle_id: invite.circle_id,
      })
      .then(({ error: bonusErr }) => {
        if (bonusErr) console.warn('[invites] award_referral_bonus failed:', bonusErr);
      });
  }

  return { circleId: invite.circle_id };
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
