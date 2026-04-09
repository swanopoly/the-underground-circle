# Claude Managed Agents + Cowork + OpenSwan Integration Master Plan

Date: 2026-04-08
Type: Deep research, product audit, and Claude-ready implementation plan
Status: Planning document

## Why this document exists

The Underground Circle already has meaningful agent infrastructure:

- provider-aware chat dispatch in [ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx)
- bridge dispatch in [bridgeTaskDispatcher.ts](/Users/cswanson/the-underground-circle/src/lib/bridgeTaskDispatcher.ts)
- OpenSwan gateway client and polling in [openswanService.ts](/Users/cswanson/the-underground-circle/src/lib/openswanService.ts)
- multi-provider invocation in [agentInvocation.ts](/Users/cswanson/the-underground-circle/src/lib/agentInvocation.ts)
- Office live-agent surface in [OfficeTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx)
- Room task dispatch in [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
- Feed task execution scaffolding in [bridgeTaskDispatcher.ts](/Users/cswanson/the-underground-circle/src/lib/bridgeTaskDispatcher.ts) and prior Feed audit docs

The gap is not "add AI." The gap is that the app does not yet expose the full product patterns that make Claude Cowork and OpenSwan useful:

- goal-first delegation
- durable task workspaces
- explicit approvals
- session portability
- multi-step background execution
- plugins/connectors/tool bundles
- human handoff and steerability
- typed outputs and deliverables
- channel mobility across surfaces

This document maps those capabilities into Underground Circle.

## Research summary

### Claude Cowork

Based on Anthropic's current product and help documentation, Claude Cowork is best understood as a non-technical agent workspace built around:

- delegated, goal-based task execution on the user's computer
- local file access and real file outputs
- visible plan creation and multi-step execution
- the ability to break work into subtasks and parallel flows
- projects with their own files, links, instructions, and memory
- connectors across business systems
- plugins that package skills, connectors, slash commands, and sub-agents
- organization-level controls for enabling Cowork and its plugins

Important implication for Underground Circle:

Cowork is not "chat with better prompts." It is a structured delegation product for knowledge work. Underground Circle should copy that product shape in generic work surfaces, not only in coding flows.

### Claude Managed Agents

Anthropic does not currently present "managed agents" as a single branded product page in the same way it presents Cowork, but the managed-agent capability set is visible across the current Claude platform, Claude Code docs, Agent SDK materials, and agent engineering guidance.

The useful managed-agent features are:

- long-running agent sessions
- headless and SDK-driven agent execution
- session management and monitoring
- fine-grained tool permissions
- project/user/org memory hierarchies
- subagents with delegated context windows
- MCP-based external tool access
- context editing and memory tools for long tasks
- production monitoring and error handling expectations
- explicit agent patterns for routing, parallelization, evaluator loops, and autonomous tool use

Important implication for Underground Circle:

The app should not stop at "provider orchestration." It should evolve into a managed-agent platform where sessions, permissions, memory, subagents, and evaluations are treated as first-class product primitives.

### OpenSwan

Based on the official OpenSwan docs, OpenSwan is currently strongest as a self-hosted agent gateway and session runtime with:

- multi-channel messaging surfaces
- session management and session tools
- queueing, dedupe, debounce, and follow-up handling
- agent runs with tools and streaming
- cron-backed scheduled/background tasks
- nodes that expose `system.run` and `system.which`
- browser automation on nodes via built-in browser proxying
- approvals for exec and node execution
- gateway, control UI, and operational primitives

Important implication for Underground Circle:

OpenSwan is not just another provider. It is the best candidate in the current stack for a portable runtime layer across Chat, Rooms, Feed, Office, and future external channels.

## What Claude Managed Agents add beyond Cowork and OpenSwan

Cowork contributes the end-user delegation UX.

OpenSwan contributes a strong runtime/session/control-plane backbone.

Claude Managed Agents contribute the missing management layer:

1. Memory hierarchy
   - org memory
   - workspace/project memory
   - user memory
   - session-local memory

2. Delegated specialists
   - subagents with separate context windows
   - constrained tool access by specialist
   - explicit role packs

3. Managed permissions
   - per-tool allow/block
   - permission modes
   - safe defaults by environment

4. Long-horizon context management
   - context editing
   - memory extraction
   - keeping important facts while dropping stale tool traces

5. Production agent harness patterns
   - routing
   - parallelization
   - evaluator/reviewer loops
   - transparent planning

6. MCP as the standard connector model
   - a connector should not be a one-off integration if an MCP adapter can express it cleanly

## New product principles to adopt

Anthropic's agent guidance sharpens the architecture in an important way:

### 1. Start with workflows, escalate to agents only when needed

Underground Circle should not make every task a free-form autonomous run.

Use:

- workflows for predictable repeatable tasks
- agents for open-ended tasks with unknown step count

This means the app should expose both:

- workflow templates
- autonomous agent runs

### 2. Prioritize transparency

Anthropic explicitly recommends showing planning steps and making the agent-computer interface explicit.

Underground Circle should therefore show:

- plan
- current step
- delegated subagent
- tools used
- blockers
- approvals requested
- artifacts produced

### 3. Treat tools as product-critical, not implementation detail

Tool design quality is a first-order performance variable.

The app should add:

- namespaced tools
- clear boundaries between tools
- strong tool descriptions
- capability bundles
- tool-level evals

### 4. Make memory deliberate

Underground Circle should adopt a four-level memory model inspired by Claude's hierarchy:

- organization memory
- circle/room memory
- user memory
- session memory

### 5. Separate orchestration from rendering

The UI should not contain the real execution logic.

The repo should centralize:

- routing decisions
- subagent assignment
- permission policy
- memory assembly
- evaluation hooks

## What Underground Circle already has

### Existing strengths

1. The app already thinks in providers rather than a single model.
2. The app already has multiple execution surfaces: Chat, Rooms, Feed, Office.
3. There is already a bridge/runtime split:
   - local bridge execution
   - BlackSwan edge execution
   - OpenSwan session execution
4. The app already has the beginnings of:
   - agent assignment
   - task dispatch
   - Rooms workspaces
   - Office session monitoring
   - model/tool variability
   - wiki grounding

### Existing weaknesses

1. The runtime is fragmented by surface.
2. Sessions are not yet a first-class portable object across the app.
3. Background work is present in pieces, but not a shared run system.
4. Approval state is inconsistent and mostly surface-specific.
5. Outputs are still too text-heavy instead of artifact-first.
6. Connectors/plugins/tool bundles are not surfaced as a clean product layer.
7. Cowork-style "project memory + instructions + files + links" is split across Rooms, Feed tasks, and chat context instead of unified.

## Capability matrix

### Claude Cowork patterns Underground Circle should adopt

1. Goal-first task creation
   - User gives a goal, not just a prompt.
   - The system turns that into a plan, subtasks, and outputs.

2. Project workspaces
   - Dedicated workspace with files, instructions, links, memory, and task history.
   - Rooms are the closest current fit.

3. Plugins as packaged workflows
   - Plugins should bundle:
     - tools
     - connectors
     - slash commands
     - prompt packs
     - sub-agents

4. Visible planning
   - Show plan, current step, blocked step, approval-needed step, and completed artifacts.

5. Deliverable-first output
   - The result should be:
     - document
     - report
     - spreadsheet/table
     - image
     - webpage
     - code patch
     - message draft
     - research brief
   - not just a long answer bubble

6. Steer while running
   - Users should be able to:
     - pause
     - resume
     - redirect
     - add constraints
     - queue a follow-up

7. Knowledge-work support, not coding-only
   - marketing
   - operations
   - research
   - support
   - content
   - recruiting
   - finance ops
   - community management

### OpenSwan patterns Underground Circle should adopt

1. Session portability
   - One session should be referenceable from Chat, Rooms, Office, and Feed.

2. Queueing and active-run control
   - If a run is active, follow-ups should queue rather than collide.

3. Scheduled work and recurring automation
   - Use the cron model for:
     - recurring research digests
     - follow-up reminders
     - Room maintenance jobs
     - community summaries
     - support triage loops

4. Node-backed execution
   - Treat node/browser hosts as execution targets with approvals, not as hidden implementation detail.

5. Approval-led exec model
   - Read-only, safe-write, privileged-write, browser, external-send, and system-run should each have distinct approval policies.

6. Channel mobility
   - Sessions and outputs should be optionally relayable to:
     - in-app chat
     - Rooms chat
     - Office chat
     - external channels later

7. Operations visibility
   - status
   - queue depth
   - cost
   - token usage
   - run state
   - errors
   - retries
   - node target

### Claude Managed Agent patterns Underground Circle should adopt

1. Memory hierarchy
   - project memory maps directly to Rooms
   - org memory maps to circle-level standards/policies
   - user memory maps to agent preferences and personal defaults
   - session memory maps to active runs

2. Subagents as first-class product objects
   - planner
   - researcher
   - writer
   - coder
   - reviewer
   - designer
   - support operator

3. Permission modes
   - read-only
   - workspace-safe
   - privileged
   - browser
   - external-send

4. MCP-first connector strategy
   - new connectors should prefer MCP-compatible shape

5. Context editing and memory extraction
   - summarize stale steps
   - preserve durable facts
   - preserve decisions and open questions
   - trim noisy tool traces

6. Headless/background execution
   - scheduled jobs
   - queued long runs
   - retryable autonomous runs

7. Agent eval loops
   - run evaluation on outputs before publishing or marking done

## Recommended target product model

Underground Circle should not clone Cowork, managed-agent docs, or OpenSwan literally.

It should combine them into a four-layer architecture:

### Layer 1: Surface

User-facing product surfaces:

- Main Chat
- Rooms
- Feed tasks
- Office
- future external relay channels

### Layer 2: Workspace

Shared work object model:

- workspace
- session
- run
- step
- approval
- artifact
- connector binding
- tool bundle
- memory bundle

### Layer 3: Orchestration

Managed-agent layer:

- planner
- router
- subagent registry
- memory assembler
- permission engine
- evaluator hooks
- context editor

### Layer 4: Runtime

Execution backends:

- BlackSwan
- Hugging Face tools
- Claude Code bridge
- Codex bridge
- Gemini bridge
- OpenSwan gateway
- browser / computer-use layer
- future MCP servers and external connectors

## Exact mapping by app surface

### 1. Main Chat

Main Chat should become the generic "delegate work" surface.

It should gain:

- Cowork-style goal composer
- run plan preview
- plugin/tool-bundle picker
- project/workspace selector
- session status bar
- queue current vs queue next
- artifact rail
- wiki/source rail
- scheduled follow-up option
- explicit "run on my machine" versus "run in managed runtime" labeling
- subagent delegation visibility
- memory source visibility
- eval status visibility

It should not become a full admin panel.

Keep in Main Chat:

- fast delegation
- multimodal input/output
- model selection
- plugin quick starts
- run status
- steer / pause / resume

Do not keep here by default:

- raw secrets editing
- node fleet management
- cron job administration UI
- deep connector configuration

### 2. Rooms

Rooms should become the Cowork-style project layer.

Each Room should own:

- instructions
- links
- files
- tasks
- active sessions
- runs
- artifacts
- plugin/tool bundles
- connected services
- recurring jobs

Room-level additions:

- default agent behavior pack
- Room memory pack
- Room-specific approval defaults
- Room run inbox
- deliverables gallery
- recurring automations tab
- external relay destinations
- subagent roster
- memory editor
- project rules / policies
- context snapshots

Rooms are where Cowork Projects map best.

### 3. Feed

Feed should become the execution ledger and outcomes layer.

Feed should show:

- tasks requested
- runs started
- approvals requested
- deliverables completed
- scheduled automations fired
- artifacts published
- human review checkpoints
- success/failure summaries
- evaluator outcomes
- subagent participation summaries

Feed should not own low-level execution controls. It should show what happened and let users drill in.

### 4. Office

Office should become the runtime operations console.

It should own:

- live session inventory
- agent/node availability
- queue and throughput status
- cost monitoring
- bridge health
- cron health
- execution diagnostics
- privileged approvals
- recovery tools
- managed permission policy overview
- memory health / context compression visibility
- evaluator failure queue

Office should be where OpenSwan’s control-plane concepts land most directly.

## Functionalities to add

### A. Cowork-style project functionality

Add:

- project memory bundles
- per-project instructions
- per-project links and context packs
- default deliverable templates
- plugin packs by use case
- knowledge-worker quick actions
- visible plan builder before run start

Best place:

- Rooms first
- Main Chat second

### B. OpenSwan-style session runtime

Add:

- shared session registry across surfaces
- session attachment to task, room, and chat thread
- queue state
- pause/resume/cancel
- background run records
- cron-backed scheduled runs
- node/browser execution target metadata

Best place:

- runtime layer first
- Office and Rooms surface next

### C. Plugin system

Underground Circle should introduce an app-native plugin concept.

A plugin should contain:

- tool capability bundle
- connector requirements
- slash commands
- workflow prompts
- output templates
- optional sub-agent roster
- approval policy defaults

Suggested initial plugin categories:

- Research Analyst
- Community Manager
- Content Studio
- Growth Operator
- Support Triage
- Design Sprint
- Build a Landing Page
- Recruiting Assistant
- Executive Briefing

### D. Sub-agents and delegation

Add:

- planner agent
- researcher agent
- writer agent
- analyst agent
- designer agent
- builder agent
- QA/reviewer agent

Important rule:

Users should see the delegation tree. Hidden sub-agent sprawl will make the product feel unreliable.

### E. Managed memory system

Add:

- circle memory
- room/project memory
- user memory
- session memory
- memory editing UI
- memory extraction from completed runs
- memory expiry / archival rules

The key behavior should mirror the best managed-agent systems:

- durable instructions live above the run
- transient findings stay in the run unless promoted
- the system can extract reusable facts from finished work

### F. Context editing / transcript compaction

Add:

- stale step summarization
- tool-result compaction
- decision extraction
- open-questions extraction
- artifact-linked context instead of raw transcript stuffing

This is critical for long-running runs and multi-surface portability.

### G. Evaluation and reviewer loops

Add:

- output evaluator before publish
- acceptance-check evaluator for Feed tasks
- security/permission evaluator for risky actions
- deliverable-quality evaluator for webpages, docs, and designs

Managed agents without eval loops become noisy and brittle.

### H. Background work

Add:

- scheduled reports
- recurring room summaries
- inbox triage
- community digest generation
- design review reminder cycles
- competitive research refresh jobs

Best implementation path:

- use OpenSwan-style cron semantics as the product model even when execution backend differs

### I. Deliverable/artifact system

Add first-class artifact types:

- text note
- markdown report
- research brief
- table/grid
- webpage
- code patch
- image
- audio
- transcript
- link bundle
- support draft
- social post draft
- spec doc
- task checklist

Artifacts need:

- preview
- versioning
- publish/share
- attach-to-room
- attach-to-feed-run
- attach-to-chat-message

## What should connect and what should not

### Connect

1. Chat to Rooms
   - Chat-created runs should optionally bind to a Room workspace.

2. Chat to Feed
   - completed runs and approvals should produce Feed records.

3. Rooms to Office
   - Room runs should inherit runtime diagnostics and live status.

4. Feed to Rooms
   - Feed tasks should be able to open in the originating Room workspace.

5. Office to OpenSwan runtime
   - Office should stay the deepest operational surface.

### Do not connect directly by default

1. Main Chat to privileged system execution with no approval
2. Any general chat to global secrets editing
3. Feed directly to raw bridge shell execution
4. Room guests to privileged node/browser actions
5. External relay channels to unrestricted file mutation

## Data model additions

Add or normalize these primitives:

- `workspaces`
- `workspace_context_items`
- `agent_sessions`
- `agent_runs`
- `agent_run_steps`
- `agent_run_artifacts`
- `agent_run_approvals`
- `agent_run_queue`
- `workspace_plugins`
- `workspace_connectors`
- `workspace_schedules`
- `agent_delegations`
- `agent_deliverables`
- `memory_entries`
- `memory_promotions`
- `subagent_profiles`
- `subagent_invocations`
- `run_evaluations`
- `run_context_snapshots`
- `permission_policies`
- `tool_descriptors`
- `tool_bundle_entries`

Important modeling rule:

Do not keep separate incompatible run tables for Chat, Rooms, Feed, and Office. Surface-specific views should sit on top of shared primitives.

## Suggested implementation phases

### Phase 1: Shared runtime primitives

Build first:

- shared session registry
- shared run table
- shared artifact table
- shared approval table
- shared queue semantics
- shared provider/runtime descriptors
- shared memory primitives
- shared permission policy primitives
- shared evaluation primitives

Without this, every feature will be reimplemented per surface.

### Phase 2: Managed-agent orchestration layer

Build:

- planner/router abstraction
- subagent registry
- memory assembler
- context editor
- evaluation hooks
- tool registry with clear namespacing

### Phase 3: Rooms as project workspaces

Build:

- Room overview redesign
- project memory
- instructions
- links
- active runs
- deliverables
- recurring automations
- Room memory editor
- Room subagent roster
- Room rules/policies

This is the closest analogue to Cowork Projects.

### Phase 4: Main Chat as delegation surface

Build:

- goal-first composer
- plugin picker
- artifact rail
- run plan preview
- session status
- queue/steer controls
- memory source chips
- subagent trail
- evaluator status

### Phase 5: Office as control plane

Build:

- runtime inventory
- node/browser visibility
- approval dashboard
- cron dashboard
- provider health
- queue health
- permission policy dashboard
- evaluator failure dashboard
- context/memory diagnostics

### Phase 6: Feed as execution ledger

Build:

- run summaries
- automation history
- deliverable highlights
- review states
- publish/share actions
- evaluator outcomes
- memory promotion events

## Best first features to ship from each product

### From Claude Cowork

Ship first:

1. Room Projects with files, links, instructions, and memory
2. Goal-first run creation in Chat
3. Plugin packs
4. Steer / pause / resume / queue next
5. Deliverable-first output cards

### From OpenSwan

Ship first:

1. Shared session portability
2. Queueing and active-run semantics
3. Recurring scheduled jobs
4. Node/browser target visibility
5. Approval policy tiers

### From Claude Managed Agents

Ship first:

1. memory hierarchy
2. subagent registry
3. permission modes
4. context editing
5. evaluator loops
6. MCP-first connector model

## Code-level recommendations for this repo

### Keep and expand

- [openswanService.ts](/Users/cswanson/the-underground-circle/src/lib/openswanService.ts)
  - good base for session, status, cron, and sub-agent integration
- [agentInvocation.ts](/Users/cswanson/the-underground-circle/src/lib/agentInvocation.ts)
  - good base for backend-agnostic invocation
- [bridgeTaskDispatcher.ts](/Users/cswanson/the-underground-circle/src/lib/bridgeTaskDispatcher.ts)
  - good starting point for runtime routing
- [wikiData.ts](/Users/cswanson/the-underground-circle/src/lib/wikiData.ts)
  - useful seed for memory/context packaging, though it should not become the entire memory system
- [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
  - best current place to become project workspaces
- [OfficeTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx)
  - best current place for operations/control plane

### Refactor next

1. Replace surface-specific run state with shared primitives.
2. Stop encoding runtime behavior mainly in prompt text.
3. Move capability routing into explicit tool/plugin/runtime descriptors.
4. Separate:
   - runtime
   - orchestration
   - workspace
   - surface rendering
5. Add dedicated memory, permissions, and evaluation modules rather than mixing them into UI screens.

## Risks if implemented poorly

1. Recreating Cowork only as a prettier chat
2. Recreating OpenSwan only as another provider selector
3. Letting every surface execute privileged actions independently
4. Fragmenting artifacts and sessions by tab
5. Hiding delegation/planning from users
6. Shipping too many tools before shared approvals and artifact models exist
7. Treating memory as giant prompt stuffing instead of a managed system
8. Using subagents invisibly with no user-facing accountability
9. Skipping evals for autonomous publishing or execution

## Recommended first PR sequence for Claude

### PR1

- add shared `agent_sessions`, `agent_runs`, `agent_run_steps`, `agent_run_artifacts`, `agent_run_approvals`
- add `memory_entries`, `subagent_profiles`, `run_evaluations`, `permission_policies`
- add provider/runtime descriptor registry
- add orchestration registry for planner, router, evaluator, and subagent roles
- adapt Chat, Rooms, and Feed to read shared run primitives

### PR2

- redesign Room as project workspace with Overview, Runs, Deliverables, Automations
- attach context packs, files, links, and instructions to Rooms
- add Room memory editor and Room rules/policies

### PR3

- upgrade Main Chat to goal-first delegation with plan preview and plugin picker
- attach chat runs to Rooms optionally
- surface subagent delegation, memory sources, and evaluator status in chat

### PR4

- Office runtime dashboard for sessions, queue, approvals, cron, and node/browser targets
- add permission, memory, and evaluator diagnostics

### PR5

- plugin packaging system
- recurring job templates
- publish/share/export layer for deliverables
- MCP connector registry and managed tool bundles

## Final recommendation

Underground Circle should position itself as:

an agent workspace operating system that combines:

- Claude Managed Agents’ memory, subagents, permissions, and eval discipline
- Cowork’s knowledge-work delegation UX
- OpenSwan’s session/runtime/automation backbone
- Rooms as project memory and deliverable spaces
- Feed as execution history and proof of work
- Office as live control plane
- Main Chat as the fast delegation front door

That direction is stronger than trying to turn every screen into a standalone mini-agent app.

## Sources

- Anthropic product page, Claude Cowork: https://www.anthropic.com/product/claude-cowork
- Anthropic Help Center, Cowork on Team and Enterprise plans: https://support.claude.com/en/articles/13455879-use-cowork-on-team-and-enterprise-plans
- Anthropic Help Center, connectors: https://support.claude.com/en/articles/11176164-pre-built-integration
- Anthropic Help Center, Cowork getting started: https://support.claude.com/es/articles/13345190-comenzando-con-cowork
- Anthropic Help Center, Cowork plugins: https://support.claude.com/id/articles/13837440-gunakan-plugin-di-cowork
- Anthropic, Claude agents overview: https://www.anthropic.com/solutions/agents
- Anthropic engineering, building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic engineering, building agents with the Claude Agent SDK: https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
- Anthropic docs, Claude Code SDK overview: https://docs.anthropic.com/en/docs/claude-code/sdk
- Anthropic docs, Claude memory: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic docs, Claude subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic docs, MCP: https://docs.anthropic.com/en/docs/mcp
- Anthropic docs, Claude Code MCP: https://docs.anthropic.com/en/docs/claude-code/mcp
- Anthropic engineering, writing tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic engineering, demystifying evals for AI agents: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- OpenSwan docs overview: https://docs.openswan.ai/
- OpenSwan docs, messages: https://docs.openswan.ai/concepts/messages
- OpenSwan docs, node host: https://docs.openswan.ai/cli/node
- OpenSwan docs, scheduled tasks: https://docs.openswan.ai/automation/cron-jobs
