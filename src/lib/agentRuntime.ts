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
  | 'citation_bundle'
  | 'design_spec'
  | 'diff'
  | 'link'
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
  mode?: 'talk' | 'plan' | 'execute' | 'review' | 'research' | 'support' | 'design';
  capabilityProfile?: string;
  context?: {
    fileContent?: string;
    fileName?: string;
    chatHistory?: string;
    taskId?: string;
    roomId?: string;
    replyTo?: string;
  };
}

export interface AgentRunResult {
  success: boolean;
  response: string;
  artifacts?: { kind: ArtifactKind; title: string; content?: string; url?: string }[];
  steps?: { kind: string; title: string; summary?: string }[];
  handoffSuggestion?: HandoffSuggestion | null;
}

export interface HandoffSuggestion {
  type: 'create_task' | 'open_room' | 'escalate' | 'continue_session';
  title: string;
  description: string;
  targetSurface: AgentSurface;
  payload: Record<string, unknown>;
}

// ─── Mode Prompt Prefixes ───────────────────────────────────────────────────

const MODE_PREFIXES: Record<string, string> = {
  talk: '', // no prefix — natural conversation
  plan:
    '[PLAN MODE] Break down the request into clear phases with milestones. ' +
    'Consider tradeoffs and dependencies. Output a structured plan with estimated effort.',
  execute:
    '[EXECUTE MODE] You are in execution mode. Provide concrete code, commands, ' +
    'or step-by-step instructions that can be acted on immediately. Be precise.',
  review:
    '[REVIEW MODE] Review the provided work critically. Check for correctness, ' +
    'edge cases, performance, and style. Be honest and constructive.',
  research:
    '[RESEARCH MODE] You are in RESEARCH MODE. Cite sources, compare options, ' +
    'and produce a structured report. Include pros/cons tables where appropriate. ' +
    'End with a clear recommendation.',
  support:
    '[SUPPORT MODE] You are in SUPPORT MODE. Answer the question clearly and directly. ' +
    'If you cannot resolve it, suggest escalating to an admin or creating a task for follow-up.',
  design:
    '[DESIGN MODE] You are in DESIGN MODE. Describe the visual approach in detail. ' +
    'List required assets. Propose a mockup structure with layout, colors, and typography. ' +
    'Reference real tools (Figma, Tailwind, etc.) when relevant.',
};

/**
 * Returns the mode-specific system instruction prefix.
 */
export function getModePromptPrefix(mode: string): string {
  return MODE_PREFIXES[mode] || '';
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

  // Track the run in the unified system (non-blocking — don't fail if DB is unavailable)
  let runId: string | null = null;
  try {
    const { createRun, updateRunStatus, addStep, addArtifact, buildMemoryContext } = await import('./agentRunSystem');
    const run = await createRun({
      circleId, userId, surface: surface as any, title: prompt.slice(0, 100),
      goal: prompt.slice(0, 500), mode, model, roomId: context?.roomId, taskId: context?.taskId,
    });
    if (run) runId = run.id;
  } catch {}

  try {
    // 1. Build the augmented prompt with memory context
    const modePrefix = getModePromptPrefix(mode);
    const contextParts: string[] = [];
    let integrationPreflightSummary: string | null = null;

    // Inject memory context
    try {
      const { buildMemoryContext } = await import('./agentRunSystem');
      const memCtx = await buildMemoryContext(circleId, context?.roomId, userId, request.agentId, request.agentName);
      if (memCtx) contextParts.push(memCtx);
    } catch {}

    const inferredProfileKey = request.capabilityProfile || inferTaskCapabilityProfile({
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
      modePrefix,
      ...contextParts,
      prompt,
    ]
      .filter(Boolean)
      .join('\n\n');

    // 2. Build SwanBot context
    const swanContext: SwanBotContext = {
      userId,
      circleId,
      userName,
      agentId: request.agentId,
      agentName: request.agentName,
      model: model || undefined,
      chatHistory: context?.chatHistory,
    };

    // Mark run as running
    if (runId) {
      try { const { updateRunStatus } = await import('./agentRunSystem'); await updateRunStatus(runId, 'running'); } catch {}
    }

    // 3. Call SwanBot
    const response = await getSwanBotResponse(fullPrompt, swanContext);

    // 4. Extract artifacts from the response
    const artifacts = extractArtifacts(response);

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
    if (artifacts && artifacts.length > 0) {
      steps.push({
        kind: 'extract',
        title: 'Artifacts extracted',
        summary: `${artifacts.length} artifact(s): ${artifacts.map(a => a.kind).join(', ')}`,
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
        const { updateRunStatus, addStep: addRunStep, addArtifact: addRunArtifact } = await import('./agentRunSystem');
        await addRunStep({ runId, circleId, stepIndex: 0, stepKind: 'message', title: 'Response', body: response.slice(0, 5000) });
        if (artifacts) {
          for (const art of artifacts) {
            await addRunArtifact({ runId, circleId, artifactKind: art.kind as any, title: art.title, content: art.content, url: art.url });
          }
        }
        await updateRunStatus(runId, 'completed');
      } catch {}
    }

    return {
      success: true,
      response,
      artifacts,
      steps,
      handoffSuggestion,
    };
  } catch (err: any) {
    console.error('[AgentRuntime] executeAgentRun failed:', err);
    if (runId) {
      try { const { updateRunStatus } = await import('./agentRunSystem'); await updateRunStatus(runId, 'failed'); } catch {}
    }
    return {
      success: false,
      response: `Something went wrong: ${err?.message || 'Unknown error'}`,
      handoffSuggestion: null,
    };
  }
}
