# Coding Agent Best Practices

**Last researched:** 2026-05-28

This guide is the general coding standard for agents contributing to The
Underground Circle. Use it before broad implementation work, refactors, bug
fixes, security-sensitive code, runtime changes, tests, scripts, and docs that
describe code behavior.

For TypeScript-specific rules, also read
`docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md`.
For task-based routing across all standards, read
`docs/AGENT_DEVELOPMENT_STANDARDS_INDEX.md`.

## Core Standard

Good code in this repo is:

- Clear enough for the next agent or developer to safely change.
- Small enough in scope that review and rollback are realistic.
- Tested at the risk level of the change.
- Typed or validated at every trust boundary.
- Secure by default with explicit permission gates around sensitive actions.
- Observable enough that failures can be diagnosed without exposing secrets.
- Consistent with the canonical owner in `docs/AGENTS_ROADMAP.md`.

## Before Editing

1. Read the owning files and the roadmap ownership table.
2. Search for existing helpers, types, adapters, smoke tests, and docs.
3. Identify the behavior contract before changing implementation.
4. Decide the narrowest useful verification command before editing.
5. Check whether the change touches security, auth, billing, desktop/browser
   control, file writes, provider routing, persistence, or migrations.

If the change mixes refactor and behavior, split it mentally and, when possible,
physically. Make the smallest behavior change that solves the user request.

## Change Shape

- Prefer small, cohesive changes over broad rewrites.
- Keep refactors separate from feature behavior when practical.
- Extend an existing owner instead of adding a parallel path.
- Keep public contracts explicit: input type, output type, side effects,
  failure shape, and verification path.
- Delete dead code only when you can prove it has no live caller.
- Avoid speculative abstractions. Add an abstraction when it removes real
  duplication, clarifies a contract, or matches an existing local pattern.
- Do not hide unrelated cleanup inside a feature change.

## Architecture Rules

- Preserve dependency direction. UI can call runtime helpers; generic helpers
  should not import UI frameworks unless they are explicitly UI helpers.
- Keep pure logic in `src/lib` testable by smoke scripts where possible.
- Keep adapters thin. App, browser, file, desktop, provider, and Supabase
  adapters should translate boundaries, then call typed core logic.
- Use one source of truth for route ids, provider ids, tool names, approval
  actions, and status values.
- Make side effects obvious. File writes, network calls, bridge actions,
  database writes, local storage writes, and external app actions should not be
  hidden in innocent-looking formatters or selectors.
- Keep configuration declarative and validated.

## Error Handling

- Convert unknown errors into typed failure results at the boundary.
- Preserve the original error detail in debug metadata when safe.
- Show users an actionable blocker, approval request, retry option, or proof
  summary instead of raw stack traces.
- Fail closed for permissions, auth, missing grants, destructive actions,
  billing risk, and unclear desktop/browser targets.
- Do not parse free-form error text when a stable error code can be returned.

## Security And Privacy

- Treat all user input, provider output, bridge responses, uploaded files,
  local storage, URL params, and database rows as untrusted until validated.
- Use least privilege for browser, desktop, file, provider, and integration
  actions.
- Never log API keys, OAuth tokens, local file contents, private paths, or
  secret-bearing headers.
- Redact sensitive values in receipts, run metadata, and chat-visible proof.
- Keep write actions approval-gated when they mutate files, external apps,
  browser sessions, databases, skills, memory, billing, credentials, or user
  content.
- Prefer allowlists for supported tools, routes, domains, app actions, and file
  operations.

## Testing And Verification

Choose verification by blast radius:

| Change Type | Expected Verification |
|---|---|
| Documentation only | `git diff --check` |
| App TypeScript or wiki data | `npm run typecheck:app` and focused smoke when behavior changed |
| Supabase functions | `npm run typecheck:functions` plus targeted function smoke when available |
| Planner, route, recovery, bridge, provider, approval, persistence | Focused smoke test plus `npm run typecheck:app` |
| UI behavior | Typecheck plus manual or automated responsive/accessibility smoke when practical |
| Migration or SQL | Idempotency check, docs checklist update, and the narrow SQL validation available |
| Security-sensitive logic | Negative-path smoke plus review for auth, secrets, redaction, and least privilege |

Tests should prove behavior from the user or caller perspective. Avoid tests that
only mirror implementation details.

## Review Checklist

When reviewing code, lead with concrete risks:

- Does the change solve the actual user request?
- Is the diff smaller than the problem requires, or is it hiding unrelated work?
- Are inputs validated at boundaries?
- Are errors typed, recoverable, and safe to show?
- Are write actions permissioned and auditable?
- Are secrets redacted from logs, metadata, receipts, and chat?
- Is there a single owner for the behavior?
- Are new dependencies justified by real value?
- Does the verification match the risk?
- Are docs, wiki entries, or roadmap ownership updated when the behavior becomes
  canonical?

## Agent Handoff Format

When handing work back, include:

- What changed.
- Where the canonical files are.
- What verification ran.
- What was not run and why.
- Any remaining risk or follow-up that directly affects the user's request.

## Sources To Recheck

- [Google Engineering Practices](https://google.github.io/eng-practices/) for
  code review standards and small-change discipline.
- [Google small CL guidance](https://google.github.io/eng-practices/review/developer/small-cls.html)
  for keeping changes reviewable.
- [OWASP Secure Coding Practices Quick Reference](https://owasp.org/www-project-secure-coding-practices-quick-reference-guide/stable-en/)
  for secure coding checklists.
- [Testing Library guiding principles](https://testing-library.com/docs/guiding-principles)
  for user-centered UI tests.
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
  for structured commit-message conventions when commits are requested.
