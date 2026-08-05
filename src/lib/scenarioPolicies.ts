import type { UserTaskPipelineId, UserTaskPipelineRisk, UserTaskPipelineSummary } from './userTaskPipelines';

export type ExecutionSurface =
  | 'model_only'
  | 'integration_api'
  | 'browser_semantic'
  | 'browser_stagehand'
  | 'browser_remote'
  | 'desktop_bridge'
  | 'desktop_a11y'
  | 'desktop_vision'
  | 'terminal_bridge'
  | 'code_tools'
  | 'vault'
  | 'memory'
  | 'office'
  | 'human_takeover';

export type ScenarioBlockedAction =
  | 'raw_secret_exposure'
  | 'captcha_bypass'
  | 'unapproved_publish'
  | 'unapproved_submit'
  | 'unapproved_payment'
  | 'unapproved_purchase'
  | 'unapproved_delete'
  | 'unapproved_external_send'
  | 'unapproved_terminal_command'
  | 'unapproved_file_write'
  | 'unbudgeted_paid_model_call'
  | 'cross_user_data_access';

export type ScenarioCredentialPolicy = {
  mode: 'none' | 'optional' | 'required' | 'forbidden';
  vaultGrantRequired: boolean;
  rawSecretExposureAllowed: false;
  allowedOriginsRequired: boolean;
  auditAccess: boolean;
};

export type ScenarioModelBudget = {
  routerModelTier: 'cheap' | 'standard';
  plannerModelTier: 'cheap' | 'standard' | 'frontier';
  executorModelTier: 'cheap' | 'standard' | 'frontier' | 'vision';
  preferCheapModels: boolean;
  allowComputerUseModel: boolean;
  maxUsd: number;
  maxSteps: number;
};

export type ScenarioPolicy = {
  id: UserTaskPipelineId;
  risk: UserTaskPipelineRisk;
  allowedSurfaces: ExecutionSurface[];
  preferredSurfaceOrder: ExecutionSurface[];
  blockedActions: ScenarioBlockedAction[];
  approvalTriggers: string[];
  credentialPolicy: ScenarioCredentialPolicy;
  modelBudget: ScenarioModelBudget;
  completionProof: string[];
  failureClasses: string[];
  persistenceTargets: string[];
  memoryUsePolicy: {
    readUserMemory: boolean;
    readCircleMemory: boolean;
    writeUserMemory: boolean;
    writeCircleMemory: boolean;
    writeFailurePattern: boolean;
  };
};

type ScenarioPolicyOverride = Partial<Omit<ScenarioPolicy, 'id' | 'risk' | 'credentialPolicy' | 'modelBudget' | 'memoryUsePolicy'>> & {
  credentialPolicy?: Partial<ScenarioCredentialPolicy>;
  modelBudget?: Partial<ScenarioModelBudget>;
  memoryUsePolicy?: Partial<ScenarioPolicy['memoryUsePolicy']>;
};

const DEFAULT_BLOCKED_ACTIONS: ScenarioBlockedAction[] = [
  'raw_secret_exposure',
  'captcha_bypass',
  'cross_user_data_access',
  'unbudgeted_paid_model_call',
];

const WRITE_BLOCKED_ACTIONS: ScenarioBlockedAction[] = [
  ...DEFAULT_BLOCKED_ACTIONS,
  'unapproved_publish',
  'unapproved_submit',
  'unapproved_payment',
  'unapproved_purchase',
  'unapproved_delete',
  'unapproved_external_send',
];

const DEFAULT_FAILURE_CLASSES = [
  'missing_user_key',
  'provider_unavailable',
  'budget_exceeded',
  'no_progress_loop',
  'unknown',
];

const DEFAULT_CREDENTIAL_POLICY: ScenarioCredentialPolicy = {
  mode: 'none',
  vaultGrantRequired: false,
  rawSecretExposureAllowed: false,
  allowedOriginsRequired: false,
  auditAccess: true,
};

const DEFAULT_MODEL_BUDGET: ScenarioModelBudget = {
  routerModelTier: 'cheap',
  plannerModelTier: 'cheap',
  executorModelTier: 'standard',
  preferCheapModels: true,
  allowComputerUseModel: false,
  maxUsd: 0.15,
  maxSteps: 8,
};

const DEFAULT_MEMORY_POLICY: ScenarioPolicy['memoryUsePolicy'] = {
  readUserMemory: true,
  readCircleMemory: true,
  writeUserMemory: false,
  writeCircleMemory: false,
  writeFailurePattern: true,
};

function riskDefaults(risk: UserTaskPipelineRisk): ScenarioPolicyOverride {
  if (risk === 'external_side_effect' || risk === 'destructive') {
    return {
      blockedActions: WRITE_BLOCKED_ACTIONS,
      modelBudget: { plannerModelTier: 'standard', maxUsd: 0.5, maxSteps: 20 },
      approvalTriggers: ['External writes, submissions, sends, payments, purchases, deletes, or public changes.'],
    };
  }
  if (risk === 'review') {
    return {
      blockedActions: [...DEFAULT_BLOCKED_ACTIONS, 'unapproved_terminal_command', 'unapproved_file_write'],
      modelBudget: { plannerModelTier: 'standard', maxUsd: 0.3, maxSteps: 14 },
      approvalTriggers: ['Sensitive data, local mutation, browser mutation, or uncertain actions.'],
    };
  }
  return {};
}

const POLICY_OVERRIDES: Partial<Record<UserTaskPipelineId, ScenarioPolicyOverride>> = {
  direct_answer: {
    allowedSurfaces: ['model_only', 'memory'],
    preferredSurfaceOrder: ['model_only', 'memory'],
    modelBudget: { maxUsd: 0.03, maxSteps: 1 },
    completionProof: ['Direct answer provided.'],
    failureClasses: ['model_refusal', 'missing_context', 'unknown'],
  },
  capability_explanation: {
    allowedSurfaces: ['model_only', 'integration_api', 'desktop_bridge', 'browser_semantic'],
    preferredSurfaceOrder: ['integration_api', 'desktop_bridge', 'browser_semantic', 'model_only'],
    modelBudget: { maxUsd: 0.04, maxSteps: 2 },
    completionProof: ['Capability answer describes current app capability and setup requirements.'],
    failureClasses: ['bridge_offline', 'missing_permission', 'model_identity_leak', 'unknown'],
  },
  live_research: {
    allowedSurfaces: ['integration_api', 'model_only', 'memory'],
    preferredSurfaceOrder: ['memory', 'integration_api', 'model_only'],
    modelBudget: { plannerModelTier: 'standard', maxUsd: 0.35, maxSteps: 8 },
    completionProof: ['Sources or internal knowledge refs are included.'],
    persistenceTargets: ['research_memory', 'digital_brain', 'chat_message'],
  },
  memory_second_brain: {
    allowedSurfaces: ['memory', 'model_only'],
    preferredSurfaceOrder: ['memory', 'model_only'],
    memoryUsePolicy: { writeUserMemory: true, writeCircleMemory: true },
    completionProof: ['Memory operation completed or memory graph blocker reported.'],
    persistenceTargets: ['user_memory', 'circle_memory', 'digital_brain'],
  },
  browser_data_retrieval: {
    allowedSurfaces: ['integration_api', 'browser_semantic', 'browser_stagehand', 'browser_remote'],
    preferredSurfaceOrder: ['integration_api', 'browser_semantic', 'browser_stagehand', 'browser_remote'],
    modelBudget: { maxUsd: 0.25, maxSteps: 12 },
    completionProof: ['Structured data includes source URL or page evidence.'],
    failureClasses: ['browser_bridge_offline', 'browser_dialog_blocked', 'selector_not_found', 'auth_required', 'rate_limited', 'unknown'],
  },
  browser_form_submission: {
    allowedSurfaces: ['browser_semantic', 'desktop_bridge', 'browser_stagehand', 'browser_remote', 'vault', 'human_takeover'],
    preferredSurfaceOrder: ['vault', 'browser_semantic', 'desktop_bridge', 'browser_stagehand', 'browser_remote', 'human_takeover'],
    credentialPolicy: { mode: 'optional', vaultGrantRequired: false, allowedOriginsRequired: true },
    approvalTriggers: ['Credential use, final submit, payment, publish, delete, application, or external send.'],
    completionProof: ['Filled form state, confirmation text, URL, screenshot, or exact blocker.'],
    failureClasses: ['human_verification_required', 'mfa_required', 'browser_dialog_blocked', 'vault_grant_missing', 'selector_not_found', 'browser_bridge_offline'],
  },
  browser_navigation: {
    allowedSurfaces: ['browser_semantic', 'browser_stagehand', 'browser_remote'],
    preferredSurfaceOrder: ['browser_semantic', 'browser_stagehand', 'browser_remote'],
    completionProof: ['Reached page state, screenshot, or DOM evidence.'],
  },
  desktop_awareness: {
    allowedSurfaces: ['desktop_bridge', 'desktop_a11y'],
    preferredSurfaceOrder: ['desktop_bridge', 'desktop_a11y'],
    modelBudget: { maxUsd: 0.03, maxSteps: 3 },
    completionProof: ['Local state returned from desktop bridge or exact bridge blocker.'],
    failureClasses: ['bridge_offline', 'bridge_endpoint_missing', 'cors_preflight_blocked', 'missing_permission', 'unknown'],
  },
  bridge_troubleshooting: {
    allowedSurfaces: ['desktop_bridge', 'browser_semantic', 'integration_api'],
    preferredSurfaceOrder: ['desktop_bridge', 'browser_semantic', 'integration_api'],
    modelBudget: { maxUsd: 0.06, maxSteps: 5 },
    completionProof: ['Bridge health result and exact recovery step.'],
    failureClasses: ['bridge_offline', 'bridge_endpoint_missing', 'cors_preflight_blocked', 'token_rejected', 'missing_permission', 'unknown'],
    memoryUsePolicy: { writeCircleMemory: true, writeFailurePattern: true },
  },
  desktop_app_control: {
    allowedSurfaces: ['desktop_bridge', 'desktop_a11y', 'desktop_vision', 'human_takeover'],
    preferredSurfaceOrder: ['desktop_bridge', 'desktop_a11y', 'desktop_vision', 'human_takeover'],
    modelBudget: { executorModelTier: 'vision', allowComputerUseModel: true, maxUsd: 0.65, maxSteps: 24 },
    approvalTriggers: ['Typing, clicking, deleting, sending, publishing, file writes, or shortcut execution.'],
    completionProof: ['Visible app state, screenshot, accessibility element result, or exact missing permission.'],
    failureClasses: ['missing_permission', 'a11y_tree_unavailable', 'screenshot_unavailable', 'uncertain_ui_target', 'no_progress_loop'],
  },
  local_files: {
    allowedSurfaces: ['desktop_bridge'],
    preferredSurfaceOrder: ['desktop_bridge'],
    blockedActions: [...DEFAULT_BLOCKED_ACTIONS, 'unapproved_file_write', 'unapproved_delete'],
    completionProof: ['Requested file list/read/search result or permission/path blocker.'],
    failureClasses: ['file_not_found', 'missing_permission', 'path_not_allowed', 'unknown'],
  },
  terminal_agents: {
    allowedSurfaces: ['terminal_bridge', 'office', 'memory'],
    preferredSurfaceOrder: ['terminal_bridge', 'office', 'memory'],
    blockedActions: [...DEFAULT_BLOCKED_ACTIONS, 'unapproved_terminal_command', 'unapproved_file_write'],
    approvalTriggers: ['Launching terminals, executing shell commands, writing files, or sending prompts to agents.'],
    modelBudget: { maxUsd: 0.25, maxSteps: 16 },
    memoryUsePolicy: { writeUserMemory: true, writeCircleMemory: true },
    completionProof: ['Terminal sessions launched, visible in Office, or exact CLI/bridge blocker.'],
    failureClasses: ['terminal_bridge_offline', 'cli_missing', 'permission_denied', 'agent_session_failed', 'unknown'],
  },
  vault_credentials: {
    allowedSurfaces: ['vault', 'human_takeover'],
    preferredSurfaceOrder: ['vault', 'human_takeover'],
    credentialPolicy: { mode: 'required', vaultGrantRequired: true, allowedOriginsRequired: true },
    blockedActions: WRITE_BLOCKED_ACTIONS,
    approvalTriggers: ['Viewing, using, granting, rotating, or deleting credentials.'],
    completionProof: ['Vault state changed, scoped runbook produced, or safe blocker reported.'],
    failureClasses: ['vault_grant_missing', 'origin_not_allowed', 'secret_redaction_required', 'unknown'],
  },
  wordpress_cms: {
    allowedSurfaces: ['integration_api', 'browser_semantic', 'browser_stagehand', 'vault', 'human_takeover'],
    preferredSurfaceOrder: ['integration_api', 'vault', 'browser_semantic', 'browser_stagehand', 'human_takeover'],
    credentialPolicy: { mode: 'optional', vaultGrantRequired: false, allowedOriginsRequired: true },
    approvalTriggers: ['Publish, delete, schedule, credential use, or public site changes.'],
    completionProof: ['Admin status, draft ID, public URL, screenshot, or exact blocker.'],
    failureClasses: ['integration_missing', 'vault_grant_missing', 'human_verification_required', 'publish_approval_required', 'unknown'],
  },
  website_platform_admin: {
    allowedSurfaces: ['integration_api', 'vault', 'browser_semantic', 'desktop_bridge', 'browser_stagehand', 'browser_remote', 'human_takeover'],
    preferredSurfaceOrder: ['integration_api', 'vault', 'browser_semantic', 'desktop_bridge', 'browser_stagehand', 'browser_remote', 'human_takeover'],
    credentialPolicy: { mode: 'optional', vaultGrantRequired: false, allowedOriginsRequired: true },
    modelBudget: { plannerModelTier: 'standard', executorModelTier: 'standard', maxUsd: 0.6, maxSteps: 24 },
    approvalTriggers: ['Credential use, publish, delete, payment, inventory changes, theme changes, or public site changes.'],
    completionProof: ['Admin confirmation, staged preview, public URL, screenshot, or exact platform blocker.'],
    failureClasses: ['vault_grant_missing', 'human_verification_required', 'mfa_required', 'browser_dialog_blocked', 'selector_not_found', 'publish_approval_required', 'browser_bridge_offline'],
    persistenceTargets: ['browser_plan', 'cms_trace', 'approval', 'chat_message', 'vault_audit_log'],
  },
  data_import_export: {
    allowedSurfaces: ['desktop_bridge', 'browser_semantic', 'integration_api', 'human_takeover'],
    preferredSurfaceOrder: ['desktop_bridge', 'browser_semantic', 'integration_api', 'human_takeover'],
    blockedActions: [...DEFAULT_BLOCKED_ACTIONS, 'unapproved_file_write', 'unapproved_submit'],
    approvalTriggers: ['External uploads/imports, downloads/exports to local files, database writes, or publishing.'],
    completionProof: ['Source file/path, target site/state, and import/export/upload/download proof.'],
    failureClasses: ['file_not_found', 'missing_permission', 'browser_dialog_blocked', 'selector_not_found', 'browser_bridge_offline', 'unknown'],
  },
  coding_build: {
    allowedSurfaces: ['code_tools', 'terminal_bridge', 'memory'],
    preferredSurfaceOrder: ['code_tools', 'terminal_bridge', 'memory'],
    blockedActions: [...DEFAULT_BLOCKED_ACTIONS, 'unapproved_terminal_command', 'unapproved_file_write'],
    completionProof: ['Changed files, typecheck/test output, or exact blocker.'],
  },
  debug_fix: {
    allowedSurfaces: ['code_tools', 'terminal_bridge', 'memory'],
    preferredSurfaceOrder: ['code_tools', 'terminal_bridge', 'memory'],
    completionProof: ['Root cause, patch, regression check, or exact blocker.'],
    failureClasses: ['test_failure', 'typecheck_failure', 'missing_repro', 'unknown'],
  },
  performance_cost: {
    allowedSurfaces: ['integration_api', 'code_tools', 'office', 'memory'],
    preferredSurfaceOrder: ['integration_api', 'office', 'code_tools', 'memory'],
    modelBudget: { maxUsd: 0.12, maxSteps: 8 },
    completionProof: ['Cost source attribution, disabled job state, or budget recommendation.'],
    failureClasses: ['usage_source_unknown', 'budget_exceeded', 'cron_still_running', 'unknown'],
  },
  creative_image_design: {
    allowedSurfaces: ['integration_api', 'desktop_bridge', 'desktop_a11y', 'desktop_vision', 'human_takeover'],
    preferredSurfaceOrder: ['integration_api', 'desktop_bridge', 'desktop_a11y', 'desktop_vision', 'human_takeover'],
    modelBudget: { executorModelTier: 'vision', allowComputerUseModel: true, maxUsd: 0.7, maxSteps: 20 },
    completionProof: ['Generated/edited artifact, preview screenshot, or app blocker.'],
  },
  creative_layout_design: {
    allowedSurfaces: ['desktop_bridge', 'desktop_a11y', 'desktop_vision', 'code_tools', 'human_takeover'],
    preferredSurfaceOrder: ['desktop_bridge', 'desktop_a11y', 'desktop_vision', 'code_tools', 'human_takeover'],
    blockedActions: [...DEFAULT_BLOCKED_ACTIONS, 'unapproved_file_write'],
    approvalTriggers: ['Editing layout/image documents, relinking assets, AI generation, saving, exporting, packaging, or running new app scripts.'],
    modelBudget: { plannerModelTier: 'standard', executorModelTier: 'vision', allowComputerUseModel: true, maxUsd: 0.9, maxSteps: 32 },
    completionProof: ['App-native document status, layer/text/link inventory, proof screenshot or exported proof, and output file stat.'],
    failureClasses: ['missing_permission', 'missing_file', 'missing_font_or_link', 'ambiguous_layer_target', 'adapter_gap', 'no_progress_loop'],
    persistenceTargets: ['computer_task_state', 'desktop_attachment_manifest', 'run_ledger', 'proof_artifact', 'chat_message'],
  },
  adobe_creative_cloud: {
    allowedSurfaces: ['desktop_bridge', 'desktop_a11y', 'desktop_vision', 'code_tools', 'human_takeover'],
    preferredSurfaceOrder: ['desktop_bridge', 'desktop_a11y', 'desktop_vision', 'code_tools', 'human_takeover'],
    blockedActions: [...DEFAULT_BLOCKED_ACTIONS, 'unapproved_file_write', 'unapproved_terminal_command'],
    approvalTriggers: ['Desktop Adobe app mutation, source-file changes, save/export/render/encode, batch processing, generative actions, scripts/plugins, or adapter buildout.'],
    modelBudget: { plannerModelTier: 'standard', executorModelTier: 'vision', allowComputerUseModel: true, maxUsd: 0.95, maxSteps: 36 },
    completionProof: ['Target Adobe app/document state, before/after screenshot or app-native inventory, output artifact file stat, or exact app/license/permission blocker.'],
    failureClasses: ['missing_permission', 'app_unavailable', 'license_or_login_required', 'missing_asset_or_plugin', 'adapter_gap', 'no_progress_loop'],
    persistenceTargets: ['computer_task_state', 'desktop_attachment_manifest', 'app_capability_recipe', 'run_ledger', 'proof_artifact', 'chat_message'],
  },
  human_verification: {
    allowedSurfaces: ['human_takeover', 'browser_semantic'],
    preferredSurfaceOrder: ['human_takeover', 'browser_semantic'],
    blockedActions: [...WRITE_BLOCKED_ACTIONS, 'captcha_bypass'],
    approvalTriggers: ['Any CAPTCHA, MFA, OTP, bot-check, or human verification interaction.'],
    completionProof: ['Automation paused and resumed only after human confirmation.'],
    failureClasses: ['human_verification_required', 'mfa_required', 'otp_required'],
  },
};

function buildBasePolicy(id: UserTaskPipelineId, risk: UserTaskPipelineRisk): ScenarioPolicy {
  const riskOverride = riskDefaults(risk);
  const allowedSurfaces = risk === 'safe'
    ? ['model_only', 'memory'] as ExecutionSurface[]
    : ['model_only', 'memory', 'human_takeover'] as ExecutionSurface[];
  return {
    id,
    risk,
    allowedSurfaces,
    preferredSurfaceOrder: allowedSurfaces,
    blockedActions: riskOverride.blockedActions || DEFAULT_BLOCKED_ACTIONS,
    approvalTriggers: riskOverride.approvalTriggers || [],
    credentialPolicy: { ...DEFAULT_CREDENTIAL_POLICY },
    modelBudget: { ...DEFAULT_MODEL_BUDGET, ...(riskOverride.modelBudget || {}) },
    completionProof: ['Final answer, artifact, or exact blocker is present.'],
    failureClasses: DEFAULT_FAILURE_CLASSES,
    persistenceTargets: ['chat_message', 'agent_runs'],
    memoryUsePolicy: { ...DEFAULT_MEMORY_POLICY },
  };
}

function applyOverride(policy: ScenarioPolicy, override?: ScenarioPolicyOverride): ScenarioPolicy {
  if (!override) return policy;
  return {
    ...policy,
    ...override,
    credentialPolicy: { ...policy.credentialPolicy, ...(override.credentialPolicy || {}) },
    modelBudget: { ...policy.modelBudget, ...(override.modelBudget || {}) },
    memoryUsePolicy: { ...policy.memoryUsePolicy, ...(override.memoryUsePolicy || {}) },
  };
}

export function getScenarioPolicy(
  pipeline: Pick<UserTaskPipelineSummary, 'id' | 'risk' | 'approvalTriggers' | 'persistenceTargets' | 'completionCriteria'>,
): ScenarioPolicy {
  const base = buildBasePolicy(pipeline.id, pipeline.risk);
  const withPipelineData = {
    ...base,
    approvalTriggers: pipeline.approvalTriggers.length ? pipeline.approvalTriggers : base.approvalTriggers,
    completionProof: pipeline.completionCriteria.length ? pipeline.completionCriteria : base.completionProof,
    persistenceTargets: pipeline.persistenceTargets.length ? pipeline.persistenceTargets : base.persistenceTargets,
  };
  return applyOverride(withPipelineData, POLICY_OVERRIDES[pipeline.id]);
}

export function getScenarioPolicyForId(id: UserTaskPipelineId, risk: UserTaskPipelineRisk = 'safe'): ScenarioPolicy {
  return applyOverride(buildBasePolicy(id, risk), POLICY_OVERRIDES[id]);
}

export function summarizeScenarioPolicy(policy: ScenarioPolicy): string {
  return [
    `${policy.id}: ${policy.risk}`,
    `surfaces=${policy.preferredSurfaceOrder.join('>')}`,
    `approvals=${policy.approvalTriggers.length}`,
    `budget=$${policy.modelBudget.maxUsd.toFixed(2)}/${policy.modelBudget.maxSteps} steps`,
  ].join(' ');
}
