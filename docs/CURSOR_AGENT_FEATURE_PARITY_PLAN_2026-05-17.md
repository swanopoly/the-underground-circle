# Cursor-Class Agent Plan

Date: 2026-05-17

Goal: build Cursor-class agent capabilities into The Underground Circle with our own code and architecture. Cursor is primarily an AI coding environment; our app should cover the same coding-agent strengths while extending them to browser, desktop, vault, business workflows, OpenSwan, SwanBot, and Office-managed multi-agent orchestration.

## Research Sources

- Cursor product page: https://cursor.com/product
- Cursor features page: https://cursor.com/features
- Cursor Plan Mode: https://cursor.com/blog/plan-mode
- Cursor Agent tools: https://docs.cursor.com/agent/tools
- Cursor modes/custom modes: https://docs.cursor.com/agent/custom-modes
- Cursor rules: https://docs.cursor.com/context/rules
- Cursor memories: https://docs.cursor.com/context/memories
- Cursor ignore files: https://docs.cursor.com/context/ignore-files
- Cursor codebase indexing: https://docs.cursor.com/context/codebase-indexing
- Cursor MCP: https://docs.cursor.com/context/model-context-protocol
- Cursor Tab: https://docs.cursor.com/tab/overview
- Cursor CLI overview/usage/headless: https://docs.cursor.com/en/cli/overview, https://docs.cursor.com/en/cli/using, https://docs.cursor.com/en/cli/headless
- Cursor Background Agents: https://docs.cursor.com/en/background-agent
- Cursor Background Agents API: https://docs.cursor.com/background-agent/api/overview
- Cursor Bugbot: https://docs.cursor.com/bugbot
- Cursor changelog: https://cursor.com/changelog

## Feature Parity Matrix

| Cursor capability | What Cursor does | Our target |
| --- | --- | --- |
| Agent mode | Autonomous codebase exploration, multi-file edits, terminal commands, error fixing | OpenSwan Agent mode that can work across code, desktop, browser, integrations, vault, and Office-managed agents |
| Ask mode | Read-only codebase exploration | Read-only Research/Ask mode with no writes, no desktop actions, no external side effects |
| Manual mode | Precise selected-file edits only | Scoped Edit mode: selected files, selected website/app surface, or selected workspace root only |
| Custom modes | User-defined tool combinations and instructions | Office-configurable modes with allowed tools, approval policy, model policy, budget, and prompt contract |
| Plan Mode | Research codebase/docs, ask clarifying questions, produce editable plan, save plan as Markdown, build from plan | First-class Plan Mode in Chat/OpenSwan with editable plan graph, to-dos, file references, risks, approvals, and “Build from Plan” |
| Tool catalog | Search/read/list/codebase/grep/web/rules/edit/delete/terminal/MCP | Unified OpenSwan tool registry with search/read/write/browser/desktop/MCP/vault/terminal/database tools and per-tool policies |
| Codebase indexing | Embeddings per file, incremental indexing, multi-root workspaces, PR search | Workspace indexer for code and docs, Supabase pgvector search, desktop-bridge local roots, GitHub PR/commit/issue search |
| Ignore files | `.cursorignore`, `.cursorindexingignore`, global ignores | `.ucignore`, `.ucindexignore`, global sensitive-default ignores, secret scanning, enforced at index/search/read layers |
| Rules | Project rules, user rules, memories, generated rules | Circle rules, workspace rules, user rules, agent rules, generated rules with approval and scope |
| Memories | Sidecar-generated memories plus explicit memory tool calls | Existing memory system upgraded with sidecar extraction, approval, source citations, expiry, and per-circle/user/workspace scope |
| MCP | stdio/SSE/HTTP MCP, OAuth, tool toggles, image responses, approval/auto-run | Marketplace MCP hub tied to vault/API keys, tool enablement, per-tool approvals, image/media payload support |
| Terminal control | Agent can run terminal commands, approval by default, auto-run option | Managed local terminal sessions for Codex, Claude Code, Cursor CLI, shell, with chat follow-ups, logs, kill/resume, and Office dashboard control |
| CLI/headless | Interactive and `--print` automation, JSON output, resume, MCP/rules support | UC Agent CLI with JSON/headless mode, resumable runs, same tool registry, same rules, run-ledger sync |
| Background agents | Async agents in isolated remote machines, status, follow-up, takeover, branch push | UC background agents: local terminal sessions first, remote workspace workers later, branch/worktree isolation, status/follow-up/takeover |
| Environment setup | `environment.json`, install/start/terminal commands, Dockerfile support | `uc.environment.json` with install/start/watch/test commands, secrets from vault, health checks, and per-project presets |
| Checkpoints/diffs | Review changes, apply, checkpoint/rollback | Agent checkpoints for every patch set, diff review UI, one-click rollback, accepted/rejected change metadata |
| Bugbot | PR review, comments, fix links, auto/manual triggers | UC Review Agent: PR/diff/security/perf review, GitHub comments, fix-from-chat links, Office review queue |
| Tab autocomplete | Multi-line edits, cross-file jumps, auto-imports, partial accepts | Later-stage “Swan Predict”: next action/file suggestion, quick patch suggestion, workflow continuation hints |
| Browser controls/debug | Browser controls, Debug Mode, hooks in changelog | Already partly covered by browser bridge; add debugger loops, console/network capture, app screenshots, hooks, hypothesis testing |

## Current App Status

Already strong:

- `src/lib/openswanToolRuntime.ts` provides a typed OpenSwan tool registry and runtime.
- `src/lib/desktopBridge.ts` plus `scripts/claude-bridge.js` provide local desktop/browser/file tools.
- `src/lib/terminalAgentSessionLauncher.ts`, `src/lib/codexDetector.ts`, `src/lib/officeTerminal.ts`, and Office panels support terminal-agent orchestration.
- `src/lib/agentRunLedger.ts`, `src/lib/agentRunSystem.ts`, and run persistence provide traceability.
- `src/lib/memoryEmbeddings.ts`, `src/lib/agentMemory.ts`, and memory panels provide the base for Cursor-like memories.
- `src/lib/skillRegistry.ts`, `src/lib/openswanSkills.ts`, and skill playbooks provide the base for custom capabilities.
- Vault credentials and marketplace integrations already give us a wider automation surface than Cursor.

Key gaps:

- Plan Mode is not a first-class object with editable plan steps, clarifying questions, and build-from-plan flow.
- Codebase indexing is not a complete multi-root file/PR/document index with ignore enforcement and index status UI.
- File edits do not yet have a consistent checkpoint/diff/revert layer across all agent routes.
- Rules/memories exist, but they need governance, scope, approval, and generation from chat.
- Background agents need a normalized workspace/session model across Codex, Claude Code, Cursor CLI, and future UC workers.
- MCP support exists, but needs a full user-facing management layer with OAuth/key handling, tool toggles, roots, images, and elicitation.
- Bugbot-style PR review needs a dedicated pipeline and Office queue.

## Target Architecture

1. Agent Command Bus

Every agent action becomes a typed command:

```ts
type AgentCommand =
  | { kind: 'plan.create'; task: string; workspaceId?: string }
  | { kind: 'plan.update'; planId: string; patches: PlanPatch[] }
  | { kind: 'workspace.search'; workspaceId: string; query: string }
  | { kind: 'file.read'; workspaceId: string; path: string }
  | { kind: 'patch.apply'; checkpointId: string; patches: FilePatch[] }
  | { kind: 'terminal.run'; sessionId: string; command: string }
  | { kind: 'browser.act'; sessionId: string; action: BrowserAction }
  | { kind: 'desktop.act'; grantId: string; action: DesktopAction }
  | { kind: 'mcp.call'; serverId: string; tool: string; args: unknown };
```

2. Policy Gate

Each command passes through the same policy gate:

- Read-only, write, side-effect, credential, desktop, terminal, external publish.
- Approval requirement.
- Budget/cost cap.
- BYOK/provider availability.
- Workspace/root permission.
- Secret/ignore-file enforcement.

3. Run Ledger

Every command writes:

- Input summary.
- Tool arguments.
- Model/provider used.
- Cost/tokens.
- Files/apps/sites touched.
- Approval IDs.
- Result/evidence.
- Failure taxonomy.

4. Workspace Context Layer

Context comes from ranked sources:

- Active chat/thread.
- Plan file and to-dos.
- User/circle/workspace rules.
- Approved memories.
- Indexed code/docs.
- PR/issue history.
- Browser/desktop observations.
- Vault/integration metadata.

## Implementation Plan

### Phase 1: Plan Mode V1

Build:

- `agent_plans`, `agent_plan_steps`, `agent_plan_questions`, `agent_plan_artifacts`.
- Plan creation pipeline that runs read-only tools first, asks clarifying questions, then emits a structured plan.
- Editable plan UI inside Chat/OpenSwan Control Panel.
- “Build from Plan” button that converts approved steps into agent commands.
- Markdown export/import for plans.

Acceptance:

- A complex user request creates an editable plan with steps, files/tools, risks, and questions.
- The agent cannot apply changes from Plan Mode until the user approves Build.
- Plans persist after refresh and show in Office dashboard.

### Phase 2: Workspace Indexing

Build:

- `agent_workspaces`, `agent_workspace_roots`, `agent_file_index`, `agent_file_chunks`, `agent_pr_index`.
- Local bridge indexer for approved local roots.
- GitHub indexer for repos/PRs/issues/commits.
- `.ucignore` and `.ucindexignore` parser plus global secret defaults.
- Incremental indexing job and status UI.

Acceptance:

- Ask “where is X implemented?” returns files, symbols, PR history, and citations.
- Ignored/secret files are not indexed or readable by agent tools.
- Multi-root workspaces work in one chat session.

### Phase 3: Checkpoints, Diffs, and Apply

Build:

- `agent_checkpoints`, `agent_patch_sets`, `agent_file_diffs`.
- Patch application layer used by all coding/file-edit tools.
- Diff review card in Chat and Office.
- Rollback button.
- “Apply selected hunks” support.

Acceptance:

- Every file edit has a checkpoint and can be reverted.
- User can accept/reject hunks before final apply.
- Run ledger links each changed file to the agent step that produced it.

### Phase 4: Terminal and Background Agent Orchestration

Build:

- Normalize Codex, Claude Code, Cursor CLI, shell, and future UC workers under `agent_terminal_sessions`.
- Session status, logs, follow-up prompt, interrupt, stop, resume, branch/worktree.
- `uc.environment.json` for install/start/test/watch commands.
- Office dashboard management: active runs, terminals, costs, files touched, failures.

Acceptance:

- User can say “start 5 coding agents, each with this prompt set,” then manage them from Chat and Office.
- User can send follow-ups without opening Terminal.
- Agents have isolated worktrees or explicit shared-workspace locks.

### Phase 5: Rules, Memories, and Skills Governance

Build:

- `agent_rules` with scope: user, circle, workspace, path, agent, mode.
- Rule types: always, auto-attached by glob, agent-requested, manual.
- `/generate rules` from conversation.
- Sidecar memory extractor with user approval before saving.
- Skill versioning, evals, success rate, and tool-policy metadata.

Acceptance:

- Rules are visible, editable, and explainable.
- Memories require approval unless user explicitly says “remember.”
- Agents cite which rules/memories/skills influenced a run.

### Phase 6: MCP and Marketplace Tools

Build:

- MCP server registry with stdio, SSE, Streamable HTTP.
- OAuth and API-key/vault-backed auth.
- Tool toggles per circle/user/mode.
- Roots and elicitation support.
- Image/media tool responses for screenshots, diagrams, PDFs.

Acceptance:

- User can add an MCP server from Marketplace, enable selected tools, and see tool calls in run trace.
- Sensitive tools require approval and cost/egress tracking.

### Phase 7: Review Agent and Bugbot-Style Flow

Build:

- PR/diff review pipeline: correctness, security, performance, tests, migrations, accessibility.
- GitHub integration for automatic/manual review triggers.
- “Fix in UC” deep link from review finding to a prefilled Plan Mode task.
- Office review queue.

Acceptance:

- A PR update creates review findings with file/line links and fix suggestions.
- User can launch a fix agent from any finding.
- Review false positives can be marked and used in evals.

### Phase 8: Debug Mode and Browser/Desktop Evidence

Build:

- Debug mode runbook: reproduce, collect logs, form hypotheses, instrument, test, patch, verify.
- Browser console/network capture.
- Desktop/app screenshot and accessibility tree evidence.
- Failure loops that stop when blocked and ask for human verification.

Acceptance:

- “Debug this failing login flow” creates evidence, hypotheses, fix attempt, and verification result.
- The agent does not claim success without evidence.

### Phase 9: Swan Predict

Build later, after the run ledger and workspace index are stable:

- Predict likely next files/actions from recent accepted edits.
- Suggest follow-up edits, imports, tests, and affected files.
- Quick-accept UI for safe suggestions.

Acceptance:

- Suggestions are low-latency and reversible.
- Prediction never bypasses checkpoint/diff review.

## Data Model Additions

Required new tables or extensions:

- `agent_plans`
- `agent_plan_steps`
- `agent_plan_questions`
- `agent_plan_artifacts`
- `agent_workspaces`
- `agent_workspace_roots`
- `agent_file_index`
- `agent_file_chunks`
- `agent_pr_index`
- `agent_checkpoints`
- `agent_patch_sets`
- `agent_file_diffs`
- `agent_rules`
- `agent_rule_bindings`
- `agent_mcp_servers`
- `agent_mcp_tools`
- `agent_review_findings`
- `agent_environment_configs`

Reuse and extend:

- `agent_run_ledger`
- `agent_memories`
- `agent_identities`
- `office_terminal_sessions`
- `user_api_keys`
- vault credential tables

## Security and Cost Rules

- BYOK by default for user model calls; platform keys only for owner/test accounts.
- Local file access stays session-granted and read-only unless explicitly upgraded.
- Ignore files and secret patterns are enforced before indexing, reading, embedding, or sending to models.
- Terminal commands are approval-gated unless the user enables an explicit trusted mode.
- Background agents are disabled by default for paid APIs unless a budget cap is set.
- Credential use always routes through vault origin/action policy and never reveals raw secrets to the model.
- Every long-running agent has stop/kill controls.
- Every run records token/cost/provider and alerts on anomalous usage.

## Near-Term Build Order

1. Plan Mode V1 schema and planner output.
2. Chat/OpenSwan Plan Mode UI.
3. Build-from-plan command bus integration.
4. Workspace indexing with `.ucignore`.
5. Checkpoint/diff layer.
6. Office background-agent control panel upgrade.
7. Rules/memory governance.
8. MCP marketplace management.
9. PR review agent.

## First Sprint Acceptance Tests

- “Plan how to add a vault export feature” creates a persisted editable plan without code changes.
- User can edit plan steps and then click Build from Plan.
- Build from Plan creates a run ledger entry and executes only approved steps.
- Refreshing the page keeps the plan, run status, and tool trace.
- A read-only Ask mode request cannot mutate files or run terminal commands.
- A file/code task shows which rules, memories, files, and tools were used.
