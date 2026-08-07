/**
 * Source-wiring smoke for Chat image descriptions handed to connected coding
 * agents. This intentionally complements the visual-brief unit/runtime smokes:
 * it proves the Chat dispatcher composes those pieces without reviving the old
 * base64-prefix prompt or turning an image upload into an implicit OpenSwan run.
 *
 * Run: npx tsx scripts/chat-connected-agent-image-handoff-wiring-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chatPath = 'src/screens/circles/tabs/ChatTab.tsx';
const terminalControlPath = 'src/lib/terminalAgentControl.ts';
const terminalLaunchPath = 'src/lib/terminalAgentSessionLauncher.ts';

const chat = readFileSync(chatPath, 'utf8');
const terminalControl = readFileSync(terminalControlPath, 'utf8');
const terminalLaunch = readFileSync(terminalLaunchPath, 'utf8');

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function countMatches(value: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  return Array.from(value.matchAll(new RegExp(pattern.source, flags))).length;
}

function section(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `${label}: start marker exists`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `${label}: end marker exists`);
  assert.ok(endIndex > startIndex, `${label}: markers are ordered`);
  return source.slice(startIndex, endIndex);
}

function assertInOrder(source: string, needles: readonly string[], label: string): void {
  let cursor = 0;
  for (const needle of needles) {
    const index = source.indexOf(needle, cursor);
    assert.notEqual(index, -1, `${label}: ${JSON.stringify(needle)} appears after the prior guard`);
    cursor = index + needle.length;
  }
}

// The former helper embedded only a short base64 prefix and asked a text model
// to infer image contents. Chat must never return to that fabricated-vision path.
assert.ok(!chat.includes('prepareImageForAI'), 'ChatTab no longer imports or calls prepareImageForAI');
assert.ok(!chat.includes('Base64 preview'), 'ChatTab has no base64-preview prompt');
assert.doesNotMatch(
  chat,
  /base64[\s\S]{0,40}(?:slice|substring)\s*\(\s*0\s*,\s*200\s*\)/i,
  'ChatTab never sends the first 200 base64 characters as image context',
);

const visualBriefPlumbing = section(
  chat,
  'const turnHasImageAttachments =',
  'const desktopAttachmentCandidates =',
  'turn-scoped visual brief plumbing',
);
const compactPlumbing = compact(visualBriefPlumbing);

// One promise is created lazily per send and reused by every downstream lane.
assert.equal(
  countMatches(chat, /\bbuildChatVisualBriefs\s*\(/),
  1,
  'ChatTab has one visual-analysis call site',
);
assert.equal(
  countMatches(chat, /import\(['"]\.\.\/\.\.\/\.\.\/lib\/chatVisualBrief['"]\)/),
  1,
  'visual runtime is lazy-imported once',
);
assertInOrder(
  compactPlumbing,
  [
    'let visualBriefPromise: Promise<ChatVisualBriefArtifact[]> | null = null;',
    'if (!turnHasImageAttachments || !isVisualBriefScopeCurrent()) return [];',
    'if (!visualBriefPromise) {',
    "visualBriefPromise = import('../../../lib/chatVisualBrief')",
    'buildChatVisualBriefs({',
    'const briefs = await visualBriefPromise;',
  ],
  'lazy single-promise analysis',
);
assert.ok(compactPlumbing.includes('.catch(() => []);'), 'vision transport failure becomes an empty, non-fabricated result');

// An async result from an old thread/circle may not cross into the new thread.
assert.ok(
  compactPlumbing.includes('const visualBriefScope = { circleId, threadId: activeThreadId };'),
  'visual analysis captures both circle and thread identity',
);
assert.ok(
  compactPlumbing.includes('activeThreadScopeRef.current.circleId === visualBriefScope.circleId')
    && compactPlumbing.includes('activeThreadScopeRef.current.threadId === visualBriefScope.threadId'),
  'visual analysis validates both current circle and current thread',
);
assertInOrder(
  compactPlumbing,
  [
    'if (!turnHasImageAttachments || !isVisualBriefScopeCurrent()) return [];',
    'buildChatVisualBriefs({',
    'const briefs = await visualBriefPromise;',
    'return isVisualBriefScopeCurrent() ? briefs : [];',
  ],
  'scope checked before and after analysis',
);

// Empty analysis is a hard stop for an image-dependent handoff. No guessed
// description is allowed through to any agent/model dispatcher.
const requiredBriefGate = section(
  chat,
  'const requireTurnVisualBriefs =',
  'const desktopAttachmentCandidates =',
  'required visual brief gate',
);
assertInOrder(
  compact(requiredBriefGate),
  [
    'if (!turnHasImageAttachments) return [];',
    'if (turnImageAttachmentCount > 3)',
    'const briefs = await getTurnVisualBriefs();',
    'if (!isVisualBriefScopeCurrent()) return null;',
    'if (briefs.length === turnImageAttachmentCount) return briefs;',
    'I could not inspect the attached image safely, so I did not send guessed image contents',
    'return null;',
  ],
  'analysis failure returns a fail-closed sentinel',
);

// Explicit selected/coding-agent intent must win before the broad desktop-file
// verb heuristic (which otherwise sees words such as make/create/use).
const attachmentPrecedence = section(
  chat,
  'const desktopAttachmentCandidates =',
  'const resolvedFigmaRefs =',
  'coding-agent versus desktop attachment precedence',
);
const compactPrecedence = compact(attachmentPrecedence);
assertInOrder(
  compactPrecedence,
  [
    'const explicitlyTargetsConnectedCodingAgent = Boolean(',
    'selectedChatAgentTarget && !isOpenSwanChatAgentTarget(selectedChatAgentTarget)',
    'isTerminalAgentSendRequest(content)',
    'Boolean(parseTerminalAgentLaunchRequest(content))',
    'assign|agent|terminal|term|multi|roundtable',
    'claude(?:\\s+code)?|codex',
    'const codingAgentOwnsAttachmentTurn = explicitlyTargetsConnectedCodingAgent || isCodingGenerationRequest(content, sessionProfile);',
    'const shouldRunDesktopAttachmentTask = !codingAgentOwnsAttachmentTurn && shouldRouteAttachedFilesToDesktop(content, desktopAttachmentCandidates);',
    'if (shouldRunDesktopAttachmentTask) {',
  ],
  'coding-agent ownership is decided before desktop routing',
);

// The common selected-agent dispatcher formats artifacts once and then passes
// the enriched task through both Claude Code and Codex bridge paths.
const assignedDispatch = section(
  chat,
  'const dispatchAssignedAgentTask = useCallback',
  'const spawnDedicatedOpenSwanSession = useCallback',
  'assigned agent dispatcher',
);
const compactAssignedDispatch = compact(assignedDispatch);
assert.ok(
  compactAssignedDispatch.includes('visionArtifacts: readonly ChatVisualBriefArtifact[] = []'),
  'assigned-agent dispatcher accepts typed visual artifacts',
);
assertInOrder(
  compactAssignedDispatch,
  [
    'const visualContext = formatVisualBriefsForConnectedAgent(visionArtifacts);',
    'const taskWithVisualContext = visualContext ? `${task}\\n\\n${visualContext}` : task;',
    "const bridgeProviders = ['claude-code', 'codex', 'gemini', 'gemini-cli', 'cursor'];",
    'sendTerminalAgentSessionMessage(normalizedProvider, agent.sessionKey, profiledTask)',
    'wakeAndAssignTask(',
  ],
  'Claude Code and Codex bridge dispatch consumes the formatted brief',
);

const terminalControlSection = section(
  chat,
  '// ─── Terminal agent control',
  '// ─── Terminal agent launcher',
  'terminal control route',
);
assertInOrder(
  compact(terminalControlSection),
  [
    'const terminalControlNeedsVisualBrief = turnHasImageAttachments && isTerminalAgentSendRequest(content);',
    "await requireTurnVisualBriefs('the terminal agent')",
    'if (terminalControlVisualBriefs === null) {',
    'return;',
    'executeTerminalAgentControlFromChat(content, {',
    'visionArtifacts: terminalControlVisualBriefs,',
    'circleId,',
    'launchIfMissing: true,',
  ],
  'terminal control fails closed, receives visual artifacts, and may launch an explicit provider',
);
assert.ok(
  compact(terminalControl).includes('formatVisualBriefsForConnectedAgent(options.visionArtifacts)'),
  'terminal control formats artifacts before managed-session send',
);
const terminalControlExecution = section(
  terminalControl,
  'export async function executeTerminalAgentControlFromChat(',
  '\n}',
  'terminal control implementation',
);
const compactTerminalControl = compact(terminalControlExecution);
assertInOrder(
  compactTerminalControl,
  [
    'visionArtifacts?: readonly ChatVisualBriefArtifact[];',
    'circleId?: string;',
    'launchIfMissing?: boolean;',
    'const visualContext = formatVisualBriefsForConnectedAgent(options.visionArtifacts);',
    'const bodyWithVisualContext = visualContext ? `${sendIntent.body}\\n\\n${visualContext}` : sendIntent.body;',
    'const launchExplicitProvider = async ()',
    'if (!explicitProvider || !options.launchIfMissing || !options.circleId) return null;',
    'wakeAndAssignTask(',
    'bodyWithVisualContext,',
    'options.circleId,',
  ],
  'explicit provider auto-launch reuses the visual-enriched task',
);
assert.ok(
  compact(terminalControl).includes("if (/\\bclaude(?: code)?\\b/.test(key)) return 'claude-code';")
    && compact(terminalControl).includes("if (/\\bcodex\\b/.test(key)) return 'codex';"),
  'only an explicitly named Claude Code or Codex target selects those launch providers',
);
assert.ok(
  countMatches(terminalControlExecution, /const launchResult = await launchExplicitProvider\(\);/) >= 2,
  'missing and observe-only explicit targets both use the bounded managed-session launch path',
);
for (const forbiddenFallback of [
  'runOpenSwanSessionTurn(',
  'spawnSubAgent(',
  'getAIResponse(',
  'invokePlainChatModel(',
  'dispatchConnectedAgentTask(',
]) {
  assert.ok(
    !terminalControlExecution.includes(forbiddenFallback),
    `terminal auto-launch has no OpenSwan/plain-model fallback via ${forbiddenFallback}`,
  );
}

const terminalLaunchSection = section(
  chat,
  '// ─── Terminal agent launcher',
  '// ─── Automation builder intercept',
  'terminal launch route',
);
assertInOrder(
  compact(terminalLaunchSection),
  [
    'const terminalLaunchNeedsVisualBrief = turnHasImageAttachments && Boolean(parseTerminalAgentLaunchRequest(content));',
    "await requireTurnVisualBriefs('the new terminal agent session')",
    'if (terminalLaunchVisualBriefs === null) {',
    'return;',
    'executeTerminalAgentLaunchFromChat(content, {',
    'visionArtifacts: terminalLaunchVisualBriefs,',
  ],
  'terminal launch fails closed then receives visual artifacts',
);
const compactTerminalLaunch = compact(terminalLaunch);
assert.ok(
  compactTerminalLaunch.includes('formatVisualBriefsForConnectedAgent(context.visionArtifacts)'),
  'terminal launcher formats visual artifacts into each new session prompt',
);
assert.ok(
  compactTerminalLaunch.includes("plan.provider === 'claude-code'")
    && compactTerminalLaunch.includes("plan.provider === 'codex'"),
  'terminal launcher carries the enriched prompts to Claude Code and Codex',
);

const multiAgentSection = section(
  chat,
  '// ─── Multi-agent dispatch intercept',
  '// ─── Selected connected-agent route',
  'multi-agent route',
);
const compactMulti = compact(multiAgentSection);
assertInOrder(
  compactMulti,
  [
    "await requireTurnVisualBriefs('the selected agents')",
    'if (multiAgentVisualBriefs === null) {',
    'return;',
    'dispatchAssignedAgentTask(agent, task, multiAgentVisualBriefs)',
  ],
  'multi-agent route stops before dispatch when analysis fails',
);
assert.ok(
  countMatches(multiAgentSection, /dispatchAssignedAgentTask\(agent, task, multiAgentVisualBriefs\)/) >= 2,
  'both sequential and parallel multi-agent strategies receive the same visual artifacts',
);

const selectedAgentSection = section(
  chat,
  '// ─── Selected connected-agent route',
  '// ─── Slash intercepts',
  'selected connected-agent route',
);
assertInOrder(
  compact(selectedAgentSection),
  [
    'selectedChatAgentTarget && !isOpenSwanChatAgentTarget(selectedChatAgentTarget)',
    'const selectedAgentVisualBriefs = await requireTurnVisualBriefs(selectedDispatchAgent.name);',
    'if (selectedAgentVisualBriefs === null) return;',
    'dispatchAssignedAgentTask(selectedDispatchAgent, content, selectedAgentVisualBriefs)',
  ],
  'selected connected agent is non-OpenSwan, fail-closed, and receives artifacts',
);

const assignSection = section(
  chat,
  '// /assign — single-target dispatch.',
  '// /v2loop — per-device canary flip',
  '/assign route',
);
assertInOrder(
  compact(assignSection),
  [
    'const visualBriefs = await requireTurnVisualBriefs(target.name);',
    'if (visualBriefs === null) return;',
    'dispatchAssignedAgentTask(target, task, visualBriefs)',
  ],
  '/assign stops on failed analysis and otherwise forwards artifacts',
);

// Ordinary main Chat uses the exact same formatted artifact in capability,
// full-prompt, and coding-workbench context. With no image, every path above
// returns [] before the lazy import and this block is skipped entirely.
const ordinaryChatVisualSection = section(
  chat,
  '// Build one image description per turn and reuse it everywhere below.',
  '// ─── Model capability routing',
  'ordinary Chat visual brief formatting',
);
assertInOrder(
  compact(ordinaryChatVisualSection),
  [
    "let turnVisualBriefContext = '';",
    'if (turnHasImageAttachments) {',
    "const briefs = await requireTurnVisualBriefs('the selected chat model');",
    'if (briefs === null) return;',
    'turnVisualBriefContext = formatVisualBriefsForConnectedAgent(briefs);',
  ],
  'ordinary Chat analyzes only image turns and stops on failure',
);
assert.match(
  compact(chat),
  /const contentWithAttachments = \[ content, attachmentPromptContext, figmaPromptContext, turnVisualBriefContext, \]/,
  'capability routing receives the formatted visual brief',
);
assert.match(
  compact(chat),
  /const attachmentContext = \[ buildAttachmentPromptContext\(currentAttachments\), figmaPromptContext, turnVisualBriefContext, \]/,
  'plain Chat and workbench prompt context receive the formatted visual brief',
);
assert.match(
  compact(chat),
  /const buildPageVisualBriefs = await requireTurnVisualBriefs\('the page builder'\);/,
  'page-builder command receives the same required visual brief',
);
assert.match(
  compact(chat),
  /query: \[content, webSearchVisualContext\]\.filter\(Boolean\)\.join\('\\n\\n'\)/,
  'web-search lane receives only the formatted visual brief',
);
assertInOrder(
  compactPlumbing,
  [
    'if (!turnHasImageAttachments || !isVisualBriefScopeCurrent()) return [];',
    "visualBriefPromise = import('../../../lib/chatVisualBrief')",
  ],
  'no-image guard precedes lazy analysis',
);
assertInOrder(
  compactPlumbing,
  [
    'if (!turnHasImageAttachments) return [];',
    'const briefs = await getTurnVisualBriefs();',
  ],
  'no-image required-brief path returns before analysis',
);

// Pin the image signal to description/forwarding gates only. Adding a new use
// (especially a planner or OpenSwan call) requires an explicit review here.
assert.equal(
  countMatches(chat, /\bturnHasImageAttachments\b/),
  10,
  'image presence has only the reviewed analysis/forwarding uses',
);
for (const forbiddenCall of [
  'runOpenSwanSessionTurn(',
  'spawnSubAgent(',
  'sendSessionMessage(',
  'dispatchChatAutomationPlan(',
  'executeSharedComputerTask(',
]) {
  assert.ok(
    !visualBriefPlumbing.includes(forbiddenCall),
    `visual brief plumbing does not implicitly invoke ${forbiddenCall}`,
  );
  assert.ok(
    !ordinaryChatVisualSection.includes(forbiddenCall),
    `ordinary Chat image formatting does not implicitly invoke ${forbiddenCall}`,
  );
}

console.log('chat connected-agent image handoff wiring smoke: PASS');
