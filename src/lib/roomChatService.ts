import { type SwanBotStructuredArtifact } from './swanbot';
import { runOpenSwanSessionTurn, type OpenSwanRunCallbacks } from './openswanSessionRuntime';
import { loadFiles, sendAgentMessage, sendMessage } from '../screens/circles/tabs/rooms/roomRepository';
import { type AgenticCodingProfile } from './agenticCodingProfile';
import { resolveSessionCodingProfile, type SessionCodingProfile } from './chatSessionProfile';
import { buildRoomAgentMessageMetadata } from './roomMessageMetadata';

type RoomChatMessage = {
  content: string;
  metadata?: Record<string, unknown>;
  agent_name?: string | null;
};

type ActiveRoomFile = {
  name: string;
  content: string;
  file_type: string;
} | null | undefined;

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
): Promise<string> {
  if (needsAllFiles(content)) {
    const files = await loadFiles(roomId);
    if (files.length === 0) return '';
    const fileSummaries = files.map((file) => {
      const truncated = (file.content || '').slice(0, 3000);
      return `\n--- ${file.name} (${file.fileType || 'text'}, ${file.sizeBytes || 0}B) ---\n${truncated}${(file.content || '').length > 3000 ? '\n... (truncated)' : ''}`;
    });
    return `\n\n## ALL ROOM FILES (${files.length} files)\n${fileSummaries.join('\n')}`;
  }

  if (availableFiles.length > 0) {
    return `\n\nRoom files available: ${availableFiles.map(file => file.name).join(', ')}`;
  }

  return '';
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
  extraMetadata,
  promptPrefix,
}: SendRoomChatArgs): Promise<{ response: string; artifacts: SwanBotStructuredArtifact[] }> {
  const attachedMetadata: Record<string, unknown> = {
    ...(activeFile ? { attached_file: activeFile.name } : {}),
    ...(extraMetadata || {}),
  };
  await sendMessage(roomId, userId, content, 'chat', attachedMetadata);

  const cleanContent = content.replace(/@(agent|blackswan|swanbot|swan)\s*/gi, '').trim() || content;
  const callerPrefix = promptPrefix ? `${promptPrefix.trim()}\n\n` : '';
  const recentContext = recentMessages
    .slice(-8)
    .map(message => `${message.metadata?.bot ? 'Agent' : 'User'}: ${(message.content || '').slice(0, 200)}`)
    .join('\n');

  const fileContext = activeFile
    ? `\n\nCurrently viewing file: ${activeFile.name} (${activeFile.file_type || 'text'})\nFile content (first 2000 chars):\n${(activeFile.content || '').slice(0, 2000)}`
    : '';
  const specialContext = await buildSpecialContext(roomId, cleanContent, availableFiles);
  const structured = await runOpenSwanSessionTurn({
    message: `${callerPrefix}${buildPromptPrefix(cleanContent)}${cleanContent}`,
    context: {
      userId,
      circleId,
      chatHistory: recentContext + fileContext + specialContext,
    },
    surface: 'room_chat',
    roomId,
    mode: 'room_chat',
    title: cleanContent.slice(0, 100) || 'Room Chat',
    goal: cleanContent.slice(0, 500),
    sessionProfile: resolveSessionCodingProfile(profile || 'auto', cleanContent, 'room_chat'),
    metadata: {
      availableFileCount: availableFiles.length,
      activeFileName: activeFile?.name || null,
    },
    onStageChange,
  });

  const artifacts = structured.artifacts || [];
  await sendAgentMessage(roomId, 'Agent', structured.response, buildRoomAgentMessageMetadata(structured, artifacts));

  return {
    response: structured.response,
    artifacts,
  };
}
