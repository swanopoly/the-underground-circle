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

type Action = 'create' | 'patch' | 'delete' | 'write_file' | 'remove_file';

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
  /** CA-8i: sub-file relative path under the skill's folder, e.g.
   *  'references/api.md', 'templates/pr.md', 'scripts/run.sh'. Required
   *  for write_file + remove_file. Must be a forward-slash path with
   *  no `..` segments and no leading slash. */
  relpath?: string;
  /** Optional MIME hint for write_file. Defaults to 'text/markdown' when
   *  relpath ends in .md, 'text/plain' otherwise. */
  mimeType?: string;
  /** Free-text justification the agent provides for the human reviewer. */
  rationale?: string;
};

function isInput(value: unknown): value is Input {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const a = v.action;
  return (
    (a === 'create' || a === 'patch' || a === 'delete' || a === 'write_file' || a === 'remove_file') &&
    typeof v.circleId === 'string' && v.circleId.length > 0 &&
    typeof v.name     === 'string' && v.name.length > 0
  );
}

/**
 * Relpath validator — same rules the checked-in skillRelPath module
 * uses when importing multi-file skills. No leading slash, no `..`,
 * no absolute paths, must contain at least one ASCII alphanumeric
 * before the final extension. Exported for smoke tests.
 */
export function isSafeSkillRelpath(raw: string | undefined): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) return false;
  if (raw.startsWith('/') || raw.startsWith('\\')) return false;
  if (raw.includes('..')) return false;
  if (raw.includes('\0')) return false;
  // At least one slash OR at least one alphanumeric character.
  if (!/[a-zA-Z0-9]/.test(raw)) return false;
  // Reject Windows drive prefixes.
  if (/^[a-zA-Z]:/.test(raw)) return false;
  return true;
}

function inferMimeType(relpath: string): string {
  const lower = relpath.toLowerCase();
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'application/yaml';
  if (lower.endsWith('.sh')) return 'text/x-shellscript';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'application/typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'application/javascript';
  return 'text/plain';
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
      action: { type: 'string', enum: ['create', 'patch', 'delete', 'write_file', 'remove_file'],
        description: 'create/patch/delete = full SKILL.md body. write_file/remove_file = sub-file under the skill folder (references/, templates/, scripts/).' },
      circleId:    { type: 'string' },
      name:        { type: 'string', description: 'Skill name, lowercase kebab-case.' },
      content:     { type: 'string', description: 'For create: full SKILL.md body. For write_file: sub-file body.' },
      description: { type: 'string' },
      version:     { type: 'string' },
      tags:        { type: 'array', items: { type: 'string' } },
      relpath:     { type: 'string', description: 'Required for write_file/remove_file. Relative to skill folder, e.g. "references/api.md". No leading slash, no ".." segments.' },
      mimeType:    { type: 'string', description: 'Optional MIME hint for write_file (defaults by extension).' },
      rationale:   { type: 'string', description: 'One-paragraph justification for the reviewer.' },
    },
    required: ['action', 'circleId', 'name'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => {
    if (!isInput(input)) {
      return { ok: false, error: 'manageLibrarySkill: expected { action, circleId, name, ... }.' };
    }
    const { action, circleId, name, content, description, version, tags, rationale, relpath, mimeType } = input;

    // CA-8i: sub-file actions require a safe relpath + resolve the
    // target skill's id so the approval row doesn't carry ambiguous
    // lookup state. write_file also needs content.
    let subFileSkillId: string | null = null;
    if (action === 'write_file' || action === 'remove_file') {
      if (!isSafeSkillRelpath(relpath)) {
        return { ok: false, error: `${action}: relpath "${relpath ?? ''}" is not safe (no leading slash, no ".." segments, no null bytes, ≤200 chars).` };
      }
      if (action === 'write_file' && (!content || content.length === 0)) {
        return { ok: false, error: 'write_file: content required (empty file not allowed — delete via remove_file instead).' };
      }
      // The skill itself must exist — sub-files hang off circle_skills.id.
      const { data: existing, error: lookupErr } = await supabase
        .from('circle_skills')
        .select('id')
        .eq('circle_id', circleId)
        .eq('name', name)
        .maybeSingle();
      if (lookupErr) return { ok: false, error: `lookup failed: ${lookupErr.message}` };
      if (!existing) return { ok: false, error: `${action}: no skill named "${name}" in this circle.` };
      subFileSkillId = existing.id;
    }

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

    // Sanity check: the target skill must exist for patch/delete (the
    // sub-file actions already resolved skill_id above). For create,
    // the target must NOT exist. Catching this at proposal time saves
    // the reviewer from approving something that will fail at apply-time.
    if (action === 'patch' || action === 'delete') {
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
    } else if (action === 'create') {
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
    // write_file + remove_file skip the existence/non-existence check —
    // the earlier block already resolved subFileSkillId.

    // Agent identity context — the approval row pairs this with the caller.
    // ctx.session carries sessionKey / agentName when the loop runs under a
    // subagent; fall back to the default BlackSwan identity otherwise.
    const sessionKey = String(ctx.session.sessionKey || 'default::blackswan');
    const agentName  = String(ctx.session.agentName  || 'BlackSwan');

    const payload: Record<string, unknown> = {
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
    if (action === 'write_file' || action === 'remove_file') {
      payload.relpath = relpath;
      payload.skillId = subFileSkillId;
      if (action === 'write_file') payload.mimeType = mimeType || inferMimeType(relpath!);
    }

    const humanDescription =
      action === 'create'     ? `Create new SKILL.md "${name}"`
      : action === 'patch'    ? `Patch SKILL.md "${name}"`
      : action === 'delete'   ? `Delete SKILL.md "${name}"`
      : action === 'write_file' ? `Write sub-file "${relpath}" under skill "${name}"`
      : `Remove sub-file "${relpath}" under skill "${name}"`;

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
