# Agent Development Standards Index

**Last synced:** 2026-06-02

This is the routing page for agent-facing engineering, TypeScript, design,
web-page, app-automation, and tool-contract standards. It exists so contributing
agents can quickly choose the right guidance before editing code, UI,
browser/desktop automation, app control surfaces, tools, or evals.

Start with `AGENTS.md`, then `docs/AGENTS_ROADMAP.md`, then this index when
the task involves code quality, TypeScript, product design, web pages,
computer/app automation, tools, or evals.

## Standards Map

| Task Type | Required Standards | Usual Verification |
|---|---|---|
| General code change | `docs/CODING_AGENT_BEST_PRACTICES.md` | Focused smoke for behavior, `npm run typecheck:app`, `git diff --check` |
| TypeScript app or runtime change | `docs/CODING_AGENT_BEST_PRACTICES.md` + `docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md` | Focused smoke when behavior changes, `npm run typecheck:app`, `git diff --check` |
| Supabase function change | `docs/CODING_AGENT_BEST_PRACTICES.md` + function owner docs | `npm run typecheck:functions`, targeted function smoke when available |
| Product UI, workflow, approval, recovery, or automation card | `docs/DESIGN_AGENT_BEST_PRACTICES.md` + `docs/UC_STYLE_GUIDE.md` | Typecheck plus focused UI/runtime smoke when available |
| Web page, landing page, documentation page, dashboard, or app shell | `docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md` + `docs/DESIGN_AGENT_BEST_PRACTICES.md` + `docs/UC_STYLE_GUIDE.md` | Mobile/desktop inspection, accessibility pass, typecheck, `git diff --check` |
| Browser, desktop, local-file, or native-app automation | `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md` + `docs/CODING_AGENT_BEST_PRACTICES.md` + `docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md` + `docs/DESIGN_AGENT_BEST_PRACTICES.md` | Focused computer/app route smoke, app-family smoke when relevant, `npm run typecheck:app`, `git diff --check` |
| OpenSwan, bridge, MCP, connected-agent tool, recovery, or eval contract | `docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md` + `docs/CODING_AGENT_BEST_PRACTICES.md` + `docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md` + `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md` | Tool-specific smoke, approval/recovery negative-path smoke, `npm run typecheck:app`, `git diff --check` |
| App wiki or standards wiki content | This index + the relevant topic guide | `npm run smoke:agent-standards-wiki`, `npm run typecheck:app`, `git diff --check` |

## Canonical Docs

- `docs/CODING_AGENT_BEST_PRACTICES.md`:
  General code quality, change shape, architecture, security, error handling,
  testing, review, and handoff standard.
- `docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md`:
  TypeScript, React Native / Expo, strict typing, trust-boundary parsing,
  discriminated unions, and TypeScript verification standard.
- `docs/DESIGN_AGENT_BEST_PRACTICES.md`:
  Product design, flow design, design-system discipline, UX writing, AI
  automation UI, visual QA, and design review standard.
- `docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md`:
  Web-page structure, page-type defaults, responsive layout, accessibility,
  performance, forms, media, motion, and web review standard.
- `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md`:
  Browser, desktop, local-file, native-app, Adobe/CAD, bridge, approval,
  evidence, recovery, and connected-agent adapter buildout standard.
- `docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md`:
  OpenSwan, bridge, MCP, connected-agent tool, approval metadata, structured
  result, recovery, redaction, and eval coverage standard.
- `docs/UC_STYLE_GUIDE.md`:
  Local UC visual tokens for color, typography, radius, buttons, inputs, cards,
  dark-mode surfaces, and visual anti-patterns.

## App Wiki Coverage

The app wiki should mirror the standards so users and agents can discover them
from inside the product.

| Wiki Article Id | Canonical Doc |
|---|---|
| `agent-development-standards-index` | `docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md` |
| `coding-best-practices-for-agents` | `docs/CODING_AGENT_BEST_PRACTICES.md` |
| `typescript-agent-best-practices` | `docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md` |
| `design-best-practices-for-agents` | `docs/DESIGN_AGENT_BEST_PRACTICES.md` |
| `modern-web-page-design-for-agents` | `docs/MODERN_WEB_PAGE_DESIGN_AGENT_GUIDE.md` |
| `agentic-computer-app-automation-for-agents` | `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md` |
| `agent-tool-contracts-and-evals-for-agents` | `docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md` |

Run this smoke after changing any of those articles or docs:

```sh
npm run smoke:agent-standards-wiki
```

## Typed Registry

`src/lib/agentDevelopmentStandards.ts` is the pure TypeScript registry for these
standards. Use it when app code, prompt builders, wiki surfaces, or smoke tests
need the standards map without scraping Markdown.

`src/lib/openswanWorktreeConfig.ts` is the pure SwanBot/OpenSwan worktree
configuration guard. It audits required root docs, package scripts, ignored
runtime artifacts, local worktree deferral notes, and git-status noise before a
connected agent receives a worktree handoff.

`src/lib/agentToolContractStandards.ts` is the concrete helper for OpenSwan,
bridge, MCP, and connected-agent tool work. It builds risk tags, approval
decisions, recovery fields, eval plans, prompt blocks, and recommended
verification commands.

`src/lib/appAutomationControlSurfaces.ts` is the concrete helper for browser,
desktop, Adobe, CAD, and unfamiliar-app automation research. It builds the
official-source control-surface plan and the route decision that tells agents
whether to execute, observe, request approval, ask the user, or delegate a
connected-agent buildout. `src/lib/computerTaskEvidenceRecovery.ts` consumes
that same route decision when a run fails, so recovery options preserve the
route's missing evidence, approval, user-action, and buildout state.

It exports:

- `AGENT_DEVELOPMENT_STANDARD_DOCS`
- `AGENT_DEVELOPMENT_TASK_ROUTES`
- `resolveAgentDevelopmentTaskRoute(taskDescription)`
- `inferAgentDevelopmentTaskRoute(taskDescription, { mode })`
- `getStandardsForTaskType(taskType)`
- `summarizeRelevantAgentDevelopmentStandards(taskDescription, { mode })`
- `buildAgentDevelopmentStandardsPromptBlock(taskDescription, { changedPaths, hasUnrelatedChanges })`
- `buildRelevantAgentDevelopmentStandardsPromptBlock(taskDescription, { mode, changedPaths, hasUnrelatedChanges, worktreeConfigSnapshot })`
- `applyAgentDevelopmentStandardsToPrompt(prompt, { taskDescription, mode, label, changedPaths, hasUnrelatedChanges, worktreeConfigSnapshot })`
- `applyAgentDevelopmentStandardsToPrompts(prompts, { taskDescription, mode, label, changedPaths, hasUnrelatedChanges, worktreeConfigSnapshot })`
- `buildAgentToolContractChecklist(taskDescription, { toolName, surface })`
- `formatAgentToolContractChecklistPromptBlock(taskDescription, { toolName, surface })`
- `applyAgentToolContractChecklistToPrompt(prompt, { taskDescription, toolName, surface })`
- `reviewAgentToolContractDraft(taskDescription, draft, { toolName, surface })`
- `formatAgentToolContractReviewPromptBlock(review)`
- `buildAppAutomationControlSurfacePlan(taskDescription, options)`
- `buildAppAutomationRouteDecision(taskDescription, options)`
- `formatAppAutomationRouteDecisionPromptBlock(decision)`
- `buildAgentWorktreeQualityChecklist(options)`
- `formatAgentWorktreeQualityChecklistPromptBlock(checklist)`
- `buildAgentWorktreeQualityPromptBlock(options)`
- `buildOpenSwanWorktreeConfigSnapshot(options)`
- `formatOpenSwanWorktreeConfigPromptBlock(snapshot)`

## Worktree Integration Checklist

The same typed registry also owns the worktree-quality guardrail used in agent
handoffs. This keeps repo work from drifting into duplicate helper files when
the tree is already dirty or when multiple agents are touching related
automation surfaces.

Use `buildAgentWorktreeQualityChecklist({ taskDescription, changedPaths,
hasUnrelatedChanges })` when an agent has `git status --porcelain=v1 -uall`
output or a bounded file list. Use `buildAgentWorktreeQualityPromptBlock(...)`
for hidden handoffs to connected agents. The regular standards helpers
`buildAgentDevelopmentStandardsPromptBlock(...)`,
`buildRelevantAgentDevelopmentStandardsPromptBlock(...)`, and
`applyAgentDevelopmentStandardsToPrompt(...)` also accept `changedPaths` and
`hasUnrelatedChanges`, so callers can add file scope without learning a second
handoff path.

Use `buildOpenSwanWorktreeConfigSnapshot({ files, packageScripts,
ignoredPatterns, statusLines, currentPath })` when SwanBot/OpenSwan needs to
decide whether a repo checkout or `.openswan-worktrees/` checkout is ready for a
connected-agent handoff. Use `formatOpenSwanWorktreeConfigPromptBlock(...)` for
hidden prompt context, or pass the snapshot as `worktreeConfigSnapshot` into the
standards prompt helpers. User-facing chat should only expose these details when
the config is blocked or the user asks to see setup details.

Use `npm run check:openswan-worktree-config` as the operator-facing preflight.
It reads the live checkout, prints a short readiness report, and exits non-zero
only when required SwanBot/OpenSwan worktree configuration is blocked. Use
`npx tsx scripts/openswan-worktree-config-report.ts --prompt` when a bridge or
local agent launcher needs the hidden prompt block.

Managed Claude Code, Codex, Cursor Composer, and Gemini CLI launches call
`appendOpenSwanWorktreeConfigPrompt(...)` from `scripts/terminal-launch-utils.js`
so launched agents receive the hidden worktree config block when their
`projectDir` is this repo or an OpenSwan worktree. The helper is best-effort:
it skips non-UC repos and never blocks launch if the report command is
unavailable.

The checklist:

- uses the official Git porcelain status shape for stable path snapshots;
- starts every worktree pass with `AGENTS.md`, `docs/AGENTS_ROADMAP.md`, and
  `docs/UC_APP_STACK_REFERENCE.md`;
- maps changed paths to canonical owners such as standards/wiki, generic app
  navigation, app automation control surfaces, chat computer runtime, chat
  planning/metadata, OpenSwan runtime, product UI surfaces, second-brain/research
  surfaces, planning docs, package scripts/config, canonical docs, or
  agent/runtime SQL;
- flags dirty-tree, untracked canonical file, missing roadmap owner,
  parallel-path, verification-gap, and cross-surface risks;
- recommends the narrowest relevant smoke, then `npm run typecheck:app` and
  `git diff --check`.
- checks OpenSwan worktree config with `npm run smoke:openswan-worktree-config`
  when `src/lib/openswanWorktreeConfig.ts`, `.openswan-worktrees/`, package
  scripts, or runtime artifact ignore rules change.
- runs `npm run check:openswan-worktree-config` before risky connected-agent
  handoffs when the checkout state matters.
- appends hidden worktree config to managed terminal-agent launch prompts
  through `scripts/terminal-launch-utils.js`.

Research anchors:

- Git status porcelain is the stable machine-readable status format:
  <https://git-scm.com/docs/git-status>
- Git worktrees let agents isolate a separate checkout when the current tree is
  too crowded to edit safely:
  <https://git-scm.com/docs/git-worktree>

## Runtime Handoff Wiring

Standards should travel with delegated work, not only with the primary OpenSwan
session prompt. The shared prompt wrapper is now used by:

- OpenSwan session turns, run metadata, transcript events, and plan steps.
- managed terminal-agent sends and launches through Claude Code, Codex, Gemini
  CLI, and Cursor Composer bridge paths.
- generic custom-agent bridge dispatch for OpenCode, Aider, Cline, Windsurf,
  Continue, Amp, and user custom agents.
- connected-agent failure recovery and app-capability buildout prompts.
- computer/app automation prompts that need browser, desktop, local-file,
  Adobe/CAD, bridge, recovery, evidence, or connected-agent buildout context.
- tool/eval prompts that need OpenSwan, bridge, MCP, recovery, approval,
  redaction, structured-result, or negative-path eval context.

The wrapper is idempotent: if a prompt already contains the
`=== AGENT DEVELOPMENT STANDARDS ===` block, it must not append a duplicate.

## Conflict Rules

- If coding guidance conflicts with TypeScript guidance, use the TypeScript doc
  for TypeScript-specific details and the coding doc for broader engineering
  rules.
- If design guidance conflicts with web-page guidance, use the web-page guide
  for page structure and browser behavior; use the design guide for product
  flow, UX writing, and automation UI.
- If visual token guidance conflicts with either design guide, `docs/UC_STYLE_GUIDE.md`
  owns local visual tokens.
- If app automation guidance conflicts with general coding or UI guidance,
  `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md` owns surface routing,
  approval, evidence, recovery, and connected-agent buildout rules.
- If tool-contract guidance conflicts with general coding or app automation
  guidance, `docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md` owns tool schemas,
  result contracts, approval metadata, redaction, retryability, and eval rules.
- If any standards doc conflicts with `docs/AGENTS_ROADMAP.md`, the roadmap wins
  and the standards doc should be updated in the same change.

## Maintenance Contract

When adding or changing a canonical standards doc:

1. Update this index.
2. Link it from `AGENTS.md` if agents need to discover it directly.
3. Add or update the ownership row in `docs/AGENTS_ROADMAP.md`.
4. Add or update the app wiki article in `src/lib/wikiData.ts`.
5. Update `scripts/agent-standards-wiki-smoketest.ts`.
6. Run `npm run smoke:agent-standards-wiki`, `npm run typecheck:app`, and
   `git diff --check`.
7. If the OpenSwan worktree config helper changed, also run
   `npm run smoke:openswan-worktree-config` and
   `npm run check:openswan-worktree-config`.
8. If the tool-contract helper changed, also run
   `npm run smoke:agent-tool-contract-standards`.
