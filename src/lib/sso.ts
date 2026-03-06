/**
 * SSO (SAML) — Leverages Supabase Auth's native SAML support.
 */

import { supabase } from './supabase';
import { Linking } from 'react-native';

// ─── Types ───────────────────────────────────────────────────────────

export interface SSOProvider {
  id: string;
  org_id: string;
  provider_type: 'saml';
  domain: string;
  metadata_url?: string;
  entity_id?: string;
  is_active: boolean;
  created_at: string;
}

// ─── Sign In ─────────────────────────────────────────────────────────

export async function signInWithSSO(domain: string): Promise<{ error?: string }> {
  const { data, error } = await supabase.auth.signInWithSSO({ domain });

  if (error) return { error: error.message };

  // Supabase returns a URL to redirect to the IdP
  if (data?.url) {
    Linking.openURL(data.url);
  }

  return {};
}

// ─── Config ──────────────────────────────────────────────────────────

export async function getOrgSSOConfig(orgId: string): Promise<SSOProvider | null> {
  const { data } = await supabase
    .from('sso_providers')
    .select('*')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .single();

  return data;
}

export async function configureSSO(
  orgId: string,
  config: { domain: string; metadataUrl: string }
): Promise<{ error?: string }> {
  // Upsert SSO provider config
  const { error } = await supabase
    .from('sso_providers')
    .upsert({
      org_id: orgId,
      provider_type: 'saml',
      domain: config.domain,
      metadata_url: config.metadataUrl,
      is_active: true,
    }, { onConflict: 'org_id' });

  if (error) return { error: error.message };

  // Register with Supabase Auth via admin API (edge function)
  const { error: fnError } = await supabase.functions.invoke('configure-sso', {
    body: { orgId, domain: config.domain, metadataUrl: config.metadataUrl },
  });

  if (fnError) return { error: fnError.message };
  return {};
}

export async function disableSSO(orgId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('sso_providers')
    .update({ is_active: false })
    .eq('org_id', orgId);

  if (error) return { error: error.message };
  return {};
}

export async function testSSOConnection(domain: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.auth.signInWithSSO({ domain });
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
