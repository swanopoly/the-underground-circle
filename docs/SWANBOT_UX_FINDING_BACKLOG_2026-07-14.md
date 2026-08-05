# SwanBot UX — Verified Finding Backlog (2026-07-14)

From an 8-dimension, 46-agent discovery sweep with adversarial verification. 36 confirmed, 2 refuted. Pass 1 builds 8 pure cores (stop-message, capability-overview, approval-preview, action-receipt, memory-intent, client-tool-batch, slash-correction, activity-label); the rest are the roadmap for later passes.

## latency
- **First token is gated behind 10+ strictly sequential context loads in buildSystemPromptAsync** (medium, wire=risky) — src/lib/swanbot.ts:2556
  - Impact: Every single main-chat turn: the user hits send and watches rotating 'is noodling...' verbs for an extra 1-4 seconds (each Supabase round trip stacks; one slow loader adds its full 3s timeout, and a hung missions query h
  - Fix: Same core, three wiring adjustments: (1) let each loader's run return Array<{key, body}> not string|null — the memory-stores loader emits 4 keyed sections (memory_user_notes/user_profile/runtime/working) from one result; (2) keep the existi
- **Stream-escalated tool turns go dark: no live 'Using <tool>' status and toolEvents are discarded from the final message** (small, wire=hot-file-small) — src/screens/circles/tabs/ChatTab.tsx:9761
  - Impact: User types 'create a room called Launch' — text streams briefly (often nothing, since tool_use turns emit little text), then for the entire multi-round tool loop (10-60s: rooms.create, verification reads, retries) they s
  - Fix: The proposed onToolActivity callback + pass-through is right. Two refinements for parity and invariants: (a) when merging escalation.toolEvents into updateBotMessage/save/persist, do NOT persist the raw loop events — their `result` strings 
- **Batch lane burns ~7 sequential Supabase telemetry writes before any model work starts** (small, wire=risky) — src/lib/openswanSessionRuntime.ts:1190
  - Impact: Any action-y turn routed to the batch/tool-catalog lane ('create a room', coding generation, delegation) shows 'Booting OpenSwan session' / 'Loading context' for an extra ~1-2 seconds of pure telemetry round trips before
  - Fix: The queue module is right, but queueing only lines 1270-1383 leaves a lost-update race: openswanTranscripts.ts appends are unserialized load→setItem on one storage key (lines 122/150), and the append at 1557 (memory_loaded) plus later ones 
- **v2 client-tool continuation loop runs desktop actions in total silence on SwanBot surfaces, ending in a surprise cap dead-end** (small, wire=hot-file-small) — src/lib/swanbot.ts:1049
  - Impact: In the floating SwanBot bubble or a room chat, 'open that file and summarize it' triggers 30-120s of real desktop-bridge activity (file reads, app focus, screenshots) behind a static three-dot typing animation — the user
  - Fix: The proposed bus is right but needs run scoping: getSwanBotResponse runs concurrently from floating chat, ChatTab assigned-agent tasks, and agentRuntime background paths, so a global {tool, leg, totalCalls} payload would let FloatingChat di

## failure-ux
- **Action turns that lose the edge connection answer with the three-word dead end "Tool-use call failed."** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/lib/openswanSessionRuntimeAdapters.ts:112
  - Impact: User asks for an action ("create a room called Design"), watches "Reasoning with tools…" for several seconds, and the bot's entire final answer is "Tool-use call failed." — no reason, no retry button, no next step. It re
  - Fix: Keep fixes (1) and (2), but simplify (3): once the exported constant itself carries actionable copy, the translateChatFailure round-trip is dead weight (the taxonomy would return null on the new copy and the caller keeps the message anyway)
- **Four "tell me to continue" dead ends (v2 stop, step cap, truncated tool call, interrupted stream) never attach the existing quick-reply chips — and the v2 stop copy is internal-migration jargon** (medium, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/lib/swanbot.ts:1083
  - Impact: On tool-heavy tasks the step cap and v2 continuation stops are routine: the run visibly halts mid-task and the user is told to type "continue" by hand. On mobile especially that's a typing chore where every other suggest
  - Fix: Two refinements: (1) keep TWO plain-language strings for swanBotV2ClientToolStopMessage — the proposed single rewrite conflates 'continuation_cap' (hit a limit) with 'continuation_failed' (follow-up failed); e.g. cap: "I hit my step limit f
- **Immediately retrying a failed message returns the identical cached failure for 15 seconds — retry is a silent no-op** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/lib/swanbotTurnDedupe.ts:87
  - Impact: User sends "create a room called Design", gets "Hey Chris, I couldn't complete that — the Claude edge function returned nothing…", and does the natural thing: immediately re-sends (or taps Retry). The identical error rea
  - Fix: Same shape, three sharpenings: (1) Host isSwanBotFailureFallbackText in the pure dedupe module (or another dependency-light module) and have swanbot.ts import it — swanbot.ts itself is not smoke-loadable (react-native/supabase deps), and th
- **Slash commands and multi-agent replies surface raw exception text ("Failed to fetch") even though the house failure translator exists** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:8713
  - Impact: User types /apps or /screen (or @mentions two agents) while a bridge or network hiccups and gets "Could not load app status: Failed to fetch." or "**Codex #1** error: TypeError: Load failed" — transport jargon with no hi
  - Fix: The proposed helper as specced would silently never translate: these catch blocks catch Error objects, and both translateChatFailure and classifyAgentFailure stringify non-string input via JSON.stringify — JSON.stringify(new Error('Failed t

## approval-friction
- **Approving a tool-gate card never unblocks the action: approvals are scoped to an already-dead run, creating an infinite re-approval treadmill** (medium, wire=hot-file-small) — src/lib/openswanToolRuntime.ts:5623
  - Impact: User asks SwanBot to update a WordPress slide (or send a Gmail, or run npm install). SwanBot replies 'Approval requested — I did not touch WordPress yet' and the turn ends. User taps Approve on the card — nothing happens
  - Fix: Proposed fix is sound; three sharpenings: (1) the poll must also watch for 'rejected'/'expired' and return the block message immediately rather than waiting out the cap; (2) on cross-run reuse, emit the same visible 'Covered by the approval
- **Approval cards never show WHAT will run — users must approve shell commands, emails, and WordPress edits sight-unseen** (small, wire=hot-file-small) — src/lib/approvalPayloadRenderer.ts:97
  - Impact: The scariest approvals are the least informative: user sees an amber card saying 'PRIVILEGED — local run shell — Review the requested tool input before continuing' with Approve/Reject and literally cannot see the command
  - Fix: The four hot-file call-site edits are unnecessary. payload.args is ALREADY persisted with full fidelity at all four gates (buildSwanBotClientToolApprovalArgs at swanbot.ts:1387 and the keyArgs filter at openswanToolRuntime.ts:5725-5729 stri
- **Pending run-approvals never expire: they defer the agent forever and pile up as dead cards in the banner** (small, wire=hot-file-small) — src/lib/openswanToolApprovals.ts:93
  - Impact: Every treadmill cycle (finding 1) leaves another orphaned pending card, so the banner header climbs to '4 actions need approval, +7 more in queue' full of duplicates from dead runs; approving them does nothing. Worse, an
  - Fix: Proposed fix is right; three sharpenings. (1) In the pure core, mirror chatApprovalGate's resolveApprovalRowExpiresAt semantics: treat missing/<=0 timeout_seconds or unparseable requested_at as non-expiring so loosely-typed rows never mass-
- **Run-approval cards only exist above the ChatTab composer — a run blocks silently if the user is watching Office or any other surface** (small, wire=hot-file-small) — src/screens/circles/tabs/ChatTab.tsx:13364
  - Impact: User kicks off 'update the slides' in chat, then switches to the Office tab (the live agent dashboard) to watch the agent work. The WP approval gate fires, the run stalls waiting — but Office shows no card, no strip item
  - Fix: The proposed two-part fix is sound and thin (RunApprovalBanner Props are circleId/userId/accentColor?, and OfficeTab already has currentUserId in scope at :3938). Three refinements: (1) the adapter must map approval_kind -> action_type and 

## discoverability
- **"What can you do?" is answered with a stale hardcoded 10-item list that hides ~90% of the product** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/lib/swanbot.ts:3147
  - Impact: A new user asks the canonical onboarding question — 'what can you do' or just 'help' — and is told the agent is a check-in/streak/trivia bot. They never learn computer use, code review, page building, or watches exist, a
  - Fix: Two adjustments to the proposed module: (1) it needs a value import of CHAT_COMMAND_REGISTRY, not 'import type only' — fine for smoke since chatCommandRegistry is dependency-light and tsx-loads today; (2) buildCapabilityOverviewMessage(surf
- **Empty chat first-run shows only a swan image — zero suggestions on the app's primary surface** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:11693
  - Impact: A brand-new user opens Chat — the main agent surface — and stares at a picture of a swan plus an empty input. Nothing suggests what to type, that slash commands exist, or that the agent can build/review/automate anything
  - Fix: Two sharpenings. (1) The proposed chips live only in renderEmptyState, but on the very first landing the session greeting replaces the empty state after ~800ms, so chips would mostly benefit new/cleared threads. Also attach the same suggest
- **The '+ Actions' menu never surfaces the new flagship commands — featured slots are games and legacy tools** (small, wire=safe) — /Users/cswanson/the-underground-circle/src/lib/chatActions.ts:29
  - Impact: A user who browses the composer's '+ Actions' button — the only browse-based capability surface — concludes the agent does party games, HF one-offs and WordPress. The recently shipped power features (universal /create, r
  - Fix: Proposed fix is sound; two refinements: (1) scope the smoke to the new AGENT & CODE category only — asserting EVERY existing action text against CHAT_COMMAND_REGISTRY would fail because many current entries are natural-language prompts ('Op
- **Typo'd or argumented slash commands silently fall through to the LLM — no did-you-mean, /help takes no topic** (medium, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/screens/circles/tabs/ChatTab.tsx:8507
  - Impact: User mistypes a command or naturally tries '/help memory' and instead of an instant correction they wait seconds (and pay tokens) for a conversational LLM reply that may hallucinate command syntax. The command system giv
  - Fix: Three sharpenings to the proposed wiring: (1) widen 8507 with an explicit trailing space — `lowerContent === '/help' || lowerContent === '/commands' || lowerContent.startsWith('/help ') || lowerContent.startsWith('/commands ')` — since bare
- **Cursor-style @file:/@symbol: codebase mentions are live but 100% undiscoverable** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/lib/swanbot.ts:2662
  - Impact: A developer asks about their repo and gets ungrounded generic answers, because the feature that would pin the reply to an exact file (`@file:src/lib/foo.ts`) can only be used by someone who has read the source code. The 
  - Fix: The proposed fix is right; two sharpeners: (1) name the command /codebase with alias /mentions and put @file:/@symbol: syntax examples directly in the registry description so slash-autocomplete itself teaches the syntax even if the user nev

## response-quality
- **Chat bubbles render markdown raw (code fences, tables, headers) while the system prompt orders the model to use them** (medium, wire=hot-file-small) — src/components/chat/ChatInlineRichText.tsx:28
  - Impact: User asks a code/build/research question and gets a wall of literal ``` markers, `## headers`, and | pipe | table | soup in proportional font — code is unreadable, comparisons the model was explicitly told to format as t
  - Fix: Fix is sound; three sharpenings. (1) renderContent (single call site ChatTab.tsx:13733) renders user bubbles too — gate block parsing on item.isBot (e.g. <ChatRichBody> only when isBot, keep ChatInlineRichText for user messages) so a user t
- **Raw 1200-char JSON tool output shown as the user-facing action summary (TASK RUN rows and the synthesized 'Done:' reply)** (small, wire=hot-file-small) — src/lib/openswanSessionRuntime.ts:2274
  - Impact: User says "add a room for the launch" — the model calls rooms.create and stays silent, so the assistant bubble literally reads `Done:\n- {"ok":true,"roomId":"7f2c...","panel":...}`. On every batch action turn the TASK RU
  - Fix: Fix the root cause first: add the 11 missing cases to formatOpenSwanRuntimeToolResult — git.run, local.run_shell, and docs.create_document already return { ok, resultsText } (just return resultsText, matching the 179 existing cases); worksp
- **Stream-escalated action turns discard toolEvents — actions run but no TASK RUN strip or receipt renders (silent no-op feel)** (small, wire=hot-file-small) — src/screens/circles/tabs/ChatTab.tsx:9773
  - Impact: User phrases an action casually ("oh, also put that in my tasks"), the streamed turn escalates, tools actually run (task created, file written, desktop action), then the visible answer is replaced by plain prose with NO 
  - Fix: As proposed, but capture toolEvents under `if (escalation.escalated)` rather than inside the `response.length > 0` gate at 9773: an escalated loop that ran tools but typed no prose currently keeps the stale streamed text AND would still dro
- **Stuck-loop stop notes addressed to the MODEL are returned verbatim as the user's final answer** (small, wire=hot-file-small) — src/lib/agentExecutionCore.ts:807
  - Impact: After watching a task run for 30-60s, the user's entire reply is `stopped: repeated identical failing call — desktop.click x3 — no progress and the run's one solver consultation is already spent; report the blocker to th
  - Fix: Proposed fix is right; three sharpenings: (1) pass the already-tracked lastToolErrorText (agentExecutionCore.ts:782 has it in scope) into buildUserFacingStopMessage as the short-error snippet, truncated, so the copy says what actually faile

## continuity
- **v2 continuation cap ends multi-step tool runs with the raw string "Too many client-side continuation rounds." — all progress dropped, "continue" restarts from zero** (medium, wire=hot-file-small) — supabase/functions/swanbot-v2-ai/index.ts:2682
  - Impact: User asks for a multi-step desktop/app task in a room or via an agent, watches 1-3 minutes of activity, and the entire answer is the developer string "Too many client-side continuation rounds." — no record of what was do
  - Fix: Proposed fix is sound; two sharpenings. (1) The edge terminal payload already includes toolCalls (index.ts:3056) — make that the summary's source of truth on cap terminals and use the client-side {name, ok} ledger only as a supplement for c
- **Reload mid-run leaves a permanent fake "Noodling…"/"BUILDING..." bot bubble in the thread with no interrupted-run notice or continue affordance** (small, wire=hot-file-small) — src/screens/circles/tabs/ChatTab.tsx:5706
  - Impact: User kicks off a build, the tab reloads or they navigate away; forever after, the thread shows SwanBot frozen mid-"Cooking…" or "BUILDING..." with no answer beneath it. They either wait on a dead run, or must re-type the
  - Fix: Fix as proposed, with two refinements: (1) adding isPending to buildPendingBotMessageRecord also requires adding `isPending?: boolean` to the PendingBotMessageRecord type in src/lib/pendingBotMessages.ts; (2) classify primarily on record.so
- **"Tell me to continue and I'll pick up where I left off" is broken: bare "continue" routes to the tool-less streaming lane that never sees the resume checkpoint** (small, wire=hot-file-small) — src/lib/chatTerminalTransportPolicy.ts:63
  - Impact: After a run stops at the tool-step cap, the user types "continue" exactly as instructed and gets a streamed, no-tools text reply ("Sure — picking back up!") that performs no actions and never loads the saved checkpoint. 
  - Fix: Two refinements. (1) Import loadOpenSwanTranscript/buildOpenSwanTranscriptKey from src/lib/openswanTranscripts.ts (not openswanSessionRuntime), and gate the transcript load behind looksLikeContinueRequest(cleanContent) so the extra await on
- **Mid-run steering notes are confirmed "Sent — applies at the next step." then silently dropped when the run ends before the next drain boundary** (small, wire=hot-file-small) — src/lib/openswanSteering.ts:47
  - Impact: During a long run the user types "use the staging URL, not prod" in the steering bar and gets a success confirmation — but the model was already producing its final answer, the run finishes without the guidance, and the 
  - Fix: The proposed fix is right; two small sharpenings: (1) join multiple dropped notes into one bounded line (quote the first 1-2, then "+N more") rather than one line per note, since up to 5 can be queued; (2) the thrown-loop path intentionally
- **Switching threads mid-run makes SwanBot's reply pop into the wrong (currently viewed) thread, then vanish from it on reload** (small, wire=hot-file-small) — src/screens/circles/tabs/ChatTab.tsx:5478
  - Impact: User asks a question in thread A, hops to thread B while SwanBot works; A's answer (agent-task results, command notices, computer-task updates) suddenly appears mid-conversation in B, totally out of context — then disapp
  - Fix: Keep the proposed ref+guard, with two adjustments: (1) in addPendingBotMessage the captured thread is its closure `activeThreadId` (used at 5706-5707), so capture `const messageThreadId = activeThreadId` there the same way before guarding; 

## v2-loop-ux
- **2k per-string serializer clip silently discards 75% of the a11y tree and DOM snapshot — the two primary grounding tools of the v2 loop** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/lib/swanbotClientToolDispatcher.ts:337
  - Impact: User asks SwanBot to click something in a real app ('archive this email in Mail', 'press Export in Photoshop'). The button is below the first ~2k chars of the rendered tree, so the model reads a truncated tree, re-reads 
  - Fix: The proposed fix misses a third data.text consumer: recordingChatCommands.ts:214-215 (runReplayStep re-discovery reads tree.data.text off a fireClientTool result; with textParts-only it would silently degrade to recorded-path fallback). Do 
- **Vision fallback is blind on the v2 path: desktop.screenshot/browser.screenshot return a 128-char base64 preview, so the model coordinate-clicks the user's real desktop without ever seeing an image** (medium, wire=risky) — /Users/cswanson/the-underground-circle/src/lib/swanbotClientToolDispatcher.ts:230
  - Impact: User asks for anything in Photoshop/Figma/a canvas app, or any flow where the a11y tree misses (made worse by the 2k clip above). SwanBot announces it's 'switching to vision', takes a screenshot, receives 128 chars of ba
  - Fix: The side-channel direction is right, but as literally proposed it violates the bounded-persisted-metadata rule: RunContinuation persists `messages` verbatim into agent_runs.metadata.continuation (index.ts:2716-2732), so each screenshot roun
- **selectToolsForTurn keyword gate misses everyday phrasings ('open Notes', 'add a reminder', 'play Spotify', 'open Slack') and prompt rule 8 converts each miss into a refusal** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/supabase/functions/swanbot-v2-ai/index.ts:2154
  - Impact: User types 'Add a reminder to call mom at 5' or 'Open Notes and jot down the grocery list' — features the product literally shipped AppleScript recipes for — and SwanBot replies that it doesn't have that capability this 
  - Fix: The proposed fix is sound; two sharpenings. (a) Keep the expanded app-noun list in the new _shared/swanbot-tool-selection.ts adjacent to a comment pinning it to the tool descriptions that advertise those apps (launch_app line 1545, run_appl
- **Zero progress surfaced during v2 continuations — users stare at a static 'is typing…' for 1-3 minutes while SwanBot drives their mouse and keyboard** (medium, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/lib/swanbot.ts:1171
  - Impact: User asks SwanBot to do a desktop task, then watches 'is typing...' for a minute or more while their own cursor moves and windows open. They can't tell a working run from a hung one, so they click around, retype, or kill
  - Fix: Fix as proposed, with three corrections: (1) threading is 4-5 touch points, not 3 — callSwanBotAI is called positionally from getSwanBotResponseImpl at swanbot.ts:3633 AND the failover call at 3680, so both call sites need the optional call
- **executeClientToolCalls awaits up to 40 client tools strictly serially, even when the batch is independent read-only observations** (small, wire=hot-file-small) — /Users/cswanson/the-underground-circle/src/lib/swanbot.ts:1179
  - Impact: Multi-file or multi-check turns ('find the three PSDs in Downloads and Desktop and tell me which is newest') take 2-4x longer than needed: every read waits for the previous one, and that whole serial span happens inside 
  - Fix: Do not create a new clientToolParallelSafety.ts allowlist — that duplicates an existing owner and will drift (CLAUDE.md: route new behavior into the existing runtime owner). Reuse the machinery the sibling loops already use: in executeClien

## memory-flow
- **"Note that…" / "save this…" / "keep in mind…" never save — and the system prompt tells the model to reply "Saved." anyway** (small, wire=hot-file-small) — src/lib/chatAutomationPlanner.ts:237
  - Impact: User types "note that our staging URL is staging.acme.com" or "keep in mind I'm on Windows"; SwanBot replies "Noted. Saved." Nothing was written. Next session the bot has no idea, and the user learns SwanBot's memory cla
  - Fix: As proposed, plus one addition: when the new patterns match in detectPlannerConversationalIntent, port the legacy content-strip replacements from conversationalRouter.ts:250-254 (strip 'add/put…to memory', 'save|store|note|keep in mind (tha
- **On the default streaming lane, memory writes are 100% silent — extraction result discarded, escalated save_memory receipts dropped** (small, wire=hot-file-small) — src/screens/circles/tabs/ChatTab.tsx:9790
  - Impact: In everyday chat the green 'Memory saved' chip and toast never appear even when SwanBot just learned 2-3 things; the only turns that show them are the rarer batch-lane turns, so save feedback feels random. Users can't te
  - Fix: Same shape, two sharpenings. (a) In the 9788 block: gate on currentUserId (matching 5482), capture `const { saved } = await autoExtractAndSave(...)`, and patch via the raw `setMessages` map from 5491 using pendingMsg.id — do NOT use updateB
- **"Used memory: …" attribution row never renders on the default lane — swanbot drops the retrieval references it already has** (medium, wire=hot-file-small) — src/lib/swanbot.ts:2640
  - Impact: Bot casually says "since you prefer pnpm…" in a normal streamed turn and there is no 🧠 chip explaining which saved memory drove that — no way to audit or fix a wrong memory from the message. The just-shipped attribution 
  - Fix: Keep the proposed store, but in ChatTab snapshot it into a local const immediately after `await buildStreamableSystemPrompt(...)` returns (~line 9656), then stamp that local at the three completion sites — don't read the store at stream com
- **Ambient memory extraction is hard-gated on a client-exposed Gemini platform key — silently disabled in any build without it** (medium, wire=hot-file-small) — src/lib/agentMemory.ts:118
  - Impact: On any deployment where platform keys aren't baked into the web bundle, SwanBot never learns anything the user didn't explicitly /remember — it feels amnesiac across sessions, and nothing in /context, /memories, or chat 
  - Fix: Same direction, two sharpenings: (1) In extractMemoriesFromConversation, replace the raw fetch with the existing universalInvoke/llm-proxy path (respecting billingPriority + connected marketplace keys, cheap-model preference like google_ai/
- **Bare /remember and /forget fall through to the LLM as plain chat instead of showing usage** (small, wire=hot-file-small) — src/screens/circles/tabs/ChatTab.tsx:8344
  - Impact: A user exploring memory types /remember and hits enter — instead of the usage hint they wait on a full LLM round-trip and get a conversational guess about what the command might do (which, per finding 1's directive, may 
  - Fix: The proposed fix is correct as-is. Optional hardening while there: the handlers slice `content` (untrimmed) by fixed offsets, so a message with leading whitespace (e.g. ' /remember buy milk') passes the trimmed lowerContent match but mangle

## Refuted (not real)
- latency: Stale currentRunStep after a batch failure poisons the next turn's thinking label — The cited omission exists (inner batch catch at ChatTab.tsx 10212-10214 lacks setCurrentRunStep('')), but t
- failure-ux: When the user's selected marketplace model fails, Claude silently answers in its place — and the app then mis-reports which model answered — The cited lines are real (swanbot.ts:3597-3601 