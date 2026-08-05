/**
 * agentPromptBuilder — composable named-component layer on top of
 * `agentSystemPrompt` (Cline research item 4, "composable prompt
 * builder").
 *
 * Problem we're solving:
 *   - `agentSystemPrompt.ts` is the cache-control primitive: frozen vs
 *     volatile, `cache_control: { type: 'ephemeral' }` on the first
 *     block. It takes an opaque `frozen` string plus `extraFrozen[]`.
 *   - Callers hand-assemble those strings by string-concating whatever
 *     feature blocks they want — skill prompt, memory bank, etc. This
 *     ad-hoc concat drifts across edge function vs in-app runtimes and
 *     is where cache-hit rates silently collapse.
 *
 * What this module adds:
 *   - A named, ordered registry of `PromptComponent`s. Each component
 *     is `(ctx) => string | null` plus a `cache` tag (`'frozen'` or
 *     `'volatile'`). Ordering is fixed in `DEFAULT_COMPONENT_ORDER`
 *     (matches Cline's `src/core/prompts/system-prompt/registry` shape
 *     where role → capabilities → tools → skills → mcp → memory_bank →
 *     rules → environment_details → objective).
 *   - `buildAgentPromptBlocks(components, ctx)` runs them in order,
 *     concatenates frozen contributions into the cache block and
 *     volatile into the unchanged block, then hands off to the
 *     cache-discipline primitive.
 *   - Variants per model (future work): a caller passes a trimmed
 *     component list. The registry shape is intentionally tiny so a
 *     variant is just `DEFAULT_COMPONENT_ORDER.filter(...)`.
 */

import { buildAgentSystemPrompt, type BuildSystemPromptOptions } from './agentSystemPrompt';
import { describeUserMemoryUsage } from './userMemoryCaps';
import type { AnthropicSystemBlock } from './agentProviders/anthropic';

// ─── Types ──────────────────────────────────────────────────────────────────

/** Stable component key — matches Cline's component names where possible. */
export type PromptComponentKey =
  | 'agent_role'
  | 'capabilities'
  | 'tools'
  | 'skills'
  | 'mcp_servers'
  | 'memory_bank'
  | 'rules'
  | 'environment_details'
  | 'objective';

/** Components are pure functions over context. They may return `null`
 *  to opt out of the turn (no block is emitted). `cache` tags the
 *  component's contribution as frozen (cacheable across turns) or
 *  volatile (changes per turn — e.g. timestamps). The builder runs
 *  every frozen component into the first block and every volatile
 *  component into the second block. */
export interface PromptComponent<Ctx = unknown> {
  key: PromptComponentKey;
  cache: 'frozen' | 'volatile';
  /** Human-readable heading inserted before the component body, e.g.
   *  `## RULES`. Pass empty string to render without a heading. */
  heading: string;
  /** Render the body given the turn context. Return `null` to skip. */
  render(ctx: Ctx): string | null | undefined | Promise<string | null | undefined>;
}

export const DEFAULT_COMPONENT_ORDER: PromptComponentKey[] = [
  'agent_role',
  'capabilities',
  'tools',
  'skills',
  'mcp_servers',
  'memory_bank',
  'rules',
  'environment_details',
  'objective',
];

// ─── Builder ───────────────────────────────────────────────────────────────

export interface BuildAgentPromptInput<Ctx> {
  /** Components to consider. Pass a full list; `order` filters + orders them. */
  components: ReadonlyArray<PromptComponent<Ctx>>;
  /** Context object passed to every component. */
  ctx: Ctx;
  /** Optional ordering. Defaults to `DEFAULT_COMPONENT_ORDER`. Keys that
   *  aren't in `components` are silently skipped. */
  order?: ReadonlyArray<PromptComponentKey>;
  /** Forwarded to `buildAgentSystemPrompt` — lets callers append a
   *  mode contract after the frozen body. */
  mode?: BuildSystemPromptOptions['mode'];
}

export interface BuiltAgentPrompt {
  blocks: AnthropicSystemBlock[];
  /** Which components actually rendered something, in order. Useful
   *  for observability — stamp onto the run record so we can audit
   *  prompt shape drift. */
  rendered: Array<{ key: PromptComponentKey; cache: 'frozen' | 'volatile'; chars: number }>;
  /** Concatenated frozen body (what the cache block holds). */
  frozen: string;
  /** Concatenated volatile body (unchanged block, may be empty). */
  volatile: string;
}

export async function buildAgentPromptBlocks<Ctx>(
  input: BuildAgentPromptInput<Ctx>,
): Promise<BuiltAgentPrompt> {
  const orderKeys = input.order ?? DEFAULT_COMPONENT_ORDER;
  const byKey = new Map<PromptComponentKey, PromptComponent<Ctx>>();
  for (const c of input.components) byKey.set(c.key, c);

  const frozenChunks: string[] = [];
  const volatileChunks: string[] = [];
  const rendered: BuiltAgentPrompt['rendered'] = [];

  for (const key of orderKeys) {
    const component = byKey.get(key);
    if (!component) continue;
    const body = await component.render(input.ctx);
    if (!body || !body.trim()) continue;
    const withHeading = component.heading ? `## ${component.heading}\n\n${body.trim()}` : body.trim();
    if (component.cache === 'volatile') volatileChunks.push(withHeading);
    else frozenChunks.push(withHeading);
    rendered.push({ key, cache: component.cache, chars: withHeading.length });
  }

  const frozen = frozenChunks.join('\n\n');
  const volatile = volatileChunks.join('\n\n');

  const blocks = buildAgentSystemPrompt({
    frozen,
    volatile,
    mode: input.mode,
  });

  return { blocks, rendered, frozen, volatile };
}

// ─── Default components (stable parts shared across runtimes) ───────────────

/**
 * Small set of ready-made components that cover the common cases. They
 * are context-typed via `DefaultPromptContext` — callers that need
 * additional fields should compose their own context + components.
 */
export interface DefaultPromptContext {
  /** Agent persona. Cached. */
  role?: string;
  /** Bulleted capabilities (e.g. "can search memory, can call browser"). Cached. */
  capabilities?: string;
  /** Tool catalog block (e.g. rendered SKILL.md metadata table). Cached. */
  toolsBlock?: string;
  /** Skill library metadata table. Cached. */
  skillsBlock?: string;
  /** MCP server block — enabled server list + tool summaries. Cached. */
  mcpBlock?: string;
  /** Memory bank content. Often a compact summary of brief + active +
   *  progress docs. Cached UNLESS a per-turn context fragment is
   *  included — keep per-turn fragments in `environmentDetails`. */
  memoryBankBlock?: string;
  /** Raw `user_memory` content for this user/circle. When present, the
   *  memory_bank component appends a one-line cap-usage summary (via
   *  `describeUserMemoryUsage`) so the agent sees how close it is to the
   *  hard cap and can self-consolidate before `appendUserMemory` rejects
   *  (Phase CA-8b follow-up). Cached — usage drifts only when memory does. */
  userMemoryContent?: string;
  /** Hard rules ("never do X"). Cached. */
  rules?: string;
  /** Per-turn environment details (ISO timestamp, active user id,
   *  selected model, current file list). NOT cached. */
  environmentDetails?: string;
  /** Objective phrasing per turn — sometimes frozen, sometimes not.
   *  Default: frozen. */
  objective?: string;
}

export const DEFAULT_PROMPT_COMPONENTS: ReadonlyArray<PromptComponent<DefaultPromptContext>> = [
  { key: 'agent_role',          cache: 'frozen',   heading: 'AGENT',                render: (c) => c.role ?? null },
  { key: 'capabilities',        cache: 'frozen',   heading: 'CAPABILITIES',         render: (c) => c.capabilities ?? null },
  { key: 'tools',               cache: 'frozen',   heading: 'TOOLS',                render: (c) => c.toolsBlock ?? null },
  { key: 'skills',              cache: 'frozen',   heading: 'SKILL LIBRARY',        render: (c) => c.skillsBlock ?? null },
  { key: 'mcp_servers',         cache: 'frozen',   heading: 'MCP SERVERS',          render: (c) => c.mcpBlock ?? null },
  { key: 'memory_bank',         cache: 'frozen',   heading: 'MEMORY BANK',          render: (c) => {
      const parts: string[] = [];
      if (c.memoryBankBlock && c.memoryBankBlock.trim()) parts.push(c.memoryBankBlock.trim());
      if (typeof c.userMemoryContent === 'string') parts.push(describeUserMemoryUsage(c.userMemoryContent));
      return parts.length ? parts.join('\n\n') : null;
    } },
  { key: 'rules',               cache: 'frozen',   heading: 'RULES',                render: (c) => c.rules ?? null },
  { key: 'environment_details', cache: 'volatile', heading: 'ENVIRONMENT DETAILS',  render: (c) => c.environmentDetails ?? null },
  { key: 'objective',           cache: 'frozen',   heading: 'OBJECTIVE',            render: (c) => c.objective ?? null },
];

// ─── Variants (per-model overrides) ───────────────────────────────────────

/**
 * Variants are just an ordering + inclusion filter. Smaller / non-Claude
 * models can drop sections they choke on without touching the default
 * registry.
 */
export const PROMPT_VARIANTS: Record<string, ReadonlyArray<PromptComponentKey>> = {
  /** Full Cline-style order. Default. */
  full:     DEFAULT_COMPONENT_ORDER,
  /** Compact — drop skills + mcp blocks (e.g. local 7B models). */
  compact:  ['agent_role', 'capabilities', 'tools', 'memory_bank', 'rules', 'environment_details', 'objective'],
  /** Minimal — rules + objective only, for eval runs / benchmarks. */
  minimal:  ['agent_role', 'rules', 'objective'],
};
