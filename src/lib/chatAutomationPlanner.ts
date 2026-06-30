import { inferChatCommandExecution, matchesChatCommandRoute, type ChatCommandDecisionSource, type ChatCommandRouteId } from './chatCommandRegistry';
import { isLowRiskLocalImageExportTask, planComputerTaskPreview } from './computerTaskPlanner';
import { classifyBrowserbaseWorkflow } from './browserbaseWorkflowIntent';
import { detectLocalComputerAwarenessIntent, detectLocalComputerAwarenessIntentSequence, getLocalComputerAwarenessRisk } from './localComputerAwarenessIntent';
import {
  getBestUserTaskPipeline,
  buildUserTaskPipelineDecision,
  summarizeUserTaskPipelineMatch,
  type UserTaskPipelineDecision,
  type UserTaskPipelineMatch,
  type UserTaskPipelineSummary,
} from './userTaskPipelines';
import { buildExecutionSurfacePlan, type ExecutionSurfacePlan } from './executionSurfaceRouter';
import { buildAgentRunLedgerPreview, type AgentRunLedgerPreview } from './agentRunLedger';
import { buildComputerAppTaskStrategy } from './computerAppTaskStrategy';
import { buildChatComputerRequestRoute, type ChatComputerRequestRoute } from './chatComputerRequestRouter';
import { summarizeChatComputerRequestUserNotice } from './chatComputerRequestUx';
import { summarizeComputerTaskEvidenceContract } from './computerTaskEvidenceContract';
import { classifyAgentFailure } from './agentFailureTaxonomy';
import {
  buildChatFailureRecoveryExecutionPlan,
  parseChatFailureRecoveryOptionSelection,
  type ChatFailureRecoveryExecutionPlan,
  type ChatFailureRecoveryExecutionPolicy,
} from './chatFailureRecovery';
import { OPENSWAN_AUTOMATION_INTENT_SEED } from './openswanAutomationLaunch';
import {
  inferWpListTargetFromText,
  inferWpPostListStatusFromText,
  type WpListTarget,
  type WpPostListStatus,
} from './wordpressCommandRisk';
import type { ScenarioPolicy } from './scenarioPolicies';
import type { LocalComputerAwarenessKind } from './localComputerAwarenessIntent';

export type PlannerConversationalIntent =
  | { type: 'wordpress_publish'; title?: string; imageUrl?: string; status: 'draft' | 'publish' }
  | { type: 'wordpress_list'; target?: WpListTarget; status?: WpPostListStatus }
  | { type: 'wordpress_schedule'; date?: string; title?: string }
  | { type: 'create_task'; title: string; description?: string }
  | { type: 'office_agent_task'; agentName: string; modelName?: string; taskTarget: 'latest_user_task' | 'latest_circle_task' }
  | { type: 'remember'; content: string }
  | { type: 'forget'; query: string }
  | { type: 'show_memories' }
  | { type: 'generate_image'; prompt: string }
  | { type: 'build_webpage'; description: string }
  | { type: 'none' };

export type ChatAutomationIntent =
  | { kind: 'slash_command'; routeId: ChatCommandRouteId; commandText: string }
  | { kind: 'quick_action'; routeId: ChatCommandRouteId | null; actionText: string; mode: 'send' | 'prefill' | 'special' }
  | { kind: 'natural_command'; routeId: ChatCommandRouteId; commandText: string }
  | { kind: 'conversational_action'; intent: PlannerConversationalIntent; routeId: ChatCommandRouteId | null }
  | { kind: 'direct_chat'; message: string };

export type ChatAutomationExecutionKind =
  | 'local_reply'
  | 'run_plain_chat'
  | 'open_modal'
  | 'run_command_handler'
  | 'run_openswan'
  | 'run_computer_task'
  | 'run_build_discovery'
  | 'run_browser_plan'
  | 'run_circle_automation'
  | 'create_circle_automation'
  | 'suggest_automation_conversion'
  // The request is actionable but underspecified — ask the user for the
  // missing details instead of guessing or fabricating placeholder params.
  | 'ask_clarification';

/**
 * Carried on `execution.clarification` when `kind === 'ask_clarification'`.
 * `missingParams` names the fields we couldn't resolve; the dispatcher/UI
 * may try to fill them from memory before asking (see chatGapFill.ts).
 */
export type ChatAutomationClarification = {
  question: string;
  missingParams: string[];
  reason: string;
  /** The conversational intent we'd run once the gap is filled (for context). */
  pendingIntent?: string | null;
  /** Example answers shown to the user so they know what unblocks the task. */
  examples?: string[];
};

export type ChatAutomationRisk =
  | 'safe'
  | 'review'
  | 'external_side_effect'
  | 'destructive';

export type ChatAutomationApproval =
  | { required: false; reason: null }
  | { required: true; reason: string };

export type ChatAutomationPlan = {
  source: ChatCommandDecisionSource | 'conversational_intent' | 'plain_chat';
  intent: ChatAutomationIntent;
  execution: {
    kind: ChatAutomationExecutionKind;
    routeId: ChatCommandRouteId | null;
    commandText?: string | null;
    modalKey?: string | null;
    clarification?: ChatAutomationClarification | null;
  };
  risk: ChatAutomationRisk;
  approval: ChatAutomationApproval;
  confidence: number;
  notes: string[];
  pipeline?: UserTaskPipelineSummary | null;
  pipelineDecision?: UserTaskPipelineDecision | null;
  scenarioPolicy?: ScenarioPolicy | null;
  surfacePlan?: ExecutionSurfacePlan | null;
  ledgerPreview?: AgentRunLedgerPreview | null;
  computerRequestRoute?: ChatComputerRequestRoute | null;
  recoveryPolicy?: ChatFailureRecoveryExecutionPolicy | null;
  recoveryExecutionPlan?: ChatFailureRecoveryExecutionPlan | null;
};

export type BuildChatAutomationPlanInput = {
  message: string;
  attachments?: Array<{ uri?: string; type?: string; id?: string }>;
  quickActionText?: string | null;
  selectedMode?: string | null;
};

function mapConversationalIntentToRouteId(intentType: PlannerConversationalIntent['type']): ChatCommandRouteId | null {
  switch (intentType) {
    case 'create_task':
    case 'office_agent_task':
      return 'mission';
    case 'wordpress_publish':
    case 'wordpress_list':
    case 'wordpress_schedule':
      return 'wordpress';
    case 'remember':
    case 'forget':
    case 'show_memories':
      return 'memory';
    case 'build_webpage':
      return 'build_page';
    case 'generate_image':
      return 'hf_tools';
    case 'none':
    default:
      return null;
  }
}

function detectPlannerConversationalIntent(
  message: string,
  attachments?: Array<{ uri?: string; type?: string; id?: string }>,
): PlannerConversationalIntent {
  const lower = message.toLowerCase();
  const mentionsWordPress = /\b(wordpress|wp|blog|cms)\b/i.test(message);
  const mentionsWordPressListTarget = /\b(posts?|drafts?|pages?|categories|cats|tags|media library|uploads?)\b/i.test(message);

  if (/\b(schedule|queue|plan)\b.*\b(post|article|blog)\b/i.test(message)) {
    const date = extractPlannerWordPressScheduleDate(message);
    const title = extractPlannerWordPressScheduleTitle(message) || message.slice(0, 80);
    return { type: 'wordpress_schedule', date, title };
  }
  if (/\b(post|publish|upload|send|draft|write|create)\b.*\b(wordpress|wp|blog|site|cms)\b/i.test(message)
    || (mentionsWordPress && /\b(post|publish|upload|send|draft|write|create)\b/i.test(message) && !/\b(list|show|see|get|find)\b/i.test(message))) {
    return {
      type: 'wordpress_publish',
      title: message.slice(0, 80),
      imageUrl: attachments?.find((item) => String(item.type || '').startsWith('image/'))?.uri,
      status: /\b(publish|go live|put it live)\b/i.test(lower) ? 'publish' : 'draft',
    };
  }
  if (/\b(show|list|see|get|find)\b/i.test(message) && mentionsWordPress && mentionsWordPressListTarget) {
    return {
      type: 'wordpress_list',
      target: inferWpListTargetFromText(message),
      status: inferWpPostListStatusFromText(message),
    };
  }
  if (/\b(spin up|create|make)\b.*\b(agent|pixel agent)\b/i.test(message) && /\btask\b/i.test(message)) {
    return {
      type: 'office_agent_task',
      agentName: extractPlannerOfficeAgentName(message) || 'Agent',
      modelName: extractPlannerRequestedModel(message),
      taskTarget: /\btask\s+we\s+just\s+made\b/i.test(message) ? 'latest_user_task' : 'latest_circle_task',
    };
  }
  if (/\b(create|add|make|open)\b.*\b(task|todo|ticket|issue)\b/i.test(message)) {
    return { type: 'create_task', title: message.slice(0, 120) };
  }
  if (/\bremember\b/i.test(message) && !/\b(remember\s+me|checkbox|check\s*box|button|field|input|toggle|switch|menu|control)\b/i.test(message)) {
    return { type: 'remember', content: message.replace(/^(please\s+)?remember\s+/i, '').trim() || message };
  }
  if (/\b(forget|remove|delete|clear)\b.*\b(memory|what you know)\b/i.test(message)) {
    return { type: 'forget', query: message.replace(/^(please\s+)?(forget|remove|delete|clear)\s+/i, '').trim() || message };
  }
  if (/\bwhat do you remember\b|\bshow\b.*\bmemories\b/i.test(message)) {
    return { type: 'show_memories' };
  }
  if (/\b(generate|create|make|draw|design)\b.*\b(image|picture|photo|illustration|artwork|logo|banner|icon)\b/i.test(message)) {
    return { type: 'generate_image', prompt: message };
  }
  return { type: 'none' };
}

function extractPlannerWordPressScheduleDate(message: string): string | undefined {
  const explicitDate = message.match(/\b(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?)\b/);
  if (explicitDate?.[1]) return explicitDate[1];

  const dayMatch = message.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (!dayMatch?.[2]) return undefined;
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const target = days.indexOf(dayMatch[2].toLowerCase());
  if (target < 0) return undefined;
  const now = new Date();
  const diff = ((target - now.getDay()) + 7) % 7 || 7;
  const date = new Date(now.getTime() + diff * 86400000);
  return date.toISOString().split('T')[0];
}

function extractPlannerWordPressScheduleTitle(message: string): string | undefined {
  const quoted = message.match(/(?:titled?|called?|named?|about|on)\s+"([^"]+)"/i);
  if (quoted?.[1]) return quoted[1].trim();

  const about = message.match(/(?:about|on|titled?)\s+(.+?)(?:\s+(?:for|on|at)\s+\d{4}-\d{2}-\d{2}|\s+for\s+next\b|\s+on\s+next\b|$)/i);
  if (about?.[1]) return about[1].trim();

  return undefined;
}

function extractPlannerOfficeAgentName(message: string): string | null {
  const mention = message.match(/@([A-Za-z0-9_-]{2,40})/);
  if (mention?.[1]) return mention[1].trim();

  const quoted = message.match(/\b(?:agent|pixel agent)?\s*(?:called|named)\s+"([^"]+)"/i);
  if (quoted?.[1]) return quoted[1].trim();

  const bare = message.match(/\b(?:agent|pixel agent)?\s*(?:called|named)\s+([A-Za-z0-9_-]{2,40})/i);
  if (bare?.[1]) return bare[1].trim();

  const descriptor = message.match(/\b(?:the\s+)?([A-Z][A-Za-z0-9_-]{1,40})\s+agent\b/);
  if (descriptor?.[1] && descriptor[1].toLowerCase() !== 'pixel') return descriptor[1].trim();

  return null;
}

function extractPlannerRequestedModel(message: string): string | undefined {
  const lower = message.toLowerCase();
  if (/\bopus\b/.test(lower)) return 'claude-opus-4-8';
  if (/\bsonnet\b/.test(lower)) return 'claude-sonnet-4-6';
  if (/\bhaiku\b/.test(lower)) return 'claude-haiku-4-5';
  return undefined;
}

// ── Underspecification detection ────────────────────────────────────────────
// A conversational intent was matched, but the detector can only fabricate a
// placeholder for a required field (create_task copies the whole message in as
// the title; office_agent_task hardcodes agentName:'Agent'). Rather than run
// with a guessed value, ask the user for the missing piece. Kept deliberately
// conservative — only fires when there is essentially NO real content for the
// required field — so well-specified requests are never interrupted.

const CLARIFY_STOP_WORDS = new Set([
  'please', 'the', 'for', 'this', 'that', 'and', 'your', 'some', 'new', 'with',
  'about', 'into', 'onto', 'from', 'just', 'can', 'you', 'could', 'would',
]);

function meaningfulWordCount(text: string): number {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2 && !CLARIFY_STOP_WORDS.has(word))
    .length;
}

function detectConversationalClarification(
  intent: PlannerConversationalIntent,
  message: string,
): ChatAutomationClarification | null {
  switch (intent.type) {
    case 'create_task': {
      const stripped = message.replace(
        /\b(create|add|make|open)\b\s*(a|an|the)?\s*(new\s+)?(task|todo|to-?do|ticket|issue)s?\s*(to|for|about|that|called|named|titled|:|-)?/i,
        ' ',
      );
      if (meaningfulWordCount(stripped) < 1) {
        return {
          question: 'What should the task be? Give me a short title or what needs doing.',
          missingParams: ['task description'],
          reason: 'A task was requested but no task content was provided beyond the command itself.',
          pendingIntent: 'create_task',
          examples: ['Fix the login bug on mobile', 'Draft the Q3 board deck by Friday'],
        };
      }
      return null;
    }
    case 'office_agent_task': {
      if (!extractPlannerOfficeAgentName(message)) {
        return {
          question: 'Which agent should handle this? Name the agent (or @mention it), and confirm the task you want them to take on.',
          missingParams: ['which agent'],
          reason: 'An agent task was requested without naming which agent to assign.',
          pendingIntent: 'office_agent_task',
          examples: ['@Scout', 'the Research agent'],
        };
      }
      return null;
    }
    case 'wordpress_publish':
    case 'wordpress_schedule': {
      if (intent.type === 'wordpress_schedule' && !intent.date) {
        return {
          question: 'When should the WordPress post go live? Give me a future date like 2026-07-01.',
          missingParams: ['publish date'],
          reason: 'A WordPress schedule request was detected without a concrete future date.',
          pendingIntent: 'wordpress_schedule',
          examples: ['2026-07-01', 'Next Monday'],
        };
      }
      const stripped = message
        .replace(/\b(post|publish|upload|send|schedule|queue|plan|draft)\b/ig, ' ')
        .replace(/\b(to|on|the)?\s*(wordpress|wp|blog|site|website)\b/ig, ' ');
      if (meaningfulWordCount(stripped) < 1) {
        return {
          question: 'What should the post say? Give me a title and the content to publish (or notes / a link to turn into a post).',
          missingParams: ['post title', 'post content'],
          reason: 'A WordPress post was requested without a title or body to publish.',
          pendingIntent: intent.type,
          examples: ['Title: “Spring sale” — body: 20% off all plans through June', 'Turn this link into a post: https://…'],
        };
      }
      return null;
    }
    case 'generate_image': {
      const stripped = message
        .replace(/\b(generate|create|make|draw|design|render)\b/ig, ' ')
        .replace(/\b(a|an|the)?\s*(image|picture|photo|illustration|artwork|art|logo|banner|icon|graphic)s?\b/ig, ' ')
        .replace(/\b(of|for|showing|with)\b/ig, ' ');
      if (meaningfulWordCount(stripped) < 1) {
        return {
          question: 'What should the image show? Describe the subject, plus any style, colors, or mood you want.',
          missingParams: ['image subject'],
          reason: 'An image was requested without a subject to depict.',
          pendingIntent: 'generate_image',
          examples: ['a neon swan over a city at night, synthwave', 'a minimal logo for a coffee brand called “Bean There”'],
        };
      }
      return null;
    }
    default:
      return null;
  }
}

function buildClarificationPlan(
  message: string,
  clarification: ChatAutomationClarification,
  pipelineDecision: UserTaskPipelineDecision | null,
): ChatAutomationPlan {
  return {
    source: 'conversational_intent',
    intent: { kind: 'direct_chat', message },
    execution: {
      kind: 'ask_clarification',
      routeId: null,
      commandText: message,
      clarification,
    },
    risk: 'safe',
    approval: { required: false, reason: null },
    confidence: 0.9,
    notes: [`Underspecified request — asking for: ${clarification.missingParams.join(', ')}.`],
    pipelineDecision,
  };
}

function buildConversationalActionPlan(
  message: string,
  conversationalIntent: PlannerConversationalIntent,
): ChatAutomationPlan {
  const routeId = mapConversationalIntentToRouteId(conversationalIntent.type);
  // C1/R6 pre-cutover fix: listing WordPress posts is read-only — it must
  // not inherit the wordpress route's external_side_effect approval gate.
  // wordpress_publish/wordpress_schedule keep the gated path unchanged.
  const risk: ChatAutomationRisk = conversationalIntent.type === 'wordpress_list' ? 'safe' : buildRiskForRoute(routeId);
  return {
    source: 'conversational_intent',
    intent: {
      kind: 'conversational_action',
      intent: conversationalIntent,
      routeId,
    },
    execution:
      conversationalIntent.type === 'build_webpage'
        ? { kind: 'run_build_discovery', routeId, commandText: message }
        : { kind: 'run_command_handler', routeId, commandText: message },
    risk,
    approval: buildApproval(routeId, risk),
    confidence: 0.85,
    notes: ['Matched conversational intent router.'],
  };
}

function buildRiskForRoute(routeId: ChatCommandRouteId | null): ChatAutomationRisk {
  switch (routeId) {
    case 'wordpress':
    case 'schedule':
      return 'external_side_effect';
    case 'browser':
    case 'github':
    case 'governance':
      return 'review';
    default:
      return 'safe';
  }
}

function buildApproval(routeId: ChatCommandRouteId | null, risk: ChatAutomationRisk): ChatAutomationApproval {
  if (risk === 'external_side_effect') {
    return { required: true, reason: `Route ${routeId || 'unknown'} can affect external systems.` };
  }
  if (routeId === 'browser') {
    return { required: true, reason: 'Browser tasks may require manual approval before side effects.' };
  }
  return { required: false, reason: null };
}

function startsWithOpenSwanAutomationSeed(message: string): boolean {
  return message
    .trim()
    .toLowerCase()
    .startsWith(OPENSWAN_AUTOMATION_INTENT_SEED.trim().toLowerCase());
}

function hasReviewLevelMutationIntent(message: string): boolean {
  return /\b(delete|remove|overwrite|publish|submit|send|transfer|checkout|pay|apply|register|rename|change|move|copy|edit|write|save|replace|create)\b/i.test(message);
}

const ACTIONABLE_PIPELINE_IDS = new Set([
  'live_research',
  'knowledge_search',
  'memory_second_brain',
  'browser_data_retrieval',
  'browser_form_submission',
  'browser_navigation',
  'desktop_awareness',
  'bridge_troubleshooting',
  'desktop_app_control',
  'local_files',
  'terminal_agents',
  'vault_credentials',
  'wordpress_cms',
  'website_platform_admin',
  'coding_build',
  'debug_fix',
  'code_review',
  'security_privacy',
  'performance_cost',
  'creative_image_design',
  'creative_layout_design',
  'adobe_creative_cloud',
  'customer_support_crm',
  'sales_leads_outreach',
  'analytics_reporting',
  'meetings_calendar_email',
  'data_import_export',
  'finance_billing',
  'document_intelligence',
  'qa_testing',
  'it_support_ops',
  'compliance_monitoring',
  'hr_onboarding',
  'marketing_campaigns',
  'workflow_recording_replay',
  'travel_booking',
  'procurement_shopping',
  'cloud_devops',
  'social_community',
  'inbox_notifications',
  'learning_training',
  'high_stakes_advice',
  'tasks_missions',
  'office_agents',
  'integrations_models',
  'schedule_automation',
  'governance_approvals',
  'human_verification',
] as const);

function buildCommandTextFromPipeline(match: UserTaskPipelineMatch, message: string): string {
  const command = match.pipeline.defaultCommand;
  if (!command) return message;
  if (command.endsWith(' ')) return `${command}${message}`.trim();
  return command;
}

function buildPlanFromPipeline(
  match: UserTaskPipelineMatch,
  message: string,
  decision: UserTaskPipelineDecision | null,
): ChatAutomationPlan | null {
  if (!ACTIONABLE_PIPELINE_IDS.has(match.pipeline.id as any)) return null;
  if (match.confidence < 0.5) return null;
  const routeId = match.pipeline.routeId;
  const risk = match.pipeline.risk as ChatAutomationRisk;
  const pipeline = summarizeUserTaskPipelineMatch(match);
  const surfacePlan = buildExecutionSurfacePlan({ message, pipeline, pipelineDecision: decision });
  const ledgerPreview = buildAgentRunLedgerPreview({ message, pipeline, pipelineDecision: decision, surfacePlan });
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message },
    execution: {
      kind: match.pipeline.executionKind,
      routeId,
      commandText: buildCommandTextFromPipeline(match, message),
    },
    risk,
    approval: buildApproval(routeId, risk),
    confidence: Math.max(0.55, Math.min(0.92, match.confidence)),
    notes: [`Matched user task pipeline: ${match.pipeline.title}.`, ...match.reasons.slice(0, 2)],
    pipeline,
    pipelineDecision: decision,
    scenarioPolicy: surfacePlan?.policy || null,
    surfacePlan,
    ledgerPreview,
  };
}

function looksLikeComputerTask(message: string): boolean {
  const lower = String(message || '').trim().toLowerCase();
  if (!lower) return false;
  if (/\b(use computer|on my computer|check my computer|search my computer|find on my computer|scan my computer|local files|local computer files|hard drive|home folder)\b/i.test(lower)) {
    return true;
  }
  const preview = planComputerTaskPreview(message);
  return preview.kind !== 'unknown';
}

function looksLikeBrowserbaseWorkflow(message: string): boolean {
  return classifyBrowserbaseWorkflow(message).kind !== 'general_browser';
}

function looksLikeHybridBrowserFileTransfer(message: string): boolean {
  const text = String(message || '');
  return /\b(upload|attach|choose file|select file|import|download|export|save (?:this )?(?:page|webpage|site|report|csv|pdf)|save as pdf|print to pdf)\b/i.test(text)
    && /\b(browser|website|webpage|web page|page|site|shopify|wordpress|wp|webflow|wix|squarespace|woocommerce|bigcommerce|framer|cms|admin|product page|media library)\b/i.test(text);
}

function looksLikeAgentAssetAcquisition(message: string): boolean {
  return buildComputerAppTaskStrategy(message)?.id === 'agent_asset_acquisition';
}

function looksLikeAgentFailureRecoveryRequest(message: string): boolean {
  const text = String(message || '');
  if (parseChatFailureRecoveryOptionSelection(text)) return true;
  const assessment = classifyAgentFailure(text);
  if (/\b(connected agent|codex agent|recovery agent|failure recovery|recover failed|failed task|task failed)\b/i.test(text)
    && /\b(fix|diagnose|figure out|why|recover|retry|repair)\b/i.test(text)) {
    return true;
  }
  return assessment.failureClass !== 'unknown'
    && /\b(fix|diagnose|figure out|why|recover|retry|repair|agent|codex|openswan)\b/i.test(text);
}

function shouldUseComputerTaskForLocalIntent(kind: LocalComputerAwarenessKind | null | undefined): boolean {
  if (!kind) return false;
  if (kind.startsWith('file_')) return true;
  return [
    'notes_create',
    'open_path',
    'open_file_search_match',
    'launch_app',
    'focus_app',
    'window_manage',
    'semantic_click',
    'menu_click',
    'type_text',
    'paste_text',
    'set_field_text',
    'indesign_find_change',
    'press_keys',
    'wait',
    'wait_for_app',
    'mouse_move',
    'mouse_click',
    'mouse_down',
    'mouse_up',
    'mouse_drag',
    'mouse_scroll',
  ].includes(kind);
}

function buildPlanFromLocalComputerSequence(
  normalized: string,
  bestPipeline: UserTaskPipelineMatch | null,
  pipelineDecision: UserTaskPipelineDecision | null,
): ChatAutomationPlan | null {
  const localComputerSequence = detectLocalComputerAwarenessIntentSequence(normalized);
  if (localComputerSequence.length <= 1) return null;
  const sequenceRisks = localComputerSequence.map(getLocalComputerAwarenessRisk);
  const parsedRisk: ChatAutomationRisk = sequenceRisks.includes('external_side_effect')
    ? 'external_side_effect'
    : sequenceRisks.includes('review')
      ? 'review'
      : 'safe';
  const risk: ChatAutomationRisk = isLowRiskLocalImageExportTask(normalized) ? 'safe' : parsedRisk;
  const pipeline = bestPipeline ? summarizeUserTaskPipelineMatch(bestPipeline) : null;
  const surfacePlan = pipeline ? buildExecutionSurfacePlan({ message: normalized, pipeline, pipelineDecision }) : null;
  const ledgerPreview = pipeline ? buildAgentRunLedgerPreview({
    message: normalized,
    pipeline,
    pipelineDecision,
    surfacePlan,
  }) : null;
  const computerRequestRoute = buildChatComputerRequestRoute(normalized, { pipelineDecision });
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: normalized },
    execution: { kind: 'run_computer_task', routeId: 'browser', commandText: normalized },
    risk,
    approval: risk === 'safe'
      ? { required: false, reason: null }
      : { required: true, reason: `Local desktop sequence requires approval for ${localComputerSequence.length} parsed steps.` },
    confidence: 0.93,
    notes: [`Detected multi-step local desktop sequence: ${localComputerSequence.map((step) => step.kind || step.reason).join(' → ')}.`],
    pipeline,
    pipelineDecision,
    scenarioPolicy: surfacePlan?.policy || null,
    surfacePlan,
    ledgerPreview,
    computerRequestRoute,
  };
}

function buildPlanFromLocalComputerIntent(
  normalized: string,
  bestPipeline: UserTaskPipelineMatch | null,
  pipelineDecision: UserTaskPipelineDecision | null,
): ChatAutomationPlan | null {
  const localComputerIntent = detectLocalComputerAwarenessIntent(normalized);
  if (!localComputerIntent.route) return null;
  const useComputerTask = shouldUseComputerTaskForLocalIntent(localComputerIntent.kind);
  const localRisk = getLocalComputerAwarenessRisk(localComputerIntent);
  const risk: ChatAutomationRisk = isLowRiskLocalImageExportTask(normalized)
    ? 'safe'
    : localRisk === 'external_side_effect'
      ? 'external_side_effect'
      : localRisk === 'review'
        ? 'review'
        : 'safe';
  const pipeline = bestPipeline ? summarizeUserTaskPipelineMatch(bestPipeline) : null;
  const surfacePlan = pipeline ? buildExecutionSurfacePlan({ message: normalized, pipeline, pipelineDecision }) : null;
  const ledgerPreview = pipeline ? buildAgentRunLedgerPreview({
    message: normalized,
    pipeline,
    pipelineDecision,
    surfacePlan,
  }) : null;
  const computerRequestRoute = buildChatComputerRequestRoute(normalized, { pipelineDecision });
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: normalized },
    execution: {
      kind: useComputerTask ? 'run_computer_task' : 'run_openswan',
      routeId: useComputerTask ? 'browser' : null,
      commandText: normalized,
    },
    risk,
    approval: risk === 'safe'
      ? { required: false, reason: null }
      : { required: true, reason: `Local desktop ${localComputerIntent.kind || 'action'} requires user-visible bridge approval.` },
    confidence: 0.92,
    notes: [`Detected local desktop bridge intent: ${localComputerIntent.kind || localComputerIntent.reason}.`],
    pipeline,
    pipelineDecision,
    scenarioPolicy: surfacePlan?.policy || null,
    surfacePlan,
    ledgerPreview,
    computerRequestRoute,
  };
}

function buildPlanFromComputerRequestRoute(route: ChatComputerRequestRoute, normalized: string): ChatAutomationPlan {
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: normalized },
    execution: {
      kind: route.executionKind,
      routeId: route.routeId,
      commandText: normalized,
    },
    risk: route.risk,
    approval: route.approvalRequired
      ? { required: true, reason: route.approvalReason || 'Computer/app route requires approval before execution.' }
      : { required: false, reason: null },
    confidence: route.confidence,
    notes: route.notes,
    pipeline: route.selectedPipeline,
    pipelineDecision: route.pipelineDecision,
    scenarioPolicy: route.surfacePlan?.policy || null,
    surfacePlan: route.surfacePlan,
    ledgerPreview: route.ledgerPreview,
    computerRequestRoute: route,
  };
}

function resolvePlannerQuickActionExecution(text: string): { text: string; mode: 'send' | 'prefill' | 'special'; routeId: ChatCommandRouteId | null } {
  switch (text) {
    case '__COMPUTER_USE__':
      return { text, mode: 'special', routeId: 'browser' };
    case '__TIP__':
      return { text, mode: 'special', routeId: null };
    case '__ASSIGN_AGENT__':
    case '__SPAWN_AGENT__':
    case '__SPAWN_AGENTS__':
    case '__LOG_PROOF__':
    case '__STEP_AWAY__':
    case '__OPEN_SEARCH__':
    case '__OPEN_GAMES__':
    case '__SEND_CRYPTO__':
    case '__NUKE__':
      return { text, mode: 'special', routeId: null };
    default:
      if (text.startsWith('/')) {
        const routeIds: ChatCommandRouteId[] = [
          'help', 'summary', 'schedule', 'mission', 'room', 'github', 'wordpress', 'browser', 'build_page', 'hf_tools', 'local_knowledge', 'memory', 'governance', 'search',
        ];
        const matchedRoute = routeIds.find((routeId) => matchesChatCommandRoute(text, routeId)) || null;
        return { text, mode: 'send', routeId: matchedRoute };
      }
      return { text, mode: 'send', routeId: null };
  }
}

export function buildChatAutomationPlan(input: BuildChatAutomationPlanInput): ChatAutomationPlan {
  const normalized = input.message.trim();
  const lower = normalized.toLowerCase();
  const bestPipeline = getBestUserTaskPipeline(normalized, { includeFallback: false });
  const pipelineDecision = buildUserTaskPipelineDecision(normalized, { includeFallback: false });

  if (input.quickActionText) {
    const execution = resolvePlannerQuickActionExecution(input.quickActionText);
    const routeId = execution.routeId || null;
    const risk = buildRiskForRoute(routeId);
    return {
      source: 'quick_action',
      intent: {
        kind: 'quick_action',
        routeId,
        actionText: execution.text,
        mode: execution.mode || 'send',
      },
      execution: execution.mode === 'special'
        ? { kind: 'open_modal', routeId, modalKey: execution.text }
        : routeId === 'browser'
          ? { kind: 'run_browser_plan', routeId, commandText: execution.text }
          : { kind: 'run_command_handler', routeId, commandText: execution.text },
      risk,
      approval: buildApproval(routeId, risk),
      confidence: 1,
      notes: ['Planned from quick action registry.'],
    };
  }

  if (lower.startsWith('/')) {
    const routeIds: ChatCommandRouteId[] = [
      'help', 'summary', 'schedule', 'mission', 'room', 'github', 'wordpress', 'browser', 'build_page', 'hf_tools', 'local_knowledge', 'memory', 'governance', 'search',
    ];
    const matchedRoute = routeIds.find((routeId) => matchesChatCommandRoute(normalized, routeId)) || null;
    const risk = buildRiskForRoute(matchedRoute);
    return {
      source: 'slash',
      intent: {
        kind: 'slash_command',
        routeId: matchedRoute || 'help',
        commandText: normalized,
      },
      execution: matchedRoute === 'browser'
        ? { kind: 'run_browser_plan', routeId: matchedRoute, commandText: normalized }
        : matchedRoute === 'build_page'
          ? { kind: 'run_build_discovery', routeId: matchedRoute, commandText: normalized }
          : { kind: 'run_command_handler', routeId: matchedRoute, commandText: normalized },
      risk,
      approval: buildApproval(matchedRoute, risk),
      confidence: matchedRoute ? 1 : 0.6,
      notes: matchedRoute ? ['Matched explicit slash command route.'] : ['Slash command did not map cleanly; defaulted to handler path.'],
    };
  }

  if (startsWithOpenSwanAutomationSeed(normalized)) {
    const pipeline = bestPipeline ? summarizeUserTaskPipelineMatch(bestPipeline) : null;
    const surfacePlan = pipeline ? buildExecutionSurfacePlan({ message: normalized, pipeline, pipelineDecision }) : null;
    const ledgerPreview = pipeline ? buildAgentRunLedgerPreview({
      message: normalized,
      pipeline,
      pipelineDecision,
      surfacePlan,
    }) : null;
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: { kind: 'run_openswan', routeId: null, commandText: normalized },
      risk: 'safe',
      approval: { required: false, reason: null },
      confidence: 0.88,
      notes: ['Matched OpenSwan repeat-automation seed; planning a reusable workflow instead of executing the target app immediately.'],
      pipeline,
      pipelineDecision,
      scenarioPolicy: surfacePlan?.policy || null,
      surfacePlan,
      ledgerPreview,
    };
  }

  const recoveryOptionSelection = parseChatFailureRecoveryOptionSelection(normalized);
  if (recoveryOptionSelection) {
    const recoveryExecutionPlan = buildChatFailureRecoveryExecutionPlan(recoveryOptionSelection);
    const recoveryPolicy = recoveryExecutionPlan.policy;
    const pipeline = bestPipeline ? summarizeUserTaskPipelineMatch(bestPipeline) : null;
    const surfacePlan = pipeline ? buildExecutionSurfacePlan({ message: normalized, pipeline, pipelineDecision }) : null;
    const ledgerPreview = pipeline ? buildAgentRunLedgerPreview({
      message: normalized,
      pipeline,
      pipelineDecision,
      surfacePlan,
    }) : null;
    const risk: ChatAutomationRisk = recoveryPolicy.action === 'stop_and_report' || recoveryPolicy.action === 'request_user_unblock'
      ? 'safe'
      : recoveryPolicy.allowRuntimePatch || recoveryPolicy.allowBrowserDesktopRetry
        ? 'review'
        : 'review';
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: { kind: 'run_openswan', routeId: null, commandText: normalized },
      risk,
      approval: !recoveryPolicy.requiresApproval
        ? { required: false, reason: null }
        : { required: true, reason: recoveryPolicy.summary },
      confidence: 0.94,
      notes: [
        `Selected recovery option: ${recoveryOptionSelection.optionId}.`,
        `Recovery actor: ${recoveryOptionSelection.actor}.`,
        `Recovery source: ${recoveryOptionSelection.source}.`,
        `Recovery action: ${recoveryPolicy.action}.`,
        `Recovery safety mode: ${recoveryPolicy.safetyMode}.`,
        `Recovery requires fresh evidence: ${recoveryPolicy.requiresFreshEvidence ? 'yes' : 'no'}.`,
        `Recovery allows connected agent: ${recoveryPolicy.allowConnectedAgent ? 'yes' : 'no'}.`,
        `Recovery max attempts: ${recoveryPolicy.maxAttempts}.`,
        `Recovery summary: ${recoveryExecutionPlan.userSummary}.`,
        recoveryExecutionPlan.stopConditions[0]
          ? `Recovery first stop condition: ${recoveryExecutionPlan.stopConditions[0]}.`
          : '',
        recoveryOptionSelection.context?.messageId
          ? `Recovery context message: ${recoveryOptionSelection.context.messageId}.`
          : '',
        recoveryOptionSelection.context?.runId
          ? `Recovery context run: ${recoveryOptionSelection.context.runId}.`
          : '',
        recoveryOptionSelection.context?.sourceSurface
          ? `Recovery context source surface: ${recoveryOptionSelection.context.sourceSurface}.`
          : '',
        recoveryOptionSelection.context?.failureExcerpt
          ? `Recovery context failure excerpt: ${recoveryOptionSelection.context.failureExcerpt.slice(0, 260)}.`
          : '',
      ].filter(Boolean),
      pipeline,
      pipelineDecision,
      scenarioPolicy: surfacePlan?.policy || null,
      surfacePlan,
      ledgerPreview,
      recoveryPolicy,
      recoveryExecutionPlan,
    };
  }

  const earlyConversationalIntent = detectPlannerConversationalIntent(normalized, input.attachments);
  if (earlyConversationalIntent.type === 'office_agent_task') {
    const conversationalClarification = detectConversationalClarification(earlyConversationalIntent, normalized);
    if (conversationalClarification) {
      return buildClarificationPlan(normalized, conversationalClarification, pipelineDecision);
    }
    return buildConversationalActionPlan(normalized, earlyConversationalIntent);
  }

  const localSequencePlan = buildPlanFromLocalComputerSequence(normalized, bestPipeline, pipelineDecision);
  if (localSequencePlan) return localSequencePlan;

  const localIntentPlan = buildPlanFromLocalComputerIntent(normalized, bestPipeline, pipelineDecision);
  if (localIntentPlan) return localIntentPlan;

  if (looksLikeAgentFailureRecoveryRequest(normalized)) {
    const pipeline = bestPipeline ? summarizeUserTaskPipelineMatch(bestPipeline) : null;
    const surfacePlan = pipeline ? buildExecutionSurfacePlan({ message: normalized, pipeline, pipelineDecision }) : null;
    const ledgerPreview = pipeline ? buildAgentRunLedgerPreview({
      message: normalized,
      pipeline,
      pipelineDecision,
      surfacePlan,
    }) : null;
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: { kind: 'run_openswan', routeId: null, commandText: normalized },
      risk: 'review',
      approval: { required: true, reason: 'Failure recovery may ask a connected agent to patch app/runtime code or retry a desktop/browser workflow.' },
      confidence: 0.86,
      notes: ['Detected failed-task recovery request for a connected agent.'],
      pipeline,
      pipelineDecision,
      scenarioPolicy: surfacePlan?.policy || null,
      surfacePlan,
      ledgerPreview,
    };
  }

  const computerRequestRoute = buildChatComputerRequestRoute(normalized, { pipelineDecision });
  if (computerRequestRoute) return buildPlanFromComputerRequestRoute(computerRequestRoute, normalized);

  if (looksLikeAgentAssetAcquisition(normalized)) {
    const pipeline = bestPipeline ? summarizeUserTaskPipelineMatch(bestPipeline) : null;
    const surfacePlan = pipeline ? buildExecutionSurfacePlan({ message: normalized, pipeline, pipelineDecision }) : null;
    const ledgerPreview = pipeline ? buildAgentRunLedgerPreview({
      message: normalized,
      pipeline,
      pipelineDecision,
      surfacePlan,
    }) : null;
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: { kind: 'run_computer_task', routeId: 'browser', commandText: normalized },
      risk: 'review',
      approval: { required: true, reason: 'Codex asset acquisition can download, generate, install, or write local files.' },
      confidence: 0.87,
      notes: ['Detected Codex-backed asset acquisition workflow.'],
      pipeline,
      pipelineDecision,
      scenarioPolicy: surfacePlan?.policy || null,
      surfacePlan,
      ledgerPreview,
    };
  }

  if (looksLikeHybridBrowserFileTransfer(normalized)) {
    const pipeline = bestPipeline ? summarizeUserTaskPipelineMatch(bestPipeline) : null;
    const surfacePlan = pipeline ? buildExecutionSurfacePlan({ message: normalized, pipeline, pipelineDecision }) : null;
    const ledgerPreview = pipeline ? buildAgentRunLedgerPreview({
      message: normalized,
      pipeline,
      pipelineDecision,
      surfacePlan,
    }) : null;
    const risk: ChatAutomationRisk = /\b(publish|submit|send|delete|remove|checkout|pay|purchase|book|reserve|upload|import|attach)\b/i.test(normalized)
      ? 'external_side_effect'
      : 'review';
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: { kind: 'run_computer_task', routeId: 'browser', commandText: normalized },
      risk,
      approval: risk === 'external_side_effect'
        ? { required: true, reason: 'Browser/local file transfer can affect external systems.' }
        : { required: false, reason: null },
      confidence: 0.86,
      notes: ['Detected hybrid browser/local-file transfer workflow.'],
      pipeline,
      pipelineDecision,
      scenarioPolicy: surfacePlan?.policy || null,
      surfacePlan,
      ledgerPreview,
    };
  }

  const conversationalIntent = detectPlannerConversationalIntent(normalized, input.attachments);
  if (conversationalIntent.type !== 'none') {
    // If the matched action is missing a required field, ask instead of
    // running with a fabricated placeholder.
    const conversationalClarification = detectConversationalClarification(conversationalIntent, normalized);
    if (conversationalClarification) {
      return buildClarificationPlan(normalized, conversationalClarification, pipelineDecision);
    }
    return buildConversationalActionPlan(normalized, conversationalIntent);
  }

  if (looksLikeBrowserbaseWorkflow(normalized)) {
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: {
        kind: 'run_computer_task',
        routeId: 'browser',
        commandText: normalized,
      },
      risk: hasReviewLevelMutationIntent(normalized)
        ? 'review'
        : 'safe',
      approval: hasReviewLevelMutationIntent(normalized)
        ? { required: true, reason: 'Computer task mutation requires approval before execution.' }
        : { required: false, reason: null },
      confidence: 0.82,
      notes: ['Detected as a Browserbase workflow: web data retrieval, Stagehand semantic browser action, or form submission.'],
    };
  }

  if (bestPipeline && bestPipeline.confidence >= 0.65) {
    const pipelinePlan = buildPlanFromPipeline(bestPipeline, normalized, pipelineDecision);
    if (pipelinePlan) return pipelinePlan;
  }

  const commandExecution = inferChatCommandExecution(normalized);
  if (commandExecution) {
    const risk = buildRiskForRoute(commandExecution.routeId);
    return {
      source: 'natural_language',
      intent: {
        kind: 'natural_command',
        routeId: commandExecution.routeId,
        commandText: commandExecution.commandText,
      },
      execution: commandExecution.routeId === 'browser'
        ? { kind: 'run_browser_plan', routeId: commandExecution.routeId, commandText: commandExecution.commandText }
        : { kind: 'run_command_handler', routeId: commandExecution.routeId, commandText: commandExecution.commandText },
      risk,
      approval: buildApproval(commandExecution.routeId, risk),
      confidence: 0.75,
      notes: ['Matched natural-language command rewrite.'],
    };
  }

  if (bestPipeline) {
    const pipelinePlan = buildPlanFromPipeline(bestPipeline, normalized, pipelineDecision);
    if (pipelinePlan) return pipelinePlan;
  }

  const buildish = /\b(build|landing page|website|site|web app|page)\b/i.test(normalized);
  // Explicit page/site/build phrasing should win over the generic
  // computer-task heuristic — otherwise "build me a landing page" gets
  // misclassified as a hybrid computer task. Only fall through to the
  // computer-task branch when the buildish terms are NOT present.
  if (!buildish && looksLikeComputerTask(normalized)) {
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: {
        kind: 'run_computer_task',
        routeId: 'browser',
        commandText: normalized,
      },
      risk: hasReviewLevelMutationIntent(normalized)
        ? 'review'
        : 'safe',
      approval: hasReviewLevelMutationIntent(normalized)
        ? { required: true, reason: 'Computer task mutation requires approval before execution.' }
        : { required: false, reason: null },
      confidence: 0.72,
      notes: ['Detected as a computer task request spanning browser, files, apps, or hybrid work.'],
    };
  }

  if (buildish) {
    const explicitModeSelected = Boolean(input.selectedMode && input.selectedMode !== 'none');
    return {
      source: 'plain_chat',
      intent: { kind: 'direct_chat', message: normalized },
      execution: explicitModeSelected
        ? { kind: 'run_openswan', routeId: 'build_page', commandText: normalized }
        : { kind: 'run_build_discovery', routeId: 'build_page', commandText: normalized },
      risk: 'safe',
      approval: { required: false, reason: null },
      confidence: 0.55,
      notes: explicitModeSelected
        ? ['Build-like request respects the explicitly selected OpenSwan mode.']
        : ['Build-like request should enter conversational build discovery.'],
    };
  }

  // Ambiguous-but-actionable fallback: the request reads like an action we
  // could take (mutation verbs present) yet the pipeline matcher could not pin
  // it down. Ask rather than running a low-confidence guess. Gated on the
  // pipeline decision's own (conservative) needsClarification signal so plain
  // questions and chit-chat still fall through to direct chat below.
  if (pipelineDecision?.needsClarification && hasReviewLevelMutationIntent(normalized)) {
    return buildClarificationPlan(normalized, {
      question: pipelineDecision.clarificationReason
        ? `Before I run this I need a bit more detail — ${pipelineDecision.clarificationReason} Could you clarify?`
        : 'This looks like an action I can take, but I need a bit more to do it right. What exactly should I do, and to what?',
      missingParams: ['task scope'],
      reason: pipelineDecision.clarificationReason || 'Ambiguous actionable request matched multiple task pipelines.',
      pendingIntent: null,
    }, pipelineDecision);
  }

  const fallbackPipeline = bestPipeline ? summarizeUserTaskPipelineMatch(bestPipeline) : null;
  const fallbackSurfacePlan = fallbackPipeline ? buildExecutionSurfacePlan({
    message: normalized,
    pipeline: fallbackPipeline,
    pipelineDecision,
  }) : null;
  const fallbackLedgerPreview = fallbackPipeline ? buildAgentRunLedgerPreview({
    message: normalized,
    pipeline: fallbackPipeline,
    pipelineDecision,
    surfacePlan: fallbackSurfacePlan,
  }) : null;
  return {
    source: 'plain_chat',
    intent: { kind: 'direct_chat', message: normalized },
    execution: {
      kind: input.selectedMode && input.selectedMode !== 'none' ? 'run_openswan' : 'run_plain_chat',
      routeId: null,
      commandText: normalized,
    },
    risk: 'safe',
    approval: { required: false, reason: null },
    confidence: 0.4,
    notes: ['Default direct chat path.'],
    pipeline: fallbackPipeline,
    pipelineDecision,
    scenarioPolicy: fallbackSurfacePlan?.policy || null,
    surfacePlan: fallbackSurfacePlan,
    ledgerPreview: fallbackLedgerPreview,
  };
}

// ─── Plan vs Act mode (Cline research item 1) ──────────────────────────────
//
// In Plan mode the executor must refuse anything that would mutate external
// state. We base the decision on `execution.kind` + `risk` so it is cheap
// and deterministic (no need to re-inspect the command text).
//
// Allowlist is intentionally tight: read-only kinds + the `suggest_*`
// family. Opening a modal is allowed because the modal itself does not
// side-effect — it just shows UI; the actual run inside the modal is a
// separate plan dispatch that will re-check this gate.

export type ChatMode = 'plan' | 'act';

const READ_ONLY_EXECUTION_KINDS = new Set<ChatAutomationExecutionKind>([
  'local_reply',
  'run_plain_chat',
  'open_modal',
  'suggest_automation_conversion',
  // Asking a clarifying question never mutates external state.
  'ask_clarification',
]);

export function isPlanSafeForPlanMode(plan: ChatAutomationPlan): boolean {
  if (READ_ONLY_EXECUTION_KINDS.has(plan.execution.kind)) return true;
  // Command handlers and openswan turns with safe risk are allowed — these
  // are things like `/help`, `/memory list`, or a plain model chat routed
  // through OpenSwan. Anything with non-safe risk is refused.
  if (
    (plan.execution.kind === 'run_command_handler' || plan.execution.kind === 'run_openswan') &&
    plan.risk === 'safe'
  ) {
    return true;
  }
  return false;
}

/** Short reason string for the UI when Plan mode refuses a dispatch. */
export function describePlanModeRefusal(plan: ChatAutomationPlan): string {
  const route = plan.execution.routeId ? ` (${plan.execution.routeId})` : '';
  switch (plan.execution.kind) {
    case 'run_browser_plan':
      return `Plan mode can't launch browser automations${route}. Switch to Act to continue.`;
    case 'run_build_discovery':
      return `Plan mode can't publish or build pages${route}. Switch to Act to continue.`;
    case 'run_circle_automation':
    case 'create_circle_automation':
      return `Plan mode can't create or run automations${route}. Switch to Act to continue.`;
    default:
      return `Plan mode is read-only. Switch to Act to run this.`;
  }
}

function compactTelemetryText(value: unknown, maxChars = 320): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 16)).trimEnd()}...[truncated]`;
}

function compactRecoveryPolicyForTelemetry(policy?: ChatFailureRecoveryExecutionPolicy | null): Record<string, unknown> | null {
  if (!policy) return null;
  return {
    action: policy.action,
    safetyMode: policy.safetyMode,
    requiresApproval: policy.requiresApproval,
    requiresFreshEvidence: policy.requiresFreshEvidence,
    userActionRequired: policy.userActionRequired,
    allowConnectedAgent: policy.allowConnectedAgent,
    allowRuntimePatch: policy.allowRuntimePatch,
    allowBrowserDesktopRetry: policy.allowBrowserDesktopRetry,
    allowSideEffects: policy.allowSideEffects,
    maxAttempts: policy.maxAttempts,
    summary: compactTelemetryText(policy.summary, 360),
  };
}

function compactRecoveryExecutionPlanForTelemetry(plan?: ChatFailureRecoveryExecutionPlan | null): Record<string, unknown> | null {
  if (!plan) return null;
  return {
    userSummary: compactTelemetryText(plan.userSummary, 260),
    nextSteps: plan.nextSteps.slice(0, 5).map((step) => compactTelemetryText(step, 240)),
    stopConditions: plan.stopConditions.slice(0, 5).map((condition) => compactTelemetryText(condition, 240)),
    policy: compactRecoveryPolicyForTelemetry(plan.policy),
  };
}

export function summarisePlanForTelemetry(plan: ChatAutomationPlan): Record<string, unknown> {
  return {
    source:         plan.source,
    intentKind:     plan.intent.kind,
    executionKind:  plan.execution.kind,
    routeId:        plan.execution.routeId ?? null,
    risk:           plan.risk,
    approvalRequired: plan.approval.required,
    confidence:     plan.confidence,
    notes:          plan.notes,
    pipeline:       plan.pipeline || null,
    pipelineDecision: plan.pipelineDecision || null,
    scenarioPolicy: plan.scenarioPolicy || null,
    surfacePlan:    plan.surfacePlan || null,
    ledgerPreview:  plan.ledgerPreview || null,
    computerRequestRoute: plan.computerRequestRoute
      ? {
          kind: plan.computerRequestRoute.kind,
          routeId: plan.computerRequestRoute.routeId,
          risk: plan.computerRequestRoute.risk,
          approvalRequired: plan.computerRequestRoute.approvalRequired,
          bestPath: compactTelemetryText(plan.computerRequestRoute.bestPath, 280),
          selectedPipelineId: plan.computerRequestRoute.selectedPipeline?.id || null,
          appStrategyId: plan.computerRequestRoute.appStrategy?.id || null,
          designApp: plan.computerRequestRoute.designExecutionPipeline?.appName || null,
          fallbackPipelineIds: plan.computerRequestRoute.fallbackPipelineIds,
          recommendedTools: plan.computerRequestRoute.recommendedTools.slice(0, 10),
          completionProof: plan.computerRequestRoute.completionProof.slice(0, 6),
          userNotice: summarizeChatComputerRequestUserNotice(plan.computerRequestRoute),
          evidenceContract: plan.computerRequestRoute.evidenceContract
            ? summarizeComputerTaskEvidenceContract(plan.computerRequestRoute.evidenceContract)
            : null,
        }
      : null,
    recoveryPolicy: compactRecoveryPolicyForTelemetry(plan.recoveryPolicy),
    recoveryExecutionPlan: compactRecoveryExecutionPlanForTelemetry(plan.recoveryExecutionPlan),
  };
}
