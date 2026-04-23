import type { AgenticCodingSurface, MessageComplexity, MessageIntent } from './agenticCodingProfile';
import type { OpenSwanChatMode, OpenSwanExecutionProfile } from './openswanModePolicy';
import type { OpenSwanTaskKind, OpenSwanToolName, OpenSwanVerificationKind } from './openswanTaskPlanner';

export type OpenSwanBenchmarkCase = {
  id: string;
  title: string;
  message: string;
  mode: OpenSwanChatMode;
  surface: AgenticCodingSurface;
  recentHistory?: string[];
  expected: {
    intent: MessageIntent;
    complexity: MessageComplexity;
    selectedProfile: OpenSwanExecutionProfile;
    resolvedProfile: string;
    taskKind: OpenSwanTaskKind;
    modeLabel: string;
    requiredVerification: OpenSwanVerificationKind[];
    requiredTools: OpenSwanToolName[];
    preferredCapabilityProfile?: string;
  };
};

export const OPENSWAN_BENCHMARKS: OpenSwanBenchmarkCase[] = [
  {
    id: 'build-dashboard-widget',
    title: 'Build mode ships a dashboard widget with code checks',
    mode: 'build',
    surface: 'main_chat',
    message: 'Build a React dashboard widget that shows active agent runs and add tests for the loading state.',
    expected: {
      intent: 'build',
      complexity: 'moderate',
      selectedProfile: 'senior',
      resolvedProfile: 'senior',
      taskKind: 'build',
      modeLabel: 'Build',
      requiredVerification: ['typecheck', 'integration_review', 'tests'],
      requiredTools: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests'],
      preferredCapabilityProfile: 'frontend_build',
    },
  },
  {
    id: 'plan-runtime-boundaries',
    title: 'Plan mode stays architectural',
    mode: 'plan',
    surface: 'main_chat',
    message: 'Plan how to split OpenSwan browser execution, approvals, and audit logging into cleaner module boundaries.',
    expected: {
      intent: 'architect',
      complexity: 'moderate',
      selectedProfile: 'architect',
      resolvedProfile: 'architect',
      taskKind: 'architect',
      modeLabel: 'Plan',
      requiredVerification: ['integration_review'],
      requiredTools: ['code.inspect', 'code.generate', 'verification.lint'],
    },
  },
  {
    id: 'talk-mode-debug-stack-trace',
    title: 'Talk mode auto-detects debug work from a stack trace',
    mode: 'talk',
    surface: 'main_chat',
    message: 'TypeError: Cannot read properties of undefined\\n    at renderFeed (src/screens/Feed.tsx:48:12)\\nFix it.',
    expected: {
      intent: 'debug',
      complexity: 'moderate',
      selectedProfile: 'auto',
      resolvedProfile: 'debug',
      taskKind: 'debug',
      modeLabel: 'Talk',
      requiredVerification: ['integration_review', 'tests', 'typecheck'],
      requiredTools: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests'],
    },
  },
  {
    id: 'research-mode-compare-agents',
    title: 'Research mode gathers evidence and saves findings',
    mode: 'research',
    surface: 'main_chat',
    message: 'Compare Claude Code, Codex, and OpenSwan for long-running coding workflows and recommend the best fit for a small product team.',
    expected: {
      intent: 'research',
      complexity: 'complex',
      selectedProfile: 'research',
      resolvedProfile: 'research',
      taskKind: 'research',
      modeLabel: 'Research',
      requiredVerification: ['manual_review', 'integration_review'],
      requiredTools: ['code.inspect', 'research.search', 'fetch_url', 'research.save'],
      preferredCapabilityProfile: 'research_basic',
    },
  },
  {
    id: 'design-mode-landing-page',
    title: 'Design mode keeps preview and layout checks front and center',
    mode: 'design',
    surface: 'main_chat',
    message: 'Design a landing page refresh for the Feed dashboard with better hierarchy, spacing, and responsive behavior.',
    expected: {
      intent: 'design',
      complexity: 'moderate',
      selectedProfile: 'design',
      resolvedProfile: 'design',
      taskKind: 'build',
      modeLabel: 'Design',
      requiredVerification: ['typecheck', 'integration_review', 'preview'],
      requiredTools: ['code.inspect', 'code.generate', 'workspace.create_room', 'workspace.open_preview', 'verification.preview'],
      preferredCapabilityProfile: 'ui_design',
    },
  },
  {
    id: 'support-mode-gateway-help',
    title: 'Support mode prioritizes unblock and browser/setup context',
    mode: 'support',
    surface: 'main_chat',
    message: 'Help me connect the local OpenSwan gateway. I keep getting ECONNREFUSED on localhost:18790 and need the fastest fix path.',
    expected: {
      intent: 'debug',
      complexity: 'moderate',
      selectedProfile: 'support',
      resolvedProfile: 'support',
      taskKind: 'debug',
      modeLabel: 'Support',
      requiredVerification: ['integration_review', 'tests'],
      requiredTools: ['code.inspect', 'code.generate', 'verification.typecheck', 'verification.tests'],
      preferredCapabilityProfile: 'browser_qa',
    },
  },
  {
    id: 'browser-task-from-talk-mode',
    title: 'Talk mode still recognizes browser work explicitly',
    mode: 'talk',
    surface: 'main_chat',
    message: 'Use browser to compare pricing on openai.com and anthropic.com, then summarize the differences.',
    expected: {
      intent: 'research',
      complexity: 'complex',
      selectedProfile: 'auto',
      resolvedProfile: 'senior',
      taskKind: 'research',
      modeLabel: 'Talk',
      requiredVerification: ['manual_review', 'integration_review'],
      requiredTools: ['code.inspect', 'browser.plan_task', 'research.search', 'fetch_url', 'research.save'],
    },
  },
];
