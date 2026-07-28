# Memory System — Fleet Audit + Build-Out (2026-07-24)

> Six parallel read-only audit agents across capture, retrieval/injection, the
> Office/agent surface, schema/RLS/privacy, test coverage, and cross-surface
> coverage — then a build wave. Every finding below was **re-verified by hand**
> against the code before being acted on or recorded; agent claims that did not
> survive verification are not listed.
>
> Scope note: `docs/AGENT_MEMORY_GOD_PLAN.md` §1 declares nearly all of this
> shipped. That status table is **stale in important places** and should be read
> against this document, not the other way round.

## The headline

**The app's flagship memory promise has no live capture path from chat.**
`src/lib/agentMemory.ts:118-120` gates the extractor's key on
`EXPO_PUBLIC_ALLOW_PLATFORM_MODEL_KEYS === 'true'`; `.env:3` and
`.env.example:4` both set it `false`. `GEMINI_API_KEY` therefore resolves to
`''` and `extractMemoriesFromConversation` short-circuits at `:158`, so
`autoExtractAndSave` returns `{saved:0,updated:0,rejected:0}` for every caller
(`ChatTab.tsx:5563`, `:10200`, `swanbot.ts:840`) — inside bare `try{}catch{}`
with no error surface. Two independent audits reached this conclusion
separately.

That one dead path also explains three other findings: `embedAndStoreMemory` is
only ever called from inside it (`agentMemory.ts:291`, `:339`), so **almost no
row is embedded**; `match_memories` filters `AND m.embedding IS NOT NULL`
(`20260417_memory_embeddings.sql:107`); and the ILIKE fallback only fires when
`candidates.length === 0` (`memoryService.ts:882`) — so as soon as *one* memory
is embedded, every un-embedded row becomes permanently unreachable.
`backfillMemoryEmbeddings` (`memoryEmbeddings.ts:163`) has **zero callers**.

Guarantee #1 of the god plan ("the agent remembers the last time we talked
about this") is not met on the default path. Fixing ranking or budgets before
fixing this improves a path most turns never take.

## Shipped in this wave

| # | Fix | File | Severity |
|---|---|---|---|
| M1 | **Cross-member private-memory leak.** `gatherCircleContext` runs on a SERVICE-ROLE client (RLS bypassed) and selected `memory_entries` filtered only on `circle_id`/`is_active` — no visibility, no owner. The same file writes `visibility: scope === "user" ? "private" : ...`, so private rows exist. One member's `/remember` preference was loaded verbatim into another member's system prompt. Added `.or('visibility.neq.private,user_id.eq.<userId>')` | `supabase/functions/swanbot-ai/index.ts:595` | **HIGH — privacy** |
| M2 | **Prompt injection into the model's rule slot.** Instruction-kind memories were concatenated raw into the **frozen** system prefix under `## Guardrails and Instructions`, while the sibling "Things I Remember" block below already fenced its rows. Any member — or any agent holding `save_memory` — could author a row rendered as a system guardrail for everyone. Now fenced with `wrapUntrusted` and reframed as "Standing User Preferences" with explicit non-override/non-authorization framing, so the legitimate "remember: always use metric units" feature still works | `supabase/functions/swanbot-ai/index.ts:746` | **HIGH — security** |
| M3 | **Unfenced memory on every tool-executing surface.** `agentRuntime` pushed `buildMemoryContext(...)` — which splices `memory_entries` rows *and* the free-text `circle_memory` shared doc — straight into the prompt with zero untrusted wrapping. This is the memory path for every agent run, Kanban task run and computer task | `src/lib/agentRuntime.ts:459` | **HIGH — security** |
| M4 | **Unfenced memory in delegated subagent prompts** | `src/lib/subagentRegistry.ts:883` | **HIGH — security** |
| M5 | **Privacy laundering into `soul_wisdom`.** `loadSoulMemories` joined `memory_entries!inner` with no visibility filter, on a service-role client; `soul_wisdom` is readable by every circle member (`20260418_soul_wisdom.sql:45`). Private memories *do* get soul links, so the distiller converted owner-only content into a permanent circle-wide prompt block with no audit trail. Filtered in the existing JS step (NULL-safe, unlike a PostgREST `neq`) | `supabase/functions/distil-soul-wisdom/index.ts:89` | **HIGH — privacy** |
| M6 | **`searchCircleMemory` has never returned a result.** Selected `author_id` from `circle_memory`, which has no such column — it is `last_edited_by` (`20260226_hitl.sql:6`). PostgREST rejected every call | `supabase/functions/swanbot-v2-ai/index.ts:347` | MED |
| M7 | **Office Pin button could never show pinned state.** `mapMemory` projected 20 columns but not `pinned`, though the column is real and `pinMemory`/`unpinMemory` write it. `AgentMemoryPanel` branched on `mem.pinned` → always `undefined`: label permanently "Pin", clicking a pinned memory re-pinned it, unpinning from Office was impossible | `src/lib/agentRunSystem.ts:1553` | MED |
| M8 | **Test-gate hole: 127 of 424 smoke suites never ran.** Verified by running all of them: **120 pass** (92s total) and were simply never chained into `smoke:all`; 4 of those were memory suites carrying 8,787 assertions (`memory-turn-assembly`, `memory-provenance`, `memory-novelty-filter-core`, `chat-memory-label`). All 120 are now chained — `smoke:all` goes 297 → 421 suites | `package.json` | **HIGH — gate integrity** |

### M8 fallout: three suites that were failing invisibly

Not chained (they would break the gate). These are **real pre-existing
failures** that the gate hole was hiding:

- `smoke:tool-description-lint` — `git.run` and `local.run_shell` are
  auto-approved mutation/side-effect tools "outside the documented doctrine";
  `verification.lint` / `verification.tests` lack required when-to-use guidance.
- `smoke:tool-loop-stuck-breaker` — `wiring: multi-tool rounds are not
  interrupted by the single-call guard`.
- `smoke:computer-app-action-contract` — fails; cause not yet diagnosed.

## Build wave (3 parallel agents, disjoint file ownership)

| # | Built | Evidence |
|---|---|---|
| B1 | **`/remember` data-loss fixed** + new pure `src/lib/memoryDedupeCore.ts`. `memorySimilarityScore` returned a flat `0.92` on ANY substring containment and divided token overlap by `min(size)`, so `/remember postgres` scored **1.0** against any memory containing "postgres" and **UPDATEd it in place**, destroying it. Containment now requires the shorter side ≥24 chars AND ≥0.6 of the longer, scored `0.5+0.5*ratio`; overlap is Jaccard. `/remember postgres` now scores **0.071**. `inferExplicitMemoryKey` returned a HARDCODED constant for any "consider tradeoffs"-ish text, collapsing unrelated memories onto one key; now reserved for genuinely-canonical content, else `${kind}.${slug80}.${digest}`. A third bug surfaced during the fix: `buildRememberTitle` handed the same constant title to the same inputs, giving `titleScore` 1.0 — so the fallback would still have destroyed the row after the key fix | `smoke:memory-dedupe-core` **118 passing**, incl. both named regressions |
| B2 | **Agent-memory key asymmetry fixed** + new pure `src/lib/memoryLookupKeyCore.ts`. `buildMemoryContext` had no aliases parameter, so the model read alias-blind while the Office UI read alias-aware — after any session→published rotation or bridge reconnect the memory stayed *visible in the panel but invisible to the model*. Aliases now threaded from the existing subject payload. Agent-scope reads were also hard-capped at `.limit(20)` regardless of the caller's request (the panel asks 200). `loadMemories` now **warns loudly** when agent scope is requested with no lookup id — the silent-empty that hid this class of bug | `smoke:memory-lookup-key-core` **67 passing**, incl. a rotation round-trip with a CONTROL assertion reproducing the shipped bug |
| B3 | **Credential capture gate closed.** The refusal guard existed for `user_memory` only; every `memory_entries` writer bypassed it. The old guard was both too weak (`\b` fails after `_`, so `GITHUB_TOKEN=…` was invisible; bare `ghp_`/PEM/JWT/`AKIA` with no credential noun were invisible) and too blunt ("the API key is stored in the vault" was refused). Rebuilt as 5 layers — literal provider shapes, secret-named assignment, noun+copula+value with a bounded prepositional gap only, bare `password <v>`, and an entropy backstop tuned on a 20k-sample sweep. Wired at `agentRunSystem.saveMemory` (which covers every `memoryService` writer transitively) and both edge functions. **Refuses rather than redacts** — a partial redaction that misses one span looks safe and isn't — and never silently: every refusal warns with a rule id and returns a value-free reason | `smoke:user-memory-caps` **142 passing**, incl. wiring assertions that fail if a gate call is ever deleted; `deno check` exit 0 on both edge functions |
| B4 | **SOUL memory readers fixed** (I finished this one; it was blocked on file ownership). `getLatestSpiritMemoryReferences` and `getSpiritMemoryEntries` called `loadMemories({scopes:['agent']})` with no agent id — a combination that runs **no query at all**, so both returned `[]` unconditionally and `SoulMemoryScreen` was permanently empty. Their callers only ever hold a `spiritId`, so demanding an agent id was the wrong shape: they now query by the `metadata.soul_key` mirror the write path already stamps, owner-scoped | `src/lib/memoryService.ts` |

Residual, queued not done: `src/lib/agentSessionMemory.ts:290,473` write `memory_entries` with **direct inserts that bypass `saveMemory`**, carrying bridge/session transcript material — a realistic path for an agent to echo a token into a permanent row. Same one-line guard closes it.

## Wave 2 (2026-07-27)

| # | Fix | File | Severity |
|---|---|---|---|
| M9 | **Credential gate bypassed by direct session-memory inserts.** `agentSessionMemory.ts` writes `memory_entries` at two sites with DIRECT inserts that never pass through `agentRunSystem.saveMemory`, where the app-wide credential-shape gate lives. Their payload is bridge/session **transcript** material (recent responses, tool output, active files) — the most realistic path for an agent to echo a token into a permanent, prompt-injected row. Both sites now refuse credential-shaped content and log the matched rule id (never the value) | `src/lib/agentSessionMemory.ts:264`, `:447` | **HIGH — security** |
| M10 | **Provenance inserts failed invisibly.** `memory_sources` and `memory_evaluations` were fired as `void … .then(() => {})`, which swallows the error branch — so a memory could exist while its provenance and quality-score rows silently did not. Still fire-and-forget (provenance must never fail a memory write), now with both rejection paths logged | `src/lib/memoryService.ts:3205` | MED |

| M11 | **`circle_memory` lost-update race fixed.** `updateMemoryDoc` read `existing`, then UPDATEd filtered only on `(circle_id, doc_kind)` with `version: existing.version + 1` — no predicate on the version it had read. Two concurrent editors both reading v3 both wrote v4: the first edit vanished AND both history rows archived the same prior content, so it was unrecoverable even from the audit trail. Now every decision comes from the pure `src/lib/circleMemoryWriteCore.ts`; the UPDATE carries `.eq('version', expectedVersion)` with `.select('id')`, a 0-row result is triaged against a fresh read (`converged` / `safe_retry` / `diverged` / `vanished` / `blocked`) and retried against the new base. Returns a structured result while every existing call site keeps compiling untouched | `src/services/sharedMemory.ts:93` | **HIGH — data loss** |
| M12 | **Compaction is now undoable and audited.** It UPDATEd `circle_memory.content` directly — the single most destructive memory operation was the ONLY write path that wrote no `circle_memory_history` row and never bumped `version`, silently desyncing version from history for every write after it. Now routed through the shared audited path, and pinned via `guardBaseContent` to the exact document the approved summary was generated from (`payload.originalContent`) — so an edit made between proposal and approval is refused rather than summarised away by a change the approver never saw | `src/lib/circleMemoryCompaction.ts:243` | **HIGH — data loss** |

Validation: `smoke:circle-memory-write-core` — **39 assertions, green on first run** — asserting the four invariants that make the old failures impossible: every content change plans an undo row; every update carries a concurrency predicate; a losing write is detected rather than silently dropped or silently applied; ambiguous input refuses rather than guessing (a non-string `nextContent` coerced to `''` would have wiped the shared doc behind a well-formed audit trail).

### Note on the wave-2 agent fleet

A 12-agent parallel wave was attempted and **all twelve stalled on the runner's
no-progress watchdog**. Root cause was environmental, not the task decomposition:
the machine hit load average 24 (a second Claude session plus Chrome plus the
fleet), and the agents' large parallel file reads and multi-minute foreground
`npm run typecheck` calls each looked like "no output for 600s".

Verified consequence: **none**. Every agent died during its read/planning phase —
no partial file was written, no half-edit was left behind, and `typecheck` +
the memory smoke suite were re-run afterwards to confirm it. The only cost was
time.

Lessons folded into the relaunch: cap concurrency at ~2 on a loaded box, forbid
foreground commands over ~2 minutes (typecheck runs centrally instead), and
require targeted `grep`/`sed` range reads rather than bulk-reading 3,000-line
files.

## Wave 3 (2026-07-28) — 6-agent fleet

Machine load had recovered (24 → 4), and with the stall causes designed out of
the prompts (no foreground `typecheck`, targeted `grep`/`sed` reads, chunked
writes, no `package.json` contention) **all six agents completed**.

| # | Shipped | Evidence |
|---|---|---|
| M13 | **Chat memory capture revived** — the headline gap. Extraction now routes through `llm-proxy` (mirroring `memoryEmbeddings.callEmbedProxy`: same breaker, plus a 20s abort and provider cache), walking the user's BYOK providers then the three `llm-proxy` can key from its own env — so it works with **zero user keys** and the platform flag `false`. Failures are no longer silent: `no_provider` / `provider_error` / `parse_failed` each warn, separated from a quiet `nothing_to_save`. Additive optional result fields only, so `ChatTab` compiles untouched. Also fixed `editMemory` to re-embed on title **or** content change. The new core also hardened the parser (the old `/\[[\s\S]*\]/` fused two arrays in chatty output into an unparseable blob) and fenced the conversation as untrusted data | `smoke:memory-extraction-core` **309** |
| M14 | **Retrieval quality** — all four defects. `pinned` now flows end-to-end (migration adds it to `match_memories`' RETURNS TABLE; `mapMemoryEntry` projects it), a relevance floor replaces `matchThreshold: 0`, the bundle uses `fitCandidatesToBudget` with reservations instead of `join().slice(5000)` (which cut the query-relevant section first), and the ILIKE fallback became a **union** run in `Promise.all` rather than an `else` — so un-embedded rows stop being permanently unreachable. Thresholds calibrated to `text-embedding-3-small`'s actual score bands, documented inline | `smoke:memory-retrieval-policy-core` **204** |
| M15 | **Embedding coverage** — `queueMemoryEmbedding` (sync, void, never throws, 250ms coalesce + 50/batch) plus `ensureMemoryEmbeddingCoverage`, a self-arming throttled repair sweep. Deliberately **no cron**: `llm-proxy` needs a user JWT and resolves the key from that user's BYOK settings, so a service-role cron literally cannot embed on a user's behalf. An orphan ledger arms on every give-up (breaker open, proxy error, vector-write failure) and sweeps once the breaker closes, so rows written during an outage stop being orphaned forever. The agent also caught a latent bug of its own: a `finally` that cleared the in-flight marker before it was assigned, permanently wedging the queue | `smoke:memory-embedding-policy-core` **259** |
| M16 | **Run-outcome capture** — agent runs finally distil memories. Requires BOTH a reusable subject (lane > route > profile; plain chat resolves to none and can never write) and a transferable finding, with a deliberate asymmetry: failures need strength ≥1, successes ≥2 **plus explicit proof**. Four noise gates (prompt restatement, generic completion, one-off-value, credential shape). `cancelled` is refused outright as a statement about the user, not the world; `inconclusive` is never framed as success. Fires at both barriers, unawaited, fully guarded | `smoke:run-outcome-memory-core` **173** |
| M17 | **Memory security/index migration** — a *convergence* migration for the four conflicting `memory_entries` RLS revisions, plus `circle_memory` policy repair, the `memory_evaluations` visibility predicate, a real `WITH CHECK` for `memory_access_log`, trigram indexes replacing the dead FTS index, sort-matching indexes, and `SET search_path` on the SECURITY DEFINER maintenance functions. Mirrored to `RUN_THIS_SQL.sql` §30 + roadmap rows, **Pending** | `20260728_memory_security_and_indexes.sql` |
| M18 | **Non-masking smoke runner** (`scripts/run-smokes.mjs`, `smoke:report`) — discovers suites from `package.json` (never a hardcoded list), runs all with bounded concurrency and a **Node-implemented** timeout (macOS has no GNU `timeout` — shelling out to it once produced a bogus 127/127-failure report here), reports failures + slowest + registration drift, exits non-zero on any failure | see below |

### Gate integrity, final state (2026-07-28)

Three separate holes, all now closed:

| Hole | Found | Now |
|---|---|---|
| Suites registered but never chained into `smoke:all` | 127 of 424 | 0 (120 chained; the 2 genuinely-failing ones deliberately left out) |
| Suites on disk with **no `package.json` entry at all** — never run, ever | 25 | 0 — all 25 run and **all 25 pass** |
| `&&`-chain masking: first failure silently skips the rest | 273 suites unrun | `smoke:report` runs every suite and reports |

`smoke:all` now chains **484** suites. The only unchained entries are the three
runner aggregates (`smoke:report`, `:json`, `smoke:drift` — excluded by shape so
they cannot recurse) and the two genuinely-failing suites.

### The repo's first true green/red count

`smoke:all`'s `&&` chain had never revealed this. `smoke:report` over **486 suites: 477 pass, 9 fail, 0 time out.**

The runner also found **25 `*-smoketest.ts` files on disk with no `package.json` entry at all** — they have never run, ever. That is on top of the 127-suite chain hole found on 2026-07-24.

All 10 failures were traced to owners; **none belong to this memory work**:
- 7 are a concurrent session's in-flight edits (`swanbot-v2-*`, `wordpress-admin-source-intelligence`, `delegation-wiring`, `database-authority-guards`, `desktop-action-summary-replay`).
- 2 are the long-standing unchained pair (`tool-description-lint`, `tool-loop-stuck-breaker`).
- `smoke:agent-runtime` was traced to `runChatAutomationPlan.ts`, where that session changed the user-facing error text (`"Technical details were saved for recovery"` → `"No uncertain action was replayed"`) and dropped the `rawError`/`warnings` diagnostics **without updating the assertions**. Confirmed by swapping in the HEAD copy of `agentRuntime.ts` and reproducing the identical failure.

### One bug I introduced and fixed

Wiring embed-on-write, I added a **static** top-level `import { queueMemoryEmbedding } from './memoryEmbeddings'` to `agentRunSystem.ts` and `memoryService.ts`. That module reaches `privacyMode` → **`react-native`**, which tsx cannot load — it would have broken every smoke that transitively imports either file. This is precisely why `memoryService` already dynamic-imported it. Replaced with a guarded dynamic import in both.

## The governance finding — docs promise consent the code does not deliver

`docs/AGENTS_ROADMAP.md:46` states: *"HITL gates on every write to memory or
skill library."* `CLAUDE.md:361` repeats it. **This is not true**, and the
clearest evidence is a dead ternary:

```ts
// src/lib/openswanToolRuntime.ts:4502
approvalMode: tool === 'save_memory' ? 'auto' : 'auto',
```

Both branches return `'auto'`. Every sibling field in the same object branches
correctly on the identical condition (`mutatesState`, `approvalKind`, `summary`),
so this was an `'ask' : 'auto'` that got flipped and never restored.

Two independent layers then fail open:
- **Tool layer** — `openswanToolRuntime.ts:5954` returns `not_required` unless
  `approvalMode === 'ask'`. `memory.pin/unpin/forget` have no policy branch at
  all and fall through to the coordination default.
- **Plan layer** — `chatApprovalGate.ts:127` falls through to
  `plan.approval.required`, hard-coded `false` for the memory route
  (`chatAutomationPlanner.ts:492`).

Consequences: exactly **three** memory write paths are actually gated
(`memory.compact`, `user_memory.replace/delete`, `skills.manage`). Everything
else — including `memory.forget` **deletions** — writes silently. A user who sets
`memory_write: 'never'` in `chatAutoApproveSettings.ts:37` **cannot block
`save_memory`**, because the `'never'` check lives inside a block that is never
reached. The two layers also disagree on whether forgetting is a write
(`openswanToolRuntime.ts:5869` says yes; `chatAutoApproveSettings.ts:60` says no).

**Deliberately NOT auto-fixed.** Flipping the ternary to `'ask'` is a one-word
change, but it would make the agent prompt on essentially every turn that saves a
memory — a significant UX change that is the product owner's call, not a
janitorial fix. The honest options are: (a) flip it and accept the prompts,
(b) gate only destructive memory ops (`forget`/bulk-deactivate) and leave
additive saves auto, or (c) change the docs to describe what the code actually
does. **(b) is the recommendation** — it matches the risk profile and preserves
flow — but any of the three is better than the current state, where the
documentation asserts a guarantee the runtime does not enforce.

## Verified and NOT yet fixed — ranked backlog

### Capture

1. **HIGH — chat extraction is dead** (the headline above). Fix: route
   extraction through `llm-proxy` instead of a client platform key. **M**
2. **HIGH — `memory_entries.source_run_id` is NULL for every row in the app.**
   Only `memoryService.ts:3212` forwards one and nothing passes it;
   `saveAgentMemory`, `saveSharedTaskMemory`, `captureOpenSwanOutcomeMemory`
   don't accept the param. A memory can never be traced to the run that produced
   it — the core accountability claim. `agentRuntime.ts:628` already has `runId`
   in hand. **S**
3. **HIGH — the agent-run loop and the whole Computer Use pipeline distil zero
   memories.** Zero inserts across `agentRunPersistence.ts`,
   `agentExecutionCore.ts`, `computerTaskRuntime.ts`, `computerUse.ts`,
   `computer-use-agent/index.ts` (0 `memor` hits in 4,755 lines). Which adapter
   worked for Photoshop, which selector worked in the WP admin — discarded every
   run, so failures repeat forever. **M**
4. **HIGH — live builder has no capture.** `build-stream/index.ts` has zero
   `.from(` calls at all; its caller reads memory and writes none back. **M**
5. **MED — dedupe regression in the v2 migration target.**
   `swanbot-v2-ai save_memory` (`:905`) inserts unconditionally; v1
   fetch-then-updates (`swanbot-ai:247`). **S**
6. **MED — only `session` scope dedupes** (`agentRunSystem.ts:1088`); circle,
   user, room and agent writes have none, while four incompatible dedupe
   strategies are reinvented above it. Circle memory — the shared, team-visible
   surface — is the one with no dedupe. **M**
7. **MED — `source_surface` hardcoded to `'feed_task'`** for all agent-scope
   memories (`memoryService.ts:2925`, `:3073`) regardless of origin, then
   rendered to the model as `src:feed_task`. Provenance shown to user and model
   is actively wrong. **S**
8. **MED — approved compaction destroys circle memory with no history row and
   no version bump** (`circleMemoryCompaction.ts:251`), while the sibling path
   (`sharedMemory.ts:91`) writes history and bumps version for every update. The
   most destructive memory op is the only one with no undo. **S**
9. **MED — lost-update race on `circle_memory`** (`sharedMemory.ts:89`): reads,
   then writes `version: existing.version + 1` with no `.eq('version', …)`
   predicate. Two concurrent editors both read v3 and both write v4. **S**
10. **LOW — dead "auto-save memory" toggle** in the Office terminal
    (`AgentTerminalPanels.tsx:236`): persisted, parsed, and read by nothing. A
    user-visible promise of capture that is entirely unbacked. **S**

### Retrieval / injection

11. **HIGH — the DEFAULT chat lane receives no memory at all.**
    `swanbot-v2-ai`'s `buildFrozenBlock` reads only the `circles` row; the
    memory-bearing client-loop branch is behind a default-OFF flag
    (`swanbotV2ClientLoopFlag.ts:68`). The model's only recall is the
    `searchCircleMemory` tool — which queries the legacy `circle_memory` doc
    table, not `memory_entries`. **The entire semantic pipeline is dead code on
    the default lane.** **M**
12. **HIGH — un-embedded memories are invisible forever** (see headline). **M**
13. **MED — `buildPromptMemoryBundle` slices AFTER concatenation**
    (`memoryService.ts:1328`), and query-ranked turn retrieval is 4th of 5
    sections — so bulky startup/wisdom text truncates exactly the memories
    selected *because* they match this turn. Same shape at
    `openswanMemoryStores.ts:249`. **M**
14. **MED — no relevance threshold**: `matchThreshold: 0` and no score floor, so
    on a small circle the top-12 cosine matches on an unrelated question still
    fill a full memory block. Keyword-fallback rows get a flat synthetic `0.5`,
    ranking lexical noise above weak semantic hits. **S**
15. **MED — `pinned` never boosts retrieval**: `match_memories`' `RETURNS TABLE`
    omits the column and `mapMemoryEntry` omits it too, so `pinnedBoost = 0.12`
    is dead on both branches. User pinning has no retrieval effect anywhere. **S**
16. **MED — truncation can sever the closing `</untrusted_quoted>` fence.**
    `chatPromptAssembly.ts:332` slices section bodies that are already wrapped;
    `turn_retrieval` (priority 82) is a truncate-not-drop candidate, so a long
    memory can leave an unterminated fence that swallows the trusted sections
    below it. `wrapUntrusted`'s own `maxChars` truncates *inside* the fence
    correctly — the section layer just doesn't use it. **S**
17. **MED — no supersession or contradiction handling at read time.**
    `memory_entries.supersedes_id` exists and has **zero readers** repo-wide.
    Recency decay floors at 0.6, so a 2-year-old memory keeps ≥60% of its score
    and a higher-similarity stale row beats a fresher correction. **M**
18. **MED — delegated/spawned agents and computer-use runs cannot recall
    anything the user said in chat** (`chatAgentContextPack.ts`,
    `agentSpawner.ts`, `connectedAgentDispatch.ts`, `bridgeTaskDispatcher.ts`,
    `computer-use-agent` all 0 hits). **M**

### Office / per-agent

19. **HIGH — the agent's own `save_memory` tool never writes agent-scoped
    memory**: `openswanToolRuntime.ts:11009` hardcodes `scope:'circle'` with no
    `agentId`/`userId`, so everything an agent decides to remember lands in
    circle scope, identical for every agent. "Agent Private Memory" in the
    Office panel is near-empty by construction. **S**
20. **MED — user-corrected memory keeps its stale embedding**:
    `editMemory` (`agentMemory.ts:391`) updates content with no re-embed, unlike
    the auto-update branch. Undercuts guarantee #3 ("…and fix it"). **S**
21. **MED — no provenance in the Office panel.** `AgentMemoryPanel` never reads
    `source_run_id`, `source_surface`, `memory_sources` or `memory_access_log`.
    The trace layer exists (`memoryActions.ts:265`) but only chat consumes it.
    The god plan calls this gap "✅ Shipped" — true for Chat, **false for
    Office**. **M**
22. **MED — the Office floor surfaces zero memory signal.** No memory field on
    the roster card or pixel agents; `AgentMemoryPanel` is tab 3 of ~9, lazily
    mounted, two clicks deep with no upstream hint. **M**
23. **MED — N+1 fan-out**: `AgentMemoryPanel:110` calls `getUserMemories` once
    per alias (~5 aliases ≈ 25 queries) on mount, on every circle
    `memory_entries` change, and on a 30s poll. **S**
24. **MED — `soul_wisdom` is read-wired but its only writer is a disabled
    cron** (`20260527_pause_recurring_anthropic_jobs.sql:17`), and the fn no-ops
    on `AUTONOMOUS_AI_PAUSED`. Degrades gracefully via on-the-fly synthesis, so
    stale-not-broken. Ops decision needed. **S**
25. **SUSPECTED — subject-key collapse on name.** `agentRuntimeSubject.ts:18`
    matches `name === 'openswan' | 'blackswan'` and forces
    `subjectKey = 'blackswan'`, so a user-created agent with either name could
    share agent memory with the main agent. Not reproduced. **S**

### Schema / RLS / privacy

26. **HIGH — the entire `memory_entries` security model is untracked in the SQL
    checklist**, and **four migrations each rewrite the same policy names**
    (`20260408_memory_privacy_fix`, `20260408_memory_v2_retrieval_privacy`,
    `20260413_agent_memory_private_rls`, `20260413_agent_memory_private_owner_only`).
    The interim revision explicitly lets **any circle member SELECT
    `visibility='private'` agent memories**; only the owner-only follow-up
    closes it. Per this repo's own rule a local migration is not proof — and
    there is no recorded way to know which one production is running.
    **Verify first: `SELECT policyname, cmd, qual FROM pg_policies WHERE
    tablename='memory_entries';`** **S**
27. **HIGH — private agent memory is auto-promoted to `circle_shared` with no
    HITL and no redaction.** `promoteAgentMemoriesToSharedPatterns`
    (`memoryService.ts:3097`) copies `mem.content.slice(0,240)` into a
    circle-shared row; the private content it copies includes raw
    `prompt.slice(0,260)` / `response.slice(0,320)` excerpts. Violates the
    roadmap's "memory writes must go through HITL". **M**
28. **HIGH — `circle_memory` shipped with `USING (true)`** (`20260226_hitl.sql:59`,
    `20260313_missing_tables.sql:278`) — full cross-tenant read/write. Two later
    migrations fix it but **neither is in the §5 checklist**. If
    `20260411_memory_cleanup.sql` never ran in production this is live. Verify
    before anything else. Also: still no DELETE policy on either table. **S**
29. **MED — `memory_evaluations` RLS ignores visibility**
    (`20260408_memory_v2_retrieval_privacy.sql:117`), unlike its sibling
    `memory_sources_access` which checks it. Any circle member can enumerate and
    read feedback about every private memory. **S**
30. **MED — no redaction anywhere on the capture path.** The credential guard
    exists for `user_memory` but is bypassed by every `memory_entries` writer
    (*being fixed in the build wave*). **S**
31. **MED — "delete my data" is soft-only.** Every user-facing delete is
    `is_active: false`, so the `ON DELETE CASCADE` FKs never fire: content, the
    1536-dim embedding, `memory_sources.excerpt` and the access log all survive
    "forget that". Inverse failure: `memory_entries.user_id` is `ON DELETE
    CASCADE` to `auth.users`, so deleting a user destroys the `circle_shared`
    memories they authored. **M**
32. **MED — the keyword retrieval path is a guaranteed sequential scan.**
    `idx_memory_entries_fts` is a tsvector GIN index but no caller uses
    `.textSearch()`; the fallback builds `ilike` filters a GIN index cannot
    serve. `pg_trgm` is enabled repo-wide but no trigram index exists on
    `memory_entries`. **S**
33. **MED — no index supports the hot prompt query's sort**
    (`circle_id, is_active` filter + `importance DESC, updated_at DESC` sort).
    Also no index and no retention job on `memory_access_log`, written 12-15
    rows per turn. **S**
34. **LOW — `logMemoryAccess` rows are dropped when `userId` is undefined**:
    the policy is `FOR ALL … USING (user_id = auth.uid() OR run_id IN …)` with
    no `WITH CHECK`, so USING is reused for INSERT and rejects the row. **S**
35. **LOW — SECURITY DEFINER maintenance functions lack `SET search_path`**
    (`20260411_memory_cleanup.sql:34`, `20260419_memory_maintenance.sql:28,84`),
    unlike the fix applied elsewhere in `20260518_fix_pgcrypto_search_path.sql`. **S**

### Fragmentation

36. **MED — four pure retrieval cores are built, smoke-tested, and unwired**:
    `memoryTurnAssemblyCore` (the double-embed it documents is still live —
    `buildPromptMemoryBundle:1206` and `swanbot.ts:3167` embed the same query
    twice per turn), `circleMemoryDigestCore`, `chatRetrievalRankCore`,
    `retrievalMemoCore`. Also `SwanBotContext.memoryContext` is declared and
    never consumed. **M** each — each needs real wiring, not a drop-in.
37. **MED — novelty and provenance gates run only on the READ path.**
    `memoryNoveltyFilterCore` and `memoryProvenanceCore` have exactly one
    importer (`openswanMemoryStores.ts`, prompt assembly), so duplicates are
    filtered when memories are *read* and still accumulate in the DB. **M**

## Confirmed working — do not re-report

Feed task capture (`taskExecutionRuntime.ts:515`), Feed missions
(`missionAgentDispatch.ts:77`), Rooms (`roomChatService.ts:171`), OpenSwan
sessions (`openswanSessionRuntime.ts:2843`), external CLI session capture
(`agentSessionMemory.ts:324`), `user_memory` caps + credential hygiene.
`match_memories` is SECURITY INVOKER so semantic search honors RLS.
`user_memory` RLS is correctly owner-only with a real delete path. `agent_memory`
is properly scoped through `agent_bonds`. `memory_soul_links` correctly mirrors
`memory_entries` visibility. The OpenSwan/SwanBot chat path is key-symmetric
(reads and writes both on `runtimeSubject.memoryAgentId`).

## Verification

`npm run typecheck` — clean in every file this work touched. Two pre-existing
errors in `src/lib/openswanToolRuntime.ts` belong to a concurrent session
editing this repo, not to this work.

Smoke: each of the 120 newly-chained suites was run **individually** and passed
(120/120, 92s total) — that is the evidence they are green.

**`smoke:all` itself is currently RED, and was already red before this work.**
It halts at suite **148 of 421** on
`smoke:wordpress-admin-source-intelligence`:

```
FAIL: browser bridge reads page content only inside local bridge
```

That assertion requires `await launched.page.content()` in
`scripts/browser-bridge.js`; the string is currently absent because a
**concurrent session is mid-edit on the browser bridge** (`scripts/browser-bridge.js`
and `src/lib/browserBridge.ts` are both dirty). Not caused by this work, and not
this work's to fix.

### Structural problem this exposed

`smoke:all` is a single `&&` chain, so the first failure aborts it and the
remaining **273 suites never run at all** — silently. That is the same masking
class that previously hid a real backoff bug for weeks, and it is why the
127-orphaned-suite hole (M8) went unnoticed for so long: even a chained suite
only runs if every suite before it passes.

Recommended follow-up (**not** applied — it changes the semantics of the
project's main gate and `package.json` is currently contended): replace the
`&&` chain with a runner script that executes every suite, prints a failure
summary at the end, and exits non-zero if any failed. Same gate strength, no
masking, and it would make the true green/red count visible for the first
time.
