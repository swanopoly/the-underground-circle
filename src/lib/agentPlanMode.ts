import { detectAgenticCodingProfile } from './agenticCodingProfile';
import {
  buildChatAutomationPlan,
  type ChatAutomationPlan,
  type ChatAutomationRisk,
} from './chatAutomationPlanner';
import { buildOpenSwanTaskPlan, type OpenSwanTaskPlan } from './openswanTaskPlanner';

export type AgentPlanMode = 'plan' | 'ask' | 'agent' | 'manual';
export type AgentPlanStatus = 'draft' | 'ready' | 'approved' | 'building' | 'completed' | 'archived' | 'blocked';
export type AgentPlanRisk = ChatAutomationRisk;
export type AgentPlanStepKind =
  | 'clarify'
  | 'research'
  | 'context'
  | 'design'
  | 'implement'
  | 'browser'
  | 'desktop'
  | 'terminal'
  | 'mcp'
  | 'review'
  | 'verify'
  | 'checkpoint'
  | 'approval';

export type AgentPlanStepDraft = {
  id?: string;
  order: number;
  kind: AgentPlanStepKind;
  status: 'pending' | 'ready' | 'running' | 'completed' | 'blocked' | 'skipped';
  title: string;
  detail: string;
  toolNames: string[];
  targetRefs: string[];
  requiresApproval: boolean;
  checkpointPolicy: 'none' | 'before_write' | 'before_external_side_effect' | 'before_destructive';
  estimatedEffort?: string;
  acceptance: string[];
  metadata?: Record<string, unknown>;
};

export type AgentPlanQuestionDraft = {
  id?: string;
  order: number;
  question: string;
  why: string;
  status: 'open' | 'answered' | 'skipped';
  answer?: string | null;
};

export type AgentPlanArtifactDraft = {
  id?: string;
  kind: 'summary' | 'decision' | 'research' | 'diff' | 'checkpoint' | 'receipt' | 'note';
  title: string;
  content?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
};

export type AgentPlanDraft = {
  id?: string;
  circleId?: string | null;
  threadId?: string | null;
  sourceMessageId?: string | null;
  createdBy?: string | null;
  title: string;
  task: string;
  mode: AgentPlanMode;
  status: AgentPlanStatus;
  risk: AgentPlanRisk;
  summary: string;
  confidence: number;
  selectedModel?: string | null;
  buildReady: boolean;
  steps: AgentPlanStepDraft[];
  questions: AgentPlanQuestionDraft[];
  artifacts: AgentPlanArtifactDraft[];
  flow: {
    chat: {
      source: ChatAutomationPlan['source'];
      executionKind: ChatAutomationPlan['execution']['kind'];
      routeId: string | null;
      confidence: number;
    };
    swanbot: {
      role: 'planner' | 'answerer' | 'executor';
      mode: string;
      model: string | null;
    };
    openswan: {
      taskKind: OpenSwanTaskPlan['kind'];
      profile: OpenSwanTaskPlan['profile'];
      recommendedTools: string[];
      verificationKinds: string[];
    };
    office: {
      handoffReady: boolean;
      agentSessionCompatible: boolean;
      ledgerPreviewId?: string | null;
    };
  };
  metadata: {
    chatPlan: ChatAutomationPlan;
    openSwanTaskPlan: OpenSwanTaskPlan;
    recommendedTools: string[];
    architecture: 'chat_swanbot_openswan_office';
    nextAction: 'answer_questions' | 'review_plan' | 'approve_to_build';
  };
};

export type AgentPlanPersisted = AgentPlanDraft & {
  id: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export function shouldCreateAgentPlanForMessage(message: string, mode?: string | null): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (/^\/plan(\s|$)/i.test(trimmed)) return true;
  return mode === 'plan';
}

function compactTitle(task: string): string {
  const singleLine = task.replace(/\s+/g, ' ').trim();
  const withoutSlash = singleLine.replace(/^\/plan\s*/i, '').trim();
  const sentence = withoutSlash.split(/[.!?]\s/)[0]?.trim() || withoutSlash || 'Agent plan';
  if (sentence.length <= 88) return sentence;
  return `${sentence.slice(0, 85).trimEnd()}...`;
}

function normalizeTask(message: string): string {
  return message.replace(/^\/plan\s*/i, '').trim() || message.trim();
}

function uniqueTools(...groups: Array<Array<string | null | undefined>>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group) {
      const value = String(raw || '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
  }
  return out.slice(0, 20);
}

function isBroadOrAmbiguous(task: string): boolean {
  const lower = task.toLowerCase();
  if (lower.length < 16) return true;
  if (/\b(everything|all of it|make it better|fix it|do it all|best possible|reinvent)\b/i.test(lower)) return true;
  if (/^(build|fix|improve|optimize|review|implement)\s+(it|this|that)$/i.test(lower)) return true;
  return false;
}

function inferStepKind(tool: string): AgentPlanStepKind {
  if (tool.startsWith('browser.')) return 'browser';
  if (tool.startsWith('desktop.')) return 'desktop';
  if (tool.startsWith('verification.')) return 'verify';
  if (tool.startsWith('github.') || tool.startsWith('rooms.') || tool.startsWith('tasks.') || tool.startsWith('vault.')) return 'mcp';
  if (tool.startsWith('code.')) return tool === 'code.review' ? 'review' : 'implement';
  if (tool.startsWith('research.') || tool === 'fetch_url' || tool === 'search_memories') return 'research';
  if (tool.startsWith('office.') || tool === 'messages.create') return 'terminal';
  return 'context';
}

function riskCheckpointPolicy(risk: AgentPlanRisk): AgentPlanStepDraft['checkpointPolicy'] {
  if (risk === 'destructive') return 'before_destructive';
  if (risk === 'external_side_effect') return 'before_external_side_effect';
  if (risk === 'review') return 'before_write';
  return 'before_write';
}

function buildPlanSummary(task: string, chatPlan: ChatAutomationPlan, openSwanPlan: OpenSwanTaskPlan): string {
  const surface = openSwanPlan.surfacePlan?.primarySurface || chatPlan.execution.routeId || chatPlan.execution.kind;
  const pipeline = openSwanPlan.pipeline?.title || chatPlan.pipeline?.title || 'general task';
  return `Plan ${pipeline} through ${surface}. SwanBot classifies the request, OpenSwan selects tools and verification, then Office can track or delegate the approved work.`;
}

function buildPlanQuestions(task: string, risk: AgentPlanRisk): AgentPlanQuestionDraft[] {
  const questions: AgentPlanQuestionDraft[] = [];
  if (isBroadOrAmbiguous(task)) {
    questions.push({
      order: questions.length + 1,
      question: 'What is the first success condition you want this plan to optimize for?',
      why: 'The request is broad enough that execution could drift without a primary target.',
      status: 'open',
    });
  }
  if (risk === 'external_side_effect' || risk === 'destructive') {
    questions.push({
      order: questions.length + 1,
      question: 'Should OpenSwan stop for approval before any external write, publish, send, purchase, or delete action?',
      why: 'The task may affect systems outside the app, so approval boundaries need to be explicit.',
      status: 'open',
    });
  }
  return questions;
}

function buildPlanSteps(args: {
  task: string;
  chatPlan: ChatAutomationPlan;
  openSwanPlan: OpenSwanTaskPlan;
  risk: AgentPlanRisk;
  hasOpenQuestions: boolean;
}): AgentPlanStepDraft[] {
  const { task, chatPlan, openSwanPlan, risk, hasOpenQuestions } = args;
  const tools = uniqueTools(
    openSwanPlan.recommendedTools.map((item) => item.tool),
  );
  const contextTools = tools.filter((tool) => (
    tool === 'search_memories'
    || tool === 'research.search'
    || tool === 'fetch_url'
    || tool.startsWith('github.')
    || tool.startsWith('rooms.')
    || tool === 'integrations.list'
    || tool === 'office.list_agents'
  ));
  const actionTools = tools.filter((tool) => !contextTools.includes(tool) && !tool.startsWith('verification.'));
  const verificationTools = uniqueTools(
    openSwanPlan.verification.map((check) => `verification.${check.kind}`),
    tools.filter((tool) => tool.startsWith('verification.')),
  );
  const steps: AgentPlanStepDraft[] = [];

  if (hasOpenQuestions) {
    steps.push({
      order: steps.length + 1,
      kind: 'clarify',
      status: 'pending',
      title: 'Lock scope and success criteria',
      detail: 'Resolve the open questions before allowing broad execution.',
      toolNames: [],
      targetRefs: [],
      requiresApproval: false,
      checkpointPolicy: 'none',
      estimatedEffort: '1 turn',
      acceptance: ['Questions have answers or are explicitly skipped.'],
    });
  }

  steps.push({
    order: steps.length + 1,
    kind: 'context',
    status: 'pending',
    title: 'Gather chat, memory, workspace, and integration context',
    detail: `Use the existing Chat/SwanBot routing plus OpenSwan context bundle before deciding how to act on: "${task}".`,
    toolNames: contextTools.slice(0, 8),
    targetRefs: [chatPlan.execution.routeId || chatPlan.execution.kind].filter(Boolean) as string[],
    requiresApproval: false,
    checkpointPolicy: 'none',
    estimatedEffort: '1-2 turns',
    acceptance: [
      'Relevant memories, wiki/research context, integrations, files, or live agent state are loaded when applicable.',
      'The selected execution surface is explained before any mutation.',
    ],
  });

  if (actionTools.length > 0) {
    const primaryKind = inferStepKind(actionTools[0]);
    steps.push({
      order: steps.length + 1,
      kind: primaryKind,
      status: 'pending',
      title: primaryKind === 'browser'
        ? 'Prepare browser execution'
        : primaryKind === 'desktop'
          ? 'Prepare desktop execution'
          : primaryKind === 'terminal'
            ? 'Prepare agent or terminal handoff'
            : primaryKind === 'implement'
              ? 'Prepare workspace changes'
              : 'Prepare tool execution',
      detail: 'Create the concrete runbook from the OpenSwan recommended tools, grounding plan, approvals, and expected receipts.',
      toolNames: actionTools.slice(0, 10),
      targetRefs: [
        openSwanPlan.computerAppStrategy?.id,
        openSwanPlan.computerAppGrounding?.primarySurface,
        openSwanPlan.pipeline?.id,
      ].filter(Boolean) as string[],
      requiresApproval: risk !== 'safe' || actionTools.some((tool) => tool === 'approvals.request' || tool.startsWith('vault.')),
      checkpointPolicy: riskCheckpointPolicy(risk),
      estimatedEffort: '2-5 turns',
      acceptance: [
        'OpenSwan has an observable state before acting.',
        'Credential, file, browser, or desktop grants are explicit and session scoped.',
        'No external side effect runs without the required approval.',
      ],
      metadata: {
        computerAppStrategy: openSwanPlan.computerAppStrategy || null,
        groundingRunbook: openSwanPlan.computerAppGroundingRunbook || null,
      },
    });
  }

  if (risk !== 'safe' || chatPlan.approval.required) {
    steps.push({
      order: steps.length + 1,
      kind: 'approval',
      status: 'pending',
      title: 'Request approval for risky steps',
      detail: chatPlan.approval.required
        ? chatPlan.approval.reason || 'The plan requires approval before acting.'
        : 'The plan includes review-level risk, so OpenSwan should ask before mutation.',
      toolNames: uniqueTools(['approvals.request'], tools.filter((tool) => tool.startsWith('vault.'))),
      targetRefs: [],
      requiresApproval: true,
      checkpointPolicy: riskCheckpointPolicy(risk),
      estimatedEffort: '1 turn',
      acceptance: ['Approval is recorded before any external write, credential use, publish, send, purchase, or delete action.'],
    });
  }

  steps.push({
    order: steps.length + 1,
    kind: 'checkpoint',
    status: 'pending',
    title: 'Create checkpoint and rollback boundary',
    detail: 'Attach the plan id to future run ledgers, chat checkpoints, and execution receipts so the user can audit what changed.',
    toolNames: [],
    targetRefs: [openSwanPlan.ledgerPreview?.runId || chatPlan.ledgerPreview?.runId || 'agent_run_ledger'].filter(Boolean),
    requiresApproval: false,
    checkpointPolicy: riskCheckpointPolicy(risk),
    estimatedEffort: 'automatic',
    acceptance: ['A run ledger/checkpoint can be associated with this plan before execution mutates state.'],
  });

  steps.push({
    order: steps.length + 1,
    kind: 'verify',
    status: 'pending',
    title: 'Verify result and capture evidence',
    detail: 'Run the required OpenSwan verification checks and attach receipts/screenshots/logs when available.',
    toolNames: verificationTools.slice(0, 8),
    targetRefs: openSwanPlan.verification.map((check) => check.id),
    requiresApproval: false,
    checkpointPolicy: 'none',
    estimatedEffort: '1-3 turns',
    acceptance: [
      'Required verification checks pass or report a clear blocker.',
      'The final chat response includes evidence and next steps.',
    ],
  });

  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}

export function buildAgentPlanDraft(input: {
  task: string;
  selectedMode?: string | null;
  selectedModel?: string | null;
  threadId?: string | null;
  sourceMessageId?: string | null;
  circleId?: string | null;
  createdBy?: string | null;
}): AgentPlanDraft {
  const task = normalizeTask(input.task);
  const profile = detectAgenticCodingProfile(task, 'main_chat');
  const chatPlan = buildChatAutomationPlan({
    message: task,
    selectedMode: input.selectedMode || 'plan',
  });
  const openSwanTaskPlan = buildOpenSwanTaskPlan(task, profile);
  const risk = chatPlan.risk;
  const questions = buildPlanQuestions(task, risk);
  const steps = buildPlanSteps({
    task,
    chatPlan,
    openSwanPlan: openSwanTaskPlan,
    risk,
    hasOpenQuestions: questions.some((question) => question.status === 'open'),
  });
  const recommendedTools = uniqueTools(
    openSwanTaskPlan.recommendedTools.map((item) => item.tool),
  );
  const buildReady = questions.length === 0 && risk === 'safe';
  const mode: AgentPlanMode = input.selectedMode === 'ask' || input.selectedMode === 'agent' || input.selectedMode === 'manual'
    ? input.selectedMode
    : 'plan';

  return {
    circleId: input.circleId || null,
    threadId: input.threadId || null,
    sourceMessageId: input.sourceMessageId || null,
    createdBy: input.createdBy || null,
    title: compactTitle(task),
    task,
    mode,
    status: buildReady ? 'ready' : 'draft',
    risk,
    summary: buildPlanSummary(task, chatPlan, openSwanTaskPlan),
    confidence: Math.max(chatPlan.confidence, 0.65),
    selectedModel: input.selectedModel || null,
    buildReady,
    steps,
    questions,
    artifacts: [{
      kind: 'summary',
      title: 'Initial routing summary',
      content: buildPlanSummary(task, chatPlan, openSwanTaskPlan),
      metadata: {
        source: chatPlan.source,
        executionKind: chatPlan.execution.kind,
        taskKind: openSwanTaskPlan.kind,
      },
    }],
    flow: {
      chat: {
        source: chatPlan.source,
        executionKind: chatPlan.execution.kind,
        routeId: chatPlan.execution.routeId || null,
        confidence: chatPlan.confidence,
      },
      swanbot: {
        role: 'planner',
        mode,
        model: input.selectedModel || null,
      },
      openswan: {
        taskKind: openSwanTaskPlan.kind,
        profile: openSwanTaskPlan.profile,
        recommendedTools,
        verificationKinds: openSwanTaskPlan.verification.map((check) => check.kind),
      },
      office: {
        handoffReady: buildReady || risk === 'review',
        agentSessionCompatible: true,
        ledgerPreviewId: openSwanTaskPlan.ledgerPreview?.runId || chatPlan.ledgerPreview?.runId || null,
      },
    },
    metadata: {
      chatPlan,
      openSwanTaskPlan,
      recommendedTools,
      architecture: 'chat_swanbot_openswan_office',
      nextAction: questions.length > 0 ? 'answer_questions' : buildReady ? 'approve_to_build' : 'review_plan',
    },
  };
}

export function formatAgentPlanForChat(plan: AgentPlanDraft, opts?: {
  persisted?: boolean;
  persistenceWarning?: string | null;
}): string {
  const persistedLabel = opts?.persisted
    ? `Saved${plan.id ? ` as \`${plan.id}\`` : ''}`
    : `Draft only${opts?.persistenceWarning ? ` - ${opts.persistenceWarning}` : ''}`;
  const questionLines = plan.questions.length > 0
    ? [
        '**Open Questions**',
        ...plan.questions.map((question) => `${question.order}. ${question.question}`),
      ]
    : ['**Open Questions**', 'None.'];
  const stepLines = plan.steps.map((step) => {
    const approval = step.requiresApproval ? ' approval required' : ' no approval';
    const tools = step.toolNames.length > 0 ? ` Tools: ${step.toolNames.slice(0, 5).join(', ')}.` : '';
    return `${step.order}. **${step.title}** (${step.kind},${approval}). ${step.detail}${tools}`;
  });
  const tools = plan.metadata.recommendedTools.slice(0, 10).join(', ') || 'none';
  const nextAction = plan.metadata.nextAction === 'answer_questions'
    ? 'Answer or skip the open questions, then switch to Act/Build when ready.'
    : plan.metadata.nextAction === 'approve_to_build'
      ? 'Review the plan, then approve it to build from this exact plan.'
      : 'Review approval and checkpoint boundaries before execution.';

  return [
    `**Agent Plan: ${plan.title}**`,
    `${persistedLabel}. Status: **${plan.status}**. Risk: **${plan.risk}**. Build ready: **${plan.buildReady ? 'yes' : 'not yet'}**.`,
    '',
    plan.summary,
    '',
    `**Architecture Flow**`,
    `Chat classified this as \`${plan.flow.chat.executionKind}\`; SwanBot is acting as planner; OpenSwan selected \`${plan.flow.openswan.taskKind}\` / \`${plan.flow.openswan.profile}\`; Office handoff is ${plan.flow.office.handoffReady ? 'ready' : 'waiting'}.`,
    '',
    ...questionLines,
    '',
    '**Steps**',
    ...stepLines,
    '',
    `**Recommended Tools**`,
    tools,
    '',
    `**Next**`,
    nextAction,
  ].join('\n');
}

export function buildAgentPlanMetadataSummary(plan: AgentPlanDraft): Record<string, unknown> {
  return {
    id: plan.id || null,
    title: plan.title,
    task: plan.task,
    mode: plan.mode,
    status: plan.status,
    risk: plan.risk,
    buildReady: plan.buildReady,
    stepCount: plan.steps.length,
    questionCount: plan.questions.length,
    flow: plan.flow,
    recommendedTools: plan.metadata.recommendedTools.slice(0, 12),
  };
}
