import type {
  ChatAutomationExecutionKind,
  ChatAutomationPlan,
  ChatAutomationRisk,
} from './chatAutomationPlanner';

export type ChatAutomationPreviewMode = 'workflow' | 'assisted' | 'agentic';
export type ChatAutomationPreviewTone = 'neutral' | 'safe' | 'review' | 'danger';

export interface ChatAutomationPlanPreviewChip {
  label: string;
  tone: ChatAutomationPreviewTone;
}

export interface ChatAutomationEvidencePanel {
  kind: string;
  targetLabel: string;
  taskFamilyLabel: string;
  observeBefore: string[];
  actionabilityChecks: string[];
  approvalBefore: string[];
  proofAfter: string[];
  failClosedRules: string[];
  freshEvidenceRequired: string[];
  sourceRefs: Array<{ title: string; url: string }>;
}

export interface ChatAutomationPlanPreview {
  title: string;
  intentLabel: string;
  routeLabel: string;
  surfaceLabel: string;
  mode: ChatAutomationPreviewMode;
  riskLabel: string;
  riskTone: ChatAutomationPreviewTone;
  approvalLabel: string;
  approvalRequired: boolean;
  evidence: string[];
  recovery: string[];
  tools: string[];
  chips: ChatAutomationPlanPreviewChip[];
  evidencePanel?: ChatAutomationEvidencePanel;
}

const EXECUTION_LABELS: Record<ChatAutomationExecutionKind, string> = {
  local_reply: 'Local reply',
  run_plain_chat: 'Model chat',
  open_modal: 'Open app surface',
  run_command_handler: 'Command handler',
  run_openswan: 'OpenSwan agent',
  run_computer_task: 'Computer task',
  run_build_discovery: 'Build discovery',
  run_browser_plan: 'Browser plan',
  run_circle_automation: 'Run automation',
  create_circle_automation: 'Create automation',
  suggest_automation_conversion: 'Suggest automation',
  ask_clarification: 'Ask clarification',
};

function compactText(value: string | null | undefined, fallback: string, max = 90): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function uniqueStrings(values: Array<string | null | undefined>, limit: number): string[] {
  const out: string[] = [];
  for (const value of values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function describeRisk(risk: ChatAutomationRisk): { label: string; tone: ChatAutomationPreviewTone } {
  switch (risk) {
    case 'safe':
      return { label: 'Low risk', tone: 'safe' };
    case 'review':
      return { label: 'Review before side effects', tone: 'review' };
    case 'external_side_effect':
      return { label: 'External side effect', tone: 'danger' };
    case 'destructive':
      return { label: 'Destructive action', tone: 'danger' };
    default:
      return { label: 'Review required', tone: 'review' };
  }
}

function inferPreviewMode(plan: ChatAutomationPlan): ChatAutomationPreviewMode {
  const aiLevel = plan.computerRequestRoute?.aiNeed?.level;
  if (aiLevel === 'none') return 'workflow';
  if (aiLevel === 'assistive') return 'assisted';
  if (aiLevel === 'required') return 'agentic';

  switch (plan.execution.kind) {
    case 'run_plain_chat':
    case 'run_openswan':
      return 'agentic';
    case 'run_computer_task':
    case 'run_build_discovery':
    case 'run_browser_plan':
      return plan.risk === 'safe' ? 'assisted' : 'agentic';
    default:
      return 'workflow';
  }
}

function inferSurfaceLabel(plan: ChatAutomationPlan): string {
  if (plan.computerRequestRoute?.bestPath) return compactText(plan.computerRequestRoute.bestPath, 'Computer task');
  if (plan.execution.routeId) return `${plan.execution.routeId} route`;
  switch (plan.execution.kind) {
    case 'run_plain_chat':
      return 'Chat model';
    case 'run_openswan':
      return 'Connected agent';
    case 'open_modal':
      return 'Chat surface';
    default:
      return EXECUTION_LABELS[plan.execution.kind];
  }
}

function inferRouteLabel(plan: ChatAutomationPlan): string {
  switch (plan.computerRequestRoute?.kind) {
    case 'desktop_app':
      return 'Desktop app';
    case 'local_file':
      return 'Local files';
    case 'browser':
      return 'Browser';
    case 'hybrid':
      return 'Browser + desktop';
    case 'agent_buildout':
      return 'Capability buildout';
    default:
      break;
  }

  if (plan.execution.routeId) return plan.execution.routeId;
  switch (plan.execution.kind) {
    case 'run_plain_chat':
      return 'Chat';
    case 'run_openswan':
      return 'OpenSwan';
    case 'run_build_discovery':
      return 'Build';
    case 'run_browser_plan':
      return 'Browser';
    case 'ask_clarification':
      return 'Chat';
    default:
      return 'Direct';
  }
}

function inferIntentLabel(plan: ChatAutomationPlan): string {
  switch (plan.intent.kind) {
    case 'slash_command':
    case 'natural_command':
      return compactText(plan.intent.commandText, 'Command');
    case 'quick_action':
      return compactText(plan.intent.actionText, 'Quick action');
    case 'conversational_action':
      return plan.intent.intent.type.replace(/_/g, ' ');
    case 'direct_chat':
      return compactText(plan.intent.message, 'Chat request');
    default:
      return 'Chat request';
  }
}

function buildEvidenceList(plan: ChatAutomationPlan): string[] {
  const route = plan.computerRequestRoute;
  const routeProof = route?.completionProof || [];
  const contractKinds = route?.evidenceContract?.proofAfter || [];
  const defaults = [
    plan.execution.kind === 'run_plain_chat' ? 'final answer' : null,
    plan.execution.kind === 'run_openswan' ? 'agent run summary' : null,
    plan.execution.kind === 'run_build_discovery' ? 'build plan and next action' : null,
    plan.execution.kind === 'run_browser_plan' ? 'browser plan and approval status' : null,
    plan.execution.kind === 'run_command_handler' ? 'handler result' : null,
    plan.execution.kind === 'open_modal' ? 'surface opened' : null,
    plan.execution.kind === 'ask_clarification' ? 'user answer to missing fields' : null,
  ];
  return uniqueStrings([...routeProof, ...contractKinds, ...defaults], 5);
}

function buildRecoveryList(plan: ChatAutomationPlan): string[] {
  const route = plan.computerRequestRoute;
  return uniqueStrings([
    plan.recoveryExecutionPlan?.userSummary,
    route?.evidenceContract?.failClosedRules?.[0],
    route ? 'collect fresh observation before retry' : null,
    route ? 'fall back to connected-agent capability buildout when no deterministic adapter exists' : null,
    plan.approval.required ? 'wait for approval before acting' : null,
    'show exact blocker and next safe retry step',
  ], 4);
}

function buildEvidencePanel(plan: ChatAutomationPlan): ChatAutomationEvidencePanel | undefined {
  const contract = plan.computerRequestRoute?.evidenceContract;
  if (!contract) return undefined;
  return {
    kind: contract.kind,
    targetLabel: compactText(contract.targetName, 'Computer task', 80),
    taskFamilyLabel: compactText(contract.taskFamily, 'automation task', 80),
    observeBefore: uniqueStrings(contract.observeBefore, 4),
    actionabilityChecks: uniqueStrings(contract.actionabilityChecks, 4),
    approvalBefore: uniqueStrings(contract.approvalBefore, 4),
    proofAfter: uniqueStrings(contract.proofAfter, 4),
    failClosedRules: uniqueStrings(contract.failClosedRules, 4),
    freshEvidenceRequired: uniqueStrings(contract.freshEvidenceRequired, 3),
    sourceRefs: Array.isArray(contract.sourceRefs)
      ? contract.sourceRefs
        .map((ref) => ({
          title: compactText(ref.label, 'source reference', 80),
          url: compactText(ref.url, '', 180),
        }))
        .filter((ref) => ref.url)
        .slice(0, 3)
      : [],
  };
}

export function buildChatAutomationPlanPreview(plan: ChatAutomationPlan): ChatAutomationPlanPreview {
  const risk = describeRisk(plan.risk);
  const mode = inferPreviewMode(plan);
  const approvalLabel = plan.approval.required
    ? compactText(plan.approval.reason, 'Approval required before action', 120)
    : 'No approval needed before this step';
  const route = plan.computerRequestRoute;
  const tools = uniqueStrings(route?.recommendedTools || [], 6);

  const chips: ChatAutomationPlanPreviewChip[] = [
    { label: mode, tone: mode === 'workflow' ? 'safe' : mode === 'assisted' ? 'review' : 'neutral' },
    { label: plan.execution.kind, tone: 'neutral' },
    { label: plan.approval.required ? 'approval' : 'no approval', tone: plan.approval.required ? 'review' : 'safe' },
    ...(route?.aiNeed?.label ? [{ label: route.aiNeed.label, tone: 'neutral' as const }] : []),
  ];

  return {
    title: EXECUTION_LABELS[plan.execution.kind],
    intentLabel: inferIntentLabel(plan),
    // `execution.routeId` identifies slash/natural-command handlers. Native
    // app and local-file tasks intentionally keep it null so they are never
    // mislabeled as the legacy `browser` command route. Their canonical
    // execution surface lives on `computerRequestRoute.kind` instead.
    routeLabel: inferRouteLabel(plan),
    surfaceLabel: inferSurfaceLabel(plan),
    mode,
    riskLabel: risk.label,
    riskTone: risk.tone,
    approvalLabel,
    approvalRequired: plan.approval.required,
    evidence: buildEvidenceList(plan),
    recovery: buildRecoveryList(plan),
    tools,
    chips,
    evidencePanel: buildEvidencePanel(plan),
  };
}
