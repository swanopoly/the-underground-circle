# AI Agents & Tools: Comprehensive Reference Wiki

> **Last Updated:** July 13, 2026 (model lineup refreshed; most narrative sections still reflect the April 2, 2026 research pass)
> **Scope:** CLI-based AI coding agents, AI agent frameworks & SDKs, Model Context Protocol (MCP), and AI model comparisons.
> **Staleness note:** model tables in Section 4 date quickly — treat the linked provider docs as the source of truth for specs and pricing.

---

## Table of Contents

- [Section 1: CLI-Based AI Coding Agents](#section-1-cli-based-ai-coding-agents)
  - [Claude Code (Anthropic)](#claude-code-anthropic)
  - [OpenAI Codex CLI](#openai-codex-cli)
  - [Google Gemini CLI](#google-gemini-cli)
  - [Cursor](#cursor)
  - [OpenCode (SST)](#opencode-sst)
  - [Windsurf (Codeium / OpenAI)](#windsurf-codeium--openai)
  - [Aider](#aider)
  - [Continue.dev](#continuedev)
  - [CLI Agent Comparison Table](#cli-agent-comparison-table)
- [Section 2: AI Agent Frameworks & SDKs](#section-2-ai-agent-frameworks--sdks)
  - [Anthropic Agent SDK](#anthropic-agent-sdk)
  - [OpenAI Agents SDK](#openai-agents-sdk)
  - [LangChain / LangGraph](#langchain--langgraph)
  - [CrewAI](#crewai)
  - [AutoGen / Microsoft Agent Framework](#autogen--microsoft-agent-framework)
  - [Vercel AI SDK](#vercel-ai-sdk)
  - [Framework Comparison Table](#framework-comparison-table)
- [Section 3: Model Context Protocol (MCP)](#section-3-model-context-protocol-mcp)
  - [What MCP Is and Why It Matters](#what-mcp-is-and-why-it-matters)
  - [Architecture](#mcp-architecture)
  - [Popular MCP Servers](#popular-mcp-servers)
  - [Building MCP Servers](#building-mcp-servers)
  - [MCP Adoption Across Tools](#mcp-adoption-across-tools)
- [Section 4: AI Models Comparison](#section-4-ai-models-comparison)
  - [Claude Models (Anthropic)](#claude-models-anthropic)
  - [OpenAI Models](#openai-models)
  - [Google Gemini Models](#google-gemini-models)
  - [Meta Llama 4 Models](#meta-llama-4-models)
  - [Alibaba Qwen Models](#alibaba-qwen-models)
  - [DeepSeek Models](#deepseek-models)
  - [Mistral Models](#mistral-models)
  - [Model Pricing Comparison Table](#model-pricing-comparison-table)
  - [Model Performance Comparison Table](#model-performance-comparison-table)
- [Sources & Official Documentation](#sources--official-documentation)

---

## Section 1: CLI-Based AI Coding Agents

### Claude Code (Anthropic)

**Website:** [code.claude.com](https://code.claude.com) | **Docs:** [code.claude.com/docs](https://code.claude.com/docs)

#### What It Is

Claude Code is Anthropic's agentic coding tool that operates directly in the terminal. It understands your entire codebase, can make coordinated edits across multiple files, run commands, and interact with external services through MCP. It launched in early 2025 and has rapidly become the most widely adopted AI coding CLI.

#### Architecture & How It Works

Claude Code runs as a Node.js CLI application that connects to Anthropic's API. It reads your project context (files, git history, CLAUDE.md instructions) and uses a reason-and-act loop to plan and execute coding tasks. The agent can read files, write/edit code, run shell commands, search codebases, and interact with external tools via MCP servers.

#### Key Features

**Hooks (September 2025)**
Hooks are deterministic lifecycle callbacks that run at specific points during Claude Code's operation. Unlike CLAUDE.md instructions (which Claude follows ~80% of the time), hooks execute 100% of the time.

14+ hook trigger points:
- `SessionStart`, `SessionEnd` -- session lifecycle
- `UserPromptSubmit` -- before processing user input
- `PreToolUse`, `PostToolUse`, `PostToolUseFailure` -- tool execution lifecycle
- `PermissionRequest` -- when Claude asks for permission
- `Notification` -- on notifications
- `SubagentStart`, `SubagentStop` -- subagent lifecycle
- `Stop` -- when Claude finishes
- `TeammateIdle`, `TaskCompleted` -- team coordination
- `ConfigChange`, `PreCompact` -- configuration and context management

**MCP Servers**
MCP extends Claude Code with access to external tools, databases, APIs, and services. Configure servers in `.mcp.json` or via `claude mcp add`. Claude Code has the deepest MCP integration of any coding agent, with access to hundreds of servers for GitHub, Slack, Sentry, databases, Playwright, and more.

**Subagents (July 2025)**
Subagents spin up separate AI instances, each with its own system prompt, tool permissions, and optionally a different model. Claude Code can run up to 10 simultaneous subagents. Example use cases: a "code-reviewer" agent reads diffs, an "explorer" agent searches a large repo, and they work in isolation before handing back summaries.

**Worktrees**
When you run `claude --worktree` or a subagent uses `isolation: "worktree"`, Claude Code creates an isolated working copy using `git worktree`. This allows parallel work on different branches without conflicts. Custom `WorktreeCreate` hooks can replace the default git behavior for other VCS systems (SVN, Perforce, Mercurial).

**Skills (October 2025)**
Skills are specialized knowledge documents that load on demand (unlike CLAUDE.md which loads every session). Stored in `.claude/skills/`, they contain domain-specific knowledge like API conventions, deployment procedures, or coding patterns.

**Plugins (October 2025)**
Plugins are packaged bundles that can include skills, hooks, commands, agents, and MCP server configurations. They enable sharing and reusing Claude Code configurations across projects and teams.

**Agent Teams (February 2026)**
Multiple Claude Code agents can coordinate as a team, working on different aspects of a project simultaneously.

#### Models Available

| Model | Best For | Cost (Input/Output per 1M tokens) |
|-------|----------|-----------------------------------|
| Claude Opus 4.6 | Complex reasoning, architecture, subtle bugs | $5.00 / $25.00 |
| Claude Sonnet 4.6 | Day-to-day coding, best balance of speed/quality | $3.00 / $15.00 |
| Claude Haiku 4.5 | Fast routine tasks, high-volume operations | $1.00 / $5.00 |

Switch models on the fly with `/model opus`, `/model sonnet`, or `/model haiku`. Subagents can each run on different models.

#### Pricing Plans

| Plan | Price | Claude Code Access | Usage |
|------|-------|-------------------|-------|
| Free | $0/mo | No | Basic web/app access |
| Pro | $20/mo ($17/mo annual) | Yes | Standard usage |
| Max 5x | $100/mo | Yes | 5x Pro usage |
| Max 20x | $200/mo | Yes | 20x Pro usage |
| API | Pay-per-token | Yes | Based on token consumption |
| Teams | $25-30/user/mo | Yes | Team features + admin |
| Enterprise | Custom | Yes | SSO, audit logs, custom |

#### Best Practices

**CLAUDE.md Configuration:**
- Run `/init` to generate a starter CLAUDE.md
- Keep it under 200 lines; remove instructions Claude already follows correctly
- Check CLAUDE.md into git so the team can contribute
- Place files at: home folder (all sessions), project root (shared), or child directories (monorepos)
- CLAUDE.md is advisory (~80% compliance); use hooks for guaranteed behavior

**Model Strategy:**
- Start with Sonnet 5 for most work
- Escalate to Fable 5 (or Opus 4.8) when you hit reasoning limits or need Agent Teams
- Use Haiku 4.5 for high-volume pipelines and simple tasks

**Workflow Tips:**
- Use `/compact` to manage context when conversations get long
- Use `/insights` weekly to analyze session patterns and improve your setup
- Use `/config` to set your preferred response style (Explanatory, Concise, Technical)
- Write hooks for anything that must happen every time (linting, formatting, security checks)
- Extract repeated workflows into skills rather than bloating CLAUDE.md

#### Strengths
- Deepest MCP integration of any agent
- Subagent parallelism (up to 10 simultaneous agents)
- Git worktree isolation for safe parallel work
- Deterministic hooks system for guaranteed behaviors
- Rich plugin ecosystem
- 1M token context window with Opus 4.6

#### Limitations
- Requires Pro subscription minimum ($20/mo) or API credits
- Token-based pricing can be unpredictable for heavy usage
- CLAUDE.md compliance is advisory, not guaranteed
- Closed-source (the CLI itself)

---

### OpenAI Codex CLI

**Website:** [openai.com/codex](https://openai.com/codex/) | **GitHub:** [github.com/openai/codex](https://github.com/openai/codex) | **Docs:** [developers.openai.com/codex/cli](https://developers.openai.com/codex/cli)

#### What It Is

Codex CLI is OpenAI's open-source coding agent that runs locally from the terminal. Built in Rust for speed and efficiency, it can read, change, and run code on your machine. Released in mid-2025, it became available to ChatGPT Plus users in June 2025, with a companion web-based Codex app launched alongside it.

#### Key Features

- **Code Generation & Understanding:** Describe what you want and Codex adapts to your project structure and conventions
- **Multi-Agent Workflows:** Sub-agents use readable path-based addresses (e.g., `/root/agent_a`) with structured inter-agent messaging
- **MCP Integration:** Configure MCP servers via `~/.codex/config.toml` or `codex mcp` CLI commands (supports STDIO and streaming HTTP)
- **Image Input:** Attach screenshots or design specs; paste images into the interactive composer
- **Fuzzy File Search:** Type `@` in the composer to search the workspace
- **Live Injection:** Press Enter while Codex is running to inject new instructions into the current turn
- **Internet Access:** Enabled for task execution (as of June 2025)

#### Models

| Model | Description |
|-------|-------------|
| GPT-5.4 | Latest flagship (March 2026) |
| GPT-5.3-Codex | Optimized for code generation |
| GPT-5.1-Codex-Mini | Lighter, faster code model |
| GPT-5.2 | Previous flagship |

#### Pricing

Codex CLI is open source (Apache 2.0). You pay only for the underlying models:

| Plan | Price | Codex Messages (per 5 hours) |
|------|-------|------------------------------|
| ChatGPT Plus | $20/mo | 30-150 |
| ChatGPT Pro | $200/mo | 300-1,500 |
| ChatGPT Business | $30/user/mo | Token-based (as of April 2026) |
| API | Pay-per-token | Unlimited |

#### Strengths
- Open source (Apache 2.0, Rust-based)
- Built-in image understanding for UI development
- Multi-agent v2 workflows with structured messaging
- Strong integration with OpenAI ecosystem
- Available on Windows, macOS, Linux

#### Limitations
- Tied to OpenAI models only (no third-party model support)
- Newer and less mature ecosystem compared to Claude Code
- Token costs can be high with GPT-5 series models
- Web app sandboxed environment has limitations

---

### Google Gemini CLI

**Website:** [geminicli.com](https://geminicli.com) | **GitHub:** [github.com/google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | **Docs:** [geminicli.com/docs](https://geminicli.com/docs)

#### What It Is

Gemini CLI is Google's open-source AI agent that brings Gemini models directly into the terminal. It uses a ReAct (reason and act) loop with built-in tools and MCP servers to handle complex coding tasks. Released in 2025, it provides the most direct path from prompt to Gemini models.

#### Key Features

- **Built-in Tools:** Google Search grounding, file operations, shell commands, web fetching
- **Agent Skills (Preview):** Experimental support for specialized agent skills (e.g., `pr-creator`, `cli_help`)
- **Plan Mode:** Safe, read-only mode for planning complex changes before executing them; plans can be opened in an external editor
- **MCP Support:** Extensible with Model Context Protocol for custom integrations
- **Image Support:** Windows clipboard image paste support (Alt+V)
- **Interactive Autocompletion:** Shell autocompletion for a seamless terminal experience
- **1M Token Context Window:** Access to Gemini 3 models with massive context

#### Models

Access to the Gemini model family, determined by Gemini CLI based on the task:
- Gemini 3.1 Pro Preview
- Gemini 3 Pro
- Gemini 2.5 Flash (with API key authentication)

#### Pricing

| Tier | Cost | Limits |
|------|------|--------|
| Free (Google Account) | $0 | 60 req/min, 1,000 req/day |
| Free (API Key) | $0 | Flash model only |
| Paid Tier | Fixed price | Higher daily quotas |
| Pay-As-You-Go | Per-token | Full control over usage |

Check usage with `/stats` within Gemini CLI.

#### Strengths
- Completely free tier with generous quotas
- Open source
- 1M token context window
- Google Search grounding built-in
- Plan mode for safe exploration

#### Limitations
- Younger ecosystem than Claude Code or Codex
- Fewer MCP integrations available
- Free tier restricted to Flash model with API key auth
- Agent Skills still in preview/experimental

---

### Cursor

**Website:** [cursor.com](https://cursor.com) | **Docs:** [cursor.com/docs](https://cursor.com/docs)

#### What It Is

Cursor is an AI-first code editor built as a fork of VS Code. All VS Code extensions, keybindings, and themes work, and you can import your entire configuration in one click. It is the most feature-complete AI code editor available as of 2026.

#### Key Features

**Agent Mode:**
The defining feature of Cursor in 2026. Describe complex tasks ("add authentication to these 12 endpoints," "write integration tests for the payment module") and Agent mode plans, executes, and applies changes across multiple files. You can spin up agents on separate tasks while focusing on the hardest problem yourself.

**Composer:**
Multi-file editing through natural language. Cursor indexes your repository using vector embeddings and RAG, then Composer generates entire diffs across multiple files and applies them atomically.

**Cmd+K Inline Editing:**
Highlight code and press Cmd+K to edit it with natural language instructions without leaving your flow.

**Tab Completion:**
AI-powered autocomplete that predicts multi-line changes based on your coding patterns and recent edits.

**Chat:**
Codebase-aware chat for asking questions about your code, debugging, or getting explanations.

#### Models Supported

Cursor supports multiple model providers:
- Claude Opus 4.6, Sonnet 4.6, Haiku 4.5
- GPT-5.x series, GPT-4o
- Gemini 3.1 Pro, 2.5 Flash
- Various open models
- "Auto" mode (unlimited, Cursor selects the optimal model)

#### Pricing

| Plan | Price | Key Features |
|------|-------|-------------|
| Hobby (Free) | $0/mo | Limited Agent requests and Tab completions |
| Pro | $20/mo | Unlimited Tab, $20 credits/mo for premium models, unlimited Auto mode |
| Business | $40/seat/mo | Pro features + admin controls, centralized billing, team rules |

Since June 2025, paid plans include a monthly credit pool equal to the plan price. Credits deplete based on model choice -- "Auto" mode is unlimited, but manually selecting frontier models draws from your balance.

#### Strengths
- Full VS Code compatibility (extensions, themes, keybindings)
- Agent mode is a genuine force multiplier
- Multi-model support with smart Auto mode
- Atomic multi-file edits via Composer
- Strong community and rapid iteration

#### Limitations
- Closed source
- Credit-based pricing can be confusing
- Free tier is very limited for daily use
- Heavier resource usage than CLI tools
- VS Code fork means some lag behind upstream updates

---

### OpenCode (SST)

**Website:** [opencode.ai](https://opencode.ai) | **GitHub:** [github.com/sst/opencode](https://github.com/sst/opencode) | **Docs:** [opencode.ai/docs](https://opencode.ai/docs)

#### What It Is

OpenCode is an open-source terminal AI coding agent built in Go by the team behind SST (the serverless deployment framework). Released in late 2025, it accumulated over 95,000 GitHub stars within months, driven by being genuinely free (MIT license) with support for an unusually broad range of models.

#### Architecture

OpenCode uses a client/server architecture. The TUI (Terminal User Interface) frontend is just one possible client -- the server can be driven remotely from a mobile app or other interfaces. Available as a terminal-based interface, desktop app, or IDE extension.

#### Key Features

- **75+ Model Providers:** Bring your own API key from any provider, or run local models through Ollama at zero cost
- **Free Models Included:** Connect any model -- Claude, GPT, Gemini, DeepSeek, Qwen, local Ollama, and more
- **TUI Interface:** Beautiful terminal UI for interactive coding sessions
- **Multi-Platform:** Terminal CLI, desktop app, or IDE extension
- **MIT License:** Fully open source, no subscription required

#### Pricing

Completely free. You only pay for API calls to whichever model provider you choose.

#### Strengths
- Truly free and open source (MIT)
- Broadest model support of any CLI agent (75+)
- Beautiful TUI interface
- Client/server architecture enables remote access
- Massive community (95K+ GitHub stars)
- Go-based (fast, single binary)

#### Limitations
- Younger project, less mature than Claude Code or Aider
- No built-in MCP support (as robust as Claude Code's)
- Relies entirely on third-party model providers
- Smaller plugin/extension ecosystem

---

### Windsurf (Codeium / OpenAI)

**Website:** [windsurf.com](https://windsurf.com) | **Docs:** [docs.windsurf.com](https://docs.windsurf.com)

#### What It Is

Windsurf (formerly Codeium) is an AI-powered IDE with Cascade, its flagship agentic assistant. OpenAI acquired Codeium in early 2025 for a reported $3 billion. The Windsurf product continues to ship updates post-acquisition.

#### Key Features -- Cascade

**Cascade** is Windsurf's agentic AI that plans multi-step edits, calls tools, and uses deep repository context:

- **Two Modes:** Code mode (creates and modifies files) and Chat mode (answers questions about code)
- **Context Awareness:** Tracks all your actions -- edits, commands, conversation history, clipboard, terminal commands -- to infer intent and adapt in real time
- **Autonomous Memory:** Generates and stores memories to maintain context between conversations
- **Web Integration:** Search the web, deploy apps, inspect live previews, and loop results back into code

#### Pricing

| Plan | Price | Credits/Month |
|------|-------|---------------|
| Free | $0/mo | 25 |
| Pro | $15/mo | 500 |
| Teams | $30/user/mo | Team features |
| Enterprise | $60/user/mo | ZDR defaults, advanced security |

#### Strengths
- Cascade's deep context awareness and intent tracking
- Autonomous memory between sessions
- Competitive pricing ($15/mo Pro)
- Integrated deployment and preview features

#### Limitations
- Uncertain roadmap post-OpenAI acquisition
- Credit-based system can be limiting
- Less transparent about which models power Cascade
- Smaller community than Cursor

---

### Aider

**Website:** [aider.chat](https://aider.chat) | **GitHub:** [github.com/Aider-AI/aider](https://github.com/Aider-AI/aider)

#### What It Is

Aider is the gold standard for developers who want bulletproof Git integration and precise, reviewable AI edits. It's a free, open-source, model-agnostic AI pair programmer that runs in the terminal. With 39K+ GitHub stars, it's one of the two leading open-source AI coding CLIs (alongside OpenCode).

#### Key Features

- **Git-First Design:** Every AI edit becomes an automatic commit with a descriptive, well-formatted message. Use `git diff`, `git log`, and `git revert` to review and manage AI changes
- **Architect Mode:** Uses one model for reasoning (the "architect") and another for editing (the "editor"). Pair an expensive reasoning model with a fast cheap editing model for optimal quality/cost
- **Structured Mode:** Plan-based approach that tracks progress across sessions, breaks complex features into managed tasks with automated checklist updates
- **130+ Language Support:** Linter support for 130 languages and repo-map support for 20 (as of v0.77.0)
- **Multi-Modal Input:** Add screenshots, reference docs, architecture diagrams directly into chat
- **Voice Input:** Speak coding requests aloud for hands-free development
- **75+ LLM Providers:** Works with Claude, GPT-5, Gemini, DeepSeek, Grok, local Ollama instances, and more

#### Models Supported

Model-agnostic with 75+ providers:
- Claude Sonnet 4/Opus 4 series
- GPT-5.x series
- Gemini 2.5/3 series
- DeepSeek R1 & V3
- Grok models
- Local models via Ollama

#### Pricing

Free and open source. Users pay only for API calls, typically **$5-30/month** depending on model choice and usage.

#### Strengths
- Git integration as a core design principle, not a bolt-on
- Architect mode for separating reasoning from editing
- Model-agnostic (broadest model support)
- Zero licensing cost
- Excellent for code review workflows

#### Limitations
- Terminal-only (no IDE integration)
- Steeper learning curve than GUI tools
- No built-in MCP support
- Smaller subagent/multi-agent capabilities compared to Claude Code

---

### Continue.dev

**Website:** [continue.dev](https://www.continue.dev) | **GitHub:** [github.com/continuedev/continue](https://github.com/continuedev/continue) | **Docs:** [docs.continue.dev](https://docs.continue.dev)

#### What It Is

Continue.dev is an open-source AI coding assistant that integrates directly into VS Code and JetBrains IDEs. With 26,000+ GitHub stars, it provides complete flexibility in choosing AI models and deployment options.

#### Key Features

**Three Interaction Modes:**
- **Chat:** Conversational coding assistance within the IDE
- **Plan:** Structured planning for complex changes
- **Agent:** Automates multi-file refactoring and large-scale modifications

**Model Flexibility:**
- Choose any AI model (GPT-4, Claude, Mistral, local LLMs)
- Deploy anywhere (cloud, on-premise, completely offline)
- No vendor lock-in

**CI/CD Integration (2025-2026):**
- Source-controlled AI checks on every pull request
- Standards as checks, enforced by AI, decided by humans
- Continue CLI for CI pipeline integration

#### IDE Support

- VS Code (primary)
- JetBrains IDEs (IntelliJ, PyCharm, WebStorm, etc.)
- CLI

#### Pricing

Free and open source. Some enterprise features may require paid plans.

#### Strengths
- IDE-native experience (VS Code + JetBrains)
- Full model flexibility and provider independence
- Open source with active community
- CI/CD integration for automated code quality
- Can run fully offline with local models

#### Limitations
- Smaller feature set compared to Cursor or Claude Code
- IDE extension model means less deep integration than purpose-built editors
- Agent mode less mature than competitors
- No standalone CLI experience (relies on IDE)

---

### CLI Agent Comparison Table

| Feature | Claude Code | Codex CLI | Gemini CLI | Cursor | OpenCode | Windsurf | Aider | Continue.dev |
|---------|-------------|-----------|------------|--------|----------|----------|-------|-------------|
| **Type** | CLI | CLI | CLI | IDE | CLI/Desktop/IDE | IDE | CLI | IDE Extension |
| **Open Source** | No | Yes (Apache 2.0) | Yes | No | Yes (MIT) | No | Yes | Yes |
| **Language** | Node.js | Rust | TypeScript | Electron | Go | Electron | Python | TypeScript |
| **MCP Support** | Deep | Yes | Yes | Yes | Limited | Limited | No | Limited |
| **Multi-Agent** | Up to 10 subagents | Yes (v2) | Preview | Agent mode | No | Cascade | Architect mode | Agent mode |
| **Git Integration** | Yes | Yes | Yes | Yes | Yes | Yes | Core design | Yes |
| **Model Providers** | Anthropic only | OpenAI only | Google only | Multi-provider | 75+ providers | Proprietary | 75+ providers | Any provider |
| **Free Tier** | No (Pro $20/mo min) | Plus $20/mo min | Yes (generous) | Yes (limited) | Yes (fully free) | Yes (25 credits) | Yes (fully free) | Yes (fully free) |
| **Context Window** | Up to 1M | Up to 1M | Up to 1M | Varies by model | Varies by model | Varies | Varies by model | Varies by model |
| **Worktrees** | Yes | No | No | No | No | No | No | No |
| **Hooks System** | 14+ triggers | Limited | No | No | No | No | No | No |
| **Skills/Plugins** | Yes | Config-based | Preview | Extensions | No | No | No | Extensions |

---

## Section 2: AI Agent Frameworks & SDKs

### Anthropic Agent SDK

**Docs:** [platform.claude.com/docs/en/agent-sdk/overview](https://platform.claude.com/docs/en/agent-sdk/overview) | **GitHub (TS):** [github.com/anthropics/claude-agent-sdk-typescript](https://github.com/anthropics/claude-agent-sdk-typescript)

#### What It Is

The Claude Agent SDK (renamed from Claude Code SDK in late 2025) packages Claude Code's agent loop, built-in tools, and context management as a programmable library for Python and TypeScript. It enables agents that go far beyond code -- email assistants, research agents, customer support bots, finance analyzers.

#### Architecture

The SDK ships Claude Code as a library. The agent loop, tools, context management -- all programmable. Built around four core concepts:

1. **Tools:** Functions your agent can call. Built-in tools include Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, AskUserQuestion. You can define custom tools.
2. **Hooks:** Lifecycle callbacks at key moments: before thinking, after tool choice, before tool execution, and on finish.
3. **MCP Servers:** Connect to external services with a single configuration line. Deepest MCP integration of any framework.
4. **Subagents:** Spawn child agents with their own system prompts, tools, and models.

#### Current Versions (March 2026)

- Python: v0.1.48
- TypeScript/Node.js: v0.2.71

#### Code Example

```typescript
import { Agent } from '@anthropic-ai/claude-agent-sdk';

const agent = new Agent({
  model: 'claude-sonnet-4-6-20260301',
  systemPrompt: 'You are a helpful code reviewer.',
  tools: ['Read', 'Glob', 'Grep'],  // Built-in tools
  mcpServers: {
    github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }
  },
  hooks: {
    beforeToolUse: async (tool, params) => {
      console.log(`About to use: ${tool}`);
      return true; // allow
    }
  }
});

const result = await agent.run('Review the latest PR for security issues');
```

#### Strengths
- Ships the exact tools that power Claude Code
- Deepest MCP integration of any framework
- Subagent support with model isolation
- Built-in tools for file operations, search, web access
- Production-tested (powers Claude Code itself)

#### Limitations
- Python and TypeScript SDKs are not at feature parity (SessionStart/SessionEnd hooks are TypeScript-only as callbacks; Python only supports shell command hooks)
- No built-in persistence layer -- sessions don't survive server restarts
- Tied to Anthropic models
- Relatively new (still pre-1.0)

---

### OpenAI Agents SDK

**Docs:** [openai.github.io/openai-agents-python](https://openai.github.io/openai-agents-python/) | **GitHub:** [github.com/openai/openai-agents-python](https://github.com/openai/openai-agents-python)

#### What It Is

Released March 2025, the OpenAI Agents SDK is a lightweight, Python-first open-source framework for orchestrating agentic workflows. It is provider-agnostic with documented paths for non-OpenAI models.

#### Core Concepts

**Agents:**
Define agents with instructions, tools, and model configuration. Each agent is a self-contained unit that can process requests and delegate work.

**Handoffs:**
Agents delegate tasks to other specialized agents. Represented as tools to the LLM, handoffs enable scenarios like customer support apps with separate agents for order status, refunds, and FAQs.

**Guardrails:**
Input/output validation and safety checks that run in parallel with agent execution. They fail fast when checks don't pass:
- Input guardrails: run only for the first agent in the chain
- Output guardrails: run only for the agent producing final output
- Parallel execution is the default (best latency)

**Tracing:**
Built-in tracing collects comprehensive records: LLM generations, tool calls, handoffs, guardrails, and custom events. The Traces dashboard provides debugging, visualization, and production monitoring.

#### Code Example

```python
from agents import Agent, Runner, handoff

triage_agent = Agent(
    name="Triage Agent",
    instructions="Route customer queries to the right specialist.",
    handoffs=[
        handoff(refund_agent, "Customer wants a refund"),
        handoff(order_agent, "Customer asking about order status"),
    ]
)

refund_agent = Agent(
    name="Refund Agent",
    instructions="Process refund requests.",
    tools=[process_refund, lookup_order]
)

result = await Runner.run(triage_agent, "I want to return my order #12345")
```

#### Strengths
- Clean, intuitive API design
- First-class handoff pattern for multi-agent delegation
- Parallel guardrails for safety without latency penalty
- Built-in tracing and observability
- Provider-agnostic (documented non-OpenAI model support)

#### Limitations
- Python-first (TypeScript support is secondary)
- Less mature than LangGraph for complex workflows
- Limited built-in tool library compared to Anthropic Agent SDK
- Guardrails are relatively basic compared to dedicated safety frameworks

---

### LangChain / LangGraph

**Website:** [langchain.com](https://www.langchain.com) | **LangGraph:** [langchain.com/langgraph](https://www.langchain.com/langgraph) | **GitHub:** [github.com/langchain-ai](https://github.com/langchain-ai)

#### What It Is

LangChain and LangGraph reached v1.0 milestones, representing the most mature agent framework ecosystem. LangGraph is the lower-level framework and runtime for highly custom, controllable, production-grade agents. LangChain provides higher-level abstractions and integrations.

#### LangGraph Architecture

LangGraph uses a **graph-based architecture** where each node represents an agent or process step:

- **Durable State:** Agent execution state persists automatically. Server restarts or workflow interruptions resume exactly where they left off
- **Built-in Persistence:** Save and resume agent workflows without custom database logic (multi-day approval processes, background jobs)
- **Human-in-the-Loop:** First-class API support for pausing execution for human review, modification, or approval
- **Fine-Grained Control:** Control over flow, retries, error handling, branching, and conditional logic

#### Recent 2025-2026 Developments

- **Open Agent Platform:** No-code agent builder for non-developers (select MCP tools, customize prompts, select models, connect data sources)
- **LangGraph Studio v2:** Local agent IDE for visualizing and debugging agent interactions (no desktop app required)
- **LangSmith Observability:** Agent-specific metrics with tool calling and trajectory tracking
- **DeepAgents:** Agent harness with planning tools, filesystem backend, and subagent spawning

#### When to Use LangGraph vs Alternatives

| Scenario | Recommended |
|----------|------------|
| Complex multi-step workflows with state | LangGraph |
| Simple single-agent tasks | OpenAI Agents SDK or direct API calls |
| Need human-in-the-loop approval | LangGraph |
| Quick prototype | CrewAI or direct API calls |
| Production with monitoring | LangGraph + LangSmith |

#### Strengths
- Most mature agent framework (1.0 stable)
- Durable state and persistence built-in
- Strong observability with LangSmith
- Graph-based architecture for complex workflows
- MCP integration support
- Massive ecosystem of integrations

#### Limitations
- Steeper learning curve than simpler frameworks
- Can be over-engineered for simple use cases
- Abstraction layers can make debugging harder
- Performance overhead compared to direct API calls

---

### CrewAI

**Website:** [crewai.com](https://crewai.com) | **GitHub:** [github.com/crewAIInc/crewAI](https://github.com/crewaiinc/crewai) | **Docs:** [docs.crewai.com](https://docs.crewai.com)

#### What It Is

CrewAI is a lean, lightning-fast Python framework for multi-agent orchestration, built entirely from scratch (no LangChain dependency). It uses role-based agent collaboration where agents have defined roles, goals, and backstories.

#### Architecture: Crews + Flows

**Crews:**
Teams of autonomous AI agents working through role-based collaboration. Each agent has a role, goal, backstory, optional LLM specification, memory, and tools.

**Flows (Production Architecture):**
Event-driven workflows for enterprise and production systems. Flows provide:
- Simplified workflow creation (chain multiple Crews and tasks)
- State management (share state between tasks)
- Event-driven architecture for dynamic, responsive workflows
- Conditional logic, loops, and branching

#### Code Example

```python
from crewai import Agent, Task, Crew, Flow
from crewai.tools import WebsiteSearchTool

# Define agents with roles
researcher = Agent(
    role="Research Analyst",
    goal="Find comprehensive data on the topic",
    backstory="Expert analyst with 10 years of experience",
    tools=[WebsiteSearchTool()],
    llm="claude-sonnet-4-6"
)

writer = Agent(
    role="Content Writer",
    goal="Write compelling, accurate content",
    backstory="Award-winning technical writer"
)

# Define tasks
research_task = Task(
    description="Research the latest trends in AI coding tools",
    agent=researcher,
    expected_output="Detailed research report with sources"
)

writing_task = Task(
    description="Write a blog post based on the research",
    agent=writer,
    expected_output="SEO-optimized 2000-word blog post"
)

# Create and run crew
crew = Crew(
    agents=[researcher, writer],
    tasks=[research_task, writing_task],
    process="sequential"  # or "parallel", "conditional"
)

result = crew.kickoff()
```

#### Key Features
- **Memory Systems:** Short-term, long-term, entity, and contextual memory shared across agents
- **100s of Built-in Tools:** Web search, website interaction, vector database queries, and more
- **Real-time Tracing:** Detailed monitoring of every agent step
- **Process Types:** Sequential, parallel, and conditional task execution
- **2-3x Faster:** Benchmarks show CrewAI executing multi-agent workflows 2-3x faster than comparable frameworks

#### Strengths
- Fastest multi-agent framework in benchmarks
- Intuitive role-based agent design
- Dual architecture (Crews for autonomy, Flows for determinism)
- Rich memory systems
- No LangChain dependency

#### Limitations
- Python-only
- Less flexible than LangGraph for highly custom workflows
- Fewer built-in persistence options
- Enterprise features require the hosted platform

---

### AutoGen / Microsoft Agent Framework

**Website:** [microsoft.github.io/autogen](https://microsoft.github.io/autogen/stable/index.html) | **GitHub:** [github.com/microsoft/autogen](https://github.com/microsoft/autogen) | **MS Agent Framework:** [learn.microsoft.com/en-us/agent-framework](https://learn.microsoft.com/en-us/agent-framework/overview/)

#### What It Is

AutoGen was Microsoft's pioneering multi-agent framework. In October 2025, Microsoft merged AutoGen with Semantic Kernel to create the **Microsoft Agent Framework** -- the direct, production-ready successor. Microsoft targets Agent Framework 1.0 GA by end of Q1 2026.

#### AutoGen v0.4 Architecture

The v0.4 release was a complete redesign with:

- **Asynchronous Messaging:** Event-driven and request/response interaction patterns
- **Modular Components:** Pluggable custom agents, tools, memory, and models
- **Scalable & Distributed:** Complex agent networks across organizational boundaries
- **Cross-Language:** Python and .NET support, with more languages in development

#### Microsoft Agent Framework (Successor)

The Agent Framework combines AutoGen's multi-agent capabilities with Semantic Kernel's enterprise features:
- Production-grade support commitments
- Full enterprise readiness certification
- Stable, versioned APIs
- Azure integration

#### Migration Path

If new to AutoGen, Microsoft recommends starting with the Agent Framework directly. Migration guides are available for existing AutoGen users.

#### Strengths
- Enterprise-grade with Microsoft backing
- Cross-language support (Python, .NET)
- Distributed agent networks
- Deep Azure integration
- Active development and support

#### Limitations
- Complex migration path from AutoGen to Agent Framework
- Heavier than lightweight alternatives
- Microsoft ecosystem bias
- Learning curve for the combined framework

---

### Vercel AI SDK

**Website:** [ai-sdk.dev](https://ai-sdk.dev) | **GitHub:** [github.com/vercel/ai](https://github.com/vercel/ai) | **npm:** `ai`

#### What It Is

The Vercel AI SDK is a unified TypeScript SDK for building AI-powered applications and agents with React, Next.js, Vue, Svelte, Node.js, and more. It's the standard for frontend AI development, providing seamless streaming, multi-provider support, and React integration.

#### Core API

**Server-Side Functions:**
- `generateText()` -- Generate complete text responses
- `streamText()` -- Stream text responses in real-time
- `generateObject()` -- Generate structured JSON objects
- `streamObject()` -- Stream structured objects

**Client-Side Hooks (React):**
- `useChat()` -- Real-time streaming chat messages
- `useCompletion()` -- Text completion handling
- `useObject()` -- Consume streamed JSON objects
- `useAssistant()` -- Interactive assistant features

**Agent Capabilities (AI SDK 6, 2026):**
- `ToolLoopAgent` class for production-ready tool execution loops
- Human-in-the-loop tool approval
- Unified `generateObject` and `generateText` for multi-step tool calling with structured output
- DevTools for debugging agent behavior

#### Multi-Provider Support

Switch providers with one line of code:

```typescript
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';

// Switch between providers seamlessly
const result = await generateText({
  model: anthropic('claude-sonnet-4-6-20260301'),
  // model: openai('gpt-5.2'),
  // model: google('gemini-3.1-pro'),
  prompt: 'Explain quantum computing',
});
```

#### AI SDK 6 Features (Late 2025)

- Unified structured output with tool calling
- ToolLoopAgent for complete tool execution loops
- Human-in-the-loop approval workflows
- DevTools for debugging
- Experimental text-to-speech and transcription support

#### Strengths
- De facto standard for frontend AI development
- Seamless React/Next.js integration
- Multi-provider with single API
- Real-time streaming built-in
- Excellent TypeScript support
- Free and open source

#### Limitations
- TypeScript/JavaScript only
- Frontend-focused (less suitable for backend-only agents)
- Provider support varies (not all features available for all providers)
- Rapid major version changes (SDK 4 -> 5 -> 6 in ~18 months)

---

### Framework Comparison Table

| Feature | Anthropic Agent SDK | OpenAI Agents SDK | LangGraph | CrewAI | AutoGen/MS Agent | Vercel AI SDK |
|---------|-------------------|-------------------|-----------|--------|-----------------|---------------|
| **Language** | Python, TypeScript | Python, TypeScript | Python, JS | Python | Python, .NET | TypeScript |
| **License** | Open source | Open source | Open source | Open source + hosted | Open source | Open source |
| **Multi-Agent** | Subagents | Handoffs | Graph nodes | Crews + Flows | Conversations | ToolLoopAgent |
| **MCP Support** | Deep (native) | Limited | Yes | Yes | Limited | No |
| **Built-in Tools** | Rich (Read, Write, Bash, etc.) | Basic | Via integrations | 100s built-in | Via plugins | Provider tools |
| **State Persistence** | No (build yourself) | No | Yes (durable) | Yes (memory systems) | Yes | No |
| **Observability** | Hooks | Tracing dashboard | LangSmith | Built-in tracing | Azure Monitor | DevTools |
| **Human-in-the-Loop** | Via hooks | Guardrails | First-class | Via Flows | Yes | Tool approval |
| **Best For** | Claude-powered agents | OpenAI-ecosystem agents | Complex workflows | Multi-agent teams | Enterprise/Azure | Frontend AI apps |
| **Maturity** | Pre-1.0 | Pre-1.0 | 1.0 stable | Mature | Transitioning to AF | 6.0 |

---

## Section 3: Model Context Protocol (MCP)

### What MCP Is and Why It Matters

**Website:** [modelcontextprotocol.io](https://modelcontextprotocol.io) | **Spec:** [modelcontextprotocol.io/specification](https://modelcontextprotocol.io/specification/2025-11-25)

The Model Context Protocol (MCP) is an open standard introduced by Anthropic in November 2024 to standardize how AI systems integrate with external tools, data sources, and services. It serves the same role for AI tools that the Language Server Protocol (LSP) serves for programming language support in editors.

**Why it matters:**
- Before MCP: connecting an AI agent to 10 business tools required 10 custom integrations maintained across provider updates (multiplicative complexity)
- With MCP: each tool gets one server that works with all compliant agents (additive complexity)
- Integration cost drops 60-70%

**Governance:**
In December 2025, Anthropic donated MCP to the **Agentic AI Foundation (AAIF)**, a directed fund under the Linux Foundation, co-founded by Anthropic, Block, and OpenAI.

### MCP Architecture

MCP uses a **client-server architecture** inspired by LSP, with JSON-RPC 2.0 as the message format.

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   AI Application │────>│  MCP Client  │────>│   MCP Server    │
│  (Claude Code,   │     │              │     │  (GitHub, Slack, │
│   Cursor, etc.)  │<────│              │<────│   Database, etc.)│
└─────────────────┘     └──────────────┘     └─────────────────┘
```

**Components:**
- **Host:** The AI application (Claude Code, Cursor, etc.)
- **Client:** Lives inside the host; maintains 1:1 connection with a server
- **Server:** Provides context and capabilities (tools, resources, prompts)
- **Transport:** Communication channel between client and server

**Transport Methods:**
- **stdio:** Local process communication via standard input/output. Used for Filesystem, PostgreSQL, Playwright servers that need local access
- **Streamable HTTP:** Remote server over the internet. Used for cloud services like GitHub, Slack, Sentry. Enables production deployments (added in 2025 spec)

**Server Capabilities:**
- **Tools:** Functions the AI can call (e.g., `create_issue`, `query_database`)
- **Resources:** Data the AI can read (e.g., file contents, database schemas)
- **Prompts:** Reusable prompt templates

### Popular MCP Servers

| Server | Category | Key Capabilities |
|--------|----------|-----------------|
| **GitHub** | Developer Tools | Repository management, PR operations, issue tracking, code search |
| **Slack** | Communication | Search messages, send messages, manage canvases, user management |
| **PostgreSQL** | Database | Read-only database access, schema inspection, SQL queries |
| **SQLite** | Database | Database interaction, business intelligence |
| **Filesystem** | Local | File reading, writing, directory operations (official Anthropic server) |
| **Playwright** | Testing | Browser automation, screenshot capture, web testing |
| **Sentry** | Monitoring | Error tracking, issue investigation, performance monitoring |
| **Google Drive** | Storage | File access, search, document management |
| **Brave Search** | Search | Web search with privacy focus |
| **Memory** | AI | Persistent memory storage for AI agents |

**Ecosystem Scale (March 2026):**
- MCP Registry: ~2,000 entries (407% growth since September 2025 launch)
- Total downloads: 97 million across all providers
- All major providers on board: Anthropic, OpenAI, Microsoft, Google, Amazon

### Building MCP Servers

MCP servers can be built in under 50 lines of code using official SDKs for TypeScript and Python.

**TypeScript Example:**

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new McpServer({
  name: 'my-weather-server',
  version: '1.0.0',
});

// Define a tool
server.tool(
  'get_weather',
  'Get current weather for a city',
  { city: { type: 'string', description: 'City name' } },
  async ({ city }) => {
    const weather = await fetchWeather(city);
    return { content: [{ type: 'text', text: JSON.stringify(weather) }] };
  }
);

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Python Example:**

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-weather-server")

@mcp.tool()
def get_weather(city: str) -> str:
    """Get current weather for a city."""
    weather = fetch_weather(city)
    return json.dumps(weather)

mcp.run()
```

### MCP Adoption Across Tools

| Tool | MCP Support Level | Configuration |
|------|------------------|---------------|
| Claude Code | Deep (native) | `.mcp.json` or `claude mcp add` |
| Codex CLI | Yes | `~/.codex/config.toml` or `codex mcp` |
| Gemini CLI | Yes | CLI configuration |
| Cursor | Yes | Settings/Extensions |
| Windsurf | Limited | Extension-based |
| Continue.dev | Limited | Configuration file |
| LangGraph | Yes | Programmatic |
| CrewAI | Yes | Tool integration |

### 2026 MCP Roadmap

Key priorities for the MCP specification in 2026:
- **Stateless HTTP:** Better compatibility with load balancers and horizontal scaling
- **Server Discovery:** Standard way for registries/crawlers to learn what a server does without connecting
- **Authentication Standards:** Unified auth patterns across servers
- **Performance:** Addressing latency in production deployments

---

## Section 4: AI Models Comparison

### Claude Models (Anthropic)

**Docs:** [platform.claude.com/docs/en/about-claude/models/overview](https://platform.claude.com/docs/en/about-claude/models/overview)

**Current lineup (as of July 2026):** the Claude 5 family — **Fable 5**
(`claude-fable-5`) and **Sonnet 5** (`claude-sonnet-5`) — plus **Opus 4.8**
(`claude-opus-4-8`) and **Haiku 4.5** (`claude-haiku-4-5`). Specs and pricing
for the 5-family move fast; check the docs link above rather than trusting a
snapshot table.

**Roles:**
- **Fable 5:** frontier reasoning, Agent Teams, hardest architecture/debugging work
- **Sonnet 5:** day-to-day coding and production agent workloads, best cost/performance
- **Opus 4.8:** previous-generation frontier; also powers Claude Code fast mode (faster output, same Opus quality)
- **Haiku 4.5:** high-volume pipelines, classification, extraction, simple formatting

**Historical snapshot (April 2, 2026 — retained for reference):**

| Model | Context Window | Max Output | Input $/1M | Output $/1M | Knowledge Cutoff |
|-------|---------------|------------|------------|-------------|-----------------|
| **Opus 4.6** | 1,000,000 | 32,768 | $5.00 | $25.00 | Early 2026 |
| **Sonnet 4.6** | 200,000 | 16,384 | $3.00 | $15.00 | Early 2026 |
| **Haiku 4.5** | 200,000 | 8,192 | $1.00 | $5.00 | Mid 2025 |

- **SWE-bench Verified:** Opus 4.6 = 80.8%, Sonnet 4.6 = 79.6%, Haiku 4.5 = 73.3%
- **GPQA Diamond:** Opus 4.6 leads by 17.2 points over Sonnet (largest gap on any benchmark)
- **OSWorld-Verified:** Opus 4.6 = 72.7%, Sonnet 4.6 = 72.5%

---

### OpenAI Models

**Docs:** [platform.openai.com/docs/models](https://platform.openai.com/docs/models) | **Pricing:** [developers.openai.com/api/docs/pricing](https://developers.openai.com/api/docs/pricing)

| Model | Context Window | Max Output | Input $/1M | Output $/1M | Released |
|-------|---------------|------------|------------|-------------|---------|
| **GPT-5.4** | 1,000,000 | 128,000 | ~$2.00 | ~$15.00 | Mar 2026 |
| **GPT-5.2** | 400,000 | 128,000 | $1.75 | $14.00 | Dec 2025 |
| **GPT-5.2 Pro** | 400,000 | 128,000 | $21.00 | $168.00 | Dec 2025 |
| **GPT-4.1** | 1,047,576 | 32,768 | $2.00 | $8.00 | Apr 2025 |
| **GPT-4.1 Mini** | 1,047,576 | 32,768 | $0.40 | $1.60 | Apr 2025 |
| **GPT-4o** | 128,000 | 16,384 | $2.50 | $10.00 | May 2024 |
| **GPT-4o Mini** | 128,000 | 16,384 | $0.15 | $0.60 | Jul 2024 |
| **o3** | 200,000 | 100,000 | $2.00 | $8.00 | Jan 2025 |
| **o4-mini** | 200,000 | 100,000 | $1.10 | $4.40 | Apr 2025 |

**Key Notes:**
- GPT-4o, GPT-4.1, GPT-4.1 Mini, o4-mini, and GPT-5 (Instant/Thinking) retired from ChatGPT as of Feb 13, 2026. API access unchanged.
- GPT-5.4 is the latest frontier model (March 2026) with native computer use and 1M context
- GPT-5.2 modes: Instant (speed), Thinking (analytical depth), Pro (maximum capability)

**Best Use Cases:**
- **GPT-5.4:** Frontier tasks, computer use, maximum capability
- **GPT-5.2:** General-purpose flagship, balanced performance
- **GPT-4.1:** Cost-effective for 1M context window tasks
- **o3/o4-mini:** Mathematical reasoning, logic puzzles, code analysis
- **GPT-4o Mini:** High-volume, cost-sensitive applications

---

### Google Gemini Models

**Docs:** [ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)

| Model | Context Window | Max Output | Input $/1M | Output $/1M | Released |
|-------|---------------|------------|------------|-------------|---------|
| **Gemini 3.1 Pro Preview** | 1,000,000 | 65,536 | $2.00 ($4.00 >200K) | $12.00 ($18.00 >200K) | Feb 2026 |
| **Gemini 3 Pro** | 1,000,000 | 32,768 | $2.00 | $12.00 | Late 2025 |
| **Gemini 2.5 Pro** | 1,000,000 | 65,536 | $1.00 | $10.00 | May 2025 |
| **Gemini 2.5 Flash** | 1,000,000 | 65,536 | $0.30 | $2.50 | Jun 2025 |
| **Gemini 2.5 Flash Lite** | 1,000,000 | 65,536 | $0.05 | $0.30 | 2025 |

**Benchmarks:**
- **Gemini 3.1 Pro Preview:** 80.6% SWE-bench Verified, 94.3% GPQA Diamond, 77.1% ARC-AGI-2
- **Intelligence Index:** 57 (tied for #1 with GPT-5.4)
- **Speed:** 123.8 tokens/sec (3.1 Pro), 201 tokens/sec (2.5 Flash)

**Best Use Cases:**
- **Gemini 3.1 Pro:** Frontier reasoning, complex code generation, scientific analysis
- **Gemini 2.5 Pro:** Production workloads requiring 1M context
- **Gemini 2.5 Flash:** Cost-effective for content generation, summarization, classification (1/4 the cost of Pro)
- **Gemini 2.5 Flash Lite:** Ultra-low-cost high-volume tasks

---

### Meta Llama 4 Models

**Website:** [llama.com/models/llama-4](https://www.llama.com/models/llama-4/) | **Open Weight (Free)**

| Model | Context Window | Parameters | Typical Input $/1M | Typical Output $/1M |
|-------|---------------|------------|-------------------|---------------------|
| **Llama 4 Scout** | 10,000,000 | 109B (17B active, MoE) | $0.08-0.11 | $0.30-0.34 |
| **Llama 4 Maverick** | 1,000,000 | 400B (17B active, MoE) | $0.17-0.50 | $0.60-0.77 |
| **Llama 4 Behemoth** | TBD | 2T (288B active) | TBD | TBD (upcoming) |

**Key Features:**
- **Open Weight:** Free to use, self-host or use via third-party providers (Groq, Together, Fireworks, etc.)
- **Mixture of Experts (MoE):** Only a fraction of parameters are active per token, enabling efficient inference
- **Scout's 10M Context:** The largest context window of any production model (equivalent to ~15,000 pages)
- **Maverick's 1M Context:** Strong general-purpose model competitive with proprietary alternatives
- Released April 2025

**Best Use Cases:**
- **Scout:** Massive document analysis, entire codebase understanding, long-form research
- **Maverick:** General-purpose tasks where you need open-weight flexibility
- **Self-Hosting:** Organizations needing data sovereignty or custom fine-tuning

---

### Alibaba Qwen Models

**Docs:** [alibabacloud.com/help/en/model-studio/models](https://www.alibabacloud.com/help/en/model-studio/models)

| Model | Context Window | Input $/1M | Output $/1M | Released |
|-------|---------------|------------|-------------|---------|
| **Qwen 3.6 Plus Preview** | 1,000,000 | Free (preview) | Free (preview) | Mar 2026 |
| **Qwen3.5 Flash** | 1,000,000 | $0.10 | TBD | Feb 2026 |
| **Qwen3 Coder 480B A35B** | 262,000 | $0.22 | $0.90 | Jul 2025 |
| **Qwen3 Max** | 262,000 | $0.78 | $3.90 | Sep 2025 |
| **Qwen3 8B** | 41,000 | $0.05 | $0.40 | Apr 2025 |

**Key Features:**
- Widely considered the "king of coding and math" among open-weight models
- Qwen3.5 series uses hybrid attention achieving near-linear compute scaling with 1M context
- Qwen 3.6 Plus Preview: always-on chain-of-thought reasoning, native function calling, 65K output tokens
- Many models available as open-weight for self-hosting

**Best Use Cases:**
- **Qwen3 Coder:** Code generation, refactoring, mathematical problem-solving
- **Qwen3.5 Flash:** Budget-conscious production workloads at frontier-adjacent quality
- **Qwen3 8B:** Local deployment, edge computing, low-latency applications
- **Self-Hosting:** Best price-to-performance ratio in the open-weight space

---

### DeepSeek Models

**Docs:** [api-docs.deepseek.com](https://api-docs.deepseek.com/quick_start/pricing)

| Model | Context Window | Parameters | Input $/1M | Output $/1M |
|-------|---------------|------------|------------|-------------|
| **DeepSeek-V3.2 (deepseek-chat)** | 128,000-163,840 | 671B (37B active) | $0.26 | $0.38 |
| **DeepSeek-V3.1 (thinking mode)** | 128,000 | 671B (37B active) | Higher | Higher |
| **DeepSeek-R1 (deepseek-reasoner)** | 128,000 | 671B (37B active) | ~$0.55 | ~$1.68 |

**Key Features:**
- **V3.1 Hybrid Model:** Combines V3 and R1 into a single model. Switch between "thinking" (chain-of-thought like R1) and "non-thinking" (direct answers like V3) by changing the chat template
- **V3.2:** Introduces DeepSeek Sparse Attention (DSA) for reduced training/inference cost while preserving long-context quality
- **R1:** Extended reasoning with up to 32K reasoning tokens, powerful for math, logic, and code
- **MoE Architecture:** 671B total parameters with only 37B active per token
- Open-weight models available for self-hosting

**Upcoming:**
- DeepSeek V4 expected mid-2026: trillion-parameter scale, enhanced reasoning, targeting 1M token context

**Best Use Cases:**
- **V3.2 (deepseek-chat):** Budget-conscious general-purpose tasks (cheapest high-quality API)
- **R1 (deepseek-reasoner):** Mathematical proofs, logic puzzles, code debugging requiring step-by-step reasoning
- **V3.1 thinking mode:** When you need both general and reasoning capabilities in one model

---

### Mistral Models

**Website:** [mistral.ai](https://mistral.ai) | **Pricing:** [iamistral.com/pricing](https://iamistral.com/pricing/)

| Model | Context Window | Input $/1M | Output $/1M | Specialty |
|-------|---------------|------------|-------------|-----------|
| **Mistral Large 3** | 128,000 | $0.50 | $6.00 | Complex reasoning, multilingual |
| **Codestral** | 256,000 | $0.20 | $0.60 | Code generation, completion, refactoring |
| **Mistral Small** | 128,000 | $0.10 | $0.30 | Fast, cost-effective tasks |

**Key Features:**
- **Codestral:** Code-focused model trained for multilingual programming, debugging, and developer productivity. 256K context window at extremely low cost
- **Mistral Large 3:** 40% cheaper on output than GPT-5 ($6 vs $10), 60% cheaper than Claude Sonnet 4.6 ($6 vs $15)
- **European AI:** Headquartered in Paris, GDPR-compliant EU hosting
- Founded by former Meta and DeepMind researchers

**Best Use Cases:**
- **Codestral:** Code completion, IDE integrations (optimized for speed at coding tasks)
- **Mistral Large 3:** Cost-effective reasoning for multilingual/European use cases
- **Mistral Small:** High-volume classification, extraction, simple generation

---

### Model Pricing Comparison Table

*Sorted by output cost (ascending). Prices per 1M tokens.*

| Model | Provider | Input $ | Output $ | Context | Notes |
|-------|----------|---------|----------|---------|-------|
| Gemini 2.5 Flash Lite | Google | $0.05 | $0.30 | 1M | Ultra-budget |
| Llama 4 Scout | Meta (via providers) | $0.08 | $0.30 | 10M | Open weight, self-hostable |
| Mistral Small | Mistral | $0.10 | $0.30 | 128K | Fast, GDPR-compliant |
| DeepSeek V3.2 | DeepSeek | $0.26 | $0.38 | 128K | Best budget option |
| Qwen3 8B | Alibaba | $0.05 | $0.40 | 41K | Open weight, local deployment |
| Codestral | Mistral | $0.20 | $0.60 | 256K | Code-specialized |
| GPT-4o Mini | OpenAI | $0.15 | $0.60 | 128K | Legacy, still available via API |
| Llama 4 Maverick | Meta (via providers) | $0.17 | $0.60 | 1M | Open weight |
| Qwen3 Coder | Alibaba | $0.22 | $0.90 | 262K | Code + math specialist |
| GPT-4.1 Mini | OpenAI | $0.40 | $1.60 | 1M | Cost-effective 1M context |
| DeepSeek R1 | DeepSeek | $0.55 | $1.68 | 128K | Reasoning specialist |
| Gemini 2.5 Flash | Google | $0.30 | $2.50 | 1M | Best value for 1M context |
| Qwen3 Max | Alibaba | $0.78 | $3.90 | 262K | Frontier-class open weight |
| o4-mini | OpenAI | $1.10 | $4.40 | 200K | Reasoning, legacy API |
| Haiku 4.5 | Anthropic | $1.00 | $5.00 | 200K | Fast, high-volume |
| Mistral Large 3 | Mistral | $0.50 | $6.00 | 128K | Multilingual reasoning |
| GPT-4.1 | OpenAI | $2.00 | $8.00 | 1M | Legacy flagship |
| o3 | OpenAI | $2.00 | $8.00 | 200K | Reasoning specialist |
| Gemini 2.5 Pro | Google | $1.00 | $10.00 | 1M | Production workhorse |
| Gemini 3.1 Pro Preview | Google | $2.00 | $12.00 | 1M | Current frontier |
| GPT-5.2 | OpenAI | $1.75 | $14.00 | 400K | General flagship |
| Sonnet 4.6 | Anthropic | $3.00 | $15.00 | 200K | Best coding value |
| GPT-5.4 | OpenAI | ~$2.00 | ~$15.00 | 1M | Latest frontier |
| Opus 4.6 | Anthropic | $5.00 | $25.00 | 1M | Deep reasoning |

---

### Model Performance Comparison Table

*Based on key benchmarks as of March 2026.*

| Model | SWE-bench Verified | GPQA Diamond | Intelligence Index | Speed (tokens/sec) |
|-------|-------------------|-------------|-------------------|-------------------|
| Gemini 3.1 Pro Preview | 80.6% | 94.3% | 57 | 123.8 |
| GPT-5.4 | — | — | 57 | — |
| Claude Opus 4.6 | 80.8% | Best in class | 53 | ~80 |
| Claude Sonnet 4.6 | 79.6% | Opus - 17.2pts | 52 | ~120 |
| GPT-5.2 | — | — | ~50 | — |
| Gemini 2.5 Flash | — | — | 21 | 201 |
| Claude Haiku 4.5 | 73.3% | — | — | ~200+ |
| DeepSeek V3.2 | — | — | — | ~150 |

**Intelligence Index** from [Artificial Analysis](https://artificialanalysis.ai/leaderboards/models) -- composite benchmark score.

**Key Takeaways:**
1. **Best Overall Intelligence (March 2026):** Gemini 3.1 Pro and GPT-5.4 tied at 57
2. **Best Coding (SWE-bench):** Claude Opus 4.6 (80.8%) and Gemini 3.1 Pro (80.6%) near-tied
3. **Best Value for Coding:** Gemini 3.1 Pro ($2/$12) -- 80.6% SWE-bench at half the cost of Claude Sonnet
4. **Best Budget Option:** MiniMax M2.5 delivers 80.2% SWE-bench at $0.30/$1.20
5. **Best Speed:** Gemini 2.5 Flash (201 t/s) and Claude Haiku 4.5 (200+ t/s)
6. **Best for Reasoning:** Claude Opus 4.6 dominates GPQA Diamond by a wide margin
7. **Largest Context:** Llama 4 Scout at 10M tokens

---

## Sources & Official Documentation

### CLI-Based AI Coding Agents
- [Claude Code Documentation](https://code.claude.com/docs)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)
- [Claude Pricing Plans](https://claude.com/pricing)
- [OpenAI Codex CLI](https://developers.openai.com/codex/cli)
- [Codex CLI Features](https://developers.openai.com/codex/cli/features)
- [Codex Pricing](https://developers.openai.com/codex/pricing)
- [Google Gemini CLI (GitHub)](https://github.com/google-gemini/gemini-cli)
- [Gemini CLI Documentation](https://geminicli.com/docs/)
- [Gemini CLI Quotas & Pricing](https://geminicli.com/docs/resources/quota-and-pricing/)
- [Cursor Features](https://cursor.com/features)
- [Cursor Models & Pricing](https://cursor.com/docs/models-and-pricing)
- [OpenCode Documentation](https://opencode.ai/docs/)
- [OpenCode GitHub](https://github.com/sst/opencode)
- [Windsurf Cascade](https://windsurf.com/cascade)
- [Windsurf Pricing](https://windsurf.com/pricing)
- [Aider Documentation](https://aider.chat/docs/)
- [Aider GitHub](https://github.com/Aider-AI/aider)
- [Continue.dev Documentation](https://docs.continue.dev/)
- [Continue.dev GitHub](https://github.com/continuedev/continue)

### Agent Frameworks & SDKs
- [Anthropic Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Anthropic Agent SDK TypeScript (GitHub)](https://github.com/anthropics/claude-agent-sdk-typescript)
- [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK (GitHub)](https://github.com/openai/openai-agents-python)
- [LangGraph Documentation](https://www.langchain.com/langgraph)
- [LangChain & LangGraph 1.0 Announcement](https://blog.langchain.com/langchain-langgraph-1dot0/)
- [CrewAI Documentation](https://docs.crewai.com)
- [CrewAI Flows](https://docs.crewai.com/en/concepts/flows)
- [AutoGen Documentation](https://microsoft.github.io/autogen/stable/index.html)
- [Microsoft Agent Framework](https://learn.microsoft.com/en-us/agent-framework/overview/)
- [Vercel AI SDK](https://ai-sdk.dev/docs/introduction)
- [Vercel AI SDK 6 Blog Post](https://vercel.com/blog/ai-sdk-6)

### Model Context Protocol (MCP)
- [MCP Specification (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Example Servers](https://modelcontextprotocol.io/examples)
- [MCP Servers Repository (GitHub)](https://github.com/modelcontextprotocol/servers)
- [2026 MCP Roadmap](http://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [MCP Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)

### AI Models
- [Anthropic Models Overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- [Claude Opus 4.6 Announcement](https://www.anthropic.com/news/claude-opus-4-6)
- [OpenAI API Pricing](https://developers.openai.com/api/docs/pricing)
- [GPT-5.2 Model Documentation](https://platform.openai.com/docs/models/gpt-5.2)
- [Google Gemini API Models](https://ai.google.dev/gemini-api/docs/models)
- [Llama 4 Models](https://www.llama.com/models/llama-4/)
- [DeepSeek API Pricing](https://api-docs.deepseek.com/quick_start/pricing)
- [Artificial Analysis LLM Leaderboard](https://artificialanalysis.ai/leaderboards/models)

### Comparison & Analysis
- [Understanding Claude Code's Full Stack](https://alexop.dev/posts/understanding-claude-code-full-stack/)
- [Inside Claude Code Architecture](https://www.penligent.ai/hackinglabs/inside-claude-code-the-architecture-behind-tools-memory-hooks-and-mcp/)
- [AI Dev Tool Power Rankings March 2026](https://blog.logrocket.com/ai-dev-tool-power-rankings/)
- [Best AI Model for Coding 2026](https://www.morphllm.com/best-ai-model-for-coding)
- [AI API Pricing Comparison 2026](https://intuitionlabs.ai/articles/ai-api-pricing-comparison-grok-gemini-openai-claude)
- [LLM Context Window Comparison 2026](https://www.morphllm.com/llm-context-window-comparison)

---

*This document is maintained as a living reference. Model pricing and benchmarks change frequently -- verify against official documentation for production decisions.*
