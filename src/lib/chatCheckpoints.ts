/**
 * chatCheckpoints — Phase CA-7 of CHAT_AUTOMATION_AUDIT_PLAN (the
 * "Checkpoints & Reversible Tools" idea from the Cline research doc,
 * item 7). Wraps destructive chat tool calls with a before/after
 * snapshot that is rendered as a Compare · Restore strip under the
 * assistant message.
 *
 * Two public surfaces:
 *
 *   (1) `withCheckpoint(opts, fn)` — helper for transport handlers.
 *       Reads the "before" state via `opts.readBefore()`, runs the
 *       mutating `fn()`, reads the "after" state via `opts.readAfter()`,
 *       writes a `chat_checkpoints` row. Returns both the handler's
 *       result and the checkpoint id so the UI can render a strip.
 *
 *   (2) `restoreCheckpoint(id)` — looks up the checkpoint, dispatches
 *       to a per-kind restore handler, verifies the current target
 *       still hashes to the post-commit `hash_after` (drift check),
 *       applies the inverse, stamps `restored_at`.
 *
 * Per-kind handlers live in `CHECKPOINT_RESTORE_HANDLERS`. Adding a new
 * reversible tool = register a handler there + call `withCheckpoint`
 * from the transport.
 */

import { supabase } from './supabase';
import { safeGetUserId } from './authSession';

const PERSISTED_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// automationService + agentMemory are lazy-imported inside each handler
// so the core `chatCheckpoints` module can be smoke-tested in Node
// without react-native getting pulled into the dependency graph.
type CreateAutomationInput = any;

/**
 * supabase-js RESOLVES with `{ error }` — it does not throw. So a bare
 * `await supabase.from(...).update(...)` inside a restore handler cannot
 * fail: RLS denial, constraint violation and missing-column all look
 * exactly like success. `restoreCheckpoint` would then stamp `restored_at`,
 * which it treats as terminal ("checkpoint already restored"), spending the
 * user's ONE-SHOT undo on a restore that never happened.
 *
 * The `automation.*` handlers were already correct because automationService
 * hands back a Result they check. Every direct-supabase write in a handler
 * must go through this so it fails the same way.
 */
async function mustWrite<T extends { error: any }>(op: PromiseLike<T>, what: string): Promise<T> {
  const res = await op;
  if (res.error) {
    throw new Error(`${what} failed: ${res.error.message || String(res.error)}`);
  }
  return res;
}

// ─── Types ──────────────────────────────────────────────────────────────────

/** Stable kind identifiers. Adding a new tool = add a kind here + a
 *  handler in CHECKPOINT_RESTORE_HANDLERS. */
export type CheckpointToolKind =
  | 'memory.write'        // memory_entries row — create/update/soft-delete
  | 'memory_bank.write'   // circle_memory (brief/active_context/progress) — replace/append/clear
  | 'skill.write'         // circle_skills row — import/update
  | 'automation.create'   // circle_automations row — insert
  | 'automation.update'   // circle_automations row — update
  | 'automation.delete';  // circle_automations row — delete

export interface ChatCheckpointRow {
  id: string;
  circle_id: string;
  chat_thread_id: string | null;
  session_key: string | null;
  plan_id: string | null;
  tool_kind: CheckpointToolKind;
  target_kind: string | null;
  target_id: string | null;
  before_json: any;
  after_json: any;
  diff_summary: string | null;
  hash_before: string | null;
  hash_after: string | null;
  created_by: string | null;
  created_at: string;
  restored_at: string | null;
  restored_by: string | null;
  restore_error: string | null;
}

export interface WithCheckpointOptions<TResult, TBefore, TAfter> {
  circleId: string;
  /** Canonical Chat thread authority. Omit only for genuinely Circle-wide work. */
  threadId?: string | null;
  toolKind: CheckpointToolKind;
  /** FK-ish target identifiers — help the UI group by target row. */
  targetKind?: string;
  targetId?: string;
  /** Idempotency / grouping key that ties multi-tool turns together in
   *  the UI. Usually `agent_approvals.id` or a plan id. */
  planId?: string;
  sessionKey?: string;
  /** Called BEFORE `run()` — should return the current state or null if
   *  this is a pure create. */
  readBefore: () => Promise<TBefore | null>;
  /** The destructive operation. Must return whatever your caller needs. */
  run: () => Promise<TResult>;
  /** Called AFTER `run()` — should return the new state or null for a
   *  pure delete. */
  readAfter: (result: TResult) => Promise<TAfter | null>;
  /** Short one-liner the chat UI shows on the Restore strip. */
  diffSummary?: (before: TBefore | null, after: TAfter | null) => string;
}

export interface WithCheckpointResult<TResult> {
  result: TResult;
  checkpointId: string | null;
  error?: string;
}

// ─── Write path ────────────────────────────────────────────────────────────

export async function withCheckpoint<TResult, TBefore = unknown, TAfter = unknown>(
  opts: WithCheckpointOptions<TResult, TBefore, TAfter>,
): Promise<WithCheckpointResult<TResult>> {
  const chatThreadId = opts.threadId == null ? null : String(opts.threadId).trim();
  if (chatThreadId && !PERSISTED_UUID_RE.test(chatThreadId)) {
    throw new Error('A persisted Chat thread is required for a thread-scoped checkpoint.');
  }
  const before = await opts.readBefore().catch(() => null);

  let result: TResult;
  try {
    result = await opts.run();
  } catch (err: any) {
    // On run failure, do NOT record a checkpoint (nothing to restore).
    throw err;
  }

  const after = await opts.readAfter(result).catch(() => null);

  try {
    const userId = await safeGetUserId().catch(() => null);
    const hashBefore = before ? await stableHash(before) : null;
    const hashAfter = after ? await stableHash(after) : null;
    const summary = opts.diffSummary
      ? opts.diffSummary(before, after)
      : defaultDiffSummary(opts.toolKind, before, after);

    const { data, error } = await supabase
      .from('chat_checkpoints')
      .insert({
        circle_id: opts.circleId,
        chat_thread_id: chatThreadId,
        session_key: opts.sessionKey ?? null,
        plan_id: opts.planId ?? null,
        tool_kind: opts.toolKind,
        target_kind: opts.targetKind ?? null,
        target_id: opts.targetId ?? null,
        before_json: before ?? {},
        after_json: after ?? {},
        diff_summary: summary,
        hash_before: hashBefore,
        hash_after: hashAfter,
        created_by: userId,
      })
      .select('id')
      .single();

    if (error || !data) {
      return { result, checkpointId: null, error: error?.message };
    }
    return { result, checkpointId: data.id };
  } catch (err: any) {
    return { result, checkpointId: null, error: err?.message };
  }
}

// ─── Restore path ───────────────────────────────────────────────────────────

export interface RestoreOutcome {
  ok: boolean;
  error?: string;
  /** Present when refused due to drift (target row edited after commit). */
  drift?: { expectedHash: string; actualHash: string };
}

export async function restoreCheckpoint(id: string): Promise<RestoreOutcome> {
  if (!id) return { ok: false, error: 'missing checkpoint id' };
  const { data, error } = await supabase
    .from('chat_checkpoints')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !data) {
    return { ok: false, error: error?.message || 'checkpoint not found' };
  }
  const row = data as ChatCheckpointRow;
  if (row.restored_at) {
    return { ok: false, error: 'checkpoint already restored' };
  }

  const handler = CHECKPOINT_RESTORE_HANDLERS[row.tool_kind];
  if (!handler) {
    return { ok: false, error: `no restore handler for kind \`${row.tool_kind}\`` };
  }

  // Drift check — if the row is still at `hash_after`, it hasn't been
  // edited since we committed. If it moved, refuse.
  try {
    const currentAfter = await handler.readCurrent(row);
    if (row.hash_after && currentAfter) {
      const actual = await stableHash(currentAfter);
      if (actual !== row.hash_after) {
        const msg = 'target row changed since this checkpoint — refusing to restore';
        await supabase.from('chat_checkpoints')
          .update({ restore_error: msg })
          .eq('id', id);
        return { ok: false, error: msg, drift: { expectedHash: row.hash_after, actualHash: actual } };
      }
    }

    await handler.apply(row);

    const userId = await safeGetUserId().catch(() => null);
    // The inverse is already applied at this point, so a failed stamp is NOT
    // a failed restore — report the truth rather than either extreme. Calling
    // it ok:true silently would let a retry re-apply (memory_bank archives and
    // bumps version again); calling it ok:false would claim the user's data
    // wasn't restored when it was.
    const { error: stampError } = await supabase
      .from('chat_checkpoints')
      .update({ restored_at: new Date().toISOString(), restored_by: userId, restore_error: null })
      .eq('id', id);
    if (stampError) {
      return {
        ok: true,
        error: `restored, but recording it failed (${stampError.message}) — do not restore again`,
      };
    }
    return { ok: true };
  } catch (err: any) {
    const msg = err?.message || 'restore failed';
    await supabase
      .from('chat_checkpoints')
      .update({ restore_error: msg })
      .eq('id', id);
    return { ok: false, error: msg };
  }
}

// ─── List for chat UI ───────────────────────────────────────────────────────

export async function listCheckpoints(
  circleId: string,
  opts?: { planId?: string; threadId?: string | null; limit?: number },
): Promise<ChatCheckpointRow[]> {
  const limit = Math.min(opts?.limit ?? 50, 200);
  let query = supabase
    .from('chat_checkpoints')
    .select('*')
    .eq('circle_id', circleId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (opts?.planId) query = query.eq('plan_id', opts.planId);
  if (opts?.threadId != null) {
    const threadId = String(opts.threadId).trim();
    if (!PERSISTED_UUID_RE.test(threadId)) return [];
    query = query.eq('chat_thread_id', threadId);
  }
  const { data, error } = await query;
  if (error) return [];
  return (data || []) as ChatCheckpointRow[];
}

// ─── Per-kind restore handlers ─────────────────────────────────────────────

type RestoreHandler = {
  /** Read the row currently at the target so we can drift-check. */
  readCurrent: (row: ChatCheckpointRow) => Promise<any | null>;
  /** Apply the inverse of the original write. */
  apply: (row: ChatCheckpointRow) => Promise<void>;
};

export const CHECKPOINT_RESTORE_HANDLERS: Record<CheckpointToolKind, RestoreHandler> = {
  // Memory: three cases — create, update, soft-delete. `before` is null
  // for create, non-null for update/delete. `after` is null for delete.
  'memory.write': {
    readCurrent: async (row) => {
      if (!row.target_id) return null;
      const { data } = await supabase
        .from('memory_entries')
        .select('*')
        .eq('id', row.target_id)
        .maybeSingle();
      return data || null;
    },
    apply: async (row) => {
      const before = row.before_json as any;
      const after = row.after_json as any;
      const hasBefore = before && Object.keys(before).length > 0;
      const hasAfter = after && Object.keys(after).length > 0;
      if (!hasBefore && hasAfter) {
        // Create → hard-delete since we synthesised this row.
        if (row.target_id) {
          await mustWrite(
            supabase.from('memory_entries').delete().eq('id', row.target_id),
            'memory_entries delete',
          );
        }
        return;
      }
      if (hasBefore && hasAfter) {
        // Update → write before back. Whitelist of columns to avoid
        // accidentally re-writing system-managed fields.
        await mustWrite(
          supabase
            .from('memory_entries')
            .update({
              title: before.title,
              content: before.content,
              memory_kind: before.memory_kind,
              updated_at: new Date().toISOString(),
            })
            .eq('id', before.id),
          'memory_entries update',
        );
        return;
      }
      if (hasBefore && !hasAfter) {
        // Delete → undelete by setting is_active true.
        await mustWrite(
          supabase
            .from('memory_entries')
            .update({ is_active: true, updated_at: new Date().toISOString() })
            .eq('id', before.id),
          'memory_entries undelete',
        );
        return;
      }
      throw new Error('memory.write checkpoint has neither before nor after');
    },
  },

  // Memory bank (circle_memory.doc_kind) — the row is keyed by
  // (circle_id, doc_kind). `target_id` is `<circle_id>::<doc_kind>`.
  // Restore writes the before content back; if before was empty the
  // doc is reset to empty (we don't delete the row — the write path
  // always upserts). Drift detection compares the current content hash
  // against the after-hash.
  'memory_bank.write': {
    readCurrent: async (row) => {
      if (!row.target_id) return null;
      const [circleId, docKind] = String(row.target_id).split('::');
      if (!circleId || !docKind) return null;
      const { data } = await supabase
        .from('circle_memory')
        .select('content, version')
        .eq('circle_id', circleId)
        .eq('doc_kind', docKind)
        .maybeSingle();
      // Match the shape that the write path stored in after_json
      // (`{ content, version, doc_kind }`) so drift hashes line up.
      if (!data) return null;
      return { content: (data as any).content, version: (data as any).version, doc_kind: docKind };
    },
    apply: async (row) => {
      const before = row.before_json as any;
      const [circleId, docKind] = String(row.target_id || '').split('::');
      if (!circleId || !docKind) {
        throw new Error('memory_bank.write checkpoint missing target_id');
      }
      // Restore = write `before.content` back via direct supabase calls
      // (keeps chatCheckpoints.ts Node-importable for smoke tests without
      // pulling in the react-native transitive import chain via
      // sharedMemory's `useState`). Mirrors the same "archive current,
      // update row, bump version" flow sharedMemory.updateMemoryDoc uses.
      const restoredContent = String(before?.content ?? '');
      const userId = (await safeGetUserId().catch(() => null)) || null;
      const { data: existing } = await supabase
        .from('circle_memory')
        .select('*')
        .eq('circle_id', circleId)
        .eq('doc_kind', docKind)
        .maybeSingle();
      if (existing) {
        // Archive the row we're about to overwrite into history.
        await mustWrite(
          supabase.from('circle_memory_history').insert({
            circle_id: circleId,
            doc_kind: docKind,
            content: (existing as any).content,
            edited_by: (existing as any).last_edited_by,
            edited_at: (existing as any).last_edited_at,
            version: (existing as any).version,
          }),
          'circle_memory_history archive',
        );
        await mustWrite(
          supabase
            .from('circle_memory')
            .update({
              content: restoredContent,
              last_edited_by: userId,
              last_edited_at: new Date().toISOString(),
              version: ((existing as any).version || 0) + 1,
            })
            .eq('circle_id', circleId)
            .eq('doc_kind', docKind),
          'circle_memory update',
        );
      } else {
        await mustWrite(
          supabase.from('circle_memory').insert({
            circle_id: circleId,
            doc_kind: docKind,
            content: restoredContent,
            last_edited_by: userId,
            last_edited_at: new Date().toISOString(),
            version: 1,
          }),
          'circle_memory insert',
        );
      }
    },
  },

  // Skill library imports only create rows for now. Restore = delete.
  'skill.write': {
    readCurrent: async (row) => {
      if (!row.target_id) return null;
      const { data } = await supabase
        .from('circle_skills')
        .select('*')
        .eq('id', row.target_id)
        .maybeSingle();
      return data || null;
    },
    apply: async (row) => {
      const before = row.before_json as any;
      const after = row.after_json as any;
      const hasBefore = before && Object.keys(before).length > 0;
      const hasAfter = after && Object.keys(after).length > 0;
      if (!hasBefore && hasAfter) {
        if (row.target_id) {
          await mustWrite(
            supabase.from('circle_skills').delete().eq('id', row.target_id),
            'circle_skills delete',
          );
        }
        return;
      }
      if (hasBefore) {
        // Update → write before back. Only whitelisted columns.
        const { name, content, description, meta } = before;
        await mustWrite(
          supabase
            .from('circle_skills')
            .update({ name, content, description, meta, updated_at: new Date().toISOString() })
            .eq('id', before.id),
          'circle_skills update',
        );
        return;
      }
      throw new Error('skill.write checkpoint has neither before nor after');
    },
  },

  'automation.create': {
    readCurrent: async (row) => {
      if (!row.target_id) return null;
      const { data } = await supabase
        .from('circle_automations')
        .select('*')
        .eq('id', row.target_id)
        .maybeSingle();
      return data || null;
    },
    apply: async (row) => {
      // Create → delete.
      if (!row.target_id) throw new Error('automation.create checkpoint missing target_id');
      const { deleteAutomation } = await import('../services/automationService');
      const { error } = await deleteAutomation(row.target_id);
      if (error) throw new Error(error);
    },
  },

  'automation.update': {
    readCurrent: async (row) => {
      if (!row.target_id) return null;
      const { data } = await supabase
        .from('circle_automations')
        .select('*')
        .eq('id', row.target_id)
        .maybeSingle();
      return data || null;
    },
    apply: async (row) => {
      const before = row.before_json as any;
      if (!before || !before.id) throw new Error('automation.update checkpoint missing before state');
      const { updateAutomation, toggleAutomation } = await import('../services/automationService');
      const { error } = await updateAutomation(before.id, {
        name: before.name,
        description: before.description,
        icon: before.icon,
        prompt: before.prompt,
        model: before.model,
        cronExpression: before.cronExpression || before.cron_expression,
        eventConfig: before.eventConfig || before.event_config,
        includeContext: before.includeContext || before.include_context,
        outputTarget: before.outputTarget || before.output_target,
        webhookUrl: before.webhookUrl || before.webhook_url,
        spirit: before.spirit ?? null,
        spiritPrompt: before.spiritPrompt ?? before.spirit_prompt ?? null,
      });
      if (error) throw new Error(error);
      // `enabled` is a separate toggle endpoint — reapply via toggle if
      // it differs.
      if (typeof before.enabled === 'boolean') {
        await toggleAutomation(before.id, before.enabled).catch(() => {});
      }
    },
  },

  'automation.delete': {
    readCurrent: async () => null, // the row is gone; nothing to drift-check
    apply: async (row) => {
      const before = row.before_json as any;
      if (!before) throw new Error('automation.delete checkpoint missing before state');
      const { createAutomation } = await import('../services/automationService');
      const input: CreateAutomationInput = {
        circleId: before.circleId || before.circle_id,
        name: before.name,
        description: before.description,
        icon: before.icon,
        triggerType: before.triggerType || before.trigger_type,
        cronExpression: before.cronExpression || before.cron_expression,
        eventConfig: before.eventConfig || before.event_config,
        agent: before.agent,
        prompt: before.prompt,
        model: before.model,
        includeContext: before.includeContext || before.include_context,
        outputTarget: before.outputTarget || before.output_target || 'chat',
        webhookUrl: before.webhookUrl || before.webhook_url,
        templateId: before.templateId || before.template_id,
        spirit: before.spirit,
        spiritPrompt: before.spiritPrompt || before.spirit_prompt,
      };
      const { automation, error } = await createAutomation(input);
      if (error || !automation) throw new Error(error || 'createAutomation failed');
    },
  },
};

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Stable JSON stringification — keys sorted recursively — so `hash`
 *  is reproducible across clients. Arrays preserve order; objects sort. */
function stableStringify(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

/** SHA-256 of the canonical serialization. Uses Web Crypto when
 *  available; falls back to a cheap non-cryptographic digest that is
 *  still deterministic (good enough for drift detection; the table
 *  comment calls out that this is tamper-detection, not security). */
async function stableHash(value: any): Promise<string> {
  const s = stableStringify(value);
  try {
    if (typeof globalThis.crypto?.subtle?.digest === 'function') {
      const enc = new TextEncoder().encode(s);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', enc);
      const bytes = new Uint8Array(digest);
      let out = '';
      for (const b of bytes) out += b.toString(16).padStart(2, '0');
      return out;
    }
  } catch {}
  // Fallback: FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function defaultDiffSummary(
  kind: CheckpointToolKind,
  before: any,
  after: any,
): string {
  const hasBefore = before && Object.keys(before).length > 0;
  const hasAfter = after && Object.keys(after).length > 0;
  const verb = !hasBefore && hasAfter ? 'Created'
    : hasBefore && hasAfter ? 'Updated'
    : hasBefore && !hasAfter ? 'Deleted'
    : 'Changed';
  switch (kind) {
    case 'memory.write':       return `${verb} memory`;
    case 'skill.write':        return `${verb} skill`;
    case 'automation.create':  return 'Created automation';
    case 'automation.update':  return 'Updated automation';
    case 'automation.delete':  return 'Deleted automation';
    default:                   return `${verb} ${kind}`;
  }
}
