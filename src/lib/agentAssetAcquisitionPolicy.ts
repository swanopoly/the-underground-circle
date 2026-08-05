export type AgentAssetAcquisitionOperation =
  | 'download'
  | 'generate'
  | 'install'
  | 'clone'
  | 'reuse_existing'
  | 'unknown';

export type AgentAssetAcquisitionRisk = 'low' | 'medium' | 'high';

export interface AgentAssetAcquisitionPolicyInput {
  goal: string;
  outputDir?: string;
  expectedFileName?: string;
  sourceUrl?: string;
  taskContext?: string;
}

export interface AgentAssetRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: 'full';
  retryableSignals: string[];
  nonRetryableSignals: string[];
  idempotencyRule: string;
}

export interface AgentAssetVerificationPlan {
  manifestName: string;
  requiredTools: string[];
  requiredSignals: string[];
  successCriteria: string[];
}

export interface AgentAssetAcquisitionPolicy {
  operation: AgentAssetAcquisitionOperation;
  risk: AgentAssetAcquisitionRisk;
  outputDir: string;
  expectedFileName?: string;
  sourceUrl?: string;
  taskContext?: string;
  guardrails: string[];
  retryPolicy: AgentAssetRetryPolicy;
  verification: AgentAssetVerificationPlan;
  prompt: string;
}

const DEFAULT_OUTPUT_DIR = '~/Downloads/UC-Agent-Acquisitions';
const MANIFEST_NAME = 'uc-codex-acquisition-manifest.md';

function clean(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanPath(value: unknown): string {
  return String(value || '').replace(/\0/g, '').trim();
}

export function classifyAgentAssetAcquisition(goal: string): AgentAssetAcquisitionOperation {
  const text = goal.toLowerCase();
  if (/\b(already exists?|find existing|reuse|use existing|locate)\b/.test(text)) return 'reuse_existing';
  if (/\b(clone|git clone|repository|repo)\b/.test(text)) return 'clone';
  if (/\b(install|npm install|pnpm add|yarn add|pip install|brew install|package|dependency|dependencies)\b/.test(text)) return 'install';
  if (/\b(generate|create|make|render|design|produce|synthesize)\b/.test(text)) return 'generate';
  if (/\b(download|fetch|pull|get|acquire|save)\b/.test(text)) return 'download';
  return 'unknown';
}

function riskForOperation(operation: AgentAssetAcquisitionOperation, sourceUrl?: string): AgentAssetAcquisitionRisk {
  if (operation === 'install' || operation === 'clone') return 'high';
  if (operation === 'download' && !sourceUrl) return 'high';
  if (operation === 'download' || operation === 'generate') return 'medium';
  return 'low';
}

function buildRetryPolicy(operation: AgentAssetAcquisitionOperation): AgentAssetRetryPolicy {
  const canRetry = operation === 'download' || operation === 'clone' || operation === 'install';
  return {
    maxAttempts: canRetry ? 3 : 1,
    baseDelayMs: 750,
    maxDelayMs: 8_000,
    jitter: 'full',
    retryableSignals: [
      'HTTP 408, 409 lock/contention, 425, 429, and 5xx responses',
      'socket timeout, connection reset, temporary DNS failure, or rate limit with Retry-After',
      'package registry transient network errors such as ETIMEDOUT, ECONNRESET, EAI_AGAIN, or 503',
    ],
    nonRetryableSignals: [
      '401, 403, 404, invalid URL, unsupported file type, missing credentials, paywall, CAPTCHA, MFA, or permission denied',
      'checksum mismatch, unsafe executable download, path escaping the output directory, or malware/security warning',
      'global install, sudo/admin prompt, or request for private account access',
    ],
    idempotencyRule:
      'Retry only steps that are safe to repeat. Write to a temporary path first and move/rename once verified so repeated attempts do not create ambiguous duplicates.',
  };
}

function buildGuardrails(operation: AgentAssetAcquisitionOperation, outputDir: string): string[] {
  const guardrails = [
    'Do not use credentials, bypass paywalls, solve CAPTCHA/MFA, or access private accounts.',
    'Do not use sudo, global package installs, system-wide preference changes, or destructive cleanup.',
    `Keep acquired artifacts under ${outputDir} unless a package manager requires a project-local cache; record any exception in the manifest.`,
    'Prefer official/public sources and record source URL, license, and checksum when available.',
    'Use a temporary download/build path and only mark success after verifying the final artifact exists.',
    'Stop and report a blocker instead of guessing, fabricating a file path, or downloading an unsafe file.',
  ];
  if (operation === 'install') {
    guardrails.push('For dependencies, prefer project-local installs and lockfile-aware commands. Do not mutate unrelated projects.');
  }
  if (operation === 'clone') {
    guardrails.push('For repositories, clone into a named subfolder under the output directory and record the commit SHA.');
  }
  return guardrails;
}

function buildVerificationPlan(): AgentAssetVerificationPlan {
  return {
    manifestName: MANIFEST_NAME,
    requiredTools: ['desktop.file_search', 'desktop.file_stat', 'desktop.file_read'],
    requiredSignals: ['absolute artifact path', 'file size', 'modified time', 'source URL/license when relevant', 'manifest path'],
    successCriteria: [
      `Manifest ${MANIFEST_NAME} exists in the output directory.`,
      'Every claimed artifact has an absolute path and is verified with desktop.file_stat before use.',
      'The downstream browser/desktop workflow receives an exact verified path, never a guessed filename.',
    ],
  };
}

export function buildAgentAssetAcquisitionPolicy(input: AgentAssetAcquisitionPolicyInput): AgentAssetAcquisitionPolicy {
  const goal = clean(input.goal);
  const outputDir = cleanPath(input.outputDir) || DEFAULT_OUTPUT_DIR;
  const expectedFileName = clean(input.expectedFileName) || undefined;
  const sourceUrl = clean(input.sourceUrl) || undefined;
  const taskContext = clean(input.taskContext) || undefined;
  const operation = classifyAgentAssetAcquisition([goal, sourceUrl, expectedFileName].filter(Boolean).join(' '));
  const risk = riskForOperation(operation, sourceUrl);
  const retryPolicy = buildRetryPolicy(operation);
  const verification = buildVerificationPlan();
  const guardrails = buildGuardrails(operation, outputDir);

  const prompt = [
    'You are Codex attached to The Underground Circle app.',
    'Task: safely acquire, download, generate, install, clone, or prepare the resource needed for the user workflow.',
    `Goal: ${goal}`,
    `Classified operation: ${operation}`,
    `Risk tier: ${risk}`,
    sourceUrl ? `Source URL: ${sourceUrl}` : '',
    expectedFileName ? `Expected file name: ${expectedFileName}` : '',
    `Output directory: ${outputDir}`,
    taskContext ? `Workflow context: ${taskContext}` : '',
    '',
    'Guardrails:',
    ...guardrails.map((item) => `- ${item}`),
    '',
    'Retry policy:',
    `- Max attempts: ${retryPolicy.maxAttempts}. Use full jitter between ${retryPolicy.baseDelayMs}ms and ${retryPolicy.maxDelayMs}ms.`,
    `- ${retryPolicy.idempotencyRule}`,
    `- Retry only: ${retryPolicy.retryableSignals.join('; ')}.`,
    `- Do not retry: ${retryPolicy.nonRetryableSignals.join('; ')}.`,
    '',
    'Manifest requirement:',
    `- Write ${verification.manifestName} in the output directory.`,
    '- Include: goal, operation, risk tier, absolute artifact paths, source URLs, license/checksum when known, file sizes if available, commands run, and verification steps.',
    '- Use lines beginning with "artifact_path:" for each artifact so OpenSwan can parse and verify them later.',
    '- If blocked, write the blocker and the exact next human action needed.',
    '',
    'Completion contract:',
    '- Do not say the asset is ready unless it exists locally and is listed in the manifest.',
    '- Keep terminal notes concise and include the exact paths OpenSwan should verify with desktop.file_search and desktop.file_stat.',
  ].filter(Boolean).join('\n');

  return {
    operation,
    risk,
    outputDir,
    expectedFileName,
    sourceUrl,
    taskContext,
    guardrails,
    retryPolicy,
    verification,
    prompt,
  };
}

export function formatAgentAssetAcquisitionPolicySummary(policy: AgentAssetAcquisitionPolicy): string {
  return [
    `Codex acquisition policy: ${policy.operation} (${policy.risk} risk).`,
    `Output: ${policy.outputDir}. Manifest: ${policy.verification.manifestName}.`,
    `Retry: ${policy.retryPolicy.maxAttempts} max attempt${policy.retryPolicy.maxAttempts === 1 ? '' : 's'} with full jitter; non-transient/auth/CAPTCHA/paywall errors stop immediately.`,
    `Verify next with: ${policy.verification.requiredTools.join(', ')}.`,
  ].join(' ');
}
