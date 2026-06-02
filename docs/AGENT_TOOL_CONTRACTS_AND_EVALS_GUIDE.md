# Agent Tool Contracts And Evals Guide

**Last researched:** 2026-05-29

This guide is the standard for agents adding or reviewing OpenSwan tools,
desktop/browser bridge tools, MCP tools, connected-agent dispatch tools,
recovery actions, and eval/smoke coverage in The Underground Circle.

The reusable TypeScript helper lives in
`src/lib/agentToolContractStandards.ts`. It builds the concrete checklist,
risk tags, recovery fields, eval plan, prompt block, and recommended smoke
commands that connected agents should receive for tool work. It also reviews a
proposed draft contract and blocks missing approval, recovery, schema, eval, or
redaction coverage before a tool is marked ready.

Use it when a change touches:

- `openswanToolRuntime`, `openswanTools`, bridge scripts, MCP-style tool
  adapters, desktop/browser/app tools, or custom agent bridge dispatch.
- tool input schemas, result shapes, approval metadata, recovery options, error
  codes, receipts, redaction, or retry behavior.
- smoke tests, golden tasks, route evals, recovery evals, or app automation
  proof checks.

Read it with:

- `docs/CODING_AGENT_BEST_PRACTICES.md`
- `docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md`
- `docs/AGENTIC_COMPUTER_APP_AUTOMATION_GUIDE.md`
- `docs/DESIGN_AGENT_BEST_PRACTICES.md`

## Core Standard

A tool is a contract, not a convenient function wrapper. Good tools are:

- narrowly scoped to one capability;
- named by domain and action;
- described for agent use, not just API coverage;
- strict about input schemas and output shape;
- explicit about read/write/destructive/billing/credential risk;
- approval-gated before side effects;
- token-efficient while still returning enough context to decide next steps;
- safe to retry only when idempotency and fresh evidence allow it;
- covered by success, blocker, unsafe, malformed-input, and recovery evals.

## Research Basis

Current primary guidance supports this shape:

- Anthropic's tool guidance says agent tools should be designed and evaluated
  from the agent's point of view. Clear names, descriptions, namespaces,
  response context, and real task evaluations matter more than exposing every
  backend API.
- Anthropic's agent guidance emphasizes simple workflows, environmental
  feedback, checkpoints, and clear stopping conditions before more autonomy.
- MCP tool guidance treats tools as model-controlled capabilities that should
  remain visible to users, support human denial of invocations, validate inputs,
  use structured outputs, enforce access controls, rate-limit, and sanitize
  outputs.
- NIST AI RMF gives the governance frame: map the task context, measure risk,
  manage mitigations, and keep monitoring and review practices visible.
- OWASP LLM and Agentic guidance identifies prompt injection, tool misuse,
  excessive agency, privilege abuse, data exposure, insecure tool supply chains,
  and cascading failures as central risks.

## Tool Contract Checklist

Every new or changed tool should define:

| Field | Requirement |
|---|---|
| Tool name | Namespaced by domain and imperative action, such as `desktop.observe_window` or `app.indesign.export_pdf` |
| Purpose | One clear capability; split read, write, export, and destructive actions |
| Inputs | Strict schema with typed enums, bounded strings, size caps, and required fields |
| Trust boundary | What is untrusted: user text, provider output, DOM, app state, file path, bridge response, or tool result |
| Risk annotation | Read-only, write, destructive, billing, credential, privacy, or external submission |
| Approval requirement | Whether approval is required, why, and what the user sees |
| Idempotency | Whether retries are safe and what key or checkpoint prevents duplicate side effects |
| Observation requirement | What state must be collected before action |
| Output shape | Stable success, blocker, failed, and unsafe variants |
| Evidence | Before/after state, receipts, screenshots, diffs, exports, hashes, or manual-verification marker |
| Redaction | Which fields must never reach logs, prompts, receipts, or chat-visible output |
| Eval coverage | Positive path, malformed input, denied approval, missing permission, unsafe target, and recovery path |

## Schema Rules

- Use discriminated unions for tool results.
- Keep UI labels separate from runtime discriminants.
- Parse bridge, provider, MCP, browser, desktop, and app responses at the
  boundary before downstream code sees them.
- Prefer enums and allowlists for surfaces, tools, apps, file actions, domains,
  providers, and recovery actions.
- Cap free-text inputs and outputs.
- Include stable error codes for recovery; do not make recovery parse prose.
- Return `unknown` or rejected parse results from untrusted JSON until validated.

Example result shape:

```ts
type ToolResult =
  | {
      status: 'completed';
      receiptId: string;
      evidence: { before: string; after: string; warnings: string[] };
    }
  | {
      status: 'blocked';
      code: 'approval_required' | 'missing_permission' | 'target_not_found';
      recoveryOptions: string[];
    }
  | {
      status: 'unsafe';
      code: 'destructive_without_approval' | 'low_confidence_target';
      userActionRequired: boolean;
    }
  | {
      status: 'failed';
      code: 'bridge_unreachable' | 'tool_schema_mismatch' | 'unexpected_tool_output';
      retryable: boolean;
    };
```

## Approval And Consent

Require approval before:

- writes, exports, deletes, submissions, purchases, publishes, or external sends;
- credentials, OAuth scopes, billing, private files, or private browser data;
- shell commands, installs, generated scripts, or connected-agent launches that
  can make changes;
- fallback from API/semantic actions to coordinate or screenshot-guided actions;
- app automation that changes a document, layer, canvas, model, drawing, or
  remote account.

Approval payloads should include actor, tool, target, risk, proposed change,
evidence plan, retry limit, and stop condition.

## Output And Redaction

Tool output should help the model decide the next step without leaking private
state.

- Return compact structured fields before long prose.
- Include enough state for the next agent turn to continue safely.
- Redact tokens, secrets, private paths, account identifiers, private file
  contents, and credential-bearing headers.
- Treat screenshots, OCR, DOM text, app accessibility trees, and local file
  snippets as sensitive by default.
- Put debug detail behind metadata or details views, not in the default chat
  message.

## Recovery Contract

Every recoverable failure should return:

- `code`: stable machine-readable failure code.
- `retryable`: whether automatic retry is allowed.
- `requiresFreshEvidence`: whether the surface must be re-observed first.
- `requiresApproval`: whether approval is needed before retry.
- `actor`: user, OpenSwan, connected agent, bridge, browser runtime, or app
  adapter.
- `maxAttempts`: retry cap.
- `recoveryOptions`: selectable user-facing choices.
- `stopCondition`: when to stop rather than loop.

Automatic retries are allowed only when the tool result says retry is safe and
fresh evidence or idempotency prevents duplicate side effects.

## Eval Matrix

| Eval Type | What It Proves |
|---|---|
| Happy path | The tool can complete the intended safe task and return proof |
| Malformed input | Bad arguments fail closed with a typed error |
| Missing permission | The tool asks for approval or user action instead of bypassing |
| Unsafe/destructive request | The tool refuses or approval-gates the action |
| Bridge/provider unavailable | The failure becomes structured recovery options |
| Ambiguous target | The tool asks for clarification or fresh evidence |
| Redaction | Secrets, private paths, and sensitive file contents do not leak |
| Retry/idempotency | Re-running cannot duplicate side effects without approval |
| Prompt-injection resistance | Untrusted page/app/file content cannot override tool policy |
| Regression golden task | A representative real user task keeps working across changes |

## Review Questions

- Is this a single capability or several hidden capabilities?
- Can the model tell when to use it and when not to use it?
- Does the input schema prevent malformed or oversized requests?
- Does the result shape separate completed, blocked, unsafe, and failed states?
- Are approval and recovery decisions structured, not inferred from prose?
- Does the tool have a safe retry story?
- Does the output contain only the context needed for the next step?
- Are secrets and private paths redacted before chat, logs, prompts, and
  receipts?
- Is there at least one negative-path smoke for the highest-risk failure mode?

## Typed Self-Review Helper

Use `reviewAgentToolContractDraft(description, draft, options)` before a tool
contract is handed back as ready. The draft should include:

- `toolName`, `purpose`, `inputs`, `trustBoundary`, and `riskTags`.
- `approvalRequired` for any write, export, destructive, billing, credential,
  privacy, shell, external-submission, or connected-agent launch risk.
- `idempotency`, `observationRequirement`, `outputVariants`, `evidence`, and
  `redaction`.
- `evalIds`, `recoveryFields`, and `smokeCommands`.

The review returns:

- `status`: `ready` or `blocked`.
- `score`: quick quality score for dashboards or handoff text.
- `missingFieldIds`, `missingEvalIds`, and `missingRecoveryFields`.
- `issues`: blockers and warnings with recommendations.
- `missingSmokeCommands`: verification gaps that need to be run or explicitly
  marked not applicable.

`formatAgentToolContractReviewPromptBlock(review)` turns the review into a
compact prompt block for connected agents. A tool with blocker issues must not
be retried automatically or marked ready for chat.

## Verification Matrix

| Change Type | Expected Verification |
|---|---|
| Standards/wiki only | `npm run smoke:agent-standards-wiki`, `npm run typecheck:app`, `git diff --check` |
| OpenSwan tool contract | `npm run smoke:agent-tool-contract-standards`, tool-specific smoke, approval smoke when privileged, `npm run typecheck:app` |
| Desktop/browser bridge tool | Bridge smoke, failure/recovery smoke, redaction check, `npm run typecheck:app` |
| App automation tool | App-family smoke, evidence-contract smoke, approval-path smoke, typecheck |
| Connected-agent dispatch tool | Custom-agent bridge smoke, standards handoff smoke, recovery smoke |
| Recovery policy | Recovery smoke plus one negative-path case proving no blind retry |
| Eval suite | Golden task plus malformed-input and unsafe-action cases |

Run the helper smoke after changing this guide or the typed helper:

```sh
npm run smoke:agent-tool-contract-standards
```

## Sources To Recheck

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
