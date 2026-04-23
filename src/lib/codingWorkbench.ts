import type { SessionCodingProfile } from './chatSessionProfile';
import { resolveSessionCodingProfile } from './chatSessionProfile';

// Meta-conversational phrases that TALK ABOUT the agent rather than asking
// it to produce code. "build you out", "make you better", "help me figure
// out", "idk", "trying to" — these previously triggered the workbench
// because they contained the bare word "build" / "make" / "create" and the
// detector was too loose. Anything here short-circuits to false.
const META_CONVERSATION_PATTERNS: RegExp[] = [
  // Talking about the agent itself (very common false positive).
  /\b(build|make|improve|upgrade|fix|teach|train|grow|level|help|work\s+on)\s+(you|him|her|it|them|this\s+agent|the\s+agent|blackswan|swanbot)\b/i,
  /\byou\s+(out|better|smarter|stronger|more|less)\b/i,
  /\bmake\s+you\s+better\b/i,
  // Uncertainty / brainstorming openers.
  /^\s*(idk|i\s+dunno|i\s+don'?t\s+know|not\s+sure|maybe|thinking\s+about|wondering|just\s+thinking|kinda|sorta|hmm)/i,
  /\b(trying\s+to|want\s+to|wanna|gonna|thinking\s+of)\s+(figure|understand|learn|know|see|explore|explain|chat|talk|discuss)\b/i,
  // "Allow X to do Y" is talking about capabilities, not requesting code.
  /\ballow\s+(you|it|him|her|them|this|the\s+agent)\s+(to|access)\b/i,
  /\bgive\s+(you|it|him|her|them)\s+(access|the\s+ability)\b/i,
  // Questions (ends with ?) that aren't "fix this code" or "what do I put here"
  // are overwhelmingly conversational.
];

function isMetaConversation(lower: string): boolean {
  return META_CONVERSATION_PATTERNS.some((re) => re.test(lower));
}

// Codegen is STRICTLY opt-in via an explicit slash command. Natural-language
// phrasing — even "build me a landing page" — will NOT trigger the workbench
// anymore. The bot chats first, asks clarifying questions, and only scaffolds
// code when the user types `/code`, `/build-page`, or `/build`.
//
// Rationale: every "whenever I say build it just starts building" complaint
// traced back to a fuzzy natural-language match. Making the trigger explicit
// removes every false positive and lets the model run a real discovery
// conversation before committing to scaffold.
const STRONG_BUILD_PATTERNS = [
  // Slash commands — the only way to start codegen from the main chat.
  /^\s*\/code(\s|$)/,
  /^\s*\/build-page(\s|$)/,
  /^\s*\/build(\s|$)/,
  /(\s|^)\/code(\s|$)/,
  /(\s|^)\/build-page(\s|$)/,
  /(\s|^)\/build(\s|$)/,
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function isCodingGenerationRequest(content: string, _sessionProfile: SessionCodingProfile): boolean {
  const lower = content.toLowerCase();

  // UI toggles for the workbench itself are never build requests.
  if (
    /\b(show|open|reopen|close|hide|toggle|dock|undock|resize|move)\b.*\b(builder|preview|workbench)\b/.test(lower) ||
    /\b(builder|preview|workbench)\b.*\b(show|open|reopen|close|hide|toggle|dock|undock|resize|move)\b/.test(lower)
  ) {
    return false;
  }

  // Meta-conversation about the agent. Kept as a defense-in-depth layer
  // even though the opt-in patterns below are narrow enough on their own.
  if (isMetaConversation(lower)) return false;

  // Only explicit opt-in patterns trigger codegen. No profile-based fuzzy
  // fallback — that was the source of every "I just said build and it
  // started building" complaint.
  return STRONG_BUILD_PATTERNS.some((re) => re.test(lower));
}

export function inferCodingWorkbenchFileName(content: string): string {
  const lower = content.toLowerCase();
  if (lower.includes('html') || lower.includes('landing page') || lower.includes('webpage')) return 'index.html';
  if (lower.includes('css')) return 'styles.css';
  if (lower.includes('sql')) return 'query.sql';
  if (lower.includes('json')) return 'config.json';
  if (lower.includes('python')) return 'agent.py';
  if (lower.includes('tsx') || lower.includes('react') || lower.includes('screen') || lower.includes('component')) return 'OpenSwanPanel.tsx';
  if (lower.includes('ts') || lower.includes('typescript')) return 'agentRuntime.ts';
  if (lower.includes('jsx')) return 'OpenSwanPanel.jsx';
  if (lower.includes('js') || lower.includes('javascript')) return 'agent-runtime.js';
  return 'generated-file.tsx';
}

export function buildCodingWorkbenchLines(content: string, step: number): string[] {
  const fileName = inferCodingWorkbenchFileName(content);
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const stem = baseName.replace(/[^a-zA-Z0-9]/g, '') || 'OpenSwanPanel';
  const phases = [
    `import React from 'react';`,
    `import { View, Text } from 'react-native';`,
    ``,
    `type ${stem}Props = {`,
    `  prompt: string;`,
    `  mode: 'build' | 'review';`,
    `};`,
    ``,
    `export function ${stem}(props: ${stem}Props) {`,
    `  const status = 'building';`,
    `  const task = ${JSON.stringify(content.slice(0, 48) || 'OpenSwan task')};`,
    `  return (`,
    `    <View data-agent="openswan">`,
    `      <Text>{task}</Text>`,
    `      <Text>{status}</Text>`,
    `    </View>`,
    `  );`,
    `}`,
  ];
  const visible = 6 + (step % Math.max(6, phases.length - 4));
  return phases.slice(0, Math.min(phases.length, visible));
}

export function getCodingWorkbenchPhase(step: number): string {
  const phases = ['BOOTING CONTEXT', 'SCANNING FILES', 'WRITING TYPES', 'LINKING LOGIC', 'SHAPING UI', 'VERIFYING BUILD'];
  return phases[step % phases.length];
}

export function getCodingWorkbenchMetrics(step: number): { xp: number; files: number; passes: number } {
  return {
    xp: 18 + step * 7,
    files: 1 + (step % 4),
    passes: 1 + (step % 3),
  };
}
