# Tool Tree + Desktop/App/Browser Interaction — Research Report (2026-06-10)

> Deep-research pass on how to improve the SwanBot/OpenSwan/Chat tool catalog
> and its interaction with the user's desktop, native apps, and browser.
> Method: 6-angle web research with adversarial claim verification (109
> agents) + a full codebase map of the existing tool tree. Actionable items
> are tracked as T-items in `docs/SWANBOT_OPENSWAN_CHAT_NEXT_PLAN_2026-06-08.md`;
> this file is the evidence record.
>
> Verification caveat: the workflow's verification phase was partially cut by
> a session rate limit. Claims marked **[verified]** survived 2-3 adversarial
> votes or were re-verified directly against primary sources on 2026-06-10.
> Claims marked **[unverified]** are plausible but should not be cited as fact.

## 1. What the codebase actually is (ground truth)

The plan docs say "~45 tools"; the real catalog is much larger:

- **153 tool entries** in `openswanToolRuntime.ts` `TOOL_DEFINITIONS`
  (lines 615–2505). Families: desktop (57 — incl. 15 InDesign/Photoshop
  adapter tools), coordination (22+), knowledge (14), browser (10), vault (7),
  wordpress (4), verification (4), code/workspace/memory/agent/approval (3
  each), plus singletons.
- **~15–20k tokens of tool schema advertised per turn** (rough estimate:
  ~40–50k chars of descriptions; full JSON schemas considerably more).
  Surface filtering exists (`listOpenSwanToolsForSurface`) but every surface
  still gets its full family set; there is no progressive disclosure.
- **Dual registries still live**: the legacy `agentTools/` registry holds
  7 desktop tools + 7 read/manage tools, with three direct duplicates of
  catalog tools (`getMemberStatus`/`list_circle_members`,
  `searchCircleMemory`/`search_memories`, `getGithubActivity`/`github.activity`)
  and a different naming convention (snake_case vs dot.notation).
- **Two approval frameworks in parallel**: catalog tools gate through
  policy-based `maybeRequestToolApproval` (approvalMode/approvalKind);
  legacy desktop tools gate through `chatApprovalGate` category
  `desktop_action`. No unified audit trail.
- **approvalKind coverage is partial**: all `approvalMode: 'ask'` tools have
  one (R18 done), but ~20 *mutating auto* tools (missions/rooms/tasks
  coordination writes) have none, so the audit trail can't categorize them.
- **Mode tags cover ~30 of 153 tools** (`TOOL_MODE_TAGS`); the rest are
  mode-agnostic, including mutating tools that arguably shouldn't run in
  review/research modes.
- **MCP client exists but is unintegrated** (`src/lib/mcpClient.ts`):
  `tools/list` + `tools/call` over HTTP JSON-RPC, no approval gate, no
  surface/mode scoping, no annotation handling. Wiring it as-is would be a
  policy bypass.
- **Parallelism safety** (`toolBatchParallelism.ts`) is conservative and
  correct: a batch parallelizes only if every tool is read-only + auto +
  no approval gate. There is no dependency metadata for anything finer (O6).
- **Result formatting** is a 1,900-line hand-rolled per-tool formatter
  (`formatOpenSwanRuntimeToolResult`) with inconsistent detail levels.

## 2. Verified external findings

### 2.1 Static full-catalog advertising is the documented anti-pattern **[verified 3-0]**

Anthropic engineering ("Code execution with MCP", 2025-11): most MCP clients
load all tool definitions upfront; at scale this costs hundreds of thousands
of tokens. Independent corroboration: a production measurement of ~40 tools
consuming 143k of a 200k window (Apideck); GitHub MCP server definitions
alone measured at 17.6k–55k tokens. Our 153-tool catalog is squarely in the
affected regime.

### 2.2 Progressive disclosure / dynamic tool selection is the remedy **[verified 3-0 + direct]**

Two sanctioned mechanisms: (a) tools-as-code loaded on demand, (b) a
`search_tools` entry point returning only relevant definitions. Anthropic's
worked example: 150k → 2k tokens (98.7% — illustrative demo, not a benchmark).
Directly re-verified against `anthropic.com/engineering/advanced-tool-use`
(2026-06-10): the Claude API now ships this first-party — mark tools
`defer_loading: true`, the Tool Search Tool expands matches on demand.
Measured first-party results: **85% token reduction** (~77k → ~8.7k tokens)
and **accuracy gains on large-catalog MCP evals: Opus 4 49% → 74%, Opus 4.5
79.5% → 88.1%** — i.e., a large static catalog measurably *degrades tool
selection*, it doesn't just cost tokens. Stated adoption threshold: **10+
tools or >10k tokens of definitions** — we are ~15x past the first and
well past the second. Programmatic tool calling (model writes code that
calls tools, outputs stay out of context) measured a further 37% reduction
on complex tasks.

### 2.3 Consolidate, don't expand **[verified 3-0, two claims]**

Anthropic engineering + official tool-use docs: fewer, higher-level tools
beat many thin wrappers (`schedule_event` vs `list_users+list_events+
create_event`; one tool with an `action` parameter vs create/review/merge
triplets) because they reduce selection ambiguity. Caveat from verifiers:
consolidation is one strategy among several (alongside namespacing and tool
search) — group the catalog, don't collapse it into mega-tools. Our
57-tool `desktop.*` family (9 file ops, 6 mouse ops, 15 Adobe ops as
separate tools) is the obvious target.

### 2.4 Namespacing and descriptions are measurable design surfaces **[verified 3-0 / 2-0]**

- Prefix- vs suffix-based namespacing has "non-trivial effects on tool-use
  evaluations", varying by model — keep our family-prefix scheme but
  validate with per-model evals (we route across many providers).
- Tool description refinements alone "dramatically reduced error rates" and
  contributed to a SWE-bench Verified SOTA (33.4% → 49%, partly attributed).
  A description-quality audit over the catalog is the cheapest reliability
  win available. (2-0 vote — medium confidence; first-party, unquantified.)
- MCP tool-name constraints (relevant if we expose families over MCP):
  dots/underscores/hyphens allowed, ≤128 chars — our dot notation is
  compliant; the legacy snake_case names are too, but the inconsistency
  costs selection accuracy for no benefit.

### 2.5 MCP spec — directly verified against 2025-11-25 revision **[verified direct]**

- **Annotations are untrusted**: "clients **MUST** consider tool annotations
  to be untrusted unless they come from trusted servers." So
  `readOnlyHint`/`destructiveHint` can NEVER auto-derive our
  approvalMode for third-party servers; unannotated/untrusted ⇒ treat as
  mutating + destructive ⇒ `ask`. Fail-closed, same posture as our evidence
  contracts.
- **Dynamic catalogs are native**: `listChanged` capability +
  `notifications/tools/list_changed`; clients re-fetch at runtime. Static
  advertising is a client choice, not a protocol requirement.
- **Human-in-the-loop is normative**: applications "**SHOULD**" keep a human
  able to deny invocations, show which tools are exposed, indicate
  invocations visually, and confirm operations. Clients SHOULD show tool
  inputs before calling, validate results before passing to the LLM, and log
  usage for audit. Our pre-dispatch gate + run ledger already match this;
  MCP tools must be routed through the same path.

### 2.6 Claude in Chrome permission model **[verified direct]**

The closest shipped analog to our chat→browser/desktop autonomy problem:

- Two modes: "Ask before acting" (plan needs approval) vs "Act without
  asking" (explicitly framed as higher risk).
- **Per-site sticky allow**: "Allow this action" (single use) vs "Always
  allow actions on this site" (persistent, reviewable/revocable in a
  permissions settings surface with history).
- **Always-confirm floor regardless of mode**: purchases/financial
  transactions and permanent deletions always require explicit confirmation;
  account creation, granting authorizations, and sensitive-information entry
  are also protected.
- **Hard prohibitions** that no mode unlocks: handling credit-card/ID data,
  downloads from untrusted sources, modifying security controls, and
  **completing instructions embedded in email or web content** (structural
  injection defense, matching our untrusted-content fencing rule).
- Org-level allowlists/blocklists override user permissions.

### 2.7 Unverified but load-bearing (do not cite as fact)

All claims on these went 0-0 (rate-limited verification), and the Operator
system card returned 403 on direct fetch:

- Computer-use prompt-injection attack rates (RTC-Bench ASRs: 42.9% Claude
  3.7 CUA, 60% Claude 4.5 CUA end-to-end, 7.6% Operator; 92.5% attempt
  rates). Plausible and directionally consistent with our fail-closed
  posture — keep the evidence contracts on first principles.
- GUI-agent brittleness to layout change; API/adapter agents beating GUI
  agents on efficiency (supports our typed-adapter-first surface ranking,
  but on first principles, not this evidence).
- Accessibility-tree-first vs screenshot-first tradeoffs, AXUIElement/UIA
  specifics, CDP vs extension vs cloud browser — needs a focused follow-up
  round against primary docs before any desktop-bridge architecture change.
- `response_format` (concise/detailed) on tool responses + Claude Code's
  25k-token tool-response cap (1-0 vote).

## 3. What this means for us — gap analysis

| External finding | Our state | Gap |
|---|---|---|
| Dynamic tool selection at 10+ tools | 153 static tools, ~15–20k tokens/turn | Largest single win available |
| Consolidate thin wrappers | desktop.* = 57 tools, coordination = 22+ | Selection-ambiguity + token cost |
| Description quality drives error rates | 153 descriptions, never audited | Cheapest reliability win |
| One registry, one policy gate | 2 registries, 2 approval frameworks, 3 dup tools | O2 unfinished; audit trail split |
| MCP annotations untrusted, fail closed | mcpClient bypasses all policy | Security gap if ever wired as-is |
| approvalKind on every mutation | ~20 mutating-auto tools lack it | Audit categorization holes |
| Sticky per-site allow + always-confirm floor | Constraint categories + grant memory exist; sticky scopes tracked-unscheduled | UX gap, pattern now validated |
| Dependency metadata for parallelism | All-read-only-or-sequential rule | O6 still unbuilt (correct but slow) |

## 4. Prioritized recommendations (T-items)

Tracked in the next-plan doc; summary here. Ordering favors: cheap+verified
first, structural second, UX third. No new parallel modules — everything
extends `openswanToolRuntime.ts` and existing owners.

- **T1 — Description/schema audit pass** over the catalog (when-to-use,
  preconditions, failure modes, what evidence it returns; one consistent
  voice). Cheapest verified win. Pairs with a smoke that lints description
  length/shape.
- **T2 — Progressive disclosure in the catalog owner.** Provider-agnostic
  core: a pinned high-frequency core per surface + `tools.search` entry
  point that expands families on demand (the registry becomes a queryable
  index). On Anthropic paths additionally adopt native
  `defer_loading`/Tool Search. Interacts with R15/O7 prompt caching —
  design the cache boundary and the deferral together.
- **T3 — Family consolidation**: action-parameterized group tools for
  desktop file ops, mouse ops, clipboard, InDesign, Photoshop (57 → ~20),
  and the missions/tasks/rooms write families. Constraint: the `action`
  parameter must drive approval policy (a grouped tool is as strict as its
  strictest action unless the action is classified).
- **T4 — Finish O2**: migrate the 7 remaining `agentTools/` locals into the
  catalog, retire snake_case duplicates, delete the legacy registry.
- **T5 — One approval framework**: route legacy desktop tools through the
  policy gate; add `approvalKind` to every mutating tool (including
  mutating-auto coordination writes) so the audit trail is complete.
- **T6 — MCP integration done right**: wrap MCP tools in an
  `openswanBridge`-style adapter; unannotated/untrusted-server tools default
  to mutating+destructive ⇒ `ask`; annotations from circle-trusted servers
  may relax to the catalog's normal policy; surface/mode scoping applies;
  inputs shown pre-call; usage logged to the run ledger. Support
  `listChanged` re-fetch.
- **T7 — Sticky allow scopes + always-confirm floor** (Claude-in-Chrome
  pattern): per-site/per-app "always allow" grants with a reviewable,
  revocable permissions surface + history; a hard always-confirm category
  floor (pay/delete-permanent/credential-entry/account-grant) that no
  autonomy mode or sticky grant bypasses — extends the existing D3
  constraint categories and grant memory.
- **T8 — O6 dependency metadata**: add `mutationTarget`/`readsFrom` to tool
  policies so batches can parallelize reads against disjoint targets instead
  of the current all-or-nothing rule. If the compositional-risk claim
  ("lethal trifecta") verifies later, the same metadata feeds session-level
  risk analysis.
- **T9 — Mode-tag completion**: default all mutating tools to
  `build`/`execute`; explicit tags elsewhere.
- **T10 — Composable result formatters + token-efficient responses**:
  shared list/object/error formatter library; optional
  `response_format: concise|detailed` on observation-heavy tools
  (a11y trees, file listings, DOM snapshots).

**Avoid**: mega-tool collapse (keep families; consolidation ≠ one tool),
deriving approval from third-party MCP hints, growing the static catalog
further before T2, and any architecture change to the desktop bridge based
on the unverified Q2/Q3 claims (follow-up research first).

## 5. Open questions for a follow-up round

1. Desktop/native-app interaction SOTA (a11y-tree-first vs screenshot-first,
   AXUIElement/UIA, adapter-vs-generic) — primary sources only.
2. Operator/ChatGPT-agent takeover-mode secret handling (system card 403'd) —
   compare against our D5 structural no-screenshot-during-takeover property.
3. Per-model namespacing/eval: do our non-Anthropic routed models select
   tools better with different naming? (Needs our own eval harness.)
4. Compositional session risk ("lethal trifecta") — if substantiated, O6/T8
   metadata becomes a safety requirement, not an optimization.

## 6. Sources

Verified primary: anthropic.com/engineering/code-execution-with-mcp,
anthropic.com/engineering/writing-tools-for-agents,
anthropic.com/engineering/advanced-tool-use,
platform.claude.com/docs/.../define-tools,
modelcontextprotocol.io/specification/2025-11-25/server/tools,
support.claude.com (Claude in Chrome permissions guide),
anthropic.com/news/claude-for-chrome, anthropic.com/news/swe-bench-sonnet.
Unverified (rate-limited or 403): openai.com Operator system card,
arxiv 2505.21936 (RTC-Bench), arxiv 2503.11069 (API vs GUI agents),
blog.modelcontextprotocol.io tool-annotations post, Microsoft agentic-AI
failure-modes taxonomy, plus assorted practitioner blogs.
