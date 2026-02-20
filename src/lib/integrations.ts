import { supabase } from './supabase';
import { Integration, FriendRequest, Friend } from '../types';

// Integration management
export async function getUserIntegrations(userId: string): Promise<Integration[]> {
  const { data, error } = await supabase
    .from('integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('connected_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function connectIntegration(
  platform: Integration['platform'],
  platformUserId: string,
  platformUsername: string,
  accessToken: string,
  refreshToken?: string,
  metadata?: Record<string, any>
): Promise<Integration> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // For demo purposes, we'll store tokens as-is. 
  // In production, encrypt these before storage!
  const { data, error } = await supabase
    .from('integrations')
    .upsert({
      user_id: user.id,
      platform,
      platform_user_id: platformUserId,
      platform_username: platformUsername,
      access_token_encrypted: accessToken, // Should be encrypted!
      refresh_token_encrypted: refreshToken, // Should be encrypted!
      metadata: metadata || {},
      is_active: true,
      connected_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function disconnectIntegration(platform: Integration['platform']): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { error } = await supabase
    .from('integrations')
    .update({ is_active: false })
    .eq('user_id', user.id)
    .eq('platform', platform);

  if (error) throw error;
}

// Friend system
export async function sendFriendRequest(receiverId: string, message?: string): Promise<FriendRequest> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('friend_requests')
    .insert({
      sender_id: user.id,
      receiver_id: receiverId,
      message,
      status: 'pending',
    })
    .select(`
      *,
      sender:profiles!friend_requests_sender_id_fkey(*),
      receiver:profiles!friend_requests_receiver_id_fkey(*)
    `)
    .single();

  if (error) throw error;
  return data;
}

export async function respondToFriendRequest(requestId: string, accept: boolean): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { error } = await supabase
    .from('friend_requests')
    .update({ 
      status: accept ? 'accepted' : 'declined',
      updated_at: new Date().toISOString()
    })
    .eq('id', requestId)
    .eq('receiver_id', user.id); // Only receiver can respond

  if (error) throw error;
}

export async function getFriendRequests(): Promise<FriendRequest[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('friend_requests')
    .select(`
      *,
      sender:profiles!friend_requests_sender_id_fkey(*),
      receiver:profiles!friend_requests_receiver_id_fkey(*)
    `)
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getFriends(): Promise<Friend[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  const { data, error } = await supabase
    .from('friends')
    .select(`
      *,
      friend:profiles!friends_friend_id_fkey(*)
    `)
    .eq('user_id', user.id)
    .order('since', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function removeFriend(friendId: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // Remove both directions of the friendship
  const { error } = await supabase
    .from('friends')
    .delete()
    .or(`and(user_id.eq.${user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${user.id})`);

  if (error) throw error;
}

// Invite system
export async function generateInviteLink(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('User not authenticated');

  // Generate a unique invite code
  const inviteCode = btoa(user.id).replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
  
  // Store invite code in profile metadata or create separate invites table
  const { data, error } = await supabase
    .from('profiles')
    .update({
      linked_accounts: {
        ...{}, // would get current linked_accounts here
        invite_code: inviteCode
      }
    })
    .eq('id', user.id);

  if (error) throw error;

  return `https://theundergroundcircle.com/invite/${inviteCode}`;
}

export async function searchUsers(query: string, limit: number = 10): Promise<any[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, level, xp')
    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
    .limit(limit);

  if (error) throw error;
  return data || [];
}

// Platform-specific connection helpers
export const platformConnections = {
  discord: {
    name: 'Discord',
    color: '#5865F2',
    icon: '🎮',
    connectUrl: 'https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=identify',
  },
  twitter: {
    name: 'Twitter/X',
    color: '#1DA1F2',
    icon: '🐦',
    connectUrl: 'https://api.twitter.com/oauth2/authorize?client_id=YOUR_CLIENT_ID',
  },
  github: {
    name: 'GitHub',
    color: '#333',
    icon: '💻',
    connectUrl: 'https://github.com/login/oauth/authorize?client_id=YOUR_CLIENT_ID',
  },
  spotify: {
    name: 'Spotify',
    color: '#1DB954',
    icon: '🎵',
    connectUrl: 'https://accounts.spotify.com/authorize?client_id=YOUR_CLIENT_ID',
  },
  fitbit: {
    name: 'Fitbit',
    color: '#00B0B0',
    icon: '⌚',
    connectUrl: 'https://www.fitbit.com/oauth2/authorize?client_id=YOUR_CLIENT_ID',
  },
  strava: {
    name: 'Strava',
    color: '#FC4C02',
    icon: '🏃',
    connectUrl: 'https://www.strava.com/oauth/authorize?client_id=YOUR_CLIENT_ID',
  },
} as const;