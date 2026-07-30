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
    {
        "id": "photoshop-text-update-missing-family-lock-discipline",
        "q": "Three sibling app adapters handle locked targets three different ways. Which one is the bug?",
        "a": (
            "The one with NO policy. In this codebase's design-app family, the InDesign text updater "
            "had a deliberate contract: temporarily unlock the layer/item/story (recording each "
            "original), write, verify, RESTORE the original lock state, and report `unlockedCount`. "
            "The new Illustrator updater chose the other defensible contract: fail closed on a locked "
            "target and tell the caller to unlock explicitly. Photoshop's text updater had NEITHER — "
            "it wrote `layer.textItem.contents` with no lock or visibility check at all. Whether a "
            "locked layer got updated or produced an opaque error depended on which flag the DOM "
            "happened to enforce, a designer's lock was never restored because it was never recorded, "
            "and hidden layers were edited invisibly.\n\n"
            "Both explicit contracts are defensible; pick per lane and say so. Unlock-restore fits a "
            "batch pipeline (dealership banners: update every disclaimer under one approval); "
            "fail-closed fits a single-target precision edit. NO contract is the only wrong answer, "
            "because it delegates your semantics to whatever the object model happens to do.\n\n"
            "When porting the unlock-restore discipline, two details carry the correctness:\n"
            "  1. Unlock the ANCESTOR CHAIN, not just the target — Photoshop groups (LayerSets) gate "
            "their members in the UI, and a member inside a locked group is exactly the indirection "
            "that slips past a target-only check.\n"
            "  2. Restore AFTER verification counting, in reverse order — and when pinning that "
            "ordering in a source-level test, compare lastIndexOf on both sides: indexOf finds the "
            "helper's DEFINITION, which precedes everything, and the assertion passes vacuously.\n\n"
            "Live-verified on a scratch PSD while 30 recovered user documents sat open, guarded by "
            "expectedDocumentName: text inside a locked group updated with unlockedCount=1, the "
            "group's lock verified RESTORED afterward, and an unlocked layer reported unlockedCount=0."
        ),
        "evidence": (
            "scripts/claude-bridge.js buildPhotoshopUpdateTextLayerScript (unlockTarget/restoreUnlocks), "
            "buildInDesignUpdateTextLayerScript (the established pattern), "
            "src/lib/illustratorExtendScriptAdapters.ts (fail-closed variant), "
            "scripts/local-desktop-bridge-intent-smoketest.ts source pins, "
            "live scratch-PSD probe against Photoshop 2026 on 2026-07-29"
        ),
    },
    {
        "id": "unknown-app-menu-bar-discovery-and-its-limit",
        "q": "Our agent needs to operate desktop apps it has no profile for. Where does it even start?",
        "a": (
            "On macOS, start with the menu bar: it is the app's complete, labelled, structured command "
            "catalog, readable via System Events accessibility WITHOUT clicking, focusing, or launching "
            "anything. A read-only menu inventory (names, enabled state, submenus) turns 'guess a menu "
            "path and click blind' into 'read the catalog, then click an exact label'. Keep the reader "
            "strictly read-only and never let it launch a non-running app — discovery must not have "
            "side effects.\n\n"
            "Two implementation lessons:\n"
            "  1. Do NOT build JSON inside AppleScript — that is where escaping bugs live. Emit a "
            "delimited line protocol (unit separator U+001F is effectively collision-free for menu "
            "labels) and parse it on the calling side.\n"
            "  2. When a deep-read of one named menu misses, return every available menu TITLE anyway. "
            "A miss with no context is a dead end; a miss with the real catalog is a routing signal.\n\n"
            "And the limit, learned live: some apps do not populate the native menu bar at all. Blender "
            "exposes only Apple/Blender/Window — its real File/Edit/Render menus are drawn inside its "
            "own GL window, invisible to System Events menu reads. Games and custom-chrome Electron "
            "apps behave the same way. So the discovery ladder is: menu inventory first; if the bar "
            "comes back near-empty, that RESULT is the signal to fall back to accessibility-tree "
            "observation of the app's own window. The near-empty answer is not a failure of the tool — "
            "it is the fact that routes the next step."
        ),
        "evidence": (
            "scripts/claude-bridge.js buildMenuInventoryScript + /desktop/menu_inventory, "
            "src/lib/openswanToolRuntime.ts desktop.menu_inventory (honest-miss routing), "
            "live probes: Finder (8 menus/137 items), Blender (3 native menus only), 2026-07-29"
        ),
    },
    {
        "id": "unknown-app-ladder-first-live-verified",
        "q": "Can a generic agent ladder actually complete and PROVE a task in a desktop app it has zero knowledge of?",
        "a": (
            "Yes, and the proof shape matters more than the yes. Live drill against TextEdit — no "
            "profile, no adapter, generic capabilities only:\n\n"
            "  discover — menu inventory read the app's full command catalog (8 menus, 93 items, "
            "enabled state, submenus) without clicking or focusing anything\n"
            "  observe  — accessibility snapshot BEFORE (120 nodes)\n"
            "  act      — typed a marker string, BRACKETED by frontmost checks on both sides, "
            "because System Events keystrokes go to whatever is frontmost and a focus drift "
            "mid-type means your input landed in someone else's window\n"
            "  verify   — accessibility snapshot AFTER → structural diff → verdict 'verified' "
            "because the changed field value CONTAINS the exact text sent\n\n"
            "That last step is the load-bearing one. Earlier the same verifier had only produced "
            "negative verdicts live (unknown on idle churn, no_effect on unmoved trees); this was its "
            "first live POSITIVE — and it fired on attribution (sent text present in the changed "
            "value), not on 'the tree moved'. One verifier, three live-proven verdicts.\n\n"
            "Safety furniture that made the drill repeatable rather than reckless: a mutation-phase "
            "allowlist (unknown apps get discovery-only), and teardown that closes documents "
            "saving-no ONLY when every open document is an untitled scratch — a titled document "
            "freezes teardown and reports instead.\n\n"
            "One AppleScript trap took the finish line off the first run: `quit` INSIDE a "
            "`tell application` block kills the app before it can reply, so the AppleEvent times out "
            "(-1712) and your otherwise-passed run reports failure. Return your result from the tell "
            "block first; quit in a separate osascript wrapped in `ignoring application responses`."
        ),
        "evidence": (
            "scripts/unknown-app-ladder-drill.ts (npm run drill:unknown-app), "
            "12/12 steps passed twice against live TextEdit 2026-07-29, "
            "src/lib/nativeUiVerificationCore.ts verdict=verified live"
        ),
    },
    {
        "id": "engineering-tasks-generate-not-drive-when-no-app",
        "q": "An engineer wants the chat to do AutoCAD tasks — 2D drafting, layers, schematics, blocks — but there is no AutoCAD install. Dead end?",
        "a": "No. Separate the CAPABILITY from the APP. Underneath, all five \"AutoCAD core capabilities\" (2D drafting, layer management, specialized symbol toolsets, block/macro automation, and the 2D half of modeling) are structured geometry on named layers. That is exactly what DXF R12 encodes — an ASCII interchange format AutoCAD, FreeCAD, LibreCAD, QCAD, and Illustrator all import. So you GENERATE the drawing as pure computation and hand the engineer a real, dimensioned, layer-organized file, with zero app install and zero UI driving.\n\nThe design that makes this trustworthy rather than a toy:\n  1. ONE neutral entity model (line/circle/arc/polyline/text/block-insert on a validated layer) feeds BOTH a DXF writer AND the AutoCAD .scr command generator. Same intent, two backends: DXF works today, .scr lights up the day a licensed AutoCAD exists — no second model to keep in sync.\n  2. VERIFY by parsing your own output back — layers, per-type/per-layer entity counts, bounding box — and assert the floor plan\'s bbox equals the requested mm. \"It produced some text\" is not proof; \"a 12000\u00d78000 envelope with 2 door blocks on the DOORS layer\" is.\n  3. The security bar is format-specific and easy to miss: DXF is newline-delimited (group code, then value, each on its own line), so a newline in a layer name or text label is ENTITY INJECTION — it terminates the value and the next line becomes a group code. The smoke proves a hostile label containing a fake CIRCLE entity gets flattened and never becomes geometry. Same class as the .scr newline-is-Enter bar; different format, same discipline.\n  4. Do NOT fake what the format cannot do. R12 is 2D-first; a request for true 3D solids routes to the OpenSCAD/FreeCAD/Blender lane instead of emitting degenerate 3DFACE soup.\n\nAnd verify across IMPLEMENTATIONS, not just within yours. A round trip through your own parser proves internal consistency, not objective correctness. A from-scratch reader in a different language (here, a ~60-line Python DXF extractor) agreeing on version/layers/blocks/counts/bbox is real proof the format is right. Reach for a genuine consumer (FreeCAD, OpenSCAD, a CAD import) when one is installed; a language-independent reader is the strong fallback when none is.",
        "evidence": (
            "src/lib/engineeringDraftingCore.ts (DXF writer/parser + generators), "
            "src/lib/autocadScriptAdapter.ts draft_entities (.scr backend), "
            "engineering.draft_dxf runtime tool, "
            "scripts/dxf-verify.py + npm run drill:engineering-drafting (cross-implementation live proof)"
        ),
    },
    {
        "id": "3d-modeling-generate-and-dimensionally-verify",
        "q": "The 2D CAD generation worked. How do you do 3D solid modeling with the same rigor when the format is a mesh, not tagged data?",
        "a": "Same architecture, different proof. A neutral CSG model (union of positive primitives minus a set of negatives) covers the vast majority of real mechanical parts — plates with mounting holes, brackets, tubes/washers/spacers — and compiles to two backends from one definition: a Blender bpy script (STL, runs on an already-live-proven cad_compile lane) and OpenSCAD .scad (for when that engine is installed). One model, two emitters, exactly like the DXF/.scr split.\n\nThe verification is where 2D and 3D genuinely differ. A DXF is tagged DATA, so you round-trip it through a parser. A bpy script is CODE — round-tripping the text proves nothing about whether it BUILDS. So the proof has two layers:\n  1. Pre-run (smoke): structural sanity of the generated script — balanced delimiters, no bare nan/inf tokens (a NaN coordinate emits `nan` and the whole script becomes a runtime error), the output path embedded as an injection-safe literal, and the NOMINAL bounding box computed from the model (a 120\u00d780\u00d710 plate must claim exactly that envelope; holes are negatives and must NOT change it).\n  2. Run (live drill): actually run Blender on the generated bpy, then read the resulting binary STL with an INDEPENDENT from-scratch parser (80-byte header + uint32 triangle count + 50 bytes/triangle) and assert two things — triangles > 0, and the STL's MEASURED bounding box matches the nominal dimensions within tolerance. A 120\u00d780\u00d710 plate came back as 1054 triangles measuring 120\u00d780\u00d710mm; a 30-OD tube as 512 triangles measuring 30\u00d730\u00d725mm.\n\nTwo details that carry correctness: use the EXACT boolean solver for CSG (the fast solver produces non-manifold garbage on coincident faces, which a hole through a plate always has), and set a dimensional TOLERANCE — a cylinder\u2019s faceting shrinks a bore\u2019s measured chord slightly, so the OUTER box dims are exact but a bore is a hair under nominal. Zero tolerance would false-fail every part with a hole.\n\nThe general lesson: when your generator emits a SCRIPT rather than DATA, structural validation is necessary but never sufficient — you have to RUN it against the real engine and measure the artifact. Text that parses is not a part that builds.",
        "evidence": (
            "src/lib/engineeringSolidModelingCore.ts (CSG model, bpy+scad emitters, nominal bbox), "
            "scripts/stl-verify.py (independent binary-STL reader), "
            "npm run drill:engineering-solid (real Blender → STL dimensional check), "
            "engineering.model_3d runtime tool"
        ),
    },
    {
        "id": "engineering-analysis-textbook-verified-and-unit-consistent",
        "q": "We built CAD generation. Engineers also need calculations — beam sizing, resistor values, tap drills. How do you make those trustworthy?",
        "a": "This is the one core where the verification is the STRONGEST, because the answers are closed-form and textbook-exact. There is no round-trip, no engine to run, no ambiguity: every formula is asserted against a hand-computed reference value in the smoke, and the smoke IS the proof. A simply-supported beam with a central point load has δ = PL³/(48EI) — so P=1000N, L=1000mm, steel (E=200000 MPa), a 20×40 rectangular section (I=106667 mm⁴) MUST give 0.9766 mm, Mmax=250000 N·mm, σ=46.875 MPa. An M8×1.25 thread has a 6.8mm tap drill. An LED on 5V with 2V forward drop at 20mA needs (5−2)/0.02 = 150Ω. Write those exact numbers into the test; if the code ever drifts, the reference catches it.\n\nThe design decision that removes a whole class of bugs is a SINGLE self-consistent unit system. Work in millimetre / newton / megapascal (MPa = N/mm²): then E is in MPa, I in mm⁴, and δ = PL³/(48EI) comes out directly in mm with NO conversion factor. Mixing SI-base (metres, pascals) with millimetre geometry is where hand-and-code calculations silently disagree by 10⁹. Pick the consistent set, state it once, and every formula stays factor-free. Unit CONVERSION is then a separate, explicit tool — and it must refuse cross-dimension requests (mm→N is not a conversion, it is a bug) rather than silently multiplying by a factor.\n\nReturn structure, not a bare number. Each result carries the quantity, value, UNIT, the FORMULA used, and the inputs echoed back — so the agent shows its work and a human can audit it. \"δmax = 0.977 mm [δ=PL³/(48EI)] | Mmax=250000 N·mm, stress=46.875 MPa\" is a checkable answer; \"0.977\" is a number to be mistrusted.\n\nAnd this composes: calculate the required section or hole size, THEN feed it to engineering.draft_dxf / engineering.model_3d. analyze → draw is the real engineering workflow, and the two halves now share one library.",
        "evidence": (
            "src/lib/engineeringCalcCore.ts (mm/N/MPa system, structured CalcResult), "
            "scripts/engineering-calc-core-smoketest.ts (44 textbook-reference assertions), "
            "engineering.calc runtime tool"
        ),
    },
    {
        "id": "bolt-circle-one-pattern-both-generators-and-a-verifier-gap",
        "q": "We want a flange with a bolt circle. It's the most common mechanical feature. What's the clean way to add it across a 2D and a 3D generator?",
        "a": "The pattern math is trivial and identical in both dimensions — hole i sits at angle θ0 + i·360/N on a circle of radius PCD/2 — so the win is sharing that ONE computation and letting each generator consume the points. In 3D a flange is a disc (outer cylinder) minus a center bore minus N bolt-hole cylinders placed at those points; in 2D it is an outer circle, a dashed pitch-circle reference on a construction layer, and N hole circles with center-mark crosses at the same points. Same trig, two artifacts. Because it is pure trig, the smoke asserts EXACT coordinates: 4 holes on a Ø100 PCD from 0° land at exactly (50,0), (0,50), (−50,0), (0,−50) — floating-point dust rounded off so a hole meant for (40,0) IS (40,0).\n\nThe interesting bug this surfaced was in the VERIFIER, not the generator. The DXF verification parser built its bounding box from entity POSITION points only — line endpoints, circle CENTERS, text anchors. That is correct for lines and polylines but silently WRONG for circles: a Ø200 circle centered at the origin has a center point of (0,0), so the parser measured the whole flange outline as a zero-size point and the 'bbox spans the OD' check failed. The circle's extent is center ± radius, and the parser was throwing the radius (group code 40) away. The fix — expand the bbox by ±radius for CIRCLE/ARC entities — is a real correctness improvement that had been latent because every prior drawing (floor plans, schematics) was dominated by lines and polylines where center-point-only happens to be right.\n\nGeneral lesson: when you add a new PRIMITIVE to a system, re-audit the code that MEASURES it. A verifier tuned on the shapes you had can be quietly wrong about the shape you just introduced, and it fails in the safe direction (understating extent) so nothing crashes — it just measures the wrong number until a test that actually depends on the extent catches it.",
        "evidence": (
            "src/lib/engineeringSolidModelingCore.ts buildFlange + boltCirclePoints, "
            "src/lib/engineeringDraftingCore.ts buildBoltCircle + CIRCLE/ARC bbox expansion, "
            "npm run drill:engineering-solid (flange → 2088 triangles at 120×120×12mm live)"
        ),
    },
    {
        "id": "mutual-verification-generator-and-inspector-prove-each-other",
        "q": "We generate 3D parts and we can now inspect STL parts. How do you verify the inspector without just trusting it?",
        "a": "Make the two halves check each other on a quantity they must agree on: VOLUME. The generator and the inspector are entirely independent code paths, so if a part\'s volume comes out the same computed three different ways, both are almost certainly right. Compute it (1) ANALYTICALLY in closed form from the spec — a plate is w·d·t minus, per through-hole, π·(d/2)²·t; (2) by GENERATING that exact part, running it through real Blender to a mesh; and (3) by MEASURING the mesh back with the divergence theorem, V = (1/6)|Σ v0·(v1×v2)| over every triangle, which is EXACT for a closed mesh regardless of shape. Live results: a 120×80×10 plate with four Ø9 holes — analytical 93455.3 mm³, measured 93459.4 mm³, a 0.00% difference; a flange, 0.16%. The generator built the right solid AND the inspector measures volume correctly, and neither claim rests on trusting the other.\n\nThis is a general and underused technique: when you build a producer and a consumer of the same artifact, wire them into a loop and assert the round trip. It is far stronger than testing each in isolation, because a shared misconception would have to occur identically in two independent implementations to escape — and the closed-form analytical value is a third, human-checkable anchor that shares no code with either.\n\nTwo correctness details. First, the volume integral is winding-independent only if you take the absolute value — an inward-facing normal flips the sign, and a real mesh may have inconsistent winding. Second, PAIR volume with a watertightness verdict: the divergence-theorem volume is only meaningful for a CLOSED mesh, so check that every edge is shared by exactly two triangles (a 2-manifold) and mark the volume unreliable when it is not. An open mesh silently returns a plausible-looking wrong number otherwise. STL does not weld vertices, so match shared edges by quantizing coordinates to a micron before keying — coincident points from the exporter are bit-identical or within rounding, and quantization collapses them.\n\nThe bonus: once you can measure enclosed volume, mass = volume × material density composes the calc core\'s materials table for free — the same Ø100 flange weighs 0.585 kg in steel or 0.201 kg in aluminum.",
        "evidence": (
            "src/lib/engineeringMeshInspectCore.ts (parse/volume/area/watertight/mass), "
            "scripts/engineering-mesh-inspect-core-smoketest.ts (unit-cube known-truth), "
            "npm run drill:engineering-mesh-inspect (analytical↔generated↔measured, live), "
            "engineering.inspect_mesh + desktop.file_read_binary"
        ),
    },
    {
        "id": "a-dimension-must-equal-the-geometry-it-spans",
        "q": "We generate CAD drawings. Adding dimensions seems cosmetic — why treat it as a correctness problem?",
        "a": "Because a dimension is not a label, it is an INSTRUCTION. A drawing that shows a 90 mm feature annotated \"100\" tells the machinist to cut 100 — the part comes back wrong and the drawing, not the machinist, was lying. So the one property a dimensioning system must guarantee is that a dimension\'s text equals the actual geometric distance it spans, and the way to guarantee it is to never accept the value from the caller: MEASURE the geometry (horizontal → |Δx|, vertical → |Δy|, aligned → the true distance) and DERIVE the text from that measurement. The smoke then asserts text === formatDim(measuredDistance) for each orientation — a (0,0)-(30,40) aligned dimension must read \"50\", and reversing the points must still read \"50\" (absolute). If the value were an input, a copy-paste bug could silently ship a wrong dimension; because it is always computed from the points, that class of bug cannot occur.\n\nTwo implementation notes that keep it robust and portable. First, use EXPLODED (drawn) dimensions — extension lines, a dimension line with arrowheads, and the text as plain LINE + TEXT entities — rather than a real associative DXF DIMENSION entity. The associative entity needs a dimension-style table and an anonymous geometry block, and not every reader honors the style; the drawn form always renders and, crucially, the text is a value you computed and can therefore verify. Second, annotations must SCALE to the drawing: 2.5 mm text is right on a 120 mm bracket and invisible on a 12 000 mm floor plan, so derive text height / offset / arrow size from the drawing\'s bounding box (~3% of the smaller dimension) so the same code annotates both legibly.\n\nThe title block is the other half of manufacturability — name, material, scale, drawn-by, and a default-tolerance note are the metadata a shop needs — and its free-text fields go through the same newline-stripping bar as every other DXF text value, because a newline in a field would break out of the text tag exactly like an injected entity.\n\nThe general point: when a generated artifact will be ACTED ON by someone downstream (cut, drilled, ordered), correctness is not \"the entity is present\" — it is \"the value the human will act on is the true value.\" Verify the number, not just its existence.",
        "evidence": (
            "src/lib/engineeringDimensionCore.ts (linearDimension measures, never accepts, the value), "
            "scripts/engineering-dimension-core-smoketest.ts (text===measured for h/v/aligned), "
            "annotateDrawing + engineering.draft_dxf titleBlock/autoDimension, "
            "live: annotated OD-200 flange → dimension text '200' present, dxf-verify.py agrees"
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
