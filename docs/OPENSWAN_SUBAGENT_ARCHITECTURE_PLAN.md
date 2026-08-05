# OpenSwan Sub-Agent Architecture Plan

> **Status (2026-07-13): substantially SHIPPED.** `src/lib/subagentCapabilities.ts`
> exists and exports `SubagentCapabilityProfile` / `listSubagentCapabilities` /
> `getSubagentCapability`; `src/lib/subagentRegistry.ts` consumes it
> (`capabilityToProfile`) and uses `Promise.allSettled` for partial-failure
> handling. Read this doc as design rationale/history, not as an open backlog —
> "Current Problems" below describes the pre-2026 state.

## Goal

Turn OpenSwan sub-agents from prompt-only specialist labels into real capability-backed workers with:

- canonical SOUL/spirit-backed role definitions
- reusable skill bundles
- explicit tool and artifact responsibilities
- stronger delegation planning
- better partial-failure handling
- visible run lineage and child-run drilldown

The target is a system closer to Claude Code style specialist agents and SwanClaw session-first execution, while staying aligned with this repo's existing SOUL, spirit, plugin, and run-system architecture.

## Current Problems

1. `subagentRegistry.ts` is a separate hardcoded role universe.
2. SOULs, spirit operations profiles, and plugin role bundles already exist, but the runtime does not consume them as the source of truth.
3. Delegated agents run through generic text-only `getSwanBotResponse(...)`, so they cannot return structured artifacts, review findings, or verification outputs.
4. The legacy single-specialist shortcut in `ChatTab.tsx` is inconsistent with the newer parallel OpenSwan runtime.
5. Parallel delegation uses all-or-nothing `Promise.all(...)` failure behavior.
6. There is no explicit skill binding model for specialist agents.

## Design Principles

1. One source of truth for specialist capability.
   Spirit/SOUL-backed capability profiles should define how specialists think, what they own, what tools they can use, and what outputs they prefer.

2. One delegation runtime.
   Main chat, room chat, and future Office flows should all delegate through the same runtime path.

3. Structured outputs over plain text.
   Specialists should be able to emit artifacts, findings, plans, and verification results.

4. Plugin and integration awareness should shape planning, not only prompt text.

5. Partial completion must be preserved.
   One failed specialist must not collapse the entire delegation round.

6. Keep the rollout incremental.
   Start with capability modeling, then runtime adoption, then skill execution, then UI drilldown.

## Architecture Direction

### Layer 1: Capability Profiles

Introduce a canonical `SubagentCapabilityProfile` that merges:

- spirit identity
- system prompt prefix
- operations profile
- skill bundle id
- allowed tools
- preferred artifacts
- preferred verification checks
- model preference
- risk posture
- evidence posture
- communication density

This becomes the core data structure for all delegated specialist execution.

### Layer 2: Specialist Registry

Refactor the registry so roles like `researcher`, `builder`, `reviewer`, `tester`, `architect`, `security`, `devops`, and `writer` are resolved from capability profiles rather than hardcoded prompt blobs.

The registry should support:

- role aliases
- spirit-backed specialists
- plugin-expanded specialist sets
- future user-defined project agents

### Layer 3: Delegation Planner

Replace the current fixed planner logic with a capability-aware planner that can:

- select specialist sets by task kind
- incorporate active plugin roles
- account for preview/testing/research/security needs
- choose between `focused`, `auto`, and `parallel`
- emit delegation intent with reasons and expected outputs

### Layer 4: Structured Specialist Execution

Move delegated agents off plain `getSwanBotResponse(...)` and onto structured execution so child agents can return:

- code/web artifacts
- review findings
- research/source bundles
- verification plans
- verification results
- tool events

### Layer 5: Skill Binding

Add a skill layer that binds reusable instructions and responsibilities to capability profiles.

Examples:

- `research.synthesis`
- `coding.implementation`
- `coding.review`
- `coding.debug`
- `qa.verification`
- `security.audit`
- `devops.release`
- `content.publish`

The first version can be declarative metadata plus prompt fragments. Later versions can include tool policies and runtime hooks.

### Layer 6: Child-Run Visibility

Expose child specialists as first-class run nodes in:

- run status bar
- inline run ledger
- run history drawer

Users should be able to inspect what each specialist produced and where it failed.

## Rollout Plan

### Phase 1: Foundation

1. Add `subagentCapabilities.ts`
2. Define canonical capability profile type
3. Build profiles from `agentSpirits.ts` and `spiritOperationsProfiles.ts`
4. Refactor `subagentRegistry.ts` to consume those profiles

Deliverable:

- no more prompt-only hardcoded role definitions as the main source of truth

### Phase 2: Planner Upgrade

1. Expand delegation planning to use capability metadata
2. Add plugin role expansion
3. Add security/devops/qa/research/coding-agent specialist options
4. Remove the old one-off legacy specialist shortcut from `ChatTab.tsx`

Deliverable:

- one delegation pipeline for all chat execution

### Phase 3: Structured Specialist Results

1. Switch delegated specialists to structured responses
2. Preserve child artifacts and verification objects
3. Synthesize structured child outputs into the parent answer
4. Store child outputs in parent and child run metadata

Deliverable:

- specialists produce real artifacts, not only text

### Phase 4: Skill System

1. Add capability-to-skill binding
2. Normalize skill bundles from spirit metadata
3. Add initial built-in skill catalog
4. Allow plugin activation to expand specialist skills

Deliverable:

- reusable specialist skills instead of ad hoc prompt repetition

### Phase 5: UI and Control Plane

1. Live specialist chip drilldown
2. Child-run inspection in run history
3. Delegation policy visibility per session
4. Specialist completion/failure transitions in the live ledger

Deliverable:

- specialist work is inspectable, not opaque

### Phase 6: Project Agents

1. Add project-level agent definitions under an `agents/` directory
2. Allow custom specialist composition for repo-specific roles
3. Merge custom roles into the planner and control plane

Deliverable:

- reusable project-local specialists

## Initial Specialist Set

The foundation should support these canonical specialists:

- `planner`
- `researcher`
- `builder`
- `reviewer`
- `architect`
- `debugger`
- `tester`
- `security`
- `devops`
- `writer`
- `designer`
- `support`

## Implementation Notes

### Canonical Role Mapping

The current role labels should map to spirit-backed capabilities where possible:

- `coder` -> `sr-engineer`
- `reviewer` -> `code-reviewer`
- `tester` -> `qa-engineer`
- `architect` -> `architect`
- `researcher` -> `researcher`
- `debugger` -> `sr-engineer` or `coding-agent` with debug skill emphasis
- `writer` -> `writer`
- `designer` -> `designer`
- `security` -> `security`
- `devops` -> `devops` or `github-devops`
- `planner` -> `pm` or `tech-lead`

### Tool Policy Direction

The first capability layer should declare tools even if the runtime does not enforce all of them yet.

Example categories:

- `code.inspect`
- `code.generate`
- `code.review`
- `verification.typecheck`
- `verification.tests`
- `verification.lint`
- `verification.preview`
- `workspace.create_room`
- `workspace.apply_artifacts`
- `workspace.open_preview`
- future: `github.pr_review`, `github.ci_debug`, `research.source_map`

### Failure Handling Direction

Replace `Promise.all(...)` with per-agent settled results. Parent synthesis should:

- include completed specialists
- mark failed specialists
- still produce a usable final answer

## Success Criteria

1. Specialist behavior is defined by capability profiles, not duplicated prompt blobs.
2. Plugins can influence specialist selection directly.
3. Delegated specialists can return structured outputs.
4. Child-run results remain visible and inspectable.
5. Adding a new SOUL/spirit can expand specialist capability without editing multiple systems.
