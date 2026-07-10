/**
 * chatProofReceipts — single owner for the proof-of-work receipt loop
 * between Feed missions/tasks and the chat thread that started them
 * (Phase 3c of `docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md`).
 *
 * The loop: a mission created from chat stamps its origin thread into a
 * `proof_of_work` row (`detail.origin`, no schema change needed); when a
 * task from that mission is later dispatched — from any surface — the
 * dispatcher resolves the origin thread from that stamp and posts a compact
 * receipt message back into the originating conversation. Receipts follow
 * the "receipts, not claims" pattern: what ran, who ran it, where the proof
 * lives.
 *
 * Pure module (no Supabase/React) — smoke-testable via tsx
 * (`npm run smoke:chat-proof-receipts`). Writers/readers live with the
 * existing owners (`missionChatCommands`, `missionAgentDispatch`).
 */

// ─── Origin stamp (proof_of_work.detail.origin) ─────────────────────────────

export type ProofOriginDetail = {
  origin: {
    surface: 'main_chat';
    threadId: string;
  };
};

/** Detail fragment stamped onto a proof row so the origin thread survives. */
export function buildProofOriginDetail(threadId: string): ProofOriginDetail {
  return { origin: { surface: 'main_chat', threadId } };
}

/**
 * Read an origin thread id back out of a proof row's `detail` jsonb.
 * Tolerant of missing/foreign shapes — returns null unless the stamp is
 * exactly ours.
 */
export function extractProofOriginThreadId(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const origin = (detail as Record<string, unknown>).origin;
  if (!origin || typeof origin !== 'object') return null;
  const surface = (origin as Record<string, unknown>).surface;
  const threadId = (origin as Record<string, unknown>).threadId;
  if (surface !== 'main_chat') return null;
  return typeof threadId === 'string' && threadId.trim() ? threadId : null;
}

// ─── Receipt copy ───────────────────────────────────────────────────────────

function clamp(value: string | null | undefined, max: number): string {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Receipt posted back to the originating chat thread when a mission task
 * finishes (or errors) after dispatch. One compact block: outcome, actor,
 * where the proof lives.
 */
export function buildMissionTaskReceiptText(input: {
  taskTitle: string;
  missionTitle: string;
  agentName: string;
  completed: boolean;
  /** First line of the agent's response, when available. */
  resultPreview?: string | null;
}): string {
  const task = clamp(input.taskTitle, 90);
  const mission = clamp(input.missionTitle, 60);
  const status = input.completed ? '✅ Task completed' : '🔄 Task updated';
  const lines = [
    `${status}: **${task}** — ${input.agentName} ran it (mission: ${mission}).`,
  ];
  const preview = clamp(input.resultPreview, 180);
  if (preview) lines.push(`> ${preview}`);
  lines.push('Proof of work is logged in the Feed.');
  return lines.join('\n');
}

/** Feed-side proof title for a mission created from chat. */
export function buildMissionCreatedProofTitle(missionTitle: string): string {
  return `Mission created from chat: ${clamp(missionTitle, 90)}`;
}
