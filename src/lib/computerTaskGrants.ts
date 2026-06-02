import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import {
  isLowRiskLocalImageExportTask,
  type ComputerTaskPlanPreview,
} from './computerTaskPlanner';

export type ComputerTaskGrantId =
  | 'browser_navigation'
  | 'browser_side_effect'
  | 'file_read'
  | 'file_write'
  | 'app_read'
  | 'app_action'
  | 'mcp_tool'
  | 'bridge_tool';

export type ComputerTaskGrantLevel = 'read' | 'write' | 'action';

export interface ComputerTaskGrant {
  id: ComputerTaskGrantId;
  label: string;
  level: ComputerTaskGrantLevel;
  approvalRequired: boolean;
  reason: string;
}

export interface ComputerTaskGrantPlan {
  grants: ComputerTaskGrant[];
  granted: ComputerTaskGrantId[];
  outstanding: ComputerTaskGrant[];
  requiresApproval: boolean;
  summary: string;
  approvalSummary: string | null;
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function inferTaskRisk(task: string): {
  hasWriteIntent: boolean;
  hasActionIntent: boolean;
} {
  const normalized = String(task || '').toLowerCase();
  const googleDriveDesktopCopyIntent = /\b(?:google\s+drive|gdrive|my\s+drive)\b/.test(normalized)
    && /\b(?:open|launch|load|indesign|in\s*design|photoshop|illustrator)\b/.test(normalized);
  return {
    hasWriteIntent: googleDriveDesktopCopyIntent || includesAny(normalized, [
      'write',
      'edit',
      'save',
      'update',
      'change',
      'delete',
      'remove',
      'rename',
      'move',
      'create',
      'upload',
      'download',
      'replace',
      'patch',
    ]),
    hasActionIntent: includesAny(normalized, [
      'send',
      'post',
      'submit',
      'click',
      'log in',
      'login',
      'sign in',
      'checkout',
      'purchase',
      'buy',
      'pay',
      'launch',
      'run',
      'execute',
      'message',
      'email',
      'comment',
      'approve',
      'book',
      'schedule',
      'fill out',
    ]),
  };
}

function pushGrant(
  target: Map<ComputerTaskGrantId, ComputerTaskGrant>,
  grant: ComputerTaskGrant,
): void {
  if (!target.has(grant.id)) {
    target.set(grant.id, grant);
  }
}

function summarizeGrant(grant: ComputerTaskGrant): string {
  return grant.approvalRequired ? `${grant.label} (approval)` : grant.label;
}

export function buildComputerTaskGrantPlan(args: {
  task: string;
  preview: ComputerTaskPlanPreview;
  audit: ComputerCapabilityAudit | null;
  grantedIds?: ComputerTaskGrantId[];
}): ComputerTaskGrantPlan {
  const risk = inferTaskRisk(args.task);
  const lowRiskLocalImageExport = isLowRiskLocalImageExportTask(args.task);
  const grants = new Map<ComputerTaskGrantId, ComputerTaskGrant>();
  const grantedSet = new Set(args.grantedIds || []);
  const needsBrowserAutomation = args.preview.requiredCapabilities.includes('browser_automation') ||
    args.preview.requiredCapabilities.includes('browser_sessions');
  const needsFileAccess = args.preview.requiredCapabilities.includes('file_search') ||
    args.preview.requiredCapabilities.includes('file_read') ||
    args.preview.requiredCapabilities.includes('file_write');
  const needsFileWrite = args.preview.requiredCapabilities.includes('file_write');
  const needsAppAccess = args.preview.requiredCapabilities.includes('app_tools') ||
    args.preview.requiredCapabilities.includes('desktop_control') ||
    args.preview.requiredCapabilities.includes('agent_bridges');

  if (args.preview.kind === 'browser_task' || args.preview.kind === 'unknown' || needsBrowserAutomation) {
    pushGrant(grants, {
      id: 'browser_navigation',
      label: 'Browser navigation',
      level: 'read',
      approvalRequired: false,
      reason: 'The task may need website navigation, page reading, or screenshots.',
    });
  }

  if (args.preview.kind === 'browser_task' || needsBrowserAutomation) {
    if (risk.hasActionIntent || risk.hasWriteIntent) {
      pushGrant(grants, {
        id: 'browser_side_effect',
        label: 'Browser side effects',
        level: 'action',
        approvalRequired: true,
        reason: 'The task may submit forms, click through flows, log in, or make changes on websites.',
      });
    }
  }

  if (args.preview.kind === 'file_task' || args.preview.kind === 'unknown' || needsFileAccess) {
    pushGrant(grants, {
      id: 'file_read',
      label: 'File read access',
      level: 'read',
      approvalRequired: false,
      reason: 'The runtime prepares scoped local file access automatically before locating, listing, or inspecting files.',
    });
  }

  if (args.preview.kind === 'file_task' || needsFileAccess) {
    if (needsFileWrite) {
      pushGrant(grants, {
        id: 'file_write',
        label: 'File write access',
        level: 'write',
        approvalRequired: false,
        reason: 'The runtime prepares write-scoped local file access automatically before file edits, moves, renames, creates, deletes, or exports.',
      });
    }
  }

  if (args.preview.kind === 'app_task' || args.preview.kind === 'unknown' || needsAppAccess) {
    pushGrant(grants, {
      id: 'app_read',
      label: 'Connected app access',
      level: 'read',
      approvalRequired: false,
      reason: 'The task may need to inspect connected apps, integrations, or desktop surfaces.',
    });
  }

  if (args.preview.kind === 'app_task' || needsAppAccess) {
    if (risk.hasActionIntent || risk.hasWriteIntent) {
      pushGrant(grants, {
        id: 'app_action',
        label: 'Connected app actions',
        level: 'action',
        approvalRequired: !lowRiskLocalImageExport,
        reason: lowRiskLocalImageExport
          ? 'The task only opens a local image in Photoshop and exports a new PNG/JPEG through Save for Web.'
          : 'The task may send messages, create records, or make changes in a connected app.',
      });
    }
  }

  if (args.audit && args.audit.activeMcpToolCount > 0 && args.preview.kind !== 'browser_task') {
    pushGrant(grants, {
      id: 'mcp_tool',
      label: 'MCP tool execution',
      level: 'action',
      approvalRequired: true,
      reason: 'The runtime may need to call one or more MCP tools to complete this computer task.',
    });
  }

  if (args.audit && args.audit.activeBridgeProviders.length > 0 && args.preview.kind !== 'browser_task') {
    pushGrant(grants, {
      id: 'bridge_tool',
      label: 'Bridge-based agent access',
      level: 'action',
      approvalRequired: true,
      reason: 'The runtime may need to use a connected bridge or local agent surface to complete the task.',
    });
  }

  const ordered = Array.from(grants.values());
  const granted = ordered.filter((grant) => grantedSet.has(grant.id)).map((grant) => grant.id);
  const outstanding = ordered.filter((grant) => !grantedSet.has(grant.id));
  const approvalGrants = outstanding.filter((grant) => grant.approvalRequired);
  const grantedLabels = ordered.filter((grant) => grantedSet.has(grant.id)).map((grant) => grant.label);
  const requestedLabels = outstanding.map((grant) => summarizeGrant(grant));

  return {
    grants: ordered,
    granted,
    outstanding,
    requiresApproval: approvalGrants.length > 0,
    summary: ordered.length > 0
      ? grantedLabels.length > 0 && requestedLabels.length > 0
        ? `Access plan: granted ${grantedLabels.join(', ')}. Requested ${requestedLabels.join(', ')}.`
        : grantedLabels.length > 0
          ? `Access plan: granted ${grantedLabels.join(', ')}.`
          : `Access plan: ${requestedLabels.join(', ')}.`
      : 'Access plan: no explicit access scopes inferred yet.',
    approvalSummary: approvalGrants.length > 0
      ? `Approval recommended for: ${approvalGrants.map((grant) => grant.label.toLowerCase()).join(', ')}.`
      : null,
  };
}
