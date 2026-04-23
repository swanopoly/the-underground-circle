# Cline Research + UC Mapping

_Research date: 2026-04-22_
_Purpose: concrete, implementation-ready mapping from Cline's mechanisms to Underground Circle surfaces. Intended as the input to a follow-up build plan — not a feature pitch._

Sources checked: `cline.bot`, `docs.cline.bot` (`getting-started/what-is-cline`, `core-workflows/plan-and-act`, `features/checkpoints`, `features/auto-approve`, `features/plan-and-act`, `mcp/mcp-overview`, `mcp/configuring-mcp-servers`, `mcp/mcp-marketplace`, `prompting/cline-memory-bank`, `cline-cli/interactive-mode`), `github.com/cline/cline/tree/main/src/core/prompts/system-prompt`, public gists of the runtime system prompt (`hskartono` gist), Cline issues thread on tool format.

---

## Part 1 — What Cline actually is

Cline is an open-source, **client-side** coding agent that runs inside a VS Code (and JetBrains / CLI) surface. It is provider-agnostic — users bring an Anthropic, OpenRouter, Bedrock, Vertex, Gemini, or Cerebras key — and every file read, file edit, and terminal command is executed locally on the user's machine. The selling point is not "smarter model," it is **transparency + human-in-the-loop + undo**: you see every tool call, approve (or auto-approve by category) every action, and any step is reversible via a shadow-git checkpoint.

Mechanically, Cline is a fairly thin TypeScript extension that (a) builds a large **XML-tool system prompt** from composable components, (b) streams model output, (c) parses tool invocations out of the stream as XML blocks, (d) executes them against the workspace with an approval gate in front, and (e) snapshots the workspace to a separate shadow git repo after each tool use so "Restore" is one click. Roughly: `src/core/prompts/system-prompt/` holds `registry`, `components`, `tools`, `variants`, `templates`. Components (`agent_role`, `system_info`, `mcp`, `todo`, `user_instructions`, `tool_use`, `editing_files`, `capabilities`, `rules`) are ordered per variant and rendered via a `{{PLACEHOLDER}}` `TemplateEngine`.

The headline behaviors are Plan/Act mode (Tab to toggle, different model and different constrained tool set per mode), checkpoints, per-category auto-approve, MCP marketplace with one-click install, and an optional "memory-bank" convention (six markdown files under `memory-bank/`) that is layered on top of the normal `.clinerules`. These are not marketing tagline features — they are all directly visible in the open-source tree and in the rendered system prompt.

---

## Part 2 — The 7 mechanisms

### 2.1 Plan vs Act mode
- **Toggle.** `Tab` in the CLI interactive mode toggles Plan ↔ Act. Same toggle lives in the VS Code UI. CLI flags `-p / --plan` and `-a / --act` force a mode. (`docs.cline.bot/cline-cli/interactive-mode`)
- **Hard capability gate.** In Plan mode Cline "cannot modify any files or execute commands" — only read, search, and discuss. The docs call this "exploration without changes."
- **Tool surface changes.** The system prompt adds a `plan_mode_response` tool that is only available in Plan mode; `write_to_file`, `replace_in_file`, and `execute_command` are gated off. Context carries across (`"the conversation history carries over when you switch modes"`).
- **Model-per-mode.** Users can assign a different model to each mode (common pattern: Opus for plan, Sonnet/Haiku for act). Not automatic.
- **Auto-approve overlap.** `Shift+Tab` toggles auto-approve for all actions, independently of Plan/Act.

### 2.2 Checkpoints / undo
- **Storage.** "Cline maintains a shadow Git repository separate from your project's actual Git history." (`features/checkpoints`). So it is git-based but not the user's git; `.git` is untouched.
- **Cadence.** Created **after every tool use**: "If Cline edits three files in sequence, you get three checkpoints." Not per-step, not per-prompt — per-tool-call.
- **UI.** A bookmark icon labeled **Checkpoint** appears in the conversation with a dotted connector to **Compare** and **Restore** buttons. `Compare` opens a diff view; `Restore` opens a three-way menu: `Restore Files`, `Restore Task Only`, `Restore Files & Task`.
- **Includes untracked files** (a real benefit over relying on user git).

### 2.3 Auto-approve
- **Granularity = per-tool-category, not per-path, not per-regex.** Eight toggles exist: `Read project files`, `Read all files`, `Edit project files`, `Edit all files`, `Execute safe commands`, `Execute all commands`, `Use the browser`, `Use MCP servers`. (`features/auto-approve`)
- **`requires_approval` flag on commands.** "Cline does not use a fixed allowlist. The model marks each command with a `requires_approval` flag based on the command and arguments." The agent self-declares risk per invocation — that is what `Execute safe commands` gates on.
- **YOLO mode** is the inverse kill-switch: one toggle auto-approves everything.
- **Per-MCP-server allowlist.** `cline_mcp_settings.json` has `"alwaysAllow": [toolNames…]` per server — a second, finer layer that lives in config, not UI.
- **No mid-execution kill switch is documented.** Shift+Tab toggles the setting; there is no hardware brake inside a running tool loop.

### 2.4 MCP integration
- **Spawn model.** Cline **spawns** stdio MCP servers as child processes itself, it does not only connect to external ones. SSE servers are connected by URL.
- **Config file.** `cline_mcp_settings.json` — `{ mcpServers: { "<name>": { command, args, env, alwaysAllow, disabled } } }` for stdio, `{ url, headers, alwaysAllow, disabled }` for SSE. (`mcp/configuring-mcp-servers`)
- **Install path.** Marketplace "one-click install" clones each server into `~/Documents/Cline/MCP/<server>`, runs its build, writes the registered command+args to `cline_mcp_settings.json`, and hot-reloads.
- **Prompt injection.** "Your server's capabilities are added to Cline's system prompt" — the `mcp` component in `src/core/prompts/system-prompt/components/` renders a block listing every active server, its tools, and tool schemas, plus two generic tools: `<use_mcp_tool>` (server_name + tool_name + arguments JSON) and `<access_mcp_resource>` (server_name + uri).
- **Disable UX.** One toggle per server in the MCP panel, or `"disabled": true` in JSON.

### 2.5 Memory bank
- **Convention, not code.** Memory bank is a **documented prompting pattern**, not a feature flag. It lives in `memory-bank/` at the project root with six markdown files: `projectbrief.md`, `productContext.md`, `activeContext.md`, `systemPatterns.md`, `techContext.md`, `progress.md`. (`prompting/cline-memory-bank`)
- **Read cadence.** The user's `.clinerules` instructs the model: _"I MUST read ALL memory bank files at the start of EVERY task"_. So it is effectively load-on-session.
- **Write trigger.** The user (or model) types `update memory bank` to trigger a full review + rewrite; milestones and direction-changes also prompt a rewrite.
- **Rules vs memory bank.** `.clinerules` files load into **every request**; memory bank is read by Cline's behavior-on-task-start and is larger / per-doc. Rules are instructions; memory bank is **state**.

### 2.6 System prompt + tool-use format
- **XML tool blocks, one per turn.** Format: `<tool_name><param>value</param></tool_name>`. The agent may only emit one tool per message. On parse failure the runtime replies with a tool-format reminder.
- **Top-level sections** (from rendered prompt): `TOOL USE`, `TOOL USE FORMATTING`, `TOOLS`, `TOOL USE GUIDELINES`, `MCP SERVERS`, `EDITING FILES`, `ACT MODE V.S. PLAN MODE`, `CAPABILITIES`, `RULES`, `SYSTEM INFORMATION`, `OBJECTIVE`.
- **Canonical tool list.** `execute_command`, `read_file`, `write_to_file`, `replace_in_file` (SEARCH/REPLACE blocks), `search_files` (regex), `list_files`, `list_code_definition_names` (tree-sitter symbols), `use_mcp_tool`, `access_mcp_resource`, `ask_followup_question`, `attempt_completion`, `plan_mode_response`.
- **Auto-injected environment.** Every turn appends an `environment_details` block: cwd, OS, default shell, home dir, **recursive file tree of cwd**, actively-running terminals. `SYSTEM INFORMATION` is static per session; `environment_details` is dynamic per turn.
- **Composable prompt.** `PromptBuilder` + `TemplateEngine` with `{{PLACEHOLDER}}` substitution; per-model `variants/` override component order or drop sections (useful for smaller / non-Claude models that choke on the full prompt).

### 2.7 UI patterns
- **Tool calls render inline as collapsible cards** with a bookmark-style header (tool name + target file), a live diff or terminal pane body, and Compare/Restore controls directly under the card.
- **Approval is a two-button strip under each pending tool call** — `Approve` / `Reject` — with optional free-text feedback that is returned to the model as a user turn.
- **Errors surface as model turns** — a parse-fail, command non-zero exit, or rejected tool all round-trip as `<tool_result>…</tool_result>` text back to the agent; UI shows the error inline with a red left-border.
- **Cost meter.** A persistent footer shows `tokens in / out · $` per turn and cumulative for the task. Model selection happens in the same footer.
- **`@` mentions** — `@file`, `@folder`, `@url`, `@problems` — are first-class chips in the composer; they expand into file context blocks injected above the user message.

---

## Part 3 — Concrete mapping to UC

For each mechanism: **What to build**, **Where it lives / replaces**, **MVP slice**, **Risk**. We already have HITL, so only the _delta_ over our approval gate is called out.

### 3.1 Plan vs Act mode
- **What to build.** A persistent `mode: 'plan' | 'act'` on the chat session + a Tab keybind / pill toggle in `ChatTab.tsx` header. Plan mode: `chatAutomationPlanner` may only emit route families that are pure reads (`search`, `memory.read`, `help`, `session_search`, `github.read`, `browser.read`, `hf_tools.read`) and one new route `plan_response` (no executor). Act mode: current behavior.
- **Where it lives / replaces.** Extends `src/lib/chatAutomationPlanner.ts` (add `allowedFamiliesForMode`), `src/lib/runChatAutomationPlan.ts` (refuse destructive plans when `mode==='plan'`), and `ChatTab.tsx` header pill. Does **not** replace HITL — it is an orthogonal gate that sits _before_ approval, matching Cline's "Plan mode can't even propose a write."
- **MVP slice.** (1) add `mode` to session state + `uc_nav_state_v1`; (2) add `Tab` keybind + header pill with amber (plan) / green (act) accent; (3) whitelist read-only families in `chatAutomationPlanner`; (4) render a `Plan → Act` CTA button on the final assistant message in plan mode that flips the toggle; (5) log `mode_transition` to `chat_automation_decisions`.
- **Risk.** ChatTab is ~4700 lines; a new mode branch is easy to leak. Keep the enforcement in `runChatAutomationPlan.dispatch` so no caller can bypass it. Also: do **not** build mode-per-model yet — users do not need to pick two models.

### 3.2 Checkpoints / undo
- **What to build.** "Task checkpoint" per tool call for **our** destructive actions (file writes on skills, `circle_memory` writes, automation inserts, browser DOM edits). Store forward state + reverse patch in a new table `chat_checkpoints(id, session_key, plan_id, tool_kind, before_hash, after_hash, diff_json, created_at, restored_at)`.
- **Where it lives / replaces.** New file `src/lib/chatCheckpoints.ts`; hook points inside the executor at the end of each tool (`runChatAutomationPlan.ts` observer hook already exists — `runChatAutomationPlanObserver.ts`). Extends, does not replace, `agentApprovalsWorker`. The HITL gate is "may I?"; checkpoints are "undo the yes."
- **MVP slice.** Only three tool kinds first — `memory.write`, `skill.write`, `automation.create`. For each, before executing: snapshot the **current row(s)** as JSON; after executing: store `{ before, after, diff }`. Render a one-line `Checkpoint #7 · Compare · Restore` strip under the assistant message. `Restore` inverts: write `before` back.
- **Risk.** We are not a filesystem — undo semantics vary per tool. Do not ship a generic "restore" button; each `tool_kind` gets a named handler that knows how to reverse itself. Refuse to restore if downstream dependents changed (hash compare).

### 3.3 Auto-approve upgrade (not "add it" — make ours granular)
- **What Cline does better than our gate.** `chatApprovalGate.ts` treats `approval.required` as a single boolean coming from the planner. Cline has (a) per-tool-category toggles, (b) a model-declared `requires_approval` flag per command, (c) per-MCP `alwaysAllow` lists. Our gate is coarser.
- **What to build.** (1) Add an `autoApprove` setting object to `user_memory` / `circles.settings`: `{ read_memory, write_memory, run_skill, create_automation, browser_click, mcp_tool_by_name }` each booleans or `"ask" | "auto" | "never"`. (2) Let `chatAutomationPlanner` emit a `riskFlag` that the user's setting can override _only one way_ (never from `never` to `auto`). (3) Surface in the existing HITL banner as a "remember this for read-only memory writes" shortcut — one tap, writes the setting.
- **Where it lives / replaces.** Extends `src/lib/chatApprovalGate.ts` (consult settings before creating a proposal). New `src/lib/chatAutoApproveSettings.ts`. UI lives next to `AgentKillSwitch.tsx` since it is the same mental model.
- **MVP slice.** Three categories only: `memory_read`, `memory_write`, `skill_run`. "Remember this choice" checkbox on the HITL banner. YOLO-mode toggle piggybacks on the existing `agent_controls.pause` surface but inverted — call it `fast_mode`.
- **Risk.** Silent auto-approval of skill execution is the dangerous one. Default everything to `ask`. Never auto-approve anything that writes to Supabase tables users didn't opt in per-table.

### 3.4 MCP integration upgrade
- **What Cline does better.** We already have `src/lib/mcpClient.ts` (108 lines) and a `mcp-server` edge function. What we lack: (a) a **settings JSON** that declaratively lists servers, (b) **prompt-block rendering** of MCP tools into the system prompt, (c) **one-click install** UX, (d) **per-server allowlist**.
- **What to build.** (1) `circles.settings.mcp_servers: { [name]: { transport, command|url, args?, env?, alwaysAllow: string[], disabled: boolean } }`. (2) Extend `src/lib/agentSystemPrompt.ts` to render an `<MCP_SERVERS>` block the way `skillPromptInjection.ts` renders skills today. (3) Two generic tools `use_mcp_tool` / `access_mcp_resource` in our tool registry. (4) A catalog pane in the existing IntegrationsTab for "Add MCP server" with three default entries (GitHub, Linear, Notion) — these write to `circles.settings.mcp_servers`.
- **Where it lives / replaces.** Extends: `mcpClient.ts`, `agentSystemPrompt.ts`, `skillPromptInjection.ts` pattern. Does not replace `circleIntegrationCatalog.ts` — MCP is additive alongside first-class integrations.
- **MVP slice.** Remote/SSE only first (no spawning processes on user machines). Two servers: the existing `mcp-server` edge fn + one external. Render the block in prompts but do not expose install UI yet — hand-edit settings.
- **Risk.** We are a mobile-first RN app; spawning local stdio servers is an anti-goal. Stay SSE/remote until CLI mode is a real product.

### 3.5 Memory bank convention
- **What Cline does better.** Our `circle_memory` + `agentMemory.ts` is one free-form doc. Cline's split into six named files is a **retrieval hack**: the model knows exactly which doc to read for which question, so it reads less.
- **What to build.** Structured sections inside `circle_memory` (or six rows with a `doc_kind` column): `brief`, `product_context`, `active_context`, `system_patterns`, `tech_context`, `progress`. Add a `SharedMemoryPanel` section selector (tabs). System prompt injects section-by-section with headings, not the whole doc.
- **Where it lives / replaces.** Extends `src/lib/agentMemory.ts` (add `doc_kind`), `circle_memory` migration (add `doc_kind text not null default 'brief'`), `SharedMemoryPanel.tsx`. Replaces: nothing. Strictly additive.
- **MVP slice.** Start with **three** docs, not six: `brief`, `active_context`, `progress`. Add a slash command `/memory update brief` that rewrites only that doc. `memory read` in planner becomes `memory read <doc_kind?>`.
- **Risk.** Six docs is overkill for circles < 5 people. Ship three, add the rest if users ask. Also: do not let the model rewrite all docs on every turn — that is a token drain. Require explicit `/memory update <kind>`.

### 3.6 System prompt + tool-use format
- **What to adopt.** **Not XML tool format** — we use structured planner outputs and should keep that. What to adopt is: (a) the **composable prompt builder** pattern, (b) per-model **variants**, (c) always-injected **environment_details** block.
- **What to build.** Refactor `src/lib/agentSystemPrompt.ts` into a `PromptBuilder` that renders a fixed `componentOrder`: `agent_role`, `capabilities`, `tools`, `skills`, `mcp_servers`, `memory_bank`, `rules`, `environment_details`, `objective`. Each component is a function `(ctx) => string`. Variants per model live in a `variants/` dir.
- **Where it lives / replaces.** Extends `agentSystemPrompt.ts`, `skillPromptInjection.ts`, `openswanSkillPlaybooks.ts`. Replaces the ad-hoc `include if X else ''` code path that currently lives in chat assembly.
- **MVP slice.** Just split the existing prompt into four named components (`role`, `skills`, `memory`, `environment`) and render via a sequenced array. Do not build the template engine yet — string concat with trimmed separators is enough.
- **Risk.** Prompt caching. Anthropic `cache_control` boundaries must line up with component boundaries — per existing memory rule, timestamps go only in `environment_details`, everything else stays cacheable. Get this wrong and cache hit rate collapses.

### 3.7 UI patterns worth stealing
- **What to build.**
  1. **Collapsible tool-call cards** in ChatTab: each dispatched plan renders as a card with `route family · target · status` header, diff/output body, and Compare/Restore strip. Replaces our current "message + small chip" pattern. (File: new `src/components/chat/ToolCallCard.tsx`.)
  2. **Approve/Reject strip with free-text feedback** under pending HITL proposals — feedback returns to the planner as a synthetic user turn. Extends `HitlApprovalBanner.tsx`.
  3. **Cost/token footer** persistent in ChatTab composer area. Already have `circleCostTelemetry.ts`; wire it into the composer bar instead of a separate panel. Show `in / out · $` per last turn + cumulative per session.
  4. **`@` mention chips in composer** — `@skill:name`, `@memory:active_context`, `@file`, `@run:<id>`. Each expands into a context block above the user turn. Extends `chatComposerController.ts`.
- **Risk.** ChatTab is already the heaviest file. Do **not** add tool-call cards inline in ChatTab; render from a data array the executor already emits (observer). Keep the card dumb.

---

## Part 4 — Priority-ordered implementation list (impact ÷ effort)

| # | Item | Impact | Effort | Maps to CHAT_AUTOMATION_AUDIT_PLAN |
|---|---|---|---|---|
| 1 | **Plan vs Act mode pill + Tab keybind** in `ChatTab.tsx`, enforced in `runChatAutomationPlan.dispatch`. Whitelist read-only families in Plan. | High | Low | New phase CA-6 (complements CA-1 planner + CA-4 HITL) |
| 2 | **Auto-approve remember-this on HITL banner** + three-category settings (`memory_read`, `memory_write`, `skill_run`). | High | Low | Direct upgrade to CA-4 (chatApprovalGate) |
| 3 | **Cost/token footer in ChatTab composer** using existing `circleCostTelemetry.ts`. | Medium | Low | Orthogonal to the plan; small UX win |
| 4 | **Composable system prompt builder** — split `agentSystemPrompt.ts` into named components + sequenced order. | High | Medium | CA-3-ish (unifies prompt assembly ahead of MCP + memory bank) |
| 5 | **Memory bank: three docs** (`brief`, `active_context`, `progress`) with `doc_kind` + `/memory update <kind>`. | Medium | Medium | Extends existing `agentMemory`/Phase 4a-c |
| 6 | **Tool-call card component** rendered from executor observer stream (`runChatAutomationPlanObserver.ts`). | High | Medium | Consumes CA-1/CA-5 outputs cleanly |
| 7 | **Checkpoints for 3 tool kinds** (`memory.write`, `skill.write`, `automation.create`) with Compare/Restore UI. | High | Medium/High | New phase; builds on CA-5 repeated-flow detector table shape |
| 8 | **MCP prompt block + settings JSON** (SSE-only first, no spawn). | Medium | Medium | Extends existing mcpClient.ts; parallel to CA-2 /automation slash family |
| 9 | **@ mention chips** (`@skill`, `@memory`, `@file`, `@run`) in composer. | Medium | Medium | Orthogonal; slots into the audit plan's "first-class chat actions" theme |
| 10 | **One-click MCP install (marketplace)** catalog pane in IntegrationsTab. Ship only after #8. | Low–Medium (for our audience) | High | Later |

**Overlaps with current `CHAT_AUTOMATION_AUDIT_PLAN_2026-04-21.md`:**
- Items **1, 2, 6** are direct extensions of Phases CA-1 (planner) and CA-4 (approval gate) — do these inside the same audit-plan phase family, not as a new doc.
- Items **4, 5** ride on Phase 4a–4c (user/circle memory) and the skill-prompt injection work already landed.
- Item **7** is new. File it as a new phase (suggest `CA-7: Checkpoints & Reversible Tools`).
- Items **8, 10** are new product surface; do not fold into the audit plan — they need their own MCP plan doc.

---

### Summary (≤200 words)

Cline is a client-side, provider-agnostic coding agent whose interesting parts are not the model but the **scaffolding**: an XML-tool system prompt assembled from composable components, Tab-toggled Plan/Act modes that hard-gate tool access, shadow-git checkpoints after every tool call, per-category auto-approve with a `requires_approval` model-declared flag, an MCP marketplace that spawns or connects servers and injects their tools into the prompt, and a six-file memory-bank convention.

Our highest-leverage steals are (1) Plan/Act as a route-family gate before our existing HITL, (2) a `remember this` option on the HITL banner that writes per-category auto-approve settings, (3) refactoring the system prompt into ordered components so skills / MCP / memory-bank injection stop being ad-hoc, and (4) tool-call cards in chat fed by the executor observer. Checkpoints are the biggest single win but also the highest effort — ship it after items 1-6.

Full report: `docs/CLINE_RESEARCH_AND_MAPPING_2026-04-22.md`.
