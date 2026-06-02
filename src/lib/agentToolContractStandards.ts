export type AgentToolContractRisk =
  | 'read'
  | 'write'
  | 'export'
  | 'destructive'
  | 'billing'
  | 'credential'
  | 'privacy'
  | 'external_submission'
  | 'shell'
  | 'connected_agent_launch';

export type AgentToolContractEvalId =
  | 'happy_path'
  | 'malformed_input'
  | 'missing_permission'
  | 'unsafe_or_destructive'
  | 'unavailable_dependency'
  | 'ambiguous_target'
  | 'redaction'
  | 'retry_idempotency'
  | 'prompt_injection_resistance'
  | 'regression_golden_task';

export interface AgentToolContractField {
  id: string;
  title: string;
  requirement: string;
}

export interface AgentToolContractEval {
  id: AgentToolContractEvalId;
  title: string;
  proves: string;
  required: boolean;
}

export interface AgentToolContractChecklistOptions {
  toolName?: string | null;
  surface?: string | null;
}

export interface AgentToolContractChecklist {
  toolName: string;
  surface: string;
  riskTags: AgentToolContractRisk[];
  approvalRequired: boolean;
  requiredFields: AgentToolContractField[];
  requiredEvals: AgentToolContractEval[];
  recoveryFields: string[];
  recommendedSmokeCommands: string[];
}

export type AgentToolContractReviewSeverity = 'blocker' | 'warning' | 'info';

export interface AgentToolContractDraft {
  toolName?: string | null;
  purpose?: string | null;
  inputs?: string[] | Record<string, unknown> | string | null;
  trustBoundary?: string[] | string | null;
  riskTags?: AgentToolContractRisk[] | null;
  approvalRequired?: boolean | null;
  idempotency?: string | null;
  observationRequirement?: string[] | string | null;
  outputVariants?: string[] | null;
  evidence?: string[] | string | null;
  redaction?: string[] | string | null;
  evalIds?: AgentToolContractEvalId[] | null;
  recoveryFields?: string[] | null;
  smokeCommands?: string[] | null;
}

export interface AgentToolContractReviewIssue {
  severity: AgentToolContractReviewSeverity;
  fieldId: string;
  message: string;
  recommendation: string;
}

export interface AgentToolContractReview {
  ok: boolean;
  status: 'ready' | 'blocked';
  score: number;
  checklist: AgentToolContractChecklist;
  issues: AgentToolContractReviewIssue[];
  missingFieldIds: string[];
  missingEvalIds: AgentToolContractEvalId[];
  missingRecoveryFields: string[];
  missingSmokeCommands: string[];
}

const AGENT_TOOL_CONTRACT_MARKER = '=== AGENT TOOL CONTRACT CHECKLIST ===';
const AGENT_TOOL_CONTRACT_REVIEW_MARKER = '=== AGENT TOOL CONTRACT REVIEW ===';

export const AGENT_TOOL_CONTRACT_REQUIRED_FIELDS: AgentToolContractField[] = [
  {
    id: 'tool_name',
    title: 'Tool name',
    requirement: 'Use a namespaced imperative action, such as desktop.observe_window or app.indesign.export_pdf.',
  },
  {
    id: 'purpose',
    title: 'Purpose',
    requirement: 'Expose one clear capability and split read, write, export, destructive, and billing actions.',
  },
  {
    id: 'inputs',
    title: 'Inputs',
    requirement: 'Use a strict schema with typed enums, bounded strings, size caps, and required fields.',
  },
  {
    id: 'trust_boundary',
    title: 'Trust boundary',
    requirement: 'Name untrusted inputs such as user text, provider output, DOM, app state, file paths, bridge responses, and tool results.',
  },
  {
    id: 'risk_annotation',
    title: 'Risk annotation',
    requirement: 'Declare read, write, export, destructive, billing, credential, privacy, shell, or external-submission risk.',
  },
  {
    id: 'approval_requirement',
    title: 'Approval requirement',
    requirement: 'State whether approval is required, why, and what the user-visible approval payload must say.',
  },
  {
    id: 'idempotency',
    title: 'Idempotency',
    requirement: 'State whether retries are safe and what key or checkpoint prevents duplicate side effects.',
  },
  {
    id: 'observation_requirement',
    title: 'Observation requirement',
    requirement: 'List the browser, desktop, app, file, or bridge state required before side effects.',
  },
  {
    id: 'output_shape',
    title: 'Output shape',
    requirement: 'Return stable completed, blocked, unsafe, and failed variants instead of raw prose.',
  },
  {
    id: 'evidence',
    title: 'Evidence',
    requirement: 'Return before/after state, receipts, screenshots, diffs, exports, hashes, or a manual-verification marker.',
  },
  {
    id: 'redaction',
    title: 'Redaction',
    requirement: 'Declare fields that must never reach logs, prompts, receipts, metadata, or chat-visible output.',
  },
  {
    id: 'eval_coverage',
    title: 'Eval coverage',
    requirement: 'Cover happy path, malformed input, denied permission, unsafe target, recovery, redaction, and retry/idempotency.',
  },
];

export const AGENT_TOOL_CONTRACT_EVAL_MATRIX: AgentToolContractEval[] = [
  {
    id: 'happy_path',
    title: 'Happy path',
    proves: 'The tool completes the intended safe task and returns proof.',
    required: true,
  },
  {
    id: 'malformed_input',
    title: 'Malformed input',
    proves: 'Bad arguments fail closed with a typed error.',
    required: true,
  },
  {
    id: 'missing_permission',
    title: 'Missing permission',
    proves: 'The tool asks for approval or user action instead of bypassing the gate.',
    required: true,
  },
  {
    id: 'unsafe_or_destructive',
    title: 'Unsafe or destructive request',
    proves: 'The tool refuses or approval-gates destructive, credential, billing, shell, or low-confidence actions.',
    required: true,
  },
  {
    id: 'unavailable_dependency',
    title: 'Unavailable dependency',
    proves: 'A missing bridge, provider, app, file, or tool becomes structured recovery options.',
    required: true,
  },
  {
    id: 'ambiguous_target',
    title: 'Ambiguous target',
    proves: 'The tool asks for clarification or fresh evidence before acting.',
    required: true,
  },
  {
    id: 'redaction',
    title: 'Redaction',
    proves: 'Secrets, private paths, screenshots, OCR, DOM, app state, and file snippets do not leak.',
    required: true,
  },
  {
    id: 'retry_idempotency',
    title: 'Retry and idempotency',
    proves: 'Re-running cannot duplicate side effects without approval and a safe checkpoint.',
    required: true,
  },
  {
    id: 'prompt_injection_resistance',
    title: 'Prompt-injection resistance',
    proves: 'Untrusted page, app, file, or tool output cannot override tool policy.',
    required: true,
  },
  {
    id: 'regression_golden_task',
    title: 'Regression golden task',
    proves: 'A representative real user task keeps working across changes.',
    required: true,
  },
];

const RECOVERY_FIELDS = [
  'code',
  'retryable',
  'requiresFreshEvidence',
  'requiresApproval',
  'actor',
  'maxAttempts',
  'recoveryOptions',
  'stopCondition',
];

const BASE_SMOKE_COMMANDS = [
  'npm run smoke:agent-tool-contract-standards',
  'npm run smoke:agent-standards-wiki',
  'npm run typecheck:app',
  'git diff --check',
];

function normalizedText(value: string): string {
  return String(value || '').toLowerCase();
}

function addUnique<T>(items: T[], values: T[]): T[] {
  const next = [...items];
  for (const value of values) {
    if (!next.includes(value)) next.push(value);
  }
  return next;
}

function normalizeDraftList(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function hasDraftText(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => String(item || '').trim().length > 0);
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

function buildIssue(
  severity: AgentToolContractReviewSeverity,
  fieldId: string,
  message: string,
  recommendation: string,
): AgentToolContractReviewIssue {
  return { severity, fieldId, message, recommendation };
}

export function inferAgentToolContractRiskTags(description: string): AgentToolContractRisk[] {
  const text = normalizedText(description);
  let risks: AgentToolContractRisk[] = [];

  if (/\b(reads?|lists?|search(?:es)?|gets?|observes?|inspects?|queries|fetch(?:es)?|views?)\b/.test(text)) risks = addUnique(risks, ['read']);
  if (/\b(writes?|edits?|changes?|updates?|creates?|patch(?:es)?|saves?|modifies|mutates?|renames?|moves?|appends?)\b/.test(text)) risks = addUnique(risks, ['write']);
  if (/\b(exports?|downloads?|renders?|prints?|generate pdf|save as)\b/.test(text)) risks = addUnique(risks, ['export']);
  if (/\b(deletes?|removes?|destroys?|overwrites?|resets?|wipes?|drops?|truncates?)\b/.test(text)) risks = addUnique(risks, ['destructive']);
  if (/\b(billing|purchase|paid|charge|cost|subscription|token spend|anthropic charges?)\b/.test(text)) risks = addUnique(risks, ['billing']);
  if (/\b(credential|oauth|api key|token|secret|password|vault|auth header)\b/.test(text)) risks = addUnique(risks, ['credential']);
  if (/\b(private|local file|file contents|screenshot|ocr|dom|accessibility tree|path|browser data|account)\b/.test(text)) risks = addUnique(risks, ['privacy']);
  if (/\b(submit|publish|send|post|upload|email|message|external)\b/.test(text)) risks = addUnique(risks, ['external_submission']);
  if (/\b(shell|terminal|command|install|npm|node|script|exec|spawn)\b/.test(text)) risks = addUnique(risks, ['shell']);
  if (/\b(connected agent|claude code|cursor composer|codex|opencode|aider|cline|windsurf|continue|custom agent)\b/.test(text)) {
    risks = addUnique(risks, ['connected_agent_launch']);
  }

  return risks.length > 0 ? risks : ['read'];
}

export function requiresAgentToolContractApproval(risks: AgentToolContractRisk[]): boolean {
  return risks.some((risk) => risk !== 'read');
}

export function buildAgentToolContractEvalPlan(description: string): AgentToolContractEval[] {
  const risks = inferAgentToolContractRiskTags(description);
  const text = normalizedText(description);
  const baselineIds: AgentToolContractEvalId[] = [
    'happy_path',
    'malformed_input',
    'missing_permission',
    'unavailable_dependency',
    'redaction',
    'prompt_injection_resistance',
    'regression_golden_task',
  ];

  let ids = baselineIds;
  if (requiresAgentToolContractApproval(risks) || /\b(approval|permission|privileged|side effect|side-effect)\b/.test(text)) {
    ids = addUnique(ids, ['unsafe_or_destructive', 'retry_idempotency']);
  }
  if (/\b(app|desktop|browser|file|bridge|mcp|dom|screenshot|indesign|photoshop|autocad|cad)\b/.test(text)) {
    ids = addUnique(ids, ['ambiguous_target']);
  }

  return AGENT_TOOL_CONTRACT_EVAL_MATRIX.filter((item) => ids.includes(item.id));
}

export function buildAgentToolContractSmokeCommands(description: string): string[] {
  const text = normalizedText(description);
  let commands = [...BASE_SMOKE_COMMANDS];

  if (/\b(bridge|desktop)\b/.test(text)) {
    commands = addUnique(commands, ['npm run smoke:desktop-bridge', 'npm run smoke:desktop-diag']);
  }
  if (/\b(browser|playwright|browserbase|dom)\b/.test(text)) {
    commands = addUnique(commands, ['npm run smoke:browser-bridge', 'npm run smoke:chat-computer-request-router']);
  }
  if (/\b(openswan|tool runtime|runtime tool|approval)\b/.test(text)) {
    commands = addUnique(commands, ['npm run smoke:openswan-runtime-approval']);
  }
  if (/\b(mcp|custom agent|connected agent|opencode|aider|cline|windsurf|continue|cursor composer)\b/.test(text)) {
    commands = addUnique(commands, ['npm run smoke:custom-agent-bridge-dispatch', 'npm run smoke:terminal-agent-standards-handoff']);
  }
  if (/\b(app|indesign|photoshop|adobe|cad|autocad)\b/.test(text)) {
    commands = addUnique(commands, ['npm run smoke:app-automation-control-surfaces', 'npm run smoke:computer-task-evidence-contract']);
  }

  return commands;
}

export function buildAgentToolContractChecklist(
  description: string,
  options: AgentToolContractChecklistOptions = {},
): AgentToolContractChecklist {
  const risks = inferAgentToolContractRiskTags(description);
  const text = normalizedText(description);
  return {
    toolName: String(options.toolName || 'proposed_tool').trim() || 'proposed_tool',
    surface: String(options.surface || 'agent_tool').trim() || 'agent_tool',
    riskTags: risks,
    approvalRequired: requiresAgentToolContractApproval(risks) || /\b(approval|permission|privileged|side effect|side-effect)\b/.test(text),
    requiredFields: [...AGENT_TOOL_CONTRACT_REQUIRED_FIELDS],
    requiredEvals: buildAgentToolContractEvalPlan(description),
    recoveryFields: [...RECOVERY_FIELDS],
    recommendedSmokeCommands: buildAgentToolContractSmokeCommands(description),
  };
}

export function formatAgentToolContractChecklistPromptBlock(
  description: string,
  options: AgentToolContractChecklistOptions = {},
): string {
  const checklist = buildAgentToolContractChecklist(description, options);
  const fields = checklist.requiredFields
    .map((field) => `- ${field.title}: ${field.requirement}`)
    .join('\n');
  const evals = checklist.requiredEvals
    .map((item) => `- ${item.title}: ${item.proves}`)
    .join('\n');
  const commands = checklist.recommendedSmokeCommands.map((command) => `- ${command}`).join('\n');

  return [
    AGENT_TOOL_CONTRACT_MARKER,
    `Tool: ${checklist.toolName}`,
    `Surface: ${checklist.surface}`,
    `Risk tags: ${checklist.riskTags.join(', ')}`,
    `Approval required: ${checklist.approvalRequired ? 'yes' : 'no'}`,
    `Recovery fields: ${checklist.recoveryFields.join(', ')}`,
    'Required contract fields:',
    fields,
    'Required evals:',
    evals,
    'Recommended verification:',
    commands,
  ].join('\n');
}

export function hasAgentToolContractChecklistPromptBlock(prompt: string): boolean {
  return String(prompt || '').includes(AGENT_TOOL_CONTRACT_MARKER);
}

export function applyAgentToolContractChecklistToPrompt(
  prompt: string,
  options: AgentToolContractChecklistOptions & { taskDescription?: string | null } = {},
): string {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt || hasAgentToolContractChecklistPromptBlock(cleanPrompt)) return cleanPrompt;

  const taskDescription = String(options.taskDescription || cleanPrompt).trim();
  return [
    cleanPrompt,
    '',
    'Use this concrete tool-contract checklist before implementation.',
    formatAgentToolContractChecklistPromptBlock(taskDescription, options),
  ].join('\n');
}

export function reviewAgentToolContractDraft(
  description: string,
  draft: AgentToolContractDraft,
  options: AgentToolContractChecklistOptions = {},
): AgentToolContractReview {
  const checklist = buildAgentToolContractChecklist(description, {
    toolName: draft.toolName || options.toolName,
    surface: options.surface,
  });
  const issues: AgentToolContractReviewIssue[] = [];

  const draftRisks = draft.riskTags?.length ? draft.riskTags : checklist.riskTags;
  const draftEvalIds = new Set(draft.evalIds || []);
  const draftRecoveryFields = new Set(normalizeDraftList(draft.recoveryFields || []));
  const draftSmokeCommands = new Set(normalizeDraftList(draft.smokeCommands || []));

  const requiredFieldPresence: Record<string, boolean> = {
    tool_name: hasDraftText(draft.toolName || options.toolName || checklist.toolName),
    purpose: hasDraftText(draft.purpose),
    inputs: hasDraftText(draft.inputs),
    trust_boundary: hasDraftText(draft.trustBoundary),
    risk_annotation: Boolean(draft.riskTags?.length),
    approval_requirement: typeof draft.approvalRequired === 'boolean',
    idempotency: hasDraftText(draft.idempotency),
    observation_requirement: hasDraftText(draft.observationRequirement),
    output_shape: normalizeDraftList(draft.outputVariants || []).includes('completed')
      && normalizeDraftList(draft.outputVariants || []).includes('blocked')
      && normalizeDraftList(draft.outputVariants || []).includes('unsafe')
      && normalizeDraftList(draft.outputVariants || []).includes('failed'),
    evidence: hasDraftText(draft.evidence),
    redaction: hasDraftText(draft.redaction),
    eval_coverage: Boolean(draft.evalIds?.length),
  };

  const missingFieldIds = checklist.requiredFields
    .filter((field) => !requiredFieldPresence[field.id])
    .map((field) => field.id);

  for (const field of checklist.requiredFields) {
    if (missingFieldIds.includes(field.id)) {
      issues.push(buildIssue(
        'blocker',
        field.id,
        `${field.title} is missing or incomplete.`,
        field.requirement,
      ));
    }
  }

  const inferredApprovalRequired = requiresAgentToolContractApproval(draftRisks)
    || checklist.approvalRequired;
  if (inferredApprovalRequired && draft.approvalRequired !== true) {
    issues.push(buildIssue(
      'blocker',
      'approval_required',
      'This tool has privileged risk but the draft is not approval-gated.',
      'Set approvalRequired true and include actor, target, risk, proof, retry limit, and stop condition in the approval payload.',
    ));
  }

  const missingEvalIds = checklist.requiredEvals
    .map((item) => item.id)
    .filter((id) => !draftEvalIds.has(id));
  for (const evalId of missingEvalIds) {
    const item = checklist.requiredEvals.find((candidate) => candidate.id === evalId);
    issues.push(buildIssue(
      'blocker',
      `eval:${evalId}`,
      `${item?.title || evalId} eval is missing.`,
      item?.proves || 'Add this negative-path or proof eval before marking the tool ready.',
    ));
  }

  const missingRecoveryFields = checklist.recoveryFields
    .filter((field) => !draftRecoveryFields.has(field));
  for (const field of missingRecoveryFields) {
    issues.push(buildIssue(
      'blocker',
      `recovery:${field}`,
      `Recovery field ${field} is missing.`,
      'Return stable recovery fields so chat can show selectable options without parsing prose.',
    ));
  }

  const missingSmokeCommands = checklist.recommendedSmokeCommands
    .filter((command) => !draftSmokeCommands.has(command));
  for (const command of missingSmokeCommands) {
    issues.push(buildIssue(
      'warning',
      `smoke:${command}`,
      `Recommended verification command is not listed: ${command}.`,
      'Add the command to the verification plan or document why it is not applicable.',
    ));
  }

  const blockerCount = issues.filter((issue) => issue.severity === 'blocker').length;
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
  const score = Math.max(0, 100 - blockerCount * 12 - warningCount * 3);

  return {
    ok: blockerCount === 0,
    status: blockerCount === 0 ? 'ready' : 'blocked',
    score,
    checklist,
    issues,
    missingFieldIds,
    missingEvalIds,
    missingRecoveryFields,
    missingSmokeCommands,
  };
}

export function formatAgentToolContractReviewPromptBlock(review: AgentToolContractReview): string {
  const blockers = review.issues
    .filter((issue) => issue.severity === 'blocker')
    .map((issue) => `- ${issue.fieldId}: ${issue.message} ${issue.recommendation}`)
    .join('\n') || '- none';
  const warnings = review.issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => `- ${issue.fieldId}: ${issue.message} ${issue.recommendation}`)
    .join('\n') || '- none';

  return [
    AGENT_TOOL_CONTRACT_REVIEW_MARKER,
    `Status: ${review.status}`,
    `Score: ${review.score}`,
    `Tool: ${review.checklist.toolName}`,
    `Surface: ${review.checklist.surface}`,
    `Missing contract fields: ${review.missingFieldIds.join(', ') || 'none'}`,
    `Missing evals: ${review.missingEvalIds.join(', ') || 'none'}`,
    `Missing recovery fields: ${review.missingRecoveryFields.join(', ') || 'none'}`,
    'Blockers:',
    blockers,
    'Warnings:',
    warnings,
  ].join('\n');
}
