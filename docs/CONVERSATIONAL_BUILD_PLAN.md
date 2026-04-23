# Conversational Build — Plan v2

_Supporting plan for build UX. Runtime execution order and shared agent architecture now live in `OPENSWAN_AGENT_IMPLEMENTATION_PLAN.md`._

_Revised 2026-04-20 after user testing showed "I want to build a landing page for my ai agent" still fired directly._

## Bugs found in v1

### 1. Natural-language hijacking

`src/lib/chatCommandRegistry.ts:331-333` has:

```ts
if (/\bbuild\b.*\b(page|landing page|website|site)\b/i.test(lower)) {
  return { routeId: 'build_page', commandText: `/build-page ${normalized}` };
}
```

This runs on **every non-slash message** via `inferChatCommandExecution` (ChatTab.tsx:3650) and **rewrites** the user's natural sentence into a `/build-page` slash command BEFORE the orchestrator sees it. So the user types *"I want to build a landing page"* and the system sees `/build-page I want to build a landing page`, which sails past my earlier natural-language guard.

### 2. Quality threshold too lenient

`analyzeBuildBrief` scores the user's seed brief at ~5 points (word count 3 + "for my AI" domain clue 2). Threshold is 4. So even a thin brief like *"I want to build a landing page for my ai agent"* passes the gate. Even when the orchestrator DOES kick in, my unified slash-command path falls through to a direct build when the brief crosses the 4-point threshold.

### 3. Dead `build_webpage` in conversational router

`conversationalRouter.ts` still detects `build_webpage` but has no handler. It doesn't cause the immediate build but it IS wasted work on every message.

### 4. File destination is invisible to the user

Built HTML is stored in **localStorage per thread** (`CHAT_THREAD_BUILD_ARTIFACT_STORAGE_KEY` in `chatAgentIdentity.ts`). Options to ship it (GitHub, Netlify) exist only inside the build studio sidecar — users don't know they're there unless they look.

## Fix sequence

### Phase A — Stop the hijacking (MUST fix first)

- **Remove the `build` → `/build-page` natural-language rewrite** from `chatCommandRegistry.ts`. Build discovery must flow through the orchestrator.
- **Remove the `build_webpage` branch** from `conversationalRouter.ts` WEBPAGE_PATTERNS so it doesn't interfere.
- Natural language never auto-routes to the build stream. Period.

### Phase B — Raise the quality bar for explicit slash commands

- `/build-page <brief>` must be very detailed to skip the orchestrator. Raise threshold to 7, add a multi-component requirement.
- Anything below that → always route through the orchestrator.
- Example that should pass directly: *"dark-mode landing page for my ai agent saas with hero (bold headline + signup CTA), 3 feature tiles, pricing tier comparison, testimonials, FAQ, and footer — brutalist aesthetic with neon accents"* → scores 10+ → fires directly.
- Example that should enter orchestrator: *"landing page for my ai agent"* → scores 5 → orchestrator.

### Phase C — Where do the files go?

When a build completes, surface the destination options inline in chat:

1. Auto-post a bot message:
   > **✓ Page built.** Saved in this thread. Ship it: **[Save to GitHub]** · **[Deploy to Netlify]** · **[Download HTML]**
2. Each link dispatches a window event that the existing Build Studio handlers listen for (so we reuse the GitHub/Netlify modals that already exist — no new UI to build).
3. Also show a concise file-location hint in the first build response explaining that revisions live in this thread's Build Studio sidecar.

### Phase D — Update the badge + documentation

- The BuildConversationBadge already surfaces the state. Nothing to change.
- Write `docs/BUILD_FLOW.md` as a short user-facing doc explaining the flow (when orchestrator fires, how to skip it, where files go).

## Order of operations

1. Remove hijacking patterns (chatCommandRegistry + conversationalRouter).
2. Raise brief threshold and tighten scoring.
3. Add the post-build "ship it" message + dispatches.
4. Write user-facing doc.
5. Verify end-to-end: type *"I want to build a landing page for my ai agent"* — should enter orchestrator, not build.

## Alignment note

Conversational build should stay a thin UX layer over the shared OpenSwan contract:

1. mode/profile resolution
2. memory/context loading
3. skill resolution
4. build-orchestrator questioning
5. build execution only after clarity/confirmation

It should not fork its own separate agent architecture.

## Non-goals

- Don't replace the Build Studio sidecar. Reuse existing GitHub/Netlify modals.
- Don't move storage off localStorage right now. Per-thread artifact saving is correct for v1.
- Don't gate the slash command behind an "always confirm" step — detailed briefs should fire directly, per user's earlier feedback that over-confirming is bad UX.
