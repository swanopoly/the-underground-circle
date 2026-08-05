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

import {
  fenceSkillBodyForModel,
  listLibrarySkills,
  loadSkillHealthByName,
  renderLibraryMetadataTable,
  viewLibrarySkill,
  viewLibrarySkillFile,
} from './skillLibrary';

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
  // L2 lifecycle: merge device-stored run-outcome health at read time —
  // FAILING skills get a compact "⚠ failing — review" marker (deprecation
  // signal, finding 2). Never blocks the table: health is best-effort.
  let healthByName: Awaited<ReturnType<typeof loadSkillHealthByName>> = {};
  try {
    healthByName = await loadSkillHealthByName(circleId);
  } catch {}
  return renderLibraryMetadataTable(skills, healthByName);
}

/**
 * Canonical way to hand a full SKILL.md body to the model (the
 * `viewLibrarySkill` / `skills.view` tool result). Fetches the body and runs
 * it through `fenceSkillBodyForModel` so it arrives UNTRUSTED-fenced and
 * bounded — a body containing `</skill_body>` or `</untrusted_quoted>` cannot
 * break out and be read as instructions.
 *
 * Tool handlers (chat runtime + edge) MUST use this instead of interpolating
 * the raw body into a hand-rolled `<skill_body>` wrapper. Returns null when
 * the skill doesn't exist / RLS blocks — same posture as `viewLibrarySkill`.
 */
export async function buildSkillBodyMessageForModel(
  circleId: string,
  name: string,
  opts: { maxChars?: number } = {},
): Promise<string | null> {
  const skill = await viewLibrarySkill(circleId, name);
  if (!skill) return null;
  return fenceSkillBodyForModel(skill, skill.content, opts);
}

/**
 * Same contract as `buildSkillBodyMessageForModel` for a Level-2 sub-file
 * body (`references/…`, `templates/…`, `scripts/…`). The relpath is validated
 * inside `viewLibrarySkillFile`; the returned body is fenced + bounded.
 */
export async function buildSkillFileMessageForModel(
  circleId: string,
  name: string,
  relpath: string,
  opts: { maxChars?: number } = {},
): Promise<string | null> {
  const file = await viewLibrarySkillFile(circleId, name, relpath);
  if (!file) return null;
  return fenceSkillBodyForModel(
    { name: `${name}/${file.relpath}`, description: file.mimeType || undefined },
    file.content,
    opts,
  );
}
