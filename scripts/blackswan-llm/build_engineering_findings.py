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
