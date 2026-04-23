/**
 * skillLibraryWrite — applies approved skill proposals from
 * `agent_approvals` into the `circle_skills` table.
 *
 * Flow:
 *   1. `manageLibrarySkill` tool files a proposal (status='pending').
 *   2. A circle member approves via HitlApprovalBanner → status='approved'.
 *   3. The banner's approve handler (or a scheduled worker) calls
 *      `applyApprovedSkillAction(approvalId)` to perform the DB write.
 *
 * This separation keeps the agent runtime side-effect-free — the model
 * can only file proposals, never mutate state directly.
 *
 * Idempotent: re-running `applyApprovedSkillAction` on the same approval
 * row is safe; it short-circuits if the row isn't approved, if it's been
 * applied, or if the target state already matches.
 */

import { supabase } from './supabase';
import { parseSkillFrontmatter } from './skillLibrary';

export type ApplySkillActionResult =
  | { ok: true; applied: boolean; reason?: string; skillId?: string }
  | { ok: false; error: string };

type ApprovalRow = {
  id: string;
  status: string;
  payload: Record<string, any>;
  applied_at?: string | null;
};

export async function applyApprovedSkillAction(approvalId: string): Promise<ApplySkillActionResult> {
  const { data: approval, error: loadError } = await supabase
    .from('agent_approvals')
    .select('id, status, payload, applied_at')
    .eq('id', approvalId)
    .maybeSingle<ApprovalRow>();

  if (loadError) return { ok: false, error: `approval lookup failed: ${loadError.message}` };
  if (!approval) return { ok: false, error: `approval ${approvalId} not found` };

  if (approval.status !== 'approved' && approval.status !== 'auto_approved') {
    return { ok: true, applied: false, reason: `approval status is "${approval.status}", not approved` };
  }
  if (approval.applied_at) {
    return { ok: true, applied: false, reason: 'already applied' };
  }

  const payload = approval.payload || {};
  const action = payload.action as 'create' | 'patch' | 'delete' | 'write_file' | 'remove_file' | undefined;
  const circleId = payload.circleId as string | undefined;
  const name = payload.name as string | undefined;
  if (!action || !circleId || !name) {
    return { ok: false, error: 'approval payload missing action / circleId / name' };
  }

  const authorId = payload.authorId as string | null | undefined;

  let skillId: string | undefined;
  try {
    if (action === 'create') {
      const content = payload.content as string | undefined;
      if (!content) return { ok: false, error: 'create: approval payload missing content' };
      const parsed = parseSkillFrontmatter(content);
      const description = payload.description || parsed.description;
      if (!description) return { ok: false, error: 'create: description required' };
      const { data, error } = await supabase
        .from('circle_skills')
        .insert({
          circle_id: circleId,
          author_id: authorId ?? null,
          name,
          description,
          version: payload.version || parsed.version || '1.0.0',
          content,
          tags: payload.tags || parsed.tags || [],
        })
        .select('id')
        .single();
      if (error) return { ok: false, error: `insert failed: ${error.message}` };
      skillId = data?.id;
    } else if (action === 'patch') {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof payload.content === 'string')     updates.content = payload.content;
      if (typeof payload.description === 'string') updates.description = payload.description;
      if (typeof payload.version === 'string')     updates.version = payload.version;
      if (Array.isArray(payload.tags))             updates.tags = payload.tags;
      if (Object.keys(updates).length === 1) {
        // only updated_at
        return { ok: false, error: 'patch: no fields to update' };
      }
      const { data, error } = await supabase
        .from('circle_skills')
        .update(updates)
        .eq('circle_id', circleId)
        .eq('name', name)
        .select('id')
        .maybeSingle();
      if (error) return { ok: false, error: `update failed: ${error.message}` };
      if (!data)  return { ok: false, error: `patch: no skill named "${name}" in circle ${circleId}` };
      skillId = data.id;
    } else if (action === 'delete') {
      const { data, error } = await supabase
        .from('circle_skills')
        .delete()
        .eq('circle_id', circleId)
        .eq('name', name)
        .select('id')
        .maybeSingle();
      if (error) return { ok: false, error: `delete failed: ${error.message}` };
      if (!data)  return { ok: true, applied: false, reason: `no skill named "${name}" to delete` };
      skillId = data.id;
    } else if (action === 'write_file' || action === 'remove_file') {
      // CA-8i: sub-file mutations against `circle_skill_files`. The
      // manageLibrarySkill tool already resolved skillId at proposal
      // time; re-verify here since the skill could have been deleted
      // between proposal and approval (rare race — fail loudly rather
      // than write to a ghost skill_id).
      const relpath = payload.relpath as string | undefined;
      if (!relpath) return { ok: false, error: `${action}: payload missing relpath` };
      const { data: skill, error: lookupErr } = await supabase
        .from('circle_skills')
        .select('id')
        .eq('circle_id', circleId)
        .eq('name', name)
        .maybeSingle();
      if (lookupErr) return { ok: false, error: `${action}: skill lookup failed: ${lookupErr.message}` };
      if (!skill) return { ok: false, error: `${action}: skill "${name}" no longer exists (deleted between proposal and approval).` };
      skillId = skill.id;

      if (action === 'write_file') {
        const content = payload.content as string | undefined;
        if (typeof content !== 'string' || content.length === 0) {
          return { ok: false, error: 'write_file: content required and must be non-empty' };
        }
        const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : 'text/plain';
        // upsert keyed by (skill_id, relpath) — matches the unique index
        // in the 20260507_circle_skill_files migration.
        const { error: writeErr } = await supabase
          .from('circle_skill_files')
          .upsert({
            skill_id: skill.id,
            relpath,
            content,
            mime_type: mimeType,
            size_bytes: content.length,
            created_by: authorId ?? null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'skill_id,relpath' });
        if (writeErr) return { ok: false, error: `write_file failed: ${writeErr.message}` };
      } else {
        const { data: removed, error: removeErr } = await supabase
          .from('circle_skill_files')
          .delete()
          .eq('skill_id', skill.id)
          .eq('relpath', relpath)
          .select('id')
          .maybeSingle();
        if (removeErr) return { ok: false, error: `remove_file failed: ${removeErr.message}` };
        if (!removed) return { ok: true, applied: false, reason: `no file at "${relpath}" to remove` };
      }
    } else {
      return { ok: false, error: `unknown action: ${String(action)}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Mark the approval row as applied so re-runs short-circuit.
  try {
    await supabase
      .from('agent_approvals')
      .update({ applied_at: new Date().toISOString() })
      .eq('id', approvalId);
  } catch {
    // Non-fatal — the skill change is already committed.
  }

  return { ok: true, applied: true, skillId };
}
