/**
 * memoryBankChatCommands — Cline-style Memory Bank slash command family.
 *
 * Three named docs per circle:
 *   - `brief`          — stable summary
 *   - `active_context` — what we're on right now
 *   - `progress`       — shipped / remaining
 *
 * Grammar:
 *   /memory-bank                              → summary of all three docs
 *   /memory-bank <kind>                       → show one doc
 *   /memory-bank update <kind> <content>      → replace one doc
 *   /memory-bank append <kind> <content>      → append to one doc
 *   /memory-bank clear  <kind>                → reset a doc to empty
 *   /memory-bank help                         → help text
 *
 * Returns `{ message, success } | null` — null means "not my command,
 * fall through to the next handler". Modeled on `automationChatCommands.ts`.
 */

// Pure grammar/kind types live in memoryBankKinds (no supabase / RN).
// Import them separately from the supabase-backed write helpers so
// the parser can be used in smoke tests and edge functions.
import {
  ALL_MEMORY_DOC_KINDS,
  MEMORY_DOC_KIND_DESCRIPTIONS,
  MEMORY_DOC_KIND_LABELS,
  parseMemoryDocKind,
  type MemoryDocKind,
} from './memoryBankKinds';
import {
  getAllMemoryDocs,
  getMemoryDoc,
  updateMemoryDoc,
} from '../services/sharedMemory';
import { withCheckpoint } from './chatCheckpoints';

export interface MemoryBankCommandContext {
  circleId: string;
  userId: string;
}

export interface MemoryBankCommandResult {
  message: string;
  success: boolean;
  /**
   * Checkpoint written for a destructive write (update/append/clear), when
   * any. Lets the chat surface render a live Restore strip instead of only
   * mentioning the id in prose (Phase 2c of
   * docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md).
   */
  checkpointId?: string | null;
}

const HELP_TEXT = [
  '**Memory Bank** — three named docs per circle.',
  '',
  '• `/memory-bank` — summary of all three docs',
  '• `/memory-bank brief|active|progress` — show one doc',
  '• `/memory-bank update <kind> <content>` — replace one doc',
  '• `/memory-bank append <kind> <content>` — append to one doc',
  '• `/memory-bank clear <kind>` — reset a doc to empty',
  '',
  'Doc kinds:',
  ...ALL_MEMORY_DOC_KINDS.map((k) =>
    `• **${MEMORY_DOC_KIND_LABELS[k]}** (\`${k}\`) — ${MEMORY_DOC_KIND_DESCRIPTIONS[k]}`,
  ),
].join('\n');

export async function executeMemoryBankCommand(
  rawCommand: string,
  ctx: MemoryBankCommandContext,
): Promise<MemoryBankCommandResult | null> {
  const trimmed = String(rawCommand || '').trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^\/(memory-bank|mb)\b(.*)$/i);
  if (!match) return null;

  const rest = (match[2] || '').trim();
  if (!rest) {
    return await renderSummary(ctx);
  }

  const [headRaw, ...tailParts] = rest.split(/\s+/);
  const head = headRaw.toLowerCase();
  const tail = tailParts.join(' ').trim();

  if (head === 'help' || head === '--help' || head === '-h') {
    return { success: true, message: HELP_TEXT };
  }

  if (head === 'update' || head === 'set' || head === 'replace') {
    return await handleWrite(ctx, tail, 'replace');
  }
  if (head === 'append' || head === 'add') {
    return await handleWrite(ctx, tail, 'append');
  }
  if (head === 'clear' || head === 'reset') {
    const kind = parseMemoryDocKind(tail);
    if (!kind) {
      return {
        success: false,
        message: `Which doc to clear? Try \`/memory-bank clear brief\`, \`active\`, or \`progress\`.`,
      };
    }
    const { checkpointId } = await writeMemoryBankWithCheckpoint(ctx, kind, '');
    const suffix = checkpointId ? `  (checkpoint \`${checkpointId.slice(0, 8)}\`)` : '';
    return { success: true, message: `Cleared **${MEMORY_DOC_KIND_LABELS[kind]}**.${suffix}`, checkpointId };
  }

  // Otherwise: `head` should be a doc_kind alias for a read.
  const kind = parseMemoryDocKind(head);
  if (!kind) {
    return {
      success: false,
      message: `Unknown memory-bank subcommand \`${head}\`. Try \`/memory-bank help\`.`,
    };
  }

  const doc = await getMemoryDoc(ctx.circleId, kind);
  if (!doc || !doc.content.trim()) {
    return {
      success: true,
      message: `**${MEMORY_DOC_KIND_LABELS[kind]}** is empty. Write it with \`/memory-bank update ${kind} <content>\`.`,
    };
  }
  return {
    success: true,
    message: renderOneDoc(kind, doc.content, doc.version, doc.last_edited_at),
  };
}

// ─── Internals ─────────────────────────────────────────────────────────────

async function renderSummary(ctx: MemoryBankCommandContext): Promise<MemoryBankCommandResult> {
  const docs = await getAllMemoryDocs(ctx.circleId);
  const lines: string[] = ['**Memory Bank** — `/memory-bank help` for commands.'];
  for (const kind of ALL_MEMORY_DOC_KINDS) {
    const doc = docs[kind];
    const content = (doc?.content || '').trim();
    lines.push('');
    lines.push(`### ${MEMORY_DOC_KIND_LABELS[kind]} (v${doc?.version || 0})`);
    if (!content) {
      lines.push('_Empty._ Write with `/memory-bank update ' + kind + ' <content>`.');
    } else {
      // Truncate for the summary view — the user can drill in per-kind.
      lines.push(content.length > 400 ? content.slice(0, 400).trimEnd() + '…' : content);
    }
  }
  return { success: true, message: lines.join('\n') };
}

async function handleWrite(
  ctx: MemoryBankCommandContext,
  tail: string,
  mode: 'replace' | 'append',
): Promise<MemoryBankCommandResult> {
  const [kindTokenRaw, ...rest] = tail.split(/\s+/);
  const kind = parseMemoryDocKind(kindTokenRaw);
  const content = rest.join(' ').trim();
  if (!kind) {
    return {
      success: false,
      message: `Specify which doc. Try \`/memory-bank ${mode} brief <content>\`, \`active\`, or \`progress\`.`,
    };
  }
  if (!content) {
    return {
      success: false,
      message: `No content supplied. Try \`/memory-bank ${mode} ${kind} <your notes>\`.`,
    };
  }
  const nextContent = mode === 'replace'
    ? content
    : await appendContent(ctx.circleId, kind, content);
  const { checkpointId } = await writeMemoryBankWithCheckpoint(ctx, kind, nextContent);
  const suffix = checkpointId ? `  (checkpoint \`${checkpointId.slice(0, 8)}\` — Restore below undoes this)` : '';
  return {
    success: true,
    message: `${mode === 'replace' ? 'Wrote' : 'Appended to'} **${MEMORY_DOC_KIND_LABELS[kind]}**.${suffix}`,
    checkpointId,
  };
}

/**
 * Wraps `updateMemoryDoc` with a `chat_checkpoints` snapshot so users
 * can Restore the prior content from the chat UI. Falls back silently
 * if the checkpoint layer fails (the write still goes through).
 */
async function writeMemoryBankWithCheckpoint(
  ctx: MemoryBankCommandContext,
  kind: MemoryDocKind,
  nextContent: string,
): Promise<{ checkpointId: string | null }> {
  const targetId = `${ctx.circleId}::${kind}`;
  const out = await withCheckpoint<void, any, any>({
    circleId: ctx.circleId,
    toolKind: 'memory_bank.write',
    targetKind: 'circle_memory',
    targetId,
    readBefore: async () => {
      const existing = await getMemoryDoc(ctx.circleId, kind);
      if (!existing) return null;
      return {
        content: existing.content,
        version: existing.version,
        doc_kind: kind,
      };
    },
    run: async () => {
      await updateMemoryDoc(ctx.circleId, nextContent, ctx.userId, kind);
    },
    readAfter: async () => {
      const fresh = await getMemoryDoc(ctx.circleId, kind);
      if (!fresh) return null;
      return {
        content: fresh.content,
        version: fresh.version,
        doc_kind: kind,
      };
    },
    diffSummary: (before, after) => {
      const label = MEMORY_DOC_KIND_LABELS[kind];
      if (!before || !before.content) return `Created ${label}`;
      if (!after) return `Cleared ${label}`;
      return `Updated ${label} (v${before.version} → v${after.version})`;
    },
  });
  return { checkpointId: out.checkpointId };
}

async function appendContent(
  circleId: string,
  kind: MemoryDocKind,
  addition: string,
): Promise<string> {
  const existing = await getMemoryDoc(circleId, kind);
  const prev = (existing?.content || '').trimEnd();
  if (!prev) return addition;
  return prev + '\n\n' + addition;
}

function renderOneDoc(
  kind: MemoryDocKind,
  content: string,
  version: number,
  lastEditedAt: string,
): string {
  return [
    `### ${MEMORY_DOC_KIND_LABELS[kind]} (v${version}) — updated ${new Date(lastEditedAt).toLocaleString()}`,
    '',
    content.trim(),
  ].join('\n');
}

// ─── Smoke test affordances ────────────────────────────────────────────────

/** Pure grammar probe — useful for smoke tests that don't want to hit
 *  the DB. Returns the parsed intent or null for "not my command". */
export function parseMemoryBankCommand(rawCommand: string): {
  kind: 'summary';
} | {
  kind: 'read';
  docKind: MemoryDocKind;
} | {
  kind: 'write';
  docKind: MemoryDocKind;
  mode: 'replace' | 'append' | 'clear';
  content: string;
} | {
  kind: 'help';
} | {
  kind: 'unknown';
  message: string;
} | null {
  const trimmed = String(rawCommand || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^\/(memory-bank|mb)\b(.*)$/i);
  if (!match) return null;
  const rest = (match[2] || '').trim();
  if (!rest) return { kind: 'summary' };
  const [headRaw, ...tail] = rest.split(/\s+/);
  const head = headRaw.toLowerCase();
  if (head === 'help' || head === '--help' || head === '-h') return { kind: 'help' };
  if (head === 'update' || head === 'set' || head === 'replace' || head === 'append' || head === 'add') {
    const mode = (head === 'append' || head === 'add') ? 'append' : 'replace';
    const [k, ...content] = tail;
    const dk = parseMemoryDocKind(k);
    if (!dk) return { kind: 'unknown', message: `Specify kind` };
    return { kind: 'write', docKind: dk, mode, content: content.join(' ') };
  }
  if (head === 'clear' || head === 'reset') {
    const dk = parseMemoryDocKind(tail.join(' '));
    if (!dk) return { kind: 'unknown', message: `Specify kind to clear` };
    return { kind: 'write', docKind: dk, mode: 'clear', content: '' };
  }
  const dk = parseMemoryDocKind(head);
  if (dk) return { kind: 'read', docKind: dk };
  return { kind: 'unknown', message: `Unknown subcommand \`${head}\`` };
}
