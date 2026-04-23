/**
 * agentRuntime.ts — Unified Agent Runtime
 *
 * The ONE entry point for AI interactions across ALL surfaces:
 * Chat, Rooms, Feed, Office Terminal, Floating Chat.
 *
 * Wraps SwanBot, adds mode-specific prompting, artifact extraction,
 * and cross-surface handoff detection.
 */

import { supabase } from './supabase';
import { getSwanBotResponse, SwanBotContext } from './swanbot';
import {
  TASK_CAPABILITY_PROFILES,
  inferTaskCapabilityProfile,
  getTaskCapabilityProfile,
} from './taskCapabilityProfiles';
import { buildImpactDomainGuidance } from './impactDomains';
import { buildTaskOwnershipClaim } from './circleIntegrations';
import {
  buildOpenSwanModeResponseContract,
  getOpenSwanModePolicy,
  resolveOpenSwanProfileForMode,
} from './openswanModePolicy';
import { buildOpenSwanObservedEvalSummary } from './openswanObservedEvals';
import type { OpenSwanObservedEvalSummary } from './openswanObservedEvals';
import { soulKeyForProfile } from './serviceProfileSouls';
import { OPENSWAN_RUNTIME_PLAN_VERSION } from './openswanRuntimePlan';
import type { PromptMemoryReference } from './memoryService';

// ─── Unified Types ──────────────────────────────────────────────────────────

export type AgentSurface =
  | 'main_chat'
  | 'room_chat'
  | 'feed_task'
  | 'office_terminal'
  | 'floating_chat';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ArtifactKind =
  | 'text'
  | 'code_patch'
  | 'image'
  | 'screenshot'
  | 'report'
  | 'research_brief'
  | 'citation_bundle'
  | 'design_spec'
  | 'diff'
  | 'link'
  | 'checklist'
  | 'classification'
  | 'translation'
  | 'test_result'
  | 'browser_proof';

export interface AgentRunRequest {
  surface: AgentSurface;
  circleId: string;
  userId: string;
  userName?: string;
  prompt: string;
  agentId?: string;
  agentName?: string;
  model?: string;
  mode?: 'talk' | 'build' | 'plan' | 'execute' | 'review' | 'research' | 'support' | 'design';
  capabilityProfile?: string;
  context?: {
    fileContent?: string;
    fileName?: string;
    chatHistory?: string;
    sessionArchiveContext?: string;
    memoryRefs?: PromptMemoryReference[];
    taskId?: string;
    roomId?: string;
    replyTo?: string;
  };
}

export interface AgentRunResult {
  success: boolean;
  response: string;
  runId?: string | null;
  artifacts?: { kind: ArtifactKind; title: string; content?: string; url?: string }[];
  steps?: { kind: string; title: string; summary?: string }[];
  handoffSuggestion?: HandoffSuggestion | null;
  modeOutcomeSummary?: {
    headline: string;
    bulletPoints: string[];
    blockers: string[];
  } | null;
  observedEval?: OpenSwanObservedEvalSummary | null;
}

export interface HandoffSuggestion {
  type: 'create_task' | 'open_room' | 'escalate' | 'continue_session';
  title: string;
  description: string;
  targetSurface: AgentSurface;
  payload: Record<string, unknown>;
}

// ─── Artifact Extraction ────────────────────────────────────────────────────

/**
 * Scans the AI response for code blocks, URLs, structured sections,
 * and classifies them into typed artifacts.
 */
export function extractArtifacts(
  response: string
): AgentRunResult['artifacts'] {
  const artifacts: NonNullable<AgentRunResult['artifacts']> = [];

  // Extract fenced code blocks
  const codeBlockRe = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRe.exec(response)) !== null) {
    const lang = match[1] || 'text';
    const code = match[2].trim();
    // Classify by language
    const isDiff = lang === 'diff' || code.startsWith('---') || code.startsWith('@@');
    const kind: ArtifactKind = isDiff ? 'diff' : 'code_patch';
    artifacts.push({
      kind,
      title: isDiff ? 'Code Diff' : `Code (${lang})`,
      content: code,
    });
  }

  // Extract standalone URLs (not inside code blocks)
  const urlRe = /(?:^|\s)(https?:\/\/[^\s)<>]+)/gm;
  while ((match = urlRe.exec(response)) !== null) {
    const url = match[1];
    // Skip if inside a markdown link []()
    const before = response.slice(Math.max(0, match.index - 2), match.index);
    if (before.includes('(')) continue;
    artifacts.push({ kind: 'link', title: 'Link', url });
  }

  // Detect report-like structure (multiple ## headings)
  const headingCount = (response.match(/^#{1,3}\s/gm) || []).length;
  if (headingCount >= 3) {
    artifacts.push({
      kind: 'report',
      title: 'Structured Report',
      content: response,
    });
  }

  return artifacts.length > 0 ? artifacts : undefined;
}

function buildModeOutcomeSummary(
  mode: string,
  response: string,
  artifacts?: AgentRunResult['artifacts'],
): AgentRunResult['modeOutcomeSummary'] {
  if (!mode || mode === 'talk') return null;
  const text = response || '';
  const blockers = Array.from(new Set([
    ...(text.match(/(?:blocked|failed|error|manual required|missing [^.:\n]+)/gi) || []).map((value) => value.trim()),
  ])).slice(0, 4);
  const artifactLabels = (artifacts || []).map((artifact) => `${artifact.kind}: ${artifact.title}`);

  if (mode === 'research') {
    return {
      headline: `Research run produced ${(artifacts || []).length} artifact(s) and a recommendation-oriented response.`,
      bulletPoints: artifactLabels.slice(0, 4),
      blockers,
    };
  }
  if (mode === 'design') {
    return {
      headline: `Design run focused on handoff-ready direction and previewable output.`,
      bulletPoints: artifactLabels.slice(0, 4),
      blockers,
    };
  }
  if (mode === 'support') {
    return {
      headline: blockers.length > 0
        ? `Support run identified ${blockers.length} blocker(s) and recovery guidance.`
        : 'Support run produced an unblock-oriented response with no active blocker detected.',
      bulletPoints: artifactLabels.slice(0, 4),
      blockers,
    };
  }
  return {
    headline: `${mode} run completed with ${(artifacts || []).length} artifact(s).`,
    bulletPoints: artifactLabels.slice(0, 4),
    blockers,
  };
}

function buildModeSummaryArtifacts(
  mode: string,
  summary: AgentRunResult['modeOutcomeSummary'],
  response: string,
): AgentRunResult['artifacts'] {
  if (!summary || !mode) return undefined;
  const content = [
    `Headline: ${summary.headline}`,
    summary.bulletPoints.length ? ['', 'Highlights:', ...summary.bulletPoints.map((item) => `- ${item}`)] : [],
    summary.blockers.length ? ['', 'Blockers:', ...summary.blockers.map((item) => `- ${item}`)] : [],
    ['', 'Response excerpt:', response.slice(0, 1600)],
  ].flat().filter(Boolean).join('\n');
  if (mode === 'research') return [{ kind: 'research_brief', title: 'Research Brief', content }];
  if (mode === 'design') return [{ kind: 'design_spec', title: 'Design Handoff Summary', content }];
  if (mode === 'support') return [{ kind: 'checklist', title: 'Support Recovery Checklist', content }];
  return undefined;
}

// ─── Handoff Detection ──────────────────────────────────────────────────────

// Patterns that signal a handoff is warranted
const HANDOFF_PATTERNS = {
  create_task: [
    /(?:should|let(?:'s| us)|I(?:'ll| will|'d))\s+create\s+a\s+task/i,
    /(?:this|that)\s+(?:needs|deserves|warrants)\s+(?:a|its own)\s+task/i,
    /track(?:ing)?\s+this\s+(?:as|in)\s+a\s+task/i,
    /add(?:ing)?\s+(?:this\s+)?to\s+(?:the\s+)?(?:task|to-?do)\s+(?:board|list|queue)/i,
  ],
  open_room: [
    /(?:should|let(?:'s| us))\s+(?:open|create|start)\s+a\s+room/i,
    /(?:this|that)\s+needs\s+(?:a|its own)\s+(?:project\s+)?room/i,
    /(?:move|continue)\s+this\s+(?:to|in)\s+a\s+(?:dedicated\s+)?room/i,
    /(?:need|want)\s+(?:to\s+)?(?:share|upload|attach)\s+files/i,
  ],
  escalate: [
    /escalat(?:e|ing)\s+(?:this\s+)?to\s+(?:an?\s+)?(?:admin|owner|lead)/i,
    /(?:need|require)s?\s+(?:admin|human|manual)\s+(?:review|approval|intervention)/i,
    /(?:beyond|outside)\s+(?:my|what I can)\s+(?:scope|capabilities|ability)/i,
    /(?:flag(?:ging)?|rais(?:e|ing))\s+this\s+(?:for|with)\s+(?:the\s+)?(?:team|admin|owner)/i,
  ],
};

/**
 * Parses the AI response for cross-surface handoff signals.
 * Returns a HandoffSuggestion if a handoff pattern is detected, null otherwise.
 */
export function detectHandoff(
  response: string,
  surface: AgentSurface
): HandoffSuggestion | null {
  // Check for task creation signals
  for (const pattern of HANDOFF_PATTERNS.create_task) {
    if (pattern.test(response)) {
      // Try to extract a meaningful title from the response
      const titleMatch = response.match(
        /(?:task|to-?do)(?:\s+(?:for|to|:))?\s*[""]?([^"".\n]{5,80})[""]?/i
      );
      const title = titleMatch?.[1]?.trim() || 'Follow-up task from chat';
      return {
        type: 'create_task',
        title,
        description: `Agent suggested creating a task based on the conversation in ${surface}.`,
        targetSurface: 'feed_task',
        payload: { suggestedTitle: title, sourceSurface: surface },
      };
    }
  }

  // Check for room creation signals
  for (const pattern of HANDOFF_PATTERNS.open_room) {
    if (pattern.test(response)) {
      const titleMatch = response.match(
        /room\s+(?:for|called|named|:)\s*[""]?([^"".\n]{5,60})[""]?/i
      );
      const title = titleMatch?.[1]?.trim() || 'New project room';
      return {
        type: 'open_room',
        title,
        description: `Agent suggested moving this work into a dedicated project room.`,
        targetSurface: 'room_chat',
        payload: { suggestedName: title, sourceSurface: surface },
      };
    }
  }

  // Check for escalation signals
  for (const pattern of HANDOFF_PATTERNS.escalate) {
    if (pattern.test(response)) {
      return {
        type: 'escalate',
        title: 'Escalate to admin',
        description: `Agent flagged this for admin/owner review.`,
        targetSurface: surface, // stays in same surface
        payload: { reason: 'Agent-detected escalation', sourceSurface: surface },
      };
    }
  }

  return null;
}

// ─── Unified Execution ──────────────────────────────────────────────────────

/**
 * The ONE function that all surfaces call to run the agent.
 *
 * Builds the prompt with mode-specific prefixes, injects context,
 * calls SwanBot, extracts artifacts, detects handoffs.
 */
export async function executeAgentRun(
  request: AgentRunRequest
): Promise<AgentRunResult> {
  const {
    surface,
    circleId,
    userId,
    userName,
    prompt,
    model,
    mode = 'talk',
    context,
  } = request;
  const modePolicy = getOpenSwanModePolicy(mode);
  const routingSurface = surface === 'room_chat' ? 'room_chat' : 'main_chat';
  const { analyzeMessageRouting } = await import('./messageRouting');
  const routeAnalysis = analyzeMessageRouting(prompt, routingSurface);
  const profileResolution = resolveOpenSwanProfileForMode(mode || 'talk', prompt, routingSurface);
  const { resolveModelForProfile } = await import('./serviceProfileSouls');
  const resolvedModel = resolveModelForProfile(
    profileResolution.resolvedProfile,
    model,
    routeAnalysis.route.intent,
  );
  const activeTaskKind =
    modePolicy.key === 'build' || modePolicy.key === 'execute'
      ? 'build'
      : modePolicy.key === 'review'
        ? 'review'
        : modePolicy.key === 'research'
          ? 'research'
          : modePolicy.key === 'support'
            ? 'debug'
            : modePolicy.key === 'design' || modePolicy.key === 'plan'
              ? 'architect'
              : null;
  const activeSoulKey = soulKeyForProfile(profileResolution.resolvedProfile);

  // Track the run in the unified system (non-blocking — don't fail if DB is unavailable)
  let runId: string | null = null;
  try {
    const { createRun, updateRunStatus, addStep, addArtifact, buildMemoryContext } = await import('./agentRunSystem');
    const run = await createRun({
      circleId, userId, surface: surface as any, title: prompt.slice(0, 100),
      goal: prompt.slice(0, 500), mode, model: resolvedModel, roomId: context?.roomId, taskId: context?.taskId,
      metadata: {
        runtimePlanVersion: OPENSWAN_RUNTIME_PLAN_VERSION,
        explicitMode: modePolicy.key,
        modeLabel: modePolicy.label,
        modeDescription: modePolicy.description,
        modeOutcome: modePolicy.outcome,
        selectedSessionProfile: profileResolution.selectedProfile,
        resolvedSessionProfile: profileResolution.resolvedProfile,
        autoDetectedSessionProfile: profileResolution.autoDetected,
        routingIntent: routeAnalysis.route.intent,
        routingComplexity: routeAnalysis.route.complexity,
      },
    });
    if (run) runId = run.id;
  } catch {}

  try {
    // 1. Build the augmented prompt with memory context
    const modeContract = buildOpenSwanModeResponseContract(mode);
    const contextParts: string[] = [];
    let integrationPreflightSummary: string | null = null;

    // Inject memory context
    try {
      const { buildMemoryContext } = await import('./agentRunSystem');
      const memCtx = await buildMemoryContext(circleId, context?.roomId, userId, request.agentId, request.agentName);
      if (memCtx) contextParts.push(memCtx);
    } catch {}

    const inferredProfileKey = request.capabilityProfile || modePolicy.preferredCapabilityProfile || inferTaskCapabilityProfile({
      title: prompt.slice(0, 160),
      description: context?.replyTo || context?.chatHistory || context?.fileName || '',
    });
    const inferredProfile = getTaskCapabilityProfile(inferredProfileKey);
    const domainGuidance = buildImpactDomainGuidance({
      title: prompt,
      description: context?.chatHistory || context?.replyTo || context?.fileName || '',
      query: prompt,
      domainKey: inferredProfile?.impactDomain,
    });
    if (domainGuidance) contextParts.push(domainGuidance);

    const ownershipClaim = await buildTaskOwnershipClaim({
      circleId,
      title: prompt.slice(0, 200),
      description: [
        context?.replyTo || '',
        context?.chatHistory || '',
        context?.fileName || '',
        inferredProfileKey || '',
      ].filter(Boolean).join(' '),
      profileKey: inferredProfileKey,
    });

    if (ownershipClaim.requiredCapabilities.length > 0 || ownershipClaim.requiredConnectors.length > 0) {
      integrationPreflightSummary = ownershipClaim.ownership.level === 'full'
        ? 'Integrations ready for full ownership.'
        : `Missing ${[
            ownershipClaim.missingConnectors.length > 0 ? `connectors: ${ownershipClaim.missingConnectors.join(', ')}` : '',
            ownershipClaim.missingCapabilities.length > 0 ? `capabilities: ${ownershipClaim.missingCapabilities.join(', ')}` : '',
          ].filter(Boolean).join(' | ')}`;
      contextParts.push(
        [
          '=== INTEGRATION PREFLIGHT ===',
          ownershipClaim.requiredConnectors.length > 0
            ? `Required connectors: ${ownershipClaim.requiredConnectors.join(', ')}`
            : null,
          ownershipClaim.requiredCapabilities.length > 0
            ? `Required capabilities: ${ownershipClaim.requiredCapabilities.join(', ')}`
            : null,
          `Ownership: ${ownershipClaim.ownership.headline}`,
          ownershipClaim.ownership.level === 'full'
            ? 'Status: circle integrations are ready for full ownership.'
            : `Status: missing ${[
                ownershipClaim.missingConnectors.length > 0 ? `connectors (${ownershipClaim.missingConnectors.join(', ')})` : '',
                ownershipClaim.missingCapabilities.length > 0 ? `capabilities (${ownershipClaim.missingCapabilities.join(', ')})` : '',
              ].filter(Boolean).join(' and ')}.`,
          `Guidance: ${ownershipClaim.ownership.detail}`,
          ownershipClaim.ownership.level !== 'full'
            ? 'Instruction: do not claim end-to-end execution for blocked external actions. Produce the exact missing access, connector setup, or handoff needed.'
            : 'Instruction: the connector surface is available, so you can take full ownership if the rest of the task is within scope.',
        ].filter(Boolean).join('\n')
      );
    }

    if (context?.replyTo) {
      contextParts.push(`[Replying to: "${context.replyTo.slice(0, 200)}"]`);
    }
    if (context?.fileName && context?.fileContent) {
      contextParts.push(
        `[File context: ${context.fileName}]\n\`\`\`\n${context.fileContent.slice(0, 4000)}\n\`\`\``
      );
    }
    if (context?.taskId) {
      contextParts.push(`[Related task ID: ${context.taskId}]`);
    }

    const fullPrompt = [
      modeContract,
      ...contextParts,
      prompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    const { resolveOpenSwanSkills } = await import('./openswanSkills');
    const skillResolution = await resolveOpenSwanSkills({
      circleId,
      userId,
      soulKey: activeSoulKey,
      mode: modePolicy.key,
      taskKind: activeTaskKind,
      query: fullPrompt,
      maxSkills: modePolicy.key === 'research' ? 8 : 6,
    });

    // 2. Build SwanBot context
    const swanContext: SwanBotContext = {
      userId,
      circleId,
      userName,
      agentId: request.agentId,
      agentName: request.agentName,
      model: resolvedModel || undefined,
      chatHistory: context?.chatHistory,
      sessionArchiveContext: context?.sessionArchiveContext,
      modeKey: modePolicy.key,
      taskKind: activeTaskKind,
      sessionProfile: profileResolution.resolvedProfile,
      resolvedSkills: skillResolution.skills,
      resolvedSkillsPromptBlock: skillResolution.promptBlock,
    };

    // Mark run as running
    if (runId) {
      try { const { updateRunStatus } = await import('./agentRunSystem'); await updateRunStatus(runId, 'running'); } catch {}
    }

    // 3. Call SwanBot
    const response = await getSwanBotResponse(fullPrompt, swanContext);

    // 4. Extract artifacts from the response
    const artifacts = extractArtifacts(response);
    const modeOutcomeSummary = buildModeOutcomeSummary(mode, response, artifacts);
    const modeSummaryArtifacts = buildModeSummaryArtifacts(mode, modeOutcomeSummary, response) || [];
    const persistedArtifacts = [...(artifacts || []), ...modeSummaryArtifacts];
    const observedEval = buildOpenSwanObservedEvalSummary({
      run: {
        status: 'completed',
        mode: mode || 'talk',
        provider: 'openswan',
        metadata: {
          explicitMode: modePolicy.key,
          resolvedSessionProfile: profileResolution.resolvedProfile,
          routingIntent: routeAnalysis.route.intent,
          modeOutcomeSummary,
        },
      },
      artifacts: persistedArtifacts.map((artifact) => ({
        artifact_kind: artifact.kind,
        title: artifact.title,
      })),
      responseText: response,
    });
    void import('./memoryService')
      .then(({ recordArchiveDerivedMemorySuccess, recordArchiveDerivedMemoryWeakSignal }) => Promise.all([
        recordArchiveDerivedMemorySuccess({
          memoryReferences: context?.memoryRefs || [],
          observedEval,
          userId,
          source: 'agent_runtime_passive_success',
          runId,
        }),
        recordArchiveDerivedMemoryWeakSignal({
          memoryReferences: context?.memoryRefs || [],
          observedEval,
          userId,
          source: 'agent_runtime_passive_weak_signal',
          runId,
        }),
      ]))
      .catch(() => {});

    // 5. Detect handoff signals
    const handoffSuggestion = detectHandoff(response, surface);

    // 6. Build step log
    const steps: AgentRunResult['steps'] = [
      { kind: 'prompt', title: 'Prompt built', summary: `Mode: ${mode}, Surface: ${surface}` },
      ...(integrationPreflightSummary ? [{
        kind: 'integration_preflight',
        title: 'Integration preflight checked',
        summary: integrationPreflightSummary,
      }] : []),
      { kind: 'inference', title: 'AI response received', summary: `${response.length} chars` },
    ];
    if (persistedArtifacts.length > 0) {
      steps.push({
        kind: 'extract',
        title: 'Artifacts extracted',
        summary: `${persistedArtifacts.length} artifact(s): ${persistedArtifacts.map(a => a.kind).join(', ')}`,
      });
    }
    if (handoffSuggestion) {
      steps.push({
        kind: 'handoff_detected',
        title: 'Handoff suggested',
        summary: `${handoffSuggestion.type}: ${handoffSuggestion.title}`,
      });
    }

    // 7. Record to unified run system
    if (runId) {
      try {
        const { updateRunStatus, addStep: addRunStep, addArtifact: addRunArtifact, mergeRunMetadata } = await import('./agentRunSystem');
        await addRunStep({ runId, circleId, stepIndex: 0, stepKind: 'message', title: 'Response', body: response.slice(0, 5000) });
        if (persistedArtifacts.length > 0) {
          for (const art of persistedArtifacts) {
            await addRunArtifact({ runId, circleId, artifactKind: art.kind as any, title: art.title, content: art.content, url: art.url });
          }
        }
        await mergeRunMetadata(runId, {
          runtimePlanVersion: OPENSWAN_RUNTIME_PLAN_VERSION,
          capabilityProfile: inferredProfileKey,
          impactDomain: inferredProfile?.impactDomain || null,
          ownershipClaim,
          integrationPreflightSummary,
          explicitMode: modePolicy.key,
          modeLabel: modePolicy.label,
          modeDescription: modePolicy.description,
        modeOutcome: modePolicy.outcome,
        modeResponseContract: modePolicy.responseContract || null,
        selectedSessionProfile: profileResolution.selectedProfile,
          resolvedSessionProfile: profileResolution.resolvedProfile,
          autoDetectedSessionProfile: profileResolution.autoDetected,
          routingIntent: routeAnalysis.route.intent,
          routingComplexity: routeAnalysis.route.complexity,
          activeSkills: skillResolution.skills.map((skill) => ({
            name: skill.name,
            displayName: skill.displayName,
            source: skill.source,
          })),
          modeOutcomeSummary,
          observedEval,
        });
        await updateRunStatus(runId, 'completed');
      } catch {}
    }

    return {
      success: true,
      runId,
      response,
      artifacts: persistedArtifacts,
      steps,
      handoffSuggestion,
      modeOutcomeSummary,
      observedEval,
    };
  } catch (err: any) {
    console.error('[AgentRuntime] executeAgentRun failed:', err);
    if (runId) {
      try { const { updateRunStatus } = await import('./agentRunSystem'); await updateRunStatus(runId, 'failed'); } catch {}
    }
    return {
      success: false,
      runId,
      response: `Something went wrong: ${err?.message || 'Unknown error'}`,
      handoffSuggestion: null,
      modeOutcomeSummary: null,
      observedEval: null,
    };
  }
}
