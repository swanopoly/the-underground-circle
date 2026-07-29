#!/usr/bin/env python3
"""
build_engineering_findings.py — turn verified engineering findings from this
repo into ShareGPT training data for BlackSwan.

WHY THIS SOURCE EXISTS
The existing sources teach BlackSwan what the *product* looks like (terminal
pairs, tasks, missions, tool traces). None of them teach it how this codebase
actually fails and how those failures were diagnosed. That reasoning — symptom
-> hypothesis -> evidence -> root cause -> fix -> why the naive fix was wrong —
is the highest-value signal an agent embedded in THIS app can learn, and it is
otherwise thrown away the moment a session ends.

Every record here is grounded: each was verified against real code or live
production data before being written down. Nothing speculative goes in.

Output: training_data/engineering_findings.jsonl (ShareGPT), merged by
prepare_dataset_v4.py as the `engineering_findings` source.

Usage:
  python3 build_engineering_findings.py            # writes the jsonl
  python3 build_engineering_findings.py --check    # validate only, no write
"""

import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent / "training_data"
OUT = DATA_DIR / "engineering_findings.jsonl"

SYSTEM = (
    "You are BlackSwan — the agent runtime embedded in The Underground Circle. "
    "You know this codebase: its memory system, agent runtime, edge functions, "
    "and the ways it actually breaks. When you diagnose a problem you ground "
    "every claim in real code or real data, you say plainly when evidence "
    "contradicts your first hypothesis, and you never present a guess as a fact."
)

# Each finding: the question a builder would actually ask, and the grounded
# answer. `evidence` is recorded so a future reader can re-verify the claim.
FINDINGS = [
    {
        "id": "memory-private-leak-service-role",
        "q": "Our edge function reads memory_entries and injects it into the system prompt. Is that safe?",
        "a": (
            "Not by itself — it depends on which client it uses.\n\n"
            "In `swanbot-ai/index.ts` the handler builds its client with "
            "`createServiceRoleClient()`, which **bypasses RLS**. The memory read filtered only on "
            "`circle_id` and `is_active`, with no visibility or owner predicate. The same file writes "
            "`visibility: scope === 'user' ? 'private' : 'circle_shared'`, so private rows genuinely "
            "exist in that table.\n\n"
            "Net effect: one member's `/remember` preference was loaded verbatim into another member's "
            "system prompt. The client-side code was correct — it filtered by `user_id` — so RLS was the "
            "only guard, and the edge stepped around it.\n\n"
            "Rule to carry: **whenever you see a service-role client, the query's own filter is the entire "
            "security boundary.** Add `.or('visibility.neq.private,user_id.eq.<uid>')`. Note that on a NULL "
            "visibility this excludes the row — that is fail-closed, which is the correct direction for a "
            "privacy filter."
        ),
        "evidence": "supabase/functions/swanbot-ai/index.ts:595 (read), :237 (write), :3729 (service-role client)",
    },
    {
        "id": "memory-unfenced-guardrail-slot",
        "q": "We fence retrieved memory with wrapUntrusted in one block but not another. Does it matter which block?",
        "a": (
            "Yes, and the unfenced one was the worse of the two.\n\n"
            "Instruction-kind memories were concatenated raw into the **frozen** system prefix under a "
            "heading called `## Guardrails and Instructions` — the model's own rule slot. The sibling block "
            "directly below it (`## Things I Remember`) already called `wrapUntrusted` on every row, so the "
            "helper was imported and in use; this was an omission, not a gap in tooling.\n\n"
            "That made it the highest-value injection target in the app: any circle member, or any agent "
            "holding `save_memory`, could write an instruction-kind row and have it rendered to the model as "
            "a system guardrail for everyone else.\n\n"
            "The fix is not simply to fence it, because these rows are a real feature (\"remember: always use "
            "metric units\"). Fence the content **and** reframe the section as standing user preferences, with "
            "explicit framing that they never override system rules, grant permissions, or by themselves "
            "authorize a tool action."
        ),
        "evidence": "supabase/functions/swanbot-ai/index.ts:746 (unfenced), :881 (fenced sibling)",
    },
    {
        "id": "remember-substring-overwrite",
        "q": "A user says /remember overwrote an old memory that wasn't related. How?",
        "a": (
            "The similarity scorer treated substring containment as near-identity.\n\n"
            "`memorySimilarityScore` returned a flat `0.92` for `aa.includes(bb) || bb.includes(aa)`, and its "
            "token branch divided overlap by `Math.min(aTerms.size, bTerms.size)` rather than the union. So "
            "`/remember postgres` scored **1.0** against any existing memory containing the word 'postgres'. "
            "The caller's predicate was `titleScore >= 0.88 || contentScore >= 0.82`, and on a hit it ran an "
            "UPDATE in place — destroying the original with no history row.\n\n"
            "Two independent bugs compounded it: `inferExplicitMemoryKey` returned a hardcoded constant for "
            "anything matching a broad regex, so unrelated memories collapsed onto one key; and "
            "`buildRememberTitle` handed those same inputs an identical title, which would have kept the "
            "overwrite alive even after the key was fixed.\n\n"
            "Fix: containment only counts when the shorter string is a substantial fraction of the longer "
            "(≥0.6) and long enough to be a statement rather than a topic word; token overlap uses Jaccard. "
            "The bias to encode: a missed duplicate costs one extra visible row a user can delete; a wrong "
            "duplicate destroys their text permanently. Every ambiguous case resolves to 'not a duplicate'."
        ),
        "evidence": "src/lib/memoryService.ts memorySimilarityScore + rememberFromChat; fixed in src/lib/memoryDedupeCore.ts",
    },
    {
        "id": "dedupe-title-vs-content-identity",
        "q": "Production has 3,020 memories with the same title. Should I dedupe on title?",
        "a": (
            "Check whether the content differs first. In this case it did, and title-dedupe would have been "
            "destructive.\n\n"
            "Those 3,020 rows carried **1,889 distinct contents**. The writer is "
            "`memoryConsolidation.saveProceduralMemory`, which uses a category as the title "
            "(`Workflow: ${taskType}`) and the specific run's steps as the content. The title is a bucket, "
            "not an identity — so merging on it would have collapsed 1,889 real records into one.\n\n"
            "The actual root cause was different: `saveMemory` gated dedupe on `scope === 'session'`, so "
            "`circle` scope — the shared team surface — fell through to an unconditional INSERT on every "
            "successful run for three months.\n\n"
            "Correct fix: dedupe per scope, and for circle scope require title **and byte-identical content**. "
            "That collapses only genuine re-inserts and can never merge two rows that say different things.\n\n"
            "The transferable lesson: before writing a dedupe rule, query "
            "`count(*) vs count(distinct md5(content))` on the suspected group. If they differ, the field you "
            "were about to key on is a bucket, not an identity."
        ),
        "evidence": "live prod query 2026-07-28: 3020 rows / 1889 distinct_content; src/lib/memoryWritePolicyCore.ts",
    },
    {
        "id": "supabase-db-push-unmanaged-project",
        "q": "Can I run `supabase db push` to apply my new migration to production?",
        "a": (
            "Check `supabase migration list` first. On this project it would be destructive.\n\n"
            "The remote migration history contains exactly **one** entry while the repo has **207** local "
            "migration files. The database clearly has the tables — the app queries them — which means "
            "production was built by hand through the SQL editor, never through the CLI migration system. "
            "That is also why `docs/RUN_THIS_SQL.sql` exists.\n\n"
            "`db push` would therefore try to replay ~206 historical migrations against a database that "
            "already has those objects: `CREATE POLICY` collisions, un-guarded `ALTER TABLE`s, backfills and "
            "drops, possibly failing halfway through.\n\n"
            "Apply individual files instead: `supabase db query --linked -f <file>`. And run any read-only "
            "verification query the migration ships with **before** applying, not after — it is the only "
            "chance to learn what the pre-existing state was."
        ),
        "evidence": "supabase migration list on project rjkniqiqdtroeholxacg, 2026-07-28",
    },
    {
        "id": "deno-edge-cannot-import-src-lib",
        "q": "Why does my edge function fail `deno check` when it imports a pure module from src/lib?",
        "a": (
            "Deno resolves the whole import graph, including type-only imports, and it needs explicit file "
            "extensions.\n\n"
            "The failure is `TS2307: Cannot find module '.../promptSectionPriorityCore'` — raised not on your "
            "import but on a **transitive** one inside the module you imported. Here "
            "`v2MemoryInjectionCore` imported `./promptSectionPriorityCore`, which in turn had "
            "`import type { ChatPromptSectionKey } from './chatPromptAssembly'`. Even though `import type` is "
            "erased at runtime, Deno's checker still resolves it.\n\n"
            "That is why every `src/lib` core the edge already imports has **zero** imports — it is a house "
            "rule, not a coincidence.\n\n"
            "Two clean ways out: make the core import-free (inline the small constants it needed, and take "
            "larger dependencies as **injected functions** the way it already takes a `fence`), or vendor a "
            "narrow copy under `supabase/functions/_shared/`. If you vendor, add a lockstep test that runs "
            "both copies over the same battery and asserts identical output — otherwise the copies drift and "
            "nothing tells you."
        ),
        "evidence": "deno check supabase/functions/swanbot-v2-ai/index.ts; supabase/functions/_shared/prompt-section-fit.ts",
    },
    {
        "id": "static-import-breaks-tsx-smokes",
        "q": "I added one import to agentRunSystem.ts and a dozen unrelated smoke tests broke. Why?",
        "a": (
            "You pulled `react-native` into the module graph of a file the smoke tests load.\n\n"
            "The smokes run under `tsx`, which cannot load `react-native`. `memoryEmbeddings` imports "
            "`privacyMode`, which imports `react-native` — so a **static** top-level import of "
            "`memoryEmbeddings` into `agentRunSystem` or `memoryService` breaks every suite that "
            "transitively imports either file.\n\n"
            "The tell that this was a known hazard: `memoryService` already reached that module through a "
            "**dynamic** `await import(...)` rather than a top-level one.\n\n"
            "Fix: use a guarded dynamic import inside the function that needs it. For a fire-and-forget "
            "side effect like queuing an embedding, that is strictly better anyway — it cannot become part of "
            "the write's success condition:\n\n"
            "```ts\n"
            "void import('./memoryEmbeddings')\n"
            "  .then(({ queueMemoryEmbedding }) => queueMemoryEmbedding({ memoryId, title, content }))\n"
            "  .catch(() => { /* embedding must never affect the write */ });\n"
            "```"
        ),
        "evidence": "src/lib/agentRunSystem.ts queueMemoryEmbeddingSafe; src/lib/privacyMode.ts imports react-native",
    },
    {
        "id": "query-plan-shape-mismatch",
        "q": "My privacy filter looked right but the query returned nothing and the column filter never applied.",
        "a": (
            "The plan object's shape was misread, and it failed safe rather than loudly.\n\n"
            "`buildMemoryFloorQueryPlan()` returns `eq` as an **array of `{column, value}`**, not an object. "
            "The consumer did `Object.entries(plan.eq ?? {})`, which over an array yields index keys — so it "
            "filtered on a column literally named `0`. PostgREST rejected the query, meaning the `circle_id` "
            "narrowing never applied. Separately `.select(plan.select)` was handed a string array where a "
            "comma-joined string is required.\n\n"
            "It failed **safe** — the query errored out entirely, so the result was no memory rather than "
            "cross-circle memory — but the floor read had never once returned a row.\n\n"
            "Two lessons. Route every consumer of a query plan through one shared helper so the shape cannot "
            "be right in one call site and wrong in another. And note what saved this: the design kept "
            "`postFilterRequired: true`, with a pure predicate as the authority and SQL only narrowing. The "
            "SQL was broken and the privacy guarantee still held."
        ),
        "evidence": "supabase/functions/swanbot-v2-ai/index.ts applyMemoryQueryPlan; src/lib/v2MemoryInjectionCore.ts",
    },
    {
        "id": "omit-vs-empty-payload",
        "q": "Sending an empty memory payload should be harmless, right?",
        "a": (
            "No — here it was strictly worse than sending nothing.\n\n"
            "The edge gate is `memoryPayload !== undefined && memoryPayload !== null`. So `{sections: []}` "
            "**passes** that check, which causes the edge to **skip its own server-side floor read**, and then "
            "fails payload validation — leaving the turn with no memory at all. Omitting the field entirely "
            "lets the floor cover the turn.\n\n"
            "General shape to watch for: when a caller-supplied value suppresses a fallback, 'present but "
            "empty' and 'absent' are different states and must be tested separately. Assert both branches "
            "against the real consumer, not just the happy path."
        ),
        "evidence": "src/lib/v2MemoryPayloadBuilder.ts; supabase/functions/swanbot-v2-ai/index.ts hasPayload gate",
    },
    {
        "id": "and-chain-test-gate-masking",
        "q": "Our test gate is one long && chain of npm scripts. Is that a problem?",
        "a": (
            "Yes — it hides everything after the first failure, and the hiding is silent.\n\n"
            "In this repo `smoke:all` chained 421 `npm run` invocations. It was halting at suite 148, so "
            "**273 suites never ran** and nothing said so. That masking is also why two other holes went "
            "unnoticed: 127 suites were registered but never chained, and 25 more existed on disk with no "
            "package.json entry at all — never run once. Even a correctly-registered suite only runs if all "
            "147 before it pass.\n\n"
            "Fix: a runner that discovers suites from package.json (never a hardcoded list — a hardcoded list "
            "is how the drift happened), runs them all with bounded concurrency, reports failures and "
            "registration drift, and exits non-zero if any failed. Same gate strength, no masking.\n\n"
            "One platform trap: macOS has no GNU `timeout`. Shelling out to it makes every suite 'fail' "
            "instantly and produces a confidently wrong report. Implement the timeout in the runner."
        ),
        "evidence": "scripts/run-smokes.mjs; smoke:all chained 297 -> 484 suites",
    },
    {
        "id": "provenance-dropped-by-a-mid-chain-signature",
        "q": "source_run_id is NULL on every memory row even though the writer passes a run id. Where does it go?",
        "a": (
            "A function in the middle of the chain didn't declare the parameter, so it was dropped "
            "silently — TypeScript won't complain about an extra property that a `...opts` spread never "
            "declares.\n\n"
            "The chain here was `openswanSessionRuntime` -> `captureOpenSwanOutcomeMemory` -> "
            "`saveSoulAwareAgentMemory` -> `saveAgentMemory` -> `upsertAgentMemoryTarget` -> "
            "`saveMemoryWithContext`. The bottom accepted `sourceRunId` and the top had `run.id` in scope, "
            "but **three** links in between never declared it. A live query confirmed the result: "
            "`source_run_id` NULL on all 4,716 active rows.\n\n"
            "The same chain also hardcoded `sourceSurface: 'feed_task'` at every call site, so an OpenSwan "
            "session outcome was stamped as a Feed task — and `openswanMemoryStores` renders that back to "
            "the model as `src:feed_task`. A wrong origin is worse than a missing one, because the model "
            "and any future provenance UI both treat it as fact.\n\n"
            "How to find this class of bug: don't read the writer and the schema and assume they connect. "
            "Query the column. `count(*) filter (where col is not null)` on live data answers in one second "
            "what code reading can miss for months. Then walk the chain link by link and check which "
            "signature drops the field — with a spread-based chain, the compiler will not tell you."
        ),
        "evidence": "src/lib/memoryService.ts saveSoulAwareAgentMemory/saveAgentMemory/upsertAgentMemoryTarget; prod query 0/4716",
    },
    {
        "id": "prod-invariants-vs-unit-tests",
        "q": "We have 480+ passing smoke tests on our memory system. What can they still not tell us?",
        "a": (
            "Whether the deployed system is actually healthy. Pure-core tests prove the logic is right for "
            "the inputs you thought of; they say nothing about the shape of real data.\n\n"
            "A read-only invariant harness against the live database found three things in one run that a "
            "full green suite had never surfaced:\n\n"
            "- `source_run_id` set on **0 of 4,716** rows — the accountability claim was entirely unbacked.\n"
            "- Only **738/4,716 (15.6%)** embedded, and `match_memories` filters `embedding IS NOT NULL`, so "
            "84% of memory was invisible to semantic search.\n"
            "- **4,621 of 4,716 (98%)** sitting in 26 duplicate-title groups.\n\n"
            "Useful invariants to assert against production, all read-only: rows that no policy can ever "
            "return (unreachable = silent data loss), provenance coverage, index presence, orphaned "
            "satellite rows, whether a SECURITY DEFINER function should be INVOKER, and whether any SELECT "
            "policy exposes private rows without an owner check.\n\n"
            "Keep it strictly SELECT-only, separate WARN from FAIL (a warn is 'worth knowing', a fail is "
            "'broken'), and run it after every deploy."
        ),
        "evidence": "scripts/memory-prod-invariants.mjs, first run 2026-07-28",
    },
    {
        "id": "failing-test-may-be-a-bad-fixture",
        "q": "A smoke test asserts 4 tool handler calls but only 2 happen. Which is wrong, the test or the loop?",
        "a": (
            "Instrument before you decide. Here the loop was right and the fixture was wrong — and the "
            "symptom pointed at the wrong subsystem entirely.\n\n"
            "The suite is called `tool-loop-stuck-breaker`, so the obvious hypothesis is that a stuck guard "
            "fired early. I checked two candidates and cleared both: the repeated-failure guard is "
            "explicitly gated on `toolUses.length === 1`, and running the oscillation detector directly on "
            "the fixture's call ring showed it does not trip until *after* round 2, by which point the "
            "assertion would already be satisfied.\n\n"
            "A ten-line probe that printed the result text and the event stream gave the real answer "
            "immediately: `Stopped before tool dispatch because the model returned a missing, invalid, or "
            "reused tool-call identity.` The fixture reused ONE `twoUses` array for both rounds, so round 2 "
            "replayed tool_use ids `m1`/`m2`. The loop validates every provider `toolUseId` as a run-wide "
            "unique capability and rejects a reused round before any handler enters — a deliberate, "
            "documented safety property, not a bug.\n\n"
            "Fix the fixture (fresh ids per round), never the guard. The general lesson: when a test fails, "
            "read the actual error text before reasoning about the subsystem the test is named after. And "
            "check whether the fixture violates an invariant the system deliberately enforces — a "
            "hand-written fixture is often less realistic than production traffic."
        ),
        "evidence": "scripts/tool-loop-stuck-breaker-smoketest.ts; CLAUDE.md:237 run-wide-unique toolUseId",
    },
    {
        "id": "tool-description-budget-vs-safety",
        "q": "A lint says my tool description is too long and lacks when-to-use guidance. Just trim it?",
        "a": (
            "Trim the explanation, never the constraints — and add the guidance rather than suppressing the "
            "rule.\n\n"
            "Tool descriptions live in the CACHED system prefix and are paid for on every turn by every "
            "user, which is why a length budget exists at all. But for a mutation-adjacent tool the "
            "description is also where the safety contract is stated, so the parts that must survive any "
            "edit are: read-only/fail-closed, what identity is rechecked, what is never returned (HTML, "
            "text, values, secrets), and — most important — that the call does NOT authorize a later "
            "mutation.\n\n"
            "What compresses safely is narration: enumerated field lists, restated mechanics, and examples "
            "the schema already encodes. Cutting an actionability tool from 782 to exactly 600 chars only "
            "required dropping the redundant check enumeration and folding the expected* field list into "
            "one clause.\n\n"
            "The second rule is not bureaucratic either. In a family of more than three siblings the model "
            "has to choose, and a description that only says what a tool *does* gives it nothing to choose "
            "on. 'Use before a browser mutation…, and only after a fresh DOM snapshot' is both the guidance "
            "and a real precondition."
        ),
        "evidence": "src/lib/openswanToolRuntime.ts browser.locator_actionability + desktop.press_keys; scripts/tool-description-lint-smoketest.ts",
    },
    {
        "id": "safe-production-dedupe-procedure",
        "q": "I need to clean up ~4,600 duplicate rows in a production table. How do I do it without losing data?",
        "a": (
            "Pick an invariant that would DETECT data loss, then design the operation so you can assert it "
            "before and after. Everything else follows from that.\n\n"
            "For deduplication the invariant is `count(distinct md5(content))`. If it changes, you destroyed "
            "something. That single check is what makes the operation safe to run at all, and it is what "
            "caught an earlier, wrong plan: title-keyed dedupe looked correct until the data showed the "
            "biggest group held 1,889 distinct contents under one template title.\n\n"
            "The procedure that worked:\n\n"
            "1. **Dry-run first.** A SELECT with the exact `row_number() OVER (PARTITION BY …)` the UPDATE "
            "will use, reporting how many rows, how many circles, and how many pinned rows would be "
            "touched. Numbers before actions.\n"
            "2. **Key on content, not on the field that looks like an identity.** Partition by "
            "`(circle_id, scope, lower(title), md5(content))`.\n"
            "3. **Record the affected ids to a file with the reversal statement**, committed alongside the "
            "change. 'Reversible in principle' is worthless without the id list.\n"
            "4. **Soft-delete** (`is_active = false`) and stamp *why* into metadata "
            "(`deactivated_reason`, `deactivated_by`) so a future reader can tell an ops action from an "
            "application write.\n"
            "5. **Re-assert the guards inside the UPDATE itself** — `pinned = false`, `is_active = true` — "
            "not just in the dry-run. The dry-run and the write are separate transactions.\n"
            "6. **Verify the invariant.** Here: 4,716 -> 3,478 active rows, distinct content 3,477 -> 3,477. "
            "1,238 pure copies gone, zero information lost.\n\n"
            "Afterwards, fix the monitoring that mis-measured it. The original check counted title-only "
            "groups and would have kept reporting 3,357 'excess rows' that are legitimate distinct records "
            "— a metric that recommends deleting real data is worse than no metric."
        ),
        "evidence": "ops-records/memory-dedupe-2026-07-28-deactivated-ids.json; scripts/memory-prod-invariants.mjs check 6",
    },
    {
        "id": "backfill-without-exporting-the-key",
        "q": "I need to backfill embeddings but the OpenAI key only exists as a Supabase secret. Do I export it?",
        "a": (
            "No. Run the job where the key already is — a short-lived edge function — so the key never "
            "leaves the platform and the spend stays on the app's own key with its usage tracking.\n\n"
            "Shape that worked, ~1.4 cents for 2,604 rows:\n\n"
            "- **Cost first, from real data.** `sum(length(title||content))/4` for the affected rows, times "
            "the model's price. $0.0158 estimated, $0.0143 actual. Never ask for spend approval without a "
            "number.\n"
            "- **`dryRun` defaults to TRUE.** Spending is opt-in, and the dry run reports rows, tokens and "
            "dollars so the first real call is not the first measurement.\n"
            "- **A per-invocation spend cap** that refuses rather than truncates, plus a hard `limit`.\n"
            "- **Keyset paging on `id`** and an `.is('embedding', null)` filter on both the read and the "
            "UPDATE, so the job is resumable and idempotent — a re-run can never double-charge or "
            "overwrite an existing vector.\n"
            "- **One small real batch first** (25 rows), then verify the write actually landed correctly "
            "before looping. `vector_dims()` confirmed 1536 and uniform — a mixed-dimension column silently "
            "breaks the pgvector index.\n\n"
            "Two traps hit on the way. Authenticating on the platform's injected "
            "`SUPABASE_SERVICE_ROLE_KEY` rejected a legitimate operator because it did not match the "
            "project's published service_role API key — a purpose-set secret is unambiguous and scopes the "
            "endpoint to one job. And a 250-row batch blew the 150s idle timeout because the per-row "
            "UPDATEs are sequential; 100 rows finished in 4s.\n\n"
            "**Delete the endpoint when the job is done**, and do not leave the source under "
            "`supabase/functions/` — a bare `supabase functions deploy` deploys every directory there, so a "
            "retired ops writer would silently re-publish itself."
        ),
        "evidence": "ops-records/one-shot/memory-embed-backfill.ts; coverage 17.2% -> 100.0% (3,478/3,478)",
    },
    {
        "id": "regression-detector-must-confirm-before-alarming",
        "q": "I set up a nightly test job and its very first run reported a regression. Ship the fix?",
        "a": (
            "Reproduce it in isolation first. Mine reported `smoke:tool-result-formatters` as newly "
            "failing; the suite then passed 3 out of 3 runs on its own.\n\n"
            "The captured output gave the real story: `ERR_INVALID_RETURN_PROPERTY_VALUE: Expected a "
            "string... for the \"source\" from the \"load\" hook but got undefined`. That is tsx's module "
            "loader losing a race when many `npx tsx` processes run concurrently — the suite \"failed\" "
            "without its code ever executing. Infrastructure, not a code change.\n\n"
            "The fix belongs in the detector, not the suite: **re-run every newly-failing suite serially "
            "before calling it a regression.** If it passes, record it as flaky — visible in the report, "
            "but it does not trip the alarm or get memorialised in the baseline as a known failure.\n\n"
            "This matters more than it sounds. A detector that cries wolf produces exactly the same "
            "outcome as no detector: people stop reading it. The same reasoning is why an already-failing "
            "suite must be reported as *known* rather than re-alarmed every night — the job of the alarm "
            "is to tell you the hour something broke, not to restate a months-old failure until it is "
            "background noise.\n\n"
            "Two related traps worth internalising. Capture the failing suite's OUTPUT, not just its exit "
            "code — the exit code alone would have sent me hunting through formatter logic that was never "
            "run. And check your own harness's exit code without a pipe: `node x.mjs | tail` reports "
            "tail's status, which is the identical masking bug that let a broken `&&` test chain hide 273 "
            "suites in this repo."
        ),
        "evidence": "scripts/auto-test-cycle.mjs confirmFailures(); first scheduled run 2026-07-29",
    },
    {
        "id": "guard-stop-reads-as-clean-completion",
        "q": "Our agent loop stops early when it detects no progress. Downstream says the run completed. Why?",
        "a": (
            "Because 'did it finish?' is being asked as `!hitMaxIterations`, and a guard stop answers "
            "that question the same way a real completion does.\n\n"
            "`agentExecutionCore` has four exits that end a run WITHOUT finishing the work: an "
            "invalid/reused tool-call identity, a repeated-failure no-progress stop, an oscillation "
            "stop, and a tool-result boundary stop. All four return `stopReason: 'end_turn'` and "
            "`hitMaxIterations: false`. That is deliberate and correct in isolation — they are not cap "
            "exhaustion, and there are smoke tests pinning exactly that ('boundary stop is not "
            "mislabeled cap exhaustion'). The problem is that the pair `end_turn` + "
            "`hitMaxIterations:false` is ALSO the exact signature of a genuine finish, so it cannot "
            "distinguish the two.\n\n"
            "Consequences, all silent: `buildLegacyToolLoopResult` fell into its clean-completion "
            "branch and dropped the `incomplete` flag; the child's parent got `completed: true` and so "
            "had no reason to retry; the run row recorded `'completed'`; and the '\u2713 Verified' "
            "receipt skipped the downgrade that exists precisely to stop a partial run from reading as "
            "proven.\n\n"
            "Fix: add an explicit `stoppedEarly?: boolean` to the result, set it at the four guard "
            "exits, and branch on it before the clean-completion check. Do NOT fix it by flipping "
            "`hitMaxIterations` to true — that would be a second lie (it is not cap exhaustion) and "
            "would break the tests that pin the distinction.\n\n"
            "The general rule: **an absent failure flag is not evidence of success.** When several "
            "distinct terminal states collapse onto one signal, the states that mean 'did not finish' "
            "need their own flag. The codebase had already learned this once — `aborted?: boolean` was "
            "added for user-cancel for the identical reason — which is the tell that the pattern "
            "recurs and should be checked for at every new early-return you add to a loop."
        ),
        "evidence": (
            "src/lib/agentExecutionCore.ts (4 guard exits + AgentRunResult.stoppedEarly), "
            "src/lib/openswanSessionRuntimeAdapters.ts:807 buildLegacyToolLoopResult, "
            "src/lib/subagentRegistry.ts:1145 completedCleanly, "
            "src/lib/v2ToAgentCoreAdapterCore.ts normalizeV2StopReason"
        ),
    },
    {
        "id": "stale-test-fixture-reused-tool-use-id",
        "q": "A smoke test that used to exercise the iteration cap now fails. The loop stops after 1 dispatch. Is the cap broken?",
        "a": (
            "Check the fixture before the code. A scripted provider that replays one canned turn "
            "re-emits the SAME `tool_use` id every round. Real providers never do that, and the runtime "
            "later grew a guard that stops before dispatch on a missing, invalid, or reused tool-call "
            "identity.\n\n"
            "So the loop exits on round 2 via the identity guard, having dispatched once — the cap is "
            "fine, the fixture is invalid. The giveaway is in the result text: 'Stopped before tool "
            "dispatch because the model returned a missing, invalid, or reused tool-call identity.' "
            "Read `result.text` before theorising.\n\n"
            "Fix the provider to mint a fresh id per round (and vary the input, so the no-progress "
            "detector does not claim the test either). A test whose subject is cap exhaustion should "
            "reach the cap and nothing else.\n\n"
            "Worth noting: this stale fixture was doing real damage beyond its own red X — it was the "
            "only test covering 'incomplete child \u2192 completed=false', so while it was failing for "
            "the wrong reason, nobody was checking the right one. **A test failing for an uninteresting "
            "reason still costs you the coverage it was bought for.**"
        ),
        "evidence": "scripts/delegation-wiring-smoketest.ts (cap-exhaustion case), src/lib/agentExecutionCore.ts hasInvalidToolUseId guard",
    },
    {
        "id": "provenance-column-null-plumbing-complete",
        "q": "Our memory rows all have source_run_id NULL. Which layer is dropping it?",
        "a": (
            "Check whether anything ever SUPPLIES it before you go looking for what drops it. In this "
            "codebase the answer was: nothing did.\n\n"
            "The column existed with an FK to `agent_runs(id)`. `saveMemory` declared "
            "`sourceRunId?: string` and wrote `source_run_id: opts.sourceRunId` straight into the "
            "insert. Four wrapper layers threaded the option through faithfully. Every layer looked "
            "correct in review, because every layer WAS correct — the chain simply carried `undefined` "
            "from end to end, because the outermost callers had no such parameter. One writer "
            "(`autoExtractAndSave`) accounted for 2,789 of 3,471 rows and did not take a run id at all.\n\n"
            "The diagnostic move that settles it in one query is to group by writer and look at both "
            "counts together: `select source_surface, count(*), count(source_run_id) ... group by 1`. "
            "If the ratio is 0 for EVERY surface, no reader is dropping the value — no writer is "
            "producing one. A single layer dropping it would show up as 0 on some surfaces and "
            "non-zero on others.\n\n"
            "Harden before you wire. `source_run_id` is a uuid FK, so a supplied value has two ways to "
            "destroy the write rather than annotate it: a non-uuid is a 22P02, and a well-formed uuid "
            "whose run row is missing or was reaped is a 23503. Both kill the INSERT. Normalize the "
            "shape, and on FK rejection re-insert without the reference — **provenance must never cost "
            "you the record it describes.** Turning a missing-annotation bug into a data-loss bug is a "
            "strictly worse outcome than the one you started with.\n\n"
            "Where no run genuinely exists (a streaming path that never created an `agent_runs` row), "
            "leave it NULL. Attributing a memory to a plausible-looking nearby run is fabricated "
            "provenance, which is worse than absent provenance: absent reads as unknown, fabricated "
            "reads as fact."
        ),
        "evidence": (
            "src/lib/agentRunSystem.ts saveMemory (insert + FK fallback), "
            "src/lib/agentMemory.ts autoExtractAndSave, "
            "src/screens/circles/tabs/ChatTab.tsx (caller), "
            "scripts/memory-prod-invariants.mjs check 2"
        ),
    },
    {
        "id": "a11y-diff-attribution-not-movement",
        "q": "We verify desktop actions by diffing the accessibility tree before and after. If the tree changed, the action worked, right?",
        "a": (
            "No, and this is measurable rather than theoretical. Reading a real Chrome window's "
            "accessibility tree TWICE IN A ROW, with no action performed in between, produced **8 "
            "changes** (+4 nodes, -4 nodes) on one run — a feed updating and a window title that "
            "included live memory usage. A rule of 'the tree moved, therefore my action worked' would "
            "have reported VERIFIED for an action that was never dispatched.\n\n"
            "Repeat runs on the same window while it was idle produced 0 changes. So background churn "
            "is intermittent and app-dependent, which is worse than if it were constant: a naive "
            "implementation passes your testing and then fabricates completions in production against "
            "any app with live content.\n\n"
            "Verification has to require ATTRIBUTION, not movement:\n"
            "  - text entry verifies only when a changed field value actually CONTAINS the text you "
            "sent (substring, because typing appends into existing content)\n"
            "  - a menu action verifies only when a node labelled like the invoked item appears\n"
            "  - movement that matches no expectation stays UNKNOWN and never promotes\n\n"
            "The inverse is the underrated half. An UNCHANGED tree, for an action that MUST move it "
            "(type/paste/set-value/menu), is positive evidence the action MISSED — report that as a "
            "proven no-op, not as 'unknown'. 'Unknown' tells the caller nothing and invites a blind "
            "retry; 'this did not take effect' tells it to change approach. Do NOT apply that rule to "
            "mouse moves, scrolls, drags, or bare clicks: those routinely land without any "
            "accessibility-visible change, so calling them no-ops manufactures failures.\n\n"
            "One implementation trap: if your snapshot truncates long values, check HOW. A clamp of "
            "the form `slice(0, max - 1) + '…'` means the observed value ends in an ellipsis that is "
            "not in the text you sent, so a naive containment check fails on every long paste — "
            "exactly the case the truncation branch exists for. Detect truncation by the at-cap length "
            "AND the marker, and strip the marker before comparing."
        ),
        "evidence": (
            "src/lib/nativeUiVerificationCore.ts, src/lib/a11yTreeDiff.ts (clampString), "
            "live read-only probe against Google Chrome 2026-07-29"
        ),
    },
    {
        "id": "illustrator-layer-lock-ui-gate-not-dom-gate",
        "q": "Our Illustrator automation refuses to edit locked text frames. QA locked the layer and the edit still went through. How?",
        "a": (
            "Because you checked the frame's own `locked` property, and locking a LAYER does not set "
            "it. Illustrator's scripting DOM happily writes `textFrame.contents` while the frame's "
            "layer is locked — layer lock is a UI gate (it stops the user's cursor), not a DOM gate "
            "(it does not stop `do javascript`). A live probe proved it: lock \"Layer 1\", write the "
            "frame, result \"applied\", re-read confirms the new copy.\n\n"
            "The fix is to model what the USER means by locked, not what the DOM exposes: refuse when "
            "`frame.locked === true` OR `frame.layer.locked === true` (and the same for hidden: "
            "`frame.hidden` OR `frame.layer.visible === false`). A designer who locked the layer "
            "locked everything on it, whatever the object model thinks.\n\n"
            "Two adjacent traps from the same live session:\n"
            "  1. COLD-START DICTIONARY RACE — compiling `tell application ... do javascript` "
            "LAUNCHES the app to load its scripting dictionary. Against a cold app the dictionary is "
            "not loadable mid-boot, so osascript fails with a bare 'syntax error: Expected end of "
            "line but found identifier' pointing at the word `javascript`. The script is fine; the "
            "app is booting. This message sent a debugging session down an escaping rabbit hole — "
            "map it to an honest 'app is still starting, retry' message at the boundary that sees "
            "the raw error.\n"
            "  2. FOLDER NAME ≠ APPLESCRIPT NAME — the install lives in "
            "'/Applications/Adobe Illustrator 2026/Adobe Illustrator.app'. The AppleScript "
            "application name is the .app bundle's ('Adobe Illustrator'), not the year folder's. "
            "`tell application \"Adobe Illustrator 2026\"` fails dictionary lookup with the same "
            "misleading syntax error as the cold-start race, so the two are easy to conflate.\n\n"
            "General rule: **a permission model that only reads the object's own flag misses every "
            "inherited gate.** Check the container chain the user actually operates on."
        ),
        "evidence": (
            "src/lib/illustratorExtendScriptAdapters.ts frameLayerLocked/frameLayerHidden, "
            "scripts/claude-bridge.js describeIllustratorOsascriptError, "
            "live scratch-document probe against Illustrator 2026 on 2026-07-29"
        ),
    },
]


def build_record(f):
    return {
        "conversations": [
            {"from": "system", "value": SYSTEM},
            {"from": "human", "value": f["q"]},
            {"from": "gpt", "value": f["a"]},
        ],
        # metadata.source matches the tool-trace convention that
        # prepare_dataset_v4.is_tool_trace_example already keys on.
        "metadata": {
            "source": "engineering_findings",
            "finding_id": f["id"],
            "evidence": f["evidence"],
        },
    }


def main():
    check_only = "--check" in sys.argv
    seen = set()
    records = []
    for f in FINDINGS:
        for key in ("id", "q", "a", "evidence"):
            if not f.get(key) or not str(f[key]).strip():
                raise SystemExit(f"finding {f.get('id')!r} missing {key}")
        if f["id"] in seen:
            raise SystemExit(f"duplicate finding id: {f['id']}")
        seen.add(f["id"])
        if len(f["a"]) < 200:
            raise SystemExit(f"finding {f['id']} answer too thin to be useful training data")
        records.append(build_record(f))

    print(f"{len(records)} findings validated")
    if check_only:
        return
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
