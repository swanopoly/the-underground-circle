/**
 * Tool: manageUserMemory — the agent's surface for writing to the
 * caller's USER.md-equivalent.
 *
 * Scope: only the current user's memory. An agent can never write into
 * another user's memory, even indirectly via tool calls — RLS on
 * `user_memory` enforces this server-side, and this tool's handler only
 * targets `ctx.session.userId`.
 *
 * Actions:
 *   - append:  appends a new line to the existing memory. Low-risk. Runs
 *              immediately — users write their own notes all the time.
 *   - replace: rewrites the whole memory. Destructive. Files an HITL
 *              approval with the current content + proposed content so
 *              the user can preview the diff before confirming.
 *   - delete:  drops the memory row. Same HITL gate as replace.
 *
 * See `docs/AGENTS_ROADMAP.md` §6 rules 4 + 10.
 */

import { supabase } from '../supabase';
import { appendUserMemory, loadUserMemory } from '../userMemory';
import { registerTool } from './registry';

type Action = 'append' | 'replace' | 'delete';

type Input = {
  action: Action;
  /**
   * Optional — if omitted, writes to the user's global profile
   * (`circle_id = NULL`). Otherwise targets the per-circle row.
   */
  circleId?: string | null;
  /** Required for append + replace. */
  content?: string;
  /** Optional rationale shown to the reviewer on destructive actions. */
  rationale?: string;
};

function isInput(value: unknown): value is Input {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.action === 'append' || v.action === 'replace' || v.action === 'delete';
}

registerTool({
  name: 'manageUserMemory',
  description:
    "Updates the calling user's personal USER.md-equivalent memory. " +
    "Actions: 'append' adds a new line immediately (low-risk, the user " +
    "owns their own notes); 'replace' rewrites everything (files an HITL " +
    "approval with a diff); 'delete' drops the memory (HITL-gated). Use " +
    "'append' for tiny facts (preferred tools, time zone, current focus); " +
    "propose 'replace' only after a substantial user request to reorganise.",
  input_schema: {
    type: 'object',
    properties: {
      action:    { type: 'string', enum: ['append', 'replace', 'delete'] },
      circleId:  { type: ['string', 'null'] },
      content:   { type: 'string' },
      rationale: { type: 'string' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    if (!isInput(input)) {
      return { ok: false, error: 'manageUserMemory: expected { action, ... }.' };
    }
    const userId = String(ctx.session.userId || '').trim();
    if (!userId) {
      return { ok: false, error: 'manageUserMemory: session is missing userId.' };
    }
    const circleId = input.circleId === undefined ? (ctx.session.circleId as string | null | undefined) ?? null : (input.circleId ?? null);

    if (input.action === 'append') {
      if (!input.content || input.content.trim().length === 0) {
        return { ok: false, error: 'append: content required' };
      }
      const res = await appendUserMemory(userId, circleId, input.content);
      if (!res.ok) return { ok: false, error: res.error || 'append failed' };
      return {
        ok: true,
        data: {
          status: 'appended',
          scope: circleId === null ? 'global' : 'circle',
          circleId,
        },
      };
    }

    // replace / delete — gated behind HITL. Load current memory so the
    // approval row carries the diff the user will review.
    const current = await loadUserMemory(userId, circleId ?? '__none__');
    const currentContent = circleId === null ? current.global : current.circle;

    const sessionKey = String(ctx.session.sessionKey || 'default::blackswan');
    const agentName  = String(ctx.session.agentName  || 'BlackSwan');

    if (input.action === 'replace' && (!input.content || input.content.trim().length === 0)) {
      return { ok: false, error: 'replace: content required' };
    }

    const payload = {
      action: input.action,
      userId,
      circleId,
      currentContent,
      proposedContent: input.action === 'replace' ? input.content : null,
      rationale: input.rationale ?? null,
      iteration: ctx.iteration,
    };

    const humanDescription =
      input.action === 'replace'
        ? `Replace ${circleId === null ? 'global' : 'circle'} user memory (${currentContent.length} → ${(input.content ?? '').length} chars)`
        : `Delete ${circleId === null ? 'global' : 'circle'} user memory (${currentContent.length} chars)`;

    const { data, error } = await supabase
      .from('agent_approvals')
      .insert({
        circle_id: circleId, // nullable — fine
        session_key: sessionKey,
        agent_name: agentName,
        action_type: `user_memory.${input.action}`,
        description: humanDescription + (input.rationale ? ` — ${input.rationale.slice(0, 200)}` : ''),
        payload,
        timeout_seconds: 60 * 60 * 24,
      })
      .select('id')
      .single();

    if (error) return { ok: false, error: `approval queue insert failed: ${error.message}` };

    return {
      ok: true,
      data: {
        status: 'pending_approval',
        approvalId: data.id,
        actionType: `user_memory.${input.action}`,
        message: `Filed ${input.action} proposal for your memory. Approval id: ${data.id}.`,
      },
    };
  },
});
