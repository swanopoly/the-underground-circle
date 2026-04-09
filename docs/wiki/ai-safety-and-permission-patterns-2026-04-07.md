# AI Safety And Permission Patterns

Date: 2026-04-07
Type: Evergreen reference

## Why this matters

The more capable an agent becomes, the more important permission design becomes.

The central safety problem for agent products is not only “can the model say something harmful.”

It is also:

- what can the system access
- what can it execute
- when does it need approval
- how visible are its actions
- how recoverable are mistakes

## The key safety layers for agent systems

### 1. Capability scoping

An agent should not automatically have access to every tool, every file, and every system.

Capability scoping should define:

- which tools exist
- which ones are enabled in this run
- what data the run can see
- whether the agent is read-only or action-capable

### 2. Approval tiers

Different actions deserve different levels of friction.

Examples:

- read-only retrieval: low friction
- local edits: moderate friction
- external writes or destructive actions: high friction
- credentialed browser actions: highest friction

### 3. Isolation

Good agent systems isolate risky work through:

- sandboxes
- worktrees
- scoped sessions
- temporary environments

### 4. Traceability

A safe system should make it possible to inspect:

- what the agent saw
- what it decided
- what actions it took
- what outputs it created

### 5. Recovery

The system should make it easy to:

- stop the run
- reject the action
- roll back the change
- resume safely

## What current products are signaling

Anthropic’s computer use docs explicitly highlight prompt-injection risk and the need for careful handling around logins and external actions.

OpenAI’s Codex positioning emphasizes isolated sandboxes and reviewable outputs.

Enterprise agent platforms emphasize:

- admin review
- capability visibility
- data-policy control

These are all variants of the same deeper pattern:

agent power must be governed by product design, not just model behavior.

## Strong design patterns

### Pattern 1. Capability bundles

Instead of one giant permissions surface, use named bundles such as:

- research
- coding
- browser operator
- support
- multimodal media

### Pattern 2. Approval by risk class

Do not ask for approval on every tiny action.

Ask based on:

- external impact
- reversibility
- credential use
- data sensitivity

### Pattern 3. Proof before trust

The system should prefer:

- artifacts
- traces
- screenshots
- checks

over invisible internal reasoning.

### Pattern 4. Environment-specific guardrails

Chat, Rooms, Feed, and Office do not need identical affordances even if they share the same runtime primitives.

## Underground Circle relevance

This topic should directly shape:

- task capability profiles
- room mutation controls
- chat approvals
- OpenSwan session trust boundaries
- future browser/computer-use features

## Sources

- Anthropic computer use tool: https://docs.anthropic.com/en/docs/build-with-claude/computer-use
- Codex use cases: https://developers.openai.com/codex/use-cases
- Copilot Studio docs: https://learn.microsoft.com/en-us/microsoft-copilot-studio/
