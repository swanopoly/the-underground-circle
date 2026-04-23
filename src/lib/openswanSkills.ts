import {
  getRecommendedSkillNamesForSoul,
  loadAllSkills,
  loadPreparedSkillsForSoul,
} from './skillRegistry';
import {
  resolveOpenSwanSkillsFromCatalog,
  type OpenSwanResolvedSkill,
  type OpenSwanSkillResolution,
} from './openswanSkillResolution';
import type { OpenSwanChatMode } from './openswanModePolicy';
import { listLibrarySkills, type LibrarySkillMetadata } from './skillLibrary';

export type { OpenSwanResolvedSkill, OpenSwanSkillResolution } from './openswanSkillResolution';

/**
 * Phase 2c — merge persona skills (DB-column `skills`/`circle_soul_skills`,
 * Codex) with library skills (agentskills.io SKILL.md in `circle_skills`,
 * Claude Code) in a single resolution pass.
 *
 * Both surfaces stay distinct on disk; this just composes their prompt
 * output so one `promptBlock` carries both. Library skills appear as a
 * compact metadata table — the agent calls `viewLibrarySkill(name)` to
 * pull the full SKILL.md body, matching Hermes' progressive-disclosure
 * pattern. The table is cheap (~20 tokens/row), so keeping it in the
 * frozen prompt every turn is fine.
 */
export async function resolveOpenSwanSkills(args: {
  circleId?: string;
  userId?: string;
  soulKey?: string | null;
  mode?: OpenSwanChatMode | string | null;
  taskKind?: string | null;
  query: string;
  maxSkills?: number;
  preferredSkillNames?: string[];
}): Promise<OpenSwanSkillResolution> {
  if (!args.circleId) {
    return { skills: [], promptBlock: '' };
  }

  // Persona skills still require a soulKey. Library skills don't — they're
  // circle-wide and relevant regardless of which SOUL the user picked.
  // So even a no-soul session can still see the SKILL.md table.
  const [enabledSkills, allSkills, librarySkills] = await Promise.all([
    args.soulKey ? loadPreparedSkillsForSoul(args.circleId, args.soulKey, args.userId) : Promise.resolve([]),
    args.soulKey ? loadAllSkills() : Promise.resolve([]),
    listLibrarySkills(args.circleId, { limit: 40 }),
  ]);

  const personaResolution = args.soulKey
    ? resolveOpenSwanSkillsFromCatalog({
        enabledSkills,
        allSkills,
        recommendedSkillNames: getRecommendedSkillNamesForSoul(args.soulKey),
        preferredSkillNames: args.preferredSkillNames,
        query: args.query,
        mode: args.mode,
        taskKind: args.taskKind,
        maxSkills: args.maxSkills,
      })
    : { skills: [], promptBlock: '' };

  const libraryBlock = formatLibrarySkillsBlock(librarySkills, args.query);
  const combined = [personaResolution.promptBlock, libraryBlock]
    .filter((block) => block && block.trim().length > 0)
    .join('\n\n');

  return {
    skills: personaResolution.skills,
    promptBlock: combined,
  };
}

/**
 * Renders SKILL.md library metadata as a compact section for prompt
 * injection. Up to 20 skills listed; ranked by:
 *   1. Tag overlap with lowercased query words (highest signal).
 *   2. Description word overlap.
 *   3. Alphabetical fallback.
 *
 * Zero-skill circles get an empty string so the block is elided cleanly.
 */
function formatLibrarySkillsBlock(skills: LibrarySkillMetadata[], query: string): string {
  if (skills.length === 0) return '';
  const terms = query
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length >= 3);

  const scored = skills
    .map((s) => {
      let score = 0;
      for (const term of terms) {
        for (const tag of s.tags) {
          if (tag.toLowerCase().includes(term)) score += 3;
        }
        if (s.description.toLowerCase().includes(term)) score += 1;
        if (s.name.toLowerCase().includes(term)) score += 2;
      }
      // Boost skills used successfully before — usageCount + successCount as
      // light weight. Stays bounded so a rarely-relevant skill with 100 uses
      // doesn't drown out a new skill that actually matches the query.
      score += Math.min(2, (s.successCount || 0) / Math.max(1, s.usageCount || 1));
      return { s, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.s.name.localeCompare(b.s.name);
    })
    .slice(0, 20);

  const lines = [
    '## SKILL.md Library',
    'Circle-authored procedures. Call `viewLibrarySkill(name)` for the full body (procedure / pitfalls / verification) when one looks relevant.',
  ];
  for (const { s } of scored) {
    const tagTail = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : '';
    lines.push(`- ${s.name} (v${s.version})${tagTail}: ${s.description}`);
  }
  return lines.join('\n');
}
