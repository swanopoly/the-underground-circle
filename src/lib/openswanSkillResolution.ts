import type { OpenSwanChatMode } from './openswanModePolicy';
import type { OpenSwanTaskKind } from './openswanTaskPlanner';
import type { Skill } from './skillRegistry';
import { getOpenSwanSkillPlaybook, type OpenSwanSkillPlaybook } from './openswanSkillPlaybooks';

export type OpenSwanResolvedSkill = Skill & {
  source: 'enabled' | 'recommended' | 'inferred';
  rationale: string;
  playbook: OpenSwanSkillPlaybook | null;
  /** Hoisted hint bonus (matched-query-hint +5 / task-hint +3 / mode-hint +2).
   *  PRIMARY sort key for the resolved order; carried on the skill so
   *  downstream content-aware rankers can respect hint precedence. */
  hintScore?: number;
};

export type OpenSwanSkillResolution = {
  skills: OpenSwanResolvedSkill[];
  promptBlock: string;
};

export type OpenSwanSkillResolutionInput = {
  enabledSkills: Skill[];
  allSkills: Skill[];
  recommendedSkillNames?: string[];
  preferredSkillNames?: string[];
  query: string;
  mode?: OpenSwanChatMode | string | null;
  taskKind?: string | null;
  maxSkills?: number;
};

const TASK_KIND_SKILL_HINTS: Partial<Record<OpenSwanTaskKind, string[]>> = {
  build: ['bug_hunt', 'refactor', 'test_writer', 'code_explain'],
  debug: ['bug_hunt', 'test_writer', 'code_explain'],
  review: ['critique_pr', 'summarize_thread'],
  architect: ['research_topic', 'summarize_thread', 'code_explain'],
  research: ['research_topic', 'summarize_thread'],
  automation: ['summarize_thread'],
};

const MODE_SKILL_HINTS: Partial<Record<OpenSwanChatMode, string[]>> = {
  build: ['bug_hunt', 'refactor', 'test_writer'],
  execute: ['bug_hunt', 'test_writer'],
  review: ['critique_pr', 'summarize_thread'],
  research: ['research_topic', 'summarize_thread'],
  support: ['bug_hunt', 'summarize_thread'],
  design: ['research_topic'],
  plan: ['research_topic', 'summarize_thread'],
};

const QUERY_SKILL_HINTS: Array<{ names: string[]; patterns: RegExp[]; rationale: string }> = [
  {
    names: ['critique_pr'],
    patterns: [/\b(review|audit|critique|look over|findings|regression)\b/i, /\bpr\b/i],
    rationale: 'The request is review-oriented and benefits from findings-first critique behavior.',
  },
  {
    names: ['bug_hunt', 'test_writer'],
    patterns: [/\b(debug|fix|broken|error|bug|crash|exception|regression)\b/i],
    rationale: 'The request is debugging-oriented and benefits from root-cause plus regression-check behavior.',
  },
  {
    names: ['research_topic', 'summarize_thread'],
    patterns: [/\b(research|investigate|compare|tradeoff|options|best approach|deep dive)\b/i],
    rationale: 'The request is research-oriented and benefits from structured investigation.',
  },
  {
    names: ['test_writer'],
    patterns: [/\b(test|tests|spec|coverage|assert|jest|vitest|playwright|cypress)\b/i],
    rationale: 'The request explicitly mentions tests or verification.',
  },
  {
    names: ['refactor', 'code_explain'],
    patterns: [/\b(refactor|restructure|modular|clean up|organize|extract)\b/i],
    rationale: 'The request is about reshaping code and benefits from refactor-oriented guidance.',
  },
  {
    names: ['summarize_thread'],
    patterns: [/\b(summarize|summary|recap|what happened|thread)\b/i],
    rationale: 'The request asks for summarization or thread condensation.',
  },
  {
    names: ['engineering-design'],
    patterns: [
      /\b(design|size|model|draft|analy[sz]e)\b.{0,80}\b(bracket|shaft|gear(box)?|beam|spring|bolt|vessel|plate|bearing|flange|pulley|cam|truss|frame)s?\b/i,
      /\b(stress|deflection|buckling|torsion|fatigue|bending moment|section modulus|safety factor)\b/i,
      /\b(dxf|stl|cad model)\b/i,
      /\b(tolerance stack|iso fit|press fit|interference fit|bolt circle|tap drill)\b/i,
      /\b(torque|stiffness)\b.{0,40}\b(shaft|spring|beam|column)s?\b/i,
    ],
    rationale: 'The request is an engineering design/analysis task and benefits from the size → draw → model → measure → tolerance pipeline.',
  },
];

function inferTaskKindFromQuery(query: string): OpenSwanTaskKind | null {
  if (/\b(review|audit|critique|findings)\b/i.test(query)) return 'review';
  if (/\b(debug|fix|broken|error|bug|crash|exception|regression)\b/i.test(query)) return 'debug';
  if (/\b(architect|architecture|boundary|design system|structure|modular|refactor)\b/i.test(query)) return 'architect';
  if (/\b(research|investigate|compare|tradeoff|options|best approach|deep dive)\b/i.test(query)) return 'research';
  if (/\b(automate|workflow|schedule|pipeline|orchestrate)\b/i.test(query)) return 'automation';
  if (/\b(build|create|implement|ship|make|write|component|screen|page|feature)\b/i.test(query)) return 'build';
  return null;
}

function formatSkillPromptBlock(skills: OpenSwanResolvedSkill[]): string {
  if (skills.length === 0) return '';

  const lines: string[] = ['## OpenSwan Active Skills'];
  lines.push('Treat these as active capability modules. Pull them in when they materially improve the answer or execution path.');

  for (const skill of skills) {
    const tierTag = skill.costTier === 'free' ? '' : ` [${skill.costTier}]`;
    lines.push(`- **${skill.displayName}** (${skill.name})${tierTag} · ${skill.source}`);
    lines.push(`  Why active: ${skill.rationale}`);
    lines.push(`  Scope: ${skill.description}`);
    if (skill.requiredTools.length > 0) {
      lines.push(`  Tools: ${skill.requiredTools.join(', ')}`);
    }
    if (skill.promptFragment) {
      lines.push(`  ${skill.promptFragment}`);
    }
    if (skill.playbook?.executionPattern?.length) {
      lines.push(`  Execution pattern: ${skill.playbook.executionPattern.join(' ')}`);
    }
    if (skill.playbook?.toolPolicy?.length) {
      lines.push(`  Tool policy: ${skill.playbook.toolPolicy.join(' ')}`);
    }
    if (skill.playbook?.antiPatterns?.length) {
      lines.push(`  Avoid: ${skill.playbook.antiPatterns.join('; ')}`);
    }
    if (skill.playbook?.exampleOutcome) {
      lines.push(`  Good outcome: ${skill.playbook.exampleOutcome}`);
    }
  }

  return lines.join('\n');
}

export function resolveOpenSwanSkillsFromCatalog(args: OpenSwanSkillResolutionInput): OpenSwanSkillResolution {
  const requestedTaskKind =
    (typeof args.taskKind === 'string' && args.taskKind
      ? args.taskKind
      : inferTaskKindFromQuery(args.query)) as OpenSwanTaskKind | null;
  const modeKey = (typeof args.mode === 'string' ? args.mode : null) as OpenSwanChatMode | null;
  const maxSkills = Math.max(3, Math.min(args.maxSkills || 6, 10));

  const byName = new Map(args.allSkills.map((skill) => [skill.name, skill]));
  const resolved = new Map<string, OpenSwanResolvedSkill>();

  for (const skill of args.enabledSkills) {
    resolved.set(skill.id, {
      ...skill,
      source: 'enabled',
      rationale: 'This skill is explicitly enabled for the active soul in this circle.',
      playbook: getOpenSwanSkillPlaybook(skill.name),
    });
  }

  for (const name of args.recommendedSkillNames || []) {
    const skill = byName.get(name);
    if (!skill || resolved.has(skill.id)) continue;
    resolved.set(skill.id, {
      ...skill,
      source: 'recommended',
      rationale: 'This skill is recommended for the active soul and should be available as a strong default.',
      playbook: getOpenSwanSkillPlaybook(skill.name),
    });
  }

  for (const name of args.preferredSkillNames || []) {
    const skill = byName.get(name);
    if (!skill || resolved.has(skill.id)) continue;
    resolved.set(skill.id, {
      ...skill,
      source: 'recommended',
      rationale: 'This skill is preferred by the active runtime role and should bias execution behavior.',
      playbook: getOpenSwanSkillPlaybook(skill.name),
    });
  }

  const taskHintNames = new Set<string>(requestedTaskKind ? (TASK_KIND_SKILL_HINTS[requestedTaskKind] || []) : []);
  const modeHintNames = new Set<string>(modeKey ? (MODE_SKILL_HINTS[modeKey] || []) : []);
  const matchedQueryHintNames = new Set<string>();
  const inferredNames = new Set<string>();
  for (const name of taskHintNames) inferredNames.add(name);
  for (const name of modeHintNames) inferredNames.add(name);
  for (const hint of QUERY_SKILL_HINTS) {
    if (hint.patterns.some((pattern) => pattern.test(args.query))) {
      for (const name of hint.names) {
        inferredNames.add(name);
        matchedQueryHintNames.add(name);
      }
    }
  }

  for (const name of inferredNames) {
    const skill = byName.get(name);
    if (!skill || resolved.has(skill.id)) continue;
    const queryHint = QUERY_SKILL_HINTS.find((hint) => hint.names.includes(name) && hint.patterns.some((pattern) => pattern.test(args.query)));
    const rationale = queryHint?.rationale
      || (requestedTaskKind ? `This skill matches the inferred task kind: ${requestedTaskKind}.` : 'This skill matches the active OpenSwan mode and request shape.');
    resolved.set(skill.id, {
      ...skill,
      source: 'inferred',
      rationale,
      playbook: getOpenSwanSkillPlaybook(skill.name),
    });
  }

  // Hoisted hint score (matched-query-hint +5 / task-hint +3 / mode-hint +2):
  // precomputed once per skill name so the comparator is pure map lookups and
  // the score can ride along on each resolved skill as `hintScore` for
  // downstream content-aware ranking. Ordering is byte-identical to the
  // previous inline comparator (hint desc → sourceRank → costTier → displayName).
  const hintScoreByName = new Map<string, number>();
  for (const skill of resolved.values()) {
    if (hintScoreByName.has(skill.name)) continue;
    let score = 0;
    if (matchedQueryHintNames.has(skill.name)) score += 5;
    if (taskHintNames.has(skill.name)) score += 3;
    if (modeHintNames.has(skill.name)) score += 2;
    hintScoreByName.set(skill.name, score);
  }

  const ordered = Array.from(resolved.values()).sort((a, b) => {
    const aScore = hintScoreByName.get(a.name) || 0;
    const bScore = hintScoreByName.get(b.name) || 0;
    if (aScore !== bScore) return bScore - aScore;
    const sourceRank = { enabled: 0, recommended: 1, inferred: 2 } as const;
    if (sourceRank[a.source] !== sourceRank[b.source]) {
      return sourceRank[a.source] - sourceRank[b.source];
    }
    if ((a.costTier || '') !== (b.costTier || '')) {
      return String(a.costTier || '').localeCompare(String(b.costTier || ''));
    }
    return a.displayName.localeCompare(b.displayName);
  })
    .slice(0, maxSkills)
    .map((skill) => ({ ...skill, hintScore: hintScoreByName.get(skill.name) || 0 }));

  return {
    skills: ordered,
    promptBlock: formatSkillPromptBlock(ordered),
  };
}
