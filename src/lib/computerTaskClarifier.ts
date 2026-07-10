/**
 * computerTaskClarifier — P54: model-driven, ONE-SHOT clarification for
 * computer/app/browser tasks.
 *
 * The ask this implements: after the user's first message, the chat should
 * use the AI MODEL (not just heuristics) to decide whether it has enough
 * context to execute an app/browser/desktop task — and when it doesn't, ask
 * ONE batched set of decision-relevant questions before activating
 * bridges/apps/pipelines. This complements the P28 heuristic clarification
 * gate (EVPI slot detection in the planner): the heuristic gate catches
 * structurally missing slots cheaply; this model pass catches semantic gaps
 * a regex can't (which document? which of three accounts? overwrite or
 * copy?).
 *
 * Design rules (each smoke-pinned):
 *   - EVPI discipline: ask ONLY when an answer changes the actions, target,
 *     scope, or risk of the task. Preferences with a safe default become
 *     stated ASSUMPTIONS instead of questions.
 *   - ONE shot: at most one clarification per (circle, task) — a bounded
 *     in-memory registry prevents re-asking; the user's reply re-enters
 *     planning as a new, richer message.
 *   - FAIL-OPEN: any parser/model/timeout failure means "ready" — a broken
 *     clarifier must never block execution (the loop's own observe/approve
 *     gates still protect every mutation).
 *   - Launch-only tasks ("open Zoom") never ask — nothing is ambiguous.
 *   - Approval questions are NOT clarification: pay/delete/login/grant
 *     confirmation belongs to the HITL approval floor, and the prompt tells
 *     the model so.
 *
 * Pure except the bounded asked-registry (in-memory, session-scoped,
 * resettable) — tsx-loadable, never throws.
 */

import { hashToolInput } from './toolLoopStuckBreaker';

export const MAX_CLARIFIER_QUESTIONS = 3;
export const MAX_QUESTION_CHARS = 200;
export const MAX_ASSUMPTION_CHARS = 160;
export const MAX_ASKED_KEYS = 50;

// ─── Prompt (system instruction for a CHEAP model) ──────────────────────────

export const CLARIFIER_SYSTEM_PROMPT = [
  'You are a pre-flight readiness checker for a computer-automation agent. The agent is about to operate a desktop app, a browser page, or local files on the user\'s machine.',
  'Decide whether the task is executable AS SPECIFIED. Reply with ONLY a JSON object, no prose:',
  '{"ready": true|false, "questions": [{"q": "…", "why": "…"}], "assumptions": ["…"]}',
  '',
  'Rules:',
  '- Ask a question ONLY if the answer would change what the agent does, which target it acts on (app/site/file/account), the scope of changes, or the risk. Maximum 3 questions, each self-contained and answerable in one short reply.',
  '- If a detail has a safe, obvious default, DO NOT ask — state it in "assumptions" and set ready accordingly (assumptions with ready:true means "proceeding with these").',
  '- NEVER ask about information already present in the task or context below.',
  '- NEVER ask for permission/confirmation of risky actions (payments, deletion, login, publishing) — a separate human-approval gate owns that.',
  '- NEVER ask for passwords, API keys, or secrets — the agent has a vault for credentials.',
  '- Launching or focusing an app with no further work is always ready:true with no questions.',
  '- When the task names concrete targets and values, prefer ready:true.',
].join('\n');

export interface ClarifierContextInput {
  task: string;
  /** e.g. "desktop_app · Update banner copy in InDesign" */
  executionSummary?: string | null;
  /** Resolved app choice when the route already picked one. */
  appResolution?: string | null;
  /** Whether files were attached to the message. */
  hasAttachments?: boolean;
  /** Bounded tail of recent conversation for already-answered detection. */
  chatHistoryTail?: string | null;
}

/** The user-role message for the clarifier turn. Bounded; no secrets. */
export function buildClarifierUserMessage(input: ClarifierContextInput): string {
  const lines = [
    `TASK: ${String(input.task || '').slice(0, 1200)}`,
  ];
  if (input.executionSummary) lines.push(`ROUTE: ${String(input.executionSummary).slice(0, 200)}`);
  if (input.appResolution) lines.push(`APP ALREADY RESOLVED: ${String(input.appResolution).slice(0, 120)} (do not ask which app)`);
  if (input.hasAttachments) lines.push('ATTACHMENTS: the user attached file(s) to this message (do not ask for the file).');
  if (input.chatHistoryTail && input.chatHistoryTail.trim()) {
    lines.push(`RECENT CONVERSATION (answers may already be here):\n${input.chatHistoryTail.trim().slice(0, 1500)}`);
  }
  lines.push('', 'Reply with ONLY the JSON object.');
  return lines.join('\n');
}

// ─── Response parsing (fail-open) ───────────────────────────────────────────

export interface ClarifierQuestion {
  q: string;
  why: string;
}

export interface ClarifierVerdict {
  ready: boolean;
  questions: ClarifierQuestion[];
  assumptions: string[];
}

const READY_VERDICT: ClarifierVerdict = { ready: true, questions: [], assumptions: [] };

/**
 * Parse the model reply. FAIL-OPEN: anything unparseable, malformed, or
 * empty → ready (execution proceeds; downstream gates still protect it).
 * A `ready:false` with zero usable questions also fails open — there is
 * nothing actionable to ask.
 */
export function parseClarifierResponse(text: string | null | undefined): ClarifierVerdict {
  if (!text || typeof text !== 'string') return READY_VERDICT;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return READY_VERDICT;
  let parsed: any;
  try { parsed = JSON.parse(match[0]); } catch { return READY_VERDICT; }
  if (!parsed || typeof parsed !== 'object') return READY_VERDICT;

  const questions: ClarifierQuestion[] = Array.isArray(parsed.questions)
    ? parsed.questions
        .map((entry: any) => ({
          q: typeof entry?.q === 'string' ? entry.q.trim().slice(0, MAX_QUESTION_CHARS) : '',
          why: typeof entry?.why === 'string' ? entry.why.trim().slice(0, MAX_QUESTION_CHARS) : '',
        }))
        .filter((entry: ClarifierQuestion) => entry.q.length > 0)
        .slice(0, MAX_CLARIFIER_QUESTIONS)
    : [];
  const assumptions: string[] = Array.isArray(parsed.assumptions)
    ? parsed.assumptions
        .map((a: any) => (typeof a === 'string' ? a.trim().slice(0, MAX_ASSUMPTION_CHARS) : ''))
        .filter(Boolean)
        .slice(0, MAX_CLARIFIER_QUESTIONS)
    : [];

  if (parsed.ready === false && questions.length > 0) {
    return { ready: false, questions, assumptions };
  }
  return { ready: true, questions: [], assumptions };
}

// ─── User-facing question message ───────────────────────────────────────────

/** One chat message carrying the batched questions + stated assumptions. */
export function formatClarifierQuestionsForChat(verdict: ClarifierVerdict): string {
  const lines = ['**Quick check before I start:**', ''];
  verdict.questions.forEach((question, index) => {
    lines.push(`${index + 1}. ${question.q}`);
  });
  if (verdict.assumptions.length > 0) {
    lines.push('', `_Unless you say otherwise I'll assume: ${verdict.assumptions.join('; ')}._`);
  }
  lines.push('', '_Reply with the answers — or say **proceed** and I\'ll go with my best judgment._');
  return lines.join('\n');
}

// ─── Gate + once-per-task registry ──────────────────────────────────────────

export function computerTaskClarifierKey(circleId: string, task: string): string {
  const normalized = String(task || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 500);
  return `${String(circleId || '').slice(0, 40)}::${hashToolInput(normalized)}`;
}

const askedKeys = new Set<string>();

export function hasAskedClarifier(key: string): boolean {
  return askedKeys.has(key);
}

export function markClarifierAsked(key: string): void {
  if (!key) return;
  if (askedKeys.size >= MAX_ASKED_KEYS) {
    const oldest = askedKeys.values().next().value;
    if (oldest !== undefined) askedKeys.delete(oldest);
  }
  askedKeys.add(key);
}

/** Test hook. */
export function resetClarifierAsked(): void {
  askedKeys.clear();
}

/**
 * Should the model clarifier run at all for this task? Pure gate:
 *   - never twice for the same (circle, task)
 *   - never for launch-only tasks (no follow-up work → nothing ambiguous)
 *   - never when the user already said "proceed"/"just do it" (they opted
 *     out of questions — assumptions mode)
 */
export function shouldRunComputerTaskClarifier(input: {
  task: string;
  circleId: string;
  isLaunchOnly: boolean;
}): { run: boolean; key: string; reason: string } {
  const key = computerTaskClarifierKey(input.circleId, input.task);
  if (input.isLaunchOnly) return { run: false, key, reason: 'launch_only' };
  if (/\b(proceed|just do it|go ahead|no questions|use your judgment)\b/i.test(input.task)) {
    return { run: false, key, reason: 'user_opted_out' };
  }
  if (hasAskedClarifier(key)) return { run: false, key, reason: 'already_asked' };
  return { run: true, key, reason: 'eligible' };
}
