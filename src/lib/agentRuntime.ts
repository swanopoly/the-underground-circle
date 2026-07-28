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
import type { ConnectedProviderSet } from './serviceProfileSouls';
import {
  buildAgentRuntimeSubjectPayload,
  type AgentRuntimeSubjectMetadata,
} from './agentRuntimeSubject';
import { resolveMemoryLookupIds } from './memoryLookupKeyCore';
import {
  deriveAgentTaskTerminalOutcome,
  type AgentTaskCompletionExpectation,
  type AgentTaskTerminalOutcome,
} from './computerTaskOutcome';
import type { ChatAgentContextPack } from './chatAgentContextPack';

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
  agentSubjectKey?: string;
  agentDbId?: string | null;
  agentSessionKey?: string | null;
  agentLegacyIds?: string[];
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata | null;
  targetAgentSubjects?: AgentRuntimeSubjectMetadata[] | null;
  model?: string;
  connectedProviders?: ConnectedProviderSet | string[];
  /**
   * Volatile typed-loop context. Callers should supply only values owned by
   * their live surface; omitting `toolApprovalGate` deliberately keeps
   * ask-before and always-confirm tool calls fail-closed.
   */
  threadId?: SwanBotContext['threadId'];
  activePluginIds?: SwanBotContext['activePluginIds'];
  signal?: SwanBotContext['signal'];
  toolApprovalGate?: SwanBotContext['toolApprovalGate'];
  userConstraints?: SwanBotContext['userConstraints'];
  alwaysConfirmFloor?: SwanBotContext['alwaysConfirmFloor'];
  /**
   * Redacted, bounded plan/guardrail/proof handoff built by the Chat
   * dispatcher. It is injected into the actual model prompt and projected
   * onto run metadata; it is not merely UI preview data.
   */
  agentContextPack?: ChatAgentContextPack;
  /**
   * `response` is ordinary chat: receiving a model response completes the
   * request. `verified_task` is mutation/computer work and fails closed unless
   * the runtime supplies a structured terminal outcome.
   */
  completionExpectation?: AgentTaskCompletionExpectation;
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

function normalizeConnectedProviders(value?: ConnectedProviderSet | string[]): ConnectedProviderSet | undefined {
  if (!value) return undefined;
  const raw = Array.isArray(value) ? value : Array.from(value);
  return new Set(raw.map((provider) => {
    if (provider === 'hugging_face') return 'huggingface';
    if (provider === 'z_ai') return 'zai';
    return provider;
  }));
}

export interface AgentRunResult {
  /** Transport compatibility flag: true means a model response was returned. */
  success: boolean;
  /** Authoritative task-level terminal outcome. */
  terminalOutcome: AgentTaskTerminalOutcome;
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

// ─── Run-outcome memory capture ─────────────────────────────────────────────

/**
 * Distil ONE durable lesson from a finished run, or nothing at all.
 *
 * THE GAP THIS CLOSES: `executeAgentRun` is the single entry point for Chat,
 * Rooms, Feed, Office Terminal AND the Computer-Use / app-automation pipeline,
 * and it created ZERO memories. The two `recordArchiveDerived…` calls beside
 * this one SCORE memories the run consumed (a `memory_evaluations` insert plus
 * an update on an existing row) — they never CREATE one. So "the WP media
 * uploader needs the Add New click before #wp-media-grid exists" and "the
 * Photoshop bridge has no exportLayersToWeb" were thrown away every single run.
 *
 * SAFETY PROPERTIES, in priority order:
 *  1. NEVER fails, slows or alters the run. Every caller invokes this as a bare
 *     `void` with no `await`, the whole body is inside one try/catch, and each
 *     awaited step is individually recoverable. The function returns `void` so
 *     nothing downstream can accidentally depend on it. It is invoked AFTER the
 *     response is already in hand and the run row is already finalized.
 *  2. Credential-shape refusal on BOTH sides: `runOutcomeMemoryCore` refuses
 *     credential-shaped content itself, and the write goes through
 *     `memoryService.saveMemoryWithContext` → `agentRunSystem.saveMemory`,
 *     which is the single `memory_entries` chokepoint carrying the same
 *     `detectCredentialMemoryContent` gate. One standard, two layers.
 *  3. HONEST provenance. `source_run_id` is the real `runId` (uuid-validated —
 *     the column is a uuid, and a bad value would throw inside a fire-and-
 *     forget path), and `source_surface` is the run's REAL surface. It
 *     deliberately does NOT go through `memoryService.saveAgentMemory`, which
 *     hard-codes `sourceSurface: 'feed_task'` for every caller and drops the
 *     run id entirely — that path would make a Chat lesson claim it came from a
 *     Feed task.
 *  4. Bounded. No raw prompt or raw response is persisted: the core emits a
 *     clamped intent line plus at most two clamped, referent-bearing sentences.
 *
 * The shared quality bar (`memoryConsolidation.isHighQualityMemory`) is applied
 * here as the final gate rather than reimplemented in the core, so there is
 * exactly one standard for what a memory is allowed to be.
 */
async function captureRunOutcomeMemory(args: {
  circleId: string;
  userId: string;
  agentId?: string | null;
  agentName?: string | null;
  input: import('./runOutcomeMemoryCore').RunOutcomeMemoryInput;
}): Promise<void> {
  try {
    const { buildRunOutcomeMemory } = await import('./runOutcomeMemoryCore');
    const decision = buildRunOutcomeMemory(args.input);
    if (!decision.capture) return;
    const { memory } = decision;

    const { isHighQualityMemory } = await import('./memoryConsolidation');
    if (!isHighQualityMemory({ kind: memory.memoryKind, title: memory.title, content: memory.content })) return;

    const agentId = typeof args.agentId === 'string' && args.agentId.trim() ? args.agentId.trim() : null;

    // Duplicate lessons are the dilution risk this whole feature has to avoid:
    // a lane that fails the same way every run would otherwise write a
    // near-identical row every run and crowd out everything else. The core's
    // fingerprint excludes the clock and the run id precisely so repeats
    // collide here. Same `.contains('metadata', …)` pattern
    // `memoryService.upsertAgentMemoryTarget` already uses.
    try {
      let query = supabase
        .from('memory_entries')
        .select('id')
        .eq('circle_id', args.circleId)
        .eq('is_active', true)
        .contains('metadata', { runOutcomeFingerprint: memory.fingerprint })
        .limit(1);
      if (agentId) query = query.eq('agent_id', agentId);
      else query = query.eq('user_id', args.userId);
      const { data: existing } = await query;
      if (existing && existing.length > 0) return;
    } catch {
      // A failed dedupe probe must not block the lesson — a rare duplicate is
      // strictly better than losing the capture.
    }

    const { saveMemoryWithContext } = await import('./memoryService');
    await saveMemoryWithContext({
      // `agent` scope keeps the lesson with the agent that learned it and is
      // already what `buildMemoryContext` reads back (scopes include 'agent'
      // whenever an agent id resolves). Without an agent id, `user` scope is
      // the honest fallback — also read back — rather than a fabricated key.
      scope: agentId ? 'agent' : 'user',
      circleId: args.circleId,
      userId: args.userId,
      agentId: agentId || undefined,
      memoryKind: memory.memoryKind,
      title: memory.title,
      content: memory.content,
      sourceRunId: memory.sourceRunId || undefined,
      sourceSurface: memory.sourceSurface,
      visibility: 'private',
      importance: memory.importance,
      retrievalMode: memory.retrievalMode,
      sourceType: 'run',
      sourceId: memory.sourceRunId || undefined,
      excerpt: memory.excerpt,
      evaluation: {
        kind: 'quality',
        score: memory.importance,
        passed: true,
        feedback: memory.lessonKind === 'failure'
          ? 'Run blocker distilled at the agent-run finalization barrier.'
          : 'Run pattern distilled at the agent-run finalization barrier.',
      },
      metadata: {
        ...memory.metadata,
        agentId: agentId,
        agentName: typeof args.agentName === 'string' ? args.agentName.slice(0, 120) : null,
        access: agentId ? 'agent_private' : 'user_private',
      },
    });
  } catch {
    // Capture is best-effort by contract. A memory that fails to save must
    // never surface as a run failure.
  }
}

/** Project the immutable chat context pack onto the core's automation input. */
function runOutcomeAutomationInput(
  pack: ChatAgentContextPack | undefined,
): import('./runOutcomeMemoryCore').RunOutcomeAutomationInput | null {
  if (!pack || typeof pack !== 'object') return null;
  return {
    executionKind: pack.executionKind || null,
    routeId: pack.routeId || null,
    risk: pack.risk || null,
    pipelineId: pack.lane?.pipelineId || null,
    pipelineTitle: pack.lane?.pipelineTitle || null,
    category: pack.lane?.category || null,
    pattern: pack.lane?.pattern || null,
    primarySurface: pack.lane?.primarySurface || null,
    recommendedTools: Array.isArray(pack.recommendedTools) ? pack.recommendedTools : null,
  };
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
  const connectedProviders = normalizeConnectedProviders(request.connectedProviders);
  const resolvedModel = resolveModelForProfile(
    profileResolution.resolvedProfile,
    model,
    routeAnalysis.route.intent,
    connectedProviders,
    routeAnalysis.route.complexity,
    undefined,
    // P27: raw message activates the BlackSwan reliability guard on the
    // EXECUTION model — the hard subset of the grounded lane escalates to frontier.
    prompt,
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
  const subjectPayload = buildAgentRuntimeSubjectPayload(request);
  /**
   * Every write key this agent subject has ever used. The subject key rotates
   * (session-derived bridge agent → published `circle_office_agents` uuid, or a
   * bridge reconnect minting a new session key), so a read under the live key
   * alone loses everything the agent wrote before the rotation. The Office
   * memory panel already read alias-aware; the model did not.
   */
  const memoryLookupAliases = resolveMemoryLookupIds(
    subjectPayload.swanContextPatch.agentSubjectKey || request.agentId,
    [
      subjectPayload.subject?.legacyAgentIds,
      subjectPayload.subject?.agentDbId,
      subjectPayload.subject?.agentSessionKey,
      subjectPayload.swanContextPatch.agentLegacyIds,
      subjectPayload.swanContextPatch.agentDbId,
      subjectPayload.swanContextPatch.agentSessionKey,
      request.agentId,
      request.agentDbId,
      request.agentSessionKey,
      request.agentLegacyIds,
    ],
  );
  const agentContextPrompt = typeof request.agentContextPack?.compactPrompt === 'string'
    ? request.agentContextPack.compactPrompt.trim().slice(0, 3_000)
    : '';
  const agentContextMetadata = agentContextPrompt
    ? {
        version: request.agentContextPack?.version || 'chat_agent_context_pack_v1',
        executionKind: String(request.agentContextPack?.executionKind || '').slice(0, 80),
        routeId: request.agentContextPack?.routeId
          ? String(request.agentContextPack.routeId).slice(0, 120)
          : null,
        risk: String(request.agentContextPack?.risk || '').slice(0, 40),
        compactPrompt: agentContextPrompt,
      }
    : null;

  // Track the run in the unified system (non-blocking — don't fail if DB is unavailable)
  let runId: string | null = null;
  try {
    const { createRun, updateRunStatus, addStep, addArtifact, buildMemoryContext } = await import('./agentRunSystem');
    const run = await createRun({
      circleId, userId, surface: surface as any, title: prompt.slice(0, 100),
      goal: prompt.slice(0, 500), mode, model: resolvedModel, roomId: context?.roomId, taskId: context?.taskId,
      metadata: {
        ...subjectPayload.runMetadata,
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
        connectedProviders: connectedProviders ? Array.from(connectedProviders) : [],
        ...(agentContextMetadata ? { chatAgentContextPack: agentContextMetadata } : {}),
      },
    });
    if (run) runId = run.id;
  } catch {}

  try {
    // 1. Build the augmented prompt with memory context
    const modeContract = buildOpenSwanModeResponseContract(mode);
    const contextParts: string[] = [];
    let integrationPreflightSummary: string | null = null;
    if (agentContextPrompt) contextParts.push(agentContextPrompt);

    // Inject memory context
    try {
      const { buildMemoryContext } = await import('./agentRunSystem');
      const memCtx = await buildMemoryContext(
        circleId,
        context?.roomId,
        userId,
        subjectPayload.swanContextPatch.agentSubjectKey || request.agentId,
        subjectPayload.swanContextPatch.agentName || request.agentName,
        memoryLookupAliases,
      );
      // SECURITY (2026-07-24): retrieved memory is UNTRUSTED content (CLAUDE.md
      // Critical Guarantees). buildMemoryContext splices together memory_entries
      // rows AND the free-text circle_memory shared doc, any of which a circle
      // member or a save_memory-holding agent can author. This is the memory
      // path for every agent run, Kanban task run and computer task — i.e. the
      // surfaces that actually execute tools — so it was the highest-leverage
      // unfenced injection point in the app.
      if (memCtx) {
        const { wrapUntrusted } = await import('./untrustedContent');
        const fenced = wrapUntrusted(memCtx);
        if (fenced) contextParts.push(`## Memory Context\n${fenced}`);
      }
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
      ...subjectPayload.swanContextPatch,
      model: resolvedModel || undefined,
      chatHistory: context?.chatHistory,
      sessionArchiveContext: context?.sessionArchiveContext,
      modeKey: modePolicy.key,
      taskKind: activeTaskKind,
      sessionProfile: profileResolution.resolvedProfile,
      resolvedSkills: skillResolution.skills,
      resolvedSkillsPromptBlock: skillResolution.promptBlock,
      threadId: request.threadId,
      activePluginIds: request.activePluginIds,
      signal: request.signal,
      toolApprovalGate: request.toolApprovalGate,
      userConstraints: request.userConstraints,
      alwaysConfirmFloor: request.alwaysConfirmFloor,
    };

    // Mark run as running
    if (runId) {
      try { const { updateRunStatus } = await import('./agentRunSystem'); await updateRunStatus(runId, 'running'); } catch {}
    }

    // 3. Call SwanBot
    const response = await getSwanBotResponse(fullPrompt, swanContext);
    const terminalOutcome = deriveAgentTaskTerminalOutcome({
      transportSuccess: true,
      expectation: request.completionExpectation,
    });

    // 4. Extract artifacts from the response
    const artifacts = extractArtifacts(response);
    const modeOutcomeSummary = buildModeOutcomeSummary(mode, response, artifacts);
    const modeSummaryArtifacts = buildModeSummaryArtifacts(mode, modeOutcomeSummary, response) || [];
    const persistedArtifacts = [...(artifacts || []), ...modeSummaryArtifacts];
    const observedEval = buildOpenSwanObservedEvalSummary({
      run: {
        // Agent-run status is transport lifecycle, not task proof. A returned
        // response completes the run even when taskTerminalOutcome remains
        // inconclusive.
        status: 'completed',
        mode: mode || 'talk',
        provider: 'openswan',
        metadata: {
          explicitMode: modePolicy.key,
          resolvedSessionProfile: profileResolution.resolvedProfile,
          routingIntent: routeAnalysis.route.intent,
          modeOutcomeSummary,
          taskTerminalOutcome: terminalOutcome,
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
        terminalOutcome.status === 'completed'
          ? recordArchiveDerivedMemorySuccess({
              memoryReferences: context?.memoryRefs || [],
              observedEval,
              userId,
              source: 'agent_runtime_passive_success',
              runId,
            })
          : Promise.resolve(),
        recordArchiveDerivedMemoryWeakSignal({
          memoryReferences: context?.memoryRefs || [],
          observedEval,
          userId,
          source: 'agent_runtime_passive_weak_signal',
          runId,
        }),
      ]))
      .catch(() => {});

    // 4b. Distil a durable lesson from this run (see captureRunOutcomeMemory).
    // Fires at the finalization barrier, beside the archive-derived SCORING
    // above — which never creates a memory. Bare `void`: not awaited, cannot
    // fail, cannot slow, cannot alter the run.
    void captureRunOutcomeMemory({
      circleId,
      userId,
      agentId: subjectPayload.swanContextPatch.agentSubjectKey || request.agentId || null,
      agentName: subjectPayload.swanContextPatch.agentName || request.agentName || null,
      input: {
        nowMs: Date.now(),
        runId,
        surface,
        mode,
        taskKind: activeTaskKind,
        profile: profileResolution.resolvedProfile,
        impactDomain: inferredProfile?.impactDomain || null,
        routingIntent: routeAnalysis.route.intent,
        prompt,
        response,
        terminalStatus: terminalOutcome.status,
        terminalReason: terminalOutcome.reason,
        observedEval,
        artifacts: persistedArtifacts.map((artifact) => ({ kind: artifact.kind, title: artifact.title })),
        automation: runOutcomeAutomationInput(request.agentContextPack),
      },
    });

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
          ...subjectPayload.runMetadata,
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
          taskTerminalOutcome: terminalOutcome,
        });
        await updateRunStatus(runId, 'completed');
      } catch {}
    }

    return {
      success: true,
      terminalOutcome,
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
    const failureOutcome = deriveAgentTaskTerminalOutcome({
      transportSuccess: false,
      structuredStatus: err?.name === 'AbortError' ? 'cancelled' : null,
    });

    // Failure barrier. A failed run is the MORE valuable memory — not
    // repeating it is the product's whole point — so the same fire-and-forget
    // capture runs here. The core refuses `cancelled` outright (a user abort
    // teaches nothing) and refuses generic reasons like "Unknown error".
    // `inferredProfile` is scoped inside the try above, so this path passes
    // only what is genuinely in scope rather than guessing.
    void captureRunOutcomeMemory({
      circleId,
      userId,
      agentId: subjectPayload.swanContextPatch.agentSubjectKey || request.agentId || null,
      agentName: subjectPayload.swanContextPatch.agentName || request.agentName || null,
      input: {
        nowMs: Date.now(),
        runId,
        surface,
        mode,
        taskKind: activeTaskKind,
        profile: profileResolution.resolvedProfile,
        routingIntent: routeAnalysis.route.intent,
        prompt,
        response: '',
        errorMessage: typeof err?.message === 'string' ? err.message : '',
        terminalStatus: failureOutcome.status,
        terminalReason: failureOutcome.reason,
        automation: runOutcomeAutomationInput(request.agentContextPack),
      },
    });

    return {
      success: false,
      terminalOutcome: failureOutcome,
      runId,
      response: `Something went wrong: ${err?.message || 'Unknown error'}`,
      handoffSuggestion: null,
      modeOutcomeSummary: null,
      observedEval: null,
    };
  }
}
