import type {
  ComputerCapabilityAudit,
  ComputerCapabilityId,
  ComputerCapabilityStatus,
} from './computerCapabilityRegistry';
import {
  buildComputerCapabilityExpansionPlan,
  type ComputerCapabilityExpansionPlan,
} from './computerCapabilityExpansion';
import {
  buildComputerAppTaskStrategy,
  type ComputerAppTaskStrategy,
  type ComputerAppStrategyId,
} from './computerAppTaskStrategy';
import { buildDesignAppAutomationPlan } from './designAppAutomation';
import {
  buildAppAutomationControlSurfacePlan,
  buildAppAutomationRouteDecision,
  deriveAuditObservedEvidence,
  formatAppAutomationRouteDecisionPromptBlock,
  type AppAutomationRouteDecision,
} from './appAutomationControlSurfaces';

export type ComputerAppPreflightSeverity = 'info' | 'warning' | 'blocker';

export interface ComputerAppPreflightItem {
  id: string;
  severity: ComputerAppPreflightSeverity;
  label: string;
  detail: string;
  fix: string;
}

export interface ComputerAppPreflight {
  strategy: ComputerAppTaskStrategy | null;
  requiredCapabilities: ComputerCapabilityId[];
  routeDecision: AppAutomationRouteDecision | null;
  capabilityExpansionPlan: ComputerCapabilityExpansionPlan | null;
  ready: boolean;
  status: 'ready' | 'partial' | 'blocked' | 'unknown';
  blockers: ComputerAppPreflightItem[];
  warnings: ComputerAppPreflightItem[];
  info: ComputerAppPreflightItem[];
  fixActions: string[];
  summary: string;
}

const STRATEGY_CAPABILITIES: Record<ComputerAppStrategyId, ComputerCapabilityId[]> = {
  browser_semantic: ['browser_automation'],
  credentialed_browser: ['browser_automation', 'browser_sessions'],
  approval_sensitive_browser: ['browser_automation', 'browser_sessions'],
  browser_file_transfer: ['browser_automation', 'browser_sessions', 'file_search', 'file_read', 'file_write'],
  agent_asset_acquisition: ['agent_bridges', 'file_search', 'file_read', 'file_write'],
  desktop_readonly: ['desktop_control'],
  desktop_semantic: ['desktop_control', 'app_tools'],
  productivity_app_control: ['desktop_control', 'app_tools'],
  desktop_canvas_vision: ['desktop_control', 'app_tools'],
  creative_layout_control: ['desktop_control', 'app_tools', 'file_search', 'file_read', 'file_write'],
  adobe_cc_control: ['desktop_control', 'app_tools', 'file_search', 'file_read', 'file_write', 'agent_bridges'],
  engineering_cad_control: ['desktop_control', 'app_tools', 'file_search', 'file_write'],
  universal_app_control: ['desktop_control', 'app_tools', 'agent_bridges'],
  document_data_workbench: ['file_search', 'file_read', 'app_tools'],
  ops_console_control: ['browser_automation', 'agent_bridges'],
  file_readonly: ['file_search', 'file_read'],
  terminal_agent_orchestration: ['agent_bridges', 'desktop_control'],
  human_verification_pause: ['browser_automation'],
  hybrid_control_loop: ['browser_automation', 'app_tools', 'agent_bridges'],
};

const CAPABILITY_FIX: Record<ComputerCapabilityId, string> = {
  browser_automation: 'Connect Browserbase or start the local browser bridge before running web automation.',
  browser_sessions: 'Use a persistent browser context or Browserbase session when login state must survive multiple steps.',
  file_search: 'Enable a filesystem-capable bridge/MCP tool and scope it to the folder the user approved.',
  file_read: 'Enable file read access through the desktop bridge or an approved filesystem MCP server.',
  file_write: 'Request explicit file-write approval and use a scoped workspace/folder before mutating files.',
  app_tools: 'Connect the app integration or start the desktop bridge so the runtime can inspect and control the target app.',
  agent_bridges: 'Start the matching local agent bridge for Codex, Claude Code, Gemini CLI, Cursor, or OpenSwan.',
  desktop_control: 'Start the local desktop bridge and grant macOS Accessibility/Screen Recording permissions when prompted.',
};

const CAPABILITY_LABEL: Record<ComputerCapabilityId, string> = {
  browser_automation: 'Browser automation',
  browser_sessions: 'Persistent browser sessions',
  file_search: 'File search',
  file_read: 'File read',
  file_write: 'File write',
  app_tools: 'App tools',
  agent_bridges: 'Agent bridges',
  desktop_control: 'Desktop/native app control',
};

const ROUTE_DECISION_STRATEGIES = new Set<ComputerAppStrategyId>([
  'browser_semantic',
  'credentialed_browser',
  'approval_sensitive_browser',
  'browser_file_transfer',
  'desktop_semantic',
  'productivity_app_control',
  'desktop_canvas_vision',
  'creative_layout_control',
  'adobe_cc_control',
  'engineering_cad_control',
  'universal_app_control',
  'hybrid_control_loop',
]);

function statusFor(audit: ComputerCapabilityAudit | null, capability: ComputerCapabilityId): ComputerCapabilityStatus | 'unknown' {
  if (!audit) return 'unknown';
  return audit.findings.find((finding) => finding.id === capability)?.status || 'missing';
}

function buildCapabilityItem(
  capability: ComputerCapabilityId,
  status: ComputerCapabilityStatus | 'unknown',
): ComputerAppPreflightItem {
  if (status === 'missing') {
    return {
      id: `missing:${capability}`,
      severity: 'blocker',
      label: `${CAPABILITY_LABEL[capability]} missing`,
      detail: `The selected execution strategy needs ${CAPABILITY_LABEL[capability].toLowerCase()}, but the capability audit does not show it as available.`,
      fix: CAPABILITY_FIX[capability],
    };
  }
  if (status === 'partial') {
    return {
      id: `partial:${capability}`,
      severity: 'warning',
      label: `${CAPABILITY_LABEL[capability]} partial`,
      detail: `The selected execution strategy can attempt this path, but ${CAPABILITY_LABEL[capability].toLowerCase()} is only partially available.`,
      fix: CAPABILITY_FIX[capability],
    };
  }
  if (status === 'unknown') {
    return {
      id: `unknown:${capability}`,
      severity: 'warning',
      label: `${CAPABILITY_LABEL[capability]} not checked`,
      detail: 'Capability audit has not run yet, so this should be treated as a preflight check before execution.',
      fix: CAPABILITY_FIX[capability],
    };
  }
  return {
    id: `ready:${capability}`,
    severity: 'info',
    label: `${CAPABILITY_LABEL[capability]} ready`,
    detail: `${CAPABILITY_LABEL[capability]} is available for this strategy.`,
    fix: 'No action needed.',
  };
}

function shouldBuildRouteDecision(strategy: ComputerAppTaskStrategy | null): strategy is ComputerAppTaskStrategy {
  return Boolean(strategy && ROUTE_DECISION_STRATEGIES.has(strategy.id));
}

function buildRouteDecisionItem(decision: AppAutomationRouteDecision): ComputerAppPreflightItem | null {
  if (decision.status === 'ready_to_execute') {
    return {
      id: 'route-decision:ready',
      severity: 'info',
      label: 'App route decision ready',
      detail: `${decision.targetName} can use ${decision.chosenSurface.label} for the next bounded step.`,
      fix: decision.nextSteps[0] || 'Execute the next bounded step, then verify.',
    };
  }
  if (decision.status === 'needs_observation') {
    return {
      id: 'route-decision:needs-observation',
      severity: 'warning',
      label: 'Fresh app evidence required',
      detail: `${decision.targetName} needs fresh evidence before using ${decision.chosenSurface.label}. Missing: ${decision.missingConfirmations.slice(0, 5).join(', ') || 'surface confirmation'}.`,
      fix: decision.nextSteps[0] || 'Collect fresh app/window/document evidence before mutation.',
    };
  }
  if (decision.status === 'needs_approval') {
    return {
      id: 'route-decision:needs-approval',
      severity: 'warning',
      label: 'App route approval required',
      detail: `${decision.targetName} needs approval before ${decision.missingApprovals.slice(0, 5).join(', ') || 'the selected app action'}.`,
      fix: decision.nextSteps[0] || 'Request approval before continuing.',
    };
  }
  if (decision.status === 'needs_user_action') {
    return {
      id: 'route-decision:needs-user-action',
      severity: 'blocker',
      label: 'User action required before app route',
      detail: decision.userActionBlockers.join(' | ') || `${decision.targetName} needs the user to unblock the app route.`,
      fix: decision.nextSteps[0] || 'Ask the user to clear the blocker, then re-run preflight.',
    };
  }
  if (decision.status === 'needs_connected_agent_buildout') {
    return {
      id: 'route-decision:needs-connected-agent-buildout',
      severity: 'blocker',
      label: 'Connected-agent app buildout required',
      detail: `${decision.targetName} does not have a ready deterministic route for this task.`,
      fix: decision.nextSteps[0] || 'Request a bounded connected-agent app capability buildout before retrying.',
    };
  }
  return null;
}

function buildStrategySpecificItems(strategy: ComputerAppTaskStrategy, task = ''): ComputerAppPreflightItem[] {
  const items: ComputerAppPreflightItem[] = [];
  if (['creative_layout_control', 'adobe_cc_control', 'engineering_cad_control', 'universal_app_control'].includes(strategy.id)) {
    const surfacePlan = buildAppAutomationControlSurfacePlan(task);
    items.push({
      id: 'control-surface:research-backed-order',
      severity: 'warning',
      label: 'Research-backed control surface order required',
      detail: `${surfacePlan.targetName} ${surfacePlan.taskFamily} tasks must choose the safest deterministic surface before falling back to desktop UI control.`,
      fix: `Use ${surfacePlan.candidates.slice(0, 3).map((surface) => surface.label).join(' -> ')} before coordinates; call agent.build_app_capability if those surfaces are missing.`,
    });
  }
  if (strategy.id === 'desktop_canvas_vision') {
    items.push({
      id: 'canvas:screenshot-before-click',
      severity: 'warning',
      label: 'Screenshot-before-coordinate rule',
      detail: 'Canvas apps like Photoshop/Figma require a fresh screenshot before every coordinate click or drag.',
      fix: 'Use desktop.screenshot and desktop.screen_size before desktop.click_at or desktop.mouse_drag.',
    });
  }
  if (strategy.id === 'creative_layout_control') {
    const designPlan = buildDesignAppAutomationPlan(task);
    if (designPlan?.appId === 'adobe_photoshop') {
      items.push(
        {
          id: 'photoshop:document-inventory-required',
          severity: 'warning',
          label: 'Photoshop document inventory required',
          detail: 'Layered image/composite edits need the active document, dimensions, color mode, layer names, text layers, masks, selections, smart objects, and linked assets before mutation.',
          fix: 'Use desktop.file_stat, desktop.open_path, desktop.photoshop_document_status, and desktop.photoshop_layer_inventory before editing layers, selections, masks, assets, or exports.',
        },
        {
          id: 'photoshop:destructive-edit-approval',
          severity: 'warning',
          label: 'Photoshop destructive edit approval required',
          detail: 'Generative fill, content-aware fill, flattening, rasterizing, deleting layers, saving over source files, and final exports can mutate production assets.',
          fix: 'Request approval before destructive pixel edits, generative/content-aware actions, save-over-source, or export, then verify with screenshot/raster proof and desktop.file_stat.',
        },
      );
    } else {
      items.push(
        {
          id: 'indesign:document-inventory-required',
          severity: 'warning',
          label: 'InDesign document inventory required',
          detail: 'Layered marketing-banner edits need the exact active document, layer count, text frames, links, fonts, locked/hidden layers, and overset state before mutation.',
          fix: 'Use desktop.file_stat, desktop.open_path, desktop.indesign_document_status, and desktop.indesign_text_inventory before editing text, links, layers, or exports.',
        },
        {
          id: 'indesign:script-first',
          severity: 'warning',
          label: 'Use script-backed InDesign tools first',
          detail: 'Named layer/text-frame updates should use InDesign DOM-backed bridge tools before accessibility clicks or visual coordinates.',
          fix: 'Prefer desktop.indesign_batch_update_text_layers, desktop.indesign_batch_find_change, or desktop.indesign_update_text_layer for copy changes.',
        },
        {
          id: 'indesign:save-export-approval',
          severity: 'warning',
          label: 'Save/export approval required',
          detail: 'Saving, exporting, packaging, relinking, or overwriting design deliverables can mutate production assets.',
          fix: 'Request approval and verify the output path with desktop.file_stat before save, export, package, relink, or overwrite.',
        },
      );
    }
  }
  if (strategy.id === 'adobe_cc_control') {
    items.push(
      {
        id: 'adobe-cc:profile-and-file-required',
        severity: 'warning',
        label: 'Adobe app profile and files required',
        detail: 'Broad Adobe Creative Cloud tasks need the exact app profile, source file/package, linked assets, and output folder resolved before control.',
        fix: 'Use desktop.file_search, desktop.file_stat, desktop.open_path, desktop.window_state, and desktop.screenshot before app mutation or export.',
      },
      {
        id: 'adobe-cc:capability-buildout-fallback',
        severity: 'warning',
        label: 'Adobe adapter buildout fallback',
        detail: 'If the target Adobe app lacks a native bridge adapter for the requested operation, the runtime should build the smallest reusable adapter before retrying.',
        fix: 'Use office.list_agents and agent.build_app_capability with the app name, file type, operation, control-surface candidate, and required smoke case.',
      },
    );
  }
  if (strategy.id === 'engineering_cad_control') {
    items.push(
      {
        id: 'engineering:precision-checkpoint',
        severity: 'warning',
        label: 'CAD precision checkpoint required',
        detail: 'CAD and engineering apps need the active document, units, scale, drawing origin, and current command state verified before geometry edits.',
        fix: 'Use desktop.window_state, desktop.read_a11y_tree, and desktop.screenshot before typed CAD commands or coordinate actions.',
      },
      {
        id: 'engineering:file-write-approval',
        severity: 'warning',
        label: 'CAD save/export approval required',
        detail: 'Creating, overwriting, or exporting engineering files can affect client, permit, manufacturing, or production deliverables.',
        fix: 'Verify the destination with desktop.file_search/stat and request approval before save, export, overwrite, macro, or plugin execution.',
      },
    );
  }
  if (strategy.id === 'universal_app_control') {
    items.push(
      {
        id: 'universal-app:discover-before-build',
        severity: 'warning',
        label: 'Unknown app discovery required',
        detail: 'Unfamiliar apps need app/window/a11y/screenshot discovery before the runtime decides whether generic controls are enough.',
        fix: 'Use desktop.window_state, desktop.read_a11y_tree, desktop.screenshot, and integrations.list before click/type/key actions.',
      },
      {
        id: 'universal-app:connected-agent-buildout',
        severity: 'warning',
        label: 'Connected-agent buildout fallback',
        detail: 'If no app recipe, adapter, bridge tool, or pipeline exists, the chat should delegate a bounded capability buildout to a connected agent instead of ending in plain chat.',
        fix: 'Use office.list_agents, then agent.build_app_capability with the target app, task, capability gap, and desired outcome.',
      },
    );
  }
  if (strategy.id === 'credentialed_browser') {
    items.push({
      id: 'credential:no-secret-output',
      severity: 'warning',
      label: 'Vault-safe credential use',
      detail: 'Credentialed browser workflows must fill secrets through vault-safe tools without returning raw passwords to the model.',
      fix: 'Use vault.resolve_for_task, vault.runbook, and browser.fill_credential_field when available.',
    });
  }
  if (strategy.id === 'approval_sensitive_browser') {
    items.push({
      id: 'browser:approval-before-side-effect',
      severity: 'warning',
      label: 'Approval before external browser side effect',
      detail: 'Bookings, purchases, CRM writes, public posts, finance changes, and external sends must be staged before final action.',
      fix: 'Use browser DOM state to prepare the change, then request approval before final submit/send/pay/publish.',
    });
  }
  if (strategy.id === 'agent_asset_acquisition') {
    items.push({
      id: 'agent-acquire:verify-before-use',
      severity: 'warning',
      label: 'Verify acquired files before use',
      detail: 'Codex may download or generate assets asynchronously. The workflow must verify exact local paths before uploading, opening, or editing those files.',
      fix: 'Use agent.codex_acquire_asset, then desktop.file_search/stat/read before any browser.upload_file or desktop app mutation.',
    });
  }
  if (strategy.id === 'productivity_app_control') {
    items.push({
      id: 'desktop:focus-before-type',
      severity: 'warning',
      label: 'Focus-before-type rule',
      detail: 'Productivity apps require confirming the active app, focused field, and destination before typing.',
      fix: 'Use desktop.window_state and desktop.read_a11y_tree before desktop.type_text or desktop.press_keys.',
    });
  }
  if (strategy.id === 'ops_console_control') {
    items.push({
      id: 'ops:read-first',
      severity: 'warning',
      label: 'Read-only diagnostics before ops mutation',
      detail: 'Cloud, deploy, and incident work must inspect logs/status before rollback, deploy, restart, scale, or secret changes.',
      fix: 'Run read-only checks first and request approval before production mutations.',
    });
  }
  if (strategy.id === 'document_data_workbench') {
    items.push({
      id: 'document:dry-run-before-write',
      severity: 'warning',
      label: 'Document/data dry-run before write',
      detail: 'Document extraction and imports need source references and a preview before upload, export, or database writes.',
      fix: 'Extract to an artifact first, validate fields, then request approval before external writes.',
    });
  }
  if (strategy.id === 'human_verification_pause') {
    items.push({
      id: 'verification:human-pause',
      severity: 'blocker',
      label: 'Human verification required',
      detail: 'CAPTCHA, MFA, OTP, bot checks, and Cloudflare gates must be completed by the user.',
      fix: 'Pause automation, tell the user what to complete, then re-check browser.verification_state after confirmation.',
    });
  }
  return items;
}

export function buildComputerAppPreflight(args: {
  task: string;
  audit: ComputerCapabilityAudit | null;
  strategy?: ComputerAppTaskStrategy | null;
}): ComputerAppPreflight {
  const strategy = args.strategy || buildComputerAppTaskStrategy(args.task);
  if (!strategy) {
    return {
      strategy: null,
      requiredCapabilities: [],
      routeDecision: null,
      capabilityExpansionPlan: null,
      ready: true,
      status: args.audit ? 'ready' : 'unknown',
      blockers: [],
      warnings: [],
      info: [],
      fixActions: [],
      summary: args.audit ? 'No computer/app execution strategy needed for this request.' : 'No computer/app strategy selected yet.',
    };
  }

  const requiredCapabilities = STRATEGY_CAPABILITIES[strategy.id] || [];
  const capabilityItems = requiredCapabilities.map((capability) => buildCapabilityItem(capability, statusFor(args.audit, capability)));
  const routeDecision = shouldBuildRouteDecision(strategy)
    // Feed the capability audit in as observed evidence so the decision reflects
    // what's actually connected (bridge, file grants) instead of reporting
    // needs_observation for infrastructure we already know is present.
    ? buildAppAutomationRouteDecision(args.task, { observedEvidence: deriveAuditObservedEvidence(args.audit) })
    : null;
  const capabilityExpansionPlan = buildComputerCapabilityExpansionPlan(args.task, args.audit);
  const routeDecisionItem = routeDecision ? buildRouteDecisionItem(routeDecision) : null;
  const strategyItems = buildStrategySpecificItems(strategy, args.task);
  const allItems = [...capabilityItems, ...strategyItems, routeDecisionItem].filter(Boolean) as ComputerAppPreflightItem[];
  const blockers = allItems.filter((item) => item.severity === 'blocker');
  const warnings = allItems.filter((item) => item.severity === 'warning');
  const info = allItems.filter((item) => item.severity === 'info');
  const fixActions = Array.from(new Set([...blockers, ...warnings].map((item) => item.fix)));
  const ready = blockers.length === 0 && requiredCapabilities.every((capability) => statusFor(args.audit, capability) === 'ready');
  const status: ComputerAppPreflight['status'] =
    blockers.length > 0 ? 'blocked' :
    warnings.length > 0 ? 'partial' :
    ready ? 'ready' :
    'unknown';
  const summary = `${strategy.label} preflight: ${status}. ${
    blockers.length > 0
      ? `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}: ${blockers.map((item) => item.label).join(', ')}.`
      : warnings.length > 0
        ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'} before execution.`
        : 'Required capabilities look ready.'
  }`;

  return {
    strategy,
    requiredCapabilities,
    routeDecision,
    capabilityExpansionPlan,
    ready,
    status,
    blockers,
    warnings,
    info,
    fixActions,
    summary,
  };
}

export function buildComputerAppPreflightPromptBlock(preflight: ComputerAppPreflight | null): string | null {
  if (!preflight?.strategy) return null;
  const lines = [
    '## Computer/App Preflight',
    preflight.summary,
    `Required capabilities: ${preflight.requiredCapabilities.join(', ') || 'none'}`,
  ];
  if (preflight.routeDecision) {
    lines.push(formatAppAutomationRouteDecisionPromptBlock(preflight.routeDecision));
  }
  if (preflight.capabilityExpansionPlan?.lanes.length) {
    const plan = preflight.capabilityExpansionPlan;
    const sourceRefs = Array.from(new Set(plan.lanes.flatMap((lane) => lane.officialSourceRefs))).slice(0, 6);
    lines.push(`Capability expansion lanes: ${plan.lanes.map((lane) => lane.id).join(', ')}`);
    lines.push(`Capability gaps: missing=${plan.missingCapabilities.join(', ') || 'none'}; partial_or_unknown=${plan.partialCapabilities.join(', ') || 'none'}`);
    if (sourceRefs.length > 0) {
      lines.push(`Expansion source refs: ${sourceRefs.join(' | ')}`);
    }
    lines.push('Expansion build actions:');
    for (const action of plan.nextBuildActions.slice(0, 5)) lines.push(`- ${action}`);
    lines.push(`Expansion verification: ${plan.verificationCommands.slice(0, 6).join(' | ')}`);
    lines.push(`User effort policy: ${plan.userEffortPolicy.join(' | ')}`);
  }
  if (preflight.blockers.length > 0) {
    lines.push('Blockers:');
    for (const item of preflight.blockers) lines.push(`- ${item.label}: ${item.fix}`);
  }
  if (preflight.warnings.length > 0) {
    lines.push('Warnings:');
    for (const item of preflight.warnings) lines.push(`- ${item.label}: ${item.fix}`);
  }
  if (preflight.fixActions.length > 0) {
    lines.push(`Fix actions: ${preflight.fixActions.join(' | ')}`);
  }
  lines.push('If preflight is blocked, do not pretend the task ran. Report the blocker and the exact fix action.');
  return lines.join('\n');
}
