import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import { buildComputerAppPreflightPromptBlock, type ComputerAppPreflight } from './computerAppPreflight';
import type {
  ComputerAppGroundingNextStep,
  ComputerAppGroundingPlan,
  ComputerAppGroundingRunbook,
  ComputerAppGroundingTrace,
} from './computerAppGrounding';
import type { ComputerTaskGrantPlan } from './computerTaskGrants';
import type { ComputerTaskPlanPreview } from './computerTaskPlanner';
import { analyzeBrowserTask } from './browserTaskIntent';
import { chooseBrowserAutomationBackendPreference } from './browserAutomationBackend';
import { buildBrowserbaseWorkflowPromptBlock } from './browserbaseWorkflowIntent';
import {
  formatComputerTaskComplexityDispatchBlock,
  type ComputerTaskComplexityPlan,
} from './computerTaskComplexityPlan';
import { formatBusinessModelTaskBlock, type BusinessModelTaskPlan } from './businessModelProfileCore';
import { buildDesignAppAutomationPromptBlock } from './designAppAutomation';
import { buildDesignAppObjectManifestPromptBlock } from './designAppObjectManifest';
import { buildDesignAppOperationRunbookPromptBlock } from './designAppOperationRunbooks';
import { buildDesignAppProofReviewPromptBlock } from './designAppProofReview';
import { buildEngineeringCadOperationRunbookPromptBlock } from './engineeringCadOperationRunbooks';

function buildComputerAppGroundingDispatchBlock(args: {
  plan?: ComputerAppGroundingPlan | null;
  runbook?: ComputerAppGroundingRunbook | null;
  nextStep?: ComputerAppGroundingNextStep | null;
  trace?: ComputerAppGroundingTrace | null;
}): string | null {
  const plan = args.plan || null;
  if (!plan) return null;
  const nextStep = args.nextStep || args.trace?.nextStep || null;
  const trace = args.trace || null;
  const lines: string[] = [
    '## Computer/App Grounding',
    `Grounding strategy: ${plan.strategy.label} (${plan.strategy.id})`,
    `Primary surface: ${plan.primarySurface}`,
  ];
  if (trace) {
    lines.push(`Trace status: ${trace.status}`);
    lines.push(`Trace next action: ${trace.display.nextAction}`);
    lines.push(`Trace summary: ${trace.display.summary}`);
  } else if (nextStep) {
    lines.push(`Initial next action: ${nextStep.tool ? `${nextStep.kind}: ${nextStep.tool}` : nextStep.kind}`);
    lines.push(`Initial next action detail: ${nextStep.detail}`);
  }

  lines.push('Required observations before mutation:');
  const requiredRules = plan.observationRules.filter((item) => item.requiredBeforeAction);
  if (requiredRules.length > 0) {
    for (const rule of requiredRules) {
      lines.push(`- ${rule.id}: ${rule.tool} within ${rule.freshnessMs}ms. ${rule.reason}`);
    }
  } else {
    lines.push('- none; this strategy is read-only or observation-led.');
  }

  const optionalRules = plan.observationRules.filter((item) => !item.requiredBeforeAction);
  if (optionalRules.length > 0) {
    lines.push(`Optional observations: ${optionalRules.map((item) => `${item.id}:${item.tool}`).join(', ')}`);
  }

  if (args.runbook) {
    lines.push(`Runbook: ${args.runbook.steps.length} steps, max ${args.runbook.maxActionAttemptsBeforeRecovery} failed attempts before recovery.`);
  }

  lines.push('Action discipline:');
  for (const item of plan.actionDiscipline) lines.push(`- ${item}`);
  lines.push('Action readiness contract:');
  lines.push('- Every mutating action must cite sourceObservationIds for the relevant required observations.');
  lines.push('- Run the trace next action first; do not skip directly to clicking, typing, filling, dragging, submitting, deploying, or sending.');
  lines.push('- After a successful action, verify before taking another mutating action.');
  lines.push('- If the same action fails twice, switch to recovery instead of retrying.');
  lines.push(`Fallback chain: ${plan.fallbackChain.join(' -> ')}`);
  lines.push(`Approval gates: ${plan.approvalGates.length ? plan.approvalGates.join(' | ') : 'none for read-only work'}`);
  lines.push('Forbidden fallbacks:');
  for (const item of plan.forbiddenFallbacks) lines.push(`- ${item}`);
  lines.push(`Verification signals: ${plan.verificationSignals.join(' | ')}`);
  return lines.join('\n');
}

export function buildComputerTaskDispatchPrefix(args: {
  task: string;
  preview: ComputerTaskPlanPreview;
  readiness: {
    ready: boolean;
    missing: string[];
    summary: string;
  };
  audit: ComputerCapabilityAudit | null;
  grants: ComputerTaskGrantPlan;
  preflight?: ComputerAppPreflight | null;
  computerAppGrounding?: ComputerAppGroundingPlan | null;
  computerAppGroundingRunbook?: ComputerAppGroundingRunbook | null;
  computerAppGroundingNextStep?: ComputerAppGroundingNextStep | null;
  computerAppGroundingTrace?: ComputerAppGroundingTrace | null;
  complexityPlan?: ComputerTaskComplexityPlan | null;
  businessModelPlan?: BusinessModelTaskPlan | null;
}): string {
  const lines: string[] = [
    'COMPUTER TASK DISPATCH CONTEXT',
    `Task shape: ${args.preview.label}`,
    `Task detail: ${args.preview.detail}`,
    `Capability readiness: ${args.readiness.summary}`,
    args.grants.summary,
  ];

  const preflightBlock = buildComputerAppPreflightPromptBlock(args.preflight || null);
  if (preflightBlock) {
    lines.push(preflightBlock);
  }

  const groundingBlock = buildComputerAppGroundingDispatchBlock({
    plan: args.computerAppGrounding || null,
    runbook: args.computerAppGroundingRunbook || null,
    nextStep: args.computerAppGroundingNextStep || null,
    trace: args.computerAppGroundingTrace || null,
  });
  if (groundingBlock) {
    lines.push(groundingBlock);
  }

  const designAppBlock = buildDesignAppAutomationPromptBlock(args.task);
  if (designAppBlock) {
    lines.push(designAppBlock);
  }

  const designObjectManifestBlock = buildDesignAppObjectManifestPromptBlock(args.task);
  if (designObjectManifestBlock) {
    lines.push(designObjectManifestBlock);
  }

  const designOperationRunbookBlock = buildDesignAppOperationRunbookPromptBlock(args.task);
  if (designOperationRunbookBlock) {
    lines.push(designOperationRunbookBlock);
  }

  const designProofReviewBlock = buildDesignAppProofReviewPromptBlock(args.task);
  if (designProofReviewBlock) {
    lines.push(designProofReviewBlock);
  }

  const engineeringCadRunbookBlock = buildEngineeringCadOperationRunbookPromptBlock(args.task);
  if (engineeringCadRunbookBlock) {
    lines.push(engineeringCadRunbookBlock);
  }

  const complexityBlock = formatComputerTaskComplexityDispatchBlock(args.complexityPlan || null);
  if (complexityBlock) {
    lines.push(complexityBlock);
  }

  if (args.grants.approvalSummary) {
    lines.push(args.grants.approvalSummary);
  }

  if (args.preview.verificationGate) {
    lines.push(`Human verification guard: ${args.preview.verificationGate.label} detected. ${args.preview.verificationGate.pauseInstruction}`);
  }
  for (const note of args.preview.safetyNotes || []) {
    lines.push(`Safety note: ${note}`);
  }

  if (args.audit) {
    const readyFindings = args.audit.findings
      .filter((finding) => finding.status !== 'missing')
      .slice(0, 4)
      .map((finding) => `${finding.label} (${finding.status})`);
    if (readyFindings.length > 0) {
      lines.push(`Available surfaces: ${readyFindings.join(', ')}`);
    }
    if (args.audit.availableIntegrationProviders.length > 0) {
      lines.push(`Connected integrations: ${args.audit.availableIntegrationProviders.join(', ')}`);
    }
    if (args.audit.activeBridgeProviders.length > 0) {
      lines.push(`Active bridges: ${args.audit.activeBridgeProviders.join(', ')}`);
    }
    if (args.audit.activeMcpServerCount > 0) {
      lines.push(`Active MCP servers: ${args.audit.activeMcpServerCount} (${args.audit.activeMcpToolCount} tools discovered)`);
    }
  }

  const businessModelBlock = formatBusinessModelTaskBlock(args.businessModelPlan || null);
  if (businessModelBlock) {
    lines.push(businessModelBlock);
  }

  if (args.preview.browserbaseWorkflow && args.preview.browserbaseWorkflow.kind !== 'general_browser') {
    lines.push(buildBrowserbaseWorkflowPromptBlock(args.preview.browserbaseWorkflow));
  }

  const browserIntent = analyzeBrowserTask(args.task);
  const backendPreference = chooseBrowserAutomationBackendPreference(browserIntent);
  if (args.preview.kind === 'browser_task' || args.preview.kind === 'hybrid_task') {
    lines.push(`Browser backend policy: ${backendPreference.costTier === 'free_local' ? 'prefer local browser bridge' : 'prefer Browserbase/Stagehand'} — ${backendPreference.reason}`);
  }

  lines.push('Deterministic-first orchestration: if the request can be expressed as explicit desktop/browser/file steps, execute those steps exactly through the bridge before asking a model to invent actions.');
  lines.push('Model handoff rule: use model reasoning only for ambiguous visual targets, creative artifact generation, missing selectors after observation, summarizing observed state, or recovery after a deterministic action fails twice.');
  lines.push('Creative handoff rule: for image/asset creation, generate or route an image artifact when an image tool/model is available; for Photoshop/Figma/Canva editing, keep control in the desktop/browser bridge and use screenshots/a11y only to decide the next deterministic action.');

  if (args.preview.kind === 'file_task') {
    lines.push('Execution guidance: prioritize file location, file reading, folder scoping, and access clarification. Do not default to browser work unless the task clearly requires a website.');
  } else if (args.preview.kind === 'app_task') {
    lines.push('Execution guidance: prioritize connected apps, MCP tools, integrations, and bridges. Be explicit about missing access or missing connectors.');
  } else if (args.preview.kind === 'browser_task') {
    lines.push('Execution guidance: follow the browser backend policy, use DOM/role actions before screenshots or coordinates, keep domain scope tight, use vault-safe login instructions, and require explicit approval for form submission or external state changes.');
  } else if (args.preview.kind === 'hybrid_task') {
    lines.push('Execution guidance: break the task into ordered surfaces such as files, apps, and browser. State what you can do now, what access is missing, and the recommended next step.');
  } else {
    lines.push('Execution guidance: treat this as a general computer task and choose the least-destructive capable surface first.');
  }

  lines.push('Respect the access plan. If a step would need broader access than the granted scope, stop and say what additional grant or approval is required.');
  lines.push('If bot verification, CAPTCHA, MFA, or "I am not a robot" appears, do not click or solve it. Pause and ask the user to complete it manually, then continue after confirmation.');
  lines.push('If the required access is missing, say exactly what is missing and what the user should connect or grant instead of pretending the task already ran.');

  return lines.join('\n');
}
