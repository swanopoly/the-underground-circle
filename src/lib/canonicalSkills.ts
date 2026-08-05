/**
 * canonicalSkills — the repo's canonical SKILL.md set, bundled for the runtime.
 *
 * The skill bodies live in skills/<name>/SKILL.md and are codegen'd into
 * canonicalSkills.generated.ts (`npm run build:canonical-skills-bundle`) so the
 * React Native app can seed them into a circle's library without DB credentials
 * or SQL — an in-app "Add canonical skills" action writes them through the
 * logged-in member's session (satisfying the `author_id = auth.uid()` RLS).
 */

import { CANONICAL_SKILLS, type CanonicalSkill } from './canonicalSkills.generated';

export { CANONICAL_SKILLS, type CanonicalSkill } from './canonicalSkills.generated';

/** Canonical skills not yet present (by name) in the circle's library. */
export function canonicalSkillsMissing(existingNames: Iterable<string>): CanonicalSkill[] {
  const have = new Set(existingNames);
  return CANONICAL_SKILLS.filter((skill) => !have.has(skill.name));
}
