import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import type { ComputerTaskGrantPlan } from './computerTaskGrants';
import type { ComputerTaskPlanPreview } from './computerTaskPlanner';
import { buildBrowserbaseWorkflowPromptBlock } from './browserbaseWorkflowIntent';

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
}): string {
  const lines: string[] = [
    'COMPUTER TASK DISPATCH CONTEXT',
    `Task shape: ${args.preview.label}`,
    `Task detail: ${args.preview.detail}`,
    `Capability readiness: ${args.readiness.summary}`,
    args.grants.summary,
  ];

  if (args.grants.approvalSummary) {
    lines.push(args.grants.approvalSummary);
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

  if (args.preview.browserbaseWorkflow && args.preview.browserbaseWorkflow.kind !== 'general_browser') {
    lines.push(buildBrowserbaseWorkflowPromptBlock(args.preview.browserbaseWorkflow));
  }

  if (args.preview.kind === 'file_task') {
    lines.push('Execution guidance: prioritize file location, file reading, folder scoping, and access clarification. Do not default to browser work unless the task clearly requires a website.');
  } else if (args.preview.kind === 'app_task') {
    lines.push('Execution guidance: prioritize connected apps, MCP tools, integrations, and bridges. Be explicit about missing access or missing connectors.');
  } else if (args.preview.kind === 'browser_task') {
    lines.push('Execution guidance: prioritize Browserbase/remote browser execution, visible checkpoints, domain scope, vault-safe login use, and explicit approvals for form submission or external state changes.');
  } else if (args.preview.kind === 'hybrid_task') {
    lines.push('Execution guidance: break the task into ordered surfaces such as files, apps, and browser. State what you can do now, what access is missing, and the recommended next step.');
  } else {
    lines.push('Execution guidance: treat this as a general computer task and choose the least-destructive capable surface first.');
  }

  lines.push('Respect the access plan. If a step would need broader access than the granted scope, stop and say what additional grant or approval is required.');
  lines.push('If the required access is missing, say exactly what is missing and what the user should connect or grant instead of pretending the task already ran.');

  return lines.join('\n');
}
