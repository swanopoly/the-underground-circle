import { executeAgentRun, type AgentRunResult } from './agentRuntime';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { ComputerCapabilityAudit } from './computerCapabilityRegistry';
import {
  prepareComputerTaskExecution,
  type ComputerTaskExecutionEnvelope,
} from './computerTaskExecution';
import { executeComputerFileTask } from './computerFileAdapter';
import { executeComputerAppTask } from './computerAppAdapter';
import { shouldRunLocalComputerAwarenessIntentSequence } from './localComputerAwarenessIntent';
import { listApiKeys } from './llmProviders';
import {
  buildAgentAppCapabilityGapSummary,
  buildAgentAppCapabilityRetryPrompt,
  formatAgentAppCapabilityBuildoutForUser,
  inferAppNameForCapabilityBuildout,
  parseAgentAppCapabilityBuildoutResult,
  parseAgentAppCapabilityBuildoutResultFromSession,
  shouldRequestAgentAppCapabilityBuildoutFromOutcome,
} from './agentAppCapabilityBuildout';
import {
  loadCircleBusinessModelProfiles,
  buildImplicitBusinessModelProfiles,
  planBusinessModelForComputerTask,
  type BusinessModelTaskPlan,
} from './businessModelProfiles';
import type { ComputerTaskCapabilityBuildout } from './computerTaskState';
import {
  DESKTOP_ATTACHMENT_TASK_MARKER,
  parseDesktopAttachmentTaskFiles,
  selectDesktopAttachmentsToPreOpen,
} from './chatDesktopAttachmentRouting';
import { openPath as bridgeOpenPath, waitForApp as bridgeWaitForApp } from './desktopBridge';
import {
  formatGenericAppNavigatorPromptBlock,
  shouldUseGenericAppNavigator,
} from './genericAppNavigator';
import {
  buildObserveBeforeActPromptBlock,
  deriveAuditObservedEvidence,
} from './appAutomationControlSurfaces';

export type ComputerTaskRuntimeAdapterId =
  | 'browser_adapter'
  | 'file_adapter'
  | 'app_adapter'
  | 'hybrid_adapter';

export interface ComputerTaskRuntimeResult {
  adapterId: ComputerTaskRuntimeAdapterId;
  execution: ComputerTaskExecutionEnvelope;
  response: string;
  runId?: string | null;
  modeOutcomeSummary?: AgentRunResult['modeOutcomeSummary'];
  observedEval?: OpenSwanObservedEvalSummary | null;
  handoffSuggestion?: AgentRunResult['handoffSuggestion'];
  capabilityBuildout?: ComputerTaskCapabilityBuildout | null;
  warnings: string[];
}

/**
 * Detects whether an app-task utterance has follow-up work beyond the
 * initial launch. "open Zoom" → false (we can short-circuit after
 * launching). "open Notes and create a note" → true (the agent needs
 * to keep going after launch). Conservative: any conjunction, any
 * action verb beyond open/launch/start/switch, or any "and then" / "then"
 * counts as follow-up.
 *
 * Exported for smoke tests — keeps the classifier pinned.
 */
export function hasFollowUpIntent(task: string): boolean {
  const lower = String(task || '').trim().toLowerCase();
  if (!lower) return false;
  if (/\b(then|and then|after|next|also|,)\b/i.test(lower)) return true;
  if (/\band\s+(?!(?:i|i'?m|the|a|an)\b)\w/i.test(lower)) return true;
  // Action verbs that imply work INSIDE the app — not just launching it.
  if (/\b(create|write|type|make|draft|send|post|compose|record|start a|new|save|crop|edit|resize|export|draw|paint|generate|render|retouch)\b/i.test(lower)) return true;
  // "with" / "about" / "for" + object — usually describes follow-up content.
  if (/\b(with|about|for)\s+\w+/i.test(lower) && lower.length > 25) return true;
  return false;
}

function shouldRequestConnectedAppCapabilityBuildout(args: {
  execution: ComputerTaskExecutionEnvelope;
  task: string;
  agentResponse?: string | null;
  errorMessage?: string | null;
  appAdapterMessage?: string | null;
}): boolean {
  return shouldRequestAgentAppCapabilityBuildoutFromOutcome({
    strategyId: args.execution.computerAppGrounding?.strategy.id || args.execution.preflight.strategy?.id || null,
    agentResponse: args.agentResponse,
    errorMessage: args.errorMessage,
    appAdapterMessage: args.appAdapterMessage,
  });
}

function visibleCapabilityBuildoutMessage(buildout: ComputerTaskCapabilityBuildout | null | undefined): string {
  return formatAgentAppCapabilityBuildoutForUser(buildout);
}

async function requestConnectedAppCapabilityBuildout(args: {
  circleId: string;
  userId: string;
  task: string;
  execution: ComputerTaskExecutionEnvelope;
  appAdapterMessage?: string | null;
  agentResponse?: string | null;
  errorMessage?: string | null;
  warnings?: string[];
}): Promise<ComputerTaskCapabilityBuildout | null> {
  if (!shouldRequestConnectedAppCapabilityBuildout({
    execution: args.execution,
    task: args.task,
    agentResponse: args.agentResponse,
    errorMessage: args.errorMessage,
    appAdapterMessage: args.appAdapterMessage,
  })) {
    return null;
  }

  try {
    const { executeOpenSwanRuntimeTool } = await import('./openswanToolRuntime');
    const context = {
      circleId: args.circleId,
      userId: args.userId,
      surface: 'main_chat' as const,
    };
    const roster = await executeOpenSwanRuntimeTool('office.list_agents', {}, context).catch((error: any) => ({
      ok: false,
      resultsText: error?.message || 'Could not inspect connected agents.',
    }));
    const capabilityGap = buildAgentAppCapabilityGapSummary({
      strategyId: args.execution.computerAppGrounding?.strategy.id || args.execution.preflight.strategy?.id || null,
      previewLabel: args.execution.preview.label,
      previewKind: args.execution.preview.kind,
      appAdapterMessage: args.appAdapterMessage,
      agentResponse: args.agentResponse,
      errorMessage: args.errorMessage,
      warnings: args.warnings,
    });
    const buildout = await executeOpenSwanRuntimeTool('agent.build_app_capability', {
      task: args.task,
      appName: inferAppNameForCapabilityBuildout(args.task),
      capabilityGap,
      desiredOutcome: 'Chat/SwanBot can retry this unfamiliar app task through a reusable app recipe, adapter, bridge tool, or planner route after approval.',
      currentPlanSummary: [
        args.execution.preflight.summary,
        args.execution.computerAppGroundingTrace?.display.summary,
        args.execution.computerAppGroundingTrace?.display.nextAction
          ? `Next grounding action: ${args.execution.computerAppGroundingTrace.display.nextAction}`
          : '',
      ].filter(Boolean).join('\n'),
      launchIfMissing: true,
    }, context);
    const buildoutAny = buildout as any;
    const approvalRequest = buildoutAny.approvalRequest as { id?: string; status?: string } | undefined;
    const parsedResult = parseAgentAppCapabilityBuildoutResult(String(buildout.resultsText || ''));
    const rosterText = roster?.ok && roster.resultsText
      ? `Connected agents checked: ${String(roster.resultsText).split('\n').slice(0, 3).join(' | ')}`
      : `Connected agents check: ${String(roster?.resultsText || 'unavailable')}`;
    const status: ComputerTaskCapabilityBuildout['status'] = approvalRequest
      ? 'approval_required'
      : parsedResult.status === 'ready_to_retry'
        ? 'ready_to_retry'
      : parsedResult.status === 'blocked'
        ? 'blocked'
      : parsedResult.status === 'incomplete'
        ? 'incomplete'
      : buildout.ok
        ? 'requested'
        : 'failed';
    const message = [
      '**Connected-agent capability buildout**',
      rosterText,
      String(buildout.resultsText || 'Buildout request submitted.'),
    ].join('\n');
    return {
      status,
      message,
      appName: buildout.appName || inferAppNameForCapabilityBuildout(args.task) || null,
      buildoutKind: buildout.buildoutKind || null,
      risk: buildout.risk || null,
      sessionId: buildout.sessionId || null,
      launched: typeof buildout.launched === 'boolean' ? buildout.launched : null,
      approvalId: approvalRequest?.id || null,
      retryPlan: parsedResult.retryPlan || 'Retry the same chat task after the connected agent returns APP_CAPABILITY_SUMMARY and VERIFICATION, or after approving the pending buildout request.',
      summary: parsedResult.summary,
      controlSurface: parsedResult.controlSurface,
      sourceRefs: parsedResult.sourceRefs,
      filesChanged: parsedResult.filesChanged,
      verification: parsedResult.verification,
      userActionNeeded: parsedResult.userActionNeeded,
      missingEvidence: parsedResult.missingEvidence,
      updatedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    return {
      status: 'failed',
      message: [
        '**Connected-agent capability buildout**',
        `Buildout handoff failed: ${error?.message || String(error)}`,
      ].join('\n'),
      appName: inferAppNameForCapabilityBuildout(args.task) || null,
      buildoutKind: null,
      risk: null,
      sessionId: null,
      launched: null,
      approvalId: null,
      retryPlan: 'Fix the connected-agent handoff blocker, then retry the same chat task.',
      updatedAt: new Date().toISOString(),
    };
  }
}

async function retryComputerTaskAfterReadyCapabilityBuildout(args: {
  task: string;
  circleId: string;
  userId: string;
  userName?: string;
  model?: string;
  execution: ComputerTaskExecutionEnvelope;
  capabilityBuildout: ComputerTaskCapabilityBuildout | null | undefined;
  appAdapterMessage?: string | null;
  chatHistory?: string;
  sessionArchiveContext?: string;
  replyTo?: string;
}): Promise<{
  response?: string;
  runId?: string | null;
  modeOutcomeSummary?: AgentRunResult['modeOutcomeSummary'];
  observedEval?: OpenSwanObservedEvalSummary | null;
  handoffSuggestion?: AgentRunResult['handoffSuggestion'];
  warning?: string;
} | null> {
  if (args.capabilityBuildout?.status !== 'ready_to_retry') return null;

  const prompt = buildAgentAppCapabilityRetryPrompt({
    task: args.task,
    appName: args.capabilityBuildout.appName,
    summary: args.capabilityBuildout.summary,
    controlSurface: args.capabilityBuildout.controlSurface,
    sourceRefs: args.capabilityBuildout.sourceRefs,
    filesChanged: args.capabilityBuildout.filesChanged,
    retryPlan: args.capabilityBuildout.retryPlan,
    verification: args.capabilityBuildout.verification,
    appAdapterMessage: args.appAdapterMessage,
    dispatchPrefix: args.execution.dispatchPrefix,
  });

  try {
    const retryResult = await executeAgentRun({
      surface: 'main_chat',
      circleId: args.circleId,
      userId: args.userId,
      userName: args.userName,
      prompt,
      model: args.model,
      mode: args.execution.recommendedMode,
      capabilityProfile: args.execution.capabilityProfile,
      context: {
        chatHistory: args.chatHistory,
        sessionArchiveContext: args.sessionArchiveContext,
        replyTo: args.replyTo,
      },
    });
    const response = String(retryResult.response || '').trim()
      || '(The retry after app capability buildout completed, but it did not return follow-up text.)';
    return {
      response: `**Retried after connected app capability buildout**\n\n${response}`,
      runId: retryResult.runId,
      modeOutcomeSummary: retryResult.modeOutcomeSummary,
      observedEval: retryResult.observedEval,
      handoffSuggestion: retryResult.handoffSuggestion,
    };
  } catch (error: any) {
    return {
      warning: `capability buildout retry failed: ${error?.message || String(error)}`,
    };
  }
}

export async function refreshComputerTaskCapabilityBuildoutFromCodexSession(
  current: ComputerTaskCapabilityBuildout | null | undefined,
): Promise<ComputerTaskCapabilityBuildout | null> {
  if (!current?.sessionId) return null;
  if (current.status !== 'requested') return null;
  const { fetchCodexSessions } = await import('./codexDetector');
  const sessions = await fetchCodexSessions().catch(() => []);
  const target = sessions.find((session) =>
    session.sessionId === current.sessionId
    || session.sessionId.startsWith(current.sessionId || '')
    || (current.sessionId || '').startsWith(session.sessionId)
  );
  const parsed = parseAgentAppCapabilityBuildoutResultFromSession(target);
  if (!parsed || (parsed.status !== 'ready_to_retry' && parsed.status !== 'blocked' && parsed.status !== 'incomplete')) return null;
  return {
    ...current,
    status: parsed.status,
    summary: parsed.summary || current.summary || null,
    controlSurface: parsed.controlSurface || current.controlSurface || null,
    sourceRefs: parsed.sourceRefs.length > 0 ? parsed.sourceRefs : current.sourceRefs || [],
    filesChanged: parsed.filesChanged.length > 0 ? parsed.filesChanged : current.filesChanged || [],
    retryPlan: parsed.retryPlan || current.retryPlan || null,
    verification: parsed.verification || current.verification || null,
    userActionNeeded: parsed.userActionNeeded || current.userActionNeeded || null,
    missingEvidence: parsed.missingEvidence.length > 0 ? parsed.missingEvidence : current.missingEvidence || [],
    message: [
      current.message,
      '**Connected-agent capability result detected**',
      parsed.summary || parsed.verification || parsed.userActionNeeded || parsed.retryPlan || parsed.missingEvidence.join(', ') || 'Capability buildout session returned a parseable result.',
    ].filter(Boolean).join('\n'),
    updatedAt: new Date().toISOString(),
  };
}

function adapterIdForKind(kind: ComputerTaskExecutionEnvelope['preview']['kind']): ComputerTaskRuntimeAdapterId {
  switch (kind) {
    case 'file_task':
      return 'file_adapter';
    case 'app_task':
      return 'app_adapter';
    case 'hybrid_task':
      return 'hybrid_adapter';
    case 'browser_task':
    case 'unknown':
    default:
      return 'browser_adapter';
  }
}

/**
 * Observe-before-act: read the live desktop/app surface state (read-only)
 * before the agent is allowed to act, so it starts from ground truth instead of
 * only being told to go look. Fail-open by design — if the bridge isn't
 * connected (audit says so), or the read fails, we return [] and the caller
 * falls back to the existing prose directive. NEVER mutates anything.
 */
async function captureLiveSurfaceObservations(audit: ComputerCapabilityAudit | null): Promise<string[]> {
  const bridgeReady = audit?.findings?.find((finding) => finding.id === 'desktop_control')?.status === 'ready';
  if (!bridgeReady) return [];
  try {
    const { getWindowState } = await import('./desktopBridge');
    const win = await getWindowState();
    if (!win.ok || !win.data) return [];
    const observations: string[] = [];
    if (win.data.frontmostApp) observations.push(`Frontmost app: ${win.data.frontmostApp}`);
    if (win.data.activeWindowTitle) observations.push(`Active window: ${win.data.activeWindowTitle}`);
    if (Array.isArray(win.data.windows) && win.data.windows.length > 0) {
      observations.push(`Open windows: ${win.data.windows.slice(0, 8).join(', ')}`);
    }
    return observations;
  } catch {
    return []; // fail open — never block a task because observation failed
  }
}

export async function executeComputerTaskWithAgent(args: {
  task: string;
  circleId: string;
  userId: string;
  userName?: string;
  model?: string;
  audit: ComputerCapabilityAudit | null;
  grantedIds?: import('./computerTaskGrants').ComputerTaskGrantId[];
  businessModelPlan?: BusinessModelTaskPlan | null;
  chatHistory?: string;
  sessionArchiveContext?: string;
  replyTo?: string;
  readyCapabilityBuildout?: ComputerTaskCapabilityBuildout | null;
  disableCapabilityBuildout?: boolean;
}): Promise<ComputerTaskRuntimeResult> {
  const previewForRouting = prepareComputerTaskExecution({
    task: args.task,
    audit: args.audit,
    grantedIds: args.grantedIds,
  }).preview;
  const businessModelPlan = args.businessModelPlan || await (async () => {
    const [businessProfiles, providerKeys] = await Promise.all([
      loadCircleBusinessModelProfiles(args.circleId).catch(() => []),
      listApiKeys().catch(() => []),
    ]);
    return planBusinessModelForComputerTask({
      task: args.task,
      preview: previewForRouting,
      profiles: [...businessProfiles, ...buildImplicitBusinessModelProfiles(providerKeys)],
      providerKeys,
    });
  })();
  const execution = prepareComputerTaskExecution({
    task: args.task,
    audit: args.audit,
    grantedIds: args.grantedIds,
    businessModelPlan,
  });
  const readyCapabilityBuildout = args.readyCapabilityBuildout?.status === 'ready_to_retry'
    ? args.readyCapabilityBuildout
    : null;
  const canRequestCapabilityBuildout = !args.disableCapabilityBuildout && !readyCapabilityBuildout;
  const isAttachedDesktopFileTask = args.task.includes(DESKTOP_ATTACHMENT_TASK_MARKER);
  const attachedDesktopFiles = isAttachedDesktopFileTask ? parseDesktopAttachmentTaskFiles(args.task) : [];

  const warnings: string[] = [];
  if (!execution.readiness.ready && execution.readiness.missing.length > 0) {
    warnings.push(execution.readiness.summary);
  }
  if (execution.preflight.status !== 'ready') {
    warnings.push(execution.preflight.summary);
    warnings.push(...execution.preflight.blockers.map((item) => `${item.label}: ${item.fix}`));
    warnings.push(...execution.preflight.warnings.map((item) => `${item.label}: ${item.fix}`));
  }
  if (execution.grants.approvalSummary) {
    warnings.push(execution.grants.approvalSummary);
  }

  // Deterministic local desktop sequences should execute locally even
  // when the preview labels the utterance "hybrid" because it mentions
  // both an app and a filename, e.g. "Open Photoshop and save the image
  // as test-it.jpg". Ready app-capability retries must still use the
  // capability-aware prompt so the newly built adapter context is tested.
  if (!isAttachedDesktopFileTask && shouldRunLocalComputerAwarenessIntentSequence(args.task, { hasReadyCapabilityBuildout: Boolean(readyCapabilityBuildout) })) {
    const appResult = await executeComputerAppTask({
      circleId: args.circleId,
      task: args.task,
    });
    return {
      adapterId: 'app_adapter',
      execution,
      response: appResult.message,
      warnings: [...warnings, ...appResult.warnings],
    };
  }

  if (execution.preview.kind === 'file_task') {
    const fileResult = await executeComputerFileTask({
      circleId: args.circleId,
      task: args.task,
    });
    return {
      adapterId: 'file_adapter',
      execution,
      response: fileResult.message,
      warnings: [...warnings, ...fileResult.warnings],
    };
  }

  // UC-5 follow-up: "open Notes and create a note" was returning right
  // after the bridge launch because appResult.ok short-circuited the
  // runtime. That's correct for pure-launch intents ("open Zoom") but
  // wrong for multi-verb requests where the user wants follow-up
  // actions inside the app. Detect the difference and let multi-intent
  // utterances fall through to the agent loop (which has desktop.*
  // tools and can press Cmd+N / type / etc.).
  let appAdapterMessage: string | null = null;
  let appBridgeLaunched = false;
  if (execution.preview.kind === 'app_task') {
    const appResult = await executeComputerAppTask({
      circleId: args.circleId,
      task: args.task,
    });
    warnings.push(...appResult.warnings);
    if (appResult.ok) {
      const hasFollowUp = hasFollowUpIntent(args.task);
      const wasBridgeLaunch = (appResult.data as any)?.kind === 'desktop_bridge_launch';
      if (!hasFollowUp && !readyCapabilityBuildout) {
        // Pure launch — return the bridge result as-is, no agent needed.
        return {
          adapterId: 'app_adapter',
          execution,
          response: appResult.message,
          warnings,
        };
      }
      // Multi-intent: remember that the launch already happened (or at
      // least tried to) so the agent prompt can skip re-launching.
      appAdapterMessage = appResult.message;
      appBridgeLaunched = wasBridgeLaunch;
    }
  }
  if (attachedDesktopFiles.length > 0) {
    const openMessages: string[] = [];
    let openedAnyAttachedFile = false;
    for (const file of selectDesktopAttachmentsToPreOpen(attachedDesktopFiles, args.task, 4)) {
      const opened = await bridgeOpenPath(file.localPath, file.appName ? { appName: file.appName } : {});
      if (!opened.ok) {
        warnings.push(`uploaded file open failed for ${file.name}: ${opened.error || opened.errorCode || 'unknown bridge error'}`);
        openMessages.push(`Could not pre-open **${file.name}** at **${file.localPath}**: ${opened.error || opened.errorCode || 'unknown bridge error'}.`);
        continue;
      }
      if (file.appName) {
        await bridgeWaitForApp(file.appName, 12_000).catch(() => null);
      }
      openedAnyAttachedFile = true;
      openMessages.push(`Pre-opened uploaded file **${file.name}** at **${opened.data?.path || file.localPath}**${file.appName ? ` in **${file.appName}**` : ''}.`);
    }
    if (openMessages.length > 0) {
      appAdapterMessage = [appAdapterMessage, ...openMessages].filter(Boolean).join('\n');
      appBridgeLaunched = appBridgeLaunched || openedAnyAttachedFile;
    }
  }

  const shouldInjectGenericNavigator =
    execution.preflight.strategy?.id === 'universal_app_control'
    || execution.computerAppGrounding?.strategy.id === 'universal_app_control'
    || shouldUseGenericAppNavigator(args.task);
  const genericNavigatorPreamble = shouldInjectGenericNavigator
    ? `${formatGenericAppNavigatorPromptBlock(args.task)}\n\n`
    : '';
  const followUpPreamble = appAdapterMessage
    ? `Bridge already ${appBridgeLaunched ? 'launched the target app' : 'attempted the app action'}: ${appAdapterMessage}\n`
      + 'Continue from there — use desktop.wait_for_app / desktop.window_state / desktop.read_a11y_tree / desktop.menu_click / desktop.click_element / desktop.set_element_value / desktop.press_keys / desktop.type_text as needed. Do NOT re-launch.\n\n'
      + genericNavigatorPreamble
    : genericNavigatorPreamble;
  // Observe-before-act: for desktop/app surfaces, read the live state and hand
  // the agent the re-decided ground truth before it acts. Skipped for
  // capability-buildout retries (own prompt) and non-desktop task shapes;
  // fail-open if the bridge can't observe.
  let observeBeforeActBlock = '';
  if (
    !readyCapabilityBuildout
    && (execution.preview.kind === 'app_task' || execution.preview.kind === 'hybrid_task')
  ) {
    const liveObservations = await captureLiveSurfaceObservations(args.audit);
    if (liveObservations.length > 0) {
      const block = buildObserveBeforeActPromptBlock(args.task, liveObservations, {
        auditEvidence: deriveAuditObservedEvidence(args.audit),
      });
      if (block) observeBeforeActBlock = `${block}\n\n`;
    }
  }
  const prompt = readyCapabilityBuildout
    ? buildAgentAppCapabilityRetryPrompt({
        task: args.task,
        appName: readyCapabilityBuildout.appName,
        summary: readyCapabilityBuildout.summary,
        controlSurface: readyCapabilityBuildout.controlSurface,
        sourceRefs: readyCapabilityBuildout.sourceRefs,
        filesChanged: readyCapabilityBuildout.filesChanged,
        retryPlan: readyCapabilityBuildout.retryPlan,
        verification: readyCapabilityBuildout.verification,
        appAdapterMessage,
        dispatchPrefix: execution.dispatchPrefix,
      })
    : `${execution.dispatchPrefix}\n${observeBeforeActBlock}${followUpPreamble}USER COMPUTER TASK\n${args.task}`;

  // Belt-and-suspenders: if executeAgentRun throws (provider outage,
  // v2 continuation cap, model returns null), we still need to surface
  // SOMETHING to the user — otherwise the chat renders empty ("just
  // refreshed the chat" bug). Capture + fall back to a message that
  // at least confirms the bridge launch and names the error.
  let result: AgentRunResult;
  try {
    result = await executeAgentRun({
      surface: 'main_chat',
      circleId: args.circleId,
      userId: args.userId,
      userName: args.userName,
      prompt,
      model: args.model,
      mode: execution.recommendedMode,
      capabilityProfile: execution.capabilityProfile,
      context: {
        chatHistory: args.chatHistory,
        sessionArchiveContext: args.sessionArchiveContext,
        replyTo: args.replyTo,
      },
    });
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    warnings.push(`agent follow-up failed: ${errMsg}`);
    const capabilityBuildout = canRequestCapabilityBuildout
      ? await requestConnectedAppCapabilityBuildout({
          circleId: args.circleId,
          userId: args.userId,
          task: args.task,
          execution,
          appAdapterMessage,
          errorMessage: errMsg,
          warnings,
        })
      : readyCapabilityBuildout;
    const retryAttempt = await retryComputerTaskAfterReadyCapabilityBuildout({
      task: args.task,
      circleId: args.circleId,
      userId: args.userId,
      userName: args.userName,
      model: args.model,
      execution,
      capabilityBuildout,
      appAdapterMessage,
      chatHistory: args.chatHistory,
      sessionArchiveContext: args.sessionArchiveContext,
      replyTo: args.replyTo,
    });
    if (retryAttempt?.warning) warnings.push(retryAttempt.warning);
    if (retryAttempt?.response) {
      const retriedAt = new Date().toISOString();
      const retriedCapabilityBuildout = capabilityBuildout
        ? {
            ...capabilityBuildout,
            autoRetryStatus: 'completed' as const,
            autoRetryAttemptedAt: capabilityBuildout.autoRetryAttemptedAt || retriedAt,
            autoRetryCompletedAt: retriedAt,
            autoRetryRunId: retryAttempt.runId || capabilityBuildout.autoRetryRunId || null,
            updatedAt: retriedAt,
          }
        : capabilityBuildout;
      return {
        adapterId: adapterIdForKind(execution.preview.kind),
        execution,
        response: [visibleCapabilityBuildoutMessage(retriedCapabilityBuildout), retryAttempt.response].filter(Boolean).join('\n\n'),
        runId: retryAttempt.runId || null,
        modeOutcomeSummary: retryAttempt.modeOutcomeSummary,
        observedEval: retryAttempt.observedEval,
        handoffSuggestion: retryAttempt.handoffSuggestion,
        capabilityBuildout: retriedCapabilityBuildout,
        warnings,
      };
    }
    const fallback = appAdapterMessage
      ? `${appAdapterMessage}\n\n**Agent follow-up failed:** ${errMsg}\n\nThe app opened, but I couldn't complete the rest of the task. Try again or break it into smaller steps.`
      : `Agent follow-up failed: ${errMsg}`;
    return {
      adapterId: adapterIdForKind(execution.preview.kind),
      execution,
      response: [fallback, visibleCapabilityBuildoutMessage(capabilityBuildout)].filter(Boolean).join('\n\n'),
      runId: null,
      capabilityBuildout,
      warnings,
    };
  }

  // Another silent-failure gap: executeAgentRun can return an empty
  // string when every provider tier punts. Keep the bridge-launch
  // message visible so the user isn't looking at a blank bubble.
  const agentResponse = String(result.response || '').trim();
  const capabilityBuildout = canRequestCapabilityBuildout
    ? await requestConnectedAppCapabilityBuildout({
        circleId: args.circleId,
        userId: args.userId,
        task: args.task,
        execution,
        appAdapterMessage,
        agentResponse,
        warnings,
      })
    : readyCapabilityBuildout;
  const retryAttempt = await retryComputerTaskAfterReadyCapabilityBuildout({
    task: args.task,
    circleId: args.circleId,
    userId: args.userId,
    userName: args.userName,
    model: args.model,
    execution,
    capabilityBuildout,
    appAdapterMessage,
    chatHistory: args.chatHistory,
    sessionArchiveContext: args.sessionArchiveContext,
    replyTo: args.replyTo,
  });
  if (retryAttempt?.warning) warnings.push(retryAttempt.warning);
  if (retryAttempt?.response) {
    const retriedAt = new Date().toISOString();
    const retriedCapabilityBuildout = capabilityBuildout
      ? {
          ...capabilityBuildout,
          autoRetryStatus: 'completed' as const,
          autoRetryAttemptedAt: capabilityBuildout.autoRetryAttemptedAt || retriedAt,
          autoRetryCompletedAt: retriedAt,
          autoRetryRunId: retryAttempt.runId || capabilityBuildout.autoRetryRunId || null,
          updatedAt: retriedAt,
        }
      : capabilityBuildout;
    return {
      adapterId: adapterIdForKind(execution.preview.kind),
      execution,
      response: [visibleCapabilityBuildoutMessage(retriedCapabilityBuildout), retryAttempt.response].filter(Boolean).join('\n\n'),
      runId: retryAttempt.runId || result.runId,
      modeOutcomeSummary: retryAttempt.modeOutcomeSummary || result.modeOutcomeSummary,
      observedEval: retryAttempt.observedEval || result.observedEval,
      handoffSuggestion: retryAttempt.handoffSuggestion || result.handoffSuggestion,
      capabilityBuildout: retriedCapabilityBuildout,
      warnings,
    };
  }
  const combinedResponse = agentResponse
    ? (appAdapterMessage ? `${appAdapterMessage}\n\n${agentResponse}` : agentResponse)
    : (appAdapterMessage
        ? `${appAdapterMessage}\n\n_(Agent didn't return follow-up text. The app is open — say what to do next and I'll continue from there.)_`
        : '(No response from the agent — try rephrasing.)');

  return {
    adapterId: adapterIdForKind(execution.preview.kind),
    execution,
    response: [combinedResponse, visibleCapabilityBuildoutMessage(capabilityBuildout)].filter(Boolean).join('\n\n'),
    runId: result.runId,
    modeOutcomeSummary: result.modeOutcomeSummary,
    observedEval: result.observedEval,
    handoffSuggestion: result.handoffSuggestion,
    capabilityBuildout,
    warnings,
  };
}
