# AI Landscape Radar

Date: 2026-04-07
Type: Dated research report

## What this report is for

This is a current-state AI radar for the Underground Circle wiki. It is meant to answer:

- what parts of AI are stable and foundational
- what parts are moving fastest right now
- what matters most for product builders
- what should be tracked continuously in future reports

## Executive read

The center of gravity in AI has shifted from “which chatbot is best” to “which agent workflow is actually dependable.”

The most important active fronts now are:

- coding and software engineering agents
- agent runtime infrastructure and tools
- multimodal input/output
- browser and computer-use workflows
- open-weight frontier models
- orchestration, approvals, and evals

The most important stable foundations remain:

- transformers
- scaling laws
- retrieval and context engineering
- RL and post-training
- tool use
- human-in-the-loop safety

## The biggest live AI themes

### 1. Coding agents are now product categories, not demos

Why it matters:

- This is the clearest place where agents already do end-to-end work.
- The leading products are not just code completion tools anymore. They plan, edit, test, review, and operate in parallel environments.

High-signal examples:

- OpenAI Codex
- Anthropic Claude Code
- Google Gemini CLI
- OpenClaw as a self-hosted control plane / gateway layer

What to watch:

- isolated environments
- parallel work
- test execution
- approvals and safety modes
- design-to-code workflows
- integrations into chat and external surfaces

### 2. Agent infrastructure is becoming its own layer

Why it matters:

- The winning agent products are increasingly defined by runtime quality, tool access, memory, approvals, and orchestration rather than model quality alone.

Key themes:

- session portability
- tool registries
- background automations
- multi-agent routing
- worktrees and isolated sandboxes
- external channel surfaces

### 3. Multimodal is no longer optional

Why it matters:

- Real agents increasingly need screenshots, images, audio, PDFs, and browser state.
- Text-only interfaces are too weak for many modern tasks.

High-value capability areas:

- screenshot-to-code
- OCR and vision
- image generation and editing
- transcription and TTS
- visual validation

### 4. Browser/computer-use is becoming a core frontier

Why it matters:

- Many real workflows live inside SaaS dashboards, internal tools, and websites.
- Agents need to read and act inside those environments to be genuinely useful.

What to track:

- page navigation
- screenshots and recordings
- action traces
- acceptance checks
- safety and permission gating

### 5. Open-weight models keep getting stronger

Why it matters:

- Product builders now have serious alternatives to closed APIs for many workloads.
- Open-weight models increasingly matter for self-hosted agents, low-cost deployments, and private workflows.

Important families to keep tracking:

- Llama
- Qwen
- DeepSeek
- Mistral
- Gemma
- Phi

### 6. Evals and reliability matter more than raw demos

Why it matters:

- A product-grade agent is defined by repeatability, traceability, and safe completion, not just how impressive a single answer looks.

What to track:

- task success rate
- tool success rate
- regression checks
- approval rates
- artifact quality
- domain-specific evals such as software or security benchmarks

## Most important AI product patterns to track

### Pattern 1. Ask -> plan -> act -> verify

This is now the standard structure for serious agents.

### Pattern 2. Lightweight chat -> escalated task run

Users start in conversation, then promote work into a more structured execution context.

### Pattern 3. One runtime, many surfaces

The best systems reuse the same agent runtime across:

- terminal
- IDE
- browser dashboard
- chat product
- background jobs

### Pattern 4. Typed artifacts over plain-text answers

Strong agent systems increasingly output:

- patches
- reports
- screenshots
- datasets
- transcripts
- approvals
- test results

### Pattern 5. Human control through policies, not constant micromanagement

The best systems use:

- approval tiers
- tool policies
- capability bundles
- review checkpoints

instead of forcing users to approve every trivial step.

## Stable AI topics that should stay evergreen in the wiki

These should live in long-lived reference docs:

- transformers and attention
- pretraining vs post-training
- fine-tuning vs prompting
- embeddings and retrieval
- tool use and function calling
- agent loops
- evals and benchmarks
- model families
- open vs closed ecosystems

## Fast-moving AI topics that need regular dated reports

These should be tracked as radar docs:

- top coding agents
- top agent frameworks
- open-weight model rankings
- multimodal tools and platforms
- browser/computer-use systems
- eval frameworks
- enterprise agent platforms
- AI regulation and major policy shifts

## Recommended recurring report cadence

### Weekly

- important launches
- major model releases
- meaningful product changes in top agent tools

### Monthly

- coding agents
- open-weight models
- multimodal tooling
- enterprise agent products

### Quarterly

- deep synthesis reports
- foundation-model landscape changes
- what should change in Underground Circle product strategy

## Underground Circle relevance

The AI themes most relevant to this product are:

- coding agents
- self-hosted / portable agents
- external channel access
- multimodal workflows
- task runtime reliability
- artifact-rich execution
- community/support agent patterns

That means the AI wiki should prioritize:

- agent products and workflows
- OpenClaw and related control-plane patterns
- coding-agent ecosystem reports
- multimodal and browser-use capability research
- open-source AI tooling

## Sources

- OpenAI Codex use cases: https://developers.openai.com/codex/use-cases
- Introducing Codex: https://openai.com/index/introducing-codex/
- How OpenAI uses Codex: https://openai.com/business/guides-and-resources/how-openai-uses-codex/
- Codex product page: https://openai.com/codex/
- Claude Code hooks: https://docs.anthropic.com/en/docs/claude-code/hooks
- Claude Code subagents: https://docs.anthropic.com/en/docs/claude-code/sub-agents
- OpenClaw docs: https://docs.openclaw.ai/
- OpenClaw getting started: https://docs.openclaw.ai/start/getting-started
- OpenClaw FAQ: https://docs.openclaw.ai/help/faq
- Llama models: https://www.llama.com/models/
- Gemma: https://ai.google.dev/gemma
- EVMbench: https://openai.com/index/introducing-evmbench/
