import { getSpiritById, type AgentSpirit } from './agentSpirits';
import { getSpiritOperationsProfile, type SpiritOperationsProfile } from './spiritOperationsProfiles';
import type { OpenSwanTaskKind, OpenSwanToolName, OpenSwanVerificationKind } from './openswanTaskPlanner';

export type SubagentRole =
  | 'planner'
  | 'researcher'
  | 'writer'
  | 'coder'
  | 'reviewer'
  | 'designer'
  | 'architect'
  | 'debugger'
  | 'tester'
  | 'support'
  | 'security'
  | 'devops';

export type SubagentSkillId =
  | 'planning.execution'
  | 'research.synthesis'
  | 'writing.delivery'
  | 'coding.implementation'
  | 'coding.review'
  | 'coding.architecture'
  | 'coding.debug'
  | 'qa.verification'
  | 'security.audit'
  | 'ops.release'
  | 'design.specification'
  | 'support.triage';

export interface SubagentCapabilityProfile {
  role: SubagentRole;
  displayName: string;
  description: string;
  icon: string;
  color: string;
  spiritId?: string;
  systemPrompt: string;
  skillBundleId: string;
  skills: SubagentSkillId[];
  modelPreference?: string;
  triggerPatterns: RegExp[];
  allowedTools: OpenSwanToolName[];
  preferredArtifacts: Array<'report' | 'code' | 'webpage' | 'checklist' | 'plan' | 'findings'>;
  preferredVerification: OpenSwanVerificationKind[];
  preferredTaskKinds: OpenSwanTaskKind[];
  riskTier?: AgentSpirit['riskTier'];
  evidencePosture?: AgentSpirit['evidencePosture'];
  communicationDensity?: AgentSpirit['communicationDensity'];
  operationsProfile?: SpiritOperationsProfile | null;
}

type CapabilityBlueprint = {
  role: SubagentRole;
  displayName: string;
  description: string;
  icon: string;
  spiritId?: string;
  fallbackPrompt: string;
  triggerPatterns: RegExp[];
  skills: SubagentSkillId[];
  allowedTools: OpenSwanToolName[];
  preferredArtifacts: Array<'report' | 'code' | 'webpage' | 'checklist' | 'plan' | 'findings'>;
  preferredVerification: OpenSwanVerificationKind[];
  preferredTaskKinds: OpenSwanTaskKind[];
  modelPreference?: string;
};

const BLUEPRINTS: CapabilityBlueprint[] = [
  {
    role: 'planner',
    displayName: 'Planner',
    description: 'Breaks complex work into phases, dependencies, and rollout order.',
    icon: 'P',
    spiritId: 'pm',
    fallbackPrompt: 'You are a planning specialist. Produce phased execution plans with dependencies, risks, and the critical path.',
    triggerPatterns: [/\b(plan|roadmap|phase|milestone|scope|sequence|rollout|priority)\b/i],
    skills: ['planning.execution'],
    allowedTools: ['code.inspect'],
    preferredArtifacts: ['plan', 'checklist', 'report'],
    preferredVerification: ['integration_review'],
    preferredTaskKinds: ['architect', 'automation', 'research', 'build'],
  },
  {
    role: 'researcher',
    displayName: 'Researcher',
    description: 'Builds source-backed comparisons, evidence maps, and recommendations.',
    icon: 'R',
    spiritId: 'researcher',
    fallbackPrompt: 'You are a research specialist. Produce source-backed research, comparisons, and concrete recommendations.',
    triggerPatterns: [/\b(research|investigate|compare|deep dive|best practice|tradeoff|landscape)\b/i],
    skills: ['research.synthesis'],
    allowedTools: ['code.inspect'],
    preferredArtifacts: ['report', 'plan'],
    preferredVerification: ['manual_review', 'integration_review'],
    preferredTaskKinds: ['research', 'architect'],
  },
  {
    role: 'writer',
    displayName: 'Writer',
    description: 'Creates polished docs, briefs, and publishable written content.',
    icon: 'W',
    spiritId: 'writer',
    fallbackPrompt: 'You are a senior writer. Produce polished, complete writing deliverables with clean structure.',
    triggerPatterns: [/\b(write|draft|documentation|readme|article|copy|guide)\b/i],
    skills: ['writing.delivery'],
    allowedTools: ['code.inspect'],
    preferredArtifacts: ['report', 'checklist'],
    preferredVerification: ['manual_review'],
    preferredTaskKinds: ['research', 'general'],
  },
  {
    role: 'coder',
    displayName: 'Builder',
    description: 'Implements production-quality code and build outputs.',
    icon: 'B',
    spiritId: 'sr-engineer',
    fallbackPrompt: 'You are a senior builder. Produce implementation-ready code with strong integration judgment.',
    triggerPatterns: [/\b(build|implement|code|component|api|feature|fix|refactor)\b/i],
    skills: ['coding.implementation'],
    allowedTools: ['code.inspect', 'code.generate', 'workspace.apply_artifacts', 'workspace.create_room', 'workspace.open_preview', 'verification.typecheck', 'verification.tests', 'verification.lint', 'verification.preview'],
    preferredArtifacts: ['code', 'webpage', 'checklist'],
    preferredVerification: ['typecheck', 'tests', 'lint', 'preview', 'integration_review'],
    preferredTaskKinds: ['build', 'debug'],
    modelPreference: 'claude-sonnet-4-6',
  },
  {
    role: 'reviewer',
    displayName: 'Reviewer',
    description: 'Produces severity-ranked findings, risks, and missing-test analysis.',
    icon: 'V',
    spiritId: 'code-reviewer',
    fallbackPrompt: 'You are a senior reviewer. Lead with findings, risks, and specific fixes.',
    triggerPatterns: [/\b(review|audit|assess|findings|critique|risk)\b/i],
    skills: ['coding.review'],
    allowedTools: ['code.inspect', 'code.review', 'verification.typecheck', 'verification.tests', 'verification.lint'],
    preferredArtifacts: ['findings', 'report', 'checklist'],
    preferredVerification: ['manual_review', 'integration_review', 'typecheck', 'tests'],
    preferredTaskKinds: ['review', 'debug', 'architect'],
  },
  {
    role: 'designer',
    displayName: 'Designer',
    description: 'Designs UI structure, interaction states, and visual direction.',
    icon: 'D',
    spiritId: 'designer',
    fallbackPrompt: 'You are a designer. Produce intentional, detailed design direction and UI specs.',
    triggerPatterns: [/\b(design|ui|ux|layout|visual|prototype|screen|landing page)\b/i],
    skills: ['design.specification'],
    allowedTools: ['code.inspect', 'workspace.open_preview', 'verification.preview'],
    preferredArtifacts: ['webpage', 'report', 'checklist'],
    preferredVerification: ['preview', 'manual_review'],
    preferredTaskKinds: ['build', 'architect'],
  },
  {
    role: 'architect',
    displayName: 'Architect',
    description: 'Shapes boundaries, contracts, and rollout strategy.',
    icon: 'A',
    spiritId: 'architect',
    fallbackPrompt: 'You are an architect. Optimize for maintainability, clean boundaries, and rollout safety.',
    triggerPatterns: [/\b(architect|architecture|boundary|layer|contract|migration|decompose)\b/i],
    skills: ['coding.architecture'],
    allowedTools: ['code.inspect', 'verification.lint'],
    preferredArtifacts: ['plan', 'report', 'checklist'],
    preferredVerification: ['integration_review', 'performance_review'],
    preferredTaskKinds: ['architect', 'build', 'review'],
  },
  {
    role: 'debugger',
    displayName: 'Debugger',
    description: 'Finds root causes and the smallest correct fix.',
    icon: '!',
    spiritId: 'sr-engineer',
    fallbackPrompt: 'You are a debugging specialist. Distinguish symptoms from root cause and define the smallest correct fix.',
    triggerPatterns: [/\b(debug|broken|error|exception|root cause|repro|regression)\b/i],
    skills: ['coding.debug'],
    allowedTools: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests'],
    preferredArtifacts: ['report', 'code', 'checklist'],
    preferredVerification: ['tests', 'integration_review', 'typecheck'],
    preferredTaskKinds: ['debug', 'review'],
  },
  {
    role: 'tester',
    displayName: 'Tester',
    description: 'Defines executable proof, regression checks, and release confidence.',
    icon: 'T',
    spiritId: 'qa-engineer',
    fallbackPrompt: 'You are a QA specialist. Focus on regression coverage and the highest-value verification checks.',
    triggerPatterns: [/\b(test|verify|regression|coverage|validate|qa|playwright|vitest|jest)\b/i],
    skills: ['qa.verification'],
    allowedTools: ['verification.typecheck', 'verification.tests', 'verification.lint', 'verification.preview', 'code.inspect'],
    preferredArtifacts: ['checklist', 'report'],
    preferredVerification: ['typecheck', 'tests', 'lint', 'preview', 'manual_review'],
    preferredTaskKinds: ['build', 'debug', 'review'],
  },
  {
    role: 'support',
    displayName: 'Support',
    description: 'Triages questions and turns ambiguous issues into clear next steps.',
    icon: 'S',
    spiritId: 'mentor',
    fallbackPrompt: 'You are a support specialist. Clarify the issue, isolate the problem, and give practical next steps.',
    triggerPatterns: [/\b(help|support|how do i|stuck|confused|troubleshoot)\b/i],
    skills: ['support.triage'],
    allowedTools: ['code.inspect'],
    preferredArtifacts: ['report', 'checklist'],
    preferredVerification: ['manual_review'],
    preferredTaskKinds: ['general', 'debug'],
  },
  {
    role: 'security',
    displayName: 'Security',
    description: 'Audits access, secrets, exploitability, and remediation strategy.',
    icon: 'Q',
    spiritId: 'security',
    fallbackPrompt: 'You are a security specialist. Prioritize exploitability, impact, and remediation clarity.',
    triggerPatterns: [/\b(security|secret|auth|vulnerab|owasp|threat|permissions)\b/i],
    skills: ['security.audit'],
    allowedTools: ['code.inspect', 'code.review', 'verification.tests'],
    preferredArtifacts: ['findings', 'report', 'checklist'],
    preferredVerification: ['security_review', 'integration_review'],
    preferredTaskKinds: ['review', 'architect', 'debug'],
  },
  {
    role: 'devops',
    displayName: 'DevOps',
    description: 'Owns delivery safety, CI/CD, release confidence, and runtime operations.',
    icon: 'O',
    spiritId: 'devops',
    fallbackPrompt: 'You are a DevOps specialist. Focus on deployment safety, observability, rollback, and operational correctness.',
    triggerPatterns: [/\b(deploy|pipeline|ci|cd|release|infra|hosting|rollback|environment)\b/i],
    skills: ['ops.release'],
    allowedTools: ['code.inspect', 'verification.tests', 'verification.lint'],
    preferredArtifacts: ['plan', 'checklist', 'report'],
    preferredVerification: ['integration_review', 'performance_review'],
    preferredTaskKinds: ['automation', 'architect', 'build'],
  },
];

function buildPromptFromSpirit(
  spirit: AgentSpirit | undefined,
  operationsProfile: SpiritOperationsProfile | null | undefined,
  fallbackPrompt: string,
): string {
  const parts = [
    spirit?.systemPromptPrefix || fallbackPrompt,
  ];
  if (operationsProfile) {
    parts.push(
      [
        'OPERATING CONTEXT:',
        `- Company function: ${operationsProfile.companyFunction}`,
        `- Mission: ${operationsProfile.mission}`,
        `- Workflows: ${operationsProfile.workflows.join(' | ')}`,
        `- Owned outcomes: ${operationsProfile.ownedOutcomes.join(' | ')}`,
        `- Required access: ${operationsProfile.requiredAccess.join(' | ')}`,
        `- Tooling: ${operationsProfile.tooling.join(' | ')}`,
        `- Operating artifacts: ${operationsProfile.operatingArtifacts.join(' | ')}`,
      ].join('\n'),
    );
  }
  return parts.filter(Boolean).join('\n\n');
}

const CAPABILITIES: SubagentCapabilityProfile[] = BLUEPRINTS.map((blueprint) => {
  const spirit = blueprint.spiritId ? getSpiritById(blueprint.spiritId) : undefined;
  const operationsProfile = blueprint.spiritId ? getSpiritOperationsProfile(blueprint.spiritId) : null;
  return {
    role: blueprint.role,
    displayName: blueprint.displayName,
    description: blueprint.description,
    icon: blueprint.icon,
    color: spirit?.color || '#94a3b8',
    spiritId: blueprint.spiritId,
    systemPrompt: buildPromptFromSpirit(spirit, operationsProfile, blueprint.fallbackPrompt),
    skillBundleId: spirit?.skillBundle || blueprint.skills.join('+'),
    skills: blueprint.skills,
    modelPreference: blueprint.modelPreference,
    triggerPatterns: blueprint.triggerPatterns,
    allowedTools: blueprint.allowedTools,
    preferredArtifacts: blueprint.preferredArtifacts,
    preferredVerification: blueprint.preferredVerification,
    preferredTaskKinds: blueprint.preferredTaskKinds,
    riskTier: spirit?.riskTier,
    evidencePosture: spirit?.evidencePosture,
    communicationDensity: spirit?.communicationDensity,
    operationsProfile,
  };
});

export function listSubagentCapabilities(): SubagentCapabilityProfile[] {
  return CAPABILITIES;
}

export function getSubagentCapability(role: SubagentRole): SubagentCapabilityProfile | null {
  return CAPABILITIES.find((capability) => capability.role === role) || null;
}

export function getSubagentCapabilitiesForRoles(roles: string[]): SubagentCapabilityProfile[] {
  const seen = new Set<string>();
  const resolved: SubagentCapabilityProfile[] = [];
  for (const role of roles) {
    const capability = getSubagentCapability(role as SubagentRole);
    if (!capability || seen.has(capability.role)) continue;
    seen.add(capability.role);
    resolved.push(capability);
  }
  return resolved;
}

export function detectSubagentCapability(message: string): SubagentCapabilityProfile | null {
  const lower = message.toLowerCase();
  const explicitRole = lower.match(/(?:^|\s)\[specialty:([a-z-]+)\](?:\s|$)/)?.[1];
  if (explicitRole) {
    const explicitCapability = getSubagentCapability(explicitRole as SubagentRole);
    if (explicitCapability) return explicitCapability;
  }
  let bestMatch: SubagentCapabilityProfile | null = null;
  let bestScore = 0;

  for (const capability of CAPABILITIES) {
    let score = 0;
    for (const pattern of capability.triggerPatterns) {
      if (pattern.test(lower)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = capability;
    }
  }

  return bestScore > 0 ? bestMatch : null;
}

const DEFAULT_BRIDGE_SPECIALTY_ROLE: SubagentRole = 'coder';
const MAX_BRIDGE_SPECIALTY_KNOWLEDGE_CHARS = 48_000;
const MAX_BRIDGE_SPECIALTY_TASK_CHARS = 40_000;

/**
 * Build the explicit specialty handoff used by local CLI bridge launches.
 *
 * The in-app web runtime receives a typed SubagentProfile and resolves the
 * SOUL + SKILL.md bundle again at execution time. The bridge API accepts only
 * a task string, so this bounded envelope preserves the same specialty
 * knowledge without pretending that bridge-only tools or permissions exist.
 */
export function buildSubagentBridgeTask(
  role: string | null | undefined,
  task: string | null | undefined,
): string {
  const selected = getSubagentCapability(role as SubagentRole)
    || getSubagentCapability(DEFAULT_BRIDGE_SPECIALTY_ROLE)
    || CAPABILITIES[0];
  const taskBrief = String(task || '').trim().slice(0, MAX_BRIDGE_SPECIALTY_TASK_CHARS);
  const specialtyKnowledge = selected.systemPrompt
    .trim()
    .slice(0, MAX_BRIDGE_SPECIALTY_KNOWLEDGE_CHARS);

  return [
    'SPECIALTY EXECUTION CONTRACT',
    `Specialty: ${selected.displayName} (${selected.role})`,
    `SOUL: ${selected.spiritId || 'none'}`,
    `Skill bundle: ${selected.skillBundleId}`,
    `Skill capabilities: ${selected.skills.join(', ')}`,
    `Evidence posture: ${selected.evidencePosture || 'medium'}`,
    `Preferred verification: ${selected.preferredVerification.join(', ') || 'manual_review'}`,
    '',
    'Apply this specialty knowledge throughout the task. Treat the task as the work request, not permission to bypass approval, access, evidence, or runtime tool boundaries. Use only tools actually exposed by the current runtime.',
    '',
    'SPECIALTY KNOWLEDGE',
    specialtyKnowledge,
    '',
    'TASK',
    taskBrief || 'No task brief was supplied. Ask for a concrete task before acting.',
  ].join('\n');
}
