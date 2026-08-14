import { type SwanBotStructuredArtifact } from './swanbot';
import { runOpenSwanSessionTurn, type OpenSwanRunCallbacks } from './openswanSessionRuntime';
import { loadFiles, sendAgentMessage, sendMessage } from '../screens/circles/tabs/rooms/roomRepository';
import { type AgenticCodingProfile } from './agenticCodingProfile';
import { isConversationOnlyTurn } from './webSearchAutoDetect';
import { resolveSessionCodingProfile, type SessionCodingProfile } from './chatSessionProfile';
import { buildRoomAgentMessageMetadata, prependRoomTerminalStatus } from './roomMessageMetadata';
import {
  buildChatAutomationPlan,
  formatChatBoundedMultiActionPromptBlock,
} from './chatAutomationPlanner';
import { FILE_PROPOSAL_FORMAT_HINT } from './aiFileProposal';
import {
  boundedRoomFileContent,
  buildActiveRoomFileContext,
  isRoomFileChangeRequest,
  normalizedRoomFilePath,
  type ActiveRoomFileContext,
} from './roomChatFileContext';

export { buildActiveRoomFileContext, isRoomFileChangeRequest } from './roomChatFileContext';

type RoomChatMessage = {
  content: string;
  metadata?: Record<string, unknown>;
  agent_name?: string | null;
};

export type ActiveRoomFile = ActiveRoomFileContext;

type SendRoomChatArgs = {
  roomId: string;
  circleId: string;
  userId: string;
  content: string;
  activeFile?: ActiveRoomFile;
  recentMessages: RoomChatMessage[];
  availableFiles?: Array<{ id: string; name: string }>;
  profile?: SessionCodingProfile;
  /**
   * Extra metadata merged into the user-message row that gets persisted
   * before the AI run. ChatPanel uses this to attach pasted images so
   * they land in room_messages alongside the prompt.
   */
  extraMetadata?: Record<string, unknown>;
  /**
   * Optional system-style instruction prepended to the AI prompt only —
   * the user-visible chat row stays clean. ChatPanel uses this for
   * Plan-mode wrapping ("describe, don't execute") so reviewers see
   * the original ask in the room without the wrapper noise.
   */
  promptPrefix?: string;
  /**
   * Explicit model pick the user has chosen for this turn. Falls back
   * to the soul/intent-based resolver in serviceProfileSouls when not
   * provided (or when set to 'auto').
   */
  modelOverride?: string | null;
  /** Exact providers whose shared account catalog currently has at least one
   * ready text model. Auto may use this to choose an account-backed route;
   * connection labels alone are not execution authority. */
  connectedProviders?: string[];
} & OpenSwanRunCallbacks;

const REVIEW_RE = /review|audit|check.*files|look.*files|scan|analyze.*code|all.*files|code.*quality/i;
const SECURITY_RE = /security|vulnerab|xss|injection|owasp|exploit|auth.*issue|secret|leak|exposed/i;
const PERF_RE = /performance|optimize|slow|fast|speed|memory|bundle.*size|lazy.*load|cache|render/i;
const REFACTOR_RE = /refactor|simplif|clean.*up|dry|extract|decompos|split.*file|too.*long|too.*big|complex/i;
const TEST_RE = /test|spec|unit.*test|integration.*test|coverage|jest|vitest|assert|expect/i;
const DOCS_RE = /document|readme|jsdoc|typedoc|comment|explain.*code|what.*does.*this/i;
const RESEARCH_RE = /research|deep.*dive|how.*does|how.*to|best.*practice|compare|alternatives|pros.*cons|tradeoff/i;
const DEBUG_RE = /debug|error|bug|crash|broken|not.*working|fix.*this|why.*fail|exception|trace/i;
const ARCH_RE = /architect|structure|pattern|design.*pattern|dependency|coupling|solid|separation|layers/i;
const TYPE_RE = /type.*error|typescript|interface|generic|type.*safe|strict|any.*type|infer/i;
const REFERENCED_FILE_CONTEXT_LIMIT = 18_000;
const ALL_FILES_CONTEXT_BUDGET = 54_000;

function buildRoomFileEditContract(content: string, activeFile: ActiveRoomFile): string {
  if (!isRoomFileChangeRequest(content)) return '';
  const targetHint = activeFile ? ` The opened document path is "${normalizedRoomFilePath(activeFile)}".` : '';
  return [
    '[ROOM FILE EDIT CONTRACT]',
    `Read the relevant room file content before drafting changes.${targetHint}`,
    `Return every proposed file change as a complete reviewable edit block. ${FILE_PROPOSAL_FORMAT_HINT}`,
    'Preserve all unchanged content in each replacement block. Do not claim a file was changed until the user applies its card.',
    'For a large persisted file, use rooms.read_file repeatedly with offset/maxChars until the portions needed for a safe edit have been read.',
  ].join(' ');
}

function buildPromptPrefix(content: string): string {
  if (SECURITY_RE.test(content)) return '[SECURITY AUDIT MODE] Analyze the code for security vulnerabilities. Check for: XSS, SQL injection, command injection, insecure secrets handling, missing auth checks, CORS issues, prototype pollution, path traversal, insecure dependencies, exposed API keys. Rate severity (Critical/High/Medium/Low) for each finding. Provide specific line-level fixes.\n\nUser request: ';
  if (PERF_RE.test(content)) return '[PERFORMANCE REVIEW MODE] Analyze the code for performance issues. Check for: unnecessary re-renders, missing memoization, N+1 queries, large bundle imports, unoptimized images, missing lazy loading, expensive computations in render, memory leaks from subscriptions/timers, missing virtualization for long lists. Suggest specific optimizations with code examples.\n\nUser request: ';
  if (REFACTOR_RE.test(content)) return '[REFACTOR MODE] Analyze the code and suggest refactoring improvements. Check for: DRY violations, god objects/functions, unclear naming, excessive nesting, missing abstractions, files that do too much, tightly coupled modules, dead code. Prioritize suggestions by impact. Show before/after code examples.\n\nUser request: ';
  if (TEST_RE.test(content)) return '[TEST GENERATION MODE] Generate comprehensive tests for the code. Include: unit tests for pure functions, integration tests for API calls, edge cases, error paths, boundary values, mocking strategies for external dependencies. Use the project testing conventions. Output complete runnable test files.\n\nUser request: ';
  if (DOCS_RE.test(content)) return '[DOCUMENTATION MODE] Generate clear, useful documentation. Include: function/component purpose, parameters with types, return values, usage examples, edge cases, related functions. Match the project existing doc style. Be concise but complete.\n\nUser request: ';
  if (RESEARCH_RE.test(content)) return '[DEEP RESEARCH MODE] Provide thorough, well-researched analysis. Include: current best practices, comparison of approaches with tradeoffs, real-world examples, concrete recommendations with reasoning. Structure with clear headings and go deep.\n\nUser request: ';
  if (DEBUG_RE.test(content)) return '[DEBUG MODE] Help diagnose and fix the issue. Approach systematically: expected vs actual behavior, likely causes, stack-specific pitfalls, debugging steps, and the fix with explanation.\n\nUser request: ';
  if (ARCH_RE.test(content)) return '[ARCHITECTURE REVIEW MODE] Analyze the code architecture. Evaluate separation of concerns, dependency direction, module boundaries, data flow, error handling, state management, API design, and scalability. Provide specific recommendations.\n\nUser request: ';
  if (TYPE_RE.test(content)) return '[TYPE ANALYSIS MODE] Analyze TypeScript types and suggest improvements. Check for unsafe anys, missing generics, incorrect nullability, unsafe assertions, and simplification opportunities. Show corrected type definitions.\n\nUser request: ';
  if (REVIEW_RE.test(content)) return '[CODE REVIEW MODE] Do a thorough code review. Check correctness, error handling, edge cases, naming clarity, security, performance, accessibility, and maintainability. Organize findings by severity.\n\nUser request: ';
  return '';
}

function needsAllFiles(content: string): boolean {
  return REVIEW_RE.test(content)
    || SECURITY_RE.test(content)
    || PERF_RE.test(content)
    || REFACTOR_RE.test(content)
    || ARCH_RE.test(content);
}

async function buildSpecialContext(
  roomId: string,
  content: string,
  availableFiles: Array<{ id: string; name: string }>,
  activeFile?: ActiveRoomFile,
): Promise<string> {
  if (availableFiles.length === 0) return '';

  const shouldLoadAll = needsAllFiles(content);
  const contentLower = content.toLowerCase();
  const mentionedIds = new Set(
    availableFiles
      .filter(file => contentLower.includes(`@${file.name.toLowerCase()}`))
      .map(file => file.id),
  );
  if (!shouldLoadAll && mentionedIds.size === 0) {
    return `\n\n## ROOM FILE INDEX\n${availableFiles.map(file => `- ${file.name} (id: ${file.id})`).join('\n')}\nUse rooms.read_file with the exact id when file content is needed.`;
  }

  const files = await loadFiles(roomId);
  if (files.length === 0) return '';
  const activeId = activeFile?.id || null;
  const selected = files.filter(file => file.id !== activeId && (shouldLoadAll || mentionedIds.has(file.id)));
  let remaining = shouldLoadAll ? ALL_FILES_CONTEXT_BUDGET : REFERENCED_FILE_CONTEXT_LIMIT * Math.max(1, selected.length);
  const sections: string[] = [];
  for (const file of selected) {
    if (remaining <= 0) break;
    const limit = Math.min(shouldLoadAll ? 12_000 : REFERENCED_FILE_CONTEXT_LIMIT, remaining);
    const excerpt = boundedRoomFileContent(file.content || '', limit);
    const path = normalizedRoomFilePath({ name: file.name, folder: file.folder });
    sections.push([
      `### ${path}`,
      `File id: ${file.id} · ${file.fileType || 'text'} · ${(file.content || '').length.toLocaleString()} chars${excerpt.truncated ? ' · bounded' : ' · complete'}`,
      '```',
      excerpt.body,
      '```',
    ].join('\n'));
    remaining -= excerpt.body.length;
  }
  const heading = shouldLoadAll ? `ALL ROOM FILES (${files.length})` : `REFERENCED ROOM FILES (${selected.length})`;
  return `\n\n## ${heading}\n${sections.join('\n\n')}`;
}

/**
 * Room messages are immutable under the shipped RLS contract, so agent output
 * has exactly one durable writer: the canonical INSERT path. A null returned id
 * is an unverified write, not success.
 */
async function persistRoomAgentOutput({
  roomId,
  content,
  metadata,
}: {
  roomId: string;
  content: string;
  metadata: Record<string, unknown>;
}): Promise<string> {
  const messageId = await sendAgentMessage(roomId, 'Agent', content, metadata);
  if (!messageId) {
    throw new Error('The agent response could not be saved to this room.');
  }
  return messageId;
}

export async function sendRoomStructuredChatMessage({
  roomId,
  circleId,
  userId,
  content,
  activeFile,
  recentMessages,
  availableFiles = [],
  profile,
  onStageChange,
  onToolApproval,
  extraMetadata,
  promptPrefix,
  modelOverride,
  connectedProviders,
}: SendRoomChatArgs): Promise<{ response: string; artifacts: SwanBotStructuredArtifact[] }> {
  const attachedMetadata: Record<string, unknown> = {
    ...(activeFile ? { attached_file: activeFile.name } : {}),
    ...(extraMetadata || {}),
  };
  // sendMessage swallows its failure and returns null, and this return value
  // used to be discarded — so an RLS denial produced: composer clears, agent
  // types and replies, and the user's own message was never saved. After a
  // refresh the thread showed only the agent's half of the conversation.
  // Stop the turn instead; dispatchAiPrompt's catch surfaces it.
  const sentMessageId = await sendMessage(roomId, userId, content, 'chat', attachedMetadata);
  if (!sentMessageId) {
    throw new Error('Your message could not be saved to this room — nothing was sent.');
  }

  const cleanContent = content.replace(/@(agent|blackswan|swanbot|swan)\s*/gi, '').trim() || content;

  // Main-chat parity: a pure social turn ("hey", "thanks") answers through
  // the plain SwanBot lane and never enters the task runtime — no task plan,
  // no tools, no verification checks, no quality grade, no run card. Tool
  // runs and their accountability cards stay for actual room work.
  //
  // The guard is isConversationOnlyTurn — the same deliberately narrow
  // whole-message greeting list main Chat trusts to skip web search — NOT
  // the smart-route intent classifier: probing showed detectSmartRoute
  // labels "hey, can you fix auth.ts" casual/trivial (the greeting prefix
  // dominates), which would swallow real work into a toolless reply. The
  // pattern list requires the greeting to BE the message, so any trailing
  // request routes through the full runtime.
  if (isConversationOnlyTurn(cleanContent)) {
    const { getSwanBotResponse } = await import('./swanbot');
    const casualHistory = recentMessages
      .slice(-6)
      .map(message => `${message.metadata?.bot ? 'Agent' : 'User'}: ${(message.content || '').slice(0, 200)}`)
      .join('\n');
    const casualReply = await getSwanBotResponse(cleanContent, {
      userId,
      circleId,
      chatHistory: casualHistory,
      ...(modelOverride && modelOverride !== 'auto' ? { model: modelOverride } : {}),
    });
    await persistRoomAgentOutput({ roomId, content: casualReply, metadata: { bot: true, bot_name: 'Agent', generating: false } });
    return { response: casualReply, artifacts: [] };
  }
  const callerPrefix = promptPrefix ? `${promptPrefix.trim()}\n\n` : '';
  // Room Chat uses the same classify-once planner as main Chat. Most room
  // turns remain unchanged; a genuine bounded compound request carries the
  // canonical A1-A3 ledger into the one OpenSwan turn instead of letting a
  // first-match route silently drop a sibling action.
  const automationPlan = buildChatAutomationPlan({
    message: cleanContent,
    selectedMode: 'room_chat',
  });
  if (automationPlan.multiActionOverflow) {
    const fallbackClarification = `I found ${automationPlan.multiActionOverflow.actionCount} separate actions. Please send them in batches of up to ${automationPlan.multiActionOverflow.maxActionsPerTurn}.`;
    const clarificationContent = automationPlan.execution.kind === 'ask_clarification'
      ? automationPlan.execution.clarification?.question || fallbackClarification
      : fallbackClarification;
    const clarificationMetadata: Record<string, unknown> = {
      bot: true,
      bot_name: 'Agent',
      generating: false,
      clarification: true,
      clarification_reason: 'multi_action_limit',
      multi_action_overflow: {
        schema_version: automationPlan.multiActionOverflow.schemaVersion,
        action_count: automationPlan.multiActionOverflow.actionCount,
        max_actions_per_turn: automationPlan.multiActionOverflow.maxActionsPerTurn,
      },
    };
    await persistRoomAgentOutput({
      roomId,
      content: clarificationContent,
      metadata: clarificationMetadata,
    });
    return { response: clarificationContent, artifacts: [] };
  }
  const isPlanOnlyTurn = /^\[PLAN-ONLY MODE\b/.test(promptPrefix?.trimStart() || '');
  const multiActionPromptBlock = formatChatBoundedMultiActionPromptBlock(automationPlan);
  const runtimeUserRequest = multiActionPromptBlock
    ? `${multiActionPromptBlock}\n\nUser's complete request:\n${cleanContent}`
    : cleanContent;
  const recentContext = recentMessages
    .slice(-8)
    .map(message => `${message.metadata?.bot ? 'Agent' : 'User'}: ${(message.content || '').slice(0, 200)}`)
    .join('\n');

  const fileContext = buildActiveRoomFileContext(activeFile);
  const specialContext = await buildSpecialContext(roomId, cleanContent, availableFiles, activeFile);
  const fileEditContract = buildRoomFileEditContract(cleanContent, activeFile);

  // Pass the user's model selection through unchanged. Anthropic short ids
  // ('claude-...') run on the platform Claude path; provider-prefixed ids
  // ('openrouter/...', 'huggingface/...', 'replicate/...') get routed inside
  // the swanbot-ai edge function via the connected marketplace integration
  // (Phase 2). 'auto' / empty falls back to the soul/intent resolver.
  const normalizedModel = !modelOverride || modelOverride === 'auto' ? undefined : modelOverride;

  let structured: import('./openswanSessionRuntime').OpenSwanTurnResult;
  try {
    structured = await runOpenSwanSessionTurn({
      message: `${callerPrefix}${fileEditContract ? `${fileEditContract}\n\n` : ''}${buildPromptPrefix(cleanContent)}${runtimeUserRequest}`,
      originalUserTaskText: content,
      context: {
        userId,
        circleId,
        chatHistory: recentContext + fileContext + specialContext,
        ...(normalizedModel ? { model: normalizedModel } : {}),
      },
      connectedProviders,
      surface: 'room_chat',
      roomId,
      // `room_chat` is a surface, not one of the runtime's tool modes. Keep
      // that legacy mode for ordinary/plan-only turns, but use the supported
      // execute mode for an actionable A-ledger so tagged Room tools such as
      // tasks.create, wp.update_post, and schedule_action remain available.
      mode: automationPlan.multiActionLedger && !isPlanOnlyTurn ? 'execute' : 'room_chat',
      title: cleanContent.slice(0, 100) || 'Room Chat',
      goal: cleanContent.slice(0, 500),
      sessionProfile: resolveSessionCodingProfile(profile || 'auto', cleanContent, 'room_chat'),
      ...(automationPlan.multiActionLedger
        ? { multiActionContract: automationPlan.multiActionLedger }
        : {}),
      metadata: {
        availableFileCount: availableFiles.length,
        activeFileName: activeFile?.name || null,
        activeFileId: activeFile?.id || null,
        activeFileLocalDraft: activeFile?.local_draft === true,
      },
      onStageChange,
      onToolApproval,
    });
  } catch (err: any) {
    const failureContent = `Run failed: ${err?.message || 'unknown error'}. Try again or simplify the request.`;
    await persistRoomAgentOutput({
      roomId,
      content: failureContent,
      metadata: { bot: true, bot_name: 'Agent', error: true, generating: false },
    });
    // The persisted failure row is the one final bot response for this turn.
    // Returning it avoids making callers append a second generic error row.
    return { response: failureContent, artifacts: [] };
  }

  const artifacts = structured.artifacts || [];
  const finalMetadata = buildRoomAgentMessageMetadata(structured, artifacts);
  const finalContent = prependRoomTerminalStatus(structured.response, structured.terminal);
  // Local Room UI owns the transient typing state. Persist the immutable final
  // row once and do not report a saved response without its returned id.
  await persistRoomAgentOutput({
    roomId,
    content: finalContent,
    metadata: finalMetadata,
  });

  return {
    response: finalContent,
    artifacts,
  };
}
