/**
 * skillRegistry — Phase C5. Loads skills from DB, resolves which skills
 * are active for a given (circle, SOUL), and builds the Block E prompt
 * fragment for system-prompt injection.
 *
 * Phase 2c (2026-04-21): `buildSkillsPromptBlock` also pulls in
 * agentskills.io-format library skills from `circle_skills` via
 * `listLibrarySkills`. One unified block surfaces both subsystems so
 * callers don't need to know the two exist separately. Library skills
 * appear as metadata only (progressive disclosure) — the agent uses the
 * `viewLibrarySkill` tool to fetch a body when it decides to follow one.
 */

import { supabase } from './supabase';
import { listLibrarySkills, type LibrarySkillMetadata } from './skillLibrary';

export interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  promptFragment: string | null;
  requiredTools: string[];
  costTier: string;
}

export interface CircleSoulSkill {
  skillId: string;
  skillName: string;
  enabled: boolean;
}

const RECOMMENDED_SOUL_SKILLS: Record<string, string[]> = {
  'soul:civil-engineer': [
    'civil_licensure_scope',
    'civil_field_and_lab_testing',
    'civil_structural_and_material_codes',
    'civil_drainage_and_permitting',
    'civil_construction_admin_qaqc',
  ],
};

const skillCache = new Map<string, { skills: Skill[]; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function loadAllSkills(): Promise<Skill[]> {
  const cached = skillCache.get('__all__');
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.skills;
  const { data, error } = await supabase
    .from('skills')
    .select('id, name, display_name, description, category, prompt_fragment, required_tools, cost_tier')
    .eq('is_active', true)
    .order('category')
    .order('name');
  if (error) {
    if ((error as any).code !== 'PGRST205') {
      console.warn('[skillRegistry] load failed:', error.message);
    }
    return [];
  }
  const skills: Skill[] = (data || []).map((r: any) => ({
    id: r.id,
    name: r.name,
    displayName: r.display_name,
    description: r.description,
    category: r.category,
    promptFragment: r.prompt_fragment,
    requiredTools: r.required_tools || [],
    costTier: r.cost_tier,
  }));
  skillCache.set('__all__', { skills, fetchedAt: Date.now() });
  return skills;
}

export async function loadEnabledSkillsForSoul(
  circleId: string,
  soulKey: string,
): Promise<Skill[]> {
  const cacheKey = `${circleId}::${soulKey}`;
  const cached = skillCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return cached.skills;

  const { data, error } = await supabase
    .from('circle_soul_skills')
    .select('skill_id, skill:skills!inner(id, name, display_name, description, category, prompt_fragment, required_tools, cost_tier)')
    .eq('circle_id', circleId)
    .eq('soul_key', soulKey)
    .eq('enabled', true);

  if (error) {
    if ((error as any).code !== 'PGRST205') {
      console.warn('[skillRegistry] loadEnabled failed:', error.message);
    }
    return [];
  }

  const skills: Skill[] = (data || []).map((r: any) => ({
    id: r.skill?.id,
    name: r.skill?.name,
    displayName: r.skill?.display_name,
    description: r.skill?.description,
    category: r.skill?.category,
    promptFragment: r.skill?.prompt_fragment,
    requiredTools: r.skill?.required_tools || [],
    costTier: r.skill?.cost_tier,
  })).filter(s => s.id);
  skillCache.set(cacheKey, { skills, fetchedAt: Date.now() });
  return skills;
}

export async function loadPreparedSkillsForSoul(
  circleId: string,
  soulKey: string,
  userId?: string,
): Promise<Skill[]> {
  if (!soulKey) return [];
  if (userId) {
    await ensureDefaultSkillsEnabled(circleId, soulKey, userId);
  }
  return loadEnabledSkillsForSoul(circleId, soulKey);
}

// Default skills to auto-enable for each SOUL the first time they're loaded.
// This ensures the skills system isn't "dark" for users who haven't visited
// the SkillAdminPanel. Keys = soul_key, values = skill names.
const DEFAULT_SOUL_SKILLS: Record<string, string[]> = {
  'soul:sr-engineer': ['dig_for_bug', 'critique_pr', 'summarize_thread'],
  'soul:code-reviewer': ['critique_pr', 'summarize_thread'],
  'soul:architect': ['research_topic', 'summarize_thread'],
};
const autoEnableAttempted = new Set<string>();

async function ensureDefaultSkillsEnabled(circleId: string, soulKey: string, userId: string): Promise<void> {
  const key = `${circleId}::${soulKey}`;
  if (autoEnableAttempted.has(key)) return;
  autoEnableAttempted.add(key);
  const defaults = DEFAULT_SOUL_SKILLS[soulKey];
  if (!defaults?.length) return;
  try {
    const allSkills = await loadAllSkills();
    const enabled = await loadEnabledSkillsForSoul(circleId, soulKey);
    if (enabled.length > 0) return; // user has already configured — don't override
    for (const name of defaults) {
      const skill = allSkills.find(s => s.name === name);
      if (skill) {
        await enableSkillForSoul(circleId, soulKey, skill.id, userId);
      }
    }
    skillCache.delete(`${circleId}::${soulKey}`);
  } catch { /* non-fatal */ }
}

/**
 * Build the Block E system-prompt fragment from enabled skills.
 *
 * Unifies two skill subsystems into a single block:
 *   1. Persona skills (DB-column `skills` + `circle_soul_skills`) — requires
 *      a `soulKey` so we can resolve which ones are enabled for this SOUL.
 *   2. Library skills (markdown `circle_skills`) — circle-wide, don't need
 *      a soul; listed as metadata only so the model knows they exist and
 *      can pull the body on demand via the `viewLibrarySkill` tool.
 *
 * Returns '' when both sets are empty so callers can unconditionally concat.
 */
export async function buildSkillsPromptBlock(
  circleId: string,
  soulKey: string | null,
  userId?: string,
): Promise<string> {
  // Load both subsystems in parallel. Persona needs a soul; library is
  // circle-wide and always loads (no-op if the table has no rows).
  const [personaSkills, librarySkills] = await Promise.all([
    soulKey ? loadPreparedSkillsForSoul(circleId, soulKey, userId) : Promise.resolve([] as Skill[]),
    listLibrarySkills(circleId, { limit: 60 }),
  ]);

  if (personaSkills.length === 0 && librarySkills.length === 0) return '';

  const lines: string[] = ['## Available skills'];
  lines.push('You have these skills enabled. Use them when the user\'s request matches. Each skill may require tools — call them as needed.');

  // ── Persona section (DB-column prompt fragments) ──────────────────────
  if (personaSkills.length > 0) {
    const byCategory = new Map<string, Skill[]>();
    for (const s of personaSkills) {
      const cat = s.category || 'general';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(s);
    }
    for (const [cat, catSkills] of byCategory) {
      lines.push(`\n### ${cat.toUpperCase()}`);
      for (const s of catSkills) {
        const tierTag = s.costTier === 'free' ? '' : ` [${s.costTier}]`;
        lines.push(`- **${s.displayName}** (${s.name})${tierTag}: ${s.description}`);
        if (s.requiredTools.length > 0) lines.push(`  Tools: ${s.requiredTools.join(', ')}`);
        if (s.promptFragment) lines.push(`  ${s.promptFragment}`);
      }
    }
  }

  // ── Library section (SKILL.md metadata only) ──────────────────────────
  // We list name + description + tags. The body comes through the
  // `viewLibrarySkill` tool so the model can progressively disclose.
  if (librarySkills.length > 0) {
    lines.push('\n### LIBRARY');
    lines.push('SKILL.md procedures authored by circle members. Call `viewLibrarySkill(name)` to read the full body when one matches the task.');
    for (const s of librarySkills as LibrarySkillMetadata[]) {
      const tagStr = s.tags && s.tags.length > 0 ? ` [${s.tags.slice(0, 4).join(', ')}]` : '';
      lines.push(`- **${s.name}** v${s.version}${tagStr}: ${s.description}`);
    }
  }

  return lines.join('\n');
}

// ── Skill management (admin-facing) ─────────────────────────────────────────

export async function enableSkillForSoul(
  circleId: string,
  soulKey: string,
  skillId: string,
  userId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('circle_soul_skills')
    .upsert({
      circle_id: circleId,
      soul_key: soulKey,
      skill_id: skillId,
      enabled: true,
      enabled_by: userId,
      enabled_at: new Date().toISOString(),
    }, { onConflict: 'circle_id,soul_key,skill_id' });
  // Invalidate on SUCCESS — the cached list is stale precisely because the
  // write landed. This read `if (error)`, the inverse of disableSkillForSoul
  // below, so enabling a skill left the stale list in place and the skill
  // stayed dormant until the TTL expired.
  if (!error) skillCache.delete(`${circleId}::${soulKey}`);
  return !error;
}

export async function disableSkillForSoul(
  circleId: string,
  soulKey: string,
  skillId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('circle_soul_skills')
    .update({ enabled: false })
    .eq('circle_id', circleId)
    .eq('soul_key', soulKey)
    .eq('skill_id', skillId);
  if (!error) skillCache.delete(`${circleId}::${soulKey}`);
  return !error;
}

export function getRecommendedSkillNamesForSoul(soulKey: string | null | undefined): string[] {
  if (!soulKey) return [];
  return RECOMMENDED_SOUL_SKILLS[soulKey] || [];
}
