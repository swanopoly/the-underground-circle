// Custom Themes Service — Supabase CRUD + React hook
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { OfficeTheme, EnvironmentType, OFFICE_THEMES } from '../lib/officeConfig';

export const CUSTOM_THEME_PREFIX = 'custom_';

export interface CustomThemeRecord {
  id: string;
  user_id: string;
  circle_id: string | null;
  name: string;
  environment_type: EnvironmentType;
  colors: Partial<Omit<OfficeTheme, 'id' | 'name' | 'environmentType'>>;
  is_shared: boolean;
  created_at: string;
  updated_at: string;
}

export function isCustomThemeId(id: string): boolean {
  return id.startsWith(CUSTOM_THEME_PREFIX);
}

export function extractCustomThemeDbId(themeId: string): string {
  return themeId.replace(CUSTOM_THEME_PREFIX, '');
}

export function customThemeToOfficeTheme(record: CustomThemeRecord): OfficeTheme {
  // Start from the base environment theme or underground fallback
  const baseEnv = record.environment_type || 'office';
  const baseTheme = Object.values(OFFICE_THEMES).find(t => t.environmentType === baseEnv) || OFFICE_THEMES.underground;

  return {
    ...baseTheme,
    id: CUSTOM_THEME_PREFIX + record.id,
    name: record.name,
    environmentType: baseEnv,
    ...record.colors,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function loadCustomThemes(circleId?: string): Promise<CustomThemeRecord[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  // Fetch own themes
  let query = supabase
    .from('user_custom_themes')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const { data: ownThemes, error: ownErr } = await query;
  if (ownErr) console.error('loadCustomThemes own:', ownErr);

  let sharedThemes: CustomThemeRecord[] = [];
  if (circleId) {
    const { data, error } = await supabase
      .from('user_custom_themes')
      .select('*')
      .eq('circle_id', circleId)
      .eq('is_shared', true)
      .neq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) console.error('loadCustomThemes shared:', error);
    sharedThemes = (data || []) as CustomThemeRecord[];
  }

  return [...(ownThemes || []), ...sharedThemes] as CustomThemeRecord[];
}

export async function saveCustomTheme(theme: {
  id?: string;
  name: string;
  environment_type: EnvironmentType;
  colors: Partial<Omit<OfficeTheme, 'id' | 'name' | 'environmentType'>>;
  circle_id?: string | null;
  is_shared?: boolean;
}): Promise<CustomThemeRecord | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const record = {
    user_id: user.id,
    name: theme.name,
    environment_type: theme.environment_type,
    colors: theme.colors,
    circle_id: theme.circle_id || null,
    is_shared: theme.is_shared ?? false,
    updated_at: new Date().toISOString(),
  };

  if (theme.id) {
    // Update existing
    const { data, error } = await supabase
      .from('user_custom_themes')
      .update(record)
      .eq('id', theme.id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) { console.error('saveCustomTheme update:', error); return null; }
    return data as CustomThemeRecord;
  } else {
    // Insert new
    const { data, error } = await supabase
      .from('user_custom_themes')
      .insert(record)
      .select()
      .single();

    if (error) { console.error('saveCustomTheme insert:', error); return null; }
    return data as CustomThemeRecord;
  }
}

export async function deleteCustomTheme(id: string): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from('user_custom_themes')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) { console.error('deleteCustomTheme:', error); return false; }
  return true;
}

// ─── React Hook ───────────────────────────────────────────────────────────────

export function useCustomThemes(circleId?: string) {
  const [themes, setThemes] = useState<CustomThemeRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await loadCustomThemes(circleId);
    setThemes(data);
    setLoading(false);
  }, [circleId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { themes, loading, refresh };
}
