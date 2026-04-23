import type { OpenSwanChatMode } from './openswanModePolicy';
import type { OpenSwanTaskKind } from './openswanTaskPlanner';
import type { Skill } from './skillRegistry';
import { getOpenSwanSkillPlaybook, type OpenSwanSkillPlaybook } from './openswanSkillPlaybooks';

export type OpenSwanResolvedSkill = Skill & {
  source: 'enabled' | 'recommended' | 'inferred';
  rationale: string;
  playbook: OpenSwanSkillPlaybook | null;
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

  const ordered = Array.from(resolved.values()).sort((a, b) => {
    const relevanceScore = (skill: OpenSwanResolvedSkill) => {
      let score = 0;
      if (matchedQueryHintNames.has(skill.name)) score += 5;
      if (taskHintNames.has(skill.name)) score += 3;
      if (modeHintNames.has(skill.name)) score += 2;
      return score;
    };
    const aScore = relevanceScore(a);
    const bScore = relevanceScore(b);
    if (aScore !== bScore) return bScore - aScore;
    const sourceRank = { enabled: 0, recommended: 1, inferred: 2 } as const;
    if (sourceRank[a.source] !== sourceRank[b.source]) {
      return sourceRank[a.source] - sourceRank[b.source];
    }
    if ((a.costTier || '') !== (b.costTier || '')) {
      return String(a.costTier || '').localeCompare(String(b.costTier || ''));
    }
    return a.displayName.localeCompare(b.displayName);
  }).slice(0, maxSkills);

  return {
    skills: ordered,
    promptBlock: formatSkillPromptBlock(ordered),
  };
}
