/**
 * Tool: manageLibrarySkill — HITL-gated writes into the SKILL.md library.
 *
 * Phase 2b (Hermes-aligned): this is the "agent proposes, human confirms"
 * loop that makes the agent actually improve over time. Instead of writing
 * directly to `circle_skills`, every `create` / `patch` / `delete` action
 * files an `agent_approvals` row via `hitlService.requestApproval`. The
 * tool returns a pending approval handle — the UI shows the proposal with
 * the full diff; a circle member approves or rejects; a separate worker
 * applies the change when approved.
 *
 * Why this shape:
 *   - Skill drift is the #1 risk of a self-improving agent. Without HITL, a
 *     jailbroken message could teach the agent a bad procedure that future
 *     runs silently follow. See `AGENTS_ROADMAP.md` §6 rules 4 + 10 and
 *     `HERMES_INTEGRATION_PLAN.md` §7.
 *   - Matching the existing `agent_approvals` queue means the UX is already
 *     built — the floating approval banner from HitlApprovalBanner picks
 *     these up automatically.
 *
 * Actions:
 *   - create: propose a new SKILL.md. Tool returns the approval id.
 *   - patch:  propose editing an existing SKILL.md. Include only the
 *             delta (description / version / content replacement).
 *   - delete: propose deleting an existing SKILL.md. (Rare — prefer
 *             patching content to a deprecation notice.)
 *
 * The actual mutation doesn't happen here. `src/lib/skillLibraryWrite.ts`
 * owns `applyApprovedSkillAction()` which reads an approved row and does
 * the insert/update/delete. Worker call site (Phase 2b follow-up) is the
 * approval-resolution UI or a scheduled worker.
 */

import { supabase } from '../supabase';
import { parseSkillFrontmatter } from '../skillLibrary';
import { registerTool } from './registry';

type Action = 'create' | 'patch' | 'delete';

type Input = {
  action: Action;
  circleId: string;
  /** Target skill name. Required for all actions — for create, must match the frontmatter name. */
  name: string;
  /** Full SKILL.md content (frontmatter + body). Required for create; optional for patch. */
  content?: string;
  /** Short description shown to the approver. Defaults to the frontmatter description. */
  description?: string;
  /** Optional version bump override. Defaults to frontmatter version. */
  version?: string;
  /** Optional tags override. Defaults to frontmatter tags. */
  tags?: string[];
  /** Free-text justification the agent provides for the human reviewer. */
  rationale?: string;
};

function isInput(value: unknown): value is Input {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.action === 'create' || v.action === 'patch' || v.action === 'delete') &&
    typeof v.circleId === 'string' && v.circleId.length > 0 &&
    typeof v.name     === 'string' && v.name.length > 0
  );
}

registerTool({
  name: 'manageLibrarySkill',
  description:
    "Proposes a change to the circle's SKILL.md library. Does NOT write " +
    "directly — every create/patch/delete is filed as a pending approval " +
    "that a circle member must confirm. Use this after a successful run " +
    "discovered a non-trivial procedure worth keeping (a good rule of " +
    "thumb: the task took 5+ tool calls and finished cleanly). Always " +
    "include a rationale explaining when the skill should be used.",
  input_schema: {
    type: 'object',
    properties: {
      action:      { type: 'string', enum: ['create', 'patch', 'delete'] },
      circleId:    { type: 'string' },
      name:        { type: 'string', description: 'Skill name, lowercase kebab-case.' },
      content:     { type: 'string', description: 'Full SKILL.md (YAML frontmatter + markdown body). Required for create.' },
      description: { type: 'string' },
      version:     { type: 'string' },
      tags:        { type: 'array', items: { type: 'string' } },
      rationale:   { type: 'string', description: 'One-paragraph justification for the reviewer.' },
    },
    required: ['action', 'circleId', 'name'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    if (!isInput(input)) {
      return { ok: false, error: 'manageLibrarySkill: expected { action, circleId, name, ... }.' };
    }
    const { action, circleId, name, content, description, version, tags, rationale } = input;

    // Create requires a full SKILL.md body. Parse the frontmatter so the
    // approval row carries the structured metadata the reviewer will want.
    let parsed: ReturnType<typeof parseSkillFrontmatter> | undefined;
    if (action === 'create') {
      if (!content || content.length < 40) {
        return { ok: false, error: 'create: `content` must be a complete SKILL.md (YAML frontmatter + body).' };
      }
      parsed = parseSkillFrontmatter(content);
      if (!parsed.name || parsed.name !== name) {
        return { ok: false, error: `create: frontmatter name ("${parsed.name ?? '—'}") must equal tool input name ("${name}").` };
      }
      if (!parsed.description) {
        return { ok: false, error: 'create: frontmatter must include a `description`.' };
      }
    }

    // Patch is allowed to be partial — but must specify at least one field.
    if (action === 'patch' && !content && !description && !version && !tags) {
      return { ok: false, error: 'patch: specify at least one of content / description / version / tags.' };
    }

    // Sanity check: the target skill must exist for patch/delete, and must
    // NOT exist for create. Catching this at proposal time saves the
    // reviewer from approving something that will fail at apply-time.
    if (action !== 'create') {
      const { data: existing, error: existingError } = await supabase
        .from('circle_skills')
        .select('id, name')
        .eq('circle_id', circleId)
        .eq('name', name)
        .maybeSingle();
      if (existingError) {
        return { ok: false, error: `lookup failed: ${existingError.message}` };
      }
      if (!existing) {
        return { ok: false, error: `${action}: no skill named "${name}" in this circle.` };
      }
    } else {
      const { data: existing } = await supabase
        .from('circle_skills')
        .select('id')
        .eq('circle_id', circleId)
        .eq('name', name)
        .maybeSingle();
      if (existing) {
        return { ok: false, error: `create: a skill named "${name}" already exists. Use action='patch' to edit it.` };
      }
    }

    // Agent identity context — the approval row pairs this with the caller.
    // ctx.session carries sessionKey / agentName when the loop runs under a
    // subagent; fall back to the default BlackSwan identity otherwise.
    const sessionKey = String(ctx.session.sessionKey || 'default::blackswan');
    const agentName  = String(ctx.session.agentName  || 'BlackSwan');

    const payload = {
      action,
      circleId,
      name,
      content:     content ?? null,
      description: description ?? parsed?.description ?? null,
      version:     version ?? parsed?.version ?? null,
      tags:        tags ?? parsed?.tags ?? null,
      rationale:   rationale ?? null,
      parsed:      parsed ? { name: parsed.name, description: parsed.description, version: parsed.version, tags: parsed.tags } : null,
      iteration:   ctx.iteration,
    };

    const humanDescription =
      action === 'create' ? `Create new SKILL.md "${name}"`
      : action === 'patch' ? `Patch SKILL.md "${name}"`
      : `Delete SKILL.md "${name}"`;

    const { data, error } = await supabase
      .from('agent_approvals')
      .insert({
        circle_id: circleId,
        session_key: sessionKey,
        agent_name: agentName,
        action_type: `skill.${action}`,
        description: humanDescription + (rationale ? ` — ${rationale.slice(0, 200)}` : ''),
        payload,
        timeout_seconds: 60 * 60 * 24, // 24h default — skill writes are not urgent
      })
      .select('id, status')
      .single();

    if (error) {
      return { ok: false, error: `approval queue insert failed: ${error.message}` };
    }

    return {
      ok: true,
      data: {
        status: 'pending_approval',
        approvalId: data.id,
        actionType: `skill.${action}`,
        name,
        circleId,
        message:
          `Filed ${action} proposal for skill "${name}" — a circle member must approve it before the change is applied. ` +
          `Approval id: ${data.id}.`,
      },
    };
  },
});
