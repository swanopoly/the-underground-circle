# Agent Ecosystem Connect And Build Research

**Date:** 2026-07-20  
**Scope:** How The Underground Circle can help users connect Codex, Claude Code,
Cursor, and adjacent coding agents to build apps, operate other apps, and create
a better agent-centered user experience.

## Executive Thesis

The Underground Circle should not try to become another coding editor or another
single-agent chat surface. The highest-leverage position is a shared **agent
control plane**:

- Agents plug in through standard context files, SKILL.md packages, MCP servers,
  webhooks, local bridges, and generic task endpoints.
- Users launch, watch, approve, steer, compare, and recover agent work from one
  place.
- Teams get a durable source of truth for tasks, proof, memory, skills, file
  ownership, approvals, costs, and what actually shipped.
- Unsupported external apps become buildable capabilities through a guarded
  app-adapter lane instead of one-off screen driving.

The product already has many of the hard primitives. The main opportunity is to
package them into a first-run experience and a reliable day-to-day loop that
makes users feel like every coding agent they use is part of one coordinated
team.

## What The Ecosystem Is Converging On

Current Codex, Claude Code, Cursor, MCP, and OpenAI Apps SDK documentation all
point toward the same platform primitives:

1. **Agent-readable repo context**
   - AGENTS.md is now an open format for agent instructions and is used across a
     broad ecosystem of coding agents. It is intended as a predictable place for
     build commands, tests, conventions, and other agent-specific guidance.
   - Cursor supports both `.cursor/rules/*.mdc` and root/nested `AGENTS.md`.
   - Codex uses `AGENTS.md` plus `.codex/config.toml` for durable repo behavior.
   - Claude Code uses `CLAUDE.md`, settings, hooks, MCP, skills, and auto memory.

2. **Portable skills**
   - OpenAI Codex, Claude Code, and Cursor all now treat skills as portable
     workflow bundles centered on `SKILL.md` plus optional scripts, references,
     templates, and assets.
   - Cursor explicitly loads skills from `.agents/skills`, `.cursor/skills`,
     `.claude/skills`, and `.codex/skills`.
   - Codex skills use progressive disclosure: name/description first, full skill
     content only when selected.
   - Claude skills can run inline or in a forked subagent context and can carry
     hooks, model/effort settings, path scoping, and supporting files.

3. **MCP as the integration layer**
   - MCP is the shared way to expose resources, prompts, and tools to AI hosts.
   - MCP hosts can be editors, chat apps, CLIs, or custom workflows.
   - The MCP spec emphasizes explicit consent, data privacy, tool safety, and
     treating tool annotations as untrusted unless the server is trusted.
   - Cursor supports stdio, SSE, and Streamable HTTP MCP transports, plus tools,
     prompts, resources, roots, elicitation, and MCP Apps.
   - Claude Code can consume MCP servers and can also run `claude mcp serve` so
     other apps can connect to Claude Code itself.
   - OpenAI Apps SDK is built on MCP: the server exposes tools, structured
     content, optional instructions, auth, and optional UI resources.

4. **Subagents and parallel work**
   - Codex and Claude Code both support subagent workflows that keep noisy work
     out of the main thread and return summaries.
   - Cursor supports subagents and skills, with subagents running independently
     and using their own context.
   - The common risk is not "can agents run in parallel?" but "can the user see
     what each agent owns, prevent file conflicts, and merge the results safely?"

5. **Hooks, events, and automation**
   - Claude Code hooks can fire on session, prompt, tool, subagent, permission,
     file, and display events.
   - Cursor skills include built-ins for automations, hooks, rules, reviews, and
     PR babysitting.
   - Codex supports durable config, MCP, skills, plugins, hooks, cloud/web/CLI
     surfaces, and automations.
   - These features create the need for a shared activity feed, approval queue,
     and proof ledger outside any one editor.

6. **User trust is the UX moat**
   - OpenAI Apps SDK guidance stresses atomic actions, concise structured
     outputs, clear in-chat completion, and helpful UI only where it improves the
     task.
   - MCP security guidance requires explicit consent, minimum data sharing, and
     human-visible authorization before tool actions.
   - Users need enough visibility to trust the agents, but not so much raw log
     noise that they abandon the workflow.

## Current UC Baseline

The existing app already has an unusually strong foundation for this direction:

- `docs/UC_APP_STACK_REFERENCE.md` defines Chat, Office, Feed, Rooms,
  Marketplace, and Computer Use as the main surfaces.
- The stack already includes BlackSwan/OpenSwan, Claude Code/Codex bridges,
  Browserbase Computer Use, provider routing, and BYOK provider keys.
- Chat planning already routes requests through `chatAutomationPlanner`,
  `runChatAutomationPlan`, SwanBot/OpenSwan, provider resolution, and persisted
  compact metadata.
- Computer and app tasks already carry hidden route, approval, proof,
  recovery, and evidence contracts through `chatComputerRequestRouter`,
  `computerTaskEvidenceContract`, and `computerTaskEvidenceRecovery`.
- The roadmap explicitly sets the OpenSwan north star as a typed tool loop,
  rich tool registry, procedural memory as SKILL.md, scoped declarative memory,
  post-hoc scoring, benchmarks, and HITL gates.
- The repo already has `scripts/mcp-agent-connect.js`, a zero-dependency MCP
  server that reports presence and exposes circle tools to Claude Code, Codex,
  Gemini CLI, Cursor, and any MCP-compatible agent.
- `supabase/functions/agent-connect/index.ts` already accepts Claude Code
  native hook payloads and generic agent heartbeats, maps many providers, checks
  circle membership, and upserts presence into `circle_office_agents`.
- `scripts/codex-bridge.js` exposes local Codex sessions on port 7779, uses the
  shared desktop token, launches managed Codex terminals, and scans sessions.
- `scripts/cursor-bridge.js` exposes Cursor agent transcripts and terminal logs
  on port 7781, with token auth and WSL-aware paths.
- `src/lib/terminalAgentControl.ts` can list Claude Code, Codex, Gemini CLI, and
  Cursor sessions, format status, and send follow-up messages to managed
  sessions.
- `src/lib/chatAgentTargets.ts` already models OpenSwan, Cursor, Claude Code,
  Codex, Gemini, Aider, Cline, Windsurf, Copilot, Continue, Amp, OpenCode, and
  custom agents as chat-selectable targets.
- `src/lib/customAgentBridgeDispatcher.ts` already sends selected chat tasks to
  generic task endpoints like `/task`, `/tasks`, `/message`, `/chat`, or `/run`.
- `src/lib/agentFileCoordination.ts` already implements advisory file leases and
  compare-and-swap writes so multiple agents do not clobber each other's files.

That means the next product leap is not a science project. It is mostly
integration packaging, UX hierarchy, and a more complete MCP/agent-connect
contract.

## Product Positioning

Position UC as:

**"The team operating layer for AI coding agents."**

The promise:

- Connect your repo, providers, apps, and coding agents once.
- Start work in Chat, Feed, Office, a GitHub issue, Slack/Linear, or your editor.
- Choose Codex, Claude Code, Cursor, OpenSwan, or multiple agents.
- UC gives every agent the right context, rules, skills, permissions, and
  acceptance checks.
- UC watches progress, prevents collisions, collects proof, asks for approval
  only when needed, and records what shipped.

The key distinction:

- **Editors** are where code is written.
- **Agents** are workers.
- **UC** is the project/agent control room: task source, memory, approvals,
  proof, coordination, app connections, and accountability.

## User Experience North Star

The best UX is not a dashboard full of everything agents could do. It is a
small number of highly reliable flows:

1. **Connect**
   - "Connect Codex"
   - "Connect Claude Code"
   - "Connect Cursor"
   - "Connect GitHub"
   - "Connect provider keys"
   - "Connect apps and APIs"

2. **Prepare**
   - Generate or validate `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`,
     `.codex/config.toml`, and `.agents/skills`.
   - Show what will be shared with each agent.
   - Make privacy and write permissions obvious.

3. **Launch**
   - Pick a task.
   - Pick one or more agents.
   - Pick a lane: plan, build, review, research, debug, app automation.
   - Launch in the right surface: local terminal, Cursor Composer, Claude Code,
     Codex CLI, cloud agent, OpenSwan, or generic bridge.

4. **Observe**
   - One status card per agent.
   - Current task, claimed files, last tool/action, cost, model, risk, proof.
   - No raw transcript by default; expand only when needed.

5. **Approve**
   - Unified approval inbox for file writes, app actions, secrets, external API
     writes, MCP writes, provider spend, publishing, and destructive operations.
   - User sees "what will happen", "why it is needed", "what data is shared",
     and "how to undo or stop".

6. **Verify**
   - Show checks run, app proof, browser screenshots, file diffs, PR links,
     test output summaries, deployment previews, and evidence gaps.

7. **Learn**
   - Convert repeated success into skills, rules, memory, automation, and
     reusable app adapters.
   - Write back only through HITL-gated proposals.

## Agent-Specific Opportunities

### Codex

Codex wants durable repo instructions, config, skills, MCP, and tasks with clear
done criteria.

UC should add:

- A "Connect Codex" card that detects `codex` CLI, bridge health on 7779,
  installed skills, `.codex/config.toml`, repo trust state, and whether the
  project has a current `AGENTS.md`.
- A one-click generated `.codex/config.toml` proposal that adds:
  - UC MCP server
  - default sandbox/approval guidance matching repo risk
  - optional model/profile defaults
  - skill configuration
- "Open in Codex" and "Launch Codex workers" buttons from any Feed task,
  Chat message, Office plan, PR review, or recovery card.
- A Codex context pack exporter:
  - goal
  - acceptance checks
  - relevant repo docs
  - selected memories
  - active file leases
  - current branch and dirty status
  - allowed paths
  - proof command list
- Codex run ingestion:
  - session id
  - active task
  - recent actions
  - summary
  - changed files
  - tests/checks
  - blocked reason
- Better support for Codex subagent summaries in Office, with each child thread
  shown as a collapsible worker under its parent run.

### Claude Code

Claude Code has the richest event surface for UC because it has `CLAUDE.md`,
skills, hooks, MCP, subagents, Agent SDK, GitHub Actions, and multiple
surfaces.

UC should add:

- A "Connect Claude Code" card that:
  - detects bridge 7778
  - validates token pairing
  - checks Claude Code CLI availability
  - reads active local sessions
  - checks `CLAUDE.md`
  - detects `.claude/settings.json` hooks
  - detects `.claude/skills` and user skills
- A hook installer that proposes safe snippets for:
  - `SessionStart`
  - `SessionEnd`
  - `PreToolUse`
  - `PostToolUse`
  - `SubagentStart`
  - `SubagentStop`
  - `Notification`
- A "Hook Events Live" panel in Office showing only durable signals:
  - session
  - current task
  - tool/action category
  - approval waits
  - subagent spawned/completed
  - files changed
  - blocked reason
- A bidirectional skills bridge:
  - import from `~/.claude/skills`
  - export approved UC skills to `.agents/skills` or `.claude/skills`
  - warn when a skill has hidden scripts or high-risk tools
- Claude Code Agent SDK evaluation path for custom controlled workflows:
  - use SDK when UC should own task orchestration and permission boundaries
  - keep CLI bridge for simple human-facing local sessions
- GitHub Actions integration:
  - tie `@claude` PR/issue runs back to UC tasks
  - mirror PR comments/findings to Feed/Office
  - connect action completion proof to missions/tasks

### Cursor

Cursor is strong where users already live in editor/chat and Cloud Agent. UC
should avoid fighting that editor UX and instead become the coordination layer
around Cursor.

UC should add:

- A "Connect Cursor" card that:
  - detects bridge 7781
  - checks `.cursor/rules`
  - checks `.cursor/mcp.json`
  - checks `.agents/skills` / `.cursor/skills`
  - reads current Cursor agent transcripts and terminal logs through the bridge
- A rule generator that can emit:
  - root `AGENTS.md` for simple shared instructions
  - `.cursor/rules/*.mdc` for scoped rules with `description`, `globs`, and
    `alwaysApply`
  - `.cursor/mcp.json` snippets for the UC MCP server
- Cursor Cloud Agent hooks:
  - map UC tasks to Cursor Cloud Agent work
  - ingest PR/status updates
  - show mobile/cloud status in Office
- Cursor Skills sync:
  - export high-value UC skills into `.agents/skills` so they work in Cursor,
    Codex, and Claude-compatible environments
  - mark skills as portable, Cursor-specific, Claude-specific, or Codex-specific
- Use Cursor's "rules precedence" concept in UX:
  - Team rules
  - Project rules
  - User rules
  - AGENTS.md
  - Skills
  - Current task prompt
- Add an "Open task in Cursor" command that launches or focuses the relevant
  project, starts Composer/Agent with the UC context pack, and keeps the task
  card as the source of truth.

### Other Agents

The existing `chatAgentTargets` and `customAgentBridgeDispatcher` already point
toward a universal connector model. UC should extend it to:

- GitHub Copilot coding agent/custom agents
- Cline
- Windsurf
- OpenCode
- Aider
- Amp
- Continue
- Gemini CLI
- local custom agents
- hosted app-specific agents

The generic contract should be:

- `GET /health`
- `GET /capabilities`
- `POST /task`
- `POST /message`
- `POST /status`
- `POST /cancel`
- `POST /receipt`

Every connected agent should advertise:

- provider
- version
- transport
- read/write capabilities
- shell capability
- browser/app capability
- MCP capability
- supported context files
- supported skill directories
- max parallel work
- approval policy
- safe retry semantics

## Build On Other Apps

Users do not really want "computer use" as a concept. They want:

- "Use the Figma design to build the page."
- "Update the WordPress post and prove the preview."
- "Turn this Linear issue into a PR."
- "Generate the Canva/Photoshop/InDesign asset."
- "Change the CAD drawing and export it."
- "Fix the Supabase function and deploy it."
- "Make the browser app pass this scenario."

UC should route every app task through a ladder:

1. **Native API or official SDK**
   - Best for reliability, auditability, and repeatability.
   - Example: GitHub, Linear, Slack, Google Workspace, Supabase, Netlify,
     Vercel, WordPress REST, Figma, Browserbase, CAD APIs, Adobe APIs.

2. **MCP server**
   - Best when the app already has MCP support or a local/team MCP server.
   - UC can expose the same connector to Codex, Claude Code, Cursor, and
     OpenSwan.

3. **Custom API connector**
   - Use UC marketplace custom APIs for authenticated HTTP actions with
     server-side secrets and approval-gated writes.

4. **Browser protocol / DOM / Playwright**
   - Best for web apps with no API route but stable DOM/ARIA surfaces.

5. **Local desktop bridge / accessibility tree**
   - Best for local app reads, launch/focus, and semantic actions when native
     APIs are unavailable.

6. **Screen/coordinate fallback**
   - Last resort. Must observe first, act once, verify, and stop on ambiguity.

7. **Connected-agent app-capability buildout**
   - If an app-specific adapter is missing, route to Codex/Claude/Cursor to
     build a reusable recipe/adapter with source refs, focused smoke tests, and
     a bounded retry plan.

This ladder should be visible only when useful. On success, users should see the
result and proof, not the full routing machinery.

## High-Impact UX Improvements

### 1. Agent Connect Wizard

Add a single setup flow under Office or Marketplace:

- Step 1: choose agent: Codex, Claude Code, Cursor, Gemini, Cline, Windsurf,
  Copilot, Aider, OpenCode, custom.
- Step 2: detect local install and bridge status.
- Step 3: install or show exact command.
- Step 4: generate token.
- Step 5: install MCP / hooks / rules / config snippets.
- Step 6: run a smoke task.
- Step 7: show the agent online in Office.

The user should never have to guess which port, token, settings file, or command
belongs to which agent.

### 2. Setup Health Matrix

Show one matrix per repo/circle:

| Capability | Codex | Claude Code | Cursor | OpenSwan |
|---|---|---|---|---|
| Presence | connected/offline | connected/offline | connected/offline | built-in |
| Task dispatch | ready/blocked | ready/blocked | ready/blocked | ready |
| MCP | installed/missing | installed/missing | installed/missing | server |
| Skills | synced/stale | synced/stale | synced/stale | synced |
| Rules/context | current/stale | current/stale | current/stale | current |
| File coordination | enabled/missing | enabled/missing | enabled/missing | enabled |
| Proof reporting | enabled/missing | enabled/missing | enabled/missing | enabled |
| Cost guard | set/unset | set/unset | set/unset | set |

Each blocked cell should have one action, such as "Install hook", "Copy MCP
config", "Start bridge", "Regenerate token", or "Run smoke".

### 3. Context Pack Builder

Every task should have a "Context" button that shows what UC will send to an
agent:

- user goal
- task source
- current plan
- acceptance criteria
- relevant docs
- relevant files
- connected apps
- available provider keys without secrets
- active memories
- skills
- file leases
- proof commands
- privacy boundaries

This should support:

- copy as prompt
- send to Codex
- send to Claude Code
- send to Cursor
- save as `context-pack.md`
- expose as MCP resource

### 4. Task Card As Source Of Truth

A UC task should be the durable object, not the chat message or editor thread.

Every task card should show:

- goal
- owner/human
- assigned agent(s)
- run status
- current agent step
- files claimed
- apps touched
- approvals pending
- proof required
- proof received
- cost
- links to PR/deploy/artifacts
- next recommended action

Agent transcripts remain supporting evidence, not the primary UI.

### 5. "Send To Agent" Everywhere

Add a consistent action from:

- Chat message
- Feed task
- Office run
- approval card
- failed recovery card
- PR finding
- Room file
- app capability gap
- Marketplace connector

Options:

- Send to OpenSwan
- Send to Codex
- Send to Claude Code
- Send to Cursor
- Send to multiple agents
- Ask for plan only
- Ask for review only
- Build app capability

### 6. Multi-Agent File Map

The existing file lease system should become a visible Office panel:

- file/path
- owner agent
- intent
- since
- TTL
- current hash
- status: claimed, stale, conflict, released
- action: release stale, inspect diff, message owner

This directly solves the user's repeated concern about agents working in the
same files.

### 7. Approval Inbox

Unify approvals across:

- memory writes
- skill writes
- credentials
- browser/app writes
- shell commands
- MCP tools
- external API writes
- publishing/deploys
- connected-agent launches
- budget increases

Approval card fields:

- actor
- requested action
- target app/system
- data shared
- risk
- rollback/undo
- proof after
- expires at
- approve once / approve for this run / reject

### 8. Proof Ledger

Every agent run should end with one of:

- passed
- partial
- blocked
- failed
- manual verification required
- not applicable

Proof types:

- tests/typecheck/lint
- browser screenshot
- app screenshot
- accessibility tree diff
- PR link
- deployment URL
- file hash
- API response summary
- user confirmation
- source citations
- app export path

The proof ledger is where UC becomes more valuable than the editor.

### 9. Skills Library And Evaluator

The existing SKILL.md support should become a product surface:

- list skills by scope: user, circle, repo, provider, imported
- show portability: Codex, Claude, Cursor, generic
- show risk: instruction-only, scripts, credentials, external writes
- show usage: triggered by, run count, success rate
- show stale dependencies
- propose improvements from repeated runs
- export to `.agents/skills`
- import from `.claude/skills`, `.codex/skills`, `.cursor/skills`
- run a focused eval against sample tasks

### 10. Agent-Friendly Docs For UC Itself

UC should publish machine-readable docs:

- `/llms.txt`
- `/llms-full.txt`
- `/agents.md`
- `/mcp`
- `/mcp/manifest`
- `/skills/index.json`
- `/docs/agent-connect.md`
- `/docs/generic-agent-bridge.md`
- `/docs/custom-api-connector.md`

Agents should be able to discover:

- what UC is
- how to connect
- tool schemas
- auth model
- safety rules
- example tasks
- known failure modes
- support path

### 11. App Capability Marketplace

Create a marketplace lane separate from model/provider keys:

- GitHub
- Linear
- Slack
- Google Workspace
- Supabase
- Netlify
- Vercel
- WordPress
- Browserbase
- Figma
- Adobe apps
- CAD/engineering apps
- custom API
- custom MCP
- local desktop adapter

Each connector should show:

- read capabilities
- write capabilities
- auth status
- required scopes
- approval policy
- supported proof
- last successful run
- test button
- agent tools exposed

### 12. Recovery That Explains The Next Safe Move

Current recovery logic is already strong. UX should make it clearer:

- "Retry with fresh evidence"
- "Ask user to unblock login/MFA/permissions"
- "Let Codex build missing adapter"
- "Switch to API route"
- "Stop and show details"

The default action should be the safest useful one, and automatic connected-agent
launches should remain approval-gated.

## Recommended MCP v2 Tools For UC

The current `uc_report_progress`, `uc_get_circle_info`, and `uc_post_update`
tools are a good start. The next version should expose:

### Read Tools

- `uc_get_context_pack(task_id?)`
- `uc_list_tasks(status?, assignee?)`
- `uc_get_task(task_id)`
- `uc_list_recent_activity(limit?)`
- `uc_search_memory(query, scope?)`
- `uc_list_skills(scope?)`
- `uc_get_skill(name)`
- `uc_list_connected_apps()`
- `uc_list_agent_sessions()`
- `uc_list_file_leases(repo?)`
- `uc_get_verification_requirements(task_id)`

### Write/Report Tools

- `uc_report_progress(task_id?, status, summary)`
- `uc_post_update(message, type?)`
- `uc_claim_task(task_id, intent)`
- `uc_release_task(task_id, outcome)`
- `uc_request_approval(action, risk, payload_summary)`
- `uc_report_receipt(task_id, proof_type, summary, refs)`
- `uc_report_blocker(task_id, blocker_type, summary, needed_from_user?)`
- `uc_create_skill_proposal(name, content, files?)`
- `uc_claim_file(path, intent, ttl?)`
- `uc_release_file(path)`
- `uc_publish_artifact(task_id, kind, ref, summary)`

### App-Buildout Tools

- `uc_list_app_capabilities(app?)`
- `uc_request_app_capability(app, task_family, missing_capability)`
- `uc_report_app_capability_buildout(app, source_refs, smoke_commands, retry_plan)`

Policy:

- Reads can generally auto-run.
- Writes should be approval-gated or limited to agent-owned progress metadata.
- Memory, skills, external apps, secrets, and destructive actions must remain
  HITL-gated.

## Implementation Roadmap

### Phase 1: Make Connection Obvious

Goal: any user can connect Codex, Claude Code, or Cursor in under 10 minutes.

Ship:

- Agent Connect Wizard.
- Bridge health cards for 7778/7779/7781 and OpenSwan.
- MCP config snippets for Codex, Claude Code, and Cursor.
- Claude hook snippets for `agent-connect`.
- Cursor `.cursor/mcp.json` snippet.
- Codex `.codex/config.toml` snippet.
- Smoke task: "report progress to UC".
- Office "connected agents" empty state and first-run CTA.

### Phase 2: Make Tasks Portable

Goal: a UC task can move cleanly into any connected agent.

Ship:

- Context Pack Builder.
- "Send to Agent" action from Chat/Feed/Office.
- Task assignment and dispatch receipts.
- Agent session detail page.
- `uc_get_context_pack`, `uc_claim_task`, `uc_report_receipt`,
  `uc_report_blocker`.
- Export current repo rules to:
  - AGENTS.md
  - `.cursor/rules/*.mdc`
  - `.agents/skills`
  - Claude hook/config snippets
  - Codex config snippets

### Phase 3: Make Multi-Agent Work Safe

Goal: users can run multiple agents without file conflicts or opaque state.

Ship:

- Visible file lease map.
- Agent run tree with parent/subagent grouping.
- Approval Inbox v1.
- Proof Ledger v1.
- Compare agents on same task: plan/review/debug outputs side by side.
- Stale run cleanup and cancel/recover controls.

### Phase 4: Make External Apps First-Class

Goal: agents can build on other apps through the safest available control
surface.

Ship:

- App Capability Marketplace.
- Connector cards with read/write/proof policy.
- Custom API connector setup assistant.
- MCP connector trust review.
- App capability buildout task template.
- App adapter smoke command registry.
- "API/MCP/browser/desktop/adapter" route explainer available on demand.

### Phase 5: Make UC Agent-Friendly To The Outside World

Goal: any agent or developer can discover UC without a human explaining it.

Ship:

- Public `llms.txt` and `llms-full.txt`.
- Agent Connect docs.
- Generic Agent Bridge docs.
- MCP tool docs.
- Example `mcp.json`, `.codex/config.toml`, `.claude/settings.json`,
  `.cursor/rules`, and `AGENTS.md` snippets.
- Hosted ChatGPT App / MCP App prototype that lets ChatGPT users inspect UC
  task/proof state and trigger approved runs.

## Highest Priority Backlog

1. **Agent Connect Wizard**
   - Impact: very high
   - Effort: medium
   - Why: turns existing bridge/MCP work into a user-visible product.

2. **Context Pack Builder**
   - Impact: very high
   - Effort: medium
   - Why: every connected agent needs task context, constraints, and done
     criteria.

3. **MCP v2 tools**
   - Impact: very high
   - Effort: medium/high
   - Why: MCP is the cross-agent integration point for Codex, Claude Code,
     Cursor, ChatGPT Apps, and future agents.

4. **Send To Agent**
   - Impact: high
   - Effort: medium
   - Why: makes Chat/Feed/Office actionable instead of observational.

5. **File Lease Map**
   - Impact: high
   - Effort: low/medium
   - Why: existing runtime primitive just needs product surfacing.

6. **Approval Inbox**
   - Impact: high
   - Effort: medium/high
   - Why: trust and safety become visible.

7. **Proof Ledger**
   - Impact: high
   - Effort: medium
   - Why: differentiates UC from editor chat by showing what actually shipped.

8. **Skills Library UX**
   - Impact: high
   - Effort: medium
   - Why: UC already stores and imports SKILL.md; make it discoverable and
     portable.

9. **App Capability Marketplace**
   - Impact: high
   - Effort: high
   - Why: unlocks "build on other apps" beyond coding repos.

10. **Agent-Friendly Docs**
    - Impact: medium/high
    - Effort: low/medium
    - Why: helps outside agents understand and integrate with UC.

## What Not To Build First

- Do not build a new full IDE.
- Do not create another generic chat box detached from tasks/proof.
- Do not expose every raw log line by default.
- Do not auto-launch repair agents without explicit approval.
- Do not let MCP servers bypass the existing trust and approval model.
- Do not make coordinate/screenshot app automation the default when APIs or MCP
  routes exist.
- Do not write memory or skills directly from agent output without HITL.
- Do not make provider/model choice the first screen; users care about outcomes
  first and model control second.

## Success Metrics

Activation:

- time from signup to first connected agent
- percent of users who connect at least one coding agent
- first successful "report progress" MCP smoke
- first task dispatched to connected agent

Reliability:

- task completion rate by agent/provider
- proof coverage rate
- approval timeout rate
- failed bridge health checks
- recovery option success rate
- file lease conflict rate

Trust:

- percent of writes with approval receipts
- secrets leaked to prompt/logs: target zero
- app actions with proof-after
- rejected/expired approvals by risk class

Team value:

- tasks with PR/deploy/artifact linked
- number of runs visible in Office
- repeated flows converted into automations
- run summaries converted into skills
- skills reused across agents

Cost:

- model/provider spend per task
- cost by proof type
- subagent token overhead
- budget-blocked runs

## Research Source Map

### UC Local Sources

- `docs/AGENTS_ROADMAP.md`
- `docs/UC_APP_STACK_REFERENCE.md`
- `CLAUDE.md`
- `AGENT.md`
- `scripts/mcp-agent-connect.js`
- `supabase/functions/agent-connect/index.ts`
- `scripts/codex-bridge.js`
- `scripts/cursor-bridge.js`
- `src/lib/terminalAgentControl.ts`
- `src/lib/chatAgentTargets.ts`
- `src/lib/customAgentBridgeDispatcher.ts`
- `src/lib/agentFileCoordination.ts`
- `src/lib/mcpToolBridge.ts`

### External Current Docs

- AGENTS.md open format: https://agents.md/
- Model Context Protocol intro: https://modelcontextprotocol.io/docs/getting-started/intro
- MCP specification 2025-06-18: https://modelcontextprotocol.io/specification/2025-06-18
- OpenAI Codex best practices: https://learn.chatgpt.com/guides/best-practices
- OpenAI Codex skills: https://learn.chatgpt.com/docs/build-skills
- OpenAI Apps SDK MCP server: https://developers.openai.com/apps-sdk/concepts/mcp-server
- OpenAI Apps SDK build MCP server: https://developers.openai.com/apps-sdk/build/mcp-server
- OpenAI Apps SDK UX principles: https://developers.openai.com/apps-sdk/concepts/ux-principles
- OpenAI Apps SDK UI guidelines: https://developers.openai.com/apps-sdk/concepts/ui-guidelines
- OpenAI Apps SDK security/privacy: https://developers.openai.com/apps-sdk/guides/security-privacy
- OpenAI Agents SDK guide: https://developers.openai.com/api/docs/guides/agents
- OpenAI Responses API migration guide: https://developers.openai.com/api/docs/guides/migrate-to-responses
- Claude Code overview: https://code.claude.com/docs/en/overview
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code Agent SDK: https://code.claude.com/docs/en/agent-sdk/overview
- Claude Code GitHub Actions: https://docs.anthropic.com/en/docs/claude-code/github-actions
- Cursor rules: https://cursor.com/docs/rules.md
- Cursor MCP: https://cursor.com/docs/mcp.md
- Cursor skills: https://cursor.com/docs/skills.md
- Cursor Cloud Agents: https://cursor.com/docs/cloud-agent
- Cursor subagents: https://cursor.com/docs/subagents
- Cursor CLI overview: https://cursor.com/docs/cli/overview
- Cursor ACP: https://cursor.com/docs/cli/acp

### Research Signals

- "Configuring Agentic AI Coding Tools: An Exploratory Study" (2026):
  https://arxiv.org/abs/2602.14690
- "On the Impact of AGENTS.md Files on the Efficiency of AI Coding Agents"
  (2026): https://arxiv.org/abs/2601.20404
- "From Registry to Repository: How AI Agent Skills Are Written, Adapted, and
  Maintained" (2026): https://arxiv.org/abs/2607.00911
- "Configurable AI Coding Assistants: Designing For Developers Who Like to Be in
  Control" (2026): https://arxiv.org/abs/2607.09215

## Bottom Line

UC can become the place where agents become usable by teams:

- Codex, Claude Code, Cursor, and other agents remain excellent workers in their
  own surfaces.
- UC gives them shared context, tasks, memory, skills, app access, approvals,
  proof, and coordination.
- The user experience should hide routing complexity until it matters, then
  show exactly the right permission, blocker, or proof.

The immediate product move is to turn the existing bridges, agent-connect MCP
server, task routing, skills library, approval system, and proof/recovery
contracts into a visible onboarding and operating experience.
