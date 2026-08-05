/**
 * Client helpers for the Chat Live Builder "Share" feature.
 *
 * Calls the publish-preview edge function with the current artifact HTML,
 * returns a short public URL the user can paste anywhere. See
 * docs/CHAT_LIVE_BUILDER_ROADMAP.md Phase 6.
 */

import { supabase } from './supabase';
import { getFreshAccessToken, safeGetUser } from './authSession';

export interface PublishResult {
  id: string;
  url: string;
  expiresAt: string;
}

function resolveUrl(path: string): string {
  const base = (supabase as any)?.supabaseUrl as string | undefined;
  if (!base) throw new Error('Supabase URL not configured');
  return `${base}${path}`;
}

/**
 * POST the HTML to publish-preview. Returns the share URL that `view-build`
 * will serve when opened.
 */
export async function publishPreview(input: {
  html: string;
  title?: string;
  circleId?: string | null;
}): Promise<PublishResult> {
  // getFreshAccessToken never throws (null on any auth error) + refreshes near-expiry (P67/#101).
  const accessToken = await getFreshAccessToken();
  if (!accessToken) throw new Error('You need to be signed in to publish a share link.');

  const res = await fetch(resolveUrl('/functions/v1/publish-preview'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      html: input.html,
      title: input.title,
      circle_id: input.circleId ?? null,
    }),
  });

  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {}
    throw new Error(message);
  }

  const body = await res.json() as { id: string; url: string; expires_at: string };
  return { id: body.id, url: body.url, expiresAt: body.expires_at };
}

/** List the user's own published links. Public read is enabled but we
 * filter client-side to ownership here for the "My shares" UI. */
export async function listMyPublications(limit = 20) {
  const { value: user } = await safeGetUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('builder_publications')
    .select('id, title, view_count, created_at, expires_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function deletePublication(id: string): Promise<void> {
  const { error } = await supabase.from('builder_publications').delete().eq('id', id);
  if (error) throw error;
}
