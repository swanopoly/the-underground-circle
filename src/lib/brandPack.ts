/**
 * Per-circle brand pack for the Chat Live Builder
 *
 * Auto-prepended to /build-page prompts so generated pages match the user's
 * brand out of the box. Stored per-circle in localStorage — no DB write.
 * Migrating to a `circles.settings.brandPack` jsonb is a one-effect swap
 * when the feature matures; today the local-only path keeps it no-regret.
 */

import { storage } from './storage';
import {
  chatPersonalCircleStorageKey,
  type ChatPersonalStorageScope,
} from './chatSessionStatePersistence';

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

function legacyBrandPackKey(circleId: string): string {
  return `${BRAND_PACK_STORAGE_KEY}_${circleId}`;
}

function brandPackKey(scope: ChatPersonalStorageScope): string | null {
  return chatPersonalCircleStorageKey('brand_pack', scope);
}

export async function loadBrandPack(scope: ChatPersonalStorageScope): Promise<BrandPack | null> {
  const key = brandPackKey(scope);
  if (!key || typeof scope.circleId !== 'string') return null;
  try {
    // Free-form notes and logo URLs are personal, even within one Circle.
    // Delete the legacy Circle-only value without assigning it to any user.
    await storage.removeItem(legacyBrandPackKey(scope.circleId));
    const raw = await storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as BrandPack;
  } catch {
    return null;
  }
}

export async function saveBrandPack(
  scope: ChatPersonalStorageScope,
  pack: BrandPack,
): Promise<void> {
  const key = brandPackKey(scope);
  if (!key) return;
  const next: BrandPack = { ...pack, updatedAt: new Date().toISOString() };
  try {
    await storage.setItem(key, JSON.stringify(next));
  } catch {
    // Quota exceeded on web, for example. Not fatal — pack just won't persist.
  }
}

export async function clearBrandPack(scope: ChatPersonalStorageScope): Promise<void> {
  const key = brandPackKey(scope);
  if (!key) return;
  try {
    await storage.removeItem(key);
    if (typeof scope.circleId === 'string') {
      await storage.removeItem(legacyBrandPackKey(scope.circleId));
    }
  } catch {}
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
