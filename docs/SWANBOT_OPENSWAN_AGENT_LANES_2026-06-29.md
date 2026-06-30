# SwanBot/OpenSwan Agent Lanes - 2026-06-29

## Why This Exists

The SwanBot/OpenSwan/Chat worktree has been carrying too many unrelated
changes at once. That makes review noisy, hides risk, and turns simple customer
delivery into a broad branch with app automation, WordPress, desktop bridge,
chat UX, runtime policy, wiki, SQL, and package-script changes mixed together.

This doc defines the lane model used by `scripts/openswan-lane-report.ts`.
Agents should use it before they build, delegate, stage, or hand off work.

## Traffic Rule

One customer delivery should normally touch one lane. Two lanes is acceptable
when one is `Lane 0 - Traffic Control` and the other is the actual product
lane. Anything wider should be split into follow-up branches or OpenSwan
worktrees before review.

Do not use `git add .` on this project while SwanBot/OpenSwan work is active.
Hunk-stage the selected lane and its verification/docs only.

## Current Snapshot

The June 29 cleanup pass found the tree broad, not broken:

- 252 changed or untracked paths at the start of the pass.
- 155 modified paths and 97 untracked paths.
- `git diff --check` was clean.
- The biggest review expanders were ChatTab, OpenSwan/SwanBot runtime files,
  desktop/computer automation files, WordPress automation files, package
  scripts, bridge scripts, and wiki/research content.

The fix is not to delete that work. The fix is to make it lane-addressable so
agents can finish one lane at a time without trampling the rest.

## Lanes

| Lane | Scope | Default Daily Check |
|---|---|---|
| Lane 0 - Traffic Control | AGENTS, roadmap, stack reference, standards registry, package scripts, worktree/lane tooling | `npm run smoke:openswan-lane-report` |
| Lane 1 - SwanBot v2 Readiness | SwanBot client, v1 baseline telemetry, v2 edge loop, continuation, dedupe, readiness, retry, approvals, `agent_runs` telemetry reader | `npm run check:swanbot-v2:daily` |
| Lane 2 - Chat Dispatcher | chat planner, transport handlers, command routing, recovery cards, transcript metadata | `npm run smoke:chat-planner` |
| Lane 3 - OpenSwan Typed Core | agent execution core, OpenSwan session runtime, task planner, delegation, skills, circle context, trace/eval exports | `npm run smoke:openswan-task-planner` + `npm run smoke:export-traces` |
| Lane 4 - Tool Catalog Contracts | OpenSwan tool runtime, approval policy, secret args, redaction, MCP and result formatting | `npm run smoke:agent-tool-contract-standards` |
| Lane 5 - Computer/App Evidence | desktop, browser, local-file, app adapters, evidence contract, recovery, generic app navigation | `npm run smoke:chat-computer-request-router` |
| Lane 6 - WordPress Managed Sites | WordPress REST, wp-admin source intelligence, Dealer Inspire, vault policy, command risk | `npm run smoke:wordpress-admin-source-intelligence` |
| Lane 7 - Provider/Cost Routing | provider marketplace, model routing, BYOK, OpenRouter, proxy, fallback, budget | `npm run smoke:cross-provider-router` |
| Lane 8 - Product UI/Console | Chat, Office, OpenSwan console, Computer Use console, approval and ops UI | `npm run smoke:office-bridge-readiness` |
| Lane 9 - Knowledge/Research | Wiki, second brain, research control center, memory service, planning docs | `npm run smoke:second-brain` |
| Lane 10 - Edge SQL | Supabase functions, shared edge helpers, migrations, consolidated SQL | `npm run typecheck:functions` |
| Lane 99 - Unmapped Review | files that still need a roadmap owner before buildout | `git diff --check` |

## Commands

Use the report any time the tree feels too broad:

```bash
npm run check:openswan-lanes
```

Use strict mode before a customer delivery branch:

```bash
npm run check:openswan-lanes:strict
```

Use the daily SwanBot/Chat check for normal development:

```bash
npm run check:swanbot-chat:daily
```

Use the focused SwanBot v2 readiness check when only Lane 1 changed:

```bash
npm run check:swanbot-v2:daily
```

Use the focused SwanBot v2 release gate before flipping defaults or shipping
Lane 1 runtime changes:

```bash
npm run check:swanbot-v2:release
```

After that local gate passes, use the live production report for M4/default-flip
evidence. It is intentionally manual because it needs Supabase service-role
credentials and fresh `agent_runs` rows:

```bash
npm run report:swanbot-openswan-readiness -- --smokes-passed --since <iso>
```

Use the hard production gate only when a customer/default-flip handoff should
fail unless the live report says `can_flip_default`:

```bash
npm run check:swanbot-openswan-readiness:production -- --smokes-passed --since <iso>
```

Lane 1 readiness now includes source and fixture guards for the v1
`agent_runs` baseline and the real `agent_runs` telemetry reader. A default
flip still requires fresh production evidence: both `metadata.version =
"swanbot-ai"` and `metadata.version = "swanbot-v2-ai"` cohorts must have the
minimum `surface = "main_chat"` samples, normalized `final_stop_reason`
values, populated run-summary/token columns, and v2's `end_turn` rate must meet
or beat v1.

Use the release check before bundling a larger SwanBot/OpenSwan/Chat delivery:

```bash
npm run check:swanbot-chat:release
```

`smoke:all` remains an integration sweep, not the daily default.

## Multi-Agent Workflow

When the user asks for many agents, split agents by lane, not by random file
groups:

1. Lane 0 agent: owner table, docs, scripts, lane report.
2. Lane 1 agent: SwanBot v2 and readiness.
3. Lane 2 agent: chat planner and user-facing chat behavior.
4. Lane 5 agent: desktop/browser/local-file/app evidence.
5. Lane 6 agent: WordPress and Dealer Inspire automation.
6. Lane 8 agent: office/dashboard/chat UI delivery polish.

Agents must report changed files and verification commands per lane. If a
subagent needs to touch another lane, it should stop and state the reason
instead of silently widening scope.

## Review Standard

For each lane, review in this order:

1. Confirm the owner in `docs/AGENTS_ROADMAP.md`.
2. Confirm no parallel helper path was introduced.
3. Run the lane daily smoke.
4. Run `npm run typecheck:app` when TypeScript app code changed.
5. Run `git diff --check`.
6. Stage only that lane's hunks.

The goal is not less ambition. The goal is less dirt per delivery.
