# Rooms Implementation Spec

Date: 2026-04-05
Repo: `the-underground-circle`
Depends on: `rooms-deep-design-dev-audit-2026-04-05.md`
Audience: Claude or another implementation agent
Goal: turn Rooms from an overloaded monolith into a coherent workspace product with a clearer shell, clearer sections, and safer implementation boundaries

## Product goal

Reframe Rooms as a workspace product with clear layers:

1. room overview
2. files and artifacts
3. collaboration
4. execution
5. integrations and admin

The redesign should improve:

- clarity
- discoverability
- trust
- responsiveness
- maintainability

without deleting the deeper power-user capabilities that already exist.

## Core product constraints

### Keep the feature ambition

Do not reduce Rooms to a simple file browser or simple chat.

The target should still support:

- files
- chat
- tasks
- runs
- canvas
- playground
- GitHub
- APIs
- secrets
- services

But those capabilities must sit inside a stronger product structure.

### Do not keep the current peer-tab sprawl

The current right-panel tab array should not survive as the long-term IA.

Current:

- `chat`
- `github`
- `playground`
- `sessions`
- `services`
- `apis`
- `secrets`
- `permissions`
- `tasks`
- `usage`

Target:

- top-level sections with grouped secondary tools

### Treat schema ambiguity as a design blocker

Claude should not ignore the `project_rooms` / `circle_rooms` split.

Before or alongside the UI redesign, Claude should define one of these strategies:

1. canonical `circle_rooms` with migration path
2. canonical `project_rooms` with migration path
3. compatibility adapter with explicit deprecation plan

## Target information architecture

### Top-level room sections

Recommended in-room sections:

- `Overview`
- `Files`
- `Chat`
- `Runs`
- `Tasks`
- `Integrations`
- `Settings`

### Section meanings

#### `Overview`

Purpose:

- room home
- recent activity
- workspace identity
- room health and current focus

Contains:

- room title, status, description
- active agents/people
- recent file changes
- recent runs
- open tasks
- current integrations summary

#### `Files`

Purpose:

- browse, open, edit, upload, and organize room artifacts

Contains:

- file tree
- tabs
- editor/viewer
- artifact types:
  - code
  - markdown/docs
  - image
  - canvas
  - imported GitHub files

#### `Chat`

Purpose:

- room-scoped conversation and steering

Contains:

- message feed
- explicit room commands and presets
- file-aware chat context
- assign/spawn actions

#### `Runs`

Purpose:

- execution history and experiments

Contains:

- playground runs
- agent runs
- task execution results
- session logs

Playground should move here as a mode, not remain a peer tab.

#### `Tasks`

Purpose:

- planned work and durable room objectives

Contains:

- room tasks
- quick task launcher
- scheduled tasks
- task status and outcomes

#### `Integrations`

Purpose:

- external systems connected to the room

Contains:

- GitHub
- external APIs
- connected services overview

#### `Settings`

Purpose:

- room configuration and advanced admin

Contains:

- secrets
- permissions
- services
- usage
- developer APIs

## Target shell layout

### Desktop

Recommended shell:

- left rail:
  - room switcher
  - section navigation
- center column:
  - active primary section
- right rail:
  - contextual inspector for current file, task, run, or integration

The right rail should be contextual, not a permanent peer product stack.

### Mobile

Recommended shell:

- room header
- top section switcher
- single primary pane
- bottom sheet only for contextual detail, not for the entire secondary product

Do not carry the desktop right-panel mental model directly onto mobile.

## Visual design direction

### Room cards

Rooms list should feel more alive and intentional.

Each room card should show:

- room name
- short purpose
- status chip
- activity indicator
- avatars or agent presence summary
- recent activity line
- file/task/run counts

Remove or downgrade the current ambiguous icon-only API badge row.

### Room header

The room header should become a stronger identity anchor.

Suggested header content:

- room name
- status
- description
- active collaborators/agents
- last activity
- quick actions:
  - new file
  - chat
  - run task

### Section nav

The section nav should read like a workspace, not a utility bar.

Prefer:

- fewer, clearer items
- stronger labels
- grouped secondary tools

### Empty states

Upgrade empty states so each one teaches the purpose of the section.

Examples:

- Overview:
  - explain room purpose and first actions
- Files:
  - create/import/upload
- Runs:
  - start first experiment
- Tasks:
  - create task or launch quick task

## Data model direction

### Short-term requirement

Introduce a frontend room repository or adapter that hides whether data is coming from:

- `circle_rooms`
- `project_rooms`

Suggested file:

- `src/screens/circles/tabs/rooms/roomRepository.ts`

Responsibilities:

- load canonical room summary
- load room files
- load room messages
- load room tasks
- normalize status and counts

### Long-term requirement

Move toward one canonical room model with:

- identity
- status
- collaborators/agents
- artifacts/files
- executions/runs
- tasks
- integrations
- settings

## Suggested file split

Claude should split the monolith into a real module tree.

Suggested structure:

- `src/screens/circles/tabs/rooms/RoomsShell.tsx`
- `src/screens/circles/tabs/rooms/RoomsListView.tsx`
- `src/screens/circles/tabs/rooms/RoomWorkspaceShell.tsx`
- `src/screens/circles/tabs/rooms/RoomOverviewView.tsx`
- `src/screens/circles/tabs/rooms/RoomFilesView.tsx`
- `src/screens/circles/tabs/rooms/RoomChatView.tsx`
- `src/screens/circles/tabs/rooms/RoomRunsView.tsx`
- `src/screens/circles/tabs/rooms/RoomTasksView.tsx`
- `src/screens/circles/tabs/rooms/RoomIntegrationsView.tsx`
- `src/screens/circles/tabs/rooms/RoomSettingsView.tsx`
- `src/screens/circles/tabs/rooms/RoomCard.tsx`
- `src/screens/circles/tabs/rooms/RoomHeader.tsx`
- `src/screens/circles/tabs/rooms/RoomSectionNav.tsx`
- `src/screens/circles/tabs/rooms/roomTypes.ts`
- `src/screens/circles/tabs/rooms/roomRepository.ts`
- `src/screens/circles/tabs/rooms/roomHooks.ts`

Move these existing domain pieces behind those views instead of keeping them embedded in one file.

## View-specific recommendations

### `RoomOverviewView`

Should include:

- room hero/header
- active agents strip
- recent files
- recent chat summary
- recent runs
- open tasks
- integrations summary

This should be the default section.

### `RoomFilesView`

Should include:

- file tree
- artifact type filters
- editor/viewer tabs
- contextual inspector for selected file

Canvas should be treated as a file type here.

### `RoomChatView`

Should include:

- message timeline
- explicit room actions
- agent assign/spawn
- file-aware context chips

Remove overreliance on hidden prompt heuristics.

### `RoomRunsView`

Should include:

- playground runs
- task-run outputs
- session logs

This is where experiments and execution history belong.

### `RoomTasksView`

Should include:

- durable tasks
- scheduled tasks
- quick task launcher
- task state filters

### `RoomIntegrationsView`

Should include:

- GitHub
- external endpoints
- API capabilities summary

Developer API docs can live here initially or in Settings, depending on Claude’s judgment.

### `RoomSettingsView`

Should include:

- secrets
- permissions
- services
- usage

This section should read as room administration, not core collaboration.

## Interaction recommendations

### Replace hidden regex intent inference with explicit presets

Current room chat behavior tries to infer:

- review
- security
- performance
- refactor
- tests
- docs
- research
- debug
- architecture
- types

That should become explicit chat presets or commands.

Suggested visible actions:

- `Review room`
- `Security audit`
- `Performance review`
- `Generate tests`
- `Research topic`
- `Debug issue`

### Add consistent execution objects

Claude should aim toward a shared execution object model for:

- quick tasks
- scheduled tasks
- playground runs
- chat-triggered agent runs

Even if not fully unified in PR1, the UI should start presenting them consistently.

## PR1 redesign scope

PR1 should be a structural redesign, not a total rebuild.

### Deliver in PR1

- new room shell
- new room section nav
- new `Overview` section
- move advanced/admin panels under grouped sections
- split main `RoomsTab.tsx` into major views
- upgrade room cards
- preserve existing functionality through extracted subviews where possible

### Do not deliver in PR1

- full schema migration between room systems
- complete execution model unification
- full mobile redesign beyond sane stacking behavior
- removal of every legacy subpanel

## Claude implementation order

1. Create the `rooms/` module structure and move shell logic out of `RoomsTab.tsx`.
2. Build `RoomsListView` and `RoomWorkspaceShell`.
3. Introduce top-level room sections.
4. Build `RoomOverviewView` and make it the default section.
5. Move `GitHub`, `APIs`, `Secrets`, `Permissions`, `Services`, `Usage` under `Integrations` or `Settings`.
6. Move `Playground` under `Runs`.
7. Refactor `ChatPanel` into `RoomChatView` and begin replacing hidden intent inference with visible presets.
8. Tighten responsive behavior and visual hierarchy after the structural moves are stable.

## Acceptance criteria

PR1 is successful when:

1. Rooms opens into a workspace shell with clear top-level sections.
2. `Overview` exists and gives a real room home view.
3. Advanced/admin tools no longer sit as equal peers to core collaboration views.
4. The room list communicates identity and activity better than the current file-card style.
5. `RoomsTab.tsx` is materially reduced in responsibility and size.
6. Existing room features still remain reachable, even if some are regrouped.

## Bottom line

The Rooms redesign should not start with a visual polish pass.

It should start with a shell and hierarchy redesign.

Claude’s first job is to make Rooms legible as a product.

Once the structure is right, the visual language and interaction polish will have a stable surface to improve.
