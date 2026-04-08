# ChatTab Agent CLI External Patterns Addendum

Date: 2026-04-03
Primary surface: `src/screens/circles/tabs/ChatTab.tsx`
Research focus:

- `badlogic/pi-mono/packages/coding-agent`
- `shittycodingagent.ai`

Related docs:

- `docs/page-audits/chat-tab-agent-cli-deep-audit-2026-04-03.md`
- `docs/page-audits/chat-tab-agent-cli-implementation-spec-2026-04-03.md`
- `docs/page-audits/chat-tab-agent-cli-expansion-master-roadmap-2026-04-03.md`
- `docs/page-audits/chat-tab-agent-cli-first-pr-dossier-2026-04-03.md`

## Why This Addendum Exists

The earlier ChatTab docs were primarily anchored on OpenCode and OpenAI Codex.

This addendum pulls useful patterns from Pi and its public marketing/docs layer because Pi contributes a different lesson:

- build primitives, not a giant fixed product

That is highly relevant to The Underground Circle because the app already has many partially-overlapping surfaces:

- Chat
- Feed
- Office
- Rooms
- GitHub
- Integrations

The main product risk is not just “ChatTab is weak.”

The main product risk is:

- too many surfaces with too many one-off flows and not enough shared agent primitives

Pi is useful here because it treats the agent surface as:

- composable
- extensible
- session-first
- context-aware
- provider-flexible

## Source Notes

Primary sources used:

- Pi coding-agent README on GitHub: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent
- Pi site: https://shittycodingagent.ai/

Key source observations:

- Pi describes itself as a “minimal terminal coding harness” that users adapt to their workflow, with extensions, skills, prompt templates, themes, and packages.
- Pi documents a structured interactive layout: startup header, messages, editor, footer.
- Pi supports `@` references, `!command` execution, `/` commands, session resume/new/fork/tree/compact/export/share, and queued steering vs follow-up messages.
- Pi explicitly frames context engineering as a product capability via `AGENTS.md`, `SYSTEM.md`, compaction, skills, prompt templates, and dynamic context injection.
- Pi explicitly argues for “primitives, not features,” exposing sub-agents, plan mode, permission gates, sandboxing, custom editors, status bars, overlays, and MCP integration as extensible building blocks.

## High-Value Patterns To Borrow

## 1. Build The Circle agent surface from primitives, not hardcoded feature branches

This is the biggest useful lesson.

Pi’s public positioning is not:

- “here is one blessed workflow”

It is:

- “here are the primitives to shape your own workflow”

That maps directly onto this app’s problem.

Current Circle Chat still behaves like:

- one giant component
- one giant state bag
- one giant imperative send flow
- many hardcoded prompt affordances

The better shape for this app is:

- command system
- session system
- run system
- approval system
- artifact system
- context system
- extension/template system

If those primitives are clean, the rest of the app can reuse them:

- Feed can generate plans as session artifacts
- Office can monitor runs
- Rooms can contribute context
- GitHub can consume outputs and publish results

## 2. The composer should be a command editor, not a chat textbox

Pi’s editor does much more than hold plain text. Public docs show:

- `@` references
- path completion
- multi-line behavior
- image paste/drag
- `!command`
- `/commands`

The Underground Circle should not copy the terminal literally, but it should adopt the product logic.

Recommended additions for Circle Chat:

- `@member`, `@room`, `@task`, `@goal`, `@repo`, `@agent`
- `/new`, `/resume`, `/name`, `/compact`, `/share`, `/export`
- `!plan`, `!search`, `!review`, `!summarize`, `!draft`
- attachment dropzone for screenshots, docs, and room files

Recommended composer states:

- default text entry
- slash command suggestion mode
- entity reference suggestion mode
- execution intent mode
- attachment mode

Recommended non-copy decision:

- do not expose arbitrary shell execution in main Circle Chat the way a true terminal agent does

For this app, `!` should mean:

- explicit agent action intent

not:

- unrestricted local shell access

## 3. Add real queued message semantics while a run is active

Pi’s docs distinguish:

- a steering message sent after the current tool step
- a follow-up message delivered after all current work finishes

That is a strong pattern for Circle Chat because it solves a real UX weakness:

- users should not be blocked from interacting while an agent run is active

Recommended Circle version:

- `Send now` while idle
- `Steer run` while active
- `Queue next` while active

Suggested product behavior:

- steering message updates the active run plan or constraints
- queue-next creates a pending next entry for the same session
- queued items are visible in the transcript as pending chips

This is better than:

- disabling the composer
- or pretending the agent is synchronous chat

## 4. Treat sessions as branchable work graphs, not flat transcripts

Pi emphasizes:

- session resume
- session tree
- branching
- forking
- bookmarks
- compaction while preserving full history

This is extremely useful for the Circle app.

Current opportunity:

- a team often wants to continue from an earlier planning point without overwriting the current thread

Recommended future additions after PR1:

- branch session from any prior entry
- bookmark key entries
- label branches
- compare branch outputs
- fork session into a Room or task

Recommended data implication:

- extend `chat_entries` later with parent linkage and branch metadata

PR1 does not need the whole tree UI, but the schema should avoid making it impossible later.

## 5. Put context engineering into the product, not only the prompt

Pi’s strongest conceptual contribution is its explicit framing of context engineering.

Its public docs point to:

- `AGENTS.md`
- `SYSTEM.md`
- compaction
- skills
- prompt templates
- dynamic context injection

This maps cleanly to Circle.

Recommended Circle equivalents:

- Circle instructions
  - circle-level operating rules, tone, goals, team norms
- Room instructions
  - room-specific scope, repo, deliverables, standards
- Agent profiles
  - persona, specialty, permissions, default model, preferred tools
- Session compaction
  - summarize old entries and runs while preserving detailed inspectability
- Prompt packs
  - reusable prompts for planning, review, release prep, sprint recap
- Dynamic context injectors
  - open tasks, current goals, latest GitHub PRs, room files, pending approvals

This should become a first-class app subsystem:

- not just hidden prompt plumbing in `src/lib/swanbot.ts`

## 6. Make extensibility a product surface

Pi repeatedly returns to:

- extensions
- skills
- themes
- packages

The Underground Circle should not copy the packaging mechanics directly, but it should learn the product direction.

Recommended app-level expansion:

- agent skills library
- team prompt library
- organization template packs
- workflow packs
- vertical-specific operating packs

Concrete examples:

- “Startup weekly review”
- “Agency client delivery”
- “Open-source maintainer cockpit”
- “Founder shipping rhythm”
- “Trading desk morning routine”

This is one of the clearest paths to keep expanding the app without constantly rewriting the core UX.

The backbone stays the same:

- session
- run
- approval
- artifact
- context

What changes is:

- installed skills/templates/packs

## 7. Add a richer status/footer model

Pi’s public layout includes a footer with:

- working directory
- session name
- total token/cache usage
- cost
- context usage
- current model

Circle should adapt this to its own environment.

Recommended ChatTab footer/status bar:

- session name
- mode
- target agent
- model
- run status
- token/cost estimate
- attached context count
- pending approvals count

Recommended Office sync:

- Office should aggregate those same run metrics at the circle level

This gives the product a shared observability language across Chat and Office.

## 8. Add explicit model switching and favorite model cycles

Pi emphasizes:

- switch model mid-session
- cycle through favorite/scoped models
- custom provider/model support

The Circle app already has model/provider work in the repo, but the user-facing chat layer is still too implicit.

Recommended additions:

- model picker in the composer/header
- per-session default model
- per-agent recommended model
- favorite model shortlist
- provider policy per org/circle

Recommended guardrail:

- model selection should be constrained by role and permission, not fully free in every team context

## 9. Support export and share as native artifacts

Pi ships:

- export
- shareable session output

That maps directly into Circle’s collaborative product story.

Recommended Circle additions:

- export session as HTML/Markdown/JSON
- share run summary to Feed
- publish run artifact to Room
- post review summary to GitHub tab
- internal share link for a session or a single run

This is important because agent work only becomes organizational memory if it can be surfaced outside the chat pane.

## 10. Separate transport/integration mode from UI mode

Pi exposes:

- interactive
- print/JSON
- RPC
- SDK

That matters architecturally even if Circle never becomes a literal terminal tool.

Recommended implication for this app:

- Chat should not own execution directly in component code

Instead:

- UI shell
- session/run store
- execution adapters
- event transport

This would make it much easier later to support:

- in-app chat UI
- Office-run monitors
- automation-triggered runs
- API-triggered runs
- future external clients

## Expansion Ideas To Add To The App

These are the highest-value additions inspired by Pi that fit the existing Circle direction.

### A. Session tree and bookmarks

Add:

- branch from message
- branch from run
- bookmark entry
- bookmark run
- branch labels

Why it matters:

- planning and review work rarely stays linear

### B. Circle skills and prompt packs

Add:

- installable team skills
- reusable slash prompts
- room-level prompt packs
- org-level operating packs

Why it matters:

- lets the product expand through reusable workflows instead of new tabs

### C. Context control center

Add:

- visible context sources before run execution
- toggles for tasks, goals, GitHub, room files, members, recent activity
- compact/summarize session action

Why it matters:

- makes agent behavior more legible and trustworthy

### D. Active-run queue controls

Add:

- steer current run
- queue next instruction
- abort run
- retry from previous checkpoint

Why it matters:

- gives the app real operator-console behavior

### E. Artifact export and relay

Add:

- export to HTML/Markdown/JSON
- relay to Feed
- relay to Office
- relay to GitHub
- relay to Rooms

Why it matters:

- turns chat outputs into reusable team assets

### F. Package-like app marketplace later

Add later:

- team templates
- prompt packs
- agent packs
- integration packs
- themed workspaces

Why it matters:

- this is the scalable expansion path once the primitives stabilize

## What Not To Copy Blindly

Pi is valuable, but its native environment is still a terminal-oriented coding harness.

The Underground Circle should not blindly copy:

- raw terminal behavior
- arbitrary shell semantics in the main social app
- terminal-only discoverability patterns
- maximal configurability before baseline UX is coherent

Better interpretation:

- borrow the architecture and interaction concepts
- adapt the UI to a collaborative app shell

## Recommended Changes To Existing Chat Docs

This research strengthens the earlier recommendations in four ways.

### Strengthen PR1

Add these PR1 or PR1.5 requirements:

- session status/footer bar
- model picker from the start
- queued follow-up UI placeholder
- visible command suggestion system

### Strengthen PR2

Add these PR2 items:

- branch/fork/bookmark support
- compaction command
- export/share command
- context source toggles

### Strengthen long-range roadmap

Add these roadmap ideas:

- Circle skills library
- org/team prompt packs
- extension-style context injectors
- package-like distribution layer for workflows

### Strengthen architecture

Prefer this architecture split:

- chat UI shell
- session/run persistence layer
- context assembly layer
- execution adapter layer
- artifact/share layer

## Final Recommendation

The most important idea to take from Pi is not a specific command.

It is this:

- the app should expand by stabilizing agent primitives and then layering reusable skills, context, and workflows on top

That is a much stronger expansion strategy than continuing to add separate one-off tabs and prompt grids.

For The Underground Circle, that means the right long-term direction is:

- one session/run backbone
- many specialized views and packs on top of it

not:

- many separate mini-products that each reinvent chat, context, and agent execution
