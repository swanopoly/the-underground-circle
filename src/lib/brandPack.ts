/**
 * Per-circle brand pack for the Chat Live Builder
 *
 * Auto-prepended to /build-page prompts so generated pages match the user's
 * brand out of the box. Stored per-circle in localStorage — no DB write.
 * Migrating to a `circles.settings.brandPack` jsonb is a one-effect swap
 * when the feature matures; today the local-only path keeps it no-regret.
 */

import { storage } from './storage';

export const BRAND_PACK_STORAGE_KEY = 'uc_builder_brand_pack';

export type BrandVoice =
  | 'professional' | 'playful' | 'minimal' | 'bold' | 'warm' | 'technical';

export interface BrandPack {
  primaryColor?: string;     // hex, e.g. '#6366f1'
  secondaryColor?: string;
  bgColor?: string;
  textColor?: string;
  fontHeading?: string;      // CSS font-family value
  fontBody?: string;
  voice?: BrandVoice;
  tagline?: string;
  logoUrl?: string;
  customNotes?: string;      // free-form, prepended verbatim
  updatedAt?: string;
}

export const DEFAULT_BRAND_VOICE_LABEL: Record<BrandVoice, string> = {
  professional: 'Professional — clear, confident, no fluff',
  playful: 'Playful — warm, human, a little cheeky',
  minimal: 'Minimal — every word earns its place',
  bold: 'Bold — punchy, confident, high-impact',
  warm: 'Warm — personal, reassuring, conversational',
  technical: 'Technical — precise, jargon OK, engineer-grade',
};

function brandPackKey(circleId: string): string {
  return `${BRAND_PACK_STORAGE_KEY}_${circleId}`;
}

export async function loadBrandPack(circleId: string | null | undefined): Promise<BrandPack | null> {
  if (!circleId) return null;
  try {
    const raw = await storage.getItem(brandPackKey(circleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as BrandPack;
  } catch {
    return null;
  }
}

export async function saveBrandPack(
  circleId: string,
  pack: BrandPack,
): Promise<void> {
  const next: BrandPack = { ...pack, updatedAt: new Date().toISOString() };
  try {
    await storage.setItem(brandPackKey(circleId), JSON.stringify(next));
  } catch {
    // Quota exceeded on web, for example. Not fatal — pack just won't persist.
  }
}

export async function clearBrandPack(circleId: string): Promise<void> {
  try { await storage.removeItem(brandPackKey(circleId)); } catch {}
}

/**
 * Translate a BrandPack into the `system_extra` string we pass to the
 * build-stream edge function. Returns null when the pack would contribute
 * nothing (all fields empty) so the generic system prompt stays clean.
 */
export function buildBrandPromptPrefix(pack: BrandPack | null | undefined): string | null {
  if (!pack) return null;
  const lines: string[] = [];
  if (pack.primaryColor)   lines.push(`- Primary color: ${pack.primaryColor}`);
  if (pack.secondaryColor) lines.push(`- Secondary color: ${pack.secondaryColor}`);
  if (pack.bgColor)        lines.push(`- Background color: ${pack.bgColor}`);
  if (pack.textColor)      lines.push(`- Text color: ${pack.textColor}`);
  if (pack.fontHeading)    lines.push(`- Heading font: ${pack.fontHeading}`);
  if (pack.fontBody)       lines.push(`- Body font: ${pack.fontBody}`);
  if (pack.voice)          lines.push(`- Voice: ${DEFAULT_BRAND_VOICE_LABEL[pack.voice]}`);
  if (pack.tagline)        lines.push(`- Tagline (must appear somewhere visible): "${pack.tagline}"`);
  if (pack.logoUrl)        lines.push(`- Logo: <img src="${pack.logoUrl}" alt="logo" /> — place in the header`);
  if (pack.customNotes)    lines.push(`\nAdditional brand notes:\n${pack.customNotes}`);
  if (lines.length === 0) return null;
  return `BRAND PACK — honor these exactly:\n${lines.join('\n')}`;
}

/** Lightweight check: does the circle have a non-empty brand pack? */
export function isBrandPackActive(pack: BrandPack | null | undefined): boolean {
  if (!pack) return false;
  return !!(
    pack.primaryColor || pack.secondaryColor || pack.bgColor || pack.textColor ||
    pack.fontHeading || pack.fontBody || pack.voice || pack.tagline ||
    pack.logoUrl || (pack.customNotes && pack.customNotes.trim())
  );
}
