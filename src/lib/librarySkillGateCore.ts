// librarySkillGateCore — renders the circle SKILL.md library prompt table AND
// applies the capability-match gate so a clearly-matching circle procedure gets
// APPLIED (the model is told to `viewLibrarySkill(name)` and follow it) and a
// near-tie gets DISAMBIGUATED (ask the user which applies) instead of the model
// guessing from ~20 one-line rows.
//
// WHY: `openswanSkills.resolveOpenSwanSkills` used to render the library block
// with a private `formatLibrarySkillsBlock` whose legacy substring scoring
// (+ a ≤2 success boost) only ORDERED the table — nothing ever decided whether
// the top row was the RIGHT, dominant procedure for this request. That decision
// layer exists (capabilityMatchGateCore) but was orphaned. This core moves the
// renderer here VERBATIM (table ordering/rows stay byte-identical) and layers
// the gate on top as at most ONE extra line under the header:
//   • 'apply'        → "Best match for this request: …" (strong dominant match)
//   • 'disambiguate' → "Multiple skills match closely: …" (near-tie → ask user)
//   • 'suggest'/'none' → NOTHING appended — output is byte-identical to legacy.
//
// The GATE scores with `skillContentScore` (skillRelevanceCore whole-token
// lexical overlap, 0-10, name/description/tags only) — NOT the legacy substring
// score and NOT the success boost. So popularity alone (usage/success counts)
// can never clear the eligibility floor and force a "best match" line; only
// real content overlap can. Gate thresholds are the gate core's own defaults
// (minScore 1 / strongScore 6 / dominanceMargin 0.25), maxAlternatives 2.
// Rendered gate ids are control/fence-stripped + length-clamped by the gate
// core, so a hostile skill name cannot smuggle structure into the prompt line.
//
// PURITY: value imports only from the two zero-dep cores
// (capabilityMatchGateCore, skillRelevanceCore); `LibrarySkillMetadata` is a
// type-only import — tsx/esbuild-loadable with no react-native / supabase in
// the graph. Deterministic: no Date.now / Math.random. Bounded: table capped at
// 20 rows (legacy), gate candidates capped by the gate core (200 scanned).
// Smoke: scripts/library-skill-gate-core-smoketest.ts
// Evals: evals/corpus/skill-gate.ts

import type { LibrarySkillMetadata } from './skillLibrary';
import { decideCapabilityMatch } from './capabilityMatchGateCore';
import { skillContentScore } from './skillRelevanceCore';

/** Gate output cap: at most 2 runner-ups surface (disambiguate cluster ≤ 3). */
export const LIBRARY_SKILL_GATE_MAX_ALTERNATIVES = 2;

/**
 * The at-most-one gate line for the library block, or null when the gate stays
 * quiet ('suggest'/'none'). Candidates are scored with whole-token content
 * overlap only (no success boost), so the eligibility floor is real signal.
 */
export function buildLibrarySkillGateLine(
  skills: LibrarySkillMetadata[],
  query: string,
): string | null {
  const candidates = skills.map((s) => ({
    id: s.name,
    score: skillContentScore({ name: s.name, description: s.description, tags: s.tags }, query),
    label: s.name,
  }));
  const decision = decideCapabilityMatch(candidates, {
    maxAlternatives: LIBRARY_SKILL_GATE_MAX_ALTERNATIVES,
  });
  if (decision.action === 'apply' && decision.primary) {
    const id = decision.primary.id;
    return `Best match for this request: "${id}" — call viewLibrarySkill('${id}') and follow it before answering.`;
  }
  if (decision.action === 'disambiguate' && decision.alternatives.length > 0) {
    const ids = decision.alternatives.map((c) => `"${c.id}"`).join(', ');
    return `Multiple skills match closely: ${ids}. Ask the user which one applies before relying on either.`;
  }
  return null;
}

/**
 * Renders SKILL.md library metadata as a compact section for prompt
 * injection. Up to 20 skills listed; ranked by:
 *   1. Tag overlap with lowercased query words (highest signal).
 *   2. Description word overlap.
 *   3. Alphabetical fallback.
 *
 * The legacy substring scoring + bounded success boost order the TABLE only;
 * the gate line above the rows is decided separately by
 * `buildLibrarySkillGateLine`. When the gate is quiet the output is
 * byte-identical to the legacy `formatLibrarySkillsBlock`.
 *
 * Zero-skill circles get an empty string so the block is elided cleanly.
 */
export function renderLibrarySkillsBlock(skills: LibrarySkillMetadata[], query: string): string {
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
  const gateLine = buildLibrarySkillGateLine(skills, query);
  if (gateLine) lines.push(gateLine);
  for (const { s } of scored) {
    const tagTail = s.tags.length > 0 ? ` [${s.tags.join(', ')}]` : '';
    lines.push(`- ${s.name} (v${s.version})${tagTail}: ${s.description}`);
  }
  return lines.join('\n');
}
