# AI Research Operations

Date: 2026-04-07
Type: Evergreen process guide

## Purpose

This document defines how to keep adding deep AI research into the wiki in a way that stays organized over time.

The goal is not to dump random notes. The goal is to build a durable research system.

## Research streams to maintain

### Stream 1. Agent products

Track:

- Claude Code
- Codex
- Gemini CLI
- OpenSwan
- OpenCode
- Aider
- Cursor
- Windsurf
- other high-signal agent products

Focus:

- workflows
- runtime design
- safety/approval patterns
- integrations
- pricing and access changes

### Stream 2. Model landscape

Track:

- OpenAI
- Anthropic
- Google
- Meta
- Alibaba Qwen
- DeepSeek
- Mistral
- Microsoft Phi
- Cohere
- other serious open-weight families

Focus:

- capability changes
- context windows
- multimodal additions
- pricing
- licensing
- deployment implications

### Stream 3. Open-source AI tooling

Track:

- inference stacks
- training/fine-tuning stacks
- RAG and retrieval tools
- evaluation tools
- browser-use and computer-use stacks
- self-hosted agent systems

### Stream 4. AI product patterns

Track:

- design-to-code
- browser automation
- support agents
- research agents
- workflow automation
- enterprise operations
- community AI products

### Stream 5. Policy, safety, and trust

Track:

- eval frameworks
- permission models
- governance patterns
- notable benchmark releases
- major policy or regulatory changes

## Document types

### Evergreen reference

Use when:

- the material is durable
- it explains fundamentals
- it should be updated in place

### Dated radar report

Use when:

- the material is changing quickly
- the report reflects a specific moment in time
- the goal is to track movement over weeks or months

### Product application memo

Use when:

- the research needs to map directly into Underground Circle
- the output is design/feature/runtime guidance rather than general reference

## Update cadence

### Weekly

- one short AI radar update
- one focused product-monitor note if something major shipped

### Monthly

- one deeper category report
- examples: coding agents, open models, multimodal tools, enterprise agent platforms

### Quarterly

- one synthesis report connecting the research back to product strategy

## Quality bar

Every serious report should include:

- what changed
- why it matters
- what is stable vs time-sensitive
- what Underground Circle should care about
- source links

## Source hierarchy

Preferred source order:

1. official product docs
2. official company blog / release pages
3. official GitHub repos
4. high-signal papers or benchmarks

Avoid building the wiki from low-signal commentary when a primary source exists.

## Suggested near-term backlog

### Highest priority

- top coding agents monthly tracker
- OpenSwan ecosystem tracker
- open-weight model tracker
- multimodal tools tracker
- browser/computer-use tracker
- evals and reliability tracker

### Next

- enterprise agent platforms
- AI design-to-code workflows
- AI support-agent patterns
- AI workflow automation patterns

## Rule for expanding beyond AI

The General Wiki should reuse the same structure:

- evergreen foundations
- dated radar reports
- product-application memos
- one index page per domain

AI is the first domain. The structure should later be copied to:

- design
- engineering
- startups
- crypto
- growth
- operations
