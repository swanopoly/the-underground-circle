# AI Agent Use Cases And OpenSwan Deep Audit

Date: 2026-04-07

## Goal

Research the top real-world uses of AI agents today, compare them to the current Underground Circle product, audit how OpenSwan-like agent platforms are actually used, and give Claude Code a concrete plan for making those capabilities real and consistent across the app.

## Executive conclusion

The app already has the beginnings of an agent platform, not just an agent feature.

It already contains:

- main chat
- room-scoped chat and file workspaces
- Feed task assignment and task runs
- Office agent connectivity and monitoring
- OpenSwan connectivity
- Hugging Face tool hooks
- approvals, artifacts, and runtime concepts in progress

The problem is not absence. The problem is fragmentation.

Right now the product has agent capabilities in at least four separate modes:

- conversational assistant mode
- room workspace mode
- task execution mode
- office / agent-control mode

Those modes do not yet share one capability model, one approval model, one artifact model, or one consistent mental model.

If you want the app to reflect what top AI agents are actually used for in 2026, the right move is:

1. standardize the agent runtime across Chat, Rooms, Feed, and Office
2. expose the right capability bundles per surface
3. add the missing high-value agent workflows
4. make every result visible as steps, artifacts, approvals, and follow-up actions

## Current real-world top AI agent use cases

Based on current official product docs and platform materials, the highest-signal agent use cases today are:

### 1. Software engineering

This is currently the clearest mature agent category.

Common tasks:

- code understanding
- bug fixing
- refactoring
- writing tests
- implementing scoped features
- PR review
- incident triage
- documentation drafting

Why this matters here:

- Underground Circle already leans heavily toward builders, coding agents, and AI workspaces.
- This is the area where the app is already closest to market reality.

### 2. Knowledge work and research

Common tasks:

- investigate topics
- summarize large context
- compare sources
- produce reports
- synthesize options
- turn messy inputs into structured answers

Why this matters here:

- main Chat, Feed tasks, and Office can all support research-agent work, but they do not yet present research outputs cleanly.

### 3. Workflow and operations automation

Common tasks:

- monitor queues or status
- schedule recurring jobs
- trigger actions across services
- update records
- coordinate human approvals
- complete repeatable back-office tasks

Why this matters here:

- Rooms already has scheduled tasks and service concepts.
- Feed already has task execution concepts.
- Office already tracks live agents.

### 4. Customer support and community response

Common tasks:

- answer common questions
- route or escalate requests
- pull knowledge from docs
- summarize cases
- hand off to a human

Why this matters here:

- the app is community-centric, but its agent system is still more internal-facing than member-facing.

### 5. Multimodal content and media work

Common tasks:

- image generation
- OCR and vision
- transcription
- TTS
- translation
- classify and transform content

Why this matters here:

- Hugging Face support exists, but outputs are not yet consistently elevated into first-class artifacts across app surfaces.

### 6. Design-to-build workflows

Common tasks:

- turn references into UI
- transform screenshots to layouts
- compare versions
- generate assets and variants
- validate the result visually

Why this matters here:

- this app needs stronger design-capable agents if Feed tasks and Rooms workspaces are supposed to produce real work, not just text replies.

### 7. Computer-use and browser-use automation

Common tasks:

- click through websites or legacy tools
- gather data from UI-only systems
- validate flows in a browser
- fill forms or complete repetitive UI tasks

Why this matters here:

- this is mostly missing today, but it is one of the most important new capabilities in current agent ecosystems.

### 8. Multi-agent delegation and orchestration

Common tasks:

- run parallel subtasks
- route work to specialist agents
- maintain isolation by workspace/session
- steer active runs
- merge results into one final output

Why this matters here:

- Underground Circle already has circles, rooms, sessions, tasks, office agents, and runs.
- It has the product structure for orchestration, but not the consistent runtime yet.

## Official research sources

### OpenAI Codex

Official sources:

- https://openai.com/index/introducing-codex/
- https://openai.com/business/guides-and-resources/how-openai-uses-codex/
- https://developers.openai.com/codex/use-cases

What the sources emphasize:

- code understanding
- refactors
- writing tests
- feature scaffolding
- bug fixing
- PR review
- data analysis
- front-end build from visual references
- design-to-code
- browser-based task execution
- parallel task execution

### OpenSwan

Official sources:

- https://docs.openswan.ai/
- https://docs.openswan.ai/session-tool

What the sources emphasize:

- self-hosted gateway
- multi-channel chat surfaces
- multi-agent routing
- session visibility boundaries
- session list/history/send/spawn tools
- media support
- web control UI
- mobile nodes

### Enterprise agent platforms

Official sources:

- Salesforce Agentforce: https://www.salesforce.com/agentforce/
- Salesforce use cases: https://www.salesforce.com/agentforce/use-cases/

What the sources emphasize:

- customer support
- knowledge retrieval
- billing and transaction help
- scheduling
- troubleshooting
- lead handling
- escalation and human handoff
- trust and guardrails

## What platforms like OpenSwan are actually being used for

OpenSwan-like tools are not just “chat with an agent.”

They are used for:

- remote access to an always-available agent from messaging apps
- persistent session management
- routing work to different agents
- keeping agent conversations alive outside one UI
- controlling coding agents from phone or web
- media-aware workflows using images, audio, and documents
- lightweight orchestration and background tasking

That means Underground Circle should not treat OpenSwan as a niche Office integration.

It should treat OpenSwan as one transport/runtime provider in a broader agent system.

## Local codebase audit

## Surfaces reviewed

- [src/screens/circles/tabs/chat/ChatTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx)
- [src/screens/circles/tabs/chat/ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- [src/screens/circles/tabs/RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
- [src/screens/circles/tabs/FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)
- [src/screens/circles/tabs/OfficeTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx)
- [src/screens/circles/tabs/office/OfficeChat.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/OfficeChat.tsx)
- [src/lib/openswanService.ts](/Users/cswanson/the-underground-circle/src/lib/openswanService.ts)
- [src/lib/agentInvocation.ts](/Users/cswanson/the-underground-circle/src/lib/agentInvocation.ts)
- [src/lib/bridgeTaskDispatcher.ts](/Users/cswanson/the-underground-circle/src/lib/bridgeTaskDispatcher.ts)
- [src/lib/taskExecutionRuntime.ts](/Users/cswanson/the-underground-circle/src/lib/taskExecutionRuntime.ts)
- [supabase/functions/swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)

## Current strengths

### Strength 1. The app already supports multiple agent backends

Evidence:

- OpenSwan support in [openswanService.ts](/Users/cswanson/the-underground-circle/src/lib/openswanService.ts)
- provider-aware invocation in [agentInvocation.ts](/Users/cswanson/the-underground-circle/src/lib/agentInvocation.ts)
- bridge dispatch in [bridgeTaskDispatcher.ts](/Users/cswanson/the-underground-circle/src/lib/bridgeTaskDispatcher.ts)

Why this matters:

- this is already more advanced than a single-bot chat app

### Strength 2. The app already has multiple execution surfaces

Evidence:

- main chat shell in [ChatTabShell.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/ChatTabShell.tsx)
- room workspace in [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
- Feed task system in [FeedTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/FeedTab.tsx)
- Office control surface in [OfficeTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/OfficeTab.tsx)

Why this matters:

- the product already has natural homes for different agent use cases

### Strength 3. The app already has the beginnings of a runtime model

Evidence:

- task run steps / artifacts / approvals work in recent Feed runtime docs and migrations
- chat run / step / artifact / approval types exist in [chatTypes.ts](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/chat/chatTypes.ts)

Why this matters:

- Claude should extend one shared runtime model, not invent a new one per feature

### Strength 4. The app already has multimodal AI hooks

Evidence:

- HF tools via [swanbot-ai/index.ts](/Users/cswanson/the-underground-circle/supabase/functions/swanbot-ai/index.ts)
- HF tooling and logging in Office and Feed

Why this matters:

- multimodal capability is not hypothetical here

## Major gaps

### Gap 1. The same agent capability is not consistently available across surfaces

Example:

- OpenSwan is a first-class idea in Office
- task execution is more visible in Feed
- room-specific work is stronger in Rooms
- main chat still behaves more like a conversational shell than a full agent workspace

Impact:

- users cannot rely on one mental model for what agents can do where

### Gap 2. OpenSwan is integrated as connectivity, but not fully as product capability

What exists:

- connection, polling, sessions, cron, session send/history/list

What is missing:

- a cross-app session browser
- clean session spawn / steer / transfer UX across Chat, Rooms, Feed, and Office
- mobile-style remote control and handoff patterns

Impact:

- OpenSwan is treated more like a backend utility than a user-facing superpower

### Gap 3. Computer-use and browser-use agent capabilities are still mostly missing

Why this matters:

- modern agents increasingly operate through browsers, UI automation, and validation loops
- without this, task agents cannot reliably finish many real-world tasks

Recommended feature set:

- browser navigation step type
- screenshot artifact type
- page action log
- validation checks against acceptance criteria

### Gap 4. Design-capable task execution is underpowered

Why this matters:

- design-heavy tasks need references, assets, screenshots, visual diffing, and output artifacts
- text-only task outputs are not enough

Recommended feature set:

- image/reference attachments on task runs
- design artifact cards
- visual-review checkpoints
- Figma/design-source context connectors

### Gap 5. Support/community-agent patterns are weak

What is missing:

- FAQ / help agent mode
- member-facing support threads
- escalation to human owner/admin
- action handoff from support into tasks or rooms

Why this matters:

- community products benefit from agent support and knowledge routing, not just creator tools

### Gap 6. Runtime governance is not unified

What is missing:

- one capability-policy system
- one approval system across all surfaces
- one artifact taxonomy
- one run timeline model

Why this matters:

- safety, transparency, and debuggability will remain inconsistent until runtime governance is unified

## What should be in the app if it wants to match top agent use cases

## A. Engineering agent workflows

These should be fully functioning across Chat, Rooms, Feed, and Office:

- ask questions about code/files/context
- plan implementation
- edit files or propose patches
- run tests and checks
- summarize diffs and failures
- branch or spawn follow-up work
- hand work to a room or task

Current status:

- partially present

Missing pieces:

- shared patch/artifact flow
- shared execution timeline
- shared approval model
- better task-to-room-to-chat handoff

## B. Research workflows

These should exist:

- source-aware answers
- compare options
- summarize uploads and linked resources
- generate reports or decision briefs
- save findings as artifacts

Current status:

- present in primitive form through chat and HF tools

Missing pieces:

- first-class research mode
- citations/source bundles as artifacts
- report templates

## C. Workflow automation

These should exist:

- recurring jobs
- trigger-based jobs
- queued follow-up actions
- status tracking
- failure/retry handling
- approval-gated automations

Current status:

- cron and task concepts exist through OpenSwan and Rooms

Missing pieces:

- unified job registry across Office and Rooms
- run history UX
- stronger retry / backoff / auditability in product UI

## D. Multimodal/media workflows

These should exist:

- image generation
- OCR and vision
- audio transcription
- TTS
- translation
- classification

Current status:

- backend support exists

Missing pieces:

- typed artifacts shown consistently in Chat, Feed, Rooms, and Office

## E. Design workflows

These should exist:

- use screenshot/reference input
- generate UI proposals
- attach image/design artifacts
- review outputs visually
- convert accepted direction into implementation tasks

Current status:

- weak

Missing pieces:

- full design capability bundle
- visual artifact handling
- review loop support

## F. Community/support workflows

These should exist:

- answer user/member questions
- route to owner/admin
- turn unresolved requests into tasks
- summarize thread state
- preserve support history

Current status:

- mostly missing as a first-class product mode

## G. Cross-channel / remote agent access

These should exist:

- message the same agent/session from web, mobile, and external channels
- see where a run came from
- transfer or continue the same session in another surface

Current status:

- OpenSwan plumbing points this direction

Missing pieces:

- productized session portability across app surfaces

## Surface-by-surface recommendation

## Main Chat

Main Chat should be:

- the universal entry point
- best for quick asks, research, model comparison, and lightweight task kickoff
- able to escalate into Rooms or Feed tasks

Main Chat should not be:

- the default place for broad filesystem mutation
- the place for long-running operational workflows by default

Claude should add:

- research mode
- support/help mode
- design-assist mode
- task kickoff mode
- room handoff
- session transfer to OpenSwan-backed channels

## Rooms

Rooms should be:

- the structured workspace for execution-heavy work
- best for files, repo context, room-specific tools, and collaborative runs

Claude should add:

- stronger file/runtime coupling
- patch previews
- browser/design tool bundles when task type warrants them
- room run ledger and artifact browser

## Feed

Feed should be:

- the task system
- best for planning, assignment, tracking, approvals, and completion evidence

Claude should add:

- stronger execution bundles
- design/browser capability profiles
- completion gating
- support-task and research-task templates

## Office

Office should be:

- the agent control plane
- best for connections, health, sessions, usage, and fleet management

Claude should add:

- cross-app session browser
- provider capability matrix
- run replay and trace inspection
- approval / budget / trust policies

## Priority features Claude should implement

### Priority 1. Shared runtime model across Chat, Rooms, Feed, Office

Unify:

- run
- step
- artifact
- approval
- check
- capability bundle

### Priority 2. OpenSwan session portability

Add:

- spawn session from Chat into Office/Rooms
- continue existing session in another surface
- session history viewer outside Office
- explicit session ownership and visibility

### Priority 3. Browser and computer-use bundle

Add:

- browser navigation
- screenshot artifact
- action log
- acceptance checks

This is necessary if agents are supposed to finish real modern tasks.

### Priority 4. Design bundle

Add:

- design inputs
- image/review artifacts
- visual comparison flow
- implementation handoff from accepted design

### Priority 5. Community/support mode

Add:

- support agent profile
- FAQ/knowledge context
- escalation flow
- convert support thread into Feed task or Room

### Priority 6. Cross-surface artifact system

All surfaces should render:

- text/report artifact
- image artifact
- audio artifact
- classification/result artifact
- patch artifact
- browser proof artifact
- citation bundle artifact

## Concrete implementation direction for Claude

## New shared primitives

Claude should create or formalize:

- `agent_capability_profiles`
- `agent_run_steps`
- `agent_run_artifacts`
- `agent_run_approvals`
- `agent_run_checks`
- `agent_session_links`

These can map or align with existing Feed task-run and Chat-run structures rather than replacing them blindly.

## New capability bundles

Recommended bundles:

- `research_basic`
- `research_cited`
- `chat_assistant`
- `coding_workspace`
- `design_review`
- `browser_operator`
- `support_agent`
- `workflow_automation`
- `multimodal_media`

Each bundle should define:

- allowed tools
- allowed surfaces
- approval gates
- artifact expectations
- completion rules

## New product flows

### Flow 1. Chat -> Task

- ask in chat
- convert to scoped task
- assign capability profile
- run in Feed
- return artifact summary to chat

### Flow 2. Chat -> Room

- ask in chat
- escalate to room execution
- open room context with files and artifacts
- continue run there

### Flow 3. Office -> Session recovery

- browse all active sessions
- inspect failures
- resume or steer run
- redirect output to Feed or Chat

### Flow 4. Support thread -> task handoff

- answer user
- detect unresolved operational ask
- create tracked task
- return status link

## Highest-value missing features by category

### Coding

- patch artifact preview
- test-result artifact
- room/file diff summary

### Research

- citation bundle artifact
- saved report artifact
- compare-output artifact

### Design

- screenshot upload and design brief artifact
- generated mock artifact
- visual review checklist

### Browser/computer use

- page trace timeline
- screenshot proof chain
- action replay

### Support/community

- FAQ source packs
- escalation queue
- conversation summary cards

### OpenSwan-specific

- session transfer
- session tree visibility UI
- channel/source badge per run
- cron/job view outside Office

## What should not be forced across the app

- heavy filesystem mutation from ambient chat
- advanced admin/connection controls in user-facing chat
- design/browser tools exposed everywhere without task intent
- raw provider-specific tool names in the product UI

The shared runtime should be unified, but the surface affordances should still differ.

## Recommended rollout order

### PR1

- unify runtime vocabulary
- add capability profiles
- make OpenSwan session links portable across surfaces

### PR2

- add browser/computer-use runtime bundle
- add design artifact flow

### PR3

- add support/community agent mode
- add cross-surface session browser

### PR4

- add cross-channel continuity and remote session control improvements

## Final recommendation

The app does not need “more agent buttons.”

It needs a coherent agent platform:

- one runtime
- many capability bundles
- surface-specific affordances
- OpenSwan treated as a serious session/channel provider
- artifacts, approvals, and checks visible everywhere

If Claude follows that direction, Underground Circle can support the top real-world agent use cases without becoming a scattered pile of unrelated AI surfaces.

## Sources

- OpenSwan docs: https://docs.openswan.ai/
- OpenSwan session tools: https://docs.openswan.ai/session-tool
- Introducing Codex: https://openai.com/index/introducing-codex/
- How OpenAI uses Codex: https://openai.com/business/guides-and-resources/how-openai-uses-codex/
- Codex use cases: https://developers.openai.com/codex/use-cases
- Salesforce Agentforce: https://www.salesforce.com/agentforce/
- Salesforce Agentforce use cases: https://www.salesforce.com/agentforce/use-cases/
