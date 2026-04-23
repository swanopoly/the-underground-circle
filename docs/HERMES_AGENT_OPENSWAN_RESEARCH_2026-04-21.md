# Hermes Agent → OpenSwan Research

> **Canonical plan:** [`AGENTS_ROADMAP.md`](./AGENTS_ROADMAP.md). This is a supporting research doc — read the roadmap for current file ownership and phase status, read [`OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md`](./OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md) for the 8-section architectural breakdown.

Date: 2026-04-21

## Goal

Study Hermes Agent and extract the product/runtime patterns that would most improve Swanbot and OpenSwan.

Primary sources:

- https://github.com/NousResearch/hermes-agent
- https://hermes-agent.nousresearch.com/docs/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/overview
- https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files
- https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/hooks/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/code-execution
- https://hermes-agent.nousresearch.com/docs/user-guide/security/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/personality
- https://hermes-agent.nousresearch.com/docs/user-guide/features/checkpoints
- https://hermes-agent.nousresearch.com/docs/user-guide/messaging
- https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/
- https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching/

## Short Take

Hermes is strong because it behaves like a durable runtime, not just a chat wrapper.

The patterns worth copying are not mostly model tricks. They are:

- bounded memory with explicit stores
- progressive context loading
- skills as portable, on-demand procedural memory
- strong tool/runtime segmentation
- code-execution and subagent isolation
- scheduling and event hooks
- rollback/checkpoint safety
- platform-specific tool exposure
- persistent profiles / homes

OpenSwan already has pieces of this:

- mode policy
- observed evals
- run metadata and dashboards
- browser planning
- delegated child runs
- memory plumbing
- room/workspace surfaces

But it still does not feel like one coherent always-improving runtime in the same way Hermes does.

## What Hermes Does Well

### 1. Bounded memory, not vague "memory"

Hermes keeps memory explicitly split between:

- `MEMORY.md` for environment / conventions / learned facts
- `USER.md` for user preferences and interaction style

It keeps both bounded and curated, injects them as a frozen session-start snapshot, and pairs that with a much larger searchable session archive.

Why this matters for OpenSwan:

- OpenSwan has richer memory plumbing than Hermes in some places, but the product boundary is still too abstract.
- Hermes makes the mental model simple: "always-on small memory" plus "searchable long history."

### 2. Progressive context discovery

Hermes loads one main project context file at startup, then progressively discovers subdirectory `AGENTS.md` / `CLAUDE.md` / `.cursorrules` as the agent actually touches those directories.

Why this matters:

- This avoids prompt bloat.
- It keeps prompt caching stable.
- It maps better to real coding work where only one part of the repo matters at a time.

### 3. Skills as first-class procedural memory

Hermes treats skills as portable, installable, on-demand knowledge units with progressive disclosure. Skills are not just "personality" or "prompts"; they are a capability layer.

Why this matters:

- This is exactly the hole OpenSwan still has between SOULs and tools.
- OpenSwan has roadmap language around skills, but not the real runtime contract yet.

### 4. Toolsets and platform-specific exposure

Hermes organizes tools into logical toolsets and exposes different tool surfaces by platform. It treats tool visibility as a product/safety concern, not just an implementation detail.

Why this matters:

- OpenSwan has a typed tool runtime, but it still needs stronger surface-level toolset control and explainability.
- The platform-aware part is especially relevant because Underground Circle spans chat, office, rooms, browser work, and external bridges.

### 5. Strong execution runtime

Hermes has both:

- isolated subagent delegation with restricted toolsets
- `execute_code`, which lets the agent write code that calls tools programmatically in a sandboxed child process

Why this matters:

- Hermes collapses many multi-step loops into one execution envelope.
- OpenSwan currently plans and logs well, but it still lacks a comparable controlled execution substrate for "tool orchestration inside code."

### 6. Hooks and automation

Hermes exposes:

- gateway hooks
- plugin hooks
- cron jobs with pause/resume/edit/run/remove

Why this matters:

- OpenSwan has run metadata and some automation concepts, but not yet a generalized event/hook plane that makes the agent feel operational and extensible.

### 7. Safety rails that users can understand

Hermes has:

- explicit dangerous command approval
- container / backend isolation
- context-file security scanning
- checkpoint + rollback

Why this matters:

- OpenSwan has approval ideas and policy layers, but rollback/checkpoint safety is still weaker and less legible.

### 8. Profiles as separate agent homes

Hermes profiles are separate homes with separate config, skills, memory, sessions, and gateway state.

Why this matters:

- OpenSwan modes are good, but profiles/homes are stronger than modes when users want distinct long-lived agent identities.

## Current OpenSwan Position

OpenSwan already has meaningful advantages over a lot of chat wrappers:

- richer run metadata
- mode-aware response contracts
- observed-eval persistence
- shared run summaries / dashboards
- browser plan and browser session metadata
- child-run lineage in UI
- office bridge model
- room/artifact/workspace integration

But compared to Hermes, the missing pieces are more runtime-shape than raw capability.

## Highest-Value Improvements To Copy

### A. Split OpenSwan memory into explicit stores

Build:

- `OPENSWAN_MEMORY.md` equivalent
- `USER_PROFILE.md` equivalent
- searchable long session archive

Desired behavior:

- one small, always-in-context runtime memory block
- one small, always-in-context user preference block
- one on-demand session recall path

Current status:

- partially present through memory retrieval and metadata readers
- not productized with a clean user-facing contract

Priority: very high

### B. Add progressive repo-context discovery

Build:

- startup project context load from one dominant root file
- subdirectory hint tracker for nested `AGENTS.md` / workspace rules
- context injection only when those directories become active

Why:

- stronger coding performance
- lower prompt bloat
- better long-session stability

Priority: very high

### C. Make skills real

Build:

- typed OpenSwan skills registry
- skill bundles attachable by mode/profile/circle
- on-demand skill loading into the prompt/runtime
- skill usage logging into runs
- skill evals

Why:

- this is the clearest Hermes pattern OpenSwan is still missing
- it closes the SOUL vs tool gap

Priority: very high

### D. Add a real execution substrate

Build:

- OpenSwan controlled code-execution runtime
- code can call approved OpenSwan tools programmatically
- bounded execution / call limits / timeout
- streamed results back into run ledger

Why:

- lets OpenSwan solve more complex workflows without repeated LLM/tool turns
- makes it feel more like an agent runtime than a planner

Priority: very high

### E. Add rollback / checkpoint safety for workspace mutation

Build:

- pre-mutation snapshots for room workspaces and file apply flows
- rollback command and UI
- diff preview

Why:

- users trust active coding agents more when they can undo
- this is one of the strongest Hermes product patterns

Priority: high

### F. Add event hooks

Build:

- `pre_tool_call`
- `post_tool_call`
- `pre_llm_call`
- `post_llm_call`
- `run_start`
- `run_end`

Use cases:

- guardrails
- extra memory recall
- metrics
- webhook delivery
- custom org logic

Priority: high

### G. Add scheduled execution as a first-class OpenSwan runtime

Build:

- richer cron/task scheduler on top of OpenSwan runs
- jobs can attach skills, mode, delivery target, memory scope
- runs appear in quality dashboards

Priority: high

### H. Separate agent homes/profiles, not just modes

Build:

- named OpenSwan profiles with separate:
  - memory
  - skills
  - identity / SOUL
  - provider/model defaults
  - automation rules

Why:

- modes are temporary behavior
- profiles are durable agent identities

Priority: medium-high

### I. Platform-specific toolsets

Build:

- clear toolset policies by surface:
  - main chat
  - rooms
  - office
  - browser
  - external bridge

Why:

- simpler safety and explainability
- closer to Hermes' "tool exposure is product design" model

Priority: medium-high

## What Not To Copy Blindly

### 1. Hermes' exact memory format

OpenSwan already has a richer memory substrate than flat markdown files. The important thing to copy is:

- boundedness
- explicit store separation
- user clarity

Not necessarily the exact file format.

### 2. Every platform in one wave

Hermes has a huge messaging footprint. OpenSwan should not chase breadth before the core runtime is tighter.

Copy the architecture pattern, not the platform count.

### 3. Open-ended plugin sprawl too early

Hermes plugins are powerful, but OpenSwan should first stabilize:

- hooks
- skills
- toolset policy

before encouraging lots of arbitrary plugin surfaces.

## Recommended Build Order

### Phase 1 — Tighten the runtime core

1. Explicit two-store memory model
2. Progressive repo-context discovery
3. Skills runtime
4. Toolset-by-surface policy

### Phase 1 status in repo

- explicit memory stores: shipped
- progressive context discovery: shipped
- skills runtime: partially shipped
  - dynamic skill resolution: shipped
  - skill playbooks: shipped
  - skill-quality eval signals: shipped
  - full typed/evaluable DB-backed skill model: not yet shipped
- toolset-by-surface policy: partial, not yet formalized

### Phase 2 — Make OpenSwan truly agentic

5. Controlled code-execution runtime
6. Rollback/checkpoint manager
7. Event hooks
8. Better scheduled execution

### Phase 3 — Make it durable and extensible

9. Named OpenSwan profiles/homes
10. Skill marketplace / import flow
11. Hook/plugin ecosystem
12. External MCP/tool adapters with stronger policy

## Concrete Repo Implications

Most likely new modules:

- `src/lib/openswanSkills.ts`
- `src/lib/openswanContextDiscovery.ts`
- `src/lib/openswanMemoryStores.ts`
- `src/lib/openswanCodeExecution.ts`
- `src/lib/openswanCheckpointRuntime.ts`
- `src/lib/openswanHooks.ts`
- `src/lib/openswanProfiles.ts`

Most likely existing files to evolve:

- `src/lib/swanbot.ts`
- `src/lib/openswanSessionRuntime.ts`
- `src/lib/openswanToolRuntime.ts`
- `src/lib/openswanTaskPlanner.ts`
- `src/lib/subagentRegistry.ts`
- `src/lib/memoryService.ts`
- `src/screens/circles/tabs/ChatTab.tsx`
- `src/screens/circles/tabs/RoomsTab.tsx`
- `src/screens/circles/tabs/OfficeTab.tsx`

## Bottom Line

If OpenSwan should feel like "the agent that helps with any task, command, or question and gets better over time," the biggest Hermes lessons are:

- keep memory bounded and legible
- make context loading progressive
- turn skills into a real capability layer
- give the agent a true execution substrate
- add rollback safety
- treat hooks and scheduling as part of the runtime
- separate durable profile identity from temporary mode

That is the path from "smart agent surfaces" to "durable agent operating system."
