/**
 * Shared visual language for every panel inside the Circle Profile dashboard.
 * These values intentionally mirror the quiet black/slate treatment used by
 * the Chat dashboard so Profile reads as part of the same workspace.
 */
export const PROFILE_DASHBOARD_TOKENS = {
  canvas: '#0A0A0A',
  header: '#050810',
  panel: '#0d1117',
  inset: '#070b12',
  hover: '#111827',
  border: '#1a1a28',
  borderStrong: '#243246',
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  accent: '#6366f1',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#f87171',
  panelRadius: 12,
  controlRadius: 6,
  maxWidth: 1120,
} as const;
