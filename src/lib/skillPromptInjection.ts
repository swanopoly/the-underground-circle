/**
 * skillPromptInjection — builds the user-role message that advertises
 * available library skills to the agent.
 *
 * This is the **only** way library skills should reach the model. Rationale
 * (Hermes + our prompt-caching memory):
 *   - The frozen system prompt is `cache_control: ephemeral` for cost.
 *   - Adding volatile skill tables to the system prompt would invalidate
 *     the cache every time a skill is added / edited / removed.
 *   - A user-role message with the skill metadata table keeps the system
 *     prompt stable, and costs only ~20 tokens per skill.
 *
 * Use like:
 *
 *   const messages: AgentMessage[] = [];
 *   messages.push({ role: 'user', content: await buildSkillsContextMessage(circleId) });
 *   messages.push({ role: 'user', content: userMessage });
 *
 * The agent then calls the `viewLibrarySkill` tool to pull the full body
 * when a skill looks relevant.
 */

import { listLibrarySkills, renderLibraryMetadataTable } from './skillLibrary';

export type BuildSkillsContextOptions = {
  /** Narrow to skills whose tags overlap this list. Default: no filter. */
  tags?: string[];
  /** Max skills listed. Default 25 — keep the metadata table compact. */
  limit?: number;
  /** If true and there are zero skills, return empty string instead of the default placeholder. */
  suppressWhenEmpty?: boolean;
};

/**
 * Returns the user-role message text advertising the circle's SKILL.md
 * library. Safe to call on every turn — `listLibrarySkills` is cheap
 * (single indexed Supabase read) and the result is tiny.
 *
 * Returns '' when the circle has no skills and `suppressWhenEmpty` is set;
 * otherwise returns a short placeholder so the model knows the library
 * exists (and won't be confused if it later hears about skills).
 */
export async function buildSkillsContextMessage(
  circleId: string,
  opts: BuildSkillsContextOptions = {},
): Promise<string> {
  const skills = await listLibrarySkills(circleId, {
    tags: opts.tags,
    limit: Math.min(opts.limit ?? 25, 100),
  });
  if (skills.length === 0 && opts.suppressWhenEmpty) return '';
  return renderLibraryMetadataTable(skills);
}
