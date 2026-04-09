# Claude Agent Stack and OpenClaw Panel Deep Audit

Date: 2026-04-08
Type: Deep research, implementation audit, and Claude-ready improvement plan
Status: Audit + next-step build plan

## Scope

This audit covers:

- the major Claude-driven agent/runtime/memory changes already added to Underground Circle
- what is working well
- what is still incomplete or incorrectly implemented
- what is still needed for agents to handle tasks well
- how to make session memory much stronger
- what OpenClaw frontend/runtime features should exist in the app
- how those OpenClaw frontend ideas should map into the Pixel Agent Panel

## What is already meaningfully improved

### 1. Shared run primitives exist

The repo now has a serious cross-surface run model in:

- [agentRunSystem.ts](/Users/cswanson/the-underground-circle/src/lib/agentRunSystem.ts)
- [20260408_unified_agent_runs.sql](/Users/cswanson/the-underground-circle/supabase/migrations/20260408_unified_agent_runs.sql)

That is a major architectural improvement over surface-specific execution state.

### 2. Memory hierarchy exists conceptually

The app now has:

- `org`
- `circle`
- `room`
- `user`
- `session`

scopes in `memory_entries`.

That is directionally correct and much better than a single giant history blob.

### 3. The main chat and Black Swan path now attempt structured runs and artifacts

That is an important step away from pure text-in/text-out behavior.

### 4. OpenClaw is already treated as a real runtime

The repo has:

- gateway polling
- session listing
- session status
- memory search
- cron job listing
- subagent enumeration
- messaging to sessions

in [openclawService.ts](/Users/cswanson/the-underground-circle/src/lib/openclawService.ts).

### 5. The Office Agent Panel is already a good extensibility point

The Agent Panel already has:

- overview
- terminal
- memory
- runs
- spirit/evolution
- customization

That makes it the right place to absorb OpenClaw-style control UI ideas.

## What I added in this pass

I added a dedicated OpenClaw tab to the Agent Panel in:

[AgentPanel.tsx](/Users/cswanson/the-underground-circle/src/screens/circles/tabs/office/AgentPanel.tsx)

The new OpenClaw tab now includes:

- runtime endpoint header
- session/subagent/cron summary tiles
- OpenClaw capability cards
- live sessions section
- subagents section
- cron jobs section
- session message action
- spawn subagent action
- OpenClaw memory search action

This is a meaningful UI improvement, but it is not yet parity with the OpenClaw Control UI.

## High-priority findings

### 1. Memory is still the biggest blocker to agent quality

Severity: Critical

The app still does not have a truly managed session memory system.

Main problems:

- transcript history, memory entries, old circle memory, bond memory, and automation notes are still fragmented
- startup memory and archival memory are not clearly separated
- retrieval is still too recency-based
- compaction is too weak
- there is no reliable checkpoint cadence

Result:

the agents can look smart in short sessions but still degrade over long work.

### 2. User memory privacy is still unsafe

Severity: Critical

The current unified memory model is still too loose around `user` scope.

If Claude is going to improve agent memory properly, this must be fixed before expanding memory usage further.

### 3. The OpenClaw panel is useful but still only a first slice

Severity: High

The new Agent Panel tab now shows some OpenClaw control concepts, but it still does not cover several important Control UI features:

- per-session overrides
- stop/abort controls
- live streaming tool output
- logs tail
- instances/presence
- debug snapshots
- channels status and login state
- approval flows
- config patching

### 4. The app still lacks a full approval-driven execution model

Severity: High

The best agent products distinguish:

- read
- write
- browser
- external send
- privileged system execution

Underground Circle still has partial approval ideas, but not a consistent cross-surface model.

### 5. Agent usefulness is still too coding-heavy in implementation details

Severity: High

The research direction is broader than coding:

- research
- support
- operations
- growth
- design
- content
- community

But the runtime and many UIs still feel optimized mainly for developer workflows.

### 6. OpenClaw-style session management is still not portable enough across surfaces

Severity: High

The app still needs stronger session portability between:

- Chat
- Rooms
- Feed
- Office

without re-creating state separately in each place.

### 7. Tool visibility is still weaker than it should be

Severity: Medium

The app now has better run primitives, but users still do not consistently see:

- plan
- active step
- tool call
- tool result
- subagent used
- artifact produced
- evaluator status

across all surfaces.

### 8. OpenClaw frontend ideas should influence the Pixel Agent Panel more deeply

Severity: Medium

The right design direction is not “copy the whole OpenClaw dashboard.”

The right move is:

- use the Agent Panel as the compact per-agent control UI
- use Office as the broader runtime operations console

## Best OpenClaw frontend features to bring into Underground Circle

Based on current OpenClaw docs, the most valuable frontend/runtime patterns are:

### 1. Session-centric control

Bring in:

- current session header
- session list
- session state
- model override
- reasoning/thinking override
- stop/abort run control

Best place:

- Agent Panel per agent
- Office for bulk views

### 2. Live tool stream visibility

Bring in:

- active tool card
- incremental tool output
- timeline of tool events

Best place:

- Agent Panel overview
- run inspector

### 3. Cron jobs and background automation

Bring in:

- list jobs
- run now
- enable/disable
- delivery mode visibility
- last run / next run

Best place:

- Agent Panel for agent-scoped quick view
- Office for full automation management

### 4. Subagent visibility

Bring in:

- subagent list
- task summary
- status
- model
- session link

Best place:

- Agent Panel
- Rooms runs view

### 5. Memory search

Bring in:

- search memory
- see matched results
- attach result to current run

Best place:

- Agent Panel
- main chat run context rail

### 6. Runtime capability cards

Bring in:

- channels
- media
- browser automation
- nodes
- control UI/runtime
- plugins/skills

These are valuable because they make the agent’s useful surface area legible.

### 7. Presence and health

Bring in:

- gateway health
- connection health
- session count
- queue health
- last activity

Best place:

- Office first
- Agent Panel second

### 8. Logs and debug snapshots

Bring in:

- recent errors
- recent gateway log lines
- status snapshot
- models snapshot

Best place:

- Office primarily
- Agent Panel only as a compact debug drawer

## What still needs to be implemented correctly

### Memory

Still needed:

- private user memory enforcement
- startup memory bundle vs archival retrieval split
- semantic retrieval
- checkpoint compaction
- memory evaluation before promotion
- memory access logging
- better contradiction handling

### Execution

Still needed:

- unified approval model
- queue semantics across all surfaces
- abort/pause/resume
- stronger artifact typing
- evaluator loops before completion/publish

### OpenClaw parity

Still needed:

- session patching
- explicit stop/abort
- logs tail
- status/health/models debug cards
- channels/plugin status
- instance/presence list
- better cron editing UI

### Agent usefulness

Still needed:

- stronger non-coding task packs
- research workflows
- support workflows
- community workflows
- design workflows
- operations workflows
- deliverable templates

## Recommended next frontend improvements for the Pixel Agent Panel

### Phase A

Add next:

- stop/abort session button
- model override selector
- last run artifact list
- gateway health badge
- better error state handling

### Phase B

Add next:

- live tool output stream
- subagent drill-down
- recent approval requests
- recent evaluator outcomes

### Phase C

Add next:

- compact debug drawer
- logs tail preview
- channels/pairing status
- runtime/node target visibility

## Recommended backend/runtime improvements that matter most

### 1. Perfect session memory is not realistic, but managed session memory is

The best achievable system is:

- small startup memory
- strong session working memory
- semantic archival retrieval
- aggressive compaction
- evaluator-gated promotions

That is the right target.

### 2. Add memory checkpoints on run events, not page unload

Checkpoint on:

- N turns
- tool-heavy steps
- plan changes
- pause
- completion
- failure

### 3. Separate agent personality memory from workspace memory

Bond/SOUL memory should remain distinct from:

- project decisions
- user preferences
- room instructions

But it should still be retrievable through one orchestrated memory system.

### 4. Add role-based capability packs

Useful agent packs should include:

- researcher
- operator
- designer
- support
- writer
- community manager
- builder
- reviewer

### 5. Add evaluator loops

Before marking work done:

- quality eval
- completion eval
- safety eval
- formatting/deliverable eval

## Claude implementation order

### PR1

- fix memory privacy and retrieval correctness
- add stop/abort/session override primitives
- add gateway health model to Agent Panel / Office

### PR2

- add logs/debug snapshot surface
- add live tool stream panel
- add evaluator status surface

### PR3

- add semantic memory retrieval and checkpoint compaction
- add stronger run portability across Chat, Rooms, Feed, Office

### PR4

- add richer OpenClaw parity features:
  - session patching
  - channels status
  - instance presence
  - deeper cron editing

### PR5

- add role-based non-coding agent packs and deliverable templates

## Final recommendation

Claude has already moved the app in the right direction structurally.

The next leap is not more scattered features. It is tightening:

- memory correctness
- approval correctness
- runtime portability
- OpenClaw-style operations visibility
- non-coding agent usefulness

The OpenClaw panel addition in the Agent Panel is a good first frontend step, but the app still needs another full pass before it reaches true managed-agent quality.

## Sources

- OpenClaw features: https://docs.openclaw.ai/concepts/features
- OpenClaw Control UI: https://docs.openclaw.ai/web/control-ui
- OpenClaw docs overview: https://docs.openclaw.ai/
- Anthropic Claude Code memory: https://docs.anthropic.com/en/docs/claude-code/memory
- Anthropic Claude Code subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- Anthropic building effective agents: https://www.anthropic.com/engineering/building-effective-agents
