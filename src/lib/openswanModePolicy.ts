import {
  detectAgenticCodingProfile,
  type AgenticCodingProfile,
  type AgenticCodingSurface,
} from './agenticCodingProfile';
import type { TaskCapabilityProfileKey } from './taskCapabilityProfiles';

export type OpenSwanChatMode =
  | 'none'
  | 'talk'
  | 'build'
  | 'plan'
  | 'execute'
  | 'review'
  | 'research'
  | 'support'
  | 'design';

export type OpenSwanModePolicy = {
  key: OpenSwanChatMode;
  label: string;
  icon: string;
  color: string;
  description: string;
  outcome: string;
  preferredCapabilityProfile?: TaskCapabilityProfileKey;
  responseContract?: {
    directive: string;
    structure: string[];
    qualityBar: string[];
    avoid: string[];
  };
};

export type OpenSwanExecutionProfile = AgenticCodingProfile | 'auto';

export type OpenSwanProfileResolution = {
  selectedProfile: OpenSwanExecutionProfile;
  resolvedProfile: AgenticCodingProfile;
  autoDetected: boolean;
};

export const OPENSWAN_MODE_POLICIES: Record<OpenSwanChatMode, OpenSwanModePolicy> = {
  none: {
    key: 'none',
    label: 'Chat',
    icon: 'C',
    color: '#606075',
    description: 'Normal chat with the selected model and saved context.',
    outcome: 'Fast answer path. No OpenSwan runtime.',
  },
  talk: {
    key: 'talk',
    label: 'Talk',
    icon: '..',
    color: '#a855f7',
    description: 'General conversation with OpenSwan active.',
    outcome: 'Discussion, framing, and lightweight guidance.',
    responseContract: {
      directive: 'Respond like a strong senior teammate: concise, grounded, and calm.',
      structure: ['Direct answer', 'Useful clarification when needed', 'Concrete next step only if it helps'],
      qualityBar: ['Do not over-structure casual turns', 'Do not over-explain obvious points', 'Keep confidence proportional to evidence'],
      avoid: ['fluff', 'self-conscious AI phrasing', 'forced enthusiasm'],
    },
  },
  build: {
    key: 'build',
    label: 'Build',
    icon: 'B',
    color: '#14b8a6',
    description: 'Implementation mode for features, fixes, and concrete output.',
    outcome: 'Code, files, patches, and shipped work.',
    preferredCapabilityProfile: 'frontend_build',
    responseContract: {
      directive: 'Act like a professional implementation lead. Be specific, execution-first, and technically accountable.',
      structure: ['What will be built or changed', 'Implementation details', 'Verification or remaining risk'],
      qualityBar: ['Prefer exact files, commands, interfaces, and constraints', 'State assumptions explicitly', 'Keep the answer production-oriented, not inspirational'],
      avoid: ['vague promises', 'generic best-practice lists without application', 'shipping language without evidence'],
    },
  },
  plan: {
    key: 'plan',
    label: 'Plan',
    icon: 'P',
    color: '#6366f1',
    description: 'Planning mode for architecture, sequencing, and tradeoffs.',
    outcome: 'Phased plan, dependencies, and execution order.',
    responseContract: {
      directive: 'Produce an operator-grade plan with sequencing, dependencies, and decision points.',
      structure: ['Goal and scope', 'Phased plan', 'Dependencies, risks, and recommended order'],
      qualityBar: ['Make phases actionable', 'Call out blockers and prerequisites', 'Prefer a single recommended path over equal-weight options'],
      avoid: ['brainstorm sprawl', 'unbounded option dumps', 'pretending uncertain estimates are precise'],
    },
  },
  execute: {
    key: 'execute',
    label: 'Execute',
    icon: '!',
    color: '#f59e0b',
    description: 'Do the work now with concrete actions and next steps.',
    outcome: 'Actionable commands, exact edits, or completed work.',
    preferredCapabilityProfile: 'frontend_build',
    responseContract: {
      directive: 'Optimize for immediate execution. Every paragraph should help the next action happen.',
      structure: ['Immediate action', 'Exact steps or commands', 'Expected result or checkpoint'],
      qualityBar: ['Prefer shortest correct path', 'Surface irreversible steps clearly', 'Be explicit about approvals or missing access'],
      avoid: ['abstract advice', 'long preambles', 'burying the action behind explanation'],
    },
  },
  review: {
    key: 'review',
    label: 'Review',
    icon: '?',
    color: '#22d3ee',
    description: 'Audit code, changes, or plans with a critical eye.',
    outcome: 'Findings, regressions, risks, and missing tests.',
    preferredCapabilityProfile: 'browser_qa',
    responseContract: {
      directive: 'Write like a disciplined reviewer. Findings first, evidence-based, severity-aware.',
      structure: ['Highest-severity findings', 'Open questions or assumptions', 'Short summary only after findings'],
      qualityBar: ['Anchor critiques in behavior or risk', 'Prefer exact fixes over vague concern', 'Separate facts from inference'],
      avoid: ['burying findings under summary', 'style nitpicks ahead of real risk', 'unclear severity'],
    },
  },
  research: {
    key: 'research',
    label: 'Research',
    icon: 'R',
    color: '#a855f7',
    description: 'Investigate deeply and compare options before deciding.',
    outcome: 'Findings, tradeoffs, evidence, and recommendation.',
    preferredCapabilityProfile: 'research_basic',
    responseContract: {
      directive: 'Write like a professional research memo: evidence-first, comparative, and decision-oriented.',
      structure: ['Findings', 'Comparisons and tradeoffs', 'Recommendation with confidence level'],
      qualityBar: ['Distinguish facts from inference', 'Name the strongest option and why', 'Call out uncertainty and missing evidence'],
      avoid: ['option soup', 'weak conclusions', 'marketing language'],
    },
  },
  support: {
    key: 'support',
    label: 'Support',
    icon: 'S',
    color: '#3b82f6',
    description: 'Troubleshoot, guide setup, or recover from failure quickly.',
    outcome: 'Fastest unblock path, prerequisites, and recovery steps.',
    preferredCapabilityProfile: 'browser_qa',
    responseContract: {
      directive: 'Be the fastest competent unblock path. Diagnose, recover, and minimize thrash.',
      structure: ['Likely cause or blocker', 'Fastest unblock path', 'Fallback if the first path fails'],
      qualityBar: ['Prioritize recovery over theory', 'State missing prerequisites clearly', 'Keep steps safe and reversible when possible'],
      avoid: ['deep background before action', 'uncertain blame', 'hiding blockers'],
    },
  },
  design: {
    key: 'design',
    label: 'Design',
    icon: 'D',
    color: '#ec4899',
    description: 'UI/UX direction, polish, and handoff-oriented design work.',
    outcome: 'Design direction, interaction guidance, and previewable output.',
    preferredCapabilityProfile: 'ui_design',
    responseContract: {
      directive: 'Respond like a design lead handing off real direction, not moodboard commentary.',
      structure: ['Design direction', 'Layout and interaction decisions', 'Handoff notes or preview guidance'],
      qualityBar: ['Be concrete about hierarchy, spacing, states, and accessibility', 'Tie design choices to the product goal', 'Keep aesthetic language precise, not vague'],
      avoid: ['generic dribbble adjectives', 'unscoped redesign talk', 'style without rationale'],
    },
  },
};

export function getOpenSwanModePolicy(mode: OpenSwanChatMode | string | null | undefined): OpenSwanModePolicy {
  return OPENSWAN_MODE_POLICIES[(mode || 'none') as OpenSwanChatMode] || OPENSWAN_MODE_POLICIES.none;
}

/**
 * Canonical list of user-selectable chat modes. Use this anywhere the UI
 * renders a mode picker — ChatTab composer, OpenSwan Console, RoomsTab.
 * Keeps the picker in lock-step with `OPENSWAN_MODE_POLICIES` so adding
 * a mode (e.g. a future "explain" mode) automatically shows up in every
 * picker instead of requiring per-surface updates. Order matches the
 * user's usual flow: off → casual → structured → audit → research →
 * recover → design.
 */
export const SELECTABLE_CHAT_MODES: OpenSwanChatMode[] = [
  'none',
  'talk',
  'plan',
  'build',
  'execute',
  'review',
  'research',
  'support',
  'design',
];

export function getSelectableChatModes(): OpenSwanModePolicy[] {
  return SELECTABLE_CHAT_MODES.map((key) => OPENSWAN_MODE_POLICIES[key]);
}

export function getOpenSwanSelectedProfileForMode(
  mode: OpenSwanChatMode | string | null | undefined,
): OpenSwanExecutionProfile {
  switch ((mode || 'none') as OpenSwanChatMode) {
    case 'build':
    case 'execute':
      return 'senior';
    case 'plan':
      return 'architect';
    case 'review':
      return 'review';
    case 'research':
      return 'research';
    case 'support':
      return 'support';
    case 'design':
      return 'design';
    case 'talk':
    case 'none':
    default:
      return 'auto';
  }
}

export function resolveOpenSwanProfileForMode(
  mode: OpenSwanChatMode | string | null | undefined,
  message: string,
  surface: AgenticCodingSurface,
): OpenSwanProfileResolution {
  const selectedProfile = getOpenSwanSelectedProfileForMode(mode);
  const resolvedProfile =
    selectedProfile === 'auto'
      ? detectAgenticCodingProfile(message, surface)
      : selectedProfile;
  return {
    selectedProfile,
    resolvedProfile,
    autoDetected: selectedProfile === 'auto',
  };
}

export function buildOpenSwanModeResponseContract(
  mode: OpenSwanChatMode | string | null | undefined,
): string {
  const policy = getOpenSwanModePolicy(mode);
  const contract = policy.responseContract;
  if (!contract) return '';
  return [
    `[${policy.label.toUpperCase()} RESPONSE CONTRACT]`,
    contract.directive,
    '',
    'Response structure:',
    ...contract.structure.map((item) => `- ${item}`),
    '',
    'Quality bar:',
    ...contract.qualityBar.map((item) => `- ${item}`),
    '',
    'Avoid:',
    ...contract.avoid.map((item) => `- ${item}`),
  ].join('\n');
}
