# Rooms Deep Design + Dev Audit

Date: 2026-04-05
Repo: `the-underground-circle`
Scope:

- Rooms product model
- `RoomsTab` UI and information architecture
- room data model and schema overlap
- file/editor/chat/task/API surfaces inside Rooms
- frontend design recommendations
- Claude-ready implementation notes

## Executive summary

Rooms has the raw ingredients of a strong product.

It already contains:

- workspace list
- file tree and editor
- room chat
- agent task assignment
- APIs panel
- secrets
- usage
- sessions
- services
- permissions
- tasks
- GitHub browsing
- prompt playground
- canvas/whiteboard

That is a serious feature set.

The current issue is not lack of capability.

The issue is that Rooms is carrying too many product concepts in one place without a strong enough information architecture or a consistent data model.

Main conclusion:

Rooms should become a true workspace surface with a clearer hierarchy:

1. room overview
2. files + artifacts
3. collaboration
4. execution
5. admin/integrations

Right now it behaves more like a giant internal tool drawer than a designed workspace product.

## Current architecture snapshot

Primary UI surface:

- [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

File size:

- [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx) is `4904` lines

Related services and schema:

- [projectRooms.ts](/Users/cswanson/the-underground-circle/src/services/projectRooms.ts)
- [20260226_project_rooms.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260226_project_rooms.sql)
- [20260227_room_files.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260227_room_files.sql)
- [20260227_room_messages.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260227_room_messages.sql)
- [20260318_room_tasks_v2.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260318_room_tasks_v2.sql)
- [ProjectRoomsPanel.tsx](/Users/cswanson/the-underground-circle/src/components/ProjectRoomsPanel.tsx)
- [AgentTaskRunner.tsx](/Users/cswanson/the-underground-circle/src/components/AgentTaskRunner.tsx)

## Primary findings

### Finding 1. Rooms has a split-brain data model

Severity: critical

The repo currently uses two different room systems:

- `project_rooms`
- `circle_rooms`

Evidence:

- [projectRooms.ts](/Users/cswanson/the-underground-circle/src/services/projectRooms.ts)
- [20260226_project_rooms.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260226_project_rooms.sql)
- [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L586)
- [20260227_room_files.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260227_room_files.sql)
- [20260227_room_messages.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260227_room_messages.sql)

Impact:

- unclear product source of truth
- duplicated mental models
- hard-to-reason-about RLS and cross-surface behavior
- UI inconsistencies because some features are built against one room type and some against another

Design consequence:

- the product cannot feel coherent if the data model itself is bifurcated

Recommendation:

- Claude should treat schema unification or a formal compatibility layer as a prerequisite design task, not a backend cleanup detail

### Finding 2. `RoomsTab.tsx` is too large to be safely evolved

Severity: critical

The tab is `4904` lines and contains many unrelated product domains.

Evidence:

- [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)

It currently owns:

- room list
- room creation
- file browser
- editor
- chat
- task dispatch
- APIs panel
- secrets
- usage
- sessions
- services
- permissions
- tasks
- GitHub
- canvas
- playground

Impact:

- very high regression risk
- weak component boundaries
- duplicated styling patterns
- difficult mobile/desktop adaptation
- hard for Claude to implement changes confidently without collateral damage

Recommendation:

- split Rooms into a real module tree with clear ownership by workspace area

### Finding 3. Rooms has weak information architecture

Severity: high

The current right-panel tab system gives equal visual weight to too many fundamentally different concepts.

Evidence:

- [RoomsTab.tsx#L803](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L803)

Current tabs:

- Chat
- GitHub
- Playground
- Sessions
- Services
- APIs
- Secrets
- Permissions
- Tasks
- Usage

Impact:

- the user has to decode the product every time
- core actions compete with secondary/admin tools
- “workspace” and “control plane” are mixed together

Design recommendation:

- separate primary workspace tabs from admin/infrastructure tabs

Suggested top-level grouping:

- `Overview`
- `Files`
- `Chat`
- `Runs`
- `Tasks`
- `Integrations`
- `Settings`

Then move secondary panels inside those sections instead of making each one a peer tab.

### Finding 4. The room entry experience undersells the product

Severity: high

The room list cards are visually lightweight and generic compared to the depth of the underlying room feature set.

Evidence:

- [RoomsTab.tsx#L632](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L632)
- [RoomsTab.tsx#L673](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L673)

Current issues:

- weak room identity
- little sense of active work, status, ownership, or recency
- API badges are icon-only and ambiguous
- cards do not communicate why one room matters more than another

Design recommendation:

- room cards should feel like workspace launchpads, not file cards

Each card should show:

- room name and purpose
- room status
- active collaborators/agents
- recent activity summary
- file/artifact count
- current workflow focus

### Finding 5. The UI mixes creation, editing, execution, and admin too early

Severity: high

The product currently exposes advanced capabilities such as:

- secrets
- room APIs
- services
- permissions
- playground
- GitHub

alongside basic room collaboration.

Impact:

- expert users get power
- normal users get overload

Design recommendation:

- progressive disclosure

Suggested approach:

- default room view should bias toward:
  - overview
  - files
  - chat
  - tasks/runs
- advanced infra surfaces should sit behind an `Admin` or `Power Tools` layer

### Finding 6. Room chat is doing too much hidden prompt engineering

Severity: high

The chat panel currently tries to infer many modes from the user’s prose and loads large amounts of room context based on regex heuristics.

Evidence:

- [RoomsTab.tsx#L2044](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2044)
- [RoomsTab.tsx#L2111](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2111)

Impact:

- unpredictable behavior
- expensive prompts
- hard-to-explain system behavior
- poor trust when results vary

Design recommendation:

- replace hidden intent inference with explicit room actions:
  - `Review room`
  - `Audit files`
  - `Refactor`
  - `Generate tests`
  - `Research`
  - `Debug`

This should be visible in the UI as preset modes or commands.

### Finding 7. The product has multiple execution concepts that overlap without clear separation

Severity: high

Rooms currently contains:

- room chat
- assign-to-agent flow
- quick tasks
- scheduled tasks
- playground runs
- sessions
- services

Impact:

- users cannot tell the difference between:
  - chat conversation
  - task execution
  - background service
  - prompt experiment
  - room workflow

Recommendation:

- define these as separate product objects with separate visuals

Suggested mental model:

- `Chat`: conversation and steering
- `Runs`: concrete executions and outputs
- `Tasks`: durable planned work
- `Services`: persistent automations/integrations
- `Playground`: experiments only

### Finding 8. The APIs panel is conceptually strong but visually too developer-console heavy to be the default peer of chat/files

Severity: medium-high

The APIs panel is detailed and useful, but it belongs to an advanced workspace layer.

Evidence:

- [RoomsTab.tsx#L2745](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2745)

Design recommendation:

- keep it, but reposition it as:
  - `Developer API`
  - under `Integrations` or `Settings`

It should not read as a core everyday room tab for most users.

### Finding 9. Secrets handling is product-powerful but trust-sensitive

Severity: medium-high

The Secrets panel is useful, but in a collaborative workspace it needs clearer trust communication and role boundaries.

Evidence:

- [RoomsTab.tsx#L2854](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2854)

Design recommendation:

- show who can manage secrets
- show last updated by
- show intended consumer
- separate `user-visible metadata` from secret value handling

The UI currently explains some of this, but the interaction model is still basic.

### Finding 10. Canvas and Playground are interesting, but feel bolted on

Severity: medium-high

Canvas and Playground are individually useful, but they do not feel integrated into the room lifecycle.

Evidence:

- [RoomsTab.tsx#L2982](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L2982)
- [RoomsTab.tsx#L3293](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L3293)

Impact:

- they feel like bonus gadgets instead of deliberate room subtools

Design recommendation:

- position them as file/artifact types and work modes, not lateral sibling products

Example:

- Canvas should live under files/artifacts
- Playground should live under runs/experiments

### Finding 11. Room list and room detail use different product languages

Severity: medium

The room card/grid view sells “shared workspace.”

The detail view becomes a low-level power console very quickly.

Impact:

- product tone shifts too hard
- room navigation feels discontinuous

Design recommendation:

- the detail view should preserve a strong room identity header:
  - title
  - description
  - status
  - team presence
  - recent activity
  - current objective

before dropping users into tools and panes

### Finding 12. Mobile adaptation is likely structurally weak because the desktop mental model dominates

Severity: medium

A lot of the Rooms experience appears designed around many simultaneous panels and web-oriented controls.

Evidence:

- [RoomsTab.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx)
- [RoomsTab.tsx#L833](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/RoomsTab.tsx#L833)

Design recommendation:

- mobile should not mimic the desktop tri-panel workspace
- use stacked navigation:
  - room home
  - files
  - chat
  - runs/tasks
  - tools

## Research synthesis

### Slack Canvas pattern

Slack describes Canvas as a collaborative workspace where teams can:

- capture details
- embed files and media
- co-edit
- connect workflows and integrations

Source:

- https://slack.com/features/canvas

Relevant lines:

- canvas as “a new surface”
- embed files, images, videos, and workflows
- keep data and app insights together

Implication for Rooms:

- Rooms should feel like a coherent shared surface with content, automations, and app context together
- not just a pile of tabs

### Notion database views pattern

Notion emphasizes that one underlying data set can support multiple views:

- table
- list
- board
- gallery
- calendar
- timeline

Source:

- https://www.notion.com/help/guides/using-database-views

Relevant lines:

- [turn2view0]
- [turn2view1]

Implication for Rooms:

- rooms should support different views over the same workspace data
- instead of many unrelated panels each reinventing a slice of the state

Practical translation:

- one room can expose:
  - overview view
  - files view
  - activity view
  - task/run view

without making each one a new subsystem

### GitHub Projects pattern

GitHub Projects emphasizes:

- adaptable views
- custom fields
- filtering, sorting, grouping
- charts and status views

Source:

- https://docs.github.com/en/issues/planning-and-tracking-with-projects
- https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/managing-your-views

Implication for Rooms:

- tasks, sessions, runs, and room activity should be treated as structured objects with view controls
- not just flat panels

### Figma Dev Mode status pattern

Figma’s current Dev Mode docs reinforce the importance of explicit workflow states such as:

- Ready for dev
- Completed
- Changed

Source:

- https://help.figma.com/hc/en-us/articles/26781702258583-Dev-Mode-statuses-and-notifications

Implication for Rooms:

- room artifacts and room tasks need explicit lifecycle states
- a room should make handoff state visible, especially for design/dev collaboration

## Senior frontend design recommendations

### 1. Redefine the room shell

Target shell:

- left rail: rooms and workspace navigation
- center: primary content area
- right rail: contextual inspector

But only one primary mode at a time.

Suggested top nav inside a room:

- `Overview`
- `Files`
- `Chat`
- `Runs`
- `Tasks`
- `Integrations`
- `Settings`

### 2. Make `Overview` the real room home

Current Rooms has no strong “workspace home.”

Overview should show:

- room description
- status
- active people/agents
- current goal
- recent files
- recent runs
- recent tasks
- key links/integrations

This is the single biggest UX gap.

### 3. Reduce panel sprawl

Keep advanced tools, but relocate them:

- `APIs`, `Secrets`, `Permissions`, `Services` => `Settings` / `Admin`
- `Playground` => `Runs` / `Experiments`
- `GitHub` => `Integrations`
- `Usage` => `Overview` summary + `Settings` detail

### 4. Make files and artifacts first-class

Rooms should be artifact-centric, not only chat-centric.

Files view should better distinguish:

- documents
- code
- images
- canvases
- generated outputs
- imported GitHub files

### 5. Give tasks and runs visual identity

Use separate cards/rows for:

- task
- run
- service
- message

Right now those concepts blur together too often.

### 6. Upgrade room cards

Each room card should communicate:

- what this room is for
- how active it is
- what kind of work is happening inside
- whether it needs attention

### 7. Introduce explicit room modes

Example modes:

- `Build`
- `Review`
- `Research`
- `Handoff`

This would help align chat behavior, available actions, and visible panels.

### 8. Improve visual hierarchy

Current Rooms is information-dense, but much of it has similar visual weight.

Use:

- stronger section headers
- better empty states
- fewer peer-level pills
- more emphasis on current objective and current active workflow

## Senior frontend development recommendations

### 1. Split `RoomsTab.tsx` aggressively

Suggested module split:

- `rooms/RoomsShell.tsx`
- `rooms/RoomsList.tsx`
- `rooms/RoomOverview.tsx`
- `rooms/RoomFilesView.tsx`
- `rooms/RoomChatView.tsx`
- `rooms/RoomRunsView.tsx`
- `rooms/RoomTasksView.tsx`
- `rooms/RoomIntegrationsView.tsx`
- `rooms/RoomSettingsView.tsx`
- `rooms/roomTypes.ts`
- `rooms/roomHooks.ts`

### 2. Unify room schema usage

Claude should explicitly document whether the product will:

- migrate toward `circle_rooms`
- migrate toward `project_rooms`
- or introduce a compatibility layer

Do not leave this implicit.

### 3. Introduce a workspace view model

Instead of each panel fetching its own state ad hoc, build a view model that normalizes:

- room metadata
- files
- messages
- runs
- tasks
- services
- integrations

### 4. Separate editor/artifact concerns from collaboration concerns

Files/canvas/editor should not be deeply coupled to chat/task dispatch logic in the same component tree.

### 5. Replace hidden heuristics with explicit actions

Room chat should not carry most of the product intelligence through regex-based intent inference.

Use visible commands and presets instead.

### 6. Normalize room execution objects

Current concepts like:

- assigned tasks
- quick tasks
- playground runs
- session logs

should move toward a shared execution object model so the UI can present them consistently.

## Claude-ready notes

Claude should treat the Rooms redesign as:

- a product structure refactor first
- a styling pass second

If Claude only changes styling, the surface will still feel overloaded.

Priority order for Claude:

1. Define the canonical room schema/model.
2. Extract a new room shell with top-level sections.
3. Add a real `Overview` screen.
4. Move advanced/admin tools out of the primary path.
5. Split execution concepts into `Chat`, `Runs`, and `Tasks`.
6. Rebuild room cards and room header to communicate identity and status better.
7. Only then tighten visuals, motion, spacing, and responsive behavior.

## Bottom line

Rooms is not weak because it lacks features.

Rooms is weak because it has too many features presented with too little structure.

The right redesign is not to remove the ambition.

It is to give that ambition a stronger workspace model, clearer view hierarchy, and more deliberate separation between:

- collaboration
- artifacts
- execution
- infrastructure

That is the path Claude should take.
