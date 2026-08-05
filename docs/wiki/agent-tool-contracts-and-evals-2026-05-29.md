# Agent Tool Contracts And Evals Research Note

Date: 2026-05-29
Status: time-sensitive research note plus implementation standard pointer
Canonical agent doc: `docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md`
App wiki article id: `agent-tool-contracts-and-evals-for-agents`

## Summary

The next layer for Underground Circle agent reliability is a stricter tool
contract and eval standard. Browser, desktop, app, MCP, bridge, and
connected-agent tools should not be thin wrappers around APIs. They should be
agent-facing contracts with clear names, bounded schemas, typed results,
approval metadata, redaction rules, recovery options, and negative-path evals.

## Product Direction

When chat fails during a browser, desktop, app, or bridge task, the recovery
layer should not have to parse free-form errors. Tools should return structured
status values and recovery fields that the chat can render as options:

- retry after fresh evidence;
- request user unblock;
- repair or reconnect the bridge;
- switch surface;
- hand off adapter buildout to a connected agent;
- stop and show details.

Those options only work well if the original tool contract captures risk,
idempotency, approval requirements, and evidence.

## Research Findings

- Anthropic's tool guidance says tools should be designed for agent use, with
  clear names, descriptions, namespaces, response context, and real evaluations.
- Anthropic's agent guidance reinforces the need for environmental feedback,
  checkpoints, and stop conditions before increasing autonomy.
- MCP tool guidance treats tools as model-controlled capabilities that should
  stay visible to users, allow denial, validate inputs, return structured
  outputs, enforce access controls, rate-limit, and sanitize outputs.
- NIST AI RMF provides the risk loop: map context, measure risk, manage
  mitigations, and keep governance visible.
- OWASP LLM and Agentic guidance makes prompt injection, tool misuse,
  excessive agency, identity/privilege abuse, data disclosure, tool supply
  chain risk, and cascading failures core design concerns.

## Implementation Standard

The canonical standard is now
`docs/AGENT_TOOL_CONTRACTS_AND_EVALS_GUIDE.md`. Agents should use it whenever
work touches OpenSwan tools, bridge tools, MCP adapters, connected-agent
dispatch, recovery actions, approval metadata, tool result shapes, redaction,
or eval/smoke coverage.

The typed registry entry is `agent_tool_contracts` in
`src/lib/agentDevelopmentStandards.ts`. It should route prompts that mention
MCP tools, OpenSwan tools, bridge tools, tool schemas, recovery evals,
approval metadata, redaction, or tool result contracts to this guide.

## Source List

- Anthropic, Writing effective tools for agents:
  https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic, Building effective agents:
  https://www.anthropic.com/engineering/building-effective-agents
- Model Context Protocol tools specification:
  https://modelcontextprotocol.io/docs/concepts/tools
- Model Context Protocol authorization specification:
  https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- NIST AI Risk Management Framework:
  https://www.nist.gov/itl/ai-risk-management-framework
- OWASP Top 10 for LLM Applications 2025:
  https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/
- OWASP Top 10 for Agentic Applications 2026:
  https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
