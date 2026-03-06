/**
 * Theme hook — provides white-label branding values.
 * Falls back to defaults when no white-label config exists.
 */

import { useState, useEffect, useCallback } from 'react';
import { getWhiteLabelConfig, DEFAULT_BRANDING, mergeWithDefaults } from '../lib/whitelabel';

export interface ThemeColors {
  primary: string;
  accent: string;
  background: string;
  card: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  fontFamily: string;
  appName: string;
  logoUrl?: string;
  hideBranding: boolean;
}

const DEFAULT_THEME: ThemeColors = {
  primary: '#6366f1',
  accent: '#22c55e',
  background: '#0a0a0a',
  card: '#111111',
  border: '#1a1a2e',
  text: '#ffffff',
  textSecondary: '#cccccc',
  textMuted: '#888888',
  fontFamily: 'monospace',
  appName: 'The Underground Circle',
  hideBranding: false,
};

export function useTheme(orgId?: string): ThemeColors & { loading: boolean; refresh: () => void } {
  const [theme, setTheme] = useState<ThemeColors>(DEFAULT_THEME);
  const [loading, setLoading] = useState(false);

  const loadTheme = useCallback(async () => {
    if (!orgId) {
      setTheme(DEFAULT_THEME);
      return;
    }

    setLoading(true);
    try {
      const config = await getWhiteLabelConfig(orgId);
      const merged = mergeWithDefaults(config);

      setTheme({
        primary: merged.primary_color,
        accent: merged.accent_color,
        background: merged.background_color,
        card: merged.card_color,
        border: merged.border_color,
        text: merged.text_color,
        textSecondary: '#cccccc',
        textMuted: '#888888',
        fontFamily: merged.font_family,
        appName: merged.app_name,
        logoUrl: merged.logo_url,
        hideBranding: merged.hide_branding,
      });
    } catch (err) {
      console.error('Theme load error:', err);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    loadTheme();
  }, [loadTheme]);

  return { ...theme, loading, refresh: loadTheme };
}

export { DEFAULT_THEME };
