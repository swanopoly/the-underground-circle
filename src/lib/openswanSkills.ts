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
import { listLibrarySkills } from './skillLibrary';
import { renderLibrarySkillsBlock } from './librarySkillGateCore';

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

  const libraryBlock = renderLibrarySkillsBlock(librarySkills, args.query);
  const combined = [personaResolution.promptBlock, libraryBlock]
    .filter((block) => block && block.trim().length > 0)
    .join('\n\n');

  return {
    skills: personaResolution.skills,
    promptBlock: combined,
  };
}
