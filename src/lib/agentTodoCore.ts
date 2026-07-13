// agentTodoCore — the PURE state core behind the P6 agent-maintained live TODO
// (docs/CODING_AGENT_UPGRADE_PLAN.md P6: "Agent-maintained live TODO — a tool
// family the model updates mid-run"). The runtime tool is `todo.write` (NOT
// `tasks.*` — that namespace already belongs to the kanban tools). Semantics
// mirror Claude Code's TodoWrite: the model sends the FULL replacement list on
// every call, and this core validates/normalizes it into a canonical list plus
// a human-readable issue log:
//
//   (A) WRITE — applyAgentTodoWrite(incoming): total validator/normalizer.
//       Non-array payloads become an empty list (+issue). Per item: non-object
//       rows are skipped, content must be a non-empty string after trim,
//       overlong content is truncated to MAX_AGENT_TODO_CONTENT_CHARS with a
//       trailing '…', unknown/missing status falls back to 'pending', exact
//       duplicate content (case-sensitive) keeps the first occurrence, the
//       list is capped at MAX_AGENT_TODO_ITEMS, and AT MOST ONE item may be
//       'in_progress' (first wins; later ones demote to 'pending'). Incoming
//       order is preserved throughout. Every deviation lands in `issues`.
//
//   (B) READ — renderAgentTodoList / summarizeAgentTodoProgress /
//       agentTodoStats: compact checklist rendering (`[x]` done, `[>]` in
//       progress, `[ ]` pending under a `TODO (2/5 done):` header), a one-line
//       progress summary, and total-safe counts — all tolerant of degenerate
//       input so a stale/corrupt persisted list can never break a render.
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: agent-todo-core). No
// filesystem, no network, no DB — the `todo.write` tool handler calls
// applyAgentTodoWrite, stores `todos` on the run, surfaces `issues` back to
// the model, and the UI/prompt layers call the read helpers. Every export is
// total: it never throws on degenerate/undefined input, returning
// empty/neutral results instead.

// ── Types ────────────────────────────────────────────────────────────────────

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface AgentTodoItem {
  content: string;
  status: AgentTodoStatus;
}

export interface AgentTodoWriteResult {
  /** The canonical normalized replacement list (this is what gets stored). */
  todos: AgentTodoItem[];
  /** Human-readable notes about anything that was skipped/coerced/truncated. */
  issues: string[];
}

// ── Tunables (exported so the tool handler and UI share the exact limits) ────

/** Hard ceiling on TODO items per list; overflow is dropped with an issue. */
export const MAX_AGENT_TODO_ITEMS = 20;

/** Max characters per item's content; longer content is truncated with '…'. */
export const MAX_AGENT_TODO_CONTENT_CHARS = 200;

// ── Internals ────────────────────────────────────────────────────────────────

const VALID_STATUSES: ReadonlySet<string> = new Set([
  'pending',
  'in_progress',
  'completed',
]);

function isValidStatus(value: unknown): value is AgentTodoStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value);
}

/** Lenient coercion for the READ helpers: salvage whatever looks like a valid
 *  item (non-empty string content; invalid status → 'pending') and drop the
 *  rest silently. Never throws. */
function coerceTodos(todos: unknown): AgentTodoItem[] {
  if (!Array.isArray(todos)) return [];
  const out: AgentTodoItem[] = [];
  for (const raw of todos) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const content = (raw as { content?: unknown }).content;
    if (typeof content !== 'string') continue;
    const trimmed = content.trim();
    if (trimmed.length === 0) continue;
    const status = (raw as { status?: unknown }).status;
    out.push({ content: trimmed, status: isValidStatus(status) ? status : 'pending' });
  }
  return out;
}

/** Preview helper for issue messages: keep them short and log-safe. */
function preview(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ── (A) WRITE: full-replacement validate + normalize ─────────────────────────

/**
 * Apply a `todo.write` payload (Claude-Code TodoWrite semantics: the model
 * sends the FULL replacement list each call). Returns the normalized canonical
 * list plus issues describing every skip/coercion. Total — never throws.
 */
export function applyAgentTodoWrite(incoming: unknown): AgentTodoWriteResult {
  const issues: string[] = [];

  if (!Array.isArray(incoming)) {
    issues.push(
      `todo.write payload must be an array of items; got ${incoming === null ? 'null' : typeof incoming} — treated as empty list`
    );
    return { todos: [], issues };
  }

  const todos: AgentTodoItem[] = [];
  const seenContent = new Set<string>();

  for (let i = 0; i < incoming.length; i += 1) {
    const raw = incoming[i];

    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      issues.push(`item ${i} is not an object — skipped`);
      continue;
    }

    const rawContent = (raw as { content?: unknown }).content;
    if (typeof rawContent !== 'string') {
      issues.push(`item ${i} has no string content — skipped`);
      continue;
    }
    let content = rawContent.trim();
    if (content.length === 0) {
      issues.push(`item ${i} has empty content — skipped`);
      continue;
    }
    if (content.length > MAX_AGENT_TODO_CONTENT_CHARS) {
      content = `${content.slice(0, MAX_AGENT_TODO_CONTENT_CHARS - 1)}…`;
      issues.push(
        `item ${i} content truncated to ${MAX_AGENT_TODO_CONTENT_CHARS} chars`
      );
    }

    if (seenContent.has(content)) {
      issues.push(`item ${i} duplicates "${preview(content)}" — first occurrence kept`);
      continue;
    }
    seenContent.add(content);

    const rawStatus = (raw as { status?: unknown }).status;
    let status: AgentTodoStatus;
    if (isValidStatus(rawStatus)) {
      status = rawStatus;
    } else {
      status = 'pending';
      issues.push(
        rawStatus === undefined
          ? `item ${i} has no status — defaulted to 'pending'`
          : `item ${i} has unknown status ${JSON.stringify(rawStatus)} — defaulted to 'pending'`
      );
    }

    todos.push({ content, status });
  }

  if (todos.length > MAX_AGENT_TODO_ITEMS) {
    const dropped = todos.length - MAX_AGENT_TODO_ITEMS;
    todos.length = MAX_AGENT_TODO_ITEMS;
    issues.push(
      `list capped at ${MAX_AGENT_TODO_ITEMS} items — ${dropped} item(s) dropped`
    );
  }

  // Enforce at most ONE in_progress item (first wins; later ones demote).
  let sawInProgress = false;
  for (const item of todos) {
    if (item.status !== 'in_progress') continue;
    if (!sawInProgress) {
      sawInProgress = true;
      continue;
    }
    item.status = 'pending';
    issues.push(
      `more than one in_progress item — "${preview(item.content)}" demoted to 'pending' (first in_progress kept)`
    );
  }

  return { todos, issues };
}

// ── (B) READ helpers (all degenerate-safe) ───────────────────────────────────

/**
 * Render the list as a compact checklist:
 *
 *   TODO (2/5 done):
 *   [x] completed item
 *   [>] in-progress item
 *   [ ] pending item
 *
 * Empty/degenerate input → `TODO list is empty.`
 */
export function renderAgentTodoList(todos: unknown): string {
  const list = coerceTodos(todos);
  if (list.length === 0) return 'TODO list is empty.';
  const done = list.filter((t) => t.status === 'completed').length;
  const lines = [`TODO (${done}/${list.length} done):`];
  for (const item of list) {
    const marker =
      item.status === 'completed' ? '[x]' : item.status === 'in_progress' ? '[>]' : '[ ]';
    lines.push(`${marker} ${item.content}`);
  }
  return lines.join('\n');
}

/**
 * One-line progress summary: `2/5 done; in progress: <content>` (first
 * in_progress item), `2/5 done` when nothing is in progress, or
 * `no TODO items` when empty/degenerate.
 */
export function summarizeAgentTodoProgress(todos: unknown): string {
  const list = coerceTodos(todos);
  if (list.length === 0) return 'no TODO items';
  const done = list.filter((t) => t.status === 'completed').length;
  const active = list.find((t) => t.status === 'in_progress');
  return active
    ? `${done}/${list.length} done; in progress: ${active.content}`
    : `${done}/${list.length} done`;
}

/** Total/degenerate-safe counts by status. */
export function agentTodoStats(todos: unknown): {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
} {
  const list = coerceTodos(todos);
  let pending = 0;
  let inProgress = 0;
  let completed = 0;
  for (const item of list) {
    if (item.status === 'completed') completed += 1;
    else if (item.status === 'in_progress') inProgress += 1;
    else pending += 1;
  }
  return { total: list.length, pending, inProgress, completed };
}
