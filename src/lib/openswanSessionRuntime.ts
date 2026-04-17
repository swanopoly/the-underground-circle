import { buildAgenticCodingPrompt, detectAgenticCodingProfile, type AgenticCodingProfile, type AgenticCodingSurface } from './agenticCodingProfile';
import { addArtifact, addStep, createRun, mergeRunMetadata, type ArtifactKind, type RunSurface, updateRunStatus } from './agentRunSystem';
import { buildOpenSwanExecutionStream, type OpenSwanExecutionContract } from './openswanExecution';
import { buildOpenSwanMemoryRecommendations, buildPromptMemoryBundle, captureOpenSwanOutcomeMemory, type OpenSwanMemoryRecommendation, type PromptMemoryReference } from './memoryService';
import { extractBrowserPlansFromToolActions, runOpenSwanRuntimeToolLoop } from './openswanRuntimeToolLoop';
import { buildOpenSwanTaskPlan, type OpenSwanTaskPlan } from './openswanTaskPlanner';
import { buildOpenSwanToolBrief } from './openswanToolRuntime';
import { appendOpenSwanTranscriptEvent, buildOpenSwanTranscriptKey, upsertOpenSwanTranscriptHeader, type OpenSwanSessionTranscript } from './openswanTranscripts';
import { executeOpenSwanVerificationPlan, type OpenSwanVerificationResult } from './openswanVerificationRuntime';
import { getSwanBotStructuredResponse, type SwanBotContext, type SwanBotStructuredArtifact, type SwanBotStructuredResponse } from './swanbot';
import { delegateToSubagents, planSubagentDelegation, shouldDelegateToSubagents } from './subagentRegistry';
import type { SessionDelegationMode } from './chatSessionProfile';
import type { BrowserPlanCardData, BrowserPlanEvent } from './computerUse';

export type OpenSwanRunStage =
  | 'booting'
  | 'loading_context'
  | 'delegating'
  | 'reasoning'
  | 'using_tools'
  | 'rendering_artifacts'
  | 'finalizing';

export type OpenSwanRunCallbacks = {
  onStageChange?: (stage: OpenSwanRunStage, label: string) => void;
  onDelegationPlan?: (subagents: OpenSwanDelegatedAgentDescriptor[]) => void;
};

export type OpenSwanDelegatedAgentDescriptor = {
  name: string;
  icon: string;
  color: string;
  role: string;
};

export type OpenSwanTurnOptions = {
  message: string;
  context: SwanBotContext;
  surface: AgenticCodingSurface;
  runSurface?: RunSurface;
  sessionProfile?: AgenticCodingProfile;
  delegationMode?: SessionDelegationMode;
  activePluginIds?: string[];
  roomId?: string;
  chatSessionId?: string | null;
  mode?: string;
  title?: string;
  goal?: string;
  metadata?: Record<string, unknown>;
  autoExecuteVerification?: boolean;
} & OpenSwanRunCallbacks;

export type OpenSwanToolEvent = { tool: string; input: unknown; result: string };

export type OpenSwanTurnResult = SwanBotStructuredResponse & {
  runId?: string | null;
  prompt: string;
  stage: OpenSwanRunStage;
  taskPlan: OpenSwanTaskPlan;
  verificationResults?: OpenSwanVerificationResult[];
  delegatedSubagents?: string[];
  memoriesUsed?: string[];
  memoryReferences?: PromptMemoryReference[];
  memoryRecommendations?: OpenSwanMemoryRecommendation[];
  toolEvents?: OpenSwanToolEvent[];
  browserPlans?: BrowserPlanCardData[];
  browserPlanEvents?: BrowserPlanEvent[];
};

function buildInitialBrowserPlanEvents(plans: BrowserPlanCardData[]): BrowserPlanEvent[] {
  const timestamp = new Date().toISOString();
  return plans.map((plan) => ({
    id: `${plan.planId}:planned`,
    planId: plan.planId,
    kind: 'planned',
    at: timestamp,
    summary: `Browser plan prepared via ${plan.backendLabel}`,
    backend: plan.backend,
    backendLabel: plan.backendLabel,
  }));
}

function getOpenSwanReasoningSettings(taskPlan: OpenSwanTaskPlan): {
  thinkingLevel: 'fast' | 'balanced' | 'deep';
  maxTokens: number;
} {
  if (taskPlan.kind === 'build') {
    const hasPreview = taskPlan.verification.some((check) => check.kind === 'preview');
    return {
      thinkingLevel: 'deep',
      maxTokens: hasPreview ? 12288 : 10240,
    };
  }

  if (taskPlan.kind === 'architect' || taskPlan.kind === 'debug' || taskPlan.kind === 'research') {
    return {
      thinkingLevel: 'deep',
      maxTokens: 9216,
    };
  }

  if (taskPlan.kind === 'review') {
    return {
      thinkingLevel: 'deep',
      maxTokens: 8192,
    };
  }

  return {
    thinkingLevel: 'balanced',
    maxTokens: 6144,
  };
}

function emitStage(callbacks: OpenSwanRunCallbacks, stage: OpenSwanRunStage, label: string) {
  callbacks.onStageChange?.(stage, label);
}

function mapStructuredArtifactKind(kind: SwanBotStructuredArtifact['kind']): ArtifactKind {
  switch (kind) {
    case 'code':
      return 'code_patch';
    case 'webpage':
      return 'webpage';
    case 'image':
      return 'image';
    case 'audio':
      return 'audio';
    case 'translation':
      return 'translation';
    case 'classification':
      return 'classification';
    case 'summary':
    case 'vision':
    default:
      return 'report';
  }
}

function summarizeDelegatedArtifacts(artifacts: SwanBotStructuredArtifact[]): string[] {
  if (!artifacts.length) return [];
  return [
    'Artifacts:',
    ...artifacts.map((artifact) => `- ${artifact.kind}: ${artifact.title}`),
  ];
}

function summarizeMemoryReferences(references: PromptMemoryReference[]): Array<Record<string, unknown>> {
  return references.map((ref) => ({
    id: ref.id,
    title: ref.title,
    scope: ref.scope,
    memoryKind: ref.memoryKind,
    soulKey: ref.soulKey || null,
    importance: ref.importance ?? null,
    retrievalMode: ref.retrievalMode ?? null,
    updatedAt: ref.updatedAt || null,
    lastAccessedAt: ref.lastAccessedAt || null,
    confidence: ref.confidence ?? null,
    score: ref.score ?? null,
    taskFit: ref.taskFit ?? null,
    matchReason: ref.matchReason ?? null,
  }));
}

async function appendTranscriptEvent(
  transcriptKey: string,
  event: Parameters<typeof appendOpenSwanTranscriptEvent>[0]['event'],
): Promise<OpenSwanSessionTranscript | null> {
  try {
    return await appendOpenSwanTranscriptEvent({ transcriptKey, event });
  } catch (error) {
    console.warn('[OpenSwanRuntime] Transcript append failed (non-fatal):', error);
    return null;
  }
}

export async function runOpenSwanSessionTurn(opts: OpenSwanTurnOptions): Promise<OpenSwanTurnResult> {
  const cleanMessage = opts.message.replace(/@(agent|blackswan|swanbot|swan)\s*/gi, '').trim() || opts.message;
  const profile = opts.sessionProfile || detectAgenticCodingProfile(cleanMessage, opts.surface);
  const prompt = buildAgenticCodingPrompt(cleanMessage, { surface: opts.surface, profile });
  const runSurface = opts.runSurface || opts.surface;
  const taskPlan = buildOpenSwanTaskPlan(cleanMessage, profile);
  const toolBrief = buildOpenSwanToolBrief(
    opts.surface === 'main_chat' ? 'main_chat' : 'room_chat',
    taskPlan,
    opts.activePluginIds,
  );
  const reasoningSettings = getOpenSwanReasoningSettings(taskPlan);
  const delegationSpecs =
    opts.delegationMode === 'focused'
      ? []
      : opts.delegationMode === 'parallel'
        ? planSubagentDelegation(cleanMessage, taskPlan, { activePluginIds: opts.activePluginIds })
        : shouldDelegateToSubagents(cleanMessage, taskPlan)
          ? planSubagentDelegation(cleanMessage, taskPlan, { activePluginIds: opts.activePluginIds })
          : [];
  const delegatedAgents: OpenSwanDelegatedAgentDescriptor[] = delegationSpecs.map((spec) => ({
    name: spec.subagent.displayName,
    icon: spec.subagent.icon,
    color: spec.subagent.color,
    role: spec.subagent.role,
  }));
  const totalSteps = 7 + delegationSpecs.length;

  emitStage(opts, 'booting', 'Booting OpenSwan session');

  const run = opts.context.circleId
    ? await createRun({
        circleId: opts.context.circleId,
        userId: opts.context.userId,
        surface: runSurface,
        roomId: opts.roomId,
        chatSessionId: opts.chatSessionId || undefined,
        title: opts.title || cleanMessage.slice(0, 100) || 'OpenSwan Session',
        goal: opts.goal || cleanMessage.slice(0, 500),
        mode: opts.mode || 'talk',
        model: opts.context.model || undefined,
        provider: 'openswan',
        metadata: {
          surface: opts.surface,
          profile,
          taskKind: taskPlan.kind,
          delegationMode: opts.delegationMode || 'auto',
          verificationPlan: taskPlan.verification,
          recommendedTools: taskPlan.recommendedTools,
          ...(opts.metadata || {}),
        },
      })
    : null;

  const transcriptKey = buildOpenSwanTranscriptKey({
    runId: run?.id,
    chatSessionId: opts.chatSessionId || null,
    circleId: opts.context.circleId,
    userId: opts.context.userId,
    surface: runSurface,
  });
  let transcript = await upsertOpenSwanTranscriptHeader({
    transcriptKey,
    runId: run?.id,
    chatSessionId: opts.chatSessionId || null,
    circleId: opts.context.circleId,
    userId: opts.context.userId,
    surface: runSurface,
    taskKind: taskPlan.kind,
    profile,
    title: opts.title || cleanMessage.slice(0, 100) || 'OpenSwan Session',
  });
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'session_started',
    title: 'OpenSwan session started',
    summary: `Profile ${profile} / task ${taskPlan.kind}`,
    data: {
      runId: run?.id || null,
      recommendedTools: taskPlan.recommendedTools.map((tool) => tool.tool),
      verificationPlan: taskPlan.verification.map((check) => ({
        label: check.label,
        kind: check.kind,
        required: check.required,
      })),
    },
  })) || transcript;
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'user_turn',
    title: 'User request received',
    summary: cleanMessage.slice(0, 280),
    data: {
      originalMessage: opts.message.slice(0, 2000),
    },
  })) || transcript;

  if (run && opts.context.circleId) {
    await updateRunStatus(run.id, 'running', { current_step_index: 0, total_steps: totalSteps });
    await mergeRunMetadata(run.id, {
      openswanTranscriptKey: transcriptKey,
      openswanTranscriptEventCount: transcript.events.length,
      openswanTranscriptUpdatedAt: transcript.updatedAt,
    });
    await addStep({
      runId: run.id,
      circleId: opts.context.circleId,
      stepIndex: 0,
      stepKind: 'plan',
      title: 'OpenSwan session turn',
      body: [
        cleanMessage.slice(0, 2500),
        '',
        `Task profile: ${taskPlan.summary}`,
        '',
        'Verification plan:',
        ...taskPlan.verification.map((check) => `- ${check.required ? '[required]' : '[optional]'} ${check.label}: ${check.reason}`),
        '',
        toolBrief,
      ].join('\n').slice(0, 5000),
    });
  }

  emitStage(opts, 'loading_context', 'Loading context');
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'context_loaded',
    title: 'Context assembled',
    summary: `${taskPlan.recommendedTools.length} recommended tool(s), ${taskPlan.verification.length} verification check(s)`,
    data: {
      recommendedTools: taskPlan.recommendedTools.map((tool) => ({
        tool: tool.tool,
        priority: tool.priority,
      })),
      verification: taskPlan.verification.map((check) => ({
        label: check.label,
        required: check.required,
      })),
    },
  })) || transcript;
  if (run && opts.context.circleId) {
    await addStep({
      runId: run.id,
      circleId: opts.context.circleId,
      stepIndex: 1,
      stepKind: 'context_edit',
      title: 'Context assembled',
      body: (opts.context.chatHistory || '').slice(0, 5000),
    });
    await addStep({
      runId: run.id,
      circleId: opts.context.circleId,
      stepIndex: 2,
      stepKind: 'thinking',
      title: 'Task and verification plan',
      body: [
        `Task kind: ${taskPlan.kind}`,
        `Profile: ${taskPlan.profile}`,
        '',
        'Recommended tools:',
        ...taskPlan.recommendedTools.map((tool) => `- ${tool.tool} [${tool.priority}]: ${tool.reason}`),
      ].join('\n').slice(0, 5000),
    });
    await updateRunStatus(run.id, 'running', { current_step_index: 2, total_steps: totalSteps });
  }

  let delegationSummary = '';
  if (delegationSpecs.length > 0 && opts.context.circleId) {
    opts.onDelegationPlan?.(delegatedAgents);
    emitStage(opts, 'delegating', `Delegating to ${delegationSpecs.map((spec) => spec.subagent.displayName).join(', ')}`);
    transcript = (await appendTranscriptEvent(transcriptKey, {
      kind: 'delegation_planned',
      title: 'Delegation planned',
      summary: delegationSpecs.map((spec) => spec.subagent.displayName).join(', '),
      data: {
        specs: delegationSpecs.map((spec) => ({
          displayName: spec.subagent.displayName,
          role: spec.subagent.role,
          reason: spec.reason,
        })),
      },
    })) || transcript;

    if (run) {
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: 3,
        stepKind: 'delegation',
        title: 'Sub-agent delegation plan',
        body: delegationSpecs.map((spec) => `- ${spec.subagent.displayName}: ${spec.reason}`).join('\n').slice(0, 5000),
      });
      await updateRunStatus(run.id, 'running', { current_step_index: 3, total_steps: totalSteps });
    }

    const delegated = await delegateToSubagents({
      circleId: opts.context.circleId,
      userId: opts.context.userId,
      userName: opts.context.userName,
      surface: runSurface,
      message: cleanMessage,
      specs: delegationSpecs,
      parentRunId: run?.id,
      model: opts.context.model || undefined,
      chatHistory: opts.context.chatHistory,
      roomId: opts.roomId,
    });

    delegationSummary = delegated.results.map((result, index) => {
      const spec = delegated.specs[index];
      return [
        `### ${spec.subagent.displayName}`,
        `Reason: ${spec.reason}`,
        result.response,
        ...summarizeDelegatedArtifacts(result.artifacts || []),
      ].join('\n');
    }).join('\n\n').slice(0, 12000);
    transcript = (await appendTranscriptEvent(transcriptKey, {
      kind: 'delegation_completed',
      title: 'Delegation completed',
      summary: `${delegated.results.length} sub-agent result(s) merged`,
      data: {
        results: delegated.results.map((result) => ({
          role: result.subagent.role,
          displayName: result.subagent.displayName,
          runId: result.runId || null,
          artifactCount: result.artifacts?.length || 0,
          toolActionCount: result.toolActions?.length || 0,
        })),
      },
    })) || transcript;

    if (run) {
      const delegatedArtifacts: Array<{ role: string; title: string; kind: SwanBotStructuredArtifact['kind'] }> = [];
      for (let index = 0; index < delegated.results.length; index += 1) {
        const result = delegated.results[index];
        const spec = delegated.specs[index];
        await addStep({
          runId: run.id,
          circleId: opts.context.circleId,
          stepIndex: 4 + index,
          stepKind: 'delegation',
          title: `${spec.subagent.displayName} completed`,
          body: [
            result.response.slice(0, 2200),
            ...(result.toolActions?.length
              ? [
                  '',
                  'Tool activity:',
                  ...result.toolActions.map((action) => `- [${action.status}] ${action.title || action.tool_name}`),
                ]
              : []),
            ...((result.artifacts || []).length
              ? [
                  '',
                  'Artifacts:',
                  ...(result.artifacts || []).map((artifact) => `- ${artifact.kind}: ${artifact.title}`),
                ]
              : []),
          ].join('\n').slice(0, 2500),
          delegatedTo: spec.subagent.role,
          childRunId: result.runId,
          status: 'completed',
        });
        for (const artifact of result.artifacts || []) {
          delegatedArtifacts.push({
            role: spec.subagent.role,
            title: artifact.title,
            kind: artifact.kind,
          });
          await addArtifact({
            runId: run.id,
            circleId: opts.context.circleId,
            artifactKind: mapStructuredArtifactKind(artifact.kind),
            title: `${spec.subagent.displayName}: ${artifact.title}`,
            content: artifact.content || undefined,
            url: artifact.url || undefined,
            metadata: {
              ...(artifact.metadata || {}),
              source: 'delegated_subagent',
              delegatedTo: spec.subagent.role,
              childRunId: result.runId || null,
            },
          });
        }
      }
      await mergeRunMetadata(run.id, {
        delegatedSubagentResults: delegated.results.map((result) => ({
          role: result.subagent.role,
          displayName: result.subagent.displayName,
          runId: result.runId || null,
          responsePreview: result.response.slice(0, 500),
          artifacts: (result.artifacts || []).map((artifact) => ({
            kind: artifact.kind,
            title: artifact.title,
          })),
          toolActions: (result.toolActions || []).map((action) => ({
            tool: action.tool_name,
            title: action.title,
            status: action.status,
          })),
          memoryReferences: summarizeMemoryReferences(result.memoryReferences || []),
        })),
        delegatedArtifactSummary: delegatedArtifacts,
      });
      await updateRunStatus(run.id, 'running', { current_step_index: 4 + delegated.results.length, total_steps: totalSteps });
    }
  }

  emitStage(opts, 'reasoning', 'Reasoning over the task');
  const memoryBundle = await buildPromptMemoryBundle({
    circleId: opts.context.circleId,
    userId: opts.context.userId,
    query: cleanMessage,
    roomId: opts.roomId,
    agentId: opts.context.agentId,
    agentName: opts.context.agentName,
    spiritId: opts.context.spiritId,
    surface: opts.surface,
    taskKind: taskPlan.kind,
    profile,
    runId: run?.id,
    limit: 8,
  });
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'memory_loaded',
    title: 'Memory bundle loaded',
    summary: `${memoryBundle.references.length} memory reference(s) applied`,
    data: {
      memoryReferences: summarizeMemoryReferences(memoryBundle.references),
    },
  })) || transcript;
  if (run) {
    await mergeRunMetadata(run.id, {
      memoryReferences: summarizeMemoryReferences(memoryBundle.references),
      memoriesUsed: memoryBundle.references.map((ref) => ref.title),
      memoryContextPreview: memoryBundle.memoryContext.slice(0, 1200),
      spiritId: opts.context.spiritId || null,
    });
  }
  const assistantResponseStepIndex = delegationSpecs.length > 0 ? 4 + delegationSpecs.length : 3;
  const structured = await getSwanBotStructuredResponse(prompt, {
    ...opts.context,
    thinkingLevel: opts.context.thinkingLevel || reasoningSettings.thinkingLevel,
    maxTokens: opts.context.maxTokens || reasoningSettings.maxTokens,
    memoryContext: memoryBundle.memoryContext,
    memoryRefs: memoryBundle.references,
    chatHistory: [
      opts.context.chatHistory || '',
      delegationSummary ? `## Specialist Sub-Agent Results\n${delegationSummary}` : '',
    ].filter(Boolean).join('\n\n'),
  });

  let runtimeToolActions = structured.tool_actions || [];
  let browserPlans: BrowserPlanCardData[] = extractBrowserPlansFromToolActions(runtimeToolActions);
  let browserPlanEvents: BrowserPlanEvent[] = buildInitialBrowserPlanEvents(browserPlans);
  let executionStream = buildOpenSwanExecutionStream({
    toolEvents: [],
    verificationResults: [],
  });
  try {
    if (opts.context.circleId) {
      emitStage(opts, 'using_tools', 'Using tools');
      const { soulKeyForProfile } = await import('./serviceProfileSouls');
      const toolResult = await runOpenSwanRuntimeToolLoop({
        circleId: opts.context.circleId,
        userId: opts.context.userId,
        runId: run?.id,
        message: prompt,
        draftResponse: structured.response,
        model: opts.context.model,
        userName: opts.context.userName,
        chatHistory: opts.context.chatHistory,
        activeSoulKey: soulKeyForProfile(opts.sessionProfile || 'senior'),
        activePluginIds: opts.activePluginIds,
        taskKind: taskPlan.kind,
        surface: opts.surface === 'main_chat' ? 'main_chat' : 'room_chat',
        preferredToolNames: taskPlan.recommendedTools.map((tool) => tool.tool),
      });
      if (toolResult.toolActions.length > 0) {
        runtimeToolActions = [...runtimeToolActions, ...toolResult.toolActions];
        browserPlans = extractBrowserPlansFromToolActions(runtimeToolActions);
        browserPlanEvents = buildInitialBrowserPlanEvents(browserPlans);
        structured.tool_actions = runtimeToolActions;
        structured.response = toolResult.response;
        transcript = (await appendTranscriptEvent(transcriptKey, {
          kind: 'tool_activity',
          title: 'Runtime tool activity',
          summary: `${toolResult.toolActions.length} tool action(s) executed`,
          data: {
            toolActions: toolResult.toolActions.map((action) => ({
              tool: action.tool_name,
              status: action.status,
              title: action.title,
              outputPreview: action.output_preview || null,
            })),
          },
        })) || transcript;
        if (browserPlans.length > 0) {
          transcript = (await appendTranscriptEvent(transcriptKey, {
            kind: 'browser_plans',
            title: 'Browser plans prepared',
            summary: `${browserPlans.length} browser plan(s) ready`,
            data: {
              browserPlans: browserPlans.map((plan) => ({
                planId: plan.planId,
                task: plan.task,
                backend: plan.backend,
                backendLabel: plan.backendLabel,
              })),
            },
          })) || transcript;
        }
        executionStream = buildOpenSwanExecutionStream({
          toolEvents: runtimeToolActions.map((action) => ({
            tool: action.tool_name as any,
            status:
              action.status === 'completed'
                ? 'passed'
                : action.status === 'manual_required'
                  ? 'manual_required'
                  : action.status === 'blocked'
                    ? 'blocked'
                    : 'failed',
            summary: action.output_preview || action.title,
          })),
          verificationResults: [],
        });
      }
    }
  } catch (toolErr) {
    console.warn('[OpenSwanRuntime] Runtime tool loop failed (non-fatal):', toolErr);
  }

  const toolStepIndex = assistantResponseStepIndex;
  const actualAssistantResponseStepIndex = assistantResponseStepIndex + (runtimeToolActions.length > 0 ? 1 : 0);
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'assistant_response',
    title: 'Assistant response drafted',
    summary: structured.response.slice(0, 280),
    data: {
      artifactCount: structured.artifacts?.length || 0,
      toolActionCount: runtimeToolActions.length,
    },
  })) || transcript;
  if (run && opts.context.circleId) {
    if (runtimeToolActions.length > 0) {
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: toolStepIndex,
        stepKind: 'tool_call',
        title: 'Runtime tool activity',
        body: runtimeToolActions
          .map((action) => `- [${action.status}] ${action.title || action.tool_name}${action.output_preview ? `: ${action.output_preview}` : ''}`)
          .join('\n')
          .slice(0, 5000),
        metadata: {
          executions: runtimeToolActions.map((action) => ({
            status:
              action.status === 'completed'
                ? 'passed'
                : action.status === 'manual_required'
                  ? 'manual_required'
                  : action.status === 'blocked'
                    ? 'blocked'
                    : 'failed',
            mode:
              action.status === 'manual_required'
                ? 'manual'
                : action.status === 'blocked'
                  ? 'blocked'
                  : 'automatic',
            summary: action.output_preview || action.title,
            toolName: action.tool_name,
            executed: action.status === 'completed' || action.status === 'failed',
            error: action.status === 'failed' || action.status === 'blocked' ? action.output_preview || null : null,
          } satisfies OpenSwanExecutionContract)),
          browserPlanEvents,
        },
      });
        await mergeRunMetadata(run.id, {
          runtimeToolActions: runtimeToolActions.map((action) => ({
            tool: action.tool_name,
            title: action.title,
            status: action.status,
            outputPreview: action.output_preview || null,
            browserPlan: action.metadata?.browserPlan || null,
            toolPolicy: action.metadata?.toolPolicy || null,
            approvalRequest: action.metadata?.approvalRequest || null,
          })),
          browserPlans,
          browserPlanEvents,
          execution_stream: executionStream,
        });
    }
    await addStep({
      runId: run.id,
      circleId: opts.context.circleId,
      stepIndex: actualAssistantResponseStepIndex,
      stepKind: 'message',
      title: 'Assistant response',
      body: structured.response.slice(0, 5000),
      tokensUsed: (structured.usage?.input_tokens || 0) + (structured.usage?.output_tokens || 0),
    });
    await updateRunStatus(run.id, 'running', { current_step_index: actualAssistantResponseStepIndex, total_steps: totalSteps });
  }

  emitStage(opts, 'rendering_artifacts', 'Rendering artifacts');
  if ((structured.artifacts || []).length > 0) {
    transcript = (await appendTranscriptEvent(transcriptKey, {
      kind: 'artifacts_rendered',
      title: 'Artifacts rendered',
      summary: `${structured.artifacts?.length || 0} artifact(s) prepared`,
      data: {
        artifacts: (structured.artifacts || []).map((artifact) => ({
          kind: artifact.kind,
          title: artifact.title,
        })),
      },
    })) || transcript;
  }
  if (run && opts.context.circleId) {
    const artifactStepIndex = actualAssistantResponseStepIndex + 1;
    let currentStepIndex = actualAssistantResponseStepIndex;
    for (const artifact of structured.artifacts || []) {
      await addArtifact({
        runId: run.id,
        circleId: opts.context.circleId,
        artifactKind: mapStructuredArtifactKind(artifact.kind),
        title: artifact.title,
        content: artifact.content || undefined,
        url: artifact.url || undefined,
        metadata: artifact.metadata || {},
      });
    }
    if ((structured.artifacts || []).length > 0) {
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: artifactStepIndex,
        stepKind: 'artifact_create',
        title: 'Artifacts prepared',
        body: (structured.artifacts || []).map((artifact) => `- ${artifact.kind}: ${artifact.title}`).join('\n').slice(0, 5000),
      });
      currentStepIndex = artifactStepIndex;
    }
    await updateRunStatus(run.id, 'running', { current_step_index: currentStepIndex, total_steps: totalSteps });
  }

  emitStage(opts, 'finalizing', 'Finalizing run');
  let verificationResults: OpenSwanVerificationResult[] | undefined;
  let memoryRecommendations: OpenSwanMemoryRecommendation[] = [];
  if (run) {
    if (opts.context.circleId) {
      const verificationStepIndex = actualAssistantResponseStepIndex + ((structured.artifacts || []).length > 0 ? 2 : 1);
      const finalStepIndex = verificationStepIndex + (opts.autoExecuteVerification ? 1 : 0);
      const finalTotalSteps = finalStepIndex + 1;
      if (opts.autoExecuteVerification) {
        verificationResults = await executeOpenSwanVerificationPlan(taskPlan);
        transcript = (await appendTranscriptEvent(transcriptKey, {
          kind: 'verification_completed',
          title: 'Verification completed',
          summary: `${verificationResults.length} verification result(s) recorded`,
          data: {
            verificationResults: verificationResults.map((result) => ({
              label: result.check.label,
              status: result.execution.status,
              summary: result.summary,
            })),
          },
        })) || transcript;
        executionStream = buildOpenSwanExecutionStream({
          toolEvents: runtimeToolActions.map((action) => ({
            tool: action.tool_name as any,
            status: action.status === 'completed' ? 'passed' : 'failed',
            summary: action.output_preview || action.title,
          })),
          verificationResults,
        });
        await addStep({
          runId: run.id,
          circleId: opts.context.circleId,
          stepIndex: verificationStepIndex,
          stepKind: 'finalize',
          title: 'Verification results',
          body: verificationResults.map((result) => `- ${result.summary}`).join('\n').slice(0, 5000),
          metadata: {
            executions: verificationResults.map((result) => result.execution),
          },
        });
      }
      await addStep({
        runId: run.id,
        circleId: opts.context.circleId,
        stepIndex: finalStepIndex,
        stepKind: 'finalize',
        title: 'Run finalized',
        body: [
          `${structured.artifacts?.length || 0} artifact(s) ready`,
          '',
          'Verification checklist:',
          ...taskPlan.verification.map((check) => `- ${check.label}`),
          ...(verificationResults?.length ? ['', 'Verification results:', ...verificationResults.map((result) => `- ${result.summary}`)] : []),
        ].join('\n').slice(0, 5000),
      });
      await updateRunStatus(run.id, 'completed', {
        current_step_index: finalStepIndex,
        total_steps: finalTotalSteps,
        input_tokens: structured.usage?.input_tokens || 0,
        output_tokens: structured.usage?.output_tokens || 0,
        cached_tokens: structured.usage?.total_tokens
          ? Math.max(0, structured.usage.total_tokens - ((structured.usage.input_tokens || 0) + (structured.usage.output_tokens || 0)))
          : 0,
      });

      memoryRecommendations = buildOpenSwanMemoryRecommendations({
        taskKind: taskPlan.kind,
        profile: taskPlan.profile,
        prompt: cleanMessage,
        response: structured.response,
        spiritId: opts.context.spiritId || null,
        memoryReferences: memoryBundle.references,
        verificationResults,
        artifacts: (structured.artifacts || []).map((artifact) => ({ kind: artifact.kind, title: artifact.title })),
      });
      transcript = (await appendTranscriptEvent(transcriptKey, {
        kind: 'memory_recommendations',
        title: 'Memory recommendations generated',
        summary: `${memoryRecommendations.length} recommendation(s) prepared`,
          data: {
            memoryRecommendations: memoryRecommendations.map((recommendation) => ({
              kind: recommendation.memoryKind,
              title: recommendation.title,
              target: recommendation.target,
            })),
          },
        })) || transcript;

      const runtimeAgentId = opts.context.agentId || `openswan:${opts.surface}`;
      await mergeRunMetadata(run.id, {
        execution_stream: executionStream,
        verification_results: verificationResults || [],
        browserPlans,
        browserPlanEvents,
        memoryRecommendations,
        openswanTranscriptKey: transcriptKey,
        openswanTranscriptEventCount: transcript.events.length,
        openswanTranscriptUpdatedAt: transcript.updatedAt,
      });
      void captureOpenSwanOutcomeMemory({
        circleId: opts.context.circleId,
        userId: opts.context.userId,
        agentId: runtimeAgentId,
        agentName: opts.context.agentName || 'OpenSwan',
        spiritId: opts.context.spiritId || null,
        taskKind: taskPlan.kind,
        profile: taskPlan.profile,
        title: opts.title || cleanMessage.slice(0, 100) || 'OpenSwan Session',
        prompt: cleanMessage,
        response: structured.response,
        artifacts: (structured.artifacts || []).map((artifact) => ({ kind: artifact.kind, title: artifact.title })),
        verificationResults,
      }).catch(() => {});
    }
  }
  if (memoryRecommendations.length === 0) {
    memoryRecommendations = buildOpenSwanMemoryRecommendations({
      taskKind: taskPlan.kind,
      profile: taskPlan.profile,
      prompt: cleanMessage,
      response: structured.response,
      spiritId: opts.context.spiritId || null,
      memoryReferences: memoryBundle.references,
      verificationResults,
      artifacts: (structured.artifacts || []).map((artifact) => ({ kind: artifact.kind, title: artifact.title })),
    });
  }
  transcript = (await appendTranscriptEvent(transcriptKey, {
    kind: 'run_finalized',
    title: 'Run finalized',
    summary: `${runtimeToolActions.length} tool action(s), ${structured.artifacts?.length || 0} artifact(s), ${memoryRecommendations.length} memory recommendation(s)`,
    data: {
      runId: run?.id || null,
      browserPlanCount: browserPlans.length,
      verificationCount: verificationResults?.length || 0,
      executionStreamCount: executionStream.length,
    },
  })) || transcript;
  if (run) {
    await mergeRunMetadata(run.id, {
      openswanTranscriptKey: transcriptKey,
      openswanTranscriptEventCount: transcript.events.length,
      openswanTranscriptUpdatedAt: transcript.updatedAt,
    });
  }

  return {
    ...structured,
    runId: run?.id || null,
    prompt,
    stage: 'finalizing',
    taskPlan,
    verificationResults,
    delegatedSubagents: delegationSpecs.map((spec) => spec.subagent.displayName),
    memoriesUsed: memoryBundle.references.map((ref) => ref.title),
    memoryReferences: memoryBundle.references,
    memoryRecommendations,
    browserPlans,
    browserPlanEvents,
  };
}
