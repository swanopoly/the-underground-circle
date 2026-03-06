/**
 * White-Label — Custom branding per organization.
 */

import { supabase } from './supabase';
import type { WhiteLabelConfig } from '../types';

// ─── Defaults ────────────────────────────────────────────────────────

export const DEFAULT_BRANDING: Omit<WhiteLabelConfig, 'id' | 'org_id' | 'created_at' | 'updated_at'> = {
  app_name: 'The Underground Circle',
  primary_color: '#6366f1',
  accent_color: '#22c55e',
  background_color: '#0a0a0a',
  card_color: '#111111',
  border_color: '#1a1a2e',
  text_color: '#ffffff',
  font_family: 'monospace',
  hide_branding: false,
};

// ─── Read ────────────────────────────────────────────────────────────

export async function getWhiteLabelConfig(orgId: string): Promise<WhiteLabelConfig | null> {
  const { data } = await supabase
    .from('whitelabel_config')
    .select('*')
    .eq('org_id', orgId)
    .single();

  return data;
}

export async function getConfigByDomain(domain: string): Promise<WhiteLabelConfig | null> {
  const { data } = await supabase
    .from('whitelabel_config')
    .select('*')
    .eq('custom_domain', domain)
    .single();

  return data;
}

// ─── Write ───────────────────────────────────────────────────────────

export async function updateWhiteLabelConfig(
  orgId: string,
  config: Partial<Omit<WhiteLabelConfig, 'id' | 'org_id' | 'created_at' | 'updated_at'>>
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('whitelabel_config')
    .upsert({
      org_id: orgId,
      ...config,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' });

  if (error) return { error: error.message };
  return {};
}

export async function resetToDefaults(orgId: string): Promise<{ error?: string }> {
  return updateWhiteLabelConfig(orgId, DEFAULT_BRANDING);
}

// ─── Theme Hook Helper ──────────────────────────────────────────────

export function mergeWithDefaults(config: Partial<WhiteLabelConfig> | null): typeof DEFAULT_BRANDING {
  if (!config) return { ...DEFAULT_BRANDING };
  return {
    app_name: config.app_name || DEFAULT_BRANDING.app_name,
    primary_color: config.primary_color || DEFAULT_BRANDING.primary_color,
    accent_color: config.accent_color || DEFAULT_BRANDING.accent_color,
    background_color: config.background_color || DEFAULT_BRANDING.background_color,
    card_color: config.card_color || DEFAULT_BRANDING.card_color,
    border_color: config.border_color || DEFAULT_BRANDING.border_color,
    text_color: config.text_color || DEFAULT_BRANDING.text_color,
    font_family: config.font_family || DEFAULT_BRANDING.font_family,
    hide_branding: config.hide_branding ?? DEFAULT_BRANDING.hide_branding,
    logo_url: config.logo_url,
    favicon_url: config.favicon_url,
    custom_domain: config.custom_domain,
    custom_css: config.custom_css,
    login_message: config.login_message,
  };
}
