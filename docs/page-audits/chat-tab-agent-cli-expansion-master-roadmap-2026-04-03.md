# ChatTab Agent CLI Expansion Master Roadmap

Date: 2026-04-03
Primary surface: `src/screens/circles/tabs/ChatTab.tsx`
Related repo context:

- `AGENT.md`
- `docs/OFFICE_ROADMAP.md`
- `docs/IMPLEMENTATION_ROADMAP.md`
- `docs/PRIORITY_FEATURES.md`
- `docs/page-audits/chat-tab-agent-cli-deep-audit-2026-04-03.md`
- `docs/page-audits/chat-tab-agent-cli-implementation-spec-2026-04-03.md`
- `docs/page-audits/chat-tab-agent-cli-external-patterns-addendum-2026-04-03.md`

## Why This Exists

The immediate request is to make Circle Chat behave more like an agent CLI inspired by OpenCode and OpenAI Codex.

That is necessary, but not sufficient.

If the app only upgrades ChatTab in isolation, the likely result is:

- one strong agent surface
- multiple weak legacy surfaces
- duplicated orchestration logic
- unclear product story
- more tabs competing for the same user intent

The better move is to treat the ChatTab redesign as the beginning of a product-wide expansion:

- from social accountability app with many features
- into a team operating system for AI-assisted execution

That direction matches the repo’s own strategic guidance in `AGENT.md`:

- GitHub integration
- BlackSwan as the shared accountability agent
- small dev teams tracking real shipping activity

And it also aligns with the official market patterns visible in current OpenCode and OpenAI Codex materials:

- one command surface
- sessions and continuation
- specialized agents
- explicit permissions
- parallel tasking
- inspectable execution
- automation and always-on background work

It is also reinforced by Pi-style patterns:

- primitives over rigid feature bundles
- explicit context engineering
- branchable sessions
- queued steering and follow-up control
- extensibility through skills, templates, and package-like workflow layers

## Research-Backed Product Principles

### 1. The primary interaction should be a command surface

OpenCode’s official TUI docs emphasize:

- direct prompting
- `@` references
- `!` bash execution
- `/commands`
- `/sessions`
- `/share`
- `/details`

That matters because it creates one consistent mental model:

- everything starts from the composer

Current ChatTab does not do this. It still leads with prompt cards, game affordances, social tips, and non-agent quick actions.

### 2. Sessions are a first-class object

OpenCode’s official TUI and CLI docs explicitly support:

- new session
- continue previous session
- continue a specific session
- fork a session
- attach to a running backend

OpenAI’s current Codex messaging also emphasizes:

- tasks running in the background
- isolated environments
- parallel agents
- worktrees and app-level organization

That means the app should not think in terms of:

- “one circle = one chat transcript”

It should think in terms of:

- “one circle contains many sessions, and sessions contain many runs”

### 3. Specialized agents should be visible and selectable

OpenCode’s official agents docs emphasize:

- primary agents
- subagents
- switching agents during a session
- invoking them directly with `@`

This is important because it pushes the UI from:

- one generic assistant

toward:

- explicit roles and capabilities

That maps extremely well onto The Underground Circle because the app already has:

- BlackSwan
- circle office agents
- agent identities
- room agents
- bridge agents
- provider-specific agents

### 4. Permissions are not an implementation detail

OpenCode’s official permissions docs make the permission model explicit:

- `allow`
- `ask`
- `deny`

With granular rules by tool and pattern.

That is one of the most important lessons for this app.

The Underground Circle already mixes:

- social communication
- AI invocation
- check-ins
- tasks
- governance
- wallet actions
- GitHub and external integrations

Without explicit permission modeling, the app will either:

- stay shallow forever
- or become dangerously opaque once deeper agent actions are added

### 5. Sharing and export are part of the product, not an afterthought

OpenCode’s official share docs support:

- manual share
- auto-share
- disabled sharing
- unshare
- privacy recommendations
- enterprise restrictions

That creates a useful pattern for this app:

- every important session/run should be exportable
- some sessions may be shareable within a team
- some sessions should be deliberately non-shareable due to sensitive content

### 6. Expansion works when one surface becomes the system backbone

OpenAI’s current Codex messaging is clear:

- local terminal
- IDE
- app
- cloud delegation
- automations
- code review

These are not random features. They are different expressions of one core system.

That is the right lesson for The Underground Circle:

- the app should not expand by adding isolated novelty tabs
- it should expand by extending one core agent-operating model across surfaces

### 7. Primitives first, packaged workflows second

Pi’s public framing is useful because it emphasizes:

- primitives
- extensions
- skills
- prompt templates
- packages

The right interpretation for this app is:

- stabilize the shared agent primitives first
- then let teams install or enable reusable workflows on top

That is a better expansion path than shipping more disconnected tabs with custom one-off UX.

### 8. Context engineering must become a first-class subsystem

The app increasingly depends on:

- goals
- tasks
- GitHub
- room files
- member context
- approvals
- recent activity

If context assembly remains hidden inside one bot helper, the system stays opaque and brittle.

The stronger direction is:

- explicit context sources
- visible context selection
- session compaction
- reusable prompt packs
- agent and room instructions

## Strategic Reframing for The Underground Circle

## Old framing

- accountability circles
- chat
- check-ins
- fun/social mechanics
- many experiments

## New framing

- team operating system for AI-assisted execution
- BlackSwan as the shared coordination layer
- sessions as the unit of work
- runs as the unit of execution
- Feed as the planning layer
- Chat CLI as the command layer
- Office as the monitoring/orchestration layer
- Rooms as the execution workspace layer
- GitHub as the shipping/review layer

This is a much stronger product shape.

## Product Model

The app should evolve into five tightly connected layers.

### Layer 1: Command

Primary surface:

- Chat CLI

User jobs:

- start a session
- ask for a plan
- execute a task
- review output
- delegate to agents
- attach context

Primary objects:

- session
- command
- run
- approval

### Layer 2: Planning

Primary surface:

- Feed

User jobs:

- define goals
- review plans
- prioritize tasks
- assign to humans or agents
- monitor blockers

Primary objects:

- goal
- plan
- task
- assignee
- status

### Layer 3: Monitoring

Primary surface:

- Office

User jobs:

- see which agents are active
- inspect costs
- monitor statuses
- resolve issues
- compare utilization

Primary objects:

- agent
- connection
- cost
- performance
- health

### Layer 4: Workspace

Primary surface:

- Rooms

User jobs:

- gather files and messages for a project context
- keep agent work localized
- maintain room-specific artifacts and work products

Primary objects:

- room
- room files
- room messages
- room tasks
- shared artifacts

### Layer 5: Shipping

Primary surface:

- GitHub

User jobs:

- connect repo activity to circle execution
- review PRs
- assign follow-up actions
- keep the accountability loop grounded in real shipping

Primary objects:

- repo
- PR
- issue
- commit
- review

## The Core Expansion Thesis

The app should expand by making each layer more agent-native, not by adding more unrelated user-facing surfaces.

## Shared Primitive Stack

Every major surface should eventually consume the same backbone:

- session
- entry
- run
- step
- artifact
- approval
- context source
- skill or template

This is the structural lesson reinforced by Pi.

If the app stabilizes this stack, the surrounding surfaces can specialize without inventing their own execution models.

That means every meaningful new feature should answer:

- does this strengthen command?
- does this strengthen planning?
- does this strengthen monitoring?
- does this strengthen workspace execution?
- does this strengthen shipping/accountability loops?

If not, it is probably a distraction.

## ChatTab as the Backbone

The redesigned ChatTab should become the backbone because it is the one surface that can connect all other layers naturally.

Examples:

- from Chat CLI, attach a task from Feed
- from Chat CLI, target an agent from Office
- from Chat CLI, operate inside a Room
- from Chat CLI, pull GitHub context for review
- from Chat CLI, ask for a check-in digest or summary

That creates a unified user story:

- plan in Feed
- execute from Chat CLI
- monitor in Office
- work in Rooms
- ship through GitHub

## New Cross-App Expansion Tracks

These should be added to the roadmap beyond the earlier OpenCode and Codex framing.

### Track 1: Session branching and bookmarks

Future capability:

- fork from any key entry
- branch from a previous run
- bookmark important checkpoints
- compare alternatives

Why it matters:

- real planning and execution work is not linear

### Track 2: Context control center

Future capability:

- show which sources are attached to a run
- toggle context sources on or off
- compact stale history
- inspect why the model saw specific information

Why it matters:

- improves trust, debugging, and cost control

### Track 3: Skills, prompt packs, and workflow packs

Future capability:

- Circle skills library
- room-specific prompt packs
- organization operating packs
- reusable workflow packs

Why it matters:

- lets the app expand through reusable operating patterns instead of permanent UI sprawl

### Track 4: Active-run operator controls

Future capability:

- steer current run
- queue next task
- retry from checkpoint
- pause or abort run
- switch target or model mid-session

Why it matters:

- this is the difference between “chat with AI” and “operate an agent system”

### Track 5: Export and relay network

Future capability:

- export runs as HTML, Markdown, or JSON
- relay outputs into Feed
- relay outputs into Rooms
- relay outputs into GitHub
- publish summaries to Office dashboards

Why it matters:

- agent work only becomes reusable organizational memory when it can escape the transcript

## Recommended Product Rule

When deciding whether to add a new feature or page, ask:

- can this be expressed as a new skill, prompt pack, context source, artifact type, or inspector view on top of the shared backbone?

If yes:

- prefer extending the backbone

If no:

- make sure the new surface still consumes the same session and run primitives

## Detailed Expansion Roadmap

### Phase 0: Cleanup and concentration

Goal:

- stop expanding scattered UX patterns

Actions:

- freeze new novelty-first additions to ChatTab
- move obvious non-core quick actions out of the hero interaction path
- establish the official mode split:
  - `Social`
  - `CLI`

Deliverables:

- feature flag or segmented control for CLI mode
- reduced prompt-card clutter
- clear CLI empty state

Success criteria:

- ChatTab can be used as a focused command surface without social/game noise taking over the page

### Phase 1: Session-first Chat CLI

Goal:

- create a real session model

Actions:

- implement `chat_sessions`
- implement `chat_entries`
- add session list in left rail
- support new/resume/archive/rename/share

Required UX:

- create session
- resume session
- see session metadata
- session title generation

Expansion effect:

- once sessions exist, the app can stop pretending one circle has one transcript

### Phase 2: Run-first execution model

Goal:

- replace one-shot “AI reply” behavior with structured runs

Actions:

- implement `chat_runs`
- implement `chat_run_steps`
- implement `chat_run_artifacts`
- implement `chat_run_approvals`
- route `Talk`, `Plan`, `Execute`, `Review` through a dispatcher

Required UX:

- run cards in transcript
- status chips
- expandable step lists
- run details side panel

Expansion effect:

- this becomes the foundation for agent observability across the whole app

### Phase 3: Context references and command grammar

Goal:

- make the composer expressive enough to drive the system

Actions:

- `@task`
- `@room`
- `@member`
- `@agent`
- `@goal`
- `@pr`
- `@issue`
- `@doc`
- `@file`
- slash command registry

Command families:

- session commands
- planning commands
- context attachment commands
- review commands
- export/share commands

Expansion effect:

- users can drive multi-surface behavior from one interface

### Phase 4: Feed becomes the structured planning engine

Goal:

- make Feed the place where plans become actionable inputs for agents

Actions:

- connect tasks to sessions and runs
- show session/run counts on tasks
- allow “open in Chat CLI”
- let tasks declare mode, target agent, preferred model
- support plan step handoff into runs

New Feed capabilities:

- `Run with BlackSwan`
- `Open execution session`
- `Review last run`
- `Escalate to human`

Expansion effect:

- Feed stops being just a board and becomes the upstream control plane for execution

### Phase 5: Office becomes the monitoring and control plane

Goal:

- make Office the live operations view for Chat CLI activity

Actions:

- surface active sessions in Office
- surface active runs in Office
- show approvals waiting in Office
- show stuck/failed runs
- show per-agent queue depth
- show per-session cost attribution

Office overlays to add:

- `Active Sessions`
- `Approvals Waiting`
- `Run Queue`
- `Recent Failures`

Expansion effect:

- Office becomes the dashboard for the system that Chat CLI creates

### Phase 6: Rooms become execution workspaces

Goal:

- bind sessions and runs to project-specific workspaces

Actions:

- allow a Chat CLI session to attach to a Room
- make room files referenceable from the composer
- store artifacts back into Rooms
- allow room tasks to spawn CLI runs

Room-native expansions:

- `Open room in Chat CLI`
- `Attach current room context`
- `Run in this room`
- `Store artifact in room`

Expansion effect:

- Rooms stop being a parallel product island and become execution-local contexts

### Phase 7: GitHub becomes the shipping loop

Goal:

- make real repo activity the strongest accountability anchor in the app

Actions:

- attach PRs/issues to sessions
- generate review runs from GitHub events
- create tasks from PR review comments
- show “run produced review summary” or “run opened follow-up task”

High-value flows:

- PR arrives → create review run
- issue selected → create plan session
- failed review → create Feed task
- merged PR → update circle activity summary

Expansion effect:

- the app proves real engineering value instead of just conversational novelty

### Phase 8: Automations and background work

Goal:

- move from interactive tasking to always-on assistance

Actions:

- scheduled session creation
- recurring check-in summaries
- PR review automations
- goal drift alerts
- “stale task” nudges
- morning execution brief

Automation objects:

- trigger
- context
- target agent
- model
- approval policy
- delivery destination

Expansion effect:

- the app becomes proactive and sticky

## Expansion By Existing Tab

### Feed

Should expand into:

- planning and assignment
- task-to-session handoff
- run-aware task tracking
- plan quality and execution quality metrics

Should not expand into:

- heavy live monitoring
- social chat replacement
- unstructured command behavior

### Office

Should expand into:

- live agent observability
- run queue and cost monitoring
- human-in-the-loop approvals
- agent health, performance, and routing

Should not expand into:

- becoming the only execution surface
- absorbing more unrelated toys

### Rooms

Should expand into:

- project context and artifacts
- code/doc/file collaboration
- task and run locality

Should not expand into:

- replacing Chat CLI as the main control surface

### GitHub

Should expand into:

- concrete repo workflows
- reviews
- issue planning
- release execution

Should not expand into:

- being a detached integration tab with no flow back into tasks/sessions/runs

### Wallet

Should only expand if it directly supports:

- incentives
- bounties
- team accountability
- budget controls

Otherwise it should remain secondary.

### Discord / Slack / Teams

Should expand as:

- context sources
- notification sinks
- automation triggers

Not as separate destinations that fragment the main workflow.

## Information Architecture Proposal

### Option A: Keep current tabs, but redefine them

- `Feed` = plan
- `Chat` = execute
- `Office` = monitor
- `Rooms` = workspace
- `GitHub` = ship

This is the best near-term option because it matches the current app structure.

### Option B: Collapse into one top-level Ops shell later

Long-term shell:

- `Plan`
- `Execute`
- `Monitor`
- `Workspaces`
- `Ship`

That may be stronger later, but it is a bigger product migration.

## Design Language Expansion

### Chat CLI

Design mood:

- terminal/workbench
- dense
- serious
- command-first

### Feed

Design mood:

- structured planning
- task and goal clarity
- hierarchy and prioritization

### Office

Design mood:

- ambient monitoring
- live state
- visual system health

### Rooms

Design mood:

- focused project workspace
- artifacts and collaboration

The key principle:

- different surfaces can have different moods
- but they must share one interaction grammar and one data model backbone

## Data Platform Expansion

The app should converge on a unified operations graph.

Core objects:

- circle
- member
- session
- run
- run step
- approval
- artifact
- task
- goal
- plan
- agent
- room
- repo object

Core relationships:

- a session belongs to a circle
- a run belongs to a session
- a run can relate to a task
- a run can target one or more agents
- a run can attach one or more rooms/docs/repos
- an approval belongs to a run
- an artifact belongs to a run and optionally a room or task

This is the backbone that allows the app to keep expanding without devolving into tab sprawl.

## Metrics for Expansion

The app needs product metrics tied to this new model.

### Command metrics

- sessions started per active circle
- runs per session
- share/export usage
- command completion rate
- approval acceptance rate

### Execution metrics

- runs completed
- median time to first useful output
- median time to run completion
- error rate by mode
- artifact production rate

### Team metrics

- tasks with linked sessions
- runs tied to real GitHub outcomes
- plan-to-run conversion rate
- review coverage on active PRs

### Retention metrics

- weekly returning sessions per team
- teams using at least 3 surfaces in one week
- automation adoption
- number of active agents per team

## Monetization Expansion

The expansion should support a stronger revenue story.

### Free / early tier

- basic sessions
- single-agent execution
- limited history
- simple exports

### Pro / team tier

- multi-agent targeting
- full run history
- approvals
- room attachments
- GitHub workflows
- advanced analytics

### Enterprise tier

- SSO
- permission policies
- audit logs
- self-hosted sharing controls
- private automation runners
- role-based access

## Risks

### Risk 1: overbuilding the CLI before cleaning the product story

Mitigation:

- keep tying every build step back to the five-layer model

### Risk 2: keeping legacy quick-action clutter

Mitigation:

- move non-core actions out of the CLI hero path early

### Risk 3: not separating data models soon enough

Mitigation:

- add sessions and runs before adding richer agent behavior

### Risk 4: execution without approvals

Mitigation:

- design approval events in the first serious execution phase

### Risk 5: building powerful agent features without strong repo/task integration

Mitigation:

- prioritize Feed and GitHub integration soon after session/run foundations

## Concrete 90-Day Build Sequence

### Weeks 1-2

- Chat CLI shell
- session model
- command registry
- left rail
- CLI empty state

### Weeks 3-4

- run model
- step timeline
- details panel
- basic approvals

### Weeks 5-6

- Feed to Chat CLI handoff
- task-linked runs
- plan-to-run flow

### Weeks 7-8

- Office run observability
- approval queue in Office
- per-agent queue depth

### Weeks 9-10

- Room attachments
- artifacts into rooms
- room-linked sessions

### Weeks 11-12

- GitHub-linked sessions
- PR review runs
- issue-to-session creation
- team share/export

## Final Product Direction

The app should keep expanding, but the expansion needs to be disciplined.

The correct expansion path is:

- one command model
- one session model
- one run model
- multiple surfaces expressing the same system

That is how The Underground Circle can evolve from a feature-rich prototype into a coherent product with a real moat.

## Source Notes

Official external references used in this roadmap:

- OpenCode TUI docs: `https://opencode.ai/docs/tui/`
- OpenCode CLI docs: `https://opencode.ai/docs/cli/`
- OpenCode Agents docs: `https://opencode.ai/docs/agents/`
- OpenCode Permissions docs: `https://opencode.ai/docs/permissions/`
- OpenCode Share docs: `https://opencode.ai/docs/share/`
- OpenCode Commands docs: `https://opencode.ai/docs/commands/`
- OpenAI Codex product page: `https://openai.com/codex/`
- OpenAI Help Center Codex FAQ: `https://help.openai.com/en/articles/11369540-codex-in-chatgpt-faq`
