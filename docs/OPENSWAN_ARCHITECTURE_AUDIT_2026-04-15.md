# OpenSwan Architecture Audit — 2026-04-15

## Why this exists

The OpenSwan docs had started to drift from the code. Several items that
older plans still describe as missing are already implemented, but they
are not yet unified into one authoritative runtime model. This audit is
meant to reset the architecture conversation around what is actually
live, what is only partial, and what still needs to be built next.

---

## Executive Summary

OpenSwan is no longer a thin prompt wrapper.

It already has:

- a shared parent-turn runtime
- delegated specialists with child-run lineage
- typed internal tools
- verification planning and partial execution
- structured artifacts
- memory retrieval and outcome write-back
- chat streaming
- attachment storage and extraction
- SOUL/profile routing primitives

The main gap is no longer "missing foundations."

The main gap is that these capabilities still meet through multiple
seams:

- prompt text instead of a true tool loop
- parent and child runtimes that are similar but not identical
- verification plans that are richer than the actual executor
- attachments that are visible to prompts but not yet first-class
  retrievable working context
- skills that exist as a roadmap concept, not a runtime primitive

So the next architecture goal should be:

**turn OpenSwan into one typed execution system with one planner, one
tool loop, one verification contract, and one context graph across main
chat, Rooms, Office, and specialists.**

---

## What Is Already Implemented

These are present in the codebase now and should not be re-planned as
greenfield work:

### Runtime

- Shared turn runtime in
  [src/lib/openswanSessionRuntime.ts](../src/lib/openswanSessionRuntime.ts)
- Task profiling and verification planning via
  [src/lib/openswanTaskPlanner.ts](../src/lib/openswanTaskPlanner.ts)
- Structured responses and artifacts via
  [src/lib/swanbot.ts](../src/lib/swanbot.ts)
- Child-run delegation via
  [src/lib/subagentRegistry.ts](../src/lib/subagentRegistry.ts)
- Run ledger + artifact persistence via
  [src/lib/agentRunSystem.ts](../src/lib/agentRunSystem.ts)

### Tooling

- Typed internal tool runtime in
  [src/lib/openswanToolRuntime.ts](../src/lib/openswanToolRuntime.ts)
- Verification execution in
  [src/lib/openswanVerificationRuntime.ts](../src/lib/openswanVerificationRuntime.ts)
- Artifact-to-workspace handoff via
  [src/lib/chatWorkspace.ts](../src/lib/chatWorkspace.ts)
  and
  [src/lib/roomWorkspaceLauncher.ts](../src/lib/roomWorkspaceLauncher.ts)

### Memory and trust

- Prompt-time memory bundle assembly in
  [src/lib/memoryService.ts](../src/lib/memoryService.ts)
- Outcome-memory write-back in
  [src/lib/memoryService.ts](../src/lib/memoryService.ts)
- Memory influence UI in
  [src/screens/circles/tabs/chat/MessageCitations.tsx](../src/screens/circles/tabs/chat/MessageCitations.tsx)

### Streaming and context

- Chat SSE function in
  [supabase/functions/chat-stream/index.ts](../supabase/functions/chat-stream/index.ts)
- Client streaming wrapper in
  [src/lib/swanbotStream.ts](../src/lib/swanbotStream.ts)
- Attachment storage/extraction in
  [src/lib/chatAttachments.ts](../src/lib/chatAttachments.ts)
- `message_attachments` schema in
  [supabase/migrations/20260420_message_attachments.sql](../supabase/migrations/20260420_message_attachments.sql)
- Session-profile to SOUL helpers in
  [src/lib/serviceProfileSouls.ts](../src/lib/serviceProfileSouls.ts)

---

## Findings

### P0 — There is still no authoritative mid-turn tool-calling loop

Severity: high

OpenSwan already has a typed tool registry and executor, but the parent
runtime still hands the model a text `toolBrief` instead of running a
real tool conversation loop.

Current behavior:

- planner recommends tools
- runtime logs recommended tools
- verifier executes some deterministic verification tools
- artifact UI can invoke workspace actions after the response

What is missing:

- model emits a typed tool call
- runtime validates the call against surface/policy
- runtime executes the tool
- runtime returns the tool result to the model
- model continues reasoning with the result in the same turn

Evidence:

- [src/lib/openswanSessionRuntime.ts](../src/lib/openswanSessionRuntime.ts)
  builds `toolBrief` and passes it as prompt context
- [src/lib/openswanToolRuntime.ts](../src/lib/openswanToolRuntime.ts)
  exists, but is not used as a live model loop in the parent turn

Why it matters:

- without this, OpenSwan cannot become a serious agent runtime
- tools stay advisory or post-hoc
- the same task gets split across planner, assistant response,
  artifact UI, and verification executor instead of one typed loop

### P0 — Parent and subagent execution paths are still only partially unified

Severity: high

The parent runtime is richer than the subagent runtime. Specialists have
memory, child runs, artifacts, and tool-action logging, but they do not
run through the same authoritative session runtime contract as the
parent.

Evidence:

- parent path:
  [src/lib/openswanSessionRuntime.ts](../src/lib/openswanSessionRuntime.ts)
- child path:
  [src/lib/subagentRegistry.ts](../src/lib/subagentRegistry.ts)

Current problem:

- parent turn has explicit stage progression, verification plan, and run
  metadata enrichment
- child runs call structured SwanBot directly with a narrower wrapper
- this creates runtime drift risk over time

Why it matters:

- delegation quality depends on specialists behaving like first-class
  workers, not special-case prompt wrappers
- new capabilities will keep getting added to the parent path first and
  to specialists later, if at all

### P1 — Verification planning is ahead of verification execution

Severity: medium-high

The planner can express richer verification intent than the executor can
actually fulfill.

Current state:

- typecheck, tests, and lint can execute
- preview/manual/security/performance/integration checks are still
  mostly planned or summarized rather than executed by runtime

Evidence:

- planner:
  [src/lib/openswanTaskPlanner.ts](../src/lib/openswanTaskPlanner.ts)
- executor:
  [src/lib/openswanVerificationRuntime.ts](../src/lib/openswanVerificationRuntime.ts)

Why it matters:

- users see a verification plan that implies more closure than the
  runtime actually proves
- auditability is weaker when "verified" really means "some checks ran,
  others were only proposed"

### P1 — Skills are still a documentation concept, not a runtime primitive

Severity: medium-high

The docs correctly want SOULs to answer "who" and skills to answer
"what can this agent do right now," but the runtime still does not have
an actual skill object model.

Current state:

- capability profiles exist for specialists
- active plugin ids influence delegation
- there is no concrete `skills` runtime layer with manifests, policies,
  routing metadata, or tool bundles

Evidence:

- roadmap mentions in
  [docs/SOULS_SPIRITS_SKILLS_ROADMAP.md](./SOULS_SPIRITS_SKILLS_ROADMAP.md)
- no live `skillRouter` or runtime `activeSkills[]` implementation found

Why it matters:

- without a skill layer, OpenSwan capability remains spread across
  prompts, delegation heuristics, plugin ids, and tool recommendations
- this makes capability growth harder to reason about and harder to
  govern

### P1 — Attachments are stored and injected, but not yet treated as a durable context graph

Severity: medium-high

Attachments exist, extraction exists, and Figma/file context is already
flowing into prompts. But attachments are still closer to prompt
payloads than to first-class retrievable knowledge objects.

Current state:

- uploaded files are stored and metadata is persisted
- readable text is extracted
- prompt builders can inline or summarize attachment content

Missing next layer:

- attachment embeddings / retrievable chunks
- explicit citation lineage from output back to attachment fragment
- attachment-to-memory promotion policy
- run-level "which attachment evidence was actually used" beyond simple
  prompt inclusion

Why it matters:

- complex design/code/research tasks need evidence grounding, not just
  bigger prompt stuffing

### P2 — Tool policy and approval architecture is still shallow

Severity: medium

The runtime has tool definitions and surface scoping, but the policy
model is still thin compared with mature agent systems.

Missing pieces:

- per-tool approval requirements
- risk classes
- user-facing approval reasons
- deterministic allow/deny policy for child specialists
- stronger audit trail for denied calls and escalations

Why it matters:

- once OpenSwan gets real tool loops, weak policy architecture becomes a
  scaling problem immediately

### P2 — OpenSwan lacks a formal evaluation harness

Severity: medium

The repo has the beginnings of good observability, but not yet a real
eval loop that tells you whether architecture changes improved coding,
review, research, or builder quality.

Why it matters:

- architecture work without evals quickly becomes taste-driven
- model routing, delegation depth, and tool policies cannot be tuned
  well without outcome metrics

---

## Document Drift

These roadmap claims are now outdated and should be interpreted as
"partial/unified later" rather than "missing entirely":

- "No SSE streaming into the chat bubble"
- "Chat attachments are missing"
- "`sessionProfile` to SOUL mapping is informal"
- "Used N memories pill still queued"
- "No real subagent runtime"
- "No authoritative typed tool runtime"

The correct state is:

- streaming exists
- attachments exist
- SOUL/profile helpers exist
- memory citations exist
- subagent runtime exists
- typed tool runtime exists

The real issue is that each of these is still narrower or less unified
than the docs want.

---

## Architecture Additions That Matter Most Next

### 1. Build one authoritative tool loop

Target:

- planner recommends tool opportunities
- model can issue typed tool calls
- runtime validates and executes calls
- tool results return into the same response loop
- parent and child agents share the same tool-call contract

This is the single highest-value addition.

Without it, OpenSwan remains "agent-shaped orchestration around a
chatbot" rather than a real agent runtime.

### 2. Move specialists onto the same session runtime contract

Target:

- parent and child runs share one execution engine
- same stage model
- same tool loop
- same verification contract
- same memory and attachment grounding
- same policy hooks

Delegation should change *who owns a slice of work*, not *which runtime
rules apply*.

### 3. Turn verification into a contract, not just a checklist

Target:

- every task profile maps to explicit proof requirements
- each proof item has status:
  `executed`, `planned`, `blocked`, `manual_required`, `not_applicable`
- UI and run history show that distinction clearly

This makes OpenSwan much more trustworthy for coding and release work.

### 4. Add a real skill system

Target:

- skills as typed capability objects
- skill manifests with:
  - prompt fragment
  - allowed tools
  - preferred outputs
  - verification posture
  - risk posture
- SOULs choose personality/voice/stance
- skills choose operational capability

This is the cleanest way to stop mixing behavior across prompts, plugin
ids, delegation heuristics, and hardcoded tool categories.

### 5. Promote attachments into retrievable evidence objects

Target:

- chunk and embed extracted attachment content
- record which attachment fragments were cited
- expose attachment evidence in run history and message citations
- allow durable promotion of important attachments into circle memory

This is especially important for builder, Figma, spec, and research
flows.

### 6. Add a formal OpenSwan eval harness

Track at least:

- task success rate
- verification pass rate
- artifact apply rate
- review finding precision
- delegation utility
- time to first acceptable answer
- cost per successful task

Without this, routing and architecture tuning will stay mostly manual.

---

## Recommended Build Order

### Phase A — Runtime unification

1. Introduce a true typed tool-call loop in the parent runtime.
2. Extract a reusable agent execution core.
3. Move subagents onto that shared execution core.

### Phase B — Trust hardening

1. Expand verification statuses.
2. Add tool approval/risk policy.
3. Expose executed vs planned vs manual-required proof in UI.

### Phase C — Capability system

1. Add skill manifests and runtime binding.
2. Merge skills into planner, SOUL routing, and specialist profiles.
3. Add admin/user visibility for active skills per session/run.

### Phase D — Context graph

1. Attachments become retrievable chunks.
2. Attachment evidence gets cited in responses and run history.
3. Important attachments can promote to memory/research records.

### Phase E — Evaluation

1. Define benchmark tasks by category.
2. Persist per-run outcome scoring.
3. Compare routing and delegation policies against real success metrics.

---

## External Patterns That Validate This Direction

These are the most relevant official-source patterns behind the audit:

- Anthropic Claude Code documents memory as layered, session-persistent
  working context and documents hooks/subagent lifecycle events. That
  reinforces OpenSwan's need for one unified runtime plus clearer
  lifecycle hooks, not more prompt-only specialization.
  Sources:
  - https://docs.anthropic.com/en/docs/claude-code/hooks
  - https://docs.anthropic.com/es/docs/claude-code/memory

- OpenAI's Responses API centers streaming plus typed tool usage,
  including built-in tools, function tools, and MCP-backed tools. That
  directly supports moving OpenSwan from tool recommendation text to a
  real typed tool loop.
  Sources:
  - https://platform.openai.com/docs/guides/streaming-responses
  - https://platform.openai.com/docs/api-reference/responses/compact?api-mode=responses

- MCP's core distinction between model-controlled tools and
  application-controlled resources is exactly the distinction OpenSwan
  still needs to formalize for attachments, memory, and workspace
  context.
  Sources:
  - https://modelcontextprotocol.io/docs/learn/server-concepts
  - https://modelcontextprotocol.io/legacy/concepts/resources

---

## Bottom Line

OpenSwan does not need another broad roadmap.

It needs a convergence pass.

The system already contains most of the important primitives. The next
step is to collapse them into:

- one execution core
- one typed tool loop
- one verification contract
- one capability model
- one context graph

That is the shortest path from "feature-rich chat runtime" to a serious,
auditable, extensible agent architecture.
